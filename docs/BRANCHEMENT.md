# Raccorder les résumés d'amendements

Le site fonctionne seul, sur les seules données de l'Assemblée. Les résumés
produits par l'outil Apps Script viennent l'enrichir, sans jamais en devenir
une dépendance : le raccordement se fait au moment de la reconstruction
hebdomadaire, pas à l'ouverture du site. Si le flux est indisponible ce
jour-là, la reconstruction se poursuit et les résumés du cycle précédent
restent en place.

## Le contrat

Le flux renvoie du JSON, soit un tableau d'entrées, soit un objet
`{"amendements": [...]}`. Une entrée est retenue dès lors qu'elle porte un
numéro de scrutin ; tout le reste est facultatif.

| Champ | Rôle |
|-------|------|
| `scrutin` | **Obligatoire.** Numéro du scrutin public, entier. C'est la clé de jointure. |
| `resume` | Le résumé en une ou deux phrases, tel qu'il s'affichera sous l'objet du scrutin. |
| `expose` | Un texte plus long, affiché seulement au dépli. |
| `url` | Lien vers la fiche de l'amendement, s'il y en a une. |

La jointure se fait sur le numéro de scrutin et sur lui seul. C'est
délibéré : il est public, stable, et votre outil le détient déjà. Tenter de
rapprocher les deux bases sur le numéro d'amendement obligerait à analyser le
libellé littéraire du scrutin et produirait des faux positifs, notamment sur
les séries d'amendements identiques.

## Le script à déployer

Dans votre projet Apps Script, ajoutez cette fonction puis déployez-la en
application web. Ajustez les trois constantes du haut à votre feuille.

```javascript
const FEUILLE = 'Amendements';   // nom de l'onglet
const COLONNES = {
  scrutin: 'Scrutin',            // intitulés exacts de vos colonnes,
  resume:  'Résumé',             // en première ligne de l'onglet
  expose:  'Exposé',
  url:     'Lien',
};

function doGet() {
  const onglet = SpreadsheetApp.getActive().getSheetByName(FEUILLE);
  const lignes = onglet.getDataRange().getValues();
  const entetes = lignes.shift();
  const rang = {};
  for (const [cle, intitule] of Object.entries(COLONNES)) {
    rang[cle] = entetes.indexOf(intitule);
  }

  const amendements = [];
  for (const ligne of lignes) {
    const scrutin = rang.scrutin >= 0 ? ligne[rang.scrutin] : '';
    if (scrutin === '' || scrutin === null) continue;   // pas de scrutin, pas de jointure
    const entree = { scrutin: Number(String(scrutin).trim()) };
    if (!Number.isFinite(entree.scrutin)) continue;
    for (const cle of ['resume', 'expose', 'url']) {
      if (rang[cle] >= 0 && ligne[rang[cle]]) {
        entree[cle] = String(ligne[rang[cle]]).trim();
      }
    }
    amendements.push(entree);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ amendements }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Au déploiement, choisissez « Exécuter en tant que : moi » et « Qui a accès :
toute personne disposant du lien ». Le flux ne contient que des résumés
d'amendements publics, mais l'URL reste à traiter comme un secret : elle
donne accès en lecture à ce que renvoie le script, et à rien d'autre.

## Le branchement

Vérifiez d'abord le flux à la main :

```bash
curl -sL "VOTRE_URL_DE_DEPLOIEMENT" | head -c 500
```

Puis reconstruisez en local pour contrôler le nombre de scrutins enrichis :

```bash
AMENDEMENTS_FEED_URL="VOTRE_URL_DE_DEPLOIEMENT" python3 scripts/build_data.py
```

La sortie annonce `flux resumes : N scrutins enrichis`. Si N vaut zéro alors
que le flux répond, c'est que les numéros de scrutin ne correspondent pas :
comparez quelques valeurs de votre colonne `Scrutin` avec les numéros présents
dans `docs/data/votes.json`.

Une fois le résultat satisfaisant, enregistrez l'URL dans le dépôt sous
**Settings → Secrets and variables → Actions → New repository secret**, avec
pour nom `AMENDEMENTS_FEED_URL`. Le rafraîchissement hebdomadaire la reprendra
automatiquement. Elle n'apparaît alors nulle part dans le dépôt ni dans le
site publié.
