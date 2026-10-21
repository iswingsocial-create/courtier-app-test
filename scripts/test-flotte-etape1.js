/**
 * scripts/test-flotte-etape1.js — Couche données « Flotte automobile »
 * (étape 1/10 flotte) : schéma, versionnage (règle d'or : rien ne se
 * supprime, chaque modification fige une version), véhicules et conducteurs
 * en nombre illimité, garanties par soumission (limite RC, franchises
 * collision/versement, avenants FAQ), antécédents (sinistres flotte 5 ans),
 * archivage, cloisonnement inter-cabinets, journal d'audit, seed démo.
 *
 * Teste la couche données directement (aucune route/UI à l'étape 1).
 * Prérequis : base FRAÎCHE via CHEMIN_BD, SANS serveur (le seed polluerait).
 * Usage : CHEMIN_BD=/tmp/test-flotte1.db node scripts/test-flotte-etape1.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-flotte1.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const flotte = require('../lib/flotte');

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

console.log('== Flotte étape 1 : couche données + versionnage ==');

// 0. Schéma : les 6 tables flotte_ existent
const tables = bd.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'flotte_%' ORDER BY name"
).all().map((t) => t.name);
test('schéma : 6 tables flotte_ créées',
  ['flotte_antecedents', 'flotte_conducteurs', 'flotte_garanties', 'flotte_soumission_versions',
    'flotte_soumissions', 'flotte_vehicules'].every((t) => tables.includes(t)),
  tables.join(','));

// Compteur de version attendue : chaque mutation de contenu fige une version.
let v = 0;

// 1. Création → v1, snapshot initial vide, en-tête flotte conservé
const sId = flotte.creerSoumission({
  cabinetId: cab1, userId: admin1, assureur: 'Intact Assurance', responsableId: admin1,
  nbVehicules: 4, rayonOperationKm: 160, usageDominant: 'livraison',
  dateEffetSouhaitee: '2026-12-01', dateEcheanceVisee: '2027-12-01', notes: 'Test flotte',
});
v = 1;
test('création soumission → id', sId > 0);
let versions = flotte.versionsSoumission(sId, cab1);
test('v1 créée à la création', versions.length === 1 && versions[0].version === 1, `n=${versions.length}`);
test('v1 : auteur renseigné', versions[0].auteur === 'Admin Un', versions[0].auteur);
const v1 = flotte.obtenirVersion(sId, 1, cab1);
test('v1 : snapshot vide (0 véhicule, 0 conducteur, garanties et antécédents nuls)',
  v1 && v1.donnees.vehicules.length === 0 && v1.donnees.conducteurs.length === 0
  && v1.donnees.garanties === null && v1.donnees.antecedents === null);
test('v1 : statut brouillon figé', v1.statut === 'brouillon');
const entete = flotte.obtenirSoumission(sId, cab1);
test('en-tête : assureur, nb véhicules, rayon, usage dominant, dates conservés',
  entete.assureur === 'Intact Assurance' && entete.nb_vehicules === 4
  && entete.rayon_operation_km === 160 && entete.usage_dominant === 'livraison'
  && entete.date_echeance_visee === '2027-12-01' && entete.responsable_id === admin1);

// 2. Aucune limite : 4 véhicules (camion, camion, automobile, remorque)
const vehicules = [];
const vehs = [
  { niv: '1FTBW3CM5KKB12345', annee: 2022, marque: 'Ford', modele: 'Transit 250', type_vehicule: 'camion',
    usage: 'livraison', rayon_operation_km: 160, lieu_remisage: 'Laval', valeur: 62000, annee_acquisition: 2022,
    equipements_speciaux: [{ description: 'Hayon élévateur', valeur: 6500 }] },
  { niv: '3C6TRVBG8ME512340', annee: 2021, marque: 'Ram', modele: 'ProMaster 3500', type_vehicule: 'camion',
    usage: 'livraison', rayon_operation_km: 200, lieu_remisage: 'Laval', valeur: 54000, annee_acquisition: 2021 },
  { niv: '2T1BURHE8JC045678', annee: 2020, marque: 'Toyota', modele: 'Corolla', type_vehicule: 'automobile',
    usage: 'service', rayon_operation_km: 100, lieu_remisage: 'Laval', valeur: 18500, annee_acquisition: 2020 },
  { niv: '1T9UT2825NA334455', annee: 2019, marque: 'Manac', modele: 'Remorque fermée 28 pi', type_vehicule: 'remorque',
    usage: 'transport_marchandises', rayon_operation_km: 160, lieu_remisage: 'Laval', valeur: 21000, annee_acquisition: 2019,
    conducteur_principal_nom: 'Selon affectation' },
];
for (const veh of vehs) {
  vehicules.push(flotte.ajouterVehicule(sId, cab1, admin1, veh));
  v++;
}
test('4 véhicules ajoutés (aucune limite)', vehicules.length === 4 && new Set(vehicules).size === 4);
versions = flotte.versionsSoumission(sId, cab1);
test(`chaque ajout = 1 version (v${v})`, versions.length === v && versions[0].version === v, `n=${versions.length}`);
const vVeh = flotte.obtenirVersion(sId, v, cab1);
test('snapshot : 4 véhicules', vVeh.donnees.vehicules.length === 4);
test('snapshot : champs véhicule conservés (NIV, type, usage, rayon, équipements JSON)',
  vVeh.donnees.vehicules[0].niv === '1FTBW3CM5KKB12345'
  && vVeh.donnees.vehicules[0].type_vehicule === 'camion'
  && vVeh.donnees.vehicules[0].usage === 'livraison'
  && vVeh.donnees.vehicules[1].rayon_operation_km === 200
  && vVeh.donnees.vehicules[0].equipements_speciaux[0].description === 'Hayon élévateur'
  && vVeh.donnees.vehicules[3].conducteur_principal_nom === 'Selon affectation');

// 3. Validations véhicule : type, usage, valeur négative
let e1 = null; let e2 = null; let e3 = null;
try { flotte.ajouterVehicule(sId, cab1, admin1, { type_vehicule: 'avion' }); } catch (e) { e1 = e.message; }
try { flotte.ajouterVehicule(sId, cab1, admin1, { usage: 'course' }); } catch (e) { e2 = e.message; }
try { flotte.ajouterVehicule(sId, cab1, admin1, { valeur: -5 }); } catch (e) { e3 = e.message; }
test('validations véhicule (type, usage, valeur négative) rejetées', !!(e1 && e2 && e3), `${e1} / ${e2} / ${e3}`);

// 4. Aucune limite : 5 conducteurs
const conducteurs = [];
const conds = [
  { nom: 'Lapointe', prenom: 'Jean-François', date_naissance: '1978-04-12', numero_permis: 'L152-040478-01',
    classe_permis: '3', annees_experience: 24, annees_experience_lourds: 18, date_embauche: '2009-06-01',
    sinistres_5ans: [], infractions_3ans: [],
    formations: [{ formation: 'Conduite préventive', date: '2024-05-10', organisme: 'CFT' }] },
  { nom: 'Gagnon', prenom: 'Marc', date_naissance: '1985-09-23', numero_permis: 'G556-230985-02',
    classe_permis: '3', annees_experience: 15, annees_experience_lourds: 11, date_embauche: '2016-03-14',
    sinistres_5ans: [{ date: '2023-07-19', description: 'Accrochage en reculant', montant: 4200, responsabilite: 'partagee' }],
    infractions_3ans: [{ date: '2024-02-02', type: 'Excès de vitesse', description: '20 km/h en zone urbaine', points: 3 }],
    formations: [] },
  { nom: 'Tremblay', prenom: 'Sophie', age: 34, numero_permis: 'T621-300192-03',
    classe_permis: '5', annees_experience: 9, annees_experience_lourds: 0, date_embauche: '2021-08-23' },
  { nom: 'Roy', prenom: 'Alain', date_naissance: '1970-11-05', numero_permis: 'R770-051170-04',
    classe_permis: '1', annees_experience: 30, annees_experience_lourds: 27, date_embauche: '2012-01-09' },
  { nom: 'Bouchard', prenom: 'Karine', date_naissance: '1995-06-17', numero_permis: 'B310-170695-05',
    classe_permis: '5', annees_experience: 6, annees_experience_lourds: 0, date_embauche: '2023-04-03' },
];
for (const c of conds) {
  conducteurs.push(flotte.ajouterConducteur(sId, cab1, admin1, c));
  v++;
}
test('5 conducteurs ajoutés (aucune limite)', conducteurs.length === 5 && new Set(conducteurs).size === 5);
versions = flotte.versionsSoumission(sId, cab1);
test(`chaque ajout conducteur = 1 version (v${v})`, versions.length === v && versions[0].version === v, `n=${versions.length}`);
const vCond = flotte.obtenirVersion(sId, v, cab1);
test('snapshot : 5 conducteurs', vCond.donnees.conducteurs.length === 5);
test('snapshot : champs conducteur conservés (classe, expérience lourds, sinistres/infractions/formations JSON, âge)',
  vCond.donnees.conducteurs[0].classe_permis === '3'
  && vCond.donnees.conducteurs[0].annees_experience_lourds === 18
  && vCond.donnees.conducteurs[1].sinistres_5ans[0].montant === 4200
  && vCond.donnees.conducteurs[1].infractions_3ans[0].points === 3
  && vCond.donnees.conducteurs[0].formations[0].formation === 'Conduite préventive'
  && vCond.donnees.conducteurs[2].age === 34);

// 5. Nom et prénom du conducteur obligatoires
let erreur = null;
try { flotte.ajouterConducteur(sId, cab1, admin1, { prenom: 'SansNom' }); }
catch (e) { erreur = e.message; }
test('nom et prénom du conducteur obligatoires', erreur && erreur.includes('requis'), erreur);

// 6. Garanties : création + modification (une fiche par soumission)
const gid = flotte.definirGaranties(sId, cab1, admin1, {
  limite_rc: 2000000, franchise_collision: 1000, franchise_versement: 1000,
  avenants: { faq43: 1, faq27: 1, faq20: 1 }, prime: 9850.00,
});
v++;
test('garanties définies', gid > 0);
versions = flotte.versionsSoumission(sId, cab1);
test(`garanties → nouvelle version (v${v})`, versions[0].version === v, `v=${versions[0].version}`);
const vGar = flotte.obtenirVersion(sId, v, cab1);
test('snapshot : garanties (limite RC 2 M$, franchises, avenants FAQ43/27/20)',
  vGar.donnees.garanties.limite_rc === 2000000
  && vGar.donnees.garanties.franchise_collision === 1000
  && vGar.donnees.garanties.franchise_versement === 1000
  && vGar.donnees.garanties.avenants.faq43 === 1
  && vGar.donnees.garanties.avenants.faq27 === 1
  && vGar.donnees.garanties.avenants.faq20 === 1);
const vGar1 = v;

const gid2 = flotte.definirGaranties(sId, cab1, admin1, {
  limite_rc: 1000000, franchise_collision: 2500, franchise_versement: 2500,
  avenants: { faq43: 1, faq34: 1 }, prime: 11200.00,
});
v++;
test('garanties modifiées (même fiche, pas de doublon)', gid2 === gid);
test(`modification garanties → version (v${v})`, flotte.versionsSoumission(sId, cab1)[0].version === v);
test('nouvelle version figée, version précédente intacte',
  flotte.obtenirVersion(sId, v, cab1).donnees.garanties.limite_rc === 1000000
  && flotte.obtenirVersion(sId, vGar1, cab1).donnees.garanties.limite_rc === 2000000);

// 7. Validations garanties + soumission inexistante
erreur = null;
try { flotte.definirGaranties(sId, cab1, admin1, { franchise_collision: -100 }); }
catch (e) { erreur = e.message; }
test('franchise négative rejetée', erreur !== null, erreur);
erreur = null;
try { flotte.definirGaranties(99999, cab1, admin1, { limite_rc: 2000000 }); }
catch (e) { erreur = e.message; }
test('garanties sur soumission inexistante rejetées', erreur && erreur.includes('introuvable'), erreur);

// 8. Antécédents : création + modification
const aid = flotte.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'FLT-2023-7781',
  date_expiration_actuelle: '2026-11-30', annees_assurance_flotte_continue: 6,
  sinistres_flotte_5ans: [{ date: '2023-07-19', description: 'Accrochage en manœuvre de recul, pare-chocs et porte arrière', montant: 4200 }],
  ratio_pertes: 18.5, refus_annulation_ant: 0,
  consentements: { dossier_saaq: { accepte: true, date: '2026-10-20' } },
});
v++;
test('antécédents définis', aid > 0);
test(`antécédents → nouvelle version (v${v})`, flotte.versionsSoumission(sId, cab1)[0].version === v);
const vAnt = flotte.obtenirVersion(sId, v, cab1);
test('snapshot : sinistres flotte 5 ans (date, description, montant) + ratio de pertes',
  vAnt.donnees.antecedents.sinistres_flotte_5ans.length === 1
  && vAnt.donnees.antecedents.sinistres_flotte_5ans[0].date === '2023-07-19'
  && vAnt.donnees.antecedents.sinistres_flotte_5ans[0].montant === 4200
  && vAnt.donnees.antecedents.ratio_pertes === 18.5
  && vAnt.donnees.antecedents.annees_assurance_flotte_continue === 6);
const vAnt1 = v;

const aid2 = flotte.definirAntecedents(sId, cab1, admin1, {
  assureur_actuel: 'Beneva', numero_police_actuelle: 'FLT-2023-7781',
  date_expiration_actuelle: '2026-11-30', annees_assurance_flotte_continue: 7,
  sinistres_flotte_5ans: [], ratio_pertes: 21.0, refus_annulation_ant: 1,
  refus_annulation_details: 'Non-renouvellement pour fréquence de sinistres en 2019',
  consentements: {},
});
v++;
test('antécédents modifiés (même fiche)', aid2 === aid);
test('nouvel assureur + refus antérieur figés, version précédente intacte',
  flotte.obtenirVersion(sId, v, cab1).donnees.antecedents.assureur_actuel === 'Beneva'
  && flotte.obtenirVersion(sId, v, cab1).donnees.antecedents.refus_annulation_ant === 1
  && flotte.obtenirVersion(sId, vAnt1, cab1).donnees.antecedents.assureur_actuel === 'Intact Assurance');

// 9. Modifications véhicule / conducteur / en-tête → versions
flotte.modifierVehicule(vehicules[0], cab1, admin1, { valeur: 60000 });
v++;
test(`modification véhicule → version (v${v})`, flotte.versionsSoumission(sId, cab1)[0].version === v);
test('valeur véhicule figée dans la nouvelle version, autres intacts',
  flotte.obtenirVersion(sId, v, cab1).donnees.vehicules[0].valeur === 60000
  && flotte.obtenirVersion(sId, v, cab1).donnees.vehicules[1].valeur === 54000);
flotte.modifierConducteur(conducteurs[1], cab1, admin1, { annees_experience: 16 });
v++;
test(`modification conducteur → version (v${v})`, flotte.versionsSoumission(sId, cab1)[0].version === v);
test('expérience conducteur figée',
  flotte.obtenirVersion(sId, v, cab1).donnees.conducteurs[1].annees_experience === 16);
flotte.modifierSoumission(sId, cab1, admin1, { nb_vehicules: 9, usage_dominant: 'mixte', numero_police: 'FLT-2026-0001' });
v++;
test(`modification en-tête → version (v${v})`, flotte.versionsSoumission(sId, cab1)[0].version === v);
const entete2 = flotte.obtenirSoumission(sId, cab1);
test('en-tête modifié relu (nb véhicules, usage, n° police)',
  entete2.nb_vehicules === 9 && entete2.usage_dominant === 'mixte' && entete2.numero_police === 'FLT-2026-0001');

// Lien conducteur principal (id) sur un véhicule
flotte.modifierVehicule(vehicules[0], cab1, admin1, { conducteur_principal_id: conducteurs[0] });
v++;
test('conducteur principal lié par id sur le véhicule',
  flotte.obtenirSoumission(sId, cab1).vehicules[0].conducteur_principal_id === conducteurs[0]);

// 10. Changement de statut → version
test('statut invalide rejeté', (() => {
  try { flotte.changerStatutSoumission(sId, cab1, admin1, 'nimporte'); return false; }
  catch { return true; }
})());
flotte.changerStatutSoumission(sId, cab1, admin1, 'soumise');
v++;
versions = flotte.versionsSoumission(sId, cab1);
test(`statut → version (v${v}, statut soumise)`, versions[0].version === v && versions[0].statut === 'soumise');

// 11. Archivage doux (règle d'or : jamais de DELETE)
test('archivage véhicule', flotte.archiverVehicule(vehicules[3], cab1, admin1) === true);
v++;
test('véhicule archivé exclu des lectures', flotte.obtenirSoumission(sId, cab1).vehicules.length === 3);
test('véhicule archivé restorable', flotte.desarchiverVehicule(vehicules[3], cab1, admin1) === true);
v++;
test('véhicule désarchivé réapparaît', flotte.obtenirSoumission(sId, cab1).vehicules.length === 4);
test('archivage conducteur', flotte.archiverConducteur(conducteurs[4], cab1, admin1) === true);
v++;
test('conducteur archivé exclu des lectures', flotte.obtenirSoumission(sId, cab1).conducteurs.length === 4);
test('conducteur désarchivé', flotte.desarchiverConducteur(conducteurs[4], cab1, admin1) === true);
v++;
test('conducteur désarchivé réapparaît', flotte.obtenirSoumission(sId, cab1).conducteurs.length === 5);
test('archivage soumission', flotte.archiverSoumission(sId, cab1, admin1) === true);
test('soumission archivée exclue de la liste', flotte.listerSoumissions(cab1).length === 0);
test('soumission archivée lisible avec inclureArchives',
  flotte.obtenirSoumission(sId, cab1, { inclureArchives: true }) !== null);
test('soumission désarchivée', flotte.desarchiverSoumission(sId, cab1, admin1) === true);
test('soumission désarchivée réapparaît dans la liste', flotte.listerSoumissions(cab1).length === 1);

// 12. Cloisonnement inter-cabinets
test('cabinet B : soumission invisible', flotte.obtenirSoumission(sId, cab2) === null);
test('cabinet B : versions invisibles', flotte.versionsSoumission(sId, cab2).length === 0);
test('cabinet B : version précise invisible', flotte.obtenirVersion(sId, 1, cab2) === null);
test('cabinet B : liste vide', flotte.listerSoumissions(cab2).length === 0);
erreur = null;
try { flotte.ajouterVehicule(sId, cab2, admin2, { marque: 'Test' }); }
catch (e) { erreur = e.message; }
test('cabinet B : ajout refusé (soumission introuvable)', erreur && erreur.includes('introuvable'), erreur);

// 13. Aucun DELETE métier : les tables n'ont pas perdu de lignes
const nVeh = bd.prepare('SELECT COUNT(*) AS n FROM flotte_vehicules').get().n;
test('aucun véhicule perdu en base (4 lignes)', nVeh === 4, `n=${nVeh}`);
const nCond = bd.prepare('SELECT COUNT(*) AS n FROM flotte_conducteurs').get().n;
test('aucun conducteur perdu en base (5 lignes)', nCond === 5, `n=${nCond}`);
const nVer = bd.prepare('SELECT COUNT(*) AS n FROM flotte_soumission_versions WHERE soumission_id = ?').get(sId).n;
test(`historique complet conservé (${v} versions)`, nVer === v, `n=${nVer} attendu=${v}`);

// 14. Journal d'audit
const audits = bd.prepare(
  "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action LIKE 'flotte_%'"
).get(cab1).n;
test('journal d’audit alimenté (≥ 30 entrées flotte_)', audits >= 30, `n=${audits}`);

// 15. Règle d'or statique : aucun DELETE/DROP sur les tables flotte_
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'flotte.js'), 'utf8');
test('lib/flotte.js : aucun DELETE FROM flotte_', !/DELETE\s+FROM\s+flotte_/i.test(src));
test('lib/flotte.js : aucun DROP TABLE flotte_', !/DROP\s+TABLE\s+flotte_/i.test(src));

// 16. Seed de démonstration : Transport Lapointe inc. (seulement si absent)
const seedId = flotte.semerSoumissionDemo(cab1, admin1);
test('seed démo → soumission créée', seedId > 0);
const seed = flotte.obtenirSoumission(seedId, cab1);
const clientSeed = bd.prepare('SELECT raison_sociale, ville FROM clients WHERE id = ?').get(seed.client_id);
test('seed : entreprise « Transport Lapointe inc. » à Laval',
  clientSeed && clientSeed.raison_sociale === 'Transport Lapointe inc.' && clientSeed.ville === 'Laval',
  clientSeed && clientSeed.raison_sociale);
test('seed : 4 véhicules (2 camions livraison, 1 automobile service, 1 remorque)',
  seed.vehicules.length === 4
  && seed.vehicules.filter((x) => x.type_vehicule === 'camion' && x.usage === 'livraison').length === 2
  && seed.vehicules.filter((x) => x.type_vehicule === 'automobile' && x.usage === 'service').length === 1
  && seed.vehicules.filter((x) => x.type_vehicule === 'remorque').length === 1);
test('seed : 3 conducteurs', seed.conducteurs.length === 3);
test('seed : garanties (RC 2 M$, collision 1 000 $, valeur à neuf FAQ43)',
  seed.garanties && seed.garanties.limite_rc === 2000000
  && seed.garanties.franchise_collision === 1000
  && seed.garanties.avenants.faq43 === 1);
test('seed : 1 sinistre flotte 2023 dans les antécédents',
  seed.antecedents && seed.antecedents.sinistres_flotte_5ans.length === 1
  && seed.antecedents.sinistres_flotte_5ans[0].date.startsWith('2023'));
const seedId2 = flotte.semerSoumissionDemo(cab1, admin1);
test('seed idempotent (2e appel = même soumission, pas de doublon)',
  seedId2 === seedId
  && bd.prepare('SELECT COUNT(*) AS n FROM flotte_soumissions WHERE cabinet_id = ? AND client_id = ?').get(cab1, seed.client_id).n === 1);

// --- Résultat --------------------------------------------------------------
console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
process.exit(echecs ? 1 : 0);
