/**
 * lib/proposition-flotte.js — Préparation des données de la proposition
 * d'assurance flotte automobile pré-remplie (flotte — étape 7/10).
 * Source unique pour la page HTML imprimable (views/flotte/proposition.ejs)
 * et le PDF téléchargeable (lib/proposition-flotte-pdf.js) : même contenu,
 * mêmes libellés.
 *
 * La proposition reflète soit l'état courant de la soumission, soit une
 * version figée (?v=N) via flotte.obtenirVersion (règle d'or : traçabilité —
 * la version figée fait foi comme preuve de conformité).
 * Miroir de lib/proposition-pe.js (étape 7/10 PE).
 *
 * La proposition ne modifie JAMAIS la soumission : lecture seule.
 */
const bd = require('./bd');
const flotte = require('./flotte');

// Libellés — identiques à routes/flotte.js.
const NOMS_USAGES = {
  livraison: 'Livraison',
  service: 'Service',
  transport_marchandises: 'Transport de marchandises',
  personnel: 'Personnel',
  mixte: 'Mixte',
};
const NOMS_TYPES_VEHICULE = {
  camion: 'Camion',
  automobile: 'Automobile',
  remorque: 'Remorque',
  equipement: 'Équipement',
};
const AVENANTS_FAQ = [
  ['faq43', 'FAQ 43 — Valeur à neuf'],
  ['faq20', 'FAQ 20 — Privation de jouissance'],
  ['faq27', 'FAQ 27 — Véhicule loué ou n’appartenant pas à l’assuré'],
  ['faq34', 'FAQ 34 — Indemnités d’accident'],
  ['faq5a', 'FAQ 5a — Crédit-bail'],
];
const NOMS_CONSENTEMENTS = {
  credit: 'Dossier de crédit',
  dossier_saaq: 'Dossier SAAQ (dossier de conduite)',
  fcsa: 'FCSA (sinistres automobiles)',
};

function fmtMontant(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-CA') + ' $';
}

function fmtRayon(n) {
  if (n === null || n === undefined || n === '') return '—';
  return `${Number(n).toLocaleString('fr-CA')} km`;
}

function fmtAnnees(n) {
  if (n === null || n === undefined || n === '') return '—';
  return `${Number(n)} an${Number(n) > 1 ? 's' : ''}`;
}

// Consentement présent ? (format plat {code:1} de l'UI, ou format semé
// {code:{accepte:true}}) — même règle que routes/flotte.js.
function consentementActif(consentements, code) {
  if (!consentements) return false;
  const v = consentements[code];
  return !!(v === 1 || v === true || (v && v.accepte));
}

function enrichirVehicule(v, conducteursParId) {
  const r = { ...v };
  r.designation = [v.annee, v.marque, v.modele].filter(Boolean).join(' ') || '—';
  r.valeur_libelle = fmtMontant(v.valeur);
  r.type_libelle = NOMS_TYPES_VEHICULE[v.type_vehicule] || (v.type_vehicule || '—');
  r.usage_libelle = NOMS_USAGES[v.usage] || (v.usage || '—');
  r.rayon_libelle = fmtRayon(v.rayon_operation_km);
  r.conducteur_principal_libelle =
    (v.conducteur_principal_id && conducteursParId[v.conducteur_principal_id])
    || v.conducteur_principal_nom || '—';
  const eq = Array.isArray(v.equipements_speciaux) ? v.equipements_speciaux : [];
  r.equipements_libelles = eq.map((e) => {
    const valeur = (e && e.valeur !== null && e.valeur !== undefined && e.valeur !== '')
      ? ` (${fmtMontant(e.valeur)})` : '';
    return `${(e && e.description) || ''}${valeur}`;
  }).filter(Boolean);
  return r;
}

function enrichirConducteur(c) {
  const r = { ...c };
  r.nom_complet = [c.prenom, c.nom].filter(Boolean).join(' ') || '—';
  r.experience_libelle = fmtAnnees(c.annees_experience);
  r.experience_lourds_libelle = fmtAnnees(c.annees_experience_lourds);
  const sins = Array.isArray(c.sinistres_5ans) ? c.sinistres_5ans : [];
  r.sinistres_libelles = sins.map((x) => {
    const base = [x.date, x.description].filter(Boolean).join(' — ');
    const montant = (x.montant !== null && x.montant !== undefined && x.montant !== '')
      ? fmtMontant(x.montant) : null;
    const resp = x.responsabilite ? `responsabilité : ${x.responsabilite}` : null;
    return [base, montant, resp].filter(Boolean).join(' · ');
  });
  const infr = Array.isArray(c.infractions_3ans) ? c.infractions_3ans : [];
  r.infractions_libelles = infr.map((x) => {
    const base = [x.date, x.type, x.description].filter(Boolean).join(' — ');
    const points = (x.points !== null && x.points !== undefined && x.points !== '')
      ? `${Number(x.points)} point${Number(x.points) > 1 ? 's' : ''}` : null;
    return [base, points].filter(Boolean).join(' · ');
  });
  const forms = Array.isArray(c.formations) ? c.formations : [];
  r.formations_libelles = forms.map((x) =>
    [x.formation, x.date, x.organisme].filter(Boolean).join(' — '));
  return r;
}

// Enrichit les garanties flotte avec les libellés français (jamais les codes FAQ seuls).
function enrichirGaranties(g) {
  if (!g) return null;
  const r = { ...g };
  r.limite_rc_libelle = fmtMontant(g.limite_rc);
  r.franchise_collision_libelle = fmtMontant(g.franchise_collision);
  r.franchise_versement_libelle = fmtMontant(g.franchise_versement);
  r.prime_libelle = fmtMontant(g.prime);
  const av = g.avenants || {};
  r.avenants_libelles = AVENANTS_FAQ
    .filter(([code]) => av[code])
    .map(([, lib]) => lib);
  r.faq43 = !!av.faq43;
  return r;
}

