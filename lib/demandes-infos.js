/**
 * lib/demandes-infos.js — Demandes d'informations au client (boucle
 * courriel, étapes 2 et 4/5).
 *
 * Cycle de vie :
 *  1. creerDemande : depuis les manques d'une soumission (lib/manques.js),
 *     génère un BROUILLON (destinataire, sujet, corps par gabarit FR,
 *     questions numérotées groupées). RIEN ne part à ce stade.
 *  2. envoyerDemande : seulement après validation humaine explicite (le
 *     POST d'envoi). Envoi SMTP via le module Courriels s'il existe un
 *     compte actif ; sinon MODE SIMULÉ, clairement indiqué dans le journal
 *     et dans l'interface (démonstration / tests — aucun message réel).
 *  3. Les réponses du client, analysées (lib/reponses-infos.js), ferment
 *     les questions une à une : recalculerDepuisSoumission ferme celles
 *     dont le manque a disparu, marquerReponses celles couvertes par une
 *     proposition ciblée acceptée à la révision.
 *  4. creerRelance : une relance est une NOUVELLE demande (parent_id),
 *     avec seulement les questions restantes — jamais un écrasement.
 *
 * Règle d'or : aucune suppression (archivage doux). Journal : demande_info_%.
 */
const bd = require('./bd');
const { journal } = require('./middleware');
const manquesLib = require('./manques');
const { NOMS_PRODUITS } = manquesLib;

const LIBS = {
  auto: () => require('./fpq1'),
  biens: () => require('./biens'),
  rc: () => require('./rc'),
  cyber: () => require('./cyber'),
  eo: () => require('./eo'),
  do: () => require('./do'),
  pe: () => require('./pe'),
  flotte: () => require('./flotte'),
  cautionnement: () => require('./cautionnement'),
};

const STATUTS = ['brouillon', 'envoyee', 'partiellement_completee', 'completee'];

function chargerSoumission(produit, soumissionId, cabinetId) {
  const chargeur = LIBS[produit];
  if (!chargeur) return null;
  const lib = chargeur();
  if (typeof lib.obtenirSoumission !== 'function') return null;
  return lib.obtenirSoumission(soumissionId, cabinetId);
}

function maintenant() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// --- Gabarits -------------------------------------------------------------------
function genererSujet(produit, raisonSociale) {
  return `Informations complémentaires requises — soumission ${NOMS_PRODUITS[produit] || produit}${raisonSociale ? ` — ${raisonSociale}` : ''}`;
}

const LIBELLES_GROUPES = {
  entete: 'Votre dossier', garanties: 'Garanties souhaitées',
  antecedents: 'Antécédents', liste: 'Précisions demandées',
};

function genererCorps({ produit, questions, auteurNom, relance = false, dateInitiale = null }) {
  const lignes = ['Bonjour,', ''];
  if (relance) {
    lignes.push(`Je me permets de revenir vers vous au sujet de notre courriel${dateInitiale ? ` du ${dateInitiale}` : ''} concernant votre soumission ${NOMS_PRODUITS[produit] || produit}. Certaines informations nous manquent encore pour la compléter ; les voici de nouveau :`);
  } else {
    lignes.push(`Afin de compléter votre demande de soumission ${NOMS_PRODUITS[produit] || produit} et d'obtenir des propositions des assureurs, il nous manque encore quelques informations. Pouvez-vous répondre directement à ce courriel, en répondant aux questions ci-dessous ou en joignant les documents demandés ?`);
  }
  lignes.push('');
  let groupeCourant = null;
  let n = 0;
  for (const q of questions) {
    const groupe = q.groupe || 'Précisions demandées';
    if (groupe !== groupeCourant) {
      groupeCourant = groupe;
      lignes.push('', groupe.toUpperCase(), '');
    }
    n++;
    lignes.push(`${n}. ${q.question}`);
  }
  lignes.push('', 'Merci beaucoup ! Dès réception de vos réponses, nous complétons votre dossier.', '', 'Cordialement,', auteurNom || '');
  return lignes.join('\n');
}

