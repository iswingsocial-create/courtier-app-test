/**
 * routes/echeances.js — Tableau de bord des renouvellements (J-90 / J-60 / J-30)
 * et fiche de révision par police (prime totale, protections, manquantes).
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange } = require('../lib/middleware');
const { NOMS_LIGNES, NOMS_STATUTS } = require('./polices');
const { marquerRetards } = require('./factures');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

function joursRestants(dateEcheance) {
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const ech = new Date(dateEcheance + 'T00:00:00');
  return Math.round((ech - auj) / 86400000);
}

function policesAvecEcheance(cabinetId) {
  const polices = bd.prepare(`
    SELECT p.*, c.raison_sociale AS client_raison_sociale, c.prenom AS client_prenom, c.nom AS client_nom,
           (SELECT COALESCE(SUM(prime), 0) FROM police_protections pp WHERE pp.police_id = p.id) AS prime_totale
    FROM polices p JOIN clients c ON c.id = p.client_id
    WHERE p.cabinet_id = ? AND p.statut != 'resiliee' AND c.archive = 0
    ORDER BY p.date_echeance
  `).all(cabinetId);
  return polices.map((p) => ({ ...p, jours: joursRestants(p.date_echeance) }));
}

function aujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

// --- Tableau de bord ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const polices = policesAvecEcheance(res.locals.cabinetId);
  const echus = polices.filter((p) => p.jours < 0);
  const j30 = polices.filter((p) => p.jours >= 0 && p.jours <= 30);
  const j60 = polices.filter((p) => p.jours > 30 && p.jours <= 60);
  const j90 = polices.filter((p) => p.jours > 60 && p.jours <= 90);
  const plusLoin = polices.filter((p) => p.jours > 90);

  const nbEntreprises = bd.prepare('SELECT COUNT(*) AS n FROM clients WHERE cabinet_id = ? AND archive = 0').get(res.locals.cabinetId).n;
  const nbPolices = bd.prepare(`SELECT COUNT(*) AS n FROM polices p JOIN clients c ON c.id = p.client_id WHERE p.cabinet_id = ? AND c.archive = 0`).get(res.locals.cabinetId).n;
  const nbBrouillons = bd.prepare("SELECT COUNT(*) AS n FROM brouillons WHERE cabinet_id = ? AND statut = 'brouillon' AND archive = 0").get(res.locals.cabinetId).n;

  // Réclamations avec rappel dépassé
  const rappelsRec = bd.prepare(`
    SELECT r.id, r.date_rappel, r.numero_reclamation, c.raison_sociale AS entreprise
    FROM reclamations r JOIN clients c ON c.id = r.client_id
    WHERE r.cabinet_id = ? AND r.date_rappel IS NOT NULL AND r.date_rappel < ?
      AND r.statut = 'ouverte' AND r.archive = 0
    ORDER BY r.date_rappel
  `).all(res.locals.cabinetId, aujourdhui());

  // Tâches en retard (non terminées, échéance dépassée)
  const tachesRetard = bd.prepare(`
    SELECT t.id, t.titre, t.date_echeance, u.nom AS assigne_nom
    FROM taches t LEFT JOIN users u ON u.id = t.assigne_a
    WHERE t.cabinet_id = ? AND t.statut != 'terminee' AND t.archive = 0
      AND t.date_echeance IS NOT NULL AND t.date_echeance < ?
    ORDER BY t.date_echeance
  `).all(res.locals.cabinetId, aujourdhui());
  const nbTachesRetard = tachesRetard.length;

  // Comptes en retard (factures échues non soldées)
  marquerRetards(res.locals.cabinetId);
  const comptesRetard = bd.prepare(`
    SELECT f.id, f.numero_facture, f.date_echeance, (f.montant - f.montant_paye) AS solde,
           c.raison_sociale AS entreprise
    FROM factures f JOIN clients c ON c.id = f.client_id
    WHERE f.cabinet_id = ? AND f.statut = 'en_retard'
    ORDER BY f.date_echeance
  `).all(res.locals.cabinetId);
  const totalRetard = comptesRetard.reduce((s, f) => s + Number(f.solde), 0);

  // Réunions à venir (7 prochains jours)
  const maintenant = new Date().toISOString().slice(0, 16);
  const dans7j = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16);
  const reunionsAVenir = bd.prepare(`
    SELECT r.id, r.titre, r.date_heure, r.lien_teams, c.raison_sociale AS entreprise, l.nom AS lead_nom
    FROM reunions r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN leads l ON l.id = r.lead_id
    WHERE r.cabinet_id = ? AND r.statut = 'planifiee' AND r.date_heure >= ? AND r.date_heure < ? AND r.archive = 0
    ORDER BY r.date_heure LIMIT 10
  `).all(res.locals.cabinetId, maintenant, dans7j);

  res.render('echeances/tableau', {
    echus, j30, j60, j90, plusLoin,
    stats: { nbClients: nbEntreprises, nbPolices, nbBrouillons, nbTachesRetard },
    rappelsRec, tachesRetard, comptesRetard, totalRetard, reunionsAVenir,
    NOMS_LIGNES, NOMS_STATUTS,
    mMdp: req.query.mdp === 'ok',
  });
});

// --- Fiche de révision d'une police ------------------------------------------------------------------------
function ficheRevision(policeId, cabinetId) {
  const police = bd.prepare(`
    SELECT p.*, c.raison_sociale AS client_raison_sociale, c.prenom AS client_prenom, c.nom AS client_nom,
           c.courriel AS client_courriel, c.telephone AS client_telephone, c.langue AS client_langue,
           u.nom AS responsable_nom
    FROM polices p JOIN clients c ON c.id = p.client_id
    LEFT JOIN users u ON u.id = p.responsable_id
    WHERE p.id = ? AND p.cabinet_id = ?
  `).get(policeId, cabinetId);
  if (!police) return null;

  const protections = bd.prepare('SELECT * FROM police_protections WHERE police_id = ? ORDER BY code').all(police.id);
  const primeTotale = protections.reduce((s, p) => s + Number(p.prime), 0);

  // Protections recommandées du catalogue qui manquent sur cette police
  const codes = protections.map((p) => p.code);
  const recommandees = bd.prepare('SELECT code, libelle FROM catalogue_protections WHERE ligne = ? AND recommandee = 1').all(police.ligne);
  const manquantes = recommandees.filter((r) => !codes.includes(r.code));

  const catalogue = bd.prepare('SELECT code, libelle FROM catalogue_protections WHERE ligne = ? ORDER BY code').all(police.ligne);
  const brouillons = bd.prepare('SELECT * FROM brouillons WHERE police_id = ? AND archive = 0 ORDER BY cree_le DESC').all(police.id);
  const documents = bd.prepare('SELECT * FROM documents WHERE police_id = ? AND archive = 0 ORDER BY televerse_le DESC').all(police.id);
  const documentsArchives = bd.prepare('SELECT * FROM documents WHERE police_id = ? AND archive = 1 ORDER BY televerse_le DESC').all(police.id);
  const { NOMS_RECLAMATION } = require('./reclamations');
  const reclamations = bd.prepare(`
    SELECT id, numero_reclamation, date_sinistre, statut, montant_reclame
    FROM reclamations WHERE police_id = ? ORDER BY date_sinistre DESC
  `).all(police.id);
  const { versionsPolice } = require('./polices');
  const versions = versionsPolice(police.id);

  return { police, protections, primeTotale, manquantes, catalogue, brouillons, documents, documentsArchives, reclamations, versions, NOMS_RECLAMATION, jours: joursRestants(police.date_echeance) };
}

router.get('/police/:id', (req, res) => {
  const fiche = ficheRevision(req.params.id, res.locals.cabinetId);
  if (!fiche) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });
  res.render('echeances/revision', { ...fiche, NOMS_LIGNES, NOMS_STATUTS });
});

module.exports = router;
module.exports.ficheRevision = ficheRevision;
module.exports.joursRestants = joursRestants;
