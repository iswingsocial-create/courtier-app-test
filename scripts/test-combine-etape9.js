/**
 * scripts/test-combine-etape9.js — Étape 9/10 « Soumission combinée » :
 * proposition combinée au gabarit réel (demande de prix → renseignements
 * généraux → sommaire police antérieure/réclamations → tableau des
 * garanties consolidé → page par emplacement → bénéficiaires → annexes
 * conditionnelles), PDF, et brouillon « demande de prix ».
 * Couche données seulement. Base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-combine9.db node scripts/test-combine-etape9.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-combine9.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const biens = require('../lib/biens');
const rc = require('../lib/rc');
const pe = require('../lib/pe');
const combine = require('../lib/combine');
const prop = require('../lib/proposition-combinee');
const { genererPropositionCombineePdf } = require('../lib/proposition-combinee-pdf');

let echecs = 0, total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

(async () => {
  console.log('== Étape 9/10 combinée — proposition au gabarit réel ==');

  const cab = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Proposition Test').lastInsertRowid;
  combine.majEnteteCabinet(cab, 1, {
    adresse: '100 rue du Courtier', ville: 'Montréal', code_postal: 'H2Y 1A1',
    telephone: '(514) 555-0100', telecopieur: '(514) 555-0101',
    site_web: 'www.courtier-proposition.example', courriel: 'info@courtier-proposition.example',
  });
  const hash = bcrypt.hashSync('Test1234!', 4);
  const admin = bd.prepare(
    `INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)`
  ).run(cab, 'admin@proposition.ca', hash, 'Admin Proposition').lastInsertRowid;
  const clientId = bd.prepare(
    `INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, forme_juridique, annee_fondation)
     VALUES (?, 'Bijouterie Proposition inc.', 'Jo', 'Ailler', 'societe_actions', 1998)`
  ).run(cab).lastInsertRowid;

  const dossierId = combine.creerDossier({
    cabinetId: cab, userId: admin, clientId,
    donnees: {
      date_effet: '2026-11-01', date_echeance: '2027-11-01', plan_paiement: 'Mensuel',
      signataire_nom: 'Pat Courtier', signataire_titre: 'Courtier en assurance de dommages',
      date_signature: '2026-10-21', remarques_diverses: 'Renouvellement sans interruption.',
    },
  });
  const d0 = combine.obtenirDossier(dossierId, cab);
  const sB = d0.soumissions.biens.id;
  const sRC = d0.soumissions.rc.id;
  const sPE = d0.soumissions.perte_exploitation.id;

  const bId = biens.ajouterBatiment(sB, cab, admin, {
    adresse: '500 rue des Bijoux', ville: 'Montréal', classe_construction: 'incombustible',
    voisin_gauche_affectation: 'Atelier de joaillerie', voisin_gauche_distance_m: 0,
    annee_construction: 1999, gicleurs: 1, gicleurs_couverture: 'entier',
  });
  biens.ajouterContenu(sB, cab, admin, { description: 'Inventaire de bijoux', valeur: 750000 }, bId);
  biens.definirGaranties(bId, cab, admin, {
    formule: 'tous_risques', montant_assurance: 2000000, franchise: 1000, regle_proportionnelle: 90,
    franchise_contenu: 1000, regle_proportionnelle_contenu: 90,
    avenants: combine.normaliserAvenantsBiens({ refoulement_egout: { present: 1, montant: 50000 } }),
  });
  combine.ajouterBeneficiaire(bId, cab, admin, {
    nom: 'Banque Exemple', qualite: 'Créancier hypothécaire', clause_preavis: '30 jours',
  });
  combine.ajouterArticleFlottante(sB, cab, admin, { description: 'Outils de joaillerie', montant: 25000 });
  const lieuId = rc.ajouterExploitation(sRC, cab, admin, {
    adresse: '500 rue des Bijoux', ville: 'Montréal', batiment_id: bId,
  });
  rc.definirGaranties(lieuId, cab, admin, {
    formule: 'globale', limite_par_sinistre: 2000000, franchise: 1000,
    responsabilite_locative: 500000, umbrella_montant: 5000000, umbrella_retention: 10000,
    umbrella_polices_base: ['RC générale'],
  });
  pe.ajouterEtablissement(sPE, cab, admin, {
    nom_lieu: 'Magasin', adresse: '500 rue des Bijoux', montant_pe: 300000, batiment_id: bId,
  });
  pe.definirGaranties(sPE, cab, admin, {
    limite: 500000, periode_indemnite_mois: 18, franchise_jours: 3, base_montant: 'benefice_brut',
    formule: 'benefice_brut', regle_proportionnelle: 90, honoraires_comptables: 25000,
  });
  combine.synchroniserAntecedents(dossierId, cab, admin, {
    assureur_actuel: 'Intact', numero_police_actuelle: 'P-123', prime_precedente: 21000,
    refus_resiliation_nonrenouvellement: 0,
    sinistres_5ans: [{ date: '2024-05-01', type: 'Vol', montant: 8000, montant_paye: 7500, reserve: 500, statut: 'Fermé', description: 'Vol par effraction' }],
  });

  const d = combine.obtenirDossier(dossierId, cab);
  const p = prop.preparerPropositionCombinee(cab, d);
  test('données préparées : 1 emplacement, flottante, umbrella détectée',
    p.emplacements.length === 1 && p.flottante.length === 1 && p.umbrellaPresente === true);
  test('en-tête du cabinet repris (adresse, télécopieur)',
    p.cabinet.adresse === '100 rue du Courtier' && p.cabinet.telecopieur === '(514) 555-0101');

  const norm = (s) => String(s).replace(/[  ]/g, ' ');
  const html = norm(prop.rendreHtmlPropositionCombinee(p));
  const sections = [
    'DEMANDE DE SOUMISSION — ASSURANCE COMBINÉE',
    'RENSEIGNEMENTS GÉNÉRAUX',
    'SOMMAIRE — POLICE ANTÉRIEURE ET RÉCLAMATIONS',
    'TABLEAU DES GARANTIES',
    'EMPLACEMENT 1 — 500 rue des Bijoux',
    'BÉNÉFICIAIRES',
    'ANNEXE — ASSURANCE FLOTTANTE DES OUTILS',
    'ANNEXE — POLICE UMBRELLA',
  ];
  let ordreOk = true;
  let pos = -1;
  for (const s of sections) {
    const i = html.indexOf(s);
    if (i === -1 || i < pos) ordreOk = false;
    pos = i;
    test('section présente (dans l\u2019ordre du gabarit) : ' + s, i !== -1 && ordreOk);
  }
  test('tableau consolidé : colonnes Taux et Prime présentes mais vides (demande de prix)',
    html.includes('<th class="num">Taux</th>') && html.includes('<th class="num">Prime</th>'));
  test('tableau consolidé : ligne bâtiment avec franchise, règle prop. et montant',
    html.includes('Bâtiment (Tous risques)') && html.includes('2 000 000 $') && html.includes('90 %'));
  test('tableau consolidé : avenant refoulement avec son montant propre', html.includes('Refoulement d\u2019égout') && html.includes('50 000 $'));
  test('tableau consolidé : honoraires de comptables', html.includes('Honoraires de comptables') && html.includes('25 000 $'));
  test('sommaire : réclamation avec réserve et statut', html.includes('Vol par effraction') && html.includes('Fermé'));
  test('emplacement : voisinage structuré imprimé', html.includes('Atelier de joaillerie'));
  test('emplacement : classe de construction assureur imprimée', html.includes('Incombustible'));
  test('bénéficiaire imprimé avec sa clause de préavis', html.includes('Banque Exemple') && html.includes('30 jours'));
  test('signature imprimée', html.includes('Pat Courtier') && html.includes('Courtier en assurance de dommages'));
  test('remarques diverses imprimées', html.includes('Renouvellement sans interruption.'));

  // Annexe conditionnelle absente quand pas d'umbrella ni de flottante
  const dossier2 = combine.creerDossier({ cabinetId: cab, userId: admin, clientId });
  const p2 = prop.preparerPropositionCombinee(cab, combine.obtenirDossier(dossier2, cab));
  const html2 = norm(prop.rendreHtmlPropositionCombinee(p2));
  test('annexes conditionnelles absentes sans flottante ni umbrella',
    !html2.includes('ANNEXE — ASSURANCE FLOTTANTE') && !html2.includes('ANNEXE — POLICE UMBRELLA'));

  // PDF
  const pdf = await genererPropositionCombineePdf(p);
  test('PDF généré (en-tête %PDF, taille raisonnable)',
    Buffer.isBuffer(pdf) && pdf.slice(0, 4).toString() === '%PDF' && pdf.length > 4000, String(pdf.length));
  // pdfkit écrit le texte en chaînes hexadécimales dans les flux : on décode.
  const brut = pdf.toString('latin1');
  const morceaux = [];
  const re = /<([0-9A-Fa-f]+)>/g;
  let mm;
  while ((mm = re.exec(brut))) {
    try { morceaux.push(Buffer.from(mm[1], 'hex').toString('latin1')); } catch { /* ignore */ }
  }
  const textePdf = norm(morceaux.join(''));
  test('PDF : texte lisible dans le flux (chaînes décodées)',
    textePdf.includes('DEMANDE DE SOUMISSION') && textePdf.includes('RENSEIGNEMENTS'));
  test('PDF : page emplacement et tableau des garanties présents',
    textePdf.includes('EMPLACEMENT 1') && textePdf.includes('TABLEAU DES GARANTIES'));

  // Brouillon demande de prix
  const { sujet, contenu } = prop.texteBrouillonDemandePrix(p);
  test('brouillon : sujet et contenu de la demande de prix',
    sujet.includes('Demande de prix') && sujet.includes('Bijouterie Proposition')
    && contenu.includes('proposition combinée complète'));
  const rb = bd.prepare(`
    INSERT INTO brouillons (cabinet_id, type, sujet, contenu, statut, combine_dossier_id)
    VALUES (?, 'demande_prix', ?, ?, 'brouillon', ?)
  `).run(cab, sujet, contenu, dossierId);
  const brouillon = bd.prepare('SELECT * FROM brouillons WHERE id = ?').get(rb.lastInsertRowid);
  test('brouillon inséré sans police ni facture (CHECK assoupli), statut brouillon',
    brouillon && brouillon.type === 'demande_prix' && brouillon.statut === 'brouillon'
    && brouillon.police_id === null && brouillon.combine_dossier_id === dossierId);
  console.log(`\n${total - echecs}/${total} tests réussis`);
  if (echecs) { console.log(`💥 ${echecs} échec(s)`); process.exit(1); }
  console.log('🎉 TOUS LES TESTS PASSENT');
})().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
