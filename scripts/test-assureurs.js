/**
 * scripts/test-assureurs.js — Fiches assureurs enrichies :
 * contacts comptabilité, produits offerts + taux de commission,
 * statistiques par assureur selon le rôle (admin/manager/courtier),
 * équipes (manager_id), filtre assureur par produit dans le formulaire police,
 * retrait du compteur de la liste, cloisonnement inter-cabinets.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-assureurs.js
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

// form : objet ou tableau de paires [clé, valeur] (pour les champs répétés)
async function req(jar, methode, chemin, { form = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    corps = new URLSearchParams(Array.isArray(form) ? form : form).toString();
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

function test(nom, condition, detail) {
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

const norm = (s) => s.replace(/[\s\u00a0\u202f\u2007]/g, '');
const fmt = (d) => d.toISOString().slice(0, 10);
function dansJours(n) { const d = new Date(); d.setDate(d.getDate() + n); return fmt(d); }

async function connexion(jar, email, mdp) {
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  return r;
}

// Crée un utilisateur (admin) et force le changement de mot de passe ; retourne son id.
async function creerUtilisateur(jar, { nom, email, role, mdp }) {
  let r = await req(jar, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jar, 'POST', '/admin/utilisateurs', {
    form: { _csrf: csrf(r.texte), nom, email, cabinet_id: '1', role, mot_de_passe: mdp },
  });
  if (r.statut !== 302) return { ok: false, statut: r.statut };
  r = await req(jar, 'GET', '/admin/utilisateurs');
  const m = r.texte.match(new RegExp(email.replace(/\./g, '\\.') + '[\\s\\S]*?\\/admin\\/utilisateurs\\/(\\d+)\\/desactiver'));
  const id = m ? m[1] : null;
  // Premier login + changement de mot de passe forcé
  const jarU = nouveauJar();
  r = await connexion(jarU, email, mdp);
  const nouveau = mdp.replace(/!$/, '2!');
  r = await req(jarU, 'GET', '/mot-de-passe');
  r = await req(jarU, 'POST', '/mot-de-passe', {
    form: { _csrf: csrf(r.texte), actuel: mdp, nouveau, confirmation: nouveau },
  });
  return { ok: true, id, jar: jarU, mdp: nouveau };
}

async function creerClient(jar, raisonSociale, responsableId) {
  let r = await req(jar, 'GET', '/clients/nouveau');
  r = await req(jar, 'POST', '/clients', {
    form: {
      _csrf: csrf(r.texte), raison_sociale: raisonSociale, prenom: 'Jean', nom: 'Test',
      langue: 'FR', responsable_id: String(responsableId),
    },
  });
  return (r.location || '').match(/\/clients\/(\d+)/)?.[1] || null;
}

async function creerPolice(jar, clientId, ligne, assureurId, numero) {
  let r = await req(jar, 'GET', '/polices/nouvelle');
  r = await req(jar, 'POST', '/polices', {
    form: {
      _csrf: csrf(r.texte), client_id: String(clientId), ligne, assureur_id: String(assureurId),
      numero_police: numero, date_effet: dansJours(-300), date_echeance: dansJours(65),
      franchise: '1000', statut: 'active',
    },
  });
  return (r.location || '').match(/\/police\/(\d+)/)?.[1] || null;
}

async function ajouterProtection(jar, policeId, code, prime) {
  const r = await req(jar, 'GET', '/echeances/police/' + policeId);
  await req(jar, 'POST', `/polices/${policeId}/protections`, {
    form: { _csrf: csrf(r.texte), code, prime: String(prime) },
  });
}

(async () => {
  const jar = nouveauJar();
  let r = await connexion(jar, 'admin@demo.ca', 'ChangeMoi123!');
  test('login admin → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', {
    form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'AdminTest123!', confirmation: 'AdminTest123!' },
  });

  // ---- 1. Produits offerts + taux + comptabilité ----------------------------------------
  console.log('1. Produits offerts, taux, comptabilité');
  r = await req(jar, 'GET', '/assureurs/nouveau');
  test('formulaire → 200 avec section Produits offerts et Comptabilité',
    r.statut === 200 && /Produits offerts/.test(r.texte) && /Comptabilit/.test(r.texte), r.statut);

  const formAssureur = (jeton, nom, extra = []) => [
    ['_csrf', jeton], ['nom', nom], ['telephone_general', '1-800-000-0000'],
    ['na_nom', 'NA Test'], ['na_courriel', 'na@wawanesa.test'],
    ['mod_nom', 'MOD Test'], ['mod_courriel', 'mod@wawanesa.test'],
    ['compta_nom', 'Compta Test'], ['compta_telephone', '1-800-111-1111'], ['compta_courriel', 'compta@wawanesa.test'],
    ...extra,
  ];
  r = await req(jar, 'GET', '/assureurs/nouveau');
  r = await req(jar, 'POST', '/assureurs', {
    form: formAssureur(csrf(r.texte), 'Wawanesa Test', [
      ['produits', 'cgl'], ['produits', 'cyber'],
      ['commission_cgl', '12.5'], ['commission_cyber', '15'],
    ]),
  });
  test('création assureur avec produits/taux → 302', r.statut === 302 && /\/assureurs\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idWawanesa = (r.location || '').match(/\/assureurs\/(\d+)/)[1];

  r = await req(jar, 'GET', '/assureurs/' + idWawanesa);
  const fiche = r.texte;
  test('fiche → 200', r.statut === 200, r.statut);
  test('comptabilité affichée', /Comptabilit/.test(fiche) && /compta@wawanesa\.test/.test(fiche));
  test('produits + taux affichés',
    /Responsabilit. civile \(CGL\)/.test(fiche) && /12\.5 %/.test(fiche) && /Cyberrisques/.test(fiche) && /15 %/.test(fiche));

  // Modification : on décoche cyber
  r = await req(jar, 'GET', '/assureurs/' + idWawanesa + '/modifier');
  test('formulaire modif pré-rempli (cases cochées)',
    r.statut === 200 && /name="produits" value="cgl" checked/.test(r.texte) && /name="commission_cgl"[^>]*value="12\.5"/.test(r.texte), r.statut);
  r = await req(jar, 'POST', '/assureurs/' + idWawanesa, {
    form: formAssureur(csrf(r.texte), 'Wawanesa Test', [['produits', 'cgl'], ['commission_cgl', '12.5']]),
  });
  test('modification → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/assureurs/' + idWawanesa);
  test('cyber retiré des produits offerts', !/Cyberrisques/.test(r.texte) && /Responsabilit. civile \(CGL\)/.test(r.texte));

  // Validation du taux
  r = await req(jar, 'GET', '/assureurs/nouveau');
  r = await req(jar, 'POST', '/assureurs', {
    form: formAssureur(csrf(r.texte), 'Taux Invalide', [['produits', 'cgl'], ['commission_cgl', '150']]),
  });
  test('taux > 100 → 400', r.statut === 400, r.statut);

  // Liste : plus de compteur « Polices actives »
  r = await req(jar, 'GET', '/assureurs');
  test('liste sans colonne Polices actives', r.statut === 200 && !/Polices actives/.test(r.texte), r.statut);

  // ---- 2. Filtre assureur par produit (formulaire police) --------------------------------
  console.log('2. Filtre assureur par produit');
  r = await req(jar, 'GET', '/polices/nouvelle');
  test('options avec data-produits', r.statut === 200 && /data-produits="cgl"/.test(r.texte), r.statut);
  test('JS de filtrage chargé', /filtrerAssureurs/.test((await req(jar, 'GET', '/app.js')).texte));

  // ---- 3. Équipes + stats par rôle ---------------------------------------------------------
  console.log('3. Équipes et statistiques par rôle');
  const mgr = await creerUtilisateur(jar, { nom: 'Manager Un', email: 'manager1@test.ca', role: 'manager', mdp: 'ManagerTest1!' });
  test('manager créé', mgr.ok && !!mgr.id, mgr.statut);
  const c1 = await creerUtilisateur(jar, { nom: 'Courtier Un', email: 'courtier1@test.ca', role: 'courtier', mdp: 'CourtierTest1!' });
  test('courtier 1 créé', c1.ok && !!c1.id);
  const c2 = await creerUtilisateur(jar, { nom: 'Courtier Deux', email: 'courtier2@test.ca', role: 'courtier', mdp: 'CourtierTest2!' });
  test('courtier 2 créé', c2.ok && !!c2.id);

  // Rattacher les courtiers au manager
  r = await req(jar, 'GET', '/admin/utilisateurs');
  const jetonAdmin = csrf(r.texte);
  for (const [nom, u] of [['c1', c1], ['c2', c2]]) {
    r = await req(jar, 'POST', `/admin/utilisateurs/${u.id}/manager`, { form: { _csrf: jetonAdmin, manager_id: mgr.id } });
    test(`rattachement ${nom} au manager → 302`, r.statut === 302, r.statut);
  }
  r = await req(jar, 'GET', '/admin/utilisateurs');
  test('équipe affichée dans la liste', /Manager Un/.test(r.texte));

  // Manager invalide : autre cabinet / soi-même
  r = await req(jar, 'POST', `/admin/utilisateurs/${c1.id}/manager`, { form: { _csrf: jetonAdmin, manager_id: '99999' } });
  test('manager inexistant → 400', r.statut === 400, r.statut);
  r = await req(jar, 'POST', `/admin/utilisateurs/${c1.id}/manager`, { form: { _csrf: jetonAdmin, manager_id: c1.id } });
  test('auto-rattachement → 400', r.statut === 400, r.statut);

  // Données : client A (courtier1) : 1 police CGL Wawanesa, primes 1000+500
  //           client B (courtier2) : 1 police CGL Wawanesa prime 2000 + 1 police BIENS Wawanesa prime 3000 (sans taux)
  const idCliA = await creerClient(jar, 'Client Alpha inc.', c1.id);
  const idCliB = await creerClient(jar, 'Client Beta inc.', c2.id);
  test('clients créés avec responsables', !!idCliA && !!idCliB);
  const pA = await creerPolice(jar, idCliA, 'cgl', idWawanesa, 'CGL-WAW-001');
  await ajouterProtection(jar, pA, 'RC-GEN', 1000);
  await ajouterProtection(jar, pA, 'PROD', 500);
  const pB1 = await creerPolice(jar, idCliB, 'cgl', idWawanesa, 'CGL-WAW-002');
  await ajouterProtection(jar, pB1, 'RC-GEN', 2000);
  const pB2 = await creerPolice(jar, idCliB, 'biens', idWawanesa, 'BIEN-WAW-003');
  await ajouterProtection(jar, pB2, 'BAT', 3000);
  test('polices + protections créées', !!pA && !!pB1 && !!pB2);

  const lireStats = (html) => {
    const t = norm(html);
    const nb = t.match(/<strong>(\d+)<\/strong><br><spanclass="petit">policesactives<\/span>/);
    const vol = t.match(/<strong>([\d,]+)\$<\/strong><br><spanclass="petit">volumedeprimes<\/span>/);
    const com = t.match(/<strong>([\d,]+)\$<\/strong><br><spanclass="petit">commissionsestimées<\/span>/);
    const portee = html.match(/Chiffres — ([^<]+)</)?.[1].trim();
    return { nb: nb?.[1], vol: vol?.[1], com: com?.[1], portee, avert: /pas de taux de commission/.test(html) };
  };

  // Courtier 1 : seulement sa police → 1 police, 1500,00 $, 187,50 $
  r = await req(c1.jar, 'GET', '/assureurs/' + idWawanesa);
  let s = lireStats(r.texte);
  test('courtier1 : périmètre portefeuille', s.portee === 'votre portefeuille', s.portee);
  test('courtier1 : 1 police', s.nb === '1', JSON.stringify(s));
  test('courtier1 : volume 1 500,00', s.vol === '1500,00', s.vol);
  test('courtier1 : commissions 187,50', s.com === '187,50', s.com);
  test('courtier1 : ne voit pas la police de courtier2', !/CGL-WAW-002/.test(r.texte) && /CGL-WAW-001/.test(r.texte));

  // Courtier 2 : 2 polices, volume 5000,00 $, commissions 250,00 $ + avertissement sans taux
  r = await req(c2.jar, 'GET', '/assureurs/' + idWawanesa);
  s = lireStats(r.texte);
  test('courtier2 : 2 polices', s.nb === '2', JSON.stringify(s));
  test('courtier2 : volume 5 000,00', s.vol === '5000,00', s.vol);
  test('courtier2 : commissions 250,00 (biens sans taux)', s.com === '250,00', s.com);
  test('courtier2 : avertissement taux manquant', s.avert);
  test('courtier2 : ne voit pas la police de courtier1', !/CGL-WAW-001/.test(r.texte) && /CGL-WAW-002/.test(r.texte));

  // Manager : équipe (3 polices), volume 6500,00 $, commissions 437,50 $
  r = await req(mgr.jar, 'GET', '/assureurs/' + idWawanesa);
  s = lireStats(r.texte);
  test('manager : périmètre équipe', s.portee === 'votre équipe', s.portee);
  test('manager : 3 polices', s.nb === '3', JSON.stringify(s));
  test('manager : volume 6 500,00', s.vol === '6500,00', s.vol);
  test('manager : commissions 437,50', s.com === '437,50', s.com);

  // Admin : tout le cabinet
  r = await req(jar, 'GET', '/assureurs/' + idWawanesa);
  s = lireStats(r.texte);
  test('admin : périmètre tout le cabinet', s.portee === 'tout le cabinet', s.portee);
  test('admin : 3 polices', s.nb === '3', JSON.stringify(s));
  test('admin : commissions 437,50', s.com === '437,50', s.com);

  // Manager sans équipe : seulement lui-même
  const mgr2 = await creerUtilisateur(jar, { nom: 'Manager Solo', email: 'manager2@test.ca', role: 'manager', mdp: 'ManagerTest2!' });
  const idCliM = await creerClient(jar, 'Client Manager inc.', mgr2.id);
  const pM = await creerPolice(jar, idCliM, 'cgl', idWawanesa, 'CGL-WAW-004');
  await ajouterProtection(jar, pM, 'RC-GEN', 100);
  r = await req(mgr2.jar, 'GET', '/assureurs/' + idWawanesa);
  s = lireStats(r.texte);
  test('manager solo : seulement ses polices', s.nb === '1' && s.com === '12,50', JSON.stringify(s));

  // ---- 4. Cloisonnement inter-cabinets ------------------------------------------------------
  console.log('4. Cloisonnement');
  r = await req(jar, 'GET', '/admin/cabinets');
  r = await req(jar, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Test 2' } });
  test('2e cabinet créé', r.statut === 302, r.statut);
  // Utilisateur du cabinet 2 : création directe admin avec cabinet_id 2
  r = await req(jar, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jar, 'POST', '/admin/utilisateurs', {
    form: { _csrf: csrf(r.texte), nom: 'User Cab2', email: 'usercab2@test.ca', cabinet_id: '2', role: 'courtier', mot_de_passe: 'UserCab2Test1!' },
  });
  test('utilisateur cabinet 2 créé', r.statut === 302, r.statut);
  const jarCab2 = nouveauJar();
  await connexion(jarCab2, 'usercab2@test.ca', 'UserCab2Test1!');
  r = await req(jarCab2, 'GET', '/mot-de-passe');
  await req(jarCab2, 'POST', '/mot-de-passe', {
    form: { _csrf: csrf(r.texte), actuel: 'UserCab2Test1!', nouveau: 'UserCab2Test2!', confirmation: 'UserCab2Test2!' },
  });
  r = await req(jarCab2, 'GET', '/assureurs');
  test('cabinet 2 : ne voit pas Wawanesa Test', r.statut === 200 && !/Wawanesa Test/.test(r.texte));
  r = await req(jarCab2, 'GET', '/assureurs/' + idWawanesa);
  test('cabinet 2 : fiche assureur cabinet 1 → 404', r.statut === 404, r.statut);

  // ---- 5. Journal d'audit -------------------------------------------------------------------
  console.log('5. Audit');
  r = await req(jar, 'GET', '/admin/journal');
  test('actions assureur journalisées', /assureur_cree/.test(r.texte) && /assureur_modifie/.test(r.texte));
  test('rattachement équipe journalisé', /utilisateur_manager/.test(r.texte));

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE', e); process.exit(1); });
