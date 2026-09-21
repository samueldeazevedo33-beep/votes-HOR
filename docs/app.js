'use strict';

/* Outil de consultation des votes budgétaires du groupe Horizons & Indépendants.
   Sans dépendance externe : il doit continuer de fonctionner tel quel dans
   plusieurs années, sans réinstallation ni chaîne de construction. */

const PAS_AFFICHAGE = 60;
const CLE_SESSION = 'votes-hor-ouvert';

const LIBELLE_VOTE = { p: 'pour', c: 'contre', a: 'abstention', n: 'non-votant', '-': 'absent' };
const LIBELLE_CATEGORIE = {
  ensemble: 'Vote sur l’ensemble',
  motion: 'Motion',
  article: 'Article',
  amendement: 'Amendement',
  'sous-amendement': 'Sous-amendement',
  autre: 'Autre',
};

const etat = {
  donnees: null,
  vue: 'scrutins',
  affiches: PAS_AFFICHAGE,
  deplies: new Set(),
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------------------------------------------------------------- Outils */

const formateurDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const formateurCourt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function dateLongue(iso) { return formateurDate.format(new Date(iso + 'T12:00:00')); }
function dateCourte(iso) { return formateurCourt.format(new Date(iso + 'T12:00:00')); }

function nombre(n) { return n.toLocaleString('fr-FR'); }

function ordinal(n) { return Number(n) === 1 ? '1\u02b3\u1d49' : `${n}\u1d49`; }

/** Le libelle de circonscription, ou une chaine vide si la source ne la donne pas. */
function libelleCirco(depute) {
  const c = depute.circonscription;
  if (!c) return '';
  return c.circo ? `${c.departement} \u2014 ${ordinal(c.circo)} circonscription` : c.departement;
}

function echapper(texte) {
  const d = document.createElement('div');
  d.textContent = texte == null ? '' : String(texte);
  return d.innerHTML;
}

/** Normalise pour la recherche : sans accents, sans casse, sans apostrophe typographique. */
function normaliser(texte) {
  return String(texte || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase();
}

function voteDe(scrutin, rangDepute) {
  return scrutin.votes[rangDepute] || '-';
}

/** Un écart suppose un vote exprimé, et une position de groupe à laquelle se comparer. */
function estEcart(scrutin, rangDepute) {
  const v = voteDe(scrutin, rangDepute);
  if (!'pca'.includes(v) || !scrutin.groupe.position) return false;
  return v !== scrutin.groupe.position[0];
}

/** Les votes dont on communique : les votes structurants, et ceux qui ont
    effectivement modifie le texte avec le soutien du groupe. Un rejet conforme
    a la position du groupe est l'ordinaire du debat budgetaire, pas un fait
    marquant : l'y inclure noierait les quelques centaines de votes qui comptent
    sous les milliers qui n'en disent rien. */
function estMarquant(scrutin) {
  if (scrutin.solennel) return true;
  if (scrutin.categorie === 'ensemble' || scrutin.categorie === 'motion') return true;
  return scrutin.sort === 'adopté' && scrutin.groupe.position === 'pour';
}

/** Les votes structurants passent devant, puis les plus récents. */
function parImportance(a, b) {
  const poids = (s) => (s.categorie === 'ensemble' ? 3 : s.categorie === 'motion' ? 2 : s.solennel ? 2 : 1);
  return poids(b) - poids(a) || b.date.localeCompare(a.date) || b.numero - a.numero;
}

/* ------------------------------------------------------------- Ouverture */

async function empreinte(texte) {
  const octets = new TextEncoder().encode(texte);
  const brut = await crypto.subtle.digest('SHA-256', octets);
  return Array.from(new Uint8Array(brut)).map((o) => o.toString(16).padStart(2, '0')).join('');
}

function installerPorte() {
  const porte = $('#porte');
  porte.hidden = false;
  $('#porte-mdp').focus();
  $('#porte-form').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const saisie = $('#porte-mdp').value;
    if (await empreinte(saisie) === window.CONFIG.empreinteMotDePasse) {
      try { sessionStorage.setItem(CLE_SESSION, '1'); } catch (_) { /* navigation privée */ }
      porte.hidden = true;
      demarrer();
    } else {
      $('#porte-erreur').hidden = false;
      $('#porte-mdp').select();
    }
  });
}

/* ------------------------------------------------------------- Filtrage */

