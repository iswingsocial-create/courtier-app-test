/**
 * routes/registre-police.js — Registre complet d'une police, alimenté
 * par les documents réels (2026-10-21) :
 *  - assureurs PARTICIPANTS d'une souscription partagée (parts en % par
 *    section de garantie, contrat-cadre du grossiste, responsabilité
 *    proportionnelle) ;
 *  - FINANCEMENT de prime : paramètres + échéancier de prélèvements
 *    calculé, versements suivis un à un ;
 *  - ATTESTATION d'assurance commerciale : génération du certificat au
 *    format du cabinet, avec trace de chaque émission.
 * Monté sur /polices APRÈS routes/polices.js (chemins distincts).
 * Cloisonnement par cabinet_id sur toutes les requêtes.
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, journal,
  clientHorsPortefeuille, reponseHorsPortefeuille } = require('../lib/middleware');
const { NOMS_LIGNES } = require('./polices');
const ajust = require('../lib/ajustements-documents');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

function policeDuCabinet(id, cabinetId) {
  return bd.prepare(`
    SELECT p.*, c.raison_sociale AS client_raison_sociale
    FROM polices p JOIN clients c ON c.id = p.client_id
    WHERE p.id = ? AND p.cabinet_id = ?
  `).get(id, cabinetId);
}

function chargerPolice(req, res) {
  const police = policeDuCabinet(req.params.id, res.locals.cabinetId);
  if (!police) {
    res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });
    return null;
  }
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, police.client_id)) {
    reponseHorsPortefeuille(res);
    return null;
  }
  return police;
}

function participantsPolice(policeId) {
  return bd.prepare('SELECT * FROM police_participants WHERE police_id = ? AND archive = 0 ORDER BY section, part_pct DESC')
    .all(policeId);
}

function financementPolice(policeId) {
  const f = bd.prepare('SELECT * FROM police_financements WHERE police_id = ? AND archive = 0 ORDER BY id DESC')
    .get(policeId);
  if (!f) return null;
  let payes = [];
  try { payes = JSON.parse(f.versements_payes || '[]'); } catch (e) { payes = []; }
  return { ...f, versements_payes: payes };
}

// --- Registre complet ---------------------------------------------------
router.get('/:id/registre', (req, res) => {
  const police = chargerPolice(req, res);
  if (!police) return;
  const participants = participantsPolice(police.id);
  const validation = ajust.validerParticipants(participants);
  const financement = financementPolice(police.id);
  let echeancier = null;
  let prochain = null;
  if (financement) {
    echeancier = ajust.genererEcheancier(financement);
    prochain = ajust.prochainPrelevement(financement, new Date().toISOString().slice(0, 10));
  }
  const certificats = bd.prepare('SELECT * FROM certificats_emis WHERE police_id = ? AND archive = 0 ORDER BY emis_le DESC, id DESC')
    .all(police.id);
  res.render('polices/registre', {
    police, participants, validation, financement, echeancier, prochain, certificats,
    NOMS_LIGNES, MODES_FACTURATION: ajust.MODES_FACTURATION,
    SECTIONS_PARTICIPANTS: ajust.SECTIONS_PARTICIPANTS,
  });
});

// --- Participants ---------------------------------------------------------
router.post('/:id/participants', (req, res) => {
  const police = chargerPolice(req, res);
  if (!police) return;
  const nom = String(req.body.assureur_nom || '').trim();
  if (!nom) return res.status(400).render('erreur', { titre: 'Nom requis', message: 'Le nom de l’assureur participant est requis.' });
  const part = Number(req.body.part_pct);
  if (isNaN(part) || part <= 0 || part > 100) {
    return res.status(400).render('erreur', { titre: 'Part invalide', message: 'La part doit être un pourcentage entre 0 et 100.' });
  }
  bd.prepare(`
    INSERT INTO police_participants (cabinet_id, police_id, section, assureur_nom, numero_contrat, part_pct, prime_part, representant)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, police.id, String(req.body.section || '').trim() || null,
    nom, String(req.body.numero_contrat || '').trim() || null, part,
    req.body.prime_part === '' || req.body.prime_part == null ? null : Number(req.body.prime_part),
    String(req.body.representant || '').trim() || null);
  // Dès qu'un participant existe, la police est en souscription partagée.
  bd.prepare('UPDATE polices SET responsabilite_proportionnelle = 1 WHERE id = ? AND cabinet_id = ?')
    .run(police.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'participant_ajoute',
    `Participant ${nom} (${part} %) sur police id ${police.id}`);
  res.redirect('/polices/' + police.id + '/registre');
});

router.post('/:id/participants/:pid/retirer', (req, res) => {
  const police = chargerPolice(req, res);
  if (!police) return;
  // Règle d'or : on archive, on ne supprime pas.
  bd.prepare('UPDATE police_participants SET archive = 1 WHERE id = ? AND police_id = ? AND cabinet_id = ?')
    .run(req.params.pid, police.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'participant_archive',
    `Participant id ${req.params.pid} archivé sur police id ${police.id}`);
  res.redirect('/polices/' + police.id + '/registre');
});

// --- Financement de prime ---------------------------------------------------
router.post('/:id/financement', (req, res) => {
  const police = chargerPolice(req, res);
  if (!police) return;
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const primeBrute = num(req.body.prime_brute);
  const acompte = num(req.body.acompte);
  let montantFinance = num(req.body.montant_finance);
  if (montantFinance == null && primeBrute != null) montantFinance = primeBrute - (acompte || 0);
  const valeurs = [
    String(req.body.numero_cotation || '').trim() || null,
    String(req.body.organisme || '').trim() || null,
    num(req.body.taux_annuel), primeBrute, acompte, montantFinance,
    num(req.body.nb_versements), num(req.body.montant_versement),
    req.body.premiere_date || null,
  ];
  const existant = financementPolice(police.id);
  if (existant) {
    bd.prepare(`
      UPDATE police_financements SET numero_cotation = ?, organisme = ?, taux_annuel = ?,
        prime_brute = ?, acompte = ?, montant_finance = ?, nb_versements = ?,
        montant_versement = ?, premiere_date = ?
      WHERE id = ? AND cabinet_id = ?
    `).run(...valeurs, existant.id, res.locals.cabinetId);
  } else {
    bd.prepare(`
      INSERT INTO police_financements (cabinet_id, police_id, numero_cotation, organisme,
        taux_annuel, prime_brute, acompte, montant_finance, nb_versements,
        montant_versement, premiere_date, versements_payes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
    `).run(res.locals.cabinetId, police.id, ...valeurs);
  }
  journal(res.locals.cabinetId, req.utilisateur.id, 'financement_enregistre',
    `Financement de prime sur police id ${police.id} (cotation ${req.body.numero_cotation || '—'})`);
  res.redirect('/polices/' + police.id + '/registre');
});

router.post('/:id/financement/paiement', (req, res) => {
  const police = chargerPolice(req, res);
  if (!police) return;
  const financement = financementPolice(police.id);
  if (!financement) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Aucun financement sur cette police.' });
  const numero = Number(req.body.numero);
  const payes = new Set(financement.versements_payes.map(Number));
  if (req.body.paye === '1') payes.add(numero); else payes.delete(numero);
  bd.prepare('UPDATE police_financements SET versements_payes = ? WHERE id = ? AND cabinet_id = ?')
    .run(JSON.stringify([...payes].sort((a, b) => a - b)), financement.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'financement_paiement',
    `Versement ${numero} du financement police id ${police.id} : ${req.body.paye === '1' ? 'payé' : 'à payer'}`);
  res.redirect('/polices/' + police.id + '/registre');
});

// --- Attestation d'assurance commerciale -------------------------------------
const MENTIONS_DEFAUT = [
  'La présente attestation est émise à titre d’information seulement et ne confère aucun droit à son détenteur. Elle n’amende, n’étend ni ne modifie la couverture prévue aux polices qui y sont décrites.',
  'Les polices décrites ci-dessus sont assujetties à l’ensemble de leurs conditions, limitations et exclusions. En cas de divergence, le texte des polices prévaut.',
  'Le courtier s’engage à aviser le détenteur du certificat en cas d’annulation ou de modification importante des polices décrites, selon les conditions de préavis prévues aux polices ou exigées par le bénéficiaire désigné.',
];

function donneesAttestation(police, cabinetId) {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?')
    .get(police.client_id, cabinetId);
  const cabinet = bd.prepare('SELECT * FROM cabinets WHERE id = ?').get(cabinetId);
  const protections = bd.prepare('SELECT * FROM police_protections WHERE police_id = ? ORDER BY code').all(police.id);
  let emplacements = [];
  let beneficiaires = [];
  if (police.biens_soumission_id) {
    emplacements = bd.prepare('SELECT * FROM biens_batiments WHERE soumission_id = ? AND archive = 0 ORDER BY id')
      .all(police.biens_soumission_id);
    if (emplacements.length) {
      beneficiaires = bd.prepare(`
        SELECT b.* FROM emplacement_beneficiaires b
        WHERE b.batiment_id IN (${emplacements.map(() => '?').join(',')}) AND b.archive = 0
      `).all(...emplacements.map((e) => e.id));
    }
  }
  return { client, cabinet, protections, emplacements, beneficiaires };
}

router.get('/:id/attestation-commerciale', (req, res) => {
  const police = chargerPolice(req, res);
  if (!police) return;
  const d = donneesAttestation(police, res.locals.cabinetId);
  res.render('polices/attestation-commerciale', {
    police, ...d, NOMS_LIGNES, impression: false, saisie: {}, MENTIONS_DEFAUT,
  });
});

router.post('/:id/attestation-commerciale', (req, res) => {
  const police = chargerPolice(req, res);
  if (!police) return;
  const d = donneesAttestation(police, res.locals.cabinetId);
  const saisie = {
    destinataire: String(req.body.destinataire || '').trim(),
    signataire_nom: String(req.body.signataire_nom || '').trim(),
    signataire_titre: String(req.body.signataire_titre || '').trim(),
    initiales: String(req.body.initiales || '').trim(),
    mentions: String(req.body.mentions || '').trim(),
    date_emission: new Date().toISOString().slice(0, 10),
  };
  const r = bd.prepare(`
    INSERT INTO certificats_emis (cabinet_id, police_id, type, destinataire, signataire_nom,
      signataire_titre, initiales, donnees_json, emis_par, emis_le)
    VALUES (?, ?, 'attestation', ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, police.id, saisie.destinataire || null, saisie.signataire_nom || null,
    saisie.signataire_titre || null, saisie.initiales || null,
    JSON.stringify(saisie), req.utilisateur.id, saisie.date_emission);
  journal(res.locals.cabinetId, req.utilisateur.id, 'attestation_emise',
    `Attestation d’assurance commerciale (id ${r.lastInsertRowid}) pour police id ${police.id}`);
  res.render('polices/attestation-commerciale', {
    police, ...d, NOMS_LIGNES, impression: true, saisie, MENTIONS_DEFAUT,
  });
});

module.exports = router;
module.exports.participantsPolice = participantsPolice;
module.exports.financementPolice = financementPolice;
module.exports.MENTIONS_DEFAUT = MENTIONS_DEFAUT;
