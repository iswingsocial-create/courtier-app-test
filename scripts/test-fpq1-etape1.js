/**
 * scripts/test-fpq1-etape1.js — Couche données FPQ1 (étape 1/10) :
 * schéma, versionnage (règle d'or : rien ne se supprime, chaque modification
 * fige une version), conducteurs/véhicules illimités, garanties, antécédents,
 * archivage, cloisonnement inter-cabinets, journal d'audit.
 *
 * Teste la couche données directement (aucune route/UI à l'étape 1).
 * Prérequis : base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-fpq1.db node scripts/test-fpq1-etape1.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-fpq1.db';
const fs = require('fs');
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const fpq1 = require('../lib/fpq1');

let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

// --- Préparation : 2 cabinets, 1 admin chacun --------------------------------
const cab1 = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet A').lastInsertRowid;
const cab2 = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet B').lastInsertRowid;
const hash = bcrypt.hashSync('Test1234!', 4);
const admin1 = bd.prepare(
  `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
).run(cab1, 'admin1@t.ca', hash, 'Admin Un').lastInsertRowid;
const admin2 = bd.prepare(
  `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
).run(cab2, 'admin2@t.ca', hash, 'Admin Deux').lastInsertRowid;

console.log('== FPQ1 étape 1 : couche données + versionnage ==');

// 1. Création → v1, snapshot initial vide
const sId = fpq1.creerSoumission({ cabinetId: cab1, userId: admin1, dateEffetSouhaitee: '2026-11-01', notes: 'Test' });
test('création soumission → id', sId > 0);
let versions = fpq1.versionsSoumission(sId, cab1);
test('v1 créée à la création', versions.length === 1 && versions[0].version === 1, `n=${versions.length}`);
test('v1 : auteur renseigné', versions[0].auteur === 'Admin Un', versions[0].auteur);
const v1 = fpq1.obtenirVersion(sId, 1, cab1);
test('v1 : snapshot vide (0 conducteur, 0 véhicule)',
  v1 && v1.donnees.conducteurs.length === 0 && v1.donnees.vehicules.length === 0);
test('v1 : statut brouillon figé', v1.statut === 'brouillon');

// 2. Aucune limite : 5 conducteurs
const conds = [];
for (let i = 1; i <= 5; i++) {
  conds.push(fpq1.ajouterConducteur(sId, cab1, admin1, {
    nom: `Nom${i}`, prenom: `Prenom${i}`, sexe: i % 2 ? 'M' : 'F',
    numero_permis: `P${i}`, conducteur_principal: i === 1 ? 1 : 0,
    infractions: i === 2 ? [{ date: '2023-01-01', type: 'Excès de vitesse', points: 2 }] : [],
  }));
}
test('5 conducteurs ajoutés (aucune limite)', conds.length === 5 && new Set(conds).size === 5);
versions = fpq1.versionsSoumission(sId, cab1);
test('chaque ajout = 1 version (v6)', versions.length === 6 && versions[0].version === 6, `n=${versions.length}`);
const v6 = fpq1.obtenirVersion(sId, 6, cab1);
test('v6 : 5 conducteurs dans le snapshot', v6.donnees.conducteurs.length === 5);
test('v6 : infraction JSON conservée',
  v6.donnees.conducteurs[1].infractions[0].points === 2);

// 3. Aucune limite : 4 véhicules
const vehs = [];
const marques = [['2022', 'Honda', 'CR-V'], ['2019', 'Mazda', 'Mazda3'], ['2024', 'Toyota', 'RAV4'], ['2015', 'Ford', 'F-150']];
marques.forEach(([a, m, mo], i) => {
  vehs.push(fpq1.ajouterVehicule(sId, cab1, admin1, {
    annee: Number(a), marque: m, modele: mo, vin: `VIN000${i}`,
    financement: 'comptant', usage: 'promenade', conducteur_principal_id: conds[0],
  }));
});
test('4 véhicules ajoutés (aucune limite)', new Set(vehs).size === 4);
test('versions → v10', fpq1.versionsSoumission(sId, cab1)[0].version === 10);

// 4. Garanties par véhicule + upsert
const g1 = fpq1.definirGaranties(vehs[0], cab1, admin1, {
  rc_montant: 2000000, protection_b: 'b1', franchise_b: 500,
  avenants: { faq43_valeur_a_neuf: { option: 'A' } }, prime: 1450,
});
const g1b = fpq1.definirGaranties(vehs[0], cab1, admin1, {
  rc_montant: 2000000, protection_b: 'b1', franchise_b: 1000,
  avenants: { faq43_valeur_a_neuf: { option: 'A' } }, prime: 1500,
});
test('garanties : upsert = même id', g1 === g1b);
fpq1.definirGaranties(vehs[1], cab1, admin1, { rc_montant: 1000000, protection_b: 'b3', franchise_b: 1000 });
fpq1.definirGaranties(vehs[2], cab1, admin1, { rc_montant: 50000, protection_b: 'aucune' });
const s = fpq1.obtenirSoumission(sId, cab1);
test('garanties rattachées aux véhicules',
  s.vehicules[0].garanties.franchise_b === 1000 && s.vehicules[2].garanties.rc_montant === 50000);
test('versions → v14', fpq1.versionsSoumission(sId, cab1)[0].version === 14);

// 5. Antécédents + upsert
const a1 = fpq1.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Assureur X', annees_assurance_continue: 8,
  sinistres_6ans: [{ date: '2022-05-01', type: 'Collision', montant: 3200, responsabilite: 'responsable' }],
  consentements: { credit: { accepte: true, date: '2026-10-19' } },
});
const a1b = fpq1.definirAntecedents(sId, cab1, admin1, { assureur_actuel: 'Assureur Y', annees_assurance_continue: 9 });
test('antécédents : upsert = même id', a1 === a1b);
test('versions → v16', fpq1.versionsSoumission(sId, cab1)[0].version === 16);

// 6. Modification conducteur → version, état précédent figé
fpq1.modifierConducteur(conds[0], cab1, admin1, { nom: 'NouveauNom' });
const vAv = fpq1.obtenirVersion(sId, 16, cab1);
const vAp = fpq1.obtenirVersion(sId, 17, cab1);
test('modification conducteur → v17', vAp.version === 17);
test('v16 fige l\'ancien nom', vAv.donnees.conducteurs[0].nom === 'Nom1', vAv.donnees.conducteurs[0].nom);
test('v17 a le nouveau nom', vAp.donnees.conducteurs[0].nom === 'NouveauNom');

// 7. Archivage conducteur : pas de DELETE, snapshot cohérent
fpq1.archiverConducteur(conds[4], cab1, admin1);
const ligne = bd.prepare('SELECT archive FROM auto_conducteurs WHERE id = ?').get(conds[4]);
test('archivé, pas effacé (ligne toujours en base)', ligne && ligne.archive === 1);
const v18 = fpq1.obtenirVersion(sId, 18, cab1);
const v17b = fpq1.obtenirVersion(sId, 17, cab1);
test('v18 exclut l\'archivé du snapshot', v18.donnees.conducteurs.length === 4);
test('v17 conserve l\'archivé dans l\'historique', v17b.donnees.conducteurs.length === 5);
test('conducteur archivé invisible par défaut',
  fpq1.obtenirSoumission(sId, cab1).conducteurs.length === 4);
fpq1.desarchiverConducteur(conds[4], cab1, admin1);
test('désarchivage → visible à nouveau',
  fpq1.obtenirSoumission(sId, cab1).conducteurs.length === 5);
test('versions → v19', fpq1.versionsSoumission(sId, cab1)[0].version === 19);

// 8. Véhicule : modification + archivage + désarchivage
fpq1.modifierVehicule(vehs[3], cab1, admin1, { km_annuel: 25000 });
fpq1.archiverVehicule(vehs[3], cab1, admin1);
test('véhicule archivé invisible par défaut',
  fpq1.obtenirSoumission(sId, cab1).vehicules.length === 3);
const lv = bd.prepare('SELECT archive FROM auto_vehicules WHERE id = ?').get(vehs[3]);
test('véhicule archivé, pas effacé', lv && lv.archive === 1);
fpq1.desarchiverVehicule(vehs[3], cab1, admin1);
test('versions → v22', fpq1.versionsSoumission(sId, cab1)[0].version === 22);

// 9. Changement de statut → version ; statut invalide refusé
fpq1.changerStatutSoumission(sId, cab1, admin1, 'soumise');
test('statut soumise + version v23',
  fpq1.obtenirSoumission(sId, cab1).statut === 'soumise' &&
  fpq1.versionsSoumission(sId, cab1)[0].version === 23);
let invalide = false;
try { fpq1.changerStatutSoumission(sId, cab1, admin1, 'nimporte'); } catch { invalide = true; }
test('statut invalide refusé', invalide);
test('aucune version créée par le refus', fpq1.versionsSoumission(sId, cab1)[0].version === 23);

// 10. Historique : ordre, unicité, auteur
versions = fpq1.versionsSoumission(sId, cab1);
const nums = versions.map((v) => v.version);
test('23 versions, ordre DESC', versions.length === 23 && nums[0] === 23 && nums[22] === 1);
test('versions séquentielles sans trou', new Set(nums).size === 23 && Math.min(...nums) === 1);
test('auteur sur chaque version', versions.every((v) => v.auteur === 'Admin Un'));

// 11. Audit complet
const audits = bd.prepare(`SELECT action, COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action LIKE 'fpq1_%' GROUP BY action`).all(cab1);
const parAction = Object.fromEntries(audits.map((a) => [a.action, a.n]));
test('audit : 23 versions journalisées', parAction.fpq1_version === 23, JSON.stringify(parAction.fpq1_version));
test('audit : créations/modifications journalisées',
  (parAction.fpq1_soumission_creee === 1) && (parAction.fpq1_conducteur_ajoute === 5) &&
  (parAction.fpq1_vehicule_ajoute === 4));

// 12. Cloisonnement inter-cabinets
test('cabinet B ne voit pas la soumission', fpq1.obtenirSoumission(sId, cab2) === null);
test('cabinet B ne voit pas les versions', fpq1.versionsSoumission(sId, cab2).length === 0);
test('cabinet B ne peut pas modifier', fpq1.modifierConducteur(conds[0], cab2, admin2, { nom: 'X' }) === false);
test('cabinet B ne peut pas versionner', fpq1.creerVersionSoumission(sId, cab2, admin2) === null);
test('cabinet B ne peut pas changer le statut', fpq1.changerStatutSoumission(sId, cab2, admin2, 'soumise') === false);
test('aucune version créée par le cabinet B', fpq1.versionsSoumission(sId, cab1)[0].version === 23);

// 13. Contraintes CHECK (aucune donnée invalide en base)
let e1 = false; try { fpq1.ajouterConducteur(sId, cab1, admin1, { nom: 'X', prenom: 'Y', sexe: 'Z' }); } catch { e1 = true; }
test('sexe invalide rejeté', e1);
let e2 = false; try { fpq1.definirGaranties(vehs[1], cab1, admin1, { protection_b: 'b9' }); } catch { e2 = true; }
test('protection_b invalide rejetée', e2);
let e3 = false; try { fpq1.ajouterConducteur(sId, cab1, admin1, { nom: '', prenom: '' }); } catch { e3 = true; }
test('conducteur sans nom refusé', e3);
let e4 = false; try { fpq1.ajouterVehicule(99999, cab1, admin1, { marque: 'X' }); } catch { e4 = true; }
test('véhicule sur soumission inexistante refusé', e4);

// 14. Règle d'or : aucun DELETE métier dans la couche FPQ1
const src = fs.readFileSync(require.resolve('../lib/fpq1'), 'utf8');
test('aucun DELETE FROM dans lib/fpq1.js', !/DELETE\s+FROM/i.test(src));

// 15. Lister / filtres
const sId2 = fpq1.creerSoumission({ cabinetId: cab1, userId: admin1, notes: 'Deuxième' });
test('lister exclut les archives par défaut', fpq1.listerSoumissions(cab1).length === 2);
fpq1.archiverSoumission(sId2, cab1, admin1);
test('soumission archivée exclue', fpq1.listerSoumissions(cab1).length === 1);
test('filtre archives', fpq1.listerSoumissions(cab1, { inclureArchives: true }).length === 2);
test('filtre statut', fpq1.listerSoumissions(cab1, { statut: 'soumise' }).length === 1);
test('archiver n\'efface pas', bd.prepare('SELECT archive FROM auto_soumissions WHERE id = ?').get(sId2).archive === 1);
fpq1.desarchiverSoumission(sId2, cab1, admin1);
test('désarchiver restaure', fpq1.listerSoumissions(cab1).length === 2);

console.log(`\n${total - echecs}/${total} tests réussis`);
if (echecs > 0) { console.log('❌ ÉCHECS : ' + echecs); process.exit(1); }
console.log('🎉 TOUS LES TESTS PASSENT');
