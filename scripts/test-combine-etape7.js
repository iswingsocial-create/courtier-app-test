/**
 * scripts/test-combine-etape7.js — Étape 7/10 « Soumission combinée » :
 * bénéficiaires/créanciers par emplacement et assurés additionnels
 * réutilisables. Couche données seulement. Base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-combine7.db node scripts/test-combine-etape7.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-combine7.db';
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

const cab = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Bénéficiaires Test').lastInsertRowid;
const hash = bcrypt.hashSync('Test1234!', 4);
const admin = bd.prepare(
  `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
).run(cab, 'admin@beneficiaires.ca', hash, 'Admin Bénéficiaires').lastInsertRowid;

console.log('== Étape 7/10 combinée — bénéficiaires et assurés additionnels ==');

const sId = biens.creerSoumission({ cabinetId: cab, userId: admin });
const bId = biens.ajouterBatiment(sId, cab, admin, { adresse: '77 rue du Port', ville: 'Trois-Rivières' });

const ben1 = combine.ajouterBeneficiaire(bId, cab, admin, {
  nom: 'Banque Exemple du Canada', adresse: '1000 boul. des Forges', ville: 'Trois-Rivières',
  code_postal: 'G9A 0A0', qualite: 'Créancier hypothécaire', clause_preavis: '30 jours',
});
const ben2 = combine.ajouterBeneficiaire(bId, cab, admin, { nom: 'Fiducie Familiale Exemple' });
test('bénéficiaires ajoutés', ben1 > 0 && ben2 > 0);
const liste = combine.listerBeneficiaires(bId, cab);
test('bénéficiaires relus (qualité + clause de préavis)',
  liste.length === 2 && liste[0].qualite === 'Créancier hypothécaire' && liste[0].clause_preavis === '30 jours');
combine.archiverBeneficiaire(ben2, cab, admin);
test('archivage doux du bénéficiaire', combine.listerBeneficiaires(bId, cab).length === 1);
let rejete = false;
try { combine.ajouterBeneficiaire(bId, cab, admin, { nom: '' }); } catch (e) { rejete = true; }
test('nom de bénéficiaire requis', rejete);
const cab2 = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Voisin').lastInsertRowid;
test('cloisonnement : bénéficiaires invisibles depuis un autre cabinet',
  combine.listerBeneficiaires(bId, cab2).length === 0);

// Assurés additionnels — mécanisme générique sur les 4 types de dossier
const aa1 = combine.ajouterAssureAdditionnel('biens', sId, cab, admin, {
  nom: 'Gestion Immobilière Exemple inc.', interet: 'Gestionnaire de l\u2019immeuble',
});
const aa2 = combine.ajouterAssureAdditionnel('combine', 4242, cab, admin, {
  nom: 'Copropriétaire Exemple', adresse: '77 rue du Port, unité 204',
});
test('assurés additionnels ajoutés (biens + combiné)', aa1 > 0 && aa2 > 0);
test('assurés additionnels relus par dossier',
  combine.listerAssuresAdditionnels('biens', sId, cab).length === 1
  && combine.listerAssuresAdditionnels('combine', 4242, cab)[0].nom === 'Copropriétaire Exemple'
  && combine.listerAssuresAdditionnels('rc', sId, cab).length === 0);
combine.archiverAssureAdditionnel(aa1, cab, admin);
test('archivage doux de l\u2019assuré additionnel',
  combine.listerAssuresAdditionnels('biens', sId, cab).length === 0);
rejete = false;
try { combine.ajouterAssureAdditionnel('fpq1', sId, cab, admin, { nom: 'X' }); } catch (e) { rejete = true; }
test('type de dossier invalide rejeté (mécanisme hors FPQ1)', rejete);

// Dictionnaire
const sortie = execFileSync('node', [path.join(__dirname, 'generer-dictionnaire.js')], {
  encoding: 'utf8', env: { ...process.env, CHEMIN_BD: process.env.CHEMIN_BD },
});
test('dictionnaire complet et cohérent — état final (88 tables, 1199 colonnes)',
  /88 tables, 1199 colonnes/.test(sortie), sortie.trim().slice(0, 120));

console.log(`\n${total - echecs}/${total} tests réussis`);
if (echecs) { console.log(`💥 ${echecs} échec(s)`); process.exit(1); }
console.log('🎉 TOUS LES TESTS PASSENT');
