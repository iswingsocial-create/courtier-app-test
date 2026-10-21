/**
 * scripts/test-rc-etape1.js — Couche données « RC / responsabilité civile (CGL) » (étape 1/10 RC) :
 * schéma, versionnage (règle d'or : rien ne se supprime, chaque modification
 * fige une version), exploitations illimitées, garanties par exploitation,
 * antécédents, archivage, cloisonnement inter-cabinets, journal d'audit.
 *
 * Teste la couche données directement (aucune route/UI à l'étape 1).
 * Prérequis : base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-rc1.db node scripts/test-rc-etape1.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-rc1.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const rc = require('../lib/rc');

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

console.log('== RC étape 1 : couche données + versionnage ==');

// 1. Création → v1, snapshot initial vide
const sId = rc.creerSoumission({ cabinetId: cab1, userId: admin1, dateEffetSouhaitee: '2026-12-01', notes: 'Test RC' });
test('création soumission → id', sId > 0);
let versions = rc.versionsSoumission(sId, cab1);
test('v1 créée à la création', versions.length === 1 && versions[0].version === 1, `n=${versions.length}`);
test('v1 : auteur renseigné', versions[0].auteur === 'Admin Un', versions[0].auteur);
const v1 = rc.obtenirVersion(sId, 1, cab1);
test('v1 : snapshot vide (0 exploitation, 0 antécédent)',
  v1 && v1.donnees.exploitations.length === 0 && v1.donnees.antecedents === null);
test('v1 : statut brouillon figé', v1.statut === 'brouillon');

// 2. Aucune limite : 5 exploitations
const exps = [];
const activites = ['Bureau administratif', 'Chantier rénovation', 'Entrepôt', 'Usine', 'Boutique'];
for (let i = 1; i <= 5; i++) {
  exps.push(rc.ajouterExploitation(sId, cab1, admin1, {
    adresse: `${100 * i} rue Test`, ville: 'Laval', code_postal: `H7S 1A${i}`,
    type_activite: activites[i - 1], code_classification: `9155${i}`,
    description_activites: `Description ${i}`,
    chiffre_affaires: 500000 * i, masse_salariale: 200000 * i, nb_employes: 5 * i,
    superficie_pi2: 2000 * i, sous_traitants: i % 2 ? 'assures' : 'aucun',
    notes: `Note ${i}`,
  }));
}
test('5 exploitations ajoutées (aucune limite)', exps.length === 5 && new Set(exps).size === 5);
versions = rc.versionsSoumission(sId, cab1);
test('chaque ajout = 1 version (v6)', versions.length === 6 && versions[0].version === 6, `n=${versions.length}`);
const v6 = rc.obtenirVersion(sId, 6, cab1);
test('v6 : 5 exploitations dans le snapshot', v6.donnees.exploitations.length === 5);
test('v6 : champs conservés (classification, sous-traitants, CA)',
  v6.donnees.exploitations[0].code_classification === '91551'
  && v6.donnees.exploitations[0].sous_traitants === 'assures'
  && v6.donnees.exploitations[1].chiffre_affaires === 1000000);

// 3. Adresse obligatoire
let erreur = null;
try { rc.ajouterExploitation(sId, cab1, admin1, { ville: 'Laval' }); }
catch (e) { erreur = e.message; }
test('adresse obligatoire', erreur && erreur.includes('Adresse'), erreur);

// 4. CHECK : sous_traitants / formule invalides rejetés
erreur = null;
try {
  rc.ajouterExploitation(sId, cab1, admin1, { adresse: '999 rue X', sous_traitants: 'nimporte' });
} catch (e) { erreur = e.message; }
test('CHECK sous_traitants invalide rejeté', erreur !== null);
erreur = null;
try {
  rc.definirGaranties(exps[0], cab1, admin1, { formule: 'nimporte' });
} catch (e) { erreur = e.message; }
test('CHECK formule invalide rejeté', erreur !== null);

// 5. Garanties : création + modification (par exploitation)
const gid = rc.definirGaranties(exps[0], cab1, admin1, {
  limite_par_sinistre: 2000000, limite_agregat: 4000000, franchise: 2500,
  formule: 'globale', avenants: { pollution: 1, parapluie: 1 }, prime: 7800.00,
});
test('garanties définies', gid > 0);
versions = rc.versionsSoumission(sId, cab1);
test('garanties → nouvelle version (v7)', versions[0].version === 7, `v=${versions[0].version}`);
const v7 = rc.obtenirVersion(sId, 7, cab1);
test('v7 : garanties dans le snapshot (limites, avenants)',
  v7.donnees.exploitations[0].garanties.limite_par_sinistre === 2000000
  && v7.donnees.exploitations[0].garanties.limite_agregat === 4000000
  && v7.donnees.exploitations[0].garanties.avenants.pollution === 1
  && v7.donnees.exploitations[0].garanties.avenants.parapluie === 1);
test('v7 : 2e exploitation sans garanties', v7.donnees.exploitations[1].garanties === null);

const gid2 = rc.definirGaranties(exps[0], cab1, admin1, {
  limite_par_sinistre: 5000000, limite_agregat: 5000000, franchise: 5000,
  formule: 'locaux_operations', avenants: {}, prime: 9200.00,
});
test('garanties modifiées (même fiche, pas de doublon)', gid2 === gid);
versions = rc.versionsSoumission(sId, cab1);
test('modification garanties → version (v8)', versions[0].version === 8, `v=${versions[0].version}`);
const v8 = rc.obtenirVersion(sId, 8, cab1);
test('v8 : nouvelle limite figée, v7 intacte',
  v8.donnees.exploitations[0].garanties.limite_par_sinistre === 5000000
  && rc.obtenirVersion(sId, 7, cab1).donnees.exploitations[0].garanties.limite_par_sinistre === 2000000);

// 6. Garanties sur exploitation inexistante / autre cabinet
erreur = null;
try { rc.definirGaranties(99999, cab1, admin1, { limite_par_sinistre: 1000000 }); }
catch (e) { erreur = e.message; }
test('garanties sur exploitation inexistante rejetées', erreur && erreur.includes('introuvable'), erreur);

// 7. Antécédents : création + modification
const aid = rc.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'CGL-2024-1',
  date_expiration_actuelle: '2026-12-01', annees_assurance_continue: 5,
  sinistres_5ans: [{ date: '2024-06-10', type: 'Blessure corporelle', montant: 45000 }],
  consentements: { credit: { accepte: true, date: '2026-10-19' } },
});
test('antécédents définis', aid > 0);
versions = rc.versionsSoumission(sId, cab1);
test('antécédents → nouvelle version (v9)', versions[0].version === 9, `v=${versions[0].version}`);
const v9 = rc.obtenirVersion(sId, 9, cab1);
test('v9 : sinistres 5 ans dans le snapshot',
  v9.donnees.antecedents.sinistres_5ans.length === 1
  && v9.donnees.antecedents.sinistres_5ans[0].montant === 45000);

const aid2 = rc.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Beneva', numero_police_actuelle: 'CGL-2024-1',
  date_expiration_actuelle: '2026-12-01', annees_assurance_continue: 6,
  sinistres_5ans: [], consentements: {},
});
test('antécédents modifiés (même fiche)', aid2 === aid);
versions = rc.versionsSoumission(sId, cab1);
test('modification antécédents → version (v10)', versions[0].version === 10, `v=${versions[0].version}`);
test('v10 : nouvel assureur figé, v9 intacte',
  rc.obtenirVersion(sId, 10, cab1).donnees.antecedents.assureur_actuel === 'Beneva'
  && v9.donnees.antecedents.assureur_actuel === 'Intact Assurance');

// 8. Modification d'exploitation → version
rc.modifierExploitation(exps[0], cab1, admin1, { nb_employes: 12, sous_traitants: 'non_assures' });
versions = rc.versionsSoumission(sId, cab1);
test('modification exploitation → version (v11)', versions[0].version === 11, `v=${versions[0].version}`);
const v11 = rc.obtenirVersion(sId, 11, cab1);
test('v11 : nb employés figé', v11.donnees.exploitations[0].nb_employes === 12);

// 9. Changement de statut → version
test('statut invalide rejeté', (() => {
  try { rc.changerStatutSoumission(sId, cab1, admin1, 'nimporte'); return false; }
  catch { return true; }
})());
rc.changerStatutSoumission(sId, cab1, admin1, 'soumise');
versions = rc.versionsSoumission(sId, cab1);
test('statut → version (v12, statut soumis)', versions[0].version === 12 && versions[0].statut === 'soumise');

// 10. Archivage doux (règle d'or : jamais de DELETE)
test('archivage exploitation', rc.archiverExploitation(exps[4], cab1, admin1) === true);
test('exploitation archivée exclue des lectures', rc.obtenirSoumission(sId, cab1).exploitations.length === 4);
test('exploitation archivée restorable', rc.desarchiverExploitation(exps[4], cab1, admin1) === true);
test('exploitation désarchivée réapparaît', rc.obtenirSoumission(sId, cab1).exploitations.length === 5);
test('archivage soumission', rc.archiverSoumission(sId, cab1, admin1) === true);
test('soumission archivée exclue de la liste', rc.listerSoumissions(cab1).length === 0);
test('soumission archivée lisible avec inclureArchives',
  rc.obtenirSoumission(sId, cab1, { inclureArchives: true }) !== null);
test('soumission désarchivée', rc.desarchiverSoumission(sId, cab1, admin1) === true);
test('soumission désarchivée réapparaît dans la liste', rc.listerSoumissions(cab1).length === 1);

// 11. Cloisonnement inter-cabinets
test('cabinet B : soumission invisible', rc.obtenirSoumission(sId, cab2) === null);
test('cabinet B : versions invisibles', rc.versionsSoumission(sId, cab2).length === 0);
test('cabinet B : version précise invisible', rc.obtenirVersion(sId, 1, cab2) === null);
test('cabinet B : liste vide', rc.listerSoumissions(cab2).length === 0);
erreur = null;
try { rc.ajouterExploitation(sId, cab2, admin2, { adresse: '1 rue X' }); }
catch (e) { erreur = e.message; }
test('cabinet B : ajout refusé (soumission introuvable)', erreur && erreur.includes('introuvable'), erreur);

// 12. Aucun DELETE métier : les tables n'ont pas perdu de lignes
const nExp = bd.prepare('SELECT COUNT(*) AS n FROM rc_exploitations').get().n;
test('aucune exploitation perdue en base (5 lignes)', nExp === 5, `n=${nExp}`);
const nVer = bd.prepare('SELECT COUNT(*) AS n FROM rc_soumission_versions WHERE soumission_id = ?').get(sId).n;
test('historique complet conservé (14 versions)', nVer === 14, `n=${nVer}`);

// 13. Journal d'audit
const audits = bd.prepare(
  "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action LIKE 'rc_%'"
).get(cab1).n;
test('journal d’audit alimenté (≥ 25 entrées rc_)', audits >= 25, `n=${audits}`);

// 14. Aucune route DELETE sur les tables rc (vérification statique des libs)
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'rc.js'), 'utf8');
test('lib/rc.js : aucun DELETE FROM rc_', !/DELETE\s+FROM\s+rc_/i.test(src));

// --- Résultat --------------------------------------------------------------
console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
process.exit(echecs ? 1 : 0);
