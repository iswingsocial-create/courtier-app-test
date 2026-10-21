/**
 * lib/places-google.js — Enrichissement Google Maps (API Places « New ») :
 * retrouver une entreprise par son nom pour PRÉ-REMPLIR sa fiche (adresse
 * complète, code postal, téléphone, site web) — jamais sans révision
 * humaine : ce module ne fait que chercher et normaliser.
 *
 * Réglage de la clé : même pattern que la clé Cohere (lib/reglages-ia.js) —
 * colonne `reglages_ia.cle_google_chiffree`, chiffrée AES-256-GCM
 * (lib/chiffrement.js), affichée masquée (4 derniers caractères), jamais
 * journalisée en clair. Source : réglage du cabinet d'abord, sinon la
 * variable d'environnement GOOGLE_PLACES_API_KEY (déploiement).
 *
 * Appels : POST /v1/places:searchText et GET /v1/places/{id} avec
 * X-Goog-Api-Key et X-Goog-FieldMask limité aux champs utiles (coût maîtrisé).
 * La base est surchargeable par PLACES_BASE_URL (tests : harnais local,
 * JAMAIS d'appel réel à Google pendant les tests).
 */
const bd = require('./bd');
const { chiffrer, dechiffrer } = require('./chiffrement');
const { journal } = require('./middleware');

const BASE_DEFAUT = 'https://places.googleapis.com/v1';
const CHAMPS_RECHERCHE = [
  'places.id', 'places.displayName', 'places.formattedAddress',
  'places.addressComponents', 'places.nationalPhoneNumber',
  'places.internationalPhoneNumber', 'places.websiteUri', 'places.rating',
  'places.userRatingCount', 'places.businessStatus', 'places.types',
  'places.regularOpeningHours',
].join(',');
const CHAMPS_DETAILS = CHAMPS_RECHERCHE.split(',').map((c) => c.replace(/^places\./, '')).join(',');

function baseUrl() {
  return String(process.env.PLACES_BASE_URL || BASE_DEFAUT).replace(/\/+$/, '');
}

// --- Réglage de la clé (miroir de lib/reglages-ia.js) ---------------------------

function ligneReglage(cabinetId) {
  return bd.prepare('SELECT * FROM reglages_ia WHERE cabinet_id = ?').get(cabinetId) || null;
}

function cleGoogleCabinet(cabinetId) {
  const l = ligneReglage(cabinetId);
  if (!l || !l.cle_google_chiffree) return null;
  try { return dechiffrer(l.cle_google_chiffree); } catch (e) { return null; }
}

// Clé effective (jamais journalisée) : cabinet d'abord, sinon environnement.
function cleGoogle(cabinetId) {
  return cleGoogleCabinet(cabinetId) || process.env.GOOGLE_PLACES_API_KEY || null;
}

function masqueCleGoogle(cabinetId) {
  try {
    const cle = cleGoogleCabinet(cabinetId);
    if (!cle) return null;
    return '•••• •••• ' + cle.slice(-4);
  } catch (e) { return '•••• (illisible)'; }
}

function obtenirReglageGoogle(cabinetId) {
  const l = ligneReglage(cabinetId);
  const cleCabinet = !!(l && l.cle_google_chiffree);
  const cleEnv = !!process.env.GOOGLE_PLACES_API_KEY;
  return {
    cleCabinetPresente: cleCabinet,
    cleEnvPresente: cleEnv,
    clePresente: cleCabinet || cleEnv,
    configuree: cleCabinet || cleEnv,
    masque: cleCabinet ? masqueCleGoogle(cabinetId) : null,
  };
}

function definirCleGoogle(cabinetId, userId, cleClair) {
  const cle = String(cleClair || '').trim();
  if (cle.length < 8) throw new Error('La clé semble trop courte (8 caractères minimum).');
  bd.prepare(`
    INSERT INTO reglages_ia (cabinet_id, cle_google_chiffree, maj_le)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(cabinet_id) DO UPDATE SET cle_google_chiffree = excluded.cle_google_chiffree, maj_le = datetime('now')
  `).run(cabinetId, chiffrer(cle));
  journal(cabinetId, userId, 'google_cle_enregistree', `Clé API Google Places enregistrée (masque : •••• ${cle.slice(-4)})`);
}

function effacerCleGoogle(cabinetId, userId) {
  bd.prepare(`
    INSERT INTO reglages_ia (cabinet_id, cle_google_chiffree, maj_le)
    VALUES (?, NULL, datetime('now'))
    ON CONFLICT(cabinet_id) DO UPDATE SET cle_google_chiffree = NULL, maj_le = datetime('now')
  `).run(cabinetId);
  journal(cabinetId, userId, 'google_cle_effacee', 'Clé API Google Places retirée du réglage du cabinet');
}

// --- Appels à l'API Places -------------------------------------------------------

function messageErreurPlaces(statut, json) {
  const detail = (json && json.error && json.error.message) || '';
  if (statut === 401 || statut === 403) {
    return 'Google Places a refusé la clé (accès refusé). Vérifiez la clé saisie et que l’API « Places API (New) » est activée, avec la facturation, sur le projet Google Cloud.';
  }
  if (statut === 429) {
    return 'Google Places : quota dépassé (429). Réessayez plus tard ou vérifiez les quotas du projet Google Cloud.';
  }
  if (statut === 400) {
    return `Google Places a refusé la demande (400)${detail ? ` : ${String(detail).slice(0, 160)}` : ''}.`;
  }
  return `Google Places a répondu ${statut}. Réessayez plus tard.`;
}

