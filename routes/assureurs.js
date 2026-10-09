/**
 * routes/assureurs.js — Fiches assureurs : coordonnées générales, contacts
 * nouvelle affaire et contacts modifications/avenants. Les polices sont
 * reliées aux fiches (polices.assureur_id).
 * Cloisonnement par cabinet_id ; archivage (règle d'or), jamais de suppression.
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, journal, estCourrielValide } = require('../lib/middleware');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

function assureurDuCabinet(id, cabinetId) {
  return bd.prepare('SELECT * FROM assureurs WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
}

function validerAssureur(corps, cabinetId, exclureId) {
  const erreurs = [];
  if (!corps.nom || corps.nom.trim().length < 2) erreurs.push('Le nom de l’assureur est requis.');
  if (!estCourrielValide(corps.courriel_general)) erreurs.push('Courriel général invalide.');
  if (!estCourrielValide(corps.na_courriel)) erreurs.push('Courriel (nouvelle affaire) invalide.');
  if (!estCourrielValide(corps.mod_courriel)) erreurs.push('Courriel (modifications) invalide.');
  const nom = corps.nom.trim();
  const doublon = bd.prepare(
    'SELECT id FROM assureurs WHERE cabinet_id = ? AND lower(nom) = lower(?) AND id != ?'
  ).get(cabinetId, nom, exclureId || -1);
  if (doublon) erreurs.push('Un assureur porte déjà ce nom.');
  return erreurs;
}

function corpsAssureur(corps) {
  const v = (x) => (x || '').trim() || null;
  return {
    nom: v(corps.nom),
    site_web: v(corps.site_web),
    telephone_general: v(corps.telephone_general),
    courriel_general: v(corps.courriel_general),
    na_nom: v(corps.na_nom),
    na_telephone: v(corps.na_telephone),
    na_courriel: v(corps.na_courriel),
    mod_nom: v(corps.mod_nom),
    mod_telephone: v(corps.mod_telephone),
    mod_courriel: v(corps.mod_courriel),
    notes: v(corps.notes),
  };
}

// --- Liste ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const voirArchives = req.query.archives === '1';
  const assureurs = bd.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM polices p WHERE p.assureur_id = a.id AND p.statut IN ('active', 'a_renouveler')) AS nb_polices
    FROM assureurs a
    WHERE a.cabinet_id = ? AND a.archive = ${voirArchives ? '1' : '0'}
    ORDER BY a.nom
  `).all(res.locals.cabinetId);
  res.render('assureurs/liste', { assureurs, voirArchives });
});

// --- Nouveau --------------------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  res.render('assureurs/formulaire', { erreur: null, assureur: null });
});

router.post('/', (req, res) => {
  const erreurs = validerAssureur(req.body, res.locals.cabinetId, null);
  if (erreurs.length) {
    return res.status(400).render('assureurs/formulaire', { erreur: erreurs.join(' '), assureur: req.body });
  }
  const a = corpsAssureur(req.body);
  const r = bd.prepare(`
    INSERT INTO assureurs (cabinet_id, nom, site_web, telephone_general, courriel_general,
                           na_nom, na_telephone, na_courriel, mod_nom, mod_telephone, mod_courriel, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, a.nom, a.site_web, a.telephone_general, a.courriel_general,
    a.na_nom, a.na_telephone, a.na_courriel, a.mod_nom, a.mod_telephone, a.mod_courriel, a.notes);
  journal(res.locals.cabinetId, req.utilisateur.id, 'assureur_cree', `Assureur ${a.nom} (id ${r.lastInsertRowid})`);
  res.redirect('/assureurs/' + r.lastInsertRowid);
});

// --- Fiche ----------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const assureur = assureurDuCabinet(req.params.id, res.locals.cabinetId);
  if (!assureur) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Assureur introuvable.' });
  const polices = bd.prepare(`
    SELECT p.*, c.raison_sociale FROM polices p
    JOIN clients c ON c.id = p.client_id
    WHERE p.assureur_id = ? AND p.statut IN ('active', 'a_renouveler')
    ORDER BY c.raison_sociale, p.numero_police
  `).all(assureur.id);
  res.render('assureurs/fiche', { assureur, polices });
});

// --- Modifier -------------------------------------------------------------------------------
router.get('/:id/modifier', (req, res) => {
  const assureur = assureurDuCabinet(req.params.id, res.locals.cabinetId);
  if (!assureur) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Assureur introuvable.' });
  res.render('assureurs/formulaire', { erreur: null, assureur });
});

router.post('/:id', (req, res) => {
  const assureur = assureurDuCabinet(req.params.id, res.locals.cabinetId);
  if (!assureur) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Assureur introuvable.' });
  const erreurs = validerAssureur(req.body, res.locals.cabinetId, assureur.id);
  if (erreurs.length) {
    return res.status(400).render('assureurs/formulaire', { erreur: erreurs.join(' '), assureur: { ...assureur, ...req.body } });
  }
  const a = corpsAssureur(req.body);
  bd.prepare(`
    UPDATE assureurs SET nom = ?, site_web = ?, telephone_general = ?, courriel_general = ?,
                        na_nom = ?, na_telephone = ?, na_courriel = ?,
                        mod_nom = ?, mod_telephone = ?, mod_courriel = ?, notes = ?
    WHERE id = ? AND cabinet_id = ?
  `).run(a.nom, a.site_web, a.telephone_general, a.courriel_general,
    a.na_nom, a.na_telephone, a.na_courriel, a.mod_nom, a.mod_telephone, a.mod_courriel, a.notes,
    assureur.id, res.locals.cabinetId);
  // Garder le nom synchronisé sur les polices liées (affichage historique)
  bd.prepare('UPDATE polices SET assureur = ? WHERE assureur_id = ?').run(a.nom, assureur.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'assureur_modifie', `Assureur ${a.nom} (id ${assureur.id})`);
  res.redirect('/assureurs/' + assureur.id);
});

// --- Archiver / désarchiver (règle d'or : jamais de suppression) ------------------------------
router.post('/:id/archiver', (req, res) => {
  const assureur = assureurDuCabinet(req.params.id, res.locals.cabinetId);
  if (!assureur) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Assureur introuvable.' });
  const nb = bd.prepare(`SELECT COUNT(*) AS n FROM polices WHERE assureur_id = ? AND statut IN ('active', 'a_renouveler')`).get(assureur.id).n;
  if (nb > 0) {
    return res.status(400).render('erreur', { titre: 'Action refusée', message: `Cet assureur a encore ${nb} police(s) active(s) reliée(s). Réassignez d’abord ces polices.` });
  }
  bd.prepare('UPDATE assureurs SET archive = 1 WHERE id = ?').run(assureur.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'assureur_archive', `Assureur ${assureur.nom} (id ${assureur.id})`);
  res.redirect('/assureurs');
});

router.post('/:id/desarchiver', (req, res) => {
  const assureur = assureurDuCabinet(req.params.id, res.locals.cabinetId);
  if (!assureur) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Assureur introuvable.' });
  bd.prepare('UPDATE assureurs SET archive = 0 WHERE id = ?').run(assureur.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'assureur_desarchive', `Assureur ${assureur.nom} (id ${assureur.id})`);
  res.redirect('/assureurs/' + assureur.id);
});

module.exports = router;
