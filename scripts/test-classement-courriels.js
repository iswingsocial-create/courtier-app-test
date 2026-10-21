/**
 * scripts/test-classement-courriels.js — Tests du classement intelligent
 * des courriels (numéro de police, fil, adresse, nom d'entreprise) :
 * moteur pur, branchement HTTP (liste + badges, filtre « À classer »,
 * reclassement en lot, liaison manuelle client + police), fiche police.
 * Aucun courriel réel : les messages sont insérés directement en base
 * (simulation de la réception), exactement comme la synchro les écrirait.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : CHEMIN_BD=/tmp/test-classement.db PORT=3101 node scripts/test-classement-courriels.js
 */
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
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

async function loginAdmin() {
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  return jar;
}

// --- Données de test semées directement en base --------------------------------
function semerDonnees(bd) {
  const cab = bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get().id;
  const insClient = bd.prepare(`INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel)
    VALUES (?, ?, 'Contact', 'Test', ?)`);
  const clientA = insClient.run(cab, 'Classement Alpha inc.', 'contact@alpha-cls.ca').lastInsertRowid;
  const clientB = insClient.run(cab, 'Classement Beta inc.', 'info@beta-cls.ca').lastInsertRowid;
  const insPolice = bd.prepare(`INSERT INTO polices (cabinet_id, client_id, ligne, assureur, numero_police, date_effet, date_echeance)
    VALUES (?, ?, ?, 'Assureur Test', ?, '2026-01-01', '2027-01-01')`);
  const policeA = insPolice.run(cab, clientA, 'flotte', 'CLS-2026-10001').lastInsertRowid;
  const policeB = insPolice.run(cab, clientB, 'biens', 'CLS-2026-20002').lastInsertRowid;
  const policeAmbigue = insPolice.run(cab, clientB, 'cgl', 'CLS-AMB-50005').lastInsertRowid;
  const policeCourte = insPolice.run(cab, clientA, 'autre', 'AB12').lastInsertRowid;
  // Soumission flotte de B portant le même numéro que la police ambiguë de B ?
  // Non : le même numéro que la police de B, mais porté par une soumission de A
  // → le numéro désigne deux clients → ambigu.
  const souFlotteA = bd.prepare(`INSERT INTO flotte_soumissions (cabinet_id, client_id, numero_police)
    VALUES (?, ?, 'CLS-AMB-50005')`).run(cab, clientA).lastInsertRowid;
  // Soumission flotte de B avec son propre numéro (client seulement).
  bd.prepare(`INSERT INTO flotte_soumissions (cabinet_id, client_id, numero_police)
    VALUES (?, ?, 'CLS-SOU-30003')`).run(cab, clientB);
  // Antécédent biens de A avec numéro de police actuelle (client seulement).
  const souBiensA = bd.prepare(`INSERT INTO biens_soumissions (cabinet_id, client_id) VALUES (?, ?)`).run(cab, clientA).lastInsertRowid;
  bd.prepare(`INSERT INTO biens_antecedents (cabinet_id, soumission_id, assureur_actuel, numero_police_actuelle)
    VALUES (?, ?, 'Ancien Assureur', 'CLS-ANT-40004')`).run(cab, souBiensA);
  // Demande d'informations envoyée à A (pour le classement par le fil).
  const demande = bd.prepare(`INSERT INTO demandes_infos (cabinet_id, produit, soumission_id, client_id,
      destinataire, sujet, corps, statut, message_id)
    VALUES (?, 'biens', ?, ?, 'contact@alpha-cls.ca', 'Informations manquantes — Classement Alpha inc.',
      'Bonjour, questions…', 'envoyee', '<demande-cls-1@cabinet.ca>')`).run(cab, souBiensA, clientA).lastInsertRowid;
  // Second cabinet (cloisonnement) : même numéro de police que policeA.
  const cab2 = bd.prepare(`INSERT INTO cabinets (nom, token_capture) VALUES ('Cabinet CLS 2', 'jeton-cls-2')`).run().lastInsertRowid;
  const clientC = insClient.run(cab2, 'Classement Gamma inc.', 'g@gamma-cls.ca').lastInsertRowid;
  const policeC = insPolice.run(cab2, clientC, 'flotte', 'CLS-2026-10001').lastInsertRowid;
  return { cab, cab2, clientA, clientB, clientC, policeA, policeB, policeAmbigue, policeCourte, policeC, demande, souFlotteA };
}

