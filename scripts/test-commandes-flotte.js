/**
 * scripts/test-commandes-flotte.js — Commandes texte IA, module Flotte automobile
 * (étape 8/10 flotte) : ajouter_vehicule_flotte, ajouter_conducteur_flotte,
 * modifier_garanties_flotte (ajout ET retrait d'avenants FAQ), modifier_vehicule_flotte,
 * confirmation obligatoire avant exécution, aller_a étendu (« soumission flotte N »,
 * « ouvre la flotte »).
 *
 * LE point critique testé ici : « véhicule », « conducteur » et « garanties »
 * sont partagés entre la flotte et le FPQ1 (auto personnelle). Gardes
 * anti-collision BIDIRECTIONNELLES avec les 7 autres produits : le marqueur
 * « flotte » est obligatoire pour toute action flotte ; « soumission auto N »
 * reste FPQ1 ; une commande « véhicule » sans produit nommé et sans référence
 * de soumission ne déclenche aucune exécution (demande de précision) ;
 * périmètre courtier, cloisonnement, audit, règle d'or (zéro DELETE FROM flotte_).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-commandes-flotte.js
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
  console.log('== Tests commandes IA flotte automobile (étape 8/10 flotte) :', BASE);
  const commandesIA = require('../lib/commandes-ia');
  const flotteLib = require('../lib/flotte');

  // ---- 0. Analyseur local : cas nominaux + anti-collisions ----------------------
  console.log('0. Analyseur local');
  let a = commandesIA.analyser('ajoute le véhicule Ford Transit 2023 à la soumission flotte un');
  test('ajouter_vehicule_flotte (exemple type, n° en lettres)', a && a.action === 'ajouter_vehicule_flotte'
    && a.params.marque === 'Ford' && a.params.modele === 'Transit' && a.params.annee === 2023
    && a.params.soumission_flotte_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute le camion Ram ProMaster 2021 vin 3C6TRVBG8ME512340 avec 54 000 $ de valeur usage livraison rayon 200 km à la soumission flotte automobile 2');
  test('ajouter_vehicule_flotte complet (type, NIV, valeur, usage, rayon, « flotte automobile »)', a && a.action === 'ajouter_vehicule_flotte'
    && a.params.type_vehicule === 'camion' && a.params.vin === '3C6TRVBG8ME512340'
    && a.params.valeur === 54000 && a.params.usage === 'livraison'
    && a.params.rayon_operation_km === 200 && a.params.soumission_flotte_id === 2, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un véhicule Ford Transit 2023 à la soumission flotte de Transport Lapointe inc.');
  test('référence par entreprise', a && a.action === 'ajouter_vehicule_flotte'
    && a.params.soumission_client === 'Transport Lapointe inc.', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute un conducteur Marc Gagnon permis G1234567 classe 3 à la soumission flotte 1');
  test('ajouter_conducteur_flotte (permis + classe)', a && a.action === 'ajouter_conducteur_flotte'
    && a.params.prenom === 'Marc' && a.params.nom === 'Gagnon'
    && a.params.numero_permis === 'G1234567' && a.params.classe_permis === '3'
    && a.params.soumission_flotte_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la limite RC à 2 millions, la franchise collision à 1 000 $ et la franchise versement à 500 $ pour la soumission flotte 1');
  test('garanties flotte : limite RC + franchises collision/versement (préposition « à »)', a && a.action === 'modifier_garanties_flotte'
    && a.params.limite_rc === 2000000 && a.params.franchise_collision === 1000
    && a.params.franchise_versement === 500 && a.params.soumission_flotte_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute la valeur à neuf à la soumission flotte 1');
  test('avenant : ajout valeur à neuf = FAQ 43', a && a.action === 'modifier_garanties_flotte'
    && a.params.avenants && a.params.avenants.faq43 === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute la FAQ 43 à la soumission flotte 1');
  test('avenant : ajout FAQ 43 (code)', a && a.action === 'modifier_garanties_flotte'
    && a.params.avenants && a.params.avenants.faq43 === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('retire la FAQ 27 de la soumission flotte 1');
  test('avenant : retrait FAQ 27', a && a.action === 'modifier_garanties_flotte'
    && a.params.avenants && a.params.avenants.faq27 === 0, JSON.stringify(a && a.params));
  a = commandesIA.analyser('ajoute la FAQ 20 et retire la FAQ 34 à la soumission flotte 1');
  test('avenants : ajout FAQ 20 + retrait FAQ 34 dans la même commande', a && a.action === 'modifier_garanties_flotte'
    && a.params.avenants && a.params.avenants.faq20 === 1 && a.params.avenants.faq34 === 0, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets la prime à 12 000 $ pour la soumission flotte 1');
  test('prime flotte', a && a.action === 'modifier_garanties_flotte' && a.params.prime === 12000, JSON.stringify(a && a.params));
  a = commandesIA.analyser('mets le véhicule deux à 45 000 $ de valeur pour la soumission flotte 1');
  test('modifier_vehicule_flotte (véhicule en lettres, valeur)', a && a.action === 'modifier_vehicule_flotte'
    && a.params.vehicule_index === 2 && a.params.valeur === 45000
    && a.params.soumission_flotte_id === 1, JSON.stringify(a && a.params));
  a = commandesIA.analyser('change le rayon du véhicule un de la soumission flotte 2 à 150 km');
  test('modifier_vehicule_flotte (rayon)', a && a.action === 'modifier_vehicule_flotte'
    && a.params.vehicule_index === 1 && a.params.rayon_operation_km === 150
    && a.params.soumission_flotte_id === 2, JSON.stringify(a && a.params));
  a = commandesIA.analyser('change l\u2019usage du véhicule Ford Transit de la soumission flotte 1 à personnel');
  test('modifier_vehicule_flotte par marque (usage)', a && a.action === 'modifier_vehicule_flotte'
    && a.params.vehicule_recherche === 'Ford Transit' && a.params.usage === 'personnel', JSON.stringify(a && a.params));
  // Anti-collision FPQ1 <-> flotte (bidirectionnelle, le cœur de l'étape)
  a = commandesIA.analyser('ajoute un véhicule Honda CR-V 2022 à la soumission auto 1');
  test('« soumission auto » → FPQ1 seulement (ajouter_vehicule)', a && a.action === 'ajouter_vehicule'
    && a.params.soumission_id === 1, JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute un conducteur Marie Tremblay permis T1234567 à la soumission auto 1');
  test('« soumission auto » → FPQ1 seulement (ajouter_conducteur)', a && a.action === 'ajouter_conducteur'
    && a.params.soumission_id === 1, JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la RC à 2 millions pour le véhicule 1 de la soumission 1');
  test('commande FPQ1 existante toujours routée FPQ1 (pas flotte)', a && a.action === 'modifier_garantie'
    && a.params.rc_montant === 2000000, JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute un véhicule Honda CR-V 2022 à la soumission 1');
  test('référence courte historique → FPQ1 (non-régression étape 8 FPQ1)', a && a.action === 'ajouter_vehicule', JSON.stringify(a && a.action));
  test('mesure sur soumission flotte → null (pas cyber)', commandesIA.analyser('ajoute la mesure MFA à la soumission flotte 1') === null);
  test('établissement sur soumission flotte → null (pas PE)', commandesIA.analyser('ajoute un établissement Xyz à la soumission flotte 1') === null);
  test('bâtiment sur soumission flotte → null (pas biens)', commandesIA.analyser('ajoute un bâtiment au 1 rue Test à la soumission flotte 1') === null);
  test('activité sur soumission flotte → null (pas E&O)', commandesIA.analyser('ajoute une activité audit à la soumission flotte 1') === null);
  test('dirigeant sur soumission flotte → null (pas D&O)', commandesIA.analyser('ajoute un dirigeant Xyz à la soumission flotte 1') === null);
  test('lieu sur soumission flotte → null (pas RC)', commandesIA.analyser('ajoute le lieu 1 rue Test à la soumission flotte 1') === null);
  a = commandesIA.analyser('mets la franchise à 10 000 $ pour la soumission E&O 1');
  test('commande E&O non captée par flotte', a && a.action === 'modifier_garanties_eo', JSON.stringify(a && a.action));
  a = commandesIA.analyser('retire l\u2019avenant rançongiciel pour la soumission cyber 1');
  test('commande cyber non captée par flotte', a && a.action === 'modifier_garanties_cyber', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la limite par sinistre à 2 millions pour le lieu 1 de la soumission RC 1');
  test('commande RC non captée par flotte', a && a.action === 'modifier_garanties_rc', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la franchise à 10 000 $ pour la soumission D&O 1');
  test('commande D&O non captée par flotte', a && a.action === 'modifier_garanties_do', JSON.stringify(a && a.action));
  a = commandesIA.analyser('mets la période d\u2019indemnité à 18 mois pour la soumission perte d\u2019exploitation 1');
  test('commande PE non captée par flotte', a && a.action === 'modifier_garanties_pe', JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute le lieu 1 rue Test à la soumission RC 1');
  test('lieu RC non capté par flotte', a && a.action === 'ajouter_lieu_rc', JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute un bâtiment au 1 rue Test à la soumission biens 1');
  test('bâtiment biens non capté par flotte', a && a.action === 'ajouter_batiment', JSON.stringify(a && a.action));
  a = commandesIA.analyser('ajoute l\u2019activité conseil fiscal avec 180 000 $ de chiffre d\u2019affaires à la soumission E&O 1');
  test('activité E&O non captée par flotte', a && a.action === 'ajouter_activite_eo', JSON.stringify(a && a.action));
  // Ambiguïté sans produit nommé : jamais d'action flotte, jamais d'exécution silencieuse
  a = commandesIA.analyser('ajoute un véhicule Ford Transit 2023');
  test('véhicule sans produit ni référence → PAS une action flotte', !a || !String(a.action).includes('flotte'), JSON.stringify(a && a.action));
  test('modifier véhicule sans marqueur flotte → null (ni flotte, ni FPQ1)',
    commandesIA.analyser('mets le véhicule deux à 45 000 $ de valeur') === null);
  test('garanties sans marqueur flotte → pas modifier_garanties_flotte',
    (commandesIA.analyser('mets la franchise collision à 1 000 $') || {}).action !== 'modifier_garanties_flotte');
  test('garanties sans marqueur PE/flotte → null', commandesIA.analyser('mets la franchise à 5 jours') === null);
  a = commandesIA.analyser('montre-moi la soumission flotte 1');
  test('aller_a soumission flotte → /flotte/1', a && a.action === 'aller_a' && a.params.url === '/flotte/1', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission flotte automobile 3');
  test('aller_a « soumission flotte automobile » → /flotte/3', a && a.action === 'aller_a' && a.params.url === '/flotte/3', JSON.stringify(a && a.params));
  a = commandesIA.analyser('ouvre la flotte');
  test('aller_a « ouvre la flotte » → /flotte', a && a.action === 'aller_a' && a.params.url === '/flotte', JSON.stringify(a && a.params));
  a = commandesIA.analyser('montre-moi la soumission 1');
  test('aller_a auto → /auto/1 (non-régression)', a && a.action === 'aller_a' && a.params.url === '/auto/1', JSON.stringify(a && a.params));
  test('blague → null', commandesIA.analyser('raconte-moi une blague') === null);
  test('ACTIONS_COHERE inclut les 4 actions flotte', ['ajouter_vehicule_flotte', 'ajouter_conducteur_flotte', 'modifier_garanties_flotte', 'modifier_vehicule_flotte']
    .every((x) => commandesIA.ACTIONS_COHERE.includes(x)), JSON.stringify(commandesIA.ACTIONS_COHERE));

  // ---- 1. Préparation : 2e cabinet, courtier, clients, soumissions flotte -------
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
  ).run(cabA, 'Client Portefeuille Flotte inc.', 'Porte', 'Feuille', courtier1).lastInsertRowid;
  const cliAmb = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)'
  ).run(cabA, 'Client Ambigu Flotte inc.', 'Ambi', 'Gu').lastInsertRowid;
  const soumA1 = flotteLib.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliAmb });
  const soumA2 = flotteLib.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliAmb });
  const soumPtf = flotteLib.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliPtf });
  const soumB = flotteLib.creerSoumission({ cabinetId: cabB, userId: adminB, clientId: null });
  flotteLib.ajouterVehicule(soumA1, cabA, adminId, {
    annee: 2022, marque: 'Ford', modele: 'Transit 250', type_vehicule: 'camion',
    usage: 'livraison', rayon_operation_km: 160, valeur: 62000,
  });
  flotteLib.ajouterVehicule(soumA1, cabA, adminId, {
    annee: 2021, marque: 'Ram', modele: 'ProMaster 3500', type_vehicule: 'camion',
    usage: 'livraison', rayon_operation_km: 200, valeur: 54000,
  });
  flotteLib.definirGaranties(soumA1, cabA, adminId, {
    limite_rc: 1000000, franchise_collision: 1000, franchise_versement: 1000,
    avenants: { faq43: 1, faq27: 1 }, prime: 9850,
  });
  // Comptes FPQ1 de référence : aucune commande flotte ne doit y toucher.
  const nbAutoVehAvant = bd.prepare('SELECT COUNT(*) n FROM auto_vehicules WHERE cabinet_id = ?').get(cabA).n;
  const nbAutoCondAvant = bd.prepare('SELECT COUNT(*) n FROM auto_conducteurs WHERE cabinet_id = ?').get(cabA).n;
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && soumA1 > 0 && soumA2 > 0 && soumPtf > 0 && soumB > 0);

  // ---- 2. Login admin ------------------------------------------------------------
  console.log('2. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 3. Confirmation requise avant exécution (véhicule) -------------------------
  console.log('3. Confirmation véhicule');
  const nbVehAvant = bd.prepare('SELECT COUNT(*) n FROM flotte_vehicules WHERE cabinet_id = ?').get(cabA).n;
  const nbVerAvant = bd.prepare('SELECT COUNT(*) n FROM flotte_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  r = await demander(jar, `ajoute le véhicule Ford Transit 2023 avec 45 000 $ de valeur à la soumission flotte ${soumA1}`);
  test('commande → 200 + confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_vehicule_flotte'
    && /Ford Transit/.test(r.donnees.confirmation.resume)
    && /45/.test(r.donnees.confirmation.resume)
    && /Confirmez-vous/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 300));
  const nbVehApresDemande = bd.prepare('SELECT COUNT(*) n FROM flotte_vehicules WHERE cabinet_id = ?').get(cabA).n;
  test('rien exécuté avant confirmation', nbVehApresDemande === nbVehAvant, `${nbVehAvant} → ${nbVehApresDemande}`);
  const cmdVeh = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_vehicule_flotte', params: {} };
  r = await confirmer(jar, cmdVeh);
  test("confirmation → 200 « C'est fait »", r.statut === 200 && /C'est fait/.test(r.donnees.reponse) && /Ford Transit/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const veh = bd.prepare(
    'SELECT * FROM flotte_vehicules WHERE cabinet_id = ? AND soumission_id = ? AND annee = 2023'
  ).get(cabA, soumA1);
  test('véhicule créé en base (marque/modèle/année/valeur)', !!veh && veh.marque === 'Ford'
    && veh.modele === 'Transit' && veh.valeur === 45000, JSON.stringify(veh && { m: veh.marque, mo: veh.modele, v: veh.valeur }));
  const nbVerApres = bd.prepare('SELECT COUNT(*) n FROM flotte_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
  test("version créée (règle d'or)", nbVerApres === nbVerAvant + 1, `${nbVerAvant} → ${nbVerApres}`);

  // ---- 4. Garanties : fusion + avant/après + retrait d'avenant ----------------------
  console.log('4. Garanties / fusion');
  r = await demander(jar, `mets la limite RC à 2 millions, la franchise collision à 2 500 $ et ajoute la FAQ 20 pour la soumission flotte ${soumA1}`);
  test('garanties → confirmation avant/après', r.statut === 200
    && r.donnees.confirmation && /limite RC :/.test(r.donnees.confirmation.resume)
    && /→/.test(r.donnees.confirmation.resume)
    && /FAQ 20/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 400));
  const cmdGar = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_flotte', params: {} };
  r = await confirmer(jar, cmdGar);
  test('garanties mises à jour', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  let g = bd.prepare(
    'SELECT * FROM flotte_garanties WHERE cabinet_id = ? AND soumission_id = ?'
  ).get(cabA, soumA1);
  test('garanties en base (limite 2M, collision 2500, FAQ 20 ajoutée, FAQ 43/27 conservées)', !!g
    && g.limite_rc === 2000000 && g.franchise_collision === 2500 && g.franchise_versement === 1000
    && JSON.parse(g.avenants || '{}').faq20 === 1 && JSON.parse(g.avenants || '{}').faq43 === 1
    && JSON.parse(g.avenants || '{}').faq27 === 1 && g.prime === 9850,
  JSON.stringify(g && { l: g.limite_rc, fc: g.franchise_collision, fv: g.franchise_versement, av: g.avenants, p: g.prime }));
  r = await demander(jar, `mets la prime à 12 000 $ pour la soumission flotte ${soumA1}`);
  const cmdGar2 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_flotte', params: {} };
  r = await confirmer(jar, cmdGar2);
  g = bd.prepare('SELECT * FROM flotte_garanties WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumA1);
  test('fusion : limite + franchises + avenants conservés, prime changée', r.statut === 200
    && g.limite_rc === 2000000 && g.franchise_collision === 2500
    && JSON.parse(g.avenants || '{}').faq20 === 1 && g.prime === 12000, JSON.stringify(g && { l: g.limite_rc, p: g.prime }));
  r = await demander(jar, `retire la FAQ 27 de la soumission flotte ${soumA1}`);
  const cmdGar3 = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_garanties_flotte', params: {} };
  r = await confirmer(jar, cmdGar3);
  g = bd.prepare('SELECT * FROM flotte_garanties WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumA1);
  test('retrait avenant : faq27 = 0, faq43 conservé', r.statut === 200
    && JSON.parse(g.avenants).faq27 === 0 && JSON.parse(g.avenants).faq43 === 1, JSON.stringify(g && g.avenants));

  // ---- 5. Modification d'un véhicule ------------------------------------------------
  console.log('5. Véhicule');
  r = await demander(jar, `mets le véhicule deux à 45 000 $ de valeur pour la soumission flotte ${soumA1}`);
  test('valeur véhicule → confirmation avant/après', r.statut === 200
    && r.donnees.confirmation && /valeur :/.test(r.donnees.confirmation.resume)
    && /→/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 300));
  const cmdMod = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_vehicule_flotte', params: {} };
  r = await confirmer(jar, cmdMod);
  const veh2 = bd.prepare(
    'SELECT * FROM flotte_vehicules WHERE cabinet_id = ? AND soumission_id = ? AND marque = ?'
  ).get(cabA, soumA1, 'Ram');
  test('valeur du véhicule deux changée en base (54 000 → 45 000)', r.statut === 200
    && veh2 && veh2.valeur === 45000, JSON.stringify(veh2 && veh2.valeur));
  r = await demander(jar, `change le rayon du véhicule un de la soumission flotte ${soumA1} à 150 km`);
  const cmdRay = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'modifier_vehicule_flotte', params: {} };
  r = await confirmer(jar, cmdRay);
  const veh1 = bd.prepare(
    'SELECT * FROM flotte_vehicules WHERE cabinet_id = ? AND soumission_id = ? AND marque = ? AND annee = 2022'
  ).get(cabA, soumA1, 'Ford');
  test('rayon du véhicule un changé en base (160 → 150 km)', r.statut === 200
    && veh1 && veh1.rayon_operation_km === 150, JSON.stringify(veh1 && veh1.rayon_operation_km));
  r = await demander(jar, `mets le véhicule 99 à 1 000 $ de valeur pour la soumission flotte ${soumA1}`);
  test('véhicule introuvable → message clair', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 6. Conducteur flotte (et non-collision FPQ1 en base) ---------------------------
  console.log('6. Conducteur');
  r = await demander(jar, `ajoute un conducteur Paul Côté permis C9876543 classe 3 à la soumission flotte ${soumA1}`);
  test('conducteur flotte → confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_conducteur_flotte'
    && /Paul Côté/.test(r.donnees.confirmation.resume), JSON.stringify(r.donnees).slice(0, 250));
  const cmdCond = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_conducteur_flotte', params: {} };
  r = await confirmer(jar, cmdCond);
  const cond = bd.prepare(
    "SELECT * FROM flotte_conducteurs WHERE cabinet_id = ? AND soumission_id = ? AND prenom = 'Paul'"
  ).get(cabA, soumA1);
  test('conducteur créé en base flotte (permis + classe)', r.statut === 200 && !!cond
    && cond.nom === 'Côté' && cond.numero_permis === 'C9876543' && cond.classe_permis === '3',
  JSON.stringify(cond && { n: cond.nom, p: cond.numero_permis, c: cond.classe_permis }));

  // ---- 7. Résolution ambiguë / introuvable / ambiguïté sans produit -------------------
  console.log('7. Résolution');
  r = await demander(jar, 'ajoute un véhicule Test Xyz à la soumission flotte de Client Ambigu Flotte inc.');
  test('2 soumissions flotte → demande de précision', r.statut === 200
    && !r.donnees.confirmation && /Plusieurs soumissions flotte/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jar, 'ajoute un véhicule Test Xyz à la soumission flotte 999');
  test('soumission flotte 999 → introuvable', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un véhicule Test Xyz à la soumission flotte ${soumB}`);
  test('soumission autre cabinet → introuvable (pas de fuite)', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await demander(jar, `ajoute un véhicule à la soumission flotte ${soumA1}`);
  test('véhicule sans marque → question', r.statut === 200 && /Quel est le véhicule/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  const nbVehAvantAmb = bd.prepare('SELECT COUNT(*) n FROM flotte_vehicules WHERE cabinet_id = ?').get(cabA).n;
  r = await demander(jar, 'ajoute un véhicule Ford Transit 2023');
  test('ambigu sans produit ni référence → demande de précision, aucune confirmation', r.statut === 200
    && !r.donnees.confirmation && /Pour quelle soumission/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  const nbVehApresAmb = bd.prepare('SELECT COUNT(*) n FROM flotte_vehicules WHERE cabinet_id = ?').get(cabA).n;
  const nbAutoApresAmb = bd.prepare('SELECT COUNT(*) n FROM auto_vehicules WHERE cabinet_id = ?').get(cabA).n;
  test('ambigu : rien créé ni en flotte ni en auto', nbVehApresAmb === nbVehAvantAmb && nbAutoApresAmb === nbAutoVehAvant,
    `flotte ${nbVehAvantAmb} → ${nbVehApresAmb}, auto ${nbAutoVehAvant} → ${nbAutoApresAmb}`);

  // ---- 8. Navigation ------------------------------------------------------------------
  console.log('8. Navigation');
  r = await demander(jar, `montre-moi la soumission flotte ${soumA1}`);
  test('aller_a → redirection /flotte/N', r.statut === 200 && r.donnees.redirection === `/flotte/${soumA1}`, JSON.stringify(r.donnees));
  r = await demander(jar, 'ouvre la flotte');
  test('aller_a → /flotte', r.statut === 200 && r.donnees.redirection === '/flotte', JSON.stringify(r.donnees));

  // ---- 9. Portefeuille courtier ---------------------------------------------------------
  console.log('9. Portefeuille');
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await demander(jarC1, `ajoute un véhicule Test Xyz à la soumission flotte ${soumA1}`);
  test('courtier hors portefeuille → refus poli', r.statut === 200
    && !r.donnees.confirmation && /pas dans votre portefeuille/.test(r.donnees.reponse), JSON.stringify(r.donnees).slice(0, 200));
  r = await demander(jarC1, `ajoute un véhicule Test Xyz à la soumission flotte ${soumPtf}`);
  test('courtier dans son portefeuille → confirmation', r.statut === 200
    && r.donnees.confirmation && r.donnees.confirmation.commande.action === 'ajouter_vehicule_flotte', JSON.stringify(r.donnees).slice(0, 200));
  const cmdPtf = (r.donnees && r.donnees.confirmation)
    ? r.donnees.confirmation.commande : { action: 'ajouter_vehicule_flotte', params: {} };
  r = await confirmer(jarC1, cmdPtf);
  test('courtier confirme → exécuté', r.statut === 200 && /C'est fait/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await confirmer(jar, { action: 'ajouter_vehicule_flotte', params: {} }, false);
  test('confirmer sans CSRF → 403', r.statut === 403, r.statut);
  r = await confirmer(jar, { action: 'detruire_tout', params: {} });
  test('action inconnue → message clair', r.statut === 200 && /invalide|expir/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  // ---- 10. Journal d'audit + règle d'or + non-collision FPQ1 en base ----------------------
  console.log('10. Audit');
  const audits = bd.prepare(
    "SELECT COUNT(*) n FROM journal_audit WHERE cabinet_id = ? AND action = 'commande_ia'"
  ).get(cabA).n;
  test('commandes journalisées (commande_ia)', audits >= 10, `trouvées : ${audits}`);
  const src = fs.readFileSync(__dirname + '/../lib/commandes-ia.js', 'utf8');
  test('règle d\u2019or : aucun DELETE FROM flotte_', !/DELETE\s+FROM\s+flotte_/i.test(src));
  const fuite = flotteLib.obtenirSoumission(soumA1, cabB);
  test('aucune fuite inter-cabinets', fuite === null);
  const nbAutoVehFin = bd.prepare('SELECT COUNT(*) n FROM auto_vehicules WHERE cabinet_id = ?').get(cabA).n;
  const nbAutoCondFin = bd.prepare('SELECT COUNT(*) n FROM auto_conducteurs WHERE cabinet_id = ?').get(cabA).n;
  test('non-collision en base : FPQ1 inchangé (véhicules + conducteurs)', nbAutoVehFin === nbAutoVehAvant && nbAutoCondFin === nbAutoCondAvant,
    `auto_vehicules ${nbAutoVehAvant} → ${nbAutoVehFin}, auto_conducteurs ${nbAutoCondAvant} → ${nbAutoCondFin}`);

  console.log(`\n${total - echecs}/${total} tests réussis${echecs ? ` — ${echecs} ÉCHECS` : ''}`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
