/**
 * test-augure-reglage.js — Étape 1 de l'intégration Augure (IA canadienne,
 * API compatible OpenAI) : client lib/augure.js, clé chiffrée par cabinet,
 * modèle choisi, page Admin « 🇨🇦 Clé Augure », moteur Local/Cohere/
 * Augure/Auto (Auto = Augure, sinon Cohere, sinon Local).
 *
 * AUCUN appel réel à Augure : un harnais HTTP local simule l'API
 * (GET /models, POST /chat/completions) sur le port 4399. Le serveur de
 * l'application doit être lancé avec AUGURE_BASE_URL pointant dessus :
 *
 *   (AUGURE_BASE_URL=http://127.0.0.1:4399/v1 PORT=3101 CHEMIN_BD=/tmp/test-augure-reglage.db nohup node server.js > /tmp/courtier-augure-reglage.log 2>&1 &)
 *   CHEMIN_BD=/tmp/test-augure-reglage.db node scripts/test-augure-reglage.js
 *
 * (environnement du serveur SANS AUGURE_API_KEY, COHERE_API_KEY ni
 * ASSISTANT_MOTEUR).
 */
process.env.AUGURE_BASE_URL = 'http://127.0.0.1:4399/v1';

const http = require('http');

const BASE = 'http://localhost:3101';
const CLE_VALIDE = 'cle-augure-test-valide-9876';
const CLE_INVALIDE = 'cle-augure-invalide-0000';
const CLE_SANS_FORMAT = 'cle-sans-format-1234';
const CLE_QUOTA = 'cle-augure-quota-5555';

// --- Harnais : API « Augure » simulée (format OpenAI) -------------------------
let appelsChat = 0;
const harnais = http.createServer((req, res) => {
  let corps = '';
  req.on('data', (m) => { corps += m; });
  req.on('end', () => {
    const auth = req.headers.authorization || '';
    const json = (code, objet) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(objet));
    };
    if (req.url === '/v1/models' && req.method === 'GET') {
      if (auth !== `Bearer ${CLE_VALIDE}`) return json(401, { error: { message: 'invalid api key' } });
      return json(200, { object: 'list', data: [{ id: 'ossington-5' }, { id: 'tofino-3' }] });
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      appelsChat++;
      let demande = {};
      try { demande = JSON.parse(corps || '{}'); } catch (e) { /* ignore */ }
      if (auth === `Bearer ${CLE_INVALIDE}`) return json(401, { error: { message: 'invalid api key' } });
      if (auth === `Bearer ${CLE_QUOTA}`) return json(429, { error: { message: 'rate limit' } });
      if (auth === `Bearer ${CLE_SANS_FORMAT}`) {
        if (demande.response_format) return json(400, { error: { message: 'response_format non supporté' } });
        return json(200, { choices: [{ message: { role: 'assistant', content: 'sans format OK' } }] });
      }
      if (auth !== `Bearer ${CLE_VALIDE}`) return json(401, { error: { message: 'invalid api key' } });
      return json(200, { choices: [{ message: { role: 'assistant', content: '{"reponse":"pong"}' } }] });
    }
    return json(404, { error: { message: 'introuvable' } });
  });
});

let reussis = 0, echoues = 0;
function test(nom, cond) {
  if (cond) { reussis++; console.log('  ✓', nom); }
  else { echoues++; console.log('  ✗ ÉCHEC :', nom); }
}

