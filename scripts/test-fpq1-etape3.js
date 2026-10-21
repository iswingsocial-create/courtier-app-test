/**
 * scripts/test-fpq1-etape3.js — Gestion de la police auto FPQ1 (étape 3/10) :
 * conversion soumission → police (produit 'auto'), fiche police avec données
 * FPQ1 figées, avenants en cours de terme (versions avec note), échéances,
 * attestation imprimable (carte rose), liaison police existante, CSRF,
 * cloisonnement inter-cabinets, portefeuille courtier, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-fpq1-etape3.js
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
  console.log('== Tests FPQ1 étape 3 (gestion police auto) :', BASE);

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
  bd.prepare('INSERT INTO assureur_produits (assureur_id, produit, commission_pct) VALUES (?, ?, ?)').run(ass1, 'auto', 12.5);
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
  r = await req(jar, 'POST', '/auto', { form: { _csrf: csrf((await req(jar, 'GET', '/auto/nouveau')).texte), client_id: String(cli1), date_effet_souhaitee: dansNJours(30), notes: 'Test étape 3' } });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('id soumission valide', sid > 0, r.location);
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/conducteur`, { form: { _csrf: csrf(r.texte), prenom: 'Alice', nom: 'Martin', numero_permis: 'M1234', conducteur_principal: 'on' } });
  test('ajout conducteur → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/vehicule`, { form: { _csrf: csrf(r.texte), annee: '2022', marque: 'Toyota', modele: 'Corolla', vin: 'VIN-TEST-001' } });
  test('ajout véhicule → 302', r.statut === 302, r.statut);
  const vid = bd.prepare('SELECT id FROM auto_vehicules WHERE soumission_id = ? AND cabinet_id = ?').get(sid, cabA).id;
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/vehicule/${vid}/garanties`, { form: { _csrf: csrf(r.texte), rc_montant: '2000000', protection_b: 'b1', franchise_b: '500', avenants: 'faq43' } });
  test('garanties → 302', r.statut === 302, r.statut);

  // ---- 3. Conversion -------------------------------------------------------------
  console.log('3. Conversion soumission → police');
  r = await req(jar, 'GET', '/auto/' + sid);
  test('fiche propose la conversion', r.statut === 200 && r.texte.includes('Convertir en police'), r.statut);
  r = await req(jar, 'POST', `/auto/${sid}/convertir`, { form: { numero_police: 'AUTO-001', assureur_id: String(ass1), date_echeance: dansNJours(20) } });
  test('conversion sans CSRF → 403', r.statut === 403, r.statut);
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'AUTO-001', assureur_id: String(ass1),
      date_effet: dansNJours(0), date_echeance: dansNJours(20), franchise: '250',
    },
  });
  test('conversion → 302', r.statut === 302, r.statut);
  const pid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche police', r.location === '/echeances/police/' + pid && pid > 0, r.location);
  const pol = bd.prepare('SELECT * FROM polices WHERE id = ?').get(pid);
  test('police ligne=auto', pol && pol.ligne === 'auto', pol && pol.ligne);
  test('police liée à la soumission', pol && pol.auto_soumission_id === sid, String(pol && pol.auto_soumission_id));
  test('version FPQ1 figée enregistrée', pol && pol.auto_soumission_version > 0, String(pol && pol.auto_soumission_version));
  test('soumission → convertie_police', bd.prepare('SELECT statut FROM auto_soumissions WHERE id = ?').get(sid).statut === 'convertie_police');
  test('police v1 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 1);
  test('audit police_creee', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_creee' AND details LIKE '%AUTO-001%'").get().n >= 1);

  // ---- 4. Fiche police auto : données figées ---------------------------------------
  console.log('4. Fiche police auto');
  r = await req(jar, 'GET', '/echeances/police/' + pid);
  test('fiche → 200', r.statut === 200, r.statut);
  test('section Données FPQ1', r.texte.includes('Données FPQ1'));
  test('conducteur figé affiché', r.texte.includes('Alice') && r.texte.includes('Martin'));
  test('VIN figé affiché', r.texte.includes('VIN-TEST-001'));
  test('lien attestation présent', r.texte.includes('/attestation/'));

  // ---- 5. Avenant en cours de terme -------------------------------------------------
  console.log('5. Avenant en cours de terme');
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/conducteur`, { form: { _csrf: csrf(r.texte), prenom: 'Bob', nom: 'Lévesque', numero_permis: 'L5678' } });
  test('ajout conducteur (avenant) → 302', r.statut === 302, r.statut);
  const nbVersions = bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n;
  test('police v2 créée', nbVersions === 2, 'versions=' + nbVersions);
  const v2 = bd.prepare('SELECT avenant_note FROM police_versions WHERE police_id = ? AND version = 2').get(pid);
  test('note d’avenant sur v2', v2 && /Avenant/.test(v2.avenant_note || ''), v2 && v2.avenant_note);
  r = await req(jar, 'GET', `/polices/${pid}/versions`);
  test('historique versions → 200', r.statut === 200, r.statut);
  test('note d’avenant visible', r.texte.includes('Avenant'));

  // ---- 6. Échéances ------------------------------------------------------------------
  console.log('6. Échéances');
  r = await req(jar, 'GET', '/echeances');
  test('tableau → 200', r.statut === 200, r.statut);
  test('police auto dans les échéances (J-30)', r.texte.includes('AUTO-001'));

  // ---- 7. Attestation -------------------------------------------------------------------
  console.log('7. Attestation');
  r = await req(jar, 'GET', `/polices/${pid}/attestation/${vid}`);
  test('attestation → 200', r.statut === 200, r.statut);
  test('contenu attestation', r.texte.includes('VIN-TEST-001') && r.texte.includes('AUTO-001') && /Attestation d’assurance/.test(r.texte));
  r = await req(jar, 'GET', `/polices/${pid}/attestation/99999`);
  test('attestation véhicule inexistant → 404', r.statut === 404, r.statut);
  // Police non-auto : pas d'attestation
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'cgl', assureur_id: String(ass1), numero_police: 'CGL-999', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidCgl = Number((r.location || '').split('/').pop());
  r = await req(jar, 'GET', `/polices/${pidCgl}/attestation/1`);
  test('attestation sur police non-auto → 404', r.statut === 404, r.statut);

  // ---- 8. Double conversion refusée ------------------------------------------------------
  console.log('8. Protections conversion');
  r = await req(jar, 'GET', '/auto/' + sid);
  r = await req(jar, 'POST', `/auto/${sid}/convertir`, { form: { _csrf: csrf(r.texte), numero_police: 'AUTO-002', assureur_id: String(ass1), date_effet: dansNJours(0), date_echeance: dansNJours(20) } });
  test('double conversion → 400', r.statut === 400, r.statut);

  // ---- 9. Lier une police existante ---------------------------------------------------------
  console.log('9. Liaison police existante');
  r = await req(jar, 'POST', '/auto', { form: { _csrf: csrf((await req(jar, 'GET', '/auto/nouveau')).texte), client_id: String(cli1) } });
  const sid2 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'auto', assureur_id: String(ass1), numero_police: 'AUTO-010', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidAuto = Number((r.location || '').split('/').pop());
  test('police auto manuelle créée', r.statut === 302 && pidAuto > 0, r.location);
  r = await req(jar, 'GET', '/auto/' + sid2);
  test('fiche propose la liaison', r.texte.includes('lier-police'));
  r = await req(jar, 'POST', `/auto/${sid2}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidAuto) } });
  test('liaison → 302', r.statut === 302, r.statut);
  test('police liée en base', bd.prepare('SELECT auto_soumission_id FROM polices WHERE id = ?').get(pidAuto).auto_soumission_id === sid2);
  test('soumission 2 convertie', bd.prepare('SELECT statut FROM auto_soumissions WHERE id = ?').get(sid2).statut === 'convertie_police');
  r = await req(jar, 'POST', '/auto', { form: { _csrf: csrf((await req(jar, 'GET', '/auto/nouveau')).texte), client_id: String(cli1) } });
  const sid3 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'GET', '/auto/' + sid3);
  r = await req(jar, 'POST', `/auto/${sid3}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidCgl) } });
  test('lier une police non-auto → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/auto/${sid3}/lier-police`, { form: { _csrf: csrf((await req(jar, 'GET', '/auto/' + sid3)).texte), police_id: String(pidAuto) } });
  test('lier une police déjà liée → 400', r.statut === 400, r.statut);

  // ---- 10. Cloisonnement inter-cabinets ----------------------------------------------------------
  console.log('10. Cloisonnement');
  const jb = await loginComme('adminb@t.ca', 'Test1234!');
  test('login admin B', jb.ok);
  r = await req(jb.jar, 'GET', '/echeances/police/' + pid);
  test('cabinet B : fiche police → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', '/auto/' + sid);
  test('cabinet B : soumission → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', `/polices/${pid}/attestation/${vid}`);
  test('cabinet B : attestation → 404', r.statut === 404, r.statut);

  // ---- 11. Portefeuille courtier ----------------------------------------------------------------------
  console.log('11. Portefeuille courtier');
  const jc1 = await loginComme('courtier1@t.ca', 'Test1234!');
  test('login courtier1', jc1.ok);
  r = await req(jc1.jar, 'GET', '/auto/' + sid);
  test('courtier1 : soumission hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(jc1.jar, 'POST', '/auto', { form: { _csrf: csrf((await req(jc1.jar, 'GET', '/auto/nouveau')).texte), client_id: String(cli2) } });
  const sidC = Number((r.location || '').split('/').pop());
  test('courtier1 crée soumission (son portefeuille) → 302', r.statut === 302, r.statut);
  r = await req(jc1.jar, 'GET', '/auto/' + sidC);
  r = await req(jc1.jar, 'POST', `/auto/${sidC}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'AUTO-C1', assureur_id: String(ass1),
      date_effet: dansNJours(0), date_echeance: dansNJours(20),
    },
  });
  test('courtier1 convertit → 302', r.statut === 302, r.statut);
  const jc2 = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jc2.jar, 'GET', '/auto/' + sidC);
  test('courtier2 : soumission d’autrui → 403', r.statut === 403, r.statut);

  // ---- 12. Audit --------------------------------------------------------------------------------------------
  console.log('12. Audit');
  test('audit versions police', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_version'").get().n >= 2);

  console.log(`\n${total - echecs}/${total} tests réussis`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
