/**
 * scripts/test-eo-etape2.js — UI questionnaire E&O / responsabilité professionnelle
 * (étape 2/10 E&O) : onglet E&O, création soumission, activités professionnelles
 * illimitées, garanties par soumission (base claims-made / occurrences),
 * antécédents (réclamations E&O 5 ans, circonstances), versions, statuts,
 * archivage, CSRF, cloisonnement inter-cabinets, portefeuille courtier, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : CHEMIN_BD=/tmp/test-eo2.db PORT=3101 node scripts/test-eo-etape2.js
 * (CHEMIN_BD doit être le même sur le serveur et le script.)
 * Miroir de scripts/test-cyber-etape2.js.
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
  return bd.prepare('SELECT COUNT(*) AS n FROM eo_soumission_versions WHERE soumission_id = ?').get(sid).n;
}

(async () => {
  console.log('== Tests E&O étape 2 (UI) :', BASE);

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
  ).run(cabA, 'Client EO inc.', 'Jean', 'EO').lastInsertRowid;
  const cli2 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Autre EO inc.', 'Marie', 'Autre', courtier2).lastInsertRowid;
  const cli3 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Courtier EO inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
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
  r = await req(jar, 'GET', '/eo');
  test('GET /eo → 200', r.statut === 200, r.statut);
  test('onglet E&O dans la navigation', /href="\/eo">E&O</.test(r.texte));
  test('colonne Activités professionnelles', r.texte.includes('Activités professionnelles'));
  test('seed E&O visible (Lussier)', r.texte.includes('Lussier'));
  r = await req(jar, 'GET', '/eo/nouveau');
  test('GET /eo/nouveau → 200', r.statut === 200, r.statut);
  test('formulaire propose les entreprises', r.texte.includes('Client EO inc.'));
  r = await req(jar, 'POST', '/eo', { form: { _csrf: csrf((await req(jar, 'GET', '/eo/nouveau')).texte) } });
  test('création sans client → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/eo', { form: { _csrf: csrf((await req(jar, 'GET', '/eo/nouveau')).texte), client_id: '99999' } });
  test('création client invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/eo', { form: { _csrf: csrf((await req(jar, 'GET', '/eo/nouveau')).texte), client_id: String(cli1), date_effet_souhaitee: 'pas-une-date' } });
  test('création date invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/eo', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/eo/nouveau')).texte),
      client_id: String(cli1), date_effet_souhaitee: '2026-12-01', notes: 'Test UI E&O',
    },
  });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche', r.location === '/eo/' + sid && sid > 0, r.location);
  test('v1 créée', nbVersions(sid) === 1, nbVersions(sid));

  // ---- 3. Fiche : sections ----------------------------------------------------
  console.log('3. Fiche soumission');
  r = await req(jar, 'GET', '/eo/' + sid);
  test('fiche → 200', r.statut === 200, r.statut);
  for (const s of ['Activités professionnelles', 'Garanties', 'Antécédents', 'Historique des versions']) {
    test('section « ' + s + ' » présente', r.texte.includes(s));
  }
  test('bouton Proposition dégrisé (étape 7)', r.texte.includes('/eo/' + sid + '/proposition'));
  test('bouton de conversion présent (étape 3)', r.texte.includes('Convertir en police'));
  test('route de conversion câblée sur la fiche (étape 3)', r.texte.includes('/convertir'));

  // ---- 4. Activités professionnelles ------------------------------------------
  console.log('4. Activités professionnelles');
  const tok = async () => csrf((await req(jar, 'GET', '/eo/' + sid)).texte);
  r = await req(jar, 'POST', `/eo/${sid}/activite`, { form: { _csrf: await tok() } });
  test('activité sans description → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/eo/${sid}/activite`, {
    form: { _csrf: await tok(), description_activite: 'Tenue de livres et états financiers', chiffre_affaires: '450000', nb_professionnels: '4' },
  });
  test('ajout activité 1 → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/eo/${sid}/activite`, {
    form: { _csrf: await tok(), description_activite: 'Conseil fiscal', chiffre_affaires: '180000', nb_professionnels: '2', notes: 'Fiducies incluses' },
  });
  test('ajout activité 2 → 302', r.statut === 302, r.statut);
  const activites = bd.prepare('SELECT id FROM eo_activites WHERE soumission_id = ? AND archive = 0 ORDER BY id').all(sid);
  test('2 activités en base', activites.length === 2, activites.length);
  const aid = activites[0].id;
  test('versions créées après les ajouts', nbVersions(sid) === 3, nbVersions(sid));
  r = await req(jar, 'GET', '/eo/' + sid);
  test('activités visibles sur la fiche', r.texte.includes('Tenue de livres') && r.texte.includes('Conseil fiscal'));
  test('CA affiché', /450[\s\u00a0\u202f]000/.test(r.texte));
  // CA négatif
  r = await req(jar, 'POST', `/eo/${sid}/activite`, {
    form: { _csrf: await tok(), description_activite: 'Mauvaise', chiffre_affaires: '-5' },
  });
  test('CA négatif → 400', r.statut === 400, r.statut);
  // modification
  r = await req(jar, 'POST', `/eo/activite/${aid}`, {
    form: { _csrf: await tok(), description_activite: 'Tenue de livres et états financiers', chiffre_affaires: '475000', nb_professionnels: '5' },
  });
  test('modification activité → 302', r.statut === 302, r.statut);
  test('CA modifié en base', Number(bd.prepare('SELECT chiffre_affaires FROM eo_activites WHERE id = ?').get(aid).chiffre_affaires) === 475000);
  test('version créée après modification', nbVersions(sid) === 4, nbVersions(sid));
  // activité inexistante
  r = await req(jar, 'POST', '/eo/activite/999999', {
    form: { _csrf: await tok(), description_activite: 'X' },
  });
  test('modification activité inexistante → 404', r.statut === 404, r.statut);
  // archivage / désarchivage
  r = await req(jar, 'POST', `/eo/activite/${aid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage activité → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/eo/' + sid);
  test('activité archivée hors de la liste active', r.texte.includes('Archivées'));
  r = await req(jar, 'POST', `/eo/activite/${aid}/desarchiver`, { form: { _csrf: await tok() } });
  test('désarchivage activité → 302', r.statut === 302, r.statut);
  test('activité restaurée', bd.prepare('SELECT archive FROM eo_activites WHERE id = ?').get(aid).archive === 0);

  // ---- 5. Garanties ------------------------------------------------------------------
  console.log('5. Garanties');
  const vAvant = nbVersions(sid);
  r = await req(jar, 'POST', `/eo/${sid}/garanties`, {
    form: {
      _csrf: await tok(), limite_par_sinistre: '2000000', limite_agregat: '2000000',
      franchise: '10000', base: 'reclamations_presentees',
      avenants: ['frais_defense', 'medias_contenu'], prime: '4800',
    },
  });
  test('garanties → 302', r.statut === 302, r.statut);
  const g = bd.prepare('SELECT * FROM eo_garanties WHERE soumission_id = ?').get(sid);
  test('garanties en base', !!g && Number(g.limite_par_sinistre) === 2000000);
  test('base claims-made stockée', g.base === 'reclamations_presentees');
  test('avenants stockés', JSON.parse(g.avenants).frais_defense === 1 && JSON.parse(g.avenants).medias_contenu === 1);
  test('version créée après garanties', nbVersions(sid) === vAvant + 1);
  r = await req(jar, 'GET', '/eo/' + sid);
  test('garanties affichées sur la fiche', r.texte.includes('Frais de défense') && r.texte.includes('claims-made'));
  // base invalide
  r = await req(jar, 'POST', `/eo/${sid}/garanties`, {
    form: { _csrf: await tok(), base: 'inexistante' },
  });
  test('base invalide → 400', r.statut === 400, r.statut);
  // modification (mise à jour, pas doublon)
  r = await req(jar, 'POST', `/eo/${sid}/garanties`, {
    form: { _csrf: await tok(), limite_par_sinistre: '3000000', base: 'occurrences' },
  });
  test('modification garanties → 302', r.statut === 302, r.statut);
  test('pas de doublon garanties', bd.prepare('SELECT COUNT(*) AS n FROM eo_garanties WHERE soumission_id = ?').get(sid).n === 1);
  test('limite mise à jour', Number(bd.prepare('SELECT limite_par_sinistre FROM eo_garanties WHERE soumission_id = ?').get(sid).limite_par_sinistre) === 3000000);
  test('base mise à jour', bd.prepare('SELECT base FROM eo_garanties WHERE soumission_id = ?').get(sid).base === 'occurrences');

  // ---- 6. Antécédents --------------------------------------------------------------------
  console.log('6. Antécédents');
  r = await req(jar, 'POST', `/eo/${sid}/antecedents`, {
    form: {
      _csrf: await tok(), assureur_actuel: 'Assureur Test EO', numero_police_actuelle: 'EO-123',
      date_expiration_actuelle: '2026-11-01', annees_assurance_continue: '5',
      reclamations_json: JSON.stringify([{ date: '2023-04-10', nature: 'Erreur d’implantation', montant: '45000', sinistre: 'oui' }]),
      circonstances: 'Un client insatisfait menace de poursuivre.',
      consentement_credit: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);
  const a = bd.prepare('SELECT * FROM eo_antecedents WHERE soumission_id = ?').get(sid);
  test('antécédents en base', !!a && a.assureur_actuel === 'Assureur Test EO');
  test('réclamation stockée', JSON.parse(a.reclamations_5ans)[0].nature === 'Erreur d’implantation');
  test('sinistre stocké', JSON.parse(a.reclamations_5ans)[0].sinistre === 'oui');
  test('circonstances stockées', a.circonstances === 'Un client insatisfait menace de poursuivre.');
  test('consentement stocké', JSON.parse(a.consentements).credit === 1);
  r = await req(jar, 'GET', '/eo/' + sid);
  test('antécédents affichés', r.texte.includes('Assureur Test EO') && r.texte.includes('menace de poursuivre'));

  // ---- 7. Statuts, versions, 404 ------------------------------------------------------------
  console.log('7. Statuts, versions, 404');
  r = await req(jar, 'POST', `/eo/${sid}/statut`, { form: { _csrf: await tok(), statut: 'invalide' } });
  test('statut invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/eo/${sid}/statut`, { form: { _csrf: await tok(), statut: 'soumise' } });
  test('statut soumise → 302', r.statut === 302, r.statut);
  test('statut en base', bd.prepare('SELECT statut FROM eo_soumissions WHERE id = ?').get(sid).statut === 'soumise');
  r = await req(jar, 'GET', `/eo/${sid}/versions/1`);
  test('version v1 → 200', r.statut === 200, r.statut);
  test('version lecture seule (activités)', r.texte.includes('Activités professionnelles'));
  const vCourante = nbVersions(sid);
  r = await req(jar, 'GET', `/eo/${sid}/versions/${vCourante}`);
  test('dernière version montre la base occurrences', r.texte.includes('Occurrences'));
  test('dernière version montre les circonstances', r.texte.includes('menace de poursuivre'));
  r = await req(jar, 'GET', `/eo/${sid}/versions/999`);
  test('version inexistante → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/eo/999999');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 8. Archivage de la soumission ----------------------------------------------------------
  console.log('8. Archivage soumission');
  r = await req(jar, 'POST', `/eo/${sid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage soumission → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/eo');
  test('soumission hors de la liste active', !r.texte.includes('Client EO inc.'));
  r = await req(jar, 'GET', '/eo?archives=1');
  test('soumission visible dans les archives', r.texte.includes('Client EO inc.'));
  r = await req(jar, 'POST', `/eo/${sid}/desarchiver`, { form: { _csrf: csrf((await req(jar, 'GET', '/eo/' + sid)).texte) } });
  test('désarchivage soumission → 302', r.statut === 302, r.statut);

  // ---- 9. Portefeuille courtier ---------------------------------------------------------------
  console.log('9. Portefeuille courtier');
  const lc1 = await loginComme('courtier1@t.ca', 'Test123456!');
  test('login courtier1 → 302', lc1.ok);
  r = await req(lc1.jar, 'GET', '/eo');
  test('courtier ne voit pas la soumission hors portefeuille', !r.texte.includes('Client EO inc.'));
  // crée une soumission pour cli3 (son portefeuille) directement
  const sidC = bd.prepare(
    'INSERT INTO eo_soumissions (cabinet_id, client_id) VALUES (?, ?)'
  ).run(cabA, cli3).lastInsertRowid;
  r = await req(lc1.jar, 'GET', '/eo/' + sidC);
  test('courtier ouvre sa soumission → 200', r.statut === 200, r.statut);
  r = await req(lc1.jar, 'GET', '/eo/' + sid);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(lc1.jar, 'POST', '/eo', {
    form: { _csrf: csrf((await req(lc1.jar, 'GET', '/eo/nouveau')).texte), client_id: String(cli2) },
  });
  test('création hors portefeuille → 400', r.statut === 400, r.statut);
  r = await req(lc1.jar, 'POST', `/eo/activite/${aid}`, {
    form: { _csrf: csrf((await req(lc1.jar, 'GET', '/eo/' + sidC)).texte), description_activite: 'X' },
  });
  test('mutation activité hors portefeuille → 403', r.statut === 403, r.statut);

  // ---- 10. Inter-cabinets -------------------------------------------------------------------------
  console.log('10. Inter-cabinets');
  const lb = await loginComme('adminb@t.ca', 'Test123456!');
  test('login adminB → 302', lb.ok);
  r = await req(lb.jar, 'GET', '/eo/' + sid);
  test('cabinet B ne voit pas → 404', r.statut === 404, r.statut);

  // ---- 11. Non connecté + CSRF -----------------------------------------------------------------------
  console.log('11. Auth et CSRF');
  const jarAnon = nouveauJar();
  r = await req(jarAnon, 'GET', '/eo');
  test('non connecté → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', '/eo', { form: { client_id: String(cli1) } });
  test('POST sans CSRF → 403', r.statut === 403, r.statut);

  // ---- 12. Audit + règle d'or ----------------------------------------------------------------------------
  console.log('12. Audit et règle d’or');
  const n = bd.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action LIKE 'eo_%'").get().n;
  test('journal d’audit alimenté', n >= 10, n);
  const fs = require('fs');
  const codeRoutes = fs.readFileSync(__dirname + '/../routes/eo.js', 'utf8');
  const codeLib = fs.readFileSync(__dirname + '/../lib/eo.js', 'utf8');
  test('aucun DELETE en dur (routes)', !/DELETE\s+FROM\s+eo_/i.test(codeRoutes));
  test('aucun DELETE en dur (lib)', !/DELETE\s+FROM\s+eo_/i.test(codeLib));

  console.log(`\n== ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE :', e); process.exit(1); });
