/**
 * scripts/test-do-etape1.js — Couche données « D&O / responsabilité des administrateurs et dirigeants »
 * (étape 1/10 D&O) : schéma, versionnage (règle d'or : rien ne se supprime,
 * chaque modification fige une version), dirigeants en nombre illimité,
 * garanties par soumission (base réclamations-présentées/occurrences),
 * antécédents (réclamations D&O 5 ans, poursuites en cours/envisagées), archivage,
 * cloisonnement inter-cabinets, journal d'audit.
 *
 * Teste la couche données directement (aucune route/UI à l'étape 1).
 * Prérequis : base FRAÎCHE via CHEMIN_BD, SANS serveur (le seed polluerait).
 * Usage : CHEMIN_BD=/tmp/test-do1.db node scripts/test-do-etape1.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-do1.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const dom = require('../lib/do');

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

console.log('== D&O étape 1 : couche données + versionnage ==');

// 1. Création → v1, snapshot initial vide
const sId = dom.creerSoumission({ cabinetId: cab1, userId: admin1, dateEffetSouhaitee: '2026-12-15', notes: 'Test D&O' });
test('création soumission → id', sId > 0);
let versions = dom.versionsSoumission(sId, cab1);
test('v1 créée à la création', versions.length === 1 && versions[0].version === 1, `n=${versions.length}`);
test('v1 : auteur renseigné', versions[0].auteur === 'Admin Un', versions[0].auteur);
const v1 = dom.obtenirVersion(sId, 1, cab1);
test('v1 : snapshot vide (0 dirigeant, 0 antécédent)',
  v1 && v1.donnees.dirigeants.length === 0 && v1.donnees.antecedents === null);
test('v1 : statut brouillon figé', v1.statut === 'brouillon');

// 2. Aucune limite : 3 dirigeants
const dirigeants = [];
const noms = ['Marc Bélanger', 'Julie Bélanger', 'Robert Gagnon'];
const fonctions = ['Président', 'Trésorière', 'Administrateur indépendant'];
const exps = [18, 12, 22];

for (let i = 0; i < 3; i++) {
  dirigeants.push(dom.ajouterDirigeant(sId, cab1, admin1, {
    nom: noms[i], fonction: fonctions[i], annees_experience: exps[i],
    antecedents_personnels: 'Aucune réclamation ou poursuite personnelle.',
  }));
}
test('3 dirigeants ajoutés (aucune limite)', dirigeants.length === 3 && new Set(dirigeants).size === 3);
versions = dom.versionsSoumission(sId, cab1);
test('chaque ajout = 1 version (v4)', versions.length === 4 && versions[0].version === 4, `n=${versions.length}`);
const v4 = dom.obtenirVersion(sId, 4, cab1);
test('v4 : 3 dirigeants dans le snapshot', v4.donnees.dirigeants.length === 3);
test('v4 : champs conservés (nom, fonction, expérience)',
  v4.donnees.dirigeants[0].nom === 'Marc Bélanger'
  && v4.donnees.dirigeants[0].fonction === 'Président'
  && v4.donnees.dirigeants[0].annees_experience === 18
  && v4.donnees.dirigeants[2].antecedents_personnels === 'Aucune réclamation ou poursuite personnelle.');

// 3. Nom du dirigeant obligatoire
let erreur = null;
try { dom.ajouterDirigeant(sId, cab1, admin1, { fonction: 'Président' }); }
catch (e) { erreur = e.message; }
test('nom du dirigeant obligatoire', erreur && erreur.includes('Nom du dirigeant'), erreur);

// 4. CHECK : base de garantie invalide rejetée
erreur = null;
try {
  dom.definirGaranties(sId, cab1, admin1, { base: 'nimporte' });
} catch (e) { erreur = e.message; }
test('CHECK base de garantie invalide rejeté', erreur !== null, erreur);

// 5. Garanties : création + modification (une fiche par soumission)
const gid = dom.definirGaranties(sId, cab1, admin1, {
  limite_par_sinistre: 2000000, limite_agregat: 2000000, franchise: 10000,
  base: 'reclamations_presentees', avenants: { frais_defense: 1, medias_contenu: 1 }, prime: 3200.00,
});
test('garanties définies', gid > 0);
versions = dom.versionsSoumission(sId, cab1);
test('garanties → nouvelle version (v5)', versions[0].version === 5, `v=${versions[0].version}`);
const v5 = dom.obtenirVersion(sId, 5, cab1);
test('v5 : garanties dans le snapshot (limites, base, avenants)',
  v5.donnees.garanties.limite_par_sinistre === 2000000
  && v5.donnees.garanties.base === 'reclamations_presentees'
  && v5.donnees.garanties.avenants.frais_defense === 1);

const gid2 = dom.definirGaranties(sId, cab1, admin1, {
  limite_par_sinistre: 5000000, limite_agregat: 5000000, franchise: 25000,
  base: 'occurrences', avenants: { frais_defense: 1, cyber_associe: 1 }, prime: 6800.00,
});
test('garanties modifiées (même fiche, pas de doublon)', gid2 === gid);
versions = dom.versionsSoumission(sId, cab1);
test('modification garanties → version (v6)', versions[0].version === 6, `v=${versions[0].version}`);
const v6 = dom.obtenirVersion(sId, 6, cab1);
test('v6 : nouvelle limite et base figées, v5 intacte',
  v6.donnees.garanties.limite_par_sinistre === 5000000
  && v6.donnees.garanties.base === 'occurrences'
  && dom.obtenirVersion(sId, 5, cab1).donnees.garanties.base === 'reclamations_presentees');

// 6. Garanties sur soumission inexistante
erreur = null;
try { dom.definirGaranties(99999, cab1, admin1, { limite_par_sinistre: 1000000 }); }
catch (e) { erreur = e.message; }
test('garanties sur soumission inexistante rejetées', erreur && erreur.includes('introuvable'), erreur);

// 7. Antécédents : création + modification
const aid = dom.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Aucun', numero_police_actuelle: null,
  date_expiration_actuelle: null, annees_assurance_continue: 0,
  reclamations_5ans: [{ date: '2022-08-30', nature: 'Poursuite d’un actionnaire minoritaire (faute de gestion alléguée)', montant: 120000, sinistre: true }],
  poursuites_en_cours: 'Aucune poursuite ou action en justice en cours ou envisagée.',
  consentements: { credit: { accepte: true, date: '2026-10-19' } },
});
test('antécédents définis', aid > 0);
versions = dom.versionsSoumission(sId, cab1);
test('antécédents → nouvelle version (v7)', versions[0].version === 7, `v=${versions[0].version}`);
const v7 = dom.obtenirVersion(sId, 7, cab1);
test('v7 : réclamations 5 ans et poursuites dans le snapshot',
  v7.donnees.antecedents.reclamations_5ans.length === 1
  && v7.donnees.antecedents.reclamations_5ans[0].montant === 120000
  && v7.donnees.antecedents.reclamations_5ans[0].sinistre === true
  && v7.donnees.antecedents.poursuites_en_cours === 'Aucune poursuite ou action en justice en cours ou envisagée.');

const aid2 = dom.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'DO-2023-1',
  date_expiration_actuelle: '2026-12-15', annees_assurance_continue: 1,
  reclamations_5ans: [], poursuites_en_cours: null, consentements: {},
});
test('antécédents modifiés (même fiche)', aid2 === aid);
versions = dom.versionsSoumission(sId, cab1);
test('modification antécédents → version (v8)', versions[0].version === 8, `v=${versions[0].version}`);
test('v8 : nouvel assureur figé, v7 intacte',
  dom.obtenirVersion(sId, 8, cab1).donnees.antecedents.assureur_actuel === 'Intact Assurance'
  && v7.donnees.antecedents.assureur_actuel === 'Aucun');

// 8. Modification de dirigeant → version
dom.modifierDirigeant(dirigeants[0], cab1, admin1, { annees_experience: 20 });
versions = dom.versionsSoumission(sId, cab1);
test('modification dirigeant → version (v9)', versions[0].version === 9, `v=${versions[0].version}`);
const v9 = dom.obtenirVersion(sId, 9, cab1);
test('v9 : expérience dirigeant figée', v9.donnees.dirigeants[0].annees_experience === 20);
test('v9 : autres dirigeants intacts', v9.donnees.dirigeants[1].annees_experience === 12);

// 9. Changement de statut → version
test('statut invalide rejeté', (() => {
  try { dom.changerStatutSoumission(sId, cab1, admin1, 'nimporte'); return false; }
  catch { return true; }
})());
dom.changerStatutSoumission(sId, cab1, admin1, 'soumise');
versions = dom.versionsSoumission(sId, cab1);
test('statut → version (v10, statut soumis)', versions[0].version === 10 && versions[0].statut === 'soumise');

// 10. Archivage doux (règle d'or : jamais de DELETE)
test('archivage dirigeant', dom.archiverDirigeant(dirigeants[2], cab1, admin1) === true);
test('dirigeant archivé exclu des lectures', dom.obtenirSoumission(sId, cab1).dirigeants.length === 2);
test('dirigeant archivé restorable', dom.desarchiverDirigeant(dirigeants[2], cab1, admin1) === true);
test('dirigeant désarchivé réapparaît', dom.obtenirSoumission(sId, cab1).dirigeants.length === 3);
test('archivage soumission', dom.archiverSoumission(sId, cab1, admin1) === true);
test('soumission archivée exclue de la liste', dom.listerSoumissions(cab1).length === 0);
test('soumission archivée lisible avec inclureArchives',
  dom.obtenirSoumission(sId, cab1, { inclureArchives: true }) !== null);
test('soumission désarchivée', dom.desarchiverSoumission(sId, cab1, admin1) === true);
test('soumission désarchivée réapparaît dans la liste', dom.listerSoumissions(cab1).length === 1);

// 11. Cloisonnement inter-cabinets
test('cabinet B : soumission invisible', dom.obtenirSoumission(sId, cab2) === null);
test('cabinet B : versions invisibles', dom.versionsSoumission(sId, cab2).length === 0);
test('cabinet B : version précise invisible', dom.obtenirVersion(sId, 1, cab2) === null);
test('cabinet B : liste vide', dom.listerSoumissions(cab2).length === 0);
erreur = null;
try { dom.ajouterDirigeant(sId, cab2, admin2, { nom: 'Test' }); }
catch (e) { erreur = e.message; }
test('cabinet B : ajout refusé (soumission introuvable)', erreur && erreur.includes('introuvable'), erreur);

// 12. Aucun DELETE métier : les tables n'ont pas perdu de lignes
const nAct = bd.prepare('SELECT COUNT(*) AS n FROM do_dirigeants').get().n;
test('aucun dirigeant perdu en base (3 lignes)', nAct === 3, `n=${nAct}`);
const nVer = bd.prepare('SELECT COUNT(*) AS n FROM do_soumission_versions WHERE soumission_id = ?').get(sId).n;
test('historique complet conservé (12 versions)', nVer === 12, `n=${nVer}`);

// 13. Journal d'audit
const audits = bd.prepare(
  "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action LIKE 'do_%'"
).get(cab1).n;
test('journal d’audit alimenté (≥ 20 entrées do_)', audits >= 20, `n=${audits}`);

// 14. Aucune route DELETE sur les tables do (vérification statique des libs)
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'do.js'), 'utf8');
test('lib/do.js : aucun DELETE FROM do_', !/DELETE\s+FROM\s+do_/i.test(src));

// --- Résultat --------------------------------------------------------------
console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
process.exit(echecs ? 1 : 0);