function moteurTests(bd, D) {
  console.log('— Moteur de classement (unitaire) —');
  const { classerCourriel } = require('../lib/classement-courriels');
  const C = (entree) => classerCourriel(bd, D.cab, entree);

  let r = C({ sujet: 'Avis de renouvellement — police CLS-2026-10001', corpsTexte: 'Bonjour…', adressesExpediteur: ['avis@assureur-inconnu.ca'] });
  test('N° de police dans le sujet → client + police', r.clientId === D.clientA && r.policeId === D.policeA && r.methode === 'numero_police', JSON.stringify(r));
  test('Détail = le numéro repéré', r.detail === 'CLS-2026-10001', r.detail);

  r = C({ sujet: 'TR: certificat', corpsTexte: 'Ci-joint la note de couverture de la police numéro CLS-2026-20002, merci.', adressesExpediteur: ['collegue@cabinet.ca'] });
  test('N° dans le corps (courriel transféré/interne) → client + police', r.clientId === D.clientB && r.policeId === D.policeB && r.methode === 'numero_police', JSON.stringify(r));

  r = C({ sujet: 'Renouvellement', corpsTexte: 'Votre police CLS 2026 10001 arrive à échéance.', adressesExpediteur: ['avis@assureur-inconnu.ca'] });
  test('N° écrit avec des espaces → reconnu', r.clientId === D.clientA && r.policeId === D.policeA, JSON.stringify(r));

  r = C({ sujet: 'Renouvellement flotte', corpsTexte: 'Référence : CLS-SOU-30003', adressesExpediteur: ['avis@assureur-inconnu.ca'] });
  test('N° d\u2019une soumission → client seulement (pas de police)', r.clientId === D.clientB && r.policeId === null && r.methode === 'numero_police', JSON.stringify(r));

  r = C({ sujet: 'Ancienne police', corpsTexte: 'Ancien numéro CLS-ANT-40004 à titre de référence.', adressesExpediteur: ['avis@assureur-inconnu.ca'] });
  test('N° d\u2019un antécédent → client seulement', r.clientId === D.clientA && r.policeId === null && r.methode === 'numero_police', JSON.stringify(r));

  r = C({ sujet: 'Question générale', corpsTexte: 'Bonjour, une question sur notre dossier.', adressesExpediteur: ['contact@alpha-cls.ca'] });
  test('Adresse connue seule → client par adresse', r.clientId === D.clientA && r.policeId === null && r.methode === 'adresse', JSON.stringify(r));

  r = C({ sujet: 'Certificat joint', corpsTexte: 'Veuillez trouver le certificat demandé pour Classement Beta inc. Merci.', adressesExpediteur: ['certificats@assureur-inconnu.ca'] });
  test('Nom d\u2019entreprise unique dans le texte → client par nom', r.clientId === D.clientB && r.methode === 'nom_entreprise', JSON.stringify(r));

  r = C({ sujet: 'Réponse', corpsTexte: 'Voici les réponses demandées.', adressesExpediteur: ['quelquun@inconnu.ca'], enReponseA: '<demande-cls-1@cabinet.ca>' });
  test('Fil d\u2019une demande → client de la demande', r.clientId === D.clientA && r.methode === 'fil', JSON.stringify(r));

  r = C({ sujet: 'Police CLS-2026-20002', corpsTexte: 'Bonjour.', adressesExpediteur: ['contact@alpha-cls.ca'] });
  test('Conflit adresse (A) vs n° de police (B) → non classé + suggestion = n° de police', r.clientId === null && r.methode === 'aucun' && r.suggestion && r.suggestion.clientId === D.clientB && r.suggestion.policeId === D.policeB && r.suggestion.methode === 'numero_police', JSON.stringify(r));

  r = C({ sujet: 'Police CLS-AMB-50005', corpsTexte: 'Bonjour.', adressesExpediteur: ['avis@assureur-inconnu.ca'] });
  test('N° ambigu (police de B + soumission de A) → non classé, pas de suggestion', r.clientId === null && r.suggestion === null, JSON.stringify(r));

  r = C({ sujet: 'Police AB12', corpsTexte: 'Référence AB12.', adressesExpediteur: ['avis@assureur-inconnu.ca'] });
  test('Fragment trop court (< 5) ignoré → non classé', r.clientId === null, JSON.stringify(r));

  r = C({ sujet: 'Police CLS-2026-10002', corpsTexte: 'Bonjour.', adressesExpediteur: ['avis@assureur-inconnu.ca'] });
  test('Numéro proche mais différent → aucune confusion', r.clientId === null, JSON.stringify(r));

  r = classerCourriel(bd, D.cab2, { sujet: 'Police CLS-2026-10001', corpsTexte: '', adressesExpediteur: ['x@inconnu.ca'] });
  test('Même n° dans un autre cabinet → classé dans SON cabinet seulement', r.clientId === D.clientC && r.policeId === D.policeC, JSON.stringify(r));
  r = classerCourriel(bd, D.cab2, { sujet: 'Police CLS-2026-20002', corpsTexte: '', adressesExpediteur: ['x@inconnu.ca'] });
  test('N° d\u2019un autre cabinet ignoré (cloisonnement)', r.clientId === null, JSON.stringify(r));
}

