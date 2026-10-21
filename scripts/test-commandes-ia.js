/**
 * scripts/test-commandes-ia.js — Commande texte IA (étape 8/10) :
 * interpréteur français (ajouter_conducteur, ajouter_vehicule, modifier_garantie,
 * creer_rappel, aller_a, rechercher), confirmation avant exécution, périmètre
 * courtier, cloisonnement, journal d'audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-commandes-ia.js
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
  console.log('== Tests commandes IA (étape 8/10) :', BASE);
  const commandesIA = require('../lib/commandes-ia');

  // ---- 0. Analyseur local : cas nominaux --------------------------------------
  console.log('0. Analyseur local');
  let a = commandesIA.analyser('ajoute un conducteur Marie Tremblay permis T1234567 à la soumission 1');
  test('ajouter_conducteur reconnu', a && a.action === 'ajouter_conducteur'
    && a.params.prenom === 'Marie' && a.params.nom === 'Tremblay'
    && a.params.numero_permis === 'T1234567' && a.params.soumission_id === 1, JSON.stringify(a));
  a = commandesIA.analyser("rajoute le conducteur Jean Côté à la soumission de Dubois");
  test('synonyme « rajoute » + soumission par client', a && a.action === 'ajouter_conducteur'
    && a.params.prenom === 'Jean' && a.params.nom === 'Côté' && a.params.soumission_client === 'Dubois', JSON.stringify(a));
  a = commandesIA.analyser('ajoute un véhicule Honda CR-V 2022 vin 2HKRW2H54NH123456 à la soumission 1');
  test('ajouter_vehicule reconnu', a && a.action === 'ajouter_vehicule'
    && a.params.marque === 'Honda' && a.params.modele === 'CR-V' && a.params.annee === 2022
    && a.params.vin === '2HKRW2H54NH123456', JSON.stringify(a));
  a = commandesIA.analyser('mets la RC à 2 millions pour le véhicule 1 de la soumission 1');
  test('modifier_garantie RC 2M', a && a.action === 'modifier_garantie'
    && a.params.rc_montant === 2000000 && a.params.vehicule_index === 1 && a.params.soumission_id === 1, JSON.stringify(a));
  a = commandesIA.analyser('passe la protection B à B1 sur le véhicule 1 de la soumission 2');
  test('modifier_garantie protection B1', a && a.action === 'modifier_garantie'
    && a.params.protection_b === 'b1', JSON.stringify(a));
  a = commandesIA.analyser('change la franchise à 500 pour le véhicule 2 de la soumission 1');
  test('modifier_garantie franchise', a && a.action === 'modifier_garantie'
    && a.params.franchise_b === 500, JSON.stringify(a));
  a = commandesIA.analyser('rappelle-moi de rappeler Martin Dubois pour Martin Dubois demain');
  test('creer_rappel reconnu', a && a.action === 'creer_rappel'
    && a.params.titre === 'rappeler Martin Dubois' && a.params.entreprise === 'Martin Dubois'
    && /^\d{4}-\d{2}-\d{2}$/.test(a.params.echeance), JSON.stringify(a));
  a = commandesIA.analyser('montre-moi la soumission 1');
  test('aller_a soumission', a && a.action === 'aller_a' && a.params.url === '/auto/1', JSON.stringify(a));
  a = commandesIA.analyser('ouvre les échéances');
  test('aller_a échéances (accent)', a && a.action === 'aller_a' && a.params.url === '/echeances', JSON.stringify(a));
  a = commandesIA.analyser('cherche le client Dubois');
  test('rechercher client', a && a.action === 'rechercher' && a.params.type === 'client'
    && a.params.terme === 'Dubois', JSON.stringify(a));
  a = commandesIA.analyser('cherche la police AUTO-2026-001');
  test('rechercher police', a && a.action === 'rechercher' && a.params.type === 'police', JSON.stringify(a));
  // Non-régression : l'analyseur historique garde ses commandes.
  test('« ajoute le contact » non capté', commandesIA.analyser('ajoute le contact Luc Berger chez Gamma') === null);
  test('« crée une tâche » non capté', commandesIA.analyser('crée une tâche appeler le comptable pour Gamma') === null);
  test('blague → null', commandesIA.analyser('raconte-moi une blague') === null);
  a = commandesIA.analyser('ajoute un conducteur à la soumission 1');
  test('nom manquant détecté', a && a.action === 'ajouter_conducteur' && !a.params.prenom, JSON.stringify(a));

  // ---- 1. Préparation : 2e cabinet, courtiers, clients, 2e soumission -----------
  console.log('1. Préparation');
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const cabB = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet B').lastInsertRowid;
  const hash = bcrypt.hashSync('Test1234!', 4);
  const mkUser = (cab, email, role, nom) => bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(cab, email, hash, role, nom).lastInsertRowid;
  mkUser(cabB, 'adminb@t.ca', 'admin', 'Admin B');
  const courtier1 = mkUser(cabA, 'courtier1@t.ca', 'courtier', 'Courtier Un');
  mkUser(cabA, 'courtier2@t.ca', 'courtier', 'Courtier Deux');
  const cliPtf = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Portefeuille inc.', 'Porte', 'Feuille', courtier1).lastInsertRowid;
  const soumPtf = bd.prepare(
    'INSERT INTO auto_soumissions (cabinet_id, client_id, statut) VALUES (?, ?, ?)'
  ).run(cabA, cliPtf, 'brouillon').lastInsertRowid;
  const duboisId = bd.prepare(
    "SELECT id FROM clients WHERE cabinet_id = ? AND raison_sociale = 'Martin Dubois (particulier)'"
  ).get(cabA).id;
  const soumDubois2 = bd.prepare(
    'INSERT INTO auto_soumissions (cabinet_id, client_id, statut) VALUES (?, ?, ?)'
  ).run(cabA, duboisId, 'brouillon').lastInsertRowid;
  const soumB = bd.prepare(
    'INSERT INTO auto_soumissions (cabinet_id, statut) VALUES (?, ?)'
  ).run(cabB, 'brouillon').lastInsertRowid;
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && soumPtf > 0 && soumDubois2 > 0 && soumB > 0);

  // ---- 2. Login admin ----------------------------------------------------------
  console.log('2. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/assistant');
  test('page assistant → 200', r.statut === 200 && /Assistant IA/.test(r.texte), r.statut);

  // ---- 3. Confirmation requise avant exécution ----------------------------------
  console.log('3. Confirmation');
  const nbCondAvant = bd.prepare('SELECT COUNT(*) n FROM auto_conducteurs WHERE cabinet_id = ?').get(cabA).n;
  const nbVerAvant = bd.prepare('SELECT COUNT(*) n FROM auto_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  r = await demander(jar, 'ajoute un conducteur Marie Tremblay permis T1234567 à la soumission 1');
  test('commande → 200 + confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_conducteur'
    && /Marie Tremblay/.test(r.donnees.confirmation.resume)
    && /Confirmez-vous/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 200));
  const nbCondApresDemande = bd.prepare('SELECT COUNT(*) n FROM auto_conducteurs WHERE cabinet_id = ?').get(cabA).n;
  test('rien exécuté avant confirmation', nbCondApresDemande === nbCondAvant, `${nbCondAvant} → ${nbCondApresDemande}`);
  const cmdConducteur = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_conducteur', params: {} };
  r = await confirmer(jar, cmdConducteur);
  test('confirmation → 200 « C\'est fait »', r.statut === 200 && /C'est fait/.test(r.donnees.reponse) && /Marie Tremblay/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const cond = bd.prepare(
    "SELECT * FROM auto_conducteurs WHERE cabinet_id = ? AND prenom = 'Marie' AND nom = 'Tremblay'"
  ).get(cabA);
  test('conducteur créé en base', !!cond && cond.numero_permis === 'T1234567', JSON.stringify(cond && { id: cond.id, permis: cond.numero_permis }));
  const nbVerApres = bd.prepare('SELECT COUNT(*) n FROM auto_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  test('version créée (règle d\'or)', nbVerApres === nbVerAvant + 1, `${nbVerAvant} → ${nbVerApres}`);
  // CSRF + commande invalide
  r = await confirmer(jar, { action: 'ajouter_conducteur', params: {} }, false);
  test('confirmer sans CSRF → 403', r.statut === 403, r.statut);
  r = await confirmer(jar, { action: 'detruire_tout', params: {} });
  test('action inconnue → message clair', r.statut === 200 && /invalide|expir/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 4. Modifier garantie (fusion avec l'existant) -----------------------------
  console.log('4. Garanties');
  r = await demander(jar, 'mets la RC à 1 million pour le véhicule 2 de la soumission 1');
  test('modifier_garantie → confirmation', r.statut === 200
    && r.donnees.confirmation && /1\s000\s000/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 200));
  const cmdGarantie = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garantie', params: {} };
  r = await confirmer(jar, cmdGarantie);
  test('garanties mises à jour', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const g = bd.prepare(
    'SELECT g.* FROM auto_garanties g JOIN auto_vehicules v ON v.id = g.vehicule_id WHERE v.cabinet_id = ? AND v.marque = ?'
  ).get(cabA, 'Mazda');
  test('RC changée, B et franchise conservées', g && g.rc_montant === 1000000
    && g.protection_b === 'b3' && g.franchise_b === 1000, JSON.stringify(g && { rc: g.rc_montant, b: g.protection_b, f: g.franchise_b }));
  r = await demander(jar, 'mets la RC à 2 millions pour le véhicule 9 de la soumission 1');
  test('véhicule inexistant → message clair', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 5. Résolution ambiguë / introuvable ---------------------------------------
  console.log('5. Résolution');
  r = await demander(jar, 'ajoute un conducteur Test Test à la soumission de Dubois');
  test('2 soumissions Dubois → demande de précision', r.statut === 200
    && !r.donnees.confirmation && /Plusieurs soumissions/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jar, 'ajoute un conducteur Test Test à la soumission 999');
  test('soumission 999 → introuvable', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un conducteur Test Test à la soumission ${soumB}`);
  test('soumission autre cabinet → introuvable (pas de fuite)', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, 'ajoute un conducteur à la soumission 1');
  test('nom manquant → question', r.statut === 200 && /nom complet/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 6. Rappel, navigation, recherche ------------------------------------------
  console.log('6. Rappel / navigation / recherche');
  r = await demander(jar, 'rappelle-moi de rappeler le client pour Client Portefeuille inc. demain');
  test('rappel → tâche créée directement', r.statut === 200 && /Tâche créée/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const tache = bd.prepare(
    "SELECT * FROM taches WHERE cabinet_id = ? AND titre LIKE '%rappeler le client%'"
  ).get(cabA);
  test('tâche en base avec échéance', !!tache && /^\d{4}-\d{2}-\d{2}$/.test(tache.date_echeance || ''), JSON.stringify(tache && tache.date_echeance));
  r = await demander(jar, 'rappelle-moi de faire quelque chose');
  test('rappel sans entreprise → question', r.statut === 200 && /entreprise/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, 'montre-moi la soumission 1');
  test('aller_a → redirection /auto/1', r.statut === 200 && r.donnees.redirection === '/auto/1', JSON.stringify(r.donnees));
  r = await demander(jar, 'ouvre les échéances');
  test('aller_a → redirection /echeances', r.statut === 200 && r.donnees.redirection === '/echeances', JSON.stringify(r.donnees));
  r = await demander(jar, 'cherche le client Dubois');
  test('rechercher client → résultat', r.statut === 200 && /Martin Dubois/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jar, 'cherche la police CGL-2025-10001');
  test('rechercher police → redirection fiche', r.statut === 200 && r.donnees.redirection
    && r.donnees.redirection.startsWith('/echeances/police/'), JSON.stringify(r.donnees));
  r = await demander(jar, 'cherche le client ZZZZZZintrouvable');
  test('recherche sans résultat → message', r.statut === 200 && /Aucun résultat/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 7. Portefeuille courtier ----------------------------------------------------
  console.log('7. Portefeuille');
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await demander(jarC1, 'ajoute un conducteur Hors Portefeuille à la soumission 1');
  test('courtier hors portefeuille → refus poli', r.statut === 200
    && !r.donnees.confirmation && /pas dans votre portefeuille/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jarC1, `ajoute un conducteur Ptf Test à la soumission ${soumPtf}`);
  test('courtier dans son portefeuille → confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_conducteur', JSON.stringify(r.donnees).slice(0, 200));
  const cmdPtf = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_conducteur', params: {} };
  r = await confirmer(jarC1, cmdPtf);
  test('courtier confirme → exécuté', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jarC1, 'cherche le client Dubois');
  test('recherche courtier → pas de fuite hors portefeuille', r.statut === 200 && /Aucun résultat/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));

  // ---- 8. Journal d'audit + historique ----------------------------------------------
  console.log('8. Audit');
  const audits = bd.prepare(
    "SELECT COUNT(*) n FROM journal_audit WHERE cabinet_id = ? AND action = 'commande_ia'"
  ).get(cabA).n;
  test('commandes journalisées (commande_ia)', audits >= 8, `trouvées : ${audits}`);
  r = await req(jar, 'GET', '/assistant');
  test('historique affiche la conversation', r.statut === 200 && /Marie Tremblay/.test(r.texte) && /Je confirme/.test(r.texte), r.statut);

  console.log(`\n${total - echecs}/${total} tests réussis${echecs ? ` — ${echecs} ÉCHECS` : ''}`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
