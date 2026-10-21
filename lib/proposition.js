/**
 * lib/proposition.js — Préparation des données de la proposition d'assurance
 * automobile pré-remplie (étape 7/10). Source unique pour la page HTML
 * imprimable (views/auto/proposition.ejs) et le PDF téléchargeable
 * (lib/proposition-pdf.js) : même contenu, mêmes libellés.
 *
 * La proposition reflète soit l'état courant de la soumission, soit une
 * version figée (?v=N) via fpq1.obtenirVersion (règle d'or : traçabilité).
 */
const bd = require('./bd');
const fpq1 = require('./fpq1');

// Libellés — identiques à routes/auto.js (source unique ici pour la proposition).
const NOMS_RC = {
  50000: '50 000 $ (minimum légal)',
  1000000: '1 000 000 $',
  2000000: '2 000 000 $ (recommandé)',
};
const NOMS_PROTECTION_B = {
  b1: 'B1 — Tous risques',
  b2: 'B2 — Collision ou versement',
  b3: 'B3 — Tous risques sauf collision',
  b4: 'B4 — Risques spécifiés',
};
const AVENANTS_FAQ = [
  ['faq43', 'FAQ 43 — Valeur à neuf'],
  ['faq20', 'FAQ 20 — Privation de jouissance (frais de déplacement)'],
  ['faq27', 'FAQ 27 — Dommages au véhicule n’appartenant pas à l’assuré'],
  ['faq34', 'FAQ 34 — Assurance de personnes'],
  ['faq5a', 'FAQ 5a — Crédit-bail (locateur)'],
];
const NOMS_CONSENTEMENTS = {
  credit: 'Dossier de crédit',
  dossier_saaq: 'Dossier de conduite (SAAQ)',
  fcsa: 'Fichier central des sinistres automobiles (FCSA)',
};
const NOMS_FINANCEMENT = { comptant: 'Comptant', finance: 'Financé', loue: 'Loué' };
const NOMS_USAGE = { promenade: 'Promenade', affaires: 'Affaires', navette: 'Navette (domicile-travail)' };
const NOMS_ETAT = { neuf: 'Neuf', occasion: 'Occasion' };

function fmtMontant(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-CA') + ' $';
}

// Enrichit les garanties d'un véhicule avec les libellés français.
function enrichirGaranties(g) {
  if (!g) return null;
  const r = { ...g };
  r.rc_libelle = NOMS_RC[g.rc_montant] || (g.rc_montant ? fmtMontant(g.rc_montant) : '—');
  r.protection_b_libelle = NOMS_PROTECTION_B[g.protection_b] || '—';
  r.franchise_libelle = fmtMontant(g.franchise_b);
  const av = g.avenants || {};
  r.avenants_libelles = AVENANTS_FAQ
    .filter(([code]) => av[code])
    .map(([, lib]) => lib);
  return r;
}

/**
 * Prépare les données de la proposition.
 * @param {number} cabinetId
 * @param {object} soumission — objet complet de fpq1.obtenirSoumission (contrôle d'accès déjà fait par la route)
 * @param {number|null} versionDemandee — version figée (?v=) ou null pour l'état courant
 * @returns {object|null} données normalisées, ou { erreur: 'version' } si la version n'existe pas
 */
function preparerProposition(cabinetId, soumission, versionDemandee) {
  let conducteurs;
  let vehicules;
  let antecedents;
  let versionNumero;
  let versionFigee;
  let auteurVersion = null;
  let statut;
  let notes;
  let dateEffet;

  if (versionDemandee) {
    const v = fpq1.obtenirVersion(soumission.id, versionDemandee, cabinetId);
    if (!v || !v.donnees) return { erreur: 'version' };
    conducteurs = v.donnees.conducteurs || [];
    vehicules = v.donnees.vehicules || [];
    antecedents = v.donnees.antecedents || null;
    versionNumero = v.version;
    versionFigee = true;
    auteurVersion = v.auteur || null;
    statut = v.statut;
    notes = v.notes;
    dateEffet = v.date_effet_souhaitee;
  } else {
    conducteurs = soumission.conducteurs || [];
    vehicules = soumission.vehicules || [];
    antecedents = soumission.antecedents || null;
    const versions = fpq1.versionsSoumission(soumission.id, cabinetId);
    versionNumero = versions.length ? versions[0].version : 1;
    versionFigee = false;
    statut = soumission.statut;
    notes = soumission.notes;
    dateEffet = soumission.date_effet_souhaitee;
  }

  vehicules = vehicules.map((vh) => ({
    ...vh,
    financement_libelle: NOMS_FINANCEMENT[vh.financement] || vh.financement || null,
    usage_libelle: NOMS_USAGE[vh.usage] || vh.usage || null,
    etat_libelle: NOMS_ETAT[vh.neuf_occasion] || vh.neuf_occasion || null,
    garanties: enrichirGaranties(vh.garanties),
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
    conducteurs,
    vehicules,
    antecedents,
    consentementsLibelles,
    fmtMontant,
  };
}

module.exports = {
  preparerProposition,
  NOMS_RC,
  NOMS_PROTECTION_B,
  AVENANTS_FAQ,
  NOMS_CONSENTEMENTS,
  NOMS_FINANCEMENT,
  NOMS_USAGE,
  NOMS_ETAT,
  fmtMontant,
};
