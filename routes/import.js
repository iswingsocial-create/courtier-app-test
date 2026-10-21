/**
 * routes/import.js — Import en lot via CSV.
 * Format (séparateur « ; », première ligne d'en-tête, BOM UTF-8) :
 *   - types classiques : entreprise | police | protection (en-têtes snake_case)
 *   - types auto FPQ1 (étape 6/10) : soumission | conducteur | vehicule | antecedents
 *     (en-têtes en français, miroir des exports — voir routes/exports.js)
 *   - types biens (étape 6/10 biens) : soumission_biens | batiment | contenu |
 *     garanties_biens | antecedents_biens (en-têtes en français, miroir des exports)
 *   - types RC (étape 6/10 RC) : soumission_rc | lieu_rc | garanties_rc | antecedents_rc
 *     (en-têtes en français, miroir des exports RC — voir routes/exports.js)
 *   - types cyber (étape 6/10 cyber) : soumission_cyber | mesure_cyber | garanties_cyber |
 *     antecedents_cyber (en-têtes en français, miroir des exports cyber — voir routes/exports.js)
 *   - types E&O (étape 6/10 E&O) : soumission_eo | activite_eo | garanties_eo |
 *     antecedents_eo (en-têtes en français, miroir des exports E&O — voir routes/exports.js)
 *   - types D&O (étape 6/10 D&O) : soumission_do | dirigeant_do | garanties_do |
 *     antecedents_do (en-têtes en français, miroir des exports D&O — voir routes/exports.js)
 *   - types perte d'exploitation (étape 6/10 PE) : soumission_pe | etablissement_pe |
 *     garanties_pe | antecedents_pe (en-têtes en français, miroir des exports PE)
 *   - types flotte automobile (étape 6/10 flotte) : soumission_flotte | vehicule_flotte |
 *     conducteur_flotte | garanties_flotte | antecedents_flotte (en-têtes en français,
 *     miroir des exports flotte — la flotte a DEUX lignes illimitées, véhicules ET
 *     conducteurs, d'où 5 types au lieu des 4 du pattern PE)
 *   - types cautionnement (étape 6/10 cautionnement) : soumission_caut | obligation_caut |
 *     ligne_caut | antecedents_caut (en-têtes en français, miroir des exports
 *     cautionnement — obligations illimitées, ligne de cautionnement UNIQUE)
 * Les lignes commençant par « # » sont des commentaires et sont ignorées.
 * Un modèle téléchargeable est offert par type, avec rapport d'erreurs ligne par ligne.
 * Règle d'or : aucun DELETE ; chaque ligne biens/RC/cyber/E&O/D&O/PE crée une version via
 * lib/biens.js / lib/rc.js / lib/cyber.js / lib/eo.js / lib/do.js / lib/pe.js (jamais d'écrasement silencieux).
 */
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');

const bd = require('../lib/bd');
const fpq1 = require('../lib/fpq1');
const biens = require('../lib/biens');
const rc = require('../lib/rc');
const cyber = require('../lib/cyber');
const eo = require('../lib/eo');
const dno = require('../lib/do');
const pe = require('../lib/pe');
const flotte = require('../lib/flotte');
const caut = require('../lib/cautionnement');
const { exigeAuth, exigeMotDePasseChange, verifieCsrf, journal, estCourrielValide, estDateValide, clientHorsPortefeuille, estCourtier } = require('../lib/middleware');
const { NOMS_LIGNES } = require('./polices');
const { RC_MONTANTS, PROTECTIONS_B, AVENANTS_FAQ } = require('./auto');
const { TYPES_CONSTRUCTION, FORMULES, TYPES_CONTENU, AVENANTS_BIENS } = require('./biens');
const { SOUS_TRAITANTS, FORMULES_RC } = require('./rc');
const { TYPES_MESURE, STATUTS_MESURE, AVENANTS_CYBER } = require('./cyber');
const { AVENANTS_EO } = require('./eo');
const { AVENANTS_DO } = require('./do');
const { AVENANTS_PE } = require('./pe');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const PRODUITS = Object.keys(NOMS_LIGNES);
const CODES_AVENANTS = AVENANTS_FAQ.map(([c]) => c); // faq43, faq20, faq27, faq34, faq5a
const CODES_AVENANTS_BIENS = AVENANTS_BIENS.map(([c]) => c); // tremblement_terre, inondation, ...
const CODES_AVENANTS_CYBER = AVENANTS_CYBER.map(([c]) => c); // rancongiciel, fraude_transfert, ...
const CODES_AVENANTS_EO = AVENANTS_EO.map(([c]) => c); // frais_defense, medias_contenu, cyber_associe
const CODES_AVENANTS_DO = AVENANTS_DO.map(([c]) => c); // frais_defense, pratiques_emploi, fidelite_crime
const CODES_AVENANTS_PE = AVENANTS_PE.map(([c]) => c); // frais_supplementaires, dependance_fournisseurs, acces_civil, deterioration_stocks

const televersement = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo
  fileFilter: (req, file, cb) => {
    const nom = (file.originalname || '').toLowerCase();
    cb(null, nom.endsWith('.csv') || file.mimetype.includes('csv') || file.mimetype.includes('text'));
  },
});

// --- Normalisation des en-têtes ------------------------------------------------
// Correspondances partagées avec l'analyse tabulaire de documents
// (lib/analyse-tableur.js) : un seul point de vérité, lib/entetes-import.js.
// Les exports utilisent des en-têtes en français ; l'import les accepte aussi
// (miroir des exports). Les anciens en-têtes snake_case restent valides.
const { cleEntete, EQUIV, EQUIV_NORM, normaliserLigne } = require('../lib/entetes-import');
function normaliserType(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// --- Petits parseurs ------------------------------------------------------------
function boolImport(v, champ) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['1', 'oui', 'yes', 'vrai', 'true', 'o', 'y'].includes(s)) return 1;
  if (['0', 'non', 'no', 'faux', 'false', 'n', ''].includes(s)) return 0;
  throw new Error(`${champ} invalide (attendu : oui/non ou 0/1)`);
}
function nombreImport(v, champ, { min = null, max = null, entier = false } = {}) {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (isNaN(n)) throw new Error(`${champ} invalide (nombre attendu)`);
  if (entier && !Number.isInteger(n)) throw new Error(`${champ} invalide (entier attendu)`);
  if (min !== null && n < min) throw new Error(`${champ} invalide (minimum ${min})`);
  if (max !== null && n > max) throw new Error(`${champ} invalide (maximum ${max})`);
  return n;
}
function dateImport(v, champ) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!estDateValide(s)) throw new Error(`${champ} invalide (format AAAA-MM-JJ)`);
  return s;
}
// Valeur parmi une liste fermée (insensible aux accents/casse, ex. « financé » → « finance »).
function choixImport(v, champ, valeurs) {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!s) return null;
  if (!valeurs.includes(s)) throw new Error(`${champ} invalide (attendu : ${valeurs.join('/')})`);
  return s;
}
// "2022-03-01|Excès de vitesse|3;2023-06-15|Feu rouge|2" → [{date, description, points}]
function parserListePipe(v, champ, nbChamps) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.split(';').map((morceau) => morceau.trim()).filter(Boolean).map((morceau) => {
    const parts = morceau.split('|').map((p) => p.trim());
    if (parts.length < nbChamps) throw new Error(`${champ} : format « ${'champ|'.repeat(nbChamps).slice(0, -1)} » séparés par « ; »`);
    const [date, ...reste] = parts;
    if (!estDateValide(date)) throw new Error(`${champ} : date invalide « ${date} » (AAAA-MM-JJ)`);
    return { date, reste };
  });
}
function parserInfractions(v) {
  const l = parserListePipe(v, 'infractions', 3);
  if (!l) return null;
  return l.map(({ date, reste }) => {
    const points = Number(reste[1]);
    if (isNaN(points)) throw new Error(`infractions : points invalides « ${reste[1]} »`);
    return { date, description: reste[0], points };
  });
}
function parserSuspensions(v) {
  const l = parserListePipe(v, 'suspensions', 2);
  if (!l) return null;
  return l.map(({ date, reste }) => ({ date, description: reste[0] }));
}
function parserSinistres(v) {
  const l = parserListePipe(v, 'sinistres 6 ans', 4);
  if (!l) return null;
  return l.map(({ date, reste }) => {
    const montant = Number(String(reste[1]).replace(/\s/g, '').replace(',', '.'));
    if (isNaN(montant)) throw new Error(`sinistres 6 ans : montant invalide « ${reste[1]} »`);
    return { date, type: reste[0], montant, responsabilite: reste[2] };
  });
}
// "AAAA-MM-JJ|type|montant" séparés par « ; » — sinistres biens (5 ans)
function parserSinistresBiens(v) {
  const l = parserListePipe(v, 'sinistres 5 ans', 3);
  if (!l) return null;
  return l.map(({ date, reste }) => {
    const montant = Number(String(reste[1]).replace(/\s/g, '').replace(',', '.'));
    if (isNaN(montant)) throw new Error(`sinistres 5 ans : montant invalide « ${reste[1]} »`);
    return { date, type: reste[0], montant };
  });
}
// "AAAA-MM-JJ|type|montant" (+ « |oui » si le sinistre a été réclamé) séparés par « ; » — incidents cyber (5 ans)
function parserIncidentsCyber(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.split(';').map((m) => m.trim()).filter(Boolean).map((morceau) => {
    const parts = morceau.split('|').map((p) => p.trim());
    if (parts.length < 3) throw new Error('incidents cyber 5 ans : format « AAAA-MM-JJ|type|montant » séparés par « ; »');
    const [date, type, montantStr, reclameStr] = parts;
    if (!estDateValide(date)) throw new Error(`incidents cyber 5 ans : date invalide « ${date} » (AAAA-MM-JJ)`);
    const montant = Number(String(montantStr).replace(/\s/g, '').replace(',', '.'));
    if (isNaN(montant) || montant < 0) throw new Error(`incidents cyber 5 ans : montant invalide « ${montantStr} »`);
    let sinistre = 0;
    if (reclameStr !== undefined && reclameStr !== '') sinistre = boolImport(reclameStr, 'incident réclamé');
    return { date, type, montant, sinistre };
  });
}
// "AAAA-MM-JJ|nature|montant" (+ « |oui » si la réclamation a été présentée) séparés par « ; » — réclamations E&O (5 ans)
function parserReclamationsEo(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.split(';').map((m) => m.trim()).filter(Boolean).map((morceau) => {
    const parts = morceau.split('|').map((p) => p.trim());
    if (parts.length < 3) throw new Error('réclamations E&O 5 ans : format « AAAA-MM-JJ|nature|montant » séparés par « ; »');
    const [date, nature, montantStr, sinistreStr] = parts;
    if (!estDateValide(date)) throw new Error(`réclamations E&O 5 ans : date invalide « ${date} » (AAAA-MM-JJ)`);
    const montant = Number(String(montantStr).replace(/\s/g, '').replace(',', '.'));
    if (isNaN(montant) || montant < 0) throw new Error(`réclamations E&O 5 ans : montant invalide « ${montantStr} »`);
    let sinistre = 0;
    if (sinistreStr !== undefined && sinistreStr !== '') sinistre = boolImport(sinistreStr, 'réclamation présentée');
    return { date, nature, montant, sinistre };
  });
}
// Base de garantie E&O : codes ou libellés FR (miroir des exports : « Réclamations-présentées » / « Occurrences »).
function baseEoImport(v, champ) {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '_');
  if (!s) return null;
  if (s === 'reclamations_presentees') return 'reclamations_presentees';
  if (s === 'occurrences') return 'occurrences';
  throw new Error(`${champ} invalide (attendu : Réclamations-présentées/occurrences)`);
}

// Base de garantie D&O : codes ou libellés FR (miroir des exports : « Réclamations-présentées » / « Occurrences »).
function baseDoImport(v, champ) {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '_');
  if (!s) return null;
  if (s === 'reclamations_presentees') return 'reclamations_presentees';
  if (s === 'occurrences') return 'occurrences';
  throw new Error(`${champ} invalide (attendu : Réclamations-présentées/occurrences)`);
}
// "AAAA-MM-JJ|nature|montant" (+ « |oui » si la réclamation a été présentée) séparés par « ; » — réclamations D&O (5 ans)
function parserReclamationsDo(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.split(';').map((m) => m.trim()).filter(Boolean).map((morceau) => {
    const parts = morceau.split('|').map((p) => p.trim());
    if (parts.length < 3) throw new Error('réclamations D&O 5 ans : format « AAAA-MM-JJ|nature|montant » séparés par « ; »');
    const [date, nature, montantStr, sinistreStr] = parts;
    if (!estDateValide(date)) throw new Error(`réclamations D&O 5 ans : date invalide « ${date} » (AAAA-MM-JJ)`);
    const montant = Number(String(montantStr).replace(/\s/g, '').replace(',', '.'));
    if (isNaN(montant) || montant < 0) throw new Error(`réclamations D&O 5 ans : montant invalide « ${montantStr} »`);
    let sinistre = 0;
    if (sinistreStr !== undefined && sinistreStr !== '') sinistre = boolImport(sinistreStr, 'réclamation présentée');
    return { date, nature, montant, sinistre };
  });
}
// Période d'indemnité PE : 12/18/24 — nombres ou libellés FR des exports (« 12 mois »).
function periodePeImport(v, champ) {
  const s = String(v ?? '').trim().toLowerCase().replace(/mois/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || ![12, 18, 24].includes(n)) {
    throw new Error(`${champ} invalide (12/18/24 mois)`);
  }
  return n;
}
// Base d'indemnité PE : codes ou libellés FR des exports (« Bénéfice brut » / « Marge brute » / « Chiffre d'affaires »).
// Comparaison sur forme normalisée sans ponctuation (l'apostrophe de « Chiffre d'affaires »
// rend la conversion directe en code impossible — même piège que les en-têtes).
function basePeImport(v, champ) {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  if (!s) return null;
  if (s === 'beneficebrut') return 'benefice_brut';
  if (s === 'margebrute') return 'marge_brute';
  if (s === 'chiffredaffaires' || s === 'chiffreaffaires') return 'chiffre_affaires';
  throw new Error(`${champ} invalide (attendu : Bénéfice brut/Marge brute/Chiffre d'affaires)`);
}
// Base de valeur d'un établissement PE : codes ou libellés FR des exports
// (« Coût de remplacement » / « Valeur dépréciée »).
function baseValeurPeImport(v, champ) {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  if (!s) return null;
  if (s === 'remplacement' || s === 'coutderemplacement') return 'remplacement';
  if (s === 'depreciation' || s === 'valeurdepreciee') return 'depreciation';
  throw new Error(`${champ} invalide (attendu : Coût de remplacement/Valeur dépréciée)`);
}
// "AAAA-MM-JJ|cause|durée (jours)|montant" séparés par « ; » — interruptions (5 ans) PE ;
function parserInterruptionsPe(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.split(';').map((m) => m.trim()).filter(Boolean).map((morceau) => {
    const parts = morceau.split('|').map((p) => p.trim());
    if (parts.length < 4) throw new Error('interruptions 5 ans : format « AAAA-MM-JJ|cause|durée (jours)|montant » séparés par « ; »');
    const [date, cause, dureeStr, montantStr] = parts;
    if (!estDateValide(date)) throw new Error(`interruptions 5 ans : date invalide « ${date} » (AAAA-MM-JJ)`);
    if (!cause) throw new Error('interruptions 5 ans : cause requise');
    const duree = Number(String(dureeStr).replace(/\s/g, '').replace(',', '.'));
    if (isNaN(duree) || duree < 0 || !Number.isInteger(duree)) throw new Error(`interruptions 5 ans : durée invalide « ${dureeStr} »`);
    const montant = Number(String(montantStr).replace(/\s/g, '').replace(',', '.'));
    if (isNaN(montant) || montant < 0) throw new Error(`interruptions 5 ans : montant invalide « ${montantStr} »`);
    return { date, cause, duree_jours: duree, montant };
  });
}
// --- Parseurs flotte automobile (étape 6/10 flotte) -------------------------
// Usage (dominant ou par véhicule) : codes OU libellés FR des exports
// (« Transport de marchandises » → transport_marchandises). Comparaison sur
// forme normalisée (accents/ponctuation retirés) — leçon PE : un libellé FR
// ne se convertit jamais directement en code par simple normalisation.
function usageFlotteImport(v, champ, { dominant = false } = {}) {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  if (!s) return null;
  const table = {
    livraison: 'livraison', service: 'service', personnel: 'personnel',
    transportmarchandises: 'transport_marchandises',
    transportdemarchandises: 'transport_marchandises',
    mixte: 'mixte',
  };
  const code = table[s];
  const valides = dominant
    ? ['livraison', 'service', 'transport_marchandises', 'personnel', 'mixte']
    : ['livraison', 'service', 'transport_marchandises', 'personnel'];
  if (!code || !valides.includes(code)) {
    throw new Error(`${champ} invalide (attendu : ${valides.join('/')})`);
  }
  return code;
}
// "AAAA-MM-JJ|description|montant" (+ « |responsabilité » optionnel) séparés par « ; »
// — sinistres conducteurs (5 ans) et sinistres flotte (antécédents).
function parserSinistresFlotte(v, champ) {
  const l = parserListePipe(v, champ, 3);
  if (!l) return null;
  return l.map(({ date, reste }) => {
    const montant = Number(String(reste[1]).replace(/\s/g, '').replace(',', '.'));
    if (isNaN(montant) || montant < 0) throw new Error(`${champ} : montant invalide « ${reste[1]} »`);
    const out = { date, description: reste[0], montant };
    if (reste[2]) out.responsabilite = reste[2];
    return out;
  });
}
// --- Parseurs cautionnement (étape 6/10 cautionnement) -----------------------
// Type d'obligation : codes OU libellés FR des exports (« Cautionnement
// d'exécution (performance bond) » → execution). Comparaison sur forme
// normalisée sans ponctuation (leçon PE : un libellé FR ne se convertit jamais
// directement en code par simple normalisation).
function typeObligationCautImport(v, champ) {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  if (!s) return null;
  const table = {
    soumission: 'soumission', bidbond: 'soumission',
    cautionnementdesoumissionbidbond: 'soumission', cautionnementdesoumission: 'soumission',
    execution: 'execution', performancebond: 'execution',
    cautionnementdexecutionperformancebond: 'execution', cautionnementdexecution: 'execution',
    paiementmo: 'paiement_mo',
    paiementdelamainduvreetdesmateriaux: 'paiement_mo',
    paiementdelamaindoeuvretdesmateriaux: 'paiement_mo',
    paiementdelamaindoeuvre: 'paiement_mo',
    rbq: 'rbq', cautionnementdelicencerbq: 'rbq', licencerbq: 'rbq',
    autre: 'autre', autrecautionnement: 'autre',
  };
  const code = table[s];
  if (!code) throw new Error(`${champ} invalide (attendu : soumission/execution/paiement_mo/rbq/autre ou libellé FR)`);
  return code;
}
// « AAAA-MM-JJ|cautionnement|montant|statut » séparés par « ; » — réclamations
// contre cautionnements (5 ans). Le statut est optionnel.
function parserReclamationsCaut(v) {
  const l = parserListePipe(v, 'réclamations 5 ans', 3);
  if (!l) return null;
  return l.map(({ date, reste }) => {
    const montant = Number(String(reste[1]).replace(/\s/g, '').replace(',', '.'));
    if (isNaN(montant) || montant < 0) throw new Error(`réclamations 5 ans : montant invalide « ${reste[1]} »`);
    const out = { date, cautionnement: reste[0], montant };
    if (reste[2]) out.statut = reste[2];
    return out;
  });
}
// Round-trip exports → import : la colonne « Réclamations 5 ans (JSON) » des
// exports porte le JSON brut ; on le valide et on le normalise.
function parserReclamationsCautJson(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let arr;
  try { arr = JSON.parse(s); } catch (e) { throw new Error('réclamations 5 ans (JSON) : JSON invalide'); }
  if (!Array.isArray(arr)) throw new Error('réclamations 5 ans (JSON) : tableau attendu');
  return arr.map((x) => {
    if (!x || !estDateValide(String(x.date || ''))) throw new Error('réclamations 5 ans (JSON) : date invalide (AAAA-MM-JJ)');
    const out = { date: String(x.date), cautionnement: String(x.cautionnement || ''), montant: Number(x.montant) || 0 };
    if (x.statut) out.statut = String(x.statut);
    return out;
  });
}
// "AAAA-MM-JJ|description|points" séparés par « ; » — infractions conducteurs (3 ans)
function parserInfractionsFlotte(v) {
  const l = parserListePipe(v, 'infractions 3 ans', 3);
  if (!l) return null;
  return l.map(({ date, reste }) => {
    const points = Number(reste[1]);
    if (isNaN(points)) throw new Error(`infractions 3 ans : points invalides « ${reste[1]} »`);
    return { date, description: reste[0], points };
  });
}
// "formation|AAAA-MM-JJ|organisme" séparés par « ; » (date et organisme optionnels)
function parserFormationsFlotte(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.split(';').map((m) => m.trim()).filter(Boolean).map((morceau) => {
    const parts = morceau.split('|').map((p) => p.trim());
    if (!parts[0]) throw new Error('formations : nom de formation requis');
    const out = { formation: parts[0] };
    if (parts[1]) {
      if (!estDateValide(parts[1])) throw new Error(`formations : date invalide « ${parts[1]} » (AAAA-MM-JJ)`);
      out.date = parts[1];
    }
    if (parts[2]) out.organisme = parts[2];
    return out;
  });
}
// Équipements spéciaux : JSON des exports ([{"description":…,"valeur":…}])
// OU format pipe « description|valeur » séparés par « ; ».
function parserEquipementsFlotte(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.startsWith('[')) {
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) return j;
    } catch { /* pas du JSON : on retombe sur le format pipe */ }
  }
  return s.split(';').map((m) => m.trim()).filter(Boolean).map((morceau) => {
    const parts = morceau.split('|').map((p) => p.trim());
    if (!parts[0]) throw new Error('équipements spéciaux : description requise');
    const out = { description: parts[0] };
    if (parts[1] !== undefined && parts[1] !== '') {
      const val = Number(String(parts[1]).replace(/\s/g, '').replace(',', '.'));
      if (isNaN(val) || val < 0) throw new Error(`équipements spéciaux : valeur invalide « ${parts[1]} »`);
      out.valeur = val;
    }
    return out;
  });
}
// Avenants FAQ par libellés : « valeur à neuf;FAQ 20;crédit-bail » → {faq43:1, faq20:1, faq5a:1}.
// Codes (faq43…) et libellés FR des exports sont tous deux acceptés.
const LIBELLES_AVENANTS_FLOTTE = {
  faq43: 'faq43', valeuraneuf: 'faq43',
  faq20: 'faq20', privationdejouissance: 'faq20', fraisdedeplacement: 'faq20',
  faq27: 'faq27', vehiculenonappartenant: 'faq27',
  faq34: 'faq34', assurancedepersonnes: 'faq34',
  faq5a: 'faq5a', creditbail: 'faq5a',
};
function parserAvenantsFlotte(v) {
  const s = String(v ?? '').trim();
  if (!s) return {};
  const out = {};
  for (const tok of s.split(/[;,]/).map((t) => t.trim()).filter(Boolean)) {
    const cle = tok.toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const code = LIBELLES_AVENANTS_FLOTTE[cle];
    if (!code) {
      throw new Error(`avenants : « ${tok} » inconnu (attendu : FAQ 43/valeur à neuf, FAQ 20/privation de jouissance, FAQ 27, FAQ 34, FAQ 5a/crédit-bail)`);
    }
    out[code] = 1;
  }
  return out;
}
function parserModifications(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.split(';').map((m) => m.trim()).filter(Boolean);
}

