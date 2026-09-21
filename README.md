# Votes budgétaires du groupe Horizons & Indépendants

Recensement des votes du groupe sur les textes financiers de la XVIIe
législature, destiné aux députés du groupe et à leurs collaborateurs en vue
du PLF 2027. Le site permet de retrouver un vote, de le replacer dans son
contexte et d'en tirer un élément de langage ou une fiche député.

## Ce que couvrent les données

Tous les scrutins publics portant sur un texte financier : lois de finances,
lois de finances de fin de gestion, lois de finances rectificatives, loi
spéciale, lois de financement de la sécurité sociale, lois de programmation
des finances publiques et lois d'approbation des comptes. À ce jour, 1 962
scrutins sur les 8 434 de la législature, et 41 députés ayant voté au moins
une fois sous l'étiquette du groupe dans ce périmètre.

Pour chaque scrutin sont conservés la date, l'objet officiel, le texte
concerné, l'article visé, le sort du vote, la position majoritaire du groupe,
le décompte du groupe, le décompte de l'Assemblée et **le vote nominatif de
chaque député**. Les mises au point au sujet du vote sont conservées à part :
elles sont déclaratives et ne modifient pas le résultat proclamé, mais un
député peut légitimement vouloir s'en prévaloir.

## Source

[data.assemblee-nationale.fr](https://data.assemblee-nationale.fr), sous
Licence Ouverte. Deux jeux sont consommés, tous deux régénérés chaque nuit
par l'Assemblée :

- `Scrutins.json.zip` — l'intégralité des scrutins publics de la législature ;
- `AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip` — pour
  l'identité des députés et leurs périodes d'appartenance au groupe.

Le groupe est identifié par `PO845470` (Horizons & Indépendants, constitué le
18 juillet 2024). Aucune saisie manuelle n'intervient : tout ce qui est
affiché vient de la source officielle ou du flux de résumés décrit ci-dessous.

## Reconstruire les données

```bash
python3 scripts/build_data.py
```

Aucune dépendance en dehors de la bibliothèque standard. Les archives sont
mises en cache dans `.cache/`, non versionné ; supprimez-le pour forcer un
retéléchargement. Le résultat est écrit dans `docs/data/votes.json`.

Pour y raccorder les résumés d'amendements, voir [docs/BRANCHEMENT.md](docs/BRANCHEMENT.md).

En production, le rafraîchissement est automatique : `.github/workflows/donnees.yml`
reconstruit le jeu de données chaque lundi matin et ne commite que si un
scrutin a bougé.

## Format de `votes.json`

Les votes nominatifs sont encodés de façon compacte. Le tableau `deputes`
fixe un ordre ; pour chaque scrutin, `votes` est une chaîne dont le caractère
de rang *i* donne le vote du député de rang *i* :

| Code | Signification |
|------|---------------|
| `p`  | pour |
| `c`  | contre |
| `a`  | abstention |
| `n`  | non-votant |
| `-`  | absent, ou n'appartenait pas au groupe à cette date |

Le champ `mep` suit exactement la même convention pour les mises au point, et
vaut `null` quand il n'y en a aucune. Cet encodage divise par près de six le
poids du fichier, ce qui compte : il est chargé intégralement par le
navigateur pour que la recherche et les filtres restent instantanés.
