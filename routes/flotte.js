/**
 * routes/flotte.js — Questionnaire de soumission « Flotte automobile »
 * (étape 2/10 flotte).
 * Soumissions flotte : véhicules et conducteurs en nombre illimité,
 * garanties par soumission (limite de responsabilité civile, franchises
 * collision/versement, avenants FAQ québécois), antécédents (sinistres
 * flotte des 5 dernières années), historique de versions.
 * Toute la logique métier passe par lib/flotte.js (versionnage automatique,
 * journal d'audit, filtre cabinet_id). Règle d'or : archivage, jamais de DELETE.
 * Miroir de routes/pe.js. Étape 3/10 : conversion en police (ligne 'flotte',
 * polices.flotte_soumission_id + version figée), avenants en cours de terme.
 */
const express = require('express');
const demandesInfos = require('../lib/demandes-infos');
const marche = require('../lib/marche');

const bd = require('../lib/bd');
const flotte = require('../lib/flotte');
const propositionFlotte = require('../lib/proposition-flotte');
const { genererPropositionFlottePdf } = require('../lib/proposition-flotte-pdf');
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
const NOMS_USAGES_DOMINANTS = {
  livraison: 'Livraison',
  service: 'Service',
  transport_marchandises: 'Transport de marchandises',
  personnel: 'Personnel',
  mixte: 'Mixte',
};
const NOMS_TYPES_VEHICULE = {
  camion: 'Camion',
  automobile: 'Automobile',
  remorque: 'Remorque',
  equipement: 'Équipement',
};
const NOMS_USAGES_VEHICULE = {
  livraison: 'Livraison',
  service: 'Service',
  transport_marchandises: 'Transport de marchandises',
  personnel: 'Personnel',
};
// Avenants FAQ québécois (clés courtes de lib/flotte.js — mêmes clés que FPQ1).
const AVENANTS_FAQ = [
  ['faq43', 'FAQ 43 — Valeur à neuf'],
  ['faq20', 'FAQ 20 — Privation de jouissance'],
  ['faq27', 'FAQ 27 — Véhicule loué ou n’appartenant pas à l’assuré'],
  ['faq34', 'FAQ 34 — Indemnités d’accident'],
  ['faq5a', 'FAQ 5a — Crédit-bail'],
];
// Consentements antécédents (clés JSON de flotte_antecedents.consentements).
const CONSENTEMENTS_FLOTTE = [
  ['credit', 'Dossier de crédit'],
  ['dossier_saaq', 'Dossier SAAQ (dossier de conduite)'],
  ['fcsa', 'FCSA (sinistres automobiles)'],
];

// --- Utilitaires ------------------------------------------------------------
function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

// Police liée à une soumission (1 soumission → 1 police).
function policeLiee(soumissionId, cabinetId) {
  return bd.prepare('SELECT * FROM polices WHERE flotte_soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
}

// Avenant en cours de terme : toute modification de l'en-tête / des véhicules /
// des conducteurs / des garanties / des antécédents / du statut d'une soumission
// convertie crée une version de la police avec note (règle d'or : jamais de
// modification silencieuse). Miroir de routes/pe.js.
function noterAvenantPolice(soumissionId, cabinetId, userId, note) {
  const p = policeLiee(soumissionId, cabinetId);
  if (p) creerVersionPolice(p.id, userId, note);
}

// Soumission du cabinet + contrôle du portefeuille courtier.
function soumissionAutorisee(req, res, inclureArchives) {
  const s = flotte.obtenirSoumission(Number(req.params.id), res.locals.cabinetId,
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
  if (!clientId) erreurs.push('L’entreprise cliente est requise.');
  else {
    const c = bd.prepare('SELECT id FROM clients WHERE id = ? AND cabinet_id = ? AND archive = 0')
      .get(clientId, cabinetId);
    if (!c) erreurs.push('Entreprise invalide.');
    else if (clientHorsPortefeuille(cabinetId, req.utilisateur, c.id)) {
      erreurs.push('Cette entreprise n’est pas dans votre portefeuille.');
    }
  }
  const usage = lireTexte(req.body.usage_dominant);
  if (usage && !flotte.USAGES_DOMINANTS.includes(usage)) erreurs.push('Usage dominant invalide.');
  for (const champ of ['date_effet_souhaitee', 'date_echeance_visee']) {
    const v = (req.body[champ] || '').trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) erreurs.push('Date invalide (AAAA-MM-JJ).');
  }
  let nbVehicules = null;
  let rayon = null;
  try { nbVehicules = lireEntierPositif(req.body.nb_vehicules); } catch { erreurs.push('Nombre de véhicules invalide.'); }
  try { rayon = lireEntierPositif(req.body.rayon_operation_km); } catch { erreurs.push('Rayon d’opération invalide.'); }
  return {
    client_id: clientId || null,
    assureur: lireTexte(req.body.assureur),
    numero_police: lireTexte(req.body.numero_police),
    nb_vehicules: nbVehicules,
    rayon_operation_km: rayon,
    usage_dominant: usage,
    date_effet_souhaitee: lireTexte(req.body.date_effet_souhaitee),
    date_echeance_visee: lireTexte(req.body.date_echeance_visee),
    notes: lireTexte(req.body.notes),
  };
}
// --- Véhicules ------------------------------------------------------------------
// Équipements spéciaux : un par ligne, format « description | valeur $ ».
function parserEquipements(texte) {
  if (!texte) return [];
  return String(texte).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const cols = l.split('|').map((x) => (x || '').trim());
    const valeur = cols[1] === undefined || cols[1] === '' ? null : Number(cols[1]);
    return { description: cols[0] || '', valeur: valeur !== null && isNaN(valeur) ? null : valeur };
  }).filter((o) => o.description);
}
function serialiserEquipements(liste) {
  if (!Array.isArray(liste)) return '';
  return liste.map((x) => [x.description || '', x.valeur === null || x.valeur === undefined ? '' : x.valeur].join(' | ')).join('\n');
}

