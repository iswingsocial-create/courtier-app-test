/**
 * routes/exports.js — Exports CSV / JSON par module (étape 5/10).
 * Backups et pont vers les plateformes BMS (formats standards, pas propriétaires).
 *
 * Conventions : séparateur « ; », BOM UTF-8, en-têtes en français (dictionnaire
 * des champs), dates ISO. Les archivés sont exclus par défaut (case à cocher).
 * Périmètre : admin/manager/adjoint = tout le cabinet ; courtier = son
 * portefeuille uniquement (clausePortefeuille). Aucun secret n'est exporté
 * (pas de module utilisateurs/comptes courriels/jetons).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');

const bd = require('../lib/bd');
const DICT = require('../lib/dictionnaire-champs.json');
const { exigeAuth, exigeMotDePasseChange, verifieCsrf, journal, clausePortefeuille } = require('../lib/middleware');
const { NOMS_LIGNES } = require('./polices');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

// --- Limitation douce : évite le pompage -------------------------------------
const limiteurExports = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop d’exports. Réessayez dans quelques minutes.',
});
router.use(limiteurExports);

// --- Libellés français du dictionnaire ---------------------------------------
const LIBELLES = {};
for (const t of DICT.tables) {
  LIBELLES[t.nom] = {};
  for (const c of t.colonnes) LIBELLES[t.nom][c.nom] = c.libelle;
}
const lib = (table, col, defaut) => (LIBELLES[table] && LIBELLES[table][col]) || defaut || col;

// --- Helpers ------------------------------------------------------------------
const echapperCsv = (v) => {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const versCsv = (entetes, lignes) =>
  '﻿' + [entetes.join(';'), ...lignes.map((l) => l.map(echapperCsv).join(';'))].join('\r\n');

const parseJson = (s, defaut) => {
  if (s === null || s === undefined || s === '') return defaut;
  try { return JSON.parse(s); } catch (e) { return defaut; }
};
// Convention unifiée (UI, import, proposition, seed) : clés COURTES, 1 = présent.
// Les clés longues historiques (seed écrit avant 2026-10-19) restent acceptées en lecture.
const CLEFS_AVENANTS = ['faq43', 'faq20', 'faq27', 'faq34', 'faq5a'];
const CLEFS_AVENANTS_LONGUES = {
  faq43: 'faq43_valeur_a_neuf',
  faq20: 'faq20_privation_jouissance',
  faq27: 'faq27_vehicule_non_appartenant',
  faq34: 'faq34_assurance_personnes',
  faq5a: 'faq5a_credit_bail',
};
const LIBELLES_AVENANTS = {
  faq43: 'Avenant FAQ 43 (valeur à neuf)',
  faq20: 'Avenant FAQ 20 (privation de jouissance)',
  faq27: 'Avenant FAQ 27 (véhicule non appartenant)',
  faq34: 'Avenant FAQ 34 (assurance de personnes)',
  faq5a: 'Avenant FAQ 5a (crédit-bail)',
};
const boolAvenant = (avenants, code) =>
  (avenants && (avenants[code] || avenants[CLEFS_AVENANTS_LONGUES[code]]) ? 1 : 0);
const TYPES_CONSENTEMENT = ['communications', 'partage_assureur', 'marketing'];
const LIBELLES_CONSENTEMENT = {
  communications: 'Consentement — recevoir nos communications',
  partage_assureur: 'Consentement — partage avec les assureurs',
  marketing: 'Consentement — offres et infolettres',
};
// Biens (étape 5/10 biens) : avenants par bâtiment — clés COURTES, 1 = présent
// (même convention que l'UI routes/biens.js).
const AVENANTS_BIENS = [
  ['tremblement_terre', 'Avenant — tremblement de terre'],
  ['inondation', 'Avenant — inondation'],
  ['refoulement_egout', 'Avenant — refoulement d’égout'],
  ['bris_machines', 'Avenant — bris de machines'],
  ['perte_exploitation_liee', 'Avenant — perte d’exploitation liée'],
];
const boolAvenantBiens = (avenants, code) => (avenants && avenants[code] ? 1 : 0);
const NOMS_FORMULE_BIENS = { tous_risques: 'Tous risques', risques_designes: 'Risques désignés' };
const TYPES_CONSENTEMENT_BIENS = ['credit', 'dossier_assurance'];
const LIBELLES_CONSENTEMENT_BIENS = {
  credit: 'Consentement crédit',
  dossier_assurance: 'Consentement dossier d’assurance',
};
const NOMS_STATUT_BIENS = { brouillon: 'Brouillon', soumise: 'Soumise', convertie_police: 'Convertie en police' };
const nomProduit = (code) => NOMS_LIGNES[code] || code;

function consentementsClient(clientId) {
  const lignes = bd.prepare('SELECT type, accepte FROM consentements WHERE client_id = ?').all(clientId);
  const r = {};
  for (const t of TYPES_CONSENTEMENT) {
    const l = lignes.find((x) => x.type === t);
    r[t] = l ? Number(l.accepte) : 0;
  }
  return r;
}

// RC commerciale (étape 5/10 RC) : avenants par lieu — clés, 1 = présent
// (même convention que l'UI routes/rc.js).
const AVENANTS_RC = [
  ['pollution', 'Avenant — pollution'],
  ['parapluie', 'Avenant — parapluie'],
];
const boolAvenantRc = (avenants, code) => (avenants && avenants[code] ? 1 : 0);
const NOMS_FORMULE_RC = {
  locaux_operations: 'Locaux et opérations',
  produits_completes: 'Produits et opérations complétées',
  globale: 'Globale',
};
const NOMS_SOUS_TRAITANT_RC = { aucun: 'Aucun', assures: 'Assurés', non_assures: 'Non assurés' };
const NOMS_STATUT_RC = { brouillon: 'Brouillon', soumise: 'Soumise', convertie_police: 'Convertie en police' };
const TYPES_CONSENTEMENT_RC = ['credit', 'dossier_assurance'];
const LIBELLES_CONSENTEMENT_RC = {
  credit: 'Consentement crédit',
  dossier_assurance: 'Consentement dossier d’assurance',
};

// Cyber / cyberrisques (étape 5/10 cyber) : mesures illimitées, garanties et
// avenants par soumission — clés, 1 = présent (même convention que l'UI
// routes/cyber.js).
const AVENANTS_CYBER = [
  ['rancongiciel', 'Avenant — rançongiciel'],
  ['fraude_transfert', 'Avenant — fraude par transfert de fonds'],
  ['donnees_vie_privee', 'Avenant — données et vie privée'],
  ['interruption', 'Avenant — interruption d’activité'],
];
const boolAvenantCyber = (avenants, code) => (avenants && avenants[code] ? 1 : 0);
const NOMS_TYPE_MESURE = {
  mfa: 'MFA — authentification multifacteur',
  sauvegardes: 'Sauvegardes',
  antivirus_edr: 'Antivirus / EDR',
  pare_feu: 'Pare-feu',
  formation_hameconnage: 'Formation anti-hameçonnage',
  plan_reponse_incident: 'Plan de réponse aux incidents',
  chiffrement: 'Chiffrement',
  gestion_correctifs: 'Gestion des correctifs',
  controle_acces: 'Contrôle d’accès',
  autre: 'Autre',
};
const NOMS_STATUT_MESURE = { en_place: 'En place', partiel: 'Partiel', absent: 'Absent', prevu: 'Prévu' };
const NOMS_STATUT_CYBER = { brouillon: 'Brouillon', soumise: 'Soumise', convertie_police: 'Convertie en police' };
const TYPES_CONSENTEMENT_CYBER = ['credit', 'dossier_assurance'];
const LIBELLES_CONSENTEMENT_CYBER = {
  credit: 'Consentement crédit',
  dossier_assurance: 'Consentement dossier d’assurance',
};

// E&O — responsabilité professionnelle (étape 5/10 E&O) : activités
// professionnelles illimitées, garanties et avenants par soumission — clés,
// 1 = présent (même convention que l'UI routes/eo.js).
const AVENANTS_EO = [
  ['frais_defense', 'Avenant — frais de défense'],
  ['medias_contenu', 'Avenant — médias et contenu'],
  ['cyber_associe', 'Avenant — cyber associé'],
];
const boolAvenantEo = (avenants, code) => (avenants && avenants[code] ? 1 : 0);
const NOMS_BASE_EO = { reclamations_presentees: 'Réclamations-présentées', occurrences: 'Occurrences' };
const NOMS_STATUT_EO = { brouillon: 'Brouillon', soumise: 'Soumise', convertie_police: 'Convertie en police' };
const TYPES_CONSENTEMENT_EO = ['credit', 'dossier_assurance'];
const LIBELLES_CONSENTEMENT_EO = {
  credit: 'Dossier de crédit',
  dossier_assurance: 'Dossier d’assurance (sinistres antérieurs)',
};

// D&O — administrateurs et dirigeants (étape 5/10 D&O) : dirigeants en nombre
// illimité, garanties et avenants par soumission — clés, 1 = présent
// (même convention que l'UI routes/do.js).
const AVENANTS_DO = [
  ['frais_defense', 'Avenant — frais de défense'],
  ['pratiques_emploi', 'Avenant — pratiques d’emploi'],
  ['fidelite_crime', 'Avenant — fidélité / crime'],
];
const boolAvenantDo = (avenants, code) => (avenants && avenants[code] ? 1 : 0);
const NOMS_BASE_DO = { reclamations_presentees: 'Réclamations-présentées', occurrences: 'Occurrences' };
const NOMS_STATUT_DO = { brouillon: 'Brouillon', soumise: 'Soumise', convertie_police: 'Convertie en police' };
const TYPES_CONSENTEMENT_DO = ['credit', 'dossier_assurance'];
const LIBELLES_CONSENTEMENT_DO = {
  credit: 'Dossier de crédit',
  dossier_assurance: 'Dossier d’assurance (sinistres antérieurs)',
};

// Perte d'exploitation (étape 5/10 PE) : établissements en nombre illimité,
// garanties et avenants par soumission — clés, 1 = présent
// (même convention que l'UI routes/pe.js).
const AVENANTS_PE = [
  ['frais_supplementaires', 'Avenant — frais supplémentaires'],
  ['dependance_fournisseurs', 'Avenant — dépendance aux fournisseurs'],
  ['acces_civil', 'Avenant — accès civil'],
  ['deterioration_stocks', 'Avenant — détérioration des stocks'],
];
const boolAvenantPe = (avenants, code) => (avenants && avenants[code] ? 1 : 0);
const NOMS_BASE_PE = { benefice_brut: 'Bénéfice brut', marge_brute: 'Marge brute', chiffre_affaires: "Chiffre d'affaires" };
const NOMS_PERIODE_PE = { 12: '12 mois', 18: '18 mois', 24: '24 mois' };
const NOMS_BASE_VALEUR_PE = { remplacement: 'Coût de remplacement', depreciation: 'Valeur dépréciée' };
const NOMS_STATUT_PE = { brouillon: 'Brouillon', soumise: 'Soumise', convertie_police: 'Convertie en police' };
const TYPES_CONSENTEMENT_PE = ['credit', 'dossier_assurance'];
const LIBELLES_CONSENTEMENT_PE = {
  credit: 'Consentement crédit',
  dossier_assurance: 'Consentement dossier d’assurance',
};

// Flotte automobile (étape 5/10 flotte) : véhicules et conducteurs en nombre
// illimité, garanties (avenants FAQ, clés courtes partagées avec FPQ1) et
// antécédents par soumission — mêmes conventions que l'UI routes/flotte.js.
// Choix des modules (3, comme PE) : les deux collections illimitées ont
// chacune leur module plat (flotte_vehicules, flotte_conducteurs — miroir de
// biens_batiments + biens_contenus) et l'historique figé est exporté DANS
// flotte_soumissions (versions imbriquées en JSON, comme le module polices
// imbrique police_versions) ; le CSV des soumissions porte version_courante
// et nb_versions.
const NOMS_TYPE_VEHICULE_FLOTTE = {
  camion: 'Camion', automobile: 'Automobile', remorque: 'Remorque', equipement: 'Équipement',
};
const NOMS_USAGE_FLOTTE = {
  livraison: 'Livraison', service: 'Service',
  transport_marchandises: 'Transport de marchandises', personnel: 'Personnel',
};
const NOMS_USAGE_DOMINANT_FLOTTE = { ...NOMS_USAGE_FLOTTE, mixte: 'Mixte' };
const NOMS_STATUT_FLOTTE = { brouillon: 'Brouillon', soumise: 'Soumise', convertie_police: 'Convertie en police' };
const TYPES_CONSENTEMENT_FLOTTE = ['credit', 'dossier_saaq', 'fcsa'];
const LIBELLES_CONSENTEMENT_FLOTTE = {
  credit: 'Consentement crédit',
  dossier_saaq: 'Consentement dossier SAAQ',
  fcsa: 'Consentement FCSA',
};
// Consentement actif ? (format plat {code:1} de l'UI, ou format semé
// {code:{accepte:true}} — même tolérance que routes/flotte.js).
const consentementFlotte = (cons, code) => {
  if (!cons) return 0;
  const v = cons[code];
  return (v === 1 || v === true || (v && v.accepte)) ? 1 : 0;
};

// Cautionnement (étape 5/10 cautionnement) : obligations en nombre illimité,
// ligne de cautionnement UNIQUE par soumission et antécédents par soumission —
// mêmes conventions que l'UI routes/cautionnement.js. Choix des modules (3) :
// les obligations illimitées ont leur module plat (caut_obligations, miroir de
// flotte_vehicules), l'en-tête porte la ligne APLATIE et les antécédents
// (caut_soumissions, versions imbriquées en JSON) et l'historique figé a son
// module dédié (caut_versions, miroir du module police_versions).
const NOMS_TYPE_OBLIGATION_CAUT = {
  soumission: 'Cautionnement de soumission (bid bond)',
  execution: 'Cautionnement d’exécution (performance bond)',
  paiement_mo: 'Paiement de la main-d’œuvre et des matériaux',
  rbq: 'Cautionnement de licence RBQ',
  autre: 'Autre cautionnement',
};
const NOMS_STATUT_CAUT = { brouillon: 'Brouillon', soumise: 'Soumise', convertie_police: 'Convertie en police' };
const TYPES_CONSENTEMENT_CAUT = ['credit', 'etats_financiers'];
const LIBELLES_CONSENTEMENT_CAUT = {
  credit: 'Consentement crédit',
  etats_financiers: 'Consentement états financiers',
};
// Consentement actif ? (format plat {code:1} de l'UI, ou format semé
// {code:{accepte:true}} — même tolérance que routes/cautionnement.js).
const consentementCaut = (cons, code) => {
  if (!cons) return 0;
  const v = cons[code];
  return (v === 1 || v === true || (v && v.accepte)) ? 1 : 0;
};
const nbDepuisJson = (s) => {
  const v = parseJson(s, []);
  return Array.isArray(v) ? v.length : 0;
};

// --- Définition des modules ----------------------------------------------------
const MODULES = [
  {
    cle: 'entreprises', titre: 'Entreprises', archive: true,
    description: 'Fiches entreprises (clients) avec consentements Loi 25.',
    sql: (inclureArchives) => `
      SELECT c.*, u.nom AS responsable_nom,
        (SELECT COUNT(*) FROM contacts WHERE client_id = c.id AND archive = 0) AS nb_contacts
      FROM clients c LEFT JOIN users u ON u.id = c.responsable_id
      WHERE c.cabinet_id = ?${inclureArchives ? '' : ' AND c.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['raison_sociale', lib('clients', 'raison_sociale')], ['neq', lib('clients', 'neq')],
      ['secteur_activite', lib('clients', 'secteur_activite')], ['courriel_entreprise', 'Courriel entreprise'],
      ['telephone_entreprise', 'Téléphone entreprise'], ['prenom', 'Prénom du contact'], ['nom', 'Nom du contact'],
      ['titre_contact', 'Titre du contact'], ['courriel', 'Courriel du contact'], ['telephone', 'Téléphone du contact'],
      ['adresse', lib('clients', 'adresse')], ['ville', lib('clients', 'ville')], ['code_postal', 'Code postal'],
      ['langue', lib('clients', 'langue')], ['notes', lib('clients', 'notes')],
      ['responsable_nom', 'Courtier responsable'], ['nb_contacts', 'Nb de contacts'],
      ...TYPES_CONSENTEMENT.map((t) => ['consentement_' + t, LIBELLES_CONSENTEMENT[t]]),
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => {
      const cons = consentementsClient(r.id);
      return { ...r, ...Object.fromEntries(TYPES_CONSENTEMENT.map((t) => ['consentement_' + t, cons[t]])) };
    },
    ligneJson: (r) => {
      const cons = consentementsClient(r.id);
      const contacts = bd.prepare('SELECT id, prenom, nom, titre, courriel, telephone, principal, archive, cree_le FROM contacts WHERE client_id = ?').all(r.id);
      const { responsable_nom, nb_contacts, ...champs } = r;
      return { ...champs, responsable_nom, consentements: cons, contacts };
    },
  },
  {
    cle: 'polices', titre: 'Polices', archive: false,
    description: 'Polices commerciales avec protections et prime totale (inclut les polices biens — ligne « Biens commerciaux »).',
    sql: () => `
      SELECT p.*, c.raison_sociale AS entreprise,
        (SELECT COALESCE(SUM(prime), 0) FROM police_protections WHERE police_id = p.id) AS prime_totale,
        (SELECT COUNT(*) FROM police_protections WHERE police_id = p.id) AS nb_protections,
        (SELECT json_group_array(json_object('code', code, 'libelle', libelle, 'prime', prime))
           FROM police_protections WHERE police_id = p.id) AS protections_json
      FROM polices p JOIN clients c ON c.id = p.client_id
      WHERE p.cabinet_id = ?`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY p.numero_police',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['numero_police', lib('polices', 'numero_police')], ['entreprise', 'Entreprise'],
      ['ligne', 'Produit'], ['assureur', lib('polices', 'assureur')], ['date_effet', 'Date d’effet'],
      ['date_echeance', 'Date d’échéance'], ['franchise', lib('polices', 'franchise')], ['statut', lib('polices', 'statut')],
      ['notes', lib('polices', 'notes')], ['prime_totale', 'Prime totale'], ['nb_protections', 'Nb de protections'],
      ['protections_json', 'Protections (JSON)'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => ({ ...r, ligne: nomProduit(r.ligne) }),
    ligneJson: (r) => {
      const protections = parseJson(r.protections_json, []) || [];
      const versions = bd.prepare('SELECT id, version, date_effet, date_echeance, franchise, notes, avenant_note, protections_json, cree_le, cree_par FROM police_versions WHERE police_id = ? ORDER BY version').all(r.id)
        .map((v) => {
          const { protections_json: pj, ...champs } = v;
          return { ...champs, protections: parseJson(pj, []) };
        });
      const { protections_json, ...champs } = r;
      return { ...champs, protections, versions };
    },
  },
  {
    cle: 'police_versions', titre: 'Versions de polices (avenants)', archive: false,
    description: 'Historique figé des polices (v1, v2… — règle d’or).',
    sql: () => `
      SELECT pv.*, p.numero_police, c.raison_sociale AS entreprise, u.nom AS cree_par_nom
      FROM police_versions pv JOIN polices p ON p.id = pv.police_id
      JOIN clients c ON c.id = p.client_id
      LEFT JOIN users u ON u.id = pv.cree_par
      WHERE p.cabinet_id = ?`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY p.numero_police, pv.version',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['numero_police', 'N° de police'], ['entreprise', 'Entreprise'],
      ['version', lib('police_versions', 'version')], ['date_effet', 'Date d’effet'], ['date_echeance', 'Date d’échéance'],
      ['franchise', lib('police_versions', 'franchise')], ['notes', lib('police_versions', 'notes')],
      ['avenant_note', 'Note d’avenant'], ['protections_json', 'Protections (JSON)'],
      ['cree_par_nom', 'Créée par'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => r,
    ligneJson: (r) => {
      const { protections_json, ...champs } = r;
      return { ...champs, protections: parseJson(protections_json, []) };
    },
  },
  {
    cle: 'conducteurs', titre: 'Conducteurs auto (FPQ1)', archive: true,
    description: 'Conducteurs des soumissions auto, en nombre illimité.',
    sql: (inclureArchives) => `
      SELECT d.*, s.id AS soumission_id, c.raison_sociale AS entreprise
      FROM auto_conducteurs d JOIN auto_soumissions s ON s.id = d.soumission_id
      JOIN clients c ON c.id = s.client_id
      WHERE d.cabinet_id = ?${inclureArchives ? '' : ' AND d.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, d.nom, d.prenom',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['nom', 'Nom'], ['prenom', 'Prénom'], ['date_naissance', 'Date de naissance'], ['sexe', 'Sexe'],
      ['etat_civil', 'État civil'], ['numero_permis', 'N° de permis'], ['province_permis', 'Province du permis'],
      ['date_obtention_permis', 'Permis obtenu le'], ['annees_experience_ca', 'Expérience au Canada (ans)'],
      ['annees_experience_ailleurs', 'Expérience ailleurs (ans)'], ['lien_assure', 'Lien avec l’assuré'],
      ['telephone', 'Téléphone'], ['courriel', 'Courriel'], ['profession', 'Profession'], ['employeur', 'Employeur'],
      ['conducteur_principal', 'Conducteur principal'], ['vehicules_conduits', 'Véhicules conduits (JSON)'],
      ['infractions', 'Infractions (JSON)'], ['suspensions', 'Suspensions (JSON)'],
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => r,
    ligneJson: (r) => ({
      ...r,
      vehicules_conduits: parseJson(r.vehicules_conduits, []),
      infractions: parseJson(r.infractions, []),
      suspensions: parseJson(r.suspensions, []),
    }),
  },
  {
    cle: 'vehicules', titre: 'Véhicules auto (FPQ1)', archive: true,
    description: 'Véhicules des soumissions auto avec garanties et avenants.',
    sql: (inclureArchives) => `
      SELECT v.*, g.rc_montant, g.protection_b, g.franchise_b, g.prime, g.avenants AS avenants_json,
        s.id AS soumission_id, c.raison_sociale AS entreprise
      FROM auto_vehicules v JOIN auto_soumissions s ON s.id = v.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN auto_garanties g ON g.vehicule_id = v.id AND g.archive = 0
      WHERE v.cabinet_id = ?${inclureArchives ? '' : ' AND v.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, v.marque, v.modele',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['annee', 'Année'], ['marque', 'Marque'], ['modele', 'Modèle'], ['version_finition', 'Version'],
      ['vin', 'NIV'], ['carrosserie', 'Carrosserie'], ['neuf_occasion', 'Neuf / occasion'],
      ['date_achat', 'Date d’achat'], ['prix_achat', 'Prix d’achat'], ['valeur_estimee', 'Valeur estimée'],
      ['financement', 'Financement'], ['creancier_nom', 'Créancier'], ['creancier_courriel', 'Courriel créancier'],
      ['usage', 'Usage'], ['km_annuel', 'Km annuel'], ['pct_hors_quebec', '% hors Québec'],
      ['stationnement', 'Stationnement'], ['remisage_hiver', 'Remisage hiver'], ['modifications', 'Modifications (JSON)'],
      ['antivol_tag', 'Antivol TAG'], ['pneus_hiver', 'Pneus d’hiver'], ['remorque', 'Remorque'],
      ['remorque_details', 'Détails remorque (JSON)'],
      ['rc_montant', 'RC — montant'], ['protection_b', 'Protection B'], ['franchise_b', 'Franchise B'],
      ['prime', 'Prime'],
      ...CLEFS_AVENANTS.map((k) => ['avenant_' + k, LIBELLES_AVENANTS[k]]),
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => {
      const av = parseJson(r.avenants_json, {});
      return { ...r, ...Object.fromEntries(CLEFS_AVENANTS.map((k) => ['avenant_' + k, boolAvenant(av, k)])) };
    },
    ligneJson: (r) => {
      const { avenants_json, ...champs } = r;
      return {
        ...champs,
        modifications: parseJson(r.modifications, []),
        remorque_details: parseJson(r.remorque_details, {}),
        garanties: { rc_montant: r.rc_montant, protection_b: r.protection_b, franchise_b: r.franchise_b, prime: r.prime, avenants: parseJson(avenants_json, {}) },
      };
    },
  },
  {
    cle: 'soumissions', titre: 'Soumissions auto (FPQ1)', archive: true,
    description: 'Soumissions avec antécédents et décomptes.',
    sql: (inclureArchives) => `
      SELECT s.*, c.raison_sociale AS entreprise,
        a.assureur_actuel, a.numero_police_actuelle, a.date_expiration_actuelle, a.annees_assurance_continue,
        a.resiliation_ant, a.non_paiement_ant, a.faillite, a.casier_judiciaire,
        a.sinistres_6ans AS sinistres_6ans_json, a.consentements AS consentements_json,
        (SELECT COUNT(*) FROM auto_conducteurs WHERE soumission_id = s.id AND archive = 0) AS nb_conducteurs,
        (SELECT COUNT(*) FROM auto_vehicules WHERE soumission_id = s.id AND archive = 0) AS nb_vehicules,
        (SELECT COUNT(*) FROM auto_soumission_versions WHERE soumission_id = s.id) AS nb_versions
      FROM auto_soumissions s JOIN clients c ON c.id = s.client_id
      LEFT JOIN auto_antecedents a ON a.soumission_id = s.id AND a.archive = 0
      WHERE s.cabinet_id = ?${inclureArchives ? '' : ' AND s.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY s.cree_le DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['statut', lib('auto_soumissions', 'statut')],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', lib('auto_soumissions', 'notes')],
      ['nb_conducteurs', 'Nb conducteurs'], ['nb_vehicules', 'Nb véhicules'], ['nb_versions', 'Nb versions'],
      ['assureur_actuel', 'Assureur actuel'], ['numero_police_actuelle', 'Police actuelle'],
      ['date_expiration_actuelle', 'Expiration actuelle'], ['annees_assurance_continue', 'Années d’assurance continue'],
      ['resiliation_ant', 'Résiliation antérieure'], ['non_paiement_ant', 'Non-paiement antérieur'],
      ['faillite', 'Faillite'], ['casier_judiciaire', 'Casier judiciaire'],
      ['sinistres_6ans_json', 'Sinistres 6 ans (JSON)'],
      ['consentement_credit', 'Consentement crédit'], ['consentement_dossier_saaq', 'Consentement dossier SAAQ'],
      ['consentement_fcsa', 'Consentement FCSA'],
      ['archive', 'Archivé'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => {
      const cons = parseJson(r.consentements_json, {});
      const b = (k) => (cons[k] && cons[k].accepte ? 1 : 0);
      return { ...r, consentement_credit: b('credit'), consentement_dossier_saaq: b('dossier_saaq'), consentement_fcsa: b('fcsa') };
    },
    ligneJson: (r) => {
      const { sinistres_6ans_json, consentements_json, ...champs } = r;
      return { ...champs, sinistres_6ans: parseJson(sinistres_6ans_json, []), consentements: parseJson(consentements_json, {}) };
    },
  },
  {
    cle: 'reclamations', titre: 'Réclamations', archive: true,
    description: 'Sinistres avec montants, expert et suivis.',
    sql: (inclureArchives) => `
      SELECT r.*, c.raison_sociale AS entreprise, p.numero_police,
        (SELECT COUNT(*) FROM reclamation_suivis WHERE reclamation_id = r.id) AS nb_suivis
      FROM reclamations r JOIN clients c ON c.id = r.client_id
      LEFT JOIN polices p ON p.id = r.police_id
      WHERE r.cabinet_id = ?${inclureArchives ? '' : ' AND r.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY r.date_sinistre DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['numero_reclamation', 'N° de réclamation'], ['entreprise', 'Entreprise'],
      ['numero_police', 'N° de police'], ['date_sinistre', 'Date du sinistre'], ['date_declaration', 'Date de déclaration'],
      ['description', 'Description'], ['statut', lib('reclamations', 'statut')],
      ['montant_reclame', 'Montant réclamé'], ['montant_regle', 'Montant réglé'],
      ['franchise_appliquee', 'Franchise appliquée'], ['expert_nom', 'Expert'], ['expert_contact', 'Contact expert'],
      ['date_rappel', 'Date de rappel'], ['notes', 'Notes internes'], ['nb_suivis', 'Nb de suivis'],
      ['archive', 'Archivé'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => r,
    ligneJson: (r) => {
      const suivis = bd.prepare('SELECT id, user_id, texte, cree_le FROM reclamation_suivis WHERE reclamation_id = ? ORDER BY cree_le').all(r.id);
      const { nb_suivis, ...champs } = r;
      return { ...champs, suivis };
    },
  },
  {
    cle: 'factures', titre: 'Factures', archive: false,
    description: 'Factures avec paiements (annulation = statut, jamais supprimées).',
    sql: () => `
      SELECT f.*, c.raison_sociale AS entreprise, p.numero_police,
        (SELECT COUNT(*) FROM paiements WHERE facture_id = f.id) AS nb_paiements,
        (SELECT json_group_array(json_object('montant', montant, 'date_paiement', date_paiement, 'mode', mode))
           FROM paiements WHERE facture_id = f.id) AS paiements_json
      FROM factures f JOIN clients c ON c.id = f.client_id
      LEFT JOIN polices p ON p.id = f.police_id
      WHERE f.cabinet_id = ?`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY f.date_emission DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['numero_facture', lib('factures', 'numero_facture')], ['entreprise', 'Entreprise'],
      ['numero_police', 'N° de police'], ['description', lib('factures', 'description')],
      ['montant', lib('factures', 'montant')], ['montant_paye', 'Montant payé'],
      ['date_emission', 'Date d’émission'], ['date_echeance', 'Date d’échéance'], ['statut', lib('factures', 'statut')],
      ['notes', lib('factures', 'notes')], ['nb_paiements', 'Nb de paiements'], ['paiements_json', 'Paiements (JSON)'],
      ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => r,
    ligneJson: (r) => {
      const { paiements_json, nb_paiements, ...champs } = r;
      return { ...champs, paiements: parseJson(paiements_json, []) || [] };
    },
  },
  {
    cle: 'taches', titre: 'Tâches', archive: true,
    description: 'Tâches et rappels liés aux dossiers.',
    sql: (inclureArchives) => `
      SELECT t.*, c.raison_sociale AS entreprise, u.nom AS assigne_nom
      FROM taches t LEFT JOIN clients c ON c.id = t.entreprise_id
      LEFT JOIN users u ON u.id = t.assigne_a
      WHERE t.cabinet_id = ?${inclureArchives ? '' : ' AND t.archive = 0'}`,
    portee: (req) => {
      if (req.utilisateur.role !== 'courtier') return '';
      const uid = Number(req.utilisateur.id);
      return ` AND (c.responsable_id = ${uid} OR (t.entreprise_id IS NULL AND t.assigne_a = ${uid}))`;
    },
    ordre: 'ORDER BY t.date_echeance',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['titre', lib('taches', 'titre')], ['entreprise', 'Entreprise'],
      ['assigne_nom', 'Assignée à'], ['date_echeance', 'Échéance'], ['statut', lib('taches', 'statut')],
      ['notes', lib('taches', 'notes')], ['archive', 'Archivée'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => r,
    ligneJson: (r) => r,
  },
  {
    cle: 'leads', titre: 'Leads', archive: true,
    description: 'Prospects et pipeline de qualification.',
    sql: (inclureArchives) => `
      SELECT l.*, u.nom AS responsable_nom,
        (SELECT COUNT(*) FROM lead_suivis WHERE lead_id = l.id) AS nb_suivis
      FROM leads l LEFT JOIN users u ON u.id = l.responsable_id
      WHERE l.cabinet_id = ?${inclureArchives ? '' : ' AND l.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'l'),
    ordre: 'ORDER BY l.cree_le DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['nom', lib('leads', 'nom')], ['entreprise', 'Entreprise'],
      ['courriel', lib('leads', 'courriel')], ['telephone', lib('leads', 'telephone')],
      ['besoin', 'Besoin exprimé'], ['source', lib('leads', 'source')], ['campagne', lib('leads', 'campagne')],
      ['statut', lib('leads', 'statut')], ['responsable_nom', 'Responsable'],
      ['date_rappel', 'Rappel le'], ['notes', lib('leads', 'notes')], ['nb_suivis', 'Nb de suivis'],
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => r,
    ligneJson: (r) => {
      const suivis = bd.prepare('SELECT id, user_id, texte, cree_le FROM lead_suivis WHERE lead_id = ? ORDER BY cree_le').all(r.id);
      const { nb_suivis, ...champs } = r;
      return { ...champs, suivis };
    },
  },
  {
    cle: 'assureurs', titre: 'Assureurs', archive: true,
    description: 'Fiches assureurs avec produits offerts et taux de commission.',
    sql: (inclureArchives) => `
      SELECT a.*,
        (SELECT group_concat(produit, ', ') FROM assureur_produits WHERE assureur_id = a.id) AS produits_offerts,
        (SELECT json_group_array(json_object('produit', produit, 'commission_pct', commission_pct))
           FROM assureur_produits WHERE assureur_id = a.id) AS produits_json
      FROM assureurs a
      WHERE a.cabinet_id = ?${inclureArchives ? '' : ' AND a.archive = 0'}`,
    portee: () => '', // référentiel partagé du cabinet, sans données personnelles
    ordre: 'ORDER BY a.nom',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['nom', lib('assureurs', 'nom')], ['site_web', 'Site web'],
      ['telephone_general', 'Téléphone général'], ['courriel_general', 'Courriel général'],
      ['na_nom', 'Nouv. affaire — contact'], ['na_telephone', 'Nouv. affaire — téléphone'], ['na_courriel', 'Nouv. affaire — courriel'],
      ['mod_nom', 'Avenants — contact'], ['mod_telephone', 'Avenants — téléphone'], ['mod_courriel', 'Avenants — courriel'],
      ['compta_nom', 'Comptabilité — contact'], ['compta_telephone', 'Comptabilité — téléphone'], ['compta_courriel', 'Comptabilité — courriel'],
      ['notes', lib('assureurs', 'notes')],
      ['produits_offerts', 'Produits offerts'], ['produits_json', 'Produits et commissions (JSON)'],
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => {
      const produits = parseJson(r.produits_json, []) || [];
      return {
        ...r,
        produits_offerts: produits.map((p) => nomProduit(p.produit)).join(', '),
        produits_json: JSON.stringify(produits),
      };
    },
    ligneJson: (r) => {
      const { produits_json, produits_offerts, ...champs } = r;
      return { ...champs, produits: parseJson(produits_json, []) || [] };
    },
  },
  // --- Biens commerciaux (étape 5/10 biens) ----------------------------------
  {
    cle: 'biens_batiments', titre: 'Bâtiments (biens)', archive: true,
    description: 'Bâtiments des soumissions biens avec garanties et avenants.',
    sql: (inclureArchives) => `
      SELECT b.*, g.formule, g.franchise, g.montant_assurance, g.prime,
        g.avenants AS avenants_json,
        s.id AS soumission_id, c.raison_sociale AS entreprise
      FROM biens_batiments b JOIN biens_soumissions s ON s.id = b.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN biens_garanties g ON g.batiment_id = b.id AND g.cabinet_id = b.cabinet_id AND g.archive = 0
      WHERE b.cabinet_id = ?${inclureArchives ? '' : ' AND b.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, b.adresse',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['adresse', lib('biens_batiments', 'adresse')], ['ville', lib('biens_batiments', 'ville')],
      ['code_postal', lib('biens_batiments', 'code_postal')],
      ['type_construction', 'Type de construction'], ['annee_construction', 'Année de construction'],
      ['superficie_pi2', 'Superficie (pi²)'], ['nb_etages', 'Nb d’étages'], ['occupation', lib('biens_batiments', 'occupation')],
      ['valeur_batiment', 'Valeur du bâtiment'], ['gicleurs', 'Gicleurs'],
      ['distance_caserne_km', 'Distance caserne (km)'], ['chauffage', lib('biens_batiments', 'chauffage')],
      ['annee_toiture', 'Année de la toiture'], ['notes', lib('biens_batiments', 'notes')],
      ['formule', 'Formule de garantie'], ['franchise', 'Franchise'], ['montant_assurance', 'Montant d’assurance'],
      ['prime', 'Prime'],
      ...AVENANTS_BIENS.map(([code, label]) => ['avenant_' + code, label]),
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => {
      const av = parseJson(r.avenants_json, {});
      return {
        ...r,
        formule: r.formule ? (NOMS_FORMULE_BIENS[r.formule] || r.formule) : '',
        ...Object.fromEntries(AVENANTS_BIENS.map(([code]) => ['avenant_' + code, boolAvenantBiens(av, code)])),
      };
    },
    ligneJson: (r) => {
      const { avenants_json, formule, franchise, montant_assurance, prime, ...champs } = r;
      return {
        ...champs,
        garanties: {
          formule, franchise, montant_assurance, prime,
          avenants: parseJson(avenants_json, {}) || {},
        },
      };
    },
  },
  {
    cle: 'biens_contenus', titre: 'Contenus (biens)', archive: true,
    description: 'Contenus des soumissions biens (par bâtiment ou généraux).',
    sql: (inclureArchives) => `
      SELECT co.*, s.id AS soumission_id, c.raison_sociale AS entreprise,
        b.adresse AS batiment_adresse
      FROM biens_contenus co JOIN biens_soumissions s ON s.id = co.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN biens_batiments b ON b.id = co.batiment_id
      WHERE co.cabinet_id = ?${inclureArchives ? '' : ' AND co.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, co.description',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['batiment', 'Bâtiment rattaché'], ['description', lib('biens_contenus', 'description')],
      ['type_contenu', 'Type de contenu'], ['valeur', lib('biens_contenus', 'valeur')],
      ['notes', lib('biens_contenus', 'notes')],
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => ({ ...r, batiment: r.batiment_adresse || 'Contenu général' }),
    ligneJson: (r) => {
      const { batiment_adresse, ...champs } = r;
      return { ...champs, batiment_adresse };
    },
  },
  {
    cle: 'biens_soumissions', titre: 'Soumissions biens', archive: true,
    description: 'Soumissions biens avec antécédents et décomptes.',
    sql: (inclureArchives) => `
      SELECT s.*, c.raison_sociale AS entreprise,
        a.assureur_actuel, a.numero_police_actuelle, a.date_expiration_actuelle,
        a.annees_assurance_continue, a.sinistres_5ans AS sinistres_5ans_json,
        a.consentements AS consentements_json,
        (SELECT COUNT(*) FROM biens_batiments WHERE soumission_id = s.id AND archive = 0) AS nb_batiments,
        (SELECT COUNT(*) FROM biens_contenus WHERE soumission_id = s.id AND archive = 0) AS nb_contenus,
        (SELECT COUNT(*) FROM biens_soumission_versions WHERE soumission_id = s.id) AS nb_versions
      FROM biens_soumissions s JOIN clients c ON c.id = s.client_id
      LEFT JOIN biens_antecedents a ON a.soumission_id = s.id AND a.cabinet_id = s.cabinet_id AND a.archive = 0
      WHERE s.cabinet_id = ?${inclureArchives ? '' : ' AND s.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY s.cree_le DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['statut', lib('biens_soumissions', 'statut')],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', lib('biens_soumissions', 'notes')],
      ['nb_batiments', 'Nb bâtiments'], ['nb_contenus', 'Nb contenus'], ['nb_versions', 'Nb versions'],
      ['assureur_actuel', 'Assureur actuel'], ['numero_police_actuelle', 'Police actuelle'],
      ['date_expiration_actuelle', 'Expiration actuelle'], ['annees_assurance_continue', 'Années d’assurance continue'],
      ['sinistres_5ans_json', 'Sinistres 5 ans (JSON)'],
      ...TYPES_CONSENTEMENT_BIENS.map((t) => ['consentement_' + t, LIBELLES_CONSENTEMENT_BIENS[t]]),
      ['archive', 'Archivé'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => {
      const cons = parseJson(r.consentements_json, {});
      const b = (k) => (cons[k] ? 1 : 0);
      return {
        ...r,
        statut: NOMS_STATUT_BIENS[r.statut] || r.statut,
        ...Object.fromEntries(TYPES_CONSENTEMENT_BIENS.map((t) => ['consentement_' + t, b(t)])),
      };
    },
    ligneJson: (r) => {
      const { sinistres_5ans_json, consentements_json, ...champs } = r;
      return {
        ...champs,
        sinistres_5ans: parseJson(sinistres_5ans_json, []),
        consentements: parseJson(consentements_json, {}) || {},
      };
    },
  },
  {
    cle: 'biens_versions', titre: 'Versions de soumissions biens', archive: false,
    description: 'Historique figé des soumissions biens (v1, v2… — règle d’or).',
    sql: () => `
      SELECT v.*, s.id AS soumission_id, c.raison_sociale AS entreprise, u.nom AS auteur
      FROM biens_soumission_versions v JOIN biens_soumissions s ON s.id = v.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN users u ON u.id = v.cree_par
      WHERE v.cabinet_id = ?`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY v.soumission_id, v.version',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['soumission_id', 'Soumission (id)'], ['entreprise', 'Entreprise'],
      ['version', lib('biens_soumission_versions', 'version')], ['statut', 'Statut'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', lib('biens_soumission_versions', 'notes')],
      ['donnees', 'Données figées (JSON)'], ['auteur', 'Créée par'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => ({ ...r, statut: NOMS_STATUT_BIENS[r.statut] || r.statut }),
    ligneJson: (r) => {
      const { donnees, ...champs } = r;
      return { ...champs, donnees: parseJson(donnees, null) };
    },
  },
  // --- RC commerciale (étape 5/10 RC) ----------------------------------------
  {
    cle: 'rc_lieux', titre: "Lieux d'exploitation (RC)", archive: true,
    description: "Lieux d'exploitation des soumissions RC avec garanties et avenants.",
    sql: (inclureArchives) => `
      SELECT e.*, g.limite_par_sinistre, g.limite_agregat, g.franchise, g.formule, g.prime,
        g.avenants AS avenants_json,
        s.id AS soumission_id, c.raison_sociale AS entreprise
      FROM rc_exploitations e JOIN rc_soumissions s ON s.id = e.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN rc_garanties g ON g.exploitation_id = e.id AND g.cabinet_id = e.cabinet_id AND g.archive = 0
      WHERE e.cabinet_id = ?${inclureArchives ? '' : ' AND e.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, e.ville',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['adresse', 'Adresse'], ['ville', 'Ville'], ['code_postal', 'Code postal'],
      ['type_activite', 'Activité'], ['code_classification', 'Code de classification'],
      ['description_activites', 'Description des activités'],
      ['chiffre_affaires', 'Chiffre d’affaires'], ['masse_salariale', 'Masse salariale'],
      ['nb_employes', 'Nb d’employés'], ['superficie_pi2', 'Superficie (pi²)'],
      ['sous_traitants', 'Sous-traitants'], ['notes', 'Notes'],
      ['formule', 'Formule de garantie'], ['limite_par_sinistre', 'Limite par sinistre'],
      ['limite_agregat', 'Limite agrégat'], ['franchise', 'Franchise'], ['prime', 'Prime'],
      ...AVENANTS_RC.map(([code, label]) => ['avenant_' + code, label]),
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => {
      const av = parseJson(r.avenants_json, {});
      return {
        ...r,
        formule: r.formule ? (NOMS_FORMULE_RC[r.formule] || r.formule) : '',
        sous_traitants: r.sous_traitants ? (NOMS_SOUS_TRAITANT_RC[r.sous_traitants] || r.sous_traitants) : '',
        ...Object.fromEntries(AVENANTS_RC.map(([code]) => ['avenant_' + code, boolAvenantRc(av, code)])),
      };
    },
    ligneJson: (r) => {
      const { avenants_json, formule, limite_par_sinistre, limite_agregat, franchise, prime, ...champs } = r;
      return {
        ...champs,
        garanties: {
          formule, limite_par_sinistre, limite_agregat, franchise, prime,
          avenants: parseJson(avenants_json, {}) || {},
        },
      };
    },
  },
  {
    cle: 'rc_soumissions', titre: 'Soumissions RC', archive: true,
    description: 'Soumissions RC avec antécédents et décomptes.',
    sql: (inclureArchives) => `
      SELECT s.*, c.raison_sociale AS entreprise,
        a.assureur_actuel, a.numero_police_actuelle, a.date_expiration_actuelle,
        a.annees_assurance_continue, a.sinistres_5ans AS sinistres_5ans_json,
        a.consentements AS consentements_json,
        (SELECT COALESCE(MAX(version), 0) FROM rc_soumission_versions WHERE soumission_id = s.id) AS version_courante,
        (SELECT COUNT(*) FROM rc_exploitations WHERE soumission_id = s.id AND archive = 0) AS nb_lieux,
        (SELECT COUNT(*) FROM rc_soumission_versions WHERE soumission_id = s.id) AS nb_versions
      FROM rc_soumissions s JOIN clients c ON c.id = s.client_id
      LEFT JOIN rc_antecedents a ON a.soumission_id = s.id AND a.cabinet_id = s.cabinet_id AND a.archive = 0
      WHERE s.cabinet_id = ?${inclureArchives ? '' : ' AND s.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY s.cree_le DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['statut', 'Statut'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', 'Notes'],
      ['version_courante', 'Version courante'], ['nb_lieux', 'Nb lieux d’exploitation'], ['nb_versions', 'Nb versions'],
      ['assureur_actuel', 'Assureur actuel'], ['numero_police_actuelle', 'Police actuelle'],
      ['date_expiration_actuelle', 'Expiration actuelle'], ['annees_assurance_continue', 'Années d’assurance continue'],
      ['sinistres_5ans_json', 'Sinistres 5 ans (JSON)'],
      ...TYPES_CONSENTEMENT_RC.map((t) => ['consentement_' + t, LIBELLES_CONSENTEMENT_RC[t]]),
      ['archive', 'Archivé'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => {
      const cons = parseJson(r.consentements_json, {});
      const b = (k) => (cons[k] ? 1 : 0);
      return {
        ...r,
        statut: NOMS_STATUT_RC[r.statut] || r.statut,
        ...Object.fromEntries(TYPES_CONSENTEMENT_RC.map((t) => ['consentement_' + t, b(t)])),
      };
    },
    ligneJson: (r) => {
      const { sinistres_5ans_json, consentements_json, ...champs } = r;
      return {
        ...champs,
        sinistres_5ans: parseJson(sinistres_5ans_json, []),
        consentements: parseJson(consentements_json, {}) || {},
      };
    },
  },
  {
    cle: 'rc_versions', titre: 'Versions de soumissions RC', archive: false,
    description: 'Historique figé des soumissions RC (v1, v2… — règle d’or).',
    sql: () => `
      SELECT v.*, s.id AS soumission_id, c.raison_sociale AS entreprise, u.nom AS auteur
      FROM rc_soumission_versions v JOIN rc_soumissions s ON s.id = v.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN users u ON u.id = v.cree_par
      WHERE v.cabinet_id = ?`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY v.soumission_id, v.version',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['soumission_id', 'Soumission (id)'], ['entreprise', 'Entreprise'],
      ['version', 'Numéro de version'], ['statut', 'Statut'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', 'Notes'],
      ['donnees', 'Données figées (JSON)'], ['auteur', 'Créée par'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => ({ ...r, statut: NOMS_STATUT_RC[r.statut] || r.statut }),
    ligneJson: (r) => {
      const { donnees, ...champs } = r;
      return { ...champs, donnees: parseJson(donnees, null) };
    },
  },
  // --- Cyber / cyberrisques (étape 5/10 cyber) ---------------------------------
  {
    cle: 'cyber_mesures', titre: 'Mesures de sécurité (cyber)', archive: true,
    description: 'Mesures de sécurité des soumissions cyber, en nombre illimité, avec maturité.',
    sql: (inclureArchives) => `
      SELECT m.*, s.id AS soumission_id, c.raison_sociale AS entreprise
      FROM cyber_mesures m JOIN cyber_soumissions s ON s.id = m.soumission_id
      JOIN clients c ON c.id = s.client_id
      WHERE m.cabinet_id = ?${inclureArchives ? '' : ' AND m.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, m.type_mesure',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['type_mesure', 'Type de mesure'], ['maturite', 'Maturité'],
      ['details', lib('cyber_mesures', 'details')], ['notes', lib('cyber_mesures', 'notes')],
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => ({
      ...r,
      type_mesure: NOMS_TYPE_MESURE[r.type_mesure] || r.type_mesure,
      maturite: r.statut ? (NOMS_STATUT_MESURE[r.statut] || r.statut) : '',
    }),
    ligneJson: (r) => {
      const { statut, ...champs } = r;
      return { ...champs, maturite: statut };
    },
  },
  {
    cle: 'cyber_soumissions', titre: 'Soumissions cyber', archive: true,
    description: 'Soumissions cyber avec garanties, avenants et antécédents.',
    sql: (inclureArchives) => `
      SELECT s.*, c.raison_sociale AS entreprise,
        g.limite_par_sinistre, g.limite_agregat, g.franchise, g.delai_carence, g.prime,
        g.avenants AS avenants_json,
        a.assureur_actuel, a.numero_police_actuelle, a.date_expiration_actuelle,
        a.annees_assurance_continue, a.incidents_5ans AS incidents_5ans_json,
        a.consentements AS consentements_json,
        (SELECT COALESCE(MAX(version), 0) FROM cyber_soumission_versions WHERE soumission_id = s.id) AS version_courante,
        (SELECT COUNT(*) FROM cyber_mesures WHERE soumission_id = s.id AND archive = 0) AS nb_mesures,
        (SELECT COUNT(*) FROM cyber_soumission_versions WHERE soumission_id = s.id) AS nb_versions
      FROM cyber_soumissions s JOIN clients c ON c.id = s.client_id
      LEFT JOIN cyber_garanties g ON g.soumission_id = s.id AND g.cabinet_id = s.cabinet_id AND g.archive = 0
      LEFT JOIN cyber_antecedents a ON a.soumission_id = s.id AND a.cabinet_id = s.cabinet_id AND a.archive = 0
      WHERE s.cabinet_id = ?${inclureArchives ? '' : ' AND s.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY s.cree_le DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['statut', 'Statut'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', 'Notes'],
      ['version_courante', 'Version courante'], ['nb_mesures', 'Nb mesures de sécurité'], ['nb_versions', 'Nb versions'],
      ['limite_par_sinistre', 'Limite par sinistre'], ['limite_agregat', 'Limite agrégat'],
      ['franchise', 'Franchise'], ['delai_carence', 'Délai de carence'], ['prime', 'Prime'],
      ...AVENANTS_CYBER.map(([code, label]) => ['avenant_' + code, label]),
      ['assureur_actuel', 'Assureur actuel'], ['numero_police_actuelle', 'Police actuelle'],
      ['date_expiration_actuelle', 'Expiration actuelle'], ['annees_assurance_continue', 'Années d’assurance continue'],
      ['nb_incidents', 'Nb d’incidents 5 ans'], ['incidents_5ans_json', 'Incidents 5 ans (JSON)'],
      ...TYPES_CONSENTEMENT_CYBER.map((t) => ['consentement_' + t, LIBELLES_CONSENTEMENT_CYBER[t]]),
      ['archive', 'Archivé'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => {
      const cons = parseJson(r.consentements_json, {});
      const b = (k) => (cons[k] ? 1 : 0);
      const av = parseJson(r.avenants_json, {});
      const incidents = parseJson(r.incidents_5ans_json, []);
      return {
        ...r,
        statut: NOMS_STATUT_CYBER[r.statut] || r.statut,
        nb_incidents: Array.isArray(incidents) ? incidents.length : 0,
        ...Object.fromEntries(AVENANTS_CYBER.map(([code]) => ['avenant_' + code, boolAvenantCyber(av, code)])),
        ...Object.fromEntries(TYPES_CONSENTEMENT_CYBER.map((t) => ['consentement_' + t, b(t)])),
      };
    },
    ligneJson: (r) => {
      const { avenants_json, incidents_5ans_json, consentements_json, limite_par_sinistre, limite_agregat,
        franchise, delai_carence, prime, ...champs } = r;
      return {
        ...champs,
        garanties: {
          limite_par_sinistre, limite_agregat, franchise, delai_carence, prime,
          avenants: parseJson(avenants_json, {}) || {},
        },
        incidents_5ans: parseJson(incidents_5ans_json, []),
        consentements: parseJson(consentements_json, {}) || {},
      };
    },
  },
  {
    cle: 'cyber_versions', titre: 'Versions de soumissions cyber', archive: false,
    description: 'Historique figé des soumissions cyber (v1, v2… — règle d’or).',
    sql: () => `
      SELECT v.*, s.id AS soumission_id, c.raison_sociale AS entreprise, u.nom AS auteur
      FROM cyber_soumission_versions v JOIN cyber_soumissions s ON s.id = v.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN users u ON u.id = v.cree_par
      WHERE v.cabinet_id = ?`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY v.soumission_id, v.version',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['soumission_id', 'Soumission (id)'], ['entreprise', 'Entreprise'],
      ['version', 'Numéro de version'], ['statut', 'Statut'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', 'Notes'],
      ['donnees', 'Données figées (JSON)'], ['auteur', 'Créée par'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => ({ ...r, statut: NOMS_STATUT_CYBER[r.statut] || r.statut }),
    ligneJson: (r) => {
      const { donnees, ...champs } = r;
      return { ...champs, donnees: parseJson(donnees, null) };
    },
  },
  // --- E&O — responsabilité professionnelle (étape 5/10 E&O) --------------------
  {
    cle: 'eo_activites', titre: 'Activités professionnelles (E&O)', archive: true,
    description: 'Activités professionnelles des soumissions E&O, en nombre illimité (CA = exposition).',
    sql: (inclureArchives) => `
      SELECT a.*, s.id AS soumission_id, c.raison_sociale AS entreprise
      FROM eo_activites a JOIN eo_soumissions s ON s.id = a.soumission_id
      JOIN clients c ON c.id = s.client_id
      WHERE a.cabinet_id = ?${inclureArchives ? '' : ' AND a.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, a.description_activite',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['description_activite', 'Activité professionnelle'], ['chiffre_affaires', 'Chiffre d’affaires ($)'],
      ['nb_professionnels', 'Nb de professionnels'],
      ['notes', lib('eo_activites', 'notes')],
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => r,
    ligneJson: (r) => r,
  },
  {
    cle: 'eo_soumissions', titre: 'Soumissions E&O', archive: true,
    description: 'Soumissions E&O avec garanties, avenants et antécédents (base claims-made ou occurrences).',
    sql: (inclureArchives) => `
      SELECT s.*, c.raison_sociale AS entreprise,
        g.limite_par_sinistre, g.limite_agregat, g.franchise, g.base, g.prime,
        g.avenants AS avenants_json,
        a.assureur_actuel, a.numero_police_actuelle, a.date_expiration_actuelle,
        a.annees_assurance_continue, a.reclamations_5ans AS reclamations_5ans_json,
        a.circonstances, a.consentements AS consentements_json,
        (SELECT COALESCE(MAX(version), 0) FROM eo_soumission_versions WHERE soumission_id = s.id) AS version_courante,
        (SELECT COUNT(*) FROM eo_activites WHERE soumission_id = s.id AND archive = 0) AS nb_activites,
        (SELECT COUNT(*) FROM eo_soumission_versions WHERE soumission_id = s.id) AS nb_versions
      FROM eo_soumissions s JOIN clients c ON c.id = s.client_id
      LEFT JOIN eo_garanties g ON g.soumission_id = s.id AND g.cabinet_id = s.cabinet_id AND g.archive = 0
      LEFT JOIN eo_antecedents a ON a.soumission_id = s.id AND a.cabinet_id = s.cabinet_id AND a.archive = 0
      WHERE s.cabinet_id = ?${inclureArchives ? '' : ' AND s.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY s.cree_le DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['statut', 'Statut'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', 'Notes'],
      ['version_courante', 'Version courante'], ['nb_activites', 'Nb activités professionnelles'], ['nb_versions', 'Nb versions'],
      ['limite_par_sinistre', 'Limite par sinistre'], ['limite_agregat', 'Limite agrégat'],
      ['franchise', 'Franchise'], ['base', 'Base de garantie'], ['prime', 'Prime'],
      ...AVENANTS_EO.map(([code, label]) => ['avenant_' + code, label]),
      ['assureur_actuel', 'Assureur actuel'], ['numero_police_actuelle', 'Police actuelle'],
      ['date_expiration_actuelle', 'Expiration actuelle'], ['annees_assurance_continue', 'Années d’assurance continue'],
      ['nb_reclamations', 'Nb de réclamations 5 ans'], ['circonstances_presente', 'Circonstances déclarées'],
      ...TYPES_CONSENTEMENT_EO.map((t) => ['consentement_' + t, LIBELLES_CONSENTEMENT_EO[t]]),
      ['archive', 'Archivé'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => {
      const cons = parseJson(r.consentements_json, {});
      const b = (k) => (cons[k] ? 1 : 0);
      const av = parseJson(r.avenants_json, {});
      const reclamations = parseJson(r.reclamations_5ans_json, []);
      return {
        ...r,
        statut: NOMS_STATUT_EO[r.statut] || r.statut,
        base: r.base ? (NOMS_BASE_EO[r.base] || r.base) : '',
        nb_reclamations: Array.isArray(reclamations) ? reclamations.length : 0,
        circonstances_presente: r.circonstances && r.circonstances.trim() ? 1 : 0,
        ...Object.fromEntries(AVENANTS_EO.map(([code]) => ['avenant_' + code, boolAvenantEo(av, code)])),
        ...Object.fromEntries(TYPES_CONSENTEMENT_EO.map((t) => ['consentement_' + t, b(t)])),
      };
    },
    ligneJson: (r) => {
      const { avenants_json, reclamations_5ans_json, consentements_json, circonstances,
        limite_par_sinistre, limite_agregat, franchise, base, prime, ...champs } = r;
      return {
        ...champs,
        garanties: {
          limite_par_sinistre, limite_agregat, franchise, base, prime,
          avenants: parseJson(avenants_json, {}) || {},
        },
        reclamations_5ans: parseJson(reclamations_5ans_json, []),
        circonstances: circonstances || '',
        consentements: parseJson(consentements_json, {}) || {},
      };
    },
  },
  {
    cle: 'eo_versions', titre: 'Versions de soumissions E&O', archive: false,
    description: 'Historique figé des soumissions E&O (v1, v2… — règle d’or).',
    sql: () => `
      SELECT v.*, s.id AS soumission_id, c.raison_sociale AS entreprise, u.nom AS auteur
      FROM eo_soumission_versions v JOIN eo_soumissions s ON s.id = v.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN users u ON u.id = v.cree_par
      WHERE v.cabinet_id = ?`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY v.soumission_id, v.version',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['soumission_id', 'Soumission (id)'], ['entreprise', 'Entreprise'],
      ['version', 'Numéro de version'], ['statut', 'Statut'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', 'Notes'],
      ['donnees', 'Données figées (JSON)'], ['auteur', 'Créée par'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => ({ ...r, statut: NOMS_STATUT_EO[r.statut] || r.statut }),
    ligneJson: (r) => {
      const { donnees, ...champs } = r;
      return { ...champs, donnees: parseJson(donnees, null) };
    },
  },
  // --- D&O — administrateurs et dirigeants (étape 5/10 D&O) ----------------------
  {
    cle: 'do_dirigeants', titre: 'Dirigeants (D&O)', archive: true,
    description: 'Dirigeants et administrateurs des soumissions D&O, en nombre illimité (expérience, antécédents personnels).',
    sql: (inclureArchives) => `
      SELECT d.*, s.id AS soumission_id, c.raison_sociale AS entreprise
      FROM do_dirigeants d JOIN do_soumissions s ON s.id = d.soumission_id
      JOIN clients c ON c.id = s.client_id
      WHERE d.cabinet_id = ?${inclureArchives ? '' : ' AND d.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, d.nom',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['nom', lib('do_dirigeants', 'nom')], ['fonction', lib('do_dirigeants', 'fonction')],
      ['annees_experience', lib('do_dirigeants', 'annees_experience')],
      ['antecedents_personnels', lib('do_dirigeants', 'antecedents_personnels')],
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => r,
    ligneJson: (r) => r,
  },
  {
    cle: 'do_soumissions', titre: 'Soumissions D&O', archive: true,
    description: 'Soumissions D&O avec garanties, avenants et antécédents (base claims-made ou occurrences, poursuites).',
    sql: (inclureArchives) => `
      SELECT s.*, c.raison_sociale AS entreprise,
        g.limite_par_sinistre, g.limite_agregat, g.franchise, g.base, g.prime,
        g.avenants AS avenants_json,
        a.assureur_actuel, a.numero_police_actuelle, a.date_expiration_actuelle,
        a.annees_assurance_continue, a.reclamations_5ans AS reclamations_5ans_json,
        a.poursuites_en_cours, a.consentements AS consentements_json,
        (SELECT COALESCE(MAX(version), 0) FROM do_soumission_versions WHERE soumission_id = s.id) AS version_courante,
        (SELECT COUNT(*) FROM do_dirigeants WHERE soumission_id = s.id AND archive = 0) AS nb_dirigeants,
        (SELECT COUNT(*) FROM do_soumission_versions WHERE soumission_id = s.id) AS nb_versions
      FROM do_soumissions s JOIN clients c ON c.id = s.client_id
      LEFT JOIN do_garanties g ON g.soumission_id = s.id AND g.cabinet_id = s.cabinet_id AND g.archive = 0
      LEFT JOIN do_antecedents a ON a.soumission_id = s.id AND a.cabinet_id = s.cabinet_id AND a.archive = 0
      WHERE s.cabinet_id = ?${inclureArchives ? '' : ' AND s.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY s.cree_le DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['statut', 'Statut'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', 'Notes'],
      ['version_courante', 'Version courante'], ['nb_dirigeants', 'Nb dirigeants'], ['nb_versions', 'Nb versions'],
      ['limite_par_sinistre', 'Limite par sinistre'], ['limite_agregat', 'Limite agrégat'],
      ['franchise', 'Franchise'], ['base', 'Base de garantie'], ['prime', 'Prime'],
      ...AVENANTS_DO.map(([code, label]) => ['avenant_' + code, label]),
      ['assureur_actuel', 'Assureur actuel'], ['numero_police_actuelle', 'Police actuelle'],
      ['date_expiration_actuelle', 'Expiration actuelle'], ['annees_assurance_continue', 'Années d’assurance continue'],
      ['nb_reclamations', 'Nb de réclamations 5 ans'], ['poursuites_declarees', 'Poursuites déclarées'],
      ...TYPES_CONSENTEMENT_DO.map((t) => ['consentement_' + t, LIBELLES_CONSENTEMENT_DO[t]]),
      ['archive', 'Archivé'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => {
      const cons = parseJson(r.consentements_json, {});
      const b = (k) => (cons[k] ? 1 : 0);
      const av = parseJson(r.avenants_json, {});
      const reclamations = parseJson(r.reclamations_5ans_json, []);
      return {
        ...r,
        statut: NOMS_STATUT_DO[r.statut] || r.statut,
        base: r.base ? (NOMS_BASE_DO[r.base] || r.base) : '',
        nb_reclamations: Array.isArray(reclamations) ? reclamations.length : 0,
        poursuites_declarees: r.poursuites_en_cours && r.poursuites_en_cours.trim() ? 1 : 0,
        ...Object.fromEntries(AVENANTS_DO.map(([code]) => ['avenant_' + code, boolAvenantDo(av, code)])),
        ...Object.fromEntries(TYPES_CONSENTEMENT_DO.map((t) => ['consentement_' + t, b(t)])),
      };
    },
    ligneJson: (r) => {
      const { avenants_json, reclamations_5ans_json, consentements_json, poursuites_en_cours,
        limite_par_sinistre, limite_agregat, franchise, base, prime, ...champs } = r;
      return {
        ...champs,
        garanties: {
          limite_par_sinistre, limite_agregat, franchise, base, prime,
          avenants: parseJson(avenants_json, {}) || {},
        },
        reclamations_5ans: parseJson(reclamations_5ans_json, []),
        poursuites_en_cours: poursuites_en_cours || '',
        consentements: parseJson(consentements_json, {}) || {},
      };
    },
  },
  {
    cle: 'do_versions', titre: 'Versions de soumissions D&O', archive: false,
    description: 'Historique figé des soumissions D&O (v1, v2… — règle d’or).',
    sql: () => `
      SELECT v.*, s.id AS soumission_id, c.raison_sociale AS entreprise, u.nom AS auteur
      FROM do_soumission_versions v JOIN do_soumissions s ON s.id = v.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN users u ON u.id = v.cree_par
      WHERE v.cabinet_id = ?`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY v.soumission_id, v.version',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['soumission_id', 'Soumission (id)'], ['entreprise', 'Entreprise'],
      ['version', 'Numéro de version'], ['statut', 'Statut'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', 'Notes'],
      ['donnees', 'Données figées (JSON)'], ['auteur', 'Créée par'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => ({ ...r, statut: NOMS_STATUT_DO[r.statut] || r.statut }),
    ligneJson: (r) => {
      const { donnees, ...champs } = r;
      return { ...champs, donnees: parseJson(donnees, null) };
    },
  },
  // --- Perte d'exploitation (étape 5/10 PE) -------------------------------------
  {
    cle: 'pe_etablissements', titre: 'Établissements (perte d’exploitation)', archive: true,
    description: 'Établissements assurés des soumissions perte d’exploitation, en nombre illimité.',
    sql: (inclureArchives) => `
      SELECT e.*, s.id AS soumission_id, c.raison_sociale AS entreprise
      FROM pe_etablissements e JOIN pe_soumissions s ON s.id = e.soumission_id
      JOIN clients c ON c.id = s.client_id
      WHERE e.cabinet_id = ?${inclureArchives ? '' : ' AND e.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, e.nom_lieu',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['nom_lieu', lib('pe_etablissements', 'nom_lieu')], ['adresse', lib('pe_etablissements', 'adresse')],
      ['occupation', lib('pe_etablissements', 'occupation')],
      ['chiffre_affaires', lib('pe_etablissements', 'chiffre_affaires')],
      ['superficie', lib('pe_etablissements', 'superficie')],
      ['annee_construction', lib('pe_etablissements', 'annee_construction')],
      ['base_valeur', 'Base de valeur'],
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => ({
      ...r,
      base_valeur: r.base_valeur ? (NOMS_BASE_VALEUR_PE[r.base_valeur] || r.base_valeur) : '',
    }),
    ligneJson: (r) => r,
  },
  {
    cle: 'pe_soumissions', titre: 'Soumissions perte d’exploitation', archive: true,
    description: 'Soumissions perte d’exploitation avec garanties, avenants et antécédents (période d’indemnité, franchise en jours, interruptions).',
    sql: (inclureArchives) => `
      SELECT s.*, c.raison_sociale AS entreprise,
        g.limite, g.periode_indemnite_mois, g.franchise_jours, g.base_montant, g.prime,
        g.avenants AS avenants_json,
        a.assureur_actuel, a.numero_police_actuelle, a.date_expiration_actuelle,
        a.annees_assurance_continue, a.interruptions_5ans AS interruptions_5ans_json,
        a.consentements AS consentements_json,
        (SELECT COALESCE(MAX(version), 0) FROM pe_soumission_versions WHERE soumission_id = s.id) AS version_courante,
        (SELECT COUNT(*) FROM pe_etablissements WHERE soumission_id = s.id AND archive = 0) AS nb_etablissements,
        (SELECT COUNT(*) FROM pe_soumission_versions WHERE soumission_id = s.id) AS nb_versions
      FROM pe_soumissions s JOIN clients c ON c.id = s.client_id
      LEFT JOIN pe_garanties g ON g.soumission_id = s.id AND g.cabinet_id = s.cabinet_id AND g.archive = 0
      LEFT JOIN pe_antecedents a ON a.soumission_id = s.id AND a.cabinet_id = s.cabinet_id AND a.archive = 0
      WHERE s.cabinet_id = ?${inclureArchives ? '' : ' AND s.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY s.cree_le DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['statut', 'Statut'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', 'Notes'],
      ['version_courante', 'Version courante'], ['nb_etablissements', 'Nb établissements'], ['nb_versions', 'Nb versions'],
      ['limite', 'Limite'], ['periode_indemnite', 'Période d’indemnité'],
      ['franchise_jours', 'Franchise (jours)'], ['base', "Base d'indemnité"], ['prime', 'Prime'],
      ...AVENANTS_PE.map(([code, label]) => ['avenant_' + code, label]),
      ['assureur_actuel', 'Assureur actuel'], ['numero_police_actuelle', 'Police actuelle'],
      ['date_expiration_actuelle', 'Expiration actuelle'], ['annees_assurance_continue', 'Années d’assurance continue'],
      ['nb_interruptions', 'Nb interruptions 5 ans'], ['interruptions_5ans_json', 'Interruptions 5 ans (JSON)'],
      ...TYPES_CONSENTEMENT_PE.map((t) => ['consentement_' + t, LIBELLES_CONSENTEMENT_PE[t]]),
      ['archive', 'Archivé'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => {
      const cons = parseJson(r.consentements_json, {});
      const b = (k) => (cons[k] ? 1 : 0);
      const av = parseJson(r.avenants_json, {});
      const interruptions = parseJson(r.interruptions_5ans_json, []);
      return {
        ...r,
        statut: NOMS_STATUT_PE[r.statut] || r.statut,
        base: r.base_montant ? (NOMS_BASE_PE[r.base_montant] || r.base_montant) : '',
        periode_indemnite: r.periode_indemnite_mois ? (NOMS_PERIODE_PE[r.periode_indemnite_mois] || r.periode_indemnite_mois) : '',
        nb_interruptions: Array.isArray(interruptions) ? interruptions.length : 0,
        ...Object.fromEntries(AVENANTS_PE.map(([code]) => ['avenant_' + code, boolAvenantPe(av, code)])),
        ...Object.fromEntries(TYPES_CONSENTEMENT_PE.map((t) => ['consentement_' + t, b(t)])),
      };
    },
    ligneJson: (r) => {
      const { avenants_json, interruptions_5ans_json, consentements_json,
        limite, periode_indemnite_mois, franchise_jours, base_montant, prime, ...champs } = r;
      return {
        ...champs,
        garanties: {
          limite, periode_indemnite_mois, franchise_jours, base_montant, prime,
          avenants: parseJson(avenants_json, {}) || {},
        },
        interruptions_5ans: parseJson(interruptions_5ans_json, []),
        consentements: parseJson(consentements_json, {}) || {},
      };
    },
  },
  {
    cle: 'pe_versions', titre: 'Versions de soumissions perte d’exploitation', archive: false,
    description: 'Historique figé des soumissions perte d’exploitation (v1, v2… — règle d’or).',
    sql: () => `
      SELECT v.*, s.id AS soumission_id, c.raison_sociale AS entreprise, u.nom AS auteur
      FROM pe_soumission_versions v JOIN pe_soumissions s ON s.id = v.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN users u ON u.id = v.cree_par
      WHERE v.cabinet_id = ?`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY v.soumission_id, v.version',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['soumission_id', 'Soumission (id)'], ['entreprise', 'Entreprise'],
      ['version', 'Numéro de version'], ['statut', 'Statut'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['notes', 'Notes'],
      ['donnees', 'Données figées (JSON)'], ['auteur', 'Créée par'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => ({ ...r, statut: NOMS_STATUT_PE[r.statut] || r.statut }),
    ligneJson: (r) => {
      const { donnees, ...champs } = r;
      return { ...champs, donnees: parseJson(donnees, null) };
    },
  },
  // --- Flotte automobile (étape 5/10 flotte) -----------------------------------
  {
    cle: 'flotte_vehicules', titre: 'Véhicules (flotte)', archive: true,
    description: 'Véhicules des soumissions flotte, en nombre illimité, avec conducteur principal et équipements spéciaux.',
    sql: (inclureArchives) => `
      SELECT v.*, s.id AS soumission_id, c.raison_sociale AS entreprise,
        cond.prenom AS cp_prenom, cond.nom AS cp_nom
      FROM flotte_vehicules v JOIN flotte_soumissions s ON s.id = v.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN flotte_conducteurs cond ON cond.id = v.conducteur_principal_id
      WHERE v.cabinet_id = ?${inclureArchives ? '' : ' AND v.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, v.marque, v.modele',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['niv', 'NIV'], ['annee', 'Année'], ['marque', 'Marque'], ['modele', 'Modèle'],
      ['type_vehicule', 'Type de véhicule'], ['usage', 'Usage'],
      ['rayon_operation_km', 'Rayon d’opération (km)'], ['lieu_remisage', 'Lieu de remisage'],
      ['valeur', 'Valeur'], ['annee_acquisition', 'Année d’acquisition'],
      ['conducteur_principal', 'Conducteur principal'],
      ['equipements_speciaux', 'Équipements spéciaux (JSON)'],
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => ({
      ...r,
      type_vehicule: r.type_vehicule ? (NOMS_TYPE_VEHICULE_FLOTTE[r.type_vehicule] || r.type_vehicule) : '',
      usage: r.usage ? (NOMS_USAGE_FLOTTE[r.usage] || r.usage) : '',
      conducteur_principal: (r.cp_prenom || r.cp_nom)
        ? `${r.cp_prenom || ''} ${r.cp_nom || ''}`.trim()
        : (r.conducteur_principal_nom || ''),
    }),
    ligneJson: (r) => {
      const { cp_prenom, cp_nom, equipements_speciaux, ...champs } = r;
      return {
        ...champs,
        conducteur_principal: (cp_prenom || cp_nom)
          ? `${cp_prenom || ''} ${cp_nom || ''}`.trim()
          : (r.conducteur_principal_nom || null),
        equipements_speciaux: parseJson(equipements_speciaux, []),
      };
    },
  },
  {
    cle: 'flotte_conducteurs', titre: 'Conducteurs (flotte)', archive: true,
    description: 'Conducteurs des soumissions flotte, en nombre illimité, avec sinistres 5 ans et infractions 3 ans décomptés.',
    sql: (inclureArchives) => `
      SELECT d.*, s.id AS soumission_id, c.raison_sociale AS entreprise
      FROM flotte_conducteurs d JOIN flotte_soumissions s ON s.id = d.soumission_id
      JOIN clients c ON c.id = s.client_id
      WHERE d.cabinet_id = ?${inclureArchives ? '' : ' AND d.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, d.nom, d.prenom',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['nom', 'Nom'], ['prenom', 'Prénom'], ['date_naissance', 'Date de naissance'], ['age', 'Âge'],
      ['numero_permis', 'N° de permis'], ['classe_permis', 'Classe de permis'],
      ['annees_experience', 'Années d’expérience'], ['annees_experience_lourds', 'Années d’expérience — véhicules lourds'],
      ['date_embauche', 'Date d’embauche'],
      ['nb_sinistres', 'Nb sinistres 5 ans'], ['sinistres_5ans', 'Sinistres 5 ans (JSON)'],
      ['nb_infractions', 'Nb infractions 3 ans'], ['infractions_3ans', 'Infractions 3 ans (JSON)'],
      ['formations', 'Formations (JSON)'],
      ['archive', 'Archivé'], ['cree_le', 'Créé le'],
    ],
    ligneCsv: (r) => ({
      ...r,
      nb_sinistres: nbDepuisJson(r.sinistres_5ans),
      nb_infractions: nbDepuisJson(r.infractions_3ans),
    }),
    ligneJson: (r) => ({
      ...r,
      sinistres_5ans: parseJson(r.sinistres_5ans, []),
      infractions_3ans: parseJson(r.infractions_3ans, []),
      formations: parseJson(r.formations, []),
    }),
  },
  {
    cle: 'flotte_soumissions', titre: 'Soumissions flotte', archive: true,
    description: 'Soumissions flotte avec garanties FAQ, antécédents, décomptes réels, somme des valeurs et historique figé (versions imbriquées en JSON).',
    sql: (inclureArchives) => `
      SELECT s.*, c.raison_sociale AS entreprise,
        g.limite_rc, g.franchise_collision, g.franchise_versement, g.prime,
        g.avenants AS avenants_json,
        a.assureur_actuel, a.numero_police_actuelle, a.date_expiration_actuelle,
        a.annees_assurance_flotte_continue, a.sinistres_flotte_5ans AS sinistres_flotte_json,
        a.ratio_pertes, a.refus_annulation_ant, a.refus_annulation_details,
        a.consentements AS consentements_json,
        (SELECT COALESCE(MAX(version), 0) FROM flotte_soumission_versions WHERE soumission_id = s.id) AS version_courante,
        (SELECT COUNT(*) FROM flotte_vehicules WHERE soumission_id = s.id AND archive = 0) AS nb_vehicules_reel,
        (SELECT COUNT(*) FROM flotte_conducteurs WHERE soumission_id = s.id AND archive = 0) AS nb_conducteurs,
        (SELECT COALESCE(SUM(valeur), 0) FROM flotte_vehicules WHERE soumission_id = s.id AND archive = 0) AS somme_valeurs,
        (SELECT COUNT(*) FROM flotte_soumission_versions WHERE soumission_id = s.id) AS nb_versions
      FROM flotte_soumissions s JOIN clients c ON c.id = s.client_id
      LEFT JOIN flotte_garanties g ON g.soumission_id = s.id AND g.cabinet_id = s.cabinet_id AND g.archive = 0
      LEFT JOIN flotte_antecedents a ON a.soumission_id = s.id AND a.cabinet_id = s.cabinet_id AND a.archive = 0
      WHERE s.cabinet_id = ?${inclureArchives ? '' : ' AND s.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY s.cree_le DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['statut', 'Statut'],
      ['assureur', 'Assureur'], ['numero_police', 'N° de police'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['date_echeance_visee', 'Date d’échéance visée'],
      ['notes', 'Notes'],
      ['version_courante', 'Version courante'], ['nb_versions', 'Nb versions'],
      ['usage_dominant', 'Usage dominant'], ['rayon_operation_km', 'Rayon d’opération (km)'],
      ['nb_vehicules', 'Nb véhicules déclarés'], ['nb_vehicules_reel', 'Nb véhicules'],
      ['nb_conducteurs', 'Nb conducteurs'], ['somme_valeurs', 'Somme des valeurs'],
      ['limite_rc', 'Limite RC'], ['franchise_collision', 'Franchise collision'],
      ['franchise_versement', 'Franchise versement'], ['prime', 'Prime'],
      ...CLEFS_AVENANTS.map((k) => ['avenant_' + k, LIBELLES_AVENANTS[k]]),
      ['assureur_actuel', 'Assureur actuel'], ['numero_police_actuelle', 'Police actuelle'],
      ['date_expiration_actuelle', 'Expiration actuelle'],
      ['annees_assurance_flotte_continue', 'Années d’assurance flotte continue'],
      ['nb_sinistres_flotte', 'Nb sinistres flotte 5 ans'], ['sinistres_flotte_json', 'Sinistres flotte 5 ans (JSON)'],
      ['ratio_pertes', 'Ratio de pertes (%)'], ['refus_annulation_ant', 'Refus ou annulation antérieur'],
      ['refus_annulation_details', 'Détails du refus / de l’annulation'],
      ...TYPES_CONSENTEMENT_FLOTTE.map((t) => ['consentement_' + t, LIBELLES_CONSENTEMENT_FLOTTE[t]]),
      ['archive', 'Archivé'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => {
      const cons = parseJson(r.consentements_json, {});
      const av = parseJson(r.avenants_json, {});
      return {
        ...r,
        statut: NOMS_STATUT_FLOTTE[r.statut] || r.statut,
        usage_dominant: r.usage_dominant ? (NOMS_USAGE_DOMINANT_FLOTTE[r.usage_dominant] || r.usage_dominant) : '',
        nb_sinistres_flotte: nbDepuisJson(r.sinistres_flotte_json),
        ...Object.fromEntries(CLEFS_AVENANTS.map((k) => ['avenant_' + k, boolAvenant(av, k)])),
        ...Object.fromEntries(TYPES_CONSENTEMENT_FLOTTE.map((t) => ['consentement_' + t, consentementFlotte(cons, t)])),
      };
    },
    ligneJson: (r) => {
      const { avenants_json, sinistres_flotte_json, consentements_json,
        limite_rc, franchise_collision, franchise_versement, prime, ...champs } = r;
      const versions = bd.prepare(`
        SELECT id, version, statut, notes, date_effet_souhaitee, donnees, cree_par, cree_le
        FROM flotte_soumission_versions WHERE soumission_id = ? ORDER BY version
      `).all(r.id).map((v) => {
        const { donnees, ...vc } = v;
        return { ...vc, donnees: parseJson(donnees, null) };
      });
      return {
        ...champs,
        garanties: {
          limite_rc, franchise_collision, franchise_versement, prime,
          avenants: parseJson(avenants_json, {}) || {},
        },
        sinistres_flotte_5ans: parseJson(sinistres_flotte_json, []),
        consentements: parseJson(consentements_json, {}) || {},
        versions,
      };
    },
  },
  // --- Cautionnement (étape 5/10 cautionnement) -----------------------------------
  {
    cle: 'caut_obligations', titre: 'Obligations (cautionnement)', archive: true,
    description: 'Cautionnements émis par soumission (soumission, exécution, paiement M&O, RBQ, autre), en nombre illimité, avec bénéficiaire et projet.',
    sql: (inclureArchives) => `
      SELECT o.*, s.id AS soumission_id, c.raison_sociale AS entreprise
      FROM caut_obligations o JOIN caut_soumissions s ON s.id = o.soumission_id
      JOIN clients c ON c.id = s.client_id
      WHERE o.cabinet_id = ?${inclureArchives ? '' : ' AND o.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, o.cree_le, o.id',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['soumission_id', 'Soumission (id)'],
      ['type', 'Type de cautionnement'], ['beneficiaire', 'Bénéficiaire (donneur d’ouvrage)'],
      ['description_projet', 'Description du projet'], ['montant_contrat', 'Montant du contrat'],
      ['montant_cautionnement', 'Montant du cautionnement'], ['taux_pct', 'Taux (%)'],
      ['prime_estimee', 'Prime estimée'], ['date_debut', 'Date de début'], ['duree_mois', 'Durée (mois)'],
      ['archive', 'Archivé'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => ({ ...r, type: r.type ? (NOMS_TYPE_OBLIGATION_CAUT[r.type] || r.type) : '' }),
    ligneJson: (r) => r,
  },
  {
    cle: 'caut_soumissions', titre: 'Soumissions cautionnement', archive: true,
    description: 'Soumissions cautionnement avec ligne aplatie (limite globale/par projet), antécédents, nb de réclamations 5 ans calculé et historique figé (versions imbriquées en JSON).',
    sql: (inclureArchives) => `
      SELECT s.*, c.raison_sociale AS entreprise,
        g.limite_globale, g.limite_par_projet, g.fonds_roulement, g.valeur_nette,
        g.prime AS prime_ligne,
        a.assureur_actuel, a.numero_ligne_actuelle, a.date_expiration_actuelle,
        a.annees_cautionnement_continu, a.reclamations_5ans AS reclamations_json,
        a.refus_resiliation_ant, a.refus_resiliation_details,
        a.consentements AS consentements_json,
        (SELECT COALESCE(MAX(version), 0) FROM caut_soumission_versions WHERE soumission_id = s.id) AS version_courante,
        (SELECT COUNT(*) FROM caut_obligations WHERE soumission_id = s.id AND archive = 0) AS nb_obligations,
        (SELECT COALESCE(SUM(montant_cautionnement), 0) FROM caut_obligations WHERE soumission_id = s.id AND archive = 0) AS somme_cautionnements,
        (SELECT COUNT(*) FROM caut_soumission_versions WHERE soumission_id = s.id) AS nb_versions
      FROM caut_soumissions s JOIN clients c ON c.id = s.client_id
      LEFT JOIN caut_garanties g ON g.soumission_id = s.id AND g.cabinet_id = s.cabinet_id AND g.archive = 0
      LEFT JOIN caut_antecedents a ON a.soumission_id = s.id AND a.cabinet_id = s.cabinet_id AND a.archive = 0
      WHERE s.cabinet_id = ?${inclureArchives ? '' : ' AND s.archive = 0'}`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY s.cree_le DESC',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['entreprise', 'Entreprise'], ['statut', 'Statut'],
      ['assureur', 'Caution visée'], ['numero_police', 'N° de police'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['date_echeance_visee', 'Date d’échéance visée'],
      ['secteur_activite', 'Secteur d’activité'], ['annee_fondation', 'Année de fondation'],
      ['chiffre_affaires', 'Chiffre d’affaires annuel'], ['nb_employes', 'Nombre d’employés'],
      ['notes', 'Notes'],
      ['version_courante', 'Version courante'], ['nb_versions', 'Nb versions'],
      ['nb_obligations', 'Nb obligations'], ['somme_cautionnements', 'Somme des cautionnements'],
      ['limite_globale', 'Limite globale (capacité)'], ['limite_par_projet', 'Limite par projet'],
      ['fonds_roulement', 'Fonds de roulement'], ['valeur_nette', 'Valeur nette'],
      ['prime_ligne', 'Prime de la ligne'],
      ['assureur_actuel', 'Caution actuelle'], ['numero_ligne_actuelle', 'Ligne actuelle'],
      ['date_expiration_actuelle', 'Expiration ligne actuelle'],
      ['annees_cautionnement_continu', 'Années de cautionnement continu'],
      ['nb_reclamations_5ans', 'Nb réclamations 5 ans'], ['reclamations_json', 'Réclamations 5 ans (JSON)'],
      ['refus_resiliation_ant', 'Refus ou résiliation antérieur'],
      ['refus_resiliation_details', 'Détails du refus / de la résiliation'],
      ...TYPES_CONSENTEMENT_CAUT.map((t) => ['consentement_' + t, LIBELLES_CONSENTEMENT_CAUT[t]]),
      ['archive', 'Archivé'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => {
      const cons = parseJson(r.consentements_json, {});
      return {
        ...r,
        statut: NOMS_STATUT_CAUT[r.statut] || r.statut,
        nb_reclamations_5ans: nbDepuisJson(r.reclamations_json),
        ...Object.fromEntries(TYPES_CONSENTEMENT_CAUT.map((t) => ['consentement_' + t, consentementCaut(cons, t)])),
      };
    },
    ligneJson: (r) => {
      const { reclamations_json, consentements_json,
        limite_globale, limite_par_projet, fonds_roulement, valeur_nette, prime_ligne,
        assureur_actuel, numero_ligne_actuelle, date_expiration_actuelle,
        annees_cautionnement_continu, refus_resiliation_ant, refus_resiliation_details,
        ...champs } = r;
      const versions = bd.prepare(`
        SELECT id, version, statut, notes, date_effet_souhaitee, donnees, cree_par, cree_le
        FROM caut_soumission_versions WHERE soumission_id = ? ORDER BY version
      `).all(r.id).map((v) => {
        const { donnees, ...vc } = v;
        return { ...vc, donnees: parseJson(donnees, null) };
      });
      return {
        ...champs,
        ligne: { limite_globale, limite_par_projet, fonds_roulement, valeur_nette, prime: prime_ligne },
        antecedents: {
          assureur_actuel, numero_ligne_actuelle, date_expiration_actuelle,
          annees_cautionnement_continu, refus_resiliation_ant, refus_resiliation_details,
          reclamations_5ans: parseJson(reclamations_json, []),
          consentements: parseJson(consentements_json, {}) || {},
        },
        versions,
      };
    },
  },
  {
    cle: 'caut_versions', titre: 'Versions de soumissions cautionnement', archive: false,
    description: 'Historique figé des soumissions cautionnement (v1, v2… — règle d’or) : entête, obligations, ligne et antécédents au moment de chaque version.',
    sql: () => `
      SELECT v.*, s.id AS soumission_id, c.raison_sociale AS entreprise, u.nom AS cree_par_nom
      FROM caut_soumission_versions v JOIN caut_soumissions s ON s.id = v.soumission_id
      JOIN clients c ON c.id = s.client_id
      LEFT JOIN users u ON u.id = v.cree_par
      WHERE v.cabinet_id = ?`,
    portee: (req) => clausePortefeuille(req, 'c'),
    ordre: 'ORDER BY c.raison_sociale, s.id, v.version',
    colonnesCsv: () => [
      ['id', 'Identifiant'], ['soumission_id', 'Soumission (id)'], ['entreprise', 'Entreprise'],
      ['version', 'Version'], ['statut', 'Statut'], ['notes', 'Notes'],
      ['date_effet_souhaitee', 'Date d’effet souhaitée'], ['donnees', 'Données (JSON)'],
      ['cree_par_nom', 'Créée par'], ['cree_le', 'Créée le'],
    ],
    ligneCsv: (r) => ({ ...r, statut: NOMS_STATUT_CAUT[r.statut] || r.statut }),
    ligneJson: (r) => {
      const { donnees, ...champs } = r;
      return { ...champs, donnees: parseJson(donnees, null) };
    },
  },
];

const MODULE_PAR_CLE = Object.fromEntries(MODULES.map((m) => [m.cle, m]));

// --- Page -------------------------------------------------------------------
router.get('/', (req, res) => {
  const perimetre = req.utilisateur.role === 'courtier' ? 'votre portefeuille' : 'tout le cabinet';
  res.render('exports/index', {
    titre: 'Exports',
    modules: MODULES.map((m) => ({ cle: m.cle, titre: m.titre, description: m.description })),
    perimetre,
  });
});

// --- Export -------------------------------------------------------------------
router.post('/', verifieCsrf, (req, res) => {
  const mod = MODULE_PAR_CLE[String(req.body.module || '')];
  const format = String(req.body.format || '').toLowerCase();
  if (!mod || !['csv', 'json'].includes(format)) {
    return res.status(400).render('erreur', { titre: 'Requête invalide', message: 'Module ou format inconnu.' });
  }
  const inclureArchives = req.body.archives === '1';
  const cabinetId = res.locals.cabinetId;

  let lignes;
  try {
    const sql = mod.sql(inclureArchives) + ' ' + mod.portee(req) + ' ' + mod.ordre;
    lignes = bd.prepare(sql).all(cabinetId);
  } catch (e) {
    return res.status(500).render('erreur', { titre: 'Erreur d’export', message: 'Impossible de générer l’export : ' + e.message });
  }

  const perimetre = req.utilisateur.role === 'courtier' ? 'portefeuille' : 'cabinet';
  const date = new Date().toISOString().slice(0, 10);
  journal(cabinetId, req.utilisateur.id, 'export',
    `Export ${mod.cle} (${format}) — ${lignes.length} lignes, périmètre ${perimetre}${inclureArchives ? ', archivés inclus' : ''}`);

  if (format === 'csv') {
    const cols = mod.colonnesCsv();
    const donnees = lignes.map((r) => {
      const lr = mod.ligneCsv(r);
      return cols.map(([cle]) => lr[cle]);
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="export-${mod.cle}-${date}.csv"`);
    return res.send(versCsv(cols.map(([, l]) => l), donnees));
  }

  const donnees = lignes.map((r) => mod.ligneJson(r));
  const cabinet = bd.prepare('SELECT nom FROM cabinets WHERE id = ?').get(cabinetId);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="export-${mod.cle}-${date}.json"`);
  return res.send(JSON.stringify({
    module: mod.cle,
    exporte_le: new Date().toISOString(),
    cabinet: cabinet ? cabinet.nom : null,
    perimetre,
    archives_inclus: inclureArchives,
    nombre: donnees.length,
    donnees,
  }, null, 2));
});

module.exports = router;
module.exports.MODULES = MODULES;
