/**
 * scripts/test-exports-eo.js — Exports E&O (étape 5/10 E&O) :
 * 3 nouveaux modules (eo_activites, eo_soumissions, eo_versions), CSV
 * (BOM, « ; », en-têtes FR), JSON structuré, garanties/avenants aplatis
 * (frais_defense, medias_contenu, cyber_associe en 0/1), base en libellé FR,
 * archivés, périmètre courtier, aucun secret, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-exports-eo.js
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

const MODULES_EO = ['eo_activites', 'eo_soumissions', 'eo_versions'];
const ENTETE_CLE = {
  eo_activites: 'Activité professionnelle', eo_soumissions: 'Version courante', eo_versions: 'Soumission (id)',
};

async function exporter(jar, module, format, archives = false) {
  let r = await req(jar, 'GET', '/exports');
  const form = { _csrf: csrf(r.texte), module, format };
  if (archives) form.archives = '1';
  return req(jar, 'POST', '/exports', { form });
}

(async () => {
  console.log('== Exports E&O (étape 5/10 E&O) ==');

  // 1. Login admin démo
  const jarA = nouveauJar();
  let r = await connexion(jarA, 'admin@demo.ca', 'ChangeMoi123!');
  test('login admin démo → 302', r.statut === 302, `${r.statut}`);
  r = await changerMdp(jarA, 'ChangeMoi123!', 'ExportEo2026!');
  test('changement mdp forcé → 302', r.statut === 302, `${r.statut}`);

  // 2. Page : 36 modules (33 + 3 cautionnement)
  r = await req(jarA, 'GET', '/exports');
  test('page exports → 200', r.statut === 200, `${r.statut}`);
  const tousPresents = MODULES_EO.every((m) => r.texte.includes(`value="${m}"`));
  test('3 modules E&O proposés', tousPresents);
  const nbOptions = (r.texte.match(/<option value="/g) || []).length;
  test('36 modules au total', nbOptions === 36, `${nbOptions}`);

  // 3. Créer des données E&O de démo via les routes
  // 3a. Entreprise
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'E&O Export inc.', prenom: 'Ex', nom: 'Po', langue: 'FR' },
  });
  test('entreprise créée → 302', r.statut === 302, `${r.statut}`);
  const idClient = (r.location || '').match(/\/clients\/(\d+)/)[1];

  // 3b. Soumission E&O
  r = await req(jarA, 'GET', '/eo/nouveau');
  r = await req(jarA, 'POST', '/eo', {
    form: { _csrf: csrf(r.texte), client_id: idClient, date_effet_souhaitee: '2026-12-01', notes: 'Soumission E&O export test' },
  });
  test('soumission E&O créée → 302', r.statut === 302, `${r.statut}`);
  const idSoum = (r.location || '').match(/\/eo\/(\d+)/)[1];

  // 3c. Activités professionnelles (2)
  r = await req(jarA, 'GET', '/eo/' + idSoum);
  r = await req(jarA, 'POST', `/eo/${idSoum}/activite`, {
    form: {
      _csrf: csrf(r.texte), description_activite: 'Tenue de livres et états financiers',
      chiffre_affaires: '475000', nb_professionnels: '5', notes: 'Activité export test',
    },
  });
  test('activité tenue de livres ajoutée → 302', r.statut === 302, `${r.statut}`);
  r = await req(jarA, 'GET', '/eo/' + idSoum);
  r = await req(jarA, 'POST', `/eo/${idSoum}/activite`, {
    form: {
      _csrf: csrf(r.texte), description_activite: 'Conseil fiscal',
      chiffre_affaires: '180000', nb_professionnels: '2',
    },
  });
  test('activité conseil fiscal ajoutée → 302', r.statut === 302, `${r.statut}`);

  // 3d. Garanties avec base claims-made + avenants
  r = await req(jarA, 'GET', '/eo/' + idSoum);
  const pGar = new URLSearchParams();
  pGar.append('_csrf', csrf(r.texte));
  pGar.append('limite_par_sinistre', '2000000');
  pGar.append('limite_agregat', '2000000');
  pGar.append('franchise', '10000');
  pGar.append('base', 'reclamations_presentees');
  pGar.append('avenants', 'frais_defense');
  pGar.append('avenants', 'medias_contenu');
  pGar.append('prime', '9500');
  const rGar = await fetch(BASE + `/eo/${idSoum}/garanties`, {
    method: 'POST',
    headers: { ...enteteCookies(jarA), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: pGar.toString(), redirect: 'manual',
  });
  appliquerCookies(jarA, rGar);
  test('garanties + base claims-made + avenants → 302', rGar.status === 302, `${rGar.status}`);

  // 3e. Antécédents avec réclamation + circonstances + consentements
  r = await req(jarA, 'GET', '/eo/' + idSoum);
  r = await req(jarA, 'POST', `/eo/${idSoum}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Assureur E&O actuel inc.',
      numero_police_actuelle: 'EO-EXP-1', date_expiration_actuelle: '2026-12-01',
      annees_assurance_continue: '4',
      reclamations_json: JSON.stringify([{ date: '2023-10-04', nature: 'Erreur d’implantation', montant: '45000', sinistre: 'Oui' }]),
      circonstances: 'Un client insatisfait menace de poursuivre.',
      consentement_credit: 'on', consentement_dossier_assurance: 'on',
    },
  });
  test('antécédents + réclamation + circonstances → 302', r.statut === 302, `${r.statut}`);

  // 4. Chaque module E&O en CSV
  for (const m of MODULES_EO) {
    r = await exporter(jarA, m, 'csv');
    const ct = r.contentType.includes('text/csv');
    const bom = r.buf.length >= 3 && r.buf[0] === 0xEF && r.buf[1] === 0xBB && r.buf[2] === 0xBF;
    const premiere = r.texte.replace(/^﻿/, '').split('\r\n')[0] || '';
    const enteteOk = premiere.includes(';') && premiere.includes(ENTETE_CLE[m]);
    test(`CSV ${m} → 200, BOM, « ; », en-tête FR`, r.statut === 200 && ct && bom && enteteOk,
      `${r.statut} entete=${premiere.slice(0, 60)}`);
  }

  // 5. Chaque module E&O en JSON
  const tousJson = [];
  for (const m of MODULES_EO) {
    r = await exporter(jarA, m, 'json');
    let j = null;
    try { j = JSON.parse(r.texte); } catch (e) { /* */ }
    const ok = r.statut === 200 && r.contentType.includes('application/json') && j
      && j.module === m && Array.isArray(j.donnees) && j.perimetre === 'cabinet' && typeof j.nombre === 'number';
    test(`JSON ${m} → 200, structure valide`, ok, `${r.statut}`);
    if (j) tousJson.push(r.texte);
  }

  // 6. Données vérifiées
  r = await exporter(jarA, 'eo_activites', 'json');
  const jAct = JSON.parse(r.texte);
  const tenueLivres = jAct.donnees.find((a) => a.description_activite === 'Tenue de livres et états financiers' && a.soumission_id === Number(idSoum));
  test('activité : tenue de livres exportée (CA, pros)', !!tenueLivres && tenueLivres.chiffre_affaires === 475000 && tenueLivres.nb_professionnels === 5,
    JSON.stringify(tenueLivres && { ca: tenueLivres.chiffre_affaires, pro: tenueLivres.nb_professionnels }));
  r = await exporter(jarA, 'eo_activites', 'csv');
  const entA = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV activités : en-têtes FR', entA.includes('Activité professionnelle') && entA.includes('Chiffre d’affaires ($)') && entA.includes('Nb de professionnels'));
  test('CSV activités : lignes des 2 activités', r.texte.includes('Tenue de livres') && r.texte.includes('Conseil fiscal'));

  r = await exporter(jarA, 'eo_soumissions', 'json');
  const jSou = JSON.parse(r.texte);
  const sExp = jSou.donnees.find((s) => s.id === Number(idSoum));
  test('soumission : version courante + décomptes',
    !!sExp && sExp.version_courante >= 5 && sExp.nb_activites === 2 && sExp.nb_versions >= 5,
    JSON.stringify(sExp && { v: sExp.version_courante, a: sExp.nb_activites, nv: sExp.nb_versions }));
  test('soumission : garanties imbriquées',
    !!sExp && sExp.garanties && sExp.garanties.limite_par_sinistre === 2000000
    && sExp.garanties.limite_agregat === 2000000 && sExp.garanties.franchise === 10000
    && sExp.garanties.base === 'reclamations_presentees' && sExp.garanties.prime === 9500,
    JSON.stringify(sExp && sExp.garanties));
  test('soumission : avenants (frais_defense, medias_contenu)',
    !!sExp && sExp.garanties.avenants.frais_defense == 1 && sExp.garanties.avenants.medias_contenu == 1
    && !sExp.garanties.avenants.cyber_associe,
    JSON.stringify(sExp && sExp.garanties.avenants));
  test('soumission : réclamation + circonstances + consentements',
    !!sExp && Array.isArray(sExp.reclamations_5ans) && sExp.reclamations_5ans.length === 1
    && sExp.reclamations_5ans[0].nature.includes('implantation')
    && sExp.circonstances.includes('insatisfait')
    && sExp.consentements.credit == 1 && sExp.consentements.dossier_assurance == 1,
    JSON.stringify(sExp && { rec: sExp.reclamations_5ans, circ: sExp.circonstances, c: sExp.consentements }));
  r = await exporter(jarA, 'eo_soumissions', 'csv');
  test('CSV soumissions : « Version courante »', r.texte.includes('Version courante'));
  const entS = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV soumissions : colonnes avenants 0/1',
    entS.includes('Avenant — frais de défense') && entS.includes('Avenant — médias et contenu')
    && entS.includes('Avenant — cyber associé'));
  test('CSV soumissions : « Base de garantie » en libellé FR', r.texte.includes('Réclamations-présentées'));
  test('CSV soumissions : « Nb de réclamations 5 ans »', r.texte.includes('Nb de réclamations 5 ans'));
  test('CSV soumissions : « Circonstances déclarées »', r.texte.includes('Circonstances déclarées'));

  r = await exporter(jarA, 'eo_versions', 'json');
  const jVer = JSON.parse(r.texte);
  const vExp = jVer.donnees.filter((v) => v.soumission_id === Number(idSoum));
  test('versions : historique figé (≥5)', vExp.length >= 5, `${vExp.length}`);
  test('versions : snapshot JSON parsé (activites, garanties, antecedents)',
    vExp.length > 0 && vExp[vExp.length - 1].donnees
    && Array.isArray(vExp[vExp.length - 1].donnees.activites)
    && !!vExp[vExp.length - 1].donnees.garanties
    && !!vExp[vExp.length - 1].donnees.antecedents,
    JSON.stringify(vExp.length > 0 && vExp[vExp.length - 1].donnees && Object.keys(vExp[vExp.length - 1].donnees)));

  // 7. Aucun secret
  const concat = tousJson.join('\n');
  test('aucun hash ni secret exporté',
    !concat.includes('mot_de_passe_hash') && !concat.includes('totp_secret') && !concat.includes('_chiffre'));

  // 8. Archivés : exclure / inclure
  r = await req(jarA, 'GET', '/eo/' + idSoum);
  const idAct = (r.texte.match(/\/eo\/activite\/(\d+)\/archiver/) || [])[1];
  test('id d’activité trouvé sur la fiche', !!idAct);
  r = await req(jarA, 'POST', `/eo/activite/${idAct}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage activité → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarA, 'eo_activites', 'json', false);
  test('activité archivée exclue par défaut', !JSON.parse(r.texte).donnees.some((a) => String(a.id) === String(idAct)));
  r = await exporter(jarA, 'eo_activites', 'json', true);
  const jArc = JSON.parse(r.texte);
  const aArc = jArc.donnees.find((a) => String(a.id) === String(idAct));
  test('activité archivée incluse avec la case', !!aArc && aArc.archive == 1);

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
  const idCourtier = await creerU('Courtier E&O', 'courtiereo@test.ca', 'courtier', 'CourtierEo1!');
  test('création courtier → ok', !!idCourtier);
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Portefeuille E&O inc.', prenom: 'Po', nom: 'EO', langue: 'FR', responsable_id: idCourtier },
  });
  test('entreprise du courtier → 302', r.statut === 302, `${r.statut}`);
  const idClientC = (r.location || '').match(/\/clients\/(\d+)/)[1];
  const jarC = nouveauJar();
  await connexion(jarC, 'courtiereo@test.ca', 'CourtierEo1!');
  await changerMdp(jarC, 'CourtierEo1!', 'CourtierEo2!');
  r = await req(jarC, 'GET', '/eo/nouveau');
  r = await req(jarC, 'POST', '/eo', {
    form: { _csrf: csrf(r.texte), client_id: idClientC, notes: 'Soumission E&O du courtier' },
  });
  test('courtier crée sa soumission E&O → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarC, 'eo_soumissions', 'json');
  const jCS = JSON.parse(r.texte);
  test('courtier : périmètre portefeuille', jCS.perimetre === 'portefeuille', jCS.perimetre);
  test('courtier : seulement sa soumission',
    jCS.nombre === 1 && jCS.donnees[0].entreprise === 'Portefeuille E&O inc.', `${jCS.nombre}`);
  r = await exporter(jarC, 'eo_activites', 'json');
  test('courtier : aucune activité hors portefeuille', JSON.parse(r.texte).nombre === 0);

  // 10. Journal d'audit
  r = await req(jarA, 'GET', '/admin/journal');
  const nbExports = (r.texte.match(/Export eo_/g) || []).length;
  test('journal contient les exports E&O', r.statut === 200 && nbExports >= 3, `${r.statut} (${nbExports})`);

  // 11. Module/format invalides + CSRF
  r = await exporter(jarA, 'eo_nope', 'csv');
  test('module inconnu → 400', r.statut === 400, `${r.statut}`);
  r = await req(jarA, 'POST', '/exports', { form: { module: 'eo_activites', format: 'csv' } });
  test('POST sans CSRF → 403', r.statut === 403, `${r.statut}`);

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE :', e.message); process.exit(1); });
