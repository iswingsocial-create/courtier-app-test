/**
 * test-augure-moteur.js — Étape 2 de l'intégration Augure : le moteur
 * canadien branché aux trois points d'appel (analyse de documents,
 * commandes de l'assistant, brouillons IA), avec repli local signalé.
 * Étape 3 incluse : mention « Propulsé par Augure » dans le pied de page,
 * uniquement quand le moteur effectif est Augure.
 *
 * AUCUN appel réel à Augure : harnais HTTP local (port 4499) au format
 * OpenAI. Le serveur doit être lancé avec AUGURE_BASE_URL pointant
 * dessus et la MÊME base que le script :
 *
 *   (AUGURE_BASE_URL=http://127.0.0.1:4499/v1 PORT=3101 CHEMIN_BD=/tmp/test-augure-moteur.db nohup node server.js > /tmp/courtier-augure-moteur.log 2>&1 &)
 *   CHEMIN_BD=/tmp/test-augure-moteur.db node scripts/test-augure-moteur.js
 *
 * (environnement SANS AUGURE_API_KEY, COHERE_API_KEY ni ASSISTANT_MOTEUR).
 */
process.env.AUGURE_BASE_URL = 'http://127.0.0.1:4499/v1';

const http = require('http');

const BASE = 'http://localhost:3101';
const CLE_VALIDE = 'cle-augure-test-valide-9876';

const TEXTE_FLOTTE = [
  'Assurance flotte automobile — Police',
  'Assuré : Transport Lapointe inc.',
  'Assureur : Intact Assurance',
  'N° de police : FLT-2026-90001',
  "Date d'effet : 2026-12-01",
  "Date d'échéance : 2027-12-01",
  'Flotte de 4 véhicules',
  "Rayon d'opération : 160 km",
  'Limite : 2 000 000 $',
  'Prime : 21 500 $',
  '',
  'ANNEXE A — LISTE DES VÉHICULES ASSURÉS',
  'Véhicule 1 : 2022 Ford Transit 250',
  'NIV : 1FTBW3CM5KKB12345',
  'Valeur : 62 000 $',
  'Usage : Livraison',
  '',
  'Véhicule 2 : 2021 Ram ProMaster 3500',
  'NIV : 3C6TRVBG8ME512340',
  'Valeur : 54 000 $',
  'Usage : Livraison',
].join('\n');

const REPONSE_ANALYSE = JSON.stringify({
  produit: 'flotte',
  champs: [
    { champ: 'entete.assureur', valeur: 'Intact Assurance', confiance: 'haute' },
    { champ: 'entete.numero_police', valeur: 'FLT-2026-90001', confiance: 'haute' },
    { champ: 'entete.nb_vehicules', valeur: 4, confiance: 'haute' },
    { champ: 'champ.invente', valeur: 'bidon', confiance: 'haute' },
  ],
  listes: {
    vehicules: [
      { champs: { niv: '1FTBW3CM5KKB12345', annee: 2022, marque: 'Ford', modele: 'Transit 250', valeur: 62000 }, confiance: 'haute' },
      { champs: { niv: '3C6TRVBG8ME512340', annee: 2021, marque: 'Ram', modele: 'ProMaster 3500', valeur: 54000 }, confiance: 'haute' },
    ],
  },
});

