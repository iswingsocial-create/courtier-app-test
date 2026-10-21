/**
 * routes/cautionnement.js — Questionnaire de soumission « Cautionnement »
 * (étape 2/10 cautionnement).
 * Soumissions cautionnement : obligations (cautionnements demandés) en nombre
 * illimité, ligne de cautionnement par soumission (limite globale / par projet,
 * fonds de roulement, valeur nette), antécédents (réclamations contre des
 * cautionnements des 5 dernières années), historique de versions.
 * Toute la logique métier passe par lib/cautionnement.js (versionnage
 * automatique, journal d'audit, filtre cabinet_id).
 * Règle d'or : archivage, jamais de DELETE.
 * Miroir de routes/flotte.js. Étape 3/10 : conversion en police (ligne
 * 'cautionnement', polices.caut_soumission_id + version figée), avenants.
 *
 * Le cautionnement n'est pas une assurance : garantie à trois parties —
 * caution (assureur), principal (l'entrepreneur, entreprise cliente) et
 * bénéficiaire/obligé (le donneur d'ouvrage).
 */
const express = require('express');
const demandesInfos = require('../lib/demandes-infos');
const marche = require('../lib/marche');

const bd = require('../lib/bd');
const caut = require('../lib/cautionnement');
const propositionCaut = require('../lib/proposition-cautionnement');
const { genererPropositionCautPdf } = require('../lib/proposition-cautionnement-pdf');
const { creerVersionPolice } = require('./polices');
const {
  exigeAuth, exigeMotDePasseChange, estCourtier,
  clausePortefeuille, clientHorsPortefeuille, reponseHorsPortefeuille, journal,
} = require('../lib/middleware');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const NOMS_STATUTS_SOUMISSION = {
  brouillon: 'Brouillon',
  soumise: 'Soumise',
  convertie_police: 'Convertie en police',
};
// Types de cautionnement (codes de lib/cautionnement.js).
const NOMS_TYPES_OBLIGATION = {
  soumission: 'Cautionnement de soumission',
  execution: 'Cautionnement d’exécution',
  paiement_mo: 'Cautionnement de paiement de la main-d’œuvre et des matériaux',
  rbq: 'Cautionnement de licence RBQ',
  autre: 'Autre cautionnement',
};
// Consentements antécédents (clés JSON de caut_antecedents.consentements).
const CONSENTEMENTS_CAUT = [
  ['credit', 'Dossier de crédit'],
  ['etats_financiers', 'États financiers'],
];

// --- Utilitaires ------------------------------------------------------------
function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

