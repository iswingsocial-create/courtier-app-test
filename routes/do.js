/**
 * routes/do.js — Questionnaire de soumission « D&O / responsabilité des administrateurs et dirigeants »
 * (étape 2/10 D&O).
 * Soumissions d'assurance D&O : dirigeants en nombre illimité,
 * garanties par soumission (base claims-made / occurrences),
 * antécédents (réclamations D&O 5 ans, poursuites ou actions en justice
 * en cours/envisagées), historique de versions.
 * Toute la logique métier passe par lib/do.js (versionnage automatique,
 * journal d'audit, filtre cabinet_id). Règle d'or : archivage, jamais de DELETE.
 * Miroir de routes/eo.js (la conversion en police est faite à l'étape 3/10,
 * la proposition pré-remplie à l'étape 7/10).
 */
const express = require('express');
const demandesInfos = require('../lib/demandes-infos');
const marche = require('../lib/marche');

const bd = require('../lib/bd');
const dosoum = require('../lib/do');
const propositionDo = require('../lib/proposition-do');
const { genererPropositionDoPdf } = require('../lib/proposition-do-pdf');
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
// Bases de garantie (CHECK en base : do_garanties.base). Libellés du dictionnaire — domaine « do ».
const BASES_GARANTIE = ['reclamations_presentees', 'occurrences'];
const NOMS_BASE_GARANTIE = {
  reclamations_presentees: 'Réclamations-présentées (claims-made)',
  occurrences: 'Occurrences (survenance)',
};
// Avenants D&O (clés JSON de do_garanties.avenants).
const AVENANTS_DO = [
  ['frais_defense', 'Frais de défense'],
  ['pratiques_emploi', 'Pratiques d’emploi'],
  ['fidelite_crime', 'Fidélité / crime'],
];
// Consentements antécédents (clés JSON de do_antecedents.consentements).
const CONSENTEMENTS_DO = [
  ['credit', 'Dossier de crédit'],
  ['dossier_assurance', 'Dossier d’assurance (sinistres antérieurs)'],
];

// --- Utilitaires ------------------------------------------------------------
function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

// Police liée à une soumission (1 soumission → 1 police).
function policeLiee(soumissionId, cabinetId) {
  return bd.prepare('SELECT * FROM polices WHERE do_soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
}

// Avenant en cours de terme : toute modification des dirigeants / garanties /
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
  const s = dosoum.obtenirSoumission(Number(req.params.id), res.locals.cabinetId,
    { inclureArchives: !!inclureArchives });
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return s;
}

function lireDirigeantForm(body) {
  const nom = (body.nom || '').trim();
  if (!nom) throw new Error('Nom du dirigeant requis.');
  const annees = body.annees_experience === '' || body.annees_experience == null
    ? null : Number(body.annees_experience);
  if (annees !== null && (!Number.isInteger(annees) || annees < 0 || annees > 80)) {
    throw new Error('Années d’expérience invalides.');
  }
  return {
    nom,
    fonction: (body.fonction || '').trim() || null,
    annees_experience: annees,
    antecedents_personnels: (body.antecedents_personnels || '').trim() || null,
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
  const statut = dosoum.STATUTS_SOUMISSION.includes(req.query.statut) ? req.query.statut : '';
  let sql = `
    SELECT s.*, c.raison_sociale AS client_nom,
      (SELECT COUNT(*) FROM do_dirigeants WHERE soumission_id = s.id AND archive = 0) AS nb_dirigeants
    FROM do_soumissions s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.cabinet_id = ? AND s.archive = ${voirArchives ? '1' : '0'}`;
  const params = [cabinetId];
  if (statut) { sql += ' AND s.statut = ?'; params.push(statut); }
  if (estCourtier(req)) sql += ` AND c.responsable_id = ${Number(req.utilisateur.id)}`;
  sql += ' ORDER BY s.id DESC';
  const soumissions = bd.prepare(sql).all(...params);
  res.render('do/liste', { soumissions, voirArchives, statut, NOMS_STATUTS_SOUMISSION });
});

// --- Nouvelle soumission --------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  const entreprises = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  res.render('do/formulaire', { erreur: null, valeurs: {}, entreprises });
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
    return res.status(400).render('do/formulaire', {
      erreur: erreurs.join(' '), valeurs: req.body, entreprises,
    });
  }
  const id = dosoum.creerSoumission({
    cabinetId,
    userId: req.utilisateur.id,
    clientId,
    dateEffetSouhaitee: dateEffet || null,
    notes: (req.body.notes || '').trim() || null,
  });
  res.redirect('/do/' + id);
});

