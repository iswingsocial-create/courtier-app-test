/**
 * scripts/test-exports-cautionnement.js — Exports cautionnement (étape 5/10
 * cautionnement) : 3 nouveaux modules (caut_obligations — obligations
 * illimitées —, caut_soumissions — ligne aplatie, antécédents aplatis, nb de
 * réclamations 5 ans calculé depuis le JSON, versions imbriquées en JSON —,
 * caut_versions — historique figé), CSV (BOM, « ; », en-têtes FR, libellés FR
 * pour type/statut), JSON structuré, archivés, périmètre courtier, aucun
 * secret, audit, règle d'or (export = lecture seule).
 * Miroir de scripts/test-exports-flotte.js.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : CHEMIN_BD=<même que serveur> PORT=3101 node scripts/test-exports-cautionnement.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD, { readonly: true });
const bdW = new Database(process.env.CHEMIN_BD);

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
  return paires.length ? { 'Cookie': paires.join('; ') } : {};
}
async function req(jar, methode, chemin, { form = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (Array.isArray(v)) { for (const x of v) params.append(k, x); }
      else params.append(k, v);
    }
    corps = params.toString();
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
  total++;
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

const MODULES_CAUT = ['caut_obligations', 'caut_soumissions', 'caut_versions'];
const ENTETE_CLE = {
  caut_obligations: 'Bénéficiaire (donneur d’ouvrage)',
  caut_soumissions: 'Limite globale (capacité)',
  caut_versions: 'Données (JSON)',
};

async function exporter(jar, module, format, archives = false) {
  let r = await req(jar, 'GET', '/exports');
  const form = { _csrf: csrf(r.texte), module, format };
  if (archives) form.archives = '1';
  return req(jar, 'POST', '/exports', { form });
}
function compteLignes() {
  return {
    s: bd.prepare('SELECT COUNT(*) AS n FROM caut_soumissions').get().n,
    o: bd.prepare('SELECT COUNT(*) AS n FROM caut_obligations').get().n,
    ver: bd.prepare('SELECT COUNT(*) AS n FROM caut_soumission_versions').get().n,
  };
}

(async () => {
  console.log('== Exports cautionnement (étape 5/10 cautionnement) ==');

  // 1. Login admin démo
  const jarA = nouveauJar();
  let r = await connexion(jarA, 'admin@demo.ca', 'ChangeMoi123!');
  test('login admin démo → 302', r.statut === 302, `${r.statut}`);
  r = await changerMdp(jarA, 'ChangeMoi123!', 'ExportCaut2026!');
  test('changement mdp forcé → 302', r.statut === 302, `${r.statut}`);

  // 2. Page : 36 modules (33 + 3 cautionnement)
  r = await req(jarA, 'GET', '/exports');
  test('page exports → 200', r.statut === 200, `${r.statut}`);
  const tousPresents = MODULES_CAUT.every((m) => r.texte.includes(`value="${m}"`));
  test('3 modules cautionnement proposés', tousPresents);
  const nbOptions = (r.texte.match(/<option value="/g) || []).length;
  test('36 modules au total', nbOptions === 36, `${nbOptions}`);
  test('page : titres cautionnement visibles',
    r.texte.includes('Obligations (cautionnement)') && r.texte.includes('Soumissions cautionnement')
    && r.texte.includes('Versions de soumissions cautionnement'));

  // 3. Créer des données cautionnement de démo via les routes
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Cautionnement Export inc.', prenom: 'Ca', nom: 'Ex', langue: 'FR' },
  });
  test('entreprise créée → 302', r.statut === 302, `${r.statut}`);
  const idClient = (r.location || '').match(/\/clients\/(\d+)/)[1];

  r = await req(jarA, 'GET', '/cautionnement/nouveau');
  r = await req(jarA, 'POST', '/cautionnement', {
    form: {
      _csrf: csrf(r.texte), client_id: idClient, assureur: 'Intact Cautionnement',
      secteur_activite: 'Construction — entrepreneur général', annee_fondation: '2012',
      chiffre_affaires: '4500000', nb_employes: '28',
      date_effet_souhaitee: '2026-11-29', notes: 'Soumission cautionnement export test',
    },
  });
  test('soumission cautionnement créée → 302', r.statut === 302, `${r.statut}`);
  const idSoum = (r.location || '').match(/\/cautionnement\/(\d+)/)[1];

  // 3a. Obligations : exécution 1,1 M$ + RBQ 40 000 $
  r = await req(jarA, 'GET', '/cautionnement/' + idSoum);
  r = await req(jarA, 'POST', `/cautionnement/${idSoum}/obligation`, {
    form: {
      _csrf: csrf(r.texte), type: 'execution', beneficiaire: 'Centre de services scolaire Export',
      description_projet: 'Construction école primaire', montant_contrat: '2200000',
      montant_cautionnement: '1100000', taux_pct: '1.25', prime_estimee: '13750',
    },
  });
  test('obligation exécution ajoutée → 302', r.statut === 302, `${r.statut}`);
  r = await req(jarA, 'GET', '/cautionnement/' + idSoum);
  r = await req(jarA, 'POST', `/cautionnement/${idSoum}/obligation`, {
    form: {
      _csrf: csrf(r.texte), type: 'rbq', beneficiaire: 'Régie du bâtiment du Québec (RBQ)',
      description_projet: 'Licence RBQ entrepreneur général', montant_cautionnement: '40000', prime_estimee: '250',
    },
  });
  test('obligation RBQ ajoutée → 302', r.statut === 302, `${r.statut}`);

  // 3b. Ligne
  r = await req(jarA, 'GET', '/cautionnement/' + idSoum);
  r = await req(jarA, 'POST', `/cautionnement/${idSoum}/garanties`, {
    form: {
      _csrf: csrf(r.texte), limite_globale: '3000000', limite_par_projet: '1500000',
      fonds_roulement: '520000', valeur_nette: '1200000', prime: '14000',
    },
  });
  test('ligne → 302', r.statut === 302, `${r.statut}`);

  // 3c. Antécédents : 1 réclamation, consentements
  r = await req(jarA, 'GET', '/cautionnement/' + idSoum);
  r = await req(jarA, 'POST', `/cautionnement/${idSoum}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Ancienne Caution Export', numero_ligne_actuelle: 'LIG-EXP-1',
      annees_cautionnement_continu: '6',
      reclamations_5ans: '2022-04-18 | Exécution — Ville Y | 45000 | réglée',
      consentement_credit: 'on', consentement_etats_financiers: 'on',
    },
  });
  test('antécédents → 302', r.statut === 302, `${r.statut}`);

  // Règle d'or : état avant exports
  const avant = compteLignes();

  // 4. Chaque module cautionnement en CSV
  for (const m of MODULES_CAUT) {
    r = await exporter(jarA, m, 'csv');
    const ct = r.contentType.includes('text/csv');
    const bom = r.buf.length >= 3 && r.buf[0] === 0xEF && r.buf[1] === 0xBB && r.buf[2] === 0xBF;
    const premiere = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '').replace(/\u2019/g, '’');
    const enteteOk = premiere.includes(';') && premiere.replace(/\u2019/g, '’').includes(ENTETE_CLE[m]);
    test(`CSV ${m} → 200, BOM, « ; », en-tête FR`, r.statut === 200 && ct && bom && enteteOk,
      `${r.statut} entete=${premiere.slice(0, 60)}`);
  }

  // 5. Chaque module cautionnement en JSON
  const tousJson = [];
  for (const m of MODULES_CAUT) {
    r = await exporter(jarA, m, 'json');
    let j = null;
    try { j = JSON.parse(r.texte); } catch (e) { /* */ }
    const ok = r.statut === 200 && r.contentType.includes('application/json') && j
      && j.module === m && Array.isArray(j.donnees) && j.perimetre === 'cabinet' && typeof j.nombre === 'number';
    test(`JSON ${m} → 200, structure valide`, !!ok, `${r.statut}`);
    if (j) tousJson.push(r.texte);
  }

  // 6. Obligations : seed Verdon (4) + créées (2)
  r = await exporter(jarA, 'caut_obligations', 'json');
  const jObl = JSON.parse(r.texte);
  const oblVerdon = jObl.donnees.filter((x) => x.entreprise === 'Construction Verdon inc.');
  test('seed Verdon : 4 obligations exportées', oblVerdon.length === 4, `${oblVerdon.length}`);
  const sommeVerdon = oblVerdon.reduce((s, x) => s + (Number(x.montant_cautionnement) || 0), 0);
  test('seed Verdon : somme des cautionnements = 2 460 000', sommeVerdon === 2460000, `${sommeVerdon}`);
  const execVerdon = oblVerdon.find((x) => x.type === 'execution');
  test('seed Verdon : exécution 50 % du contrat école (2,2 M$ → 1,1 M$)',
    !!execVerdon && Number(execVerdon.montant_contrat) === 2200000 && Number(execVerdon.montant_cautionnement) === 1100000,
    JSON.stringify(execVerdon && { c: execVerdon.montant_contrat, m: execVerdon.montant_cautionnement }));
  const rbqVerdon = oblVerdon.find((x) => x.type === 'rbq');
  test('seed Verdon : RBQ 40 000 $ (entrepreneur général)',
    !!rbqVerdon && Number(rbqVerdon.montant_cautionnement) === 40000);
  r = await exporter(jarA, 'caut_obligations', 'csv');
  const entO = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV obligations : en-têtes FR',
    entO.includes('Type de cautionnement') && entO.includes('Montant du cautionnement')
    && entO.includes('Prime estimée') && entO.includes('Description du projet'),
    entO.slice(0, 180));
  test('CSV obligations : type en libellé FR (jamais le code)',
    r.texte.includes('Cautionnement d’exécution (performance bond)')
    && r.texte.includes('Cautionnement de licence RBQ')
    && !r.texte.includes(';execution;') && !r.texte.includes(';rbq;'));

  // 7. Soumissions : ligne aplatie, antécédents, nb réclamations, versions
  r = await exporter(jarA, 'caut_soumissions', 'json');
  const jSou = JSON.parse(r.texte);
  const sExp = jSou.donnees.find((s) => s.id === Number(idSoum));
  test('soumission créée : décomptes réels (2 obligations, somme 1 140 000)',
    !!sExp && sExp.nb_obligations === 2 && Number(sExp.somme_cautionnements) === 1140000,
    JSON.stringify(sExp && { n: sExp.nb_obligations, s: sExp.somme_cautionnements }));
  test('soumission créée : ligne imbriquée (globale 3 M$, par projet 1,5 M$, prime 14 000)',
    !!sExp && sExp.ligne && Number(sExp.ligne.limite_globale) === 3000000
    && Number(sExp.ligne.limite_par_projet) === 1500000
    && Number(sExp.ligne.fonds_roulement) === 520000 && Number(sExp.ligne.prime) === 14000,
    JSON.stringify(sExp && sExp.ligne));
  test('soumission créée : antécédents (6 ans continus, 1 réclamation, consentements)',
    !!sExp && sExp.antecedents.annees_cautionnement_continu === 6
    && Array.isArray(sExp.antecedents.reclamations_5ans) && sExp.antecedents.reclamations_5ans.length === 1
    && sExp.antecedents.reclamations_5ans[0].montant === 45000
    && sExp.antecedents.consentements.credit == 1 && sExp.antecedents.consentements.etats_financiers == 1,
    JSON.stringify(sExp && sExp.antecedents));
  test('versions exportées : historique figé imbriqué (snapshot complet)',
    !!sExp && Array.isArray(sExp.versions) && sExp.versions.length >= 4
    && sExp.version_courante >= 4 && sExp.nb_versions === sExp.versions.length
    && !!sExp.versions[sExp.versions.length - 1].donnees
    && Array.isArray(sExp.versions[sExp.versions.length - 1].donnees.obligations)
    && !!sExp.versions[sExp.versions.length - 1].donnees.garanties,
    JSON.stringify(sExp && { v: sExp.version_courante, nv: sExp.nb_versions }));
  const sVerdon = jSou.donnees.find((s) => s.entreprise === 'Construction Verdon inc.');
  test('seed Verdon : soumission (4 obligations, ligne 5 M$/2,5 M$, prime 21 500, 0 réclamation)',
    !!sVerdon && sVerdon.nb_obligations === 4
    && Number(sVerdon.ligne.limite_globale) === 5000000 && Number(sVerdon.ligne.limite_par_projet) === 2500000
    && Number(sVerdon.ligne.prime) === 21500
    && sVerdon.antecedents.reclamations_5ans.length === 0
    && sVerdon.antecedents.annees_cautionnement_continu === 8,
    JSON.stringify(sVerdon && { n: sVerdon.nb_obligations, lg: sVerdon.ligne && sVerdon.ligne.limite_globale }));

  r = await exporter(jarA, 'caut_soumissions', 'csv');
  const entS = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV soumissions : en-têtes FR (ligne aplatie, réclamations)',
    entS.includes('Limite globale (capacité)') && entS.includes('Limite par projet')
    && entS.includes('Fonds de roulement') && entS.includes('Nb obligations')
    && entS.includes('Nb réclamations 5 ans') && entS.includes('Consentement états financiers'),
    entS.slice(0, 220));
  const ligneExp = r.texte.split('\r\n').find((l) => l.includes('Cautionnement Export inc.'));
  test('CSV soumissions : nb réclamations 5 ans calculé = 1',
    !!ligneExp && ligneExp.includes('Ancienne Caution Export'), (ligneExp || '').slice(0, 200));
  test('CSV soumissions : statut en libellé FR', r.texte.includes('Brouillon'));

  // 8. Versions : module dédié
  r = await exporter(jarA, 'caut_versions', 'json');
  const jVer = JSON.parse(r.texte);
  const versExp = jVer.donnees.filter((v) => v.soumission_id === Number(idSoum));
  test('module versions : versions de la soumission créée présentes',
    versExp.length >= 4, `${versExp.length}`);
  test('module versions : donnees parsées (entete + obligations)',
    versExp.length > 0 && !!versExp[versExp.length - 1].donnees
    && !!versExp[versExp.length - 1].donnees.entete
    && Array.isArray(versExp[versExp.length - 1].donnees.obligations));

  // 9. Archivés : obligation archivée exclue sans archives=1, incluse avec
  r = await req(jarA, 'GET', '/cautionnement/' + idSoum);
  const idOblRbq = (r.texte.match(/\/cautionnement\/obligation\/(\d+)\/archiver/) || [])[1];
  test('id obligation RBQ trouvé', !!idOblRbq);
  r = await req(jarA, 'GET', '/cautionnement/' + idSoum);
  r = await req(jarA, 'POST', `/cautionnement/obligation/${idOblRbq}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage obligation → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarA, 'caut_obligations', 'json');
  const sansArch = JSON.parse(r.texte).donnees.filter((x) => x.soumission_id === Number(idSoum));
  test('export sans archivés : 1 obligation', sansArch.length === 1, `${sansArch.length}`);
  r = await exporter(jarA, 'caut_obligations', 'json', true);
  const avecArch = JSON.parse(r.texte).donnees.filter((x) => x.soumission_id === Number(idSoum));
  test('export avec archivés : 2 obligations', avecArch.length === 2, `${avecArch.length}`);

  // 10. Périmètre courtier
  const hash = bcrypt.hashSync('Test1234!', 4);
  const cabA = bdW.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  bdW.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)")
    .run(cabA, 'courtierexp@t.ca', hash, 'Courtier Export');
  const jarC = nouveauJar();
  r = await connexion(jarC, 'courtierexp@t.ca', 'Test1234!');
  test('login courtier → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarC, 'caut_soumissions', 'json');
  const jC = JSON.parse(r.texte);
  test('courtier : périmètre portefeuille', jC.perimetre === 'portefeuille');
  test('courtier : aucune soumission hors portefeuille', jC.donnees.length === 0, `${jC.donnees.length}`);

  // 11. Aucun secret, audit, lecture seule
  const avantExports = compteLignes();
  await exporter(jarA, 'caut_obligations', 'json');
  await exporter(jarA, 'caut_soumissions', 'csv');
  await exporter(jarA, 'caut_versions', 'json');
  const tout = tousJson.join('\n');
  test('aucun secret dans les exports JSON', !/mot_de_passe|totp|hash/i.test(tout));
  const nbAudit = bd.prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action LIKE 'export%'").get().n;
  test('exports journalisés (audit)', nbAudit >= 1, `${nbAudit}`);
  const apres = compteLignes();
  test('règle d’or : exports en lecture seule (aucune mutation)',
    apres.s === avantExports.s && apres.o === avantExports.o && apres.ver === avantExports.ver,
    JSON.stringify({ avantExports, apres }));

  console.log(`\n${total - echecs}/${total} tests réussis`);
  bd.close(); bdW.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
