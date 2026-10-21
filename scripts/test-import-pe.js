/**
 * scripts/test-import-pe.js — Import CSV étendu perte d'exploitation (étape 6/10 PE) :
 * nouveaux types (soumission_pe, etablissement_pe, garanties_pe, antecedents_pe),
 * modèles téléchargeables, validation stricte, versionnage, portefeuille courtier,
 * cloisonnement inter-cabinets, rapport d'erreurs, round-trip export→import.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-import-pe.js
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
  console.log('== Import perte d’exploitation / interruption des affaires (étape 6/10 PE) ==');

  // 1. Page d'import et modèles ------------------------------------------------
  const jarAdmin = nouveauJar();
  await connexion(jarAdmin, 'admin@demo.ca', 'ChangeMoi123!');
  await changerMdp(jarAdmin, 'ChangeMoi123!', 'ImportPe2026!');

  let r = await req(jarAdmin, 'GET', '/import');
  test('page import → 200', r.statut === 200, `${r.statut}`);
  test('page import mentionne la section perte d’exploitation', r.texte.includes('Import perte d’exploitation'), 'section PE absente');
  test('page import propose 4 modèles PE', ['modele-pe/soumission_pe', 'modele-pe/etablissement_pe', 'modele-pe/garanties_pe', 'modele-pe/antecedents_pe'].every((s) => r.texte.includes(s)));

  r = await req(jarAdmin, 'GET', '/import/modele-pe/etablissement_pe');
  test('modèle etablissement_pe → 200 CSV', r.statut === 200 && r.texte.includes('Nom du lieu'), `${r.statut}`);
  test('modèle etablissement_pe avec commentaires #', r.texte.includes('# Modèle'));
  r = await req(jarAdmin, 'GET', '/import/modele-pe/garanties_pe');
  test('modèle garanties_pe contient période, base et avenants', r.texte.includes('Période d’indemnité') && r.texte.includes('frais supplémentaires') && r.texte.includes('détérioration des stocks'), 'champs absents');
  r = await req(jarAdmin, 'GET', '/import/modele-pe/soumission_pe');
  test('modèle soumission_pe → 200', r.statut === 200 && r.texte.includes('Date d’effet souhaitée'), `${r.statut}`);
  r = await req(jarAdmin, 'GET', '/import/modele-pe/antecedents_pe');
  test('modèle antecedents_pe → 200', r.statut === 200 && r.texte.includes('Interruptions 5 ans'), `${r.statut}`);
  r = await req(jarAdmin, 'GET', '/import/modele-pe/invalide');
  test('modèle inconnu → 404', r.statut === 404, `${r.statut}`);

  // 2. Créer l'entreprise de test via l'import classique ------------------------
  const csvEnt = ecrireCsvTmp('import-pe-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Boulangerie Chaleur inc.;Robert;Chaleur',
  ]);
  r = await importer(jarAdmin, csvEnt);
  test('import entreprise → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 3. Fichier exemple complet ---------------------------------------------------
  r = await importer(jarAdmin, path.join(__dirname, 'exemple-import-pe.csv'), 'exemple-import-pe.csv');
  const crees = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('exemple : 4 lignes créées', crees === '4', `créées=${crees}`);
  test('exemple : 0 erreur', erreurs === '0', `erreurs=${erreurs}`);

  // 4. Vérification via les exports (miroir) --------------------------------------
  r = await exporter(jarAdmin, 'pe_etablissements', 'csv');
  test('export établissements PE → 200', r.statut === 200, `${r.statut}`);
  test('export établissements : Fournil', r.texte.includes('Fournil'));
  test('export établissements : base de valeur en libellé FR', r.texte.includes('Coût de remplacement'));
  test('export établissements : chiffre d’affaires', r.texte.includes('750000'));
  r = await exporter(jarAdmin, 'pe_soumissions', 'csv');
  test('export soumissions PE → 200', r.statut === 200, `${r.statut}`);
  test('export soumissions : base en libellé FR (pas le code)', r.texte.includes('Marge brute') && !r.texte.includes(';marge_brute;'));
  test('export soumissions : période en libellé', r.texte.includes('12 mois'));
  test('export soumissions : franchise en jours', r.texte.includes('Franchise (jours)'));
  test('export soumissions : avenants importés (1;0;0;1)', /;1;0;0;1(;|\r)/.test(r.texte.replace(/\r/g, '')), 'avenants absents');
  const lignesCsv = r.texte.split('\n');
  const idxVersions = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Nb versions');
  const ligneSoum = lignesCsv.find((l) => l.includes('Boulangerie Chaleur'));
  const nbVersions = ligneSoum ? ligneSoum.split(';')[idxVersions] : null;
  // v1 création + 1 établissement + 1 garanties + 1 antécédents = 4
  test('soumission PE versionnée (4 versions)', nbVersions === '4', `nb_versions=${nbVersions}`);
  const idxNbInt = lignesCsv[0].split(';').findIndex((h) => h.trim() === 'Nb interruptions 5 ans');
  test('export soumissions : nb interruptions 5 ans = 1', ligneSoum && ligneSoum.split(';')[idxNbInt] === '1', 'colonne absente');

  // 4b. En-tête avec apostrophe courbe (bug racine corrigé étape 6 RC) -----------
  const csvApo = ecrireCsvTmp('import-pe-apo.csv', [
    'type;Entreprise;Base d\u2019indemnité',
    'garanties_pe;Boulangerie Chaleur inc.;Chiffre d’affaires',
  ]);
  r = await importer(jarAdmin, csvApo, 'apo.csv');
  test('apostrophe courbe reconnue → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);

  // 5. Fichier d'erreurs ------------------------------------------------------------
  const csvEnt2a = ecrireCsvTmp('import-pe-ent2a.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Usine Lavoie inc.;Gilles;Lavoie',
  ]);
  r = await importer(jarAdmin, csvEnt2a);
  test('entreprise Usine Lavoie → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvEnt2 = ecrireCsvTmp('import-pe-ent2.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_pe;Usine Lavoie inc.;2026-11-01;brouillon',
  ]);
  r = await importer(jarAdmin, csvEnt2);
  test('soumission Usine Lavoie → 1 créée', r.statut === 200 && r.texte.includes('<strong>1</strong> créées') && r.texte.includes('Soumission perte'), `${r.statut}`);
  const csvErr = ecrireCsvTmp('import-pe-erreurs.csv', [
    'type;Entreprise;Soumission (id);Nom du lieu;Adresse du lieu;Chiffre d’affaires ($);Période d’indemnité;Base d’indemnité;Franchise (jours);Date d’effet souhaitée;Interruptions 5 ans',
    'etablissement_pe;Usine Lavoie inc.;;;;;;;;;',
    'etablissement_pe;Usine Lavoie inc.;;Atelier;;-5000;;;;;',
    'garanties_pe;Usine Lavoie inc.;;;;;6;;;;',
    'garanties_pe;Usine Lavoie inc.;;;;;;trimestre;;;',
    'garanties_pe;Usine Lavoie inc.;;;;;;;-2;;',
    'soumission_pe;Usine Lavoie inc.;;;;;;;;2026-13-45;',
    'etablissement_pe;Usine Lavoie inc.;99999;Atelier;;;;;;;',
    'antecedents_pe;Usine Lavoie inc.;;;;;;;;;2023-06-15|Incendie|14|abc',
    'etablissement_pe;Usine Lavoie inc.;;Magasin;;;;;;;',
  ]);
  r = await importer(jarAdmin, csvErr, 'erreurs-pe.csv');
  const crees2 = (r.texte.match(/<strong>(\d+)<\/strong> créées/) || [])[1];
  const erreurs2 = (r.texte.match(/<strong>(\d+)<\/strong> en erreur/) || [])[1];
  test('fichier erreurs : 1 créé (ligne valide)', crees2 === '1', `créées=${crees2}`);
  test('fichier erreurs : 8 en erreur', erreurs2 === '8', `erreurs=${erreurs2}`);
  test('erreur nom du lieu ou adresse requis détectée', r.texte.includes('nom du lieu ou adresse requis'));
  test('erreur chiffre d’affaires négatif détectée', r.texte.includes('chiffre d’affaires invalide'));
  test('erreur période d’indemnité invalide détectée', r.texte.includes('période d’indemnité invalide'));
  test('erreur base d’indemnité invalide détectée', r.texte.includes('base d’indemnité invalide'));
  test('erreur franchise négative détectée', r.texte.includes('franchise (jours) invalide'));
  test('erreur date invalide détectée', r.texte.includes('date d’effet souhaitée invalide'));
  test('erreur soumission PE introuvable détectée', r.texte.includes('soumission perte d’exploitation 99999 introuvable'));
  test('erreur montant interruption invalide détectée', r.texte.includes('interruptions 5 ans : montant invalide'));

  // 6. Round-trip export→import : les libellés FR des exports sont reconnus ------
  // Les en-têtes des exports pe_etablissements portent le point final des libellés du dictionnaire.
  const csvRtEnt = ecrireCsvTmp('import-pe-rt-ent.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;RT Test PE inc.;René;Turcotte',
  ]);
  r = await importer(jarAdmin, csvRtEnt);
  test('round-trip : entreprise RT créée', r.texte.includes('créées'));
  const csvRt = ecrireCsvTmp('import-pe-rt.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_pe;RT Test PE inc.;2027-01-15;brouillon',
  ]);
  r = await importer(jarAdmin, csvRt);
  test('round-trip : soumission RT créée', r.texte.includes('Soumission perte'));
  // En-têtes copiés des exports (avec points finals)
  const csvRt2 = ecrireCsvTmp('import-pe-rt2.csv', [
    'type;Entreprise;Nom du lieu.;Adresse du lieu.;Occupation / activité à ce lieu.;Chiffre d’affaires du lieu ($).;Superficie (m²).;Année de construction.;Base de valeur',
    'etablissement_pe;RT Test PE inc.;Entrepôt;50 rue des Usines, Québec;Entreposage;120000;300;1988;Valeur dépréciée',
  ]);
  r = await importer(jarAdmin, csvRt2);
  test('round-trip : établissement avec en-têtes exports → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvRt3 = ecrireCsvTmp('import-pe-rt3.csv', [
    'type;Entreprise;Limite;Période d’indemnité;Franchise (jours);Base d’indemnité;Prime;Avenant — frais supplémentaires;Avenant — dépendance aux fournisseurs;Avenant — accès civil;Avenant — détérioration des stocks',
    'garanties_pe;RT Test PE inc.;1000000;18 mois;5;Bénéfice brut;3500;non;oui;non;non',
  ]);
  r = await importer(jarAdmin, csvRt3);
  test('round-trip : garanties avec libellé « Bénéfice brut » → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  const csvRt4 = ecrireCsvTmp('import-pe-rt4.csv', [
    'type;Entreprise;Assureur actuel;Police actuelle;Interruptions 5 ans;Consentement crédit;Consentement dossier d’assurance',
    'antecedents_pe;RT Test PE inc.;Assureur RT;RT-200;2023-05-02|Incendie|14|95000;oui;oui',
  ]);
  r = await importer(jarAdmin, csvRt4);
  test('round-trip : antécédents avec en-têtes exports → 1 créé', r.statut === 200 && r.texte.includes('<strong>1</strong> créées'), `${r.statut}`);
  r = await exporter(jarAdmin, 'pe_soumissions', 'csv');
  test('round-trip : base « Bénéfice brut » exportée', r.texte.includes('RT Test PE inc.') && r.texte.includes('Bénéfice brut'));
  test('round-trip : période « 18 mois » exportée', r.texte.includes('18 mois'));
  r = await exporter(jarAdmin, 'pe_etablissements', 'csv');
  test('round-trip : établissement « Entrepôt » exporté', r.texte.includes('Entrepôt'));

  // 7. Règle d'or : aucun DELETE sur pe_* (vérification statique) ------------------
  const srcImport = fs.readFileSync(path.join(__dirname, '..', 'routes', 'import.js'), 'utf8');
  const srcPe = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pe.js'), 'utf8');
  test('règle d’or : aucun DELETE FROM pe_ dans routes/import.js', !/DELETE\s+FROM\s+pe_/i.test(srcImport));
  test('règle d’or : aucun DELETE FROM pe_ dans lib/pe.js', !/DELETE\s+FROM\s+pe_/i.test(srcPe));

  // 8. Cloisonnement inter-cabinets ---------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/cabinets');
  let r2 = await req(jarAdmin, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Deux' } });
  test('création cabinet 2 → 302', r2.statut === 302, `${r2.statut}`);
  await creerUtilisateur(jarAdmin, { nom: 'User Deux', email: 'deux-pe@test.ca', role: 'admin', mdp: 'ImportPe2026!', cabinetId: 2 });
  const jarDeux = nouveauJar();
  await connexion(jarDeux, 'deux-pe@test.ca', 'ImportPe2026!');
  await changerMdp(jarDeux, 'ImportPe2026!', 'ImportPe2027!');
  r = await exporter(jarDeux, 'pe_etablissements', 'csv');
  test('cabinet 2 ne voit pas les établissements du cabinet 1', r.statut === 200 && !r.texte.includes('Fournil'));
  const csvCab2 = ecrireCsvTmp('import-pe-cab2.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Entreprise Cab2 inc.;Bob;Lee',
  ]);
  r = await importer(jarDeux, csvCab2);
  test('import cabinet 2 fonctionne', r.texte.includes('créées'));

  // 9. Portefeuille courtier ------------------------------------------------------------
  await creerUtilisateur(jarAdmin, { nom: 'Courtier PE', email: 'courtier-pe@test.ca', role: 'courtier', mdp: 'ImportPe2026!' });
  const jarCourtier = nouveauJar();
  await connexion(jarCourtier, 'courtier-pe@test.ca', 'ImportPe2026!');
  await changerMdp(jarCourtier, 'ImportPe2026!', 'ImportPe2027!');
  // 9a. Hors portefeuille → ligne en erreur
  const csvHors = ecrireCsvTmp('import-pe-hors.csv', [
    'type;Entreprise;Nom du lieu',
    'etablissement_pe;Boulangerie Chaleur inc.;Dépanneur',
  ]);
  r = await importer(jarCourtier, csvHors);
  test('courtier hors portefeuille → erreur ligne', r.texte.includes('hors de votre portefeuille'), 'pas de rejet');
  // 9b. Le courtier crée sa propre entreprise via import → dans son portefeuille
  const csvEntC = ecrireCsvTmp('import-pe-entc.csv', [
    'type;raison_sociale;prenom;nom',
    'entreprise;Cabinet du Courtier inc.;Carl;Roy',
  ]);
  r = await importer(jarCourtier, csvEntC);
  test('courtier crée son entreprise → ok', r.texte.includes('créées'));
  const csvSoumC = ecrireCsvTmp('import-pe-soumc.csv', [
    'type;Entreprise;Date d’effet souhaitée;Statut',
    'soumission_pe;Cabinet du Courtier inc.;2026-10-01;brouillon',
  ]);
  r = await importer(jarCourtier, csvSoumC);
  test('courtier crée sa soumission PE → ok', r.texte.includes('Soumission perte'));
  const csvDirC = ecrireCsvTmp('import-pe-etabc.csv', [
    'type;Entreprise;Nom du lieu;Occupation;Superficie (m²)',
    'etablissement_pe;Cabinet du Courtier inc.;Bureau;Services professionnels;80',
  ]);
  r = await importer(jarCourtier, csvDirC);
  test('courtier importe un établissement dans son portefeuille → ok', r.texte.includes('Établissement « Bureau » ajouté'));

  // 10. Journal d'audit ----------------------------------------------------------------------
  r = await req(jarAdmin, 'GET', '/admin/journal');
  test('journal contient import_csv', r.texte.includes('import_csv'));

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE', e); process.exit(1); });
