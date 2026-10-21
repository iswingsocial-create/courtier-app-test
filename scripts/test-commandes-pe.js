/**
 * scripts/test-commandes-pe.js — Commandes texte IA, module Perte d'exploitation
 * (étape 8/10 PE) : ajouter_etablissement_pe, modifier_garanties_pe (ajout ET
 * retrait d'avenants, confirmation en avant/après), modifier_etablissement_pe,
 * aller_a étendu (« soumission perte d'exploitation N », « ouvre la perte
 * d'exploitation »), confirmation avant exécution, gardes anti-collision
 * bidirectionnelles avec les 6 autres produits (FPQ1, biens, RC, cyber, E&O, D&O),
 * périmètre courtier, cloisonnement, audit, règle d'or (zéro DELETE FROM pe_).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-commandes-pe.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const fs = require('fs');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);

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
  return paires.length ? { Cookie: paires.join('; ') } : {};
}
async function req(jar, methode, chemin, { form = null, json = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    corps = new URLSearchParams(form).toString();
  } else if (json) {
    entetes['Content-Type'] = 'application/json';
    corps = JSON.stringify(json);
  }
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  const texte = await res.text();
  let donnees = null;
  try { donnees = JSON.parse(texte); } catch (e) { /* pas du JSON */ }
  return { statut: res.status, texte, donnees, location: res.headers.get('location') };
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
async function loginComme(email, mdp) {
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  return { jar, ok: r.statut === 302 };
}
async function demander(jar, message) {
  const p = await req(jar, 'GET', '/assistant');
  return req(jar, 'POST', '/assistant/message', { json: { message, _csrf: csrf(p.texte) } });
}
async function confirmer(jar, commande, avecCsrf = true) {
  let jeton = null;
  if (avecCsrf) { const p = await req(jar, 'GET', '/assistant'); jeton = csrf(p.texte); }
  return req(jar, 'POST', '/assistant/confirmer', { json: { commande, _csrf: jeton } });
}

