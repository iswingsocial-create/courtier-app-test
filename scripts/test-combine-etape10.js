/**
 * scripts/test-combine-etape10.js — Étape 10/10 « Soumission combinée » :
 * alignement IA (analyse de documents : nouveaux champs proposables en
 * local et par les moteurs externes, insertion dans la fiche emplacement ;
 * manques critiques de la combinée ; commandes IA créer/ouvrir une
 * combinée). Couche données seulement. Base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-combine10.db node scripts/test-combine-etape10.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-combine10.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const biens = require('../lib/biens');
const combine = require('../lib/combine');
const analyse = require('../lib/analyse-document');
const insertion = require('../lib/analyse-insertion');
const manques = require('../lib/manques');
const commandes = require('../lib/commandes-ia');
const { contexteTables, contexteDonnees } = require('../lib/contexte-ia');

let echecs = 0, total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

console.log('== Étape 10/10 combinée — alignement IA ==');

const cab = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet IA Test').lastInsertRowid;
const hash = bcrypt.hashSync('Test1234!', 4);
const admin = bd.prepare(
  `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
).run(cab, 'admin@ia.ca', hash, 'Admin IA').lastInsertRowid;
const utilisateur = bd.prepare('SELECT * FROM users WHERE id = ?').get(admin);
const clientId = bd.prepare(
  `INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, 'Bijouterie IA inc.', 'Jo', 'Ailler')`
).run(cab).lastInsertRowid;

// --- 1. Le dictionnaire (source de l'analyse) couvre les nouvelles tables
const ctx = contexteTables();
test('contexte IA : tables de la combinée présentes',
  ctx.includes('combine_dossiers') && ctx.includes('biens_protections_alarme')
  && ctx.includes('emplacement_beneficiaires') && ctx.includes('client_questions_sectorielles'));
const ctxD = contexteDonnees({ usages: ['soumission'] });
test('contexte IA : colonnes enrichies présentes (voisinage, classe, umbrella)',
  ctxD.includes('voisin_gauche_affectation') && ctxD.includes('classe_construction')
  && ctxD.includes('umbrella_montant') && ctxD.includes('regle_proportionnelle'));

// --- 2. META : les nouveaux champs sont proposables et insérables
for (const cle of ['garanties.regle_proportionnelle', 'garanties.honoraires_comptables',
  'garanties.frais_medicaux_par_personne', 'garanties.responsabilite_locative',
  'garanties.umbrella_montant', 'garanties.prejudice_personnel_publicite']) {
  test('META_CHAMPS contient ' + cle, !!analyse.META_CHAMPS[cle]);
}
test('META_CHAMPS : règle proportionnelle → bonnes tables',
  analyse.META_CHAMPS['garanties.regle_proportionnelle'].table('biens') === 'biens_garanties'
  && analyse.META_CHAMPS['garanties.regle_proportionnelle'].table('pe') === 'pe_garanties');
for (const cle of ['classe_construction', 'voisin_gauche_affectation', 'renovation_toiture_annee',
  'gicleurs_couverture', 'prise_eau_distance', 'alarme_vol_type', 'superficie_occupee_pi2']) {
  test('META_LISTES.batiments contient ' + cle, !!analyse.META_LISTES.batiments.champs[cle]);
}
test('META_LISTES : structure_toit pointe sur construction_toit_structure',
  analyse.META_LISTES.batiments.champs.structure_toit.colonne() === 'construction_toit_structure');

// --- 3. Moteur local : extraction des nouveaux champs d'un texte combiné
const texte = [
  'Proposition — assurance de biens commerciaux — soumission combinée',
  'Valeur de reconstruction : 2 000 000 $',
  'Bâtiment 1 :',
  'Adresse : 500 rue des Bijoux, Montréal',
  'Classe de construction : Incombustible',
  'Année de construction : 1999',
  'Voisin de gauche : Atelier de joaillerie',
  'Voisin de droite : Restaurant',
  'Rénovation toiture : 2019',
  'Gicleurs : entièrement',
  'Règle proportionnelle : 90 %',
].join('\n');
const res = analyse.analyserLocal(texte);
test('analyse locale : produit biens détecté', res.produit === 'biens', String(res.produit));
const bat = res.listes.batiments && res.listes.batiments[0];
test('analyse locale : bâtiment extrait', !!bat);
if (bat) {
  test('analyse locale : classe de construction convertie en code assureur',
    bat.champs.classe_construction === 'incombustible', JSON.stringify(bat.champs));
  test('analyse locale : voisinage extrait',
    bat.champs.voisin_gauche_affectation === 'Atelier de joaillerie'
    && bat.champs.voisin_droite_affectation === 'Restaurant');
  test('analyse locale : rénovation toiture et gicleurs extraits',
    bat.champs.renovation_toiture_annee === 2019 && bat.champs.gicleurs_couverture === 'entier');
}
const champRP = res.champs.find((c) => c.champ === 'garanties.regle_proportionnelle');
test('analyse locale : règle proportionnelle proposée (biens_garanties)',
  !!champRP && champRP.valeur === 90 && champRP.table === 'biens_garanties');

// --- 4. Validation façon moteur externe : champs connus conservés, inconnus rejetés
const validees = analyse.validerListesCohere({
  batiments: [{ champs: { adresse: '1 rue Test', classe_construction: 'Incombustible', champ_invente: 'x' }, confiance: 'haute' }],
}, 'biens', ['1 rue Test']);
test('validation externe : classe_construction conservée, champ inventé rejeté',
  validees.batiments && validees.batiments[0].champs.classe_construction === 'Incombustible'
  && validees.batiments[0].champs.champ_invente === undefined);

// --- 5. Insertion : les nouveaux champs arrivent dans la fiche emplacement
const sId = biens.creerSoumission({ cabinetId: cab, userId: admin, clientId });
insertion.ajouterListesAExistante(cab, utilisateur, 'biens', sId, {
  batiments: [{
    champs: {
      adresse: '500 rue des Bijoux', ville: 'Montréal', classe_construction: 'incombustible',
      voisin_gauche_affectation: 'Atelier de joaillerie', renovation_toiture_annee: 2019,
      gicleurs_couverture: 'entier',
    },
    confiance: 'haute',
  }],
});
const sApres = biens.obtenirSoumission(sId, cab);
const bIns = sApres.batiments[0];
test('insertion : fiche emplacement enrichie remplie par l\u2019analyse',
  bIns && bIns.classe_construction === 'incombustible'
  && bIns.voisin_gauche_affectation === 'Atelier de joaillerie'
  && bIns.annee_toiture === 2019 && bIns.gicleurs_couverture === 'entier');

// --- 6. Manques critiques de la combinée
const dossierId = combine.creerDossier({ cabinetId: cab, userId: admin, clientId });
const dManques = combine.obtenirDossier(dossierId, cab);
const sB2 = dManques.soumissions.biens.id;
biens.ajouterBatiment(sB2, cab, admin, { adresse: '9 rue Vide' });
const listeManques = manques.calculerManquesCombinee(combine.obtenirDossier(dossierId, cab));
const cles = new Set(listeManques.map((m) => m.cle));
test('manques combinée : agrège les volets + contrôles propres',
  cles.has('combinee:client:forme_juridique') && cles.has('combinee:dossier:date_effet'));
test('manques combinée : classe, voisinage et liaisons signalés pour l\u2019emplacement vide',
  [...cles].some((c) => c.endsWith(':classe_construction'))
  && [...cles].some((c) => c.endsWith(':voisinage'))
  && [...cles].some((c) => c.endsWith(':liaison_pe'))
  && [...cles].some((c) => c.endsWith(':liaison_rc')));
combine.definirProfilClient(clientId, cab, admin, {
  forme_juridique: 'societe_actions', annee_fondation: 1998,
  description_activites: 'Bijouterie', code_industrie: '448150',
});
combine.mettreAJourDossier(dossierId, cab, admin, { date_effet: '2026-11-01' });
const listeManques2 = manques.calculerManquesCombinee(combine.obtenirDossier(dossierId, cab));
test('manques combinée : les contrôles client/dossier se ferment après saisie',
  !listeManques2.some((m) => m.cle.startsWith('combinee:client:'))
  && !listeManques2.some((m) => m.cle === 'combinee:dossier:date_effet'));

// --- 7. Commandes IA : créer / ouvrir une combinée
const cmd1 = commandes.analyser('crée une soumission combinée pour Bijouterie IA');
test('commande analysée : creer_combinee', cmd1 && cmd1.action === 'creer_combinee'
  && /Bijouterie IA/.test(cmd1.params.client), JSON.stringify(cmd1));
const r1 = commandes.executerCommande(cab, utilisateur, cmd1);
test('création : confirmation demandée d\u2019abord', r1.statut === 'confirmation', JSON.stringify(r1));
const r2 = commandes.executerCommande(cab, utilisateur, r1.commande, { confirme: true });
test('création confirmée : dossier créé avec lien donné',
  r2.statut === 'message' && /\/combinees\/\d+/.test(r2.texte), JSON.stringify(r2));
const cmd2 = commandes.analyser('ouvre la soumission combinée de Bijouterie IA');
test('commande analysée : ouvrir_combinee', cmd2 && cmd2.action === 'ouvrir_combinee', JSON.stringify(cmd2));
const r3 = commandes.executerCommande(cab, utilisateur, cmd2);
test('ouverture : redirection vers le dossier du client',
  r3.statut === 'redirection' && /^\/combinees\/\d+$/.test(r3.url), JSON.stringify(r3));
test('actions IA : creer_combinee et ouvrir_combinee autorisées pour les moteurs externes',
  commandes.ACTIONS_COHERE.includes('creer_combinee') && commandes.ACTIONS_COHERE.includes('ouvrir_combinee'));

console.log(`\n${total - echecs}/${total} tests réussis`);
if (echecs) { console.log(`💥 ${echecs} échec(s)`); process.exit(1); }
console.log('🎉 TOUS LES TESTS PASSENT');
