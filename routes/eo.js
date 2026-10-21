/**
 * routes/eo.js — Questionnaire de soumission « E&O / responsabilité professionnelle »
 * (étape 2/10 E&O).
 * Soumissions d'assurance E&O : activités professionnelles en nombre
 * illimité, garanties par soumission (base claims-made / occurrences),
 * antécédents (réclamations E&O 5 ans, circonstances pouvant donner lieu
 * à réclamation), historique de versions.
 * Toute la logique métier passe par lib/eo.js (versionnage automatique,
 * journal d'audit, filtre cabinet_id). Règle d'or : archivage, jamais de DELETE.
 * Miroir de routes/cyber.js (la conversion en police est arrivée à l'étape 3/10,
 * la proposition pré-remplie à l'étape 7/10).
 */
const express = require('express');
const demandesInfos = require('../lib/demandes-infos');

const bd = require('../lib/bd');
const eo = require('../lib/eo');
const propositionEo = require('../lib/proposition-eo');
const { genererPropositionEoPdf } = require('../lib/proposition-eo-pdf');
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
// Bases de garantie (CHECK en base : eo_garanties.base). Libellés du dictionnaire — domaine « eo ».
const BASES_GARANTIE = ['reclamations_presentees', 'occurrences'];
const NOMS_BASE_GARANTIE = {
  reclamations_presentees: 'Réclamations-présentées (claims-made)',
  occurrences: 'Occurrences (survenance)',
};
// Avenants E&O (clés JSON de eo_garanties.avenants).
const AVENANTS_EO = [
  ['frais_defense', 'Frais de défense'],
  ['medias_contenu', 'Médias et contenu'],
  ['cyber_associe', 'Cyber associé'],
];
// Consentements antécédents (clés JSON de eo_antecedents.consentements).
const CONSENTEMENTS_EO = [
  ['credit', 'Dossier de crédit'],
  ['dossier_assurance', 'Dossier d’assurance (sinistres antérieurs)'],
];

// --- Utilitaires ------------------------------------------------------------
function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

// Police liée à une soumission (1 soumission → 1 police).
function policeLiee(soumissionId, cabinetId) {
  return bd.prepare('SELECT * FROM polices WHERE eo_soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
}

// Avenant en cours de terme : toute modification des activités / garanties /
// antécédents / statut d'une soumission convertie crée une version de la
// police avec note (règle d'or : jamais de modification silencieuse).
function noterAvenantPolice(soumissionId, cabinetId, userId, note) {
  const p = policeLiee(soumissionId, cabinetId);
  if (p) creerVersionPolice(p.id, userId, note);
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

// Soumission du cabinet + contrôle du portefeuille courtier.
function soumissionAutorisee(req, res, inclureArchives) {
  const s = eo.obtenirSoumission(Number(req.params.id), res.locals.cabinetId,
    { inclureArchives: !!inclureArchives });
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return s;
}

function lireActiviteForm(body) {
  const description = (body.description_activite || '').trim();
  if (!description) throw new Error('Description de l’activité requise.');
  const chiffre = body.chiffre_affaires === '' || body.chiffre_affaires == null
    ? null : Number(body.chiffre_affaires);
  if (chiffre !== null && (isNaN(chiffre) || chiffre < 0)) throw new Error('Chiffre d’affaires invalide.');
  const nbPro = body.nb_professionnels === '' || body.nb_professionnels == null
    ? null : Number(body.nb_professionnels);
  if (nbPro !== null && (!Number.isInteger(nbPro) || nbPro < 0)) throw new Error('Nombre de professionnels invalide.');
  return {
    description_activite: description,
    chiffre_affaires: chiffre,
    nb_professionnels: nbPro,
    notes: (body.notes || '').trim() || null,
  };
}

function lireNombrePositif(raw) {
  if (raw === '' || raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (isNaN(n) || n < 0) throw new Error('Montant invalide.');
  return n;
}

// --- Liste ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const cabinetId = res.locals.cabinetId;
  const voirArchives = req.query.archives === '1';
  const statut = eo.STATUTS_SOUMISSION.includes(req.query.statut) ? req.query.statut : '';
  let sql = `
    SELECT s.*, c.raison_sociale AS client_nom,
      (SELECT COUNT(*) FROM eo_activites WHERE soumission_id = s.id AND archive = 0) AS nb_activites
    FROM eo_soumissions s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.cabinet_id = ? AND s.archive = ${voirArchives ? '1' : '0'}`;
  const params = [cabinetId];
  if (statut) { sql += ' AND s.statut = ?'; params.push(statut); }
  if (estCourtier(req)) sql += ` AND c.responsable_id = ${Number(req.utilisateur.id)}`;
  sql += ' ORDER BY s.id DESC';
  const soumissions = bd.prepare(sql).all(...params);
  res.render('eo/liste', { soumissions, voirArchives, statut, NOMS_STATUTS_SOUMISSION });
});

// --- Nouvelle soumission --------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  const entreprises = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  res.render('eo/formulaire', { erreur: null, valeurs: {}, entreprises });
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
    return res.status(400).render('eo/formulaire', {
      erreur: erreurs.join(' '), valeurs: req.body, entreprises,
    });
  }
  const id = eo.creerSoumission({
    cabinetId,
    userId: req.utilisateur.id,
    clientId,
    dateEffetSouhaitee: dateEffet || null,
    notes: (req.body.notes || '').trim() || null,
  });
  res.redirect('/eo/' + id);
});

