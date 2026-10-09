/**
 * routes/polices.js — Polices d'assurance par ligne d'affaires + protections.
 * Cloisonnement par cabinet_id sur toutes les requêtes.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, verifieCsrf, journal, estDateValide, estNombreValide,
  estAdmin, estCourtier, clausePortefeuille, clientHorsPortefeuille, reponseHorsPortefeuille } = require('../lib/middleware');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const LIGNES = ['cgl', 'biens', 'perte_exploitation', 'eo', 'cyber', 'flotte', 'cautionnement', 'do', 'autre'];
const NOMS_LIGNES = {
  cgl: 'Responsabilité civile (CGL)',
  biens: 'Biens commerciaux',
  perte_exploitation: 'Perte d’exploitation',
  eo: 'Responsabilité professionnelle (E&O)',
  cyber: 'Cyberrisques',
  flotte: 'Flotte automobile',
  cautionnement: 'Cautionnement',
  do: 'Administrateurs et dirigeants (D&O)',
  autre: 'Autre',
};
const STATUTS = ['active', 'a_renouveler', 'resiliee'];
const NOMS_STATUTS = { active: 'Active', a_renouveler: 'À renouveler', resiliee: 'Résiliée' };

function validerPolice(corps) {
  const erreurs = [];
  if (!LIGNES.includes(corps.ligne)) erreurs.push('Produit invalide.');
  if (!corps.assureur_id || !assureurDuCabinetValide(corps.assureur_id)) erreurs.push('L’assureur est requis (choisissez une fiche assureur).');
  if (!corps.numero_police || corps.numero_police.trim().length < 2) erreurs.push('Le numéro de police est requis.');
  if (!estDateValide(corps.date_effet)) erreurs.push('Date d’effet invalide (AAAA-MM-JJ).');
  if (!estDateValide(corps.date_echeance)) erreurs.push('Date d’échéance invalide (AAAA-MM-JJ).');
  if (corps.date_effet && corps.date_echeance && corps.date_echeance <= corps.date_effet) {
    erreurs.push('L’échéance doit être après la date d’effet.');
  }
  if (!estNombreValide(corps.franchise)) erreurs.push('Franchise invalide.');
  if (!STATUTS.includes(corps.statut)) erreurs.push('Statut invalide.');
  return erreurs;
}

function policeDuCabinet(id, cabinetId) {
  return bd.prepare(`
    SELECT p.*, c.raison_sociale AS client_raison_sociale, c.prenom AS client_prenom, c.nom AS client_nom,
           u.nom AS responsable_nom
    FROM polices p JOIN clients c ON c.id = p.client_id
    LEFT JOIN users u ON u.id = p.responsable_id
    WHERE p.id = ? AND p.cabinet_id = ?
  `).get(id, cabinetId);
}

function utilisateursCabinet(cabinetId) {
  return bd.prepare("SELECT id, nom, role FROM users WHERE cabinet_id = ? ORDER BY nom").all(cabinetId);
}

function assureursCabinet(cabinetId) {
  return bd.prepare('SELECT id, nom FROM assureurs WHERE cabinet_id = ? AND archive = 0 ORDER BY nom').all(cabinetId);
}

// Contexte de validation (le cabinetId de la requête en cours).
let _cabinetValidation = null;
function assureurDuCabinetValide(id) {
  if (!id || !_cabinetValidation) return false;
  return !!bd.prepare('SELECT id FROM assureurs WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(Number(id), _cabinetValidation);
}
function nomAssureur(id, cabinetId) {
  const a = bd.prepare('SELECT nom FROM assureurs WHERE id = ? AND cabinet_id = ?').get(Number(id), cabinetId);
  return a ? a.nom : null;
}

// Entreprises proposées dans les menus : portefeuille du courtier le cas échéant.
function entreprisesMenu(req, cabinetId) {
  return bd.prepare(
    'SELECT id, raison_sociale, prenom, nom FROM clients WHERE cabinet_id = ? AND archive = 0'
    + clausePortefeuille(req, 'clients') + ' ORDER BY raison_sociale'
  ).all(cabinetId);
}

// --- Versioning (règle d'or) ---------------------------------------------------------------------------
// Chaque version est un snapshot complet (champs + protections) en lecture seule.
// v1 = création ; chaque modification (formulaire, protection) crée v(n+1).
function creerVersionPolice(policeId, userId) {
  const police = bd.prepare('SELECT * FROM polices WHERE id = ?').get(policeId);
  if (!police) return null;
  const protections = bd.prepare('SELECT code, libelle, prime FROM police_protections WHERE police_id = ? ORDER BY code').all(policeId);
  const maxV = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM police_versions WHERE police_id = ?').get(policeId).m;
  const v = maxV + 1;
  bd.prepare(`
    INSERT INTO police_versions (police_id, version, date_effet, date_echeance, franchise, notes, protections_json, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(policeId, v, police.date_effet, police.date_echeance, police.franchise, police.notes,
    JSON.stringify(protections), userId || null);
  journal(police.cabinet_id, userId, 'police_version', `Police id ${policeId} → version ${v}`);
  return v;
}

function versionsPolice(policeId) {
  return bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM police_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.police_id = ? ORDER BY v.version DESC
  `).all(policeId);
}

// --- Liste ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const ligne = req.query.ligne;
  let polices;
  const base = `
    SELECT p.*, c.raison_sociale AS client_raison_sociale, c.prenom AS client_prenom, c.nom AS client_nom,
           u.nom AS responsable_nom,
           (SELECT COALESCE(SUM(prime), 0) FROM police_protections pp WHERE pp.police_id = p.id) AS prime_totale
    FROM polices p JOIN clients c ON c.id = p.client_id
    LEFT JOIN users u ON u.id = p.responsable_id
    WHERE p.cabinet_id = ? AND c.archive = 0${clausePortefeuille(req, 'c')}`;
  if (ligne && LIGNES.includes(ligne)) {
    polices = bd.prepare(base + ' AND p.ligne = ? ORDER BY p.date_echeance').all(res.locals.cabinetId, ligne);
  } else {
    polices = bd.prepare(base + ' ORDER BY p.date_echeance').all(res.locals.cabinetId);
  }
  res.render('polices/liste', { polices, ligne: ligne || '', NOMS_LIGNES, NOMS_STATUTS });
});

// --- Nouvelle police ----------------------------------------------------------------------------
router.get('/nouvelle', (req, res) => {
  const clients = entreprisesMenu(req, res.locals.cabinetId);
  const preselection = req.query.client ? Number(req.query.client) : null;
  const utilisateurs = utilisateursCabinet(res.locals.cabinetId);
  res.render('polices/formulaire', { erreur: null, police: { client_id: preselection }, clients, utilisateurs, peutChangerResponsable: estAdmin(req), assureurs: assureursCabinet(res.locals.cabinetId), NOMS_LIGNES, NOMS_STATUTS, LIGNES });
});

router.post('/', (req, res) => {
  _cabinetValidation = res.locals.cabinetId;
  const erreurs = validerPolice(req.body);
  const nomAss = nomAssureur(req.body.assureur_id, res.locals.cabinetId);
  if (req.body.assureur_id && !nomAss) erreurs.push('Assureur invalide.');
  const client = bd.prepare('SELECT id FROM clients WHERE id = ? AND cabinet_id = ?').get(Number(req.body.client_id), res.locals.cabinetId);
  if (!client) erreurs.push('Entreprise invalide.');
  else if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, client.id)) erreurs.push('Cette entreprise n’est pas dans votre portefeuille.');
  // Seul l'admin peut désigner le courtier responsable.
  const responsableId = estAdmin(req) && req.body.responsable_id ? Number(req.body.responsable_id) : null;
  if (responsableId && !bd.prepare('SELECT id FROM users WHERE id = ? AND cabinet_id = ?').get(responsableId, res.locals.cabinetId)) {
    erreurs.push('Courtier responsable invalide.');
  }
  if (erreurs.length) {
    const clients = entreprisesMenu(req, res.locals.cabinetId);
    const utilisateurs = utilisateursCabinet(res.locals.cabinetId);
    return res.status(400).render('polices/formulaire', { erreur: erreurs.join(' '), police: req.body, clients, utilisateurs, peutChangerResponsable: estAdmin(req), assureurs: assureursCabinet(res.locals.cabinetId), NOMS_LIGNES, NOMS_STATUTS, LIGNES });
  }
  try {
    const r = bd.prepare(`
      INSERT INTO polices (cabinet_id, client_id, ligne, assureur, assureur_id, numero_police, date_effet, date_echeance, franchise, statut, notes, responsable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(res.locals.cabinetId, client.id, req.body.ligne, nomAss, Number(req.body.assureur_id),
      req.body.numero_police.trim(), req.body.date_effet, req.body.date_echeance,
      Number(req.body.franchise || 0), req.body.statut, (req.body.notes || '').trim() || null, responsableId);
    creerVersionPolice(r.lastInsertRowid, req.utilisateur.id); // v1
    journal(res.locals.cabinetId, req.utilisateur.id, 'police_creee', `Police ${req.body.numero_police} (id ${r.lastInsertRowid})`);
    res.redirect('/echeances/police/' + r.lastInsertRowid);
  } catch (e) {
    const clients = entreprisesMenu(req, res.locals.cabinetId);
    const utilisateurs = utilisateursCabinet(res.locals.cabinetId);
    const msg = e.message.includes('UNIQUE') ? 'Ce numéro de police existe déjà dans votre cabinet.' : 'Erreur d’enregistrement.';
    res.status(400).render('polices/formulaire', { erreur: msg, police: req.body, clients, utilisateurs, peutChangerResponsable: estAdmin(req), assureurs: assureursCabinet(res.locals.cabinetId), NOMS_LIGNES, NOMS_STATUTS, LIGNES });
  }
});

// --- Modifier (chaque enregistrement crée une nouvelle version) ---------------------------------------------
router.get('/:id/modifier', (req, res) => {
  const police = policeDuCabinet(req.params.id, res.locals.cabinetId);
  if (!police) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, police.client_id)) return reponseHorsPortefeuille(res);
  const clients = entreprisesMenu(req, res.locals.cabinetId);
  const utilisateurs = utilisateursCabinet(res.locals.cabinetId);
  res.render('polices/formulaire', { erreur: null, police, clients, utilisateurs, peutChangerResponsable: estAdmin(req), assureurs: assureursCabinet(res.locals.cabinetId), NOMS_LIGNES, NOMS_STATUTS, LIGNES });
});

router.post('/:id', (req, res) => {
  const police = policeDuCabinet(req.params.id, res.locals.cabinetId);
  if (!police) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, police.client_id)) return reponseHorsPortefeuille(res);
  _cabinetValidation = res.locals.cabinetId;
  const erreurs = validerPolice(req.body);
  const nomAss = nomAssureur(req.body.assureur_id, res.locals.cabinetId);
  if (req.body.assureur_id && !nomAss) erreurs.push('Assureur invalide.');
  // Seul l'admin peut changer le courtier responsable (sinon on garde l'existant).
  const responsableId = estAdmin(req)
    ? (req.body.responsable_id ? Number(req.body.responsable_id) : null)
    : police.responsable_id;
  if (responsableId && !bd.prepare('SELECT id FROM users WHERE id = ? AND cabinet_id = ?').get(responsableId, res.locals.cabinetId)) {
    erreurs.push('Courtier responsable invalide.');
  }
  if (erreurs.length) {
    const clients = entreprisesMenu(req, res.locals.cabinetId);
    const utilisateurs = utilisateursCabinet(res.locals.cabinetId);
    return res.status(400).render('polices/formulaire', { erreur: erreurs.join(' '), police: { ...police, ...req.body }, clients, utilisateurs, peutChangerResponsable: estAdmin(req), assureurs: assureursCabinet(res.locals.cabinetId), NOMS_LIGNES, NOMS_STATUTS, LIGNES });
  }
  bd.prepare(`
    UPDATE polices SET ligne = ?, assureur = ?, assureur_id = ?, numero_police = ?, date_effet = ?, date_echeance = ?,
                       franchise = ?, statut = ?, notes = ?, responsable_id = ?
    WHERE id = ? AND cabinet_id = ?
  `).run(req.body.ligne, nomAss, Number(req.body.assureur_id), req.body.numero_police.trim(),
    req.body.date_effet, req.body.date_echeance, Number(req.body.franchise || 0),
    req.body.statut, (req.body.notes || '').trim() || null, responsableId, police.id, res.locals.cabinetId);
  creerVersionPolice(police.id, req.utilisateur.id); // nouvelle version (avenant)
  journal(res.locals.cabinetId, req.utilisateur.id, 'police_modifiee', `Police id ${police.id}`);
  res.redirect('/echeances/police/' + police.id);
});

// --- Historique des versions (règle d'or : jamais de modification silencieuse) ---------------------------
router.get('/:id/versions', (req, res) => {
  const police = policeDuCabinet(req.params.id, res.locals.cabinetId);
  if (!police) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });
  res.render('polices/versions', { police, versions: versionsPolice(police.id), NOMS_LIGNES });
});

router.get('/:id/versions/:v', (req, res) => {
  const police = policeDuCabinet(req.params.id, res.locals.cabinetId);
  if (!police) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });
  const version = bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM police_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.police_id = ? AND v.version = ?
  `).get(police.id, Number(req.params.v));
  if (!version) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Version introuvable.' });
  version.protections = JSON.parse(version.protections_json || '[]');
  res.render('polices/version', { police, version, NOMS_LIGNES });
});

// --- Protections d'une police ---------------------------------------------------------------------------
router.post('/:id/protections', (req, res) => {
  const police = policeDuCabinet(req.params.id, res.locals.cabinetId);
  if (!police) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });

  const code = String(req.body.code || '').trim().toUpperCase().slice(0, 20);
  const prime = Number(req.body.prime);
  if (!code) return res.status(400).render('erreur', { titre: 'Code requis', message: 'Le code de protection est requis.' });
  if (isNaN(prime) || prime < 0) return res.status(400).render('erreur', { titre: 'Prime invalide', message: 'La prime doit être un nombre positif.' });

  // Libellé : celui du catalogue si le code existe, sinon celui saisi
  const cat = bd.prepare('SELECT libelle FROM catalogue_protections WHERE ligne = ? AND code = ?').get(police.ligne, code);
  const libelle = cat ? cat.libelle : String(req.body.libelle || code).trim().slice(0, 120);

  try {
    bd.prepare('INSERT INTO police_protections (police_id, code, libelle, prime) VALUES (?, ?, ?, ?)')
      .run(police.id, code, libelle, prime);
    journal(res.locals.cabinetId, req.utilisateur.id, 'protection_ajoutee', `Protection ${code} sur police id ${police.id}`);
  } catch (e) {
    if (!e.message.includes('UNIQUE')) throw e;
    // Déjà présente → on met à jour la prime
    bd.prepare('UPDATE police_protections SET prime = ?, libelle = ? WHERE police_id = ? AND code = ?')
      .run(prime, libelle, police.id, code);
  }
  creerVersionPolice(police.id, req.utilisateur.id); // l'avenant est tracé
  res.redirect('/echeances/police/' + police.id);
});

router.post('/:id/protections/:protId/retirer', (req, res) => {
  const police = policeDuCabinet(req.params.id, res.locals.cabinetId);
  if (!police) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });
  bd.prepare('DELETE FROM police_protections WHERE id = ? AND police_id = ?').run(req.params.protId, police.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'protection_retiree', `Protection id ${req.params.protId} sur police id ${police.id}`);
  creerVersionPolice(police.id, req.utilisateur.id); // l'état précédent reste dans l'historique
  res.redirect('/echeances/police/' + police.id);
});

// --- Documents au niveau police ---------------------------------------------------------------------------
const stockageDocs = multer.diskStorage({
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
const televersementDocs = multer({
  storage: stockageDocs,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^(application\/pdf|image\/(png|jpeg)|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))$/.test(file.mimetype);
    cb(ok ? null : new Error('Type de fichier non accepté (PDF, images, Word, Excel).'), ok);
  },
});

router.post('/:id/documents', televersementDocs.single('document'), verifieCsrf, (req, res, next) => {
  const police = policeDuCabinet(req.params.id, res.locals.cabinetId);
  if (!police) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });
  }
  if (!req.file) {
    return res.status(400).render('erreur', { titre: 'Aucun fichier', message: 'Choisissez un fichier à téléverser.' });
  }
  bd.prepare(`
    INSERT INTO documents (cabinet_id, police_id, nom_origine, chemin, mime, taille)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, police.id, req.file.originalname, req.file.path, req.file.mimetype, req.file.size);
  journal(res.locals.cabinetId, req.utilisateur.id, 'document_ajoute', `Document « ${req.file.originalname} » pour police id ${police.id}`);
  res.redirect('/echeances/police/' + police.id + '?doc=ok');
}, (err, req, res, next) => {
  res.status(400).render('erreur', { titre: 'Téléversement refusé', message: err.message });
});

router.post('/:id/documents/:docId/archiver', (req, res) => {
  const police = policeDuCabinet(req.params.id, res.locals.cabinetId);
  if (!police) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });
  const doc = bd.prepare('SELECT * FROM documents WHERE id = ? AND police_id = ? AND cabinet_id = ?')
    .get(req.params.docId, police.id, res.locals.cabinetId);
  if (!doc) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Document introuvable.' });
  bd.prepare('UPDATE documents SET archive = 1 WHERE id = ?').run(doc.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'document_archive', `Document « ${doc.nom_origine} » (id ${doc.id})`);
  res.redirect('/echeances/police/' + police.id);
});

router.post('/:id/documents/:docId/desarchiver', (req, res) => {
  const police = policeDuCabinet(req.params.id, res.locals.cabinetId);
  if (!police) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });
  const doc = bd.prepare('SELECT * FROM documents WHERE id = ? AND police_id = ? AND cabinet_id = ?')
    .get(req.params.docId, police.id, res.locals.cabinetId);
  if (!doc) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Document introuvable.' });
  bd.prepare('UPDATE documents SET archive = 0 WHERE id = ?').run(doc.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'document_desarchive', `Document « ${doc.nom_origine} » (id ${doc.id})`);
  res.redirect('/echeances/police/' + police.id);
});

module.exports = router;
module.exports.NOMS_LIGNES = NOMS_LIGNES;
module.exports.NOMS_STATUTS = NOMS_STATUTS;
module.exports.creerVersionPolice = creerVersionPolice;
module.exports.versionsPolice = versionsPolice;
