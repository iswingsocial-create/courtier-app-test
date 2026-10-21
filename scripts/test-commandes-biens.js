/**
 * scripts/test-commandes-biens.js — Commandes texte IA, module biens (étape 8/10 biens) :
 * ajouter_batiment, ajouter_contenu, modifier_garantie_biens, aller_a étendu
 * (« soumission biens N » vs « soumission N »), confirmation avant exécution,
 * périmètre courtier, cloisonnement, journal d'audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-commandes-biens.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
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
  console.log('== Tests commandes IA biens (étape 8/10 biens) :', BASE);
  const commandesIA = require('../lib/commandes-ia');
  const biens = require('../lib/biens');

  // ---- 0. Analyseur local : cas nominaux --------------------------------------
  console.log('0. Analyseur local');
  let a = commandesIA.analyser('ajoute un bâtiment au 123 rue Principale à Montréal construction béton année 1985 superficie 12000 occupation entrepôt valeur 1500000 à la soumission biens 1');
  test('ajouter_batiment complet', a && a.action === 'ajouter_batiment'
    && a.params.adresse === '123 rue Principale' && a.params.ville === 'Montréal'
    && a.params.type_construction === 'beton' && a.params.type_construction_texte === 'béton'
    && a.params.annee_construction === 1985
    && a.params.superficie_pi2 === 12000 && a.params.occupation === 'entrepôt'
    && a.params.valeur_batiment === 1500000 && a.params.soumission_biens_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('rajoute le bâtiment au 45 avenue Papineau à la soumission biens de Méthot');
  test('synonyme « rajoute » + soumission biens par client', a && a.action === 'ajouter_batiment'
    && a.params.adresse === '45 avenue Papineau' && a.params.soumission_client === 'Méthot', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un bâtiment au 123 rue Principale à la soumission 1');
  test('action intrinsèque : « soumission 1 » = soumission biens', a && a.action === 'ajouter_batiment'
    && a.params.soumission_biens_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un contenu outillage 50000 $ au bâtiment 1 de la soumission biens 1');
  test('ajouter_contenu avec $ et bâtiment', a && a.action === 'ajouter_contenu'
    && a.params.description === 'outillage' && a.params.valeur === 50000
    && a.params.batiment_index === 1 && a.params.soumission_biens_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un contenu stocks 25000 au bâtiment 2 de la soumission biens 1');
  test('ajouter_contenu valeur nue', a && a.action === 'ajouter_contenu'
    && a.params.description === 'stocks' && a.params.valeur === 25000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la formule tous risques pour le bâtiment 1 de la soumission biens 1');
  test('modifier_garantie_biens formule', a && a.action === 'modifier_garantie_biens'
    && a.params.formule === 'tous_risques' && a.params.batiment_index === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la formule tous risques et la franchise à 1000 $ pour le bâtiment 1 de la soumission biens 1');
  test('modifier_garantie_biens formule + franchise', a && a.action === 'modifier_garantie_biens'
    && a.params.formule === 'tous_risques' && a.params.franchise === 1000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('passe la formule à risques désignés pour le bâtiment 2 de la soumission biens 1');
  test('modifier_garantie_biens risques désignés', a && a.action === 'modifier_garantie_biens'
    && a.params.formule === 'risques_designes', JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets le montant à 2000000 pour le bâtiment 1 de la soumission biens 1');
  test('modifier_garantie_biens montant', a && a.action === 'modifier_garantie_biens'
    && a.params.montant_assurance === 2000000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission biens 1');
  test('aller_a soumission biens → /biens/1', a && a.action === 'aller_a' && a.params.url === '/biens/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission 1');
  test('aller_a soumission auto → /auto/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/auto/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ouvre les biens');
  test('aller_a « ouvre les biens » → /biens', a && a.action === 'aller_a' && a.params.url === '/biens', JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la RC à 2 millions pour le véhicule 1 de la soumission 1');
  test('commande auto non captée par les biens', a && a.action === 'modifier_garantie', JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute un bâtiment à la soumission biens 1');
  test('adresse manquante détectée', a && a.action === 'ajouter_batiment' && !a.params.adresse, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un bâtiment au 1 rue Test construction paille à la soumission biens 1');
  test('type_construction non reconnu signalé', a && a.action === 'ajouter_batiment'
    && a.params.type_construction === null && a.params.type_construction_texte === 'paille', JSON.stringify(a && a.params));
  test('blague → null', commandesIA.analyser('raconte-moi une blague') === null);
  test('ACTIONS_COHERE inclut les biens', ['ajouter_batiment', 'ajouter_contenu', 'modifier_garantie_biens']
    .every((x) => commandesIA.ACTIONS_COHERE.includes(x)), JSON.stringify(commandesIA.ACTIONS_COHERE));

  // ---- 1. Préparation : 2e cabinet, courtier, clients, soumissions biens --------
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
  ).run(cabA, 'Client Portefeuille inc.', 'Porte', 'Feuille', courtier1).lastInsertRowid;
  const methot = bd.prepare(
    "SELECT id FROM clients WHERE cabinet_id = ? AND raison_sociale = 'Constructions Méthot inc.'"
  ).get(cabA).id;
  const soumMethot1 = biens.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: methot });
  const soumMethot2 = biens.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: methot });
  const soumPtf = biens.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliPtf });
  const soumB = biens.creerSoumission({ cabinetId: cabB, userId: adminB, clientId: null });
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && soumMethot1 > 0 && soumMethot2 > 0 && soumPtf > 0 && soumB > 0);

  // ---- 2. Login admin ----------------------------------------------------------
  console.log('2. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 3. Confirmation requise avant exécution (bâtiment) -----------------------
  console.log('3. Confirmation bâtiment');
  const nbBatAvant = bd.prepare('SELECT COUNT(*) n FROM biens_batiments WHERE cabinet_id = ?').get(cabA).n;
  const nbVerAvant = bd.prepare('SELECT COUNT(*) n FROM biens_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  r = await demander(jar, `ajoute un bâtiment au 123 rue Principale à Montréal construction béton année 1985 superficie 12000 occupation entrepôt valeur 1500000 à la soumission biens ${soumMethot1}`);
  test('commande → 200 + confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_batiment'
    && /123 rue Principale/.test(r.donnees.confirmation.resume)
    && /Confirmez-vous/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 250));
  const nbBatApresDemande = bd.prepare('SELECT COUNT(*) n FROM biens_batiments WHERE cabinet_id = ?').get(cabA).n;
  test('rien exécuté avant confirmation', nbBatApresDemande === nbBatAvant, `${nbBatAvant} → ${nbBatApresDemande}`);
  const cmdBat = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_batiment', params: {} };
  r = await confirmer(jar, cmdBat);
  test("confirmation → 200 « C'est fait »", r.statut === 200 && /C'est fait/.test(r.donnees.reponse) && /123 rue Principale/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const bat = bd.prepare(
    "SELECT * FROM biens_batiments WHERE cabinet_id = ? AND adresse = '123 rue Principale'"
  ).get(cabA);
  test('bâtiment créé avec tous les champs', !!bat && bat.ville === 'Montréal'
    && bat.type_construction === 'beton' && bat.annee_construction === 1985
    && bat.superficie_pi2 === 12000 && bat.occupation === 'entrepôt'
    && bat.valeur_batiment === 1500000, JSON.stringify(bat && { ville: bat.ville, tc: bat.type_construction }));
  const nbVerApres = bd.prepare('SELECT COUNT(*) n FROM biens_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  test("version créée (règle d'or)", nbVerApres === nbVerAvant + 1, `${nbVerAvant} → ${nbVerApres}`);

  // ---- 4. Contenu + garanties ----------------------------------------------------
  console.log('4. Contenu / garanties');
  r = await demander(jar, `ajoute un contenu outillage 50000 $ au bâtiment 1 de la soumission biens ${soumMethot1}`);
  test('contenu → confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_contenu'
    && /outillage/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 200));
  const cmdCont = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_contenu', params: {} };
  r = await confirmer(jar, cmdCont);
  test('contenu créé', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const cont = bd.prepare(
    "SELECT * FROM biens_contenus WHERE cabinet_id = ? AND description = 'outillage'"
  ).get(cabA);
  test('contenu en base, rattaché au bâtiment', !!cont && cont.valeur === 50000 && cont.batiment_id === bat.id, JSON.stringify(cont && { v: cont.valeur, b: cont.batiment_id }));
  r = await demander(jar, `mets la formule tous risques et la franchise à 1000 $ pour le bâtiment 1 de la soumission biens ${soumMethot1}`);
  test('garanties → confirmation', r.statut === 200
    && r.donnees.confirmation && /tous risques/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 200));
  const cmdGar = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garantie_biens', params: {} };
  r = await confirmer(jar, cmdGar);
  test('garanties mises à jour', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  let g = bd.prepare(
    'SELECT * FROM biens_garanties WHERE cabinet_id = ? AND batiment_id = ?'
  ).get(cabA, bat.id);
  test('formule + franchise en base', !!g && g.formule === 'tous_risques' && g.franchise === 1000, JSON.stringify(g && { f: g.formule, fr: g.franchise }));
  r = await demander(jar, `mets la franchise à 2000 $ pour le bâtiment 1 de la soumission biens ${soumMethot1}`);
  const cmdGar2 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garantie_biens', params: {} };
  r = await confirmer(jar, cmdGar2);
  g = bd.prepare('SELECT * FROM biens_garanties WHERE cabinet_id = ? AND batiment_id = ?').get(cabA, bat.id);
  test('fusion : formule conservée, franchise changée', r.statut === 200 && g.formule === 'tous_risques' && g.franchise === 2000, JSON.stringify(g && { f: g.formule, fr: g.franchise }));
  r = await demander(jar, `mets la formule tous risques pour le bâtiment 9 de la soumission biens ${soumMethot1}`);
  test('bâtiment inexistant → message clair', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 5. Résolution ambiguë / introuvable ---------------------------------------
  console.log('5. Résolution');
  r = await demander(jar, 'ajoute un bâtiment au 1 rue Test à la soumission biens de Méthot');
  test('2 soumissions biens Méthot → demande de précision', r.statut === 200
    && !r.donnees.confirmation && /Plusieurs soumissions biens/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jar, 'ajoute un bâtiment au 1 rue Test à la soumission biens 999');
  test('soumission biens 999 → introuvable', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un bâtiment au 1 rue Test à la soumission biens ${soumB}`);
  test('soumission autre cabinet → introuvable (pas de fuite)', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un bâtiment à la soumission biens ${soumMethot1}`);
  test('adresse manquante → question', r.statut === 200 && /adresse/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un bâtiment au 1 rue Test construction paille à la soumission biens ${soumMethot1}`);
  test('type construction inconnu → message clair', r.statut === 200 && /non reconnu/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 6. Navigation -------------------------------------------------------------
  console.log('6. Navigation');
  r = await demander(jar, `montre-moi la soumission biens ${soumMethot1}`);
  test('aller_a → redirection /biens/N', r.statut === 200 && r.donnees.redirection === `/biens/${soumMethot1}`, JSON.stringify(r.donnees));
  r = await demander(jar, 'montre-moi la soumission 1');
  test('aller_a auto → /auto/1 (non-régression)', r.statut === 200 && r.donnees.redirection === '/auto/1', JSON.stringify(r.donnees));
  r = await demander(jar, 'ouvre les biens');
  test('aller_a → /biens', r.statut === 200 && r.donnees.redirection === '/biens', JSON.stringify(r.donnees));

  // ---- 7. Portefeuille courtier ----------------------------------------------------
  console.log('7. Portefeuille');
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await demander(jarC1, `ajoute un bâtiment au 9 rue Hors à la soumission biens ${soumMethot1}`);
  test('courtier hors portefeuille → refus poli', r.statut === 200
    && !r.donnees.confirmation && /pas dans votre portefeuille/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jarC1, `ajoute un bâtiment au 7 rue Portefeuille à la soumission biens ${soumPtf}`);
  test('courtier dans son portefeuille → confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_batiment', JSON.stringify(r.donnees).slice(0, 200));
  const cmdPtf = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_batiment', params: {} };
  r = await confirmer(jarC1, cmdPtf);
  test('courtier confirme → exécuté', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await confirmer(jar, { action: 'ajouter_batiment', params: {} }, false);
  test('confirmer sans CSRF → 403', r.statut === 403, r.statut);
  r = await confirmer(jar, { action: 'detruire_tout', params: {} });
  test('action inconnue → message clair', r.statut === 200 && /invalide|expir/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 8. Journal d'audit -----------------------------------------------------------
  console.log('8. Audit');
  const audits = bd.prepare(
    "SELECT COUNT(*) n FROM journal_audit WHERE cabinet_id = ? AND action = 'commande_ia'"
  ).get(cabA).n;
  test('commandes journalisées (commande_ia)', audits >= 8, `trouvées : ${audits}`);

  console.log(`\n${total - echecs}/${total} tests réussis${echecs ? ` — ${echecs} ÉCHECS` : ''}`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
