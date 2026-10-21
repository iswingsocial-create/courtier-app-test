/**
 * scripts/test-biens-etape1.js — Couche données « biens commerciaux » (étape 1/10 biens) :
 * schéma, versionnage (règle d'or : rien ne se supprime, chaque modification
 * fige une version), bâtiments/contenus illimités, garanties, antécédents,
 * archivage, cloisonnement inter-cabinets, journal d'audit.
 *
 * Teste la couche données directement (aucune route/UI à l'étape 1).
 * Prérequis : base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-biens1.db node scripts/test-biens-etape1.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-biens1.db';
const fs = require('fs');
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const biens = require('../lib/biens');

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

console.log('== Biens étape 1 : couche données + versionnage ==');

// 1. Création → v1, snapshot initial vide
const sId = biens.creerSoumission({ cabinetId: cab1, userId: admin1, dateEffetSouhaitee: '2026-12-01', notes: 'Test' });
test('création soumission → id', sId > 0);
let versions = biens.versionsSoumission(sId, cab1);
test('v1 créée à la création', versions.length === 1 && versions[0].version === 1, `n=${versions.length}`);
test('v1 : auteur renseigné', versions[0].auteur === 'Admin Un', versions[0].auteur);
const v1 = biens.obtenirVersion(sId, 1, cab1);
test('v1 : snapshot vide (0 bâtiment, 0 contenu)',
  v1 && v1.donnees.batiments.length === 0 && v1.donnees.contenus_generaux.length === 0);
test('v1 : statut brouillon figé', v1.statut === 'brouillon');

// 2. Aucune limite : 5 bâtiments
const bats = [];
const occupations = ['Atelier', 'Entrepôt', 'Bureau', 'Commerce de détail', 'Restaurant'];
for (let i = 1; i <= 5; i++) {
  bats.push(biens.ajouterBatiment(sId, cab1, admin1, {
    adresse: `${100 * i} rue Test`, ville: 'Montréal', code_postal: `H1A 1A${i}`,
    type_construction: i % 2 ? 'acier' : 'beton', annee_construction: 1990 + i,
    superficie_pi2: 1000 * i, nb_etages: i % 3 + 1, occupation: occupations[i - 1],
    valeur_batiment: 500000 * i, gicleurs: i % 2, distance_caserne_km: 1.5,
    chauffage: 'Gaz naturel', annee_toiture: 2015 + i,
  }));
}
test('5 bâtiments ajoutés (aucune limite)', bats.length === 5 && new Set(bats).size === 5);
versions = biens.versionsSoumission(sId, cab1);
test('chaque ajout = 1 version (v6)', versions.length === 6 && versions[0].version === 6, `n=${versions.length}`);
const v6 = biens.obtenirVersion(sId, 6, cab1);
test('v6 : 5 bâtiments dans le snapshot', v6.donnees.batiments.length === 5);
test('v6 : champs conservés (gicleurs, occupation)',
  v6.donnees.batiments[0].gicleurs === 1 && v6.donnees.batiments[3].occupation === 'Commerce de détail');

// 3. Contenus illimités : rattachés à un bâtiment + généraux
const conts = [];
conts.push(biens.ajouterContenu(sId, cab1, admin1, {
  description: 'Outillage spécialisé', type_contenu: 'equipements', valeur: 120000,
}, bats[0]));
conts.push(biens.ajouterContenu(sId, cab1, admin1, {
  description: 'Stock de pièces', type_contenu: 'stock', valeur: 80000,
}, bats[0]));
conts.push(biens.ajouterContenu(sId, cab1, admin1, {
  description: 'Mobilier de bureau', type_contenu: 'mobilier', valeur: 15000,
}, null));
conts.push(biens.ajouterContenu(sId, cab1, admin1, {
  description: 'Améliorations locatives', type_contenu: 'ameliorations', valeur: 45000,
}, bats[2]));
test('4 contenus ajoutés (bâtiment + généraux)', new Set(conts).size === 4);
test('versions → v10', biens.versionsSoumission(sId, cab1)[0].version === 10);
const v10 = biens.obtenirVersion(sId, 10, cab1);
test('v10 : contenus rattachés au bon bâtiment', v10.donnees.batiments[0].contenus.length === 2);
test('v10 : contenu général séparé', v10.donnees.contenus_generaux.length === 1);

// 4. Garanties par bâtiment + upsert
const g1 = biens.definirGaranties(bats[0], cab1, admin1, {
  formule: 'tous_risques', franchise: 2500, montant_assurance: 500000,
  avenants: { tremblement_terre: 1, refoulement_egout: 1 }, prime: 2850,
});
const g1b = biens.definirGaranties(bats[0], cab1, admin1, {
  formule: 'tous_risques', franchise: 5000, montant_assurance: 500000,
  avenants: { tremblement_terre: 1 }, prime: 2600,
});
test('garanties : upsert = même id', g1 === g1b);
biens.definirGaranties(bats[1], cab1, admin1, { formule: 'risques_designes', franchise: 10000, montant_assurance: 1000000 });
biens.definirGaranties(bats[2], cab1, admin1, { formule: 'tous_risques', franchise: 2500, montant_assurance: 750000, avenants: { inondation: 1 } });
const s = biens.obtenirSoumission(sId, cab1);
test('garanties rattachées aux bâtiments',
  s.batiments[0].garanties.franchise === 5000 && s.batiments[1].garanties.formule === 'risques_designes');
test('avenants JSON conservés', s.batiments[2].garanties.avenants.inondation === 1);
test('versions → v14', biens.versionsSoumission(sId, cab1)[0].version === 14);

// 5. Antécédents + upsert
const a1 = biens.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Assureur X', annees_assurance_continue: 6,
  sinistres_5ans: [{ date: '2023-02-18', type: 'Dégât d’eau (toiture)', montant: 18400 }],
  consentements: { credit: { accepte: true, date: '2026-10-19' } },
});
const a1b = biens.definirAntecedents(sId, cab1, admin1, { assureur_actuel: 'Assureur Y', annees_assurance_continue: 7 });
test('antécédents : upsert = même id', a1 === a1b);
test('versions → v16', biens.versionsSoumission(sId, cab1)[0].version === 16);

// 6. Modification bâtiment → version, état précédent figé
biens.modifierBatiment(bats[0], cab1, admin1, { occupation: 'Atelier modifié' });
const vAv = biens.obtenirVersion(sId, 16, cab1);
const vAp = biens.obtenirVersion(sId, 17, cab1);
test('modification bâtiment → v17', vAp.version === 17);
test('v16 fige l’ancienne occupation', vAv.donnees.batiments[0].occupation === 'Atelier', vAv.donnees.batiments[0].occupation);
test('v17 a la nouvelle occupation', vAp.donnees.batiments[0].occupation === 'Atelier modifié');

// 7. Archivage bâtiment : pas de DELETE, snapshot cohérent
biens.archiverBatiment(bats[4], cab1, admin1);
const ligne = bd.prepare('SELECT archive FROM biens_batiments WHERE id = ?').get(bats[4]);
test('archivé, pas effacé (ligne toujours en base)', ligne && ligne.archive === 1);
const v18 = biens.obtenirVersion(sId, 18, cab1);
const v17b = biens.obtenirVersion(sId, 17, cab1);
test('v18 exclut l’archivé du snapshot', v18.donnees.batiments.length === 4);
test('v17 conserve l’archivé dans l’historique', v17b.donnees.batiments.length === 5);
test('bâtiment archivé invisible par défaut',
  biens.obtenirSoumission(sId, cab1).batiments.length === 4);
biens.desarchiverBatiment(bats[4], cab1, admin1);
test('désarchivage → visible à nouveau',
  biens.obtenirSoumission(sId, cab1).batiments.length === 5);
test('versions → v19', biens.versionsSoumission(sId, cab1)[0].version === 19);

// 8. Contenu : modification + archivage + désarchivage
biens.modifierContenu(conts[0], cab1, admin1, { valeur: 130000 });
biens.archiverContenu(conts[3], cab1, admin1);
const sc = biens.obtenirSoumission(sId, cab1);
test('contenu archivé invisible par défaut',
  sc.batiments[2].contenus.length === 0 && sc.batiments[0].contenus.length === 2);
const lc = bd.prepare('SELECT archive FROM biens_contenus WHERE id = ?').get(conts[3]);
test('contenu archivé, pas effacé', lc && lc.archive === 1);
biens.desarchiverContenu(conts[3], cab1, admin1);
test('versions → v22', biens.versionsSoumission(sId, cab1)[0].version === 22);

// 9. Changement de statut → version ; statut invalide refusé
biens.changerStatutSoumission(sId, cab1, admin1, 'soumise');
test('statut soumise + version v23',
  biens.obtenirSoumission(sId, cab1).statut === 'soumise' &&
  biens.versionsSoumission(sId, cab1)[0].version === 23);
let invalide = false;
try { biens.changerStatutSoumission(sId, cab1, admin1, 'nimporte'); } catch { invalide = true; }
test('statut invalide refusé', invalide);
test('aucune version créée par le refus', biens.versionsSoumission(sId, cab1)[0].version === 23);

// 10. Historique : ordre, unicité, auteur
versions = biens.versionsSoumission(sId, cab1);
const nums = versions.map((v) => v.version);
test('23 versions, ordre DESC', versions.length === 23 && nums[0] === 23 && nums[22] === 1);
test('versions séquentielles sans trou', new Set(nums).size === 23 && Math.min(...nums) === 1);
test('auteur sur chaque version', versions.every((v) => v.auteur === 'Admin Un'));

// 11. Audit complet
const audits = bd.prepare(`SELECT action, COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action LIKE 'biens_%' GROUP BY action`).all(cab1);
const parAction = Object.fromEntries(audits.map((a) => [a.action, a.n]));
test('audit : 23 versions journalisées', parAction.biens_version === 23, JSON.stringify(parAction.biens_version));
test('audit : créations journalisées',
  (parAction.biens_soumission_creee === 1) && (parAction.biens_batiment_ajoute === 5) &&
  (parAction.biens_contenu_ajoute === 4));

// 12. Cloisonnement inter-cabinets
test('cabinet B ne voit pas la soumission', biens.obtenirSoumission(sId, cab2) === null);
test('cabinet B ne voit pas les versions', biens.versionsSoumission(sId, cab2).length === 0);
test('cabinet B ne peut pas modifier', biens.modifierBatiment(bats[0], cab2, admin2, { occupation: 'X' }) === false);
test('cabinet B ne peut pas versionner', biens.creerVersionSoumission(sId, cab2, admin2) === null);
test('cabinet B ne peut pas changer le statut', biens.changerStatutSoumission(sId, cab2, admin2, 'soumise') === false);
test('aucune version créée par le cabinet B', biens.versionsSoumission(sId, cab1)[0].version === 23);

// 13. Contraintes CHECK (aucune donnée invalide en base)
let e1 = false; try { biens.ajouterBatiment(sId, cab1, admin1, { adresse: 'X', type_construction: 'paille' }); } catch { e1 = true; }
test('type_construction invalide rejeté', e1);
let e2 = false; try { biens.definirGaranties(bats[1], cab1, admin1, { formule: 'magique' }); } catch { e2 = true; }
test('formule invalide rejetée', e2);
let e3 = false; try { biens.ajouterBatiment(sId, cab1, admin1, { adresse: '' }); } catch { e3 = true; }
test('bâtiment sans adresse refusé', e3);
let e4 = false; try { biens.ajouterContenu(sId, cab1, admin1, { description: 'X' }, 99999); } catch { e4 = true; }
test('contenu sur bâtiment inexistant refusé', e4);
let e5 = false; try { biens.ajouterContenu(sId, cab1, admin1, { description: 'X', type_contenu: 'ovni' }); } catch { e5 = true; }
test('type_contenu invalide rejeté', e5);

// 14. Règle d'or : aucun DELETE métier dans la couche biens
const src = fs.readFileSync(require.resolve('../lib/biens'), 'utf8');
test('aucun DELETE FROM dans lib/biens.js', !/DELETE\s+FROM/i.test(src));

// 15. Lister / filtres
const sId2 = biens.creerSoumission({ cabinetId: cab1, userId: admin1, notes: 'Deuxième' });
test('lister exclut les archives par défaut', biens.listerSoumissions(cab1).length === 2);
biens.archiverSoumission(sId2, cab1, admin1);
test('soumission archivée exclue', biens.listerSoumissions(cab1).length === 1);
test('filtre archives', biens.listerSoumissions(cab1, { inclureArchives: true }).length === 2);
test('filtre statut', biens.listerSoumissions(cab1, { statut: 'soumise' }).length === 1);
test('archiver n’efface pas', bd.prepare('SELECT archive FROM biens_soumissions WHERE id = ?').get(sId2).archive === 1);
biens.desarchiverSoumission(sId2, cab1, admin1);
test('désarchiver restaure', biens.listerSoumissions(cab1).length === 2);

console.log(`\n${total - echecs}/${total} tests réussis`);
if (echecs > 0) { console.log('❌ ÉCHECS : ' + echecs); process.exit(1); }
console.log('🎉 TOUS LES TESTS PASSENT');
