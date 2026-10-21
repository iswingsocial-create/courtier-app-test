/**
 * scripts/captures-marche.js — Captures 138-141 : mise en marché (F15).
 * 138 registre ; 139 création depuis une combinée ; 140 fiche envoi avec
 * offre saisie ; 141 échéances avec relance due.
 * Le serveur doit être lancé avec la même base :
 *   (PORT=3101 CHEMIN_BD=/tmp/capture-marche.db nohup node server.js > /tmp/captures-marche.log 2>&1 &)
 *   CHEMIN_BD=/tmp/capture-marche.db node scripts/captures-marche.js
 * Le peuplement passe par les modules métier (lib/marche.js).
 */
const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const { chromium } = require('/home/hatch/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const BASE = 'http://localhost:3101';
const OUT = path.join(__dirname, '..', 'demo-captures', 'commercial');
const DB = process.env.CHEMIN_BD || '/tmp/capture-marche.db';
const MDP = 'Capture2026!';

(async () => {
  const bdBrute = new Database(DB);
  bdBrute.prepare('UPDATE users SET mot_de_passe_hash = ?, doit_changer_mot_de_passe = 0 WHERE email = ?')
    .run(bcrypt.hashSync(MDP, 12), 'admin@demo.ca');
  const cab = bdBrute.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get().id;
  const admin = bdBrute.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  bdBrute.close();

  process.env.CHEMIN_BD = DB;
  const bd = require('../lib/bd');
  const biens = require('../lib/biens');
  const combine = require('../lib/combine');
  const marche = require('../lib/marche');
  const utilisateur = { id: admin, nom: 'Admin Démo' };

  const clientExistant = bd.prepare("SELECT id FROM clients WHERE cabinet_id = ? AND raison_sociale = 'Crèmerie du Marché inc.'").get(cab);
  const clientId = clientExistant ? clientExistant.id : bd.prepare(
    `INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel, telephone, adresse, ville, province, code_postal, responsable_id)
     VALUES (?, 'Crèmerie du Marché inc.', '', '', 'info@cremerie.example', '(514) 555-0177', '88 rue des Marchés', 'Montréal', 'QC', 'H2T 1A1', ?)`
  ).run(cab, admin).lastInsertRowid;
  // L'assureur Intact existe dans le seed de démonstration : on lui donne
  // un souscripteur « nouvelles affaires » nommé pour la capture.
  const assIntact = bd.prepare('SELECT id FROM assureurs WHERE cabinet_id = ? AND nom = ?').get(cab, 'Intact Assurance').id;
  bd.prepare("UPDATE assureurs SET na_nom = 'Sophie Tremblay', na_courriel = 'sophie.tremblay@intact.example', na_telephone = '(514) 555-0110' WHERE id = ?")
    .run(assIntact);
  bd.prepare(
    `INSERT OR IGNORE INTO assureurs (cabinet_id, nom, na_nom, na_courriel)
     VALUES (?, 'Aviva Canada', 'Karim Haddad', 'karim.haddad@aviva.example')`
  ).run(cab);
  const assAviva = bd.prepare('SELECT id FROM assureurs WHERE cabinet_id = ? AND nom = ?').get(cab, 'Aviva Canada').id;

  const dossierId = combine.creerDossier({ cabinetId: cab, userId: admin, clientId });
  const sBiens = combine.obtenirDossier(dossierId, cab).soumissions.biens.id;
  biens.ajouterBatiment(sBiens, cab, admin, { adresse: '88 rue des Marchés', ville: 'Montréal' });

  // Envoi 1 : combinée → Intact, transmis par courriel (simulé), offre reçue.
  const { envoi: e1, brouillonId: b1 } = marche.creerEnvoi(cab, utilisateur, {
    combineDossierId: dossierId, assureurId: assIntact,
    prochaineAction: 'Présenter l\u2019offre au client', prochaineActionEcheance: '2026-10-28',
  });
  await marche.envoyerBrouillonCourriel(b1, cab, utilisateur);
  marche.transitionner(e1.id, cab, utilisateur, 'en_analyse');
  marche.saisirOffre(e1.id, cab, utilisateur, {
    prime: 18950, limites: 'Bâtiment 1 850 000 $, contenu 450 000 $, RC 2 000 000 $, franchise 2 500 $',
    conditions: 'Inspection du bâtiment requise avant l\u2019émission', validite: '2026-11-20',
  });

  // Envoi 2 : biens → Aviva, transmis manuellement, relance due.
  const { envoi: e2 } = marche.creerEnvoi(cab, utilisateur, {
    produit: 'biens', soumissionId: sBiens, assureurId: assAviva,
  });
  marche.marquerTransmis(e2.id, cab, utilisateur, {});
  bd.prepare('UPDATE marche_envois SET date_relance = ? WHERE id = ?')
    .run(new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), e2.id);

  // Envoi 3 : combinée → grossiste libre, en analyse.
  const { envoi: e3 } = marche.creerEnvoi(cab, utilisateur, {
    combineDossierId: dossierId, marcheNom: 'APRIL Canada (grossiste)',
    souscripteurNom: 'Julie Perron', souscripteurCourriel: 'jperron@april.example',
    autoriteIntermediaire: 'Grossiste autorisé — vérifié au registre de l\u2019AMF',
  });
  marche.marquerTransmis(e3.id, cab, utilisateur, {});
  marche.transitionner(e3.id, cab, utilisateur, 'en_analyse');
  console.log(`Envois de démonstration : #${e1.id} (offre), #${e2.id} (relance due), #${e3.id} (en analyse)`);

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
  const fermerMenus = async () => {
    await page.evaluate(() => {
      document.querySelectorAll('header details').forEach((d) => d.removeAttribute('open'));
    });
    await page.waitForTimeout(250);
  };

  // 138 : le registre.
  await page.goto(BASE + '/mise-en-marche');
  await page.waitForLoadState('networkidle');
  await fermerMenus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '138-marche-registre.png') });
  console.log('138 OK (registre)');

  // 139 : création depuis la combinée.
  await page.goto(`${BASE}/mise-en-marche/nouveau?combine_id=${dossierId}&assureur_id=${assIntact}`);
  await page.waitForLoadState('networkidle');
  await fermerMenus();
  await page.screenshot({ path: path.join(OUT, '139-marche-nouveau-combinee.png') });
  console.log('139 OK (création depuis une combinée)');

  // 140 : fiche envoi avec offre saisie.
  await page.goto(`${BASE}/mise-en-marche/${e1.id}`);
  await page.waitForLoadState('networkidle');
  await fermerMenus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '140-marche-fiche-offre.png') });
  console.log('140 OK (fiche envoi, offre saisie)');

  // 141 : échéances — carte des relances dues.
  await page.goto(BASE + '/echeances');
  await page.waitForLoadState('networkidle');
  await fermerMenus();
  await page.locator('.carte', { hasText: 'Relances de mise en marché dues' }).first()
    .screenshot({ path: path.join(OUT, '141-marche-relances-echeances.png') });
  console.log('141 OK (échéances, relance due)');

  await browser.close();
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
