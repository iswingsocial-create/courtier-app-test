/**
 * lib/augure.js — Moteur IA Augure (canadien) : API d'inférence compatible
 * OpenAI (https://augureai.ca/fr/developpeurs). Tout tourne au Canada,
 * sans fournisseur américain ; entente de traitement des données (DPA)
 * disponible chez le fournisseur.
 *
 * Réglage de la clé : même pattern que les clés Cohere et Google Places —
 * colonne `reglages_ia.cle_augure_chiffree`, chiffrée AES-256-GCM
 * (lib/chiffrement.js), affichée masquée (4 derniers caractères), jamais
 * journalisée en clair. Source EFFECTIVE (demande de Patrick, 2026-10-21) :
 * la variable d'environnement AUGURE_API_KEY d'abord — réglée une seule
 * fois dans l'environnement du serveur (Render → Environment), elle est
 * PERSISTANTE et survit aux redéploiements, contrairement à la base de
 * test qui est réinitialisée ; le réglage du cabinet reste le repli quand
 * la variable est absente.
 *
 * Appels : POST {base}/chat/completions (Authorization: Bearer), format
 * OpenAI — messages système/utilisateur, temperature 0, et
 * `response_format: { type: 'json_object' }` en mode JSON. La base est
 * surchargeable par AUGURE_BASE_URL (tests : harnais local, JAMAIS
 * d'appel réel à Augure pendant les tests).
 *
 * Condition du fournisseur : les applications utilisant l'API affichent
 * la mention « Propulsé par Augure » — voir views/partials/bas.ejs,
 * affichée quand le moteur effectif du cabinet est Augure.
 */
const bd = require('./bd');
const { chiffrer, dechiffrer } = require('./chiffrement');
const { journal } = require('./middleware');

const BASE_DEFAUT = 'https://api.augureai.ca/v1';
const MODELE_DEFAUT = 'ossington-5';

// Modèles offerts (documentation officielle, prix en CAD par 1M de jetons
// entrée/sortie).
const MODELES_AUGURE = [
  { id: 'ossington-5', nom: 'Ossington 5', description: 'Raisonnement rapide', contexte: '256K', prixEntree: 1.50, prixSortie: 3.00 },
  { id: 'ossington-4', nom: 'Ossington 4', description: 'Raisonnement', contexte: '256K', prixEntree: 2.00, prixSortie: 5.00 },
  { id: 'ossington-4-1', nom: 'Ossington 4.1', description: 'Raisonnement amélioré', contexte: '256K', prixEntree: 2.50, prixSortie: 6.00 },
  { id: 'rosedale-1', nom: 'Rosedale 1', description: 'Raisonnement premium multi-étapes', contexte: '1M', prixEntree: 2.50, prixSortie: 6.00 },
  { id: 'tofino-3', nom: 'Tofino 3', description: 'Léger et rapide, sans raisonnement', contexte: '128K', prixEntree: 0.60, prixSortie: 2.00 },
  { id: 'open-glm-5-3', nom: 'Open GLM 5.3', description: 'Aperçu, poids ouverts', contexte: '128K', prixEntree: 3.00, prixSortie: 7.00 },
];
const IDS_MODELES = MODELES_AUGURE.map((m) => m.id);

function baseUrl() {
  return String(process.env.AUGURE_BASE_URL || BASE_DEFAUT).replace(/\/+$/, '');
}

// --- Réglage : clé + modèle (miroir de lib/places-google.js) ---------------------

function ligneReglage(cabinetId) {
  return bd.prepare('SELECT * FROM reglages_ia WHERE cabinet_id = ?').get(cabinetId) || null;
}

function cleAugureCabinet(cabinetId) {
  const l = ligneReglage(cabinetId);
  if (!l || !l.cle_augure_chiffree) return null;
  try { return dechiffrer(l.cle_augure_chiffree); } catch (e) { return null; }
}

// Clé d'environnement (déploiement) : lue à chaque appel, jamais
// journalisée. Une valeur vide ou blanche compte comme absente.
function cleAugureEnv() {
  const v = String(process.env.AUGURE_API_KEY || '').trim();
  return v || null;
}

// Clé effective (jamais journalisée) : ENVIRONNEMENT d'abord (persistante,
// prioritaire), sinon le réglage chiffré du cabinet (repli).
function cleAugure(cabinetId) {
  return cleAugureEnv() || cleAugureCabinet(cabinetId) || null;
}

