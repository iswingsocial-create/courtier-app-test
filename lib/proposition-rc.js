/**
 * lib/proposition-rc.js — Préparation des données de la proposition
 * d'assurance responsabilité civile (CGL) pré-remplie (RC — étape 7/10).
 * Source unique pour la page HTML imprimable (views/rc/proposition.ejs)
 * et le PDF téléchargeable (lib/proposition-rc-pdf.js) : même contenu,
 * mêmes libellés.
 *
 * La proposition reflète soit l'état courant de la soumission, soit une
 * version figée (?v=N) via rc.obtenirVersion (règle d'or : traçabilité).
 * Miroir de lib/proposition-biens.js (étape 7/10 biens).
 *
 * La proposition ne modifie JAMAIS la soumission : lecture seule.
 */
const bd = require('./bd');
const rc = require('./rc');

// Libellés — identiques à routes/rc.js.
const NOMS_FORMULE_RC = {
  locaux_operations: 'Locaux et opérations',
  produits_completes: 'Produits et opérations complétées',
  globale: 'Globale',
};
const NOMS_SOUS_TRAITANT = {
  aucun: 'Aucun',
  assures: 'Assurés',
  non_assures: 'Non assurés',
};
const AVENANTS_RC = [
  ['pollution', 'Pollution'],
  ['parapluie', 'Parapluie'],
];
const NOMS_CONSENTEMENTS = {
  credit: 'Dossier de crédit',
  dossier_assurance: 'Dossier d’assurance (sinistres antérieurs)',
};

function fmtMontant(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-CA') + ' $';
}

// Enrichit les garanties d'un lieu d'exploitation avec les libellés français.
function enrichirGaranties(g) {
  if (!g) return null;
  const r = { ...g };
  r.formule_libelle = NOMS_FORMULE_RC[g.formule] || (g.formule || '—');
  r.limite_par_sinistre_libelle = fmtMontant(g.limite_par_sinistre);
  r.limite_agregat_libelle = fmtMontant(g.limite_agregat);
  r.franchise_libelle = fmtMontant(g.franchise);
  r.prime_libelle = fmtMontant(g.prime);
  const av = g.avenants || {};
  r.avenants_libelles = AVENANTS_RC
    .filter(([code]) => av[code])
    .map(([, lib]) => lib);
  return r;
}

function enrichirExploitation(e) {
  return {
    ...e,
    sous_traitants_libelle: NOMS_SOUS_TRAITANT[e.sous_traitants] || e.sous_traitants || '—',
    chiffre_affaires_libelle: fmtMontant(e.chiffre_affaires),
    masse_salariale_libelle: fmtMontant(e.masse_salariale),
    garanties: enrichirGaranties(e.garanties),
  };
}

/**
 * Prépare les données de la proposition.
 * @param {number} cabinetId
 * @param {object} soumission — objet complet de rc.obtenirSoumission (contrôle d'accès déjà fait par la route)
 * @param {number|null} versionDemandee — version figée (?v=) ou null pour l'état courant
 * @returns {object|null} données normalisées, ou { erreur: 'version' } si la version n'existe pas
 */
function preparerPropositionRc(cabinetId, soumission, versionDemandee) {
  let exploitations;
  let antecedents;
  let versionNumero;
  let versionFigee;
  let auteurVersion = null;
  let statut;
  let notes;
  let dateEffet;

  if (versionDemandee) {
    const v = rc.obtenirVersion(soumission.id, versionDemandee, cabinetId);
    if (!v || !v.donnees) return { erreur: 'version' };
    exploitations = v.donnees.exploitations || [];
    antecedents = v.donnees.antecedents || null;
    versionNumero = v.version;
    versionFigee = true;
    auteurVersion = v.auteur || null;
    statut = v.statut;
    notes = v.notes;
    dateEffet = v.date_effet_souhaitee;
  } else {
    exploitations = soumission.exploitations || [];
    antecedents = soumission.antecedents || null;
    const versions = rc.versionsSoumission(soumission.id, cabinetId);
    versionNumero = versions.length ? versions[0].version : 1;
    versionFigee = false;
    statut = soumission.statut;
    notes = soumission.notes;
    dateEffet = soumission.date_effet_souhaitee;
  }

  exploitations = exploitations.map(enrichirExploitation);

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
    exploitations,
    antecedents,
    consentementsLibelles,
    fmtMontant,
  };
}

module.exports = {
  preparerPropositionRc,
  NOMS_FORMULE_RC,
  NOMS_SOUS_TRAITANT,
  AVENANTS_RC,
  NOMS_CONSENTEMENTS,
  fmtMontant,
};
