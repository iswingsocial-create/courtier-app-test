/**
 * scripts/test-import-flotte.js — Import CSV étendu flotte automobile (étape 6/10 flotte) :
 * 5 types (soumission_flotte, vehicule_flotte, conducteur_flotte, garanties_flotte,
 * antecedents_flotte — la flotte a DEUX lignes illimitées, d'où 5 types au lieu des
 * 4 du pattern PE), modèles téléchargeables, validation stricte, versionnage,
 * portefeuille courtier, cloisonnement inter-cabinets, rapport d'erreurs,
 * mappings libellés FR, round-trip export→import.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-import-flotte.js
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
function colonne(lignesCsv, nom) {
  return lignesCsv[0].split(';').findIndex((h) => h.trim() === nom);
}

(async () => {
  console.log('== Import flotte automobile (étape 6/10 flotte) ==');

  // 1. Page d'import et modèles ------------------------------------------------
  const jarAdmin = nouveauJar();
  await connexion(jarAdmin, 'admin@demo.ca', 'ChangeMoi123!');
  await changerMdp(jarAdmin, 'ChangeMoi123!', 'ImportFlotte2026!');

  let r = await req(jarAdmin, 'GET', '/import');
  test('page import → 200', r.statut === 200, `${r.statut}`);
  test('page import mentionne la section flotte automobile', r.texte.includes('Import flotte automobile'), 'section flotte absente');
  test('page import propose 5 modèles flotte', ['modele-flotte/soumission_flotte', 'modele-flotte/vehicule_flotte', 'modele-flotte/conducteur_flotte', 'modele-flotte/garanties_flotte', 'modele-flotte/antecedents_flotte'].every((s) => r.texte.includes(s)));

  r = await req(jarAdmin, 'GET', '/import/modele-flotte/vehicule_flotte');
  test('modèle vehicule_flotte → 200 CSV', r.statut === 200 && r.texte.includes('Type de véhicule'), `${r.statut}`);
  test('modèle vehicule_flotte avec commentaires #', r.texte.includes('# Modèle'));
  r = await req(jarAdmin, 'GET', '/import/modele-flotte/conducteur_flotte');
  test('modèle conducteur_flotte contient sinistres et infractions', r.texte.includes('Sinistres 5 ans') && r.texte.includes('Infractions 3 ans'), 'champs absents');
  r = await req(jarAdmin, 'GET', '/import/modele-flotte/soumission_flotte');
  test('modèle soumission_flotte → 200', r.statut === 200 && r.texte.includes('Usage dominant'), `${r.statut}`);
  r = await req(jarAdmin, 'GET', '/import/modele-flotte/garanties_flotte');
  test('modèle garanties_flotte → 200', r.statut === 200 && r.texte.includes('Limite RC') && r.texte.includes('FAQ 43'), `${r.statut}`);
  r = await req(jarAdmin, 'GET', '/import/modele-flotte/antecedents_flotte');
  test('modèle antecedents_flotte → 200', r.statut === 200 && r.texte.includes('Sinistres flotte 5 ans'), `${r.statut}`);
  r = await req(jarAdmin, 'GET', '/import/modele-flotte/invalide');
  test('modèle inconnu → 404', r.statut === 404, `${r.statut}`);

  // 2. Créer l'entreprise de test via l'import classique ------------------------
  const csvEnt = ecrireCsvTmp('import-flotte-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Transport Lapointe inc.;Jean-François;Lapointe',
  ]);
  r = await importer(jarAdmin, csvEnt);
  test('import entreprise → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 3. Fichier exemple complet (5 types) ------------------------------------------
  r = await importer(jarAdmin, path.join(__dirname, 'exemple-import-flotte.csv'), 'exemple-import-flotte.csv');
  const crees = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('exemple : 5 lignes créées', crees === '5', `créées=${crees}`);
  test('exemple : 0 erreur', erreurs === '0', `erreurs=${erreurs}`);

  // 4. Vérification via les exports (miroir) --------------------------------------
  r = await exporter(jarAdmin, 'flotte_vehicules', 'csv');
  test('export véhicules flotte → 200', r.statut === 200, `${r.statut}`);
  test('export véhicules : Transit 250', r.texte.includes('Transit 250'));
  test('export véhicules : type en libellé FR', r.texte.includes('Camion'));
  test('export véhicules : conducteur principal lié (Marc Gagnon)', r.texte.includes('Marc Gagnon'));
  test('export véhicules : équipement spécial importé', r.texte.includes('Hayon élévateur'));
  r = await exporter(jarAdmin, 'flotte_conducteurs', 'csv');
  test('export conducteurs flotte → 200', r.statut === 200, `${r.statut}`);
  const lignesCond = r.texte.split('\n');
  const ligneGagnon = lignesCond.find((l) => l.includes('Gagnon'));
  test('export conducteurs : nb sinistres 5 ans = 1', ligneGagnon && ligneGagnon.split(';')[colonne(lignesCond, 'Nb sinistres 5 ans')] === '1', 'colonne absente');
  test('export conducteurs : nb infractions 3 ans = 1', ligneGagnon && ligneGagnon.split(';')[colonne(lignesCond, 'Nb infractions 3 ans')] === '1', 'colonne absente');
  r = await exporter(jarAdmin, 'flotte_soumissions', 'csv');
  test('export soumissions flotte → 200', r.statut === 200, `${r.statut}`);
  test('export soumissions : usage dominant en libellé FR', r.texte.includes('Livraison') && !r.texte.includes(';livraison;'));
  test('export soumissions : limite RC importée', r.texte.includes('2000000'));
  test('export soumissions : avenants FAQ importés (1;1;1;1;0)', /;1;1;1;1;0(;|\r)/.test(r.texte.replace(/\r/g, '')), 'avenants absents');
  const lignesCsv = r.texte.split('\n');
  const ligneSoum = lignesCsv.find((l) => l.includes('Transport Lapointe'));
  test('soumission flotte versionnée (5 versions)', ligneSoum && ligneSoum.split(';')[colonne(lignesCsv, 'Nb versions')] === '5', 'nb_versions incorrect');
  test('export soumissions : nb sinistres flotte 5 ans = 1', ligneSoum && ligneSoum.split(';')[colonne(lignesCsv, 'Nb sinistres flotte 5 ans')] === '1', 'colonne absente');
  test('export soumissions : ratio de pertes importé', ligneSoum && ligneSoum.includes('18.5'), 'ratio absent');

  // 4b. En-tête avec apostrophe courbe + avenants par libellés ----------------------
  const csvApo = ecrireCsvTmp('import-flotte-apo.csv', [
    'type;Entreprise;Date d\u2019effet souhaitée;Usage dominant',
    'soumission_flotte;Transport Lapointe inc.;2027-02-01;Service',
  ]);
  r = await importer(jarAdmin, csvApo, 'apo.csv');
  test('apostrophe courbe reconnue → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  // Avenants donnés par libellés FR dans la colonne « Avenants » (séparés par
  // des virgules, la cellule est entre guillemets car « ; » est le séparateur CSV).
  const csvAvLib2 = ecrireCsvTmp('import-flotte-avlib2.csv', [
    'type;Entreprise;Avenants',
    'garanties_flotte;Transport Lapointe inc.;"valeur à neuf, FAQ 20, crédit-bail"',
  ]);
  r = await importer(jarAdmin, csvAvLib2, 'avlib.csv');
  test('avenants par libellés FR → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  r = await exporter(jarAdmin, 'flotte_soumissions', 'csv');
  const ligneApo = r.texte.split('\n').find((l) => l.includes('2027-02-01'));
  test('avenants par libellés exportés (faq43=1, faq20=1, faq5a=1)', !!ligneApo && /;1;1;0;0;1(;|\r)/.test(ligneApo.replace(/\r/g, '')), 'avenants libellés absents');

  // 5. Fichier d'erreurs ------------------------------------------------------------
  const csvEnt2 = ecrireCsvTmp('import-flotte-ent2.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Déménagement Rapide inc.;Alain;Fortin',
  ]);
  r = await importer(jarAdmin, csvEnt2);
  test('entreprise Déménagement Rapide → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvSoum2 = ecrireCsvTmp('import-flotte-soum2.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_flotte;Déménagement Rapide inc.;2026-11-01;brouillon',
  ]);
  r = await importer(jarAdmin, csvSoum2);
  test('soumission Déménagement Rapide → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées') && r.texte.includes('Soumission flotte'), `${r.statut}`);
  const csvErr = ecrireCsvTmp('import-flotte-erreurs.csv', [
    'type;Entreprise;Soumission (id);Nom;Prénom;Marque;Modèle;Type de véhicule;Valeur;Limite RC;Date d’effet souhaitée;Sinistres flotte 5 ans',
    'conducteur_flotte;Déménagement Rapide inc.;;;;;;;;;;;',
    'vehicule_flotte;Déménagement Rapide inc.;;;;;;;;;;;',
    'vehicule_flotte;Déménagement Rapide inc.;;;;Ford;Transit;hélicoptère;;;;',
    'vehicule_flotte;Déménagement Rapide inc.;;;;Ford;Transit;;-500;;;',
    'garanties_flotte;Déménagement Rapide inc.;;;;;;;;-100;;',
    'soumission_flotte;Déménagement Rapide inc.;;;;;;;;;2026-13-45;',
    'vehicule_flotte;Déménagement Rapide inc.;99999;;;Ford;Transit;;;;',
    'antecedents_flotte;Déménagement Rapide inc.;;;;;;;;;;2023-06-15|Collision|abc',
    'conducteur_flotte;Déménagement Rapide inc.;;Victor;Valide;;;;;;;',
  ]);
  r = await importer(jarAdmin, csvErr, 'erreurs-flotte.csv');
  const crees2 = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs2 = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('fichier erreurs : 1 créé (ligne valide)', crees2 === '1', `créées=${crees2}`);
  test('fichier erreurs : 8 en erreur', erreurs2 === '8', `erreurs=${erreurs2}`);
  test('erreur nom et prénom du conducteur requis détectée', r.texte.includes('nom et prénom du conducteur requis'));
  test('erreur marque et modèle requis détectée', r.texte.includes('marque et modèle requis'));
  test('erreur type de véhicule invalide détectée', r.texte.includes('type de véhicule invalide'));
  test('erreur valeur négative détectée', r.texte.includes('valeur invalide'));
  test('erreur limite RC négative détectée', r.texte.includes('limite RC invalide'));
  test('erreur date invalide détectée', r.texte.includes('date d’effet souhaitée invalide'));
  test('erreur soumission flotte introuvable détectée', r.texte.includes('soumission flotte 99999 introuvable'));
  test('erreur montant sinistre flotte invalide détectée', r.texte.includes('sinistres flotte 5 ans : montant invalide'));

  // 6. Round-trip export→import : les libellés FR des exports sont reconnus --------
  const csvRtEnt = ecrireCsvTmp('import-flotte-rt-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;RT Flotte inc.;René;Turcotte',
  ]);
  r = await importer(jarAdmin, csvRtEnt);
  test('round-trip : entreprise RT créée', r.texte.includes('créées'));
  const csvRt = ecrireCsvTmp('import-flotte-rt.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut;Usage dominant;Rayon d’opération (km)',
    'soumission_flotte;RT Flotte inc.;2027-01-15;brouillon;Transport de marchandises;250',
  ]);
  r = await importer(jarAdmin, csvRt);
  test('round-trip : soumission avec usage dominant en libellé FR → créée', r.texte.includes('Soumission flotte'));
  const csvRt2 = ecrireCsvTmp('import-flotte-rt2.csv', [
    'type;Entreprise;NIV;Année;Marque;Modèle;Type de véhicule;Usage;Valeur;Conducteur principal;Équipements spéciaux (JSON)',
    'vehicule_flotte;RT Flotte inc.;3C6TRVBG8ME512340;2021;Ram;ProMaster 3500;Camion;Transport de marchandises;54000;Selon affectation;"[{""description"":""Compartiment réfrigéré"",""valeur"":12000}]"',
  ]);
  r = await importer(jarAdmin, csvRt2);
  test('round-trip : véhicule avec libellés FR et équipements JSON → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvRt3 = ecrireCsvTmp('import-flotte-rt3.csv', [
    'type;Entreprise;Limite RC;Franchise collision;Franchise versement;Prime;Avenant FAQ 43 (valeur à neuf);Avenant FAQ 20 (privation de jouissance);Avenant FAQ 27 (véhicule non appartenant);Avenant FAQ 34 (assurance de personnes);Avenant FAQ 5a (crédit-bail)',
    'garanties_flotte;RT Flotte inc.;1000000;500;500;4200;non;non;oui;non;non',
  ]);
  r = await importer(jarAdmin, csvRt3);
  test('round-trip : garanties avec en-têtes exports → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvRt4 = ecrireCsvTmp('import-flotte-rt4.csv', [
    'type;Entreprise;Assureur actuel;Police actuelle;Années d’assurance flotte continue;Sinistres flotte 5 ans;Ratio de pertes (%);Refus ou annulation antérieur;Consentement crédit;Consentement dossier SAAQ;Consentement FCSA',
    'antecedents_flotte;RT Flotte inc.;Assureur RT;RT-200;5;2024-01-20|Collision avec un chevreuil|7300;12;non;oui;oui;non',
  ]);
  r = await importer(jarAdmin, csvRt4);
  test('round-trip : antécédents avec en-têtes exports → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  r = await exporter(jarAdmin, 'flotte_vehicules', 'csv');
  test('round-trip : véhicule « ProMaster 3500 » exporté', r.texte.includes('ProMaster 3500'));
  test('round-trip : usage « Transport de marchandises » exporté', r.texte.includes('Transport de marchandises'));
  test('round-trip : équipement JSON réexporté', r.texte.includes('Compartiment réfrigéré'));
  test('round-trip : conducteur principal libre exporté', r.texte.includes('Selon affectation'));
  r = await exporter(jarAdmin, 'flotte_soumissions', 'csv');
  test('round-trip : usage dominant en libellé FR exporté', r.texte.includes('RT Flotte inc.') && r.texte.includes('Transport de marchandises'));

  // 7. Règle d'or : aucun DELETE sur flotte_* (vérification statique) ---------------
  const srcImport = fs.readFileSync(path.join(__dirname, '..', 'routes', 'import.js'), 'utf8');
  const srcFlotte = fs.readFileSync(path.join(__dirname, '..', 'lib', 'flotte.js'), 'utf8');
  test('règle d’or : aucun DELETE FROM flotte_ dans routes/import.js', !/DELETE\s+FROM\s+flotte_/i.test(srcImport));
  test('règle d’or : aucun DELETE FROM flotte_ dans lib/flotte.js', !/DELETE\s+FROM\s+flotte_/i.test(srcFlotte));

  // 8. Cloisonnement inter-cabinets ---------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/cabinets');
  let r2 = await req(jarAdmin, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Deux' } });
  test('création cabinet 2 → 302', r2.statut === 302, `${r2.statut}`);
  await creerUtilisateur(jarAdmin, { nom: 'User Deux', email: 'deux-flotte@test.ca', role: 'admin', mdp: 'ImportFlotte2026!', cabinetId: 2 });
  const jarDeux = nouveauJar();
  await connexion(jarDeux, 'deux-flotte@test.ca', 'ImportFlotte2026!');
  await changerMdp(jarDeux, 'ImportFlotte2026!', 'ImportFlotte2027!');
  r = await exporter(jarDeux, 'flotte_vehicules', 'csv');
  test('cabinet 2 ne voit pas les véhicules du cabinet 1', r.statut === 200 && !r.texte.includes('Transit 250'));
  const csvCab2 = ecrireCsvTmp('import-flotte-cab2.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Entreprise Cab2 inc.;Bob;Lee',
  ]);
  r = await importer(jarDeux, csvCab2);
  test('import cabinet 2 fonctionne', r.texte.includes('créées'));

  // 9. Portefeuille courtier ------------------------------------------------------------
  await creerUtilisateur(jarAdmin, { nom: 'Courtier Flotte', email: 'courtier-flotte@test.ca', role: 'courtier', mdp: 'ImportFlotte2026!' });
  const jarCourtier = nouveauJar();
  await connexion(jarCourtier, 'courtier-flotte@test.ca', 'ImportFlotte2026!');
  await changerMdp(jarCourtier, 'ImportFlotte2026!', 'ImportFlotte2027!');
  // 9a. Hors portefeuille → ligne en erreur
  const csvHors = ecrireCsvTmp('import-flotte-hors.csv', [
    'type;Entreprise;Nom;Prénom',
    'conducteur_flotte;Transport Lapointe inc.;Hors;Portefeuille',
  ]);
  r = await importer(jarCourtier, csvHors);
  test('courtier hors portefeuille → erreur ligne', r.texte.includes('hors de votre portefeuille'), 'pas de rejet');
  // 9b. Le courtier crée sa propre entreprise via import → dans son portefeuille
  const csvEntC = ecrireCsvTmp('import-flotte-entc.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Flotte du Courtier inc.;Carl;Roy',
  ]);
  r = await importer(jarCourtier, csvEntC);
  test('courtier crée son entreprise → ok', r.texte.includes('créées'));
  const csvSoumC = ecrireCsvTmp('import-flotte-soumc.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut;Usage dominant',
    'soumission_flotte;Flotte du Courtier inc.;2026-10-01;brouillon;service',
  ]);
  r = await importer(jarCourtier, csvSoumC);
  test('courtier crée sa soumission flotte → ok', r.texte.includes('Soumission flotte'));
  const csvCondC = ecrireCsvTmp('import-flotte-condc.csv', [
    'type;Entreprise;Nom;Prénom;Classe de permis',
    'conducteur_flotte;Flotte du Courtier inc.;Roy;Carl;5',
  ]);
  r = await importer(jarCourtier, csvCondC);
  test('courtier importe un conducteur dans son portefeuille → ok', r.texte.includes('Conducteur Carl Roy ajouté'));

  // 10. Journal d'audit ----------------------------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/journal');
  test('journal contient import_csv', r.texte.includes('import_csv'));

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE', e); process.exit(1); });
