/**
 * scripts/test-proposition-pdf.js — Proposition d'assurance auto pré-remplie (étape 7/10) :
 * page HTML imprimable + PDF téléchargeable, version figée (?v=), 404/403,
 * portefeuille courtier, journal d'audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-proposition-pdf.js
 * (CHEMIN_BD optionnel pour l'accès direct à la base du serveur.)
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);
const fpq1 = require('../lib/fpq1');

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

(async () => {
  console.log('== Tests proposition pré-remplie (étape 7) :', BASE);

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
     VALUES (?, 'Garage Test inc.', 'Hélène', 'Côté', 'helene@garagetest.ca', '514-555-0101', '123 rue Principale', 'Montréal', 'H2X 1Y1', ?)`
  ).run(cabA, courtier2).lastInsertRowid;

  const sId = fpq1.creerSoumission({ cabinetId: cabA, userId: adminA, clientId: cli, dateEffetSouhaitee: '2026-12-01', notes: 'Test proposition' });
  fpq1.ajouterConducteur(sId, cabA, adminA, {
    nom: 'Côté', prenom: 'Hélène', date_naissance: '1985-03-12', numero_permis: 'C1234567',
    date_obtention_permis: '2003-06-01', annees_experience_ca: 20, lien_assure: 'propriétaire',
    conducteur_principal: 1, infractions: [{ date: '2022-05-01', type: 'Excès de vitesse', points: 2 }],
  });
  fpq1.ajouterConducteur(sId, cabA, adminA, { nom: 'Tremblay', prenom: 'Jean', numero_permis: 'T7654321' });
  const v1 = fpq1.ajouterVehicule(sId, cabA, adminA, {
    annee: 2022, marque: 'Honda', modele: 'CR-V', vin: 'VINTEST001', financement: 'finance',
    creancier_nom: 'Banque Test', usage: 'promenade', km_annuel: 15000, antivol_tag: 1, pneus_hiver: 1,
  });
  fpq1.definirGaranties(v1, cabA, adminA, {
    rc_montant: 2000000, protection_b: 'b1', franchise_b: 500, avenants: { faq43: 1, faq20: 1 },
  });
  fpq1.ajouterVehicule(sId, cabA, adminA, { annee: 2019, marque: 'Mazda', modele: 'Mazda3', vin: 'VINTEST002' });
  fpq1.definirAntecedents(sId, cabA, adminA, {
    assureur_actuel: 'Assureur Actuel inc.', numero_police_actuelle: 'AA-123', annees_assurance_continue: 8,
    sinistres_6ans: [{ date: '2021-02-14', type: 'Collision', montant: 3200 }],
    consentements: { credit: 1, fcsa: 1 },
  });
  const nbVersions = fpq1.versionsSoumission(sId, cabA)[0].version;
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
  r = await req(jar, 'GET', `/auto/${sId}/proposition`);
  test('GET proposition → 200', r.statut === 200, r.statut);
  test('titre proposition FPQ1', /Proposition d’assurance automobile/.test(r.texte));
  test('nom du conducteur présent', /Hélène/.test(r.texte) && /Côté/.test(r.texte));
  test('véhicule présent', /Honda/.test(r.texte) && /CR-V/.test(r.texte) && /VINTEST001/.test(r.texte));
  test('garanties présentes', /2 000 000 \$/.test(r.texte) && /B1 — Tous risques/.test(r.texte) && /FAQ 43 — Valeur à neuf/.test(r.texte));
  test('antécédents présents', /Assureur Actuel inc\./.test(r.texte) && /Collision/.test(r.texte));
  test('consentements présents', /FCSA/.test(r.texte));
  test('mention version + vérification', new RegExp(`soumission #${sId}.*version v${nbVersions}`, 's').test(r.texte) && /vérifiez avant envoi/.test(r.texte));
  test('bouton Imprimer + lien PDF', /data-action="imprimer"/.test(r.texte) && /src="\/proposition\.js"/.test(r.texte) && new RegExp(`/auto/${sId}/proposition\\.pdf`).test(r.texte));
  test('CSS externe (CSP)', /href="\/proposition\.css"/.test(r.texte));

  // ---- 3. Version figée ------------------------------------------------------------
  console.log('3. Version figée');
  r = await req(jar, 'GET', `/auto/${sId}/proposition?v=1`);
  test('?v=1 → 200 + mention figée', r.statut === 200 && /\(figée\)/.test(r.texte), r.statut);
  r = await req(jar, 'GET', `/auto/${sId}/proposition?v=999`);
  test('?v=999 → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/auto/99999/proposition');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 4. PDF ------------------------------------------------------------------------
  console.log('4. PDF');
  r = await req(jar, 'GET', `/auto/${sId}/proposition.pdf`);
  test('GET PDF → 200', r.statut === 200, r.statut);
  test('content-type PDF', r.contentType.includes('application/pdf'), r.contentType);
  test('en-tête %PDF', r.buf.slice(0, 4).toString() === '%PDF');
  const contenuPdf = textePdf(r.buf);
  test('nom du conducteur dans le PDF', contenuPdf.includes('Hélène') && contenuPdf.includes('Côté'));
  test('véhicule dans le PDF', contenuPdf.includes('Honda') && contenuPdf.includes('VINTEST001'));
  test('mention soumission dans le PDF', contenuPdf.includes(`Soumission #${sId}`));
  test('taille PDF raisonnable', r.buf.length > 3000, `${r.buf.length} octets`);

  // ---- 5. Sécurité ----------------------------------------------------------------------
  console.log('5. Sécurité');
  const { jar: jarB } = await loginComme('adminb@t.ca', 'Test1234!');
  r = await req(jarB, 'GET', `/auto/${sId}/proposition`);
  test('inter-cabinets → 404 (aucune fuite)', r.statut === 404, r.statut);
  r = await req(jarB, 'GET', `/auto/${sId}/proposition.pdf`);
  test('inter-cabinets PDF → 404 (aucune fuite)', r.statut === 404, r.statut);
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await req(jarC1, 'GET', `/auto/${sId}/proposition`);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  const { jar: jarC2 } = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jarC2, 'GET', `/auto/${sId}/proposition`);
  test('courtier du portefeuille → 200', r.statut === 200, r.statut);
  r = await req(nouveauJar(), 'GET', `/auto/${sId}/proposition`);
  test('sans login → 302 vers connexion', r.statut === 302, r.statut);

  // ---- 6. Audit ------------------------------------------------------------------------------
  console.log('6. Audit');
  const audits = bd.prepare(
    "SELECT details FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_generee' ORDER BY id DESC"
  ).all(cabA);
  test('générations journalisées', audits.length >= 3, `${audits.length}`);
  test('détail avec version', audits.some((a) => new RegExp(`#${sId} \\(v${nbVersions}`).test(a.details || '')));
  const auditB = bd.prepare(
    "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_generee'"
  ).get(cabB).n;
  test('aucune fuite audit vers cabinet B', auditB === 0);

  console.log(`\n${echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `❌ ${echecs} ÉCHEC(S)`} (${total} tests)`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
