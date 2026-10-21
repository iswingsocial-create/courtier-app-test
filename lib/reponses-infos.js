/**
 * lib/reponses-infos.js — Analyse des réponses aux demandes d'informations
 * (boucle courriel, étape 3/5).
 *
 *  1. trouverDemandePourCourriel : correspondance message ↔ demande —
 *     par le fil (In-Reply-To = message_id de la demande), sinon par
 *     l'objet (préfixes Re:/Fwd: retirés), sinon choix manuel.
 *  2. analyserReponse : le corps du courriel passe par le moteur d'analyse
 *     de documents (local/Cohere selon les réglages), chaque pièce jointe
 *     par le pipeline d'extraction complet (y compris tableur) ; les
 *     propositions sont fusionnées en UNE analyse (source indiquée par
 *     champ : « Réponse courriel » ou nom de la pièce jointe), à laquelle
 *     s'ajoutent des propositions CIBLÉES : les réponses aux questions en
 *     attente repérées par motifs dans le texte (ex. « Gicleurs : oui »,
 *     « Superficie : 12 000 pi² »).
 *  3. appliquerReponsesCiblees : à l'insertion (révision), écrit les
 *     valeurs retenues dans les éléments existants de la soumission.
 *     L'insertion ne simplifie jamais la révision : tout passe par
 *     l'écran de révision des analyses.
 */
const fs = require('fs');
const path = require('path');
const bd = require('./bd');
const { journal } = require('./middleware');
const demandesInfos = require('./demandes-infos');
const analyses = require('./analyses-documents');
const moteurAnalyse = require('./analyse-document');
const extraction = require('./extraction-document');
const { LIBELLES_CHAMPS } = require('./manques');

// --- Correspondance message ↔ demande -------------------------------------------
function normaliserSujet(s) {
  let t = String(s || '').trim().toLowerCase();
  for (let i = 0; i < 3; i++) t = t.replace(/^(re|fwd|fw|tr|sv)\s*:\s*/i, '');
  return t.replace(/\s+/g, ' ').trim();
}

function trouverDemandePourCourriel(cabinetId, courriel) {
  if (!courriel) return null;
  // 1. Par le fil : In-Reply-To (ou References) = message_id de la demande.
  const ref = String(courriel.en_reponse_a || '').trim();
  if (ref) {
    const parFil = bd.prepare(`
      SELECT id FROM demandes_infos
      WHERE cabinet_id = ? AND archive = 0 AND message_id = ?
        AND statut IN ('envoyee','partiellement_completee')
      ORDER BY id DESC LIMIT 1
    `).get(cabinetId, ref);
    if (parFil) return demandesInfos.obtenirDemande(parFil.id, cabinetId);
  }
  // 2. Par l'objet (préfixes de réponse retirés).
  const sujet = normaliserSujet(courriel.sujet);
  if (sujet) {
    const ouvertes = demandesInfos.listerOuvertes(cabinetId);
    const parSujet = ouvertes.find((d) => normaliserSujet(d.sujet) === sujet);
    if (parSujet) return parSujet;
  }
  return null;
}

