/**
 * routes/campagnes.js — Campagnes de sollicitation par classe d'affaires.
 *
 * Segmentation : entreprises du cabinet dont le secteur d'activité correspond
 * ET dont le consentement marketing (Loi 25) est accepté.
 * LCAP (anti-pourriel) : les entreprises sans consentement sont EXCLUES
 * automatiquement ; les comptes ciblés / consentis / exclus sont affichés.
 *
 * IMPORTANT : aucun envoi automatique. La campagne produit la liste des
 * destinataires + le brouillon (export CSV). L'envoi SMTP réel viendra
 * au déploiement (voir README).
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, journal } = require('../lib/middleware');
const { genererContenuCampagne } = require('../lib/ia');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const STATUTS = ['brouillon', 'prete'];
const NOMS_STATUTS_CAMPAGNE = { brouillon: 'Brouillon', prete: 'Prête' };

// Mention de désinscription obligatoire (LCAP) — ajoutée à l'export et à l'aperçu.
const PIED_DESINSCRIPTION = "\n\n---\nPour ne plus recevoir nos communications, répondez « Désinscription » à ce courriel et nous retirerons votre adresse de notre liste.";

function lireSecteurs(texte) {
  try {
    const arr = JSON.parse(texte || '[]');
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim()) : [];
  } catch (e) { return []; }
}

function secteursDistincts(cabinetId) {
  return bd.prepare(`
    SELECT DISTINCT secteur_activite FROM clients
    WHERE cabinet_id = ? AND secteur_activite IS NOT NULL AND secteur_activite != ''
    ORDER BY secteur_activite
  `).all(cabinetId).map((r) => r.secteur_activite);
}

// Destinataires : secteur ciblé + consentement marketing accepté.
function destinataires(cabinetId, secteurs) {
  if (!secteurs.length) return { consentis: [], exclus: [] };
  const marques = secteurs.map(() => '?').join(',');
  const consentis = bd.prepare(`
    SELECT c.id, c.raison_sociale, c.secteur_activite, c.prenom, c.nom, c.courriel, c.telephone
    FROM clients c
    WHERE c.cabinet_id = ? AND c.archive = 0 AND c.secteur_activite IN (${marques})
      AND EXISTS (SELECT 1 FROM consentements WHERE client_id = c.id AND type = 'marketing' AND accepte = 1)
    ORDER BY c.raison_sociale
  `).all(cabinetId, ...secteurs);
  const exclus = bd.prepare(`
    SELECT c.id, c.raison_sociale, c.secteur_activite
    FROM clients c
    WHERE c.cabinet_id = ? AND c.archive = 0 AND c.secteur_activite IN (${marques})
      AND NOT EXISTS (SELECT 1 FROM consentements WHERE client_id = c.id AND type = 'marketing' AND accepte = 1)
    ORDER BY c.raison_sociale
  `).all(cabinetId, ...secteurs);
  return { consentis, exclus };
}

function campagneDuCabinet(id, cabinetId) {
  const c = bd.prepare('SELECT * FROM campagnes WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  if (c) c.secteurs = lireSecteurs(c.secteurs);
  return c;
}

// --- Liste ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const voirArchives = req.query.archives === '1';
  const campagnes = bd.prepare(`SELECT * FROM campagnes WHERE cabinet_id = ? AND archive = ${voirArchives ? '1' : '0'} ORDER BY cree_le DESC`).all(res.locals.cabinetId);
  campagnes.forEach((c) => {
    c.secteurs = lireSecteurs(c.secteurs);
    c.nb = destinataires(res.locals.cabinetId, c.secteurs).consentis.length;
  });
  res.render('campagnes/liste', { campagnes, voirArchives, NOMS_STATUTS_CAMPAGNE });
});

// --- Nouvelle campagne ----------------------------------------------------------------------------
router.get('/nouvelle', (req, res) => {
  res.render('campagnes/formulaire', {
    erreur: null, campagne: { secteurs: [], objet: '', contenu: '' },
    secteursDispo: secteursDistincts(res.locals.cabinetId), STATUTS, NOMS_STATUTS_CAMPAGNE,
  });
});

// Génère le contenu avec l'IA (puis retour au formulaire pré-rempli)
router.post('/ia', async (req, res) => {
  const secteurs = Array.isArray(req.body.secteurs) ? req.body.secteurs : (req.body.secteurs ? [req.body.secteurs] : []);
  const nom = String(req.body.nom || '').trim();
  const objet = String(req.body.objet || '').trim();
  const { contenu, source } = await genererContenuCampagne({
    nom: nom || 'Campagne', secteurs, nomCabinet: res.locals.utilisateur.cabinet_nom, nomCourtier: req.utilisateur.nom,
  });
  res.render('campagnes/formulaire', {
    erreur: null, campagne: { nom, secteurs, objet, contenu },
    secteursDispo: secteursDistincts(res.locals.cabinetId), STATUTS, NOMS_STATUTS_CAMPAGNE,
    mIa: source,
  });
});

router.post('/', (req, res) => {
  const secteurs = Array.isArray(req.body.secteurs) ? req.body.secteurs : (req.body.secteurs ? [req.body.secteurs] : []);
  const nom = String(req.body.nom || '').trim();
  const objet = String(req.body.objet || '').trim();
  const contenu = String(req.body.contenu || '').trim();
  const erreurs = [];
  if (nom.length < 3) erreurs.push('Le nom de la campagne est requis (3 caractères min).');
  if (!secteurs.length) erreurs.push('Choisissez au moins une classe d’affaires (secteur).');
  if (objet.length < 3) erreurs.push("L'objet du courriel est requis.");
  if (contenu.length < 20) erreurs.push('Le contenu est trop court (20 caractères min).');
  if (erreurs.length) {
    return res.status(400).render('campagnes/formulaire', {
      erreur: erreurs.join(' '), campagne: { nom, secteurs, objet, contenu },
      secteursDispo: secteursDistincts(res.locals.cabinetId), STATUTS, NOMS_STATUTS_CAMPAGNE,
    });
  }
  const r = bd.prepare(`
    INSERT INTO campagnes (cabinet_id, nom, secteurs, objet, contenu, statut)
    VALUES (?, ?, ?, ?, ?, 'brouillon')
  `).run(res.locals.cabinetId, nom, JSON.stringify(secteurs), objet, contenu);
  journal(res.locals.cabinetId, req.utilisateur.id, 'campagne_creee', `Campagne id ${r.lastInsertRowid} (« ${nom} »)`);
  res.redirect('/campagnes/' + r.lastInsertRowid);
});

// --- Fiche : aperçu des destinataires -------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const campagne = campagneDuCabinet(req.params.id, res.locals.cabinetId);
  if (!campagne) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Campagne introuvable.' });
  const { consentis, exclus } = destinataires(res.locals.cabinetId, campagne.secteurs);
  res.render('campagnes/fiche', {
    campagne, consentis, exclus, NOMS_STATUTS_CAMPAGNE,
    contenuFinal: campagne.contenu + PIED_DESINSCRIPTION,
  });
});

// --- Marquer prête ----------------------------------------------------------------------------------------
router.post('/:id/prete', (req, res) => {
  const campagne = campagneDuCabinet(req.params.id, res.locals.cabinetId);
  if (!campagne) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Campagne introuvable.' });
  bd.prepare("UPDATE campagnes SET statut = 'prete' WHERE id = ? AND cabinet_id = ?").run(campagne.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'campagne_prete', `Campagne id ${campagne.id} marquée prête`);
  res.redirect('/campagnes/' + campagne.id);
});

// --- Export CSV des destinataires (pour l'envoi) ----------------------------------------------------------------
router.get('/:id/export', (req, res) => {
  const campagne = campagneDuCabinet(req.params.id, res.locals.cabinetId);
  if (!campagne) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Campagne introuvable.' });
  const { consentis } = destinataires(res.locals.cabinetId, campagne.secteurs);
  const echapper = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lignes = ['raison_sociale;prenom;nom;courriel;telephone;secteur'];
  for (const d of consentis) {
    lignes.push([d.raison_sociale, d.prenom, d.nom, d.courriel, d.telephone, d.secteur_activite].map(echapper).join(';'));
  }
  journal(res.locals.cabinetId, req.utilisateur.id, 'campagne_export', `Export de ${consentis.length} destinataires (campagne id ${campagne.id})`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="campagne-${campagne.id}-destinataires.csv"`);
  res.send('\uFEFF' + lignes.join('\n'));
});

// --- Archiver / désarchiver (règle d'or : rien ne se supprime) ------------------------------------------------------
router.post('/:id/archiver', (req, res) => {
  const campagne = campagneDuCabinet(req.params.id, res.locals.cabinetId);
  if (!campagne) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Campagne introuvable.' });
  bd.prepare('UPDATE campagnes SET archive = 1 WHERE id = ? AND cabinet_id = ?').run(campagne.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'campagne_archivee', `Campagne id ${campagne.id}`);
  res.redirect('/campagnes');
});

router.post('/:id/desarchiver', (req, res) => {
  const campagne = campagneDuCabinet(req.params.id, res.locals.cabinetId);
  if (!campagne) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Campagne introuvable.' });
  bd.prepare('UPDATE campagnes SET archive = 0 WHERE id = ? AND cabinet_id = ?').run(campagne.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'campagne_desarchivee', `Campagne id ${campagne.id}`);
  res.redirect('/campagnes/' + campagne.id);
});

module.exports = router;
module.exports.PIED_DESINSCRIPTION = PIED_DESINSCRIPTION;
