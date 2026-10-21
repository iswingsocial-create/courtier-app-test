/**
 * scripts/test-cautionnement-etape1.js — Couche données « Cautionnement »
 * (étape 1/10 cautionnement) : schéma, versionnage (règle d'or : rien ne se
 * supprime, chaque modification fige une version), obligations (cautionnements
 * demandés) en nombre illimité, ligne de cautionnement par soumission (limite
 * globale / par projet, fonds de roulement, valeur nette), antécédents
 * (réclamations contre des cautionnements 5 ans), archivage, cloisonnement
 * inter-cabinets, journal d'audit, seed démo.
 *
 * Teste la couche données directement (aucune route/UI à l'étape 1).
 * Prérequis : base FRAÎCHE via CHEMIN_BD, SANS serveur (le seed polluerait).
 * Usage : CHEMIN_BD=/tmp/test-caut1.db node scripts/test-cautionnement-etape1.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-caut1.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const caut = require('../lib/cautionnement');

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

console.log('== Cautionnement étape 1 : couche données + versionnage ==');

// 0. Schéma : les 5 tables caut_ existent
const tables = bd.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'caut_%' ORDER BY name"
).all().map((t) => t.name);
test('schéma : 5 tables caut_ créées',
  ['caut_antecedents', 'caut_garanties', 'caut_obligations', 'caut_soumission_versions',
    'caut_soumissions'].every((t) => tables.includes(t)),
  tables.join(','));

// Compteur de version attendue : chaque mutation de contenu fige une version.
let v = 0;

// 1. Création → v1, snapshot initial vide, en-tête conservé
const sId = caut.creerSoumission({
  cabinetId: cab1, userId: admin1, assureur: 'Intact Cautionnement', responsableId: admin1,
  secteurActivite: 'Construction — entrepreneur général', anneeFondation: 2010,
  chiffreAffaires: 6200000, nbEmployes: 35,
  dateEffetSouhaitee: '2026-12-01', dateEcheanceVisee: '2027-12-01', notes: 'Test cautionnement',
});
v = 1;
test('création soumission → id', sId > 0);
let versions = caut.versionsSoumission(sId, cab1);
test('v1 créée à la création', versions.length === 1 && versions[0].version === 1, `n=${versions.length}`);
test('v1 : auteur renseigné', versions[0].auteur === 'Admin Un', versions[0].auteur);
const v1 = caut.obtenirVersion(sId, 1, cab1);
test('v1 : snapshot vide (0 obligation, ligne et antécédents nuls)',
  v1 && v1.donnees.obligations.length === 0
  && v1.donnees.garanties === null && v1.donnees.antecedents === null);
test('v1 : statut brouillon figé', v1.statut === 'brouillon');
const entete = caut.obtenirSoumission(sId, cab1);
test('en-tête : caution visée, secteur, fondation, CA, employés, dates conservés',
  entete.assureur === 'Intact Cautionnement' && entete.secteur_activite.includes('entrepreneur général')
  && entete.annee_fondation === 2010 && entete.chiffre_affaires === 6200000
  && entete.nb_employes === 35 && entete.date_echeance_visee === '2027-12-01'
  && entete.responsable_id === admin1);

// 2. Aucune limite : 5 obligations (soumission, execution, paiement_mo, rbq, autre)
const obligations = [];
const obs = [
  { type: 'soumission', beneficiaire: 'Ville de Laval',
    description_projet: 'Cautionnement de soumission — réfection du centre sportif',
    montant_contrat: 1500000, montant_cautionnement: 150000, prime_estimee: 300, duree_mois: 10 },
  { type: 'execution', beneficiaire: 'Ville de Laval',
    description_projet: 'Réfection du centre sportif (contrat de construction)',
    montant_contrat: 1500000, montant_cautionnement: 750000, taux_pct: 1.2, prime_estimee: 9000, duree_mois: 10 },
  { type: 'paiement_mo', beneficiaire: 'Ville de Laval',
    description_projet: 'Paiement de la main-d’œuvre et des matériaux — centre sportif',
    montant_contrat: 1500000, montant_cautionnement: 750000, taux_pct: 0.9, prime_estimee: 6750, duree_mois: 10 },
  { type: 'rbq', beneficiaire: 'Régie du bâtiment du Québec (RBQ)',
    description_projet: 'Cautionnement de licence RBQ — entrepreneur général',
    montant_cautionnement: 40000, prime_estimee: 250, duree_mois: 12 },
  { type: 'autre', beneficiaire: 'Agence des services frontaliers du Canada',
    description_projet: 'Cautionnement de douanes — importation de matériaux',
    montant_cautionnement: 25000, prime_estimee: 375, duree_mois: 12 },
];
for (const ob of obs) {
  obligations.push(caut.ajouterObligation(sId, cab1, admin1, ob));
  v++;
}
test('5 obligations ajoutées (aucune limite)', obligations.length === 5 && new Set(obligations).size === 5);
versions = caut.versionsSoumission(sId, cab1);
test(`chaque ajout = 1 version (v${v})`, versions.length === v && versions[0].version === v, `n=${versions.length}`);
const vObs = caut.obtenirVersion(sId, v, cab1);
test('snapshot : 5 obligations', vObs.donnees.obligations.length === 5);
test('snapshot : champs obligation conservés (type, bénéficiaire, montants, taux, prime)',
  vObs.donnees.obligations[1].type === 'execution'
  && vObs.donnees.obligations[1].beneficiaire === 'Ville de Laval'
  && vObs.donnees.obligations[1].montant_contrat === 1500000
  && vObs.donnees.obligations[1].montant_cautionnement === 750000
  && vObs.donnees.obligations[1].taux_pct === 1.2
  && vObs.donnees.obligations[3].type === 'rbq'
  && vObs.donnees.obligations[3].montant_cautionnement === 40000);

// 3. Validations obligation : type, bénéficiaire/description requis, montants négatifs
let e1 = null; let e2 = null; let e3 = null;
try { caut.ajouterObligation(sId, cab1, admin1, { type: 'garantie_bancaire', beneficiaire: 'X' }); } catch (e) { e1 = e.message; }
try { caut.ajouterObligation(sId, cab1, admin1, { type: 'execution' }); } catch (e) { e2 = e.message; }
try { caut.ajouterObligation(sId, cab1, admin1, { beneficiaire: 'X', montant_cautionnement: -5 }); } catch (e) { e3 = e.message; }
test('validations obligation (type, bénéficiaire requis, montant négatif) rejetées', !!(e1 && e2 && e3), `${e1} / ${e2} / ${e3}`);

// 4. Ligne de cautionnement : création + modification (une fiche par soumission)
const gid = caut.definirGaranties(sId, cab1, admin1, {
  limite_globale: 5000000, limite_par_projet: 2500000,
  fonds_roulement: 700000, valeur_nette: 1600000, prime: 18000.00,
});
v++;
test('ligne de cautionnement définie', gid > 0);
versions = caut.versionsSoumission(sId, cab1);
test(`ligne → nouvelle version (v${v})`, versions[0].version === v, `v=${versions[0].version}`);
const vLigne = caut.obtenirVersion(sId, v, cab1);
test('snapshot : ligne (globale 5 M$, par projet 2,5 M$, fonds de roulement, valeur nette)',
  vLigne.donnees.garanties.limite_globale === 5000000
  && vLigne.donnees.garanties.limite_par_projet === 2500000
  && vLigne.donnees.garanties.fonds_roulement === 700000
  && vLigne.donnees.garanties.valeur_nette === 1600000);
const vLigne1 = v;

const gid2 = caut.definirGaranties(sId, cab1, admin1, {
  limite_globale: 7500000, limite_par_projet: 3000000,
  fonds_roulement: 820000, valeur_nette: 1750000, prime: 24000.00,
});
v++;
test('ligne modifiée (même fiche, pas de doublon)', gid2 === gid);
test(`modification ligne → version (v${v})`, caut.versionsSoumission(sId, cab1)[0].version === v);
test('nouvelle version figée, version précédente intacte',
  caut.obtenirVersion(sId, v, cab1).donnees.garanties.limite_globale === 7500000
  && caut.obtenirVersion(sId, vLigne1, cab1).donnees.garanties.limite_globale === 5000000);

// 5. Validations ligne : par projet > globale, négatif, soumission inexistante
let erreur = null;
try { caut.definirGaranties(sId, cab1, admin1, { limite_globale: 1000000, limite_par_projet: 2000000 }); }
catch (e) { erreur = e.message; }
test('limite par projet supérieure à la globale rejetée', erreur && erreur.includes('dépasser'), erreur);
erreur = null;
try { caut.definirGaranties(sId, cab1, admin1, { fonds_roulement: -100 }); }
catch (e) { erreur = e.message; }
test('fonds de roulement négatif rejeté', erreur !== null, erreur);
erreur = null;
try { caut.definirGaranties(99999, cab1, admin1, { limite_globale: 1000000 }); }
catch (e) { erreur = e.message; }
test('ligne sur soumission inexistante rejetée', erreur && erreur.includes('introuvable'), erreur);

// 6. Antécédents : création + modification
const aid = caut.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Intact Cautionnement', numero_ligne_actuelle: 'CAUT-2020-1122',
  date_expiration_actuelle: '2026-11-30', annees_cautionnement_continu: 6,
  reclamations_5ans: [{ date: '2022-05-14', cautionnement: 'Exécution — Ville de Terrebonne', montant: 48000, statut: 'réglée' }],
  refus_resiliation_ant: 0,
  consentements: { credit: { accepte: true, date: '2026-10-20' } },
});
v++;
test('antécédents définis', aid > 0);
test(`antécédents → nouvelle version (v${v})`, caut.versionsSoumission(sId, cab1)[0].version === v);
const vAnt = caut.obtenirVersion(sId, v, cab1);
test('snapshot : réclamations contre cautionnements 5 ans (date, cautionnement, montant, statut)',
  vAnt.donnees.antecedents.reclamations_5ans.length === 1
  && vAnt.donnees.antecedents.reclamations_5ans[0].date === '2022-05-14'
  && vAnt.donnees.antecedents.reclamations_5ans[0].montant === 48000
  && vAnt.donnees.antecedents.reclamations_5ans[0].statut === 'réglée'
  && vAnt.donnees.antecedents.annees_cautionnement_continu === 6);
const vAnt1 = v;

const aid2 = caut.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Travelers Canada', numero_ligne_actuelle: 'CAUT-2020-1122',
  date_expiration_actuelle: '2026-11-30', annees_cautionnement_continu: 7,
  reclamations_5ans: [], refus_resiliation_ant: 1,
  refus_resiliation_details: 'Résiliation de ligne par la caution en 2019 (difficultés financières du principal)',
  consentements: {},
});
v++;
test('antécédents modifiés (même fiche)', aid2 === aid);
test('nouvelle caution + refus/résiliation figés, version précédente intacte',
  caut.obtenirVersion(sId, v, cab1).donnees.antecedents.assureur_actuel === 'Travelers Canada'
  && caut.obtenirVersion(sId, v, cab1).donnees.antecedents.refus_resiliation_ant === 1
  && caut.obtenirVersion(sId, vAnt1, cab1).donnees.antecedents.assureur_actuel === 'Intact Cautionnement');

// 7. Modifications obligation / en-tête → versions
caut.modifierObligation(obligations[1], cab1, admin1, { montant_cautionnement: 800000 });
v++;
test(`modification obligation → version (v${v})`, caut.versionsSoumission(sId, cab1)[0].version === v);
test('montant du cautionnement figé dans la nouvelle version, autres intacts',
  caut.obtenirVersion(sId, v, cab1).donnees.obligations[1].montant_cautionnement === 800000
  && caut.obtenirVersion(sId, v, cab1).donnees.obligations[0].montant_cautionnement === 150000);
caut.modifierSoumission(sId, cab1, admin1, { chiffre_affaires: 6800000, nb_employes: 38, numero_police: 'CAUT-2026-0001' });
v++;
test(`modification en-tête → version (v${v})`, caut.versionsSoumission(sId, cab1)[0].version === v);
const entete2 = caut.obtenirSoumission(sId, cab1);
test('en-tête modifié relu (CA, employés, n° de ligne)',
  entete2.chiffre_affaires === 6800000 && entete2.nb_employes === 38 && entete2.numero_police === 'CAUT-2026-0001');

// 8. Changement de statut → version
test('statut invalide rejeté', (() => {
  try { caut.changerStatutSoumission(sId, cab1, admin1, 'nimporte'); return false; }
  catch { return true; }
})());
caut.changerStatutSoumission(sId, cab1, admin1, 'soumise');
v++;
versions = caut.versionsSoumission(sId, cab1);
test(`statut → version (v${v}, statut soumise)`, versions[0].version === v && versions[0].statut === 'soumise');

// 9. Archivage doux (règle d'or : jamais de DELETE)
test('archivage obligation', caut.archiverObligation(obligations[4], cab1, admin1) === true);
v++;
test('obligation archivée exclue des lectures', caut.obtenirSoumission(sId, cab1).obligations.length === 4);
test('obligation archivée restorable', caut.desarchiverObligation(obligations[4], cab1, admin1) === true);
v++;
test('obligation désarchivée réapparaît', caut.obtenirSoumission(sId, cab1).obligations.length === 5);
test('archivage soumission', caut.archiverSoumission(sId, cab1, admin1) === true);
test('soumission archivée exclue de la liste', caut.listerSoumissions(cab1).length === 0);
test('soumission archivée lisible avec inclureArchives',
  caut.obtenirSoumission(sId, cab1, { inclureArchives: true }) !== null);
test('soumission désarchivée', caut.desarchiverSoumission(sId, cab1, admin1) === true);
test('soumission désarchivée réapparaît dans la liste', caut.listerSoumissions(cab1).length === 1);

// 10. Cloisonnement inter-cabinets
test('cabinet B : soumission invisible', caut.obtenirSoumission(sId, cab2) === null);
test('cabinet B : versions invisibles', caut.versionsSoumission(sId, cab2).length === 0);
test('cabinet B : version précise invisible', caut.obtenirVersion(sId, 1, cab2) === null);
test('cabinet B : liste vide', caut.listerSoumissions(cab2).length === 0);
erreur = null;
try { caut.ajouterObligation(sId, cab2, admin2, { beneficiaire: 'Test' }); }
catch (e) { erreur = e.message; }
test('cabinet B : ajout refusé (soumission introuvable)', erreur && erreur.includes('introuvable'), erreur);

// 11. Aucun DELETE métier : les tables n'ont pas perdu de lignes
const nObs = bd.prepare('SELECT COUNT(*) AS n FROM caut_obligations').get().n;
test('aucune obligation perdue en base (5 lignes)', nObs === 5, `n=${nObs}`);
const nVer = bd.prepare('SELECT COUNT(*) AS n FROM caut_soumission_versions WHERE soumission_id = ?').get(sId).n;
test(`historique complet conservé (${v} versions)`, nVer === v, `n=${nVer} attendu=${v}`);

// 12. Journal d'audit
const audits = bd.prepare(
  "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action LIKE 'caut_%'"
).get(cab1).n;
test('journal d’audit alimenté (≥ 25 entrées caut_)', audits >= 25, `n=${audits}`);

// 13. Règle d'or statique : aucun DELETE/DROP sur les tables caut_
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'cautionnement.js'), 'utf8');
test('lib/cautionnement.js : aucun DELETE FROM caut_', !/DELETE\s+FROM\s+caut_/i.test(src));
test('lib/cautionnement.js : aucun DROP TABLE caut_', !/DROP\s+TABLE\s+caut_/i.test(src));

// 14. Seed de démonstration : Construction Verdon inc. (seulement si absent)
const seedId = caut.semerSoumissionDemo(cab1, admin1);
test('seed démo → soumission créée', seedId > 0);
const seed = caut.obtenirSoumission(seedId, cab1);
const clientSeed = bd.prepare('SELECT raison_sociale, ville FROM clients WHERE id = ?').get(seed.client_id);
test('seed : entreprise « Construction Verdon inc. » à Laval',
  clientSeed && clientSeed.raison_sociale === 'Construction Verdon inc.' && clientSeed.ville === 'Laval',
  clientSeed && clientSeed.raison_sociale);
test('seed : profil du principal (entrepreneur général, fondation 2008, CA 8,5 M$, 42 employés)',
  seed.secteur_activite.includes('entrepreneur général') && seed.annee_fondation === 2008
  && seed.chiffre_affaires === 8500000 && seed.nb_employes === 42);
test('seed : 4 obligations (soumission, exécution, paiement M&O, RBQ)',
  seed.obligations.length === 4
  && seed.obligations.filter((x) => x.type === 'soumission').length === 1
  && seed.obligations.filter((x) => x.type === 'execution').length === 1
  && seed.obligations.filter((x) => x.type === 'paiement_mo').length === 1
  && seed.obligations.filter((x) => x.type === 'rbq').length === 1);
const execSeed = seed.obligations.find((x) => x.type === 'execution');
test('seed : exécution = 50 % du contrat école de 2,2 M$ (1,1 M$)',
  execSeed && execSeed.montant_contrat === 2200000 && execSeed.montant_cautionnement === 1100000
  && execSeed.beneficiaire.includes('Centre de services scolaire'));
const rbqSeed = seed.obligations.find((x) => x.type === 'rbq');
test('seed : RBQ 40 000 $ (entrepreneur général)', rbqSeed && rbqSeed.montant_cautionnement === 40000);
test('seed : ligne (globale 5 M$, par projet 2,5 M$, fonds de roulement 850 k$)',
  seed.garanties && seed.garanties.limite_globale === 5000000
  && seed.garanties.limite_par_projet === 2500000
  && seed.garanties.fonds_roulement === 850000);
test('seed : aucune réclamation contre un cautionnement depuis 5 ans',
  seed.antecedents && seed.antecedents.reclamations_5ans.length === 0
  && seed.antecedents.refus_resiliation_ant === 0);
const seedId2 = caut.semerSoumissionDemo(cab1, admin1);
test('seed idempotent (2e appel = même soumission, pas de doublon)',
  seedId2 === seedId
  && bd.prepare('SELECT COUNT(*) AS n FROM caut_soumissions WHERE cabinet_id = ? AND client_id = ?').get(cab1, seed.client_id).n === 1);

// --- Résultat --------------------------------------------------------------
console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
process.exit(echecs ? 1 : 0);
