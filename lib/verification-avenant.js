/**
 * lib/verification-avenant.js — Vérification automatique des avenants.
 *
 * Principe : quand l'assureur retourne son document (avenant, note de
 * couverture, police modifiée), on le compare champ par champ à ce qui
 * lui avait été DEMANDÉ — c'est-à-dire l'état courant de la fiche produit
 * de la police (la modification y a été faite et versionnée). Le moteur
 * produit un RAPPORT d'écarts avec des verdicts prudents :
 *   conforme    : les deux valeurs concordent après normalisation ;
 *   ecart       : les deux valeurs sont connues et diffèrent ;
 *   absent      : demandé, mais introuvable dans le document ;
 *   a_confirmer : extraction à confiance basse ou formats non comparables
 *                 — jamais de verdict sec dans ce cas ;
 *   surplus     : présent dans le document, mais non demandé.
 * Le rapport PROPOSE, l'humain tranche (« Marquer comme vérifiée ») et le
 * courriel de correction ne part que sur clic explicite (module Courriels,
 * mode simulé sans compte SMTP — comme les demandes d'informations).
 *
 * Règle d'or : aucune suppression (archivage doux), aucune décision
 * automatique appliquée aux données.
 */
const fs = require('fs');
const path = require('path');
const bd = require('./bd');
const { journal } = require('./middleware');
const analyses = require('./analyses-documents');
const extraction = require('./extraction-document');
const moteurAnalyse = require('./analyse-document');

// --- Correspondances police ↔ produit d'analyse --------------------------------
const LIGNE_VERS_PRODUIT = {
  auto: 'auto', biens: 'biens', cgl: 'rc', cyber: 'cyber', eo: 'eo',
  do: 'do', perte_exploitation: 'pe', flotte: 'flotte', cautionnement: 'cautionnement',
};
const COLONNE_SOUMISSION = {
  auto: 'auto_soumission_id', biens: 'biens_soumission_id', cgl: 'rc_soumission_id',
  cyber: 'cyber_soumission_id', eo: 'eo_soumission_id', do: 'do_soumission_id',
  perte_exploitation: 'pe_soumission_id', flotte: 'flotte_soumission_id',
  cautionnement: 'caut_soumission_id',
};
function libProduit(produit) {
  return {
    auto: () => require('./fpq1'), biens: () => require('./biens'),
    rc: () => require('./rc'), cyber: () => require('./cyber'),
    eo: () => require('./eo'), do: () => require('./do'),
    pe: () => require('./pe'), flotte: () => require('./flotte'),
    cautionnement: () => require('./cautionnement'),
  }[produit]();
}

// --- Normalisations -------------------------------------------------------------
function normaliserTexte(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
function normaliserCode(v) {
  return normaliserTexte(v).replace(/[^a-z0-9]/g, '');
}
function normaliserNumero(v) {
  return String(v == null ? '' : v).toUpperCase().replace(/[\s.\-]/g, '').trim();
}
function parserNombre(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[\s  ]/g, '').replace(/\$/g, '')
    .replace(/[^0-9.,-]/g, '').replace(',', '.');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const MOIS_FR = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};
