/**
 * routes/brouillons.js — Brouillons de messages IA (renouvellement).
 * IMPORTANT : les messages restent des BROUILLONS à valider.
 * Aucun envoi automatique n'est effectué en phase 1.
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, journal } = require('../lib/middleware');
const { ficheRevision } = require('./echeances');
const { genererBrouillonRenouvellement } = require('../lib/ia');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

// --- Liste des brouillons ----------------------------------------------------------------------------
router.get('/', (req, res) => {
  const voirArchives = req.query.archives === '1';
  const brouillons = bd.prepare(`
    SELECT b.*, p.numero_police, p.ligne,
           COALESCE(c1.raison_sociale, c2.raison_sociale) AS client_raison_sociale,
           COALESCE(c1.prenom, c2.prenom) AS client_prenom,
           COALESCE(c1.nom, c2.nom) AS client_nom,
           f.numero_facture
    FROM brouillons b
    LEFT JOIN polices p ON p.id = b.police_id
    LEFT JOIN factures f ON f.id = b.facture_id
    LEFT JOIN clients c1 ON c1.id = p.client_id
    LEFT JOIN clients c2 ON c2.id = f.client_id
    WHERE b.cabinet_id = ? AND b.archive = ${voirArchives ? '1' : '0'} ORDER BY b.cree_le DESC
  `).all(res.locals.cabinetId);
  res.render('brouillons/liste', { brouillons, voirArchives });
});

// --- Générer un brouillon pour une police -------------------------------------------------------------
router.post('/generer/:policeId', async (req, res) => {
  const fiche = ficheRevision(req.params.policeId, res.locals.cabinetId);
  if (!fiche) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });

  const { police, protections, primeTotale, manquantes, jours } = fiche;
  const client = { prenom: police.client_prenom, nom: police.client_nom, raison_sociale: police.client_raison_sociale };

  const { sujet, contenu, source } = await genererBrouillonRenouvellement({
    client, police, protections, primeTotale, manquantes, joursRestants: jours,
    nomCourtier: req.utilisateur.nom,
  });

  const r = bd.prepare(`
    INSERT INTO brouillons (cabinet_id, police_id, type, sujet, contenu, statut)
    VALUES (?, ?, 'renouvellement', ?, ?, 'brouillon')
  `).run(res.locals.cabinetId, police.id, sujet, contenu);
  journal(res.locals.cabinetId, req.utilisateur.id, 'brouillon_genere',
    `Brouillon renouvellement (source : ${source}) pour police ${police.numero_police}`);
  res.redirect('/brouillons/' + r.lastInsertRowid);
});

// --- Voir / valider un brouillon -------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const brouillon = bd.prepare(`
    SELECT b.*, p.numero_police, p.ligne,
           COALESCE(c1.raison_sociale, c2.raison_sociale) AS client_raison_sociale,
           COALESCE(c1.prenom, c2.prenom) AS client_prenom,
           COALESCE(c1.nom, c2.nom) AS client_nom,
           f.numero_facture
    FROM brouillons b
    LEFT JOIN polices p ON p.id = b.police_id
    LEFT JOIN factures f ON f.id = b.facture_id
    LEFT JOIN clients c1 ON c1.id = p.client_id
    LEFT JOIN clients c2 ON c2.id = f.client_id
    WHERE b.id = ? AND b.cabinet_id = ?
  `).get(req.params.id, res.locals.cabinetId);
  if (!brouillon) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Brouillon introuvable.' });
  res.render('brouillons/voir', { brouillon });
});

router.post('/:id/valider', (req, res) => {
  const brouillon = bd.prepare('SELECT * FROM brouillons WHERE id = ? AND cabinet_id = ?')
    .get(req.params.id, res.locals.cabinetId);
  if (!brouillon) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Brouillon introuvable.' });
  bd.prepare("UPDATE brouillons SET statut = 'valide' WHERE id = ?").run(brouillon.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'brouillon_valide', `Brouillon id ${brouillon.id} validé`);
  res.redirect('/brouillons/' + brouillon.id);
});

// --- Archiver / désarchiver (règle d'or : rien ne se supprime) ----------------------------------------
router.post('/:id/archiver', (req, res) => {
  const brouillon = bd.prepare('SELECT * FROM brouillons WHERE id = ? AND cabinet_id = ?')
    .get(req.params.id, res.locals.cabinetId);
  if (!brouillon) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Brouillon introuvable.' });
  bd.prepare('UPDATE brouillons SET archive = 1 WHERE id = ?').run(brouillon.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'brouillon_archive', `Brouillon id ${brouillon.id}`);
  res.redirect('/brouillons');
});

router.post('/:id/desarchiver', (req, res) => {
  const brouillon = bd.prepare('SELECT * FROM brouillons WHERE id = ? AND cabinet_id = ?')
    .get(req.params.id, res.locals.cabinetId);
  if (!brouillon) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Brouillon introuvable.' });
  bd.prepare('UPDATE brouillons SET archive = 0 WHERE id = ?').run(brouillon.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'brouillon_desarchive', `Brouillon id ${brouillon.id}`);
  res.redirect('/brouillons/' + brouillon.id);
});

module.exports = router;
