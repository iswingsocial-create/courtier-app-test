/**
 * scripts/test-voix.js — Commande vocale (étape 9/10 FPQ1, étape 9/10 biens,
 * étape 9/10 RC, étape 9/10 cyber, étape 9/10 E&O, étape 9/10 D&O,
 * étape 9/10 PE, étape 9/10 flotte) : normalisation du texte dicté (normaliserDictee), câblage
 * Web Speech dans public/assistant.js (fr-CA, démarrage/arrêt, indicateur,
 * dégradation), et acceptation du texte normalisé par le pipeline de
 * commandes IA.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : PORT=3101 node scripts/test-voix.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { normaliserDictee } = require('../public/dictee.js');

const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;
let total = 0;

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
async function req(jar, methode, chemin, { form = null, json = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    corps = new URLSearchParams(form).toString();
  } else if (json) {
    entetes['Content-Type'] = 'application/json';
    corps = JSON.stringify(json);
  }
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  const texte = await res.text();
  let donnees = null;
  try { donnees = JSON.parse(texte); } catch (e) { /* pas du JSON */ }
  return { statut: res.status, texte, donnees, location: res.headers.get('location') };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
async function loginComme(email, mdp) {
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  return { jar, ok: r.statut === 302 };
}

(async () => {
  console.log('== Tests commande vocale (étape 9/10) :', BASE);

  // --- 1) normaliserDictee : années ------------------------------------------------
  console.log('-- normaliserDictee : années');
  test('« deux mille vingt-six » → 2026',
    normaliserDictee('ajoute un véhicule Honda CR-V deux mille vingt-six') === 'ajoute un véhicule Honda CR-V 2026');
  test('« mille neuf cent quatre-vingt-cinq » → 1985',
    normaliserDictee('né en mille neuf cent quatre-vingt-cinq') === 'né en 1985');
  test('« deux mille » → 2000',
    normaliserDictee('année deux mille') === 'année 2000');
  test('« vingt-six » seul reste intact (pas une année)',
    normaliserDictee('vingt-six véhicules') === 'vingt-six véhicules');
  test('« trois cent dollars » → 300 (valeurs en dollars)',
    normaliserDictee('trois cent dollars') === '300');

  // --- 2) normaliserDictee : montants ------------------------------------------------
  console.log('-- normaliserDictee : montants');
  test('« 2 millions » → 2000000',
    normaliserDictee('mets la RC à 2 millions') === 'mets la RC à 2000000');
  test('« deux millions » → 2000000',
    normaliserDictee('mets la RC à deux millions') === 'mets la RC à 2000000');
  test('« un million cinq cent mille » → 1500000',
    normaliserDictee('prime de un million cinq cent mille') === 'prime de 1500000');
  test('« un milliard » → 1000000000',
    normaliserDictee('plafond de un milliard') === 'plafond de 1000000000');

  // --- 3) normaliserDictee : codes épelés -------------------------------------------
  console.log('-- normaliserDictee : codes épelés');
  test('« T un deux trois quatre cinq six sept » → T1234567',
    normaliserDictee('permis T un deux trois quatre cinq six sept') === 'permis T1234567');
  test('suite de 4 chiffres épelés → chiffres',
    normaliserDictee('téléphone un deux trois quatre') === 'téléphone 1234');
  test('suite de 3 chiffres épelés seule reste intacte',
    normaliserDictee('il y a un deux trois options') === 'il y a un deux trois options');
  test('« deux mille vingt-six » prioritaire sur l’épellation (année, pas 2 20 26)',
    normaliserDictee('modèle deux mille vingt-six').includes('2026'));

  // --- 4) normaliserDictee : ponctuation et texte libre ------------------------------
  console.log('-- normaliserDictee : ponctuation et texte libre');
  test('espaces multiples et ponctuation parasite nettoyés',
    normaliserDictee('  ajoute   un conducteur ,  Marie  ') === 'ajoute un conducteur, Marie');
  test('texte libre sans nombres inchangé',
    normaliserDictee('ajoute un conducteur Marie Tremblay à la soumission 1') === 'ajoute un conducteur Marie Tremblay à la soumission 1');
  test('chaîne vide → vide', normaliserDictee('') === '');

  // --- 4b) normaliserDictee : biens (étape 9/10 biens) ----------------------------------
  console.log('-- normaliserDictee : biens (superficies, valeurs, adresses)');
  test('« douze mille pieds carrés » → 12000',
    normaliserDictee('superficie de douze mille pieds carrés') === 'superficie de 12000');
  test('superficie sans mot-clé → 12000',
    normaliserDictee('douze mille pieds carrés') === '12000');
  test('« 12000 pieds carrés » déjà en chiffres → 12000',
    normaliserDictee('superficie 12000 pieds carrés') === 'superficie 12000');
  test('« neuf cent cinquante mille dollars » → 950000',
    normaliserDictee('valeur neuf cent cinquante mille dollars') === 'valeur 950000');
  test('« 1500000 dollars » déjà en chiffres → 1500000',
    normaliserDictee('valeur 1500000 dollars') === 'valeur 1500000');
  test('« un million cinq cent mille dollars » → 1500000',
    normaliserDictee('prime de un million cinq cent mille dollars') === 'prime de 1500000');
  test('« deux millions de dollars » → 2000000',
    normaliserDictee('deux millions de dollars de contenu') === '2000000 de contenu');
  test('« franchise de cinq mille dollars » → 5000',
    normaliserDictee('franchise de cinq mille dollars') === 'franchise de 5000');
  test('« cent vingt-trois rue Principale » → 123 rue Principale',
    normaliserDictee('au cent vingt-trois rue Principale à Montréal') === 'au 123 rue Principale à Montréal');
  test('chiffres épelés + rue → 123 rue Principale',
    normaliserDictee('un deux trois rue Principale') === '123 rue Principale');
  test('« année de construction deux mille dix » → 2010',
    normaliserDictee('année de construction deux mille dix') === 'année de construction 2010');
  test('« tous risques » reste intact',
    normaliserDictee('formule tous risques') === 'formule tous risques');
  test('adresse sans nombre en lettres inchangée',
    normaliserDictee('au 123 rue Principale à Montréal') === 'au 123 rue Principale à Montréal');

  // --- 4c) normaliserDictee : RC (étape 9/10 RC) -----------------------------------------
  console.log('-- normaliserDictee : RC (montants décimaux, superficies, adresses)');
  test('« un virgule deux million » → 1200000',
    normaliserDictee('chiffre d’affaires un virgule deux million') === 'chiffre d’affaires 1200000');
  test('« deux virgule cinq millions » → 2500000',
    normaliserDictee('limite par sinistre à deux virgule cinq millions') === 'limite par sinistre à 2500000');
  test('« un milliard virgule cinq » → 1500000000',
    normaliserDictee('plafond de un milliard virgule cinq') === 'plafond de 1500000000');
  test('« 1 virgule 2 million » (chiffres dictés) → 1200000',
    normaliserDictee('1 virgule 2 million') === '1200000');
  test('montant décimal SANS ancrage « million » : texte libre intact',
    normaliserDictee('un virgule deux options') === 'un virgule deux options');
  test('« deux millions » → 2000000 (masse salariale)',
    normaliserDictee('masse salariale de deux millions') === 'masse salariale de 2000000');
  test('« dix-huit mille pieds carrés » → 18000',
    normaliserDictee('superficie dix-huit mille pieds carrés') === 'superficie 18000');
  test('« quatre cent cinquante-six boulevard Industriel » → 456 boulevard Industriel',
    normaliserDictee('au quatre cent cinquante-six boulevard Industriel à Laval') === 'au 456 boulevard Industriel à Laval');
  test('« locaux et opérations » reste intact',
    normaliserDictee('formule locaux et opérations') === 'formule locaux et opérations');
  test('« sous-traitants assurés » reste intact',
    normaliserDictee('sous-traitants assurés') === 'sous-traitants assurés');

  // --- 4d) normaliserDictee : cyber (étape 9/10 cyber) ---------------------------------------
  console.log('-- normaliserDictee : cyber (références, durées, montants)');
  test('« à la soumission cyber un » → « à la soumission cyber 1 »',
    normaliserDictee('ajoute la mesure MFA en place à la soumission cyber un')
      === 'ajoute la mesure MFA en place à la soumission cyber 1');
  test('« soumission cyber deux » → « soumission cyber 2 »',
    normaliserDictee('mets la limite par sinistre à deux millions pour la soumission cyber deux')
      === 'mets la limite par sinistre à 2000000 pour la soumission cyber 2');
  test('« délai de carence de huit heures » → « délai de carence de 8 heures »',
    normaliserDictee('mets le délai de carence de huit heures pour la soumission cyber un')
      === 'mets le délai de carence de 8 heures pour la soumission cyber 1');
  test('« vingt-quatre heures » → « 24 heures »',
    normaliserDictee('carence de vingt-quatre heures') === 'carence de 24 heures');
  test('« la mesure deux » → « la mesure 2 » (index de mesure)',
    normaliserDictee('passe la mesure deux en partiel sur la soumission cyber un')
      === 'passe la mesure 2 en partiel sur la soumission cyber 1');
  test('« MFA », « en place », « prévu » passent intacts (vocabulaire reconnu par l’analyseur)',
    normaliserDictee('passe la mesure MFA en prévu à la soumission cyber un')
      === 'passe la mesure MFA en prévu à la soumission cyber 1');
  test('avenants en texte libre intacts, référence convertie',
    normaliserDictee('ajoute l’avenant rançongiciel à la soumission cyber un')
      === 'ajoute l’avenant rançongiciel à la soumission cyber 1');
  test('« retire l’avenant interruption d’activité » intact, référence convertie',
    normaliserDictee('retire l’avenant interruption d’activité de la soumission cyber un')
      === 'retire l’avenant interruption d’activité de la soumission cyber 1');
  test('« montre-moi la soumission cyber trois » → « soumission cyber 3 »',
    normaliserDictee('montre-moi la soumission cyber trois') === 'montre-moi la soumission cyber 3');
  test('« 8 heures » déjà en chiffres reste intact',
    normaliserDictee('délai de carence de 8 heures') === 'délai de carence de 8 heures');
  test('« deux millions » cyber → 2000000 (montants existants réutilisés)',
    normaliserDictee('limite par sinistre de deux millions') === 'limite par sinistre de 2000000');
  test('montant décimal cyber « deux virgule cinq millions » → 2500000',
    normaliserDictee('agrégat de deux virgule cinq millions') === 'agrégat de 2500000');

  // --- 4e) normaliserDictee : E&O (étape 9/10 E&O) ----------------------------------------
  console.log('-- normaliserDictee : E&O (références, CA, base, avenants)');
  test('« à la soumission E&O un » → « à la soumission E&O 1 »',
    normaliserDictee('ajoute l’activité conseil fiscal avec cent quatre-vingt mille dollars de chiffre d’affaires à la soumission E&O un')
      === 'ajoute l’activité conseil fiscal avec 180000 de chiffre d’affaires à la soumission E&O 1');
  test('« un chiffre d’affaires de deux cent cinquante mille dollars » → « 250000 »',
    normaliserDictee('avec un chiffre d’affaires de deux cent cinquante mille dollars à la soumission E&O un')
      === 'avec un chiffre d’affaires de 250000 à la soumission E&O 1');
  test('« montre-moi la soumission E&O trois » → « soumission E&O 3 »',
    normaliserDictee('montre-moi la soumission E&O trois') === 'montre-moi la soumission E&O 3');
  test('« l’activité deux » → « l’activité 2 » (index d’activité)',
    normaliserDictee('change le chiffre d’affaires de l’activité deux à deux cent mille dollars')
      === 'change le chiffre d’affaires de l’activité 2 à 200000');
  test('montant décimal E&O « un virgule deux million » → 1200000',
    normaliserDictee('change le chiffre d’affaires de l’activité un à un virgule deux million')
      === 'change le chiffre d’affaires de l’activité 1 à 1200000');
  test('« base réclamations présentées » passe en texte libre, référence convertie',
    normaliserDictee('mets la base réclamations présentées pour la soumission E&O deux')
      === 'mets la base réclamations présentées pour la soumission E&O 2');
  test('« base occurrences » passe en texte libre',
    normaliserDictee('base occurrences pour la soumission E&O un')
      === 'base occurrences pour la soumission E&O 1');
  test('« l’avenant frais de défense » intact, référence convertie',
    normaliserDictee('ajoute l’avenant frais de défense à la soumission E&O un')
      === 'ajoute l’avenant frais de défense à la soumission E&O 1');
  test('« l’avenant médias et contenu » intact, référence convertie',
    normaliserDictee('retire l’avenant médias et contenu de la soumission E&O un')
      === 'retire l’avenant médias et contenu de la soumission E&O 1');
  test('« l’avenant cyber associé » intact',
    normaliserDictee('ajoute l’avenant cyber associé à la soumission E&O un')
      === 'ajoute l’avenant cyber associé à la soumission E&O 1');
  test('commande cyber intacte après les règles E&O (pas de collision)',
    normaliserDictee('ajoute la mesure MFA en place à la soumission cyber un')
      === 'ajoute la mesure MFA en place à la soumission cyber 1');

  // --- 4f) normaliserDictee : D&O (étape 9/10 D&O) ---------------------------------------
  console.log('-- normaliserDictee : D&O (références, dirigeants, expérience, avenants)');
  test('« à la soumission D&O un » → « à la soumission D&O 1 »',
    normaliserDictee('ajoute le dirigeant Marc Bouchard comme trésorier à la soumission D&O un')
      === 'ajoute le dirigeant Marc Bouchard comme trésorier à la soumission D&O 1');
  test('« montre-moi la soumission D&O trois » → « soumission D&O 3 »',
    normaliserDictee('montre-moi la soumission D&O trois') === 'montre-moi la soumission D&O 3');
  test('« soumission d o un » (D&O dicté en deux mots) → « d o 1 »',
    normaliserDictee('ajoute le dirigeant Marie Tremblay à la soumission d o un')
      === 'ajoute le dirigeant Marie Tremblay à la soumission d o 1');
  test('« le dirigeant deux » → « le dirigeant 2 » (index de dirigeant)',
    normaliserDictee('change la fonction du dirigeant deux à trésorier pour la soumission D&O un')
      === 'change la fonction du dirigeant 2 à trésorier pour la soumission D&O 1');
  test('« président-directeur général » intact, référence convertie',
    normaliserDictee('change la fonction du dirigeant Marie Tremblay à président-directeur général pour la soumission D&O un')
      === 'change la fonction du dirigeant Marie Tremblay à président-directeur général pour la soumission D&O 1');
  test('« quinze ans d’expérience » → « 15 ans d’expérience » (unité conservée)',
    normaliserDictee('ajoute le dirigeant Jean Lavoie avec quinze ans d’expérience à la soumission D&O un')
      === "ajoute le dirigeant Jean Lavoie avec 15 ans d'expérience à la soumission D&O 1");
  test('« ans d expérience » sans apostrophe → « ans d’expérience »',
    normaliserDictee('avec quinze ans d expérience à la soumission D&O un')
      === "avec 15 ans d'expérience à la soumission D&O 1");
  test('élision « pratiques d emploi » → « pratiques d’emploi » (analyseur exige l’apostrophe)',
    normaliserDictee('ajoute l’avenant pratiques d emploi à la soumission D&O un')
      === "ajoute l’avenant pratiques d'emploi à la soumission D&O 1");
  test('« retire l’avenant fidélité crime » intact, référence convertie',
    normaliserDictee('retire l’avenant fidélité crime de la soumission D&O deux')
      === 'retire l’avenant fidélité crime de la soumission D&O 2');
  test('« ajoute le dirigeant » intact (jamais confondu avec « conducteur » FPQ1)',
    normaliserDictee('ajoute le dirigeant Marc Bouchard à la soumission D&O un')
      === 'ajoute le dirigeant Marc Bouchard à la soumission D&O 1');
  test('« ajoute un conducteur » FPQ1 intact après les règles D&O (pas de collision)',
    normaliserDictee('ajoute un conducteur Marie Tremblay à la soumission 1')
      === 'ajoute un conducteur Marie Tremblay à la soumission 1');
  test('montant D&O « dix mille dollars » → 10000',
    normaliserDictee('mets la franchise à dix mille dollars pour la soumission D&O un')
      === 'mets la franchise à 10000 pour la soumission D&O 1');
  test('montant D&O « deux millions » → 2000000',
    normaliserDictee('mets la limite par sinistre à deux millions pour la soumission D&O un')
      === 'mets la limite par sinistre à 2000000 pour la soumission D&O 1');
  test('montant décimal D&O « un virgule deux million » → 1200000',
    normaliserDictee('prime de un virgule deux million pour la soumission D&O un')
      === 'prime de 1200000 pour la soumission D&O 1');

  // --- 4g) normaliserDictee : PE (étape 9/10 PE) ----------------------------------------
  console.log('-- normaliserDictee : PE (références, établissements, période, carence)');
  test('« à la soumission perte d’exploitation un » → « à la soumission perte d’exploitation 1 »',
    normaliserDictee('ajoute l’établissement Entrepôt à la soumission perte d’exploitation un')
      === 'ajoute l’établissement Entrepôt à la soumission perte d’exploitation 1');
  test('« perte d exploitation » sans apostrophe → « perte d’exploitation » (règle 0, apostrophe droite)',
    normaliserDictee('ajoute l’établissement Entrepôt à la soumission perte d exploitation un')
      === 'ajoute l’établissement Entrepôt à la soumission perte d’exploitation 1'
        .replace('d’exploitation', "d'exploitation"));
  test('« montre-moi la soumission PE deux » → « soumission PE 2 »',
    normaliserDictee('montre-moi la soumission PE deux') === 'montre-moi la soumission PE 2');
  test('« l’établissement deux » → « l’établissement 2 » (index d’établissement)',
    normaliserDictee('change l’occupation de l’établissement deux à commerce de détail pour la soumission PE un')
      === 'change l’occupation de l’établissement 2 à commerce de détail pour la soumission PE 1');
  test('« période d’indemnité à dix-huit mois » → « 18 mois » (unité conservée)',
    normaliserDictee('mets la période d’indemnité à dix-huit mois pour la soumission perte d’exploitation un')
      === 'mets la période d’indemnité à 18 mois pour la soumission perte d’exploitation 1');
  test('« franchise cinq jours » → « franchise 5 jours » (unité conservée)',
    normaliserDictee('mets la franchise à cinq jours pour la soumission PE un')
      === 'mets la franchise à 5 jours pour la soumission PE 1');
  test('« délai de carence de huit jours » → « délai de carence de 8 jours »',
    normaliserDictee('mets le délai de carence de huit jours pour la soumission perte d’exploitation un')
      === 'mets le délai de carence de 8 jours pour la soumission perte d’exploitation 1');
  test('« cent quatre-vingt mille dollars de chiffre d’affaires » → « 180000 »',
    normaliserDictee('avec cent quatre-vingt mille dollars de chiffre d’affaires à la soumission perte d’exploitation un')
      === 'avec 180000 de chiffre d’affaires à la soumission perte d’exploitation 1');
  test('« base marge brute » passe en texte libre, référence convertie',
    normaliserDictee('mets la base marge brute pour la soumission perte d’exploitation un')
      === 'mets la base marge brute pour la soumission perte d’exploitation 1');
  test('« l’avenant accès civil » intact, référence convertie',
    normaliserDictee('ajoute l’avenant accès civil à la soumission PE un')
      === 'ajoute l’avenant accès civil à la soumission PE 1');
  test('« retire l’avenant détérioration des stocks » intact, référence convertie',
    normaliserDictee('retire l’avenant détérioration des stocks de la soumission perte d’exploitation deux')
      === 'retire l’avenant détérioration des stocks de la soumission perte d’exploitation 2');
  test('« ajoute l’établissement » intact (jamais confondu avec « le bâtiment » biens ni « le lieu » RC)',
    normaliserDictee('ajoute l’établissement Entrepôt à la soumission perte d’exploitation un')
      === 'ajoute l’établissement Entrepôt à la soumission perte d’exploitation 1');
  test('commande biens intacte après les règles PE (pas de collision)',
    normaliserDictee('ajoute un bâtiment au cent vingt-trois rue Principale à Montréal'
      + ' construction béton année deux mille dix superficie douze mille pieds carrés à la soumission biens 1')
      === 'ajoute un bâtiment au 123 rue Principale à Montréal'
        + ' construction béton année 2010 superficie 12000 à la soumission biens 1');
  test('commande RC intacte après les règles PE (pas de collision)',
    normaliserDictee('ajoute un lieu au quatre cent cinquante-six boulevard Industriel à Laval à la soumission RC 1')
      === 'ajoute un lieu au 456 boulevard Industriel à Laval à la soumission RC 1');

  // --- 4h) normaliserDictee : flotte (étape 9/10 flotte) --------------------------------
  console.log('-- normaliserDictee : flotte (références, véhicule/conducteur, rayon, FAQ)');
  test('« à la soumission flotte un » → « à la soumission flotte 1 »',
    normaliserDictee('ajoute le véhicule Ford Transit à la soumission flotte un')
      === 'ajoute le véhicule Ford Transit à la soumission flotte 1');
  test('« à la soumission flotte automobile deux » → « flotte automobile 2 »',
    normaliserDictee('ajoute le véhicule Ford Transit à la soumission flotte automobile deux')
      === 'ajoute le véhicule Ford Transit à la soumission flotte automobile 2');
  test('« montre-moi la soumission flotte trois » → « soumission flotte 3 »',
    normaliserDictee('montre-moi la soumission flotte trois') === 'montre-moi la soumission flotte 3');
  test('« le véhicule deux » → « le véhicule 2 » (index de véhicule)',
    normaliserDictee('le véhicule deux') === 'le véhicule 2');
  test('« le conducteur trois » → « le conducteur 3 » (index de conducteur)',
    normaliserDictee('le conducteur trois') === 'le conducteur 3');
  test('« rayon de cent cinquante kilomètres » → « rayon de 150 km » (unité normalisée, analyseur exige km)',
    normaliserDictee('rayon de cent cinquante kilomètres') === 'rayon de 150 km');
  test('« 150 kilomètres » déjà en chiffres → « 150 km »',
    normaliserDictee('rayon de 150 kilomètres') === 'rayon de 150 km');
  test('phrase rayon complète : véhicule + référence + distance normalisés',
    normaliserDictee('change le rayon du véhicule un de la soumission flotte deux à cent cinquante kilomètres')
      === 'change le rayon du véhicule 1 de la soumission flotte 2 à 150 km');
  test('« valeur a neuf » → « valeur à neuf » (accent rétabli, « neuf » jamais converti en 9)',
    normaliserDictee('ajoute la valeur a neuf à la soumission flotte un')
      === 'ajoute la valeur à neuf à la soumission flotte 1');
  test('« valeur à neuf » déjà accentuée intacte, référence convertie',
    normaliserDictee('ajoute la valeur à neuf à la soumission flotte un')
      === 'ajoute la valeur à neuf à la soumission flotte 1');
  test('« f a q quarante-trois » → « FAQ 43 » (code épelé recollé sans avaler le nombre)',
    normaliserDictee('ajoute la f a q quarante-trois à la soumission flotte un')
      === 'ajoute la FAQ 43 à la soumission flotte 1');
  test('« FAQ quarante-trois » → « FAQ 43 » (nombre en lettres après le code)',
    normaliserDictee('ajoute la FAQ quarante-trois à la soumission flotte un')
      === 'ajoute la FAQ 43 à la soumission flotte 1');
  test('« f a q cinq a » → « FAQ 5 a » (FAQ 5a épelée)',
    normaliserDictee('ajoute la f a q cinq a à la soumission flotte un')
      === 'ajoute la FAQ 5 a à la soumission flotte 1');
  test('« retire la f a q vingt-sept » → « retire la FAQ 27 » (retrait d’avenant)',
    normaliserDictee('retire la f a q vingt-sept de la soumission flotte un')
      === 'retire la FAQ 27 de la soumission flotte 1');
  test('« privation de jouissance » intacte (FAQ 20 en texte libre), référence convertie',
    normaliserDictee('ajoute la privation de jouissance à la soumission flotte un')
      === 'ajoute la privation de jouissance à la soumission flotte 1');
  test('« indemnités d accident » → « indemnités d\'accident » (élision rétablie, FAQ 34)',
    normaliserDictee('ajoute les indemnités d accident à la soumission flotte un')
      === "ajoute les indemnités d'accident à la soumission flotte 1");
  test('montant flotte « deux millions » → 2000000, référence convertie',
    normaliserDictee('mets la limite RC à deux millions pour la soumission flotte un')
      === 'mets la limite RC à 2000000 pour la soumission flotte 1');
  test('« change la valeur du véhicule deux … à quarante-cinq mille dollars » → véhicule 2, 45000',
    normaliserDictee('change la valeur du véhicule deux de la soumission flotte un à quarante-cinq mille dollars')
      === 'change la valeur du véhicule 2 de la soumission flotte 1 à 45000');
  test('conducteur flotte dicté complet (permis épelé + classe en lettres)',
    normaliserDictee('ajoute un conducteur Marc Gagnon permis G un deux trois quatre cinq six sept classe trois à la soumission flotte un')
      === 'ajoute un conducteur Marc Gagnon permis G1234567 classe 3 à la soumission flotte 1');
  test('anti-collision voix : « soumission auto un » FPQ1 intacte (jamais convertie en flotte)',
    normaliserDictee('ajoute un véhicule Honda CR-V deux mille vingt-six à la soumission auto un')
      === 'ajoute un véhicule Honda CR-V 2026 à la soumission auto un');
  test('anti-collision voix : référence courte FPQ1 intacte (pas de marqueur flotte ajouté)',
    normaliserDictee('ajoute un conducteur Marie Tremblay à la soumission 1')
      === 'ajoute un conducteur Marie Tremblay à la soumission 1');
  test('commande PE intacte après les règles flotte (pas de collision)',
    normaliserDictee('ajoute l’établissement Entrepôt à la soumission perte d’exploitation un')
      === 'ajoute l’établissement Entrepôt à la soumission perte d’exploitation 1');

  // --- 4i) normaliserDictee : cautionnement (étape 9/10 cautionnement) ----------------
  console.log('-- normaliserDictee : cautionnement (références, obligations, montants)');
  test('« à la soumission cautionnement un » → « à la soumission cautionnement 1 »',
    normaliserDictee('ajoute un cautionnement rbq à la soumission cautionnement un')
      === 'ajoute un cautionnement rbq à la soumission cautionnement 1');
  test('« montre-moi la soumission cautionnement deux » → « soumission cautionnement 2 »',
    normaliserDictee('montre-moi la soumission cautionnement deux') === 'montre-moi la soumission cautionnement 2');
  test('« cautionnement d exécution » → « cautionnement d\'exécution » (élision rétablie)',
    normaliserDictee('ajoute un cautionnement d exécution à la soumission cautionnement un')
      === "ajoute un cautionnement d'exécution à la soumission cautionnement 1");
  test('« l’obligation deux » → « l’obligation 2 » (index d’obligation)',
    normaliserDictee('change le montant du cautionnement de l’obligation deux à la soumission cautionnement un')
      === 'change le montant du cautionnement de l’obligation 2 à la soumission cautionnement 1');
  test('« limite globale cinq millions » → « limite globale 5000000 », référence convertie',
    normaliserDictee('mets la limite globale à cinq millions à la soumission cautionnement un')
      === 'mets la limite globale à 5000000 à la soumission cautionnement 1');
  test('« limite par projet deux millions cinq cent mille » → 2500000',
    normaliserDictee('mets la limite par projet à deux millions cinq cent mille à la soumission cautionnement trois')
      === 'mets la limite par projet à 2500000 à la soumission cautionnement 3');
  test('« cautionnement rbq de quarante mille dollars » → 40000 (RBQ général)',
    normaliserDictee('ajoute un cautionnement rbq de quarante mille dollars pour la Régie du bâtiment du Québec à la soumission cautionnement un')
      === 'ajoute un cautionnement rbq de 40000 pour la Régie du bâtiment du Québec à la soumission cautionnement 1');
  test('« bénéficiaire » intact (texte libre), référence convertie',
    normaliserDictee('ajoute un cautionnement de soumission pour le bénéficiaire Ville de Laval à la soumission cautionnement un')
      === 'ajoute un cautionnement de soumission pour le bénéficiaire Ville de Laval à la soumission cautionnement 1');
  test('anti-collision voix : référence courte FPQ1 intacte (pas de marqueur cautionnement ajouté)',
    normaliserDictee('ajoute un conducteur Marie Tremblay à la soumission 1')
      === 'ajoute un conducteur Marie Tremblay à la soumission 1');
  test('anti-collision voix : « soumission flotte un » intacte après les règles cautionnement',
    normaliserDictee('ajoute le véhicule Ford Transit à la soumission flotte un')
      === 'ajoute le véhicule Ford Transit à la soumission flotte 1');
  test('commande cautionnement complète dictée (élision + montant + référence)',
    normaliserDictee('ajoute un cautionnement d exécution de deux millions de dollars pour la Ville de Laval projet École des Pins à la soumission cautionnement un')
      === "ajoute un cautionnement d'exécution de 2000000 pour la Ville de Laval projet École des Pins à la soumission cautionnement 1");

  // --- 5) Câblage dans public/assistant.js -------------------------------------------
  console.log('-- câblage public/assistant.js');
  const jsAssistant = fs.readFileSync(path.join(__dirname, '../public/assistant.js'), 'utf8');
  test('fr-CA comme langue de reconnaissance', jsAssistant.includes("reco.lang = 'fr-CA'"));
  test('SpeechRecognition || webkitSpeechRecognition', /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/.test(jsAssistant));
  test('indicateur « 🎙️ Écoute… »', jsAssistant.includes('🎙️ Écoute…'));
  test('démarrage ET arrêt au clic (toggle)', /enEcoute\)\s*\{\s*\n?\s*reco\.stop\(\)/.test(jsAssistant));
  test('normalisation du transcript avant remplissage', jsAssistant.includes('Dictee.normaliserDictee('));
  test('aucun envoi automatique après dictée', !/reco\.addEventListener\('result'[\s\S]{0,400}?form\.requestSubmit|dispatchEvent\(new Event\('submit'\)\)/.test(jsAssistant));
  test('dégradation gracieuse si API absente (bouton masqué + message)',
    jsAssistant.includes("btnMicro.style.display = 'none'") && jsAssistant.includes('Dictée vocale indisponible'));
  test('vue charge dictee.js avant assistant.js', (() => {
    const vue = fs.readFileSync(path.join(__dirname, '../views/assistant/chat.ejs'), 'utf8');
    return vue.indexOf('/dictee.js') !== -1 && vue.indexOf('/dictee.js') < vue.indexOf('/assistant.js');
  })());
  test('note de confidentialité dans l’aide', (() => {
    const { texteAide } = require('../lib/commandes-ia');
    return texteAide().includes('Confidentialité');
  })());

  // --- 6) Le pipeline serveur accepte le texte normalisé ----------------------------
  console.log('-- pipeline serveur (texte dicté normalisé)');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  // Le seed impose un changement de mot de passe au premier login.
  let rp = await req(jar, 'GET', '/mot-de-passe');
  rp = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(rp.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', rp.statut === 302, 'statut ' + rp.statut);
  if (ok) {
    // Texte tel que dicté, puis normalisé comme le fait le navigateur.
    const dicte = 'ajoute un conducteur Marie Tremblay permis T un deux trois quatre cinq six sept à la soumission 1';
    const normalise = normaliserDictee(dicte);
    test('normalisation du cas dicté complet',
      normalise === 'ajoute un conducteur Marie Tremblay permis T1234567 à la soumission 1',
      normalise);
    const p = await req(jar, 'GET', '/assistant');
    const r = await req(jar, 'POST', '/assistant/message', { json: { message: normalise, _csrf: csrf(p.texte) } });
    test('POST /assistant/message → 200', r.statut === 200, 'statut ' + r.statut);
    test('l’assistant demande confirmation (pas d’exécution aveugle)',
      !!r.donnees && !!r.donnees.confirmation && /Marie Tremblay/.test(r.donnees.confirmation.resume || ''),
      JSON.stringify(r.donnees).slice(0, 120));
    // Confirmation → le conducteur est vraiment créé (version figée, règle d’or).
    const c = r.donnees.confirmation;
    const p2 = await req(jar, 'GET', '/assistant');
    const r2 = await req(jar, 'POST', '/assistant/confirmer', { json: { commande: c.commande, _csrf: csrf(p2.texte) } });
    test('confirmation → 200', r2.statut === 200, 'statut ' + r2.statut);
    test('conducteur créé via la voix', !!r2.donnees && /ajout/i.test(r2.donnees.reponse || ''),
      (r2.donnees && r2.donnees.reponse || '').slice(0, 120));

    // ---- 6b) Pipeline biens : texte dicté avec nombres en lettres -------------------
    console.log('-- pipeline biens (dictée → normalisation → confirmation → exécution)');
    const bd = new Database(process.env.CHEMIN_BD);
    const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
    const soumBiens = bd.prepare('SELECT id FROM biens_soumissions WHERE cabinet_id = ? ORDER BY id LIMIT 1').get(cabA);
    test('soumission biens démo présente', !!soumBiens, 'aucune soumission biens');
    const nbVerAvant = bd.prepare('SELECT COUNT(*) n FROM biens_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    const dicteBiens = 'ajoute un bâtiment au cent vingt-trois rue Principale à Montréal'
      + ' construction béton année deux mille dix superficie douze mille pieds carrés'
      + ' occupation entrepôt valeur neuf cent cinquante mille dollars'
      + ` à la soumission biens ${soumBiens.id}`;
    const normaliseBiens = normaliserDictee(dicteBiens);
    test('normalisation du cas biens dicté complet',
      normaliseBiens === 'ajoute un bâtiment au 123 rue Principale à Montréal'
        + ' construction béton année 2010 superficie 12000'
        + ' occupation entrepôt valeur 950000'
        + ` à la soumission biens ${soumBiens.id}`,
      normaliseBiens);
    const pb = await req(jar, 'GET', '/assistant');
    const rb = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseBiens, _csrf: csrf(pb.texte) } });
    test('POST /assistant/message (biens) → 200', rb.statut === 200, 'statut ' + rb.statut);
    test('l’assistant demande confirmation (bâtiment)',
      !!rb.donnees && !!rb.donnees.confirmation
        && rb.donnees.confirmation.commande.action === 'ajouter_batiment'
        && /123 rue Principale/.test(rb.donnees.confirmation.resume || ''),
      JSON.stringify(rb.donnees).slice(0, 160));
    const cb = rb.donnees.confirmation;
    const pb2 = await req(jar, 'GET', '/assistant');
    const rb2 = await req(jar, 'POST', '/assistant/confirmer', { json: { commande: cb.commande, _csrf: csrf(pb2.texte) } });
    test('confirmation (biens) → 200', rb2.statut === 200, 'statut ' + rb2.statut);
    test('bâtiment créé via la voix', !!rb2.donnees && /C'est fait/.test(rb2.donnees.reponse || '')
      && /123 rue Principale/.test(rb2.donnees.reponse || ''),
      (rb2.donnees && rb2.donnees.reponse || '').slice(0, 140));
    const bat = bd.prepare(
      "SELECT * FROM biens_batiments WHERE cabinet_id = ? AND adresse = '123 rue Principale'"
    ).get(cabA);
    test('bâtiment en base avec champs dictés',
      !!bat && bat.ville === 'Montréal' && bat.type_construction === 'beton'
        && bat.annee_construction === 2010 && bat.superficie_pi2 === 12000
        && bat.occupation === 'entrepôt' && bat.valeur_batiment === 950000,
      JSON.stringify(bat && { ville: bat.ville, tc: bat.type_construction, an: bat.annee_construction, sup: bat.superficie_pi2, val: bat.valeur_batiment }));
    const nbVerApres = bd.prepare('SELECT COUNT(*) n FROM biens_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    test("version créée (règle d'or)", nbVerApres === nbVerAvant + 1, `${nbVerAvant} → ${nbVerApres}`);
    bd.close();

    // ---- 6c) Pipeline RC : texte dicté avec nombres en lettres -----------------------
    console.log('-- pipeline RC (dictée → normalisation → confirmation → exécution)');
    const bd2 = new Database(process.env.CHEMIN_BD);
    const soumRC = bd2.prepare('SELECT id FROM rc_soumissions WHERE cabinet_id = ? ORDER BY id LIMIT 1').get(cabA);
    test('soumission RC démo présente', !!soumRC, 'aucune soumission RC');
    const nbVerRCAvant = bd2.prepare('SELECT COUNT(*) n FROM rc_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    const dicteRC = 'ajoute un lieu au quatre cent cinquante-six boulevard Industriel à Laval'
      + ' activité entrepôt chiffre d\'affaires un virgule deux million'
      + ` à la soumission RC ${soumRC.id}`;
    const normaliseRC = normaliserDictee(dicteRC);
    test('normalisation du cas RC dicté complet',
      normaliseRC === 'ajoute un lieu au 456 boulevard Industriel à Laval'
        + ' activité entrepôt chiffre d\'affaires 1200000'
        + ` à la soumission RC ${soumRC.id}`,
      normaliseRC);
    const prc = await req(jar, 'GET', '/assistant');
    const rrc = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseRC, _csrf: csrf(prc.texte) } });
    test('POST /assistant/message (RC) → 200', rrc.statut === 200, 'statut ' + rrc.statut);
    test('l’assistant demande confirmation (lieu d’exploitation)',
      !!rrc.donnees && !!rrc.donnees.confirmation
        && rrc.donnees.confirmation.commande.action === 'ajouter_lieu_rc'
        && /456 boulevard Industriel/.test(rrc.donnees.confirmation.resume || ''),
      JSON.stringify(rrc.donnees).slice(0, 180));
    const crc = rrc.donnees.confirmation;
    const prc2 = await req(jar, 'GET', '/assistant');
    const rrc2 = await req(jar, 'POST', '/assistant/confirmer', { json: { commande: crc.commande, _csrf: csrf(prc2.texte) } });
    test('confirmation (RC) → 200', rrc2.statut === 200, 'statut ' + rrc2.statut);
    test('lieu créé via la voix', !!rrc2.donnees && /C'est fait/.test(rrc2.donnees.reponse || '')
      && /456 boulevard Industriel/.test(rrc2.donnees.reponse || ''),
      (rrc2.donnees && rrc2.donnees.reponse || '').slice(0, 160));
    const lieu = bd2.prepare(
      "SELECT * FROM rc_exploitations WHERE cabinet_id = ? AND adresse = '456 boulevard Industriel'"
    ).get(cabA);
    test('lieu en base avec champs dictés',
      !!lieu && lieu.ville === 'Laval' && lieu.type_activite === 'entrepôt'
        && lieu.chiffre_affaires === 1200000,
      JSON.stringify(lieu && { ville: lieu.ville, act: lieu.type_activite, ca: lieu.chiffre_affaires }));
    const nbVerRCApres = bd2.prepare('SELECT COUNT(*) n FROM rc_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    test("version RC créée (règle d'or)", nbVerRCApres === nbVerRCAvant + 1, `${nbVerRCAvant} → ${nbVerRCApres}`);
    bd2.close();

    // ---- 6d) Pipeline cyber : texte dicté avec vocabulaire cyber ----------------------
    console.log('-- pipeline cyber (dictée → normalisation → confirmation → exécution)');
    const bd3 = new Database(process.env.CHEMIN_BD);
    const soumCyber = bd3.prepare('SELECT id FROM cyber_soumissions WHERE cabinet_id = ? ORDER BY id LIMIT 1').get(cabA);
    test('soumission cyber démo présente', !!soumCyber, 'aucune soumission cyber');
    test('soumission cyber démo = #1 (base fraîche)', !!soumCyber && soumCyber.id === 1,
      soumCyber && 'id ' + soumCyber.id);
    const nbVerCyberAvant = bd3.prepare('SELECT COUNT(*) n FROM cyber_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    const dicteCyber = 'ajoute la mesure MFA en place à la soumission cyber un';
    const normaliseCyber = normaliserDictee(dicteCyber);
    test('normalisation du cas cyber dicté complet',
      normaliseCyber === 'ajoute la mesure MFA en place à la soumission cyber 1',
      normaliseCyber);
    const pcy = await req(jar, 'GET', '/assistant');
    const rcy = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseCyber, _csrf: csrf(pcy.texte) } });
    test('POST /assistant/message (cyber) → 200', rcy.statut === 200, 'statut ' + rcy.statut);
    test('l’assistant demande confirmation (mesure de sécurité)',
      !!rcy.donnees && !!rcy.donnees.confirmation
        && rcy.donnees.confirmation.commande.action === 'ajouter_mesure_cyber'
        && /MFA/.test(rcy.donnees.confirmation.resume || '')
        && /En place/.test(rcy.donnees.confirmation.resume || ''),
      JSON.stringify(rcy.donnees).slice(0, 200));
    const ccy = rcy.donnees.confirmation;
    const pcy2 = await req(jar, 'GET', '/assistant');
    const rcy2 = await req(jar, 'POST', '/assistant/confirmer', { json: { commande: ccy.commande, _csrf: csrf(pcy2.texte) } });
    test('confirmation (cyber) → 200', rcy2.statut === 200, 'statut ' + rcy2.statut);
    test('mesure créée via la voix', !!rcy2.donnees && /C'est fait/.test(rcy2.donnees.reponse || '')
      && /MFA/.test(rcy2.donnees.reponse || ''),
      (rcy2.donnees && rcy2.donnees.reponse || '').slice(0, 160));
    const mesure = bd3.prepare(
      "SELECT * FROM cyber_mesures WHERE cabinet_id = ? AND soumission_id = ? AND type_mesure = 'mfa' ORDER BY id DESC"
    ).get(cabA, soumCyber.id);
    test('mesure en base avec champs dictés',
      !!mesure && mesure.statut === 'en_place',
      JSON.stringify(mesure && { type: mesure.type_mesure, statut: mesure.statut }));
    const nbVerCyberApres = bd3.prepare('SELECT COUNT(*) n FROM cyber_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    test("version cyber créée (règle d'or)", nbVerCyberApres === nbVerCyberAvant + 1, `${nbVerCyberAvant} → ${nbVerCyberApres}`);
    // Carence dictée : normalisation puis analyse (confirmation non exécutée).
    const dicteCarence = 'mets le délai de carence de huit heures pour la soumission cyber un';
    const normaliseCarence = normaliserDictee(dicteCarence);
    test('normalisation du cas carence dicté',
      normaliseCarence === 'mets le délai de carence de 8 heures pour la soumission cyber 1',
      normaliseCarence);
    const pcar = await req(jar, 'GET', '/assistant');
    const rcar = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseCarence, _csrf: csrf(pcar.texte) } });
    test('l’assistant demande confirmation (carence)',
      !!rcar.donnees && !!rcar.donnees.confirmation
        && rcar.donnees.confirmation.commande.action === 'modifier_garanties_cyber'
        && /8 heures/.test(rcar.donnees.confirmation.resume || ''),
      JSON.stringify(rcar.donnees).slice(0, 200));
    bd3.close();

    // ---- 6e) Pipeline E&O : texte dicté avec vocabulaire E&O -----------------------------
    console.log('-- pipeline E&O (dictée → normalisation → confirmation → exécution)');
    const bd4 = new Database(process.env.CHEMIN_BD);
    const soumEO = bd4.prepare('SELECT id FROM eo_soumissions WHERE cabinet_id = ? ORDER BY id LIMIT 1').get(cabA);
    test('soumission E&O démo présente', !!soumEO, 'aucune soumission E&O');
    test('soumission E&O démo = #1 (base fraîche)', !!soumEO && soumEO.id === 1,
      soumEO && 'id ' + soumEO.id);
    const nbVerEOAavant = bd4.prepare('SELECT COUNT(*) n FROM eo_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    const dicteEO = 'ajoute l’activité conseil fiscal avec cent quatre-vingt mille dollars de chiffre d’affaires à la soumission E&O un';
    const normaliseEO = normaliserDictee(dicteEO);
    test('normalisation du cas E&O dicté complet',
      normaliseEO === 'ajoute l’activité conseil fiscal avec 180000 de chiffre d’affaires à la soumission E&O 1',
      normaliseEO);
    const peo = await req(jar, 'GET', '/assistant');
    const reo = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseEO, _csrf: csrf(peo.texte) } });
    test('POST /assistant/message (E&O) → 200', reo.statut === 200, 'statut ' + reo.statut);
    test('l’assistant demande confirmation (activité professionnelle)',
      !!reo.donnees && !!reo.donnees.confirmation
        && reo.donnees.confirmation.commande.action === 'ajouter_activite_eo'
        && /conseil fiscal/.test(reo.donnees.confirmation.resume || '')
        && /180[\s\u00a0]000/.test(reo.donnees.confirmation.resume || ''),
      JSON.stringify(reo.donnees).slice(0, 200));
    const ceo = reo.donnees.confirmation;
    const peo2 = await req(jar, 'GET', '/assistant');
    const reo2 = await req(jar, 'POST', '/assistant/confirmer', { json: { commande: ceo.commande, _csrf: csrf(peo2.texte) } });
    test('confirmation (E&O) → 200', reo2.statut === 200, 'statut ' + reo2.statut);
    test('activité créée via la voix', !!reo2.donnees && /C'est fait/.test(reo2.donnees.reponse || '')
      && /conseil fiscal/.test(reo2.donnees.reponse || ''),
      (reo2.donnees && reo2.donnees.reponse || '').slice(0, 160));
    const activite = bd4.prepare(
      "SELECT * FROM eo_activites WHERE cabinet_id = ? AND soumission_id = ? AND description_activite = 'conseil fiscal' ORDER BY id DESC"
    ).get(cabA, soumEO.id);
    test('activité en base avec champs dictés',
      !!activite && activite.chiffre_affaires === 180000,
      JSON.stringify(activite && { desc: activite.description_activite, ca: activite.chiffre_affaires }));
    const nbVerEOApres = bd4.prepare('SELECT COUNT(*) n FROM eo_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    test("version E&O créée (règle d'or)", nbVerEOApres === nbVerEOAavant + 1, `${nbVerEOAavant} → ${nbVerEOApres}`);
    // Base dictée : normalisation puis analyse (confirmation non exécutée).
    const dicteBase = 'mets la base occurrences pour la soumission E&O un';
    const normaliseBase = normaliserDictee(dicteBase);
    test('normalisation du cas base dicté',
      normaliseBase === 'mets la base occurrences pour la soumission E&O 1',
      normaliseBase);
    const pbase = await req(jar, 'GET', '/assistant');
    const rbase = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseBase, _csrf: csrf(pbase.texte) } });
    test('l’assistant demande confirmation (base occurrences)',
      !!rbase.donnees && !!rbase.donnees.confirmation
        && rbase.donnees.confirmation.commande.action === 'modifier_garanties_eo'
        && /occurrences/.test(rbase.donnees.confirmation.resume || ''),
      JSON.stringify(rbase.donnees).slice(0, 200));
    bd4.close();

    // ---- 6f) Pipeline D&O : texte dicté avec vocabulaire D&O -----------------------------
    console.log('-- pipeline D&O (dictée → normalisation → confirmation → exécution)');
    const bd5 = new Database(process.env.CHEMIN_BD);
    const soumDO = bd5.prepare('SELECT id FROM do_soumissions WHERE cabinet_id = ? ORDER BY id LIMIT 1').get(cabA);
    test('soumission D&O démo présente', !!soumDO, 'aucune soumission D&O');
    test('soumission D&O démo = #1 (base fraîche)', !!soumDO && soumDO.id === 1,
      soumDO && 'id ' + soumDO.id);
    const nbVerDOAvant = bd5.prepare('SELECT COUNT(*) n FROM do_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    const dicteDO = 'ajoute le dirigeant Marc Bouchard comme trésorier à la soumission D&O un';
    const normaliseDO = normaliserDictee(dicteDO);
    test('normalisation du cas D&O dicté complet',
      normaliseDO === 'ajoute le dirigeant Marc Bouchard comme trésorier à la soumission D&O 1',
      normaliseDO);
    const pdo = await req(jar, 'GET', '/assistant');
    const rdo = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseDO, _csrf: csrf(pdo.texte) } });
    test('POST /assistant/message (D&O) → 200', rdo.statut === 200, 'statut ' + rdo.statut);
    test('l’assistant demande confirmation (dirigeant)',
      !!rdo.donnees && !!rdo.donnees.confirmation
        && rdo.donnees.confirmation.commande.action === 'ajouter_dirigeant_do'
        && /Marc Bouchard/.test(rdo.donnees.confirmation.resume || '')
        && /trésorier/.test(rdo.donnees.confirmation.resume || ''),
      JSON.stringify(rdo.donnees).slice(0, 220));
    const cdo = rdo.donnees.confirmation;
    const pdo2 = await req(jar, 'GET', '/assistant');
    const rdo2 = await req(jar, 'POST', '/assistant/confirmer', { json: { commande: cdo.commande, _csrf: csrf(pdo2.texte) } });
    test('confirmation (D&O) → 200', rdo2.statut === 200, 'statut ' + rdo2.statut);
    test('dirigeant créé via la voix', !!rdo2.donnees && /C'est fait/.test(rdo2.donnees.reponse || '')
      && /Marc Bouchard/.test(rdo2.donnees.reponse || ''),
      (rdo2.donnees && rdo2.donnees.reponse || '').slice(0, 160));
    const dirigeant = bd5.prepare(
      "SELECT * FROM do_dirigeants WHERE cabinet_id = ? AND soumission_id = ? AND nom = 'Marc Bouchard' ORDER BY id DESC"
    ).get(cabA, soumDO.id);
    test('dirigeant en base avec champs dictés',
      !!dirigeant && /trésorier/i.test(dirigeant.fonction || ''),
      JSON.stringify(dirigeant && { nom: dirigeant.nom, fonction: dirigeant.fonction }));
    const nbVerDOApres = bd5.prepare('SELECT COUNT(*) n FROM do_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    test("version D&O créée (règle d'or)", nbVerDOApres === nbVerDOAvant + 1, `${nbVerDOAvant} → ${nbVerDOApres}`);
    // Franchise dictée : normalisation puis analyse (confirmation non exécutée).
    const dicteFranchise = 'mets la franchise à dix mille dollars pour la soumission D&O un';
    const normaliseFranchise = normaliserDictee(dicteFranchise);
    test('normalisation du cas franchise dicté',
      normaliseFranchise === 'mets la franchise à 10000 pour la soumission D&O 1',
      normaliseFranchise);
    const pfr = await req(jar, 'GET', '/assistant');
    const rfr = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseFranchise, _csrf: csrf(pfr.texte) } });
    test('l’assistant demande confirmation (franchise)',
      !!rfr.donnees && !!rfr.donnees.confirmation
        && rfr.donnees.confirmation.commande.action === 'modifier_garanties_do'
        && /10[\s\u00a0]000/.test(rfr.donnees.confirmation.resume || ''),
      JSON.stringify(rfr.donnees).slice(0, 220));
    bd5.close();

    // ---- 6g) Pipeline PE : texte dicté avec vocabulaire perte d'exploitation --------
    console.log('-- pipeline PE (dictée → normalisation → confirmation → exécution)');
    const bd6 = new Database(process.env.CHEMIN_BD);
    const soumPE = bd6.prepare('SELECT id FROM pe_soumissions WHERE cabinet_id = ? ORDER BY id LIMIT 1').get(cabA);
    test('soumission PE démo présente', !!soumPE, 'aucune soumission PE');
    test('soumission PE démo = #1 (base fraîche)', !!soumPE && soumPE.id === 1,
      soumPE && 'id ' + soumPE.id);
    const nbVerPEAvant = bd6.prepare('SELECT COUNT(*) n FROM pe_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    const dictePE = 'ajoute l’établissement Entrepôt à la soumission perte d’exploitation un';
    const normalisePE = normaliserDictee(dictePE);
    test('normalisation du cas PE dicté complet',
      normalisePE === 'ajoute l’établissement Entrepôt à la soumission perte d’exploitation 1',
      normalisePE);
    const ppe = await req(jar, 'GET', '/assistant');
    const rpe = await req(jar, 'POST', '/assistant/message', { json: { message: normalisePE, _csrf: csrf(ppe.texte) } });
    test('POST /assistant/message (PE) → 200', rpe.statut === 200, 'statut ' + rpe.statut);
    test('l’assistant demande confirmation (établissement)',
      !!rpe.donnees && !!rpe.donnees.confirmation
        && rpe.donnees.confirmation.commande.action === 'ajouter_etablissement_pe'
        && /Entrepôt/.test(rpe.donnees.confirmation.resume || ''),
      JSON.stringify(rpe.donnees).slice(0, 220));
    const cpe = rpe.donnees.confirmation;
    const ppe2 = await req(jar, 'GET', '/assistant');
    const rpe2 = await req(jar, 'POST', '/assistant/confirmer', { json: { commande: cpe.commande, _csrf: csrf(ppe2.texte) } });
    test('confirmation (PE) → 200', rpe2.statut === 200, 'statut ' + rpe2.statut);
    test('établissement créé via la voix', !!rpe2.donnees && /C'est fait/.test(rpe2.donnees.reponse || '')
      && /Entrepôt/.test(rpe2.donnees.reponse || ''),
      (rpe2.donnees && rpe2.donnees.reponse || '').slice(0, 160));
    const etab = bd6.prepare(
      "SELECT * FROM pe_etablissements WHERE cabinet_id = ? AND soumission_id = ? AND nom_lieu = 'Entrepôt' ORDER BY id DESC"
    ).get(cabA, soumPE.id);
    test('établissement en base avec champs dictés',
      !!etab && etab.nom_lieu === 'Entrepôt',
      JSON.stringify(etab && { nom: etab.nom_lieu }));
    const nbVerPEApres = bd6.prepare('SELECT COUNT(*) n FROM pe_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    test("version PE créée (règle d'or)", nbVerPEApres === nbVerPEAvant + 1, `${nbVerPEAvant} → ${nbVerPEApres}`);
    // Franchise dictée : normalisation puis analyse (confirmation non exécutée).
    const dicteFranchisePE = 'mets la franchise à cinq jours pour la soumission perte d’exploitation un';
    const normaliseFranchisePE = normaliserDictee(dicteFranchisePE);
    test('normalisation du cas franchise PE dicté',
      normaliseFranchisePE === 'mets la franchise à 5 jours pour la soumission perte d’exploitation 1',
      normaliseFranchisePE);
    const pfrpe = await req(jar, 'GET', '/assistant');
    const rfrpe = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseFranchisePE, _csrf: csrf(pfrpe.texte) } });
    test('l’assistant demande confirmation (franchise PE)',
      !!rfrpe.donnees && !!rfrpe.donnees.confirmation
        && rfrpe.donnees.confirmation.commande.action === 'modifier_garanties_pe'
        && /5 jours/.test(rfrpe.donnees.confirmation.resume || ''),
      JSON.stringify(rfrpe.donnees).slice(0, 220));
    // Période dictée : normalisation puis analyse (confirmation non exécutée).
    const dictePeriodePE = 'mets la période d’indemnité à dix-huit mois pour la soumission perte d’exploitation un';
    const normalisePeriodePE = normaliserDictee(dictePeriodePE);
    test('normalisation du cas période PE dicté',
      normalisePeriodePE === 'mets la période d’indemnité à 18 mois pour la soumission perte d’exploitation 1',
      normalisePeriodePE);
    const pper = await req(jar, 'GET', '/assistant');
    const rper = await req(jar, 'POST', '/assistant/message', { json: { message: normalisePeriodePE, _csrf: csrf(pper.texte) } });
    test('l’assistant demande confirmation (période d’indemnité PE)',
      !!rper.donnees && !!rper.donnees.confirmation
        && rper.donnees.confirmation.commande.action === 'modifier_garanties_pe'
        && /18 mois/.test(rper.donnees.confirmation.resume || ''),
      JSON.stringify(rper.donnees).slice(0, 220));
    bd6.close();

    // ---- 6h) Pipeline flotte : texte dicté avec vocabulaire flotte automobile -----
    console.log('-- pipeline flotte (dictée → normalisation → confirmation → exécution)');
    const bd7 = new Database(process.env.CHEMIN_BD);
    const soumFlotte = bd7.prepare('SELECT id FROM flotte_soumissions WHERE cabinet_id = ? ORDER BY id LIMIT 1').get(cabA);
    test('soumission flotte démo présente', !!soumFlotte, 'aucune soumission flotte');
    test('soumission flotte démo = #1 (base fraîche)', !!soumFlotte && soumFlotte.id === 1,
      soumFlotte && 'id ' + soumFlotte.id);
    const nbVerFlotteAvant = bd7.prepare('SELECT COUNT(*) n FROM flotte_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    const dicteFlotte = 'ajoute le véhicule Ford Transit à la soumission flotte un';
    const normaliseFlotte = normaliserDictee(dicteFlotte);
    test('normalisation du cas flotte dicté complet',
      normaliseFlotte === 'ajoute le véhicule Ford Transit à la soumission flotte 1',
      normaliseFlotte);
    const pfl = await req(jar, 'GET', '/assistant');
    const rfl = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseFlotte, _csrf: csrf(pfl.texte) } });
    test('POST /assistant/message (flotte) → 200', rfl.statut === 200, 'statut ' + rfl.statut);
    test('l’assistant demande confirmation (véhicule flotte)',
      !!rfl.donnees && !!rfl.donnees.confirmation
        && rfl.donnees.confirmation.commande.action === 'ajouter_vehicule_flotte'
        && /Ford Transit/.test(rfl.donnees.confirmation.resume || ''),
      JSON.stringify(rfl.donnees).slice(0, 220));
    const cfl = rfl.donnees.confirmation;
    const pfl2 = await req(jar, 'GET', '/assistant');
    const rfl2 = await req(jar, 'POST', '/assistant/confirmer', { json: { commande: cfl.commande, _csrf: csrf(pfl2.texte) } });
    test('confirmation (flotte) → 200', rfl2.statut === 200, 'statut ' + rfl2.statut);
    test('véhicule flotte créé via la voix', !!rfl2.donnees && /C'est fait/.test(rfl2.donnees.reponse || '')
      && /Ford Transit/.test(rfl2.donnees.reponse || ''),
      (rfl2.donnees && rfl2.donnees.reponse || '').slice(0, 160));
    const vehFlotte = bd7.prepare(
      "SELECT * FROM flotte_vehicules WHERE cabinet_id = ? AND soumission_id = ? AND marque = 'Ford' AND modele = 'Transit' ORDER BY id DESC"
    ).get(cabA, soumFlotte.id);
    test('véhicule flotte en base avec champs dictés',
      !!vehFlotte && vehFlotte.marque === 'Ford' && vehFlotte.modele === 'Transit',
      JSON.stringify(vehFlotte && { marque: vehFlotte.marque, modele: vehFlotte.modele }));
    const nbVerFlotteApres = bd7.prepare('SELECT COUNT(*) n FROM flotte_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    test("version flotte créée (règle d'or)", nbVerFlotteApres === nbVerFlotteAvant + 1, `${nbVerFlotteAvant} → ${nbVerFlotteApres}`);
    // Rayon dicté : normalisation puis analyse (confirmation non exécutée).
    const dicteRayon = 'change le rayon du véhicule un de la soumission flotte un à cent cinquante kilomètres';
    const normaliseRayon = normaliserDictee(dicteRayon);
    test('normalisation du cas rayon flotte dicté',
      normaliseRayon === 'change le rayon du véhicule 1 de la soumission flotte 1 à 150 km',
      normaliseRayon);
    const pray = await req(jar, 'GET', '/assistant');
    const rray = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseRayon, _csrf: csrf(pray.texte) } });
    test('l’assistant demande confirmation (rayon flotte)',
      !!rray.donnees && !!rray.donnees.confirmation
        && rray.donnees.confirmation.commande.action === 'modifier_vehicule_flotte'
        && /150 km/.test(rray.donnees.confirmation.resume || ''),
      JSON.stringify(rray.donnees).slice(0, 220));
    // Avenant FAQ dicté épelé : normalisation puis analyse (confirmation non exécutée).
    const dicteFaq = 'ajoute la f a q quarante-trois à la soumission flotte un';
    const normaliseFaq = normaliserDictee(dicteFaq);
    test('normalisation du cas FAQ flotte dicté',
      normaliseFaq === 'ajoute la FAQ 43 à la soumission flotte 1',
      normaliseFaq);
    const pfaq = await req(jar, 'GET', '/assistant');
    const rfaq = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseFaq, _csrf: csrf(pfaq.texte) } });
    test('l’assistant demande confirmation (avenant FAQ flotte)',
      !!rfaq.donnees && !!rfaq.donnees.confirmation
        && rfaq.donnees.confirmation.commande.action === 'modifier_garanties_flotte'
        && /FAQ 43/.test(rfaq.donnees.confirmation.resume || ''),
      JSON.stringify(rfaq.donnees).slice(0, 220));
    bd7.close();

    // ---- 6i) Pipeline cautionnement : texte dicté avec élision et montant en lettres ----
    console.log('-- pipeline cautionnement (dictée → normalisation → confirmation → exécution)');
    const bd8 = new Database(process.env.CHEMIN_BD);
    const soumCaut = bd8.prepare('SELECT id FROM caut_soumissions WHERE cabinet_id = ? ORDER BY id LIMIT 1').get(cabA);
    test('soumission cautionnement démo présente', !!soumCaut, 'aucune soumission cautionnement');
    const nbVerCautAvant = bd8.prepare('SELECT COUNT(*) n FROM caut_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    const nbOblCautAvant = bd8.prepare('SELECT COUNT(*) n FROM caut_obligations WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumCaut.id).n;
    const dicteCaut = 'ajoute un cautionnement d exécution de deux millions de dollars pour la Ville de Laval projet École des Pins'
      + ` à la soumission cautionnement ${soumCaut.id}`;
    const normaliseCaut = normaliserDictee(dicteCaut);
    test('normalisation du cas cautionnement dicté complet',
      normaliseCaut === "ajoute un cautionnement d'exécution de 2000000 pour la Ville de Laval projet École des Pins"
        + ` à la soumission cautionnement ${soumCaut.id}`,
      normaliseCaut);
    const pc8 = await req(jar, 'GET', '/assistant');
    const rc8 = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseCaut, _csrf: csrf(pc8.texte) } });
    test('POST /assistant/message (cautionnement) → 200', rc8.statut === 200, 'statut ' + rc8.statut);
    test('l’assistant demande confirmation (obligation cautionnement)',
      !!rc8.donnees && !!rc8.donnees.confirmation
        && rc8.donnees.confirmation.commande.action === 'ajouter_obligation_caut'
        && /Ville de Laval/.test(rc8.donnees.confirmation.resume || ''),
      JSON.stringify(rc8.donnees).slice(0, 220));
    test('rien exécuté avant confirmation (voix)', bd8.prepare('SELECT COUNT(*) n FROM caut_obligations WHERE cabinet_id = ? AND soumission_id = ?').get(cabA, soumCaut.id).n === nbOblCautAvant);
    const cc8 = rc8.donnees.confirmation;
    const pc82 = await req(jar, 'GET', '/assistant');
    const rc82 = await req(jar, 'POST', '/assistant/confirmer', { json: { commande: cc8.commande, _csrf: csrf(pc82.texte) } });
    test('confirmation (cautionnement) → 200', rc82.statut === 200, 'statut ' + rc82.statut);
    test('obligation cautionnement créée via la voix', !!rc82.donnees && /C'est fait/.test(rc82.donnees.reponse || ''),
      (rc82.donnees && rc82.donnees.reponse || '').slice(0, 160));
    const oblCaut = bd8.prepare(
      "SELECT * FROM caut_obligations WHERE cabinet_id = ? AND soumission_id = ? AND type = 'execution' AND beneficiaire = 'Ville de Laval' ORDER BY id DESC"
    ).get(cabA, soumCaut.id);
    test('obligation en base avec champs dictés (exécution, 2 000 000 $, projet)',
      !!oblCaut && oblCaut.montant_cautionnement === 2000000 && /École des Pins/.test(oblCaut.description_projet || ''),
      JSON.stringify(oblCaut && { t: oblCaut.type, m: oblCaut.montant_cautionnement, p: oblCaut.description_projet }));
    const nbVerCautApres = bd8.prepare('SELECT COUNT(*) n FROM caut_soumission_versions WHERE cabinet_id = ?').get(cabA).n;
    test("version cautionnement créée (règle d'or)", nbVerCautApres === nbVerCautAvant + 1, `${nbVerCautAvant} → ${nbVerCautApres}`);
    // Ligne dictée : normalisation puis analyse (confirmation non exécutée).
    const dicteLigne = 'mets la limite globale à cinq millions à la soumission cautionnement un';
    const normaliseLigne = normaliserDictee(dicteLigne);
    test('normalisation du cas ligne cautionnement dicté',
      normaliseLigne === 'mets la limite globale à 5000000 à la soumission cautionnement 1',
      normaliseLigne);
    const pl8 = await req(jar, 'GET', '/assistant');
    const rl8 = await req(jar, 'POST', '/assistant/message', { json: { message: normaliseLigne, _csrf: csrf(pl8.texte) } });
    test('l’assistant demande confirmation (ligne cautionnement)',
      !!rl8.donnees && !!rl8.donnees.confirmation
        && rl8.donnees.confirmation.commande.action === 'modifier_ligne_caut',
      JSON.stringify(rl8.donnees).slice(0, 220));
    bd8.close();
  }

  console.log(`\n${echecs ? '❌' : '🎉'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
