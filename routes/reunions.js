/**
 * routes/reunions.js — Réunions planifiées, avec ou sans lien Teams.
 * Création depuis la fiche entreprise, la fiche lead ou les tâches.
 * Si Microsoft 365 est connecté pour le cabinet, le lien Teams peut être
 * généré automatiquement ; sinon, on le colle manuellement (mode dégradé).
 * Cloisonnement par cabinet_id sur toutes les requêtes.
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, journal } = require('../lib/middleware');
const ms = require('../lib/microsoft');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const STATUTS = ['planifiee', 'terminee', 'annulee'];
const NOMS_STATUTS_REUNION = { planifiee: 'Planifiée', terminee: 'Terminée', annulee: 'Annulée' };

function reunionDuCabinet(id, cabinetId) {
  return bd.prepare(`
    SELECT r.*, c.raison_sociale AS entreprise, l.nom AS lead_nom, l.entreprise AS lead_entreprise
    FROM reunions r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN leads l ON l.id = r.lead_id
    WHERE r.id = ? AND r.cabinet_id = ?
  `).get(id, cabinetId);
}

function validerReunion(corps) {
  const erreurs = [];
  if (!corps.titre || corps.titre.trim().length < 3) erreurs.push('Le titre est requis (3 caractères min).');
  if (!corps.date_heure || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(corps.date_heure)) {
    erreurs.push('La date et l’heure sont requises (format AAAA-MM-JJ HH:MM).');
  }
  if (corps.lien_teams && !/^https?:\/\//i.test(corps.lien_teams.trim())) {
    erreurs.push('Le lien Teams doit commencer par http(s)://.');
  }
  return erreurs;
}

// --- Liste (à venir + passées) --------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const voirArchives = req.query.archives === '1';
  const maintenant = new Date().toISOString().slice(0, 16);
  const arch = `AND r.archive = ${voirArchives ? '1' : '0'}`;
  const aVenir = bd.prepare(`
    SELECT r.*, c.raison_sociale AS entreprise, l.nom AS lead_nom
    FROM reunions r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN leads l ON l.id = r.lead_id
    WHERE r.cabinet_id = ? AND r.statut = 'planifiee' AND r.date_heure >= ? ${arch}
    ORDER BY r.date_heure
  `).all(res.locals.cabinetId, maintenant);
  const passees = bd.prepare(`
    SELECT r.*, c.raison_sociale AS entreprise, l.nom AS lead_nom
    FROM reunions r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN leads l ON l.id = r.lead_id
    WHERE r.cabinet_id = ? AND (r.statut != 'planifiee' OR r.date_heure < ?) ${arch}
    ORDER BY r.date_heure DESC LIMIT 50
  `).all(res.locals.cabinetId, maintenant);
  res.render('reunions/liste', { aVenir, passees, voirArchives, NOMS_STATUTS_REUNION });
});

// --- Nouvelle réunion ----------------------------------------------------------------------------------------------
router.get('/nouvelle', async (req, res) => {
  const entreprises = bd.prepare('SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0 ORDER BY raison_sociale').all(res.locals.cabinetId);
  const leads = bd.prepare("SELECT id, nom, entreprise FROM leads WHERE cabinet_id = ? AND statut NOT IN ('client','perdu') ORDER BY cree_le DESC").all(res.locals.cabinetId);
  const msConnecte = (await ms.statutConnexion(res.locals.cabinetId)).connecte;
  res.render('reunions/formulaire', {
    erreur: null,
    reunion: { client_id: req.query.client || '', lead_id: req.query.lead || '', titre: '', date_heure: '', lien_teams: '', notes: '' },
    entreprises, leads, msConnecte, NOMS_STATUTS_REUNION,
  });
});

router.post('/', async (req, res) => {
  const erreurs = validerReunion(req.body);
  let clientId = null;
  if (req.body.client_id) {
    const c = bd.prepare('SELECT id FROM clients WHERE id = ? AND cabinet_id = ?').get(Number(req.body.client_id), res.locals.cabinetId);
    if (!c) erreurs.push('Entreprise invalide.');
    else clientId = c.id;
  }
  let leadId = null;
  if (req.body.lead_id) {
    const l = bd.prepare('SELECT id FROM leads WHERE id = ? AND cabinet_id = ?').get(Number(req.body.lead_id), res.locals.cabinetId);
    if (!l) erreurs.push('Lead invalide.');
    else leadId = l.id;
  }
  const genererTeams = req.body.generer_teams === 'on';
  let lienTeams = (req.body.lien_teams || '').trim() || null;
  let avertissement = null;

  if (genererTeams && !lienTeams) {
    try {
      lienTeams = await ms.creerReunionTeams({
        cabinetId: res.locals.cabinetId,
        sujet: req.body.titre.trim(),
        debut: req.body.date_heure,
      });
    } catch (e) {
      avertissement = `Lien Teams non généré (${e.message}). Collez-le manuellement sur la fiche.`;
    }
  }

  if (erreurs.length) {
    const entreprises = bd.prepare('SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0 ORDER BY raison_sociale').all(res.locals.cabinetId);
    const leads = bd.prepare("SELECT id, nom, entreprise FROM leads WHERE cabinet_id = ? AND statut NOT IN ('client','perdu') ORDER BY cree_le DESC").all(res.locals.cabinetId);
    const msConnecte = (await ms.statutConnexion(res.locals.cabinetId)).connecte;
    return res.status(400).render('reunions/formulaire', {
      erreur: erreurs.join(' '), reunion: req.body, entreprises, leads, msConnecte, NOMS_STATUTS_REUNION,
    });
  }

  const r = bd.prepare(`
    INSERT INTO reunions (cabinet_id, client_id, lead_id, titre, date_heure, lien_teams, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, clientId, leadId, req.body.titre.trim(), req.body.date_heure,
    lienTeams, (req.body.notes || '').trim() || null);
  journal(res.locals.cabinetId, req.utilisateur.id, 'reunion_creee',
    `Réunion id ${r.lastInsertRowid} (« ${req.body.titre.trim()} »)${lienTeams ? ' avec lien Teams' : ''}`);
  res.redirect('/reunions/' + r.lastInsertRowid + (avertissement ? '?avert=' + encodeURIComponent(avertissement) : ''));
});

// --- Fiche --------------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const reunion = reunionDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reunion) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réunion introuvable.' });
  res.render('reunions/fiche', { reunion, NOMS_STATUTS_REUNION, avertissement: req.query.avert || null });
});

// --- Changer le statut ---------------------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const reunion = reunionDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reunion) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réunion introuvable.' });
  const statut = String(req.body.statut || '');
  if (!STATUTS.includes(statut)) {
    return res.status(400).render('erreur', { titre: 'Statut invalide', message: 'Le statut demandé est invalide.' });
  }
  bd.prepare('UPDATE reunions SET statut = ? WHERE id = ? AND cabinet_id = ?').run(statut, reunion.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'reunion_statut', `Réunion id ${reunion.id} → ${statut}`);
  res.redirect('/reunions/' + reunion.id);
});

// --- Mettre à jour le lien Teams (manuel) ---------------------------------------------------------------------
router.post('/:id/lien', (req, res) => {
  const reunion = reunionDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reunion) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réunion introuvable.' });
  const lien = (req.body.lien_teams || '').trim() || null;
  if (lien && !/^https?:\/\//i.test(lien)) {
    return res.status(400).render('erreur', { titre: 'Lien invalide', message: 'Le lien Teams doit commencer par http(s)://.' });
  }
  bd.prepare('UPDATE reunions SET lien_teams = ? WHERE id = ? AND cabinet_id = ?').run(lien, reunion.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'reunion_lien', `Lien Teams mis à jour (réunion id ${reunion.id})`);
  res.redirect('/reunions/' + reunion.id);
});

// --- Archiver / désarchiver (règle d'or : rien ne se supprime) -----------------------------------------------------------
router.post('/:id/archiver', (req, res) => {
  const reunion = reunionDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reunion) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réunion introuvable.' });
  bd.prepare('UPDATE reunions SET archive = 1 WHERE id = ? AND cabinet_id = ?').run(reunion.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'reunion_archivee', `Réunion id ${reunion.id}`);
  res.redirect('/reunions');
});

router.post('/:id/desarchiver', (req, res) => {
  const reunion = reunionDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reunion) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réunion introuvable.' });
  bd.prepare('UPDATE reunions SET archive = 0 WHERE id = ? AND cabinet_id = ?').run(reunion.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'reunion_desarchivee', `Réunion id ${reunion.id}`);
  res.redirect('/reunions/' + reunion.id);
});

module.exports = router;
module.exports.NOMS_STATUTS_REUNION = NOMS_STATUTS_REUNION;
