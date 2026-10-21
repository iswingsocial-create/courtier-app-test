/**
 * scripts/captures-classement.js — Captures 118-119 (classement intelligent).
 * Prépare une base de capture : mot de passe admin connu + courriels de
 * démonstration classés par chaque méthode, un non classé avec suggestion,
 * puis photographie la liste des courriels et la fiche police.
 * Usage : serveur sur 3101 avec CHEMIN_BD=/tmp/capture-cls.db (base fraîche).
 */
const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const { chromium } = require('/home/hatch/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const BASE = 'http://localhost:3101';
const OUT = path.join(__dirname, '..', 'demo-captures', 'commercial');
const DB = process.env.CHEMIN_BD || '/tmp/capture-cls.db';
const MDP = 'Capture2026!';

(async () => {
  const bd = new Database(DB);
  bd.prepare('UPDATE users SET mot_de_passe_hash = ?, doit_changer_mot_de_passe = 0 WHERE email = ?')
    .run(bcrypt.hashSync(MDP, 12), 'admin@demo.ca');
  const cab = bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get().id;
  const methot = bd.prepare("SELECT * FROM clients WHERE cabinet_id = ? AND raison_sociale LIKE 'Constructions Méthot%'").get(cab);
  const garage = bd.prepare("SELECT * FROM clients WHERE cabinet_id = ? AND raison_sociale LIKE 'Garage Saint-Michel%'").get(cab);
  const policeCgl = bd.prepare("SELECT * FROM polices WHERE cabinet_id = ? AND numero_police = 'CGL-2025-10001'").get(cab);
  const policeBiens = bd.prepare("SELECT * FROM polices WHERE cabinet_id = ? AND numero_police = 'BIEN-2024-20002'").get(cab);
  const ins = bd.prepare(`INSERT INTO courriels (cabinet_id, dossier, expediteur, destinataires, sujet,
      corps_texte, date_courriel, lu, client_id, police_id, classement_methode, classement_detail, message_id)
    VALUES (?, 'reception', ?, '', ?, ?, ?, 0, ?, ?, ?, ?, ?)`);
  // Classé par numéro de police (assureur inconnu)
  ins.run(cab, 'avis@assureur-demo.ca', 'Avis de renouvellement — police CGL-2025-10001',
    'Bonjour, veuillez trouver ci-joint l\u2019avis de renouvellement de la police CGL-2025-10001.',
    '2026-10-19', methot.id, policeCgl.id, 'numero_police', 'CGL-2025-10001', '<cap-1@demo>');
  // Classé par adresse connue
  ins.run(cab, 'Sylvain Méthot <sylvain.methot@constructionsmethot.ca>', 'Question sur notre police de biens',
    'Bonjour, pouvez-vous vérifier la valeur de notre bâtiment ?', '2026-10-19',
    methot.id, null, 'adresse', 'sylvain.methot@constructionsmethot.ca', '<cap-2@demo>');
  // Classé par nom d'entreprise
  ins.run(cab, 'certificats@assureur-demo.ca', 'Certificat d\u2019assurance demandé',
    'Veuillez trouver le certificat émis pour Constructions Méthot inc. Merci.', '2026-10-18',
    methot.id, null, 'nom_entreprise', 'Constructions Méthot inc.', '<cap-3@demo>');
  // Lien manuel vers une police précise
  ins.run(cab, 'avis@assureur-demo.ca', 'Note de couverture — biens',
    'Note de couverture pour le bâtiment assuré.', '2026-10-18',
    methot.id, policeBiens.id, 'manuel', 'BIEN-2024-20002', '<cap-4@demo>');
  // Non classé (aucune correspondance)
  ins.run(cab, 'prospect@inconnu.ca', 'Demande d\u2019information', 'Bonjour, je cherche une soumission.', '2026-10-17',
    null, null, 'aucun', null, '<cap-5@demo>');
  bd.close();

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

  // 118 : liste des courriels avec badges + filtre « À classer »
  await page.goto(BASE + '/courriels');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT, '118-courriels-badges.png'), fullPage: true });
  console.log('118 OK');

  // 119 : fiche police CGL avec sa section « Courriels liés »
  await page.goto(BASE + '/echeances/police/' + policeCgl.id);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT, '119-police-courriels.png'), fullPage: true });
  console.log('119 OK');

  await browser.close();
})().catch((e) => { console.error('❌', e); process.exit(1); });
