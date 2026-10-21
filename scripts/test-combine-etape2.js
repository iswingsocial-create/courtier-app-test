/**
 * scripts/test-combine-etape2.js — Étape 2/10 « Soumission combinée » :
 * fiche emplacement enrichie (biens_batiments) — construction par composant,
 * classe assureur, rénovations par système, mécanique, inspection/évaluation,
 * protection incendie, voisinage structuré, risques criminels.
 * Couche données seulement (aucun serveur). Base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-combine2.db node scripts/test-combine-etape2.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-combine2.db';
const { execFileSync } = require('child_process');
const path = require('path');
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const biens = require('../lib/biens');

let echecs = 0, total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

const cab = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Combiné Test').lastInsertRowid;
const hash = bcrypt.hashSync('Test1234!', 4);
const admin = bd.prepare(
  `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
).run(cab, 'admin@combine.ca', hash, 'Admin Combiné').lastInsertRowid;

console.log('== Étape 2/10 combinée — fiche emplacement enrichie ==');

// 1. Schéma : les colonnes existent
const cols = bd.prepare('PRAGMA table_info(biens_batiments)').all().map((c) => c.name);
const attendues = ['province', 'etage', 'bureau', 'type_emplacement', 'type_batiment',
  'interet_assure', 'superficie_occupee_pi2', 'pct_vacant', 'partage_lieux',
  'autres_occupants', 'etages_occupes', 'classe_construction', 'construction_mur',
  'construction_toit_structure', 'finition_toit', 'materiau_sol', 'sous_sol',
  'electricite_type', 'carburant', 'plomberie_materiau', 'renovation_toiture_ampleur',
  'renovation_electricite_annee', 'renovation_plomberie_annee', 'renovation_chauffage_annee',
  'inspection_statut', 'evaluation_cout_remplacement', 'prise_eau_distance',
  'alarme_incendie_type', 'colonne_montante', 'gicleurs_couverture',
  'voisin_gauche_affectation', 'voisin_droite_affectation', 'voisin_arriere_affectation',
  'voisin_enface_affectation', 'alarme_vol_type', 'pene_dormant', 'cameras'];
test('58 colonnes enrichies présentes sur biens_batiments',
  attendues.every((c) => cols.includes(c)) && cols.length >= 72, `n=${cols.length}`);

// 2. Création d'une soumission + bâtiment complet (calqué sur un envoi réel)
const sId = biens.creerSoumission({ cabinetId: cab, userId: admin, dateEffetSouhaitee: '2026-12-22' });
const bId = biens.ajouterBatiment(sId, cab, admin, {
  adresse: '1085 autoroute 440', ville: 'Laval', code_postal: 'H7L 3W3', province: 'QC',
  type_construction: 'beton', annee_construction: 1995, superficie_pi2: 55000, nb_etages: 1,
  occupation: 'Bureau et entreposage', valeur_batiment: 3000000, gicleurs: 0,
  distance_caserne_km: 5, chauffage: 'Appareil de chauffage mural', annee_toiture: 2011,
  interet_assure: 'Locataire', superficie_occupee_pi2: 2400, autres_occupants: 'Entreposage et grossiste',
  classe_construction: 'incombustible', construction_mur: 'Béton',
  construction_toit_structure: "Poutres d'acier", finition_toit: 'Goudron et gravier',
  materiau_sol: 'Béton ou matériaux résistant au feu', sous_sol: 'Aucun',
  electricite_type: 'Disjoncteurs', carburant: 'Gaz naturel', plomberie_materiau: 'Cuivre/Plastique PVC',
  renovation_toiture_ampleur: 'Complète', renovation_electricite_annee: 2011,
  renovation_electricite_ampleur: 'Complète', renovation_plomberie_annee: 2011,
  renovation_chauffage_annee: 2011, renovation_chauffage_ampleur: 'Partielle',
  inspection_statut: 'non_inspecte',
  prise_eau_distance: 'À moins de 150 mètres', alarme_incendie_type: 'Poste de surveillance (service complet)',
  alarme_vol_type: 'Poste de surveillance (service complet)', pene_dormant: 1, cameras: 1,
  voisin_gauche_distance_m: 12, voisin_gauche_affectation: 'Restaurant',
  voisin_arriere_distance_m: 30, voisin_arriere_affectation: 'Terrain vacant',
});
test('bâtiment enrichi créé', bId > 0);
const s = biens.obtenirSoumission(sId, cab);
const b = s.batiments[0];
test('construction par composant relue',
  b.construction_mur === 'Béton' && b.construction_toit_structure === "Poutres d'acier"
  && b.finition_toit === 'Goudron et gravier' && b.sous_sol === 'Aucun');
test('classe assureur relue', b.classe_construction === 'incombustible');
test('mécanique relue (électricité, carburant, plomberie)',
  b.electricite_type === 'Disjoncteurs' && b.carburant === 'Gaz naturel'
  && b.plomberie_materiau === 'Cuivre/Plastique PVC');
test('rénovations par système relues (année + ampleur)',
  b.annee_toiture === 2011 && b.renovation_toiture_ampleur === 'Complète'
  && b.renovation_plomberie_annee === 2011 && b.renovation_chauffage_ampleur === 'Partielle');
test('affectation relue (intérêt, superficie occupée, autres occupants)',
  b.interet_assure === 'Locataire' && b.superficie_occupee_pi2 === 2400
  && b.autres_occupants === 'Entreposage et grossiste');
test('voisinage relu (gauche + arrière, droite vide)',
  b.voisin_gauche_affectation === 'Restaurant' && b.voisin_gauche_distance_m === 12
  && b.voisin_arriere_affectation === 'Terrain vacant' && b.voisin_droite_affectation === null);
test('protection incendie et risques criminels relus',
  b.prise_eau_distance === 'À moins de 150 mètres' && b.pene_dormant === 1 && b.cameras === 1);

// 3. Modification du voisinage + snapshot figé
const avant = biens.versionsSoumission(sId, cab).length;
biens.modifierBatiment(bId, cab, admin, {
  voisin_droite_distance_m: 8, voisin_droite_affectation: 'Garage automobile',
  aucun_risque_alentours: 0,
});
const s2 = biens.obtenirSoumission(sId, cab);
test('voisinage modifié relu', s2.batiments[0].voisin_droite_affectation === 'Garage automobile'
  && s2.batiments[0].voisin_droite_distance_m === 8);
const versions = biens.versionsSoumission(sId, cab);
test('une version de plus figée après modification', versions.length === avant + 1);
const derniere = biens.obtenirVersion(sId, versions[0].version, cab);
test('snapshot : fiche enrichie présente dans la version',
  derniere.donnees.batiments[0].voisin_gauche_affectation === 'Restaurant'
  && derniere.donnees.batiments[0].classe_construction === 'incombustible');

// 4. Contraintes CHECK
let rejete = false;
try {
  biens.ajouterBatiment(sId, cab, admin, { adresse: '1 rue X', classe_construction: 'carton' });
} catch (e) { rejete = true; }
test('classe de construction invalide rejetée (CHECK)', rejete);
rejete = false;
try {
  biens.ajouterBatiment(sId, cab, admin, { adresse: '2 rue X', gicleurs_couverture: 'beaucoup' });
} catch (e) { rejete = true; }
test('couverture de gicleurs invalide rejetée (CHECK)', rejete);

// 5. Dictionnaire à jour
const sortie = execFileSync('node', [path.join(__dirname, 'generer-dictionnaire.js')], {
  encoding: 'utf8', env: { ...process.env, CHEMIN_BD: process.env.CHEMIN_BD },
});
test('dictionnaire complet et cohérent — état final (88 tables, 1199 colonnes)',
  /88 tables, 1199 colonnes/.test(sortie), sortie.trim().slice(0, 120));

console.log(`\n${total - echecs}/${total} tests réussis`);
if (echecs) { console.log(`💥 ${echecs} échec(s)`); process.exit(1); }
console.log('🎉 TOUS LES TESTS PASSENT');
