/**
 * lib/microsoft.js — Intégration Microsoft 365 / Teams (Microsoft Graph).
 *
 * Structure OAuth complète + création de réunions en ligne :
 *   - urlAutorisation(cabinetId) → URL de consentement Microsoft
 *   - echangerCode(code, redirectUri) → { access_token, refresh_token, expires_in }
 *   - jetonAccesValide(cabinetId) → access token (rafraîchi au besoin) ou null
 *   - creerReunionTeams({ cabinetId, sujet, debut, fin }) → joinWebUrl
 *
 * Les jetons sont stockés CHIFFRÉS (AES-256-GCM) dans microsoft_tokens.
 * Sans identifiants (MS_CLIENT_ID / MS_CLIENT_SECRET), toutes les fonctions
 * retournent null / lèvent une erreur explicite : l'app fonctionne alors en
 * mode dégradé (lien Teams collé manuellement).
 *
 * Marche à suivre pour Patrick : voir README, section « Microsoft 365 / Teams ».
 */
const bd = require('./bd');
const { chiffrer, dechiffrer } = require('./chiffrement');

const MS_AUTORITE = 'https://login.microsoftonline.com';
const MS_GRAPH = 'https://graph.microsoft.com/v1.0';
// Permission minimale pour créer des réunions en ligne au nom de l'utilisateur.
const MS_SCOPE = 'openid offline_access OnlineMeetings.ReadWrite';

function configMicrosoft() {
  const clientId = (process.env.MS_CLIENT_ID || '').trim();
  const clientSecret = (process.env.MS_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    tenant: (process.env.MS_TENANT || 'common').trim(),
    redirectUri: (process.env.MS_REDIRECT_URI || '').trim(),
  };
}

function estConfigure() {
  const cfg = configMicrosoft();
  return !!(cfg && cfg.redirectUri);
}

function urlAutorisation(cabinetId) {
  const cfg = configMicrosoft();
  if (!cfg) throw new Error('Microsoft 365 non configuré (MS_CLIENT_ID / MS_CLIENT_SECRET manquants).');
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    response_mode: 'query',
    scope: MS_SCOPE,
    state: `cabinet-${cabinetId}`,
  });
  return `${MS_AUTORITE}/${cfg.tenant}/oauth2/v2.0/authorize?${params.toString()}`;
}

async function appelerJeton(corps) {
  const cfg = configMicrosoft();
  const params = new URLSearchParams({ ...corps, client_id: cfg.clientId, client_secret: cfg.clientSecret });
  const res = await fetch(`${MS_AUTORITE}/${cfg.tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Échec OAuth Microsoft : ${json.error_description || json.error || res.status}`);
  }
  return json;
}

async function echangerCode(code) {
  const cfg = configMicrosoft();
  if (!cfg) throw new Error('Microsoft 365 non configuré.');
  return appelerJeton({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    scope: MS_SCOPE,
  });
}

async function rafraichirJeton(refreshToken) {
  const cfg = configMicrosoft();
  if (!cfg) throw new Error('Microsoft 365 non configuré.');
  return appelerJeton({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: MS_SCOPE });
}

function sauvegarderJetons(cabinetId, { access_token, refresh_token, expires_in }) {
  const expireLe = new Date(Date.now() + (Number(expires_in) || 3600) * 1000).toISOString();
  bd.prepare(`
    INSERT INTO microsoft_tokens (cabinet_id, access_chiffre, refresh_chiffre, expire_le)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (cabinet_id) DO UPDATE SET
      access_chiffre = excluded.access_chiffre,
      refresh_chiffre = excluded.refresh_chiffre,
      expire_le = excluded.expire_le
  `).run(cabinetId, chiffrer(access_token), chiffrer(refresh_token), expireLe);
}

function supprimerJetons(cabinetId) {
  bd.prepare('DELETE FROM microsoft_tokens WHERE cabinet_id = ?').run(cabinetId);
}

// Retourne un access token valide (rafraîchit si expiré), ou null si non connecté.
async function jetonAccesValide(cabinetId) {
  const ligne = bd.prepare('SELECT * FROM microsoft_tokens WHERE cabinet_id = ?').get(cabinetId);
  if (!ligne) return null;
  try {
    const access = dechiffrer(ligne.access_chiffre);
    if (new Date(ligne.expire_le).getTime() > Date.now() + 60000) return access;
    const refresh = dechiffrer(ligne.refresh_chiffre);
    const json = await rafraichirJeton(refresh);
    sauvegarderJetons(cabinetId, json);
    return json.access_token;
  } catch (e) {
    console.error('Jeton Microsoft invalide :', e.message);
    return null;
  }
}

function statutConnexion(cabinetId) {
  const ligne = bd.prepare('SELECT expire_le, cree_le FROM microsoft_tokens WHERE cabinet_id = ?').get(cabinetId);
  if (!ligne) return { connecte: false };
  return { connecte: true, expire_le: ligne.expire_le, expire: new Date(ligne.expire_le).getTime() <= Date.now() };
}

// Crée une réunion en ligne Teams et retourne l'URL de participation.
// Lève une erreur explicite si Microsoft n'est pas connecté.
async function creerReunionTeams({ cabinetId, sujet, debut, fin }) {
  const access = await jetonAccesValide(cabinetId);
  if (!access) throw new Error('Microsoft 365 non connecté pour ce cabinet.');
  const res = await fetch(`${MS_GRAPH}/me/onlineMeetings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDateTime: new Date(debut).toISOString(),
      endDateTime: new Date(fin || new Date(new Date(debut).getTime() + 30 * 60000)).toISOString(),
      subject: sujet || 'Réunion',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.joinWebUrl) {
    throw new Error(`Échec de création de la réunion Teams : ${json.error?.message || res.status}`);
  }
  return json.joinWebUrl;
}

module.exports = {
  estConfigure,
  urlAutorisation,
  echangerCode,
  sauvegarderJetons,
  supprimerJetons,
  jetonAccesValide,
  statutConnexion,
  creerReunionTeams,
};
