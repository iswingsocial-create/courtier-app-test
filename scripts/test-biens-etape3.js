/**
 * scripts/test-biens-etape3.js — Gestion de la police biens commerciaux (étape 3/10 biens) :
 * conversion soumission → police (produit 'biens'), fiche police avec données
 * biens figées, avenants en cours de terme (versions avec note), échéances,
 * liaison police existante, CSRF, cloisonnement inter-cabinets, portefeuille
 * courtier, audit. Miroir de scripts/test-fpq1-etape3.js.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-biens-etape3.js
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
function dansNJours(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

(async () => {
  console.log('== Tests Biens étape 3 (gestion police biens) :', BASE);

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
    .run(cabA, 'Client Test inc.', 'Jean', 'Test').lastInsertRowid;
  const cli2 = bd.prepare('INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)')
    .run(cabA, 'Client Courtier inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
  const ass1 = bd.prepare('INSERT INTO assureurs (cabinet_id, nom) VALUES (?, ?)').run(cabA, 'Assureur Test').lastInsertRowid;
  bd.prepare('INSERT INTO assureur_produits (assureur_id, produit, commission_pct) VALUES (?, ?, ?)').run(ass1, 'biens', 15.0);
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && cli1 > 0 && ass1 > 0);

  // ---- 1. Login admin démo ----------------------------------------------------
  console.log('1. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 2. Soumission complète via HTTP -----------------------------------------
  console.log('2. Soumission complète');
  r = await req(jar, 'POST', '/biens', { form: { _csrf: csrf((await req(jar, 'GET', '/biens/nouveau')).texte), client_id: String(cli1), date_effet_souhaitee: dansNJours(30), notes: 'Test étape 3 biens' } });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('id soumission valide', sid > 0, r.location);
  r = await req(jar, 'GET', '/biens/' + sid);
  r = await req(jar, 'POST', `/biens/${sid}/batiment`, {
    form: {
      _csrf: csrf(r.texte), adresse: '123 rue Principale', ville: 'Montréal',
      type_construction: 'beton', annee_construction: '1995', superficie_pi2: '5000',
      occupation: 'Bureau', valeur_batiment: '750000',
    },
  });
  test('ajout bâtiment → 302', r.statut === 302, r.statut);
  const bid = bd.prepare('SELECT id FROM biens_batiments WHERE soumission_id = ? AND cabinet_id = ?').get(sid, cabA).id;
  r = await req(jar, 'GET', '/biens/' + sid);
  r = await req(jar, 'POST', `/biens/${sid}/contenu`, {
    form: { _csrf: csrf(r.texte), description: 'Mobilier de bureau', type_contenu: 'mobilier', valeur: '85000', batiment_id: String(bid) },
  });
  test('ajout contenu → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/biens/' + sid);
  r = await req(jar, 'POST', `/biens/${sid}/batiment/${bid}/garanties`, {
    form: { _csrf: csrf(r.texte), formule: 'tous_risques', franchise: '1000', montant_assurance: '750000', avenants: 'tremblement_terre' },
  });
  test('garanties → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/biens/' + sid);
  r = await req(jar, 'POST', `/biens/${sid}/antecedents`, {
    form: { _csrf: csrf(r.texte), assureur_actuel: 'Ancien Assureur', annees_assurance_continue: '6' },
  });
  test('antécédents → 302', r.statut === 302, r.statut);

  // ---- 3. Conversion -------------------------------------------------------------
  console.log('3. Conversion soumission → police');
  r = await req(jar, 'GET', '/biens/' + sid);
  test('fiche propose la conversion', r.statut === 200 && r.texte.includes('Convertir en police'), r.statut);
  r = await req(jar, 'POST', `/biens/${sid}/convertir`, { form: { numero_police: 'BIENS-001', assureur_id: String(ass1), date_echeance: dansNJours(20) } });
  test('conversion sans CSRF → 403', r.statut === 403, r.statut);
  r = await req(jar, 'GET', '/biens/' + sid);
  r = await req(jar, 'POST', `/biens/${sid}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'BIENS-001', assureur_id: String(ass1),
      date_effet: dansNJours(0), date_echeance: dansNJours(20), franchise: '1000',
    },
  });
  test('conversion → 302', r.statut === 302, r.statut);
  const pid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche police', r.location === '/echeances/police/' + pid && pid > 0, r.location);
  const pol = bd.prepare('SELECT * FROM polices WHERE id = ?').get(pid);
  test('police ligne=biens', pol && pol.ligne === 'biens', pol && pol.ligne);
  test('police liée à la soumission', pol && pol.biens_soumission_id === sid, String(pol && pol.biens_soumission_id));
  test('version biens figée enregistrée', pol && pol.biens_soumission_version > 0, String(pol && pol.biens_soumission_version));
  test('soumission → convertie_police', bd.prepare('SELECT statut FROM biens_soumissions WHERE id = ?').get(sid).statut === 'convertie_police');
  test('police v1 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 1);
  test('audit police_creee', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_creee' AND details LIKE '%BIENS-001%'").get().n >= 1);

  // ---- 4. Fiche police biens : données figées ---------------------------------------
  console.log('4. Fiche police biens');
  r = await req(jar, 'GET', '/echeances/police/' + pid);
  test('fiche → 200', r.statut === 200, r.statut);
  test('section Données biens', r.texte.includes('Données biens'));
  test('bâtiment figé affiché', r.texte.includes('123 rue Principale'));
  test('contenu figé affiché', r.texte.includes('Mobilier de bureau'));
  test('garanties figées affichées', r.texte.includes('Tous risques'));
  test('lien voir le snapshot', r.texte.includes('voir le snapshot'));

  // ---- 5. Avenant en cours de terme -------------------------------------------------
  console.log('5. Avenant en cours de terme');
  r = await req(jar, 'GET', '/biens/' + sid);
  r = await req(jar, 'POST', `/biens/${sid}/batiment`, {
    form: { _csrf: csrf(r.texte), adresse: '456 avenue Secondaire', ville: 'Laval', type_construction: 'acier' },
  });
  test('ajout bâtiment (avenant) → 302', r.statut === 302, r.statut);
  const nbVersions = bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n;
  test('police v2 créée', nbVersions === 2, 'versions=' + nbVersions);
  const v2 = bd.prepare('SELECT avenant_note FROM police_versions WHERE police_id = ? AND version = 2').get(pid);
  test('note d’avenant sur v2', v2 && /Avenant/.test(v2.avenant_note || ''), v2 && v2.avenant_note);
  r = await req(jar, 'GET', '/biens/' + sid);
  r = await req(jar, 'POST', `/biens/${sid}/batiment/${bid}/garanties`, {
    form: { _csrf: csrf(r.texte), formule: 'risques_designes', franchise: '2500', montant_assurance: '700000' },
  });
  test('garanties modifiées (avenant) → 302', r.statut === 302, r.statut);
  test('police v3 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 3);
  r = await req(jar, 'GET', `/polices/${pid}/versions`);
  test('historique versions → 200', r.statut === 200, r.statut);
  test('note d’avenant visible', r.texte.includes('Avenant'));

  // ---- 6. Échéances ------------------------------------------------------------------
  console.log('6. Échéances');
  r = await req(jar, 'GET', '/echeances');
  test('tableau → 200', r.statut === 200, r.statut);
  test('police biens dans les échéances (J-30)', r.texte.includes('BIENS-001'));

  // ---- 7. Double conversion refusée ------------------------------------------------------
  console.log('7. Double conversion');
  r = await req(jar, 'GET', '/biens/' + sid);
  r = await req(jar, 'POST', `/biens/${sid}/convertir`, { form: { _csrf: csrf(r.texte), numero_police: 'BIENS-002', assureur_id: String(ass1), date_effet: dansNJours(0), date_echeance: dansNJours(20) } });
  test('double conversion → 400', r.statut === 400, r.statut);

  // ---- 8. Lier une police existante ---------------------------------------------------------
  console.log('8. Liaison police existante');
  r = await req(jar, 'POST', '/biens', { form: { _csrf: csrf((await req(jar, 'GET', '/biens/nouveau')).texte), client_id: String(cli1) } });
  const sid2 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'biens', assureur_id: String(ass1), numero_police: 'BIENS-010', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidBiens = Number((r.location || '').split('/').pop());
  test('police biens manuelle créée', r.statut === 302 && pidBiens > 0, r.location);
  r = await req(jar, 'GET', '/biens/' + sid2);
  test('fiche propose la liaison', r.texte.includes('lier-police'));
  r = await req(jar, 'POST', `/biens/${sid2}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidBiens) } });
  test('liaison → 302', r.statut === 302, r.statut);
  test('police liée en base', bd.prepare('SELECT biens_soumission_id FROM polices WHERE id = ?').get(pidBiens).biens_soumission_id === sid2);
  test('soumission 2 convertie', bd.prepare('SELECT statut FROM biens_soumissions WHERE id = ?').get(sid2).statut === 'convertie_police');
  r = await req(jar, 'POST', '/biens', { form: { _csrf: csrf((await req(jar, 'GET', '/biens/nouveau')).texte), client_id: String(cli1) } });
  const sid3 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'cgl', assureur_id: String(ass1), numero_police: 'CGL-999', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidCgl = Number((r.location || '').split('/').pop());
  r = await req(jar, 'GET', '/biens/' + sid3);
  r = await req(jar, 'POST', `/biens/${sid3}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidCgl) } });
  test('lier une police non-biens → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/biens/${sid3}/lier-police`, { form: { _csrf: csrf((await req(jar, 'GET', '/biens/' + sid3)).texte), police_id: String(pidBiens) } });
  test('lier une police déjà liée → 400', r.statut === 400, r.statut);

  // ---- 9. Cloisonnement inter-cabinets ----------------------------------------------------------
  console.log('9. Cloisonnement');
  const jb = await loginComme('adminb@t.ca', 'Test1234!');
  test('login admin B', jb.ok);
  r = await req(jb.jar, 'GET', '/echeances/police/' + pid);
  test('cabinet B : fiche police → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', '/biens/' + sid);
  test('cabinet B : soumission → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', '/biens');
  const csrfB = csrf(r.texte);
  r = await req(jb.jar, 'POST', `/biens/${sid}/convertir`, { form: { _csrf: csrfB, numero_police: 'X', assureur_id: '1', date_effet: dansNJours(0), date_echeance: dansNJours(20) } });
  test('cabinet B : conversion → 404', r.statut === 404, r.statut);

  // ---- 10. Portefeuille courtier ----------------------------------------------------------------------
  console.log('10. Portefeuille courtier');
  const jc1 = await loginComme('courtier1@t.ca', 'Test1234!');
  test('login courtier1', jc1.ok);
  r = await req(jc1.jar, 'GET', '/biens/' + sid);
  test('courtier1 : soumission hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(jc1.jar, 'POST', '/biens', { form: { _csrf: csrf((await req(jc1.jar, 'GET', '/biens/nouveau')).texte), client_id: String(cli2) } });
  const sidC = Number((r.location || '').split('/').pop());
  test('courtier1 crée soumission (son portefeuille) → 302', r.statut === 302, r.statut);
  r = await req(jc1.jar, 'GET', '/biens/' + sidC);
  r = await req(jc1.jar, 'POST', `/biens/${sidC}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'BIENS-C1', assureur_id: String(ass1),
      date_effet: dansNJours(0), date_echeance: dansNJours(20),
    },
  });
  test('courtier1 convertit → 302', r.statut === 302, r.statut);
  const jc2 = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jc2.jar, 'GET', '/biens/' + sidC);
  test('courtier2 : soumission d’autrui → 403', r.statut === 403, r.statut);

  // ---- 11. Audit --------------------------------------------------------------------------------------------
  console.log('11. Audit');
  test('audit versions police', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_version'").get().n >= 2);

  console.log(`\n${total - echecs}/${total} tests réussis`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
