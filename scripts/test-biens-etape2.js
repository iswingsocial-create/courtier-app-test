/**
 * scripts/test-biens-etape2.js — UI questionnaire biens commerciaux (étape 2/10 biens) :
 * onglet Biens, création soumission, bâtiments/contenus illimités,
 * garanties par bâtiment, antécédents, versions, statuts, archivage, CSRF,
 * cloisonnement inter-cabinets, portefeuille courtier, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-biens-etape2.js
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
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (Array.isArray(v)) { for (const x of v) params.append(k, x); }
      else params.append(k, v);
    }
    corps = params.toString();
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
function nbVersions(sid) {
  return bd.prepare('SELECT COUNT(*) AS n FROM biens_soumission_versions WHERE soumission_id = ?').get(sid).n;
}

(async () => {
  console.log('== Tests biens étape 2 (UI) :', BASE);

  // ---- Préparation directe : 2e cabinet, courtiers, clients -----------------
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const cabB = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet B').lastInsertRowid;
  const hash = bcrypt.hashSync('Test123456!', 4);
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
  ).run(cabA, 'Client Biens inc.', 'Jean', 'Biens').lastInsertRowid;
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

  // ---- 2. Onglet + création -------------------------------------------------
  console.log('2. Liste et création');
  r = await req(jar, 'GET', '/biens');
  test('GET /biens → 200', r.statut === 200, r.statut);
  test('onglet Biens dans la navigation', /href="\/biens">Biens</.test(r.texte));
  r = await req(jar, 'GET', '/biens/nouveau');
  test('GET /biens/nouveau → 200', r.statut === 200, r.statut);
  test('formulaire propose les entreprises', r.texte.includes('Client Biens inc.'));
  r = await req(jar, 'POST', '/biens', { form: { _csrf: csrf((await req(jar, 'GET', '/biens/nouveau')).texte) } });
  test('création sans client → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/biens', { form: { _csrf: csrf((await req(jar, 'GET', '/biens/nouveau')).texte), client_id: '99999' } });
  test('création client invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/biens', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/biens/nouveau')).texte),
      client_id: String(cli1), date_effet_souhaitee: '2026-12-01', notes: 'Test UI biens',
    },
  });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche', r.location === '/biens/' + sid && sid > 0, r.location);
  test('v1 créée', nbVersions(sid) === 1, nbVersions(sid));

  // ---- 3. Fiche : sections ----------------------------------------------------
  console.log('3. Fiche soumission');
  r = await req(jar, 'GET', '/biens/' + sid);
  test('fiche → 200', r.statut === 200, r.statut);
  for (const s of ['Bâtiments', 'Contenus', 'Garanties par bâtiment', 'Antécédents', 'Historique des versions']) {
    test('section « ' + s + ' » présente', r.texte.includes(s));
  }

  // ---- 4. Bâtiments ------------------------------------------------------------
  console.log('4. Bâtiments');
  const tok = async () => csrf((await req(jar, 'GET', '/biens/' + sid)).texte);
  r = await req(jar, 'POST', `/biens/${sid}/batiment`, { form: { _csrf: await tok() } });
  test('bâtiment sans adresse → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/biens/${sid}/batiment`, {
    form: { _csrf: await tok(), adresse: '123 rue Principale', type_construction: 'inexistant' },
  });
  test('type de construction invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/biens/${sid}/batiment`, {
    form: {
      _csrf: await tok(), adresse: '123 rue Principale', ville: 'Montréal', code_postal: 'H2X 1Y1',
      type_construction: 'beton', annee_construction: '1995', superficie_pi2: '5000', nb_etages: '2',
      occupation: 'Bureau', valeur_batiment: '750000', gicleurs: 'on', distance_caserne_km: '1.2',
      chauffage: 'Électrique', annee_toiture: '2018', notes: 'Test',
    },
  });
  test('ajout bâtiment → 302', r.statut === 302, r.statut);
  const bid = bd.prepare('SELECT id FROM biens_batiments WHERE soumission_id = ? AND archive = 0').get(sid).id;
  test('bâtiment en base', bid > 0);
  test('version créée après ajout', nbVersions(sid) === 2, nbVersions(sid));
  r = await req(jar, 'GET', '/biens/' + sid);
  test('bâtiment visible sur la fiche', r.texte.includes('123 rue Principale'));
  test('gicleurs affichés', r.texte.includes('Gicleurs'));
  // modification
  r = await req(jar, 'POST', `/biens/batiment/${bid}`, {
    form: { _csrf: await tok(), adresse: '123 rue Principale', ville: 'Laval', type_construction: 'acier' },
  });
  test('modification bâtiment → 302', r.statut === 302, r.statut);
  test('ville modifiée en base', bd.prepare('SELECT ville FROM biens_batiments WHERE id = ?').get(bid).ville === 'Laval');
  test('version créée après modification', nbVersions(sid) === 3, nbVersions(sid));
  // archivage / désarchivage
  r = await req(jar, 'POST', `/biens/batiment/${bid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage bâtiment → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/biens/' + sid);
  test('bâtiment archivé hors de la liste active', !r.texte.includes('123 rue Principale') || r.texte.includes('Archivés'));
  r = await req(jar, 'POST', `/biens/batiment/${bid}/desarchiver`, { form: { _csrf: await tok() } });
  test('désarchivage bâtiment → 302', r.statut === 302, r.statut);
  test('bâtiment restauré', bd.prepare('SELECT archive FROM biens_batiments WHERE id = ?').get(bid).archive === 0);

  // ---- 5. Contenus ---------------------------------------------------------------
  console.log('5. Contenus');
  r = await req(jar, 'POST', `/biens/${sid}/contenu`, { form: { _csrf: await tok(), description: '' } });
  test('contenu sans description → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/biens/${sid}/contenu`, {
    form: { _csrf: await tok(), description: 'Serveurs', type_contenu: 'equipements', valeur: '50000', batiment_id: '99999' },
  });
  test('contenu bâtiment invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/biens/${sid}/contenu`, {
    form: { _csrf: await tok(), description: 'Mobilier de bureau', type_contenu: 'mobilier', valeur: '25000' },
  });
  test('contenu général → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/biens/${sid}/contenu`, {
    form: { _csrf: await tok(), description: 'Stock de pièces', type_contenu: 'stock', valeur: '120000', batiment_id: String(bid) },
  });
  test('contenu rattaché au bâtiment → 302', r.statut === 302, r.statut);
  const cid = bd.prepare('SELECT id FROM biens_contenus WHERE soumission_id = ? AND description = ?').get(sid, 'Stock de pièces').id;
  test('contenu en base', cid > 0);
  r = await req(jar, 'GET', '/biens/' + sid);
  test('contenus visibles', r.texte.includes('Mobilier de bureau') && r.texte.includes('Stock de pièces'));
  r = await req(jar, 'POST', `/biens/contenu/${cid}`, {
    form: { _csrf: await tok(), description: 'Stock de pièces', type_contenu: 'stock', valeur: '130000' },
  });
  test('modification contenu → 302', r.statut === 302, r.statut);
  test('valeur modifiée', Number(bd.prepare('SELECT valeur FROM biens_contenus WHERE id = ?').get(cid).valeur) === 130000);
  r = await req(jar, 'POST', `/biens/contenu/${cid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage contenu → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/biens/contenu/${cid}/desarchiver`, { form: { _csrf: await tok() } });
  test('désarchivage contenu → 302', r.statut === 302, r.statut);

  // ---- 6. Garanties ------------------------------------------------------------------
  console.log('6. Garanties');
  r = await req(jar, 'POST', `/biens/${sid}/batiment/${bid}/garanties`, {
    form: { _csrf: await tok(), formule: 'mauvaise' },
  });
  test('formule invalide → 400', r.statut === 400, r.statut);
  const vAvant = nbVersions(sid);
  r = await req(jar, 'POST', `/biens/${sid}/batiment/${bid}/garanties`, {
    form: {
      _csrf: await tok(), formule: 'tous_risques', franchise: '5000', montant_assurance: '750000',
      avenants: ['tremblement_terre', 'inondation'], prime: '3200',
    },
  });
  test('garanties → 302', r.statut === 302, r.statut);
  const g = bd.prepare('SELECT * FROM biens_garanties WHERE batiment_id = ?').get(bid);
  test('garanties en base', !!g && g.formule === 'tous_risques');
  test('avenants stockés', JSON.parse(g.avenants).tremblement_terre === 1 && JSON.parse(g.avenants).inondation === 1);
  test('version créée après garanties', nbVersions(sid) === vAvant + 1);
  r = await req(jar, 'GET', '/biens/' + sid);
  test('garanties affichées sur la fiche', r.texte.includes('Tous risques'));

  // ---- 7. Antécédents --------------------------------------------------------------------
  console.log('7. Antécédents');
  r = await req(jar, 'POST', `/biens/${sid}/antecedents`, {
    form: {
      _csrf: await tok(), assureur_actuel: 'Assureur Test', numero_police_actuelle: 'B-123',
      date_expiration_actuelle: '2026-11-01', annees_assurance_continue: '8',
      sinistres_json: JSON.stringify([{ date: '2024-03-10', type: 'Dégât d’eau', montant: '12000' }]),
      consentement_credit: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);
  const a = bd.prepare('SELECT * FROM biens_antecedents WHERE soumission_id = ?').get(sid);
  test('antécédents en base', !!a && a.assureur_actuel === 'Assureur Test');
  test('sinistre stocké', JSON.parse(a.sinistres_5ans)[0].type === 'Dégât d’eau');
  test('consentement stocké', JSON.parse(a.consentements).credit === 1);
  r = await req(jar, 'GET', '/biens/' + sid);
  test('antécédents affichés', r.texte.includes('Assureur Test'));

  // ---- 8. Statuts, versions, 404 ------------------------------------------------------------
  console.log('8. Statuts, versions, 404');
  r = await req(jar, 'POST', `/biens/${sid}/statut`, { form: { _csrf: await tok(), statut: 'invalide' } });
  test('statut invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/biens/${sid}/statut`, { form: { _csrf: await tok(), statut: 'soumise' } });
  test('statut soumise → 302', r.statut === 302, r.statut);
  test('statut en base', bd.prepare('SELECT statut FROM biens_soumissions WHERE id = ?').get(sid).statut === 'soumise');
  r = await req(jar, 'GET', `/biens/${sid}/versions/1`);
  test('version v1 → 200', r.statut === 200, r.statut);
  test('version lecture seule (bâtiments)', r.texte.includes('Bâtiments'));
  r = await req(jar, 'GET', `/biens/${sid}/versions/999`);
  test('version inexistante → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/biens/999999');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 9. Archivage de la soumission ----------------------------------------------------------
  console.log('9. Archivage soumission');
  r = await req(jar, 'POST', `/biens/${sid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage soumission → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/biens');
  test('soumission hors de la liste active', !r.texte.includes('Client Biens inc.'));
  r = await req(jar, 'GET', '/biens?archives=1');
  test('soumission visible dans les archives', r.texte.includes('Client Biens inc.'));
  r = await req(jar, 'POST', `/biens/${sid}/desarchiver`, { form: { _csrf: csrf((await req(jar, 'GET', '/biens/' + sid)).texte) } });
  test('désarchivage soumission → 302', r.statut === 302, r.statut);

  // ---- 10. Portefeuille courtier ---------------------------------------------------------------
  console.log('10. Portefeuille courtier');
  const lc1 = await loginComme('courtier1@t.ca', 'Test123456!');
  test('login courtier1 → 302', lc1.ok);
  r = await req(lc1.jar, 'GET', '/biens');
  test('courtier ne voit pas la soumission hors portefeuille', !r.texte.includes('Client Biens inc.'));
  // crée une soumission pour cli3 (son portefeuille) directement
  const sidC = bd.prepare(
    'INSERT INTO biens_soumissions (cabinet_id, client_id) VALUES (?, ?)'
  ).run(cabA, cli3).lastInsertRowid;
  r = await req(lc1.jar, 'GET', '/biens/' + sidC);
  test('courtier ouvre sa soumission → 200', r.statut === 200, r.statut);
  r = await req(lc1.jar, 'GET', '/biens/' + sid);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(lc1.jar, 'POST', '/biens', {
    form: { _csrf: csrf((await req(lc1.jar, 'GET', '/biens/nouveau')).texte), client_id: String(cli2) },
  });
  test('création hors portefeuille → 400', r.statut === 400, r.statut);

  // ---- 11. Inter-cabinets -------------------------------------------------------------------------
  console.log('11. Inter-cabinets');
  const lb = await loginComme('adminb@t.ca', 'Test123456!');
  test('login adminB → 302', lb.ok);
  r = await req(lb.jar, 'GET', '/biens/' + sid);
  test('cabinet B ne voit pas → 404', r.statut === 404, r.statut);

  // ---- 12. Non connecté + CSRF -----------------------------------------------------------------------
  console.log('12. Auth et CSRF');
  const jarAnon = nouveauJar();
  r = await req(jarAnon, 'GET', '/biens');
  test('non connecté → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', '/biens', { form: { client_id: String(cli1) } });
  test('POST sans CSRF → 403', r.statut === 403, r.statut);

  // ---- 13. Audit ---------------------------------------------------------------------------------------
  console.log('13. Audit');
  const n = bd.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action LIKE 'biens_%'").get().n;
  test('journal d’audit alimenté', n >= 10, n);

  console.log(`\n== ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE :', e); process.exit(1); });
