#!/usr/bin/env python3
"""Controles de coherence sur les fichiers produits par build_data.py.

Ces invariants protegent d'erreurs silencieuses : un decalage d'indice entre
les votes nominatifs et la liste des deputes attribuerait a chacun le vote de
son voisin sans qu'aucun ecran ne le signale.
"""

import json
import sys
from collections import Counter
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
echecs = []


def verifier(condition, message):
    print(f"  {'ok   ' if condition else 'ECHEC'} {message}")
    if not condition:
        echecs.append(message)


def main() -> int:
    index = json.loads((RACINE / "docs/data/index.json").read_text(encoding="utf-8"))
    nominatif = json.loads((RACINE / "docs/data/nominatif.json").read_text(encoding="utf-8"))

    scrutins, deputes, groupes = index["scrutins"], index["deputes"], index["groupes"]
    votes = nominatif["votes"]

    print("Structure")
    verifier(len(votes) == len(scrutins), "un vecteur de votes par scrutin")
    verifier(nominatif["ordre"] == [s["n"] for s in scrutins],
             "les deux fichiers rangent les scrutins dans le meme ordre")
    verifier(all(len(v) == len(deputes) for v in votes),
             "chaque vecteur a exactement un caractere par depute")
    verifier(all(len(s["g"]) == len(groupes) for s in scrutins),
             "chaque scrutin porte un decompte par groupe")
    verifier(len({s["n"] for s in scrutins}) == len(scrutins), "numeros de scrutin uniques")
    verifier(all(scrutins[i]["d"] <= scrutins[i + 1]["d"] for i in range(len(scrutins) - 1)),
             "scrutins ordonnes par date")

    print("\nCoherence des decomptes")
    ventiles = [r for r, s in enumerate(scrutins) if not s.get("gInconnu")]
    ecarts_groupe = 0
    for rang in ventiles:
        attendu = Counter()
        for entree in scrutins[rang]["g"]:
            if entree:
                attendu["p"] += entree[1]; attendu["c"] += entree[2]; attendu["a"] += entree[3]
        if attendu != Counter(c for c in votes[rang] if c in "pca"):
            ecarts_groupe += 1
    verifier(ecarts_groupe == 0,
             f"les votes nominatifs totalisent les decomptes de groupe ({ecarts_groupe} ecarts "
             f"sur {len(ventiles)} scrutins ventiles)")

    sans_ventilation = len(scrutins) - len(ventiles)
    verifier(sans_ventilation <= 15,
             f"ventilation par groupe incomplete sur {sans_ventilation} scrutins au plus (source)")
    verifier(all(any(c != "-" for c in votes[r]) for r, s in enumerate(scrutins) if s.get("gInconnu")),
             "les scrutins sans ventilation conservent leurs votes nominatifs")

    # L'Assemblee proclame parfois un resultat que ses propres votes nominatifs
    # ne totalisent pas. On ne corrige pas la source, on borne l'ecart.
    ecarts_assemblee = []
    for rang, s in enumerate(scrutins):
        compte = Counter(votes[rang])
        if (compte["p"], compte["c"]) != (s["a"][0], s["a"][1]):
            ecarts_assemblee.append(s["n"])
    verifier(len(ecarts_assemblee) <= 2,
             f"synthese officielle et votes nominatifs concordent, hors incoherences de la "
             f"source ({len(ecarts_assemblee)} : {ecarts_assemblee})")

    print("\nReferences")
    cles = {t["cle"] for t in index["textes"]}
    orphelins = [s["n"] for s in scrutins if s["t"] and s["t"] not in cles]
    verifier(not orphelins, f"aucun scrutin ne renvoie a un texte inconnu ({len(orphelins)})")
    sans_texte = [s for s in scrutins if not s["t"]]
    attendu = {"motion de censure", "déclaration du Gouvernement", "suspension de séance",
               "organisation des travaux"}
    verifier(all(s["c"] in attendu for s in sans_texte),
             f"les scrutins sans texte sont tous des scrutins de procedure ({len(sans_texte)})")
    verifier(sum(t["scrutins"] for t in index["textes"]) + len(sans_texte) == len(scrutins),
             "les compteurs par texte totalisent l'ensemble des scrutins")

    print("\nDeputes")
    verifier(all(d.get("groupe") for d in deputes), "chaque depute a un groupe de rattachement")
    jamais = [d for rang, d in enumerate(deputes)
              if all(v[rang] == "-" for v in votes)]
    verifier(not jamais, f"aucun depute sans le moindre vote ({len(jamais)})")

    print(f"\n{len(scrutins)} scrutins, {len(deputes)} deputes, {len(groupes)} groupes, "
          f"{len(index['textes'])} textes")
    if echecs:
        print(f"{len(echecs)} controle(s) en echec.")
        return 1
    print("Tous les controles passent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