// --- Modèles téléchargeables ------------------------------------------------------
const ENTETE = ['type', 'raison_sociale', 'neq', 'secteur_activite', 'courriel_entreprise', 'telephone_entreprise',
  'chiffre_affaires', 'nb_employes', 'prenom', 'nom', 'titre_contact',
  'courriel', 'telephone', 'adresse', 'ville', 'code_postal', 'langue', 'produit', 'assureur',
  'numero_police', 'date_effet', 'date_echeance', 'franchise', 'statut',
  'protection_code', 'protection_libelle', 'prime'];

const EXEMPLES = [
  ['entreprise', 'Constructions Méthot inc.', '1161234567', 'Construction', 'info@constructionsmethot.ca', '450-555-0199', '5200000', '35', 'Sylvain', 'Méthot', 'Président', 'sylvain.methot@constructionsmethot.ca', '514-555-0123', '1200 boul. Industriel', 'Laval', 'H7L 4B2', 'FR', '', '', '', '', '', '', '', '', '', ''],
  ['police', 'Constructions Méthot inc.', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'cgl', 'Intact Assurance', 'CGL-2025-10001', '2025-06-01', '2026-06-01', '2500', 'active', '', '', ''],
  ['protection', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'CGL-2025-10001', '', '', '', '', 'RC-GEN', 'Responsabilité civile générale (2 000 000 $)', '2850.00'],
];

// Modèles auto FPQ1 — en-têtes en français (miroir des exports)
const MODELES_AUTO = {
  soumission: {
    titre: 'Soumissions auto (FPQ1)',
    commentaire: [
      'Modèle : soumissions auto (FPQ1) — séparateur « ; »',
      'Rattachement : colonne « Entreprise » (raison sociale) ou « Courriel entreprise ».',
      'Statut accepté : brouillon, soumise. Dates au format AAAA-MM-JJ.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Date d’effet souhaitée', 'Statut', 'Notes'],
    exemples: [
      ['soumission', 'Garage Saint-Michel inc.', '', '2026-06-01', 'brouillon', 'Soumission 2 véhicules'],
    ],
  },
  conducteur: {
    titre: 'Conducteurs auto (FPQ1)',
    commentaire: [
      'Modèle : conducteurs auto (FPQ1) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») — la soumission active la plus récente est utilisée.',
      'Sexe : M/F. Conducteur principal : oui/non. Dates au format AAAA-MM-JJ.',
      'Infractions : « AAAA-MM-JJ|description|points » séparées par « ; » (ex. 2022-03-01|Excès de vitesse|3;2023-06-15|Feu rouge|2).',
      'Suspensions : « AAAA-MM-JJ|description » séparées par « ; ».',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Nom', 'Prénom', 'Date de naissance',
      'Sexe', 'État civil', 'N° de permis', 'Province du permis', 'Permis obtenu le',
      'Expérience au Canada (ans)', 'Expérience ailleurs (ans)', 'Lien avec l’assuré', 'Téléphone', 'Courriel',
      'Profession', 'Employeur', 'Conducteur principal', 'Infractions', 'Suspensions'],
    exemples: [
      ['conducteur', 'Garage Saint-Michel inc.', '', '', 'Tremblay', 'Jean', '1985-04-12', 'M', 'Marié', 'T1234567890123', 'QC', '2003-06-01', '20', '0', 'Assuré', '514-555-0101', 'jean.tremblay@exemple.ca', 'Mécanicien', 'Garage Saint-Michel', 'oui', '2022-03-01|Excès de vitesse|3', ''],
    ],
  },
  vehicule: {
    titre: 'Véhicules auto (FPQ1)',
    commentaire: [
      'Modèle : véhicules auto (FPQ1) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'NIV : 17 caractères (avertissement sinon, la ligne est quand même créée).',
      'RC — montant acceptés : 50000, 1000000, 2000000. Protection B : aucune, b1, b2, b3, b4.',
      'Avenants : oui/non. Modifications : liste séparée par « ; ».',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Année', 'Marque', 'Modèle', 'Version',
      'NIV', 'Carrosserie', 'Neuf / occasion', 'Date d’achat', 'Prix d’achat', 'Valeur estimée', 'Financement',
      'Créancier', 'Courriel créancier', 'Usage', 'Km annuel', '% hors Québec', 'Stationnement', 'Remisage hiver',
      'Modifications', 'Antivol TAG', 'Pneus d’hiver', 'Remorque',
      'RC — montant', 'Protection B', 'Franchise B', 'Prime',
      'Avenant FAQ 43 (valeur à neuf)', 'Avenant FAQ 20 (privation de jouissance)',
      'Avenant FAQ 27 (véhicule non appartenant)', 'Avenant FAQ 34 (assurance de personnes)',
      'Avenant FAQ 5a (crédit-bail)'],
    exemples: [
      ['vehicule', 'Garage Saint-Michel inc.', '', '', '2022', 'Toyota', 'RAV4', 'LE', '2T3RFREV9PW123456', 'VUS', 'occasion', '2024-03-15', '28000', '26000', 'financé', 'Banque Exemple', '', 'promenade', '18000', '5', 'garage privé', 'non', '', 'oui', 'oui', 'non', '2000000', 'b1', '500', '', 'oui', 'non', 'non', 'non', 'non'],
    ],
  },
  antecedents: {
    titre: 'Antécédents auto (FPQ1)',
    commentaire: [
      'Modèle : antécédents auto (FPQ1) — séparateur « ; » (une fiche par soumission).',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Champs oui/non : 1/0. Sinistres 6 ans : « AAAA-MM-JJ|type|montant|responsabilité » séparés par « ; ».',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Assureur actuel', 'Police actuelle',
      'Expiration actuelle', 'Années d’assurance continue', 'Résiliation antérieure', 'Non-paiement antérieur',
      'Faillite', 'Casier judiciaire', 'Sinistres 6 ans', 'Consentement crédit', 'Consentement dossier SAAQ', 'Consentement FCSA'],
    exemples: [
      ['antecedents', 'Garage Saint-Michel inc.', '', '', 'Intact Assurance', 'AUTO-2024-555', '2026-06-01', '8', 'non', 'non', 'non', 'non', '2023-05-01|Collision|2500|responsable', 'oui', 'oui', 'oui'],
    ],
  },
};

// Modèles biens commerciaux — en-têtes en français (miroir des exports biens)
const MODELES_BIENS = {
  soumission_biens: {
    titre: 'Soumissions biens',
    commentaire: [
      'Modèle : soumissions biens — séparateur « ; »',
      'Rattachement : colonne « Entreprise » (raison sociale) ou « Courriel entreprise ».',
      'Statut accepté : brouillon, soumise. Dates au format AAAA-MM-JJ.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Date d’effet souhaitée', 'Statut', 'Notes'],
    exemples: [
      ['soumission_biens', 'Immeubles Rigaud inc.', '', '2026-09-01', 'brouillon', 'Soumission immeuble commercial'],
    ],
  },
  batiment: {
    titre: 'Bâtiments (biens)',
    commentaire: [
      'Modèle : bâtiments (biens) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») — la soumission biens active la plus récente est utilisée.',
      'Type de construction : bois, acier, beton, maconnerie, mixte. Gicleurs : oui/non.',
      'Distances et valeurs : nombres (point ou virgule décimale). Dates/années au format numérique.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Adresse', 'Ville', 'Code postal',
      'Type de construction', 'Année de construction', 'Superficie (pi²)', 'Nb d’étages', 'Occupation',
      'Valeur du bâtiment', 'Gicleurs', 'Distance caserne (km)', 'Chauffage', 'Année de la toiture', 'Notes'],
    exemples: [
      ['batiment', 'Immeubles Rigaud inc.', '', '', '4500 boul. Saint-Laurent', 'Montréal', 'H2T 1R5', 'beton', '1985', '25000', '3', 'bureaux', '1800000', 'oui', '2,5', 'électrique', '2015', 'Toit refait en 2015'],
    ],
  },
  contenu: {
    titre: 'Contenus (biens)',
    commentaire: [
      'Modèle : contenus (biens) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Bâtiment : « Bâtiment (id) » OU « Adresse du bâtiment » — laissez vide pour un contenu général de la soumission.',
      'Type de contenu : mobilier, equipements, stock, ameliorations, autre.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Bâtiment (id)', 'Adresse du bâtiment',
      'Description', 'Type de contenu', 'Valeur', 'Notes'],
    exemples: [
      ['contenu', 'Immeubles Rigaud inc.', '', '', '', '4500 boul. Saint-Laurent', 'Mobilier de bureau', 'equipements', '85000', ''],
      ['contenu', 'Immeubles Rigaud inc.', '', '', '', '', 'Améliorations locatives', 'ameliorations', '50000', 'Contenu général'],
    ],
  },
  garanties_biens: {
    titre: 'Garanties biens',
    commentaire: [
      'Modèle : garanties biens (une fiche par bâtiment) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») + « Bâtiment (id) » OU « Adresse du bâtiment ».',
      'Formule : tous_risques, risques_designes. Avenants : oui/non ou 0/1.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Bâtiment (id)', 'Adresse du bâtiment',
      'Formule', 'Franchise', 'Montant d’assurance', 'Prime',
      'Avenant — tremblement de terre', 'Avenant — inondation', 'Avenant — refoulement d’égout',
      'Avenant — bris de machines', 'Avenant — perte d’exploitation liée'],
    exemples: [
      ['garanties_biens', 'Immeubles Rigaud inc.', '', '', '', '4500 boul. Saint-Laurent', 'tous_risques', '2500', '1800000', '', 'oui', 'oui', 'non', 'non', 'non'],
    ],
  },
  antecedents_biens: {
    titre: 'Antécédents biens',
    commentaire: [
      'Modèle : antécédents biens (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Champs oui/non : 1/0. Sinistres 5 ans : « AAAA-MM-JJ|type|montant » séparés par « ; ».',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Assureur actuel', 'Police actuelle',
      'Expiration actuelle', 'Années d’assurance continue', 'Sinistres 5 ans', 'Consentement crédit',
      'Consentement dossier d’assurance'],
    exemples: [
      ['antecedents_biens', 'Immeubles Rigaud inc.', '', '', 'Assurance Exemple inc.', 'BIEN-2024-777', '2026-09-01', '6', '2023-02-14|Dégât d’eau|12000', 'oui', 'oui'],
    ],
  },
};

// Modèles RC commerciale — en-têtes en français (miroir des exports RC, étape 6/10 RC)
const MODELES_RC = {
  soumission_rc: {
    titre: 'Soumissions RC',
    commentaire: [
      'Modèle : soumissions RC — séparateur « ; »',
      'Rattachement : colonne « Entreprise » (raison sociale) ou « Courriel entreprise ».',
      'Statut accepté : brouillon, soumise. Dates au format AAAA-MM-JJ.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Date d’effet souhaitée', 'Statut', 'Notes'],
    exemples: [
      ['soumission_rc', 'Constructions Méthot inc.', '', '2026-11-01', 'brouillon', 'Soumission RC atelier + entrepôt'],
    ],
  },
  lieu_rc: {
    titre: 'Lieux d’exploitation (RC)',
    commentaire: [
      'Modèle : lieux d’exploitation (RC) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») — la soumission RC active la plus récente est utilisée.',
      'Sous-traitants : aucun, assures, non_assures. Montants : nombres (point ou virgule décimale).',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Adresse', 'Ville', 'Code postal',
      'Activité', 'Code de classification', 'Description des activités', 'Chiffre d’affaires', 'Masse salariale',
      'Nb d’employés', 'Superficie (pi²)', 'Sous-traitants', 'Notes'],
    exemples: [
      ['lieu_rc', 'Constructions Méthot inc.', '', '', '1200 boul. Industriel', 'Laval', 'H7L 4B2', 'atelier de réparation', '54321', 'Réparation de machinerie lourde', '2500000', '800000', '22', '15000', 'assures', ''],
    ],
  },
  garanties_rc: {
    titre: 'Garanties RC',
    commentaire: [
      'Modèle : garanties RC (une fiche par lieu d’exploitation) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») + « Lieu (id) » OU « Adresse du lieu ».',
      'Formule : locaux_operations, produits_completes, globale. Avenants : oui/non ou 0/1. Limites et prime en $.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Lieu (id)', 'Adresse du lieu',
      'Formule de garantie', 'Limite par sinistre', 'Limite agrégat', 'Franchise', 'Prime',
      'Avenant — pollution', 'Avenant — parapluie'],
    exemples: [
      ['garanties_rc', 'Constructions Méthot inc.', '', '', '', '1200 boul. Industriel', 'locaux_operations', '2000000', '4000000', '2500', '', 'oui', 'non'],
    ],
  },
  antecedents_rc: {
    titre: 'Antécédents RC',
    commentaire: [
      'Modèle : antécédents RC (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Champs oui/non : 1/0. Sinistres 5 ans : « AAAA-MM-JJ|type|montant » séparés par « ; ».',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Assureur actuel', 'Police actuelle',
      'Expiration actuelle', 'Années d’assurance continue', 'Sinistres 5 ans', 'Consentement crédit',
      'Consentement dossier d’assurance'],
    exemples: [
      ['antecedents_rc', 'Constructions Méthot inc.', '', '', 'Intact Assurance', 'CGL-2024-300', '2026-11-01', '7', '2024-04-10|Blessure visiteur|8000', 'oui', 'oui'],
    ],
  },
};

