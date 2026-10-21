/**
 * routes/pe.js — Questionnaire de soumission « Perte d'exploitation /
 * interruption des affaires » (étape 2/10 PE).
 * Soumissions d'assurance perte d'exploitation : établissements assurés
 * en nombre illimité, garanties par soumission (période d'indemnité en
 * mois, franchise en jours, base d'indemnité), antécédents (interruptions
 * des 5 dernières années), historique de versions.
 * Toute la logique métier passe par lib/pe.js (versionnage automatique,
 * journal d'audit, filtre cabinet_id). Règle d'or : archivage, jamais de DELETE.
 * Miroir de routes/do.js (la conversion en police est faite à l'étape 3/10,
 * la proposition pré-remplie à l'étape 7/10).
 */
const express = require('express');
const demandesInfos = require('../lib/demandes-infos');

const bd = require('../lib/bd');
const pesoum = require('../lib/pe');
const propositionPe = require('../lib/proposition-pe');
const { genererPropositionPePdf } = require('../lib/proposition-pe-pdf');
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
// Périodes d'indemnité (CHECK en base : pe_garanties.periode_indemnite_mois).
const PERIODES_INDEMNITE_MOIS = [12, 18, 24];
const NOMS_PERIODE_INDEMNITE = {
  12: '12 mois',
  18: '18 mois',
  24: '24 mois',
};
// Bases d'indemnité (CHECK en base : pe_garanties.base_montant). Libellés du dictionnaire — domaine « pe ».
const BASES_MONTANT = ['benefice_brut', 'marge_brute', 'chiffre_affaires'];
const NOMS_BASE_MONTANT = {
  benefice_brut: 'Bénéfice brut',
  marge_brute: 'Marge brute',
  chiffre_affaires: 'Chiffre d’affaires',
};
// Bases de valeur d'un établissement (CHECK en base : pe_etablissements.base_valeur).
const BASES_VALEUR = ['remplacement', 'depreciation'];
const NOMS_BASE_VALEUR = {
  remplacement: 'Coût de remplacement',
  depreciation: 'Valeur dépréciée',
};
// Avenants perte d'exploitation (clés JSON de pe_garanties.avenants).
const AVENANTS_PE = [
  ['frais_supplementaires', 'Frais supplémentaires'],
  ['dependance_fournisseurs', 'Dépendance aux fournisseurs'],
  ['acces_civil', 'Accès civil (interdiction d’accès)'],
  ['deterioration_stocks', 'Détérioration des stocks'],
];
// Consentements antécédents (clés JSON de pe_antecedents.consentements).
const CONSENTEMENTS_PE = [
  ['credit', 'Dossier de crédit'],
  ['dossier_assurance', 'Dossier d’assurance (sinistres antérieurs)'],
];

// --- Utilitaires ------------------------------------------------------------
function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

