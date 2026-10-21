/**
 * lib/classement-courriels.js — Classement intelligent des courriels.
 *
 * À la réception (synchro IMAP) comme à l'envoi, chaque courriel est rattaché
 * automatiquement au bon dossier, dans cet ordre de priorité :
 *   1. numero_police — un numéro de police connu du cabinet repéré dans le
 *      sujet ou le corps (cas typique : un courriel d'assureur — avis, note
 *      de couverture, certificat — dont l'adresse ne correspond à aucun
 *      client). Rattache au client ET à la police précise.
 *   2. fil — le message répond (In-Reply-To) à une demande d'informations
 *      envoyée par le cabinet : il rejoint le client de cette demande.
 *   3. adresse — l'adresse de l'expéditeur (ou du destinataire pour les
 *      envois) correspond à un client ou à un de ses contacts.
 *   4. nom_entreprise — la raison sociale complète d'un client est repérée
 *      dans le sujet ou le corps.
 *
 * Garde-fous :
 *   - Correspondance EXACTE (après normalisation casse/accents/tirets/
 *     espaces) et UNIQUE exigée pour le numéro : un numéro porté par deux
 *     clients différents ne classe rien.
 *   - Si deux méthodes désignent deux clients différents, AUCUN classement
 *     automatique : la correspondance la plus précise est retournée comme
 *     `suggestion` (à valider en un clic par l'utilisateur).
 *   - Cloisonnement strict : seuls les numéros, clients et demandes du
 *     cabinet sont considérés.
 *   - Un lien posé manuellement (classement_methode = 'manuel') n'est
 *     jamais réécrit par le classement automatique.
 *
 * La fonction classerCourriel est PURE (lecture seule) : l'appelant décide
 * d'écrire ou non le résultat.
 */

// --- Liaisons par adresse (historique, déplacé depuis lib/courriels.js) -------
// Cherche l'adresse dans : courriel du contact principal, courriel de
// l'entreprise, puis courriels des contacts additionnels.
function lierClientAuto(bd, cabinetId, adresses) {
  for (const a of adresses || []) {
    const low = String(a).toLowerCase();
    const cli = bd.prepare(
      `SELECT id FROM clients
       WHERE cabinet_id = ? AND archive = 0
         AND (lower(courriel) = ? OR lower(courriel_entreprise) = ?)`
    ).get(cabinetId, low, low);
    if (cli) return cli.id;
    const ct = bd.prepare(
      `SELECT client_id AS id FROM contacts
       WHERE cabinet_id = ? AND archive = 0 AND lower(courriel) = ?`
    ).get(cabinetId, low);
    if (ct) return ct.id;
  }
  return null;
}

// --- Normalisations -------------------------------------------------------------
const LONGUEUR_MIN_NUMERO = 5; // en deçà : fragment trop court/générique
const LONGUEUR_MIN_NOM = 6;    // caractères significatifs d'une raison sociale

