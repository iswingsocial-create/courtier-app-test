/**
 * routes/rc.js — Questionnaire de soumission « RC commerciale » (étape 2/10 RC).
 * Soumissions de responsabilité civile générale : lieux d'exploitation en nombre
 * illimité, garanties par lieu, antécédents, historique de versions.
 * Toute la logique métier passe par lib/rc.js (versionnage automatique,
 * journal d'audit, filtre cabinet_id). Règle d'or : archivage, jamais de DELETE.
 * Miroir de routes/biens.js (la conversion en police arrivera à l'étape 3).
 */
const express = require('express');
const demandesInfos = require('../lib/demandes-infos');

const bd = require('../lib/bd');
const rc = require('../lib/rc');
const propositionRc = require('../lib/proposition-rc');
const { genererPropositionRcPdf } = require('../lib/proposition-rc-pdf');
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
const SOUS_TRAITANTS = ['aucun', 'assures', 'non_assures'];
const NOMS_SOUS_TRAITANT = {
  aucun: 'Aucun',
  assures: 'Assurés',
  non_assures: 'Non assurés',
};
const FORMULES_RC = ['locaux_operations', 'produits_completes', 'globale'];
const NOMS_FORMULE_RC = {
  locaux_operations: 'Locaux et opérations',
  produits_completes: 'Produits et opérations complétées',
  globale: 'Globale',
};
const AVENANTS_RC = [
  ['pollution', 'Pollution'],
  ['parapluie', 'Parapluie'],
];

// --- Utilitaires ------------------------------------------------------------
function asArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

// Lignes dynamiques sérialisées en JSON par le JS (public/app.js).
function parseLignesJson(raw, cles) {
  if (!raw) return [];
  let arr;
  try { arr = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const o = {};
      for (const k of cles) o[k] = String(r[k] === undefined || r[k] === null ? '' : r[k]).trim();
      return o;
    })
    .filter((o) => Object.values(o).some((v) => v !== ''));
}

function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

// Police liée à une soumission (1 soumission → 1 police).
function policeLiee(soumissionId, cabinetId) {
  return bd.prepare('SELECT * FROM polices WHERE rc_soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
}

// Avenant en cours de terme : toute modification des lieux d'exploitation/
// garanties/antécédents/statut d'une soumission convertie crée une version de la
// police avec note (règle d'or : jamais de modification silencieuse).
function noterAvenantPolice(soumissionId, cabinetId, userId, note) {
  const p = policeLiee(soumissionId, cabinetId);
  if (p) creerVersionPolice(p.id, userId, note);
}

// Soumission du cabinet + contrôle du portefeuille courtier.
function soumissionAutorisee(req, res, inclureArchives) {
  const s = rc.obtenirSoumission(Number(req.params.id), res.locals.cabinetId,
    { inclureArchives: !!inclureArchives });
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return s;
}

// --- Liste --------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const cabinetId = res.locals.cabinetId;
  const voirArchives = req.query.archives === '1';
  const statut = rc.STATUTS_SOUMISSION.includes(req.query.statut) ? req.query.statut : '';
  let sql = `
    SELECT s.*, c.raison_sociale AS client_nom,
      (SELECT COUNT(*) FROM rc_exploitations WHERE soumission_id = s.id AND archive = 0) AS nb_exploitations
    FROM rc_soumissions s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.cabinet_id = ? AND s.archive = ${voirArchives ? '1' : '0'}`;
  const params = [cabinetId];
  if (statut) { sql += ' AND s.statut = ?'; params.push(statut); }
  if (estCourtier(req)) sql += ` AND c.responsable_id = ${Number(req.utilisateur.id)}`;
  sql += ' ORDER BY s.id DESC';
  const soumissions = bd.prepare(sql).all(...params);
  res.render('rc/liste', { soumissions, voirArchives, statut, NOMS_STATUTS_SOUMISSION });
});

// --- Nouvelle soumission ------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  const entreprises = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  res.render('rc/formulaire', { erreur: null, valeurs: {}, entreprises });
});

router.post('/', (req, res) => {
  const cabinetId = res.locals.cabinetId;
  const erreurs = [];
  const clientId = Number(req.body.client_id);
  if (!clientId) erreurs.push('L’entreprise cliente est requise.');
  else {
    const c = bd.prepare('SELECT id FROM clients WHERE id = ? AND cabinet_id = ? AND archive = 0')
      .get(clientId, cabinetId);
    if (!c) erreurs.push('Entreprise invalide.');
    else if (clientHorsPortefeuille(cabinetId, req.utilisateur, c.id)) {
      erreurs.push('Cette entreprise n’est pas dans votre portefeuille.');
    }
  }
  const dateEffet = (req.body.date_effet_souhaitee || '').trim();
  if (dateEffet && !/^\d{4}-\d{2}-\d{2}$/.test(dateEffet)) erreurs.push('Date d’effet invalide (AAAA-MM-JJ).');
  if (erreurs.length) {
    const entreprises = bd.prepare(
      'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
      + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
    ).all(cabinetId);
    return res.status(400).render('rc/formulaire', {
      erreur: erreurs.join(' '), valeurs: req.body, entreprises,
    });
  }
  const id = rc.creerSoumission({
    cabinetId,
    userId: req.utilisateur.id,
    clientId,
    dateEffetSouhaitee: dateEffet || null,
    notes: (req.body.notes || '').trim() || null,
  });
  res.redirect('/rc/' + id);
});

