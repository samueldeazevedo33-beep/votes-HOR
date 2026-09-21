#!/usr/bin/env python3
"""Construit le jeu de donnees des scrutins publics de la XVIIe legislature.

Sources (open data de l'Assemblee nationale, regenerees chaque nuit) :
  - Scrutins.json.zip : tous les scrutins publics, avec le vote nominatif
  - AMO30 : acteurs, mandats et organes, pour l'identite des deputes

Sorties :
  - docs/data/index.json     groupes, deputes, textes, scrutins et decomptes
  - docs/data/nominatif.json le vote de chaque depute sur chaque scrutin

La separation en deux fichiers suit l'usage : consulter un groupe ne demande
que le premier, plus leger, et le second n'est telecharge que lorsqu'on
descend au niveau d'un depute.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
CACHE = RACINE / ".cache"
DOSSIER_SORTIE = RACINE / "docs" / "data"

LEGISLATURE = 17
BASE = "https://data.assemblee-nationale.fr/static/openData/repository"
URL_SCRUTINS = f"{BASE}/{LEGISLATURE}/loi/scrutins/Scrutins.json.zip"
URL_ACTEURS = (
    f"{BASE}/{LEGISLATURE}/amo/tous_acteurs_mandats_organes_xi_legislature"
    "/AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip"
)

POUR, CONTRE, ABSTENTION, NON_VOTANT, ABSENT = "p", "c", "a", "n", "-"
CODE_POSITION = {"pour": 0, "contre": 1, "abstention": 2}

# Ordre de l'hemicycle, de la gauche vers la droite. Les groupes absents de
# cette liste sont places a la fin, dans l'ordre de la source.
ORDRE_HEMICYCLE = [
    "LFI-NFP", "GDR", "ECOS", "SOC", "LIOT", "DEM", "EPR", "HOR",
    "DR", "AD", "UDR", "UDDPLR", "RN", "NI",
]


def journal(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def en_liste(valeur) -> list:
    """La conversion XML -> JSON de l'Assemblee replie les listes d'un seul
    element en objet et remplit les noeuds vides de None."""
    if valeur is None:
        return []
    if isinstance(valeur, list):
        return [v for v in valeur if v is not None]
    return [valeur]


def telecharger(url: str, destination: Path, max_essais: int = 4) -> Path:
    if destination.exists() and destination.stat().st_size > 0:
        journal(f"  cache  {destination.name} ({destination.stat().st_size // 1024} Ko)")
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    attente = 2
    for essai in range(1, max_essais + 1):
        try:
            journal(f"  telechargement {url}")
            with urllib.request.urlopen(url, timeout=300) as reponse:
                contenu = reponse.read()
            destination.write_bytes(contenu)
            journal(f"  recu   {destination.name} ({len(contenu) // 1024} Ko)")
            return destination
        except (urllib.error.URLError, TimeoutError, OSError) as erreur:
            if essai == max_essais:
                raise
            journal(f"  echec ({erreur}), nouvelle tentative dans {attente}s")
            time.sleep(attente)
            attente *= 2
    raise RuntimeError("inaccessible")


# --------------------------------------------------------------- Libelles

# Le libelle d'un scrutin est redige en clair. On y lit le texte debattu, la
# nature de ce qui est mis aux voix, et le cas echeant l'amendement vise.

MENTIONS_LECTURE = (
    "première lecture|nouvelle lecture|deuxième lecture|seconde lecture"
    "|lecture définitive|texte de la commission mixte paritaire"
    "|seconde délibération|examen prioritaire"
)

# Le texte apparait tantot en complement (« l'article 3 DU projet de loi… »),
# tantot comme objet direct du scrutin (« LA proposition de resolution… »).
MOTIF_TEXTE_DIRECT = re.compile(
    r"^l[ae]s?\s+(projet de loi|proposition de loi|proposition de résolution"
    r"|projet de loi constitutionnelle|projet de loi organique|proposition de loi organique)\b"
    r"(.*?)$",
    re.IGNORECASE,
)

# « du projet de loi », « au projet de loi », « a la proposition de loi », et la
# coquille « la deuxieme partie projet de loi » presente dans la source.
MOTIF_TEXTE = re.compile(
    r"(?:d[eu]s?|au|à la|partie)\s+(?:la\s+)?(projet de loi|proposition de loi|proposition de résolution|projet de loi constitutionnelle|projet de loi organique|proposition de loi organique)\b"
    r"(.*?)$",
    re.IGNORECASE,
)

# Dernier recours : les scrutins de procedure nomment le texte entre parentheses.
MOTIF_TEXTE_PARENTHESE = re.compile(
    r"\((projet de loi|proposition de loi|proposition de résolution|projet de loi constitutionnelle|projet de loi organique|proposition de loi organique)\b([^)]*)\)",
    re.IGNORECASE,
)

RANGS = ("bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies"
         "|undecies|duodecies|terdecies|quaterdecies|quindecies|sexdecies|vicies")

MOTIF_AMENDEMENT = re.compile(
    r"(?:sous-)?amendements?"
    r"(?:\s+de\s+(?:suppression|supression|rétablissement))?"
    r"(?:\s+de)?"
    r"\s*n°\s*"
    r"(?P<numero>[IVX]*-?\d+(?:\s*\([^)]*\))?(?:\s+rectifié)?)"
    r"\s+d(?:e|u)\s+"
    r"(?P<auteur>.+?)"
    r"(?=\s+(?:à\s+l|après\s+l|avant\s+l|et\s+l|et\s+les|et\s+le|du\s+projet"
    r"|de\s+la\s+proposition|de\s+rétablissement|de\s+suppression|suivante?s?)\b|,|$)",
    re.IGNORECASE,
)

MOTIF_ARTICLE = re.compile(
    r"(?:à|après|avant)\s+l'article\s+"
    r"(liminaire|premier|\d+(?:\s+(?:" + RANGS + r"))*)",
    re.IGNORECASE,
)
MOTIF_ARTICLE_SEUL = re.compile(
    r"^l'article\s+(liminaire|premier|\d+(?:\s+(?:" + RANGS + r"))*)",
    re.IGNORECASE,
)


def nettoyer(texte: str) -> str:
    return re.sub(r"\s+", " ", texte or "").strip()


def ardoise(texte: str) -> str:
    """Identifiant stable et lisible derive d'un intitule."""
    sans_accent = unicodedata.normalize("NFD", texte)
    sans_accent = "".join(c for c in sans_accent if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", sans_accent.lower()).strip("-")[:70]


def extraire_texte(objet: str):
    """Rend (nature, intitule normalise) du texte debattu, ou None."""
    trouve = (MOTIF_TEXTE.search(objet) or MOTIF_TEXTE_DIRECT.match(objet)
              or MOTIF_TEXTE_PARENTHESE.search(objet))
    if not trouve:
        return None
    nature = trouve.group(1).lower()
    suite = trouve.group(2)
    # On coupe aux mentions de lecture : le meme texte revient en premiere
    # lecture, en nouvelle lecture puis en lecture definitive, et ces trois
    # etapes doivent se ranger sous un seul intitule.
    suite = re.split(r"\s*\((?:" + MENTIONS_LECTURE + r")\)", suite, flags=re.I)[0]
    suite = re.sub(r"\s*\((?:" + MENTIONS_LECTURE + r")\)", "", suite, flags=re.I)
    intitule = nettoyer(f"{nature} {suite}").rstrip(" .,;")
    return nature, intitule


def extraire_lecture(objet: str):
    trouve = re.search(r"\((" + MENTIONS_LECTURE + r")\)\s*\.?\s*$", objet, re.IGNORECASE)
    return trouve.group(1).lower() if trouve else None


def extraire_amendement(objet: str):
    trouve = MOTIF_AMENDEMENT.search(objet)
    if not trouve:
        return None
    return {
        "numero": nettoyer(trouve.group("numero")),
        "auteur": nettoyer(trouve.group("auteur")).strip(" .,"),
        "identiques": bool(re.search(r"amendements? identiques? suivants?", objet, re.I)),
    }


def extraire_article(objet: str):
    trouve = MOTIF_ARTICLE.search(objet) or MOTIF_ARTICLE_SEUL.search(objet)
    return nettoyer(trouve.group(1)).lower() if trouve else None


def categoriser(objet: str) -> str:
    minuscule = objet.lower()
    if "motion de censure" in minuscule:
        return "motion de censure"
    if ("déclaration du gouvernement" in minuscule
            or "déclaration de politique générale" in minuscule):
        return "déclaration du Gouvernement"
    if "suspension de séance" in minuscule:
        return "suspension de séance"
    if "prolonger la séance" in minuscule:
        return "organisation des travaux"
    if "sous-amendement" in minuscule:
        return "sous-amendement"
    if "amendement" in minuscule:
        return "amendement"
    if "motion" in minuscule:
        return "motion de procédure"
    if "l'ensemble" in minuscule:
        return "ensemble du texte"
    if re.search(r"l'article|les articles|la première partie|la seconde partie"
                 r"|la deuxième partie|les crédits", minuscule):
        return "article ou crédits"
    return "autre"


# ------------------------------------------------------------- Chargement

def charger_groupes(archive: zipfile.ZipFile) -> dict:
    groupes = {}
    for nom in archive.namelist():
        if not nom.startswith("json/organe/"):
            continue
        organe = json.loads(archive.read(nom))["organe"]
        if organe.get("codeType") != "GP" or str(organe.get("legislature")) != str(LEGISLATURE):
            continue
        vie = organe.get("viMoDe") or {}
        sigle = organe.get("libelleAbrev") or organe.get("libelleAbrege") or organe["uid"]
        groupes[organe["uid"]] = {
            "uid": organe["uid"],
            "sigle": sigle,
            "libelle": organe.get("libelle") or sigle,
            "dateDebut": vie.get("dateDebut"),
            "dateFin": vie.get("dateFin"),
        }
    return groupes


def charger_deputes(archive: zipfile.ZipFile, groupes: dict) -> dict:
    deputes = {}
    for nom in archive.namelist():
        if not nom.startswith("json/acteur/"):
            continue
        acteur = json.loads(archive.read(nom))["acteur"]
        uid = acteur["uid"]["#text"]
        appartenances, circonscription = [], None
        for mandat in en_liste(acteur.get("mandats", {}).get("mandat")):
            references = mandat.get("organes", {}).get("organeRef")
            references = [references] if isinstance(references, str) else en_liste(references)
            for reference in references:
                if reference in groupes:
                    appartenances.append({
                        "groupe": reference,
                        "debut": mandat.get("dateDebut"),
                        "fin": mandat.get("dateFin"),
                    })
            if mandat.get("typeOrgane") == "ASSEMBLEE":
                lieu = (mandat.get("election") or {}).get("lieu") or {}
                if lieu.get("departement"):
                    circonscription = {
                        "departement": lieu.get("departement"),
                        "numero": lieu.get("numDepartement"),
                        "circo": lieu.get("numCirco"),
                    }
        if not appartenances:
            continue
        identite = acteur["etatCivil"]["ident"]
        deputes[uid] = {
            "uid": uid,
            "nom": identite["nom"],
            "prenom": identite["prenom"],
            "civilite": identite.get("civ"),
            "circonscription": circonscription,
            "appartenances": appartenances,
        }
    return deputes


# ------------------------------------------------------------ Construction

def construire() -> tuple[dict, dict]:
    CACHE.mkdir(exist_ok=True)
    journal("Sources Assemblee nationale")
    chemin_scrutins = telecharger(URL_SCRUTINS, CACHE / "scrutins.zip")
    chemin_acteurs = telecharger(URL_ACTEURS, CACHE / "acteurs.zip")

    with zipfile.ZipFile(chemin_acteurs) as archive:
        groupes = charger_groupes(archive)
        deputes = charger_deputes(archive, groupes)
    journal(f"  {len(groupes)} groupes, {len(deputes)} deputes ayant appartenu a un groupe")

    archive_scrutins = zipfile.ZipFile(chemin_scrutins)
    fichiers = [n for n in archive_scrutins.namelist() if n.endswith(".json")]

    # Passe 1 : on releve les intitules de texte et les references de dossier,
    # pour rattacher au meme texte les scrutins que la source ne relie pas.
    journal("Passe 1 : identification des textes")
    brut = []
    dossier_par_intitule = {}
    for nom in fichiers:
        scrutin = json.loads(archive_scrutins.read(nom))["scrutin"]
        objet = nettoyer((scrutin.get("objet") or {}).get("libelle") or scrutin.get("titre") or "")
        dossier = ((scrutin.get("objet") or {}).get("dossierLegislatif") or {})
        reference = dossier.get("dossierRef")
        extrait = extraire_texte(objet)
        if extrait and reference:
            dossier_par_intitule.setdefault(extrait[1], reference)
        brut.append((scrutin, objet, reference, extrait))

    journal("Passe 2 : construction des scrutins")
    textes = {}
    scrutins, nominatif = [], []
    votants = set()
    sans_texte = Counter()

    for scrutin, objet, reference, extrait in brut:
        cle_texte = None
        if extrait:
            nature, intitule = extrait
            cle_texte = reference or dossier_par_intitule.get(intitule) or ardoise(intitule)
            entree = textes.setdefault(cle_texte, {
                "cle": cle_texte,
                "nature": nature,
                "libelle": intitule[0].upper() + intitule[1:],
                "dossierRef": reference,
                "scrutins": 0,
                "debut": scrutin["dateScrutin"],
                "fin": scrutin["dateScrutin"],
            })
            entree["scrutins"] += 1
            entree["debut"] = min(entree["debut"], scrutin["dateScrutin"])
            entree["fin"] = max(entree["fin"], scrutin["dateScrutin"])
            if reference and not entree["dossierRef"]:
                entree["dossierRef"] = reference
        else:
            sans_texte[categoriser(objet)] += 1

        # Decomptes officiels par groupe. On les recopie plutot que de les
        # recalculer : la reconstitution a partir des votes nominatifs et des
        # dates d'appartenance diverge sur 88 scrutins, un ecart que l'outil
        # ne doit pas introduire.
        positions, votes = {}, {}
        organe = (scrutin.get("ventilationVotes") or {}).get("organe") or {}
        for groupe in en_liste((organe.get("groupes") or {}).get("groupe")):
            reference_groupe = groupe.get("organeRef")
            vote = groupe.get("vote") or {}
            # Une douzaine de scrutins portent « PO0 » a la place de
            # l'identifiant de groupe. La ventilation par groupe y est perdue,
            # mais les votes nominatifs sont bien presents : on les conserve.
            connu = reference_groupe in groupes
            if connu:
                chiffres = vote.get("decompteVoix") or {}
                positions[reference_groupe] = [
                    CODE_POSITION.get(vote.get("positionMajoritaire"), 3),
                    int(chiffres.get("pour") or 0),
                    int(chiffres.get("contre") or 0),
                    int(chiffres.get("abstentions") or 0),
                    int(chiffres.get("nonVotants") or 0),
                ]
            nominal = vote.get("decompteNominatif") or {}
            for champ, code in (("pours", POUR), ("contres", CONTRE),
                                ("abstentions", ABSTENTION), ("nonVotants", NON_VOTANT)):
                bloc = nominal.get(champ)
                if not isinstance(bloc, dict):
                    continue
                for acteur in en_liste(bloc.get("votant")):
                    votes[acteur["acteurRef"]] = (code, reference_groupe if connu else None)
        votants.update(votes)

        synthese = (scrutin.get("syntheseVote") or {}).get("decompte") or {}
        enregistrement = {
            "n": int(scrutin["numero"]),
            "d": scrutin["dateScrutin"],
            "t": cle_texte,
            "o": objet,
            "c": categoriser(objet),
            "s": (scrutin.get("sort") or {}).get("code"),
            "a": [int(synthese.get("pour") or 0), int(synthese.get("contre") or 0),
                  int(synthese.get("abstentions") or 0)],
            "g": positions,
        }
        if scrutin.get("typeVote", {}).get("codeTypeVote") != "SPO":
            enregistrement["solennel"] = True
        lecture = extraire_lecture(objet)
        if lecture:
            enregistrement["l"] = lecture
        article = extraire_article(objet)
        if article:
            enregistrement["art"] = article
        amendement = extraire_amendement(objet)
        if amendement:
            enregistrement["am"] = amendement
        # La ventilation par groupe est tenue pour exploitable seulement si elle
        # rend compte de tous les votes nominatifs. Une douzaine de scrutins
        # portent « PO0 » a la place de l'identifiant de groupe, parfois pour
        # une partie seulement des groupes : l'ecran doit le dire plutot que
        # d'afficher une repartition qui ne totalise pas.
        exprimes_ventiles = sum(p[1] + p[2] + p[3] + p[4] for p in positions.values())
        if exprimes_ventiles != len(votes):
            enregistrement["gInconnu"] = True
        scrutins.append(enregistrement)
        nominatif.append(votes)

    archive_scrutins.close()

    ordre = sorted(scrutins, key=lambda s: (s["d"], s["n"]))
    rang_scrutin = {s["n"]: i for i, s in enumerate(ordre)}
    nominatif = [nominatif[i] for i in sorted(range(len(scrutins)),
                                              key=lambda i: (scrutins[i]["d"], scrutins[i]["n"]))]
    scrutins = ordre

    # Les deputes n'ayant jamais pris part a un scrutin public n'apportent rien.
    liste_deputes = sorted(
        (d for uid, d in deputes.items() if uid in votants),
        key=lambda d: (d["nom"], d["prenom"]),
    )
    rang_depute = {d["uid"]: i for i, d in enumerate(liste_deputes)}

    # Chaine compacte : un caractere par depute, dans l'ordre du tableau.
    chaines = []
    for votes in nominatif:
        ligne = [ABSENT] * len(liste_deputes)
        for uid, (code, _groupe) in votes.items():
            rang = rang_depute.get(uid)
            if rang is not None:
                ligne[rang] = code
        chaines.append("".join(ligne))

    for depute in liste_deputes:
        rang = rang_depute[depute["uid"]]
        exprimes = sum(1 for chaine in chaines if chaine[rang] in (POUR, CONTRE, ABSTENTION))
        depute["scrutins"] = exprimes
        # Le groupe sous lequel le depute a le plus souvent vote sert d'etiquette
        # par defaut ; les appartenances completes restent disponibles.
        compte = Counter()
        for votes in nominatif:
            entree = votes.get(depute["uid"])
            if entree and entree[1]:
                compte[entree[1]] += 1
        depute["groupe"] = compte.most_common(1)[0][0] if compte else None
        depute["groupes"] = [g for g, _ in compte.most_common()]

    liste_groupes = sorted(
        groupes.values(),
        key=lambda g: (ORDRE_HEMICYCLE.index(g["sigle"]) if g["sigle"] in ORDRE_HEMICYCLE
                       else len(ORDRE_HEMICYCLE)),
    )
    for groupe in liste_groupes:
        groupe["membres"] = sum(1 for d in liste_deputes if groupe["uid"] in d["groupes"])

    # Les decomptes passent d'un objet indexe par identifiant a un tableau
    # aligne sur « groupes », ce qui retire quatorze clefs de dix caracteres
    # par scrutin sans rien perdre.
    rang_groupe = [g["uid"] for g in liste_groupes]
    for scrutin in scrutins:
        par_uid = scrutin["g"]
        scrutin["g"] = [par_uid.get(uid) for uid in rang_groupe]

    journal(f"  {len(scrutins)} scrutins, {len(liste_deputes)} deputes votants, "
            f"{len(textes)} textes")
    journal(f"  scrutins hors texte : {dict(sans_texte)}")

    index = {
        "genereLe": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "legislature": LEGISLATURE,
        "source": "data.assemblee-nationale.fr",
        "periode": {"debut": scrutins[0]["d"], "fin": scrutins[-1]["d"]},
        "legendeVotes": {POUR: "pour", CONTRE: "contre", ABSTENTION: "abstention",
                         NON_VOTANT: "non-votant", ABSENT: "absent ou hors groupe"},
        "groupes": liste_groupes,
        "deputes": liste_deputes,
        "textes": sorted(textes.values(), key=lambda t: (t["debut"], t["libelle"])),
        "scrutins": scrutins,
    }
    return index, {"ordre": [s["n"] for s in scrutins], "votes": chaines}


def ecrire(chemin: Path, donnees: dict) -> int:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(json.dumps(donnees, ensure_ascii=False, separators=(",", ":")),
                      encoding="utf-8")
    return chemin.stat().st_size


def main() -> int:
    index, nominatif = construire()
    for ancien in ("votes.json",):
        (DOSSIER_SORTIE / ancien).unlink(missing_ok=True)
    poids_index = ecrire(DOSSIER_SORTIE / "index.json", index)
    poids_nominatif = ecrire(DOSSIER_SORTIE / "nominatif.json", nominatif)
    journal(f"Ecrit index.json ({poids_index // 1024} Ko) "
            f"et nominatif.json ({poids_nominatif // 1024} Ko)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
