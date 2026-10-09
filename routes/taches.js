/**
 * routes/taches.js — Tâches et rappels manuels : titre, échéance, assignation,
 * liens optionnels vers entreprise / police / réclamation.
 * Cloisonnement par cabinet_id sur toutes les requêtes.
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, journal, estDateValide,
  clausePortefeuille, clientHorsPortefeuille, reponseHorsPortefeuille } = require('../lib/middleware');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const STATUTS = ['a_faire', 'en_cours', 'terminee'];
const NOMS_TACHE = { a_faire: 'À faire', en_cours: 'En cours', terminee: 'Terminée' };

function tacheDuCabinet(id, cabinetId) {
  return bd.prepare(`
    SELECT t.*, u.nom AS assigne_nom, c.raison_sociale AS entreprise,
           p.numero_police, r.id AS reclamation_id
    FROM taches t
    LEFT JOIN users u ON u.id = t.assigne_a
    LEFT JOIN clients c ON c.id = t.entreprise_id
    LEFT JOIN polices p ON p.id = t.police_id
    LEFT JOIN reclamations r ON r.id = t.reclamation_id
    WHERE t.id = ? AND t.cabinet_id = ?
  `).get(id, cabinetId);
}

function listesCabinet(req, cabinetId) {
  return {
    utilisateurs: bd.prepare('SELECT id, nom FROM users WHERE cabinet_id = ? ORDER BY nom').all(cabinetId),
    entreprises: bd.prepare('SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0' + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale').all(cabinetId),
    polices: bd.prepare('SELECT p.id, p.numero_police, p.client_id, c.raison_sociale FROM polices p JOIN clients c ON c.id = p.client_id WHERE p.cabinet_id = ? ORDER BY p.numero_police').all(cabinetId),
    reclamations: bd.prepare(`SELECT r.id, r.client_id, c.raison_sociale, r.date_sinistre FROM reclamations r JOIN clients c ON c.id = r.client_id WHERE r.cabinet_id = ? AND r.archive = 0 AND r.statut = 'ouverte' ORDER BY r.date_sinistre DESC`).all(cabinetId),
  };
}

function validerTache(corps) {
  const erreurs = [];
  if (!corps.titre || corps.titre.trim().length < 2) erreurs.push('Le titre est requis.');
  if (corps.date_echeance && !estDateValide(corps.date_echeance)) erreurs.push('Date d’échéance invalide (AAAA-MM-JJ).');
  if (corps.statut && !STATUTS.includes(corps.statut)) erreurs.push('Statut invalide.');
  return erreurs;
}

function lienValide(table, id, cabinetId) {
  if (!id) return null;
  const ligne = bd.prepare(`SELECT id FROM ${table} WHERE id = ? AND cabinet_id = ?`).get(Number(id), cabinetId);
  return ligne ? ligne.id : 'invalide';
}

// Vérifie qu'une police / réclamation appartient bien à l'entreprise choisie.
// Les infos d'un assuré restent dans son dossier : pas de liens croisés.
function appartientEntreprise(table, id, entrepriseId, cabinetId) {
  if (!id || !entrepriseId) return true;
  const sql = table === 'polices'
    ? 'SELECT 1 FROM polices WHERE id = ? AND client_id = ? AND cabinet_id = ?'
    : 'SELECT 1 FROM reclamations WHERE id = ? AND client_id = ? AND cabinet_id = ?';
  return !!bd.prepare(sql).get(Number(id), Number(entrepriseId), cabinetId);
}

// Les courtiers voient leurs tâches : liées à leur portefeuille,
// ou sans entreprise (tâches personnelles).
function clausePortefeuilleTaches(req) {
  if (req.utilisateur && req.utilisateur.role === 'courtier') {
    return ` AND (t.entreprise_id IS NULL OR c.responsable_id = ${Number(req.utilisateur.id)})`;
  }
  return '';
}

// --- Liste ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const statut = req.query.statut;
  const voirArchives = req.query.archives === '1';
  const base = `
    SELECT t.*, u.nom AS assigne_nom, c.raison_sociale AS entreprise, p.numero_police
    FROM taches t
    LEFT JOIN users u ON u.id = t.assigne_a
    LEFT JOIN clients c ON c.id = t.entreprise_id
    LEFT JOIN polices p ON p.id = t.police_id
    WHERE t.cabinet_id = ? AND t.archive = ${voirArchives ? '1' : '0'}${clausePortefeuilleTaches(req)}`;
  const taches = (statut && STATUTS.includes(statut))
    ? bd.prepare(base + ' AND t.statut = ? ORDER BY t.date_echeance').all(res.locals.cabinetId, statut)
    : bd.prepare(base + " ORDER BY CASE WHEN t.statut = 'terminee' THEN 1 ELSE 0 END, t.date_echeance").all(res.locals.cabinetId);
  const auj = new Date().toISOString().slice(0, 10);
  res.render('taches/liste', { taches, statut: statut || '', voirArchives, auj, STATUTS, NOMS_TACHE });
});

// --- Nouvelle tâche ------------------------------------------------------------------------------
router.get('/nouvelle', (req, res) => {
  res.render('taches/formulaire', {
    erreur: null,
    tache: {
      entreprise_id: req.query.entreprise || '', police_id: req.query.police || '',
      reclamation_id: req.query.reclamation || '', assigne_a: req.utilisateur.id, statut: 'a_faire',
    },
    ...listesCabinet(req, res.locals.cabinetId), STATUTS, NOMS_TACHE,
  });
});

router.post('/', (req, res) => {
  const erreurs = validerTache(req.body);
  const assigneA = lienValide('users', req.body.assigne_a, res.locals.cabinetId);
  if (assigneA === 'invalide') erreurs.push('Assignation invalide.');
  const entrepriseId = lienValide('clients', req.body.entreprise_id, res.locals.cabinetId);
  if (entrepriseId === 'invalide') erreurs.push('Entreprise invalide.');
  else if (entrepriseId && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, entrepriseId)) erreurs.push('Cette entreprise n’est pas dans votre portefeuille.');
  const policeId = lienValide('polices', req.body.police_id, res.locals.cabinetId);
  if (policeId === 'invalide') erreurs.push('Police invalide.');
  const reclamationId = lienValide('reclamations', req.body.reclamation_id, res.locals.cabinetId);
  if (reclamationId === 'invalide') erreurs.push('Réclamation invalide.');
  if (policeId && policeId !== 'invalide' && entrepriseId && entrepriseId !== 'invalide'
      && !appartientEntreprise('polices', policeId, entrepriseId, res.locals.cabinetId)) {
    erreurs.push('La police choisie n’appartient pas à l’entreprise sélectionnée.');
  }
  if (reclamationId && reclamationId !== 'invalide' && entrepriseId && entrepriseId !== 'invalide'
      && !appartientEntreprise('reclamations', reclamationId, entrepriseId, res.locals.cabinetId)) {
    erreurs.push('La réclamation choisie n’appartient pas à l’entreprise sélectionnée.');
  }
  if (erreurs.length) {
    return res.status(400).render('taches/formulaire', {
      erreur: erreurs.join(' '), tache: req.body, ...listesCabinet(req, res.locals.cabinetId), STATUTS, NOMS_TACHE,
    });
  }
  const r = bd.prepare(`
    INSERT INTO taches (cabinet_id, assigne_a, entreprise_id, police_id, reclamation_id, titre, date_echeance, statut, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, assigneA, entrepriseId, policeId, reclamationId,
    req.body.titre.trim(), req.body.date_echeance || null, req.body.statut || 'a_faire',
    (req.body.notes || '').trim() || null);
  journal(res.locals.cabinetId, req.utilisateur.id, 'tache_creee', `Tâche « ${req.body.titre.trim()} » (id ${r.lastInsertRowid})`);
  res.redirect('/taches');
});

// --- Modifier --------------------------------------------------------------------------------------
router.get('/:id/modifier', (req, res) => {
  const tache = tacheDuCabinet(req.params.id, res.locals.cabinetId);
  if (!tache) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Tâche introuvable.' });
  if (tache.entreprise_id && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, tache.entreprise_id)) return reponseHorsPortefeuille(res);
  res.render('taches/formulaire', { erreur: null, tache, ...listesCabinet(req, res.locals.cabinetId), STATUTS, NOMS_TACHE });
});

router.post('/:id', (req, res) => {
  const tache = tacheDuCabinet(req.params.id, res.locals.cabinetId);
  if (!tache) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Tâche introuvable.' });
  if (tache.entreprise_id && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, tache.entreprise_id)) return reponseHorsPortefeuille(res);
  const erreurs = validerTache(req.body);
  const assigneA = lienValide('users', req.body.assigne_a, res.locals.cabinetId);
  if (assigneA === 'invalide') erreurs.push('Assignation invalide.');
  const entrepriseId = lienValide('clients', req.body.entreprise_id, res.locals.cabinetId);
  if (entrepriseId === 'invalide') erreurs.push('Entreprise invalide.');
  else if (entrepriseId && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, entrepriseId)) erreurs.push('Cette entreprise n’est pas dans votre portefeuille.');
  const policeId = lienValide('polices', req.body.police_id, res.locals.cabinetId);
  if (policeId === 'invalide') erreurs.push('Police invalide.');
  const reclamationId = lienValide('reclamations', req.body.reclamation_id, res.locals.cabinetId);
  if (reclamationId === 'invalide') erreurs.push('Réclamation invalide.');
  if (policeId && policeId !== 'invalide' && entrepriseId && entrepriseId !== 'invalide'
      && !appartientEntreprise('polices', policeId, entrepriseId, res.locals.cabinetId)) {
    erreurs.push('La police choisie n’appartient pas à l’entreprise sélectionnée.');
  }
  if (reclamationId && reclamationId !== 'invalide' && entrepriseId && entrepriseId !== 'invalide'
      && !appartientEntreprise('reclamations', reclamationId, entrepriseId, res.locals.cabinetId)) {
    erreurs.push('La réclamation choisie n’appartient pas à l’entreprise sélectionnée.');
  }
  if (erreurs.length) {
    return res.status(400).render('taches/formulaire', {
      erreur: erreurs.join(' '), tache: { ...tache, ...req.body }, ...listesCabinet(req, res.locals.cabinetId), STATUTS, NOMS_TACHE,
    });
  }
  bd.prepare(`
    UPDATE taches SET assigne_a = ?, entreprise_id = ?, police_id = ?, reclamation_id = ?,
                     titre = ?, date_echeance = ?, statut = ?, notes = ?
    WHERE id = ? AND cabinet_id = ?
  `).run(assigneA, entrepriseId, policeId, reclamationId, req.body.titre.trim(),
    req.body.date_echeance || null, req.body.statut || 'a_faire',
    (req.body.notes || '').trim() || null, tache.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'tache_modifiee', `Tâche id ${tache.id}`);
  res.redirect('/taches');
});

// --- Marquer terminée / rouvrir -----------------------------------------------------------------------
router.post('/:id/terminer', (req, res) => {
  const tache = tacheDuCabinet(req.params.id, res.locals.cabinetId);
  if (!tache) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Tâche introuvable.' });
  if (tache.entreprise_id && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, tache.entreprise_id)) return reponseHorsPortefeuille(res);
  const nouveau = tache.statut === 'terminee' ? 'a_faire' : 'terminee';
  bd.prepare('UPDATE taches SET statut = ? WHERE id = ? AND cabinet_id = ?').run(nouveau, tache.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'tache_statut', `Tâche id ${tache.id} → ${nouveau}`);
  res.redirect('/taches');
});

// --- Archiver / désarchiver (règle d'or : rien ne se supprime) --------------------------------------
router.post('/:id/archiver', (req, res) => {
  const tache = tacheDuCabinet(req.params.id, res.locals.cabinetId);
  if (!tache) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Tâche introuvable.' });
  if (tache.entreprise_id && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, tache.entreprise_id)) return reponseHorsPortefeuille(res);
  bd.prepare('UPDATE taches SET archive = 1 WHERE id = ? AND cabinet_id = ?').run(tache.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'tache_archivee', `Tâche « ${tache.titre} » (id ${tache.id})`);
  res.redirect('/taches');
});

router.post('/:id/desarchiver', (req, res) => {
  const tache = tacheDuCabinet(req.params.id, res.locals.cabinetId);
  if (!tache) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Tâche introuvable.' });
  if (tache.entreprise_id && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, tache.entreprise_id)) return reponseHorsPortefeuille(res);
  bd.prepare('UPDATE taches SET archive = 0 WHERE id = ? AND cabinet_id = ?').run(tache.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'tache_desarchivee', `Tâche « ${tache.titre} » (id ${tache.id})`);
  res.redirect('/taches');
});

module.exports = router;
module.exports.STATUTS_TACHE = STATUTS;
module.exports.NOMS_TACHE = NOMS_TACHE;
