/**
 * scripts/test-import-rc.js — Import CSV étendu RC commerciale (étape 6/10 RC) :
 * nouveaux types (soumission_rc, lieu_rc, garanties_rc, antecedents_rc),
 * modèles téléchargeables, validation stricte, versionnage, portefeuille courtier,
 * cloisonnement inter-cabinets, rapport d'erreurs.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-import-rc.js
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
  console.log('== Import RC commerciale (étape 6/10 RC) ==');

  // 1. Page d'import et modèles ------------------------------------------------
  const jarAdmin = nouveauJar();
  await connexion(jarAdmin, 'admin@demo.ca', 'ChangeMoi123!');
  await changerMdp(jarAdmin, 'ChangeMoi123!', 'ImportRc2026!');

  let r = await req(jarAdmin, 'GET', '/import');
  test('page import → 200', r.statut === 200, `${r.statut}`);
  test('page import mentionne la section RC', r.texte.includes('Import RC'), 'section RC absente');
  test('page import propose 4 modèles RC', ['modele-rc/soumission_rc', 'modele-rc/lieu_rc', 'modele-rc/garanties_rc', 'modele-rc/antecedents_rc'].every((s) => r.texte.includes(s)));

  r = await req(jarAdmin, 'GET', '/import/modele-rc/lieu_rc');
  test('modèle lieu_rc → 200 CSV', r.statut === 200 && r.texte.includes('Sous-traitants'), `${r.statut}`);
  test('modèle lieu_rc avec commentaires #', r.texte.includes('# Modèle'));
  r = await req(jarAdmin, 'GET', '/import/modele-rc/garanties_rc');
  test('modèle garanties_rc contient les avenants', r.texte.includes('pollution') && r.texte.includes('parapluie') && r.texte.includes('Formule de garantie'));
  r = await req(jarAdmin, 'GET', '/import/modele-rc/soumission_rc');
  test('modèle soumission_rc → 200', r.statut === 200 && r.texte.includes('Date d’effet souhaitée'), `${r.statut}`);
  r = await req(jarAdmin, 'GET', '/import/modele-rc/invalide');
  test('modèle inconnu → 404', r.statut === 404, `${r.statut}`);

  // 2. Créer l'entreprise de test via l'import classique ------------------------
  const csvEnt = ecrireCsvTmp('import-rc-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Constructions Méthot inc.;Sylvain;Méthot',
  ]);
  r = await importer(jarAdmin, csvEnt);
  test('import entreprise → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 3. Fichier exemple complet ---------------------------------------------------
  r = await importer(jarAdmin, path.join(__dirname, 'exemple-import-rc.csv'), 'exemple-import-rc.csv');
  const crees = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('exemple : 4 lignes créées', crees === '4', `créées=${crees}`);
  test('exemple : 0 erreur', erreurs === '0', `erreurs=${erreurs}`);

  // 4. Vérification via les exports (miroir) --------------------------------------
  r = await exporter(jarAdmin, 'rc_lieux', 'csv');
  test('export lieux RC → 200', r.statut === 200, `${r.statut}`);
  test('export lieux RC contient l’adresse', r.texte.includes('1200 boul. Industriel'));
  test('export lieux RC : sous-traitants en français', r.texte.includes('Assurés'));
  test('export lieux RC : formule en français', r.texte.includes('Locaux et opérations'));
  test('export lieux RC : avenants importés (pollution=1, parapluie=0)', /;1;0(;|\r)/.test(r.texte.replace(/\r/g, '')));
  r = await exporter(jarAdmin, 'rc_soumissions', 'csv');
  test('export soumissions RC → 200', r.statut === 200, `${r.statut}`);
  const lignesCsv = r.texte.split('\n');
  const idxVersions = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Nb versions');
  const ligneSoum = lignesCsv.find((l) => l.includes('Constructions Méthot'));
  const nbVersions = ligneSoum ? ligneSoum.split(';')[idxVersions] : null;
  // v1 création + 1 lieu + 1 garanties + 1 antécédents = 4
  test('soumission RC versionnée (4 versions)', nbVersions === '4', `nb_versions=${nbVersions}`);

  // 5. Fichier d'erreurs ------------------------------------------------------------
  const csvErr = ecrireCsvTmp('import-rc-erreurs.csv', [
    'type;Entreprise;Soumission (id);Adresse;Adresse du lieu;Lieu (id);Sous-traitants;Formule de garantie;Nb d’employés;Limite par sinistre',
    'lieu_rc;Constructions Méthot inc.;;12 rue Test;;;partiels;;;',
    'lieu_rc;Constructions Méthot inc.;99999;12 rue Test;;;;;;',
    'garanties_rc;Constructions Méthot inc.;;;1200 boul. Industriel;;;formule_inconnue;;',
    'garanties_rc;Constructions Méthot inc.;;;;99999;;;;',
    'lieu_rc;Constructions Méthot inc.;;12 rue Test;;;aucun;;-3;',
    'lieu_rc;Constructions Méthot inc.;;12 rue Test;;;aucun;;;',
  ]);
  r = await importer(jarAdmin, csvErr, 'erreurs-rc.csv');
  const crees2 = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs2 = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('fichier erreurs : 1 créé (ligne valide)', crees2 === '1', `créées=${crees2}`);
  test('fichier erreurs : 5 en erreur', erreurs2 === '5', `erreurs=${erreurs2}`);
  test('erreur sous-traitants invalides détectée', r.texte.includes('sous-traitants invalide'));
  test('erreur soumission RC introuvable détectée', r.texte.includes('soumission RC 99999 introuvable'));
  test('erreur formule invalide détectée', r.texte.includes('formule de garantie invalide'));
  test('erreur lieu introuvable détectée', r.texte.includes('lieu d’exploitation 99999 introuvable'));
  test('erreur nb employés négatif détectée', r.texte.includes('nb d’employés invalide'));

  // 6. Cloisonnement inter-cabinets ---------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/cabinets');
  let r2 = await req(jarAdmin, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Deux' } });
  test('création cabinet 2 → 302', r2.statut === 302, `${r2.statut}`);
  await creerUtilisateur(jarAdmin, { nom: 'User Deux', email: 'deux@test.ca', role: 'admin', mdp: 'ImportRc2026!', cabinetId: 2 });
  const jarDeux = nouveauJar();
  await connexion(jarDeux, 'deux@test.ca', 'ImportRc2026!');
  await changerMdp(jarDeux, 'ImportRc2026!', 'ImportRc2027!');
  r = await exporter(jarDeux, 'rc_lieux', 'csv');
  test('cabinet 2 ne voit pas les lieux du cabinet 1', r.statut === 200 && !r.texte.includes('boul. Industriel'));
  const csvCab2 = ecrireCsvTmp('import-rc-cab2.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Entreprise Cab2 inc.;Bob;Lee',
  ]);
  r = await importer(jarDeux, csvCab2);
  test('import cabinet 2 fonctionne', r.texte.includes('créées'));

  // 7. Portefeuille courtier ------------------------------------------------------------
  await creerUtilisateur(jarAdmin, { nom: 'Courtier RC', email: 'courtier-rc@test.ca', role: 'courtier', mdp: 'ImportRc2026!' });
  const jarCourtier = nouveauJar();
  await connexion(jarCourtier, 'courtier-rc@test.ca', 'ImportRc2026!');
  await changerMdp(jarCourtier, 'ImportRc2026!', 'ImportRc2027!');
  // 7a. Hors portefeuille → ligne en erreur
  const csvHors = ecrireCsvTmp('import-rc-hors.csv', [
    'type;Entreprise;Adresse;Sous-traitants',
    'lieu_rc;Constructions Méthot inc.;99 rue X;aucun',
  ]);
  r = await importer(jarCourtier, csvHors);
  test('courtier hors portefeuille → erreur ligne', r.texte.includes('hors de votre portefeuille'), 'pas de rejet');
  // 7b. Le courtier crée sa propre entreprise via import → dans son portefeuille
  const csvEntC = ecrireCsvTmp('import-rc-entc.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Atelier du Courtier inc.;Carl;Roy',
  ]);
  r = await importer(jarCourtier, csvEntC);
  test('courtier crée son entreprise → ok', r.texte.includes('créées'));
  const csvSoumC = ecrireCsvTmp('import-rc-soumc.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_rc;Atelier du Courtier inc.;2026-10-01;brouillon',
  ]);
  r = await importer(jarCourtier, csvSoumC);
  test('courtier crée sa soumission RC → ok', r.texte.includes('Soumission RC'));
  const csvLieuC = ecrireCsvTmp('import-rc-lieuc.csv', [
    'type;Entreprise;Adresse;Ville;Sous-traitants;Nb d’employés',
    'lieu_rc;Atelier du Courtier inc.;7 rue de l’Atelier;Laval;aucun;5',
  ]);
  r = await importer(jarCourtier, csvLieuC);
  test('courtier importe un lieu dans son portefeuille → ok', r.texte.includes('Lieu 7 rue de l’Atelier ajouté'));

  // 8. Journal d'audit ----------------------------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/journal');
  test('journal contient import_csv', r.texte.includes('import_csv'));

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE', e); process.exit(1); });
