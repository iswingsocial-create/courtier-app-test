/**
 * scripts/test-proposition-eo-pdf.js — Proposition d'assurance responsabilité
 * professionnelle pré-remplie (E&O — étape 7/10) : page HTML imprimable + PDF
 * téléchargeable, version figée (?v=), 404/403, portefeuille courtier,
 * journal d'audit. Miroir de scripts/test-proposition-cyber-pdf.js (cyber).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-proposition-eo-pdf.js
 * (CHEMIN_BD optionnel pour l'accès direct à la base du serveur.)
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);
const eo = require('../lib/eo');

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
    corps = new URLSearchParams(form).toString();
  }
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  const buf = Buffer.from(await res.arrayBuffer());
  return { statut: res.status, buf, texte: buf.toString('utf8'), contentType: res.headers.get('content-type') || '' };
}
// pdfkit écrit le texte en chaînes hexadécimales [<...>] dans les flux Tj :
// on les décode pour vérifier le contenu réel du PDF.
function textePdf(buf) {
  const brut = buf.toString('latin1');
  const morceaux = [];
  const re = /<([0-9A-Fa-f]+)>/g;
  let m;
  while ((m = re.exec(brut))) {
    try { morceaux.push(Buffer.from(m[1], 'hex').toString('latin1')); } catch { /* ignore */ }
  }
  return morceaux.join('');
}
function csrf(texte) {
  const m = texte.match(/name=\"_csrf\" value=\"([^\"]+)\"/);
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

(async () => {
  console.log('== Tests proposition E&O pré-remplie (étape 7 E&O) :', BASE);

  // ---- Préparation directe --------------------------------------------------
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const adminA = bd.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  const cabB = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet B').lastInsertRowid;
  const hash = bcrypt.hashSync('Test1234!', 4);
  bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)")
    .run(cabB, 'adminb@t.ca', hash, 'Admin B');
  const courtier1 = bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)"
  ).run(cabA, 'courtier1@t.ca', hash, 'Courtier Un').lastInsertRowid;
  const courtier2 = bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)"
  ).run(cabA, 'courtier2@t.ca', hash, 'Courtier Deux').lastInsertRowid;
  const cli = bd.prepare(
    `INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel, telephone, adresse, ville, code_postal, responsable_id)
     VALUES (?, 'Conseil Expert inc.', 'Marie', 'Gagnon', 'marie@conseilexpert.ca', '514-555-0404', '1000 rue Sherbrooke O', 'Montréal', 'H3A 1G4', ?)`
  ).run(cabA, courtier2).lastInsertRowid;

  const sId = eo.creerSoumission({ cabinetId: cabA, userId: adminA, clientId: cli, dateEffetSouhaitee: '2026-12-01', notes: 'Test proposition E&O' });
  eo.ajouterActivite(sId, cabA, adminA, {
    description_activite: 'Conseil en transformation numérique', chiffre_affaires: 450000,
    nb_professionnels: 4, notes: 'TPE/PME',
  });
  eo.ajouterActivite(sId, cabA, adminA, {
    description_activite: 'Implantation de progiciels', chiffre_affaires: 300000,
    nb_professionnels: 3, notes: null,
  });
  eo.definirGaranties(sId, cabA, adminA, {
    limite_par_sinistre: 2000000, limite_agregat: 2000000, franchise: 10000,
    base: 'reclamations_presentees',
    avenants: { frais_defense: 1, medias_contenu: 1, cyber_associe: 0 },
    prime: 9500,
  });
  eo.definirAntecedents(sId, cabA, adminA, {
    assureur_actuel: 'Beneva', numero_police_actuelle: 'EO-2024-55310',
    date_expiration_actuelle: '2026-11-18', annees_assurance_continue: 4,
    reclamations_5ans: [{ date: '2023-04-10', nature: 'Erreur d’implantation', montant: 45000, sinistre: 1 }],
    circonstances: 'Un client insatisfait menace de poursuivre.',
    consentements: { credit: 1, dossier_assurance: 0 },
  });
  const nbVersions = eo.versionsSoumission(sId, cabA)[0].version;
  test('préparation directe OK', sId > 0 && nbVersions >= 2, `versions=${nbVersions}`);

  // ---- 1. Login admin ---------------------------------------------------------
  console.log('1. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 2. Page HTML -------------------------------------------------------------
  console.log('2. Page HTML');
  r = await req(jar, 'GET', `/eo/${sId}/proposition`);
  test('GET proposition → 200', r.statut === 200, r.statut);
  test('titre proposition E&O', /Proposition d’assurance responsabilité professionnelle/.test(r.texte));
  test('activités présentes', /Conseil en transformation numérique/.test(r.texte) && /450\s000\s\$/.test(r.texte) && /Implantation de progiciels/.test(r.texte));
  test('professionnels présents', /Professionnels<\/dt><dd><strong>4<\/strong>/.test(r.texte));
  test('garanties présentes', /Limite par sinistre<\/dt><dd><strong>2\s000\s000\s\$/.test(r.texte) && /Agrégat annuel<\/dt><dd><strong>2\s000\s000\s\$/.test(r.texte) && /Franchise<\/dt><dd>10\s000\s\$/.test(r.texte));
  test('base en libellé FR', /Base de garantie<\/dt><dd><strong>Réclamations-présentées<\/strong>/.test(r.texte));
  test('mention claims-made', /la date de déclaration compte — maintenir la continuité d’assurance/.test(r.texte));
  test('avenants présents', /Frais de défense/.test(r.texte) && /Médias et contenu/.test(r.texte));
  test('prime présente', /Prime<\/dt><dd>9\s500\s\$/.test(r.texte));
  test('réclamations présentes', /Erreur d’implantation/.test(r.texte) && /45\s000\s\$/.test(r.texte) && /réclamée/.test(r.texte) && /Réclamations E&O \(5 ans\)/.test(r.texte));
  test('circonstances présentes', /Un client insatisfait menace de poursuivre\./.test(r.texte));
  test('consentements présents', /Dossier de crédit/.test(r.texte));
  test('mention version + vérification', new RegExp(`soumission E&O #${sId}.*version v${nbVersions}`, 's').test(r.texte) && /vérifiez avant envoi/.test(r.texte));
  test('bouton Imprimer + lien PDF', /data-action="imprimer"/.test(r.texte) && /src="\/proposition\.js"/.test(r.texte) && new RegExp(`/eo/${sId}/proposition\\.pdf`).test(r.texte));
  test('CSS externe (CSP)', /href="\/proposition\.css"/.test(r.texte));
  test('pas de JS inline', !/<script(?![^>]*src=)/.test(r.texte));

  // ---- 3. Version figée ------------------------------------------------------------
  console.log('3. Version figée');
  r = await req(jar, 'GET', `/eo/${sId}/proposition?v=1`);
  test('?v=1 → 200 + mention figée', r.statut === 200 && /\(figée\)/.test(r.texte), r.statut);
  test('?v=1 = données d’époque (aucune activité)', /Aucune activité professionnelle saisie\./.test(r.texte));
  r = await req(jar, 'GET', `/eo/${sId}/proposition?v=999`);
  test('?v=999 → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/eo/99999/proposition');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 4. PDF ------------------------------------------------------------------------
  console.log('4. PDF');
  r = await req(jar, 'GET', `/eo/${sId}/proposition.pdf`);
  test('GET PDF → 200', r.statut === 200, r.statut);
  test('content-type PDF', r.contentType.includes('application/pdf'), r.contentType);
  test('en-tête %PDF', r.buf.slice(0, 4).toString() === '%PDF');
  const contenuPdf = textePdf(r.buf);
  test('activité dans le PDF', contenuPdf.includes('Conseil en transformation'));
  test('avenant dans le PDF', contenuPdf.includes('Frais de d'));
  test('mention claims-made dans le PDF', /date de d/.test(contenuPdf) && contenuPdf.includes('continuit'));
  test('mention soumission dans le PDF', contenuPdf.includes(`Soumission E&O #${sId}`));
  test('taille PDF raisonnable', r.buf.length > 3000, `${r.buf.length} octets`);

  // ---- 5. Sécurité ----------------------------------------------------------------------
  console.log('5. Sécurité');
  const { jar: jarB } = await loginComme('adminb@t.ca', 'Test1234!');
  r = await req(jarB, 'GET', `/eo/${sId}/proposition`);
  test('inter-cabinets → 404 (aucune fuite)', r.statut === 404, r.statut);
  r = await req(jarB, 'GET', `/eo/${sId}/proposition.pdf`);
  test('inter-cabinets PDF → 404 (aucune fuite)', r.statut === 404, r.statut);
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await req(jarC1, 'GET', `/eo/${sId}/proposition`);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  const { jar: jarC2 } = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jarC2, 'GET', `/eo/${sId}/proposition`);
  test('courtier du portefeuille → 200', r.statut === 200, r.statut);
  r = await req(nouveauJar(), 'GET', `/eo/${sId}/proposition`);
  test('sans login → 302 vers connexion', r.statut === 302, r.statut);

  // ---- 6. Audit ------------------------------------------------------------------------------
  console.log('6. Audit');
  const audits = bd.prepare(
    "SELECT details FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_eo_generee' ORDER BY id DESC"
  ).all(cabA);
  test('générations journalisées', audits.length >= 3, `${audits.length}`);
  test('détail avec version', audits.some((a) => new RegExp(`#${sId} \\(v${nbVersions}`).test(a.details || '')));
  const auditB = bd.prepare(
    "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_eo_generee'"
  ).get(cabB).n;
  test('aucune fuite audit vers cabinet B', auditB === 0);

  console.log(`\n${echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `❌ ${echecs} ÉCHEC(S)`} (${total} tests)`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