function lireVehiculeForm(body) {
  const type = lireTexte(body.type_vehicule);
  if (type && !flotte.TYPES_VEHICULE.includes(type)) throw new Error('Type de véhicule invalide.');
  const usage = lireTexte(body.usage);
  if (usage && !flotte.USAGES_VEHICULE.includes(usage)) throw new Error('Usage du véhicule invalide.');
  const condId = body.conducteur_principal_id ? Number(body.conducteur_principal_id) : null;
  return {
    niv: lireTexte(body.niv),
    annee: lireEntierPositif(body.annee),
    marque: lireTexte(body.marque),
    modele: lireTexte(body.modele),
    type_vehicule: type,
    usage,
    rayon_operation_km: lireEntierPositif(body.rayon_operation_km),
    lieu_remisage: lireTexte(body.lieu_remisage),
    valeur: lireNombrePositif(body.valeur),
    annee_acquisition: lireEntierPositif(body.annee_acquisition),
    conducteur_principal_id: condId && !isNaN(condId) ? condId : null,
    conducteur_principal_nom: lireTexte(body.conducteur_principal_nom),
    equipements_speciaux: parserEquipements(body.equipements_speciaux),
  };
}

// --- Conducteurs ------------------------------------------------------------------
// Sinistres 5 ans : un par ligne, « AAAA-MM-JJ | description | montant | responsabilité ».
// Infractions 3 ans : un par ligne, « AAAA-MM-JJ | type | description | points ».
// Formations : une par ligne, « formation | AAAA-MM-JJ | organisme ».
function parserSinistresConducteur(texte) {
  if (!texte) return [];
  return String(texte).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const cols = l.split('|').map((x) => (x || '').trim());
    const montant = cols[2] === undefined || cols[2] === '' ? null : Number(cols[2]);
    return {
      date: cols[0] || '',
      description: cols[1] || '',
      montant: montant !== null && isNaN(montant) ? null : montant,
      responsabilite: cols[3] || '',
    };
  }).filter((o) => o.date || o.description);
}
function serialiserSinistresConducteur(liste) {
  if (!Array.isArray(liste)) return '';
  return liste.map((x) => [x.date || '', x.description || '',
    x.montant === null || x.montant === undefined ? '' : x.montant, x.responsabilite || ''].join(' | ')).join('\n');
}
function parserInfractions(texte) {
  if (!texte) return [];
  return String(texte).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const cols = l.split('|').map((x) => (x || '').trim());
    const points = cols[3] === undefined || cols[3] === '' ? null : Number(cols[3]);
    return {
      date: cols[0] || '',
      type: cols[1] || '',
      description: cols[2] || '',
      points: points !== null && isNaN(points) ? null : points,
    };
  }).filter((o) => o.date || o.type || o.description);
}
function serialiserInfractions(liste) {
  if (!Array.isArray(liste)) return '';
  return liste.map((x) => [x.date || '', x.type || '', x.description || '',
    x.points === null || x.points === undefined ? '' : x.points].join(' | ')).join('\n');
}
function parserFormations(texte) {
  if (!texte) return [];
  return String(texte).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const cols = l.split('|').map((x) => (x || '').trim());
    return { formation: cols[0] || '', date: cols[1] || '', organisme: cols[2] || '' };
  }).filter((o) => o.formation);
}
function serialiserFormations(liste) {
  if (!Array.isArray(liste)) return '';
  return liste.map((x) => [x.formation || '', x.date || '', x.organisme || ''].join(' | ')).join('\n');
}

