/**
 * scripts/test-analyse-moteur.js — « Analyse de documents IA » étape 2/5 :
 * moteur de correspondance local (lib/analyse-document.js) — détection du
 * produit et proposition de champs sur des textes synthétiques par produit
 * (FPQ1, biens, RC, cyber, PE, flotte, cautionnement), texte ambigu →
 * produit indéterminé honnête, aucune écriture en base métier.
 * Prérequis : base FRAÎCHE via CHEMIN_BD, SANS serveur (le moteur est pur,
 * la base ne sert qu'à vérifier qu'il n'écrit RIEN).
 * Usage : CHEMIN_BD=/tmp/test-analyse2.db node scripts/test-analyse-moteur.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-analyse2.db';
const bd = require('../lib/bd');
const moteur = require('../lib/analyse-document');

let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
function champ(r, cle) { return r.champs.find((c) => c.champ === cle); }

(async () => {
  console.log('== Analyse de documents IA — étape 2 : moteur de correspondance local ==');

  // --- FPQ1 -------------------------------------------------------------------
  const txtAuto = [
    "Proposition d'assurance automobile — Formulaire FPQ1",
    'Assuré : Garage Saint-Michel inc.',
    'NEQ : 1234567890',
    'Assureur : Beneva',
    'N° de police : AUTO-2026-1234',
    "Date d'effet : 2026-11-01",
    "Date d'échéance : 2027-11-01",
    'Prime : 1 875 $',
    'Franchise : 500 $',
    'Véhicule : Ford Transit 2022',
    'NIV : 1FTBW3CM5KKB12345',
    'Code postal : H2X 1Y4',
  ].join('\n');
  const rAuto = moteur.analyserLocal(txtAuto);
  test('FPQ1 : produit détecté « auto »', rAuto.produit === 'auto', JSON.stringify(rAuto.produit));
  test('FPQ1 : entreprise extraite', champ(rAuto, 'client.entreprise')?.valeur === 'Garage Saint-Michel inc.', JSON.stringify(champ(rAuto, 'client.entreprise')));
  test('FPQ1 : NEQ extrait', champ(rAuto, 'client.neq')?.valeur === '1234567890');
  test('FPQ1 : assureur extrait (confiance haute)', champ(rAuto, 'entete.assureur')?.valeur === 'Beneva' && champ(rAuto, 'entete.assureur')?.confiance === 'haute');
  test('FPQ1 : n° de police extrait', champ(rAuto, 'entete.numero_police')?.valeur === 'AUTO-2026-1234');
  test('FPQ1 : dates effet/échéance extraites', champ(rAuto, 'entete.date_effet')?.valeur === '2026-11-01' && champ(rAuto, 'entete.date_echeance')?.valeur === '2027-11-01');
  test('FPQ1 : prime et franchise en nombres', champ(rAuto, 'garanties.prime')?.valeur === 1875 && champ(rAuto, 'garanties.franchise')?.valeur === 500);
  test('FPQ1 : NIV 17 caractères extrait', champ(rAuto, 'vehicule.niv')?.valeur === '1FTBW3CM5KKB12345');
  test('FPQ1 : code postal normalisé', champ(rAuto, 'client.code_postal')?.valeur === 'H2X 1Y4');
  test('FPQ1 : libellés pris du dictionnaire', champ(rAuto, 'entete.assureur')?.table === 'auto_soumissions' && !!champ(rAuto, 'entete.assureur')?.libelle);
  test('FPQ1 : confiance globale > 0,5', rAuto.confiance > 0.5, String(rAuto.confiance));
  test('FPQ1 : chaque champ a un extrait source', rAuto.champs.every((c) => c.extrait));

  // --- Biens --------------------------------------------------------------------
  const txtBiens = [
    'Police — Assurance de biens commerciaux',
    'Assuré : Boulangerie Chaleur inc.',
    'Assureur : Intact Assurance',
    'N° de police : BIE-2026-778',
    'Bâtiment : 4521, rue Sainte-Catherine, Montréal',
    'Valeur de reconstruction : 1 250 000 $',
    'Limite : 1 250 000 $',
    'Prime totale : 6 400 $',
    'Franchise : 2 500 $',
  ].join('\n');
  const rBiens = moteur.analyserLocal(txtBiens);
  test('Biens : produit détecté « biens »', rBiens.produit === 'biens', JSON.stringify(rBiens.produit));
  test('Biens : entreprise + assureur', champ(rBiens, 'client.entreprise')?.valeur === 'Boulangerie Chaleur inc.' && champ(rBiens, 'entete.assureur')?.valeur === 'Intact Assurance');
  test('Biens : limite 1 250 000 $ parsée', champ(rBiens, 'garanties.limite')?.valeur === 1250000, JSON.stringify(champ(rBiens, 'garanties.limite')));
  test('Biens : prime totale 6 400 $', champ(rBiens, 'garanties.prime')?.valeur === 6400);

  // --- RC -------------------------------------------------------------------------
  const txtRc = [
    'Assurance responsabilité civile générale des entreprises',
    'Assuré nommé : Constructions Méthot inc.',
    'Assureur : Travelers Canada',
    'Limite par sinistre : 2 000 000 $',
    'Limite en agrégat : 4 000 000 $',
    'Franchise : 5 000 $',
    'Prime : 8 900 $',
  ].join('\n');
  const rRc = moteur.analyserLocal(txtRc);
  test('RC : produit détecté « rc »', rRc.produit === 'rc', JSON.stringify(rRc.produit));
  test('RC : limite par sinistre 2 M$', champ(rRc, 'garanties.limite_par_sinistre')?.valeur === 2000000);
  test('RC : limite agrégat 4 M$', champ(rRc, 'garanties.limite_agregat')?.valeur === 4000000);

  // --- Cyber -----------------------------------------------------------------------
  const txtCyber = [
    'Police cyberrisques — Cyber',
    'Assuré : Clinique Dentaire Bouchard inc.',
    'Assureur : Aviva',
    'Limite par sinistre : 1 000 000 $',
    'Délai de carence : 8 heures',
    'Prime : 2 400 $',
  ].join('\n');
  const rCyber = moteur.analyserLocal(txtCyber);
  test('Cyber : produit détecté « cyber »', rCyber.produit === 'cyber', JSON.stringify(rCyber.produit));
  test('Cyber : délai de carence extrait', /8 heures/.test(champ(rCyber, 'garanties.delai_carence')?.valeur || ''));

  // --- Perte d'exploitation ------------------------------------------------------------
  const txtPe = [
    "Perte d'exploitation — interruption des affaires",
    'Assuré : Boulangerie Chaleur inc.',
    "Période d'indemnité : 18 mois",
    'Base : marge brute',
    'Limite : 800 000 $',
    'Franchise : 3 jours',
    'Prime : 2 800 $',
  ].join('\n');
  const rPe = moteur.analyserLocal(txtPe);
  test('PE : produit détecté « pe »', rPe.produit === 'pe', JSON.stringify(rPe.produit));
  test('PE : période d indemnité 18 mois', champ(rPe, 'garanties.periode_indemnite_mois')?.valeur === 18);
  test('PE : base marge_brute', champ(rPe, 'garanties.base_montant')?.valeur === 'marge_brute');
  test('PE : franchise 3 jours (pas un montant)', champ(rPe, 'garanties.franchise_jours')?.valeur === 3);

  // --- Flotte ----------------------------------------------------------------------------
  const txtFlotte = [
    'Assurance flotte automobile',
    'Assuré : Transport Lapointe inc.',
    'Assureur : Intact Assurance',
    'Flotte de 12 véhicules',
    "Rayon d'opération : 160 km",
    'Limite : 2 000 000 $',
    'Prime : 21 500 $',
  ].join('\n');
  const rFlotte = moteur.analyserLocal(txtFlotte);
  test('Flotte : produit détecté « flotte » (pas auto)', rFlotte.produit === 'flotte', JSON.stringify(rFlotte.produit));
  test('Flotte : nb véhicules 12', champ(rFlotte, 'entete.nb_vehicules')?.valeur === 12);
  test('Flotte : rayon 160 km', champ(rFlotte, 'entete.rayon_operation_km')?.valeur === 160);

  // --- Cautionnement ------------------------------------------------------------------------
  const txtCaut = [
    'Cautionnement — lettre de ligne de cautionnement',
    'Entrepreneur (principal) : Construction Verdon inc.',
    'Caution : Intact Cautionnement',
    'Limite globale : 5 000 000 $',
    'Limite par projet : 2 500 000 $',
    'Bénéficiaire : Centre de services scolaire de Laval',
    'Montant du contrat : 2 200 000 $',
    "Cautionnement d'exécution et licence RBQ",
  ].join('\n');
  const rCaut = moteur.analyserLocal(txtCaut);
  test('Cautionnement : produit détecté', rCaut.produit === 'cautionnement', JSON.stringify(rCaut.produit));
  test('Cautionnement : limite globale 5 M$', champ(rCaut, 'garanties.limite_globale')?.valeur === 5000000, JSON.stringify(champ(rCaut, 'garanties.limite_globale')));
  test('Cautionnement : limite par projet 2,5 M$', champ(rCaut, 'garanties.limite_par_projet')?.valeur === 2500000);
  test('Cautionnement : bénéficiaire extrait', /Centre de services scolaire/.test(champ(rCaut, 'obligation.beneficiaire')?.valeur || ''));
  test('Cautionnement : montant du contrat 2,2 M$', champ(rCaut, 'obligation.montant_contrat')?.valeur === 2200000);

  // --- Texte ambigu / vide ---------------------------------------------------------------------
  const rAmb = moteur.analyserLocal('Bonjour, voici un document important. Merci de votre confiance. Prime : 900 $');
  test('Ambigu : produit indéterminé (null) honnête', rAmb.produit === null, JSON.stringify(rAmb.produit));
  test('Ambigu : message explicatif présent', !!rAmb.message && /indéterminé|ambigu/i.test(rAmb.message), rAmb.message);
  test('Ambigu : les champs communs restent proposés (prime)', champ(rAmb, 'garanties.prime')?.valeur === 900);
  const rVide = moteur.analyserLocal('');
  test('Vide : aucun champ, produit null, message présent', rVide.champs.length === 0 && rVide.produit === null && !!rVide.message);

  // --- Dates en français -------------------------------------------------------------------------
  const rDate = moteur.analyserLocal("Police d'assurance automobile\nDate d'effet : 1er janvier 2027\nDate d'échéance : 31/12/2027");
  test('Dates FR : « 1er janvier 2027 » → 2027-01-01', champ(rDate, 'entete.date_effet')?.valeur === '2027-01-01', JSON.stringify(champ(rDate, 'entete.date_effet')));
  test('Dates FR : « 31/12/2027 » → 2027-12-31', champ(rDate, 'entete.date_echeance')?.valeur === '2027-12-31');

  // --- Aucune écriture en base ----------------------------------------------------------------------
  const nAvant = bd.prepare("SELECT (SELECT COUNT(*) FROM clients) + (SELECT COUNT(*) FROM polices) AS n").get().n;
  moteur.analyserLocal(txtAuto);
  moteur.analyserLocal(txtCaut);
  const nApres = bd.prepare("SELECT (SELECT COUNT(*) FROM clients) + (SELECT COUNT(*) FROM polices) AS n").get().n;
  test('Moteur pur : aucune écriture clients/polices', nAvant === nApres, `${nAvant} → ${nApres}`);

  // --- analyser() asynchrone : moteur local annoncé ---------------------------------------------------
  const rAsync = await moteur.analyser(txtAuto, {});
  test('analyser() : moteur « local » sans clé', rAsync.moteur === 'local' && rAsync.produit === 'auto');

  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
