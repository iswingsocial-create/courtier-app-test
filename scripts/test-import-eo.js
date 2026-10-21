/**
 * scripts/test-import-eo.js — Import CSV étendu E&O / responsabilité professionnelle (étape 6/10 E&O) :
 * nouveaux types (soumission_eo, activite_eo, garanties_eo, antecedents_eo),
 * modèles téléchargeables, validation stricte, versionnage, portefeuille courtier,
 * cloisonnement inter-cabinets, rapport d'erreurs, round-trip export→import.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-import-eo.js
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
  console.log('== Import E&O / responsabilité professionnelle (étape 6/10 E&O) ==');

  // 1. Page d'import et modèles ------------------------------------------------
  const jarAdmin = nouveauJar();
  await connexion(jarAdmin, 'admin@demo.ca', 'ChangeMoi123!');
  await changerMdp(jarAdmin, 'ChangeMoi123!', 'ImportEo2026!');

  let r = await req(jarAdmin, 'GET', '/import');
  test('page import → 200', r.statut === 200, `${r.statut}`);
  test('page import mentionne la section E&O', r.texte.includes('Import E&O'), 'section E&O absente');
  test('page import propose 4 modèles E&O', ['modele-eo/soumission_eo', 'modele-eo/activite_eo', 'modele-eo/garanties_eo', 'modele-eo/antecedents_eo'].every((s) => r.texte.includes(s)));

  r = await req(jarAdmin, 'GET', '/import/modele-eo/activite_eo');
  test('modèle activite_eo → 200 CSV', r.statut === 200 && r.texte.includes('Activité professionnelle'), `${r.statut}`);
  test('modèle activite_eo avec commentaires #', r.texte.includes('# Modèle'));
  r = await req(jarAdmin, 'GET', '/import/modele-eo/garanties_eo');
  test('modèle garanties_eo contient base et avenants', r.texte.includes('Base de garantie') && r.texte.includes('frais de défense') && r.texte.includes('cyber associé'), 'champs absents');
  r = await req(jarAdmin, 'GET', '/import/modele-eo/soumission_eo');
  test('modèle soumission_eo → 200', r.statut === 200 && r.texte.includes('Date d’effet souhaitée'), `${r.statut}`);
  r = await req(jarAdmin, 'GET', '/import/modele-eo/antecedents_eo');
  test('modèle antecedents_eo → 200', r.statut === 200 && r.texte.includes('Réclamations E&O 5 ans') && r.texte.includes('Circonstances'), `${r.statut}`);
  r = await req(jarAdmin, 'GET', '/import/modele-eo/invalide');
  test('modèle inconnu → 404', r.statut === 404, `${r.statut}`);

  // 2. Créer l'entreprise de test via l'import classique ------------------------
  const csvEnt = ecrireCsvTmp('import-eo-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Groupe Conseil Lussier inc.;Luc;Lussier',
  ]);
  r = await importer(jarAdmin, csvEnt);
  test('import entreprise → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 3. Fichier exemple complet ---------------------------------------------------
  r = await importer(jarAdmin, path.join(__dirname, 'exemple-import-eo.csv'), 'exemple-import-eo.csv');
  const crees = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('exemple : 4 lignes créées', crees === '4', `créées=${crees}`);
  test('exemple : 0 erreur', erreurs === '0', `erreurs=${erreurs}`);

  // 4. Vérification via les exports (miroir) --------------------------------------
  r = await exporter(jarAdmin, 'eo_activites', 'csv');
  test('export activités E&O → 200', r.statut === 200, `${r.statut}`);
  test('export activités : description', r.texte.includes('Conseil en transformation numérique'));
  test('export activités : CA', r.texte.includes('450000'));
  r = await exporter(jarAdmin, 'eo_soumissions', 'csv');
  test('export soumissions E&O → 200', r.statut === 200, `${r.statut}`);
  test('export soumissions : base en libellé FR', r.texte.includes('Réclamations-présentées'));
  test('export soumissions : avenants importés (1;1;0)', /;1;1;0(;|\r)/.test(r.texte.replace(/\r/g, '')), 'avenants absents');
  const lignesCsv = r.texte.split('\n');
  const idxVersions = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Nb versions');
  const ligneSoum = lignesCsv.find((l) => l.includes('Groupe Conseil Lussier'));
  const nbVersions = ligneSoum ? ligneSoum.split(';')[idxVersions] : null;
  // v1 création + 1 activité + 1 garanties + 1 antécédents = 4
  test('soumission E&O versionnée (4 versions)', nbVersions === '4', `nb_versions=${nbVersions}`);
  const idxCirc = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Circonstances déclarées');
  const idxNbRec = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Nb de réclamations 5 ans');
  test('export soumissions : circonstances déclarées = 1', ligneSoum && ligneSoum.split(';')[idxCirc] === '1', 'colonne absente');
  test('export soumissions : nb réclamations 5 ans = 1', ligneSoum && ligneSoum.split(';')[idxNbRec] === '1', 'colonne absente');

  // 4b. En-tête avec apostrophe courbe (bug racine corrigé étape 6 RC) -----------
  const csvApo = ecrireCsvTmp('import-eo-apo.csv', [
    'type;Entreprise;Avenant — frais de défense',
    'garanties_eo;Groupe Conseil Lussier inc.;oui',
  ]);
  r = await importer(jarAdmin, csvApo, 'apo.csv');
  test('apostrophe courbe reconnue → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 5. Fichier d'erreurs ------------------------------------------------------------
  const csvEnt2a = ecrireCsvTmp('import-eo-ent2a.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Conseil Expert inc.;Eve;Roy',
  ]);
  r = await importer(jarAdmin, csvEnt2a);
  test('entreprise Conseil Expert → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvEnt2 = ecrireCsvTmp('import-eo-ent2.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_eo;Conseil Expert inc.;2026-11-01;brouillon',
  ]);
  r = await importer(jarAdmin, csvEnt2);
  test('soumission Conseil Expert → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées') && r.texte.includes('Soumission E'), `${r.statut}`);
  const csvErr = ecrireCsvTmp('import-eo-erreurs.csv', [
    'type;Entreprise;Soumission (id);Activité professionnelle;Chiffre d’affaires ($);Base de garantie;Limite par sinistre;Date d’effet souhaitée;Réclamations E&O 5 ans',
    'activite_eo;Conseil Expert inc.;;;50000',
    'garanties_eo;Conseil Expert inc.;;;;trimestre',
    'garanties_eo;Conseil Expert inc.;;;;Occurrences;-5000',
    'soumission_eo;Conseil Expert inc.;;;;;;2026-13-45',
    'activite_eo;Conseil Expert inc.;99999;Conseil;10000',
    'antecedents_eo;Conseil Expert inc.;;;;;;;2023-06-15|Erreur|abc',
    'activite_eo;Conseil Expert inc.;;Tenue de livres;175000',
  ]);
  r = await importer(jarAdmin, csvErr, 'erreurs-eo.csv');
  const crees2 = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs2 = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('fichier erreurs : 1 créé (ligne valide)', crees2 === '1', `créées=${crees2}`);
  test('fichier erreurs : 6 en erreur', erreurs2 === '6', `erreurs=${erreurs2}`);
  test('erreur description activité requise détectée', r.texte.includes('activité professionnelle (description) requise'));
  test('erreur base de garantie invalide détectée', r.texte.includes('base de garantie invalide'));
  test('erreur limite par sinistre négative détectée', r.texte.includes('limite par sinistre invalide'));
  test('erreur date invalide détectée', r.texte.includes('date d’effet souhaitée invalide'));
  test('erreur soumission E&O introuvable détectée', r.texte.includes('soumission E&amp;O 99999 introuvable'));
  test('erreur montant réclamation invalide détectée', r.texte.includes('montant invalide'));

  // 6. Round-trip export→import : les libellés FR des exports sont reconnus ------
  const csvRtEnt = ecrireCsvTmp('import-eo-rt-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;RT Test inc.;Rita;Tremblay',
  ]);
  r = await importer(jarAdmin, csvRtEnt);
  test('round-trip : entreprise RT créée', r.texte.includes('créées'));
  const csvRt = ecrireCsvTmp('import-eo-rt.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_eo;RT Test inc.;2027-01-15;brouillon',
  ]);
  r = await importer(jarAdmin, csvRt);
  test('round-trip : soumission RT créée', r.texte.includes('Soumission E'));
  // En-têtes copiés des exports (avec apostrophes courbes et libellés FR)
  const csvRt2 = ecrireCsvTmp('import-eo-rt2.csv', [
    'type;Entreprise;Activité professionnelle;Chiffre d’affaires ($);Nb de professionnels',
    'activite_eo;RT Test inc.;Vérification et certification;320000;3',
  ]);
  r = await importer(jarAdmin, csvRt2);
  test('round-trip : activité avec en-têtes exports → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvRt3 = ecrireCsvTmp('import-eo-rt3.csv', [
    'type;Entreprise;Limite par sinistre;Limite agrégat;Franchise;Base de garantie;Prime;Avenant — frais de défense;Avenant — médias et contenu;Avenant — cyber associé',
    'garanties_eo;RT Test inc.;1000000;1000000;5000;Occurrences;3200;non;oui;non',
  ]);
  r = await importer(jarAdmin, csvRt3);
  test('round-trip : garanties avec libellé « Occurrences » → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvRt4 = ecrireCsvTmp('import-eo-rt4.csv', [
    'type;Entreprise;Assureur actuel;Police actuelle;Réclamations E&O 5 ans;Circonstances;Consentement crédit;Consentement dossier d’assurance',
    'antecedents_eo;RT Test inc.;Assureur RT;RT-100;2022-01-10|Faute professionnelle|12000|non;Dossier à surveiller;oui;oui',
  ]);
  r = await importer(jarAdmin, csvRt4);
  test('round-trip : antécédents avec en-têtes exports → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  r = await exporter(jarAdmin, 'eo_soumissions', 'csv');
  test('round-trip : base « Occurrences » exportée', r.texte.includes('RT Test inc.') && r.texte.includes('Occurrences'));
  r = await exporter(jarAdmin, 'eo_activites', 'csv');
  test('round-trip : activité « Vérification et certification » exportée', r.texte.includes('Vérification et certification'));

  // 7. Règle d'or : aucun DELETE sur eo_* (vérification statique) ------------------
  const srcImport = fs.readFileSync(path.join(__dirname, '..', 'routes', 'import.js'), 'utf8');
  const srcEo = fs.readFileSync(path.join(__dirname, '..', 'lib', 'eo.js'), 'utf8');
  test('règle d’or : aucun DELETE FROM eo_ dans routes/import.js', !/DELETE\s+FROM\s+eo_/i.test(srcImport));
  test('règle d’or : aucun DELETE FROM eo_ dans lib/eo.js', !/DELETE\s+FROM\s+eo_/i.test(srcEo));

  // 8. Cloisonnement inter-cabinets ---------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/cabinets');
  let r2 = await req(jarAdmin, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Deux' } });
  test('création cabinet 2 → 302', r2.statut === 302, `${r2.statut}`);
  await creerUtilisateur(jarAdmin, { nom: 'User Deux', email: 'deux@test.ca', role: 'admin', mdp: 'ImportEo2026!', cabinetId: 2 });
  const jarDeux = nouveauJar();
  await connexion(jarDeux, 'deux@test.ca', 'ImportEo2026!');
  await changerMdp(jarDeux, 'ImportEo2026!', 'ImportEo2027!');
  r = await exporter(jarDeux, 'eo_activites', 'csv');
  test('cabinet 2 ne voit pas les activités du cabinet 1', r.statut === 200 && !r.texte.includes('Lussier'));
  const csvCab2 = ecrireCsvTmp('import-eo-cab2.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Entreprise Cab2 inc.;Bob;Lee',
  ]);
  r = await importer(jarDeux, csvCab2);
  test('import cabinet 2 fonctionne', r.texte.includes('créées'));

  // 9. Portefeuille courtier ------------------------------------------------------------
  await creerUtilisateur(jarAdmin, { nom: 'Courtier EO', email: 'courtier-eo@test.ca', role: 'courtier', mdp: 'ImportEo2026!' });
  const jarCourtier = nouveauJar();
  await connexion(jarCourtier, 'courtier-eo@test.ca', 'ImportEo2026!');
  await changerMdp(jarCourtier, 'ImportEo2026!', 'ImportEo2027!');
  // 9a. Hors portefeuille → ligne en erreur
  const csvHors = ecrireCsvTmp('import-eo-hors.csv', [
    'type;Entreprise;Activité professionnelle;Chiffre d’affaires ($)',
    'activite_eo;Groupe Conseil Lussier inc.;Audit;100000',
  ]);
  r = await importer(jarCourtier, csvHors);
  test('courtier hors portefeuille → erreur ligne', r.texte.includes('hors de votre portefeuille'), 'pas de rejet');
  // 9b. Le courtier crée sa propre entreprise via import → dans son portefeuille
  const csvEntC = ecrireCsvTmp('import-eo-entc.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Cabinet du Courtier inc.;Carl;Roy',
  ]);
  r = await importer(jarCourtier, csvEntC);
  test('courtier crée son entreprise → ok', r.texte.includes('créées'));
  const csvSoumC = ecrireCsvTmp('import-eo-soumc.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_eo;Cabinet du Courtier inc.;2026-10-01;brouillon',
  ]);
  r = await importer(jarCourtier, csvSoumC);
  test('courtier crée sa soumission E&O → ok', r.texte.includes('Soumission E'));
  const csvActC = ecrireCsvTmp('import-eo-actc.csv', [
    'type;Entreprise;Activité professionnelle;Chiffre d’affaires ($);Nb de professionnels',
    'activite_eo;Cabinet du Courtier inc.;Conseil fiscal;220000;2',
  ]);
  r = await importer(jarCourtier, csvActC);
  test('courtier importe une activité dans son portefeuille → ok', r.texte.includes('Activité « Conseil fiscal » ajoutée'));

  // 10. Journal d'audit ----------------------------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/journal');
  test('journal contient import_csv', r.texte.includes('import_csv'));

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE', e); process.exit(1); });
