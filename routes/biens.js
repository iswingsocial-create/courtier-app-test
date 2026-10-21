/**
 * routes/biens.js — Questionnaire de soumission « biens commerciaux » (étape 2/10 biens).
 * Soumissions d'assurance des biens : bâtiments et contenus en nombre
 * illimité, garanties par bâtiment, antécédents, historique de versions.
 * Toute la logique métier passe par lib/biens.js (versionnage automatique,
 * journal d'audit, filtre cabinet_id). Règle d'or : archivage, jamais de DELETE.
 * Miroir de routes/auto.js.
 */
const express = require('express');
const demandesInfos = require('../lib/demandes-infos');

const bd = require('../lib/bd');
const biens = require('../lib/biens');
const propositionBiens = require('../lib/proposition-biens');
const { genererPropositionBiensPdf } = require('../lib/proposition-biens-pdf');
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
const TYPES_CONSTRUCTION = ['bois', 'acier', 'beton', 'maconnerie', 'mixte'];
const NOMS_TYPE_CONSTRUCTION = {
  bois: 'Bois',
  acier: 'Acier',
  beton: 'Béton',
  maconnerie: 'Maçonnerie',
  mixte: 'Mixte',
};
const TYPES_CONTENU = ['mobilier', 'equipements', 'stock', 'ameliorations', 'autre'];
const NOMS_TYPE_CONTENU = {
  mobilier: 'Mobilier',
  equipements: 'Équipements',
  stock: 'Stock',
  ameliorations: 'Améliorations locatives',
  autre: 'Autre',
};
const FORMULES = ['tous_risques', 'risques_designes'];
const NOMS_FORMULE = {
  tous_risques: 'Tous risques',
  risques_designes: 'Risques désignés',
};
const AVENANTS_BIENS = [
  ['tremblement_terre', 'Tremblement de terre'],
  ['inondation', 'Inondation'],
  ['refoulement_egout', 'Refoulement d’égout'],
  ['bris_machines', 'Bris de machines'],
  ['perte_exploitation_liee', 'Perte d’exploitation liée'],
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
  return bd.prepare('SELECT * FROM polices WHERE biens_soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
}

// Avenant en cours de terme : toute modification des bâtiments/contenus/
// garanties/antécédents d'une soumission convertie crée une version de la
// police avec note (règle d'or : jamais de modification silencieuse).
function noterAvenantPolice(soumissionId, cabinetId, userId, note) {
  const p = policeLiee(soumissionId, cabinetId);
  if (p) creerVersionPolice(p.id, userId, note);
}

// Soumission du cabinet + contrôle du portefeuille courtier.
function soumissionAutorisee(req, res, inclureArchives) {
  const s = biens.obtenirSoumission(Number(req.params.id), res.locals.cabinetId,
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
  const statut = biens.STATUTS_SOUMISSION.includes(req.query.statut) ? req.query.statut : '';
  let sql = `
    SELECT s.*, c.raison_sociale AS client_nom,
      (SELECT COUNT(*) FROM biens_batiments WHERE soumission_id = s.id AND archive = 0) AS nb_batiments,
      (SELECT COUNT(*) FROM biens_contenus WHERE soumission_id = s.id AND archive = 0) AS nb_contenus
    FROM biens_soumissions s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.cabinet_id = ? AND s.archive = ${voirArchives ? '1' : '0'}`;
  const params = [cabinetId];
  if (statut) { sql += ' AND s.statut = ?'; params.push(statut); }
  if (estCourtier(req)) sql += ` AND c.responsable_id = ${Number(req.utilisateur.id)}`;
  sql += ' ORDER BY s.id DESC';
  const soumissions = bd.prepare(sql).all(...params);
  res.render('biens/liste', { soumissions, voirArchives, statut, NOMS_STATUTS_SOUMISSION });
});

// --- Nouvelle soumission ------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  const entreprises = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  res.render('biens/formulaire', { erreur: null, valeurs: {}, entreprises });
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
    return res.status(400).render('biens/formulaire', {
      erreur: erreurs.join(' '), valeurs: req.body, entreprises,
    });
  }
  const id = biens.creerSoumission({
    cabinetId,
    userId: req.utilisateur.id,
    clientId,
    dateEffetSouhaitee: dateEffet || null,
    notes: (req.body.notes || '').trim() || null,
  });
  res.redirect('/biens/' + id);
});

