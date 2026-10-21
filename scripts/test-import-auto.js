/**
 * scripts/test-import-auto.js — Import CSV étendu auto FPQ1 (étape 6/10) :
 * nouveaux types (soumission, conducteur, vehicule, antecedents), modèles
 * téléchargeables, validation stricte, versionnage, portefeuille courtier,
 * cloisonnement inter-cabinets, rapport d'erreurs.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-import-auto.js
 */
const fs = require('fs');
const path = require('path');
const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;

function nouveauJar() { return {}; }
function appliquerCookies(jar, res) {
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const [paire] = c.split(';');
    const i = paire.indexOf('=');
    if (i > 0) jar[paire.slice(0, i).trim()] = paire.slice(i + 1).trim();
  }
}
function enteteCookies(jar) {
  const paires = Object.entries(jar).map(([k, v]) => `${k}=${v}`);
  return paires.length ? { 'Cookie': paires.join('; ') } : {};
}
async function req(jar, methode, chemin, { form = null, multipart = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    corps = new URLSearchParams(form).toString();
  } else if (multipart) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(multipart.champs || {})) fd.append(k, v);
    if (multipart.fichier) {
      const buf = fs.readFileSync(multipart.fichier.chemin);
      fd.append(multipart.fichier.champ, new Blob([buf], { type: 'text/csv' }), multipart.fichier.nom);
    }
    corps = fd;
  }
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  const buf = Buffer.from(await res.arrayBuffer());
  return { statut: res.status, texte: buf.toString('utf8'), buf, location: res.headers.get('location') };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function test(nom, condition, detail) {
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
async function connexion(jar, email, mdp) {
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  return r;
}
async function changerMdp(jar, actuel, nouveau) {
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel, nouveau, confirmation: nouveau } });
  return r;
}
async function creerUtilisateur(jarAdmin, { nom, email, role, mdp, cabinetId = 1 }) {
  let r = await req(jarAdmin, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jarAdmin, 'POST', '/admin/utilisateurs', {
    form: { _csrf: csrf(r.texte), nom, email, cabinet_id: String(cabinetId), role, mot_de_passe: mdp },
  });
  return { ok: r.statut === 302, statut: r.statut };
}
async function importer(jar, cheminCsv, nom = 'import.csv') {
  let r = await req(jar, 'GET', '/import');
  const token = csrf(r.texte);
  return req(jar, 'POST', '/import', { multipart: { champs: { _csrf: token }, fichier: { champ: 'fichier', chemin: cheminCsv, nom } } });
}
async function exporter(jar, module, format) {
  let r = await req(jar, 'GET', '/exports');
  return req(jar, 'POST', '/exports', { form: { _csrf: csrf(r.texte), module, format } });
}
function ecrireCsvTmp(nom, lignes) {
  const p = path.join('/tmp', nom);
  fs.writeFileSync(p, '﻿' + lignes.join('\r\n'));
  return p;
}

