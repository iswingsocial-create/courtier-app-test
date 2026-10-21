/**
 * scripts/test-relance-demande.js — Boucle courriel, étape 4/5 : suivi et
 * relance. Une relance = une NOUVELLE demande liée (parent_id), avec
 * seulement les questions restantes, gabarit de relance poli référençant la
 * demande initiale ; la demande parente n'est JAMAIS écrasée. Même circuit
 * de validation avant envoi. Historique visible sur la fiche soumission.
 * Prérequis : serveur sur PORT (3101), base FRAÎCHE, MÊME CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-relance.db PORT=3101 node scripts/test-relance-demande.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-relance.db';
const bd = require('../lib/bd');
const biens = require('../lib/biens');
const demandesInfos = require('../lib/demandes-infos');

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
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of sc) {
    const [paire] = c.split(';');
    const i = paire.indexOf('=');
    if (i > 0) jar[paire.slice(0, i).trim()] = paire.slice(i + 1).trim();
  }
}
async function req(jar, methode, chemin, { form = null } = {}) {
  const entetes = {};
  const paires = Object.entries(jar).map(([k, v]) => `${k}=${v}`);
  if (paires.length) entetes.Cookie = paires.join('; ');
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

(async () => {
  console.log('== Boucle courriel — étape 4 : suivi et relance ==');
  const cab = bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get();
  const cabId = cab.id;
  const admin = bd.prepare("SELECT * FROM users WHERE cabinet_id = ? AND role = 'admin' ORDER BY id LIMIT 1").get(cabId);
  const utilisateur = { id: admin.id, nom: admin.nom, cabinet_id: cabId, role: 'admin' };

  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  r = await req(jar, 'GET', '/mot-de-passe');
  await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });

  // Semis : soumission biens incomplète, demande envoyée (simulé).
  const clientId = bd.prepare(
    "INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel, responsable_id) VALUES (?, 'Garage Relance inc.', '', '', 'info@garagerelance.ca', ?)"
  ).run(cabId, admin.id).lastInsertRowid;
  const sId = biens.creerSoumission({ cabinetId: cabId, userId: admin.id, clientId });
  biens.ajouterBatiment(sId, cabId, admin.id, { adresse: '10 rue de la Relance', ville: 'Laval' });
  const demandeId = demandesInfos.creerDemande(cabId, utilisateur, { produit: 'biens', soumissionId: sId });
  await demandesInfos.envoyerDemande(demandeId, cabId, utilisateur);
  const parent = demandesInfos.obtenirDemande(demandeId, cabId);
  const nbQuestionsParent = parent.questions.length;
  test('demande initiale envoyée avec des questions', parent.statut === 'envoyee' && nbQuestionsParent > 3, `n=${nbQuestionsParent}`);

  // Relancer un brouillon est impossible : créer un brouillon séparé et tenter.
  const sBrouillon = biens.creerSoumission({ cabinetId: cabId, userId: admin.id, clientId });
  biens.ajouterBatiment(sBrouillon, cabId, admin.id, { adresse: '1 rue Brouillon', ville: 'Laval' });
  const brouillonId = demandesInfos.creerDemande(cabId, utilisateur, { produit: 'biens', soumissionId: sBrouillon });
  r = await req(jar, 'GET', `/demandes-infos/${brouillonId}`);
  r = await req(jar, 'POST', `/demandes-infos/${brouillonId}/relancer`, { form: { _csrf: csrf(r.texte) } });
  test('relancer un brouillon → 400', r.statut === 400, `statut=${r.statut}`);

  // 1. Relance depuis la fiche (POST) → nouveau brouillon lié.
  r = await req(jar, 'GET', `/demandes-infos/${demandeId}`);
  r = await req(jar, 'POST', `/demandes-infos/${demandeId}/relancer`, { form: { _csrf: csrf(r.texte) } });
  test('relance → 302 vers la nouvelle demande', r.statut === 302 && /^\/demandes-infos\/\d+$/.test(r.location || ''), `statut=${r.statut} loc=${r.location}`);
  const relanceId = Number((r.location || '').split('/').pop());
  test('relance = nouvelle ligne (id différent)', relanceId !== demandeId);
  const relance = demandesInfos.obtenirDemande(relanceId, cabId);
  test('relance : parent_id = demande initiale', relance.parent_id === demandeId);
  test('relance : statut brouillon (rien n\u2019est parti)', relance.statut === 'brouillon');
  test('relance : toutes les questions restantes reprises', relance.questions.length === nbQuestionsParent, `n=${relance.questions.length}`);
  test('relance : corps poli de relance + référence à la demande initiale',
    /Je me permets de revenir vers vous/.test(relance.corps) && /courriel du/.test(relance.corps));
  const parentApres = demandesInfos.obtenirDemande(demandeId, cabId);
  test('demande parente intacte (jamais écrasée)', parentApres.statut === 'envoyee' && parentApres.questions.length === nbQuestionsParent);

  // 2. Réponse partielle sur la demande initiale → relance = restantes seulement.
  const cleRepondue = parent.questions[0].cle;
  demandesInfos.marquerReponses(demandeId, cabId, admin.id, [cleRepondue], 'test relance');
  const parentPartiel = demandesInfos.obtenirDemande(demandeId, cabId);
  test('demande initiale → partiellement complétée', parentPartiel.statut === 'partiellement_completee', parentPartiel.statut);
  r = await req(jar, 'GET', `/demandes-infos/${demandeId}`);
  r = await req(jar, 'POST', `/demandes-infos/${demandeId}/relancer`, { form: { _csrf: csrf(r.texte) } });
  const relance2Id = Number((r.location || '').split('/').pop());
  const relance2 = demandesInfos.obtenirDemande(relance2Id, cabId);
  test('2e relance : seulement les questions restantes', relance2.questions.length === nbQuestionsParent - 1
    && !relance2.questions.some((q) => q.cle === cleRepondue), `n=${relance2.questions.length}`);

  // 3. Envoi de la relance par le circuit normal (validation humaine).
  r = await req(jar, 'GET', `/demandes-infos/${relance2Id}`);
  r = await req(jar, 'POST', `/demandes-infos/${relance2Id}/envoyer`, { form: { _csrf: csrf(r.texte) } });
  test('envoi de la relance → 302 mode=simule', r.statut === 302 && /mode=simule/.test(r.location || ''), `statut=${r.statut}`);
  const relance2Envoyee = demandesInfos.obtenirDemande(relance2Id, cabId);
  test('relance envoyée, lien parent conservé', relance2Envoyee.statut === 'envoyee' && relance2Envoyee.parent_id === demandeId);

  // 4. Demande complétée → relance refusée.
  demandesInfos.marquerReponses(demandeId, cabId, admin.id,
    parentPartiel.questions.filter((q) => q.statut !== 'repondue').map((q) => q.cle), 'test relance');
  const completee = demandesInfos.obtenirDemande(demandeId, cabId);
  test('demande initiale complétée après toutes réponses', completee.statut === 'completee', completee.statut);
  r = await req(jar, 'GET', `/demandes-infos/${demandeId}`);
  r = await req(jar, 'POST', `/demandes-infos/${demandeId}/relancer`, { form: { _csrf: csrf(r.texte) } });
  test('relancer une demande complétée → 400', r.statut === 400, `statut=${r.statut}`);

  // 5. Historique sur la fiche soumission.
  r = await req(jar, 'GET', `/biens/${sId}`);
  test('fiche : demande complétée affichée', /Demande complétée le/.test(r.texte));
  test('fiche : mention « relance de la demande # »', r.texte.includes(`relance de la demande #${demandeId}`));
  test('fiche : bouton Relancer offert sur une demande ouverte', r.texte.includes('🔁 Relancer'));

  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
