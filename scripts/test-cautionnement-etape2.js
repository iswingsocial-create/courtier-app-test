/**
 * scripts/test-cautionnement-etape2.js — UI questionnaire cautionnement
 * (étape 2/10 cautionnement) : onglet Cautionnement, création soumission
 * (en-tête : entreprise/principal, caution visée, secteur, fondation,
 * chiffre d'affaires, employés, dates visées), obligations illimitées
 * (soumission / exécution / paiement M&O / RBQ / autre, bénéficiaire,
 * montants, taux, prime estimée), ligne de cautionnement (limite globale /
 * par projet, fonds de roulement, valeur nette), antécédents (réclamations
 * contre des cautionnements 5 ans, refus/résiliation, consentements),
 * en-tête modifiable, versions, statuts, archivage, CSRF, cloisonnement
 * inter-cabinets, portefeuille courtier, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : CHEMIN_BD=/tmp/test-caut2.db PORT=3101 node scripts/test-cautionnement-etape2.js
 * (CHEMIN_BD doit être le même sur le serveur et le script.)
 * Miroir de scripts/test-flotte-etape2.js.
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
  return bd.prepare('SELECT COUNT(*) AS n FROM caut_soumission_versions WHERE soumission_id = ?').get(sid).n;
}

(async () => {
  console.log('== Tests Cautionnement étape 2 (UI) :', BASE);

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
  ).run(cabA, 'Client Cautionnement inc.', 'Jean', 'Caut').lastInsertRowid;
  const cli2 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Autre Caut inc.', 'Marie', 'Autre', courtier2).lastInsertRowid;
  const cli3 = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Client Courtier Caut inc.', 'Paul', 'Court', courtier1).lastInsertRowid;
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
  r = await req(jar, 'GET', '/cautionnement');
  test('GET /cautionnement → 200', r.statut === 200, r.statut);
  test('onglet Cautionnement dans la navigation', /href="\/cautionnement">Cautionnement</.test(r.texte));
  test('onglet Cautionnement après Flotte', r.texte.indexOf('href="/flotte"') < r.texte.indexOf('href="/cautionnement"'));
  test('colonnes Obligations et Limite globale', r.texte.includes('Obligations') && r.texte.includes('Limite globale'));
  test('seed cautionnement visible (Construction Verdon)', r.texte.includes('Construction Verdon inc.'));
  r = await req(jar, 'GET', '/cautionnement/nouveau');
  test('GET /cautionnement/nouveau → 200', r.statut === 200, r.statut);
  test('formulaire propose les entreprises', r.texte.includes('Client Cautionnement inc.'));
  test('formulaire propose le secteur d’activité', r.texte.includes('Secteur d’activité'));
  r = await req(jar, 'POST', '/cautionnement', { form: { _csrf: csrf((await req(jar, 'GET', '/cautionnement/nouveau')).texte) } });
  test('création sans client → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/cautionnement', { form: { _csrf: csrf((await req(jar, 'GET', '/cautionnement/nouveau')).texte), client_id: '99999' } });
  test('création client invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/cautionnement', { form: { _csrf: csrf((await req(jar, 'GET', '/cautionnement/nouveau')).texte), client_id: String(cli1), date_effet_souhaitee: 'pas-une-date' } });
  test('création date invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/cautionnement', { form: { _csrf: csrf((await req(jar, 'GET', '/cautionnement/nouveau')).texte), client_id: String(cli1), chiffre_affaires: '-100' } });
  test('création chiffre d’affaires négatif → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', '/cautionnement', {
    form: {
      _csrf: csrf((await req(jar, 'GET', '/cautionnement/nouveau')).texte),
      client_id: String(cli1), assureur: 'Intact Cautionnement',
      secteur_activite: 'Construction — entrepreneur général', annee_fondation: '2010',
      chiffre_affaires: '6200000', nb_employes: '35',
      date_effet_souhaitee: '2026-12-01', date_echeance_visee: '2027-12-01', notes: 'Test UI cautionnement',
    },
  });
  test('création soumission → 302', r.statut === 302, r.statut);
  const sid = Number((r.location || '').split('/').pop());
  test('redirection vers la fiche', r.location === '/cautionnement/' + sid && sid > 0, r.location);
  test('v1 créée', nbVersions(sid) === 1, nbVersions(sid));
  const enteteDb = bd.prepare('SELECT * FROM caut_soumissions WHERE id = ?').get(sid);
  test('en-tête stocké (secteur, fondation, CA, employés, dates)',
    enteteDb.secteur_activite.includes('entrepreneur général') && enteteDb.annee_fondation === 2010
    && enteteDb.chiffre_affaires === 6200000 && enteteDb.nb_employes === 35
    && enteteDb.date_echeance_visee === '2027-12-01');

  // ---- 3. Fiche : sections ----------------------------------------------------
  console.log('3. Fiche soumission');
  r = await req(jar, 'GET', '/cautionnement/' + sid);
  test('fiche → 200', r.statut === 200, r.statut);
  for (const s of ['Obligations', 'Ligne de cautionnement', 'Antécédents', 'Historique des versions']) {
    test('section « ' + s + ' » présente', r.texte.includes(s));
  }
  test('types de cautionnement proposés', r.texte.includes('Cautionnement d’exécution') && r.texte.includes('Cautionnement de licence RBQ'));
  test('consentements proposés (crédit, états financiers)', r.texte.includes('Dossier de crédit') && r.texte.includes('États financiers'));
  test('bouton Proposition absent (incomplet)', !r.texte.includes('/proposition'));

  const tok = async () => csrf((await req(jar, 'GET', '/cautionnement/' + sid)).texte);

  // ---- 4. Obligations ------------------------------------------------------------
  console.log('4. Obligations');
  r = await req(jar, 'POST', `/cautionnement/${sid}/obligation`, { form: { _csrf: await tok(), type: 'execution' } });
  test('obligation sans bénéficiaire ni projet → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid}/obligation`, { form: { _csrf: await tok(), type: 'garantie_bancaire', beneficiaire: 'X' } });
  test('obligation type invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid}/obligation`, {
    form: {
      _csrf: await tok(), type: 'soumission', beneficiaire: 'Ville de Laval',
      description_projet: 'Cautionnement de soumission — réfection du centre sportif',
      montant_contrat: '1500000', montant_cautionnement: '150000', prime_estimee: '300', duree_mois: '10',
    },
  });
  test('ajout obligation soumission → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid}/obligation`, {
    form: {
      _csrf: await tok(), type: 'execution', beneficiaire: 'Ville de Laval',
      description_projet: 'Réfection du centre sportif (contrat de construction)',
      montant_contrat: '1500000', montant_cautionnement: '750000', taux_pct: '1.2', prime_estimee: '9000',
      date_debut: '2026-05-01', duree_mois: '10',
    },
  });
  test('ajout obligation exécution → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid}/obligation`, {
    form: {
      _csrf: await tok(), type: 'paiement_mo', beneficiaire: 'Ville de Laval',
      description_projet: 'Paiement de la main-d’œuvre et des matériaux — centre sportif',
      montant_contrat: '1500000', montant_cautionnement: '750000', taux_pct: '0.9', prime_estimee: '6750', duree_mois: '10',
    },
  });
  test('ajout obligation paiement M&O → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid}/obligation`, {
    form: {
      _csrf: await tok(), type: 'rbq', beneficiaire: 'Régie du bâtiment du Québec (RBQ)',
      description_projet: 'Cautionnement de licence RBQ — entrepreneur général',
      montant_cautionnement: '40000', prime_estimee: '250', duree_mois: '12',
    },
  });
  test('ajout obligation RBQ → 302', r.statut === 302, r.statut);
  const obs = bd.prepare('SELECT * FROM caut_obligations WHERE soumission_id = ? AND archive = 0 ORDER BY id').all(sid);
  test('4 obligations en base', obs.length === 4, obs.length);
  const oid1 = obs[0].id;
  const oid2 = obs[1].id;
  const oid4 = obs[3].id;
  test('versions créées après les ajouts', nbVersions(sid) === 5, nbVersions(sid));
  test('obligation exécution stockée (montants, taux nombre)',
    Number(obs[1].montant_contrat) === 1500000 && Number(obs[1].montant_cautionnement) === 750000
    && Number(obs[1].taux_pct) === 1.2);
  test('obligation RBQ 40 000 $', Number(obs[3].montant_cautionnement) === 40000);
  r = await req(jar, 'GET', '/cautionnement/' + sid);
  test('obligations visibles sur la fiche', r.texte.includes('Ville de Laval') && r.texte.includes('Régie du bâtiment'));
  test('type RBQ affiché en libellé', r.texte.includes('Cautionnement de licence RBQ'));
  // montant négatif
  r = await req(jar, 'POST', `/cautionnement/${sid}/obligation`, {
    form: { _csrf: await tok(), beneficiaire: 'Mauvais', montant_cautionnement: '-100' },
  });
  test('montant négatif → 400', r.statut === 400, r.statut);
  // modification
  const vAvantObl = nbVersions(sid);
  r = await req(jar, 'POST', `/cautionnement/obligation/${oid2}`, {
    form: {
      _csrf: await tok(), type: 'execution', beneficiaire: 'Ville de Laval',
      description_projet: 'Réfection du centre sportif (contrat de construction)',
      montant_contrat: '1500000', montant_cautionnement: '800000', taux_pct: '1.2', prime_estimee: '9600',
      date_debut: '2026-05-01', duree_mois: '10',
    },
  });
  test('modification obligation → 302', r.statut === 302, r.statut);
  test('montant modifié en base', Number(bd.prepare('SELECT montant_cautionnement FROM caut_obligations WHERE id = ?').get(oid2).montant_cautionnement) === 800000);
  test('version créée après modification obligation', nbVersions(sid) === vAvantObl + 1);
  // obligation inexistante
  r = await req(jar, 'POST', '/cautionnement/obligation/999999', {
    form: { _csrf: await tok(), beneficiaire: 'X' },
  });
  test('modification obligation inexistante → 404', r.statut === 404, r.statut);
  // archivage / désarchivage
  r = await req(jar, 'POST', `/cautionnement/obligation/${oid4}/archiver`, { form: { _csrf: await tok() } });
  test('archivage obligation → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/cautionnement/' + sid);
  test('obligation archivée listée dans les archivées', r.texte.includes('Archivées'));
  r = await req(jar, 'POST', `/cautionnement/obligation/${oid4}/desarchiver`, { form: { _csrf: await tok() } });
  test('désarchivage obligation → 302', r.statut === 302, r.statut);
  test('obligation restaurée', bd.prepare('SELECT archive FROM caut_obligations WHERE id = ?').get(oid4).archive === 0);
  void oid1;

  // ---- 5. Ligne de cautionnement ------------------------------------------------------------------
  console.log('5. Ligne de cautionnement');
  const vAvant = nbVersions(sid);
  r = await req(jar, 'POST', `/cautionnement/${sid}/garanties`, {
    form: {
      _csrf: await tok(), limite_globale: '5000000', limite_par_projet: '2500000',
      fonds_roulement: '700000', valeur_nette: '1600000', prime: '18000',
    },
  });
  test('ligne → 302', r.statut === 302, r.statut);
  const g = bd.prepare('SELECT * FROM caut_garanties WHERE soumission_id = ?').get(sid);
  test('ligne en base', !!g && Number(g.limite_globale) === 5000000);
  test('limite par projet et fonds de roulement stockés',
    Number(g.limite_par_projet) === 2500000 && Number(g.fonds_roulement) === 700000);
  test('version créée après la ligne', nbVersions(sid) === vAvant + 1);
  // limite par projet > globale
  r = await req(jar, 'POST', `/cautionnement/${sid}/garanties`, {
    form: { _csrf: await tok(), limite_globale: '1000000', limite_par_projet: '2000000' },
  });
  test('limite par projet > globale → 400', r.statut === 400, r.statut);
  // négatif
  r = await req(jar, 'POST', `/cautionnement/${sid}/garanties`, {
    form: { _csrf: await tok(), fonds_roulement: '-100' },
  });
  test('fonds de roulement négatif → 400', r.statut === 400, r.statut);
  // modification (mise à jour, pas doublon)
  r = await req(jar, 'POST', `/cautionnement/${sid}/garanties`, {
    form: {
      _csrf: await tok(), limite_globale: '7500000', limite_par_projet: '3000000',
      fonds_roulement: '820000', valeur_nette: '1750000', prime: '24000',
    },
  });
  test('modification ligne → 302', r.statut === 302, r.statut);
  test('pas de doublon ligne', bd.prepare('SELECT COUNT(*) AS n FROM caut_garanties WHERE soumission_id = ?').get(sid).n === 1);
  test('limite globale mise à jour', Number(bd.prepare('SELECT limite_globale FROM caut_garanties WHERE soumission_id = ?').get(sid).limite_globale) === 7500000);
  r = await req(jar, 'GET', '/cautionnement/' + sid);
  test('bouton Proposition actif une fois complet', r.texte.includes(`/cautionnement/${sid}/proposition`) && r.texte.includes('📄 Proposition'));

  // ---- 6. Antécédents --------------------------------------------------------------------
  console.log('6. Antécédents');
  r = await req(jar, 'POST', `/cautionnement/${sid}/antecedents`, {
    form: {
      _csrf: await tok(), assureur_actuel: 'Intact Cautionnement', numero_ligne_actuelle: 'CAUT-2020-1122',
      date_expiration_actuelle: '2026-11-30', annees_cautionnement_continu: '6',
      reclamations_5ans: '2022-05-14 | Exécution — Ville de Terrebonne | 48000 | réglée\n2024-03-08 | Soumission — Ville de Laval | 12000 | fermée',
      refus_resiliation_ant: 'on', refus_resiliation_details: 'Résiliation de ligne par la caution en 2019',
      consentement_credit: 'on', consentement_etats_financiers: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, r.statut);
  const a = bd.prepare('SELECT * FROM caut_antecedents WHERE soumission_id = ?').get(sid);
  test('antécédents en base', !!a && a.assureur_actuel === 'Intact Cautionnement');
  const recs = JSON.parse(a.reclamations_5ans);
  test('2 réclamations stockées', recs.length === 2, recs.length);
  test('réclamation 1 parsée (date, cautionnement, montant nombre, statut)',
    recs[0].date === '2022-05-14' && recs[0].cautionnement === 'Exécution — Ville de Terrebonne'
    && recs[0].montant === 48000 && recs[0].statut === 'réglée');
  test('réclamation 2 parsée', recs[1].montant === 12000);
  test('refus/résiliation antérieur stocké', a.refus_resiliation_ant === 1);
  test('consentements stockés', JSON.parse(a.consentements).credit === 1 && JSON.parse(a.consentements).etats_financiers === 1);
  r = await req(jar, 'GET', '/cautionnement/' + sid);
  test('antécédents affichés', r.texte.includes('Intact Cautionnement') && r.texte.includes('2022-05-14 | Exécution — Ville de Terrebonne | 48000 | réglée'));

  // ---- 7. Modification de l'en-tête ---------------------------------------------------------
  console.log('7. En-tête');
  const vAvantEntete = nbVersions(sid);
  r = await req(jar, 'POST', `/cautionnement/${sid}/entete`, {
    form: {
      _csrf: await tok(), client_id: String(cli1), assureur: 'Travelers Canada',
      secteur_activite: 'Construction — entrepreneur général', annee_fondation: '2010',
      chiffre_affaires: '6800000', nb_employes: '38',
      date_effet_souhaitee: '2026-12-01', date_echeance_visee: '2027-12-01', notes: 'En-tête modifié',
    },
  });
  test('modification en-tête → 302', r.statut === 302, r.statut);
  const entete2 = bd.prepare('SELECT * FROM caut_soumissions WHERE id = ?').get(sid);
  test('en-tête modifié en base (CA, employés, caution)',
    entete2.chiffre_affaires === 6800000 && entete2.nb_employes === 38 && entete2.assureur === 'Travelers Canada');
  test('version créée après modification en-tête', nbVersions(sid) === vAvantEntete + 1);
  r = await req(jar, 'POST', `/cautionnement/${sid}/entete`, {
    form: { _csrf: await tok(), client_id: String(cli1), annee_fondation: 'abc' },
  });
  test('en-tête année de fondation invalide → 400', r.statut === 400, r.statut);

  // ---- 8. Statuts, versions, 404 ------------------------------------------------------------
  console.log('8. Statuts, versions, 404');
  r = await req(jar, 'POST', `/cautionnement/${sid}/statut`, { form: { _csrf: await tok(), statut: 'invalide' } });
  test('statut invalide → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/cautionnement/${sid}/statut`, { form: { _csrf: await tok(), statut: 'soumise' } });
  test('statut soumise → 302', r.statut === 302, r.statut);
  test('statut en base', bd.prepare('SELECT statut FROM caut_soumissions WHERE id = ?').get(sid).statut === 'soumise');
  r = await req(jar, 'GET', `/cautionnement/${sid}/versions/1`);
  test('version v1 → 200', r.statut === 200, r.statut);
  test('version lecture seule (obligations)', r.texte.includes('Obligations'));
  test('version v1 figée : aucune obligation', r.texte.includes('Obligations (0)'));
  const vCourante = nbVersions(sid);
  r = await req(jar, 'GET', `/cautionnement/${sid}/versions/${vCourante}`);
  test('dernière version montre la limite globale', r.texte.includes('7 500 000') || r.texte.includes('7500000') || r.texte.includes('7 500 000'));
  test('dernière version montre le bénéficiaire', r.texte.includes('Ville de Laval'));
  test('dernière version montre la réclamation', r.texte.includes('Ville de Terrebonne'));
  r = await req(jar, 'GET', `/cautionnement/${sid}/versions/999`);
  test('version inexistante → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/cautionnement/999999');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 9. Archivage de la soumission ----------------------------------------------------------
  console.log('9. Archivage soumission');
  r = await req(jar, 'POST', `/cautionnement/${sid}/archiver`, { form: { _csrf: await tok() } });
  test('archivage soumission → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/cautionnement');
  test('soumission hors de la liste active', !r.texte.includes('Client Cautionnement inc.'));
  r = await req(jar, 'GET', '/cautionnement?archives=1');
  test('soumission visible dans les archives', r.texte.includes('Client Cautionnement inc.'));
  r = await req(jar, 'POST', `/cautionnement/${sid}/desarchiver`, { form: { _csrf: csrf((await req(jar, 'GET', '/cautionnement/' + sid)).texte) } });
  test('désarchivage soumission → 302', r.statut === 302, r.statut);

  // ---- 10. Portefeuille courtier ---------------------------------------------------------------
  console.log('10. Portefeuille courtier');
  const lc1 = await loginComme('courtier1@t.ca', 'Test123456!');
  test('login courtier1 → 302', lc1.ok);
  r = await req(lc1.jar, 'GET', '/cautionnement');
  test('courtier ne voit pas la soumission hors portefeuille', !r.texte.includes('Client Cautionnement inc.'));
  const sidC = bd.prepare(
    'INSERT INTO caut_soumissions (cabinet_id, client_id) VALUES (?, ?)'
  ).run(cabA, cli3).lastInsertRowid;
  r = await req(lc1.jar, 'GET', '/cautionnement/' + sidC);
  test('courtier ouvre sa soumission → 200', r.statut === 200, r.statut);
  r = await req(lc1.jar, 'GET', '/cautionnement/' + sid);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(lc1.jar, 'POST', '/cautionnement', {
    form: { _csrf: csrf((await req(lc1.jar, 'GET', '/cautionnement/nouveau')).texte), client_id: String(cli2) },
  });
  test('création hors portefeuille → 400', r.statut === 400, r.statut);
  const tokC = async () => csrf((await req(lc1.jar, 'GET', '/cautionnement/' + sidC)).texte);
  r = await req(lc1.jar, 'POST', `/cautionnement/obligation/${oid2}`, {
    form: { _csrf: await tokC(), beneficiaire: 'X' },
  });
  test('mutation obligation hors portefeuille → 403', r.statut === 403, r.statut);
  r = await req(lc1.jar, 'POST', `/cautionnement/${sid}/garanties`, {
    form: { _csrf: await tokC(), limite_globale: '1000000' },
  });
  test('mutation ligne hors portefeuille → 403', r.statut === 403, r.statut);

  // ---- 11. Inter-cabinets -------------------------------------------------------------------------
  console.log('11. Inter-cabinets');
  const lb = await loginComme('adminb@t.ca', 'Test123456!');
  test('login adminB → 302', lb.ok);
  r = await req(lb.jar, 'GET', '/cautionnement/' + sid);
  test('cabinet B ne voit pas → 404', r.statut === 404, r.statut);

  // ---- 12. Non connecté + CSRF -----------------------------------------------------------------------
  console.log('12. Auth et CSRF');
  const jarAnon = nouveauJar();
  r = await req(jarAnon, 'GET', '/cautionnement');
  test('non connecté → 302', r.statut === 302, r.statut);
  r = await req(jar, 'POST', '/cautionnement', { form: { client_id: String(cli1) } });
  test('POST sans CSRF → 403', r.statut === 403, r.statut);

  // ---- 13. Audit + règle d'or ----------------------------------------------------------------------------
  console.log('13. Audit et règle d’or');
  const n = bd.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action LIKE 'caut_%'").get().n;
  test('journal d’audit alimenté', n >= 10, n);
  const fs = require('fs');
  const path = require('path');
  const codeRoutes = fs.readFileSync(__dirname + '/../routes/cautionnement.js', 'utf8');
  const codeLib = fs.readFileSync(__dirname + '/../lib/cautionnement.js', 'utf8');
  test('aucun DELETE en dur (routes)', !/DELETE\s+FROM\s+caut_/i.test(codeRoutes));
  test('aucun DELETE en dur (lib)', !/DELETE\s+FROM\s+caut_/i.test(codeLib));
  test('aucune route DELETE (routes)', !/router\.delete\s*\(/.test(codeRoutes));
  const dirVues = fs.readdirSync(path.join(__dirname, '..', 'views', 'cautionnement'));
  const codeVues = dirVues.map((f) => fs.readFileSync(path.join(__dirname, '..', 'views', 'cautionnement', f), 'utf8')).join('\n');
  test('aucun bouton « supprimer » dans les vues cautionnement', !/supprimer/i.test(codeVues));
  test('aucun mot « supprimer » dans les routes cautionnement', !/supprimer/i.test(codeRoutes));

  console.log(`\n== ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE :', e); process.exit(1); });
