/**
 * scripts/test-exports.js — Exports CSV/JSON par module (étape 5/10) :
 * page, formats, en-têtes FR, BOM, périmètre courtier, case archivés,
 * aucun secret exporté, CSRF, 403 non connecté, journal d'audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-exports.js
 */
const BASE = `http://localhost:${process.env.PORT || 3101}`;
const fs = require('fs');
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
async function creerUtilisateur(jarAdmin, { nom, email, role, mdp }) {
  let r = await req(jarAdmin, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jarAdmin, 'POST', '/admin/utilisateurs', {
    form: { _csrf: csrf(r.texte), nom, email, cabinet_id: '1', role, mot_de_passe: mdp },
  });
  if (r.statut !== 302) return { ok: false, statut: r.statut };
  r = await req(jarAdmin, 'GET', '/admin/utilisateurs');
  const m = r.texte.match(new RegExp(email.replace(/\./g, '\\.') + '[\\s\\S]*?\\/admin\\/utilisateurs\\/(\\d+)\\/desactiver'));
  return { ok: true, id: m ? m[1] : null };
}

const MODULES_ATTENDUS = ['entreprises', 'polices', 'police_versions', 'conducteurs', 'vehicules',
  'soumissions', 'reclamations', 'factures', 'taches', 'leads', 'assureurs'];
const ENTETE_CLE = {
  entreprises: 'Raison sociale', polices: 'Numéro de police', police_versions: 'N° de police',
  conducteurs: 'N° de permis', vehicules: 'NIV', soumissions: 'Nb conducteurs',
  reclamations: 'N° de réclamation', factures: 'N° de facture', taches: 'Assignée à',
  leads: 'Besoin exprimé', assureurs: 'Produits offerts',
};

async function exporter(jar, module, format, archives = false) {
  let r = await req(jar, 'GET', '/exports');
  const form = { _csrf: csrf(r.texte), module, format };
  if (archives) form.archives = '1';
  return req(jar, 'POST', '/exports', { form });
}