// --- Fiche --------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  const versions = biens.versionsSoumission(s.id, res.locals.cabinetId);
  const police = policeLiee(s.id, res.locals.cabinetId);
  let policesDispo = [];
  let assureurs = [];
  if (!police && s.statut !== 'convertie_police') {
    policesDispo = bd.prepare(`
      SELECT id, numero_police FROM polices
      WHERE cabinet_id = ? AND client_id = ? AND ligne = 'biens' AND biens_soumission_id IS NULL
      ORDER BY numero_police
    `).all(res.locals.cabinetId, s.client_id);
    assureurs = bd.prepare('SELECT id, nom FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom')
      .all(res.locals.cabinetId);
  }
  res.render('biens/fiche', { sectionDemandes: demandesInfos.sectionPourFiche('biens', s, req.utilisateur.cabinet_id), 
    s,
    clientNom: client ? client.raison_sociale : '—',
    versions,
    policeLiee: police || null,
    policesDispo,
    assureurs,
    NOMS_STATUTS_SOUMISSION, TYPES_CONSTRUCTION, NOMS_TYPE_CONSTRUCTION,
    TYPES_CONTENU, NOMS_TYPE_CONTENU, FORMULES, NOMS_FORMULE, AVENANTS_BIENS,
  });
});

// --- Proposition pré-remplie : HTML imprimable + PDF -------------------------------------------
// ?v=N : génère à partir d'une version figée (règle d'or : traçabilité).
// Miroir de routes/auto.js.
function donneesPropositionBiens(req, res) {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return null;
  const vParam = req.query.v ? Number(req.query.v) : null;
  const p = propositionBiens.preparerPropositionBiens(res.locals.cabinetId, s, vParam);
  if (!p) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (p.erreur === 'version') { pageErreur(res, 404, 'Introuvable', 'Version introuvable.'); return null; }
  return { p, vParam };
}

router.get('/:id/proposition', (req, res) => {
  const r = donneesPropositionBiens(req, res);
  if (!r) return;
  journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_biens_generee',
    `Proposition biens #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, HTML) générée`);
  res.render('biens/proposition', { p: r.p, vParam: r.vParam });
});