function enrichirAntecedents(a) {
  if (!a) return null;
  const r = { ...a };
  const sins = Array.isArray(a.sinistres_flotte_5ans) ? a.sinistres_flotte_5ans : [];
  r.sinistres_flotte_libelles = sins.map((x) => {
    const base = [x.date, x.description].filter(Boolean).join(' — ');
    const montant = (x.montant !== null && x.montant !== undefined && x.montant !== '')
      ? fmtMontant(x.montant) : null;
    return [base, montant].filter(Boolean).join(' · ');
  });
  r.ratio_pertes_libelle = (a.ratio_pertes === null || a.ratio_pertes === undefined || a.ratio_pertes === '')
    ? '—' : `${Number(a.ratio_pertes).toLocaleString('fr-CA')} %`;
  return r;
}

/**
 * Prépare les données de la proposition.
 * @param {number} cabinetId
 * @param {object} soumission — objet complet de flotte.obtenirSoumission (contrôle d'accès déjà fait par la route)
 * @param {number|null} versionDemandee — version figée (?v=) ou null pour l'état courant
 * @returns {object|null} données normalisées, ou { erreur: 'version' } si la version n'existe pas
 */
function preparerPropositionFlotte(cabinetId, soumission, versionDemandee) {
  let entete;
  let vehicules;
  let conducteurs;
  let garanties;
  let antecedents;
  let versionNumero;
  let versionFigee;
  let auteurVersion = null;
  let statut;
  let notes;
  let dateEffet;

  if (versionDemandee) {
    const v = flotte.obtenirVersion(soumission.id, versionDemandee, cabinetId);
    if (!v || !v.donnees) return { erreur: 'version' };
    entete = v.donnees.entete || {};
    vehicules = v.donnees.vehicules || [];
    conducteurs = v.donnees.conducteurs || [];
    garanties = v.donnees.garanties || null;
    antecedents = v.donnees.antecedents || null;
    versionNumero = v.version;
    versionFigee = true;
    auteurVersion = v.auteur || null;
    statut = v.statut;
    notes = v.notes;
    dateEffet = v.date_effet_souhaitee;
  } else {
    entete = {
      client_id: soumission.client_id,
      assureur: soumission.assureur,
      numero_police: soumission.numero_police,
      nb_vehicules: soumission.nb_vehicules,
      rayon_operation_km: soumission.rayon_operation_km,
      usage_dominant: soumission.usage_dominant,
      date_effet_souhaitee: soumission.date_effet_souhaitee,
      date_echeance_visee: soumission.date_echeance_visee,
    };
    vehicules = soumission.vehicules || [];
    conducteurs = soumission.conducteurs || [];
    garanties = soumission.garanties || null;
    antecedents = soumission.antecedents || null;
    const versions = flotte.versionsSoumission(soumission.id, cabinetId);
    versionNumero = versions.length ? versions[0].version : 1;
    versionFigee = false;
    statut = soumission.statut;
    notes = soumission.notes;
    dateEffet = soumission.date_effet_souhaitee;
  }

  const conducteursParId = {};
  for (const c of conducteurs) conducteursParId[c.id] = [c.prenom, c.nom].filter(Boolean).join(' ');

  vehicules = vehicules.map((v) => enrichirVehicule(v, conducteursParId));
  conducteurs = conducteurs.map(enrichirConducteur);
  garanties = enrichirGaranties(garanties);
  antecedents = enrichirAntecedents(antecedents);

  // Résumé de la flotte : nombre de véhicules détaillés, valeur totale,
  // usages présents, rayon (principal de l'en-tête + maximum des véhicules).
  const valeurTotale = vehicules.reduce((somme, v) =>
    somme + (v.valeur === null || v.valeur === undefined || v.valeur === '' ? 0 : Number(v.valeur)), 0);
  const usagesLibelles = [...new Set(vehicules.map((v) => v.usage_libelle).filter((u) => u && u !== '—'))];
  const rayonsVehicules = vehicules
    .map((v) => v.rayon_operation_km)
    .filter((n) => n !== null && n !== undefined && n !== '')
    .map(Number);
  const resume = {
    nbVehicules: vehicules.length,
    nbVehiculesDeclares: (entete.nb_vehicules === null || entete.nb_vehicules === undefined)
      ? null : Number(entete.nb_vehicules),
    valeurTotale,
    valeurTotale_libelle: fmtMontant(valeurTotale),
    usagesLibelles,
    rayonPrincipal: entete.rayon_operation_km,
    rayonPrincipal_libelle: fmtRayon(entete.rayon_operation_km),
    rayonMaxVehicules: rayonsVehicules.length ? Math.max(...rayonsVehicules) : null,
    usageDominant: entete.usage_dominant || null,
    usageDominant_libelle: NOMS_USAGES[entete.usage_dominant] || (entete.usage_dominant || '—'),
  };
  entete = {
    ...entete,
    usage_dominant_libelle: resume.usageDominant_libelle,
    rayon_libelle: resume.rayonPrincipal_libelle,
  };

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
    .filter((k) => consentementActif(cons, k))
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
    entete,
    resume,
    vehicules,
    conducteurs,
    garanties,
    antecedents,
    consentementsLibelles,
    fmtMontant,
  };
}

module.exports = {
  preparerPropositionFlotte,
  NOMS_USAGES,
  NOMS_TYPES_VEHICULE,
  AVENANTS_FAQ,
  NOMS_CONSENTEMENTS,
  fmtMontant,
  fmtRayon,
  consentementActif,
};