(async () => {
  console.log('== Tests commandes IA perte d\u2019exploitation (étape 8/10 PE) :', BASE);
  const commandesIA = require('../lib/commandes-ia');
  const peLib = require('../lib/pe');
  const PE = 'perte d\u2019exploitation';

  // ---- 0. Analyseur local : cas nominaux --------------------------------------
  console.log('0. Analyseur local');
  let a = commandesIA.analyser(`ajoute l\u2019établissement Fournil occupation boulangerie avec 750 000 $ de chiffre d\u2019affaires à la soumission ${PE} 2`);
  test('ajouter_etablissement_pe complet', a && a.action === 'ajouter_etablissement_pe'
    && a.params.nom_lieu === 'Fournil' && a.params.occupation === 'boulangerie'
    && a.params.chiffre_affaires === 750000 && a.params.soumission_pe_id === 2, JSON.stringify(a && a.params));
  a = commandesIA.analyser(`ajoute l\u2019établissement Entrepôt au nom de la soumission ${PE} de Boulangerie Chaleur`);
  test('forme démo « au nom de » (contexte capture)', a && a.action === 'ajouter_etablissement_pe'
    && a.params.nom_lieu === 'Entrepôt' && a.params.soumission_client === 'Boulangerie Chaleur', JSON.stringify(a && a.params));
  a = commandesIA.analyser(`rajoute un établissement Magasin occupation commerce de détail superficie 120 année 1965 base de valeur coût de remplacement à la soumission ${PE} 1`);
  test('synonyme « rajoute » + superficie + année + base', a && a.action === 'ajouter_etablissement_pe'
    && a.params.nom_lieu === 'Magasin' && a.params.occupation === 'commerce de détail'
    && a.params.superficie === 120 && a.params.annee_construction === 1965
    && a.params.base_valeur === 'remplacement', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un établissement Xyz à la soumission 1');
  test('action intrinsèque : « soumission 1 » = soumission PE', a && a.action === 'ajouter_etablissement_pe'
    && a.params.soumission_pe_id === 1 && a.params.nom_lieu === 'Xyz', JSON.stringify(a && a.params));
  a = commandesIA.analyser(`ajoute un établissement Xyz à la soumission interruption des affaires 1`);
  test('synonyme produit « interruption des affaires »', a && a.action === 'ajouter_etablissement_pe'
    && a.params.soumission_pe_id === 1, JSON.stringify(a && a.params));
  test('autre produit explicite (cyber) → null', commandesIA.analyser('ajoute un établissement Xyz à la soumission cyber 1') === null);
  test('autre produit explicite (RC) → null', commandesIA.analyser('ajoute un établissement Xyz à la soumission RC 1') === null);
  test('autre produit explicite (biens) → null', commandesIA.analyser('ajoute un établissement Xyz à la soumission biens 1') === null);
  test('autre produit explicite (E&O) → null', commandesIA.analyser('ajoute un établissement Xyz à la soumission E&O 1') === null);
  test('autre produit explicite (D&O) → null', commandesIA.analyser('ajoute un établissement Xyz à la soumission D&O 1') === null);
  a = commandesIA.analyser('ajoute le lieu 1 rue Test à la soumission RC 1');
  test('lieu RC non capté par PE', a && a.action === 'ajouter_lieu_rc', JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute un bâtiment au 1 rue Test à la soumission biens 1');
  test('bâtiment biens non capté par PE', a && a.action === 'ajouter_batiment', JSON.stringify(a && a.action));
  a = commandesIA.analyser(`mets la limite à 800 000 $, la période d\u2019indemnité à 18 mois, la franchise à 5 jours et la base marge brute pour la soumission ${PE} 1`);
  test('garanties PE : limite + période + franchise jours + base', a && a.action === 'modifier_garanties_pe'
    && a.params.limite === 800000 && a.params.periode_indemnite_mois === 18
    && a.params.franchise_jours === 5 && a.params.base_montant === 'marge_brute'
    && a.params.soumission_pe_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser(`mets le délai de carence à 10 jours pour la soumission ${PE} 1`);
  test('franchise via « délai de carence »', a && a.action === 'modifier_garanties_pe'
    && a.params.franchise_jours === 10, JSON.stringify(a && a.params));
  a = commandesIA.analyser(`ajoute l\u2019avenant accès civil à la soumission ${PE} 1`);
  test('avenant : ajout accès civil', a && a.action === 'modifier_garanties_pe'
    && a.params.avenants && a.params.avenants.acces_civil === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser(`retire l\u2019avenant détérioration des stocks de la soumission ${PE} 1`);
  test('avenant : retrait détérioration des stocks', a && a.action === 'modifier_garanties_pe'
    && a.params.avenants && a.params.avenants.deterioration_stocks === 0, JSON.stringify(a && a.params));
  a = commandesIA.analyser(`mets la prime à 2800 $ pour la soumission ${PE} 1`);
  test('prime', a && a.action === 'modifier_garanties_pe' && a.params.prime === 2800, JSON.stringify(a && a.params));
  a = commandesIA.analyser(`change l\u2019occupation de l\u2019établissement Fournil de la soumission ${PE} 2 à commerce de détail`);
  test('modifier_etablissement_pe par nom (occupation)', a && a.action === 'modifier_etablissement_pe'
    && a.params.etablissement_recherche === 'Fournil' && a.params.occupation === 'commerce de détail'
    && a.params.soumission_pe_id === 2, JSON.stringify(a && a.params));
  a = commandesIA.analyser(`change le chiffre d\u2019affaires de l\u2019établissement Fournil de la soumission ${PE} 2 à 850 000 $`);
  test('modifier_etablissement_pe : chiffre d\u2019affaires', a && a.action === 'modifier_etablissement_pe'
    && a.params.chiffre_affaires === 850000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la franchise à 10 000 $ pour la soumission E&O 1');
  test('commande E&O non captée par PE', a && a.action === 'modifier_garanties_eo', JSON.stringify(a && a.action));
  a = commandesIA.analyser('retire l\u2019avenant rançongiciel pour la soumission cyber 1');
  test('commande cyber non captée par PE', a && a.action === 'modifier_garanties_cyber', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la limite par sinistre à 2 millions pour le lieu 1 de la soumission RC 1');
  test('commande RC non captée par PE', a && a.action === 'modifier_garanties_rc', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la franchise à 10 000 $ pour la soumission D&O 1');
  test('commande D&O non captée par PE', a && a.action === 'modifier_garanties_do', JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute l\u2019activité conseil fiscal avec 180 000 $ de chiffre d\u2019affaires à la soumission E&O 1');
  test('commande E&O (activité) non captée par PE', a && a.action === 'ajouter_activite_eo', JSON.stringify(a && a.action));
  test('activité sur soumission PE → null (pas E&O)', commandesIA.analyser(`ajoute une activité audit à la soumission ${PE} 1`) === null);
  test('mesure sur soumission PE → null (pas cyber)', commandesIA.analyser(`ajoute la mesure MFA à la soumission ${PE} 1`) === null);
  test('dirigeant sur soumission PE → null (pas D&O)', commandesIA.analyser(`ajoute un dirigeant Xyz à la soumission ${PE} 1`) === null);
  test('lieu sur soumission PE → null (pas RC)', commandesIA.analyser(`ajoute un lieu au 1 rue Test à la soumission ${PE} 1`) === null);
  test('bâtiment sur soumission PE → null (pas biens)', commandesIA.analyser(`ajoute un bâtiment au 1 rue Test à la soumission ${PE} 1`) === null);
  test('garanties sans marqueur PE → null', commandesIA.analyser('mets la franchise à 5 jours') === null);
  test('établissement sans produit → pas modifier_garanties_pe', !(commandesIA.analyser('mets la période d\u2019indemnité à 18 mois') || {}).action
    || commandesIA.analyser('mets la période d\u2019indemnité à 18 mois').action !== 'modifier_garanties_pe');
  a = commandesIA.analyser(`montre-moi la soumission ${PE} 1`);
  test('aller_a soumission PE → /pe/1', a && a.action === 'aller_a' && a.params.url === '/pe/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser(`ouvre la ${PE}`);
  test('aller_a « ouvre la perte d\u2019exploitation » → /pe', a && a.action === 'aller_a' && a.params.url === '/pe', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission 1');
  test('aller_a auto → /auto/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/auto/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission D&O 1');
  test('aller_a D&O → /do/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/do/1', JSON.stringify(a && a.params));
  test('blague → null', commandesIA.analyser('raconte-moi une blague') === null);
  test('ACTIONS_COHERE inclut PE', ['ajouter_etablissement_pe', 'modifier_garanties_pe', 'modifier_etablissement_pe']
    .every((x) => commandesIA.ACTIONS_COHERE.includes(x)), JSON.stringify(commandesIA.ACTIONS_COHERE));

  // ---- 1. Préparation : 2e cabinet, courtier, clients, soumissions PE -----------
  console.log('1. Préparation');
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const adminId = bd.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  const cabB = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet B').lastInsertRowid;
  const hash = bcrypt.hashSync('Test1234!', 4);
  const mkUser = (cab, email, role, nom) => bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(cab, email, hash, role, nom).lastInsertRowid;
  const adminB = mkUser(cabB, 'adminb@t.ca', 'admin', 'Admin B');
  const courtier1 = mkUser(cabA, 'courtier1@t.ca', 'courtier', 'Courtier Un');
  const cliPtf = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Portefeuille PE inc.', 'Porte', 'Feuille', courtier1).lastInsertRowid;
  const cliAmb = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)'
  ).run(cabA, 'Client Ambigu PE inc.', 'Ambi', 'Gu').lastInsertRowid;
  const soumA1 = peLib.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliAmb });
  const soumA2 = peLib.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliAmb });
  const soumPtf = peLib.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliPtf });
  const soumB = peLib.creerSoumission({ cabinetId: cabB, userId: adminB, clientId: null });
  peLib.ajouterEtablissement(soumA1, cabA, adminId, {
    nom_lieu: 'Fournil', occupation: 'boulangerie', chiffre_affaires: 750000, superficie: 250,
    annee_construction: 1965, base_valeur: 'remplacement',
  });
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && soumA1 > 0 && soumA2 > 0 && soumPtf > 0 && soumB > 0);

  // ---- 2. Login admin ----------------------------------------------------------
  console.log('2. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 3. Confirmation requise avant exécution (établissement) -------------------
  console.log('3. Confirmation établissement');
  const nbEtAvant = bd.prepare('SELECT COUNT(*) n FROM pe_etablissements WHERE cabinet_id = ?').get(cabA).n;
  const nbVerAvant = bd.prepare('SELECT COUNT(*) n FROM pe_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  r = await demander(jar, `ajoute l\u2019établissement Entrepôt occupation entreposage avec 300 000 $ de chiffre d\u2019affaires à la soumission ${PE} ${soumA1}`);
  test('commande → 200 + confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_etablissement_pe'
    && /Entrepôt/.test(r.donnees.confirmation.resume)
    && /entreposage/.test(r.donnees.confirmation.resume)
    && /Confirmez-vous/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 300));
  const nbEtApresDemande = bd.prepare('SELECT COUNT(*) n FROM pe_etablissements WHERE cabinet_id = ?').get(cabA).n;
  test('rien exécuté avant confirmation', nbEtApresDemande === nbEtAvant, `${nbEtAvant} → ${nbEtApresDemande}`);
  const cmdEt = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_etablissement_pe', params: {} };
  r = await confirmer(jar, cmdEt);
  test("confirmation → 200 « C'est fait »", r.statut === 200 && /C'est fait/.test(r.donnees.reponse) && /Entrepôt/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const et = bd.prepare(
    'SELECT * FROM pe_etablissements WHERE cabinet_id = ? AND soumission_id = ? AND nom_lieu = ?'
  ).get(cabA, soumA1, 'Entrepôt');
  test('établissement créé avec occupation + CA', !!et && et.occupation === 'entreposage'
    && et.chiffre_affaires === 300000, JSON.stringify(et && { n: et.nom_lieu, o: et.occupation, ca: et.chiffre_affaires }));
  const nbVerApres = bd.prepare('SELECT COUNT(*) n FROM pe_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  test("version créée (règle d'or)", nbVerApres === nbVerAvant + 1, `${nbVerAvant} → ${nbVerApres}`);

  // ---- 4. Garanties : fusion + avant/après ----------------------------------------
  console.log('4. Garanties / fusion');
  r = await demander(jar, `mets la période d\u2019indemnité à 18 mois, la franchise à 5 jours et ajoute l\u2019avenant accès civil pour la soumission ${PE} ${soumA1}`);
  test('garanties → confirmation avant/après', r.statut === 200
    && r.donnees.confirmation && /période d\u2019indemnité :/.test(r.donnees.confirmation.resume)
    && /→/.test(r.donnees.confirmation.resume)
    && /accès civil/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 400));
  const cmdGar = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_pe', params: {} };
  r = await confirmer(jar, cmdGar);
  test('garanties mises à jour', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  let g = bd.prepare(
    'SELECT * FROM pe_garanties WHERE cabinet_id = ? AND soumission_id = ?'
  ).get(cabA, soumA1);
  test('garanties en base (période 18, franchise 5 jours, accès civil)', !!g
    && g.periode_indemnite_mois === 18 && g.franchise_jours === 5
    && JSON.parse(g.avenants || '{}').acces_civil === 1, JSON.stringify(g && { p: g.periode_indemnite_mois, f: g.franchise_jours, av: g.avenants }));
  r = await demander(jar, `mets la base marge brute pour la soumission ${PE} ${soumA1}`);
  const cmdGar2 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_pe', params: {} };
  r = await confirmer(jar, cmdGar2);
  g = bd.prepare('SELECT * FROM pe_garanties WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumA1);
  test('fusion : période + franchise + avenant conservés, base changée', r.statut === 200
    && g.periode_indemnite_mois === 18 && g.franchise_jours === 5
    && JSON.parse(g.avenants || '{}').acces_civil === 1 && g.base_montant === 'marge_brute', JSON.stringify(g && { p: g.periode_indemnite_mois, f: g.franchise_jours, b: g.base_montant, av: g.avenants }));
  r = await demander(jar, `retire l\u2019avenant accès civil pour la soumission ${PE} ${soumA1}`);
  const cmdGar3 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_pe', params: {} };
  r = await confirmer(jar, cmdGar3);
  g = bd.prepare('SELECT * FROM pe_garanties WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumA1);
  test('retrait avenant : acces_civil = 0', r.statut === 200 && JSON.parse(g.avenants).acces_civil === 0, JSON.stringify(g && g.avenants));

  // ---- 5. Modification d'un établissement ------------------------------------------
  console.log('5. Établissement');
  r = await demander(jar, `change l\u2019occupation de l\u2019établissement Fournil de la soumission ${PE} ${soumA1} à commerce de détail`);
  test('occupation → confirmation', r.statut === 200
    && r.donnees.confirmation && /commerce de détail/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 250));
  const cmdOcc = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_etablissement_pe', params: {} };
  r = await confirmer(jar, cmdOcc);
  const et2 = bd.prepare(
    'SELECT * FROM pe_etablissements WHERE cabinet_id = ? AND soumission_id = ? AND nom_lieu = ?'
  ).get(cabA, soumA1, 'Fournil');
  test('occupation changée en base', r.statut === 200 && et2 && et2.occupation === 'commerce de détail', JSON.stringify(et2 && et2.occupation));
  r = await demander(jar, `change l\u2019occupation de l\u2019établissement Inexistant de la soumission ${PE} ${soumA1} à test`);
  test('établissement introuvable → message clair', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 6. Résolution ambiguë / introuvable ---------------------------------------
  console.log('6. Résolution');
  r = await demander(jar, `ajoute un établissement Test à la soumission ${PE} de Client Ambigu PE inc.`);
  test('2 soumissions PE → demande de précision', r.statut === 200
    && !r.donnees.confirmation && /Plusieurs soumissions perte d.exploitation/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jar, `ajoute un établissement Test à la soumission ${PE} 999`);
  test('soumission PE 999 → introuvable', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un établissement Test à la soumission ${PE} ${soumB}`);
  test('soumission autre cabinet → introuvable (pas de fuite)', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un établissement à la soumission ${PE} ${soumA1}`);
  test('établissement sans nom ni adresse → question', r.statut === 200 && /Quel est le nom du lieu/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 7. Navigation -------------------------------------------------------------
  console.log('7. Navigation');
  r = await demander(jar, `montre-moi la soumission ${PE} ${soumA1}`);
  test('aller_a → redirection /pe/N', r.statut === 200 && r.donnees.redirection === `/pe/${soumA1}`, JSON.stringify(r.donnees));
  r = await demander(jar, `ouvre la ${PE}`);
  test('aller_a → /pe', r.statut === 200 && r.donnees.redirection === '/pe', JSON.stringify(r.donnees));

  // ---- 8. Portefeuille courtier ----------------------------------------------------
  console.log('8. Portefeuille');
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await demander(jarC1, `ajoute un établissement Test à la soumission ${PE} ${soumA1}`);
  test('courtier hors portefeuille → refus poli', r.statut === 200
    && !r.donnees.confirmation && /pas dans votre portefeuille/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jarC1, `ajoute un établissement Test à la soumission ${PE} ${soumPtf}`);
  test('courtier dans son portefeuille → confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_etablissement_pe', JSON.stringify(r.donnees).slice(0, 200));
  const cmdPtf = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_etablissement_pe', params: {} };
  r = await confirmer(jarC1, cmdPtf);
  test('courtier confirme → exécuté', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await confirmer(jar, { action: 'ajouter_etablissement_pe', params: {} }, false);
  test('confirmer sans CSRF → 403', r.statut === 403, r.statut);
  r = await confirmer(jar, { action: 'detruire_tout', params: {} });
  test('action inconnue → message clair', r.statut === 200 && /invalide|expir/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 9. Journal d'audit + règle d'or ------------------------------------------
  console.log('9. Audit');
  const audits = bd.prepare(
    "SELECT COUNT(*) n FROM journal_audit WHERE cabinet_id = ? AND action = 'commande_ia'"
  ).get(cabA).n;
  test('commandes journalisées (commande_ia)', audits >= 10, `trouvées : ${audits}`);
  const src = fs.readFileSync(__dirname + '/../lib/commandes-ia.js', 'utf8');
  test('règle d\u2019or : aucun DELETE FROM pe_', !/DELETE\s+FROM\s+pe_/i.test(src));
  const fuite = peLib.obtenirSoumission(soumA1, cabB);
  test('aucune fuite inter-cabinets', fuite === null);

  console.log(`\n${total - echecs}/${total} tests réussis${echecs ? ` — ${echecs} ÉCHECS` : ''}`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
