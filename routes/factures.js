/**
 * routes/factures.js — Module Facturation : factures émises aux entreprises,
 * paiements reçus, comptes en retard, relances (brouillons IA, jamais d'envoi auto).
 * Tout est relié au client : factures.client_id est obligatoire.
 * Cloisonnement par cabinet_id sur toutes les requêtes.
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, journal, estDateValide } = require('../lib/middleware');
const { genererBrouillonRelance } = require('../lib/ia');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const STATUTS = ['emise', 'partielle', 'payee', 'en_retard', 'annulee'];
const NOMS_STATUTS_FACTURE = {
  emise: 'Émise',
  partielle: 'Partiellement payée',
  payee: 'Payée',
  en_retard: 'En retard',
  annulee: 'Annulée',
};
const MODES = ['virement', 'cheque', 'carte', 'autre'];
const NOMS_MODES = { virement: 'Virement', cheque: 'Chèque', carte: 'Carte', autre: 'Autre' };

function aujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

function joursRetard(dateEcheance) {
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const ech = new Date(dateEcheance + 'T00:00:00');
  return Math.max(0, Math.round((auj - ech) / 86400000));
}

// Marque en retard les factures échues non soldées (appelée à chaque liste).
function marquerRetards(cabinetId) {
  bd.prepare(`
    UPDATE factures SET statut = 'en_retard'
    WHERE cabinet_id = ? AND statut IN ('emise','partielle')
      AND date_echeance < ? AND (montant - montant_paye) > 0.005
  `).run(cabinetId, aujourdhui());
}

function recalculerFacture(factureId, cabinetId) {
  const f = bd.prepare('SELECT * FROM factures WHERE id = ? AND cabinet_id = ?').get(factureId, cabinetId);
  if (!f || f.statut === 'annulee') return;
  const paye = bd.prepare('SELECT COALESCE(SUM(montant), 0) AS total FROM paiements WHERE facture_id = ?').get(factureId).total;
  let statut = 'emise';
  if (paye >= Number(f.montant) - 0.005) statut = 'payee';
  else if (paye > 0.005) statut = 'partielle';
  if (statut !== 'payee' && f.date_echeance < aujourdhui()) statut = 'en_retard';
  bd.prepare('UPDATE factures SET montant_paye = ?, statut = ? WHERE id = ?').run(paye, statut, factureId);
}

function factureDuCabinet(id, cabinetId) {
  return bd.prepare(`
    SELECT f.*, c.raison_sociale AS entreprise, c.prenom AS client_prenom, c.nom AS client_nom,
           c.courriel AS client_courriel, c.telephone AS client_telephone, c.titre_contact,
           p.numero_police, p.ligne
    FROM factures f
    JOIN clients c ON c.id = f.client_id
    LEFT JOIN polices p ON p.id = f.police_id
    WHERE f.id = ? AND f.cabinet_id = ?
  `).get(id, cabinetId);
}

function prochainNumero(cabinetId) {
  const annee = new Date().getFullYear();
  const prefixe = `FAC-${annee}-`;
  const max = bd.prepare(`
    SELECT numero_facture FROM factures
    WHERE cabinet_id = ? AND numero_facture LIKE ?
    ORDER BY numero_facture DESC LIMIT 1
  `).get(cabinetId, prefixe + '%');
  let seq = 1;
  if (max) {
    const m = max.numero_facture.match(/-(\d+)$/);
    if (m) seq = Number(m[1]) + 1;
  }
  return prefixe + String(seq).padStart(4, '0');
}

function validerFacture(corps) {
  const erreurs = [];
  if (!corps.description || corps.description.trim().length < 3) erreurs.push('La description est requise.');
  if (!corps.montant || isNaN(Number(corps.montant)) || Number(corps.montant) <= 0) erreurs.push('Le montant doit être supérieur à 0.');
  if (!estDateValide(corps.date_emission)) erreurs.push("Date d'émission invalide (AAAA-MM-JJ).");
  if (!estDateValide(corps.date_echeance)) erreurs.push("Date d'échéance invalide (AAAA-MM-JJ).");
  return erreurs;
}

// --- Liste ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  marquerRetards(res.locals.cabinetId);
  const statut = req.query.statut;
  const base = `
    SELECT f.*, c.raison_sociale AS entreprise
    FROM factures f JOIN clients c ON c.id = f.client_id
    WHERE f.cabinet_id = ?`;
  const factures = (statut && STATUTS.includes(statut))
    ? bd.prepare(base + ' AND f.statut = ? ORDER BY f.date_echeance').all(res.locals.cabinetId, statut)
    : bd.prepare(base + " ORDER BY CASE f.statut WHEN 'en_retard' THEN 0 WHEN 'emise' THEN 1 WHEN 'partielle' THEN 2 ELSE 3 END, f.date_echeance").all(res.locals.cabinetId);
  const totalDu = bd.prepare(`
    SELECT COALESCE(SUM(montant - montant_paye), 0) AS total FROM factures
    WHERE cabinet_id = ? AND statut IN ('emise','partielle','en_retard')
  `).get(res.locals.cabinetId).total;
  const nbRetard = bd.prepare(`SELECT COUNT(*) AS n FROM factures WHERE cabinet_id = ? AND statut = 'en_retard'`).get(res.locals.cabinetId).n;
  res.render('factures/liste', {
    factures, statut: statut || '', STATUTS, NOMS_STATUTS_FACTURE, totalDu, nbRetard,
  });
});

// --- Nouvelle facture ----------------------------------------------------------------------------
router.get('/nouvelle', (req, res) => {
  const entreprises = bd.prepare('SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0 ORDER BY raison_sociale').all(res.locals.cabinetId);
  res.render('factures/formulaire', {
    erreur: null, facture: { client_id: req.query.client || '', date_emission: aujourdhui(), numero_facture: prochainNumero(res.locals.cabinetId) },
    entreprises, polices: [], NOMS_STATUTS_FACTURE,
  });
});

// Polices d'une entreprise (pour le formulaire, via fetch)
router.get('/polices-entreprise/:clientId', (req, res) => {
  const polices = bd.prepare(`
    SELECT id, numero_police, ligne, assureur FROM polices
    WHERE client_id = ? AND cabinet_id = ? AND statut != 'resiliee' ORDER BY numero_police
  `).all(req.params.clientId, res.locals.cabinetId);
  res.json(polices);
});

router.post('/', (req, res) => {
  const erreurs = validerFacture(req.body);
  const client = bd.prepare('SELECT id FROM clients WHERE id = ? AND cabinet_id = ?').get(Number(req.body.client_id), res.locals.cabinetId);
  if (!client) erreurs.push('Entreprise invalide.');
  let policeId = null;
  if (req.body.police_id) {
    const police = bd.prepare('SELECT id, client_id FROM polices WHERE id = ? AND cabinet_id = ?').get(Number(req.body.police_id), res.locals.cabinetId);
    if (!police) erreurs.push('Police invalide.');
    else if (client && police.client_id !== client.id) erreurs.push('La police ne appartient pas à cette entreprise.');
    else policeId = police.id;
  }
  if (erreurs.length) {
    const entreprises = bd.prepare('SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0 ORDER BY raison_sociale').all(res.locals.cabinetId);
    return res.status(400).render('factures/formulaire', {
      erreur: erreurs.join(' '), facture: req.body, entreprises, polices: [], NOMS_STATUTS_FACTURE,
    });
  }
  const r = bd.prepare(`
    INSERT INTO factures (cabinet_id, client_id, police_id, numero_facture, description, montant,
      date_emission, date_echeance, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, client.id, policeId, prochainNumero(res.locals.cabinetId),
    req.body.description.trim(), Number(req.body.montant), req.body.date_emission,
    req.body.date_echeance, (req.body.notes || '').trim() || null);
  recalculerFacture(r.lastInsertRowid, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'facture_creee', `Facture id ${r.lastInsertRowid} (entreprise id ${client.id}, ${req.body.montant} $)`);
  res.redirect('/factures/' + r.lastInsertRowid);
});

// --- Fiche --------------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const facture = factureDuCabinet(req.params.id, res.locals.cabinetId);
  if (!facture) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Facture introuvable.' });
  const paiements = bd.prepare('SELECT * FROM paiements WHERE facture_id = ? ORDER BY date_paiement DESC').all(facture.id);
  const solde = Number(facture.montant) - Number(facture.montant_paye);
  res.render('factures/fiche', {
    facture, paiements, solde, NOMS_STATUTS_FACTURE, NOMS_MODES, MODES,
    joursRetard: facture.statut === 'en_retard' ? joursRetard(facture.date_echeance) : 0,
    mPaiement: req.query.paiement === 'ok',
  });
});

// --- Enregistrer un paiement -----------------------------------------------------------------------
router.post('/:id/paiements', (req, res) => {
  const facture = factureDuCabinet(req.params.id, res.locals.cabinetId);
  if (!facture) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Facture introuvable.' });
  if (facture.statut === 'annulee') {
    return res.status(400).render('erreur', { titre: 'Facture annulée', message: 'On ne peut pas enregistrer de paiement sur une facture annulée.' });
  }
  const montant = Number(req.body.montant);
  if (!montant || isNaN(montant) || montant <= 0) {
    return res.status(400).render('erreur', { titre: 'Montant invalide', message: 'Le montant du paiement doit être supérieur à 0.' });
  }
  if (!estDateValide(req.body.date_paiement)) {
    return res.status(400).render('erreur', { titre: 'Date invalide', message: 'La date de paiement est invalide (AAAA-MM-JJ).' });
  }
  const mode = MODES.includes(req.body.mode) ? req.body.mode : 'virement';
  bd.prepare('INSERT INTO paiements (facture_id, montant, date_paiement, mode, notes) VALUES (?, ?, ?, ?, ?)')
    .run(facture.id, montant, req.body.date_paiement, mode, (req.body.notes || '').trim() || null);
  recalculerFacture(facture.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'paiement_enregistre', `Paiement de ${montant} $ sur facture id ${facture.id}`);
  res.redirect('/factures/' + facture.id + '?paiement=ok');
});

// --- Annuler une facture -----------------------------------------------------------------------------
router.post('/:id/annuler', (req, res) => {
  const facture = factureDuCabinet(req.params.id, res.locals.cabinetId);
  if (!facture) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Facture introuvable.' });
  bd.prepare("UPDATE factures SET statut = 'annulee' WHERE id = ? AND cabinet_id = ?").run(facture.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'facture_annulee', `Facture id ${facture.id} annulée`);
  res.redirect('/factures/' + facture.id);
});

// --- Générer une relance (brouillon IA, jamais d'envoi auto) --------------------------------------------
router.post('/:id/relance', async (req, res) => {
  const facture = factureDuCabinet(req.params.id, res.locals.cabinetId);
  if (!facture) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Facture introuvable.' });
  const solde = Number(facture.montant) - Number(facture.montant_paye);
  if (solde <= 0.005) {
    return res.status(400).render('erreur', { titre: 'Facture soldée', message: 'Cette facture est déjà soldée, aucune relance nécessaire.' });
  }
  const client = {
    prenom: facture.client_prenom, nom: facture.client_nom,
    raison_sociale: facture.entreprise, titre_contact: null,
  };
  const { sujet, contenu, source } = await genererBrouillonRelance({
    client, facture, joursRetard: joursRetard(facture.date_echeance), nomCourtier: req.utilisateur.nom,
  });
  const r = bd.prepare(`
    INSERT INTO brouillons (cabinet_id, facture_id, type, sujet, contenu, statut)
    VALUES (?, ?, 'relance', ?, ?, 'brouillon')
  `).run(res.locals.cabinetId, facture.id, sujet, contenu);
  journal(res.locals.cabinetId, req.utilisateur.id, 'relance_generee',
    `Brouillon de relance (source : ${source}) pour facture ${facture.numero_facture}`);
  res.redirect('/brouillons/' + r.lastInsertRowid);
});

module.exports = router;
module.exports.NOMS_STATUTS_FACTURE = NOMS_STATUTS_FACTURE;
module.exports.marquerRetards = marquerRetards;
module.exports.recalculerFacture = recalculerFacture;
