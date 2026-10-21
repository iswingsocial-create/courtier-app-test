/**
 * scripts/test-exports-biens.js — Exports biens (étape 5/10 biens) :
 * 4 nouveaux modules (biens_batiments, biens_contenus, biens_soumissions,
 * biens_versions), CSV (BOM, « ; », en-têtes FR), JSON structuré,
 * garanties/avenants aplatis, archivés, périmètre courtier, aucun secret, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-exports-biens.js
 */
const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;

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
  return paires.length ? { 'Cookie': paires.join('; ') } : {};
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
  const texte = buf.toString('utf8');
  return { statut: res.status, texte, buf, location: res.headers.get('location'), contentType: res.headers.get('content-type') || '' };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function test(nom, condition, detail) {
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
async function connexion(jar, email, mdp) {
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  return r;
}
async function changerMdp(jar, actuel, nouveau) {
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel, nouveau, confirmation: nouveau } });
  return r;
}

const MODULES_BIENS = ['biens_batiments', 'biens_contenus', 'biens_soumissions', 'biens_versions'];
const ENTETE_CLE = {
  biens_batiments: 'Adresse', biens_contenus: 'Bâtiment rattaché',
  biens_soumissions: 'Nb bâtiments', biens_versions: 'Soumission (id)',
};

async function exporter(jar, module, format, archives = false) {
  let r = await req(jar, 'GET', '/exports');
  const form = { _csrf: csrf(r.texte), module, format };
  if (archives) form.archives = '1';
  return req(jar, 'POST', '/exports', { form });
}

