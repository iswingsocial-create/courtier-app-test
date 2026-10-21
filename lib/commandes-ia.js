/**
 * lib/commandes-ia.js — Commandes en langage naturel (étape 8/10).
 *
 * L'utilisateur pilote l'application au texte (et à l'étape 9, à la voix) :
 * « ajoute un conducteur Marie Tremblay permis T1234567 à la soumission 1 ».
 *
 * Deux moteurs :
 *   - « local » (défaut, tests) : analyseur à règles en français (regex +
 *     synonymes). Aucun appel externe, aucune clé requise.
 *   - « cohere » : Cohere (données au Canada) reformule la demande en commande
 *     JSON structurée (schéma strict), exécutée par les mêmes fonctions validées.
 *
 * Actions :
 *   - ajouter_conducteur, ajouter_vehicule, modifier_garantie : modifications
 *     FPQ1 → TOUJOURS via lib/fpq1.js (versionnage, règle d'or) et TOUJOURS
 *     avec confirmation explicite avant exécution.
 *   - ajouter_batiment, ajouter_contenu, modifier_garantie_biens : modifications
 *     biens → TOUJOURS via lib/biens.js, confirmation explicite.
 *   - ajouter_lieu_rc, modifier_garanties_rc : modifications RC → TOUJOURS via
 *     lib/rc.js (versionnage, règle d'or), confirmation explicite.
 *   - ajouter_mesure_cyber, modifier_garanties_cyber, modifier_maturite_mesure :
 *     modifications cyber → TOUJOURS via lib/cyber.js (versionnage, règle d'or),
 *     confirmation explicite.
 *   - ajouter_activite_eo, modifier_garanties_eo, modifier_activite_eo :
 *     modifications E&O → TOUJOURS via lib/eo.js (versionnage, règle d'or),
 *     confirmation explicite.
 *   - ajouter_dirigeant_do, modifier_garanties_do, modifier_dirigeant_do :
 *     modifications D&O → TOUJOURS via lib/do.js (versionnage, règle d'or),
 *     confirmation explicite.
 *   - ajouter_etablissement_pe, modifier_garanties_pe, modifier_etablissement_pe :
 *     modifications perte d'exploitation → TOUJOURS via lib/pe.js (versionnage,
 *     règle d'or), confirmation explicite.
 *   - ajouter_vehicule_flotte, modifier_garanties_flotte, modifier_vehicule_flotte,
 *     ajouter_conducteur_flotte : modifications flotte automobile → TOUJOURS via
 *     lib/flotte.js (versionnage, règle d'or), confirmation explicite. Le marqueur
 *     « flotte » est OBLIGATOIRE : « véhicule » et « conducteur » sont partagés
 *     avec le FPQ1 (auto personnelle) — gardes anti-collision bidirectionnelles.
 *   - ajouter_obligation_caut, modifier_ligne_caut, modifier_obligation_caut :
 *     modifications cautionnement → TOUJOURS via lib/cautionnement.js
 *     (versionnage, règle d'or), confirmation explicite. Le marqueur
 *     « cautionnement »/« caution » est OBLIGATOIRE : le mot « soumission » seul
 *     désigne la référence courte FPQ1/flotte — gardes anti-collision
 *     bidirectionnelles avec les 7 autres produits.
 *   - creer_rappel : délégué à l'exécuteur « creer_tache » validé de
 *     lib/assistant.js (une tâche avec échéance = un rappel).
 *   - aller_a, rechercher : lecture seule, exécution immédiate.
 *
 * Sécurité : chaque exécution revérifie le cabinet (cabinet_id) et le
 * portefeuille du courtier ; toute commande est inscrite au journal d'audit
 * (action « commande_ia ») par l'appelant.
 */
const bd = require('./bd');
const fpq1 = require('./fpq1');
const biens = require('./biens');
const rc = require('./rc');
const cyber = require('./cyber');
const eo = require('./eo');
const doLib = require('./do');
const pe = require('./pe');
const flotte = require('./flotte');
const caut = require('./cautionnement');
const { clientHorsPortefeuille } = require('./middleware');
const DICT = require('./dictionnaire-champs.json');

// --- Dictionnaire : noms de colonnes connus (validation des champs) ------------------------------
const COLONNES = {};
for (const t of (DICT.tables || [])) {
  COLONNES[t.nom] = new Set((t.colonnes || []).map((c) => c.nom));
}
function colonnesConnues(table) { return COLONNES[table] || new Set(); }

// Accès paresseux aux utilitaires de lib/assistant.js (évite tout cycle au chargement).
function utilAssistant() { return require('./assistant'); }

