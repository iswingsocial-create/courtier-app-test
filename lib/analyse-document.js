/**
 * lib/analyse-document.js — Moteur de correspondance du module « Analyse de
 * documents IA » : à partir du texte extrait d'un document (police
 * d'assureur, proposition remplie, scan OCR), détecte le PRODUIT et propose
 * des CHAMPS avec un niveau de confiance et l'extrait source.
 *
 * Mode local (cette étape) : règles ancrées sur les libellés, appuyées sur le
 * dictionnaire des champs (lib/dictionnaire-champs.json) pour les libellés
 * et la table/colonne de destination. AUCUNE écriture en base métier : le
 * moteur ne fait que PROPOSER ; l'insertion passe par l'écran de révision.
 *
 * Mode Cohere (étape 4) : même contrat de sortie, réponse validée contre le
 * dictionnaire, repli automatique sur le local en cas d'erreur.
 */
const { dictionnaire } = require('./contexte-ia');

const PRODUITS = ['auto', 'biens', 'rc', 'cyber', 'eo', 'do', 'pe', 'flotte', 'cautionnement'];
const TABLES_SOUMISSIONS = {
  auto: 'auto_soumissions', biens: 'biens_soumissions', rc: 'rc_soumissions',
  cyber: 'cyber_soumissions', eo: 'eo_soumissions', do: 'do_soumissions',
  pe: 'pe_soumissions', flotte: 'flotte_soumissions', cautionnement: 'caut_soumissions',
};
const TABLES_GARANTIES = {
  auto: 'auto_garanties', biens: 'biens_garanties', rc: 'rc_garanties',
  cyber: 'cyber_garanties', eo: 'eo_garanties', do: 'do_garanties',
  pe: 'pe_garanties', flotte: 'flotte_garanties', cautionnement: 'caut_garanties',
};

