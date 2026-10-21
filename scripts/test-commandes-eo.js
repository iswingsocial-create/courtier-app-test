/**
 * scripts/test-commandes-eo.js — Commandes texte IA, module E&O (étape 8/10 E&O) :
 * ajouter_activite_eo, modifier_garanties_eo, modifier_activite_eo,
 * aller_a étendu (« soumission E&O N »), confirmation avant exécution,
 * gardes anti-collision bidirectionnelles avec les 4 autres produits,
 * périmètre courtier, cloisonnement, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-commandes-eo.js
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
  console.log('== Tests commandes IA E&O (étape 8/10 E&O) :', BASE);
  const commandesIA = require('../lib/commandes-ia');
  const eo = require('../lib/eo');

  // ---- 0. Analyseur local : cas nominaux --------------------------------------
  console.log('0. Analyseur local');
  let a = commandesIA.analyser('ajoute l\u2019activité conseil fiscal avec 180 000 $ de chiffre d\u2019affaires à la soumission E&O 2');
  test('ajouter_activite_eo complet (CA ordre inversé)', a && a.action === 'ajouter_activite_eo'
    && a.params.description_activite === 'conseil fiscal' && a.params.chiffre_affaires === 180000
    && a.params.soumission_eo_id === 2, JSON.stringify(a && a.params));
  a = commandesIA.analyser('rajoute une activité tenue de livres 5 professionnels à la soumission E&O 1');
  test('synonyme « rajoute » + nb professionnels', a && a.action === 'ajouter_activite_eo'
    && a.params.description_activite === 'tenue de livres' && a.params.nb_professionnels === 5
    && a.params.soumission_eo_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute une activité audit chiffre d\u2019affaires de 500000 à la soumission E&O 1');
  test('CA ordre direct', a && a.action === 'ajouter_activite_eo'
    && a.params.description_activite === 'audit' && a.params.chiffre_affaires === 500000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute une activité audit à la soumission 1');
  test('action intrinsèque : « soumission 1 » = soumission E&O', a && a.action === 'ajouter_activite_eo'
    && a.params.soumission_eo_id === 1 && a.params.description_activite === 'audit', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute une activité audit à la soumission cyber 1');
  test('autre produit explicite → null', commandesIA.analyser('ajoute une activité audit à la soumission cyber 1') === null);
  a = commandesIA.analyser('mets la franchise de la soumission E&O 1 à 10 000 $');
  test('franchise en fin de phrase', a && a.action === 'modifier_garanties_eo'
    && a.params.franchise === 10000 && a.params.soumission_eo_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la franchise à 5000 $ pour la soumission E&O 1');
  test('franchise immédiate (préposition « pour »)', a && a.action === 'modifier_garanties_eo'
    && a.params.franchise === 5000 && a.params.soumission_eo_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la limite par sinistre à 2 millions et l\u2019agrégat à 1 million pour la soumission E&O 1');
  test('limites', a && a.action === 'modifier_garanties_eo'
    && a.params.limite_par_sinistre === 2000000 && a.params.limite_agregat === 1000000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la base réclamations présentées pour la soumission E&O 1');
  test('base réclamations-présentées', a && a.action === 'modifier_garanties_eo'
    && a.params.base === 'reclamations_presentees', JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la base occurrences pour la soumission E&O 1');
  test('base occurrences', a && a.action === 'modifier_garanties_eo'
    && a.params.base === 'occurrences', JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la prime à 9500 $ pour la soumission E&O 1');
  test('prime', a && a.action === 'modifier_garanties_eo' && a.params.prime === 9500, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute l\u2019avenant frais de défense à la soumission E&O 1');
  test('avenant : ajout frais de défense', a && a.action === 'modifier_garanties_eo'
    && a.params.avenants && a.params.avenants.frais_defense === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('retire l\u2019avenant médias de la soumission E&O 1');
  test('avenant : retrait médias et contenu', a && a.action === 'modifier_garanties_eo'
    && a.params.avenants && a.params.avenants.medias_contenu === 0, JSON.stringify(a && a.params));
  a = commandesIA.analyser('retire l\u2019avenant cyber associé pour la soumission E&O 1');
  test('E&O gagne contre cyber (avenant « cyber associé »)', a && a.action === 'modifier_garanties_eo'
    && a.params.avenants && a.params.avenants.cyber_associe === 0, JSON.stringify(a && a.action));
  a = commandesIA.analyser('change le chiffre d\u2019affaires de l\u2019activité conseil fiscal de la soumission E&O 2 à 200 000 $');
  test('modifier_activite_eo par description', a && a.action === 'modifier_activite_eo'
    && a.params.activite_recherche === 'conseil fiscal' && a.params.chiffre_affaires === 200000
    && a.params.soumission_eo_id === 2, JSON.stringify(a && a.params));
  a = commandesIA.analyser('change le chiffre d\u2019affaires de l\u2019activité 1 de la soumission E&O 2 à 1,2 million');
  test('modifier_activite_eo par n° + million', a && a.action === 'modifier_activite_eo'
    && a.params.activite_index === 1 && a.params.chiffre_affaires === 1200000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute l\u2019avenant rançongiciel pour la soumission cyber 1');
  test('commande cyber non captée par E&O', a && a.action === 'modifier_garanties_cyber', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la limite par sinistre à 2 millions pour le lieu 1 de la soumission RC 1');
  test('commande RC non captée par E&O', a && a.action === 'modifier_garanties_rc', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la RC à 2 millions pour le véhicule 1 de la soumission 1');
  test('commande auto non captée par E&O', a && a.action === 'modifier_garantie', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la formule tous risques pour le bâtiment 1 de la soumission biens 1');
  test('commande biens non captée par E&O', a && a.action === 'modifier_garantie_biens', JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute un lieu au 1 rue Test à la soumission E&O 1');
  test('lieu sur soumission E&O → null (pas RC)', commandesIA.analyser('ajoute un lieu au 1 rue Test à la soumission E&O 1') === null);
  a = commandesIA.analyser('ajoute un bâtiment au 1 rue Test à la soumission E&O 1');
  test('bâtiment sur soumission E&O → null (pas biens)', commandesIA.analyser('ajoute un bâtiment au 1 rue Test à la soumission E&O 1') === null);
  a = commandesIA.analyser('ajoute la mesure MFA à la soumission E&O 1');
  test('mesure sur soumission E&O → null (pas cyber)', commandesIA.analyser('ajoute la mesure MFA à la soumission E&O 1') === null);
  a = commandesIA.analyser('mets la limite par sinistre à 2 millions');
  test('garanties sans marqueur E&O → null', commandesIA.analyser('mets la limite par sinistre à 2 millions') === null);
  a = commandesIA.analyser('montre-moi la soumission E&O 1');
  test('aller_a soumission E&O → /eo/1', a && a.action === 'aller_a' && a.params.url === '/eo/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ouvre l\u2019E&O');
  test('aller_a « ouvre l\u2019E&O » → /eo', a && a.action === 'aller_a' && a.params.url === '/eo', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission 1');
  test('aller_a auto → /auto/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/auto/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission cyber 1');
  test('aller_a cyber → /cyber/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/cyber/1', JSON.stringify(a && a.params));
  test('blague → null', commandesIA.analyser('raconte-moi une blague') === null);
  test('ACTIONS_COHERE inclut E&O', ['ajouter_activite_eo', 'modifier_garanties_eo', 'modifier_activite_eo']
    .every((x) => commandesIA.ACTIONS_COHERE.includes(x)), JSON.stringify(commandesIA.ACTIONS_COHERE));

  // ---- 1. Préparation : 2e cabinet, courtier, clients, soumissions E&O ------------
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
  ).run(cabA, 'Client Portefeuille EO inc.', 'Porte', 'Feuille', courtier1).lastInsertRowid;
  const cliAmb = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)'
  ).run(cabA, 'Client Ambigu EO inc.', 'Ambi', 'Gu').lastInsertRowid;
  const soumA1 = eo.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliAmb });
  const soumA2 = eo.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliAmb });
  const soumPtf = eo.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliPtf });
  const soumB = eo.creerSoumission({ cabinetId: cabB, userId: adminB, clientId: null });
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && soumA1 > 0 && soumA2 > 0 && soumPtf > 0 && soumB > 0);

  // ---- 2. Login admin ----------------------------------------------------------
  console.log('2. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 3. Confirmation requise avant exécution (activité) ----------------------
  console.log('3. Confirmation activité');
  const nbActAvant = bd.prepare('SELECT COUNT(*) n FROM eo_activites WHERE cabinet_id = ?').get(cabA).n;
  const nbVerAvant = bd.prepare('SELECT COUNT(*) n FROM eo_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  r = await demander(jar, `ajoute l\u2019activité conseil fiscal avec 180 000 $ de chiffre d\u2019affaires à la soumission E&O ${soumA1}`);
  test('commande → 200 + confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_activite_eo'
    && /conseil fiscal/.test(r.donnees.confirmation.resume)
    && /180[\s\u00a0\u202f]000/.test(r.donnees.confirmation.resume)
    && /Confirmez-vous/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 300));
  const nbActApresDemande = bd.prepare('SELECT COUNT(*) n FROM eo_activites WHERE cabinet_id = ?').get(cabA).n;
  test('rien exécuté avant confirmation', nbActApresDemande === nbActAvant, `${nbActAvant} → ${nbActApresDemande}`);
  const cmdAct = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_activite_eo', params: {} };
  r = await confirmer(jar, cmdAct);
  test("confirmation → 200 « C'est fait »", r.statut === 200 && /C'est fait/.test(r.donnees.reponse) && /conseil fiscal/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const act = bd.prepare(
    'SELECT * FROM eo_activites WHERE cabinet_id = ? AND soumission_id = ?'
  ).get(cabA, soumA1);
  test('activité créée avec CA', !!act && act.description_activite === 'conseil fiscal'
    && Number(act.chiffre_affaires) === 180000, JSON.stringify(act && { d: act.description_activite, ca: act.chiffre_affaires }));
  const nbVerApres = bd.prepare('SELECT COUNT(*) n FROM eo_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  test("version créée (règle d'or)", nbVerApres === nbVerAvant + 1, `${nbVerAvant} → ${nbVerApres}`);

  // ---- 4. Garanties : fusion -----------------------------------------------------
  console.log('4. Garanties / fusion');
  r = await demander(jar, `mets la limite par sinistre à 2 millions et l\u2019agrégat à 2 millions franchise 10000 avec l\u2019avenant frais de défense pour la soumission E&O ${soumA1}`);
  test('garanties → confirmation', r.statut === 200
    && r.donnees.confirmation && /limite par sinistre/.test(r.donnees.confirmation.resume)
    && /frais de défense/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 300));
  const cmdGar = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_eo', params: {} };
  r = await confirmer(jar, cmdGar);
  test('garanties mises à jour', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  let g = bd.prepare(
    'SELECT * FROM eo_garanties WHERE cabinet_id = ? AND soumission_id = ?'
  ).get(cabA, soumA1);
  const av = JSON.parse(g.avenants || '{}');
  test('garanties en base', !!g && g.limite_par_sinistre === 2000000 && g.limite_agregat === 2000000
    && g.franchise === 10000 && av.frais_defense === 1, JSON.stringify(g && { lps: g.limite_par_sinistre, agg: g.limite_agregat, f: g.franchise, av }));
  r = await demander(jar, `mets la base réclamations présentées pour la soumission E&O ${soumA1}`);
  const cmdGar2 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_eo', params: {} };
  r = await confirmer(jar, cmdGar2);
  g = bd.prepare('SELECT * FROM eo_garanties WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumA1);
  const av2 = JSON.parse(g.avenants || '{}');
  test('fusion : limites + franchise + avenant conservés, base changée', r.statut === 200
    && g.limite_par_sinistre === 2000000 && g.franchise === 10000
    && av2.frais_defense === 1 && g.base === 'reclamations_presentees', JSON.stringify(g && { f: g.franchise, b: g.base, av: av2 }));
  r = await demander(jar, `retire l\u2019avenant frais de défense pour la soumission E&O ${soumA1}`);
  const cmdGar3 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_eo', params: {} };
  r = await confirmer(jar, cmdGar3);
  g = bd.prepare('SELECT * FROM eo_garanties WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumA1);
  test('retrait avenant : frais_defense = 0', r.statut === 200 && JSON.parse(g.avenants).frais_defense === 0, JSON.stringify(g && g.avenants));

  // ---- 5. Chiffre d'affaires d'une activité ----------------------------------------
  console.log('5. Chiffre d\u2019affaires');
  r = await demander(jar, `change le chiffre d\u2019affaires de l\u2019activité conseil fiscal de la soumission E&O ${soumA1} à 200 000 $`);
  test('CA → confirmation', r.statut === 200
    && r.donnees.confirmation && /200[\s\u00a0\u202f]000/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 250));
  const cmdCA = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_activite_eo', params: {} };
  r = await confirmer(jar, cmdCA);
  const act2 = bd.prepare(
    'SELECT * FROM eo_activites WHERE cabinet_id = ? AND soumission_id = ?'
  ).get(cabA, soumA1);
  test('CA changé en base', r.statut === 200 && act2 && Number(act2.chiffre_affaires) === 200000, JSON.stringify(act2 && act2.chiffre_affaires));
  r = await demander(jar, `change le chiffre d\u2019affaires de l\u2019activité inexistante de la soumission E&O ${soumA1} à 50000`);
  test('activité introuvable → message clair', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 6. Résolution ambiguë / introuvable ---------------------------------------
  console.log('6. Résolution');
  r = await demander(jar, 'ajoute une activité audit à la soumission E&O de Client Ambigu EO inc.');
  test('2 soumissions E&O → demande de précision', r.statut === 200
    && !r.donnees.confirmation && /Plusieurs soumissions E&O/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jar, 'ajoute une activité audit à la soumission E&O 999');
  test('soumission E&O 999 → introuvable', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute une activité audit à la soumission E&O ${soumB}`);
  test('soumission autre cabinet → introuvable (pas de fuite)', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute une activité à la soumission E&O ${soumA1}`);
  test('activité sans description → question', r.statut === 200 && /Quelle activité/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 7. Navigation -------------------------------------------------------------
  console.log('7. Navigation');
  r = await demander(jar, `montre-moi la soumission E&O ${soumA1}`);
  test('aller_a → redirection /eo/N', r.statut === 200 && r.donnees.redirection === `/eo/${soumA1}`, JSON.stringify(r.donnees));
  r = await demander(jar, 'ouvre l\u2019E&O');
  test('aller_a → /eo', r.statut === 200 && r.donnees.redirection === '/eo', JSON.stringify(r.donnees));
  r = await demander(jar, 'montre-moi la soumission 1');
  test('aller_a auto → /auto/1 (non-régression)', r.statut === 200 && r.donnees.redirection === '/auto/1', JSON.stringify(r.donnees));
  r = await demander(jar, 'montre-moi la soumission cyber 1');
  test('aller_a cyber → /cyber/1 (non-régression)', r.statut === 200 && r.donnees.redirection === '/cyber/1', JSON.stringify(r.donnees));
  r = await demander(jar, 'montre-moi la soumission RC 1');
  test('aller_a RC → /rc/1 (non-régression)', r.statut === 200 && r.donnees.redirection === '/rc/1', JSON.stringify(r.donnees));

  // ---- 8. Portefeuille courtier ----------------------------------------------------
  console.log('8. Portefeuille');
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await demander(jarC1, `ajoute une activité audit à la soumission E&O ${soumA1}`);
  test('courtier hors portefeuille → refus poli', r.statut === 200
    && !r.donnees.confirmation && /pas dans votre portefeuille/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jarC1, `ajoute une activité audit à la soumission E&O ${soumPtf}`);
  test('courtier dans son portefeuille → confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_activite_eo', JSON.stringify(r.donnees).slice(0, 200));
  const cmdPtf = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_activite_eo', params: {} };
  r = await confirmer(jarC1, cmdPtf);
  test('courtier confirme → exécuté', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await confirmer(jar, { action: 'ajouter_activite_eo', params: {} }, false);
  test('confirmer sans CSRF → 403', r.statut === 403, r.statut);
  r = await confirmer(jar, { action: 'detruire_tout', params: {} });
  test('action inconnue → message clair', r.statut === 200 && /invalide|expir/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 9. Journal d'audit + règle d'or ----------------------------------------------
  console.log('9. Audit');
  const audits = bd.prepare(
    "SELECT COUNT(*) n FROM journal_audit WHERE cabinet_id = ? AND action = 'commande_ia'"
  ).get(cabA).n;
  test('commandes journalisées (commande_ia)', audits >= 8, `trouvées : ${audits}`);
  const src = fs.readFileSync(__dirname + '/../lib/commandes-ia.js', 'utf8');
  test('règle d\u2019or : aucun DELETE FROM eo_', !/DELETE\s+FROM\s+eo_/i.test(src));

  console.log(`\n${total - echecs}/${total} tests réussis${echecs ? ` — ${echecs} ÉCHECS` : ''}`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
