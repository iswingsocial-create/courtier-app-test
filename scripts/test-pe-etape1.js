/**
 * scripts/test-pe-etape1.js — Couche données « Perte d'exploitation /
 * interruption des affaires » (étape 1/10 PE) : schéma, versionnage
 * (règle d'or : rien ne se supprime, chaque modification fige une version),
 * établissements en nombre illimité, garanties par soumission (période
 * d'indemnité 12/18/24 mois, franchise en jours, base d'indemnité),
 * antécédents (interruptions 5 ans), archivage, cloisonnement
 * inter-cabinets, journal d'audit.
 *
 * Teste la couche données directement (aucune route/UI à l'étape 1).
 * Prérequis : base FRAÎCHE via CHEMIN_BD, SANS serveur (le seed polluerait).
 * Usage : CHEMIN_BD=/tmp/test-pe1.db node scripts/test-pe-etape1.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-pe1.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const pe = require('../lib/pe');

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

console.log('== PE étape 1 : couche données + versionnage ==');

// 1. Création → v1, snapshot initial vide
const sId = pe.creerSoumission({ cabinetId: cab1, userId: admin1, dateEffetSouhaitee: '2026-11-01', notes: 'Test PE' });
test('création soumission → id', sId > 0);
let versions = pe.versionsSoumission(sId, cab1);
test('v1 créée à la création', versions.length === 1 && versions[0].version === 1, `n=${versions.length}`);
test('v1 : auteur renseigné', versions[0].auteur === 'Admin Un', versions[0].auteur);
const v1 = pe.obtenirVersion(sId, 1, cab1);
test('v1 : snapshot vide (0 établissement, garanties et antécédents nuls)',
  v1 && v1.donnees.etablissements.length === 0 && v1.donnees.garanties === null && v1.donnees.antecedents === null);
test('v1 : statut brouillon figé', v1.statut === 'brouillon');

// 2. Aucune limite : 3 établissements (fournil + magasin + entrepôt)
const etablissements = [];
const etabs = [
  { nom_lieu: 'Fournil', adresse: '123 rue Sainte-Catherine E, Montréal', occupation: 'Boulangerie — fournil',
    chiffre_affaires: 750000, superficie: 250, annee_construction: 1965, base_valeur: 'remplacement' },
  { nom_lieu: 'Magasin', adresse: '4800 boul. Saint-Laurent, Montréal', occupation: 'Commerce de détail — pain et pâtisseries',
    chiffre_affaires: 450000, superficie: 120, annee_construction: 1965, base_valeur: 'remplacement' },
  { nom_lieu: 'Entrepôt', adresse: '12 rue d’Iberville, Montréal', occupation: 'Entreposage',
    superficie: 300, base_valeur: 'depreciation' },
];
for (const e of etabs) {
  etablissements.push(pe.ajouterEtablissement(sId, cab1, admin1, e));
}
test('3 établissements ajoutés (aucune limite)', etablissements.length === 3 && new Set(etablissements).size === 3);
versions = pe.versionsSoumission(sId, cab1);
test('chaque ajout = 1 version (v4)', versions.length === 4 && versions[0].version === 4, `n=${versions.length}`);
const v4 = pe.obtenirVersion(sId, 4, cab1);
test('v4 : 3 établissements dans le snapshot', v4.donnees.etablissements.length === 3);
test('v4 : champs conservés (nom_lieu, CA, superficie, base_valeur)',
  v4.donnees.etablissements[0].nom_lieu === 'Fournil'
  && v4.donnees.etablissements[0].chiffre_affaires === 750000
  && v4.donnees.etablissements[1].superficie === 120
  && v4.donnees.etablissements[2].base_valeur === 'depreciation');

// 3. Nom du lieu ou adresse obligatoire
let erreur = null;
try { pe.ajouterEtablissement(sId, cab1, admin1, { occupation: 'Bureau' }); }
catch (e) { erreur = e.message; }
test('nom du lieu ou adresse obligatoire', erreur && erreur.includes('requis'), erreur);

// 4. CHECK : base d'indemnité invalide rejetée
erreur = null;
try {
  pe.definirGaranties(sId, cab1, admin1, { base_montant: 'nimporte' });
} catch (e) { erreur = e.message; }
test('CHECK base d’indemnité invalide rejeté', erreur !== null, erreur);

// 5. Validations garanties : période invalide, franchise négative
let e1 = null; let e2 = null;
try { pe.definirGaranties(sId, cab1, admin1, { periode_indemnite_mois: 6 }); }
catch (e) { e1 = e.message; }
try { pe.definirGaranties(sId, cab1, admin1, { franchise_jours: -1 }); }
catch (e) { e2 = e.message; }
test('validations garanties (période invalide, franchise négative) rejetées', e1 && e2, `${e1} / ${e2}`);

// 6. Garanties : création + modification (une fiche par soumission)
const gid = pe.definirGaranties(sId, cab1, admin1, {
  limite: 800000, periode_indemnite_mois: 12, franchise_jours: 3,
  base_montant: 'marge_brute', avenants: { frais_supplementaires: 1, deterioration_stocks: 1 }, prime: 2800.00,
});
test('garanties définies', gid > 0);
versions = pe.versionsSoumission(sId, cab1);
test('garanties → nouvelle version (v5)', versions[0].version === 5, `v=${versions[0].version}`);
const v5 = pe.obtenirVersion(sId, 5, cab1);
test('v5 : garanties dans le snapshot (limite, période, franchise, base, avenants)',
  v5.donnees.garanties.limite === 800000
  && v5.donnees.garanties.periode_indemnite_mois === 12
  && v5.donnees.garanties.franchise_jours === 3
  && v5.donnees.garanties.base_montant === 'marge_brute'
  && v5.donnees.garanties.avenants.frais_supplementaires === 1
  && v5.donnees.garanties.avenants.deterioration_stocks === 1);

const gid2 = pe.definirGaranties(sId, cab1, admin1, {
  limite: 1000000, periode_indemnite_mois: 18, franchise_jours: 5,
  base_montant: 'benefice_brut', avenants: { frais_supplementaires: 1, acces_civil: 1 }, prime: 3400.00,
});
test('garanties modifiées (même fiche, pas de doublon)', gid2 === gid);
versions = pe.versionsSoumission(sId, cab1);
test('modification garanties → version (v6)', versions[0].version === 6, `v=${versions[0].version}`);
const v6 = pe.obtenirVersion(sId, 6, cab1);
test('v6 : nouvelles valeurs figées, v5 intacte',
  v6.donnees.garanties.limite === 1000000
  && v6.donnees.garanties.base_montant === 'benefice_brut'
  && pe.obtenirVersion(sId, 5, cab1).donnees.garanties.base_montant === 'marge_brute');

// 7. Garanties sur soumission inexistante
erreur = null;
try { pe.definirGaranties(99999, cab1, admin1, { limite: 1000000 }); }
catch (e) { erreur = e.message; }
test('garanties sur soumission inexistante rejetées', erreur && erreur.includes('introuvable'), erreur);

// 8. Antécédents : création + modification
const aid = pe.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Beneva', numero_police_actuelle: 'PE-2022-4410',
  date_expiration_actuelle: '2026-11-30', annees_assurance_continue: 4,
  interruptions_5ans: [{ date: '2022-03-11', cause: 'Bris d’équipement', duree_jours: 6, montant: 28000 }],
  consentements: { credit: { accepte: true, date: '2026-10-19' } },
});
test('antécédents définis', aid > 0);
versions = pe.versionsSoumission(sId, cab1);
test('antécédents → nouvelle version (v7)', versions[0].version === 7, `v=${versions[0].version}`);
const v7 = pe.obtenirVersion(sId, 7, cab1);
test('v7 : interruptions 5 ans dans le snapshot (date, cause, durée, montant)',
  v7.donnees.antecedents.interruptions_5ans.length === 1
  && v7.donnees.antecedents.interruptions_5ans[0].montant === 28000
  && v7.donnees.antecedents.interruptions_5ans[0].duree_jours === 6);

const aid2 = pe.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'PE-2022-4410',
  date_expiration_actuelle: '2026-11-30', annees_assurance_continue: 5,
  interruptions_5ans: [], consentements: {},
});
test('antécédents modifiés (même fiche)', aid2 === aid);
versions = pe.versionsSoumission(sId, cab1);
test('modification antécédents → version (v8)', versions[0].version === 8, `v=${versions[0].version}`);
test('v8 : nouvel assureur figé, v7 intacte',
  pe.obtenirVersion(sId, 8, cab1).donnees.antecedents.assureur_actuel === 'Intact Assurance'
  && v7.donnees.antecedents.assureur_actuel === 'Beneva');

// 9. Modification d'établissement → version
pe.modifierEtablissement(etablissements[0], cab1, admin1, { chiffre_affaires: 800000 });
versions = pe.versionsSoumission(sId, cab1);
test('modification établissement → version (v9)', versions[0].version === 9, `v=${versions[0].version}`);
const v9 = pe.obtenirVersion(sId, 9, cab1);
test('v9 : CA établissement figé, autres intacts',
  v9.donnees.etablissements[0].chiffre_affaires === 800000
  && v9.donnees.etablissements[1].chiffre_affaires === 450000);

// 10. Changement de statut → version
test('statut invalide rejeté', (() => {
  try { pe.changerStatutSoumission(sId, cab1, admin1, 'nimporte'); return false; }
  catch { return true; }
})());
pe.changerStatutSoumission(sId, cab1, admin1, 'soumise');
versions = pe.versionsSoumission(sId, cab1);
test('statut → version (v10, statut soumis)', versions[0].version === 10 && versions[0].statut === 'soumise');

// 11. Archivage doux (règle d'or : jamais de DELETE)
test('archivage établissement', pe.archiverEtablissement(etablissements[2], cab1, admin1) === true);
test('établissement archivé exclu des lectures', pe.obtenirSoumission(sId, cab1).etablissements.length === 2);
test('établissement archivé restorable', pe.desarchiverEtablissement(etablissements[2], cab1, admin1) === true);
test('établissement désarchivé réapparaît', pe.obtenirSoumission(sId, cab1).etablissements.length === 3);
test('archivage soumission', pe.archiverSoumission(sId, cab1, admin1) === true);
test('soumission archivée exclue de la liste', pe.listerSoumissions(cab1).length === 0);
test('soumission archivée lisible avec inclureArchives',
  pe.obtenirSoumission(sId, cab1, { inclureArchives: true }) !== null);
test('soumission désarchivée', pe.desarchiverSoumission(sId, cab1, admin1) === true);
test('soumission désarchivée réapparaît dans la liste', pe.listerSoumissions(cab1).length === 1);

// 12. Cloisonnement inter-cabinets
test('cabinet B : soumission invisible', pe.obtenirSoumission(sId, cab2) === null);
test('cabinet B : versions invisibles', pe.versionsSoumission(sId, cab2).length === 0);
test('cabinet B : version précise invisible', pe.obtenirVersion(sId, 1, cab2) === null);
test('cabinet B : liste vide', pe.listerSoumissions(cab2).length === 0);
erreur = null;
try { pe.ajouterEtablissement(sId, cab2, admin2, { nom_lieu: 'Test' }); }
catch (e) { erreur = e.message; }
test('cabinet B : ajout refusé (soumission introuvable)', erreur && erreur.includes('introuvable'), erreur);

// 13. Aucun DELETE métier : les tables n'ont pas perdu de lignes
const nEtab = bd.prepare('SELECT COUNT(*) AS n FROM pe_etablissements').get().n;
test('aucun établissement perdu en base (3 lignes)', nEtab === 3, `n=${nEtab}`);
const nVer = bd.prepare('SELECT COUNT(*) AS n FROM pe_soumission_versions WHERE soumission_id = ?').get(sId).n;
test('historique complet conservé (12 versions)', nVer === 12, `n=${nVer}`);

// 14. Journal d'audit
const audits = bd.prepare(
  "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action LIKE 'pe_%'"
).get(cab1).n;
test('journal d’audit alimenté (≥ 20 entrées pe_)', audits >= 20, `n=${audits}`);

// 15. Aucune route DELETE sur les tables pe (vérification statique des libs)
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'pe.js'), 'utf8');
test('lib/pe.js : aucun DELETE FROM pe_', !/DELETE\s+FROM\s+pe_/i.test(src));

// --- Résultat --------------------------------------------------------------
console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
process.exit(echecs ? 1 : 0);
