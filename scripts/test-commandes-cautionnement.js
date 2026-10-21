/**
 * scripts/test-commandes-cautionnement.js — Commandes texte IA, module
 * Cautionnement (étape 8/10 cautionnement) : ajouter_obligation_caut,
 * modifier_ligne_caut, modifier_obligation_caut, confirmation obligatoire
 * avant exécution, aller_a étendu (« ouvre le cautionnement »).
 *
 * LE point critique testé ici : le mot « soumission » est partagé par les 8
 * produits. Gardes anti-collision BIDIRECTIONNELLES : le marqueur
 * « cautionnement »/« caution » est OBLIGATOIRE pour toute action
 * cautionnement ; « soumission N » seul reste la référence courte FPQ1 ;
 * « soumission flotte N » reste flotte ; une commande « obligation » sans le
 * marqueur n'exécute RIEN ; périmètre courtier, cloisonnement, audit,
 * règle d'or (zéro DELETE FROM caut_).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-commandes-cautionnement.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const fs = require('fs');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);
const commandesIA = require('../lib/commandes-ia');
const caut = require('../lib/cautionnement');

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
async function messageAssistant(jar, message) {
  const p = await req(jar, 'GET', '/assistant');
  return req(jar, 'POST', '/assistant/message', { json: { message, _csrf: csrf(p.texte) } });
}
async function confirmerAssistant(jar, commande) {
  const p = await req(jar, 'GET', '/assistant');
  return req(jar, 'POST', '/assistant/confirmer', { json: { commande, _csrf: csrf(p.texte) } });
}

(async () => {
  console.log('== Commandes IA cautionnement (étape 8/10) ==');

  // ---- 1. Analyseurs -------------------------------------------------------------
  console.log('1. Analyseurs');
  let a = commandesIA.analyser("ajoute un cautionnement d'exécution de 1 100 000 $ contrat 2 200 000 $ pour le Centre de services scolaire des Mille-Îles projet École des Pins à la soumission cautionnement 1");
  test('ajout exécution → action ajouter_obligation_caut', !!a && a.action === 'ajouter_obligation_caut', JSON.stringify(a));
  test('ajout exécution : type + montants', !!a && a.params.type === 'execution' && a.params.montant_cautionnement === 1100000 && a.params.montant_contrat === 2200000, JSON.stringify(a && a.params));
  test('ajout exécution : bénéficiaire + projet + référence', !!a && /Mille-Îles/.test(a.params.beneficiaire || '') && /École des Pins/.test(a.params.description_projet || '') && a.params.soumission_caut_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute une obligation rbq de 40 000 $ pour la Régie du bâtiment du Québec à la soumission cautionnement un');
  test('ajout RBQ (mot-nombre « un ») → rbq, 40 000 $, id 1', !!a && a.action === 'ajouter_obligation_caut' && a.params.type === 'rbq' && a.params.montant_cautionnement === 40000 && a.params.soumission_caut_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un cautionnement de soumission de 220 000 $ pour la Ville de Laval à la soumission cautionnement de Construction Verdon inc.');
  test('ajout bid bond par client → type soumission + client', !!a && a.action === 'ajouter_obligation_caut' && a.params.type === 'soumission' && a.params.montant_cautionnement === 220000 && /Verdon/.test(a.params.soumission_client || ''), JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un cautionnement de paiement de la main-d’œuvre et des matériaux de 900 000 $ pour la Ville de Laval à la soumission cautionnement 1');
  test('ajout paiement M&O → type paiement_mo', !!a && a.params.type === 'paiement_mo' && a.params.montant_cautionnement === 900000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la limite globale à 6 millions et la limite par projet à 3 millions à la soumission cautionnement 1');
  test('ligne : limite globale 6 M$ + par projet 3 M$', !!a && a.action === 'modifier_ligne_caut' && a.params.limite_globale === 6000000 && a.params.limite_par_projet === 3000000 && a.params.soumission_caut_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('change le fonds de roulement à 900 000 $ et la prime de la ligne à 24 000 $ à la soumission cautionnement 1');
  test('ligne : fonds de roulement + prime', !!a && a.action === 'modifier_ligne_caut' && a.params.fonds_roulement === 900000 && a.params.prime === 24000, JSON.stringify(a && a.params));
  a = commandesIA.analyser("change le montant du cautionnement de l'obligation d'exécution à 1 200 000 $ à la soumission cautionnement 1");
  test('obligation par type : exécution → 1 200 000 $', !!a && a.action === 'modifier_obligation_caut' && a.params.obligation_type === 'execution' && a.params.montant_cautionnement === 1200000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('change le montant du cautionnement de l’obligation 2 à 500 000 $ à la soumission cautionnement 1');
  test('obligation par index : 2 → 500 000 $', !!a && a.action === 'modifier_obligation_caut' && a.params.obligation_index === 2 && a.params.montant_cautionnement === 500000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ouvre le cautionnement');
  test('aller_a cautionnement', !!a && a.action === 'aller_a' && a.params.url === '/cautionnement', JSON.stringify(a));

  // ---- 2. Gardes anti-collision bidirectionnelles --------------------------------------
  console.log('2. Gardes anti-collision');
  a = commandesIA.analyser("ajoute une obligation d'exécution de 100 000 $ pour la Ville X à la soumission 1");
  test('« obligation » SANS marqueur cautionnement → aucune action caut', !a || a.action !== 'ajouter_obligation_caut', JSON.stringify(a));
  a = commandesIA.analyser('ajoute un conducteur Marie Tremblay permis T1234567 à la soumission 1');
  test('FPQ1 intact : conducteur → ajouter_conducteur', !!a && a.action === 'ajouter_conducteur', JSON.stringify(a));
  a = commandesIA.analyser('ajoute le véhicule Ford Transit 2023 à la soumission flotte 1');
  test('flotte intacte : véhicule flotte → ajouter_vehicule_flotte', !!a && a.action === 'ajouter_vehicule_flotte', JSON.stringify(a));
  a = commandesIA.analyser('mets la limite RC à 2 millions pour le véhicule 1 de la soumission 1');
  test('FPQ1 intact : RC véhicule → modifier_garantie', !!a && a.action === 'modifier_garantie', JSON.stringify(a));
  a = commandesIA.analyser("ajoute un cautionnement d'exécution de 100 000 $ à la soumission flotte 1");
  test('conflit flotte+cautionnement → aucune exécution (null)', a === null, JSON.stringify(a));
  a = commandesIA.analyser('mets la limite globale à 5 millions à la soumission RC 1');
  test('« limite globale » pour RC → pas modifier_ligne_caut', !a || a.action !== 'modifier_ligne_caut', JSON.stringify(a));
  a = commandesIA.analyser('ajoute un bâtiment au 123 rue Principale à Montréal à la soumission biens 1');
  test('biens intact : bâtiment → ajouter_batiment', !!a && a.action === 'ajouter_batiment', JSON.stringify(a));
  a = commandesIA.analyser('mets la limite globale à 6 millions à la soumission cautionnement 1');
  test('cautionnement n’est pas capté par un autre produit', !!a && a.action === 'modifier_ligne_caut', JSON.stringify(a));

  // ---- 3. Préparation exécution ---------------------------------------------------------
  console.log('3. Préparation');
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const adminA = bd.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  const hash = bcrypt.hashSync('Test1234!', 4);
  const courtierX = bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)")
    .run(cabA, 'courtiercmd@t.ca', hash, 'Courtier Cmd').lastInsertRowid;
  const cli = bd.prepare('INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)')
    .run(cabA, 'Commandes Caut inc.', 'Co', 'Mmande').lastInsertRowid;
  const sId = caut.creerSoumission({ cabinetId: cabA, userId: adminA, clientId: cli, assureur: 'Intact Cautionnement' });
  caut.ajouterObligation(sId, cabA, adminA, {
    type: 'execution', beneficiaire: 'Ville Cmd', description_projet: 'Projet Cmd',
    montant_contrat: 2000000, montant_cautionnement: 1000000, prime_estimee: 10000,
  });
  caut.definirGaranties(sId, cabA, adminA, {
    limite_globale: 5000000, limite_par_projet: 2500000, fonds_roulement: 700000, valeur_nette: 1500000, prime: 18000,
  });
  const adminUser = { id: adminA, role: 'admin' };
  test('préparation OK', sId > 0 && courtierX > 0);

  // ---- 4. Exécution avec confirmation ------------------------------------------------------
  console.log('4. Exécution (confirmation obligatoire)');
  const nbObl = () => bd.prepare('SELECT COUNT(*) n FROM caut_obligations WHERE soumission_id = ? AND archive = 0').get(sId).n;
  const nbVer = () => caut.versionsSoumission(sId, cabA).length;
  let cmd = commandesIA.analyser(`ajoute un cautionnement rbq de 40 000 $ pour la Régie du bâtiment du Québec à la soumission cautionnement ${sId}`);
  let res = commandesIA.executerCommande(cabA, adminUser, cmd, { confirme: false });
  test('ajout obligation : confirmation demandée', res.statut === 'confirmation' && /Confirmez-vous/.test(res.resume || ''), JSON.stringify(res));
  test('ajout obligation : rien d’écrit avant confirmation', nbObl() === 1);
  const verAvant = nbVer();
  res = commandesIA.executerCommande(cabA, adminUser, res.commande, { confirme: true });
  test('ajout obligation confirmé → message fait', res.statut === 'message' && /C'est fait/.test(res.texte), res.texte);
  test('obligation RBQ ajoutée en base', nbObl() === 2 && bd.prepare("SELECT COUNT(*) n FROM caut_obligations WHERE soumission_id = ? AND type = 'rbq'").get(sId).n === 1);
  test('version créée par l’ajout confirmé', nbVer() === verAvant + 1);

  cmd = commandesIA.analyser(`mets la limite globale à 6 millions à la soumission cautionnement ${sId}`);
  res = commandesIA.executerCommande(cabA, adminUser, cmd, { confirme: false });
  test('ligne : confirmation avec avant/après', res.statut === 'confirmation' && /5\s000\s000|5 000 000/.test((res.resume || '').replace(/[  ]/g, ' ')) && /6\s000\s000|6 000 000/.test((res.resume || '').replace(/[  ]/g, ' ')), res.resume);
  test('ligne inchangée avant confirmation', bd.prepare('SELECT limite_globale FROM caut_garanties WHERE soumission_id = ?').get(sId).limite_globale === 5000000);
  res = commandesIA.executerCommande(cabA, adminUser, res.commande, { confirme: true });
  test('ligne confirmée → 6 000 000 $', bd.prepare('SELECT limite_globale FROM caut_garanties WHERE soumission_id = ?').get(sId).limite_globale === 6000000);

  cmd = commandesIA.analyser(`mets la limite par projet à 9 millions à la soumission cautionnement ${sId}`);
  res = commandesIA.executerCommande(cabA, adminUser, cmd, { confirme: true });
  test('règle métier : par projet > globale refusé même confirmé', res.statut === 'message' && /dépasserait/.test(res.texte), res.texte);
  test('ligne inchangée après refus', bd.prepare('SELECT limite_par_projet FROM caut_garanties WHERE soumission_id = ?').get(sId).limite_par_projet === 2500000);

  cmd = commandesIA.analyser(`change le montant du cautionnement de l'obligation d'exécution à 1 200 000 $ à la soumission cautionnement ${sId}`);
  res = commandesIA.executerCommande(cabA, adminUser, cmd, { confirme: false });
  test('obligation : confirmation demandée', res.statut === 'confirmation', JSON.stringify(res).slice(0, 160));
  res = commandesIA.executerCommande(cabA, adminUser, res.commande, { confirme: true });
  test('obligation exécution → 1 200 000 $', bd.prepare("SELECT montant_cautionnement FROM caut_obligations WHERE soumission_id = ? AND type = 'execution'").get(sId).montant_cautionnement === 1200000);

  cmd = commandesIA.analyser('ajoute un cautionnement rbq de 40 000 $ à la soumission cautionnement 999');
  res = commandesIA.executerCommande(cabA, adminUser, cmd, { confirme: false });
  test('soumission introuvable → message', res.statut === 'message' && /pas trouvé/.test(res.texte), res.texte);
  cmd = commandesIA.analyser(`ajoute un cautionnement rbq de 40 000 $ à la soumission cautionnement ${sId}`);
  res = commandesIA.executerCommande(cabA, { id: courtierX, role: 'courtier' }, cmd, { confirme: false });
  test('courtier hors portefeuille → refus', res.statut === 'message' && /portefeuille/.test(res.texte), res.texte);

  // ---- 5. Flux assistant HTTP complet ---------------------------------------------------------
  console.log('5. Assistant HTTP');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'CmdCaut456!', confirmation: 'CmdCaut456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);
  const nbOblAvantHttp = nbObl();
  r = await messageAssistant(jar, `ajoute un cautionnement de soumission de 150 000 $ pour la Ville HTTP projet Bibliothèque à la soumission cautionnement ${sId}`);
  test('assistant : proposition de confirmation', r.statut === 200 && r.donnees && r.donnees.confirmation && r.donnees.confirmation.commande && r.donnees.confirmation.commande.action === 'ajouter_obligation_caut', JSON.stringify(r.donnees).slice(0, 200));
  test('assistant : rien d’écrit avant confirmation HTTP', nbObl() === nbOblAvantHttp);
  r = await confirmerAssistant(jar, r.donnees.confirmation.commande);
  test('assistant : confirmation → exécuté', r.statut === 200 && /C'est fait/.test((r.donnees && r.donnees.reponse) || ''), JSON.stringify(r.donnees).slice(0, 200));
  test('assistant : obligation de soumission ajoutée', bd.prepare("SELECT COUNT(*) n FROM caut_obligations WHERE soumission_id = ? AND type = 'soumission' AND montant_cautionnement = 150000").get(sId).n === 1);
  test('audit commande_ia', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'commande_ia'").get().n >= 1);

  // ---- 6. Règle d'or ----------------------------------------------------------------------------
  console.log('6. Règle d’or');
  const src = fs.readFileSync(__dirname + '/../lib/commandes-ia.js', 'utf8');
  test('aucun DELETE FROM caut_ dans commandes-ia.js', !/DELETE\s+FROM\s+caut_/i.test(src));
  test('ACTIONS_CONFIRMABLES contient les 3 actions caut',
    fs.readFileSync(__dirname + '/../lib/assistant.js', 'utf8').includes('ajouter_obligation_caut')
    && fs.readFileSync(__dirname + '/../lib/assistant.js', 'utf8').includes('modifier_ligne_caut'));

  console.log(`\n${total - echecs}/${total} tests réussis`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
