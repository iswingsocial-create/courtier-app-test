/**
 * scripts/test-do-etape2.js — UI questionnaire D&O / responsabilité des administrateurs et dirigeants
 * (étape 2/10 D&O) : onglet D&O, création soumission, dirigeants
 * illimités, garanties par soumission (base claims-made / occurrences),
 * antécédents (réclamations D&O 5 ans, poursuites ou actions en justice
 * en cours/envisagées), versions, statuts, archivage, CSRF,
 * cloisonnement inter-cabinets, portefeuille courtier, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : CHEMIN_BD=/tmp/test-do2.db PORT=3101 node scripts/test-do-etape2.js
 * (CHEMIN_BD doit être le même sur le serveur et le script.)
 * Miroir de scripts/test-eo-etape2.js.
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
  return bd.prepare('SELECT COUNT(*) AS n FROM do_soumission_versions WHERE soumission_id = ?').get(sid).n;
}

(async () => {
  console.log('== Tests D&O étape 2 (UI) :', BASE);

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
  ).run(cabA, 'Client DO inc.', 'Jean', 'DO').lastInsertRowid;
  const cli2 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Autre DO inc.', 'Marie', 'Autre', courtier2).lastInsertRowid;
  const cli3 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Courtier DO inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
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
  r = await req(jar, 'GET', '/do');
  test('GET /do → 200', r.statut === 200, r.statut);
  test('onglet D&O dans la navigation', /href="\/do">D&O</.test(r.texte));
  test('colonne Dirigeants', r.texte.includes('Dirigeants'));
  test('seed D&O visible (Forges Bélanger)', r.texte.includes('Forges Bélanger'));
  r = await req(jar, 'GET', '/do/nouveau');
  test('GET /do/nouveau → 200', r.statut === 200, r.statut);
  test('formulaire propose les entreprises', r.texte.includes('Client DO inc.'));
  r = await req(jar, 'POST', '/do', { form: { _csrf: csrf((await req(jar, 'GET', '/do/nouveau')).texte) } });
  test('création sans client → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/do', { form: { _csrf: csrf((await req(jar, 'GET', '/do/nouveau')).texte), client_id: '99999' } });
  test('création client invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/do', { form: { _csrf: csrf((await req(jar, 'GET', '/do/nouveau')).texte), client_id: String(cli1), date_effet_souhaitee: 'pas-une-date' } });
  test('création date invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/do', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/do/nouveau')).texte),
      client_id: String(cli1), date_effet_souhaitee: '2026-12-01', notes: 'Test UI D&O',
    },
  });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche', r.location === '/do/' + sid && sid > 0, r.location);
  test('v1 créée', nbVersions(sid) === 1, nbVersions(sid));

  // ---- 3. Fiche : sections ----------------------------------------------------
  console.log('3. Fiche soumission');
  r = await req(jar, 'GET', '/do/' + sid);
  test('fiche → 200', r.statut === 200, r.statut);
  for (const s of ['Dirigeants', 'Garanties', 'Antécédents', 'Historique des versions']) {
    test('section « ' + s + ' » présente', r.texte.includes(s));
  }
  test('bouton Proposition actif (étape 7)', r.texte.includes('/proposition">📄 Proposition</a>') && !r.texte.includes('Proposition (bientôt)'));
  test('bouton de conversion présent (étape 3)', r.texte.includes('Convertir en police'));
  test('route de conversion câblée (étape 3)', r.texte.includes('/lier-police') || r.texte.includes('/convertir'));

  // ---- 4. Dirigeants ------------------------------------------------------------
  console.log('4. Dirigeants');
  const tok = async () => csrf((await req(jar, 'GET', '/do/' + sid)).texte);
  r = await req(jar, 'POST', `/do/${sid}/dirigeant`, { form: { _csrf: await tok() } });
  test('dirigeant sans nom → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/do/${sid}/dirigeant`, {
    form: { _csrf: await tok(), nom: 'Marie Tremblay', fonction: 'Présidente', annees_experience: '18' },
  });
  test('ajout dirigeant 1 → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/do/${sid}/dirigeant`, {
    form: { _csrf: await tok(), nom: 'Pierre Lavoie', fonction: 'Trésorier', annees_experience: '12', antecedents_personnels: 'Aucune réclamation ou poursuite personnelle.' },
  });
  test('ajout dirigeant 2 → 302', r.statut === 302, r.statut);
  const dirigeants = bd.prepare('SELECT id FROM do_dirigeants WHERE soumission_id = ? AND archive = 0 ORDER BY id').all(sid);
  test('2 dirigeants en base', dirigeants.length === 2, dirigeants.length);
  const did = dirigeants[0].id;
  test('versions créées après les ajouts', nbVersions(sid) === 3, nbVersions(sid));
  r = await req(jar, 'GET', '/do/' + sid);
  test('dirigeants visibles sur la fiche', r.texte.includes('Marie Tremblay') && r.texte.includes('Pierre Lavoie'));
  test('fonction affichée', r.texte.includes('Présidente'));
  // années d'expérience invalides
  r = await req(jar, 'POST', `/do/${sid}/dirigeant`, {
    form: { _csrf: await tok(), nom: 'Mauvais', annees_experience: '-5' },
  });
  test('expérience négative → 400', r.statut === 400, r.statut);
  // modification
  r = await req(jar, 'POST', `/do/dirigeant/${did}`, {
    form: { _csrf: await tok(), nom: 'Marie Tremblay', fonction: 'Présidente-directrice générale', annees_experience: '20' },
  });
  test('modification dirigeant → 302', r.statut === 302, r.statut);
  test('expérience modifiée en base', Number(bd.prepare('SELECT annees_experience FROM do_dirigeants WHERE id = ?').get(did).annees_experience) === 20);
  test('version créée après modification', nbVersions(sid) === 4, nbVersions(sid));
  // dirigeant inexistant
  r = await req(jar, 'POST', '/do/dirigeant/999999', {
    form: { _csrf: await tok(), nom: 'X' },
  });
  test('modification dirigeant inexistant → 404', r.statut === 404, r.statut);
  // archivage / désarchivage
  r = await req(jar, 'POST', `/do/dirigeant/${did}/archiver`, { form: { _csrf: await tok() } });
  test('archivage dirigeant → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/do/' + sid);
  test('dirigeant archivé hors de la liste active', r.texte.includes('Archivés'));
  r = await req(jar, 'POST', `/do/dirigeant/${did}/desarchiver`, { form: { _csrf: await tok() } });
  test('désarchivage dirigeant → 302', r.statut === 302, r.statut);
  test('dirigeant restauré', bd.prepare('SELECT archive FROM do_dirigeants WHERE id = ?').get(did).archive === 0);

  // ---- 5. Garanties ------------------------------------------------------------------
  console.log('5. Garanties');
  const vAvant = nbVersions(sid);
  r = await req(jar, 'POST', `/do/${sid}/garanties`, {
    form: {
      _csrf: await tok(), limite_par_sinistre: '2000000', limite_agregat: '2000000',
      franchise: '25000', base: 'reclamations_presentees',
      avenants: ['frais_defense', 'pratiques_emploi'], prime: '4500',
    },
  });
  test('garanties → 302', r.statut === 302, r.statut);
  const g = bd.prepare('SELECT * FROM do_garanties WHERE soumission_id = ?').get(sid);
  test('garanties en base', !!g && Number(g.limite_par_sinistre) === 2000000);
  test('base claims-made stockée', g.base === 'reclamations_presentees');
  test('avenants stockés', JSON.parse(g.avenants).frais_defense === 1 && JSON.parse(g.avenants).pratiques_emploi === 1);
  test('version créée après garanties', nbVersions(sid) === vAvant + 1);
  r = await req(jar, 'GET', '/do/' + sid);
  test('garanties affichées sur la fiche', r.texte.includes('Frais de défense') && r.texte.includes('claims-made'));
  // base invalide
  r = await req(jar, 'POST', `/do/${sid}/garanties`, {
    form: { _csrf: await tok(), base: 'inexistante' },
  });
  test('base invalide → 400', r.statut === 400, r.statut);
  // modification (mise à jour, pas doublon)
  r = await req(jar, 'POST', `/do/${sid}/garanties`, {
    form: { _csrf: await tok(), limite_par_sinistre: '3000000', base: 'occurrences' },
  });
  test('modification garanties → 302', r.statut === 302, r.statut);
  test('pas de doublon garanties', bd.prepare('SELECT COUNT(*) AS n FROM do_garanties WHERE soumission_id = ?').get(sid).n === 1);
  test('limite mise à jour', Number(bd.prepare('SELECT limite_par_sinistre FROM do_garanties WHERE soumission_id = ?').get(sid).limite_par_sinistre) === 3000000);
  test('base mise à jour', bd.prepare('SELECT base FROM do_garanties WHERE soumission_id = ?').get(sid).base === 'occurrences');

  // ---- 6. Antécédents --------------------------------------------------------------------
  console.log('6. Antécédents');
  r = await req(jar, 'POST', `/do/${sid}/antecedents`, {
    form: {
      _csrf: await tok(), assureur_actuel: 'Assureur Test DO', numero_police_actuelle: 'DO-123',
      date_expiration_actuelle: '2026-11-01', annees_assurance_continue: '5',
      reclamations_json: JSON.stringify([{ date: '2022-08-30', nature: 'Poursuite d’un actionnaire minoritaire', montant: '120000', sinistre: 'oui' }]),
      poursuites_en_cours: 'Une action en justice est envisagée par un ancien dirigeant.',
      consentement_credit: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);
  const a = bd.prepare('SELECT * FROM do_antecedents WHERE soumission_id = ?').get(sid);
  test('antécédents en base', !!a && a.assureur_actuel === 'Assureur Test DO');
  test('réclamation stockée', JSON.parse(a.reclamations_5ans)[0].nature === 'Poursuite d’un actionnaire minoritaire');
  test('sinistre stocké', JSON.parse(a.reclamations_5ans)[0].sinistre === 'oui');
  test('poursuites stockées', a.poursuites_en_cours === 'Une action en justice est envisagée par un ancien dirigeant.');
  test('consentement stocké', JSON.parse(a.consentements).credit === 1);
  r = await req(jar, 'GET', '/do/' + sid);
  test('antécédents affichés', r.texte.includes('Assureur Test DO') && r.texte.includes('ancien dirigeant'));

  // ---- 7. Statuts, versions, 404 ------------------------------------------------------------
  console.log('7. Statuts, versions, 404');
  r = await req(jar, 'POST', `/do/${sid}/statut`, { form: { _csrf: await tok(), statut: 'invalide' } });
  test('statut invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/do/${sid}/statut`, { form: { _csrf: await tok(), statut: 'soumise' } });
  test('statut soumise → 302', r.statut === 302, r.statut);
  test('statut en base', bd.prepare('SELECT statut FROM do_soumissions WHERE id = ?').get(sid).statut === 'soumise');
  r = await req(jar, 'GET', `/do/${sid}/versions/1`);
  test('version v1 → 200', r.statut === 200, r.statut);
  test('version lecture seule (dirigeants)', r.texte.includes('Dirigeants'));
  const vCourante = nbVersions(sid);
  r = await req(jar, 'GET', `/do/${sid}/versions/${vCourante}`);
  test('dernière version montre la base occurrences', r.texte.includes('Occurrences'));
  test('dernière version montre les poursuites', r.texte.includes('ancien dirigeant'));
  r = await req(jar, 'GET', `/do/${sid}/versions/999`);
  test('version inexistante → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/do/999999');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 8. Archivage de la soumission ----------------------------------------------------------
  console.log('8. Archivage soumission');
  r = await req(jar, 'POST', `/do/${sid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage soumission → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/do');
  test('soumission hors de la liste active', !r.texte.includes('Client DO inc.'));
  r = await req(jar, 'GET', '/do?archives=1');
  test('soumission visible dans les archives', r.texte.includes('Client DO inc.'));
  r = await req(jar, 'POST', `/do/${sid}/desarchiver`, { form: { _csrf: csrf((await req(jar, 'GET', '/do/' + sid)).texte) } });
  test('désarchivage soumission → 302', r.statut === 302, r.statut);

  // ---- 9. Portefeuille courtier ---------------------------------------------------------------
  console.log('9. Portefeuille courtier');
  const lc1 = await loginComme('courtier1@t.ca', 'Test123456!');
  test('login courtier1 → 302', lc1.ok);
  r = await req(lc1.jar, 'GET', '/do');
  test('courtier ne voit pas la soumission hors portefeuille', !r.texte.includes('Client DO inc.'));
  // crée une soumission pour cli3 (son portefeuille) directement
  const sidC = bd.prepare(
    'INSERT INTO do_soumissions (cabinet_id, client_id) VALUES (?, ?)'
  ).run(cabA, cli3).lastInsertRowid;
  r = await req(lc1.jar, 'GET', '/do/' + sidC);
  test('courtier ouvre sa soumission → 200', r.statut === 200, r.statut);
  r = await req(lc1.jar, 'GET', '/do/' + sid);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(lc1.jar, 'POST', '/do', {
    form: { _csrf: csrf((await req(lc1.jar, 'GET', '/do/nouveau')).texte), client_id: String(cli2) },
  });
  test('création hors portefeuille → 400', r.statut === 400, r.statut);
  r = await req(lc1.jar, 'POST', `/do/dirigeant/${did}`, {
    form: { _csrf: csrf((await req(lc1.jar, 'GET', '/do/' + sidC)).texte), nom: 'X' },
  });
  test('mutation dirigeant hors portefeuille → 403', r.statut === 403, r.statut);

  // ---- 10. Inter-cabinets -------------------------------------------------------------------------
  console.log('10. Inter-cabinets');
  const lb = await loginComme('adminb@t.ca', 'Test123456!');
  test('login adminB → 302', lb.ok);
  r = await req(lb.jar, 'GET', '/do/' + sid);
  test('cabinet B ne voit pas → 404', r.statut === 404, r.statut);

  // ---- 11. Non connecté + CSRF -----------------------------------------------------------------------
  console.log('11. Auth et CSRF');
  const jarAnon = nouveauJar();
  r = await req(jarAnon, 'GET', '/do');
  test('non connecté → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', '/do', { form: { client_id: String(cli1) } });
  test('POST sans CSRF → 403', r.statut === 403, r.statut);

  // ---- 12. Audit + règle d'or ----------------------------------------------------------------------------
  console.log('12. Audit et règle d’or');
  const n = bd.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action LIKE 'do_%'").get().n;
  test('journal d’audit alimenté', n >= 10, n);
  const fs = require('fs');
  const codeRoutes = fs.readFileSync(__dirname + '/../routes/do.js', 'utf8');
  const codeLib = fs.readFileSync(__dirname + '/../lib/do.js', 'utf8');
  test('aucun DELETE en dur (routes)', !/DELETE\s+FROM\s+do_/i.test(codeRoutes));
  test('aucun DELETE en dur (lib)', !/DELETE\s+FROM\s+do_/i.test(codeLib));

  console.log(`\n== ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE :', e); process.exit(1); });