function lireFiltres() {
  return {
    recherche: normaliser($('#f-recherche').value.trim()),
    texte: $('#f-texte').value,
    categorie: $('#f-categorie').value,
    position: $('#f-position').value,
    sort: $('#f-sort').value,
    depute: $('#f-depute').value,
    marquants: $('#f-marquants').checked,
    ecarts: $('#f-ecarts').checked,
  };
}

function filtrer() {
  const f = lireFiltres();
  const rang = f.depute ? Number(f.depute) : -1;
  const mots = f.recherche ? f.recherche.split(/\s+/).filter(Boolean) : [];

  return etat.donnees.scrutins.filter((s) => {
    if (f.texte && s.texte !== f.texte) return false;
    if (f.categorie && s.categorie !== f.categorie) return false;
    if (f.position && s.groupe.position !== f.position) return false;
    if (f.sort && s.sort !== f.sort) return false;
    if (f.marquants && !estMarquant(s)) return false;
    if (rang >= 0) {
      if (!'pca'.includes(voteDe(s, rang))) return false;
      if (f.ecarts && !estEcart(s, rang)) return false;
    } else if (f.ecarts) {
      // Sans député choisi, on garde les scrutins où au moins un s’est écarté.
      if (!etat.donnees.deputes.some((_, i) => estEcart(s, i))) return false;
    }
    if (mots.length) {
      if (!s._index) {
        s._index = normaliser([
          s.objet,
          s.amendement ? s.amendement.auteur + ' ' + s.amendement.numero : '',
          s.resume ? s.resume.resume : '',
          s.article || '',
        ].join(' '));
      }
      if (!mots.every((m) => s._index.includes(m))) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------- Rendu */

function ligneScrutin(scrutin) {
  const position = scrutin.groupe.position || 'sans position';
  const g = scrutin.groupe;
  const a = scrutin.assemblee;
  const deplie = etat.deplies.has(scrutin.numero);

  const etiquettes = [
    `<span class="etiquette">${echapper(LIBELLE_CATEGORIE[scrutin.categorie] || scrutin.categorie)}</span>`,
    scrutin.solennel ? '<span class="etiquette solennel">Scrutin solennel</span>' : '',
    `<span class="etiquette ${echapper(position)}">Groupe&nbsp;: ${echapper(position)}</span>`,
  ].join('');

  let detail = '';
  if (deplie) {
    const votants = etat.donnees.deputes.map((d, i) => {
      const v = voteDe(scrutin, i);
      if (v === '-') return '';
      const ecart = estEcart(scrutin, i) ? ' ecart' : '';
      const titre = estEcart(scrutin, i) ? ` title="S’écarte de la position du groupe"` : '';
      return `<span class="votant ${v}${ecart}"${titre}>${echapper(d.prenom)} ${echapper(d.nom)} — ${LIBELLE_VOTE[v]}</span>`;
    }).join('');

    detail = `<div class="detail"><h4>Vote de chaque député</h4><div class="votants">${votants}</div></div>`;

    if (scrutin.mep) {
      const corrections = etat.donnees.deputes.map((d, i) => {
        const v = scrutin.mep[i];
        if (!v || v === '-') return '';
        return `<span class="votant ${v}">${echapper(d.prenom)} ${echapper(d.nom)} — souhaitait voter ${LIBELLE_VOTE[v]}</span>`;
      }).filter(Boolean).join('');
      if (corrections) {
        detail += `<div class="detail"><h4>Mises au point déposées</h4><div class="votants">${corrections}</div>
          <p class="scrutin-resume">Une mise au point est déclarative : elle figure au compte rendu mais ne modifie pas le résultat proclamé.</p></div>`;
      }
    }

    if (scrutin.resume && scrutin.resume.expose) {
      detail += `<div class="detail"><h4>Exposé</h4><p class="scrutin-objet">${echapper(scrutin.resume.expose)}</p></div>`;
    }
  }

  const lienAN = `https://www.assemblee-nationale.fr/dyn/${etat.donnees.legislature}/scrutins/${scrutin.numero}`;
  const lienResume = scrutin.resume && scrutin.resume.url
    ? ` · <a href="${echapper(scrutin.resume.url)}" rel="noopener" target="_blank">Fiche amendement</a>` : '';

  return `<li class="scrutin pos-${echapper(position)}" data-numero="${scrutin.numero}">
    <div class="scrutin-haut">
      <span>${dateLongue(scrutin.date)}</span>
      <span>·</span>
      <span>Scrutin n°&nbsp;${scrutin.numero}</span>
      <span>·</span>
      <span>${echapper(scrutin.sort === 'adopté' ? 'Adopté' : 'Rejeté')}</span>
      ${etiquettes}
    </div>
    <p class="scrutin-objet">${echapper(scrutin.objet)}</p>
    ${scrutin.resume && scrutin.resume.resume ? `<p class="scrutin-resume">${echapper(scrutin.resume.resume)}</p>` : ''}
    <div class="scrutin-bas">
      <span>${g.pour + g.contre + g.abstention + g.nonVotants === 0
        ? 'Aucun député du groupe n’a pris part à ce scrutin'
        : `Groupe&nbsp;: ${g.pour} pour, ${g.contre} contre, ${g.abstention} abstention${g.abstention > 1 ? 's' : ''}`}</span>
      <span>Assemblée&nbsp;: ${nombre(a.pour)} pour, ${nombre(a.contre)} contre</span>
      <button class="detail-bascule" data-bascule="${scrutin.numero}">${deplie ? 'Masquer le détail' : 'Voir le vote de chacun'}</button>
      <a href="${lienAN}" rel="noopener" target="_blank">Scrutin sur le site de l’Assemblée</a>${lienResume}
    </div>
    ${detail}
  </li>`;
}

function rendreScrutins() {
  const resultats = filtrer();
  etat.resultats = resultats;

  $('#compte').textContent = resultats.length === 0
    ? 'Aucun scrutin ne correspond à ces critères.'
    : `${nombre(resultats.length)} scrutin${resultats.length > 1 ? 's' : ''} sur ${nombre(etat.donnees.scrutins.length)}`;

  const liste = $('#liste');
  if (resultats.length === 0) {
    liste.innerHTML = '<li class="vide">Aucun résultat. Élargissez les critères ou réinitialisez les filtres.</li>';
    $('#btn-plus').hidden = true;
    return;
  }

  // Du plus récent au plus ancien : c’est l’actualité qui sert à communiquer.
  const tri = resultats.slice().reverse();
  liste.innerHTML = tri.slice(0, etat.affiches).map(ligneScrutin).join('');
  const reste = tri.length - etat.affiches;
  const bouton = $('#btn-plus');
  bouton.hidden = reste <= 0;
  if (reste > 0) bouton.textContent = `Afficher la suite (${nombre(reste)} restant${reste > 1 ? 's' : ''})`;
}

/* ------------------------------------------------------------- Députés */

function statistiquesDepute(rang, cleTexte) {
  const depute = etat.donnees.deputes[rang];
  // Le denominateur ne retient que les scrutins tenus pendant l'appartenance
  // au groupe : sans cela, un depute arrive en cours de legislature afficherait
  // un taux ecrase par des scrutins auxquels il ne pouvait pas prendre part.
  const debut = depute.dateDebut || '0000-00-00';
  const fin = depute.dateFin || '9999-99-99';
  const scrutins = etat.donnees.scrutins.filter(
    (s) => (!cleTexte || s.texte === cleTexte) && s.date >= debut && s.date <= fin
  );

  const compte = { p: 0, c: 0, a: 0, n: 0, '-': 0 };
  let ecarts = 0;
  const listeEcarts = [];
  for (const s of scrutins) {
    const v = voteDe(s, rang);
    compte[v] = (compte[v] || 0) + 1;
    if (estEcart(s, rang)) { ecarts += 1; listeEcarts.push(s); }
  }
  const exprimes = compte.p + compte.c + compte.a;
  const presents = exprimes + compte.n;
  const part = scrutins.length ? Math.round((presents / scrutins.length) * 100) : 0;
  return { scrutins, compte, exprimes, presents, ecarts, listeEcarts, total: scrutins.length, part };
}

const cacheReferences = new Map();

/** Reperes de lecture du groupe. Un taux individuel ne veut rien dire dans
    l'absolu : sur un texte budgetaire, une dizaine de deputes seulement prennent
    part a chaque scrutin, le groupe se relayant au fil de seances qui durent des
    semaines. On donne donc la mediane des membres et la presence moyenne. */
function referencesGroupe(cleTexte) {
  if (cacheReferences.has(cleTexte)) return cacheReferences.get(cleTexte);

  const parts = etat.donnees.deputes
    .map((d, i) => ({ d, st: statistiquesDepute(i, cleTexte) }))
    .filter(({ st }) => st.total > 0)
    .map(({ st }) => st.part)
    .sort((a, b) => a - b);

  const scrutins = etat.donnees.scrutins.filter((s) => !cleTexte || s.texte === cleTexte);
  const presents = scrutins.map((s) => Array.from(s.votes).filter((c) => c !== '-').length);

  const reference = {
    mediane: parts.length ? parts[Math.floor(parts.length / 2)] : 0,
    presenceMoyenne: presents.length
      ? Math.round(presents.reduce((a, b) => a + b, 0) / presents.length) : 0,
  };
  cacheReferences.set(cleTexte, reference);
  return reference;
}

function rendreDeputes() {
  const recherche = normaliser($('#f-depute-recherche').value.trim());
  const cleTexte = $('#f-depute-texte').value;
  const actifsSeuls = $('#f-depute-actifs').checked;

  const cartes = etat.donnees.deputes.map((d, rang) => ({ d, rang }))
    .filter(({ d }) => {
      if (actifsSeuls && d.dateFin) return false;
      if (!recherche) return true;
      const circo = d.circonscription ? d.circonscription.departement : '';
      return normaliser(`${d.prenom} ${d.nom} ${circo}`).includes(recherche);
    })
    .map(({ d, rang }) => {
      const st = statistiquesDepute(rang, cleTexte);
      const circo = libelleCirco(d);
      return `<button class="carte-depute" data-depute="${rang}">
        <h3>${echapper(d.prenom)} ${echapper(d.nom)}${d.dateFin ? '<span class="partie">a quitté le groupe</span>' : ''}</h3>
        <p class="circo">${echapper(circo)}</p>
        <div class="chiffres">
          <div><strong>${nombre(st.exprimes)}</strong>votes exprimés</div>
          <div><strong>${st.part}&nbsp;%</strong>des scrutins de sa période</div>
          <div><strong>${nombre(st.ecarts)}</strong>écart${st.ecarts > 1 ? 's' : ''}</div>
        </div>
      </button>`;
    });

  $('#grille-deputes').innerHTML = cartes.length
    ? cartes.join('')
    : '<p class="vide">Aucun député ne correspond à cette recherche.</p>';
}

function ouvrirFicheDepute(rang) {
  const d = etat.donnees.deputes[rang];
  const cleTexte = $('#f-depute-texte').value;
  const texte = etat.donnees.textes.find((t) => t.cle === cleTexte);
  const st = statistiquesDepute(rang, cleTexte);
  const reference = referencesGroupe(cleTexte);
  const fidelite = st.exprimes ? Math.round(((st.exprimes - st.ecarts) / st.exprimes) * 100) : 0;

  const circo = libelleCirco(d);

  const marquants = st.scrutins.filter(estMarquant)
    .filter((s) => 'pca'.includes(voteDe(s, rang)))
    .sort(parImportance).slice(0, 25);

  const ligne = (s) => `<tr>
    <td>${dateCourte(s.date)}</td>
    <td>${echapper(s.objet)}</td>
    <td><strong>${LIBELLE_VOTE[voteDe(s, rang)]}</strong></td>
    <td>${echapper(s.sort === 'adopté' ? 'Adopté' : 'Rejeté')}</td>
  </tr>`;

  $('#fiche-carte').innerHTML = `
    <header class="fiche-entete">
      <div>
        <h2>${echapper(d.prenom)} ${echapper(d.nom)}</h2>
        <p class="fiche-sous">${echapper(circo)}${circo ? ' · ' : ''}Groupe Horizons &amp; Indépendants${d.dateFin ? ` (jusqu’au ${dateLongue(d.dateFin)})` : ''}</p>
      </div>
      <button class="bouton-fermer" data-fermer aria-label="Fermer">&times;</button>
    </header>

    <p class="fiche-sous">Périmètre&nbsp;: ${texte ? echapper(texte.libelle) : 'ensemble des textes financiers'}, ${nombre(st.total)} scrutin${st.total > 1 ? 's' : ''} publics.</p>

    <h3>Présence et positions</h3>
    <div class="stats">
      <div class="stat"><strong>${nombre(st.exprimes)}</strong><span>votes exprimés</span></div>
      <div class="stat"><strong>${st.part}&nbsp;%</strong><span>des scrutins de sa période</span></div>
      <div class="stat"><strong>${nombre(st.compte.p)}</strong><span>pour</span></div>
      <div class="stat"><strong>${nombre(st.compte.c)}</strong><span>contre</span></div>
      <div class="stat"><strong>${nombre(st.compte.a)}</strong><span>abstentions</span></div>
      <div class="stat"><strong>${fidelite}&nbsp;%</strong><span>conformité à la ligne du groupe</span></div>
    </div>
    <p class="fiche-sous" style="margin-top:12px">
      Repère&nbsp;: sur ce périmètre, ${reference.presenceMoyenne} députés du groupe en moyenne
      prennent part à chaque scrutin, et la médiane des membres s’établit à ${reference.mediane}&nbsp;%.
      Les débats budgétaires s’étirant sur des semaines, le groupe s’y relaie&nbsp;; ces taux se
      lisent les uns par rapport aux autres, non dans l’absolu.
    </p>

    <h3>Votes marquants (${marquants.length})</h3>
    ${marquants.length
      ? `<table><thead><tr><th>Date</th><th>Objet</th><th>Son vote</th><th>Issue</th></tr></thead><tbody>${marquants.map(ligne).join('')}</tbody></table>`
      : '<p class="fiche-sous">Aucun vote marquant sur ce périmètre.</p>'}

    ${st.listeEcarts.length
      ? `<h3>Écarts avec la position du groupe (${nombre(st.ecarts)})</h3>
         <table><thead><tr><th>Date</th><th>Objet</th><th>Son vote</th><th>Groupe</th></tr></thead><tbody>${
           st.listeEcarts.slice(-15).reverse().map((s) => `<tr>
             <td>${dateCourte(s.date)}</td>
             <td>${echapper(s.objet)}</td>
             <td><strong>${LIBELLE_VOTE[voteDe(s, rang)]}</strong></td>
             <td>${echapper(s.groupe.position)}</td>
           </tr>`).join('')}</tbody></table>`
      : ''}

    <p class="fiche-sous" style="margin-top:24px">Source&nbsp;: scrutins publics de l’Assemblée nationale, données au ${dateLongue(etat.donnees.genereLe.slice(0, 10))}.</p>

    <div class="fiche-actions">
      <button class="bouton-primaire" onclick="window.print()">Imprimer ou enregistrer en PDF</button>
      <button class="bouton-discret" data-fermer>Fermer</button>
    </div>`;

  $('#fiche').hidden = false;
}

/* ------------------------------------------------------- Élément de langage */

/* L'element de langage est redige en prose suivie : c'est un texte destine a
   etre repris dans une note ou une intervention, pas un tableau. On s'astreint
   donc a l'accord des reprises pronominales et a ne pas repeter la date a
   chaque phrase, deux details dont l'absence trahit immediatement un texte
   fabrique par une machine. */

/** Accord de la reprise sur l'objet du scrutin : « la motion […] elle a ete
    rejetee », « les credits […] ils ont ete adoptes ». */
function accordObjet(objet) {
  if (/^les\s/i.test(objet)) return { pronom: 'ils', marque: 's', auxiliaire: 'ont' };
  if (/^la\s/i.test(objet)) return { pronom: 'elle', marque: 'e', auxiliaire: 'a' };
  return { pronom: 'il', marque: '', auxiliaire: 'a' };
}

/** Quand la selection porte sur un texte unique, son intitule est deja donne
    par la phrase d'ouverture : le repeter a chaque scrutin alourdit sans rien
    apprendre. On ne garde alors que la lecture, et seulement sur la premiere
    mention d'une journee. */
function nettoyerObjet(objet, texteUnique, avecLecture) {
  let sortie = objet.replace(/\.$/, '').trim();
  const lecture = (sortie.match(/\((nouvelle lecture|lecture définitive|première lecture|texte de la commission mixte paritaire)\)/i) || [])[1];
  sortie = sortie.replace(/\s*\((première lecture|nouvelle lecture|lecture définitive|texte de la commission mixte paritaire)\)\s*$/i, '');
  if (texteUnique) {
    sortie = sortie.replace(/\s+d(?:u|e la) (?:projet|proposition) de loi\b.*$/i, '')
                   .replace(/[,\s]+$/, '');   // la coupe peut laisser la virgule d'une incise
  }
  if (avecLecture && lecture && !/^première lecture$/i.test(lecture)) {
    sortie += ` (${lecture.toLowerCase()})`;
  }
  return sortie.trim();
}

/** « adopté par 104 voix contre 7 », accordé sur l'objet. */
function mentionIssue(scrutin, objet) {
  const { marque } = accordObjet(objet);
  const verbe = (scrutin.sort === 'adopté' ? 'adopté' : 'rejeté') + marque;
  const a = scrutin.assemblee;
  if (a.pour + a.contre === 0) return verbe;
  const fort = Math.max(a.pour, a.contre);
  const faible = Math.min(a.pour, a.contre);
  return `${verbe} par ${nombre(fort)} voix contre ${nombre(faible)}`;
}

function descriptionScrutin(scrutin, texteUnique, avecLecture) {
  const objet = nettoyerObjet(scrutin.objet, texteUnique, avecLecture);
  return `${objet}, ${mentionIssue(scrutin, objet)}`;
}

/** Le sujet de la phrase : le groupe, ou le député si la sélection en vise un. */
function sujetEDL(depute) {
  if (!depute) return { nom: 'le groupe', pronom: 'il', marque: '' };
  const feminin = depute.civilite === 'Mme';
  return {
    nom: `${depute.prenom} ${depute.nom}`,
    pronom: feminin ? 'elle' : 'il',
    marque: feminin ? 'e' : '',
  };
}

function positionRetenue(scrutin, rang) {
  return rang >= 0 ? (LIBELLE_VOTE[voteDe(scrutin, rang)] || null) : scrutin.groupe.position;
}

/** Précision ajoutée quand le député s'écarte de la position de son groupe. */
function mentionEcart(scrutin, rang) {
  if (rang < 0 || !estEcart(scrutin, rang)) return '';
  const g = scrutin.groupe.position;
  return g === 'abstention' ? ', quand le groupe s’est abstenu' : `, quand le groupe a voté ${g}`;
}

function paragrapheMarquants(liste, depute, rang, texteUnique) {
  const sujet = sujetEDL(depute);

  // Regroupement par date : une seance fournit souvent plusieurs scrutins
  // marquants, et les dater un par un donne un texte qui bégaie.
  const journees = [];
  for (const scrutin of liste) {
    const derniere = journees[journees.length - 1];
    if (derniere && derniere.date === scrutin.date) derniere.scrutins.push(scrutin);
    else journees.push({ date: scrutin.date, scrutins: [scrutin] });
  }

  return journees.map(({ date, scrutins }) => {
    const [premier, ...suivants] = scrutins;
    const position = positionRetenue(premier, rang);
    const ouverture = position === 'abstention'
      ? `${sujet.nom} s’est abstenu${sujet.marque} sur ${descriptionScrutin(premier, texteUnique, true)}`
      : `${sujet.nom} a voté ${position} ${descriptionScrutin(premier, texteUnique, true)}`;

    let phrase = `Le ${dateLongue(date)}, ${ouverture}${mentionEcart(premier, rang)}.`;

    if (suivants.length) {
      const complements = suivants.map((scrutin) => {
        const p = positionRetenue(scrutin, rang);
        const corps = p === 'abstention'
          ? `en s’abstenant sur ${descriptionScrutin(scrutin, texteUnique, false)}`
          : `${p} ${descriptionScrutin(scrutin, texteUnique, false)}`;
        return corps + mentionEcart(scrutin, rang);
      });
      const enumeration = complements.length > 1
        ? complements.slice(0, -1).join(' ; ') + ', et ' + complements[complements.length - 1]
        : complements[0];
      const majuscule = sujet.pronom.charAt(0).toUpperCase() + sujet.pronom.slice(1);
      phrase += ` ${majuscule} s’est également prononcé${sujet.marque} ${enumeration}.`;
    }
    return phrase;
  }).join(' ');
}

function enumererFr(elements) {
  if (elements.length <= 1) return elements[0] || '';
  return elements.slice(0, -1).join(', ') + ' et ' + elements[elements.length - 1];
}

/** On enonce la repartition reelle des divergences plutot que d'en deduire une
    tendance a partir du dernier cas rencontre. */
function phraseEcarts(st) {
  const repartition = { pour: 0, contre: 0, abstention: 0 };
  for (const s of st.listeEcarts) if (s.groupe.position) repartition[s.groupe.position] += 1;

  const detail = Object.entries(repartition)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([position, n], i) => {
      // Le groupe n'est nomme qu'une fois, la reprise pronominale suffit ensuite.
      const sujet = i === 0 ? 'le groupe' : 'il';
      return position === 'abstention'
        ? `${nombre(n)} où ${sujet} s’était abstenu`
        : `${nombre(n)} où ${sujet} avait voté ${position}`;
    });

  return `Ses ${nombre(st.ecarts)} votes divergents se répartissent entre ${enumererFr(detail)}.`;
}

function composerEDL(resultats) {
  const f = lireFiltres();
  const d = etat.donnees;
  if (!resultats.length) return 'La sélection ne contient aucun scrutin.';

  const texte = d.textes.find((t) => t.cle === f.texte);
  const rang = f.depute ? Number(f.depute) : -1;
  const depute = rang >= 0 ? d.deputes[rang] : null;

  const premier = resultats[0];
  const dernier = resultats[resultats.length - 1];
  const compte = { pour: 0, contre: 0, abstention: 0 };
  for (const s of resultats) if (s.groupe.position) compte[s.groupe.position] += 1;

  const perimetre = texte
    ? `sur le ${texte.libelle.charAt(0).toLowerCase() + texte.libelle.slice(1)}`
    : 'sur les textes financiers de la législature';
  const periode = premier.date === dernier.date
    ? `le ${dateLongue(premier.date)}`
    : `entre le ${dateLongue(premier.date)} et le ${dateLongue(dernier.date)}`;
  const pluriel = resultats.length > 1 ? 's' : '';

  const paragraphes = [];

  if (depute) {
    const sujet = sujetEDL(depute);
    const st = statistiquesDepute(rang, f.texte);
    const fidelite = st.exprimes ? Math.round(((st.exprimes - st.ecarts) / st.exprimes) * 100) : 0;
    paragraphes.push(
      `${sujet.nom} s’est prononcé${sujet.marque} ${perimetre} dans ${nombre(resultats.length)} ` +
      `scrutin${pluriel} public${pluriel}, ${periode}. Sur ce périmètre, ${sujet.pronom} a voté pour ` +
      `à ${nombre(st.compte.p)} reprises et contre à ${nombre(st.compte.c)}, s’abstenant ` +
      `${nombre(st.compte.a)} fois, soit une conformité de ${fidelite} % à la position majoritaire ` +
      `du groupe.` +
      (st.ecarts ? ' ' + phraseEcarts(st) : '')
    );
  } else {
    paragraphes.push(
      `Le groupe Horizons & Indépendants s’est prononcé ${perimetre} dans ${nombre(resultats.length)} ` +
      `scrutin${pluriel} public${pluriel}, ${periode}. Il a voté pour dans ${nombre(compte.pour)} cas, ` +
      `contre dans ${nombre(compte.contre)}, et s’est abstenu à ${nombre(compte.abstention)} reprises.`
    );
  }

  const marquants = resultats.filter(estMarquant).sort(parImportance).slice(0, 8);
  if (marquants.length) paragraphes.push(paragrapheMarquants(marquants, depute, rang, f.texte));

  const adoptes = resultats.filter((s) => s.sort === 'adopté' && s.groupe.position === 'pour'
    && (s.categorie === 'amendement' || s.categorie === 'sous-amendement'));
  if (adoptes.length) {
    const articles = [];
    for (const s of adoptes.slice().reverse()) {
      const mention = s.article ? `l’article ${s.article}` : 'un article additionnel';
      if (!articles.includes(mention)) articles.push(mention);
      if (articles.length === 3) break;
    }
    paragraphes.push(
      `${nombre(adoptes.length)} amendement${adoptes.length > 1 ? 's ont été adoptés' : ' a été adopté'} ` +
      `avec le soutien du groupe sur ce périmètre` +
      (articles.length ? `, les plus récents portant sur ${enumererFr(articles)}.` : '.')
    );
  }

  paragraphes.push(
    `Source : scrutins publics de l’Assemblée nationale, XVIIe législature, ` +
    `données arrêtées au ${dateLongue(d.genereLe.slice(0, 10))}.`
  );

  return paragraphes.join('\n\n');
}

function ouvrirEDL() {
  const resultats = etat.resultats || filtrer();
  $('#edl-texte').value = composerEDL(resultats);
  $('#edl-note').textContent = `Rédigé à partir des ${nombre(resultats.length)} scrutins actuellement filtrés. Relisez et ajustez avant diffusion.`;
  $('#copie-ok').hidden = true;
  $('#edl').hidden = false;
}

/* ------------------------------------------------------------- Démarrage */

function remplirSelecteurs() {
  const d = etat.donnees;
  const optionsTextes = d.textes
    .map((t) => `<option value="${echapper(t.cle)}">${echapper(t.libelle)} (${nombre(t.scrutins)})</option>`).join('');
  $('#f-texte').insertAdjacentHTML('beforeend', optionsTextes);
  $('#f-depute-texte').insertAdjacentHTML('beforeend', optionsTextes);

  $('#f-depute').insertAdjacentHTML('beforeend', d.deputes
    .map((dep, i) => `<option value="${i}">${echapper(dep.nom)} ${echapper(dep.prenom)}${dep.dateFin ? ' (ancien membre)' : ''}</option>`)
    .join(''));

  $('#entete-resume').textContent =
    `${nombre(d.scrutins.length)} scrutins publics sur les textes financiers de la XVIIe législature, ` +
    `du ${dateLongue(d.periode.debut)} au ${dateLongue(d.periode.fin)} · ${d.deputes.length} députés`;

  $('#pied-maj').textContent = `Données reconstruites le ${dateLongue(d.genereLe.slice(0, 10))}.`;
  $('#pied-resumes').textContent = d.resumesRaccordes
    ? 'Les résumés d’amendements proviennent de l’outil du groupe.'
    : 'Les résumés d’amendements ne sont pas encore raccordés.';
}

function installerEvenements() {
  const relancer = () => { etat.affiches = PAS_AFFICHAGE; etat.deplies.clear(); rendreScrutins(); };

  ['#f-texte', '#f-categorie', '#f-position', '#f-sort', '#f-depute', '#f-marquants', '#f-ecarts']
    .forEach((sel) => $(sel).addEventListener('change', relancer));

  let minuteur;
  $('#f-recherche').addEventListener('input', () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(relancer, 180);
  });

  $('#btn-plus').addEventListener('click', () => { etat.affiches += PAS_AFFICHAGE; rendreScrutins(); });

  $('#btn-reset').addEventListener('click', () => {
    $$('.filtres select').forEach((s) => { s.value = ''; });
    $$('.filtres input[type="search"]').forEach((s) => { s.value = ''; });
    $('#f-marquants').checked = false;
    $('#f-ecarts').checked = false;
    relancer();
  });

  $('#liste').addEventListener('click', (evt) => {
    const bouton = evt.target.closest('[data-bascule]');
    if (!bouton) return;
    const numero = Number(bouton.dataset.bascule);
    if (etat.deplies.has(numero)) etat.deplies.delete(numero); else etat.deplies.add(numero);
    rendreScrutins();
  });

  $$('.onglet').forEach((onglet) => onglet.addEventListener('click', () => {
    $$('.onglet').forEach((o) => o.classList.toggle('actif', o === onglet));
    etat.vue = onglet.dataset.vue;
    $('#vue-scrutins').hidden = etat.vue !== 'scrutins';
    $('#vue-deputes').hidden = etat.vue !== 'deputes';
    if (etat.vue === 'deputes') rendreDeputes();
  }));

  ['#f-depute-recherche', '#f-depute-texte', '#f-depute-actifs']
    .forEach((sel) => $(sel).addEventListener('input', rendreDeputes));

  $('#grille-deputes').addEventListener('click', (evt) => {
    const carte = evt.target.closest('[data-depute]');
    if (carte) ouvrirFicheDepute(Number(carte.dataset.depute));
  });

  $('#btn-edl').addEventListener('click', ouvrirEDL);

  $('#btn-copier').addEventListener('click', async () => {
    const champ = $('#edl-texte');
    try {
      await navigator.clipboard.writeText(champ.value);
    } catch (_) {
      champ.select();
      document.execCommand('copy');   // repli pour les navigateurs sans presse-papier asynchrone
    }
    $('#copie-ok').hidden = false;
  });

  $('#btn-telecharger').addEventListener('click', () => {
    const blob = new Blob([$('#edl-texte').value], { type: 'text/plain;charset=utf-8' });
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(blob);
    lien.download = `edl-votes-horizons-${new Date().toISOString().slice(0, 10)}.txt`;
    lien.click();
    URL.revokeObjectURL(lien.href);
  });

  document.addEventListener('click', (evt) => {
    if (evt.target.closest('[data-fermer]')) {
      $('#fiche').hidden = true;
      $('#edl').hidden = true;
    }
  });

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') { $('#fiche').hidden = true; $('#edl').hidden = true; }
  });
}

async function demarrer() {
  const reponse = await fetch('data/votes.json');
  if (!reponse.ok) throw new Error(`Chargement des données impossible (${reponse.status})`);
  etat.donnees = await reponse.json();

  $('#app').hidden = false;
  remplirSelecteurs();
  installerEvenements();
  rendreScrutins();
}

(function initialiser() {
  let dejaOuvert = false;
  try { dejaOuvert = sessionStorage.getItem(CLE_SESSION) === '1'; } catch (_) { /* navigation privée */ }
  if (dejaOuvert || !window.CONFIG.empreinteMotDePasse) {
    demarrer().catch((erreur) => {
      document.body.innerHTML = `<p class="vide">${echapper(erreur.message)}</p>`;
    });
  } else {
    installerPorte();
  }
})();