function lireConducteurForm(body) {
  return {
    nom: lireTexte(body.nom),
    prenom: lireTexte(body.prenom),
    date_naissance: lireDate(body.date_naissance, 'Date de naissance'),
    age: lireEntierPositif(body.age),
    numero_permis: lireTexte(body.numero_permis),
    classe_permis: lireTexte(body.classe_permis),
    annees_experience: lireEntierPositif(body.annees_experience),
    annees_experience_lourds: lireEntierPositif(body.annees_experience_lourds),
    date_embauche: lireDate(body.date_embauche, 'Date d’embauche'),
    sinistres_5ans: parserSinistresConducteur(body.sinistres_5ans),
    infractions_3ans: parserInfractions(body.infractions_3ans),
    formations: parserFormations(body.formations),
  };
}

// --- Antécédents : sinistres flotte 5 ans, un par ligne « AAAA-MM-JJ | description | montant » ---
function parserSinistresFlotte(texte) {
  if (!texte) return [];
  return String(texte).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const cols = l.split('|').map((x) => (x || '').trim());
    const montant = cols[2] === undefined || cols[2] === '' ? null : Number(cols[2]);
    return {
      date: cols[0] || '',
      description: cols[1] || '',
      montant: montant !== null && isNaN(montant) ? null : montant,
    };
  }).filter((o) => o.date || o.description);
}
function serialiserSinistresFlotte(liste) {
  if (!Array.isArray(liste)) return '';
  return liste.map((x) => [x.date || '', x.description || '',
    x.montant === null || x.montant === undefined ? '' : x.montant].join(' | ')).join('\n');
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
  const statut = flotte.STATUTS_SOUMISSION.includes(req.query.statut) ? req.query.statut : '';
  let sql = `
    SELECT s.*, c.raison_sociale AS client_nom,
      (SELECT COUNT(*) FROM flotte_vehicules WHERE soumission_id = s.id AND archive = 0) AS nb_vehicules_reels,
      (SELECT COUNT(*) FROM flotte_conducteurs WHERE soumission_id = s.id AND archive = 0) AS nb_conducteurs,
      (SELECT limite_rc FROM flotte_garanties WHERE soumission_id = s.id AND archive = 0) AS limite_rc
    FROM flotte_soumissions s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.cabinet_id = ? AND s.archive = ${voirArchives ? '1' : '0'}`;
  const params = [cabinetId];
  if (statut) { sql += ' AND s.statut = ?'; params.push(statut); }
  if (estCourtier(req)) sql += ` AND c.responsable_id = ${Number(req.utilisateur.id)}`;
  sql += ' ORDER BY s.id DESC';
  const soumissions = bd.prepare(sql).all(...params);
  res.render('flotte/liste', {
    soumissions, voirArchives, statut,
    NOMS_STATUTS_SOUMISSION, NOMS_USAGES_DOMINANTS,
  });
});

// --- Nouvelle soumission --------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  const entreprises = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  res.render('flotte/formulaire', {
    erreur: null, valeurs: {}, entreprises,
    NOMS_USAGES_DOMINANTS,
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
    return res.status(400).render('flotte/formulaire', {
      erreur: erreurs.join(' '), valeurs: req.body, entreprises,
      NOMS_USAGES_DOMINANTS,
    });
  }
  let id;
  try {
    id = flotte.creerSoumission({
      cabinetId,
      userId: req.utilisateur.id,
      clientId: entete.client_id,
      assureur: entete.assureur,
      numeroPolice: entete.numero_police,
      responsableId: req.utilisateur.id,
      nbVehicules: entete.nb_vehicules,
      rayonOperationKm: entete.rayon_operation_km,
      usageDominant: entete.usage_dominant,
      dateEffetSouhaitee: entete.date_effet_souhaitee,
      dateEcheanceVisee: entete.date_echeance_visee,
      notes: entete.notes,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Création impossible', e.message);
  }
  res.redirect('/flotte/' + id);
});

