/**
 * scripts/test-nouveaux-modules.js — Tests des 4 nouveaux modules :
 * Facturation, Leads (capture publique), Campagnes, Réunions.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed commercial).
 * Usage : PORT=3101 node scripts/test-nouveaux-modules.js
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

const fmt = (d) => d.toISOString().slice(0, 10);
function dansJours(n) { const d = new Date(); d.setDate(d.getDate() + n); return fmt(d); }

async function loginAdmin() {
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  return jar;
}

async function creerEntreprise(jar, suffixe, secteur, consentMarketing) {
  let r = await req(jar, 'GET', '/clients/nouveau');
  const form = {
    _csrf: csrf(r.texte), raison_sociale: `Test Fact ${suffixe} inc.`, neq: '', secteur_activite: secteur,
    prenom: 'Test', nom: 'Contact', titre_contact: 'Dir.', courriel: `test${suffixe}@exemple.ca`,
    telephone: '514-555-0900', adresse: '', ville: 'Laval', code_postal: 'H7N 1A1',
    langue: 'FR', notes: '', responsable_id: '1',
  };
  if (consentMarketing) form.consent_marketing = 'on';
  r = await req(jar, 'POST', '/clients', { form });
  const m = (r.location || '').match(/\/clients\/(\d+)/);
  return m ? m[1] : null;
}

(async () => {
  console.log('== Tests nouveaux modules :', BASE);
  const jar = await loginAdmin();

  // ---- 1. Onglets ----------------------------------------------------------------
  console.log('1. Navigation');
  let r = await req(jar, 'GET', '/echeances');
  test('onglet Facturation', /href="\/factures"/.test(r.texte));
  test('onglet Leads', /href="\/leads"/.test(r.texte));
  test('onglet Campagnes', /href="\/campagnes"/.test(r.texte));
  test('onglet Réunions', /href="\/reunions"/.test(r.texte));

  // ---- 2. Facturation --------------------------------------------------------------
  console.log('2. Facturation');
  const idEnt = await creerEntreprise(jar, 'fac', 'Construction', false);
  test('entreprise de test créée', !!idEnt, idEnt);

  r = await req(jar, 'GET', '/factures/nouvelle');
  test('formulaire facture → 200', r.statut === 200, r.statut);
  r = await req(jar, 'POST', '/factures', { form: {
    _csrf: csrf(r.texte), client_id: idEnt, police_id: '', description: 'Prime test 2026',
    montant: '1000.00', date_emission: dansJours(-30), date_echeance: dansJours(-5), notes: '',
  }});
  test('création facture → 302 vers fiche', r.statut === 302 && /\/factures\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idFac = (r.location || '').match(/\/factures\/(\d+)/)[1];

  // Sans client → 400 (principe : tout relié au client)
  r = await req(jar, 'GET', '/factures/nouvelle');
  r = await req(jar, 'POST', '/factures', { form: {
    _csrf: csrf(r.texte), client_id: '', description: 'Sans client', montant: '10',
    date_emission: dansJours(0), date_echeance: dansJours(30),
  }});
  test('facture sans entreprise → 400', r.statut === 400, r.statut);

  // Détection en retard au listage
  r = await req(jar, 'GET', '/factures');
  test('liste factures → 200', r.statut === 200, r.statut);
  r = await req(jar, 'GET', '/factures/' + idFac);
  test('statut en_retard détecté', /En retard/.test(r.texte), 'marquerRetards');
  test('jours de retard affichés', /jour(s)? de retard/.test(r.texte));

  // Paiement partiel → statut partielle
  r = await req(jar, 'POST', `/factures/${idFac}/paiements`, { form: {
    _csrf: csrf(r.texte), montant: '400.00', date_paiement: dansJours(0), mode: 'virement', notes: '',
  }});
  test('paiement partiel → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/factures/' + idFac);
  test('400 $ payés, statut reste En retard (échéance dépassée)', /En retard/.test(r.texte) && /400\.00 \$/.test(r.texte));
  test('solde 600 $ affiché', /600\.00 \$/.test(r.texte));

  // Paiement total → payee
  r = await req(jar, 'POST', `/factures/${idFac}/paiements`, { form: {
    _csrf: csrf(r.texte), montant: '600.00', date_paiement: dansJours(0), mode: 'cheque', notes: 'Solde',
  }});
  r = await req(jar, 'GET', '/factures/' + idFac);
  test('statut payee après solde', />Payée</.test(r.texte));

  // Facture non échue + paiement partiel → statut 'partielle'
  r = await req(jar, 'GET', '/factures/nouvelle');
  r = await req(jar, 'POST', '/factures', { form: {
    _csrf: csrf(r.texte), client_id: idEnt, description: 'Prime non échue', montant: '800.00',
    date_emission: dansJours(0), date_echeance: dansJours(30),
  }});
  const idFac3 = (r.location || '').match(/\/factures\/(\d+)/)[1];
  r = await req(jar, 'GET', '/factures/' + idFac3);
  r = await req(jar, 'POST', `/factures/${idFac3}/paiements`, { form: {
    _csrf: csrf(r.texte), montant: '300.00', date_paiement: dansJours(0), mode: 'carte', notes: '',
  }});
  r = await req(jar, 'GET', '/factures/' + idFac3);
  test('statut Partiellement payée (non échue)', /Partiellement payée/.test(r.texte));
  test('numéro auto-incrémenté FAC-2026-', /FAC-2026-/.test(r.texte));

  // Relance sur facture soldée → 400 ; sur impayée → brouillon
  r = await req(jar, 'POST', `/factures/${idFac}/relance`, { form: { _csrf: csrf(r.texte) } });
  test('relance sur facture soldée → 400', r.statut === 400, r.statut);

  r = await req(jar, 'GET', '/factures/nouvelle');
  r = await req(jar, 'POST', '/factures', { form: {
    _csrf: csrf(r.texte), client_id: idEnt, description: 'Prime impayée', montant: '500.00',
    date_emission: dansJours(-40), date_echeance: dansJours(-10),
  }});
  const idFac2 = (r.location || '').match(/\/factures\/(\d+)/)[1];
  r = await req(jar, 'GET', '/factures/' + idFac2);
  r = await req(jar, 'POST', `/factures/${idFac2}/relance`, { form: { _csrf: csrf(r.texte) } });
  test('relance → 302 vers brouillon', r.statut === 302 && /\/brouillons\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idBrouillon = (r.location || '').match(/\/brouillons\/(\d+)/)[1];
  r = await req(jar, 'GET', '/brouillons/' + idBrouillon);
  test('brouillon de relance visible', r.statut === 200 && /Rappel/.test(r.texte) && /Facture/.test(r.texte), r.statut);
  test('brouillon jamais envoyé auto (statut brouillon)', />brouillon</.test(r.texte));

  // Comptes en retard : vue + badge dashboard
  r = await req(jar, 'GET', '/factures?statut=en_retard');
  test('vue comptes en retard → 200', r.statut === 200 && /Comptes en retard/.test(r.texte), r.statut);
  r = await req(jar, 'GET', '/echeances');
  test('badge comptes en retard sur dashboard', /Comptes en retard/.test(r.texte));

  // Cloisonnement : 2e cabinet ne voit pas la facture
  r = await req(jar, 'GET', '/admin/cabinets');
  r = await req(jar, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Test 2' } });
  test('2e cabinet créé', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jar, 'POST', '/admin/utilisateurs', { form: {
    _csrf: csrf(r.texte), cabinet_id: '2', nom: 'User Test', email: 'user2@test.ca',
    mot_de_passe: 'TestChange789!', role: 'courtier',
  }});
  const jar2 = nouveauJar();
  r = await req(jar2, 'GET', '/connexion');
  r = await req(jar2, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'user2@test.ca', mot_de_passe: 'TestChange789!' } });
  r = await req(jar2, 'GET', '/mot-de-passe');
  r = await req(jar2, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'TestChange789!', nouveau: 'TestChange789!x', confirmation: 'TestChange789!x' } });
  r = await req(jar2, 'GET', '/factures');
  test('cabinet 2 : liste factures vide', r.statut === 200 && !/FAC-2026/.test(r.texte), 'cloisonnement');
  r = await req(jar2, 'GET', '/factures/' + idFac2);
  test('cabinet 2 : facture cabinet 1 → 404', r.statut === 404, r.statut);

  // ---- 3. Leads + capture publique ---------------------------------------------------
  console.log('3. Leads et capture publique');
  r = await req(jar, 'GET', '/admin/cabinets');
  const mToken = r.texte.match(/\/capture\/([0-9a-f]{32,})/);
  test('jeton de capture affiché (admin)', !!mToken, 'token_capture');
  const token = mToken[1];

  const jarPublic = nouveauJar(); // sans auth
  r = await req(jarPublic, 'GET', '/capture/' + token);
  test('formulaire public → 200 sans auth', r.statut === 200 && /Envoyer ma demande/.test(r.texte), r.statut);
  test('formulaire public sans nav privée', !/href="\/factures"/.test(r.texte));
  r = await req(jarPublic, 'GET', '/capture/token-invalide-xyz');
  test('token invalide → 404', r.statut === 404, r.statut);

  // Honeypot rempli → bloqué silencieusement, aucun lead créé
  r = await req(jarPublic, 'POST', '/capture/' + token, { form: {
    nom: 'Robot Spam', site_web: 'http://spam.example', courriel: 'robot@spam.example',
  }});
  test('honeypot → page merci (leurre)', r.statut === 200 && /Merci/.test(r.texte), r.statut);
  r = await req(jar, 'GET', '/leads');
  test('aucun lead spam créé', !/Robot Spam/.test(r.texte));

  // Capture valide
  r = await req(jarPublic, 'POST', '/capture/' + token, { form: {
    nom: 'Prospect Pub', entreprise: 'Pub Inc.', courriel: 'prospect@pubinc.ca', telephone: '514-555-0777',
    besoin: 'Assurance pour mon commerce.', site_web: '',
    utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'promo-test',
  }});
  test('capture valide → merci', r.statut === 200 && /Merci/.test(r.texte), r.statut);
  r = await req(jar, 'GET', '/leads');
  test('lead visible dans le pipeline (nouveau)', /Prospect Pub/.test(r.texte) && /Nouveau/.test(r.texte));
  const mLead2 = r.texte.match(/<strong>Prospect Pub<\/strong>[\s\S]*?\/leads\/(\d+)/);
  const idLead = mLead2 ? mLead2[1] : null;
  test('id du lead récupéré', !!idLead, idLead || 'non trouvé');

  // Changement de statut + suivi
  r = await req(jar, 'GET', '/leads/' + idLead);
  r = await req(jar, 'POST', `/leads/${idLead}/statut`, { form: { _csrf: csrf(r.texte), statut: 'contacte' } });
  test('statut → contacte', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/leads/' + idLead);
  r = await req(jar, 'POST', `/leads/${idLead}/suivis`, { form: { _csrf: csrf(r.texte), texte: 'Appelé, rappel demain.' } });
  test('suivi ajouté', r.statut === 302, r.statut);

  // Conversion en entreprise
  r = await req(jar, 'GET', '/leads/' + idLead);
  r = await req(jar, 'POST', `/leads/${idLead}/convertir`, { form: { _csrf: csrf(r.texte) } });
  test('conversion → 302 vers entreprise', r.statut === 302 && /\/clients\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idEntConv = (r.location || '').match(/\/clients\/(\d+)/)[1];
  r = await req(jar, 'GET', '/clients/' + idEntConv);
  test('entreprise créée depuis le lead', r.statut === 200 && /Pub Inc/.test(r.texte), r.statut);
  test('note de conversion présente', /Converti du lead/.test(r.texte));

  // Stats
  r = await req(jar, 'GET', '/leads/stats');
  test('stats → 200 + campagne', r.statut === 200 && /promo-test/.test(r.texte), r.statut);

  // Cloisonnement leads (cabinet 2)
  r = await req(jar2, 'GET', '/leads');
  test('cabinet 2 : aucun lead du cabinet 1', r.statut === 200 && !/Prospect Pub/.test(r.texte));

  // ---- 4. Campagnes ---------------------------------------------------------------------
  console.log('4. Campagnes');
  const idEntA = await creerEntreprise(jar, 'campA', 'Restauration', true);
  const idEntB = await creerEntreprise(jar, 'campB', 'Restauration', false);
  test('entreprises de test campagne', !!idEntA && !!idEntB);

  r = await req(jar, 'GET', '/campagnes/nouvelle');
  test('formulaire campagne → 200', r.statut === 200, r.statut);
  r = await req(jar, 'POST', '/campagnes', { form: {
    _csrf: csrf(r.texte), nom: 'Campagne Test Resto', secteurs: 'Restauration',
    objet: 'Vos assurances sont-elles à jour ?', contenu: 'Bonjour, petit mot pour faire le point sur vos assurances. '.repeat(5),
  }});
  test('création campagne → 302', r.statut === 302 && /\/campagnes\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idCamp = (r.location || '').match(/\/campagnes\/(\d+)/)[1];

  r = await req(jar, 'GET', '/campagnes/' + idCamp);
  test('fiche campagne → 200', r.statut === 200, r.statut);
  test('1 consenti / 1 exclu (LCAP)', /Consentis \(destinataires\)/.test(r.texte) && /Exclus/.test(r.texte));
  const mCons = r.texte.match(/<div class="nombre[^"]*"[^>]*>(\d+)<\/div>\s*<div class="etiquette">Consentis/);
  test('compte consentis = 1', mCons && mCons[1] === '1', mCons && mCons[1]);
  test('mention désinscription affichée', /Désinscription/.test(r.texte));
  test('exclu nommé', /Test Fact campB/.test(r.texte));

  r = await req(jar, 'GET', `/campagnes/${idCamp}/export`);
  test('export CSV → 200 + en-têtes', r.statut === 200 && r.texte.includes('raison_sociale'), r.statut);
  test('CSV contient le consenti, pas l’exclu', r.texte.includes('campA') && !r.texte.includes('campB'));

  r = await req(jar, 'GET', '/campagnes/' + idCamp);
  r = await req(jar, 'POST', `/campagnes/${idCamp}/prete`, { form: { _csrf: csrf(r.texte) } });
  test('campagne marquée prête', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/campagnes');
  test('liste campagnes → 200', r.statut === 200 && /Campagne Test Resto/.test(r.texte), r.statut);

  // Cloisonnement campagnes
  r = await req(jar2, 'GET', '/campagnes/' + idCamp);
  test('cabinet 2 : campagne cabinet 1 → 404', r.statut === 404, r.statut);

  // ---- 5. Réunions ---------------------------------------------------------------------------
  console.log('5. Réunions');
  r = await req(jar, 'GET', '/reunions/nouvelle');
  test('formulaire réunion → 200', r.statut === 200, r.statut);
  test('avertissement Teams non connecté', /Microsoft 365 n'est pas connecté/.test(r.texte));
  const demain = new Date(); demain.setDate(demain.getDate() + 1);
  const dh = `${fmt(demain)}T10:00`;
  r = await req(jar, 'POST', '/reunions', { form: {
    _csrf: csrf(r.texte), titre: 'Réunion test Teams', date_heure: dh,
    client_id: idEntA, lead_id: '', lien_teams: 'https://teams.microsoft.com/l/test123', notes: 'Test',
  }});
  test('création réunion → 302', r.statut === 302 && /\/reunions\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idReu = (r.location || '').match(/\/reunions\/(\d+)/)[1];
  r = await req(jar, 'GET', '/reunions/' + idReu);
  test('fiche réunion → 200 + lien', r.statut === 200 && /test123/.test(r.texte), r.statut);
  r = await req(jar, 'GET', '/echeances');
  test('réunion sur le dashboard', /Réunions à venir/.test(r.texte) && /Réunion test Teams/.test(r.texte));

  // Microsoft : page statut — mode dégradé (variables MS_* non définies en test)
  r = await req(jar, 'GET', '/admin/microsoft');
  test('page Microsoft → 200, non configuré', r.statut === 200 && /pas configuré/.test(r.texte), r.statut);
  test('marche à suivre Azure affichée', /portail Azure/.test(r.texte));

  // Cloisonnement réunions
  r = await req(jar2, 'GET', '/reunions/' + idReu);
  test('cabinet 2 : réunion cabinet 1 → 404', r.statut === 404, r.statut);

  // ---- 6. Principe « tout relié au client » ---------------------------------------------------
  console.log('6. Liens vers le client');
  r = await req(jar, 'GET', '/factures/' + idFac2);
  test('facture liée à une entreprise', /Test Fact fac inc/.test(r.texte));
  r = await req(jar, 'GET', '/reunions/' + idReu);
  test('réunion liée à une entreprise', /Test Fact campA inc/.test(r.texte));

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `❌ ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR FATALE :', e); process.exit(2); });
