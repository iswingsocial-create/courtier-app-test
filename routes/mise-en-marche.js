/**
 * routes/mise-en-marche.js — Registre de mise en marché (F15).
 *
 * Le système sait à qui chaque soumission a été envoyée : création d'un
 * envoi depuis la fiche soumission ou le dossier combiné (« 📤 Envoyer à
 * un marché »), brouillon courriel « demande de prix » modifiable,
 * ENVOI AU CLIC SEULEMENT (mode simulé sans compte SMTP actif — patron
 * de la boucle courriel), transitions de statut guidées, questions,
 * offre reçue structurée, refus motivé, relances tracées.
 * Cloisonnement : cabinet + portefeuille du courtier (via le client).
 * Règle d'or : rien ne se supprime — un envoi s'annule par son statut.
 */
const express = require('express');
const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, clientHorsPortefeuille } = require('../lib/middleware');
const marche = require('../lib/marche');
const { NOMS_STATUTS_ENVOI, NOMS_PRODUITS } = marche;

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

function pageErreur(res, code, titre, message) {
  return res.status(code).render('erreur', { titre, message });
}

function chargerEnvoiAutorise(req, res, { complet = true } = {}) {
  const e = marche.obtenirEnvoi(Number(req.params.id), res.locals.cabinetId, { complet });
  if (!e) { pageErreur(res, 404, 'Introuvable', 'Envoi de mise en marché introuvable dans votre cabinet.'); return null; }
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, e.client_id)) {
    pageErreur(res, 403, 'Accès refusé', 'Ce dossier ne fait pas partie de votre portefeuille.');
    return null;
  }
  return e;
}

function compteEnvoiActif(cabinetId) {
  return !!bd.prepare(
    'SELECT id FROM courriel_comptes WHERE cabinet_id = ? AND actif = 1 AND archive = 0 LIMIT 1'
  ).get(cabinetId);
}

function urlCible(e) {
  if (e.produit === 'combinee' || e.combine_dossier_id) return `/combinees/${e.combine_dossier_id}`;
  const chemins = {
    auto: '/auto', biens: '/biens', rc: '/rc', cyber: '/cyber', eo: '/eo', do: '/do',
    pe: '/pe', flotte: '/flotte', cautionnement: '/cautionnement',
  };
  return `${chemins[e.produit] || '/mise-en-marche'}/${e.soumission_id}`;
}

// --- Registre ---------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const filtres = {
    statut: req.query.statut || null,
    assureurId: req.query.assureur_id ? Number(req.query.assureur_id) : null,
    clientId: req.query.client_id ? Number(req.query.client_id) : null,
    marcheNom: req.query.marche || null,
    relancesDues: req.query.relances === '1',
  };
  const envois = marche.listerEnvois(res.locals.cabinetId, filtres, req);
  const indicateurs = marche.indicateurs(res.locals.cabinetId, req);
  const assureurs = bd.prepare('SELECT id, nom FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom')
    .all(res.locals.cabinetId);
  const { clausePortefeuille } = require('../lib/middleware');
  const clients = bd.prepare(
    `SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0${clausePortefeuille(req, 'clients')} ORDER BY raison_sociale`
  ).all(res.locals.cabinetId);
  res.render('mise-en-marche/registre', {
    titre: 'Mise en marché', envois, indicateurs, filtres, assureurs, clients,
    NOMS_STATUTS_ENVOI, NOMS_PRODUITS,
  });
});

// --- Création : formulaire pré-rempli ------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  let cible;
  try {
    cible = marche.resoudreCible(res.locals.cabinetId, {
      produit: req.query.produit || null,
      soumissionId: req.query.soumission_id ? Number(req.query.soumission_id) : null,
      combineDossierId: req.query.combine_id ? Number(req.query.combine_id) : null,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Cible introuvable', e.message);
  }
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, cible.clientId)) {
    return pageErreur(res, 403, 'Accès refusé', 'Ce dossier ne fait pas partie de votre portefeuille.');
  }
  const assureurs = bd.prepare('SELECT * FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom')
    .all(res.locals.cabinetId);
  let assureurChoisi = null;
  if (req.query.assureur_id) {
    assureurChoisi = assureurs.find((a) => a.id === Number(req.query.assureur_id)) || null;
  }
  const envoisExistants = marche.listerPourCible(res.locals.cabinetId, cible);
  res.render('mise-en-marche/nouveau', {
    titre: 'Envoyer à un marché', cible, assureurs, assureurChoisi,
    versionDefaut: marche.versionCourante(cible),
    documentsDefaut: marche.documentsParDefaut(cible),
    envoisExistants, NOMS_STATUTS_ENVOI,
  });
});

