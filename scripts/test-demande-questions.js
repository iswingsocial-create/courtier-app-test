/**
 * scripts/test-demande-questions.js — Boucle courriel, étape 2/5 (+ section
 * fiche de l'étape 1) : depuis la fiche d'une soumission incomplète,
 * « ✉️ Demander au client » → brouillon généré par gabarit (destinataire
 * pré-rempli, questions numérotées), édition, envoi SIMULÉ journalisé
 * (aucun compte SMTP dans la base de test → aucun courriel réel), statuts,
 * affichage du suivi sur la fiche, cloisonnement inter-cabinets, courtier
 * hors portefeuille (403), CSRF.
 * Prérequis : serveur sur PORT (3101), base FRAÎCHE (seed), MÊME CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-demande.db PORT=3101 node scripts/test-demande-questions.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-demande.db';
const bcrypt = require('bcrypt');
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
async function loginComme(email, mdp, { changer = false } = {}) {
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  if (changer) {
    r = await req(jar, 'GET', '/mot-de-passe');
    r = await req(jar, 'POST', '/mot-de-passe', {
      form: { _csrf: csrf(r.texte), actuel: mdp, nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' },
    });
  }
  return jar;
}

(async () => {
  console.log('== Boucle courriel — étape 2 : courriel de questions ==');
  const cab = bd.prepare("SELECT id FROM cabinets WHERE nom LIKE 'Cabinet D%' LIMIT 1").get()
    || bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get();
  const cabId = cab.id;
  const admin = bd.prepare("SELECT id FROM users WHERE cabinet_id = ? AND role = 'admin' ORDER BY id LIMIT 1").get(cabId);

  // Semis : client + soumission biens incomplète (bâtiment adresse seulement)
  const clientId = bd.prepare(
    "INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel) VALUES (?, 'Garage Questions inc.', '', '', 'info@garagequestions.ca')"
  ).run(cabId).lastInsertRowid;
  const sId = biens.creerSoumission({ cabinetId: cabId, userId: admin.id, clientId, notes: 'Test demande' });
  biens.ajouterBatiment(sId, cabId, admin.id, { adresse: '1200 boul. Industriel', ville: 'Laval' });

  const jar = await loginComme('admin@demo.ca', 'ChangeMoi123!', { changer: true });

  // 1. Section manques sur la fiche
  let r = await req(jar, 'GET', `/biens/${sId}`);
  test('fiche : section « Informations manquantes » visible', r.statut === 200 && r.texte.includes('Informations manquantes'));
  test('fiche : bouton « Demander au client »', r.texte.includes('Demander au client') && r.texte.includes(`/demandes-infos/preparer/biens/${sId}`));
  test('fiche : question gicleurs listée', /gicleurs/i.test(r.texte));

  // 2. Préparer → redirection vers le brouillon créé
  r = await req(jar, 'GET', `/demandes-infos/preparer/biens/${sId}`);
  test('préparer → 302 vers la demande', r.statut === 302 && /^\/demandes-infos\/\d+$/.test(r.location || ''), `statut=${r.statut} loc=${r.location}`);
  const demandeId = Number((r.location || '').split('/').pop());

  // Relancer préparer → même brouillon (pas de doublon)
  r = await req(jar, 'GET', `/demandes-infos/preparer/biens/${sId}`);
  test('préparer à nouveau → même brouillon', r.statut === 302 && r.location === `/demandes-infos/${demandeId}`);

  const d = demandesInfos.obtenirDemande(demandeId, cabId);
  test('brouillon créé en base, statut brouillon', !!d && d.statut === 'brouillon');
  test('destinataire pré-rempli = courriel du client', d.destinataire === 'info@garagequestions.ca', d.destinataire);
  test('questions générées depuis les manques (> 5)', d.questions.length > 5, `n=${d.questions.length}`);
  test('chaque question a cle + statut en_attente', d.questions.every((q) => q.cle && q.statut === 'en_attente'));
  test('corps : questions numérotées présentes', /1\.\s/.test(d.corps) && d.corps.includes(d.questions[0].question.slice(0, 40)));
  test('corps : demande de répondre dans le même courriel', /répondre directement à ce courriel/.test(d.corps));
  test('sujet généré (produit + entreprise)', /soumission Biens/.test(d.sujet) && /Garage Questions/.test(d.sujet), d.sujet);
  const audit1 = bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE cabinet_id = ? AND action = 'demande_info_creee'").get(cabId);
  test('audit demande_info_creee', audit1.n >= 1);

  // 3. Page de préparation
  r = await req(jar, 'GET', `/demandes-infos/${demandeId}`);
  test('page préparation : 200', r.statut === 200);
  test('page : destinataire pré-rempli dans le champ', r.texte.includes('value="info@garagequestions.ca"'));
  test('page : mention du mode SIMULÉ (aucun compte configuré)', /SIMULÉ/.test(r.texte));
  test('page : bouton Envoyer présent', r.texte.includes('Envoyer au client'));
  const jeton = csrf(r.texte);
  test('page : jeton CSRF présent', !!jeton);

  // 4. CSRF : POST sans jeton → 403
  r = await req(jar, 'POST', `/demandes-infos/${demandeId}`, { form: { destinataire: 'x@y.ca', sujet: 'S', corps: 'C' } });
  test('POST sans CSRF → 403', r.statut === 403, `statut=${r.statut}`);

  // 5. Édition du brouillon
  r = await req(jar, 'POST', `/demandes-infos/${demandeId}`, {
    form: { _csrf: jeton, destinataire: 'info@garagequestions.ca', sujet: d.sujet, corps: d.corps + '\nP.-S. Merci de joindre vos photos du bâtiment.' },
  });
  test('édition brouillon → 302', r.statut === 302, `statut=${r.statut}`);
  const d2 = demandesInfos.obtenirDemande(demandeId, cabId);
  test('corps modifié conservé (P.-S.)', d2.corps.includes('P.-S. Merci de joindre'));

  // 6. Envoi simulé
  r = await req(jar, 'GET', `/demandes-infos/${demandeId}`);
  r = await req(jar, 'POST', `/demandes-infos/${demandeId}/envoyer`, { form: { _csrf: csrf(r.texte) } });
  test('envoi → 302 avec mode=simule', r.statut === 302 && /mode=simule/.test(r.location || ''), `statut=${r.statut} loc=${r.location}`);
  const d3 = demandesInfos.obtenirDemande(demandeId, cabId);
  test('statut → envoyee', d3.statut === 'envoyee');
  test('mode_envoi = simule, message_id simulé', d3.mode_envoi === 'simule' && /^simule-/.test(d3.message_id || ''), d3.message_id);
  test('envoyee_le renseignée, questions toujours en_attente', !!d3.envoyee_le && d3.questions.every((q) => q.statut === 'en_attente'));
  const audit2 = bd.prepare("SELECT details FROM journal_audit WHERE cabinet_id = ? AND action = 'demande_info_envoyee' ORDER BY id DESC LIMIT 1").get(cabId);
  test('audit demande_info_envoyee mentionne le mode SIMULÉ', !!audit2 && /SIMULÉ/.test(audit2.details), audit2 && audit2.details);

  // 7. Suivi sur la fiche
  r = await req(jar, 'GET', `/biens/${sId}`);
  test('fiche : « Questions envoyées le » + destinataire', /Questions envoyées le/.test(r.texte) && r.texte.includes('info@garagequestions.ca'));
  test('fiche : mention envoi simulé', /envoi simulé/.test(r.texte));

  // 8. Double envoi refusé
  r = await req(jar, 'GET', `/demandes-infos/${demandeId}`);
  r = await req(jar, 'POST', `/demandes-infos/${demandeId}/envoyer`, { form: { _csrf: csrf(r.texte) } });
  test('second envoi → 400 (déjà envoyée)', r.statut === 400, `statut=${r.statut}`);

  // 9. Cloisonnement inter-cabinets
  const cab2 = bd.prepare("INSERT INTO cabinets (nom) VALUES ('Cabinet Étranger')").run().lastInsertRowid;
  const hash = bcrypt.hashSync('Test1234!', 4);
  bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe) VALUES (?, 'admin2@etranger.ca', ?, 'admin', 'Admin Étranger', 0)").run(cab2, hash);
  const jar2 = await loginComme('admin2@etranger.ca', 'Test1234!');
  r = await req(jar2, 'GET', `/demandes-infos/${demandeId}`);
  test('autre cabinet : demande → 404', r.statut === 404, `statut=${r.statut}`);
  r = await req(jar2, 'GET', `/demandes-infos/preparer/biens/${sId}`);
  test('autre cabinet : préparer → 404', r.statut === 404, `statut=${r.statut}`);

  // 10. Courtier hors portefeuille → 403
  bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe) VALUES (?, 'courtier@demo.ca', ?, 'courtier', 'Courtier Sans Portefeuille', 0)").run(cabId, hash);
  const jar3 = await loginComme('courtier@demo.ca', 'Test1234!');
  r = await req(jar3, 'GET', `/demandes-infos/${demandeId}`);
  test('courtier hors portefeuille : demande → 403', r.statut === 403, `statut=${r.statut}`);

  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