function questionsDepuisManques(manques) {
  return (manques || []).map((m) => ({
    cle: m.cle,
    libelle: m.libelle,
    question: m.question,
    groupe: m.element ? m.element.libelle : (LIBELLES_GROUPES[m.niveau] || 'Précisions demandées'),
    statut: 'en_attente',
    repondu_le: null,
  }));
}

// --- Création ---------------------------------------------------------------------
function creerDemande(cabinetId, utilisateur, { produit, soumissionId, parentId = null, seulementCles = null, relance = false, dateInitiale = null }) {
  const s = chargerSoumission(produit, soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable dans votre cabinet.');
  let manques = manquesLib.calculerManques(produit, s);
  if (seulementCles) manques = manques.filter((m) => seulementCles.includes(m.cle));
  if (!manques.length) throw new Error('Aucune information manquante : le dossier est déjà complet.');
  const client = s.client_id
    ? bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, cabinetId)
    : null;
  const questions = questionsDepuisManques(manques);
  const sujet = genererSujet(produit, client ? client.raison_sociale : null);
  const corps = genererCorps({
    produit, questions, auteurNom: utilisateur.nom, relance, dateInitiale,
  });
  const r = bd.prepare(`
    INSERT INTO demandes_infos (cabinet_id, parent_id, produit, soumission_id, client_id,
      destinataire, sujet, corps, questions, statut, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'brouillon', ?)
  `).run(cabinetId, parentId, produit, soumissionId, client ? client.id : null,
    client ? (client.courriel || client.courriel_entreprise || null) : null,
    sujet, corps, JSON.stringify(questions), utilisateur.id);
  journal(cabinetId, utilisateur.id, 'demande_info_creee',
    `Demande d'informations #${r.lastInsertRowid} créée (brouillon) pour la soumission ${produit} #${soumissionId} — ${questions.length} question(s)${parentId ? `, relance de la demande #${parentId}` : ''}`);
  return r.lastInsertRowid;
}

function creerRelance(demandeId, cabinetId, utilisateur) {
  const parent = obtenirDemande(demandeId, cabinetId);
  if (!parent) throw new Error('Demande introuvable.');
  if (!['envoyee', 'partiellement_completee'].includes(parent.statut)) {
    throw new Error('Seule une demande envoyée peut être relancée.');
  }
  const restantes = parent.questions.filter((q) => q.statut !== 'repondue').map((q) => q.cle);
  if (!restantes.length) throw new Error('Toutes les questions ont déjà reçu une réponse.');
  return creerDemande(cabinetId, utilisateur, {
    produit: parent.produit, soumissionId: parent.soumission_id, parentId: parent.id,
    seulementCles: restantes, relance: true,
    dateInitiale: parent.envoyee_le ? parent.envoyee_le.slice(0, 10) : null,
  });
}

// --- Lectures ------------------------------------------------------------------------
function obtenirDemande(id, cabinetId, { inclureArchives = false } = {}) {
  const d = bd.prepare(`
    SELECT * FROM demandes_infos WHERE id = ? AND cabinet_id = ?${inclureArchives ? '' : ' AND archive = 0'}
  `).get(id, cabinetId);
  if (!d) return null;
  const brut = d.questions;
  d.questions = [];
  if (brut) {
    try { d.questions = JSON.parse(brut) || []; } catch (e) { d.questions = []; }
  }
  d.nbRestantes = d.questions.filter((q) => q.statut !== 'repondue').length;
  d.nbRepondues = d.questions.length - d.nbRestantes;
  return d;
}

function listerPourSoumission(cabinetId, produit, soumissionId) {
  const ids = bd.prepare(`
    SELECT id FROM demandes_infos
    WHERE cabinet_id = ? AND produit = ? AND soumission_id = ? AND archive = 0
    ORDER BY id DESC
  `).all(cabinetId, produit, soumissionId).map((r) => r.id);
  return ids.map((id) => obtenirDemande(id, cabinetId));
}

function listerOuvertes(cabinetId) {
  const ids = bd.prepare(`
    SELECT id FROM demandes_infos
    WHERE cabinet_id = ? AND archive = 0 AND statut IN ('envoyee','partiellement_completee')
    ORDER BY id DESC
  `).all(cabinetId).map((r) => r.id);
  return ids.map((id) => obtenirDemande(id, cabinetId));
}

function brouillonOuvert(cabinetId, produit, soumissionId) {
  const r = bd.prepare(`
    SELECT id FROM demandes_infos
    WHERE cabinet_id = ? AND produit = ? AND soumission_id = ? AND archive = 0 AND statut = 'brouillon'
    ORDER BY id DESC LIMIT 1
  `).get(cabinetId, produit, soumissionId);
  return r ? obtenirDemande(r.id, cabinetId) : null;
}

// Section complète pour les fiches soumission (manques + suivi des demandes).
function sectionPourFiche(produit, s, cabinetId) {
  if (!s) return null;
  return {
    produit,
    soumissionId: s.id,
    manques: manquesLib.calculerManques(produit, s),
    demandes: listerPourSoumission(cabinetId, produit, s.id),
    brouillon: brouillonOuvert(cabinetId, produit, s.id),
  };
}

// --- Brouillon et envoi ---------------------------------------------------------------
function majBrouillon(id, cabinetId, userId, { destinataire, sujet, corps }) {
  const d = obtenirDemande(id, cabinetId);
  if (!d) throw new Error('Demande introuvable.');
  if (d.statut !== 'brouillon') throw new Error('Seul un brouillon peut être modifié.');
  bd.prepare(`
    UPDATE demandes_infos SET destinataire = ?, sujet = ?, corps = ?, maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(destinataire || null, sujet, corps, id, cabinetId);
  journal(cabinetId, userId, 'demande_info_modifiee', `Brouillon de demande d'informations #${id} modifié`);
  return obtenirDemande(id, cabinetId);
}

async function envoyerDemande(id, cabinetId, utilisateur) {
  const d = obtenirDemande(id, cabinetId);
  if (!d) throw new Error('Demande introuvable.');
  if (d.statut !== 'brouillon') throw new Error('Cette demande a déjà été envoyée.');
  const destinataire = String(d.destinataire || '').trim();
  if (!destinataire || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinataire)) {
    throw new Error('Adresse destinataire invalide : corrigez-la avant l\u2019envoi.');
  }
  const compte = bd.prepare(
    'SELECT * FROM courriel_comptes WHERE cabinet_id = ? AND actif = 1 AND archive = 0 ORDER BY nom LIMIT 1'
  ).get(cabinetId);
  let mode = 'simule';
  let messageId = `simule-demande-${id}-${Date.now()}@courtier.local`;
  let courrielId = null;
  if (compte) {
    const courrielsLib = require('./courriels');
    const envoi = await courrielsLib.envoyerCourriel(bd, compte, {
      a: destinataire, sujet: d.sujet, texte: d.corps,
    });
    mode = 'smtp';
    messageId = envoi.messageId || null;
    if (messageId) {
      const copie = bd.prepare(
        "SELECT id FROM courriels WHERE cabinet_id = ? AND message_id = ? AND dossier = 'envoyes' ORDER BY id DESC LIMIT 1"
      ).get(cabinetId, messageId);
      courrielId = copie ? copie.id : null;
    }
  }
  bd.prepare(`
    UPDATE demandes_infos
    SET statut = 'envoyee', mode_envoi = ?, message_id = ?, courriel_id = ?,
        envoyee_le = datetime('now'), maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(mode, messageId, courrielId, id, cabinetId);
  journal(cabinetId, utilisateur.id, 'demande_info_envoyee',
    `Demande d'informations #${id} envoyée à ${destinataire} (${d.questions.length} question(s)) — mode ${mode === 'simule' ? 'SIMULÉ (aucun compte d\u2019envoi configuré, aucun courriel réel n\u2019est parti)' : 'SMTP via le compte du cabinet'}`);
  return { demande: obtenirDemande(id, cabinetId), mode };
}

// --- Réponses : fermeture des questions -------------------------------------------------
function marquerReponses(id, cabinetId, userId, cles, source = null) {
  const d = obtenirDemande(id, cabinetId);
  if (!d) return { fermees: [] };
  const voulues = new Set(cles || []);
  const fermees = [];
  const horodatage = maintenant();
  for (const q of d.questions) {
    if (voulues.has(q.cle) && q.statut !== 'repondue') {
      q.statut = 'repondue';
      q.repondu_le = horodatage;
      fermees.push(q.cle);
    }
  }
  if (!fermees.length) return { fermees };
  const toutes = d.questions.every((q) => q.statut === 'repondue');
  let statut = d.statut;
  if (toutes && statut !== 'brouillon') statut = 'completee';
  else if (statut === 'envoyee') statut = 'partiellement_completee';
  bd.prepare(`
    UPDATE demandes_infos
    SET questions = ?, statut = ?, completee_le = ${toutes && statut === 'completee' ? "datetime('now')" : 'completee_le'},
        maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(JSON.stringify(d.questions), statut, id, cabinetId);
  journal(cabinetId, userId, 'demande_info_questions_repondues',
    `Demande d'informations #${id} : ${fermees.length} question(s) marquée(s) répondue(s)${source ? ` (${source})` : ''} — reste ${d.questions.filter((q) => q.statut !== 'repondue').length}`);
  if (statut === 'completee') {
    journal(cabinetId, userId, 'demande_info_completee',
      `Demande d'informations #${id} COMPLÉTÉE : toutes les questions ont reçu une réponse`);
  }
  return { fermees, statut };
}

// Ferme les questions dont le manque a disparu de la soumission (recalcul).
function recalculerDepuisSoumission(id, cabinetId, userId, source = 'recalcul après insertion') {
  const d = obtenirDemande(id, cabinetId);
  if (!d) return { fermees: [] };
  const s = chargerSoumission(d.produit, d.soumission_id, cabinetId);
  if (!s) return { fermees: [] };
  const restants = new Set(manquesLib.calculerManques(d.produit, s).map((m) => m.cle));
  const aFermer = d.questions
    .filter((q) => q.statut !== 'repondue' && !restants.has(q.cle))
    .map((q) => q.cle);
  if (!aFermer.length) return { fermees: [] };
  return marquerReponses(id, cabinetId, userId, aFermer, source);
}

// --- Archivage ---------------------------------------------------------------------------
function archiverDemande(id, cabinetId, userId) {
  const d = obtenirDemande(id, cabinetId);
  if (!d) return false;
  bd.prepare("UPDATE demandes_infos SET archive = 1, maj_le = datetime('now') WHERE id = ? AND cabinet_id = ?")
    .run(id, cabinetId);
  journal(cabinetId, userId, 'demande_info_archivee', `Demande d'informations #${id} archivée`);
  return true;
}

function desarchiverDemande(id, cabinetId, userId) {
  const d = obtenirDemande(id, cabinetId, { inclureArchives: true });
  if (!d) return false;
  bd.prepare("UPDATE demandes_infos SET archive = 0, maj_le = datetime('now') WHERE id = ? AND cabinet_id = ?")
    .run(id, cabinetId);
  journal(cabinetId, userId, 'demande_info_desarchivee', `Demande d'informations #${id} désarchivée`);
  return true;
}

module.exports = {
  STATUTS, NOMS_PRODUITS,
  chargerSoumission, genererSujet, genererCorps, questionsDepuisManques,
  creerDemande, creerRelance, obtenirDemande, listerPourSoumission, listerOuvertes,
  brouillonOuvert, sectionPourFiche, majBrouillon, envoyerDemande,
  marquerReponses, recalculerDepuisSoumission, archiverDemande, desarchiverDemande,
};
