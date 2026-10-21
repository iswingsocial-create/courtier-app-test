/**
 * routes/verifications-avenants.js — Vérification automatique des avenants
 * depuis la fiche police (/echeances/police/:id) :
 *   - déposer le document de retour de l'assureur → analyse (pipeline
 *     existant) → comparaison à l'état demandé → rapport d'écarts ;
 *   - ou choisir une pièce jointe d'un courriel déjà classé sur la police
 *     → même traitement ;
 *   - rapport : l'utilisateur peut le « marquer comme vérifié » et, en cas
 *     d'écarts, demander la correction à l'assureur (brouillon modifiable,
 *     envoi sur clic explicite seulement — module Courriels, mode simulé
 *     sans compte SMTP).
 * Règle d'or : rien ne se supprime ; aucune décision automatique.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const bd = require('../lib/bd');
const verif = require('../lib/verification-avenant');
const { exigeAuth, exigeMotDePasseChange, journal, clientHorsPortefeuille, reponseHorsPortefeuille, verifieCsrf } = require('../lib/middleware');
const { NOMS_LIGNES } = require('./polices');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const NOMS_STATUTS_VERIF = { conforme: 'Conforme', ecarts: 'Écarts détectés', a_confirmer: 'À confirmer' };
const NOMS_VERDICTS = {
  conforme: '✅ Conforme', ecart: '⚠️ Écart', absent: '❓ Absent',
  a_confirmer: '🔎 À confirmer', surplus: '➕ Non demandé',
};
const NOMS_PRODUITS = {
  auto: 'Auto (FPQ1)', biens: 'Biens', rc: 'RC', cyber: 'Cyber', eo: 'E&O',
  do: 'D&O', pe: "Perte d'exploitation", flotte: 'Flotte', cautionnement: 'Cautionnement',
};

function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

// Charge la police du cabinet et contrôle le portefeuille du courtier.
// Renvoie null (et répond) si l'accès est refusé.
function policeAutorisee(req, res) {
  const police = bd.prepare('SELECT * FROM polices WHERE id = ? AND cabinet_id = ?')
    .get(Number(req.params.id), res.locals.cabinetId);
  if (!police) { pageErreur(res, 404, 'Introuvable', 'Police introuvable.'); return null; }
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, police.client_id)) {
    reponseHorsPortefeuille(res);
    return null;
  }
  return police;
}
function verificationAutorisee(req, res, police) {
  const v = verif.obtenirVerification(Number(req.params.vid), res.locals.cabinetId);
  if (!v || v.police_id !== police.id) {
    pageErreur(res, 404, 'Introuvable', 'Vérification introuvable pour cette police.');
    return null;
  }
  return v;
}

// --- Dépôt du document de l'assureur ------------------------------------------------
const stockage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', String(req.utilisateur.cabinet_id), 'analyses');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const base = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    cb(null, Date.now() + '-avenant-' + base);
  },
});
const televersement = multer({
  storage: stockage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^(application\/pdf|image\/(png|jpeg)|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))$/.test(file.mimetype)
      || /\.csv$/i.test(file.originalname || '') || /csv/.test(file.mimetype || '');
    cb(ok ? null : new Error('Type de fichier non accepté (PDF, images PNG/JPEG, Word, Excel, CSV).'), ok);
  },
});

router.post('/police/:id/verifier-document', televersement.single('document'), verifieCsrf, async (req, res) => {
  const police = policeAutorisee(req, res);
  if (!police) return;
  if (!req.file) {
    return pageErreur(res, 400, 'Aucun fichier', 'Choisissez le document retourné par l\'assureur.');
  }
  try {
    const v = await verif.verifierDocumentDepose(res.locals.cabinetId, req.utilisateur.id, police, {
      nomOrigine: req.file.originalname, chemin: req.file.path, mime: req.file.mimetype, taille: req.file.size,
    });
    return res.redirect(`/echeances/police/${police.id}/verifications/${v.id}`);
  } catch (e) {
    return pageErreur(res, 400, 'Vérification impossible', e.message);
  }
}, (err, req, res, next) => {
  res.status(400).render('erreur', { titre: 'Téléversement refusé', message: err.message });
});

router.post('/police/:id/verifier-piece-jointe', verifieCsrf, async (req, res) => {
  const police = policeAutorisee(req, res);
  if (!police) return;
  const pjId = Number(req.body.piece_jointe_id);
  const pj = bd.prepare(`
    SELECT pj.* FROM courriel_pieces_jointes pj
    JOIN courriels c ON c.id = pj.courriel_id
    WHERE pj.id = ? AND pj.cabinet_id = ? AND c.police_id = ? AND pj.archive = 0
  `).get(pjId, res.locals.cabinetId, police.id);
  if (!pj) return pageErreur(res, 404, 'Introuvable', 'Pièce jointe introuvable pour cette police.');
  try {
    const v = await verif.verifierPieceJointe(res.locals.cabinetId, req.utilisateur.id, police, pj);
    return res.redirect(`/echeances/police/${police.id}/verifications/${v.id}`);
  } catch (e) {
    return pageErreur(res, 400, 'Vérification impossible', e.message);
  }
});

// --- Rapport ---------------------------------------------------------------------------
router.get('/police/:id/verifications/:vid', (req, res) => {
  const police = policeAutorisee(req, res);
  if (!police) return;
  const v = verificationAutorisee(req, res, police);
  if (!v) return;
  const client = bd.prepare('SELECT raison_sociale FROM clients WHERE id = ?').get(police.client_id);
  const lignes = ((v.rapport || {}).lignes) || [];
  const aDesEcarts = lignes.some((l) => ['ecart', 'absent', 'surplus'].includes(l.verdict));
  res.render('echeances/verification-rapport', {
    police, v, lignes, aDesEcarts,
    clientNom: client ? client.raison_sociale : '',
    produitNom: NOMS_PRODUITS[v.produit] || NOMS_LIGNES[police.ligne] || v.produit,
    NOMS_STATUTS_VERIF, NOMS_VERDICTS,
    ok: req.query.ok || null,
  });
});

router.post('/police/:id/verifications/:vid/marquer-verifiee', verifieCsrf, (req, res) => {
  const police = policeAutorisee(req, res);
  if (!police) return;
  const v = verificationAutorisee(req, res, police);
  if (!v) return;
  try {
    verif.marquerVerifiee(v.id, res.locals.cabinetId, req.utilisateur);
  } catch (e) {
    return pageErreur(res, 400, 'Action impossible', e.message);
  }
  return res.redirect(`/echeances/police/${police.id}/verifications/${v.id}?ok=verifiee`);
});

// --- Demande de correction à l'assureur ---------------------------------------------------
router.get('/police/:id/verifications/:vid/correction', (req, res) => {
  const police = policeAutorisee(req, res);
  if (!police) return;
  const v = verificationAutorisee(req, res, police);
  if (!v) return;
  const lignes = ((v.rapport || {}).lignes) || [];
  const ecarts = lignes
    .filter((l) => ['ecart', 'absent', 'surplus'].includes(l.verdict))
    .map((l) => ({ ...l, resume: verif.texteLigneCorrection(l) }));
  if (!ecarts.length) {
    return res.redirect(`/echeances/police/${police.id}/verifications/${v.id}`);
  }
  const genere = verif.genererBrouillonCorrection(v, police);
  const brouillon = {
    destinataire: v.correction_destinataire || genere.destinataire,
    sujet: v.correction_sujet || genere.sujet,
    corps: v.correction_corps || genere.corps,
  };
  const client = bd.prepare('SELECT raison_sociale FROM clients WHERE id = ?').get(police.client_id);
  res.render('echeances/verification-correction', {
    police, v, brouillon, ecarts,
    clientNom: client ? client.raison_sociale : '',
    NOMS_VERDICTS,
  });
});

router.post('/police/:id/verifications/:vid/correction/envoyer', verifieCsrf, async (req, res) => {
  const police = policeAutorisee(req, res);
  if (!police) return;
  const v = verificationAutorisee(req, res, police);
  if (!v) return;
  const destinataire = String(req.body.destinataire || '');
  const sujet = String(req.body.sujet || '');
  const corps = String(req.body.corps || '');
  if (!sujet.trim() || !corps.trim()) {
    return pageErreur(res, 400, 'Brouillon incomplet', 'Le sujet et le corps du courriel sont requis.');
  }
  try {
    const { mode } = await verif.envoyerCorrection(v.id, res.locals.cabinetId, req.utilisateur, { destinataire, sujet, corps });
    return res.redirect(`/echeances/police/${police.id}/verifications/${v.id}?ok=correction-${mode}`);
  } catch (e) {
    return pageErreur(res, 400, 'Envoi impossible', e.message);
  }
});

module.exports = router;
module.exports.NOMS_STATUTS_VERIF = NOMS_STATUTS_VERIF;
module.exports.NOMS_VERDICTS = NOMS_VERDICTS;
