/**
 * scripts/test-import-biens.js — Import CSV étendu biens commerciaux (étape 6/10 biens) :
 * nouveaux types (soumission_biens, batiment, contenu, garanties_biens, antecedents_biens),
 * modèles téléchargeables, validation stricte, versionnage, portefeuille courtier,
 * cloisonnement inter-cabinets, rapport d'erreurs.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-import-biens.js
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
  console.log('== Import biens commerciaux (étape 6/10 biens) ==');

  // 1. Page d'import et modèles ------------------------------------------------
  const jarAdmin = nouveauJar();
  await connexion(jarAdmin, 'admin@demo.ca', 'ChangeMoi123!');
  await changerMdp(jarAdmin, 'ChangeMoi123!', 'ImportBiens2026!');

  let r = await req(jarAdmin, 'GET', '/import');
  test('page import → 200', r.statut === 200, `${r.statut}`);
  test('page import mentionne la section biens', r.texte.includes('Import biens'), 'section biens absente');
  test('page import propose 5 modèles biens', ['modele-biens/soumission_biens', 'modele-biens/batiment', 'modele-biens/contenu', 'modele-biens/garanties_biens', 'modele-biens/antecedents_biens'].every((s) => r.texte.includes(s)));

  r = await req(jarAdmin, 'GET', '/import/modele-biens/batiment');
  test('modèle batiment → 200 CSV', r.statut === 200 && r.texte.includes('Type de construction'), `${r.statut}`);
  test('modèle batiment avec commentaires #', r.texte.includes('# Modèle'));
  r = await req(jarAdmin, 'GET', '/import/modele-biens/garanties_biens');
  test('modèle garanties contient les avenants', r.texte.includes('tremblement de terre') && r.texte.includes('Formule'));
  r = await req(jarAdmin, 'GET', '/import/modele-biens/invalide');
  test('modèle inconnu → 404', r.statut === 404, `${r.statut}`);

  // 2. Créer l'entreprise de test via l'import classique ------------------------
  const csvEnt = ecrireCsvTmp('import-biens-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Immeubles Rigaud inc.;Réal;Rigaud',
  ]);
  r = await importer(jarAdmin, csvEnt);
  test('import entreprise → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 3. Fichier exemple complet ---------------------------------------------------
  r = await importer(jarAdmin, path.join(__dirname, 'exemple-import-biens.csv'), 'exemple-import-biens.csv');
  const crees = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('exemple : 7 lignes créées', crees === '7', `créées=${crees}`);
  test('exemple : 0 erreur', erreurs === '0', `erreurs=${erreurs}`);

  // 4. Vérification via les exports (miroir) --------------------------------------
  r = await exporter(jarAdmin, 'biens_batiments', 'csv');
  test('export bâtiments → 200', r.statut === 200, `${r.statut}`);
  test('export bâtiments contient les 2 adresses', r.texte.includes('4500 boul. Saint-Laurent') && r.texte.includes('120 rue Principale'));
  test('export bâtiments : type de construction importé', r.texte.includes('beton'));
  test('export bâtiments : en-têtes avenants (miroir)', r.texte.includes('Avenant — tremblement de terre'));
  test('export bâtiments : avenants importés (tremblement+inondation = 1)', /1;1;0;0;0/.test(r.texte.replace(/\r/g, '')));
  test('export bâtiments : formule en français', r.texte.includes('Tous risques'));
  r = await exporter(jarAdmin, 'biens_contenus', 'csv');
  test('export contenus → 200 avec les 2 contenus', r.statut === 200 && r.texte.includes('Mobilier de bureau') && r.texte.includes('Améliorations locatives'), `${r.statut}`);
  test('export contenus : contenu général marqué', r.texte.includes('Contenu général'));
  r = await exporter(jarAdmin, 'biens_soumissions', 'csv');
  test('export soumissions → 200', r.statut === 200, `${r.statut}`);
  const lignesCsv = r.texte.split('\n');
  const idxVersions = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Nb versions');
  const ligneSoum = lignesCsv.find((l) => l.includes('Immeubles Rigaud'));
  const nbVersions = ligneSoum ? ligneSoum.split(';')[idxVersions] : null;
  // v1 création + 2 bâtiments + 2 contenus + 1 garanties + 1 antécédents = 7
  test('soumission versionnée (7 versions)', nbVersions === '7', `nb_versions=${nbVersions}`);

  // 5. Fichier d'erreurs ------------------------------------------------------------
  const csvErr = ecrireCsvTmp('import-biens-erreurs.csv', [
    'type;Entreprise;Soumission (id);Adresse;Adresse du bâtiment;Bâtiment (id);Type de construction;Superficie (pi²);Formule;Type de contenu;Description',
    'batiment;Immeubles Rigaud inc.;;12 rue Test;;;chalet;;;;',
    'batiment;Immeubles Rigaud inc.;99999;12 rue Test;;;beton;;;;',
    'garanties_biens;Immeubles Rigaud inc.;;;4500 boul. Saint-Laurent;;;;risques_inconnus;;',
    'contenu;Immeubles Rigaud inc.;;;;99999;;;;;',
    'batiment;Immeubles Rigaud inc.;;12 rue Test;;;beton;-5;;;;',
    'contenu;Immeubles Rigaud inc.;;;4500 boul. Saint-Laurent;;;;;meubles;Bureau',
  ]);
  r = await importer(jarAdmin, csvErr, 'erreurs-biens.csv');
  const crees2 = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs2 = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('fichier erreurs : 0 créé', crees2 === '0', `créées=${crees2}`);
  test('fichier erreurs : 6 en erreur', erreurs2 === '6', `erreurs=${erreurs2}`);
  test('erreur type de construction invalide détectée', r.texte.includes('type de construction invalide'));
  test('erreur soumission biens introuvable détectée', r.texte.includes('soumission biens 99999 introuvable'));
  test('erreur formule invalide détectée', r.texte.includes('formule invalide'));
  test('erreur bâtiment introuvable détectée', r.texte.includes('bâtiment 99999 introuvable'));
  test('erreur superficie négative détectée', r.texte.includes('superficie (pi²) invalide'));
  test('erreur type de contenu invalide détectée', r.texte.includes('type de contenu invalide'));

  // 6. Cloisonnement inter-cabinets ---------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/cabinets');
  let r2 = await req(jarAdmin, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Deux' } });
  test('création cabinet 2 → 302', r2.statut === 302, `${r2.statut}`);
  await creerUtilisateur(jarAdmin, { nom: 'User Deux', email: 'deux@test.ca', role: 'admin', mdp: 'ImportBiens2026!', cabinetId: 2 });
  const jarDeux = nouveauJar();
  await connexion(jarDeux, 'deux@test.ca', 'ImportBiens2026!');
  await changerMdp(jarDeux, 'ImportBiens2026!', 'ImportBiens2027!');
  r = await exporter(jarDeux, 'biens_batiments', 'csv');
  test('cabinet 2 ne voit pas les bâtiments du cabinet 1', r.statut === 200 && !r.texte.includes('Saint-Laurent'));
  const csvCab2 = ecrireCsvTmp('import-biens-cab2.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Immeubles Cab2 inc.;Bob;Lee',
  ]);
  r = await importer(jarDeux, csvCab2);
  test('import cabinet 2 fonctionne', r.texte.includes('créées'));

  // 7. Portefeuille courtier ------------------------------------------------------------
  await creerUtilisateur(jarAdmin, { nom: 'Courtier Biens', email: 'courtier-biens@test.ca', role: 'courtier', mdp: 'ImportBiens2026!' });
  const jarCourtier = nouveauJar();
  await connexion(jarCourtier, 'courtier-biens@test.ca', 'ImportBiens2026!');
  await changerMdp(jarCourtier, 'ImportBiens2026!', 'ImportBiens2027!');
  // 7a. Hors portefeuille → ligne en erreur
  const csvHors = ecrireCsvTmp('import-biens-hors.csv', [
    'type;Entreprise;Adresse;Type de construction',
    'batiment;Immeubles Rigaud inc.;99 rue X;beton',
  ]);
  r = await importer(jarCourtier, csvHors);
  test('courtier hors portefeuille → erreur ligne', r.texte.includes('hors de votre portefeuille'), 'pas de rejet');
  // 7b. Le courtier crée sa propre entreprise via import → dans son portefeuille
  const csvEntC = ecrireCsvTmp('import-biens-entc.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Entrepôt du Courtier inc.;Carl;Roy',
  ]);
  r = await importer(jarCourtier, csvEntC);
  test('courtier crée son entreprise → ok', r.texte.includes('créées'));
  const csvSoumC = ecrireCsvTmp('import-biens-soumc.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_biens;Entrepôt du Courtier inc.;2026-10-01;brouillon',
  ]);
  r = await importer(jarCourtier, csvSoumC);
  test('courtier crée sa soumission biens → ok', r.texte.includes('Soumission biens'));
  const csvBatC = ecrireCsvTmp('import-biens-batc.csv', [
    'type;Entreprise;Adresse;Ville;Type de construction;Année de construction;Valeur du bâtiment',
    'batiment;Entrepôt du Courtier inc.;7 rue du Dépôt;Laval;acier;2005;900000',
  ]);
  r = await importer(jarCourtier, csvBatC);
  test('courtier importe un bâtiment dans son portefeuille → ok', r.texte.includes('Bâtiment 7 rue du Dépôt ajouté'));

  // 8. Journal d'audit ----------------------------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/journal');
  test('journal contient import_csv', r.texte.includes('import_csv'));

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE', e); process.exit(1); });
