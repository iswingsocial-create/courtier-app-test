/**
 * scripts/test-analyse-listes.js — « Analyse de documents IA » v2, étape 1/4 :
 * extraction des LISTES COMPLÈTES depuis les documents texte/PDF
 * (lib/analyse-document.js) — tous les véhicules d'une annexe flotte, tous
 * les conducteurs, mécanique générique (bâtiments, dirigeants, obligations),
 * validation des listes Cohere contre le dictionnaire (META_LISTES).
 * Prérequis : base FRAÎCHE via CHEMIN_BD, SANS serveur.
 * Usage : CHEMIN_BD=/tmp/test-listes.db node scripts/test-analyse-listes.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-listes.db';
const fs = require('fs');
const os = require('os');
const path = require('path');
const moteur = require('../lib/analyse-document');
const extraction = require('../lib/extraction-document');

let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

function fabriquerPdf(nom, lignes) {
  const PDFDocument = require('pdfkit');
  const chemin = path.join(os.tmpdir(), nom);
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const flux = fs.createWriteStream(chemin);
    doc.pipe(flux);
    doc.fontSize(13).text(lignes[0]);
    doc.fontSize(11);
    for (const l of lignes.slice(1)) doc.text(l);
    doc.end();
    flux.on('finish', () => resolve(chemin));
  });
}

const POLICE_FLOTTE = [
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
  '',
  'Véhicule 3 : 2020 Toyota Corolla',
  'NIV : 2T1BURHE8JC045678',
  'Valeur : 18 500 $',
  'Usage : Service',
  '',
  'Véhicule 4 : 2019 Manac Remorque fermée 28 pi',
  'NIV : 1T9UT2825NA334455',
  'Valeur : 21 000 $',
  '',
  'ANNEXE B — CONDUCTEURS DÉCLARÉS',
  'Conducteur 1 : Jean-François Lapointe',
  'Permis : L152-040478-01',
  'Classe : 3',
  'Date de naissance : 1978-04-12',
  'Expérience : 24 ans',
  '',
  'Conducteur 2 : Marc Gagnon',
  'Permis : G556-230985-02',
  'Classe : 3',
  'Date de naissance : 1985-09-23',
  'Expérience : 15 ans',
  '',
  'Conducteur 3 : Sophie Tremblay',
  'Permis : T621-300192-03',
  'Classe : 5',
  'Date de naissance : 1992-01-30',
  'Expérience : 9 ans',
];

(async () => {
  console.log('== Analyse IA v2 — étape 1 : listes complètes (texte/PDF) ==');

  // ---- 1. Texte brut : annexe flotte complète --------------------------------
  console.log('1. Annexe flotte (texte)');
  const r = moteur.analyserLocal(POLICE_FLOTTE.join('\n'));
  test('produit « flotte » détecté', r.produit === 'flotte', JSON.stringify(r.produit));
  const vehs = r.listes.vehicules || [];
  test('les 4 véhicules de l\u2019annexe sont proposés', vehs.length === 4, `n=${vehs.length}`);
  test('véhicule 1 : NIV exact', vehs[0]?.champs.niv === '1FTBW3CM5KKB12345', JSON.stringify(vehs[0]?.champs));
  test('véhicule 1 : année 2022, marque Ford, modèle Transit 250',
    vehs[0]?.champs.annee === 2022 && vehs[0]?.champs.marque === 'Ford' && /Transit/.test(vehs[0]?.champs.modele || ''),
    JSON.stringify(vehs[0]?.champs));
  test('véhicule 1 : valeur 62 000, usage livraison',
    vehs[0]?.champs.valeur === 62000 && vehs[0]?.champs.usage === 'livraison');
  test('véhicule 2 : Ram ProMaster 2021, 54 000 $',
    vehs[1]?.champs.marque === 'Ram' && vehs[1]?.champs.annee === 2021 && vehs[1]?.champs.valeur === 54000);
  test('véhicule 3 : Toyota Corolla 2020, usage service',
    vehs[2]?.champs.marque === 'Toyota' && vehs[2]?.champs.usage === 'service');
  test('véhicule 4 : remorque Manac 2019, type remorque',
    vehs[3]?.champs.marque === 'Manac' && vehs[3]?.champs.type_vehicule === 'remorque');
  test('chaque véhicule a une confiance et un extrait source',
    vehs.every((v) => v.confiance && v.extrait));
  const conds = r.listes.conducteurs || [];
  test('les 3 conducteurs de l\u2019annexe sont proposés', conds.length === 3, `n=${conds.length}`);
  test('conducteur 1 : nom/prénom séparés', conds[0]?.champs.nom === 'Lapointe' && conds[0]?.champs.prenom === 'Jean-François', JSON.stringify(conds[0]?.champs));
  test('conducteur 1 : permis, classe 3, naissance, expérience',
    conds[0]?.champs.numero_permis === 'L152-040478-01' && conds[0]?.champs.classe_permis === '3'
    && conds[0]?.champs.date_naissance === '1978-04-12' && conds[0]?.champs.annees_experience === 24);
  test('conducteur 3 : classe 5, 9 ans', conds[2]?.champs.classe_permis === '5' && conds[2]?.champs.annees_experience === 9);
  test('les champs scalaires v1 restent proposés (prime, rayon)',
    r.champs.some((c) => c.champ === 'garanties.prime' && c.valeur === 21500)
    && r.champs.some((c) => c.champ === 'entete.rayon_operation_km' && c.valeur === 160));

  // ---- 2. Même contenu via un vrai PDF (extraction pdf-parse) ------------------
  console.log('2. Annexe flotte (PDF généré)');
  const pdf = await fabriquerPdf('analyse-flotte-annexe.pdf', POLICE_FLOTTE);
  const ext = await extraction.extraireTexte({ chemin: pdf, mime: 'application/pdf', nom: 'police-flotte.pdf' });
  test('extraction PDF : texte obtenu', ext.texte.length > 200, `${ext.texte.length} car.`);
  const rPdf = moteur.analyserLocal(ext.texte);
  test('PDF : les 4 véhicules aussi', (rPdf.listes.vehicules || []).length === 4,
    `n=${(rPdf.listes.vehicules || []).length} — ${JSON.stringify((rPdf.listes.vehicules || []).map((v) => v.champs.niv))}`);
  test('PDF : NIV du 4e véhicule exact', rPdf.listes.vehicules?.[3]?.champs.niv === '1T9UT2825NA334455');
  test('PDF : les 3 conducteurs aussi', (rPdf.listes.conducteurs || []).length === 3);

  // ---- 3. Style « une ligne par véhicule » (annexes d'assureurs) ----------------
  console.log('3. Style ligne par véhicule');
  const txtLignes = [
    'Assurance flotte automobile',
    'Assuré : Déménagement Rapide inc.',
    '1FTBW3CM5KKB12345 2022 Ford Transit — 62 000 $',
    '3C6TRVBG8ME512340 2021 Ram ProMaster — 54 000 $',
    '2T1BURHE8JC045678 2020 Toyota Corolla — 18 500 $',
  ].join('\n');
  const rL = moteur.analyserLocal(txtLignes);
  test('3 véhicules en style ligne', (rL.listes.vehicules || []).length === 3, `n=${(rL.listes.vehicules || []).length}`);
  test('ligne 2 : NIV + année + marque', rL.listes.vehicules?.[1]?.champs.niv === '3C6TRVBG8ME512340'
    && rL.listes.vehicules?.[1]?.champs.annee === 2021);

  // ---- 4. FPQ1 : un véhicule + un conducteur --------------------------------------
  console.log('4. FPQ1 (auto)');
  const txtAuto = [
    "Proposition d'assurance automobile — Formulaire FPQ1",
    'Assuré : Garage Saint-Michel inc.',
    'Véhicule 1 : 2023 Honda Civic',
    'NIV : 2HGFE2F53PH034567',
    'Conducteur 1 : Marie Côté',
    'Permis : C450-120388-04',
    'Date de naissance : 1988-03-12',
  ].join('\n');
  const rA = moteur.analyserLocal(txtAuto);
  test('FPQ1 : produit auto', rA.produit === 'auto', JSON.stringify(rA.produit));
  test('FPQ1 : 1 véhicule proposé (Honda 2023)', rA.listes.vehicules?.length === 1
    && rA.listes.vehicules[0].champs.marque === 'Honda' && rA.listes.vehicules[0].champs.annee === 2023);
  test('FPQ1 : 1 conducteur proposé', rA.listes.conducteurs?.length === 1
    && rA.listes.conducteurs[0].champs.numero_permis === 'C450-120388-04');

  // ---- 5. Mécanique générique : biens / D&O / cautionnement -------------------------
  console.log('5. Listes génériques');
  const txtBiens = [
    'Assurance de biens commerciaux',
    'Assuré : Boulangerie Chaleur inc.',
    'Bâtiment 1 :',
    'Adresse : 4521 rue Sainte-Catherine, Montréal',
    'Année de construction : 1965',
    'Valeur de reconstruction : 1 250 000 $',
    'Bâtiment 2 :',
    'Adresse : 88 rue des Forges, Trois-Rivières',
    'Année de construction : 1998',
    'Valeur de reconstruction : 640 000 $',
  ].join('\n');
  const rB = moteur.analyserLocal(txtBiens);
  test('Biens : produit détecté', rB.produit === 'biens', JSON.stringify(rB.produit));
  test('Biens : 2 bâtiments proposés', (rB.listes.batiments || []).length === 2, `n=${(rB.listes.batiments || []).length}`);
  test('Biens : bâtiment 1 — adresse + valeur + année',
    /Sainte-Catherine/.test(rB.listes.batiments?.[0]?.champs.adresse || '')
    && rB.listes.batiments?.[0]?.champs.valeur_batiment === 1250000
    && rB.listes.batiments?.[0]?.champs.annee_construction === 1965, JSON.stringify(rB.listes.batiments?.[0]?.champs));

  const txtDo = [
    'Assurance administrateurs et dirigeants (D&O)',
    'Assuré : Forges Bélanger inc.',
    'Dirigeant 1 : Marie Tremblay',
    'Fonction : Présidente-directrice générale',
    'Expérience : 15 ans',
    'Dirigeant 2 : Paul Bélanger',
    'Fonction : Vice-président finances',
    'Expérience : 10 ans',
  ].join('\n');
  const rDo = moteur.analyserLocal(txtDo);
  test('D&O : produit détecté', rDo.produit === 'do', JSON.stringify(rDo.produit));
  test('D&O : 2 dirigeants proposés', (rDo.listes.dirigeants || []).length === 2, `n=${(rDo.listes.dirigeants || []).length}`);
  test('D&O : dirigeant 1 — nom + fonction + expérience',
    /Tremblay/.test(rDo.listes.dirigeants?.[0]?.champs.nom || '')
    && /Présidente/.test(rDo.listes.dirigeants?.[0]?.champs.fonction || '')
    && rDo.listes.dirigeants?.[0]?.champs.annees_experience === 15, JSON.stringify(rDo.listes.dirigeants?.[0]?.champs));

  const txtCaut = [
    'Cautionnement — demande de ligne',
    'Entrepreneur : Construction Verdon inc.',
    'Cautionnement 1 :',
    "Type : cautionnement d'exécution",
    'Bénéficiaire : Centre de services scolaire de Laval',
    'Montant du contrat : 2 200 000 $',
    'Montant du cautionnement : 1 100 000 $',
    'Cautionnement 2 :',
    'Type : licence RBQ',
    'Bénéficiaire : Régie du bâtiment du Québec',
    'Montant du cautionnement : 40 000 $',
  ].join('\n');
  const rC = moteur.analyserLocal(txtCaut);
  test('Cautionnement : produit détecté', rC.produit === 'cautionnement', JSON.stringify(rC.produit));
  test('Cautionnement : 2 obligations proposées', (rC.listes.obligations || []).length === 2, `n=${(rC.listes.obligations || []).length}`);
  test('Cautionnement : obligation 1 — execution + montants',
    rC.listes.obligations?.[0]?.champs.type === 'execution'
    && rC.listes.obligations?.[0]?.champs.montant_contrat === 2200000
    && rC.listes.obligations?.[0]?.champs.montant_cautionnement === 1100000, JSON.stringify(rC.listes.obligations?.[0]?.champs));
  test('Cautionnement : obligation 2 — type rbq', rC.listes.obligations?.[1]?.champs.type === 'rbq');

  // ---- 6. Déduplication + aucun faux positif -----------------------------------------
  console.log('6. Robustesse');
  const txtDoublon = [
    'Assurance flotte automobile',
    'Véhicule 1 : 2022 Ford Transit',
    'NIV : 1FTBW3CM5KKB12345',
    'NIV : 1FTBW3CM5KKB12345',
  ].join('\n');
  const rD = moteur.analyserLocal(txtDoublon);
  test('NIV répété dans le même bloc : 1 seul véhicule', (rD.listes.vehicules || []).length === 1);
  const rVide = moteur.analyserLocal('Bonjour, merci de votre confiance. Prime : 900 $');
  test('texte sans liste : listes vides (pas de faux positif)',
    Object.keys(rVide.listes).length === 0, JSON.stringify(Object.keys(rVide.listes)));

  // ---- 7. Validation des listes Cohere ------------------------------------------------
  console.log('7. Listes Cohere (validation dictionnaire)');
  const lignes = ['L152-040478-01 Lapointe'];
  const v1 = moteur.validerListesCohere({
    vehicules: [{ champs: { niv: '1FTBW3CM5KKB12345', annee: '2022', champ_inconnu: 'x' }, confiance: 'haute' }],
    conducteurs: [{ champs: { nom: 'Lapointe', numero_permis: 'L152-040478-01' } }],
    liste_inventee: [{ champs: { a: 1 } }],
  }, 'flotte', lignes);
  test('Cohere : listes valides conservées, type inconnu rejeté',
    (v1.vehicules || []).length === 1 && (v1.conducteurs || []).length === 1 && !v1.liste_inventee);
  test('Cohere : champ inconnu rejeté, année coercée en nombre',
    v1.vehicules[0].champs.annee === 2022 && v1.vehicules[0].champs.champ_inconnu === undefined);
  const v2 = moteur.validerListesCohere({ batiments: [{ champs: { adresse: '1 rue X' } }] }, 'flotte', lignes);
  test('Cohere : liste incompatible avec le produit rejetée', !v2.batiments);
  test('META_LISTES : 9 types de listes couvrant les 9 produits',
    Object.keys(moteur.META_LISTES).length === 9
    && ['auto', 'flotte', 'biens', 'rc', 'cyber', 'eo', 'do', 'pe', 'cautionnement']
      .every((p) => Object.values(moteur.META_LISTES).some((m) => m.produits.includes(p))));

  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
