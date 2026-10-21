/**
 * routes/echeances.js — Tableau de bord des renouvellements (J-90 / J-60 / J-30)
 * et fiche de révision par police (prime totale, protections, manquantes).
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange,
  clausePortefeuille, clientHorsPortefeuille, reponseHorsPortefeuille } = require('../lib/middleware');
const { NOMS_LIGNES, NOMS_STATUTS } = require('./polices');
const { NOMS_RC, NOMS_PROTECTION_B, AVENANTS_FAQ } = require('./auto');
const {
  NOMS_TYPE_CONSTRUCTION, NOMS_TYPE_CONTENU, NOMS_FORMULE, AVENANTS_BIENS,
} = require('./biens');
const { marquerRetards } = require('./factures');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

function joursRestants(dateEcheance) {
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const ech = new Date(dateEcheance + 'T00:00:00');
  return Math.round((ech - auj) / 86400000);
}

function policesAvecEcheance(req, cabinetId) {
  const polices = bd.prepare(`
    SELECT p.*, c.raison_sociale AS client_raison_sociale, c.prenom AS client_prenom, c.nom AS client_nom,
           (SELECT COALESCE(SUM(prime), 0) FROM police_protections pp WHERE pp.police_id = p.id) AS prime_totale
    FROM polices p JOIN clients c ON c.id = p.client_id
    WHERE p.cabinet_id = ? AND p.statut != 'resiliee' AND c.archive = 0${clausePortefeuille(req, 'c')}
    ORDER BY p.date_echeance
  `).all(cabinetId);
  return polices.map((p) => ({ ...p, jours: joursRestants(p.date_echeance) }));
}

function aujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

// --- Tableau de bord ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const polices = policesAvecEcheance(req, res.locals.cabinetId);
  const echus = polices.filter((p) => p.jours < 0);
  const j30 = polices.filter((p) => p.jours >= 0 && p.jours <= 30);
  const j60 = polices.filter((p) => p.jours > 30 && p.jours <= 60);
  const j90 = polices.filter((p) => p.jours > 60 && p.jours <= 90);
  const plusLoin = polices.filter((p) => p.jours > 90);

  const nbEntreprises = bd.prepare('SELECT COUNT(*) AS n FROM clients WHERE cabinet_id = ? AND archive = 0' + clausePortefeuille(req, 'clients')).get(res.locals.cabinetId).n;
  const nbPolices = bd.prepare(`SELECT COUNT(*) AS n FROM polices p JOIN clients c ON c.id = p.client_id WHERE p.cabinet_id = ? AND c.archive = 0${clausePortefeuille(req, 'c')}`).get(res.locals.cabinetId).n;
  const nbBrouillons = bd.prepare("SELECT COUNT(*) AS n FROM brouillons WHERE cabinet_id = ? AND statut = 'brouillon' AND archive = 0").get(res.locals.cabinetId).n;

  // Réclamations avec rappel dépassé
  const rappelsRec = bd.prepare(`
    SELECT r.id, r.date_rappel, r.numero_reclamation, c.raison_sociale AS entreprise
    FROM reclamations r JOIN clients c ON c.id = r.client_id
    WHERE r.cabinet_id = ? AND r.date_rappel IS NOT NULL AND r.date_rappel < ?
      AND r.statut = 'ouverte' AND r.archive = 0${clausePortefeuille(req, 'c')}
    ORDER BY r.date_rappel
  `).all(res.locals.cabinetId, aujourdhui());

  // Tâches en retard (non terminées, échéance dépassée)
  const pfTaches = req.utilisateur && req.utilisateur.role === 'courtier'
    ? ` AND (t.entreprise_id IS NULL OR c.responsable_id = ${Number(req.utilisateur.id)})` : '';
  const tachesRetard = bd.prepare(`
    SELECT t.id, t.titre, t.date_echeance, u.nom AS assigne_nom
    FROM taches t LEFT JOIN users u ON u.id = t.assigne_a
    LEFT JOIN clients c ON c.id = t.entreprise_id
    WHERE t.cabinet_id = ? AND t.statut != 'terminee' AND t.archive = 0
      AND t.date_echeance IS NOT NULL AND t.date_echeance < ?${pfTaches}
    ORDER BY t.date_echeance
  `).all(res.locals.cabinetId, aujourdhui());
  const nbTachesRetard = tachesRetard.length;

  // Comptes en retard (factures échues non soldées)
  marquerRetards(res.locals.cabinetId);
  const comptesRetard = bd.prepare(`
    SELECT f.id, f.numero_facture, f.date_echeance, (f.montant - f.montant_paye) AS solde,
           c.raison_sociale AS entreprise
    FROM factures f JOIN clients c ON c.id = f.client_id
    WHERE f.cabinet_id = ? AND f.statut = 'en_retard'${clausePortefeuille(req, 'c')}
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
  // Courriels rattachés à cette police (classement intelligent par numéro
  // de police, ou liaison manuelle depuis le module Courriels).
  const courrielsLies = bd.prepare(`
    SELECT id, dossier, expediteur, destinataires, sujet, date_courriel, cree_le, classement_methode
    FROM courriels WHERE cabinet_id = ? AND police_id = ? AND archive = 0
    ORDER BY cree_le DESC
  `).all(cabinetId, police.id);
  // Vérifications d'avenants déjà faites sur cette police + pièces jointes
  // des courriels liés (sources possibles d'une nouvelle vérification).
  const verifAvenant = require('../lib/verification-avenant');
  const verificationsPolice = verifAvenant.listerVerificationsPolice(cabinetId, police.id);
  const piecesJointesPolice = verifAvenant.piecesJointesPolice(cabinetId, police.id);
  const { NOMS_RECLAMATION } = require('./reclamations');
  const reclamations = bd.prepare(`
    SELECT id, numero_reclamation, date_sinistre, statut, montant_reclame
    FROM reclamations WHERE police_id = ? ORDER BY date_sinistre DESC
  `).all(police.id);
  const { versionsPolice } = require('./polices');
  const versions = versionsPolice(police.id);

  // Police auto FPQ1 : données figées à la conversion + état courant (avenants).
  let fpq1Donnees = null;
  if (police.ligne === 'auto' && police.auto_soumission_id) {
    const fpq1 = require('../lib/fpq1');
    const versionFige = police.auto_soumission_version
      ? fpq1.obtenirVersion(police.auto_soumission_id, police.auto_soumission_version, cabinetId)
      : null;
    const live = fpq1.obtenirSoumission(police.auto_soumission_id, cabinetId);
    fpq1Donnees = { versionFige, live, NOMS_RC, NOMS_PROTECTION_B, AVENANTS_FAQ };
  }

  // Police biens : données figées à la conversion + état courant (avenants).
  let biensDonnees = null;
  if (police.ligne === 'biens' && police.biens_soumission_id) {
    const biens = require('../lib/biens');
    const versionFige = police.biens_soumission_version
      ? biens.obtenirVersion(police.biens_soumission_id, police.biens_soumission_version, cabinetId)
      : null;
    const live = biens.obtenirSoumission(police.biens_soumission_id, cabinetId);
    biensDonnees = {
      versionFige, live, NOMS_TYPE_CONSTRUCTION, NOMS_TYPE_CONTENU, NOMS_FORMULE, AVENANTS_BIENS,
    };
  }

  // Police RC (CGL) : données figées à la conversion + état courant (avenants).
  let rcDonnees = null;
  if (police.ligne === 'cgl' && police.rc_soumission_id) {
    const rc = require('../lib/rc');
    const versionFige = police.rc_soumission_version
      ? rc.obtenirVersion(police.rc_soumission_id, police.rc_soumission_version, cabinetId)
      : null;
    const live = rc.obtenirSoumission(police.rc_soumission_id, cabinetId);
    const r = require('./rc');
    rcDonnees = {
      versionFige, live,
      NOMS_SOUS_TRAITANT: r.NOMS_SOUS_TRAITANT,
      NOMS_FORMULE_RC: r.NOMS_FORMULE_RC,
      AVENANTS_RC: r.AVENANTS_RC,
    };
  }

  // Police cyber : données figées à la conversion + état courant (avenants).
  let cyberDonnees = null;
  if (police.ligne === 'cyber' && police.cyber_soumission_id) {
    const cyber = require('../lib/cyber');
    const versionFige = police.cyber_soumission_version
      ? cyber.obtenirVersion(police.cyber_soumission_id, police.cyber_soumission_version, cabinetId)
      : null;
    const live = cyber.obtenirSoumission(police.cyber_soumission_id, cabinetId);
    const c = require('./cyber');
    cyberDonnees = {
      versionFige, live,
      NOMS_TYPE_MESURE: c.NOMS_TYPE_MESURE,
      NOMS_STATUT_MESURE: c.NOMS_STATUT_MESURE,
      AVENANTS_CYBER: c.AVENANTS_CYBER,
    };
  }

  // Police E&O : données figées à la conversion + état courant (avenants).
  let eoDonnees = null;
  if (police.ligne === 'eo' && police.eo_soumission_id) {
    const eo = require('../lib/eo');
    const versionFige = police.eo_soumission_version
      ? eo.obtenirVersion(police.eo_soumission_id, police.eo_soumission_version, cabinetId)
      : null;
    const live = eo.obtenirSoumission(police.eo_soumission_id, cabinetId);
    const e = require('./eo');
    eoDonnees = {
      versionFige, live,
      NOMS_BASE_GARANTIE: e.NOMS_BASE_GARANTIE,
      AVENANTS_EO: e.AVENANTS_EO,
    };
  }

  // Police D&O : données figées à la conversion + état courant (avenants).
  let doDonnees = null;
  if (police.ligne === 'do' && police.do_soumission_id) {
    const dosoum = require('../lib/do');
    const versionFige = police.do_soumission_version
      ? dosoum.obtenirVersion(police.do_soumission_id, police.do_soumission_version, cabinetId)
      : null;
    const live = dosoum.obtenirSoumission(police.do_soumission_id, cabinetId);
    const d = require('./do');
    doDonnees = {
      versionFige, live,
      NOMS_BASE_GARANTIE: d.NOMS_BASE_GARANTIE,
      AVENANTS_DO: d.AVENANTS_DO,
    };
  }

  // Police perte d'exploitation : données figées à la conversion + état courant (avenants).
  let peDonnees = null;
  if (police.ligne === 'perte_exploitation' && police.pe_soumission_id) {
    const pesoum = require('../lib/pe');
    const versionFige = police.pe_soumission_version
      ? pesoum.obtenirVersion(police.pe_soumission_id, police.pe_soumission_version, cabinetId)
      : null;
    const live = pesoum.obtenirSoumission(police.pe_soumission_id, cabinetId);
    const pe = require('./pe');
    peDonnees = {
      versionFige, live,
      NOMS_PERIODE_INDEMNITE: pe.NOMS_PERIODE_INDEMNITE,
      NOMS_BASE_MONTANT: pe.NOMS_BASE_MONTANT,
      AVENANTS_PE: pe.AVENANTS_PE,
    };
  }

  // Police flotte : données figées à la conversion + état courant (avenants)
  // + avenants FAQ usuels absents du snapshot figé (protections non souscrites).
  let flotteDonnees = null;
  if (police.ligne === 'flotte' && police.flotte_soumission_id) {
    const flotteSoum = require('../lib/flotte');
    const versionFige = police.flotte_soumission_version
      ? flotteSoum.obtenirVersion(police.flotte_soumission_id, police.flotte_soumission_version, cabinetId)
      : null;
    const live = flotteSoum.obtenirSoumission(police.flotte_soumission_id, cabinetId);
    const f = require('./flotte');
    const fig = (versionFige && versionFige.donnees) || {};
    const avenantsFiges = (fig.garanties && fig.garanties.avenants) || {};
    const vehiculesFiges = fig.vehicules || [];
    const conducteursFiges = fig.conducteurs || [];
    const anneeCourante = new Date().getFullYear();
    const faqManquants = [];
    if (!avenantsFiges.faq34 && conducteursFiges.length) {
      faqManquants.push({ code: 'faq34', libelle: 'FAQ 34 — Indemnités d’accident',
        raison: `${conducteursFiges.length} conducteur(s) au dossier sans indemnités d’accident.` });
    }
    const recents = vehiculesFiges.filter((v) => (v.type_vehicule === 'camion' || v.type_vehicule === 'automobile')
      && v.annee && v.annee >= anneeCourante - 3);
    if (!avenantsFiges.faq43 && recents.length) {
      faqManquants.push({ code: 'faq43', libelle: 'FAQ 43 — Valeur à neuf',
        raison: `${recents.length} véhicule(s) récent(s) (camion/automobile) sans valeur à neuf.` });
    }
    if (!avenantsFiges.faq20 && vehiculesFiges.length) {
      faqManquants.push({ code: 'faq20', libelle: 'FAQ 20 — Privation de jouissance',
        raison: 'Aucun véhicule de remplacement prévu en cas d’immobilisation d’un véhicule de la flotte.' });
    }
    if (!avenantsFiges.faq27 && vehiculesFiges.some((v) => v.conducteur_principal_nom)) {
      faqManquants.push({ code: 'faq27', libelle: 'FAQ 27 — Véhicule loué ou n’appartenant pas à l’assuré',
        raison: 'Des véhicules sont conduits par des conducteurs non nommés (« selon affectation ») ou loués.' });
    }
    flotteDonnees = {
      versionFige, live,
      NOMS_USAGES_DOMINANTS: f.NOMS_USAGES_DOMINANTS,
      NOMS_TYPES_VEHICULE: f.NOMS_TYPES_VEHICULE,
      NOMS_USAGES_VEHICULE: f.NOMS_USAGES_VEHICULE,
      AVENANTS_FAQ: f.AVENANTS_FAQ,
      faqManquants,
    };
  }

  // Police cautionnement : données figées à la conversion + état courant (avenants)
  // + alertes métier sur le snapshot figé (protections non souscrites).
  let cautDonnees = null;
  if (police.ligne === 'cautionnement' && police.caut_soumission_id) {
    const cautSoum = require('../lib/cautionnement');
    const versionFige = police.caut_soumission_version
      ? cautSoum.obtenirVersion(police.caut_soumission_id, police.caut_soumission_version, cabinetId)
      : null;
    const live = cautSoum.obtenirSoumission(police.caut_soumission_id, cabinetId);
    const c = require('./cautionnement');
    const fig = (versionFige && versionFige.donnees) || {};
    const obligationsFigees = fig.obligations || [];
    const ligneFigee = fig.garanties || null;
    const typesFiges = new Set(obligationsFigees.map((o) => o.type).filter(Boolean));
    const manqueTypes = [];
    if (typesFiges.has('execution') && !typesFiges.has('paiement_mo')) {
      manqueTypes.push({ code: 'CAUT-MO', libelle: 'Main-d’œuvre et matériaux',
        raison: 'Un cautionnement d’exécution est en vigueur sans cautionnement de paiement de la main-d’œuvre et des matériaux : les sous-traitants et fournisseurs impayés pourraient se retourner contre la police.' });
    }
    if (typesFiges.has('soumission') && !typesFiges.has('execution')) {
      manqueTypes.push({ code: 'CAUT-EXEC', libelle: 'Cautionnement d’exécution',
        raison: 'Un cautionnement de soumission a été émis sans cautionnement d’exécution prévu : si la soumission est retenue, il faudra monter le cautionnement d’exécution (50 % du contrat) avant la signature.' });
    }
    if (ligneFigee && ligneFigee.limite_par_projet != null) {
      const depasse = obligationsFigees.filter((o) =>
        o.montant_cautionnement != null && Number(o.montant_cautionnement) > Number(ligneFigee.limite_par_projet));
      if (depasse.length) {
        manqueTypes.push({ code: 'CAUT-LIGNE', libelle: 'Capacité de la ligne',
          raison: `${depasse.length} obligation(s) figée(s) dépasse(nt) la limite par projet de la ligne — la capacité pourrait ne pas couvrir le montant demandé.` });
      }
    }
    cautDonnees = {
      versionFige, live,
      NOMS_TYPES_OBLIGATION: c.NOMS_TYPES_OBLIGATION,
      manqueTypes,
    };
  }

  return { police, protections, primeTotale, manquantes, catalogue, brouillons, documents, documentsArchives, courrielsLies, verificationsPolice, piecesJointesPolice, reclamations, versions, fpq1Donnees, biensDonnees, rcDonnees, cyberDonnees, eoDonnees, doDonnees, peDonnees, flotteDonnees, cautDonnees, NOMS_RECLAMATION, jours: joursRestants(police.date_echeance) };
}

router.get('/police/:id', (req, res) => {
  const fiche = ficheRevision(req.params.id, res.locals.cabinetId);
  if (!fiche) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Police introuvable.' });
  if (clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, fiche.police.client_id)) return reponseHorsPortefeuille(res);
  const { NOMS_STATUTS_VERIF } = require('./verifications-avenants');
  res.render('echeances/revision', { ...fiche, NOMS_LIGNES, NOMS_STATUTS, NOMS_STATUTS_VERIF });
});

module.exports = router;
module.exports.ficheRevision = ficheRevision;
module.exports.joursRestants = joursRestants;