// --- Fiche ----------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  const versions = eo.versionsSoumission(s.id, res.locals.cabinetId);
  const police = policeLiee(s.id, res.locals.cabinetId);
  let policesDispo = [];
  let assureurs = [];
  if (!police && s.statut !== 'convertie_police') {
    policesDispo = bd.prepare(`
      SELECT id, numero_police FROM polices
      WHERE cabinet_id = ? AND client_id = ? AND ligne = 'eo' AND eo_soumission_id IS NULL
      ORDER BY numero_police
    `).all(res.locals.cabinetId, s.client_id);
    assureurs = bd.prepare('SELECT id, nom FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom')
      .all(res.locals.cabinetId);
  }
  res.render('eo/fiche', { sectionDemandes: demandesInfos.sectionPourFiche('eo', s, req.utilisateur.cabinet_id), 
    s,
    clientNom: client ? client.raison_sociale : '—',
    versions,
    policeLiee: police || null,
    policesDispo,
    assureurs,
    NOMS_STATUTS_SOUMISSION,
    BASES_GARANTIE, NOMS_BASE_GARANTIE, AVENANTS_EO, CONSENTEMENTS_EO,
  });
});

// --- Ajouter une activité professionnelle ----------------------------------------------------
router.post('/:id/activite', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    eo.ajouterActivite(s.id, res.locals.cabinetId, req.utilisateur.id, lireActiviteForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — activité ajoutée (soumission E&O #${s.id})`);
  res.redirect('/eo/' + s.id + '#activites');
});

// --- Modifier / archiver / désarchiver une activité -----------------------------------------
function activiteDuCabinet(req, res) {
  const a = bd.prepare('SELECT * FROM eo_activites WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.params.aid), res.locals.cabinetId);
  if (!a) { pageErreur(res, 404, 'Introuvable', 'Activité introuvable.'); return null; }
  const s = eo.obtenirSoumission(a.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { activite: a, soumission: s };
}

router.post('/activite/:aid', (req, res) => {
  const ctx = activiteDuCabinet(req, res);
  if (!ctx) return;
  try {
    eo.modifierActivite(ctx.activite.id, res.locals.cabinetId, req.utilisateur.id, lireActiviteForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — activité modifiée (soumission E&O #${ctx.soumission.id})`);
  res.redirect('/eo/' + ctx.soumission.id + '#activites');
});

router.post('/activite/:aid/archiver', (req, res) => {
  const ctx = activiteDuCabinet(req, res);
  if (!ctx) return;
  eo.archiverActivite(ctx.activite.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — activité archivée (soumission E&O #${ctx.soumission.id})`);
  res.redirect('/eo/' + ctx.soumission.id + '#activites');
});

router.post('/activite/:aid/desarchiver', (req, res) => {
  const ctx = activiteDuCabinet(req, res);
  if (!ctx) return;
  eo.desarchiverActivite(ctx.activite.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — activité désarchivée (soumission E&O #${ctx.soumission.id})`);
  res.redirect('/eo/' + ctx.soumission.id + '#activites');
});

// --- Garanties de la soumission --------------------------------------------------------------
router.post('/:id/garanties', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const base = (req.body.base || '').trim() || null;
  if (base && !BASES_GARANTIE.includes(base)) {
    return pageErreur(res, 400, 'Enregistrement impossible', 'Base de garantie invalide.');
  }
  const avenants = {};
  const recus = Array.isArray(req.body.avenants) ? req.body.avenants : (req.body.avenants ? [req.body.avenants] : []);
  for (const code of recus) {
    if (AVENANTS_EO.some(([c]) => c === code)) avenants[code] = 1;
  }
  try {
    eo.definirGaranties(s.id, res.locals.cabinetId, req.utilisateur.id, {
      limite_par_sinistre: lireNombrePositif(req.body.limite_par_sinistre),
      limite_agregat: lireNombrePositif(req.body.limite_agregat),
      franchise: lireNombrePositif(req.body.franchise),
      base,
      avenants,
      prime: lireNombrePositif(req.body.prime),
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — garanties modifiées (soumission E&O #${s.id})`);
  res.redirect('/eo/' + s.id + '#garanties');
});

// --- Antécédents -------------------------------------------------------------------------------
router.post('/:id/antecedents', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const consentements = {};
  for (const [code] of CONSENTEMENTS_EO) {
    if (req.body['consentement_' + code] === 'on') consentements[code] = 1;
  }
  try {
    eo.definirAntecedents(s.id, res.locals.cabinetId, req.utilisateur.id, {
      assureur_actuel: (req.body.assureur_actuel || '').trim() || null,
      numero_police_actuelle: (req.body.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: (req.body.date_expiration_actuelle || '').trim() || null,
      annees_assurance_continue: req.body.annees_assurance_continue ? Number(req.body.annees_assurance_continue) : null,
      reclamations_5ans: parseLignesJson(req.body.reclamations_json, ['date', 'nature', 'montant', 'sinistre']),
      circonstances: (req.body.circonstances || '').trim() || null,
      consentements,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — antécédents modifiés (soumission E&O #${s.id})`);
  res.redirect('/eo/' + s.id + '#antecedents');
});

// --- Changer le statut --------------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const statut = String(req.body.statut || '');
  if (!eo.STATUTS_SOUMISSION.includes(statut)) {
    return pageErreur(res, 400, 'Statut invalide', 'Le statut demandé est invalide.');
  }
  eo.changerStatutSoumission(s.id, res.locals.cabinetId, req.utilisateur.id, statut);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — statut modifié (soumission E&O #${s.id})`);
  res.redirect('/eo/' + s.id);
});

// --- Convertir en police ----------------------------------------------------------------------------
// Miroir de POST /cyber/:id/convertir.
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
      VALUES (?, ?, 'eo', ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(cabinetId, s.client_id, assureur.nom, assureur.id, numero, dateEffet, dateEcheance,
      franchise, `Convertie de la soumission E&O #${s.id}`, responsableId);
    const policeId = r.lastInsertRowid;
    const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM eo_soumission_versions WHERE soumission_id = ?')
      .get(s.id).m;
    bd.prepare('UPDATE polices SET eo_soumission_id = ?, eo_soumission_version = ? WHERE id = ?')
      .run(s.id, versionFige, policeId);
    eo.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
    creerVersionPolice(policeId, req.utilisateur.id); // v1
    journal(cabinetId, req.utilisateur.id, 'police_creee',
      `Police ${numero} (id ${policeId}) convertie de la soumission E&O #${s.id}`);
    res.redirect('/echeances/police/' + policeId);
  } catch (e) {
    const msg = String(e.message || '').includes('UNIQUE')
      ? 'Ce numéro de police existe déjà dans votre cabinet.' : 'Erreur d’enregistrement.';
    return pageErreur(res, 400, 'Conversion impossible', msg);
  }
});

// Lier une police E&O existante (même entreprise, non liée) à la soumission.
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
  if (p.ligne !== 'eo') return pageErreur(res, 400, 'Police invalide', 'Seule une police E&O peut être liée.');
  if (p.eo_soumission_id) return pageErreur(res, 400, 'Police invalide', 'Cette police est déjà liée à une soumission.');
  if (p.client_id !== s.client_id) return pageErreur(res, 400, 'Police invalide', 'La police doit appartenir à la même entreprise que la soumission.');
  if (estCourtier(req) && clientHorsPortefeuille(cabinetId, req.utilisateur, p.client_id)) return reponseHorsPortefeuille(res);
  const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM eo_soumission_versions WHERE soumission_id = ?')
    .get(s.id).m;
  bd.prepare('UPDATE polices SET eo_soumission_id = ?, eo_soumission_version = ? WHERE id = ? AND cabinet_id = ?')
    .run(s.id, versionFige, p.id, cabinetId);
  eo.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
  creerVersionPolice(p.id, req.utilisateur.id, `Liée à la soumission E&O #${s.id}`);
  journal(cabinetId, req.utilisateur.id, 'police_liee_soumission',
    `Police id ${p.id} liée à la soumission E&O #${s.id}`);
  res.redirect('/echeances/police/' + p.id);
});

// --- Archiver / désarchiver la soumission ----------------------------------------------------------
router.post('/:id/archiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  eo.archiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — soumission archivée (soumission E&O #${s.id})`);
  res.redirect('/eo');
});

router.post('/:id/desarchiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  eo.desarchiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/eo/' + s.id);
});

// --- Version en lecture seule -----------------------------------------------------------------------
router.get('/:id/versions/:v', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const version = eo.obtenirVersion(s.id, Number(req.params.v), res.locals.cabinetId);
  if (!version) return pageErreur(res, 404, 'Introuvable', 'Version introuvable.');
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  res.render('eo/version', {
    s,
    version,
    clientNom: client ? client.raison_sociale : '—',
    NOMS_STATUTS_SOUMISSION, NOMS_BASE_GARANTIE, AVENANTS_EO,
  });
});

// --- Proposition pré-remplie : HTML imprimable + PDF -------------------------------------
// ?v=N : génère à partir d'une version figée (règle d'or : traçabilité).
// Lecture seule : la proposition ne modifie JAMAIS la soumission.
// Miroir de routes/cyber.js (étape 7/10 cyber).
function donneesPropositionEo(req, res) {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return null;
  const vParam = req.query.v ? Number(req.query.v) : null;
  const p = propositionEo.preparerPropositionEo(res.locals.cabinetId, s, vParam);
  if (!p) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (p.erreur === 'version') { pageErreur(res, 404, 'Introuvable', 'Version introuvable.'); return null; }
  return { p, vParam };
}

router.get('/:id/proposition', (req, res) => {
  const r = donneesPropositionEo(req, res);
  if (!r) return;
  journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_eo_generee',
    `Proposition E&O #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, HTML) générée`);
  res.render('eo/proposition', { p: r.p, vParam: r.vParam });
});

router.get('/:id/proposition.pdf', (req, res) => {
  const r = donneesPropositionEo(req, res);
  if (!r) return;
  genererPropositionEoPdf(r.p).then((pdf) => {
    journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_eo_generee',
      `Proposition E&O #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, PDF) générée`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="proposition-eo-${r.p.soumissionId}-v${r.p.versionNumero}.pdf"`);
    res.send(pdf);
  }).catch(() => pageErreur(res, 500, 'Erreur', 'Génération du PDF impossible.'));
});

module.exports = router;
module.exports.NOMS_STATUTS_SOUMISSION = NOMS_STATUTS_SOUMISSION;
module.exports.BASES_GARANTIE = BASES_GARANTIE;
module.exports.NOMS_BASE_GARANTIE = NOMS_BASE_GARANTIE;
module.exports.AVENANTS_EO = AVENANTS_EO;
module.exports.CONSENTEMENTS_EO = CONSENTEMENTS_EO;
