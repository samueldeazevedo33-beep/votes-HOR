#!/usr/bin/env python3
"""Construit le jeu de donnees des votes budgetaires du groupe Horizons & Independants.

Sources :
  - Scrutins publics de la XVIIe legislature (open data Assemblee nationale)
  - Acteurs / mandats / organes (meme source), pour l'identite des deputes
  - Optionnel : un flux JSON externe (Apps Script) apportant les resumes
    d'amendements, joint sur le numero de scrutin.

Sortie : docs/data/votes.json
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
CACHE = RACINE / ".cache"
SORTIE = RACINE / "docs" / "data" / "votes.json"

LEGISLATURE = 17
GROUPE_UID = "PO845470"  # Horizons & Independants, XVIIe legislature

BASE = "https://data.assemblee-nationale.fr/static/openData/repository"
URL_SCRUTINS = f"{BASE}/{LEGISLATURE}/loi/scrutins/Scrutins.json.zip"
URL_ACTEURS = (
    f"{BASE}/{LEGISLATURE}/amo/tous_acteurs_mandats_organes_xi_legislature"
    "/AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip"
)

# Flux des resumes d'amendements. Voir docs/BRANCHEMENT.md pour le contrat.
URL_RESUMES = os.environ.get("AMENDEMENTS_FEED_URL", "").strip()

# Le perimetre budgetaire, dans l'ordre de priorite : le premier motif qui
# accroche donne la categorie et, s'il capture un millesime, l'annee du texte.
TEXTES_BUDGETAIRES = [
    ("PLF", "projet de loi de finances pour (20\\d{2})"),
    # L'open data comporte la coquille « de fin des gestion » pour 2024.
    ("PLFG", "projet de loi de finances de fin de[s]? gestion pour (20\\d{2})"),
    ("PLFR", "projet de loi de finances rectificative(?: pour (20\\d{2}))?"),
    ("PLF_SPECIALE", "projet de loi spéciale"),
    ("PLFSS", "projet de loi de financement de la sécurité sociale pour (20\\d{2})"),
    ("PLFSSR", "projet de loi de financement rectificative de la sécurité sociale"),
    ("LPFP", "programmation des finances publiques"),
    ("COMPTES", "résultats de la gestion et portant approbation des comptes"
                "|projet de loi de règlement"
                "|approbation des comptes de la sécurité sociale"),
]

# Le libelle porte le « pour » afin que la concatenation avec le millesime
# donne une formule correcte : « projet de loi de finances pour 2026 ».
LIBELLES_TEXTES = {
    "PLF": "Projet de loi de finances pour",
    "PLFG": "Projet de loi de finances de fin de gestion pour",
    "PLFR": "Projet de loi de finances rectificative pour",
    "PLF_SPECIALE": "Projet de loi spéciale",
    "PLFSS": "Projet de loi de financement de la sécurité sociale pour",
    "PLFSSR": "Projet de loi de financement rectificative de la sécurité sociale",
    "LPFP": "Loi de programmation des finances publiques",
    "COMPTES": "Approbation des comptes",
}

# Codes de vote, encodes sur un caractere pour tenir dans une chaine par scrutin.
POUR, CONTRE, ABSTENTION, NON_VOTANT, ABSENT = "p", "c", "a", "n", "-"


def journal(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def en_liste(valeur) -> list:
    """La conversion XML -> JSON de l'Assemblee replie les listes d'un seul
    element en objet, et remplit les noeuds vides de None. On renormalise."""
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


def classer_texte(objet: str):
    """Rend (categorie, annee, cle) si le scrutin releve du budget, sinon None."""
    for categorie, motif in TEXTES_BUDGETAIRES:
        trouve = re.search(motif, objet, re.IGNORECASE)
        if not trouve:
            continue
        annee = None
        if trouve.groups() and trouve.group(1):
            annee = int(trouve.group(1))
        cle = f"{categorie}-{annee}" if annee else categorie
        return categorie, annee, cle
    return None


def categoriser_objet(objet: str) -> str:
    minuscule = objet.lower()
    if "sous-amendement" in minuscule:
        return "sous-amendement"
    if "amendement" in minuscule:
        return "amendement"
    if "motion" in minuscule:
        return "motion"
    if "l'ensemble" in minuscule:
        return "ensemble"
    if re.search(r"l'article|les articles|la première partie|la seconde partie", minuscule):
        return "article"
    return "autre"


# Les libelles de scrutin sont rediges en clair : on en extrait le numero et
# l'auteur de l'amendement, qui sont les deux cles de rapprochement avec un
# outil externe. L'auteur court jusqu'a la premiere formule de liaison, la
# ponctuation des civilites interdisant de s'arreter au simple point.
MOTIF_AMENDEMENT = re.compile(
    r"(?:sous-)?amendements?"
    r"(?:\s+de\s+(?:suppression|supression|r\u00e9tablissement))?"
    r"(?:\s+de)?"                       # coquille « l'amendement de n\u00b0 » dans la source
    r"\s*n\u00b0\s*"
    r"(?P<numero>[IVX]*-?\d+(?:\s*\([^)]*\))?(?:\s+rectifi\u00e9)?)"
    r"\s+d(?:e|u)\s+"
    r"(?P<auteur>.+?)"
    r"(?=\s+(?:\u00e0\s+l|apr\u00e8s\s+l|avant\s+l|et\s+l|et\s+les|et\s+le|du\s+projet"
    r"|de\s+la\s+proposition|de\s+r\u00e9tablissement|de\s+suppression|suivante?s?)\b|,|$)",
    re.IGNORECASE,
)


def extraire_amendement(objet: str):
    trouve = MOTIF_AMENDEMENT.search(objet)
    if not trouve:
        return None
    return {
        "numero": re.sub(r"\s+", " ", trouve.group("numero")).strip(),
        "auteur": re.sub(r"\s+", " ", trouve.group("auteur")).strip(" .,"),
        "identiques": bool(re.search(r"amendements? identiques? suivants?", objet, re.I)),
    }


# Les numeros d'article se poursuivent par un rang latin (« 15 bis »,
# « 20 octies ») qu'il faut capturer, sans avaler la preposition qui suit.
RANGS = ("bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies"
         "|undecies|duodecies|terdecies|quaterdecies|quindecies|sexdecies|vicies")

MOTIF_ARTICLE = re.compile(
    r"(?:\u00e0|apr\u00e8s|avant)\s+l'article\s+"
    r"(liminaire|premier|\d+(?:\s+(?:" + RANGS + r"))*)",
    re.IGNORECASE,
)
MOTIF_ARTICLE_SEUL = re.compile(
    r"^l'article\s+(liminaire|premier|\d+(?:\s+(?:" + RANGS + r"))*)",
    re.IGNORECASE,
)


def extraire_article(objet: str):
    trouve = MOTIF_ARTICLE.search(objet) or MOTIF_ARTICLE_SEUL.search(objet)
    if not trouve:
        return None
    return re.sub(r"\s+", " ", trouve.group(1)).strip().lower()


def charger_deputes(archive: Path) -> dict:
    """Identite et periode d'appartenance au groupe, pour tous ceux qui y ont
    siege sous cette legislature."""
    deputes = {}
    with zipfile.ZipFile(archive) as zf:
        noms = [n for n in zf.namelist() if n.startswith("json/acteur/") and n.endswith(".json")]
        for nom in noms:
            acteur = json.loads(zf.read(nom))["acteur"]
            mandats_groupe = []
            circonscription = None
            for mandat in en_liste(acteur.get("mandats", {}).get("mandat")):
                organes = mandat.get("organes", {}).get("organeRef")
                organes = [organes] if isinstance(organes, str) else en_liste(organes)
                if GROUPE_UID in organes:
                    mandats_groupe.append(mandat)
                if mandat.get("typeOrgane") == "ASSEMBLEE":
                    election = mandat.get("election") or {}
                    lieu = election.get("lieu") or {}
                    if lieu.get("departement"):
                        circonscription = {
                            "departement": lieu.get("departement"),
                            "numero": lieu.get("numDepartement"),
                            "circo": lieu.get("numCirco"),
                        }
            if not mandats_groupe:
                continue
            identite = acteur["etatCivil"]["ident"]
            debuts = [m.get("dateDebut") for m in mandats_groupe if m.get("dateDebut")]
            fins = [m.get("dateFin") for m in mandats_groupe]
            deputes[acteur["uid"]["#text"]] = {
                "uid": acteur["uid"]["#text"],
                "nom": identite["nom"],
                "prenom": identite["prenom"],
                "civilite": identite.get("civ"),
                "circonscription": circonscription,
                "dateDebut": min(debuts) if debuts else None,
                # Un seul mandat encore ouvert suffit a rendre le depute actif.
                "dateFin": None if any(f is None for f in fins) else max(f for f in fins),
            }
    return deputes


def charger_resumes(url: str) -> dict:
    """Recupere les resumes d'amendements produits par l'outil externe.

    Le flux est facultatif : une panne de son cote ne doit pas empecher la
    reconstruction du site, seulement la priver des resumes.
    """
    if not url:
        journal("  flux resumes : non configure, on poursuit sans")
        return {}
    try:
        requete = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(requete, timeout=120) as reponse:
            charge = json.loads(reponse.read().decode("utf-8"))
    except Exception as erreur:  # noqa: BLE001 - toute panne du flux est non bloquante
        journal(f"  flux resumes indisponible ({erreur}), on poursuit sans")
        return {}

    entrees = charge.get("amendements") if isinstance(charge, dict) else charge
    resumes = {}
    for entree in en_liste(entrees):
        numero_scrutin = entree.get("scrutin") or entree.get("numeroScrutin")
        if numero_scrutin in (None, ""):
            continue
        try:
            cle = int(str(numero_scrutin).strip())
        except ValueError:
            continue
        resumes[cle] = {
            "resume": (entree.get("resume") or "").strip() or None,
            "expose": (entree.get("expose") or "").strip() or None,
            "url": (entree.get("url") or "").strip() or None,
        }
    journal(f"  flux resumes : {len(resumes)} scrutins enrichis")
    return resumes


def construire() -> dict:
    CACHE.mkdir(exist_ok=True)
    journal("Sources Assemblee nationale")
    zip_scrutins = telecharger(URL_SCRUTINS, CACHE / "scrutins.zip")
    zip_acteurs = telecharger(URL_ACTEURS, CACHE / "acteurs.zip")

    journal("Deputes du groupe")
    deputes = charger_deputes(zip_acteurs)
    journal(f"  {len(deputes)} deputes ayant siege au groupe")

    resumes = charger_resumes(URL_RESUMES)

    journal("Scrutins budgetaires")
    scrutins, textes = [], {}
    total, retenus, sans_groupe = 0, 0, 0

    with zipfile.ZipFile(zip_scrutins) as zf:
        for nom in zf.namelist():
            if not nom.endswith(".json"):
                continue
            total += 1
            scrutin = json.loads(zf.read(nom))["scrutin"]
            objet = (scrutin.get("objet", {}) or {}).get("libelle") or scrutin.get("titre") or ""
            classement = classer_texte(objet)
            if not classement:
                continue
            categorie_texte, annee, cle_texte = classement

            groupe = None
            organe = (scrutin.get("ventilationVotes") or {}).get("organe") or {}
            for candidat in en_liste((organe.get("groupes") or {}).get("groupe")):
                if candidat.get("organeRef") == GROUPE_UID:
                    groupe = candidat
                    break
            if groupe is None:
                sans_groupe += 1
                continue

            vote = groupe.get("vote") or {}
            decompte = vote.get("decompteNominatif") or {}
            positions = {}
            for champ, code in (("pours", POUR), ("contres", CONTRE),
                                ("abstentions", ABSTENTION), ("nonVotants", NON_VOTANT)):
                bloc = decompte.get(champ)
                if not isinstance(bloc, dict):
                    continue
                for votant in en_liste(bloc.get("votant")):
                    positions[votant["acteurRef"]] = code

            # Mises au point : declaratives, elles ne changent pas le resultat
            # proclame, mais un depute peut vouloir s'en prevaloir.
            corrections = {}
            mise_au_point = scrutin.get("miseAuPoint") or {}
            for champ, code in (("pours", POUR), ("contres", CONTRE),
                                ("abstentions", ABSTENTION), ("nonVotants", NON_VOTANT)):
                for bloc in en_liste(mise_au_point.get(champ)):
                    if not isinstance(bloc, dict):
                        continue
                    for votant in en_liste(bloc.get("votant")):
                        if votant["acteurRef"] in deputes:
                            corrections[votant["acteurRef"]] = code

            textes.setdefault(cle_texte, {
                "cle": cle_texte,
                "categorie": categorie_texte,
                "annee": annee,
                "libelle": (f"{LIBELLES_TEXTES[categorie_texte]} {annee}" if annee
                            else LIBELLES_TEXTES[categorie_texte]),
                "scrutins": 0,
            })
            textes[cle_texte]["scrutins"] += 1

            synthese = (scrutin.get("syntheseVote") or {}).get("decompte") or {}
            chiffres = vote.get("decompteVoix") or {}
            numero = int(scrutin["numero"])

            enregistrement = {
                "numero": numero,
                "uid": scrutin["uid"],
                "date": scrutin["dateScrutin"],
                "texte": cle_texte,
                "objet": objet,
                "categorie": categoriser_objet(objet),
                "article": extraire_article(objet),
                "solennel": scrutin.get("typeVote", {}).get("codeTypeVote") != "SPO",
                "sort": (scrutin.get("sort") or {}).get("code"),
                "assemblee": {
                    "pour": int(synthese.get("pour") or 0),
                    "contre": int(synthese.get("contre") or 0),
                    "abstention": int(synthese.get("abstentions") or 0),
                },
                "groupe": {
                    "position": vote.get("positionMajoritaire"),
                    "pour": int(chiffres.get("pour") or 0),
                    "contre": int(chiffres.get("contre") or 0),
                    "abstention": int(chiffres.get("abstentions") or 0),
                    "nonVotants": int(chiffres.get("nonVotants") or 0),
                },
                "positions": positions,
                "corrections": corrections,
            }
            amendement = extraire_amendement(objet)
            if amendement:
                enregistrement["amendement"] = amendement
            if numero in resumes:
                enregistrement["resume"] = resumes[numero]
            scrutins.append(enregistrement)
            retenus += 1

    journal(f"  {total} scrutins lus, {retenus} budgetaires retenus, "
            f"{sans_groupe} ecartes faute de position du groupe")

    scrutins.sort(key=lambda s: (s["date"], s["numero"]))

    # On ne garde que les deputes ayant effectivement vote au moins une fois
    # dans le perimetre, pour que les fiches ne soient jamais vides.
    actifs = {uid for s in scrutins for uid in s["positions"]}
    ordre = sorted(
        (d for uid, d in deputes.items() if uid in actifs),
        key=lambda d: (d["nom"], d["prenom"]),
    )
    index = {d["uid"]: i for i, d in enumerate(ordre)}

    # Encodage compact : une chaine par scrutin, un caractere par depute,
    # dans l'ordre du tableau « deputes ». Legende dans le README.
    for scrutin in scrutins:
        scrutin["votes"] = "".join(
            scrutin["positions"].get(d["uid"], ABSENT) for d in ordre
        )
        mep = scrutin.pop("corrections")
        scrutin["mep"] = ("".join(mep.get(d["uid"], ABSENT) for d in ordre)
                          if mep else None)
        del scrutin["positions"]

    for depute in ordre:
        rang = index[depute["uid"]]
        exprimes = sum(1 for s in scrutins if s["votes"][rang] in (POUR, CONTRE, ABSTENTION))
        presents = sum(1 for s in scrutins if s["votes"][rang] != ABSENT)
        conformes = sum(
            1 for s in scrutins
            if s["votes"][rang] in (POUR, CONTRE, ABSTENTION)
            and s["groupe"]["position"]
            and s["votes"][rang] == s["groupe"]["position"][0]
        )
        depute["statistiques"] = {
            "scrutinsExprimes": exprimes,
            "scrutinsPresents": presents,
            "conformesLigneGroupe": conformes,
        }

    return {
        "genereLe": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "legislature": LEGISLATURE,
        "source": "data.assemblee-nationale.fr",
        "groupe": {"uid": GROUPE_UID, "libelle": "Horizons & Indépendants", "sigle": "HOR"},
        "legendeVotes": {POUR: "pour", CONTRE: "contre", ABSTENTION: "abstention",
                         NON_VOTANT: "non-votant", ABSENT: "absent ou hors groupe"},
        "periode": {"debut": scrutins[0]["date"] if scrutins else None,
                    "fin": scrutins[-1]["date"] if scrutins else None},
        "resumesRaccordes": bool(URL_RESUMES),
        "textes": sorted(textes.values(), key=lambda t: (-(t["annee"] or 0), t["cle"])),
        "deputes": ordre,
        "scrutins": scrutins,
    }


def main() -> int:
    donnees = construire()
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(
        json.dumps(donnees, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    poids = SORTIE.stat().st_size
    journal(f"Ecrit {SORTIE.relative_to(RACINE)} "
            f"({poids // 1024} Ko, {len(donnees['scrutins'])} scrutins, "
            f"{len(donnees['deputes'])} deputes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
