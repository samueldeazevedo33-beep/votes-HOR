# Mettre le site en ligne

Le site est un ensemble de fichiers statiques : pas de serveur à administrer,
pas de base de données, pas de dépendance à installer. GitHub Pages les sert
directement depuis le dossier `docs/`.

## 1. Changer le mot de passe

Le mot de passe livré est `horizons2027`. Remplacez-le avant toute diffusion :

```bash
python3 scripts/mot_de_passe.py
```

Reportez l'empreinte affichée dans `docs/config.js`, puis commitez.

Ce que cette porte fait et ne fait pas mérite d'être dit clairement au groupe.
Le contrôle s'exécute dans le navigateur : quelqu'un qui connaît l'adresse du
fichier de données peut le télécharger sans passer par la porte. Comme il
s'agit de scrutins publics, republiés sous Licence Ouverte, l'enjeu n'est pas
la confidentialité mais le fait de ne pas laisser un outil interne traîner à
la vue de tous. Si le groupe veut une vraie fermeture, il faut un hébergement
avec authentification, Cloudflare Pages ou Netlify, et cela suppose
d'administrer une liste d'utilisateurs.

## 2. Activer Pages

Dans le dépôt, **Settings → Pages**, choisissez « Deploy from a branch »,
branche `main`, dossier `/docs`. L'adresse publiée est
`https://<compte>.github.io/votes-HOR/`.

La branche de développement doit donc être fusionnée dans `main` pour que le
site se mette à jour.

Ajoutez `<meta name="robots" content="noindex, nofollow">` — déjà présent dans
`docs/index.html` — suffit à tenir les moteurs de recherche à l'écart, à
condition de ne pas diffuser l'adresse publiquement.

## 3. Brancher les résumés d'amendements

Voir [BRANCHEMENT.md](BRANCHEMENT.md). Sans ce raccordement, la recherche
plein texte ne porte que sur les libellés officiels des scrutins, qui ne
décrivent pas le contenu des amendements : chercher « retraite » ou
« logement » ne renvoie rien. C'est la limite principale de l'outil en l'état.

## 4. Vérifier avant de diffuser

```bash
python3 -m http.server 8777 --directory docs     # dans un terminal
python3 scripts/test_site.py                     # dans un autre
```

Quinze vérifications couvrent la porte, les filtres, l'affichage des votes
nominatifs, la génération des éléments de langage, les fiches députés et la
mise en page sur téléphone. Le script échoue si la console du navigateur
signale la moindre erreur.

## Ce que le site n'affiche pas, et pourquoi

Les taux de présence individuels sont accompagnés d'un repère de lecture, et
jamais présentés seuls. Sur un texte budgétaire, une dizaine de députés du
groupe seulement prennent part à chaque scrutin : les séances s'étirent sur
des semaines et le groupe s'y relaie. Un taux de 15 % n'y a pas le même sens
qu'ailleurs, et l'afficher sans sa médiane de référence donnerait de
plusieurs députés une image fausse à l'intérieur même de leur groupe.

Les mises au point au sujet du vote sont affichées à part, jamais confondues
avec le vote enregistré. Elles figurent au compte rendu mais ne modifient pas
le résultat proclamé.
