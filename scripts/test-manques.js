/**
 * scripts/test-manques.js — Boucle courriel, étape 1/5 : détection des
 * informations manquantes d'une soumission (lib/manques.js).
 *
 * Soumissions semées incomplètes de plusieurs produits → manques attendus
 * présents (clés stables, niveaux, libellés d'éléments, questions FR
 * contextualisées) ; soumission complète → zéro manque.
 * Suite MODÈLE : aucune route, aucun serveur. Base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-manques.db node scripts/test-manques.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-manques.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const manques = require('../lib/manques');
const biens = require('../lib/biens');
const flotte = require('../lib/flotte');
const cyber = require('../lib/cyber');
const eo = require('../lib/eo');
const cautionnement = require('../lib/cautionnement');

let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

const cab1 = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Manques').lastInsertRowid;
const hash = bcrypt.hashSync('Test1234!', 4);
const admin1 = bd.prepare(
  "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, 'admin@manques.ca', ?, 'admin', 'Admin Manques')"
).run(cab1, hash).lastInsertRowid;
const client1 = bd.prepare(
  "INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel) VALUES (?, ?, '', '', ?)"
).run(cab1, 'Garage Test inc.', 'info@garagetest.ca').lastInsertRowid;

const cles = (liste) => liste.map((m) => m.cle);
const aCle = (liste, cle) => liste.some((m) => m.cle === cle);

console.log('== Boucle courriel — étape 1 : détection des manques ==');

// --- 1. Biens incomplet -------------------------------------------------------
console.log('1. Biens incomplet');
const sb = biens.creerSoumission({ cabinetId: cab1, userId: admin1, clientId: client1, notes: 'Incomplet' });
const bat = biens.ajouterBatiment(sb, cab1, admin1, { adresse: '1200 boul. Industriel', ville: 'Laval' });
let s = biens.obtenirSoumission(sb, cab1);
let ms = manques.calculerManques('biens', s);
test('entête : date d\u2019effet manquante détectée', aCle(ms, 'entete:date_effet_souhaitee'));
for (const champ of ['type_construction', 'superficie_pi2', 'nb_etages', 'gicleurs', 'chauffage', 'annee_toiture', 'distance_caserne_km']) {
  test(`bâtiment : ${champ} manquant détecté`, aCle(ms, `liste:batiments:${bat}:${champ}`));
}
test('bâtiment : aucun contenu → question contenus', aCle(ms, `liste:batiments:${bat}:contenus`));
test('bâtiment : garanties absentes → question', aCle(ms, `garanties:batiments:${bat}`));
test('antécédents absents → questions de confirmation', aCle(ms, 'antecedents:absents') && aCle(ms, 'antecedents:assureur_actuel'));
const qGicleurs = ms.find((m) => m.cle === `liste:batiments:${bat}:gicleurs`);
test('question gicleurs contextualisée (adresse + ville + sprinkler)',
  qGicleurs && /1200 boul\. Industriel/.test(qGicleurs.question) && /Laval/.test(qGicleurs.question) && /gicleurs/i.test(qGicleurs.question),
  qGicleurs && qGicleurs.question);
test('manque structuré : niveau + element + libellé',
  qGicleurs && qGicleurs.niveau === 'liste' && qGicleurs.element.type === 'batiments'
  && qGicleurs.element.id === bat && qGicleurs.libelle === 'Gicleurs');
test('chaque manque a une question non vide et une clé unique',
  ms.every((m) => m.question && m.question.length > 10) && new Set(cles(ms)).size === ms.length);

// --- 2. Biens complété pas à pas ----------------------------------------------
console.log('2. Biens complété');
biens.modifierBatiment(bat, cab1, admin1, {
  type_construction: 'acier', superficie_pi2: 12000, nb_etages: 2, gicleurs: 1,
  chauffage: 'gaz', annee_toiture: 2019, distance_caserne_km: 3.5, code_postal: 'H7M 2H6',
  annee_construction: 1998, occupation: 'Garage', valeur_batiment: 850000,
});
biens.ajouterContenu(sb, cab1, admin1, { description: 'Équipements de garage', type_contenu: 'equipements', valeur: 200000 }, bat);
biens.definirGaranties(bat, cab1, admin1, { formule: 'tous_risques', montant_assurance: 850000, franchise: 1000, prime: 4200 });
biens.definirAntecedents(sb, cab1, admin1, {
  assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'BIE-2025-100',
  date_expiration_actuelle: '2026-11-30', annees_assurance_continue: 5, sinistres_5ans: [],
});
bd.prepare("UPDATE biens_soumissions SET date_effet_souhaitee = '2026-12-01' WHERE id = ?").run(sb);
s = biens.obtenirSoumission(sb, cab1);
ms = manques.calculerManques('biens', s);
test('soumission biens complète → zéro manque', ms.length === 0, cles(ms).join(', '));

// --- 3. Flotte : conducteur incomplet + antécédents absents -------------------
console.log('3. Flotte');
const sf = flotte.creerSoumission({ cabinetId: cab1, userId: admin1, clientId: client1, assureur: 'Intact Assurance' });
const cond = flotte.ajouterConducteur(sf, cab1, admin1, { nom: 'Tremblay', prenom: 'Sophie' });
const veh = flotte.ajouterVehicule(sf, cab1, admin1, { niv: '2T1BURHE8JC045678', marque: 'Toyota', annee: 2020 });
s = flotte.obtenirSoumission(sf, cab1);
ms = manques.calculerManques('flotte', s);
for (const champ of ['date_naissance', 'numero_permis', 'classe_permis', 'annees_experience', 'date_embauche']) {
  test(`conducteur : ${champ} manquant`, aCle(ms, `liste:conducteurs:${cond}:${champ}`));
}
test('véhicule : valeur et usage manquants', aCle(ms, `liste:vehicules:${veh}:valeur`) && aCle(ms, `liste:vehicules:${veh}:usage`));
test('garanties flotte absentes', aCle(ms, 'garanties:absentes'));
const qFlotte = ms.find((m) => m.cle === 'antecedents:absents');
test('question antécédents flotte = texte de confirmation sinistres/infractions',
  qFlotte && /sinistres des 5 dernières années/.test(qFlotte.question) && /infractions des 3 dernières années/.test(qFlotte.question),
  qFlotte && qFlotte.question);
const qPermis = ms.find((m) => m.cle === `liste:conducteurs:${cond}:numero_permis`);
test('question permis contextualisée (nom du conducteur)',
  qPermis && /Sophie Tremblay/.test(qPermis.question), qPermis && qPermis.question);

// --- 4. Cyber : mesures clés absentes ------------------------------------------
console.log('4. Cyber');
const sc = cyber.creerSoumission({ cabinetId: cab1, userId: admin1, clientId: client1, dateEffetSouhaitee: '2026-12-01' });
cyber.definirGaranties(sc, cab1, admin1, { limite_par_sinistre: 1000000, limite_agregat: 1000000, franchise: 1000, prime: 3000 });
s = cyber.obtenirSoumission(sc, cab1);
ms = manques.calculerManques('cyber', s);
test('mesures clés absentes → 3 questions (mfa, sauvegardes, antivirus_edr)',
  aCle(ms, 'liste:mesures:absente:mfa') && aCle(ms, 'liste:mesures:absente:sauvegardes') && aCle(ms, 'liste:mesures:absente:antivirus_edr'));
test('délai de carence manquant → question partielle', aCle(ms, 'garanties:delai_carence'));
cyber.ajouterMesure(sc, cab1, admin1, { type_mesure: 'mfa', statut: 'en_place', details: 'Microsoft 365' });
s = cyber.obtenirSoumission(sc, cab1);
ms = manques.calculerManques('cyber', s);
test('mesure MFA ajoutée → sa question disparaît, les autres restent',
  !aCle(ms, 'liste:mesures:absente:mfa') && aCle(ms, 'liste:mesures:absente:sauvegardes'));

// --- 5. E&O : circonstances (question piège) ------------------------------------
console.log('5. E&O');
const se = eo.creerSoumission({ cabinetId: cab1, userId: admin1, clientId: client1, dateEffetSouhaitee: '2026-12-01' });
eo.definirGaranties(se, cab1, admin1, { limite_par_sinistre: 1000000, limite_agregat: 1000000, franchise: 5000, base: 'reclamations_presentees', prime: 6000 });
eo.definirAntecedents(se, cab1, admin1, { assureur_actuel: 'Beneva', reclamations_5ans: [] });
s = eo.obtenirSoumission(se, cab1);
ms = manques.calculerManques('eo', s);
test('antécédents présents mais circonstances vides → question piège', aCle(ms, 'antecedents:circonstances'));
test('bloc antécédents présent → pas de question « absents »', !aCle(ms, 'antecedents:absents'));

// --- 6. Cautionnement : finances de la ligne -------------------------------------
console.log('6. Cautionnement');
const sca = cautionnement.creerSoumission({ cabinetId: cab1, userId: admin1, clientId: client1, dateEffetSouhaitee: '2026-12-01' });
cautionnement.definirGaranties(sca, cab1, admin1, { limite_globale: 5000000, limite_par_projet: 2500000, prime: 7500 });
s = cautionnement.obtenirSoumission(sca, cab1);
ms = manques.calculerManques('cautionnement', s);
test('ligne sans fonds de roulement ni valeur nette → 2 questions financières',
  aCle(ms, 'garanties:fonds_roulement') && aCle(ms, 'garanties:valeur_nette'));

console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
process.exit(echecs ? 1 : 0);
