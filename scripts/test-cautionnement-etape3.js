/**
 * scripts/test-cautionnement-etape3.js — Gestion de la police cautionnement
 * (étape 3/10 cautionnement) : conversion soumission → police (ligne
 * 'cautionnement'), fiche police avec données cautionnement figées (profil
 * du principal, obligations, ligne, antécédents), protections usuelles non
 * souscrites signalées, avenants en cours de terme (versions avec note),
 * snapshot immuable, liaison police existante, CSRF, cloisonnement
 * inter-cabinets, portefeuille courtier, audit, règle d'or statique.
 * Miroir de scripts/test-flotte-etape3.js.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : CHEMIN_BD=/tmp/test-caut3.db PORT=3101 node scripts/test-cautionnement-etape3.js
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
function norm(t) { return String(t).replace(/[  ]/g, ' '); }

(async () => {
  console.log('== Tests Cautionnement étape 3 (gestion police cautionnement) :', BASE);

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
    .run(cabA, 'Client Cautionnement Test inc.', 'Jean', 'Caut').lastInsertRowid;
  const cli2 = bd.prepare('INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)')
    .run(cabA, 'Client Caut Courtier inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
  const ass1 = bd.prepare('INSERT INTO assureurs (cabinet_id, nom) VALUES (?, ?)').run(cabA, 'Assureur Caution').lastInsertRowid;
  bd.prepare('INSERT INTO assureur_produits (assureur_id, produit, commission_pct) VALUES (?, ?, ?)').run(ass1, 'cautionnement', 12);
  test('préparation directe OK', cabB > 0 && courtier1 > 0 && cli1 > 0 && ass1 > 0);
  test('colonne caut_soumission_id en base', bd.prepare('PRAGMA table_info(polices)').all().some((c) => c.name === 'caut_soumission_id'));
  test('UNIQUE sur caut_soumission_id', (bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get().sql || '').includes('UNIQUE (caut_soumission_id)'));
  test('liens produits précédents préservés (auto/biens/rc/cyber/eo/do/pe/flotte)', (() => {
    const sql = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get().sql || '';
    return ['auto_soumission_id', 'biens_soumission_id', 'rc_soumission_id', 'cyber_soumission_id',
      'eo_soumission_id', 'do_soumission_id', 'pe_soumission_id', 'flotte_soumission_id']
      .every((c) => sql.includes(c));
  })());

  // ---- 1. Login admin démo ----------------------------------------------------
  console.log('1. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 2. Soumission complète via HTTP -----------------------------------------
  console.log('2. Soumission complète');
  r = await req(jar, 'POST', '/cautionnement', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/cautionnement/nouveau')).texte), client_id: String(cli1),
      assureur: 'Intact Cautionnement', secteur_activite: 'Construction — entrepreneur général',
      annee_fondation: '2010', chiffre_affaires: '6200000', nb_employes: '35',
      date_effet_souhaitee: dansNJours(30), date_echeance_visee: dansNJours(395), notes: 'Test étape 3 cautionnement',
    },
  });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('id soumission valide', sid > 0, r.location);
  const tok = async () => csrf((await req(jar, 'GET', '/cautionnement/' + sid)).texte);
  r = await req(jar, 'POST', `/cautionnement/${sid}/obligation`, {
    form: {
      _csrf: await tok(), type: 'soumission', beneficiaire: 'VilleTest Beneficiaire',
      description_projet: 'Cautionnement de soumission — aréna municipal',
      montant_contrat: '2000000', montant_cautionnement: '200000', prime_estimee: '300',
    },
  });
  test('ajout obligation soumission → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid}/obligation`, {
    form: {
      _csrf: await tok(), type: 'execution', beneficiaire: 'VilleTest Beneficiaire',
      description_projet: 'Construction aréna municipal',
      montant_contrat: '2000000', montant_cautionnement: '1000000', taux_pct: '1.1', prime_estimee: '11000',
    },
  });
  test('ajout obligation exécution → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid}/obligation`, {
    form: {
      _csrf: await tok(), type: 'rbq', beneficiaire: 'Régie du bâtiment du Québec (RBQ)',
      description_projet: 'Cautionnement de licence RBQ — entrepreneur général',
      montant_cautionnement: '40000', prime_estimee: '250',
    },
  });
  test('ajout obligation RBQ → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid}/garanties`, {
    form: {
      _csrf: await tok(), limite_globale: '5000000', limite_par_projet: '2500000',
      fonds_roulement: '700000', valeur_nette: '1600000', prime: '18000',
    },
  });
  test('ligne → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid}/antecedents`, {
    form: {
      _csrf: await tok(), assureur_actuel: 'Ancienne Caution', annees_cautionnement_continu: '5',
      reclamations_5ans: '2021-06-10 | Exécution — Ville X | 30000 | réglée',
      consentement_credit: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);

  // ---- 3. Conversion -------------------------------------------------------------
  console.log('3. Conversion soumission → police');
  r = await req(jar, 'GET', '/cautionnement/' + sid);
  test('fiche propose la conversion', r.statut === 200 && r.texte.includes('Convertir en police'), r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid}/convertir`, { form: { numero_police: 'CAUT-001', assureur_id: String(ass1), date_echeance: dansNJours(395) } });
  test('conversion sans CSRF → 403', r.statut === 403, r.statut);
  r = await req(jar, 'GET', '/cautionnement/' + sid);
  r = await req(jar, 'POST', `/cautionnement/${sid}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'CAUT-001', assureur_id: String(ass1),
      date_effet: dansNJours(30), date_echeance: dansNJours(395), franchise: '0',
    },
  });
  test('conversion → 302', r.statut === 302, r.statut);
  const pid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche police', r.location === '/echeances/police/' + pid && pid > 0, r.location);
  const pol = bd.prepare('SELECT * FROM polices WHERE id = ?').get(pid);
  test('police ligne=cautionnement', pol && pol.ligne === 'cautionnement', pol && pol.ligne);
  test('police liée à la soumission', pol && pol.caut_soumission_id === sid, String(pol && pol.caut_soumission_id));
  test('version cautionnement figée enregistrée', pol && pol.caut_soumission_version > 0, String(pol && pol.caut_soumission_version));
  const versionFigeConv = pol ? pol.caut_soumission_version : 0;
  test('soumission → convertie_police', bd.prepare('SELECT statut FROM caut_soumissions WHERE id = ?').get(sid).statut === 'convertie_police');
  test('police v1 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 1);
  test('audit police_creee', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_creee' AND details LIKE '%CAUT-001%'").get().n >= 1);
  test('audit conversion cautionnement', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'caut_soumission_convertie'").get().n >= 1);

  // ---- 4. Fiche police cautionnement : données figées -------------------------------------
  console.log('4. Fiche police cautionnement');
  r = await req(jar, 'GET', '/echeances/police/' + pid);
  const fiche = norm(r.texte);
  test('fiche → 200', r.statut === 200, r.statut);
  test('section Données cautionnement', fiche.includes('Données cautionnement'));
  test('profil figé : secteur', fiche.includes('entrepreneur général'));
  test('profil figé : CA 6 200 000 $', fiche.includes('6 200 000 $'));
  test('bénéficiaire figé affiché', fiche.includes('VilleTest Beneficiaire'));
  test('projet figé affiché', fiche.includes('Construction aréna municipal'));
  test('montant exécution figé (1 000 000 $)', fiche.includes('1 000 000 $'));
  test('limite globale figée affichée', fiche.includes('5 000 000 $'));
  test('limite par projet figée affichée', fiche.includes('2 500 000 $'));
  test('fonds de roulement figé affiché', fiche.includes('700 000 $'));
  test('réclamation figée affichée', fiche.includes('Ville X'));
  test('3 obligations figées', fiche.includes('cautionnements émis (3)'));
  test('lien voir le snapshot', fiche.includes('voir le snapshot'));
  test('alerte protections non souscrites', fiche.includes('Protections usuelles non souscrites'));
  test('CAUT-MO manquant signalé (exécution sans paiement M&O)', fiche.includes('Main-d’œuvre et matériaux'));
  test('CAUT-EXEC présent : pas signalé', !fiche.includes('Un cautionnement de soumission a été émis sans cautionnement d’exécution prévu'));

  // ---- 5. Avenant en cours de terme + snapshot immuable ------------------------------
  console.log('5. Avenant en cours de terme');
  r = await req(jar, 'POST', `/cautionnement/${sid}/obligation`, {
    form: {
      _csrf: await tok(), type: 'paiement_mo', beneficiaire: 'BeneficiaireAvenant',
      description_projet: 'Paiement de la main-d’œuvre et des matériaux — aréna',
      montant_contrat: '2000000', montant_cautionnement: '1000000', prime_estimee: '8000',
    },
  });
  test('ajout obligation (avenant) → 302', r.statut === 302, r.statut);
  const nbVersions = bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n;
  test('police v2 créée', nbVersions === 2, 'versions=' + nbVersions);
  const v2 = bd.prepare('SELECT avenant_note FROM police_versions WHERE police_id = ? AND version = 2').get(pid);
  test('note d’avenant sur v2', v2 && /Avenant/.test(v2.avenant_note || '') && /obligation ajoutée/.test(v2.avenant_note || ''), v2 && v2.avenant_note);
  r = await req(jar, 'POST', `/cautionnement/${sid}/garanties`, {
    form: {
      _csrf: await tok(), limite_globale: '7500000', limite_par_projet: '3000000',
      fonds_roulement: '820000', valeur_nette: '1750000', prime: '24000',
    },
  });
  test('ligne modifiée (avenant) → 302', r.statut === 302, r.statut);
  test('police v3 créée', bd.prepare('SELECT COUNT(*) n FROM police_versions WHERE police_id = ?').get(pid).n === 3);
  const polApres = bd.prepare('SELECT * FROM polices WHERE id = ?').get(pid);
  test('version figée de la police inchangée', polApres.caut_soumission_version === versionFigeConv,
    `${polApres.caut_soumission_version} vs ${versionFigeConv}`);
  r = await req(jar, 'GET', '/echeances/police/' + pid);
  const ficheApres = norm(r.texte);
  test('snapshot : bénéficiaire d’origine toujours affiché', ficheApres.includes('VilleTest Beneficiaire'));
  test('snapshot : toujours 3 obligations figées', ficheApres.includes('cautionnements émis (3)'));
  test('snapshot : limite globale d’origine conservée', ficheApres.includes('5 000 000 $') && !ficheApres.includes('7 500 000 $'));
  r = await req(jar, 'GET', `/polices/${pid}/versions`);
  test('historique versions → 200', r.statut === 200, r.statut);
  test('note d’avenant visible', r.texte.includes('Avenant'));

  // ---- 6. Double conversion refusée ------------------------------------------------
  console.log('6. Double conversion');
  r = await req(jar, 'GET', '/cautionnement/' + sid);
  r = await req(jar, 'POST', `/cautionnement/${sid}/convertir`, { form: { _csrf: csrf(r.texte), numero_police: 'CAUT-002', assureur_id: String(ass1), date_effet: dansNJours(30), date_echeance: dansNJours(395) } });
  test('double conversion → 400', r.statut === 400, r.statut);

  // ---- 7. Lier une police existante --------------------------------------------------
  console.log('7. Liaison police existante');
  r = await req(jar, 'POST', '/cautionnement', { form: { _csrf: csrf((await req(jar, 'GET', '/cautionnement/nouveau')).texte), client_id: String(cli1) } });
  const sid2 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'cautionnement', assureur_id: String(ass1), numero_police: 'CAUT-010', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidCaut = Number((r.location || '').split('/').pop());
  test('police cautionnement manuelle créée', r.statut === 302 && pidCaut > 0, r.location);
  r = await req(jar, 'GET', '/cautionnement/' + sid2);
  test('fiche propose la liaison', r.texte.includes('lier-police'));
  r = await req(jar, 'POST', `/cautionnement/${sid2}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidCaut) } });
  test('liaison → 302', r.statut === 302, r.statut);
  test('police liée en base', bd.prepare('SELECT caut_soumission_id FROM polices WHERE id = ?').get(pidCaut).caut_soumission_id === sid2);
  test('version figée enregistrée (liaison)', bd.prepare('SELECT caut_soumission_version FROM polices WHERE id = ?').get(pidCaut).caut_soumission_version > 0);
  test('soumission 2 convertie', bd.prepare('SELECT statut FROM caut_soumissions WHERE id = ?').get(sid2).statut === 'convertie_police');
  r = await req(jar, 'POST', '/cautionnement', { form: { _csrf: csrf((await req(jar, 'GET', '/cautionnement/nouveau')).texte), client_id: String(cli1) } });
  const sid3 = Number((r.location || '').split('/').pop());
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/polices/nouvelle')).texte), client_id: String(cli1),
      ligne: 'eo', assureur_id: String(ass1), numero_police: 'EO-999', date_effet: dansNJours(0),
      date_echeance: dansNJours(365), franchise: '0', statut: 'active',
    },
  });
  const pidEo = Number((r.location || '').split('/').pop());
  r = await req(jar, 'GET', '/cautionnement/' + sid3);
  r = await req(jar, 'POST', `/cautionnement/${sid3}/lier-police`, { form: { _csrf: csrf(r.texte), police_id: String(pidEo) } });
  test('lier une police non-cautionnement → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid3}/lier-police`, { form: { _csrf: csrf((await req(jar, 'GET', '/cautionnement/' + sid3)).texte), police_id: String(pidCaut) } });
  test('lier une police déjà liée → 400', r.statut === 400, r.statut);

  // ---- 8. Cloisonnement inter-cabinets -------------------------------------------------
  console.log('8. Cloisonnement');
  const jb = await loginComme('adminb@t.ca', 'Test1234!');
  test('login admin B', jb.ok);
  r = await req(jb.jar, 'GET', '/echeances/police/' + pid);
  test('cabinet B : fiche police → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', '/cautionnement/' + sid);
  test('cabinet B : soumission → 404', r.statut === 404, r.statut);
  r = await req(jb.jar, 'GET', '/cautionnement');
  const csrfB = csrf(r.texte);
  r = await req(jb.jar, 'POST', `/cautionnement/${sid}/convertir`, { form: { _csrf: csrfB, numero_police: 'X', assureur_id: '1', date_effet: dansNJours(0), date_echeance: dansNJours(20) } });
  test('cabinet B : conversion → 404', r.statut === 404, r.statut);

  // ---- 9. Portefeuille courtier -------------------------------------------------------------
  console.log('9. Portefeuille courtier');
  const jc1 = await loginComme('courtier1@t.ca', 'Test1234!');
  test('login courtier1', jc1.ok);
  r = await req(jc1.jar, 'GET', '/cautionnement/' + sid);
  test('courtier1 : soumission hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(jc1.jar, 'GET', '/echeances/police/' + pid);
  test('courtier1 : police hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(jc1.jar, 'POST', '/cautionnement', { form: { _csrf: csrf((await req(jc1.jar, 'GET', '/cautionnement/nouveau')).texte), client_id: String(cli2) } });
  const sidC = Number((r.location || '').split('/').pop());
  test('courtier1 crée soumission (son portefeuille) → 302', r.statut === 302, r.statut);
  r = await req(jc1.jar, 'GET', '/cautionnement/' + sidC);
  r = await req(jc1.jar, 'POST', `/cautionnement/${sidC}/convertir`, {
    form: {
      _csrf: csrf(r.texte), numero_police: 'CAUT-C1', assureur_id: String(ass1),
      date_effet: dansNJours(0), date_echeance: dansNJours(365),
    },
  });
  test('courtier1 convertit → 302', r.statut === 302, r.statut);
  const pidC = Number((r.location || '').split('/').pop());
  r = await req(jc1.jar, 'GET', '/echeances/police/' + pidC);
  test('courtier1 voit sa police → 200', r.statut === 200, r.statut);
  const jc2 = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jc2.jar, 'GET', '/cautionnement/' + sidC);
  test('courtier2 : soumission d’autrui → 403', r.statut === 403, r.statut);
  r = await req(jc2.jar, 'GET', '/echeances/police/' + pidC);
  test('courtier2 : police d’autrui → 403', r.statut === 403, r.statut);

  // ---- 10. Audit -----------------------------------------------------------------------------------
  console.log('10. Audit');
  test('audit versions police', bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'police_version'").get().n >= 3);

  // ---- 11. Règle d'or : aucun DELETE, aucune route DELETE, aucun bouton « supprimer » ---------------
  console.log('11. Règle d’or');
  const fs = require('fs');
  const contenuRoute = fs.readFileSync('routes/cautionnement.js', 'utf8');
  test('aucun DELETE FROM caut_* dans routes/cautionnement.js', !/DELETE\s+FROM\s+caut_/i.test(contenuRoute));
  test('aucune route DELETE dans routes/cautionnement.js', !/router\.delete\s*\(/.test(contenuRoute));
  let aucunBoutonSupprimer = true;
  for (const f of ['views/cautionnement/fiche.ejs', 'views/echeances/revision.ejs']) {
    if (/supprimer/i.test(fs.readFileSync(f, 'utf8'))) { aucunBoutonSupprimer = false; console.log('  « supprimer » trouvé dans', f); }
  }
  test('aucun bouton « supprimer » dans les vues modifiées', aucunBoutonSupprimer);

  console.log(`\n${total - echecs}/${total} tests réussis`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
