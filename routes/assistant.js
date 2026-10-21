/**
 * routes/assistant.js — Page « Assistant IA » : discussion écrite ou dictée
 * pour demander des modifications (contacts, tâches, notes) en langage naturel.
 * Cloisonnement par cabinet_id ; journal d'audit via lib/assistant.js.
 */
const express = require('express');

const { exigeAuth, exigeMotDePasseChange, journal } = require('../lib/middleware');
const assistant = require('../lib/assistant');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

router.get('/', (req, res) => {
  const messages = assistant.historique(res.locals.cabinetId, 50);
  res.render('assistant/chat', {
    messages,
    moteur: assistant.moteurActif(res.locals.cabinetId),
    aide: assistant.messageAide(),
  });
});

router.post('/message', async (req, res) => {
  const texte = String(req.body.message || '');
  if (!texte.trim()) {
    return res.status(400).json({ erreur: 'Message vide.' });
  }
  try {
    const r = await assistant.traiter(res.locals.cabinetId, req.utilisateur.id, texte);
    journal(res.locals.cabinetId, req.utilisateur.id, 'assistant_message', `Assistant IA (${assistant.moteurActif(res.locals.cabinetId)}) : demande traitée`);
    res.json({ reponse: r.reponse, confirmation: r.confirmation || null, redirection: r.redirection || null });
  } catch (e) {
    res.status(500).json({ erreur: 'Erreur de traitement. Réessayez.' });
  }
});

// 2e clic : confirmation d'une commande de modification (tout est revérifié).
router.post('/confirmer', async (req, res) => {
  const cmd = req.body.commande;
  if (!cmd || typeof cmd.action !== 'string' || typeof cmd.params !== 'object' || !cmd.params) {
    return res.status(400).json({ erreur: 'Commande invalide.' });
  }
  try {
    const r = assistant.confirmer(res.locals.cabinetId, req.utilisateur, cmd);
    res.json({ reponse: r.reponse });
  } catch (e) {
    res.status(500).json({ erreur: 'Erreur de traitement. Réessayez.' });
  }
});

module.exports = router;