// --- Détection du produit (mots-clés métier pondérés) -------------------------
const MOTS_PRODUITS = [
  ['cautionnement', 3, /\bcautionnement/i], ['cautionnement', 2, /\bcaution\b/i],
  ['cautionnement', 3, /\bRBQ\b/], ['cautionnement', 2, /b[ée]n[ée]ficiaire/i],
  ['cautionnement', 2, /garantie d'ex[ée]cution|cautionnement de soumission/i],
  ['flotte', 3, /\bflotte\b/i], ['flotte', 2, /parc de v[ée]hicules/i],
  ['pe', 3, /perte d['’]exploitation/i], ['pe', 3, /interruption des affaires/i],
  ['pe', 2, /p[ée]riode d['’]indemnit[ée]/i], ['pe', 2, /b[ée]n[ée]fice brut|marge brute/i],
  ['do', 3, /administrateurs? et dirigeants?/i], ['do', 2, /\bD\s*[&\/\-]?\s*O\b/],
  ['eo', 3, /erreurs? et omissions?/i], ['eo', 3, /responsabilit[ée] professionnelle/i],
  ['eo', 1, /\bE\s*[&\/]\s*O\b/],
  ['cyber', 3, /\bcyber/i], ['cyber', 2, /ran[çc]ongiciel/i],
  ['cyber', 2, /atteinte (?:à|a) la vie priv[ée]e|s[ée]curit[ée] des r[ée]seaux/i],
  ['auto', 3, /\bFPQ\s?1\b|F\.P\.Q\.?\s?n°?\s?1/i],
  ['auto', 2, /assurance automobile/i], ['auto', 1, /\bFAQ\s?\d+\b/i],
  ['rc', 3, /responsabilit[ée] civile g[ée]n[ée]rale/i], ['rc', 2, /responsabilit[ée] civile/i],
  ['rc', 1, /\bCGL\b/],
  ['biens', 2, /assurance de biens/i], ['biens', 1, /valeur de reconstruction/i],
  ['biens', 1, /\bb[âa]timent\b/i],
];

function detecterProduit(texte) {
  const scores = {};
  for (const [produit, poids, re] of MOTS_PRODUITS) {
    if (re.test(texte)) scores[produit] = (scores[produit] || 0) + poids;
  }
  const tries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!tries.length || tries[0][1] < 2) return { produit: null, score: 0, scores };
  if (tries.length > 1 && tries[1][1] >= tries[0][1]) return { produit: null, score: tries[0][1], scores, ambigu: tries.map((t) => t[0]) };
  return { produit: tries[0][0], score: tries[0][1], scores };
}

// --- Utilitaires d'extraction ---------------------------------------------------
const MOIS = {
  janvier: '01', fevrier: '02', février: '02', mars: '03', avril: '04', mai: '05', juin: '06',
  juillet: '07', aout: '08', août: '08', septembre: '09', octobre: '10', novembre: '11',
  decembre: '12', décembre: '12',
};

function parserDate(brut) {
  if (!brut) return null;
  const t = String(brut).trim();
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/(\d{1,2})[\/](\d{1,2})[\/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/(\d{1,2})(?:er)?\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})/i);
  if (m) return `${m[3]}-${MOIS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  return null;
}

function parserMontant(brut) {
  if (brut == null) return null;
  const t = String(brut).replace(/[$\s]/g, '').replace(',', '.');
  const million = /(\d+(?:[.,]\d+)?)\s*(?:M|million)/i.exec(String(brut));
  if (million) return Math.round(parseFloat(million[1].replace(',', '.')) * 1000000);
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Cherche « Libellé : valeur » dans le texte (ligne par ligne).
function valeurLibelle(texte, motifs, { max = 120 } = {}) {
  const lignes = String(texte).split(/\r?\n/);
  for (const motif of motifs) {
    const re = new RegExp(`^\\s*(?:[-•*]\\s*)?${motif}\\s*[:\\-]\\s*(.{1,${max}}?)\\s*$`, 'i');
    for (const ligne of lignes) {
      const m = ligne.match(re);
      if (m && m[1].trim()) return { valeur: m[1].trim(), extrait: ligne.trim() };
    }
    // Même ligne, libellé au milieu d'une phrase.
    const re2 = new RegExp(`${motif}\\s*[:\\-]\\s*([^\\n;,]{1,${max}})`, 'i');
    const m2 = String(texte).match(re2);
    if (m2 && m2[1].trim()) return { valeur: m2[1].trim(), extrait: m2[0].trim() };
  }
  return null;
}

function libelleDico(table, colonne, repli) {
  try {
    const t = dictionnaire.tables.find((x) => x.nom === table);
    const c = t && t.colonnes.find((x) => x.nom === colonne);
    return (c && c.libelle) || repli;
  } catch (e) { return repli; }
}

// --- Construction des propositions ----------------------------------------------
function analyserLocal(texteBrut) {
  const texte = String(texteBrut || '');
  const champs = [];
  const { produit, score, ambigu } = detecterProduit(texte);
  const tableSoum = produit ? TABLES_SOUMISSIONS[produit] : 'polices';
  const tableGar = produit ? TABLES_GARANTIES[produit] : 'polices';

  function proposer(champ, table, colonne, libelle, valeur, confiance, extrait) {
    if (valeur === null || valeur === undefined || valeur === '') return;
    champs.push({
      produit: produit || null, champ, table, colonne,
      libelle: libelleDico(table, colonne, libelle),
      valeur, confiance, extrait: extrait || null,
    });
  }

  // Entreprise (assuré / proposant)
  const ent = valeurLibelle(texte, ["nom de l'assur[ée]", 'assur[ée](?:\\s*nomm[ée])?', 'raison sociale', 'entreprise', 'proposant', 'client']);
  if (ent) proposer('client.entreprise', 'clients', 'raison_sociale', "Entreprise (raison sociale)", ent.valeur.replace(/\s+$/, ''), 'haute', ent.extrait);

  const neq = texte.match(/NEQ\s*[:\-]?\s*(\d{10})/i);
  if (neq) proposer('client.neq', 'clients', 'neq', 'NEQ', neq[1], 'haute', neq[0]);

  const adr = valeurLibelle(texte, ['adresse']);
  if (adr) proposer('client.adresse', 'clients', 'adresse', 'Adresse', adr.valeur, 'moyenne', adr.extrait);

  const ville = valeurLibelle(texte, ['ville']);
  if (ville) proposer('client.ville', 'clients', 'ville', 'Ville', ville.valeur.replace(/,.*$/, ''), 'moyenne', ville.extrait);

  const cp = texte.match(/\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/);
  if (cp) proposer('client.code_postal', 'clients', 'code_postal', 'Code postal', `${cp[1]} ${cp[2]}`.toUpperCase(), 'haute', cp[0]);

  const tel = texte.match(/(?:t[ée]l(?:[ée]phone)?\.?\s*[:\-]?\s*)?(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})/);
  if (tel) proposer('client.telephone', 'clients', 'telephone', 'Téléphone', tel[1], 'moyenne', tel[0]);

  const courriel = texte.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (courriel) proposer('client.courriel', 'clients', 'courriel', 'Courriel', courriel[0], 'haute', courriel[0]);

  // En-tête police / soumission
  const assureur = valeurLibelle(texte, ["compagnie d'assurance", 'assureur', 'compagnie']);
  if (assureur) proposer('entete.assureur', tableSoum === 'polices' ? 'polices' : tableSoum, 'assureur', 'Assureur', assureur.valeur, 'haute', assureur.extrait);

  const numRe = texte.match(/(?:n°|num[ée]ro|no\.?)\s*(?:de\s*)?police\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]{3,})/i);
  const numLib = !numRe && valeurLibelle(texte, ['police']);
  if (numRe) proposer('entete.numero_police', 'polices', 'numero_police', 'N° de police', numRe[1].trim(), 'haute', numRe[0]);
  else if (numLib) proposer('entete.numero_police', 'polices', 'numero_police', 'N° de police', numLib.valeur.trim(), 'haute', numLib.extrait);

  const effet = valeurLibelle(texte, ["date d'effet", 'en vigueur (?:le|à compter du)', 'd[ée]but']);
  const dEffet = effet && parserDate(effet.valeur);
  if (dEffet) proposer('entete.date_effet', 'polices', 'date_effet', "Date d'effet", dEffet, 'haute', effet.extrait);
  const ech = valeurLibelle(texte, ["date d'[ée]ch[ée]ance", '[ée]ch[ée]ance', 'expiration']);
  const dEch = ech && parserDate(ech.valeur);
  if (dEch) proposer('entete.date_echeance', 'polices', 'date_echeance', "Date d'échéance", dEch, 'haute', ech.extrait);

  // Garanties communes
  const prime = valeurLibelle(texte, ['prime(?:\\s*totale|\\s*annuelle)?']);
  const primeN = prime && parserMontant(prime.valeur);
  if (primeN) proposer('garanties.prime', tableGar, 'prime', 'Prime', primeN, 'haute', prime.extrait);

  const fr = valeurLibelle(texte, ['franchise']);
  const frN = fr && parserMontant(fr.valeur);
  if (frN !== null && fr) proposer('garanties.franchise', 'polices', 'franchise', 'Franchise', frN, 'haute', fr.extrait);

  const lim = valeurLibelle(texte, ['limite(?:\\s*de garantie)?']);
  const limN = lim && parserMontant(lim.valeur);
  if (limN) proposer('garanties.limite', tableGar, 'limite', 'Limite', limN, 'moyenne', lim.extrait);

  const limPs = valeurLibelle(texte, ['limite par (?:sinistre|occurrence)']);
  const limPsN = limPs && parserMontant(limPs.valeur);
  if (limPsN) proposer('garanties.limite_par_sinistre', tableGar, 'limite_par_sinistre', 'Limite par sinistre', limPsN, 'haute', limPs.extrait);

  const limAg = valeurLibelle(texte, ['limite (?:en )?agr[ée]gat', 'agr[ée]gat']);
  const limAgN = limAg && parserMontant(limAg.valeur);
  if (limAgN) proposer('garanties.limite_agregat', tableGar, 'limite_agregat', 'Limite en agrégat', limAgN, 'haute', limAg.extrait);

  // Spécifiques par produit
  if (produit === 'auto' || produit === 'flotte') {
    const niv = texte.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (niv) proposer('vehicule.niv', produit === 'auto' ? 'auto_vehicules' : 'flotte_vehicules', produit === 'auto' ? 'vin' : 'niv', 'NIV', niv[1], 'haute', niv[0]);
    const veh = valeurLibelle(texte, ['v[ée]hicule', 'marque(?:\\s*\\/\\s*mod[èe]le)?']);
    if (veh) proposer('vehicule.description', produit === 'auto' ? 'auto_vehicules' : 'flotte_vehicules', 'marque', 'Véhicule (marque / modèle)', veh.valeur, 'moyenne', veh.extrait);
    const annee = texte.match(/(?:ann[ée]e|mod[èe]le)\s*[:\-]?\s*(20\d{2}|19\d{2})/i);
    if (annee) proposer('vehicule.annee', produit === 'auto' ? 'auto_vehicules' : 'flotte_vehicules', 'annee', 'Année du véhicule', Number(annee[1]), 'moyenne', annee[0]);
  }
  if (produit === 'flotte') {
    const nb = texte.match(/(\d+)\s*v[ée]hicules/i);
    if (nb) proposer('entete.nb_vehicules', 'flotte_soumissions', 'nb_vehicules', 'Nombre de véhicules', Number(nb[1]), 'moyenne', nb[0]);
    const rayon = texte.match(/rayon(?:\s*d['’]op[ée]ration)?\s*[:\-]?\s*(\d+)\s*km/i);
    if (rayon) proposer('entete.rayon_operation_km', 'flotte_soumissions', 'rayon_operation_km', "Rayon d'opération (km)", Number(rayon[1]), 'haute', rayon[0]);
  }
  if (produit === 'pe') {
    const per = texte.match(/p[ée]riode d['’]indemnit[ée]\s*[:\-]?\s*(12|18|24)\s*mois/i);
    if (per) proposer('garanties.periode_indemnite_mois', 'pe_garanties', 'periode_indemnite_mois', "Période d'indemnité (mois)", Number(per[1]), 'haute', per[0]);
    const base = /marge brute/i.test(texte) ? 'marge_brute' : /b[ée]n[ée]fice brut/i.test(texte) ? 'benefice_brut' : /chiffre d['’]affaires/i.test(texte) ? 'chiffre_affaires' : null;
    if (base) proposer('garanties.base_montant', 'pe_garanties', 'base_montant', "Base d'indemnité", base, 'moyenne', base);
    const frj = texte.match(/franchise\s*[:\-]?\s*(\d+)\s*jours?/i);
    if (frj) proposer('garanties.franchise_jours', 'pe_garanties', 'franchise_jours', 'Franchise (jours)', Number(frj[1]), 'haute', frj[0]);
  }
  if (produit === 'cyber') {
    const carence = valeurLibelle(texte, ['d[ée]lai de carence', 'carence']);
    if (carence) proposer('garanties.delai_carence', 'cyber_garanties', 'delai_carence', 'Délai de carence', carence.valeur, 'moyenne', carence.extrait);
  }
  if (produit === 'eo' || produit === 'do') {
    const base = /r[ée]clamations? pr[ée]sent[ée]es?/i.test(texte) ? 'reclamations_presentees'
      : /occurrences?/i.test(texte) ? 'occurrences' : null;
    if (base) proposer('garanties.base', produit === 'eo' ? 'eo_garanties' : 'do_garanties', 'base', 'Base de couverture', base, 'moyenne', base);
  }
  if (produit === 'cautionnement') {
    const lg = valeurLibelle(texte, ['limite globale', 'ligne globale', 'capacit[ée] globale']);
    const lgN = lg && parserMontant(lg.valeur);
    if (lgN) proposer('garanties.limite_globale', 'caut_garanties', 'limite_globale', 'Limite globale (ligne)', lgN, 'haute', lg.extrait);
    const lp = valeurLibelle(texte, ['limite par projet', 'limite par contrat']);
    const lpN = lp && parserMontant(lp.valeur);
    if (lpN) proposer('garanties.limite_par_projet', 'caut_garanties', 'limite_par_projet', 'Limite par projet', lpN, 'haute', lp.extrait);
    const benef = valeurLibelle(texte, ['b[ée]n[ée]ficiaire', "donneur d['’]ouvrage", 'oblig[ée]']);
    if (benef) proposer('obligation.beneficiaire', 'caut_obligations', 'beneficiaire', 'Bénéficiaire', benef.valeur, 'haute', benef.extrait);
    const contrat = valeurLibelle(texte, ['montant du contrat', 'valeur du contrat']);
    const contratN = contrat && parserMontant(contrat.valeur);
    if (contratN) proposer('obligation.montant_contrat', 'caut_obligations', 'montant_contrat', 'Montant du contrat', contratN, 'haute', contrat.extrait);
    const type = /soumission/i.test(texte) && /cautionnement de soumission/i.test(texte) ? 'soumission'
      : /ex[ée]cution/i.test(texte) ? 'execution'
      : /paiement/i.test(texte) ? 'paiement_mo'
      : /\bRBQ\b/.test(texte) ? 'rbq' : null;
    if (type) proposer('obligation.type', 'caut_obligations', 'type', "Type d'obligation", type, 'moyenne', type);
  }

  // Listes complètes (v2) : véhicules, conducteurs, bâtiments, etc.
  const listes = extraireListes(texte, produit);

  // Confiance globale : moyenne pondérée des champs + bonus produit net.
  const poids = { haute: 0.9, moyenne: 0.6, basse: 0.35 };
  let confianceGlobale = 0;
  if (champs.length) {
    confianceGlobale = champs.reduce((s, c) => s + (poids[c.confiance] || 0.5), 0) / champs.length;
    if (produit) confianceGlobale = Math.min(1, confianceGlobale * 0.7 + Math.min(score, 6) / 6 * 0.3);
  }
  let message = null;
  if (!produit) {
    message = ambigu
      ? `Produit ambigu (signaux contradictoires : ${ambigu.join(', ')}) — choisissez le produit à la révision.`
      : "Produit indéterminé : aucun mot-clé métier net. Choisissez le produit à la révision ; les champs communs détectés restent proposés.";
  }
  if (!champs.length && !Object.values(listes).some((l) => l.length)) {
    message = (message ? message + ' ' : '') + 'Aucun champ reconnu dans le texte extrait.';
  }
  return { produit, confiance: Math.round(confianceGlobale * 100) / 100, champs, listes, message, scores: undefined };
}

// --- Listes complètes (v2) ------------------------------------------------------
// Le moteur v1 ne proposait qu'UN véhicule (premier NIV) et aucun conducteur.
// La v2 extrait les LISTES : tous les véhicules d'une annexe, tous les
// conducteurs, et — par la même mécanique de blocs répétés — bâtiments,
// exploitations, dirigeants, établissements, obligations, activités, mesures.
// Contrat : listes = { <type>: [{ champs: {cle logique: valeur}, confiance,
// extrait }] }. Les clés logiques et destinations vivent dans META_LISTES ;
// l'insertion convertit en clés de données des couches produit (lib/*.js).

const MARQUES_VEHICULES = [
  'Mercedes-Benz', 'Mercedes', 'Freightliner', 'International', 'Kenworth',
  'Peterbilt', 'Mack', 'Volvo', 'Isuzu', 'Hino', 'Ford', 'Ram', 'Dodge',
  'Chevrolet', 'GMC', 'Toyota', 'Honda', 'Nissan', 'Hyundai', 'Kia',
  'Volkswagen', 'BMW', 'Jeep', 'Subaru', 'Mazda', 'Mitsubishi', 'Tesla',
  'Manac', 'Rivian',
];
const RE_NIV = /\b[A-HJ-NPR-Z0-9]{17}\b/;
const RE_PERMIS_QC = /\b[A-Z]\d{3}-\d{6}-\d{2}\b/;

const META_LISTES = {
  vehicules: {
    libelle: 'Véhicules', produits: ['auto', 'flotte'],
    table: (p) => (p === 'flotte' ? 'flotte_vehicules' : 'auto_vehicules'),
    champs: {
      niv: { colonne: (p) => (p === 'auto' ? 'vin' : 'niv'), libelle: 'NIV' },
      annee: { colonne: () => 'annee', libelle: 'Année', numerique: true },
      marque: { colonne: () => 'marque', libelle: 'Marque' },
      modele: { colonne: () => 'modele', libelle: 'Modèle' },
      type_vehicule: { colonne: () => 'type_vehicule', libelle: 'Type de véhicule', produits: ['flotte'] },
      usage: { colonne: () => 'usage', libelle: 'Usage' },
      valeur: { colonne: (p) => (p === 'auto' ? 'valeur_estimee' : 'valeur'), libelle: 'Valeur', numerique: true },
      lieu_remisage: { colonne: () => 'lieu_remisage', libelle: 'Lieu de remisage', produits: ['flotte'] },
      rayon_operation_km: { colonne: () => 'rayon_operation_km', libelle: "Rayon d'opération (km)", numerique: true, produits: ['flotte'] },
      annee_acquisition: { colonne: () => 'annee_acquisition', libelle: "Année d'acquisition", numerique: true, produits: ['flotte'] },
    },
  },
  conducteurs: {
    libelle: 'Conducteurs', produits: ['auto', 'flotte'],
    table: (p) => (p === 'flotte' ? 'flotte_conducteurs' : 'auto_conducteurs'),
    champs: {
      nom: { colonne: () => 'nom', libelle: 'Nom' },
      prenom: { colonne: () => 'prenom', libelle: 'Prénom' },
      date_naissance: { colonne: () => 'date_naissance', libelle: 'Date de naissance' },
      age: { colonne: () => 'age', libelle: 'Âge', numerique: true, produits: ['flotte'] },
      numero_permis: { colonne: () => 'numero_permis', libelle: 'N° de permis' },
      classe_permis: { colonne: () => 'classe_permis', libelle: 'Classe de permis', produits: ['flotte'] },
      annees_experience: { colonne: (p) => (p === 'auto' ? 'annees_experience_ca' : 'annees_experience'), libelle: "Années d'expérience", numerique: true },
      annees_experience_lourds: { colonne: () => 'annees_experience_lourds', libelle: 'Expérience véhicules lourds (ans)', numerique: true, produits: ['flotte'] },
      date_embauche: { colonne: () => 'date_embauche', libelle: "Date d'embauche", produits: ['flotte'] },
    },
  },
  batiments: {
    libelle: 'Bâtiments', produits: ['biens'], table: () => 'biens_batiments',
    champs: {
      adresse: { colonne: () => 'adresse', libelle: 'Adresse' },
      ville: { colonne: () => 'ville', libelle: 'Ville' },
      code_postal: { colonne: () => 'code_postal', libelle: 'Code postal' },
      type_construction: { colonne: () => 'type_construction', libelle: 'Type de construction' },
      annee_construction: { colonne: () => 'annee_construction', libelle: 'Année de construction', numerique: true },
      occupation: { colonne: () => 'occupation', libelle: 'Occupation' },
      valeur_batiment: { colonne: () => 'valeur_batiment', libelle: 'Valeur du bâtiment', numerique: true },
      superficie_pi2: { colonne: () => 'superficie_pi2', libelle: 'Superficie (pi²)', numerique: true },
      nb_etages: { colonne: () => 'nb_etages', libelle: 'Nombre d\u2019étages', numerique: true },
      gicleurs: { colonne: () => 'gicleurs', libelle: 'Gicleurs' },
      distance_caserne_km: { colonne: () => 'distance_caserne_km', libelle: 'Distance de la caserne (km)', numerique: true },
      chauffage: { colonne: () => 'chauffage', libelle: 'Chauffage' },
      annee_toiture: { colonne: () => 'annee_toiture', libelle: 'Année de la toiture', numerique: true },
    },
  },
  exploitations: {
    libelle: "Lieux d'exploitation", produits: ['rc'], table: () => 'rc_exploitations',
    champs: {
      adresse: { colonne: () => 'adresse', libelle: 'Adresse' },
      ville: { colonne: () => 'ville', libelle: 'Ville' },
      code_postal: { colonne: () => 'code_postal', libelle: 'Code postal' },
      type_activite: { colonne: () => 'type_activite', libelle: 'Activité' },
      description_activites: { colonne: () => 'description_activites', libelle: 'Description des activités' },
      chiffre_affaires: { colonne: () => 'chiffre_affaires', libelle: "Chiffre d'affaires", numerique: true },
      nb_employes: { colonne: () => 'nb_employes', libelle: "Nombre d'employés", numerique: true },
    },
  },
  dirigeants: {
    libelle: 'Dirigeants', produits: ['do'], table: () => 'do_dirigeants',
    champs: {
      nom: { colonne: () => 'nom', libelle: 'Nom du dirigeant' },
      fonction: { colonne: () => 'fonction', libelle: 'Fonction / titre' },
      annees_experience: { colonne: () => 'annees_experience', libelle: "Années d'expérience", numerique: true },
      antecedents_personnels: { colonne: () => 'antecedents_personnels', libelle: 'Antécédents personnels' },
    },
  },
  etablissements: {
    libelle: 'Établissements', produits: ['pe'], table: () => 'pe_etablissements',
    champs: {
      nom_lieu: { colonne: () => 'nom_lieu', libelle: 'Nom du lieu' },
      adresse: { colonne: () => 'adresse', libelle: 'Adresse' },
      occupation: { colonne: () => 'occupation', libelle: 'Occupation / activité' },
      chiffre_affaires: { colonne: () => 'chiffre_affaires', libelle: "Chiffre d'affaires", numerique: true },
      superficie: { colonne: () => 'superficie', libelle: 'Superficie', numerique: true },
      annee_construction: { colonne: () => 'annee_construction', libelle: 'Année de construction', numerique: true },
    },
  },
  obligations: {
    libelle: 'Obligations (cautionnements)', produits: ['cautionnement'], table: () => 'caut_obligations',
    champs: {
      type: { colonne: () => 'type', libelle: "Type d'obligation" },
      beneficiaire: { colonne: () => 'beneficiaire', libelle: 'Bénéficiaire' },
      description_projet: { colonne: () => 'description_projet', libelle: 'Description du projet' },
      montant_contrat: { colonne: () => 'montant_contrat', libelle: 'Montant du contrat', numerique: true },
      montant_cautionnement: { colonne: () => 'montant_cautionnement', libelle: 'Montant du cautionnement', numerique: true },
      taux_pct: { colonne: () => 'taux_pct', libelle: 'Taux (%)', numerique: true },
      prime_estimee: { colonne: () => 'prime_estimee', libelle: 'Prime estimée', numerique: true },
    },
  },
  activites: {
    libelle: 'Activités professionnelles', produits: ['eo'], table: () => 'eo_activites',
    champs: {
      description_activite: { colonne: () => 'description_activite', libelle: 'Activité professionnelle' },
      chiffre_affaires: { colonne: () => 'chiffre_affaires', libelle: "Chiffre d'affaires", numerique: true },
      nb_professionnels: { colonne: () => 'nb_professionnels', libelle: 'Nb de professionnels', numerique: true },
    },
  },
  mesures: {
    libelle: 'Mesures de sécurité', produits: ['cyber'], table: () => 'cyber_mesures',
    champs: {
      type_mesure: { colonne: () => 'type_mesure', libelle: 'Type de mesure' },
      statut: { colonne: () => 'statut', libelle: 'Maturité' },
      details: { colonne: () => 'details', libelle: 'Détails de la mesure' },
    },
  },
};

// Découpe un texte en blocs : chaque ligne qui matche `reAncre` ouvre un
// nouveau bloc (la ligne d'ancre est la première du bloc). Les lignes avant
// la première ancre sont ignorées.
function decouperEnBlocs(texte, reAncre) {
  const blocs = [];
  let courant = null;
  for (const ligne of String(texte).split(/\r?\n/)) {
    if (reAncre.test(ligne)) {
      if (courant) blocs.push(courant);
      courant = [ligne];
    } else if (courant) {
      courant.push(ligne);
    }
  }
  if (courant) blocs.push(courant);
  return blocs.map((lignes) => lignes.join('\n'));
}

function confianceItem(nbChamps, aClePrincipale) {
  if (aClePrincipale && nbChamps >= 3) return 'haute';
  if (aClePrincipale && nbChamps >= 2) return 'moyenne';
  return 'basse';
}

function extraireMarqueModele(description) {
  let t = String(description || '').trim().replace(/^(?:v[ée]hicule|unit[ée])\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]\s*/i, '');
  t = t.replace(/^(20\d{2}|19\d{2})\s+/, '');
  if (!t) return {};
  for (const marque of MARQUES_VEHICULES) {
    if (t.toLowerCase().startsWith(marque.toLowerCase())) {
      const modele = t.slice(marque.length).trim().replace(/^[\-–:]\s*/, '');
      return { marque, modele: modele || undefined };
    }
  }
  const mots = t.split(/\s+/);
  return { marque: mots[0], modele: mots.slice(1).join(' ') || undefined };
}

const TYPES_VEHICULE_FLOTTE = [
  [/remorque/i, 'remorque'], [/camion/i, 'camion'],
  [/(?:^|\b)(?:automobile|auto|voiture)\b/i, 'automobile'],
  [/[ée]quipement/i, 'equipement'],
];
const USAGES_FLOTTE = [
  [/livraison/i, 'livraison'], [/service/i, 'service'],
  [/transport/i, 'transport_marchandises'], [/personnel/i, 'personnel'],
];

// Tous les véhicules d'un texte : ancres = lignes « Véhicule n°… » ou lignes
// portant un NIV (une 2e ligne NIV dans le même bloc ouvre un nouveau bloc —
// couvre le style « une ligne par véhicule » des annexes d'assureurs).
function extraireVehicules(texte) {
  const lignes = String(texte).split(/\r?\n/);
  const blocs = [];
  let courant = null;
  const fermer = () => { if (courant) { blocs.push(courant); courant = null; } };
  for (const ligne of lignes) {
    const estEntete = /^\s*(?:[-•*]\s*)?v[ée]hicule\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i.test(ligne);
    const aNiv = RE_NIV.test(ligne);
    if (estEntete) { fermer(); courant = { lignes: [ligne], aNiv: false }; }
    else if (aNiv && courant && courant.aNiv) { fermer(); courant = { lignes: [ligne], aNiv: true }; }
    else if (courant) { courant.lignes.push(ligne); if (aNiv) courant.aNiv = true; }
    else if (aNiv) { courant = { lignes: [ligne], aNiv: true }; }
  }
  fermer();
  const vus = new Set();
  const items = [];
  for (const bloc of blocs) {
    const bt = bloc.lignes.join('\n');
    const nivM = bt.match(RE_NIV);
    const entete = bloc.lignes.find((l) => /v[ée]hicule\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i.test(l));
    if (!nivM && !entete) continue;
    const champs = {};
    if (nivM) {
      if (vus.has(nivM[0])) continue;
      vus.add(nivM[0]);
      champs.niv = nivM[0];
    }
    const descEntete = entete && entete.match(/v[ée]hicule\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]\s*(.+)$/i);
    const desc = valeurLibelle(bt, ['v[ée]hicule(?:\\s*\\/\\s*description)?', 'description du v[ée]hicule', 'marque(?:\\s*\\/\\s*mod[èe]le)?']);
    if (descEntete && descEntete[1].trim()) Object.assign(champs, extraireMarqueModele(descEntete[1]));
    else if (desc) Object.assign(champs, extraireMarqueModele(desc.valeur));
    const marqueL = valeurLibelle(bt, ['marque']);
    if (marqueL && !champs.marque) champs.marque = marqueL.valeur;
    const modeleL = valeurLibelle(bt, ['mod[èe]le']);
    if (modeleL && !champs.modele) champs.modele = modeleL.valeur.replace(/^(20\d{2}|19\d{2})\s+/, '');
    const anneeL = bt.match(/ann[ée]e\s*[:\-]?\s*(20\d{2}|19\d{2})/i);
    const anneeDesc = (desc && desc.valeur.match(/\b(20\d{2}|19\d{2})\b/)) || bt.match(/\b(20\d{2}|19\d{2})\b/);
    if (anneeL) champs.annee = Number(anneeL[1]);
    else if (anneeDesc) champs.annee = Number(anneeDesc[1]);
    const valeurL = valeurLibelle(bt, ['valeur(?:\\s*du v[ée]hicule|\\s*estim[ée]e|\\s*à neuf)?', "prix d'achat"]);
    let valN = valeurL && parserMontant(valeurL.valeur);
    if (!valN) {
      const montants = [...bt.matchAll(/(\d[\d\s]*(?:[.,]\d+)?)\s*\$/g)].map((m) => parserMontant(m[1])).filter(Boolean);
      if (montants.length) valN = Math.max(...montants);
    }
    if (valN) champs.valeur = valN;
    for (const [re, code] of USAGES_FLOTTE) if (re.test(bt)) { champs.usage = code; break; }
    for (const [re, code] of TYPES_VEHICULE_FLOTTE) if (re.test(bt)) { champs.type_vehicule = code; break; }
    const remisage = valeurLibelle(bt, ['lieu de remisage', 'remisage']);
    if (remisage) champs.lieu_remisage = remisage.valeur;
    const rayonB = bt.match(/rayon(?:\s*d['’]op[ée]ration)?\s*[:\-]?\s*(\d+)\s*km/i);
    if (rayonB) champs.rayon_operation_km = Number(rayonB[1]);
    const acq = bt.match(/(?:acquis|achet[ée]|acquisition)\s*(?:en|le)?\s*[:\-]?\s*(20\d{2}|19\d{2})/i);
    if (acq) champs.annee_acquisition = Number(acq[1]);
    items.push({
      champs,
      confiance: confianceItem(Object.keys(champs).length, !!champs.niv),
      extrait: bloc.lignes.find((l) => l.trim())?.trim().slice(0, 140) || null,
    });
  }
  return items;
}

// Tous les conducteurs d'un texte : blocs « Conducteur n°… » ou blocs portant
// un n° de permis (format SAAQ A123-456789-01 ou libellé « Permis : »).
function extraireConducteurs(texte) {
  const lignes = String(texte).split(/\r?\n/);
  const blocs = [];
  let courant = null;
  const fermer = () => { if (courant) { blocs.push(courant); courant = null; } };
  for (const ligne of lignes) {
    const estEntete = /^\s*(?:[-•*]\s*)?conducteur\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i.test(ligne);
    const aPermis = RE_PERMIS_QC.test(ligne) || /(?:n°|num[ée]ro|no\.?)\s*(?:de\s*)?permis\s*[:\-]/i.test(ligne);
    if (estEntete) { fermer(); courant = { lignes: [ligne], aPermis: false }; }
    else if (aPermis && courant && courant.aPermis) { fermer(); courant = { lignes: [ligne], aPermis: true }; }
    else if (courant) { courant.lignes.push(ligne); if (aPermis) courant.aPermis = true; }
    else if (aPermis) { courant = { lignes: [ligne], aPermis: true }; }
  }
  fermer();
  const items = [];
  for (const bloc of blocs) {
    const bt = bloc.lignes.join('\n');
    const entete = bloc.lignes.find((l) => /conducteur\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i.test(l));
    const permisM = bt.match(RE_PERMIS_QC);
    const permisL = valeurLibelle(bt, ['(?:n°|num[ée]ro|no\\.?)\\s*(?:de\\s*)?permis', 'permis']);
    if (!entete && !permisM && !permisL) continue;
    const champs = {};
    if (permisM) champs.numero_permis = permisM[0];
    else if (permisL) champs.numero_permis = permisL.valeur.split(/\s+/)[0];
    const nomL = valeurLibelle(bt, ['nom(?:\\s*complet)?']);
    const prenomL = valeurLibelle(bt, ['pr[ée]nom']);
    let nomComplet = null;
    if (entete) {
      const m = entete.match(/conducteur\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]\s*(.+)$/i);
      if (m && m[1].trim() && !/^\d+$/.test(m[1].trim())) nomComplet = m[1].trim();
    }
    if (nomL) {
      if (nomL.valeur.includes(',')) {
        const [n, p] = nomL.valeur.split(',').map((s) => s.trim());
        champs.nom = n; if (p && !prenomL) champs.prenom = p;
      } else if (prenomL) {
        champs.nom = nomL.valeur;
      } else {
        nomComplet = nomL.valeur;
      }
    }
    if (prenomL) champs.prenom = prenomL.valeur;
    if (nomComplet && !champs.nom) {
      const mots = nomComplet.split(/\s+/);
      champs.prenom = mots[0];
      if (mots.length > 1) champs.nom = mots.slice(1).join(' ');
    }
    const naissL = valeurLibelle(bt, ['date de naissance', 'n[ée](?:e)? le', 'naissance']);
    const dNaiss = (naissL && parserDate(naissL.valeur))
      || (() => { const m = bt.match(/naissance[^0-9]{0,12}(\d{4}-\d{2}-\d{2}|\d{1,2}[\/]\d{1,2}[\/]\d{4})/i); return m ? parserDate(m[1]) : null; })();
    if (dNaiss) champs.date_naissance = dNaiss;
    const classeM = bt.match(/classe\s*(?:de permis)?\s*[:\-]?\s*([0-9][A-Z]?)\b/i);
    if (classeM) champs.classe_permis = classeM[1];
    const embL = valeurLibelle(bt, ["date d'embauche", 'embauch[ée](?:e)? le', 'en poste depuis']);
    const dEmb = embL && parserDate(embL.valeur);
    if (dEmb) champs.date_embauche = dEmb;
    const expM = bt.match(/(\d+)\s*ans?\s*d['’]exp[ée]rience/i) || bt.match(/exp[ée]rience\s*[:\-]?\s*(\d+)\s*ans?/i);
    if (expM) champs.annees_experience = Number(expM[1]);
    const expLL = valeurLibelle(bt, ["ann[ée]es d'exp[ée]rience", 'exp[ée]rience']);
    if (!champs.annees_experience && expLL) {
      const n = expLL.valeur.match(/\d+/);
      if (n) champs.annees_experience = Number(n[0]);
    }
    const lourdsM = bt.match(/(\d+)\s*ans?\s*(?:d['’]exp[ée]rience\s*)?(?:v[ée]hicules?\s*)?lourds?/i);
    if (lourdsM) champs.annees_experience_lourds = Number(lourdsM[1]);
    items.push({
      champs,
      confiance: confianceItem(Object.keys(champs).length, !!(champs.numero_permis || champs.nom)),
      extrait: bloc.lignes.find((l) => l.trim())?.trim().slice(0, 140) || null,
    });
  }
  return items;
}

// Mécanique générique pour les autres listes : blocs répétés repérés par un
// libellé d'en-tête, champs lus par libellés dans chaque bloc.
function extraireBlocsGeneriques(texte, reEntete, extracteurs) {
  const items = [];
  for (const bt of decouperEnBlocs(texte, reEntete)) {
    const champs = {};
    for (const [cle, fn] of Object.entries(extracteurs)) {
      const v = fn(bt);
      if (v !== null && v !== undefined && v !== '') champs[cle] = v;
    }
    if (Object.keys(champs).length) {
      items.push({
        champs,
        confiance: confianceItem(Object.keys(champs).length, Object.keys(champs).length >= 2),
        extrait: bt.split('\n').find((l) => l.trim())?.trim().slice(0, 140) || null,
      });
    }
  }
  return items;
}
const montantBloc = (bt, motifs) => {
  const l = valeurLibelle(bt, motifs);
  return l ? parserMontant(l.valeur) : null;
};
const texteBloc = (bt, motifs) => {
  const l = valeurLibelle(bt, motifs);
  return l ? l.valeur : null;
};

function extraireListes(texte, produit) {
  const listes = {};
  if (!produit) return listes;
  if (produit === 'auto' || produit === 'flotte') {
    const vehicules = extraireVehicules(texte);
    if (vehicules.length) listes.vehicules = vehicules;
    const conducteurs = extraireConducteurs(texte);
    if (conducteurs.length) listes.conducteurs = conducteurs;
  }
  if (produit === 'biens') {
    const batiments = extraireBlocsGeneriques(texte,
      /^\s*(?:[-•*]\s*)?b[âa]timent\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i, {
        adresse: (bt) => texteBloc(bt, ['adresse']),
        ville: (bt) => texteBloc(bt, ['ville']),
        annee_construction: (bt) => { const m = bt.match(/ann[ée]e de construction\s*[:\-]?\s*(20\d{2}|19\d{2})/i); return m ? Number(m[1]) : null; },
        occupation: (bt) => texteBloc(bt, ['occupation']),
        valeur_batiment: (bt) => montantBloc(bt, ['valeur(?:\\s*du b[âa]timent|\\s*de reconstruction)?', 'montant']),
      });
    if (batiments.length) listes.batiments = batiments;
  }
  if (produit === 'rc') {
    const exploitations = extraireBlocsGeneriques(texte,
      /^\s*(?:[-•*]\s*)?(?:lieu|exploitation)\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i, {
        adresse: (bt) => texteBloc(bt, ['adresse']),
        ville: (bt) => texteBloc(bt, ['ville']),
        type_activite: (bt) => texteBloc(bt, ['activit[ée]']),
        chiffre_affaires: (bt) => montantBloc(bt, ["chiffre d['’]affaires"]),
        nb_employes: (bt) => { const l = valeurLibelle(bt, ["nombre d'employ[ée]s", "nb d'employ[ée]s"]); const n = l && l.valeur.match(/\d+/); return n ? Number(n[0]) : null; },
      });
    if (exploitations.length) listes.exploitations = exploitations;
  }
  if (produit === 'do') {
    const dirigeants = extraireBlocsGeneriques(texte,
      /^\s*(?:[-•*]\s*)?dirigeant\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i, {
        nom: (bt) => {
          const entete = bt.split('\n')[0].match(/dirigeant\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]\s*(.+)$/i);
          if (entete && entete[1].trim()) return entete[1].trim();
          return texteBloc(bt, ['nom(?:\\s*du dirigeant|\\s*complet)?']);
        },
        fonction: (bt) => texteBloc(bt, ['fonction(?:\\s*\\/\\s*titre)?', 'titre']),
        annees_experience: (bt) => {
          const m = bt.match(/(\d+)\s*ans?\s*d['’]exp[ée]rience/i) || bt.match(/exp[ée]rience\s*[:\-]?\s*(\d+)/i);
          return m ? Number(m[1]) : null;
        },
      });
    if (dirigeants.length) listes.dirigeants = dirigeants;
  }
  if (produit === 'pe') {
    const etablissements = extraireBlocsGeneriques(texte,
      /^\s*(?:[-•*]\s*)?(?:[ée]tablissement|lieu)\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i, {
        nom_lieu: (bt) => {
          const entete = bt.split('\n')[0].match(/(?:[ée]tablissement|lieu)\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]\s*(.+)$/i);
          if (entete && entete[1].trim()) return entete[1].trim();
          return texteBloc(bt, ['nom du lieu', 'nom']);
        },
        adresse: (bt) => texteBloc(bt, ['adresse']),
        occupation: (bt) => texteBloc(bt, ['occupation', 'activit[ée] à ce lieu']),
        chiffre_affaires: (bt) => montantBloc(bt, ["chiffre d['’]affaires"]),
      });
    if (etablissements.length) listes.etablissements = etablissements;
  }
  if (produit === 'cautionnement') {
    const obligations = extraireBlocsGeneriques(texte,
      /^\s*(?:[-•*]\s*)?(?:cautionnement|obligation)\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i, {
        type: (bt) => /de soumission/i.test(bt) ? 'soumission'
          : /d['’]ex[ée]cution/i.test(bt) ? 'execution'
          : /paiement/i.test(bt) ? 'paiement_mo'
          : /\bRBQ\b/.test(bt) ? 'rbq' : null,
        beneficiaire: (bt) => texteBloc(bt, ['b[ée]n[ée]ficiaire', "donneur d['’]ouvrage"]),
        description_projet: (bt) => texteBloc(bt, ['description du projet', 'projet', 'travaux']),
        montant_contrat: (bt) => montantBloc(bt, ['montant du contrat', 'valeur du contrat']),
        montant_cautionnement: (bt) => montantBloc(bt, ['montant du cautionnement']),
        prime_estimee: (bt) => montantBloc(bt, ['prime(?:\\s*estim[ée]e)?']),
      });
    if (obligations.length) listes.obligations = obligations;
  }
  if (produit === 'eo') {
    const activites = extraireBlocsGeneriques(texte,
      /^\s*(?:[-•*]\s*)?activit[ée]\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i, {
        description_activite: (bt) => {
          const entete = bt.split('\n')[0].match(/activit[ée]\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]\s*(.+)$/i);
          if (entete && entete[1].trim()) return entete[1].trim();
          return texteBloc(bt, ['description', 'activit[ée] professionnelle']);
        },
        chiffre_affaires: (bt) => montantBloc(bt, ["chiffre d['’]affaires"]),
        nb_professionnels: (bt) => { const l = valeurLibelle(bt, ['nb de professionnels', 'nombre de professionnels']); const n = l && l.valeur.match(/\d+/); return n ? Number(n[0]) : null; },
      });
    if (activites.length) listes.activites = activites;
  }
  if (produit === 'cyber') {
    const TYPES_MESURE_TXT = [
      [/multifacteur|\bMFA\b|authentification (?:multi|à deux)/i, 'mfa'],
      [/sauvegarde/i, 'sauvegardes'],
      [/antivirus|\bEDR\b/i, 'antivirus_edr'],
      [/pare-feu/i, 'pare_feu'],
      [/hame[çc]onnage/i, 'formation_hameconnage'],
      [/plan de r[ée]ponse|incident/i, 'plan_reponse_incident'],
      [/chiffrement/i, 'chiffrement'],
      [/correctifs?|patch/i, 'gestion_correctifs'],
      [/contr[ôo]le d['’]acc[èe]s/i, 'controle_acces'],
    ];
    const mesures = extraireBlocsGeneriques(texte,
      /^\s*(?:[-•*]\s*)?mesure\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i, {
        type_mesure: (bt) => { for (const [re, code] of TYPES_MESURE_TXT) if (re.test(bt)) return code; return 'autre'; },
        statut: (bt) => /en place/i.test(bt) ? 'en_place' : /partiel/i.test(bt) ? 'partiel' : /absent/i.test(bt) ? 'absent' : /pr[ée]vu/i.test(bt) ? 'prevu' : null,
        details: (bt) => texteBloc(bt, ['d[ée]tails']),
      });
    if (mesures.length) listes.mesures = mesures;
  }
  return listes;
}

// --- Mode Cohere (étape 4) ------------------------------------------------------
// Métadonnées des champs logiques : destination (table/colonne) selon le
// produit — la réponse Cohere est VALIDÉE contre cette liste (qui reflète le
// dictionnaire) ; tout champ inconnu est rejeté.
const META_CHAMPS = {
  'client.entreprise': { table: () => 'clients', colonne: 'raison_sociale', libelle: 'Entreprise (raison sociale)' },
  'client.neq': { table: () => 'clients', colonne: 'neq', libelle: 'NEQ' },
  'client.adresse': { table: () => 'clients', colonne: 'adresse', libelle: 'Adresse' },
  'client.ville': { table: () => 'clients', colonne: 'ville', libelle: 'Ville' },
  'client.code_postal': { table: () => 'clients', colonne: 'code_postal', libelle: 'Code postal' },
  'client.telephone': { table: () => 'clients', colonne: 'telephone', libelle: 'Téléphone' },
  'client.courriel': { table: () => 'clients', colonne: 'courriel', libelle: 'Courriel' },
  'entete.assureur': { table: (p) => TABLES_SOUMISSIONS[p] || 'polices', colonne: 'assureur', libelle: 'Assureur' },
  'entete.numero_police': { table: () => 'polices', colonne: 'numero_police', libelle: 'N° de police' },
  'entete.date_effet': { table: () => 'polices', colonne: 'date_effet', libelle: "Date d'effet" },
  'entete.date_echeance': { table: () => 'polices', colonne: 'date_echeance', libelle: "Date d'échéance" },
  'garanties.prime': { table: (p) => TABLES_GARANTIES[p] || 'polices', colonne: 'prime', libelle: 'Prime' },
  'garanties.franchise': { table: () => 'polices', colonne: 'franchise', libelle: 'Franchise' },
  'garanties.limite': { table: (p) => TABLES_GARANTIES[p] || 'polices', colonne: 'limite', libelle: 'Limite' },
  'garanties.limite_par_sinistre': { table: (p) => TABLES_GARANTIES[p] || 'polices', colonne: 'limite_par_sinistre', libelle: 'Limite par sinistre' },
  'garanties.limite_agregat': { table: (p) => TABLES_GARANTIES[p] || 'polices', colonne: 'limite_agregat', libelle: 'Limite en agrégat' },
  'garanties.delai_carence': { table: () => 'cyber_garanties', colonne: 'delai_carence', libelle: 'Délai de carence' },
  'garanties.base': { table: (p) => TABLES_GARANTIES[p] || 'polices', colonne: 'base', libelle: 'Base de couverture' },
  'garanties.periode_indemnite_mois': { table: () => 'pe_garanties', colonne: 'periode_indemnite_mois', libelle: "Période d'indemnité (mois)" },
  'garanties.base_montant': { table: () => 'pe_garanties', colonne: 'base_montant', libelle: "Base d'indemnité" },
  'garanties.franchise_jours': { table: () => 'pe_garanties', colonne: 'franchise_jours', libelle: 'Franchise (jours)' },
  'garanties.limite_globale': { table: () => 'caut_garanties', colonne: 'limite_globale', libelle: 'Limite globale (ligne)' },
  'garanties.limite_par_projet': { table: () => 'caut_garanties', colonne: 'limite_par_projet', libelle: 'Limite par projet' },
  'vehicule.niv': { table: (p) => (p === 'flotte' ? 'flotte_vehicules' : 'auto_vehicules'), colonne: 'niv', libelle: 'NIV' },
  'vehicule.description': { table: (p) => (p === 'flotte' ? 'flotte_vehicules' : 'auto_vehicules'), colonne: 'marque', libelle: 'Véhicule (marque / modèle)' },
  'vehicule.annee': { table: (p) => (p === 'flotte' ? 'flotte_vehicules' : 'auto_vehicules'), colonne: 'annee', libelle: 'Année du véhicule' },
  'entete.nb_vehicules': { table: () => 'flotte_soumissions', colonne: 'nb_vehicules', libelle: 'Nombre de véhicules' },
  'entete.rayon_operation_km': { table: () => 'flotte_soumissions', colonne: 'rayon_operation_km', libelle: "Rayon d'opération (km)" },
  'obligation.beneficiaire': { table: () => 'caut_obligations', colonne: 'beneficiaire', libelle: 'Bénéficiaire' },
  'obligation.montant_contrat': { table: () => 'caut_obligations', colonne: 'montant_contrat', libelle: 'Montant du contrat' },
  'obligation.type': { table: () => 'caut_obligations', colonne: 'type', libelle: "Type d'obligation" },
};

async function analyserCohere(texte, cabinetId) {
  const reglagesIA = require('./reglages-ia');
  const local = analyserLocal(texte);
  const champsAutorises = Object.entries(META_CHAMPS)
    .map(([cle, m]) => `- ${cle} : ${m.libelle}`).join('\n');
  const listesAutorisees = Object.entries(META_LISTES)
    .map(([cle, m]) => `- ${cle} (${m.libelle}, produits : ${m.produits.join('/')}) : champs par élément : ${Object.entries(m.champs).map(([c, cm]) => `${c} (${cm.libelle})`).join(', ')}`).join('\n');
  const prompt =
`Tu es l'assistant d'un cabinet de courtage en assurance de dommages au Québec. ` +
`Analyse le texte suivant, extrait d'un document d'assurance (police ou proposition), et ` +
`réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte autour :\n` +
`{"produit": "auto|biens|rc|cyber|eo|do|pe|flotte|cautionnement ou null", "champs": [{"champ": "clé", "valeur": ..., "confiance": "haute|moyenne|basse"}], "listes": {"<type de liste>": [{"champs": {"<champ>": valeur}, "confiance": "haute|moyenne|basse"}]}}\n` +
`Produits : auto = FPQ1 automobile du Québec ; biens ; rc = responsabilité civile ; cyber ; eo = erreurs et omissions ; ` +
`do = administrateurs et dirigeants ; pe = perte d'exploitation ; flotte = flotte automobile ; cautionnement.\n` +
`Champs autorisés (utilise EXACTEMENT ces clés, aucun autre champ) :\n${champsAutorises}\n` +
`Listes autorisées (extrais TOUS les éléments répétés du document — annexe de véhicules au complet, tous les conducteurs, etc.) :\n${listesAutorisees}\n` +
`Règles : montants en nombres sans $ ni espaces ; dates au format AAAA-MM-JJ ; ne devine jamais — ` +
`un champ absent du texte ne doit pas apparaître. Le moteur local a détecté : produit « ${local.produit || 'indéterminé'} ».\n\n` +
`TEXTE DU DOCUMENT :\n${String(texte).slice(0, 12000)}`;
  const reponse = await reglagesIA.appelerCohereCabinet(cabinetId, prompt);
  const json = JSON.parse(String(reponse).replace(/```json|```/g, '').trim());
  const produit = PRODUITS.includes(json.produit) ? json.produit : local.produit;
  const lignes = String(texte).split(/\r?\n/);
  const champs = [];
  for (const c of Array.isArray(json.champs) ? json.champs : []) {
    const meta = META_CHAMPS[c.champ];
    if (!meta || c.valeur === null || c.valeur === undefined || c.valeur === '') continue;
    const table = meta.table(produit);
    const colonne = c.champ === 'vehicule.niv' && produit === 'auto' ? 'vin' : meta.colonne;
    const extrait = lignes.find((l) => l.includes(String(c.valeur).slice(0, 10))) || null;
    champs.push({
      produit: produit || null, champ: c.champ, table, colonne,
      libelle: libelleDico(table, colonne, meta.libelle),
      valeur: c.valeur,
      confiance: ['haute', 'moyenne', 'basse'].includes(c.confiance) ? c.confiance : 'moyenne',
      extrait: extrait ? extrait.trim() : null,
    });
  }
  if (!champs.length) throw new Error('Réponse Cohere sans champ valide');
  const listes = validerListesCohere(json.listes, produit, lignes);
  const poids = { haute: 0.9, moyenne: 0.6, basse: 0.35 };
  const confiance = champs.reduce((s, c) => s + poids[c.confiance], 0) / champs.length;
  return {
    produit, confiance: Math.round(confiance * 100) / 100, champs, listes,
    message: produit ? null : "Produit indéterminé selon Cohere — choisissez le produit à la révision.",
  };
}

// Valide les listes d'une réponse Cohere contre META_LISTES (types et champs
// inconnus rejetés, produits incompatibles rejetés, valeurs numériques
// coercées) — même contrat de sortie que le moteur local.
function validerListesCohere(listesBrutes, produit, lignes) {
  const listes = {};
  if (!listesBrutes || typeof listesBrutes !== 'object') return listes;
  for (const [type, items] of Object.entries(listesBrutes)) {
    const meta = META_LISTES[type];
    if (!meta || !Array.isArray(items)) continue;
    if (produit && !meta.produits.includes(produit)) continue;
    const propres = [];
    for (const item of items) {
      const src = (item && typeof item === 'object' && item.champs && typeof item.champs === 'object') ? item.champs : item;
      if (!src || typeof src !== 'object') continue;
      const champs = {};
      for (const [cle, valeur] of Object.entries(src)) {
        const cm = meta.champs[cle];
        if (!cm || valeur === null || valeur === undefined || valeur === '') continue;
        if (cm.produits && produit && !cm.produits.includes(produit)) continue;
        champs[cle] = cm.numerique ? (Number(String(valeur).replace(/[\s$]/g, '').replace(',', '.')) || valeur) : valeur;
      }
      if (!Object.keys(champs).length) continue;
      const premier = Object.values(champs)[0];
      const extrait = lignes.find((l) => l.includes(String(premier).slice(0, 10))) || null;
      propres.push({
        champs,
        confiance: ['haute', 'moyenne', 'basse'].includes(item && item.confiance) ? item.confiance : 'moyenne',
        extrait: extrait ? extrait.trim().slice(0, 140) : null,
      });
    }
    if (propres.length) listes[type] = propres;
  }
  return listes;
}

// Point d'entrée : Cohere si le moteur effectif du cabinet le dit (avec
// repli automatique sur le local en cas d'erreur), sinon le moteur local.
// Si un TABLEAU structuré accompagne le texte (tableur .xlsx/.csv — v2),
// le moteur tabulaire prend le relais : il produit directement les listes.
async function analyser(texte, { cabinetId, tableau } = {}) {
  if (tableau && Array.isArray(tableau.lignes) && tableau.lignes.length) {
    const { analyserTableau } = require('./analyse-tableur');
    const r = analyserTableau(tableau);
    // Compléter avec les champs scalaires lus dans le texte aplati du tableur
    // (entreprise, assureur...) sans écraser les listes tabulaires.
    const plat = analyserLocal(texte);
    return {
      produit: r.produit || plat.produit,
      confiance: r.confiance,
      champs: plat.champs,
      listes: r.listes,
      moteur: 'local',
      message: [r.message, !r.produit && plat.message].filter(Boolean).join(' ') || null,
    };
  }
  if (cabinetId) {
    const reglagesIA = require('./reglages-ia');
    const eff = reglagesIA.moteurEffectif(cabinetId);
    if (eff.mode === 'cohere') {
      try {
        const r = await analyserCohere(texte, cabinetId);
        return { ...r, moteur: 'cohere' };
      } catch (e) {
        const r = analyserLocal(texte);
        return {
          ...r, moteur: 'local',
          message: [r.message, `Repli sur le moteur local : Cohere indisponible (${e.message}).`]
            .filter(Boolean).join(' '),
        };
      }
    }
  }
  const r = analyserLocal(texte);
  return { ...r, moteur: 'local' };
}

module.exports = { analyserLocal, analyser, analyserCohere, detecterProduit, parserDate, parserMontant, extraireListes, validerListesCohere, PRODUITS, TABLES_SOUMISSIONS, META_CHAMPS, META_LISTES };
