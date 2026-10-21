/**
 * scripts/harnais-places.js — Harnais HTTP autonome « Google Places » pour
 * les captures et les essais manuels : sert les mêmes JSON figés que les
 * suites de test (AUCUN appel réel à Google). Le serveur d'application
 * doit être lancé avec PLACES_BASE_URL=http://127.0.0.1:4199/v1.
 * Usage : node scripts/harnais-places.js [port]
 */
const http = require('http');
const PORT = Number(process.argv[2] || process.env.PORT_HARNAIS || 4199);

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
  regularOpeningHours: { weekdayDescriptions: ['lundi: 08:00 – 17:00'] },
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

http.createServer((req, res) => {
  let corps = '';
  req.on('data', (c) => { corps += c; });
  req.on('end', () => {
    const envoyer = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers['x-goog-api-key'] === 'MAUVAISE-CLE-TEST') {
      return envoyer(403, { error: { code: 403, message: 'API key not valid.', status: 'PERMISSION_DENIED' } });
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
    return envoyer(404, { error: { code: 404, message: 'Route inconnue.', status: 'NOT_FOUND' } });
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Harnais Places (JSON figés) sur http://127.0.0.1:${PORT}/v1`);
});