(async () => {
  console.log('== Import auto FPQ1 (étape 6/10) ==');

  // 1. Page d'import et modèles ------------------------------------------------
  const jarAdmin = nouveauJar();
  await connexion(jarAdmin, 'admin@demo.ca', 'ChangeMoi123!');
  await changerMdp(jarAdmin, 'ChangeMoi123!', 'ImportAuto2026!');

  let r = await req(jarAdmin, 'GET', '/import');
  test('page import → 200', r.statut === 200, `${r.statut}`);
  test('page import mentionne FPQ1', r.texte.includes('FPQ1'), 'section auto absente');
  test('page import propose 4 modèles auto', ['modele-auto/soumission', 'modele-auto/conducteur', 'modele-auto/vehicule', 'modele-auto/antecedents'].every((s) => r.texte.includes(s)));

  r = await req(jarAdmin, 'GET', '/import/modele-auto/vehicule');
  test('modèle vehicule → 200 CSV', r.statut === 200 && r.texte.includes('NIV'), `${r.statut}`);
  test('modèle vehicule avec commentaires #', r.texte.includes('# Modèle'));
  r = await req(jarAdmin, 'GET', '/import/modele-auto/conducteur');
  test('modèle conducteur contient N° de permis', r.texte.includes('N° de permis'));
  r = await req(jarAdmin, 'GET', '/import/modele-auto/invalide');
  test('modèle inconnu → 404', r.statut === 404, `${r.statut}`);

  // 2. Créer l'entreprise de test via l'import classique ------------------------
  const csvEnt = ecrireCsvTmp('import-auto-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Atelier Mécanique Test inc.;Alain;Gagnon',
  ]);
  r = await importer(jarAdmin, csvEnt);
  test('import entreprise → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 3. Fichier exemple complet ---------------------------------------------------
  r = await importer(jarAdmin, path.join(__dirname, 'exemple-import-auto.csv'), 'exemple-import-auto.csv');
  const crees = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('exemple : 6 lignes créées', crees === '6', `créées=${crees}`);
  test('exemple : 0 erreur', erreurs === '0', `erreurs=${erreurs}`);

  // 4. Vérification via les exports (miroir) --------------------------------------
  r = await exporter(jarAdmin, 'conducteurs', 'csv');
  test('export conducteurs → 200', r.statut === 200, `${r.statut}`);
  test('export conducteurs contient les 2 conducteurs', r.texte.includes('Tremblay') && (r.texte.match(/Tremblay/g) || []).length >= 2);
  r = await exporter(jarAdmin, 'vehicules', 'csv');
  test('export véhicules contient les 2 NIV', r.texte.includes('2T3RFREV9PW123456') && r.texte.includes('1HGCM82633A123456'));
  test('export véhicules : en-tête RC — montant (miroir)', r.texte.includes('RC — montant'));
  test('export véhicules : garanties importées (b1, 2000000)', r.texte.includes('b1') && r.texte.includes('2000000'));
  r = await exporter(jarAdmin, 'soumissions', 'csv');
  test('export soumissions → 200', r.statut === 200, `${r.statut}`);
  const lignesCsv = r.texte.split('\n');
  const idxVersions = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Nb versions');
  const ligneSoum = lignesCsv.find((l) => l.includes('Atelier Mécanique Test'));
  const nbVersions = ligneSoum ? ligneSoum.split(';')[idxVersions] : null;
  // v1 création + 2 conducteurs + 2 véhicules + 2 garanties + 1 antécédents = 8
  test('soumission versionnée (8 versions)', nbVersions === '8', `nb_versions=${nbVersions}`);

  // 5. Fichier d'erreurs ------------------------------------------------------------
  const csvErr = ecrireCsvTmp('import-auto-erreurs.csv', [
    'type;Entreprise;Nom;Prénom;Date de naissance;N° de permis;Soumission (id);Année;Marque;Modèle;NIV;RC — montant;Protection B',
    'conducteur;Atelier Mécanique Test inc.;Erreur;Date;1990-13-45;X;;;',
    'conducteur;Entreprise Inexistante XYZ;Nobody;John;;;;',
    'vehicule;Atelier Mécanique Test inc.;;;;;99999;2020;Ford;Focus;SHORTVIN;;',
    'vehicule;Atelier Mécanique Test inc.;;;;;;2020;Ford;Focus;1HGCM82633A123459;;b9;',
    'vehicule;Atelier Mécanique Test inc.;;;;;;2020;Ford;Focus;1HGCM82633A123460;999;b1;',
    'antecedents;Atelier Mécanique Test inc.;;;;;99999;;;',
    'vehicule;Atelier Mécanique Test inc.;;;;;;2021;Kia;Rio;SHORTV10;1000000;b2;',
  ]);
  r = await importer(jarAdmin, csvErr, 'erreurs.csv');
  const crees2 = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs2 = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('fichier erreurs : 1 créé (NIV court = avertissement)', crees2 === '1', `créées=${crees2}`);
  test('fichier erreurs : 6 en erreur', erreurs2 === '6', `erreurs=${erreurs2}`);
  test('erreur date invalide détectée', r.texte.includes('date de naissance invalide'));
  test('erreur entreprise introuvable détectée', r.texte.includes('entreprise introuvable'));
  test('erreur soumission introuvable détectée', r.texte.includes('soumission 99999 introuvable'));
  test('erreur protection B invalide détectée', r.texte.includes('protection B invalide'));
  test('erreur RC invalide détectée', r.texte.includes('RC — montant invalide'));
  test('avertissement NIV (créé quand même)', r.texte.includes('NIV à vérifier'));

  // 6. Cloisonnement inter-cabinets ---------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/cabinets');
  let r2 = await req(jarAdmin, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Deux' } });
  test('création cabinet 2 → 302', r2.statut === 302, `${r2.statut}`);
  await creerUtilisateur(jarAdmin, { nom: 'User Deux', email: 'deux@test.ca', role: 'admin', mdp: 'ImportAuto2026!', cabinetId: 2 });
  const jarDeux = nouveauJar();
  await connexion(jarDeux, 'deux@test.ca', 'ImportAuto2026!');
  await changerMdp(jarDeux, 'ImportAuto2026!', 'ImportAuto2027!');
  r = await exporter(jarDeux, 'conducteurs', 'csv');
  test('cabinet 2 ne voit pas les conducteurs du cabinet 1', r.statut === 200 && !r.texte.includes('Tremblay'));
  const csvCab2 = ecrireCsvTmp('import-auto-cab2.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Garage Cab2 inc.;Bob;Lee',
  ]);
  r = await importer(jarDeux, csvCab2);
  test('import cabinet 2 fonctionne', r.texte.includes('créées'));

  // 7. Portefeuille courtier ------------------------------------------------------------
  await creerUtilisateur(jarAdmin, { nom: 'Courtier Test', email: 'courtier@test.ca', role: 'courtier', mdp: 'ImportAuto2026!' });
  const jarCourtier = nouveauJar();
  await connexion(jarCourtier, 'courtier@test.ca', 'ImportAuto2026!');
  await changerMdp(jarCourtier, 'ImportAuto2026!', 'ImportAuto2027!');
  // 7a. Hors portefeuille → ligne en erreur
  const csvHors = ecrireCsvTmp('import-auto-hors.csv', [
    'type;Entreprise;Nom;Prénom;N° de permis',
    'conducteur;Atelier Mécanique Test inc.;Hors;Portefeuille;X1',
  ]);
  r = await importer(jarCourtier, csvHors);
  test('courtier hors portefeuille → erreur ligne', r.texte.includes('hors de votre portefeuille'), 'pas de rejet');
  // 7b. Le courtier crée sa propre entreprise via import → dans son portefeuille
  const csvEntC = ecrireCsvTmp('import-auto-entc.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Garage du Courtier inc.;Carl;Roy',
  ]);
  r = await importer(jarCourtier, csvEntC);
  test('courtier crée son entreprise → ok', r.texte.includes('créées'));
  const csvSoumC = ecrireCsvTmp('import-auto-soumc.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission;Garage du Courtier inc.;2026-07-01;brouillon',
  ]);
  r = await importer(jarCourtier, csvSoumC);
  test('courtier crée sa soumission → ok', r.texte.includes('Soumission auto'));
  const csvCondC = ecrireCsvTmp('import-auto-condc.csv', [
    'type;Entreprise;Nom;Prénom;N° de permis',
    'conducteur;Garage du Courtier inc.;Roy;Carl;C123',
  ]);
  r = await importer(jarCourtier, csvCondC);
  test('courtier importe dans son portefeuille → ok', r.texte.includes('Conducteur Carl Roy ajouté'));

  // 8. Journal d'audit ----------------------------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/journal');
  test('journal contient import_csv', r.texte.includes('import_csv'));

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE', e); process.exit(1); });
