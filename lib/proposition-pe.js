/**
 * lib/proposition-pe.js — Préparation des données de la proposition
 * d'assurance perte d'exploitation / interruption des affaires pré-remplie
 * (perte d'exploitation — étape 7/10).
 * Source unique pour la page HTML imprimable (views/pe/proposition.ejs)
 * et le PDF téléchargeable (lib/proposition-pe-pdf.js) : même contenu,
 * mêmes libellés.
 *
 * La proposition reflète soit l'état courant de la soumission, soit une
 * version figée (?v=N) via pesoum.obtenirVersion (règle d'or : traçabilité).
 * Miroir de lib/proposition-do.js (étape 7/10 D&O).
 *
 * La proposition ne modifie JAMAIS la soumission : lecture seule.
 */
const bd = require('./bd');
const pesoum = require('./pe');

// Libellés — identiques à routes/pe.js.
const BASES_MONTANT = ['benefice_brut', 'marge_brute', 'chiffre_affaires'];
const NOMS_BASE_MONTANT = {
  benefice_brut: 'Bénéfice brut',
  marge_brute: 'Marge brute',
  chiffre_affaires: 'Chiffre d’affaires',
};
const NOMS_PERIODE_INDEMNITE = {
  12: '12 mois',
  18: '18 mois',
  24: '24 mois',
};
const NOMS_BASE_VALEUR = {
  remplacement: 'Coût de remplacement',
  depreciation: 'Valeur dépréciée',
};
const AVENANTS_PE = [
  ['frais_supplementaires', 'Frais supplémentaires'],
  ['dependance_fournisseurs', 'Dépendance aux fournisseurs'],
  ['acces_civil', 'Accès civil (interdiction d’accès)'],
  ['deterioration_stocks', 'Détérioration des stocks'],
];
const NOMS_CONSENTEMENTS = {
  credit: 'Dossier de crédit',
  dossier_assurance: 'Dossier d’assurance (sinistres antérieurs)',
};

function fmtMontant(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-CA') + ' $';
}

// Enrichit les garanties PE avec les libellés français.
function enrichirGaranties(g) {
  if (!g) return null;
  const r = { ...g };
  r.limite_libelle = fmtMontant(g.limite);
  r.prime_libelle = fmtMontant(g.prime);
  const p = Number(g.periode_indemnite_mois);
  r.periode_indemnite_libelle = NOMS_PERIODE_INDEMNITE[p] || (g.periode_indemnite_mois === null || g.periode_indemnite_mois === undefined ? '—' : `${p} mois`);
  const f = Number(g.franchise_jours);
  r.franchise_jours_libelle = (g.franchise_jours === null || g.franchise_jours === undefined || g.franchise_jours === '')
    ? '—' : `${f} jour${f > 1 ? 's' : ''}`;
  r.base_libelle = NOMS_BASE_MONTANT[g.base_montant] || (g.base_montant || '—');
  const av = g.avenants || {};
  r.avenants_libelles = AVENANTS_PE
    .filter(([code]) => av[code])
    .map(([, lib]) => lib);
  return r;
}

function enrichirEtablissement(e) {
  const r = { ...e };
  r.chiffre_affaires_libelle = fmtMontant(e.chiffre_affaires);
  r.superficie_libelle =
    (e.superficie === null || e.superficie === undefined || e.superficie === '')
      ? '—' : `${Number(e.superficie).toLocaleString('fr-CA')} m²`;
  r.annee_construction_libelle =
    (e.annee_construction === null || e.annee_construction === undefined || e.annee_construction === '')
      ? '—' : String(e.annee_construction);
  r.base_valeur_libelle = NOMS_BASE_VALEUR[e.base_valeur] || (e.base_valeur || '—');
  return r;
}

function enrichirAntecedents(a) {
  if (!a) return null;
  const r = { ...a };
  const ints = a.interruptions_5ans || [];
  r.interruptions_libelles = ints.map((x) => {
    const morceaux = [x.date, x.cause].filter(Boolean).join(' — ');
    const duree = (x.duree_jours !== null && x.duree_jours !== undefined && x.duree_jours !== '')
      ? `${Number(x.duree_jours)} jour${Number(x.duree_jours) > 1 ? 's' : ''}` : null;
    const montant = (x.montant !== null && x.montant !== undefined && x.montant !== '')
      ? `${Number(x.montant).toLocaleString('fr-CA')} $` : null;
    return [morceaux, duree, montant].filter(Boolean).join(' · ');
  });
  return r;
}

/**
 * Prépare les données de la proposition.
 * @param {number} cabinetId
 * @param {object} soumission — objet complet de pesoum.obtenirSoumission (contrôle d'accès déjà fait par la route)
 * @param {number|null} versionDemandee — version figée (?v=) ou null pour l'état courant
 * @returns {object|null} données normalisées, ou { erreur: 'version' } si la version n'existe pas
 */
function preparerPropositionPe(cabinetId, soumission, versionDemandee) {
  let etablissements;
  let garanties;
  let antecedents;
  let versionNumero;
  let versionFigee;
  let auteurVersion = null;
  let statut;
  let notes;
  let dateEffet;

  if (versionDemandee) {
    const v = pesoum.obtenirVersion(soumission.id, versionDemandee, cabinetId);
    if (!v || !v.donnees) return { erreur: 'version' };
    etablissements = v.donnees.etablissements || [];
    garanties = v.donnees.garanties || null;
    antecedents = v.donnees.antecedents || null;
    versionNumero = v.version;
    versionFigee = true;
    auteurVersion = v.auteur || null;
    statut = v.statut;
    notes = v.notes;
    dateEffet = v.date_effet_souhaitee;
  } else {
    etablissements = soumission.etablissements || [];
    garanties = soumission.garanties || null;
    antecedents = soumission.antecedents || null;
    const versions = pesoum.versionsSoumission(soumission.id, cabinetId);
    versionNumero = versions.length ? versions[0].version : 1;
    versionFigee = false;
    statut = soumission.statut;
    notes = soumission.notes;
    dateEffet = soumission.date_effet_souhaitee;
  }

  etablissements = etablissements.map(enrichirEtablissement);
  garanties = enrichirGaranties(garanties);
  antecedents = enrichirAntecedents(antecedents);

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
    etablissements,
    garanties,
    antecedents,
    consentementsLibelles,
    fmtMontant,
  };
}

module.exports = {
  preparerPropositionPe,
  BASES_MONTANT,
  NOMS_BASE_MONTANT,
  NOMS_PERIODE_INDEMNITE,
  NOMS_BASE_VALEUR,
  AVENANTS_PE,
  NOMS_CONSENTEMENTS,
  fmtMontant,
};
