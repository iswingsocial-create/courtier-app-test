/**
 * scripts/test-ouverture-voix.js — Ouverture de dossier à la voix, étapes
 * 2 à 4 : dictée (texte simulé) → révision (entreprise, contact, produit,
 * éléments dictés) → création (client + contact + soumission, fiche avec
 * manques) ; enrichissement Google Maps à la révision (candidat choisi →
 * champs remplis + place_id persisté ; doublon place_id signalé) ; même
 * enrichissement au formulaire d'entreprise.
 *
 * AUCUN appel réel à Google : un harnais HTTP local (port 4199) sert des
 * JSON figés. Le SERVEUR d'application doit être lancé avec
 * PLACES_BASE_URL=http://127.0.0.1:4199/v1 (le balayage s'en charge).
 * Prérequis : serveur sur PORT (défaut 3101), base FRAÎCHE (seed), même
 * CHEMIN_BD pour le serveur et ce script, sans COHERE_API_KEY /
 * ASSISTANT_MOTEUR dans l'environnement du serveur.
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-ouverture-voix.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
delete process.env.COHERE_API_KEY;
delete process.env.ASSISTANT_MOTEUR;
const http = require('http');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);

const BASE = `http://localhost:${process.env.PORT || 3101}`;
const PORT_HARNAIS = 4199;
const CLE_GOOGLE = 'cle-google-de-test-ABCD1234';
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

// --- Harnais Google Places (JSON figés, mêmes fixtures que l'étape 1) -------------
const LIEU_COMPLET = {
  id: 'ChIJ-TEST-PLOMBERIE-001',
  displayName: { text: 'Plomberie Saint-Laurent inc.', languageCode: 'fr' },
  formattedAddress: '450 Rue des Érables, Montréal, QC H2T 1B5, Canada',
  addressComponents: [
    { longText: '450', shortText: '450', types: ['street_number'] },
    { longText: 'Rue des Érables', shortText: 'Rue des Érables', types: ['route'] },
    { longText: 'Montréal', shortText: 'Montréal', types: ['locality', 'political'] },
    { longText: 'Québec', shortText: 'QC', types: ['administrative_area_level_1', 'political'] },
    { longText: 'H2T 1B5', shortText: 'H2T 1B5', types: ['postal_code'] },
  ],
  nationalPhoneNumber: '(514) 555-0142',
  websiteUri: 'https://plomberie-saint-laurent.example.ca/',
  rating: 4.7, userRatingCount: 132, businessStatus: 'OPERATIONAL',
  types: ['plumber', 'establishment'],
};
const LIEU_SANS_TEL = {
  id: 'ChIJ-TEST-SANS-TEL',
  displayName: { text: 'Dépanneur Chez Mario', languageCode: 'fr' },
  formattedAddress: '12 Rue Principale, Laval, QC H7N 2K4, Canada',
  addressComponents: [
    { longText: '12', shortText: '12', types: ['street_number'] },
    { longText: 'Rue Principale', shortText: 'Rue Principale', types: ['route'] },
    { longText: 'Laval', shortText: 'Laval', types: ['locality', 'political'] },
    { longText: 'Québec', shortText: 'QC', types: ['administrative_area_level_1', 'political'] },
    { longText: 'H7N 2K4', shortText: 'H7N 2K4', types: ['postal_code'] },
  ],
  businessStatus: 'OPERATIONAL',
  types: ['convenience_store', 'establishment'],
};
function lancerHarnais() {
  const serveur = http.createServer((req2, res) => {
    let corps = '';
    req2.on('data', (c) => { corps += c; });
    req2.on('end', () => {
      const envoyer = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req2.headers['x-goog-api-key'] === 'MAUVAISE-CLE-TEST') {
        return envoyer(403, { error: { code: 403, message: 'API key not valid.', status: 'PERMISSION_DENIED' } });
      }
      if (req2.method === 'POST' && req2.url === '/v1/places:searchText') {
        let q = '';
        try { q = JSON.parse(corps || '{}').textQuery || ''; } catch (e) { /* ignore */ }
        if (/AUCUNRESULTAT/.test(q)) return envoyer(200, {});
        if (/Plomberie/.test(q)) return envoyer(200, { places: [LIEU_COMPLET, LIEU_SANS_TEL] });
        return envoyer(200, { places: [LIEU_COMPLET] });
      }
      const m = req2.url.match(/^\/v1\/places\/(.+)$/);
      if (req2.method === 'GET' && m) {
        const id = decodeURIComponent(m[1]);
        if (id === LIEU_COMPLET.id) return envoyer(200, LIEU_COMPLET);
        if (id === LIEU_SANS_TEL.id) return envoyer(200, LIEU_SANS_TEL);
        return envoyer(404, { error: { code: 404, message: 'Place not found.', status: 'NOT_FOUND' } });
      }
      return envoyer(404, { error: { code: 404, message: 'Route inconnue.', status: 'NOT_FOUND' } });
    });
  });
  return new Promise((resolve, reject) => {
    serveur.once('error', reject);
    serveur.listen(PORT_HARNAIS, '127.0.0.1', () => resolve(serveur));
  });
}

