/**
 * scripts/test-augure-env.js — Demandes de Patrick (2026-10-21) :
 *  1) AUGURE_API_KEY (environnement du serveur) PRIORITAIRE sur la clé
 *     chiffrée du cabinet, persistante ; la clé du cabinet reste le repli.
 *     Aucune clé réelle : faux jetons passés par l'environnement du
 *     processus de test ; appels vers un harnais HTTP local seulement.
 *  2) Compte démo du seed SANS changement de mot de passe forcé
 *     (doit_changer_mot_de_passe = 0) ; les comptes créés via l'Admin
 *     gardent la règle (vérifié par le code de création, valeur 1).
 *
 * Suite MODÈLE (aucun serveur applicatif) : CHEMIN_BD=<base fraîche>.
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-augure-env.db';
const http = require('http');
const bd = require('../lib/bd');

let total = 0, echecs = 0;
function test(nom, cond, detail) {
  total++;
  if (cond) console.log('  ✅ ' + nom);
  else { echecs++; console.log('  ❌ ' + nom + (detail ? ' — ' + detail : '')); }
}

const CLE_ENV = 'jeton-env-fictif-12345678';   // derniers 4 : 5678
const CLE_BASE = 'jeton-base-fictif-87654321'; // derniers 4 : 4321

(async () => {
  const augure = require('../lib/augure');
  const cab = bd.prepare("INSERT INTO cabinets (nom, token_capture) VALUES ('Cabinet Env', ?)").run(bd.genererJetonCapture()).lastInsertRowid;
  const userId = bd.prepare(
    "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, 'env@test.ca', 'x', 'admin', 'Env')"
  ).run(cab).lastInsertRowid;

  console.log('1. Priorité de la clé d\u2019environnement');
  delete process.env.AUGURE_API_KEY;
  test('aucune clé : cleAugure null, non configurée',
    augure.cleAugure(cab) === null && augure.obtenirReglageAugure(cab).configuree === false
    && augure.obtenirReglageAugure(cab).sourceEffective === null);
  augure.definirCleAugure(cab, userId, CLE_BASE);
  test('clé du cabinet seule : effective = clé du cabinet, source « cabinet »',
    augure.cleAugure(cab) === CLE_BASE && augure.obtenirReglageAugure(cab).sourceEffective === 'cabinet');
  process.env.AUGURE_API_KEY = CLE_ENV;
  const reglage = augure.obtenirReglageAugure(cab);
  test('env + base : la clé EFFECTIVE est celle de l\u2019environnement (priorité)',
    augure.cleAugure(cab) === CLE_ENV);
  test('état Admin : source « environnement », deux clés présentes distinguées',
    reglage.sourceEffective === 'environnement' && reglage.cleEnvPresente === true && reglage.cleCabinetPresente === true);
  test('masques : effectif = env (…5678), cabinet = base (…4321), jamais de clé en clair dans l\u2019état',
    /5678$/.test(reglage.masqueEffectif || '') && /4321$/.test(reglage.masque || '')
    && !JSON.stringify(reglage).includes(CLE_ENV) && !JSON.stringify(reglage).includes(CLE_BASE));

  console.log('2. Le bouton de test et les appels utilisent la clé effective (harnais local)');
  const autorisations = [];
  const stub = http.createServer((req, res) => {
    autorisations.push(req.headers.authorization || '');
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'ossington-5' }] }));
    let corps = '';
    req.on('data', (c) => { corps += c; });
    req.on('end', () => res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })));
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  process.env.AUGURE_BASE_URL = `http://127.0.0.1:${stub.address().port}/v1`;
  const testEnv = await augure.testerConnexionAugure(cab);
  test('tester la connexion (env présent) : OK, en-tête Bearer = clé d\u2019environnement',
    testEnv.ok === true && autorisations[autorisations.length - 1] === 'Bearer ' + CLE_ENV, testEnv.message);
  const reponse = await augure.appelerAugureCabinet(cab, { prompt: 'Dis OK' });
  test('appel chat du cabinet : en-tête Bearer = clé d\u2019environnement',
    reponse === 'OK' && autorisations[autorisations.length - 1] === 'Bearer ' + CLE_ENV);
  delete process.env.AUGURE_API_KEY;
  const testBase = await augure.testerConnexionAugure(cab);
  test('env retirée : repli automatique sur la clé du cabinet (Bearer = clé de base)',
    testBase.ok === true && autorisations[autorisations.length - 1] === 'Bearer ' + CLE_BASE);
  process.env.AUGURE_API_KEY = '   ';
  test('env blanche (espaces) : traitée comme absente → repli cabinet',
    augure.cleAugure(cab) === CLE_BASE && augure.obtenirReglageAugure(cab).sourceEffective === 'cabinet');
  delete process.env.AUGURE_API_KEY;
  delete process.env.AUGURE_BASE_URL;
  stub.close();

  console.log('3. Env seule (aucune clé en base) et persistance logique');
  augure.effacerCleAugure(cab, userId);
  process.env.AUGURE_API_KEY = CLE_ENV;
  test('env seule : effective = env, configurée, source « environnement »',
    augure.cleAugure(cab) === CLE_ENV && augure.obtenirReglageAugure(cab).configuree === true
    && augure.obtenirReglageAugure(cab).cleCabinetPresente === false);
  delete process.env.AUGURE_API_KEY;
  test('tout retiré : non configurée (le réglage du cabinet reste le seul repli)',
    augure.cleAugure(cab) === null && augure.obtenirReglageAugure(cab).configuree === false);

  console.log('4. Seed démo : aucun changement de mot de passe forcé');
  // Processus enfant sur une base vierge : le seed refuse une base déjà
  // peuplée, et la suite a créé son propre cabinet plus haut.
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const dbSeed = '/tmp/test-augure-env-seed.db';
  for (const suffixe of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbSeed + suffixe); } catch (e) { /* absent */ } }
  const scriptEnfant = `
    const bd = require(${JSON.stringify(require('path').join(__dirname, '..', 'lib', 'bd'))});
    require(${JSON.stringify(require('path').join(__dirname, '..', 'seed'))});
    const u = bd.prepare("SELECT doit_changer_mot_de_passe FROM users WHERE email = 'admin@demo.ca'").get();
    console.log('FLAG=' + (u ? u.doit_changer_mot_de_passe : 'absent'));
  `;
  const sortie = execFileSync('node', ['-e', scriptEnfant], {
    encoding: 'utf8',
    env: { ...process.env, CHEMIN_BD: dbSeed },
  });
  test('admin@demo.ca (seed, base vierge) : doit_changer_mot_de_passe = 0', /FLAG=0/.test(sortie), sortie.trim().split('\n').pop());
  const codeAdmin = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  test('création via l\u2019Admin : la règle du changement forcé est conservée (valeur 1 au code)',
    /INSERT INTO users \(cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe, code_interne\)\s*VALUES \(\?, \?, \?, \?, \?, 1, \?\)/.test(codeAdmin));

  console.log(`\n${total - echecs}/${total} tests réussis`);
  if (echecs) { console.log(`❌ ${echecs} échec(s)`); process.exit(1); }
  console.log('TOUS LES TESTS PASSENT');
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
