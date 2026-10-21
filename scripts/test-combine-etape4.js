/**
 * scripts/test-combine-etape4.js — Étape 4/10 « Soumission combinée » :
 * garanties structurées (règle proportionnelle, franchise contenu, avenants
 * à franchise/montant propres, bris d'équipement détaillé) et assurance
 * flottante des outils. Couche données seulement. Base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-combine4.db node scripts/test-combine-etape4.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-combine4.db';
const { execFileSync } = require('child_process');
const path = require('path');
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const biens = require('../lib/biens');
const combine = require('../lib/combine');

let echecs = 0, total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

const cab = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Garanties Test').lastInsertRowid;
const hash = bcrypt.hashSync('Test1234!', 4);
const admin = bd.prepare(
  `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
).run(cab, 'admin@garanties.ca', hash, 'Admin Garanties').lastInsertRowid;

console.log('== Étape 4/10 combinée — garanties structurées + flottante ==');

const sId = biens.creerSoumission({ cabinetId: cab, userId: admin });
const bId = biens.ajouterBatiment(sId, cab, admin, { adresse: '900 boul. Industriel', ville: 'Laval' });

// Garanties structurées avec avenants enrichis
biens.definirGaranties(bId, cab, admin, {
  formule: 'tous_risques', franchise: 1000, montant_assurance: 3000000,
  regle_proportionnelle: 90, franchise_contenu: 1000, regle_proportionnelle_contenu: 90,
  avenants: combine.normaliserAvenantsBiens({
    refoulement_egout: { present: 1, montant: 50000 },
    inondation: { present: 1, franchise: 2500, montant: 100000 },
    tremblement_terre: { present: 1, franchise_pct: 5, franchise_min: 10000 },
    frais_communautaires: { present: 1, franchise: 1000, montant: 250000 },
    bris_equipement: { present: 1, montant_par_accident: 60000, limitations: 'sur les lieux' },
    valeur_neuf: 1,
    code_inconnu: { present: 1, montant: 1 },
  }),
});
const s = biens.obtenirSoumission(sId, cab);
const g = s.batiments[0].garanties;
test('règle proportionnelle bâtiment + contenu relue',
  g.regle_proportionnelle === 90 && g.regle_proportionnelle_contenu === 90 && g.franchise_contenu === 1000);
test('avenant enrichi relu (refoulement : montant propre)',
  g.avenants.refoulement_egout.present === 1 && g.avenants.refoulement_egout.montant === 50000);
test('avenant enrichi relu (inondation : franchise + montant)',
  g.avenants.inondation.franchise === 2500 && g.avenants.inondation.montant === 100000);
test('tremblement de terre : sous-franchises (% et minimum) relues',
  g.avenants.tremblement_terre.franchise_pct === 5 && g.avenants.tremblement_terre.franchise_min === 10000);
test('frais communautaires (copropriété) relus',
  g.avenants.frais_communautaires.montant === 250000);
test('bris d\u2019équipement : montant par accident + limitations relus',
  g.avenants.bris_equipement.montant_par_accident === 60000
  && g.avenants.bris_equipement.limitations === 'sur les lieux');
test('avenant historique (valeur 1) compatible', g.avenants.valeur_neuf === 1);
test('code d\u2019avenant inconnu écarté par la normalisation', g.avenants.code_inconnu === undefined);
test('avenantActif reconnaît les deux formats',
  combine.avenantActif(1) && combine.avenantActif({ present: 1 }) && !combine.avenantActif(0)
  && !combine.avenantActif({ present: 0 }) && !combine.avenantActif(null));

// Flottante des outils
const a1 = combine.ajouterArticleFlottante(sId, cab, admin, {
  description: 'Outils divers et ventilateur', base_reglement: 'Valeur à neuf', montant: 15000,
});
const a2 = combine.ajouterArticleFlottante(sId, cab, admin, {
  description: 'Génératrice portative', montant: 8000,
});
test('articles de flottante ajoutés', a1 > 0 && a2 > 0);
let articles = combine.listerArticlesFlottante(sId, cab);
test('liste des articles relue (2)', articles.length === 2 && articles[0].montant === 15000);
combine.modifierArticleFlottante(a2, cab, admin, { montant: 9500 });
articles = combine.listerArticlesFlottante(sId, cab);
test('article modifié relu', articles.find((x) => x.id === a2).montant === 9500);
combine.archiverArticleFlottante(a1, cab, admin);
articles = combine.listerArticlesFlottante(sId, cab);
const avecArchives = combine.listerArticlesFlottante(sId, cab, { inclureArchives: true });
test('archivage doux : masqué par défaut, conservé en base (règle d\u2019or)',
  articles.length === 1 && avecArchives.length === 2);
const totalFlottante = avecArchives.filter((x) => !x.archive).reduce((n, x) => n + (x.montant || 0), 0);
test('total de la flottante calculable (annexe)', totalFlottante === 9500);

// Dictionnaire
const sortie = execFileSync('node', [path.join(__dirname, 'generer-dictionnaire.js')], {
  encoding: 'utf8', env: { ...process.env, CHEMIN_BD: process.env.CHEMIN_BD },
});
test('dictionnaire complet et cohérent — état final (99 tables, 1391 colonnes)',
  /99 tables, 1391 colonnes/.test(sortie), sortie.trim().slice(0, 120));

console.log(`\n${total - echecs}/${total} tests réussis`);
if (echecs) { console.log(`💥 ${echecs} échec(s)`); process.exit(1); }
console.log('🎉 TOUS LES TESTS PASSENT');