(async () => {
  console.log('== Exports biens (étape 5/10 biens) ==');

  // 1. Login admin démo
  const jarA = nouveauJar();
  let r = await connexion(jarA, 'admin@demo.ca', 'ChangeMoi123!');
  test('login admin démo → 302', r.statut === 302, `${r.statut}`);
  r = await changerMdp(jarA, 'ChangeMoi123!', 'ExportBiens2026!');
  test('changement mdp forcé → 302', r.statut === 302, `${r.statut}`);

  // 2. Page : 36 modules (33 + 3 cautionnement)
  r = await req(jarA, 'GET', '/exports');
  test('page exports → 200', r.statut === 200, `${r.statut}`);
  const tousPresents = MODULES_BIENS.every((m) => r.texte.includes(`value="${m}"`));
  test('4 modules biens proposés', tousPresents);
  const nbOptions = (r.texte.match(/<option value="/g) || []).length;
  test('36 modules au total', nbOptions === 36, `${nbOptions}`);

  // 3. Créer des données biens de démo via les routes
  // 3a. Entreprise
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Biens Export inc.', prenom: 'Bi', nom: 'Ens', langue: 'FR' },
  });
  test('entreprise créée → 302', r.statut === 302, `${r.statut}`);
  const idClient = (r.location || '').match(/\/clients\/(\d+)/)[1];

  // 3b. Soumission biens
  r = await req(jarA, 'GET', '/biens/nouveau');
  r = await req(jarA, 'POST', '/biens', {
    form: { _csrf: csrf(r.texte), client_id: idClient, date_effet_souhaitee: '2026-12-01', notes: 'Soumission export test' },
  });
  test('soumission biens créée → 302', r.statut === 302, `${r.statut}`);
  const idSoum = (r.location || '').match(/\/biens\/(\d+)/)[1];

  // 3c. Bâtiment
  r = await req(jarA, 'GET', '/biens/' + idSoum);
  r = await req(jarA, 'POST', `/biens/${idSoum}/batiment`, {
    form: {
      _csrf: csrf(r.texte), adresse: '123 rue Export', ville: 'Montréal', code_postal: 'H2X 1Y1',
      type_construction: 'beton', annee_construction: '2005', superficie_pi2: '10000', nb_etages: '2',
      occupation: 'Bureaux', valeur_batiment: '1500000', gicleurs: 'on', distance_caserne_km: '1.5',
      chauffage: 'Électrique', annee_toiture: '2020', notes: 'Bâtiment export test',
    },
  });
  test('bâtiment ajouté → 302', r.statut === 302, `${r.statut}`);

  // Récupérer l'id du bâtiment via l'export
  r = await exporter(jarA, 'biens_batiments', 'json');
  const jBat0 = JSON.parse(r.texte);
  const bat = jBat0.donnees.find((b) => b.adresse === '123 rue Export');
  test('bâtiment visible dans l’export', !!bat, `${jBat0.nombre}`);
  const idBat = bat.id;

  // 3d. Garanties avec avenants (clés courtes)
  r = await req(jarA, 'GET', '/biens/' + idSoum);
  const pGar = new URLSearchParams();
  pGar.append('_csrf', csrf(r.texte));
  pGar.append('formule', 'tous_risques');
  pGar.append('franchise', '1000');
  pGar.append('montant_assurance', '1500000');
  pGar.append('avenants', 'tremblement_terre');
  pGar.append('avenants', 'inondation');
  pGar.append('prime', '3200');
  const rGar = await fetch(BASE + `/biens/${idSoum}/batiment/${idBat}/garanties`, {
    method: 'POST',
    headers: { ...enteteCookies(jarA), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: pGar.toString(), redirect: 'manual',
  });
  appliquerCookies(jarA, rGar);
  test('garanties + avenants → 302', rGar.status === 302, `${rGar.status}`);

  // 3e. Contenu rattaché au bâtiment + contenu général
  r = await req(jarA, 'GET', '/biens/' + idSoum);
  r = await req(jarA, 'POST', `/biens/${idSoum}/contenu`, {
    form: { _csrf: csrf(r.texte), batiment_id: String(idBat), description: 'Mobilier de bureau', type_contenu: 'mobilier', valeur: '75000', notes: '' },
  });
  test('contenu rattaché → 302', r.statut === 302, `${r.statut}`);
  r = await req(jarA, 'GET', '/biens/' + idSoum);
  r = await req(jarA, 'POST', `/biens/${idSoum}/contenu`, {
    form: { _csrf: csrf(r.texte), description: 'Stock entrepôt', type_contenu: 'stock', valeur: '200000', notes: '' },
  });
  test('contenu général → 302', r.statut === 302, `${r.statut}`);

  // 3f. Antécédents avec consentements
  r = await req(jarA, 'GET', '/biens/' + idSoum);
  r = await req(jarA, 'POST', `/biens/${idSoum}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Assureur Actuel inc.', numero_police_actuelle: 'B-789',
      date_expiration_actuelle: '2026-12-01', annees_assurance_continue: '6',
      consentement_credit: 'on', consentement_dossier_assurance: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, `${r.statut}`);

  // 4. Chaque module biens en CSV
  for (const m of MODULES_BIENS) {
    r = await exporter(jarA, m, 'csv');
    const ct = r.contentType.includes('text/csv');
    const bom = r.buf.length >= 3 && r.buf[0] === 0xEF && r.buf[1] === 0xBB && r.buf[2] === 0xBF;
    const premiere = r.texte.replace(/^﻿/, '').split('\r\n')[0] || '';
    const enteteOk = premiere.includes(';') && premiere.includes(ENTETE_CLE[m]);
    test(`CSV ${m} → 200, BOM, « ; », en-tête FR`, r.statut === 200 && ct && bom && enteteOk,
      `${r.statut} entete=${premiere.slice(0, 60)}`);
  }

  // 5. Chaque module biens en JSON
  const tousJson = [];
  for (const m of MODULES_BIENS) {
    r = await exporter(jarA, m, 'json');
    let j = null;
    try { j = JSON.parse(r.texte); } catch (e) { /* */ }
    const ok = r.statut === 200 && r.contentType.includes('application/json') && j
      && j.module === m && Array.isArray(j.donnees) && j.perimetre === 'cabinet' && typeof j.nombre === 'number';
    test(`JSON ${m} → 200, structure valide`, ok, `${r.statut}`);
    if (j) tousJson.push(r.texte);
  }

  // 6. Données vérifiées
  r = await exporter(jarA, 'biens_batiments', 'json');
  const jBat = JSON.parse(r.texte);
  const bExp = jBat.donnees.find((b) => b.adresse === '123 rue Export');
  test('bâtiment : garanties imbriquées', !!bExp && bExp.garanties && bExp.garanties.formule === 'tous_risques', JSON.stringify(bExp && bExp.garanties));
  test('bâtiment : avenants (tremblement_terre, inondation)',
    !!bExp && bExp.garanties.avenants.tremblement_terre == 1 && bExp.garanties.avenants.inondation == 1,
    JSON.stringify(bExp && bExp.garanties.avenants));
  r = await exporter(jarA, 'biens_batiments', 'csv');
  const entB = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV bâtiments : colonnes avenants 0/1',
    entB.includes('Avenant — tremblement de terre') && entB.includes('Avenant — inondation'));
  test('CSV bâtiments : formule en français', r.texte.includes('Tous risques'));

  r = await exporter(jarA, 'biens_contenus', 'json');
  const jCon = JSON.parse(r.texte);
  const cGen = jCon.donnees.find((c) => c.description === 'Stock entrepôt');
  const cRat = jCon.donnees.find((c) => c.description === 'Mobilier de bureau');
  test('contenu général (sans bâtiment)', !!cGen && cGen.batiment_id === null, `${jCon.nombre}`);
  test('contenu rattaché au bâtiment', !!cRat && cRat.batiment_id === idBat && cRat.batiment_adresse === '123 rue Export');
  r = await exporter(jarA, 'biens_contenus', 'csv');
  test('CSV contenus : « Contenu général »', r.texte.includes('Contenu général'));

  r = await exporter(jarA, 'biens_soumissions', 'json');
  const jSou = JSON.parse(r.texte);
  const sExp = jSou.donnees.find((s) => s.id === Number(idSoum));
  test('soumission : décomptes', !!sExp && sExp.nb_batiments === 1 && sExp.nb_contenus === 2 && sExp.nb_versions >= 5,
    JSON.stringify(sExp && { b: sExp.nb_batiments, c: sExp.nb_contenus, v: sExp.nb_versions }));
  test('soumission : antécédents + consentements',
    !!sExp && sExp.assureur_actuel === 'Assureur Actuel inc.' && sExp.consentements.credit == 1 && sExp.consentements.dossier_assurance == 1,
    JSON.stringify(sExp && sExp.consentements));

  r = await exporter(jarA, 'biens_versions', 'json');
  const jVer = JSON.parse(r.texte);
  const vExp = jVer.donnees.filter((v) => v.soumission_id === Number(idSoum));
  test('versions : historique figé (≥5)', vExp.length >= 5, `${vExp.length}`);
  test('versions : snapshot JSON parsé', vExp.length > 0 && vExp[0].donnees && Array.isArray(vExp[0].donnees.batiments));

  // 7. Aucun secret
  const concat = tousJson.join('\n');
  test('aucun hash ni secret exporté',
    !concat.includes('mot_de_passe_hash') && !concat.includes('totp_secret') && !concat.includes('_chiffre'));

  // 8. Archivés : exclure / inclure
  r = await req(jarA, 'GET', '/biens/' + idSoum);
  r = await req(jarA, 'POST', `/biens/batiment/${idBat}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage bâtiment → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarA, 'biens_batiments', 'json', false);
  test('bâtiment archivé exclu par défaut', !r.texte.includes('123 rue Export'));
  r = await exporter(jarA, 'biens_batiments', 'json', true);
  const jArc = JSON.parse(r.texte);
  const bArc = jArc.donnees.find((b) => b.adresse === '123 rue Export');
  test('bâtiment archivé inclus avec la case', !!bArc && bArc.archive == 1);

  // 9. Périmètre courtier
  const creerU = async (nom, email, role, mdp) => {
    let rr = await req(jarA, 'GET', '/admin/utilisateurs/nouveau');
    rr = await req(jarA, 'POST', '/admin/utilisateurs', {
      form: { _csrf: csrf(rr.texte), nom, email, cabinet_id: '1', role, mot_de_passe: mdp },
    });
    if (rr.statut !== 302) return null;
    rr = await req(jarA, 'GET', '/admin/utilisateurs');
    const m = rr.texte.match(new RegExp(email.replace(/\./g, '\\.') + '[\\s\\S]*?\\/admin\\/utilisateurs\\/(\\d+)\\/desactiver'));
    return m ? m[1] : null;
  };
  const idCourtier = await creerU('Courtier Biens', 'courtierbiens@test.ca', 'courtier', 'CourtierBiens1!');
  test('création courtier → ok', !!idCourtier);
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Portefeuille Biens inc.', prenom: 'Po', nom: 'Biens', langue: 'FR', responsable_id: idCourtier },
  });
  test('entreprise du courtier → 302', r.statut === 302, `${r.statut}`);
  const idClientC = (r.location || '').match(/\/clients\/(\d+)/)[1];
  const jarC = nouveauJar();
  await connexion(jarC, 'courtierbiens@test.ca', 'CourtierBiens1!');
  await changerMdp(jarC, 'CourtierBiens1!', 'CourtierBiens2!');
  r = await req(jarC, 'GET', '/biens/nouveau');
  r = await req(jarC, 'POST', '/biens', {
    form: { _csrf: csrf(r.texte), client_id: idClientC, notes: 'Soumission du courtier' },
  });
  test('courtier crée sa soumission biens → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarC, 'biens_soumissions', 'json');
  const jCS = JSON.parse(r.texte);
  test('courtier : périmètre portefeuille', jCS.perimetre === 'portefeuille', jCS.perimetre);
  test('courtier : seulement sa soumission',
    jCS.nombre === 1 && jCS.donnees[0].entreprise === 'Portefeuille Biens inc.', `${jCS.nombre}`);
  r = await exporter(jarC, 'biens_batiments', 'json');
  test('courtier : aucun bâtiment hors portefeuille', JSON.parse(r.texte).nombre === 0);

  // 10. Journal d'audit
  r = await req(jarA, 'GET', '/admin/journal');
  const nbExports = (r.texte.match(/Export biens_/g) || []).length;
  test('journal contient les exports biens', r.statut === 200 && nbExports >= 4, `${r.statut} (${nbExports})`);

  // 11. Module/format invalides
  r = await exporter(jarA, 'biens_nope', 'csv');
  test('module inconnu → 400', r.statut === 400, `${r.statut}`);

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE :', e.message); process.exit(1); });