async function appelPlaces(methode, chemin, cle, masque, corps) {
  const ctrl = new AbortController();
  const delai = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(baseUrl() + chemin, {
      method: methode,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': cle,
        'X-Goog-FieldMask': masque,
      },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: ctrl.signal,
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* réponse non JSON */ }
    if (!res.ok) {
      const err = new Error(messageErreurPlaces(res.status, json));
      err.statutHttp = res.status;
      throw err;
    }
    return json || {};
  } catch (e) {
    if (e.statutHttp) throw e;
    if (e.name === 'AbortError') throw new Error('Google Places : délai dépassé (15 s) — service lent ou injoignable depuis le serveur.');
    throw new Error(`Google Places injoignable : ${e.message}`);
  } finally {
    clearTimeout(delai);
  }
}

// --- Normalisation vers les champs de la fiche client ------------------------------

function composant(lieu, type, court = false) {
  const c = (lieu.addressComponents || []).find((x) => (x.types || []).includes(type));
  if (!c) return null;
  return (court ? c.shortText : c.longText) || c.longText || c.shortText || null;
}

/**
 * Convertit un lieu de l'API Places en coordonnées de fiche client.
 * L'adresse civique vient des composantes (numéro + rue) ; l'adresse
 * formatée complète est conservée à part (affichage du candidat).
 */
function normaliserLieu(lieu) {
  const numero = composant(lieu, 'street_number');
  const rue = composant(lieu, 'route');
  return {
    place_id: lieu.id || null,
    raison_sociale: (lieu.displayName && lieu.displayName.text) || null,
    adresse: [numero, rue].filter(Boolean).join(' ') || null,
    adresse_complete: lieu.formattedAddress || null,
    ville: composant(lieu, 'locality')
      || composant(lieu, 'administrative_area_level_2')
      || composant(lieu, 'sublocality')
      || composant(lieu, 'sublocality_level_1'),
    province: composant(lieu, 'administrative_area_level_1', true),
    code_postal: composant(lieu, 'postal_code'),
    telephone: lieu.nationalPhoneNumber || lieu.internationalPhoneNumber || null,
    site_web: lieu.websiteUri || null,
    note: lieu.rating != null ? lieu.rating : null,
    nb_avis: lieu.userRatingCount != null ? lieu.userRatingCount : null,
    statut_affaires: lieu.businessStatus || null,
    types: lieu.types || [],
    heures_ouverture: (lieu.regularOpeningHours && lieu.regularOpeningHours.weekdayDescriptions) || null,
  };
}

// --- Recherche et détails -----------------------------------------------------------

async function rechercherEntreprises(texte, cle) {
  if (!cle) {
    const e = new Error('Aucune clé API Google Maps n’est configurée pour ce cabinet.');
    e.code = 'non_configure';
    throw e;
  }
  const requete = String(texte || '').trim();
  if (!requete) return [];
  const json = await appelPlaces('POST', '/places:searchText', cle, CHAMPS_RECHERCHE, {
    textQuery: requete,
    languageCode: 'fr',
    regionCode: 'CA',
    maxResultCount: 5,
  });
  return (Array.isArray(json.places) ? json.places : []).map(normaliserLieu);
}

async function detailsEntreprise(placeId, cle) {
  if (!cle) {
    const e = new Error('Aucune clé API Google Maps n’est configurée pour ce cabinet.');
    e.code = 'non_configure';
    throw e;
  }
  if (!placeId) throw new Error('Identifiant Google (place_id) manquant.');
  const json = await appelPlaces('GET', '/places/' + encodeURIComponent(placeId), cle, CHAMPS_DETAILS, null);
  return normaliserLieu(json);
}

// Variantes « cabinet » pour les routes : ne lèvent pas — elles décrivent
// l'état (non configuré / erreur / résultats) pour un affichage sobre.
async function rechercherPourCabinet(cabinetId, texte) {
  const cle = cleGoogle(cabinetId);
  if (!cle) return { statut: 'non_configure', resultats: [] };
  try {
    return { statut: 'ok', resultats: await rechercherEntreprises(texte, cle) };
  } catch (e) {
    return { statut: 'erreur', resultats: [], message: e.message };
  }
}

async function detailsPourCabinet(cabinetId, placeId) {
  const cle = cleGoogle(cabinetId);
  if (!cle) return { statut: 'non_configure', entreprise: null };
  try {
    return { statut: 'ok', entreprise: await detailsEntreprise(placeId, cle) };
  } catch (e) {
    return { statut: 'erreur', entreprise: null, message: e.message };
  }
}

// Test de connexion : une mini-recherche réelle (ou vers le harnais de test
// quand PLACES_BASE_URL le pointe) ; échoue proprement, sans jamais exposer
// la clé.
async function testerConnexionGoogle(cabinetId) {
  const cle = cleGoogle(cabinetId);
  if (!cle) {
    return {
      ok: false, statut: 'non_configure',
      message: "Aucune clé API Google Maps n'est configurée (ni dans ce réglage, ni dans l'environnement). Enregistrez une clé puis réessayez.",
    };
  }
  try {
    const r = await rechercherEntreprises('Montréal', cle);
    return { ok: true, message: `Connexion à Google Places réussie : la clé est acceptée (recherche d'essai : ${r.length} résultat(s)).` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

module.exports = {
  obtenirReglageGoogle, definirCleGoogle, effacerCleGoogle, cleGoogle,
  rechercherEntreprises, detailsEntreprise, normaliserLieu,
  rechercherPourCabinet, detailsPourCabinet, testerConnexionGoogle, baseUrl,
};
