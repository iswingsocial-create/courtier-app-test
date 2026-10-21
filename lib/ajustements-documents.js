/**
 * lib/ajustements-documents.js — Logique pure des ajustements issus de
 * l'inventaire des documents réels (2026-10-21) :
 *  - échéancier d'amortissement d'un financement de prime (calendrier de
 *    prélèvements de l'assureur / du grossiste) ;
 *  - validation des parts des assureurs participants (souscription
 *    partagée : la somme par section doit faire 100 %) ;
 *  - prochain prélèvement à venir (suivis sans faute) ;
 *  - calcul du revenu d'entreprise de la feuille de calcul PE.
 * Aucune dépendance à la base : tout est testable unitairement.
 */

const MODES_FACTURATION = {
  perception_assure: 'Perception assuré (l’assureur perçoit la prime)',
  facturation_agence: 'Facturation agence (le cabinet perçoit la prime)',
  directe: 'Facturation directe au client',
};

const SECTIONS_PARTICIPANTS = ['Biens', 'Bris d’équipement', 'Vol', 'Responsabilité', 'Autre'];

function arr2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function ajouterMois(dateISO, n) {
  const d = new Date(dateISO + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function joursEntre(debutISO, finISO) {
  const a = new Date(debutISO + 'T00:00:00');
  const b = new Date(finISO + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

/**
 * Génère l'échéancier d'amortissement d'un financement de prime, selon
 * le modèle du calendrier réel de l'assureur : acompte initial, puis
 * des versements mensuels égaux ; l'intérêt de chaque période est
 * calculé sur le solde d'ouverture au taux annuel, au prorata des
 * jours réels (jours/365) — vérifié ligne par ligne contre un
 * calendrier réel (écart ≤ 0,01 $ par ligne). Le dernier versement
 * solde le prêt.
 * @param {object} f { taux_annuel (%), montant_finance, nb_versements,
 *   montant_versement, premiere_date, date_debut (début du financement ;
 *   par défaut un mois avant le premier versement) }
 * @returns {Array<{numero, date, solde_ouverture, paiement, interet,
 *   capital, interets_cumulatifs, solde}>}
 */
function genererEcheancier(f) {
  const taux = Number(f.taux_annuel || 0) / 100;
  const nb = Number(f.nb_versements || 0);
  let solde = arr2(f.montant_finance || 0);
  const versement = arr2(f.montant_versement || 0);
  const lignes = [];
  let cumule = 0;
  let datePrecedente = f.date_debut
    || (f.premiere_date ? ajouterMois(f.premiere_date, -1) : null);
  for (let i = 1; i <= nb; i++) {
    const date = f.premiere_date ? ajouterMois(f.premiere_date, i - 1) : null;
    const jours = datePrecedente && date ? joursEntre(datePrecedente, date) : 30;
    const interet = arr2(solde * taux * (jours / 365));
    let paiement = versement;
    let capital = arr2(paiement - interet);
    if (i === nb || capital >= solde) {
      capital = solde;
      paiement = arr2(capital + interet);
    }
    cumule = arr2(cumule + interet);
    const nouveauSolde = arr2(solde - capital);
    lignes.push({
      numero: i,
      date,
      solde_ouverture: solde,
      paiement,
      interet,
      capital,
      interets_cumulatifs: cumule,
      solde: nouveauSolde,
    });
    solde = nouveauSolde;
    datePrecedente = date;
    if (solde <= 0) break;
  }
  return lignes;
}

/**
 * Prochain prélèvement à venir d'un financement : première ligne de
 * l'échéancier dont l'index n'est pas marqué payé et dont la date est
 * la plus proche (échue ou à venir). Retourne null si tout est payé.
 */
function prochainPrelevement(f, aujourdhuiISO) {
  const payes = new Set((f.versements_payes || []).map(Number));
  const lignes = genererEcheancier(f);
  for (const l of lignes) {
    if (!payes.has(l.numero)) {
      return { ...l, en_retard: l.date ? l.date < aujourdhuiISO : false };
    }
  }
  return null;
}

/**
 * Valide les parts des participants d'une police : regroupe par
 * section, somme les parts, et signale toute section dont le total
 * s'écarte de 100 % (tolérance 0,05 point).
 * @returns {{sections: {section: total}, erreurs: string[], valide: boolean}}
 */
function validerParticipants(participants) {
  const sections = {};
  for (const p of participants || []) {
    if (p.archive) continue;
    const cle = p.section || 'Ensemble de la police';
    sections[cle] = arr2((sections[cle] || 0) + Number(p.part_pct || 0));
  }
  const erreurs = [];
  for (const [section, total] of Object.entries(sections)) {
    if (Math.abs(total - 100) > 0.05) {
      erreurs.push(`Section « ${section} » : les parts totalisent ${total} % au lieu de 100 %.`);
    }
  }
  return { sections, erreurs, valide: erreurs.length === 0 };
}

/**
 * Revenu d'entreprise (ligne F) de la feuille de calcul PE d'un
 * formulaire de MAJ assureur : recettes des 12 prochains mois (A2) +
 * autres revenus (B) − dépenses variables (D). Les salaires ordinaires
 * (E et G) sont déclarés à part : ils restent dans le revenu assuré
 * selon la formule choisie, ils ne sont pas soustraits ici.
 */
function calculerRevenuEntreprise(calcul) {
  const d = (calcul.depenses_variables || []).reduce((s, l) => s + Number(l.montant || 0), 0);
  return arr2(Number(calcul.recettes_a2 || 0) + Number(calcul.autres_revenus_b || 0) - d);
}

module.exports = {
  MODES_FACTURATION,
  SECTIONS_PARTICIPANTS,
  arr2,
  ajouterMois,
  genererEcheancier,
  prochainPrelevement,
  validerParticipants,
  calculerRevenuEntreprise,
};
