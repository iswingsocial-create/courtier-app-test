/**
 * lib/analyse-tableur.js — Moteur de correspondance TABULAIRE (module
 * « Analyse de documents IA », v2 étape 2) : un tableur téléversé tel quel
 * (.xlsx / .csv — liste de permis d'un entrepreneur, parc de véhicules...)
 * devient directement une LISTE structurée éditable à la révision, sans que
 * l'utilisateur ait à convertir quoi que ce soit.
 *
 * Les en-têtes sont mappés vers les clés internes via les MÊMES
 * correspondances que l'import CSV (lib/entetes-import.js : EQUIV /
 * EQUIV_NORM — apostrophes droites et courbes, « main-d'œuvre », etc.), puis
 * vers les champs logiques des listes (META_LISTES de lib/analyse-document.js).
 * Le type de liste est détecté par les en-têtes (permis/classe/naissance →
 * conducteurs ; NIV/marque/année → véhicules ; ...). Aucune écriture en base.
 */
const { EQUIV_NORM, cleEntete } = require('./entetes-import');
const { META_LISTES, parserDate, parserMontant } = require('./analyse-document');

// Clé d'import pour un en-tête brut (EQUIV_NORM d'abord, sinon la forme
// normalisée snake_case — les en-têtes déjà en snake_case passent tels quels).
function cleImport(entete) {
  const ck = cleEntete(entete);
  return EQUIV_NORM[ck] || ck.replace(/\s+/g, '_');
}

// Correspondances clé d'import → champ logique de liste, par type de liste.
// (EQUIV mappe « NIV » vers « vin » — clé FPQ1 : les deux sont acceptés.)
const CORRESPONDANCES = {
  conducteurs: {
    nom: 'nom', prenom: 'prenom', date_naissance: 'date_naissance', age: 'age',
    numero_permis: 'numero_permis', classe_permis: 'classe_permis',
    annees_experience: 'annees_experience',
    annees_experience_lourds: 'annees_experience_lourds',
    date_embauche: 'date_embauche',
  },
  vehicules: {
    vin: 'niv', niv: 'niv', annee: 'annee', marque: 'marque', modele: 'modele',
    type_vehicule: 'type_vehicule', usage: 'usage', valeur: 'valeur',
    valeur_estimee: 'valeur', lieu_remisage: 'lieu_remisage',
    rayon_operation_km: 'rayon_operation_km', annee_acquisition: 'annee_acquisition',
  },
  batiments: {
    adresse: 'adresse', ville: 'ville', code_postal: 'code_postal',
    type_construction: 'type_construction', annee_construction: 'annee_construction',
    occupation: 'occupation', valeur_batiment: 'valeur_batiment',
    superficie_pi2: 'superficie_pi2', nb_etages: 'nb_etages', gicleurs: 'gicleurs',
    distance_caserne_km: 'distance_caserne_km', chauffage: 'chauffage',
    annee_toiture: 'annee_toiture',
  },
  exploitations: {
    adresse: 'adresse', ville: 'ville', code_postal: 'code_postal',
    type_activite: 'type_activite', description_activites: 'description_activites',
    chiffre_affaires: 'chiffre_affaires', nb_employes: 'nb_employes',
  },
  dirigeants: {
    nom: 'nom', fonction: 'fonction', annees_experience: 'annees_experience',
    antecedents_personnels: 'antecedents_personnels',
  },
  etablissements: {
    nom_lieu: 'nom_lieu', adresse: 'adresse', occupation: 'occupation',
    chiffre_affaires: 'chiffre_affaires', superficie: 'superficie',
    annee_construction: 'annee_construction',
  },
  obligations: {
    type: 'type', beneficiaire: 'beneficiaire',
    description_projet: 'description_projet', montant_contrat: 'montant_contrat',
    montant_cautionnement: 'montant_cautionnement', taux_pct: 'taux_pct',
    prime_estimee: 'prime_estimee',
  },
  activites: {
    description_activite: 'description_activite',
    chiffre_affaires: 'chiffre_affaires', nb_professionnels: 'nb_professionnels',
  },
  mesures: {
    type_mesure: 'type_mesure', maturite: 'statut', statut: 'statut', details: 'details',
  },
};

// Ancres de détection : clés d'import qui identifient le type de liste.
const ANCRES = {
  conducteurs: ['numero_permis', 'classe_permis'],
  vehicules: ['vin', 'niv'],
  batiments: ['valeur_batiment', 'type_construction'],
  exploitations: ['type_activite', 'description_activites', 'masse_salariale'],
  dirigeants: ['fonction'],
  etablissements: ['nom_lieu'],
  obligations: ['montant_cautionnement'],
  activites: ['description_activite'],
  mesures: ['type_mesure'],
};
// Ordre de priorité en cas d'égalité de score (les listes métier d'abord).
const PRIORITE = ['conducteurs', 'vehicules', 'obligations', 'batiments',
  'etablissements', 'exploitations', 'dirigeants', 'activites', 'mesures'];

const CHAMPS_DATE = new Set(['date_naissance', 'date_embauche']);