router.get('/:id/proposition.pdf', (req, res) => {
  const r = donneesPropositionBiens(req, res);
  if (!r) return;
  genererPropositionBiensPdf(r.p).then((pdf) => {
    journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_biens_generee',
      `Proposition biens #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, PDF) générée`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="proposition-biens-${r.p.soumissionId}-v${r.p.versionNumero}.pdf"`);
    res.send(pdf);
  }).catch(() => pageErreur(res, 500, 'Erreur', 'Génération du PDF impossible.'));
});

// --- Ajouter un bâtiment -------------------------------------------------------------------
function lireBatimentForm(body) {
  const d = {
    adresse: (body.adresse || '').trim() || null,
    ville: (body.ville || '').trim() || null,
    code_postal: (body.code_postal || '').trim() || null,
    type_construction: (body.type_construction || '').trim() || null,
    annee_construction: body.annee_construction ? Number(body.annee_construction) : null,
    superficie_pi2: body.superficie_pi2 ? Number(body.superficie_pi2) : null,
    nb_etages: body.nb_etages ? Number(body.nb_etages) : null,
    occupation: (body.occupation || '').trim() || null,
    valeur_batiment: body.valeur_batiment ? Number(body.valeur_batiment) : null,
    gicleurs: body.gicleurs === 'on',
    distance_caserne_km: body.distance_caserne_km ? Number(body.distance_caserne_km) : null,
    chauffage: (body.chauffage || '').trim() || null,
    annee_toiture: body.annee_toiture ? Number(body.annee_toiture) : null,
    notes: (body.notes || '').trim() || null,
  };
  if (d.type_construction && !TYPES_CONSTRUCTION.includes(d.type_construction)) {
    throw new Error('Type de construction invalide.');
  }
  return d;
}

router.post('/:id/batiment', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    biens.ajouterBatiment(s.id, res.locals.cabinetId, req.utilisateur.id, lireBatimentForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — bâtiment ajouté (soumission biens #${s.id})`);
  res.redirect('/biens/' + s.id + '#batiments');
});

// --- Modifier / archiver / désarchiver un bâtiment ------------------------------------------
function batimentDuCabinet(req, res) {
  const b = bd.prepare('SELECT * FROM biens_batiments WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.params.bid), res.locals.cabinetId);
  if (!b) { pageErreur(res, 404, 'Introuvable', 'Bâtiment introuvable.'); return null; }
  const s = biens.obtenirSoumission(b.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { batiment: b, soumission: s };
}

router.post('/batiment/:bid', (req, res) => {
  const ctx = batimentDuCabinet(req, res);
  if (!ctx) return;
  try {
    biens.modifierBatiment(ctx.batiment.id, res.locals.cabinetId, req.utilisateur.id, lireBatimentForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — bâtiment modifié (soumission biens #${ctx.soumission.id})`);
  res.redirect('/biens/' + ctx.soumission.id + '#batiments');
});

router.post('/batiment/:bid/archiver', (req, res) => {
  const ctx = batimentDuCabinet(req, res);
  if (!ctx) return;
  biens.archiverBatiment(ctx.batiment.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — bâtiment archivé (soumission biens #${ctx.soumission.id})`);
  res.redirect('/biens/' + ctx.soumission.id + '#batiments');
});

router.post('/batiment/:bid/desarchiver', (req, res) => {
  const ctx = batimentDuCabinet(req, res);
  if (!ctx) return;
  biens.desarchiverBatiment(ctx.batiment.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — bâtiment désarchivé (soumission biens #${ctx.soumission.id})`);
  res.redirect('/biens/' + ctx.soumission.id + '#batiments');
});

// --- Ajouter un contenu ----------------------------------------------------------------------
function lireContenuForm(body) {
  const typeContenu = (body.type_contenu || '').trim() || null;
  if (typeContenu && !TYPES_CONTENU.includes(typeContenu)) throw new Error('Type de contenu invalide.');
  return {
    description: (body.description || '').trim() || null,
    type_contenu: typeContenu,
    valeur: body.valeur ? Number(body.valeur) : null,
    notes: (body.notes || '').trim() || null,
  };
}

router.post('/:id/contenu', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const bid = req.body.batiment_id ? Number(req.body.batiment_id) : null;
  try {
    biens.ajouterContenu(s.id, res.locals.cabinetId, req.utilisateur.id, lireContenuForm(req.body), bid);
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — contenu ajouté (soumission biens #${s.id})`);
  res.redirect('/biens/' + s.id + '#contenus');
});

// --- Modifier / archiver / désarchiver un contenu ----------------------------------------------
function contenuDuCabinet(req, res) {
  const c = bd.prepare('SELECT * FROM biens_contenus WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.params.cid), res.locals.cabinetId);
  if (!c) { pageErreur(res, 404, 'Introuvable', 'Contenu introuvable.'); return null; }
  const s = biens.obtenirSoumission(c.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { contenu: c, soumission: s };
}

router.post('/contenu/:cid', (req, res) => {
  const ctx = contenuDuCabinet(req, res);
  if (!ctx) return;
  try {
    biens.modifierContenu(ctx.contenu.id, res.locals.cabinetId, req.utilisateur.id, lireContenuForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — contenu modifié (soumission biens #${ctx.soumission.id})`);
  res.redirect('/biens/' + ctx.soumission.id + '#contenus');
});

router.post('/contenu/:cid/archiver', (req, res) => {
  const ctx = contenuDuCabinet(req, res);
  if (!ctx) return;
  biens.archiverContenu(ctx.contenu.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — contenu archivé (soumission biens #${ctx.soumission.id})`);
  res.redirect('/biens/' + ctx.soumission.id + '#contenus');
});

router.post('/contenu/:cid/desarchiver', (req, res) => {
  const ctx = contenuDuCabinet(req, res);
  if (!ctx) return;
  biens.desarchiverContenu(ctx.contenu.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — contenu désarchivé (soumission biens #${ctx.soumission.id})`);
  res.redirect('/biens/' + ctx.soumission.id + '#contenus');
});

// --- Garanties d'un bâtiment -------------------------------------------------------------------
router.post('/:id/batiment/:bid/garanties', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const b = bd.prepare(`
    SELECT id FROM biens_batiments
    WHERE id = ? AND soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(Number(req.params.bid), s.id, res.locals.cabinetId);
  if (!b) return pageErreur(res, 404, 'Introuvable', 'Bâtiment introuvable.');
  const formule = (req.body.formule || '').trim() || null;
  if (formule && !FORMULES.includes(formule)) {
    return pageErreur(res, 400, 'Valeur invalide', 'Formule de garantie invalide.');
  }
  const avenants = {};
  for (const code of asArray(req.body.avenants)) {
    if (AVENANTS_BIENS.some(([c]) => c === code)) avenants[code] = 1;
  }
  try {
    biens.definirGaranties(b.id, res.locals.cabinetId, req.utilisateur.id, {
      formule,
      franchise: req.body.franchise ? Number(req.body.franchise) : null,
      montant_assurance: req.body.montant_assurance ? Number(req.body.montant_assurance) : null,
      avenants,
      prime: req.body.prime ? Number(req.body.prime) : null,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — garanties modifiées, bâtiment #${b.id} (soumission biens #${s.id})`);
  res.redirect('/biens/' + s.id + '#garanties');
});

// --- Antécédents -----------------------------------------------------------------------------------
router.post('/:id/antecedents', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const consentements = {};
  for (const c of ['credit', 'dossier_assurance']) {
    if (req.body['consentement_' + c] === 'on') consentements[c] = 1;
  }
  try {
    biens.definirAntecedents(s.id, res.locals.cabinetId, req.utilisateur.id, {
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
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — antécédents modifiés (soumission biens #${s.id})`);
  res.redirect('/biens/' + s.id + '#antecedents');
});

// --- Changer le statut -------------------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const statut = String(req.body.statut || '');
  if (!biens.STATUTS_SOUMISSION.includes(statut)) {
    return pageErreur(res, 400, 'Statut invalide', 'Le statut demandé est invalide.');
  }
  biens.changerStatutSoumission(s.id, res.locals.cabinetId, req.utilisateur.id, statut);
  res.redirect('/biens/' + s.id);
});

// --- Conversion soumission → police (gestion) ---------------------------------------------------------------
// Crée la police biens liée (produit 'biens') et fige la version de la soumission en référence.
// Miroir de POST /auto/:id/convertir.
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
      VALUES (?, ?, 'biens', ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(cabinetId, s.client_id, assureur.nom, assureur.id, numero, dateEffet, dateEcheance,
      franchise, `Convertie de la soumission biens #${s.id}`, responsableId);
    const policeId = r.lastInsertRowid;
    const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM biens_soumission_versions WHERE soumission_id = ?')
      .get(s.id).m;
    bd.prepare('UPDATE polices SET biens_soumission_id = ?, biens_soumission_version = ? WHERE id = ?')
      .run(s.id, versionFige, policeId);
    biens.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
    creerVersionPolice(policeId, req.utilisateur.id); // v1
    journal(cabinetId, req.utilisateur.id, 'police_creee',
      `Police ${numero} (id ${policeId}) convertie de la soumission biens #${s.id}`);
    res.redirect('/echeances/police/' + policeId);
  } catch (e) {
    const msg = String(e.message || '').includes('UNIQUE')
      ? 'Ce numéro de police existe déjà dans votre cabinet.' : 'Erreur d’enregistrement.';
    return pageErreur(res, 400, 'Conversion impossible', msg);
  }
});

// Lier une police biens existante (même entreprise, non liée) à la soumission.
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
  if (p.ligne !== 'biens') return pageErreur(res, 400, 'Police invalide', 'Seule une police biens peut être liée.');
  if (p.biens_soumission_id) return pageErreur(res, 400, 'Police invalide', 'Cette police est déjà liée à une soumission.');
  if (p.client_id !== s.client_id) return pageErreur(res, 400, 'Police invalide', 'La police doit appartenir à la même entreprise que la soumission.');
  if (estCourtier(req) && clientHorsPortefeuille(cabinetId, req.utilisateur, p.client_id)) return reponseHorsPortefeuille(res);
  const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM biens_soumission_versions WHERE soumission_id = ?')
    .get(s.id).m;
  bd.prepare('UPDATE polices SET biens_soumission_id = ?, biens_soumission_version = ? WHERE id = ? AND cabinet_id = ?')
    .run(s.id, versionFige, p.id, cabinetId);
  biens.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
  creerVersionPolice(p.id, req.utilisateur.id, `Liée à la soumission biens #${s.id}`);
  journal(cabinetId, req.utilisateur.id, 'police_liee_soumission',
    `Police id ${p.id} liée à la soumission biens #${s.id}`);
  res.redirect('/echeances/police/' + p.id);
});

// --- Archiver / désarchiver la soumission ---------------------------------------------------------------
router.post('/:id/archiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  biens.archiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/biens');
});

router.post('/:id/desarchiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  biens.desarchiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/biens/' + s.id);
});

// --- Version en lecture seule ------------------------------------------------------------------------------
router.get('/:id/versions/:v', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const version = biens.obtenirVersion(s.id, Number(req.params.v), res.locals.cabinetId);
  if (!version) return pageErreur(res, 404, 'Introuvable', 'Version introuvable.');
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  res.render('biens/version', {
    s,
    version,
    clientNom: client ? client.raison_sociale : '—',
    NOMS_STATUTS_SOUMISSION, NOMS_TYPE_CONSTRUCTION, NOMS_TYPE_CONTENU, NOMS_FORMULE, AVENANTS_BIENS,
  });
});

module.exports = router;
module.exports.NOMS_STATUTS_SOUMISSION = NOMS_STATUTS_SOUMISSION;
module.exports.TYPES_CONSTRUCTION = TYPES_CONSTRUCTION;
module.exports.NOMS_TYPE_CONSTRUCTION = NOMS_TYPE_CONSTRUCTION;
module.exports.TYPES_CONTENU = TYPES_CONTENU;
module.exports.NOMS_TYPE_CONTENU = NOMS_TYPE_CONTENU;
module.exports.FORMULES = FORMULES;
module.exports.NOMS_FORMULE = NOMS_FORMULE;
module.exports.AVENANTS_BIENS = AVENANTS_BIENS;
