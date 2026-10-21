/**
 * scripts/test-combine-etape5.js — Étape 5/10 « Soumission combinée » :
 * RC complétée (préjudice personnel/publicité, frais médicaux, responsabilité
 * locative, auto non-propriétaires, umbrella) et Perte d'exploitation
 * complétée (formule, règle proportionnelle, honoraires de comptables,
 * montant PE par établissement). Couche données seulement. Base FRAÎCHE.
 * Usage : CHEMIN_BD=/tmp/test-combine5.db node scripts/test-combine-etape5.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-combine5.db';
const { execFileSync } = require('child_process');
const path = require('path');
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const rc = require('../lib/rc');
const pe = require('../lib/pe');

let echecs = 0, total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

const cab = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet RC-PE Test').lastInsertRowid;
const hash = bcrypt.hashSync('Test1234!', 4);
const admin = bd.prepare(
  `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
).run(cab, 'admin@rcpe.ca', hash, 'Admin RC-PE').lastInsertRowid;

console.log('== Étape 5/10 combinée — RC et Perte complétées ==');

// --- RC
const sRc = rc.creerSoumission({ cabinetId: cab, userId: admin });
const lieuId = rc.ajouterExploitation(sRc, cab, admin, { adresse: '12 rue Principale', ville: 'Québec' });
rc.definirGaranties(lieuId, cab, admin, {
  formule: 'globale', limite_par_sinistre: 2000000, limite_agregat: 5000000, franchise: 1000,
  prejudice_personnel_publicite: 2000000,
  frais_medicaux_par_personne: 25000, frais_medicaux_par_sinistre: 50000,
  responsabilite_locative: 500000, rc_auto_non_proprietaires: 2000000,
  umbrella_montant: 5000000, umbrella_retention: 10000,
  umbrella_polices_base: ['RC générale', 'Biens — RC locative'],
  produits_travaux_termines_montant: 2000000, pollution_montant: 1000000,
  avenants: { pollution: 1 },
});
const sr = rc.obtenirSoumission(sRc, cab);
const g = sr.exploitations[0].garanties;
test('RC : préjudice personnel/publicité relu', g.prejudice_personnel_publicite === 2000000);
test('RC : frais médicaux par personne / par sinistre relus',
  g.frais_medicaux_par_personne === 25000 && g.frais_medicaux_par_sinistre === 50000);
test('RC : responsabilité locative et auto non-propriétaires relues',
  g.responsabilite_locative === 500000 && g.rc_auto_non_proprietaires === 2000000);
test('RC : umbrella montant + rétention + polices de base relus',
  g.umbrella_montant === 5000000 && g.umbrella_retention === 10000
  && Array.isArray(g.umbrella_polices_base) && g.umbrella_polices_base.length === 2);
test('RC : produits/travaux terminés et pollution relus',
  g.produits_travaux_termines_montant === 2000000 && g.pollution_montant === 1000000);
test('RC : garanties historiques intactes', g.limite_par_sinistre === 2000000 && g.avenants.pollution === 1);

// Mise à jour via le nouvel upsert dynamique
rc.definirGaranties(lieuId, cab, admin, { limite_par_sinistre: 3000000, umbrella_montant: null });
const g2 = rc.obtenirSoumission(sRc, cab).exploitations[0].garanties;
test('RC : mise à jour relue (umbrella effacé proprement)',
  g2.limite_par_sinistre === 3000000 && g2.umbrella_montant === null);

// --- Perte d'exploitation
const sPe = pe.creerSoumission({ cabinetId: cab, userId: admin });
const etabId = pe.ajouterEtablissement(sPe, cab, admin, {
  nom_lieu: 'Magasin principal', adresse: '12 rue Principale', montant_pe: 250000,
});
pe.definirGaranties(sPe, cab, admin, {
  limite: 500000, periode_indemnite_mois: 18, franchise_jours: 3, base_montant: 'benefice_brut',
  formule: 'benefice_brut', regle_proportionnelle: 90, honoraires_comptables: 25000,
});
const sp = pe.obtenirSoumission(sPe, cab);
test('PE : formule bénéfice brut relue', sp.garanties.formule === 'benefice_brut');
test('PE : règle proportionnelle et honoraires de comptables relus',
  sp.garanties.regle_proportionnelle === 90 && sp.garanties.honoraires_comptables === 25000);
test('PE : montant PE propre à l\u2019établissement relu',
  sp.etablissements[0].montant_pe === 250000);
test('PE : garanties historiques intactes', sp.garanties.limite === 500000 && sp.garanties.periode_indemnite_mois === 18);
let rejete = false;
try { pe.definirGaranties(sPe, cab, admin, { formule: 'bidon' }); } catch (e) { rejete = /invalide/i.test(e.message); }
test('PE : formule inconnue rejetée', rejete);
rejete = false;
try { pe.definirGaranties(sPe, cab, admin, { regle_proportionnelle: 150 }); } catch (e) { rejete = true; }
test('PE : règle proportionnelle > 100 % rejetée', rejete);

// Dictionnaire
const sortie = execFileSync('node', [path.join(__dirname, 'generer-dictionnaire.js')], {
  encoding: 'utf8', env: { ...process.env, CHEMIN_BD: process.env.CHEMIN_BD },
});
test('dictionnaire complet et cohérent — état final (88 tables, 1199 colonnes)',
  /88 tables, 1199 colonnes/.test(sortie), sortie.trim().slice(0, 120));

console.log(`\n${total - echecs}/${total} tests réussis`);
if (echecs) { console.log(`💥 ${echecs} échec(s)`); process.exit(1); }
console.log('🎉 TOUS LES TESTS PASSENT');
