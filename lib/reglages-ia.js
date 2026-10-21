/**
 * lib/reglages-ia.js — Réglages IA par cabinet (étape 4, module « Analyse
 * de documents IA ») : clé API Cohere et choix du moteur.
 *
 * Sécurité :
 *  - La clé est stockée CHIFFRÉE AES-256-GCM (lib/chiffrement.js, même
 *    mécanisme que les jetons Microsoft 365) — jamais en clair en base.
 *  - Elle n'apparaît JAMAIS en clair dans les journaux, les réponses HTTP
 *    ou les tests : seuls les 4 derniers caractères, masqués, sont montrés.
 *  - Source de la clé : réglage du cabinet d'abord, sinon la variable
 *    d'environnement COHERE_API_KEY (déploiement).
 *
 * Moteur effectif : 'local', 'cohere' ou 'augure' (IA canadienne,
 * lib/augure.js — la clé Augure vit dans la même table, gérée par ce
 * module-là, pattern Google Places).
 *  - choix 'local'  → toujours local ;
 *  - choix 'cohere' → Cohere si une clé est présente, sinon local (repli) ;
 *  - choix 'augure' → Augure si une clé est présente, sinon local (repli) ;
 *  - choix 'auto'   → Augure si sa clé est présente, sinon Cohere si sa
 *    clé l'est, sinon local ;
 *  - ASSISTANT_MOTEUR (tests/déploiement) reste prioritaire s'il est défini.
 */
const https = require('https');
const bd = require('./bd');
const { chiffrer, dechiffrer } = require('./chiffrement');
const { journal } = require('./middleware');

const MOTEURS = ['local', 'cohere', 'augure', 'auto'];

function ligneReglage(cabinetId) {
  return bd.prepare('SELECT * FROM reglages_ia WHERE cabinet_id = ?').get(cabinetId) || null;
}

function obtenirReglage(cabinetId) {
  const l = ligneReglage(cabinetId);
  const cleCabinet = !!(l && l.cle_cohere_chiffree);
  return {
    moteur: (l && l.moteur) || 'auto',
    cleCabinetPresente: cleCabinet,
    cleEnvPresente: !!process.env.COHERE_API_KEY,
    clePresente: cleCabinet || !!process.env.COHERE_API_KEY,
    masque: cleCabinet ? masqueCle(cabinetId) : null,
  };
}

function masqueCle(cabinetId) {
  try {
    const cle = cleCohereCabinet(cabinetId);
    if (!cle) return null;
    return '•••• •••• ' + cle.slice(-4);
  } catch (e) { return '•••• (illisible)'; }
}

function cleCohereCabinet(cabinetId) {
  const l = ligneReglage(cabinetId);
  if (!l || !l.cle_cohere_chiffree) return null;
  try { return dechiffrer(l.cle_cohere_chiffree); } catch (e) { return null; }
}

// Clé effective (jamais journalisée) : cabinet d'abord, sinon environnement.
function cleCohere(cabinetId) {
  return cleCohereCabinet(cabinetId) || process.env.COHERE_API_KEY || null;
}

function definirCle(cabinetId, userId, cleClair) {
  const cle = String(cleClair || '').trim();
  if (cle.length < 8) throw new Error('La clé semble trop courte (8 caractères minimum).');
  bd.prepare(`
    INSERT INTO reglages_ia (cabinet_id, cle_cohere_chiffree, moteur, maj_le)
    VALUES (?, ?, 'auto', datetime('now'))
    ON CONFLICT(cabinet_id) DO UPDATE SET cle_cohere_chiffree = excluded.cle_cohere_chiffree, maj_le = datetime('now')
  `).run(cabinetId, chiffrer(cle));
  // Journal SANS la clé : seulement le fait et le masque.
  journal(cabinetId, userId, 'analyse_reglage_cle', `Clé API Cohere enregistrée (masque : •••• ${cle.slice(-4)})`);
}

function effacerCle(cabinetId, userId) {
  bd.prepare(`
    INSERT INTO reglages_ia (cabinet_id, cle_cohere_chiffree, moteur, maj_le)
    VALUES (?, NULL, 'auto', datetime('now'))
    ON CONFLICT(cabinet_id) DO UPDATE SET cle_cohere_chiffree = NULL, maj_le = datetime('now')
  `).run(cabinetId);
  journal(cabinetId, userId, 'analyse_reglage_cle_effacee', 'Clé API Cohere retirée du réglage du cabinet');
}