// Modèles cyber / cyberrisques — en-têtes en français (miroir des exports cyber, étape 6/10 cyber)
const MODELES_CYBER = {
  soumission_cyber: {
    titre: 'Soumissions cyber',
    commentaire: [
      'Modèle : soumissions cyber — séparateur « ; »',
      'Rattachement : colonne « Entreprise » (raison sociale) ou « Courriel entreprise ».',
      'Statut accepté : brouillon, soumise. Dates au format AAAA-MM-JJ.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Date d’effet souhaitée', 'Statut', 'Notes'],
    exemples: [
      ['soumission_cyber', 'Clinique Dentaire Bouchard inc.', '', '2026-11-18', 'brouillon', 'Renouvellement cyber — protection des dossiers patients'],
    ],
  },
  mesure_cyber: {
    titre: 'Mesures de sécurité (cyber)',
    commentaire: [
      'Modèle : mesures de sécurité (cyber, en nombre illimité) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») — la soumission cyber active la plus récente est utilisée.',
      'Type de mesure : mfa, sauvegardes, antivirus_edr, pare_feu, formation_hameconnage, plan_reponse_incident, chiffrement, gestion_correctifs, controle_acces, autre.',
      'Maturité : en_place, partiel, absent, prevu.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Type de mesure', 'Maturité',
      'Détails de la mesure', 'Notes'],
    exemples: [
      ['mesure_cyber', 'Clinique Dentaire Bouchard inc.', '', '', 'mfa', 'en_place', 'MFA forcée sur tous les comptes', ''],
    ],
  },
  garanties_cyber: {
    titre: 'Garanties cyber',
    commentaire: [
      'Modèle : garanties cyber (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Limites, franchise et prime en $. Délai de carence en texte libre (ex. 8 heures). Avenants : oui/non ou 0/1.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Limite par sinistre', 'Limite agrégat',
      'Franchise', 'Délai de carence', 'Prime',
      'Avenant — rançongiciel', 'Avenant — fraude par transfert de fonds',
      'Avenant — données et vie privée', 'Avenant — interruption d’activité'],
    exemples: [
      ['garanties_cyber', 'Clinique Dentaire Bouchard inc.', '', '', '1000000', '1000000', '5000', '8 heures', '2400', 'oui', 'non', 'oui', 'non'],
    ],
  },
  antecedents_cyber: {
    titre: 'Antécédents cyber',
    commentaire: [
      'Modèle : antécédents cyber (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Champs oui/non : 1/0. Incidents cyber 5 ans : « AAAA-MM-JJ|type|montant » séparés par « ; » (ajoutez « |oui » si le sinistre a été réclamé, ex. 2024-02-11|Rançongiciel|28000|non).',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Assureur actuel', 'Police actuelle',
      'Expiration actuelle', 'Années d’assurance continue', 'Incidents cyber 5 ans', 'Consentement crédit',
      'Consentement dossier d’assurance'],
    exemples: [
      ['antecedents_cyber', 'Clinique Dentaire Bouchard inc.', '', '', 'Beneva', 'CYB-2024-70112', '2026-11-18', '3', '2024-02-11|Rançongiciel|28000|non', 'oui', 'oui'],
    ],
  },
};

// Modèles E&O / responsabilité professionnelle — en-têtes en français (miroir des exports E&O, étape 6/10 E&O)
const MODELES_EO = {
  soumission_eo: {
    titre: 'Soumissions E&O',
    commentaire: [
      'Modèle : soumissions E&O — séparateur « ; »',
      'Rattachement : colonne « Entreprise » (raison sociale) ou « Courriel entreprise ».',
      'Statut accepté : brouillon, soumise. Dates au format AAAA-MM-JJ.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Date d’effet souhaitée', 'Statut', 'Notes'],
    exemples: [
      ['soumission_eo', 'Groupe Conseil Lussier inc.', '', '2026-12-01', 'brouillon', 'Soumission E&O — consultants TI'],
    ],
  },
  activite_eo: {
    titre: 'Activités professionnelles (E&O)',
    commentaire: [
      'Modèle : activités professionnelles (E&O, en nombre illimité) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») — la soumission E&O active la plus récente est utilisée.',
      'Description de l’activité : obligatoire. Chiffre d’affaires : exposition tarifaire ($).',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Activité professionnelle',
      'Chiffre d’affaires ($)', 'Nb de professionnels', 'Notes'],
    exemples: [
      ['activite_eo', 'Groupe Conseil Lussier inc.', '', '', 'Conseil en transformation numérique', '450000', '4', 'TPE/PME'],
    ],
  },
  garanties_eo: {
    titre: 'Garanties E&O',
    commentaire: [
      'Modèle : garanties E&O (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Base de garantie : Réclamations-présentées ou Occurrences (les libellés FR des exports sont acceptés).',
      'Limites, franchise et prime en $. Avenants : oui/non ou 0/1.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Limite par sinistre', 'Limite agrégat',
      'Franchise', 'Base de garantie', 'Prime',
      'Avenant — frais de défense', 'Avenant — médias et contenu', 'Avenant — cyber associé'],
    exemples: [
      ['garanties_eo', 'Groupe Conseil Lussier inc.', '', '', '2000000', '2000000', '10000', 'Réclamations-présentées', '9500', 'oui', 'oui', 'non'],
    ],
  },
  antecedents_eo: {
    titre: 'Antécédents E&O',
    commentaire: [
      'Modèle : antécédents E&O (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Champs oui/non : 1/0. Réclamations E&O 5 ans : « AAAA-MM-JJ|nature|montant » séparés par « ; » (ajoutez « |oui » si la réclamation a été présentée, ex. 2023-06-15|Erreur d’implantation|45000|oui).',
      'Circonstances : faits ou situations pouvant donner lieu à une réclamation (question piège en claims-made).',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Assureur actuel', 'Police actuelle',
      'Expiration actuelle', 'Années d’assurance continue', 'Réclamations E&O 5 ans', 'Circonstances',
      'Consentement crédit', 'Consentement dossier d’assurance'],
    exemples: [
      ['antecedents_eo', 'Groupe Conseil Lussier inc.', '', '', 'Assureur Exemple inc.', 'EO-2024-900', '2026-12-01', '4', '2023-06-15|Erreur d’implantation|45000|oui', 'Un client a menacé de poursuivre', 'oui', 'oui'],
    ],
  },
};

// Modèles D&O / administrateurs et dirigeants — en-têtes en français (miroir des exports D&O, étape 6/10 D&O)
const MODELES_DO = {
  soumission_do: {
    titre: 'Soumissions D&O',
    commentaire: [
      'Modèle : soumissions D&O — séparateur « ; »',
      'Rattachement : colonne « Entreprise » (raison sociale) ou « Courriel entreprise ».',
      'Statut accepté : brouillon, soumise. Dates au format AAAA-MM-JJ.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Date d’effet souhaitée', 'Statut', 'Notes'],
    exemples: [
      ['soumission_do', 'Forges Bélanger inc.', '', '2026-12-01', 'brouillon', 'Soumission D&O — manufacture'],
    ],
  },
  dirigeant_do: {
    titre: 'Dirigeants (D&O)',
    commentaire: [
      'Modèle : dirigeants D&O (en nombre illimité) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») — la soumission D&O active la plus récente est utilisée.',
      'Nom du dirigeant : obligatoire. Années d’expérience : entier 0-80.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Nom du dirigeant',
      'Fonction / titre', 'Années d’expérience', 'Antécédents personnels'],
    exemples: [
      ['dirigeant_do', 'Forges Bélanger inc.', '', '', 'Marc Bélanger', 'Président', '18', 'Aucune réclamation ou poursuite personnelle.'],
    ],
  },
  garanties_do: {
    titre: 'Garanties D&O',
    commentaire: [
      'Modèle : garanties D&O (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Base de garantie : Réclamations-présentées ou Occurrences (les libellés FR des exports sont acceptés).',
      'Limites, franchise et prime en $. Avenants : oui/non ou 0/1.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Limite par sinistre', 'Limite agrégat',
      'Franchise', 'Base de garantie', 'Prime',
      'Avenant — frais de défense', 'Avenant — pratiques d’emploi', 'Avenant — fidélité / crime'],
    exemples: [
      ['garanties_do', 'Forges Bélanger inc.', '', '', '2000000', '2000000', '25000', 'Réclamations-présentées', '4500', 'oui', 'non', 'non'],
    ],
  },
  antecedents_do: {
    titre: 'Antécédents D&O',
    commentaire: [
      'Modèle : antécédents D&O (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Champs oui/non : 1/0. Réclamations D&O 5 ans : « AAAA-MM-JJ|nature|montant » séparés par « ; » (ajoutez « |oui » si la réclamation a été présentée).',
      'Poursuites en cours ou envisagées : question piège en claims-made — ne jamais laisser vide.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Assureur actuel', 'Police actuelle',
      'Expiration actuelle', 'Années d’assurance continue', 'Réclamations D&O 5 ans', 'Poursuites en cours ou envisagées',
      'Consentement crédit', 'Consentement dossier d’assurance'],
    exemples: [
      ['antecedents_do', 'Forges Bélanger inc.', '', '', 'Aucun', '', '', '0', '2022-08-30|Poursuite d’un actionnaire minoritaire|120000|oui', 'Aucune poursuite en cours ni envisagée.', 'oui', 'non'],
    ],
  },
};

// Modèles perte d'exploitation — en-têtes en français (miroir des exports PE, étape 6/10 PE)
const MODELES_PE = {
  soumission_pe: {
    titre: 'Soumissions perte d’exploitation',
    commentaire: [
      'Modèle : soumissions perte d’exploitation — séparateur « ; »',
      'Rattachement : colonne « Entreprise » (raison sociale) ou « Courriel entreprise ».',
      'Statut accepté : brouillon, soumise, convertie_police. Dates au format AAAA-MM-JJ.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Date d’effet souhaitée', 'Statut', 'Notes'],
    exemples: [
      ['soumission_pe', 'Boulangerie Chaleur inc.', '', '2026-11-29', 'brouillon', 'Renouvellement perte d’exploitation'],
    ],
  },
  etablissement_pe: {
    titre: 'Établissements (perte d’exploitation)',
    commentaire: [
      'Modèle : établissements perte d’exploitation (en nombre illimité) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») — la soumission PE active la plus récente est utilisée.',
      'Nom du lieu OU adresse : au moins un des deux est obligatoire.',
      'Base de valeur : Coût de remplacement ou Valeur dépréciée.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Nom du lieu', 'Adresse du lieu',
      'Occupation', 'Chiffre d’affaires ($)', 'Superficie (m²)', 'Année de construction', 'Base de valeur', 'Notes'],
    exemples: [
      ['etablissement_pe', 'Boulangerie Chaleur inc.', '', '', 'Fournil', '123 rue Sainte-Catherine E, Montréal', 'Boulangerie — fournil', '750000', '250', '1965', 'Coût de remplacement', ''],
    ],
  },
  garanties_pe: {
    titre: 'Garanties perte d’exploitation',
    commentaire: [
      'Modèle : garanties perte d’exploitation (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Période d’indemnité : 12, 18 ou 24 mois (les libellés FR des exports « 12 mois » sont acceptés).',
      'Base d’indemnité : Bénéfice brut, Marge brute ou Chiffre d’affaires (les libellés FR des exports sont acceptés).',
      'Franchise en jours (délai de carence). Limite et prime en $. Avenants : oui/non ou 0/1.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Limite', 'Période d’indemnité',
      'Franchise (jours)', 'Base d’indemnité', 'Prime',
      'Avenant — frais supplémentaires', 'Avenant — dépendance aux fournisseurs',
      'Avenant — accès civil', 'Avenant — détérioration des stocks'],
    exemples: [
      ['garanties_pe', 'Boulangerie Chaleur inc.', '', '', '800000', '12 mois', '3', 'Marge brute', '2800', 'oui', 'non', 'non', 'oui'],
    ],
  },
  antecedents_pe: {
    titre: 'Antécédents perte d’exploitation',
    commentaire: [
      'Modèle : antécédents perte d’exploitation (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Champs oui/non : 1/0. Interruptions 5 ans : « AAAA-MM-JJ|cause|durée (jours)|montant » séparés par « ; ».',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Assureur actuel', 'Police actuelle',
      'Expiration actuelle', 'Années d’assurance continue', 'Interruptions 5 ans',
      'Consentement crédit', 'Consentement dossier d’assurance'],
    exemples: [
      ['antecedents_pe', 'Boulangerie Chaleur inc.', '', '', 'Beneva', 'PE-2022-4410', '2026-11-29', '4', '2022-03-11|Bris d’équipement (four)|6|28000', 'oui', 'oui'],
    ],
  },
};

// Modèles flotte automobile — en-têtes en français (miroir des exports flotte, étape 6/10 flotte)
// Choix des types : 5 (et non 4 comme PE) — la flotte a DEUX lignes illimitées
// (véhicules ET conducteurs), chacune avec son type, plus soumission / garanties /
// antécédents calqués sur PE. Le système d'import accepte un nombre libre de types.
const MODELES_FLOTTE = {
  soumission_flotte: {
    titre: 'Soumissions flotte',
    commentaire: [
      'Modèle : soumissions flotte automobile — séparateur « ; »',
      'Rattachement : colonne « Entreprise » (raison sociale) ou « Courriel entreprise ».',
      'Statut accepté : brouillon, soumise, convertie_police. Dates au format AAAA-MM-JJ.',
      'Usage dominant : livraison, service, transport de marchandises, personnel ou mixte (codes ou libellés FR).',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Date d’effet souhaitée', 'Date d’échéance visée',
      'Statut', 'Usage dominant', 'Rayon d’opération (km)', 'Nb véhicules déclarés', 'Assureur', 'N° de police', 'Notes'],
    exemples: [
      ['soumission_flotte', 'Transport Lapointe inc.', '', '2026-12-01', '', 'brouillon', 'Livraison', '160', '4', 'Intact Assurance', '', 'Renouvellement flotte — 4 véhicules, 3 conducteurs'],
    ],
  },
  vehicule_flotte: {
    titre: 'Véhicules (flotte)',
    commentaire: [
      'Modèle : véhicules flotte (en nombre illimité) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») — la soumission flotte active la plus récente est utilisée.',
      'Type de véhicule : Camion, Automobile, Remorque ou Équipement (libellés FR ou codes camion/automobile/remorque/equipement).',
      'Usage : Livraison, Service, Transport de marchandises ou Personnel (libellés FR ou codes).',
      'Conducteur principal : nom d’un conducteur de la soumission (fiche liée) ou nom libre.',
      'Équipements spéciaux : « description|valeur » séparés par « ; » (ou le JSON des exports).',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'NIV', 'Année', 'Marque', 'Modèle',
      'Type de véhicule', 'Usage', 'Rayon d’opération (km)', 'Lieu de remisage', 'Valeur', 'Année d’acquisition',
      'Conducteur principal', 'Équipements spéciaux'],
    exemples: [
      ['vehicule_flotte', 'Transport Lapointe inc.', '', '', '1FTBW3CM5KKB12345', '2022', 'Ford', 'Transit 250', 'Camion', 'Livraison', '160', '2450 boulevard Industriel, Laval', '62000', '2022', 'Marc Gagnon', 'Hayon élévateur|6500'],
    ],
  },
  conducteur_flotte: {
    titre: 'Conducteurs (flotte)',
    commentaire: [
      'Modèle : conducteurs flotte (en nombre illimité) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») — la soumission flotte active la plus récente est utilisée.',
      'Nom et prénom : requis. Dates au format AAAA-MM-JJ.',
      'Sinistres 5 ans : « AAAA-MM-JJ|description|montant » séparés par « ; » (ajoutez « |responsabilité » si besoin).',
      'Infractions 3 ans : « AAAA-MM-JJ|description|points » séparées par « ; ».',
      'Formations : « formation|AAAA-MM-JJ|organisme » séparées par « ; ».',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Nom', 'Prénom', 'Date de naissance',
      'Âge', 'N° de permis', 'Classe de permis', 'Années d’expérience', 'Années d’expérience — véhicules lourds',
      'Date d’embauche', 'Sinistres 5 ans', 'Infractions 3 ans', 'Formations'],
    exemples: [
      ['conducteur_flotte', 'Transport Lapointe inc.', '', '', 'Gagnon', 'Marc', '1985-09-23', '', 'G556-230985-02', '3', '15', '11', '2016-03-14', '2023-07-19|Accrochage en reculant|4200|partagee', '2024-02-02|Excès de vitesse|3', 'Conduite préventive|2024-05-10|Centre de formation en transport'],
    ],
  },
  garanties_flotte: {
    titre: 'Garanties flotte',
    commentaire: [
      'Modèle : garanties flotte (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Limite RC, franchises et prime en $. Avenants : oui/non ou 0/1 par colonne FAQ,',
      'ou liste de libellés dans la colonne « Avenants » (ex. valeur à neuf;FAQ 20;crédit-bail).',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Limite RC', 'Franchise collision',
      'Franchise versement', 'Prime',
      'Avenant FAQ 43 (valeur à neuf)', 'Avenant FAQ 20 (privation de jouissance)',
      'Avenant FAQ 27 (véhicule non appartenant)', 'Avenant FAQ 34 (assurance de personnes)',
      'Avenant FAQ 5a (crédit-bail)', 'Avenants'],
    exemples: [
      ['garanties_flotte', 'Transport Lapointe inc.', '', '', '2000000', '1000', '1000', '9850', 'oui', 'oui', 'oui', 'oui', 'non', ''],
    ],
  },
  antecedents_flotte: {
    titre: 'Antécédents flotte',
    commentaire: [
      'Modèle : antécédents flotte (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Champs oui/non : 1/0. Sinistres flotte 5 ans : « AAAA-MM-JJ|description|montant » séparés par « ; ».',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Assureur actuel', 'Police actuelle',
      'Expiration actuelle', 'Années d’assurance flotte continue', 'Sinistres flotte 5 ans', 'Ratio de pertes (%)',
      'Refus ou annulation antérieur', 'Détails du refus / de l’annulation',
      'Consentement crédit', 'Consentement dossier SAAQ', 'Consentement FCSA'],
    exemples: [
      ['antecedents_flotte', 'Transport Lapointe inc.', '', '', 'Intact Assurance', 'FLT-2023-7781', '', '6', '2023-07-19|Accrochage en manœuvre de recul|4200', '18,5', 'non', '', 'oui', 'oui', 'non'],
    ],
  },
};

