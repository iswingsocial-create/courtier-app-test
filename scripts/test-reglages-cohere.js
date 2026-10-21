/**
 * scripts/test-reglages-cohere.js — « Analyse de documents IA » étape 4/5 :
 * réglages clé API Cohere (Admin → 🔑 Clé IA) — enregistrement CHIFFRÉ au
 * repos (la valeur en base n'est pas la clé en clair), affichage masqué
 * (4 derniers caractères seulement), permissions admin seulement, test de
 * connexion qui échoue proprement sans clé et avec une fausse clé, choix du
 * moteur (local/cohere/auto), badge moteur de l'assistant, repli local du
 * moteur d'analyse quand Cohere est injoignable.
 * La « clé » utilisée est un jeton de test évidemment faux
 * (« cle-de-test-non-reelle »), jamais une vraie clé.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed),
 * SANS COHERE_API_KEY ni ASSISTANT_MOTEUR dans l'environnement du serveur.
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-reglages-cohere.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
delete process.env.COHERE_API_KEY;
delete process.env.ASSISTANT_MOTEUR;
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);
const reglagesIA = require('../lib/reglages-ia');
const chiffrement = require('../lib/chiffrement');
const moteur = require('../lib/analyse-document');

const BASE = `http://localhost:${process.env.PORT || 3101}`;
const FAUSSE_CLE = 'cle-de-test-non-reelle-1234';
let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
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
  const p = Object.entries(jar).map(([k, v]) => `${k}=${v}`);
  return p.length ? { Cookie: p.join('; ') } : {};
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
  return { statut: res.status, texte: await res.text(), location: res.headers.get('location') };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
async function loginComme(email, mdp) {
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  return { jar, ok: r.statut === 302 };
}

(async () => {
  console.log('== Analyse de documents IA — étape 4 : réglages Cohere ==', BASE);

  // ---- 1. Préparation ------------------------------------------------------------
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const hash = bcrypt.hashSync('Test1234!', 4);
  bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe) VALUES (?, ?, ?, 'courtier', ?, 0)")
    .run(cabA, 'courtier-cohere@t.ca', hash, 'Courtier Cohere');

  // ---- 2. État initial : aucun réglage ----------------------------------------------
  let reg = reglagesIA.obtenirReglage(cabA);
  test('initial : moteur « auto », aucune clé', reg.moteur === 'auto' && !reg.clePresente && !reg.cleCabinetPresente);
  test('initial : moteur effectif « local »', reglagesIA.moteurEffectif(cabA).mode === 'local');

  // ---- 3. Test de connexion sans clé : échec propre --------------------------------------
  const t0 = await reglagesIA.testerConnexion(cabA);
  test('test de connexion sans clé : ok=false, message clair, pas de crash',
    t0.ok === false && /Aucune clé/.test(t0.message), t0.message);

  // ---- 4. Login admin + page réglages --------------------------------------------------------
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp', r.statut === 302);
  r = await req(jar, 'GET', '/admin/cohere');
  test('page Admin → Clé IA accessible (admin)', r.statut === 200 && /Clé IA \(Cohere\)/.test(r.texte));
  test('page : aucun masque tant qu il n y a pas de clé', !/•••• ••••/.test(r.texte));

  // Courtier : refusé
  const loginC = await loginComme('courtier-cohere@t.ca', 'Test1234!');
  r = await req(loginC.jar, 'GET', '/admin/cohere');
  test('courtier : page réglages refusée (403)', r.statut === 403, String(r.statut));
  r = await req(loginC.jar, 'POST', '/admin/cohere/cle', { form: { cle: FAUSSE_CLE, _csrf: 'x' } });
  test('courtier : enregistrement de clé refusé (403)', r.statut === 403, String(r.statut));

  // ---- 5. Enregistrement de la clé : chiffrée au repos -------------------------------------------
  const page = await req(jar, 'GET', '/admin/cohere');
  r = await req(jar, 'POST', '/admin/cohere/cle', { form: { cle: FAUSSE_CLE, _csrf: csrf(page.texte) } });
  test('enregistrement de la clé → 200', r.statut === 200, String(r.statut));
  const ligne = bd.prepare('SELECT * FROM reglages_ia WHERE cabinet_id = ?').get(cabA);
  test('réglage créé en base', !!ligne);
  test('la valeur en base N EST PAS la clé en clair', ligne.cle_cohere_chiffree !== FAUSSE_CLE && !ligne.cle_cohere_chiffree.includes(FAUSSE_CLE));
  test('la valeur en base a le format chiffré (iv:tag:données)', /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/.test(ligne.cle_cohere_chiffree));
  test('déchiffrement (même mécanisme) redonne la clé', chiffrement.dechiffrer(ligne.cle_cohere_chiffree) === FAUSSE_CLE);
  test('cleCohere(cabinet) redonne la clé en mémoire seulement', reglagesIA.cleCohere(cabA) === FAUSSE_CLE);

  // ---- 6. Masquage : jamais la clé en clair dans les réponses ni le journal -------------------------
  r = await req(jar, 'GET', '/admin/cohere');
  test('page : masque « •••• 1234 » affiché', /•••• •••• 1234/.test(r.texte));
  test('page : la clé complète n apparaît NULLE PART', !r.texte.includes(FAUSSE_CLE));
  const journalCle = bd.prepare("SELECT details FROM journal_audit WHERE action LIKE 'analyse_reglage%'").all();
  test('journal : la clé n apparaît dans AUCUN détail', journalCle.every((j) => !(j.details || '').includes(FAUSSE_CLE)),
    JSON.stringify(journalCle.map((j) => j.details)));
  reg = reglagesIA.obtenirReglage(cabA);
  test('obtenirReglage : masque seulement, pas la clé', reg.masque === '•••• •••• 1234' && !JSON.stringify(reg).includes(FAUSSE_CLE));

  // ---- 7. Test de connexion avec la fausse clé : échec propre -----------------------------------------
  r = await req(jar, 'POST', '/admin/cohere/tester', { form: { _csrf: csrf(r.texte) } });
  test('test de connexion (fausse clé) → page rendue, pas de crash', r.statut === 200, String(r.statut));
  test('test de connexion (fausse clé) → échec expliqué (401, délai ou connexion)',
    /refusé la clé|Connexion à Cohere impossible|répondu|délai dépassé/.test(r.texte), r.texte.slice(0, 300));

  // ---- 8. Choix du moteur --------------------------------------------------------------------------------
  r = await req(jar, 'POST', '/admin/cohere/moteur', { form: { moteur: 'local', _csrf: csrf(r.texte) } });
  test('moteur « local » enregistré', reglagesIA.obtenirReglage(cabA).moteur === 'local');
  test('moteur effectif « local » malgré la clé', reglagesIA.moteurEffectif(cabA).mode === 'local');
  let ra = await moteur.analyser("Proposition d'assurance automobile FPQ1\nAssureur : Beneva\nPrime : 1 875 $", { cabinetId: cabA });
  test('analyse en mode local forcé : moteur « local »', ra.moteur === 'local' && ra.produit === 'auto');

  r = await req(jar, 'POST', '/admin/cohere/moteur', { form: { moteur: 'cohere', _csrf: csrf(r.texte) } });
  test('moteur « cohere » + clé présente → effectif « cohere »', reglagesIA.moteurEffectif(cabA).mode === 'cohere');

  // Badge de l'assistant : reflète le mode réel
  r = await req(jar, 'GET', '/assistant');
  test('badge assistant : « Cohere » (sans mention Canada — résidence non garantie) quand le mode effectif est cohere', /Moteur : Cohere(?! \(Canada\))/.test(r.texte));

  // ---- 9. Repli local du moteur d'analyse (fausse clé → Cohere refuse) --------------------------------------
  ra = await moteur.analyser("Proposition d'assurance automobile FPQ1\nAssureur : Beneva\nPrime : 1 875 $", { cabinetId: cabA });
  test('Cohere injoignable/refusé → repli local automatique', ra.moteur === 'local', ra.moteur);
  test('repli : les champs locaux sont quand même proposés', ra.produit === 'auto' && ra.champs.length >= 2);
  test('repli : message honnête mentionnant le repli', /Repli sur le moteur local/.test(ra.message || ''), ra.message);

  // ---- 10. Retrait de la clé + moteur auto → local ------------------------------------------------------------
  r = await req(jar, 'POST', '/admin/cohere/moteur', { form: { moteur: 'auto', _csrf: csrf(r.texte) } });
  r = await req(jar, 'POST', '/admin/cohere/effacer', { form: { _csrf: csrf(r.texte) } });
  const ligne2 = bd.prepare('SELECT * FROM reglages_ia WHERE cabinet_id = ?').get(cabA);
  test('clé retirée : colonne NULL en base', !!ligne2 && ligne2.cle_cohere_chiffree === null);
  test('auto sans clé → moteur effectif « local »', reglagesIA.moteurEffectif(cabA).mode === 'local');
  r = await req(jar, 'GET', '/assistant');
  test('badge assistant : repassé à « local »', /Moteur : local/.test(r.texte));

  // Clé trop courte refusée
  let erreur = null;
  try { reglagesIA.definirCle(cabA, 1, 'abc'); } catch (e) { erreur = e.message; }
  test('clé trop courte refusée', !!erreur && /trop courte/.test(erreur), erreur);

  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
