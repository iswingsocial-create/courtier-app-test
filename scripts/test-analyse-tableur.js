/**
 * scripts/test-analyse-tableur.js — « Analyse de documents IA » v2, étape 2/4 :
 * analyse DIRECTE d'un tableur (.xlsx / .csv) en liste structurée
 * (lib/extraction-document.js : grille conservée ; lib/analyse-tableur.js :
 * en-têtes « entrepreneur » mappés via les correspondances de l'import).
 * Aucune conversion demandée à l'utilisateur.
 * Prérequis : base FRAÎCHE via CHEMIN_BD, SANS serveur.
 * Usage : CHEMIN_BD=/tmp/test-tableur.db node scripts/test-analyse-tableur.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-tableur.db';
const fs = require('fs');
const os = require('os');
const path = require('path');
const extraction = require('../lib/extraction-document');
const tableur = require('../lib/analyse-tableur');
const moteur = require('../lib/analyse-document');
const { fabriquerXlsx } = require('./fixtures/fabriquer-xlsx');

let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

const COLONNES_PERMIS = ['Nom', 'Prénom', 'Numéro de permis', 'Classe', 'Date de naissance', "Date d'embauche", "Années d'expérience"];
const LIGNES_PERMIS = [
  ['Lapointe', 'Jean-François', 'L152-040478-01', '3', '1978-04-12', '2009-06-01', 24],
  ['Gagnon', 'Marc', 'G556-230985-02', '3', '1985-09-23', '2016-03-14', 15],
  ['Tremblay', 'Sophie', 'T621-300192-03', '5', '1992-01-30', '2021-08-23', 9],
  ['Roy', 'Alain', 'R770-051170-04', '1', '1970-11-05', '2012-01-09', 30],
];

(async () => {
  console.log('== Analyse IA v2 — étape 2 : tableur Excel/CSV direct ==');

  // ---- 1. Vrai .xlsx de permis (fabriqué sans dépendance) ----------------------
  console.log('1. Excel de permis (.xlsx)');
  const xlsx = path.join(os.tmpdir(), 'permis-client.xlsx');
  fabriquerXlsx(xlsx, { colonnes: COLONNES_PERMIS, lignes: LIGNES_PERMIS });
  test('le .xlsx fabriqué existe et a une taille plausible', fs.existsSync(xlsx) && fs.statSync(xlsx).size > 500, `${fs.statSync(xlsx).size} o`);
  const grille = extraction.extraireTableau({ chemin: xlsx, nom: 'permis-client.xlsx' });
  test('grille extraite : 7 colonnes, 4 lignes', !!grille && grille.colonnes.length === 7 && grille.lignes.length === 4,
    grille && `${grille.colonnes.length} col., ${grille.lignes.length} lig.`);
  test('grille : en-têtes fidèles', grille && grille.colonnes[2] === 'Numéro de permis' && grille.colonnes[4] === 'Date de naissance');
  test('grille : valeurs fidèles (permis ligne 1)', grille && grille.lignes[0][2] === 'L152-040478-01');

  const r = tableur.analyserTableau(grille);
  test('type de liste détecté : conducteurs', r.typeListe === 'conducteurs', JSON.stringify(r.typeListe));
  test('produit déduit : flotte (classe + embauche)', r.produit === 'flotte', JSON.stringify(r.produit));
  const conds = r.listes.conducteurs || [];
  test('les 4 conducteurs sont proposés', conds.length === 4, `n=${conds.length}`);
  test('conducteur 1 champ par champ',
    conds[0]?.champs.nom === 'Lapointe' && conds[0]?.champs.prenom === 'Jean-François'
    && conds[0]?.champs.numero_permis === 'L152-040478-01' && conds[0]?.champs.classe_permis === '3'
    && conds[0]?.champs.date_naissance === '1978-04-12' && conds[0]?.champs.date_embauche === '2009-06-01'
    && conds[0]?.champs.annees_experience === 24, JSON.stringify(conds[0]?.champs));
  test('conducteur 4 : classe 1, 30 ans', conds[3]?.champs.classe_permis === '1' && conds[3]?.champs.annees_experience === 30);
  test('chaque conducteur a confiance + extrait « Ligne N »',
    conds.every((c) => c.confiance && /Ligne \d+/.test(c.extrait || '')));

  // ---- 2. Le même contenu en .csv (séparateur ;) --------------------------------
  console.log('2. CSV équivalent');
  const csv = path.join(os.tmpdir(), 'permis-client.csv');
  const versCsv = (l) => l.join(';');
  fs.writeFileSync(csv, '﻿' + [versCsv(COLONNES_PERMIS), ...LIGNES_PERMIS.map(versCsv)].join('\n'), 'utf8');
  const grilleCsv = extraction.extraireTableau({ chemin: csv, nom: 'permis-client.csv' });
  test('grille CSV extraite', !!grilleCsv && grilleCsv.lignes.length === 4);
  const rCsv = tableur.analyserTableau(grilleCsv);
  test('CSV : 4 conducteurs aussi', (rCsv.listes.conducteurs || []).length === 4);
  test('CSV : conducteur 2 identique à l\u2019Excel',
    rCsv.listes.conducteurs?.[1]?.champs.numero_permis === 'G556-230985-02'
    && rCsv.listes.conducteurs?.[1]?.champs.date_naissance === '1985-09-23');

  // ---- 3. En-têtes avec apostrophes courbes + variantes libres ----------------------
  console.log('3. En-têtes tordus');
  const grilleTordue = {
    colonnes: ['Nom du conducteur', 'Prénom', 'N° de permis', 'Classe de permis', 'Date d’embauche', 'Années d’expérience'],
    lignes: [
      ['Bouchard', 'Karine', 'B310-170695-05', '5', '2023-04-03', '6'],
      ['Côté', 'Marie', 'C450-120388-04', '5', '2020-02-17', '8'],
    ],
  };
  // « Nom du conducteur » n'est pas une correspondance directe : le nom seul
  // doit quand même passer par la colonne « Nom » si elle existe ; ici on
  // vérifie les colonnes reconnues (permis, classe, embauche, expérience).
  const rT = tableur.analyserTableau(grilleTordue);
  test('apostrophe courbe : « Date d\u2019embauche » reconnue',
    rT.listes.conducteurs?.[0]?.champs.date_embauche === '2023-04-03', JSON.stringify(rT.listes.conducteurs?.[0]?.champs));
  test('« N° de permis » et « Classe de permis » reconnus',
    rT.listes.conducteurs?.[0]?.champs.numero_permis === 'B310-170695-05'
    && rT.listes.conducteurs?.[0]?.champs.classe_permis === '5'
    && rT.listes.conducteurs?.[0]?.champs.annees_experience === 6);

  // ---- 4. Tableur de véhicules --------------------------------------------------------
  console.log('4. Excel de véhicules');
  const grilleVeh = {
    colonnes: ['NIV', 'Année', 'Marque', 'Modèle', 'Type de véhicule', 'Usage', 'Valeur', 'Lieu de remisage'],
    lignes: [
      ['1FTBW3CM5KKB12345', '2022', 'Ford', 'Transit 250', 'Camion', 'Livraison', '62 000', 'Laval'],
      ['3C6TRVBG8ME512340', '2021', 'Ram', 'ProMaster 3500', 'Camion', 'Livraison', '54 000', 'Laval'],
      ['1T9UT2825NA334455', '2019', 'Manac', 'Remorque fermée', 'Remorque', 'Transport', '21 000', 'Laval'],
    ],
  };
  const rV = tableur.analyserTableau(grilleVeh);
  test('type détecté : vehicules', rV.typeListe === 'vehicules', JSON.stringify(rV.typeListe));
  test('produit déduit : flotte (type + remisage)', rV.produit === 'flotte');
  test('3 véhicules proposés', (rV.listes.vehicules || []).length === 3);
  test('véhicule 1 : NIV (via « vin » EQUIV), année nombre, valeur nombre',
    rV.listes.vehicules?.[0]?.champs.niv === '1FTBW3CM5KKB12345'
    && rV.listes.vehicules?.[0]?.champs.annee === 2022
    && rV.listes.vehicules?.[0]?.champs.valeur === 62000, JSON.stringify(rV.listes.vehicules?.[0]?.champs));
  test('véhicule 3 : type remorque + usage codé transport_marchandises',
    rV.listes.vehicules?.[2]?.champs.type_vehicule === 'remorque'
    && rV.listes.vehicules?.[2]?.champs.usage === 'transport_marchandises');

  // ---- 5. Dates Excel en numéro de série --------------------------------------------------
  console.log('5. Dates série Excel');
  const grilleSerie = {
    colonnes: ['Nom', 'Prénom', 'Numéro de permis', 'Classe', 'Date de naissance'],
    lignes: [['Lapointe', 'Jean-François', 'L152-040478-01', '3', 28592]], // 1978-04-12 en série Excel
  };
  const rS = tableur.analyserTableau(grilleSerie);
  test('numéro de série converti en date ISO', rS.listes.conducteurs?.[0]?.champs.date_naissance === '1978-04-12',
    JSON.stringify(rS.listes.conducteurs?.[0]?.champs.date_naissance));

  // ---- 6. Tableur non reconnu : message honnête ----------------------------------------------
  console.log('6. Non reconnu');
  const rInc = tableur.analyserTableau({ colonnes: ['Produit', 'Quantité', 'Prix unitaire'], lignes: [['Pommes', '3', '2,50']] });
  test('aucune liste, produit null, message explicatif',
    rInc.typeListe === null && rInc.produit === null && /aucune liste connue/.test(rInc.message || ''), rInc.message);

  // ---- 7. Point d'entrée moteur.analyser() avec tableau ------------------------------------------
  console.log('7. Intégration moteur');
  const ext = await extraction.extraireTexte({ chemin: xlsx, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nom: 'permis-client.xlsx' });
  test('extraireTexte(.xlsx) fournit le tableau en plus du texte', !!ext.tableau && ext.methode === 'xlsx');
  const rMoteur = await moteur.analyser(ext.texte, { tableau: ext.tableau });
  test('analyser() route vers le tabulaire : 4 conducteurs',
    (rMoteur.listes.conducteurs || []).length === 4 && rMoteur.produit === 'flotte',
    `produit=${rMoteur.produit} n=${(rMoteur.listes.conducteurs || []).length}`);

  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