// Police liée à une soumission (1 soumission → 1 police).
function policeLiee(soumissionId, cabinetId) {
  return bd.prepare('SELECT * FROM polices WHERE pe_soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
}

// Avenant en cours de terme : toute modification des établissements / garanties /
// antécédents / statut d'une soumission convertie crée une version de la
// police avec note (règle d'or : jamais de modification silencieuse).
function noterAvenantPolice(soumissionId, cabinetId, userId, note) {
  const p = policeLiee(soumissionId, cabinetId);
  if (p) creerVersionPolice(p.id, userId, note);
}

// Soumission du cabinet + contrôle du portefeuille courtier.
function soumissionAutorisee(req, res, inclureArchives) {
  const s = pesoum.obtenirSoumission(Number(req.params.id), res.locals.cabinetId,
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

function lireEtablissementForm(body) {
  const baseValeur = (body.base_valeur || '').trim() || null;
  if (baseValeur && !BASES_VALEUR.includes(baseValeur)) {
    throw new Error('Base de valeur invalide.');
  }
  return {
    nom_lieu: (body.nom_lieu || '').trim() || null,
    adresse: (body.adresse || '').trim() || null,
    occupation: (body.occupation || '').trim() || null,
    chiffre_affaires: lireNombrePositif(body.chiffre_affaires),
    superficie: lireNombrePositif(body.superficie),
    annee_construction: body.annee_construction === '' || body.annee_construction == null
      ? null : Number(body.annee_construction),
    base_valeur: baseValeur,
    montant_pe: lireNombrePositif(body.montant_pe),
  };
}

// Interruptions des 5 dernières années : une par ligne, format
// « AAAA-MM-JJ|cause|durée (jours)|montant ».
function parserInterruptions(texte) {
  if (!texte) return [];
  return String(texte).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const cols = l.split('|').map((x) => (x || '').trim());
    const duree = cols[2] === undefined || cols[2] === '' ? null : Number(cols[2]);
    const montant = cols[3] === undefined || cols[3] === '' ? null : Number(cols[3]);
    return {
      date: cols[0] || '',
      cause: cols[1] || '',
      duree_jours: duree !== null && isNaN(duree) ? null : duree,
      montant: montant !== null && isNaN(montant) ? null : montant,
    };
  }).filter((o) => o.date || o.cause);
}

function serialiserInterruptions(liste) {
  if (!Array.isArray(liste)) return '';
  return liste.map((x) => [
    x.date || '',
    x.cause || '',
    x.duree_jours === null || x.duree_jours === undefined ? '' : x.duree_jours,
    x.montant === null || x.montant === undefined ? '' : x.montant,
  ].join(' | ')).join('\n');
}

// --- Liste ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const cabinetId = res.locals.cabinetId;
  const voirArchives = req.query.archives === '1';
  const statut = pesoum.STATUTS_SOUMISSION.includes(req.query.statut) ? req.query.statut : '';
  let sql = `
    SELECT s.*, c.raison_sociale AS client_nom,
      (SELECT COUNT(*) FROM pe_etablissements WHERE soumission_id = s.id AND archive = 0) AS nb_etablissements,
      (SELECT limite FROM pe_garanties WHERE soumission_id = s.id AND archive = 0) AS limite
    FROM pe_soumissions s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.cabinet_id = ? AND s.archive = ${voirArchives ? '1' : '0'}`;
  const params = [cabinetId];
  if (statut) { sql += ' AND s.statut = ?'; params.push(statut); }
  if (estCourtier(req)) sql += ` AND c.responsable_id = ${Number(req.utilisateur.id)}`;
  sql += ' ORDER BY s.id DESC';
  const soumissions = bd.prepare(sql).all(...params);
  res.render('pe/liste', { soumissions, voirArchives, statut, NOMS_STATUTS_SOUMISSION });
});

// --- Nouvelle soumission --------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  const entreprises = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  res.render('pe/formulaire', { erreur: null, valeurs: {}, entreprises });
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
    return res.status(400).render('pe/formulaire', {
      erreur: erreurs.join(' '), valeurs: req.body, entreprises,
    });
  }
  const id = pesoum.creerSoumission({
    cabinetId,
    userId: req.utilisateur.id,
    clientId,
    dateEffetSouhaitee: dateEffet || null,
    notes: (req.body.notes || '').trim() || null,
  });
  res.redirect('/pe/' + id);
});

// --- Fiche ----------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  const versions = pesoum.versionsSoumission(s.id, res.locals.cabinetId);
  const police = policeLiee(s.id, res.locals.cabinetId);
  let policesDispo = [];
  let assureurs = [];
  if (!police && s.statut !== 'convertie_police') {
    policesDispo = bd.prepare(`
      SELECT id, numero_police FROM polices
      WHERE cabinet_id = ? AND client_id = ? AND ligne = 'perte_exploitation' AND pe_soumission_id IS NULL
      ORDER BY numero_police
    `).all(res.locals.cabinetId, s.client_id);
    assureurs = bd.prepare('SELECT id, nom FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom')
      .all(res.locals.cabinetId);
  }
  res.render('pe/fiche', { sectionDemandes: demandesInfos.sectionPourFiche('pe', s, req.utilisateur.cabinet_id), 
    s,
    clientNom: client ? client.raison_sociale : '—',
    versions,
    policeLiee: police || null,
    policesDispo,
    assureurs,
    NOMS_STATUTS_SOUMISSION,
    PERIODES_INDEMNITE_MOIS, NOMS_PERIODE_INDEMNITE,
    BASES_MONTANT, NOMS_BASE_MONTANT,
    BASES_VALEUR, NOMS_BASE_VALEUR,
    AVENANTS_PE, CONSENTEMENTS_PE,
    interruptionsTexte: serialiserInterruptions(s.antecedents ? s.antecedents.interruptions_5ans : null),
  });
});

