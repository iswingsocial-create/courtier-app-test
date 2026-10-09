/**
 * scripts/test-droits-2026-10-09.js — Droits par rôle (admin / manager / courtier / expert en sinistre).
 *
 * Vérifie :
 *  1. Migration des rôles (manager, expert_sinistre acceptés).
 *  2. Manager : tout sauf /admin (403) et comptes courriels ; peut créer/modifier des dossiers.
 *  3. Courtier : ne voit que son portefeuille (liste + URL directe → 403) ;
 *     peut créer/modifier ses dossiers ; ne peut PAS changer le responsable (seul l'admin).
 *  4. Expert en sinistre : lecture partout ; écriture limitée aux réclamations.
 *  5. Menu Police du formulaire réclamation filtré par entreprise (correction du bug signalé).
 */
process.env.PORT = process.env.PORT || '3101';
const PORT = Number(process.env.PORT);

let reussis = 0, echoues = 0;
const details = [];
function test(nom, ok, info) {
  if (ok) { reussis++; console.log('  ✅ ' + nom); }
  else { echoues++; console.log('  ❌ ' + nom + (info ? ' — ' + info : '')); details.push(nom); }
}

const jar = {};
async function req(m, p, form) {
  const h = {};
  const cs = Object.entries(jar).map(([k, v]) => k + '=' + v);
  if (cs.length) h.Cookie = cs.join('; ');
  let b = null;
  if (form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; b = new URLSearchParams(form).toString(); }
  const res = await fetch('http://localhost:' + PORT + p, { method: m, headers: h, body: b, redirect: 'manual' });
  for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
    const [paire] = c.split(';'); const i = paire.indexOf('=');
    if (i > 0) jar[paire.slice(0, i).trim()] = paire.slice(i + 1).trim();
  }
  return { statut: res.status, texte: await res.text(), location: res.headers.get('location') };
}
const csrf = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
async function login(email, mdp) {
  for (const k of Object.keys(jar)) delete jar[k];
  let r = await req('GET', '/connexion');
  const jeton = csrf(r.texte);
  r = await req('POST', '/connexion', { _csrf: jeton, email, mot_de_passe: mdp });
  return r.statut === 302;
}