// --- Fiche ----------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  const versions = flotte.versionsSoumission(s.id, res.locals.cabinetId);
  const police = policeLiee(s.id, res.locals.cabinetId);
  let policesDispo = [];
  let assureurs = [];
  if (!police && s.statut !== 'convertie_police') {
    policesDispo = bd.prepare(`
      SELECT id, numero_police FROM polices
      WHERE cabinet_id = ? AND client_id = ? AND ligne = 'flotte' AND flotte_soumission_id IS NULL
      ORDER BY numero_police
    `).all(res.locals.cabinetId, s.client_id);
    assureurs = bd.prepare('SELECT id, nom FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom')
      .all(res.locals.cabinetId);
  }
  const entreprises = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  const conducteursParId = {};
  for (const c of s.conducteurs) conducteursParId[c.id] = `${c.prenom} ${c.nom}`;
  res.render('flotte/fiche', { sectionDemandes: demandesInfos.sectionPourFiche('flotte', s, req.utilisateur.cabinet_id),
    sectionMarche: marche.sectionPourCible(req.utilisateur.cabinet_id, { produit: 'flotte', soumissionId: s.id }), NOMS_STATUTS_ENVOI: marche.NOMS_STATUTS_ENVOI, 
    s,
    clientNom: client ? client.raison_sociale : '—',
    versions,
    policeLiee: police || null,
    policesDispo,
    assureurs,
    entreprises,
    conducteursParId,
    NOMS_STATUTS_SOUMISSION, NOMS_USAGES_DOMINANTS,
    NOMS_TYPES_VEHICULE, NOMS_USAGES_VEHICULE,
    AVENANTS_FAQ, CONSENTEMENTS_FLOTTE,
    equipementsTexteParVehicule: Object.fromEntries(
      s.vehicules.map((v) => [v.id, serialiserEquipements(v.equipements_speciaux)])),
    sinistresTexteParConducteur: Object.fromEntries(
      s.conducteurs.map((c) => [c.id, serialiserSinistresConducteur(c.sinistres_5ans)])),
    infractionsTexteParConducteur: Object.fromEntries(
      s.conducteurs.map((c) => [c.id, serialiserInfractions(c.infractions_3ans)])),
    formationsTexteParConducteur: Object.fromEntries(
      s.conducteurs.map((c) => [c.id, serialiserFormations(c.formations)])),
    sinistresFlotteTexte: serialiserSinistresFlotte(s.antecedents ? s.antecedents.sinistres_flotte_5ans : null),
    consentementActif,
  });
});

