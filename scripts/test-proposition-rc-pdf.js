/**
 * scripts/test-proposition-rc-pdf.js — Proposition d'assurance responsabilité
 * civile pré-remplie (RC — étape 7/10) : page HTML imprimable + PDF
 * téléchargeable, version figée (?v=), 404/403, portefeuille courtier,
 * journal d'audit. Miroir de scripts/test-proposition-biens-pdf.js (biens).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-proposition-rc-pdf.js
 * (CHEMIN_BD optionnel pour l'accès direct à la base du serveur.)
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);
const rc = require('../lib/rc');

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
  console.log('== Tests proposition RC pré-remplie (étape 7 RC) :', BASE);

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
     VALUES (?, 'Transport Nord inc.', 'Jean', 'Lavoie', 'jean@transportnord.ca', '514-555-0202', '789 avenue du Parc', 'Laval', 'H7N 2G4', ?)`
  ).run(cabA, courtier2).lastInsertRowid;

  const sId = rc.creerSoumission({ cabinetId: cabA, userId: adminA, clientId: cli, dateEffetSouhaitee: '2026-12-01', notes: 'Test proposition RC' });
  const e1 = rc.ajouterExploitation(sId, cabA, adminA, {
    adresse: '789 avenue du Parc', ville: 'Laval', code_postal: 'H7N 2G4',
    type_activite: 'Transport de marchandises', code_classification: 'TR-214',
    description_activites: 'Transport local de marchandises diverses',
    chiffre_affaires: 2500000, masse_salariale: 800000, nb_employes: 12,
    superficie_pi2: 8000, sous_traitants: 'assures', notes: 'Lieu principal',
  });
  rc.definirGaranties(e1, cabA, adminA, {
    formule: 'locaux_operations', limite_par_sinistre: 2000000, limite_agregat: 4000000,
    franchise: 1000, avenants: { pollution: 1, parapluie: 1 }, prime: 3200,
  });
  const e2 = rc.ajouterExploitation(sId, cabA, adminA, {
    adresse: '12 rue des Entreprises', ville: 'Brossard',
    type_activite: 'Fabrication de pièces', chiffre_affaires: 900000,
    sous_traitants: 'aucun',
  });
  rc.definirGaranties(e2, cabA, adminA, {
    formule: 'produits_completes', limite_par_sinistre: 1000000, limite_agregat: 2000000,
    franchise: 2500, avenants: {},
  });
  rc.definirAntecedents(sId, cabA, adminA, {
    assureur_actuel: 'Assureur Actuel inc.', numero_police_actuelle: 'RC-789',
    date_expiration_actuelle: '2026-12-01', annees_assurance_continue: 5,
    sinistres_5ans: [{ date: '2022-06-10', type: 'Chute d’objet', montant: 12000 }],
    consentements: { credit: 1, dossier_assurance: 1 },
  });
  const nbVersions = rc.versionsSoumission(sId, cabA)[0].version;
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
  r = await req(jar, 'GET', `/rc/${sId}/proposition`);
  test('GET proposition → 200', r.statut === 200, r.statut);
  test('titre proposition RC', /Proposition d’assurance responsabilité civile/.test(r.texte));
  test('lieu présent', /789 avenue du Parc/.test(r.texte) && /Laval/.test(r.texte));
  test('détails lieu', /Transport de marchandises/.test(r.texte) && /TR-214/.test(r.texte) && /Sous-traitants<\/dt><dd>Assurés/.test(r.texte));
  test('garanties présentes', /Locaux et opérations/.test(r.texte) && /2\s000\s000 \$/.test(r.texte) && /Agrégat général<\/dt><dd>4\s000\s000 \$/.test(r.texte) && /Franchise<\/dt><dd>1\s000 \$/.test(r.texte) && /Pollution/.test(r.texte) && /Parapluie/.test(r.texte));
  test('second lieu', /12 rue des Entreprises/.test(r.texte) && /Produits et opérations complétées/.test(r.texte));
  test('antécédents présents', /Assureur Actuel inc\./.test(r.texte) && /Chute d’objet/.test(r.texte) && /Sinistres \(5 ans\)/.test(r.texte));
  test('consentements présents', /Dossier de crédit/.test(r.texte) && /Dossier d’assurance/.test(r.texte));
  test('mention version + vérification', new RegExp(`soumission RC #${sId}.*version v${nbVersions}`, 's').test(r.texte) && /vérifiez avant envoi/.test(r.texte));
  test('bouton Imprimer + lien PDF', /data-action="imprimer"/.test(r.texte) && /src="\/proposition\.js"/.test(r.texte) && new RegExp(`/rc/${sId}/proposition\\.pdf`).test(r.texte));
  test('CSS externe (CSP)', /href="\/proposition\.css"/.test(r.texte));

  // ---- 3. Version figée ------------------------------------------------------------
  console.log('3. Version figée');
  r = await req(jar, 'GET', `/rc/${sId}/proposition?v=1`);
  test('?v=1 → 200 + mention figée', r.statut === 200 && /\(figée\)/.test(r.texte), r.statut);
  r = await req(jar, 'GET', `/rc/${sId}/proposition?v=999`);
  test('?v=999 → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/rc/99999/proposition');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 4. PDF ------------------------------------------------------------------------
  console.log('4. PDF');
  r = await req(jar, 'GET', `/rc/${sId}/proposition.pdf`);
  test('GET PDF → 200', r.statut === 200, r.statut);
  test('content-type PDF', r.contentType.includes('application/pdf'), r.contentType);
  test('en-tête %PDF', r.buf.slice(0, 4).toString() === '%PDF');
  const contenuPdf = textePdf(r.buf);
  test('lieu dans le PDF', contenuPdf.includes('789 avenue du Parc'));
  test('garantie dans le PDF', contenuPdf.includes('Pollution'));
  test('mention soumission dans le PDF', contenuPdf.includes(`Soumission #${sId}`));
  test('taille PDF raisonnable', r.buf.length > 3000, `${r.buf.length} octets`);

  // ---- 5. Sécurité ----------------------------------------------------------------------
  console.log('5. Sécurité');
  const { jar: jarB } = await loginComme('adminb@t.ca', 'Test1234!');
  r = await req(jarB, 'GET', `/rc/${sId}/proposition`);
  test('inter-cabinets → 404 (aucune fuite)', r.statut === 404, r.statut);
  r = await req(jarB, 'GET', `/rc/${sId}/proposition.pdf`);
  test('inter-cabinets PDF → 404 (aucune fuite)', r.statut === 404, r.statut);
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await req(jarC1, 'GET', `/rc/${sId}/proposition`);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  const { jar: jarC2 } = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jarC2, 'GET', `/rc/${sId}/proposition`);
  test('courtier du portefeuille → 200', r.statut === 200, r.statut);
  r = await req(nouveauJar(), 'GET', `/rc/${sId}/proposition`);
  test('sans login → 302 vers connexion', r.statut === 302, r.statut);

  // ---- 6. Audit ------------------------------------------------------------------------------
  console.log('6. Audit');
  const audits = bd.prepare(
    "SELECT details FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_rc_generee' ORDER BY id DESC"
  ).all(cabA);
  test('générations journalisées', audits.length >= 3, `${audits.length}`);
  test('détail avec version', audits.some((a) => new RegExp(`#${sId} \\(v${nbVersions}`).test(a.details || '')));
  const auditB = bd.prepare(
    "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_rc_generee'"
  ).get(cabB).n;
  test('aucune fuite audit vers cabinet B', auditB === 0);

  console.log(`\n${echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `❌ ${echecs} ÉCHEC(S)`} (${total} tests)`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