// --- Fiche ----------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  const versions = dosoum.versionsSoumission(s.id, res.locals.cabinetId);
  const police = policeLiee(s.id, res.locals.cabinetId);
  let policesDispo = [];
  let assureurs = [];
  if (!police && s.statut !== 'convertie_police') {
    policesDispo = bd.prepare(`
      SELECT id, numero_police FROM polices
      WHERE cabinet_id = ? AND client_id = ? AND ligne = 'do' AND do_soumission_id IS NULL
      ORDER BY numero_police
    `).all(res.locals.cabinetId, s.client_id);
    assureurs = bd.prepare('SELECT id, nom FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom')
      .all(res.locals.cabinetId);
  }
  res.render('do/fiche', { sectionDemandes: demandesInfos.sectionPourFiche('do', s, req.utilisateur.cabinet_id),
    sectionMarche: marche.sectionPourCible(req.utilisateur.cabinet_id, { produit: 'do', soumissionId: s.id }), NOMS_STATUTS_ENVOI: marche.NOMS_STATUTS_ENVOI, 
    s,
    clientNom: client ? client.raison_sociale : '—',
    versions,
    policeLiee: police || null,
    policesDispo,
    assureurs,
    NOMS_STATUTS_SOUMISSION,
    BASES_GARANTIE, NOMS_BASE_GARANTIE, AVENANTS_DO, CONSENTEMENTS_DO,
  });
});

