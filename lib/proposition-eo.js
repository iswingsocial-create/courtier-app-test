/**
 * lib/proposition-eo.js — Préparation des données de la proposition
 * d'assurance responsabilité professionnelle pré-remplie (E&O — étape 7/10).
 * Source unique pour la page HTML imprimable (views/eo/proposition.ejs)
 * et le PDF téléchargeable (lib/proposition-eo-pdf.js) : même contenu,
 * mêmes libellés.
 *
 * La proposition reflète soit l'état courant de la soumission, soit une
 * version figée (?v=N) via eo.obtenirVersion (règle d'or : traçabilité).
 * Miroir de lib/proposition-cyber.js (étape 7/10 cyber).
 *
 * La proposition ne modifie JAMAIS la soumission : lecture seule.
 */
const bd = require('./bd');
const eo = require('./eo');

// Libellés — identiques à routes/eo.js.
const BASES_GARANTIE = ['reclamations_presentees', 'occurrences'];
const NOMS_BASE_GARANTIE = {
  reclamations_presentees: 'Réclamations-présentées',
  occurrences: 'Occurrences',
};
const AVENANTS_EO = [
  ['frais_defense', 'Frais de défense'],
  ['medias_contenu', 'Médias et contenu'],
  ['cyber_associe', 'Cyber associé'],
];
const NOMS_CONSENTEMENTS = {
  credit: 'Dossier de crédit',
  dossier_assurance: 'Dossier d’assurance (sinistres antérieurs)',
};

function fmtMontant(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-CA') + ' $';
}

// Enrichit les garanties E&O avec les libellés français.
function enrichirGaranties(g) {
  if (!g) return null;
  const r = { ...g };
  r.limite_par_sinistre_libelle = fmtMontant(g.limite_par_sinistre);
  r.limite_agregat_libelle = fmtMontant(g.limite_agregat);
  r.franchise_libelle = fmtMontant(g.franchise);
  r.prime_libelle = fmtMontant(g.prime);
  r.base_libelle = NOMS_BASE_GARANTIE[g.base] || (g.base || '—');
  const av = g.avenants || {};
  r.avenants_libelles = AVENANTS_EO
    .filter(([code]) => av[code])
    .map(([, lib]) => lib);
  return r;
}

function enrichirActivite(a) {
  return {
    ...a,
    chiffre_affaires_libelle: fmtMontant(a.chiffre_affaires),
    nb_professionnels_libelle:
      (a.nb_professionnels === null || a.nb_professionnels === undefined || a.nb_professionnels === '')
        ? '—' : String(a.nb_professionnels),
  };
}

function enrichirAntecedents(a) {
  if (!a) return null;
  const r = { ...a };
  const recs = a.reclamations_5ans || [];
  r.reclamations_libelles = recs.map((x) => {
    const morceaux = [x.date, x.nature].filter(Boolean).join(' — ');
    const montant = (x.montant !== null && x.montant !== undefined && x.montant !== '')
      ? `${Number(x.montant).toLocaleString('fr-CA')} $` : null;
    const reclame = (x.sinistre) ? 'réclamée' : 'non réclamée';
    return [morceaux, montant, reclame].filter(Boolean).join(' · ');
  });
  return r;
}

/**
 * Prépare les données de la proposition.
 * @param {number} cabinetId
 * @param {object} soumission — objet complet de eo.obtenirSoumission (contrôle d'accès déjà fait par la route)
 * @param {number|null} versionDemandee — version figée (?v=) ou null pour l'état courant
 * @returns {object|null} données normalisées, ou { erreur: 'version' } si la version n'existe pas
 */
function preparerPropositionEo(cabinetId, soumission, versionDemandee) {
  let activites;
  let garanties;
  let antecedents;
  let versionNumero;
  let versionFigee;
  let auteurVersion = null;
  let statut;
  let notes;
  let dateEffet;

  if (versionDemandee) {
    const v = eo.obtenirVersion(soumission.id, versionDemandee, cabinetId);
    if (!v || !v.donnees) return { erreur: 'version' };
    activites = v.donnees.activites || [];
    garanties = v.donnees.garanties || null;
    antecedents = v.donnees.antecedents || null;
    versionNumero = v.version;
    versionFigee = true;
    auteurVersion = v.auteur || null;
    statut = v.statut;
    notes = v.notes;
    dateEffet = v.date_effet_souhaitee;
  } else {
    activites = soumission.activites || [];
    garanties = soumission.garanties || null;
    antecedents = soumission.antecedents || null;
    const versions = eo.versionsSoumission(soumission.id, cabinetId);
    versionNumero = versions.length ? versions[0].version : 1;
    versionFigee = false;
    statut = soumission.statut;
    notes = soumission.notes;
    dateEffet = soumission.date_effet_souhaitee;
  }

  activites = activites.map(enrichirActivite);
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
    activites,
    garanties,
    antecedents,
    consentementsLibelles,
    fmtMontant,
  };
}

module.exports = {
  preparerPropositionEo,
  BASES_GARANTIE,
  NOMS_BASE_GARANTIE,
  AVENANTS_EO,
  NOMS_CONSENTEMENTS,
  fmtMontant,
};