function normaliserNumero(valeur) {
  return String(valeur || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normaliserTexte(valeur) {
  return String(valeur || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function extraireAdresses(texte) {
  const trouves = [];
  const re = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  let m;
  const src = String(texte || '');
  while ((m = re.exec(src))) {
    const c = m[1].toLowerCase();
    if (!trouves.includes(c)) trouves.push(c);
  }
  return trouves;
}

// --- Numéros connus du cabinet ----------------------------------------------------
// polices.numero_police (client + police) ; numero_police des en-têtes de
// soumissions qui en portent un (flotte, cautionnement) et des antécédents
// des 9 produits (client seulement, via la soumission parente).
const SOUMISSIONS_NUMERO_POLICE = ['flotte_soumissions', 'caut_soumissions'];
const ANTECEDENTS_NUMERO = [
  ['auto_antecedents', 'auto_soumissions', 'numero_police_actuelle'],
  ['biens_antecedents', 'biens_soumissions', 'numero_police_actuelle'],
  ['rc_antecedents', 'rc_soumissions', 'numero_police_actuelle'],
  ['cyber_antecedents', 'cyber_soumissions', 'numero_police_actuelle'],
  ['eo_antecedents', 'eo_soumissions', 'numero_police_actuelle'],
  ['do_antecedents', 'do_soumissions', 'numero_police_actuelle'],
  ['pe_antecedents', 'pe_soumissions', 'numero_police_actuelle'],
  ['flotte_antecedents', 'flotte_soumissions', 'numero_police_actuelle'],
  ['caut_antecedents', 'caut_soumissions', 'numero_ligne_actuelle'],
];

function chargerNumerosConnus(bd, cabinetId) {
  const carte = new Map(); // normalisé -> [{ clientId, policeId, numero }]
  const ajouter = (numeroBrut, clientId, policeId) => {
    const norm = normaliserNumero(numeroBrut);
    if (norm.length < LONGUEUR_MIN_NUMERO || !clientId) return;
    if (!carte.has(norm)) carte.set(norm, []);
    carte.get(norm).push({ clientId, policeId: policeId || null, numero: String(numeroBrut).trim() });
  };
  for (const p of bd.prepare(
    'SELECT id, client_id, numero_police FROM polices WHERE cabinet_id = ?'
  ).all(cabinetId)) {
    ajouter(p.numero_police, p.client_id, p.id);
  }
  for (const t of SOUMISSIONS_NUMERO_POLICE) {
    for (const s of bd.prepare(
      `SELECT client_id, numero_police FROM ${t} WHERE cabinet_id = ? AND archive = 0`
    ).all(cabinetId)) {
      ajouter(s.numero_police, s.client_id, null);
    }
  }
  for (const [ta, ts, col] of ANTECEDENTS_NUMERO) {
    const lignes = bd.prepare(`
      SELECT s.client_id AS client_id, a.${col} AS numero
      FROM ${ta} a JOIN ${ts} s ON s.id = a.soumission_id
      WHERE a.cabinet_id = ? AND a.archive = 0 AND s.archive = 0
    `).all(cabinetId);
    for (const l of lignes) ajouter(l.numero, l.client_id, null);
  }
  return carte;
}

// Retourne : null (rien), { ambigu: true } (plusieurs clients pour le même
// numéro) ou { clientId, policeId, numero }.
function trouverParNumero(bd, cabinetId, texte) {
  const carte = chargerNumerosConnus(bd, cabinetId);
  if (!carte.size) return null;
  // Candidats : suites alphanumériques (tirets admis) du sujet + corps.
  const candidats = new Set();
  for (const m of String(texte || '').matchAll(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g)) {
    const norm = normaliserNumero(m[0]);
    if (norm.length >= LONGUEUR_MIN_NUMERO) candidats.add(norm);
  }
  // Repli : numéro écrit avec des espaces (« FLT 2026 90001 ») — on cherche
  // alors le numéro connu dans le texte compacté (sans espaces ni tirets).
  const compact = normaliserNumero(texte);
  const correspondances = [];
  const vus = new Set();
  for (const [norm, entrees] of carte) {
    if (!candidats.has(norm) && !compact.includes(norm)) continue;
    for (const e of entrees) {
      const cle = e.clientId + '|' + (e.policeId || '');
      if (!vus.has(cle)) { vus.add(cle); correspondances.push(e); }
    }
  }
  if (!correspondances.length) return null;
  const clientsDistincts = [...new Set(correspondances.map((e) => e.clientId))];
  if (clientsDistincts.length > 1) return { ambigu: true, correspondances };
  const policesDistinctes = [...new Set(correspondances.map((e) => e.policeId).filter(Boolean))];
  const policeId = policesDistinctes.length === 1 ? policesDistinctes[0] : null;
  const entree = correspondances.find((e) => e.policeId && e.policeId === policeId) || correspondances[0];
  return { clientId: clientsDistincts[0], policeId, numero: entree.numero };
}

// --- Fil d'une demande d'informations ----------------------------------------------
function trouverParFil(bd, cabinetId, enReponseA) {
  const brut = String(enReponseA || '').trim();
  if (!brut) return null;
  const nu = brut.replace(/^<|>$/g, '');
  const variantes = [...new Set([brut, nu, '<' + nu + '>'])];
  for (const v of variantes) {
    const d = bd.prepare(
      'SELECT id, client_id, sujet FROM demandes_infos WHERE cabinet_id = ? AND message_id = ? AND archive = 0'
    ).get(cabinetId, v);
    if (d && d.client_id) return { clientId: d.client_id, demandeId: d.id, sujet: d.sujet };
  }
  return null;
}

// --- Nom d'entreprise ------------------------------------------------------------------
function trouverParNom(bd, cabinetId, texteNormalise) {
  const clients = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0'
  ).all(cabinetId);
  const matches = [];
  for (const c of clients) {
    const nomNorm = normaliserTexte(c.raison_sociale);
    if (nomNorm.replace(/ /g, '').length < LONGUEUR_MIN_NOM) continue;
    if (texteNormalise.includes(nomNorm)) {
      matches.push({ clientId: c.id, raisonSociale: c.raison_sociale });
    }
  }
  return matches;
}

// --- Moteur principal (lecture seule) -----------------------------------------------------
function classerCourriel(bd, cabinetId, { sujet, corpsTexte, adressesExpediteur, enReponseA } = {}) {
  const texte = `${sujet || ''}\n${corpsTexte || ''}`;
  const trouvailles = [];

  // 1. Numéro de police — ambigu entre clients : on ne classe rien.
  const parNumero = trouverParNumero(bd, cabinetId, texte);
  if (parNumero && parNumero.ambigu) {
    return { clientId: null, policeId: null, methode: 'aucun', detail: null, suggestion: null, ambigu: true };
  }
  if (parNumero) {
    trouvailles.push({ clientId: parNumero.clientId, policeId: parNumero.policeId, methode: 'numero_police', detail: parNumero.numero, precision: 1 });
  }

  // 2. Fil d'une demande d'informations.
  const parFil = trouverParFil(bd, cabinetId, enReponseA);
  if (parFil) {
    trouvailles.push({ clientId: parFil.clientId, policeId: null, methode: 'fil', detail: parFil.sujet, precision: 2 });
  }

  // 3. Adresse de l'expéditeur (ou du destinataire pour les envois).
  for (const a of adressesExpediteur || []) {
    const cid = lierClientAuto(bd, cabinetId, [a]);
    if (cid) {
      trouvailles.push({ clientId: cid, policeId: null, methode: 'adresse', detail: a, precision: 3 });
      break;
    }
  }

  // 4. Nom d'entreprise repéré en entier (unique exigé).
  const parNom = trouverParNom(bd, cabinetId, normaliserTexte(texte));
  if (parNom.length === 1) {
    trouvailles.push({ clientId: parNom[0].clientId, policeId: null, methode: 'nom_entreprise', detail: parNom[0].raisonSociale, precision: 4 });
  }

  if (!trouvailles.length) {
    return { clientId: null, policeId: null, methode: 'aucun', detail: null, suggestion: null };
  }
  trouvailles.sort((x, y) => x.precision - y.precision);
  const clientsDistincts = new Set(trouvailles.map((t) => t.clientId));
  if (clientsDistincts.size > 1) {
    // Conflit entre méthodes : aucun classement, on suggère la plus précise.
    const s = trouvailles[0];
    return {
      clientId: null, policeId: null, methode: 'aucun', detail: null,
      suggestion: { clientId: s.clientId, policeId: s.policeId, methode: s.methode, detail: s.detail },
    };
  }
  const t = trouvailles[0];
  return { clientId: t.clientId, policeId: t.policeId, methode: t.methode, detail: t.detail, suggestion: null };
}

// --- Reclassement en lot des courriels non classés -----------------------------------------
// Applique uniquement les classements non ambigus ; ne touche jamais un lien
// manuel ni un courriel déjà lié. Retourne les compteurs du lot.
function reclasserNonClasses(bd, cabinetId) {
  const lignes = bd.prepare(`
    SELECT * FROM courriels
    WHERE cabinet_id = ? AND client_id IS NULL AND archive = 0
      AND (classement_methode IS NULL OR classement_methode <> 'manuel')
    ORDER BY id
  `).all(cabinetId);
  const maj = bd.prepare(`
    UPDATE courriels SET client_id = ?, police_id = ?, classement_methode = ?, classement_detail = ?
    WHERE id = ? AND client_id IS NULL
  `);
  let classes = 0, suggestions = 0, sansCorrespondance = 0;
  for (const c of lignes) {
    const adresses = c.dossier === 'envoyes'
      ? extraireAdresses(c.destinataires)
      : extraireAdresses(c.expediteur);
    const r = classerCourriel(bd, cabinetId, {
      sujet: c.sujet, corpsTexte: c.corps_texte,
      adressesExpediteur: adresses, enReponseA: c.en_reponse_a,
    });
    if (r.clientId) {
      maj.run(r.clientId, r.policeId, r.methode, r.detail, c.id);
      classes++;
    } else if (r.suggestion) {
      suggestions++;
    } else {
      sansCorrespondance++;
    }
  }
  return { total: lignes.length, classes, suggestions, sansCorrespondance };
}

// --- Affichage : badges et libellés -----------------------------------------------------------
const NOMS_METHODES_CLASSEMENT = {
  fil: 'Fil de réponse (demande d’informations)',
  numero_police: 'Numéro de police repéré',
  adresse: 'Adresse de l’expéditeur connue',
  nom_entreprise: 'Nom d’entreprise repéré dans le texte',
  manuel: 'Lien manuel',
  aucun: 'Non classé',
};

function badgeClassement(c) {
  if (!c || !c.client_id) return null;
  switch (c.classement_methode) {
    case 'numero_police': return '🔗 N° de police ' + (c.classement_detail || '');
    case 'fil': return '🧵 Fil de réponse';
    case 'adresse': return '✉️ Adresse connue';
    case 'nom_entreprise': return '🏢 Nom d’entreprise';
    case 'manuel': return '✋ Manuel';
    default: return null;
  }
}

module.exports = {
  lierClientAuto,
  normaliserNumero,
  normaliserTexte,
  extraireAdresses,
  chargerNumerosConnus,
  classerCourriel,
  reclasserNonClasses,
  badgeClassement,
  NOMS_METHODES_CLASSEMENT,
};