// Police liée à une soumission (1 soumission → 1 police).
function policeLiee(soumissionId, cabinetId) {
  return bd.prepare('SELECT * FROM polices WHERE caut_soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
}

// Avenant en cours de terme : toute modification de l'en-tête / des obligations /
// de la ligne / des antécédents / du statut d'une soumission convertie crée une
// version de la police avec note (règle d'or : jamais de modification silencieuse).
function noterAvenantPolice(soumissionId, cabinetId, userId, note) {
  const p = policeLiee(soumissionId, cabinetId);
  if (p) creerVersionPolice(p.id, userId, note);
}

// Soumission du cabinet + contrôle du portefeuille courtier.
function soumissionAutorisee(req, res, inclureArchives) {
  const s = caut.obtenirSoumission(Number(req.params.id), res.locals.cabinetId,
    { inclureArchives: !!inclureArchives });
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return s;
}

function lireNombrePositif(raw) {
  if (raw === '' || raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (isNaN(n) || n < 0) throw new Error('Montant invalide.');
  return n;
}

function lireEntierPositif(raw) {
  if (raw === '' || raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error('Nombre invalide.');
  return n;
}

function lireTexte(raw) {
  return (raw || '').trim() || null;
}

function lireDate(raw, libelle) {
  const v = (raw || '').trim();
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${libelle} invalide (AAAA-MM-JJ).`);
  return v || null;
}

// --- En-tête ------------------------------------------------------------------
function lireEnteteForm(req, cabinetId, erreurs) {
  const clientId = Number(req.body.client_id);
  if (!clientId) erreurs.push('L’entreprise cliente (le principal) est requise.');
  else {
    const c = bd.prepare('SELECT id FROM clients WHERE id = ? AND cabinet_id = ? AND archive = 0')
      .get(clientId, cabinetId);
    if (!c) erreurs.push('Entreprise invalide.');
    else if (clientHorsPortefeuille(cabinetId, req.utilisateur, c.id)) {
      erreurs.push('Cette entreprise n’est pas dans votre portefeuille.');
    }
  }
  for (const champ of ['date_effet_souhaitee', 'date_echeance_visee']) {
    const v = (req.body[champ] || '').trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) erreurs.push('Date invalide (AAAA-MM-JJ).');
  }
  let anneeFondation = null;
  let chiffreAffaires = null;
  let nbEmployes = null;
  try { anneeFondation = lireEntierPositif(req.body.annee_fondation); } catch { erreurs.push('Année de fondation invalide.'); }
  try { chiffreAffaires = lireNombrePositif(req.body.chiffre_affaires); } catch { erreurs.push('Chiffre d’affaires invalide.'); }
  try { nbEmployes = lireEntierPositif(req.body.nb_employes); } catch { erreurs.push('Nombre d’employés invalide.'); }
  return {
    client_id: clientId || null,
    assureur: lireTexte(req.body.assureur),
    numero_police: lireTexte(req.body.numero_police),
    secteur_activite: lireTexte(req.body.secteur_activite),
    annee_fondation: anneeFondation,
    chiffre_affaires: chiffreAffaires,
    nb_employes: nbEmployes,
    date_effet_souhaitee: lireTexte(req.body.date_effet_souhaitee),
    date_echeance_visee: lireTexte(req.body.date_echeance_visee),
    notes: lireTexte(req.body.notes),
  };
}

// --- Obligations ------------------------------------------------------------------
// Réclamations (antécédents) : une par ligne, « AAAA-MM-JJ | cautionnement | montant | statut ».
function parserReclamations(texte) {
  if (!texte) return [];
  return String(texte).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const cols = l.split('|').map((x) => (x || '').trim());
    const montant = cols[2] === undefined || cols[2] === '' ? null : Number(cols[2]);
    return {
      date: cols[0] || '',
      cautionnement: cols[1] || '',
      montant: montant !== null && isNaN(montant) ? null : montant,
      statut: cols[3] || '',
    };
  }).filter((o) => o.date || o.cautionnement);
}
function serialiserReclamations(liste) {
  if (!Array.isArray(liste)) return '';
  return liste.map((x) => [x.date || '', x.cautionnement || '',
    x.montant === null || x.montant === undefined ? '' : x.montant, x.statut || ''].join(' | ')).join('\n');
}

function lireObligationForm(body) {
  const type = lireTexte(body.type);
  if (type && !caut.TYPES_OBLIGATION.includes(type)) throw new Error('Type de cautionnement invalide.');
  return {
    type,
    beneficiaire: lireTexte(body.beneficiaire),
    description_projet: lireTexte(body.description_projet),
    montant_contrat: lireNombrePositif(body.montant_contrat),
    montant_cautionnement: lireNombrePositif(body.montant_cautionnement),
    taux_pct: lireNombrePositif(body.taux_pct),
    prime_estimee: lireNombrePositif(body.prime_estimee),
    date_debut: lireDate(body.date_debut, 'Date de début'),
    duree_mois: lireEntierPositif(body.duree_mois),
  };
}

// Consentement présent ? (format plat {code:1} de l'UI, ou format semé {code:{accepte:true}}).
function consentementActif(consentements, code) {
  if (!consentements) return false;
  const v = consentements[code];
  return !!(v === 1 || v === true || (v && v.accepte));
}

// --- Liste ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const cabinetId = res.locals.cabinetId;
  const voirArchives = req.query.archives === '1';
  const statut = caut.STATUTS_SOUMISSION.includes(req.query.statut) ? req.query.statut : '';
  let sql = `
    SELECT s.*, c.raison_sociale AS client_nom,
      (SELECT COUNT(*) FROM caut_obligations WHERE soumission_id = s.id AND archive = 0) AS nb_obligations,
      (SELECT limite_globale FROM caut_garanties WHERE soumission_id = s.id AND archive = 0) AS limite_globale,
      (SELECT limite_par_projet FROM caut_garanties WHERE soumission_id = s.id AND archive = 0) AS limite_par_projet
    FROM caut_soumissions s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.cabinet_id = ? AND s.archive = ${voirArchives ? '1' : '0'}`;
  const params = [cabinetId];
  if (statut) { sql += ' AND s.statut = ?'; params.push(statut); }
  if (estCourtier(req)) sql += ` AND c.responsable_id = ${Number(req.utilisateur.id)}`;
  sql += ' ORDER BY s.id DESC';
  const soumissions = bd.prepare(sql).all(...params);
  res.render('cautionnement/liste', {
    soumissions, voirArchives, statut,
    NOMS_STATUTS_SOUMISSION,
  });
});

// --- Nouvelle soumission --------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  const entreprises = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  res.render('cautionnement/formulaire', {
    erreur: null, valeurs: {}, entreprises,
  });
});

router.post('/', (req, res) => {
  const cabinetId = res.locals.cabinetId;
  const erreurs = [];
  const entete = lireEnteteForm(req, cabinetId, erreurs);
  if (erreurs.length) {
    const entreprises = bd.prepare(
      'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
      + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
    ).all(cabinetId);
    return res.status(400).render('cautionnement/formulaire', {
      erreur: erreurs.join(' '), valeurs: req.body, entreprises,
    });
  }
  let id;
  try {
    id = caut.creerSoumission({
      cabinetId,
      userId: req.utilisateur.id,
      clientId: entete.client_id,
      assureur: entete.assureur,
      numeroPolice: entete.numero_police,
      responsableId: req.utilisateur.id,
      secteurActivite: entete.secteur_activite,
      anneeFondation: entete.annee_fondation,
      chiffreAffaires: entete.chiffre_affaires,
      nbEmployes: entete.nb_employes,
      dateEffetSouhaitee: entete.date_effet_souhaitee,
      dateEcheanceVisee: entete.date_echeance_visee,
      notes: entete.notes,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Création impossible', e.message);
  }
  res.redirect('/cautionnement/' + id);
});

// --- Fiche ----------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  const versions = caut.versionsSoumission(s.id, res.locals.cabinetId);
  const police = policeLiee(s.id, res.locals.cabinetId);
  let policesDispo = [];
  let assureurs = [];
  if (!police && s.statut !== 'convertie_police') {
    policesDispo = bd.prepare(`
      SELECT id, numero_police FROM polices
      WHERE cabinet_id = ? AND client_id = ? AND ligne = 'cautionnement' AND caut_soumission_id IS NULL
      ORDER BY numero_police
    `).all(res.locals.cabinetId, s.client_id);
    assureurs = bd.prepare('SELECT id, nom FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom')
      .all(res.locals.cabinetId);
  }
  const entreprises = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  const certificats = bd.prepare('SELECT * FROM caut_certificats WHERE soumission_id = ? AND archive = 0 ORDER BY date_fin')
    .all(s.id);
  res.render('cautionnement/fiche', { certificats, sectionDemandes: demandesInfos.sectionPourFiche('cautionnement', s, req.utilisateur.cabinet_id),
    sectionMarche: marche.sectionPourCible(req.utilisateur.cabinet_id, { produit: 'cautionnement', soumissionId: s.id }), NOMS_STATUTS_ENVOI: marche.NOMS_STATUTS_ENVOI, 
    s,
    clientNom: client ? client.raison_sociale : '—',
    versions,
    policeLiee: police || null,
    policesDispo,
    assureurs,
    entreprises,
    NOMS_STATUTS_SOUMISSION, NOMS_TYPES_OBLIGATION,
    CONSENTEMENTS_CAUT,
    reclamationsTexte: serialiserReclamations(s.antecedents ? s.antecedents.reclamations_5ans : null),
    consentementActif,
  });
});

// --- Certificats de cautionnement (continuation, ex. bénéficiaire RBQ) -------------------------
// Un certificat émis se suit par sa date de fin : elle alimente le
// tableau des échéances (suivis sans faute). Le certificat de
// continuation type prolonge un cautionnement d'un an.
router.post('/:id/certificats', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  if (!s.client_id) return pageErreur(res, 400, 'Client requis', 'Rattachez d’abord la soumission à une entreprise.');
  const police = policeLiee(s.id, res.locals.cabinetId);
  bd.prepare(`
    INSERT INTO caut_certificats (cabinet_id, client_id, police_id, soumission_id, numero, type,
      beneficiaire, montant, date_debut, date_fin, mandataire_nom, mandataire_titre, mention_non_transmission)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, s.client_id, police ? police.id : null, s.id,
    String(req.body.numero || '').trim() || null,
    String(req.body.type || 'continuation').trim() || 'continuation',
    String(req.body.beneficiaire || '').trim() || null,
    lireNombrePositif(req.body.montant),
    req.body.date_debut || null, req.body.date_fin || null,
    String(req.body.mandataire_nom || '').trim() || null,
    String(req.body.mandataire_titre || '').trim() || null,
    req.body.mention_non_transmission ? 1 : 0);
  journal(res.locals.cabinetId, req.utilisateur.id, 'caut_certificat_cree',
    `Certificat de cautionnement sur soumission id ${s.id} (fin ${req.body.date_fin || '—'})`);
  res.redirect('/cautionnement/' + s.id);
});

router.post('/certificats/:cid/archiver', (req, res) => {
  const cert = bd.prepare('SELECT * FROM caut_certificats WHERE id = ? AND cabinet_id = ?')
    .get(req.params.cid, res.locals.cabinetId);
  if (!cert) return pageErreur(res, 404, 'Introuvable', 'Certificat introuvable.');
  bd.prepare('UPDATE caut_certificats SET archive = 1 WHERE id = ?').run(cert.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'caut_certificat_archive', `Certificat id ${cert.id} archivé`);
  res.redirect('/cautionnement/' + cert.soumission_id);
});

router.post('/certificats/:cid/transmis', (req, res) => {
  const cert = bd.prepare('SELECT * FROM caut_certificats WHERE id = ? AND cabinet_id = ?')
    .get(req.params.cid, res.locals.cabinetId);
  if (!cert) return pageErreur(res, 404, 'Introuvable', 'Certificat introuvable.');
  bd.prepare('UPDATE caut_certificats SET transmis_le = ? WHERE id = ?')
    .run(req.body.transmis_le || new Date().toISOString().slice(0, 10), cert.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'caut_certificat_transmis', `Certificat id ${cert.id} marqué transmis`);
  res.redirect('/cautionnement/' + cert.soumission_id);
});

router.get('/certificats/:cid/impression', (req, res) => {
  const cert = bd.prepare('SELECT * FROM caut_certificats WHERE id = ? AND cabinet_id = ?')
    .get(req.params.cid, res.locals.cabinetId);
  if (!cert) return pageErreur(res, 404, 'Introuvable', 'Certificat introuvable.');
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?')
    .get(cert.client_id, res.locals.cabinetId);
  const cabinet = bd.prepare('SELECT * FROM cabinets WHERE id = ?').get(res.locals.cabinetId);
  res.render('cautionnement/certificat-continuation', { cert, client, cabinet });
});

// --- Modifier l'en-tête ---------------------------------------------------------------------
router.post('/:id/entete', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const erreurs = [];
  const entete = lireEnteteForm(req, res.locals.cabinetId, erreurs);
  if (erreurs.length) return pageErreur(res, 400, 'Modification impossible', erreurs.join(' '));
  try {
    caut.modifierSoumission(s.id, res.locals.cabinetId, req.utilisateur.id, entete);
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — en-tête modifié (soumission cautionnement #${s.id})`);
  res.redirect('/cautionnement/' + s.id);
});

// --- Ajouter une obligation ---------------------------------------------------------------------
router.post('/:id/obligation', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    caut.ajouterObligation(s.id, res.locals.cabinetId, req.utilisateur.id, lireObligationForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — obligation ajoutée (soumission cautionnement #${s.id})`);
  res.redirect('/cautionnement/' + s.id + '#obligations');
});

// --- Modifier / archiver / désarchiver une obligation ------------------------------------------
function obligationDuCabinet(req, res) {
  const o = bd.prepare('SELECT * FROM caut_obligations WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.params.oid), res.locals.cabinetId);
  if (!o) { pageErreur(res, 404, 'Introuvable', 'Obligation introuvable.'); return null; }
  const s = caut.obtenirSoumission(o.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { obligation: o, soumission: s };
}

router.post('/obligation/:oid', (req, res) => {
  const ctx = obligationDuCabinet(req, res);
  if (!ctx) return;
  try {
    caut.modifierObligation(ctx.obligation.id, res.locals.cabinetId, req.utilisateur.id, lireObligationForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — obligation modifiée (soumission cautionnement #${ctx.soumission.id})`);
  res.redirect('/cautionnement/' + ctx.soumission.id + '#obligations');
});

router.post('/obligation/:oid/archiver', (req, res) => {
  const ctx = obligationDuCabinet(req, res);
  if (!ctx) return;
  caut.archiverObligation(ctx.obligation.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — obligation archivée (soumission cautionnement #${ctx.soumission.id})`);
  res.redirect('/cautionnement/' + ctx.soumission.id + '#obligations');
});

router.post('/obligation/:oid/desarchiver', (req, res) => {
  const ctx = obligationDuCabinet(req, res);
  if (!ctx) return;
  caut.desarchiverObligation(ctx.obligation.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — obligation désarchivée (soumission cautionnement #${ctx.soumission.id})`);
  res.redirect('/cautionnement/' + ctx.soumission.id + '#obligations');
});

// --- Ligne de cautionnement ---------------------------------------------------------------------
router.post('/:id/garanties', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    caut.definirGaranties(s.id, res.locals.cabinetId, req.utilisateur.id, {
      limite_globale: lireNombrePositif(req.body.limite_globale),
      limite_par_projet: lireNombrePositif(req.body.limite_par_projet),
      fonds_roulement: lireNombrePositif(req.body.fonds_roulement),
      valeur_nette: lireNombrePositif(req.body.valeur_nette),
      prime: lireNombrePositif(req.body.prime),
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — ligne de cautionnement modifiée (soumission cautionnement #${s.id})`);
  res.redirect('/cautionnement/' + s.id + '#garanties');
});

// --- Antécédents --------------------------------------------------------------------------------
router.post('/:id/antecedents', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const consentements = {};
  for (const [code] of CONSENTEMENTS_CAUT) {
    if (req.body['consentement_' + code] === 'on') consentements[code] = 1;
  }
  try {
    caut.definirAntecedents(s.id, res.locals.cabinetId, req.utilisateur.id, {
      assureur_actuel: lireTexte(req.body.assureur_actuel),
      numero_ligne_actuelle: lireTexte(req.body.numero_ligne_actuelle),
      date_expiration_actuelle: lireDate(req.body.date_expiration_actuelle, 'Date d’expiration'),
      annees_cautionnement_continu: lireEntierPositif(req.body.annees_cautionnement_continu),
      reclamations_5ans: parserReclamations(req.body.reclamations_5ans),
      refus_resiliation_ant: req.body.refus_resiliation_ant === 'on' ? 1 : 0,
      refus_resiliation_details: lireTexte(req.body.refus_resiliation_details),
      consentements,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — antécédents modifiés (soumission cautionnement #${s.id})`);
  res.redirect('/cautionnement/' + s.id + '#antecedents');
});

// --- Changer le statut ---------------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const statut = String(req.body.statut || '');
  if (!caut.STATUTS_SOUMISSION.includes(statut)) {
    return pageErreur(res, 400, 'Statut invalide', 'Le statut demandé est invalide.');
  }
  caut.changerStatutSoumission(s.id, res.locals.cabinetId, req.utilisateur.id, statut);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — statut modifié (soumission cautionnement #${s.id})`);
  res.redirect('/cautionnement/' + s.id);
});

// --- Archiver / désarchiver la soumission ------------------------------------------------------------
router.post('/:id/archiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  caut.archiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — soumission archivée (soumission cautionnement #${s.id})`);
  res.redirect('/cautionnement');
});

router.post('/:id/desarchiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  caut.desarchiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/cautionnement/' + s.id);
});

// --- Convertir en police ----------------------------------------------------------------------------
// Miroir de POST /flotte/:id/convertir (ligne 'cautionnement').
router.post('/:id/convertir', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const cabinetId = res.locals.cabinetId;
  if (s.statut === 'convertie_police' || policeLiee(s.id, cabinetId)) {
    return pageErreur(res, 400, 'Déjà convertie', 'Cette soumission est déjà liée à une police.');
  }
  const erreurs = [];
  const numero = (req.body.numero_police || '').trim();
  if (numero.length < 2) erreurs.push('Le numéro de police est requis.');
  const assureur = bd.prepare('SELECT id, nom FROM assureurs WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(Number(req.body.assureur_id), cabinetId);
  if (!assureur) erreurs.push('Assureur invalide.');
  const dateEffet = (req.body.date_effet || '').trim() || s.date_effet_souhaitee || '';
  const dateEcheance = (req.body.date_echeance || '').trim() || s.date_echeance_visee || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEffet)) erreurs.push('Date d’effet invalide (AAAA-MM-JJ).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEcheance)) erreurs.push('Date d’échéance invalide (AAAA-MM-JJ).');
  if (dateEffet && dateEcheance && dateEcheance <= dateEffet) erreurs.push('L’échéance doit être après la date d’effet.');
  const franchise = req.body.franchise === '' || req.body.franchise == null ? 0 : Number(req.body.franchise);
  if (isNaN(franchise) || franchise < 0) erreurs.push('Franchise invalide.');
  if (erreurs.length) return pageErreur(res, 400, 'Conversion impossible', erreurs.join(' '));
  const cli = bd.prepare('SELECT responsable_id FROM clients WHERE id = ?').get(s.client_id);
  const responsableId = cli && cli.responsable_id ? cli.responsable_id : req.utilisateur.id;
  try {
    const r = bd.prepare(`
      INSERT INTO polices (cabinet_id, client_id, ligne, assureur, assureur_id, numero_police,
        date_effet, date_echeance, franchise, statut, notes, responsable_id)
      VALUES (?, ?, 'cautionnement', ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(cabinetId, s.client_id, assureur.nom, assureur.id, numero, dateEffet, dateEcheance,
      franchise, `Convertie de la soumission cautionnement #${s.id}`, responsableId);
    const policeId = r.lastInsertRowid;
    const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM caut_soumission_versions WHERE soumission_id = ?')
      .get(s.id).m;
    bd.prepare('UPDATE polices SET caut_soumission_id = ?, caut_soumission_version = ? WHERE id = ?')
      .run(s.id, versionFige, policeId);
    caut.noterConversion(s.id, cabinetId, req.utilisateur.id, policeId);
    creerVersionPolice(policeId, req.utilisateur.id); // v1
    journal(cabinetId, req.utilisateur.id, 'police_creee',
      `Police ${numero} (id ${policeId}) convertie de la soumission cautionnement #${s.id}`);
    res.redirect('/echeances/police/' + policeId);
  } catch (e) {
    const msg = String(e.message || '').includes('UNIQUE')
      ? 'Ce numéro de police existe déjà dans votre cabinet.' : 'Erreur d’enregistrement.';
    return pageErreur(res, 400, 'Conversion impossible', msg);
  }
});

// Lier une police cautionnement existante (même entreprise, non liée) à la soumission.
router.post('/:id/lier-police', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const cabinetId = res.locals.cabinetId;
  if (s.statut === 'convertie_police' || policeLiee(s.id, cabinetId)) {
    return pageErreur(res, 400, 'Déjà convertie', 'Cette soumission est déjà liée à une police.');
  }
  const p = bd.prepare('SELECT * FROM polices WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.body.police_id), cabinetId);
  if (!p) return pageErreur(res, 400, 'Police invalide', 'Police introuvable.');
  if (p.ligne !== 'cautionnement') return pageErreur(res, 400, 'Police invalide', 'Seule une police cautionnement peut être liée.');
  if (p.caut_soumission_id) return pageErreur(res, 400, 'Police invalide', 'Cette police est déjà liée à une soumission.');
  if (p.client_id !== s.client_id) return pageErreur(res, 400, 'Police invalide', 'La police doit appartenir à la même entreprise que la soumission.');
  if (estCourtier(req) && clientHorsPortefeuille(cabinetId, req.utilisateur, p.client_id)) return reponseHorsPortefeuille(res);
  const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM caut_soumission_versions WHERE soumission_id = ?')
    .get(s.id).m;
  bd.prepare('UPDATE polices SET caut_soumission_id = ?, caut_soumission_version = ? WHERE id = ? AND cabinet_id = ?')
    .run(s.id, versionFige, p.id, cabinetId);
  caut.noterConversion(s.id, cabinetId, req.utilisateur.id, p.id);
  creerVersionPolice(p.id, req.utilisateur.id, `Liée à la soumission cautionnement #${s.id}`);
  journal(cabinetId, req.utilisateur.id, 'police_liee_soumission',
    `Police id ${p.id} liée à la soumission cautionnement #${s.id}`);
  res.redirect('/echeances/police/' + p.id);
});

// --- Version en lecture seule -------------------------------------------------------------------------
router.get('/:id/versions/:v', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const version = caut.obtenirVersion(s.id, Number(req.params.v), res.locals.cabinetId);
  if (!version) return pageErreur(res, 404, 'Introuvable', 'Version introuvable.');
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  res.render('cautionnement/version', {
    s,
    version,
    clientNom: client ? client.raison_sociale : '—',
    NOMS_STATUTS_SOUMISSION, NOMS_TYPES_OBLIGATION,
    CONSENTEMENTS_CAUT,
    consentementActif,
  });
});

// --- Proposition pré-remplie : HTML imprimable + PDF -------------------------------------
// ?v=N : génère à partir d'une version figée (règle d'or : traçabilité).
// Lecture seule : la proposition ne modifie JAMAIS la soumission.
// Miroir de routes/flotte.js (étape 7/10 flotte).
function donneesPropositionCaut(req, res) {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return null;
  const vParam = req.query.v ? Number(req.query.v) : null;
  const p = propositionCaut.preparerPropositionCaut(res.locals.cabinetId, s, vParam);
  if (!p) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (p.erreur === 'version') { pageErreur(res, 404, 'Introuvable', 'Version introuvable.'); return null; }
  return { p, vParam };
}

router.get('/:id/proposition', (req, res) => {
  const r = donneesPropositionCaut(req, res);
  if (!r) return;
  journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_cautionnement_generee',
    `Proposition cautionnement #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, HTML) générée`);
  res.render('cautionnement/proposition', { p: r.p, vParam: r.vParam });
});

router.get('/:id/proposition.pdf', (req, res) => {
  const r = donneesPropositionCaut(req, res);
  if (!r) return;
  genererPropositionCautPdf(r.p).then((pdf) => {
    journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_cautionnement_generee',
      `Proposition cautionnement #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, PDF) générée`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="proposition-cautionnement-${r.p.soumissionId}-v${r.p.versionNumero}.pdf"`);
    res.send(pdf);
  }).catch(() => pageErreur(res, 500, 'Erreur', 'Génération du PDF impossible.'));
});

module.exports = router;
module.exports.NOMS_STATUTS_SOUMISSION = NOMS_STATUTS_SOUMISSION;
module.exports.NOMS_TYPES_OBLIGATION = NOMS_TYPES_OBLIGATION;
module.exports.CONSENTEMENTS_CAUT = CONSENTEMENTS_CAUT;
module.exports.parserReclamations = parserReclamations;
module.exports.serialiserReclamations = serialiserReclamations;
