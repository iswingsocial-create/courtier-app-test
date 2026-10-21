/**
 * scripts/test-analyse-parcours-flotte.js — « Analyse de documents IA » v2,
 * étape 3/4 : parcours COMPLET du scénario de Patrick —
 *   1. téléverser la police flotte actuelle (PDF, annexe de 4 véhicules)
 *      → révision → créer la soumission : 4 véhicules + garanties insérés ;
 *   2. téléverser l'Excel des permis du client (vrai .xlsx, 4 conducteurs)
 *      → révision → « Ajouter à une soumission existante » ;
 *   3. la fiche soumission flotte contient 4 véhicules ET 4 conducteurs,
 *      le bouton Proposition est actif et le PDF se génère.
 * Zéro conversion de fichier, zéro ressaisie des listes.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-analyse-parcours-flotte.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);
const { fabriquerXlsx } = require('./fixtures/fabriquer-xlsx');

const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
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
async function req(jar, methode, chemin, { form = null, data = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    corps = new URLSearchParams(form).toString();
  } else if (data) {
    corps = data;
  }
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  const buf = Buffer.from(await res.arrayBuffer());
  return { statut: res.status, texte: buf.toString('utf8'), buf, location: res.headers.get('location') };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
async function loginComme(email, mdp) {
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  return { jar, ok: r.statut === 302 };
}
async function televerser(jar, cheminFichier, nom, mime) {
  const page = await req(jar, 'GET', '/analyses');
  const fd = new FormData();
  fd.append('_csrf', csrf(page.texte));
  fd.append('document', new Blob([fs.readFileSync(cheminFichier)], { type: mime }), nom);
  return req(jar, 'POST', '/analyses', { data: fd });
}
function fabriquerPdf(nom, lignes) {
  const PDFDocument = require('pdfkit');
  const chemin = path.join(os.tmpdir(), nom);
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const flux = fs.createWriteStream(chemin);
    doc.pipe(flux);
    doc.fontSize(13).text(lignes[0]);
    doc.fontSize(11);
    for (const l of lignes.slice(1)) doc.text(l);
    doc.end();
    flux.on('finish', () => resolve(chemin));
  });
}

const POLICE_FLOTTE = [
  'Assurance flotte automobile — Police',
  'Assuré : Transport Lapointe inc.',
  'Assureur : Intact Assurance',
  'N° de police : FLT-2026-90001',
  "Date d'effet : 2026-12-01",
  "Date d'échéance : 2027-12-01",
  'Flotte de 4 véhicules',
  "Rayon d'opération : 160 km",
  'Limite : 2 000 000 $',
  'Franchise : 1 000 $',
  'Prime : 21 500 $',
  '',
  'ANNEXE A — LISTE DES VÉHICULES ASSURÉS',
  'Véhicule 1 : 2022 Ford Transit 250',
  'NIV : 1FTBW3CM5KKB12345',
  'Valeur : 62 000 $',
  'Usage : Livraison',
  '',
  'Véhicule 2 : 2021 Ram ProMaster 3500',
  'NIV : 3C6TRVBG8ME512340',
  'Valeur : 54 000 $',
  'Usage : Livraison',
  '',
  'Véhicule 3 : 2020 Toyota Corolla',
  'NIV : 2T1BURHE8JC045678',
  'Valeur : 18 500 $',
  'Usage : Service',
  '',
  'Véhicule 4 : 2019 Manac Remorque fermée 28 pi',
  'NIV : 1T9UT2825NA334455',
  'Valeur : 21 000 $',
];

(async () => {
  console.log('== Analyse IA v2 — étape 3 : parcours flotte complet ==', BASE);

  // ---- 1. Login ---------------------------------------------------------------
  console.log('1. Login');
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, String(r.statut));

  // ---- 2. Police PDF → analyse ---------------------------------------------------
  console.log('2. Police flotte (PDF) téléversée');
  const pdf = await fabriquerPdf('parcours-police-flotte.pdf', POLICE_FLOTTE);
  const up = await televerser(jar, pdf, 'police-flotte-actuelle.pdf', 'application/pdf');
  test('téléversement → fiche analyse', up.statut === 302 && /\/analyses\/\d+$/.test(up.location || ''), `${up.statut} ${up.location}`);
  const analyseId = Number((up.location || '').split('/').pop());
  const a1 = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(analyseId);
  test('analyse : produit flotte détecté', a1.produit_detecte === 'flotte', a1.produit_detecte);
  const listes1 = JSON.parse(a1.listes_proposees || '{}');
  test('analyse : 4 véhicules proposés en liste', (listes1.vehicules || []).length === 4, `n=${(listes1.vehicules || []).length}`);

  // ---- 3. Révision : sections de listes ----------------------------------------------
  console.log('3. Révision (listes éditables)');
  r = await req(jar, 'GET', '/analyses/' + analyseId);
  test('fiche : section « Véhicules (4) » présente', /Véhicules \(4\)/.test(r.texte));
  test('fiche : lignes éditables liste_vehicules_0_niv...', /name="liste_vehicules_0_niv"/.test(r.texte) && /name="liste_vehicules_3_niv"/.test(r.texte));
  test('fiche : bouton « Ajouter une ligne »', /data-ajouter-ligne="vehicules"/.test(r.texte));
  test('fiche : cible « soumission existante » offerte', /value="soumission_existante"/.test(r.texte) && /name="soumission_existante"/.test(r.texte));

  // ---- 4. Insertion → créer la soumission ------------------------------------------------
  console.log('4. Insertion → soumission créée');
  const champs1 = JSON.parse(a1.champs_proposes);
  const form = { cible: 'soumission', produit: 'flotte', _csrf: csrf(r.texte) };
  champs1.forEach((c, i) => { form['inclure_' + i] = 'on'; form['valeur_' + i] = String(c.valeur); });
  listes1.vehicules.forEach((item, i) => {
    form[`liste_vehicules_${i}_inclure`] = 'on';
    for (const [cle, val] of Object.entries(item.champs)) form[`liste_vehicules_${i}_${cle}`] = String(val);
  });
  // Valeur du 3e véhicule corrigée à la révision : 18 500 → 19 000.
  form['liste_vehicules_2_valeur'] = '19 000';
  const nbFlotteAvant = bd.prepare('SELECT COUNT(*) n FROM flotte_soumissions WHERE cabinet_id = ?').get(cabA).n;
  r = await req(jar, 'POST', `/analyses/${analyseId}/inserer`, { form });
  test('insertion → redirection ?insere=1', r.statut === 302 && /insere=1/.test(r.location || ''), `${r.statut} ${r.location}`);
  const a1b = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(analyseId);
  test('analyse marquée insérée avec soumission_id', a1b.statut === 'insere' && !!a1b.soumission_id);
  const soumissionId = a1b.soumission_id;
  test('UNE nouvelle soumission flotte', bd.prepare('SELECT COUNT(*) n FROM flotte_soumissions WHERE cabinet_id = ?').get(cabA).n === nbFlotteAvant + 1);
  const vehs = bd.prepare('SELECT * FROM flotte_vehicules WHERE soumission_id = ? AND archive = 0 ORDER BY id').all(soumissionId);
  test('4 véhicules insérés dans la soumission', vehs.length === 4, `n=${vehs.length}`);
  test('véhicule 1 : NIV + marque + année + valeur',
    vehs[0]?.niv === '1FTBW3CM5KKB12345' && vehs[0]?.marque === 'Ford' && vehs[0]?.annee === 2022 && vehs[0]?.valeur === 62000, JSON.stringify(vehs[0]));
  test('véhicule 3 : valeur CORRIGÉE à la révision (19 000)', vehs[2]?.valeur === 19000, vehs[2] && String(vehs[2].valeur));
  const gar = bd.prepare('SELECT * FROM flotte_garanties WHERE soumission_id = ?').get(soumissionId);
  test('garanties insérées : limite RC 2 M$, prime 21 500', !!gar && gar.limite_rc === 2000000 && gar.prime === 21500, JSON.stringify(gar));
  const auditListes = bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'analyse_inseree' AND details LIKE '%4 vehicules%' AND cabinet_id = ?").get(cabA).n;
  test('audit « analyse_inseree » détaillé (4 vehicules)', auditListes >= 1);
  const nVersions = bd.prepare('SELECT COUNT(*) n FROM flotte_soumission_versions WHERE soumission_id = ?').get(soumissionId).n;
  test('versions figées créées (règle d\u2019or : en-tête + 4 véhicules + garanties)', nVersions >= 5, `n=${nVersions}`);

  // ---- 5. Excel des permis → analyse --------------------------------------------------------
  console.log('5. Excel des permis téléversé');
  const xlsx = path.join(os.tmpdir(), 'parcours-permis.xlsx');
  fabriquerXlsx(xlsx, {
    colonnes: ['Nom', 'Prénom', 'Numéro de permis', 'Classe', 'Date de naissance', "Date d'embauche", "Années d'expérience"],
    lignes: [
      ['Lapointe', 'Jean-François', 'L152-040478-01', '3', '1978-04-12', '2009-06-01', 24],
      ['Gagnon', 'Marc', 'G556-230985-02', '3', '1985-09-23', '2016-03-14', 15],
      ['Tremblay', 'Sophie', 'T621-300192-03', '5', '1992-01-30', '2021-08-23', 9],
      ['Roy', 'Alain', 'R770-051170-04', '1', '1970-11-05', '2012-01-09', 30],
    ],
  });
  const up2 = await televerser(jar, xlsx, 'permis-conducteurs.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  test('téléversement Excel → fiche analyse', up2.statut === 302 && /\/analyses\/\d+$/.test(up2.location || ''), `${up2.statut} ${up2.location}`);
  const analyse2 = Number((up2.location || '').split('/').pop());
  const a2 = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(analyse2);
  test('analyse Excel : produit flotte déduit', a2.produit_detecte === 'flotte', a2.produit_detecte);
  const listes2 = JSON.parse(a2.listes_proposees || '{}');
  test('analyse Excel : 4 conducteurs proposés', (listes2.conducteurs || []).length === 4, `n=${(listes2.conducteurs || []).length}`);
  r = await req(jar, 'GET', '/analyses/' + analyse2);
  test('révision Excel : section « Conducteurs (4) »', /Conducteurs \(4\)/.test(r.texte));
  test('révision Excel : le sélecteur contient la soumission créée',
    r.texte.includes(`value="flotte:${soumissionId}"`), 'option soumission existante');

  // ---- 6. Insertion → ajouter à la soumission EXISTANTE ---------------------------------------
  console.log('6. Insertion → soumission existante');
  const form2 = {
    cible: 'soumission_existante', produit: 'flotte',
    soumission_existante: `flotte:${soumissionId}`, _csrf: csrf(r.texte),
  };
  listes2.conducteurs.forEach((item, i) => {
    form2[`liste_conducteurs_${i}_inclure`] = 'on';
    for (const [cle, val] of Object.entries(item.champs)) form2[`liste_conducteurs_${i}_${cle}`] = String(val);
  });
  // Un 5e conducteur ajouté à la main via une ligne vierge de la révision.
  form2['liste_conducteurs_4_inclure'] = 'on';
  form2['liste_conducteurs_4_nom'] = 'Bouchard';
  form2['liste_conducteurs_4_prenom'] = 'Karine';
  form2['liste_conducteurs_4_numero_permis'] = 'B310-170695-05';
  form2['liste_conducteurs_4_classe_permis'] = '5';
  form2['liste_conducteurs_4_date_naissance'] = '1995-06-17';
  r = await req(jar, 'POST', `/analyses/${analyse2}/inserer`, { form: form2 });
  test('insertion existante → redirection ?insere=1', r.statut === 302 && /insere=1/.test(r.location || ''), `${r.statut} ${r.location}`);
  const conds = bd.prepare('SELECT * FROM flotte_conducteurs WHERE soumission_id = ? AND archive = 0 ORDER BY id').all(soumissionId);
  test('5 conducteurs dans la soumission (4 Excel + 1 ligne ajoutée)', conds.length === 5, `n=${conds.length}`);
  test('conducteur 1 champ par champ (Excel)',
    conds[0]?.nom === 'Lapointe' && conds[0]?.prenom === 'Jean-François'
    && conds[0]?.numero_permis === 'L152-040478-01' && conds[0]?.classe_permis === '3'
    && conds[0]?.date_naissance === '1978-04-12' && conds[0]?.date_embauche === '2009-06-01'
    && conds[0]?.annees_experience === 24, JSON.stringify(conds[0]));
  test('conducteur ajouté manuellement présent', conds[4]?.nom === 'Bouchard' && conds[4]?.numero_permis === 'B310-170695-05');
  const auditAjout = bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'analyse_listes_ajoutees' AND cabinet_id = ?").get(cabA).n;
  test('audit « analyse_listes_ajoutees » présent', auditAjout >= 1);

  // Erreurs : produit incohérent et soumission d'un autre produit
  const up3 = await televerser(jar, xlsx, 'permis-2.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const analyse3 = Number((up3.location || '').split('/').pop());
  const fiche3 = await req(jar, 'GET', '/analyses/' + analyse3);
  const listes3 = JSON.parse(bd.prepare('SELECT listes_proposees FROM analyses_documents WHERE id = ?').get(analyse3).listes_proposees || '{}');
  const formErr = { cible: 'soumission_existante', produit: 'rc', soumission_existante: `flotte:${soumissionId}`, _csrf: csrf(fiche3.texte) };
  listes3.conducteurs.forEach((item, i) => {
    formErr[`liste_conducteurs_${i}_inclure`] = 'on';
    for (const [cle, val] of Object.entries(item.champs)) formErr[`liste_conducteurs_${i}_${cle}`] = String(val);
  });
  r = await req(jar, 'POST', `/analyses/${analyse3}/inserer`, { form: formErr });
  test('produit incohérent avec la soumission → 400', r.statut === 400, String(r.statut));
  test('aucun conducteur ajouté par la tentative incohérente',
    bd.prepare('SELECT COUNT(*) n FROM flotte_conducteurs WHERE soumission_id = ? AND archive = 0').get(soumissionId).n === 5);

  // Ligne exclue à la révision : pas insérée
  const formExcl = { cible: 'soumission_existante', produit: 'flotte', soumission_existante: `flotte:${soumissionId}`, _csrf: csrf(fiche3.texte) };
  listes3.conducteurs.forEach((item, i) => {
    if (i === 0) return; // ligne 0 décochée
    formExcl[`liste_conducteurs_${i}_inclure`] = 'on';
    for (const [cle, val] of Object.entries(item.champs)) formExcl[`liste_conducteurs_${i}_${cle}`] = String(val);
  });
  r = await req(jar, 'POST', `/analyses/${analyse3}/inserer`, { form: formExcl });
  test('insertion partielle (3 lignes cochées) → redirection', r.statut === 302, String(r.statut));
  test('seules les lignes cochées sont ajoutées (5 + 3 = 8)',
    bd.prepare('SELECT COUNT(*) n FROM flotte_conducteurs WHERE soumission_id = ? AND archive = 0').get(soumissionId).n === 8);

  // ---- 7. Fiche soumission complète + proposition ------------------------------------------------
  console.log('7. Fiche flotte + proposition');
  r = await req(jar, 'GET', `/flotte/${soumissionId}`);
  test('fiche flotte → 200', r.statut === 200, String(r.statut));
  test('fiche : les 4 NIV visibles', ['1FTBW3CM5KKB12345', '3C6TRVBG8ME512340', '2T1BURHE8JC045678', '1T9UT2825NA334455'].every((niv) => r.texte.includes(niv)));
  test('fiche : les conducteurs visibles', ['Lapointe', 'Gagnon', 'Tremblay', 'Bouchard'].every((n) => r.texte.includes(n)));
  test('fiche : bouton Proposition ACTIF (lien, pas le bouton désactivé)',
    r.texte.includes(`href="/flotte/${soumissionId}/proposition"`) && !/Proposition \(incomplète\)/.test(r.texte));
  r = await req(jar, 'GET', `/flotte/${soumissionId}/proposition.pdf`);
  test('proposition PDF générée (%PDF, > 1 Ko)', r.statut === 200 && r.buf.slice(0, 4).toString() === '%PDF' && r.buf.length > 1024,
    `${r.statut} ${r.buf.length} o`);

  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
