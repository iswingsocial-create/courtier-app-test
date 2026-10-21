/**
 * scripts/test-exports-cyber.js — Exports cyber (étape 5/10 cyber) :
 * 3 nouveaux modules (cyber_mesures, cyber_soumissions, cyber_versions), CSV
 * (BOM, « ; », en-têtes FR), JSON structuré, garanties/avenants aplatis
 * (rançongiciel, fraude_transfert, donnees_vie_privee, interruption en 0/1),
 * archivés, périmètre courtier, aucun secret, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-exports-cyber.js
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

const MODULES_CYBER = ['cyber_mesures', 'cyber_soumissions', 'cyber_versions'];
const ENTETE_CLE = {
  cyber_mesures: 'Type de mesure', cyber_soumissions: 'Version courante', cyber_versions: 'Soumission (id)',
};

async function exporter(jar, module, format, archives = false) {
  let r = await req(jar, 'GET', '/exports');
  const form = { _csrf: csrf(r.texte), module, format };
  if (archives) form.archives = '1';
  return req(jar, 'POST', '/exports', { form });
}

(async () => {
  console.log('== Exports cyber (étape 5/10 cyber) ==');

  // 1. Login admin démo
  const jarA = nouveauJar();
  let r = await connexion(jarA, 'admin@demo.ca', 'ChangeMoi123!');
  test('login admin démo → 302', r.statut === 302, `${r.statut}`);
  r = await changerMdp(jarA, 'ChangeMoi123!', 'ExportCyber2026!');
  test('changement mdp forcé → 302', r.statut === 302, `${r.statut}`);

  // 2. Page : 36 modules (33 + 3 cautionnement)
  r = await req(jarA, 'GET', '/exports');
  test('page exports → 200', r.statut === 200, `${r.statut}`);
  const tousPresents = MODULES_CYBER.every((m) => r.texte.includes(`value="${m}"`));
  test('3 modules cyber proposés', tousPresents);
  const nbOptions = (r.texte.match(/<option value="/g) || []).length;
  test('36 modules au total', nbOptions === 36, `${nbOptions}`);

  // 3. Créer des données cyber de démo via les routes
  // 3a. Entreprise
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Cyber Export inc.', prenom: 'Cy', nom: 'Ber', langue: 'FR' },
  });
  test('entreprise créée → 302', r.statut === 302, `${r.statut}`);
  const idClient = (r.location || '').match(/\/clients\/(\d+)/)[1];

  // 3b. Soumission cyber
  r = await req(jarA, 'GET', '/cyber/nouveau');
  r = await req(jarA, 'POST', '/cyber', {
    form: { _csrf: csrf(r.texte), client_id: idClient, date_effet_souhaitee: '2026-12-01', notes: 'Soumission cyber export test' },
  });
  test('soumission cyber créée → 302', r.statut === 302, `${r.statut}`);
  const idSoum = (r.location || '').match(/\/cyber\/(\d+)/)[1];

  // 3c. Mesures de sécurité (2)
  r = await req(jarA, 'GET', '/cyber/' + idSoum);
  r = await req(jarA, 'POST', `/cyber/${idSoum}/mesure`, {
    form: {
      _csrf: csrf(r.texte), type_mesure: 'mfa', statut: 'en_place',
      details: 'MFA généralisé sur tous les accès', notes: 'Mesure export test',
    },
  });
  test('mesure mfa ajoutée → 302', r.statut === 302, `${r.statut}`);
  r = await req(jarA, 'GET', '/cyber/' + idSoum);
  r = await req(jarA, 'POST', `/cyber/${idSoum}/mesure`, {
    form: {
      _csrf: csrf(r.texte), type_mesure: 'sauvegardes', statut: 'partiel',
      details: 'Sauvegardes quotidiennes, hors site en cours',
    },
  });
  test('mesure sauvegardes ajoutée → 302', r.statut === 302, `${r.statut}`);

  // 3d. Garanties avec avenants
  r = await req(jarA, 'GET', '/cyber/' + idSoum);
  const pGar = new URLSearchParams();
  pGar.append('_csrf', csrf(r.texte));
  pGar.append('limite_par_sinistre', '1000000');
  pGar.append('limite_agregat', '2000000');
  pGar.append('franchise', '5000');
  pGar.append('delai_carence', '8 heures');
  pGar.append('avenants', 'rancongiciel');
  pGar.append('avenants', 'fraude_transfert');
  pGar.append('prime', '4200');
  const rGar = await fetch(BASE + `/cyber/${idSoum}/garanties`, {
    method: 'POST',
    headers: { ...enteteCookies(jarA), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: pGar.toString(), redirect: 'manual',
  });
  appliquerCookies(jarA, rGar);
  test('garanties + avenants → 302', rGar.status === 302, `${rGar.status}`);

  // 3e. Antécédents avec incident + consentements
  r = await req(jarA, 'GET', '/cyber/' + idSoum);
  r = await req(jarA, 'POST', `/cyber/${idSoum}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Assureur Cyber actuel inc.',
      numero_police_actuelle: 'CYB-EXP-1', date_expiration_actuelle: '2026-12-01',
      annees_assurance_continue: '4',
      incidents_json: JSON.stringify([{ date: '2024-05-12', type: 'hameçonnage', montant: '15000', reclame: 'non' }]),
      consentement_credit: 'on', consentement_dossier_assurance: 'on',
    },
  });
  test('antécédents + incident → 302', r.statut === 302, `${r.statut}`);

  // 4. Chaque module cyber en CSV
  for (const m of MODULES_CYBER) {
    r = await exporter(jarA, m, 'csv');
    const ct = r.contentType.includes('text/csv');
    const bom = r.buf.length >= 3 && r.buf[0] === 0xEF && r.buf[1] === 0xBB && r.buf[2] === 0xBF;
    const premiere = r.texte.replace(/^﻿/, '').split('\r\n')[0] || '';
    const enteteOk = premiere.includes(';') && premiere.includes(ENTETE_CLE[m]);
    test(`CSV ${m} → 200, BOM, « ; », en-tête FR`, r.statut === 200 && ct && bom && enteteOk,
      `${r.statut} entete=${premiere.slice(0, 60)}`);
  }

  // 5. Chaque module cyber en JSON
  const tousJson = [];
  for (const m of MODULES_CYBER) {
    r = await exporter(jarA, m, 'json');
    let j = null;
    try { j = JSON.parse(r.texte); } catch (e) { /* */ }
    const ok = r.statut === 200 && r.contentType.includes('application/json') && j
      && j.module === m && Array.isArray(j.donnees) && j.perimetre === 'cabinet' && typeof j.nombre === 'number';
    test(`JSON ${m} → 200, structure valide`, ok, `${r.statut}`);
    if (j) tousJson.push(r.texte);
  }

  // 6. Données vérifiées
  r = await exporter(jarA, 'cyber_mesures', 'json');
  const jMes = JSON.parse(r.texte);
  const mfa = jMes.donnees.find((m) => m.type_mesure === 'mfa' && m.soumission_id === Number(idSoum));
  test('mesure : MFA exportée', !!mfa, `${jMes.nombre}`);
  r = await exporter(jarA, 'cyber_mesures', 'csv');
  const entM = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV mesures : en-têtes FR', entM.includes('Type de mesure') && entM.includes('Maturité'));
  test('CSV mesures : libellés (pas codes bruts)',
    r.texte.includes('MFA — authentification multifacteur') && r.texte.includes('En place')
    && r.texte.includes('Sauvegardes') && r.texte.includes('Partiel'));

  r = await exporter(jarA, 'cyber_soumissions', 'json');
  const jSou = JSON.parse(r.texte);
  const sExp = jSou.donnees.find((s) => s.id === Number(idSoum));
  test('soumission : version courante + décomptes',
    !!sExp && sExp.version_courante >= 5 && sExp.nb_mesures === 2 && sExp.nb_versions >= 5,
    JSON.stringify(sExp && { v: sExp.version_courante, m: sExp.nb_mesures, nv: sExp.nb_versions }));
  test('soumission : garanties imbriquées',
    !!sExp && sExp.garanties && sExp.garanties.limite_par_sinistre === 1000000
    && sExp.garanties.limite_agregat === 2000000 && sExp.garanties.franchise === 5000
    && sExp.garanties.delai_carence === '8 heures',
    JSON.stringify(sExp && sExp.garanties));
  test('soumission : avenants (rançongiciel, fraude_transfert)',
    !!sExp && sExp.garanties.avenants.rancongiciel == 1 && sExp.garanties.avenants.fraude_transfert == 1
    && !sExp.garanties.avenants.interruption,
    JSON.stringify(sExp && sExp.garanties.avenants));
  test('soumission : incident + consentements',
    !!sExp && Array.isArray(sExp.incidents_5ans) && sExp.incidents_5ans.length === 1
    && sExp.incidents_5ans[0].type === 'hameçonnage'
    && sExp.consentements.credit == 1 && sExp.consentements.dossier_assurance == 1,
    JSON.stringify(sExp && { i: sExp.incidents_5ans, c: sExp.consentements }));
  r = await exporter(jarA, 'cyber_soumissions', 'csv');
  test('CSV soumissions : « Version courante »', r.texte.includes('Version courante'));
  const entS = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV soumissions : colonnes avenants 0/1',
    entS.includes('Avenant — rançongiciel') && entS.includes('Avenant — fraude par transfert de fonds')
    && entS.includes('Avenant — données et vie privée') && entS.includes('Avenant — interruption d’activité'));
  test('CSV soumissions : « Nb d’incidents 5 ans »', r.texte.includes('Nb d’incidents 5 ans'));

  r = await exporter(jarA, 'cyber_versions', 'json');
  const jVer = JSON.parse(r.texte);
  const vExp = jVer.donnees.filter((v) => v.soumission_id === Number(idSoum));
  test('versions : historique figé (≥5)', vExp.length >= 5, `${vExp.length}`);
  test('versions : snapshot JSON parsé (mesures, garanties, antecedents)',
    vExp.length > 0 && vExp[vExp.length - 1].donnees
    && Array.isArray(vExp[vExp.length - 1].donnees.mesures)
    && !!vExp[vExp.length - 1].donnees.garanties
    && !!vExp[vExp.length - 1].donnees.antecedents,
    JSON.stringify(vExp.length > 0 && vExp[vExp.length - 1].donnees && Object.keys(vExp[vExp.length - 1].donnees)));

  // 7. Aucun secret
  const concat = tousJson.join('\n');
  test('aucun hash ni secret exporté',
    !concat.includes('mot_de_passe_hash') && !concat.includes('totp_secret') && !concat.includes('_chiffre'));

  // 8. Archivés : exclure / inclure
  r = await req(jarA, 'GET', '/cyber/' + idSoum);
  const idMesure = (r.texte.match(/\/cyber\/mesure\/(\d+)\/archiver/) || [])[1];
  test('id de mesure trouvé sur la fiche', !!idMesure);
  r = await req(jarA, 'POST', `/cyber/mesure/${idMesure}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage mesure → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarA, 'cyber_mesures', 'json', false);
  test('mesure archivée exclue par défaut', !JSON.parse(r.texte).donnees.some((m) => String(m.id) === String(idMesure)));
  r = await exporter(jarA, 'cyber_mesures', 'json', true);
  const jArc = JSON.parse(r.texte);
  const mArc = jArc.donnees.find((m) => String(m.id) === String(idMesure));
  test('mesure archivée incluse avec la case', !!mArc && mArc.archive == 1);

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
  const idCourtier = await creerU('Courtier Cyber', 'courtiercyber@test.ca', 'courtier', 'CourtierCy1!');
  test('création courtier → ok', !!idCourtier);
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Portefeuille Cyber inc.', prenom: 'Po', nom: 'CY', langue: 'FR', responsable_id: idCourtier },
  });
  test('entreprise du courtier → 302', r.statut === 302, `${r.statut}`);
  const idClientC = (r.location || '').match(/\/clients\/(\d+)/)[1];
  const jarC = nouveauJar();
  await connexion(jarC, 'courtiercyber@test.ca', 'CourtierCy1!');
  await changerMdp(jarC, 'CourtierCy1!', 'CourtierCy2!');
  r = await req(jarC, 'GET', '/cyber/nouveau');
  r = await req(jarC, 'POST', '/cyber', {
    form: { _csrf: csrf(r.texte), client_id: idClientC, notes: 'Soumission cyber du courtier' },
  });
  test('courtier crée sa soumission cyber → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarC, 'cyber_soumissions', 'json');
  const jCS = JSON.parse(r.texte);
  test('courtier : périmètre portefeuille', jCS.perimetre === 'portefeuille', jCS.perimetre);
  test('courtier : seulement sa soumission',
    jCS.nombre === 1 && jCS.donnees[0].entreprise === 'Portefeuille Cyber inc.', `${jCS.nombre}`);
  r = await exporter(jarC, 'cyber_mesures', 'json');
  test('courtier : aucune mesure hors portefeuille', JSON.parse(r.texte).nombre === 0);

  // 10. Journal d'audit
  r = await req(jarA, 'GET', '/admin/journal');
  const nbExports = (r.texte.match(/Export cyber_/g) || []).length;
  test('journal contient les exports cyber', r.statut === 200 && nbExports >= 3, `${r.statut} (${nbExports})`);

  // 11. Module/format invalides + CSRF
  r = await exporter(jarA, 'cyber_nope', 'csv');
  test('module inconnu → 400', r.statut === 400, `${r.statut}`);
  r = await req(jarA, 'POST', '/exports', { form: { module: 'cyber_mesures', format: 'csv' } });
  test('POST sans CSRF → 403', r.statut === 403, `${r.statut}`);

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE :', e.message); process.exit(1); });
