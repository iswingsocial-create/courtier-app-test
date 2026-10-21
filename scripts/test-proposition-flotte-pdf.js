/**
 * scripts/test-proposition-flotte-pdf.js — Proposition d'assurance flotte
 * automobile pré-remplie (flotte — étape 7/10) : page HTML imprimable + PDF
 * téléchargeable, bouton « Proposition » grisé tant que la soumission est
 * incomplète, version figée (?v=), 404/403, portefeuille courtier, journal
 * d'audit, règle d'or. Miroir de scripts/test-proposition-pe-pdf.js (PE).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-proposition-flotte-pdf.js
 * (CHEMIN_BD optionnel pour l'accès direct à la base du serveur.)
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const fs = require('fs');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);
const flotte = require('../lib/flotte');

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
  console.log('== Tests proposition flotte pré-remplie (étape 7 flotte) :', BASE);

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
    `INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, titre_contact, courriel, telephone, adresse, ville, code_postal, responsable_id)
     VALUES (?, 'Logistique Boréale inc.', 'Alain', 'Boréal', 'Président', 'aboreal@logistiqueboreale.ca', '450-555-0143', '880 rue des Artisans', 'Terrebonne', 'J6W 1K3', ?)`
  ).run(cabA, courtier2).lastInsertRowid;

  // Soumission complète : 2 conducteurs, 3 véhicules, garanties, antécédents.
  const sId = flotte.creerSoumission({
    cabinetId: cabA, userId: adminA, clientId: cli,
    assureur: 'Intact Assurance', nbVehicules: 3, rayonOperationKm: 160,
    usageDominant: 'livraison', dateEffetSouhaitee: '2026-12-01',
    notes: 'Test proposition flotte',
  });
  const cond1 = flotte.ajouterConducteur(sId, cabA, adminA, {
    nom: 'Gagnon', prenom: 'Marc', date_naissance: '1985-09-23',
    numero_permis: 'G556-230985-02', classe_permis: '3',
    annees_experience: 15, annees_experience_lourds: 11, date_embauche: '2016-03-14',
    sinistres_5ans: [{ date: '2023-07-19', description: 'Accrochage en reculant dans une cour', montant: 4200, responsabilite: 'partagee' }],
    infractions_3ans: [{ date: '2024-02-02', type: 'Excès de vitesse', description: 'Excès de vitesse 20 km/h en zone urbaine', points: 3 }],
    formations: [{ formation: 'Conduite préventive', date: '2024-05-10', organisme: 'Centre de formation en transport' }],
  });
  const cond2 = flotte.ajouterConducteur(sId, cabA, adminA, {
    nom: 'Tremblay', prenom: 'Sophie', date_naissance: '1992-01-30',
    numero_permis: 'T621-300192-03', classe_permis: '5',
    annees_experience: 9, annees_experience_lourds: 0, date_embauche: '2021-08-23',
    sinistres_5ans: [], infractions_3ans: [], formations: [],
  });
  flotte.ajouterVehicule(sId, cabA, adminA, {
    niv: '1FTBW3CM5KKB12345', annee: 2022, marque: 'Ford', modele: 'Transit 250',
    type_vehicule: 'camion', usage: 'livraison', rayon_operation_km: 160,
    lieu_remisage: '880 rue des Artisans, Terrebonne', valeur: 62000, annee_acquisition: 2022,
    conducteur_principal_id: cond1,
    equipements_speciaux: [{ description: 'Hayon élévateur', valeur: 6500 }],
  });
  flotte.ajouterVehicule(sId, cabA, adminA, {
    niv: '2T1BURHE8JC045678', annee: 2020, marque: 'Toyota', modele: 'Corolla',
    type_vehicule: 'automobile', usage: 'service', rayon_operation_km: 100,
    valeur: 18500, annee_acquisition: 2020, conducteur_principal_id: cond2,
    equipements_speciaux: [],
  });
  flotte.ajouterVehicule(sId, cabA, adminA, {
    niv: '1T9UT2825NA334455', annee: 2019, marque: 'Manac', modele: 'Remorque fermée 28 pi',
    type_vehicule: 'remorque', usage: 'transport_marchandises', rayon_operation_km: 160,
    valeur: 21000, annee_acquisition: 2019, conducteur_principal_nom: 'Selon affectation',
    equipements_speciaux: [],
  });
  flotte.definirGaranties(sId, cabA, adminA, {
    limite_rc: 2000000, franchise_collision: 1000, franchise_versement: 1000,
    avenants: { faq43: 1, faq20: 0, faq27: 1, faq34: 1, faq5a: 0 }, prime: 9850,
  });
  flotte.definirAntecedents(sId, cabA, adminA, {
    assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'FLT-2023-7781',
    date_expiration_actuelle: '2026-11-30', annees_assurance_flotte_continue: 6,
    sinistres_flotte_5ans: [{ date: '2023-07-19', description: 'Accrochage en manœuvre de recul (camion Ford Transit)', montant: 4200 }],
    ratio_pertes: 18.5, refus_annulation_ant: 0,
    consentements: { credit: 1, dossier_saaq: 1, fcsa: 0 },
  });
  const nbVersions = flotte.versionsSoumission(sId, cabA)[0].version;
  test('préparation directe OK', sId > 0 && nbVersions >= 2, `versions=${nbVersions}`);

  // Soumissions incomplètes : aucune donnée / véhicule sans garanties.
  const sVide = flotte.creerSoumission({ cabinetId: cabA, userId: adminA, clientId: cli, notes: 'Vide' });
  const sMi = flotte.creerSoumission({ cabinetId: cabA, userId: adminA, clientId: cli, notes: 'Véhicule seul' });
  flotte.ajouterVehicule(sMi, cabA, adminA, {
    niv: 'JH4KA9650MC000001', annee: 2021, marque: 'Acura', modele: 'TLX',
    type_vehicule: 'automobile', usage: 'personnel', valeur: 32000,
  });

  // ---- 1. Login admin ---------------------------------------------------------
  console.log('1. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 2. Bouton Proposition sur la fiche --------------------------------------
  console.log('2. Bouton Proposition (grisé tant qu’incomplet)');
  r = await req(jar, 'GET', `/flotte/${sId}`);
  test('fiche complète → 200', r.statut === 200, r.statut);
  test('bouton Proposition actif (lien)', new RegExp(`href="/flotte/${sId}/proposition"`).test(r.texte));
  test('fiche complète : pas de bouton grisé', !/Proposition \(incomplète\)/.test(r.texte));
  r = await req(jar, 'GET', `/flotte/${sVide}`);
  test('fiche vide : bouton grisé (disabled)', /disabled[^>]*>📄 Proposition \(incomplète\)/.test(r.texte));
  test('fiche vide : aucun lien proposition', !new RegExp(`href="/flotte/${sVide}/proposition"`).test(r.texte));
  r = await req(jar, 'GET', `/flotte/${sMi}`);
  test('fiche véhicule sans garanties : bouton grisé', /Proposition \(incomplète\)/.test(r.texte)
    && !new RegExp(`href="/flotte/${sMi}/proposition"`).test(r.texte));

  // ---- 3. Page HTML -------------------------------------------------------------
  console.log('3. Page HTML');
  r = await req(jar, 'GET', `/flotte/${sId}/proposition`);
  test('GET proposition → 200', r.statut === 200, r.statut);
  test('titre proposition flotte', /Proposition d’assurance flotte automobile/.test(r.texte));
  test('entreprise cliente présente', /Logistique Boréale inc\./.test(r.texte));
  test('résumé : 3 véhicules détaillés', /Véhicules détaillés<\/dt><dd><strong>3<\/strong>/.test(r.texte));
  test('résumé : valeur totale', /Valeur totale des véhicules<\/dt><dd><strong>101\s500\s\$<\/strong>/.test(r.texte));
  test('résumé : usage dominant en libellé', /Usage dominant<\/dt><dd>Livraison<\/dd>/.test(r.texte));
  test('résumé : rayon principal', /Rayon d’opération principal<\/dt><dd>160 km<\/dd>/.test(r.texte));
  test('véhicule présent (désignation + NIV)', /2022 Ford Transit 250/.test(r.texte) && /1FTBW3CM5KKB12345/.test(r.texte));
  test('type de véhicule en libellé FR', /<td>Camion<\/td>/.test(r.texte) && /<td>Remorque<\/td>/.test(r.texte));
  test('valeur du véhicule', /62\s000\s\$/.test(r.texte));
  test('équipement spécial présent', /Hayon élévateur/.test(r.texte));
  test('conducteur présent + expérience', /Marc Gagnon/.test(r.texte) && /15 ans/.test(r.texte) && /dont 11 ans en véhicules lourds/.test(r.texte));
  test('sinistre + infraction du conducteur', /Accrochage en reculant dans une cour/.test(r.texte) && /Excès de vitesse/.test(r.texte));
  test('limite RC présente', /Limite de responsabilité civile \(chapitre A\)<\/dt><dd><strong>2\s000\s000\s\$<\/strong>/.test(r.texte));
  test('franchises présentes', /Franchise collision \/ renversement<\/dt><dd>1\s000\s\$<\/dd>/.test(r.texte)
    && /Franchise versement<\/dt><dd>1\s000\s\$<\/dd>/.test(r.texte));
  test('avenants FAQ en libellés FR', /FAQ 43 — Valeur à neuf/.test(r.texte) && /FAQ 34 — Indemnités d’accident/.test(r.texte));
  test('avenant non souscrit absent (FAQ 20)', !/FAQ 20 — Privation de jouissance/.test(r.texte));
  test('jamais les codes FAQ bruts', !/\bfaq43\b/.test(r.texte) && !/\bfaq27\b/.test(r.texte));
  test('prime présente', /Prime<\/dt><dd>9\s850\s\$/.test(r.texte));
  test('mention métier permis valide', /permis de conduire valide de la classe appropriée/.test(r.texte));
  test('mention métier véhicule déclaré', /Tout véhicule ajouté, remplacé ou retiré doit être déclaré/.test(r.texte));
  test('mention FAQ 43 valeur à neuf (souscrite)', /La FAQ 43 \(valeur à neuf\) est souscrite/.test(r.texte) && /sans dépréciation/.test(r.texte));
  test('antécédents : sinistre flotte + ratio', /Accrochage en manœuvre de recul/.test(r.texte) && /Ratio de pertes<\/dt><dd>18,5 %<\/dd>/.test(r.texte));
  test('consentements présents', /Dossier de crédit/.test(r.texte) && /Dossier SAAQ \(dossier de conduite\)/.test(r.texte));
  test('consentement non donné absent (FCSA)', !/FCSA \(sinistres automobiles\)/.test(r.texte));
  test('mention version + vérification', new RegExp(`soumission flotte #${sId}.*version v${nbVersions}`, 's').test(r.texte) && /vérifiez avant envoi/.test(r.texte));
  test('bouton Imprimer + lien PDF', /data-action="imprimer"/.test(r.texte) && /src="\/proposition\.js"/.test(r.texte) && new RegExp(`/flotte/${sId}/proposition\\.pdf`).test(r.texte));
  test('CSS externe (CSP)', /href="\/proposition\.css"/.test(r.texte));
  test('pas de JS inline', !/<script(?![^>]*src=)/.test(r.texte));

  // ---- 4. Version figée ------------------------------------------------------------
  console.log('4. Version figée');
  r = await req(jar, 'GET', `/flotte/${sId}/proposition?v=1`);
  test('?v=1 → 200 + mention figée', r.statut === 200 && /\(figée\)/.test(r.texte), r.statut);
  test('?v=1 = données d’époque (aucun véhicule)', /Aucun véhicule saisi\./.test(r.texte));
  // Ajout d’un 4e véhicule APRÈS la version nbVersions : le snapshot figé ne doit pas le contenir.
  flotte.ajouterVehicule(sId, cabA, adminA, {
    niv: '1HGCM82633A004352', annee: 2021, marque: 'Honda', modele: 'Accord',
    type_vehicule: 'automobile', usage: 'personnel', valeur: 27000,
  });
  r = await req(jar, 'GET', `/flotte/${sId}/proposition?v=${nbVersions}`);
  test(`?v=${nbVersions} = snapshot (3 véhicules, sans le 4e)`,
    /Véhicules détaillés<\/dt><dd><strong>3<\/strong>/.test(r.texte) && !/1HGCM82633A004352/.test(r.texte));
  r = await req(jar, 'GET', `/flotte/${sId}/proposition`);
  test('courante = 4 véhicules (avec le nouveau NIV)',
    /Véhicules détaillés<\/dt><dd><strong>4<\/strong>/.test(r.texte) && /1HGCM82633A004352/.test(r.texte));
  r = await req(jar, 'GET', `/flotte/${sId}/proposition?v=999`);
  test('?v=999 → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/flotte/99999/proposition');
  test('soumission inexistante → 404', r.statut === 404, r.statut);
  const versionsApresAjout = flotte.versionsSoumission(sId, cabA).length;

  // ---- 5. PDF ------------------------------------------------------------------------
  console.log('5. PDF');
  r = await req(jar, 'GET', `/flotte/${sId}/proposition.pdf`);
  test('GET PDF → 200', r.statut === 200, r.statut);
  test('content-type PDF', r.contentType.includes('application/pdf'), r.contentType);
  test('en-tête %PDF', r.buf.slice(0, 4).toString() === '%PDF');
  const contenuPdf = textePdf(r.buf);
  test('entreprise dans le PDF', contenuPdf.includes('Logistique'));
  test('véhicule dans le PDF', contenuPdf.includes('Ford') && contenuPdf.includes('Transit'));
  test('section conducteurs dans le PDF', contenuPdf.includes('Conducteurs'));
  test('avenant FAQ 43 dans le PDF', contenuPdf.includes('FAQ 43'));
  test('mention métier dans le PDF', contenuPdf.includes('permis de conduire valide'));
  test('mention soumission dans le PDF', contenuPdf.includes('flotte'));
  test('taille PDF raisonnable', r.buf.length > 3000, `${r.buf.length} octets`);
  r = await req(jar, 'GET', `/flotte/${sId}/proposition.pdf?v=1`);
  test('PDF figé ?v=1 → 200 + aucun véhicule', r.statut === 200
    && r.buf.slice(0, 4).toString() === '%PDF' && textePdf(r.buf).includes('Aucun'), r.statut);

  // ---- 6. Règle d’or --------------------------------------------------------------------
  console.log('6. Règle d’or');
  test('générations en lecture seule (aucune version créée)',
    flotte.versionsSoumission(sId, cabA).length === versionsApresAjout,
    `${versionsApresAjout} → ${flotte.versionsSoumission(sId, cabA).length}`);
  const srcProp = fs.readFileSync(__dirname + '/../lib/proposition-flotte.js', 'utf8')
    + fs.readFileSync(__dirname + '/../lib/proposition-flotte-pdf.js', 'utf8');
  test('aucun DELETE dans les modules proposition flotte', !/DELETE\s+FROM/i.test(srcProp));

  // ---- 7. Sécurité ----------------------------------------------------------------------
  console.log('7. Sécurité');
  const { jar: jarB } = await loginComme('adminb@t.ca', 'Test1234!');
  r = await req(jarB, 'GET', `/flotte/${sId}/proposition`);
  test('inter-cabinets → 404 (aucune fuite)', r.statut === 404, r.statut);
  r = await req(jarB, 'GET', `/flotte/${sId}/proposition.pdf`);
  test('inter-cabinets PDF → 404 (aucune fuite)', r.statut === 404, r.statut);
  const { jar: jarC1 } = await loginComme('courtier1@t.ca', 'Test1234!');
  r = await req(jarC1, 'GET', `/flotte/${sId}/proposition`);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  const { jar: jarC2 } = await loginComme('courtier2@t.ca', 'Test1234!');
  r = await req(jarC2, 'GET', `/flotte/${sId}/proposition`);
  test('courtier du portefeuille → 200', r.statut === 200, r.statut);
  r = await req(nouveauJar(), 'GET', `/flotte/${sId}/proposition`);
  test('sans login → 302 vers connexion', r.statut === 302, r.statut);

  // ---- 8. Audit ------------------------------------------------------------------------------
  console.log('8. Audit');
  const audits = bd.prepare(
    "SELECT details FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_flotte_generee' ORDER BY id DESC"
  ).all(cabA);
  test('générations journalisées', audits.length >= 3, `${audits.length}`);
  test('détail avec version', audits.some((a) => new RegExp(`#${sId} \\(v${nbVersions}`).test(a.details || '')));
  const auditB = bd.prepare(
    "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_flotte_generee'"
  ).get(cabB).n;
  test('aucune fuite audit vers cabinet B', auditB === 0);

  console.log(`\n${echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `❌ ${echecs} ÉCHEC(S)`} (${total} tests)`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
