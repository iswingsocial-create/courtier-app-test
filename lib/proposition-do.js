/**
 * lib/proposition-do.js — Préparation des données de la proposition
 * d'assurance responsabilité des administrateurs et dirigeants pré-remplie
 * (D&O — étape 7/10).
 * Source unique pour la page HTML imprimable (views/do/proposition.ejs)
 * et le PDF téléchargeable (lib/proposition-do-pdf.js) : même contenu,
 * mêmes libellés.
 *
 * La proposition reflète soit l'état courant de la soumission, soit une
 * version figée (?v=N) via dosoum.obtenirVersion (règle d'or : traçabilité).
 * Miroir de lib/proposition-eo.js (étape 7/10 E&O).
 *
 * La proposition ne modifie JAMAIS la soumission : lecture seule.
 */
const bd = require('./bd');
const dosoum = require('./do');

// Libellés — identiques à routes/do.js.
const BASES_GARANTIE = ['reclamations_presentees', 'occurrences'];
const NOMS_BASE_GARANTIE = {
  reclamations_presentees: 'Réclamations-présentées',
  occurrences: 'Occurrences',
};
const AVENANTS_DO = [
  ['frais_defense', 'Frais de défense'],
  ['pratiques_emploi', 'Pratiques d’emploi'],
  ['fidelite_crime', 'Fidélité / crime'],
];
const NOMS_CONSENTEMENTS = {
  credit: 'Dossier de crédit',
  dossier_assurance: 'Dossier d’assurance (sinistres antérieurs)',
};

function fmtMontant(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-CA') + ' $';
}

// Enrichit les garanties D&O avec les libellés français.
function enrichirGaranties(g) {
  if (!g) return null;
  const r = { ...g };
  r.limite_par_sinistre_libelle = fmtMontant(g.limite_par_sinistre);
  r.limite_agregat_libelle = fmtMontant(g.limite_agregat);
  r.franchise_libelle = fmtMontant(g.franchise);
  r.prime_libelle = fmtMontant(g.prime);
  r.base_libelle = NOMS_BASE_GARANTIE[g.base] || (g.base || '—');
  const av = g.avenants || {};
  r.avenants_libelles = AVENANTS_DO
    .filter(([code]) => av[code])
    .map(([, lib]) => lib);
  return r;
}

function enrichirDirigeant(d) {
  const r = { ...d };
  r.annees_experience_libelle =
    (d.annees_experience === null || d.annees_experience === undefined || d.annees_experience === '')
      ? '—' : `${d.annees_experience} ans`;
  return r;
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
 * @param {object} soumission — objet complet de dosoum.obtenirSoumission (contrôle d'accès déjà fait par la route)
 * @param {number|null} versionDemandee — version figée (?v=) ou null pour l'état courant
 * @returns {object|null} données normalisées, ou { erreur: 'version' } si la version n'existe pas
 */
function preparerPropositionDo(cabinetId, soumission, versionDemandee) {
  let dirigeants;
  let garanties;
  let antecedents;
  let versionNumero;
  let versionFigee;
  let auteurVersion = null;
  let statut;
  let notes;
  let dateEffet;

  if (versionDemandee) {
    const v = dosoum.obtenirVersion(soumission.id, versionDemandee, cabinetId);
    if (!v || !v.donnees) return { erreur: 'version' };
    dirigeants = v.donnees.dirigeants || [];
    garanties = v.donnees.garanties || null;
    antecedents = v.donnees.antecedents || null;
    versionNumero = v.version;
    versionFigee = true;
    auteurVersion = v.auteur || null;
    statut = v.statut;
    notes = v.notes;
    dateEffet = v.date_effet_souhaitee;
  } else {
    dirigeants = soumission.dirigeants || [];
    garanties = soumission.garanties || null;
    antecedents = soumission.antecedents || null;
    const versions = dosoum.versionsSoumission(soumission.id, cabinetId);
    versionNumero = versions.length ? versions[0].version : 1;
    versionFigee = false;
    statut = soumission.statut;
    notes = soumission.notes;
    dateEffet = soumission.date_effet_souhaitee;
  }

  dirigeants = dirigeants.map(enrichirDirigeant);
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
    dirigeants,
    garanties,
    antecedents,
    consentementsLibelles,
    fmtMontant,
  };
}

module.exports = {
  preparerPropositionDo,
  BASES_GARANTIE,
  NOMS_BASE_GARANTIE,
  AVENANTS_DO,
  NOMS_CONSENTEMENTS,
  fmtMontant,
};
