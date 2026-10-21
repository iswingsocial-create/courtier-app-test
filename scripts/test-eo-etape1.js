/**
 * scripts/test-eo-etape1.js — Couche données « E&O / responsabilité professionnelle »
 * (étape 1/10 E&O) : schéma, versionnage (règle d'or : rien ne se supprime,
 * chaque modification fige une version), activités professionnelles illimitées,
 * garanties par soumission (base réclamations-présentées/occurrences),
 * antécédents (réclamations E&O 5 ans, circonstances), archivage,
 * cloisonnement inter-cabinets, journal d'audit.
 *
 * Teste la couche données directement (aucune route/UI à l'étape 1).
 * Prérequis : base FRAÎCHE via CHEMIN_BD, SANS serveur (le seed polluerait).
 * Usage : CHEMIN_BD=/tmp/test-eo1.db node scripts/test-eo-etape1.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-eo1.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const eo = require('../lib/eo');

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

console.log('== E&O étape 1 : couche données + versionnage ==');

// 1. Création → v1, snapshot initial vide
const sId = eo.creerSoumission({ cabinetId: cab1, userId: admin1, dateEffetSouhaitee: '2026-12-15', notes: 'Test E&O' });
test('création soumission → id', sId > 0);
let versions = eo.versionsSoumission(sId, cab1);
test('v1 créée à la création', versions.length === 1 && versions[0].version === 1, `n=${versions.length}`);
test('v1 : auteur renseigné', versions[0].auteur === 'Admin Un', versions[0].auteur);
const v1 = eo.obtenirVersion(sId, 1, cab1);
test('v1 : snapshot vide (0 activité, 0 antécédent)',
  v1 && v1.donnees.activites.length === 0 && v1.donnees.antecedents === null);
test('v1 : statut brouillon figé', v1.statut === 'brouillon');

// 2. Aucune limite : 3 activités professionnelles
const activites = [];
const descs = ['Conseil en transformation numérique', 'Implantation de progiciels', 'Formation des utilisateurs'];
const cas = [450000, 300000, 75000];
const pros = [4, 3, 1];
for (let i = 0; i < 3; i++) {
  activites.push(eo.ajouterActivite(sId, cab1, admin1, {
    description_activite: descs[i], chiffre_affaires: cas[i], nb_professionnels: pros[i],
    notes: `Note ${i + 1}`,
  }));
}
test('3 activités ajoutées (aucune limite)', activites.length === 3 && new Set(activites).size === 3);
versions = eo.versionsSoumission(sId, cab1);
test('chaque ajout = 1 version (v4)', versions.length === 4 && versions[0].version === 4, `n=${versions.length}`);
const v4 = eo.obtenirVersion(sId, 4, cab1);
test('v4 : 3 activités dans le snapshot', v4.donnees.activites.length === 3);
test('v4 : champs conservés (CA, nb professionnels)',
  v4.donnees.activites[0].description_activite === 'Conseil en transformation numérique'
  && v4.donnees.activites[0].chiffre_affaires === 450000
  && v4.donnees.activites[2].nb_professionnels === 1);

// 3. Description d'activité obligatoire
let erreur = null;
try { eo.ajouterActivite(sId, cab1, admin1, { chiffre_affaires: 1000 }); }
catch (e) { erreur = e.message; }
test('description d’activité obligatoire', erreur && erreur.includes('Description'), erreur);

// 4. CHECK : base de garantie invalide rejetée
erreur = null;
try {
  eo.definirGaranties(sId, cab1, admin1, { base: 'nimporte' });
} catch (e) { erreur = e.message; }
test('CHECK base de garantie invalide rejeté', erreur !== null, erreur);

// 5. Garanties : création + modification (une fiche par soumission)
const gid = eo.definirGaranties(sId, cab1, admin1, {
  limite_par_sinistre: 2000000, limite_agregat: 2000000, franchise: 10000,
  base: 'reclamations_presentees', avenants: { frais_defense: 1, medias_contenu: 1 }, prime: 3200.00,
});
test('garanties définies', gid > 0);
versions = eo.versionsSoumission(sId, cab1);
test('garanties → nouvelle version (v5)', versions[0].version === 5, `v=${versions[0].version}`);
const v5 = eo.obtenirVersion(sId, 5, cab1);
test('v5 : garanties dans le snapshot (limites, base, avenants)',
  v5.donnees.garanties.limite_par_sinistre === 2000000
  && v5.donnees.garanties.base === 'reclamations_presentees'
  && v5.donnees.garanties.avenants.frais_defense === 1
  && v5.donnees.garanties.avenants.medias_contenu === 1);

const gid2 = eo.definirGaranties(sId, cab1, admin1, {
  limite_par_sinistre: 5000000, limite_agregat: 5000000, franchise: 25000,
  base: 'occurrences', avenants: { frais_defense: 1, cyber_associe: 1 }, prime: 6800.00,
});
test('garanties modifiées (même fiche, pas de doublon)', gid2 === gid);
versions = eo.versionsSoumission(sId, cab1);
test('modification garanties → version (v6)', versions[0].version === 6, `v=${versions[0].version}`);
const v6 = eo.obtenirVersion(sId, 6, cab1);
test('v6 : nouvelle limite et base figées, v5 intacte',
  v6.donnees.garanties.limite_par_sinistre === 5000000
  && v6.donnees.garanties.base === 'occurrences'
  && eo.obtenirVersion(sId, 5, cab1).donnees.garanties.base === 'reclamations_presentees');

// 6. Garanties sur soumission inexistante
erreur = null;
try { eo.definirGaranties(99999, cab1, admin1, { limite_par_sinistre: 1000000 }); }
catch (e) { erreur = e.message; }
test('garanties sur soumission inexistante rejetées', erreur && erreur.includes('introuvable'), erreur);

// 7. Antécédents : création + modification
const aid = eo.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'EO-2023-1',
  date_expiration_actuelle: '2026-12-15', annees_assurance_continue: 4,
  reclamations_5ans: [{ date: '2023-05-14', nature: 'Erreur d’implantation', montant: 45000, sinistre: true }],
  circonstances: 'Un client menace de réclamer.',
  consentements: { credit: { accepte: true, date: '2026-10-19' } },
});
test('antécédents définis', aid > 0);
versions = eo.versionsSoumission(sId, cab1);
test('antécédents → nouvelle version (v7)', versions[0].version === 7, `v=${versions[0].version}`);
const v7 = eo.obtenirVersion(sId, 7, cab1);
test('v7 : réclamations 5 ans et circonstances dans le snapshot',
  v7.donnees.antecedents.reclamations_5ans.length === 1
  && v7.donnees.antecedents.reclamations_5ans[0].montant === 45000
  && v7.donnees.antecedents.reclamations_5ans[0].sinistre === true
  && v7.donnees.antecedents.circonstances === 'Un client menace de réclamer.');

const aid2 = eo.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Beneva', numero_police_actuelle: 'EO-2023-1',
  date_expiration_actuelle: '2026-12-15', annees_assurance_continue: 5,
  reclamations_5ans: [], circonstances: null, consentements: {},
});
test('antécédents modifiés (même fiche)', aid2 === aid);
versions = eo.versionsSoumission(sId, cab1);
test('modification antécédents → version (v8)', versions[0].version === 8, `v=${versions[0].version}`);
test('v8 : nouvel assureur figé, v7 intacte',
  eo.obtenirVersion(sId, 8, cab1).donnees.antecedents.assureur_actuel === 'Beneva'
  && v7.donnees.antecedents.assureur_actuel === 'Intact Assurance');

// 8. Modification d'activité → version
eo.modifierActivite(activites[0], cab1, admin1, { chiffre_affaires: 500000 });
versions = eo.versionsSoumission(sId, cab1);
test('modification activité → version (v9)', versions[0].version === 9, `v=${versions[0].version}`);
const v9 = eo.obtenirVersion(sId, 9, cab1);
test('v9 : CA activité figé', v9.donnees.activites[0].chiffre_affaires === 500000);
test('v9 : autres activités intactes', v9.donnees.activites[1].chiffre_affaires === 300000);

// 9. Changement de statut → version
test('statut invalide rejeté', (() => {
  try { eo.changerStatutSoumission(sId, cab1, admin1, 'nimporte'); return false; }
  catch { return true; }
})());
eo.changerStatutSoumission(sId, cab1, admin1, 'soumise');
versions = eo.versionsSoumission(sId, cab1);
test('statut → version (v10, statut soumis)', versions[0].version === 10 && versions[0].statut === 'soumise');

// 10. Archivage doux (règle d'or : jamais de DELETE)
test('archivage activité', eo.archiverActivite(activites[2], cab1, admin1) === true);
test('activité archivée exclue des lectures', eo.obtenirSoumission(sId, cab1).activites.length === 2);
test('activité archivée restorable', eo.desarchiverActivite(activites[2], cab1, admin1) === true);
test('activité désarchivée réapparaît', eo.obtenirSoumission(sId, cab1).activites.length === 3);
test('archivage soumission', eo.archiverSoumission(sId, cab1, admin1) === true);
test('soumission archivée exclue de la liste', eo.listerSoumissions(cab1).length === 0);
test('soumission archivée lisible avec inclureArchives',
  eo.obtenirSoumission(sId, cab1, { inclureArchives: true }) !== null);
test('soumission désarchivée', eo.desarchiverSoumission(sId, cab1, admin1) === true);
test('soumission désarchivée réapparaît dans la liste', eo.listerSoumissions(cab1).length === 1);

// 11. Cloisonnement inter-cabinets
test('cabinet B : soumission invisible', eo.obtenirSoumission(sId, cab2) === null);
test('cabinet B : versions invisibles', eo.versionsSoumission(sId, cab2).length === 0);
test('cabinet B : version précise invisible', eo.obtenirVersion(sId, 1, cab2) === null);
test('cabinet B : liste vide', eo.listerSoumissions(cab2).length === 0);
erreur = null;
try { eo.ajouterActivite(sId, cab2, admin2, { description_activite: 'Test' }); }
catch (e) { erreur = e.message; }
test('cabinet B : ajout refusé (soumission introuvable)', erreur && erreur.includes('introuvable'), erreur);

// 12. Aucun DELETE métier : les tables n'ont pas perdu de lignes
const nAct = bd.prepare('SELECT COUNT(*) AS n FROM eo_activites').get().n;
test('aucune activité perdue en base (3 lignes)', nAct === 3, `n=${nAct}`);
const nVer = bd.prepare('SELECT COUNT(*) AS n FROM eo_soumission_versions WHERE soumission_id = ?').get(sId).n;
test('historique complet conservé (12 versions)', nVer === 12, `n=${nVer}`);

// 13. Journal d'audit
const audits = bd.prepare(
  "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action LIKE 'eo_%'"
).get(cab1).n;
test('journal d’audit alimenté (≥ 20 entrées eo_)', audits >= 20, `n=${audits}`);

// 14. Aucune route DELETE sur les tables eo (vérification statique des libs)
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'eo.js'), 'utf8');
test('lib/eo.js : aucun DELETE FROM eo_', !/DELETE\s+FROM\s+eo_/i.test(src));

// --- Résultat --------------------------------------------------------------
console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
process.exit(echecs ? 1 : 0);
