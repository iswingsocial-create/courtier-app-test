/**
 * scripts/test-garde-fous-ia.js — Revue complète 2026-10-21 : garde-fous IA.
 *
 * Exigence de Patrick : l'IA ne doit jamais partir en déroute, être le plus
 * précis possible et ne JAMAIS se fier à un autre dossier pour répondre.
 * Vérifie, SANS aucun appel réel (moteurs externes simulés par stubs) :
 *  (i)   un document du client A ne produit jamais une donnée du client B —
 *        toute valeur d'un moteur externe introuvable dans le document
 *        source est rejetée (champs ET listes) ;
 *  (ii)  un champ absent du document sort « absent / à confirmer », jamais
 *        une valeur inventée (réponse 100 % inventée → rejet → repli local) ;
 *  (iii) une sortie malformée (prose sans JSON) est rejetée et le moteur
 *        local prend le relais — rien d'invalide n'est proposé ;
 *  (iv)  l'extraction part en température 0 et en mode JSON strict, avec
 *        l'invite d'ancrage (« UNIQUEMENT à partir du document fourni »).
 *
 * Prérequis : base FRAÎCHE via CHEMIN_BD, SANS serveur.
 * Usage : CHEMIN_BD=/tmp/test-garde-fous.db node scripts/test-garde-fous-ia.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-garde-fous.db';
const moteur = require('../lib/analyse-document');
const reglagesIA = require('../lib/reglages-ia');
const augure = require('../lib/augure');

let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

// --- Documents : A = le dossier en cours, B = un AUTRE dossier ---------------
const DOC_A = [
  "Police d'assurance de biens commerciaux",
  'Assuré : Boulangerie Alpha inc.',
  'Assureur : Intact Assurance',
  'N° de police : BIENS-2026-111',
  "Date d'effet : 2026-11-01",
  "Date d'échéance : 2027-11-01",
  'Prime : 3 200 $',
  'Bâtiment 1 : 100 rue des Pins, Montréal',
].join('\n');

// Réponse « contaminée » : le moteur externe y mélange les données du
// client B (entreprise, police, prime, franchise, bâtiment) et une seule
// donnée réellement présente dans le document A (l'assureur).
const REPONSE_CONTAMINEE = JSON.stringify({
  produit: 'biens',
  champs: [
    { champ: 'client.entreprise', valeur: 'Transport Bravo inc.', confiance: 'haute' },
    { champ: 'entete.assureur', valeur: 'Intact Assurance', confiance: 'haute' },
    { champ: 'entete.numero_police', valeur: 'FLT-2026-999', confiance: 'haute' },
    { champ: 'garanties.prime', valeur: 87500, confiance: 'haute' },
    { champ: 'garanties.franchise', valeur: 2500, confiance: 'haute' },
  ],
  listes: {
    batiments: [{ champs: { adresse: '999 boul. Industriel, Laval', ville: 'Laval' }, confiance: 'haute' }],
  },
});

(async () => {
  console.log('== Garde-fous IA — ancrage strict au document en cours ==');

  // --- 0. Traçabilité : formes équivalentes reconnues, inventions rejetées ---
  console.log('0. Vérification de traçabilité des valeurs');
  test('montant formaté « 2 000 000 $ » trace 2000000', moteur.valeurTracee(2000000, 'Limite : 2 000 000 $') === true);
  test('montant abrégé « 2 M $ » trace 2000000', moteur.valeurTracee(2000000, 'Limite : 2 M $') === true);
  test('date « 1er mars 2027 » trace 2027-03-01', moteur.valeurTracee('2027-03-01', 'Échéance : 1er mars 2027') === true);
  test('code « reclamations_presentees » trace « réclamations présentées »',
    moteur.valeurTracee('reclamations_presentees', 'Base : réclamations présentées') === true);
  test('assureur d\'un autre dossier non tracé', moteur.valeurTracee('Beneva', DOC_A) === false);
  test('montant absent non tracé', moteur.valeurTracee(500, 'Franchise : 1 000 $') === false);

  // --- (i) Contamination inter-dossiers : rejetée ------------------------------
  console.log('(i) Aucune donnée d\'un autre dossier');
  const localA = moteur.analyserLocal(DOC_A);
  const rContaminee = moteur.traiterReponseAnalyse(REPONSE_CONTAMINEE, DOC_A, localA, 'Augure');
  test('entreprise du client B rejetée', !rContaminee.champs.some((c) => c.champ === 'client.entreprise'));
  test('n° de police du client B rejeté', !rContaminee.champs.some((c) => c.champ === 'entete.numero_police'));
  test('prime du client B rejetée', !rContaminee.champs.some((c) => c.champ === 'garanties.prime'));
  test('aucune valeur du client B dans le résultat',
    !JSON.stringify(rContaminee).includes('Bravo') && !JSON.stringify(rContaminee).includes('87500')
    && !JSON.stringify(rContaminee).includes('FLT-2026-999') && !JSON.stringify(rContaminee).includes('Laval'));
  test('bâtiment du client B rejeté (liste filtrée)', !rContaminee.listes.batiments);
  test('la donnée réellement présente (assureur A) est conservée',
    rContaminee.champs.some((c) => c.champ === 'entete.assureur' && c.valeur === 'Intact Assurance'));
  test('rejets d\'ancrage comptés (≥ 5)', (rContaminee.rejetesAncrage || 0) >= 5, String(rContaminee.rejetesAncrage));
  test('message signale les valeurs écartées', /écartée\(s\)/.test(rContaminee.message || ''));
  test('moteur local sur A : aucune donnée de B non plus',
    !JSON.stringify(localA).includes('Bravo') && localA.champs.some((c) => c.valeur === 'Intact Assurance'));

  // --- (ii) Champ absent → « à confirmer », jamais inventé ----------------------
  console.log('(ii) Aucune invention de valeur absente');
  test('franchise absente du document : rejetée des propositions',
    !rContaminee.champs.some((c) => c.champ === 'garanties.franchise'));
  let lancee = null;
  try {
    moteur.traiterReponseAnalyse(JSON.stringify({
      produit: 'biens',
      champs: [{ champ: 'garanties.franchise', valeur: 2500, confiance: 'haute' }],
      listes: {},
    }), DOC_A, localA, 'Augure');
  } catch (e) { lancee = e; }
  test('réponse 100 % inventée → rejetée (« sans champ valide »)', !!lancee && /sans champ valide/.test(lancee.message), lancee && lancee.message);

  // --- (iii) + (iv) Via analyser() : stubs, température 0, repli local ----------
  console.log('(iii) Sortie malformée → repli local ; (iv) réglages déterministes');
  const moteurEffectifOrig = reglagesIA.moteurEffectif;
  const appelAugureOrig = augure.appelerAugureCabinet;
  const appelCohereOrig = reglagesIA.appelerCohereCabinet;
  let optionsAugure = null;
  let argsCohere = null;
  try {
    reglagesIA.moteurEffectif = () => ({ mode: 'augure', choix: 'auto', cleAugurePresente: true, cleCoherePresente: false, modeleAugure: 'ossington-5' });
    augure.appelerAugureCabinet = async (cabinetId, options) => { optionsAugure = options; return REPONSE_CONTAMINEE; };
    const r1 = await moteur.analyser(DOC_A, { cabinetId: 1 });
    test('analyser() via Augure simulé : moteur « augure »', r1.moteur === 'augure', r1.moteur);
    test('analyser() via Augure simulé : contamination filtrée',
      r1.champs.every((c) => c.valeur !== 'Transport Bravo inc.' && c.valeur !== 87500) && !r1.listes.batiments);
    test('Augure appelé en mode JSON strict', !!optionsAugure && optionsAugure.jsonMode === true);
    test('Augure appelé en température 0 (déterministe)', !!optionsAugure && optionsAugure.temperature === 0);
    test('invite d\'ancrage envoyée : « UNIQUEMENT à partir du document »',
      !!optionsAugure && /UNIQUEMENT à partir du document fourni/.test(optionsAugure.prompt));
    test('invite d\'ancrage : le texte envoyé est le document en cours seulement',
      !!optionsAugure && optionsAugure.prompt.includes('Boulangerie Alpha inc.') && !optionsAugure.prompt.includes('Transport Bravo'));

    augure.appelerAugureCabinet = async () => 'Voici mon analyse en prose, sans aucun JSON structuré.';
    const r2 = await moteur.analyser(DOC_A, { cabinetId: 1 });
    test('sortie malformée : repli sur le moteur local', r2.moteur === 'local', r2.moteur);
    test('sortie malformée : propositions = celles du moteur local (assureur A)',
      r2.champs.some((c) => c.champ === 'entete.assureur' && c.valeur === 'Intact Assurance'));
    test('sortie malformée : message de repli signalé', /Repli sur le moteur local/.test(r2.message || ''), r2.message || '');

    reglagesIA.moteurEffectif = () => ({ mode: 'cohere', choix: 'auto', cleAugurePresente: false, cleCoherePresente: true, modeleAugure: null });
    reglagesIA.appelerCohereCabinet = async (cabinetId, prompt, options) => { argsCohere = { prompt, options }; return REPONSE_CONTAMINEE; };
    const r3 = await moteur.analyser(DOC_A, { cabinetId: 1 });
    test('analyser() via Cohere simulé : moteur « cohere »', r3.moteur === 'cohere', r3.moteur);
    test('Cohere appelé en température 0 (déterministe)', !!argsCohere && !!argsCohere.options && argsCohere.options.temperature === 0);
    test('Cohere : contamination filtrée de la même façon',
      r3.champs.every((c) => c.valeur !== 'Transport Bravo inc.' && c.valeur !== 87500));
  } finally {
    reglagesIA.moteurEffectif = moteurEffectifOrig;
    augure.appelerAugureCabinet = appelAugureOrig;
    reglagesIA.appelerCohereCabinet = appelCohereOrig;
  }

  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
