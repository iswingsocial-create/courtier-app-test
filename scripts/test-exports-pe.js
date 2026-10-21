/**
 * scripts/test-exports-pe.js — Exports perte d'exploitation (étape 5/10 PE) :
 * 3 nouveaux modules (pe_etablissements, pe_soumissions, pe_versions), CSV
 * (BOM, « ; », en-têtes FR), JSON structuré, garanties aplaties (période
 * d'indemnité 12/18/24, franchise en jours, base en libellé FR, avenants
 * frais_supplementaires/dependance_fournisseurs/acces_civil/
 * deterioration_stocks en 0/1), nb interruptions 5 ans, archivés, périmètre
 * courtier, aucun secret, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-exports-pe.js
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

const MODULES_PE = ['pe_etablissements', 'pe_soumissions', 'pe_versions'];
const ENTETE_CLE = {
  pe_etablissements: 'Nom du lieu', pe_soumissions: 'Version courante', pe_versions: 'Soumission (id)',
};

async function exporter(jar, module, format, archives = false) {
  let r = await req(jar, 'GET', '/exports');
  const form = { _csrf: csrf(r.texte), module, format };
  if (archives) form.archives = '1';
  return req(jar, 'POST', '/exports', { form });
}

(async () => {
  console.log('== Exports perte d’exploitation (étape 5/10 PE) ==');

  // 1. Login admin démo
  const jarA = nouveauJar();
  let r = await connexion(jarA, 'admin@demo.ca', 'ChangeMoi123!');
  test('login admin démo → 302', r.statut === 302, `${r.statut}`);
  r = await changerMdp(jarA, 'ChangeMoi123!', 'ExportPe2026!');
  test('changement mdp forcé → 302', r.statut === 302, `${r.statut}`);

  // 2. Page : 36 modules (33 + 3 cautionnement)
  r = await req(jarA, 'GET', '/exports');
  test('page exports → 200', r.statut === 200, `${r.statut}`);
  const tousPresents = MODULES_PE.every((m) => r.texte.includes(`value="${m}"`));
  test('3 modules PE proposés', tousPresents);
  const nbOptions = (r.texte.match(/<option value="/g) || []).length;
  test('36 modules au total', nbOptions === 36, `${nbOptions}`);

  // 3. Créer des données PE de démo via les routes
  // 3a. Entreprise
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'PE Export inc.', prenom: 'Ex', nom: 'Po', langue: 'FR' },
  });
  test('entreprise créée → 302', r.statut === 302, `${r.statut}`);
  const idClient = (r.location || '').match(/\/clients\/(\d+)/)[1];

  // 3b. Soumission PE
  r = await req(jarA, 'GET', '/pe/nouveau');
  r = await req(jarA, 'POST', '/pe', {
    form: { _csrf: csrf(r.texte), client_id: idClient, date_effet_souhaitee: '2026-11-29', notes: 'Soumission PE export test' },
  });
  test('soumission PE créée → 302', r.statut === 302, `${r.statut}`);
  const idSoum = (r.location || '').match(/\/pe\/(\d+)/)[1];

  // 3c. Établissements (2)
  r = await req(jarA, 'GET', '/pe/' + idSoum);
  r = await req(jarA, 'POST', `/pe/${idSoum}/etablissement`, {
    form: {
      _csrf: csrf(r.texte), nom_lieu: 'Fournil', adresse: '123 rue Sainte-Catherine E, Montréal',
      occupation: 'Boulangerie — fournil', chiffre_affaires: '750000', superficie: '250',
      annee_construction: '1965', base_valeur: 'remplacement',
    },
  });
  test('établissement Fournil ajouté → 302', r.statut === 302, `${r.statut}`);
  r = await req(jarA, 'GET', '/pe/' + idSoum);
  r = await req(jarA, 'POST', `/pe/${idSoum}/etablissement`, {
    form: {
      _csrf: csrf(r.texte), nom_lieu: 'Magasin', adresse: '4800 boul. Saint-Laurent, Montréal',
      occupation: 'Commerce de détail', chiffre_affaires: '450000', superficie: '120',
      annee_construction: '1978', base_valeur: 'depreciation',
    },
  });
  test('établissement Magasin ajouté → 302', r.statut === 302, `${r.statut}`);

  // 3d. Garanties : période 12 mois, franchise 3 jours, base marge_brute, 2 avenants
  r = await req(jarA, 'GET', '/pe/' + idSoum);
  const pGar = new URLSearchParams();
  pGar.append('_csrf', csrf(r.texte));
  pGar.append('limite', '800000');
  pGar.append('periode_indemnite_mois', '12');
  pGar.append('franchise_jours', '3');
  pGar.append('base_montant', 'marge_brute');
  pGar.append('avenants', 'frais_supplementaires');
  pGar.append('avenants', 'deterioration_stocks');
  pGar.append('prime', '2800');
  const rGar = await fetch(BASE + `/pe/${idSoum}/garanties`, {
    method: 'POST',
    headers: { ...enteteCookies(jarA), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: pGar.toString(), redirect: 'manual',
  });
  appliquerCookies(jarA, rGar);
  test('garanties + période 12 mois + base marge_brute + avenants → 302', rGar.status === 302, `${rGar.status}`);

  // 3e. Antécédents avec interruption + consentements
  r = await req(jarA, 'GET', '/pe/' + idSoum);
  r = await req(jarA, 'POST', `/pe/${idSoum}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Assureur PE actuel inc.',
      numero_police_actuelle: 'PE-EXP-1', date_expiration_actuelle: '2026-11-29',
      annees_assurance_continue: '4',
      interruptions: "2022-03-11 | Bris d'équipement (four) | 6 | 28000",
      consentement_credit: 'on', consentement_dossier_assurance: 'on',
    },
  });
  test('antécédents + interruption → 302', r.statut === 302, `${r.statut}`);

  // 4. Chaque module PE en CSV
  for (const m of MODULES_PE) {
    r = await exporter(jarA, m, 'csv');
    const ct = r.contentType.includes('text/csv');
    const bom = r.buf.length >= 3 && r.buf[0] === 0xEF && r.buf[1] === 0xBB && r.buf[2] === 0xBF;
    const premiere = r.texte.replace(/^﻿/, '').split('\r\n')[0] || '';
    const enteteOk = premiere.includes(';') && premiere.includes(ENTETE_CLE[m]);
    test(`CSV ${m} → 200, BOM, « ; », en-tête FR`, r.statut === 200 && ct && bom && enteteOk,
      `${r.statut} entete=${premiere.slice(0, 60)}`);
  }

  // 5. Chaque module PE en JSON
  const tousJson = [];
  for (const m of MODULES_PE) {
    r = await exporter(jarA, m, 'json');
    let j = null;
    try { j = JSON.parse(r.texte); } catch (e) { /* */ }
    const ok = r.statut === 200 && r.contentType.includes('application/json') && j
      && j.module === m && Array.isArray(j.donnees) && j.perimetre === 'cabinet' && typeof j.nombre === 'number';
    test(`JSON ${m} → 200, structure valide`, ok, `${r.statut}`);
    if (j) tousJson.push(r.texte);
  }

  // 6. Données vérifiées
  r = await exporter(jarA, 'pe_etablissements', 'json');
  const jEtab = JSON.parse(r.texte);
  const fournil = jEtab.donnees.find((x) => x.nom_lieu === 'Fournil' && x.soumission_id === Number(idSoum));
  test('établissement : Fournil exporté (occupation, CA, base valeur)',
    !!fournil && fournil.occupation === 'Boulangerie — fournil' && fournil.chiffre_affaires === 750000
    && fournil.base_valeur === 'remplacement' && fournil.superficie === 250,
    JSON.stringify(fournil && { o: fournil.occupation, ca: fournil.chiffre_affaires, bv: fournil.base_valeur }));
  r = await exporter(jarA, 'pe_etablissements', 'csv');
  const entE = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV établissements : en-têtes FR',
    entE.includes('Nom du lieu') && entE.includes('Adresse du lieu')
    && entE.includes("Chiffre d'affaires du lieu") && entE.includes('Base de valeur'),
    entE.slice(0, 160));
  test('CSV établissements : base de valeur en libellé FR',
    r.texte.includes('Coût de remplacement') && r.texte.includes('Valeur dépréciée'));
  test('CSV établissements : lignes des 2 établissements', r.texte.includes('Fournil') && r.texte.includes('Magasin'));

  r = await exporter(jarA, 'pe_soumissions', 'json');
  const jSou = JSON.parse(r.texte);
  const sExp = jSou.donnees.find((s) => s.id === Number(idSoum));
  test('soumission : version courante + décomptes',
    !!sExp && sExp.version_courante >= 5 && sExp.nb_etablissements === 2 && sExp.nb_versions >= 5,
    JSON.stringify(sExp && { v: sExp.version_courante, e: sExp.nb_etablissements, nv: sExp.nb_versions }));
  test('soumission : garanties imbriquées',
    !!sExp && sExp.garanties && sExp.garanties.limite === 800000
    && sExp.garanties.periode_indemnite_mois === 12 && sExp.garanties.franchise_jours === 3
    && sExp.garanties.base_montant === 'marge_brute' && sExp.garanties.prime === 2800,
    JSON.stringify(sExp && sExp.garanties));
  test('soumission : avenants (frais_supplementaires, deterioration_stocks)',
    !!sExp && sExp.garanties.avenants.frais_supplementaires == 1 && sExp.garanties.avenants.deterioration_stocks == 1
    && !sExp.garanties.avenants.acces_civil,
    JSON.stringify(sExp && sExp.garanties.avenants));
  test('soumission : interruption + consentements',
    !!sExp && Array.isArray(sExp.interruptions_5ans) && sExp.interruptions_5ans.length === 1
    && sExp.interruptions_5ans[0].cause.includes("Bris d'équipement")
    && sExp.interruptions_5ans[0].duree_jours === 6
    && sExp.consentements.credit == 1 && sExp.consentements.dossier_assurance == 1,
    JSON.stringify(sExp && { inter: sExp.interruptions_5ans, c: sExp.consentements }));
  r = await exporter(jarA, 'pe_soumissions', 'csv');
  test('CSV soumissions : « Version courante »', r.texte.includes('Version courante'));
  const entS = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV soumissions : colonnes avenants 0/1',
    entS.includes('Avenant — frais supplémentaires') && entS.includes('Avenant — dépendance aux fournisseurs')
    && entS.includes('Avenant — accès civil') && entS.includes('Avenant — détérioration des stocks'),
    entS.slice(0, 200));
  test('CSV soumissions : « Base d\'indemnité » en libellé FR (jamais le code)',
    r.texte.includes('Marge brute') && !entS.includes('marge_brute') && !r.texte.includes('marge_brute,'));
  test('CSV soumissions : « Période d’indemnité » en libellé', r.texte.includes('12 mois'));
  test('CSV soumissions : « Nb interruptions 5 ans »', r.texte.includes('Nb interruptions 5 ans'));

  r = await exporter(jarA, 'pe_versions', 'json');
  const jVer = JSON.parse(r.texte);
  const vExp = jVer.donnees.filter((v) => v.soumission_id === Number(idSoum));
  test('versions : historique figé (≥5)', vExp.length >= 5, `${vExp.length}`);
  test('versions : snapshot JSON parsé (etablissements, garanties, antecedents)',
    vExp.length > 0 && vExp[vExp.length - 1].donnees
    && Array.isArray(vExp[vExp.length - 1].donnees.etablissements)
    && !!vExp[vExp.length - 1].donnees.garanties
    && !!vExp[vExp.length - 1].donnees.antecedents,
    JSON.stringify(vExp.length > 0 && vExp[vExp.length - 1].donnees && Object.keys(vExp[vExp.length - 1].donnees)));

  // 7. Aucun secret
  const concat = tousJson.join('\n');
  test('aucun hash ni secret exporté',
    !concat.includes('mot_de_passe_hash') && !concat.includes('totp_secret') && !concat.includes('_chiffre'));

  // 8. Archivés : exclure / inclure
  r = await req(jarA, 'GET', '/pe/' + idSoum);
  const idEtab = (r.texte.match(/\/pe\/etablissement\/(\d+)\/archiver/) || [])[1];
  test('id d’établissement trouvé sur la fiche', !!idEtab);
  r = await req(jarA, 'POST', `/pe/etablissement/${idEtab}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage établissement → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarA, 'pe_etablissements', 'json', false);
  test('établissement archivé exclu par défaut', !JSON.parse(r.texte).donnees.some((x) => String(x.id) === String(idEtab)));
  r = await exporter(jarA, 'pe_etablissements', 'json', true);
  const jArc = JSON.parse(r.texte);
  const eArc = jArc.donnees.find((x) => String(x.id) === String(idEtab));
  test('établissement archivé inclus avec la case', !!eArc && eArc.archive == 1);

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
  const idCourtier = await creerU('Courtier PE', 'courtierpe@test.ca', 'courtier', 'CourtierPe1!');
  test('création courtier → ok', !!idCourtier);
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Portefeuille PE inc.', prenom: 'Po', nom: 'PE', langue: 'FR', responsable_id: idCourtier },
  });
  test('entreprise du courtier → 302', r.statut === 302, `${r.statut}`);
  const idClientC = (r.location || '').match(/\/clients\/(\d+)/)[1];
  const jarC = nouveauJar();
  await connexion(jarC, 'courtierpe@test.ca', 'CourtierPe1!');
  await changerMdp(jarC, 'CourtierPe1!', 'CourtierPe2!');
  r = await req(jarC, 'GET', '/pe/nouveau');
  r = await req(jarC, 'POST', '/pe', {
    form: { _csrf: csrf(r.texte), client_id: idClientC, notes: 'Soumission PE du courtier' },
  });
  test('courtier crée sa soumission PE → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarC, 'pe_soumissions', 'json');
  const jCS = JSON.parse(r.texte);
  test('courtier : périmètre portefeuille', jCS.perimetre === 'portefeuille', jCS.perimetre);
  test('courtier : seulement sa soumission',
    jCS.nombre === 1 && jCS.donnees[0].entreprise === 'Portefeuille PE inc.', `${jCS.nombre}`);
  r = await exporter(jarC, 'pe_etablissements', 'json');
  test('courtier : aucun établissement hors portefeuille', JSON.parse(r.texte).nombre === 0);

  // 10. Journal d'audit
  r = await req(jarA, 'GET', '/admin/journal');
  const nbExports = (r.texte.match(/Export pe_/g) || []).length;
  test('journal contient les exports PE', r.statut === 200 && nbExports >= 3, `${r.statut} (${nbExports})`);

  // 11. Module/format invalides + CSRF
  r = await exporter(jarA, 'pe_nope', 'csv');
  test('module inconnu → 400', r.statut === 400, `${r.statut}`);
  r = await req(jarA, 'POST', '/exports', { form: { module: 'pe_etablissements', format: 'csv' } });
  test('POST sans CSRF → 403', r.statut === 403, `${r.statut}`);

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE :', e.message); process.exit(1); });
