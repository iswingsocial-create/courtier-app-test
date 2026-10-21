/**
 * scripts/captures-menu.js — Captures 127 à 129 : menu principal
 * réorganisé par sections métier. 127 : mobile 390 px, menu fermé
 * (Échéances + les 7 boutons de section). 128 : mobile, section
 * Soumissions dépliée (les 9 produits). 129 : largeur bureau, section
 * Soumissions dépliée en surimpression. Usage : serveur sur 3101,
 * CHEMIN_BD=/tmp/capture-menu.db (base fraîche, seedée au démarrage).
 */
const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const { chromium } = require('/home/hatch/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const BASE = 'http://localhost:3101';
const OUT = path.join(__dirname, '..', 'demo-captures', 'commercial');
const DB = process.env.CHEMIN_BD || '/tmp/capture-menu.db';
const MDP = 'Capture2026!';

(async () => {
  const bd = new Database(DB);
  bd.prepare('UPDATE users SET mot_de_passe_hash = ?, doit_changer_mot_de_passe = 0 WHERE email = ?')
    .run(bcrypt.hashSync(MDP, 12), 'admin@demo.ca');
  bd.close();

  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    args: ['--no-sandbox'],
  });

  // --- Mobile 390 px ---------------------------------------------------------
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/connexion');
  await page.fill('form input[name="email"]', 'admin@demo.ca');
  await page.fill('form input[name="mot_de_passe"]', MDP);
  await page.click('form button[type="submit"]');
  await page.waitForLoadState('networkidle');
  console.log('login ->', page.url());

  await page.goto(BASE + '/echeances');
  await page.waitForLoadState('networkidle');
  let header = await page.$('header.barre-haut');
  await header.screenshot({ path: path.join(OUT, '127-menu-sections.png') });
  console.log('127 OK (mobile, menu fermé)');

  await page.click('details[data-section="soumissions"] > summary');
  await page.waitForTimeout(300);
  header = await page.$('header.barre-haut');
  await header.screenshot({ path: path.join(OUT, '128-menu-soumissions.png') });
  console.log('128 OK (mobile, Soumissions dépliée)');
  await page.close();

  // --- Bureau ----------------------------------------------------------------
  const bureau = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await bureau.goto(BASE + '/connexion');
  await bureau.fill('form input[name="email"]', 'admin@demo.ca');
  await bureau.fill('form input[name="mot_de_passe"]', MDP);
  await bureau.click('form button[type="submit"]');
  await bureau.waitForLoadState('networkidle');
  await bureau.goto(BASE + '/echeances');
  await bureau.waitForLoadState('networkidle');
  await bureau.click('details[data-section="soumissions"] > summary');
  await bureau.waitForTimeout(300);
  // Capture du viewport (pas de l'élément) : le panneau déplié est en
  // surimpression absolue sous la barre, il déborde de l'en-tête.
  await bureau.screenshot({ path: path.join(OUT, '129-menu-large.png') });
  console.log('129 OK (bureau, Soumissions dépliée)');

  await browser.close();
})().catch((e) => { console.error('❌', e); process.exit(1); });
