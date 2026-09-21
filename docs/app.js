'use strict';

/* Extraction et mise en forme des votes de l'Assemblee nationale.
   Sans dependance ni chaine de construction : l'outil doit continuer de
   fonctionner tel quel, servi par n'importe quel hebergeur statique. */

const PAS_LISTE = 40;

// Position majoritaire d'un groupe, telle que codee par le pipeline.
const POSITIONS = ['p', 'c', 'a', 's'];

const LIBELLES = {
  p: 'Pour', c: 'Contre', a: 'Abstention',
  n: 'Non-votant', x: 'Absent', s: 'Sans position',
};

// L'ordre des segments suit la polarite : pour, neutre, contre, puis ce qui
// n'est pas une prise de position.
const SERIES = [
  { cle: 'p', variable: '--pour' },
  { cle: 'a', variable: '--abstention' },
  { cle: 'c', variable: '--contre' },
  { cle: 'n', variable: '--nonvotant' },
  { cle: 'x', variable: '--absent' },
  { cle: 's', variable: '--absent' },
];

const etat = {
  index: null,
  nominatif: null,
  rangs: [],        // indices des scrutins retenus, alignes sur le fichier nominatif
  affiches: PAS_LISTE,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const fmtLong = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtCourt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });

const dateLongue = (iso) => fmtLong.format(new Date(iso + 'T12:00:00'));
const dateCourte = (iso) => fmtCourt.format(new Date(iso + 'T12:00:00'));
const nombre = (n) => n.toLocaleString('fr-FR');

