/**
 * routes/cyber.js — Questionnaire de soumission « Cyber / cyberrisques » (étape 2/10 cyber).
 * Soumissions d'assurance cyberrisques : mesures de sécurité en nombre
 * illimité, garanties par soumission, antécédents (incidents cyber 5 ans),
 * historique de versions.
 * Toute la logique métier passe par lib/cyber.js (versionnage automatique,
 * journal d'audit, filtre cabinet_id). Règle d'or : archivage, jamais de DELETE.
 * Miroir de routes/rc.js (la conversion en police arrivera à l'étape 3/10,
 * la proposition pré-remplie à l'étape 7/10).
 */
const express = require('express');
const demandesInfos = require('../lib/demandes-infos');
const marche = require('../lib/marche');

const bd = require('../lib/bd');
const cyber = require('../lib/cyber');
const { creerVersionPolice } = require('./polices');
const propositionCyber = require('../lib/proposition-cyber');
const { genererPropositionCyberPdf } = require('../lib/proposition-cyber-pdf');
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
// Types de mesure de sécurité (liste fermée, libellés du dictionnaire — domaine « cyber »).
const TYPES_MESURE = [
  'mfa', 'sauvegardes', 'antivirus_edr', 'pare_feu', 'formation_hameconnage',
  'plan_reponse_incident', 'chiffrement', 'gestion_correctifs', 'controle_acces', 'autre',
];
const NOMS_TYPE_MESURE = {
  mfa: 'MFA — authentification multifacteur',
  sauvegardes: 'Sauvegardes',
  antivirus_edr: 'Antivirus / EDR',
  pare_feu: 'Pare-feu',
  formation_hameconnage: 'Formation anti-hameçonnage',
  plan_reponse_incident: 'Plan de réponse aux incidents',
  chiffrement: 'Chiffrement',
  gestion_correctifs: 'Gestion des correctifs',
  controle_acces: 'Contrôle d’accès',
  autre: 'Autre',
};
// Niveaux de maturité d'une mesure (CHECK en base : cyber_mesures.statut).
const STATUTS_MESURE = ['en_place', 'partiel', 'absent', 'prevu'];
const NOMS_STATUT_MESURE = {
  en_place: 'En place',
  partiel: 'Partiel',
  absent: 'Absent',
  prevu: 'Prévu',
};
// Avenants cyber (clés JSON de cyber_garanties.avenants).
const AVENANTS_CYBER = [
  ['rancongiciel', 'Rançongiciel'],
  ['fraude_transfert', 'Fraude par transfert de fonds'],
  ['donnees_vie_privee', 'Données et vie privée'],
  ['interruption', 'Interruption d’activité'],
];

// --- Utilitaires ------------------------------------------------------------
function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

// Police liée à une soumission (1 soumission → 1 police).
function policeLiee(soumissionId, cabinetId) {
  return bd.prepare('SELECT * FROM polices WHERE cyber_soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
}

// Avenant en cours de terme : toute modification des mesures de sécurité /
// garanties / antécédents / statut d'une soumission convertie crée une version
// de la police avec note (règle d'or : jamais de modification silencieuse).
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
  const s = cyber.obtenirSoumission(Number(req.params.id), res.locals.cabinetId,
    { inclureArchives: !!inclureArchives });
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return s;
}

function lireMesureForm(body) {
  const typeMesure = (body.type_mesure || '').trim();
  if (!TYPES_MESURE.includes(typeMesure)) throw new Error('Type de mesure invalide.');
  const statut = (body.statut || '').trim() || null;
  if (statut && !STATUTS_MESURE.includes(statut)) throw new Error('Statut de mesure invalide.');
  return {
    type_mesure: typeMesure,
    statut,
    details: (body.details || '').trim() || null,
    notes: (body.notes || '').trim() || null,
  };
}

// --- Liste ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const cabinetId = res.locals.cabinetId;
  const voirArchives = req.query.archives === '1';
  const statut = cyber.STATUTS_SOUMISSION.includes(req.query.statut) ? req.query.statut : '';
  let sql = `
    SELECT s.*, c.raison_sociale AS client_nom,
      (SELECT COUNT(*) FROM cyber_mesures WHERE soumission_id = s.id AND archive = 0) AS nb_mesures
    FROM cyber_soumissions s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.cabinet_id = ? AND s.archive = ${voirArchives ? '1' : '0'}`;
  const params = [cabinetId];
  if (statut) { sql += ' AND s.statut = ?'; params.push(statut); }
  if (estCourtier(req)) sql += ` AND c.responsable_id = ${Number(req.utilisateur.id)}`;
  sql += ' ORDER BY s.id DESC';
  const soumissions = bd.prepare(sql).all(...params);
  res.render('cyber/liste', { soumissions, voirArchives, statut, NOMS_STATUTS_SOUMISSION });
});