// --- Modifier l'en-tête ---------------------------------------------------------------------
router.post('/:id/entete', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const erreurs = [];
  const entete = lireEnteteForm(req, res.locals.cabinetId, erreurs);
  if (erreurs.length) return pageErreur(res, 400, 'Modification impossible', erreurs.join(' '));
  try {
    flotte.modifierSoumission(s.id, res.locals.cabinetId, req.utilisateur.id, entete);
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — en-tête modifié (soumission flotte #${s.id})`);
  res.redirect('/flotte/' + s.id);
});

// --- Ajouter un véhicule ---------------------------------------------------------------------
router.post('/:id/vehicule', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    flotte.ajouterVehicule(s.id, res.locals.cabinetId, req.utilisateur.id, lireVehiculeForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — véhicule ajouté (soumission flotte #${s.id})`);
  res.redirect('/flotte/' + s.id + '#vehicules');
});

// --- Modifier / archiver / désarchiver un véhicule ------------------------------------------
function vehiculeDuCabinet(req, res) {
  const v = bd.prepare('SELECT * FROM flotte_vehicules WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.params.vid), res.locals.cabinetId);
  if (!v) { pageErreur(res, 404, 'Introuvable', 'Véhicule introuvable.'); return null; }
  const s = flotte.obtenirSoumission(v.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { vehicule: v, soumission: s };
}

router.post('/vehicule/:vid', (req, res) => {
  const ctx = vehiculeDuCabinet(req, res);
  if (!ctx) return;
  try {
    flotte.modifierVehicule(ctx.vehicule.id, res.locals.cabinetId, req.utilisateur.id, lireVehiculeForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — véhicule modifié (soumission flotte #${ctx.soumission.id})`);
  res.redirect('/flotte/' + ctx.soumission.id + '#vehicules');
});

router.post('/vehicule/:vid/archiver', (req, res) => {
  const ctx = vehiculeDuCabinet(req, res);
  if (!ctx) return;
  flotte.archiverVehicule(ctx.vehicule.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — véhicule archivé (soumission flotte #${ctx.soumission.id})`);
  res.redirect('/flotte/' + ctx.soumission.id + '#vehicules');
});

router.post('/vehicule/:vid/desarchiver', (req, res) => {
  const ctx = vehiculeDuCabinet(req, res);
  if (!ctx) return;
  flotte.desarchiverVehicule(ctx.vehicule.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — véhicule désarchivé (soumission flotte #${ctx.soumission.id})`);
  res.redirect('/flotte/' + ctx.soumission.id + '#vehicules');
});

// --- Ajouter un conducteur ---------------------------------------------------------------------
router.post('/:id/conducteur', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  try {
    flotte.ajouterConducteur(s.id, res.locals.cabinetId, req.utilisateur.id, lireConducteurForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Ajout impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — conducteur ajouté (soumission flotte #${s.id})`);
  res.redirect('/flotte/' + s.id + '#conducteurs');
});

// --- Modifier / archiver / désarchiver un conducteur ------------------------------------------
function conducteurDuCabinet(req, res) {
  const c = bd.prepare('SELECT * FROM flotte_conducteurs WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.params.cid), res.locals.cabinetId);
  if (!c) { pageErreur(res, 404, 'Introuvable', 'Conducteur introuvable.'); return null; }
  const s = flotte.obtenirSoumission(c.soumission_id, res.locals.cabinetId);
  if (!s) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, s.client_id)) {
    reponseHorsPortefeuille(res); return null;
  }
  return { conducteur: c, soumission: s };
}

router.post('/conducteur/:cid', (req, res) => {
  const ctx = conducteurDuCabinet(req, res);
  if (!ctx) return;
  try {
    flotte.modifierConducteur(ctx.conducteur.id, res.locals.cabinetId, req.utilisateur.id, lireConducteurForm(req.body));
  } catch (e) {
    return pageErreur(res, 400, 'Modification impossible', e.message);
  }
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — conducteur modifié (soumission flotte #${ctx.soumission.id})`);
  res.redirect('/flotte/' + ctx.soumission.id + '#conducteurs');
});

router.post('/conducteur/:cid/archiver', (req, res) => {
  const ctx = conducteurDuCabinet(req, res);
  if (!ctx) return;
  flotte.archiverConducteur(ctx.conducteur.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — conducteur archivé (soumission flotte #${ctx.soumission.id})`);
  res.redirect('/flotte/' + ctx.soumission.id + '#conducteurs');
});

router.post('/conducteur/:cid/desarchiver', (req, res) => {
  const ctx = conducteurDuCabinet(req, res);
  if (!ctx) return;
  flotte.desarchiverConducteur(ctx.conducteur.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(ctx.soumission.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — conducteur désarchivé (soumission flotte #${ctx.soumission.id})`);
  res.redirect('/flotte/' + ctx.soumission.id + '#conducteurs');
});

// --- Garanties de la soumission ---------------------------------------------------------------
router.post('/:id/garanties', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const avenants = {};
  const recus = Array.isArray(req.body.avenants) ? req.body.avenants : (req.body.avenants ? [req.body.avenants] : []);
  for (const code of recus) {
    if (AVENANTS_FAQ.some(([c]) => c === code)) avenants[code] = 1;
  }
  try {
    flotte.definirGaranties(s.id, res.locals.cabinetId, req.utilisateur.id, {
      limite_rc: lireNombrePositif(req.body.limite_rc),
      franchise_collision: lireNombrePositif(req.body.franchise_collision),
      franchise_versement: lireNombrePositif(req.body.franchise_versement),
      avenants,
      prime: lireNombrePositif(req.body.prime),
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — garanties modifiées (soumission flotte #${s.id})`);
  res.redirect('/flotte/' + s.id + '#garanties');
});

// --- Antécédents --------------------------------------------------------------------------------
router.post('/:id/antecedents', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const consentements = {};
  for (const [code] of CONSENTEMENTS_FLOTTE) {
    if (req.body['consentement_' + code] === 'on') consentements[code] = 1;
  }
  try {
    flotte.definirAntecedents(s.id, res.locals.cabinetId, req.utilisateur.id, {
      assureur_actuel: lireTexte(req.body.assureur_actuel),
      numero_police_actuelle: lireTexte(req.body.numero_police_actuelle),
      date_expiration_actuelle: lireDate(req.body.date_expiration_actuelle, 'Date d’expiration'),
      annees_assurance_flotte_continue: lireEntierPositif(req.body.annees_assurance_flotte_continue),
      sinistres_flotte_5ans: parserSinistresFlotte(req.body.sinistres_flotte_5ans),
      ratio_pertes: lireNombrePositif(req.body.ratio_pertes),
      refus_annulation_ant: req.body.refus_annulation_ant === 'on' ? 1 : 0,
      refus_annulation_details: lireTexte(req.body.refus_annulation_details),
      consentements,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Enregistrement impossible', e.message);
  }
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — antécédents modifiés (soumission flotte #${s.id})`);
  res.redirect('/flotte/' + s.id + '#antecedents');
});

// --- Changer le statut ---------------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const s = soumissionAutorisee(req, res, false);
  if (!s) return;
  const statut = String(req.body.statut || '');
  if (!flotte.STATUTS_SOUMISSION.includes(statut)) {
    return pageErreur(res, 400, 'Statut invalide', 'Le statut demandé est invalide.');
  }
  flotte.changerStatutSoumission(s.id, res.locals.cabinetId, req.utilisateur.id, statut);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — statut modifié (soumission flotte #${s.id})`);
  res.redirect('/flotte/' + s.id);
});

// --- Archiver / désarchiver la soumission ------------------------------------------------------------
router.post('/:id/archiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  flotte.archiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  noterAvenantPolice(s.id, res.locals.cabinetId, req.utilisateur.id, `Avenant — soumission archivée (soumission flotte #${s.id})`);
  res.redirect('/flotte');
});

router.post('/:id/desarchiver', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  flotte.desarchiverSoumission(s.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/flotte/' + s.id);
});

// --- Convertir en police ----------------------------------------------------------------------------
// Miroir de POST /pe/:id/convertir.
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
      VALUES (?, ?, 'flotte', ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(cabinetId, s.client_id, assureur.nom, assureur.id, numero, dateEffet, dateEcheance,
      franchise, `Convertie de la soumission flotte #${s.id}`, responsableId);
    const policeId = r.lastInsertRowid;
    const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM flotte_soumission_versions WHERE soumission_id = ?')
      .get(s.id).m;
    bd.prepare('UPDATE polices SET flotte_soumission_id = ?, flotte_soumission_version = ? WHERE id = ?')
      .run(s.id, versionFige, policeId);
    flotte.noterConversion(s.id, cabinetId, req.utilisateur.id, policeId);
    creerVersionPolice(policeId, req.utilisateur.id); // v1
    journal(cabinetId, req.utilisateur.id, 'police_creee',
      `Police ${numero} (id ${policeId}) convertie de la soumission flotte #${s.id}`);
    res.redirect('/echeances/police/' + policeId);
  } catch (e) {
    const msg = String(e.message || '').includes('UNIQUE')
      ? 'Ce numéro de police existe déjà dans votre cabinet.' : 'Erreur d’enregistrement.';
    return pageErreur(res, 400, 'Conversion impossible', msg);
  }
});

// Lier une police flotte existante (même entreprise, non liée) à la soumission.
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
  if (p.ligne !== 'flotte') return pageErreur(res, 400, 'Police invalide', 'Seule une police flotte peut être liée.');
  if (p.flotte_soumission_id) return pageErreur(res, 400, 'Police invalide', 'Cette police est déjà liée à une soumission.');
  if (p.client_id !== s.client_id) return pageErreur(res, 400, 'Police invalide', 'La police doit appartenir à la même entreprise que la soumission.');
  if (estCourtier(req) && clientHorsPortefeuille(cabinetId, req.utilisateur, p.client_id)) return reponseHorsPortefeuille(res);
  const versionFige = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM flotte_soumission_versions WHERE soumission_id = ?')
    .get(s.id).m;
  bd.prepare('UPDATE polices SET flotte_soumission_id = ?, flotte_soumission_version = ? WHERE id = ? AND cabinet_id = ?')
    .run(s.id, versionFige, p.id, cabinetId);
  flotte.noterConversion(s.id, cabinetId, req.utilisateur.id, p.id);
  creerVersionPolice(p.id, req.utilisateur.id, `Liée à la soumission flotte #${s.id}`);
  journal(cabinetId, req.utilisateur.id, 'police_liee_soumission',
    `Police id ${p.id} liée à la soumission flotte #${s.id}`);
  res.redirect('/echeances/police/' + p.id);
});

// --- Version en lecture seule -------------------------------------------------------------------------
router.get('/:id/versions/:v', (req, res) => {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return;
  const version = flotte.obtenirVersion(s.id, Number(req.params.v), res.locals.cabinetId);
  if (!version) return pageErreur(res, 404, 'Introuvable', 'Version introuvable.');
  const client = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?').get(s.client_id, res.locals.cabinetId)
    : null;
  res.render('flotte/version', {
    s,
    version,
    clientNom: client ? client.raison_sociale : '—',
    NOMS_STATUTS_SOUMISSION, NOMS_USAGES_DOMINANTS,
    NOMS_TYPES_VEHICULE, NOMS_USAGES_VEHICULE,
    AVENANTS_FAQ, CONSENTEMENTS_FLOTTE,
    consentementActif,
  });
});

// --- Proposition pré-remplie : HTML imprimable + PDF -------------------------------------
// ?v=N : génère à partir d'une version figée (règle d'or : traçabilité).
// Lecture seule : la proposition ne modifie JAMAIS la soumission.
// Miroir de routes/pe.js (étape 7/10 PE).
function donneesPropositionFlotte(req, res) {
  const s = soumissionAutorisee(req, res, true);
  if (!s) return null;
  const vParam = req.query.v ? Number(req.query.v) : null;
  const p = propositionFlotte.preparerPropositionFlotte(res.locals.cabinetId, s, vParam);
  if (!p) { pageErreur(res, 404, 'Introuvable', 'Soumission introuvable.'); return null; }
  if (p.erreur === 'version') { pageErreur(res, 404, 'Introuvable', 'Version introuvable.'); return null; }
  return { p, vParam };
}

router.get('/:id/proposition', (req, res) => {
  const r = donneesPropositionFlotte(req, res);
  if (!r) return;
  journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_flotte_generee',
    `Proposition flotte #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, HTML) générée`);
  res.render('flotte/proposition', { p: r.p, vParam: r.vParam });
});

router.get('/:id/proposition.pdf', (req, res) => {
  const r = donneesPropositionFlotte(req, res);
  if (!r) return;
  genererPropositionFlottePdf(r.p).then((pdf) => {
    journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_flotte_generee',
      `Proposition flotte #${r.p.soumissionId} (v${r.p.versionNumero}${r.p.versionFigee ? ', figée' : ''}, PDF) générée`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="proposition-flotte-${r.p.soumissionId}-v${r.p.versionNumero}.pdf"`);
    res.send(pdf);
  }).catch(() => pageErreur(res, 500, 'Erreur', 'Génération du PDF impossible.'));
});

module.exports = router;
module.exports.NOMS_STATUTS_SOUMISSION = NOMS_STATUTS_SOUMISSION;
module.exports.NOMS_USAGES_DOMINANTS = NOMS_USAGES_DOMINANTS;
module.exports.NOMS_TYPES_VEHICULE = NOMS_TYPES_VEHICULE;
module.exports.NOMS_USAGES_VEHICULE = NOMS_USAGES_VEHICULE;
module.exports.AVENANTS_FAQ = AVENANTS_FAQ;
module.exports.CONSENTEMENTS_FLOTTE = CONSENTEMENTS_FLOTTE;
module.exports.parserEquipements = parserEquipements;
module.exports.serialiserEquipements = serialiserEquipements;
module.exports.parserSinistresConducteur = parserSinistresConducteur;
module.exports.parserInfractions = parserInfractions;
module.exports.parserFormations = parserFormations;
module.exports.parserSinistresFlotte = parserSinistresFlotte;
module.exports.serialiserSinistresFlotte = serialiserSinistresFlotte;