(async () => {
  console.log('== Exports CSV/JSON (étape 5/10) ==');

  // 1. Non connecté → 302
  let r = await req(nouveauJar(), 'GET', '/exports');
  test('GET /exports non connecté → 302', r.statut === 302, `${r.statut}`);

  // 2. Login admin démo + changement forcé (la session reste active après)
  const jarA = nouveauJar();
  r = await connexion(jarA, 'admin@demo.ca', 'ChangeMoi123!');
  test('login admin démo → 302', r.statut === 302, `${r.statut}`);
  r = await changerMdp(jarA, 'ChangeMoi123!', 'ExportTest2026!');
  test('changement mdp forcé → 302', r.statut === 302, `${r.statut} ${r.location}`);
  r = await req(jarA, 'GET', '/exports');
  test('session active après changement mdp', r.statut === 200, `${r.statut}`);

  r = await req(jarA, 'GET', '/exports');
  test('page exports → 200', r.statut === 200 && r.texte.includes('Exports'), `${r.statut}`);
  const modulesPresents = MODULES_ATTENDUS.every((m) => r.texte.includes(`value="${m}"`));
  test('11 modules proposés', modulesPresents);

  // 3. CSRF exigé
  r = await req(jarA, 'POST', '/exports', { form: { module: 'entreprises', format: 'csv' } });
  test('POST sans CSRF → 403', r.statut === 403, `${r.statut}`);

  // 4. Chaque module en CSV
  for (const m of MODULES_ATTENDUS) {
    r = await exporter(jarA, m, 'csv');
    const ct = r.contentType.includes('text/csv');
    const bom = r.buf.length >= 3 && r.buf[0] === 0xEF && r.buf[1] === 0xBB && r.buf[2] === 0xBF;
    const premiere = r.texte.replace(/^﻿/, '').split('\r\n')[0] || '';
    const enteteOk = premiere.includes(';') && premiere.includes(ENTETE_CLE[m]);
    test(`CSV ${m} → 200, BOM, « ; », en-tête FR`, r.statut === 200 && ct && bom && enteteOk,
      `${r.statut} ct=${r.contentType} entete=${premiere.slice(0, 60)}`);
  }

  // 5. Chaque module en JSON
  const tousJson = [];
  for (const m of MODULES_ATTENDUS) {
    r = await exporter(jarA, m, 'json');
    let j = null;
    try { j = JSON.parse(r.texte); } catch (e) { /* */ }
    const ok = r.statut === 200 && r.contentType.includes('application/json') && j
      && j.module === m && Array.isArray(j.donnees) && j.perimetre === 'cabinet' && typeof j.nombre === 'number';
    test(`JSON ${m} → 200, structure valide`, ok, `${r.statut}`);
    if (j) tousJson.push(r.texte);
  }

  // 6. Aucun secret dans les exports
  const concat = tousJson.join('\n');
  const sansSecrets = !concat.includes('mot_de_passe_hash') && !concat.includes('totp_secret')
    && !concat.includes('mot_de_passe_chiffre') && !concat.includes('access_chiffre') && !concat.includes('refresh_chiffre');
  test('aucun hash ni secret exporté', sansSecrets);

  // 7. Données présentes (seed démo)
  r = await exporter(jarA, 'entreprises', 'json');
  const jEnt = JSON.parse(r.texte);
  test('entreprises démo exportées (≥3)', jEnt.nombre >= 3, `${jEnt.nombre}`);
  test('consentements Loi 25 présents', jEnt.donnees[0] && jEnt.donnees[0].consentements !== undefined);
  r = await exporter(jarA, 'vehicules', 'json');
  const jVeh = JSON.parse(r.texte);
  test('véhicules avec garanties', jVeh.nombre >= 1 && jVeh.donnees[0].garanties !== undefined, `${jVeh.nombre}`);
  r = await exporter(jarA, 'assureurs', 'json');
  const jAss = JSON.parse(r.texte);
  test('assureurs avec produits', jAss.nombre >= 1 && Array.isArray(jAss.donnees[0].produits), `${jAss.nombre}`);

  // 8. Case « inclure les archivés »
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Archive Test inc.', prenom: 'Al', nom: 'Archivé', langue: 'FR' },
  });
  test('création entreprise test → 302', r.statut === 302, `${r.statut}`);
  const idArch = (r.location || '').match(/\/clients\/(\d+)/);
  test('id entreprise récupéré', !!idArch);
  r = await req(jarA, 'GET', '/exports');
  r = await req(jarA, 'POST', `/clients/${idArch[1]}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage entreprise → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarA, 'entreprises', 'json', false);
  test('archivée exclue par défaut', !r.texte.includes('Archive Test inc.'));
  r = await exporter(jarA, 'entreprises', 'json', true);
  test('archivée incluse avec la case', r.texte.includes('Archive Test inc.'));

  // 9. Périmètre courtier
  const cu = await creerUtilisateur(jarA, { nom: 'Courtier Export', email: 'courtierexport@test.ca', role: 'courtier', mdp: 'CourtierExport1!' });
  test('création courtier → 302', cu.ok, `${cu.statut}`);
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Portefeuille Courtier inc.', prenom: 'Po', nom: 'Rtefeuille', langue: 'FR', responsable_id: cu.id },
  });
  test('entreprise assignée au courtier → 302', r.statut === 302, `${r.statut}`);
  const jarC = nouveauJar();
  await connexion(jarC, 'courtierexport@test.ca', 'CourtierExport1!');
  await changerMdp(jarC, 'CourtierExport1!', 'CourtierExport2!');
  r = await req(jarC, 'GET', '/exports');
  test('courtier connecté après changement mdp', r.statut === 200, `${r.statut}`);
  r = await exporter(jarC, 'entreprises', 'json');
  const jC = JSON.parse(r.texte);
  test('courtier : périmètre portefeuille', jC.perimetre === 'portefeuille', jC.perimetre);
  const raisons = jC.donnees.map((d) => d.raison_sociale);
  test('courtier : seulement son entreprise', raisons.length === 1 && raisons[0] === 'Portefeuille Courtier inc.', raisons.join(','));
  r = await exporter(jarC, 'polices', 'json');
  const jPC = JSON.parse(r.texte);
  test('courtier : aucune police hors portefeuille', jPC.nombre === 0, `${jPC.nombre}`);
  r = await exporter(jarC, 'assureurs', 'json');
  test('courtier : référentiel assureurs accessible', r.statut === 200 && JSON.parse(r.texte).nombre >= 1);

  // 10. Round-trip avenants (clés courtes unifiées) : UI → export CSV → import → conservés
  const ecsv = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const parseCsvLigne = (ligne) => {
    const vals = []; let cur = '', guil = false;
    for (let i = 0; i < ligne.length; i++) {
      const c = ligne[i];
      if (guil) {
        if (c === '"') { if (ligne[i + 1] === '"') { cur += '"'; i++; } else guil = false; }
        else cur += c;
      } else if (c === '"') guil = true;
      else if (c === ';') { vals.push(cur); cur = ''; }
      else cur += c;
    }
    vals.push(cur); return vals;
  };
  r = await exporter(jarA, 'vehicules', 'json');
  const jV0 = JSON.parse(r.texte);
  const veh0 = jV0.donnees[0];
  test('véhicule démo pour round-trip', !!veh0 && !!veh0.soumission_id && !!veh0.vin, 'aucun véhicule');
  // 10a. Poser des garanties via la route UI (convention clés courtes faq43/faq20)
  r = await req(jarA, 'GET', '/auto/' + veh0.soumission_id);
  const pGar = new URLSearchParams();
  pGar.append('_csrf', csrf(r.texte));
  pGar.append('rc_montant', '2000000');
  pGar.append('protection_b', 'b1');
  pGar.append('franchise_b', '500');
  pGar.append('avenants', 'faq43');
  pGar.append('avenants', 'faq20');
  const rGar = await fetch(BASE + `/auto/${veh0.soumission_id}/vehicule/${veh0.id}/garanties`, {
    method: 'POST',
    headers: { ...enteteCookies(jarA), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: pGar.toString(), redirect: 'manual',
  });
  appliquerCookies(jarA, rGar);
  test('garanties UI avec avenants faq43+faq20 → 302', rGar.status === 302, `${rGar.status}`);
  // 10b. L'export CSV reflète les avenants (colonnes clés courtes)
  r = await exporter(jarA, 'vehicules', 'csv');
  const lignesCsv = r.texte.replace(/^﻿/, '').split('\r\n').filter((l) => l.length);
  const ent = parseCsvLigne(lignesCsv[0]);
  const i43 = ent.indexOf('Avenant FAQ 43 (valeur à neuf)');
  const i20 = ent.indexOf('Avenant FAQ 20 (privation de jouissance)');
  const iNiv = ent.indexOf('NIV');
  test('en-têtes avenants FR (clés courtes)', i43 > 0 && i20 > 0 && iNiv > 0, lignesCsv[0].slice(0, 70));
  const rawVeh = lignesCsv.slice(1).find((l) => parseCsvLigne(l)[iNiv] === veh0.vin);
  const colsVeh = rawVeh ? parseCsvLigne(rawVeh) : null;
  test('export CSV reflète les avenants posés via l’UI', !!colsVeh && colsVeh[i43] === '1' && colsVeh[i20] === '1',
    colsVeh ? `${colsVeh[i43]},${colsVeh[i20]}` : 'ligne introuvable');
  // 10c. Réimporter la ligne exportée (NIV modifié) → avenants conservés
  const vinImp = '2HKRW2H54NH999999';
  colsVeh[iNiv] = vinImp;
  const csvImp = '﻿' + ['type', ...ent].map(ecsv).join(';') + '\r\n'
    + ['vehicule', ...colsVeh].map(ecsv).join(';') + '\r\n';
  fs.writeFileSync('/tmp/roundtrip-avenants.csv', csvImp, 'utf8');
  r = await req(jarA, 'GET', '/import');
  const fd = new FormData();
  fd.append('_csrf', csrf(r.texte));
  fd.append('fichier', new Blob([fs.readFileSync('/tmp/roundtrip-avenants.csv')], { type: 'text/csv' }), 'roundtrip.csv');
  const rImp = await fetch(BASE + '/import', { method: 'POST', headers: enteteCookies(jarA), body: fd, redirect: 'manual' });
  appliquerCookies(jarA, rImp);
  const txtImp = Buffer.from(await rImp.arrayBuffer()).toString('utf8');
  test('import de la ligne exportée → 200 + véhicule créé', rImp.status === 200 && /ajouté/.test(txtImp), `${rImp.status}`);
  r = await exporter(jarA, 'vehicules', 'json');
  const jV1 = JSON.parse(r.texte);
  const vehImp = jV1.donnees.find((v) => v.vin === vinImp);
  const avImp = vehImp && vehImp.garanties && vehImp.garanties.avenants;
  test('round-trip : avenants conservés (faq43, faq20)', !!avImp && avImp.faq43 == 1 && avImp.faq20 == 1, JSON.stringify(avImp));

  // 11. Journal d'audit
  r = await req(jarA, 'GET', '/admin/journal');
  test('journal contient les exports', r.statut === 200 && (r.texte.match(/Export /g) || []).length >= 5, `${r.statut}`);

  // 12. Module/format invalides → 400
  r = await exporter(jarA, 'nope', 'csv');
  test('module inconnu → 400', r.statut === 400, `${r.statut}`);
  r = await exporter(jarA, 'entreprises', 'xml');
  test('format inconnu → 400', r.statut === 400, `${r.statut}`);

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE :', e.message); process.exit(1); });