// --- Ajouter un établissement -----------------------------------------------------------------
router.post('/:id/etablissement', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    pesoum.ajouterEtablissement(s.id, res.locals.cabinetId, req.utilisateur.id, lireEtablissementForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — établissement ajouté (soumission perte d'exploitation #${s.id})`);
  res.redirect('/pe/' + s.id + '#etablissements');
});

// --- Modifier / archiver / désarchiver un établissement --------------------------------------
function etablissementDuCabinet(req, res) {
  const e = bd.prepare('SELECT * FROM pe_etablissements WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.params.eid), res.locals.cabinetId);
  if (!e) { pageErreur(res, 404, 'Introuvable', 'Établissement introuvable.'); return null; }
  const s = pesoum.obtenirSoumission(e.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { etablissement: e, soumission: s };
}

router.post('/etablissement/:eid', (req, res) => {
  const ctx = etablissementDuCabinet(req, res);
  if (!ctx) return;
  try {
    pesoum.modifierEtablissement(ctx.etablissement.id, res.locals.cabinetId, req.utilisateur.id, lireEtablissementForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — établissement modifié (soumission perte d'exploitation #${ctx.soumission.id})`);
  res.redirect('/pe/' + ctx.soumission.id + '#etablissements');
});

router.post('/etablissement/:eid/archiver', (req, res) => {
  const ctx = etablissementDuCabinet(req, res);
  if (!ctx) return;
  pesoum.archiverEtablissement(ctx.etablissement.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — établissement archivé (soumission perte d'exploitation #${ctx.soumission.id})`);
  res.redirect('/pe/' + ctx.soumission.id + '#etablissements');
});

router.post('/etablissement/:eid/desarchiver', (req, res) => {
  const ctx = etablissementDuCabinet(req, res);
  if (!ctx) return;
  pesoum.desarchiverEtablissement(ctx.etablissement.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — établissement désarchivé (soumission perte d'exploitation #${ctx.soumission.id})`);
  res.redirect('/pe/' + ctx.soumission.id + '#etablissements');
});

// --- Garanties de la soumission ---------------------------------------------------------------
router.post('/:id/garanties', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const periodeRaw = (req.body.periode_indemnite_mois || '').trim();
  const periode = periodeRaw === '' ? null : Number(periodeRaw);
  if (periode !== null && !PERIODES_INDEMNITE_MOIS.includes(periode)) {
    return pageErreur(res, 400, 'Enregistrement impossible', 'Période d’indemnité invalide (12, 18 ou 24 mois).');
  }
  const baseMontant = (req.body.base_montant || '').trim() || null;
  if (baseMontant && !BASES_MONTANT.includes(baseMontant)) {
    return pageErreur(res, 400, 'Enregistrement impossible', 'Base d’indemnité invalide.');
  }
  const franchiseJours = req.body.franchise_jours === '' || req.body.franchise_jours == null
    ? null : Number(req.body.franchise_jours);
  if (franchiseJours !== null && (!Number.isInteger(franchiseJours) || franchiseJours < 0)) {
    return pageErreur(res, 400, 'Enregistrement impossible', 'Franchise (en jours) invalide.');
  }
  const avenants = {};
  const recus = Array.isArray(req.body.avenants) ? req.body.avenants : (req.body.avenants ? [req.body.avenants] : []);
  for (const code of recus) {
    if (AVENANTS_PE.some(([c]) => c === code)) avenants[code] = 1;
  }
  const formulePE = (req.body.formule || '').trim() || null;
  if (formulePE && !pesoum.FORMULES_PE.includes(formulePE)) {
    return pageErreur(res, 400, 'Enregistrement impossible', 'Formule de perte d\u2019exploitation invalide.');
  }
  try {
    pesoum.definirGaranties(s.id, res.locals.cabinetId, req.utilisateur.id, {
      limite: lireNombrePositif(req.body.limite),
      periode_indemnite_mois: periode,
      franchise_jours: franchiseJours,
      base_montant: baseMontant,
      avenants,
      prime: lireNombrePositif(req.body.prime),
      // Soumission combinée (étape 5/10).
      regle_proportionnelle: lireNombrePositif(req.body.regle_proportionnelle),
      honoraires_comptables: lireNombrePositif(req.body.honoraires_comptables),
      formule: formulePE,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — garanties modifiées (soumission perte d'exploitation #${s.id})`);
  res.redirect('/pe/' + s.id + '#garanties');
});

// --- Antécédents --------------------------------------------------------------------------------
router.post('/:id/antecedents', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const consentements = {};
  for (const [code] of CONSENTEMENTS_PE) {
    if (req.body['consentement_' + code] === 'on') consentements[code] = 1;
  }
  try {
    pesoum.definirAntecedents(s.id, res.locals.cabinetId, req.utilisateur.id, {
      assureur_actuel: (req.body.assureur_actuel || '').trim() || null,
      numero_police_actuelle: (req.body.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: (req.body.date_expiration_actuelle || '').trim() || null,
      annees_assurance_continue: req.body.annees_assurance_continue ? Number(req.body.annees_assurance_continue) : null,
      interruptions_5ans: parserInterruptions(req.body.interruptions),
      consentements,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — antécédents modifiés (soumission perte d'exploitation #${s.id})`);
  res.redirect('/pe/' + s.id + '#antecedents');
});

// --- Changer le statut ---------------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const statut = String(req.body.statut || '');
  if (!pesoum.STATUTS_SOUMISSION.includes(statut)) {
    return pageErreur(res, 400, 'Statut invalide', 'Le statut demandé est invalide.');
  }
  pesoum.changerStatutSoumission(s.id, res.locals.cabinetId, req.utilisateur.id, statut);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — statut modifié (soumission perte d'exploitation #${s.id})`);
  res.redirect('/pe/' + s.id);
});

// --- Archiver / désarchiver la soumission ------------------------------------------------------------
router.post('/:id/archiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  pesoum.archiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — soumission archivée (soumission perte d'exploitation #${s.id})`);
  res.redirect('/pe');
});

router.post('/:id/desarchiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  pesoum.desarchiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/pe/' + s.id);
});

// --- Convertir en police ----------------------------------------------------------------------------
// Miroir de POST /do/:id/convertir.
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
      VALUES (?, ?, 'perte_exploitation', ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(cabinetId, s.client_id, assureur.nom, assureur.id, numero, dateEffet, dateEcheance,
      franchise, `Convertie de la soumission perte d'exploitation #${s.id}`, responsableId);
    const policeId = r.lastInsertRowid;
    const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM pe_soumission_versions WHERE soumission_id = ?')
      .get(s.id).m;
    bd.prepare('UPDATE polices SET pe_soumission_id = ?, pe_soumission_version = ? WHERE id = ?')
      .run(s.id, versionFige, policeId);
    pesoum.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
    creerVersionPolice(policeId, req.utilisateur.id); // v1
    journal(cabinetId, req.utilisateur.id, 'police_creee',
      `Police ${numero} (id ${policeId}) convertie de la soumission perte d'exploitation #${s.id}`);
    res.redirect('/echeances/police/' + policeId);
  } catch (e) {
    const msg = String(e.message || '').includes('UNIQUE')
      ? 'Ce numéro de police existe déjà dans votre cabinet.' : 'Erreur d’enregistrement.';
    return pageErreur(res, 400, 'Conversion impossible', msg);
  }
});

// Lier une police perte d'exploitation existante (même entreprise, non liée) à la soumission.
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
  if (p.ligne !== 'perte_exploitation') return pageErreur(res, 400, 'Police invalide', 'Seule une police perte d’exploitation peut être liée.');
  if (p.pe_soumission_id) return pageErreur(res, 400, 'Police invalide', 'Cette police est déjà liée à une soumission.');
  if (p.client_id !== s.client_id) return pageErreur(res, 400, 'Police invalide', 'La police doit appartenir à la même entreprise que la soumission.');
  if (estCourtier(req) && clientHorsPortefeuille(cabinetId, req.utilisateur, p.client_id)) return reponseHorsPortefeuille(res);
  const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM pe_soumission_versions WHERE soumission_id = ?')
    .get(s.id).m;
  bd.prepare('UPDATE polices SET pe_soumission_id = ?, pe_soumission_version = ? WHERE id = ? AND cabinet_id = ?')
    .run(s.id, versionFige, p.id, cabinetId);
  pesoum.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
  creerVersionPolice(p.id, req.utilisateur.id, `Liée à la soumission perte d'exploitation #${s.id}`);
  journal(cabinetId, req.utilisateur.id, 'police_liee_soumission',
    `Police id ${p.id} liée à la soumission perte d'exploitation #${s.id}`);
  res.redirect('/echeances/police/' + p.id);
});

// --- Version en lecture seule -------------------------------------------------------------------------
router.get('/:id/versions/:v', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const version = pesoum.obtenirVersion(s.id, Number(req.params.v), res.locals.cabinetId);
  if (!version) return pageErreur(res, 404, 'Introuvable', 'Version introuvable.');
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  res.render('pe/version', {
    s,
    version,
    clientNom: client ? client.raison_sociale : '—',
    NOMS_STATUTS_SOUMISSION, NOMS_BASE_MONTANT, NOMS_BASE_VALEUR, AVENANTS_PE,
  });
});

// --- Proposition pré-remplie : HTML imprimable + PDF -------------------------------------
// ?v=N : génère à partir d'une version figée (règle d'or : traçabilité).
// Lecture seule : la proposition ne modifie JAMAIS la soumission.
// Miroir de routes/do.js (étape 7/10 D&O).
function donneesPropositionPe(req, res) {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return null;
  const vParam = req.query.v ? Number(req.query.v) : null;
  const p = propositionPe.preparerPropositionPe(res.locals.cabinetId, s, vParam);
  if (!p) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (p.erreur === 'version') { pageErreur(res, 404, 'Introuvable', 'Version introuvable.'); return null; }
  return { p, vParam };
}

router.get('/:id/proposition', (req, res) => {
  const r = donneesPropositionPe(req, res);
  if (!r) return;
  journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_pe_generee',
    `Proposition perte d'exploitation #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, HTML) générée`);
  res.render('pe/proposition', { p: r.p, vParam: r.vParam });
});

router.get('/:id/proposition.pdf', (req, res) => {
  const r = donneesPropositionPe(req, res);
  if (!r) return;
  genererPropositionPePdf(r.p).then((pdf) => {
    journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_pe_generee',
      `Proposition perte d'exploitation #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, PDF) générée`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="proposition-pe-${r.p.soumissionId}-v${r.p.versionNumero}.pdf"`);
    res.send(pdf);
  }).catch(() => pageErreur(res, 500, 'Erreur', 'Génération du PDF impossible.'));
});

module.exports = router;
module.exports.NOMS_STATUTS_SOUMISSION = NOMS_STATUTS_SOUMISSION;
module.exports.PERIODES_INDEMNITE_MOIS = PERIODES_INDEMNITE_MOIS;
module.exports.NOMS_PERIODE_INDEMNITE = NOMS_PERIODE_INDEMNITE;
module.exports.BASES_MONTANT = BASES_MONTANT;
module.exports.NOMS_BASE_MONTANT = NOMS_BASE_MONTANT;
module.exports.BASES_VALEUR = BASES_VALEUR;
module.exports.NOMS_BASE_VALEUR = NOMS_BASE_VALEUR;
module.exports.AVENANTS_PE = AVENANTS_PE;
module.exports.CONSENTEMENTS_PE = CONSENTEMENTS_PE;
module.exports.parserInterruptions = parserInterruptions;
module.exports.serialiserInterruptions = serialiserInterruptions;
