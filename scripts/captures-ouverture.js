/**
 * scripts/captures-ouverture.js — Captures 120-122 (ouverture vocale).
 * Prépare une base de capture : mot de passe admin connu + clé Google de
 * test (harnais local, port 4199), puis conduit le VRAI parcours dans le
 * navigateur : dictée (texte) → révision avec candidat Google Maps et
 * bâtiment dicté → création → fiche de la soumission avec ses manques.
 * Prérequis : harnais Places sur 4199 (scripts/harnais-places.js) et
 * serveur sur 3101 lancé avec CHEMIN_BD=/tmp/capture-ouv.db (base fraîche)
 * et PLACES_BASE_URL=http://127.0.0.1:4199/v1.
 */
const path = require('path');
const bcrypt = require('bcrypt');
const { chromium } = require('/home/hatch/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/capture-ouv.db';
const bd = require('../lib/bd');
const placesGoogle = require('../lib/places-google');

const BASE = 'http://localhost:3101';
const OUT = path.join(__dirname, '..', 'demo-captures', 'commercial');
const MDP = 'Capture2026!';
const TEXTE_BIENS = 'Nouveau dossier : Plomberie Saint-Laurent inc., contact Mario Tremblay, '
  + 'téléphone 514 555-0142, courriel mario@plomberie-sl.ca, situé au 450 rue des Érables, Montréal. '
  + 'Commence une soumission biens. '
  + 'Bâtiment : construction béton, année 1998, superficie 12 000 pieds carrés, gicleurs oui, valeur 1 500 000 dollars.';

(async () => {
  bd.prepare('UPDATE users SET mot_de_passe_hash = ?, doit_changer_mot_de_passe = 0 WHERE email = ?')
    .run(bcrypt.hashSync(MDP, 12), 'admin@demo.ca');
  const cab = bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get().id;
  const admin = bd.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  if (!placesGoogle.obtenirReglageGoogle(cab).cleCabinetPresente) {
    placesGoogle.definirCleGoogle(cab, admin, 'cle-google-de-test-ABCD1234');
  }
  console.log('préparation OK (cabinet', cab + ')');

  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  await page.goto(BASE + '/connexion');
  await page.fill('form input[name="email"]', 'admin@demo.ca');
  await page.fill('form input[name="mot_de_passe"]', MDP);
  await page.click('form button[type="submit"]');
  await page.waitForLoadState('networkidle');
  console.log('login ->', page.url);

  // Dictée → analyse → révision
  await page.goto(BASE + '/ouverture');
  await page.waitForLoadState('networkidle');
  await page.fill('form textarea[name="texte"]', TEXTE_BIENS);
  await page.click('form[action="/ouverture/analyser"] button[type="submit"]');
  await page.waitForLoadState('networkidle');
  console.log('révision ->', page.url);
  // Choisir le candidat Google (remplit l'entreprise + pose le place_id)
  await page.check('input[name="candidat_google"][value="0"]');
  await page.waitForTimeout(400);

  // 120 : révision d'ouverture (candidat Google + éléments dictés)
  await page.screenshot({ path: path.join(OUT, '120-ouverture-revision.png'), fullPage: true });
  console.log('120 OK');

  // 121 : Admin → section clé Google Maps
  const onglet = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  // Réutiliser la session : copier les cookies du premier contexte
  await onglet.context().addCookies(await page.context().cookies());
  await onglet.goto(BASE + '/admin/cohere');
  await onglet.waitForLoadState('networkidle');
  await onglet.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((x) => x.textContent.includes('Google Maps'));
    if (h) h.scrollIntoView();
  });
  await onglet.waitForTimeout(300);
  await onglet.screenshot({ path: path.join(OUT, '121-reglage-google.png'), fullPage: false });
  console.log('121 OK');
  await onglet.close();

  // Création du dossier → fiche de la soumission
  await page.click('form[action^="/ouverture/"] button[type="submit"]');
  await page.waitForLoadState('networkidle');
  console.log('fiche créée ->', page.url);

  // 122 : fiche soumission créée, manques affichés
  await page.screenshot({ path: path.join(OUT, '122-dossier-ouvert.png'), fullPage: true });
  console.log('122 OK');

  await browser.close();
})().catch((e) => { console.error('❌', e); process.exit(1); });
