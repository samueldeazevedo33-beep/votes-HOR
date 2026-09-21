# Votes à l'Assemblée nationale

Outil d'extraction et de mise en forme des votes de la XVIIe législature,
destiné aux députés et à leurs collaborateurs, tous groupes confondus. On y
choisit un sujet — un groupe ou un député —, un périmètre — un texte ou une
période —, et l'on en tire un visuel, une note ou un élément de langage.

## Ce que couvrent les données

L'intégralité des scrutins publics de la législature : 8 434 scrutins entre le
8 octobre 2024 et le 21 juillet 2026, 645 députés ayant pris part à au moins un
vote, 14 groupes et 256 textes identifiés. Pour chaque scrutin sont conservés la
date, l'objet officiel, le texte débattu, la lecture, l'article visé, le numéro
et l'auteur de l'amendement lorsqu'il y en a un, le sort du vote, la synthèse de
l'Assemblée, le décompte de chaque groupe et le vote nominatif de chaque député.

Trente scrutins ne se rattachent à aucun texte : ce sont les motions de censure,
les déclarations du Gouvernement et les demandes de suspension de séance.

## Source

[data.assemblee-nationale.fr](https://data.assemblee-nationale.fr), sous Licence
Ouverte. Deux jeux sont consommés, tous deux régénérés chaque nuit par
l'Assemblée : `Scrutins.json.zip` pour les scrutins, et
`AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip` pour
l'identité des députés et leurs appartenances de groupe. Aucune saisie manuelle
n'intervient.

## Reconstruire et vérifier

```bash
python3 scripts/build_data.py        # produit docs/data/
python3 scripts/verifier_donnees.py  # contrôle les invariants
```

Aucune dépendance en dehors de la bibliothèque standard. Les archives sont mises
en cache dans `.cache/`, non versionné ; supprimez-le pour forcer un
retéléchargement. En production, `.github/workflows/donnees.yml` reconstruit le
jeu chaque lundi matin et ne commite que si un scrutin a bougé.

Pour vérifier le site lui-même, voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Format des données

Deux fichiers, séparés selon l'usage : consulter un groupe ne demande que le
premier, et le second n'est téléchargé que lorsqu'on descend au niveau d'un
député.

`docs/data/index.json` porte les groupes, les députés, les textes et les
scrutins. Les clés y sont abrégées parce qu'elles se répètent 8 434 fois :
`n` numéro, `d` date, `t` clé du texte, `o` objet, `c` catégorie, `s` sort,
`a` synthèse de l'Assemblée `[pour, contre, abstention]`, `g` décomptes par
groupe. `g` est un tableau aligné sur `groupes`, chaque entrée valant `null` ou
`[position, pour, contre, abstention, non-votants]`, la position étant codée
`0` pour, `1` contre, `2` abstention, `3` sans position.

`docs/data/nominatif.json` porte les votes nominatifs. Pour chaque scrutin,
`votes` est une chaîne dont le caractère de rang *i* donne le vote du député de
rang *i* dans le tableau `deputes` :

| Code | Signification |
|------|---------------|
| `p`  | pour |
| `c`  | contre |
| `a`  | abstention |
| `n`  | non-votant |
| `-`  | absent, ou n'appartenait à aucun groupe à cette date |

Cet encodage divise par près de six le poids du fichier, ce qui compte : il est
chargé intégralement par le navigateur pour que les filtres restent instantanés.

## Partis pris

**Les décomptes par groupe sont recopiés de la source, jamais recalculés.**
Les reconstituer à partir des votes nominatifs et des dates d'appartenance
donne un résultat identique sur 8 346 scrutins et divergent sur 88. Un outil
public ne doit pas introduire cet écart.

**Quatorze scrutins portent une ventilation par groupe incomplète.** La source
y inscrit `PO0` à la place de l'identifiant de groupe, parfois pour une partie
seulement des groupes. Leurs votes nominatifs sont conservés, et l'écran signale
que la répartition par groupe n'est pas publiée, plutôt que d'afficher des
colonnes qui ne totalisent pas.

**Les mises au point au sujet du vote ne sont pas reprises.** Elles figurent au
compte rendu mais ne modifient pas le résultat proclamé.

**La palette est validée pour la vision des couleurs.** Bleu pour, rouge contre,
gris neutre pour l'abstention. Le vert et rouge plus conventionnel en politique
serait illisible en deutéranopie ; le bleu et rouge conserve un écart suffisant,
et chaque segment porte en outre son pourcentage en clair.