const TEXTE_BIENS = 'Nouveau dossier : Plomberie Saint-Laurent inc., contact Mario Tremblay, '
  + 'téléphone 514 555-0142, courriel mario@plomberie-sl.ca, situé au 450 rue des Érables, Montréal. '
  + 'Commence une soumission biens. '
  + 'Bâtiment : construction béton, année 1998, superficie 12 000 pieds carrés, gicleurs oui, valeur 1 500 000 dollars.';

(async () => {
  console.log('== Ouverture vocale — étapes 2 à 4 : flux, enrichissement Google, formulaire client ==', BASE);
  const harnais = await lancerHarnais();
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;

  // ---- 1. Admin : clé Google enregistrée + test de connexion (harnais) ----------------
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp', r.statut === 302);
  r = await req(jar, 'GET', '/admin/cohere');
  test('page Admin : section « 🗺️ Clé Google Maps (Places) » présente', /Clé Google Maps \(Places\)/.test(r.texte));
  r = await req(jar, 'POST', '/admin/cohere/google/cle', { form: { cle: CLE_GOOGLE, _csrf: csrf(r.texte) } });
  test('enregistrement de la clé Google → 200', r.statut === 200, String(r.statut));
  r = await req(jar, 'GET', '/admin/cohere');
  test('page Admin : masque Google « •••• 1234 », jamais la clé en clair',
    /•••• •••• 1234/.test(r.texte) && !r.texte.includes(CLE_GOOGLE));
  r = await req(jar, 'POST', '/admin/cohere/google/tester', { form: { _csrf: csrf(r.texte) } });
  test('test de connexion Google (harnais) : réussi', r.statut === 200 && /Connexion à Google Places réussie/.test(r.texte), r.texte.slice(0, 200));

  // Courtier : réglages Google refusés
  const hash = bcrypt.hashSync('Test1234!', 4);
  bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe) VALUES (?, ?, ?, 'courtier', ?, 0)")
    .run(cabA, 'courtier-ouverture@t.ca', hash, 'Courtier Ouverture');
  const loginC = await loginComme('courtier-ouverture@t.ca', 'Test1234!');
  r = await req(loginC.jar, 'POST', '/admin/cohere/google/cle', { form: { cle: CLE_GOOGLE, _csrf: 'x' } });
  test('courtier : enregistrement de la clé Google refusé (403)', r.statut === 403, String(r.statut));

  // ---- 2. Page de dictée ------------------------------------------------------------------
  r = await req(jar, 'GET', '/ouverture');
  test('GET /ouverture : zone de dictée + bouton micro + formulaire d’analyse',
    r.statut === 200 && /id="texte-dicte"/.test(r.texte) && /id="btn-micro"/.test(r.texte) && /action="\/ouverture\/analyser"/.test(r.texte));
  test('GET /ouverture : Google Maps annoncé comme configuré', /Google Maps est configuré/.test(r.texte));
  r = await req(jar, 'POST', '/ouverture/analyser', { form: { texte: TEXTE_BIENS, _csrf: 'x' } });
  test('POST /ouverture/analyser sans CSRF valide → 403', r.statut === 403, String(r.statut));

  // ---- 3. Analyse de la dictée biens ----------------------------------------------------------
  const pageOuv = await req(jar, 'GET', '/ouverture');
  r = await req(jar, 'POST', '/ouverture/analyser', { form: { texte: TEXTE_BIENS, _csrf: csrf(pageOuv.texte) } });
  test('analyse de la dictée → redirection vers la révision', r.statut === 302 && /^\/ouverture\/\d+$/.test(r.location || ''), String(r.location));
  const urlRevision = r.location;
  const analyseId = Number((urlRevision || '').split('/').pop());
  const analyse = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(analyseId);
  test('la transcription est conservée (analyse, texte extrait = dictée)',
    !!analyse && /Plomberie Saint-Laurent/.test(analyse.texte_extrait || '') && analyse.statut === 'a_reviser');
  test('produit détecté : biens', analyse.produit_detecte === 'biens', analyse.produit_detecte);

  r = await req(jar, 'GET', urlRevision);
  test('révision : entreprise pré-remplie', /value="Plomberie Saint-Laurent inc/.test(r.texte));
  test('révision : adresse et ville dictées pré-remplies', /value="450 rue des Érables"/.test(r.texte) && /value="Montréal"/.test(r.texte), r.texte.slice(0, 400));
  test('révision : contact Mario Tremblay pré-rempli', /name="contact_prenom" value="Mario"/.test(r.texte) && /name="contact_nom" value="Tremblay"/.test(r.texte));
  test('révision : produit biens sélectionné', /value="biens" selected/.test(r.texte));
  test('révision : section Google Maps avec les candidats du harnais',
    /Trouvé sur Google Maps/.test(r.texte) && /450 Rue des Érables, Montréal, QC H2T 1B5, Canada/.test(r.texte));
  test('révision : candidat avec note et avis (★ 4.7, 132 avis)', /★ 4\.7/.test(r.texte) && /132 avis/.test(r.texte));
  test('révision : bâtiment dicté (béton, 1998, 12 000 pi²)',
    /name="liste_batiments_0_type_construction" value="beton"/.test(r.texte)
    && /name="liste_batiments_0_annee_construction" value="1998"/.test(r.texte)
    && /name="liste_batiments_0_superficie_pi2" value="12000"/.test(r.texte));
  test('révision : gicleurs « oui » sélectionné', /name="liste_batiments_0_gicleurs"[\s\S]{0,200}value="1" selected/.test(r.texte));
  test('révision : valeur du bâtiment dictée (1 500 000) et adresse héritée de l’entreprise',
    /name="liste_batiments_0_valeur_batiment" value="1500000"/.test(r.texte)
    && /name="liste_batiments_0_adresse" value="450/.test(r.texte));

  // ---- 4. Création du dossier (candidat Google choisi) -------------------------------------------
  r = await req(jar, 'POST', `${urlRevision}/creer`, {
    form: {
      _csrf: csrf(r.texte),
      mode_entreprise: 'nouveau',
      ent_raison_sociale: 'Plomberie Saint-Laurent inc.',
      ent_neq: '', ent_adresse: '450 Rue des Érables', ent_ville: 'Montréal',
      ent_province: 'QC', ent_code_postal: 'H2T 1B5',
      ent_telephone_entreprise: '(514) 555-0142', ent_courriel_entreprise: '',
      ent_site_web: 'https://plomberie-saint-laurent.example.ca/',
      google_place_id: 'ChIJ-TEST-PLOMBERIE-001',
      contact_prenom: 'Mario', contact_nom: 'Tremblay', contact_titre: '',
      contact_courriel: 'mario@plomberie-sl.ca', contact_telephone: '514 555-0142',
      produit: 'biens',
      liste_batiments_0_inclure: 'on',
      liste_batiments_0_adresse: '450 Rue des Érables', liste_batiments_0_ville: 'Montréal',
      liste_batiments_0_code_postal: 'H2T 1B5', liste_batiments_0_type_construction: 'beton',
      liste_batiments_0_annee_construction: '1998', liste_batiments_0_superficie_pi2: '12000',
      liste_batiments_0_gicleurs: '1', liste_batiments_0_valeur_batiment: '1500000',
    },
  });
  test('création → redirection vers la fiche de la soumission biens',
    r.statut === 302 && /^\/biens\/\d+$/.test(r.location || ''), `${r.statut} ${r.location}`);
  const soumBiensId = Number((r.location || '').split('/').pop());
  const client = bd.prepare("SELECT * FROM clients WHERE cabinet_id = ? AND raison_sociale = 'Plomberie Saint-Laurent inc.'").get(cabA);
  test('entreprise créée au dossier', !!client);
  test('entreprise : place_id Google persisté', client && client.place_id_google === 'ChIJ-TEST-PLOMBERIE-001', client && client.place_id_google);
  test('entreprise : adresse, ville, province, code postal, site web',
    client && client.adresse === '450 Rue des Érables' && client.ville === 'Montréal'
    && client.province === 'QC' && client.code_postal === 'H2T 1B5'
    && client.site_web === 'https://plomberie-saint-laurent.example.ca/');
  const contact = bd.prepare('SELECT * FROM contacts WHERE client_id = ? AND principal = 1').get(client.id);
  test('contact principal créé (Mario Tremblay)', !!contact && contact.prenom === 'Mario' && contact.nom === 'Tremblay');
  const soum = bd.prepare('SELECT * FROM biens_soumissions WHERE id = ?').get(soumBiensId);
  test('soumission biens créée et rattachée au client', !!soum && soum.client_id === client.id);
  const bat = bd.prepare('SELECT * FROM biens_batiments WHERE soumission_id = ?').get(soumBiensId);
  test('bâtiment versé : béton, 1998, 12 000 pi², gicleurs, valeur',
    !!bat && bat.type_construction === 'beton' && bat.annee_construction === 1998
    && bat.superficie_pi2 === 12000 && bat.gicleurs === 1 && bat.valeur_batiment === 1500000,
    bat && JSON.stringify(bat));
  const journalOuverture = bd.prepare("SELECT * FROM journal_audit WHERE action = 'dossier_ouvert_voix'").all();
  test('journal : dossier_ouvert_voix tracé', journalOuverture.length === 1 && /biens/.test(journalOuverture[0].details || ''));
  const analyseApres = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(analyseId);
  test('analyse marquée insérée, liée à la soumission', analyseApres.statut === 'insere' && analyseApres.soumission_id === soumBiensId);
  r = await req(jar, 'GET', '/biens/' + soumBiensId);
  test('fiche de la soumission : section « Informations manquantes » affichée',
    r.statut === 200 && /Informations manquantes/.test(r.texte));
  r = await req(jar, 'GET', urlRevision);
  test('révision rejouée après création : « déjà servi »', /a déjà servi à ouvrir un dossier/.test(r.texte));

  // ---- 5. Entreprise existante (nom) : pas de doublon ----------------------------------------------
  const pageOuv2 = await req(jar, 'GET', '/ouverture');
  r = await req(jar, 'POST', '/ouverture/analyser', {
    form: {
      _csrf: csrf(pageOuv2.texte),
      texte: 'Nouveau dossier : Plomberie Saint-Laurent inc., contact Mario Tremblay, à Montréal. Commence une soumission biens. Bâtiment : construction béton, 2010.',
    },
  });
  const urlRevision2 = r.location;
  r = await req(jar, 'GET', urlRevision2);
  test('révision 2 : « Entreprise existante probable » avec le choix d’utiliser l’existante',
    /Entreprise existante probable/.test(r.texte) && r.texte.includes(`value="existant:${client.id}"`));
  r = await req(jar, 'POST', `${urlRevision2}/creer`, {
    form: {
      _csrf: csrf(r.texte), mode_entreprise: `existant:${client.id}`,
      ent_raison_sociale: 'Plomberie Saint-Laurent inc.',
      produit: 'biens',
      liste_batiments_0_inclure: 'on', liste_batiments_0_type_construction: 'beton',
      liste_batiments_0_annee_construction: '2010',
    },
  });
  test('création chez l’existante → redirection vers une soumission biens',
    r.statut === 302 && /^\/biens\/\d+$/.test(r.location || ''), `${r.statut} ${r.location}`);
  const nbClients = bd.prepare("SELECT COUNT(*) AS n FROM clients WHERE cabinet_id = ? AND raison_sociale = 'Plomberie Saint-Laurent inc.'").get(cabA).n;
  test('aucun doublon d’entreprise créé', nbClients === 1, String(nbClients));
  const soum2 = bd.prepare('SELECT * FROM biens_soumissions WHERE id = ?').get(Number((r.location || '').split('/').pop()));
  test('la 2e soumission est chez le même client', !!soum2 && soum2.client_id === client.id);

  // ---- 6. Doublon Google (place_id déjà au dossier) -----------------------------------------------------
  const pageOuv3 = await req(jar, 'GET', '/ouverture');
  r = await req(jar, 'POST', '/ouverture/analyser', {
    form: {
      _csrf: csrf(pageOuv3.texte),
      texte: 'Nouveau dossier : Entreprise Quelconque ltée, contact Paul Côté, à Québec. Commence une soumission rc.',
    },
  });
  const urlRevision3 = r.location;
  r = await req(jar, 'GET', urlRevision3);
  test('révision 3 : candidat Google déjà au dossier → « Ce dossier existe déjà »',
    /Ce dossier existe déjà/.test(r.texte) && r.texte.includes(`/clients/${client.id}`), r.texte.slice(0, 300));

  // ---- 7. Produit non détecté : choix manuel obligatoire --------------------------------------------------
  const pageOuv4 = await req(jar, 'GET', '/ouverture');
  r = await req(jar, 'POST', '/ouverture/analyser', {
    form: {
      _csrf: csrf(pageOuv4.texte),
      texte: 'Nouveau dossier : Boulangerie du Coin inc., contact Sara Côté, à Laval. On veut assurer l’entreprise et ses locaux.',
    },
  });
  const urlRevision4 = r.location;
  const analyse4 = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(Number((urlRevision4 || '').split('/').pop()));
  test('produit non détecté : produit_detecte NULL (honnête)', analyse4 && analyse4.produit_detecte === null, analyse4 && analyse4.produit_detecte);
  r = await req(jar, 'GET', urlRevision4);
  test('révision 4 : message « choisissez le produit », aucun produit présélectionné',
    /Produit non détecté/.test(r.texte) && !/value="(biens|rc|cyber|eo|do|pe|flotte|auto|cautionnement)" selected/.test(r.texte));
  r = await req(jar, 'POST', `${urlRevision4}/creer`, {
    form: { _csrf: csrf(r.texte), mode_entreprise: 'nouveau', ent_raison_sociale: 'Boulangerie du Coin inc.' },
  });
  test('création sans produit → 400 « Produit manquant »', r.statut === 400 && /Produit manquant/.test(r.texte), String(r.statut));
  const pageRev4 = await req(jar, 'GET', urlRevision4);
  r = await req(jar, 'POST', `${urlRevision4}/creer`, {
    form: {
      _csrf: csrf(pageRev4.texte), mode_entreprise: 'nouveau',
      ent_raison_sociale: 'Boulangerie du Coin inc.', ent_ville: 'Laval',
      contact_prenom: 'Sara', contact_nom: 'Côté', produit: 'biens',
    },
  });
  test('création avec produit choisi manuellement → redirection soumission',
    r.statut === 302 && /^\/biens\/\d+$/.test(r.location || ''), `${r.statut} ${r.location}`);
  const clientBoulangerie = bd.prepare("SELECT * FROM clients WHERE cabinet_id = ? AND raison_sociale = 'Boulangerie du Coin inc.'").get(cabA);
  test('entreprise du produit manuel créée', !!clientBoulangerie);

  // ---- 8. Parcours flotte -----------------------------------------------------------------------------------
  const pageOuv5 = await req(jar, 'GET', '/ouverture');
  r = await req(jar, 'POST', '/ouverture/analyser', {
    form: {
      _csrf: csrf(pageOuv5.texte),
      texte: 'Nouveau dossier : Transport Lapointe inc., contact Luc Lapointe, à Laval. Commence une soumission flotte. '
        + 'Véhicule : Ford F-150 2022, valeur 45 000 dollars. '
        + 'Conducteur : Luc Lapointe, permis L123-456789-01, classe 1, 15 ans d’expérience.',
    },
  });
  const urlRevision5 = r.location;
  const analyse5 = bd.prepare('SELECT * FROM analyses_documents WHERE id = ?').get(Number((urlRevision5 || '').split('/').pop()));
  test('flotte : produit détecté', analyse5 && analyse5.produit_detecte === 'flotte', analyse5 && analyse5.produit_detecte);
  r = await req(jar, 'GET', urlRevision5);
  test('flotte révision : véhicule dicté (2022, 45 000) et permis du conducteur',
    /name="liste_vehicules_0_annee" value="2022"/.test(r.texte)
    && /name="liste_vehicules_0_valeur" value="45000"/.test(r.texte)
    && /L123-456789-01/.test(r.texte), r.texte.slice(0, 300));
  r = await req(jar, 'POST', `${urlRevision5}/creer`, {
    form: {
      _csrf: csrf(r.texte), mode_entreprise: 'nouveau',
      ent_raison_sociale: 'Transport Lapointe inc.', ent_ville: 'Laval',
      contact_prenom: 'Luc', contact_nom: 'Lapointe', produit: 'flotte',
      liste_vehicules_0_inclure: 'on', liste_vehicules_0_annee: '2022',
      liste_vehicules_0_marque: 'Ford', liste_vehicules_0_modele: 'F-150', liste_vehicules_0_valeur: '45000',
      liste_conducteurs_0_inclure: 'on', liste_conducteurs_0_prenom: 'Luc', liste_conducteurs_0_nom: 'Lapointe',
      liste_conducteurs_0_numero_permis: 'L123-456789-01', liste_conducteurs_0_classe_permis: '1',
      liste_conducteurs_0_annees_experience: '15',
    },
  });
  test('flotte : création → redirection vers la fiche flotte',
    r.statut === 302 && /^\/flotte\/\d+$/.test(r.location || ''), `${r.statut} ${r.location}`);
  const soumFlotteId = Number((r.location || '').split('/').pop());
  const veh = bd.prepare('SELECT * FROM flotte_vehicules WHERE soumission_id = ?').get(soumFlotteId);
  const cond = bd.prepare('SELECT * FROM flotte_conducteurs WHERE soumission_id = ?').get(soumFlotteId);
  test('flotte : véhicule versé (2022, 45 000 $)', !!veh && veh.annee === 2022 && veh.valeur === 45000, veh && JSON.stringify(veh));
  test('flotte : conducteur versé (permis, classe, expérience)',
    !!cond && cond.numero_permis === 'L123-456789-01' && cond.nom === 'Lapointe', cond && JSON.stringify(cond));

  // ---- 9. Étape 4 : enrichissement au formulaire d’entreprise ------------------------------------------------
  r = await req(jar, 'GET', '/clients/nouveau');
  test('formulaire client : bouton Google Maps + champ caché place_id',
    r.statut === 200 && /btn-rech-google/.test(r.texte) && /name="place_id_google"/.test(r.texte) && /name="site_web"/.test(r.texte) && /name="province"/.test(r.texte));
  r = await req(jar, 'GET', '/google-places/rechercher?q=' + encodeURIComponent('Plomberie Saint-Laurent'));
  test('JSON /google-places/rechercher : candidats du harnais',
    r.statut === 200 && /"statut":"ok"/.test(r.texte) && /ChIJ-TEST-PLOMBERIE-001/.test(r.texte), r.texte.slice(0, 200));
  r = await req(jar, 'GET', '/google-places/details/ChIJ-TEST-SANS-TEL');
  test('JSON /google-places/details : entreprise normalisée sans téléphone',
    r.statut === 200 && /Dépanneur Chez Mario/.test(r.texte) && /"telephone":null/.test(r.texte), r.texte.slice(0, 200));
  const jarAnon = nouveauJar();
  r = await req(jarAnon, 'GET', '/google-places/rechercher?q=Plomberie');
  test('JSON Places sans connexion → redirection connexion (302)', r.statut === 302, String(r.statut));
  const pageClient = await req(jar, 'GET', '/clients/nouveau');
  r = await req(jar, 'POST', '/clients', {
    form: {
      _csrf: csrf(pageClient.texte),
      raison_sociale: 'Dépanneur Chez Mario inc.', neq: '', secteur_activite: '',
      courriel_entreprise: '', telephone_entreprise: '(450) 555-0188',
      site_web: 'https://depanneur-chez-mario.example.ca/', place_id_google: 'ChIJ-TEST-SANS-TEL',
      chiffre_affaires: '', nb_employes: '',
      prenom: 'Mario', nom: 'Côté', titre_contact: 'Propriétaire',
      courriel: '', telephone: '', adresse: '12 Rue Principale', ville: 'Laval',
      province: 'QC', code_postal: 'H7N 2K4', langue: 'FR', notes: '',
    },
  });
  test('création d’entreprise via le formulaire → redirection fiche', r.statut === 302 && /^\/clients\/\d+$/.test(r.location || ''), `${r.statut} ${r.location}`);
  const clientForm = bd.prepare("SELECT * FROM clients WHERE cabinet_id = ? AND raison_sociale = 'Dépanneur Chez Mario inc.'").get(cabA);
  test('formulaire : place_id, site web et province enregistrés',
    !!clientForm && clientForm.place_id_google === 'ChIJ-TEST-SANS-TEL'
    && clientForm.site_web === 'https://depanneur-chez-mario.example.ca/' && clientForm.province === 'QC',
    clientForm && JSON.stringify({ p: clientForm.place_id_google, s: clientForm.site_web, pr: clientForm.province }));

  // ---- 10. Cloisonnement inter-cabinets ---------------------------------------------------------------------------
  const cabB = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Ouverture B').lastInsertRowid;
  bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe) VALUES (?, ?, ?, 'admin', ?, 0)")
    .run(cabB, 'admin-b-ouverture@t.ca', hash, 'Admin B');
  const loginB = await loginComme('admin-b-ouverture@t.ca', 'Test1234!');
  test('login cabinet B', loginB.ok);
  r = await req(loginB.jar, 'GET', urlRevision3);
  test('cabinet B : révision du cabinet A → 404', r.statut === 404, String(r.statut));
  r = await req(loginB.jar, 'POST', `${urlRevision3}/creer`, {
    form: { _csrf: 'x', mode_entreprise: 'nouveau', ent_raison_sociale: 'Intrusion inc.', produit: 'biens' },
  });
  test('cabinet B : création sur l’analyse du cabinet A → refusée (403/404)', [403, 404].includes(r.statut), String(r.statut));
  const intrusion = bd.prepare("SELECT id FROM clients WHERE raison_sociale = 'Intrusion inc.'").get();
  test('cabinet B : aucune entreprise créée par l’intrusion', !intrusion);

  // ---- 11. Sans clé Google : la révision reste sobre ------------------------------------------------------------------
  r = await req(jar, 'GET', '/admin/cohere');
  r = await req(jar, 'POST', '/admin/cohere/google/effacer', { form: { _csrf: csrf(r.texte) } });
  test('retrait de la clé Google → 200', r.statut === 200, String(r.statut));
  r = await req(jar, 'GET', urlRevision3);
  test('révision sans clé : mention sobre « Clé Google Maps non configurée »',
    /Clé Google Maps non configurée — l'ouverture fonctionne sans l'enrichissement/.test(r.texte));
  r = await req(jar, 'GET', '/clients/nouveau');
  test('formulaire client sans clé : pas de bouton Google (pas de promesse vide)', !/btn-rech-google/.test(r.texte));

  harnais.close();
  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
