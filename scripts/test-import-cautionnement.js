/**
 * scripts/test-import-cautionnement.js — Import CSV cautionnement (étape 6/10
 * cautionnement) : 4 types (soumission_caut, obligation_caut, ligne_caut,
 * antecedents_caut), modèles téléchargeables /import/modele-cautionnement/:type,
 * en-têtes FR avec apostrophes droites ET courbes (EQUIV_NORM), type
 * d'obligation codes OU libellés FR, réclamations au format pipe, validation
 * stricte (limite par projet ≤ limite globale AVANT écriture), versionnage,
 * portefeuille courtier, cloisonnement inter-cabinets, rapport d'erreurs,
 * round-trip export→import (obligations + soumissions, JSON des réclamations).
 * Miroir de scripts/test-import-flotte.js.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : CHEMIN_BD=<même que serveur> PORT=3101 node scripts/test-import-cautionnement.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD, { readonly: true });
const bdW = new Database(process.env.CHEMIN_BD);
const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;
let total = 0;

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
      if (multipart.fichier.contenu) {
        fd.append(multipart.fichier.champ, new Blob([multipart.fichier.contenu], { type: 'text/csv' }), multipart.fichier.nom);
      } else {
        const buf = fs.readFileSync(multipart.fichier.chemin);
        fd.append(multipart.fichier.champ, new Blob([buf], { type: 'text/csv' }), multipart.fichier.nom);
      }
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
  total++;
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
async function importerContenu(jar, contenu, nom = 'import.csv') {
  let r = await req(jar, 'GET', '/import');
  const token = csrf(r.texte);
  return req(jar, 'POST', '/import', { multipart: { champs: { _csrf: token }, fichier: { champ: 'fichier', contenu, nom } } });
}
async function importerFichier(jar, cheminCsv, nom = 'import.csv') {
  let r = await req(jar, 'GET', '/import');
  const token = csrf(r.texte);
  return req(jar, 'POST', '/import', { multipart: { champs: { _csrf: token }, fichier: { champ: 'fichier', chemin: cheminCsv, nom } } });
}
async function exporter(jar, module, format) {
  let r = await req(jar, 'GET', '/exports');
  return req(jar, 'POST', '/exports', { form: { _csrf: csrf(r.texte), module, format } });
}
// Construction de CSV par NOM de colonne (jamais d'alignement manuel de « ; »).
function csvDepuis(entete, lignesObj) {
  const echap = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lignes = [entete.join(';')];
  for (const o of lignesObj) lignes.push(entete.map((h) => echap(o[h])).join(';'));
  return '﻿' + lignes.join('\r\n');
}
function rapportOk(texte, crees, erreurs) {
  return texte.includes(`<strong>${crees}</strong> créées`) && texte.includes(`<strong>${erreurs}</strong> en erreur`);
}

(async () => {
  console.log('== Import CSV cautionnement (étape 6/10 cautionnement) ==');

  // 1. Login admin démo
  const jarA = nouveauJar();
  let r = await connexion(jarA, 'admin@demo.ca', 'ChangeMoi123!');
  test('login admin démo → 302', r.statut === 302, `${r.statut}`);
  r = await changerMdp(jarA, 'ChangeMoi123!', 'ImportCaut2026!');
  test('changement mdp forcé → 302', r.statut === 302, `${r.statut}`);

  // 2. Page import : section cautionnement + modèles
  r = await req(jarA, 'GET', '/import');
  test('page import → 200', r.statut === 200, `${r.statut}`);
  test('page : section cautionnement', r.texte.includes('Import cautionnement'));
  test('page : 4 types cautionnement listés',
    r.texte.includes('soumission_caut') && r.texte.includes('obligation_caut')
    && r.texte.includes('ligne_caut') && r.texte.includes('antecedents_caut'));
  test('page : 4 liens de modèles cautionnement',
    ['soumission_caut', 'obligation_caut', 'ligne_caut', 'antecedents_caut']
      .every((t) => r.texte.includes(`/import/modele-cautionnement/${t}`)));
  for (const t of ['soumission_caut', 'obligation_caut', 'ligne_caut', 'antecedents_caut']) {
    r = await req(jarA, 'GET', `/import/modele-cautionnement/${t}`);
    test(`modèle ${t} → 200 + en-tête FR`, r.statut === 200 && r.texte.includes('Entreprise') && r.texte.includes(`type;`) || (r.statut === 200 && r.texte.includes(t)), `${r.statut}`);
  }
  r = await req(jarA, 'GET', '/import/modele-cautionnement/inconnu');
  test('modèle inconnu → 404', r.statut === 404, `${r.statut}`);

  // 3. Entreprise de test
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Import Cautionnement inc.', prenom: 'Im', nom: 'Port', langue: 'FR' },
  });
  test('entreprise créée → 302', r.statut === 302, `${r.statut}`);

  // 4. Import complet (en-têtes avec apostrophe COURBE, type par libellé FR + code,
  //    réclamations au format pipe)
  const ENTETE = ['type', 'Entreprise', 'Date d’effet souhaitée', 'Statut', 'Caution visée', 'Secteur d’activité',
    'Année de fondation', 'Chiffre d’affaires annuel', 'Nombre d’employés', 'Type de cautionnement',
    'Bénéficiaire (donneur d’ouvrage)', 'Description du projet', 'Montant du contrat', 'Montant du cautionnement',
    'Taux (%)', 'Prime estimée', 'Limite globale (capacité)', 'Limite par projet', 'Fonds de roulement',
    'Valeur nette', 'Prime de la ligne', 'Caution actuelle', 'Ligne actuelle', 'Années de cautionnement continu',
    'Réclamations 5 ans', 'Refus ou résiliation antérieur', 'Consentement crédit', 'Consentement états financiers'];
  const csvComplet = csvDepuis(ENTETE, [
    { type: 'soumission_caut', Entreprise: 'Import Cautionnement inc.', 'Date d’effet souhaitée': '2026-12-01', Statut: 'soumise', 'Caution visée': 'Travelers Canada', 'Secteur d’activité': 'Construction — entrepreneur spécialisé', 'Année de fondation': '2015', 'Chiffre d’affaires annuel': '3200000', 'Nombre d’employés': '18' },
    { type: 'obligation_caut', Entreprise: 'Import Cautionnement inc.', 'Type de cautionnement': 'Cautionnement d’exécution (performance bond)', 'Bénéficiaire (donneur d’ouvrage)': 'Ville Import', 'Description du projet': 'Réfection aqueduc', 'Montant du contrat': '1800000', 'Montant du cautionnement': '900000', 'Taux (%)': '1,1', 'Prime estimée': '9900' },
    { type: 'obligation_caut', Entreprise: 'Import Cautionnement inc.', 'Type de cautionnement': 'rbq', 'Bénéficiaire (donneur d’ouvrage)': 'Régie du bâtiment du Québec (RBQ)', 'Description du projet': 'Licence RBQ spécialisé', 'Montant du cautionnement': '20000', 'Prime estimée': '200' },
    { type: 'obligation_caut', Entreprise: 'Import Cautionnement inc.', 'Type de cautionnement': 'paiement_mo', 'Bénéficiaire (donneur d’ouvrage)': 'Ville Import', 'Description du projet': 'Paiement main-d’œuvre et matériaux — aqueduc', 'Montant du contrat': '1800000', 'Montant du cautionnement': '900000', 'Prime estimée': '8100' },
    { type: 'ligne_caut', Entreprise: 'Import Cautionnement inc.', 'Limite globale (capacité)': '4000000', 'Limite par projet': '2000000', 'Fonds de roulement': '610000', 'Valeur nette': '1350000', 'Prime de la ligne': '16500' },
    { type: 'antecedents_caut', Entreprise: 'Import Cautionnement inc.', 'Caution actuelle': 'Ancienne Caution Import', 'Ligne actuelle': 'LIG-IMP-9', 'Années de cautionnement continu': '7', 'Réclamations 5 ans': '2021-09-14|Exécution — Ville Z|27500|réglée', 'Refus ou résiliation antérieur': 'non', 'Consentement crédit': 'oui', 'Consentement états financiers': 'oui' },
  ]);
  r = await importerContenu(jarA, csvComplet);
  test('import complet → 200', r.statut === 200, `${r.statut}`);
  test('rapport : 6 créées, 0 en erreur', rapportOk(r.texte, 6, 0), r.texte.slice(r.texte.indexOf('Rapport'), r.texte.indexOf('Rapport') + 200));
  const soumImp = bd.prepare("SELECT * FROM caut_soumissions WHERE assureur = 'Travelers Canada'").get();
  test('soumission importée (statut soumise via import)', !!soumImp && soumImp.statut === 'soumise');
  test('en-tête importé : secteur/fondation/CA/employés (apostrophe courbe OK)',
    !!soumImp && soumImp.secteur_activite.includes('spécialisé') && soumImp.annee_fondation === 2015
    && soumImp.chiffre_affaires === 3200000 && soumImp.nb_employes === 18,
    JSON.stringify(soumImp && { s: soumImp.secteur_activite, f: soumImp.annee_fondation, ca: soumImp.chiffre_affaires }));
  const obls = bd.prepare('SELECT * FROM caut_obligations WHERE soumission_id = ? ORDER BY id').all(soumImp.id);
  test('3 obligations importées', obls.length === 3, `${obls.length}`);
  test('obligation 1 : libellé FR converti en code execution', obls[0] && obls[0].type === 'execution' && obls[0].montant_cautionnement === 900000);
  test('obligation 2 : code rbq + 20 000 $ (spécialisé)', obls[1] && obls[1].type === 'rbq' && obls[1].montant_cautionnement === 20000);
  test('obligation 3 : code paiement_mo', obls[2] && obls[2].type === 'paiement_mo');
  const ligne = bd.prepare('SELECT * FROM caut_garanties WHERE soumission_id = ?').get(soumImp.id);
  test('ligne importée (4 M$ / 2 M$ / FR 610 k$ / prime 16 500)',
    !!ligne && ligne.limite_globale === 4000000 && ligne.limite_par_projet === 2000000
    && ligne.fonds_roulement === 610000 && ligne.prime === 16500);
  const ant = bd.prepare('SELECT * FROM caut_antecedents WHERE soumission_id = ?').get(soumImp.id);
  const recs = ant ? JSON.parse(ant.reclamations_5ans || '[]') : [];
  test('antécédents importés : 1 réclamation pipe parsée',
    recs.length === 1 && recs[0].montant === 27500 && recs[0].statut === 'réglée' && recs[0].date === '2021-09-14',
    JSON.stringify(recs));
  test('antécédents importés : consentements 1/1',
    !!ant && JSON.parse(ant.consentements || '{}').credit === 1 && JSON.parse(ant.consentements || '{}').etats_financiers === 1);
  test('versionnage : versions créées par l’import (≥6)',
    bd.prepare('SELECT COUNT(*) n FROM caut_soumission_versions WHERE soumission_id = ?').get(soumImp.id).n >= 6);

  // 5. Erreurs de validation (rapport ligne par ligne, rien d’écrit pour les lignes KO)
  const ENTETE_ERR = ['type', 'Entreprise', 'Type de cautionnement', 'Bénéficiaire (donneur d’ouvrage)', 'Montant du cautionnement', 'Limite globale (capacité)', 'Limite par projet'];
  const csvErreurs = csvDepuis(ENTETE_ERR, [
    { type: 'obligation_caut', Entreprise: 'Import Cautionnement inc.', 'Type de cautionnement': 'type_bidon', 'Bénéficiaire (donneur d’ouvrage)': 'X', 'Montant du cautionnement': '1000' },
    { type: 'obligation_caut', Entreprise: 'Entreprise Inconnue ZZ', 'Type de cautionnement': 'execution', 'Bénéficiaire (donneur d’ouvrage)': 'X', 'Montant du cautionnement': '1000' },
    { type: 'ligne_caut', Entreprise: 'Import Cautionnement inc.', 'Limite globale (capacité)': '1000000', 'Limite par projet': '2000000' },
    { type: 'soumission_caut', Entreprise: 'Import Cautionnement inc.' },
  ]);
  const nbOblAvant = bd.prepare('SELECT COUNT(*) n FROM caut_obligations WHERE soumission_id = ?').get(soumImp.id).n;
  r = await importerContenu(jarA, csvErreurs);
  test('import erreurs → 200', r.statut === 200, `${r.statut}`);
  test('rapport : 3 erreurs signalées', rapportOk(r.texte, 1, 3), r.texte.slice(r.texte.indexOf('Rapport'), r.texte.indexOf('Rapport') + 200));
  test('erreur type invalide mentionnée', /type de cautionnement invalide/i.test(r.texte));
  test('erreur limite par projet > globale mentionnée', /limite par projet/i.test(r.texte));
  test('aucune obligation écrite pour les lignes KO',
    bd.prepare('SELECT COUNT(*) n FROM caut_obligations WHERE soumission_id = ?').get(soumImp.id).n === nbOblAvant);
  test('ligne inchangée après rejet (toujours 4 M$)',
    bd.prepare('SELECT limite_globale FROM caut_garanties WHERE soumission_id = ?').get(soumImp.id).limite_globale === 4000000);

  // 6. Exemple fourni (scripts/exemple-import-cautionnement.csv) — s’attache au seed Verdon
  const nbOblVerdonAvant = bd.prepare("SELECT COUNT(*) n FROM caut_obligations o JOIN caut_soumissions s ON s.id = o.soumission_id JOIN clients c ON c.id = s.client_id WHERE c.raison_sociale = 'Construction Verdon inc.' AND o.archive = 0").get().n;
  r = await importerFichier(jarA, path.join(__dirname, 'exemple-import-cautionnement.csv'), 'exemple-import-cautionnement.csv');
  test('exemple fourni importé → 200', r.statut === 200, `${r.statut}`);
  test('exemple : 5 créées, 0 en erreur', rapportOk(r.texte, 5, 0),
    r.texte.slice(r.texte.indexOf('Rapport'), r.texte.indexOf('Rapport') + 160));
  test('exemple : obligations ajoutées à une soumission Verdon',
    bd.prepare("SELECT COUNT(*) n FROM caut_obligations o JOIN caut_soumissions s ON s.id = o.soumission_id JOIN clients c ON c.id = s.client_id WHERE c.raison_sociale = 'Construction Verdon inc.'").get().n > nbOblVerdonAvant);

  // 7. Round-trip export → import
  r = await exporter(jarA, 'caut_obligations', 'csv');
  test('export obligations CSV → 200', r.statut === 200, `${r.statut}`);
  const lignesExp = r.texte.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  const idxEnt = lignesExp[0].split(';').findIndex((h) => h.trim() === 'Entreprise');
  const idxId = lignesExp[0].split(';').findIndex((h) => h.trim() === 'Soumission (id)');
  const lignesImp = lignesExp.filter((l, i) => i > 0 && l.split(';')[idxEnt] === 'Import Cautionnement inc.');
  const csvRt = '﻿' + ['type;' + lignesExp[0], ...lignesImp.map((l) => 'obligation_caut;' + l)].join('\r\n');
  const nbOblAvantRt = bd.prepare('SELECT COUNT(*) n FROM caut_obligations WHERE soumission_id = ?').get(soumImp.id).n;
  r = await importerContenu(jarA, csvRt, 'roundtrip.csv');
  test('round-trip obligations → 200', r.statut === 200, `${r.statut}`);
  test(`round-trip : ${lignesImp.length} obligations réimportées sans erreur`,
    rapportOk(r.texte, lignesImp.length, 0),
    r.texte.slice(r.texte.indexOf('Rapport'), r.texte.indexOf('Rapport') + 160));
  test('round-trip : obligations doublées pour la soumission',
    bd.prepare('SELECT COUNT(*) n FROM caut_obligations WHERE soumission_id = ?').get(soumImp.id).n === nbOblAvantRt + lignesImp.length);

  // Round-trip soumissions : l’en-tête exporté (avec « Réclamations 5 ans (JSON) ») se réimporte
  r = await exporter(jarA, 'caut_soumissions', 'csv');
  const lignesS = r.texte.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  const idxEntS = lignesS[0].split(';').findIndex((h) => h.trim() === 'Entreprise');
  const ligneS = lignesS.find((l, i) => i > 0 && l.split(';')[idxEntS] === 'Import Cautionnement inc.');
  test('round-trip : ligne soumission exportée trouvée', !!ligneS);
  const nbSoumAvant = bd.prepare("SELECT COUNT(*) n FROM caut_soumissions s JOIN clients c ON c.id = s.client_id WHERE c.raison_sociale = 'Import Cautionnement inc.'").get().n;
  r = await importerContenu(jarA, '﻿' + ['type;' + lignesS[0], 'soumission_caut;' + ligneS].join('\r\n'), 'roundtrip2.csv');
  test('round-trip soumission → créée sans erreur', rapportOk(r.texte, 1, 0),
    r.texte.slice(r.texte.indexOf('Rapport'), r.texte.indexOf('Rapport') + 200));
  test('round-trip : nouvelle soumission pour l’entreprise',
    bd.prepare("SELECT COUNT(*) n FROM caut_soumissions s JOIN clients c ON c.id = s.client_id WHERE c.raison_sociale = 'Import Cautionnement inc.'").get().n === nbSoumAvant + 1);

  // 8. Portefeuille courtier + cloisonnement
  const hash = bcrypt.hashSync('Test1234!', 4);
  const cabA = bdW.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const cabB = bdW.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Import B').lastInsertRowid;
  bdW.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)").run(cabB, 'adminib@t.ca', hash, 'Admin IB');
  bdW.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)").run(cabA, 'courtierimp@t.ca', hash, 'Courtier Import');
  const jarC = nouveauJar();
  r = await connexion(jarC, 'courtierimp@t.ca', 'Test1234!');
  test('login courtier → 302', r.statut === 302, `${r.statut}`);
  r = await importerContenu(jarC, '﻿' + [
    'type;Entreprise;Secteur d’activité',
    'soumission_caut;Import Cautionnement inc.;Construction',
  ].join('\r\n'));
  test('courtier : import hors portefeuille → erreur rapportée', rapportOk(r.texte, 0, 1) && /portefeuille/i.test(r.texte),
    r.texte.slice(r.texte.indexOf('Rapport'), r.texte.indexOf('Rapport') + 200));
  const jarB = nouveauJar();
  r = await connexion(jarB, 'adminib@t.ca', 'Test1234!');
  test('login admin B → 302', r.statut === 302, `${r.statut}`);
  r = await importerContenu(jarB, '﻿' + [
    'type;Soumission (id);Type de cautionnement;Montant du cautionnement',
    `obligation_caut;${soumImp.id};execution;5000`,
  ].join('\r\n'));
  test('cabinet B : rattachement à la soumission d’autrui → introuvable', rapportOk(r.texte, 0, 1) && /introuvable/i.test(r.texte),
    r.texte.slice(r.texte.indexOf('Rapport'), r.texte.indexOf('Rapport') + 200));

  // 9. Audit
  test('audit import_csv', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'import_csv'").get().n >= 1);

  console.log(`\n${total - echecs}/${total} tests réussis`);
  bd.close(); bdW.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