function parserDateISO(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = normaliserTexte(s).match(/^(\d{1,2})(?:er)?\s+([a-z]+)\s+(\d{4})$/);
  if (m && MOIS_FR[m[2]]) {
    return `${m[3]}-${String(MOIS_FR[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}
function parserBooleen(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = normaliserTexte(v);
  if (['oui', 'yes', 'vrai', '1'].includes(s)) return true;
  if (['non', 'no', 'faux', '0', ''].includes(s)) return s === '' ? null : false;
  return null;
}
// Affichage déterministe (espaces régulières) pour l'écran ET le courriel.
function formaterNombre(n) {
  const neg = n < 0;
  const abs = Math.abs(n);
  const entier = Math.trunc(abs);
  const dec = Math.round((abs - entier) * 100);
  let s = String(entier).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (dec) s += `,${String(dec).padStart(2, '0')}`;
  return (neg ? '-' : '') + s;
}
function formaterValeur(type, valeur, argent) {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  if (type === 'nombre') {
    const n = parserNombre(valeur);
    if (n === null) return String(valeur);
    return formaterNombre(n) + (argent ? ' $' : '');
  }
  if (type === 'booleen') {
    const b = parserBooleen(valeur);
    return b === null ? String(valeur) : (b ? 'Oui' : 'Non');
  }
  if (type === 'date') return parserDateISO(valeur) || String(valeur);
  return String(valeur);
}

// --- Registre des champs scalaires comparables -----------------------------------
const CHAMPS_SCALAIRES = {
  'entete.assureur': { libelle: 'Assureur', type: 'texte', souple: true },
  'entete.numero_police': { libelle: 'N° de police', type: 'numero' },
  'entete.date_effet': { libelle: "Date d'effet", type: 'date' },
  'entete.date_echeance': { libelle: "Date d'échéance", type: 'date' },
  'entete.nb_vehicules': { libelle: 'Nombre de véhicules', type: 'nombre' },
  'entete.rayon_operation_km': { libelle: "Rayon d'opération (km)", type: 'nombre' },
  'garanties.prime': { libelle: 'Prime', type: 'nombre', argent: true },
  'garanties.franchise': { libelle: 'Franchise', type: 'nombre', argent: true },
  'garanties.limite': { libelle: 'Limite', type: 'nombre', argent: true },
  'garanties.limite_par_sinistre': { libelle: 'Limite par sinistre', type: 'nombre', argent: true },
  'garanties.limite_agregat': { libelle: 'Limite en agrégat', type: 'nombre', argent: true },
  'garanties.delai_carence': { libelle: 'Délai de carence', type: 'texte' },
  'garanties.base': { libelle: 'Base de couverture', type: 'code' },
  'garanties.periode_indemnite_mois': { libelle: "Période d'indemnité (mois)", type: 'nombre' },
  'garanties.base_montant': { libelle: "Base d'indemnité", type: 'code' },
  'garanties.franchise_jours': { libelle: 'Franchise (jours)', type: 'nombre' },
  'garanties.limite_globale': { libelle: 'Limite globale (ligne)', type: 'nombre', argent: true },
  'garanties.limite_par_projet': { libelle: 'Limite par projet', type: 'nombre', argent: true },
};
// Types particuliers des champs de listes (sinon : numérique META, ou texte).
const TYPES_CHAMPS_LISTE = {
  gicleurs: 'booleen', date_naissance: 'date', date_embauche: 'date',
  niv: 'numero', numero_permis: 'numero', adresse: 'adresse',
  type_construction: 'code', type_vehicule: 'code', type_mesure: 'code',
  type_contenu: 'code', type: 'code', statut: 'code',
};
const ARGENT_LISTE = new Set([
  'valeur_batiment', 'valeur', 'chiffre_affaires', 'montant_contrat',
  'montant_cautionnement', 'prime_estimee',
]);
const GARANTIES_ELEMENT = {
  formule: { libelle: 'Formule', type: 'code' },
  franchise: { libelle: 'Franchise', type: 'nombre', argent: true },
  montant_assurance: { libelle: "Montant d'assurance", type: 'nombre', argent: true },
  prime: { libelle: 'Prime', type: 'nombre', argent: true },
  limite_par_sinistre: { libelle: 'Limite par sinistre', type: 'nombre', argent: true },
  limite_agregat: { libelle: 'Limite en agrégat', type: 'nombre', argent: true },
  rc_montant: { libelle: 'Responsabilité civile', type: 'nombre', argent: true },
  protection_b: { libelle: 'Protection B', type: 'code' },
  franchise_b: { libelle: 'Franchise (protection B)', type: 'nombre', argent: true },
};

// --- État DEMANDÉ : état courant de la fiche produit de la police ------------------
function listesDemandees(produit, s) {
  const L = {};
  if (!s) return L;
  const champsDe = (obj, cles) => {
    const o = {};
    for (const c of cles) o[c] = obj ? obj[c] : null;
    return o;
  };
  if (produit === 'auto' || produit === 'flotte') {
    L.vehicules = (s.vehicules || []).map((v) => ({
      champs: {
        niv: produit === 'auto' ? v.vin : v.niv,
        annee: v.annee, marque: v.marque, modele: v.modele,
        type_vehicule: v.type_vehicule, usage: v.usage,
        valeur: produit === 'auto' ? v.valeur_estimee : v.valeur,
        lieu_remisage: v.lieu_remisage, rayon_operation_km: v.rayon_operation_km,
        annee_acquisition: v.annee_acquisition,
      },
      garanties: v.garanties ? champsDe(v.garanties, ['rc_montant', 'protection_b', 'franchise_b']) : null,
    }));
    L.conducteurs = (s.conducteurs || []).map((c) => ({
      champs: {
        nom: c.nom, prenom: c.prenom, date_naissance: c.date_naissance, age: c.age,
        numero_permis: c.numero_permis, classe_permis: c.classe_permis,
        annees_experience: produit === 'auto' ? c.annees_experience_ca : c.annees_experience,
        annees_experience_lourds: c.annees_experience_lourds, date_embauche: c.date_embauche,
      },
    }));
  }
  if (produit === 'biens') {
    L.batiments = (s.batiments || []).map((b) => ({
      champs: champsDe(b, ['adresse', 'ville', 'code_postal', 'type_construction',
        'annee_construction', 'occupation', 'valeur_batiment', 'superficie_pi2',
        'nb_etages', 'gicleurs', 'distance_caserne_km', 'chauffage', 'annee_toiture']),
      garanties: b.garanties
        ? champsDe(b.garanties, ['formule', 'franchise', 'montant_assurance', 'prime']) : null,
      contenus: (b.contenus || []).map((c) => ({
        champs: champsDe(c, ['description', 'type_contenu', 'valeur']),
      })),
    }));
    L.contenus = [];
    for (const b of L.batiments) {
      for (const c of b.contenus || []) {
        L.contenus.push({ champs: c.champs, contexte: b.champs.adresse || null });
      }
    }
    for (const c of s.contenus_generaux || []) {
      L.contenus.push({ champs: champsDe(c, ['description', 'type_contenu', 'valeur']), contexte: null });
    }
  }
  if (produit === 'rc') {
    L.exploitations = (s.exploitations || []).map((e) => ({
      champs: champsDe(e, ['adresse', 'ville', 'code_postal', 'type_activite',
        'description_activites', 'chiffre_affaires', 'nb_employes']),
      garanties: e.garanties
        ? champsDe(e.garanties, ['limite_par_sinistre', 'limite_agregat', 'franchise', 'formule', 'prime']) : null,
    }));
  }
  if (produit === 'cyber') {
    L.mesures = (s.mesures || []).map((m) => ({
      champs: champsDe(m, ['type_mesure', 'statut', 'details']),
    }));
  }
  if (produit === 'eo') {
    L.activites = (s.activites || []).map((a) => ({
      champs: champsDe(a, ['description_activite', 'chiffre_affaires', 'nb_professionnels']),
    }));
  }
  if (produit === 'do') {
    L.dirigeants = (s.dirigeants || []).map((d) => ({
      champs: champsDe(d, ['nom', 'fonction', 'annees_experience', 'antecedents_personnels']),
    }));
  }
  if (produit === 'pe') {
    L.etablissements = (s.etablissements || []).map((e) => ({
      champs: champsDe(e, ['nom_lieu', 'adresse', 'occupation', 'chiffre_affaires',
        'superficie', 'annee_construction']),
    }));
  }
  if (produit === 'cautionnement') {
    L.obligations = (s.obligations || []).map((o) => ({
      champs: champsDe(o, ['type', 'beneficiaire', 'description_projet',
        'montant_contrat', 'montant_cautionnement', 'taux_pct', 'prime_estimee']),
    }));
  }
  return L;
}

function garantiesDemandees(produit, s, police) {
  const G = {};
  if (police.franchise !== null && police.franchise !== undefined) {
    G['garanties.franchise'] = police.franchise;
  }
  const g = s && s.garanties;
  for (const k of ['limite_par_sinistre', 'limite_agregat', 'delai_carence', 'base',
    'limite', 'periode_indemnite_mois', 'base_montant', 'franchise_jours',
    'limite_globale', 'limite_par_projet']) {
    if (g && g[k] !== null && g[k] !== undefined && g[k] !== '') G[`garanties.${k}`] = g[k];
  }
  // RC : garanties par lieu — valeur scalaire seulement si elle est unique.
  if (produit === 'rc' && s) {
    for (const k of ['limite_par_sinistre', 'limite_agregat']) {
      const vals = [...new Set((s.exploitations || [])
        .map((e) => (e.garanties ? e.garanties[k] : null))
        .filter((v) => v !== null && v !== undefined).map(Number))];
      if (vals.length === 1) G[`garanties.${k}`] = vals[0];
    }
  }
  // Prime : garanties du produit, sinon somme des primes par élément.
  let prime = g && g.prime !== null && g.prime !== undefined ? Number(g.prime) : null;
  if (prime === null && s) {
    const somme = (arr) => {
      const vals = (arr || []).map((x) => (x.garanties ? x.garanties.prime : null))
        .filter((v) => v !== null && v !== undefined).map(Number);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    if (produit === 'biens') prime = somme(s.batiments);
    if (produit === 'rc') prime = somme(s.exploitations);
  }
  if (prime !== null) G['garanties.prime'] = prime;
  return G;
}

function construireEtatDemande(police) {
  const produit = LIGNE_VERS_PRODUIT[police.ligne] || police.ligne;
  const entete = {
    'entete.assureur': police.assureur,
    'entete.numero_police': police.numero_police,
    'entete.date_effet': police.date_effet,
    'entete.date_echeance': police.date_echeance,
  };
  let s = null;
  const col = COLONNE_SOUMISSION[police.ligne];
  if (col && police[col]) {
    try { s = libProduit(produit).obtenirSoumission(police[col], police.cabinet_id); }
    catch (e) { s = null; }
  }
  if (produit === 'flotte' && s) {
    if (s.nb_vehicules !== null && s.nb_vehicules !== undefined) entete['entete.nb_vehicules'] = s.nb_vehicules;
    if (s.rayon_operation_km !== null && s.rayon_operation_km !== undefined) {
      entete['entete.rayon_operation_km'] = s.rayon_operation_km;
    }
  }
  return { produit, entete, garanties: garantiesDemandees(produit, s, police), listes: listesDemandees(produit, s) };
}

// --- État APPLIQUÉ : propositions d'une analyse de document ------------------------
function construireEtatApplique(analyse) {
  const entete = {};
  const garanties = {};
  const listes = {};
  let pseudoVehicule = null;
  let pseudoObligation = null;
  for (const c of (analyse && analyse.champs) || []) {
    const cible = { valeur: c.valeur, confiance: c.confiance || 'moyenne', extrait: c.extrait || null };
    if (c.champ.startsWith('entete.')) entete[c.champ] = cible;
    else if (c.champ.startsWith('garanties.')) garanties[c.champ] = cible;
    else if (c.champ.startsWith('vehicule.')) {
      pseudoVehicule = pseudoVehicule || { champs: {}, confiance: 'moyenne', extrait: null };
      const cle = c.champ.slice('vehicule.'.length);
      pseudoVehicule.champs[cle] = c.valeur;
      if (c.confiance === 'basse') pseudoVehicule.confiance = 'basse';
      if (!pseudoVehicule.extrait) pseudoVehicule.extrait = c.extrait || null;
    } else if (c.champ.startsWith('obligation.')) {
      pseudoObligation = pseudoObligation || { champs: {}, confiance: 'moyenne', extrait: null };
      pseudoObligation.champs[c.champ.slice('obligation.'.length)] = c.valeur;
    }
  }
  for (const [type, items] of Object.entries((analyse && analyse.listes) || {})) {
    if (!Array.isArray(items)) continue;
    listes[type] = items.map((it) => ({
      champs: it.champs || {},
      confiance: it.confiance || 'moyenne',
      extrait: it.extrait || null,
      garanties: it.garanties || null,
    }));
  }
  if (pseudoVehicule && !(listes.vehicules || []).length) listes.vehicules = [pseudoVehicule];
  if (pseudoObligation && !(listes.obligations || []).length) listes.obligations = [pseudoObligation];
  return { entete, garanties, listes };
}

// --- Comparaison -------------------------------------------------------------------
function comparerValeur({ cle, libelle, contexte, section, type, argent, souple, demande, applique, confiance, extrait }) {
  const ligne = {
    cle, section, libelle, contexte: contexte || null,
    demande: demande === undefined ? null : demande,
    applique: applique === undefined ? null : applique,
    demandeAffiche: formaterValeur(type, demande, argent),
    appliqueAffiche: formaterValeur(type, applique, argent),
    verdict: null, extrait: extrait || null, confiance: confiance || null,
  };
  if (confiance === 'basse') { ligne.verdict = 'a_confirmer'; return ligne; }
  if (type === 'nombre') {
    const d = parserNombre(demande); const a = parserNombre(applique);
    if (d === null || a === null) ligne.verdict = 'a_confirmer';
    else ligne.verdict = Math.abs(d - a) < 0.01 ? 'conforme' : 'ecart';
  } else if (type === 'date') {
    const d = parserDateISO(demande); const a = parserDateISO(applique);
    if (!d || !a) ligne.verdict = 'a_confirmer';
    else ligne.verdict = d === a ? 'conforme' : 'ecart';
  } else if (type === 'booleen') {
    const d = parserBooleen(demande); const a = parserBooleen(applique);
    if (d === null || a === null) ligne.verdict = 'a_confirmer';
    else ligne.verdict = d === a ? 'conforme' : 'ecart';
  } else if (type === 'numero') {
    ligne.verdict = normaliserNumero(demande) === normaliserNumero(applique) ? 'conforme' : 'ecart';
  } else if (type === 'code') {
    ligne.verdict = normaliserCode(demande) === normaliserCode(applique) ? 'conforme' : 'ecart';
  } else if (type === 'adresse') {
    const net = (v) => normaliserTexte(v).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    ligne.verdict = net(demande) === net(applique) ? 'conforme' : 'ecart';
  } else {
    const d = normaliserTexte(demande); const a = normaliserTexte(applique);
    if (d === a) ligne.verdict = 'conforme';
    else if (souple && d.length >= 4 && a.length >= 4 && (d.includes(a) || a.includes(d))) ligne.verdict = 'conforme';
    else ligne.verdict = 'ecart';
  }
  return ligne;
}

const NOMS_LISTES = {
  batiments: 'Bâtiment', vehicules: 'Véhicule', conducteurs: 'Conducteur',
  exploitations: "Lieu d'exploitation", dirigeants: 'Dirigeant',
  etablissements: 'Établissement', obligations: 'Obligation',
  activites: 'Activité professionnelle', mesures: 'Mesure de sécurité',
  contenus: 'Contenu',
};
function identiteElement(type, c) {
  const adr = (v) => normaliserTexte(v).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  switch (type) {
    case 'batiments': return adr(c.adresse);
    case 'exploitations': return adr(c.adresse) || normaliserTexte(c.type_activite);
    case 'etablissements': return adr(c.adresse) || normaliserTexte(c.nom_lieu);
    case 'vehicules': {
      const niv = normaliserNumero(c.niv);
      if (niv) return `niv:${niv}`;
      const t = [c.annee, c.marque, c.modele, c.description].filter(Boolean).join(' ');
      return t ? `txt:${normaliserTexte(t).replace(/\s+/g, '')}` : '';
    }
    case 'conducteurs': {
      const p = normaliserNumero(c.numero_permis);
      if (p) return `permis:${p}`;
      const t = [c.nom, c.prenom].filter(Boolean).join(' ');
      return t ? `nom:${normaliserTexte(t)}` : '';
    }
    case 'dirigeants': return normaliserTexte(c.nom);
    case 'obligations': return `${normaliserCode(c.type)}|${normaliserTexte(c.beneficiaire)}`;
    case 'activites': return normaliserTexte(c.description_activite);
    case 'mesures': return normaliserCode(c.type_mesure);
    case 'contenus': return normaliserTexte(c.description);
    default: return '';
  }
}
function libelleElement(type, c) {
  switch (type) {
    case 'batiments': return [c.adresse, c.ville].filter(Boolean).join(', ') || 'Bâtiment sans adresse';
    case 'exploitations': return [c.adresse, c.ville].filter(Boolean).join(', ') || "Lieu d'exploitation";
    case 'etablissements': return c.nom_lieu || c.adresse || 'Établissement';
    case 'vehicules': {
      const t = [c.annee, c.marque, c.modele, c.description].filter(Boolean).join(' ');
      return (t || 'Véhicule') + (c.niv ? ` (NIV ${c.niv})` : '');
    }
    case 'conducteurs': return [c.prenom, c.nom].filter(Boolean).join(' ') || 'Conducteur';
    case 'dirigeants': return c.nom || 'Dirigeant';
    case 'obligations': return [c.type, c.beneficiaire].filter(Boolean).join(' — ') || 'Obligation';
    case 'activites': return c.description_activite || 'Activité';
    case 'mesures': return c.type_mesure || 'Mesure';
    case 'contenus': return c.description || 'Contenu';
    default: return type;
  }
}
function typeChampListe(type, champ) {
  if (TYPES_CHAMPS_LISTE[champ]) return TYPES_CHAMPS_LISTE[champ];
  const meta = moteurAnalyse.META_LISTES[type];
  const cm = meta && meta.champs[champ];
  if (cm && cm.numerique) return 'nombre';
  return 'texte';
}

function comparerListes(type, demItems, appItems, lignes) {
  const nomListe = NOMS_LISTES[type] || type;
  const meta = moteurAnalyse.META_LISTES[type];
  const utilises = new Set();
  for (const d of demItems || []) {
    const contexte = d.contexte
      ? `${nomListe} — ${d.contexte} — ${libelleElement(type, d.champs)}`
      : `${nomListe} — ${libelleElement(type, d.champs)}`;
    const cleId = identiteElement(type, d.champs);
    let idx = -1;
    if (cleId) {
      idx = (appItems || []).findIndex((a, i) => !utilises.has(i) && identiteElement(type, a.champs) === cleId);
    }
    if (idx === -1) {
      lignes.push({
        cle: `liste.${type}`, section: 'liste', libelle: nomListe, contexte,
        demande: libelleElement(type, d.champs), applique: null,
        demandeAffiche: libelleElement(type, d.champs), appliqueAffiche: '—',
        verdict: 'absent', extrait: null, confiance: null,
      });
      continue;
    }
    utilises.add(idx);
    const a = appItems[idx];
    // Champs présents des deux côtés.
    const champs = new Set([...Object.keys(d.champs || {}), ...Object.keys((a && a.champs) || {})]);
    for (const champ of champs) {
      const dv = d.champs[champ]; const av = a.champs[champ];
      if (dv === null || dv === undefined || dv === '' || av === null || av === undefined || av === '') continue;
      const cm = (meta && meta.champs[champ]) || {};
      lignes.push(comparerValeur({
        cle: `liste.${type}.${champ}`, section: 'liste',
        libelle: cm.libelle || champ, contexte,
        type: typeChampListe(type, champ), argent: ARGENT_LISTE.has(champ),
        demande: dv, applique: av, confiance: a.confiance, extrait: a.extrait,
      }));
    }
    // Garanties rattachées à l'élément (biens par bâtiment, RC par lieu,
    // véhicules) — comparées seulement si le document en fournit aussi.
    if (d.garanties && a.garanties) {
      for (const [gk, gm] of Object.entries(GARANTIES_ELEMENT)) {
        const dv = d.garanties[gk]; const av = a.garanties[gk];
        if (dv === null || dv === undefined || dv === '' || av === null || av === undefined || av === '') continue;
        lignes.push(comparerValeur({
          cle: `liste.${type}.garanties.${gk}`, section: 'liste',
          libelle: gm.libelle, contexte, type: gm.type, argent: gm.argent,
          demande: dv, applique: av, confiance: a.confiance, extrait: a.extrait,
        }));
      }
    }
  }
  (appItems || []).forEach((a, i) => {
    if (utilises.has(i)) return;
    const contexte = `${nomListe} — ${libelleElement(type, a.champs)}`;
    lignes.push({
      cle: `liste.${type}`, section: 'liste', libelle: nomListe, contexte,
      demande: null, applique: libelleElement(type, a.champs),
      demandeAffiche: '—', appliqueAffiche: libelleElement(type, a.champs),
      verdict: 'surplus', extrait: a.extrait || null, confiance: a.confiance || null,
    });
  });
}

function comparer(etatDemande, etatApplique) {
  const lignes = [];
  for (const [cle, meta] of Object.entries(CHAMPS_SCALAIRES)) {
    const source = cle.startsWith('entete.') ? etatDemande.entete : etatDemande.garanties;
    const d = source ? source[cle] : undefined;
    if (d === null || d === undefined || d === '') continue;
    const cible = cle.startsWith('entete.') ? etatApplique.entete : etatApplique.garanties;
    const a = cible ? cible[cle] : undefined;
    const section = cle.startsWith('entete.') ? 'entete' : 'garanties';
    if (!a) {
      lignes.push({
        cle, section, libelle: meta.libelle, contexte: null,
        demande: d, applique: null,
        demandeAffiche: formaterValeur(meta.type, d, meta.argent), appliqueAffiche: '—',
        verdict: 'absent', extrait: null, confiance: null,
      });
    } else {
      lignes.push(comparerValeur({
        cle, section, libelle: meta.libelle, contexte: null,
        type: meta.type, argent: meta.argent, souple: meta.souple,
        demande: d, applique: a.valeur, confiance: a.confiance, extrait: a.extrait,
      }));
    }
  }
  const types = new Set([...Object.keys(etatDemande.listes || {}), ...Object.keys(etatApplique.listes || {})]);
  for (const type of types) {
    // Contenus (biens) : le moteur d'extraction courant ne les produit pas ;
    // on ne les compare que si l'analyse en propose (sinon, aucune accusation
    // d'absence impossible à vérifier).
    if (type === 'contenus' && !(etatApplique.listes && 'contenus' in etatApplique.listes)) continue;
    comparerListes(type, (etatDemande.listes || {})[type], (etatApplique.listes || {})[type], lignes);
  }
  const compteurs = { conforme: 0, ecart: 0, absent: 0, a_confirmer: 0, surplus: 0 };
  for (const l of lignes) compteurs[l.verdict] = (compteurs[l.verdict] || 0) + 1;
  const statut = (compteurs.ecart || compteurs.absent || compteurs.surplus)
    ? 'ecarts' : (compteurs.a_confirmer ? 'a_confirmer' : 'conforme');
  return { lignes, compteurs, statut };
}

// --- Accès BD : vérifications ---------------------------------------------------------
function ligneVersObjet(r) {
  if (!r) return null;
  try { r.rapport = r.rapport ? JSON.parse(r.rapport) : null; } catch (e) { r.rapport = null; }
  return r;
}
function obtenirVerification(id, cabinetId, { inclureArchives = false } = {}) {
  const r = bd.prepare(`
    SELECT * FROM verifications_avenants WHERE id = ? AND cabinet_id = ?${inclureArchives ? '' : ' AND archive = 0'}
  `).get(id, cabinetId);
  return ligneVersObjet(r);
}
function listerVerificationsPolice(cabinetId, policeId) {
  return bd.prepare(`
    SELECT v.*, u.nom AS auteur_nom, vu.nom AS verifiee_par_nom
    FROM verifications_avenants v
    LEFT JOIN users u ON u.id = v.cree_par
    LEFT JOIN users vu ON vu.id = v.verifiee_par
    WHERE v.cabinet_id = ? AND v.police_id = ? AND v.archive = 0
    ORDER BY v.cree_le DESC, v.id DESC
  `).all(cabinetId, policeId).map(ligneVersObjet);
}
function piecesJointesPolice(cabinetId, policeId) {
  return bd.prepare(`
    SELECT pj.id, pj.nom, pj.mime, pj.taille, c.id AS courriel_id, c.sujet, c.date_courriel
    FROM courriel_pieces_jointes pj
    JOIN courriels c ON c.id = pj.courriel_id
    WHERE pj.cabinet_id = ? AND c.cabinet_id = ? AND c.police_id = ? AND pj.archive = 0 AND c.archive = 0
    ORDER BY pj.id DESC
  `).all(cabinetId, cabinetId, policeId);
}

function creerVerification({ cabinetId, policeId, produit, sourceType, sourceId, analyseId, rapport, statut, userId }) {
  const r = bd.prepare(`
    INSERT INTO verifications_avenants
      (cabinet_id, police_id, produit, source_type, source_id, analyse_id, rapport, statut, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, policeId, produit, sourceType, sourceId || null, analyseId || null,
    JSON.stringify(rapport), statut, userId || null);
  const id = r.lastInsertRowid;
  const c = rapport.compteurs || {};
  journal(cabinetId, userId, 'avenant_verification',
    `Vérification d'avenant #${id} sur la police #${policeId} (${produit}) — statut ${statut} : `
    + `${c.conforme || 0} conforme(s), ${c.ecart || 0} écart(s), ${c.absent || 0} absent(s), `
    + `${c.a_confirmer || 0} à confirmer, ${c.surplus || 0} surplus (source : ${sourceType} #${sourceId || '—'})`);
  return obtenirVerification(id, cabinetId);
}

function marquerVerifiee(id, cabinetId, utilisateur) {
  const v = obtenirVerification(id, cabinetId);
  if (!v) throw new Error('Vérification introuvable.');
  if (v.verifiee_le) throw new Error('Cette vérification a déjà été marquée comme vérifiée.');
  bd.prepare(`
    UPDATE verifications_avenants
    SET verifiee_par = ?, verifiee_le = datetime('now'), maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(utilisateur.id, id, cabinetId);
  journal(cabinetId, utilisateur.id, 'avenant_verifie',
    `Avenant de la police #${v.police_id} vérifié (vérification #${id}) — rapport accepté avec le statut « ${v.statut} » `
    + `(${(v.rapport && v.rapport.compteurs && v.rapport.compteurs.ecart) || 0} écart(s), `
    + `${(v.rapport && v.rapport.compteurs && v.rapport.compteurs.absent) || 0} absent(s))`);
  return obtenirVerification(id, cabinetId);
}

// --- Pipeline : analyser le document de l'assureur, puis comparer ----------------------
async function analyserSource(cabinetId, userId, { nomOrigine, chemin, mime, taille }) {
  const analyseId = analyses.creerAnalyse(cabinetId, userId, { nomOrigine, chemin, mime, taille });
  try {
    analyses.majStatut(analyseId, cabinetId, 'en_cours');
    const ext = await extraction.extraireTexte({ chemin, mime, nom: nomOrigine });
    analyses.enregistrerExtraction(analyseId, cabinetId, userId, { texte: ext.texte, methode: ext.methode });
    if (!ext.texte) {
      analyses.majStatut(analyseId, cabinetId, 'echec', { message: ext.avertissement, methodeExtraction: ext.methode });
      throw new Error(ext.avertissement || "Aucun texte n'a pu être extrait du document.");
    }
    const r = await moteurAnalyse.analyser(ext.texte, { cabinetId, tableau: ext.tableau || null });
    analyses.enregistrerPropositions(analyseId, cabinetId, userId, {
      produit: r.produit, confianceGlobale: r.confiance, champs: r.champs, listes: r.listes,
      moteur: r.moteur, message: [ext.avertissement, r.message].filter(Boolean).join(' ') || null,
    });
    return analyses.obtenirAnalyse(analyseId, cabinetId);
  } catch (e) {
    if (!String(e.message).includes('extrait')) {
      analyses.majStatut(analyseId, cabinetId, 'echec', { message: `Analyse impossible : ${e.message}` });
    }
    throw e;
  }
}

async function verifierDocumentDepose(cabinetId, userId, police, fichier) {
  const analyse = await analyserSource(cabinetId, userId, {
    nomOrigine: fichier.nomOrigine, chemin: fichier.chemin, mime: fichier.mime, taille: fichier.taille,
  });
  bd.prepare('UPDATE analyses_documents SET police_id = ? WHERE id = ? AND cabinet_id = ?')
    .run(police.id, analyse.id, cabinetId);
  return lancerComparaison(cabinetId, userId, police, analyse, 'document', analyse.id);
}

async function verifierPieceJointe(cabinetId, userId, police, pj) {
  if (!fs.existsSync(pj.chemin)) throw new Error('Le fichier de la pièce jointe est introuvable sur le serveur.');
  const analyse = await analyserSource(cabinetId, userId, {
    nomOrigine: pj.nom, chemin: pj.chemin, mime: pj.mime, taille: pj.taille,
  });
  bd.prepare('UPDATE analyses_documents SET police_id = ? WHERE id = ? AND cabinet_id = ?')
    .run(police.id, analyse.id, cabinetId);
  return lancerComparaison(cabinetId, userId, police, analyse, 'piece_jointe_courriel', pj.id);
}

function lancerComparaison(cabinetId, userId, police, analyse, sourceType, sourceId) {
  const demande = construireEtatDemande(police);
  const applique = construireEtatApplique(analyse);
  const { lignes, compteurs, statut } = comparer(demande, applique);
  const rapport = {
    genere_le: new Date().toISOString(),
    produit_demande: demande.produit,
    produit_document: analyse.produit_detecte || null,
    lignes, compteurs,
  };
  return creerVerification({
    cabinetId, policeId: police.id, produit: demande.produit,
    sourceType, sourceId, analyseId: analyse.id, rapport, statut, userId,
  });
}

// --- Courriel de correction à l'assureur ------------------------------------------------
function texteLigneCorrection(l) {
  const nom = l.contexte ? `${l.contexte} — ${l.libelle}` : l.libelle;
  if (l.verdict === 'ecart') {
    return `${nom} demandée : ${l.demandeAffiche} — appliquée dans votre document : ${l.appliqueAffiche}.`;
  }
  if (l.verdict === 'absent') {
    return l.section === 'liste'
      ? `${l.contexte} : demandé, mais absent de votre document.`
      : `${nom} demandée : ${l.demandeAffiche} — absente de votre document.`;
  }
  if (l.verdict === 'surplus') {
    return `${l.contexte} : présent dans votre document, mais non demandé.`;
  }
  return null;
}

function genererBrouillonCorrection(verification, police) {
  let destinataire = '';
  let assureurRow = null;
  if (police.assureur_id) {
    assureurRow = bd.prepare('SELECT * FROM assureurs WHERE id = ? AND cabinet_id = ?')
      .get(police.assureur_id, police.cabinet_id);
  }
  if (!assureurRow && police.assureur) {
    assureurRow = bd.prepare('SELECT * FROM assureurs WHERE cabinet_id = ? AND lower(nom) = lower(?)')
      .get(police.cabinet_id, police.assureur);
  }
  if (assureurRow) destinataire = assureurRow.mod_courriel || assureurRow.courriel_general || '';
  const client = bd.prepare('SELECT raison_sociale FROM clients WHERE id = ?').get(police.client_id);
  const sujet = `Correction d'avenant — police ${police.numero_police}${client ? ` (${client.raison_sociale})` : ''}`;
  const lignesTxt = (((verification.rapport || {}).lignes) || [])
    .map(texteLigneCorrection).filter(Boolean);
  const corps = [
    'Bonjour,',
    '',
    `Nous avons comparé l'avenant émis pour la police ${police.numero_police} `
      + `(${police.assureur}${client ? `, assuré : ${client.raison_sociale}` : ''}) `
      + 'à la modification qui vous avait été demandée. Les écarts suivants ont été relevés :',
    '',
    ...lignesTxt.map((t) => `- ${t}`),
    '',
    'Pouvez-vous apporter les corrections nécessaires et nous transmettre l\'avenant révisé ?',
    '',
    'Merci de votre collaboration.',
  ].join('\n');
  return { destinataire, sujet, corps };
}

async function envoyerCorrection(id, cabinetId, utilisateur, { destinataire, sujet, corps }) {
  const v = obtenirVerification(id, cabinetId);
  if (!v) throw new Error('Vérification introuvable.');
  if (v.correction_envoyee_le) throw new Error('La demande de correction a déjà été envoyée pour cette vérification.');
  const dest = String(destinataire || '').trim();
  if (!dest || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) {
    throw new Error('Adresse destinataire invalide : corrigez-la avant l\'envoi.');
  }
  // Le brouillon (éventuellement modifié) est conservé avant tout envoi.
  bd.prepare(`
    UPDATE verifications_avenants
    SET correction_destinataire = ?, correction_sujet = ?, correction_corps = ?, maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(dest, sujet, corps, id, cabinetId);
  const compte = bd.prepare(
    'SELECT * FROM courriel_comptes WHERE cabinet_id = ? AND actif = 1 AND archive = 0 ORDER BY nom LIMIT 1'
  ).get(cabinetId);
  let mode = 'simule';
  let messageId = `simule-correction-${id}-${Date.now()}@courtier.local`;
  if (compte) {
    const courrielsLib = require('./courriels');
    const envoi = await courrielsLib.envoyerCourriel(bd, compte, { a: dest, sujet, texte: corps });
    mode = 'smtp';
    messageId = envoi.messageId || null;
  }
  bd.prepare(`
    UPDATE verifications_avenants
    SET correction_envoyee_le = datetime('now'), correction_mode_envoi = ?, correction_message_id = ?,
        maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(mode, messageId, id, cabinetId);
  journal(cabinetId, utilisateur.id, 'correction_avenant_envoyee',
    `Demande de correction d'avenant envoyée à ${dest} pour la police #${v.police_id} (vérification #${id}) — mode `
    + (mode === 'simule' ? 'SIMULÉ (aucun compte d\'envoi configuré, aucun courriel réel n\'est parti)' : 'SMTP via le compte du cabinet'));
  return { verification: obtenirVerification(id, cabinetId), mode };
}

module.exports = {
  LIGNE_VERS_PRODUIT,
  normaliserTexte, normaliserCode, normaliserNumero,
  parserNombre, parserDateISO, parserBooleen, formaterValeur, formaterNombre,
  construireEtatDemande, construireEtatApplique, comparer, comparerValeur,
  obtenirVerification, listerVerificationsPolice, piecesJointesPolice,
  marquerVerifiee, analyserSource, verifierDocumentDepose, verifierPieceJointe,
  lancerComparaison, genererBrouillonCorrection, envoyerCorrection, texteLigneCorrection,
};
