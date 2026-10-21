/**
 * scripts/test-rc-etape2.js — UI questionnaire RC commerciale (étape 2/10 RC) :
 * onglet RC, création soumission, lieux d'exploitation illimités,
 * garanties par lieu, antécédents, versions, statuts, archivage, CSRF,
 * cloisonnement inter-cabinets, portefeuille courtier, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-rc-etape2.js
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
  return bd.prepare('SELECT COUNT(*) AS n FROM rc_soumission_versions WHERE soumission_id = ?').get(sid).n;
}

(async () => {
  console.log('== Tests RC étape 2 (UI) :', BASE);

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
  ).run(cabA, 'Client RC inc.', 'Jean', 'RC').lastInsertRowid;
  const cli2 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Autre RC inc.', 'Marie', 'Autre', courtier2).lastInsertRowid;
  const cli3 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Courtier RC inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
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
  r = await req(jar, 'GET', '/rc');
  test('GET /rc → 200', r.statut === 200, r.statut);
  test('onglet RC dans la navigation', /href="\/rc">RC</.test(r.texte));
  test('colonne Lieux d’exploitation', r.texte.includes('Lieux d’exploitation'));
  r = await req(jar, 'GET', '/rc/nouveau');
  test('GET /rc/nouveau → 200', r.statut === 200, r.statut);
  test('formulaire propose les entreprises', r.texte.includes('Client RC inc.'));
  r = await req(jar, 'POST', '/rc', { form: { _csrf: csrf((await req(jar, 'GET', '/rc/nouveau')).texte) } });
  test('création sans client → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/rc', { form: { _csrf: csrf((await req(jar, 'GET', '/rc/nouveau')).texte), client_id: '99999' } });
  test('création client invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/rc', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/rc/nouveau')).texte),
      client_id: String(cli1), date_effet_souhaitee: '2026-12-01', notes: 'Test UI RC',
    },
  });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche', r.location === '/rc/' + sid && sid > 0, r.location);
  test('v1 créée', nbVersions(sid) === 1, nbVersions(sid));

  // ---- 3. Fiche : sections ----------------------------------------------------
  console.log('3. Fiche soumission');
  r = await req(jar, 'GET', '/rc/' + sid);
  test('fiche → 200', r.statut === 200, r.statut);
  for (const s of ['Lieux d’exploitation', 'Garanties par lieu', 'Antécédents', 'Historique des versions']) {
    test('section « ' + s + ' » présente', r.texte.includes(s));
  }

  // ---- 4. Lieux d'exploitation --------------------------------------------------
  console.log('4. Lieux d’exploitation');
  const tok = async () => csrf((await req(jar, 'GET', '/rc/' + sid)).texte);
  r = await req(jar, 'POST', `/rc/${sid}/exploitation`, { form: { _csrf: await tok() } });
  test('lieu sans adresse → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/rc/${sid}/exploitation`, {
    form: { _csrf: await tok(), adresse: '123 rue des Entrepreneurs', sous_traitants: 'inexistant' },
  });
  test('sous-traitants invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/rc/${sid}/exploitation`, {
    form: {
      _csrf: await tok(), adresse: '123 rue des Entrepreneurs', ville: 'Montréal', code_postal: 'H2X 1Y1',
      type_activite: 'Rénovation résidentielle', code_classification: 'C-441',
      description_activites: 'Rénovation de cuisine et salle de bain', chiffre_affaires: '850000',
      masse_salariale: '320000', nb_employes: '8', superficie_pi2: '2500',
      sous_traitants: 'assures', notes: 'Test',
    },
  });
  test('ajout lieu 1 → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/rc/${sid}/exploitation`, {
    form: {
      _csrf: await tok(), adresse: '456 boulevard Industriel', ville: 'Laval',
      type_activite: 'Entrepôt de matériaux', chiffre_affaires: '400000',
      nb_employes: '3', sous_traitants: 'aucun',
    },
  });
  test('ajout lieu 2 → 302', r.statut === 302, r.statut);
  const lieux = bd.prepare('SELECT id FROM rc_exploitations WHERE soumission_id = ? AND archive = 0 ORDER BY id').all(sid);
  test('2 lieux en base', lieux.length === 2, lieux.length);
  const eid = lieux[0].id;
  test('version créée après les ajouts', nbVersions(sid) === 3, nbVersions(sid));
  r = await req(jar, 'GET', '/rc/' + sid);
  test('lieux visibles sur la fiche', r.texte.includes('123 rue des Entrepreneurs') && r.texte.includes('456 boulevard Industriel'));
  test('sous-traitants affichés', r.texte.includes('Assurés'));
  // modification
  r = await req(jar, 'POST', `/rc/exploitation/${eid}`, {
    form: { _csrf: await tok(), adresse: '123 rue des Entrepreneurs', ville: 'Longueuil', nb_employes: '9' },
  });
  test('modification lieu → 302', r.statut === 302, r.statut);
  test('ville modifiée en base', bd.prepare('SELECT ville FROM rc_exploitations WHERE id = ?').get(eid).ville === 'Longueuil');
  test('version créée après modification', nbVersions(sid) === 4, nbVersions(sid));
  // archivage / désarchivage
  r = await req(jar, 'POST', `/rc/exploitation/${eid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage lieu → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/rc/' + sid);
  test('lieu archivé hors de la liste active', !r.texte.includes('123 rue des Entrepreneurs') || r.texte.includes('Archivés'));
  r = await req(jar, 'POST', `/rc/exploitation/${eid}/desarchiver`, { form: { _csrf: await tok() } });
  test('désarchivage lieu → 302', r.statut === 302, r.statut);
  test('lieu restauré', bd.prepare('SELECT archive FROM rc_exploitations WHERE id = ?').get(eid).archive === 0);

  // ---- 5. Garanties ------------------------------------------------------------------
  console.log('5. Garanties');
  r = await req(jar, 'POST', `/rc/${sid}/exploitation/${eid}/garanties`, {
    form: { _csrf: await tok(), formule: 'mauvaise' },
  });
  test('formule invalide → 400', r.statut === 400, r.statut);
  const vAvant = nbVersions(sid);
  r = await req(jar, 'POST', `/rc/${sid}/exploitation/${eid}/garanties`, {
    form: {
      _csrf: await tok(), formule: 'globale', limite_par_sinistre: '2000000', limite_agregat: '4000000',
      franchise: '1000', avenants: ['pollution', 'parapluie'], prime: '7800',
    },
  });
  test('garanties → 302', r.statut === 302, r.statut);
  const g = bd.prepare('SELECT * FROM rc_garanties WHERE exploitation_id = ?').get(eid);
  test('garanties en base', !!g && g.formule === 'globale');
  test('limites stockées', Number(g.limite_par_sinistre) === 2000000 && Number(g.limite_agregat) === 4000000);
  test('avenants stockés', JSON.parse(g.avenants).pollution === 1 && JSON.parse(g.avenants).parapluie === 1);
  test('version créée après garanties', nbVersions(sid) === vAvant + 1);
  r = await req(jar, 'GET', '/rc/' + sid);
  test('garanties affichées sur la fiche', r.texte.includes('Globale'));
  // modification (mise à jour, pas doublon)
  r = await req(jar, 'POST', `/rc/${sid}/exploitation/${eid}/garanties`, {
    form: { _csrf: await tok(), formule: 'locaux_operations', limite_par_sinistre: '1000000' },
  });
  test('modification garanties → 302', r.statut === 302, r.statut);
  test('pas de doublon garanties', bd.prepare('SELECT COUNT(*) AS n FROM rc_garanties WHERE exploitation_id = ?').get(eid).n === 1);
  test('formule mise à jour', bd.prepare('SELECT formule FROM rc_garanties WHERE exploitation_id = ?').get(eid).formule === 'locaux_operations');

  // ---- 6. Antécédents --------------------------------------------------------------------
  console.log('6. Antécédents');
  r = await req(jar, 'POST', `/rc/${sid}/antecedents`, {
    form: {
      _csrf: await tok(), assureur_actuel: 'Assureur Test RC', numero_police_actuelle: 'CGL-123',
      date_expiration_actuelle: '2026-11-01', annees_assurance_continue: '6',
      sinistres_json: JSON.stringify([{ date: '2024-03-10', type: 'Blessure corporelle', montant: '15000' }]),
      consentement_credit: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);
  const a = bd.prepare('SELECT * FROM rc_antecedents WHERE soumission_id = ?').get(sid);
  test('antécédents en base', !!a && a.assureur_actuel === 'Assureur Test RC');
  test('sinistre stocké', JSON.parse(a.sinistres_5ans)[0].type === 'Blessure corporelle');
  test('consentement stocké', JSON.parse(a.consentements).credit === 1);
  r = await req(jar, 'GET', '/rc/' + sid);
  test('antécédents affichés', r.texte.includes('Assureur Test RC'));

  // ---- 7. Statuts, versions, 404 ------------------------------------------------------------
  console.log('7. Statuts, versions, 404');
  r = await req(jar, 'POST', `/rc/${sid}/statut`, { form: { _csrf: await tok(), statut: 'invalide' } });
  test('statut invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/rc/${sid}/statut`, { form: { _csrf: await tok(), statut: 'soumise' } });
  test('statut soumise → 302', r.statut === 302, r.statut);
  test('statut en base', bd.prepare('SELECT statut FROM rc_soumissions WHERE id = ?').get(sid).statut === 'soumise');
  r = await req(jar, 'GET', `/rc/${sid}/versions/1`);
  test('version v1 → 200', r.statut === 200, r.statut);
  test('version lecture seule (lieux)', r.texte.includes('Lieux d’exploitation'));
  const vCourante = nbVersions(sid);
  r = await req(jar, 'GET', `/rc/${sid}/versions/${vCourante}`);
  test('dernière version montre les garanties', r.texte.includes('Locaux et opérations'));
  r = await req(jar, 'GET', `/rc/${sid}/versions/999`);
  test('version inexistante → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/rc/999999');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 8. Archivage de la soumission ----------------------------------------------------------
  console.log('8. Archivage soumission');
  r = await req(jar, 'POST', `/rc/${sid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage soumission → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/rc');
  test('soumission hors de la liste active', !r.texte.includes('Client RC inc.'));
  r = await req(jar, 'GET', '/rc?archives=1');
  test('soumission visible dans les archives', r.texte.includes('Client RC inc.'));
  r = await req(jar, 'POST', `/rc/${sid}/desarchiver`, { form: { _csrf: csrf((await req(jar, 'GET', '/rc/' + sid)).texte) } });
  test('désarchivage soumission → 302', r.statut === 302, r.statut);

  // ---- 9. Portefeuille courtier ---------------------------------------------------------------
  console.log('9. Portefeuille courtier');
  const lc1 = await loginComme('courtier1@t.ca', 'Test123456!');
  test('login courtier1 → 302', lc1.ok);
  r = await req(lc1.jar, 'GET', '/rc');
  test('courtier ne voit pas la soumission hors portefeuille', !r.texte.includes('Client RC inc.'));
  // crée une soumission pour cli3 (son portefeuille) directement
  const sidC = bd.prepare(
    'INSERT INTO rc_soumissions (cabinet_id, client_id) VALUES (?, ?)'
  ).run(cabA, cli3).lastInsertRowid;
  r = await req(lc1.jar, 'GET', '/rc/' + sidC);
  test('courtier ouvre sa soumission → 200', r.statut === 200, r.statut);
  r = await req(lc1.jar, 'GET', '/rc/' + sid);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(lc1.jar, 'POST', '/rc', {
    form: { _csrf: csrf((await req(lc1.jar, 'GET', '/rc/nouveau')).texte), client_id: String(cli2) },
  });
  test('création hors portefeuille → 400', r.statut === 400, r.statut);

  // ---- 10. Inter-cabinets -------------------------------------------------------------------------
  console.log('10. Inter-cabinets');
  const lb = await loginComme('adminb@t.ca', 'Test123456!');
  test('login adminB → 302', lb.ok);
  r = await req(lb.jar, 'GET', '/rc/' + sid);
  test('cabinet B ne voit pas → 404', r.statut === 404, r.statut);

  // ---- 11. Non connecté + CSRF -----------------------------------------------------------------------
  console.log('11. Auth et CSRF');
  const jarAnon = nouveauJar();
  r = await req(jarAnon, 'GET', '/rc');
  test('non connecté → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', '/rc', { form: { client_id: String(cli1) } });
  test('POST sans CSRF → 403', r.statut === 403, r.statut);

  // ---- 12. Audit ---------------------------------------------------------------------------------------
  console.log('12. Audit');
  const n = bd.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action LIKE 'rc_%'").get().n;
  test('journal d’audit alimenté', n >= 10, n);

  console.log(`\n== ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE :', e); process.exit(1); });
