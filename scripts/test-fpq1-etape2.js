/**
 * scripts/test-fpq1-etape2.js — UI questionnaire FPQ1 (étape 2/10) :
 * onglet Auto, création soumission, conducteurs/véhicules illimités,
 * garanties, antécédents, versions, statuts, archivage, CSRF,
 * cloisonnement inter-cabinets, portefeuille courtier, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-fpq1-etape2.js
 * (CHEMIN_BD optionnel pour l'accès direct à la base du serveur.)
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

(async () => {
  console.log('== Tests FPQ1 étape 2 (UI) :', BASE);

  // ---- Préparation directe : 2e cabinet, courtier, clients -----------------
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const cabB = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet B').lastInsertRowid;
  const hash = bcrypt.hashSync('Test1234!', 4);
  const adminB = bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)"
  ).run(cabB, 'adminb@t.ca', hash, 'Admin B').lastInsertRowid;
  const courtier1 = bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)"
  ).run(cabA, 'courtier1@t.ca', hash, 'Courtier Un').lastInsertRowid;
  const courtier2 = bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)"
  ).run(cabA, 'courtier2@t.ca', hash, 'Courtier Deux').lastInsertRowid;
  const cli1 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)'
  ).run(cabA, 'Client Test inc.', 'Jean', 'Test').lastInsertRowid;
  const cli2 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Autre inc.', 'Marie', 'Autre', courtier2).lastInsertRowid;
  const cli3 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Courtier inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
  test('préparation directe OK', adminB > 0 && courtier1 > 0 && cli1 > 0);

  // ---- 1. Login admin démo --------------------------------------------------
  console.log('1. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 2. Onglet + création ---------------------------------------------------
  console.log('2. Liste et création');
  r = await req(jar, 'GET', '/auto');
  test('GET /auto → 200', r.statut === 200, r.statut);
  test('onglet Auto dans la navigation', /href="\/auto">Auto</.test(r.texte) || />Auto</.test(r.texte));
  r = await req(jar, 'GET', '/auto/nouveau');
  test('GET /auto/nouveau → 200', r.statut === 200, r.statut);
  test('formulaire propose les entreprises', r.texte.includes('Client Test inc.'));
  r = await req(jar, 'POST', '/auto', { form: { _csrf: csrf((await req(jar, 'GET', '/auto/nouveau')).texte) } });
  test('création sans client → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/auto', { form: { _csrf: csrf((await req(jar, 'GET', '/auto/nouveau')).texte), client_id: '99999' } });
  test('création client invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/auto', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/auto/nouveau')).texte),
      client_id: String(cli1), date_effet_souhaitee: '2026-12-01', notes: 'Test UI',
    },
  });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche', r.location === '/auto/' + sid && sid > 0, r.location);

  // ---- 3. Fiche : sections ------------------------------------------------------
  console.log('3. Fiche soumission');
  r = await req(jar, 'GET', '/auto/' + sid);
  test('fiche → 200', r.statut === 200, r.statut);
  for (const sec of ['Conducteurs', 'Véhicules', 'Garanties par véhicule', 'Antécédents', 'Historique des versions']) {
    test(`section « ${sec} » présente`, r.texte.includes(sec), sec);
  }
  test('badge Brouillon', r.texte.includes('Brouillon'));

  // ---- 4. Conducteurs (illimités) -------------------------------------------------
  console.log('4. Conducteurs');
  const conds = [
    { prenom: 'Alice', nom: 'Martin', date_naissance: '1990-05-01', numero_permis: 'M1234', conducteur_principal: 'on' },
    { prenom: 'Bob', nom: 'Lévesque', numero_permis: 'L5678' },
    { prenom: 'Caro', nom: 'Roy', numero_permis: 'R9012',
      infractions_json: JSON.stringify([{ date: '2023-06-01', type: 'Excès de vitesse', points: '3' }]) },
  ];
  for (const [i, c] of conds.entries()) {
    r = await req(jar, 'GET', '/auto/' + sid);
    r = await req(jar, 'POST', `/auto/${sid}/conducteur`, { form: { _csrf: csrf(r.texte), ...c } });
    test(`ajout conducteur ${i + 1} → 302`, r.statut === 302, r.statut);
  }
  r = await req(jar, 'POST', `/auto/${sid}/conducteur`, { form: { _csrf: csrf((await req(jar, 'GET', '/auto/' + sid)).texte), prenom: 'Sans' } });
  test('conducteur sans nom → 400', r.statut === 400, r.statut);
  r = await req(jar, 'GET', '/auto/' + sid);
  test('3 conducteurs affichés', ['Alice Martin', 'Bob Lévesque', 'Caro Roy'].every((n) => r.texte.includes(n)));
  r = await req(jar, 'GET', `/auto/${sid}/versions/4`);
  test('version v4 (après 3 conducteurs) → 200', r.statut === 200, r.statut);
  test('v1 consultable → 200', (await req(jar, 'GET', `/auto/${sid}/versions/1`)).statut === 200);
  test('version inexistante → 404', (await req(jar, 'GET', `/auto/${sid}/versions/99`)).statut === 404);

  // ---- 5. Véhicules (illimités) -----------------------------------------------------
  console.log('5. Véhicules');
  const vehs = [
    { annee: '2022', marque: 'Toyota', modele: 'Corolla', vin: 'VIN12345678901234', usage: 'promenade', km_annuel: '15000', antivol_tag: 'on' },
    { annee: '2020', marque: 'Honda', modele: 'Civic', financement: 'finance', creancier_nom: 'Banque X' },
  ];
  const vids = [];
  for (const [i, v] of vehs.entries()) {
    r = await req(jar, 'GET', '/auto/' + sid);
    r = await req(jar, 'POST', `/auto/${sid}/vehicule`, { form: { _csrf: csrf(r.texte), ...v } });
    test(`ajout véhicule ${i + 1} → 302`, r.statut === 302, r.statut);
    vids.push(Number(bd.prepare('SELECT id FROM auto_vehicules WHERE soumission_id = ? ORDER BY id DESC LIMIT 1').get(sid).id));
  }
  r = await req(jar, 'GET', '/auto/' + sid);
  test('2 véhicules affichés', r.texte.includes('Toyota') && r.texte.includes('Honda'));

  // ---- 6. Garanties --------------------------------------------------------------------
  console.log('6. Garanties');
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/vehicule/${vids[0]}/garanties`, {
    form: {
      _csrf: csrf(r.texte), rc_montant: '2000000', protection_b: 'b1', franchise_b: '500',
      avenants: ['faq43', 'faq20'], prime: '1200',
    },
  });
  test('garanties véhicule 1 → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/auto/' + sid);
  test('B1 affiché sur la fiche', r.texte.includes('B1 — Tous risques'));
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/vehicule/${vids[0]}/garanties`, {
    form: { _csrf: csrf(r.texte), protection_b: 'b9' },
  });
  test('protection B invalide → 400', r.statut === 400, r.statut);

  // ---- 7. Antécédents -----------------------------------------------------------------------
  console.log('7. Antécédents');
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Intact', numero_police_actuelle: 'A123',
      annees_assurance_continue: '5', non_paiement_ant: 'on',
      sinistres_json: JSON.stringify([{ date: '2022-03-01', type: 'Collision', montant: '2500', responsabilite: 'Non responsable' }]),
      consentement_credit: 'on', consentement_fcsa: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/auto/' + sid);
  test('assureur actuel affiché', r.texte.includes('Intact'));

  // ---- 8. Statuts + filtre -----------------------------------------------------------------------
  console.log('8. Statuts');
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/statut`, { form: { _csrf: csrf(r.texte), statut: 'soumise' } });
  test('statut → soumise (302)', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/auto/' + sid);
  test('badge Soumise', r.texte.includes('Soumise'));
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/statut`, { form: { _csrf: csrf(r.texte), statut: 'nimporte' } });
  test('statut invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'GET', '/auto?statut=soumise');
  test('filtre soumise : visible', r.texte.includes('/auto/' + sid));
  r = await req(jar, 'GET', '/auto?statut=brouillon');
  test('filtre brouillon : invisible', !r.texte.includes('/auto/' + sid));

  // ---- 9. Archivage ---------------------------------------------------------------------------------
  console.log('9. Archivage');
  r = await req(jar, 'GET', '/auto/' + sid);
  const cidArch = Number(bd.prepare('SELECT id FROM auto_conducteurs WHERE soumission_id = ? AND prenom = ?').get(sid, 'Bob').id);
  r = await req(jar, 'POST', `/auto/conducteur/${cidArch}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('conducteur archivé → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/auto/' + sid);
  test('conducteur archivé retiré du tableau', !r.texte.includes(`/auto/conducteur/${cidArch}/archiver`));
  test('conducteur archivé listé comme restorable', r.texte.includes('Archivés'));
  r = await req(jar, 'POST', `/auto/conducteur/${cidArch}/desarchiver`, { form: { _csrf: csrf(r.texte) } });
  test('conducteur désarchivé → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('soumission archivée → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/auto');
  test('archivée invisible en liste', !r.texte.includes('Client Test inc.'));
  r = await req(jar, 'GET', '/auto?archives=1');
  test('visible via « Voir les archivées »', r.texte.includes('/auto/' + sid));
  r = await req(jar, 'POST', `/auto/${sid}/desarchiver`, { form: { _csrf: csrf((await req(jar, 'GET', `/auto/${sid}`)).texte) } });
  test('soumission désarchivée → 302', r.statut === 302, r.statut);

  // ---- 10. CSRF + 404 -----------------------------------------------------------------------------------
  console.log('10. Sécurité de base');
  r = await req(jar, 'POST', '/auto', { form: { client_id: String(cli1) } });
  test('POST sans CSRF → 403', r.statut === 403, r.statut);
  test('GET /auto/99999 → 404', (await req(jar, 'GET', '/auto/99999')).statut === 404);
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', '/auto/99999/conducteur', { form: { _csrf: csrf(r.texte), prenom: 'X', nom: 'Y' } });
  test('POST conducteur soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 11. Cloisonnement inter-cabinets ----------------------------------------------------------------------
  console.log('11. Inter-cabinets');
  const { jar: jarB, ok: okB } = await loginComme('adminb@t.ca', 'Test1234!');
  test('login admin cabinet B', okB);
  test('cabinet B : fiche → 404', (await req(jarB, 'GET', '/auto/' + sid)).statut === 404);
  r = await req(jarB, 'GET', '/auto');
  test('cabinet B : liste vide', r.statut === 200 && !r.texte.includes('Client Test inc.'));
  r = await req(jarB, 'GET', '/auto/' + sid);
  r = await req(jarB, 'POST', `/auto/${sid}/conducteur`, { form: { _csrf: csrf(r.texte), prenom: 'X', nom: 'Y' } });
  test('cabinet B : ajout conducteur → 404', r.statut === 404, r.statut);

  // ---- 12. Portefeuille courtier ----------------------------------------------------------------------------------
  console.log('12. Courtier');
  const { jar: jarC1, ok: okC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  test('login courtier1', okC1);
  r = await req(jarC1, 'GET', '/auto/nouveau');
  r = await req(jarC1, 'POST', '/auto', { form: { _csrf: csrf(r.texte), client_id: String(cli2) } });
  test('courtier : client hors portefeuille → 400', r.statut === 400 && r.texte.includes('portefeuille'), r.statut);
  r = await req(jarC1, 'GET', '/auto/nouveau');
  r = await req(jarC1, 'POST', '/auto', { form: { _csrf: csrf(r.texte), client_id: String(cli3) } });
  test('courtier : client de son portefeuille → 302', r.statut === 302, r.statut);
  const sidC = Number((r.location || '').split('/').pop());
  test('courtier : fiche de sa soumission → 200', (await req(jarC1, 'GET', '/auto/' + sidC)).statut === 200);
  test('courtier : liste ne montre pas les autres', !(await req(jarC1, 'GET', '/auto')).texte.includes('Client Test inc.'));
  const { jar: jarC2, ok: okC2 } = await loginComme('courtier2@t.ca', 'Test1234!');
  test('login courtier2', okC2);
  test('courtier2 : fiche d’autrui → 403', (await req(jarC2, 'GET', '/auto/' + sidC)).statut === 403);

  // ---- 13. Audit -------------------------------------------------------------------------------------------------------
  console.log('13. Audit');
  const nbAudit = bd.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action LIKE 'fpq1_%' AND cabinet_id = ?").get(cabA).n;
  test('actions FPQ1 journalisées', nbAudit >= 10, nbAudit + ' entrées');

  bd.close();
  console.log(`\n${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
