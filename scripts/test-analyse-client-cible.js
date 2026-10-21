/**
 * scripts/test-analyse-client-cible.js — Correctif « Client du document »
 * de la révision d'analyse (demande de Patrick, capture à l'appui) :
 * le client se choisit AVANT les rattachements ; les sélecteurs
 * « soumission existante » et « police existante » ne proposent que les
 * éléments DU client choisi (soumissions : et du produit choisi) ; le
 * serveur refuse (400) tout rattachement incohérent et crée chez le
 * client forcé ; analyse liée à une demande d'informations → client
 * verrouillé sur celui de la demande (imposé côté serveur).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-analyse-client-cible.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);
const flotte = require('../lib/flotte');

const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
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
async function req(jar, methode, chemin, { form = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    corps = new URLSearchParams(form).toString();
  }
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  const texte = await res.text();
  return { statut: res.status, texte, location: res.headers.get('location') };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
async function loginComme(email, mdp) {
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  return { jar, ok: r.statut === 302 };
}

const FORM_LISTE_VEHICULE = {
  inclure_0: 'on', valeur_0: '', inclure_1: 'on', valeur_1: '5000',
  liste_vehicules_0_inclure: 'on', liste_vehicules_0_niv: '1FTEW1E50LFA12345',
  liste_vehicules_0_annee: '2024', liste_vehicules_0_marque: 'Ford', liste_vehicules_0_modele: 'F-150',
};

(async () => {
  console.log('== Révision d analyse — choix du client avant les rattachements ==', BASE);

  // ---- 1. Préparation -------------------------------------------------------
  console.log('1. Préparation');
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const adminId = bd.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  const cliA = bd.prepare("SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND raison_sociale LIKE 'Constructions Méthot%'").get(cabA);
  const cliB = bd.prepare("SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND raison_sociale LIKE 'Garage Saint-Michel%'").get(cabA);
  test('clients seed A (Méthot) et B (Garage Saint-Michel) présents', !!cliA && !!cliB);
  const soumA = flotte.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliA.id, notes: 'Test client-cible A' });
  const soumB = flotte.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliB.id, notes: 'Test client-cible B' });
  const soumDemande = flotte.creerSoumission({ cabinetId: cabA, userId: adminId, clientId: cliA.id, notes: 'Test client-cible demande' });
  test('soumissions flotte créées pour A, B et la demande', soumA > 0 && soumB > 0 && soumDemande > 0);
  const polA = bd.prepare(`INSERT INTO polices (cabinet_id, client_id, ligne, assureur, numero_police, date_effet, date_echeance, statut, responsable_id)
    VALUES (?, ?, 'flotte', 'Assureur Test', 'TEST-A-001', '2026-01-01', '2027-01-01', 'active', ?)`).run(cabA, cliA.id, adminId).lastInsertRowid;
  const polB = bd.prepare(`INSERT INTO polices (cabinet_id, client_id, ligne, assureur, numero_police, date_effet, date_echeance, statut, responsable_id)
    VALUES (?, ?, 'flotte', 'Assureur Test', 'TEST-B-001', '2026-01-01', '2027-01-01', 'active', ?)`).run(cabA, cliB.id, adminId).lastInsertRowid;
  test('polices créées pour A et B', polA > 0 && polB > 0);

  const cheminTmp = path.join(os.tmpdir(), 'analyse-client-cible.pdf');
  fs.writeFileSync(cheminTmp, '%PDF-1.4 document de test');
  function creerAnalyse(entreprise, { demandeId = null } = {}) {
    const champs = [
      { champ: 'client.entreprise', table: 'clients', colonne: 'raison_sociale', libelle: 'Entreprise', valeur: entreprise, confiance: 'haute', extrait: 'Assuré nommé : ' + entreprise },
      { champ: 'garanties.prime', table: 'flotte_soumissions', colonne: 'prime', libelle: 'Prime', valeur: 5000, confiance: 'haute', extrait: 'Prime : 5 000 $' },
    ];
    const listes = { vehicules: [{ champs: { niv: '1FTEW1E50LFA12345', annee: 2024, marque: 'Ford', modele: 'F-150' }, confiance: 'haute', extrait: 'Ford F-150 2024' }] };
    return bd.prepare(`INSERT INTO analyses_documents (cabinet_id, utilisateur_id, nom_origine, chemin, mime, taille,
        statut, produit_detecte, confiance_globale, champs_proposes, listes_proposees, moteur, demande_info_id)
      VALUES (?, ?, 'doc-test.pdf', ?, 'application/pdf', 100, 'a_reviser', 'flotte', 0.9, ?, ?, 'local', ?)`)
      .run(cabA, adminId, cheminTmp, JSON.stringify(champs), JSON.stringify(listes), demandeId).lastInsertRowid;
  }
  const nbVehicules = (soumId) => bd.prepare('SELECT COUNT(*) n FROM flotte_vehicules WHERE soumission_id = ?').get(soumId).n;
  const statutAnalyse = (id) => bd.prepare('SELECT statut FROM analyses_documents WHERE id = ?').get(id).statut;

  // ---- 2. Login admin ---------------------------------------------------------
  console.log('2. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, String(r.statut));
  async function fiche(id) { return req(jar, 'GET', '/analyses/' + id); }
  async function inserer(id, jeton, form) {
    return req(jar, 'POST', '/analyses/' + id + '/inserer', { form: { _csrf: jeton, ...form } });
  }

  // ---- 3. Fiche : sélecteur client + pré-sélection + données de filtrage ------
  console.log('3. Fiche de révision');
  const a1 = creerAnalyse(cliA.raison_sociale);
  r = await fiche(a1);
  test('fiche : 200', r.statut === 200, String(r.statut));
  test('fiche : libellé « Client du document » présent', /Client du document/.test(r.texte));
  test('fiche : sélecteur name="client_id" présent', /<select id="client_id" name="client_id">/.test(r.texte));
  test('fiche : client résolu (Méthot) pré-sélectionné',
    new RegExp(`<option value="${cliA.id}" selected>`).test(r.texte));
  test('fiche : options soumission portent data-client et data-produit',
    r.texte.includes(`data-client="${cliB.id}"`) && r.texte.includes('data-produit="flotte"'));
  test('fiche : options police portent data-client',
    new RegExp(`<option value="${polA}" data-client="${cliA.id}">`).test(r.texte));
  test('fiche : messages « aucune soumission / aucune police » présents',
    /Aucune soumission du produit choisi pour ce client/.test(r.texte) && /Aucune police pour ce client/.test(r.texte));

  // Analyse dont l'entreprise extraite est inconnue : aucune pré-sélection.
  const aInconnue = creerAnalyse('Entreprise Inconnue ZZ inc.');
  r = await fiche(aInconnue);
  test('fiche : entreprise inconnue → aucune pré-sélection client',
    !new RegExp(`<option value="${cliA.id}" selected>`).test(r.texte)
    && !new RegExp(`<option value="${cliB.id}" selected>`).test(r.texte));

  // ---- 4. Rattachement incohérent : soumission d'un autre client → 400 --------
  console.log('4. Incohérences refusées');
  const a2 = creerAnalyse(cliA.raison_sociale);
  const vehBavant = nbVehicules(soumB);
  r = await fiche(a2);
  const post2 = await inserer(a2, csrf(r.texte), {
    produit: 'flotte', cible: 'soumission_existante', client_id: String(cliA.id),
    soumission_existante: `flotte:${soumB}`,
    ...FORM_LISTE_VEHICULE, valeur_0: cliA.raison_sociale,
  });
  test('POST soumission de B avec client A → 400', post2.statut === 400, String(post2.statut));
  test('message explicite « n appartient pas au client sélectionné »',
    /appartient pas au client sélectionné/.test(post2.texte));
  test('analyse toujours « a_reviser » (rien d inséré)', statutAnalyse(a2) === 'a_reviser', statutAnalyse(a2));
  test('aucun véhicule ajouté à la soumission de B', nbVehicules(soumB) === vehBavant);

  // ---- 5. Rattachement incohérent : police d'un autre client → 400 --------------
  const a3 = creerAnalyse(cliA.raison_sociale);
  const docsBavant = bd.prepare('SELECT COUNT(*) n FROM documents WHERE police_id = ?').get(polB).n;
  r = await fiche(a3);
  const post3 = await inserer(a3, csrf(r.texte), {
    produit: 'flotte', cible: 'police_existante', client_id: String(cliA.id), police_id: String(polB),
    ...FORM_LISTE_VEHICULE, valeur_0: cliA.raison_sociale,
  });
  test('POST police de B avec client A → 400', post3.statut === 400, String(post3.statut));
  test('message explicite pour la police', /La police choisie n(&#39;|')appartient pas au client sélectionné/.test(post3.texte));
  test('aucun document copié vers la police de B',
    bd.prepare('SELECT COUNT(*) n FROM documents WHERE police_id = ?').get(polB).n === docsBavant);
  test('analyse toujours « a_reviser »', statutAnalyse(a3) === 'a_reviser');

  // ---- 6. Rattachement cohérent → insertion -----------------------------------
  console.log('5. Insertion cohérente');
  const a4 = creerAnalyse(cliA.raison_sociale);
  const vehAavant = nbVehicules(soumA);
  r = await fiche(a4);
  const post4 = await inserer(a4, csrf(r.texte), {
    produit: 'flotte', cible: 'soumission_existante', client_id: String(cliA.id),
    soumission_existante: `flotte:${soumA}`,
    ...FORM_LISTE_VEHICULE, valeur_0: cliA.raison_sociale,
  });
  test('POST cohérent (client A + sa soumission) → 302', post4.statut === 302, String(post4.statut));
  test('analyse « insere »', statutAnalyse(a4) === 'insere', statutAnalyse(a4));
  test('véhicule ajouté à la soumission de A', nbVehicules(soumA) === vehAavant + 1);

  // ---- 7. Création avec client forcé ------------------------------------------
  console.log('6. Création chez le client forcé');
  const nbSoumBavant = bd.prepare('SELECT COUNT(*) n FROM flotte_soumissions WHERE cabinet_id = ? AND client_id = ?').get(cabA, cliB.id).n;
  r = await fiche(aInconnue);
  const post5 = await inserer(aInconnue, csrf(r.texte), {
    produit: 'flotte', cible: 'soumission', client_id: String(cliB.id),
    inclure_0: 'on', valeur_0: 'Entreprise Inconnue ZZ inc.', inclure_1: 'on', valeur_1: '5000',
  });
  test('POST création avec client forcé B → 302', post5.statut === 302, String(post5.statut));
  const aInc = bd.prepare('SELECT soumission_id FROM analyses_documents WHERE id = ?').get(aInconnue);
  const soumCreee = aInc && aInc.soumission_id
    ? bd.prepare('SELECT client_id FROM flotte_soumissions WHERE id = ?').get(aInc.soumission_id) : null;
  test('soumission créée chez le client B (malgré le nom extrait inconnu)',
    !!soumCreee && soumCreee.client_id === cliB.id, JSON.stringify(soumCreee));
  test('aucun client « Entreprise Inconnue ZZ » créé par la résolution',
    !bd.prepare("SELECT id FROM clients WHERE cabinet_id = ? AND raison_sociale = 'Entreprise Inconnue ZZ inc.'").get(cabA));
  test('compteur de soumissions de B augmenté',
    bd.prepare('SELECT COUNT(*) n FROM flotte_soumissions WHERE cabinet_id = ? AND client_id = ?').get(cabA, cliB.id).n === nbSoumBavant + 1);

  // ---- 8. Demande liée : client verrouillé, imposé par le serveur -------------
  console.log('7. Demande liée (client verrouillé)');
  const demandeId = bd.prepare(`INSERT INTO demandes_infos (cabinet_id, produit, soumission_id, client_id,
      destinataire, sujet, corps, questions, statut, cree_par)
    VALUES (?, 'flotte', ?, ?, 'client@exemple.ca', 'Informations manquantes', 'Bonjour,', '[]', 'envoyee', ?)`)
    .run(cabA, soumDemande, cliA.id, adminId).lastInsertRowid;
  const a6 = creerAnalyse(cliB.raison_sociale, { demandeId });
  r = await fiche(a6);
  test('fiche demande : client verrouillé affiché (Méthot, pas le nom extrait)',
    r.texte.includes('verrouillé') && r.texte.includes(cliA.raison_sociale));
  test('fiche demande : client_id en champ caché = client de la demande',
    new RegExp(`<input type="hidden" id="client_id" name="client_id" value="${cliA.id}">`).test(r.texte));
  test('fiche demande : aucun sélecteur client libre',
    !/<select id="client_id" name="client_id">/.test(r.texte));
  const jeton6 = csrf(r.texte);
  const post6a = await inserer(a6, jeton6, {
    produit: 'flotte', cible: 'soumission_existante',
    soumission_existante: `flotte:${soumB}`,
    ...FORM_LISTE_VEHICULE, valeur_0: cliB.raison_sociale,
  });
  test('POST demande sans client_id, soumission de B → 400 (client imposé par la demande)',
    post6a.statut === 400 && /appartient pas au client sélectionné/.test(post6a.texte), String(post6a.statut));
  const vehDemandeAvant = nbVehicules(soumDemande);
  const post6b = await inserer(a6, jeton6, {
    produit: 'flotte', cible: 'soumission_existante',
    soumission_existante: `flotte:${soumDemande}`,
    ...FORM_LISTE_VEHICULE, valeur_0: cliB.raison_sociale,
  });
  test('POST demande vers SA soumission → 302', post6b.statut === 302, String(post6b.statut));
  test('véhicule ajouté à la soumission de la demande', nbVehicules(soumDemande) === vehDemandeAvant + 1);

  // ---- 9. CSRF ------------------------------------------------------------------
  console.log('8. CSRF');
  const a7 = creerAnalyse(cliA.raison_sociale);
  const post7 = await req(jar, 'POST', '/analyses/' + a7 + '/inserer', {
    form: { produit: 'flotte', cible: 'soumission', client_id: String(cliA.id), inclure_1: 'on', valeur_1: '5000' },
  });
  test('POST sans jeton CSRF → 403', post7.statut === 403, String(post7.statut));
  test('analyse CSRF toujours « a_reviser »', statutAnalyse(a7) === 'a_reviser');

  console.log(echecs === 0 ? `\n🎉 ${total}/${total} tests réussis` : `\n💥 ${total - echecs}/${total} tests réussis — ${echecs} échec(s)`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
