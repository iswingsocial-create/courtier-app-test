/**
 * scripts/test-verification-avenant.js — Vérification automatique des
 * avenants : comparer le document de retour de l'assureur à l'état demandé
 * (fiche police courante) et produire un rapport d'écarts.
 *  1. Moteur pur (états fabriqués) : verdicts, normalisations, statuts.
 *  2. Moteur BD : construireEtatDemande depuis une vraie fiche biens.
 *  3. HTTP : section fiche police, dépôt de document, pièce jointe de
 *     courriel, rapport, « Marquer comme vérifiée », cloisonnement, CSRF.
 *  4. HTTP : courriel de correction (brouillon citant les écarts, envoi
 *     simulé — aucun courriel réel).
 * Prérequis parties 3-4 : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : CHEMIN_BD=/tmp/test-verif.db PORT=3101 node scripts/test-verification-avenant.js
 *         PARTIE=moteur pour la partie moteur seulement (sans serveur).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = `http://localhost:${process.env.PORT || 3101}`;
const PARTIE = process.env.PARTIE || 'tout';
let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

// =============================================================================
// 1. Moteur pur — états fabriqués
// =============================================================================
function partieMoteur() {
  console.log('1. Moteur de comparaison (états fabriqués)');
  const verif = require('../lib/verification-avenant');
  const analyseFab = (champs, listes = {}) => ({ champs, listes });
  const champ = (cle, valeur, confiance = 'haute', extrait = null) =>
    ({ champ: cle, valeur, confiance, extrait, libelle: cle });

  // Écart de franchise 1000 (demandé) vs 2500 (appliqué).
  let demande = { produit: 'biens', entete: {}, garanties: { 'garanties.franchise': 1000 }, listes: {} };
  let applique = verif.construireEtatApplique(analyseFab([
    champ('garanties.franchise', 2500, 'haute', 'Franchise : 2 500 $'),
  ]));
  let r = verif.comparer(demande, applique);
  let ligne = r.lignes.find((l) => l.cle === 'garanties.franchise');
  test('franchise : écart détecté (1000 vs 2500)', !!ligne && ligne.verdict === 'ecart', JSON.stringify(r.lignes));
  test('franchise : valeurs affichées formatées', ligne && ligne.demandeAffiche === '1 000 $' && ligne.appliqueAffiche === '2 500 $',
    ligne && `${ligne.demandeAffiche} / ${ligne.appliqueAffiche}`);
  test('franchise : extrait source conservé', ligne && ligne.extrait === 'Franchise : 2 500 $');
  test('statut global : ecarts', r.statut === 'ecarts', r.statut);

  // Limite conforme malgré le formatage « 2 000 000 $ » du document.
  demande = { produit: 'cyber', entete: {}, garanties: { 'garanties.limite_par_sinistre': 2000000 }, listes: {} };
  applique = verif.construireEtatApplique(analyseFab([champ('garanties.limite_par_sinistre', '2 000 000')]));
  r = verif.comparer(demande, applique);
  ligne = r.lignes.find((l) => l.cle === 'garanties.limite_par_sinistre');
  test('limite : « 2 000 000 » (texte) = 2000000 → conforme', ligne && ligne.verdict === 'conforme', JSON.stringify(ligne));
  test('statut global : conforme', r.statut === 'conforme', r.statut);

  // Dates : format français long dans le document.
  demande = { produit: 'biens', entete: { 'entete.date_effet': '2026-03-01' }, garanties: {}, listes: {} };
  applique = verif.construireEtatApplique(analyseFab([champ('entete.date_effet', '1er mars 2026')]));
  r = verif.comparer(demande, applique);
  ligne = r.lignes.find((l) => l.cle === 'entete.date_effet');
  test('date : « 1er mars 2026 » = 2026-03-01 → conforme', ligne && ligne.verdict === 'conforme', JSON.stringify(ligne));
  applique = verif.construireEtatApplique(analyseFab([champ('entete.date_effet', '15/04/2026')]));
  r = verif.comparer(demande, applique);
  ligne = r.lignes.find((l) => l.cle === 'entete.date_effet');
  test('date : 15/04/2026 ≠ 2026-03-01 → écart', ligne && ligne.verdict === 'ecart', JSON.stringify(ligne));

  // Numéro de police : casse et séparateurs normalisés.
  demande = { produit: 'biens', entete: { 'entete.numero_police': 'BIE-2026-001' }, garanties: {}, listes: {} };
  applique = verif.construireEtatApplique(analyseFab([champ('entete.numero_police', 'bie 2026 001')]));
  r = verif.comparer(demande, applique);
  ligne = r.lignes.find((l) => l.cle === 'entete.numero_police');
  test('n° police : « bie 2026 001 » = « BIE-2026-001 » → conforme', ligne && ligne.verdict === 'conforme', JSON.stringify(ligne));

  // Champ demandé absent du document.
  demande = { produit: 'cyber', entete: {}, garanties: { 'garanties.delai_carence': '8 heures' }, listes: {} };
  applique = verif.construireEtatApplique(analyseFab([]));
  r = verif.comparer(demande, applique);
  ligne = r.lignes.find((l) => l.cle === 'garanties.delai_carence');
  test('délai de carence demandé, absent du document → absent', ligne && ligne.verdict === 'absent', JSON.stringify(r.lignes));
  test('absent → statut global ecarts', r.statut === 'ecarts', r.statut);

  // Confiance basse : jamais de verdict sec.
  demande = { produit: 'biens', entete: {}, garanties: { 'garanties.franchise': 1000 }, listes: {} };
  applique = verif.construireEtatApplique(analyseFab([champ('garanties.franchise', 2500, 'basse')]));
  r = verif.comparer(demande, applique);
  ligne = r.lignes.find((l) => l.cle === 'garanties.franchise');
  test('confiance basse → a_confirmer (même si les valeurs diffèrent)', ligne && ligne.verdict === 'a_confirmer', JSON.stringify(ligne));
  test('a_confirmer seul → statut global a_confirmer', r.statut === 'a_confirmer', r.statut);

  // Bâtiments : appariement par adresse, codes normalisés, booléens.
  demande = {
    produit: 'biens', entete: {}, garanties: {},
    listes: {
      batiments: [{
        champs: {
          adresse: '1200, boul. Industriel', ville: 'Laval', type_construction: 'beton',
          annee_construction: 1998, valeur_batiment: 1500000, gicleurs: 1,
        },
        garanties: { formule: 'tous_risques', franchise: 2500, montant_assurance: 1500000 },
      }, {
        champs: { adresse: '85 rue des Érables', ville: 'Laval', valeur_batiment: 400000 },
        garanties: null,
      }],
    },
  };
  applique = verif.construireEtatApplique(analyseFab([], {
    batiments: [{
      champs: {
        adresse: '1200 boul. Industriel', ville: 'Laval', type_construction: 'Béton',
        annee_construction: 1998, valeur_batiment: 1500000, gicleurs: 'oui',
      },
      confiance: 'haute', extrait: '1200 boul. Industriel',
    }, {
      champs: { adresse: '999 rue Inconnue', ville: 'Laval', valeur_batiment: 100000 },
      confiance: 'haute', extrait: null,
    }],
  }));
  r = verif.comparer(demande, applique);
  const lignesBat = r.lignes.filter((l) => l.cle.startsWith('liste.batiments'));
  test('bâtiment apparié : construction « Béton » = beton → conforme',
    lignesBat.some((l) => l.cle === 'liste.batiments.type_construction' && l.verdict === 'conforme'), JSON.stringify(lignesBat));
  test('bâtiment apparié : gicleurs « oui » = 1 → conforme',
    lignesBat.some((l) => l.cle === 'liste.batiments.gicleurs' && l.verdict === 'conforme'), JSON.stringify(lignesBat));
  test('bâtiment apparié : valeur conforme',
    lignesBat.some((l) => l.cle === 'liste.batiments.valeur_batiment' && l.verdict === 'conforme'), JSON.stringify(lignesBat));
  test('bâtiment apparié : adresse à ponctuation différente → conforme (pas de faux écart)',
    lignesBat.some((l) => l.cle === 'liste.batiments.adresse' && l.verdict === 'conforme')
      && !lignesBat.some((l) => l.cle === 'liste.batiments.adresse' && l.verdict === 'ecart'), JSON.stringify(lignesBat));
  test('bâtiment demandé absent du document → absent',
    lignesBat.some((l) => l.verdict === 'absent' && /Érables/.test(l.contexte || '')), JSON.stringify(lignesBat));
  test('bâtiment du document non demandé → surplus',
    lignesBat.some((l) => l.verdict === 'surplus' && /Inconnue/.test(l.contexte || '')), JSON.stringify(lignesBat));

  // Garanties par bâtiment quand le document en fournit aussi.
  applique = verif.construireEtatApplique(analyseFab([], {
    batiments: [{
      champs: { adresse: '1200 boul. Industriel', ville: 'Laval' },
      confiance: 'haute', extrait: null,
      garanties: { formule: 'tous_risques', franchise: 5000, montant_assurance: 1500000 },
    }],
  }));
  const demandeUnBat = { produit: 'biens', entete: {}, garanties: {}, listes: { batiments: [demande.listes.batiments[0]] } };
  r = verif.comparer(demandeUnBat, applique);
  const lignesGar = r.lignes.filter((l) => l.cle.startsWith('liste.batiments.garanties.'));
  test('garanties par bâtiment : franchise 2500 vs 5000 → écart',
    lignesGar.some((l) => l.cle === 'liste.batiments.garanties.franchise' && l.verdict === 'ecart'), JSON.stringify(lignesGar));
  test('garanties par bâtiment : montant conforme',
    lignesGar.some((l) => l.cle === 'liste.batiments.garanties.montant_assurance' && l.verdict === 'conforme'), JSON.stringify(lignesGar));

  // Contenus : comparés seulement si l'analyse en propose.
  const demandeContenus = {
    produit: 'biens', entete: {}, garanties: {},
    listes: {
      batiments: [],
      contenus: [{ champs: { description: 'Équipements de cuisine', type_contenu: 'equipements', valeur: 80000 }, contexte: '1200, boul. Industriel' }],
    },
  };
  r = verif.comparer(demandeContenus, verif.construireEtatApplique(analyseFab([], {})));
  test('contenus : aucune ligne si l\'analyse n\'en propose pas',
    !r.lignes.some((l) => l.cle.startsWith('liste.contenus')), JSON.stringify(r.lignes));
  r = verif.comparer(demandeContenus, verif.construireEtatApplique(analyseFab([], {
    contenus: [{ champs: { description: 'Équipements de cuisine', valeur: 60000 }, confiance: 'haute', extrait: null }],
  })));
  test('contenus : valeur 80000 vs 60000 → écart',
    r.lignes.some((l) => l.cle === 'liste.contenus.valeur' && l.verdict === 'ecart'), JSON.stringify(r.lignes));

  // Véhicules : appariement par NIV ; conducteur par permis.
  demande = {
    produit: 'flotte', entete: {}, garanties: {},
    listes: {
      vehicules: [{ champs: { niv: '1FTFW1E84NFA12345', annee: 2022, marque: 'Ford', valeur: 45000 } }],
      conducteurs: [{ champs: { nom: 'Tremblay', prenom: 'Mario', numero_permis: 'T6512-010180-03' } }],
    },
  };
  applique = verif.construireEtatApplique(analyseFab([], {
    vehicules: [{ champs: { niv: '1FTFW1E84NFA12345', annee: 2022, marque: 'Ford', valeur: 47000 }, confiance: 'haute', extrait: null }],
    conducteurs: [{ champs: { nom: 'Tremblay', prenom: 'Mario', numero_permis: 'T6512-010180-03' }, confiance: 'haute', extrait: null }],
  }));
  r = verif.comparer(demande, applique);
  test('véhicule apparié par NIV, valeur différente → écart',
    r.lignes.some((l) => l.cle === 'liste.vehicules.valeur' && l.verdict === 'ecart'), JSON.stringify(r.lignes));
  test('conducteur apparié par permis, aucun écart',
    !r.lignes.some((l) => l.cle.startsWith('liste.conducteurs') && l.verdict !== 'conforme'), JSON.stringify(r.lignes));
}

// =============================================================================
// 2. Moteur BD — construireEtatDemande depuis une vraie fiche biens
// =============================================================================
function partieMoteurBd() {
  console.log('2. État demandé depuis une fiche biens réelle');
  const bd = require('../lib/bd');
  const verif = require('../lib/verification-avenant');
  const cab = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Vérif Test').lastInsertRowid;
  const client = bd.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)'
  ).run(cab, 'Boulangerie Vérif inc.', 'Véra', 'Côté').lastInsertRowid;
  const sou = bd.prepare(
    'INSERT INTO biens_soumissions (cabinet_id, client_id, statut) VALUES (?, ?, ?)'
  ).run(cab, client, 'convertie_police').lastInsertRowid;
  const bat = bd.prepare(
    `INSERT INTO biens_batiments (cabinet_id, soumission_id, adresse, ville, type_construction,
       annee_construction, valeur_batiment, gicleurs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(cab, sou, '1200, boul. Industriel', 'Laval', 'beton', 1998, 1500000, 1).lastInsertRowid;
  bd.prepare(
    'INSERT INTO biens_garanties (cabinet_id, batiment_id, formule, franchise, montant_assurance, prime) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(cab, bat, 'tous_risques', 2500, 1500000, 3200);
  bd.prepare(
    'INSERT INTO biens_contenus (cabinet_id, soumission_id, batiment_id, description, type_contenu, valeur) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(cab, sou, bat, 'Équipements de cuisine', 'equipements', 80000);
  const police = bd.prepare(
    `INSERT INTO polices (cabinet_id, client_id, ligne, assureur, numero_police, date_effet,
       date_echeance, franchise, biens_soumission_id) VALUES (?, ?, 'biens', ?, ?, ?, ?, ?, ?)`
  ).run(cab, client, 'Intact Assurance', 'BIE-2026-001', '2026-03-01', '2027-03-01', 1000, sou).lastInsertRowid;

  const p = bd.prepare('SELECT * FROM polices WHERE id = ?').get(police);
  const etat = verif.construireEtatDemande(p);
  test('produit déduit : biens', etat.produit === 'biens', etat.produit);
  test('en-tête : numéro de police', etat.entete['entete.numero_police'] === 'BIE-2026-001');
  test('en-tête : dates', etat.entete['entete.date_effet'] === '2026-03-01' && etat.entete['entete.date_echeance'] === '2027-03-01');
  test('garanties : franchise de la police (1000)', etat.garanties['garanties.franchise'] === 1000,
    JSON.stringify(etat.garanties));
  test('garanties : prime sommée des bâtiments (3200)', etat.garanties['garanties.prime'] === 3200,
    JSON.stringify(etat.garanties));
  test('listes : un bâtiment avec ses garanties',
    (etat.listes.batiments || []).length === 1 && etat.listes.batiments[0].garanties
      && etat.listes.batiments[0].garanties.franchise === 2500, JSON.stringify(etat.listes.batiments));
  test('listes : contenus aplatis avec le contexte du bâtiment',
    (etat.listes.contenus || []).length === 1 && etat.listes.contenus[0].champs.valeur === 80000
      && /Industriel/.test(etat.listes.contenus[0].contexte || ''), JSON.stringify(etat.listes.contenus));
}

(async () => {
  partieMoteur();
  partieMoteurBd();
  if (PARTIE !== 'moteur') {
    await partieHttp();
  }
  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });

// =============================================================================
// 3-4. HTTP — flux complet depuis la fiche police + courriel de correction
// =============================================================================
function nouveauJar() { return {}; }
function appliquerCookies(jar, res) {
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const [paire] = c.split(';');
    const i = paire.indexOf('=');
    if (i > 0) jar[paire.slice(0, i).trim()] = paire.slice(i + 1).trim();
  }
}
function enteteCookies(jar) {
  const paires = Object.entries(jar).map(([k, v]) => `${k}=${v}`);
  return paires.length ? { Cookie: paires.join('; ') } : {};
}
async function req(jar, methode, chemin, { form = null, data = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    corps = new URLSearchParams(form).toString();
  } else if (data) corps = data;
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  const texte = await res.text();
  return { statut: res.status, texte, location: res.headers.get('location') };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
async function loginComme(email, mdp) {
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  const csrfToken = csrf(r.texte); // jeton de session : il survit à la connexion
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrfToken, email, mot_de_passe: mdp } });
  return { jar, ok: r.statut === 302, csrfToken };
}
function fabriquerPdf(nom, lignes) {
  const PDFDocument = require('pdfkit');
  const chemin = path.join(os.tmpdir(), nom);
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const flux = fs.createWriteStream(chemin);
    doc.pipe(flux);
    doc.fontSize(13).text(lignes[0]);
    doc.fontSize(11);
    for (const l of lignes.slice(1)) doc.text(l);
    doc.end();
    flux.on('finish', () => resolve(chemin));
  });
}

async function partieHttp() {
  const Database = require('better-sqlite3');
  const bcrypt = require('bcrypt');
  const cheminBd = process.env.CHEMIN_BD;
  if (!cheminBd) { console.log('❌ CHEMIN_BD requis'); process.exit(1); }
  const bd2 = new Database(cheminBd);

  console.log('3. Flux HTTP — fiche police, dépôt, pièce jointe, rapport');
  const cabA = bd2.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const hash = bcrypt.hashSync('Test1234!', 4);
  const mkUser = (cab, email, role) => bd2.prepare(
    'INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe) VALUES (?, ?, ?, ?, ?, 0)'
  ).run(cab, email, hash, role, email).lastInsertRowid;
  const cabB = bd2.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Vérif B').lastInsertRowid;
  mkUser(cabB, 'adminb-verif@t.ca', 'admin');
  const courtier1 = mkUser(cabA, 'courtier1-verif@t.ca', 'courtier');
  const courtier2 = mkUser(cabA, 'courtier2-verif@t.ca', 'courtier');

  bd2.prepare(
    `INSERT OR IGNORE INTO assureurs (cabinet_id, nom, courriel_general, mod_nom, mod_courriel)
     VALUES (?, 'Intact Assurance', 'info@intact-exemple.ca', 'Service des modifications', 'modifications@intact-exemple.ca')`
  ).run(cabA);
  bd2.prepare(
    "UPDATE assureurs SET mod_courriel = 'modifications@intact-exemple.ca', courriel_general = 'info@intact-exemple.ca' WHERE cabinet_id = ? AND nom = 'Intact Assurance'"
  ).run(cabA);
  const assureurId = bd2.prepare(
    "SELECT id FROM assureurs WHERE cabinet_id = ? AND nom = 'Intact Assurance'"
  ).get(cabA).id;

  function creerPoliceBiens({ clientNom, numero, franchise, prime, batiment }) {
    const client = bd2.prepare(
      'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, ?, ?, ?)'
    ).run(cabA, clientNom, 'Contact', 'Test').lastInsertRowid;
    const sou = bd2.prepare(
      "INSERT INTO biens_soumissions (cabinet_id, client_id, statut) VALUES (?, ?, 'convertie_police')"
    ).run(cabA, client).lastInsertRowid;
    const bat = bd2.prepare(
      'INSERT INTO biens_batiments (cabinet_id, soumission_id, adresse, ville) VALUES (?, ?, ?, ?)'
    ).run(cabA, sou, batiment.adresse, batiment.ville).lastInsertRowid;
    bd2.prepare(
      'INSERT INTO biens_garanties (cabinet_id, batiment_id, prime) VALUES (?, ?, ?)'
    ).run(cabA, bat, prime);
    const police = bd2.prepare(
      `INSERT INTO polices (cabinet_id, client_id, ligne, assureur, assureur_id, numero_police,
         date_effet, date_echeance, franchise, biens_soumission_id)
       VALUES (?, ?, 'biens', 'Intact Assurance', ?, ?, ?, ?, ?, ?)`
    ).run(cabA, client, assureurId, numero, batiment.effet, batiment.echeance, franchise, sou).lastInsertRowid;
    return { client, sou, police };
  }

  // Police 1 : l'assureur appliquera une franchise de 2 500 $ au lieu de 1 000 $.
  const p1 = creerPoliceBiens({
    clientNom: 'Vérification HTTP inc.', numero: 'BIE-2026-777', franchise: 1000, prime: 3200,
    batiment: { adresse: '1200, boul. Industriel', ville: 'Laval', effet: '2026-03-01', echeance: '2027-03-01' },
  });
  // Police 2 : le document de l'assureur (pièce jointe) sera entièrement conforme.
  const p2 = creerPoliceBiens({
    clientNom: 'Conforme Totale inc.', numero: 'BIE-2026-888', franchise: 500, prime: 1800,
    batiment: { adresse: '85 rue des Érables', ville: 'Laval', effet: '2026-01-15', echeance: '2027-01-15' },
  });
  // Police hors portefeuille de courtier1.
  const clientHP = bd2.prepare(
    'INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, responsable_id) VALUES (?, ?, ?, ?, ?)'
  ).run(cabA, 'Hors Portefeuille Vérif inc.', 'Hors', 'P', courtier2).lastInsertRowid;
  const policeHP = bd2.prepare(
    `INSERT INTO polices (cabinet_id, client_id, ligne, assureur, numero_police, date_effet, date_echeance, franchise)
     VALUES (?, ?, 'biens', 'Intact Assurance', 'BIE-2026-999', '2026-01-01', '2027-01-01', 750)`
  ).run(cabA, clientHP).lastInsertRowid;
  const verifHP = bd2.prepare(
    `INSERT INTO verifications_avenants (cabinet_id, police_id, produit, source_type, rapport, statut)
     VALUES (?, ?, 'biens', 'document', '{"lignes":[],"compteurs":{"conforme":0,"ecart":0,"absent":0,"a_confirmer":0,"surplus":0}}', 'conforme')`
  ).run(cabA, policeHP).lastInsertRowid;

  // Pièce jointe (police 2) : courriel classé sur la police + fichier PDF sur disque.
  const pdfP2 = await fabriquerPdf('verif-avenant-pj.pdf', [
    'Avenant — Assurance de biens commerciaux',
    'Assuré nommé : Conforme Totale inc.',
    'Assureur : Intact Assurance',
    'N° de police : BIE-2026-888',
    "Date d'effet : 2026-01-15",
    "Date d'échéance : 2027-01-15",
    'Franchise : 500 $',
    'Prime : 1 800 $',
    'Bâtiment 1 :',
    'Adresse : 85 rue des Érables',
    'Ville : Laval',
  ]);
  const dirPj = path.join(__dirname, '..', 'uploads', String(cabA), 'courriels');
  fs.mkdirSync(dirPj, { recursive: true });
  const cheminPj = path.join(dirPj, 'avenant-pj-test.pdf');
  fs.copyFileSync(pdfP2, cheminPj);
  const courrielP2 = bd2.prepare(
    `INSERT INTO courriels (cabinet_id, dossier, expediteur, sujet, date_courriel, client_id, police_id)
     VALUES (?, 'reception', 'avenants@intact-exemple.ca', 'Avenant émis — police BIE-2026-888', '2026-01-20', ?, ?)`
  ).run(cabA, p2.client, p2.police).lastInsertRowid;
  const pjP2 = bd2.prepare(
    'INSERT INTO courriel_pieces_jointes (cabinet_id, courriel_id, nom, mime, taille, chemin) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(cabA, courrielP2, 'avenant-bie-2026-888.pdf', 'application/pdf', fs.statSync(cheminPj).size, cheminPj).lastInsertRowid;

  // --- Login admin + changement de mot de passe (pattern des suites) ----------
  const { jar } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', {
    form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' },
  });
  test('login admin + changement de mot de passe', r.statut === 302, String(r.statut));

  // --- Fiche police : la section est présente ---------------------------------
  r = await req(jar, 'GET', `/echeances/police/${p2.police}`);
  test('fiche police : section « Vérification de l\'avenant » présente',
    r.statut === 200 && /Vérification de l'avenant/.test(r.texte), String(r.statut));
  test('fiche police : la pièce jointe du courriel lié est proposée',
    /avenant-bie-2026-888\.pdf/.test(r.texte) && /verifier-piece-jointe/.test(r.texte));

  // --- Dépôt du document (police 1) : écart de franchise ----------------------
  const pdfP1 = await fabriquerPdf('verif-avenant-depot.pdf', [
    'Avenant — Assurance de biens commerciaux',
    'Assuré nommé : Vérification HTTP inc.',
    'Assureur : Intact Assurance',
    'N° de police : BIE-2026-777',
    "Date d'effet : 2026-03-01",
    "Date d'échéance : 2027-03-01",
    'Franchise : 2 500 $',
    'Prime : 3 200 $',
    'Bâtiment 1 :',
    'Adresse : 1200, boul. Industriel',
    'Ville : Laval',
    'Valeur du bâtiment : 1 500 000 $',
  ]);
  const fiche1 = await req(jar, 'GET', `/echeances/police/${p1.police}`);
  const fd = new FormData();
  fd.append('_csrf', csrf(fiche1.texte));
  fd.append('document', new Blob([fs.readFileSync(pdfP1)], { type: 'application/pdf' }), 'avenant-assureur.pdf');
  r = await req(jar, 'POST', `/echeances/police/${p1.police}/verifier-document`, { data: fd });
  const mVerif = (r.location || '').match(/\/verifications\/(\d+)$/);
  test('dépôt : redirection vers le rapport', r.statut === 302 && !!mVerif, `${r.statut} ${r.location}`);
  const verif1 = mVerif ? Number(mVerif[1]) : null;
  const v1 = verif1 ? bd2.prepare('SELECT * FROM verifications_avenants WHERE id = ?').get(verif1) : null;
  test('dépôt : vérification créée (source document)', !!v1 && v1.source_type === 'document' && v1.police_id === p1.police);
  test('dépôt : statut global « ecarts »', v1 && v1.statut === 'ecarts', v1 && v1.statut);
  const rapport1 = v1 ? JSON.parse(v1.rapport) : { lignes: [] };
  const ligneFr = rapport1.lignes.find((l) => l.cle === 'garanties.franchise');
  test('dépôt : le rapport contient l\'écart de franchise 1000 vs 2500',
    !!ligneFr && ligneFr.verdict === 'ecart' && ligneFr.demandeAffiche === '1 000 $' && ligneFr.appliqueAffiche === '2 500 $',
    JSON.stringify(ligneFr));
  test('dépôt : l\'analyse est rattachée à la police',
    !!v1 && !!bd2.prepare('SELECT police_id FROM analyses_documents WHERE id = ?').get(v1.analyse_id || 0)?.police_id);

  // --- Page rapport ------------------------------------------------------------
  r = await req(jar, 'GET', `/echeances/police/${p1.police}/verifications/${verif1}`);
  test('rapport : page affichée avec l\'écart en évidence',
    r.statut === 200 && /Rapport de comparaison/.test(r.texte) && /Écart/.test(r.texte) && /2 500 \$/.test(r.texte), String(r.statut));
  test('rapport : boutons correction + marquer vérifiée présents',
    /Demander la correction/.test(r.texte) && /Marquer comme vérifiée/.test(r.texte));

  // --- Pièce jointe (police 2) : tout conforme --------------------------------
  const fiche2 = await req(jar, 'GET', `/echeances/police/${p2.police}`);
  r = await req(jar, 'POST', `/echeances/police/${p2.police}/verifier-piece-jointe`, {
    form: { _csrf: csrf(fiche2.texte), piece_jointe_id: String(pjP2) },
  });
  const mVerif2 = (r.location || '').match(/\/verifications\/(\d+)$/);
  test('pièce jointe : redirection vers le rapport', r.statut === 302 && !!mVerif2, `${r.statut} ${r.location}`);
  const verif2 = mVerif2 ? Number(mVerif2[1]) : null;
  const v2 = verif2 ? bd2.prepare('SELECT * FROM verifications_avenants WHERE id = ?').get(verif2) : null;
  test('pièce jointe : source « piece_jointe_courriel »', !!v2 && v2.source_type === 'piece_jointe_courriel' && v2.source_id === pjP2);
  test('pièce jointe : statut global « conforme »', v2 && v2.statut === 'conforme',
    v2 && `${v2.statut} :: ${v2.rapport}`);
  r = await req(jar, 'GET', `/echeances/police/${p2.police}/verifications/${verif2}`);
  test('rapport conforme : aucun bouton de correction',
    r.statut === 200 && !/Demander la correction/.test(r.texte));
  r = await req(jar, 'GET', `/echeances/police/${p2.police}/verifications/${verif2}/correction`);
  test('correction sans écart : retour au rapport (302)', r.statut === 302, String(r.statut));

  // --- Marquer comme vérifiée ---------------------------------------------------
  const pageRapport = await req(jar, 'GET', `/echeances/police/${p1.police}/verifications/${verif1}`);
  r = await req(jar, 'POST', `/echeances/police/${p1.police}/verifications/${verif1}/marquer-verifiee`, {
    form: { _csrf: csrf(pageRapport.texte) },
  });
  test('marquer vérifiée : redirection', r.statut === 302 && /ok=verifiee/.test(r.location || ''), `${r.statut} ${r.location}`);
  const v1b = bd2.prepare('SELECT * FROM verifications_avenants WHERE id = ?').get(verif1);
  test('marquer vérifiée : verifiee_le et verifiee_par posés', !!v1b.verifiee_le && !!v1b.verifiee_par);
  test('marquer vérifiée : journal « avenant_verifie »',
    !!bd2.prepare("SELECT id FROM journal_audit WHERE action = 'avenant_verifie' AND details LIKE ?").get(`%#${verif1}%`));
  r = await req(jar, 'POST', `/echeances/police/${p1.police}/verifications/${verif1}/marquer-verifiee`, {
    form: { _csrf: csrf(pageRapport.texte) },
  });
  test('marquer vérifiée deux fois : refusé (400)', r.statut === 400, String(r.statut));

  // --- CSRF ---------------------------------------------------------------------
  r = await req(jar, 'POST', `/echeances/police/${p2.police}/verifier-piece-jointe`, {
    form: { piece_jointe_id: String(pjP2) },
  });
  test('CSRF : POST sans jeton → 403', r.statut === 403, String(r.statut));

  // --- Cloisonnement inter-cabinets ---------------------------------------------
  const { jar: jarB } = await loginComme('adminb-verif@t.ca', 'Test1234!');
  const pageB = await req(jarB, 'GET', '/taches');
  const csrfB = csrf(pageB.texte);
  r = await req(jarB, 'GET', `/echeances/police/${p1.police}/verifications/${verif1}`);
  test('inter-cabinets : rapport d\'un autre cabinet → 404', r.statut === 404, String(r.statut));
  r = await req(jarB, 'POST', `/echeances/police/${p1.police}/verifier-piece-jointe`, {
    form: { _csrf: csrfB, piece_jointe_id: String(pjP2) },
  });
  test('inter-cabinets : vérification sur police étrangère → 404', r.statut === 404, String(r.statut));

  // --- Portefeuille du courtier ----------------------------------------------------
  const { jar: jarC1 } = await loginComme('courtier1-verif@t.ca', 'Test1234!');
  r = await req(jarC1, 'GET', `/echeances/police/${policeHP}/verifications/${verifHP}`);
  test('hors portefeuille : rapport → 403', r.statut === 403, String(r.statut));

  console.log('4. Courriel de correction à l\'assureur');
  // --- Brouillon de correction ---------------------------------------------------
  r = await req(jar, 'GET', `/echeances/police/${p1.police}/verifications/${verif1}/correction`);
  test('correction : page affichée', r.statut === 200, String(r.statut));
  test('correction : destinataire pré-rempli (service modifications de l\'assureur)',
    /modifications@intact-exemple\.ca/.test(r.texte));
  test('correction : le brouillon cite l\'écart de franchise',
    /Franchise demandée : 1 000 \$/.test(r.texte) && /2 500 \$/.test(r.texte));
  const corpsLu = (r.texte.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/) || [])[1] || '';
  test('correction : le corps cite chaque écart relevé',
    /Franchise demandée/.test(corpsLu) && /avenant/i.test(corpsLu));

  // --- Envoi (simulé : aucun compte SMTP dans la base de test) ---------------------
  r = await req(jar, 'POST', `/echeances/police/${p1.police}/verifications/${verif1}/correction/envoyer`, {
    form: {
      _csrf: csrf(r.texte), destinataire: 'modifications@intact-exemple.ca',
      sujet: 'Correction d\'avenant — police BIE-2026-777 (Vérification HTTP inc.)',
      corps: corpsLu.replace(/&amp;/g, '&'),
    },
  });
  test('correction : envoi → redirection « correction-simule »',
    r.statut === 302 && /ok=correction-simule/.test(r.location || ''), `${r.statut} ${r.location}`);
  const v1c = bd2.prepare('SELECT * FROM verifications_avenants WHERE id = ?').get(verif1);
  test('correction : envoyée en mode simulé, journalisée sur la vérification',
    !!v1c.correction_envoyee_le && v1c.correction_mode_envoi === 'simule'
      && v1c.correction_destinataire === 'modifications@intact-exemple.ca');
  test('correction : journal « correction_avenant_envoyee »',
    !!bd2.prepare("SELECT id FROM journal_audit WHERE action = 'correction_avenant_envoyee'").get());
  test('correction : aucun courriel réel dans les envoyés (mode simulé)',
    bd2.prepare("SELECT COUNT(*) AS n FROM courriels WHERE dossier = 'envoyes' AND sujet LIKE 'Correction d''avenant%'").get().n === 0);
  const pageCorrection2 = await req(jar, 'GET', `/echeances/police/${p1.police}/verifications/${verif1}/correction`);
  r = await req(jar, 'POST', `/echeances/police/${p1.police}/verifications/${verif1}/correction/envoyer`, {
    form: {
      _csrf: csrf(pageCorrection2.texte), destinataire: 'modifications@intact-exemple.ca',
      sujet: 'Correction d\'avenant — police BIE-2026-777', corps: 'Doublon',
    },
  });
  test('correction : second envoi refusé (400)', r.statut === 400, String(r.statut));
  bd2.close();
}