async function httpTests(bd, D) {
  console.log('— Branchement HTTP (liste, badges, reclassement, liaison, fiche police) —');
  const jar = await loginAdmin();
  const insCourriel = bd.prepare(`INSERT INTO courriels (cabinet_id, dossier, expediteur, destinataires,
      sujet, corps_texte, date_courriel, lu, message_id)
    VALUES (?, 'reception', ?, '', ?, ?, '2026-10-20', 0, ?)`);
  // 1) Classable par numéro de police (assureur inconnu)
  const c1 = insCourriel.run(D.cab, 'avis@assureur-inconnu.ca', 'Avis — police CLS-2026-10001', 'Votre avis de renouvellement est joint.', '<cls-1@test>').lastInsertRowid;
  // 2) Inconnu total
  const c2 = insCourriel.run(D.cab, 'personne@totalement-inconnu.ca', 'Bonjour sans référence', 'Rien à signaler.', '<cls-2@test>').lastInsertRowid;
  // 3) Conflit adresse A / numéro B → suggestion seulement
  const c3 = insCourriel.run(D.cab, 'contact@alpha-cls.ca', 'Certificat police CLS-2026-20002', 'Voici le certificat.', '<cls-3@test>').lastInsertRowid;
  // 4) Courriel d'un autre cabinet (cloisonnement HTTP)
  const cAutre = insCourriel.run(D.cab2, 'avis@assureur-inconnu.ca', 'Avis — police CLS-2026-10001', 'Autre cabinet.', '<cls-4@test>').lastInsertRowid;

  let r = await req(jar, 'GET', '/courriels?aclasser=1');
  test('Filtre « À classer » accessible', r.statut === 200 && r.texte.includes('À classer'), r.statut);
  test('Suggestion affichée pour le courriel en conflit (entreprise B)', r.texte.includes('Classement Beta inc.'), 'suggestion absente');
  test('Bouton de reclassement présent', r.texte.includes('/courriels/reclasser'), 'bouton absent');

  // CSRF : POST sans jeton → 403
  r = await req(jar, 'POST', '/courriels/reclasser', { form: {} });
  test('Reclassement sans CSRF → 403', r.statut === 403, r.statut);

  // Reclassement en lot
  const pageListe = await req(jar, 'GET', '/courriels');
  r = await req(jar, 'POST', '/courriels/reclasser', { form: { _csrf: csrf(pageListe.texte) } });
  test('Reclassement en lot → redirection avec compteurs', r.statut === 302 && /reclassement=1-1-1/.test(r.location || ''), `${r.statut} ${r.location}`);
  const ligne1 = bd.prepare('SELECT * FROM courriels WHERE id = ?').get(c1);
  test('Lot : courriel n° de police classé (client + police + méthode)', ligne1.client_id === D.clientA && ligne1.police_id === D.policeA && ligne1.classement_methode === 'numero_police' && ligne1.classement_detail === 'CLS-2026-10001', JSON.stringify(ligne1));
  const ligne3 = bd.prepare('SELECT * FROM courriels WHERE id = ?').get(c3);
  test('Lot : courriel en conflit toujours non classé', ligne3.client_id === null, JSON.stringify(ligne3.classement_methode));
  const audit = bd.prepare("SELECT * FROM journal_audit WHERE action = 'courriels_reclasses' ORDER BY id DESC LIMIT 1").get();
  test('Lot journalisé dans l\u2019audit (courriels_reclasses)', !!audit && /1 classé/.test(audit.details || ''), audit && audit.details);

  // Badge dans la liste complète
  r = await req(jar, 'GET', '/courriels');
  test('Badge « 🔗 N° de police CLS-2026-10001 » dans la liste', r.texte.includes('🔗 N° de police CLS-2026-10001'), 'badge absent');

  // Vue du message : classement + sélecteur de polices
  r = await req(jar, 'GET', '/courriels/' + c1);
  test('Vue message : badge et méthode affichés', r.statut === 200 && r.texte.includes('Numéro de police repéré') && r.texte.includes('Police liée'), r.statut);
  test('Vue message : sélecteur des polices du client', r.texte.includes('name="police_id"') && r.texte.includes('CLS-2026-10001'), 'sélecteur absent');

  // Liaison manuelle avec police (sur le courriel inconnu c2)
  r = await req(jar, 'GET', '/courriels/' + c2);
  r = await req(jar, 'POST', `/courriels/${c2}/lier`, { form: { _csrf: csrf(r.texte), client_id: String(D.clientB), police_id: String(D.policeB) } });
  test('Liaison manuelle client + police → redirection', r.statut === 302, r.statut);
  const ligne2 = bd.prepare('SELECT * FROM courriels WHERE id = ?').get(c2);
  test('Liaison manuelle enregistrée (méthode manuel)', ligne2.client_id === D.clientB && ligne2.police_id === D.policeB && ligne2.classement_methode === 'manuel', JSON.stringify(ligne2));

  // Police d'un AUTRE client refusée à la liaison
  const c5 = insCourriel.run(D.cab, 'x@inconnu.ca', 'Test police étrangère', 'Corps.', '<cls-5@test>').lastInsertRowid;
  r = await req(jar, 'GET', '/courriels/' + c5);
  r = await req(jar, 'POST', `/courriels/${c5}/lier`, { form: { _csrf: csrf(r.texte), client_id: String(D.clientA), police_id: String(D.policeB) } });
  const ligne5 = bd.prepare('SELECT * FROM courriels WHERE id = ?').get(c5);
  test('Police d\u2019un autre client ignorée à la liaison', ligne5.client_id === D.clientA && ligne5.police_id === null, JSON.stringify(ligne5));

  // Déliage manuel : le reclassement en lot ne doit JAMAIS le réécrire,
  // même si le contenu deviendrait classable.
  bd.prepare("UPDATE courriels SET sujet = 'Police CLS-2026-10001', corps_texte = 'Police CLS-2026-10001' WHERE id = ?").run(c2);
  r = await req(jar, 'GET', '/courriels/' + c2);
  r = await req(jar, 'POST', `/courriels/${c2}/lier`, { form: { _csrf: csrf(r.texte), client_id: '' } });
  let ligne2b = bd.prepare('SELECT * FROM courriels WHERE id = ?').get(c2);
  test('Déliage manuel enregistré (client NULL, méthode manuel)', ligne2b.client_id === null && ligne2b.classement_methode === 'manuel', JSON.stringify(ligne2b));
  const pageListe2 = await req(jar, 'GET', '/courriels');
  r = await req(jar, 'POST', '/courriels/reclasser', { form: { _csrf: csrf(pageListe2.texte) } });
  ligne2b = bd.prepare('SELECT * FROM courriels WHERE id = ?').get(c2);
  test('Reclassement : lien manuel (délié) jamais réécrit', ligne2b.client_id === null && ligne2b.classement_methode === 'manuel', JSON.stringify(ligne2b));

  // Fiche police : section « Courriels liés »
  r = await req(jar, 'GET', '/echeances/police/' + D.policeA);
  test('Fiche police : section « Courriels liés » avec le message classé', r.statut === 200 && r.texte.includes('Courriels liés') && r.texte.includes('Avis — police CLS-2026-10001'), r.statut);

  // Cloisonnement HTTP : courriel d'un autre cabinet → 404
  r = await req(jar, 'GET', '/courriels/' + cAutre);
  test('Courriel d\u2019un autre cabinet → 404', r.statut === 404, r.statut);
}

(async () => {
  const cheminBd = process.env.CHEMIN_BD;
  if (!cheminBd) { console.log('❌ CHEMIN_BD requis'); process.exit(1); }
  const Database = require('better-sqlite3');
  const bd = new Database(cheminBd);
  try {
    const D = semerDonnees(bd);
    moteurTests(bd, D);
    await httpTests(bd, D);
  } catch (e) {
    console.log('  ❌ ERREUR FATALE :', e.message);
    echecs++;
  } finally {
    bd.close();
  }
  console.log(echecs === 0 ? `\n🎉 ${total}/${total} tests réussis` : `\n❌ ${echecs} échec(s) sur ${total}`);
  process.exit(echecs === 0 ? 0 : 1);
})();