function definirMoteur(cabinetId, userId, moteur) {
  if (!MOTEURS.includes(moteur)) throw new Error(`Moteur invalide : ${moteur}`);
  bd.prepare(`
    INSERT INTO reglages_ia (cabinet_id, moteur, maj_le)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(cabinet_id) DO UPDATE SET moteur = excluded.moteur, maj_le = datetime('now')
  `).run(cabinetId, moteur);
  journal(cabinetId, userId, 'analyse_reglage_moteur', `Moteur IA du cabinet réglé à « ${moteur} »`);
}

function moteurEffectif(cabinetId) {
  const reglage = obtenirReglage(cabinetId);
  // Clé Augure : gérée par lib/augure.js (require paresseux, pas de cycle).
  let augure = { clePresente: false, modele: null };
  try { augure = require('./augure').obtenirReglageAugure(cabinetId); } catch (e) { /* repli : pas d'Augure */ }
  let mode;
  const env = process.env.ASSISTANT_MOTEUR;
  if (env === 'local') {
    mode = 'local';
  } else if (env === 'cohere') {
    mode = reglage.clePresente ? 'cohere' : 'local';
  } else if (env === 'augure') {
    mode = augure.clePresente ? 'augure' : 'local';
  } else if (reglage.moteur === 'local') {
    mode = 'local';
  } else if (reglage.moteur === 'cohere') {
    mode = reglage.clePresente ? 'cohere' : 'local';
  } else if (reglage.moteur === 'augure') {
    mode = augure.clePresente ? 'augure' : 'local';
  } else {
    // auto : Augure d'abord (IA canadienne choisie par le cabinet),
    // sinon Cohere, sinon local.
    mode = augure.clePresente ? 'augure' : (reglage.clePresente ? 'cohere' : 'local');
  }
  return {
    mode, choix: reglage.moteur, clePresente: reglage.clePresente,
    cleCoherePresente: reglage.clePresente,
    cleAugurePresente: augure.clePresente, modeleAugure: augure.modele,
  };
}

// Appel Cohere minimal avec la clé du cabinet (réutilise lib/ia.js).
function appelerCohereCabinet(cabinetId, prompt) {
  const { appelerCohere } = require('./ia');
  const cle = cleCohere(cabinetId);
  if (!cle) return Promise.reject(new Error('Aucune clé API Cohere configurée'));
  return appelerCohere(prompt, cle);
}

// Test de connexion : appel minimal ; échoue proprement (jamais de crash,
// jamais la clé dans le message).
async function testerConnexion(cabinetId) {
  const cle = cleCohere(cabinetId);
  if (!cle) {
    return { ok: false, message: "Aucune clé API Cohere n'est configurée (ni dans ce réglage, ni dans l'environnement). Enregistrez une clé puis réessayez." };
  }
  const corps = JSON.stringify({
    model: process.env.COHERE_MODEL || 'command-a-03-2025',
    messages: [{ role: 'user', content: 'Réponds uniquement : OK' }],
    temperature: 0,
  });
  return new Promise((resolve) => {
    let termine = false;
    const finir = (r) => { if (!termine) { termine = true; clearTimeout(delaiDur); resolve(r); } };
    const req = https.request({
      hostname: 'api.cohere.ai', path: '/v2/chat', method: 'POST',
      headers: {
        'Authorization': `Bearer ${cle}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(corps),
      },
      timeout: 20000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          finir({ ok: true, message: 'Connexion à Cohere réussie : la clé est acceptée.' });
        } else if (res.statusCode === 401) {
          finir({ ok: false, message: 'Cohere a refusé la clé (401 Non autorisé). Vérifiez la clé saisie.' });
        } else {
          finir({ ok: false, message: `Cohere a répondu ${res.statusCode}. Réessayez plus tard ou vérifiez le modèle configuré.` });
        }
      });
    });
    // Délai dur : le « timeout » socket seul ne borne pas un TLS qui traîne.
    const delaiDur = setTimeout(() => {
      req.destroy();
      finir({ ok: false, message: 'Connexion à Cohere : délai dépassé (60 s) — le service est lent ou injoignable depuis le serveur.' });
    }, 60000);
    req.on('error', (e) => finir({ ok: false, message: `Connexion à Cohere impossible : ${e.message}` }));
    req.on('timeout', () => { req.destroy(); finir({ ok: false, message: 'Connexion à Cohere : délai dépassé (20 s).' }); });
    req.write(corps);
    req.end();
  });
}

module.exports = {
  MOTEURS, obtenirReglage, definirCle, effacerCle, definirMoteur,
  cleCohere, moteurEffectif, appelerCohereCabinet, testerConnexion,
};