// --- Modèles flotte automobile téléchargeables (étape 6/10 flotte) -------------------------------------
router.get('/modele-flotte/:type', (req, res) => {
  const m = MODELES_FLOTTE[req.params.type];
  if (!m) return res.status(404).render('erreur', { titre: 'Modèle inconnu', message: 'Type de modèle invalide.' });
  const lignes = [
    ...m.commentaire.map((c) => '# ' + c),
    m.entete.join(';'),
    ...m.exemples.map((l) => l.join(';')),
  ];
  const contenu = '﻿' + lignes.join('\r\n'); // BOM pour Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="modele-import-flotte-${req.params.type}.csv"`);
  res.send(contenu);
});

// Modèles cautionnement — en-têtes en français (miroir des exports cautionnement, étape 6/10 cautionnement)
// 4 types : soumission (en-tête du principal), obligation (illimitée), ligne (ligne de
// cautionnement UNIQUE par soumission), antecedents (réclamations 5 ans au format pipe
// OU JSON des exports).
const MODELES_CAUTIONNEMENT = {
  soumission_caut: {
    titre: 'Soumissions cautionnement',
    commentaire: [
      'Modèle : soumissions cautionnement — séparateur « ; »',
      'Rattachement : colonne « Entreprise » (raison sociale du principal) ou « Courriel entreprise ».',
      'Statut accepté : brouillon, soumise, convertie_police (codes ou libellés FR). Dates au format AAAA-MM-JJ.',
      'La caution visée est l’assureur de cautionnement (ex. Intact Cautionnement, Travelers Canada, Aviva).',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Date d’effet souhaitée', 'Date d’échéance visée',
      'Statut', 'Caution visée', 'N° de police', 'Secteur d’activité', 'Année de fondation',
      'Chiffre d’affaires annuel', 'Nombre d’employés', 'Notes'],
    exemples: [
      ['soumission_caut', 'Construction Verdon inc.', '', '2026-12-01', '', 'brouillon', 'Intact Cautionnement', '', 'Construction — entrepreneur général', '2008', '8500000', '42', 'Renouvellement ligne de cautionnement'],
    ],
  },
  obligation_caut: {
    titre: 'Obligations (cautionnement)',
    commentaire: [
      'Modèle : obligations — cautionnements émis, en nombre illimité — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise ») — la soumission cautionnement active la plus récente est utilisée.',
      'Type : codes (soumission, execution, paiement_mo, rbq, autre) OU libellés FR des exports (« Cautionnement d’exécution (performance bond) », « Cautionnement de licence RBQ », etc.).',
      'Le bénéficiaire est le donneur d’ouvrage. Montant d’exécution type : 50 % du contrat. RBQ : 20 000 $ (spécialisés) / 40 000 $ (généraux).',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Type de cautionnement',
      'Bénéficiaire (donneur d’ouvrage)', 'Description du projet', 'Montant du contrat',
      'Montant du cautionnement', 'Taux (%)', 'Prime estimée', 'Date de début', 'Durée (mois)'],
    exemples: [
      ['obligation_caut', 'Construction Verdon inc.', '', '', 'Cautionnement d’exécution (performance bond)', 'Centre de services scolaire des Mille-Îles', 'Construction école primaire', '2200000', '1100000', '1,25', '13750', '', ''],
    ],
  },
  ligne_caut: {
    titre: 'Lignes de cautionnement',
    commentaire: [
      'Modèle : ligne de cautionnement (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'La limite par projet ne peut pas dépasser la limite globale (rejetée sinon).',
      'Le fonds de roulement est le critère clé de la caution (analyse des états financiers).',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)',
      'Limite globale (capacité)', 'Limite par projet', 'Fonds de roulement', 'Valeur nette', 'Prime de la ligne'],
    exemples: [
      ['ligne_caut', 'Construction Verdon inc.', '', '', '5000000', '2500000', '850000', '1900000', '21500'],
    ],
  },
  antecedents_caut: {
    titre: 'Antécédents cautionnement',
    commentaire: [
      'Modèle : antécédents de cautionnement (une fiche par soumission) — séparateur « ; »',
      'Rattachement : « Soumission (id) » OU « Entreprise » (+ « Courriel entreprise »).',
      'Champs oui/non : 1/0. Réclamations 5 ans : « AAAA-MM-JJ|cautionnement|montant|statut » séparées par « ; »',
      '(statut optionnel ; ex. réglée, en cours). Le JSON des exports est accepté dans la colonne « Réclamations 5 ans (JSON) ».',
      'Tout refus ou résiliation de cautionnement doit être déclaré — piège classique d’omission.',
    ],
    entete: ['type', 'Entreprise', 'Courriel entreprise', 'Soumission (id)', 'Caution actuelle', 'Ligne actuelle',
      'Expiration ligne actuelle', 'Années de cautionnement continu', 'Réclamations 5 ans',
      'Refus ou résiliation antérieur', 'Détails du refus / de la résiliation',
      'Consentement crédit', 'Consentement états financiers'],
    exemples: [
      ['antecedents_caut', 'Construction Verdon inc.', '', '', 'Intact Cautionnement', 'CAUT-2021-3355', '', '8', '', 'non', '', 'oui', 'oui'],
    ],
  },
};

// --- Modèles cautionnement téléchargeables (étape 6/10 cautionnement) -------------------------------------
router.get('/modele-cautionnement/:type', (req, res) => {
  const m = MODELES_CAUTIONNEMENT[req.params.type];
  if (!m) return res.status(404).render('erreur', { titre: 'Modèle inconnu', message: 'Type de modèle invalide.' });
  const lignes = [
    ...m.commentaire.map((c) => '# ' + c),
    m.entete.join(';'),
    ...m.exemples.map((l) => l.join(';')),
  ];
  const contenu = '﻿' + lignes.join('\r\n'); // BOM pour Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="modele-import-cautionnement-${req.params.type}.csv"`);
  res.send(contenu);
});

// --- Modèles D&O téléchargeables (étape 6/10 D&O) --------------------------------------------------------
router.get('/modele-do/:type', (req, res) => {
  const m = MODELES_DO[req.params.type];
  if (!m) return res.status(404).render('erreur', { titre: 'Modèle inconnu', message: 'Type de modèle invalide.' });
  const lignes = [
    ...m.commentaire.map((c) => '# ' + c),
    m.entete.join(';'),
    ...m.exemples.map((l) => l.join(';')),
  ];
  const contenu = '﻿' + lignes.join('\r\n'); // BOM pour Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="modele-import-do-${req.params.type}.csv"`);
  res.send(contenu);
});

// --- Modèles perte d'exploitation téléchargeables (étape 6/10 PE) ---------------------------------------
router.get('/modele-pe/:type', (req, res) => {
  const m = MODELES_PE[req.params.type];
  if (!m) return res.status(404).render('erreur', { titre: 'Modèle inconnu', message: 'Type de modèle invalide.' });
  const lignes = [
    ...m.commentaire.map((c) => '# ' + c),
    m.entete.join(';'),
    ...m.exemples.map((l) => l.join(';')),
  ];
  const contenu = '﻿' + lignes.join('\r\n'); // BOM pour Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="modele-import-pe-${req.params.type}.csv"`);
  res.send(contenu);
});

// --- Page d'import ---------------------------------------------------------------------------------
router.get('/', (req, res) => {
  res.render('import/index', {
    rapport: null, produits: PRODUITS, NOMS_LIGNES,
    modelesAuto: Object.entries(MODELES_AUTO).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesBiens: Object.entries(MODELES_BIENS).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesRc: Object.entries(MODELES_RC).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesCyber: Object.entries(MODELES_CYBER).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesEo: Object.entries(MODELES_EO).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesDo: Object.entries(MODELES_DO).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesPe: Object.entries(MODELES_PE).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesFlotte: Object.entries(MODELES_FLOTTE).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesCautionnement: Object.entries(MODELES_CAUTIONNEMENT).map(([cle, m]) => ({ cle, titre: m.titre })),
  });
});

// --- Modèle classique téléchargeable ------------------------------------------------------------------
router.get('/modele', (req, res) => {
  const lignes = [ENTETE.join(';'), ...EXEMPLES.map((l) => l.join(';'))];
  const contenu = '﻿' + lignes.join('\r\n'); // BOM pour Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modele-import.csv"');
  res.send(contenu);
});

// --- Modèles auto FPQ1 téléchargeables ------------------------------------------------------------------
router.get('/modele-auto/:type', (req, res) => {
  const m = MODELES_AUTO[req.params.type];
  if (!m) return res.status(404).render('erreur', { titre: 'Modèle inconnu', message: 'Type de modèle invalide.' });
  const lignes = [
    ...m.commentaire.map((c) => '# ' + c),
    m.entete.join(';'),
    ...m.exemples.map((l) => l.join(';')),
  ];
  const contenu = '﻿' + lignes.join('\r\n'); // BOM pour Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="modele-import-auto-${req.params.type}.csv"`);
  res.send(contenu);
});

// --- Modèles biens commerciaux téléchargeables --------------------------------------------------------
router.get('/modele-biens/:type', (req, res) => {
  const m = MODELES_BIENS[req.params.type];
  if (!m) return res.status(404).render('erreur', { titre: 'Modèle inconnu', message: 'Type de modèle invalide.' });
  const lignes = [
    ...m.commentaire.map((c) => '# ' + c),
    m.entete.join(';'),
    ...m.exemples.map((l) => l.join(';')),
  ];
  const contenu = '﻿' + lignes.join('\r\n'); // BOM pour Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="modele-import-biens-${req.params.type}.csv"`);
  res.send(contenu);
});

// --- Modèles RC commerciale téléchargeables (étape 6/10 RC) -----------------------------------------------
router.get('/modele-rc/:type', (req, res) => {
  const m = MODELES_RC[req.params.type];
  if (!m) return res.status(404).render('erreur', { titre: 'Modèle inconnu', message: 'Type de modèle invalide.' });
  const lignes = [
    ...m.commentaire.map((c) => '# ' + c),
    m.entete.join(';'),
    ...m.exemples.map((l) => l.join(';')),
  ];
  const contenu = '﻿' + lignes.join('\r\n'); // BOM pour Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="modele-import-rc-${req.params.type}.csv"`);
  res.send(contenu);
});

// --- Modèles cyber téléchargeables (étape 6/10 cyber) --------------------------------------------------------
router.get('/modele-cyber/:type', (req, res) => {
  const m = MODELES_CYBER[req.params.type];
  if (!m) return res.status(404).render('erreur', { titre: 'Modèle inconnu', message: 'Type de modèle invalide.' });
  const lignes = [
    ...m.commentaire.map((c) => '# ' + c),
    m.entete.join(';'),
    ...m.exemples.map((l) => l.join(';')),
  ];
  const contenu = '﻿' + lignes.join('\r\n'); // BOM pour Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="modele-import-cyber-${req.params.type}.csv"`);
  res.send(contenu);
});

// --- Modèles E&O téléchargeables (étape 6/10 E&O) --------------------------------------------------------
router.get('/modele-eo/:type', (req, res) => {
  const m = MODELES_EO[req.params.type];
  if (!m) return res.status(404).render('erreur', { titre: 'Modèle inconnu', message: 'Type de modèle invalide.' });
  const lignes = [
    ...m.commentaire.map((c) => '# ' + c),
    m.entete.join(';'),
    ...m.exemples.map((l) => l.join(';')),
  ];
  const contenu = '﻿' + lignes.join('\r\n'); // BOM pour Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="modele-import-eo-${req.params.type}.csv"`);
  res.send(contenu);
});

