/**
 * scripts/test-courriels.js — Tests du module Courriels :
 * comptes IMAP/SMTP, réception, rédaction + IA, envoi, liaison entreprises.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed commercial).
 * Usage : CHEMIN_BD=/tmp/courtier-test.db PORT=3101 node scripts/test-courriels.js
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
async function reqJson(jar, chemin, objet) {
  const res = await fetch(BASE + chemin, {
    method: 'POST',
    headers: { ...enteteCookies(jar), 'Content-Type': 'application/json' },
    body: JSON.stringify(objet),
    redirect: 'manual',
  });
  appliquerCookies(jar, res);
  const texte = await res.text();
  let json = null;
  try { json = JSON.parse(texte); } catch { /* ignore */ }
  return { statut: res.status, json, texte };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function test(nom, condition, detail) {
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

async function httpTests() {
  console.log('— Tests HTTP —');
  const jar = await loginAdmin();

  let r = await req(jar, 'GET', '/courriels');
  test('Boîte de réception accessible', r.statut === 200 && r.texte.includes('Courriels reçus'), r.statut);

  r = await req(jar, 'GET', '/courriels/comptes');
  test('Liste des comptes accessible', r.statut === 200 && r.texte.includes('Comptes courriel'), r.statut);

  r = await req(jar, 'GET', '/courriels/comptes/nouveau');
  const csrfNouveau = csrf(r.texte);
  test('Formulaire de compte (admin)', r.statut === 200 && !!csrfNouveau, r.statut);

  // Création invalide
  r = await req(jar, 'POST', '/courriels/comptes', { form: {
    _csrf: csrfNouveau, nom: 'Test', adresse: 'pas-un-courriel',
    imap_hote: 'imap.invalid', imap_port: '993', imap_tls: '1',
    smtp_hote: 'smtp.invalid', smtp_port: '587', smtp_tls: '1',
    utilisateur: 'test@invalid', mot_de_passe: 'secret123',
  } });
  test('Création refusée si adresse invalide', r.statut === 400 && r.texte.includes('invalide'), r.statut);

  // Création valide (serveurs fictifs — aucune connexion tentée à la création)
  r = await req(jar, 'GET', '/courriels/comptes/nouveau');
  r = await req(jar, 'POST', '/courriels/comptes', { form: {
    _csrf: csrf(r.texte), nom: 'Compte Test', adresse: 'test@exemple.ca',
    imap_hote: 'imap.invalid', imap_port: '993', imap_tls: '1',
    smtp_hote: 'smtp.invalid', smtp_port: '587', smtp_tls: '1',
    utilisateur: 'test@exemple.ca', mot_de_passe: 'MotDePasseSecret123!',
  } });
  test('Création d’un compte valide', r.statut === 302 && (r.location || '').includes('/courriels/comptes'), `${r.statut} ${r.location}`);

  r = await req(jar, 'GET', '/courriels/comptes');
  const mId = r.texte.match(/\/courriels\/comptes\/(\d+)\/modifier/);
  const compteId = mId ? mId[1] : null;
  test('Le compte apparaît dans la liste', !!compteId);

  // Le mot de passe ne doit jamais réapparaître en clair
  r = await req(jar, 'GET', `/courriels/comptes/${compteId}/modifier`);
  test('Mot de passe jamais réaffiché en clair', r.statut === 200 && !r.texte.includes('MotDePasseSecret123!'), r.statut);

  // Test de connexion vers un hôte fictif → échec gracieux, pas de 500
  r = await req(jar, 'GET', '/courriels/comptes');
  r = await req(jar, 'POST', `/courriels/comptes/${compteId}/tester`, { form: { _csrf: csrf(r.texte) } });
  test('Test de connexion : échec gracieux (pas de 500)', r.statut === 200 && r.texte.includes('échoué'), r.statut);

  // Synchronisation vers un hôte fictif → redirection avec synchro=erreur
  r = await req(jar, 'POST', `/courriels/comptes/${compteId}/synchroniser`, { form: { _csrf: csrf(r.texte) } });
  test('Synchro : échec gracieux', r.statut === 302 && (r.location || '').includes('synchro=erreur'), `${r.statut} ${r.location}`);

  // Rédaction
  r = await req(jar, 'GET', '/courriels/rediger');
  const csrfRediger = csrf(r.texte);
  test('Page de rédaction accessible', r.statut === 200 && r.texte.includes('Rédiger un courriel'), r.statut);

  // IA : sans contexte → 400
  let jr = await reqJson(jar, '/courriels/rediger-ia', { _csrf: csrfRediger, contexte: '', ton: 'pro' });
  test('IA : contexte vide refusé', jr.statut === 400, jr.statut);

  // IA : avec contexte → brouillon (modèle local, sans clé Cohere)
  jr = await reqJson(jar, '/courriels/rediger-ia', { _csrf: csrfRediger, contexte: 'renouvellement police CGL', destinataire: 'Marie', ton: 'pro' });
  test('IA : brouillon généré', jr.statut === 200 && jr.json && jr.json.sujet && jr.json.contenu, jr.statut);

  // Envoi : destinataire invalide → 400
  r = await req(jar, 'POST', '/courriels/envoyer', { form: {
    _csrf: csrfRediger, compte_id: compteId, a: 'pas-un-courriel', sujet: 'Test', texte: 'Bonjour',
  } });
  test('Envoi refusé si destinataire invalide', r.statut === 400, r.statut);

  // Envoi : SMTP fictif → 502 gracieux (pas de 500)
  r = await req(jar, 'POST', '/courriels/envoyer', { form: {
    _csrf: csrfRediger, compte_id: compteId, a: 'dest@exemple.ca', sujet: 'Test', texte: 'Bonjour',
  } });
  test('Envoi : échec SMTP gracieux (pas de 500)', r.statut === 502 && r.texte.includes('Échec'), `${r.statut}`);

  // Courriel inexistant
  r = await req(jar, 'GET', '/courriels/999999');
  test('Courriel inexistant → 404', r.statut === 404, r.statut);
  r = await req(jar, 'POST', '/courriels/999999/lier', { form: { _csrf: csrfRediger, client_id: '1' } });
  test('Liaison sur courriel inexistant → 404', r.statut === 404, r.statut);

  // Désactiver / activer / archiver / désarchiver
  r = await req(jar, 'POST', `/courriels/comptes/${compteId}/desactiver`, { form: { _csrf: csrfRediger } });
  test('Désactivation du compte', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/courriels/comptes/${compteId}/activer`, { form: { _csrf: csrfRediger } });
  test('Réactivation du compte', r.statut === 302, r.statut);
  r = await req(jar, 'POST', `/courriels/comptes/${compteId}/archiver`, { form: { _csrf: csrfRediger } });
  test('Archivage du compte', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/courriels/comptes?archives=1');
  test('Compte visible dans les archives', r.statut === 200 && r.texte.includes('Compte Test'), r.statut);
  r = await req(jar, 'POST', `/courriels/comptes/${compteId}/desarchiver`, { form: { _csrf: csrfRediger } });
  test('Désarchivage du compte', r.statut === 302, r.statut);

  return compteId;
}

async function unitTests() {
  console.log('— Tests unitaires (parsing, chiffrement, liaison) —');
  const c = require('../lib/courriels');

  const clair = 'MotDePasseSecret123!';
  const chiffre = c.chiffrerMotDePasse(clair);
  test('Chiffrement : le secret n’est pas en clair', !chiffre.includes(clair) && chiffre.split(':').length === 3);
  test('Déchiffrement : roundtrip', c.dechiffrerMotDePasse(chiffre) === clair);

  const motB = c.decoderMotEncode('=?UTF-8?B?TWFyw6k=?=');
  const motQ = c.decoderMotEncode('=?UTF-8?Q?Renouvellement_police?=');
  test('RFC 2047 : décodage base64', motB === 'Maré', JSON.stringify(motB));
  test('RFC 2047 : décodage quoted-printable', motQ === 'Renouvellement police', JSON.stringify(motQ));

  const raw = 'From: =?UTF-8?B?TWFyacOp?= <marie@exemple.ca>\r\n'
    + 'To: patrick@cabinet.ca, jean@exemple.ca\r\n'
    + 'Subject: =?UTF-8?Q?Renouvellement?=\r\n'
    + 'Message-ID: <abc123@exemple.ca>\r\n'
    + 'Date: Thu, 08 Oct 2026 20:00:00 -0400\r\n'
    + 'Content-Type: multipart/alternative; boundary="frontiere1"\r\n\r\n'
    + '--frontiere1\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n'
    + 'Bonjour =C3=A7a va ?\r\n'
    + '--frontiere1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n'
    + '<html><body><p>Bonjour</p></body></html>\r\n--frontiere1--\r\n';
  const p = c.analyserMessage(raw);
  test('MIME : expéditeur + adresses', p.expediteurCourriels[0] === 'marie@exemple.ca' && p.destinataires.length === 2, JSON.stringify(p.expediteurCourriels));
  test('MIME : sujet décodé', p.sujet === 'Renouvellement', p.sujet);
  test('MIME : message-id', p.messageId === '<abc123@exemple.ca>', p.messageId);
  test('MIME : texte quoted-printable', p.texte === 'Bonjour ça va ?', JSON.stringify(p.texte));
  test('MIME : html extrait', p.html.includes('<p>Bonjour</p>'), p.html.slice(0, 40));

  const sale = '<p>Bonjour</p><script>alert(1)</script><a href="javascript:alert(2)" onclick="x()">clique</a><iframe src="http://evil"></iframe>';
  const propre = c.assainirHtml(sale);
  test('Sanitize : script/iframe supprimés', !/<script|<iframe/i.test(propre), propre.slice(0, 80));
  test('Sanitize : onclick et javascript: neutralisés', !/onclick|javascript:/i.test(propre), propre.slice(0, 120));
  test('Sanitize : contenu légitime conservé', propre.includes('<p>Bonjour</p>'));

  const emails = c.extraireCourriels('"Marie Tremblay" <marie@exemple.ca>, jean@exemple.ca');
  test('Extraction d’adresses', emails.length === 2 && emails[0] === 'marie@exemple.ca', emails.join(','));

  // Liaison auto entreprise (via la base de test directement)
  const cheminBd = process.env.CHEMIN_BD;
  if (cheminBd) {
    const Database = require('better-sqlite3');
    const bd = new Database(cheminBd);
    const cab = bd.prepare('SELECT id FROM cabinets LIMIT 1').get();
    const r = bd.prepare(`INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel) VALUES (?, 'Test Liaison Inc.', 'Test', 'Liaison', 'marie@exemple.ca')`).run(cab.id);
    test('Liaison auto : adresse connue → entreprise', c.lierClientAuto(bd, cab.id, ['marie@exemple.ca']) === r.lastInsertRowid);
    test('Liaison auto : adresse inconnue → null', c.lierClientAuto(bd, cab.id, ['inconnu@exemple.ca']) === null);
    bd.prepare('DELETE FROM clients WHERE id = ?').run(r.lastInsertRowid);
    bd.close();
  } else {
    console.log('  ⚠️ CHEMIN_BD non défini — tests de liaison ignorés');
  }
}

(async () => {
  try {
    await httpTests();
    await unitTests();
  } catch (e) {
    console.log('  ❌ ERREUR FATALE :', e.message);
    echecs++;
  }
  console.log(echecs === 0 ? '\n✅ Tous les tests courriels ont réussi.' : `\n❌ ${echecs} échec(s).`);
  process.exit(echecs === 0 ? 0 : 1);
})();
