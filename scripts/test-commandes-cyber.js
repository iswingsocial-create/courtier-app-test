/**
 * scripts/test-commandes-cyber.js — Commandes texte IA, module cyber (étape 8/10 cyber) :
 * ajouter_mesure_cyber, modifier_garanties_cyber, modifier_maturite_mesure,
 * aller_a étendu (« soumission cyber N » vs « soumission RC N » vs
 * « soumission biens N » vs « soumission N »), confirmation avant exécution,
 * périmètre courtier, cloisonnement, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-commandes-cyber.js
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
  console.log('== Tests commandes IA cyber (étape 8/10 cyber) :', BASE);
  const commandesIA = require('../lib/commandes-ia');
  const cyber = require('../lib/cyber');

  // ---- 0. Analyseur local : cas nominaux --------------------------------------
  console.log('0. Analyseur local');
  let a = commandesIA.analyser('ajoute la mesure MFA en place à la soumission cyber 2');
  test('ajouter_mesure_cyber complet', a && a.action === 'ajouter_mesure_cyber'
    && a.params.type_mesure === 'mfa' && a.params.statut === 'en_place'
    && a.params.soumission_cyber_id === 2, JSON.stringify(a && a.params));
  a = commandesIA.analyser('rajoute une mesure de sécurité sauvegardes hors site en place à la soumission cyber de Lépine');
  test('synonyme « rajoute » + détails + client', a && a.action === 'ajouter_mesure_cyber'
    && a.params.type_mesure === 'sauvegardes' && a.params.details === 'hors site'
    && a.params.statut === 'en_place' && a.params.soumission_client === 'Lépine', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute la mesure antivirus EDR à la soumission 1');
  test('action intrinsèque : « soumission 1 » = soumission cyber', a && a.action === 'ajouter_mesure_cyber'
    && a.params.type_mesure === 'antivirus_edr' && a.params.soumission_cyber_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute la mesure laser quantique à la soumission cyber 1');
  test('type inconnu → type_mesure_texte', a && a.action === 'ajouter_mesure_cyber'
    && !a.params.type_mesure && a.params.type_mesure_texte === 'laser quantique', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute la mesure pare-feu à la soumission cyber 1');
  test('pare-feu sans maturité', a && a.action === 'ajouter_mesure_cyber'
    && a.params.type_mesure === 'pare_feu' && !a.params.statut, JSON.stringify(a && a.params));
  a = commandesIA.analyser("mets la limite par sinistre à 2 millions et l'agrégat à 4 millions sur la soumission cyber 1");
  test('modifier_garanties_cyber limites', a && a.action === 'modifier_garanties_cyber'
    && a.params.limite_par_sinistre === 2000000 && a.params.limite_agregat === 4000000
    && a.params.soumission_cyber_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser("ajoute l'avenant rançongiciel et retire l'avenant interruption pour la soumission cyber 1");
  test('avenants : ajout + retrait', a && a.action === 'modifier_garanties_cyber'
    && a.params.avenants && a.params.avenants.rancongiciel === 1
    && a.params.avenants.interruption === 0, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la franchise à 5000 $ et la carence à 24 heures pour la soumission cyber 1');
  test('franchise + carence (préposition « pour »)', a && a.action === 'modifier_garanties_cyber'
    && a.params.franchise === 5000 && a.params.delai_carence === '24 heures'
    && a.params.soumission_cyber_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la prime à 5000 $ pour la soumission cyber 1');
  test('prime', a && a.action === 'modifier_garanties_cyber' && a.params.prime === 5000, JSON.stringify(a && a.params));
  a = commandesIA.analyser("retire l'avenant données et vie privée pour la soumission cyber 1");
  test('retrait avenant données et vie privée', a && a.action === 'modifier_garanties_cyber'
    && a.params.avenants && a.params.avenants.donnees_vie_privee === 0, JSON.stringify(a && a.params));
  a = commandesIA.analyser('passe la mesure MFA en partiel sur la soumission cyber 1');
  test('modifier_maturite_mesure par type', a && a.action === 'modifier_maturite_mesure'
    && a.params.mesure_type === 'mfa' && a.params.statut === 'partiel'
    && a.params.soumission_cyber_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la mesure 2 en place sur la soumission cyber 1');
  test('modifier_maturite_mesure par n°', a && a.action === 'modifier_maturite_mesure'
    && a.params.mesure_index === 2 && a.params.statut === 'en_place', JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la limite par sinistre à 2 millions pour le lieu 1 de la soumission cyber 1');
  test('cyber gagne contre RC (pas de capture RC)', a && a.action === 'modifier_garanties_cyber'
    && a.params.limite_par_sinistre === 2000000 && a.params.soumission_cyber_id === 1, JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la limite par sinistre à 2 millions pour le lieu 1 de la soumission RC 1');
  test('commande RC non captée par cyber', a && a.action === 'modifier_garanties_rc'
    && a.params.soumission_rc_id === 1, JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la RC à 2 millions pour le véhicule 1 de la soumission 1');
  test('commande auto non captée par cyber', a && a.action === 'modifier_garantie', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la formule tous risques pour le bâtiment 1 de la soumission biens 1');
  test('commande biens non captée par cyber', a && a.action === 'modifier_garantie_biens', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la limite par sinistre à 2 millions');
  test('garanties sans marqueur cyber → null', commandesIA.analyser('mets la limite par sinistre à 2 millions') === null);
  a = commandesIA.analyser('ajoute un lieu au 1 rue Test à la soumission cyber 1');
  test('lieu sur soumission cyber → null (pas RC)', commandesIA.analyser('ajoute un lieu au 1 rue Test à la soumission cyber 1') === null);
  a = commandesIA.analyser('montre-moi la soumission cyber 1');
  test('aller_a soumission cyber → /cyber/1', a && a.action === 'aller_a' && a.params.url === '/cyber/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ouvre le cyber');
  test('aller_a « ouvre le cyber » → /cyber', a && a.action === 'aller_a' && a.params.url === '/cyber', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission 1');
  test('aller_a auto → /auto/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/auto/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission RC 1');
  test('aller_a RC → /rc/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/rc/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission biens 1');
  test('aller_a biens → /biens/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/biens/1', JSON.stringify(a && a.params));
  test('blague → null', commandesIA.analyser('raconte-moi une blague') === null);
  test('ACTIONS_COHERE inclut cyber', ['ajouter_mesure_cyber', 'modifier_garanties_cyber', 'modifier_maturite_mesure']
    .every((x) => commandesIA.ACTIONS_COHERE.includes(x)), JSON.stringify(commandesIA.ACTIONS_COHERE));

  // ---- 1. Préparation : 2e cabinet, courtier, clients, soumissions cyber -------
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
  ).run(cabA, 'Client Portefeuille Cyber inc.', 'Porte', 'Feuille', courtier1).lastInsertRowid;
  const bouchard = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)'
  ).run(cabA, 'Boulangerie Lépine Test inc.', 'Marie', 'Lépine').lastInsertRowid;
  const soumBou1 = cyber.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: bouchard });
  const soumBou2 = cyber.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: bouchard });
  const soumPtf = cyber.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliPtf });
  const soumB = cyber.creerSoumission({ cabinetId: cabB, userId: adminB, clientId: null });
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && soumBou1 > 0 && soumBou2 > 0 && soumPtf > 0 && soumB > 0);

  // ---- 2. Login admin ----------------------------------------------------------
  console.log('2. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 3. Confirmation requise avant exécution (mesure) ------------------------
  console.log('3. Confirmation mesure');
  const nbMesAvant = bd.prepare('SELECT COUNT(*) n FROM cyber_mesures WHERE cabinet_id = ?').get(cabA).n;
  const nbVerAvant = bd.prepare('SELECT COUNT(*) n FROM cyber_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  r = await demander(jar, `ajoute la mesure MFA en place détails sur tous les accès admin à la soumission cyber ${soumBou1}`);
  test('commande → 200 + confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_mesure_cyber'
    && /MFA — authentification multifacteur/.test(r.donnees.confirmation.resume)
    && /En place/.test(r.donnees.confirmation.resume)
    && /Confirmez-vous/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 300));
  const nbMesApresDemande = bd.prepare('SELECT COUNT(*) n FROM cyber_mesures WHERE cabinet_id = ?').get(cabA).n;
  test('rien exécuté avant confirmation', nbMesApresDemande === nbMesAvant, `${nbMesAvant} → ${nbMesApresDemande}`);
  const cmdMes = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_mesure_cyber', params: {} };
  r = await confirmer(jar, cmdMes);
  test("confirmation → 200 « C'est fait »", r.statut === 200 && /C'est fait/.test(r.donnees.reponse) && /MFA/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const mes = bd.prepare(
    "SELECT * FROM cyber_mesures WHERE cabinet_id = ? AND soumission_id = ? AND type_mesure = 'mfa'"
  ).get(cabA, soumBou1);
  test('mesure créée avec type + maturité', !!mes && mes.statut === 'en_place', JSON.stringify(mes && { t: mes.type_mesure, s: mes.statut }));
  const nbVerApres = bd.prepare('SELECT COUNT(*) n FROM cyber_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  test("version créée (règle d'or)", nbVerApres === nbVerAvant + 1, `${nbVerAvant} → ${nbVerApres}`);

  // ---- 4. Garanties : fusion -----------------------------------------------------
  console.log('4. Garanties / fusion');
  r = await demander(jar, `mets la limite par sinistre à 2 millions et l'agrégat à 4 millions franchise 5000 avec l'avenant rançongiciel pour la soumission cyber ${soumBou1}`);
  test('garanties → confirmation', r.statut === 200
    && r.donnees.confirmation && /limite par sinistre/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 250));
  const cmdGar = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_cyber', params: {} };
  r = await confirmer(jar, cmdGar);
  test('garanties mises à jour', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  let g = bd.prepare(
    'SELECT * FROM cyber_garanties WHERE cabinet_id = ? AND soumission_id = ?'
  ).get(cabA, soumBou1);
  const av = JSON.parse(g.avenants || '{}');
  test('garanties en base', !!g && g.limite_par_sinistre === 2000000 && g.limite_agregat === 4000000
    && g.franchise === 5000 && av.rancongiciel === 1, JSON.stringify(g && { lps: g.limite_par_sinistre, agg: g.limite_agregat, f: g.franchise, av }));
  r = await demander(jar, `mets la carence à 8 heures pour la soumission cyber ${soumBou1}`);
  const cmdGar2 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_cyber', params: {} };
  r = await confirmer(jar, cmdGar2);
  g = bd.prepare('SELECT * FROM cyber_garanties WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumBou1);
  const av2 = JSON.parse(g.avenants || '{}');
  test('fusion : limites + franchise + avenant conservés, carence changée', r.statut === 200
    && g.limite_par_sinistre === 2000000 && g.limite_agregat === 4000000
    && g.franchise === 5000 && av2.rancongiciel === 1 && g.delai_carence === '8 heures', JSON.stringify(g && { fr: g.franchise, car: g.delai_carence, av: av2 }));
  r = await demander(jar, `retire l'avenant rançongiciel pour la soumission cyber ${soumBou1}`);
  const cmdGar3 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_cyber', params: {} };
  r = await confirmer(jar, cmdGar3);
  g = bd.prepare('SELECT * FROM cyber_garanties WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumBou1);
  test('retrait avenant : rancongiciel = 0', r.statut === 200 && JSON.parse(g.avenants).rancongiciel === 0, JSON.stringify(g && g.avenants));

  // ---- 5. Maturité --------------------------------------------------------------
  console.log('5. Maturité');
  r = await demander(jar, `passe la mesure MFA en partiel sur la soumission cyber ${soumBou1}`);
  test('maturité → confirmation', r.statut === 200
    && r.donnees.confirmation && /Partiel/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 250));
  const cmdMat = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_maturite_mesure', params: {} };
  r = await confirmer(jar, cmdMat);
  const mes2 = bd.prepare(
    "SELECT * FROM cyber_mesures WHERE cabinet_id = ? AND soumission_id = ? AND type_mesure = 'mfa'"
  ).get(cabA, soumBou1);
  test('maturité changée en base', r.statut === 200 && mes2 && mes2.statut === 'partiel', JSON.stringify(mes2 && mes2.statut));
  r = await demander(jar, `passe la mesure 9 en place sur la soumission cyber ${soumBou1}`);
  test('mesure inexistante → message clair', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 6. Résolution ambiguë / introuvable ---------------------------------------
  console.log('6. Résolution');
  r = await demander(jar, 'ajoute la mesure MFA à la soumission cyber de Lépine');
  test('2 soumissions cyber Bouchard → demande de précision', r.statut === 200
    && !r.donnees.confirmation && /Plusieurs soumissions cyber/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jar, 'ajoute la mesure MFA à la soumission cyber 999');
  test('soumission cyber 999 → introuvable', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute la mesure MFA à la soumission cyber ${soumB}`);
  test('soumission autre cabinet → introuvable (pas de fuite)', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute la mesure laser quantique à la soumission cyber ${soumBou1}`);
  test('type inconnu → liste des choix', r.statut === 200 && /non reconnu/.test(r.donnees.reponse) && /MFA/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 7. Navigation -------------------------------------------------------------
  console.log('7. Navigation');
  r = await demander(jar, `montre-moi la soumission cyber ${soumBou1}`);
  test('aller_a → redirection /cyber/N', r.statut === 200 && r.donnees.redirection === `/cyber/${soumBou1}`, JSON.stringify(r.donnees));
  r = await demander(jar, 'montre-moi la soumission 1');
  test('aller_a auto → /auto/1 (non-régression)', r.statut === 200 && r.donnees.redirection === '/auto/1', JSON.stringify(r.donnees));
  r = await demander(jar, 'montre-moi la soumission RC 1');
  test('aller_a RC → /rc/1 (non-régression)', r.statut === 200 && r.donnees.redirection === '/rc/1', JSON.stringify(r.donnees));
  r = await demander(jar, 'montre-moi la soumission biens 1');
  test('aller_a biens → /biens/1 (non-régression)', r.statut === 200 && r.donnees.redirection === '/biens/1', JSON.stringify(r.donnees));
  r = await demander(jar, 'ouvre le cyber');
  test('aller_a → /cyber', r.statut === 200 && r.donnees.redirection === '/cyber', JSON.stringify(r.donnees));

  // ---- 8. Portefeuille courtier ----------------------------------------------------
  console.log('8. Portefeuille');
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await demander(jarC1, `ajoute la mesure MFA à la soumission cyber ${soumBou1}`);
  test('courtier hors portefeuille → refus poli', r.statut === 200
    && !r.donnees.confirmation && /pas dans votre portefeuille/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jarC1, `ajoute la mesure MFA en place à la soumission cyber ${soumPtf}`);
  test('courtier dans son portefeuille → confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_mesure_cyber', JSON.stringify(r.donnees).slice(0, 200));
  const cmdPtf = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_mesure_cyber', params: {} };
  r = await confirmer(jarC1, cmdPtf);
  test('courtier confirme → exécuté', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await confirmer(jar, { action: 'ajouter_mesure_cyber', params: {} }, false);
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
  test('règle d\u2019or : aucun DELETE FROM cyber_', !/DELETE\s+FROM\s+cyber_/i.test(src));

  console.log(`\n${total - echecs}/${total} tests réussis${echecs ? ` — ${echecs} ÉCHECS` : ''}`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