function masqueCleAugure(cabinetId) {
  try {
    const cle = cleAugureCabinet(cabinetId);
    if (!cle) return null;
    return '•••• •••• ' + cle.slice(-4);
  } catch (e) { return '•••• (illisible)'; }
}

function modeleAugure(cabinetId) {
  const l = ligneReglage(cabinetId);
  const m = l && l.modele_augure;
  return IDS_MODELES.includes(m) ? m : MODELE_DEFAUT;
}

function obtenirReglageAugure(cabinetId) {
  const cleCabinet = !!cleAugureCabinet(cabinetId);
  const env = cleAugureEnv();
  const cleEnv = !!env;
  return {
    cleCabinetPresente: cleCabinet,
    cleEnvPresente: cleEnv,
    clePresente: cleCabinet || cleEnv,
    configuree: cleCabinet || cleEnv,
    // Source de la clé EFFECTIVE (celle que les appels utilisent) :
    // 'environnement' (prioritaire, persistante), 'cabinet' (repli) ou null.
    sourceEffective: cleEnv ? 'environnement' : (cleCabinet ? 'cabinet' : null),
    masque: cleCabinet ? masqueCleAugure(cabinetId) : null,
    masqueEffectif: cleEnv ? ('•••• •••• ' + env.slice(-4)) : (cleCabinet ? masqueCleAugure(cabinetId) : null),
    modele: modeleAugure(cabinetId),
    modeles: MODELES_AUGURE,
  };
}

function definirCleAugure(cabinetId, userId, cleClair) {
  const cle = String(cleClair || '').trim();
  if (cle.length < 8) throw new Error('La clé semble trop courte (8 caractères minimum).');
  bd.prepare(`
    INSERT INTO reglages_ia (cabinet_id, cle_augure_chiffree, maj_le)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(cabinet_id) DO UPDATE SET cle_augure_chiffree = excluded.cle_augure_chiffree, maj_le = datetime('now')
  `).run(cabinetId, chiffrer(cle));
  journal(cabinetId, userId, 'augure_cle_enregistree', `Clé API Augure enregistrée (masque : •••• ${cle.slice(-4)})`);
}

function effacerCleAugure(cabinetId, userId) {
  bd.prepare(`
    INSERT INTO reglages_ia (cabinet_id, cle_augure_chiffree, maj_le)
    VALUES (?, NULL, datetime('now'))
    ON CONFLICT(cabinet_id) DO UPDATE SET cle_augure_chiffree = NULL, maj_le = datetime('now')
  `).run(cabinetId);
  journal(cabinetId, userId, 'augure_cle_effacee', 'Clé API Augure retirée du réglage du cabinet');
}

function definirModeleAugure(cabinetId, userId, modele) {
  if (!IDS_MODELES.includes(modele)) throw new Error(`Modèle Augure inconnu : ${modele}`);
  bd.prepare(`
    INSERT INTO reglages_ia (cabinet_id, modele_augure, maj_le)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(cabinet_id) DO UPDATE SET modele_augure = excluded.modele_augure, maj_le = datetime('now')
  `).run(cabinetId, modele);
  journal(cabinetId, userId, 'augure_modele_defini', `Modèle Augure du cabinet réglé à « ${modele} »`);
}

// --- Appels à l'API (compatible OpenAI) ------------------------------------------

function messageErreurAugure(statut) {
  if (statut === 401 || statut === 403) {
    return `Augure a refusé la clé (${statut}). Vérifiez la clé saisie dans le réglage du cabinet.`;
  }
  if (statut === 429) {
    return 'Augure : quota ou limite de débit atteinte (429). Réessayez plus tard.';
  }
  if (statut === 400) {
    return 'Augure a refusé la demande (400) : format non accepté.';
  }
  return `Augure a répondu ${statut}. Réessayez plus tard.`;
}

