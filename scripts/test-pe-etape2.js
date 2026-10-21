/**
 * scripts/test-pe-etape2.js — UI questionnaire perte d'exploitation /
 * interruption des affaires (étape 2/10 PE) : onglet Perte d'exploitation,
 * création soumission, établissements illimités, garanties (période
 * d'indemnité radio 12/18/24, franchise en jours, base d'indemnité),
 * antécédents (interruptions 5 ans via textarea), versions, statuts,
 * archivage, CSRF, cloisonnement inter-cabinets, portefeuille courtier,
 * audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : CHEMIN_BD=/tmp/test-pe2.db PORT=3101 node scripts/test-pe-etape2.js
 * (CHEMIN_BD doit être le même sur le serveur et le script.)
 * Miroir de scripts/test-do-etape2.js.
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
  return bd.prepare('SELECT COUNT(*) AS n FROM pe_soumission_versions WHERE soumission_id = ?').get(sid).n;
}

(async () => {
  console.log('== Tests PE étape 2 (UI) :', BASE);

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
  ).run(cabA, 'Client PE inc.', 'Jean', 'PE').lastInsertRowid;
  const cli2 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Autre PE inc.', 'Marie', 'Autre', courtier2).lastInsertRowid;
  const cli3 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Courtier PE inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
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
  r = await req(jar, 'GET', '/pe');
  test('GET /pe → 200', r.statut === 200, r.statut);
  test('onglet Perte d’exploitation dans la navigation', /href="\/pe">Perte d'exploitation</.test(r.texte));
  test('colonne Établissements', r.texte.includes('Établissements'));
  test('seed PE visible (Boulangerie Chaleur)', r.texte.includes('Boulangerie Chaleur'));
  r = await req(jar, 'GET', '/pe/nouveau');
  test('GET /pe/nouveau → 200', r.statut === 200, r.statut);
  test('formulaire propose les entreprises', r.texte.includes('Client PE inc.'));
  r = await req(jar, 'POST', '/pe', { form: { _csrf: csrf((await req(jar, 'GET', '/pe/nouveau')).texte) } });
  test('création sans client → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/pe', { form: { _csrf: csrf((await req(jar, 'GET', '/pe/nouveau')).texte), client_id: '99999' } });
  test('création client invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/pe', { form: { _csrf: csrf((await req(jar, 'GET', '/pe/nouveau')).texte), client_id: String(cli1), date_effet_souhaitee: 'pas-une-date' } });
  test('création date invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/pe', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/pe/nouveau')).texte),
      client_id: String(cli1), date_effet_souhaitee: '2026-12-01', notes: 'Test UI PE',
    },
  });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche', r.location === '/pe/' + sid && sid > 0, r.location);
  test('v1 créée', nbVersions(sid) === 1, nbVersions(sid));

  // ---- 3. Fiche : sections ----------------------------------------------------
  console.log('3. Fiche soumission');
  r = await req(jar, 'GET', '/pe/' + sid);
  test('fiche → 200', r.statut === 200, r.statut);
  for (const s of ['Établissements assurés', 'Garanties', 'Antécédents', 'Historique des versions']) {
    test('section « ' + s + ' » présente', r.texte.includes(s));
  }
  test('bouton Proposition dégrisé (étape 7)', r.texte.includes(`href="/pe/${sid}/proposition"`) && r.texte.includes('📄 Proposition'));
  test('base de valeur (remplacement / dépréciée) proposée', r.texte.includes('Coût de remplacement') && r.texte.includes('Valeur dépréciée'));

  // ---- 4. Établissements ------------------------------------------------------------
  console.log('4. Établissements');
  const tok = async () => csrf((await req(jar, 'GET', '/pe/' + sid)).texte);
  r = await req(jar, 'POST', `/pe/${sid}/etablissement`, { form: { _csrf: await tok() } });
  test('établissement sans nom ni adresse → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/pe/${sid}/etablissement`, {
    form: { _csrf: await tok(), nom_lieu: 'Fournil', adresse: '123 rue Sainte-Catherine E, Montréal', occupation: 'Boulangerie — fournil', chiffre_affaires: '750000', superficie: '250', annee_construction: '1965', base_valeur: 'remplacement' },
  });
  test('ajout établissement 1 → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/pe/${sid}/etablissement`, {
    form: { _csrf: await tok(), nom_lieu: 'Magasin', adresse: '4800 boul. Saint-Laurent, Montréal', occupation: 'Commerce de détail', chiffre_affaires: '450000', base_valeur: 'remplacement' },
  });
  test('ajout établissement 2 → 302', r.statut === 302, r.statut);
  const etabs = bd.prepare('SELECT id FROM pe_etablissements WHERE soumission_id = ? AND archive = 0 ORDER BY id').all(sid);
  test('2 établissements en base', etabs.length === 2, etabs.length);
  const eid = etabs[0].id;
  test('versions créées après les ajouts', nbVersions(sid) === 3, nbVersions(sid));
  r = await req(jar, 'GET', '/pe/' + sid);
  test('établissements visibles sur la fiche', r.texte.includes('Fournil') && r.texte.includes('Magasin'));
  test('occupation affichée', r.texte.includes('Boulangerie — fournil'));
  // chiffre d'affaires négatif
  r = await req(jar, 'POST', `/pe/${sid}/etablissement`, {
    form: { _csrf: await tok(), nom_lieu: 'Mauvais', chiffre_affaires: '-100' },
  });
  test('CA négatif → 400', r.statut === 400, r.statut);
  // modification
  r = await req(jar, 'POST', `/pe/etablissement/${eid}`, {
    form: { _csrf: await tok(), nom_lieu: 'Fournil', adresse: '123 rue Sainte-Catherine E, Montréal', occupation: 'Boulangerie — fournil agrandi', chiffre_affaires: '800000', superficie: '280', annee_construction: '1965', base_valeur: 'remplacement' },
  });
  test('modification établissement → 302', r.statut === 302, r.statut);
  test('CA modifié en base', Number(bd.prepare('SELECT chiffre_affaires FROM pe_etablissements WHERE id = ?').get(eid).chiffre_affaires) === 800000);
  test('version créée après modification', nbVersions(sid) === 4, nbVersions(sid));
  // établissement inexistant
  r = await req(jar, 'POST', '/pe/etablissement/999999', {
    form: { _csrf: await tok(), nom_lieu: 'X' },
  });
  test('modification établissement inexistant → 404', r.statut === 404, r.statut);
  // archivage / désarchivage
  r = await req(jar, 'POST', `/pe/etablissement/${eid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage établissement → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/pe/' + sid);
  test('établissement archivé hors de la liste active', r.texte.includes('Archivés'));
  r = await req(jar, 'POST', `/pe/etablissement/${eid}/desarchiver`, { form: { _csrf: await tok() } });
  test('désarchivage établissement → 302', r.statut === 302, r.statut);
  test('établissement restauré', bd.prepare('SELECT archive FROM pe_etablissements WHERE id = ?').get(eid).archive === 0);

  // ---- 5. Garanties ------------------------------------------------------------------
  console.log('5. Garanties');
  const vAvant = nbVersions(sid);
  r = await req(jar, 'POST', `/pe/${sid}/garanties`, {
    form: {
      _csrf: await tok(), limite: '800000', periode_indemnite_mois: '12',
      franchise_jours: '3', base_montant: 'marge_brute',
      avenants: ['frais_supplementaires', 'acces_civil'], prime: '2800',
    },
  });
  test('garanties → 302', r.statut === 302, r.statut);
  const g = bd.prepare('SELECT * FROM pe_garanties WHERE soumission_id = ?').get(sid);
  test('garanties en base', !!g && Number(g.limite) === 800000);
  test('période 12 mois stockée', Number(g.periode_indemnite_mois) === 12);
  test('franchise 3 jours stockée', Number(g.franchise_jours) === 3);
  test('base marge_brute stockée', g.base_montant === 'marge_brute');
  test('avenants stockés', JSON.parse(g.avenants).frais_supplementaires === 1 && JSON.parse(g.avenants).acces_civil === 1);
  test('version créée après garanties', nbVersions(sid) === vAvant + 1);
  r = await req(jar, 'GET', '/pe/' + sid);
  test('garanties affichées sur la fiche', r.texte.includes('Frais supplémentaires') && r.texte.includes('Marge brute'));
  test('période radio 12 mois précochée', /name="periode_indemnite_mois" value="12" checked/.test(r.texte));
  test('base radio marge_brute précochée', /name="base_montant" value="marge_brute" checked/.test(r.texte));
  // période invalide
  r = await req(jar, 'POST', `/pe/${sid}/garanties`, {
    form: { _csrf: await tok(), periode_indemnite_mois: '6' },
  });
  test('période invalide → 400', r.statut === 400, r.statut);
  // base invalide
  r = await req(jar, 'POST', `/pe/${sid}/garanties`, {
    form: { _csrf: await tok(), base_montant: 'inexistante' },
  });
  test('base invalide → 400', r.statut === 400, r.statut);
  // franchise négative
  r = await req(jar, 'POST', `/pe/${sid}/garanties`, {
    form: { _csrf: await tok(), franchise_jours: '-1' },
  });
  test('franchise négative → 400', r.statut === 400, r.statut);
  // modification (mise à jour, pas doublon)
  r = await req(jar, 'POST', `/pe/${sid}/garanties`, {
    form: { _csrf: await tok(), limite: '1000000', periode_indemnite_mois: '18', franchise_jours: '5', base_montant: 'benefice_brut' },
  });
  test('modification garanties → 302', r.statut === 302, r.statut);
  test('pas de doublon garanties', bd.prepare('SELECT COUNT(*) AS n FROM pe_garanties WHERE soumission_id = ?').get(sid).n === 1);
  test('limite mise à jour', Number(bd.prepare('SELECT limite FROM pe_garanties WHERE soumission_id = ?').get(sid).limite) === 1000000);
  test('base mise à jour', bd.prepare('SELECT base_montant FROM pe_garanties WHERE soumission_id = ?').get(sid).base_montant === 'benefice_brut');

  // ---- 6. Antécédents --------------------------------------------------------------------
  console.log('6. Antécédents');
  r = await req(jar, 'POST', `/pe/${sid}/antecedents`, {
    form: {
      _csrf: await tok(), assureur_actuel: 'Assureur Test PE', numero_police_actuelle: 'PE-123',
      date_expiration_actuelle: '2026-11-01', annees_assurance_continue: '5',
      interruptions: '2022-03-11 | Bris d’équipement (four) | 6 | 28000\n2024-01-05 | Panne d’électricité | 2 | 5400',
      consentement_credit: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);
  const a = bd.prepare('SELECT * FROM pe_antecedents WHERE soumission_id = ?').get(sid);
  test('antécédents en base', !!a && a.assureur_actuel === 'Assureur Test PE');
  const inter = JSON.parse(a.interruptions_5ans);
  test('2 interruptions stockées', inter.length === 2, inter.length);
  test('interruption 1 parsée (date, cause)', inter[0].date === '2022-03-11' && inter[0].cause === 'Bris d’équipement (four)');
  test('durée et montant en nombres', inter[0].duree_jours === 6 && inter[0].montant === 28000);
  test('interruption 2 parsée', inter[1].cause === 'Panne d’électricité' && inter[1].duree_jours === 2);
  test('consentement stocké', JSON.parse(a.consentements).credit === 1);
  r = await req(jar, 'GET', '/pe/' + sid);
  test('antécédents affichés', r.texte.includes('Assureur Test PE') && r.texte.includes('2022-03-11 | Bris d’équipement (four) | 6 | 28000'));

  // ---- 7. Statuts, versions, 404 ------------------------------------------------------------
  console.log('7. Statuts, versions, 404');
  r = await req(jar, 'POST', `/pe/${sid}/statut`, { form: { _csrf: await tok(), statut: 'invalide' } });
  test('statut invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/pe/${sid}/statut`, { form: { _csrf: await tok(), statut: 'soumise' } });
  test('statut soumise → 302', r.statut === 302, r.statut);
  test('statut en base', bd.prepare('SELECT statut FROM pe_soumissions WHERE id = ?').get(sid).statut === 'soumise');
  r = await req(jar, 'GET', `/pe/${sid}/versions/1`);
  test('version v1 → 200', r.statut === 200, r.statut);
  test('version lecture seule (établissements)', r.texte.includes('Établissements assurés'));
  const vCourante = nbVersions(sid);
  r = await req(jar, 'GET', `/pe/${sid}/versions/${vCourante}`);
  test('dernière version montre la base bénéfice brut', r.texte.includes('Bénéfice brut'));
  test('dernière version montre l’interruption', r.texte.includes('Bris d’équipement (four)'));
  r = await req(jar, 'GET', `/pe/${sid}/versions/999`);
  test('version inexistante → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/pe/999999');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 8. Archivage de la soumission ----------------------------------------------------------
  console.log('8. Archivage soumission');
  r = await req(jar, 'POST', `/pe/${sid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage soumission → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/pe');
  test('soumission hors de la liste active', !r.texte.includes('Client PE inc.'));
  r = await req(jar, 'GET', '/pe?archives=1');
  test('soumission visible dans les archives', r.texte.includes('Client PE inc.'));
  r = await req(jar, 'POST', `/pe/${sid}/desarchiver`, { form: { _csrf: csrf((await req(jar, 'GET', '/pe/' + sid)).texte) } });
  test('désarchivage soumission → 302', r.statut === 302, r.statut);

  // ---- 9. Portefeuille courtier ---------------------------------------------------------------
  console.log('9. Portefeuille courtier');
  const lc1 = await loginComme('courtier1@t.ca', 'Test123456!');
  test('login courtier1 → 302', lc1.ok);
  r = await req(lc1.jar, 'GET', '/pe');
  test('courtier ne voit pas la soumission hors portefeuille', !r.texte.includes('Client PE inc.'));
  // crée une soumission pour cli3 (son portefeuille) directement
  const sidC = bd.prepare(
    'INSERT INTO pe_soumissions (cabinet_id, client_id) VALUES (?, ?)'
  ).run(cabA, cli3).lastInsertRowid;
  r = await req(lc1.jar, 'GET', '/pe/' + sidC);
  test('courtier ouvre sa soumission → 200', r.statut === 200, r.statut);
  r = await req(lc1.jar, 'GET', '/pe/' + sid);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(lc1.jar, 'POST', '/pe', {
    form: { _csrf: csrf((await req(lc1.jar, 'GET', '/pe/nouveau')).texte), client_id: String(cli2) },
  });
  test('création hors portefeuille → 400', r.statut === 400, r.statut);
  r = await req(lc1.jar, 'POST', `/pe/etablissement/${eid}`, {
    form: { _csrf: csrf((await req(lc1.jar, 'GET', '/pe/' + sidC)).texte), nom_lieu: 'X' },
  });
  test('mutation établissement hors portefeuille → 403', r.statut === 403, r.statut);

  // ---- 10. Inter-cabinets -------------------------------------------------------------------------
  console.log('10. Inter-cabinets');
  const lb = await loginComme('adminb@t.ca', 'Test123456!');
  test('login adminB → 302', lb.ok);
  r = await req(lb.jar, 'GET', '/pe/' + sid);
  test('cabinet B ne voit pas → 404', r.statut === 404, r.statut);

  // ---- 11. Non connecté + CSRF -----------------------------------------------------------------------
  console.log('11. Auth et CSRF');
  const jarAnon = nouveauJar();
  r = await req(jarAnon, 'GET', '/pe');
  test('non connecté → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', '/pe', { form: { client_id: String(cli1) } });
  test('POST sans CSRF → 403', r.statut === 403, r.statut);

  // ---- 12. Audit + règle d'or ----------------------------------------------------------------------------
  console.log('12. Audit et règle d’or');
  const n = bd.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action LIKE 'pe_%'").get().n;
  test('journal d’audit alimenté', n >= 10, n);
  const fs = require('fs');
  const codeRoutes = fs.readFileSync(__dirname + '/../routes/pe.js', 'utf8');
  const codeLib = fs.readFileSync(__dirname + '/../lib/pe.js', 'utf8');
  test('aucun DELETE en dur (routes)', !/DELETE\s+FROM\s+pe_/i.test(codeRoutes));
  test('aucun DELETE en dur (lib)', !/DELETE\s+FROM\s+pe_/i.test(codeLib));

  console.log(`\n== ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE :', e); process.exit(1); });
