# Mettre le site en ligne

Le site est un ensemble de fichiers statiques : pas de serveur à administrer,
pas de base de données, pas de dépendance à installer. GitHub Pages les sert
directement depuis le dossier `docs/`.

## Publier

Dans le dépôt, **Settings → Pages**, choisir « Deploy from a branch », branche
`main`, dossier `/docs`. L'adresse publiée est
`https://<compte>.github.io/votes-HOR/`. La branche de développement doit donc
être fusionnée dans `main` pour que le site se mette à jour.

L'outil est public et sans mot de passe. C'est cohérent avec sa destination :
une porte commune à 577 députés et à leurs collaborateurs ne protège rien, et
les scrutins publics sont des données publiques, republiées ici sous Licence
Ouverte.

## Poids des données

`index.json` pèse 4,8 Mo et `nominatif.json` 5,4 Mo, respectivement 440 et
620 Ko une fois compressés — GitHub Pages sert le gzip d'office. Le second
n'est téléchargé que lorsqu'on choisit un député comme sujet.

## Vérifier avant de diffuser

```bash
python3 scripts/verifier_donnees.py              # invariants des données
python3 -m http.server 8777 --directory docs     # dans un terminal
python3 scripts/test_site.py                     # dans un autre
```

Le premier contrôle la cohérence interne des fichiers produits, dont
l'alignement des indices entre votes nominatifs et liste des députés : un
décalage y attribuerait à chacun le vote de son voisin sans qu'aucun écran ne
le signale.

Le second pilote un vrai navigateur et couvre le chargement, les deux sujets,
les deux périmètres, les figures, les tableaux de secours, la rédaction de la
note et de l'élément de langage, l'export PNG et la mise en page sur téléphone.
Il échoue si la console du navigateur signale la moindre erreur. Il demande
`pip install playwright && playwright install chromium`.

## Ce que le site n'affiche pas, et pourquoi

Aucun taux de présence individuel. Sur un texte long, une dizaine de députés
par groupe seulement prennent part à chaque scrutin : les séances s'étirent sur
des semaines et les groupes s'y relaient. Un taux brut n'y mesure pas
l'assiduité et donnerait de plusieurs députés une image fausse. Les absences
apparaissent dans la répartition d'un député, où elles sont rapportées au
nombre de scrutins ouverts à son vote, jamais converties en indicateur.

Aucun indicateur de cohésion ou de loyauté de groupe. Le même raisonnement
s'applique : ces chiffres se retournent aisément contre celui qu'ils décrivent,
et l'outil est destiné à tous les groupes.
