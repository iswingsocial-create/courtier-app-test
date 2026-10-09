/**
 * routes/clients.js — Fiches clients : CRUD, consentements Loi 25, documents.
 * Toutes les requêtes sont filtrées par cabinet_id (cloisonnement).
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, verifieCsrf, journal, estCourrielValide } = require('../lib/middleware');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const TYPES_CONSENTEMENT = [
  { type: 'communications', libelle: 'Recevoir nos communications (courriels, suivis)' },
  { type: 'partage_assureur', libelle: 'Partage des renseignements avec les assureurs (soumissions, avenants)' },
  { type: 'marketing', libelle: 'Offres et infolettres (marketing)' },
];

// Upload de documents : dossier par cabinet, noms assainis
const stockage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', String(req.utilisateur.cabinet_id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const base = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    cb(null, Date.now() + '-' + base);
  },
});
const televersement = multer({
  storage: stockage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo
  fileFilter: (req, file, cb) => {
    const ok = /^(application\/pdf|image\/(png|jpeg)|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))$/.test(file.mimetype);
    cb(ok ? null : new Error('Type de fichier non accepté (PDF, images, Word, Excel).'), ok);
  },
});

function validerClient(corps) {
  const erreurs = [];
  if (!corps.raison_sociale || corps.raison_sociale.trim().length < 2) erreurs.push('La raison sociale est requise.');
  if (!corps.prenom || corps.prenom.trim().length < 1) erreurs.push('Le prénom de la personne-contact est requis.');
  if (!corps.nom || corps.nom.trim().length < 1) erreurs.push('Le nom de la personne-contact est requis.');
  if (!estCourrielValide(corps.courriel)) erreurs.push('Courriel invalide.');
  if (!['FR', 'EN'].includes(corps.langue)) erreurs.push('Langue invalide.');
  if (corps.neq && !/^\d{10}$/.test(corps.neq.replace(/\s/g, ''))) erreurs.push('NEQ invalide (10 chiffres attendus).');
  return erreurs;
}

function utilisateursCabinet(cabinetId) {
  return bd.prepare("SELECT id, nom, role FROM users WHERE cabinet_id = ? ORDER BY nom").all(cabinetId);
}

function responsableValide(responsableId, cabinetId) {
  if (!responsableId) return null;
  const id = Number(responsableId);
  if (!bd.prepare('SELECT id FROM users WHERE id = ? AND cabinet_id = ?').get(id, cabinetId)) return 'invalide';
  return id;
}

// --- Liste + recherche ------------------------------------------------------------------
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const voirArchives = req.query.archives === '1';
  let clients;
  const base = `
    SELECT cl.*, u.nom AS responsable_nom FROM clients cl
    LEFT JOIN users u ON u.id = cl.responsable_id
    WHERE cl.cabinet_id = ? AND cl.archive = ${voirArchives ? '1' : '0'}`;
  if (q) {
    clients = bd.prepare(base + `
      AND (cl.raison_sociale LIKE ? OR cl.neq LIKE ? OR cl.prenom LIKE ? OR cl.nom LIKE ?
           OR cl.courriel LIKE ? OR cl.telephone LIKE ? OR cl.secteur_activite LIKE ?)
      ORDER BY cl.raison_sociale LIMIT 200
    `).all(res.locals.cabinetId, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  } else {
    clients = bd.prepare(base + ' ORDER BY cl.raison_sociale LIMIT 200').all(res.locals.cabinetId);
  }
  res.render('clients/liste', { clients, q, voirArchives });
});

// --- Nouveau / modifier --------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  res.render('clients/formulaire', { erreur: null, client: null, consentements: {}, TYPES_CONSENTEMENT, utilisateurs: utilisateursCabinet(res.locals.cabinetId) });
});

function corpsClient(corps) {
  return {
    raison_sociale: corps.raison_sociale.trim(),
    neq: (corps.neq || '').replace(/\s/g, '') || null,
    secteur_activite: corps.secteur_activite.trim() || null,
    prenom: corps.prenom.trim(),
    nom: corps.nom.trim(),
    titre_contact: corps.titre_contact.trim() || null,
    courriel: corps.courriel.trim() || null,
    telephone: corps.telephone.trim() || null,
    adresse: corps.adresse.trim() || null,
    ville: corps.ville.trim() || null,
    code_postal: corps.code_postal.trim() || null,
    langue: corps.langue,
    notes: corps.notes.trim() || null,
  };
}

router.post('/', (req, res) => {
  const erreurs = validerClient(req.body);
  const resp = responsableValide(req.body.responsable_id, res.locals.cabinetId);
  if (resp === 'invalide') erreurs.push('Courtier responsable invalide.');
  if (erreurs.length) {
    return res.status(400).render('clients/formulaire', { erreur: erreurs.join(' '), client: req.body, consentements: {}, TYPES_CONSENTEMENT, utilisateurs: utilisateursCabinet(res.locals.cabinetId) });
  }
  const c = corpsClient(req.body);
  const r = bd.prepare(`
    INSERT INTO clients (cabinet_id, raison_sociale, neq, secteur_activite, prenom, nom, titre_contact,
                         courriel, telephone, adresse, ville, code_postal, langue, notes, responsable_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, c.raison_sociale, c.neq, c.secteur_activite, c.prenom, c.nom, c.titre_contact,
    c.courriel, c.telephone, c.adresse, c.ville, c.code_postal, c.langue, c.notes, resp);
  enregistrerConsentements(r.lastInsertRowid, req.body);
  journal(res.locals.cabinetId, req.utilisateur.id, 'entreprise_creee', `Entreprise ${c.raison_sociale} (id ${r.lastInsertRowid})`);
  res.redirect('/clients/' + r.lastInsertRowid);
});

router.get('/:id/modifier', (req, res) => {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(req.params.id, res.locals.cabinetId);
  if (!client) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Entreprise introuvable.' });
  const consentements = lireConsentements(client.id);
  res.render('clients/formulaire', { erreur: null, client, consentements, TYPES_CONSENTEMENT, utilisateurs: utilisateursCabinet(res.locals.cabinetId) });
});

router.post('/:id', (req, res) => {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(req.params.id, res.locals.cabinetId);
  if (!client) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Entreprise introuvable.' });
  const erreurs = validerClient(req.body);
  const resp = responsableValide(req.body.responsable_id, res.locals.cabinetId);
  if (resp === 'invalide') erreurs.push('Courtier responsable invalide.');
  if (erreurs.length) {
    return res.status(400).render('clients/formulaire', { erreur: erreurs.join(' '), client: { ...client, ...req.body }, consentements: lireConsentements(client.id), TYPES_CONSENTEMENT, utilisateurs: utilisateursCabinet(res.locals.cabinetId) });
  }
  const c = corpsClient(req.body);
  bd.prepare(`
    UPDATE clients SET raison_sociale = ?, neq = ?, secteur_activite = ?, prenom = ?, nom = ?, titre_contact = ?,
                       courriel = ?, telephone = ?, adresse = ?, ville = ?, code_postal = ?, langue = ?, notes = ?,
                       responsable_id = ?
    WHERE id = ? AND cabinet_id = ?
  `).run(c.raison_sociale, c.neq, c.secteur_activite, c.prenom, c.nom, c.titre_contact,
    c.courriel, c.telephone, c.adresse, c.ville, c.code_postal, c.langue, c.notes, resp,
    client.id, res.locals.cabinetId);
  enregistrerConsentements(client.id, req.body);
  journal(res.locals.cabinetId, req.utilisateur.id, 'entreprise_modifiee', `Entreprise id ${client.id}`);
  res.redirect('/clients/' + client.id);
});

router.post('/:id/archiver', (req, res) => {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(req.params.id, res.locals.cabinetId);
  if (!client) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Entreprise introuvable.' });
  bd.prepare('UPDATE clients SET archive = 1 WHERE id = ? AND cabinet_id = ?').run(client.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'entreprise_archivee', `Entreprise ${client.raison_sociale} (id ${client.id})`);
  res.redirect('/clients');
});

router.post('/:id/desarchiver', (req, res) => {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(req.params.id, res.locals.cabinetId);
  if (!client) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Entreprise introuvable.' });
  bd.prepare('UPDATE clients SET archive = 0 WHERE id = ? AND cabinet_id = ?').run(client.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'entreprise_desarchivee', `Entreprise ${client.raison_sociale} (id ${client.id})`);
  res.redirect('/clients/' + client.id);
});

// --- Fiche client ------------------------------------------------------------------------------
function lireConsentements(clientId) {
  const lignes = bd.prepare('SELECT type, accepte, date_consentement FROM consentements WHERE client_id = ?').all(clientId);
  const map = {};
  for (const l of lignes) map[l.type] = l;
  return map;
}

function enregistrerConsentements(clientId, corps) {
  const maj = bd.prepare(`
    INSERT INTO consentements (client_id, type, accepte, date_consentement)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (client_id, type) DO UPDATE SET accepte = excluded.accepte, date_consentement = excluded.date_consentement
  `);
  const auj = new Date().toISOString().slice(0, 10);
  for (const { type } of TYPES_CONSENTEMENT) {
    const accepte = corps['consent_' + type] === 'on' ? 1 : 0;
    maj.run(clientId, type, accepte, accepte ? auj : null);
  }
}

router.get('/:id', (req, res) => {
  const client = bd.prepare(`
    SELECT cl.*, u.nom AS responsable_nom FROM clients cl
    LEFT JOIN users u ON u.id = cl.responsable_id
    WHERE cl.id = ? AND cl.cabinet_id = ?
  `).get(req.params.id, res.locals.cabinetId);
  if (!client) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Entreprise introuvable.' });
  const consentements = lireConsentements(client.id);
  const documents = bd.prepare('SELECT * FROM documents WHERE client_id = ? AND archive = 0 ORDER BY televerse_le DESC').all(client.id);
  const documentsArchives = bd.prepare('SELECT * FROM documents WHERE client_id = ? AND archive = 1 ORDER BY televerse_le DESC').all(client.id);
  const polices = bd.prepare(`
    SELECT p.*, (SELECT COALESCE(SUM(prime), 0) FROM police_protections pp WHERE pp.police_id = p.id) AS prime_totale
    FROM polices p WHERE p.client_id = ? ORDER BY p.date_echeance
  `).all(client.id);
  const reclamations = bd.prepare(`
    SELECT r.*, p.numero_police FROM reclamations r
    LEFT JOIN polices p ON p.id = r.police_id
    WHERE r.client_id = ? ORDER BY r.date_sinistre DESC
  `).all(client.id);
  const taches = bd.prepare(`
    SELECT t.*, u.nom AS assigne_nom FROM taches t
    LEFT JOIN users u ON u.id = t.assigne_a
    WHERE t.entreprise_id = ? AND t.statut != 'terminee' ORDER BY t.date_echeance
  `).all(client.id);
  const { NOMS_RECLAMATION } = require('./reclamations');
  res.render('clients/fiche', { client, consentements, TYPES_CONSENTEMENT, documents, documentsArchives, polices, reclamations, taches, NOMS_RECLAMATION, mAJout: req.query.doc === 'ok' });
});

// --- Documents joints ------------------------------------------------------------------------------
router.post('/:id/documents', televersement.single('document'), verifieCsrf, (req, res, next) => {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(req.params.id, res.locals.cabinetId);
  if (!client) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Client introuvable.' });
  }
  if (!req.file) {
    return res.status(400).render('erreur', { titre: 'Aucun fichier', message: 'Choisissez un fichier à téléverser.' });
  }
  bd.prepare(`
    INSERT INTO documents (cabinet_id, client_id, nom_origine, chemin, mime, taille)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, client.id, req.file.originalname, req.file.path, req.file.mimetype, req.file.size);
  journal(res.locals.cabinetId, req.utilisateur.id, 'document_ajoute', `Document « ${req.file.originalname} » pour entreprise id ${client.id}`);
  res.redirect('/clients/' + client.id + '?doc=ok');
}, (err, req, res, next) => {
  // Erreurs multer (taille, type)
  res.status(400).render('erreur', { titre: 'Téléversement refusé', message: err.message });
});

router.get('/documents/:docId', (req, res) => {
  const doc = bd.prepare(`
    SELECT d.* FROM documents d WHERE d.id = ? AND d.cabinet_id = ?
  `).get(req.params.docId, res.locals.cabinetId);
  if (!doc || !fs.existsSync(doc.chemin)) {
    return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Document introuvable.' });
  }
  res.download(doc.chemin, doc.nom_origine);
});

router.post('/documents/:docId/archiver', (req, res) => {
  const doc = bd.prepare('SELECT * FROM documents WHERE id = ? AND cabinet_id = ?').get(req.params.docId, res.locals.cabinetId);
  if (!doc) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Document introuvable.' });
  bd.prepare('UPDATE documents SET archive = 1 WHERE id = ?').run(doc.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'document_archive', `Document « ${doc.nom_origine} » (id ${doc.id})`);
  res.redirect(doc.police_id ? '/echeances/police/' + doc.police_id : '/clients/' + doc.client_id);
});

router.post('/documents/:docId/desarchiver', (req, res) => {
  const doc = bd.prepare('SELECT * FROM documents WHERE id = ? AND cabinet_id = ?').get(req.params.docId, res.locals.cabinetId);
  if (!doc) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Document introuvable.' });
  bd.prepare('UPDATE documents SET archive = 0 WHERE id = ?').run(doc.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'document_desarchive', `Document « ${doc.nom_origine} » (id ${doc.id})`);
  res.redirect(doc.police_id ? '/echeances/police/' + doc.police_id : '/clients/' + doc.client_id);
});

module.exports = router;