// --- Fiche --------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  const versions = rc.versionsSoumission(s.id, res.locals.cabinetId);
  const police = policeLiee(s.id, res.locals.cabinetId);
  let policesDispo = [];
  let assureurs = [];
  if (!police && s.statut !== 'convertie_police') {
    policesDispo = bd.prepare(`
      SELECT id, numero_police FROM polices
      WHERE cabinet_id = ? AND client_id = ? AND ligne = 'cgl' AND rc_soumission_id IS NULL
      ORDER BY numero_police
    `).all(res.locals.cabinetId, s.client_id);
    assureurs = bd.prepare('SELECT id, nom FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom')
      .all(res.locals.cabinetId);
  }
  res.render('rc/fiche', { sectionDemandes: demandesInfos.sectionPourFiche('rc', s, req.utilisateur.cabinet_id), 
    s,
    clientNom: client ? client.raison_sociale : '—',
    versions,
    policeLiee: police || null,
    policesDispo,
    assureurs,
    NOMS_STATUTS_SOUMISSION, SOUS_TRAITANTS, NOMS_SOUS_TRAITANT,
    FORMULES_RC, NOMS_FORMULE_RC, AVENANTS_RC,
  });
});

// --- Proposition pré-remplie : HTML imprimable + PDF ----------------------------------------
// ?v=N : génère à partir d'une version figée (règle d'or : traçabilité).
// Lecture seule : la proposition ne modifie JAMAIS la soumission.
// Miroir de routes/biens.js (étape 7/10 biens).
function donneesPropositionRc(req, res) {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return null;
  const vParam = req.query.v ? Number(req.query.v) : null;
  const p = propositionRc.preparerPropositionRc(res.locals.cabinetId, s, vParam);
  if (!p) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (p.erreur === 'version') { pageErreur(res, 404, 'Introuvable', 'Version introuvable.'); return null; }
  return { p, vParam };
}

router.get('/:id/proposition', (req, res) => {
  const r = donneesPropositionRc(req, res);
  if (!r) return;
  journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_rc_generee',
    `Proposition RC #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, HTML) générée`);
  res.render('rc/proposition', { p: r.p, vParam: r.vParam });
});

