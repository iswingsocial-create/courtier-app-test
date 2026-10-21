/**
 * scripts/captures-combinees.js — Captures 132-137 : soumission combinée.
 * 132 questionnaire combiné — entreprise ; 133 emplacement enrichi avec
 * voisinage ; 134 garanties des 3 volets ; 135 fiche combinée ;
 * 136 proposition combinée page 1 ; 137 proposition, section emplacement.
 *
 * Le serveur doit être lancé avec la même base :
 *   (PORT=3101 CHEMIN_BD=/tmp/capture-combine.db nohup node server.js > /tmp/captures-combinees.log 2>&1 &)
 *   CHEMIN_BD=/tmp/capture-combine.db node scripts/captures-combinees.js
 * Le peuplement passe par les modules métier (aucune donnée fabriquée en SQL
 * sauf le mot de passe de capture, posé en hash bcrypt comme les captures
 * précédentes).
 */
const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const { chromium } = require('/home/hatch/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const BASE = 'http://localhost:3101';
const OUT = path.join(__dirname, '..', 'demo-captures', 'commercial');
const DB = process.env.CHEMIN_BD || '/tmp/capture-combine.db';
const MDP = 'Capture2026!';

(async () => {
  // --- Mot de passe de capture ------------------------------------------------
  const bdBrute = new Database(DB);
  bdBrute.prepare('UPDATE users SET mot_de_passe_hash = ?, doit_changer_mot_de_passe = 0 WHERE email = ?')
    .run(bcrypt.hashSync(MDP, 12), 'admin@demo.ca');
  const cab = bdBrute.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get().id;
  const admin = bdBrute.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  bdBrute.close();

  // --- Peuplement par les modules métier ---------------------------------------
  process.env.CHEMIN_BD = DB;
  const combine = require('../lib/combine');
  const biens = require('../lib/biens');
  const rc = require('../lib/rc');
  const pe = require('../lib/pe');
  const bd = require('../lib/bd');

  combine.majEnteteCabinet(cab, admin, {
    adresse: '100 rue du Courtier', ville: 'Montréal', code_postal: 'H2Y 1A1',
    telephone: '(514) 555-0100', telecopieur: '(514) 555-0101',
    site_web: 'www.courtier-assurance.example', courriel: 'info@courtier-assurance.example',
  });
  const clientId = bd.prepare(
    `INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel, telephone,
       adresse, ville, province, code_postal, neq, secteur_activite)
     VALUES (?, 'Bijouterie Lumière inc.', 'Jo', 'Ailler', 'jo@bijouterie-lumiere.example',
       '(514) 555-0142', '500 rue des Bijoux', 'Montréal', 'QC', 'H3B 1A1', '1234567890', 'Commerce de détail')`
  ).run(cab).lastInsertRowid;
  combine.definirProfilClient(clientId, cab, admin, {
    forme_juridique: 'societe_actions', annee_fondation: 1998, annees_experience_liee: 22,
    noms_exploitation: 'Bijouterie Lumière', description_activites: 'Bijouterie — vente au détail, réparation et évaluation de bijoux',
    code_industrie: '448150', code_industrie_description: 'Bijouteries', code_industrie_pct_revenus: 100,
    repartition_revenus_types: { detail: 85, reparation: 15 },
    repartition_revenus_geo: { canada: 100 },
    masse_salariale: 486000, nb_employes_temps_plein: 9, nb_employes_temps_partiel: 3,
    employes_csst: 1, responsabilite_alcool: 0, pct_sous_traitance: 0,
  });
  const dossierId = combine.creerDossier({
    cabinetId: cab, userId: admin, clientId,
    donnees: {
      date_effet: '2026-11-01', date_echeance: '2027-11-01', plan_paiement: 'Mensuel',
      signataire_nom: 'Pat Courtier', signataire_titre: 'Courtier en assurance de dommages',
      date_signature: '2026-10-21',
    },
  });
  const d0 = combine.obtenirDossier(dossierId, cab);
  const sB = d0.soumissions.biens.id;
  const sRC = d0.soumissions.rc.id;
  const sPE = d0.soumissions.perte_exploitation.id;
  const bId = biens.ajouterBatiment(sB, cab, admin, {
    adresse: '500 rue des Bijoux', ville: 'Montréal', code_postal: 'H3B 1A1',
    type_activite: 'Bijouterie', type_emplacement: 'Magasin', type_batiment: 'Centre commercial',
    interet_assure: 'Locataire', superficie_occupee_pi2: 2400, annee_construction: 1999,
    nombre_etages: 1, classe_construction: 'incombustible',
    construction_mur: 'Blocs de béton', construction_toit_structure: 'Acier',
    finition_toit: 'Gravier', materiau_sol: 'Béton', sous_sol: 'Vide sanitaire',
    electricite_type: '200 ampères', plomberie_materiau: 'Cuivre', carburant: 'Électricité',
    annee_toiture: 2019, renovation_toiture_ampleur: 'Complète',
    renovation_electricite_annee: 2019, renovation_electricite_ampleur: 'Partielle',
    prise_eau_distance: 'À moins de 150 mètres', caserne_type: 'Professionnel',
    caserne_distance_km: 1.2, gicleurs: 1, gicleurs_couverture: 'entier',
    alarme_incendie_type: 'Alarme reliée à une centrale',
    voisin_gauche_affectation: 'Atelier de joaillerie', voisin_gauche_distance_m: 0,
    voisin_droite_affectation: 'Restaurant', voisin_droite_distance_m: 5,
    voisin_arriere_affectation: 'Stationnement', voisin_arriere_distance_m: 12,
    voisin_enface_affectation: 'Parc municipal', voisin_enface_distance_m: 30,
    alarme_vol_type: 'Poste de surveillance (service complet)', pene_dormant: 1,
    fenetres_grillagees: 1, glaces_incassables: 1, cameras: 1,
    coffre_type: 'Coffre-fort', coffre_categorie: 'TL-15',
  });
  biens.ajouterContenu(sB, cab, admin, { description: 'Inventaire de bijoux et montres', valeur: 750000 }, bId);
  biens.ajouterContenu(sB, cab, admin, { description: 'Équipement et mobilier', valeur: 85000 }, bId);
  biens.definirGaranties(bId, cab, admin, {
    formule: 'tous_risques', montant_assurance: 2000000, franchise: 1000,
    regle_proportionnelle: 90, franchise_contenu: 1000, regle_proportionnelle_contenu: 90,
    avenants: combine.normaliserAvenantsBiens({
      refoulement_egout: { present: 1, montant: 50000 },
      inondation: { present: 1, franchise: 2500, montant: 100000 },
      frais_communautaires: { present: 1, franchise: 1000, montant: 250000 },
      bris_equipement: { present: 1, montant_par_accident: 60000 },
    }),
  });
  combine.definirAlarme(bId, cab, admin, {
    compagnie_alarme: 'Alarmes Sécur inc.', centrale_nom_lieu: 'Centrale Sécur — Montréal',
    transmission_primaire: ['Internet (IP)', 'Cellulaire'], securite_ligne: 1,
    certificat_ulc_actif: 1, certificat_ulc_numero: 'ULC-2026-0451', certificat_ulc_expiration: '2027-03-31',
    contrat_entretien_annuel: 1, signaux_ouverture_fermeture: 'surveilles',
    repondants: ['Abonné', 'Service de garde'],
    protections_physiques: ['Pêne dormant', 'Glaces incassables', 'Rideaux ou portes d\u2019acier'],
  });
  combine.ajouterBeneficiaire(bId, cab, admin, {
    nom: 'Banque Exemple du Canada', adresse: '1000 boul. des Forges', ville: 'Trois-Rivières',
    code_postal: 'G9A 0A0', qualite: 'Créancier hypothécaire', clause_preavis: '30 jours',
  });
  combine.ajouterArticleFlottante(sB, cab, admin, {
    description: 'Outils divers et coffre de transport', base_reglement: 'Valeur à neuf', montant: 15000,
  });
  const lieuId = rc.ajouterExploitation(sRC, cab, admin, {
    adresse: '500 rue des Bijoux', ville: 'Montréal', code_postal: 'H3B 1A1',
    type_activite: 'Bijouterie', batiment_id: bId, chiffre_affaires: 1250000,
  });
  rc.definirGaranties(lieuId, cab, admin, {
    formule: 'globale', limite_par_sinistre: 2000000, limite_agregat: 5000000, franchise: 1000,
    prejudice_personnel_publicite: 2000000, frais_medicaux_par_personne: 25000,
    frais_medicaux_par_sinistre: 50000, responsabilite_locative: 500000,
    rc_auto_non_proprietaires: 2000000, umbrella_montant: 5000000, umbrella_retention: 10000,
    umbrella_polices_base: ['RC générale', 'Biens — RC locative'],
  });
  pe.ajouterEtablissement(sPE, cab, admin, {
    nom_lieu: 'Bijouterie — magasin', adresse: '500 rue des Bijoux, Montréal',
    occupation: 'Vente au détail', chiffre_affaires: 1250000, montant_pe: 300000, batiment_id: bId,
  });
  pe.definirGaranties(sPE, cab, admin, {
    limite: 500000, periode_indemnite_mois: 18, franchise_jours: 3, base_montant: 'benefice_brut',
    formule: 'benefice_brut', regle_proportionnelle: 90, honoraires_comptables: 25000,
  });
  combine.synchroniserAntecedents(dossierId, cab, admin, {
    assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'POL-2025-991',
    date_expiration_actuelle: '2026-10-31', annees_assurance_continue: 9,
    type_police_precedente: 'Combinée biens + RC', date_effet_precedente: '2025-11-01',
    prime_precedente: 21450, refus_resiliation_nonrenouvellement: 0,
    faillite_jugement: 0, condamnation_honnetete: 0,
    sinistres_5ans: [
      { date: '2024-03-12', type: 'Dégât d\u2019eau', montant: 12500, montant_paye: 11000, reserve: 1500, statut: 'Fermé', description: 'Rupture de tuyau au sous-sol' },
    ],
  });
  combine.definirReponsesSectorielles(clientId, cab, admin, {
    entr_licence_rbq: 'Non applicable (commerce de détail)',
    entr_types_travaux: 'Réparations de bijoux sur place',
  });
  combine.ajouterAssureAdditionnel('combine', dossierId, cab, admin, {
    nom: 'Fiducie Familiale Ailler', interet: 'Propriétaire de l\u2019inventaire en consignation',
  });
  console.log('Dossier combiné de démonstration : #' + dossierId);

  // --- Captures ----------------------------------------------------------------
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

  await page.goto(`${BASE}/combinees/${dossierId}`);
  await page.waitForLoadState('networkidle');
  await fermerMenus();

  // 135 : fiche combinée (sommaire + en-tête).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, '135-combinee-fiche.png') });
  console.log('135 OK (fiche combinée)');

  // 132 : questionnaire — section Entreprise.
  await page.locator('#entreprise').screenshot({ path: path.join(OUT, '132-combinee-entreprise.png') });
  console.log('132 OK (questionnaire — entreprise)');

  // 133 : emplacement enrichi avec voisinage (détails de l'emplacement ouverts).
  await page.evaluate(() => {
    document.querySelectorAll('#emplacements details').forEach((d) => d.setAttribute('open', ''));
  });
  await page.waitForTimeout(300);
  const detailsEmplacement = page.locator('#emplacements details').nth(1);
  await detailsEmplacement.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const boite133 = await detailsEmplacement.boundingBox();
  const def133 = await page.evaluate(() => window.scrollY);
  await page.screenshot({
    path: path.join(OUT, '133-combinee-emplacement-voisinage.png'),
    fullPage: true,
    clip: { x: Math.max(0, boite133.x - 6), y: boite133.y + def133 - 4, width: 1460, height: 1500 },
  });
  console.log('133 OK (emplacement enrichi + voisinage)');

  // 134 : garanties des 3 volets (détails biens ouverts).
  await page.evaluate(() => {
    document.querySelectorAll('#garanties details').forEach((d) => d.setAttribute('open', ''));
  });
  await page.waitForTimeout(300);
  await page.locator('#garanties').screenshot({ path: path.join(OUT, '134-combinee-garanties.png') });
  console.log('134 OK (garanties des 3 volets)');

  // 136 : proposition combinée, page 1.
  await page.goto(`${BASE}/combinees/${dossierId}/proposition`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, '136-proposition-combinee-p1.png') });
  console.log('136 OK (proposition combinée, page 1)');

  // 137 : proposition, section emplacement.
  const titreEmplacement = page.locator('h2', { hasText: 'EMPLACEMENT 1' }).first();
  await titreEmplacement.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const boite137 = await titreEmplacement.boundingBox();
  const def137 = await page.evaluate(() => window.scrollY);
  await page.screenshot({
    path: path.join(OUT, '137-proposition-combinee-emplacement.png'),
    fullPage: true,
    clip: { x: 10, y: Math.max(0, boite137.y + def137 - 12), width: 1460, height: 1250 },
  });
  console.log('137 OK (proposition — section emplacement)');

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
