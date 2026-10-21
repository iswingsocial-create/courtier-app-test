/**
 * scripts/captures-client-cible.js — Capture 126 (correctif « Client du
 * document » de la révision d'analyse). Prépare une base de capture :
 * une analyse « Cyber » dont l'entreprise extraite est la Clinique
 * Dentaire Bouchard inc. — la révision affiche le client pré-sélectionné
 * en tête, et les rattachements filtrés sur SES soumissions (cyber) et
 * SES polices. Usage : serveur sur 3101, CHEMIN_BD=/tmp/capture-client.db
 * (base fraîche, seedée au démarrage).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const { chromium } = require('/home/hatch/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const BASE = 'http://localhost:3101';
const OUT = path.join(__dirname, '..', 'demo-captures', 'commercial');
const DB = process.env.CHEMIN_BD || '/tmp/capture-client.db';
const MDP = 'Capture2026!';

(async () => {
  const bd = new Database(DB);
  bd.prepare('UPDATE users SET mot_de_passe_hash = ?, doit_changer_mot_de_passe = 0 WHERE email = ?')
    .run(bcrypt.hashSync(MDP, 12), 'admin@demo.ca');
  const cab = bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get().id;
  const admin = bd.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  const cli = bd.prepare("SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND raison_sociale LIKE 'Clinique Dentaire Bouchard%'").get(cab);
  if (!cli) throw new Error('Client seed « Clinique Dentaire Bouchard » introuvable');

  // Une police cyber pour ce client (si le seed n'en a pas déjà une).
  const polExistante = bd.prepare("SELECT id FROM polices WHERE cabinet_id = ? AND client_id = ? AND ligne = 'cyber'").get(cab, cli.id);
  if (!polExistante) {
    bd.prepare(`INSERT INTO polices (cabinet_id, client_id, ligne, assureur, numero_police, date_effet, date_echeance, statut, responsable_id)
      VALUES (?, ?, 'cyber', 'Northbridge Assurance', 'CYB-2026-3001', '2026-02-01', '2027-02-01', 'active', ?)`)
      .run(cab, cli.id, admin);
  }

  // L'analyse cyber du document de ce client (entreprise extraite = lui).
  const cheminTmp = path.join(os.tmpdir(), 'capture-police-cyber-bouchard.pdf');
  fs.writeFileSync(cheminTmp, '%PDF-1.4 police cyber de démonstration');
  const champs = [
    { champ: 'client.entreprise', table: 'clients', colonne: 'raison_sociale', libelle: 'Entreprise', valeur: cli.raison_sociale, confiance: 'haute', extrait: 'Assuré nommé : ' + cli.raison_sociale },
    { champ: 'entete.assureur', table: 'polices', colonne: 'assureur', libelle: 'Assureur', valeur: 'Northbridge Assurance', confiance: 'haute', extrait: 'Assureur : Northbridge Assurance' },
    { champ: 'entete.numero_police', table: 'polices', colonne: 'numero_police', libelle: 'Numéro de police', valeur: 'CYB-2026-3001', confiance: 'haute', extrait: 'N° de police : CYB-2026-3001' },
    { champ: 'garanties.limite_par_sinistre', table: 'cyber_soumissions', colonne: 'limite_par_sinistre', libelle: 'Limite par sinistre', valeur: 1000000, confiance: 'haute', extrait: 'Limite : 1 000 000 $' },
    { champ: 'garanties.franchise', table: 'cyber_soumissions', colonne: 'franchise', libelle: 'Franchise', valeur: 2500, confiance: 'haute', extrait: 'Franchise : 2 500 $' },
    { champ: 'garanties.prime', table: 'cyber_soumissions', colonne: 'prime', libelle: 'Prime', valeur: 3200, confiance: 'haute', extrait: 'Prime : 3 200 $' },
  ];
  const analyseId = bd.prepare(`INSERT INTO analyses_documents (cabinet_id, utilisateur_id, nom_origine, chemin, mime, taille,
      statut, produit_detecte, confiance_globale, champs_proposes, moteur, texte_extrait)
    VALUES (?, ?, 'police-cyber-bouchard.pdf', ?, 'application/pdf', 2048, 'a_reviser', 'cyber', 0.92, ?, 'local', ?)`)
    .run(cab, admin, cheminTmp, JSON.stringify(champs),
      'Police CYBER — Assuré nommé : ' + cli.raison_sociale + ' — N° de police : CYB-2026-3001').lastInsertRowid;
  bd.close();
  console.log('données semées : client =', cli.id, ', analyse =', analyseId);

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

  await page.goto(BASE + '/analyses/' + analyseId);
  await page.waitForLoadState('networkidle');
  // Laisser le filtrage client/produit s'appliquer, puis photographier.
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '126-revision-choix-client.png'), fullPage: true });
  console.log('126 OK');

  await browser.close();
})().catch((e) => { console.error('❌', e); process.exit(1); });
