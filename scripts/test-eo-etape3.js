/**
 * scripts/test-eo-etape3.js — Gestion de la police E&O (étape 3/10 E&O) :
 * conversion soumission → police (ligne 'eo'), fiche police avec données
 * E&O figées, avenants en cours de terme (versions avec note), liaison
 * police existante, CSRF, cloisonnement inter-cabinets, portefeuille
 * courtier, audit. Miroir de scripts/test-cyber-etape3.js.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-eo-etape3.js
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
function dansNJours(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

(async () => {
  console.log('== Tests E&O étape 3 (gestion police E&O) :', BASE);

  // ---- Préparation directe --------------------------------------------------
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const cabB = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet B').lastInsertRowid;
  const hash = bcrypt.hashSync('Test1234!', 4);
  bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)")
    .run(cabB, 'adminb@t.ca', hash, 'Admin B');
  const courtier1 = bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)")
    .run(cabA, 'courtier1@t.ca', hash, 'Courtier Un').lastInsertRowid;
  const courtier2 = bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)")
    .run(cabA, 'courtier2@t.ca', hash, 'Courtier Deux').lastInsertRowid;
  const cli1 = bd.prepare('INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)')
    .run(cabA, 'Client EO Test inc.', 'Jean', 'Eo').lastInsertRowid;
  const cli2 = bd.prepare('INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)')
    .run(cabA, 'Client EO Courtier inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
  const ass1 = bd.prepare('INSERT INTO assureurs (cabinet_id, nom) VALUES (?, ?)').run(cabA, 'Assureur EO').lastInsertRowid;
  bd.prepare('INSERT INTO assureur_produits (assureur_id, produit, commission_pct) VALUES (?, ?, ?)').run(ass1, 'eo', 17.5);
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && cli1 > 0 && ass1 > 0);
  test('colonne eo_soumission_id en base', bd.prepare('PRAGMA table_info(polices)').all().some((c) => c.name === 'eo_soumission_id'));

  // ---- 1. Login admin démo ----------------------------------------------------
  console.log('1. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 2. Soumission complète via HTTP -----------------------------------------
  console.log('2. Soumission complète');
  r = await req(jar, 'POST', '/eo', { form: { _csrf: csrf((await req(jar, 'GET', '/eo/nouveau')).texte), client_id: String(cli1), date_effet_souhaitee: dansNJours(30), notes: 'Test étape 3 E&O' } });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('id soumission valide', sid > 0, r.location);
  r = await req(jar, 'GET', '/eo/' + sid);
  r = await req(jar, 'POST', `/eo/${sid}/activite`, {
    form: {
      _csrf: csrf(r.texte), description_activite: 'Conseil en transformation numérique',
      chiffre_affaires: '450000', nb_professionnels: '4', notes: 'TPE/PME',
    },
  });
  test('ajout activité → 302', r.statut === 302, r.statut);
  const aid = bd.prepare('SELECT id FROM eo_activites WHERE soumission_id = ? AND cabinet_id = ?').get(sid, cabA).id;
  test('activité en base', aid > 0);
  r = await req(jar, 'GET', '/eo/' + sid);
  r = await req(jar, 'POST', `/eo/${sid}/garanties`, {
    form: {
      _csrf: csrf(r.texte), limite_par_sinistre: '2000000', limite_agregat: '2000000',
      franchise: '10000', base: 'reclamations_presentees', avenants: 'frais_defense', prime: '9500',
    },
  });
  test('garanties → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/eo/' + sid);
  r = await req(jar, 'POST', `/eo/${sid}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Ancien Assureur EO', annees_assurance_continue: '4',
      circonstances: 'Un client insatisfait menace de poursuivre.',
      consentement_credit: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);

  // ---- 3. Conversion -------------------------------------------------------------
  console.log('3. Conversion soumission → police');
  r = await req(jar, 'GET', '/eo/' + sid);
  test('fiche propose la conversion', r.statut === 200 && r.texte.includes('Convertir en police'), r.statut);
  r = await req(jar, 'POST', `/eo/${sid}/convertir`, { form: { numero_police: 'EO-001', assureur_id: String(ass1), date_echeance: dansNJours(20) } });
  test('conversion sans CSRF → 403', r.statut === 403, r.statut);
  r = await req(jar, 'GET', '/eo/' + sid);
  r = await req(jar, 'POST', `/eo/${sid}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'EO-001', assureur_id: String(ass1),
      date_effet: dansNJours(0), date_echeance: dansNJours(20), franchise: '10000',
    },
  });
  test('conversion → 302', r.statut === 302, r.statut);
  const pid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche police', r.location === '/echeances/police/' + pid && pid > 0, r.location);
  const pol = bd.prepare('SELECT * FROM polices WHERE id = ?').get(pid);
  test('police ligne=eo', pol && pol.ligne === 'eo', pol && pol.ligne);
  test('police liée à la soumission', pol && pol.eo_soumission_id === sid, String(pol && pol.eo_soumission_id));
  test('version E&O figée enregistrée', pol && pol.eo_soumission_version > 0, String(pol && pol.eo_soumission_version));
  test('soumission → convertie_police', bd.prepare('SELECT statut FROM eo_soumissions WHERE id = ?').get(sid).statut === 'convertie_police');
  test('police v1 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 1);
  test('audit police_creee', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_creee' AND details LIKE '%EO-001%'").get().n >= 1);

  // ---- 4. Fiche police E&O : données figées -------------------------------------
  console.log('4. Fiche police E&O');
  r = await req(jar, 'GET', '/echeances/police/' + pid);
  test('fiche → 200', r.statut === 200, r.statut);
  test('section Données E&O', r.texte.includes('Données E&O'));
  test('activité figée affichée', r.texte.includes('Conseil en transformation numérique'));
  const txt = r.texte.replace(/ /g, ' ');
  test('CA figé affiché', txt.includes('450 000'), 'CA introuvable');
  test('base figée affichée', r.texte.includes('Réclamations-présentées (claims-made)'));
  test('avenant figé affiché', r.texte.includes('Frais de défense'));
  test('circonstances figées affichées', r.texte.includes('menace de poursuivre'));
  test('lien voir le snapshot', r.texte.includes('voir le snapshot'));

  // ---- 5. Avenant en cours de terme -----------------------------------------------
  console.log('5. Avenant en cours de terme');
  r = await req(jar, 'GET', '/eo/' + sid);
  r = await req(jar, 'POST', `/eo/${sid}/activite`, {
    form: { _csrf: csrf(r.texte), description_activite: 'Formation des utilisateurs', chiffre_affaires: '75000', nb_professionnels: '1' },
  });
  test('ajout activité (avenant) → 302', r.statut === 302, r.statut);
  const nbVersions = bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n;
  test('police v2 créée', nbVersions === 2, 'versions=' + nbVersions);
  const v2 = bd.prepare('SELECT avenant_note FROM police_versions WHERE police_id = ? AND version = 2').get(pid);
  test('note d’avenant sur v2', v2 && /Avenant/.test(v2.avenant_note || ''), v2 && v2.avenant_note);
  r = await req(jar, 'GET', '/eo/' + sid);
  r = await req(jar, 'POST', `/eo/activite/${aid}`, {
    form: { _csrf: csrf(r.texte), description_activite: 'Conseil en transformation numérique', chiffre_affaires: '480000', nb_professionnels: '4' },
  });
  test('activité modifiée (avenant) → 302', r.statut === 302, r.statut);
  test('police v3 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 3);
  r = await req(jar, 'GET', '/eo/' + sid);
  r = await req(jar, 'POST', `/eo/${sid}/garanties`, {
    form: { _csrf: csrf(r.texte), limite_par_sinistre: '3000000', limite_agregat: '3000000', franchise: '5000', base: 'occurrences', avenants: 'medias_contenu' },
  });
  test('garanties modifiées (avenant) → 302', r.statut === 302, r.statut);
  test('police v4 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 4);
  r = await req(jar, 'GET', `/polices/${pid}/versions`);
  test('historique versions → 200', r.statut === 200, r.statut);
  test('note d’avenant visible', r.texte.includes('Avenant'));

  // ---- 6. Double conversion refusée ------------------------------------------------
  console.log('6. Double conversion');
  r = await req(jar, 'GET', '/eo/' + sid);
  r = await req(jar, 'POST', `/eo/${sid}/convertir`, { form: { _csrf: csrf(r.texte), numero_police: 'EO-002', assureur_id: String(ass1), date_effet: dansNJours(0), date_echeance: dansNJours(20) } });
  test('double conversion → 400', r.statut === 400, r.statut);

  // ---- 7. Lier une police existante --------------------------------------------------
  console.log('7. Liaison police existante');
  r = await req(jar, 'POST', '/eo', { form: { _csrf: csrf((await req(jar, 'GET', '/eo/nouveau')).texte), client_id: String(cli1) } });
  const sid2 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'eo', assureur_id: String(ass1), numero_police: 'EO-010', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidEo = Number((r.location || '').split('/').pop());
  test('police E&O manuelle créée', r.statut === 302 && pidEo > 0, r.location);
  r = await req(jar, 'GET', '/eo/' + sid2);
  test('fiche propose la liaison', r.texte.includes('lier-police'));
  r = await req(jar, 'POST', `/eo/${sid2}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidEo) } });
  test('liaison → 302', r.statut === 302, r.statut);
  test('police liée en base', bd.prepare('SELECT eo_soumission_id FROM polices WHERE id = ?').get(pidEo).eo_soumission_id === sid2);
  test('soumission 2 convertie', bd.prepare('SELECT statut FROM eo_soumissions WHERE id = ?').get(sid2).statut === 'convertie_police');
  r = await req(jar, 'POST', '/eo', { form: { _csrf: csrf((await req(jar, 'GET', '/eo/nouveau')).texte), client_id: String(cli1) } });
  const sid3 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'cyber', assureur_id: String(ass1), numero_police: 'CYB-999', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidCyber = Number((r.location || '').split('/').pop());
  r = await req(jar, 'GET', '/eo/' + sid3);
  r = await req(jar, 'POST', `/eo/${sid3}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidCyber) } });
  test('lier une police non-E&O → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/eo/${sid3}/lier-police`, { form: { _csrf: csrf((await req(jar, 'GET', '/eo/' + sid3)).texte), police_id: String(pidEo) } });
  test('lier une police déjà liée → 400', r.statut === 400, r.statut);

  // ---- 8. Cloisonnement inter-cabinets -------------------------------------------------
  console.log('8. Cloisonnement');
  const jb = await loginComme('adminb@t.ca', 'Test1234!');
  test('login admin B', jb.ok);
  r = await req(jb.jar, 'GET', '/echeances/police/' + pid);
  test('cabinet B : fiche police → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', '/eo/' + sid);
  test('cabinet B : soumission → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', '/eo');
  const csrfB = csrf(r.texte);
  r = await req(jb.jar, 'POST', `/eo/${sid}/convertir`, { form: { _csrf: csrfB, numero_police: 'X', assureur_id: '1', date_effet: dansNJours(0), date_echeance: dansNJours(20) } });
  test('cabinet B : conversion → 404', r.statut === 404, r.statut);

  // ---- 9. Portefeuille courtier -------------------------------------------------------------
  console.log('9. Portefeuille courtier');
  const jc1 = await loginComme('courtier1@t.ca', 'Test1234!');
  test('login courtier1', jc1.ok);
  r = await req(jc1.jar, 'GET', '/eo/' + sid);
  test('courtier1 : soumission hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(jc1.jar, 'POST', '/eo', { form: { _csrf: csrf((await req(jc1.jar, 'GET', '/eo/nouveau')).texte), client_id: String(cli2) } });
  const sidC = Number((r.location || '').split('/').pop());
  test('courtier1 crée soumission (son portefeuille) → 302', r.statut === 302, r.statut);
  r = await req(jc1.jar, 'GET', '/eo/' + sidC);
  r = await req(jc1.jar, 'POST', `/eo/${sidC}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'EO-C1', assureur_id: String(ass1),
      date_effet: dansNJours(0), date_echeance: dansNJours(20),
    },
  });
  test('courtier1 convertit → 302', r.statut === 302, r.statut);
  const jc2 = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jc2.jar, 'GET', '/eo/' + sidC);
  test('courtier2 : soumission d’autrui → 403', r.statut === 403, r.statut);

  // ---- 10. Audit -----------------------------------------------------------------------------------
  console.log('10. Audit');
  test('audit versions police', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_version'").get().n >= 4);

  // ---- 11. Règle d'or : aucun DELETE sur eo_* ------------------------------------------------------
  console.log('11. Règle d’or');
  const fichiers = ['routes/eo.js', 'lib/eo.js'];
  const fs = require('fs');
  let aucunDelete = true;
  for (const f of fichiers) {
    const contenu = fs.readFileSync(f, 'utf8');
    if (/DELETE\s+FROM\s+eo_/i.test(contenu)) { aucunDelete = false; console.log('  DELETE trouvé dans', f); }
  }
  test('aucun DELETE FROM eo_* dans le code', aucunDelete);

  console.log(`\n${total - echecs}/${total} tests réussis`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
