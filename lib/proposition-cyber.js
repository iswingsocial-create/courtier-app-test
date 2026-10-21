/**
 * lib/proposition-cyber.js — Préparation des données de la proposition
 * d'assurance cyberrisques pré-remplie (Cyber — étape 7/10).
 * Source unique pour la page HTML imprimable (views/cyber/proposition.ejs)
 * et le PDF téléchargeable (lib/proposition-cyber-pdf.js) : même contenu,
 * mêmes libellés.
 *
 * La proposition reflète soit l'état courant de la soumission, soit une
 * version figée (?v=N) via cyber.obtenirVersion (règle d'or : traçabilité).
 * Miroir de lib/proposition-rc.js (étape 7/10 RC).
 *
 * La proposition ne modifie JAMAIS la soumission : lecture seule.
 */
const bd = require('./bd');
const cyber = require('./cyber');

// Libellés — identiques à routes/cyber.js.
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
const NOMS_STATUT_MESURE = {
  en_place: 'En place',
  partiel: 'Partiel',
  absent: 'Absent',
  prevu: 'Prévu',
};
const AVENANTS_CYBER = [
  ['rancongiciel', 'Rançongiciel'],
  ['fraude_transfert', 'Fraude par transfert de fonds'],
  ['donnees_vie_privee', 'Données et vie privée'],
  ['interruption', 'Interruption d’activité'],
];
const NOMS_CONSENTEMENTS = {
  credit: 'Dossier de crédit',
  dossier_assurance: 'Dossier d’assurance (sinistres antérieurs)',
};

function fmtMontant(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-CA') + ' $';
}

// Enrichit les garanties cyber avec les libellés français.
function enrichirGaranties(g) {
  if (!g) return null;
  const r = { ...g };
  r.limite_par_sinistre_libelle = fmtMontant(g.limite_par_sinistre);
  r.limite_agregat_libelle = fmtMontant(g.limite_agregat);
  r.franchise_libelle = fmtMontant(g.franchise);
  r.prime_libelle = fmtMontant(g.prime);
  r.delai_carence_libelle = (g.delai_carence === null || g.delai_carence === undefined || g.delai_carence === '')
    ? '—' : String(g.delai_carence);
  const av = g.avenants || {};
  r.avenants_libelles = AVENANTS_CYBER
    .filter(([code]) => av[code])
    .map(([, lib]) => lib);
  return r;
}

function enrichirMesure(m) {
  return {
    ...m,
    type_mesure_libelle: NOMS_TYPE_MESURE[m.type_mesure] || (m.type_mesure || '—'),
    statut_libelle: NOMS_STATUT_MESURE[m.statut] || (m.statut || '—'),
  };
}

function enrichirAntecedents(a) {
  if (!a) return null;
  const r = { ...a };
  const incs = a.incidents_5ans || [];
  r.incidents_libelles = incs.map((x) => {
    const morceaux = [x.date, x.type].filter(Boolean).join(' — ');
    const montant = (x.montant !== null && x.montant !== undefined && x.montant !== '')
      ? `${Number(x.montant).toLocaleString('fr-CA')} $` : null;
    const reclame = (x.reclame) ? 'réclamé' : 'non réclamé';
    return [morceaux, montant, reclame].filter(Boolean).join(' · ');
  });
  return r;
}

/**
 * Prépare les données de la proposition.
 * @param {number} cabinetId
 * @param {object} soumission — objet complet de cyber.obtenirSoumission (contrôle d'accès déjà fait par la route)
 * @param {number|null} versionDemandee — version figée (?v=) ou null pour l'état courant
 * @returns {object|null} données normalisées, ou { erreur: 'version' } si la version n'existe pas
 */
function preparerPropositionCyber(cabinetId, soumission, versionDemandee) {
  let mesures;
  let garanties;
  let antecedents;
  let versionNumero;
  let versionFigee;
  let auteurVersion = null;
  let statut;
  let notes;
  let dateEffet;

  if (versionDemandee) {
    const v = cyber.obtenirVersion(soumission.id, versionDemandee, cabinetId);
    if (!v || !v.donnees) return { erreur: 'version' };
    mesures = v.donnees.mesures || [];
    garanties = v.donnees.garanties || null;
    antecedents = v.donnees.antecedents || null;
    versionNumero = v.version;
    versionFigee = true;
    auteurVersion = v.auteur || null;
    statut = v.statut;
    notes = v.notes;
    dateEffet = v.date_effet_souhaitee;
  } else {
    mesures = soumission.mesures || [];
    garanties = soumission.garanties || null;
    antecedents = soumission.antecedents || null;
    const versions = cyber.versionsSoumission(soumission.id, cabinetId);
    versionNumero = versions.length ? versions[0].version : 1;
    versionFigee = false;
    statut = soumission.statut;
    notes = soumission.notes;
    dateEffet = soumission.date_effet_souhaitee;
  }

  mesures = mesures.map(enrichirMesure);
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
    mesures,
    garanties,
    antecedents,
    consentementsLibelles,
    fmtMontant,
  };
}

module.exports = {
  preparerPropositionCyber,
  NOMS_TYPE_MESURE,
  NOMS_STATUT_MESURE,
  AVENANTS_CYBER,
  NOMS_CONSENTEMENTS,
  fmtMontant,
};