// --- Nouvelle soumission --------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  const entreprises = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  res.render('cyber/formulaire', { erreur: null, valeurs: {}, entreprises });
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
    return res.status(400).render('cyber/formulaire', {
      erreur: erreurs.join(' '), valeurs: req.body, entreprises,
    });
  }
  const id = cyber.creerSoumission({
    cabinetId,
    userId: req.utilisateur.id,
    clientId,
    dateEffetSouhaitee: dateEffet || null,
    notes: (req.body.notes || '').trim() || null,
  });
  res.redirect('/cyber/' + id);
});

// --- Fiche ----------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  const versions = cyber.versionsSoumission(s.id, res.locals.cabinetId);
  const police = policeLiee(s.id, res.locals.cabinetId);
  let policesDispo = [];
  let assureurs = [];
  if (!police && s.statut !== 'convertie_police') {
    policesDispo = bd.prepare(`
      SELECT id, numero_police FROM polices
      WHERE cabinet_id = ? AND client_id = ? AND ligne = 'cyber' AND cyber_soumission_id IS NULL
      ORDER BY numero_police
    `).all(res.locals.cabinetId, s.client_id);
    assureurs = bd.prepare('SELECT id, nom FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom')
      .all(res.locals.cabinetId);
  }
  res.render('cyber/fiche', { sectionDemandes: demandesInfos.sectionPourFiche('cyber', s, req.utilisateur.cabinet_id),
    sectionMarche: marche.sectionPourCible(req.utilisateur.cabinet_id, { produit: 'cyber', soumissionId: s.id }), NOMS_STATUTS_ENVOI: marche.NOMS_STATUTS_ENVOI, 
    s,
    clientNom: client ? client.raison_sociale : '—',
    versions,
    policeLiee: police || null,
    policesDispo,
    assureurs,
    NOMS_STATUTS_SOUMISSION,
    TYPES_MESURE, NOMS_TYPE_MESURE, STATUTS_MESURE, NOMS_STATUT_MESURE, AVENANTS_CYBER,
  });
});

