/**
 * scripts/test-analyse-insertion.js — « Analyse de documents IA » étape 3/5 :
 * parcours complet téléverser → analyser → réviser → insérer (soumission
 * créée champ par champ), valeur corrigée à la révision respectée, aucune
 * insertion sans le POST de confirmation, CSRF 403, cloisonnement
 * inter-cabinets 404, courtier hors portefeuille 403, cibles police
 * (création + rattachement du document).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-analyse-insertion.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);

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
    corps = data; // FormData : fetch pose le content-type multipart
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
async function loginComme(email, mdp) {
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  return { jar, ok: r.statut === 302 };
}
async function televerser(jar, cheminFichier, nom) {
  const page = await req(jar, 'GET', '/analyses');
  const fd = new FormData();
  fd.append('_csrf', csrf(page.texte));
  fd.append('document', new Blob([fs.readFileSync(cheminFichier)], { type: 'application/pdf' }), nom);
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

(async () => {
  console.log('== Analyse de documents IA — étape 3 : révision + insertion ==', BASE);

  // ---- 1. Préparation ---------------------------------------------------------
  console.log('1. Préparation');
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const adminId = bd.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  const cabB = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet B').lastInsertRowid;
  const hash = bcrypt.hashSync('Test1234!', 4);
  const mkUser = (cab, email, role) => bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(cab, email, hash, role, email).lastInsertRowid;
  const adminB = mkUser(cabB, 'adminb@t.ca', 'admin');
  const courtier1 = mkUser(cabA, 'courtier1@t.ca', 'courtier');
  const courtier2 = mkUser(cabA, 'courtier2@t.ca', 'courtier');
  const cliMethot = bd.prepare("SELECT id FROM clients WHERE cabinet_id = ? AND raison_sociale LIKE 'Constructions Méthot%'").get(cabA);
  test('client seed « Constructions Méthot » présent', !!cliMethot);
  const cliHors = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Entreprise Hors Portefeuille inc.', 'Hors', 'Portefeuille', courtier2).lastInsertRowid;
  const policeSeed = bd.prepare('SELECT id, numero_police FROM polices WHERE cabinet_id = ? ORDER BY id LIMIT 1').get(cabA);
  test('police seed présente pour le rattachement', !!policeSeed);

  // ---- 2. Login admin -----------------------------------------------------------
  console.log('2. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, String(r.statut));

  // ---- 3. Téléversement + analyse -------------------------------------------------
  console.log('3. Téléversement → analyse');
  const pdfRc = await fabriquerPdf('analyse-rc.pdf', [
    'Assurance responsabilité civile générale des entreprises',
    'Assuré nommé : Constructions Méthot inc.',
    'Assureur : Travelers Canada',
    'N° de police : RC-2026-9001',
    "Date d'effet : 2026-11-01",
    "Date d'échéance : 2027-11-01",
    'Limite par sinistre : 2 000 000 $',
    'Limite en agrégat : 4 000 000 $',
    'Franchise : 5 000 $',
    'Prime : 8 900 $',
    'Adresse : 1200 boul. Industriel, Laval',
  ]);
  const nbRcAvant = bd.prepare('SELECT COUNT(*) n FROM rc_soumissions WHERE cabinet_id = ?').get(cabA).n;
  const up = await televerser(jar, pdfRc, 'police-rc.pdf');
  test('téléversement → redirection vers la fiche', up.statut === 302 && /\/analyses\/\d+$/.test(up.location || ''), `${up.statut} ${up.location}`);
  const analyseId = Number((up.location || '').split('/').pop());
  const a1 = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(analyseId);
  test('analyse : statut « a_reviser »', a1.statut === 'a_reviser', a1.statut);
  test('analyse : produit « rc » détecté', a1.produit_detecte === 'rc', a1.produit_detecte);
  test('analyse : texte extrait conservé', /Travelers/.test(a1.texte_extrait || ''));
  test('AUCUNE soumission créée avant confirmation', bd.prepare('SELECT COUNT(*) n FROM rc_soumissions WHERE cabinet_id = ?').get(cabA).n === nbRcAvant);

  // ---- 4. Écran de révision ------------------------------------------------------------
  console.log('4. Révision');
  r = await req(jar, 'GET', '/analyses/' + analyseId);
  test('fiche : formulaire de révision présent', r.statut === 200 && /Insérer les champs retenus/.test(r.texte));
  test('fiche : confiance affichée en couleur', /color:#1a7f1a|color:#b8860b/.test(r.texte));
  const champs = JSON.parse(a1.champs_proposes);
  const idxPrime = champs.findIndex((c) => c.champ === 'garanties.prime');
  test('champ prime proposé (8 900)', idxPrime >= 0 && champs[idxPrime].valeur === 8900, JSON.stringify(champs[idxPrime]));

  // ---- 5. Insertion soumission (prime corrigée à la révision : 9 250) ----------------------
  console.log('5. Insertion → soumission RC');
  const formIns = { cible: 'soumission', produit: 'rc', police_id: '' };
  champs.forEach((c, i) => {
    formIns['inclure_' + i] = 'on';
    formIns['valeur_' + i] = i === idxPrime ? '9 250' : String(c.valeur);
  });
  formIns._csrf = csrf(r.texte);
  r = await req(jar, 'POST', `/analyses/${analyseId}/inserer`, { form: formIns });
  test('insertion → redirection ?insere=1', r.statut === 302 && /insere=1/.test(r.location || ''), `${r.statut} ${r.location}`);
  const a1b = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(analyseId);
  test('analyse marquée « insere » avec soumission_id', a1b.statut === 'insere' && !!a1b.soumission_id);
  const soum = bd.prepare('SELECT * FROM rc_soumissions WHERE id = ?').get(a1b.soumission_id);
  test('soumission RC créée pour le bon client', !!soum && soum.client_id === cliMethot.id, soum && String(soum.client_id));
  const gar = bd.prepare('SELECT * FROM rc_garanties g JOIN rc_exploitations e ON e.id = g.exploitation_id WHERE e.soumission_id = ?').get(a1b.soumission_id);
  test('garanties champ par champ : limite par sinistre 2 M$', !!gar && gar.limite_par_sinistre === 2000000, JSON.stringify(gar));
  test('garanties : limite agrégat 4 M$', gar && gar.limite_agregat === 4000000);
  test('garanties : franchise 5 000 $', gar && gar.franchise === 5000);
  test('garanties : prime CORRIGÉE à la révision (9 250, pas 8 900)', gar && gar.prime === 9250, gar && String(gar.prime));
  const ant = bd.prepare('SELECT * FROM rc_antecedents WHERE soumission_id = ?').get(a1b.soumission_id);
  test('antécédents : assureur actuel Travelers Canada', !!ant && ant.assureur_actuel === 'Travelers Canada');
  const nVersions = bd.prepare('SELECT COUNT(*) n FROM rc_soumission_versions WHERE soumission_id = ?').get(a1b.soumission_id).n;
  test('versions figées créées sur la soumission (règle d or)', nVersions >= 2, `n=${nVersions}`);
  const nAudit = bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE action = 'analyse_inseree' AND cabinet_id = ?").get(cabA).n;
  test('audit « analyse_inseree » présent', nAudit >= 1);

  // Double insertion refusée
  r = await req(jar, 'POST', `/analyses/${analyseId}/inserer`, { form: { ...formIns, _csrf: csrf((await req(jar, 'GET', '/analyses')).texte) } });
  test('double insertion → 400', r.statut === 400, String(r.statut));

  // ---- 6. CSRF ---------------------------------------------------------------------
  console.log('6. CSRF');
  const up2 = await televerser(jar, pdfRc, 'police-rc-2.pdf');
  const analyse2 = Number((up2.location || '').split('/').pop());
  r = await req(jar, 'POST', `/analyses/${analyse2}/inserer`, { form: { cible: 'soumission', produit: 'rc' } });
  test('insertion sans CSRF → 403', r.statut === 403, String(r.statut));

  // Aucun champ retenu → 400
  const fiche2 = await req(jar, 'GET', '/analyses/' + analyse2);
  r = await req(jar, 'POST', `/analyses/${analyse2}/inserer`, { form: { cible: 'soumission', produit: 'rc', _csrf: csrf(fiche2.texte) } });
  test('insertion sans aucun champ retenu → 400', r.statut === 400, String(r.statut));

  // ---- 7. Cible : rattacher à une police existante ---------------------------------------
  console.log('7. Rattachement à une police');
  const r7 = await req(jar, 'POST', `/analyses/${analyse2}/inserer`, {
    form: { cible: 'police_existante', police_id: String(policeSeed.id), _csrf: csrf(fiche2.texte) },
  });
  test('rattachement → redirection ?insere=1', r7.statut === 302, `${r7.statut} ${r7.location}`);
  const a2b = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(analyse2);
  test('analyse : police_id + document_id renseignés', a2b.police_id === policeSeed.id && !!a2b.document_id);
  const doc = bd.prepare('SELECT * FROM documents WHERE id = ?').get(a2b.document_id);
  test('document copié dans les pièces de la police', !!doc && doc.police_id === policeSeed.id && fs.existsSync(doc.chemin));

  // ---- 8. Cible : créer une police ------------------------------------------------------------
  console.log('8. Création de police');
  const up3 = await televerser(jar, pdfRc, 'police-rc-3.pdf');
  const analyse3 = Number((up3.location || '').split('/').pop());
  const a3 = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(analyse3);
  const champs3 = JSON.parse(a3.champs_proposes);
  const fiche3 = await req(jar, 'GET', '/analyses/' + analyse3);
  const form3 = { cible: 'police_nouvelle', produit: 'rc', _csrf: csrf(fiche3.texte) };
  champs3.forEach((c, i) => { form3['inclure_' + i] = 'on'; form3['valeur_' + i] = String(c.valeur); });
  r = await req(jar, 'POST', `/analyses/${analyse3}/inserer`, { form: form3 });
  test('création police → redirection', r.statut === 302, `${r.statut} ${r.location}`);
  const a3b = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(analyse3);
  const pol = a3b.police_id && bd.prepare('SELECT * FROM polices WHERE id = ?').get(a3b.police_id);
  test('police créée : n° RC-2026-9001, ligne cgl, assureur Travelers', !!pol && pol.numero_police === 'RC-2026-9001' && pol.ligne === 'cgl' && /Travelers/.test(pol.assureur), JSON.stringify(pol && [pol.numero_police, pol.ligne, pol.assureur]));
  test('police créée : dates 2026-11-01 → 2027-11-01, franchise 5 000', !!pol && pol.date_effet === '2026-11-01' && pol.date_echeance === '2027-11-01' && pol.franchise === 5000);

  // ---- 9. Cloisonnement inter-cabinets --------------------------------------------------------------
  console.log('9. Cloisonnement');
  const loginB = await loginComme('adminb@t.ca', 'Test1234!');
  test('login admin B', loginB.ok);
  r = await req(loginB.jar, 'GET', '/analyses/' + analyseId);
  test('cabinet B : fiche de A → 404', r.statut === 404, String(r.statut));
  r = await req(loginB.jar, 'GET', '/analyses');
  test('cabinet B : liste sans les analyses de A', r.statut === 200 && !/police-rc\.pdf/.test(r.texte));

  // ---- 10. Courtier hors portefeuille -------------------------------------------------------------------
  console.log('10. Hors portefeuille');
  const loginC = await loginComme('courtier1@t.ca', 'Test1234!');
  test('login courtier', loginC.ok);
  const pdfHors = await fabriquerPdf('analyse-hors.pdf', [
    'Assurance responsabilité civile générale des entreprises',
    'Assuré nommé : Entreprise Hors Portefeuille inc.',
    'Assureur : Beneva',
    'Limite par sinistre : 1 000 000 $',
    'Prime : 3 000 $',
  ]);
  const upH = await televerser(loginC.jar, pdfHors, 'hors.pdf');
  const analyseH = Number((upH.location || '').split('/').pop());
  const aH = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(analyseH);
  const champsH = JSON.parse(aH.champs_proposes);
  const ficheH = await req(loginC.jar, 'GET', '/analyses/' + analyseH);
  const formH = { cible: 'soumission', produit: 'rc', _csrf: csrf(ficheH.texte) };
  champsH.forEach((c, i) => { formH['inclure_' + i] = 'on'; formH['valeur_' + i] = String(c.valeur); });
  r = await req(loginC.jar, 'POST', `/analyses/${analyseH}/inserer`, { form: formH });
  test('courtier hors portefeuille → 403', r.statut === 403, String(r.statut));
  test('aucune soumission créée pour le client hors portefeuille',
    bd.prepare('SELECT COUNT(*) n FROM rc_soumissions WHERE client_id = ?').get(cliHors).n === 0);

  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
