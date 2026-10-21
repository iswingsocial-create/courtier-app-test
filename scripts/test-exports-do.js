/**
 * scripts/test-exports-do.js — Exports D&O (étape 5/10 D&O) :
 * 3 nouveaux modules (do_dirigeants, do_soumissions, do_versions), CSV
 * (BOM, « ; », en-têtes FR), JSON structuré, garanties/avenants aplatis
 * (frais_defense, pratiques_emploi, fidelite_crime en 0/1), base en libellé FR,
 * nb réclamations 5 ans, poursuites déclarées, archivés, périmètre courtier,
 * aucun secret, audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-exports-do.js
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

const MODULES_DO = ['do_dirigeants', 'do_soumissions', 'do_versions'];
const ENTETE_CLE = {
  do_dirigeants: 'Nom du dirigeant', do_soumissions: 'Version courante', do_versions: 'Soumission (id)',
};

async function exporter(jar, module, format, archives = false) {
  let r = await req(jar, 'GET', '/exports');
  const form = { _csrf: csrf(r.texte), module, format };
  if (archives) form.archives = '1';
  return req(jar, 'POST', '/exports', { form });
}

(async () => {
  console.log('== Exports D&O (étape 5/10 D&O) ==');

  // 1. Login admin démo
  const jarA = nouveauJar();
  let r = await connexion(jarA, 'admin@demo.ca', 'ChangeMoi123!');
  test('login admin démo → 302', r.statut === 302, `${r.statut}`);
  r = await changerMdp(jarA, 'ChangeMoi123!', 'ExportDo2026!');
  test('changement mdp forcé → 302', r.statut === 302, `${r.statut}`);

  // 2. Page : 36 modules (33 + 3 cautionnement)
  r = await req(jarA, 'GET', '/exports');
  test('page exports → 200', r.statut === 200, `${r.statut}`);
  const tousPresents = MODULES_DO.every((m) => r.texte.includes(`value="${m}"`));
  test('3 modules D&O proposés', tousPresents);
  const nbOptions = (r.texte.match(/<option value="/g) || []).length;
  test('36 modules au total', nbOptions === 36, `${nbOptions}`);

  // 3. Créer des données D&O de démo via les routes
  // 3a. Entreprise
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'D&O Export inc.', prenom: 'Ex', nom: 'Po', langue: 'FR' },
  });
  test('entreprise créée → 302', r.statut === 302, `${r.statut}`);
  const idClient = (r.location || '').match(/\/clients\/(\d+)/)[1];

  // 3b. Soumission D&O
  r = await req(jarA, 'GET', '/do/nouveau');
  r = await req(jarA, 'POST', '/do', {
    form: { _csrf: csrf(r.texte), client_id: idClient, date_effet_souhaitee: '2026-12-01', notes: 'Soumission D&O export test' },
  });
  test('soumission D&O créée → 302', r.statut === 302, `${r.statut}`);
  const idSoum = (r.location || '').match(/\/do\/(\d+)/)[1];

  // 3c. Dirigeants (2)
  r = await req(jarA, 'GET', '/do/' + idSoum);
  r = await req(jarA, 'POST', `/do/${idSoum}/dirigeant`, {
    form: {
      _csrf: csrf(r.texte), nom: 'Marie Tremblay', fonction: 'Présidente-directrice générale',
      annees_experience: '15', antecedents_personnels: 'Aucun',
    },
  });
  test('dirigeant Marie Tremblay ajouté → 302', r.statut === 302, `${r.statut}`);
  r = await req(jarA, 'GET', '/do/' + idSoum);
  r = await req(jarA, 'POST', `/do/${idSoum}/dirigeant`, {
    form: {
      _csrf: csrf(r.texte), nom: 'Jean Côté', fonction: 'Trésorier',
      annees_experience: '8', antecedents_personnels: 'Réclamation réglée 2021',
    },
  });
  test('dirigeant Jean Côté ajouté → 302', r.statut === 302, `${r.statut}`);

  // 3d. Garanties avec base claims-made + avenants
  r = await req(jarA, 'GET', '/do/' + idSoum);
  const pGar = new URLSearchParams();
  pGar.append('_csrf', csrf(r.texte));
  pGar.append('limite_par_sinistre', '2000000');
  pGar.append('limite_agregat', '2000000');
  pGar.append('franchise', '10000');
  pGar.append('base', 'reclamations_presentees');
  pGar.append('avenants', 'frais_defense');
  pGar.append('avenants', 'pratiques_emploi');
  pGar.append('prime', '9500');
  const rGar = await fetch(BASE + `/do/${idSoum}/garanties`, {
    method: 'POST',
    headers: { ...enteteCookies(jarA), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: pGar.toString(), redirect: 'manual',
  });
  appliquerCookies(jarA, rGar);
  test('garanties + base claims-made + avenants → 302', rGar.status === 302, `${rGar.status}`);

  // 3e. Antécédents avec réclamation + poursuites + consentements
  r = await req(jarA, 'GET', '/do/' + idSoum);
  r = await req(jarA, 'POST', `/do/${idSoum}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Assureur D&O actuel inc.',
      numero_police_actuelle: 'DO-EXP-1', date_expiration_actuelle: '2026-12-01',
      annees_assurance_continue: '4',
      reclamations_json: JSON.stringify([{ date: '2022-05-10', nature: 'Litige d’actionnaire', montant: '120000', sinistre: 'Oui' }]),
      poursuites_en_cours: 'Une action en justice envisagée par un ancien employé.',
      consentement_credit: 'on', consentement_dossier_assurance: 'on',
    },
  });
  test('antécédents + réclamation + poursuites → 302', r.statut === 302, `${r.statut}`);

  // 4. Chaque module D&O en CSV
  for (const m of MODULES_DO) {
    r = await exporter(jarA, m, 'csv');
    const ct = r.contentType.includes('text/csv');
    const bom = r.buf.length >= 3 && r.buf[0] === 0xEF && r.buf[1] === 0xBB && r.buf[2] === 0xBF;
    const premiere = r.texte.replace(/^﻿/, '').split('\r\n')[0] || '';
    const enteteOk = premiere.includes(';') && premiere.includes(ENTETE_CLE[m]);
    test(`CSV ${m} → 200, BOM, « ; », en-tête FR`, r.statut === 200 && ct && bom && enteteOk,
      `${r.statut} entete=${premiere.slice(0, 60)}`);
  }

  // 5. Chaque module D&O en JSON
  const tousJson = [];
  for (const m of MODULES_DO) {
    r = await exporter(jarA, m, 'json');
    let j = null;
    try { j = JSON.parse(r.texte); } catch (e) { /* */ }
    const ok = r.statut === 200 && r.contentType.includes('application/json') && j
      && j.module === m && Array.isArray(j.donnees) && j.perimetre === 'cabinet' && typeof j.nombre === 'number';
    test(`JSON ${m} → 200, structure valide`, ok, `${r.statut}`);
    if (j) tousJson.push(r.texte);
  }

  // 6. Données vérifiées
  r = await exporter(jarA, 'do_dirigeants', 'json');
  const jDir = JSON.parse(r.texte);
  const marie = jDir.donnees.find((x) => x.nom === 'Marie Tremblay' && x.soumission_id === Number(idSoum));
  test('dirigeant : Marie Tremblay exportée (fonction, expérience)', !!marie && marie.fonction === 'Présidente-directrice générale' && marie.annees_experience === 15,
    JSON.stringify(marie && { f: marie.fonction, e: marie.annees_experience }));
  r = await exporter(jarA, 'do_dirigeants', 'csv');
  const entD = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV dirigeants : en-têtes FR', entD.includes('Nom du dirigeant') && entD.includes('Fonction / titre') && entD.includes("Années d'expérience"));
  test('CSV dirigeants : lignes des 2 dirigeants', r.texte.includes('Marie Tremblay') && r.texte.includes('Jean Côté'));

  r = await exporter(jarA, 'do_soumissions', 'json');
  const jSou = JSON.parse(r.texte);
  const sExp = jSou.donnees.find((s) => s.id === Number(idSoum));
  test('soumission : version courante + décomptes',
    !!sExp && sExp.version_courante >= 5 && sExp.nb_dirigeants === 2 && sExp.nb_versions >= 5,
    JSON.stringify(sExp && { v: sExp.version_courante, d: sExp.nb_dirigeants, nv: sExp.nb_versions }));
  test('soumission : garanties imbriquées',
    !!sExp && sExp.garanties && sExp.garanties.limite_par_sinistre === 2000000
    && sExp.garanties.limite_agregat === 2000000 && sExp.garanties.franchise === 10000
    && sExp.garanties.base === 'reclamations_presentees' && sExp.garanties.prime === 9500,
    JSON.stringify(sExp && sExp.garanties));
  test('soumission : avenants (frais_defense, pratiques_emploi)',
    !!sExp && sExp.garanties.avenants.frais_defense == 1 && sExp.garanties.avenants.pratiques_emploi == 1
    && !sExp.garanties.avenants.fidelite_crime,
    JSON.stringify(sExp && sExp.garanties.avenants));
  test('soumission : réclamation + poursuites + consentements',
    !!sExp && Array.isArray(sExp.reclamations_5ans) && sExp.reclamations_5ans.length === 1
    && sExp.reclamations_5ans[0].nature.includes('actionnaire')
    && sExp.poursuites_en_cours.includes('ancien employé')
    && sExp.consentements.credit == 1 && sExp.consentements.dossier_assurance == 1,
    JSON.stringify(sExp && { rec: sExp.reclamations_5ans, p: sExp.poursuites_en_cours, c: sExp.consentements }));
  r = await exporter(jarA, 'do_soumissions', 'csv');
  test('CSV soumissions : « Version courante »', r.texte.includes('Version courante'));
  const entS = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV soumissions : colonnes avenants 0/1',
    entS.includes('Avenant — frais de défense') && entS.includes('Avenant — pratiques d’emploi')
    && entS.includes('Avenant — fidélité / crime'));
  test('CSV soumissions : « Base de garantie » en libellé FR', r.texte.includes('Réclamations-présentées'));
  test('CSV soumissions : « Nb de réclamations 5 ans »', r.texte.includes('Nb de réclamations 5 ans'));
  test('CSV soumissions : « Poursuites déclarées »', r.texte.includes('Poursuites déclarées'));

  r = await exporter(jarA, 'do_versions', 'json');
  const jVer = JSON.parse(r.texte);
  const vExp = jVer.donnees.filter((v) => v.soumission_id === Number(idSoum));
  test('versions : historique figé (≥5)', vExp.length >= 5, `${vExp.length}`);
  test('versions : snapshot JSON parsé (dirigeants, garanties, antecedents)',
    vExp.length > 0 && vExp[vExp.length - 1].donnees
    && Array.isArray(vExp[vExp.length - 1].donnees.dirigeants)
    && !!vExp[vExp.length - 1].donnees.garanties
    && !!vExp[vExp.length - 1].donnees.antecedents,
    JSON.stringify(vExp.length > 0 && vExp[vExp.length - 1].donnees && Object.keys(vExp[vExp.length - 1].donnees)));

  // 7. Aucun secret
  const concat = tousJson.join('\n');
  test('aucun hash ni secret exporté',
    !concat.includes('mot_de_passe_hash') && !concat.includes('totp_secret') && !concat.includes('_chiffre'));

  // 8. Archivés : exclure / inclure
  r = await req(jarA, 'GET', '/do/' + idSoum);
  const idDir = (r.texte.match(/\/do\/dirigeant\/(\d+)\/archiver/) || [])[1];
  test('id de dirigeant trouvé sur la fiche', !!idDir);
  r = await req(jarA, 'POST', `/do/dirigeant/${idDir}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage dirigeant → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarA, 'do_dirigeants', 'json', false);
  test('dirigeant archivé exclu par défaut', !JSON.parse(r.texte).donnees.some((x) => String(x.id) === String(idDir)));
  r = await exporter(jarA, 'do_dirigeants', 'json', true);
  const jArc = JSON.parse(r.texte);
  const dArc = jArc.donnees.find((x) => String(x.id) === String(idDir));
  test('dirigeant archivé inclus avec la case', !!dArc && dArc.archive == 1);

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
  const idCourtier = await creerU('Courtier D&O', 'courtierdo@test.ca', 'courtier', 'CourtierDo1!');
  test('création courtier → ok', !!idCourtier);
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Portefeuille D&O inc.', prenom: 'Po', nom: 'DO', langue: 'FR', responsable_id: idCourtier },
  });
  test('entreprise du courtier → 302', r.statut === 302, `${r.statut}`);
  const idClientC = (r.location || '').match(/\/clients\/(\d+)/)[1];
  const jarC = nouveauJar();
  await connexion(jarC, 'courtierdo@test.ca', 'CourtierDo1!');
  await changerMdp(jarC, 'CourtierDo1!', 'CourtierDo2!');
  r = await req(jarC, 'GET', '/do/nouveau');
  r = await req(jarC, 'POST', '/do', {
    form: { _csrf: csrf(r.texte), client_id: idClientC, notes: 'Soumission D&O du courtier' },
  });
  test('courtier crée sa soumission D&O → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarC, 'do_soumissions', 'json');
  const jCS = JSON.parse(r.texte);
  test('courtier : périmètre portefeuille', jCS.perimetre === 'portefeuille', jCS.perimetre);
  test('courtier : seulement sa soumission',
    jCS.nombre === 1 && jCS.donnees[0].entreprise === 'Portefeuille D&O inc.', `${jCS.nombre}`);
  r = await exporter(jarC, 'do_dirigeants', 'json');
  test('courtier : aucun dirigeant hors portefeuille', JSON.parse(r.texte).nombre === 0);

  // 10. Journal d'audit
  r = await req(jarA, 'GET', '/admin/journal');
  const nbExports = (r.texte.match(/Export do_/g) || []).length;
  test('journal contient les exports D&O', r.statut === 200 && nbExports >= 3, `${r.statut} (${nbExports})`);

  // 11. Module/format invalides + CSRF
  r = await exporter(jarA, 'do_nope', 'csv');
  test('module inconnu → 400', r.statut === 400, `${r.statut}`);
  r = await req(jarA, 'POST', '/exports', { form: { module: 'do_dirigeants', format: 'csv' } });
  test('POST sans CSRF → 403', r.statut === 403, `${r.statut}`);

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE :', e.message); process.exit(1); });
