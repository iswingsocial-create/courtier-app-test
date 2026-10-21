/**
 * routes/places.js — Points d'accès JSON Google Maps (API Places) pour
 * l'interface : recherche d'entreprises et détails d'un lieu, utilisés par
 * le formulaire d'entreprise et l'écran de révision de l'ouverture vocale.
 *
 * Lecture seule : aucun appel ne crée ni ne modifie de dossier — l'humain
 * choisit un candidat et révise avant tout enregistrement. Réservé aux
 * utilisateurs connectés ; la clé reste côté serveur (jamais exposée).
 */
const express = require('express');
const placesGoogle = require('../lib/places-google');
const { exigeAuth, exigeMotDePasseChange } = require('../lib/middleware');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

router.get('/rechercher', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    return res.json({ ok: false, statut: 'requete_vide', resultats: [], message: 'Tapez au moins 2 caractères (nom de l’entreprise, ville…).' });
  }
  const r = await placesGoogle.rechercherPourCabinet(res.locals.cabinetId, q);
  res.json({ ok: r.statut === 'ok', statut: r.statut, resultats: r.resultats, message: r.message || null });
});

router.get('/details/:placeId', async (req, res) => {
  const r = await placesGoogle.detailsPourCabinet(res.locals.cabinetId, String(req.params.placeId || ''));
  res.json({ ok: r.statut === 'ok', statut: r.statut, entreprise: r.entreprise, message: r.message || null });
});

module.exports = router;