function demander(methode, chemin, { corps = null, cookies = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(chemin, BASE);
    const data = corps ? new URLSearchParams(corps).toString() : null;
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: methode,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
      },
    }, (res) => {
      let html = '';
      res.on('data', (m) => { html += m; });
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'] || [];
        for (const c of setCookie) {
          const [paire] = c.split(';');
          const i = paire.indexOf('=');
          cookies[paire.slice(0, i).trim()] = paire.slice(i + 1).trim();
        }
        resolve({ statut: res.statusCode, html, cookies, location: res.headers.location });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function extraireCsrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

(async () => {
  await new Promise((r) => harnais.listen(4399, '127.0.0.1', r));
  console.log('Harnais Augure simulé sur le port 4399 (aucun appel réel).');

  const bd = require('../lib/bd');
  const augure = require('../lib/augure');
  const reglagesIA = require('../lib/reglages-ia');
  const cabinetId = bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get().id;

  // ==========================================================================
  console.log('\n— Client lib/augure.js (appels directs au harnais) —');
  {
    let err = null;
    try { await augure.appelerAugure({ cle: null, prompt: 'allo' }); } catch (e) { err = e; }
    test('sans clé : erreur non_configure', !!err && err.code === 'non_configure');
  }
  {
    const rep = await augure.appelerAugure({ cle: CLE_VALIDE, modele: 'ossington-5', prompt: 'ping', jsonMode: true });
    test('appel chat valide (mode JSON) : contenu retourné', rep === '{"reponse":"pong"}');
  }
  {
    let err = null;
    try { await augure.appelerAugure({ cle: CLE_INVALIDE, prompt: 'ping' }); } catch (e) { err = e; }
    test('clé refusée (401) : message propre', !!err && err.statutHttp === 401 && /refusé la clé/.test(err.message));
  }
  {
    let err = null;
    try { await augure.appelerAugure({ cle: CLE_QUOTA, prompt: 'ping' }); } catch (e) { err = e; }
    test('quota (429) : message propre', !!err && err.statutHttp === 429 && /[Qq]uota/.test(err.message));
  }
  {
    const rep = await augure.appelerAugure({ cle: CLE_SANS_FORMAT, prompt: 'ping', jsonMode: true });
    test('response_format refusé (400) : réessai sans format réussi', rep === 'sans format OK');
    let err = null;
    try { await augure.appelerAugure({ cle: CLE_SANS_FORMAT, prompt: 'ping', jsonMode: true, reessayerSansFormat: false }); } catch (e) { err = e; }
    test('réessai interdit : erreur 400 propagée', !!err && err.statutHttp === 400);
  }
  {
    const t1 = await augure.testerConnexionAugure(cabinetId);
    test('testerConnexion sans clé : non_configure', t1.ok === false && t1.statut === 'non_configure');
  }

  // ==========================================================================
  console.log('\n— Connexion admin (démarrage) —');
  const jarAdmin = {};
  let r = await demander('GET', '/connexion', { cookies: jarAdmin });
  let csrf = extraireCsrf(r.html);
  r = await demander('POST', '/connexion', { cookies: jarAdmin, corps: { _csrf: csrf, email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  test('login admin : redirigé', r.statut === 302);
  r = await demander('GET', '/mot-de-passe', { cookies: jarAdmin });
  csrf = extraireCsrf(r.html);
  r = await demander('POST', '/mot-de-passe', { cookies: jarAdmin, corps: { _csrf: csrf, actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement de mot de passe forcé : OK', r.statut === 302);

  const bcrypt = require('bcrypt');
  const hashCourtier = bcrypt.hashSync('CourtierTest789!', 4);
  bd.prepare(`
    INSERT INTO users (cabinet_id, email, mot_de_passe_hash, nom, role, doit_changer_mot_de_passe)
    VALUES (?, 'courtier-augure@demo.ca', ?, 'Courtier Augure', 'courtier', 0)
    ON CONFLICT(email) DO UPDATE SET mot_de_passe_hash = excluded.mot_de_passe_hash
  `).run(cabinetId, hashCourtier);

  // ==========================================================================
  console.log('\n— Page Admin : section Augure, clé chiffrée et masquée —');
  r = await demander('GET', '/admin/cohere', { cookies: jarAdmin });
  test('page Admin : section « Clé Augure (IA canadienne) » présente', r.html.includes('Clé Augure (IA canadienne)'));
  test('page Admin : les 6 modèles offerts (ossington-5, rosedale-1, tofino-3…)',
    r.html.includes('ossington-5') && r.html.includes('rosedale-1') && r.html.includes('tofino-3') && r.html.includes('open-glm-5-3'));
  test('sélecteur moteur : option Augure + Auto « Augure si sa clé est présente »',
    r.html.includes('value="augure"') && r.html.includes('Auto — Augure si sa clé est présente'));
  csrf = extraireCsrf(r.html);

  r = await demander('POST', '/admin/cohere/augure/cle', { cookies: jarAdmin, corps: { _csrf: csrf, cle: CLE_VALIDE } });
  test('enregistrement de la clé : page confirme', r.statut === 200 && r.html.includes('Clé API Augure enregistrée'));
  const ligne = bd.prepare('SELECT * FROM reglages_ia WHERE cabinet_id = ?').get(cabinetId);
  test('clé chiffrée au repos (iv:tag:données), jamais en clair',
    !!ligne.cle_augure_chiffree && ligne.cle_augure_chiffree.split(':').length === 3 && !ligne.cle_augure_chiffree.includes('9876'));
  test('clé déchiffrée par le module = clé saisie', augure.cleAugure(cabinetId) === CLE_VALIDE);
  test('affichage masqué (•••• 9876), clé complète absente de la page',
    r.html.includes('•••• 9876') && !r.html.includes(CLE_VALIDE));
  const journalCle = bd.prepare("SELECT * FROM journal_audit WHERE action = 'augure_cle_enregistree'").all();
  test('journal : enregistrement consigné SANS la clé en clair',
    journalCle.length >= 1 && journalCle.every((j) => !(j.details || '').includes(CLE_VALIDE)));

  r = await demander('POST', '/admin/cohere/augure/tester', { cookies: jarAdmin, corps: { _csrf: csrf } });
  test('test de connexion (harnais) : succès affiché', r.html.includes('Connexion à Augure réussie'));

  r = await demander('POST', '/admin/cohere/augure/cle', { cookies: jarAdmin, corps: { _csrf: csrf, cle: CLE_INVALIDE } });
  r = await demander('POST', '/admin/cohere/augure/tester', { cookies: jarAdmin, corps: { _csrf: csrf } });
  test('test de connexion avec clé invalide : refus signalé', r.html.includes('refusé la clé'));
  r = await demander('POST', '/admin/cohere/augure/cle', { cookies: jarAdmin, corps: { _csrf: csrf, cle: CLE_VALIDE } });

  console.log('\n— Modèle Augure choisi —');
  r = await demander('POST', '/admin/cohere/augure/modele', { cookies: jarAdmin, corps: { _csrf: csrf, modele: 'rosedale-1' } });
  test('modèle rosedale-1 : confirmation', r.statut === 200 && r.html.includes('Modèle Augure mis à jour'));
  test('modèle persisté en base + lu par le module',
    bd.prepare('SELECT modele_augure FROM reglages_ia WHERE cabinet_id = ?').get(cabinetId).modele_augure === 'rosedale-1'
    && augure.modeleAugure(cabinetId) === 'rosedale-1');
  r = await demander('POST', '/admin/cohere/augure/modele', { cookies: jarAdmin, corps: { _csrf: csrf, modele: 'modele-invente' } });
  test('modèle inconnu : refusé, choix inchangé',
    r.html.includes('Modèle Augure inconnu') && augure.modeleAugure(cabinetId) === 'rosedale-1');
  r = await demander('POST', '/admin/cohere/augure/modele', { cookies: jarAdmin, corps: { _csrf: csrf, modele: 'ossington-5' } });
  test('retour au modèle par défaut ossington-5', augure.modeleAugure(cabinetId) === 'ossington-5');

  // ==========================================================================
  console.log('\n— moteurEffectif : Local / Cohere / Augure / Auto —');
  const poserMoteur = (m) => reglagesIA.definirMoteur(cabinetId, 1, m);
  poserMoteur('local');
  test('choix local + clé Augure présente → local', reglagesIA.moteurEffectif(cabinetId).mode === 'local');
  poserMoteur('augure');
  test('choix augure + clé présente → augure', reglagesIA.moteurEffectif(cabinetId).mode === 'augure');
  poserMoteur('auto');
  test('auto + clé Augure présente → augure (priorité canadienne)', reglagesIA.moteurEffectif(cabinetId).mode === 'augure');
  augure.effacerCleAugure(cabinetId, 1);
  test('choix augure sans clé → repli local', reglagesIA.moteurEffectif(cabinetId).mode === 'local');
  reglagesIA.definirCle(cabinetId, 1, 'cle-cohere-factice-1234');
  poserMoteur('auto');
  test('auto sans clé Augure + clé Cohere → cohere', reglagesIA.moteurEffectif(cabinetId).mode === 'cohere');
  poserMoteur('augure');
  test('choix augure sans sa clé (Cohere présent) → local', reglagesIA.moteurEffectif(cabinetId).mode === 'local');
  reglagesIA.effacerCle(cabinetId, 1);
  poserMoteur('auto');
  test('auto sans aucune clé → local', reglagesIA.moteurEffectif(cabinetId).mode === 'local');
  poserMoteur('cohere');
  test('choix cohere sans clé → local', reglagesIA.moteurEffectif(cabinetId).mode === 'local');

  // ==========================================================================
  console.log('\n— Retrait de la clé + accès réservé à l\u2019admin —');
  r = await demander('POST', '/admin/cohere/augure/cle', { cookies: jarAdmin, corps: { _csrf: csrf, cle: CLE_VALIDE } });
  r = await demander('POST', '/admin/cohere/augure/effacer', { cookies: jarAdmin, corps: { _csrf: csrf } });
  test('retrait de la clé : confirmation + base nettoyée',
    r.html.includes('Clé Augure du cabinet retirée')
    && bd.prepare('SELECT cle_augure_chiffree FROM reglages_ia WHERE cabinet_id = ?').get(cabinetId).cle_augure_chiffree === null);

  const jarCourtier = {};
  r = await demander('GET', '/connexion', { cookies: jarCourtier });
  const csrfC = extraireCsrf(r.html);
  r = await demander('POST', '/connexion', { cookies: jarCourtier, corps: { _csrf: csrfC, email: 'courtier-augure@demo.ca', mot_de_passe: 'CourtierTest789!' } });
  test('login courtier : redirigé', r.statut === 302);
  r = await demander('GET', '/admin/cohere', { cookies: jarCourtier });
  test('courtier non-admin : page refusée (403)', r.statut === 403);
  r = await demander('POST', '/admin/cohere/augure/cle', { cookies: jarCourtier, corps: { cle: CLE_VALIDE } });
  test('courtier non-admin : enregistrement de la clé refusé (403) et rien en base',
    r.statut === 403
    && bd.prepare('SELECT cle_augure_chiffree FROM reglages_ia WHERE cabinet_id = ?').get(cabinetId).cle_augure_chiffree === null);

  harnais.close();
  console.log(`\n=== test-augure-reglage : ${reussis} réussis, ${echoues} échoués ===`);
  process.exit(echoues ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