(async () => {
  console.log('== Droits par rôle (2026-10-09) ==');
  // Premier login : changement de mot de passe obligatoire
  for (const k of Object.keys(jar)) delete jar[k];
  let rl = await req('GET', '/connexion');
  rl = await req('POST', '/connexion', { _csrf: csrf(rl.texte), email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' });
  rl = await req('GET', '/mot-de-passe');
  rl = await req('POST', '/mot-de-passe', {
    _csrf: csrf(rl.texte), actuel: 'ChangeMoi123!',
    nouveau: 'DemoChange456!', confirmation: 'DemoChange456!',
  });
  test('login admin initial (déjà connecté après changement mdp)', rl.statut === 302, `${rl.statut}`);

  // --- Préparation : créer les utilisateurs de test ----------------------------------
  let r = await req('GET', '/admin/utilisateurs/nouveau');
  const creer = async (nom, email, role) => {
    let x = await req('GET', '/admin/utilisateurs/nouveau');
    x = await req('POST', '/admin/utilisateurs', {
      _csrf: csrf(x.texte), nom, email, role, cabinet_id: '1', mot_de_passe: 'TestDroits123!',
    });
    return x;
  };
  r = await creer('Manager Test', 'manager@test.ca', 'manager');
  test('création manager → 302', r.statut === 302, `${r.statut}`);
  r = await creer('Courtier Un', 'courtier1@test.ca', 'courtier');
  test('création courtier1 → 302', r.statut === 302, `${r.statut}`);
  r = await creer('Courtier Deux', 'courtier2@test.ca', 'courtier');
  test('création courtier2 → 302', r.statut === 302, `${r.statut}`);
  r = await creer('Expert Sinistre', 'expert@test.ca', 'expert_sinistre');
  test('création expert_sinistre → 302', r.statut === 302, `${r.statut}`);
  r = await creer('Refusé', 'refuse@test.ca', 'superadmin');
  test('rôle invalide refusé', r.statut === 400, `${r.statut}`);

  // Récupérer les ids des utilisateurs créés (lecture directe de la base de test)
  const Database = require('better-sqlite3');
  const bdTest = new Database(process.env.CHEMIN_BD || '/tmp/test-droits.db', { readonly: true });
  const ids = {};
  for (const u of bdTest.prepare("SELECT id, email FROM users WHERE email LIKE '%@test.ca'").all()) {
    ids[u.email] = String(u.id);
  }
  bdTest.close();
  test('ids utilisateurs récupérés', ids['courtier1@test.ca'] && ids['courtier2@test.ca'], JSON.stringify(ids));

  // Les comptes de test n'ont pas à changer leur mot de passe (évite des logins multiples)
  const bdW = new Database(process.env.CHEMIN_BD || '/tmp/test-droits.db');
  bdW.prepare("UPDATE users SET doit_changer_mot_de_passe = 0 WHERE email LIKE '%@test.ca'").run();
  bdW.close();

  // Créer 2 clients par courtier (en admin, avec responsable)
  const creerClient = async (raison, respId) => {
    let x = await req('GET', '/clients/nouveau');
    x = await req('POST', '/clients', {
      _csrf: csrf(x.texte), raison_sociale: raison, prenom: 'Contact', nom: 'Test',
      courriel: 'c@x.ca', langue: 'FR', responsable_id: respId, consent_communications: 'on',
    });
    return (x.location || '').match(/\/clients\/(\d+)/)?.[1];
  };
  const c1 = await creerClient('Client Un A inc.', ids['courtier1@test.ca']);
  const c2 = await creerClient('Client Un B inc.', ids['courtier1@test.ca']);
  const c3 = await creerClient('Client Deux A inc.', ids['courtier2@test.ca']);
  const c4 = await creerClient('Client Deux B inc.', ids['courtier2@test.ca']);
  test('4 clients créés avec responsables', !!(c1 && c2 && c3 && c4), [c1, c2, c3, c4].join(','));

  // Créer une police sur c1 (pour le test du menu réclamation)
  r = await req('GET', '/assureurs/nouveau');
  r = await req('POST', '/assureurs', { _csrf: csrf(r.texte), nom: 'Assureur Droits' });
  const idAss = (r.location || '').match(/\/assureurs\/(\d+)/)?.[1];
  r = await req('GET', '/polices/nouvelle');
  const jetonP = csrf(r.texte);
  r = await req('POST', '/polices', {
    _csrf: jetonP, client_id: c1, ligne: 'cgl', assureur_id: idAss,
    numero_police: 'CGL-DROITS-001', date_effet: '2026-01-01', date_echeance: '2027-01-01',
    franchise: '1000', statut: 'active',
  });
  const idPol1 = (r.location || '').match(/\/police\/(\d+)/)?.[1];
  test('police créée sur c1', r.statut === 302 && !!idPol1, `${r.statut}`);

  // --- Courtier 1 --------------------------------------------------------------------
  console.log('\n-- Courtier 1 --');
  test('login courtier1', await login('courtier1@test.ca', 'TestDroits123!'));
  r = await req('GET', '/clients');
  test('liste clients : voit ses 2 entreprises', r.statut === 200 && r.texte.includes('Client Un A') && r.texte.includes('Client Un B'), r.statut);
  test('liste clients : NE voit pas celles du courtier 2', !r.texte.includes('Client Deux A') && !r.texte.includes('Client Deux B'));
  r = await req('GET', '/clients/' + c3);
  test('URL directe vers client d’autrui → 403', r.statut === 403, `${r.statut}`);
  r = await req('GET', '/clients/' + c1);
  test('fiche de son client → 200', r.statut === 200, `${r.statut}`);

  // Création : le responsable est forcé à lui-même
  r = await req('GET', '/clients/nouveau');
  test('formulaire nouveau client : pas de menu responsable', !/name="responsable_id"/.test(r.texte));
  r = await req('POST', '/clients', {
    _csrf: csrf(r.texte), raison_sociale: 'Client Un C inc.', prenom: 'X', nom: 'Y',
    courriel: 'x@y.ca', langue: 'FR', responsable_id: ids['courtier2@test.ca'], consent_communications: 'on',
  });
  const c5 = (r.location || '').match(/\/clients\/(\d+)/)?.[1];
  test('création → 302', r.statut === 302, `${r.statut}`);
  await login('courtier2@test.ca', 'TestDroits123!');
  r = await req('GET', '/clients');
  test('responsable forcé à soi-même (courtier2 ne voit pas Client Un C)', !r.texte.includes('Client Un C'));
  test('login courtier1', await login('courtier1@test.ca', 'TestDroits123!'));
  r = await req('GET', '/clients');
  test('courtier1 voit son nouveau client', r.texte.includes('Client Un C'));

  // Modification : tenter de changer le responsable → ignoré (seul l'admin peut)
  r = await req('GET', '/clients/' + c1 + '/modifier');
  const jetonM = csrf(r.texte);
  r = await req('POST', '/clients/' + c1, {
    _csrf: jetonM, raison_sociale: 'Client Un A inc.', prenom: 'Contact', nom: 'Test',
    courriel: 'c@x.ca', langue: 'FR', responsable_id: ids['courtier2@test.ca'], consent_communications: 'on',
  });
  test('modification → 302', r.statut === 302, `${r.statut}`);
  r = await req('GET', '/clients');
  test('le responsable n’a pas changé (toujours ses 3 clients)', r.texte.includes('Client Un A') && r.texte.includes('Client Un C'));
  test('login courtier2', await login('courtier2@test.ca', 'TestDroits123!'));
  r = await req('GET', '/clients');
  test('courtier2 ne récupère pas le client (toujours 2)', !r.texte.includes('Client Un A'), 'portefeuille intact');

  // Tâche : menu police/réclamation filtré + serveur
  test('re-login courtier1', await login('courtier1@test.ca', 'TestDroits123!'));
  r = await req('GET', '/taches/nouvelle');
  test('menu entreprises (tâche) filtré', !r.texte.includes('Client Deux A'));

  // --- Bug réclamation : menu Police filtré par entreprise ----------------------------
  console.log('\n-- Bug réclamation (menu Police) --');
  test('re-login admin', await login('admin@demo.ca', 'DemoChange456!'));
  r = await req('GET', '/reclamations/nouvelle?client=' + c1);
  const optPolice = [...r.texte.matchAll(/<option value="(\d+)" data-client-id="(\d+)"/g)];
  test('options police portent data-client-id', optPolice.length > 0, optPolice.length);
  test('/filtre-client.js servi', (await req('GET', '/filtre-client.js')).statut === 200);
  // Serveur : police d'un autre client → 400
  r = await req('GET', '/polices/nouvelle');
  r = await req('POST', '/polices', {
    _csrf: csrf(r.texte), client_id: c3, ligne: 'cgl', assureur_id: idAss,
    numero_police: 'CGL-DROITS-002', date_effet: '2026-01-01', date_echeance: '2027-01-01',
    franchise: '1000', statut: 'active',
  });
  const idPol3 = (r.location || '').match(/\/police\/(\d+)/)?.[1];
  r = await req('GET', '/reclamations/nouvelle?client=' + c1);
  const jetonR = csrf(r.texte);
  r = await req('POST', '/reclamations', {
    _csrf: jetonR, client_id: c1, police_id: idPol3,
    date_sinistre: '2026-10-01', description: 'Test croisé',
  });
  test('police d’une autre entreprise → 400', r.statut === 400, `${r.statut}`);
  r = await req('POST', '/reclamations', {
    _csrf: jetonR, client_id: c1, police_id: idPol1,
    date_sinistre: '2026-10-01', description: 'Test valide',
  });
  test('police de la bonne entreprise → 302', r.statut === 302, `${r.statut} ${r.location}`);
  const idRec = (r.location || '').match(/\/reclamations\/(\d+)/)?.[1];

  // --- Expert en sinistre --------------------------------------------------------------
  console.log('\n-- Expert en sinistre --');
  test('login expert', await login('expert@test.ca', 'TestDroits123!'));
  r = await req('GET', '/clients');
  test('lecture clients → 200', r.statut === 200, `${r.statut}`);
  r = await req('GET', '/reclamations/' + idRec);
  test('lecture réclamation → 200', r.statut === 200, `${r.statut}`);
  r = await req('GET', '/reclamations/nouvelle');
  let jetonE = csrf(r.texte);
  r = await req('POST', '/reclamations', {
    _csrf: jetonE, client_id: c1, date_sinistre: '2026-10-02', description: 'Créée par expert',
  });
  test('création réclamation → 302 (autorisé)', r.statut === 302, `${r.statut}`);
  r = await req('GET', '/reclamations/' + idRec + '/modifier');
  jetonE = csrf(r.texte);
  r = await req('POST', '/reclamations/' + idRec, {
    _csrf: jetonE, date_sinistre: '2026-10-01', description: 'Modifiée par expert', statut: 'ouverte',
  });
  test('modification réclamation → 302 (autorisé)', r.statut === 302, `${r.statut}`);
  r = await req('GET', '/clients/nouveau');
  jetonE = csrf(r.texte);
  r = await req('POST', '/clients', {
    _csrf: jetonE, raison_sociale: 'Interdit inc.', prenom: 'X', nom: 'Y', courriel: 'x@y.ca', langue: 'FR',
  });
  test('création client → 403 (lecture seule)', r.statut === 403, `${r.statut}`);
  r = await req('GET', '/taches/nouvelle');
  jetonE = csrf(r.texte);
  r = await req('POST', '/taches', { _csrf: jetonE, titre: 'Interdit' });
  test('création tâche → 403 (lecture seule)', r.statut === 403, `${r.statut}`);
  r = await req('GET', '/admin/utilisateurs');
  test('/admin → 403 pour expert', r.statut === 403, `${r.statut}`);

  // --- Manager -----------------------------------------------------------------------------
  console.log('\n-- Manager --');
  test('login manager', await login('manager@test.ca', 'TestDroits123!'));
  r = await req('GET', '/admin/utilisateurs');
  test('/admin/utilisateurs → 403 pour manager', r.statut === 403, `${r.statut}`);
  r = await req('GET', '/courriels/comptes/nouveau');
  test('comptes courriels → 403 pour manager', r.statut === 403, `${r.statut}`);
  r = await req('GET', '/clients/nouveau');
  jetonE = csrf(r.texte);
  r = await req('POST', '/clients', {
    _csrf: jetonE, raison_sociale: 'Manager Client inc.', prenom: 'M', nom: 'G',
    courriel: 'm@g.ca', langue: 'FR', consent_communications: 'on',
  });
  const cM = (r.location || '').match(/\/clients\/(\d+)/)?.[1];
  test('manager crée un client → 302', r.statut === 302, `${r.statut}`);
  // Manager ne peut pas changer le responsable non plus (seul l'admin)
  r = await req('GET', '/clients/' + cM + '/modifier');
  test('manager : pas de menu responsable', !/name="responsable_id"/.test(r.texte));

  // --- Admin : peut tout -------------------------------------------------------------------
  console.log('\n-- Admin --');
  test('login admin final', await login('admin@demo.ca', 'DemoChange456!'));
  r = await req('GET', '/clients/' + c1 + '/modifier');
  const jetonA = csrf(r.texte);
  test('admin : menu responsable visible', /name="responsable_id"/.test(r.texte));
  r = await req('POST', '/clients/' + c1, {
    _csrf: jetonA, raison_sociale: 'Client Un A inc.', prenom: 'Contact', nom: 'Test',
    courriel: 'c@x.ca', langue: 'FR', responsable_id: ids['courtier2@test.ca'], consent_communications: 'on',
  });
  test('admin change le responsable → 302', r.statut === 302, `${r.statut}`);
  // Vérification directe en base (évite un login supplémentaire : limiteur de tentatives)
  const bdV = new Database(process.env.CHEMIN_BD || '/tmp/test-droits.db', { readonly: true });
  const c1b = bdV.prepare('SELECT responsable_id FROM clients WHERE id = ?').get(c1);
  bdV.close();
  test('courtier2 est maintenant responsable de Client Un A', String(c1b.responsable_id) === String(ids['courtier2@test.ca']), `responsable=${c1b.responsable_id}`);

  console.log(`\n=== ${reussis} réussis, ${echoues} échoués ===`);
  if (echoues) { console.log('Échecs :', details.join(' | ')); process.exit(1); }
  console.log('✅ TOUS LES TESTS DROITS RÉUSSIS');
})();
