/**
 * scripts/test-marche-http.js — Mise en marché (F15), phase 1 : parcours
 * HTTP complet — registre et filtres, création depuis une fiche produit
 * et depuis un dossier combiné, brouillon courriel et envoi SIMULÉ au
 * clic, transitions guidées depuis la fiche envoi, relance due aux
 * Échéances, liaison manuelle d'un courriel à un envoi, cloisonnement
 * (autre cabinet, courtier hors portefeuille).
 * Prérequis : serveur sur PORT (3101), base FRAÎCHE, MÊME CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-marche-http.db PORT=3101 node scripts/test-marche-http.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-marche-http.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const biens = require('../lib/biens');
const combine = require('../lib/combine');
const marche = require('../lib/marche');

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
async function connecter(jar, email, motDePasse) {
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: motDePasse } });
  return r;
}

(async () => {
  console.log('== Mise en marché (F15) — HTTP ==');
  const cab = bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get();
  const cabId = cab.id;
  const admin = bd.prepare("SELECT * FROM users WHERE cabinet_id = ? AND role = 'admin' ORDER BY id LIMIT 1").get(cabId);

  const jar = nouveauJar();
  let r = await connecter(jar, 'admin@demo.ca', 'ChangeMoi123!');
  r = await req(jar, 'GET', '/mot-de-passe');
  await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });

  // --- Semis ------------------------------------------------------------------
  const clientId = bd.prepare(
    "INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel, responsable_id) VALUES (?, 'Fonderie HTTP inc.', '', '', 'info@fonderie.example', ?)"
  ).run(cabId, admin.id).lastInsertRowid;
  const assureurId = bd.prepare(
    `INSERT INTO assureurs (cabinet_id, nom, na_nom, na_courriel) VALUES (?, 'Assureur Bêta', 'Nadia Nouvelles Affaires', 'nadia@beta.example')`
  ).run(cabId).lastInsertRowid;
  const sBiens = biens.creerSoumission({ cabinetId: cabId, userId: admin.id, clientId });
  biens.ajouterBatiment(sBiens, cabId, admin.id, { adresse: '200 rue HTTP', ville: 'Laval' });
  const dossierId = combine.creerDossier({ cabinetId: cabId, userId: admin.id, clientId });

  // --- 1. Menu et registre -------------------------------------------------------
  console.log('1. Registre');
  r = await req(jar, 'GET', '/echeances');
  test('menu : lien « 🎯 Mise en marché » présent', /href="\/mise-en-marche"/.test(r.texte));
  r = await req(jar, 'GET', '/mise-en-marche');
  test('registre accessible (200)', r.statut === 200);
  test('registre : titre et indicateurs', /Mise en marché/.test(r.texte) && /Envois en cours/.test(r.texte));

  // --- 2. Fiche produit : signal « aucun envoi » puis création ---------------------
  console.log('2. Création depuis une fiche produit');
  r = await req(jar, 'GET', `/biens/${sBiens}`);
  test('fiche biens : section mise en marché présente', /id="mise-en-marche"/.test(r.texte));
  test('fiche biens : « Aucun envoi au marché » signalé', /Aucun envoi au marché/.test(r.texte));
  r = await req(jar, 'GET', `/mise-en-marche/nouveau?produit=biens&soumission_id=${sBiens}&assureur_id=${assureurId}`);
  test('formulaire de création pré-rempli (assureur choisi)', r.statut === 200 && /Assureur Bêta/.test(r.texte) && /nadia@beta\.example/.test(r.texte));
  const csrfNouveau = csrf(r.texte);
  r = await req(jar, 'POST', '/mise-en-marche/nouveau', { form: {
    _csrf: csrfNouveau, produit: 'biens', soumission_id: String(sBiens), combine_dossier_id: '',
    assureur_id: String(assureurId), marche_nom: '', souscripteur_nom: '', souscripteur_courriel: '',
    version_proposition: '', documents: 'Proposition Biens générée par l\u2019application', autorite_intermediaire: '',
    date_relance: '', prochaine_action: '', prochaine_action_echeance: '',
  } });
  test('création : redirection vers la fiche envoi', r.statut === 302 && /^\/mise-en-marche\/\d+\?cree=1$/.test(r.location || ''), r.location);
  const envoiId = Number((r.location || '').match(/\/mise-en-marche\/(\d+)/)[1]);
  const envoiCree = marche.obtenirEnvoi(envoiId, cabId);
  test('envoi créé en brouillon, souscripteur pré-rempli de l\u2019annuaire',
    envoiCree.statut === 'brouillon' && envoiCree.souscripteur_courriel === 'nadia@beta.example');
  r = await req(jar, 'GET', `/biens/${sBiens}`);
  test('fiche biens : l\u2019envoi apparaît, le signal a disparu',
    /Assureur Bêta/.test(r.texte) && !/Aucun envoi au marché/.test(r.texte));

  // --- 3. Fiche envoi : brouillon courriel et envoi simulé -----------------------------
  console.log('3. Brouillon courriel et envoi au clic');
  r = await req(jar, 'GET', `/mise-en-marche/${envoiId}`);
  test('fiche envoi : brouillon « demande de prix » visible', /Demande de prix/.test(r.texte) && /Brouillon — rien n'est parti/.test(r.texte));
  const brouillon = envoiCree.brouillons[0];
  test('un seul brouillon demande de prix', envoiCree.brouillons.length === 1 && brouillon.type === 'demande_prix');
  r = await req(jar, 'POST', `/mise-en-marche/courriels/${brouillon.id}/modifier`, { form: {
    _csrf: csrf(r.texte), destinataire: 'nadia@beta.example', sujet: brouillon.sujet, corps: brouillon.corps + '\nMerci de confirmer la réception.',
  } });
  test('modification du brouillon : redirection fiche', r.statut === 302);
  r = await req(jar, 'GET', `/mise-en-marche/${envoiId}`);
  r = await req(jar, 'POST', `/mise-en-marche/courriels/${brouillon.id}/envoyer`, { form: { _csrf: csrf(r.texte) } });
  test('envoi au clic : redirection avec mode simulé', r.statut === 302 && /envoye=1&mode=simule/.test(r.location || ''), r.location);
  const envoiEnvoye = marche.obtenirEnvoi(envoiId, cabId);
  test('envoi passé à « envoyé » (transmis, mode courriel)',
    envoiEnvoye.statut === 'envoye' && !!envoiEnvoye.transmis_le && envoiEnvoye.mode_transmission === 'courriel');

  // --- 4. Transitions depuis la fiche -----------------------------------------------------
  console.log('4. Transitions guidées');
  r = await req(jar, 'GET', `/mise-en-marche/${envoiId}`);
  r = await req(jar, 'POST', `/mise-en-marche/${envoiId}/en-analyse`, { form: { _csrf: csrf(r.texte) } });
  test('passer en analyse (302)', r.statut === 302 && marche.obtenirEnvoi(envoiId, cabId).statut === 'en_analyse');
  r = await req(jar, 'GET', `/mise-en-marche/${envoiId}`);
  r = await req(jar, 'POST', `/mise-en-marche/${envoiId}/questions`, { form: {
    _csrf: csrf(r.texte), questions_en_attente: 'Confirmer la superficie exacte du bâtiment.', questions_responsable: 'client',
  } });
  test('questions enregistrées via la fiche', marche.obtenirEnvoi(envoiId, cabId).statut === 'questions');
  r = await req(jar, 'GET', `/mise-en-marche/${envoiId}`);
  test('fiche : bloc questions visible avec le responsable', /Questions du marché en attente/.test(r.texte) && /Le client/.test(r.texte));
  r = await req(jar, 'POST', `/mise-en-marche/${envoiId}/questions-resolues`, { form: { _csrf: csrf(r.texte) } });
  test('questions résolues : retour en analyse', marche.obtenirEnvoi(envoiId, cabId).statut === 'en_analyse');
  r = await req(jar, 'GET', `/mise-en-marche/${envoiId}`);
  r = await req(jar, 'POST', `/mise-en-marche/${envoiId}/offre`, { form: {
    _csrf: csrf(r.texte), offre_prime: '15750', offre_limites: 'Bâtiment 2 000 000 $, franchise 2 500 $',
    offre_conditions: 'Inspection dans les 30 jours', offre_validite: '2026-12-15',
  } });
  const envoiOffre = marche.obtenirEnvoi(envoiId, cabId);
  test('offre saisie via la fiche : statut + prime', envoiOffre.statut === 'offre_recue' && Number(envoiOffre.offre_prime) === 15750);
  r = await req(jar, 'GET', `/mise-en-marche/${envoiId}`);
  test('fiche : bloc offre reçue affiché (prime formatée)', /Offre reçue/.test(r.texte) && /15[\s\u202f ]?750/.test(r.texte));
  test('fiche : fil d\u2019événements complet', /Historique de l'envoi/.test(r.texte) && /Offre reçue de Assureur Bêta/.test(r.texte));
  r = await req(jar, 'POST', `/mise-en-marche/${envoiId}/accepter`, { form: { _csrf: csrf(r.texte) } });
  test('offre acceptée via la fiche', marche.obtenirEnvoi(envoiId, cabId).statut === 'accepte');

  // --- 5. Création depuis un dossier combiné --------------------------------------------------
  console.log('5. Création depuis une combinée');
  r = await req(jar, 'GET', `/combinees/${dossierId}`);
  test('fiche combinée : section mise en marché + signal aucun envoi',
    /id="mise-en-marche"/.test(r.texte) && /Aucun envoi au marché/.test(r.texte));
  r = await req(jar, 'GET', `/mise-en-marche/nouveau?combine_id=${dossierId}`);
  const csrfComb = csrf(r.texte);
  r = await req(jar, 'POST', '/mise-en-marche/nouveau', { form: {
    _csrf: csrfComb, produit: 'combinee', soumission_id: '', combine_dossier_id: String(dossierId),
    assureur_id: '', marche_nom: 'Grossiste HTTP', souscripteur_nom: 'Sam Grossiste', souscripteur_courriel: 'sam@grossiste.example',
    version_proposition: '', documents: '', autorite_intermediaire: 'Autorité vérifiée (permis AMF)', date_relance: '',
    prochaine_action: '', prochaine_action_echeance: '',
  } });
  test('création combinée : redirection fiche', r.statut === 302 && /^\/mise-en-marche\/\d+/.test(r.location || ''), r.location);
  const envoiCombId = Number((r.location || '').match(/\/mise-en-marche\/(\d+)/)[1]);
  const envoiComb = marche.obtenirEnvoi(envoiCombId, cabId);
  test('envoi combiné : cible + client + autorité intermédiaire',
    envoiComb.produit === 'combinee' && envoiComb.combine_dossier_id === dossierId
    && envoiComb.client_id === clientId && /permis AMF/.test(envoiComb.autorite_intermediaire || ''));
  r = await req(jar, 'GET', `/combinees/${dossierId}`);
  test('fiche combinée : l\u2019envoi apparaît', /Grossiste HTTP/.test(r.texte) && !/Aucun envoi au marché/.test(r.texte));
  r = await req(jar, 'GET', `/mise-en-marche/${envoiCombId}`);
  r = await req(jar, 'POST', `/mise-en-marche/${envoiCombId}/transmettre`, { form: { _csrf: csrf(r.texte), date_relance: '' } });
  test('transmission manuelle via la fiche', marche.obtenirEnvoi(envoiCombId, cabId).statut === 'envoye');

  // --- 6. Registre : filtres et relance due -------------------------------------------------------
  console.log('6. Filtres + relance due');
  r = await req(jar, 'GET', '/mise-en-marche?statut=accepte');
  test('filtre statut=accepte : seul l\u2019envoi accepté',
    r.texte.includes(`href="/mise-en-marche/${envoiId}"`) && !r.texte.includes(`href="/mise-en-marche/${envoiCombId}"`));
  r = await req(jar, 'GET', `/mise-en-marche?client_id=${clientId}`);
  test('filtre client : les deux envois', /Assureur Bêta/.test(r.texte) && /Grossiste HTTP/.test(r.texte));
  const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  bd.prepare('UPDATE marche_envois SET date_relance = ? WHERE id = ?').run(hier, envoiCombId);
  r = await req(jar, 'GET', '/mise-en-marche?relances=1');
  test('filtre relances dues : l\u2019envoi échu seulement',
    r.texte.includes(`href="/mise-en-marche/${envoiCombId}"`) && !r.texte.includes(`href="/mise-en-marche/${envoiId}"`));
  test('registre : badge « Relance due »', /Relance due/.test(r.texte));
  r = await req(jar, 'GET', '/echeances');
  test('échéances : section « Relances de mise en marché dues »', /Relances de mise en marché dues/.test(r.texte) && /Grossiste HTTP/.test(r.texte));

  // --- 7. Relance depuis la fiche ---------------------------------------------------------------------
  console.log('7. Relance');
  r = await req(jar, 'GET', `/mise-en-marche/${envoiCombId}`);
  r = await req(jar, 'POST', `/mise-en-marche/${envoiCombId}/relancer`, { form: { _csrf: csrf(r.texte) } });
  test('relancer : brouillon de relance préparé (redirection)', r.statut === 302 && /relance=\d+/.test(r.location || ''), r.location);
  const brouillonRelance = marche.obtenirEnvoi(envoiCombId, cabId).brouillons.find((b) => b.type === 'relance');
  test('brouillon de relance en statut brouillon', !!brouillonRelance && brouillonRelance.statut === 'brouillon');
  r = await req(jar, 'GET', `/mise-en-marche/${envoiCombId}`);
  r = await req(jar, 'POST', `/mise-en-marche/courriels/${brouillonRelance.id}/envoyer`, { form: { _csrf: csrf(r.texte) } });
  const apresRelance = marche.obtenirEnvoi(envoiCombId, cabId);
  test('relance envoyée (simulé) : compteur + date repoussée',
    apresRelance.nb_relances === 1 && apresRelance.date_relance > hier);

  // --- 8. Liaison manuelle d\u2019un courriel à un envoi --------------------------------------------------------
  console.log('8. Courriel lié à un envoi');
  const courrielId = bd.prepare(`
    INSERT INTO courriels (cabinet_id, dossier, expediteur, destinataires, sujet, corps_texte, date_courriel)
    VALUES (?, 'reception', 'nadia@beta.example', 'cabinet@demo.ca', 'Re: Demande de soumission', 'Voici notre offre.', '2026-10-21')
  `).run(cabId).lastInsertRowid;
  // Lier le client d\u2019abord (la page propose les envois du client lié).
  bd.prepare('UPDATE courriels SET client_id = ? WHERE id = ?').run(clientId, courrielId);
  r = await req(jar, 'GET', `/courriels/${courrielId}`);
  test('page courriel : sélecteur d\u2019envois du client proposé', /Envoi de mise en marché/.test(r.texte) && new RegExp(`Envoi #${envoiId}`).test(r.texte));
  r = await req(jar, 'POST', `/courriels/${courrielId}/lier`, { form: {
    _csrf: csrf(r.texte), client_id: String(clientId), police_id: '', envoi_id: String(envoiId),
  } });
  const courrielLie = bd.prepare('SELECT * FROM courriels WHERE id = ?').get(courrielId);
  test('lien manuel : envoi_id posé, méthode manuel', courrielLie.envoi_id === envoiId && courrielLie.classement_methode === 'manuel');
  r = await req(jar, 'GET', `/mise-en-marche/${envoiId}`);
  test('fiche envoi : le courriel lié est listé', /Courriels rattachés/.test(r.texte) && /Re: Demande de soumission/.test(r.texte));

  // --- 9. Cloisonnement -------------------------------------------------------------------------------------------
  console.log('9. Cloisonnement');
  const hash = bcrypt.hashSync('Voisin123!', 4);
  const cab2 = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet HTTP Voisin').lastInsertRowid;
  bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe) VALUES (?, 'voisin@http.ca', ?, 'admin', 'Voisin HTTP', 0)").run(cab2, hash);
  const jar2 = nouveauJar();
  await connecter(jar2, 'voisin@http.ca', 'Voisin123!');
  r = await req(jar2, 'GET', `/mise-en-marche/${envoiId}`);
  test('autre cabinet : fiche envoi 404', r.statut === 404);
  r = await req(jar2, 'GET', '/mise-en-marche');
  test('autre cabinet : registre vide', r.statut === 200 && !/Assureur Bêta/.test(r.texte));
  r = await req(jar2, 'GET', `/mise-en-marche/nouveau?produit=biens&soumission_id=${sBiens}`);
  test('autre cabinet : création sur soumission étrangère refusée (400)', r.statut === 400);
  // Courtier du même cabinet, portefeuille vide.
  bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe) VALUES (?, 'courtier@http.ca', ?, 'courtier', 'Courtier HTTP', 0)").run(cabId, hash);
  const jar3 = nouveauJar();
  await connecter(jar3, 'courtier@http.ca', 'Voisin123!');
  r = await req(jar3, 'GET', `/mise-en-marche/${envoiId}`);
  test('courtier hors portefeuille : fiche envoi 403', r.statut === 403);
  r = await req(jar3, 'GET', '/mise-en-marche');
  test('courtier hors portefeuille : registre sans cet envoi',
    r.statut === 200 && !r.texte.includes(`href="/mise-en-marche/${envoiId}"`));

  console.log(`\n${total - echecs}/${total} tests réussis`);
  if (echecs) { console.log(`❌ ${echecs} échec(s)`); process.exit(1); }
  console.log('TOUS LES TESTS PASSENT');
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
