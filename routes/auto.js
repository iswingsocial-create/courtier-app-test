/**
 * routes/auto.js — Questionnaire de soumission FPQ1 (étape 2/10).
 * Soumissions d'assurance automobile : conducteurs et véhicules en nombre
 * illimité, garanties par véhicule, antécédents, historique de versions.
 * Toute la logique métier passe par lib/fpq1.js (versionnage automatique,
 * journal d'audit, filtre cabinet_id). Règle d'or : archivage, jamais de DELETE.
 */
const express = require('express');
const demandesInfos = require('../lib/demandes-infos');

const bd = require('../lib/bd');
const fpq1 = require('../lib/fpq1');
const proposition = require('../lib/proposition');
const { genererPropositionPdf } = require('../lib/proposition-pdf');
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
const RC_MONTANTS = [50000, 1000000, 2000000];
const NOMS_RC = {
  50000: '50 000 $ (minimum légal)',
  1000000: '1 000 000 $',
  2000000: '2 000 000 $ (recommandé)',
};
const PROTECTIONS_B = ['b1', 'b2', 'b3', 'b4'];
const NOMS_PROTECTION_B = {
  b1: 'B1 — Tous risques',
  b2: 'B2 — Collision ou versement',
  b3: 'B3 — Tous risques sauf collision',
  b4: 'B4 — Risques spécifiés',
};
const AVENANTS_FAQ = [
  ['faq43', 'FAQ 43 — Valeur à neuf'],
  ['faq20', 'FAQ 20 — Privation de jouissance (frais de déplacement)'],
  ['faq27', 'FAQ 27 — Dommages au véhicule n’appartenant pas à l’assuré'],
  ['faq34', 'FAQ 34 — Assurance de personnes'],
  ['faq5a', 'FAQ 5a — Crédit-bail (locateur)'],
];

// --- Utilitaires ------------------------------------------------------------
function asArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

// Lignes dynamiques sérialisées en JSON par le JS (public/app.js).
// Ne garde que les clés autorisées, ignore les lignes vides.
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

function parseLignesTexte(raw) {
  return String(raw || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

// Police liée à une soumission (1 soumission → 1 police).
function policeLiee(soumissionId, cabinetId) {
  return bd.prepare('SELECT * FROM polices WHERE auto_soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
}

// Avenant en cours de terme : toute modification des garanties/conducteurs/
// véhicules d'une soumission convertie crée une version de la police avec note.
function noterAvenantPolice(soumissionId, cabinetId, userId, note) {
  const p = policeLiee(soumissionId, cabinetId);
  if (p) creerVersionPolice(p.id, userId, note);
}

// Soumission du cabinet + contrôle du portefeuille courtier.
function soumissionAutorisee(req, res, inclureArchives) {
  const s = fpq1.obtenirSoumission(Number(req.params.id), res.locals.cabinetId,
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
  const statut = fpq1.STATUTS_SOUMISSION.includes(req.query.statut) ? req.query.statut : '';
  let sql = `
    SELECT s.*, c.raison_sociale AS client_nom,
      (SELECT COUNT(*) FROM auto_conducteurs WHERE soumission_id = s.id AND archive = 0) AS nb_conducteurs,
      (SELECT COUNT(*) FROM auto_vehicules WHERE soumission_id = s.id AND archive = 0) AS nb_vehicules
    FROM auto_soumissions s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.cabinet_id = ? AND s.archive = ${voirArchives ? '1' : '0'}`;
  const params = [cabinetId];
  if (statut) { sql += ' AND s.statut = ?'; params.push(statut); }
  if (estCourtier(req)) sql += ` AND c.responsable_id = ${Number(req.utilisateur.id)}`;
  sql += ' ORDER BY s.id DESC';
  const soumissions = bd.prepare(sql).all(...params);
  res.render('auto/liste', { soumissions, voirArchives, statut, NOMS_STATUTS_SOUMISSION });
});

// --- Nouvelle soumission ------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  const entreprises = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  res.render('auto/formulaire', { erreur: null, valeurs: {}, entreprises });
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
    return res.status(400).render('auto/formulaire', {
      erreur: erreurs.join(' '), valeurs: req.body, entreprises,
    });
  }
  const id = fpq1.creerSoumission({
    cabinetId,
    userId: req.utilisateur.id,
    clientId,
    dateEffetSouhaitee: dateEffet || null,
    notes: (req.body.notes || '').trim() || null,
  });
  res.redirect('/auto/' + id);
});

