/**
 * scripts/captures-augure.js — Captures 130-131 : intégration Augure.
 * 130 : section « 🇨🇦 Clé Augure (IA canadienne) » dans Admin → Clé IA
 * (clé enregistrée masquée, liste des 6 modèles, moteur effectif Augure).
 * 131 : analyse d'une police flotte réussie par le moteur Augure
 * (fiche de révision indiquant « Moteur : augure »).
 *
 * AUCUN appel réel à Augure : harnais local (port 4499) au format OpenAI,
 * démarré par ce script. Le serveur doit être lancé avec
 * AUGURE_BASE_URL=http://127.0.0.1:4499/v1 et la même base :
 *   (AUGURE_BASE_URL=http://127.0.0.1:4499/v1 PORT=3101 CHEMIN_BD=/tmp/capture-augure.db nohup node server.js &)
 *   CHEMIN_BD=/tmp/capture-augure.db node scripts/captures-augure.js
 */
process.env.AUGURE_BASE_URL = 'http://127.0.0.1:4499/v1';

const http = require('http');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const { chromium } = require('/home/hatch/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const BASE = 'http://localhost:3101';
const OUT = path.join(__dirname, '..', 'demo-captures', 'commercial');
const DB = process.env.CHEMIN_BD || '/tmp/capture-augure.db';
const MDP = 'Capture2026!';
const CLE_CAPTURE = 'cle-augure-capture-2026';

const REPONSE_ANALYSE = JSON.stringify({
  produit: 'flotte',
  champs: [
    { champ: 'entete.assureur', valeur: 'Intact Assurance', confiance: 'haute' },
    { champ: 'entete.numero_police', valeur: 'FLT-2026-90001', confiance: 'haute' },
    { champ: 'entete.nb_vehicules', valeur: 4, confiance: 'haute' },
  ],
  listes: {
    vehicules: [
      { champs: { niv: '1FTBW3CM5KKB12345', annee: 2022, marque: 'Ford', modele: 'Transit 250', valeur: 62000 }, confiance: 'haute' },
      { champs: { niv: '3C6TRVBG8ME512340', annee: 2021, marque: 'Ram', modele: 'ProMaster 3500', valeur: 54000 }, confiance: 'haute' },
    ],
  },
});

const harnais = http.createServer((req, res) => {
  let corps = '';
  req.on('data', (m) => { corps += m; });
  req.on('end', () => {
    const json = (code, objet) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(objet));
    };
    if (req.url === '/v1/models') return json(200, { object: 'list', data: [{ id: 'ossington-5' }] });
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let demande = {};
      try { demande = JSON.parse(corps || '{}'); } catch (e) { /* ignore */ }
      const prompt = ((demande.messages || []).map((m) => m.content || '').join('\n'));
      const contenu = prompt.includes('TEXTE DU DOCUMENT') ? REPONSE_ANALYSE : '{"reponse":"pong"}';
      return json(200, { choices: [{ message: { role: 'assistant', content: contenu } }] });
    }
    return json(404, { error: { message: 'introuvable' } });
  });
});

const LIGNES_FLOTTE = [
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
  '',
  'Véhicule 2 : 2021 Ram ProMaster 3500',
  'NIV : 3C6TRVBG8ME512340',
  'Valeur : 54 000 $',
];

(async () => {
  await new Promise((r) => harnais.listen(4499, '127.0.0.1', r));
  console.log('Harnais Augure simulé sur le port 4499 (aucun appel réel).');

  // --- Préparation : mot de passe de capture + réglage Augure du cabinet ---
  const bd = new Database(DB);
  bd.prepare('UPDATE users SET mot_de_passe_hash = ?, doit_changer_mot_de_passe = 0 WHERE email = ?')
    .run(bcrypt.hashSync(MDP, 12), 'admin@demo.ca');
  const cab = bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get().id;
  const admin = bd.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  bd.close();
  const augure = require('../lib/augure');
  const reglagesIA = require('../lib/reglages-ia');
  augure.definirCleAugure(cab, admin, CLE_CAPTURE);
  reglagesIA.definirMoteur(cab, admin, 'augure');
  console.log('Réglage Augure posé (clé chiffrée, moteur = augure).');

  // --- PDF de police flotte (texte natif, comme les suites d'analyse) -----
  const PDFDocument = require('pdfkit');
  const pdfPath = '/tmp/police-flotte-capture.pdf';
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const flux = fs.createWriteStream(pdfPath);
    doc.pipe(flux);
    for (const l of LIGNES_FLOTTE) doc.text(l);
    doc.end();
    flux.on('finish', resolve);
    flux.on('error', reject);
  });
  console.log('PDF de démonstration :', pdfPath);

  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto(BASE + '/connexion');
  await page.fill('form input[name="email"]', 'admin@demo.ca');
  await page.fill('form input[name="mot_de_passe"]', MDP);
  await page.click('form button[type="submit"]');
  await page.waitForLoadState('networkidle');
  console.log('login ->', page.url());

  // --- 130 : section Augure dans Admin --------------------------------------
  // Cadrage serré sur la section complète (État, clé, modèle, test) :
  // clip en coordonnées document à partir du titre de la section.
  await page.goto(BASE + '/admin/cohere');
  await page.waitForLoadState('networkidle');
  const titre = page.locator('h2', { hasText: 'Clé Augure' }).first();
  await titre.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const boite = await titre.boundingBox();
  const defilement = await page.evaluate(() => window.scrollY);
  await page.screenshot({
    path: path.join(OUT, '130-admin-augure.png'),
    fullPage: true,
    clip: { x: Math.max(0, boite.x - 24), y: boite.y + defilement - 8, width: 1090, height: 1420 },
  });
  console.log('130 OK (Admin, section Augure)');

  // --- 131 : analyse flotte par le moteur Augure -----------------------------
  await page.goto(BASE + '/analyses');
  await page.waitForLoadState('networkidle');
  await page.setInputFiles('#fichier-analyse', pdfPath);
  await page.click('#form-analyse button[type="submit"]');
  await page.waitForURL(/\/analyses\/\d+/, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  const corps = await page.textContent('body');
  console.log('fiche analyse : moteur augure visible =', /Moteur\s*:\s*augure/.test(corps || ''));
  // Menus de l'entête refermés : le panneau de la section courante ne doit
  // pas masquer la ligne « Moteur : augure » de la fiche.
  await page.mouse.move(8, 400);
  await page.evaluate(() => {
    document.querySelectorAll('header details').forEach((d) => d.removeAttribute('open'));
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '131-analyse-augure.png') });
  console.log('131 OK (analyse via Augure) ->', page.url());

  await browser.close();
  harnais.close();
  process.exit(0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
