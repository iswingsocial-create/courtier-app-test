/**
 * scripts/test-commandes-do.js — Commandes texte IA, module D&O (étape 8/10 D&O) :
 * ajouter_dirigeant_do, modifier_garanties_do (ajout ET retrait d'avenants,
 * confirmation en avant/après), modifier_dirigeant_do,
 * aller_a étendu (« soumission D&O N », « ouvre le D&O »),
 * confirmation avant exécution, gardes anti-collision bidirectionnelles avec
 * les 5 autres produits, périmètre courtier, cloisonnement, audit,
 * antécédents personnels sensibles (écrits mais jamais réaffichés).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-commandes-do.js
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
  console.log('== Tests commandes IA D&O (étape 8/10 D&O) :', BASE);
  const commandesIA = require('../lib/commandes-ia');
  const doLib = require('../lib/do');

  // ---- 0. Analyseur local : cas nominaux --------------------------------------
  console.log('0. Analyseur local');
  let a = commandesIA.analyser('ajoute le dirigeant Marc Bouchard comme trésorier à la soumission D&O 2');
  test('ajouter_dirigeant_do complet (comme trésorier)', a && a.action === 'ajouter_dirigeant_do'
    && a.params.nom === 'Marc Bouchard' && a.params.fonction === 'trésorier'
    && a.params.soumission_do_id === 2, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un dirigeant Marie Tremblay fonction présidente-directrice générale 15 ans d\u2019expérience antécédents personnels aucun à la soumission D&O 1');
  test('fonction + années + antécédents', a && a.action === 'ajouter_dirigeant_do'
    && a.params.nom === 'Marie Tremblay' && a.params.fonction === 'présidente-directrice générale'
    && a.params.annees_experience === 15 && a.params.antecedents_personnels === 'aucun'
    && a.params.soumission_do_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('rajoute un dirigeant Jean Lavoie à la soumission D&O 1');
  test('synonyme « rajoute »', a && a.action === 'ajouter_dirigeant_do'
    && a.params.nom === 'Jean Lavoie' && a.params.soumission_do_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un dirigeant Xyz à la soumission 1');
  test('action intrinsèque : « soumission 1 » = soumission D&O', a && a.action === 'ajouter_dirigeant_do'
    && a.params.soumission_do_id === 1 && a.params.nom === 'Xyz', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un dirigeant Xyz à la soumission cyber 1');
  test('autre produit explicite → null', commandesIA.analyser('ajoute un dirigeant Xyz à la soumission cyber 1') === null);
  a = commandesIA.analyser('ajoute un conducteur Marie Tremblay à la soumission 1');
  test('dirigeant ≠ conducteur (non-régression FPQ1)', a && a.action === 'ajouter_conducteur'
    && a.params.prenom === 'Marie' && a.params.nom === 'Tremblay', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la franchise de la soumission D&O 1 à 10 000 $');
  test('franchise en fin de phrase', a && a.action === 'modifier_garanties_do'
    && a.params.franchise === 10000 && a.params.soumission_do_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la franchise à 5000 $ pour la soumission D&O 1');
  test('franchise immédiate (préposition « pour »)', a && a.action === 'modifier_garanties_do'
    && a.params.franchise === 5000 && a.params.soumission_do_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la limite par sinistre à 2 millions et l\u2019agrégat à 1 million pour la soumission D&O 1');
  test('limites', a && a.action === 'modifier_garanties_do'
    && a.params.limite_par_sinistre === 2000000 && a.params.limite_agregat === 1000000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la base réclamations présentées pour la soumission D&O 1');
  test('base réclamations-présentées', a && a.action === 'modifier_garanties_do'
    && a.params.base === 'reclamations_presentees', JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la base occurrences pour la soumission D&O 1');
  test('base occurrences', a && a.action === 'modifier_garanties_do'
    && a.params.base === 'occurrences', JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la prime à 9500 $ pour la soumission D&O 1');
  test('prime', a && a.action === 'modifier_garanties_do' && a.params.prime === 9500, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute l\u2019avenant pratiques d\u2019emploi à la soumission D&O 1');
  test('avenant : ajout pratiques d\u2019emploi', a && a.action === 'modifier_garanties_do'
    && a.params.avenants && a.params.avenants.pratiques_emploi === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('retire l\u2019avenant fidélité de la soumission D&O 1');
  test('avenant : retrait fidélité/crime', a && a.action === 'modifier_garanties_do'
    && a.params.avenants && a.params.avenants.fidelite_crime === 0, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute l\u2019avenant frais de défense à la soumission D&O 1');
  test('avenant : ajout frais de défense', a && a.action === 'modifier_garanties_do'
    && a.params.avenants && a.params.avenants.frais_defense === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('change la fonction du dirigeant Marie Tremblay de la soumission D&O 2 à trésorier');
  test('modifier_dirigeant_do par nom', a && a.action === 'modifier_dirigeant_do'
    && a.params.dirigeant_recherche === 'Marie Tremblay' && a.params.fonction === 'trésorier'
    && a.params.soumission_do_id === 2, JSON.stringify(a && a.params));
  a = commandesIA.analyser('change les années d\u2019expérience du dirigeant 1 de la soumission D&O 2 à 20');
  test('modifier_dirigeant_do par n° + années', a && a.action === 'modifier_dirigeant_do'
    && a.params.dirigeant_index === 1 && a.params.annees_experience === 20, JSON.stringify(a && a.params));
  a = commandesIA.analyser('change les antécédents personnels du dirigeant 1 de la soumission D&O 2 à aucun antécédent');
  test('modifier_dirigeant_do : antécédents personnels', a && a.action === 'modifier_dirigeant_do'
    && a.params.antecedents_personnels === 'aucun antécédent', JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la franchise à 10 000 $ pour la soumission E&O 1');
  test('commande E&O non captée par D&O', a && a.action === 'modifier_garanties_eo', JSON.stringify(a && a.action));
  a = commandesIA.analyser('retire l\u2019avenant rançongiciel pour la soumission cyber 1');
  test('commande cyber non captée par D&O', a && a.action === 'modifier_garanties_cyber', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la limite par sinistre à 2 millions pour le lieu 1 de la soumission RC 1');
  test('commande RC non captée par D&O', a && a.action === 'modifier_garanties_rc', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la RC à 2 millions pour le véhicule 1 de la soumission 1');
  test('commande auto non captée par D&O', a && a.action === 'modifier_garantie', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la formule tous risques pour le bâtiment 1 de la soumission biens 1');
  test('commande biens non captée par D&O', a && a.action === 'modifier_garantie_biens', JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute l\u2019activité conseil fiscal avec 180 000 $ de chiffre d\u2019affaires à la soumission E&O 1');
  test('commande E&O (activité) non captée par D&O', a && a.action === 'ajouter_activite_eo', JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute la mesure MFA à la soumission D&O 1');
  test('mesure sur soumission D&O → null (pas cyber)', commandesIA.analyser('ajoute la mesure MFA à la soumission D&O 1') === null);
  a = commandesIA.analyser('ajoute un bâtiment au 1 rue Test à la soumission D&O 1');
  test('bâtiment sur soumission D&O → null (pas biens)', commandesIA.analyser('ajoute un bâtiment au 1 rue Test à la soumission D&O 1') === null);
  a = commandesIA.analyser('ajoute un lieu au 1 rue Test à la soumission D&O 1');
  test('lieu sur soumission D&O → null (pas RC)', commandesIA.analyser('ajoute un lieu au 1 rue Test à la soumission D&O 1') === null);
  a = commandesIA.analyser('ajoute une activité audit à la soumission D&O 1');
  test('activité sur soumission D&O → null (pas E&O)', commandesIA.analyser('ajoute une activité audit à la soumission D&O 1') === null);
  a = commandesIA.analyser('mets la franchise à 10 000 $');
  test('garanties sans marqueur D&O → null', commandesIA.analyser('mets la franchise à 10 000 $') === null);
  a = commandesIA.analyser('montre-moi la soumission D&O 1');
  test('aller_a soumission D&O → /do/1', a && a.action === 'aller_a' && a.params.url === '/do/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ouvre le D&O');
  test('aller_a « ouvre le D&O » → /do', a && a.action === 'aller_a' && a.params.url === '/do', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission 1');
  test('aller_a auto → /auto/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/auto/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission cyber 1');
  test('aller_a cyber → /cyber/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/cyber/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission RC 1');
  test('aller_a RC → /rc/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/rc/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission E&O 1');
  test('aller_a E&O → /eo/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/eo/1', JSON.stringify(a && a.params));
  test('blague → null', commandesIA.analyser('raconte-moi une blague') === null);
  test('ACTIONS_COHERE inclut D&O', ['ajouter_dirigeant_do', 'modifier_garanties_do', 'modifier_dirigeant_do']
    .every((x) => commandesIA.ACTIONS_COHERE.includes(x)), JSON.stringify(commandesIA.ACTIONS_COHERE));

  // ---- 1. Préparation : 2e cabinet, courtier, clients, soumissions D&O ------------
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
  ).run(cabA, 'Client Portefeuille DO inc.', 'Porte', 'Feuille', courtier1).lastInsertRowid;
  const cliAmb = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)'
  ).run(cabA, 'Client Ambigu DO inc.', 'Ambi', 'Gu').lastInsertRowid;
  const soumA1 = doLib.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliAmb });
  const soumA2 = doLib.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliAmb });
  const soumPtf = doLib.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliPtf });
  const soumB = doLib.creerSoumission({ cabinetId: cabB, userId: adminB, clientId: null });
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && soumA1 > 0 && soumA2 > 0 && soumPtf > 0 && soumB > 0);

  // ---- 2. Login admin ----------------------------------------------------------
  console.log('2. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 3. Confirmation requise avant exécution (dirigeant) ----------------------
  console.log('3. Confirmation dirigeant');
  const nbDirAvant = bd.prepare('SELECT COUNT(*) n FROM do_dirigeants WHERE cabinet_id = ?').get(cabA).n;
  const nbVerAvant = bd.prepare('SELECT COUNT(*) n FROM do_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  r = await demander(jar, `ajoute le dirigeant Marc Bouchard comme trésorier à la soumission D&O ${soumA1}`);
  test('commande → 200 + confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_dirigeant_do'
    && /Marc Bouchard/.test(r.donnees.confirmation.resume)
    && /trésorier/.test(r.donnees.confirmation.resume)
    && /Confirmez-vous/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 300));
  const nbDirApresDemande = bd.prepare('SELECT COUNT(*) n FROM do_dirigeants WHERE cabinet_id = ?').get(cabA).n;
  test('rien exécuté avant confirmation', nbDirApresDemande === nbDirAvant, `${nbDirAvant} → ${nbDirApresDemande}`);
  const cmdDir = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_dirigeant_do', params: {} };
  r = await confirmer(jar, cmdDir);
  test("confirmation → 200 « C'est fait »", r.statut === 200 && /C'est fait/.test(r.donnees.reponse) && /Marc Bouchard/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const dir = bd.prepare(
    'SELECT * FROM do_dirigeants WHERE cabinet_id = ? AND soumission_id = ?'
  ).get(cabA, soumA1);
  test('dirigeant créé avec fonction', !!dir && dir.nom === 'Marc Bouchard'
    && dir.fonction === 'trésorier', JSON.stringify(dir && { n: dir.nom, f: dir.fonction }));
  const nbVerApres = bd.prepare('SELECT COUNT(*) n FROM do_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  test("version créée (règle d'or)", nbVerApres === nbVerAvant + 1, `${nbVerAvant} → ${nbVerApres}`);

  // ---- 4. Garanties : fusion + avant/après ----------------------------------------
  console.log('4. Garanties / fusion');
  r = await demander(jar, `mets la limite par sinistre à 2 millions et l\u2019agrégat à 2 millions franchise 10000 avec l\u2019avenant pratiques d\u2019emploi pour la soumission D&O ${soumA1}`);
  test('garanties → confirmation avant/après', r.statut === 200
    && r.donnees.confirmation && /limite par sinistre :/.test(r.donnees.confirmation.resume)
    && /→/.test(r.donnees.confirmation.resume)
    && /pratiques d\u2019emploi/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 400));
  const cmdGar = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_do', params: {} };
  r = await confirmer(jar, cmdGar);
  test('garanties mises à jour', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  let g = bd.prepare(
    'SELECT * FROM do_garanties WHERE cabinet_id = ? AND soumission_id = ?'
  ).get(cabA, soumA1);
  const av = JSON.parse(g.avenants || '{}');
  test('garanties en base', !!g && g.limite_par_sinistre === 2000000 && g.limite_agregat === 2000000
    && g.franchise === 10000 && av.pratiques_emploi === 1, JSON.stringify(g && { lps: g.limite_par_sinistre, agg: g.limite_agregat, f: g.franchise, av }));
  r = await demander(jar, `mets la base réclamations présentées pour la soumission D&O ${soumA1}`);
  const cmdGar2 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_do', params: {} };
  r = await confirmer(jar, cmdGar2);
  g = bd.prepare('SELECT * FROM do_garanties WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumA1);
  const av2 = JSON.parse(g.avenants || '{}');
  test('fusion : limites + franchise + avenant conservés, base changée', r.statut === 200
    && g.limite_par_sinistre === 2000000 && g.franchise === 10000
    && av2.pratiques_emploi === 1 && g.base === 'reclamations_presentees', JSON.stringify(g && { f: g.franchise, b: g.base, av: av2 }));
  r = await demander(jar, `retire l\u2019avenant pratiques d\u2019emploi pour la soumission D&O ${soumA1}`);
  const cmdGar3 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_do', params: {} };
  r = await confirmer(jar, cmdGar3);
  g = bd.prepare('SELECT * FROM do_garanties WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumA1);
  test('retrait avenant : pratiques_emploi = 0', r.statut === 200 && JSON.parse(g.avenants).pratiques_emploi === 0, JSON.stringify(g && g.avenants));

  // ---- 5. Modification d'un dirigeant ----------------------------------------------
  console.log('5. Dirigeant');
  r = await demander(jar, `change la fonction du dirigeant Marc Bouchard de la soumission D&O ${soumA1} à président`);
  test('fonction → confirmation', r.statut === 200
    && r.donnees.confirmation && /président/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 250));
  const cmdFonc = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_dirigeant_do', params: {} };
  r = await confirmer(jar, cmdFonc);
  const dir2 = bd.prepare(
    'SELECT * FROM do_dirigeants WHERE cabinet_id = ? AND soumission_id = ?'
  ).get(cabA, soumA1);
  test('fonction changée en base', r.statut === 200 && dir2 && dir2.fonction === 'président', JSON.stringify(dir2 && dir2.fonction));
  r = await demander(jar, `change la fonction du dirigeant Inexistant de la soumission D&O ${soumA1} à président`);
  test('dirigeant introuvable → message clair', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 6. Résolution ambiguë / introuvable ---------------------------------------
  console.log('6. Résolution');
  r = await demander(jar, 'ajoute un dirigeant Test à la soumission D&O de Client Ambigu DO inc.');
  test('2 soumissions D&O → demande de précision', r.statut === 200
    && !r.donnees.confirmation && /Plusieurs soumissions D&O/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jar, 'ajoute un dirigeant Test à la soumission D&O 999');
  test('soumission D&O 999 → introuvable', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un dirigeant Test à la soumission D&O ${soumB}`);
  test('soumission autre cabinet → introuvable (pas de fuite)', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un dirigeant à la soumission D&O ${soumA1}`);
  test('dirigeant sans nom → question', r.statut === 200 && /Quel est le nom du dirigeant/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 7. Navigation -------------------------------------------------------------
  console.log('7. Navigation');
  r = await demander(jar, `montre-moi la soumission D&O ${soumA1}`);
  test('aller_a → redirection /do/N', r.statut === 200 && r.donnees.redirection === `/do/${soumA1}`, JSON.stringify(r.donnees));
  r = await demander(jar, 'ouvre le D&O');
  test('aller_a → /do', r.statut === 200 && r.donnees.redirection === '/do', JSON.stringify(r.donnees));

  // ---- 8. Portefeuille courtier ----------------------------------------------------
  console.log('8. Portefeuille');
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await demander(jarC1, `ajoute un dirigeant Test à la soumission D&O ${soumA1}`);
  test('courtier hors portefeuille → refus poli', r.statut === 200
    && !r.donnees.confirmation && /pas dans votre portefeuille/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jarC1, `ajoute un dirigeant Test à la soumission D&O ${soumPtf}`);
  test('courtier dans son portefeuille → confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_dirigeant_do', JSON.stringify(r.donnees).slice(0, 200));
  const cmdPtf = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_dirigeant_do', params: {} };
  r = await confirmer(jarC1, cmdPtf);
  test('courtier confirme → exécuté', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await confirmer(jar, { action: 'ajouter_dirigeant_do', params: {} }, false);
  test('confirmer sans CSRF → 403', r.statut === 403, r.statut);
  r = await confirmer(jar, { action: 'detruire_tout', params: {} });
  test('action inconnue → message clair', r.statut === 200 && /invalide|expir/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 9. Journal d'audit + règle d'or + données sensibles --------------------------
  console.log('9. Audit');
  const audits = bd.prepare(
    "SELECT COUNT(*) n FROM journal_audit WHERE cabinet_id = ? AND action = 'commande_ia'"
  ).get(cabA).n;
  test('commandes journalisées (commande_ia)', audits >= 10, `trouvées : ${audits}`);
  const src = fs.readFileSync(__dirname + '/../lib/commandes-ia.js', 'utf8');
  test('règle d\u2019or : aucun DELETE FROM do_', !/DELETE\s+FROM\s+do_/i.test(src));
  // Antécédents personnels sensibles : la commande peut les écrire…
  const valeurSensible = 'a fait l\u2019objet d\u2019une poursuite en 2019';
  r = await demander(jar, `change les antécédents personnels du dirigeant Marc Bouchard de la soumission D&O ${soumA1} à ${valeurSensible}`);
  test('antécédents → confirmation SANS réafficher la valeur', r.statut === 200
    && r.donnees.confirmation && /antécédents personnels/.test(r.donnees.confirmation.resume)
    && !/2019/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 300));
  const cmdSens = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_dirigeant_do', params: {} };
  r = await confirmer(jar, cmdSens);
  const dir3 = bd.prepare(
    'SELECT * FROM do_dirigeants WHERE cabinet_id = ? AND soumission_id = ? AND nom = ?'
  ).get(cabA, soumA1, 'Marc Bouchard');
  test('antécédents écrits en base (même cabinet)', r.statut === 200
    && dir3 && dir3.antecedents_personnels === valeurSensible, JSON.stringify(dir3 && dir3.antecedents_personnels));
  test('réponse finale ne réaffiche pas la valeur sensible', !/2019/.test(r.donnees.reponse || ''), JSON.stringify(r.donnees).slice(0, 200));
  // …mais jamais révélés à un autre cabinet.
  const fuite = doLib.obtenirSoumission(soumA1, cabB);
  test('aucune fuite inter-cabinets', fuite === null);

  console.log(`\n${total - echecs}/${total} tests réussis${echecs ? ` — ${echecs} ÉCHECS` : ''}`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