// --- Fiche --------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  const versions = fpq1.versionsSoumission(s.id, res.locals.cabinetId);
  const police = policeLiee(s.id, res.locals.cabinetId);
  let policesDispo = [];
  let assureurs = [];
  if (!police && s.statut !== 'convertie_police') {
    policesDispo = bd.prepare(`
      SELECT id, numero_police FROM polices
      WHERE cabinet_id = ? AND client_id = ? AND ligne = 'auto' AND auto_soumission_id IS NULL
      ORDER BY numero_police
    `).all(res.locals.cabinetId, s.client_id);
    assureurs = bd.prepare('SELECT id, nom FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom')
      .all(res.locals.cabinetId);
  }
  res.render('auto/fiche', { sectionDemandes: demandesInfos.sectionPourFiche('auto', s, req.utilisateur.cabinet_id), 
    s,
    clientNom: client ? client.raison_sociale : '—',
    versions,
    policeLiee: police || null,
    policesDispo,
    assureurs,
    NOMS_STATUTS_SOUMISSION, RC_MONTANTS, NOMS_RC, PROTECTIONS_B, NOMS_PROTECTION_B, AVENANTS_FAQ,
  });
});

// --- Proposition pré-remplie : HTML imprimable + PDF -------------------------------------------
// ?v=N : génère à partir d'une version figée (règle d'or : traçabilité).
function donneesProposition(req, res) {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return null;
  const vParam = req.query.v ? Number(req.query.v) : null;
  const p = proposition.preparerProposition(res.locals.cabinetId, s, vParam);
  if (!p) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (p.erreur === 'version') { pageErreur(res, 404, 'Introuvable', 'Version introuvable.'); return null; }
  return { p, vParam };
}

router.get('/:id/proposition', (req, res) => {
  const r = donneesProposition(req, res);
  if (!r) return;
  journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_generee',
    `Proposition auto #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, HTML) générée`);
  res.render('auto/proposition', { p: r.p, vParam: r.vParam });
});