// --- Ajouter un dirigeant ---------------------------------------------------------------------
router.post('/:id/dirigeant', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    dosoum.ajouterDirigeant(s.id, res.locals.cabinetId, req.utilisateur.id, lireDirigeantForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — dirigeant ajouté (soumission D&O #${s.id})`);
  res.redirect('/do/' + s.id + '#dirigeants');
});

// --- Modifier / archiver / désarchiver un dirigeant ------------------------------------------
function dirigeantDuCabinet(req, res) {
  const d = bd.prepare('SELECT * FROM do_dirigeants WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.params.did), res.locals.cabinetId);
  if (!d) { pageErreur(res, 404, 'Introuvable', 'Dirigeant introuvable.'); return null; }
  const s = dosoum.obtenirSoumission(d.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { dirigeant: d, soumission: s };
}

router.post('/dirigeant/:did', (req, res) => {
  const ctx = dirigeantDuCabinet(req, res);
  if (!ctx) return;
  try {
    dosoum.modifierDirigeant(ctx.dirigeant.id, res.locals.cabinetId, req.utilisateur.id, lireDirigeantForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — dirigeant modifié (soumission D&O #${ctx.soumission.id})`);
  res.redirect('/do/' + ctx.soumission.id + '#dirigeants');
});

router.post('/dirigeant/:did/archiver', (req, res) => {
  const ctx = dirigeantDuCabinet(req, res);
  if (!ctx) return;
  dosoum.archiverDirigeant(ctx.dirigeant.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — dirigeant archivé (soumission D&O #${ctx.soumission.id})`);
  res.redirect('/do/' + ctx.soumission.id + '#dirigeants');
});

router.post('/dirigeant/:did/desarchiver', (req, res) => {
  const ctx = dirigeantDuCabinet(req, res);
  if (!ctx) return;
  dosoum.desarchiverDirigeant(ctx.dirigeant.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — dirigeant désarchivé (soumission D&O #${ctx.soumission.id})`);
  res.redirect('/do/' + ctx.soumission.id + '#dirigeants');
});

// --- Garanties de la soumission ---------------------------------------------------------------
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
    if (AVENANTS_DO.some(([c]) => c === code)) avenants[code] = 1;
  }
  try {
    dosoum.definirGaranties(s.id, res.locals.cabinetId, req.utilisateur.id, {
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
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — garanties modifiées (soumission D&O #${s.id})`);
  res.redirect('/do/' + s.id + '#garanties');
});

// --- Antécédents --------------------------------------------------------------------------------
router.post('/:id/antecedents', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const consentements = {};
  for (const [code] of CONSENTEMENTS_DO) {
    if (req.body['consentement_' + code] === 'on') consentements[code] = 1;
  }
  try {
    dosoum.definirAntecedents(s.id, res.locals.cabinetId, req.utilisateur.id, {
      assureur_actuel: (req.body.assureur_actuel || '').trim() || null,
      numero_police_actuelle: (req.body.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: (req.body.date_expiration_actuelle || '').trim() || null,
      annees_assurance_continue: req.body.annees_assurance_continue ? Number(req.body.annees_assurance_continue) : null,
      reclamations_5ans: parseLignesJson(req.body.reclamations_json, ['date', 'nature', 'montant', 'sinistre']),
      poursuites_en_cours: (req.body.poursuites_en_cours || '').trim() || null,
      consentements,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — antécédents modifiés (soumission D&O #${s.id})`);
  res.redirect('/do/' + s.id + '#antecedents');
});

// --- Changer le statut ---------------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const statut = String(req.body.statut || '');
  if (!dosoum.STATUTS_SOUMISSION.includes(statut)) {
    return pageErreur(res, 400, 'Statut invalide', 'Le statut demandé est invalide.');
  }
  dosoum.changerStatutSoumission(s.id, res.locals.cabinetId, req.utilisateur.id, statut);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — statut modifié (soumission D&O #${s.id})`);
  res.redirect('/do/' + s.id);
});

// --- Archiver / désarchiver la soumission ------------------------------------------------------------
router.post('/:id/archiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  dosoum.archiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — soumission archivée (soumission D&O #${s.id})`);
  res.redirect('/do');
});

router.post('/:id/desarchiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  dosoum.desarchiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/do/' + s.id);
});

// --- Convertir en police ----------------------------------------------------------------------------
// Miroir de POST /eo/:id/convertir.
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
      VALUES (?, ?, 'do', ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(cabinetId, s.client_id, assureur.nom, assureur.id, numero, dateEffet, dateEcheance,
      franchise, `Convertie de la soumission D&O #${s.id}`, responsableId);
    const policeId = r.lastInsertRowid;
    const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM do_soumission_versions WHERE soumission_id = ?')
      .get(s.id).m;
    bd.prepare('UPDATE polices SET do_soumission_id = ?, do_soumission_version = ? WHERE id = ?')
      .run(s.id, versionFige, policeId);
    dosoum.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
    creerVersionPolice(policeId, req.utilisateur.id); // v1
    journal(cabinetId, req.utilisateur.id, 'police_creee',
      `Police ${numero} (id ${policeId}) convertie de la soumission D&O #${s.id}`);
    res.redirect('/echeances/police/' + policeId);
  } catch (e) {
    const msg = String(e.message || '').includes('UNIQUE')
      ? 'Ce numéro de police existe déjà dans votre cabinet.' : 'Erreur d’enregistrement.';
    return pageErreur(res, 400, 'Conversion impossible', msg);
  }
});

// Lier une police D&O existante (même entreprise, non liée) à la soumission.
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
  if (p.ligne !== 'do') return pageErreur(res, 400, 'Police invalide', 'Seule une police D&O peut être liée.');
  if (p.do_soumission_id) return pageErreur(res, 400, 'Police invalide', 'Cette police est déjà liée à une soumission.');
  if (p.client_id !== s.client_id) return pageErreur(res, 400, 'Police invalide', 'La police doit appartenir à la même entreprise que la soumission.');
  if (estCourtier(req) && clientHorsPortefeuille(cabinetId, req.utilisateur, p.client_id)) return reponseHorsPortefeuille(res);
  const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM do_soumission_versions WHERE soumission_id = ?')
    .get(s.id).m;
  bd.prepare('UPDATE polices SET do_soumission_id = ?, do_soumission_version = ? WHERE id = ? AND cabinet_id = ?')
    .run(s.id, versionFige, p.id, cabinetId);
  dosoum.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
  creerVersionPolice(p.id, req.utilisateur.id, `Liée à la soumission D&O #${s.id}`);
  journal(cabinetId, req.utilisateur.id, 'police_liee_soumission',
    `Police id ${p.id} liée à la soumission D&O #${s.id}`);
  res.redirect('/echeances/police/' + p.id);
});

// --- Version en lecture seule -------------------------------------------------------------------------
router.get('/:id/versions/:v', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const version = dosoum.obtenirVersion(s.id, Number(req.params.v), res.locals.cabinetId);
  if (!version) return pageErreur(res, 404, 'Introuvable', 'Version introuvable.');
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  res.render('do/version', {
    s,
    version,
    clientNom: client ? client.raison_sociale : '—',
    NOMS_STATUTS_SOUMISSION, NOMS_BASE_GARANTIE, AVENANTS_DO,
  });
});

// --- Proposition pré-remplie : HTML imprimable + PDF -------------------------------------
// ?v=N : génère à partir d'une version figée (règle d'or : traçabilité).
// Lecture seule : la proposition ne modifie JAMAIS la soumission.
// Miroir de routes/eo.js (étape 7/10 E&O).
function donneesPropositionDo(req, res) {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return null;
  const vParam = req.query.v ? Number(req.query.v) : null;
  const p = propositionDo.preparerPropositionDo(res.locals.cabinetId, s, vParam);
  if (!p) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (p.erreur === 'version') { pageErreur(res, 404, 'Introuvable', 'Version introuvable.'); return null; }
  return { p, vParam };
}

router.get('/:id/proposition', (req, res) => {
  const r = donneesPropositionDo(req, res);
  if (!r) return;
  journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_do_generee',
    `Proposition D&O #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, HTML) générée`);
  res.render('do/proposition', { p: r.p, vParam: r.vParam });
});

router.get('/:id/proposition.pdf', (req, res) => {
  const r = donneesPropositionDo(req, res);
  if (!r) return;
  genererPropositionDoPdf(r.p).then((pdf) => {
    journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_do_generee',
      `Proposition D&O #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, PDF) générée`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="proposition-do-${r.p.soumissionId}-v${r.p.versionNumero}.pdf"`);
    res.send(pdf);
  }).catch(() => pageErreur(res, 500, 'Erreur', 'Génération du PDF impossible.'));
});

module.exports = router;
module.exports.NOMS_STATUTS_SOUMISSION = NOMS_STATUTS_SOUMISSION;
module.exports.BASES_GARANTIE = BASES_GARANTIE;
module.exports.NOMS_BASE_GARANTIE = NOMS_BASE_GARANTIE;
module.exports.AVENANTS_DO = AVENANTS_DO;
module.exports.CONSENTEMENTS_DO = CONSENTEMENTS_DO;