// --- Ajouter une mesure de sécurité ----------------------------------------------------------
router.post('/:id/mesure', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    cyber.ajouterMesure(s.id, res.locals.cabinetId, req.utilisateur.id, lireMesureForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — mesure ajoutée (soumission cyber #${s.id})`);
  res.redirect('/cyber/' + s.id + '#mesures');
});

// --- Modifier / archiver / désarchiver une mesure --------------------------------------------
function mesureDuCabinet(req, res) {
  const m = bd.prepare('SELECT * FROM cyber_mesures WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.params.mid), res.locals.cabinetId);
  if (!m) { pageErreur(res, 404, 'Introuvable', 'Mesure introuvable.'); return null; }
  const s = cyber.obtenirSoumission(m.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { mesure: m, soumission: s };
}

router.post('/mesure/:mid', (req, res) => {
  const ctx = mesureDuCabinet(req, res);
  if (!ctx) return;
  try {
    cyber.modifierMesure(ctx.mesure.id, res.locals.cabinetId, req.utilisateur.id, lireMesureForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — mesure modifiée (soumission cyber #${ctx.soumission.id})`);
  res.redirect('/cyber/' + ctx.soumission.id + '#mesures');
});

router.post('/mesure/:mid/archiver', (req, res) => {
  const ctx = mesureDuCabinet(req, res);
  if (!ctx) return;
  cyber.archiverMesure(ctx.mesure.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — mesure archivée (soumission cyber #${ctx.soumission.id})`);
  res.redirect('/cyber/' + ctx.soumission.id + '#mesures');
});

router.post('/mesure/:mid/desarchiver', (req, res) => {
  const ctx = mesureDuCabinet(req, res);
  if (!ctx) return;
  cyber.desarchiverMesure(ctx.mesure.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — mesure désarchivée (soumission cyber #${ctx.soumission.id})`);
  res.redirect('/cyber/' + ctx.soumission.id + '#mesures');
});

// --- Garanties de la soumission --------------------------------------------------------------
router.post('/:id/garanties', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const avenants = {};
  const recus = Array.isArray(req.body.avenants) ? req.body.avenants : (req.body.avenants ? [req.body.avenants] : []);
  for (const code of recus) {
    if (AVENANTS_CYBER.some(([c]) => c === code)) avenants[code] = 1;
  }
  try {
    cyber.definirGaranties(s.id, res.locals.cabinetId, req.utilisateur.id, {
      limite_par_sinistre: req.body.limite_par_sinistre ? Number(req.body.limite_par_sinistre) : null,
      limite_agregat: req.body.limite_agregat ? Number(req.body.limite_agregat) : null,
      franchise: req.body.franchise ? Number(req.body.franchise) : null,
      delai_carence: (req.body.delai_carence || '').trim() || null,
      avenants,
      prime: req.body.prime ? Number(req.body.prime) : null,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — garanties modifiées (soumission cyber #${s.id})`);
  res.redirect('/cyber/' + s.id + '#garanties');
});

// --- Exposition aux données (questionnaire type CFC) ----------------------------------------------
router.post('/:id/exposition', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const lignes = (texte, cles) => {
    const out = [];
    for (const ligne of String(texte || '').split('\n')) {
      const parties = ligne.split('|').map((x) => x.trim());
      if (!parties[0]) continue;
      const o = {};
      cles.forEach((c, i) => { o[c] = i === cles.length - 1 && c !== 'type' && c !== 'norme' ? (parties[i] ? Number(parties[i]) : null) : (parties[i] || null); });
      out.push(o);
    }
    return out;
  };
  try {
    cyber.definirExposition(s.id, res.locals.cabinetId, req.utilisateur.id, {
      nb_enregistrements: req.body.nb_enregistrements ? Number(req.body.nb_enregistrements) : null,
      types_donnees: lignes(req.body.types_donnees, ['type', 'nombre']),
      responsable_securite: (req.body.responsable_securite || '').trim() || null,
      normes: lignes(req.body.normes, ['norme']),
      revenus_territoires: lignes(req.body.revenus_territoires, ['territoire', 'montant']),
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  res.redirect('/cyber/' + s.id + '#exposition');
});

// --- Antécédents -------------------------------------------------------------------------------
router.post('/:id/antecedents', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const consentements = {};
  for (const c of ['credit', 'dossier_assurance']) {
    if (req.body['consentement_' + c] === 'on') consentements[c] = 1;
  }
  try {
    cyber.definirAntecedents(s.id, res.locals.cabinetId, req.utilisateur.id, {
      assureur_actuel: (req.body.assureur_actuel || '').trim() || null,
      numero_police_actuelle: (req.body.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: (req.body.date_expiration_actuelle || '').trim() || null,
      annees_assurance_continue: req.body.annees_assurance_continue ? Number(req.body.annees_assurance_continue) : null,
      incidents_5ans: parseLignesJson(req.body.incidents_json, ['date', 'type', 'montant', 'reclame']),
      consentements,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — antécédents modifiés (soumission cyber #${s.id})`);
  res.redirect('/cyber/' + s.id + '#antecedents');
});

// --- Changer le statut --------------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const statut = String(req.body.statut || '');
  if (!cyber.STATUTS_SOUMISSION.includes(statut)) {
    return pageErreur(res, 400, 'Statut invalide', 'Le statut demandé est invalide.');
  }
  cyber.changerStatutSoumission(s.id, res.locals.cabinetId, req.utilisateur.id, statut);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — statut modifié (soumission cyber #${s.id})`);
  res.redirect('/cyber/' + s.id);
});

// --- Convertir en police ----------------------------------------------------------------------------
// Miroir de POST /rc/:id/convertir.
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
      VALUES (?, ?, 'cyber', ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(cabinetId, s.client_id, assureur.nom, assureur.id, numero, dateEffet, dateEcheance,
      franchise, `Convertie de la soumission cyber #${s.id}`, responsableId);
    const policeId = r.lastInsertRowid;
    const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM cyber_soumission_versions WHERE soumission_id = ?')
      .get(s.id).m;
    bd.prepare('UPDATE polices SET cyber_soumission_id = ?, cyber_soumission_version = ? WHERE id = ?')
      .run(s.id, versionFige, policeId);
    cyber.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
    creerVersionPolice(policeId, req.utilisateur.id); // v1
    journal(cabinetId, req.utilisateur.id, 'police_creee',
      `Police ${numero} (id ${policeId}) convertie de la soumission cyber #${s.id}`);
    res.redirect('/echeances/police/' + policeId);
  } catch (e) {
    const msg = String(e.message || '').includes('UNIQUE')
      ? 'Ce numéro de police existe déjà dans votre cabinet.' : 'Erreur d’enregistrement.';
    return pageErreur(res, 400, 'Conversion impossible', msg);
  }
});

// Lier une police cyber existante (même entreprise, non liée) à la soumission.
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
  if (p.ligne !== 'cyber') return pageErreur(res, 400, 'Police invalide', 'Seule une police cyber peut être liée.');
  if (p.cyber_soumission_id) return pageErreur(res, 400, 'Police invalide', 'Cette police est déjà liée à une soumission.');
  if (p.client_id !== s.client_id) return pageErreur(res, 400, 'Police invalide', 'La police doit appartenir à la même entreprise que la soumission.');
  if (estCourtier(req) && clientHorsPortefeuille(cabinetId, req.utilisateur, p.client_id)) return reponseHorsPortefeuille(res);
  const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM cyber_soumission_versions WHERE soumission_id = ?')
    .get(s.id).m;
  bd.prepare('UPDATE polices SET cyber_soumission_id = ?, cyber_soumission_version = ? WHERE id = ? AND cabinet_id = ?')
    .run(s.id, versionFige, p.id, cabinetId);
  cyber.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
  creerVersionPolice(p.id, req.utilisateur.id, `Liée à la soumission cyber #${s.id}`);
  journal(cabinetId, req.utilisateur.id, 'police_liee_soumission',
    `Police id ${p.id} liée à la soumission cyber #${s.id}`);
  res.redirect('/echeances/police/' + p.id);
});

// --- Archiver / désarchiver la soumission ----------------------------------------------------------
router.post('/:id/archiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  cyber.archiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — soumission archivée (soumission cyber #${s.id})`);
  res.redirect('/cyber');
});

router.post('/:id/desarchiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  cyber.desarchiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/cyber/' + s.id);
});

// --- Version en lecture seule -----------------------------------------------------------------------
router.get('/:id/versions/:v', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const version = cyber.obtenirVersion(s.id, Number(req.params.v), res.locals.cabinetId);
  if (!version) return pageErreur(res, 404, 'Introuvable', 'Version introuvable.');
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  res.render('cyber/version', {
    s,
    version,
    clientNom: client ? client.raison_sociale : '—',
    NOMS_STATUTS_SOUMISSION, NOMS_TYPE_MESURE, NOMS_STATUT_MESURE, AVENANTS_CYBER,
  });
});

// --- Proposition pré-remplie : HTML imprimable + PDF ----------------------------------------
// ?v=N : génère à partir d'une version figée (règle d'or : traçabilité).
// Lecture seule : la proposition ne modifie JAMAIS la soumission.
// Miroir de routes/rc.js (étape 7/10 RC).
function donneesPropositionCyber(req, res) {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return null;
  const vParam = req.query.v ? Number(req.query.v) : null;
  const p = propositionCyber.preparerPropositionCyber(res.locals.cabinetId, s, vParam);
  if (!p) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (p.erreur === 'version') { pageErreur(res, 404, 'Introuvable', 'Version introuvable.'); return null; }
  return { p, vParam };
}

router.get('/:id/proposition', (req, res) => {
  const r = donneesPropositionCyber(req, res);
  if (!r) return;
  journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_cyber_generee',
    `Proposition cyber #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, HTML) générée`);
  res.render('cyber/proposition', { p: r.p, vParam: r.vParam });
});

router.get('/:id/proposition.pdf', (req, res) => {
  const r = donneesPropositionCyber(req, res);
  if (!r) return;
  genererPropositionCyberPdf(r.p).then((pdf) => {
    journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_cyber_generee',
      `Proposition cyber #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, PDF) générée`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="proposition-cyber-${r.p.soumissionId}-v${r.p.versionNumero}.pdf"`);
    res.send(pdf);
  }).catch(() => pageErreur(res, 500, 'Erreur', 'Génération du PDF impossible.'));
});

module.exports = router;
module.exports.NOMS_STATUTS_SOUMISSION = NOMS_STATUTS_SOUMISSION;
module.exports.TYPES_MESURE = TYPES_MESURE;
module.exports.NOMS_TYPE_MESURE = NOMS_TYPE_MESURE;
module.exports.STATUTS_MESURE = STATUTS_MESURE;
module.exports.NOMS_STATUT_MESURE = NOMS_STATUT_MESURE;
module.exports.AVENANTS_CYBER = AVENANTS_CYBER;
