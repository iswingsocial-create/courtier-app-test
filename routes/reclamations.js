/**
 * routes/reclamations.js — Module Réclamations (sinistres) : fiche par sinistre,
 * statuts, montants, expert, historique de suivi, rappels.
 * Cloisonnement par cabinet_id sur toutes les requêtes.
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, journal, estDateValide,
  estAdmin, clausePortefeuille, clientHorsPortefeuille, reponseHorsPortefeuille } = require('../lib/middleware');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const STATUTS = ['ouverte', 'fermee'];
const NOMS_RECLAMATION = {
  ouverte: 'Ouverte',
  fermee: 'Fermée',
};

function utilisateursCabinet(cabinetId) {
  return bd.prepare('SELECT id, nom, role FROM users WHERE cabinet_id = ? ORDER BY nom').all(cabinetId);
}

function reclamationDuCabinet(id, cabinetId) {
  return bd.prepare(`
    SELECT r.*, c.raison_sociale AS entreprise, p.numero_police,
           u.nom AS responsable_nom
    FROM reclamations r
    JOIN clients c ON c.id = r.client_id
    LEFT JOIN polices p ON p.id = r.police_id
    LEFT JOIN users u ON u.id = r.responsable_id
    WHERE r.id = ? AND r.cabinet_id = ?
  `).get(id, cabinetId);
}

function validerReclamation(corps) {
  const erreurs = [];
  if (!estDateValide(corps.date_sinistre)) erreurs.push('Date du sinistre invalide (AAAA-MM-JJ).');
  if (corps.date_declaration && !estDateValide(corps.date_declaration)) erreurs.push('Date de déclaration invalide (AAAA-MM-JJ).');
  if (!corps.description || corps.description.trim().length < 5) erreurs.push('La description est requise (5 caractères min).');
  if (corps.statut && !STATUTS.includes(corps.statut)) erreurs.push('Statut invalide.');
  for (const champ of ['montant_reclame', 'montant_regle', 'franchise_appliquee']) {
    const v = corps[champ];
    if (v !== '' && v != null && (isNaN(Number(v)) || Number(v) < 0)) erreurs.push(`Montant invalide (${champ}).`);
  }
  if (corps.date_rappel && !estDateValide(corps.date_rappel)) erreurs.push('Date de rappel invalide (AAAA-MM-JJ).');
  return erreurs;
}

function nombreOuNull(v) {
  return (v === '' || v == null) ? null : Number(v);
}

// La police choisie doit appartenir à l'entreprise de la réclamation.
// Entreprises proposées dans les menus : portefeuille du courtier le cas échéant.
function entreprisesMenu(req, cabinetId) {
  return bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(cabinetId);
}

function policeAppartientClient(policeId, clientId, cabinetId) {
  if (!policeId || !clientId) return true;
  return !!bd.prepare(
    'SELECT 1 FROM polices WHERE id = ? AND client_id = ? AND cabinet_id = ?'
  ).get(Number(policeId), Number(clientId), cabinetId);
}

// --- Liste ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const statut = req.query.statut;
  const voirArchives = req.query.archives === '1';
  const base = `
    SELECT r.*, c.raison_sociale AS entreprise, p.numero_police, u.nom AS responsable_nom
    FROM reclamations r
    JOIN clients c ON c.id = r.client_id
    LEFT JOIN polices p ON p.id = r.police_id
    LEFT JOIN users u ON u.id = r.responsable_id
    WHERE r.cabinet_id = ? AND r.archive = ${voirArchives ? '1' : '0'}${clausePortefeuille(req, 'c')}`;
  const reclamations = (statut && STATUTS.includes(statut))
    ? bd.prepare(base + ' AND r.statut = ? ORDER BY r.date_sinistre DESC').all(res.locals.cabinetId, statut)
    : bd.prepare(base + ' ORDER BY r.date_sinistre DESC').all(res.locals.cabinetId);
  res.render('reclamations/liste', { reclamations, statut: statut || '', voirArchives, STATUTS, NOMS_RECLAMATION });
});

// --- Nouvelle réclamation -----------------------------------------------------------------------
router.get('/nouvelle', (req, res) => {
  const entreprises = entreprisesMenu(req, res.locals.cabinetId);
  const polices = bd.prepare(`
    SELECT p.id, p.numero_police, p.ligne, p.client_id, c.raison_sociale FROM polices p
    JOIN clients c ON c.id = p.client_id WHERE p.cabinet_id = ? ORDER BY c.raison_sociale, p.numero_police
  `).all(res.locals.cabinetId);
  res.render('reclamations/formulaire', {
    erreur: null, reclamation: { client_id: req.query.client || '', police_id: req.query.police || '', statut: 'ouverte' },
    entreprises, polices, utilisateurs: utilisateursCabinet(res.locals.cabinetId), peutChangerResponsable: estAdmin(req), STATUTS, NOMS_RECLAMATION,
  });
});

router.post('/', (req, res) => {
  const erreurs = validerReclamation(req.body);
  const client = bd.prepare('SELECT id FROM clients WHERE id = ? AND cabinet_id = ?').get(Number(req.body.client_id), res.locals.cabinetId);
  if (!client) erreurs.push('Entreprise invalide.');
  else if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, client.id)) erreurs.push('Cette entreprise n’est pas dans votre portefeuille.');
  let policeId = null;
  if (req.body.police_id) {
    const police = bd.prepare('SELECT id FROM polices WHERE id = ? AND cabinet_id = ?').get(Number(req.body.police_id), res.locals.cabinetId);
    if (!police) erreurs.push('Police invalide.');
    else if (client && !policeAppartientClient(police.id, client.id, res.locals.cabinetId)) erreurs.push('La police choisie n’appartient pas à l’entreprise sélectionnée.');
    else policeId = police.id;
  }
  const responsableId = estAdmin(req) && req.body.responsable_id ? Number(req.body.responsable_id) : null;
  if (responsableId && !bd.prepare('SELECT id FROM users WHERE id = ? AND cabinet_id = ?').get(responsableId, res.locals.cabinetId)) {
    erreurs.push('Courtier responsable invalide.');
  }
  if (erreurs.length) {
    const entreprises = entreprisesMenu(req, res.locals.cabinetId);
    const polices = bd.prepare('SELECT p.id, p.numero_police, p.client_id, c.raison_sociale FROM polices p JOIN clients c ON c.id = p.client_id WHERE p.cabinet_id = ? ORDER BY p.numero_police').all(res.locals.cabinetId);
    return res.status(400).render('reclamations/formulaire', {
      erreur: erreurs.join(' '), reclamation: req.body, entreprises, polices,
      utilisateurs: utilisateursCabinet(res.locals.cabinetId), peutChangerResponsable: estAdmin(req), STATUTS, NOMS_RECLAMATION,
    });
  }
  const r = bd.prepare(`
    INSERT INTO reclamations (cabinet_id, client_id, police_id, numero_reclamation, date_sinistre, date_declaration,
      description, statut, montant_reclame, montant_regle, franchise_appliquee, expert_nom, expert_contact,
      responsable_id, date_rappel, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, client.id, policeId,
    (req.body.numero_reclamation || '').trim() || null, req.body.date_sinistre,
    req.body.date_declaration || null, req.body.description.trim(),
    req.body.statut || 'ouverte', nombreOuNull(req.body.montant_reclame), nombreOuNull(req.body.montant_regle),
    nombreOuNull(req.body.franchise_appliquee), (req.body.expert_nom || '').trim() || null,
    (req.body.expert_contact || '').trim() || null, responsableId,
    req.body.date_rappel || null, (req.body.notes || '').trim() || null);
  journal(res.locals.cabinetId, req.utilisateur.id, 'reclamation_creee', `Réclamation id ${r.lastInsertRowid} (entreprise id ${client.id})`);
  res.redirect('/reclamations/' + r.lastInsertRowid);
});

// --- Fiche --------------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const reclamation = reclamationDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reclamation) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réclamation introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, reclamation.client_id)) return reponseHorsPortefeuille(res);
  const suivis = bd.prepare(`
    SELECT s.*, u.nom AS auteur FROM reclamation_suivis s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.reclamation_id = ? ORDER BY s.cree_le DESC
  `).all(reclamation.id);
  res.render('reclamations/fiche', { reclamation, suivis, NOMS_RECLAMATION, STATUTS, mSuivi: req.query.suivi === 'ok' });
});

// --- Modifier -----------------------------------------------------------------------------------
router.get('/:id/modifier', (req, res) => {
  const reclamation = reclamationDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reclamation) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réclamation introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, reclamation.client_id)) return reponseHorsPortefeuille(res);
  const entreprises = entreprisesMenu(req, res.locals.cabinetId);
  const polices = bd.prepare('SELECT p.id, p.numero_police, p.client_id, c.raison_sociale FROM polices p JOIN clients c ON c.id = p.client_id WHERE p.cabinet_id = ? ORDER BY p.numero_police').all(res.locals.cabinetId);
  res.render('reclamations/formulaire', {
    erreur: null, reclamation, entreprises, polices,
    utilisateurs: utilisateursCabinet(res.locals.cabinetId), peutChangerResponsable: estAdmin(req), STATUTS, NOMS_RECLAMATION,
  });
});

router.post('/:id', (req, res) => {
  const reclamation = reclamationDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reclamation) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réclamation introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, reclamation.client_id)) return reponseHorsPortefeuille(res);
  const erreurs = validerReclamation(req.body);
  let policeId = null;
  if (req.body.police_id) {
    const police = bd.prepare('SELECT id FROM polices WHERE id = ? AND cabinet_id = ?').get(Number(req.body.police_id), res.locals.cabinetId);
    if (!police) erreurs.push('Police invalide.');
    else if (!policeAppartientClient(police.id, reclamation.client_id, res.locals.cabinetId)) erreurs.push('La police choisie n’appartient pas à l’entreprise de cette réclamation.');
    else policeId = police.id;
  }
  // Seul l'admin peut changer le courtier responsable (sinon on garde l'existant).
  const responsableId = estAdmin(req)
    ? (req.body.responsable_id ? Number(req.body.responsable_id) : null)
    : reclamation.responsable_id;
  if (responsableId && !bd.prepare('SELECT id FROM users WHERE id = ? AND cabinet_id = ?').get(responsableId, res.locals.cabinetId)) {
    erreurs.push('Courtier responsable invalide.');
  }
  if (erreurs.length) {
    const entreprises = entreprisesMenu(req, res.locals.cabinetId);
    const polices = bd.prepare('SELECT p.id, p.numero_police, p.client_id, c.raison_sociale FROM polices p JOIN clients c ON c.id = p.client_id WHERE p.cabinet_id = ? ORDER BY p.numero_police').all(res.locals.cabinetId);
    return res.status(400).render('reclamations/formulaire', {
      erreur: erreurs.join(' '), reclamation: { ...reclamation, ...req.body }, entreprises, polices,
      utilisateurs: utilisateursCabinet(res.locals.cabinetId), peutChangerResponsable: estAdmin(req), STATUTS, NOMS_RECLAMATION,
    });
  }
  bd.prepare(`
    UPDATE reclamations SET police_id = ?, numero_reclamation = ?, date_sinistre = ?, date_declaration = ?,
      description = ?, statut = ?, montant_reclame = ?, montant_regle = ?, franchise_appliquee = ?,
      expert_nom = ?, expert_contact = ?, responsable_id = ?, date_rappel = ?, notes = ?
    WHERE id = ? AND cabinet_id = ?
  `).run(policeId, (req.body.numero_reclamation || '').trim() || null, req.body.date_sinistre,
    req.body.date_declaration || null, req.body.description.trim(), req.body.statut,
    nombreOuNull(req.body.montant_reclame), nombreOuNull(req.body.montant_regle),
    nombreOuNull(req.body.franchise_appliquee), (req.body.expert_nom || '').trim() || null,
    (req.body.expert_contact || '').trim() || null, responsableId,
    req.body.date_rappel || null, (req.body.notes || '').trim() || null,
    reclamation.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'reclamation_modifiee', `Réclamation id ${reclamation.id}`);
  res.redirect('/reclamations/' + reclamation.id);
});

// --- Changement de statut rapide ------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const reclamation = reclamationDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reclamation) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réclamation introuvable.' });
  const statut = String(req.body.statut || '');
  if (!STATUTS.includes(statut)) {
    return res.status(400).render('erreur', { titre: 'Statut invalide', message: 'Le statut demandé est invalide.' });
  }
  bd.prepare('UPDATE reclamations SET statut = ? WHERE id = ? AND cabinet_id = ?').run(statut, reclamation.id, res.locals.cabinetId);
  bd.prepare('INSERT INTO reclamation_suivis (reclamation_id, user_id, texte) VALUES (?, ?, ?)')
    .run(reclamation.id, req.utilisateur.id, `Statut changé : ${NOMS_RECLAMATION[reclamation.statut]} → ${NOMS_RECLAMATION[statut]}.`);
  journal(res.locals.cabinetId, req.utilisateur.id, 'reclamation_statut', `Réclamation id ${reclamation.id} → ${statut}`);
  res.redirect('/reclamations/' + reclamation.id);
});

// --- Ajouter un suivi --------------------------------------------------------------------------------
router.post('/:id/suivis', (req, res) => {
  const reclamation = reclamationDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reclamation) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réclamation introuvable.' });
  const texte = String(req.body.texte || '').trim();
  if (texte.length < 2) {
    return res.status(400).render('erreur', { titre: 'Texte requis', message: 'Le texte du suivi est requis.' });
  }
  bd.prepare('INSERT INTO reclamation_suivis (reclamation_id, user_id, texte) VALUES (?, ?, ?)')
    .run(reclamation.id, req.utilisateur.id, texte.slice(0, 2000));
  journal(res.locals.cabinetId, req.utilisateur.id, 'reclamation_suivi', `Suivi ajouté à la réclamation id ${reclamation.id}`);
  res.redirect('/reclamations/' + reclamation.id + '?suivi=ok');
});

// --- Archiver / désarchiver (règle d'or : rien ne se supprime) -----------------------------------
router.post('/:id/archiver', (req, res) => {
  const reclamation = reclamationDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reclamation) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réclamation introuvable.' });
  bd.prepare('UPDATE reclamations SET archive = 1 WHERE id = ? AND cabinet_id = ?').run(reclamation.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'reclamation_archivee', `Réclamation id ${reclamation.id}`);
  res.redirect('/reclamations');
});

router.post('/:id/desarchiver', (req, res) => {
  const reclamation = reclamationDuCabinet(req.params.id, res.locals.cabinetId);
  if (!reclamation) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Réclamation introuvable.' });
  bd.prepare('UPDATE reclamations SET archive = 0 WHERE id = ? AND cabinet_id = ?').run(reclamation.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'reclamation_desarchivee', `Réclamation id ${reclamation.id}`);
  res.redirect('/reclamations/' + reclamation.id);
});

module.exports = router;
module.exports.STATUTS_RECLAMATION = STATUTS;
module.exports.NOMS_RECLAMATION = NOMS_RECLAMATION;