router.post('/nouveau', (req, res) => {
  const b = req.body;
  let cible;
  try {
    cible = marche.resoudreCible(res.locals.cabinetId, {
      produit: b.produit || null,
      soumissionId: b.soumission_id ? Number(b.soumission_id) : null,
      combineDossierId: b.combine_dossier_id ? Number(b.combine_dossier_id) : null,
    });
  } catch (e) {
    return pageErreur(res, 400, 'Cible introuvable', e.message);
  }
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, cible.clientId)) {
    return pageErreur(res, 403, 'Accès refusé', 'Ce dossier ne fait pas partie de votre portefeuille.');
  }
  try {
    const { envoi } = marche.creerEnvoi(res.locals.cabinetId, req.utilisateur, {
      produit: cible.produit, soumissionId: cible.soumissionId, combineDossierId: cible.combineDossierId,
      assureurId: b.assureur_id ? Number(b.assureur_id) : null,
      marcheNom: b.marche_nom || null,
      souscripteurNom: b.souscripteur_nom || null,
      souscripteurCourriel: b.souscripteur_courriel || null,
      versionProposition: b.version_proposition || null,
      documents: String(b.documents || '').split('\n').map((x) => x.trim()).filter(Boolean),
      autoriteIntermediaire: b.autorite_intermediaire || null,
      dateRelance: b.date_relance || null,
      prochaineAction: b.prochaine_action || null,
      prochaineActionEcheance: b.prochaine_action_echeance || null,
    });
    return res.redirect(`/mise-en-marche/${envoi.id}?cree=1`);
  } catch (e) {
    return pageErreur(res, 400, 'Création impossible', e.message);
  }
});

// --- Fiche envoi -----------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const e = chargerEnvoiAutorise(req, res);
  if (!e) return;
  res.render('mise-en-marche/fiche', {
    titre: `Mise en marché — ${e.marche_nom}`,
    e, NOMS_STATUTS_ENVOI, NOMS_PRODUITS, NOMS_RESPONSABLES: marche.NOMS_RESPONSABLES,
    urlCible: urlCible(e),
    compteEnvoi: compteEnvoiActif(res.locals.cabinetId),
    cree: req.query.cree === '1',
    envoyeOk: req.query.envoye === '1',
    modeEnvoi: req.query.mode || null,
    relanceId: req.query.relance ? Number(req.query.relance) : null,
  });
});

// --- Modifier les champs ----------------------------------------------------------------------------
router.post('/:id/modifier', (req, res) => {
  const e = chargerEnvoiAutorise(req, res, { complet: false });
  if (!e) return;
  const b = req.body;
  try {
    marche.majEnvoi(e.id, res.locals.cabinetId, req.utilisateur, {
      marcheNom: b.marche_nom, souscripteurNom: b.souscripteur_nom,
      souscripteurCourriel: b.souscripteur_courriel, versionProposition: b.version_proposition,
      autoriteIntermediaire: b.autorite_intermediaire, dateRelance: b.date_relance,
      prochaineAction: b.prochaine_action, prochaineActionEcheance: b.prochaine_action_echeance,
      documents: String(b.documents || '').split('\n').map((x) => x.trim()).filter(Boolean),
    });
  } catch (err) { return pageErreur(res, 400, 'Modification impossible', err.message); }
  res.redirect(`/mise-en-marche/${e.id}`);
});

// --- Transmission manuelle ----------------------------------------------------------------------------
router.post('/:id/transmettre', (req, res) => {
  const e = chargerEnvoiAutorise(req, res, { complet: false });
  if (!e) return;
  try {
    marche.marquerTransmis(e.id, res.locals.cabinetId, req.utilisateur, { dateRelance: req.body.date_relance || null });
  } catch (err) { return pageErreur(res, 400, 'Transmission impossible', err.message); }
  res.redirect(`/mise-en-marche/${e.id}`);
});

// --- Transitions guidées ---------------------------------------------------------------------------------
router.post('/:id/en-analyse', (req, res) => {
  const e = chargerEnvoiAutorise(req, res, { complet: false });
  if (!e) return;
  try { marche.transitionner(e.id, res.locals.cabinetId, req.utilisateur, 'en_analyse'); }
  catch (err) { return pageErreur(res, 400, 'Transition impossible', err.message); }
  res.redirect(`/mise-en-marche/${e.id}`);
});

router.post('/:id/questions', (req, res) => {
  const e = chargerEnvoiAutorise(req, res, { complet: false });
  if (!e) return;
  try {
    marche.enregistrerQuestions(e.id, res.locals.cabinetId, req.utilisateur, {
      texteQuestions: req.body.questions_en_attente, responsable: req.body.questions_responsable,
    });
  } catch (err) { return pageErreur(res, 400, 'Questions non enregistrées', err.message); }
  res.redirect(`/mise-en-marche/${e.id}`);
});

