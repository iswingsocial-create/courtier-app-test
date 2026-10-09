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
    moteur: assistant.moteurActif(),
    aide: assistant.messageAide(),
  });
});

router.post('/message', async (req, res) => {
  const texte = String(req.body.message || '');
  if (!texte.trim()) {
    return res.status(400).json({ erreur: 'Message vide.' });
  }
  try {
    const reponse = await assistant.traiter(res.locals.cabinetId, req.utilisateur.id, texte);
    journal(res.locals.cabinetId, req.utilisateur.id, 'assistant_message', `Assistant IA (${assistant.moteurActif()}) : demande traitée`);
    res.json({ reponse });
  } catch (e) {
    res.status(500).json({ erreur: 'Erreur de traitement. Réessayez.' });
  }
});

module.exports = router;
