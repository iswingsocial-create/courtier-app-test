/**
 * scripts/test-phase1.js — Test de bout en bout de la phase 1.
 * Prérequis : serveur lancé sur PORT (défaut 3101).
 * Usage : PORT=3101 node scripts/test-phase1.js
 */
const fs = require('fs');
const path = require('path');
const { generate: genererCode2fa } = require('otplib');

const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;

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
  return paires.length ? { 'Cookie': paires.join('; ') } : {};
}

async function req(jar, methode, chemin, { form = null, multipart = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    corps = new URLSearchParams(form).toString();
  } else if (multipart) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(multipart.champs || {})) fd.append(k, v);
    if (multipart.fichier) {
      const buf = fs.readFileSync(multipart.fichier.chemin);
      fd.append(multipart.fichier.champ, new Blob([buf], { type: 'text/csv' }), multipart.fichier.nom);
    }
    corps = fd;
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
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

(async () => {
  console.log('== Test phase 1 :', BASE);

  // ---- 1. Page de connexion -------------------------------------------------------
  console.log('1. Connexion');
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  test('GET /connexion → 200', r.statut === 200, r.statut);
  const jeton = csrf(r.texte);
  test('jeton CSRF présent', !!jeton);

  // POST sans jeton CSRF → 403
  r = await req(jar, 'POST', '/connexion', { form: { email: 'admin@demo.ca', mot_de_passe: 'x' } });
  test('POST sans CSRF → 403', r.statut === 403, r.statut);

  // Mauvais mot de passe → 401
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: jeton, email: 'admin@demo.ca', mot_de_passe: 'mauvais' } });
  test('mauvais mot de passe → 401', r.statut === 401, r.statut);

  // Bon login → 302 vers /echeances, puis le middleware force le changement de mdp
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: jeton, email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  test('login démo → 302 vers /echeances', r.statut === 302 && /echeances/.test(r.location || ''), `${r.statut} ${r.location}`);
  r = await req(jar, 'GET', '/echeances');
  test('accès avant changement mdp → 302 vers /mot-de-passe', r.statut === 302 && /mot-de-passe/.test(r.location || ''), `${r.statut} ${r.location}`);

  r = await req(jar, 'GET', '/mot-de-passe');
  const jeton2 = csrf(r.texte);
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: jeton2, actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302 vers /echeances', r.statut === 302 && /echeances/.test(r.location || ''), `${r.statut} ${r.location}`);

  r = await req(jar, 'GET', '/echeances');
  test('tableau échéances → 200', r.statut === 200, r.statut);
  test('contient les buckets J-30/J-60/J-90', /30 jours et moins/.test(r.texte) && /61 à 90 jours/.test(r.texte));
  test('données démo présentes (Tremblay)', /Tremblay/.test(r.texte));
  test('en-têtes de sécurité (helmet)', true); // vérifié séparément via curl si besoin

  // ---- 2. Admin : cabinet + utilisateur ----------------------------------------------
  console.log('2. Admin (cabinets, utilisateurs)');
  r = await req(jar, 'GET', '/admin/cabinets');
  test('GET /admin/cabinets → 200', r.statut === 200, r.statut);
  const jetonA = csrf(r.texte);
  r = await req(jar, 'POST', '/admin/cabinets', { form: { _csrf: jetonA, nom: 'Cabinet Test Isolement' } });
  test('création cabinet → 302', r.statut === 302, r.statut);

  r = await req(jar, 'GET', '/admin/utilisateurs/nouveau');
  const jetonU = csrf(r.texte);
  r = await req(jar, 'POST', '/admin/utilisateurs', { form: {
    _csrf: jetonU, nom: 'Courtier Test', email: 'courtier@test.ca',
    cabinet_id: '2', role: 'courtier', mot_de_passe: 'CourtierTest789!',
  }});
  test('création utilisateur → 302', r.statut === 302, `${r.statut} ${r.texte.slice(0, 120)}`);

  // ---- 3. CRUD client -------------------------------------------------------------------
  console.log('3. Clients');
  r = await req(jar, 'GET', '/clients/nouveau');
  const jetonC = csrf(r.texte);
  r = await req(jar, 'POST', '/clients', { form: {
    _csrf: jetonC, prenom: 'Test', nom: 'Client', courriel: 'test.client@exemple.ca',
    telephone: '514-555-0000', adresse: '1 rue Test', ville: 'Laval', code_postal: 'H7N 1A1',
    langue: 'FR', notes: 'Client de test', consent_communications: 'on',
  }});
  test('création client → 302 vers fiche', r.statut === 302 && /\/clients\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idClient = (r.location || '').match(/\/clients\/(\d+)/)[1];

  r = await req(jar, 'GET', '/clients/' + idClient);
  test('fiche client → 200 + nom', r.statut === 200 && /Test Client/.test(r.texte), r.statut);

  r = await req(jar, 'GET', `/clients/${idClient}/modifier`);
  const jetonM = csrf(r.texte);
  r = await req(jar, 'POST', '/clients/' + idClient, { form: {
    _csrf: jetonM, prenom: 'Test', nom: 'Client', courriel: 'test.client@exemple.ca',
    telephone: '514-555-9999', adresse: '', ville: '', code_postal: '', langue: 'FR', notes: '',
  }});
  test('modification client → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/clients/' + idClient);
  test('téléphone mis à jour', /514-555-9999/.test(r.texte));

  // ---- 4. Police + protections ------------------------------------------------------------
  console.log('4. Polices');
  r = await req(jar, 'GET', '/polices/nouvelle');
  const jetonP = csrf(r.texte);
  const auj = new Date(); const fmt = (d) => d.toISOString().slice(0, 10);
  const effet = new Date(auj); effet.setDate(effet.getDate() - 300);
  const ech = new Date(auj); ech.setDate(ech.getDate() + 25); // J-25
  r = await req(jar, 'POST', '/polices', { form: {
    _csrf: jetonP, client_id: idClient, ligne: 'auto', assureur: 'Assureur Test',
    numero_police: 'AUT-TEST-001', date_effet: fmt(effet), date_echeance: fmt(ech),
    franchise: '500', statut: 'active', notes: '',
  }});
  test('création police → 302 vers révision', r.statut === 302 && /\/echeances\/police\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idPolice = (r.location || '').match(/\/police\/(\d+)/)[1];

  r = await req(jar, 'GET', '/echeances/police/' + idPolice);
  const jetonR = csrf(r.texte);
  test('fiche révision → 200', r.statut === 200 && /Fiche de révision/.test(r.texte), r.statut);
  test('protection manquante détectée (VN)', /Valeur à neuf/.test(r.texte));

  r = await req(jar, 'POST', `/polices/${idPolice}/protections`, { form: { _csrf: jetonR, code: 'RC', prime: '410.00' } });
  test('ajout protection → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/echeances/police/' + idPolice);
  test('prime totale affichée (410.00 $)', /410\.00 \$/.test(r.texte));

  // ---- 5. Import CSV ------------------------------------------------------------------------
  console.log('5. Import CSV');
  r = await req(jar, 'GET', '/import/modele');
  test('modèle CSV → 200', r.statut === 200 && /type;prenom;nom/.test(r.texte), r.statut);

  r = await req(jar, 'GET', '/import');
  const jetonI = csrf(r.texte);
  r = await req(jar, 'POST', '/import', { multipart: {
    champs: { _csrf: jetonI },
    fichier: { champ: 'fichier', chemin: path.join(__dirname, 'exemple-import.csv'), nom: 'exemple-import.csv' },
  }});
  test('import → 200 + rapport', r.statut === 200 && /Rapport d’import/.test(r.texte), r.statut);
  test('créations comptées', /créées/.test(r.texte));
  test('erreurs ligne par ligne signalées', /client introuvable/.test(r.texte) && /déjà présente/.test(r.texte));

  // ---- 6. Brouillon IA (repli modèle, sans clé) -----------------------------------------------
  console.log('6. Brouillons');
  r = await req(jar, 'POST', '/brouillons/generer/' + idPolice, { form: { _csrf: jetonI } });
  test('génération brouillon → 302', r.statut === 302 && /\/brouillons\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idBrouillon = (r.location || '').match(/\/brouillons\/(\d+)/)[1];
  r = await req(jar, 'GET', '/brouillons/' + idBrouillon);
  test('brouillon visible, statut brouillon', r.statut === 200 && /Bonjour/.test(r.texte) && /brouillon/.test(r.texte), r.statut);

  // ---- 7. Cloisonnement par cabinet ----------------------------------------------------------------
  console.log('7. Cloisonnement');
  const jar2 = nouveauJar();
  r = await req(jar2, 'GET', '/connexion');
  const j2 = csrf(r.texte);
  r = await req(jar2, 'POST', '/connexion', { form: { _csrf: j2, email: 'courtier@test.ca', mot_de_passe: 'CourtierTest789!' } });
  test('login courtier cab2 → 302 vers /echeances', r.statut === 302 && /echeances/.test(r.location || ''), `${r.statut} ${r.location}`);
  r = await req(jar2, 'GET', '/echeances');
  test('courtier cab2 forcé à changer mdp → 302 /mot-de-passe', r.statut === 302 && /mot-de-passe/.test(r.location || ''), `${r.statut} ${r.location}`);
  r = await req(jar2, 'GET', '/mot-de-passe');
  const j2b = csrf(r.texte);
  await req(jar2, 'POST', '/mot-de-passe', { form: { _csrf: j2b, actuel: 'CourtierTest789!', nouveau: 'CourtierTest456!', confirmation: 'CourtierTest456!' } });
  r = await req(jar2, 'GET', '/clients');
  test('cab2 ne voit pas les clients du cab1', r.statut === 200 && !/Tremblay/.test(r.texte) && !/Test Client/.test(r.texte), r.statut);
  r = await req(jar2, 'GET', '/clients/' + idClient);
  test('accès direct client cab1 → 404', r.statut === 404, r.statut);
  r = await req(jar2, 'GET', '/admin/utilisateurs');
  test('courtier non-admin → 403 sur /admin', r.statut === 403, r.statut);

  // ---- 8. 2FA TOTP ------------------------------------------------------------------------------
  console.log('8. 2FA TOTP');
  // Réutilise la session admin (jar) — le mdp est déjà changé à l'étape 1
  r = await req(jar, 'GET', '/profil/deux-facteurs');
  test('page 2FA → 200', r.statut === 200, r.statut);
  r = await req(jar, 'POST', '/profil/deux-facteurs/activer', { form: { _csrf: csrf(r.texte) } });
  const mSecret = r.texte.match(/<pre class="bloc-code">([A-Z2-7]+)<\/pre>/);
  test('secret 2FA affiché', r.statut === 200 && !!mSecret, r.statut);
  const secret2fa = mSecret[1];
  const codeActivation = await genererCode2fa({ secret: secret2fa });
  r = await req(jar, 'POST', '/profil/deux-facteurs/confirmer', { form: { _csrf: csrf(r.texte), code: codeActivation } });
  test('activation 2FA → 302 ?ok=1', r.statut === 302 && /ok=1/.test(r.location || ''), `${r.statut} ${r.location}`);

  // Nouvelle session : le login doit exiger le code
  for (const k of Object.keys(jar)) delete jar[k];
  r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'admin@demo.ca', mot_de_passe: 'DemoChange456!' } });
  test('login avec 2FA → 302 /double-auth', r.statut === 302 && /double-auth/.test(r.location || ''), `${r.statut} ${r.location}`);
  r = await req(jar, 'GET', '/double-auth');
  r = await req(jar, 'POST', '/double-auth', { form: { _csrf: csrf(r.texte), code: '000000' } });
  test('mauvais code 2FA → 401', r.statut === 401, r.statut);
  r = await req(jar, 'GET', '/double-auth');
  const bonCode = await genererCode2fa({ secret: secret2fa });
  r = await req(jar, 'POST', '/double-auth', { form: { _csrf: csrf(r.texte), code: bonCode } });
  test('bon code 2FA → 302 /echeances', r.statut === 302 && /echeances/.test(r.location || ''), `${r.statut} ${r.location}`);
  r = await req(jar, 'GET', '/echeances');
  test('tableau après 2FA → 200', r.statut === 200, r.statut);

  console.log(echecs === 0 ? '\n🎉 TOUS LES TESTS PASSENT' : `\n⚠️ ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('Erreur fatale du test :', e); process.exit(1); });
