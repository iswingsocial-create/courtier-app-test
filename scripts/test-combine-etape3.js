/**
 * scripts/test-combine-etape3.js — Étape 3/10 « Soumission combinée » :
 * questionnaire technique d'alarme par emplacement (biens_protections_alarme).
 * Couche données seulement (aucun serveur). Base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-combine3.db node scripts/test-combine-etape3.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-combine3.db';
const { execFileSync } = require('child_process');
const path = require('path');
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const biens = require('../lib/biens');
const combine = require('../lib/combine');

let echecs = 0, total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

const cab = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Alarme Test').lastInsertRowid;
const hash = bcrypt.hashSync('Test1234!', 4);
const admin = bd.prepare(
  `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
).run(cab, 'admin@alarme.ca', hash, 'Admin Alarme').lastInsertRowid;

console.log('== Étape 3/10 combinée — bloc alarme ==');

const sId = biens.creerSoumission({ cabinetId: cab, userId: admin });
const bId = biens.ajouterBatiment(sId, cab, admin, { adresse: '500 rue des Bijoux', ville: 'Montréal' });

test('aucune alarme au départ', combine.obtenirAlarme(bId, cab) === null);

// Définir le questionnaire complet
const aId = combine.definirAlarme(bId, cab, admin, {
  compagnie_alarme: 'Alarmes Sécur inc.', compagnie_telephone: '(514) 555-0199',
  compagnie_courriel: 'service@alarmes-secur.example', compagnie_contact: 'Sylvie Garde',
  transmission_primaire: ['Internet (IP)', 'Cellulaire'],
  transmission_primaire_fabricant: 'DSC', transmission_primaire_modele: 'TL280',
  transmission_secondaire: ['GSM/GPRS/CDMA'],
  securite_ligne: 1, taux_interrogation: '5 minutes', centrale_nom_lieu: 'Centrale Sécur — Montréal',
  couverture_detection: ['Tout le local', 'Coffres / chambre forte'],
  dispositifs_perimetre: 'Contacts sur toutes les portes et fenêtres',
  protection_coffres: ['Contact de porte', 'Détecteur de vibration (EVD)'],
  repondants: ['Abonné', 'Service de garde'], reponse_en_personne: 1,
  signaux_ouverture_fermeture: 'surveilles', contrat_entretien_annuel: 1,
  certificat_ulc_actif: 1, certificat_ulc_numero: 'ULC-2026-0451', certificat_ulc_expiration: '2027-03-31',
  cameras_detail: { presente: 1, enregistre_24h: 1, exterieures: 1 },
  protections_physiques: ['Pêne dormant', 'Rideaux ou portes d\u2019acier', 'Glaces incassables'],
  coffre_detail: { fabricant: 'Gardall', modele: 'GF-2040', cote: 'TL-15', boulonne: 1 },
});
test('alarme définie → id', aId > 0);

const a = combine.obtenirAlarme(bId, cab);
test('compagnie et centrale relues', a.compagnie_alarme === 'Alarmes Sécur inc.' && a.centrale_nom_lieu.includes('Montréal'));
test('transmissions relues en listes', Array.isArray(a.transmission_primaire)
  && a.transmission_primaire.length === 2 && a.transmission_primaire[0] === 'Internet (IP)');
test('couverture et répondants relus', a.couverture_detection.includes('Coffres / chambre forte')
  && a.repondants.includes('Service de garde'));
test('ULC relu (actif, numéro, expiration)', a.certificat_ulc_actif === 1
  && a.certificat_ulc_numero === 'ULC-2026-0451' && a.certificat_ulc_expiration === '2027-03-31');
test('caméras et protections physiques relues', a.cameras_detail.enregistre_24h === 1
  && a.protections_physiques.includes('Glaces incassables'));
test('coffre — détail relu', a.coffre_detail.fabricant === 'Gardall' && a.coffre_detail.boulonne === 1);

// Mise à jour (upsert, pas de doublon)
combine.definirAlarme(bId, cab, admin, { centrale_nom_lieu: 'Centrale Sécur — Laval', certificat_ulc_actif: 0 });
const nb = bd.prepare('SELECT COUNT(*) AS n FROM biens_protections_alarme WHERE batiment_id = ?').get(bId).n;
test('mise à jour sans doublon (UNIQUE par bâtiment)', nb === 1);
const a2 = combine.obtenirAlarme(bId, cab);
test('mise à jour relue, autres champs réinitialisés par l\u2019appelant seulement',
  a2.centrale_nom_lieu === 'Centrale Sécur — Laval');

// Cloisonnement
const cab2 = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Voisin').lastInsertRowid;
test('cloisonnement : invisible depuis un autre cabinet', combine.obtenirAlarme(bId, cab2) === null);
let rejete = false;
try { combine.definirAlarme(bId, cab2, admin, {}); } catch (e) { rejete = true; }
test('écriture depuis un autre cabinet rejetée', rejete);

// Listes de référence exposées
test('listes du questionnaire exposées', combine.TRANSMISSIONS.length === 8
  && combine.PROTECTIONS_PHYSIQUES.length === 16 && combine.COUVERTURES_DETECTION.length === 5);

// Dictionnaire
const sortie = execFileSync('node', [path.join(__dirname, 'generer-dictionnaire.js')], {
  encoding: 'utf8', env: { ...process.env, CHEMIN_BD: process.env.CHEMIN_BD },
});
test('dictionnaire complet et cohérent — état final (88 tables, 1199 colonnes)',
  /88 tables, 1199 colonnes/.test(sortie), sortie.trim().slice(0, 120));

console.log(`\n${total - echecs}/${total} tests réussis`);
if (echecs) { console.log(`💥 ${echecs} échec(s)`); process.exit(1); }
console.log('🎉 TOUS LES TESTS PASSENT');