function sansAccents(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Les dates Excel arrivent parfois en numéro de série (jours depuis 1899).
function dateDepuisValeur(v) {
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (n > 20000 && n < 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }
  return parserDate(v);
}

function convertirValeur(type, champLogique, brut) {
  const meta = META_LISTES[type] && META_LISTES[type].champs[champLogique];
  const s = String(brut ?? '').trim();
  if (!s) return null;
  if (CHAMPS_DATE.has(champLogique)) return dateDepuisValeur(brut);
  if (meta && meta.numerique) {
    const n = parserMontant(s) ?? (Number(s.replace(/[\s$]/g, '').replace(',', '.')) || null);
    return n;
  }
  if (type === 'batiments' && champLogique === 'type_construction') {
    const t = sansAccents(s);
    if (/bois/.test(t)) return 'bois';
    if (/acier/.test(t)) return 'acier';
    if (/beton/.test(t)) return 'beton';
    if (/maconnerie|brique/.test(t)) return 'maconnerie';
    if (/mixte/.test(t)) return 'mixte';
    return s;
  }
  if (type === 'batiments' && champLogique === 'gicleurs') {
    const t = sansAccents(s);
    if (/^(oui|yes|1|vrai|x)$/.test(t)) return 1;
    if (/^(non|no|0|faux)$/.test(t)) return 0;
    return null;
  }
  if (type === 'obligations' && champLogique === 'type') {
    const t = sansAccents(s);
    if (/soumission/.test(t)) return 'soumission';
    if (/execution/.test(t)) return 'execution';
    if (/paiement/.test(t)) return 'paiement_mo';
    if (/rbq|licence/.test(t)) return 'rbq';
    return 'autre';
  }
  if (type === 'mesures' && champLogique === 'statut') {
    const t = sansAccents(s);
    if (/en place|en fonction/.test(t)) return 'en_place';
    if (/partiel/.test(t)) return 'partiel';
    if (/absent|aucune?/.test(t)) return 'absent';
    if (/prevu|planifi/.test(t)) return 'prevu';
    return null;
  }
  if (type === 'vehicules' && champLogique === 'usage') {
    const t = sansAccents(s);
    if (/livraison/.test(t)) return 'livraison';
    if (/service/.test(t)) return 'service';
    if (/transport/.test(t)) return 'transport_marchandises';
    if (/personnel/.test(t)) return 'personnel';
    return s;
  }
  if (type === 'vehicules' && champLogique === 'type_vehicule') {
    const t = sansAccents(s);
    if (/remorque/.test(t)) return 'remorque';
    if (/camion/.test(t)) return 'camion';
    if (/automobile|auto|voiture/.test(t)) return 'automobile';
    if (/equipement/.test(t)) return 'equipement';
    return s;
  }
  return s;
}

// Produit déduit du type de liste (+ indices de colonnes propres à la flotte).
function produitPour(type, cles) {
  if (type === 'conducteurs') {
    return (cles.includes('classe_permis') || cles.includes('date_embauche')
      || cles.includes('annees_experience_lourds')) ? 'flotte' : null;
  }
  if (type === 'vehicules') {
    return (cles.includes('type_vehicule') || cles.includes('lieu_remisage')
      || cles.includes('rayon_operation_km')) ? 'flotte' : null;
  }
  const meta = META_LISTES[type];
  return meta && meta.produits.length === 1 ? meta.produits[0] : null;
}

/**
 * Analyse un tableau { colonnes, lignes } et propose une liste structurée.
 * @returns {{produit, typeListe, listes, confiance, message}}
 */
function analyserTableau(tableau) {
  const colonnes = (tableau && tableau.colonnes) || [];
  const lignes = (tableau && tableau.lignes) || [];
  const cles = colonnes.map(cleImport);

  // Détection du type de liste : ancre présente + plus de colonnes mappées.
  let meilleur = null;
  for (const type of PRIORITE) {
    const correspondance = CORRESPONDANCES[type];
    const mappes = cles.filter((c) => correspondance[c]);
    const aAncre = ANCRES[type].some((a) => cles.includes(a));
    if (!aAncre || mappes.length < 2) continue;
    if (!meilleur || mappes.length > meilleur.mappes.length) {
      meilleur = { type, mappes };
    }
  }
  if (!meilleur) {
    return {
      produit: null, typeListe: null, listes: {}, confiance: 0,
      message: "Tableur reçu, mais ses en-têtes ne correspondent à aucune liste connue (conducteurs, véhicules, bâtiments...). Vérifiez les en-têtes ou saisissez les éléments à la main.",
    };
  }

  const { type } = meilleur;
  const correspondance = CORRESPONDANCES[type];
  const indexChamps = {}; // champ logique -> index de colonne
  cles.forEach((c, i) => {
    const logique = correspondance[c];
    if (logique && indexChamps[logique] === undefined) indexChamps[logique] = i;
  });

  const items = [];
  lignes.forEach((ligne, n) => {
    const champs = {};
    for (const [logique, idx] of Object.entries(indexChamps)) {
      const v = convertirValeur(type, logique, ligne[idx]);
      if (v !== null && v !== undefined && v !== '') champs[logique] = v;
    }
    if (!Object.keys(champs).length) return; // ligne vide ou hors sujet
    const nb = Object.keys(champs).length;
    items.push({
      champs,
      confiance: nb >= 4 ? 'haute' : nb >= 2 ? 'moyenne' : 'basse',
      extrait: `Ligne ${n + 2} du tableur`,
    });
  });

  const produit = produitPour(type, cles);
  const poids = { haute: 0.9, moyenne: 0.6, basse: 0.35 };
  const confiance = items.length
    ? Math.round((items.reduce((s, i) => s + poids[i.confiance], 0) / items.length) * 100) / 100
    : 0;
  return {
    produit,
    typeListe: type,
    listes: items.length ? { [type]: items } : {},
    confiance,
    message: items.length
      ? `Tableur reconnu : ${items.length} élément(s) de type « ${META_LISTES[type].libelle} » détecté(s) depuis les en-têtes.`
      : "Tableur reconnu, mais aucune ligne de données exploitable.",
  };
}

module.exports = { analyserTableau, cleImport };
