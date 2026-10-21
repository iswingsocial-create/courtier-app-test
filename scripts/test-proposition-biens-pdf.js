/**
 * scripts/test-proposition-biens-pdf.js — Proposition d'assurance biens
 * commerciaux pré-remplie (biens — étape 7/10) : page HTML imprimable +
 * PDF téléchargeable, version figée (?v=), 404/403, portefeuille courtier,
 * journal d'audit. Miroir de scripts/test-proposition-pdf.js (auto).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-proposition-biens-pdf.js
 * (CHEMIN_BD optionnel pour l'accès direct à la base du serveur.)
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);
const biens = require('../lib/biens');

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
  console.log('== Tests proposition biens pré-remplie (étape 7 biens) :', BASE);

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

  const sId = biens.creerSoumission({ cabinetId: cabA, userId: adminA, clientId: cli, dateEffetSouhaitee: '2026-12-01', notes: 'Test proposition biens' });
  const b1 = biens.ajouterBatiment(sId, cabA, adminA, {
    adresse: '123 rue Principale', ville: 'Montréal', code_postal: 'H2X 1Y1',
    type_construction: 'maconnerie', annee_construction: 1985, superficie_pi2: 5000,
    nb_etages: 2, occupation: 'Atelier mécanique', valeur_batiment: 750000,
    gicleurs: 1, distance_caserne_km: 1.5, chauffage: 'Gaz naturel', annee_toiture: 2018,
    notes: 'Bâtiment principal',
  });
  biens.definirGaranties(b1, cabA, adminA, {
    formule: 'tous_risques', franchise: 1000, montant_assurance: 750000,
    avenants: { tremblement_terre: 1, inondation: 1 }, prime: 2400,
  });
  biens.ajouterContenu(sId, cabA, adminA, {
    description: 'Pont élévateur', type_contenu: 'equipements', valeur: 45000, notes: '2 ponts',
  }, b1);
  const b2 = biens.ajouterBatiment(sId, cabA, adminA, {
    adresse: '125 rue Principale', ville: 'Montréal', type_construction: 'acier',
    superficie_pi2: 2000, occupation: 'Entrepôt', valeur_batiment: 300000,
  });
  biens.definirGaranties(b2, cabA, adminA, {
    formule: 'risques_designes', franchise: 2500, montant_assurance: 300000, avenants: {},
  });
  biens.ajouterContenu(sId, cabA, adminA, {
    description: 'Stock de pneus', type_contenu: 'stock', valeur: 120000,
  }); // contenu général (batiment_id NULL)
  biens.definirAntecedents(sId, cabA, adminA, {
    assureur_actuel: 'Assureur Actuel inc.', numero_police_actuelle: 'BI-456',
    date_expiration_actuelle: '2026-12-01', annees_assurance_continue: 8,
    sinistres_5ans: [{ date: '2021-02-14', type: 'Incendie partiel', montant: 45000 }],
    consentements: { credit: 1, dossier_assurance: 1 },
  });
  const nbVersions = biens.versionsSoumission(sId, cabA)[0].version;
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
  r = await req(jar, 'GET', `/biens/${sId}/proposition`);
  test('GET proposition → 200', r.statut === 200, r.statut);
  test('titre proposition biens', /Proposition d’assurance biens commerciaux/.test(r.texte));
  test('bâtiment présent', /123 rue Principale/.test(r.texte) && /Montréal/.test(r.texte));
  test('détails bâtiment', /Maçonnerie/.test(r.texte) && /Atelier mécanique/.test(r.texte) && /Gicleurs : Oui/.test(r.texte));
  test('garanties présentes', /Tous risques/.test(r.texte) && /750\s000 \$/.test(r.texte) && /franchise 1\s000 \$/.test(r.texte) && /Tremblement de terre/.test(r.texte) && /Inondation/.test(r.texte));
  test('contenus présents', /Pont élévateur/.test(r.texte) && /Stock de pneus/.test(r.texte) && /Équipements/.test(r.texte));
  test('second bâtiment', /125 rue Principale/.test(r.texte) && /Risques désignés/.test(r.texte));
  test('antécédents présents', /Assureur Actuel inc\./.test(r.texte) && /Incendie partiel/.test(r.texte) && /Sinistres \(5 ans\)/.test(r.texte));
  test('consentements présents', /Dossier de crédit/.test(r.texte) && /Dossier d’assurance/.test(r.texte));
  test('mention version + vérification', new RegExp(`soumission biens #${sId}.*version v${nbVersions}`, 's').test(r.texte) && /vérifiez avant envoi/.test(r.texte));
  test('bouton Imprimer + lien PDF', /data-action="imprimer"/.test(r.texte) && /src="\/proposition\.js"/.test(r.texte) && new RegExp(`/biens/${sId}/proposition\\.pdf`).test(r.texte));
  test('CSS externe (CSP)', /href="\/proposition\.css"/.test(r.texte));

  // ---- 3. Version figée ------------------------------------------------------------
  console.log('3. Version figée');
  r = await req(jar, 'GET', `/biens/${sId}/proposition?v=1`);
  test('?v=1 → 200 + mention figée', r.statut === 200 && /\(figée\)/.test(r.texte), r.statut);
  r = await req(jar, 'GET', `/biens/${sId}/proposition?v=999`);
  test('?v=999 → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/biens/99999/proposition');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 4. PDF ------------------------------------------------------------------------
  console.log('4. PDF');
  r = await req(jar, 'GET', `/biens/${sId}/proposition.pdf`);
  test('GET PDF → 200', r.statut === 200, r.statut);
  test('content-type PDF', r.contentType.includes('application/pdf'), r.contentType);
  test('en-tête %PDF', r.buf.slice(0, 4).toString() === '%PDF');
  const contenuPdf = textePdf(r.buf);
  test('bâtiment dans le PDF', contenuPdf.includes('123 rue Principale'));
  test('garantie dans le PDF', contenuPdf.includes('Tremblement de terre'));
  test('mention soumission dans le PDF', contenuPdf.includes(`Soumission #${sId}`));
  test('taille PDF raisonnable', r.buf.length > 3000, `${r.buf.length} octets`);

  // ---- 5. Sécurité ----------------------------------------------------------------------
  console.log('5. Sécurité');
  const { jar: jarB } = await loginComme('adminb@t.ca', 'Test1234!');
  r = await req(jarB, 'GET', `/biens/${sId}/proposition`);
  test('inter-cabinets → 404 (aucune fuite)', r.statut === 404, r.statut);
  r = await req(jarB, 'GET', `/biens/${sId}/proposition.pdf`);
  test('inter-cabinets PDF → 404 (aucune fuite)', r.statut === 404, r.statut);
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await req(jarC1, 'GET', `/biens/${sId}/proposition`);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  const { jar: jarC2 } = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jarC2, 'GET', `/biens/${sId}/proposition`);
  test('courtier du portefeuille → 200', r.statut === 200, r.statut);
  r = await req(nouveauJar(), 'GET', `/biens/${sId}/proposition`);
  test('sans login → 302 vers connexion', r.statut === 302, r.statut);

  // ---- 6. Audit ------------------------------------------------------------------------------
  console.log('6. Audit');
  const audits = bd.prepare(
    "SELECT details FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_biens_generee' ORDER BY id DESC"
  ).all(cabA);
  test('générations journalisées', audits.length >= 3, `${audits.length}`);
  test('détail avec version', audits.some((a) => new RegExp(`#${sId} \\(v${nbVersions}`).test(a.details || '')));
  const auditB = bd.prepare(
    "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_biens_generee'"
  ).get(cabB).n;
  test('aucune fuite audit vers cabinet B', auditB === 0);

  console.log(`\n${echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `❌ ${echecs} ÉCHEC(S)`} (${total} tests)`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
