/**
 * scripts/test-import-cyber.js — Import CSV étendu cyber / cyberrisques (étape 6/10 cyber) :
 * nouveaux types (soumission_cyber, mesure_cyber, garanties_cyber, antecedents_cyber),
 * modèles téléchargeables, validation stricte, versionnage, portefeuille courtier,
 * cloisonnement inter-cabinets, rapport d'erreurs.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-import-cyber.js
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
  console.log('== Import cyber / cyberrisques (étape 6/10 cyber) ==');

  // 1. Page d'import et modèles ------------------------------------------------
  const jarAdmin = nouveauJar();
  await connexion(jarAdmin, 'admin@demo.ca', 'ChangeMoi123!');
  await changerMdp(jarAdmin, 'ChangeMoi123!', 'ImportCyber2026!');

  let r = await req(jarAdmin, 'GET', '/import');
  test('page import → 200', r.statut === 200, `${r.statut}`);
  test('page import mentionne la section cyber', r.texte.includes('Import cyber'), 'section cyber absente');
  test('page import propose 4 modèles cyber', ['modele-cyber/soumission_cyber', 'modele-cyber/mesure_cyber', 'modele-cyber/garanties_cyber', 'modele-cyber/antecedents_cyber'].every((s) => r.texte.includes(s)));

  r = await req(jarAdmin, 'GET', '/import/modele-cyber/mesure_cyber');
  test('modèle mesure_cyber → 200 CSV', r.statut === 200 && r.texte.includes('Type de mesure'), `${r.statut}`);
  test('modèle mesure_cyber avec commentaires #', r.texte.includes('# Modèle'));
  test('modèle mesure_cyber liste les types', r.texte.includes('formation_hameconnage'));
  r = await req(jarAdmin, 'GET', '/import/modele-cyber/garanties_cyber');
  test('modèle garanties_cyber contient les avenants', r.texte.includes('rançongiciel') && r.texte.includes('interruption') && r.texte.includes('Délai de carence'));
  r = await req(jarAdmin, 'GET', '/import/modele-cyber/soumission_cyber');
  test('modèle soumission_cyber → 200', r.statut === 200 && r.texte.includes('Date d’effet souhaitée'), `${r.statut}`);
  r = await req(jarAdmin, 'GET', '/import/modele-cyber/invalide');
  test('modèle inconnu → 404', r.statut === 404, `${r.statut}`);

  // 2. Créer l'entreprise de test via l'import classique ------------------------
  const csvEnt = ecrireCsvTmp('import-cyber-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Clinique Dentaire Bouchard inc.;Luc;Bouchard',
  ]);
  r = await importer(jarAdmin, csvEnt);
  test('import entreprise → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 3. Fichier exemple complet ---------------------------------------------------
  r = await importer(jarAdmin, path.join(__dirname, 'exemple-import-cyber.csv'), 'exemple-import-cyber.csv');
  const crees = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('exemple : 4 lignes créées', crees === '4', `créées=${crees}`);
  test('exemple : 0 erreur', erreurs === '0', `erreurs=${erreurs}`);

  // 4. Vérification via les exports (miroir) --------------------------------------
  r = await exporter(jarAdmin, 'cyber_mesures', 'csv');
  test('export mesures cyber → 200', r.statut === 200, `${r.statut}`);
  test('export mesures : type en français', r.texte.includes('MFA — authentification multifacteur'));
  test('export mesures : maturité en français', r.texte.includes('En place'));
  r = await exporter(jarAdmin, 'cyber_soumissions', 'csv');
  test('export soumissions cyber → 200', r.statut === 200, `${r.statut}`);
  test('export soumissions : carence', r.texte.includes('8 heures'));
  test('export soumissions : avenants importés (rancongiciel=1, fraude=0)', /;1;0(;|\r)/.test(r.texte.replace(/\r/g, '')));
  const lignesCsv = r.texte.split('\n');
  const idxVersions = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Nb versions');
  const ligneSoum = lignesCsv.find((l) => l.includes('Clinique Dentaire Bouchard'));
  const nbVersions = ligneSoum ? ligneSoum.split(';')[idxVersions] : null;
  // v1 création + 1 mesure + 1 garanties + 1 antécédents = 4
  test('soumission cyber versionnée (4 versions)', nbVersions === '4', `nb_versions=${nbVersions}`);

  // 4b. En-tête avec apostrophe droite (bug racine corrigé étape 6 RC) -----------
  const csvApo = ecrireCsvTmp('import-cyber-apo.csv', [
    'type;Entreprise;Avenant — interruption d\u2019activité',
    'garanties_cyber;Clinique Dentaire Bouchard inc.;oui',
  ]);
  r = await importer(jarAdmin, csvApo, 'apo.csv');
  test('apostrophe courbe reconnue → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 5. Fichier d'erreurs ------------------------------------------------------------
  const csvErr = ecrireCsvTmp('import-cyber-erreurs.csv', [
    'type;Entreprise;Soumission (id);Type de mesure;Maturité;Limite par sinistre;Date d’effet souhaitée;Incidents cyber 5 ans',
    'mesure_cyber;Clinique Dentaire Bouchard inc.;;type_inconnu;en_place;;;',
    'mesure_cyber;Clinique Dentaire Bouchard inc.;;mfa;maturite_fausse;;;',
    'garanties_cyber;Clinique Dentaire Bouchard inc.;;;;-5000;;',
    'soumission_cyber;Clinique Dentaire Bouchard inc.;;;;;2026-13-45;',
    'mesure_cyber;Clinique Dentaire Bouchard inc.;99999;mfa;en_place;;;',
    'antecedents_cyber;Clinique Dentaire Bouchard inc.;;;;;;2024-02-11|Rançongiciel|abc',
    'mesure_cyber;Clinique Dentaire Bouchard inc.;;sauvegardes;partiel;;;',
  ]);
  r = await importer(jarAdmin, csvErr, 'erreurs-cyber.csv');
  const crees2 = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs2 = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('fichier erreurs : 1 créé (ligne valide)', crees2 === '1', `créées=${crees2}`);
  test('fichier erreurs : 6 en erreur', erreurs2 === '6', `erreurs=${erreurs2}`);
  test('erreur type de mesure invalide détectée', r.texte.includes('type de mesure invalide'));
  test('erreur maturité invalide détectée', r.texte.includes('maturité invalide'));
  test('erreur limite par sinistre négative détectée', r.texte.includes('limite par sinistre invalide'));
  test('erreur date invalide détectée', r.texte.includes('date d’effet souhaitée invalide'));
  test('erreur soumission cyber introuvable détectée', r.texte.includes('soumission cyber 99999 introuvable'));
  test('erreur montant incident invalide détectée', r.texte.includes('montant invalide'));

  // 6. Cloisonnement inter-cabinets ---------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/cabinets');
  let r2 = await req(jarAdmin, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Deux' } });
  test('création cabinet 2 → 302', r2.statut === 302, `${r2.statut}`);
  await creerUtilisateur(jarAdmin, { nom: 'User Deux', email: 'deux@test.ca', role: 'admin', mdp: 'ImportCyber2026!', cabinetId: 2 });
  const jarDeux = nouveauJar();
  await connexion(jarDeux, 'deux@test.ca', 'ImportCyber2026!');
  await changerMdp(jarDeux, 'ImportCyber2026!', 'ImportCyber2027!');
  r = await exporter(jarDeux, 'cyber_mesures', 'csv');
  test('cabinet 2 ne voit pas les mesures du cabinet 1', r.statut === 200 && !r.texte.includes('Bouchard'));
  const csvCab2 = ecrireCsvTmp('import-cyber-cab2.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Entreprise Cab2 inc.;Bob;Lee',
  ]);
  r = await importer(jarDeux, csvCab2);
  test('import cabinet 2 fonctionne', r.texte.includes('créées'));

  // 7. Portefeuille courtier ------------------------------------------------------------
  await creerUtilisateur(jarAdmin, { nom: 'Courtier Cyber', email: 'courtier-cyber@test.ca', role: 'courtier', mdp: 'ImportCyber2026!' });
  const jarCourtier = nouveauJar();
  await connexion(jarCourtier, 'courtier-cyber@test.ca', 'ImportCyber2026!');
  await changerMdp(jarCourtier, 'ImportCyber2026!', 'ImportCyber2027!');
  // 7a. Hors portefeuille → ligne en erreur
  const csvHors = ecrireCsvTmp('import-cyber-hors.csv', [
    'type;Entreprise;Type de mesure;Maturité',
    'mesure_cyber;Clinique Dentaire Bouchard inc.;mfa;en_place',
  ]);
  r = await importer(jarCourtier, csvHors);
  test('courtier hors portefeuille → erreur ligne', r.texte.includes('hors de votre portefeuille'), 'pas de rejet');
  // 7b. Le courtier crée sa propre entreprise via import → dans son portefeuille
  const csvEntC = ecrireCsvTmp('import-cyber-entc.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Cabinet du Courtier inc.;Carl;Roy',
  ]);
  r = await importer(jarCourtier, csvEntC);
  test('courtier crée son entreprise → ok', r.texte.includes('créées'));
  const csvSoumC = ecrireCsvTmp('import-cyber-soumc.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_cyber;Cabinet du Courtier inc.;2026-10-01;brouillon',
  ]);
  r = await importer(jarCourtier, csvSoumC);
  test('courtier crée sa soumission cyber → ok', r.texte.includes('Soumission cyber'));
  const csvMesC = ecrireCsvTmp('import-cyber-mesc.csv', [
    'type;Entreprise;Type de mesure;Maturité;Détails de la mesure',
    'mesure_cyber;Cabinet du Courtier inc.;pare_feu;prevu;Pare-feu en préparation',
  ]);
  r = await importer(jarCourtier, csvMesC);
  test('courtier importe une mesure dans son portefeuille → ok', r.texte.includes('Mesure pare_feu ajoutée'));

  // 8. Journal d'audit ----------------------------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/journal');
  test('journal contient import_csv', r.texte.includes('import_csv'));

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE', e); process.exit(1); });
