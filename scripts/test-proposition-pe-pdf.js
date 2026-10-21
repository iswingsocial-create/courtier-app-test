/**
 * scripts/test-proposition-pe-pdf.js — Proposition d'assurance perte
 * d'exploitation / interruption des affaires pré-remplie (PE — étape 7/10) :
 * page HTML imprimable + PDF téléchargeable, version figée (?v=), 404/403,
 * portefeuille courtier, journal d'audit. Miroir de
 * scripts/test-proposition-do-pdf.js (D&O).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-proposition-pe-pdf.js
 * (CHEMIN_BD optionnel pour l'accès direct à la base du serveur.)
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);
const pesoum = require('../lib/pe');

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
  console.log('== Tests proposition PE pré-remplie (étape 7 PE) :', BASE);

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
     VALUES (?, 'Boulangerie Chaleur inc.', 'Robert', 'Chaleur', 'rc@boulangeriechaleur.ca', '514-555-0274', '123 rue Sainte-Catherine E', 'Montréal', 'H2H 2S7', ?)`
  ).run(cabA, courtier2).lastInsertRowid;

  const sId = pesoum.creerSoumission({ cabinetId: cabA, userId: adminA, clientId: cli, dateEffetSouhaitee: '2026-12-01', notes: 'Test proposition PE' });
  pesoum.ajouterEtablissement(sId, cabA, adminA, {
    nom_lieu: 'Fournil', adresse: '123 rue Sainte-Catherine E, Montréal',
    occupation: 'Boulangerie — fournil', chiffre_affaires: 750000, superficie: 250,
    annee_construction: 1965, base_valeur: 'remplacement',
  });
  pesoum.ajouterEtablissement(sId, cabA, adminA, {
    nom_lieu: 'Magasin', adresse: '4800 boul. Saint-Laurent, Montréal',
    occupation: 'Commerce de détail — pain et pâtisseries', chiffre_affaires: 450000, superficie: 120,
    annee_construction: 1965, base_valeur: 'remplacement',
  });
  pesoum.definirGaranties(sId, cabA, adminA, {
    limite: 800000, periode_indemnite_mois: 12, franchise_jours: 3,
    base_montant: 'marge_brute',
    avenants: { frais_supplementaires: 1, dependance_fournisseurs: 0, acces_civil: 0, deterioration_stocks: 1 },
    prime: 2800,
  });
  pesoum.definirAntecedents(sId, cabA, adminA, {
    assureur_actuel: 'Beneva', numero_police_actuelle: 'PE-2022-4410',
    date_expiration_actuelle: '2026-11-29', annees_assurance_continue: 4,
    interruptions_5ans: [{ date: '2022-03-11', cause: 'Bris d’équipement (four)', duree_jours: 6, montant: 28000 }],
    consentements: { credit: 1, dossier_assurance: 0 },
  });
  const nbVersions = pesoum.versionsSoumission(sId, cabA)[0].version;
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
  r = await req(jar, 'GET', `/pe/${sId}/proposition`);
  test('GET proposition → 200', r.statut === 200, r.statut);
  test('titre proposition PE', /Proposition d’assurance perte d’exploitation/.test(r.texte));
  test('établissements présents', /Fournil/.test(r.texte) && /Boulangerie — fournil/.test(r.texte) && /Magasin/.test(r.texte));
  test('CA et superficie présents', /750\s000\s\$/.test(r.texte) && /250 m²/.test(r.texte));
  test('base de valeur en libellé', /Coût de remplacement/.test(r.texte));
  test('limite présente', /Limite<\/dt><dd><strong>800\s000\s\$/.test(r.texte));
  test('période d’indemnité en libellé', /Période d’indemnité<\/dt><dd><strong>12 mois<\/strong>/.test(r.texte));
  test('franchise en jours (carence)', /Franchise \(délai de carence\)<\/dt><dd>3 jours<\/dd>/.test(r.texte));
  test('base en libellé FR (jamais le code)', /Base d’indemnité<\/dt><dd><strong>Marge brute<\/strong>/.test(r.texte) && !/marge_brute/.test(r.texte));
  test('mention métier période/carence', /une période trop courte épuise la limite avant la reprise/.test(r.texte) && /délai de carence en jours/.test(r.texte));
  test('avenants présents', /Frais supplémentaires/.test(r.texte) && /Détérioration des stocks/.test(r.texte));
  test('prime présente', /Prime<\/dt><dd>2\s800\s\$/.test(r.texte));
  test('interruptions présentes', /Bris d’équipement \(four\)/.test(r.texte) && /28\s000\s\$/.test(r.texte) && /6 jours/.test(r.texte) && /Interruptions \(5 ans\)/.test(r.texte));
  test('consentements présents', /Dossier de crédit/.test(r.texte));
  test('mention version + vérification', new RegExp(`soumission perte d’exploitation #${sId}.*version v${nbVersions}`, 's').test(r.texte) && /vérifiez avant envoi/.test(r.texte));
  test('bouton Imprimer + lien PDF', /data-action="imprimer"/.test(r.texte) && /src="\/proposition\.js"/.test(r.texte) && new RegExp(`/pe/${sId}/proposition\\.pdf`).test(r.texte));
  test('CSS externe (CSP)', /href="\/proposition\.css"/.test(r.texte));
  test('pas de JS inline', !/<script(?![^>]*src=)/.test(r.texte));

  // ---- 3. Version figée ------------------------------------------------------------
  console.log('3. Version figée');
  r = await req(jar, 'GET', `/pe/${sId}/proposition?v=1`);
  test('?v=1 → 200 + mention figée', r.statut === 200 && /\(figée\)/.test(r.texte), r.statut);
  test('?v=1 = données d’époque (aucun établissement)', /Aucun établissement saisi\./.test(r.texte));
  r = await req(jar, 'GET', `/pe/${sId}/proposition?v=999`);
  test('?v=999 → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/pe/99999/proposition');
  test('soumission inexistante → 404', r.statut === 404, r.statut);

  // ---- 4. PDF ------------------------------------------------------------------------
  console.log('4. PDF');
  r = await req(jar, 'GET', `/pe/${sId}/proposition.pdf`);
  test('GET PDF → 200', r.statut === 200, r.statut);
  test('content-type PDF', r.contentType.includes('application/pdf'), r.contentType);
  test('en-tête %PDF', r.buf.slice(0, 4).toString() === '%PDF');
  const contenuPdf = textePdf(r.buf);
  test('établissement dans le PDF', contenuPdf.includes('Fournil'));
  test('mention métier dans le PDF', contenuPdf.includes('retour complet') && contenuPdf.includes('avant la reprise'));
  test('mention soumission dans le PDF', contenuPdf.includes(`perte d`));
  test('taille PDF raisonnable', r.buf.length > 3000, `${r.buf.length} octets`);

  // ---- 5. Sécurité ----------------------------------------------------------------------
  console.log('5. Sécurité');
  const { jar: jarB } = await loginComme('adminb@t.ca', 'Test1234!');
  r = await req(jarB, 'GET', `/pe/${sId}/proposition`);
  test('inter-cabinets → 404 (aucune fuite)', r.statut === 404, r.statut);
  r = await req(jarB, 'GET', `/pe/${sId}/proposition.pdf`);
  test('inter-cabinets PDF → 404 (aucune fuite)', r.statut === 404, r.statut);
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await req(jarC1, 'GET', `/pe/${sId}/proposition`);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  const { jar: jarC2 } = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jarC2, 'GET', `/pe/${sId}/proposition`);
  test('courtier du portefeuille → 200', r.statut === 200, r.statut);
  r = await req(nouveauJar(), 'GET', `/pe/${sId}/proposition`);
  test('sans login → 302 vers connexion', r.statut === 302, r.statut);

  // ---- 6. Audit ------------------------------------------------------------------------------
  console.log('6. Audit');
  const audits = bd.prepare(
    "SELECT details FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_pe_generee' ORDER BY id DESC"
  ).all(cabA);
  test('générations journalisées', audits.length >= 3, `${audits.length}`);
  test('détail avec version', audits.some((a) => new RegExp(`#${sId} \\(v${nbVersions}`).test(a.details || '')));
  const auditB = bd.prepare(
    "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_pe_generee'"
  ).get(cabB).n;
  test('aucune fuite audit vers cabinet B', auditB === 0);

  console.log(`\n${echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `❌ ${echecs} ÉCHEC(S)`} (${total} tests)`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
