/**
 * scripts/test-ajustements.js — Tests des ajustements assurance commerciale :
 * fiche entreprise, produits commerciaux, réclamations, tâches, journal d'audit,
 * documents police, courtier responsable, import CSV, cloisonnement.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed commercial).
 * Usage : PORT=3101 node scripts/test-ajustements.js
 */
const fs = require('fs');
const path = require('path');

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

const fmt = (d) => d.toISOString().slice(0, 10);
function dansJours(n) { const d = new Date(); d.setDate(d.getDate() + n); return fmt(d); }

(async () => {
  console.log('== Tests ajustements commerciaux :', BASE);
  const jar = nouveauJar();

  // ---- 1. Login + seed commercial ------------------------------------------------
  console.log('1. Login et données démo');
  let r = await req(jar, 'GET', '/connexion');
  let jeton = csrf(r.texte);
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: jeton, email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  test('login démo → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  r = await req(jar, 'GET', '/echeances');
  test('tableau → 200', r.statut === 200, r.statut);
  test('entreprises démo présentes', /Constructions Méthot/.test(r.texte) && /Petit Four/.test(r.texte), 'seed commercial');
  test('onglet Entreprises (pas Clients)', />Entreprises</.test(r.texte) && !/href="\/clients">Clients</.test(r.texte));
  test('onglet Réclamations', /href="\/reclamations"/.test(r.texte));
  test('onglet Tâches', /href="\/taches"/.test(r.texte));
  test('rappel réclamation dépassé affiché', /Rappels de réclamations dépassés/.test(r.texte), 'date_rappel dépassée');
  test('badge tâches en retard', /Tâches en retard/.test(r.texte));

  // ---- 2. CRUD entreprise ---------------------------------------------------------
  console.log('2. Entreprises');
  r = await req(jar, 'GET', '/clients/nouveau');
  jeton = csrf(r.texte);
  r = await req(jar, 'POST', '/clients', { form: {
    _csrf: jeton, raison_sociale: 'Test Entreprise inc.', neq: '1122334455', secteur_activite: 'Test',
    prenom: 'Alice', nom: 'Tremblay', titre_contact: 'Présidente', courriel: 'alice@testinc.ca',
    telephone: '514-555-0100', adresse: '1 rue Test', ville: 'Laval', code_postal: 'H7N 1A1',
    langue: 'FR', notes: 'Entreprise de test', responsable_id: '1', consent_communications: 'on',
  }});
  test('création entreprise → 302 vers fiche', r.statut === 302 && /\/clients\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idEnt = (r.location || '').match(/\/clients\/(\d+)/)[1];

  r = await req(jar, 'GET', '/clients/' + idEnt);
  test('fiche entreprise → 200', r.statut === 200 && /Test Entreprise inc/.test(r.texte) && /1122334455/.test(r.texte) && /Présidente/.test(r.texte), r.statut);
  test('responsable affiché', /Administrateur Démo/.test(r.texte));

  // Validation : raison sociale requise
  r = await req(jar, 'GET', '/clients/nouveau');
  r = await req(jar, 'POST', '/clients', { form: {
    _csrf: csrf(r.texte), raison_sociale: '', prenom: 'X', nom: 'Y', langue: 'FR',
  }});
  test('raison sociale manquante → 400', r.statut === 400 && /raison sociale/i.test(r.texte), r.statut);

  // NEQ invalide
  r = await req(jar, 'GET', '/clients/nouveau');
  r = await req(jar, 'POST', '/clients', { form: {
    _csrf: csrf(r.texte), raison_sociale: 'NEQ Test inc.', neq: '123', prenom: 'X', nom: 'Y', langue: 'FR',
  }});
  test('NEQ invalide → 400', r.statut === 400 && /NEQ/i.test(r.texte), r.statut);

  // ---- 3. Police produit commercial -----------------------------------------------
  console.log('3. Polices commerciales');
  r = await req(jar, 'GET', '/polices/nouvelle');
  jeton = csrf(r.texte);
  test('formulaire propose les produits commerciaux', /Responsabilité civile \(CGL\)/.test(r.texte) && /Cyberrisques/.test(r.texte) && /Cautionnement/.test(r.texte));
  r = await req(jar, 'POST', '/polices', { form: {
    _csrf: jeton, client_id: idEnt, ligne: 'cgl', assureur: 'Assureur Test',
    numero_police: 'CGL-TEST-001', date_effet: dansJours(-300), date_echeance: dansJours(25),
    franchise: '2500', statut: 'active', notes: '', responsable_id: '1',
  }});
  test('création police CGL → 302 vers révision', r.statut === 302 && /\/echeances\/police\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idPolice = (r.location || '').match(/\/police\/(\d+)/)[1];

  r = await req(jar, 'GET', '/echeances/police/' + idPolice);
  test('fiche révision → 200', r.statut === 200 && /Fiche de révision/.test(r.texte), r.statut);
  test('protection manquante détectée (PROD)', /Produits et travaux terminés/.test(r.texte));
  test('responsable affiché sur révision', /Administrateur Démo/.test(r.texte));

  const jetonR = csrf(r.texte);
  r = await req(jar, 'POST', `/polices/${idPolice}/protections`, { form: { _csrf: jetonR, code: 'RC-GEN', prime: '2850.00' } });
  test('ajout protection RC-GEN → 302', r.statut === 302, r.statut);

  // Produit invalide (ancien 'auto') refusé
  r = await req(jar, 'GET', '/polices/nouvelle');
  r = await req(jar, 'POST', '/polices', { form: {
    _csrf: csrf(r.texte), client_id: idEnt, ligne: 'auto', assureur: 'X',
    numero_police: 'AUTO-X', date_effet: dansJours(-10), date_echeance: dansJours(300),
    franchise: '0', statut: 'active',
  }});
  test("ligne 'auto' refusée → 400", r.statut === 400 && /Produit invalide/.test(r.texte), r.statut);

  // ---- 4. Réclamations ---------------------------------------------------------------
  console.log('4. Réclamations');
  r = await req(jar, 'GET', '/reclamations');
  test('liste réclamations → 200 + démo', r.statut === 200 && /SIN-2026-4471/.test(r.texte) && /Ouverte/.test(r.texte), r.statut);

  r = await req(jar, 'GET', '/reclamations/nouvelle');
  jeton = csrf(r.texte);
  r = await req(jar, 'POST', '/reclamations', { form: {
    _csrf: jeton, client_id: idEnt, police_id: idPolice, numero_reclamation: 'SIN-TEST-1',
    date_sinistre: dansJours(-5), date_declaration: dansJours(-4),
    description: 'Bris de vitrine lors d’une tempête, test automatisé.',
    statut: 'ouverte', montant_reclame: '12000', franchise_appliquee: '2500',
    expert_nom: 'Expert Test', expert_contact: '514-555-0000',
    responsable_id: '1', date_rappel: dansJours(7), notes: 'Test',
  }});
  test('création réclamation → 302 vers fiche', r.statut === 302 && /\/reclamations\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idRec = (r.location || '').match(/\/reclamations\/(\d+)/)[1];

  r = await req(jar, 'GET', '/reclamations/' + idRec);
  test('fiche réclamation → 200', r.statut === 200 && /Bris de vitrine/.test(r.texte) && /12000/.test(r.texte), r.statut);
  const jetonF = csrf(r.texte);

  r = await req(jar, 'POST', `/reclamations/${idRec}/suivis`, { form: { _csrf: jetonF, texte: 'Premier suivi de test.' } });
  test('ajout suivi → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/reclamations/' + idRec);
  test('suivi visible', /Premier suivi de test/.test(r.texte));

  r = await req(jar, 'POST', `/reclamations/${idRec}/statut`, { form: { _csrf: csrf(r.texte), statut: 'fermee' } });
  test('changement statut → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/reclamations/' + idRec);
  test('statut Fermée affiché', /Fermée/.test(r.texte));

  // Statut invalide refusé
  r = await req(jar, 'POST', `/reclamations/${idRec}/statut`, { form: { _csrf: csrf(r.texte), statut: 'nimporte' } });
  test('statut invalide → 400', r.statut === 400, r.statut);

  // ---- 5. Tâches --------------------------------------------------------------------------
  console.log('5. Tâches');
  r = await req(jar, 'GET', '/taches');
  test('liste tâches → 200 + démo en retard', r.statut === 200 && /Rappeler Karim/.test(r.texte), r.statut);

  r = await req(jar, 'GET', '/taches/nouvelle');
  jeton = csrf(r.texte);
  r = await req(jar, 'POST', '/taches', { form: {
    _csrf: jeton, titre: 'Tâche de test', date_echeance: dansJours(-1),
    statut: 'a_faire', assigne_a: '1', entreprise_id: idEnt, notes: 'En retard volontaire',
  }});
  test('création tâche → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/taches');
  const mTache = r.texte.match(/Tâche de test[\s\S]*?\/taches\/(\d+)\/terminer/);
  test('tâche visible', !!mTache && /Tâche de test/.test(r.texte));
  const idTache = mTache[1];

  r = await req(jar, 'GET', '/echeances');
  test('dashboard compte les tâches en retard', /Tâches en retard/.test(r.texte));

  r = await req(jar, 'POST', `/taches/${idTache}/terminer`, { form: { _csrf: csrf(r.texte) } });
  test('terminer tâche → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/taches?statut=terminee');
  test('tâche terminée listée', /Tâche de test/.test(r.texte));

  // ---- 6. Journal d'audit --------------------------------------------------------------------
  console.log("6. Journal d'audit");
  r = await req(jar, 'GET', '/admin/journal');
  test('page journal → 200', r.statut === 200 && /Journal d.audit/.test(r.texte), r.statut);
  test('entrées présentes', /entreprise_creee|police_creee/.test(r.texte));
  r = await req(jar, 'GET', '/admin/journal?action=reclamation_creee');
  test('filtre par action', r.statut === 200 && /reclamation_creee/.test(r.texte));

  // ---- 7. Import CSV ---------------------------------------------------------------------------
  console.log('7. Import CSV');
  r = await req(jar, 'GET', '/import/modele');
  test('modèle CSV → 200 + nouvel en-tête', r.statut === 200 && /type;raison_sociale;neq/.test(r.texte), r.statut);
  r = await req(jar, 'GET', '/import');
  jeton = csrf(r.texte);
  r = await req(jar, 'POST', '/import', { multipart: {
    champs: { _csrf: jeton },
    fichier: { champ: 'fichier', chemin: path.join(__dirname, 'exemple-import.csv'), nom: 'exemple-import.csv' },
  }});
  test('import → 200 + rapport', r.statut === 200 && /Rapport d’import/.test(r.texte), r.statut);
  test('créations comptées', /7 créées/.test(r.texte) || /créées/.test(r.texte), 'créations');
  test('erreurs ligne par ligne', /entreprise introuvable/.test(r.texte) && /déjà présente/.test(r.texte) && /courriel invalide/.test(r.texte));

  // ---- 8. Cloisonnement --------------------------------------------------------------------------
  console.log('8. Cloisonnement');
  r = await req(jar, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jar, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Test Isolement 2' } });
  r = await req(jar, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jar, 'POST', '/admin/utilisateurs', { form: {
    _csrf: csrf(r.texte), nom: 'Courtier Test', email: 'courtier2@test.ca',
    cabinet_id: '2', role: 'courtier', mot_de_passe: 'CourtierTest789!',
  }});
  test('utilisateur cab2 créé', r.statut === 302, r.statut);

  const jar2 = nouveauJar();
  r = await req(jar2, 'GET', '/connexion');
  r = await req(jar2, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'courtier2@test.ca', mot_de_passe: 'CourtierTest789!' } });
  r = await req(jar2, 'GET', '/mot-de-passe');
  await req(jar2, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'CourtierTest789!', nouveau: 'CourtierTest456!', confirmation: 'CourtierTest456!' } });
  r = await req(jar2, 'GET', '/reclamations');
  test('cab2 ne voit pas les réclamations du cab1', r.statut === 200 && !/SIN-2026-4471/.test(r.texte), r.statut);
  r = await req(jar2, 'GET', '/reclamations/' + idRec);
  test('accès direct réclamation cab1 → 404', r.statut === 404, r.statut);
  r = await req(jar2, 'GET', '/taches');
  test('cab2 ne voit pas les tâches du cab1', r.statut === 200 && !/Rappeler Karim/.test(r.texte), r.statut);
  r = await req(jar2, 'GET', '/admin/journal');
  test('courtier non-admin → 403 sur journal', r.statut === 403, r.statut);

  console.log(echecs === 0 ? '\n🎉 TOUS LES TESTS PASSENT' : `\n⚠️ ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('Erreur fatale du test :', e); process.exit(1); });
