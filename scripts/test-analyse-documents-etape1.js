/**
 * scripts/test-analyse-documents-etape1.js — « Analyse de documents IA »
 * étape 1/5 : fondation (table analyses_documents, modèle, audit) et
 * extraction de texte (PDF natif via pdfkit + pdf-parse, OCR local français
 * sur la fixture scripts/fixtures/analyse-ocr.png, docx simple, format
 * limité honnête).
 * Prérequis : base FRAÎCHE via CHEMIN_BD, SANS serveur.
 * Usage : CHEMIN_BD=/tmp/test-analyse1.db node scripts/test-analyse-documents-etape1.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-analyse1.db';
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const analyses = require('../lib/analyses-documents');
const extraction = require('../lib/extraction-document');

let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

(async () => {
  console.log('== Analyse de documents IA — étape 1 : fondation + extraction ==');

  // Préparation : 2 cabinets
  const cab1 = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet A').lastInsertRowid;
  const cab2 = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet B').lastInsertRowid;
  const hash = bcrypt.hashSync('Test1234!', 4);
  const admin1 = bd.prepare(
    `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
  ).run(cab1, 'admin1@t.ca', hash, 'Admin Un').lastInsertRowid;
  const admin2 = bd.prepare(
    `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
  ).run(cab2, 'admin2@t.ca', hash, 'Admin Deux').lastInsertRowid;

  // 1. Schéma
  const tables = bd.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('analyses_documents','reglages_ia')"
  ).all().map((t) => t.name);
  test('schéma : tables analyses_documents et reglages_ia créées',
    tables.includes('analyses_documents') && tables.includes('reglages_ia'), tables.join(','));

  // 2. Création + cycle de statuts
  const id = analyses.creerAnalyse(cab1, admin1, {
    nomOrigine: 'police-beneva.pdf', chemin: '/tmp/police-beneva.pdf',
    mime: 'application/pdf', taille: 12345,
  });
  test('analyse créée (id > 0)', id > 0);
  let a = analyses.obtenirAnalyse(id, cab1);
  test('statut initial « recu »', a && a.statut === 'recu', a && a.statut);
  test('champs proposés vides au départ', a && Array.isArray(a.champs) && a.champs.length === 0);

  analyses.enregistrerExtraction(id, cab1, admin1, { texte: 'Assureur : Beneva', methode: 'pdf' });
  a = analyses.obtenirAnalyse(id, cab1);
  test('extraction enregistrée (texte + méthode)', a.texte_extrait === 'Assureur : Beneva' && a.methode_extraction === 'pdf');

  analyses.enregistrerPropositions(id, cab1, admin1, {
    produit: 'auto', confianceGlobale: 0.82, moteur: 'local',
    champs: [{ produit: 'auto', champ: 'entete.assureur', table: 'polices', colonne: 'assureur', libelle: 'Assureur', valeur: 'Beneva', confiance: 'haute', extrait: 'Assureur : Beneva' }],
    message: null,
  });
  a = analyses.obtenirAnalyse(id, cab1);
  test('propositions enregistrées → statut « a_reviser »', a.statut === 'a_reviser', a.statut);
  test('champs proposés relus (JSON)', a.champs.length === 1 && a.champs[0].valeur === 'Beneva');
  test('produit + confiance relus', a.produit_detecte === 'auto' && Math.abs(a.confiance_globale - 0.82) < 0.001);

  analyses.marquerInseree(id, cab1, admin1, { produit: 'auto', soumissionId: 42 });
  a = analyses.obtenirAnalyse(id, cab1);
  test('marquée insérée (statut + ids)', a.statut === 'insere' && a.soumission_id === 42 && a.produit_insere === 'auto');

  // 3. Liste + cloisonnement
  const id2 = analyses.creerAnalyse(cab2, admin2, {
    nomOrigine: 'autre.png', chemin: '/tmp/autre.png', mime: 'image/png', taille: 10,
  });
  test('liste cabinet A : 1 analyse', analyses.listerAnalyses(cab1).length === 1);
  test('cloisonnement : cabinet B ne voit pas l analyse de A', analyses.obtenirAnalyse(id, cab2) === null);
  test('cloisonnement : cabinet A ne voit pas l analyse de B', analyses.obtenirAnalyse(id2, cab1) === null);

  // 4. Archivage doux (règle d'or)
  test('archivage', analyses.archiverAnalyse(id, cab1, admin1) === true);
  test('archivée exclue des lectures normales', analyses.obtenirAnalyse(id, cab1) === null);
  test('archivée lisible avec inclureArchives', analyses.obtenirAnalyse(id, cab1, { inclureArchives: true }) !== null);
  test('désarchivage (restorable)', analyses.desarchiverAnalyse(id, cab1, admin1) === true);
  test('désarchivée réapparaît', analyses.obtenirAnalyse(id, cab1) !== null);
  const nLignes = bd.prepare('SELECT COUNT(*) AS n FROM analyses_documents').get().n;
  test('aucune ligne perdue (2 analyses en base)', nLignes === 2, `n=${nLignes}`);

  // 5. Audit analyse_%
  const nAudit = bd.prepare(
    "SELECT COUNT(*) AS n FROM journal_audit WHERE action LIKE 'analyse_%'"
  ).get().n;
  test('journal d audit alimenté (analyse_%, ≥ 5)', nAudit >= 5, `n=${nAudit}`);

  // 6. Règle d'or statique
  const srcModele = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analyses-documents.js'), 'utf8');
  test('lib/analyses-documents.js : aucun DELETE FROM analyses_documents', !/DELETE\s+FROM\s+analyses_documents/i.test(srcModele));
  test('lib/analyses-documents.js : aucun DROP TABLE', !/DROP\s+TABLE/i.test(srcModele));

  // 7. Extraction PDF natif (pdfkit → pdf-parse)
  const PDFDocument = require('pdfkit');
  const cheminPdf = path.join(os.tmpdir(), 'analyse-test-police.pdf');
  await new Promise((resolve) => {
    const doc = new PDFDocument();
    const flux = fs.createWriteStream(cheminPdf);
    doc.pipe(flux);
    doc.fontSize(14).text("Proposition d'assurance automobile FPQ1");
    doc.fontSize(12).text('Assure : Garage Saint-Michel inc.');
    doc.text('Assureur : Beneva');
    doc.text('Numero de police : AUTO-2026-1234');
    doc.text('Prime : 1 875 $');
    doc.end();
    flux.on('finish', resolve);
  });
  const extPdf = await extraction.extraireTexte({ chemin: cheminPdf, mime: 'application/pdf', nom: 'police.pdf' });
  test('PDF : méthode « pdf »', extPdf.methode === 'pdf', extPdf.methode);
  test('PDF : texte extrait contient l assureur', /Beneva/.test(extPdf.texte), extPdf.texte.slice(0, 80));
  test('PDF : texte extrait contient le n° de police', /AUTO-2026-1234/.test(extPdf.texte));
  test('PDF : marqueurs de page pdf-parse retirés', !/--\s*1 of 1\s*--/.test(extPdf.texte));

  // 8. Extraction OCR local (fixture PNG générée avec PIL, texte connu)
  const fixture = path.join(__dirname, 'fixtures', 'analyse-ocr.png');
  if (fs.existsSync(fixture)) {
    const extOcr = await extraction.extraireTexte({ chemin: fixture, mime: 'image/png', nom: 'scan.png' });
    test('OCR : méthode « ocr »', extOcr.methode === 'ocr', extOcr.methode);
    test('OCR : texte reconnu contient « Beneva »', /Beneva/i.test(extOcr.texte), extOcr.texte.slice(0, 80));
    test('OCR : texte reconnu contient « 875 » (prime)', /875/.test(extOcr.texte), extOcr.texte.slice(0, 120));
  } else {
    test('OCR : fixture présente', false, 'scripts/fixtures/analyse-ocr.png absente');
  }

  // 9. Format accepté mais extraction limitée (.doc binaire)
  const cheminDoc = path.join(os.tmpdir(), 'analyse-test.doc');
  fs.writeFileSync(cheminDoc, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]));
  const extDoc = await extraction.extraireTexte({ chemin: cheminDoc, mime: 'application/msword', nom: 'vieux.doc' });
  test('DOC binaire : pas de crash, texte vide', extDoc.texte === '');
  test('DOC binaire : avertissement honnête « extraction limitée »', /extraction limitée/i.test(extDoc.avertissement || ''), extDoc.avertissement);

  // 10. Fichier corrompu : échec propre, pas d'exception
  const cheminKo = path.join(os.tmpdir(), 'analyse-test-ko.pdf');
  fs.writeFileSync(cheminKo, 'ceci n est pas un pdf');
  const extKo = await extraction.extraireTexte({ chemin: cheminKo, mime: 'application/pdf', nom: 'ko.pdf' });
  test('PDF corrompu : échec propre avec avertissement', extKo.texte === '' && !!extKo.avertissement);

  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
