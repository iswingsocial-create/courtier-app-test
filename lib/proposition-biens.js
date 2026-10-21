/**
 * lib/proposition-biens.js — Préparation des données de la proposition
 * d'assurance des biens commerciaux pré-remplie (biens — étape 7/10).
 * Source unique pour la page HTML imprimable (views/biens/proposition.ejs)
 * et le PDF téléchargeable (lib/proposition-biens-pdf.js) : même contenu,
 * mêmes libellés.
 *
 * La proposition reflète soit l'état courant de la soumission, soit une
 * version figée (?v=N) via biens.obtenirVersion (règle d'or : traçabilité).
 * Miroir de lib/proposition.js (auto FPQ1).
 */
const bd = require('./bd');
const biens = require('./biens');

// Libellés — identiques à routes/biens.js.
const NOMS_TYPE_CONSTRUCTION = {
  bois: 'Bois', acier: 'Acier', beton: 'Béton', maconnerie: 'Maçonnerie', mixte: 'Mixte',
};
const NOMS_TYPE_CONTENU = {
  mobilier: 'Mobilier', equipements: 'Équipements', stock: 'Stock',
  ameliorations: 'Améliorations locatives', autre: 'Autre',
};
const NOMS_FORMULE = {
  tous_risques: 'Tous risques',
  risques_designes: 'Risques désignés',
};
const AVENANTS_BIENS = [
  ['tremblement_terre', 'Tremblement de terre'],
  ['inondation', 'Inondation'],
  ['refoulement_egout', 'Refoulement d’égout'],
  ['bris_machines', 'Bris de machines'],
  ['perte_exploitation_liee', 'Perte d’exploitation liée'],
];
const NOMS_CONSENTEMENTS = {
  credit: 'Dossier de crédit',
  dossier_assurance: 'Dossier d’assurance (sinistres antérieurs)',
};

function fmtMontant(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-CA') + ' $';
}

// Enrichit les garanties d'un bâtiment avec les libellés français.
function enrichirGaranties(g) {
  if (!g) return null;
  const r = { ...g };
  r.formule_libelle = NOMS_FORMULE[g.formule] || (g.formule || '—');
  r.franchise_libelle = fmtMontant(g.franchise);
  r.montant_assurance_libelle = fmtMontant(g.montant_assurance);
  r.prime_libelle = fmtMontant(g.prime);
  const av = g.avenants || {};
  r.avenants_libelles = AVENANTS_BIENS
    .filter(([code]) => av[code])
    .map(([, lib]) => lib);
  return r;
}

function enrichirBatiment(b) {
  return {
    ...b,
    type_construction_libelle: NOMS_TYPE_CONSTRUCTION[b.type_construction] || b.type_construction || '—',
    gicleurs_libelle: b.gicleurs ? 'Oui' : 'Non',
    valeur_batiment_libelle: fmtMontant(b.valeur_batiment),
    garanties: enrichirGaranties(b.garanties),
    contenus: (b.contenus || []).map((c) => ({
      ...c,
      type_contenu_libelle: NOMS_TYPE_CONTENU[c.type_contenu] || c.type_contenu || '—',
      valeur_libelle: fmtMontant(c.valeur),
    })),
  };
}

/**
 * Prépare les données de la proposition.
 * @param {number} cabinetId
 * @param {object} soumission — objet complet de biens.obtenirSoumission (contrôle d'accès déjà fait par la route)
 * @param {number|null} versionDemandee — version figée (?v=) ou null pour l'état courant
 * @returns {object|null} données normalisées, ou { erreur: 'version' } si la version n'existe pas
 */
function preparerPropositionBiens(cabinetId, soumission, versionDemandee) {
  let batiments;
  let contenusGeneraux;
  let antecedents;
  let versionNumero;
  let versionFigee;
  let auteurVersion = null;
  let statut;
  let notes;
  let dateEffet;

  if (versionDemandee) {
    const v = biens.obtenirVersion(soumission.id, versionDemandee, cabinetId);
    if (!v || !v.donnees) return { erreur: 'version' };
    batiments = v.donnees.batiments || [];
    contenusGeneraux = v.donnees.contenus_generaux || [];
    antecedents = v.donnees.antecedents || null;
    versionNumero = v.version;
    versionFigee = true;
    auteurVersion = v.auteur || null;
    statut = v.statut;
    notes = v.notes;
    dateEffet = v.date_effet_souhaitee;
  } else {
    batiments = soumission.batiments || [];
    contenusGeneraux = soumission.contenus_generaux || [];
    antecedents = soumission.antecedents || null;
    const versions = biens.versionsSoumission(soumission.id, cabinetId);
    versionNumero = versions.length ? versions[0].version : 1;
    versionFigee = false;
    statut = soumission.statut;
    notes = soumission.notes;
    dateEffet = soumission.date_effet_souhaitee;
  }

  batiments = batiments.map(enrichirBatiment);
  contenusGeneraux = contenusGeneraux.map((c) => ({
    ...c,
    type_contenu_libelle: NOMS_TYPE_CONTENU[c.type_contenu] || c.type_contenu || '—',
    valeur_libelle: fmtMontant(c.valeur),
  }));

  const client = soumission.client_id
    ? bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(soumission.client_id, cabinetId)
    : null;
  const cabinet = bd.prepare('SELECT nom FROM cabinets WHERE id = ?').get(cabinetId);
  let courtierNom = null;
  if (client && client.responsable_id) {
    const u = bd.prepare('SELECT nom FROM users WHERE id = ? AND cabinet_id = ?')
      .get(client.responsable_id, cabinetId);
    if (u) courtierNom = u.nom;
  }

  const cons = (antecedents && antecedents.consentements) || {};
  const consentementsLibelles = Object.keys(NOMS_CONSENTEMENTS)
    .filter((k) => cons[k])
    .map((k) => NOMS_CONSENTEMENTS[k]);

  const maintenant = new Date();
  const genereLe = maintenant.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' })
    + ' à ' + maintenant.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });

  return {
    soumissionId: soumission.id,
    statut,
    notes,
    dateEffet,
    versionNumero,
    versionFigee,
    auteurVersion,
    genereLe,
    cabinetNom: cabinet ? cabinet.nom : '—',
    client,
    courtierNom,
    batiments,
    contenusGeneraux,
    antecedents,
    consentementsLibelles,
    fmtMontant,
  };
}

module.exports = {
  preparerPropositionBiens,
  NOMS_TYPE_CONSTRUCTION,
  NOMS_TYPE_CONTENU,
  NOMS_FORMULE,
  AVENANTS_BIENS,
  NOMS_CONSENTEMENTS,
  fmtMontant,
};
