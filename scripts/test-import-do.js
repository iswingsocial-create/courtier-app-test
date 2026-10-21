/**
 * scripts/test-import-do.js — Import CSV étendu D&O / administrateurs et dirigeants (étape 6/10 D&O) :
 * nouveaux types (soumission_do, dirigeant_do, garanties_do, antecedents_do),
 * modèles téléchargeables, validation stricte, versionnage, portefeuille courtier,
 * cloisonnement inter-cabinets, rapport d'erreurs, round-trip export→import.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-import-do.js
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
  console.log('== Import D&O / administrateurs et dirigeants (étape 6/10 D&O) ==');

  // 1. Page d'import et modèles ------------------------------------------------
  const jarAdmin = nouveauJar();
  await connexion(jarAdmin, 'admin@demo.ca', 'ChangeMoi123!');
  await changerMdp(jarAdmin, 'ChangeMoi123!', 'ImportDo2026!');

  let r = await req(jarAdmin, 'GET', '/import');
  test('page import → 200', r.statut === 200, `${r.statut}`);
  test('page import mentionne la section D&O', r.texte.includes('Import D&O'), 'section D&O absente');
  test('page import propose 4 modèles D&O', ['modele-do/soumission_do', 'modele-do/dirigeant_do', 'modele-do/garanties_do', 'modele-do/antecedents_do'].every((s) => r.texte.includes(s)));

  r = await req(jarAdmin, 'GET', '/import/modele-do/dirigeant_do');
  test('modèle dirigeant_do → 200 CSV', r.statut === 200 && r.texte.includes('Nom du dirigeant'), `${r.statut}`);
  test('modèle dirigeant_do avec commentaires #', r.texte.includes('# Modèle'));
  r = await req(jarAdmin, 'GET', '/import/modele-do/garanties_do');
  test('modèle garanties_do contient base et avenants', r.texte.includes('Base de garantie') && r.texte.includes('frais de défense') && r.texte.includes('pratiques d’emploi'), 'champs absents');
  r = await req(jarAdmin, 'GET', '/import/modele-do/soumission_do');
  test('modèle soumission_do → 200', r.statut === 200 && r.texte.includes('Date d’effet souhaitée'), `${r.statut}`);
  r = await req(jarAdmin, 'GET', '/import/modele-do/antecedents_do');
  test('modèle antecedents_do → 200', r.statut === 200 && r.texte.includes('Réclamations D&O 5 ans') && r.texte.includes('Poursuites en cours'), `${r.statut}`);
  r = await req(jarAdmin, 'GET', '/import/modele-do/invalide');
  test('modèle inconnu → 404', r.statut === 404, `${r.statut}`);

  // 2. Créer l'entreprise de test via l'import classique ------------------------
  const csvEnt = ecrireCsvTmp('import-do-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Forges Bélanger inc.;Marc;Bélanger',
  ]);
  r = await importer(jarAdmin, csvEnt);
  test('import entreprise → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 3. Fichier exemple complet ---------------------------------------------------
  r = await importer(jarAdmin, path.join(__dirname, 'exemple-import-do.csv'), 'exemple-import-do.csv');
  const crees = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('exemple : 4 lignes créées', crees === '4', `créées=${crees}`);
  test('exemple : 0 erreur', erreurs === '0', `erreurs=${erreurs}`);

  // 4. Vérification via les exports (miroir) --------------------------------------
  r = await exporter(jarAdmin, 'do_dirigeants', 'csv');
  test('export dirigeants D&O → 200', r.statut === 200, `${r.statut}`);
  test('export dirigeants : Marc Bélanger', r.texte.includes('Marc Bélanger'));
  test('export dirigeants : fonction et expérience', r.texte.includes('Président') && r.texte.includes('18'));
  r = await exporter(jarAdmin, 'do_soumissions', 'csv');
  test('export soumissions D&O → 200', r.statut === 200, `${r.statut}`);
  test('export soumissions : base en libellé FR', r.texte.includes('Réclamations-présentées'));
  test('export soumissions : avenants importés (1;0;0)', /;1;0;0(;|\r)/.test(r.texte.replace(/\r/g, '')), 'avenants absents');
  const lignesCsv = r.texte.split('\n');
  const idxVersions = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Nb versions');
  const ligneSoum = lignesCsv.find((l) => l.includes('Forges Bélanger'));
  const nbVersions = ligneSoum ? ligneSoum.split(';')[idxVersions] : null;
  // v1 création + 1 dirigeant + 1 garanties + 1 antécédents = 4
  test('soumission D&O versionnée (4 versions)', nbVersions === '4', `nb_versions=${nbVersions}`);
  const idxPours = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Poursuites déclarées');
  const idxNbRec = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Nb de réclamations 5 ans');
  test('export soumissions : poursuites déclarées = 1', ligneSoum && ligneSoum.split(';')[idxPours] === '1', 'colonne absente');
  test('export soumissions : nb réclamations 5 ans = 1', ligneSoum && ligneSoum.split(';')[idxNbRec] === '1', 'colonne absente');

  // 4b. En-tête avec apostrophe courbe (bug racine corrigé étape 6 RC) -----------
  const csvApo = ecrireCsvTmp('import-do-apo.csv', [
    'type;Entreprise;Avenant — pratiques d\u2019emploi',
    'garanties_do;Forges Bélanger inc.;oui',
  ]);
  r = await importer(jarAdmin, csvApo, 'apo.csv');
  test('apostrophe courbe reconnue → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 5. Fichier d'erreurs ------------------------------------------------------------
  const csvEnt2a = ecrireCsvTmp('import-do-ent2a.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Conseil Gestion inc.;Gilles;Roy',
  ]);
  r = await importer(jarAdmin, csvEnt2a);
  test('entreprise Conseil Gestion → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvEnt2 = ecrireCsvTmp('import-do-ent2.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_do;Conseil Gestion inc.;2026-11-01;brouillon',
  ]);
  r = await importer(jarAdmin, csvEnt2);
  test('soumission Conseil Gestion → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées') && r.texte.includes('Soumission D'), `${r.statut}`);
  const csvErr = ecrireCsvTmp('import-do-erreurs.csv', [
    'type;Entreprise;Soumission (id);Nom du dirigeant;Années d’expérience;Base de garantie;Limite par sinistre;Date d’effet souhaitée;Réclamations D&O 5 ans',
    'dirigeant_do;Conseil Gestion inc.;;;50000',
    'dirigeant_do;Conseil Gestion inc.;;Paul Tremblay;95',
    'garanties_do;Conseil Gestion inc.;;;;trimestre',
    'garanties_do;Conseil Gestion inc.;;;;Occurrences;-5000',
    'soumission_do;Conseil Gestion inc.;;;;;;2026-13-45',
    'dirigeant_do;Conseil Gestion inc.;99999;Marie Coutu;10',
    'antecedents_do;Conseil Gestion inc.;;;;;;;2023-06-15|Erreur|abc',
    'dirigeant_do;Conseil Gestion inc.;;Sophie Nadeau;12',
  ]);
  r = await importer(jarAdmin, csvErr, 'erreurs-do.csv');
  const crees2 = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs2 = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('fichier erreurs : 1 créé (ligne valide)', crees2 === '1', `créées=${crees2}`);
  test('fichier erreurs : 7 en erreur', erreurs2 === '7', `erreurs=${erreurs2}`);
  test('erreur nom du dirigeant requis détectée', r.texte.includes('nom du dirigeant requis'));
  test('erreur années d’expérience invalide détectée', r.texte.includes('années d\u2019expérience invalide'));
  test('erreur base de garantie invalide détectée', r.texte.includes('base de garantie invalide'));
  test('erreur limite par sinistre négative détectée', r.texte.includes('limite par sinistre invalide'));
  test('erreur date invalide détectée', r.texte.includes('date d’effet souhaitée invalide'));
  test('erreur soumission D&O introuvable détectée', r.texte.includes('soumission D&amp;O 99999 introuvable'));
  test('erreur montant réclamation invalide détectée', r.texte.includes('montant invalide'));

  // 6. Round-trip export→import : les libellés FR des exports sont reconnus ------
  // Les en-têtes des exports do_dirigeants portent le point final des libellés du dictionnaire.
  const csvRtEnt = ecrireCsvTmp('import-do-rt-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;RT Test inc.;Rita;Tremblay',
  ]);
  r = await importer(jarAdmin, csvRtEnt);
  test('round-trip : entreprise RT créée', r.texte.includes('créées'));
  const csvRt = ecrireCsvTmp('import-do-rt.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_do;RT Test inc.;2027-01-15;brouillon',
  ]);
  r = await importer(jarAdmin, csvRt);
  test('round-trip : soumission RT créée', r.texte.includes('Soumission D'));
  // En-têtes copiés des exports (avec points finals et apostrophes courbes)
  const csvRt2 = ecrireCsvTmp('import-do-rt2.csv', [
    'type;Entreprise;Nom du dirigeant.;Fonction / titre.;Années d\u2019expérience.;Antécédents personnels.',
    'dirigeant_do;RT Test inc.;Alain Bergeron;Vice-président;9;Aucune.',
  ]);
  r = await importer(jarAdmin, csvRt2);
  test('round-trip : dirigeant avec en-têtes exports → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvRt3 = ecrireCsvTmp('import-do-rt3.csv', [
    'type;Entreprise;Limite par sinistre;Limite agrégat;Franchise;Base de garantie;Prime;Avenant — frais de défense;Avenant — pratiques d’emploi;Avenant — fidélité / crime',
    'garanties_do;RT Test inc.;1000000;1000000;5000;Occurrences;3200;non;oui;non',
  ]);
  r = await importer(jarAdmin, csvRt3);
  test('round-trip : garanties avec libellé « Occurrences » → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvRt4 = ecrireCsvTmp('import-do-rt4.csv', [
    'type;Entreprise;Assureur actuel;Police actuelle;Réclamations D&O 5 ans;Poursuites en cours ou envisagées;Consentement crédit;Consentement dossier d’assurance',
    'antecedents_do;RT Test inc.;Assureur RT;RT-100;2022-01-10|Faute de gestion|12000|non;Aucune poursuite en cours.;oui;oui',
  ]);
  r = await importer(jarAdmin, csvRt4);
  test('round-trip : antécédents avec en-têtes exports → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  r = await exporter(jarAdmin, 'do_soumissions', 'csv');
  test('round-trip : base « Occurrences » exportée', r.texte.includes('RT Test inc.') && r.texte.includes('Occurrences'));
  r = await exporter(jarAdmin, 'do_dirigeants', 'csv');
  test('round-trip : dirigeant « Alain Bergeron » exporté', r.texte.includes('Alain Bergeron'));

  // 7. Règle d'or : aucun DELETE sur do_* (vérification statique) ------------------
  const srcImport = fs.readFileSync(path.join(__dirname, '..', 'routes', 'import.js'), 'utf8');
  const srcDo = fs.readFileSync(path.join(__dirname, '..', 'lib', 'do.js'), 'utf8');
  test('règle d’or : aucun DELETE FROM do_ dans routes/import.js', !/DELETE\s+FROM\s+do_/i.test(srcImport));
  test('règle d’or : aucun DELETE FROM do_ dans lib/do.js', !/DELETE\s+FROM\s+do_/i.test(srcDo));

  // 8. Cloisonnement inter-cabinets ---------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/cabinets');
  let r2 = await req(jarAdmin, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Deux' } });
  test('création cabinet 2 → 302', r2.statut === 302, `${r2.statut}`);
  await creerUtilisateur(jarAdmin, { nom: 'User Deux', email: 'deux@test.ca', role: 'admin', mdp: 'ImportDo2026!', cabinetId: 2 });
  const jarDeux = nouveauJar();
  await connexion(jarDeux, 'deux@test.ca', 'ImportDo2026!');
  await changerMdp(jarDeux, 'ImportDo2026!', 'ImportDo2027!');
  r = await exporter(jarDeux, 'do_dirigeants', 'csv');
  test('cabinet 2 ne voit pas les dirigeants du cabinet 1', r.statut === 200 && !r.texte.includes('Bélanger'));
  const csvCab2 = ecrireCsvTmp('import-do-cab2.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Entreprise Cab2 inc.;Bob;Lee',
  ]);
  r = await importer(jarDeux, csvCab2);
  test('import cabinet 2 fonctionne', r.texte.includes('créées'));

  // 9. Portefeuille courtier ------------------------------------------------------------
  await creerUtilisateur(jarAdmin, { nom: 'Courtier DO', email: 'courtier-do@test.ca', role: 'courtier', mdp: 'ImportDo2026!' });
  const jarCourtier = nouveauJar();
  await connexion(jarCourtier, 'courtier-do@test.ca', 'ImportDo2026!');
  await changerMdp(jarCourtier, 'ImportDo2026!', 'ImportDo2027!');
  // 9a. Hors portefeuille → ligne en erreur
  const csvHors = ecrireCsvTmp('import-do-hors.csv', [
    'type;Entreprise;Nom du dirigeant',
    'dirigeant_do;Forges Bélanger inc.;Pierre Lachance',
  ]);
  r = await importer(jarCourtier, csvHors);
  test('courtier hors portefeuille → erreur ligne', r.texte.includes('hors de votre portefeuille'), 'pas de rejet');
  // 9b. Le courtier crée sa propre entreprise via import → dans son portefeuille
  const csvEntC = ecrireCsvTmp('import-do-entc.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Cabinet du Courtier inc.;Carl;Roy',
  ]);
  r = await importer(jarCourtier, csvEntC);
  test('courtier crée son entreprise → ok', r.texte.includes('créées'));
  const csvSoumC = ecrireCsvTmp('import-do-soumc.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_do;Cabinet du Courtier inc.;2026-10-01;brouillon',
  ]);
  r = await importer(jarCourtier, csvSoumC);
  test('courtier crée sa soumission D&O → ok', r.texte.includes('Soumission D'));
  const csvDirC = ecrireCsvTmp('import-do-dirc.csv', [
    'type;Entreprise;Nom du dirigeant;Fonction / titre;Années d’expérience',
    'dirigeant_do;Cabinet du Courtier inc.;Nadia Fortin;Présidente;11',
  ]);
  r = await importer(jarCourtier, csvDirC);
  test('courtier importe un dirigeant dans son portefeuille → ok', r.texte.includes('Dirigeant « Nadia Fortin » ajouté'));

  // 10. Journal d'audit ----------------------------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/journal');
  test('journal contient import_csv', r.texte.includes('import_csv'));

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE', e); process.exit(1); });
