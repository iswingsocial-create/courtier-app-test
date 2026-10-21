/**
 * scripts/test-places-google.js — Ouverture vocale, étape 1 : réglage de la
 * clé Google Places (chiffrée, masquée, pattern Cohere) et client API
 * Places (New) — recherche texte et détails, normalisation vers les champs
 * de la fiche client.
 *
 * AUCUN appel réel à Google : un harnais HTTP local sert des JSON figés et
 * PLACES_BASE_URL pointe dessus. La « clé » est un jeton de test faux.
 * Prérequis : base FRAÎCHE via CHEMIN_BD, SANS serveur d'application.
 * Usage : CHEMIN_BD=/tmp/test-places.db node scripts/test-places-google.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-places.db';
delete process.env.GOOGLE_PLACES_API_KEY;
const http = require('http');
const bd = require('../lib/bd');
const chiffrement = require('../lib/chiffrement');

let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

const LIEU_COMPLET = {
  id: 'ChIJ-TEST-PLOMBERIE-001',
  displayName: { text: 'Plomberie Saint-Laurent inc.', languageCode: 'fr' },
  formattedAddress: '450 Rue des Érables, Montréal, QC H2T 1B5, Canada',
  addressComponents: [
    { longText: '450', shortText: '450', types: ['street_number'] },
    { longText: 'Rue des Érables', shortText: 'Rue des Érables', types: ['route'] },
    { longText: 'Montréal', shortText: 'Montréal', types: ['locality', 'political'] },
    { longText: 'Québec', shortText: 'QC', types: ['administrative_area_level_1', 'political'] },
    { longText: 'Canada', shortText: 'CA', types: ['country', 'political'] },
    { longText: 'H2T 1B5', shortText: 'H2T 1B5', types: ['postal_code'] },
  ],
  nationalPhoneNumber: '(514) 555-0142',
  internationalPhoneNumber: '+1 514-555-0142',
  websiteUri: 'https://plomberie-saint-laurent.example.ca/',
  rating: 4.7,
  userRatingCount: 132,
  businessStatus: 'OPERATIONAL',
  types: ['plumber', 'establishment'],
  regularOpeningHours: { weekdayDescriptions: ['lundi: 08:00 – 17:00', 'mardi: 08:00 – 17:00'] },
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
  const serveur = http.createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => { corps += c; });
    req.on('end', () => {
      const envoyer = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const cle = req.headers['x-goog-api-key'];
      if (cle === 'MAUVAISE-CLE-TEST') {
        return envoyer(403, { error: { code: 403, message: 'API key not valid. Please pass a valid API key.', status: 'PERMISSION_DENIED' } });
      }
      if (req.method === 'POST' && req.url === '/v1/places:searchText') {
        let q = '';
        try { q = JSON.parse(corps || '{}').textQuery || ''; } catch (e) { /* ignore */ }
        if (/AUCUNRESULTAT/.test(q)) return envoyer(200, {});
        if (/Plomberie/.test(q)) return envoyer(200, { places: [LIEU_COMPLET, LIEU_SANS_TEL] });
        return envoyer(200, { places: [LIEU_COMPLET] });
      }
      const m = req.url.match(/^\/v1\/places\/(.+)$/);
      if (req.method === 'GET' && m) {
        const id = decodeURIComponent(m[1]);
        if (id === LIEU_COMPLET.id) return envoyer(200, LIEU_COMPLET);
        if (id === LIEU_SANS_TEL.id) return envoyer(200, LIEU_SANS_TEL);
        return envoyer(404, { error: { code: 404, message: 'Place not found.', status: 'NOT_FOUND' } });
      }
      return envoyer(404, { error: { code: 404, message: 'Route inconnue du harnais.', status: 'NOT_FOUND' } });
    });
  });
  return new Promise((resolve) => {
    serveur.listen(0, '127.0.0.1', () => resolve(serveur));
  });
}

