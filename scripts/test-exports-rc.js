/**
 * scripts/test-exports-rc.js — Exports RC (étape 5/10 RC) :
 * 3 nouveaux modules (rc_lieux, rc_soumissions, rc_versions), CSV (BOM, « ; »,
 * en-têtes FR), JSON structuré, garanties/avenants aplatis (pollution,
 * parapluie en 0/1), archivés, périmètre courtier, aucun secret, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-exports-rc.js
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

const MODULES_RC = ['rc_lieux', 'rc_soumissions', 'rc_versions'];
const ENTETE_CLE = {
  rc_lieux: 'Activité', rc_soumissions: 'Version courante', rc_versions: 'Soumission (id)',
};

async function exporter(jar, module, format, archives = false) {
  let r = await req(jar, 'GET', '/exports');
  const form = { _csrf: csrf(r.texte), module, format };
  if (archives) form.archives = '1';
  return req(jar, 'POST', '/exports', { form });
}

(async () => {
  console.log('== Exports RC (étape 5/10 RC) ==');

  // 1. Login admin démo
  const jarA = nouveauJar();
  let r = await connexion(jarA, 'admin@demo.ca', 'ChangeMoi123!');
  test('login admin démo → 302', r.statut === 302, `${r.statut}`);
  r = await changerMdp(jarA, 'ChangeMoi123!', 'ExportRc2026!');
  test('changement mdp forcé → 302', r.statut === 302, `${r.statut}`);

  // 2. Page : 36 modules (33 + 3 cautionnement)
  r = await req(jarA, 'GET', '/exports');
  test('page exports → 200', r.statut === 200, `${r.statut}`);
  const tousPresents = MODULES_RC.every((m) => r.texte.includes(`value="${m}"`));
  test('3 modules RC proposés', tousPresents);
  const nbOptions = (r.texte.match(/<option value="/g) || []).length;
  test('36 modules au total', nbOptions === 36, `${nbOptions}`);

  // 3. Créer des données RC de démo via les routes
  // 3a. Entreprise
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'RC Export inc.', prenom: 'Er', nom: 'Cé', langue: 'FR' },
  });
  test('entreprise créée → 302', r.statut === 302, `${r.statut}`);
  const idClient = (r.location || '').match(/\/clients\/(\d+)/)[1];

  // 3b. Soumission RC
  r = await req(jarA, 'GET', '/rc/nouveau');
  r = await req(jarA, 'POST', '/rc', {
    form: { _csrf: csrf(r.texte), client_id: idClient, date_effet_souhaitee: '2026-12-01', notes: 'Soumission RC export test' },
  });
  test('soumission RC créée → 302', r.statut === 302, `${r.statut}`);
  const idSoum = (r.location || '').match(/\/rc\/(\d+)/)[1];

  // 3c. Lieu d'exploitation
  r = await req(jarA, 'GET', '/rc/' + idSoum);
  r = await req(jarA, 'POST', `/rc/${idSoum}/exploitation`, {
    form: {
      _csrf: csrf(r.texte), adresse: '789 rue Export', ville: 'Québec', code_postal: 'G1K 1A1',
      type_activite: 'Entrepreneur en construction', code_classification: '91585',
      description_activites: 'Rénovation résidentielle', chiffre_affaires: '2500000',
      masse_salariale: '800000', nb_employes: '12', superficie_pi2: '4500',
      sous_traitants: 'assures', notes: 'Lieu RC export test',
    },
  });
  test('lieu d’exploitation ajouté → 302', r.statut === 302, `${r.statut}`);

  // Récupérer l'id du lieu via l'export
  r = await exporter(jarA, 'rc_lieux', 'json');
  const jLieu0 = JSON.parse(r.texte);
  const lieu = jLieu0.donnees.find((l) => l.adresse === '789 rue Export');
  test('lieu visible dans l’export', !!lieu, `${jLieu0.nombre}`);
  const idLieu = lieu.id;

  // 3d. Garanties avec avenants (pollution + parapluie)
  r = await req(jarA, 'GET', '/rc/' + idSoum);
  const pGar = new URLSearchParams();
  pGar.append('_csrf', csrf(r.texte));
  pGar.append('formule', 'locaux_operations');
  pGar.append('limite_par_sinistre', '2000000');
  pGar.append('limite_agregat', '4000000');
  pGar.append('franchise', '2500');
  pGar.append('avenants', 'pollution');
  pGar.append('avenants', 'parapluie');
  pGar.append('prime', '5100');
  const rGar = await fetch(BASE + `/rc/${idSoum}/exploitation/${idLieu}/garanties`, {
    method: 'POST',
    headers: { ...enteteCookies(jarA), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: pGar.toString(), redirect: 'manual',
  });
  appliquerCookies(jarA, rGar);
  test('garanties + avenants → 302', rGar.status === 302, `${rGar.status}`);

  // 3e. Antécédents avec consentements
  r = await req(jarA, 'GET', '/rc/' + idSoum);
  r = await req(jarA, 'POST', `/rc/${idSoum}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Assureur RC actuel inc.', numero_police_actuelle: 'RC-456',
      date_expiration_actuelle: '2026-12-01', annees_assurance_continue: '8',
      consentement_credit: 'on', consentement_dossier_assurance: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, `${r.statut}`);

  // 4. Chaque module RC en CSV
  for (const m of MODULES_RC) {
    r = await exporter(jarA, m, 'csv');
    const ct = r.contentType.includes('text/csv');
    const bom = r.buf.length >= 3 && r.buf[0] === 0xEF && r.buf[1] === 0xBB && r.buf[2] === 0xBF;
    const premiere = r.texte.replace(/^﻿/, '').split('\r\n')[0] || '';
    const enteteOk = premiere.includes(';') && premiere.includes(ENTETE_CLE[m]);
    test(`CSV ${m} → 200, BOM, « ; », en-tête FR`, r.statut === 200 && ct && bom && enteteOk,
      `${r.statut} entete=${premiere.slice(0, 60)}`);
  }

  // 5. Chaque module RC en JSON
  const tousJson = [];
  for (const m of MODULES_RC) {
    r = await exporter(jarA, m, 'json');
    let j = null;
    try { j = JSON.parse(r.texte); } catch (e) { /* */ }
    const ok = r.statut === 200 && r.contentType.includes('application/json') && j
      && j.module === m && Array.isArray(j.donnees) && j.perimetre === 'cabinet' && typeof j.nombre === 'number';
    test(`JSON ${m} → 200, structure valide`, ok, `${r.statut}`);
    if (j) tousJson.push(r.texte);
  }

  // 6. Données vérifiées
  r = await exporter(jarA, 'rc_lieux', 'json');
  const jLieu = JSON.parse(r.texte);
  const lExp = jLieu.donnees.find((l) => l.adresse === '789 rue Export');
  test('lieu : garanties imbriquées', !!lExp && lExp.garanties && lExp.garanties.formule === 'locaux_operations',
    JSON.stringify(lExp && lExp.garanties));
  test('lieu : limites + franchise', !!lExp && lExp.garanties.limite_par_sinistre === 2000000
    && lExp.garanties.limite_agregat === 4000000 && lExp.garanties.franchise === 2500,
    JSON.stringify(lExp && lExp.garanties));
  test('lieu : avenants (pollution, parapluie)',
    !!lExp && lExp.garanties.avenants.pollution == 1 && lExp.garanties.avenants.parapluie == 1,
    JSON.stringify(lExp && lExp.garanties.avenants));
  test('lieu : activité + CA + masse salariale',
    !!lExp && lExp.type_activite === 'Entrepreneur en construction' && lExp.chiffre_affaires === 2500000
    && lExp.masse_salariale === 800000 && lExp.nb_employes === 12,
    JSON.stringify(lExp && { a: lExp.type_activite, ca: lExp.chiffre_affaires }));
  r = await exporter(jarA, 'rc_lieux', 'csv');
  const entL = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV lieux : colonnes avenants 0/1',
    entL.includes('Avenant — pollution') && entL.includes('Avenant — parapluie'));
  test('CSV lieux : formule en français', r.texte.includes('Locaux et opérations'));

  r = await exporter(jarA, 'rc_soumissions', 'json');
  const jSou = JSON.parse(r.texte);
  const sExp = jSou.donnees.find((s) => s.id === Number(idSoum));
  test('soumission : version courante + décomptes',
    !!sExp && sExp.version_courante >= 4 && sExp.nb_lieux === 1 && sExp.nb_versions >= 4,
    JSON.stringify(sExp && { v: sExp.version_courante, l: sExp.nb_lieux, nv: sExp.nb_versions }));
  test('soumission : antécédents + consentements',
    !!sExp && sExp.assureur_actuel === 'Assureur RC actuel inc.'
    && sExp.consentements.credit == 1 && sExp.consentements.dossier_assurance == 1,
    JSON.stringify(sExp && sExp.consentements));
  r = await exporter(jarA, 'rc_soumissions', 'csv');
  test('CSV soumissions : « Version courante »', r.texte.includes('Version courante'));

  r = await exporter(jarA, 'rc_versions', 'json');
  const jVer = JSON.parse(r.texte);
  const vExp = jVer.donnees.filter((v) => v.soumission_id === Number(idSoum));
  test('versions : historique figé (≥4)', vExp.length >= 4, `${vExp.length}`);
  test('versions : snapshot JSON parsé',
    vExp.length > 0 && vExp[0].donnees && Array.isArray(vExp[0].donnees.exploitations),
    JSON.stringify(vExp.length > 0 && vExp[0].donnees && Object.keys(vExp[0].donnees)));

  // 7. Aucun secret
  const concat = tousJson.join('\n');
  test('aucun hash ni secret exporté',
    !concat.includes('mot_de_passe_hash') && !concat.includes('totp_secret') && !concat.includes('_chiffre'));

  // 8. Archivés : exclure / inclure
  r = await req(jarA, 'GET', '/rc/' + idSoum);
  r = await req(jarA, 'POST', `/rc/exploitation/${idLieu}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage lieu → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarA, 'rc_lieux', 'json', false);
  test('lieu archivé exclu par défaut', !r.texte.includes('789 rue Export'));
  r = await exporter(jarA, 'rc_lieux', 'json', true);
  const jArc = JSON.parse(r.texte);
  const lArc = jArc.donnees.find((l) => l.adresse === '789 rue Export');
  test('lieu archivé inclus avec la case', !!lArc && lArc.archive == 1);

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
  const idCourtier = await creerU('Courtier RC', 'courtierrc@test.ca', 'courtier', 'CourtierRc1!');
  test('création courtier → ok', !!idCourtier);
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Portefeuille RC inc.', prenom: 'Po', nom: 'RC', langue: 'FR', responsable_id: idCourtier },
  });
  test('entreprise du courtier → 302', r.statut === 302, `${r.statut}`);
  const idClientC = (r.location || '').match(/\/clients\/(\d+)/)[1];
  const jarC = nouveauJar();
  await connexion(jarC, 'courtierrc@test.ca', 'CourtierRc1!');
  await changerMdp(jarC, 'CourtierRc1!', 'CourtierRc2!');
  r = await req(jarC, 'GET', '/rc/nouveau');
  r = await req(jarC, 'POST', '/rc', {
    form: { _csrf: csrf(r.texte), client_id: idClientC, notes: 'Soumission RC du courtier' },
  });
  test('courtier crée sa soumission RC → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarC, 'rc_soumissions', 'json');
  const jCS = JSON.parse(r.texte);
  test('courtier : périmètre portefeuille', jCS.perimetre === 'portefeuille', jCS.perimetre);
  test('courtier : seulement sa soumission',
    jCS.nombre === 1 && jCS.donnees[0].entreprise === 'Portefeuille RC inc.', `${jCS.nombre}`);
  r = await exporter(jarC, 'rc_lieux', 'json');
  test('courtier : aucun lieu hors portefeuille', JSON.parse(r.texte).nombre === 0);

  // 10. Journal d'audit
  r = await req(jarA, 'GET', '/admin/journal');
  const nbExports = (r.texte.match(/Export rc_/g) || []).length;
  test('journal contient les exports RC', r.statut === 200 && nbExports >= 3, `${r.statut} (${nbExports})`);

  // 11. Module/format invalides + CSRF
  r = await exporter(jarA, 'rc_nope', 'csv');
  test('module inconnu → 400', r.statut === 400, `${r.statut}`);
  r = await req(jarA, 'POST', '/exports', { form: { module: 'rc_lieux', format: 'csv' } });
  test('POST sans CSRF → 403', r.statut === 403, `${r.statut}`);

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE :', e.message); process.exit(1); });