router.post('/:id/questions-resolues', (req, res) => {
  const e = chargerEnvoiAutorise(req, res, { complet: false });
  if (!e) return;
  try { marche.questionsResolues(e.id, res.locals.cabinetId, req.utilisateur); }
  catch (err) { return pageErreur(res, 400, 'Action impossible', err.message); }
  res.redirect(`/mise-en-marche/${e.id}`);
});

router.post('/:id/offre', (req, res) => {
  const e = chargerEnvoiAutorise(req, res, { complet: false });
  if (!e) return;
  try {
    marche.saisirOffre(e.id, res.locals.cabinetId, req.utilisateur, {
      prime: req.body.offre_prime, limites: req.body.offre_limites,
      conditions: req.body.offre_conditions, validite: req.body.offre_validite,
    });
  } catch (err) { return pageErreur(res, 400, 'Offre non enregistrée', err.message); }
  res.redirect(`/mise-en-marche/${e.id}`);
});

router.post('/:id/refus', (req, res) => {
  const e = chargerEnvoiAutorise(req, res, { complet: false });
  if (!e) return;
  try {
    marche.enregistrerRefus(e.id, res.locals.cabinetId, req.utilisateur, { motif: req.body.motif_refus });
  } catch (err) { return pageErreur(res, 400, 'Refus non enregistré', err.message); }
  res.redirect(`/mise-en-marche/${e.id}`);
});

router.post('/:id/accepter', (req, res) => {
  const e = chargerEnvoiAutorise(req, res, { complet: false });
  if (!e) return;
  try { marche.accepter(e.id, res.locals.cabinetId, req.utilisateur); }
  catch (err) { return pageErreur(res, 400, 'Action impossible', err.message); }
  res.redirect(`/mise-en-marche/${e.id}`);
});

router.post('/:id/annuler', (req, res) => {
  const e = chargerEnvoiAutorise(req, res, { complet: false });
  if (!e) return;
  try { marche.annuler(e.id, res.locals.cabinetId, req.utilisateur, { motif: req.body.motif_annulation || '' }); }
  catch (err) { return pageErreur(res, 400, 'Annulation impossible', err.message); }
  res.redirect(`/mise-en-marche/${e.id}`);
});

// --- Relance : prépare le brouillon (envoi au clic ensuite) ----------------------------------------------
router.post('/:id/relancer', (req, res) => {
  const e = chargerEnvoiAutorise(req, res, { complet: false });
  if (!e) return;
  try {
    const brouillonId = marche.preparerRelance(e.id, res.locals.cabinetId, req.utilisateur);
    return res.redirect(`/mise-en-marche/${e.id}?relance=${brouillonId}#courriel-${brouillonId}`);
  } catch (err) { return pageErreur(res, 400, 'Relance impossible', err.message); }
});

// --- Brouillons courriel : modification et envoi ----------------------------------------------------------------
router.post('/courriels/:cid/modifier', (req, res) => {
  const b = marche.obtenirBrouillonCourriel(Number(req.params.cid), res.locals.cabinetId);
  if (!b) return pageErreur(res, 404, 'Introuvable', 'Brouillon introuvable.');
  const e = chargerEnvoiAutorise({ params: { id: b.envoi_id }, utilisateur: req.utilisateur }, res, { complet: false });
  if (!e) return;
  try {
    marche.majBrouillonCourriel(b.id, res.locals.cabinetId, req.utilisateur, {
      destinataire: req.body.destinataire, sujet: req.body.sujet, corps: req.body.corps,
    });
  } catch (err) { return pageErreur(res, 400, 'Modification impossible', err.message); }
  res.redirect(`/mise-en-marche/${b.envoi_id}#courriel-${b.id}`);
});

router.post('/courriels/:cid/envoyer', async (req, res) => {
  const b = marche.obtenirBrouillonCourriel(Number(req.params.cid), res.locals.cabinetId);
  if (!b) return pageErreur(res, 404, 'Introuvable', 'Brouillon introuvable.');
  const e = chargerEnvoiAutorise({ params: { id: b.envoi_id }, utilisateur: req.utilisateur }, res, { complet: false });
  if (!e) return;
  try {
    const { mode } = await marche.envoyerBrouillonCourriel(b.id, res.locals.cabinetId, req.utilisateur);
    return res.redirect(`/mise-en-marche/${b.envoi_id}?envoye=1&mode=${mode}`);
  } catch (err) { return pageErreur(res, 400, 'Envoi impossible', err.message); }
});

module.exports = router;
