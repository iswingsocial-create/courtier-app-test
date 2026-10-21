/**
 * lib/proposition-cautionnement.js — Préparation des données de la proposition
 * de cautionnement pré-remplie (cautionnement — étape 7/10).
 * Source unique pour la page HTML imprimable (views/cautionnement/proposition.ejs)
 * et le PDF téléchargeable (lib/proposition-cautionnement-pdf.js) : même
 * contenu, mêmes libellés.
 *
 * La proposition reflète soit l'état courant de la soumission, soit une
 * version figée (?v=N) via caut.obtenirVersion (règle d'or : traçabilité —
 * la version figée fait foi comme preuve de conformité).
 * Miroir de lib/proposition-flotte.js (étape 7/10 flotte).
 *
 * La proposition ne modifie JAMAIS la soumission : lecture seule.
 */
const bd = require('./bd');
const caut = require('./cautionnement');

// Libellés — identiques à routes/cautionnement.js.
const NOMS_TYPES_OBLIGATION = {
  soumission: 'Cautionnement de soumission (bid bond)',
  execution: 'Cautionnement d’exécution (performance bond)',
  paiement_mo: 'Paiement de la main-d’œuvre et des matériaux',
  rbq: 'Cautionnement de licence RBQ',
  autre: 'Autre cautionnement',
};
const NOMS_CONSENTEMENTS = {
  credit: 'Dossier de crédit',
  etats_financiers: 'États financiers (2-3 ans)',
};
// Mention métier obligatoire (étape 7/10 cautionnement) : le cautionnement
// n'est PAS une assurance — la caution qui paie se retourne contre le
// principal (convention d'indemnisation). Texte exact, ne pas reformuler.
const MENTION_METIER = "Un cautionnement n'est pas une assurance: la caution qui paie le bénéficiaire se retourne contre le principal (convention d'indemnisation signée par les actionnaires). La limite globale et la limite par projet forment la capacité accordée après analyse des états financiers.";

function fmtMontant(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-CA') + ' $';
}

function fmtPct(n) {
  if (n === null || n === undefined || n === '') return '—';
  return `${Number(n).toLocaleString('fr-CA')} %`;
}

// Consentement présent ? (format plat {code:1} de l'UI, ou format semé
// {code:{accepte:true}}) — même règle que routes/cautionnement.js.
function consentementActif(consentements, code) {
  if (!consentements) return false;
  const v = consentements[code];
  return !!(v === 1 || v === true || (v && v.accepte));
}

function enrichirObligation(o) {
  const r = { ...o };
  r.type_libelle = NOMS_TYPES_OBLIGATION[o.type] || (o.type || '—');
  r.montant_contrat_libelle = fmtMontant(o.montant_contrat);
  r.montant_cautionnement_libelle = fmtMontant(o.montant_cautionnement);
  r.taux_libelle = fmtPct(o.taux_pct);
  r.prime_estimee_libelle = fmtMontant(o.prime_estimee);
  r.duree_libelle = (o.duree_mois === null || o.duree_mois === undefined || o.duree_mois === '')
    ? '—' : `${Number(o.duree_mois)} mois`;
  // Part du contrat couverte (ex. exécution : 50 % du contrat).
  r.part_contrat_libelle = null;
  if (o.montant_contrat && o.montant_cautionnement) {
    const pct = Math.round((Number(o.montant_cautionnement) / Number(o.montant_contrat)) * 1000) / 10;
    r.part_contrat_libelle = `${pct.toLocaleString('fr-CA')} % du contrat`;
  }
  return r;
}

// Enrichit la ligne de cautionnement avec les libellés français.
function enrichirLigne(g) {
  if (!g) return null;
  const r = { ...g };
  r.limite_globale_libelle = fmtMontant(g.limite_globale);
  r.limite_par_projet_libelle = fmtMontant(g.limite_par_projet);
  r.fonds_roulement_libelle = fmtMontant(g.fonds_roulement);
  r.valeur_nette_libelle = fmtMontant(g.valeur_nette);
  r.prime_libelle = fmtMontant(g.prime);
  return r;
}