// --- Traitement du fichier -------------------------------------------------------------------------------
router.post('/', televersement.single('fichier'), verifieCsrf, (req, res) => {
  const baseRender = {
    produits: PRODUITS, NOMS_LIGNES,
    modelesAuto: Object.entries(MODELES_AUTO).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesBiens: Object.entries(MODELES_BIENS).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesRc: Object.entries(MODELES_RC).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesCyber: Object.entries(MODELES_CYBER).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesEo: Object.entries(MODELES_EO).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesDo: Object.entries(MODELES_DO).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesPe: Object.entries(MODELES_PE).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesFlotte: Object.entries(MODELES_FLOTTE).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesCautionnement: Object.entries(MODELES_CAUTIONNEMENT).map(([cle, m]) => ({ cle, titre: m.titre })),
  };
  if (!req.file) {
    return res.status(400).render('import/index', { ...baseRender, rapport: { erreurGlobale: 'Aucun fichier reçu (format CSV attendu).' } });
  }

  let lignes;
  try {
    const brut = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    // Les lignes « # » sont des commentaires (modèles auto) : on les retire avant analyse.
    const texte = brut.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('#')).join('\n');
    const premiere = texte.split('\n').find((l) => l.trim() !== '') || '';
    const delim = (premiere.match(/;/g) || []).length >= (premiere.match(/,/g) || []).length ? ';' : ',';
    lignes = parse(texte, { columns: true, delimiter: delim, skip_empty_lines: true, trim: true, relax_column_count: true })
      .map(normaliserLigne);
  } catch (e) {
    return res.status(400).render('import/index', { ...baseRender, rapport: { erreurGlobale: 'Fichier illisible : ' + e.message } });
  }

  const rapport = { total: lignes.length, crees: 0, erreurs: 0, details: [] };
  const cabinetId = res.locals.cabinetId;
  const utilisateur = req.utilisateur;

  const reqEntParRaison = bd.prepare('SELECT id, responsable_id FROM clients WHERE cabinet_id = ? AND raison_sociale = ? AND archive = 0');
  const reqEntParCourriel = bd.prepare('SELECT id, responsable_id FROM clients WHERE cabinet_id = ? AND courriel = ? AND archive = 0');

  const inserer = bd.transaction((l, numeroLigne) => {
    const type = normaliserType(l.type);
    if (type === 'entreprise' || type === 'client') return importerEntreprise(l, numeroLigne);
    if (type === 'police') return importerPolice(l, numeroLigne);
    if (type === 'protection') return importerProtection(l, numeroLigne);
    if (type === 'soumission') return importerSoumission(l, numeroLigne);
    if (type === 'conducteur') return importerConducteur(l, numeroLigne);
    if (type === 'vehicule') return importerVehicule(l, numeroLigne);
    if (type === 'antecedents') return importerAntecedents(l, numeroLigne);
    if (type === 'soumission_biens') return importerSoumissionBiens(l, numeroLigne);
    if (type === 'batiment') return importerBatiment(l, numeroLigne);
    if (type === 'contenu') return importerContenu(l, numeroLigne);
    if (type === 'garanties_biens') return importerGarantiesBiens(l, numeroLigne);
    if (type === 'antecedents_biens') return importerAntecedentsBiens(l, numeroLigne);
    if (type === 'soumission_rc') return importerSoumissionRc(l, numeroLigne);
    if (type === 'lieu_rc') return importerLieuRc(l, numeroLigne);
    if (type === 'garanties_rc') return importerGarantiesRc(l, numeroLigne);
    if (type === 'antecedents_rc') return importerAntecedentsRc(l, numeroLigne);
    if (type === 'soumission_cyber') return importerSoumissionCyber(l, numeroLigne);
    if (type === 'mesure_cyber') return importerMesureCyber(l, numeroLigne);
    if (type === 'garanties_cyber') return importerGarantiesCyber(l, numeroLigne);
    if (type === 'antecedents_cyber') return importerAntecedentsCyber(l, numeroLigne);
    if (type === 'soumission_eo') return importerSoumissionEo(l, numeroLigne);
    if (type === 'activite_eo') return importerActiviteEo(l, numeroLigne);
    if (type === 'garanties_eo') return importerGarantiesEo(l, numeroLigne);
    if (type === 'antecedents_eo') return importerAntecedentsEo(l, numeroLigne);
    if (type === 'soumission_do') return importerSoumissionDo(l, numeroLigne);
    if (type === 'dirigeant_do') return importerDirigeantDo(l, numeroLigne);
    if (type === 'garanties_do') return importerGarantiesDo(l, numeroLigne);
    if (type === 'antecedents_do') return importerAntecedentsDo(l, numeroLigne);
    if (type === 'soumission_pe') return importerSoumissionPe(l, numeroLigne);
    if (type === 'etablissement_pe') return importerEtablissementPe(l, numeroLigne);
    if (type === 'garanties_pe') return importerGarantiesPe(l, numeroLigne);
    if (type === 'antecedents_pe') return importerAntecedentsPe(l, numeroLigne);
    if (type === 'soumission_flotte') return importerSoumissionFlotte(l, numeroLigne);
    if (type === 'vehicule_flotte') return importerVehiculeFlotte(l, numeroLigne);
    if (type === 'conducteur_flotte') return importerConducteurFlotte(l, numeroLigne);
    if (type === 'garanties_flotte') return importerGarantiesFlotte(l, numeroLigne);
    if (type === 'antecedents_flotte') return importerAntecedentsFlotte(l, numeroLigne);
    if (type === 'soumission_caut') return importerSoumissionCaut(l, numeroLigne);
    if (type === 'obligation_caut') return importerObligationCaut(l, numeroLigne);
    if (type === 'ligne_caut') return importerLigneCaut(l, numeroLigne);
    if (type === 'antecedents_caut') return importerAntecedentsCaut(l, numeroLigne);
    throw new Error(`type inconnu « ${l.type} » (attendu : entreprise, police, protection, soumission, conducteur, vehicule, antecedents, soumission_biens, batiment, contenu, garanties_biens, antecedents_biens, soumission_rc, lieu_rc, garanties_rc, antecedents_rc, soumission_cyber, mesure_cyber, garanties_cyber, antecedents_cyber, soumission_eo, activite_eo, garanties_eo, antecedents_eo, soumission_do, dirigeant_do, garanties_do, antecedents_do, soumission_pe, etablissement_pe, garanties_pe, antecedents_pe, soumission_flotte, vehicule_flotte, conducteur_flotte, garanties_flotte, antecedents_flotte, soumission_caut, obligation_caut, ligne_caut, antecedents_caut)`);
  });

  function ok(numeroLigne, message) {
    rapport.crees += 1;
    rapport.details.push({ ligne: numeroLigne, statut: 'ok', message });
  }
  function ko(numeroLigne, message) {
    rapport.erreurs += 1;
    rapport.details.push({ ligne: numeroLigne, statut: 'erreur', message });
  }

  // --- Résolution d'entreprise (avec contrôle du portefeuille courtier) -------------------------------
  function verifierPortefeuille(clientId) {
    if (clientHorsPortefeuille(cabinetId, utilisateur, clientId)) {
      throw new Error('entreprise hors de votre portefeuille');
    }
  }
  // Lookup classique (en-têtes snake_case)
  function trouverEntreprise(l) {
    let c = null;
    if (l.raison_sociale) c = reqEntParRaison.get(cabinetId, l.raison_sociale.trim());
    if (!c && l.courriel) c = reqEntParCourriel.get(cabinetId, l.courriel.trim().toLowerCase());
    return c ? c.id : null;
  }
  // Lookup auto FPQ1 (en-têtes français)
  function resoudreEntrepriseAuto(l) {
    const raison = (l.lookup_raison || '').trim();
    const courriel = (l.lookup_courriel || '').trim().toLowerCase();
    let c = null;
    if (raison) c = reqEntParRaison.get(cabinetId, raison);
    if (!c && courriel) c = reqEntParCourriel.get(cabinetId, courriel);
    if (!c) throw new Error('entreprise introuvable (colonnes « Entreprise » ou « Courriel entreprise »)');
    verifierPortefeuille(c.id);
    return c.id;
  }
  // Résolution d'une soumission auto : par id explicite, sinon via l'entreprise
  // (la plus récente ; la date d'effet souhaitée permet de départager).
  function resoudreSoumission(l) {
    const sid = String(l.soumission_id || '').trim();
    if (sid) {
      if (!/^\d+$/.test(sid)) throw new Error(`soumission « ${sid} » invalide (numéro attendu)`);
      const s = bd.prepare('SELECT id, client_id FROM auto_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
        .get(Number(sid), cabinetId);
      if (!s) throw new Error(`soumission ${sid} introuvable`);
      verifierPortefeuille(s.client_id);
      return s.id;
    }
    const clientId = resoudreEntrepriseAuto(l);
    const toutes = bd.prepare(`
      SELECT id, date_effet_souhaitee FROM auto_soumissions
      WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC
    `).all(clientId, cabinetId);
    if (!toutes.length) throw new Error('aucune soumission pour cette entreprise (ajoutez d’abord une ligne type=soumission)');
    const de = String(l.date_effet_souhaitee || '').trim();
    if (de) {
      const m = toutes.find((t) => t.date_effet_souhaitee === de);
      if (m) return m.id;
    }
    return toutes[0].id;
  }

  function importerEntreprise(l, numeroLigne) {
    const raison = (l.raison_sociale || '').trim();
    const prenom = (l.prenom || '').trim(), nom = (l.nom || '').trim();
    if (raison.length < 2) throw new Error('raison_sociale requise');
    if (!prenom || !nom) throw new Error('prénom et nom de la personne-contact requis');
    if (l.courriel && !estCourrielValide(l.courriel)) throw new Error('courriel invalide');
    const langue = (l.langue || 'FR').toUpperCase();
    if (!['FR', 'EN'].includes(langue)) throw new Error('langue invalide (FR/EN)');
    const neq = (l.neq || '').replace(/\s/g, '');
    if (neq && !/^\d{10}$/.test(neq)) throw new Error('neq invalide (10 chiffres)');
    const ca = l.chiffre_affaires ? Number(l.chiffre_affaires) : null;
    if (l.chiffre_affaires && (isNaN(ca) || ca < 0)) throw new Error('chiffre_affaires invalide');
    const nbEmp = l.nb_employes ? Number(l.nb_employes) : null;
    if (l.nb_employes && (!Number.isInteger(nbEmp) || nbEmp < 0)) throw new Error('nb_employes invalide');
    if (l.courriel_entreprise && !estCourrielValide(l.courriel_entreprise)) throw new Error('courriel_entreprise invalide');
    // Un courtier qui importe une entreprise la rattache à son portefeuille.
    const responsableId = estCourtier({ utilisateur }) ? utilisateur.id : null;
    const r = bd.prepare(`
      INSERT INTO clients (cabinet_id, raison_sociale, neq, secteur_activite, responsable_id,
                           courriel_entreprise, telephone_entreprise, chiffre_affaires, nb_employes,
                           prenom, nom, titre_contact,
                           courriel, telephone, adresse, ville, code_postal, langue)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cabinetId, raison, neq || null, (l.secteur_activite || '').trim() || null, responsableId,
      (l.courriel_entreprise || '').trim() || null, (l.telephone_entreprise || '').trim() || null, ca, nbEmp,
      prenom, nom, (l.titre_contact || '').trim() || null,
      l.courriel || null, l.telephone || null, l.adresse || null,
      l.ville || null, l.code_postal || null, langue);
    bd.prepare(`
      INSERT INTO contacts (cabinet_id, client_id, prenom, nom, titre, courriel, telephone, principal)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(cabinetId, r.lastInsertRowid, prenom, nom,
      (l.titre_contact || '').trim() || null, l.courriel || null, l.telephone || null);
    ok(numeroLigne, `Entreprise ${raison} créée`);
    return r.lastInsertRowid;
  }

  function importerPolice(l, numeroLigne) {
    const clientId = trouverEntreprise(l);
    if (!clientId) throw new Error('entreprise introuvable (raison_sociale ou courriel)');
    verifierPortefeuille(clientId);
    const produit = (l.produit || l.ligne || '').toLowerCase();
    if (!PRODUITS.includes(produit)) throw new Error(`produit invalide (${PRODUITS.join('/')})`);
    if (!l.assureur || !l.numero_police) throw new Error('assureur et numero_police requis');
    if (!estDateValide(l.date_effet) || !estDateValide(l.date_echeance)) throw new Error('dates invalides (AAAA-MM-JJ)');
    const statut = (l.statut || 'active').toLowerCase();
    if (!['active', 'a_renouveler', 'resiliee'].includes(statut)) throw new Error('statut invalide');
    const franchise = l.franchise === '' || l.franchise == null ? 0 : Number(l.franchise);
    if (isNaN(franchise)) throw new Error('franchise invalide');
    const nomAssureur = l.assureur.trim();
    let ficheAss = bd.prepare('SELECT id FROM assureurs WHERE cabinet_id = ? AND lower(nom) = lower(?)').get(cabinetId, nomAssureur);
    if (!ficheAss) {
      ficheAss = { id: bd.prepare('INSERT INTO assureurs (cabinet_id, nom) VALUES (?, ?)').run(cabinetId, nomAssureur).lastInsertRowid };
    }
    try {
      const r = bd.prepare(`
        INSERT INTO polices (cabinet_id, client_id, ligne, assureur, assureur_id, numero_police, date_effet, date_echeance, franchise, statut)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cabinetId, clientId, produit, nomAssureur, ficheAss.id, l.numero_police.trim(), l.date_effet, l.date_echeance, franchise, statut);
      ok(numeroLigne, `Police ${l.numero_police} créée`);
      return r.lastInsertRowid;
    } catch (e) {
      if (e.message.includes('UNIQUE')) throw new Error(`numero_police « ${l.numero_police} » déjà utilisé`);
      throw e;
    }
  }

  function importerProtection(l, numeroLigne) {
    if (!l.numero_police) throw new Error('numero_police requis');
    const police = bd.prepare('SELECT id, ligne, client_id FROM polices WHERE cabinet_id = ? AND numero_police = ?')
      .get(cabinetId, l.numero_police.trim());
    if (!police) throw new Error(`police « ${l.numero_police} » introuvable`);
    verifierPortefeuille(police.client_id);
    const code = (l.protection_code || '').trim().toUpperCase();
    if (!code) throw new Error('protection_code requis');
    const prime = Number(l.prime);
    if (isNaN(prime) || prime < 0) throw new Error('prime invalide');
    const cat = bd.prepare('SELECT libelle FROM catalogue_protections WHERE ligne = ? AND code = ?').get(police.ligne, code);
    const libelle = cat ? cat.libelle : (l.protection_libelle || code);
    try {
      bd.prepare('INSERT INTO police_protections (police_id, code, libelle, prime) VALUES (?, ?, ?, ?)')
        .run(police.id, code, libelle, prime);
      ok(numeroLigne, `Protection ${code} ajoutée à ${l.numero_police}`);
    } catch (e) {
      if (e.message.includes('UNIQUE')) throw new Error(`protection ${code} déjà présente sur ${l.numero_police}`);
      throw e;
    }
  }

  // --- Types auto FPQ1 (étape 6/10) ------------------------------------------------------------------
  function importerSoumission(l, numeroLigne) {
    const clientId = resoudreEntrepriseAuto(l);
    const de = dateImport(l.date_effet_souhaitee, 'date d’effet souhaitée');
    const statut = String(l.statut || 'brouillon').trim().toLowerCase();
    if (!['brouillon', 'soumise'].includes(statut)) throw new Error('statut invalide (brouillon/soumise)');
    const id = fpq1.creerSoumission({
      cabinetId, userId: utilisateur.id, clientId,
      dateEffetSouhaitee: de, notes: String(l.notes || '').trim() || null,
    });
    if (statut === 'soumise') fpq1.changerStatutSoumission(id, cabinetId, utilisateur.id, 'soumise');
    ok(numeroLigne, `Soumission auto #${id} créée`);
    return id;
  }

  function importerConducteur(l, numeroLigne) {
    const soumissionId = resoudreSoumission(l);
    const nom = String(l.nom || '').trim(), prenom = String(l.prenom || '').trim();
    if (!nom || !prenom) throw new Error('nom et prénom du conducteur requis');
    const sexe = String(l.sexe || '').trim().toUpperCase();
    if (sexe && !['M', 'F'].includes(sexe)) throw new Error('sexe invalide (M/F)');
    if (l.courriel && !estCourrielValide(l.courriel)) throw new Error('courriel du conducteur invalide');
    const id = fpq1.ajouterConducteur(soumissionId, cabinetId, utilisateur.id, {
      nom, prenom,
      date_naissance: dateImport(l.date_naissance, 'date de naissance'),
      sexe: sexe || null,
      etat_civil: String(l.etat_civil || '').trim() || null,
      numero_permis: String(l.numero_permis || '').trim() || null,
      province_permis: String(l.province_permis || '').trim() || 'QC',
      date_obtention_permis: dateImport(l.date_obtention_permis, 'date d’obtention du permis'),
      annees_experience_ca: nombreImport(l.annees_experience_ca, 'expérience au Canada', { min: 0, entier: true }),
      annees_experience_ailleurs: nombreImport(l.annees_experience_ailleurs, 'expérience ailleurs', { min: 0, entier: true }),
      lien_assure: String(l.lien_assure || '').trim() || null,
      telephone: String(l.telephone || '').trim() || null,
      courriel: String(l.courriel || '').trim() || null,
      profession: String(l.profession || '').trim() || null,
      employeur: String(l.employeur || '').trim() || null,
      conducteur_principal: boolImport(l.conducteur_principal ?? '', 'conducteur principal'),
      infractions: parserInfractions(l.infractions),
      suspensions: parserSuspensions(l.suspensions),
    });
    ok(numeroLigne, `Conducteur ${prenom} ${nom} ajouté (soumission #${soumissionId})`);
    return id;
  }

  function importerVehicule(l, numeroLigne) {
    const soumissionId = resoudreSoumission(l);
    const marque = String(l.marque || '').trim(), modele = String(l.modele || '').trim();
    if (!marque || !modele) throw new Error('marque et modèle requis');
    // Validation préalable (avant toute écriture) : garanties comprises.
    const rc = nombreImport(l.rc_montant, 'RC — montant', { min: 0, entier: true });
    if (rc !== null && !RC_MONTANTS.includes(rc)) throw new Error(`RC — montant invalide (${RC_MONTANTS.join('/')})`);
    const pb = String(l.protection_b || '').trim().toLowerCase();
    if (pb && !['aucune', ...PROTECTIONS_B].includes(pb)) throw new Error('protection B invalide (aucune/b1/b2/b3/b4)');
    const franchiseB = nombreImport(l.franchise_b, 'franchise B', { min: 0 });
    const prime = nombreImport(l.prime, 'prime', { min: 0 });
    const avenants = {};
    for (const [col, code] of [['avenant_faq43', 'faq43'], ['avenant_faq20', 'faq20'], ['avenant_faq27', 'faq27'], ['avenant_faq34', 'faq34'], ['avenant_faq5a', 'faq5a']]) {
      if (boolImport(l[col] ?? '', `avenant ${code}`)) avenants[code] = 1;
    }
    const vin = String(l.vin || '').trim().toUpperCase().replace(/[\s-]/g, '');
    let avertissement = '';
    if (vin && vin.length !== 17) avertissement = ` — NIV à vérifier (${vin.length} caractères au lieu de 17)`;
    const id = fpq1.ajouterVehicule(soumissionId, cabinetId, utilisateur.id, {
      annee: nombreImport(l.annee, 'année', { min: 1900, max: 2100, entier: true }),
      marque, modele,
      version_finition: String(l.version_finition || '').trim() || null,
      vin: vin || null,
      carrosserie: String(l.carrosserie || '').trim() || null,
      neuf_occasion: choixImport(l.neuf_occasion, 'neuf / occasion', ['neuf', 'occasion']),
      date_achat: dateImport(l.date_achat, 'date d’achat'),
      prix_achat: nombreImport(l.prix_achat, 'prix d’achat', { min: 0 }),
      valeur_estimee: nombreImport(l.valeur_estimee, 'valeur estimée', { min: 0 }),
      financement: choixImport(l.financement, 'financement', ['comptant', 'finance', 'loue']),
      creancier_nom: String(l.creancier_nom || '').trim() || null,
      creancier_courriel: String(l.creancier_courriel || '').trim() || null,
      usage: choixImport(l.usage, 'usage', ['promenade', 'affaires', 'navette']),
      km_annuel: nombreImport(l.km_annuel, 'km annuel', { min: 0, entier: true }),
      pct_hors_quebec: nombreImport(l.pct_hors_quebec, '% hors Québec', { min: 0, max: 100 }),
      stationnement: String(l.stationnement || '').trim() || null,
      remisage_hiver: boolImport(l.remisage_hiver ?? '', 'remisage hiver'),
      modifications: parserModifications(l.modifications),
      antivol_tag: boolImport(l.antivol_tag ?? '', 'antivol TAG'),
      pneus_hiver: boolImport(l.pneus_hiver ?? '', 'pneus d’hiver'),
      remorque: boolImport(l.remorque ?? '', 'remorque'),
    });
    const aGaranties = rc !== null || pb || franchiseB !== null || prime !== null || Object.keys(avenants).length > 0;
    if (aGaranties) {
      fpq1.definirGaranties(id, cabinetId, utilisateur.id, {
        rc_montant: rc,
        protection_b: pb && pb !== 'aucune' ? pb : null,
        franchise_b: franchiseB,
        avenants,
        prime,
      });
    }
    const anneeTxt = l.annee ? String(l.annee).trim() + ' ' : '';
    ok(numeroLigne, `Véhicule ${anneeTxt}${marque} ${modele} ajouté (soumission #${soumissionId})${avertissement}`);
    return id;
  }

  function importerAntecedents(l, numeroLigne) {
    const soumissionId = resoudreSoumission(l);
    const id = fpq1.definirAntecedents(soumissionId, cabinetId, utilisateur.id, {
      assureur_actuel: String(l.assureur_actuel || '').trim() || null,
      numero_police_actuelle: String(l.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: dateImport(l.date_expiration_actuelle, 'date d’expiration actuelle'),
      annees_assurance_continue: nombreImport(l.annees_assurance_continue, 'années d’assurance continue', { min: 0, entier: true }),
      resiliation_ant: boolImport(l.resiliation_ant ?? '', 'résiliation antérieure'),
      non_paiement_ant: boolImport(l.non_paiement_ant ?? '', 'non-paiement antérieur'),
      faillite: boolImport(l.faillite ?? '', 'faillite'),
      casier_judiciaire: boolImport(l.casier_judiciaire ?? '', 'casier judiciaire'),
      sinistres_6ans: parserSinistres(l.sinistres_6ans),
      consentements: {
        credit: boolImport(l.consentement_credit ?? '', 'consentement crédit'),
        dossier_saaq: boolImport(l.consentement_dossier_saaq ?? '', 'consentement dossier SAAQ'),
        fcsa: boolImport(l.consentement_fcsa ?? '', 'consentement FCSA'),
      },
    });
    ok(numeroLigne, `Antécédents enregistrés (soumission #${soumissionId})`);
    return id;
  }

  // --- Types biens commerciaux (étape 6/10 biens) ---------------------------------------------
  // Résolution d'une soumission biens : par id explicite, sinon via l'entreprise
  // (la plus récente ; la date d'effet souhaitée permet de départager).
  function resoudreSoumissionBiens(l) {
    const sid = String(l.soumission_id || '').trim();
    if (sid) {
      if (!/^\d+$/.test(sid)) throw new Error(`soumission « ${sid} » invalide (numéro attendu)`);
      const s = bd.prepare('SELECT id, client_id FROM biens_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
        .get(Number(sid), cabinetId);
      if (!s) throw new Error(`soumission biens ${sid} introuvable`);
      verifierPortefeuille(s.client_id);
      return s.id;
    }
    const clientId = resoudreEntrepriseAuto(l);
    const toutes = bd.prepare(`
      SELECT id, date_effet_souhaitee FROM biens_soumissions
      WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC
    `).all(clientId, cabinetId);
    if (!toutes.length) throw new Error('aucune soumission biens pour cette entreprise (ajoutez d’abord une ligne type=soumission_biens)');
    const de = String(l.date_effet_souhaitee || '').trim();
    if (de) {
      const m = toutes.find((t) => t.date_effet_souhaitee === de);
      if (m) return m.id;
    }
    return toutes[0].id;
  }
  // Résolution d'un bâtiment : par id, sinon par adresse (dans la soumission).
  function resoudreBatiment(l, soumissionId) {
    const bid = String(l.batiment_id || '').trim();
    const adresse = String(l.batiment_adresse || '').trim();
    if (bid) {
      if (!/^\d+$/.test(bid)) throw new Error(`bâtiment « ${bid} » invalide (numéro attendu)`);
      const b = bd.prepare(`
        SELECT id FROM biens_batiments
        WHERE id = ? AND soumission_id = ? AND cabinet_id = ? AND archive = 0
      `).get(Number(bid), soumissionId, cabinetId);
      if (!b) throw new Error(`bâtiment ${bid} introuvable dans la soumission biens #${soumissionId}`);
      return b.id;
    }
    if (adresse) {
      const b = bd.prepare(`
        SELECT id FROM biens_batiments
        WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 AND lower(adresse) = lower(?)
        ORDER BY id
      `).get(soumissionId, cabinetId, adresse);
      if (!b) throw new Error(`aucun bâtiment à l’adresse « ${adresse} » dans la soumission biens #${soumissionId}`);
      return b.id;
    }
    throw new Error('bâtiment requis : colonne « Bâtiment (id) » ou « Adresse du bâtiment »');
  }

  function importerSoumissionBiens(l, numeroLigne) {
    const clientId = resoudreEntrepriseAuto(l);
    const de = dateImport(l.date_effet_souhaitee, 'date d’effet souhaitée');
    const statut = String(l.statut || 'brouillon').trim().toLowerCase();
    if (!['brouillon', 'soumise'].includes(statut)) throw new Error('statut invalide (brouillon/soumise)');
    const id = biens.creerSoumission({
      cabinetId, userId: utilisateur.id, clientId,
      dateEffetSouhaitee: de, notes: String(l.notes || '').trim() || null,
    });
    if (statut === 'soumise') biens.changerStatutSoumission(id, cabinetId, utilisateur.id, 'soumise');
    ok(numeroLigne, `Soumission biens #${id} créée`);
    return id;
  }

  function importerBatiment(l, numeroLigne) {
    const soumissionId = resoudreSoumissionBiens(l);
    const adresse = String(l.adresse || '').trim();
    if (!adresse) throw new Error('adresse du bâtiment requise');
    // Validation préalable (avant toute écriture — règles fermées).
    const typeConstruction = choixImport(l.type_construction, 'type de construction', TYPES_CONSTRUCTION);
    const anneeConstruction = nombreImport(l.annee_construction, 'année de construction', { min: 1800, max: 2100, entier: true });
    const superficie = nombreImport(l.superficie_pi2, 'superficie (pi²)', { min: 0 });
    const nbEtages = nombreImport(l.nb_etages, 'nb d’étages', { min: 0, entier: true });
    const valeurBatiment = nombreImport(l.valeur_batiment, 'valeur du bâtiment', { min: 0 });
    const gicleurs = boolImport(l.gicleurs ?? '', 'gicleurs');
    const distanceCaserne = nombreImport(l.distance_caserne_km, 'distance caserne (km)', { min: 0 });
    const anneeToiture = nombreImport(l.annee_toiture, 'année de la toiture', { min: 1800, max: 2100, entier: true });
    const id = biens.ajouterBatiment(soumissionId, cabinetId, utilisateur.id, {
      adresse, ville: String(l.ville || '').trim() || null,
      code_postal: String(l.code_postal || '').trim() || null,
      type_construction: typeConstruction, annee_construction: anneeConstruction,
      superficie_pi2: superficie, nb_etages: nbEtages,
      occupation: String(l.occupation || '').trim() || null,
      valeur_batiment: valeurBatiment, gicleurs,
      distance_caserne_km: distanceCaserne,
      chauffage: String(l.chauffage || '').trim() || null,
      annee_toiture: anneeToiture,
      notes: String(l.notes || '').trim() || null,
    });
    ok(numeroLigne, `Bâtiment ${adresse} ajouté (soumission biens #${soumissionId})`);
    return id;
  }

  function importerContenu(l, numeroLigne) {
    const soumissionId = resoudreSoumissionBiens(l);
    // Bâtiment optionnel : id ou adresse ; vide = contenu général de la soumission.
    let batimentId = null;
    if (String(l.batiment_id || '').trim() || String(l.batiment_adresse || '').trim()) {
      batimentId = resoudreBatiment(l, soumissionId);
    }
    const description = String(l.description || '').trim();
    if (!description) throw new Error('description du contenu requise');
    const typeContenu = choixImport(l.type_contenu, 'type de contenu', TYPES_CONTENU);
    const valeur = nombreImport(l.valeur, 'valeur', { min: 0 });
    const id = biens.ajouterContenu(soumissionId, cabinetId, utilisateur.id, {
      description, type_contenu: typeContenu, valeur,
      notes: String(l.notes || '').trim() || null,
    }, batimentId);
    const ou = batimentId ? `bâtiment #${batimentId}` : 'contenu général';
    ok(numeroLigne, `Contenu « ${description} » ajouté (${ou}, soumission biens #${soumissionId})`);
    return id;
  }

  function importerGarantiesBiens(l, numeroLigne) {
    const soumissionId = resoudreSoumissionBiens(l);
    const batimentId = resoudreBatiment(l, soumissionId);
    const formule = choixImport(l.formule, 'formule', FORMULES);
    const franchise = nombreImport(l.franchise, 'franchise', { min: 0 });
    const montant = nombreImport(l.montant_assurance, 'montant d’assurance', { min: 0 });
    const prime = nombreImport(l.prime, 'prime', { min: 0 });
    const avenants = {};
    for (const code of CODES_AVENANTS_BIENS) {
      if (boolImport(l['avenant_' + code] ?? '', `avenant ${code}`)) avenants[code] = 1;
    }
    const id = biens.definirGaranties(batimentId, cabinetId, utilisateur.id, {
      formule, franchise, montant_assurance: montant, avenants, prime,
    });
    ok(numeroLigne, `Garanties définies pour le bâtiment #${batimentId} (soumission biens #${soumissionId})`);
    return id;
  }

  function importerAntecedentsBiens(l, numeroLigne) {
    const soumissionId = resoudreSoumissionBiens(l);
    const id = biens.definirAntecedents(soumissionId, cabinetId, utilisateur.id, {
      assureur_actuel: String(l.assureur_actuel || '').trim() || null,
      numero_police_actuelle: String(l.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: dateImport(l.date_expiration_actuelle, 'date d’expiration actuelle'),
      annees_assurance_continue: nombreImport(l.annees_assurance_continue, 'années d’assurance continue', { min: 0, entier: true }),
      sinistres_5ans: parserSinistresBiens(l.sinistres_5ans),
      consentements: {
        credit: boolImport(l.consentement_credit ?? '', 'consentement crédit'),
        dossier_assurance: boolImport(l.consentement_dossier_assurance ?? '', 'consentement dossier d’assurance'),
      },
    });
    ok(numeroLigne, `Antécédents enregistrés (soumission biens #${soumissionId})`);
    return id;
  }

  // --- Types RC commerciale (étape 6/10 RC, miroir des types biens) ----------------------------------
  // Résolution d'une soumission RC : par id explicite, sinon via l'entreprise
  // (la plus récente ; la date d'effet souhaitée permet de départager).
  function resoudreSoumissionRc(l) {
    const sid = String(l.soumission_id || '').trim();
    if (sid) {
      if (!/^\d+$/.test(sid)) throw new Error(`soumission « ${sid} » invalide (numéro attendu)`);
      const s = bd.prepare('SELECT id, client_id FROM rc_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
        .get(Number(sid), cabinetId);
      if (!s) throw new Error(`soumission RC ${sid} introuvable`);
      verifierPortefeuille(s.client_id);
      return s.id;
    }
    const clientId = resoudreEntrepriseAuto(l);
    const toutes = bd.prepare(`
      SELECT id, date_effet_souhaitee FROM rc_soumissions
      WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC
    `).all(clientId, cabinetId);
    if (!toutes.length) throw new Error('aucune soumission RC pour cette entreprise (ajoutez d’abord une ligne type=soumission_rc)');
    const de = String(l.date_effet_souhaitee || '').trim();
    if (de) {
      const m = toutes.find((t) => t.date_effet_souhaitee === de);
      if (m) return m.id;
    }
    return toutes[0].id;
  }
  // Résolution d'un lieu d'exploitation : par id, sinon par adresse (dans la soumission).
  function resoudreLieu(l, soumissionId) {
    const eid = String(l.exploitation_id || '').trim();
    const adresse = String(l.exploitation_adresse || '').trim();
    if (eid) {
      if (!/^\d+$/.test(eid)) throw new Error(`lieu « ${eid} » invalide (numéro attendu)`);
      const e = bd.prepare(`
        SELECT id FROM rc_exploitations
        WHERE id = ? AND soumission_id = ? AND cabinet_id = ? AND archive = 0
      `).get(Number(eid), soumissionId, cabinetId);
      if (!e) throw new Error(`lieu d’exploitation ${eid} introuvable dans la soumission RC #${soumissionId}`);
      return e.id;
    }
    if (adresse) {
      const e = bd.prepare(`
        SELECT id FROM rc_exploitations
        WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 AND lower(adresse) = lower(?)
        ORDER BY id
      `).get(soumissionId, cabinetId, adresse);
      if (!e) throw new Error(`aucun lieu d’exploitation à l’adresse « ${adresse} » dans la soumission RC #${soumissionId}`);
      return e.id;
    }
    throw new Error('lieu requis : colonne « Lieu (id) » ou « Adresse du lieu »');
  }

  function importerSoumissionRc(l, numeroLigne) {
    const clientId = resoudreEntrepriseAuto(l);
    const de = dateImport(l.date_effet_souhaitee, 'date d’effet souhaitée');
    const statut = String(l.statut || 'brouillon').trim().toLowerCase();
    if (!['brouillon', 'soumise'].includes(statut)) throw new Error('statut invalide (brouillon/soumise)');
    const id = rc.creerSoumission({
      cabinetId, userId: utilisateur.id, clientId,
      dateEffetSouhaitee: de, notes: String(l.notes || '').trim() || null,
    });
    if (statut === 'soumise') rc.changerStatutSoumission(id, cabinetId, utilisateur.id, 'soumise');
    ok(numeroLigne, `Soumission RC #${id} créée`);
    return id;
  }

  function importerLieuRc(l, numeroLigne) {
    const soumissionId = resoudreSoumissionRc(l);
    const adresse = String(l.adresse || '').trim();
    if (!adresse) throw new Error('adresse du lieu d’exploitation requise');
    // Validation préalable (avant toute écriture — règles fermées).
    const sousTraitants = choixImport(l.sous_traitants, 'sous-traitants', SOUS_TRAITANTS);
    const chiffreAffaires = nombreImport(l.chiffre_affaires, 'chiffre d’affaires', { min: 0 });
    const masseSalariale = nombreImport(l.masse_salariale, 'masse salariale', { min: 0 });
    const nbEmployes = nombreImport(l.nb_employes, 'nb d’employés', { min: 0, entier: true });
    const superficie = nombreImport(l.superficie_pi2, 'superficie (pi²)', { min: 0 });
    const id = rc.ajouterExploitation(soumissionId, cabinetId, utilisateur.id, {
      adresse, ville: String(l.ville || '').trim() || null,
      code_postal: String(l.code_postal || '').trim() || null,
      type_activite: String(l.type_activite || '').trim() || null,
      code_classification: String(l.code_classification || '').trim() || null,
      description_activites: String(l.description_activites || '').trim() || null,
      chiffre_affaires: chiffreAffaires, masse_salariale: masseSalariale,
      nb_employes: nbEmployes, superficie_pi2: superficie,
      sous_traitants: sousTraitants,
      notes: String(l.notes || '').trim() || null,
    });
    ok(numeroLigne, `Lieu ${adresse} ajouté (soumission RC #${soumissionId})`);
    return id;
  }

  function importerGarantiesRc(l, numeroLigne) {
    const soumissionId = resoudreSoumissionRc(l);
    const exploitationId = resoudreLieu(l, soumissionId);
    // Validation préalable (avant toute écriture — règles fermées).
    const formule = choixImport(l.formule, 'formule de garantie', FORMULES_RC);
    const limiteSinistre = nombreImport(l.limite_par_sinistre, 'limite par sinistre', { min: 0, entier: true });
    const limiteAgregat = nombreImport(l.limite_agregat, 'limite agrégat', { min: 0, entier: true });
    const franchise = nombreImport(l.franchise, 'franchise', { min: 0 });
    const prime = nombreImport(l.prime, 'prime', { min: 0 });
    const avenants = {};
    for (const code of ['pollution', 'parapluie']) {
      if (boolImport(l['avenant_' + code] ?? '', `avenant ${code}`)) avenants[code] = 1;
    }
    const id = rc.definirGaranties(exploitationId, cabinetId, utilisateur.id, {
      limite_par_sinistre: limiteSinistre, limite_agregat: limiteAgregat,
      franchise, formule, avenants, prime,
    });
    ok(numeroLigne, `Garanties définies pour le lieu #${exploitationId} (soumission RC #${soumissionId})`);
    return id;
  }

  function importerAntecedentsRc(l, numeroLigne) {
    const soumissionId = resoudreSoumissionRc(l);
    const id = rc.definirAntecedents(soumissionId, cabinetId, utilisateur.id, {
      assureur_actuel: String(l.assureur_actuel || '').trim() || null,
      numero_police_actuelle: String(l.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: dateImport(l.date_expiration_actuelle, 'date d’expiration actuelle'),
      annees_assurance_continue: nombreImport(l.annees_assurance_continue, 'années d’assurance continue', { min: 0, entier: true }),
      sinistres_5ans: parserSinistresBiens(l.sinistres_5ans),
      consentements: {
        credit: boolImport(l.consentement_credit ?? '', 'consentement crédit'),
        dossier_assurance: boolImport(l.consentement_dossier_assurance ?? '', 'consentement dossier d’assurance'),
      },
    });
    ok(numeroLigne, `Antécédents enregistrés (soumission RC #${soumissionId})`);
    return id;
  }

  // --- Types cyber / cyberrisques (étape 6/10 cyber, miroir des types RC) -----------------------
  // Résolution d'une soumission cyber : par id explicite, sinon via l'entreprise
  // (la plus récente ; la date d'effet souhaitée permet de départager).
  function resoudreSoumissionCyber(l) {
    const sid = String(l.soumission_id || '').trim();
    if (sid) {
      if (!/^\d+$/.test(sid)) throw new Error(`soumission « ${sid} » invalide (numéro attendu)`);
      const s = bd.prepare('SELECT id, client_id FROM cyber_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
        .get(Number(sid), cabinetId);
      if (!s) throw new Error(`soumission cyber ${sid} introuvable`);
      verifierPortefeuille(s.client_id);
      return s.id;
    }
    const clientId = resoudreEntrepriseAuto(l);
    const toutes = bd.prepare(`
      SELECT id, date_effet_souhaitee FROM cyber_soumissions
      WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC
    `).all(clientId, cabinetId);
    if (!toutes.length) throw new Error('aucune soumission cyber pour cette entreprise (ajoutez d’abord une ligne type=soumission_cyber)');
    const de = String(l.date_effet_souhaitee || '').trim();
    if (de) {
      const m = toutes.find((t) => t.date_effet_souhaitee === de);
      if (m) return m.id;
    }
    return toutes[0].id;
  }

  function importerSoumissionCyber(l, numeroLigne) {
    const clientId = resoudreEntrepriseAuto(l);
    const de = dateImport(l.date_effet_souhaitee, 'date d’effet souhaitée');
    const statut = String(l.statut || 'brouillon').trim().toLowerCase();
    if (!['brouillon', 'soumise'].includes(statut)) throw new Error('statut invalide (brouillon/soumise)');
    const id = cyber.creerSoumission({
      cabinetId, userId: utilisateur.id, clientId,
      dateEffetSouhaitee: de, notes: String(l.notes || '').trim() || null,
    });
    if (statut === 'soumise') cyber.changerStatutSoumission(id, cabinetId, utilisateur.id, 'soumise');
    ok(numeroLigne, `Soumission cyber #${id} créée`);
    return id;
  }

  function importerMesureCyber(l, numeroLigne) {
    const soumissionId = resoudreSoumissionCyber(l);
    const typeMesure = choixImport(l.type_mesure, 'type de mesure', TYPES_MESURE);
    if (!typeMesure) throw new Error('type de mesure requis');
    const maturite = choixImport(l.maturite, 'maturité', STATUTS_MESURE);
    const id = cyber.ajouterMesure(soumissionId, cabinetId, utilisateur.id, {
      type_mesure: typeMesure,
      statut: maturite,
      details: String(l.details || '').trim() || null,
      notes: String(l.notes || '').trim() || null,
    });
    ok(numeroLigne, `Mesure ${typeMesure} ajoutée (soumission cyber #${soumissionId})`);
    return id;
  }

  function importerGarantiesCyber(l, numeroLigne) {
    const soumissionId = resoudreSoumissionCyber(l);
    // Validation préalable (avant toute écriture — règles fermées).
    const limiteSinistre = nombreImport(l.limite_par_sinistre, 'limite par sinistre', { min: 0 });
    const limiteAgregat = nombreImport(l.limite_agregat, 'limite agrégat', { min: 0 });
    const franchise = nombreImport(l.franchise, 'franchise', { min: 0 });
    const prime = nombreImport(l.prime, 'prime', { min: 0 });
    const avenants = {};
    for (const code of CODES_AVENANTS_CYBER) {
      if (boolImport(l['avenant_' + code] ?? '', `avenant ${code}`)) avenants[code] = 1;
    }
    const id = cyber.definirGaranties(soumissionId, cabinetId, utilisateur.id, {
      limite_par_sinistre: limiteSinistre, limite_agregat: limiteAgregat,
      franchise, delai_carence: String(l.delai_carence || '').trim() || null,
      avenants, prime,
    });
    ok(numeroLigne, `Garanties définies (soumission cyber #${soumissionId})`);
    return id;
  }

  function importerAntecedentsCyber(l, numeroLigne) {
    const soumissionId = resoudreSoumissionCyber(l);
    const id = cyber.definirAntecedents(soumissionId, cabinetId, utilisateur.id, {
      assureur_actuel: String(l.assureur_actuel || '').trim() || null,
      numero_police_actuelle: String(l.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: dateImport(l.date_expiration_actuelle, 'date d’expiration actuelle'),
      annees_assurance_continue: nombreImport(l.annees_assurance_continue, 'années d’assurance continue', { min: 0, entier: true }),
      incidents_5ans: parserIncidentsCyber(l.incidents_5ans),
      consentements: {
        credit: boolImport(l.consentement_credit ?? '', 'consentement crédit'),
        dossier_assurance: boolImport(l.consentement_dossier_assurance ?? '', 'consentement dossier d’assurance'),
      },
    });
    ok(numeroLigne, `Antécédents enregistrés (soumission cyber #${soumissionId})`);
    return id;
  }

  // --- Types E&O / responsabilité professionnelle (étape 6/10 E&O) -----------------------------------
  // Résolution d'une soumission E&O : par id explicite, sinon via l'entreprise
  // (la plus récente ; la date d'effet souhaitée permet de départager).
  function resoudreSoumissionEo(l) {
    const sid = String(l.soumission_id || '').trim();
    if (sid) {
      if (!/^\d+$/.test(sid)) throw new Error(`soumission « ${sid} » invalide (numéro attendu)`);
      const s = bd.prepare('SELECT id, client_id FROM eo_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
        .get(Number(sid), cabinetId);
      if (!s) throw new Error(`soumission E&O ${sid} introuvable`);
      verifierPortefeuille(s.client_id);
      return s.id;
    }
    const clientId = resoudreEntrepriseAuto(l);
    const toutes = bd.prepare(`
      SELECT id, date_effet_souhaitee FROM eo_soumissions
      WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC
    `).all(clientId, cabinetId);
    if (!toutes.length) throw new Error('aucune soumission E&O pour cette entreprise (ajoutez d’abord une ligne type=soumission_eo)');
    const de = String(l.date_effet_souhaitee || '').trim();
    if (de) {
      const m = toutes.find((t) => t.date_effet_souhaitee === de);
      if (m) return m.id;
    }
    return toutes[0].id;
  }

  function importerSoumissionEo(l, numeroLigne) {
    const clientId = resoudreEntrepriseAuto(l);
    const de = dateImport(l.date_effet_souhaitee, 'date d’effet souhaitée');
    const statut = String(l.statut || 'brouillon').trim().toLowerCase();
    if (!['brouillon', 'soumise'].includes(statut)) throw new Error('statut invalide (brouillon/soumise)');
    const id = eo.creerSoumission({
      cabinetId, userId: utilisateur.id, clientId,
      dateEffetSouhaitee: de, notes: String(l.notes || '').trim() || null,
    });
    if (statut === 'soumise') eo.changerStatutSoumission(id, cabinetId, utilisateur.id, 'soumise');
    ok(numeroLigne, `Soumission E&O #${id} créée`);
    return id;
  }

  function importerActiviteEo(l, numeroLigne) {
    const soumissionId = resoudreSoumissionEo(l);
    const description = String(l.description_activite || '').trim();
    if (!description) throw new Error('activité professionnelle (description) requise');
    const id = eo.ajouterActivite(soumissionId, cabinetId, utilisateur.id, {
      description_activite: description,
      chiffre_affaires: nombreImport(l.chiffre_affaires, 'chiffre d’affaires ($)', { min: 0 }),
      nb_professionnels: nombreImport(l.nb_professionnels, 'nb de professionnels', { min: 0, entier: true }),
      notes: String(l.notes || '').trim() || null,
    });
    ok(numeroLigne, `Activité « ${description} » ajoutée (soumission E&O #${soumissionId})`);
    return id;
  }

  function importerGarantiesEo(l, numeroLigne) {
    const soumissionId = resoudreSoumissionEo(l);
    // Validation préalable (avant toute écriture — règles fermées).
    const base = baseEoImport(l.base, 'base de garantie');
    const limiteSinistre = nombreImport(l.limite_par_sinistre, 'limite par sinistre', { min: 0 });
    const limiteAgregat = nombreImport(l.limite_agregat, 'limite agrégat', { min: 0 });
    const franchise = nombreImport(l.franchise, 'franchise', { min: 0 });
    const prime = nombreImport(l.prime, 'prime', { min: 0 });
    const avenants = {};
    for (const code of CODES_AVENANTS_EO) {
      if (boolImport(l['avenant_' + code] ?? '', `avenant ${code}`)) avenants[code] = 1;
    }
    const id = eo.definirGaranties(soumissionId, cabinetId, utilisateur.id, {
      limite_par_sinistre: limiteSinistre, limite_agregat: limiteAgregat,
      franchise, base, avenants, prime,
    });
    ok(numeroLigne, `Garanties définies (soumission E&O #${soumissionId})`);
    return id;
  }

  function importerAntecedentsEo(l, numeroLigne) {
    const soumissionId = resoudreSoumissionEo(l);
    const id = eo.definirAntecedents(soumissionId, cabinetId, utilisateur.id, {
      assureur_actuel: String(l.assureur_actuel || '').trim() || null,
      numero_police_actuelle: String(l.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: dateImport(l.date_expiration_actuelle, 'date d’expiration actuelle'),
      annees_assurance_continue: nombreImport(l.annees_assurance_continue, 'années d’assurance continue', { min: 0, entier: true }),
      reclamations_5ans: parserReclamationsEo(l.reclamations_5ans),
      circonstances: String(l.circonstances || '').trim() || null,
      consentements: {
        credit: boolImport(l.consentement_credit ?? '', 'consentement crédit'),
        dossier_assurance: boolImport(l.consentement_dossier_assurance ?? '', 'consentement dossier d’assurance'),
      },
    });
    ok(numeroLigne, `Antécédents enregistrés (soumission E&O #${soumissionId})`);
    return id;
  }

  // --- Types D&O / administrateurs et dirigeants (étape 6/10 D&O) --------------------------------
  // Résolution d'une soumission D&O : par id explicite, sinon via l'entreprise
  // (la plus récente ; la date d'effet souhaitée permet de départager).
  function resoudreSoumissionDo(l) {
    const sid = String(l.soumission_id || '').trim();
    if (sid) {
      if (!/^\d+$/.test(sid)) throw new Error(`soumission « ${sid} » invalide (numéro attendu)`);
      const s = bd.prepare('SELECT id, client_id FROM do_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
        .get(Number(sid), cabinetId);
      if (!s) throw new Error(`soumission D&O ${sid} introuvable`);
      verifierPortefeuille(s.client_id);
      return s.id;
    }
    const clientId = resoudreEntrepriseAuto(l);
    const toutes = bd.prepare(`
      SELECT id, date_effet_souhaitee FROM do_soumissions
      WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC
    `).all(clientId, cabinetId);
    if (!toutes.length) throw new Error('aucune soumission D&O pour cette entreprise (ajoutez d’abord une ligne type=soumission_do)');
    const de = String(l.date_effet_souhaitee || '').trim();
    if (de) {
      const m = toutes.find((t) => t.date_effet_souhaitee === de);
      if (m) return m.id;
    }
    return toutes[0].id;
  }

  function importerSoumissionDo(l, numeroLigne) {
    const clientId = resoudreEntrepriseAuto(l);
    const de = dateImport(l.date_effet_souhaitee, 'date d’effet souhaitée');
    const statut = String(l.statut || 'brouillon').trim().toLowerCase();
    if (!['brouillon', 'soumise'].includes(statut)) throw new Error('statut invalide (brouillon/soumise)');
    const id = dno.creerSoumission({
      cabinetId, userId: utilisateur.id, clientId,
      dateEffetSouhaitee: de, notes: String(l.notes || '').trim() || null,
    });
    if (statut === 'soumise') dno.changerStatutSoumission(id, cabinetId, utilisateur.id, 'soumise');
    ok(numeroLigne, `Soumission D&O #${id} créée`);
    return id;
  }

  function importerDirigeantDo(l, numeroLigne) {
    const soumissionId = resoudreSoumissionDo(l);
    const nom = String(l.nom || '').trim();
    if (!nom) throw new Error('nom du dirigeant requis');
    const id = dno.ajouterDirigeant(soumissionId, cabinetId, utilisateur.id, {
      nom,
      fonction: String(l.fonction || '').trim() || null,
      annees_experience: nombreImport(l.annees_experience, 'années d’expérience', { min: 0, max: 80, entier: true }),
      antecedents_personnels: String(l.antecedents_personnels || '').trim() || null,
    });
    ok(numeroLigne, `Dirigeant « ${nom} » ajouté (soumission D&O #${soumissionId})`);
    return id;
  }

  function importerGarantiesDo(l, numeroLigne) {
    const soumissionId = resoudreSoumissionDo(l);
    // Validation préalable (avant toute écriture — règles fermées).
    const base = baseDoImport(l.base, 'base de garantie');
    const limiteSinistre = nombreImport(l.limite_par_sinistre, 'limite par sinistre', { min: 0 });
    const limiteAgregat = nombreImport(l.limite_agregat, 'limite agrégat', { min: 0 });
    const franchise = nombreImport(l.franchise, 'franchise', { min: 0 });
    const prime = nombreImport(l.prime, 'prime', { min: 0 });
    const avenants = {};
    for (const code of CODES_AVENANTS_DO) {
      if (boolImport(l['avenant_' + code] ?? '', `avenant ${code}`)) avenants[code] = 1;
    }
    const id = dno.definirGaranties(soumissionId, cabinetId, utilisateur.id, {
      limite_par_sinistre: limiteSinistre, limite_agregat: limiteAgregat,
      franchise, base, avenants, prime,
    });
    ok(numeroLigne, `Garanties définies (soumission D&O #${soumissionId})`);
    return id;
  }

  function importerAntecedentsDo(l, numeroLigne) {
    const soumissionId = resoudreSoumissionDo(l);
    const id = dno.definirAntecedents(soumissionId, cabinetId, utilisateur.id, {
      assureur_actuel: String(l.assureur_actuel || '').trim() || null,
      numero_police_actuelle: String(l.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: dateImport(l.date_expiration_actuelle, 'date d’expiration actuelle'),
      annees_assurance_continue: nombreImport(l.annees_assurance_continue, 'années d’assurance continue', { min: 0, entier: true }),
      reclamations_5ans: parserReclamationsDo(l.reclamations_5ans),
      poursuites_en_cours: String(l.poursuites_en_cours || '').trim() || null,
      consentements: {
        credit: boolImport(l.consentement_credit ?? '', 'consentement crédit'),
        dossier_assurance: boolImport(l.consentement_dossier_assurance ?? '', 'consentement dossier d’assurance'),
      },
    });
    ok(numeroLigne, `Antécédents enregistrés (soumission D&O #${soumissionId})`);
    return id;
  }

  // --- Types perte d'exploitation (étape 6/10 PE, miroir des types D&O) ----------------------------
  // Résolution d'une soumission PE : par id explicite, sinon via l'entreprise
  // (la plus récente ; la date d'effet souhaitée permet de départager).
  function resoudreSoumissionPe(l) {
    const sid = String(l.soumission_id || '').trim();
    if (sid) {
      if (!/^\d+$/.test(sid)) throw new Error(`soumission « ${sid} » invalide (numéro attendu)`);
      const s = bd.prepare('SELECT id, client_id FROM pe_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
        .get(Number(sid), cabinetId);
      if (!s) throw new Error(`soumission perte d’exploitation ${sid} introuvable`);
      verifierPortefeuille(s.client_id);
      return s.id;
    }
    const clientId = resoudreEntrepriseAuto(l);
    const toutes = bd.prepare(`
      SELECT id, date_effet_souhaitee FROM pe_soumissions
      WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC
    `).all(clientId, cabinetId);
    if (!toutes.length) throw new Error('aucune soumission perte d’exploitation pour cette entreprise (ajoutez d’abord une ligne type=soumission_pe)');
    const de = String(l.date_effet_souhaitee || '').trim();
    if (de) {
      const m = toutes.find((t) => t.date_effet_souhaitee === de);
      if (m) return m.id;
    }
    return toutes[0].id;
  }

  function importerSoumissionPe(l, numeroLigne) {
    const clientId = resoudreEntrepriseAuto(l);
    const de = dateImport(l.date_effet_souhaitee, 'date d’effet souhaitée');
    const statut = String(l.statut || 'brouillon').trim().toLowerCase();
    if (!['brouillon', 'soumise', 'convertie_police'].includes(statut)) throw new Error('statut invalide (brouillon/soumise/convertie_police)');
    const id = pe.creerSoumission({
      cabinetId, userId: utilisateur.id, clientId,
      dateEffetSouhaitee: de, notes: String(l.notes || '').trim() || null,
    });
    if (statut === 'soumise') pe.changerStatutSoumission(id, cabinetId, utilisateur.id, 'soumise');
    if (statut === 'convertie_police') pe.changerStatutSoumission(id, cabinetId, utilisateur.id, 'convertie_police');
    ok(numeroLigne, `Soumission perte d’exploitation #${id} créée`);
    return id;
  }

  function importerEtablissementPe(l, numeroLigne) {
    const soumissionId = resoudreSoumissionPe(l);
    const nomLieu = String(l.nom_lieu || '').trim();
    // « Adresse du lieu » (modèle) est déjà mappé à exploitation_adresse (lieux RC) ;
    // la variante PE exportée est « Adresse du lieu. » (avec point) → adresse.
    const adresse = String(l.adresse || l.exploitation_adresse || '').trim();
    if (!nomLieu && !adresse) throw new Error('nom du lieu ou adresse requis');
    // Validation préalable (avant toute écriture — règles fermées).
    const ca = nombreImport(l.chiffre_affaires, 'chiffre d’affaires', { min: 0 });
    const superficie = nombreImport(l.superficie, 'superficie', { min: 0 });
    const anneeConstruction = nombreImport(l.annee_construction, 'année de construction', { min: 1800, max: 2100, entier: true });
    const baseValeur = baseValeurPeImport(l.base_valeur, 'base de valeur');
    const id = pe.ajouterEtablissement(soumissionId, cabinetId, utilisateur.id, {
      nom_lieu: nomLieu || null,
      adresse: adresse || null,
      occupation: String(l.occupation || '').trim() || null,
      chiffre_affaires: ca,
      superficie,
      annee_construction: anneeConstruction,
      base_valeur: baseValeur,
    });
    ok(numeroLigne, `Établissement « ${nomLieu || adresse} » ajouté (soumission perte d’exploitation #${soumissionId})`);
    return id;
  }

  function importerGarantiesPe(l, numeroLigne) {
    const soumissionId = resoudreSoumissionPe(l);
    // Validation préalable (avant toute écriture — règles fermées).
    const periode = periodePeImport(l.periode_indemnite_mois, 'période d’indemnité');
    const base = basePeImport(l.base_montant, 'base d’indemnité');
    const limite = nombreImport(l.limite, 'limite', { min: 0 });
    const franchise = nombreImport(l.franchise_jours, 'franchise (jours)', { min: 0, entier: true });
    const prime = nombreImport(l.prime, 'prime', { min: 0 });
    const avenants = {};
    for (const code of CODES_AVENANTS_PE) {
      if (boolImport(l['avenant_' + code] ?? '', `avenant ${code}`)) avenants[code] = 1;
    }
    const id = pe.definirGaranties(soumissionId, cabinetId, utilisateur.id, {
      limite, periode_indemnite_mois: periode, franchise_jours: franchise,
      base_montant: base, avenants, prime,
    });
    ok(numeroLigne, `Garanties définies (soumission perte d’exploitation #${soumissionId})`);
    return id;
  }

  function importerAntecedentsPe(l, numeroLigne) {
    const soumissionId = resoudreSoumissionPe(l);
    const id = pe.definirAntecedents(soumissionId, cabinetId, utilisateur.id, {
      assureur_actuel: String(l.assureur_actuel || '').trim() || null,
      numero_police_actuelle: String(l.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: dateImport(l.date_expiration_actuelle, 'date d’expiration actuelle'),
      annees_assurance_continue: nombreImport(l.annees_assurance_continue, 'années d’assurance continue', { min: 0, entier: true }),
      interruptions_5ans: parserInterruptionsPe(l.interruptions_5ans),
      consentements: {
        credit: boolImport(l.consentement_credit ?? '', 'consentement crédit'),
        dossier_assurance: boolImport(l.consentement_dossier_assurance ?? '', 'consentement dossier d’assurance'),
      },
    });
    ok(numeroLigne, `Antécédents enregistrés (soumission perte d’exploitation #${soumissionId})`);
    return id;
  }

  // --- Types flotte automobile (étape 6/10 flotte, miroir des types PE) --------------------------
  // La flotte a DEUX lignes illimitées (véhicules ET conducteurs) : d'où 5 types
  // (soumission_flotte | vehicule_flotte | conducteur_flotte | garanties_flotte |
  // antecedents_flotte). Résolution d'une soumission flotte : par id explicite,
  // sinon via l'entreprise (la plus récente ; la date d'effet souhaitée permet
  // de départager).
  function resoudreSoumissionFlotte(l) {
    const sid = String(l.soumission_id || '').trim();
    if (sid) {
      if (!/^\d+$/.test(sid)) throw new Error(`soumission « ${sid} » invalide (numéro attendu)`);
      const s = bd.prepare('SELECT id, client_id FROM flotte_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
        .get(Number(sid), cabinetId);
      if (!s) throw new Error(`soumission flotte ${sid} introuvable`);
      verifierPortefeuille(s.client_id);
      return s.id;
    }
    const clientId = resoudreEntrepriseAuto(l);
    const toutes = bd.prepare(`
      SELECT id, date_effet_souhaitee FROM flotte_soumissions
      WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC
    `).all(clientId, cabinetId);
    if (!toutes.length) throw new Error('aucune soumission flotte pour cette entreprise (ajoutez d’abord une ligne type=soumission_flotte)');
    const de = String(l.date_effet_souhaitee || '').trim();
    if (de) {
      const m = toutes.find((t) => t.date_effet_souhaitee === de);
      if (m) return m.id;
    }
    return toutes[0].id;
  }

  function importerSoumissionFlotte(l, numeroLigne) {
    const clientId = resoudreEntrepriseAuto(l);
    // Validation préalable (avant toute écriture — règles fermées).
    const de = dateImport(l.date_effet_souhaitee, 'date d’effet souhaitée');
    const dv = dateImport(l.date_echeance_visee, 'date d’échéance visée');
    const statut = String(l.statut || 'brouillon').trim().toLowerCase();
    if (!['brouillon', 'soumise', 'convertie_police'].includes(statut)) throw new Error('statut invalide (brouillon/soumise/convertie_police)');
    const usageDominant = usageFlotteImport(l.usage_dominant, 'usage dominant', { dominant: true });
    const rayon = nombreImport(l.rayon_operation_km, 'rayon d’opération (km)', { min: 0, entier: true });
    const nbVeh = nombreImport(l.nb_vehicules, 'nb véhicules déclarés', { min: 0, entier: true });
    const id = flotte.creerSoumission({
      cabinetId, userId: utilisateur.id, clientId,
      assureur: String(l.assureur || '').trim() || null,
      numeroPolice: String(l.numero_police || '').trim() || null,
      nbVehicules: nbVeh, rayonOperationKm: rayon, usageDominant,
      dateEffetSouhaitee: de, dateEcheanceVisee: dv,
      notes: String(l.notes || '').trim() || null,
    });
    if (statut === 'soumise') flotte.changerStatutSoumission(id, cabinetId, utilisateur.id, 'soumise');
    if (statut === 'convertie_police') flotte.changerStatutSoumission(id, cabinetId, utilisateur.id, 'convertie_police');
    ok(numeroLigne, `Soumission flotte #${id} créée`);
    return id;
  }

  function importerVehiculeFlotte(l, numeroLigne) {
    const soumissionId = resoudreSoumissionFlotte(l);
    const marque = String(l.marque || '').trim(), modele = String(l.modele || '').trim();
    if (!marque || !modele) throw new Error('marque et modèle requis');
    // Validation préalable (avant toute écriture — règles fermées).
    const typeVehicule = choixImport(l.type_vehicule, 'type de véhicule', flotte.TYPES_VEHICULE);
    const usage = usageFlotteImport(l.usage, 'usage du véhicule');
    const rayon = nombreImport(l.rayon_operation_km, 'rayon d’opération (km)', { min: 0, entier: true });
    const valeur = nombreImport(l.valeur, 'valeur', { min: 0 });
    const annee = nombreImport(l.annee, 'année', { min: 1900, max: 2100, entier: true });
    const anneeAcq = nombreImport(l.annee_acquisition, 'année d’acquisition', { min: 1900, max: 2100, entier: true });
    const equipements = parserEquipementsFlotte(l.equipements_speciaux);
    // Conducteur principal : fiche liée (nom d'un conducteur de la soumission)
    // ou nom libre (même logique que l'UI routes/flotte.js).
    const cpNom = String(l.conducteur_principal || '').trim();
    let cpId = null, cpLibre = null;
    if (cpNom) {
      const cible = cpNom.toLowerCase();
      const trouve = bd.prepare(`
        SELECT id, nom, prenom FROM flotte_conducteurs
        WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
      `).all(soumissionId, cabinetId).find((c) =>
        `${c.prenom} ${c.nom}`.toLowerCase() === cible || `${c.nom} ${c.prenom}`.toLowerCase() === cible);
      if (trouve) cpId = trouve.id;
      else cpLibre = cpNom;
    }
    const id = flotte.ajouterVehicule(soumissionId, cabinetId, utilisateur.id, {
      niv: String(l.vin || '').trim().toUpperCase() || null, // « NIV » est normalisé en « vin » (clé FPQ1)
      annee, marque, modele,
      type_vehicule: typeVehicule, usage,
      rayon_operation_km: rayon,
      lieu_remisage: String(l.lieu_remisage || '').trim() || null,
      valeur, annee_acquisition: anneeAcq,
      conducteur_principal_id: cpId, conducteur_principal_nom: cpLibre,
      equipements_speciaux: equipements,
    });
    ok(numeroLigne, `Véhicule ${annee ? annee + ' ' : ''}${marque} ${modele} ajouté (soumission flotte #${soumissionId})`);
    return id;
  }

  function importerConducteurFlotte(l, numeroLigne) {
    const soumissionId = resoudreSoumissionFlotte(l);
    const nom = String(l.nom || '').trim(), prenom = String(l.prenom || '').trim();
    if (!nom || !prenom) throw new Error('nom et prénom du conducteur requis');
    // Validation préalable (avant toute écriture — règles fermées).
    const id = flotte.ajouterConducteur(soumissionId, cabinetId, utilisateur.id, {
      nom, prenom,
      date_naissance: dateImport(l.date_naissance, 'date de naissance'),
      age: nombreImport(l.age, 'âge', { min: 0, max: 120, entier: true }),
      numero_permis: String(l.numero_permis || '').trim() || null,
      classe_permis: String(l.classe_permis || '').trim() || null,
      annees_experience: nombreImport(l.annees_experience, 'années d’expérience', { min: 0, entier: true }),
      annees_experience_lourds: nombreImport(l.annees_experience_lourds, 'années d’expérience — véhicules lourds', { min: 0, entier: true }),
      date_embauche: dateImport(l.date_embauche, 'date d’embauche'),
      sinistres_5ans: parserSinistresFlotte(l.sinistres_5ans, 'sinistres 5 ans'),
      infractions_3ans: parserInfractionsFlotte(l.infractions_3ans),
      formations: parserFormationsFlotte(l.formations),
    });
    ok(numeroLigne, `Conducteur ${prenom} ${nom} ajouté (soumission flotte #${soumissionId})`);
    return id;
  }

  function importerGarantiesFlotte(l, numeroLigne) {
    const soumissionId = resoudreSoumissionFlotte(l);
    // Validation préalable (avant toute écriture — règles fermées).
    const limiteRc = nombreImport(l.limite_rc, 'limite RC', { min: 0 });
    const frCol = nombreImport(l.franchise_collision, 'franchise collision', { min: 0 });
    const frVer = nombreImport(l.franchise_versement, 'franchise versement', { min: 0 });
    const prime = nombreImport(l.prime, 'prime', { min: 0 });
    const avenants = parserAvenantsFlotte(l.avenants);
    for (const [col, code] of [['avenant_faq43', 'faq43'], ['avenant_faq20', 'faq20'], ['avenant_faq27', 'faq27'], ['avenant_faq34', 'faq34'], ['avenant_faq5a', 'faq5a']]) {
      if (boolImport(l[col] ?? '', `avenant ${code}`)) avenants[code] = 1;
    }
    const id = flotte.definirGaranties(soumissionId, cabinetId, utilisateur.id, {
      limite_rc: limiteRc, franchise_collision: frCol, franchise_versement: frVer,
      avenants, prime,
    });
    ok(numeroLigne, `Garanties définies (soumission flotte #${soumissionId})`);
    return id;
  }

  function importerAntecedentsFlotte(l, numeroLigne) {
    const soumissionId = resoudreSoumissionFlotte(l);
    const id = flotte.definirAntecedents(soumissionId, cabinetId, utilisateur.id, {
      assureur_actuel: String(l.assureur_actuel || '').trim() || null,
      numero_police_actuelle: String(l.numero_police_actuelle || '').trim() || null,
      date_expiration_actuelle: dateImport(l.date_expiration_actuelle, 'date d’expiration actuelle'),
      annees_assurance_flotte_continue: nombreImport(l.annees_assurance_flotte_continue, 'années d’assurance flotte continue', { min: 0, entier: true }),
      sinistres_flotte_5ans: parserSinistresFlotte(l.sinistres_flotte_5ans, 'sinistres flotte 5 ans'),
      ratio_pertes: nombreImport(l.ratio_pertes, 'ratio de pertes', { min: 0 }),
      refus_annulation_ant: boolImport(l.refus_annulation_ant ?? '', 'refus ou annulation antérieur'),
      refus_annulation_details: String(l.refus_annulation_details || '').trim() || null,
      consentements: {
        credit: boolImport(l.consentement_credit ?? '', 'consentement crédit'),
        dossier_saaq: boolImport(l.consentement_dossier_saaq ?? '', 'consentement dossier SAAQ'),
        fcsa: boolImport(l.consentement_fcsa ?? '', 'consentement FCSA'),
      },
    });
    ok(numeroLigne, `Antécédents enregistrés (soumission flotte #${soumissionId})`);
    return id;
  }

  // --- Types cautionnement (étape 6/10 cautionnement, miroir des types PE) ------------------------
  // 4 types : soumission_caut (en-tête du principal) | obligation_caut (obligations
  // ILLIMITÉES) | ligne_caut (ligne de cautionnement UNIQUE) | antecedents_caut.
  // Résolution d'une soumission cautionnement : par id explicite, sinon via
  // l'entreprise (la plus récente ; la date d'effet souhaitée départage).
  function resoudreSoumissionCaut(l) {
    const sid = String(l.soumission_id || '').trim();
    if (sid) {
      if (!/^\d+$/.test(sid)) throw new Error(`soumission « ${sid} » invalide (numéro attendu)`);
      const s = bd.prepare('SELECT id, client_id FROM caut_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
        .get(Number(sid), cabinetId);
      if (!s) throw new Error(`soumission cautionnement ${sid} introuvable`);
      verifierPortefeuille(s.client_id);
      return s.id;
    }
    const clientId = resoudreEntrepriseAuto(l);
    const toutes = bd.prepare(`
      SELECT id, date_effet_souhaitee FROM caut_soumissions
      WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC
    `).all(clientId, cabinetId);
    if (!toutes.length) throw new Error('aucune soumission cautionnement pour cette entreprise (ajoutez d’abord une ligne type=soumission_caut)');
    const de = String(l.date_effet_souhaitee || '').trim();
    if (de) {
      const m = toutes.find((t) => t.date_effet_souhaitee === de);
      if (m) return m.id;
    }
    return toutes[0].id;
  }

  function statutCautImport(v) {
    const s = String(v || 'brouillon').trim().toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
    if (s === 'brouillon') return 'brouillon';
    if (s === 'soumise') return 'soumise';
    if (s === 'convertiepolice' || s === 'convertieenpolice') return 'convertie_police';
    throw new Error('statut invalide (brouillon/soumise/convertie_police)');
  }

  function importerSoumissionCaut(l, numeroLigne) {
    const clientId = resoudreEntrepriseAuto(l);
    // Validation préalable (avant toute écriture — règles fermées).
    const de = dateImport(l.date_effet_souhaitee, 'date d’effet souhaitée');
    const dv = dateImport(l.date_echeance_visee, 'date d’échéance visée');
    const statut = statutCautImport(l.statut);
    const anneeFondation = nombreImport(l.annee_fondation, 'année de fondation', { min: 1800, max: 2100, entier: true });
    const chiffreAffaires = nombreImport(l.chiffre_affaires, 'chiffre d’affaires', { min: 0 });
    const nbEmployes = nombreImport(l.nb_employes, 'nombre d’employés', { min: 0, entier: true });
    const id = caut.creerSoumission({
      cabinetId, userId: utilisateur.id, clientId,
      assureur: String(l.assureur || '').trim() || null,
      numeroPolice: String(l.numero_police || '').trim() || null,
      secteurActivite: String(l.secteur_activite || '').trim() || null,
      anneeFondation, chiffreAffaires, nbEmployes,
      dateEffetSouhaitee: de, dateEcheanceVisee: dv,
      notes: String(l.notes || '').trim() || null,
    });
    if (statut === 'soumise') caut.changerStatutSoumission(id, cabinetId, utilisateur.id, 'soumise');
    if (statut === 'convertie_police') caut.changerStatutSoumission(id, cabinetId, utilisateur.id, 'convertie_police');
    ok(numeroLigne, `Soumission cautionnement #${id} créée`);
    return id;
  }

  function importerObligationCaut(l, numeroLigne) {
    const soumissionId = resoudreSoumissionCaut(l);
    // Validation préalable (avant toute écriture — règles fermées).
    const type = typeObligationCautImport(l.type_cautionnement ?? l.type, 'type de cautionnement');
    if (!type) throw new Error('type de cautionnement requis');
    const montantContrat = nombreImport(l.montant_contrat, 'montant du contrat', { min: 0 });
    const montantCaut = nombreImport(l.montant_cautionnement, 'montant du cautionnement', { min: 0 });
    const taux = nombreImport(l.taux_pct, 'taux (%)', { min: 0, max: 100 });
    const primeEstimee = nombreImport(l.prime_estimee, 'prime estimée', { min: 0 });
    const dateDebut = dateImport(l.date_debut, 'date de début');
    const duree = nombreImport(l.duree_mois, 'durée (mois)', { min: 0, entier: true });
    const id = caut.ajouterObligation(soumissionId, cabinetId, utilisateur.id, {
      type,
      beneficiaire: String(l.beneficiaire || '').trim() || null,
      description_projet: String(l.description_projet || '').trim() || null,
      montant_contrat: montantContrat,
      montant_cautionnement: montantCaut,
      taux_pct: taux, prime_estimee: primeEstimee,
      date_debut: dateDebut, duree_mois: duree,
    });
    ok(numeroLigne, `Obligation ${type} ajoutée (soumission cautionnement #${soumissionId})`);
    return id;
  }

  function importerLigneCaut(l, numeroLigne) {
    const soumissionId = resoudreSoumissionCaut(l);
    const limiteGlobale = nombreImport(l.limite_globale, 'limite globale', { min: 0 });
    const limiteProjet = nombreImport(l.limite_par_projet, 'limite par projet', { min: 0 });
    const fonds = nombreImport(l.fonds_roulement, 'fonds de roulement', { min: 0 });
    const valeurNette = nombreImport(l.valeur_nette, 'valeur nette', { min: 0 });
    const prime = nombreImport(l.prime, 'prime de la ligne', { min: 0 });
    // Règle métier validée AVANT écriture (lib/cautionnement.js la revérifie).
    if (limiteGlobale != null && limiteProjet != null && limiteProjet > limiteGlobale) {
      throw new Error('limite par projet supérieure à la limite globale');
    }
    const id = caut.definirGaranties(soumissionId, cabinetId, utilisateur.id, {
      limite_globale: limiteGlobale, limite_par_projet: limiteProjet,
      fonds_roulement: fonds, valeur_nette: valeurNette, prime,
    });
    ok(numeroLigne, `Ligne de cautionnement enregistrée (soumission cautionnement #${soumissionId})`);
    return id;
  }

  function importerAntecedentsCaut(l, numeroLigne) {
    const soumissionId = resoudreSoumissionCaut(l);
    // Réclamations : format pipe OU JSON des exports (round-trip).
    const reclamations = parserReclamationsCaut(l.reclamations_5ans)
      || parserReclamationsCautJson(l.reclamations_5ans_json);
    const id = caut.definirAntecedents(soumissionId, cabinetId, utilisateur.id, {
      assureur_actuel: String(l.assureur_actuel || '').trim() || null,
      numero_ligne_actuelle: String(l.numero_ligne_actuelle || '').trim() || null,
      date_expiration_actuelle: dateImport(l.date_expiration_actuelle, 'date d’expiration de la ligne actuelle'),
      annees_cautionnement_continu: nombreImport(l.annees_cautionnement_continu, 'années de cautionnement continu', { min: 0, entier: true }),
      reclamations_5ans: reclamations,
      refus_resiliation_ant: boolImport(l.refus_resiliation_ant ?? '', 'refus ou résiliation antérieur'),
      refus_resiliation_details: String(l.refus_resiliation_details || '').trim() || null,
      consentements: {
        credit: boolImport(l.consentement_credit ?? '', 'consentement crédit'),
        etats_financiers: boolImport(l.consentement_etats_financiers ?? '', 'consentement états financiers'),
      },
    });
    ok(numeroLigne, `Antécédents enregistrés (soumission cautionnement #${soumissionId})`);
    return id;
  }

  lignes.forEach((l, i) => {
    const numeroLigne = i + 2; // +1 en-tête, +1 index base 1
    try { inserer(l, numeroLigne); }
    catch (e) { ko(numeroLigne, e.message); }
  });

  journal(cabinetId, utilisateur.id, 'import_csv',
    `Import : ${rapport.crees} créés, ${rapport.erreurs} erreurs sur ${rapport.total} lignes`);
  res.render('import/index', { ...baseRender, rapport });
}, (err, req, res, next) => {
  res.status(400).render('import/index', {
    produits: PRODUITS, NOMS_LIGNES,
    modelesAuto: Object.entries(MODELES_AUTO).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesBiens: Object.entries(MODELES_BIENS).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesRc: Object.entries(MODELES_RC).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesCyber: Object.entries(MODELES_CYBER).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesEo: Object.entries(MODELES_EO).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesDo: Object.entries(MODELES_DO).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesPe: Object.entries(MODELES_PE).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesFlotte: Object.entries(MODELES_FLOTTE).map(([cle, m]) => ({ cle, titre: m.titre })),
    modelesCautionnement: Object.entries(MODELES_CAUTIONNEMENT).map(([cle, m]) => ({ cle, titre: m.titre })),
    rapport: { erreurGlobale: 'Téléversement refusé : ' + err.message },
  });
});

module.exports = router;
module.exports.MODELES_AUTO = MODELES_AUTO;
module.exports.MODELES_BIENS = MODELES_BIENS;
module.exports.MODELES_RC = MODELES_RC;
module.exports.MODELES_CYBER = MODELES_CYBER;
module.exports.MODELES_EO = MODELES_EO;
module.exports.MODELES_DO = MODELES_DO;
module.exports.MODELES_PE = MODELES_PE;
module.exports.MODELES_FLOTTE = MODELES_FLOTTE;
