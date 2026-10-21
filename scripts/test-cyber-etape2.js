/**
 * scripts/test-cyber-etape2.js — UI questionnaire Cyber / cyberrisques (étape 2/10 cyber) :
 * onglet Cyber, création soumission, mesures de sécurité illimitées,
 * garanties par soumission, antécédents (incidents cyber 5 ans), versions,
 * statuts, archivage, CSRF, cloisonnement inter-cabinets, portefeuille courtier, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-cyber-etape2.js
 * (CHEMIN_BD optionnel pour l'accès direct à la base du serveur.)
 * Miroir de scripts/test-rc-etape2.js.
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
  return bd.prepare('SELECT COUNT(*) AS n FROM cyber_soumission_versions WHERE soumission_id = ?').get(sid).n;
}

(async () => {
  console.log('== Tests Cyber étape 2 (UI) :', BASE);

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
  ).run(cabA, 'Client Cyber inc.', 'Jean', 'Cyber').lastInsertRowid;
  const cli2 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Autre Cyber inc.', 'Marie', 'Autre', courtier2).lastInsertRowid;
  const cli3 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Courtier Cyber inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
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
  r = await req(jar, 'GET', '/cyber');
  test('GET /cyber → 200', r.statut === 200, r.statut);
  test('onglet Cyber dans la navigation', /href="\/cyber">Cyber</.test(r.texte));
  test('colonne Mesures de sécurité', r.texte.includes('Mesures de sécurité'));
  r = await req(jar, 'GET', '/cyber/nouveau');
  test('GET /cyber/nouveau → 200', r.statut === 200, r.statut);
  test('formulaire propose les entreprises', r.texte.includes('Client Cyber inc.'));
  r = await req(jar, 'POST', '/cyber', { form: { _csrf: csrf((await req(jar, 'GET', '/cyber/nouveau')).texte) } });
  test('création sans client → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/cyber', { form: { _csrf: csrf((await req(jar, 'GET', '/cyber/nouveau')).texte), client_id: '99999' } });
  test('création client invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/cyber', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/cyber/nouveau')).texte),
      client_id: String(cli1), date_effet_souhaitee: '2026-12-01', notes: 'Test UI cyber',
    },
  });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche', r.location === '/cyber/' + sid && sid > 0, r.location);
  test('v1 créée', nbVersions(sid) === 1, nbVersions(sid));

  // ---- 3. Fiche : sections ----------------------------------------------------
  console.log('3. Fiche soumission');
  r = await req(jar, 'GET', '/cyber/' + sid);
  test('fiche → 200', r.statut === 200, r.statut);
  for (const s of ['Mesures de sécurité', 'Garanties', 'Antécédents', 'Historique des versions']) {
    test('section « ' + s + ' » présente', r.texte.includes(s));
  }

  // ---- 4. Mesures de sécurité --------------------------------------------------
  console.log('4. Mesures de sécurité');
  const tok = async () => csrf((await req(jar, 'GET', '/cyber/' + sid)).texte);
  r = await req(jar, 'POST', `/cyber/${sid}/mesure`, { form: { _csrf: await tok() } });
  test('mesure sans type → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/cyber/${sid}/mesure`, {
    form: { _csrf: await tok(), type_mesure: 'inexistant' },
  });
  test('type de mesure invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/cyber/${sid}/mesure`, {
    form: { _csrf: await tok(), type_mesure: 'mfa', statut: 'inexistant' },
  });
  test('statut de mesure invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/cyber/${sid}/mesure`, {
    form: {
      _csrf: await tok(), type_mesure: 'mfa', statut: 'en_place',
      details: 'MFA sur tous les accès administrateur', notes: 'Test',
    },
  });
  test('ajout mesure 1 → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/cyber/${sid}/mesure`, {
    form: { _csrf: await tok(), type_mesure: 'sauvegardes', statut: 'partiel', details: 'Sauvegardes quotidiennes hors site' },
  });
  test('ajout mesure 2 → 302', r.statut === 302, r.statut);
  const mesures = bd.prepare('SELECT id FROM cyber_mesures WHERE soumission_id = ? AND archive = 0 ORDER BY id').all(sid);
  test('2 mesures en base', mesures.length === 2, mesures.length);
  const mid = mesures[0].id;
  test('version créée après les ajouts', nbVersions(sid) === 3, nbVersions(sid));
  r = await req(jar, 'GET', '/cyber/' + sid);
  test('mesures visibles sur la fiche', r.texte.includes('authentification multifacteur') && r.texte.includes('Sauvegardes'));
  test('maturité affichée', r.texte.includes('En place'));
  // modification
  r = await req(jar, 'POST', `/cyber/mesure/${mid}`, {
    form: { _csrf: await tok(), type_mesure: 'mfa', statut: 'partiel', details: 'MFA déployée à 60 %' },
  });
  test('modification mesure → 302', r.statut === 302, r.statut);
  test('statut modifié en base', bd.prepare('SELECT statut FROM cyber_mesures WHERE id = ?').get(mid).statut === 'partiel');
  test('version créée après modification', nbVersions(sid) === 4, nbVersions(sid));
  // archivage / désarchivage
  r = await req(jar, 'POST', `/cyber/mesure/${mid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage mesure → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/cyber/' + sid);
  test('mesure archivée hors de la liste active', r.texte.includes('Archivées'));
  r = await req(jar, 'POST', `/cyber/mesure/${mid}/desarchiver`, { form: { _csrf: await tok() } });
  test('désarchivage mesure → 302', r.statut === 302, r.statut);
  test('mesure restaurée', bd.prepare('SELECT archive FROM cyber_mesures WHERE id = ?').get(mid).archive === 0);

  // ---- 5. Garanties ------------------------------------------------------------------
  console.log('5. Garanties');
  const vAvant = nbVersions(sid);
  r = await req(jar, 'POST', `/cyber/${sid}/garanties`, {
    form: {
      _csrf: await tok(), limite_par_sinistre: '1000000', limite_agregat: '1000000',
      franchise: '5000', delai_carence: '8 heures',
      avenants: ['rancongiciel', 'fraude_transfert', 'donnees_vie_privee', 'interruption'],
      prime: '3200',
    },
  });
  test('garanties → 302', r.statut === 302, r.statut);
  const g = bd.prepare('SELECT * FROM cyber_garanties WHERE soumission_id = ?').get(sid);
  test('garanties en base', !!g && Number(g.limite_par_sinistre) === 1000000);
  test('délai de carence stocké', g.delai_carence === '8 heures');
  test('avenants stockés', ['rancongiciel', 'fraude_transfert', 'donnees_vie_privee', 'interruption']
    .every((c) => JSON.parse(g.avenants)[c] === 1));
  test('version créée après garanties', nbVersions(sid) === vAvant + 1);
  r = await req(jar, 'GET', '/cyber/' + sid);
  test('garanties affichées sur la fiche', r.texte.includes('Rançongiciel') && r.texte.includes('8 heures'));
  // modification (mise à jour, pas doublon)
  r = await req(jar, 'POST', `/cyber/${sid}/garanties`, {
    form: { _csrf: await tok(), limite_par_sinistre: '2000000', delai_carence: '12 heures' },
  });
  test('modification garanties → 302', r.statut === 302, r.statut);
  test('pas de doublon garanties', bd.prepare('SELECT COUNT(*) AS n FROM cyber_garanties WHERE soumission_id = ?').get(sid).n === 1);
  test('limite mise à jour', Number(bd.prepare('SELECT limite_par_sinistre FROM cyber_garanties WHERE soumission_id = ?').get(sid).limite_par_sinistre) === 2000000);

  // ---- 6. Antécédents --------------------------------------------------------------------
  console.log('6. Antécédents');
  r = await req(jar, 'POST', `/cyber/${sid}/antecedents`, {
    form: {
      _csrf: await tok(), assureur_actuel: 'Assureur Test Cyber', numero_police_actuelle: 'CYB-123',
      date_expiration_actuelle: '2026-11-01', annees_assurance_continue: '3',
      incidents_json: JSON.stringify([{ date: '2024-05-20', type: 'Rançongiciel', montant: '25000', reclame: 'non' }]),
      consentement_credit: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);
  const a = bd.prepare('SELECT * FROM cyber_antecedents WHERE soumission_id = ?').get(sid);
  test('antécédents en base', !!a && a.assureur_actuel === 'Assureur Test Cyber');
  test('incident stocké', JSON.parse(a.incidents_5ans)[0].type === 'Rançongiciel');
  test('réclamé stocké', JSON.parse(a.incidents_5ans)[0].reclame === 'non');
  test('consentement stocké', JSON.parse(a.consentements).credit === 1);
  r = await req(jar, 'GET', '/cyber/' + sid);
  test('antécédents affichés', r.texte.includes('Assureur Test Cyber'));

  // ---- 7. Statuts, versions, 404 ------------------------------------------------------------
  console.log('7. Statuts, versions, 404');
  r = await req(jar, 'POST', `/cyber/${sid}/statut`, { form: { _csrf: await tok(), statut: 'invalide' } });
  test('statut invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/cyber/${sid}/statut`, { form: { _csrf: await tok(), statut: 'soumise' } });
  test('statut soumise → 302', r.statut === 302, r.statut);
  test('statut en base', bd.prepare('SELECT statut FROM cyber_soumissions WHERE id = ?').get(sid).statut === 'soumise');
  r = await req(jar, 'GET', `/cyber/${sid}/versions/1`);
  test('version v1 → 200', r.statut === 200, r.statut);
  test('version lecture seule (mesures)', r.texte.includes('Mesures de sécurité'));
  const vCourante = nbVersions(sid);
  r = await req(jar, 'GET', `/cyber/${sid}/versions/${vCourante}`);
  test('dernière version montre la carence', r.texte.includes('12 heures'));
  r = await req(jar, 'GET', `/cyber/${sid}/versions/999`);
  test('version inexistante → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/cyber/999999');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 8. Archivage de la soumission ----------------------------------------------------------
  console.log('8. Archivage soumission');
  r = await req(jar, 'POST', `/cyber/${sid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage soumission → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/cyber');
  test('soumission hors de la liste active', !r.texte.includes('Client Cyber inc.'));
  r = await req(jar, 'GET', '/cyber?archives=1');
  test('soumission visible dans les archives', r.texte.includes('Client Cyber inc.'));
  r = await req(jar, 'POST', `/cyber/${sid}/desarchiver`, { form: { _csrf: csrf((await req(jar, 'GET', '/cyber/' + sid)).texte) } });
  test('désarchivage soumission → 302', r.statut === 302, r.statut);

  // ---- 9. Portefeuille courtier ---------------------------------------------------------------
  console.log('9. Portefeuille courtier');
  const lc1 = await loginComme('courtier1@t.ca', 'Test123456!');
  test('login courtier1 → 302', lc1.ok);
  r = await req(lc1.jar, 'GET', '/cyber');
  test('courtier ne voit pas la soumission hors portefeuille', !r.texte.includes('Client Cyber inc.'));
  // crée une soumission pour cli3 (son portefeuille) directement
  const sidC = bd.prepare(
    'INSERT INTO cyber_soumissions (cabinet_id, client_id) VALUES (?, ?)'
  ).run(cabA, cli3).lastInsertRowid;
  r = await req(lc1.jar, 'GET', '/cyber/' + sidC);
  test('courtier ouvre sa soumission → 200', r.statut === 200, r.statut);
  r = await req(lc1.jar, 'GET', '/cyber/' + sid);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(lc1.jar, 'POST', '/cyber', {
    form: { _csrf: csrf((await req(lc1.jar, 'GET', '/cyber/nouveau')).texte), client_id: String(cli2) },
  });
  test('création hors portefeuille → 400', r.statut === 400, r.statut);

  // ---- 10. Inter-cabinets -------------------------------------------------------------------------
  console.log('10. Inter-cabinets');
  const lb = await loginComme('adminb@t.ca', 'Test123456!');
  test('login adminB → 302', lb.ok);
  r = await req(lb.jar, 'GET', '/cyber/' + sid);
  test('cabinet B ne voit pas → 404', r.statut === 404, r.statut);

  // ---- 11. Non connecté + CSRF -----------------------------------------------------------------------
  console.log('11. Auth et CSRF');
  const jarAnon = nouveauJar();
  r = await req(jarAnon, 'GET', '/cyber');
  test('non connecté → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', '/cyber', { form: { client_id: String(cli1) } });
  test('POST sans CSRF → 403', r.statut === 403, r.statut);

  // ---- 12. Audit ---------------------------------------------------------------------------------------
  console.log('12. Audit');
  const n = bd.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action LIKE 'cyber_%'").get().n;
  test('journal d’audit alimenté', n >= 10, n);

  console.log(`\n== ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE :', e); process.exit(1); });