// --- Harnais : API « Augure » simulée, réponses selon le type de prompt -----
let appelsChat = 0;
const harnais = http.createServer((req, res) => {
  let corps = '';
  req.on('data', (m) => { corps += m; });
  req.on('end', () => {
    const json = (code, objet) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(objet));
    };
    if (req.url === '/v1/models' && req.method === 'GET') {
      return json(200, { object: 'list', data: [{ id: 'ossington-5' }] });
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      appelsChat++;
      let demande = {};
      try { demande = JSON.parse(corps || '{}'); } catch (e) { /* ignore */ }
      const prompt = ((demande.messages || []).map((m) => m.content || '').join('\n'));
      let contenu;
      if (prompt.includes('TEXTE DU DOCUMENT')) {
        contenu = prompt.includes('MODE-INVALIDE')
          ? 'Voici mon analyse en prose, sans aucun JSON structuré.'
          : REPONSE_ANALYSE;
      } else if (prompt.includes('interpréteur de commandes')) {
        // La demande de l'utilisateur est citée à la fin du prompt ; le mot
        // « camion » apparaît aussi dans la spec des commandes, on ne le
        // cherche donc que dans la demande extraite.
        const md = prompt.match(/Demande de l'utilisateur : """([\s\S]*?)"""/);
        const demandeUtilisateur = md ? md[1] : '';
        if (prompt.includes('ajouter_vehicule_flotte')) {
          contenu = demandeUtilisateur.includes('camion')
            ? '{"action":"ajouter_vehicule_flotte","params":{"soumission_client":"Garage Saint-Michel inc.","annee":2023,"marque":"Ford","modele":"F-150"}}'
            : '{"action":"inconnue","params":{}}';
        } else {
          contenu = '{"action":"ajouter_contact","params":{"entreprise":"Garage Saint-Michel inc.","prenom":"Sophie","nom":"Marchand","courriel":"sophie@garage.example"}}';
        }
      } else if (prompt.includes('Rédige un courriel')) {
        contenu = 'Sujet : Renouvellement rédigé par Augure\n\nBonjour,\n\nVoici le brouillon généré par le harnais Augure.\n\nAu plaisir,';
      } else {
        contenu = '{"reponse":"pong"}';
      }
      return json(200, { choices: [{ message: { role: 'assistant', content: contenu } }] });
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
  await new Promise((r) => harnais.listen(4499, '127.0.0.1', r));
  console.log('Harnais Augure simulé sur le port 4499 (aucun appel réel).');

  const bd = require('../lib/bd');
  const augure = require('../lib/augure');
  const reglagesIA = require('../lib/reglages-ia');
  const analyseDoc = require('../lib/analyse-document');
  const commandesIA = require('../lib/commandes-ia');
  const assistant = require('../lib/assistant');
  const ia = require('../lib/ia');

  const cabinetId = bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get().id;
  const adminId = bd.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;

  // ==========================================================================
  console.log('\n— Configuration : moteur Augure pour le cabinet —');
  augure.definirCleAugure(cabinetId, adminId, CLE_VALIDE);
  reglagesIA.definirMoteur(cabinetId, adminId, 'augure');
  test('moteurEffectif = augure', reglagesIA.moteurEffectif(cabinetId).mode === 'augure');
  test('aucun appel au harnais pendant la configuration', appelsChat === 0);

  // ==========================================================================
  console.log('\n— (a) Analyse de documents via Augure —');
  const r1 = await analyseDoc.analyser(TEXTE_FLOTTE, { cabinetId });
  test('analyse : moteur = augure', r1.moteur === 'augure');
  test('analyse : produit flotte détecté', r1.produit === 'flotte');
  const champAssureur = (r1.champs || []).find((c) => c.champ === 'entete.assureur');
  test('analyse : champ assureur proposé par Augure', !!champAssureur && champAssureur.valeur === 'Intact Assurance');
  test('analyse : champ inconnu du dictionnaire rejeté',
    !(r1.champs || []).some((c) => c.champ === 'champ.invente'));
  test('analyse : liste des véhicules proposée (2 véhicules, NIV du stub)',
    Array.isArray(r1.listes && r1.listes.vehicules) && r1.listes.vehicules.length === 2
    && r1.listes.vehicules[0].champs.niv === '1FTBW3CM5KKB12345');

  const r2 = await analyseDoc.analyser(TEXTE_FLOTTE + '\nMODE-INVALIDE', { cabinetId });
  test('réponse non-JSON : repli sur le moteur local', r2.moteur === 'local');
  test('repli signalé dans le message (Augure indisponible)',
    !!r2.message && r2.message.includes('Repli sur le moteur local') && r2.message.includes('Augure indisponible'));
  test('repli local : le produit flotte reste détecté par les règles', r2.produit === 'flotte');

  // ==========================================================================
  console.log('\n— (b) Commandes de l\u2019assistant via Augure —');
  const cmd = await commandesIA.interpreterAugure(
    'Ajoute un camion Ford F-150 2023 à la flotte de Garage Saint-Michel', CLE_VALIDE, 'ossington-5');
  test('commande interprétée : action ajouter_vehicule_flotte',
    !!cmd && cmd.action === 'ajouter_vehicule_flotte');
  test('commande interprétée : paramètres (Ford, 2023)',
    !!cmd && cmd.params.marque === 'Ford' && cmd.params.annee === 2023);

  const avantContacts = bd.prepare("SELECT COUNT(*) AS n FROM contacts WHERE cabinet_id = ? AND prenom = 'Sophie' AND nom = 'Marchand'").get(cabinetId).n;
  const rep = await assistant.traiter(cabinetId, adminId,
    'Peux-tu inscrire Sophie Marchand comme nouvelle personne-ressource chez Garage Saint-Michel inc. ?');
  const apresContacts = bd.prepare("SELECT COUNT(*) AS n FROM contacts WHERE cabinet_id = ? AND prenom = 'Sophie' AND nom = 'Marchand'").get(cabinetId).n;
  test('assistant bout en bout : le contact est créé via Augure', apresContacts === avantContacts + 1);
  test('assistant bout en bout : réponse de confirmation',
    typeof rep.reponse === 'string' && rep.reponse.includes('Sophie Marchand'));

  // ==========================================================================
  console.log('\n— (c) Brouillons IA via Augure —');
  const brouillon = await ia.genererBrouillonRenouvellement({
    client: { prenom: 'Marie', nom: 'Lapointe', raison_sociale: 'Transport Lapointe inc.', titre_contact: 'Présidente' },
    police: { ligne: 'flotte', numero_police: 'FLT-2026-90001', assureur: 'Intact Assurance', date_echeance: '2027-12-01', franchise: 1000 },
    protections: [{ libelle: 'Responsabilité civile 2 M$', prime: 12000 }],
    primeTotale: 21500, manquantes: [], joursRestants: 45,
    nomCourtier: 'Patrick', cabinetId,
  });
  test('brouillon : source = augure', brouillon.source === 'augure');
  test('brouillon : sujet repris de la réponse Augure', brouillon.sujet === 'Renouvellement rédigé par Augure');
  test('brouillon : contenu du harnais', brouillon.contenu.includes('harnais Augure'));

  // ==========================================================================
  console.log('\n— Moteur Local : aucun appel au harnais —');
  reglagesIA.definirMoteur(cabinetId, adminId, 'local');
  const appelsAvant = appelsChat;
  const r3 = await analyseDoc.analyser(TEXTE_FLOTTE, { cabinetId });
  test('moteur local : analyse par les règles', r3.moteur === 'local' && r3.produit === 'flotte');
  const brouillonLocal = await ia.genererBrouillonRenouvellement({
    client: { prenom: 'Marie', nom: 'Lapointe', raison_sociale: 'Transport Lapointe inc.' },
    police: { ligne: 'flotte', numero_police: 'FLT-2026-90001', assureur: 'Intact Assurance', date_echeance: '2027-12-01', franchise: 1000 },
    protections: [{ libelle: 'Responsabilité civile 2 M$', prime: 12000 }],
    primeTotale: 21500, manquantes: [], joursRestants: 45,
    nomCourtier: 'Patrick', cabinetId,
  });
  test('moteur local : brouillon par le modèle de texte', brouillonLocal.source === 'modele');
  test('moteur local : compteur d\u2019appels du harnais inchangé', appelsChat === appelsAvant);

  // ==========================================================================
  console.log('\n— Étape 3 : mention « Propulsé par Augure » (pied de page) —');
  reglagesIA.definirMoteur(cabinetId, adminId, 'augure');
  const jar = {};
  let r = await demander('GET', '/connexion', { cookies: jar });
  let csrf = extraireCsrf(r.html);
  r = await demander('POST', '/connexion', { cookies: jar, corps: { _csrf: csrf, email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  test('login admin : redirigé', r.statut === 302);
  r = await demander('GET', '/mot-de-passe', { cookies: jar });
  csrf = extraireCsrf(r.html);
  r = await demander('POST', '/mot-de-passe', { cookies: jar, corps: { _csrf: csrf, actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement de mot de passe forcé : OK', r.statut === 302);
  r = await demander('GET', '/echeances', { cookies: jar });
  test('moteur Augure : mention présente dans le pied de page', r.html.includes('Propulsé par Augure'));
  reglagesIA.definirMoteur(cabinetId, adminId, 'local');
  r = await demander('GET', '/echeances', { cookies: jar });
  test('moteur Local : mention absente', !r.html.includes('Propulsé par Augure'));
  reglagesIA.definirMoteur(cabinetId, adminId, 'augure');

  harnais.close();
  console.log(`\n=== test-augure-moteur : ${reussis} réussis, ${echoues} échoués ===`);
  process.exit(echoues ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
