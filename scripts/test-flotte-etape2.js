/**
 * scripts/test-flotte-etape2.js — UI questionnaire flotte automobile
 * (étape 2/10 flotte) : onglet Flotte, création soumission (en-tête :
 * entreprise, nb de véhicules, rayon, usage dominant, dates visées),
 * véhicules illimités (NIV, type camion/automobile/remorque/équipement,
 * conducteur principal lié ou nom libre, équipements spéciaux),
 * conducteurs illimités (permis, classe, expérience, sinistres 5 ans,
 * infractions 3 ans, formations), garanties (limite RC, franchises
 * collision/versement, avenants FAQ43/20/27/34/5a), antécédents (sinistres
 * flotte 5 ans, refus/annulation, consentement dossier SAAQ), en-tête
 * modifiable, versions, statuts, archivage, CSRF, cloisonnement
 * inter-cabinets, portefeuille courtier, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : CHEMIN_BD=/tmp/test-flotte2.db PORT=3101 node scripts/test-flotte-etape2.js
 * (CHEMIN_BD doit être le même sur le serveur et le script.)
 * Miroir de scripts/test-pe-etape2.js.
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
function nbVersions(sid) {
  return bd.prepare('SELECT COUNT(*) AS n FROM flotte_soumission_versions WHERE soumission_id = ?').get(sid).n;
}

(async () => {
  console.log('== Tests Flotte étape 2 (UI) :', BASE);

  // ---- Préparation directe : 2e cabinet, courtiers, clients -----------------
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const cabB = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet B').lastInsertRowid;
  const hash = bcrypt.hashSync('Test123456!', 4);
  const adminB = bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)"
  ).run(cabB, 'adminb@t.ca', hash, 'Admin B').lastInsertRowid;
  const courtier1 = bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)"
  ).run(cabA, 'courtier1@t.ca', hash, 'Courtier Un').lastInsertRowid;
  const courtier2 = bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)"
  ).run(cabA, 'courtier2@t.ca', hash, 'Courtier Deux').lastInsertRowid;
  const cli1 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)'
  ).run(cabA, 'Client Flotte inc.', 'Jean', 'Flotte').lastInsertRowid;
  const cli2 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Autre Flotte inc.', 'Marie', 'Autre', courtier2).lastInsertRowid;
  const cli3 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Courtier Flotte inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
  test('préparation directe OK', adminB > 0 && courtier1 > 0 && cli1 > 0);

  // ---- 1. Login admin démo --------------------------------------------------
  console.log('1. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 2. Onglet + création -------------------------------------------------
  console.log('2. Liste et création');
  r = await req(jar, 'GET', '/flotte');
  test('GET /flotte → 200', r.statut === 200, r.statut);
  test('onglet Flotte dans la navigation', /href="\/flotte">Flotte</.test(r.texte));
  test('onglet Flotte après Perte d’exploitation', r.texte.indexOf('href="/pe"') < r.texte.indexOf('href="/flotte"'));
  test('colonnes Véhicules et Conducteurs', r.texte.includes('Véhicules') && r.texte.includes('Conducteurs'));
  test('seed flotte visible (Transport Lapointe)', r.texte.includes('Transport Lapointe inc.'));
  r = await req(jar, 'GET', '/flotte/nouveau');
  test('GET /flotte/nouveau → 200', r.statut === 200, r.statut);
  test('formulaire propose les entreprises', r.texte.includes('Client Flotte inc.'));
  test('formulaire propose l’usage dominant', r.texte.includes('Transport de marchandises'));
  r = await req(jar, 'POST', '/flotte', { form: { _csrf: csrf((await req(jar, 'GET', '/flotte/nouveau')).texte) } });
  test('création sans client → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/flotte', { form: { _csrf: csrf((await req(jar, 'GET', '/flotte/nouveau')).texte), client_id: '99999' } });
  test('création client invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/flotte', { form: { _csrf: csrf((await req(jar, 'GET', '/flotte/nouveau')).texte), client_id: String(cli1), date_effet_souhaitee: 'pas-une-date' } });
  test('création date invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/flotte', { form: { _csrf: csrf((await req(jar, 'GET', '/flotte/nouveau')).texte), client_id: String(cli1), usage_dominant: 'course' } });
  test('création usage dominant invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/flotte', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/flotte/nouveau')).texte),
      client_id: String(cli1), assureur: 'Intact Assurance', nb_vehicules: '4',
      rayon_operation_km: '160', usage_dominant: 'livraison',
      date_effet_souhaitee: '2026-12-01', date_echeance_visee: '2027-12-01', notes: 'Test UI flotte',
    },
  });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche', r.location === '/flotte/' + sid && sid > 0, r.location);
  test('v1 créée', nbVersions(sid) === 1, nbVersions(sid));
  const enteteDb = bd.prepare('SELECT * FROM flotte_soumissions WHERE id = ?').get(sid);
  test('en-tête stocké (nb véhicules, rayon, usage, dates)',
    enteteDb.nb_vehicules === 4 && enteteDb.rayon_operation_km === 160
    && enteteDb.usage_dominant === 'livraison' && enteteDb.date_echeance_visee === '2027-12-01');

  // ---- 3. Fiche : sections ----------------------------------------------------
  console.log('3. Fiche soumission');
  r = await req(jar, 'GET', '/flotte/' + sid);
  test('fiche → 200', r.statut === 200, r.statut);
  for (const s of ['Véhicules', 'Conducteurs', 'Garanties', 'Antécédents', 'Historique des versions']) {
    test('section « ' + s + ' » présente', r.texte.includes(s));
  }
  test('avenants FAQ proposés', r.texte.includes('FAQ 43 — Valeur à neuf') && r.texte.includes('FAQ 5a — Crédit-bail'));
  test('consentement dossier SAAQ proposé', r.texte.includes('Dossier SAAQ'));

  const tok = async () => csrf((await req(jar, 'GET', '/flotte/' + sid)).texte);

  // ---- 4. Conducteurs ------------------------------------------------------------
  console.log('4. Conducteurs');
  r = await req(jar, 'POST', `/flotte/${sid}/conducteur`, { form: { _csrf: await tok(), prenom: 'SansNom' } });
  test('conducteur sans nom → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/flotte/${sid}/conducteur`, {
    form: {
      _csrf: await tok(), prenom: 'Jean-François', nom: 'Lapointe', date_naissance: '1978-04-12',
      numero_permis: 'L152-040478-01', classe_permis: '3', annees_experience: '24',
      annees_experience_lourds: '18', date_embauche: '2009-06-01',
      formations: 'Conduite préventive | 2024-05-10 | Centre de formation en transport',
    },
  });
  test('ajout conducteur 1 → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/flotte/${sid}/conducteur`, {
    form: {
      _csrf: await tok(), prenom: 'Marc', nom: 'Gagnon', date_naissance: '1985-09-23',
      numero_permis: 'G556-230985-02', classe_permis: '3', annees_experience: '15',
      annees_experience_lourds: '11', date_embauche: '2016-03-14',
      sinistres_5ans: '2023-07-19 | Accrochage en reculant dans une cour de livraison | 4200 | partagee',
      infractions_3ans: '2024-02-02 | Excès de vitesse | 20 km/h en zone urbaine | 3',
    },
  });
  test('ajout conducteur 2 → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/flotte/${sid}/conducteur`, {
    form: {
      _csrf: await tok(), prenom: 'Sophie', nom: 'Tremblay', age: '34',
      numero_permis: 'T621-300192-03', classe_permis: '5', annees_experience: '9',
      annees_experience_lourds: '0', date_embauche: '2021-08-23',
    },
  });
  test('ajout conducteur 3 → 302', r.statut === 302, r.statut);
  const conds = bd.prepare('SELECT * FROM flotte_conducteurs WHERE soumission_id = ? AND archive = 0 ORDER BY id').all(sid);
  test('3 conducteurs en base', conds.length === 3, conds.length);
  const cid1 = conds[0].id;
  const cid2 = conds[1].id;
  const cid3 = conds[2].id;
  test('versions créées après les ajouts', nbVersions(sid) === 4, nbVersions(sid));
  const sinC = JSON.parse(conds[1].sinistres_5ans);
  const infC = JSON.parse(conds[1].infractions_3ans);
  const formC = JSON.parse(conds[0].formations);
  test('sinistre conducteur parsé (date, montant nombre, responsabilité)',
    sinC.length === 1 && sinC[0].date === '2023-07-19' && sinC[0].montant === 4200 && sinC[0].responsabilite === 'partagee');
  test('infraction conducteur parsée (type, points nombre)',
    infC.length === 1 && infC[0].type === 'Excès de vitesse' && infC[0].points === 3);
  test('formation conducteur parsée', formC.length === 1 && formC[0].formation === 'Conduite préventive');
  test('âge déclaré stocké (conducteur 3)', conds[2].age === 34);
  r = await req(jar, 'GET', '/flotte/' + sid);
  test('conducteurs visibles sur la fiche', r.texte.includes('Jean-François') && r.texte.includes('Gagnon') && r.texte.includes('Tremblay'));
  test('classe de permis affichée', r.texte.includes('Classe 3'));
  // modification
  r = await req(jar, 'POST', `/flotte/conducteur/${cid2}`, {
    form: {
      _csrf: await tok(), prenom: 'Marc', nom: 'Gagnon', date_naissance: '1985-09-23',
      numero_permis: 'G556-230985-02', classe_permis: '3', annees_experience: '16',
      annees_experience_lourds: '11', date_embauche: '2016-03-14',
      sinistres_5ans: '2023-07-19 | Accrochage en reculant dans une cour de livraison | 4200 | partagee',
      infractions_3ans: '2024-02-02 | Excès de vitesse | 20 km/h en zone urbaine | 3',
    },
  });
  test('modification conducteur → 302', r.statut === 302, r.statut);
  test('expérience modifiée en base', bd.prepare('SELECT annees_experience FROM flotte_conducteurs WHERE id = ?').get(cid2).annees_experience === 16);
  test('version créée après modification conducteur', nbVersions(sid) === 5, nbVersions(sid));
  // conducteur inexistant
  r = await req(jar, 'POST', '/flotte/conducteur/999999', {
    form: { _csrf: await tok(), prenom: 'X', nom: 'Y' },
  });
  test('modification conducteur inexistant → 404', r.statut === 404, r.statut);
  // archivage / désarchivage
  r = await req(jar, 'POST', `/flotte/conducteur/${cid3}/archiver`, { form: { _csrf: await tok() } });
  test('archivage conducteur → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/flotte/' + sid);
  test('conducteur archivé listé dans les archivés', r.texte.includes('Archivés'));
  r = await req(jar, 'POST', `/flotte/conducteur/${cid3}/desarchiver`, { form: { _csrf: await tok() } });
  test('désarchivage conducteur → 302', r.statut === 302, r.statut);
  test('conducteur restauré', bd.prepare('SELECT archive FROM flotte_conducteurs WHERE id = ?').get(cid3).archive === 0);

  // ---- 5. Véhicules ------------------------------------------------------------
  console.log('5. Véhicules');
  r = await req(jar, 'POST', `/flotte/${sid}/vehicule`, {
    form: { _csrf: await tok(), marque: 'Test', type_vehicule: 'avion' },
  });
  test('véhicule type invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/flotte/${sid}/vehicule`, {
    form: {
      _csrf: await tok(), niv: '1FTBW3CM5KKB12345', annee: '2022', marque: 'Ford', modele: 'Transit 250',
      type_vehicule: 'camion', usage: 'livraison', rayon_operation_km: '160',
      lieu_remisage: '2450 boulevard Industriel, Laval', valeur: '62000', annee_acquisition: '2022',
      conducteur_principal_id: String(cid1), equipements_speciaux: 'Hayon élévateur | 6500',
    },
  });
  test('ajout véhicule 1 (camion) → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/flotte/${sid}/vehicule`, {
    form: {
      _csrf: await tok(), niv: '3C6TRVBG8ME512340', annee: '2021', marque: 'Ram', modele: 'ProMaster 3500',
      type_vehicule: 'camion', usage: 'livraison', rayon_operation_km: '200',
      lieu_remisage: '2450 boulevard Industriel, Laval', valeur: '54000', annee_acquisition: '2021',
      conducteur_principal_id: String(cid2), equipements_speciaux: 'Compartiment réfrigéré | 12000',
    },
  });
  test('ajout véhicule 2 (camion) → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/flotte/${sid}/vehicule`, {
    form: {
      _csrf: await tok(), niv: '2T1BURHE8JC045678', annee: '2020', marque: 'Toyota', modele: 'Corolla',
      type_vehicule: 'automobile', usage: 'service', rayon_operation_km: '100',
      lieu_remisage: '2450 boulevard Industriel, Laval', valeur: '18500', annee_acquisition: '2020',
      conducteur_principal_id: String(cid3),
    },
  });
  test('ajout véhicule 3 (automobile) → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/flotte/${sid}/vehicule`, {
    form: {
      _csrf: await tok(), niv: '1T9UT2825NA334455', annee: '2019', marque: 'Manac', modele: 'Remorque fermée 28 pi',
      type_vehicule: 'remorque', usage: 'transport_marchandises', rayon_operation_km: '160',
      lieu_remisage: '2450 boulevard Industriel, Laval', valeur: '21000', annee_acquisition: '2019',
      conducteur_principal_nom: 'Selon affectation',
    },
  });
  test('ajout véhicule 4 (remorque) → 302', r.statut === 302, r.statut);
  const vehs = bd.prepare('SELECT * FROM flotte_vehicules WHERE soumission_id = ? AND archive = 0 ORDER BY id').all(sid);
  test('4 véhicules en base', vehs.length === 4, vehs.length);
  test('dont une remorque', vehs.filter((v) => v.type_vehicule === 'remorque').length === 1);
  const vid1 = vehs[0].id;
  const vid4 = vehs[3].id;
  test('conducteur principal lié par id', vehs[0].conducteur_principal_id === cid1);
  test('conducteur principal en nom libre (remorque)', vehs[3].conducteur_principal_nom === 'Selon affectation');
  test('équipements spéciaux parsés', JSON.parse(vehs[0].equipements_speciaux)[0].description === 'Hayon élévateur'
    && JSON.parse(vehs[0].equipements_speciaux)[0].valeur === 6500);
  r = await req(jar, 'GET', '/flotte/' + sid);
  test('véhicules visibles sur la fiche', r.texte.includes('Transit 250') && r.texte.includes('Remorque fermée 28 pi'));
  test('NIV affiché', r.texte.includes('1FTBW3CM5KKB12345'));
  test('conducteur principal affiché par son nom', r.texte.includes('Jean-François Lapointe'));
  // valeur négative
  r = await req(jar, 'POST', `/flotte/${sid}/vehicule`, {
    form: { _csrf: await tok(), marque: 'Mauvais', valeur: '-100' },
  });
  test('valeur négative → 400', r.statut === 400, r.statut);
  // modification
  const vAvantVeh = nbVersions(sid);
  r = await req(jar, 'POST', `/flotte/vehicule/${vid1}`, {
    form: {
      _csrf: await tok(), niv: '1FTBW3CM5KKB12345', annee: '2022', marque: 'Ford', modele: 'Transit 250',
      type_vehicule: 'camion', usage: 'livraison', rayon_operation_km: '160',
      lieu_remisage: '2450 boulevard Industriel, Laval', valeur: '60000', annee_acquisition: '2022',
      conducteur_principal_id: String(cid1), equipements_speciaux: 'Hayon élévateur | 6500',
    },
  });
  test('modification véhicule → 302', r.statut === 302, r.statut);
  test('valeur modifiée en base', Number(bd.prepare('SELECT valeur FROM flotte_vehicules WHERE id = ?').get(vid1).valeur) === 60000);
  test('version créée après modification véhicule', nbVersions(sid) === vAvantVeh + 1);
  // véhicule inexistant
  r = await req(jar, 'POST', '/flotte/vehicule/999999', {
    form: { _csrf: await tok(), marque: 'X' },
  });
  test('modification véhicule inexistant → 404', r.statut === 404, r.statut);
  // archivage / désarchivage
  r = await req(jar, 'POST', `/flotte/vehicule/${vid4}/archiver`, { form: { _csrf: await tok() } });
  test('archivage véhicule → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/flotte/' + sid);
  test('véhicule archivé listé dans les archivés', r.texte.includes('Archivés'));
  r = await req(jar, 'POST', `/flotte/vehicule/${vid4}/desarchiver`, { form: { _csrf: await tok() } });
  test('désarchivage véhicule → 302', r.statut === 302, r.statut);
  test('véhicule restauré', bd.prepare('SELECT archive FROM flotte_vehicules WHERE id = ?').get(vid4).archive === 0);

  // ---- 6. Garanties ------------------------------------------------------------------
  console.log('6. Garanties');
  const vAvant = nbVersions(sid);
  r = await req(jar, 'POST', `/flotte/${sid}/garanties`, {
    form: {
      _csrf: await tok(), limite_rc: '2000000', franchise_collision: '1000',
      franchise_versement: '1000', avenants: ['faq43', 'faq27', 'faq20'], prime: '9850',
    },
  });
  test('garanties → 302', r.statut === 302, r.statut);
  const g = bd.prepare('SELECT * FROM flotte_garanties WHERE soumission_id = ?').get(sid);
  test('garanties en base', !!g && Number(g.limite_rc) === 2000000);
  test('franchises stockées', Number(g.franchise_collision) === 1000 && Number(g.franchise_versement) === 1000);
  test('avenants FAQ stockés', JSON.parse(g.avenants).faq43 === 1 && JSON.parse(g.avenants).faq27 === 1 && JSON.parse(g.avenants).faq20 === 1);
  test('version créée après garanties', nbVersions(sid) === vAvant + 1);
  r = await req(jar, 'GET', '/flotte/' + sid);
  test('garanties affichées sur la fiche', r.texte.includes('FAQ 43 — Valeur à neuf') && r.texte.includes('FAQ 27 — Véhicule loué'));
  test('case FAQ43 précochée', /name="avenants" value="faq43" checked/.test(r.texte));
  // franchise négative
  r = await req(jar, 'POST', `/flotte/${sid}/garanties`, {
    form: { _csrf: await tok(), franchise_collision: '-100' },
  });
  test('franchise négative → 400', r.statut === 400, r.statut);
  // modification (mise à jour, pas doublon)
  r = await req(jar, 'POST', `/flotte/${sid}/garanties`, {
    form: {
      _csrf: await tok(), limite_rc: '1000000', franchise_collision: '2500',
      franchise_versement: '2500', avenants: ['faq43', 'faq34', 'faq5a'], prime: '11200',
    },
  });
  test('modification garanties → 302', r.statut === 302, r.statut);
  test('pas de doublon garanties', bd.prepare('SELECT COUNT(*) AS n FROM flotte_garanties WHERE soumission_id = ?').get(sid).n === 1);
  test('limite mise à jour', Number(bd.prepare('SELECT limite_rc FROM flotte_garanties WHERE soumission_id = ?').get(sid).limite_rc) === 1000000);
  test('avenants mis à jour (FAQ34 + FAQ5a)', (() => {
    const av = JSON.parse(bd.prepare('SELECT avenants FROM flotte_garanties WHERE soumission_id = ?').get(sid).avenants);
    return av.faq34 === 1 && av.faq5a === 1;
  })());

  // ---- 7. Antécédents --------------------------------------------------------------------
  console.log('7. Antécédents');
  r = await req(jar, 'POST', `/flotte/${sid}/antecedents`, {
    form: {
      _csrf: await tok(), assureur_actuel: 'Assureur Test Flotte', numero_police_actuelle: 'FLT-123',
      date_expiration_actuelle: '2026-11-30', annees_assurance_flotte_continue: '6', ratio_pertes: '18.5',
      sinistres_flotte_5ans: '2023-07-19 | Accrochage en manœuvre de recul, pare-chocs arrière | 4200\n2024-05-02 | Bris de pare-brise (camion Ford) | 950',
      refus_annulation_ant: 'on', refus_annulation_details: 'Non-renouvellement pour fréquence de sinistres en 2019',
      consentement_dossier_saaq: 'on', consentement_credit: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);
  const a = bd.prepare('SELECT * FROM flotte_antecedents WHERE soumission_id = ?').get(sid);
  test('antécédents en base', !!a && a.assureur_actuel === 'Assureur Test Flotte');
  const sinF = JSON.parse(a.sinistres_flotte_5ans);
  test('2 sinistres flotte stockés', sinF.length === 2, sinF.length);
  test('sinistre 1 parsé (date, description, montant nombre)',
    sinF[0].date === '2023-07-19' && sinF[0].description === 'Accrochage en manœuvre de recul, pare-chocs arrière' && sinF[0].montant === 4200);
  test('sinistre 2 parsé', sinF[1].montant === 950);
  test('ratio de pertes stocké', Number(a.ratio_pertes) === 18.5);
  test('refus antérieur stocké', a.refus_annulation_ant === 1);
  test('consentement dossier SAAQ stocké', JSON.parse(a.consentements).dossier_saaq === 1);
  r = await req(jar, 'GET', '/flotte/' + sid);
  test('antécédents affichés', r.texte.includes('Assureur Test Flotte') && r.texte.includes('2023-07-19 | Accrochage en manœuvre de recul, pare-chocs arrière | 4200'));

  // ---- 8. Modification de l'en-tête ---------------------------------------------------------
  console.log('8. En-tête');
  const vAvantEntete = nbVersions(sid);
  r = await req(jar, 'POST', `/flotte/${sid}/entete`, {
    form: {
      _csrf: await tok(), client_id: String(cli1), assureur: 'Intact Assurance',
      nb_vehicules: '9', rayon_operation_km: '200', usage_dominant: 'mixte',
      date_effet_souhaitee: '2026-12-01', date_echeance_visee: '2027-12-01', notes: 'En-tête modifié',
    },
  });
  test('modification en-tête → 302', r.statut === 302, r.statut);
  const entete2 = bd.prepare('SELECT * FROM flotte_soumissions WHERE id = ?').get(sid);
  test('en-tête modifié en base (nb véhicules, rayon, usage)',
    entete2.nb_vehicules === 9 && entete2.rayon_operation_km === 200 && entete2.usage_dominant === 'mixte');
  test('version créée après modification en-tête', nbVersions(sid) === vAvantEntete + 1);
  r = await req(jar, 'POST', `/flotte/${sid}/entete`, {
    form: { _csrf: await tok(), client_id: String(cli1), usage_dominant: 'course' },
  });
  test('en-tête usage invalide → 400', r.statut === 400, r.statut);

  // ---- 9. Statuts, versions, 404 ------------------------------------------------------------
  console.log('9. Statuts, versions, 404');
  r = await req(jar, 'POST', `/flotte/${sid}/statut`, { form: { _csrf: await tok(), statut: 'invalide' } });
  test('statut invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/flotte/${sid}/statut`, { form: { _csrf: await tok(), statut: 'soumise' } });
  test('statut soumise → 302', r.statut === 302, r.statut);
  test('statut en base', bd.prepare('SELECT statut FROM flotte_soumissions WHERE id = ?').get(sid).statut === 'soumise');
  r = await req(jar, 'GET', `/flotte/${sid}/versions/1`);
  test('version v1 → 200', r.statut === 200, r.statut);
  test('version lecture seule (véhicules)', r.texte.includes('Véhicules'));
  test('version v1 figée : aucun véhicule', r.texte.includes('Véhicules (0)'));
  const vCourante = nbVersions(sid);
  r = await req(jar, 'GET', `/flotte/${sid}/versions/${vCourante}`);
  test('dernière version montre l’avenant FAQ43', r.texte.includes('FAQ 43 — Valeur à neuf'));
  test('dernière version montre l’avenant FAQ5a', r.texte.includes('FAQ 5a — Crédit-bail'));
  test('dernière version montre le sinistre flotte', r.texte.includes('Accrochage en manœuvre de recul, pare-chocs arrière'));
  test('dernière version montre le conducteur', r.texte.includes('Gagnon'));
  test('dernière version montre la remorque', r.texte.includes('Remorque fermée 28 pi'));
  r = await req(jar, 'GET', `/flotte/${sid}/versions/999`);
  test('version inexistante → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/flotte/999999');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 10. Archivage de la soumission ----------------------------------------------------------
  console.log('10. Archivage soumission');
  r = await req(jar, 'POST', `/flotte/${sid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage soumission → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/flotte');
  test('soumission hors de la liste active', !r.texte.includes('Client Flotte inc.'));
  r = await req(jar, 'GET', '/flotte?archives=1');
  test('soumission visible dans les archives', r.texte.includes('Client Flotte inc.'));
  r = await req(jar, 'POST', `/flotte/${sid}/desarchiver`, { form: { _csrf: csrf((await req(jar, 'GET', '/flotte/' + sid)).texte) } });
  test('désarchivage soumission → 302', r.statut === 302, r.statut);

  // ---- 11. Portefeuille courtier ---------------------------------------------------------------
  console.log('11. Portefeuille courtier');
  const lc1 = await loginComme('courtier1@t.ca', 'Test123456!');
  test('login courtier1 → 302', lc1.ok);
  r = await req(lc1.jar, 'GET', '/flotte');
  test('courtier ne voit pas la soumission hors portefeuille', !r.texte.includes('Client Flotte inc.'));
  // crée une soumission pour cli3 (son portefeuille) directement
  const sidC = bd.prepare(
    'INSERT INTO flotte_soumissions (cabinet_id, client_id) VALUES (?, ?)'
  ).run(cabA, cli3).lastInsertRowid;
  r = await req(lc1.jar, 'GET', '/flotte/' + sidC);
  test('courtier ouvre sa soumission → 200', r.statut === 200, r.statut);
  r = await req(lc1.jar, 'GET', '/flotte/' + sid);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(lc1.jar, 'POST', '/flotte', {
    form: { _csrf: csrf((await req(lc1.jar, 'GET', '/flotte/nouveau')).texte), client_id: String(cli2) },
  });
  test('création hors portefeuille → 400', r.statut === 400, r.statut);
  const tokC = async () => csrf((await req(lc1.jar, 'GET', '/flotte/' + sidC)).texte);
  r = await req(lc1.jar, 'POST', `/flotte/vehicule/${vid1}`, {
    form: { _csrf: await tokC(), marque: 'X' },
  });
  test('mutation véhicule hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(lc1.jar, 'POST', `/flotte/conducteur/${cid1}`, {
    form: { _csrf: await tokC(), prenom: 'X', nom: 'Y' },
  });
  test('mutation conducteur hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(lc1.jar, 'POST', `/flotte/${sid}/garanties`, {
    form: { _csrf: await tokC(), limite_rc: '1000000' },
  });
  test('mutation garanties hors portefeuille → 403', r.statut === 403, r.statut);

  // ---- 12. Inter-cabinets -------------------------------------------------------------------------
  console.log('12. Inter-cabinets');
  const lb = await loginComme('adminb@t.ca', 'Test123456!');
  test('login adminB → 302', lb.ok);
  r = await req(lb.jar, 'GET', '/flotte/' + sid);
  test('cabinet B ne voit pas → 404', r.statut === 404, r.statut);

  // ---- 13. Non connecté + CSRF -----------------------------------------------------------------------
  console.log('13. Auth et CSRF');
  const jarAnon = nouveauJar();
  r = await req(jarAnon, 'GET', '/flotte');
  test('non connecté → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', '/flotte', { form: { client_id: String(cli1) } });
  test('POST sans CSRF → 403', r.statut === 403, r.statut);

  // ---- 14. Audit + règle d'or ----------------------------------------------------------------------------
  console.log('14. Audit et règle d’or');
  const n = bd.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action LIKE 'flotte_%'").get().n;
  test('journal d’audit alimenté', n >= 10, n);
  const fs = require('fs');
  const path = require('path');
  const codeRoutes = fs.readFileSync(__dirname + '/../routes/flotte.js', 'utf8');
  const codeLib = fs.readFileSync(__dirname + '/../lib/flotte.js', 'utf8');
  test('aucun DELETE en dur (routes)', !/DELETE\s+FROM\s+flotte_/i.test(codeRoutes));
  test('aucun DELETE en dur (lib)', !/DELETE\s+FROM\s+flotte_/i.test(codeLib));
  test('aucune route DELETE (routes)', !/router\.delete\s*\(/.test(codeRoutes));
  const dirVues = fs.readdirSync(path.join(__dirname, '..', 'views', 'flotte'));
  const codeVues = dirVues.map((f) => fs.readFileSync(path.join(__dirname, '..', 'views', 'flotte', f), 'utf8')).join('\n');
  test('aucun bouton « supprimer » dans les vues flotte', !/supprimer/i.test(codeVues));
  test('aucun mot « supprimer » dans les routes flotte', !/supprimer/i.test(codeRoutes));

  console.log(`\n== ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE :', e); process.exit(1); });
