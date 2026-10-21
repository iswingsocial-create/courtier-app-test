/**
 * scripts/test-combine-etape6.js — Étape 6/10 « Soumission combinée » :
 * antécédents communs aux 3 produits (refus/résiliation, police précédente,
 * faillite, condamnation) avec protection anti-écrasement, sinistres 5 ans
 * enrichis, et questions sectorielles (copropriété, entrepreneur).
 * Couche données seulement. Base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-combine6.db node scripts/test-combine-etape6.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-combine6.db';
const { execFileSync } = require('child_process');
const path = require('path');
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const biens = require('../lib/biens');
const rc = require('../lib/rc');
const pe = require('../lib/pe');
const combine = require('../lib/combine');

let echecs = 0, total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

const cab = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Antécédents Test').lastInsertRowid;
const hash = bcrypt.hashSync('Test1234!', 4);
const admin = bd.prepare(
  `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
).run(cab, 'admin@antecedents.ca', hash, 'Admin Antécédents').lastInsertRowid;
const clientId = bd.prepare(
  `INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, 'Entreprise Antécédents', 'Pat', 'Test')`
).run(cab).lastInsertRowid;

console.log('== Étape 6/10 combinée — antécédents communs + questions sectorielles ==');

const COMMUNS = {
  assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'POL-2025-991',
  date_expiration_actuelle: '2026-06-30', annees_assurance_continue: 7,
  refus_resiliation_nonrenouvellement: 1, refus_explication: 'Non-renouvellement en 2023 (sinistralité)',
  type_police_precedente: 'Combinée biens + RC', date_effet_precedente: '2025-07-01',
  prime_precedente: 18450, faillite_jugement: 0, condamnation_honnetete: 0,
  sinistres_5ans: [
    { date: '2024-03-12', type: 'Dégât d\u2019eau', montant: 12500, montant_paye: 11000, reserve: 1500, statut: 'Fermé', description: 'Rupture de tuyau au sous-sol' },
    { date: '2025-09-02', type: 'Vol', montant: 4200, montant_paye: 0, reserve: 4200, statut: 'Ouvert', description: 'Vol d\u2019outils sur un chantier' },
  ],
};

const sB = biens.creerSoumission({ cabinetId: cab, userId: admin, client_id: clientId });
biens.definirAntecedents(sB, cab, admin, COMMUNS);
const aB = biens.obtenirSoumission(sB, cab).antecedents;
test('biens : champs communs relus',
  aB.refus_resiliation_nonrenouvellement === 1 && aB.prime_precedente === 18450
  && aB.type_police_precedente === 'Combinée biens + RC');
test('biens : sinistres 5 ans enrichis relus (payé, réserve, statut, description)',
  aB.sinistres_5ans.length === 2 && aB.sinistres_5ans[0].reserve === 1500
  && aB.sinistres_5ans[1].statut === 'Ouvert' && aB.sinistres_5ans[1].description.includes('chantier'));

const sR = rc.creerSoumission({ cabinetId: cab, userId: admin, client_id: clientId });
rc.definirAntecedents(sR, cab, admin, COMMUNS);
const aR = rc.obtenirSoumission(sR, cab).antecedents;
test('RC : mêmes champs communs relus',
  aR.refus_explication.includes('Non-renouvellement') && aR.faillite_jugement === 0
  && aR.date_effet_precedente === '2025-07-01');

const sP = pe.creerSoumission({ cabinetId: cab, userId: admin, client_id: clientId });
pe.definirAntecedents(sP, cab, admin, { ...COMMUNS, interruptions_5ans: [] });
const aP = pe.obtenirSoumission(sP, cab).antecedents;
test('PE : mêmes champs communs relus',
  aP.condamnation_honnetete === 0 && aP.prime_precedente === 18450);

// Protection anti-écrasement : une fiche produit qui ne connaît pas les
// champs communs ne doit pas les effacer.
biens.definirAntecedents(sB, cab, admin, {
  assureur_actuel: 'Nouvel Assureur', numero_police_actuelle: 'X-1',
  date_expiration_actuelle: '2027-01-01', annees_assurance_continue: 8, sinistres_5ans: [],
});
const aB2 = biens.obtenirSoumission(sB, cab).antecedents;
test('anti-écrasement : champs communs conservés après un enregistrement produit partiel',
  aB2.refus_resiliation_nonrenouvellement === 1 && aB2.prime_precedente === 18450
  && aB2.assureur_actuel === 'Nouvel Assureur');

// Questions sectorielles
test('catalogue : 17 questions copropriété + 7 entrepreneur',
  combine.QUESTIONS_SECTORIELLES.filter((q) => q.secteur === 'copropriete').length === 17
  && combine.QUESTIONS_SECTORIELLES.filter((q) => q.secteur === 'entrepreneur').length === 7);
const n = combine.definirReponsesSectorielles(clientId, cab, admin, {
  copro_carnet_entretien: 'Oui, tenu par le gestionnaire depuis 2022',
  copro_fonds_prevoyance: 'Étude 2024 — fonds à 82 % de la cible',
  entr_licence_rbq: 'RBQ 5678-1234-01',
  code_inexistant: 'ignoré',
});
test('réponses enregistrées (code inconnu ignoré)', n === 3);
const reps = combine.obtenirReponsesSectorielles(clientId, cab);
test('réponses relues avec leur question',
  reps.length === 3 && reps.find((r) => r.code_question === 'copro_carnet_entretien').question === 'Carnet d\u2019entretien'
  && reps.find((r) => r.code_question === 'entr_licence_rbq').reponse === 'RBQ 5678-1234-01');
combine.definirReponsesSectorielles(clientId, cab, admin, { copro_fonds_prevoyance: 'Étude 2026 — fonds à 95 %' });
const reps2 = combine.obtenirReponsesSectorielles(clientId, cab);
test('mise à jour sans doublon', reps2.length === 3
  && reps2.find((r) => r.code_question === 'copro_fonds_prevoyance').reponse.includes('95 %'));
const cab2 = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Voisin').lastInsertRowid;
test('cloisonnement : réponses invisibles depuis un autre cabinet',
  combine.obtenirReponsesSectorielles(clientId, cab2).length === 0);

// Dictionnaire
const sortie = execFileSync('node', [path.join(__dirname, 'generer-dictionnaire.js')], {
  encoding: 'utf8', env: { ...process.env, CHEMIN_BD: process.env.CHEMIN_BD },
});
test('dictionnaire complet et cohérent — état final (88 tables, 1199 colonnes)',
  /88 tables, 1199 colonnes/.test(sortie), sortie.trim().slice(0, 120));

console.log(`\n${total - echecs}/${total} tests réussis`);
if (echecs) { console.log(`💥 ${echecs} échec(s)`); process.exit(1); }
console.log('🎉 TOUS LES TESTS PASSENT');