// --- Résolution : soumission ----------------------------------------------------------------------
function resoudreSoumission(cabinetId, utilisateur, ref) {
  const { trouverClient } = utilAssistant();
  let s = null;
  if (ref.id) {
    s = fpq1.obtenirSoumission(Number(ref.id), cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission #${ref.id}` };
  } else if (ref.client) {
    const rc = trouverClient(cabinetId, ref.client);
    if (rc.statut !== 'ok') return { statut: 'client', detail: rc };
    const liste = bd.prepare(`
      SELECT id FROM auto_soumissions WHERE cabinet_id = ? AND client_id = ? AND archive = 0 ORDER BY id DESC
    `).all(cabinetId, rc.client.id);
    if (!liste.length) return { statut: 'aucune', client: rc.client.raison_sociale };
    if (liste.length > 1) {
      return { statut: 'ambigue', ids: liste.map((l) => l.id), client: rc.client.raison_sociale };
    }
    s = fpq1.obtenirSoumission(liste[0].id, cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission #${liste[0].id}` };
  } else {
    return { statut: 'manque' };
  }
  if (utilisateur && utilisateur.role === 'courtier'
    && clientHorsPortefeuille(cabinetId, utilisateur, s.client_id)) {
    return { statut: 'hors_portefeuille' };
  }
  return { statut: 'ok', soumission: s };
}

function nomClientSoumission(s) {
  const c = s.client_id
    ? bd.prepare('SELECT raison_sociale FROM clients WHERE id = ?').get(s.client_id)
    : null;
  return c ? c.raison_sociale : 'sans entreprise';
}

function messageErreurSoumission(r) {
  const { trouverClient } = utilAssistant();
  switch (r.statut) {
    case 'introuvable':
      return `Je n'ai pas trouvé la ${r.recherche}. Vérifiez le numéro dans l'onglet Auto.`;
    case 'manque':
      return 'Pour quelle soumission ? Précisez « à la soumission 1 » ou « à la soumission de Dubois ».';
    case 'aucune':
      return `Aucune soumission auto active pour ${r.client}. Créez-la d'abord dans l'onglet Auto.`;
    case 'ambigue':
      return `Plusieurs soumissions actives pour ${r.client} : ${r.ids.map((i) => '#' + i).join(', ')}. Précisez le numéro, s'il vous plaît.`;
    case 'hors_portefeuille':
      return "Cette soumission n'est pas dans votre portefeuille. Je ne peux pas la modifier.";
    case 'client': {
      const d = r.detail;
      if (d.statut === 'ambigu') {
        return `Plusieurs entreprises correspondent : ${d.options.join(' · ')}. Précisez le nom exact, s'il vous plaît.`;
      }
      return `Je n'ai pas trouvé l'entreprise « ${d.recherche || '?'} ».`;
    }
    default:
      return 'Soumission introuvable.';
  }
}

// --- Résolution : soumission biens (étape 8/10 biens) -----------------------------------------------
function resoudreSoumissionBiens(cabinetId, utilisateur, ref) {
  const { trouverClient } = utilAssistant();
  let s = null;
  if (ref.id) {
    s = biens.obtenirSoumission(Number(ref.id), cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission biens #${ref.id}` };
  } else if (ref.client) {
    const rc = trouverClient(cabinetId, ref.client);
    if (rc.statut !== 'ok') return { statut: 'client', detail: rc };
    const liste = bd.prepare(`
      SELECT id FROM biens_soumissions WHERE cabinet_id = ? AND client_id = ? AND archive = 0 ORDER BY id DESC
    `).all(cabinetId, rc.client.id);
    if (!liste.length) return { statut: 'aucune', client: rc.client.raison_sociale };
    if (liste.length > 1) {
      return { statut: 'ambigue', ids: liste.map((l) => l.id), client: rc.client.raison_sociale };
    }
    s = biens.obtenirSoumission(liste[0].id, cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission biens #${liste[0].id}` };
  } else {
    return { statut: 'manque' };
  }
  if (utilisateur && utilisateur.role === 'courtier'
    && clientHorsPortefeuille(cabinetId, utilisateur, s.client_id)) {
    return { statut: 'hors_portefeuille' };
  }
  return { statut: 'ok', soumission: s };
}

function messageErreurSoumissionBiens(r) {
  switch (r.statut) {
    case 'introuvable':
      return `Je n'ai pas trouvé la ${r.recherche}. Vérifiez le numéro dans l'onglet Biens.`;
    case 'manque':
      return 'Pour quelle soumission ? Précisez « à la soumission biens 1 » ou « à la soumission biens de Méthot ».';
    case 'aucune':
      return `Aucune soumission biens active pour ${r.client}. Créez-la d'abord dans l'onglet Biens.`;
    case 'ambigue':
      return `Plusieurs soumissions biens actives pour ${r.client} : ${r.ids.map((i) => '#' + i).join(', ')}. Précisez le numéro, s'il vous plaît.`;
    case 'hors_portefeuille':
      return "Cette soumission biens n'est pas dans votre portefeuille. Je ne peux pas la modifier.";
    case 'client': {
      const d = r.detail;
      if (d.statut === 'ambigu') {
        return `Plusieurs entreprises correspondent : ${d.options.join(' · ')}. Précisez le nom exact, s'il vous plaît.`;
      }
      return `Je n'ai pas trouvé l'entreprise « ${d.recherche || '?'} ».`;
    }
    default:
      return 'Soumission biens introuvable.';
  }
}

// --- Résolution : bâtiment dans une soumission biens ----------------------------------------------
function resoudreBatiment(soumission, ref) {
  const bs = (soumission.batiments || []).filter((b) => !b.archive);
  if (!bs.length) return { statut: 'aucun' };
  if (ref.index) {
    const b = bs[ref.index - 1];
    return b ? { statut: 'ok', batiment: b } : { statut: 'introuvable' };
  }
  if (ref.recherche) {
    const r = ref.recherche.toLowerCase();
    const trouves = bs.filter((x) => `${x.adresse || ''} ${x.ville || ''}`.toLowerCase().includes(r));
    if (trouves.length === 1) return { statut: 'ok', batiment: trouves[0] };
    if (trouves.length > 1) return { statut: 'ambigu', batiments: trouves };
    return { statut: 'introuvable' };
  }
  return { statut: 'manque' };
}

function libelleBatiment(b) {
  return (b.adresse || '').trim() || `bâtiment #${b.id}`;
}

// --- Résolution : soumission RC (étape 8/10 RC) -------------------------------------------------------
function resoudreSoumissionRC(cabinetId, utilisateur, ref) {
  const { trouverClient } = utilAssistant();
  let s = null;
  if (ref.id) {
    s = rc.obtenirSoumission(Number(ref.id), cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission RC #${ref.id}` };
  } else if (ref.client) {
    const rcc = trouverClient(cabinetId, ref.client);
    if (rcc.statut !== 'ok') return { statut: 'client', detail: rcc };
    const liste = bd.prepare(`
      SELECT id FROM rc_soumissions WHERE cabinet_id = ? AND client_id = ? AND archive = 0 ORDER BY id DESC
    `).all(cabinetId, rcc.client.id);
    if (!liste.length) return { statut: 'aucune', client: rcc.client.raison_sociale };
    if (liste.length > 1) {
      return { statut: 'ambigue', ids: liste.map((l) => l.id), client: rcc.client.raison_sociale };
    }
    s = rc.obtenirSoumission(liste[0].id, cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission RC #${liste[0].id}` };
  } else {
    return { statut: 'manque' };
  }
  if (utilisateur && utilisateur.role === 'courtier'
    && clientHorsPortefeuille(cabinetId, utilisateur, s.client_id)) {
    return { statut: 'hors_portefeuille' };
  }
  return { statut: 'ok', soumission: s };
}

function messageErreurSoumissionRC(r) {
  switch (r.statut) {
    case 'introuvable':
      return `Je n'ai pas trouvé la ${r.recherche}. Vérifiez le numéro dans l'onglet RC.`;
    case 'manque':
      return 'Pour quelle soumission ? Précisez « à la soumission RC 1 » ou « à la soumission RC de Méthot ».';
    case 'aucune':
      return `Aucune soumission RC active pour ${r.client}. Créez-la d'abord dans l'onglet RC.`;
    case 'ambigue':
      return `Plusieurs soumissions RC actives pour ${r.client} : ${r.ids.map((i) => '#' + i).join(', ')}. Précisez le numéro, s'il vous plaît.`;
    case 'hors_portefeuille':
      return "Cette soumission RC n'est pas dans votre portefeuille. Je ne peux pas la modifier.";
    case 'client': {
      const d = r.detail;
      if (d.statut === 'ambigu') {
        return `Plusieurs entreprises correspondent : ${d.options.join(' · ')}. Précisez le nom exact, s'il vous plaît.`;
      }
      return `Je n'ai pas trouvé l'entreprise « ${d.recherche || '?'} ».`;
    }
    default:
      return 'Soumission RC introuvable.';
  }
}

// --- Résolution : lieu d'exploitation dans une soumission RC -------------------------------------
function resoudreExploitation(soumission, ref) {
  const es = (soumission.exploitations || []).filter((e) => !e.archive);
  if (!es.length) return { statut: 'aucun' };
  if (ref.index) {
    const e = es[ref.index - 1];
    return e ? { statut: 'ok', exploitation: e } : { statut: 'introuvable' };
  }
  if (ref.recherche) {
    const r = ref.recherche.toLowerCase();
    const trouves = es.filter((x) => `${x.adresse || ''} ${x.ville || ''} ${x.type_activite || ''}`.toLowerCase().includes(r));
    if (trouves.length === 1) return { statut: 'ok', exploitation: trouves[0] };
    if (trouves.length > 1) return { statut: 'ambigu', exploitations: trouves };
    return { statut: 'introuvable' };
  }
  return { statut: 'manque' };
}

function libelleExploitation(e) {
  return (e.adresse || '').trim() || `lieu #${e.id}`;
}

// --- Résolution : véhicule dans une soumission ----------------------------------------------------
function resoudreVehicule(soumission, ref) {
  const vs = (soumission.vehicules || []).filter((v) => !v.archive);
  if (!vs.length) return { statut: 'aucun' };
  if (ref.index) {
    const v = vs[ref.index - 1];
    return v ? { statut: 'ok', vehicule: v } : { statut: 'introuvable' };
  }
  if (ref.vin) {
    const vin = String(ref.vin).toUpperCase().replace(/\s+/g, '');
    const v = vs.find((x) => String(x.vin || '').toUpperCase().replace(/\s+/g, '') === vin);
    return v ? { statut: 'ok', vehicule: v } : { statut: 'introuvable' };
  }
  if (ref.recherche) {
    const r = ref.recherche.toLowerCase();
    const trouves = vs.filter((x) => `${x.marque || ''} ${x.modele || ''}`.toLowerCase().includes(r));
    if (trouves.length === 1) return { statut: 'ok', vehicule: trouves[0] };
    if (trouves.length > 1) return { statut: 'ambigu', vehicules: trouves };
    return { statut: 'introuvable' };
  }
  return { statut: 'manque' };
}

function libelleVehicule(v) {
  return `${v.annee || ''} ${v.marque || ''} ${v.modele || ''}`.trim() || `véhicule #${v.id}`;
}

// --- Analyseur local (français, sans clé) ----------------------------------------------------------
function extraireRefSoumission(texte) {
  // Référence explicite FPQ1 : « à la soumission auto 1 », « à la soumission
  // automobile de Dubois » (étape 8 flotte : distingue l'auto personnelle de
  // la « soumission flotte automobile », captée par MARQUEUR_FLOTTE avant).
  let m = texte.match(/(?:^|\s+)(?:à|dans|sur|de)\s+(?:la\s+)?soumission\s+(?:auto|automobile)\s+(?:n[°o]\s*|#\s*)?(\d+)\s*$/i);
  if (m) return { ref: { id: Number(m[1]) }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(/(?:^|\s+)(?:à|dans|sur|de)\s+(?:la\s+)?soumission\s+(?:auto|automobile)\s+de\s+(.+?)\s*$/i);
  if (m) return { ref: { client: m[1].trim() }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(/(?:^|\s+)(?:à|dans|sur|de)\s+(?:la\s+)?soumission\s+(?:n[°o]\s*|#\s*)?(\d+)\s*$/i);
  if (m) return { ref: { id: Number(m[1]) }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(/(?:^|\s+)(?:à|dans|sur|de)\s+(?:la\s+)?soumission\s+de\s+(.+?)\s*$/i);
  if (m) return { ref: { client: m[1].trim() }, reste: texte.slice(0, m.index).trim() };
  return { ref: null, reste: texte };
}

function analyserAjouterConducteur(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:un\s+|une\s+|le\s+|la\s+)?conducteurs?\s+(.+)$/i);
  if (!m) return null;
  // « conducteur » est partagé avec la flotte : le marqueur flotte gagne.
  if (MARQUEUR_FLOTTE.test(t)) return null;
  if (MARQUEUR_CAUT.test(t)) return null;
  const { ref, reste } = extraireRefSoumission(m[1]);
  let partie = reste;
  let numeroPermis = null;
  const mp = partie.match(/\s+permis\s*(?:de\s+conduire\s*)?(?:n[°o]\s*)?([A-Za-z0-9][A-Za-z0-9\-]{2,})\s*$/i);
  if (mp) { numeroPermis = mp[1].toUpperCase(); partie = partie.slice(0, mp.index).trim(); }
  partie = partie.replace(/[,;.]+$/, '').trim();
  const morceaux = partie.split(/\s+/).filter(Boolean);
  const prenom = morceaux[0] || null;
  const nom = morceaux.slice(1).join(' ') || null;
  return {
    action: 'ajouter_conducteur',
    params: {
      soumission_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      prenom, nom, numero_permis: numeroPermis,
    },
  };
}

function analyserAjouterVehicule(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:un\s+|une\s+|le\s+|la\s+)?v[ée]hicules?\s+(.+)$/i);
  if (!m) return null;
  // « véhicule » est partagé avec la flotte : le marqueur flotte gagne.
  if (MARQUEUR_FLOTTE.test(t)) return null;
  if (MARQUEUR_CAUT.test(t)) return null;
  const { ref, reste } = extraireRefSoumission(m[1]);
  let partie = ` ${reste} `;
  let vin = null;
  let mv = partie.match(/\bvin\s*[:\-]?\s*([A-HJ-NPR-Z0-9]{9,20})\b/i)
    || partie.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (mv) { vin = mv[1].toUpperCase(); partie = partie.replace(mv[0], ' '); }
  let annee = null;
  const ma = partie.match(/\b(19\d{2}|20\d{2})\b/);
  if (ma) { annee = Number(ma[1]); partie = partie.replace(ma[0], ' '); }
  const morceaux = partie.replace(/[,;.]+/g, ' ').split(/\s+/).filter(Boolean);
  const marque = morceaux[0] || null;
  const modele = morceaux.slice(1).join(' ') || null;
  return {
    action: 'ajouter_vehicule',
    params: {
      soumission_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      annee, marque, modele, vin,
    },
  };
}

const RC_ALIAS = [
  [/2\s*millions?|2\s*m\b/, 2000000],
  [/1\s*millions?|1\s*m\b/, 1000000],
  [/50\s*000|50000/, 50000],
];
const B_ALIAS = [
  [/tous\s+risques\s+sauf\s+collision/i, 'b3'],
  [/tous\s+risques/i, 'b1'],
  [/\bcollision\b/i, 'b2'],
  [/risques?\s+sp[ée]cifi[ée]s?/i, 'b4'],
  [/\bb\s*1\b/i, 'b1'], [/\bb\s*2\b/i, 'b2'], [/\bb\s*3\b/i, 'b3'], [/\bb\s*4\b/i, 'b4'],
  [/\baucune\b/i, 'aucune'],
];

function analyserModifierGarantie(t) {
  // Les garanties flotte (limite RC, franchises, FAQ) ne sont pas des garanties FPQ1.
  if (MARQUEUR_FLOTTE.test(t)) return null;
  if (MARQUEUR_CAUT.test(t)) return null;
  if (!/\b(?:rc|responsabilit[ée]\s+civile|franchise|protection\s*b|garanties?)\b/i.test(t)) return null;
  if (!/\bv[ée]hicule\b/i.test(t) && !/\b[A-HJ-NPR-Z0-9]{17}\b/.test(t)) return null;
  const params = { soumission_id: null, soumission_client: null };
  const { ref, reste } = extraireRefSoumission(t);
  if (ref) { params.soumission_id = ref.id || null; params.soumission_client = ref.client || null; }
  let mv = reste.match(/\bv[ée]hicule\s+(?:n[°o]\s*|#\s*)?(\d+)/i);
  if (mv) {
    params.vehicule_index = Number(mv[1]);
  } else {
    mv = reste.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (mv) params.vehicule_vin = mv[1].toUpperCase();
    else {
      mv = reste.match(/(?:pour|sur|du|de)\s+(?:le\s+|la\s+)?([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 '\-]{1,40}?)(?:\s+(?:de|de\s+la|sur)\s+(?:la\s+)?soumission|\s*$)/i);
      if (mv && !/soumission/i.test(mv[1])) params.vehicule_recherche = mv[1].trim();
    }
  }
  const mrc = t.match(/(?:\brc\b|responsabilit[ée]\s+civile)\s*(?:à|de|=|:)?\s*([0-9][0-9\s]*m(?:illions?)?|[0-9][0-9\s]*)/i);
  if (mrc) {
    for (const [re, val] of RC_ALIAS) {
      if (re.test(mrc[1])) { params.rc_montant = val; break; }
    }
    if (params.rc_montant === undefined) {
      const n = Number(mrc[1].replace(/\s+/g, ''));
      if (!isNaN(n) && n > 0) params.rc_montant = n;
    }
  }
  const mb = t.match(/protection\s*b\s*(?:à|=|:)?\s*([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 \-]*)/i);
  if (mb) {
    for (const [re, val] of B_ALIAS) {
      if (re.test(mb[1])) { params.protection_b = val; break; }
    }
  }
  const mf = t.match(/franchise(?:\s*b)?\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mf) params.franchise_b = Number(mf[1].replace(/\s+/g, ''));
  if (params.rc_montant === undefined && !params.protection_b && params.franchise_b === undefined) return null;
  return { action: 'modifier_garantie', params };
}

// --- Biens commerciaux (étape 8/10 biens) ------------------------------------------------------------
function extraireRefSoumissionBiens(texte) {
  // « à la soumission biens 1 », « à la soumission biens de Méthot »
  let m = texte.match(/(?:^|\s+)(?:à|dans|sur|de)\s+(?:la\s+)?soumission\s+biens?\s+(?:n[°o]\s*|#\s*)?(\d+)\s*$/i);
  if (m) return { ref: { id: Number(m[1]) }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(/(?:^|\s+)(?:à|dans|sur|de)\s+(?:la\s+)?soumission\s+biens?\s+de\s+(.+?)\s*$/i);
  if (m) return { ref: { client: m[1].trim() }, reste: texte.slice(0, m.index).trim() };
  // L'action est intrinsèquement « biens » : « à la soumission 1 » vise une soumission biens.
  return extraireRefSoumission(texte);
}

const MOTS_CLES_BIENS = 'construction|ann[ée]e|superficie|occupation|valeur|ville';

// Valeurs fermées en base (CHECK) : on normalise le français dicté/écrit.
const TYPES_CONSTRUCTION = ['bois', 'acier', 'beton', 'maconnerie', 'mixte'];
const TYPES_CONSTRUCTION_LIBELLES = { bois: 'bois', acier: 'acier', beton: 'béton', maconnerie: 'maçonnerie', mixte: 'mixte' };
const TYPES_CONSTRUCTION_ALIAS = [
  [/b[ée]ton/, 'beton'],
  [/acier/, 'acier'],
  [/\bbois\b/, 'bois'],
  [/ma[çc]onnerie/, 'maconnerie'],
  [/mixte/, 'mixte'],
];
function normaliserTypeConstruction(v) {
  if (!v) return null;
  const t = String(v).toLowerCase().trim();
  if (TYPES_CONSTRUCTION.includes(t)) return t;
  for (const [re, val] of TYPES_CONSTRUCTION_ALIAS) {
    if (re.test(t)) return val;
  }
  return null;
}

function prendreChampBiens(partie, noms, reValeur) {
  // Le « de » est optionnel (« superficie de 12000 », dictée vocale) et la
  // valeur peut être suivie d'une virgule (« superficie 12000, occupation… »).
  const re = new RegExp(`\\b(?:${noms})(?:\\s+de)?\\s*[:=]?\\s*(${reValeur})(?=\\s+\\b(?:${MOTS_CLES_BIENS})\\b|\\s*[,;.]|\\s*$)`, 'i');
  const mm = partie.match(re);
  if (mm) return { val: mm[1].trim(), partie: partie.replace(mm[0], ' ') };
  return { val: null, partie };
}

const TEXTE_BIENS = `[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '\\-]{0,30}`;

function analyserAjouterBatiment(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:un\s+|une\s+|le\s+|la\s+)?b[âa]timents?\s+(.+)$/i);
  if (!m) return null;
  // Une soumission d'un autre produit explicite → pas une commande biens.
  if (/\bcyber\b|\be\s*[&/]\s*o\b|\bd\s*[&/\-]\s*o\b/i.test(t) || MARQUEUR_PE.test(t) || MARQUEUR_FLOTTE.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionBiens(m[1]);
  let partie = ` ${reste} `;
  let c = prendreChampBiens(partie, 'ville', TEXTE_BIENS);
  const villeKw = c.val; partie = c.partie;
  c = prendreChampBiens(partie, 'construction', TEXTE_BIENS);
  const typeConstructionBrut = c.val; partie = c.partie;
  c = prendreChampBiens(partie, 'ann[ée]e(?:\\s+de\\s+construction)?', '19\\d{2}|20\\d{2}');
  const anneeConstruction = c.val ? Number(c.val) : null; partie = c.partie;
  c = prendreChampBiens(partie, 'superficie', '\\d[\\d\\s]*');
  const superficiePi2 = c.val ? Number(c.val.replace(/\s+/g, '')) : null; partie = c.partie;
  c = prendreChampBiens(partie, 'occupation', TEXTE_BIENS);
  const occupation = c.val; partie = c.partie;
  c = prendreChampBiens(partie, 'valeur', '\\d[\\d\\s]*');
  const valeurBatiment = c.val ? Number(c.val.replace(/\s+/g, '')) : null; partie = c.partie;
  // Adresse : ce qui reste ; « 123 rue Principale à Montréal » → adresse + ville.
  let adresse = partie.replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim();
  adresse = adresse.replace(/^(?:au|à|a|du|de|le|la)\s+/i, '').trim();
  let ville = villeKw;
  const mad = adresse.match(/^(.+?)\s+[àa]\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '\-]{1,30})$/);
  if (mad && (!ville || mad[2].trim().toLowerCase() === ville.toLowerCase())) {
    adresse = mad[1].trim();
    if (!ville) ville = mad[2].trim();
  }
  return {
    action: 'ajouter_batiment',
    params: {
      soumission_biens_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      adresse: adresse || null, ville: ville || null,
      type_construction: normaliserTypeConstruction(typeConstructionBrut),
      type_construction_texte: typeConstructionBrut || null,
      annee_construction: anneeConstruction,
      superficie_pi2: superficiePi2, occupation, valeur_batiment: valeurBatiment,
    },
  };
}

function analyserAjouterContenu(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:un\s+|une\s+|le\s+|la\s+)?contenus?\s+(.+)$/i);
  if (!m) return null;
  // Une soumission d'un autre produit explicite → pas une commande biens.
  if (/\bcyber\b|\be\s*[&/]\s*o\b|\bd\s*[&/\-]\s*o\b/i.test(t) || MARQUEUR_PE.test(t) || MARQUEUR_FLOTTE.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionBiens(m[1]);
  let partie = ` ${reste} `;
  let batimentIndex = null;
  const mb = partie.match(/\s+(?:au|à|a|du|de|pour|sur)\s+(?:le\s+)?b[âa]timent\s+(?:n[°o]\s*|#\s*)?(\d+)/i);
  if (mb) { batimentIndex = Number(mb[1]); partie = partie.replace(mb[0], ' '); }
  let valeur = null;
  const mv = partie.match(/\bvaleur\s*[:=]?\s*(\d[\d\s]*)/i)
    || partie.match(/(\d[\d\s]*)\s*\$/) || partie.match(/(\d[\d\s]*)\s*$/);
  if (mv) { valeur = Number(mv[1].replace(/\s+/g, '')); partie = partie.replace(mv[0], ' '); }
  let description = partie.replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim();
  description = description.replace(/\s+(?:au|à|a|du|de|pour|sur)\s*$/i, '').trim();
  return {
    action: 'ajouter_contenu',
    params: {
      soumission_biens_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      description: description || null, valeur,
      batiment_index: batimentIndex, batiment_recherche: null,
    },
  };
}

function analyserModifierGarantieBiens(t) {
  if (!/\bb[âa]timent\b/i.test(t)) return null;
  // Une soumission d'un autre produit explicite → pas une commande biens.
  if (/\bcyber\b|\be\s*[&/]\s*o\b|\bd\s*[&/\-]\s*o\b/i.test(t) || MARQUEUR_PE.test(t) || MARQUEUR_FLOTTE.test(t)) return null;
  if (!/\b(?:formule|franchise|montant|garanties?|avenants?)\b/i.test(t)) return null;
  const params = { soumission_biens_id: null, soumission_client: null };
  const { ref, reste } = extraireRefSoumissionBiens(t);
  if (ref) { params.soumission_biens_id = ref.id || null; params.soumission_client = ref.client || null; }
  const mb = reste.match(/\bb[âa]timent\s+(?:n[°o]\s*|#\s*)?(\d+)/i);
  if (mb) {
    params.batiment_index = Number(mb[1]);
  } else {
    const mr = reste.match(/(?:pour|sur|du|de)\s+(?:le\s+|la\s+)?([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 '\-]{1,40}?)(?:\s+(?:de|de\s+la)\s+(?:la\s+)?soumission|\s*$)/i);
    if (mr && !/soumission/i.test(mr[1])) params.batiment_recherche = mr[1].trim();
  }
  const mf = t.match(/formule\s*(?:à|de|=|:)?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '\-]{0,30}?)(?=\s+(?:pour|sur|du|de|à|au|et)\b|\s*$)/i);
  if (mf) {
    const v = mf[1].toLowerCase();
    if (/tous\s+risques/.test(v)) params.formule = 'tous_risques';
    else if (/risques?\s+d[ée]sign[ée]s?|d[ée]sign[ée]s?/.test(v)) params.formule = 'risques_designes';
  }
  const mfr = t.match(/franchise\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mfr) params.franchise = Number(mfr[1].replace(/\s+/g, ''));
  const mm = t.match(/montant(?:\s+d['’]assurance)?\s*(?:à|de|=|:)?\s*(\d[\d\s]*)/i);
  if (mm) params.montant_assurance = Number(mm[1].replace(/\s+/g, ''));
  if (!params.formule && params.franchise === undefined && params.montant_assurance === undefined) return null;
  return { action: 'modifier_garantie_biens', params };
}

// --- RC commerciale (étape 8/10 RC) ----------------------------------------------------------------
function extraireRefSoumissionRC(texte) {
  // « à la soumission RC 1 », « à la soumission RC de Méthot »
  let m = texte.match(/(?:^|\s+)(?:à|dans|sur|de)\s+(?:la\s+)?soumission\s+rc\s+(?:n[°o]\s*|#\s*)?(\d+)\s*$/i);
  if (m) return { ref: { id: Number(m[1]) }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(/(?:^|\s+)(?:à|dans|sur|de)\s+(?:la\s+)?soumission\s+rc\s+de\s+(.+?)\s*$/i);
  if (m) return { ref: { client: m[1].trim() }, reste: texte.slice(0, m.index).trim() };
  // L'action est intrinsèquement « RC » : « à la soumission 1 » vise une soumission RC.
  return extraireRefSoumission(texte);
}

const MOTS_CLES_RC = 'activit[ée]|code\\s+de\\s+classification|classification|chiffre\\s+d[\'’]affaires|masse\\s+salariale|employ[ée]s?|sous-traitants?|superficie|code\\s+postal|description|notes|ville';

function parserMontantRC(v) {
  // « 2 millions » / « 1,2 million » → 2000000 / 1200000 ; « 500 000 » → 500000.
  const m = String(v).match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(millions?|k\b)?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/\s+/g, '').replace(',', '.'));
  if (isNaN(n) || n <= 0) return null;
  if (/million/i.test(m[2] || '')) n *= 1e6;
  else if (/^k$/i.test(m[2] || '')) n *= 1e3;
  return Math.round(n);
}

function prendreChampRC(partie, noms, reValeur) {
  const re = new RegExp(`\\b(?:${noms})(?:\\s+de)?\\s*[:=]?\\s*(${reValeur})(?=\\s+\\b(?:${MOTS_CLES_RC})\\b|\\s*[,;.]|\\s*$)`, 'i');
  const mm = partie.match(re);
  if (mm) return { val: mm[1].trim(), partie: partie.replace(mm[0], ' ') };
  return { val: null, partie };
}

const TEXTE_RC = `[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 '\\-]{0,40}?`;
// Valeur textuelle en mode paresseux : elle s'arrête au premier mot-clé de
// champ suivant (sinon la capture gloutonne avalerait « chiffre d'affaires
// 1,2 million » dans le champ « activité » précédent).

function analyserAjouterLieuRC(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:un\s+|une\s+|le\s+|la\s+)?(?:lieux?(?:\s+d['’]exploitation)?|exploitations?)\s+(.+)$/i);
  if (!m) return null;
  // Une soumission d'un autre produit explicite → pas une commande RC.
  if (/\bcyber\b|\be\s*[&/]\s*o\b|\bd\s*[&/\-]\s*o\b/i.test(t) || MARQUEUR_PE.test(t) || MARQUEUR_FLOTTE.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionRC(m[1]);
  let partie = ` ${reste} `;
  let c = prendreChampRC(partie, 'ville', TEXTE_RC);
  const ville = c.val; partie = c.partie;
  c = prendreChampRC(partie, 'code\\s+postal', '[A-Za-z]\\d[A-Za-z]\\s*\\d[A-Za-z]\\d');
  const codePostal = c.val; partie = c.partie;
  c = prendreChampRC(partie, 'activit[ée]', TEXTE_RC);
  const typeActivite = c.val; partie = c.partie;
  c = prendreChampRC(partie, 'code\\s+de\\s+classification|classification', '[A-Za-z0-9][A-Za-z0-9\\-]{0,20}');
  const codeClassification = c.val; partie = c.partie;
  c = prendreChampRC(partie, 'chiffre\\s+d[\'’]affaires', '\\d[\\d\\s]*(?:[.,]\\d+)?\\s*(?:millions?|k\\b)?');
  const chiffreAffaires = c.val ? parserMontantRC(c.val) : null; partie = c.partie;
  c = prendreChampRC(partie, 'masse\\s+salariale', '\\d[\\d\\s]*');
  const masseSalariale = c.val ? Number(c.val.replace(/\s+/g, '')) : null; partie = c.partie;
  c = prendreChampRC(partie, 'employ[ée]s?', '\\d+');
  const nbEmployes = c.val ? Number(c.val) : null; partie = c.partie;
  c = prendreChampRC(partie, 'superficie', '\\d[\\d\\s]*');
  const superficiePi2 = c.val ? Number(c.val.replace(/\s+/g, '')) : null; partie = c.partie;
  let sousTraitants = null;
  let cst = prendreChampRC(partie, 'sous-traitants?|sous\\s+traitants?', 'assur[ée]s?|non\\s+assur[ée]s?|aucun|sans');
  if (cst.val) {
    const v = cst.val.toLowerCase().replace(/\s+/g, ' ');
    sousTraitants = /non/.test(v) ? 'non_assures' : (/aucun|sans/.test(v) ? 'aucun' : 'assures');
    partie = cst.partie;
  }
  c = prendreChampRC(partie, 'description', TEXTE_RC);
  const descriptionActivites = c.val; partie = c.partie;
  // Adresse : ce qui reste ; « 456 boulevard Industriel à Laval » → adresse + ville.
  let adresse = partie.replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim();
  adresse = adresse.replace(/^(?:au|à|a|du|de|le|la)\s+/i, '').trim();
  let ville2 = ville;
  const mad = adresse.match(/^(.+?)\s+[àa]\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '\-]{1,30})$/);
  if (mad && (!ville2 || mad[2].trim().toLowerCase() === ville2.toLowerCase())) {
    adresse = mad[1].trim();
    if (!ville2) ville2 = mad[2].trim();
  }
  return {
    action: 'ajouter_lieu_rc',
    params: {
      soumission_rc_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      adresse: adresse || null, ville: ville2 || null, code_postal: codePostal || null,
      type_activite: typeActivite || null, code_classification: codeClassification || null,
      description_activites: descriptionActivites || null,
      chiffre_affaires: chiffreAffaires, masse_salariale: masseSalariale,
      nb_employes: nbEmployes, superficie_pi2: superficiePi2,
      sous_traitants: sousTraitants,
    },
  };
}

const FORMULES_RC_ALIAS = [
  [/produits?(?:\s+et\s+op[ée]rations?\s+compl[ée]t[ée]es?)?/, 'produits_completes'],
  [/locaux?(?:\s+et\s+op[ée]rations?)?/, 'locaux_operations'],
  [/globale?/, 'globale'],
];

function analyserModifierGarantiesRC(t) {
  if (!/\b(?:lieux?(?:\s+d['’]exploitation)?|exploitations?)\b/i.test(t)) return null;
  if (!/\b(?:limite(?:s)?|agr[ée]gat|franchise|formule|garanties?|avenants?|pollution|parapluie)\b/i.test(t)) return null;
  // Une soumission d'un autre produit explicite → pas une commande RC.
  if (/\bcyber\b|\be\s*[&/]\s*o\b|\bd\s*[&/\-]\s*o\b/i.test(t) || MARQUEUR_PE.test(t) || MARQUEUR_FLOTTE.test(t)) return null;
  const params = { soumission_rc_id: null, soumission_client: null };
  const { ref, reste } = extraireRefSoumissionRC(t);
  if (ref) { params.soumission_rc_id = ref.id || null; params.soumission_client = ref.client || null; }
  const ml = reste.match(/\b(?:lieux?(?:\s+d['’]exploitation)?|exploitations?)\s+(?:n[°o]\s*|#\s*)?(\d+)/i);
  if (ml) {
    params.exploitation_index = Number(ml[1]);
  } else {
    const mr = reste.match(/(?:pour|sur|du|de)\s+(?:le\s+|la\s+)?([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 '\-]{1,40}?)(?:\s+(?:de|de\s+la)\s+(?:la\s+)?soumission|\s*$)/i);
    if (mr && !/soumission/i.test(mr[1])) params.exploitation_recherche = mr[1].trim();
  }
  const mls = t.match(/limite\s*(?:par\s+(?:sinistre|occurrence|événement|evenement))?\s*(?:à|de|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?|\d[\d\s]*)/i);
  if (mls && /\b(?:limite|sinistre|occurrence)\b/i.test(t)) {
    const v = parserMontantRC(mls[1]);
    if (v) params.limite_par_sinistre = v;
  }
  const mag = t.match(/agr[ée]gat\s*(?:à|de|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?|\d[\d\s]*)/i);
  if (mag) {
    const v = parserMontantRC(mag[1]);
    if (v) params.limite_agregat = v;
  }
  const mfr = t.match(/franchise\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mfr) params.franchise = Number(mfr[1].replace(/\s+/g, ''));
  const mf = t.match(/formule\s*(?:à|de|=|:)?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '\-]{0,40}?)(?=\s+(?:pour|sur|du|de|à|au|et|limite|franchise|agr[ée]gat|avenant)\b|\s*$)/i);
  if (mf) {
    for (const [re, val] of FORMULES_RC_ALIAS) {
      if (re.test(mf[1].toLowerCase())) { params.formule = val; break; }
    }
  }
  const avenants = {};
  const RETRAIT = /(?:sans|retir\w*|enlev\w*|supprim\w*)\s+(?:l['’]\s*)?(?:avenant\s+)?/i;
  const mPoll = t.match(new RegExp(RETRAIT.source + 'pollution\\b', 'i'));
  if (mPoll) avenants.pollution = 0;
  else if (/\bpollution\b/i.test(t)) avenants.pollution = 1;
  const mPara = t.match(new RegExp(RETRAIT.source + 'parapluie\\b', 'i'));
  if (mPara) avenants.parapluie = 0;
  else if (/\bparapluie\b/i.test(t) || /\bexc[ée]dentaire\b/i.test(t)) avenants.parapluie = 1;
  if (Object.keys(avenants).length) params.avenants = avenants;
  if (params.limite_par_sinistre === undefined && params.limite_agregat === undefined
    && params.franchise === undefined && !params.formule && !params.avenants) return null;
  return { action: 'modifier_garanties_rc', params };
}

// --- Cyber / cyberrisques (étape 8/10 cyber) -------------------------------------------------------
function extraireRefSoumissionCyber(texte) {
  // « à la soumission cyber 1 », « pour la soumission cyber de Bouchard »
  // (prépositions : à, dans, sur, de, pour — « pour » est courant : « mets la
  // franchise à 5000 $ pour la soumission cyber 1 »).
  let m = texte.match(/(?:^|\s+)(?:à|dans|sur|de|pour)\s+(?:la\s+)?soumission\s+cyber\s+(?:n[°o]\s*|#\s*)?(\d+)\s*$/i);
  if (m) return { ref: { id: Number(m[1]) }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(/(?:^|\s+)(?:à|dans|sur|de|pour)\s+(?:la\s+)?soumission\s+cyber\s+de\s+(.+?)\s*$/i);
  if (m) return { ref: { client: m[1].trim() }, reste: texte.slice(0, m.index).trim() };
  // L'action est intrinsèquement « cyber » : « à la soumission 1 » vise une soumission cyber.
  return extraireRefSoumission(texte);
}

function resoudreSoumissionCyber(cabinetId, utilisateur, ref) {
  const { trouverClient } = utilAssistant();
  let s = null;
  if (ref.id) {
    s = cyber.obtenirSoumission(Number(ref.id), cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission cyber #${ref.id}` };
  } else if (ref.client) {
    const rcy = trouverClient(cabinetId, ref.client);
    if (rcy.statut !== 'ok') return { statut: 'client', detail: rcy };
    const liste = bd.prepare(`
      SELECT id FROM cyber_soumissions WHERE cabinet_id = ? AND client_id = ? AND archive = 0 ORDER BY id DESC
    `).all(cabinetId, rcy.client.id);
    if (!liste.length) return { statut: 'aucune', client: rcy.client.raison_sociale };
    if (liste.length > 1) {
      return { statut: 'ambigue', ids: liste.map((l) => l.id), client: rcy.client.raison_sociale };
    }
    s = cyber.obtenirSoumission(liste[0].id, cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission cyber #${liste[0].id}` };
  } else {
    return { statut: 'manque' };
  }
  if (utilisateur && utilisateur.role === 'courtier'
    && clientHorsPortefeuille(cabinetId, utilisateur, s.client_id)) {
    return { statut: 'hors_portefeuille' };
  }
  return { statut: 'ok', soumission: s };
}

function messageErreurSoumissionCyber(r) {
  switch (r.statut) {
    case 'introuvable':
      return `Je n'ai pas trouvé la ${r.recherche}. Vérifiez le numéro dans l'onglet Cyber.`;
    case 'manque':
      return 'Pour quelle soumission ? Précisez « à la soumission cyber 1 » ou « à la soumission cyber de Bouchard ».';
    case 'aucune':
      return `Aucune soumission cyber active pour ${r.client}. Créez-la d'abord dans l'onglet Cyber.`;
    case 'ambigue':
      return `Plusieurs soumissions cyber actives pour ${r.client} : ${r.ids.map((i) => '#' + i).join(', ')}. Précisez le numéro, s'il vous plaît.`;
    case 'hors_portefeuille':
      return "Cette soumission cyber n'est pas dans votre portefeuille. Je ne peux pas la modifier.";
    case 'client': {
      const d = r.detail;
      if (d.statut === 'ambigu') {
        return `Plusieurs entreprises correspondent : ${d.options.join(' · ')}. Précisez le nom exact, s'il vous plaît.`;
      }
      return `Je n'ai pas trouvé l'entreprise « ${d.recherche || '?'} ».`;
    }
    default:
      return 'Soumission cyber introuvable.';
  }
}

// --- Résolution : soumission E&O (étape 8/10 E&O) ----------------------------------------------
function resoudreSoumissionEO(cabinetId, utilisateur, ref) {
  const { trouverClient } = utilAssistant();
  let s = null;
  if (ref.id) {
    s = eo.obtenirSoumission(Number(ref.id), cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission E&O #${ref.id}` };
  } else if (ref.client) {
    const reo = trouverClient(cabinetId, ref.client);
    if (reo.statut !== 'ok') return { statut: 'client', detail: reo };
    const liste = bd.prepare(`
      SELECT id FROM eo_soumissions WHERE cabinet_id = ? AND client_id = ? AND archive = 0 ORDER BY id DESC
    `).all(cabinetId, reo.client.id);
    if (!liste.length) return { statut: 'aucune', client: reo.client.raison_sociale };
    if (liste.length > 1) {
      return { statut: 'ambigue', ids: liste.map((l) => l.id), client: reo.client.raison_sociale };
    }
    s = eo.obtenirSoumission(liste[0].id, cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission E&O #${liste[0].id}` };
  } else {
    return { statut: 'manque' };
  }
  if (utilisateur && utilisateur.role === 'courtier'
    && clientHorsPortefeuille(cabinetId, utilisateur, s.client_id)) {
    return { statut: 'hors_portefeuille' };
  }
  return { statut: 'ok', soumission: s };
}

function messageErreurSoumissionEO(r) {
  switch (r.statut) {
    case 'introuvable':
      return `Je n'ai pas trouvé la ${r.recherche}. Vérifiez le numéro dans l'onglet E&O.`;
    case 'manque':
      return 'Pour quelle soumission ? Précisez « à la soumission E&O 1 » ou « à la soumission E&O de Lussier ».';
    case 'aucune':
      return `Aucune soumission E&O active pour ${r.client}. Créez-la d'abord dans l'onglet E&O.`;
    case 'ambigue':
      return `Plusieurs soumissions E&O actives pour ${r.client} : ${r.ids.map((i) => '#' + i).join(', ')}. Précisez le numéro, s'il vous plaît.`;
    case 'hors_portefeuille':
      return "Cette soumission E&O n'est pas dans votre portefeuille. Je ne peux pas la modifier.";
    case 'client': {
      const d = r.detail;
      if (d.statut === 'ambigu') {
        return `Plusieurs entreprises correspondent : ${d.options.join(' · ')}. Précisez le nom exact, s'il vous plaît.`;
      }
      return `Je n'ai pas trouvé l'entreprise « ${d.recherche || '?'} ».`;
    }
    default:
      return 'Soumission E&O introuvable.';
  }
}

// --- Résolution : mesure de sécurité dans une soumission cyber -----------------------------------
function resoudreMesure(soumission, ref) {
  const ms = (soumission.mesures || []).filter((x) => !x.archive);
  if (!ms.length) return { statut: 'aucun' };
  if (ref.index) {
    const m = ms[ref.index - 1];
    return m ? { statut: 'ok', mesure: m } : { statut: 'introuvable' };
  }
  if (ref.type) {
    const trouves = ms.filter((x) => x.type_mesure === ref.type);
    if (trouves.length === 1) return { statut: 'ok', mesure: trouves[0] };
    if (trouves.length > 1) return { statut: 'ambigu', mesures: trouves };
    return { statut: 'introuvable' };
  }
  return { statut: 'manque' };
}

function libelleMesure(m) {
  return NOMS_TYPE_MESURE[m.type_mesure] || (m.type_mesure || '').trim() || `mesure #${m.id}`;
}

// --- Résolution : activité professionnelle dans une soumission E&O --------------------------------
function resoudreActivite(soumission, ref) {
  const as = (soumission.activites || []).filter((a) => !a.archive);
  if (!as.length) return { statut: 'aucun' };
  if (ref.index) {
    const a = as[ref.index - 1];
    return a ? { statut: 'ok', activite: a } : { statut: 'introuvable' };
  }
  if (ref.recherche) {
    const r = ref.recherche.toLowerCase();
    const trouves = as.filter((x) => String(x.description_activite || '').toLowerCase().includes(r));
    if (trouves.length === 1) return { statut: 'ok', activite: trouves[0] };
    if (trouves.length > 1) return { statut: 'ambigu', activites: trouves };
    return { statut: 'introuvable' };
  }
  return { statut: 'manque' };
}

function libelleActivite(a) {
  return String(a.description_activite || '').trim() || `activité #${a.id}`;
}

// --- D&O / responsabilité des administrateurs et dirigeants (étape 8/10 D&O) ------------------------
// Marqueur de produit : « D&O » (aussi « D-O », « D/O », « DO »), « dirigeant »,
// « administrateur », « responsabilité des dirigeants ». Les analyseurs d'ajout
// sont intrinsèquement D&O (le mot « dirigeant » est propre au produit —
// distinct de « conducteur » en FPQ1) ; le modificateur de garanties exige le
// marqueur explicite (« garantie » est partagé entre les produits).
// Gardes anti-collision bidirectionnelles : aucun mot de produit ambigu ne
// déclenche une action D&O, et une commande D&O explicite n'est captée par
// aucun autre produit (gardes ajoutées dans les analyseurs auto/biens/RC/cyber/E&O).
const MARQUEUR_DO = /(?:\bd\s*[&/\-]?\s*o\b|responsabilit[ée]\s+des\s+dirigeants?|administrateurs?\s+et\s+dirigeants?)/i;

function extraireRefSoumissionDO(texte) {
  // « à la soumission D&O 1 », « pour la soumission D&O de Bélanger »
  let m = texte.match(/(?:^|\s+)(?:à|dans|sur|de|pour)\s+(?:la\s+)?soumission\s+d\s*[&/\-]?\s*o\s+(?:n[°o]\s*|#\s*)?(\d+)\s*$/i);
  if (m) return { ref: { id: Number(m[1]) }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(/(?:^|\s+)(?:à|dans|sur|de|pour)\s+(?:la\s+)?soumission\s+d\s*[&/\-]?\s*o\s+de\s+(.+?)\s*$/i);
  if (m) return { ref: { client: m[1].trim() }, reste: texte.slice(0, m.index).trim() };
  // Référence au milieu de la phrase (« mets la franchise de la soumission
  // D&O 1 à 10 000 $ ») : on la retire, le reste est conservé des deux côtés.
  m = texte.match(/(?:^|\s+)(?:à|dans|sur|de|pour)\s+(?:la\s+)?soumission\s+d\s*[&/\-]?\s*o\s+(?:n[°o]\s*|#\s*)?(\d+)/i);
  if (m) return { ref: { id: Number(m[1]) }, reste: (texte.slice(0, m.index) + ' ' + texte.slice(m.index + m[0].length)).trim() };
  // L'action est intrinsèquement « D&O » : « à la soumission 1 » vise une soumission D&O.
  return extraireRefSoumission(texte);
}

function resoudreSoumissionDO(cabinetId, utilisateur, ref) {
  const { trouverClient } = utilAssistant();
  let s = null;
  if (ref.id) {
    s = doLib.obtenirSoumission(Number(ref.id), cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission D&O #${ref.id}` };
  } else if (ref.client) {
    const rdo = trouverClient(cabinetId, ref.client);
    if (rdo.statut !== 'ok') return { statut: 'client', detail: rdo };
    const liste = bd.prepare(`
      SELECT id FROM do_soumissions WHERE cabinet_id = ? AND client_id = ? AND archive = 0 ORDER BY id DESC
    `).all(cabinetId, rdo.client.id);
    if (!liste.length) return { statut: 'aucune', client: rdo.client.raison_sociale };
    if (liste.length > 1) {
      return { statut: 'ambigue', ids: liste.map((l) => l.id), client: rdo.client.raison_sociale };
    }
    s = doLib.obtenirSoumission(liste[0].id, cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission D&O #${liste[0].id}` };
  } else {
    return { statut: 'manque' };
  }
  if (utilisateur && utilisateur.role === 'courtier'
    && clientHorsPortefeuille(cabinetId, utilisateur, s.client_id)) {
    return { statut: 'hors_portefeuille' };
  }
  return { statut: 'ok', soumission: s };
}

function messageErreurSoumissionDO(r) {
  switch (r.statut) {
    case 'introuvable':
      return `Je n'ai pas trouvé la ${r.recherche}. Vérifiez le numéro dans l'onglet D&O.`;
    case 'manque':
      return 'Pour quelle soumission ? Précisez « à la soumission D&O 1 » ou « à la soumission D&O de Bélanger ».';
    case 'aucune':
      return `Aucune soumission D&O active pour ${r.client}. Créez-la d'abord dans l'onglet D&O.`;
    case 'ambigue':
      return `Plusieurs soumissions D&O actives pour ${r.client} : ${r.ids.map((i) => '#' + i).join(', ')}. Précisez le numéro, s'il vous plaît.`;
    case 'hors_portefeuille':
      return "Cette soumission D&O n'est pas dans votre portefeuille. Je ne peux pas la modifier.";
    case 'client': {
      const d = r.detail;
      if (d.statut === 'ambigu') {
        return `Plusieurs entreprises correspondent : ${d.options.join(' · ')}. Précisez le nom exact, s'il vous plaît.`;
      }
      return `Je n'ai pas trouvé l'entreprise « ${d.recherche || '?'} ».`;
    }
    default:
      return 'Soumission D&O introuvable.';
  }
}

// --- Résolution : dirigeant dans une soumission D&O ----------------------------------------------
function resoudreDirigeant(soumission, ref) {
  const ds = (soumission.dirigeants || []).filter((d) => !d.archive);
  if (!ds.length) return { statut: 'aucun' };
  if (ref.index) {
    const d = ds[ref.index - 1];
    return d ? { statut: 'ok', dirigeant: d } : { statut: 'introuvable' };
  }
  if (ref.recherche) {
    const r = ref.recherche.toLowerCase();
    const trouves = ds.filter((x) => String(x.nom || '').toLowerCase().includes(r));
    if (trouves.length === 1) return { statut: 'ok', dirigeant: trouves[0] };
    if (trouves.length > 1) return { statut: 'ambigu', dirigeants: trouves };
    return { statut: 'introuvable' };
  }
  return { statut: 'manque' };
}

function libelleDirigeant(d) {
  return String(d.nom || '').trim() || `dirigeant #${d.id}`;
}

// Avenants D&O (clés JSON de do_garanties.avenants — cf. routes/do.js AVENANTS_DO).
const AVENANTS_DO = [
  ['frais_defense', 'Frais de défense'],
  ['pratiques_emploi', 'Pratiques d’emploi'],
  ['fidelite_crime', 'Fidélité / crime'],
];
const AVENANTS_DO_ALIAS = [
  [/frais\s+de\s+d[ée]fense/i, 'frais_defense'],
  [/pratiques?\s+d['’]\s*emploi/i, 'pratiques_emploi'],
  [/fid[ée]lit[ée](?:\s*\/\s*crime|\s+crime)?/i, 'fidelite_crime'],
  [/\bcrime\b/i, 'fidelite_crime'],
];

function analyserAjouterDirigeantDO(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:un\s+|une\s+|le\s+|la\s+|l['’]\s*)?dirigeants?(?:\s+et\s+administrateurs?)?\s+(.+)$/i);
  if (!m) return null;
  // Une soumission d'un autre produit explicite → pas une commande D&O.
  if (/\bsoumission\s+(cyber|rc|biens?|flotte|cautionnement|e\s*[&/]\s*o)\b/i.test(t)) return null;
  if (MARQUEUR_PE.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionDO(m[1]);
  let partie = ` ${reste} `;
  // Antécédents personnels : « antécédents personnels aucun » (valeur sensible —
  // écrite en base, jamais réaffichée telle quelle dans les résumés).
  let antecedentsPersonnels = null;
  const ma = partie.match(/\bant[ée]c[ée]dents?(?:\s+personnels?)?\s*[:=]?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '\-]{0,60}?)(?=\s*(?:[,;.]|$))/i);
  if (ma) { antecedentsPersonnels = ma[1].trim(); partie = partie.replace(ma[0], ' '); }
  // Années d'expérience : « 15 ans d'expérience », « expérience : 15 ans ».
  let anneesExperience = null;
  const me = partie.match(/(\d{1,2})\s*ans?\s+d['’]\s*exp[ée]rience/i)
    || partie.match(/\bexp[ée]rience\s*[:=]?\s*(\d{1,2})/i);
  if (me) { anneesExperience = Number(me[1]); partie = partie.replace(me[0], ' '); }
  // Fonction / titre : « comme trésorier », « fonction présidente-directrice générale ».
  let fonction = null;
  const mf = partie.match(/\bcomme\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '\-]{1,40}?)(?=\s*(?:[,;.]|$))/i)
    || partie.match(/\b(?:fonction|titre)\s*[:=]?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '\-]{1,40}?)(?=\s*(?:[,;.]|$))/i);
  if (mf) { fonction = mf[1].trim(); partie = partie.replace(mf[0], ' '); }
  // Nom : ce qui reste, prépositions résiduelles nettoyées.
  let nom = partie.replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim();
  nom = nom.replace(/^(?:au|à|a|du|de|des|le|la|les|l['’]|avec|pour)\s+/i, '').trim();
  nom = nom.replace(/\s+(?:au|à|a|du|de|des|le|la|les|avec|pour)$/i, '').trim();
  return {
    action: 'ajouter_dirigeant_do',
    params: {
      soumission_do_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      nom: nom || null, fonction,
      annees_experience: anneesExperience,
      antecedents_personnels: antecedentsPersonnels,
    },
  };
}

function analyserModifierGarantiesDO(t) {
  // Le marqueur D&O est obligatoire : « garantie » est un concept partagé
  // entre les produits (auto, biens, RC, cyber, E&O, D&O).
  if (!MARQUEUR_DO.test(t)) return null;
  if (!/\b(?:limite(?:s)?|agr[ée]gat|franchise|base|garanties?|avenants?|frais\s+de\s+d[ée]fense|pratiques?\s+d['’]\s*emploi|fid[ée]lit[ée]|\bcrime\b|prime)\b/i.test(t)) return null;
  const params = { soumission_do_id: null, soumission_client: null };
  const { ref } = extraireRefSoumissionDO(t);
  if (ref) { params.soumission_do_id = ref.id || null; params.soumission_client = ref.client || null; }
  const mls = t.match(/limite\s*(?:par\s+(?:sinistre|occurrence))?\s*(?:à|de|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?|\d[\d\s]*)/i);
  if (mls) {
    const v = parserMontantRC(mls[1]);
    if (v) params.limite_par_sinistre = v;
  }
  const mag = t.match(/agr[ée]gat\s*(?:à|de|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?|\d[\d\s]*)/i);
  if (mag) {
    const v = parserMontantRC(mag[1]);
    if (v) params.limite_agregat = v;
  }
  const mfr = t.match(/[àa]\s*(\d[\d\s]*)\$\s*$/i) || t.match(/franchise\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mfr) params.franchise = Number(mfr[1].replace(/\s+/g, ''));
  const mb = t.match(/\bbase\s+(?:de\s+garantie\s+)?(?:à|de|=|:)?\s*(r[ée]clamations?[-\s]?pr[ée]sent[ée]es?|claims?[-\s]?made|occurrences?)/i);
  if (mb) {
    params.base = /occurr?ence/i.test(mb[1]) ? 'occurrences' : 'reclamations_presentees';
  }
  const mpr = t.match(/prime\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mpr) params.prime = Number(mpr[1].replace(/\s+/g, ''));
  // Avenants : ajout ET retrait (fusion — les champs non mentionnés restent).
  const avenants = {};
  const RETRAIT_DO = /(?:sans|retir\w*|enlev\w*|supprim\w*)\s+(?:l['’]\s*)?(?:avenant\s+)?/i;
  for (const [re, code] of AVENANTS_DO_ALIAS) {
    const avecRetrait = new RegExp(RETRAIT_DO.source + re.source, 'i');
    if (avecRetrait.test(t)) avenants[code] = 0;
    else if (re.test(t)) avenants[code] = 1;
  }
  if (Object.keys(avenants).length) params.avenants = avenants;
  if (params.limite_par_sinistre === undefined && params.limite_agregat === undefined
    && params.franchise === undefined && params.base === undefined
    && params.prime === undefined && !params.avenants) return null;
  return { action: 'modifier_garanties_do', params };
}

function analyserModifierDirigeantDO(t) {
  // « change la fonction du dirigeant Marie Tremblay de la soumission D&O 2 à trésorier »
  const m = t.match(/(?:change(?:r|z)?|modifi(?:e|er|ez)?|mets?|mettons|pass(?:e|er|ez)?)\s+(?:les?\s+|la\s+|l['’]\s*)?(fonction|titre|ann[ée]es?\s+d['’]\s*exp[ée]rience|ant[ée]c[ée]dents?\s+personnels?|nom)\s+(?:du|de\s+la|des?)\s+dirigeant\s+(.+?)\s*$/i);
  if (!m) return null;
  // Une soumission d'un autre produit explicite → pas une commande D&O.
  if (/\bsoumission\s+(cyber|rc|biens?|flotte|cautionnement|e\s*[&/]\s*o)\b/i.test(t)) return null;
  if (MARQUEUR_PE.test(t)) return null;
  const champ = m[1].toLowerCase();
  // Valeur en fin de phrase : « … à trésorier ».
  const m2 = m[2].match(/(.+?)\s+[àa]\s*(.+?)\s*$/);
  if (!m2) return null; // sans valeur, ce n'est pas cette action
  const valeur = m2[2].trim().replace(/[,;.]+$/, '');
  if (!valeur) return null;
  const { ref, reste } = extraireRefSoumissionDO(m2[1]);
  let recherche = reste.replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:du|de|des|le|la|les|l['’])\s+/i, '').trim()
    .replace(/\s+(?:du|de|des|le|la|les)$/i, '').trim() || null;
  let dirigeantIndex = null;
  if (recherche && /^\d+$/.test(recherche)) { dirigeantIndex = Number(recherche); recherche = null; }
  const params = {
    soumission_do_id: ref && ref.id ? ref.id : null,
    soumission_client: ref && ref.client ? ref.client : null,
    dirigeant_index: dirigeantIndex, dirigeant_recherche: recherche,
  };
  if (/fonction|titre/.test(champ)) params.fonction = valeur;
  else if (/exp[ée]rience/.test(champ)) {
    const n = Number(valeur.replace(/\D+/g, ''));
    if ((!n && n !== 0) || n < 0 || n > 80) return null;
    params.annees_experience = n;
  }
  else if (/ant[ée]c[ée]dent/.test(champ)) params.antecedents_personnels = valeur;
  else params.nom = valeur;
  return { action: 'modifier_dirigeant_do', params };
}

// --- Perte d'exploitation / interruption des affaires (étape 8/10 PE) -------------------------------
// Marqueur de produit : « perte d'exploitation » (aussi « interruption des
// affaires »). Les analyseurs d'ajout/modification d'établissement sont
// intrinsèquement PE (le mot « établissement » est propre au produit —
// distinct du « lieu » RC et du « bâtiment » biens) ; le modificateur de
// garanties exige le marqueur explicite (« garantie »/« franchise » sont
// partagés entre les produits).
// Gardes anti-collision bidirectionnelles : aucun mot de produit ambigu ne
// déclenche une action PE, et une commande PE explicite n'est captée par
// aucun autre produit (gardes ajoutées dans les analyseurs auto/biens/RC/cyber/E&O/D&O).
const MARQUEUR_PE = /(?:\bperte\s+d['’]\s*exploitation\b|interruption\s+des\s+affaires)/i;

function extraireRefSoumissionPE(texte) {
  const PROD = "(?:perte\\s+d['’]\\s*exploitation|interruption\\s+des\\s+affaires|pe)";
  // « à la soumission perte d'exploitation 1 », « à la soumission PE 1 »,
  // « à la soumission interruption des affaires 1 »
  let m = texte.match(new RegExp(
    `(?:^|\\s+)(?:à|dans|sur|de|pour)\\s+(?:la\\s+)?soumission\\s+${PROD}\\s+(?:n[°o]\\s*|#\\s*)?(\\d+)\\s*$`, 'i'));
  if (m) return { ref: { id: Number(m[1]) }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(new RegExp(
    `(?:^|\\s+)(?:à|dans|sur|de|pour)\\s+(?:la\\s+)?soumission\\s+${PROD}\\s+de\\s+(.+?)\\s*$`, 'i'));
  if (m) return { ref: { client: m[1].trim() }, reste: texte.slice(0, m.index).trim() };
  // Référence au milieu de la phrase (« mets la période d'indemnité de la
  // soumission perte d'exploitation 1 à 18 mois ») : on la retire, le reste
  // est conservé des deux côtés.
  m = texte.match(new RegExp(
    `(?:^|\\s+)(?:à|dans|sur|de|pour)\\s+(?:la\\s+)?soumission\\s+${PROD}\\s+(?:n[°o]\\s*|#\\s*)?(\\d+)`, 'i'));
  if (m) return { ref: { id: Number(m[1]) }, reste: (texte.slice(0, m.index) + ' ' + texte.slice(m.index + m[0].length)).trim() };
  // L'action est intrinsèquement « perte d'exploitation » : « à la soumission 1 » vise une soumission PE.
  return extraireRefSoumission(texte);
}

function resoudreSoumissionPE(cabinetId, utilisateur, ref) {
  const { trouverClient } = utilAssistant();
  let s = null;
  if (ref.id) {
    s = pe.obtenirSoumission(Number(ref.id), cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission perte d'exploitation #${ref.id}` };
  } else if (ref.client) {
    const rpe = trouverClient(cabinetId, ref.client);
    if (rpe.statut !== 'ok') return { statut: 'client', detail: rpe };
    const liste = bd.prepare(`
      SELECT id FROM pe_soumissions WHERE cabinet_id = ? AND client_id = ? AND archive = 0 ORDER BY id DESC
    `).all(cabinetId, rpe.client.id);
    if (!liste.length) return { statut: 'aucune', client: rpe.client.raison_sociale };
    if (liste.length > 1) {
      return { statut: 'ambigue', ids: liste.map((l) => l.id), client: rpe.client.raison_sociale };
    }
    s = pe.obtenirSoumission(liste[0].id, cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission perte d'exploitation #${liste[0].id}` };
  } else {
    return { statut: 'manque' };
  }
  if (utilisateur && utilisateur.role === 'courtier'
    && clientHorsPortefeuille(cabinetId, utilisateur, s.client_id)) {
    return { statut: 'hors_portefeuille' };
  }
  return { statut: 'ok', soumission: s };
}

function messageErreurSoumissionPE(r) {
  switch (r.statut) {
    case 'introuvable':
      return `Je n'ai pas trouvé la ${r.recherche}. Vérifiez le numéro dans l'onglet Perte d'exploitation.`;
    case 'manque':
      return 'Pour quelle soumission ? Précisez « à la soumission perte d\u2019exploitation 1 » ou « à la soumission perte d\u2019exploitation de Chaleur ».';
    case 'aucune':
      return `Aucune soumission perte d'exploitation active pour ${r.client}. Créez-la d'abord dans l'onglet Perte d'exploitation.`;
    case 'ambigue':
      return `Plusieurs soumissions perte d'exploitation actives pour ${r.client} : ${r.ids.map((i) => '#' + i).join(', ')}. Précisez le numéro, s'il vous plaît.`;
    case 'hors_portefeuille':
      return "Cette soumission perte d'exploitation n'est pas dans votre portefeuille. Je ne peux pas la modifier.";
    case 'client': {
      const d = r.detail;
      if (d.statut === 'ambigu') {
        return `Plusieurs entreprises correspondent : ${d.options.join(' · ')}. Précisez le nom exact, s'il vous plaît.`;
      }
      return `Je n'ai pas trouvé l'entreprise « ${d.recherche || '?'} ».`;
    }
    default:
      return 'Soumission perte d\u2019exploitation introuvable.';
  }
}

// --- Résolution : établissement dans une soumission perte d'exploitation ------------------------------
function resoudreEtablissement(soumission, ref) {
  const es = (soumission.etablissements || []).filter((e) => !e.archive);
  if (!es.length) return { statut: 'aucun' };
  if (ref.index) {
    const e = es[ref.index - 1];
    return e ? { statut: 'ok', etablissement: e } : { statut: 'introuvable' };
  }
  if (ref.recherche) {
    const r = ref.recherche.toLowerCase();
    const trouves = es.filter((x) => String(x.nom_lieu || '').toLowerCase().includes(r)
      || String(x.adresse || '').toLowerCase().includes(r));
    if (trouves.length === 1) return { statut: 'ok', etablissement: trouves[0] };
    if (trouves.length > 1) return { statut: 'ambigu', etablissements: trouves };
    return { statut: 'introuvable' };
  }
  return { statut: 'manque' };
}

function libelleEtablissement(e) {
  return String(e.nom_lieu || '').trim() || String(e.adresse || '').trim() || `établissement #${e.id}`;
}

// Avenants PE (clés JSON de pe_garanties.avenants — cf. routes/pe.js AVENANTS_PE).
const AVENANTS_PE = [
  ['frais_supplementaires', 'Frais supplémentaires'],
  ['dependance_fournisseurs', 'Dépendance aux fournisseurs'],
  ['acces_civil', 'Accès civil'],
  ['deterioration_stocks', 'Détérioration des stocks'],
];
const AVENANTS_PE_ALIAS = [
  [/frais\s+suppl[ée]mentaires/i, 'frais_supplementaires'],
  [/d[ée]pendance\s+(?:aux|des|de)\s+fournisseurs?/i, 'dependance_fournisseurs'],
  [/acc[èe]s\s+civil(?:e)?(?:\s*\(\s*interdiction\s+d['’]\s*acc[èe]s\s*\))?/i, 'acces_civil'],
  [/d[ée]t[ée]rioration\s+des?\s+stocks?/i, 'deterioration_stocks'],
];

function normaliserBaseValeurPE(v) {
  if (!v) return null;
  const t = String(v).toLowerCase();
  if (/remplacement/.test(t)) return 'remplacement';
  if (/d[ée]pr[ée]ci/.test(t)) return 'depreciation';
  return null;
}
function libelleBaseValeurPe(b) {
  if (b === 'remplacement') return 'Coût de remplacement';
  if (b === 'depreciation') return 'Valeur dépréciée';
  return '—';
}
function normaliserBaseMontantPE(v) {
  if (!v) return null;
  const t = String(v).toLowerCase();
  if (/b[ée]n[ée]fice\s+brut/.test(t)) return 'benefice_brut';
  if (/marge\s+brute/.test(t)) return 'marge_brute';
  if (/chiffre\s+d['’]?\s*affaires/.test(t)) return 'chiffre_affaires';
  return null;
}
function libelleBaseMontantPe(b) {
  if (b === 'benefice_brut') return 'Bénéfice brut';
  if (b === 'marge_brute') return 'Marge brute';
  if (b === 'chiffre_affaires') return 'Chiffre d\u2019affaires';
  return '—';
}

const MOTS_CLES_PE = "nom|adresse|occupation|chiffre\\s+d['’]affaires|superficie|ann[ée]e\\s+de\\s+construction|ann[ée]e|base\\s+de\\s+valeur";
function prendreChampPE(partie, noms, reValeur) {
  const re = new RegExp(`\\b(?:${noms})(?:\\s+de)?\\s*[:=]?\\s*(${reValeur})(?=\\s+\\b(?:${MOTS_CLES_PE})\\b|\\s*[,;.]|\\s*$)`, 'i');
  const mm = partie.match(re);
  if (mm) return { val: mm[1].trim(), partie: partie.replace(mm[0], ' ') };
  return { val: null, partie };
}
const TEXTE_PE = `[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 '\\-]{0,40}?`;

function analyserAjouterEtablissementPE(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:un\s+|une\s+|le\s+|la\s+|l['’]\s*)?[ée]tablissements?(?:\s+assur[ée]s?)?\s+(.+)$/i);
  if (!m) return null;
  // Une soumission d'un autre produit explicite → pas une commande PE.
  if (/\bsoumission\s+(cyber|rc|biens?|flotte|cautionnement|e\s*[&/]\s*o|d\s*[&/\-]?\s*o)\b/i.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionPE(m[1]);
  let partie = ` ${reste} `;
  // Nom du lieu explicite : « nom Entrepôt » / « au nom de Entrepôt ».
  let nomLieu = null;
  const mn = partie.match(/\b(?:au\s+)?nom\s+(?:de\s+)?([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 '\-]{1,40}?)(?=\s*(?:[,;.]|adresse|occupation|chiffre|superficie|ann[ée]e|base de valeur|$))/i);
  if (mn && !/^(?:la\s+)?soumission/i.test(mn[1].trim())) {
    nomLieu = mn[1].trim(); partie = partie.replace(mn[0], ' ');
  }
  // Base de valeur (liste fermée — libellés des exports, cf. NOMS_BASE_VALEUR_PE).
  let baseValeur = null;
  const mbv = partie.match(/\bbase\s+de\s+valeur\s*[:=]?\s*(co[ûu]t\s+de\s+remplacement|valeur\s+d[ée]pr[ée]ci[ée]e|remplacement|d[ée]pr[ée]ciation)\b/i)
    || partie.match(/\b(co[ûu]t\s+de\s+remplacement|valeur\s+d[ée]pr[ée]ci[ée]e)\b/i);
  if (mbv) { baseValeur = normaliserBaseValeurPE(mbv[1]); partie = partie.replace(mbv[0], ' '); }
  let c = prendreChampPE(partie, 'ann[ée]e\\s+de\\s+construction|ann[ée]e', '19\\d{2}|20\\d{2}');
  const anneeConstruction = c.val ? Number(c.val) : null; partie = c.partie;
  c = prendreChampPE(partie, 'superficie', '\\d[\\d\\s]*');
  const superficie = c.val ? Number(c.val.replace(/\s+/g, '')) : null; partie = c.partie;
  // Forme « avec 750 000 $ de chiffre d'affaires » d'abord (le montant précède le champ).
  let chiffreAffaires = null;
  const mca = partie.match(/\bavec\s+(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?)\s*\$\s*de\s+chiffre\s+d['’]\s*affaires\b/i);
  if (mca) { chiffreAffaires = parserMontantRC(mca[1]); partie = partie.replace(mca[0], ' '); }
  if (chiffreAffaires === null) {
    c = prendreChampPE(partie, "chiffre\\s+d['’]affaires", '\\d[\\d\\s]*(?:[.,]\\d+)?\\s*(?:millions?|k\\b)?');
    chiffreAffaires = c.val ? parserMontantRC(c.val) : null; partie = c.partie;
  }
  c = prendreChampPE(partie, 'occupation', TEXTE_PE);
  const occupation = c.val; partie = c.partie;
  c = prendreChampPE(partie, 'adresse', TEXTE_PE);
  const adresse = c.val; partie = c.partie;
  // Nom du lieu : ce qui reste (nettoyé des prépositions résiduelles et de
  // « au nom de » du bout de la commande).
  if (!nomLieu) {
    let nom = partie.replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim();
    nom = nom.replace(/^(?:au|à|a|du|de|des|le|la|les|l['’]|avec|pour)\s+/i, '').trim();
    nom = nom.replace(/\s+(?:au\s+nom\s+de|au\s+nom|du|de|des|le|la|les|avec|pour)$/i, '').trim();
    nomLieu = nom || null;
  }
  return {
    action: 'ajouter_etablissement_pe',
    params: {
      soumission_pe_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      nom_lieu: nomLieu, adresse,
      occupation, chiffre_affaires: chiffreAffaires, superficie,
      annee_construction: anneeConstruction, base_valeur: baseValeur,
    },
  };
}

function analyserModifierGarantiesPE(t) {
  // Le marqueur perte d'exploitation est obligatoire : « garantie »/« franchise »
  // sont des concepts partagés entre les produits (auto, biens, RC, cyber, E&O, D&O, PE).
  if (!MARQUEUR_PE.test(t)) return null;
  // NB (étape 9/10 PE) : le garde-fou final n'est PAS un \b — en JavaScript,
  // « é » n'est pas un caractère \w, donc \b après « indemnité » suivi d'un
  // espace ne matche jamais et la commande « période d'indemnité » seule
  // était rejetée. Un lookahead négatif lettre/chiffre fait le même travail.
  if (!/\b(?:limite(?:s)?|p[ée]riode\s+d['’]?\s*indemnit[ée]|indemnit[ée]|franchise|d[ée]lai\s+de\s+carence|carence|base|garanties?|avenants?|frais\s+suppl[ée]mentaires|d[ée]pendance|acc[èe]s\s+civil|d[ée]t[ée]rioration\s+des?\s+stocks|prime)(?![\wÀ-ÿ])/i.test(t)) return null;
  const params = { soumission_pe_id: null, soumission_client: null };
  const { ref } = extraireRefSoumissionPE(t);
  if (ref) { params.soumission_pe_id = ref.id || null; params.soumission_client = ref.client || null; }
  const ml = t.match(/limite\s*(?:à|de|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?)/i);
  if (ml) {
    const v = parserMontantRC(ml[1]);
    if (v) params.limite = v;
  }
  const mpe = t.match(/(?:p[ée]riode\s+d['’]?\s*indemnit[ée]|indemnit[ée])\s*(?:à|de|=|:)?\s*(12|18|24)\s*(?:mois)?/i);
  if (mpe) params.periode_indemnite_mois = Number(mpe[1]);
  const mfr = t.match(/franchise\s*(?:\(.*?\)\s*)?(?:à|de|=|:)?\s*(\d+)\s*jours?/i)
    || t.match(/(?:d[ée]lai\s+de\s+)?carence\s*(?:à|de|=|:)?\s*(\d+)\s*jours?/i);
  if (mfr) params.franchise_jours = Number(mfr[1]);
  const mb = t.match(/\bbase\s+(?:d['’]?\s*indemnit[ée]\s+)?(?:à|de|=|:)?\s*(b[ée]n[ée]fice\s+brut|marge\s+brute|chiffre\s+d['’]\s*affaires)/i);
  if (mb) params.base_montant = normaliserBaseMontantPE(mb[1]);
  const mpr = t.match(/prime\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mpr) params.prime = Number(mpr[1].replace(/\s+/g, ''));
  // Avenants : ajout ET retrait (fusion — les champs non mentionnés restent).
  const avenants = {};
  const RETRAIT_PE = /(?:sans|retir\w*|enlev\w*|supprim\w*)\s+(?:l['’]\s*)?(?:avenant\s+)?/i;
  for (const [re, code] of AVENANTS_PE_ALIAS) {
    const avecRetrait = new RegExp(RETRAIT_PE.source + re.source, 'i');
    if (avecRetrait.test(t)) avenants[code] = 0;
    else if (re.test(t)) avenants[code] = 1;
  }
  if (Object.keys(avenants).length) params.avenants = avenants;
  if (params.limite === undefined && params.periode_indemnite_mois === undefined
    && params.franchise_jours === undefined && params.base_montant === undefined
    && params.prime === undefined && !params.avenants) return null;
  return { action: 'modifier_garanties_pe', params };
}

function analyserModifierEtablissementPE(t) {
  // « change l'occupation de l'établissement Fournil de la soumission perte d'exploitation 2 à commerce de détail »
  const m = t.match(/(?:change(?:r|z)?|modifi(?:e|er|ez)?|mets?|mettons|pass(?:e|er|ez)?)\s+(?:les?\s+|le\s+|la\s+|l['’]\s*)?(nom|occupation|chiffre\s+d['’]\s*affaires|superficie|ann[ée]e\s+(?:de\s+)?construction|base\s+(?:de\s+)?valeur)\s+(?:du|de\s+la|des?)\s+(?:l['’]\s*)?[ée]tablissement\s+(.+?)\s*$/i);
  if (!m) return null;
  // Une soumission d'un autre produit explicite → pas une commande PE.
  if (/\bsoumission\s+(cyber|rc|biens?|flotte|cautionnement|e\s*[&/]\s*o|d\s*[&/\-]?\s*o)\b/i.test(t)) return null;
  const champ = m[1].toLowerCase();
  // Valeur en fin de phrase : « … à commerce de détail ».
  const m2 = m[2].match(/(.+?)\s+[àa]\s*(.+?)\s*$/);
  if (!m2) return null; // sans valeur, ce n'est pas cette action
  const valeur = m2[2].trim().replace(/[,;.]+$/, '').replace(/\s+/g, ' ');
  if (!valeur) return null;
  const { ref, reste } = extraireRefSoumissionPE(m2[1]);
  let recherche = reste.replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:du|de|des|le|la|les|l['’])\s+/i, '').trim()
    .replace(/\s+(?:du|de|des|le|la|les)$/i, '').trim() || null;
  let etablissementIndex = null;
  if (recherche && /^\d+$/.test(recherche)) { etablissementIndex = Number(recherche); recherche = null; }
  const params = {
    soumission_pe_id: ref && ref.id ? ref.id : null,
    soumission_client: ref && ref.client ? ref.client : null,
    etablissement_index: etablissementIndex, etablissement_recherche: recherche,
  };
  if (/nom/.test(champ)) params.nom_lieu = valeur;
  else if (/occupation/.test(champ)) params.occupation = valeur;
  else if (/chiffre/.test(champ)) {
    const v = parserMontantRC(valeur);
    if (!v) return null;
    params.chiffre_affaires = v;
  } else if (/superficie/.test(champ)) {
    const n = Number(valeur.replace(/\D+/g, ''));
    if (isNaN(n)) return null;
    params.superficie = n;
  } else if (/ann[ée]e/.test(champ)) {
    const mm = valeur.match(/(?:19|20)\d{2}/);
    if (!mm) return null;
    params.annee_construction = Number(mm[0]);
  } else { // base de valeur
    const bv = normaliserBaseValeurPE(valeur);
    if (!bv) return null;
    params.base_valeur = bv;
  }
  return { action: 'modifier_etablissement_pe', params };
}

// --- Flotte automobile commerciale (étape 8/10 flotte) ------------------------------------------------
// LE point critique : « véhicule », « conducteur » et « garanties » sont
// PARTAGÉS avec le FPQ1 (auto personnelle). Règles de routage :
//   - le marqueur « flotte » est OBLIGATOIRE pour toute action flotte
//     (« soumission flotte N », « soumission flotte automobile N ») ;
//   - réciproquement, les analyseurs FPQ1 (ajouter_conducteur,
//     ajouter_vehicule, modifier_garantie) refusent toute commande portant
//     le marqueur flotte, et « soumission auto N » / « soumission
//     automobile N » (sans « flotte ») restent FPQ1 ;
//   - une commande « véhicule » sans produit nommé et sans référence de
//     soumission n'exécute RIEN : l'exécuteur FPQ1 répond par la demande de
//     précision existante (« Pour quelle soumission ? »), jamais par une
//     exécution silencieuse dans un produit ou dans l'autre ;
//   - les analyseurs des 6 autres produits refusent le marqueur flotte
//     (gardes bidirectionnelles), et les analyseurs flotte refusent tout
//     autre produit explicite.
const MARQUEUR_FLOTTE = /\bflotte\b/i;

const NOMBRES_MOTS_FLOTTE = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
  six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
};
function nombreFlotte(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return NOMBRES_MOTS_FLOTTE[t] || null;
}
const NUM_FLOTTE = '(\\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)';

function extraireRefSoumissionFlotte(texte) {
  const PROD = "(?:flotte(?:\\s+automobile)?)";
  // « à la soumission flotte 1 », « à la soumission flotte automobile un »
  let m = texte.match(new RegExp(
    `(?:^|\\s+)(?:à|dans|sur|de|pour)\\s+(?:la\\s+)?soumission\\s+${PROD}\\s+(?:n[°o]\\s*|#\\s*)?${NUM_FLOTTE}\\s*$`, 'i'));
  if (m) return { ref: { id: nombreFlotte(m[1]) }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(new RegExp(
    `(?:^|\\s+)(?:à|dans|sur|de|pour)\\s+(?:la\\s+)?soumission\\s+${PROD}\\s+de\\s+(.+?)\\s*$`, 'i'));
  if (m) return { ref: { client: m[1].trim() }, reste: texte.slice(0, m.index).trim() };
  // Référence au milieu de la phrase (« change le rayon du véhicule un de la
  // soumission flotte 2 à 150 km ») : on la retire, le reste est conservé.
  m = texte.match(new RegExp(
    `(?:^|\\s+)(?:à|dans|sur|de|pour)\\s+(?:la\\s+)?soumission\\s+${PROD}\\s+(?:n[°o]\\s*|#\\s*)?${NUM_FLOTTE}`, 'i'));
  if (m) return { ref: { id: nombreFlotte(m[1]) }, reste: (texte.slice(0, m.index) + ' ' + texte.slice(m.index + m[0].length)).trim() };
  // Le marqueur flotte est présent mais la référence est la forme courte :
  // « à la soumission 1 » vise alors la soumission flotte de l'action.
  return extraireRefSoumission(texte);
}

function resoudreSoumissionFlotte(cabinetId, utilisateur, ref) {
  const { trouverClient } = utilAssistant();
  let s = null;
  if (ref.id) {
    s = flotte.obtenirSoumission(Number(ref.id), cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission flotte #${ref.id}` };
  } else if (ref.client) {
    const rfl = trouverClient(cabinetId, ref.client);
    if (rfl.statut !== 'ok') return { statut: 'client', detail: rfl };
    const liste = bd.prepare(`
      SELECT id FROM flotte_soumissions WHERE cabinet_id = ? AND client_id = ? AND archive = 0 ORDER BY id DESC
    `).all(cabinetId, rfl.client.id);
    if (!liste.length) return { statut: 'aucune', client: rfl.client.raison_sociale };
    if (liste.length > 1) {
      return { statut: 'ambigue', ids: liste.map((l) => l.id), client: rfl.client.raison_sociale };
    }
    s = flotte.obtenirSoumission(liste[0].id, cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission flotte #${liste[0].id}` };
  } else {
    return { statut: 'manque' };
  }
  if (utilisateur && utilisateur.role === 'courtier'
    && clientHorsPortefeuille(cabinetId, utilisateur, s.client_id)) {
    return { statut: 'hors_portefeuille' };
  }
  return { statut: 'ok', soumission: s };
}

function messageErreurSoumissionFlotte(r) {
  switch (r.statut) {
    case 'introuvable':
      return `Je n'ai pas trouvé la ${r.recherche}. Vérifiez le numéro dans l'onglet Flotte.`;
    case 'manque':
      return 'Pour quelle soumission ? Précisez « à la soumission flotte 1 » ou « à la soumission flotte de Transport Lapointe inc. ».';
    case 'aucune':
      return `Aucune soumission flotte active pour ${r.client}. Créez-la d'abord dans l'onglet Flotte.`;
    case 'ambigue':
      return `Plusieurs soumissions flotte actives pour ${r.client} : ${r.ids.map((i) => '#' + i).join(', ')}. Précisez le numéro, s'il vous plaît.`;
    case 'hors_portefeuille':
      return "Cette soumission flotte n'est pas dans votre portefeuille. Je ne peux pas la modifier.";
    case 'client': {
      const d = r.detail;
      if (d.statut === 'ambigu') {
        return `Plusieurs entreprises correspondent : ${d.options.join(' · ')}. Précisez le nom exact, s'il vous plaît.`;
      }
      return `Je n'ai pas trouvé l'entreprise « ${d.recherche || '?'} ».`;
    }
    default:
      return 'Soumission flotte introuvable.';
  }
}

// --- Résolution : véhicule dans une soumission flotte -------------------------------------------------
function resoudreVehiculeFlotte(soumission, ref) {
  const vs = (soumission.vehicules || []).filter((v) => !v.archive);
  if (!vs.length) return { statut: 'aucun' };
  if (ref.index) {
    const v = vs[ref.index - 1];
    return v ? { statut: 'ok', vehicule: v } : { statut: 'introuvable' };
  }
  if (ref.niv) {
    const niv = String(ref.niv).toUpperCase().replace(/\s+/g, '');
    const v = vs.find((x) => String(x.niv || '').toUpperCase().replace(/\s+/g, '') === niv);
    return v ? { statut: 'ok', vehicule: v } : { statut: 'introuvable' };
  }
  if (ref.recherche) {
    const r = ref.recherche.toLowerCase();
    const trouves = vs.filter((x) => `${x.marque || ''} ${x.modele || ''}`.toLowerCase().includes(r));
    if (trouves.length === 1) return { statut: 'ok', vehicule: trouves[0] };
    if (trouves.length > 1) return { statut: 'ambigu', vehicules: trouves };
    return { statut: 'introuvable' };
  }
  return { statut: 'manque' };
}

// Types et usages fermés en base (CHECK lib/flotte.js) : on normalise le français.
function normaliserTypeVehiculeFlotte(v) {
  if (!v) return null;
  const t = String(v).toLowerCase();
  if (/camion/.test(t)) return 'camion';
  if (/remorque/.test(t)) return 'remorque';
  if (/[ée]quipement/.test(t)) return 'equipement';
  if (/automobile/.test(t)) return 'automobile';
  return null;
}
function libelleTypeVehiculeFlotte(c) {
  return { camion: 'Camion', automobile: 'Automobile', remorque: 'Remorque', equipement: 'Équipement' }[c] || '—';
}
function normaliserUsageFlotte(v) {
  if (!v) return null;
  const t = String(v).toLowerCase();
  if (/livraison/.test(t)) return 'livraison';
  if (/transport/.test(t)) return 'transport_marchandises';
  if (/service/.test(t)) return 'service';
  if (/personnel/.test(t)) return 'personnel';
  return null;
}
function libelleUsageFlotte(c) {
  return { livraison: 'Livraison', service: 'Service', transport_marchandises: 'Transport de marchandises', personnel: 'Personnel' }[c] || '—';
}

// Avenants FAQ flotte (clés JSON de flotte_garanties.avenants — cf. routes/flotte.js AVENANTS_FAQ).
const AVENANTS_FLOTTE = [
  ['faq43', 'FAQ 43 — Valeur à neuf'],
  ['faq20', 'FAQ 20 — Privation de jouissance'],
  ['faq27', 'FAQ 27 — Véhicule loué ou n’appartenant pas à l’assuré'],
  ['faq34', 'FAQ 34 — Indemnités d’accident'],
  ['faq5a', 'FAQ 5a — Crédit-bail'],
];
const AVENANTS_FLOTTE_ALIAS = [
  [/faq\s*43\b|avenant\s+43\b|valeur\s+à\s+neuf/i, 'faq43'],
  [/faq\s*20\b|avenant\s+20\b|privation\s+de\s+jouissance|frais\s+de\s+d[ée]placement/i, 'faq20'],
  [/faq\s*27\b|avenant\s+27\b|v[ée]hicule\s+(?:lou[ée]|de\s+location)|n['’]\s*appartenant\s+pas/i, 'faq27'],
  [/faq\s*34\b|avenant\s+34\b|indemnit[ée]s?\s+d['’]\s*accident|assurance\s+de\s+personnes|protection\s+du\s+conducteur/i, 'faq34'],
  [/faq\s*5\s*a\b|avenant\s+5\s*a\b|cr[ée]dit[-\s]?bail/i, 'faq5a'],
];

const AUTRE_PRODUIT_FLOTTE = /\bsoumission\s+(cyber|rc|biens?|cautionnement|e\s*[&/]\s*o|d\s*[&/\-]?\s*o)\b/i;

function analyserAjouterVehiculeFlotte(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:un\s+|une\s+|le\s+|la\s+)?(v[ée]hicules?|camions?|automobiles?|remorques?|[ée]quipements?)\s+(.+)$/i);
  if (!m) return null;
  // Marqueur flotte OBLIGATOIRE : sans lui, « véhicule » relève du FPQ1.
  if (!MARQUEUR_FLOTTE.test(t)) return null;
  if (AUTRE_PRODUIT_FLOTTE.test(t) || MARQUEUR_PE.test(t)) return null;
  const nomType = normaliserTypeVehiculeFlotte(m[1]);
  const { ref, reste } = extraireRefSoumissionFlotte(m[2]);
  let partie = ` ${reste} `;
  let vin = null;
  const mv = partie.match(/\b(?:vin|niv)\s*[:\-]?\s*([A-HJ-NPR-Z0-9]{9,20})\b/i)
    || partie.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (mv) { vin = mv[1].toUpperCase(); partie = partie.replace(mv[0], ' '); }
  // Valeur : « avec 45 000 $ de valeur » ou « valeur 45 000 $ ».
  let valeur = null;
  const mval = partie.match(/(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?)\s*\$\s*de\s+valeur/i)
    || partie.match(/\bvaleur\s*(?:de)?\s*[:=]?\s*(\d[\d\s]*)\s*\$?/i);
  if (mval) { valeur = parserMontantRC(mval[1]); partie = partie.replace(mval[0], ' '); }
  let rayon = null;
  const mr = partie.match(/\brayon(?:\s+d['’]\s*op[ée]ration)?\s*(?:de|à)?\s*(\d[\d\s]*)\s*km\b/i);
  if (mr) { rayon = Number(mr[1].replace(/\s+/g, '')); partie = partie.replace(mr[0], ' '); }
  let usage = null;
  const mu = partie.match(/\busage\s*[:=]?\s*(livraison|service|transport(?:\s+de)?\s+marchandises|personnel)\b/i)
    || partie.match(/\bpour\s+(?:la\s+|le\s+)?(livraison|service|personnel)\b/i);
  if (mu) { usage = normaliserUsageFlotte(mu[1]); partie = partie.replace(mu[0], ' '); }
  let typeVehicule = nomType;
  const mt = partie.match(/\b(camion|remorque|[ée]quipement|automobile)\b/i);
  if (mt) { typeVehicule = normaliserTypeVehiculeFlotte(mt[1]); partie = partie.replace(mt[0], ' '); }
  let annee = null;
  const ma = partie.match(/\b(19\d{2}|20\d{2})\b/);
  if (ma) { annee = Number(ma[1]); partie = partie.replace(ma[0], ' '); }
  const morceaux = partie.replace(/[,;.]+/g, ' ').split(/\s+/).filter(Boolean)
    .filter((w) => !/^(avec|pour|de|du|des|le|la|les|un|une|à|a)$/i.test(w));
  const marque = morceaux[0] || null;
  const modele = morceaux.slice(1).join(' ') || null;
  return {
    action: 'ajouter_vehicule_flotte',
    params: {
      soumission_flotte_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      annee, marque, modele, vin,
      type_vehicule: typeVehicule, usage,
      rayon_operation_km: rayon, valeur,
    },
  };
}

function analyserAjouterConducteurFlotte(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:un\s+|une\s+|le\s+|la\s+)?conducteurs?\s+(.+)$/i);
  if (!m) return null;
  // Marqueur flotte OBLIGATOIRE : sans lui, « conducteur » relève du FPQ1.
  if (!MARQUEUR_FLOTTE.test(t)) return null;
  if (AUTRE_PRODUIT_FLOTTE.test(t) || MARQUEUR_PE.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionFlotte(m[1]);
  let partie = reste;
  let anneesExperience = null;
  const me = partie.match(/(\d{1,2})\s*ans?\s+d['’]\s*exp[ée]rience/i)
    || partie.match(/\bexp[ée]rience\s*[:=]?\s*(\d{1,2})/i);
  if (me) { anneesExperience = Number(me[1]); partie = partie.replace(me[0], ' '); }
  let classePermis = null;
  const mc = partie.match(/\bclasse\s*(\d)\b/i);
  if (mc) { classePermis = mc[1]; partie = partie.replace(mc[0], ' '); }
  let numeroPermis = null;
  const mp = partie.match(/\s+permis\s*(?:de\s+conduire\s*)?(?:n[°o]\s*)?([A-Za-z0-9][A-Za-z0-9\-]{2,})\s*$/i);
  if (mp) { numeroPermis = mp[1].toUpperCase(); partie = partie.slice(0, mp.index).trim(); }
  partie = partie.replace(/[,;.]+$/, '').trim();
  const morceauxNom = partie.split(/\s+/).filter(Boolean);
  const prenom = morceauxNom[0] || null;
  const nom = morceauxNom.slice(1).join(' ') || null;
  return {
    action: 'ajouter_conducteur_flotte',
    params: {
      soumission_flotte_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      prenom, nom, numero_permis: numeroPermis,
      classe_permis: classePermis, annees_experience: anneesExperience,
    },
  };
}

function analyserModifierGarantiesFlotte(t) {
  // Le marqueur flotte est obligatoire : « garantie », « franchise », « limite
  // RC » et les avenants FAQ sont partagés avec le FPQ1 et les autres produits.
  if (!MARQUEUR_FLOTTE.test(t)) return null;
  if (AUTRE_PRODUIT_FLOTTE.test(t) || MARQUEUR_PE.test(t)) return null;
  // NB : pas de garde-fou \b après un mot accentué (« civile », « indemnité ») —
  // \w ignore « é » en JS ; le lookahead (?![\wÀ-ÿ]) fait le même travail (leçon PE).
  if (!/\b(?:limite(?:s)?|rc|responsabilit[ée]\s+civile|franchise|collision|versement|renversement|garanties?|avenants?|faq|valeur\s+à\s+neuf|privation\s+de\s+jouissance|cr[ée]dit[-\s]?bail|indemnit[ée]s?\s+d['’]\s*accident|prime)(?![\wÀ-ÿ])/i.test(t)) return null;
  const params = { soumission_flotte_id: null, soumission_client: null };
  const { ref } = extraireRefSoumissionFlotte(t);
  if (ref) { params.soumission_flotte_id = ref.id || null; params.soumission_client = ref.client || null; }
  const ml = t.match(/limite\s*(?:de\s+)?(?:rc|responsabilit[ée]\s+civile)?\s*(?:à|de|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?)/i)
    || t.match(/(?:\brc\b|responsabilit[ée]\s+civile)\s*(?:à|de|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?)/i);
  if (ml) {
    const v = parserMontantRC(ml[1]);
    if (v) params.limite_rc = v;
  }
  // Préposition « à » gérée (« franchise collision à 1 000 $ »), comme « délai de carence à » en PE.
  const mfc = t.match(/franchise\s*(?:de\s+)?collision\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mfc) params.franchise_collision = Number(mfc[1].replace(/\s+/g, ''));
  const mfv = t.match(/franchise\s*(?:de\s+)?(?:versement|renversement)\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mfv) params.franchise_versement = Number(mfv[1].replace(/\s+/g, ''));
  const mpr = t.match(/prime\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mpr) params.prime = Number(mpr[1].replace(/\s+/g, ''));
  // Avenants FAQ : ajout ET retrait (fusion — les champs non mentionnés restent).
  const avenants = {};
  const RETRAIT_FLOTTE = /(?:sans|retir\w*|enlev\w*|supprim\w*)\s+(?:l['’]\s*|la\s+|le\s+)?(?:avenant\s+)?/i;
  for (const [re, code] of AVENANTS_FLOTTE_ALIAS) {
    // L'alias est groupé : ses alternatives « | » ne doivent pas échapper au
    // préfixe de retrait (sinon « ajoute la valeur à neuf » deviendrait un retrait).
    const avecRetrait = new RegExp(RETRAIT_FLOTTE.source + '(?:' + re.source + ')', 'i');
    if (avecRetrait.test(t)) avenants[code] = 0;
    else if (re.test(t)) avenants[code] = 1;
  }
  if (Object.keys(avenants).length) params.avenants = avenants;
  if (params.limite_rc === undefined && params.franchise_collision === undefined
    && params.franchise_versement === undefined && params.prime === undefined
    && !params.avenants) return null;
  return { action: 'modifier_garanties_flotte', params };
}

function analyserModifierVehiculeFlotte(t) {
  // Marqueur flotte OBLIGATOIRE : sans lui, modifier un véhicule relève du FPQ1.
  if (!MARQUEUR_FLOTTE.test(t)) return null;
  if (AUTRE_PRODUIT_FLOTTE.test(t) || MARQUEUR_PE.test(t)) return null;
  if (!/\bv[ée]hicule(?![\wÀ-ÿ])/i.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionFlotte(t);
  const params = {
    soumission_flotte_id: ref && ref.id ? ref.id : null,
    soumission_client: ref && ref.client ? ref.client : null,
    vehicule_index: null, vehicule_recherche: null,
  };
  const corps = reste || t;
  const designerVehicule = (brut) => {
    const b = String(brut || '').trim().replace(/[,;.]+$/, '');
    const n = nombreFlotte(b);
    if (n) { params.vehicule_index = n; return true; }
    if (b) { params.vehicule_recherche = b; return true; }
    return false;
  };
  // Forme champ d'abord : « change le rayon du véhicule un … à 150 km »,
  // « mets la valeur du véhicule deux … à 45 000 $ ».
  const mA = corps.match(/(?:change(?:r|z)?|modifi(?:e|er|ez)?|mets?|mettons|pass(?:e|er|ez)?)\s+(?:la\s+|le\s+|l['’]\s*)?(valeur|rayon(?:\s+d['’]\s*op[ée]ration)?|usage|ann[ée]e)\s+(?:du|de\s+la|des?)\s+(?:le\s+|la\s+)?v[ée]hicule\s+(.+?)\s+[àa]\s*(.+?)\s*$/i);
  if (mA) {
    if (!designerVehicule(mA[2])) return null;
    const champ = mA[1].toLowerCase();
    const valeurBrute = mA[3].trim().replace(/[,;.]+$/, '');
    if (/valeur/.test(champ)) {
      const v = parserMontantRC(valeurBrute);
      if (!v) return null;
      params.valeur = v;
    } else if (/rayon/.test(champ)) {
      const n = Number(valeurBrute.replace(/\D+/g, ''));
      if (isNaN(n)) return null;
      params.rayon_operation_km = n;
    } else if (/usage/.test(champ)) {
      const u = normaliserUsageFlotte(valeurBrute);
      if (!u) return null;
      params.usage = u;
    } else { // année
      const mm = valeurBrute.match(/(?:19|20)\d{2}/);
      if (!mm) return null;
      params.annee = Number(mm[0]);
    }
    return { action: 'modifier_vehicule_flotte', params };
  }
  // Forme véhicule d'abord : « mets le véhicule deux à 45 000 $ de valeur »,
  // « mets le véhicule un à 150 km de rayon ».
  const mB = corps.match(/(?:mets?|mettons|pass(?:e|er|ez)?|change(?:r|z)?|modifi(?:e|er|ez)?)\s+(?:le\s+|la\s+)?v[ée]hicule\s+(.+?)\s+[àa]\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?)\s*(\$|km\b)/i);
  if (mB) {
    if (!designerVehicule(mB[1])) return null;
    const v = parserMontantRC(mB[2]);
    if (!v) return null;
    if (mB[3] === '$') params.valeur = v;
    else params.rayon_operation_km = v;
    return { action: 'modifier_vehicule_flotte', params };
  }
  return null;
}

// Types de mesure de sécurité (liste fermée — cf. routes/cyber.js TYPES_MESURE).
const TYPES_MESURE_ALIAS = [
  [/(?:authentification\s+multifacteur|multifacteur|mfa|\b2fa\b|double[\s\-]?facteur)/i, 'mfa'],
  [/sauvegardes?|backup/i, 'sauvegardes'],
  [/(?:antivirus(?:\s*\/\s*edr|\s+edr)?|edr)/i, 'antivirus_edr'],
  [/pare[\s\-]?feux?/i, 'pare_feu'],
  [/(?:formation\s+anti[\s\-]?hame[çc]onnage|formation|hame[çc]onnage|phishing)/i, 'formation_hameconnage'],
  [/plan\s+de\s+r[ée]ponse(?:\s+aux\s+incidents?)?/i, 'plan_reponse_incident'],
  [/chiffrement|encryption/i, 'chiffrement'],
  [/(?:gestion\s+des\s+correctifs|correctifs?|patch)/i, 'gestion_correctifs'],
  [/contr[ôo]le\s+d['’]acc[èe]s/i, 'controle_acces'],
];
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
// Niveaux de maturité (CHECK en base : cyber_mesures.statut).
const STATUTS_MESURE_ALIAS = [
  [/en\s+place|en\s+fonctionnement|d[ée]ploy[ée]/i, 'en_place'],
  [/partiel/i, 'partiel'],
  [/absent|inexistant|\baucun\b/i, 'absent'],
  [/pr[ée]vu|en\s+pr[ée]paration/i, 'prevu'],
];
const NOMS_STATUT_MESURE = {
  en_place: 'En place', partiel: 'Partiel', absent: 'Absent', prevu: 'Prévu',
};
function normaliserStatutMesure(v) {
  if (!v) return null;
  const t = String(v).toLowerCase().trim();
  for (const [re, val] of STATUTS_MESURE_ALIAS) {
    if (re.test(t)) return val;
  }
  return null;
}
// Avenants cyber (clés JSON de cyber_garanties.avenants).
const AVENANTS_CYBER = [
  ['rancongiciel', 'Rançongiciel'],
  ['fraude_transfert', 'Fraude par transfert de fonds'],
  ['donnees_vie_privee', 'Données et vie privée'],
  ['interruption', 'Interruption d’activité'],
];
const AVENANTS_CYBER_ALIAS = [
  [/ran[çc]ongiciel/i, 'rancongiciel'],
  [/fraude(?:\s+par\s+transfert(?:\s+de\s+fonds)?)?/i, 'fraude_transfert'],
  [/donn[ée]es?\s+et\s+vie\s+priv[ée]e|vie\s+priv[ée]e/i, 'donnees_vie_privee'],
  [/interruption/i, 'interruption'],
];

function analyserAjouterMesureCyber(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:un\s+|une\s+|le\s+|la\s+)?mesures?(?:\s+de\s+s[ée]curit[ée])?\s+(.+)$/i);
  if (!m) return null;
  // Un autre produit explicite → pas une commande cyber.
  if (/\bsoumission\s+(rc|biens?|flotte|e\s*[&/]\s*o|d\s*[&/\-]?\s*o)\b/i.test(t)) return null;
  if (MARQUEUR_PE.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionCyber(m[1]);
  let partie = ` ${reste} `;
  // Maturité (« en place », « partiel », « absent », « prévu »)
  let statut = null;
  const mst = partie.match(/\b(en\s+place|en\s+fonctionnement|partiel|absent|pr[ée]vu|en\s+pr[ée]paration)\b/i);
  if (mst) { statut = normaliserStatutMesure(mst[1]); partie = partie.replace(mst[0], ' '); }
  // Type de mesure
  let typeMesure = null;
  for (const [re, val] of TYPES_MESURE_ALIAS) {
    const mm = partie.match(re);
    if (mm) { typeMesure = val; partie = partie.replace(mm[0], ' '); break; }
  }
  if (!typeMesure) {
    const mautre = partie.match(/\bautre\b/i);
    if (mautre) { typeMesure = 'autre'; partie = partie.replace(mautre[0], ' '); }
  }
  // Détails : ce qui reste (texte libre — jamais touché autrement).
  let details = partie.replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim();
  details = details.replace(/^(?:au|à|a|du|de|des|le|la|les)\s+/i, '').trim() || null;
  let typeMesureTexte = null;
  if (!typeMesure) { typeMesureTexte = details; details = null; }
  return {
    action: 'ajouter_mesure_cyber',
    params: {
      soumission_cyber_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      type_mesure: typeMesure, type_mesure_texte: typeMesureTexte,
      statut, details,
    },
  };
}

function analyserModifierGarantiesCyber(t) {
  // Le marqueur « cyber » est obligatoire : « garantie » est un concept
  // partagé entre les produits (auto, biens, RC, cyber).
  if (!/\bcyber\b/i.test(t)) return null;
  // Un autre produit explicite → pas une commande cyber.
  if (/\bsoumission\s+(rc|biens?|flotte|e\s*[&/]\s*o|d\s*[&/\-]?\s*o)\b/i.test(t)) return null;
  if (MARQUEUR_PE.test(t)) return null;
  if (!/\b(?:limite(?:s)?|agr[ée]gat|franchise|carence|garanties?|avenants?|ran[çc]ongiciel|fraude|interruption|vie\s+priv[ée]e|prime)\b/i.test(t)) return null;
  const params = { soumission_cyber_id: null, soumission_client: null };
  const { ref } = extraireRefSoumissionCyber(t);
  if (ref) { params.soumission_cyber_id = ref.id || null; params.soumission_client = ref.client || null; }
  const mls = t.match(/limite\s*(?:par\s+(?:sinistre|occurrence))?\s*(?:à|de|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?|\d[\d\s]*)/i);
  if (mls) {
    const v = parserMontantRC(mls[1]);
    if (v) params.limite_par_sinistre = v;
  }
  const mag = t.match(/agr[ée]gat\s*(?:à|de|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?|\d[\d\s]*)/i);
  if (mag) {
    const v = parserMontantRC(mag[1]);
    if (v) params.limite_agregat = v;
  }
  const mfr = t.match(/franchise\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mfr) params.franchise = Number(mfr[1].replace(/\s+/g, ''));
  const mca = t.match(/carence\s*(?:de\s*)?(?:à|de|=|:)?\s*([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 '\-]{0,30}?)(?=\s+(?:pour|sur|de|à|au|et|limite|franchise|agr[ée]gat|avenant|ran[çc]ongiciel|fraude|interruption|prime)\b|\s*$)/i);
  if (mca) params.delai_carence = mca[1].trim();
  const mpr = t.match(/prime\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mpr) params.prime = Number(mpr[1].replace(/\s+/g, ''));
  // Avenants : ajout ET retrait (fusion — les champs non mentionnés restent).
  const avenants = {};
  const RETRAIT_CYB = /(?:sans|retir\w*|enlev\w*|supprim\w*)\s+(?:l['’]\s*)?(?:avenant\s+)?/i;
  for (const [re, code] of AVENANTS_CYBER_ALIAS) {
    const avecRetrait = new RegExp(RETRAIT_CYB.source + re.source, 'i');
    if (avecRetrait.test(t)) avenants[code] = 0;
    else if (re.test(t)) avenants[code] = 1;
  }
  if (Object.keys(avenants).length) params.avenants = avenants;
  if (params.limite_par_sinistre === undefined && params.limite_agregat === undefined
    && params.franchise === undefined && params.delai_carence === undefined
    && params.prime === undefined && !params.avenants) return null;
  return { action: 'modifier_garanties_cyber', params };
}

function analyserModifierMaturiteMesure(t) {
  if (!/(?:pass(?:e|er|es|ez)?|mets?|mettons|change(?:r|z)?|modifi(?:e|er|ez)?)\b/i.test(t)) return null;
  const m = t.match(/\bmesures?(?:\s+de\s+s[ée]curit[ée])?\s+(.+?)\s*$/i);
  if (!m) return null;
  // Un autre produit explicite → pas une commande cyber.
  if (/\bsoumission\s+(rc|biens?|flotte|e\s*[&/]\s*o|d\s*[&/\-]?\s*o)\b/i.test(t)) return null;
  if (MARQUEUR_PE.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionCyber(m[1]);
  let partie = ` ${reste} `;
  let statut = null;
  const mst = partie.match(/\b(en\s+place|en\s+fonctionnement|partiel|absent|pr[ée]vu|en\s+pr[ée]paration)\b/i);
  if (mst) { statut = normaliserStatutMesure(mst[1]); partie = partie.replace(mst[0], ' '); }
  if (!statut) return null; // sans maturité, ce n'est pas cette action
  let mesureIndex = null, mesureType = null;
  const mi = partie.match(/^\s*(\d+)\s*$/);
  if (mi) { mesureIndex = Number(mi[1]); partie = ' '; }
  else {
    for (const [re, val] of TYPES_MESURE_ALIAS) {
      const mm = partie.match(re);
      if (mm) { mesureType = val; partie = partie.replace(mm[0], ' '); break; }
    }
    if (!mesureType) {
      const mautre = partie.match(/\bautre\b/i);
      if (mautre) { mesureType = 'autre'; partie = partie.replace(mautre[0], ' '); }
    }
  }
  const residu = partie.replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:la|le|les|de|du|des)\s+/i, '').trim() || null;
  return {
    action: 'modifier_maturite_mesure',
    params: {
      soumission_cyber_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      mesure_index: mesureIndex, mesure_type: mesureType,
      mesure_type_texte: mesureType ? null : residu,
      statut,
    },
  };
}

// --- E&O / responsabilité professionnelle (étape 8/10 E&O) -----------------------------------------
// Marqueur de produit : « E&O », « e/o », « responsabilité professionnelle »,
// « erreurs et omissions ». Les analyseurs d'ajout sont intrinsèquement E&O
// (le nom « activité » est propre au produit) ; le modificateur de garanties
// exige le marqueur explicite (« garantie » est partagé entre les produits).
function extraireRefSoumissionEO(texte) {
  // « à la soumission E&O 1 », « pour la soumission E&O de Lussier »
  let m = texte.match(/(?:^|\s+)(?:à|dans|sur|de|pour)\s+(?:la\s+)?soumission\s+e\s*[&/]\s*o\s+(?:n[°o]\s*|#\s*)?(\d+)\s*$/i);
  if (m) return { ref: { id: Number(m[1]) }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(/(?:^|\s+)(?:à|dans|sur|de|pour)\s+(?:la\s+)?soumission\s+e\s*[&/]\s*o\s+de\s+(.+?)\s*$/i);
  if (m) return { ref: { client: m[1].trim() }, reste: texte.slice(0, m.index).trim() };
  // Référence au milieu de la phrase (« mets la franchise de la soumission E&O 1
  // à 10 000 $ ») : on la retire du texte, le reste est conservé des deux côtés.
  m = texte.match(/(?:^|\s+)(?:à|dans|sur|de|pour)\s+(?:la\s+)?soumission\s+e\s*[&/]\s*o\s+(?:n[°o]\s*|#\s*)?(\d+)/i);
  if (m) return { ref: { id: Number(m[1]) }, reste: (texte.slice(0, m.index) + ' ' + texte.slice(m.index + m[0].length)).trim() };
  // L'action est intrinsèquement « E&O » : « à la soumission 1 » vise une soumission E&O.
  return extraireRefSoumission(texte);
}

const MOTS_CLES_EO = 'chiffre\\s+d[\'’]affaires|professionnels?|notes';

function prendreChampEO(partie, noms, reValeur) {
  const re = new RegExp(`\\b(?:${noms})(?:\\s+de)?\\s*[:=]?\\s*(${reValeur})(?=\\s+\\b(?:${MOTS_CLES_EO})\\b|\\s*[,;.]|\\s*$)`, 'i');
  const mm = partie.match(re);
  if (mm) return { val: mm[1].trim(), partie: partie.replace(mm[0], ' ') };
  return { val: null, partie };
}

// Avenants E&O (clés JSON de eo_garanties.avenants).
const AVENANTS_EO = [
  ['frais_defense', 'Frais de défense'],
  ['medias_contenu', 'Médias et contenu'],
  ['cyber_associe', 'Cyber associé'],
];
const AVENANTS_EO_ALIAS = [
  [/frais\s+de\s+d[ée]fense/i, 'frais_defense'],
  [/m[ée]dias?(?:\s+et\s+contenu)?/i, 'medias_contenu'],
  [/cyber\s+associ[ée]/i, 'cyber_associe'],
];

function analyserAjouterActiviteEO(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:un\s+|une\s+|le\s+|la\s+|l['’]\s*)?activit[ée]s?(?:\s+professionnelles?)?\s+(.+)$/i);
  if (!m) return null;
  // Une soumission d'un autre produit explicite → pas une commande E&O.
  if (/\bsoumission\s+(cyber|rc|biens?|flotte|cautionnement|d\s*[&\/\-]?\s*o)\b/i.test(t)) return null;
  if (MARQUEUR_PE.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionEO(m[1]);
  let partie = ` ${reste} `;
  // Chiffre d'affaires : « chiffre d'affaires de 180 000 $ » OU
  // « avec 180 000 $ de chiffre d'affaires » (ordre inversé, dictée courante).
  let c = prendreChampEO(partie, 'chiffre\\s+d[\'’]affaires', '\\d[\\d\\s]*(?:[.,]\\d+)?\\s*(?:millions?|k\\b)?');
  let chiffreAffaires = c.val ? parserMontantRC(c.val) : null; partie = c.partie;
  if (chiffreAffaires === null) {
    const mv = partie.match(/(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?)\s*\$?\s*(?:de\s+)?chiffre\s+d['’]affaires/i);
    if (mv) { chiffreAffaires = parserMontantRC(mv[1]); partie = partie.replace(mv[0], ' '); }
  }
  // Nombre de professionnels : « 5 professionnels » OU « professionnels : 5 ».
  c = prendreChampEO(partie, 'professionnels?', '\\d+');
  let nbProfessionnels = c.val ? Number(c.val) : null; partie = c.partie;
  if (nbProfessionnels === null) {
    const mp2 = partie.match(/(\d+)\s+professionnels?/i);
    if (mp2) { nbProfessionnels = Number(mp2[1]); partie = partie.replace(mp2[0], ' '); }
  }
  // Description : ce qui reste, prépositions résiduelles nettoyées.
  let description = partie.replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim();
  description = description.replace(/^(?:au|à|a|du|de|des|le|la|les|l['’]|avec|pour)\s+/i, '').trim();
  description = description.replace(/\s+(?:au|à|a|du|de|des|le|la|les|avec|pour)$/i, '').trim();
  return {
    action: 'ajouter_activite_eo',
    params: {
      soumission_eo_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      description_activite: description || null,
      chiffre_affaires: chiffreAffaires, nb_professionnels: nbProfessionnels,
    },
  };
}

function analyserModifierGarantiesEO(t) {
  // Le marqueur E&O est obligatoire : « garantie » est un concept partagé
  // entre les produits (auto, biens, RC, cyber, E&O).
  if (!/\be\s*[&/]\s*o\b|responsabilit[ée]\s+professionnelle/i.test(t)) return null;
  if (!/\b(?:limite(?:s)?|agr[ée]gat|franchise|base|garanties?|avenants?|frais\s+de\s+d[ée]fense|m[ée]dias?|cyber\s+associ[ée]|prime)\b/i.test(t)) return null;
  const params = { soumission_eo_id: null, soumission_client: null };
  const { ref } = extraireRefSoumissionEO(t);
  if (ref) { params.soumission_eo_id = ref.id || null; params.soumission_client = ref.client || null; }
  const mls = t.match(/limite\s*(?:par\s+(?:sinistre|occurrence))?\s*(?:à|de|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?|\d[\d\s]*)/i);
  if (mls) {
    const v = parserMontantRC(mls[1]);
    if (v) params.limite_par_sinistre = v;
  }
  const mag = t.match(/agr[ée]gat\s*(?:à|de|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?|\d[\d\s]*)/i);
  if (mag) {
    const v = parserMontantRC(mag[1]);
    if (v) params.limite_agregat = v;
  }
  const mfr = t.match(/[àa]\s*(\d[\d\s]*)\s*\$\s*$/i) || t.match(/franchise\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mfr) params.franchise = Number(mfr[1].replace(/\s+/g, ''));
  const mb = t.match(/\bbase\s+(?:de\s+garantie\s+)?(?:à|de|=|:)?\s*(r[ée]clamations?[-\s]?pr[ée]sent[ée]es?|claims?[-\s]?made|occurrences?)/i);
  if (mb) {
    params.base = /occurr?ence/i.test(mb[1]) ? 'occurrences' : 'reclamations_presentees';
  }
  const mpr = t.match(/prime\s*(?:à|de|=|:)?\s*(\d[\d\s]*)\s*\$?/i);
  if (mpr) params.prime = Number(mpr[1].replace(/\s+/g, ''));
  // Avenants : ajout ET retrait (fusion — les champs non mentionnés restent).
  const avenants = {};
  const RETRAIT_EO = /(?:sans|retir\w*|enlev\w*|supprim\w*)\s+(?:l['’]\s*)?(?:avenant\s+)?/i;
  for (const [re, code] of AVENANTS_EO_ALIAS) {
    const avecRetrait = new RegExp(RETRAIT_EO.source + re.source, 'i');
    if (avecRetrait.test(t)) avenants[code] = 0;
    else if (re.test(t)) avenants[code] = 1;
  }
  if (Object.keys(avenants).length) params.avenants = avenants;
  if (params.limite_par_sinistre === undefined && params.limite_agregat === undefined
    && params.franchise === undefined && params.base === undefined
    && params.prime === undefined && !params.avenants) return null;
  return { action: 'modifier_garanties_eo', params };
}

function analyserModifierActiviteEO(t) {
  // « change le chiffre d'affaires de l'activité conseil fiscal de la
  // soumission E&O 2 à 200 000 $ »
  const m = t.match(/(?:change(?:r|z)?|modifi(?:e|er|ez)?|mets?|mettons|pass(?:e|er|ez)?)\s+(?:le\s+|la\s+)?chiffre\s+d['’]affaires\s+de\s+(?:l['’]\s*)?activit[ée](?:\s+professionnelle)?\s+(.+?)\s*$/i);
  if (!m) return null;
  // Une soumission d'un autre produit explicite → pas une commande E&O.
  if (/\bsoumission\s+(cyber|rc|biens?|flotte|cautionnement|d\s*[&\/\-]?\s*o)\b/i.test(t)) return null;
  if (MARQUEUR_PE.test(t)) return null;
  // Montant en fin de phrase : « … à 200 000 $ ».
  const m2 = m[1].match(/(.+?)\s+[àa]\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?)\s*\$?\s*$/i);
  if (!m2) return null; // sans montant, ce n'est pas cette action
  const chiffreAffaires = parserMontantRC(m2[2]);
  if (!chiffreAffaires) return null;
  const { ref, reste } = extraireRefSoumissionEO(m2[1]);
  let recherche = reste.replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:du|de|des|le|la|les|l['’])\s+/i, '').trim()
    .replace(/\s+(?:du|de|des|le|la|les)$/i, '').trim() || null;
  let activiteIndex = null;
  if (recherche && /^\d+$/.test(recherche)) { activiteIndex = Number(recherche); recherche = null; }
  return {
    action: 'modifier_activite_eo',
    params: {
      soumission_eo_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      activite_index: activiteIndex, activite_recherche: recherche,
      chiffre_affaires: chiffreAffaires,
    },
  };
}

function analyserCreerRappel(t) {
  const m0 = t.match(/^rappelle-?moi\s+d[e']\s+(.+)$/i);
  if (!m0) return null;
  const { analyserDate } = utilAssistant();
  let reste = m0[1].trim();
  // Date en fin de phrase (« le 2026-11-15 », « demain », « le 15 novembre »).
  let echeance = null;
  const md = reste.match(/\s+(?:le\s+)?(demain|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+\d{4})?)$/i);
  if (md) {
    echeance = analyserDate(md[1]);
    if (echeance) reste = reste.slice(0, md.index).trim();
  }
  if (!echeance) {
    const d = new Date(); d.setDate(d.getDate() + 1);
    echeance = d.toISOString().slice(0, 10);
  }
  // Entreprise : « pour X » en fin.
  let entreprise = null;
  const mp = reste.match(/\s+pour\s+(.+)$/i);
  if (mp) {
    entreprise = mp[1].trim().replace(/[,;.]+$/, '');
    reste = reste.slice(0, mp.index).trim();
  }
  const titre = reste.replace(/[,;.]+$/, '').trim();
  if (!titre) return null;
  return {
    action: 'creer_rappel',
    params: { titre, entreprise: entreprise || null, echeance },
  };
}

// Normalisation sans accents pour la reconnaissance des destinations
// (\b est peu fiable autour des caractères accentués sur ce Node).
function sansAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const DESTINATIONS = [
  [/soumission\s+rc\s+(?:n[°o]\s*|#\s*)?(\d+)/i, (mm) => ({ url: `/rc/${mm[1]}`, libelle: `la soumission RC #${mm[1]}` })],
  [/soumission\s+cyber\s+(?:n[°o]\s*|#\s*)?(\d+)/i, (mm) => ({ url: `/cyber/${mm[1]}`, libelle: `la soumission cyber #${mm[1]}` })],
  [/soumission\s+biens?\s+(?:n[°o]\s*|#\s*)?(\d+)/i, (mm) => ({ url: `/biens/${mm[1]}`, libelle: `la soumission biens #${mm[1]}` })],
  [/soumission\s+e\s*[&/]\s*o\s+(?:n[°o]\s*|#\s*)?(\d+)/i, (mm) => ({ url: `/eo/${mm[1]}`, libelle: `la soumission E&O #${mm[1]}` })],
  [/soumission\s+d\s*[&/\-]?\s*o\s+(?:n[°o]\s*|#\s*)?(\d+)/i, (mm) => ({ url: `/do/${mm[1]}`, libelle: `la soumission D&O #${mm[1]}` })],
  [/soumission\s+(?:perte\s+d['’]\s*exploitation|interruption\s+des\s+affaires|pe)\s+(?:n[°o]\s*|#\s*)?(\d+)/i, (mm) => ({ url: `/pe/${mm[1]}`, libelle: `la soumission perte d'exploitation #${mm[1]}` })],
  [/soumission\s+flotte(?:\s+automobile)?\s+(?:n[°o]\s*|#\s*)?(\d+)/i, (mm) => ({ url: `/flotte/${mm[1]}`, libelle: `la soumission flotte #${mm[1]}` })],
  [/soumission\s+(?:n[°o]\s*|#\s*)?(\d+)/i, (mm) => ({ url: `/auto/${mm[1]}`, libelle: `la soumission #${mm[1]}` })],
  [/\becheances?\b/i, () => ({ url: '/echeances', libelle: 'les échéances' })],
  [/\btaches?\b/i, () => ({ url: '/taches', libelle: 'les tâches' })],
  [/\bentreprises?\b|\bclients?\b/i, () => ({ url: '/clients', libelle: 'les entreprises' })],
  [/\bpolices?\b/i, () => ({ url: '/polices', libelle: 'les polices' })],
  [/\breclamations?\b|\bsinistres?\b/i, () => ({ url: '/reclamations', libelle: 'les réclamations' })],
  [/\bfactures?\b|\bfacturation\b/i, () => ({ url: '/facturation', libelle: 'la facturation' })],
  [/\bleads?\b|\bprospects?\b/i, () => ({ url: '/leads', libelle: 'les leads' })],
  [/\bcampagnes?\b/i, () => ({ url: '/campagnes', libelle: 'les campagnes' })],
  [/\bassureurs?\b/i, () => ({ url: '/assureurs', libelle: 'les assureurs' })],
  [/\bauto\b/i, () => ({ url: '/auto', libelle: "l'onglet Auto" })],
  [/\bbiens?\b/i, () => ({ url: '/biens', libelle: "l'onglet Biens" })],
  [/\brc\b/i, () => ({ url: '/rc', libelle: "l'onglet RC" })],
  [/\bcyber\b/i, () => ({ url: '/cyber', libelle: "l'onglet Cyber" })],
  [/\be\s*[&/]\s*o\b/i, () => ({ url: '/eo', libelle: "l'onglet E&O" })],
  [/\bd\s*[&/\-]?\s*o\b/i, () => ({ url: '/do', libelle: "l'onglet D&O" })],
  [/perte\s+d['’]\s*exploitation|interruption\s+des\s+affaires/i, () => ({ url: '/pe', libelle: "l'onglet Perte d'exploitation" })],
  [/\bflotte\b/i, () => ({ url: '/flotte', libelle: "l'onglet Flotte" })],
  [/\bcautionnements?\b/i, () => ({ url: '/cautionnement', libelle: "l'onglet Cautionnement" })],
  [/\bimport\b/i, () => ({ url: '/import', libelle: "l'import" })],
  [/\bexports?\b/i, () => ({ url: '/exports', libelle: 'les exports' })],
  [/\breunions?\b/i, () => ({ url: '/reunions', libelle: 'les réunions' })],
  [/\bbrouillons?\b/i, () => ({ url: '/brouillons', libelle: 'les brouillons' })],
  [/\bcourriels?\b/i, () => ({ url: '/courriels', libelle: 'les courriels' })],
  [/\btableau\s+de\s+bord\b|\baccueil\b/i, () => ({ url: '/', libelle: 'le tableau de bord' })],
];

function analyserAllerA(t) {
  const m = t.match(/^(?:montre(?:-moi)?|affiche(?:-moi)?|ouvre|ouvrir|va\s+(?:à|au|aux|sur)|emm[èe]ne(?:-moi)?\s+(?:à|au|aux|sur))\s+(?:la\s+|le\s+|les\s+|l['’])?(.+)$/i);
  if (!m) return null;
  const dest = sansAccents(m[1].trim());
  for (const [re, fab] of DESTINATIONS) {
    const mm = dest.match(re);
    if (mm) {
      const d = fab(mm);
      return { action: 'aller_a', params: { url: d.url, libelle: d.libelle } };
    }
  }
  return null;
}

function analyserRechercher(t) {
  const m = t.match(/^(?:cherche|chercher|r[eé]cherche(?:r)?|trouve(?:r)?)\s+(.+)$/i);
  if (!m) return null;
  const reste = m[1].trim();
  let mc = reste.match(/^(?:le\s+|la\s+|les\s+|un\s+|une\s+)?(?:client|entreprise)\s+(.+)$/i);
  if (mc) return { action: 'rechercher', params: { type: 'client', terme: mc[1].trim() } };
  mc = reste.match(/^(?:la\s+|une\s+)?police\s+(.+)$/i);
  if (mc) return { action: 'rechercher', params: { type: 'police', terme: mc[1].trim() } };
  mc = reste.match(/^(?:la\s+|une\s+)?soumission\s+(?:de\s+)?(.+)$/i);
  if (mc) return { action: 'rechercher', params: { type: 'soumission', terme: mc[1].trim() } };
  return { action: 'rechercher', params: { type: 'general', terme: reste } };
}

// --- Cautionnement (étape 8/10 cautionnement) ------------------------------------------------
// LE point critique : le mot « soumission » est PARTAGÉ par les 8 produits —
// « soumission 1 » seul désigne la référence courte FPQ1 (et « soumission
// flotte 1 » la flotte). Règles de routage :
//   - le marqueur « cautionnement » ou « caution » est OBLIGATOIRE pour toute
//     action cautionnement (« soumission cautionnement N ») ;
//   - réciproquement, les analyseurs des 7 autres produits refusent
//     « soumission cautionnement » (gardes bidirectionnelles), et les
//     analyseurs cautionnement refusent tout autre produit explicite ;
//   - « bénéficiaire » et « obligation » sont propres au cautionnement.
const MARQUEUR_CAUT = /\bcautionnements?\b|\bcaution\b/i;
const AUTRE_PRODUIT_CAUT = /\bsoumission\s+(cyber|rc|biens?|flotte|e\s*[&\/]\s*o|d\s*[&\/\-]?\s*o)\b/i;

const NOMBRES_MOTS_CAUT = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
  six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
};
function nombreCaut(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return NOMBRES_MOTS_CAUT[t] || null;
}
const NUM_CAUT = '(\\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)';

function extraireRefSoumissionCaut(texte) {
  const PROD = '(?:cautionnement)';
  let m = texte.match(new RegExp(
    `(?:^|\\s+)(?:à|dans|sur|de|pour)\\s+(?:la\\s+)?soumission\\s+${PROD}\\s+(?:n[°o]\\s*|#\\s*)?${NUM_CAUT}\\s*$`, 'i'));
  if (m) return { ref: { id: nombreCaut(m[1]) }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(new RegExp(
    `(?:^|\\s+)(?:à|dans|sur|de|pour)\\s+(?:la\\s+)?soumission\\s+${PROD}\\s+de\\s+(.+?)\\s*$`, 'i'));
  if (m) return { ref: { client: m[1].trim() }, reste: texte.slice(0, m.index).trim() };
  m = texte.match(new RegExp(
    `(?:^|\\s+)(?:à|dans|sur|de|pour)\\s+(?:la\\s+)?soumission\\s+${PROD}\\s+(?:n[°o]\\s*|#\\s*)?${NUM_CAUT}`, 'i'));
  if (m) return { ref: { id: nombreCaut(m[1]) }, reste: (texte.slice(0, m.index) + ' ' + texte.slice(m.index + m[0].length)).trim() };
  // Le marqueur cautionnement est présent mais la référence est la forme
  // courte : « à la soumission 1 » vise alors la soumission cautionnement.
  return extraireRefSoumission(texte);
}

function resoudreSoumissionCaut(cabinetId, utilisateur, ref) {
  const { trouverClient } = utilAssistant();
  let s = null;
  if (ref.id) {
    s = caut.obtenirSoumission(Number(ref.id), cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission cautionnement #${ref.id}` };
  } else if (ref.client) {
    const rcl = trouverClient(cabinetId, ref.client);
    if (rcl.statut !== 'ok') return { statut: 'client', detail: rcl };
    const liste = bd.prepare(`
      SELECT id FROM caut_soumissions WHERE cabinet_id = ? AND client_id = ? AND archive = 0 ORDER BY id DESC
    `).all(cabinetId, rcl.client.id);
    if (!liste.length) return { statut: 'aucune', client: rcl.client.raison_sociale };
    if (liste.length > 1) {
      return { statut: 'ambigue', ids: liste.map((l) => l.id), client: rcl.client.raison_sociale };
    }
    s = caut.obtenirSoumission(liste[0].id, cabinetId);
    if (!s) return { statut: 'introuvable', recherche: `soumission cautionnement #${liste[0].id}` };
  } else {
    return { statut: 'manque' };
  }
  if (utilisateur && utilisateur.role === 'courtier'
    && clientHorsPortefeuille(cabinetId, utilisateur, s.client_id)) {
    return { statut: 'hors_portefeuille' };
  }
  return { statut: 'ok', soumission: s };
}

function messageErreurSoumissionCaut(r) {
  switch (r.statut) {
    case 'introuvable':
      return `Je n'ai pas trouvé la ${r.recherche}. Vérifiez le numéro dans l'onglet Cautionnement.`;
    case 'manque':
      return 'Pour quelle soumission ? Précisez « à la soumission cautionnement 1 » ou « à la soumission cautionnement de Construction Verdon inc. ».';
    case 'aucune':
      return `Aucune soumission cautionnement active pour ${r.client}. Créez-la d'abord dans l'onglet Cautionnement.`;
    case 'ambigue':
      return `Plusieurs soumissions cautionnement actives pour ${r.client} : ${r.ids.map((i) => '#' + i).join(', ')}. Précisez le numéro, s'il vous plaît.`;
    case 'hors_portefeuille':
      return "Cette soumission cautionnement n'est pas dans votre portefeuille. Je ne peux pas la modifier.";
    case 'client': {
      const d = r.detail;
      if (d.statut === 'ambigu') {
        return `Plusieurs entreprises correspondent : ${d.options.join(' · ')}. Précisez le nom exact, s'il vous plaît.`;
      }
      return `Je n'ai pas trouvé l'entreprise « ${d.recherche || '?'} ».`;
    }
    default:
      return 'Soumission cautionnement introuvable.';
  }
}

const LIBELLES_TYPE_OBLIGATION_CAUT = {
  soumission: 'Cautionnement de soumission (bid bond)',
  execution: 'Cautionnement d’exécution (performance bond)',
  paiement_mo: 'Paiement de la main-d’œuvre et des matériaux',
  rbq: 'Cautionnement de licence RBQ',
  autre: 'Autre cautionnement',
};
function libelleTypeObligationCaut(code) {
  return LIBELLES_TYPE_OBLIGATION_CAUT[code] || code || '—';
}

// Type d'obligation en langage naturel (ordre : les plus spécifiques d'abord —
// « licence RBQ » avant « soumission », car « cautionnement de soumission »
// contient « soumission » mais désigne le bid bond, jamais l'exécution).
function normaliserTypeObligationCaut(texte) {
  const t = String(texte || '').toLowerCase();
  if (/ex[ée]cution|performance\s*bond/.test(t)) return 'execution';
  if (/paiement/.test(t) && /(main|mat[ée]riaux|\bmo\b)/.test(t)) return 'paiement_mo';
  if (/\brbq\b|r[ée]gie du b[âa]timent|licence/.test(t)) return 'rbq';
  if (/soumission|bid\s*bond/.test(t)) return 'soumission';
  if (/autre/.test(t)) return 'autre';
  return null;
}

// --- Résolution : obligation dans une soumission cautionnement --------------------------------
function resoudreObligationCaut(soumission, ref) {
  const os = (soumission.obligations || []).filter((o) => !o.archive);
  if (!os.length) return { statut: 'aucune' };
  if (ref.index) {
    const o = os[ref.index - 1];
    return o ? { statut: 'ok', obligation: o } : { statut: 'introuvable' };
  }
  if (ref.type) {
    const trouvees = os.filter((x) => x.type === ref.type);
    if (trouvees.length === 1) return { statut: 'ok', obligation: trouvees[0] };
    if (trouvees.length > 1) return { statut: 'ambigu', obligations: trouvees, type: ref.type };
    return { statut: 'introuvable' };
  }
  return { statut: 'manque' };
}

function analyserAjouterObligationCaut(t) {
  const m = t.match(/(?:ajout(?:er|e)?|rajout(?:er|e)?)\s+(?:une?\s+|le\s+|la\s+)?(obligations?|cautionnements?)\s+(.+)$/i);
  if (!m) return null;
  // Marqueur cautionnement OBLIGATOIRE : sans lui, « soumission » relève des
  // références courtes FPQ1/flotte — jamais d'exécution silencieuse.
  if (!MARQUEUR_CAUT.test(t)) return null;
  if (AUTRE_PRODUIT_CAUT.test(t) || MARQUEUR_PE.test(t) || MARQUEUR_FLOTTE.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionCaut(m[2]);
  let partie = reste;
  const type = normaliserTypeObligationCaut(partie);
  if (!type) return null;
  // Prime estimée d'abord (« prime estimée 13 750 $ »), puis contrat, puis le
  // montant du cautionnement = premier montant restant.
  let primeEstimee = null;
  const mpr = partie.match(/\bprime\s*(?:estim[ée]e)?\s*(?:de|à|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?)\s*\$?/i);
  if (mpr) { primeEstimee = parserMontantRC(mpr[1]); partie = partie.replace(mpr[0], ' '); }
  let montantContrat = null;
  const mc = partie.match(/\bcontrat\s*(?:de|à|=|:)?\s*(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?)\s*\$?/i);
  if (mc) { montantContrat = parserMontantRC(mc[1]); partie = partie.replace(mc[0], ' '); }
  let montantCautionnement = null;
  const mm = partie.match(/(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b)?)\s*\$/i)
    || partie.match(/(?:de|à)\s+(\d[\d\s]*(?:[.,]\d+)?\s*(?:millions?|k\b))/i)
    // Voix (étape 9/10) : la dictée normalisée donne des chiffres compacts
    // sans « $ » ni « millions » (« de 2000000 pour… »).
    || partie.match(/(?:de|à)\s+(\d{4,})/i);
  if (mm) { montantCautionnement = parserMontantRC(mm[1]); partie = partie.replace(mm[0], ' '); }
  // Projet : « projet X » jusqu'à la fin (la référence a déjà été retirée).
  let projet = null;
  const mpj = partie.match(/\bprojet\s+(.+?)\s*$/i);
  if (mpj) { projet = mpj[1].trim().replace(/[,;.]+$/, ''); partie = partie.slice(0, mpj.index).trim(); }
  // Bénéficiaire : « pour X » (le donneur d'ouvrage).
  let beneficiaire = null;
  const mb = partie.match(/\bpour\s+(?:le\s+b[ée]n[ée]ficiaire\s+|la\s+|le\s+)?(.+?)\s*$/i);
  if (mb) { beneficiaire = mb[1].trim().replace(/[,;.]+$/, ''); }
  return {
    action: 'ajouter_obligation_caut',
    params: {
      soumission_caut_id: ref && ref.id ? ref.id : null,
      soumission_client: ref && ref.client ? ref.client : null,
      type, beneficiaire, description_projet: projet,
      montant_contrat: montantContrat, montant_cautionnement: montantCautionnement,
      prime_estimee: primeEstimee,
    },
  };
}

function analyserModifierLigneCaut(t) {
  // Marqueur cautionnement OBLIGATOIRE : « limite », « prime » et « fonds de
  // roulement » ne doivent jamais router une commande d'un autre produit.
  if (!MARQUEUR_CAUT.test(t)) return null;
  if (AUTRE_PRODUIT_CAUT.test(t) || MARQUEUR_PE.test(t) || MARQUEUR_FLOTTE.test(t)) return null;
  if (!/\b(?:limite|ligne|fonds\s+de\s+roulement|valeur\s+nette|prime|capacit[ée])(?![\wÀ-ÿ])/i.test(t)) return null;
  const params = { soumission_caut_id: null, soumission_client: null };
  const { ref } = extraireRefSoumissionCaut(t);
  if (ref) { params.soumission_caut_id = ref.id || null; params.soumission_client = ref.client || null; }
  const MONTANT = '(\\d[\\d\\s]*(?:[.,]\\d+)?\\s*(?:millions?|k\\b)?)';
  const mg = t.match(new RegExp(`limite\\s+globale\\s*(?:à|de|=|:)?\\s*${MONTANT}`, 'i'));
  if (mg) { const v = parserMontantRC(mg[1]); if (v) params.limite_globale = v; }
  const mp = t.match(new RegExp(`limite\\s+par\\s+projet\\s*(?:à|de|=|:)?\\s*${MONTANT}`, 'i'));
  if (mp) { const v = parserMontantRC(mp[1]); if (v) params.limite_par_projet = v; }
  const mf = t.match(new RegExp(`fonds\\s+de\\s+roulement\\s*(?:à|de|=|:)?\\s*${MONTANT}\\s*\\$?`, 'i'));
  if (mf) { const v = parserMontantRC(mf[1]); if (v) params.fonds_roulement = v; }
  const mv = t.match(new RegExp(`valeur\\s+nette\\s*(?:à|de|=|:)?\\s*${MONTANT}\\s*\\$?`, 'i'));
  if (mv) { const v = parserMontantRC(mv[1]); if (v) params.valeur_nette = v; }
  const mpr = t.match(new RegExp(`prime\\s*(?:de\\s+la\\s+ligne)?\\s*(?:à|de|=|:)?\\s*${MONTANT}\\s*\\$?`, 'i'));
  if (mpr) { const v = parserMontantRC(mpr[1]); if (v) params.prime = v; }
  if (params.limite_globale === undefined && params.limite_par_projet === undefined
    && params.fonds_roulement === undefined && params.valeur_nette === undefined
    && params.prime === undefined) return null;
  return { action: 'modifier_ligne_caut', params };
}

function analyserModifierObligationCaut(t) {
  if (!MARQUEUR_CAUT.test(t)) return null;
  if (AUTRE_PRODUIT_CAUT.test(t) || MARQUEUR_PE.test(t) || MARQUEUR_FLOTTE.test(t)) return null;
  if (!/\bobligation(?![\wÀ-ÿ])/i.test(t)) return null;
  if (!/(?:change(?:r|z)?|modifi(?:e|er|ez)?|mets?|mettons|pass(?:e|er|ez)?|ajust(?:e|er|ez)?)/i.test(t)) return null;
  const { ref, reste } = extraireRefSoumissionCaut(t);
  const params = {
    soumission_caut_id: ref && ref.id ? ref.id : null,
    soumission_client: ref && ref.client ? ref.client : null,
    obligation_index: null, obligation_type: null,
  };
  const corps = reste || t;
  // Désignation : « l'obligation 2 », « l'obligation n° 2 » (chiffres) ou par type.
  const mi = corps.match(/\bobligation\s+(?:n[°o]\s*|#\s*)?(\d+)\b/i);
  if (mi) params.obligation_index = Number(mi[1]);
  else {
    const mw = corps.match(/\bobligation\s+(un|une|deux|trois|quatre|cinq)\s+(?:à|de|pour|sur)\b/i);
    if (mw) params.obligation_index = nombreCaut(mw[1]);
    else params.obligation_type = normaliserTypeObligationCaut(corps);
  }
  if (!params.obligation_index && !params.obligation_type) return null;
  const MONTANT = '(\\d[\\d\\s]*(?:[.,]\\d+)?\\s*(?:millions?|k\\b)?)';
  const mm = corps.match(new RegExp(`montant\\s*(?:du\\s+cautionnement|de\\s+l['’]\\s*obligation)?\\s*(?:à|de|=|:)?\\s*${MONTANT}\\s*\\$?`, 'i'))
    || corps.match(new RegExp(`\\sà\\s+${MONTANT}\\s*\\$`, 'i'));
  if (mm) { const v = parserMontantRC(mm[1]); if (v) params.montant_cautionnement = v; }
  const mc = corps.match(new RegExp(`\\bcontrat\\s*(?:à|de|=|:)?\\s*${MONTANT}\\s*\\$?`, 'i'));
  if (mc) { const v = parserMontantRC(mc[1]); if (v) params.montant_contrat = v; }
  const mpr = corps.match(new RegExp(`prime\\s*(?:estim[ée]e\\s*)?(?:à|de|=|:)?\\s*${MONTANT}\\s*\\$?`, 'i'));
  if (mpr) { const v = parserMontantRC(mpr[1]); if (v) params.prime_estimee = v; }
  const mb = corps.match(/\bb[ée]n[ée]ficiaire\s+(?:à|de|=|:)?\s*(.+?)\s*$/i);
  if (mb) params.beneficiaire = mb[1].trim().replace(/[,;.]+$/, '');
  if (params.montant_cautionnement === undefined && params.montant_contrat === undefined
    && params.prime_estimee === undefined && params.beneficiaire === undefined) return null;
  return { action: 'modifier_obligation_caut', params };
}

function analyser(texte) {
  const t = String(texte || '').trim();
  if (!t) return null;
  // Ordre : les actions les plus spécifiques d'abord (évite les collisions
  // avec l'analyseur historique de lib/assistant.js, essayé ensuite).
  return analyserCombinee(t)
    || analyserAjouterObligationCaut(t)
    || analyserModifierLigneCaut(t)
    || analyserModifierObligationCaut(t)
    || analyserAjouterVehiculeFlotte(t)
    || analyserAjouterConducteurFlotte(t)
    || analyserModifierVehiculeFlotte(t)
    || analyserModifierGarantiesFlotte(t)
    || analyserModifierGarantie(t)
    || analyserAjouterConducteur(t)
    || analyserAjouterVehicule(t)
    || analyserModifierGarantieBiens(t)
    || analyserAjouterBatiment(t)
    || analyserAjouterContenu(t)
    || analyserModifierGarantiesRC(t)
    || analyserAjouterLieuRC(t)
    || analyserAjouterActiviteEO(t)
    || analyserModifierGarantiesEO(t)
    || analyserModifierActiviteEO(t)
    || analyserAjouterDirigeantDO(t)
    || analyserModifierGarantiesDO(t)
    || analyserModifierDirigeantDO(t)
    || analyserAjouterEtablissementPE(t)
    || analyserModifierGarantiesPE(t)
    || analyserModifierEtablissementPE(t)
    || analyserAjouterMesureCyber(t)
    || analyserModifierGarantiesCyber(t)
    || analyserModifierMaturiteMesure(t)
    || analyserCreerRappel(t)
    || analyserAllerA(t)
    || analyserRechercher(t);
}

// --- Soumission combinée (étape 10/10 combinée) ------------------------------------------------------
// Commandes minimales : créer un dossier combiné pour un client, ouvrir le
// dossier combiné d'un client. Toute l'exécution passe par lib/combine.js.
function analyserCombinee(t) {
  let m = t.match(/cr[ée]er?\s+(?:une\s+|un\s+)?(?:soumission\s+)?combin[ée]e\s+(?:pour\s+|de\s+|à\s+)?(.+)$/i);
  if (m) return { action: 'creer_combinee', params: { client: m[1].trim() } };
  m = t.match(/(?:ouvr(?:e|ir|ez)|affiche[rz]?|montre[rz]?)\s+(?:la\s+|le\s+|une\s+)?(?:soumission\s+)?combin[ée]e\s*(?:de\s+|du\s+|pour\s+)?(.*)$/i);
  if (m) {
    const reste = (m[1] || '').trim();
    if (/^\d+$/.test(reste)) return { action: 'ouvrir_combinee', params: { dossier_id: Number(reste) } };
    return { action: 'ouvrir_combinee', params: { client: reste || null } };
  }
  return null;
}

function resoudreClientCombinee(cabinetId, utilisateur, nom) {
  const terme = String(nom || '').trim();
  if (!terme) return { statut: 'message', texte: 'Pour quel client ? Exemple : « crée une soumission combinée pour Bijouterie Exemple ».' };
  const trouves = bd.prepare(`
    SELECT id, raison_sociale FROM clients
    WHERE cabinet_id = ? AND archive = 0 AND lower(raison_sociale) LIKE lower(?)
    ORDER BY raison_sociale LIMIT 6
  `).all(cabinetId, `%${terme}%`)
    .filter((c) => !(utilisateur.role === 'courtier' && clientHorsPortefeuille(cabinetId, utilisateur, c.id)));
  if (!trouves.length) return { statut: 'message', texte: `Aucune entreprise trouvée pour « ${terme} ». Vérifiez le nom ou créez d\u2019abord la fiche client.` };
  if (trouves.length > 1) {
    return { statut: 'message', texte: `Plusieurs entreprises correspondent à « ${terme} » : ${trouves.map((c) => c.raison_sociale).join(', ')}. Précisez le nom complet.` };
  }
  return { statut: 'ok', client: trouves[0] };
}

function execCreerCombinee(cabinetId, utilisateur, p, confirme) {
  const combine = require('./combine');
  let client = null;
  if (p.client_id) {
    client = bd.prepare('SELECT id, raison_sociale FROM clients WHERE id = ? AND cabinet_id = ? AND archive = 0')
      .get(Number(p.client_id), cabinetId) || null;
    if (!client) return { statut: 'message', texte: 'Entreprise introuvable.' };
    if (utilisateur.role === 'courtier' && clientHorsPortefeuille(cabinetId, utilisateur, client.id)) {
      return { statut: 'message', texte: 'Cette entreprise ne fait pas partie de votre portefeuille.' };
    }
  } else {
    const r = resoudreClientCombinee(cabinetId, utilisateur, p.client);
    if (r.statut !== 'ok') return { statut: 'message', texte: r.texte };
    client = r.client;
  }
  if (!confirme) {
    return {
      statut: 'confirmation',
      resume: `Je vais créer un dossier de soumission combinée (biens + RC + perte d\u2019exploitation) pour ${client.raison_sociale}. Confirmez-vous ?`,
      commande: { action: 'creer_combinee', params: { client_id: client.id, client: client.raison_sociale } },
    };
  }
  const id = combine.creerDossier({ cabinetId, userId: utilisateur.id, clientId: client.id });
  return {
    statut: 'message',
    texte: `C'est fait : dossier combiné #${id} créé pour ${client.raison_sociale} (3 soumissions liées). Voir : /combinees/${id}`,
  };
}

function execOuvrirCombinee(cabinetId, utilisateur, p) {
  const combine = require('./combine');
  if (p.dossier_id) {
    const d = combine.obtenirDossier(Number(p.dossier_id), cabinetId);
    if (!d) return { statut: 'message', texte: `Dossier combiné #${p.dossier_id} introuvable.` };
    if (utilisateur.role === 'courtier' && clientHorsPortefeuille(cabinetId, utilisateur, d.client_id)) {
      return { statut: 'message', texte: 'Ce dossier ne fait pas partie de votre portefeuille.' };
    }
    return { statut: 'redirection', url: `/combinees/${d.id}`, texte: `Je vous emmène vers le dossier combiné #${d.id}…` };
  }
  const r = resoudreClientCombinee(cabinetId, utilisateur, p.client);
  if (r.statut !== 'ok') return { statut: 'message', texte: r.texte };
  const dossiers = combine.listerDossiers(cabinetId).filter((x) => x.client_id === r.client.id);
  if (!dossiers.length) {
    return { statut: 'message', texte: `${r.client.raison_sociale} n\u2019a pas encore de dossier combiné. Dites « crée une soumission combinée pour ${r.client.raison_sociale} » pour le créer.` };
  }
  const d = dossiers[0];
  return { statut: 'redirection', url: `/combinees/${d.id}`, texte: `Je vous emmène vers le dossier combiné #${d.id} de ${r.client.raison_sociale}…` };
}

// --- Exécuteurs ------------------------------------------------------------------------------------
function execAjouterConducteur(cabinetId, utilisateur, p, confirme) {
  if (!p.prenom || !p.nom) {
    return { statut: 'message', texte: 'Quel est le nom complet du conducteur ? Exemple : « ajoute un conducteur Marie Tremblay permis T1234567 à la soumission 1 ».' };
  }
  const r = resoudreSoumission(cabinetId, utilisateur, { id: p.soumission_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumission(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  if (!confirme) {
    const resume = `Je vais ajouter le conducteur ${p.prenom} ${p.nom}`
      + (p.numero_permis ? ` (permis ${p.numero_permis})` : ' (sans n° de permis — pourrez-vous le préciser ?)')
      + ` à la soumission #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_conducteur', params: p } };
  }
  const data = { prenom: p.prenom, nom: p.nom };
  if (p.numero_permis) data.numero_permis = p.numero_permis;
  const id = fpq1.ajouterConducteur(s.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : ${p.prenom} ${p.nom} ajouté comme conducteur à la soumission #${s.id} (${nomClient}). Voir : /auto/${s.id}`,
  };
}

function execAjouterVehicule(cabinetId, utilisateur, p, confirme) {
  if (!p.marque) {
    return { statut: 'message', texte: 'Quel est le véhicule ? Exemple : « ajoute un véhicule Honda CR-V 2022 vin 2HKRW2H54NH123456 à la soumission 1 ».' };
  }
  const r = resoudreSoumission(cabinetId, utilisateur, { id: p.soumission_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumission(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  const lib = `${p.annee || ''} ${p.marque} ${p.modele || ''}`.trim();
  if (!confirme) {
    const resume = `Je vais ajouter le véhicule ${lib}${p.vin ? ` (NIV ${p.vin})` : ''}`
      + ` à la soumission #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_vehicule', params: p } };
  }
  fpq1.ajouterVehicule(s.id, cabinetId, utilisateur.id, {
    annee: p.annee || null, marque: p.marque, modele: p.modele || null, vin: p.vin || null,
  });
  return {
    statut: 'message',
    texte: `C'est fait : véhicule ${lib} ajouté à la soumission #${s.id} (${nomClient}). Voir : /auto/${s.id}`,
  };
}

function execModifierGarantie(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumission(cabinetId, utilisateur, { id: p.soumission_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumission(r) };
  const s = r.soumission;
  const rv = resoudreVehicule(s, {
    index: p.vehicule_index, vin: p.vehicule_vin, recherche: p.vehicule_recherche,
  });
  if (rv.statut !== 'ok') {
    if (rv.statut === 'aucun') return { statut: 'message', texte: `La soumission #${s.id} ne contient aucun véhicule pour l'instant.` };
    if (rv.statut === 'ambigu') {
      return { statut: 'message', texte: `Plusieurs véhicules correspondent : ${rv.vehicules.map(libelleVehicule).join(' · ')}. Précisez, s'il vous plaît.` };
    }
    return { statut: 'message', texte: `Je n'ai pas trouvé ce véhicule dans la soumission #${s.id}.` };
  }
  const v = rv.vehicule;
  const cols = colonnesConnues('auto_garanties');
  const actuel = v.garanties || {};
  const data = {};
  if (cols.has('rc_montant')) data.rc_montant = p.rc_montant !== undefined ? p.rc_montant : (actuel.rc_montant ?? null);
  if (cols.has('protection_b')) data.protection_b = p.protection_b || actuel.protection_b || null;
  if (cols.has('franchise_b')) data.franchise_b = p.franchise_b !== undefined ? p.franchise_b : (actuel.franchise_b ?? null);
  if (cols.has('avenants')) data.avenants = actuel.avenants || {};
  const morceaux = [];
  if (p.rc_montant !== undefined) morceaux.push(`RC ${Number(p.rc_montant).toLocaleString('fr-CA')} $`);
  if (p.protection_b) morceaux.push(`protection B : ${p.protection_b.toUpperCase()}`);
  if (p.franchise_b !== undefined) morceaux.push(`franchise ${Number(p.franchise_b).toLocaleString('fr-CA')} $`);
  if (!confirme) {
    const resume = `Je vais modifier les garanties du ${libelleVehicule(v)} (soumission #${s.id}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_garantie', params: { ...p, vehicule_id: v.id } },
    };
  }
  fpq1.definirGaranties(v.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : garanties du ${libelleVehicule(v)} mises à jour (${morceaux.join(', ')}). Voir : /auto/${s.id}`,
  };
}

// --- Exécuteurs biens (étape 8/10 biens) ---------------------------------------------------------------
function execAjouterBatiment(cabinetId, utilisateur, p, confirme) {
  if (!p.adresse) {
    return { statut: 'message', texte: 'Quelle est l\u2019adresse du bâtiment ? Exemple : « ajoute un bâtiment au 123 rue Principale à Montréal à la soumission biens 1 ».' };
  }
  if (p.type_construction_texte && !p.type_construction) {
    return { statut: 'message', texte: `Type de construction « ${p.type_construction_texte} » non reconnu. Choix possibles : bois, acier, béton, maçonnerie ou mixte. Reformulez, s'il vous plaît.` };
  }
  const r = resoudreSoumissionBiens(cabinetId, utilisateur, { id: p.soumission_biens_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionBiens(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  if (!confirme) {
    const resume = `Je vais ajouter le bâtiment ${p.adresse}${p.ville ? ', ' + p.ville : ''}`
      + ` à la soumission biens #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_batiment', params: p } };
  }
  biens.ajouterBatiment(s.id, cabinetId, utilisateur.id, {
    adresse: p.adresse, ville: p.ville || null, type_construction: p.type_construction || null,
    annee_construction: p.annee_construction || null, superficie_pi2: p.superficie_pi2 || null,
    occupation: p.occupation || null, valeur_batiment: p.valeur_batiment || null,
  });
  return {
    statut: 'message',
    texte: `C'est fait : bâtiment ${p.adresse} ajouté à la soumission biens #${s.id} (${nomClient}). Voir : /biens/${s.id}`,
  };
}

function execAjouterContenu(cabinetId, utilisateur, p, confirme) {
  if (!p.description) {
    return { statut: 'message', texte: 'Quel contenu dois-je ajouter ? Exemple : « ajoute un contenu outillage 50000 $ au bâtiment 1 de la soumission biens 1 ».' };
  }
  const r = resoudreSoumissionBiens(cabinetId, utilisateur, { id: p.soumission_biens_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionBiens(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  let batimentId = null;
  let precisionBatiment = '';
  if (p.batiment_index || p.batiment_recherche) {
    const rb = resoudreBatiment(s, { index: p.batiment_index, recherche: p.batiment_recherche });
    if (rb.statut !== 'ok') {
      if (rb.statut === 'aucun') return { statut: 'message', texte: `La soumission biens #${s.id} ne contient aucun bâtiment pour l'instant. Ajoutez-en un d'abord.` };
      if (rb.statut === 'ambigu') {
        return { statut: 'message', texte: `Plusieurs bâtiments correspondent : ${rb.batiments.map(libelleBatiment).join(' · ')}. Précisez, s'il vous plaît.` };
      }
      return { statut: 'message', texte: `Je n'ai pas trouvé ce bâtiment dans la soumission biens #${s.id}.` };
    }
    batimentId = rb.batiment.id;
    precisionBatiment = ` au bâtiment « ${libelleBatiment(rb.batiment)} »`;
  }
  if (!confirme) {
    const resume = `Je vais ajouter le contenu « ${p.description} »`
      + (p.valeur ? ` (valeur ${Number(p.valeur).toLocaleString('fr-CA')} $)` : '')
      + precisionBatiment + ` à la soumission biens #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_contenu', params: p } };
  }
  biens.ajouterContenu(s.id, cabinetId, utilisateur.id,
    { description: p.description, valeur: p.valeur ?? null }, batimentId);
  return {
    statut: 'message',
    texte: `C'est fait : contenu « ${p.description} » ajouté${precisionBatiment} à la soumission biens #${s.id} (${nomClient}). Voir : /biens/${s.id}`,
  };
}

function execModifierGarantieBiens(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionBiens(cabinetId, utilisateur, { id: p.soumission_biens_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionBiens(r) };
  const s = r.soumission;
  const rb = resoudreBatiment(s, { index: p.batiment_index, recherche: p.batiment_recherche });
  if (rb.statut !== 'ok') {
    if (rb.statut === 'aucun') return { statut: 'message', texte: `La soumission biens #${s.id} ne contient aucun bâtiment pour l'instant.` };
    if (rb.statut === 'ambigu') {
      return { statut: 'message', texte: `Plusieurs bâtiments correspondent : ${rb.batiments.map(libelleBatiment).join(' · ')}. Précisez, s'il vous plaît.` };
    }
    return { statut: 'message', texte: `Je n'ai pas trouvé ce bâtiment dans la soumission biens #${s.id}.` };
  }
  const b = rb.batiment;
  const actuel = b.garanties || {};
  const data = {
    formule: p.formule || actuel.formule || null,
    franchise: p.franchise !== undefined ? p.franchise : (actuel.franchise ?? null),
    montant_assurance: p.montant_assurance !== undefined ? p.montant_assurance : (actuel.montant_assurance ?? null),
    avenants: actuel.avenants || null,
  };
  const morceaux = [];
  if (p.formule) morceaux.push(`formule ${p.formule === 'tous_risques' ? 'tous risques' : 'risques désignés'}`);
  if (p.franchise !== undefined) morceaux.push(`franchise ${Number(p.franchise).toLocaleString('fr-CA')} $`);
  if (p.montant_assurance !== undefined) morceaux.push(`montant ${Number(p.montant_assurance).toLocaleString('fr-CA')} $`);
  if (!confirme) {
    const resume = `Je vais modifier les garanties du bâtiment « ${libelleBatiment(b)} » (soumission biens #${s.id}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_garantie_biens', params: { ...p, batiment_id: b.id } },
    };
  }
  biens.definirGaranties(b.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : garanties du bâtiment « ${libelleBatiment(b)} » mises à jour (${morceaux.join(', ')}). Voir : /biens/${s.id}`,
  };
}

// --- Exécuteurs RC (étape 8/10 RC) ----------------------------------------------------------------------
function execAjouterLieuRC(cabinetId, utilisateur, p, confirme) {
  if (!p.adresse) {
    return { statut: 'message', texte: 'Quelle est l\u2019adresse du lieu d\u2019exploitation ? Exemple : « ajoute un lieu au 456 boulevard Industriel à Laval activité entrepôt chiffre d\u2019affaires 1,2 million à la soumission RC 1 ».' };
  }
  const r = resoudreSoumissionRC(cabinetId, utilisateur, { id: p.soumission_rc_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionRC(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  if (!confirme) {
    const resume = `Je vais ajouter le lieu d'exploitation ${p.adresse}${p.ville ? ', ' + p.ville : ''}`
      + (p.type_activite ? ` (activité : ${p.type_activite})` : '')
      + ` à la soumission RC #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_lieu_rc', params: p } };
  }
  rc.ajouterExploitation(s.id, cabinetId, utilisateur.id, {
    adresse: p.adresse, ville: p.ville || null, code_postal: p.code_postal || null,
    type_activite: p.type_activite || null, code_classification: p.code_classification || null,
    description_activites: p.description_activites || null,
    chiffre_affaires: p.chiffre_affaires ?? null, masse_salariale: p.masse_salariale ?? null,
    nb_employes: p.nb_employes ?? null, superficie_pi2: p.superficie_pi2 ?? null,
    sous_traitants: p.sous_traitants || null,
  });
  return {
    statut: 'message',
    texte: `C'est fait : lieu d'exploitation ${p.adresse} ajouté à la soumission RC #${s.id} (${nomClient}). Voir : /rc/${s.id}`,
  };
}

function execModifierGarantiesRC(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionRC(cabinetId, utilisateur, { id: p.soumission_rc_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionRC(r) };
  const s = r.soumission;
  const re = resoudreExploitation(s, { index: p.exploitation_index, recherche: p.exploitation_recherche });
  if (re.statut !== 'ok') {
    if (re.statut === 'aucun') return { statut: 'message', texte: `La soumission RC #${s.id} ne contient aucun lieu d'exploitation pour l'instant.` };
    if (re.statut === 'ambigu') {
      return { statut: 'message', texte: `Plusieurs lieux correspondent : ${re.exploitations.map(libelleExploitation).join(' · ')}. Précisez, s'il vous plaît.` };
    }
    return { statut: 'message', texte: `Je n'ai pas trouvé ce lieu dans la soumission RC #${s.id}.` };
  }
  const e = re.exploitation;
  const actuel = e.garanties || {};
  const avenantsActuels = (actuel.avenants && typeof actuel.avenants === 'object') ? actuel.avenants : {};
  const data = {
    limite_par_sinistre: p.limite_par_sinistre !== undefined ? p.limite_par_sinistre : (actuel.limite_par_sinistre ?? null),
    limite_agregat: p.limite_agregat !== undefined ? p.limite_agregat : (actuel.limite_agregat ?? null),
    franchise: p.franchise !== undefined ? p.franchise : (actuel.franchise ?? null),
    formule: p.formule || actuel.formule || null,
    prime: actuel.prime ?? null,
    avenants: { ...avenantsActuels, ...(p.avenants || {}) },
  };
  const morceaux = [];
  if (p.limite_par_sinistre !== undefined) morceaux.push(`limite par sinistre ${Number(p.limite_par_sinistre).toLocaleString('fr-CA')} $`);
  if (p.limite_agregat !== undefined) morceaux.push(`agrégat ${Number(p.limite_agregat).toLocaleString('fr-CA')} $`);
  if (p.franchise !== undefined) morceaux.push(`franchise ${Number(p.franchise).toLocaleString('fr-CA')} $`);
  if (p.formule) morceaux.push(`formule ${{ globale: 'globale', locaux_operations: 'locaux et opérations', produits_completes: 'produits et opérations complétées' }[p.formule] || p.formule}`);
  if (p.avenants && p.avenants.pollution === 1) morceaux.push('avenant pollution');
  if (p.avenants && p.avenants.pollution === 0) morceaux.push('retrait de l\u2019avenant pollution');
  if (p.avenants && p.avenants.parapluie === 1) morceaux.push('avenant parapluie');
  if (p.avenants && p.avenants.parapluie === 0) morceaux.push('retrait de l\u2019avenant parapluie');
  if (!confirme) {
    const resume = `Je vais modifier les garanties du lieu « ${libelleExploitation(e)} » (soumission RC #${s.id}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_garanties_rc', params: { ...p, exploitation_id: e.id } },
    };
  }
  rc.definirGaranties(e.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : garanties du lieu « ${libelleExploitation(e)} » mises à jour (${morceaux.join(', ')}). Voir : /rc/${s.id}`,
  };
}

// --- Exécuteurs cyber (étape 8/10 cyber) -------------------------------------------------------------------
function execAjouterMesureCyber(cabinetId, utilisateur, p, confirme) {
  if (!p.type_mesure && p.type_mesure_texte) {
    return { statut: 'message', texte: `Type de mesure « ${p.type_mesure_texte} » non reconnu. Choix possibles : MFA, sauvegardes, antivirus/EDR, pare-feu, formation anti-hameçonnage, plan de réponse aux incidents, chiffrement, gestion des correctifs, contrôle d’accès. Reformulez, s'il vous plaît.` };
  }
  if (!p.type_mesure) {
    return { statut: 'message', texte: 'Quelle mesure de sécurité dois-je ajouter ? Exemple : « ajoute la mesure MFA en place à la soumission cyber 1 ».' };
  }
  const r = resoudreSoumissionCyber(cabinetId, utilisateur, { id: p.soumission_cyber_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionCyber(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  const libType = NOMS_TYPE_MESURE[p.type_mesure] || p.type_mesure;
  const libStatut = p.statut ? (NOMS_STATUT_MESURE[p.statut] || p.statut) : null;
  if (!confirme) {
    const resume = `Je vais ajouter la mesure « ${libType} »`
      + (libStatut ? ` (maturité : ${libStatut})` : '')
      + (p.details ? ` — ${p.details}` : '')
      + ` à la soumission cyber #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_mesure_cyber', params: p } };
  }
  cyber.ajouterMesure(s.id, cabinetId, utilisateur.id, {
    type_mesure: p.type_mesure, statut: p.statut || null,
    details: p.details || null, notes: null,
  });
  return {
    statut: 'message',
    texte: `C'est fait : mesure « ${libType} » ajoutée à la soumission cyber #${s.id} (${nomClient}). Voir : /cyber/${s.id}`,
  };
}

function execModifierGarantiesCyber(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionCyber(cabinetId, utilisateur, { id: p.soumission_cyber_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionCyber(r) };
  const s = r.soumission;
  const actuel = s.garanties || {};
  const avenantsActuels = (actuel.avenants && typeof actuel.avenants === 'object') ? actuel.avenants : {};
  const data = {
    limite_par_sinistre: p.limite_par_sinistre !== undefined ? p.limite_par_sinistre : (actuel.limite_par_sinistre ?? null),
    limite_agregat: p.limite_agregat !== undefined ? p.limite_agregat : (actuel.limite_agregat ?? null),
    franchise: p.franchise !== undefined ? p.franchise : (actuel.franchise ?? null),
    delai_carence: p.delai_carence !== undefined ? p.delai_carence : (actuel.delai_carence ?? null),
    prime: p.prime !== undefined ? p.prime : (actuel.prime ?? null),
    avenants: { ...avenantsActuels, ...(p.avenants || {}) },
  };
  const morceaux = [];
  if (p.limite_par_sinistre !== undefined) morceaux.push(`limite par sinistre ${Number(p.limite_par_sinistre).toLocaleString('fr-CA')} $`);
  if (p.limite_agregat !== undefined) morceaux.push(`agrégat ${Number(p.limite_agregat).toLocaleString('fr-CA')} $`);
  if (p.franchise !== undefined) morceaux.push(`franchise ${Number(p.franchise).toLocaleString('fr-CA')} $`);
  if (p.delai_carence !== undefined) morceaux.push(`carence « ${p.delai_carence} »`);
  if (p.prime !== undefined) morceaux.push(`prime ${Number(p.prime).toLocaleString('fr-CA')} $`);
  for (const [code, label] of AVENANTS_CYBER) {
    if (p.avenants && p.avenants[code] === 1) morceaux.push(`avenant ${label.toLowerCase()}`);
    if (p.avenants && p.avenants[code] === 0) morceaux.push(`retrait de l\u2019avenant ${label.toLowerCase()}`);
  }
  if (!confirme) {
    const resume = `Je vais modifier les garanties de la soumission cyber #${s.id} (${nomClientSoumission(s)}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_garanties_cyber', params: p },
    };
  }
  cyber.definirGaranties(s.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : garanties de la soumission cyber #${s.id} mises à jour (${morceaux.join(', ')}). Voir : /cyber/${s.id}`,
  };
}

function execModifierMaturiteMesure(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionCyber(cabinetId, utilisateur, { id: p.soumission_cyber_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionCyber(r) };
  const s = r.soumission;
  const rm = resoudreMesure(s, { index: p.mesure_index, type: p.mesure_type });
  if (rm.statut !== 'ok') {
    if (rm.statut === 'aucun') return { statut: 'message', texte: `La soumission cyber #${s.id} ne contient aucune mesure de sécurité pour l'instant.` };
    if (rm.statut === 'ambigu') {
      return { statut: 'message', texte: `Plusieurs mesures correspondent : ${rm.mesures.map(libelleMesure).join(' · ')}. Précisez, s'il vous plaît.` };
    }
    return { statut: 'message', texte: `Je n'ai pas trouvé cette mesure dans la soumission cyber #${s.id}.` };
  }
  const mes = rm.mesure;
  const libType = libelleMesure(mes);
  const libStatut = NOMS_STATUT_MESURE[p.statut] || p.statut;
  if (!confirme) {
    const resume = `Je vais passer la mesure « ${libType} » à « ${libStatut} » (soumission cyber #${s.id}). Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_maturite_mesure', params: p },
    };
  }
  cyber.modifierMesure(mes.id, cabinetId, utilisateur.id, { statut: p.statut });
  return {
    statut: 'message',
    texte: `C'est fait : mesure « ${libType} » passée à « ${libStatut} » (soumission cyber #${s.id}). Voir : /cyber/${s.id}`,
  };
}

// --- Exécuteurs E&O (étape 8/10 E&O) ----------------------------------------------------------------------
function execAjouterActiviteEO(cabinetId, utilisateur, p, confirme) {
  if (!p.description_activite) {
    return { statut: 'message', texte: 'Quelle activité professionnelle dois-je ajouter ? Exemple : « ajoute l\u2019activité conseil fiscal avec 180 000 $ de chiffre d\u2019affaires à la soumission E&O 1 ».' };
  }
  const r = resoudreSoumissionEO(cabinetId, utilisateur, { id: p.soumission_eo_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionEO(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  if (!confirme) {
    const resume = `Je vais ajouter l\u2019activité professionnelle « ${p.description_activite} »`
      + (p.chiffre_affaires ? ` (chiffre d\u2019affaires ${Number(p.chiffre_affaires).toLocaleString('fr-CA')} $)` : '')
      + (p.nb_professionnels ? `, ${p.nb_professionnels} professionnel${p.nb_professionnels > 1 ? 's' : ''}` : '')
      + ` à la soumission E&O #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_activite_eo', params: p } };
  }
  eo.ajouterActivite(s.id, cabinetId, utilisateur.id, {
    description_activite: p.description_activite,
    chiffre_affaires: p.chiffre_affaires ?? null,
    nb_professionnels: p.nb_professionnels ?? null,
    notes: p.notes || null,
  });
  return {
    statut: 'message',
    texte: `C'est fait : activité « ${p.description_activite} » ajoutée à la soumission E&O #${s.id} (${nomClient}). Voir : /eo/${s.id}`,
  };
}

function execModifierGarantiesEO(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionEO(cabinetId, utilisateur, { id: p.soumission_eo_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionEO(r) };
  const s = r.soumission;
  const actuel = s.garanties || {};
  const avenantsActuels = (actuel.avenants && typeof actuel.avenants === 'object') ? actuel.avenants : {};
  const data = {
    limite_par_sinistre: p.limite_par_sinistre !== undefined ? p.limite_par_sinistre : (actuel.limite_par_sinistre ?? null),
    limite_agregat: p.limite_agregat !== undefined ? p.limite_agregat : (actuel.limite_agregat ?? null),
    franchise: p.franchise !== undefined ? p.franchise : (actuel.franchise ?? null),
    base: p.base !== undefined ? p.base : (actuel.base ?? null),
    prime: p.prime !== undefined ? p.prime : (actuel.prime ?? null),
    avenants: { ...avenantsActuels, ...(p.avenants || {}) },
  };
  const morceaux = [];
  if (p.limite_par_sinistre !== undefined) morceaux.push(`limite par sinistre ${Number(p.limite_par_sinistre).toLocaleString('fr-CA')} $`);
  if (p.limite_agregat !== undefined) morceaux.push(`agrégat ${Number(p.limite_agregat).toLocaleString('fr-CA')} $`);
  if (p.franchise !== undefined) morceaux.push(`franchise ${Number(p.franchise).toLocaleString('fr-CA')} $`);
  if (p.base) morceaux.push(`base ${p.base === 'occurrences' ? 'occurrences' : 'réclamations-présentées'}`);
  if (p.prime !== undefined) morceaux.push(`prime ${Number(p.prime).toLocaleString('fr-CA')} $`);
  for (const [code, label] of AVENANTS_EO) {
    if (p.avenants && p.avenants[code] === 1) morceaux.push(`avenant ${label.toLowerCase()}`);
    if (p.avenants && p.avenants[code] === 0) morceaux.push(`retrait de l\u2019avenant ${label.toLowerCase()}`);
  }
  if (!confirme) {
    const resume = `Je vais modifier les garanties de la soumission E&O #${s.id} (${nomClientSoumission(s)}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_garanties_eo', params: p },
    };
  }
  eo.definirGaranties(s.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : garanties de la soumission E&O #${s.id} mises à jour (${morceaux.join(', ')}). Voir : /eo/${s.id}`,
  };
}

function execModifierActiviteEO(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionEO(cabinetId, utilisateur, { id: p.soumission_eo_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionEO(r) };
  const s = r.soumission;
  const ra = resoudreActivite(s, { index: p.activite_index, recherche: p.activite_recherche });
  if (ra.statut !== 'ok') {
    if (ra.statut === 'aucun') return { statut: 'message', texte: `La soumission E&O #${s.id} ne contient aucune activité professionnelle pour l'instant.` };
    if (ra.statut === 'ambigu') {
      return { statut: 'message', texte: `Plusieurs activités correspondent : ${ra.activites.map(libelleActivite).join(' · ')}. Précisez, s'il vous plaît.` };
    }
    return { statut: 'message', texte: `Je n'ai pas trouvé cette activité dans la soumission E&O #${s.id}.` };
  }
  const a = ra.activite;
  const lib = libelleActivite(a);
  if (!confirme) {
    const resume = `Je vais passer le chiffre d\u2019affaires de l\u2019activité « ${lib} » à ${Number(p.chiffre_affaires).toLocaleString('fr-CA')} $ (soumission E&O #${s.id}). Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_activite_eo', params: p },
    };
  }
  eo.modifierActivite(a.id, cabinetId, utilisateur.id, { chiffre_affaires: p.chiffre_affaires });
  return {
    statut: 'message',
    texte: `C'est fait : chiffre d\u2019affaires de « ${lib} » passé à ${Number(p.chiffre_affaires).toLocaleString('fr-CA')} $ (soumission E&O #${s.id}). Voir : /eo/${s.id}`,
  };
}

// --- Exécuteurs D&O (étape 8/10 D&O) ----------------------------------------------------------------------
function fmtMontantCmd(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('fr-CA') + ' $';
}
function libelleBaseDo(b) {
  if (b === 'occurrences') return 'occurrences';
  if (b === 'reclamations_presentees') return 'réclamations-présentées';
  return '—';
}

function execAjouterDirigeantDO(cabinetId, utilisateur, p, confirme) {
  if (!p.nom) {
    return { statut: 'message', texte: 'Quel est le nom du dirigeant ? Exemple : « ajoute le dirigeant Marc Bouchard comme trésorier à la soumission D&O 1 ».' };
  }
  if (p.annees_experience !== null && p.annees_experience !== undefined
    && (isNaN(p.annees_experience) || p.annees_experience < 0 || p.annees_experience > 80)) {
    return { statut: 'message', texte: `« ${p.annees_experience} » n\u2019est pas un nombre d\u2019années d\u2019expérience plausible (0 à 80). Reformulez, s'il vous plaît.` };
  }
  const r = resoudreSoumissionDO(cabinetId, utilisateur, { id: p.soumission_do_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionDO(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  if (!confirme) {
    const resume = `Je vais ajouter le dirigeant « ${p.nom} »`
      + (p.fonction ? ` (fonction : ${p.fonction})` : '')
      + (p.annees_experience !== null && p.annees_experience !== undefined ? `, ${p.annees_experience} ans d\u2019expérience` : '')
      + (p.antecedents_personnels ? ' — antécédents personnels renseignés (valeur non affichée)' : '')
      + ` à la soumission D&O #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_dirigeant_do', params: p } };
  }
  doLib.ajouterDirigeant(s.id, cabinetId, utilisateur.id, {
    nom: p.nom, fonction: p.fonction || null,
    annees_experience: p.annees_experience ?? null,
    antecedents_personnels: p.antecedents_personnels || null,
  });
  return {
    statut: 'message',
    texte: `C'est fait : dirigeant « ${p.nom} » ajouté à la soumission D&O #${s.id} (${nomClient}). Voir : /do/${s.id}`,
  };
}

function execModifierGarantiesDO(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionDO(cabinetId, utilisateur, { id: p.soumission_do_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionDO(r) };
  const s = r.soumission;
  const actuel = s.garanties || {};
  const avenantsActuels = (actuel.avenants && typeof actuel.avenants === 'object') ? actuel.avenants : {};
  const data = {
    limite_par_sinistre: p.limite_par_sinistre !== undefined ? p.limite_par_sinistre : (actuel.limite_par_sinistre ?? null),
    limite_agregat: p.limite_agregat !== undefined ? p.limite_agregat : (actuel.limite_agregat ?? null),
    franchise: p.franchise !== undefined ? p.franchise : (actuel.franchise ?? null),
    base: p.base !== undefined ? p.base : (actuel.base ?? null),
    prime: p.prime !== undefined ? p.prime : (actuel.prime ?? null),
    avenants: { ...avenantsActuels, ...(p.avenants || {}) },
  };
  // Confirmation en avant/après (règle d'or : le courtier voit ce qui change).
  const morceaux = [];
  if (p.limite_par_sinistre !== undefined) morceaux.push(`limite par sinistre : ${fmtMontantCmd(actuel.limite_par_sinistre)} → ${fmtMontantCmd(p.limite_par_sinistre)}`);
  if (p.limite_agregat !== undefined) morceaux.push(`agrégat : ${fmtMontantCmd(actuel.limite_agregat)} → ${fmtMontantCmd(p.limite_agregat)}`);
  if (p.franchise !== undefined) morceaux.push(`franchise : ${fmtMontantCmd(actuel.franchise)} → ${fmtMontantCmd(p.franchise)}`);
  if (p.base) morceaux.push(`base : ${libelleBaseDo(actuel.base)} → ${libelleBaseDo(p.base)}`);
  if (p.prime !== undefined) morceaux.push(`prime : ${fmtMontantCmd(actuel.prime)} → ${fmtMontantCmd(p.prime)}`);
  for (const [code, label] of AVENANTS_DO) {
    const avant = avenantsActuels[code] ? 'présent' : 'absent';
    if (p.avenants && p.avenants[code] === 1) morceaux.push(`avenant ${label.toLowerCase()} : ${avant} → ajouté`);
    if (p.avenants && p.avenants[code] === 0) morceaux.push(`avenant ${label.toLowerCase()} : ${avant} → retiré`);
  }
  if (!confirme) {
    const resume = `Je vais modifier les garanties de la soumission D&O #${s.id} (${nomClientSoumission(s)}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_garanties_do', params: p },
    };
  }
  doLib.definirGaranties(s.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : garanties de la soumission D&O #${s.id} mises à jour (${morceaux.join(', ')}). Voir : /do/${s.id}`,
  };
}

function execModifierDirigeantDO(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionDO(cabinetId, utilisateur, { id: p.soumission_do_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionDO(r) };
  const s = r.soumission;
  const rd = resoudreDirigeant(s, { index: p.dirigeant_index, recherche: p.dirigeant_recherche });
  if (rd.statut !== 'ok') {
    if (rd.statut === 'aucun') return { statut: 'message', texte: `La soumission D&O #${s.id} ne contient aucun dirigeant pour l'instant.` };
    if (rd.statut === 'ambigu') {
      return { statut: 'message', texte: `Plusieurs dirigeants correspondent : ${rd.dirigeants.map(libelleDirigeant).join(' · ')}. Précisez, s'il vous plaît.` };
    }
    return { statut: 'message', texte: `Je n'ai pas trouvé ce dirigeant dans la soumission D&O #${s.id}.` };
  }
  const d = rd.dirigeant;
  const lib = libelleDirigeant(d);
  const morceaux = [];
  if (p.nom) morceaux.push(`nom : « ${d.nom} » → « ${p.nom} »`);
  if (p.fonction) morceaux.push(`fonction : « ${d.fonction || '—'} » → « ${p.fonction} »`);
  if (p.annees_experience !== undefined) morceaux.push(`années d\u2019expérience : ${d.annees_experience ?? '—'} → ${p.annees_experience}`);
  // Les antécédents personnels sont sensibles : la valeur n'est jamais
  // réaffichée dans les résumés ni les messages (ni ici, ni ailleurs).
  if (p.antecedents_personnels !== undefined) morceaux.push('antécédents personnels : mis à jour (valeur non affichée)');
  if (!confirme) {
    const resume = `Je vais modifier le dirigeant « ${lib} » (soumission D&O #${s.id}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_dirigeant_do', params: p },
    };
  }
  const data = {};
  if (p.nom) data.nom = p.nom;
  if (p.fonction) data.fonction = p.fonction;
  if (p.annees_experience !== undefined) data.annees_experience = p.annees_experience;
  if (p.antecedents_personnels !== undefined) data.antecedents_personnels = p.antecedents_personnels;
  doLib.modifierDirigeant(d.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : dirigeant « ${lib} » mis à jour (${morceaux.join(', ')}). Voir : /do/${s.id}`,
  };
}

// --- Exécuteurs perte d'exploitation (étape 8/10 PE) -----------------------------------------------------
function execAjouterEtablissementPE(cabinetId, utilisateur, p, confirme) {
  if (!p.nom_lieu && !p.adresse) {
    return { statut: 'message', texte: 'Quel est le nom du lieu de l\u2019établissement (ou son adresse) ? Exemple : « ajoute l\u2019établissement Entrepôt occupation entreposage à la soumission perte d\u2019exploitation 1 ».' };
  }
  if (p.chiffre_affaires !== null && p.chiffre_affaires !== undefined
    && (isNaN(p.chiffre_affaires) || p.chiffre_affaires < 0)) {
    return { statut: 'message', texte: 'Le chiffre d\u2019affaires ne peut pas être négatif. Reformulez, s\u2019il vous plaît.' };
  }
  const r = resoudreSoumissionPE(cabinetId, utilisateur, { id: p.soumission_pe_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionPE(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  const lib = p.nom_lieu || p.adresse;
  if (!confirme) {
    const extra = [];
    if (p.nom_lieu && p.adresse) extra.push(`adresse : ${p.adresse}`);
    if (p.occupation) extra.push(`occupation : ${p.occupation}`);
    if (p.chiffre_affaires !== null && p.chiffre_affaires !== undefined) extra.push(`chiffre d\u2019affaires : ${fmtMontantCmd(p.chiffre_affaires)}`);
    if (p.superficie !== null && p.superficie !== undefined) extra.push(`superficie : ${p.superficie} m²`);
    if (p.annee_construction !== null && p.annee_construction !== undefined) extra.push(`construit en ${p.annee_construction}`);
    if (p.base_valeur) extra.push(`base de valeur : ${libelleBaseValeurPe(p.base_valeur)}`);
    const resume = `Je vais ajouter l\u2019établissement « ${lib} »`
      + (extra.length ? ` (${extra.join(', ')})` : '')
      + ` à la soumission perte d\u2019exploitation #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_etablissement_pe', params: p } };
  }
  pe.ajouterEtablissement(s.id, cabinetId, utilisateur.id, {
    nom_lieu: p.nom_lieu || null, adresse: p.adresse || null,
    occupation: p.occupation || null, chiffre_affaires: p.chiffre_affaires ?? null,
    superficie: p.superficie ?? null, annee_construction: p.annee_construction ?? null,
    base_valeur: p.base_valeur || null,
  });
  return {
    statut: 'message',
    texte: `C'est fait : établissement « ${lib} » ajouté à la soumission perte d\u2019exploitation #${s.id} (${nomClient}). Voir : /pe/${s.id}`,
  };
}

function execModifierGarantiesPE(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionPE(cabinetId, utilisateur, { id: p.soumission_pe_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionPE(r) };
  const s = r.soumission;
  const actuel = s.garanties || {};
  const avenantsActuels = (actuel.avenants && typeof actuel.avenants === 'object') ? actuel.avenants : {};
  const data = {
    limite: p.limite !== undefined ? p.limite : (actuel.limite ?? null),
    periode_indemnite_mois: p.periode_indemnite_mois !== undefined ? p.periode_indemnite_mois : (actuel.periode_indemnite_mois ?? null),
    franchise_jours: p.franchise_jours !== undefined ? p.franchise_jours : (actuel.franchise_jours ?? null),
    base_montant: p.base_montant !== undefined ? p.base_montant : (actuel.base_montant ?? null),
    prime: p.prime !== undefined ? p.prime : (actuel.prime ?? null),
    avenants: { ...avenantsActuels, ...(p.avenants || {}) },
  };
  // Confirmation en avant/après (règle d'or : le courtier voit ce qui change).
  const morceaux = [];
  if (p.limite !== undefined) morceaux.push(`limite : ${fmtMontantCmd(actuel.limite)} → ${fmtMontantCmd(p.limite)}`);
  if (p.periode_indemnite_mois !== undefined) morceaux.push(`période d\u2019indemnité : ${actuel.periode_indemnite_mois ?? '—'} mois → ${p.periode_indemnite_mois} mois`);
  if (p.franchise_jours !== undefined) morceaux.push(`franchise (délai de carence) : ${actuel.franchise_jours ?? '—'} jours → ${p.franchise_jours} jours`);
  if (p.base_montant) morceaux.push(`base d\u2019indemnité : ${libelleBaseMontantPe(actuel.base_montant)} → ${libelleBaseMontantPe(p.base_montant)}`);
  if (p.prime !== undefined) morceaux.push(`prime : ${fmtMontantCmd(actuel.prime)} → ${fmtMontantCmd(p.prime)}`);
  for (const [code, label] of AVENANTS_PE) {
    const avant = avenantsActuels[code] ? 'présent' : 'absent';
    if (p.avenants && p.avenants[code] === 1) morceaux.push(`avenant ${label.toLowerCase()} : ${avant} → ajouté`);
    if (p.avenants && p.avenants[code] === 0) morceaux.push(`avenant ${label.toLowerCase()} : ${avant} → retiré`);
  }
  if (!confirme) {
    const resume = `Je vais modifier les garanties de la soumission perte d\u2019exploitation #${s.id} (${nomClientSoumission(s)}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_garanties_pe', params: p },
    };
  }
  pe.definirGaranties(s.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : garanties de la soumission perte d\u2019exploitation #${s.id} mises à jour (${morceaux.join(', ')}). Voir : /pe/${s.id}`,
  };
}

function execModifierEtablissementPE(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionPE(cabinetId, utilisateur, { id: p.soumission_pe_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionPE(r) };
  const s = r.soumission;
  const re = resoudreEtablissement(s, { index: p.etablissement_index, recherche: p.etablissement_recherche });
  if (re.statut !== 'ok') {
    if (re.statut === 'aucun') return { statut: 'message', texte: `La soumission perte d\u2019exploitation #${s.id} ne contient aucun établissement pour l'instant.` };
    if (re.statut === 'ambigu') {
      return { statut: 'message', texte: `Plusieurs établissements correspondent : ${re.etablissements.map(libelleEtablissement).join(' · ')}. Précisez, s'il vous plaît.` };
    }
    return { statut: 'message', texte: `Je n'ai pas trouvé cet établissement dans la soumission perte d\u2019exploitation #${s.id}.` };
  }
  const e = re.etablissement;
  const lib = libelleEtablissement(e);
  const morceaux = [];
  if (p.nom_lieu) morceaux.push(`nom : « ${e.nom_lieu || '—'} » → « ${p.nom_lieu} »`);
  if (p.occupation) morceaux.push(`occupation : « ${e.occupation || '—'} » → « ${p.occupation} »`);
  if (p.chiffre_affaires !== undefined) morceaux.push(`chiffre d\u2019affaires : ${fmtMontantCmd(e.chiffre_affaires)} → ${fmtMontantCmd(p.chiffre_affaires)}`);
  if (p.superficie !== undefined) morceaux.push(`superficie : ${e.superficie ?? '—'} m² → ${p.superficie} m²`);
  if (p.annee_construction !== undefined) morceaux.push(`année de construction : ${e.annee_construction ?? '—'} → ${p.annee_construction}`);
  if (p.base_valeur) morceaux.push(`base de valeur : ${libelleBaseValeurPe(e.base_valeur)} → ${libelleBaseValeurPe(p.base_valeur)}`);
  if (!confirme) {
    const resume = `Je vais modifier l\u2019établissement « ${lib} » (soumission perte d\u2019exploitation #${s.id}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_etablissement_pe', params: p },
    };
  }
  const data = {};
  if (p.nom_lieu) data.nom_lieu = p.nom_lieu;
  if (p.occupation) data.occupation = p.occupation;
  if (p.chiffre_affaires !== undefined) data.chiffre_affaires = p.chiffre_affaires;
  if (p.superficie !== undefined) data.superficie = p.superficie;
  if (p.annee_construction !== undefined) data.annee_construction = p.annee_construction;
  if (p.base_valeur) data.base_valeur = p.base_valeur;
  pe.modifierEtablissement(e.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : établissement « ${lib} » mis à jour (${morceaux.join(', ')}). Voir : /pe/${s.id}`,
  };
}

// --- Exécuteurs flotte automobile (étape 8/10 flotte) ---------------------------------------------------
function execAjouterVehiculeFlotte(cabinetId, utilisateur, p, confirme) {
  if (!p.marque) {
    return { statut: 'message', texte: 'Quel est le véhicule ? Exemple : « ajoute le véhicule Ford Transit 2023 à la soumission flotte 1 ».' };
  }
  if (p.valeur !== null && p.valeur !== undefined && (isNaN(p.valeur) || p.valeur < 0)) {
    return { statut: 'message', texte: 'La valeur du véhicule ne peut pas être négative. Reformulez, s\u2019il vous plaît.' };
  }
  const r = resoudreSoumissionFlotte(cabinetId, utilisateur, { id: p.soumission_flotte_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionFlotte(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  const lib = `${p.annee || ''} ${p.marque} ${p.modele || ''}`.trim();
  if (!confirme) {
    const extra = [];
    if (p.type_vehicule) extra.push(`type : ${libelleTypeVehiculeFlotte(p.type_vehicule)}`);
    if (p.usage) extra.push(`usage : ${libelleUsageFlotte(p.usage)}`);
    if (p.valeur !== null && p.valeur !== undefined) extra.push(`valeur : ${fmtMontantCmd(p.valeur)}`);
    if (p.rayon_operation_km !== null && p.rayon_operation_km !== undefined) extra.push(`rayon : ${p.rayon_operation_km} km`);
    if (p.vin) extra.push(`NIV ${p.vin}`);
    const resume = `Je vais ajouter le véhicule ${lib}`
      + (extra.length ? ` (${extra.join(', ')})` : '')
      + ` à la soumission flotte #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_vehicule_flotte', params: p } };
  }
  flotte.ajouterVehicule(s.id, cabinetId, utilisateur.id, {
    annee: p.annee || null, marque: p.marque, modele: p.modele || null,
    niv: p.vin || null, type_vehicule: p.type_vehicule || null,
    usage: p.usage || null, rayon_operation_km: p.rayon_operation_km ?? null,
    valeur: p.valeur ?? null,
  });
  return {
    statut: 'message',
    texte: `C'est fait : véhicule ${lib} ajouté à la soumission flotte #${s.id} (${nomClient}). Voir : /flotte/${s.id}`,
  };
}

function execAjouterConducteurFlotte(cabinetId, utilisateur, p, confirme) {
  if (!p.prenom || !p.nom) {
    return { statut: 'message', texte: 'Quel est le nom complet du conducteur ? Exemple : « ajoute un conducteur Marie Tremblay permis T1234567 à la soumission flotte 1 ».' };
  }
  const r = resoudreSoumissionFlotte(cabinetId, utilisateur, { id: p.soumission_flotte_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionFlotte(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  if (!confirme) {
    const extra = [];
    if (p.numero_permis) extra.push(`permis ${p.numero_permis}`);
    if (p.classe_permis) extra.push(`classe ${p.classe_permis}`);
    if (p.annees_experience !== null && p.annees_experience !== undefined) extra.push(`${p.annees_experience} ans d\u2019expérience`);
    const resume = `Je vais ajouter le conducteur ${p.prenom} ${p.nom}`
      + (extra.length ? ` (${extra.join(', ')})` : ' (sans n° de permis — pourrez-vous le préciser ?)')
      + ` à la soumission flotte #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_conducteur_flotte', params: p } };
  }
  flotte.ajouterConducteur(s.id, cabinetId, utilisateur.id, {
    prenom: p.prenom, nom: p.nom,
    numero_permis: p.numero_permis || null,
    classe_permis: p.classe_permis || null,
    annees_experience: p.annees_experience ?? null,
  });
  return {
    statut: 'message',
    texte: `C'est fait : ${p.prenom} ${p.nom} ajouté comme conducteur à la soumission flotte #${s.id} (${nomClient}). Voir : /flotte/${s.id}`,
  };
}

function execModifierGarantiesFlotte(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionFlotte(cabinetId, utilisateur, { id: p.soumission_flotte_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionFlotte(r) };
  const s = r.soumission;
  const actuel = s.garanties || {};
  const avenantsActuels = (actuel.avenants && typeof actuel.avenants === 'object') ? actuel.avenants : {};
  const data = {
    limite_rc: p.limite_rc !== undefined ? p.limite_rc : (actuel.limite_rc ?? null),
    franchise_collision: p.franchise_collision !== undefined ? p.franchise_collision : (actuel.franchise_collision ?? null),
    franchise_versement: p.franchise_versement !== undefined ? p.franchise_versement : (actuel.franchise_versement ?? null),
    prime: p.prime !== undefined ? p.prime : (actuel.prime ?? null),
    avenants: { ...avenantsActuels, ...(p.avenants || {}) },
  };
  // Confirmation en avant/après (règle d'or : le courtier voit ce qui change).
  const morceaux = [];
  if (p.limite_rc !== undefined) morceaux.push(`limite RC : ${fmtMontantCmd(actuel.limite_rc)} → ${fmtMontantCmd(p.limite_rc)}`);
  if (p.franchise_collision !== undefined) morceaux.push(`franchise collision : ${fmtMontantCmd(actuel.franchise_collision)} → ${fmtMontantCmd(p.franchise_collision)}`);
  if (p.franchise_versement !== undefined) morceaux.push(`franchise versement : ${fmtMontantCmd(actuel.franchise_versement)} → ${fmtMontantCmd(p.franchise_versement)}`);
  if (p.prime !== undefined) morceaux.push(`prime : ${fmtMontantCmd(actuel.prime)} → ${fmtMontantCmd(p.prime)}`);
  for (const [code, label] of AVENANTS_FLOTTE) {
    const avant = avenantsActuels[code] ? 'présent' : 'absent';
    if (p.avenants && p.avenants[code] === 1) morceaux.push(`avenant ${label} : ${avant} → ajouté`);
    if (p.avenants && p.avenants[code] === 0) morceaux.push(`avenant ${label} : ${avant} → retiré`);
  }
  if (!confirme) {
    const resume = `Je vais modifier les garanties de la soumission flotte #${s.id} (${nomClientSoumission(s)}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_garanties_flotte', params: p },
    };
  }
  flotte.definirGaranties(s.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : garanties de la soumission flotte #${s.id} mises à jour (${morceaux.join(', ')}). Voir : /flotte/${s.id}`,
  };
}

function execModifierVehiculeFlotte(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionFlotte(cabinetId, utilisateur, { id: p.soumission_flotte_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionFlotte(r) };
  const s = r.soumission;
  const rv = resoudreVehiculeFlotte(s, {
    index: p.vehicule_index, niv: p.vehicule_niv, recherche: p.vehicule_recherche,
  });
  if (rv.statut !== 'ok') {
    if (rv.statut === 'aucun') return { statut: 'message', texte: `La soumission flotte #${s.id} ne contient aucun véhicule pour l'instant.` };
    if (rv.statut === 'ambigu') {
      return { statut: 'message', texte: `Plusieurs véhicules correspondent : ${rv.vehicules.map(libelleVehicule).join(' · ')}. Précisez, s'il vous plaît.` };
    }
    if (rv.statut === 'manque') return { statut: 'message', texte: 'Quel véhicule dois-je modifier ? Précisez son numéro ou sa marque, s\u2019il vous plaît.' };
    return { statut: 'message', texte: `Je n'ai pas trouvé ce véhicule dans la soumission flotte #${s.id}.` };
  }
  const v = rv.vehicule;
  const lib = libelleVehicule(v);
  const morceaux = [];
  if (p.valeur !== undefined) morceaux.push(`valeur : ${fmtMontantCmd(v.valeur)} → ${fmtMontantCmd(p.valeur)}`);
  if (p.rayon_operation_km !== undefined) morceaux.push(`rayon : ${v.rayon_operation_km ?? '—'} km → ${p.rayon_operation_km} km`);
  if (p.usage) morceaux.push(`usage : ${libelleUsageFlotte(v.usage)} → ${libelleUsageFlotte(p.usage)}`);
  if (p.annee !== undefined) morceaux.push(`année : ${v.annee ?? '—'} → ${p.annee}`);
  if (!confirme) {
    const resume = `Je vais modifier le véhicule « ${lib} » (soumission flotte #${s.id}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return {
      statut: 'confirmation', resume,
      commande: { action: 'modifier_vehicule_flotte', params: p },
    };
  }
  const data = {};
  if (p.valeur !== undefined) data.valeur = p.valeur;
  if (p.rayon_operation_km !== undefined) data.rayon_operation_km = p.rayon_operation_km;
  if (p.usage) data.usage = p.usage;
  if (p.annee !== undefined) data.annee = p.annee;
  flotte.modifierVehicule(v.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : véhicule « ${lib} » mis à jour (${morceaux.join(', ')}). Voir : /flotte/${s.id}`,
  };
}

function execCreerRappel(cabinetId, utilisateurId, p) {
  const { executer } = utilAssistant();
  if (!p.entreprise) {
    return { statut: 'message', texte: 'Pour quelle entreprise dois-je créer ce rappel ?' };
  }
  // Un rappel = une tâche avec échéance : on réutilise l'exécuteur validé.
  return { statut: 'message', texte: executer(cabinetId, utilisateurId, { action: 'creer_tache', params: p }) };
}

function execAllerA(p) {
  return {
    statut: 'redirection',
    url: p.url,
    texte: `Je vous emmène vers ${p.libelle}…`,
  };
}

function execRechercher(cabinetId, utilisateur, p) {
  const terme = String(p.terme || '').trim().replace(/\s+/g, ' ');
  if (terme.length < 2) return { statut: 'message', texte: 'Que dois-je chercher ? Précisez un nom ou un numéro.' };
  const portefeuille = utilisateur.role === 'courtier'
    ? ` AND c.responsable_id = ${Number(utilisateur.id)}` : '';
  const resultats = [];
  if (p.type === 'client' || p.type === 'general') {
    const clients = bd.prepare(`
      SELECT c.id, c.raison_sociale FROM clients c
      WHERE c.cabinet_id = ? AND c.archive = 0 AND lower(c.raison_sociale) LIKE lower(?)
      ${portefeuille} ORDER BY c.raison_sociale LIMIT 6
    `).all(cabinetId, `%${terme}%`);
    for (const c of clients) resultats.push({ quoi: 'Entreprise', nom: c.raison_sociale, url: `/clients/${c.id}` });
  }
  if (p.type === 'police' || p.type === 'general') {
    const polices = bd.prepare(`
      SELECT p.id, p.numero_police, c.raison_sociale FROM polices p
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.cabinet_id = ? AND lower(p.numero_police) LIKE lower(?)
      ${portefeuille} ORDER BY p.numero_police LIMIT 6
    `).all(cabinetId, `%${terme}%`);
    for (const x of polices) {
      resultats.push({ quoi: 'Police', nom: `${x.numero_police}${x.raison_sociale ? ' — ' + x.raison_sociale : ''}`, url: `/echeances/police/${x.id}` });
    }
  }
  if (p.type === 'soumission' || (/^\d+$/.test(terme))) {
    const r = resoudreSoumission(cabinetId, utilisateur, /^\d+$/.test(terme) ? { id: Number(terme) } : { client: terme });
    if (r.statut === 'ok') {
      return { statut: 'redirection', url: `/auto/${r.soumission.id}`, texte: `Soumission #${r.soumission.id} trouvée — je vous y emmène…` };
    }
    if (r.statut === 'hors_portefeuille') return { statut: 'message', texte: messageErreurSoumission(r) };
  }
  if (!resultats.length) return { statut: 'message', texte: `Aucun résultat pour « ${terme} ».` };
  if (resultats.length === 1) {
    return { statut: 'redirection', url: resultats[0].url, texte: `${resultats[0].quoi} trouvé : ${resultats[0].nom} — je vous y emmène…` };
  }
  return {
    statut: 'message',
    texte: `Plusieurs résultats pour « ${terme} » :\n`
      + resultats.map((x) => `• ${x.quoi} : ${x.nom} (${x.url})`).join('\n')
      + '\nPrécisez votre recherche.',
  };
}

// --- Exécuteurs cautionnement (étape 8/10 cautionnement) ------------------------------------------------
function execAjouterObligationCaut(cabinetId, utilisateur, p, confirme) {
  if (!p.type) {
    return { statut: 'message', texte: 'Quel type de cautionnement ? Exemple : « ajoute un cautionnement d’exécution de 1 100 000 $ pour la Ville de Laval projet École des Pins à la soumission cautionnement 1 ».' };
  }
  if ((p.montant_cautionnement !== null && p.montant_cautionnement !== undefined && p.montant_cautionnement < 0)
    || (p.montant_contrat !== null && p.montant_contrat !== undefined && p.montant_contrat < 0)) {
    return { statut: 'message', texte: 'Les montants ne peuvent pas être négatifs. Reformulez, s’il vous plaît.' };
  }
  const r = resoudreSoumissionCaut(cabinetId, utilisateur, { id: p.soumission_caut_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionCaut(r) };
  const s = r.soumission;
  const nomClient = nomClientSoumission(s);
  if (!confirme) {
    const extra = [];
    if (p.beneficiaire) extra.push(`bénéficiaire : ${p.beneficiaire}`);
    if (p.description_projet) extra.push(`projet : ${p.description_projet}`);
    if (p.montant_contrat !== null && p.montant_contrat !== undefined) extra.push(`contrat : ${fmtMontantCmd(p.montant_contrat)}`);
    if (p.montant_cautionnement !== null && p.montant_cautionnement !== undefined) extra.push(`cautionnement : ${fmtMontantCmd(p.montant_cautionnement)}`);
    if (p.prime_estimee !== null && p.prime_estimee !== undefined) extra.push(`prime estimée : ${fmtMontantCmd(p.prime_estimee)}`);
    const resume = `Je vais ajouter l'obligation « ${libelleTypeObligationCaut(p.type)} »`
      + (extra.length ? ` (${extra.join(', ')})` : '')
      + ` à la soumission cautionnement #${s.id} (${nomClient}). Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'ajouter_obligation_caut', params: p } };
  }
  caut.ajouterObligation(s.id, cabinetId, utilisateur.id, {
    type: p.type,
    beneficiaire: p.beneficiaire || null,
    description_projet: p.description_projet || null,
    montant_contrat: p.montant_contrat ?? null,
    montant_cautionnement: p.montant_cautionnement ?? null,
    prime_estimee: p.prime_estimee ?? null,
  });
  return {
    statut: 'message',
    texte: `C'est fait : obligation « ${libelleTypeObligationCaut(p.type)} » ajoutée à la soumission cautionnement #${s.id} (${nomClient}). Voir : /cautionnement/${s.id}`,
  };
}

function execModifierLigneCaut(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionCaut(cabinetId, utilisateur, { id: p.soumission_caut_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionCaut(r) };
  const s = r.soumission;
  const actuel = s.garanties || {};
  const data = {
    limite_globale: p.limite_globale !== undefined ? p.limite_globale : (actuel.limite_globale ?? null),
    limite_par_projet: p.limite_par_projet !== undefined ? p.limite_par_projet : (actuel.limite_par_projet ?? null),
    fonds_roulement: p.fonds_roulement !== undefined ? p.fonds_roulement : (actuel.fonds_roulement ?? null),
    valeur_nette: p.valeur_nette !== undefined ? p.valeur_nette : (actuel.valeur_nette ?? null),
    prime: p.prime !== undefined ? p.prime : (actuel.prime ?? null),
  };
  // Règle métier : la limite par projet ne dépasse jamais la limite globale.
  if (data.limite_globale !== null && data.limite_par_projet !== null
    && data.limite_par_projet > data.limite_globale) {
    return {
      statut: 'message',
      texte: `Impossible : la limite par projet (${fmtMontantCmd(data.limite_par_projet)}) dépasserait la limite globale (${fmtMontantCmd(data.limite_globale)}). Ajustez l'une des deux limites.`,
    };
  }
  const morceaux = [];
  if (p.limite_globale !== undefined) morceaux.push(`limite globale : ${fmtMontantCmd(actuel.limite_globale)} → ${fmtMontantCmd(p.limite_globale)}`);
  if (p.limite_par_projet !== undefined) morceaux.push(`limite par projet : ${fmtMontantCmd(actuel.limite_par_projet)} → ${fmtMontantCmd(p.limite_par_projet)}`);
  if (p.fonds_roulement !== undefined) morceaux.push(`fonds de roulement : ${fmtMontantCmd(actuel.fonds_roulement)} → ${fmtMontantCmd(p.fonds_roulement)}`);
  if (p.valeur_nette !== undefined) morceaux.push(`valeur nette : ${fmtMontantCmd(actuel.valeur_nette)} → ${fmtMontantCmd(p.valeur_nette)}`);
  if (p.prime !== undefined) morceaux.push(`prime de la ligne : ${fmtMontantCmd(actuel.prime)} → ${fmtMontantCmd(p.prime)}`);
  if (!morceaux.length) {
    return { statut: 'message', texte: 'Que voulez-vous modifier dans la ligne ? Exemple : « mets la limite globale à 6 millions à la soumission cautionnement 1 ».' };
  }
  if (!confirme) {
    const resume = `Je vais modifier la ligne de cautionnement de la soumission cautionnement #${s.id} (${nomClientSoumission(s)}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'modifier_ligne_caut', params: p } };
  }
  caut.definirGaranties(s.id, cabinetId, utilisateur.id, data);
  return {
    statut: 'message',
    texte: `C'est fait : ligne de cautionnement de la soumission cautionnement #${s.id} mise à jour (${morceaux.join(', ')}). Voir : /cautionnement/${s.id}`,
  };
}

function execModifierObligationCaut(cabinetId, utilisateur, p, confirme) {
  const r = resoudreSoumissionCaut(cabinetId, utilisateur, { id: p.soumission_caut_id, client: p.soumission_client });
  if (r.statut !== 'ok') return { statut: 'message', texte: messageErreurSoumissionCaut(r) };
  const s = r.soumission;
  const rv = resoudreObligationCaut(s, { index: p.obligation_index, type: p.obligation_type });
  if (rv.statut !== 'ok') {
    if (rv.statut === 'aucune') return { statut: 'message', texte: `La soumission cautionnement #${s.id} ne contient aucune obligation pour l'instant.` };
    if (rv.statut === 'ambigu') {
      return {
        statut: 'message',
        texte: `Plusieurs obligations « ${libelleTypeObligationCaut(rv.type)} » dans la soumission #${s.id} : ${rv.obligations.map((o) => `#${o.id} (${o.beneficiaire || 'sans bénéficiaire'})`).join(' · ')}. Précisez le numéro de l'obligation, s'il vous plaît.`,
      };
    }
    if (rv.statut === 'manque') return { statut: 'message', texte: "Quelle obligation ? Précisez son numéro ou son type (ex. « l'obligation d'exécution », « l'obligation 2 »)." };
    return { statut: 'message', texte: `Je n'ai pas trouvé cette obligation dans la soumission cautionnement #${s.id}.` };
  }
  const o = rv.obligation;
  const morceaux = [];
  if (p.montant_cautionnement !== undefined) morceaux.push(`montant du cautionnement : ${fmtMontantCmd(o.montant_cautionnement)} → ${fmtMontantCmd(p.montant_cautionnement)}`);
  if (p.montant_contrat !== undefined) morceaux.push(`montant du contrat : ${fmtMontantCmd(o.montant_contrat)} → ${fmtMontantCmd(p.montant_contrat)}`);
  if (p.prime_estimee !== undefined) morceaux.push(`prime estimée : ${fmtMontantCmd(o.prime_estimee)} → ${fmtMontantCmd(p.prime_estimee)}`);
  if (p.beneficiaire !== undefined) morceaux.push(`bénéficiaire : ${o.beneficiaire || '—'} → ${p.beneficiaire}`);
  if (!morceaux.length) {
    return { statut: 'message', texte: 'Que voulez-vous modifier ? Exemple : « change le montant du cautionnement de l’obligation d’exécution à 1 200 000 $ à la soumission cautionnement 1 ».' };
  }
  if (!confirme) {
    const resume = `Je vais modifier l'obligation « ${libelleTypeObligationCaut(o.type)} »${o.beneficiaire ? ` (${o.beneficiaire})` : ''} de la soumission cautionnement #${s.id} (${nomClientSoumission(s)}) : ${morceaux.join(', ')}. Confirmez-vous ?`;
    return { statut: 'confirmation', resume, commande: { action: 'modifier_obligation_caut', params: p } };
  }
  caut.modifierObligation(o.id, cabinetId, utilisateur.id, {
    type: o.type,
    beneficiaire: p.beneficiaire !== undefined ? p.beneficiaire : o.beneficiaire,
    description_projet: o.description_projet,
    montant_contrat: p.montant_contrat !== undefined ? p.montant_contrat : o.montant_contrat,
    montant_cautionnement: p.montant_cautionnement !== undefined ? p.montant_cautionnement : o.montant_cautionnement,
    taux_pct: o.taux_pct, prime_estimee: p.prime_estimee !== undefined ? p.prime_estimee : o.prime_estimee,
    date_debut: o.date_debut, duree_mois: o.duree_mois,
  });
  return {
    statut: 'message',
    texte: `C'est fait : obligation « ${libelleTypeObligationCaut(o.type)} » mise à jour (${morceaux.join(', ')}). Voir : /cautionnement/${s.id}`,
  };
}

function executerCommande(cabinetId, utilisateur, cmd, opts = {}) {
  const confirme = !!opts.confirme;
  try {
    switch (cmd.action) {
      case 'ajouter_conducteur':
        return execAjouterConducteur(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ajouter_vehicule':
        return execAjouterVehicule(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_garantie':
        return execModifierGarantie(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ajouter_batiment':
        return execAjouterBatiment(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ajouter_contenu':
        return execAjouterContenu(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_garantie_biens':
        return execModifierGarantieBiens(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ajouter_lieu_rc':
        return execAjouterLieuRC(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_garanties_rc':
        return execModifierGarantiesRC(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ajouter_mesure_cyber':
        return execAjouterMesureCyber(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_garanties_cyber':
        return execModifierGarantiesCyber(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_maturite_mesure':
        return execModifierMaturiteMesure(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ajouter_activite_eo':
        return execAjouterActiviteEO(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_garanties_eo':
        return execModifierGarantiesEO(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_activite_eo':
        return execModifierActiviteEO(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ajouter_dirigeant_do':
        return execAjouterDirigeantDO(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_garanties_do':
        return execModifierGarantiesDO(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_dirigeant_do':
        return execModifierDirigeantDO(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ajouter_etablissement_pe':
        return execAjouterEtablissementPE(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_garanties_pe':
        return execModifierGarantiesPE(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_etablissement_pe':
        return execModifierEtablissementPE(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ajouter_vehicule_flotte':
        return execAjouterVehiculeFlotte(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ajouter_obligation_caut':
        return execAjouterObligationCaut(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_ligne_caut':
        return execModifierLigneCaut(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_obligation_caut':
        return execModifierObligationCaut(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ajouter_conducteur_flotte':
        return execAjouterConducteurFlotte(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_garanties_flotte':
        return execModifierGarantiesFlotte(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'modifier_vehicule_flotte':
        return execModifierVehiculeFlotte(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'creer_combinee':
        return execCreerCombinee(cabinetId, utilisateur, cmd.params || {}, confirme);
      case 'ouvrir_combinee':
        return execOuvrirCombinee(cabinetId, utilisateur, cmd.params || {});
      case 'creer_rappel':
        return execCreerRappel(cabinetId, utilisateur.id, cmd.params || {});
      case 'aller_a':
        return execAllerA(cmd.params || {});
      case 'rechercher':
        return execRechercher(cabinetId, utilisateur, cmd.params || {});
      default:
        return { statut: 'message', texte: 'Commande non prise en charge.' };
    }
  } catch (e) {
    return { statut: 'message', texte: "Une erreur est survenue pendant l'exécution. Réessayez ou reformulez votre demande." };
  }
}

// --- Interprétation via Cohere (ou future IA québécoise) --------------------------------------------
const ACTIONS_COHERE = [
  'ajouter_conducteur', 'ajouter_vehicule', 'modifier_garantie',
  'ajouter_batiment', 'ajouter_contenu', 'modifier_garantie_biens',
  'ajouter_lieu_rc', 'modifier_garanties_rc',
  'ajouter_mesure_cyber', 'modifier_garanties_cyber', 'modifier_maturite_mesure',
  'ajouter_activite_eo', 'modifier_garanties_eo', 'modifier_activite_eo',
  'ajouter_dirigeant_do', 'modifier_garanties_do', 'modifier_dirigeant_do',
  'ajouter_etablissement_pe', 'modifier_garanties_pe', 'modifier_etablissement_pe',
  'ajouter_vehicule_flotte', 'ajouter_conducteur_flotte', 'modifier_garanties_flotte', 'modifier_vehicule_flotte',
  'ajouter_obligation_caut', 'modifier_ligne_caut', 'modifier_obligation_caut',
  'creer_combinee', 'ouvrir_combinee',
  'creer_rappel', 'aller_a', 'rechercher', 'aide',
];

// Prompt d'interprétation des commandes — PARTAGÉ par Cohere et Augure
// (même contrat JSON : { action, params } validé contre ACTIONS_COHERE).
function construirePromptCommandes(texte) {
  const { contexteTables } = require('./contexte-ia');
  const schema = contexteTables();
  return `Tu es un interpréteur de commandes pour une application de courtier d'assurance automobile (Québec).
${schema}
L'utilisateur écrit en français. Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte autour.
Commandes possibles :
- {"action":"ajouter_conducteur","params":{"soumission_id":1 ou null,"soumission_client":"NOM ou null","prenom":"...","nom":"...","numero_permis":"..." ou null}}
- {"action":"ajouter_vehicule","params":{"soumission_id":1 ou null,"soumission_client":"NOM ou null","annee":2022 ou null,"marque":"...","modele":"..." ou null,"vin":"..." ou null}}
- {"action":"modifier_garantie","params":{"soumission_id":1 ou null,"soumission_client":"NOM ou null","vehicule_index":1 ou null,"rc_montant":2000000 ou null,"protection_b":"b1|b2|b3|b4|aucune ou null","franchise_b":500 ou null}}
- {"action":"ajouter_batiment","params":{"soumission_biens_id":1 ou null,"soumission_client":"NOM ou null","adresse":"...","ville":"..." ou null,"type_construction":"..." ou null,"annee_construction":1985 ou null,"superficie_pi2":12000 ou null,"occupation":"..." ou null,"valeur_batiment":1500000 ou null}}
- {"action":"ajouter_contenu","params":{"soumission_biens_id":1 ou null,"soumission_client":"NOM ou null","description":"...","valeur":50000 ou null,"batiment_index":1 ou null}}
- {"action":"modifier_garantie_biens","params":{"soumission_biens_id":1 ou null,"soumission_client":"NOM ou null","batiment_index":1 ou null,"formule":"tous_risques|risques_designes ou null","franchise":1000 ou null,"montant_assurance":1500000 ou null}}
- {"action":"ajouter_lieu_rc","params":{"soumission_rc_id":1 ou null,"soumission_client":"NOM ou null","adresse":"...","ville":"..." ou null,"code_postal":"..." ou null,"type_activite":"..." ou null,"code_classification":"..." ou null,"description_activites":"..." ou null,"chiffre_affaires":1200000 ou null,"masse_salariale":800000 ou null,"nb_employes":25 ou null,"superficie_pi2":5000 ou null,"sous_traitants":"aucun|assures|non_assures ou null"}}
- {"action":"modifier_garanties_rc","params":{"soumission_rc_id":1 ou null,"soumission_client":"NOM ou null","exploitation_index":1 ou null,"limite_par_sinistre":2000000 ou null,"limite_agregat":4000000 ou null,"franchise":5000 ou null,"formule":"locaux_operations|produits_completes|globale ou null","avenants":{"pollution":1 ou 0,"parapluie":1 ou 0} ou null}}
- {"action":"ajouter_mesure_cyber","params":{"soumission_cyber_id":1 ou null,"soumission_client":"NOM ou null","type_mesure":"mfa|sauvegardes|antivirus_edr|pare_feu|formation_hameconnage|plan_reponse_incident|chiffrement|gestion_correctifs|controle_acces|autre","statut":"en_place|partiel|absent|prevu ou null","details":"..." ou null}}
- {"action":"modifier_garanties_cyber","params":{"soumission_cyber_id":1 ou null,"soumission_client":"NOM ou null","limite_par_sinistre":2000000 ou null,"limite_agregat":4000000 ou null,"franchise":5000 ou null,"delai_carence":"8 heures ou null","prime":2400 ou null,"avenants":{"rancongiciel":1 ou 0,"fraude_transfert":1 ou 0,"donnees_vie_privee":1 ou 0,"interruption":1 ou 0} ou null}}
- {"action":"modifier_maturite_mesure","params":{"soumission_cyber_id":1 ou null,"soumission_client":"NOM ou null","mesure_type":"mfa|sauvegardes|antivirus_edr|pare_feu|formation_hameconnage|plan_reponse_incident|chiffrement|gestion_correctifs|controle_acces|autre ou null","mesure_index":1 ou null,"statut":"en_place|partiel|absent|prevu"}}
- {"action":"ajouter_activite_eo","params":{"soumission_eo_id":1 ou null,"soumission_client":"NOM ou null","description_activite":"...","chiffre_affaires":180000 ou null,"nb_professionnels":4 ou null}}
- {"action":"modifier_garanties_eo","params":{"soumission_eo_id":1 ou null,"soumission_client":"NOM ou null","limite_par_sinistre":2000000 ou null,"limite_agregat":2000000 ou null,"franchise":10000 ou null,"base":"reclamations_presentees|occurrences ou null","prime":9500 ou null,"avenants":{"frais_defense":1 ou 0,"medias_contenu":1 ou 0,"cyber_associe":1 ou 0} ou null}}
- {"action":"modifier_activite_eo","params":{"soumission_eo_id":1 ou null,"soumission_client":"NOM ou null","activite_index":1 ou null,"activite_recherche":"..." ou null,"chiffre_affaires":200000 ou null}}
- {"action":"ajouter_dirigeant_do","params":{"soumission_do_id":1 ou null,"soumission_client":"NOM ou null","nom":"...","fonction":"..." ou null,"annees_experience":15 ou null,"antecedents_personnels":"..." ou null}}
- {"action":"modifier_garanties_do","params":{"soumission_do_id":1 ou null,"soumission_client":"NOM ou null","limite_par_sinistre":2000000 ou null,"limite_agregat":2000000 ou null,"franchise":10000 ou null,"base":"reclamations_presentees|occurrences ou null","prime":9500 ou null,"avenants":{"frais_defense":1 ou 0,"pratiques_emploi":1 ou 0,"fidelite_crime":1 ou 0} ou null}}
- {"action":"modifier_dirigeant_do","params":{"soumission_do_id":1 ou null,"soumission_client":"NOM ou null","dirigeant_index":1 ou null,"dirigeant_recherche":"..." ou null,"nom":"..." ou null,"fonction":"..." ou null,"annees_experience":20 ou null,"antecedents_personnels":"..." ou null}}
- {"action":"ajouter_etablissement_pe","params":{"soumission_pe_id":1 ou null,"soumission_client":"NOM ou null","nom_lieu":"...","adresse":"..." ou null,"occupation":"..." ou null,"chiffre_affaires":750000 ou null,"superficie":250 ou null,"annee_construction":1965 ou null,"base_valeur":"remplacement|depreciation ou null"}}
- {"action":"modifier_garanties_pe","params":{"soumission_pe_id":1 ou null,"soumission_client":"NOM ou null","limite":800000 ou null,"periode_indemnite_mois":12 ou 18 ou 24 ou null,"franchise_jours":3 ou null,"base_montant":"benefice_brut|marge_brute|chiffre_affaires ou null","prime":2800 ou null,"avenants":{"frais_supplementaires":1 ou 0,"dependance_fournisseurs":1 ou 0,"acces_civil":1 ou 0,"deterioration_stocks":1 ou 0} ou null}}
- {"action":"modifier_etablissement_pe","params":{"soumission_pe_id":1 ou null,"soumission_client":"NOM ou null","etablissement_index":1 ou null,"etablissement_recherche":"..." ou null,"nom_lieu":"..." ou null,"occupation":"..." ou null,"chiffre_affaires":450000 ou null,"superficie":120 ou null,"annee_construction":1965 ou null,"base_valeur":"remplacement|depreciation ou null"}}
- {"action":"ajouter_vehicule_flotte","params":{"soumission_flotte_id":1 ou null,"soumission_client":"NOM ou null","annee":2023 ou null,"marque":"...","modele":"..." ou null,"vin":"..." ou null,"type_vehicule":"camion|automobile|remorque|equipement ou null","usage":"livraison|service|transport_marchandises|personnel ou null","rayon_operation_km":150 ou null,"valeur":45000 ou null}}
- {"action":"ajouter_conducteur_flotte","params":{"soumission_flotte_id":1 ou null,"soumission_client":"NOM ou null","prenom":"...","nom":"...","numero_permis":"..." ou null,"classe_permis":"3" ou null,"annees_experience":15 ou null}}
- {"action":"modifier_garanties_flotte","params":{"soumission_flotte_id":1 ou null,"soumission_client":"NOM ou null","limite_rc":2000000 ou null,"franchise_collision":1000 ou null,"franchise_versement":1000 ou null,"prime":9850 ou null,"avenants":{"faq43":1 ou 0,"faq20":1 ou 0,"faq27":1 ou 0,"faq34":1 ou 0,"faq5a":1 ou 0} ou null}}
- {"action":"modifier_vehicule_flotte","params":{"soumission_flotte_id":1 ou null,"soumission_client":"NOM ou null","vehicule_index":1 ou null,"vehicule_recherche":"..." ou null,"valeur":45000 ou null,"rayon_operation_km":150 ou null,"usage":"livraison|service|transport_marchandises|personnel ou null","annee":2023 ou null}}
- {"action":"ajouter_obligation_caut","params":{"soumission_caut_id":1 ou null,"soumission_client":"NOM ou null","type":"soumission|execution|paiement_mo|rbq|autre","beneficiaire":"..." ou null,"description_projet":"..." ou null,"montant_contrat":2200000 ou null,"montant_cautionnement":1100000 ou null,"prime_estimee":13750 ou null}}
- {"action":"modifier_ligne_caut","params":{"soumission_caut_id":1 ou null,"soumission_client":"NOM ou null","limite_globale":5000000 ou null,"limite_par_projet":2500000 ou null,"fonds_roulement":850000 ou null,"valeur_nette":1900000 ou null,"prime":21500 ou null}}
- {"action":"modifier_obligation_caut","params":{"soumission_caut_id":1 ou null,"soumission_client":"NOM ou null","obligation_index":1 ou null,"obligation_type":"soumission|execution|paiement_mo|rbq|autre ou null","montant_cautionnement":1200000 ou null,"montant_contrat":2400000 ou null,"prime_estimee":15000 ou null,"beneficiaire":"..." ou null}}
- {"action":"creer_combinee","params":{"client":"NOM de l'entreprise","client_id":1 ou null}}
- {"action":"ouvrir_combinee","params":{"client":"NOM de l'entreprise ou null","dossier_id":1 ou null}}
- {"action":"creer_rappel","params":{"titre":"...","entreprise":"NOM ou null","echeance":"AAAA-MM-JJ ou null"}}
- {"action":"aller_a","params":{"url":"/auto ou /echeances ou /taches ou /clients ou /polices ou /reclamations ou /facturation ou /auto/1 ...","libelle":"..."}}
- {"action":"rechercher","params":{"type":"client|police|soumission|general","terme":"..."}}
- {"action":"aide","params":{}}
- {"action":"inconnue","params":{}}
Ne devine jamais une valeur : si l'utilisateur ne l'a pas précisée dans sa demande, mets null pour ce paramètre — n'emprunte rien à un autre dossier.
Demande de l'utilisateur : """${texte.slice(0, 500)}"""`;
}

// Extraction + validation de la commande JSON (action permise seulement).
function parserCommandeJson(brut) {
  const debut = String(brut).indexOf('{');
  const fin = String(brut).lastIndexOf('}');
  if (debut < 0 || fin < 0) return null;
  let cmd;
  try { cmd = JSON.parse(String(brut).slice(debut, fin + 1)); } catch (e) { return null; }
  if (!cmd || typeof cmd.action !== 'string') return null;
  if (!ACTIONS_COHERE.includes(cmd.action)) return null;
  const params = (cmd.params && typeof cmd.params === 'object') ? cmd.params : {};
  return { action: cmd.action, params };
}

async function interpreterCohere(texte, cle) {
  const { appelerCohere } = require('./ia');
  try {
    const brut = await appelerCohere(construirePromptCommandes(texte), cle, { temperature: 0 });
    return parserCommandeJson(brut);
  } catch (e) {
    return null;
  }
}

// Même contrat que Cohere, via l'API canadienne Augure (mode JSON).
async function interpreterAugure(texte, cle, modele) {
  const { appelerAugure } = require('./augure');
  try {
    const brut = await appelerAugure({ cle, modele, prompt: construirePromptCommandes(texte), jsonMode: true, temperature: 0 });
    return parserCommandeJson(brut);
  } catch (e) {
    return null;
  }
}

// --- Aide ------------------------------------------------------------------------------------------------
function texteAide() {
  return `Voici ce que je peux faire pour l'instant :
• « ajoute le contact Marie Tremblay chez Acme, courriel marie@acme.ca »
• « crée une tâche appeler le comptable pour Acme pour le 2026-10-20 »
• « ajoute une note pour Acme : client rappelé, tout est beau »
• « liste les tâches en retard »
• « ajoute un conducteur Marie Tremblay permis T1234567 à la soumission 1 »
• « ajoute un véhicule Honda CR-V 2022 vin 2HKRW2H54NH123456 à la soumission 1 »
• « mets la RC à 2 millions pour le véhicule 1 de la soumission 1 »
• « rappelle-moi de rappeler Dubois pour Martin Dubois demain »
• « montre-moi la soumission 1 » / « ouvre les échéances »
• « cherche le client Dubois » / « cherche la police AUTO-2026-001 »
• « ajoute un bâtiment au 123 rue Principale à Montréal à la soumission biens 1 »
• « ajoute un contenu outillage 50000 $ au bâtiment 1 de la soumission biens 1 »
• « mets la formule tous risques pour le bâtiment 1 de la soumission biens 1 »
• « montre-moi la soumission biens 1 » / « ouvre les biens »
• « ajoute un lieu au 456 boulevard Industriel à Laval activité entrepôt chiffre d'affaires 1,2 million à la soumission RC 1 »
• « mets la limite par sinistre à 2 millions et l'agrégat à 4 millions pour le lieu 1 de la soumission RC 1 »
• « montre-moi la soumission RC 1 » / « ouvre les RC »
• « ajoute la mesure MFA en place à la soumission cyber 1 »
• « mets la limite par sinistre à 2 millions et retire l'avenant interruption pour la soumission cyber 1 »
• « passe la mesure sauvegardes en partiel sur la soumission cyber 1 »
• « montre-moi la soumission cyber 1 » / « ouvre le cyber »
• « ajoute l’activité conseil fiscal avec 180 000 $ de chiffre d’affaires à la soumission E&O 1 »
• « mets la franchise à 10 000 $ pour la soumission E&O 1 »
• « ajoute l’avenant frais de défense à la soumission E&O 1 »
• « montre-moi la soumission E&O 1 » / « ouvre l’E&O »
• « ajoute le dirigeant Marc Bouchard comme trésorier à la soumission D&O 1 »
• « mets la franchise à 10 000 $ et ajoute l’avenant pratiques d’emploi pour la soumission D&O 1 »
• « change la fonction du dirigeant Marc Bouchard de la soumission D&O 1 à président »
• « montre-moi la soumission D&O 1 » / « ouvre le D&O »
• « ajoute l’établissement Fournil occupation boulangerie avec 750 000 $ de chiffre d’affaires à la soumission perte d’exploitation 1 »
• « mets la période d’indemnité à 18 mois et la franchise à 5 jours pour la soumission perte d’exploitation 1 »
• « ajoute l’avenant accès civil et retire l’avenant détérioration des stocks pour la soumission perte d’exploitation 1 »
• « change l’occupation de l’établissement Fournil de la soumission perte d’exploitation 1 à commerce de détail »
• « montre-moi la soumission perte d’exploitation 1 » / « ouvre la perte d’exploitation »
• « ajoute le véhicule Ford Transit 2023 avec 45 000 $ de valeur à la soumission flotte 1 »
• « ajoute un conducteur Marie Tremblay permis T1234567 classe 3 à la soumission flotte 1 »
• « mets la limite RC à 2 millions et la franchise collision à 1 000 $ pour la soumission flotte 1 »
• « ajoute la FAQ 43 (valeur à neuf) et retire la FAQ 27 à la soumission flotte 1 »
• « mets le véhicule deux à 45 000 $ de valeur pour la soumission flotte 1 »
• « ajoute un cautionnement d'exécution de 1 100 000 $ contrat 2 200 000 $ pour le Centre de services scolaire des Mille-Îles projet École des Pins à la soumission cautionnement 1 »
• « mets la limite globale à 6 millions et la limite par projet à 3 millions à la soumission cautionnement 1 »
• « change le montant du cautionnement de l'obligation d'exécution à 1 200 000 $ à la soumission cautionnement 1 »
• « montre-moi la soumission cautionnement 1 » / « ouvre le cautionnement »
• « montre-moi la soumission flotte 1 » / « ouvre la flotte »
Écrivez ou utilisez le micro pour dicter. Dites « aide » pour revoir cette liste.
🎤 Confidentialité : la dictée passe par le service vocal de votre navigateur (Google/Apple selon le navigateur). Une transcription 100 % locale sera possible au déploiement.`;
}

module.exports = {
  analyser, interpreterCohere, interpreterAugure, executerCommande, texteAide, ACTIONS_COHERE,
  resoudreSoumission, resoudreVehicule, resoudreSoumissionBiens, resoudreBatiment,
  resoudreSoumissionRC, resoudreExploitation, resoudreSoumissionCyber, resoudreMesure,
  resoudreSoumissionEO, resoudreActivite, resoudreSoumissionDO, resoudreDirigeant,
  resoudreSoumissionPE, resoudreEtablissement,
  resoudreSoumissionFlotte, resoudreVehiculeFlotte,
};