function enrichirAntecedents(a) {
  if (!a) return null;
  const r = { ...a };
  const recs = Array.isArray(a.reclamations_5ans) ? a.reclamations_5ans : [];
  r.reclamations_libelles = recs.map((x) => {
    const base = [x.date, x.cautionnement].filter(Boolean).join(' — ');
    const montant = (x.montant !== null && x.montant !== undefined && x.montant !== '')
      ? fmtMontant(x.montant) : null;
    return [base, montant, x.statut || null].filter(Boolean).join(' · ');
  });
  return r;
}

/**
 * Prépare les données de la proposition.
 * @param {number} cabinetId
 * @param {object} soumission — objet complet de caut.obtenirSoumission (contrôle d'accès déjà fait par la route)
 * @param {number|null} versionDemandee — version figée (?v=) ou null pour l'état courant
 * @returns {object|null} données normalisées, ou { erreur: 'version' } si la version n'existe pas
 */
function preparerPropositionCaut(cabinetId, soumission, versionDemandee) {
  let entete;
  let obligations;
  let ligne;
  let antecedents;
  let versionNumero;
  let versionFigee;
  let auteurVersion = null;
  let statut;
  let notes;
  let dateEffet;

  if (versionDemandee) {
    const v = caut.obtenirVersion(soumission.id, versionDemandee, cabinetId);
    if (!v || !v.donnees) return { erreur: 'version' };
    entete = v.donnees.entete || {};
    obligations = v.donnees.obligations || [];
    ligne = v.donnees.garanties || null;
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
      secteur_activite: soumission.secteur_activite,
      annee_fondation: soumission.annee_fondation,
      chiffre_affaires: soumission.chiffre_affaires,
      nb_employes: soumission.nb_employes,
      date_effet_souhaitee: soumission.date_effet_souhaitee,
      date_echeance_visee: soumission.date_echeance_visee,
    };
    obligations = soumission.obligations || [];
    ligne = soumission.garanties || null;
    antecedents = soumission.antecedents || null;
    const versions = caut.versionsSoumission(soumission.id, cabinetId);
    versionNumero = versions.length ? versions[0].version : 1;
    versionFigee = false;
    statut = soumission.statut;
    notes = soumission.notes;
    dateEffet = soumission.date_effet_souhaitee;
  }

  obligations = obligations.map(enrichirObligation);
  ligne = enrichirLigne(ligne);
  antecedents = enrichirAntecedents(antecedents);
  entete = {
    ...entete,
    chiffre_affaires_libelle: fmtMontant(entete.chiffre_affaires),
  };

  // Résumé : nombre d'obligations, somme des cautionnements émis et
  // utilisation de la capacité (somme / limite globale).
  const sommeCautionnements = obligations.reduce((somme, o) =>
    somme + (o.montant_cautionnement === null || o.montant_cautionnement === undefined || o.montant_cautionnement === '' ? 0 : Number(o.montant_cautionnement)), 0);
  const typesLibelles = [...new Set(obligations.map((o) => o.type_libelle).filter(Boolean))];
  let utilisationPct = null;
  let utilisation_libelle = '—';
  if (ligne && ligne.limite_globale) {
    utilisationPct = Math.round((sommeCautionnements / Number(ligne.limite_globale)) * 1000) / 10;
    utilisation_libelle = `${utilisationPct.toLocaleString('fr-CA')} % de la limite globale`;
  }
  const resume = {
    nbObligations: obligations.length,
    sommeCautionnements,
    sommeCautionnements_libelle: fmtMontant(sommeCautionnements),
    typesLibelles,
    utilisationPct,
    utilisation_libelle,
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
    obligations,
    ligne,
    antecedents,
    consentementsLibelles,
    mentionMetier: MENTION_METIER,
    fmtMontant,
  };
}

module.exports = {
  preparerPropositionCaut,
  NOMS_TYPES_OBLIGATION,
  NOMS_CONSENTEMENTS,
  MENTION_METIER,
  fmtMontant,
  consentementActif,
};
