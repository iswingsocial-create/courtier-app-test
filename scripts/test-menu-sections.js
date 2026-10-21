/**
 * scripts/test-menu-sections.js — Menu principal réorganisé par sections
 * métier (demande de Patrick : « plus naturel, moins de liens, mets-les par
 * section, plus simple à trouver »). Vérifie : chaque page principale
 * répond ; le HTML contient Échéances en lien direct + les 7 en-têtes de
 * section (<details> natif) ; chaque ancien lien est présent exactement
 * une fois dans la nav, avec la bonne URL et le bon libellé ; la section
 * de la page courante est ouverte par défaut, son libellé marqué
 * « courant » et le lien courant surligné ; pour un rôle non-admin, la
 * section Admin et ses liens sont absents.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-menu-sections.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const bd = new Database(process.env.CHEMIN_BD);

const BASE = `http://localhost:${process.env.PORT || 3101}`;
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
  const paires = Object.entries(jar).map(([k, v]) => `${k}=${v}`);
  return paires.length ? { Cookie: paires.join('; ') } : {};
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
  const texte = await res.text();
  return { statut: res.status, texte, location: res.headers.get('location') };
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

// Les 28 liens historiques (URL, libellé) — aucun ne doit disparaître.
const LIENS = [
  ['/echeances', 'Échéances'],
  ['/clients', 'Entreprises'], ['/leads', 'Leads'],
  ['/auto', 'Auto'], ['/biens', 'Biens'], ['/rc', 'RC'], ['/cyber', 'Cyber'], ['/eo', 'E&O'],
  ['/do', 'D&O'], ['/pe', "Perte d'exploitation"], ['/flotte', 'Flotte'], ['/cautionnement', 'Cautionnement'],
  ['/polices', 'Polices'], ['/reclamations', 'Réclamations'],
  ['/courriels', 'Courriels'], ['/brouillons', 'Brouillons'], ['/campagnes', 'Campagnes'], ['/reunions', 'Réunions'],
  ['/ouverture', '🎙️ Ouvrir un dossier'], ['/analyses', '📥 Analyser un document'], ['/assistant', 'Assistant IA'],
  ['/assureurs', 'Assureurs'], ['/factures', 'Facturation'], ['/taches', 'Tâches'], ['/import', 'Import'], ['/exports', 'Exports'],
  ['/admin/utilisateurs', 'Admin'], ['/admin/journal', 'Journal'],
];
const SECTIONS = [
  ['clients', '👥 Clients'], ['soumissions', '📝 Soumissions'], ['polices', '🛡️ Polices'],
  ['communications', '✉️ Communications'], ['outils-ia', '🤖 Outils IA'], ['gestion', '🗂️ Gestion'],
  ['admin', '⚙️ Admin'],
];
// Page principale → section qui doit être marquée (null = Échéances, lien direct)
const PAGE_SECTION = {
  '/echeances': null,
  '/clients': 'clients', '/leads': 'clients',
  '/auto': 'soumissions', '/biens': 'soumissions', '/rc': 'soumissions', '/cyber': 'soumissions',
  '/eo': 'soumissions', '/do': 'soumissions', '/pe': 'soumissions', '/flotte': 'soumissions',
  '/cautionnement': 'soumissions',
  '/polices': 'polices', '/reclamations': 'polices',
  '/courriels': 'communications', '/brouillons': 'communications', '/campagnes': 'communications',
  '/reunions': 'communications',
  '/ouverture': 'outils-ia', '/analyses': 'outils-ia', '/assistant': 'outils-ia',
  '/assureurs': 'gestion', '/factures': 'gestion', '/taches': 'gestion', '/import': 'gestion',
  '/exports': 'gestion',
  '/admin/utilisateurs': 'admin', '/admin/journal': 'admin',
};

function blocNav(html) {
  const d = html.indexOf('<nav class="menu-sections">');
  const f = html.indexOf('</nav>', d);
  return d >= 0 && f > d ? html.slice(d, f) : '';
}
const nb = (txt, motif) => txt.split(motif).length - 1;

(async () => {
  console.log('== Menu principal par sections ==', BASE);

  // ---- 1. Login admin -----------------------------------------------------
  console.log('1. Login admin');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, String(r.statut));

  // ---- 2. Structure complète sur la page d'accueil -------------------------
  console.log('2. Structure du menu (admin, /echeances)');
  r = await req(jar, 'GET', '/echeances');
  test('/echeances → 200', r.statut === 200, String(r.statut));
  const nav = blocNav(r.texte);
  test('nav « menu-sections » présente', nav.length > 0);
  test('Échéances en lien direct, seul en tête', /<a class="menu-direct[^"]*" href="\/echeances">Échéances<\/a>/.test(nav));
  test('7 sections <details> présentes', nb(nav, 'data-section=') === 7, String(nb(nav, 'data-section=')));
  for (const [id, libelle] of SECTIONS) {
    test(`section « ${libelle} » (data-section="${id}") avec son libellé`,
      nav.includes(`data-section="${id}"`) && nav.includes(`>${libelle}</summary>`));
  }
  for (const [url, libelle] of LIENS) {
    test(`lien ${url} présent exactement une fois, libellé « ${libelle} »`,
      nb(nav, `href="${url}"`) === 1 && nav.includes(`>${libelle}</a>`));
  }

  // ---- 3. Chaque page principale + sa section marquée -----------------------
  console.log('3. Pages principales et section courante');
  for (const [page, section] of Object.entries(PAGE_SECTION)) {
    const rp = await req(jar, 'GET', page);
    const navP = blocNav(rp.texte);
    test(`${page} → 200, nav par sections présente`, rp.statut === 200 && navP.length > 0, String(rp.statut));
    if (section === null) {
      test(`${page} : lien direct Échéances actif, aucune section ouverte`,
        navP.includes('menu-direct actif') && !/data-section="[a-z-]+" open/.test(navP));
    } else {
      const libSec = SECTIONS.find(([id]) => id === section)[1];
      test(`${page} : section « ${libSec} » ouverte et marquée, lien courant actif`,
        navP.includes(`data-section="${section}" open`)
        && navP.includes(`<summary class="courant">${libSec}</summary>`)
        && new RegExp(`<a class="actif" href="${page.replace(/\//g, '\\/')}">`).test(navP));
    }
  }

  // ---- 4. Rôle non-admin : pas de section Admin ------------------------------
  console.log('4. Rôle courtier (non-admin)');
  const cabId = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const hash = bcrypt.hashSync('CourtierMenu123!', 12);
  bd.prepare(`INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe, actif)
    VALUES (?, 'courtier.menu@test.ca', ?, 'courtier', 'Courtier Test Menu', 0, 1)`).run(cabId, hash);
  const lc = await loginComme('courtier.menu@test.ca', 'CourtierMenu123!');
  test('login courtier → 302', lc.ok);
  r = await req(lc.jar, 'GET', '/echeances');
  const navC = blocNav(r.texte);
  test('courtier : nav présente avec 6 sections (sans Admin)', navC.length > 0 && nb(navC, 'data-section=') === 6, String(nb(navC, 'data-section=')));
  test('courtier : aucune trace de la section Admin ni de ses liens',
    !navC.includes('data-section="admin"') && !navC.includes('href="/admin/utilisateurs"') && !navC.includes('href="/admin/journal"'));
  const manquants = LIENS.filter(([u]) => !u.startsWith('/admin'))
    .filter(([url]) => nb(navC, `href="${url}"`) !== 1).map(([url]) => url);
  test('courtier : les 26 liens non-admin sont tous présents exactement une fois',
    manquants.length === 0, manquants.join(', '));

  console.log(`\n${total - echecs}/${total} tests réussis`);
  if (echecs) { console.log(`💥 ${echecs} échec(s)`); process.exit(1); }
  console.log('🎉 TOUS LES TESTS PASSENT');
})().catch((e) => { console.error(e); process.exit(1); });
