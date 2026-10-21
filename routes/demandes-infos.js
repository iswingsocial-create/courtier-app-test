/**
 * routes/demandes-infos.js — Demandes d'informations au client (boucle
 * courriel, étapes 2 et 4) : préparation d'un brouillon depuis les manques
 * d'une soumission, édition, ENVOI UNIQUEMENT SUR VALIDATION HUMAINE
 * EXPLICITE (bouton « Envoyer »), relance par nouvelle demande liée.
 * Cloisonnement : cabinet + portefeuille du courtier (via le client de la
 * soumission). Rien ne se supprime : archivage doux.
 */
const express = require('express');
const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange } = require('../lib/middleware');
const demandesInfos = require('../lib/demandes-infos');
const { clientHorsPortefeuille } = require('../lib/middleware');
const { NOMS_PRODUITS } = require('../lib/manques');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

function erreur(res, code, message) {
  return res.status(code).type('html').send(`<p>${message}</p><p><a href="/tableau">Retour</a></p>`);
}

function chargerDemandeAutorisee(req, res, { inclureArchives = false } = {}) {
  const d = demandesInfos.obtenirDemande(Number(req.params.id), req.utilisateur.cabinet_id, { inclureArchives });
  if (!d) { erreur(res, 404, 'Demande introuvable dans votre cabinet.'); return null; }
  if (clientHorsPortefeuille(req.utilisateur.cabinet_id, req.utilisateur, d.client_id)) {
    erreur(res, 403, 'Accès refusé : ce client ne fait pas partie de votre portefeuille.');
    return null;
  }
  return d;
}

function compteEnvoi(cabinetId) {
  return !!bd.prepare(
    'SELECT id FROM courriel_comptes WHERE cabinet_id = ? AND actif = 1 AND archive = 0 LIMIT 1'
  ).get(cabinetId);
}

// --- Préparer : depuis la fiche soumission ---------------------------------------
router.get('/preparer/:produit/:soumissionId', (req, res) => {
  const { produit } = req.params;
  const soumissionId = Number(req.params.soumissionId);
  if (!NOMS_PRODUITS[produit]) return erreur(res, 404, 'Produit inconnu.');
  const s = demandesInfos.chargerSoumission(produit, soumissionId, req.utilisateur.cabinet_id);
  if (!s) return erreur(res, 404, 'Soumission introuvable dans votre cabinet.');
  if (clientHorsPortefeuille(req.utilisateur.cabinet_id, req.utilisateur, s.client_id)) {
    return erreur(res, 403, 'Accès refusé : ce client ne fait pas partie de votre portefeuille.');
  }
  const existant = demandesInfos.brouillonOuvert(req.utilisateur.cabinet_id, produit, soumissionId);
  if (existant) return res.redirect(`/demandes-infos/${existant.id}`);
  try {
    const id = demandesInfos.creerDemande(req.utilisateur.cabinet_id, req.utilisateur, { produit, soumissionId });
    return res.redirect(`/demandes-infos/${id}`);
  } catch (e) {
    return erreur(res, 400, e.message);
  }
});

// --- Détail -----------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const d = chargerDemandeAutorisee(req, res);
  if (!d) return;
  res.render('demandes-infos/detail', {
    d, NOMS_PRODUITS,
    compteEnvoi: compteEnvoi(req.utilisateur.cabinet_id),
    envoye: req.query.envoye === '1',
    modeEnvoi: req.query.mode || null,
  });
});

// --- Enregistrer le brouillon -------------------------------------------------------
router.post('/:id', (req, res) => {
  const d = chargerDemandeAutorisee(req, res);
  if (!d) return;
  try {
    demandesInfos.majBrouillon(d.id, req.utilisateur.cabinet_id, req.utilisateur.id, {
      destinataire: (req.body.destinataire || '').trim(),
      sujet: (req.body.sujet || '').trim(),
      corps: req.body.corps || '',
    });
    res.redirect(`/demandes-infos/${d.id}`);
  } catch (e) {
    erreur(res, 400, e.message);
  }
});

// --- Envoyer (validation humaine explicite) ------------------------------------------
router.post('/:id/envoyer', async (req, res) => {
  const d = chargerDemandeAutorisee(req, res);
  if (!d) return;
  try {
    const { mode } = await demandesInfos.envoyerDemande(d.id, req.utilisateur.cabinet_id, req.utilisateur);
    res.redirect(`/demandes-infos/${d.id}?envoye=1&mode=${mode}`);
  } catch (e) {
    erreur(res, 400, `Échec de l'envoi : ${e.message}`);
  }
});

// --- Relancer : nouvelle demande liée, questions restantes seulement ------------------
router.post('/:id/relancer', (req, res) => {
  const d = chargerDemandeAutorisee(req, res);
  if (!d) return;
  try {
    const id = demandesInfos.creerRelance(d.id, req.utilisateur.cabinet_id, req.utilisateur);
    res.redirect(`/demandes-infos/${id}`);
  } catch (e) {
    erreur(res, 400, e.message);
  }
});

// --- Archivage (règle d'or : rien ne se supprime) --------------------------------------
router.post('/:id/archiver', (req, res) => {
  const d = chargerDemandeAutorisee(req, res, { inclureArchives: true });
  if (!d) return;
  demandesInfos.archiverDemande(d.id, req.utilisateur.cabinet_id, req.utilisateur.id);
  res.redirect(`/${d.produit}/${d.soumission_id}`);
});

router.post('/:id/desarchiver', (req, res) => {
  const d = chargerDemandeAutorisee(req, res, { inclureArchives: true });
  if (!d) return;
  demandesInfos.desarchiverDemande(d.id, req.utilisateur.cabinet_id, req.utilisateur.id);
  res.redirect(`/demandes-infos/${d.id}`);
});

module.exports = router;
