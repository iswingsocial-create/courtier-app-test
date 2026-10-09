/**
 * routes/capture.js — Formulaire public de capture de leads.
 * Route : /capture/<token_capture> (jeton unique par cabinet, régénérable).
 *
 * PUBLIC : aucune authentification requise (c'est le but : on le met dans
 * les publicités). En contrepartie :
 *   - rate-limit agressif (anti-spam),
 *   - champ honeypot (« site_web » doit rester vide),
 *   - validation stricte,
 *   - AUCUNE donnée existante n'est jamais exposée ni lue.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');

const bd = require('../lib/bd');
const { journal } = require('../lib/middleware');
const { validerLead, SOURCES_LEAD, NOMS_SOURCES_LEAD } = require('./leads');

const router = express.Router();

// Anti-spam : 10 soumissions / heure / IP
const limiteurCapture = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop de tentatives. Réessayez plus tard.',
});
router.use(limiteurCapture);

function cabinetParToken(token) {
  if (!token || !/^[0-9a-f]{32,}$/.test(token)) return null;
  return bd.prepare('SELECT id, nom FROM cabinets WHERE token_capture = ?').get(token);
}

// --- Formulaire public ---------------------------------------------------------------------------------
router.get('/:token', (req, res) => {
  const cabinet = cabinetParToken(req.params.token);
  if (!cabinet) return res.status(404).render('erreur', { titre: 'Lien invalide', message: 'Ce lien de capture est invalide ou a été régénéré.' });
  res.render('leads/capture', {
    erreur: null, token: req.params.token, cabinetNom: cabinet.nom,
    lead: { utm_source: req.query.utm_source || '', utm_medium: req.query.utm_medium || '', utm_campaign: req.query.utm_campaign || '' },
  });
});

router.post('/:token', (req, res) => {
  const cabinet = cabinetParToken(req.params.token);
  if (!cabinet) return res.status(404).render('erreur', { titre: 'Lien invalide', message: 'Ce lien de capture est invalide ou a été régénéré.' });

  // Honeypot : les robots remplissent ce champ caché, les humains non.
  if (req.body.site_web && String(req.body.site_web).trim() !== '') {
    journal(cabinet.id, null, 'capture_spam_bloquee', 'Honeypot déclenché sur le formulaire public');
    return res.render('leads/capture-merci', { cabinetNom: cabinet.nom });
  }

  const corps = {
    nom: req.body.nom, entreprise: req.body.entreprise, courriel: req.body.courriel,
    telephone: req.body.telephone, besoin: req.body.besoin,
    utm_source: req.body.utm_source, utm_medium: req.body.utm_medium, utm_campaign: req.body.utm_campaign,
  };
  const erreurs = validerLead(corps);
  if (erreurs.length) {
    return res.status(400).render('leads/capture', {
      erreur: erreurs.join(' '), token: req.params.token, cabinetNom: cabinet.nom, lead: corps,
    });
  }

  const campagne = (req.body.utm_campaign || '').trim() || null;
  const r = bd.prepare(`
    INSERT INTO leads (cabinet_id, nom, entreprise, courriel, telephone, besoin, source,
      campagne, utm_source, utm_medium, utm_campaign, statut)
    VALUES (?, ?, ?, ?, ?, ?, 'site_web', ?, ?, ?, ?, 'nouveau')
  `).run(cabinet.id, corps.nom.trim(),
    (corps.entreprise || '').trim() || null, (corps.courriel || '').trim() || null,
    (corps.telephone || '').trim() || null, (corps.besoin || '').trim() || null,
    campagne, (corps.utm_source || '').trim() || null,
    (corps.utm_medium || '').trim() || null, (corps.utm_campaign || '').trim() || null);
  journal(cabinet.id, null, 'lead_capture', `Lead #${r.lastInsertRowid} via formulaire public`);
  res.render('leads/capture-merci', { cabinetNom: cabinet.nom });
});

module.exports = router;