router.get('/:id/proposition.pdf', (req, res) => {
  const r = donneesPropositionRc(req, res);
  if (!r) return;
  genererPropositionRcPdf(r.p).then((pdf) => {
    journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_rc_generee',
      `Proposition RC #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, PDF) générée`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="proposition-rc-${r.p.soumissionId}-v${r.p.versionNumero}.pdf"`);
    res.send(pdf);
  }).catch(() => pageErreur(res, 500, 'Erreur', 'Génération du PDF impossible.'));
});

// --- Ajouter un lieu d'exploitation ---------------------------------------------------------
function lireExploitationForm(body) {
  const d = {
    adresse: (body.adresse || '').trim() || null,
    ville: (body.ville || '').trim() || null,
    code_postal: (body.code_postal || '').trim() || null,
    type_activite: (body.type_activite || '').trim() || null,
    code_classification: (body.code_classification || '').trim() || null,
    description_activites: (body.description_activites || '').trim() || null,
    chiffre_affaires: body.chiffre_affaires ? Number(body.chiffre_affaires) : null,
    masse_salariale: body.masse_salariale ? Number(body.masse_salariale) : null,
    nb_employes: body.nb_employes ? Number(body.nb_employes) : null,
    superficie_pi2: body.superficie_pi2 ? Number(body.superficie_pi2) : null,
    sous_traitants: (body.sous_traitants || '').trim() || null,
    notes: (body.notes || '').trim() || null,
  };
  if (d.sous_traitants && !SOUS_TRAITANTS.includes(d.sous_traitants)) {
    throw new Error('Valeur de sous-traitants invalide.');
  }
  return d;
}

router.post('/:id/exploitation', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    rc.ajouterExploitation(s.id, res.locals.cabinetId, req.utilisateur.id, lireExploitationForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — lieu d’exploitation ajouté (soumission RC #${s.id})`);
  res.redirect('/rc/' + s.id + '#exploitations');
});

// --- Modifier / archiver / désarchiver un lieu d'exploitation --------------------------------
function exploitationDuCabinet(req, res) {
  const e = bd.prepare('SELECT * FROM rc_exploitations WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.params.eid), res.locals.cabinetId);
  if (!e) { pageErreur(res, 404, 'Introuvable', 'Lieu d’exploitation introuvable.'); return null; }
  const s = rc.obtenirSoumission(e.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { exploitation: e, soumission: s };
}

router.post('/exploitation/:eid', (req, res) => {
  const ctx = exploitationDuCabinet(req, res);
  if (!ctx) return;
  try {
    rc.modifierExploitation(ctx.exploitation.id, res.locals.cabinetId, req.utilisateur.id, lireExploitationForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — lieu d’exploitation modifié (soumission RC #${ctx.soumission.id})`);
  res.redirect('/rc/' + ctx.soumission.id + '#exploitations');
});

router.post('/exploitation/:eid/archiver', (req, res) => {
  const ctx = exploitationDuCabinet(req, res);
  if (!ctx) return;
  rc.archiverExploitation(ctx.exploitation.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — lieu d’exploitation archivé (soumission RC #${ctx.soumission.id})`);
  res.redirect('/rc/' + ctx.soumission.id + '#exploitations');
});

router.post('/exploitation/:eid/desarchiver', (req, res) => {
  const ctx = exploitationDuCabinet(req, res);
  if (!ctx) return;
  rc.desarchiverExploitation(ctx.exploitation.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — lieu d’exploitation désarchivé (soumission RC #${ctx.soumission.id})`);
  res.redirect('/rc/' + ctx.soumission.id + '#exploitations');
});

// --- Garanties d'un lieu d'exploitation ------------------------------------------------------
router.post('/:id/exploitation/:eid/garanties', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const e = bd.prepare(`
    SELECT id FROM rc_exploitations
    WHERE id = ? AND soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(Number(req.params.eid), s.id, res.locals.cabinetId);
  if (!e) return pageErreur(res, 404, 'Introuvable', 'Lieu d’exploitation introuvable.');
  const formule = (req.body.formule || '').trim() || null;
  if (formule && !FORMULES_RC.includes(formule)) {
    return pageErreur(res, 400, 'Valeur invalide', 'Formule de garantie invalide.');
  }
  const avenants = {};
  for (const code of asArray(req.body.avenants)) {
    if (AVENANTS_RC.some(([c]) => c === code)) avenants[code] = 1;
  }
  try {
    rc.definirGaranties(e.id, res.locals.cabinetId, req.utilisateur.id, {
      limite_par_sinistre: req.body.limite_par_sinistre ? Number(req.body.limite_par_sinistre) : null,
      limite_agregat: req.body.limite_agregat ? Number(req.body.limite_agregat) : null,
      franchise: req.body.franchise ? Number(req.body.franchise) : null,
      formule,
      avenants,
      prime: req.body.prime ? Number(req.body.prime) : null,
    });
  } catch (ex) {
    return pageErreur(res, 400, 'Enregistrement impossible', ex.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — garanties modifiées, lieu #${e.id} (soumission RC #${s.id})`);
  res.redirect('/rc/' + s.id + '#garanties');
});

// --- Antécédents ------------------------------------------------------------------------------
router.post('/:id/antecedents', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const consentements = {};
  for (const c of ['credit', 'dossier_assurance']) {
    if (req.body['consentement_' + c] === 'on') consentements[c] = 1;
  }
  try {
    rc.definirAntecedents(s.id, res.locals.cabinetId, req.utilisateur.id, {
      assureur_actuel: (req.body.assureur_actuel || '').trim() || null,
      numero_police_actuelle: (req.body.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: (req.body.date_expiration_actuelle || '').trim() || null,
      annees_assurance_continue: req.body.annees_assurance_continue ? Number(req.body.annees_assurance_continue) : null,
      sinistres_5ans: parseLignesJson(req.body.sinistres_json, ['date', 'type', 'montant']),
      consentements,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — antécédents modifiés (soumission RC #${s.id})`);
  res.redirect('/rc/' + s.id + '#antecedents');
});

// --- Changer le statut --------------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const statut = String(req.body.statut || '');
  if (!rc.STATUTS_SOUMISSION.includes(statut)) {
    return pageErreur(res, 400, 'Statut invalide', 'Le statut demandé est invalide.');
  }
  rc.changerStatutSoumission(s.id, res.locals.cabinetId, req.utilisateur.id, statut);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — statut modifié (soumission RC #${s.id})`);
  res.redirect('/rc/' + s.id);
});

// --- Conversion soumission → police (gestion) ---------------------------------------------------------------
// Crée la police RC (ligne 'cgl') liée et fige la version de la soumission en référence.
// Miroir de POST /biens/:id/convertir.
router.post('/:id/convertir', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const cabinetId = res.locals.cabinetId;
  if (s.statut === 'convertie_police' || policeLiee(s.id, cabinetId)) {
    return pageErreur(res, 400, 'Déjà convertie', 'Cette soumission est déjà convertie en police.');
  }
  const erreurs = [];
  const numero = (req.body.numero_police || '').trim();
  if (numero.length < 2) erreurs.push('Le numéro de police est requis.');
  const assureur = bd.prepare('SELECT id, nom FROM assureurs WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(Number(req.body.assureur_id), cabinetId);
  if (!assureur) erreurs.push('Assureur invalide.');
  const dateEffet = (req.body.date_effet || '').trim() || s.date_effet_souhaitee || '';
  const dateEcheance = (req.body.date_echeance || '').trim();
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
      VALUES (?, ?, 'cgl', ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(cabinetId, s.client_id, assureur.nom, assureur.id, numero, dateEffet, dateEcheance,
      franchise, `Convertie de la soumission RC #${s.id}`, responsableId);
    const policeId = r.lastInsertRowid;
    const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM rc_soumission_versions WHERE soumission_id = ?')
      .get(s.id).m;
    bd.prepare('UPDATE polices SET rc_soumission_id = ?, rc_soumission_version = ? WHERE id = ?')
      .run(s.id, versionFige, policeId);
    rc.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
    creerVersionPolice(policeId, req.utilisateur.id); // v1
    journal(cabinetId, req.utilisateur.id, 'police_creee',
      `Police ${numero} (id ${policeId}) convertie de la soumission RC #${s.id}`);
    res.redirect('/echeances/police/' + policeId);
  } catch (e) {
    const msg = String(e.message || '').includes('UNIQUE')
      ? 'Ce numéro de police existe déjà dans votre cabinet.' : 'Erreur d’enregistrement.';
    return pageErreur(res, 400, 'Conversion impossible', msg);
  }
});

// Lier une police RC (CGL) existante (même entreprise, non liée) à la soumission.
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
  if (p.ligne !== 'cgl') return pageErreur(res, 400, 'Police invalide', 'Seule une police RC (CGL) peut être liée.');
  if (p.rc_soumission_id) return pageErreur(res, 400, 'Police invalide', 'Cette police est déjà liée à une soumission.');
  if (p.client_id !== s.client_id) return pageErreur(res, 400, 'Police invalide', 'La police doit appartenir à la même entreprise que la soumission.');
  if (estCourtier(req) && clientHorsPortefeuille(cabinetId, req.utilisateur, p.client_id)) return reponseHorsPortefeuille(res);
  const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM rc_soumission_versions WHERE soumission_id = ?')
    .get(s.id).m;
  bd.prepare('UPDATE polices SET rc_soumission_id = ?, rc_soumission_version = ? WHERE id = ? AND cabinet_id = ?')
    .run(s.id, versionFige, p.id, cabinetId);
  rc.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
  creerVersionPolice(p.id, req.utilisateur.id, `Liée à la soumission RC #${s.id}`);
  journal(cabinetId, req.utilisateur.id, 'police_liee_soumission',
    `Police id ${p.id} liée à la soumission RC #${s.id}`);
  res.redirect('/echeances/police/' + p.id);
});

// --- Archiver / désarchiver la soumission ----------------------------------------------------------
router.post('/:id/archiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  rc.archiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — soumission archivée (soumission RC #${s.id})`);
  res.redirect('/rc');
});

router.post('/:id/desarchiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  rc.desarchiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/rc/' + s.id);
});

// --- Version en lecture seule ------------------------------------------------------------------------
router.get('/:id/versions/:v', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const version = rc.obtenirVersion(s.id, Number(req.params.v), res.locals.cabinetId);
  if (!version) return pageErreur(res, 404, 'Introuvable', 'Version introuvable.');
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  res.render('rc/version', {
    s,
    version,
    clientNom: client ? client.raison_sociale : '—',
    NOMS_STATUTS_SOUMISSION, NOMS_SOUS_TRAITANT, NOMS_FORMULE_RC, AVENANTS_RC,
  });
});

module.exports = router;
module.exports.NOMS_STATUTS_SOUMISSION = NOMS_STATUTS_SOUMISSION;
module.exports.SOUS_TRAITANTS = SOUS_TRAITANTS;
module.exports.NOMS_SOUS_TRAITANT = NOMS_SOUS_TRAITANT;
module.exports.FORMULES_RC = FORMULES_RC;
module.exports.NOMS_FORMULE_RC = NOMS_FORMULE_RC;
module.exports.AVENANTS_RC = AVENANTS_RC;
