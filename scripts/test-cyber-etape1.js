/**
 * scripts/test-cyber-etape1.js — Couche données « Cyber / cyberrisques » (étape 1/10 cyber) :
 * schéma, versionnage (règle d'or : rien ne se supprime, chaque modification
 * fige une version), mesures de sécurité illimitées, garanties par soumission,
 * antécédents (incidents cyber 5 ans), archivage, cloisonnement inter-cabinets,
 * journal d'audit.
 *
 * Teste la couche données directement (aucune route/UI à l'étape 1).
 * Prérequis : base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-cyber1.db node scripts/test-cyber-etape1.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-cyber1.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const cyber = require('../lib/cyber');

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

console.log('== Cyber étape 1 : couche données + versionnage ==');

// 1. Création → v1, snapshot initial vide
const sId = cyber.creerSoumission({ cabinetId: cab1, userId: admin1, dateEffetSouhaitee: '2026-12-01', notes: 'Test cyber' });
test('création soumission → id', sId > 0);
let versions = cyber.versionsSoumission(sId, cab1);
test('v1 créée à la création', versions.length === 1 && versions[0].version === 1, `n=${versions.length}`);
test('v1 : auteur renseigné', versions[0].auteur === 'Admin Un', versions[0].auteur);
const v1 = cyber.obtenirVersion(sId, 1, cab1);
test('v1 : snapshot vide (0 mesure, 0 antécédent)',
  v1 && v1.donnees.mesures.length === 0 && v1.donnees.antecedents === null);
test('v1 : statut brouillon figé', v1.statut === 'brouillon');

// 2. Aucune limite : 5 mesures de sécurité
const mesures = [];
const types = ['mfa', 'sauvegardes', 'formation_hameconnage', 'plan_reponse_incident', 'pare_feu'];
const statuts = ['en_place', 'en_place', 'partiel', 'prevu', 'absent'];
for (let i = 0; i < 5; i++) {
  mesures.push(cyber.ajouterMesure(sId, cab1, admin1, {
    type_mesure: types[i], statut: statuts[i],
    details: `Détails ${types[i]}`, notes: `Note ${i + 1}`,
  }));
}
test('5 mesures ajoutées (aucune limite)', mesures.length === 5 && new Set(mesures).size === 5);
versions = cyber.versionsSoumission(sId, cab1);
test('chaque ajout = 1 version (v6)', versions.length === 6 && versions[0].version === 6, `n=${versions.length}`);
const v6 = cyber.obtenirVersion(sId, 6, cab1);
test('v6 : 5 mesures dans le snapshot', v6.donnees.mesures.length === 5);
test('v6 : champs conservés (statut, détails)',
  v6.donnees.mesures[0].type_mesure === 'mfa'
  && v6.donnees.mesures[0].statut === 'en_place'
  && v6.donnees.mesures[2].statut === 'partiel');

// 3. Type de mesure obligatoire
let erreur = null;
try { cyber.ajouterMesure(sId, cab1, admin1, { statut: 'en_place' }); }
catch (e) { erreur = e.message; }
test('type de mesure obligatoire', erreur && erreur.includes('Type'), erreur);

// 4. CHECK : statut invalide rejeté
erreur = null;
try {
  cyber.ajouterMesure(sId, cab1, admin1, { type_mesure: 'mfa', statut: 'nimporte' });
} catch (e) { erreur = e.message; }
test('CHECK statut de mesure invalide rejeté', erreur !== null);

// 5. Garanties : création + modification (une fiche par soumission)
const gid = cyber.definirGaranties(sId, cab1, admin1, {
  limite_par_sinistre: 1000000, limite_agregat: 1000000, franchise: 5000,
  delai_carence: '8 heures', avenants: { rancongiciel: 1, donnees_vie_privee: 1 }, prime: 2400.00,
});
test('garanties définies', gid > 0);
versions = cyber.versionsSoumission(sId, cab1);
test('garanties → nouvelle version (v7)', versions[0].version === 7, `v=${versions[0].version}`);
const v7 = cyber.obtenirVersion(sId, 7, cab1);
test('v7 : garanties dans le snapshot (limites, carence, avenants)',
  v7.donnees.garanties.limite_par_sinistre === 1000000
  && v7.donnees.garanties.limite_agregat === 1000000
  && v7.donnees.garanties.delai_carence === '8 heures'
  && v7.donnees.garanties.avenants.rancongiciel === 1
  && v7.donnees.garanties.avenants.donnees_vie_privee === 1);

const gid2 = cyber.definirGaranties(sId, cab1, admin1, {
  limite_par_sinistre: 2000000, limite_agregat: 2000000, franchise: 10000,
  delai_carence: '12 heures', avenants: { rancongiciel: 1, fraude_transfert: 1, interruption: 1 }, prime: 3900.00,
});
test('garanties modifiées (même fiche, pas de doublon)', gid2 === gid);
versions = cyber.versionsSoumission(sId, cab1);
test('modification garanties → version (v8)', versions[0].version === 8, `v=${versions[0].version}`);
const v8 = cyber.obtenirVersion(sId, 8, cab1);
test('v8 : nouvelle limite figée, v7 intacte',
  v8.donnees.garanties.limite_par_sinistre === 2000000
  && cyber.obtenirVersion(sId, 7, cab1).donnees.garanties.limite_par_sinistre === 1000000);

// 6. Garanties sur soumission inexistante
erreur = null;
try { cyber.definirGaranties(99999, cab1, admin1, { limite_par_sinistre: 1000000 }); }
catch (e) { erreur = e.message; }
test('garanties sur soumission inexistante rejetées', erreur && erreur.includes('introuvable'), erreur);

// 7. Antécédents : création + modification
const aid = cyber.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Beneva', numero_police_actuelle: 'CYB-2024-1',
  date_expiration_actuelle: '2026-12-01', annees_assurance_continue: 3,
  incidents_5ans: [{ date: '2024-11-02', type: 'Rançongiciel', montant: 28000, sinistre: false }],
  consentements: { credit: { accepte: true, date: '2026-10-19' } },
});
test('antécédents définis', aid > 0);
versions = cyber.versionsSoumission(sId, cab1);
test('antécédents → nouvelle version (v9)', versions[0].version === 9, `v=${versions[0].version}`);
const v9 = cyber.obtenirVersion(sId, 9, cab1);
test('v9 : incidents 5 ans dans le snapshot',
  v9.donnees.antecedents.incidents_5ans.length === 1
  && v9.donnees.antecedents.incidents_5ans[0].montant === 28000
  && v9.donnees.antecedents.incidents_5ans[0].sinistre === false);

const aid2 = cyber.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'CYB-2024-1',
  date_expiration_actuelle: '2026-12-01', annees_assurance_continue: 4,
  incidents_5ans: [], consentements: {},
});
test('antécédents modifiés (même fiche)', aid2 === aid);
versions = cyber.versionsSoumission(sId, cab1);
test('modification antécédents → version (v10)', versions[0].version === 10, `v=${versions[0].version}`);
test('v10 : nouvel assureur figé, v9 intacte',
  cyber.obtenirVersion(sId, 10, cab1).donnees.antecedents.assureur_actuel === 'Intact Assurance'
  && v9.donnees.antecedents.assureur_actuel === 'Beneva');

// 8. Modification de mesure → version
cyber.modifierMesure(mesures[0], cab1, admin1, { statut: 'partiel' });
versions = cyber.versionsSoumission(sId, cab1);
test('modification mesure → version (v11)', versions[0].version === 11, `v=${versions[0].version}`);
const v11 = cyber.obtenirVersion(sId, 11, cab1);
test('v11 : statut mesure figé', v11.donnees.mesures[0].statut === 'partiel');
test('v11 : autres mesures intactes', v11.donnees.mesures[1].statut === 'en_place');

// 9. Changement de statut → version
test('statut invalide rejeté', (() => {
  try { cyber.changerStatutSoumission(sId, cab1, admin1, 'nimporte'); return false; }
  catch { return true; }
})());
cyber.changerStatutSoumission(sId, cab1, admin1, 'soumise');
versions = cyber.versionsSoumission(sId, cab1);
test('statut → version (v12, statut soumis)', versions[0].version === 12 && versions[0].statut === 'soumise');

// 10. Archivage doux (règle d'or : jamais de DELETE)
test('archivage mesure', cyber.archiverMesure(mesures[4], cab1, admin1) === true);
test('mesure archivée exclue des lectures', cyber.obtenirSoumission(sId, cab1).mesures.length === 4);
test('mesure archivée restorable', cyber.desarchiverMesure(mesures[4], cab1, admin1) === true);
test('mesure désarchivée réapparaît', cyber.obtenirSoumission(sId, cab1).mesures.length === 5);
test('archivage soumission', cyber.archiverSoumission(sId, cab1, admin1) === true);
test('soumission archivée exclue de la liste', cyber.listerSoumissions(cab1).length === 0);
test('soumission archivée lisible avec inclureArchives',
  cyber.obtenirSoumission(sId, cab1, { inclureArchives: true }) !== null);
test('soumission désarchivée', cyber.desarchiverSoumission(sId, cab1, admin1) === true);
test('soumission désarchivée réapparaît dans la liste', cyber.listerSoumissions(cab1).length === 1);

// 11. Cloisonnement inter-cabinets
test('cabinet B : soumission invisible', cyber.obtenirSoumission(sId, cab2) === null);
test('cabinet B : versions invisibles', cyber.versionsSoumission(sId, cab2).length === 0);
test('cabinet B : version précise invisible', cyber.obtenirVersion(sId, 1, cab2) === null);
test('cabinet B : liste vide', cyber.listerSoumissions(cab2).length === 0);
erreur = null;
try { cyber.ajouterMesure(sId, cab2, admin2, { type_mesure: 'mfa' }); }
catch (e) { erreur = e.message; }
test('cabinet B : ajout refusé (soumission introuvable)', erreur && erreur.includes('introuvable'), erreur);

// 12. Aucun DELETE métier : les tables n'ont pas perdu de lignes
const nMes = bd.prepare('SELECT COUNT(*) AS n FROM cyber_mesures').get().n;
test('aucune mesure perdue en base (5 lignes)', nMes === 5, `n=${nMes}`);
const nVer = bd.prepare('SELECT COUNT(*) AS n FROM cyber_soumission_versions WHERE soumission_id = ?').get(sId).n;
test('historique complet conservé (14 versions)', nVer === 14, `n=${nVer}`);

// 13. Journal d'audit
const audits = bd.prepare(
  "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action LIKE 'cyber_%'"
).get(cab1).n;
test('journal d’audit alimenté (≥ 25 entrées cyber_)', audits >= 25, `n=${audits}`);

// 14. Aucune route DELETE sur les tables cyber (vérification statique des libs)
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'cyber.js'), 'utf8');
test('lib/cyber.js : aucun DELETE FROM cyber_', !/DELETE\s+FROM\s+cyber_/i.test(src));

// --- Résultat --------------------------------------------------------------
console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
process.exit(echecs ? 1 : 0);