router.get('/:id/proposition.pdf', (req, res) => {
  const r = donneesProposition(req, res);
  if (!r) return;
  genererPropositionPdf(r.p).then((pdf) => {
    journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_generee',
      `Proposition auto #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, PDF) générée`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="proposition-auto-${r.p.soumissionId}-v${r.p.versionNumero}.pdf"`);
    res.send(pdf);
  }).catch(() => pageErreur(res, 500, 'Erreur', 'Génération du PDF impossible.'));
});

// --- Ajouter un conducteur -----------------------------------------------------------------
router.post('/:id/conducteur', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    fpq1.ajouterConducteur(s.id, res.locals.cabinetId, req.utilisateur.id, {
      nom: (req.body.nom || '').trim(),
      prenom: (req.body.prenom || '').trim(),
      date_naissance: (req.body.date_naissance || '').trim() || null,
      sexe: (req.body.sexe || '').trim() || null,
      etat_civil: (req.body.etat_civil || '').trim() || null,
      numero_permis: (req.body.numero_permis || '').trim() || null,
      province_permis: (req.body.province_permis || '').trim() || 'QC',
      date_obtention_permis: (req.body.date_obtention_permis || '').trim() || null,
      annees_experience_ca: req.body.annees_experience_ca ? Number(req.body.annees_experience_ca) : null,
      annees_experience_ailleurs: req.body.annees_experience_ailleurs ? Number(req.body.annees_experience_ailleurs) : null,
      lien_assure: (req.body.lien_assure || '').trim() || null,
      telephone: (req.body.telephone || '').trim() || null,
      courriel: (req.body.courriel || '').trim() || null,
      profession: (req.body.profession || '').trim() || null,
      employeur: (req.body.employeur || '').trim() || null,
      conducteur_principal: req.body.conducteur_principal === 'on',
      vehicules_conduits: asArray(req.body.vehicules_conduits).map(Number).filter(Boolean),
      infractions: parseLignesJson(req.body.infractions_json, ['date', 'type', 'points']),
      suspensions: parseLignesTexte(req.body.suspensions),
    });
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — conducteur ajouté (soumission auto #${s.id})`);
  res.redirect('/auto/' + s.id + '#conducteurs');
});

// --- Archiver / désarchiver un conducteur ----------------------------------------------------
function conducteurDuCabinet(req, res) {
  const c = bd.prepare(`
    SELECT ac.* FROM auto_conducteurs ac
    WHERE ac.id = ? AND ac.cabinet_id = ?
  `).get(Number(req.params.cid), res.locals.cabinetId);
  if (!c) { pageErreur(res, 404, 'Introuvable', 'Conducteur introuvable.'); return null; }
  const s = fpq1.obtenirSoumission(c.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { conducteur: c, soumission: s };
}

router.post('/conducteur/:cid/archiver', (req, res) => {
  const ctx = conducteurDuCabinet(req, res);
  if (!ctx) return;
  fpq1.archiverConducteur(ctx.conducteur.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — conducteur archivé (soumission auto #${ctx.soumission.id})`);
  res.redirect('/auto/' + ctx.soumission.id + '#conducteurs');
});

router.post('/conducteur/:cid/desarchiver', (req, res) => {
  const ctx = conducteurDuCabinet(req, res);
  if (!ctx) return;
  fpq1.desarchiverConducteur(ctx.conducteur.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — conducteur désarchivé (soumission auto #${ctx.soumission.id})`);
  res.redirect('/auto/' + ctx.soumission.id + '#conducteurs');
});

// --- Ajouter un véhicule ---------------------------------------------------------------------
router.post('/:id/vehicule', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    fpq1.ajouterVehicule(s.id, res.locals.cabinetId, req.utilisateur.id, {
      annee: req.body.annee ? Number(req.body.annee) : null,
      marque: (req.body.marque || '').trim() || null,
      modele: (req.body.modele || '').trim() || null,
      version_finition: (req.body.version_finition || '').trim() || null,
      vin: (req.body.vin || '').trim() || null,
      carrosserie: (req.body.carrosserie || '').trim() || null,
      neuf_occasion: (req.body.neuf_occasion || '').trim() || null,
      date_achat: (req.body.date_achat || '').trim() || null,
      prix_achat: req.body.prix_achat ? Number(req.body.prix_achat) : null,
      valeur_estimee: req.body.valeur_estimee ? Number(req.body.valeur_estimee) : null,
      financement: (req.body.financement || '').trim() || null,
      creancier_nom: (req.body.creancier_nom || '').trim() || null,
      creancier_courriel: (req.body.creancier_courriel || '').trim() || null,
      usage: (req.body.usage || '').trim() || null,
      km_annuel: req.body.km_annuel ? Number(req.body.km_annuel) : null,
      pct_hors_quebec: req.body.pct_hors_quebec ? Number(req.body.pct_hors_quebec) : null,
      stationnement: (req.body.stationnement || '').trim() || null,
      remisage_hiver: req.body.remisage_hiver === 'on',
      modifications: parseLignesTexte(req.body.modifications),
      antivol_tag: req.body.antivol_tag === 'on',
      pneus_hiver: req.body.pneus_hiver === 'on',
      conducteur_principal_id: req.body.conducteur_principal_id ? Number(req.body.conducteur_principal_id) : null,
      remorque: req.body.remorque === 'on',
      remorque_details: parseLignesTexte(req.body.remorque_details),
    });
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — véhicule ajouté (soumission auto #${s.id})`);
  res.redirect('/auto/' + s.id + '#vehicules');
});

// --- Archiver / désarchiver un véhicule --------------------------------------------------------
function vehiculeDuCabinet(req, res) {
  const v = bd.prepare(`
    SELECT av.* FROM auto_vehicules av
    WHERE av.id = ? AND av.cabinet_id = ?
  `).get(Number(req.params.vid), res.locals.cabinetId);
  if (!v) { pageErreur(res, 404, 'Introuvable', 'Véhicule introuvable.'); return null; }
  const s = fpq1.obtenirSoumission(v.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { vehicule: v, soumission: s };
}

router.post('/vehicule/:vid/archiver', (req, res) => {
  const ctx = vehiculeDuCabinet(req, res);
  if (!ctx) return;
  fpq1.archiverVehicule(ctx.vehicule.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — véhicule archivé (soumission auto #${ctx.soumission.id})`);
  res.redirect('/auto/' + ctx.soumission.id + '#vehicules');
});

router.post('/vehicule/:vid/desarchiver', (req, res) => {
  const ctx = vehiculeDuCabinet(req, res);
  if (!ctx) return;
  fpq1.desarchiverVehicule(ctx.vehicule.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — véhicule désarchivé (soumission auto #${ctx.soumission.id})`);
  res.redirect('/auto/' + ctx.soumission.id + '#vehicules');
});

// --- Garanties d'un véhicule ---------------------------------------------------------------------
router.post('/:id/vehicule/:vid/garanties', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const v = bd.prepare(`
    SELECT id FROM auto_vehicules
    WHERE id = ? AND soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(Number(req.params.vid), s.id, res.locals.cabinetId);
  if (!v) return pageErreur(res, 404, 'Introuvable', 'Véhicule introuvable.');
  const rc = Number(req.body.rc_montant);
  const protB = (req.body.protection_b || '').trim();
  if (req.body.rc_montant && !RC_MONTANTS.includes(rc)) {
    return pageErreur(res, 400, 'Valeur invalide', 'Montant de responsabilité civile invalide.');
  }
  if (protB && !PROTECTIONS_B.includes(protB)) {
    return pageErreur(res, 400, 'Valeur invalide', 'Protection B invalide.');
  }
  const avenants = {};
  for (const code of asArray(req.body.avenants)) {
    if (AVENANTS_FAQ.some(([c]) => c === code)) avenants[code] = 1;
  }
  try {
    fpq1.definirGaranties(v.id, res.locals.cabinetId, req.utilisateur.id, {
      rc_montant: req.body.rc_montant ? rc : null,
      protection_b: protB || null,
      franchise_b: req.body.franchise_b ? Number(req.body.franchise_b) : null,
      avenants,
      prime: req.body.prime ? Number(req.body.prime) : null,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — garanties modifiées, véhicule #${v.id} (soumission auto #${s.id})`);
  res.redirect('/auto/' + s.id + '#garanties');
});

// --- Antécédents -----------------------------------------------------------------------------------
router.post('/:id/antecedents', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const consentements = {};
  for (const c of ['credit', 'dossier_saaq', 'fcsa']) {
    if (req.body['consentement_' + c] === 'on') consentements[c] = 1;
  }
  try {
    fpq1.definirAntecedents(s.id, res.locals.cabinetId, req.utilisateur.id, {
      assureur_actuel: (req.body.assureur_actuel || '').trim() || null,
      numero_police_actuelle: (req.body.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: (req.body.date_expiration_actuelle || '').trim() || null,
      annees_assurance_continue: req.body.annees_assurance_continue ? Number(req.body.annees_assurance_continue) : null,
      resiliation_ant: req.body.resiliation_ant === 'on',
      resiliation_details: (req.body.resiliation_details || '').trim() || null,
      non_paiement_ant: req.body.non_paiement_ant === 'on',
      faillite: req.body.faillite === 'on',
      casier_judiciaire: req.body.casier_judiciaire === 'on',
      sinistres_6ans: parseLignesJson(req.body.sinistres_json, ['date', 'type', 'montant', 'responsabilite']),
      consentements,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — antécédents modifiés (soumission auto #${s.id})`);
  res.redirect('/auto/' + s.id + '#antecedents');
});

// --- Changer le statut -------------------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const statut = String(req.body.statut || '');
  if (!fpq1.STATUTS_SOUMISSION.includes(statut)) {
    return pageErreur(res, 400, 'Statut invalide', 'Le statut demandé est invalide.');
  }
  fpq1.changerStatutSoumission(s.id, res.locals.cabinetId, req.utilisateur.id, statut);
  res.redirect('/auto/' + s.id);
});

// --- Conversion soumission → police (gestion) ---------------------------------------------------------------
// Crée la police auto liée (produit 'auto') et fige la version FPQ1 de référence.
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
      VALUES (?, ?, 'auto', ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(cabinetId, s.client_id, assureur.nom, assureur.id, numero, dateEffet, dateEcheance,
      franchise, `Convertie de la soumission auto #${s.id}`, responsableId);
    const policeId = r.lastInsertRowid;
    const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM auto_soumission_versions WHERE soumission_id = ?')
      .get(s.id).m;
    bd.prepare('UPDATE polices SET auto_soumission_id = ?, auto_soumission_version = ? WHERE id = ?')
      .run(s.id, versionFige, policeId);
    fpq1.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
    creerVersionPolice(policeId, req.utilisateur.id); // v1
    journal(cabinetId, req.utilisateur.id, 'police_creee',
      `Police ${numero} (id ${policeId}) convertie de la soumission auto #${s.id}`);
    res.redirect('/echeances/police/' + policeId);
  } catch (e) {
    const msg = String(e.message || '').includes('UNIQUE')
      ? 'Ce numéro de police existe déjà dans votre cabinet.' : 'Erreur d’enregistrement.';
    return pageErreur(res, 400, 'Conversion impossible', msg);
  }
});

// Lier une police auto existante (même entreprise, non liée) à la soumission.
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
  if (p.ligne !== 'auto') return pageErreur(res, 400, 'Police invalide', 'Seule une police automobile (FPQ1) peut être liée.');
  if (p.auto_soumission_id) return pageErreur(res, 400, 'Police invalide', 'Cette police est déjà liée à une soumission.');
  if (p.client_id !== s.client_id) return pageErreur(res, 400, 'Police invalide', 'La police doit appartenir à la même entreprise que la soumission.');
  if (estCourtier(req) && clientHorsPortefeuille(cabinetId, req.utilisateur, p.client_id)) return reponseHorsPortefeuille(res);
  const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM auto_soumission_versions WHERE soumission_id = ?')
    .get(s.id).m;
  bd.prepare('UPDATE polices SET auto_soumission_id = ?, auto_soumission_version = ? WHERE id = ? AND cabinet_id = ?')
    .run(s.id, versionFige, p.id, cabinetId);
  fpq1.changerStatutSoumission(s.id, cabinetId, req.utilisateur.id, 'convertie_police');
  creerVersionPolice(p.id, req.utilisateur.id, `Liée à la soumission auto #${s.id}`);
  journal(cabinetId, req.utilisateur.id, 'police_liee_soumission',
    `Police id ${p.id} liée à la soumission auto #${s.id}`);
  res.redirect('/echeances/police/' + p.id);
});

// --- Archiver / désarchiver la soumission ---------------------------------------------------------------
router.post('/:id/archiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  fpq1.archiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/auto');
});

router.post('/:id/desarchiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  fpq1.desarchiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/auto/' + s.id);
});

// --- Version en lecture seule ------------------------------------------------------------------------------
router.get('/:id/versions/:v', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const version = fpq1.obtenirVersion(s.id, Number(req.params.v), res.locals.cabinetId);
  if (!version) return pageErreur(res, 404, 'Introuvable', 'Version introuvable.');
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  res.render('auto/version', {
    s,
    version,
    clientNom: client ? client.raison_sociale : '—',
    NOMS_STATUTS_SOUMISSION, NOMS_RC, NOMS_PROTECTION_B, AVENANTS_FAQ,
  });
});

module.exports = router;
module.exports.NOMS_STATUTS_SOUMISSION = NOMS_STATUTS_SOUMISSION;
module.exports.NOMS_RC = NOMS_RC;
module.exports.RC_MONTANTS = RC_MONTANTS;
module.exports.NOMS_PROTECTION_B = NOMS_PROTECTION_B;
module.exports.PROTECTIONS_B = PROTECTIONS_B;
module.exports.AVENANTS_FAQ = AVENANTS_FAQ;