async function appelHttp(methode, chemin, cle, corps, delaiMs = 60000) {
  const ctrl = new AbortController();
  const delai = setTimeout(() => ctrl.abort(), delaiMs);
  try {
    const res = await fetch(baseUrl() + chemin, {
      method: methode,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cle}`,
      },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: ctrl.signal,
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* réponse non JSON */ }
    if (!res.ok) {
      const err = new Error(messageErreurAugure(res.status));
      err.statutHttp = res.status;
      throw err;
    }
    return json || {};
  } catch (e) {
    if (e.statutHttp) throw e;
    if (e.name === 'AbortError') {
      const err = new Error(`Augure : délai dépassé (${Math.round(delaiMs / 1000)} s) — service lent ou injoignable depuis le serveur.`);
      err.code = 'delai';
      throw err;
    }
    throw new Error(`Augure injoignable : ${e.message}`);
  } finally {
    clearTimeout(delai);
  }
}

/**
 * Appel chat au format OpenAI. Retourne le contenu texte de la première
 * réponse. En mode JSON (`jsonMode`), on demande `response_format`
 * json_object ; si le fournisseur le refuse (HTTP 400), on réessaie une
 * fois sans — le contrat « JSON strict » est alors porté par le prompt,
 * comme pour Cohere (mettre `reessayerSansFormat: false` pour l'interdire).
 */
async function appelerAugure({ cle, modele, systeme, prompt, jsonMode = false, temperature = 0, reessayerSansFormat = true }) {
  if (!cle) {
    const e = new Error('Aucune clé API Augure configurée');
    e.code = 'non_configure';
    throw e;
  }
  const messages = [];
  if (systeme) messages.push({ role: 'system', content: String(systeme) });
  messages.push({ role: 'user', content: String(prompt || '') });
  const corps = {
    model: IDS_MODELES.includes(modele) ? modele : MODELE_DEFAUT,
    messages,
    temperature,
  };
  if (jsonMode) corps.response_format = { type: 'json_object' };
  let json;
  try {
    json = await appelHttp('POST', '/chat/completions', cle, corps);
  } catch (e) {
    if (jsonMode && reessayerSansFormat && e.statutHttp === 400) {
      const corps2 = { ...corps };
      delete corps2.response_format;
      json = await appelHttp('POST', '/chat/completions', cle, corps2);
    } else {
      throw e;
    }
  }
  const choix = Array.isArray(json.choices) ? json.choices[0] : null;
  const contenu = choix && choix.message && typeof choix.message.content === 'string'
    ? choix.message.content : null;
  if (contenu === null) throw new Error('Réponse Augure inattendue (aucun contenu)');
  return contenu.trim();
}

// Variante « cabinet » : clé et modèle depuis le réglage du cabinet.
function appelerAugureCabinet(cabinetId, options = {}) {
  const cle = cleAugure(cabinetId);
  if (!cle) return Promise.reject(new Error('Aucune clé API Augure configurée'));
  return appelerAugure({ ...options, cle, modele: options.modele || modeleAugure(cabinetId) });
}

// Test de connexion : GET /models (contrôle standard du format OpenAI).
// Si l'endpoint n'existe pas (404/405), repli sur un micro-appel chat.
// Ne lève jamais ; ne révèle jamais la clé.
async function testerConnexionAugure(cabinetId) {
  const cle = cleAugure(cabinetId);
  if (!cle) {
    return {
      ok: false, statut: 'non_configure',
      message: "Aucune clé API Augure n'est configurée (ni dans ce réglage, ni dans l'environnement). Enregistrez une clé puis réessayez.",
    };
  }
  const modele = modeleAugure(cabinetId);
  try {
    const json = await appelHttp('GET', '/models', cle, null, 20000);
    const nb = Array.isArray(json.data) ? json.data.length : 0;
    return {
      ok: true,
      message: `Connexion à Augure réussie : la clé est acceptée${nb ? ` (${nb} modèle(s) visible(s))` : ''}. Modèle du cabinet : ${modele}.`,
    };
  } catch (e) {
    if (e.statutHttp === 404 || e.statutHttp === 405) {
      try {
        await appelerAugure({ cle, modele, prompt: 'Réponds uniquement : OK', temperature: 0 });
        return { ok: true, message: `Connexion à Augure réussie : la clé est acceptée (appel d'essai au modèle ${modele}).` };
      } catch (e2) {
        return { ok: false, message: e2.message };
      }
    }
    return { ok: false, message: e.message };
  }
}

module.exports = {
  MODELES_AUGURE, MODELE_DEFAUT, baseUrl,
  obtenirReglageAugure, definirCleAugure, effacerCleAugure, definirModeleAugure,
  cleAugure, cleAugureEnv, modeleAugure, masqueCleAugure,
  appelerAugure, appelerAugureCabinet, testerConnexionAugure,
};
