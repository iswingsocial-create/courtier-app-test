/**
 * scripts/test-pe-etape3.js — Gestion de la police perte d'exploitation (étape 3/10 PE) :
 * conversion soumission → police (ligne 'perte_exploitation'), fiche police avec données
 * PE figées (établissements, garanties, interruptions), avenants en cours de terme
 * (versions avec note), liaison police existante, CSRF, cloisonnement inter-cabinets,
 * portefeuille courtier, audit. Miroir de scripts/test-do-etape3.js.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-pe-etape3.js
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
  console.log('== Tests PE étape 3 (gestion police perte d\'exploitation) :', BASE);

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
    .run(cabA, 'Client PE Test inc.', 'Jean', 'Pe').lastInsertRowid;
  const cli2 = bd.prepare('INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)')
    .run(cabA, 'Client PE Courtier inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
  const ass1 = bd.prepare('INSERT INTO assureurs (cabinet_id, nom) VALUES (?, ?)').run(cabA, 'Assureur PE').lastInsertRowid;
  bd.prepare('INSERT INTO assureur_produits (assureur_id, produit, commission_pct) VALUES (?, ?, ?)').run(ass1, 'perte_exploitation', 17.5);
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && cli1 > 0 && ass1 > 0);
  test('colonne pe_soumission_id en base', bd.prepare('PRAGMA table_info(polices)').all().some((c) => c.name === 'pe_soumission_id'));

  // ---- 1. Login admin démo ----------------------------------------------------
  console.log('1. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 2. Soumission complète via HTTP -----------------------------------------
  console.log('2. Soumission complète');
  r = await req(jar, 'POST', '/pe', { form: { _csrf: csrf((await req(jar, 'GET', '/pe/nouveau')).texte), client_id: String(cli1), date_effet_souhaitee: dansNJours(30), notes: 'Test étape 3 PE' } });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('id soumission valide', sid > 0, r.location);
  r = await req(jar, 'GET', '/pe/' + sid);
  r = await req(jar, 'POST', `/pe/${sid}/etablissement`, {
    form: {
      _csrf: csrf(r.texte), nom_lieu: 'Fournil', adresse: '123 rue Sainte-Catherine E, Montréal',
      occupation: 'Boulangerie — fournil', chiffre_affaires: '750000', superficie: '250',
      annee_construction: '1965', base_valeur: 'remplacement',
    },
  });
  test('ajout établissement → 302', r.statut === 302, r.statut);
  const eid = bd.prepare('SELECT id FROM pe_etablissements WHERE soumission_id = ? AND cabinet_id = ?').get(sid, cabA).id;
  test('établissement en base', eid > 0);
  r = await req(jar, 'GET', '/pe/' + sid);
  r = await req(jar, 'POST', `/pe/${sid}/garanties`, {
    form: {
      _csrf: csrf(r.texte), limite: '800000', periode_indemnite_mois: '12',
      franchise_jours: '3', base_montant: 'marge_brute', avenants: 'frais_supplementaires', prime: '2800',
    },
  });
  test('garanties → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/pe/' + sid);
  r = await req(jar, 'POST', `/pe/${sid}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Ancien Assureur PE', annees_assurance_continue: '4',
      interruptions: '2022-03-11 | Bris d\u2019équipement (four) | 6 | 28000',
      consentement_credit: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);

  // ---- 3. Conversion -------------------------------------------------------------
  console.log('3. Conversion soumission → police');
  r = await req(jar, 'GET', '/pe/' + sid);
  test('fiche propose la conversion', r.statut === 200 && r.texte.includes('Convertir en police'), r.statut);
  r = await req(jar, 'POST', `/pe/${sid}/convertir`, { form: { numero_police: 'PE-001', assureur_id: String(ass1), date_echeance: dansNJours(20) } });
  test('conversion sans CSRF → 403', r.statut === 403, r.statut);
  r = await req(jar, 'GET', '/pe/' + sid);
  r = await req(jar, 'POST', `/pe/${sid}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'PE-001', assureur_id: String(ass1),
      date_effet: dansNJours(0), date_echeance: dansNJours(20), franchise: '5000',
    },
  });
  test('conversion → 302', r.statut === 302, r.statut);
  const pid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche police', r.location === '/echeances/police/' + pid && pid > 0, r.location);
  const pol = bd.prepare('SELECT * FROM polices WHERE id = ?').get(pid);
  test('police ligne=perte_exploitation', pol && pol.ligne === 'perte_exploitation', pol && pol.ligne);
  test('police liée à la soumission', pol && pol.pe_soumission_id === sid, String(pol && pol.pe_soumission_id));
  test('version PE figée enregistrée', pol && pol.pe_soumission_version > 0, String(pol && pol.pe_soumission_version));
  test('soumission → convertie_police', bd.prepare('SELECT statut FROM pe_soumissions WHERE id = ?').get(sid).statut === 'convertie_police');
  test('police v1 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 1);
  test('audit police_creee', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_creee' AND details LIKE '%PE-001%'").get().n >= 1);

  // ---- 4. Fiche police PE : données figées -------------------------------------
  console.log('4. Fiche police PE');
  r = await req(jar, 'GET', '/echeances/police/' + pid);
  test('fiche → 200', r.statut === 200, r.statut);
  test('section Données perte d\u2019exploitation', r.texte.includes('Données perte d\u2019exploitation'));
  test('établissement figé affiché', r.texte.includes('Fournil'));
  test('période figée affichée', r.texte.includes('12 mois'));
  test('base figée affichée', r.texte.includes('Marge brute'));
  test('avenant figé affiché', r.texte.includes('Frais supplémentaires'));
  test('interruption figée affichée', r.texte.includes('Bris d\u2019équipement'));
  test('lien voir le snapshot', r.texte.includes('voir le snapshot'));

  // ---- 5. Avenant en cours de terme -----------------------------------------------
  console.log('5. Avenant en cours de terme');
  r = await req(jar, 'GET', '/pe/' + sid);
  r = await req(jar, 'POST', `/pe/${sid}/etablissement`, {
    form: { _csrf: csrf(r.texte), nom_lieu: 'Magasin', adresse: '4800 boul. Saint-Laurent, Montréal', occupation: 'Commerce de détail' },
  });
  test('ajout établissement (avenant) → 302', r.statut === 302, r.statut);
  const nbVersions = bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n;
  test('police v2 créée', nbVersions === 2, 'versions=' + nbVersions);
  const v2 = bd.prepare('SELECT avenant_note FROM police_versions WHERE police_id = ? AND version = 2').get(pid);
  test('note d’avenant sur v2', v2 && /Avenant/.test(v2.avenant_note || ''), v2 && v2.avenant_note);
  r = await req(jar, 'GET', '/pe/' + sid);
  r = await req(jar, 'POST', `/pe/etablissement/${eid}`, {
    form: { _csrf: csrf(r.texte), nom_lieu: 'Fournil', adresse: '123 rue Sainte-Catherine E, Montréal', occupation: 'Boulangerie — fournil agrandi', chiffre_affaires: '800000' },
  });
  test('établissement modifié (avenant) → 302', r.statut === 302, r.statut);
  test('police v3 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 3);
  r = await req(jar, 'GET', '/pe/' + sid);
  r = await req(jar, 'POST', `/pe/${sid}/garanties`, {
    form: { _csrf: csrf(r.texte), limite: '1000000', periode_indemnite_mois: '18', franchise_jours: '5', base_montant: 'benefice_brut', avenants: 'acces_civil', prime: '3500' },
  });
  test('garanties modifiées (avenant) → 302', r.statut === 302, r.statut);
  test('police v4 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 4);
  r = await req(jar, 'GET', `/polices/${pid}/versions`);
  test('historique versions → 200', r.statut === 200, r.statut);
  test('note d’avenant visible', r.texte.includes('Avenant'));

  // ---- 6. Double conversion refusée ------------------------------------------------
  console.log('6. Double conversion');
  r = await req(jar, 'GET', '/pe/' + sid);
  r = await req(jar, 'POST', `/pe/${sid}/convertir`, { form: { _csrf: csrf(r.texte), numero_police: 'PE-002', assureur_id: String(ass1), date_effet: dansNJours(0), date_echeance: dansNJours(20) } });
  test('double conversion → 400', r.statut === 400, r.statut);

  // ---- 7. Lier une police existante --------------------------------------------------
  console.log('7. Liaison police existante');
  r = await req(jar, 'POST', '/pe', { form: { _csrf: csrf((await req(jar, 'GET', '/pe/nouveau')).texte), client_id: String(cli1) } });
  const sid2 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'perte_exploitation', assureur_id: String(ass1), numero_police: 'PE-010', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidPe = Number((r.location || '').split('/').pop());
  test('police PE manuelle créée', r.statut === 302 && pidPe > 0, r.location);
  r = await req(jar, 'GET', '/pe/' + sid2);
  test('fiche propose la liaison', r.texte.includes('lier-police'));
  r = await req(jar, 'POST', `/pe/${sid2}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidPe) } });
  test('liaison → 302', r.statut === 302, r.statut);
  test('police liée en base', bd.prepare('SELECT pe_soumission_id FROM polices WHERE id = ?').get(pidPe).pe_soumission_id === sid2);
  test('soumission 2 convertie', bd.prepare('SELECT statut FROM pe_soumissions WHERE id = ?').get(sid2).statut === 'convertie_police');
  r = await req(jar, 'POST', '/pe', { form: { _csrf: csrf((await req(jar, 'GET', '/pe/nouveau')).texte), client_id: String(cli1) } });
  const sid3 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'eo', assureur_id: String(ass1), numero_police: 'EO-999', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidEo = Number((r.location || '').split('/').pop());
  r = await req(jar, 'GET', '/pe/' + sid3);
  r = await req(jar, 'POST', `/pe/${sid3}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidEo) } });
  test('lier une police non-PE → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/pe/${sid3}/lier-police`, { form: { _csrf: csrf((await req(jar, 'GET', '/pe/' + sid3)).texte), police_id: String(pidPe) } });
  test('lier une police déjà liée → 400', r.statut === 400, r.statut);

  // ---- 8. Cloisonnement inter-cabinets -------------------------------------------------
  console.log('8. Cloisonnement');
  const jb = await loginComme('adminb@t.ca', 'Test1234!');
  test('login admin B', jb.ok);
  r = await req(jb.jar, 'GET', '/echeances/police/' + pid);
  test('cabinet B : fiche police → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', '/pe/' + sid);
  test('cabinet B : soumission → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', '/pe');
  const csrfB = csrf(r.texte);
  r = await req(jb.jar, 'POST', `/pe/${sid}/convertir`, { form: { _csrf: csrfB, numero_police: 'X', assureur_id: '1', date_effet: dansNJours(0), date_echeance: dansNJours(20) } });
  test('cabinet B : conversion → 404', r.statut === 404, r.statut);

  // ---- 9. Portefeuille courtier -------------------------------------------------------------
  console.log('9. Portefeuille courtier');
  const jc1 = await loginComme('courtier1@t.ca', 'Test1234!');
  test('login courtier1', jc1.ok);
  r = await req(jc1.jar, 'GET', '/pe/' + sid);
  test('courtier1 : soumission hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(jc1.jar, 'POST', '/pe', { form: { _csrf: csrf((await req(jc1.jar, 'GET', '/pe/nouveau')).texte), client_id: String(cli2) } });
  const sidC = Number((r.location || '').split('/').pop());
  test('courtier1 crée soumission (son portefeuille) → 302', r.statut === 302, r.statut);
  r = await req(jc1.jar, 'GET', '/pe/' + sidC);
  r = await req(jc1.jar, 'POST', `/pe/${sidC}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'PE-C1', assureur_id: String(ass1),
      date_effet: dansNJours(0), date_echeance: dansNJours(20),
    },
  });
  test('courtier1 convertit → 302', r.statut === 302, r.statut);
  const jc2 = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jc2.jar, 'GET', '/pe/' + sidC);
  test('courtier2 : soumission d’autrui → 403', r.statut === 403, r.statut);

  // ---- 10. Audit -----------------------------------------------------------------------------------
  console.log('10. Audit');
  test('audit versions police', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_version'").get().n >= 4);

  // ---- 11. Règle d'or : aucun DELETE sur pe_* ------------------------------------------------------
  console.log('11. Règle d’or');
  const fichiers = ['routes/pe.js', 'lib/pe.js'];
  const fs = require('fs');
  let aucunDelete = true;
  for (const f of fichiers) {
    const contenu = fs.readFileSync(f, 'utf8');
    if (/DELETE\s+FROM\s+pe_/i.test(contenu)) { aucunDelete = false; console.log('  DELETE trouvé dans', f); }
  }
  test('aucun DELETE FROM pe_* dans le code', aucunDelete);

  console.log(`\n${total - echecs}/${total} tests réussis`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
