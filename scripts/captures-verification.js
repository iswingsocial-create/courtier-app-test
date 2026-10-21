/**
 * scripts/captures-verification.js — Captures 123-125 (vérification des avenants).
 * Prépare une base de capture : police biens dont l'assureur a appliqué une
 * franchise de 2 500 $ au lieu des 1 000 $ demandés (rapport généré par le
 * vrai moteur de comparaison), une police entièrement conforme marquée
 * vérifiée, puis photographie le rapport, le brouillon de correction et la
 * fiche police conforme.
 * Usage : serveur sur 3101 avec CHEMIN_BD=/tmp/capture-verif.db (base fraîche).
 */
const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const { chromium } = require('/home/hatch/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const BASE = 'http://localhost:3101';
const OUT = path.join(__dirname, '..', 'demo-captures', 'commercial');
const DB = process.env.CHEMIN_BD || '/tmp/capture-verif.db';
const MDP = 'Capture2026!';

(async () => {
  const verif = require('../lib/verification-avenant');
  const bd = new Database(DB);
  bd.prepare('UPDATE users SET mot_de_passe_hash = ?, doit_changer_mot_de_passe = 0 WHERE email = ?')
    .run(bcrypt.hashSync(MDP, 12), 'admin@demo.ca');
  const cab = bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get().id;
  const admin = bd.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  bd.prepare(
    "UPDATE assureurs SET mod_courriel = 'modifications@intact-exemple.ca', courriel_general = 'info@intact-exemple.ca' WHERE cabinet_id = ? AND nom = 'Intact Assurance'"
  ).run(cab);
  const assureurId = bd.prepare("SELECT id FROM assureurs WHERE cabinet_id = ? AND nom = 'Intact Assurance'").get(cab)?.id || null;

  function creerPolice({ clientNom, numero, franchise, effet, echeance, batiments }) {
    const client = bd.prepare('INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)')
      .run(cab, clientNom, 'Contact', 'Démo').lastInsertRowid;
    const sou = bd.prepare("INSERT INTO biens_soumissions (cabinet_id, client_id, statut) VALUES (?, ?, 'convertie_police')")
      .run(cab, client).lastInsertRowid;
    for (const b of batiments) {
      const bat = bd.prepare(
        `INSERT INTO biens_batiments (cabinet_id, soumission_id, adresse, ville, type_construction,
           annee_construction, valeur_batiment, gicleurs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(cab, sou, b.adresse, b.ville, b.construction || null, b.annee || null, b.valeur || null, b.gicleurs || 0).lastInsertRowid;
      bd.prepare(
        'INSERT INTO biens_garanties (cabinet_id, batiment_id, formule, franchise, montant_assurance, prime) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(cab, bat, b.formule || null, b.franchiseGar || null, b.valeur || null, b.prime || null);
    }
    const police = bd.prepare(
      `INSERT INTO polices (cabinet_id, client_id, ligne, assureur, assureur_id, numero_police,
         date_effet, date_echeance, franchise, biens_soumission_id)
       VALUES (?, ?, 'biens', 'Intact Assurance', ?, ?, ?, ?, ?, ?)`
    ).run(cab, client, assureurId, numero, effet, echeance, franchise, sou).lastInsertRowid;
    return bd.prepare('SELECT * FROM polices WHERE id = ?').get(police);
  }

  // --- Police 1 : écart de franchise + un bâtiment absent du document --------
  const p1 = creerPolice({
    clientNom: 'Menuiserie Boisvert inc.', numero: 'BIE-2026-4100', franchise: 1000,
    effet: '2026-03-01', echeance: '2027-03-01',
    batiments: [
      { adresse: '450, rue des Artisans', ville: 'Sherbrooke', construction: 'beton', annee: 2005, valeur: 2400000, gicleurs: 1, formule: 'tous_risques', franchiseGar: 2500, prime: 4100 },
      { adresse: '900, rue du Parc', ville: 'Sherbrooke', valeur: 600000, prime: 0 },
    ],
  });
  const demande1 = verif.construireEtatDemande(p1);
  const applique1 = verif.construireEtatApplique({
    produit_detecte: 'biens',
    champs: [
      { champ: 'entete.assureur', valeur: 'Intact Assurance', confiance: 'haute', extrait: 'Assureur : Intact Assurance' },
      { champ: 'entete.numero_police', valeur: 'BIE-2026-4100', confiance: 'haute', extrait: 'N° de police : BIE-2026-4100' },
      { champ: 'entete.date_effet', valeur: '2026-03-01', confiance: 'haute', extrait: "Date d'effet : 2026-03-01" },
      { champ: 'entete.date_echeance', valeur: '2027-03-01', confiance: 'haute', extrait: "Date d'échéance : 2027-03-01" },
      { champ: 'garanties.franchise', valeur: 2500, confiance: 'haute', extrait: 'Franchise : 2 500 $' },
      { champ: 'garanties.prime', valeur: 4100, confiance: 'haute', extrait: 'Prime : 4 100 $' },
    ],
    listes: {
      batiments: [{
        champs: { adresse: '450 rue des Artisans', ville: 'Sherbrooke', type_construction: 'Béton', valeur_batiment: 2400000, gicleurs: 'oui' },
        confiance: 'haute', extrait: 'Bâtiment 1 — 450, rue des Artisans, Sherbrooke',
      }],
    },
  });
  const cmp1 = verif.comparer(demande1, applique1);
  const v1 = bd.prepare(
    `INSERT INTO verifications_avenants (cabinet_id, police_id, produit, source_type, rapport, statut, cree_par)
     VALUES (?, ?, 'biens', 'document', ?, ?, ?)`
  ).run(cab, p1.id, JSON.stringify({ genere_le: new Date().toISOString(), produit_demande: 'biens', produit_document: 'biens', lignes: cmp1.lignes, compteurs: cmp1.compteurs }), cmp1.statut, admin).lastInsertRowid;

  // --- Police 2 : tout conforme, marquée vérifiée ------------------------------
  const p2 = creerPolice({
    clientNom: 'Librairie du Centre inc.', numero: 'BIE-2026-4200', franchise: 500,
    effet: '2026-01-15', echeance: '2027-01-15',
    batiments: [
      { adresse: '300, rue Principale', ville: 'Granby', valeur: 900000, prime: 1800 },
    ],
  });
  const demande2 = verif.construireEtatDemande(p2);
  const applique2 = verif.construireEtatApplique({
    produit_detecte: 'biens',
    champs: [
      { champ: 'entete.assureur', valeur: 'Intact Assurance', confiance: 'haute', extrait: 'Assureur : Intact Assurance' },
      { champ: 'entete.numero_police', valeur: 'BIE-2026-4200', confiance: 'haute', extrait: 'N° de police : BIE-2026-4200' },
      { champ: 'entete.date_effet', valeur: '2026-01-15', confiance: 'haute', extrait: "Date d'effet : 2026-01-15" },
      { champ: 'entete.date_echeance', valeur: '2027-01-15', confiance: 'haute', extrait: "Date d'échéance : 2027-01-15" },
      { champ: 'garanties.franchise', valeur: 500, confiance: 'haute', extrait: 'Franchise : 500 $' },
      { champ: 'garanties.prime', valeur: 1800, confiance: 'haute', extrait: 'Prime : 1 800 $' },
    ],
    listes: {
      batiments: [{
        champs: { adresse: '300 rue Principale', ville: 'Granby', valeur_batiment: 900000 },
        confiance: 'haute', extrait: 'Bâtiment 1 — 300, rue Principale, Granby',
      }],
    },
  });
  const cmp2 = verif.comparer(demande2, applique2);
  bd.prepare(
    `INSERT INTO verifications_avenants (cabinet_id, police_id, produit, source_type, rapport, statut, cree_par, verifiee_par, verifiee_le)
     VALUES (?, ?, 'biens', 'piece_jointe_courriel', ?, ?, ?, ?, datetime('now'))`
  ).run(cab, p2.id, JSON.stringify({ genere_le: new Date().toISOString(), produit_demande: 'biens', produit_document: 'biens', lignes: cmp2.lignes, compteurs: cmp2.compteurs }), cmp2.statut, admin, admin);
  bd.close();
  console.log('données semées : police écarts =', p1.id, ', vérification =', v1, ', police conforme =', p2.id, ', statut2 =', cmp2.statut);

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

  // 123 : rapport d'écarts (franchise en évidence)
  await page.goto(`${BASE}/echeances/police/${p1.id}/verifications/${v1}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT, '123-rapport-ecarts.png'), fullPage: true });
  console.log('123 OK');

  // 124 : brouillon de correction pré-rédigé
  await page.goto(`${BASE}/echeances/police/${p1.id}/verifications/${v1}/correction`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT, '124-courriel-correction.png'), fullPage: true });
  console.log('124 OK');

  // 125 : fiche police avec vérification conforme
  await page.goto(`${BASE}/echeances/police/${p2.id}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT, '125-verification-conforme.png'), fullPage: true });
  console.log('125 OK');

  await browser.close();
})().catch((e) => { console.error('❌', e); process.exit(1); });