function echapper(texte) {
  return String(texte == null ? '' : texte)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normaliser(texte) {
  return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ').toLowerCase();
}

/** Les couleurs sont resolues en hexadecimal : une variable CSS ne survit pas
    a la serialisation du SVG vers une image. */
function couleurs() {
  const calcule = getComputedStyle(document.documentElement);
  const table = {};
  for (const serie of SERIES) table[serie.cle] = calcule.getPropertyValue(serie.variable).trim();
  table.texte = calcule.getPropertyValue('--texte').trim();
  table.doux = calcule.getPropertyValue('--texte-doux').trim();
  table.tenu = calcule.getPropertyValue('--texte-tenu').trim();
  table.surface = calcule.getPropertyValue('--surface').trim();
  table.bordure = calcule.getPropertyValue('--bordure').trim();
  table.accent = calcule.getPropertyValue('--accent').trim();
  return table;
}

/* ------------------------------------------------------------- Selection */

function lireSelection() {
  return {
    sujet: $('input[name="sujet"]:checked').value,
    groupe: Number($('#f-groupe').value),
    depute: $('#f-depute').value === '' ? -1 : Number($('#f-depute').value),
    perimetre: $('input[name="perimetre"]:checked').value,
    texte: $('#f-texte').value,
    debut: $('#f-debut').value,
    fin: $('#f-fin').value,
    nature: $('#f-nature').value,
    issue: $('#f-issue').value,
    recherche: normaliser($('#f-recherche').value.trim()),
  };
}

function filtrer(selection) {
  const mots = selection.recherche ? selection.recherche.split(/\s+/).filter(Boolean) : [];
  const rangs = [];
  etat.index.scrutins.forEach((scrutin, rang) => {
    if (selection.perimetre === 'texte') {
      if (selection.texte && scrutin.t !== selection.texte) return;
    } else {
      if (selection.debut && scrutin.d < selection.debut) return;
      if (selection.fin && scrutin.d > selection.fin) return;
    }
    if (selection.nature && scrutin.c !== selection.nature) return;
    if (selection.issue && scrutin.s !== selection.issue) return;
    if (mots.length) {
      if (!scrutin._i) scrutin._i = normaliser(scrutin.o);
      if (!mots.every((m) => scrutin._i.includes(m))) return;
    }
    rangs.push(rang);
  });
  return rangs;
}

/* ------------------------------------------------------------ Agregation */

/** Repartition des positions du sujet sur les scrutins retenus. */
function repartitionSujet(selection, rangs) {
  const compte = { p: 0, c: 0, a: 0, n: 0, x: 0, s: 0 };
  if (selection.sujet === 'groupe') {
    for (const rang of rangs) {
      const entree = etat.index.scrutins[rang].g[selection.groupe];
      if (!entree) continue;   // le groupe n'existait pas, ou ventilation absente
      compte[POSITIONS[entree[0]] || 's'] += 1;
    }
  } else if (etat.nominatif) {
    for (const rang of rangs) {
      const vote = etat.nominatif.votes[rang][selection.depute];
      compte[vote === '-' ? 'x' : vote] += 1;
    }
  }
  compte.total = compte.p + compte.c + compte.a + compte.n + compte.x + compte.s;
  return compte;
}

/** Une ligne par groupe, plus le depute en tete lorsqu'il est le sujet. */
function repartitionGroupes(selection, rangs) {
  const lignes = etat.index.groupes.map((groupe, indice) => {
    const compte = { p: 0, c: 0, a: 0, s: 0, total: 0 };
    for (const rang of rangs) {
      const entree = etat.index.scrutins[rang].g[indice];
      if (!entree) continue;
      compte[POSITIONS[entree[0]] || 's'] += 1;
      compte.total += 1;
    }
    return { nom: groupe.sigle, titre: groupe.libelle, compte, indice };
  }).filter((ligne) => ligne.compte.total > 0);

  if (selection.sujet === 'depute' && etat.nominatif && selection.depute >= 0) {
    const depute = etat.index.deputes[selection.depute];
    const compte = repartitionSujet(selection, rangs);
    lignes.unshift({
      nom: `${depute.prenom} ${depute.nom}`,
      titre: `${depute.prenom} ${depute.nom}`,
      compte: { p: compte.p, c: compte.c, a: compte.a, s: compte.n + compte.x, total: compte.total },
      surbrillance: true,
    });
  }
  return lignes;
}

/* ---------------------------------------------------------------- Figures */

/** Barre empilee horizontale. Un espace de 2 px separe les segments, et seuls
    ceux qui ont la place recoivent leur valeur en clair. */
function segments(compte, ordre, x, y, largeur, hauteur, teintes, unite) {
  const total = ordre.reduce((somme, cle) => somme + (compte[cle] || 0), 0);
  if (!total) return '';
  const rayon = Math.min(4, hauteur / 2);
  let curseur = x;
  const morceaux = [];
  const presents = ordre.filter((cle) => compte[cle] > 0);

  presents.forEach((cle, position) => {
    const part = compte[cle] / total;
    const brut = part * largeur;
    const espace = position < presents.length - 1 ? 2 : 0;
    const large = Math.max(brut - espace, 1);
    const premier = position === 0;
    const dernier = position === presents.length - 1;
    // Les extremites de la barre sont arrondies, les jonctions restent droites.
    const d = cheminArrondi(curseur, y, large, hauteur, premier ? rayon : 0, dernier ? rayon : 0);
    const titre = `${LIBELLES[cle]} : ${nombre(compte[cle])} ${unite}${compte[cle] > 1 ? 's' : ''} (${Math.round(part * 100)} %)`;
    morceaux.push(
      `<path d="${d}" fill="${teintes[cle]}" data-bulle="${echapper(titre)}"><title>${echapper(titre)}</title></path>`
    );
    if (brut >= 38) {
      const centre = curseur + large / 2;
      morceaux.push(
        `<text x="${centre.toFixed(1)}" y="${(y + hauteur / 2 + 4).toFixed(1)}" text-anchor="middle"` +
        ` font-size="11.5" font-weight="600" fill="${lisible(cle, teintes)}" pointer-events="none">` +
        `${Math.round(part * 100)} %</text>`
      );
    }
    curseur += brut;
  });
  return morceaux.join('');
}

/** Le texte porte une encre lisible sur son segment, jamais la couleur de serie. */
function lisible(cle, teintes) {
  return (cle === 'n' || cle === 'x' || cle === 's' || cle === 'a')
    ? teintes.texte : teintes.surface;
}

function cheminArrondi(x, y, largeur, hauteur, gauche, droite) {
  const g = Math.min(gauche, largeur / 2);
  const d = Math.min(droite, largeur / 2);
  return `M${(x + g).toFixed(1)},${y} H${(x + largeur - d).toFixed(1)}` +
    (d ? ` a${d},${d} 0 0 1 ${d},${d}` : '') +
    ` V${(y + hauteur - d).toFixed(1)}` +
    (d ? ` a${d},${d} 0 0 1 ${-d},${d}` : '') +
    ` H${(x + g).toFixed(1)}` +
    (g ? ` a${g},${g} 0 0 1 ${-g},${-g}` : '') +
    ` V${(y + g).toFixed(1)}` +
    (g ? ` a${g},${g} 0 0 1 ${g},${-g}` : '') + ' Z';
}

function legende(ordre, x, y, teintes, compte) {
  let curseur = x;
  return ordre.filter((cle) => !compte || compte[cle] > 0).map((cle) => {
    const morceau =
      `<rect x="${curseur}" y="${y - 8}" width="10" height="10" rx="2" fill="${teintes[cle]}"/>` +
      `<text x="${curseur + 15}" y="${y}" font-size="12" fill="${teintes.doux}">${LIBELLES[cle]}</text>`;
    curseur += 15 + LIBELLES[cle].length * 6.6 + 16;
    return morceau;
  }).join('');
}

const ENTETE_SVG = 'font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"';

/* Les figures sont tracees aux dimensions reelles de leur conteneur plutot
   qu'etirees depuis un gabarit fixe : une mise a l'echelle grossit aussi les
   etiquettes, qui deviennent enormes sur grand ecran et illisibles sur
   telephone. Le rendu est refait a chaque changement de largeur. */

function figureSujet(selection, rangs, L) {
  const teintes = couleurs();
  const compte = repartitionSujet(selection, rangs);
  const ordre = selection.sujet === 'depute' ? ['p', 'a', 'c', 'n', 'x'] : ['p', 'a', 'c', 's'];
  const marge = 2;
  const H = 92;
  if (!compte.total) {
    return svgRacine(L, 40, `<text x="0" y="22" font-size="13" fill="${teintes.doux}">Aucun vote sur cette sélection.</text>`);
  }
  return svgRacine(L, H,
    segments(compte, ordre, marge, 6, L - marge * 2, 36, teintes, 'scrutin') +
    legende(ordre, marge, 68, teintes, compte) +
    `<text x="${marge}" y="88" font-size="11" fill="${teintes.tenu}">${nombre(compte.total)} scrutins retenus</text>`);
}

function figureGroupes(selection, rangs, L) {
  const teintes = couleurs();
  const lignes = repartitionGroupes(selection, rangs);
  // La colonne des noms se resserre sur telephone sans jamais devenir illisible.
  const colonne = Math.round(Math.min(140, Math.max(66, L * 0.27)));
  const hauteurLigne = 26, ecart = 6;
  if (!lignes.length) {
    return svgRacine(L, 40, `<text x="0" y="22" font-size="13" fill="${teintes.doux}">Aucune ventilation par groupe sur cette sélection.</text>`);
  }
  const H = lignes.length * (hauteurLigne + ecart) + 46;
  const maxCaracteres = Math.max(6, Math.floor((colonne - 34) / 6.6));
  const barres = lignes.map((ligne, rang) => {
    const y = rang * (hauteurLigne + ecart);
    const gras = ligne.surbrillance ? ' font-weight="700"' : '';
    const nom = ligne.nom.length > maxCaracteres ? ligne.nom.slice(0, maxCaracteres - 1) + '…' : ligne.nom;
    return `<text x="0" y="${y + 17}" font-size="12"${gras} fill="${teintes.texte}">${echapper(nom)}</text>` +
      `<text x="${colonne - 10}" y="${y + 17}" font-size="11" text-anchor="end" fill="${teintes.tenu}">${nombre(ligne.compte.total)}</text>` +
      segments(ligne.compte, ['p', 'a', 'c', 's'], colonne, y + 4, L - colonne, hauteurLigne - 8, teintes, 'scrutin');
  }).join('');
  const cumul = lignes.reduce((total, ligne) => {
    for (const cle of ['p', 'a', 'c', 's']) total[cle] += ligne.compte[cle] || 0;
    return total;
  }, { p: 0, a: 0, c: 0, s: 0 });
  return svgRacine(L, H, barres +
    legende(['p', 'a', 'c', 's'], 0, H - 24, teintes, cumul) +
    `<text x="0" y="${H - 5}" font-size="11" fill="${teintes.tenu}">Le nombre en tête de ligne est le total des scrutins où le groupe avait une position.</text>`);
}

function svgRacine(largeur, hauteur, contenu) {
  return `<svg width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}" ` +
    `${ENTETE_SVG} role="img">${contenu}</svg>`;
}

/** Largeur utile d'une toile, bornee pour rester tracable avant disposition. */
function largeurToile(identifiant) {
  const element = document.getElementById(identifiant);
  return Math.max(280, Math.round(element ? element.clientWidth : 720));
}

/* ------------------------------------------------------------ Export PNG */

function titreSelection(selection, rangs) {
  const sujet = selection.sujet === 'groupe'
    ? etat.index.groupes[selection.groupe].libelle
    : (selection.depute >= 0
      ? `${etat.index.deputes[selection.depute].prenom} ${etat.index.deputes[selection.depute].nom}`
      : 'Aucun député sélectionné');
  let perimetre, phrase;
  if (selection.perimetre === 'texte' && selection.texte) {
    const texte = etat.index.textes.find((t) => t.cle === selection.texte);
    perimetre = texte ? texte.libelle : 'texte inconnu';
    // « la proposition de loi… » mais « le projet de loi… » : l'accord se lit
    // dans la nature du texte, pas dans son intitulé.
    const article = texte && /^proposition/i.test(texte.nature) ? 'la' : 'le';
    phrase = texte ? `${article} ${perimetre.charAt(0).toLowerCase() + perimetre.slice(1)}` : perimetre;
  } else if (selection.perimetre === 'periode' && (selection.debut || selection.fin)) {
    perimetre = `du ${selection.debut ? dateLongue(selection.debut) : 'début de la législature'} au ${selection.fin ? dateLongue(selection.fin) : 'dernier scrutin'}`;
    phrase = `la période allant ${perimetre}`;
  } else {
    perimetre = 'ensemble de la XVIIe législature';
    phrase = "l'ensemble de la XVIIe législature";
  }
  return { sujet, perimetre, phrase, scrutins: rangs.length };
}

const LARGEUR_EXPORT = 880;

/** L'image exportee est retracee a une largeur fixe : elle ne doit pas dependre
    de la taille de la fenetre au moment du clic. */
async function exporterPNG(idFigure) {
  const section = document.getElementById(idFigure);
  const teintes = couleurs();
  const selection = lireSelection();
  const { sujet, perimetre } = titreSelection(selection, etat.rangs);
  const titre = section.querySelector('h2').textContent;

  const dessin = idFigure === 'figure-sujet'
    ? figureSujet(selection, etat.rangs, LARGEUR_EXPORT)
    : figureGroupes(selection, etat.rangs, LARGEUR_EXPORT);
  const hauteurGraphe = Number((dessin.match(/height="(\d+)"/) || [0, 200])[1]);
  const interieur = dessin.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

  const hautTitre = 66, bas = 28, cote = 24;
  const L = LARGEUR_EXPORT + cote * 2;
  const H = hauteurGraphe + hautTitre + bas;
  const sousTitre = idFigure === 'figure-sujet' ? `${sujet} — ${perimetre}` : perimetre;

  const compose =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${L * 2}" height="${H * 2}" ` +
    `viewBox="0 0 ${L} ${H}" ${ENTETE_SVG}>` +
    `<rect width="100%" height="100%" fill="${teintes.surface}"/>` +
    `<text x="${cote}" y="28" font-size="17" font-weight="700" fill="${teintes.texte}">${echapper(titre)}</text>` +
    `<text x="${cote}" y="48" font-size="12.5" fill="${teintes.doux}">${echapper(sousTitre.length > 110 ? sousTitre.slice(0, 109) + '…' : sousTitre)}</text>` +
    `<g transform="translate(${cote},${hautTitre})">${interieur}</g>` +
    `<text x="${cote}" y="${H - 10}" font-size="10.5" fill="${teintes.tenu}">` +
    `Source : data.assemblee-nationale.fr, Licence Ouverte — données au ${dateLongue(etat.index.genereLe.slice(0, 10))}</text>` +
    '</svg>';

  const blob = new Blob([compose], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resoudre, rejeter) => {
      const img = new Image();
      img.onload = () => resoudre(img);
      img.onerror = () => rejeter(new Error('rendu impossible'));
      img.src = url;
    });
    const toile = document.createElement('canvas');
    toile.width = L * 2;
    toile.height = H * 2;
    const contexte = toile.getContext('2d');
    contexte.fillStyle = teintes.surface;
    contexte.fillRect(0, 0, toile.width, toile.height);
    contexte.drawImage(image, 0, 0, toile.width, toile.height);
    await new Promise((resoudre) => toile.toBlob((sortie) => {
      const lien = document.createElement('a');
      lien.href = URL.createObjectURL(sortie);
      lien.download = `votes-${normaliser(sujet).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.png`;
      lien.click();
      URL.revokeObjectURL(lien.href);
      resoudre();
    }, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* --------------------------------------------------------- Note et EDL */

function partDominante(compte) {
  const ordre = [['p', 'pour'], ['c', 'contre'], ['a', 'abstention']]
    .map(([cle, mot]) => ({ cle, mot, n: compte[cle] || 0 }))
    .sort((a, b) => b.n - a.n);
  return ordre[0];
}

function enumererFr(elements) {
  if (elements.length <= 1) return elements[0] || '';
  return elements.slice(0, -1).join(', ') + ' et ' + elements[elements.length - 1];
}

/** Les votes structurants d'abord, puis les plus recents. Le rang est
    conserve : le retrouver ensuite couterait un parcours complet par scrutin. */
function marquants(rangs, limite) {
  const poids = (s) => (s.c === 'ensemble du texte' ? 4 : s.c === 'motion de censure' ? 3
    : s.solennel ? 3 : s.c === 'motion de procédure' ? 2 : 1);
  return rangs.map((rang) => ({ scrutin: etat.index.scrutins[rang], rang }))
    .sort((a, b) => poids(b.scrutin) - poids(a.scrutin) || b.scrutin.d.localeCompare(a.scrutin.d))
    .slice(0, limite);
}

function positionSujet(scrutin, selection, rang) {
  if (selection.sujet === 'groupe') {
    const entree = scrutin.g[selection.groupe];
    return entree ? POSITIONS[entree[0]] : null;
  }
  if (!etat.nominatif || selection.depute < 0) return null;
  const vote = etat.nominatif.votes[rang][selection.depute];
  return vote === '-' ? 'x' : vote;
}

/** Quand la selection porte sur un texte unique, son intitule figure deja dans
    la phrase d'ouverture : le repeter a chaque vote donne un texte qui begaie.
    On ne garde alors que la lecture, qui distingue les etapes entre elles. */
function nettoyerObjet(objet, texteUnique) {
  let sortie = objet.replace(/\.$/, '').trim();
  const lecture = (sortie.match(/\((nouvelle lecture|lecture définitive|deuxième lecture|texte de la commission mixte paritaire)\)/i) || [])[1];
  sortie = sortie.replace(/\s*\((?:première lecture|nouvelle lecture|deuxième lecture|lecture définitive|texte de la commission mixte paritaire)\)\s*$/i, '');
  if (texteUnique) {
    sortie = sortie.replace(/\s+d[eu]s?\s+(?:la\s+)?(?:projet|proposition) de loi\b.*$/i, '')
                   .replace(/\s+de la proposition de résolution\b.*$/i, '')
                   .replace(/[,\s]+$/, '');
    // « l'ensemble » seul est trop elliptique une fois le texte retire.
    if (/^l['’]ensemble$/i.test(sortie)) sortie += ' du texte';
    if (lecture) sortie += ` (${lecture.toLowerCase()})`;
  }
  return sortie.trim();
}

function phraseVote(scrutin, position, nom, marque, texteUnique) {
  const objet = nettoyerObjet(scrutin.o, texteUnique);
  const verbe = position === 'a' ? `s’est abstenu${marque} sur`
    : position === 'p' ? 'a voté pour' : 'a voté contre';
  // L'accord de l'issue suit l'objet : « la motion […] rejetée ».
  const accord = /^l[ae]s\s/i.test(objet) ? 's' : /^la\s/i.test(objet) ? 'e' : '';
  const issue = (scrutin.s === 'adopté' ? 'adopté' : 'rejeté') + accord;
  const chiffres = scrutin.a[0] + scrutin.a[1] > 0
    ? ` par ${nombre(Math.max(scrutin.a[0], scrutin.a[1]))} voix contre ${nombre(Math.min(scrutin.a[0], scrutin.a[1]))}` : '';
  return `Le ${dateLongue(scrutin.d)}, ${nom} ${verbe} ${objet}, ${issue}${chiffres}.`;
}

/** Accord et reprise pronominale du sujet, groupe ou depute. */
function accordSujet(selection) {
  if (selection.sujet === 'groupe') return { pronom: 'il', marque: '' };
  const depute = etat.index.deputes[selection.depute];
  const feminin = depute && depute.civilite === 'Mme';
  return { pronom: feminin ? 'elle' : 'il', marque: feminin ? 'e' : '' };
}

function composer(registre) {
  const selection = lireSelection();
  const rangs = etat.rangs;
  if (!rangs.length) return 'La sélection ne contient aucun scrutin.';
  const { sujet, phrase } = titreSelection(selection, rangs);
  const compte = repartitionSujet(selection, rangs);
  if (!compte.total) return 'Aucun vote du sujet retenu sur cette sélection.';

  const { pronom, marque } = accordSujet(selection);
  const texteUnique = selection.perimetre === 'texte' && Boolean(selection.texte);
  const exprimes = compte.p + compte.c + compte.a;
  const dominante = partDominante(compte);
  const pourcentage = exprimes ? Math.round((dominante.n / exprimes) * 100) : 0;
  const dates = rangs.map((r) => etat.index.scrutins[r].d);
  const debut = dates[0], fin = dates[dates.length - 1];
  const periode = debut === fin ? `le ${dateLongue(debut)}`
    : `entre le ${dateLongue(debut)} et le ${dateLongue(fin)}`;

  const paragraphes = [];

  if (registre === 'note') {
    paragraphes.push(
      `Sur ${phrase}, ${sujet} s’est prononcé${marque} sur ${nombre(exprimes)} ` +
      `scrutin${exprimes > 1 ? 's' : ''} public${exprimes > 1 ? 's' : ''}, ${periode}. ` +
      `Les votes se répartissent en ${nombre(compte.p)} pour, ${nombre(compte.c)} contre et ` +
      `${nombre(compte.a)} abstention${compte.a > 1 ? 's' : ''}` +
      (selection.sujet === 'depute'
        ? `, sur ${nombre(compte.total)} scrutins ouverts à son vote.`
        : '.')
    );

    // On donne l'amplitude reelle des positions plutot qu'un commentaire sur
    // ce qu'elle signifierait.
    const lignes = repartitionGroupes(selection, rangs)
      .filter((l) => !l.surbrillance && l.compte.total >= 5);
    if (lignes.length > 2) {
      const part = (l) => l.compte.p / l.compte.total;
      const trie = lignes.slice().sort((a, b) => part(b) - part(a));
      const plus = trie[0], moins = trie[trie.length - 1];
      paragraphes.push(
        `Sur le même périmètre, la part de votes favorables s’échelonne de ` +
        `${Math.round(part(plus) * 100)} % pour ${plus.titre} à ` +
        `${Math.round(part(moins) * 100)} % pour ${moins.titre}, rapportée aux scrutins ` +
        `où chaque groupe avait une position.`
      );
    }
  } else {
    const verbe = dominante.mot === 'abstention'
      ? `a choisi l’abstention` : `a voté ${dominante.mot}`;
    paragraphes.push(
      `Sur ${phrase}, ${sujet} ${verbe} dans ${pourcentage} % des scrutins où ` +
      `${pronom} s’est prononcé${marque} : ${nombre(dominante.n)} votes sur ${nombre(exprimes)}, ${periode}.`
    );
  }

  const choisis = marquants(rangs, registre === 'note' ? 5 : 3)
    .map((e) => ({ ...e, position: positionSujet(e.scrutin, selection, e.rang) }))
    .filter((e) => e.position && 'pca'.includes(e.position));
  if (choisis.length) {
    const phrases = choisis.map((e, rang) => phraseVote(
      e.scrutin, e.position,
      rang === 0 ? sujet : pronom,
      marque, texteUnique
    ));
    paragraphes.push(phrases.join(' '));
  }

  paragraphes.push(
    `Source : scrutins publics de l’Assemblée nationale, XVIIe législature, ` +
    `données arrêtées au ${dateLongue(etat.index.genereLe.slice(0, 10))}.`
  );
  return paragraphes.join('\n\n');
}

/* ------------------------------------------------------------- Rendu */

function tableauRepartition(compte, ordre, unite) {
  const total = ordre.reduce((s, cle) => s + (compte[cle] || 0), 0) || 1;
  return '<table><thead><tr><th>Position</th><th>' + unite + '</th><th>Part</th></tr></thead><tbody>' +
    ordre.filter((cle) => compte[cle] > 0).map((cle) =>
      `<tr><td>${LIBELLES[cle]}</td><td>${nombre(compte[cle])}</td><td>${Math.round((compte[cle] / total) * 100)} %</td></tr>`
    ).join('') + '</tbody></table>';
}

function ligneScrutin(scrutin, selection, rang) {
  const position = positionSujet(scrutin, selection, rang);
  const classe = position && 'pca'.includes(position) ? position : '';
  const lien = `https://www.assemblee-nationale.fr/dyn/${etat.index.legislature}/scrutins/${scrutin.n}`;
  return `<li class="scrutin ${classe}">
    <div class="scrutin-haut">
      <span>${dateCourte(scrutin.d)}</span><span>·</span>
      <span>n°&nbsp;${scrutin.n}</span><span>·</span>
      <span class="puce">${echapper(scrutin.c)}</span>
      <span class="puce ${classe}">${position ? LIBELLES[position] : 'Sans position'}</span>
      ${scrutin.solennel ? '<span class="puce">Solennel</span>' : ''}
    </div>
    <p class="scrutin-objet">${echapper(scrutin.o)}</p>
    <div class="scrutin-bas">
      <span>${scrutin.s === 'adopté' ? 'Adopté' : 'Rejeté'} — Assemblée&nbsp;: ${nombre(scrutin.a[0])} pour, ${nombre(scrutin.a[1])} contre</span>
      <a href="${lien}" rel="noopener" target="_blank">Détail sur le site de l’Assemblée</a>
    </div>
  </li>`;
}

function rendre() {
  const selection = lireSelection();
  etat.rangs = filtrer(selection);
  const rangs = etat.rangs;
  const { sujet, perimetre } = titreSelection(selection, rangs);

  const inconnus = rangs.filter((r) => etat.index.scrutins[r].gInconnu).length;
  $('#compte').innerHTML =
    `<strong>${nombre(rangs.length)}</strong> scrutin${rangs.length > 1 ? 's' : ''} retenu${rangs.length > 1 ? 's' : ''}` +
    ` sur ${nombre(etat.index.scrutins.length)}` +
    (inconnus ? ` · ${nombre(inconnus)} sans ventilation par groupe publiée` : '');

  $('#titre-sujet').textContent = selection.sujet === 'groupe'
    ? 'Répartition des positions du groupe' : 'Répartition des votes du député';
  $('#sous-sujet').textContent = `${sujet} — ${perimetre}`;
  $('#sous-groupes').textContent = perimetre;

  const attenteDepute = selection.sujet === 'depute' && !etat.nominatif;
  $('#toile-sujet').innerHTML = attenteDepute
    ? '<p class="figure-sous">Chargement des votes nominatifs…</p>'
    : figureSujet(selection, rangs, largeurToile('toile-sujet'));
  $('#toile-groupes').innerHTML = figureGroupes(selection, rangs, largeurToile('toile-groupes'));

  const compte = repartitionSujet(selection, rangs);
  const ordre = selection.sujet === 'depute' ? ['p', 'a', 'c', 'n', 'x'] : ['p', 'a', 'c', 's'];
  $('#table-sujet').innerHTML = compte.total ? tableauRepartition(compte, ordre, 'Scrutins') : '';
  $('#table-groupes').innerHTML =
    '<table><thead><tr><th>Groupe</th><th>Pour</th><th>Abstention</th><th>Contre</th><th>Scrutins</th></tr></thead><tbody>' +
    repartitionGroupes(selection, rangs).map((l) =>
      `<tr><td>${echapper(l.titre)}</td><td>${nombre(l.compte.p)}</td><td>${nombre(l.compte.a)}</td>` +
      `<td>${nombre(l.compte.c)}</td><td>${nombre(l.compte.total)}</td></tr>`).join('') +
    '</tbody></table>';

  const liste = $('#liste');
  if (!rangs.length) {
    liste.innerHTML = '<li class="vide">Aucun scrutin ne correspond à cette sélection.</li>';
    $('#btn-plus').hidden = true;
  } else {
    const ordreListe = rangs.slice().reverse();
    liste.innerHTML = ordreListe.slice(0, etat.affiches)
      .map((rang) => ligneScrutin(etat.index.scrutins[rang], selection, rang)).join('');
    const reste = ordreListe.length - etat.affiches;
    $('#btn-plus').hidden = reste <= 0;
    if (reste > 0) $('#btn-plus').textContent = `Afficher la suite (${nombre(reste)})`;
  }
}

/* --------------------------------------------------------- Chargement */

async function chargerNominatif() {
  if (etat.nominatif) return;
  const reponse = await fetch('data/nominatif.json');
  if (!reponse.ok) throw new Error(`votes nominatifs indisponibles (${reponse.status})`);
  etat.nominatif = await reponse.json();
}

function remplirSelecteurs() {
  const index = etat.index;

  $('#f-groupe').innerHTML = index.groupes
    .map((g, i) => `<option value="${i}">${echapper(g.libelle)} (${nombre(g.membres)} députés)</option>`).join('');
  const horizons = index.groupes.findIndex((g) => g.sigle === 'HOR');
  $('#f-groupe').value = String(horizons >= 0 ? horizons : 0);

  $('#f-depute').innerHTML = '<option value="">Choisir un député</option>' + index.deputes
    .map((d, i) => `<option value="${i}">${echapper(d.nom)} ${echapper(d.prenom)} — ${echapper((index.groupes.find((g) => g.uid === d.groupe) || {}).sigle || '')}</option>`)
    .join('');

  const textes = index.textes.slice().sort((a, b) => b.scrutins - a.scrutins);
  $('#f-texte').innerHTML = '<option value="">Tous les textes</option>' + textes
    .map((t) => `<option value="${echapper(t.cle)}">${echapper(t.libelle)} (${nombre(t.scrutins)})</option>`).join('');

  const natures = Array.from(new Set(index.scrutins.map((s) => s.c))).sort();
  $('#f-nature').innerHTML = '<option value="">Toutes</option>' +
    natures.map((n) => `<option value="${echapper(n)}">${echapper(n)}</option>`).join('');

  $('#f-debut').min = $('#f-fin').min = index.periode.debut;
  $('#f-debut').max = $('#f-fin').max = index.periode.fin;
  $('#f-debut').value = index.periode.debut;
  $('#f-fin').value = index.periode.fin;

  $('#entete-resume').textContent =
    `${nombre(index.scrutins.length)} scrutins publics de la XVIIe législature, du ${dateLongue(index.periode.debut)} ` +
    `au ${dateLongue(index.periode.fin)} · ${nombre(index.deputes.length)} députés · ${index.groupes.length} groupes · ` +
    `${nombre(index.textes.length)} textes`;
  $('#pied-maj').textContent = `Données reconstruites le ${dateLongue(index.genereLe.slice(0, 10))}.`;
}

function ouvrirModale(titre, note, texte) {
  $('#modale-titre').textContent = titre;
  $('#modale-note').textContent = note;
  $('#modale-texte').value = texte;
  $('#copie-ok').hidden = true;
  $('#modale').hidden = false;
}

function installerEvenements() {
  const relancer = () => { etat.affiches = PAS_LISTE; rendre(); };

  $$('input[name="sujet"]').forEach((bouton) => bouton.addEventListener('change', async () => {
    const depute = $('input[name="sujet"]:checked').value === 'depute';
    $('#f-groupe').hidden = depute;
    $('#f-depute').hidden = !depute;
    $('#lab-sujet').textContent = depute ? 'Député' : 'Groupe';
    $('#lab-sujet').setAttribute('for', depute ? 'f-depute' : 'f-groupe');
    if (depute && $('#f-depute').value === '') $('#f-depute').selectedIndex = 1;
    relancer();
    if (depute) {
      try { await chargerNominatif(); } catch (erreur) {
        $('#toile-sujet').innerHTML = `<p class="figure-sous">${echapper(erreur.message)}</p>`;
        return;
      }
      rendre();
    }
  }));

  $$('input[name="perimetre"]').forEach((bouton) => bouton.addEventListener('change', () => {
    const periode = $('input[name="perimetre"]:checked').value === 'periode';
    $('#bloc-texte').hidden = periode;
    $('#bloc-periode').hidden = !periode;
    relancer();
  }));

  ['#f-groupe', '#f-depute', '#f-texte', '#f-debut', '#f-fin', '#f-nature', '#f-issue']
    .forEach((sel) => $(sel).addEventListener('change', relancer));

  let minuteur;
  $('#f-recherche').addEventListener('input', () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(relancer, 180);
  });

  $('#btn-plus').addEventListener('click', () => { etat.affiches += PAS_LISTE; rendre(); });

  $('#btn-reset').addEventListener('click', () => {
    $('#f-texte').value = '';
    $('#f-nature').value = '';
    $('#f-issue').value = '';
    $('#f-recherche').value = '';
    $('#f-debut').value = etat.index.periode.debut;
    $('#f-fin').value = etat.index.periode.fin;
    relancer();
  });

  $$('[data-png]').forEach((bouton) => bouton.addEventListener('click', () => {
    exporterPNG(bouton.dataset.png).catch(() => {
      alert('Le navigateur n’a pas pu produire l’image. Une capture d’écran reste possible.');
    });
  }));

  $('#btn-note').addEventListener('click', () => ouvrirModale(
    'Note', 'Descriptive et neutre, pour un dossier ou une fiche de travail. Relisez avant diffusion.',
    composer('note')));
  $('#btn-edl').addEventListener('click', () => ouvrirModale(
    'Élément de langage', 'Écrit pour être repris à l’oral ou dans un communiqué. Relisez avant diffusion.',
    composer('edl')));

  $('#btn-copier').addEventListener('click', async () => {
    const champ = $('#modale-texte');
    try { await navigator.clipboard.writeText(champ.value); }
    catch (_) { champ.select(); document.execCommand('copy'); }
    $('#copie-ok').hidden = false;
  });

  $('#btn-telecharger').addEventListener('click', () => {
    const blob = new Blob([$('#modale-texte').value], { type: 'text/plain;charset=utf-8' });
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(blob);
    lien.download = `votes-${new Date().toISOString().slice(0, 10)}.txt`;
    lien.click();
    URL.revokeObjectURL(lien.href);
  });

  document.addEventListener('click', (evenement) => {
    if (evenement.target.closest('[data-fermer]')) $('#modale').hidden = true;
  });
  document.addEventListener('keydown', (evenement) => {
    if (evenement.key === 'Escape') $('#modale').hidden = true;
  });

  // Les figures sont tracees en pixels reels : un changement de largeur impose
  // de les retracer, sans quoi elles resteraient a l'ancienne dimension.
  let largeurConnue = window.innerWidth;
  let attenteRedimension;
  window.addEventListener('resize', () => {
    if (window.innerWidth === largeurConnue) return;
    largeurConnue = window.innerWidth;
    clearTimeout(attenteRedimension);
    attenteRedimension = setTimeout(rendre, 150);
  });

  // Infobulle : la cible survolee est plus grande que la marque elle-meme.
  const bulle = $('#infobulle');
  document.addEventListener('mousemove', (evenement) => {
    const cible = evenement.target.closest('[data-bulle]');
    if (!cible) { bulle.hidden = true; return; }
    bulle.textContent = cible.dataset.bulle;
    bulle.hidden = false;
    const largeur = bulle.offsetWidth;
    bulle.style.left = `${Math.min(evenement.clientX + 12, window.innerWidth - largeur - 8)}px`;
    bulle.style.top = `${evenement.clientY + 16}px`;
  });
}

async function demarrer() {
  const reponse = await fetch('data/index.json');
  if (!reponse.ok) throw new Error(`Chargement des données impossible (${reponse.status})`);
  etat.index = await reponse.json();
  remplirSelecteurs();
  installerEvenements();
  $('#app').hidden = false;
  rendre();
}

demarrer().catch((erreur) => {
  $('#entete-resume').textContent = erreur.message;
});
