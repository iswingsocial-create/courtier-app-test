/**
 * routes/clients.js — Fiches clients : CRUD, consentements Loi 25, documents.
 * Toutes les requêtes sont filtrées par cabinet_id (cloisonnement).
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, verifieCsrf, journal, estCourrielValide,
  estAdmin, estCourtier, clausePortefeuille, clientHorsPortefeuille, reponseHorsPortefeuille } = require('../lib/middleware');

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
  if (!estCourrielValide(corps.courriel_entreprise)) erreurs.push('Courriel de l’entreprise invalide.');
  if (!['FR', 'EN'].includes(corps.langue)) erreurs.push('Langue invalide.');
  if (corps.neq && !/^\d{10}$/.test(corps.neq.replace(/\s/g, ''))) erreurs.push('NEQ invalide (10 chiffres attendus).');
  if (corps.chiffre_affaires && isNaN(Number(corps.chiffre_affaires))) erreurs.push('Chiffre d’affaires invalide.');
  if (corps.nb_employes && (!/^\d+$/.test(corps.nb_employes) || Number(corps.nb_employes) < 0)) erreurs.push('Nombre d’employés invalide.');
  return erreurs;
}

// Synchronise la fiche du contact principal avec les champs du formulaire.
function synchroniserContactPrincipal(cabinetId, clientId, c) {
  const existant = bd.prepare(
    'SELECT id FROM contacts WHERE client_id = ? AND principal = 1 AND archive = 0'
  ).get(clientId);
  if (existant) {
    bd.prepare(`
      UPDATE contacts SET prenom = ?, nom = ?, titre = ?, courriel = ?, telephone = ?
      WHERE id = ?
    `).run(c.prenom, c.nom, c.titre_contact, c.courriel, c.telephone, existant.id);
  } else {
    bd.prepare(`
      INSERT INTO contacts (cabinet_id, client_id, prenom, nom, titre, courriel, telephone, principal)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(cabinetId, clientId, c.prenom, c.nom, c.titre_contact, c.courriel, c.telephone);
  }
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
  const pf = clausePortefeuille(req, 'cl');
  const base = `
    SELECT cl.*, u.nom AS responsable_nom FROM clients cl
    LEFT JOIN users u ON u.id = cl.responsable_id
    WHERE cl.cabinet_id = ? AND cl.archive = ${voirArchives ? '1' : '0'}${pf}`;
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
  res.render('clients/formulaire', { erreur: null, client: null, consentements: {}, TYPES_CONSENTEMENT, utilisateurs: utilisateursCabinet(res.locals.cabinetId), peutChangerResponsable: estAdmin(req) });
});

function corpsClient(corps) {
  const v = (x) => (x == null ? '' : String(x)).trim();
  return {
    raison_sociale: v(corps.raison_sociale),
    neq: v(corps.neq).replace(/\s/g, '') || null,
    secteur_activite: v(corps.secteur_activite) || null,
    courriel_entreprise: v(corps.courriel_entreprise) || null,
    telephone_entreprise: v(corps.telephone_entreprise) || null,
    chiffre_affaires: v(corps.chiffre_affaires) ? Number(corps.chiffre_affaires) : null,
    nb_employes: v(corps.nb_employes) ? Number(corps.nb_employes) : null,
    prenom: v(corps.prenom),
    nom: v(corps.nom),
    titre_contact: v(corps.titre_contact) || null,
    courriel: v(corps.courriel) || null,
    telephone: v(corps.telephone) || null,
    adresse: v(corps.adresse) || null,
    ville: v(corps.ville) || null,
    code_postal: v(corps.code_postal) || null,
    langue: corps.langue,
    notes: v(corps.notes) || null,
  };
}

router.post('/', (req, res) => {
  const erreurs = validerClient(req.body);
  const resp = estAdmin(req)
    ? responsableValide(req.body.responsable_id, res.locals.cabinetId)
    : (estCourtier(req) ? req.utilisateur.id : responsableValide(req.body.responsable_id, res.locals.cabinetId));
  if (resp === 'invalide') erreurs.push('Courtier responsable invalide.');
  if (erreurs.length) {
    return res.status(400).render('clients/formulaire', { erreur: erreurs.join(' '), client: req.body, consentements: {}, TYPES_CONSENTEMENT, utilisateurs: utilisateursCabinet(res.locals.cabinetId), peutChangerResponsable: estAdmin(req) });
  }
  const c = corpsClient(req.body);
  const r = bd.prepare(`
    INSERT INTO clients (cabinet_id, raison_sociale, neq, secteur_activite,
                         courriel_entreprise, telephone_entreprise, chiffre_affaires, nb_employes,
                         prenom, nom, titre_contact,
                         courriel, telephone, adresse, ville, code_postal, langue, notes, responsable_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, c.raison_sociale, c.neq, c.secteur_activite,
    c.courriel_entreprise, c.telephone_entreprise, c.chiffre_affaires, c.nb_employes,
    c.prenom, c.nom, c.titre_contact,
    c.courriel, c.telephone, c.adresse, c.ville, c.code_postal, c.langue, c.notes, resp);
  synchroniserContactPrincipal(res.locals.cabinetId, r.lastInsertRowid, c);
  enregistrerConsentements(r.lastInsertRowid, req.body);
  journal(res.locals.cabinetId, req.utilisateur.id, 'entreprise_creee', `Entreprise ${c.raison_sociale} (id ${r.lastInsertRowid})`);
  res.redirect('/clients/' + r.lastInsertRowid);
});

router.get('/:id/modifier', (req, res) => {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(req.params.id, res.locals.cabinetId);
  if (!client) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Entreprise introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, client.id)) return reponseHorsPortefeuille(res);
  const consentements = lireConsentements(client.id);
  res.render('clients/formulaire', { erreur: null, client, consentements, TYPES_CONSENTEMENT, utilisateurs: utilisateursCabinet(res.locals.cabinetId), peutChangerResponsable: estAdmin(req) });
});

router.post('/:id', (req, res) => {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(req.params.id, res.locals.cabinetId);
  if (!client) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Entreprise introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, client.id)) return reponseHorsPortefeuille(res);
  const erreurs = validerClient(req.body);
  // Seul l'admin peut changer le courtier responsable d'un compte.
  const resp = estAdmin(req) ? responsableValide(req.body.responsable_id, res.locals.cabinetId) : client.responsable_id;
  if (resp === 'invalide') erreurs.push('Courtier responsable invalide.');
  if (erreurs.length) {
    return res.status(400).render('clients/formulaire', { erreur: erreurs.join(' '), client: { ...client, ...req.body }, consentements: lireConsentements(client.id), TYPES_CONSENTEMENT, utilisateurs: utilisateursCabinet(res.locals.cabinetId), peutChangerResponsable: estAdmin(req) });
  }
  const c = corpsClient(req.body);
  bd.prepare(`
    UPDATE clients SET raison_sociale = ?, neq = ?, secteur_activite = ?,
                       courriel_entreprise = ?, telephone_entreprise = ?,
                       chiffre_affaires = ?, nb_employes = ?,
                       prenom = ?, nom = ?, titre_contact = ?,
                       courriel = ?, telephone = ?, adresse = ?, ville = ?, code_postal = ?, langue = ?, notes = ?,
                       responsable_id = ?
    WHERE id = ? AND cabinet_id = ?
  `).run(c.raison_sociale, c.neq, c.secteur_activite,
    c.courriel_entreprise, c.telephone_entreprise, c.chiffre_affaires, c.nb_employes,
    c.prenom, c.nom, c.titre_contact,
    c.courriel, c.telephone, c.adresse, c.ville, c.code_postal, c.langue, c.notes, resp,
    client.id, res.locals.cabinetId);
  synchroniserContactPrincipal(res.locals.cabinetId, client.id, c);
  enregistrerConsentements(client.id, req.body);
  journal(res.locals.cabinetId, req.utilisateur.id, 'entreprise_modifiee', `Entreprise id ${client.id}`);
  res.redirect('/clients/' + client.id);
});

router.post('/:id/archiver', (req, res) => {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(req.params.id, res.locals.cabinetId);
  if (!client) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Entreprise introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, client.id)) return reponseHorsPortefeuille(res);
  bd.prepare('UPDATE clients SET archive = 1 WHERE id = ? AND cabinet_id = ?').run(client.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'entreprise_archivee', `Entreprise ${client.raison_sociale} (id ${client.id})`);
  res.redirect('/clients');
});

router.post('/:id/desarchiver', (req, res) => {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(req.params.id, res.locals.cabinetId);
  if (!client) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Entreprise introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, client.id)) return reponseHorsPortefeuille(res);
  bd.prepare('UPDATE clients SET archive = 0 WHERE id = ? AND cabinet_id = ?').run(client.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'entreprise_desarchivee', `Entreprise ${client.raison_sociale} (id ${client.id})`);
  res.redirect('/clients/' + client.id);
});

// --- Contacts multiples ----------------------------------------------------------------------------
function clientDuCabinet(id, cabinetId) {
  return bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
}

function contactDuCabinet(id, cabinetId) {
  return bd.prepare('SELECT * FROM contacts WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
}

function validerContact(corps) {
  const erreurs = [];
  if (!corps.prenom || corps.prenom.trim().length < 1) erreurs.push('Le prénom du contact est requis.');
  if (!corps.nom || corps.nom.trim().length < 1) erreurs.push('Le nom du contact est requis.');
  if (!estCourrielValide(corps.courriel)) erreurs.push('Courriel du contact invalide.');
  return erreurs;
}

router.post('/:id/contacts', (req, res) => {
  const client = clientDuCabinet(req.params.id, res.locals.cabinetId);
  if (!client) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Entreprise introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, client.id)) return reponseHorsPortefeuille(res);
  const erreurs = validerContact(req.body);
  if (erreurs.length) {
    return res.status(400).render('erreur', { titre: 'Contact invalide', message: erreurs.join(' ') });
  }
  const r = bd.prepare(`
    INSERT INTO contacts (cabinet_id, client_id, prenom, nom, titre, courriel, telephone)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, client.id,
    req.body.prenom.trim(), req.body.nom.trim(),
    (req.body.titre || '').trim() || null,
    (req.body.courriel || '').trim() || null,
    (req.body.telephone || '').trim() || null);
  journal(res.locals.cabinetId, req.utilisateur.id, 'contact_ajoute',
    `Contact ${req.body.prenom.trim()} ${req.body.nom.trim()} ajouté à ${client.raison_sociale}`);
  res.redirect('/clients/' + client.id + '#contacts');
});

router.post('/contacts/:contactId', (req, res) => {
  const contact = contactDuCabinet(req.params.contactId, res.locals.cabinetId);
  if (!contact) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Contact introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, contact.client_id)) return reponseHorsPortefeuille(res);
  const erreurs = validerContact(req.body);
  if (erreurs.length) {
    return res.status(400).render('erreur', { titre: 'Contact invalide', message: erreurs.join(' ') });
  }
  bd.prepare(`
    UPDATE contacts SET prenom = ?, nom = ?, titre = ?, courriel = ?, telephone = ?
    WHERE id = ?
  `).run(req.body.prenom.trim(), req.body.nom.trim(),
    (req.body.titre || '').trim() || null,
    (req.body.courriel || '').trim() || null,
    (req.body.telephone || '').trim() || null,
    contact.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'contact_modifie', `Contact id ${contact.id}`);
  res.redirect('/clients/' + contact.client_id + '#contacts');
});

router.post('/contacts/:contactId/principal', (req, res) => {
  const contact = contactDuCabinet(req.params.contactId, res.locals.cabinetId);
  if (!contact) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Contact introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, contact.client_id)) return reponseHorsPortefeuille(res);
  const changer = bd.transaction(() => {
    bd.prepare('UPDATE contacts SET principal = 0 WHERE client_id = ?').run(contact.client_id);
    bd.prepare('UPDATE contacts SET principal = 1 WHERE id = ?').run(contact.id);
    bd.prepare('UPDATE clients SET prenom = ?, nom = ?, titre_contact = ?, courriel = ?, telephone = ? WHERE id = ?')
      .run(contact.prenom, contact.nom, contact.titre, contact.courriel, contact.telephone, contact.client_id);
  });
  changer();
  journal(res.locals.cabinetId, req.utilisateur.id, 'contact_principal', `Contact id ${contact.id} défini comme principal`);
  res.redirect('/clients/' + contact.client_id + '#contacts');
});

router.post('/contacts/:contactId/archiver', (req, res) => {
  const contact = contactDuCabinet(req.params.contactId, res.locals.cabinetId);
  if (!contact) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Contact introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, contact.client_id)) return reponseHorsPortefeuille(res);
  if (contact.principal) {
    return res.status(400).render('erreur', { titre: 'Action refusée', message: 'Le contact principal ne peut pas être archivé. Désignez d’abord un autre contact principal.' });
  }
  bd.prepare('UPDATE contacts SET archive = 1 WHERE id = ?').run(contact.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'contact_archive', `Contact id ${contact.id}`);
  res.redirect('/clients/' + contact.client_id + '#contacts');
});

router.post('/contacts/:contactId/desarchiver', (req, res) => {
  const contact = contactDuCabinet(req.params.contactId, res.locals.cabinetId);
  if (!contact) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Contact introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, contact.client_id)) return reponseHorsPortefeuille(res);
  bd.prepare('UPDATE contacts SET archive = 0 WHERE id = ?').run(contact.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'contact_desarchive', `Contact id ${contact.id}`);
  res.redirect('/clients/' + contact.client_id + '#contacts');
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
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, client.id)) return reponseHorsPortefeuille(res);
  const consentements = lireConsentements(client.id);
  const documents = bd.prepare('SELECT * FROM documents WHERE client_id = ? AND archive = 0 ORDER BY televerse_le DESC').all(client.id);
  const documentsArchives = bd.prepare('SELECT * FROM documents WHERE client_id = ? AND archive = 1 ORDER BY televerse_le DESC').all(client.id);
  const polices = bd.prepare(`
    SELECT p.*, a.nom AS assureur_nom,
           a.na_nom, a.na_telephone, a.na_courriel,
           a.mod_nom, a.mod_telephone, a.mod_courriel,
           (SELECT COALESCE(SUM(prime), 0) FROM police_protections pp WHERE pp.police_id = p.id) AS prime_totale
    FROM polices p LEFT JOIN assureurs a ON a.id = p.assureur_id
    WHERE p.client_id = ? ORDER BY COALESCE(a.nom, p.assureur, ''), p.date_echeance
  `).all(client.id);
  // Grouper les polices par assureur pour afficher les bons contacts
  const policesParAssureur = [];
  const groupes = new Map();
  for (const p of polices) {
    const cle = p.assureur_nom || p.assureur || 'Assureur non précisé';
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        nom: cle,
        na: { nom: p.na_nom, telephone: p.na_telephone, courriel: p.na_courriel },
        mod: { nom: p.mod_nom, telephone: p.mod_telephone, courriel: p.mod_courriel },
        polices: [],
      });
      policesParAssureur.push(groupes.get(cle));
    }
    groupes.get(cle).polices.push(p);
  }
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
  const contacts = bd.prepare(`
    SELECT * FROM contacts WHERE client_id = ? AND archive = 0 ORDER BY principal DESC, nom, prenom
  `).all(client.id);
  const contactsArchives = bd.prepare(`
    SELECT * FROM contacts WHERE client_id = ? AND archive = 1 ORDER BY nom, prenom
  `).all(client.id);
  const { NOMS_RECLAMATION } = require('./reclamations');
  res.render('clients/fiche', { client, consentements, TYPES_CONSENTEMENT, documents, documentsArchives, polices, policesParAssureur, reclamations, taches, contacts, contactsArchives, NOMS_RECLAMATION, mAJout: req.query.doc === 'ok' });
});

// --- Documents joints ------------------------------------------------------------------------------
router.post('/:id/documents', televersement.single('document'), verifieCsrf, (req, res, next) => {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(req.params.id, res.locals.cabinetId);
  if (client && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, client.id)) {
    if (req.file) fs.unlinkSync(req.file.path);
    return reponseHorsPortefeuille(res);
  }
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
  if (doc.client_id && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, doc.client_id)) {
    return reponseHorsPortefeuille(res);
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
