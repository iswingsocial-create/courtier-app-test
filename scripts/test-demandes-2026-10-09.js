/**
 * scripts/test-demandes-2026-10-09.js — Tests des demandes du 2026-10-09 :
 *  1. Bug tâche : menus Police/Réclamation filtrés par entreprise (JS + serveur)
 *  2. Fiche entreprise complète + contacts multiples
 *  3. Assistant IA (chat, commandes locales)
 *  4. Fiches assureurs + liaison polices + dossier client groupé
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed commercial).
 * Usage : PORT=3101 node scripts/test-demandes-2026-10-09.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
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
async function req(jar, methode, chemin, { form = null, json = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    corps = new URLSearchParams(form).toString();
  } else if (json) {
    entetes['Content-Type'] = 'application/json';
    corps = JSON.stringify(json);
  }
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  const texte = await res.text();
  let donnees = null;
  try { donnees = JSON.parse(texte); } catch (e) { /* pas du JSON */ }
  return { statut: res.status, texte, donnees, location: res.headers.get('location') };
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
  console.log('== Tests demandes 2026-10-09 :', BASE);
  const jar = nouveauJar();

  // ---- 0. Login ------------------------------------------------------------------
  console.log('0. Login');
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  test('login démo → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- Données de test : 2 entreprises, 1 assureur, 2 polices, 2 réclamations ----
  console.log('Données de test');
  async function creerEntreprise(rs) {
    r = await req(jar, 'GET', '/clients/nouveau');
    r = await req(jar, 'POST', '/clients', { form: { _csrf: csrf(r.texte), ...rs, langue: 'FR' } });
    return (r.location || '').match(/\/clients\/(\d+)/)[1];
  }
  const idA = await creerEntreprise({ raison_sociale: 'Alpha Test inc.', prenom: 'Al', nom: 'Pha', courriel: 'al@alpha.ca' });
  const idB = await creerEntreprise({ raison_sociale: 'Bêta Test inc.', prenom: 'Be', nom: 'Ta', courriel: 'be@beta.ca' });
  test('2 entreprises créées', !!idA && !!idB, `${idA} ${idB}`);

  r = await req(jar, 'GET', '/assureurs/nouveau');
  r = await req(jar, 'POST', '/assureurs', { form: { _csrf: csrf(r.texte), nom: 'Assureur Filtre' } });
  test('assureur créé → 302', r.statut === 302, `${r.statut} ${r.location}`);
  const idAss = (r.location || '').match(/\/assureurs\/(\d+)/)[1];

  async function creerPolice(clientId, numero) {
    r = await req(jar, 'GET', '/polices/nouvelle?client=' + clientId);
    r = await req(jar, 'POST', '/polices', { form: {
      _csrf: csrf(r.texte), client_id: clientId, ligne: 'cgl', assureur_id: idAss,
      numero_police: numero, date_effet: dansJours(-300), date_echeance: dansJours(60),
      franchise: '1000', statut: 'active',
    }});
    return (r.location || '').match(/\/police\/(\d+)/)[1];
  }
  const idPolA = await creerPolice(idA, 'POL-A-001');
  const idPolB = await creerPolice(idB, 'POL-B-001');
  test('2 polices créées (une par entreprise)', !!idPolA && !!idPolB, `${idPolA} ${idPolB}`);

  async function creerReclamation(clientId) {
    r = await req(jar, 'GET', '/reclamations/nouvelle?client=' + clientId);
    r = await req(jar, 'POST', '/reclamations', { form: {
      _csrf: csrf(r.texte), client_id: clientId, date_sinistre: dansJours(-10),
      description: 'Sinistre de test pour filtrage', statut: 'ouverte',
    }});
    return (r.location || '').match(/\/reclamations\/(\d+)/)[1];
  }
  const idRecA = await creerReclamation(idA);
  const idRecB = await creerReclamation(idB);
  test('2 réclamations créées (ouvertes)', !!idRecA && !!idRecB, `${idRecA} ${idRecB}`);

  // ---- 1. Bug tâche : filtrage par entreprise --------------------------------------
  console.log('1. Filtrage tâche par entreprise');
  r = await req(jar, 'GET', '/taches/nouvelle');
  test('formulaire tâche → 200', r.statut === 200, r.statut);
  test('options police portent data-client-id', new RegExp(`data-client-id="${idA}"`).test(r.texte));
  test('options réclamation portent data-client-id', new RegExp(`data-client-id="${idB}"`).test(r.texte));
  test('script de filtrage servi', /taches\.js/.test(r.texte));
  r = await req(jar, 'GET', '/taches.js');
  test('/taches.js → 200', r.statut === 200 && /data-filtre-client/.test(r.texte), r.statut);

  async function posterTache(entrepriseId, policeId, reclamationId) {
    r = await req(jar, 'GET', '/taches/nouvelle');
    return req(jar, 'POST', '/taches', { form: {
      _csrf: csrf(r.texte), titre: 'Tâche filtre', entreprise_id: entrepriseId,
      police_id: policeId || '', reclamation_id: reclamationId || '', statut: 'a_faire',
    }});
  }
  r = await posterTache(idA, idPolB, '');
  test('police d’une autre entreprise → 400', r.statut === 400 && /n’appartient pas/.test(r.texte), r.statut);
  r = await posterTache(idA, '', idRecB);
  test('réclamation d’une autre entreprise → 400', r.statut === 400 && /n’appartient pas/.test(r.texte), r.statut);
  r = await posterTache(idA, idPolA, idRecA);
  test('police + réclamation de la bonne entreprise → 302', r.statut === 302, r.statut);
  r = await posterTache('', idPolB, '');
  test('sans entreprise, police seule → 302 (pas de filtre croisé)', r.statut === 302, r.statut);

  // ---- 2. Fiche entreprise complète + contacts multiples ---------------------------
  console.log('2. Entreprise complète + contacts');
  r = await req(jar, 'GET', '/clients/nouveau');
  r = await req(jar, 'POST', '/clients', { form: {
    _csrf: csrf(r.texte), raison_sociale: 'Gamma Complète inc.', prenom: 'Ga', nom: 'Mma',
    courriel: 'ga@gamma.ca', langue: 'FR',
    courriel_entreprise: 'info@gamma.ca', telephone_entreprise: '514-555-7777',
    chiffre_affaires: '2500000', nb_employes: '42',
  }});
  test('création avec nouveaux champs → 302', r.statut === 302, `${r.statut} ${r.location}`);
  const idG = (r.location || '').match(/\/clients\/(\d+)/)[1];
  r = await req(jar, 'GET', '/clients/' + idG);
  test('fiche affiche courriel/tél entreprise', /info@gamma\.ca/.test(r.texte) && /514-555-7777/.test(r.texte));
  test('fiche affiche CA et employés', /2\s500\s000/.test(r.texte.replace(/[  ]/g, ' ')) && />42</.test(r.texte));
  test('contact principal migré (section Contacts)', /Ga Mma/.test(r.texte) && /Principal/.test(r.texte));

  r = await req(jar, 'POST', `/clients/${idG}/contacts`, { form: {
    _csrf: csrf(r.texte), prenom: 'Marie', nom: 'Tremblay', titre: 'Contrôleur',
    courriel: 'marie@gamma.ca', telephone: '514-555-8888',
  }});
  test('ajout 2e contact → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/clients/' + idG);
  test('2 contacts affichés', /Ga Mma/.test(r.texte) && /Marie Tremblay/.test(r.texte));
  const idContactMarie = (r.texte.match(/\/clients\/contacts\/(\d+)\/principal/) || [])[1];
  test('bouton « Définir principal » présent', !!idContactMarie);

  r = await req(jar, 'POST', `/clients/contacts/${idContactMarie}/principal`, { form: { _csrf: csrf(r.texte) } });
  test('Marie devient principale → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/clients/' + idG);
  const idContactGa = (r.texte.match(/\/clients\/contacts\/(\d+)\/principal/) || [])[1];
  test('Ga n’est plus principal', !!idContactGa);

  r = await req(jar, 'POST', `/clients/contacts/${idContactGa}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage contact non principal → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/clients/' + idG);
  r = await req(jar, 'POST', `/clients/contacts/${idContactMarie}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage du principal refusé → 400', r.statut === 400, r.statut);

  r = await req(jar, 'GET', '/clients/nouveau');
  r = await req(jar, 'POST', '/clients', { form: {
    _csrf: csrf(r.texte), raison_sociale: 'Delta Invalide inc.', prenom: 'De', nom: 'Lta',
    courriel: 'de@delta.ca', langue: 'FR', courriel_entreprise: 'pas-un-courriel', nb_employes: '-3',
  }});
  test('champs invalides → 400', r.statut === 400 && /Courriel de l’entreprise invalide/.test(r.texte), r.statut);

  // ---- 3. Assistant IA --------------------------------------------------------------
  console.log('3. Assistant IA');
  r = await req(jar, 'GET', '/assistant');
  test('page assistant → 200', r.statut === 200 && /Assistant IA/.test(r.texte), r.statut);
  test('moteur local affiché (tests)', /local \(tests\)/.test(r.texte));
  test('bouton micro présent', /btn-micro/.test(r.texte));
  r = await req(jar, 'GET', '/assistant.js');
  test('/assistant.js → 200', r.statut === 200 && /SpeechRecognition/.test(r.texte), r.statut);

  async function demander(message, avecCsrf = true) {
    let jeton = null;
    if (avecCsrf) { const p = await req(jar, 'GET', '/assistant'); jeton = csrf(p.texte); }
    return req(jar, 'POST', '/assistant/message', { json: { message, _csrf: jeton } });
  }
  r = await demander('ajoute le contact Luc Berger chez Gamma Complète, courriel luc@gamma.ca, téléphone 514-555-9999, titre directeur');
  test('assistant ajoute un contact', r.statut === 200 && /Luc Berger/.test(r.donnees.reponse) && /Gamma Complète/.test(r.donnees.reponse), r.statut);
  r = await req(jar, 'GET', '/clients/' + idG);
  test('contact Luc visible dans la fiche', /Luc Berger/.test(r.texte));

  r = await demander('crée une tâche appeler le comptable pour Gamma Complète pour le 2099-01-15');
  test('assistant crée une tâche', r.statut === 200 && /Tâche créée/.test(r.donnees.reponse) && /2099-01-15/.test(r.donnees.reponse), JSON.stringify(r.donnees));
  r = await req(jar, 'GET', '/taches');
  test('tâche visible dans la liste', /appeler le comptable/.test(r.texte));

  r = await demander('ajoute une note pour Gamma Complète : client rappelé, tout est beau');
  test('assistant ajoute une note', r.statut === 200 && /Note ajoutée/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  r = await demander('liste les tâches en retard');
  test('assistant liste les tâches', r.statut === 200 && /Tâches/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  r = await demander('ajoute le contact X chez Entreprise Inexistante ZZZ');
  test('entreprise inconnue → message clair', r.statut === 200 && /pas trouvé/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  r = await demander('raconte-moi une blague');
  test('demande inconnue → aide', r.statut === 200 && /ajoute le contact/.test(r.donnees.reponse), JSON.stringify(r.donnees));

  r = await demander('bonjour', false);
  test('sans CSRF → 403', r.statut === 403, r.statut);

  r = await req(jar, 'GET', '/assistant');
  test('historique affiché', /Luc Berger/.test(r.texte) && /appeler le comptable/.test(r.texte));

  // ---- 4. Assureurs ------------------------------------------------------------------
  console.log('4. Assureurs');
  r = await req(jar, 'GET', '/assureurs/nouveau');
  r = await req(jar, 'POST', '/assureurs', { form: {
    _csrf: csrf(r.texte), nom: 'Assureur Groupe Test',
    telephone_general: '514-555-1111', courriel_general: 'info@groupe-test.ca',
    na_nom: 'Nadia Affaires', na_telephone: '514-555-2222', na_courriel: 'nadia@groupe-test.ca',
    mod_nom: 'Marc Avenants', mod_telephone: '514-555-3333', mod_courriel: 'marc@groupe-test.ca',
    notes: 'Assureur de test',
  }});
  test('création assureur → 302 vers fiche', r.statut === 302 && /\/assureurs\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idAss2 = (r.location || '').match(/\/assureurs\/(\d+)/)[1];

  r = await req(jar, 'GET', '/assureurs');
  test('liste assureurs → 200 + nom', r.statut === 200 && /Assureur Groupe Test/.test(r.texte), r.statut);
  test('onglet Assureurs dans la nav', /href="\/assureurs">Assureurs/.test(r.texte));

  r = await req(jar, 'GET', '/assureurs/' + idAss2);
  test('fiche assureur → contacts NA + mod', r.statut === 200 && /Nadia Affaires/.test(r.texte) && /Marc Avenants/.test(r.texte), r.statut);

  r = await req(jar, 'GET', '/polices/nouvelle');
  test('formulaire police propose les fiches', new RegExp(`value="${idAss2}"[^>]*>Assureur Groupe Test`).test(r.texte));

  const idPolG = await creerPolice(idG, 'POL-G-001');
  r = await req(jar, 'GET', `/polices/${idPolG}/modifier`);
  r = await req(jar, 'POST', `/polices/${idPolG}`, { form: {
    _csrf: csrf(r.texte), client_id: idG, ligne: 'cgl', assureur_id: idAss2,
    numero_police: 'POL-G-001', date_effet: dansJours(-300), date_echeance: dansJours(60),
    franchise: '1000', statut: 'active',
  }});
  test('police réassignée à l’assureur → 302', r.statut === 302, r.statut);

  r = await req(jar, 'GET', '/clients/' + idG);
  test('dossier client groupé par assureur', /Polices par assureur/.test(r.texte) && /Assureur Groupe Test/.test(r.texte));
  test('contacts assureur visibles au dossier', /Nadia Affaires/.test(r.texte) && /Marc Avenants/.test(r.texte));

  r = await req(jar, 'GET', '/assureurs/' + idAss2);
  test('fiche assureur liste la police', /POL-G-001/.test(r.texte) && /Gamma Complète/.test(r.texte));

  r = await req(jar, 'POST', `/assureurs/${idAss2}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage avec police active refusé → 400', r.statut === 400 && /encore/.test(r.texte), r.statut);

  r = await req(jar, 'GET', `/assureurs/${idAss2}/modifier`);
  r = await req(jar, 'POST', `/assureurs/${idAss2}`, { form: { _csrf: csrf(r.texte), nom: 'Assureur Groupe Test Renommé' } });
  test('renommage assureur → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/echeances/police/' + idPolG);
  test('nom synchronisé sur la police', /Assureur Groupe Test Renommé/.test(r.texte));

  r = await req(jar, 'GET', '/assureurs/nouveau');
  r = await req(jar, 'POST', '/assureurs', { form: { _csrf: csrf(r.texte), nom: 'Assureur Groupe Test Renommé' } });
  test('doublon de nom refusé → 400', r.statut === 400 && /déjà/.test(r.texte), r.statut);

  // ---- 5. Migration texte libre → fiches (base pré-migration) -------------------------
  console.log('5. Migration assureurs (texte libre → fiches)');
  const tmpBd = path.join(os.tmpdir(), `migration-test-${Date.now()}.db`);
  {
    const Database = require('better-sqlite3');
    const vieux = new Database(tmpBd);
    vieux.exec(`
      CREATE TABLE cabinets (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL);
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, cabinet_id INTEGER NOT NULL, email TEXT NOT NULL UNIQUE, mot_de_passe_hash TEXT NOT NULL, nom TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'courtier', doit_changer_mdp INTEGER NOT NULL DEFAULT 1, actif INTEGER NOT NULL DEFAULT 1, totp_secret TEXT, cree_le TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, cabinet_id INTEGER NOT NULL, raison_sociale TEXT NOT NULL, neq TEXT, secteur_activite TEXT, prenom TEXT NOT NULL, nom TEXT NOT NULL, titre_contact TEXT, courriel TEXT, telephone TEXT, adresse TEXT, ville TEXT, code_postal TEXT, langue TEXT NOT NULL DEFAULT 'FR', notes TEXT, responsable_id INTEGER, archive INTEGER NOT NULL DEFAULT 0, cree_le TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE polices (id INTEGER PRIMARY KEY AUTOINCREMENT, cabinet_id INTEGER NOT NULL, client_id INTEGER NOT NULL, ligne TEXT NOT NULL, assureur TEXT, numero_police TEXT NOT NULL, date_effet TEXT, date_echeance TEXT, franchise REAL NOT NULL DEFAULT 0, statut TEXT NOT NULL DEFAULT 'active', notes TEXT, responsable_id INTEGER);
      INSERT INTO cabinets (nom) VALUES ('Vieux Cabinet');
      INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (1, 'Vieux Client inc.', 'Vi', 'Eux');
      INSERT INTO polices (cabinet_id, client_id, ligne, assureur, numero_police) VALUES
        (1, 1, 'cgl', 'Vieux Assureur ltée', 'VIEUX-001'),
        (1, 1, 'biens', 'Vieux Assureur ltée', 'VIEUX-002'),
        (1, 1, 'cyber', 'Autre Assureur inc.', 'VIEUX-003');
    `);
    vieux.close();
  }
  const verif = execFileSync('node', ['-e', `
    const bd = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'bd.js'))});
    const fiches = bd.prepare('SELECT id, nom FROM assureurs ORDER BY nom').all();
    const liees = bd.prepare('SELECT COUNT(*) AS n FROM polices WHERE assureur_id IS NOT NULL').get().n;
    console.log(JSON.stringify({ fiches: fiches.map(f => f.nom), liees }));
  `], { env: { ...process.env, CHEMIN_BD: tmpBd }, cwd: path.join(__dirname, '..') }).toString();
  fs.unlinkSync(tmpBd);
  const mig = JSON.parse(verif);
  test('2 fiches créées depuis le texte libre', mig.fiches.length === 2, JSON.stringify(mig.fiches));
  test('3 polices liées aux fiches', mig.liees === 3, JSON.stringify(mig));

  console.log(echecs === 0 ? '\n✅ TOUS LES TESTS RÉUSSIS' : `\n❌ ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
