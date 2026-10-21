/**
 * scripts/test-flotte-etape3.js — Gestion de la police flotte automobile
 * (étape 3/10 flotte) : conversion soumission → police (ligne 'flotte'),
 * fiche police avec données flotte figées (en-tête, véhicules, conducteurs,
 * garanties FAQ, antécédents), avenants FAQ usuels non souscrits signalés,
 * avenants en cours de terme (versions avec note), snapshot immuable,
 * liaison police existante, CSRF, cloisonnement inter-cabinets,
 * portefeuille courtier, audit, règle d'or statique.
 * Miroir de scripts/test-pe-etape3.js.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : CHEMIN_BD=/tmp/test-flotte3.db PORT=3101 node scripts/test-flotte-etape3.js
 * (CHEMIN_BD doit être le même sur le serveur et le script.)
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
// Les montants fr-CA utilisent des espaces insécables : on normalise avant les recherches.
function norm(t) { return String(t).replace(/[\u00a0\u202f]/g, ' '); }

(async () => {
  console.log('== Tests Flotte étape 3 (gestion police flotte) :', BASE);

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
    .run(cabA, 'Client Flotte Test inc.', 'Jean', 'Flotte').lastInsertRowid;
  const cli2 = bd.prepare('INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)')
    .run(cabA, 'Client Flotte Courtier inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
  const ass1 = bd.prepare('INSERT INTO assureurs (cabinet_id, nom) VALUES (?, ?)').run(cabA, 'Assureur Flotte').lastInsertRowid;
  bd.prepare('INSERT INTO assureur_produits (assureur_id, produit, commission_pct) VALUES (?, ?, ?)').run(ass1, 'flotte', 12);
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && cli1 > 0 && ass1 > 0);
  test('colonne flotte_soumission_id en base', bd.prepare('PRAGMA table_info(polices)').all().some((c) => c.name === 'flotte_soumission_id'));
  test('UNIQUE sur flotte_soumission_id', (bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get().sql || '').includes('UNIQUE (flotte_soumission_id)'));

  // ---- 1. Login admin démo ----------------------------------------------------
  console.log('1. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 2. Soumission complète via HTTP -----------------------------------------
  console.log('2. Soumission complète');
  const anneeCourante = new Date().getFullYear();
  r = await req(jar, 'POST', '/flotte', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/flotte/nouveau')).texte), client_id: String(cli1),
      nb_vehicules: '2', rayon_operation_km: '150', usage_dominant: 'livraison',
      date_effet_souhaitee: dansNJours(30), date_echeance_visee: dansNJours(395), notes: 'Test étape 3 flotte',
    },
  });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('id soumission valide', sid > 0, r.location);
  r = await req(jar, 'GET', '/flotte/' + sid);
  r = await req(jar, 'POST', `/flotte/${sid}/conducteur`, {
    form: {
      _csrf: csrf(r.texte), nom: 'Dupont', prenom: 'Alain', date_naissance: '1980-03-15',
      numero_permis: 'D123-150380-01', classe_permis: '3', annees_experience: '20', annees_experience_lourds: '12',
    },
  });
  test('ajout conducteur 1 → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/flotte/' + sid);
  r = await req(jar, 'POST', `/flotte/${sid}/conducteur`, {
    form: {
      _csrf: csrf(r.texte), nom: 'Roy', prenom: 'Nathalie', date_naissance: '1990-07-22',
      numero_permis: 'R987-220790-02', classe_permis: '5', annees_experience: '10',
    },
  });
  test('ajout conducteur 2 → 302', r.statut === 302, r.statut);
  const cond1 = bd.prepare('SELECT id FROM flotte_conducteurs WHERE soumission_id = ? AND cabinet_id = ? ORDER BY id').get(sid, cabA).id;
  test('conducteur en base', cond1 > 0);
  r = await req(jar, 'GET', '/flotte/' + sid);
  r = await req(jar, 'POST', `/flotte/${sid}/vehicule`, {
    form: {
      _csrf: csrf(r.texte), niv: '1FTNE1CM5SKA00001', annee: String(anneeCourante), marque: 'CamionNeuf',
      modele: 'TransitMax', type_vehicule: 'camion', usage: 'livraison', rayon_operation_km: '150',
      lieu_remisage: 'Laval', valeur: '95000', conducteur_principal_id: String(cond1),
    },
  });
  test('ajout véhicule 1 (camion récent) → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/flotte/' + sid);
  r = await req(jar, 'POST', `/flotte/${sid}/vehicule`, {
    form: {
      _csrf: csrf(r.texte), niv: '2T1BURHE8JC000002', annee: '2019', marque: 'AutoTest',
      modele: 'Sedan', type_vehicule: 'automobile', usage: 'service', valeur: '22000',
    },
  });
  test('ajout véhicule 2 → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/flotte/' + sid);
  r = await req(jar, 'POST', `/flotte/${sid}/garanties`, {
    form: {
      _csrf: csrf(r.texte), limite_rc: '2000000', franchise_collision: '1000',
      franchise_versement: '500', avenants: 'faq43', prime: '12500',
    },
  });
  test('garanties (FAQ43 seul) → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/flotte/' + sid);
  r = await req(jar, 'POST', `/flotte/${sid}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Ancien Assureur Flotte', annees_assurance_flotte_continue: '5',
      sinistres_flotte_5ans: '2023-05-14 | Collision arrière camionnette | 6800',
      consentement_dossier_saaq: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);

  // ---- 3. Conversion -------------------------------------------------------------
  console.log('3. Conversion soumission → police');
  r = await req(jar, 'GET', '/flotte/' + sid);
  test('fiche propose la conversion', r.statut === 200 && r.texte.includes('Convertir en police'), r.statut);
  r = await req(jar, 'POST', `/flotte/${sid}/convertir`, { form: { numero_police: 'FLT-001', assureur_id: String(ass1), date_echeance: dansNJours(395) } });
  test('conversion sans CSRF → 403', r.statut === 403, r.statut);
  r = await req(jar, 'GET', '/flotte/' + sid);
  r = await req(jar, 'POST', `/flotte/${sid}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'FLT-001', assureur_id: String(ass1),
      date_effet: dansNJours(30), date_echeance: dansNJours(395), franchise: '1000',
    },
  });
  test('conversion → 302', r.statut === 302, r.statut);
  const pid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche police', r.location === '/echeances/police/' + pid && pid > 0, r.location);
  const pol = bd.prepare('SELECT * FROM polices WHERE id = ?').get(pid);
  test('police ligne=flotte', pol && pol.ligne === 'flotte', pol && pol.ligne);
  test('police liée à la soumission', pol && pol.flotte_soumission_id === sid, String(pol && pol.flotte_soumission_id));
  test('version flotte figée enregistrée', pol && pol.flotte_soumission_version > 0, String(pol && pol.flotte_soumission_version));
  const versionFigeConv = pol ? pol.flotte_soumission_version : 0;
  test('soumission → convertie_police', bd.prepare('SELECT statut FROM flotte_soumissions WHERE id = ?').get(sid).statut === 'convertie_police');
  test('police v1 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 1);
  test('audit police_creee', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_creee' AND details LIKE '%FLT-001%'").get().n >= 1);
  test('audit conversion flotte', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'flotte_soumission_convertie'").get().n >= 1);

  // ---- 4. Fiche police flotte : données figées -------------------------------------
  console.log('4. Fiche police flotte');
  r = await req(jar, 'GET', '/echeances/police/' + pid);
  const fiche = norm(r.texte);
  test('fiche → 200', r.statut === 200, r.statut);
  test('section Données flotte automobile', fiche.includes('Données flotte automobile'));
  test('en-tête figé : nb véhicules', fiche.includes('Nombre de véhicules déclarés'));
  test('en-tête figé : rayon 150 km', fiche.includes('150 km'));
  test('en-tête figé : usage Livraison', fiche.includes('Livraison'));
  test('véhicule figé affiché', fiche.includes('CamionNeuf'));
  test('valeur figée affichée', fiche.includes('95 000 $'));
  test('conducteur figé affiché', fiche.includes('Dupont'));
  test('limite RC figée affichée', fiche.includes('2 000 000 $'));
  test('avenant FAQ 43 figé affiché', fiche.includes('FAQ 43 — Valeur à neuf'));
  test('sinistre flotte figé affiché', fiche.includes('Collision arrière'));
  test('lien voir le snapshot', fiche.includes('voir le snapshot'));
  test('alerte avenants FAQ non souscrits', fiche.includes('Avenants FAQ usuels non souscrits'));
  test('FAQ 34 manquant signalé (conducteurs)', fiche.includes('FAQ 34 — Indemnités d’accident'));
  test('FAQ 20 manquant signalé (privation de jouissance)', fiche.includes('FAQ 20 — Privation de jouissance'));
  test('FAQ 43 présent : pas signalé manquant', !fiche.includes('véhicule(s) récent(s) (camion/automobile) sans valeur à neuf'));

  // ---- 5. Avenant en cours de terme + snapshot immuable ------------------------------
  console.log('5. Avenant en cours de terme');
  r = await req(jar, 'GET', '/flotte/' + sid);
  r = await req(jar, 'POST', `/flotte/${sid}/vehicule`, {
    form: { _csrf: csrf(r.texte), marque: 'VehiculeAvenant', modele: 'AjoutTerme', type_vehicule: 'camion', usage: 'livraison', valeur: '48000' },
  });
  test('ajout véhicule (avenant) → 302', r.statut === 302, r.statut);
  const nbVersions = bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n;
  test('police v2 créée', nbVersions === 2, 'versions=' + nbVersions);
  const v2 = bd.prepare('SELECT avenant_note FROM police_versions WHERE police_id = ? AND version = 2').get(pid);
  test('note d’avenant sur v2', v2 && /Avenant/.test(v2.avenant_note || '') && /véhicule ajouté/.test(v2.avenant_note || ''), v2 && v2.avenant_note);
  r = await req(jar, 'GET', '/flotte/' + sid);
  r = await req(jar, 'POST', `/flotte/${sid}/garanties`, {
    form: {
      _csrf: csrf(r.texte), limite_rc: '3000000', franchise_collision: '1000',
      franchise_versement: '500', avenants: ['faq43', 'faq34'], prime: '13900',
    },
  });
  test('garanties modifiées (avenant) → 302', r.statut === 302, r.statut);
  test('police v3 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 3);
  const polApres = bd.prepare('SELECT * FROM polices WHERE id = ?').get(pid);
  test('version figée de la police inchangée', polApres.flotte_soumission_version === versionFigeConv,
    `${polApres.flotte_soumission_version} vs ${versionFigeConv}`);
  r = await req(jar, 'GET', '/echeances/police/' + pid);
  const ficheApres = norm(r.texte);
  test('snapshot : véhicule d’origine toujours affiché', ficheApres.includes('CamionNeuf'));
  test('snapshot : véhicule ajouté après conversion absent', !ficheApres.includes('VehiculeAvenant'));
  test('snapshot : limite RC d’origine conservée', ficheApres.includes('2 000 000 $') && !ficheApres.includes('3 000 000 $'));
  r = await req(jar, 'GET', `/polices/${pid}/versions`);
  test('historique versions → 200', r.statut === 200, r.statut);
  test('note d’avenant visible', r.texte.includes('Avenant'));

  // ---- 6. Double conversion refusée ------------------------------------------------
  console.log('6. Double conversion');
  r = await req(jar, 'GET', '/flotte/' + sid);
  r = await req(jar, 'POST', `/flotte/${sid}/convertir`, { form: { _csrf: csrf(r.texte), numero_police: 'FLT-002', assureur_id: String(ass1), date_effet: dansNJours(30), date_echeance: dansNJours(395) } });
  test('double conversion → 400', r.statut === 400, r.statut);

  // ---- 7. Lier une police existante --------------------------------------------------
  console.log('7. Liaison police existante');
  r = await req(jar, 'POST', '/flotte', { form: { _csrf: csrf((await req(jar, 'GET', '/flotte/nouveau')).texte), client_id: String(cli1) } });
  const sid2 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'flotte', assureur_id: String(ass1), numero_police: 'FLT-010', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidFlotte = Number((r.location || '').split('/').pop());
  test('police flotte manuelle créée', r.statut === 302 && pidFlotte > 0, r.location);
  r = await req(jar, 'GET', '/flotte/' + sid2);
  test('fiche propose la liaison', r.texte.includes('lier-police'));
  r = await req(jar, 'POST', `/flotte/${sid2}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidFlotte) } });
  test('liaison → 302', r.statut === 302, r.statut);
  test('police liée en base', bd.prepare('SELECT flotte_soumission_id FROM polices WHERE id = ?').get(pidFlotte).flotte_soumission_id === sid2);
  test('version figée enregistrée (liaison)', bd.prepare('SELECT flotte_soumission_version FROM polices WHERE id = ?').get(pidFlotte).flotte_soumission_version > 0);
  test('soumission 2 convertie', bd.prepare('SELECT statut FROM flotte_soumissions WHERE id = ?').get(sid2).statut === 'convertie_police');
  r = await req(jar, 'POST', '/flotte', { form: { _csrf: csrf((await req(jar, 'GET', '/flotte/nouveau')).texte), client_id: String(cli1) } });
  const sid3 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'eo', assureur_id: String(ass1), numero_police: 'EO-999', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidEo = Number((r.location || '').split('/').pop());
  r = await req(jar, 'GET', '/flotte/' + sid3);
  r = await req(jar, 'POST', `/flotte/${sid3}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidEo) } });
  test('lier une police non-flotte → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/flotte/${sid3}/lier-police`, { form: { _csrf: csrf((await req(jar, 'GET', '/flotte/' + sid3)).texte), police_id: String(pidFlotte) } });
  test('lier une police déjà liée → 400', r.statut === 400, r.statut);

  // ---- 8. Cloisonnement inter-cabinets -------------------------------------------------
  console.log('8. Cloisonnement');
  const jb = await loginComme('adminb@t.ca', 'Test1234!');
  test('login admin B', jb.ok);
  r = await req(jb.jar, 'GET', '/echeances/police/' + pid);
  test('cabinet B : fiche police → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', '/flotte/' + sid);
  test('cabinet B : soumission → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', '/flotte');
  const csrfB = csrf(r.texte);
  r = await req(jb.jar, 'POST', `/flotte/${sid}/convertir`, { form: { _csrf: csrfB, numero_police: 'X', assureur_id: '1', date_effet: dansNJours(0), date_echeance: dansNJours(20) } });
  test('cabinet B : conversion → 404', r.statut === 404, r.statut);

  // ---- 9. Portefeuille courtier -------------------------------------------------------------
  console.log('9. Portefeuille courtier');
  const jc1 = await loginComme('courtier1@t.ca', 'Test1234!');
  test('login courtier1', jc1.ok);
  r = await req(jc1.jar, 'GET', '/flotte/' + sid);
  test('courtier1 : soumission hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(jc1.jar, 'GET', '/echeances/police/' + pid);
  test('courtier1 : police hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(jc1.jar, 'POST', '/flotte', { form: { _csrf: csrf((await req(jc1.jar, 'GET', '/flotte/nouveau')).texte), client_id: String(cli2) } });
  const sidC = Number((r.location || '').split('/').pop());
  test('courtier1 crée soumission (son portefeuille) → 302', r.statut === 302, r.statut);
  r = await req(jc1.jar, 'GET', '/flotte/' + sidC);
  r = await req(jc1.jar, 'POST', `/flotte/${sidC}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'FLT-C1', assureur_id: String(ass1),
      date_effet: dansNJours(0), date_echeance: dansNJours(365),
    },
  });
  test('courtier1 convertit → 302', r.statut === 302, r.statut);
  const pidC = Number((r.location || '').split('/').pop());
  r = await req(jc1.jar, 'GET', '/echeances/police/' + pidC);
  test('courtier1 voit sa police → 200', r.statut === 200, r.statut);
  const jc2 = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jc2.jar, 'GET', '/flotte/' + sidC);
  test('courtier2 : soumission d’autrui → 403', r.statut === 403, r.statut);
  r = await req(jc2.jar, 'GET', '/echeances/police/' + pidC);
  test('courtier2 : police d’autrui → 403', r.statut === 403, r.statut);

  // ---- 10. Audit -----------------------------------------------------------------------------------
  console.log('10. Audit');
  test('audit versions police', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_version'").get().n >= 3);

  // ---- 11. Règle d'or : aucun DELETE, aucune route DELETE, aucun bouton « supprimer » ---------------
  console.log('11. Règle d’or');
  const fs = require('fs');
  const contenuRoute = fs.readFileSync('routes/flotte.js', 'utf8');
  test('aucun DELETE FROM flotte_* dans routes/flotte.js', !/DELETE\s+FROM\s+flotte_/i.test(contenuRoute));
  test('aucune route DELETE dans routes/flotte.js', !/router\.delete\s*\(/.test(contenuRoute));
  let aucunBoutonSupprimer = true;
  for (const f of ['views/flotte/fiche.ejs', 'views/echeances/revision.ejs']) {
    if (/supprimer/i.test(fs.readFileSync(f, 'utf8'))) { aucunBoutonSupprimer = false; console.log('  « supprimer » trouvé dans', f); }
  }
  test('aucun bouton « supprimer » dans les vues modifiées', aucunBoutonSupprimer);

  console.log(`\n${total - echecs}/${total} tests réussis`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
