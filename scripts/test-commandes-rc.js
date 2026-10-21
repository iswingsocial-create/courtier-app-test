/**
 * scripts/test-commandes-rc.js — Commandes texte IA, module RC (étape 8/10 RC) :
 * ajouter_lieu_rc, modifier_garanties_rc, aller_a étendu
 * (« soumission RC N » vs « soumission biens N » vs « soumission N »),
 * confirmation avant exécution, périmètre courtier, cloisonnement, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-commandes-rc.js
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
  console.log('== Tests commandes IA RC (étape 8/10 RC) :', BASE);
  const commandesIA = require('../lib/commandes-ia');
  const rc = require('../lib/rc');

  // ---- 0. Analyseur local : cas nominaux --------------------------------------
  console.log('0. Analyseur local');
  let a = commandesIA.analyser("ajoute un lieu au 456 boulevard Industriel à Laval activité entrepôt chiffre d'affaires 1,2 million à la soumission RC 1");
  test('ajouter_lieu_rc complet', a && a.action === 'ajouter_lieu_rc'
    && a.params.adresse === '456 boulevard Industriel' && a.params.ville === 'Laval'
    && a.params.type_activite === 'entrepôt'
    && a.params.chiffre_affaires === 1200000 && a.params.soumission_rc_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('rajoute le lieu au 78 rue Principale activité déneigement masse salariale 800000 employés 25 sous-traitants assurés à la soumission RC de Méthot');
  test('synonyme « rajoute » + lieu complet + client', a && a.action === 'ajouter_lieu_rc'
    && a.params.adresse === '78 rue Principale' && a.params.type_activite === 'déneigement'
    && a.params.masse_salariale === 800000 && a.params.nb_employes === 25
    && a.params.sous_traitants === 'assures' && a.params.soumission_client === 'Méthot', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un lieu au 9 rue Test activité rénovation code de classification 91585 code postal H7S 1A1 à la soumission RC 1');
  test('code de classification + code postal', a && a.action === 'ajouter_lieu_rc'
    && a.params.code_classification === '91585' && a.params.code_postal === 'H7S 1A1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute une exploitation au 3 rue B à la soumission RC 1');
  test('synonyme « exploitation »', a && a.action === 'ajouter_lieu_rc'
    && a.params.adresse === '3 rue B' && a.params.soumission_rc_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un lieu au 123 rue Principale à la soumission 1');
  test('action intrinsèque : « soumission 1 » = soumission RC', a && a.action === 'ajouter_lieu_rc'
    && a.params.soumission_rc_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la limite par sinistre à 2 millions pour le lieu 1 de la soumission RC 1');
  test('modifier_garanties_rc limite par sinistre', a && a.action === 'modifier_garanties_rc'
    && a.params.limite_par_sinistre === 2000000 && a.params.exploitation_index === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser("mets la limite par sinistre à 2 millions et l'agrégat à 4 millions franchise 5000 formule globale avec l'avenant pollution pour le lieu 1 de la soumission RC 1");
  test('modifier_garanties_rc complet', a && a.action === 'modifier_garanties_rc'
    && a.params.limite_par_sinistre === 2000000 && a.params.limite_agregat === 4000000
    && a.params.franchise === 5000 && a.params.formule === 'globale'
    && a.params.avenants && a.params.avenants.pollution === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la formule locaux et opérations avec un parapluie pour le lieu 2 de la soumission RC 1');
  test('formule locaux et opérations + parapluie', a && a.action === 'modifier_garanties_rc'
    && a.params.formule === 'locaux_operations' && a.params.avenants && a.params.avenants.parapluie === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la formule produits et opérations complétées pour le lieu 1 de la soumission RC 1');
  test('formule produits et opérations complétées', a && a.action === 'modifier_garanties_rc'
    && a.params.formule === 'produits_completes', JSON.stringify(a && a.params));
  a = commandesIA.analyser('retire l\u2019avenant pollution pour le lieu 1 de la soumission RC 1');
  test('retrait avenant pollution', a && a.action === 'modifier_garanties_rc'
    && a.params.avenants && a.params.avenants.pollution === 0, JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission RC 1');
  test('aller_a soumission RC → /rc/1', a && a.action === 'aller_a' && a.params.url === '/rc/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ouvre les RC');
  test('aller_a « ouvre les RC » → /rc', a && a.action === 'aller_a' && a.params.url === '/rc', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission 1');
  test('aller_a soumission auto → /auto/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/auto/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission biens 1');
  test('aller_a soumission biens → /biens/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/biens/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la RC à 2 millions pour le véhicule 1 de la soumission 1');
  test('commande auto non captée par RC', a && a.action === 'modifier_garantie', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la formule tous risques pour le bâtiment 1 de la soumission biens 1');
  test('commande biens non captée par RC', a && a.action === 'modifier_garantie_biens', JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute un lieu à la soumission RC 1');
  test('adresse manquante détectée', a && a.action === 'ajouter_lieu_rc' && !a.params.adresse, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la garantie à jour');
  test('garantie sans lieu → null (pas de capture RC)', commandesIA.analyser('mets la garantie à jour') === null);
  test('blague → null', commandesIA.analyser('raconte-moi une blague') === null);
  test('ACTIONS_COHERE inclut RC', ['ajouter_lieu_rc', 'modifier_garanties_rc']
    .every((x) => commandesIA.ACTIONS_COHERE.includes(x)), JSON.stringify(commandesIA.ACTIONS_COHERE));

  // ---- 1. Préparation : 2e cabinet, courtier, clients, soumissions RC -----------
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
  ).run(cabA, 'Client Portefeuille RC inc.', 'Porte', 'Feuille', courtier1).lastInsertRowid;
  const methot = bd.prepare(
    "SELECT id FROM clients WHERE cabinet_id = ? AND raison_sociale = 'Constructions Méthot inc.'"
  ).get(cabA).id;
  const soumMethot1 = rc.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: methot });
  const soumMethot2 = rc.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: methot });
  const soumPtf = rc.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliPtf });
  const soumB = rc.creerSoumission({ cabinetId: cabB, userId: adminB, clientId: null });
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && soumMethot1 > 0 && soumMethot2 > 0 && soumPtf > 0 && soumB > 0);

  // ---- 2. Login admin ----------------------------------------------------------
  console.log('2. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 3. Confirmation requise avant exécution (lieu) ---------------------------
  console.log('3. Confirmation lieu');
  const nbLieuxAvant = bd.prepare('SELECT COUNT(*) n FROM rc_exploitations WHERE cabinet_id = ?').get(cabA).n;
  const nbVerAvant = bd.prepare('SELECT COUNT(*) n FROM rc_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  r = await demander(jar, `ajoute un lieu au 456 boulevard Industriel à Laval activité entrepôt chiffre d'affaires 1,2 million à la soumission RC ${soumMethot1}`);
  test('commande → 200 + confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_lieu_rc'
    && /456 boulevard Industriel/.test(r.donnees.confirmation.resume)
    && /Confirmez-vous/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 300));
  const nbLieuxApresDemande = bd.prepare('SELECT COUNT(*) n FROM rc_exploitations WHERE cabinet_id = ?').get(cabA).n;
  test('rien exécuté avant confirmation', nbLieuxApresDemande === nbLieuxAvant, `${nbLieuxAvant} → ${nbLieuxApresDemande}`);
  const cmdLieu = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_lieu_rc', params: {} };
  r = await confirmer(jar, cmdLieu);
  test("confirmation → 200 « C'est fait »", r.statut === 200 && /C'est fait/.test(r.donnees.reponse) && /456 boulevard Industriel/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const lieu = bd.prepare(
    "SELECT * FROM rc_exploitations WHERE cabinet_id = ? AND adresse = '456 boulevard Industriel'"
  ).get(cabA);
  test('lieu créé avec tous les champs', !!lieu && lieu.ville === 'Laval'
    && lieu.type_activite === 'entrepôt' && lieu.chiffre_affaires === 1200000, JSON.stringify(lieu && { v: lieu.ville, a: lieu.type_activite, ca: lieu.chiffre_affaires }));
  const nbVerApres = bd.prepare('SELECT COUNT(*) n FROM rc_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  test("version créée (règle d'or)", nbVerApres === nbVerAvant + 1, `${nbVerAvant} → ${nbVerApres}`);

  // ---- 4. Garanties : fusion -----------------------------------------------------
  console.log('4. Garanties / fusion');
  r = await demander(jar, `mets la limite par sinistre à 2 millions et l'agrégat à 4 millions franchise 5000 formule globale avec l'avenant pollution pour le lieu 1 de la soumission RC ${soumMethot1}`);
  test('garanties → confirmation', r.statut === 200
    && r.donnees.confirmation && /limite par sinistre/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 250));
  const cmdGar = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_rc', params: {} };
  r = await confirmer(jar, cmdGar);
  test('garanties mises à jour', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  let g = bd.prepare(
    'SELECT * FROM rc_garanties WHERE cabinet_id = ? AND exploitation_id = ?'
  ).get(cabA, lieu.id);
  const av = JSON.parse(g.avenants || '{}');
  test('garanties en base', !!g && g.limite_par_sinistre === 2000000 && g.limite_agregat === 4000000
    && g.franchise === 5000 && g.formule === 'globale' && av.pollution === 1, JSON.stringify(g && { lps: g.limite_par_sinistre, agg: g.limite_agregat, f: g.franchise, form: g.formule, av }));
  r = await demander(jar, `mets la franchise à 7500 $ pour le lieu 1 de la soumission RC ${soumMethot1}`);
  const cmdGar2 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_rc', params: {} };
  r = await confirmer(jar, cmdGar2);
  g = bd.prepare('SELECT * FROM rc_garanties WHERE cabinet_id = ? AND exploitation_id = ?').get(cabA, lieu.id);
  const av2 = JSON.parse(g.avenants || '{}');
  test('fusion : limites + formule + avenant conservés, franchise changée', r.statut === 200
    && g.limite_par_sinistre === 2000000 && g.limite_agregat === 4000000
    && g.formule === 'globale' && av2.pollution === 1 && g.franchise === 7500, JSON.stringify(g && { f: g.formule, fr: g.franchise, av: av2 }));
  r = await demander(jar, `retire l'avenant pollution pour le lieu 1 de la soumission RC ${soumMethot1}`);
  const cmdGar3 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_rc', params: {} };
  r = await confirmer(jar, cmdGar3);
  g = bd.prepare('SELECT * FROM rc_garanties WHERE cabinet_id = ? AND exploitation_id = ?').get(cabA, lieu.id);
  test('retrait avenant : pollution = 0', r.statut === 200 && JSON.parse(g.avenants).pollution === 0, JSON.stringify(g && g.avenants));
  r = await demander(jar, `mets la limite par sinistre à 2 millions pour le lieu 9 de la soumission RC ${soumMethot1}`);
  test('lieu inexistant → message clair', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 5. Résolution ambiguë / introuvable ---------------------------------------
  console.log('5. Résolution');
  r = await demander(jar, 'ajoute un lieu au 1 rue Test à la soumission RC de Méthot');
  test('2 soumissions RC Méthot → demande de précision', r.statut === 200
    && !r.donnees.confirmation && /Plusieurs soumissions RC/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jar, 'ajoute un lieu au 1 rue Test à la soumission RC 999');
  test('soumission RC 999 → introuvable', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un lieu au 1 rue Test à la soumission RC ${soumB}`);
  test('soumission autre cabinet → introuvable (pas de fuite)', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un lieu à la soumission RC ${soumMethot1}`);
  test('adresse manquante → question', r.statut === 200 && /adresse/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 6. Navigation -------------------------------------------------------------
  console.log('6. Navigation');
  r = await demander(jar, `montre-moi la soumission RC ${soumMethot1}`);
  test('aller_a → redirection /rc/N', r.statut === 200 && r.donnees.redirection === `/rc/${soumMethot1}`, JSON.stringify(r.donnees));
  r = await demander(jar, 'montre-moi la soumission 1');
  test('aller_a auto → /auto/1 (non-régression)', r.statut === 200 && r.donnees.redirection === '/auto/1', JSON.stringify(r.donnees));
  r = await demander(jar, 'montre-moi la soumission biens 1');
  test('aller_a biens → /biens/1 (non-régression)', r.statut === 200 && r.donnees.redirection === '/biens/1', JSON.stringify(r.donnees));
  r = await demander(jar, 'ouvre les RC');
  test('aller_a → /rc', r.statut === 200 && r.donnees.redirection === '/rc', JSON.stringify(r.donnees));

  // ---- 7. Portefeuille courtier ----------------------------------------------------
  console.log('7. Portefeuille');
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await demander(jarC1, `ajoute un lieu au 9 rue Hors à la soumission RC ${soumMethot1}`);
  test('courtier hors portefeuille → refus poli', r.statut === 200
    && !r.donnees.confirmation && /pas dans votre portefeuille/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jarC1, `ajoute un lieu au 7 rue Portefeuille à la soumission RC ${soumPtf}`);
  test('courtier dans son portefeuille → confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_lieu_rc', JSON.stringify(r.donnees).slice(0, 200));
  const cmdPtf = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_lieu_rc', params: {} };
  r = await confirmer(jarC1, cmdPtf);
  test('courtier confirme → exécuté', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await confirmer(jar, { action: 'ajouter_lieu_rc', params: {} }, false);
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