(async () => {
  console.log('== Ouverture vocale — étape 1 : réglage clé Google + client Places (harnais local) ==');
  const harnais = await lancerHarnais();
  process.env.PLACES_BASE_URL = `http://127.0.0.1:${harnais.address().port}/v1`;
  const places = require('../lib/places-google');
  // Suite modèle : cabinet propre (le seed démo n'est chargé que par le serveur).
  const cab = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Places Test').lastInsertRowid;
  const BONNE_CLE = 'cle-google-de-test-ABCD1234';

  test('baseUrl : la surcharge PLACES_BASE_URL est honorée', places.baseUrl() === process.env.PLACES_BASE_URL);

  // --- Réglage : état initial ---------------------------------------------------
  let reg = places.obtenirReglageGoogle(cab);
  test('initial : non configuré, aucune clé', reg.configuree === false && reg.clePresente === false && reg.masque === null);
  const t0 = await places.testerConnexionGoogle(cab);
  test('test de connexion sans clé : statut non_configure, message clair',
    t0.ok === false && t0.statut === 'non_configure' && /Aucune clé/.test(t0.message), t0.message);
  const r0 = await places.rechercherPourCabinet(cab, 'Plomberie');
  test('recherche sans clé : statut non_configure, aucun résultat, pas d’exception',
    r0.statut === 'non_configure' && r0.resultats.length === 0);
  let errSansCle = null;
  try { await places.rechercherEntreprises('Plomberie', null); } catch (e) { errSansCle = e; }
  test('rechercherEntreprises sans clé : erreur codée non_configure',
    !!errSansCle && errSansCle.code === 'non_configure');

  // --- Réglage : enregistrement chiffré ------------------------------------------
  places.definirCleGoogle(cab, 1, BONNE_CLE);
  const ligne = bd.prepare('SELECT * FROM reglages_ia WHERE cabinet_id = ?').get(cab);
  test('réglage créé en base', !!ligne);
  test('la clé en base N EST PAS en clair', ligne.cle_google_chiffree !== BONNE_CLE && !ligne.cle_google_chiffree.includes(BONNE_CLE));
  test('format chiffré iv:tag:données', /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/.test(ligne.cle_google_chiffree));
  test('déchiffrement redonne la clé', chiffrement.dechiffrer(ligne.cle_google_chiffree) === BONNE_CLE);
  reg = places.obtenirReglageGoogle(cab);
  test('obtenirReglageGoogle : configurée, masque « •••• 1234 », jamais la clé',
    reg.configuree === true && reg.masque === '•••• •••• 1234' && !JSON.stringify(reg).includes(BONNE_CLE));
  const journalGoogle = bd.prepare("SELECT details FROM journal_audit WHERE action LIKE 'google_%'").all();
  test('journal : la clé n’apparaît dans AUCUN détail',
    journalGoogle.length >= 1 && journalGoogle.every((j) => !(j.details || '').includes(BONNE_CLE)));
  let errCourte = null;
  try { places.definirCleGoogle(cab, 1, 'abc'); } catch (e) { errCourte = e.message; }
  test('clé trop courte refusée', !!errCourte && /trop courte/.test(errCourte), errCourte);

  // --- Recherche texte : 2 résultats normalisés ------------------------------------
  const resultats = await places.rechercherEntreprises('Plomberie Saint-Laurent Montréal', BONNE_CLE);
  test('recherche : 2 résultats du harnais', resultats.length === 2, String(resultats.length));
  const p1 = resultats[0];
  test('normalisation : raison sociale', p1.raison_sociale === 'Plomberie Saint-Laurent inc.', p1.raison_sociale);
  test('normalisation : adresse = numéro + rue (composantes)', p1.adresse === '450 Rue des Érables', p1.adresse);
  test('normalisation : adresse complète conservée', p1.adresse_complete === '450 Rue des Érables, Montréal, QC H2T 1B5, Canada');
  test('normalisation : ville / province / code postal', p1.ville === 'Montréal' && p1.province === 'QC' && p1.code_postal === 'H2T 1B5',
    JSON.stringify({ v: p1.ville, p: p1.province, cp: p1.code_postal }));
  test('normalisation : téléphone national et site web',
    p1.telephone === '(514) 555-0142' && p1.site_web === 'https://plomberie-saint-laurent.example.ca/');
  test('normalisation : place_id, note, nb avis, statut',
    p1.place_id === 'ChIJ-TEST-PLOMBERIE-001' && p1.note === 4.7 && p1.nb_avis === 132 && p1.statut_affaires === 'OPERATIONAL');
  const p2 = resultats[1];
  test('résultat sans téléphone ni site : null (pas de plantage)', p2.telephone === null && p2.site_web === null && p2.ville === 'Laval');

  // --- Aucun résultat ------------------------------------------------------------------
  const vides = await places.rechercherEntreprises('AUCUNRESULTAT xyz', BONNE_CLE);
  test('recherche sans correspondance : liste vide', Array.isArray(vides) && vides.length === 0);

  // --- Détails ----------------------------------------------------------------------------
  const det = await places.detailsEntreprise('ChIJ-TEST-PLOMBERIE-001', BONNE_CLE);
  test('détails complets : mêmes coordonnées normalisées',
    det.place_id === 'ChIJ-TEST-PLOMBERIE-001' && det.adresse === '450 Rue des Érables' && det.code_postal === 'H2T 1B5' && det.telephone === '(514) 555-0142');
  const detSansTel = await places.detailsEntreprise('ChIJ-TEST-SANS-TEL', BONNE_CLE);
  test('détails sans téléphone : telephone = null, ville Laval', detSansTel.telephone === null && detSansTel.ville === 'Laval');
  const detCab = await places.detailsPourCabinet(cab, 'ChIJ-TEST-PLOMBERIE-001');
  test('detailsPourCabinet : statut ok avec la clé du cabinet', detCab.statut === 'ok' && detCab.entreprise.place_id === 'ChIJ-TEST-PLOMBERIE-001');

  // --- Clé invalide : erreur propre -----------------------------------------------------------
  let errCle = null;
  try { await places.rechercherEntreprises('Plomberie', 'MAUVAISE-CLE-TEST'); } catch (e) { errCle = e; }
  test('clé refusée (403) : message clair, pas de trace de la clé',
    !!errCle && /refusé la clé/.test(errCle.message) && !errCle.message.includes('MAUVAISE-CLE-TEST'), errCle && errCle.message);
  places.definirCleGoogle(cab, 1, 'MAUVAISE-CLE-TEST');
  const tBad = await places.testerConnexionGoogle(cab);
  test('testerConnexionGoogle avec mauvaise clé : ok=false expliqué', tBad.ok === false && /refusé la clé/.test(tBad.message), tBad.message);
  const rBad = await places.rechercherPourCabinet(cab, 'Plomberie');
  test('rechercherPourCabinet avec mauvaise clé : statut erreur + message, pas d’exception',
    rBad.statut === 'erreur' && /refusé/.test(rBad.message || ''));

  // --- Bonne clé via le réglage du cabinet ------------------------------------------------------
  places.definirCleGoogle(cab, 1, BONNE_CLE);
  const tOk = await places.testerConnexionGoogle(cab);
  test('testerConnexionGoogle avec la clé du cabinet : ok', tOk.ok === true && /réussie/.test(tOk.message), tOk.message);
  const rCab = await places.rechercherPourCabinet(cab, 'Plomberie Saint-Laurent');
  test('rechercherPourCabinet : statut ok, 2 résultats', rCab.statut === 'ok' && rCab.resultats.length === 2);

  // --- Retrait de la clé ------------------------------------------------------------------------------
  places.effacerCleGoogle(cab, 1);
  const ligne2 = bd.prepare('SELECT cle_google_chiffree FROM reglages_ia WHERE cabinet_id = ?').get(cab);
  test('clé retirée : colonne NULL en base', !!ligne2 && ligne2.cle_google_chiffree === null);
  test('après retrait : non configuré', places.obtenirReglageGoogle(cab).configuree === false);

  harnais.close();
  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