// --- Motifs ciblés : réponses aux questions en attente ------------------------------
// Chaque entrée : champ (colonne de l'élément), type d'élément concerné,
// motif(s) regex cherchant une valeur FR dans le texte, conversion.
const MOTIFS_CIBLES = [
  { champ: 'gicleurs', types: ['batiments'], re: [/gicleurs?\s*[:=]?\s*(oui|non|yes|no)\b/i, /prot[ée]g[ée]\s+par\s+(?:des\s+)?gicleurs/i], conv: (t, m) => (/non|no/i.test(m[1] || '') ? 0 : 1), libelleForce: 'Gicleurs' },
  { champ: 'superficie_pi2', types: ['batiments', 'etablissements'], re: [/superficie\s*[:=]?\s*([\d\s.,]+)\s*(?:pi²|pi2|pieds carr)/i, /superficie\s*[:=]?\s*([\d\s.,]+)\s*m(?:²|2)?/i], conv: (t, m) => Math.round(parseFloat(String(m[1]).replace(/[\s\u202F]/g, '').replace(',', '.')) * (t.includes('pi') ? 1 : 10.7639)) },
  { champ: 'nb_etages', types: ['batiments'], re: [/(\d{1,2})\s*[ée]tages?\b/i, /nombre d['’][ée]tages?\s*[:=]?\s*(\d{1,2})/i], conv: (t, m) => parseInt(m[1], 10) },
  { champ: 'annee_toiture', types: ['batiments'], re: [/toiture\s*[:=]?\s*(?:refaite\s+en\s+|de\s+)?((?:19|20)\d{2})/i], conv: (t, m) => parseInt(m[1], 10) },
  { champ: 'type_construction', types: ['batiments'], re: [/construction\s*(?:en|:|=)?\s*(bois|acier|b[ée]ton|ma[çc]onnerie|mixte)/i], conv: (t, m) => m[1].toLowerCase().replace('é', 'e').replace('ç', 'c') },
  { champ: 'chauffage', types: ['batiments'], re: [/chauffage\s*[:=]?\s*(gaz naturel|gaz|mazout|[ée]lectrique|bois|granules|mixte)/i], conv: (t, m) => m[1].toLowerCase() },
  { champ: 'distance_caserne_km', types: ['batiments'], re: [/caserne\s*(?:à|:|=)?\s*([\d.,]+)\s*km/i, /([\d.,]+)\s*km\s*(?:de|d['’])\s*la\s+caserne/i], conv: (t, m) => parseFloat(String(m[1]).replace(',', '.')) },
  { champ: 'base_valeur', types: ['etablissements'], re: [/base\s*(?:de|d['’])\s*(?:calcul|valeur)?\s*[:=]?\s*(b[ée]n[ée]fice brut|revenus bruts|chiffre d['’]affaires)/i], conv: (t, m) => (/b[ée]n[ée]fice/i.test(m[1]) ? 'benefice_brut' : (/chiffre/i.test(m[1]) ? 'chiffre_affaires' : 'revenus_bruts')) },
];

function extraireReponsesCiblees(texte, questionsOuvertes) {
  const t = String(texte || '');
  if (!t.trim()) return [];
  const trouvees = [];
  const clesVues = new Set();
  for (const m of MOTIFS_CIBLES) {
    // La question ouverte correspondante (clé de manque) pour ce champ.
    const question = (questionsOuvertes || []).find((q) => q.champ === m.champ && m.types.includes(q.type));
    if (!question || clesVues.has(question.cle)) continue;
    for (const re of m.re) {
      const correspondance = t.match(re);
      if (correspondance) {
        const valeur = m.conv(correspondance[0], correspondance);
        if (valeur === undefined || valeur === null || (typeof valeur === 'number' && Number.isNaN(valeur))) break;
        trouvees.push({
          cle: question.cle, type: question.type, id: question.id, champ: m.champ,
          libelle: m.libelleForce || question.libelle || LIBELLES_CHAMPS[m.champ] || m.champ,
          valeur, confiance: 0.95,
          extrait: correspondance[0].slice(0, 160),
          source: 'Réponse courriel',
        });
        clesVues.add(question.cle);
        break;
      }
    }
  }
  return trouvees;
}

// Questions encore ouvertes d'une demande, annotées (type/id d'élément, champ).
function questionsOuvertesDetaillees(demande) {
  const s = demandesInfos.chargerSoumission(demande.produit, demande.soumission_id, demande.cabinet_id);
  if (!s) return [];
  const manques = require('./manques').calculerManques(demande.produit, s);
  const parCle = new Map(manques.map((m) => [m.cle, m]));
  return (demande.questions || [])
    .filter((q) => q.statut !== 'repondue' && parCle.has(q.cle))
    .map((q) => {
      const m = parCle.get(q.cle);
      return {
        cle: q.cle, type: m.element ? m.element.type : null, id: m.element ? m.element.id : null,
        champ: m.champ, libelle: m.libelle,
      };
    });
}

// --- Fusion des propositions ----------------------------------------------------------
function fusionnerPropositions(base, ajout) {
  const champs = [...(base.champs || [])];
  const index = new Map(champs.map((c, i) => [`${c.table || ''}.${c.champ}`, i]));
  for (const c of ajout.champs || []) {
    const cle = `${c.table || ''}.${c.champ}`;
    if (index.has(cle)) {
      const i = index.get(cle);
      if ((c.confiance || 0) > (champs[i].confiance || 0)) champs[i] = c;
    } else {
      index.set(cle, champs.length);
      champs.push(c);
    }
  }
  const listes = { ...(base.listes || {}) };
  for (const [type, lignes] of Object.entries(ajout.listes || {})) {
    listes[type] = [...(listes[type] || []), ...(lignes || [])];
  }
  return { champs, listes };
}

// --- Analyse complète d'une réponse ------------------------------------------------------
async function analyserReponse(cabinetId, utilisateur, courriel, demande) {
  const textes = [];
  const sources = [];

  // 1. Corps du message. Le produit est celui de la demande : si le moteur
  // détecte un autre produit, on ne garde que les champs des tables du
  // produit visé (et aucune liste) pour ne rien proposer à côté.
  const corpsTexte = [courriel.corps_texte || '', courriel.sujet ? `Objet : ${courriel.sujet}` : ''].join('\n').trim();
  let fusion = { champs: [], listes: {} };
  let moteur = 'local';
  const tablesProduit = [moteurAnalyse.TABLES_SOUMISSIONS[demande.produit]].filter(Boolean);
  const ancrer = (r) => {
    if (r.produit && r.produit !== demande.produit) {
      return {
        champs: (r.champs || []).filter((c) => tablesProduit.includes(c.table)),
        listes: {},
      };
    }
    return { champs: r.champs || [], listes: r.listes || {} };
  };
  if (corpsTexte) {
    const r = await moteurAnalyse.analyser(corpsTexte, { cabinetId });
    moteur = r.moteur || moteur;
    const a = ancrer(r);
    fusion = fusionnerPropositions(fusion, {
      champs: a.champs.map((c) => ({ ...c, source: 'Réponse courriel' })),
      listes: a.listes,
    });
    textes.push(corpsTexte);
  }

  // 2. Pièces jointes : extraction complète (PDF/OCR/tableur) + moteur.
  const pjs = bd.prepare(
    'SELECT * FROM courriel_pieces_jointes WHERE cabinet_id = ? AND courriel_id = ? AND archive = 0 ORDER BY id'
  ).all(cabinetId, courriel.id);
  for (const pj of pjs) {
    try {
      const ex = await extraction.extraireTexte({ chemin: pj.chemin, nom: pj.nom, mime: pj.mime });
      const textePj = (ex && ex.texte) || '';
      if (textePj.trim()) {
        textes.push(textePj);
        const r = await moteurAnalyse.analyser(textePj, { cabinetId, tableau: (ex && ex.tableau) || null });
        const a = ancrer(r);
        fusion = fusionnerPropositions(fusion, {
          champs: a.champs.map((c) => ({ ...c, source: pj.nom })),
          listes: a.listes,
        });
        sources.push(pj.nom);
      }
    } catch (e) { /* PJ illisible : ignorée, le corps reste analysé */ }
  }

  // 3. Propositions ciblées (réponses aux questions en attente).
  const texteComplet = textes.join('\n');
  const ouvertes = questionsOuvertesDetaillees(demande);
  const ciblees = extraireReponsesCiblees(texteComplet, ouvertes);

  // 4. Créer l'analyse (document source = corps de la réponse, conservé).
  const dossier = path.join(__dirname, '..', 'uploads', String(cabinetId), 'analyses');
  fs.mkdirSync(dossier, { recursive: true });
  const nomFichier = `reponse-courriel-${courriel.id}.txt`;
  const chemin = path.join(dossier, `${Date.now()}-${nomFichier}`);
  fs.writeFileSync(chemin, texteComplet || '(réponse sans texte)');
  const analyseId = analyses.creerAnalyse(cabinetId, utilisateur.id, {
    nomOrigine: `Réponse courriel — ${courriel.sujet || 'sans objet'}`,
    chemin, mime: 'text/plain', taille: Buffer.byteLength(texteComplet),
  });
  analyses.enregistrerExtraction(analyseId, cabinetId, utilisateur.id, {
    texte: texteComplet, methode: pjs.length ? 'courriel+pieces-jointes' : 'courriel',
  });
  analyses.enregistrerPropositions(analyseId, cabinetId, utilisateur.id, {
    produit: demande.produit, confianceGlobale: null,
    champs: fusion.champs, listes: fusion.listes, moteur,
  });
  analyses.lierDemande(analyseId, cabinetId, demande.id, courriel.id, ciblees);
  journal(cabinetId, utilisateur.id, 'reponse_analysee',
    `Réponse au courriel #${courriel.id} analysée pour la demande d'informations #${demande.id} (analyse #${analyseId}) — ${fusion.champs.length} champ(s), ${ciblees.length} réponse(s) ciblée(s)${sources.length ? `, pièces jointes : ${sources.join(', ')}` : ''}`);
  return { analyseId, ciblees, nbChamps: fusion.champs.length };
}

// --- Application des réponses ciblées retenues à la révision ------------------------------
const MODIFICATEURS = {
  batiments: (lib, id, cab, u, data) => lib.modifierBatiment(id, cab, u, data),
  exploitations: (lib, id, cab, u, data) => lib.modifierExploitation(id, cab, u, data),
  vehicules: (lib, id, cab, u, data) => lib.modifierVehicule(id, cab, u, data),
  conducteurs: (lib, id, cab, u, data) => lib.modifierConducteur(id, cab, u, data),
  etablissements: (lib, id, cab, u, data) => lib.modifierEtablissement(id, cab, u, data),
  dirigeants: (lib, id, cab, u, data) => lib.modifierDirigeant(id, cab, u, data),
  obligations: (lib, id, cab, u, data) => lib.modifierObligation(id, cab, u, data),
  activites: (lib, id, cab, u, data) => lib.modifierActivite(id, cab, u, data),
};
const COLLECTIONS = {
  batiments: 'batiments', exploitations: 'exploitations', vehicules: 'vehicules',
  conducteurs: 'conducteurs', etablissements: 'etablissements', dirigeants: 'dirigeants',
  obligations: 'obligations', activites: 'activites',
};

function appliquerReponsesCiblees(cabinetId, utilisateur, produit, soumissionId, retenues) {
  const s = demandesInfos.chargerSoumission(produit, soumissionId, cabinetId);
  if (!s) return { appliquees: [], cles: [] };
  const LIBS = {
    auto: require('./fpq1'), biens: require('./biens'), rc: require('./rc'),
    cyber: require('./cyber'), eo: require('./eo'), do: require('./do'),
    pe: require('./pe'), flotte: require('./flotte'), cautionnement: require('./cautionnement'),
  };
  const lib = LIBS[produit];
  const appliquees = [];
  const cles = [];
  for (const r of retenues || []) {
    const modifier = MODIFICATEURS[r.type];
    const collection = COLLECTIONS[r.type];
    if (!modifier || !collection || !lib) continue;
    const elements = s[collection] || [];
    if (!elements.some((e) => e.id === Number(r.id))) continue; // appartient à la soumission
    try {
      modifier(lib, Number(r.id), cabinetId, utilisateur.id, { [r.champ]: r.valeur });
      appliquees.push(r);
      cles.push(r.cle);
    } catch (e) { /* valeur rejetée par la couche produit : ignorée */ }
  }
  return { appliquees, cles };
}

module.exports = {
  normaliserSujet, trouverDemandePourCourriel, extraireReponsesCiblees,
  questionsOuvertesDetaillees, fusionnerPropositions, analyserReponse,
  appliquerReponsesCiblees, MOTIFS_CIBLES,
};
