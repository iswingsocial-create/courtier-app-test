/**
 * scripts/test-dictionnaire.js — Tests de l'étape 4/10 (dictionnaire des champs IA-friendly) :
 * JSON valide et complet (via scripts/generer-dictionnaire.js), page Admin → Dictionnaire
 * (200 pour admin, 403 pour courtier), recherche, fonction contexteDonnees(),
 * aucune donnée personnelle dans le dictionnaire.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-dictionnaire.js
 */
const { execFileSync } = require('child_process');
const path = require('path');

const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;

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
  return paires.length ? { 'Cookie': paires.join('; ') } : {};
}
async function req(jar, methode, chemin, { form = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    corps = new URLSearchParams(form).toString();
  }
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  const texte = await res.text();
  return { statut: res.status, texte, location: res.headers.get('location') };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function test(nom, condition, detail) {
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
async function connexion(jar, email, mdp) {
  let r = await req(jar, 'GET', '/connexion');
  return req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
}

(async () => {
  console.log('== Tests dictionnaire des champs (étape 4/10) :', BASE);

  // ---- 1. JSON valide et complet -------------------------------------------------
  console.log('1. JSON et vérification du schéma');
  let dico;
  try {
    dico = require('../lib/dictionnaire-champs.json');
    test('dictionnaire-champs.json est un JSON valide', true);
  } catch (e) {
    test('dictionnaire-champs.json est un JSON valide', false, e.message);
  }
  try {
    const sortie = execFileSync('node', [path.join(__dirname, 'generer-dictionnaire.js')], {
      encoding: 'utf8',
      env: { ...process.env, CHEMIN_BD: process.env.CHEMIN_BD || path.join(__dirname, '..', 'courtier.db') },
    });
    test('generer-dictionnaire.js : schéma réel entièrement documenté', /Dictionnaire complet/.test(sortie), sortie.trim().slice(0, 120));
  } catch (e) {
    test('generer-dictionnaire.js : schéma réel entièrement documenté', false, (e.stdout || e.message || '').slice(0, 200));
  }
  test('au moins 30 tables documentées', dico && dico.tables.length >= 30, dico && dico.tables.length);
  const tablesCles = ['clients', 'polices', 'police_versions', 'auto_soumissions', 'auto_conducteurs', 'auto_vehicules', 'auto_garanties', 'auto_antecedents', 'factures', 'reclamations', 'assureurs',
    'biens_soumissions', 'biens_batiments', 'biens_contenus', 'biens_garanties', 'biens_antecedents', 'biens_soumission_versions',
    'rc_soumissions', 'rc_exploitations', 'rc_garanties', 'rc_antecedents', 'rc_soumission_versions'];
  for (const t of tablesCles) {
    test(`table ${t} documentée`, dico.tables.some((x) => x.nom === t));
  }
  // Domaine biens : les tables sont regroupées sous le domaine « biens »
  const biensTables = dico.tables.filter((x) => x.domaine === 'biens').map((x) => x.nom);
  test('domaine « Biens commerciaux » présent', dico.domaines.biens === 'Biens commerciaux');
  test('6 tables dans le domaine biens', biensTables.length === 6, biensTables.join(', '));
  test('soumissions biens marquée versionnée', dico.tables.some((x) => x.nom === 'biens_soumissions' && x.versionnage));
  test('versions biens marquée versionnée', dico.tables.some((x) => x.nom === 'biens_soumission_versions' && x.versionnage));
  // Valeurs autorisées des CHECK documentées (étape 4/10 biens)
  const col = (t, c) => dico.tables.find((x) => x.nom === t).colonnes.find((y) => y.nom === c);
  test('statut biens : valeurs documentées', (col('biens_soumissions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('type_construction : valeurs documentées', (col('biens_batiments', 'type_construction').valeurs || []).join(',') === 'bois,acier,beton,maconnerie,mixte');
  test('type_contenu : valeurs documentées', (col('biens_contenus', 'type_contenu').valeurs || []).join(',') === 'mobilier,equipements,stock,ameliorations,autre');
  test('formule : valeurs documentées', (col('biens_garanties', 'formule').valeurs || []).join(',') === 'tous_risques,risques_designes');
  test('avenants biens : clés documentées', (col('biens_garanties', 'avenants').valeurs || []).includes('tremblement_terre'));
  test('unicité garanties par bâtiment documentée', /UNIQUE/.test(col('biens_garanties', 'batiment_id').description));
  test('unicité antécédents par soumission documentée', /UNIQUE/.test(col('biens_antecedents', 'soumission_id').description));
  test('versions biens : colonnes figées marquées', /figée/.test(col('biens_soumission_versions', 'donnees').libelle));
  test('règle d\'or mentionne les versions biens', /biens_soumission_versions/.test(dico.regle_or || ''));
  // Domaine RC : les tables sont regroupées sous le domaine « rc » (étape 4/10 RC)
  const rcTables = dico.tables.filter((x) => x.domaine === 'rc').map((x) => x.nom);
  test('domaine « Responsabilité civile (CGL) » présent', dico.domaines.rc === 'Responsabilité civile (CGL)');
  test('5 tables dans le domaine rc', rcTables.length === 5, rcTables.join(', '));
  test('soumissions RC marquée versionnée', dico.tables.some((x) => x.nom === 'rc_soumissions' && x.versionnage));
  test('versions RC marquée versionnée', dico.tables.some((x) => x.nom === 'rc_soumission_versions' && x.versionnage));
  // Valeurs autorisées des CHECK documentées (étape 4/10 RC)
  test('statut RC : valeurs documentées', (col('rc_soumissions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('sous_traitants : valeurs documentées', (col('rc_exploitations', 'sous_traitants').valeurs || []).join(',') === 'aucun,assures,non_assures');
  test('formule RC : valeurs documentées', (col('rc_garanties', 'formule').valeurs || []).join(',') === 'locaux_operations,produits_completes,globale');
  test('avenants RC : clés documentées', ((col('rc_garanties', 'avenants').valeurs || []).includes('pollution') && (col('rc_garanties', 'avenants').valeurs || []).includes('parapluie')));
  test('unicité garanties par lieu documentée', /UNIQUE/.test(col('rc_garanties', 'exploitation_id').description));
  test('unicité antécédents par soumission documentée', /UNIQUE/.test(col('rc_antecedents', 'soumission_id').description));
  test('versions RC : colonnes figées marquées', /figée/.test(col('rc_soumission_versions', 'donnees').libelle));
  test('règle d\'or mentionne les versions RC', /rc_soumission_versions/.test(dico.regle_or || ''));
  test('tarification CGL documentée (chiffre d\u2019affaires)', /tarification/i.test(col('rc_exploitations', 'chiffre_affaires').description));
  test('tarification CGL documentée (classification)', /tarifaire/i.test(col('rc_exploitations', 'code_classification').description));
  test('limite 2 M$ documentée', /2 000 000/.test(col('rc_garanties', 'limite_par_sinistre').description));
  // Domaine cyber : les tables sont regroupées sous le domaine « cyber » (étape 1/10 cyber)
  const cyberTables = dico.tables.filter((x) => x.domaine === 'cyber').map((x) => x.nom);
  test('domaine « Cyberrisques » présent', dico.domaines.cyber === 'Cyberrisques');
  test('5 tables dans le domaine cyber', cyberTables.length === 5, cyberTables.join(', '));
  test('soumissions cyber marquée versionnée', dico.tables.some((x) => x.nom === 'cyber_soumissions' && x.versionnage));
  test('versions cyber marquée versionnée', dico.tables.some((x) => x.nom === 'cyber_soumission_versions' && x.versionnage));
  // Valeurs autorisées des CHECK documentées (étape 1/10 cyber)
  test('statut cyber : valeurs documentées', (col('cyber_soumissions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('statut mesure : valeurs documentées', (col('cyber_mesures', 'statut').valeurs || []).join(',') === 'en_place,partiel,absent,prevu');
  test('avenants cyber : clés documentées', ((col('cyber_garanties', 'avenants').valeurs || []).includes('rancongiciel') && (col('cyber_garanties', 'avenants').valeurs || []).includes('donnees_vie_privee')));
  test('unicité garanties par soumission documentée', /UNIQUE/.test(col('cyber_garanties', 'soumission_id').description));
  test('unicité antécédents par soumission documentée', /UNIQUE/.test(col('cyber_antecedents', 'soumission_id').description));
  test('versions cyber : colonnes figées marquées', /figée/.test(col('cyber_soumission_versions', 'donnees').libelle));
  test('règle d\'or mentionne les versions cyber', /cyber_soumission_versions/.test(dico.regle_or || ''));
  // Enrichissement du domaine cyber (étape 4/10 cyber) : descriptions métier utiles à la
  // tarification, toutes les valeurs CHECK documentées, colonnes figées marquées (figee)
  const tbl = (n) => dico.tables.find((x) => x.nom === n);
  test('type_mesure : valeurs documentées', (col('cyber_mesures', 'type_mesure').valeurs || []).join(',') === 'mfa,sauvegardes,antivirus_edr,pare_feu,formation_hameconnage,plan_reponse_incident,chiffrement,gestion_correctifs,controle_acces,autre');
  test('maturité des mesures : impact sur la prime documenté', /prime|tarif/i.test(col('cyber_mesures', 'statut').description));
  test('mesures : rôle en tarification documenté (table)', /tarification/i.test(tbl('cyber_mesures').description));
  test('mesures : chaque contrôle décrit', /multifacteur|3-2-1|maillon faible/i.test(col('cyber_mesures', 'type_mesure').description));
  test('délai de carence : rôle documenté', /carence/i.test(col('cyber_garanties', 'delai_carence').description) && /interruption/i.test(col('cyber_garanties', 'delai_carence').description));
  test('avenants cyber : rançongiciel documenté', /rançon/i.test(col('cyber_garanties', 'avenants').description));
  test('avenants cyber : fraude par transfert documentée', /fraude/i.test(col('cyber_garanties', 'avenants').description));
  test('avenants cyber : Loi 25 documentée', /Loi 25/.test(col('cyber_garanties', 'avenants').description));
  test('incidents 5 ans : risque aggravé documenté', /risque aggravé|sinistralité/i.test(tbl('cyber_antecedents').description));
  test('incidents 5 ans : incidents non réclamés comptent', /non réclamés/i.test(col('cyber_antecedents', 'incidents_5ans').description));
  test('versions cyber : colonnes figées marquées (figee)', ['statut', 'notes', 'date_effet_souhaitee', 'donnees'].every((c) => col('cyber_soumission_versions', c).figee === true));
  test('versions cyber : statut valeurs documentées', (col('cyber_soumission_versions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('versions cyber : snapshot de conformité documenté', /conformité|snapshot/i.test(col('cyber_soumission_versions', 'donnees').description));
  // Domaine E&O : les tables sont regroupées sous le domaine « eo » (étape 1/10 E&O)
  const eoTables = dico.tables.filter((x) => x.domaine === 'eo').map((x) => x.nom);
  test('domaine « Responsabilité professionnelle (E&O) » présent', dico.domaines.eo === 'Responsabilité professionnelle (E&O)');
  test('5 tables dans le domaine eo', eoTables.length === 5, eoTables.join(', '));
  test('soumissions eo marquée versionnée', dico.tables.some((x) => x.nom === 'eo_soumissions' && x.versionnage));
  test('versions eo marquée versionnée', dico.tables.some((x) => x.nom === 'eo_soumission_versions' && x.versionnage));
  // Valeurs autorisées des CHECK documentées (étape 1/10 E&O)
  test('statut eo : valeurs documentées', (col('eo_soumissions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('base : valeurs documentées', (col('eo_garanties', 'base').valeurs || []).join(',') === 'reclamations_presentees,occurrences');
  test('avenants eo : clés documentées', ((col('eo_garanties', 'avenants').valeurs || []).includes('frais_defense') && (col('eo_garanties', 'avenants').valeurs || []).includes('medias_contenu') && (col('eo_garanties', 'avenants').valeurs || []).includes('cyber_associe')));
  test('unicité garanties par soumission documentée (table)', /UNIQUE/.test(tbl('eo_garanties').description));
  test('unicité antécédents par soumission documentée (table)', /UNIQUE/.test(tbl('eo_antecedents').description));
  test('versions eo : colonnes figées marquées', /figée/.test(col('eo_soumission_versions', 'donnees').libelle));
  test('règle d\'or mentionne les versions eo', /eo_soumission_versions/.test(dico.regle_or || ''));
  // Enrichissement du domaine eo (étape 4/10 E&O) : descriptions métier utiles à la
  // tarification, toutes les valeurs CHECK documentées, colonnes figées marquées (figee)
  test('base claims-made : continuité et rétroactivité documentées', /continuité/i.test(col('eo_garanties', 'base').description) && /rétroactivité/i.test(col('eo_garanties', 'base').description));
  test('base occurrences : rareté et coût documentés', /rare|plus cher/i.test(col('eo_garanties', 'base').description));
  test('claims-made : forme dominante documentée (table)', /claims-made/i.test(tbl('eo_garanties').description));
  test('avenants eo : frais de défense en sus des limites', /en sus/i.test(col('eo_garanties', 'avenants').description));
  test('avenants eo : médias et propriété intellectuelle', /propriété intellectuelle|diffamation/i.test(col('eo_garanties', 'avenants').description));
  test('avenants eo : cyber-incident lié à une erreur', /cyber-incident|mauvaise configuration/i.test(col('eo_garanties', 'avenants').description));
  test('circonstances : avis de circonstance documenté', /avis de circonstance|verrouille/i.test(col('eo_antecedents', 'circonstances').description));
  test('circonstances : question piège documentée', /piège/i.test(col('eo_antecedents', 'circonstances').description));
  test('CA : taux par tranche de 1 000 $ documenté', /1 000/.test(col('eo_activites', 'chiffre_affaires').description));
  test('CA : exposition proportionnelle documentée (table)', /exposition/i.test(tbl('eo_activites').description));
  test('activité non déclarée : non couverte', /non déclarée|non couverte/i.test(col('eo_activites', 'description_activite').description));
  test('réclamations 5 ans : incidents non réclamés comptent', /non réclamés/i.test(col('eo_antecedents', 'reclamations_5ans').description));
  test('continuité : protection de la rétroactivité', /rétroactivité/i.test(col('eo_antecedents', 'annees_assurance_continue').description));
  test('versions eo : colonnes figées marquées (figee)', ['statut', 'notes', 'date_effet_souhaitee', 'donnees'].every((c) => col('eo_soumission_versions', c).figee === true));
  test('versions eo : statut valeurs documentées', (col('eo_soumission_versions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('versions eo : snapshot de conformité documenté', /conformité|snapshot/i.test(col('eo_soumission_versions', 'donnees').description));
  // Domaine D&O : les tables sont regroupées sous le domaine « do » (étape 1/10 D&O)
  const doTables = dico.tables.filter((x) => x.domaine === 'do').map((x) => x.nom);
  test('domaine « Responsabilité des administrateurs et dirigeants (D&O) » présent', dico.domaines.do === 'Responsabilité des administrateurs et dirigeants (D&O)');
  test('5 tables dans le domaine do', doTables.length === 5, doTables.join(', '));
  test('soumissions do marquée versionnée', dico.tables.some((x) => x.nom === 'do_soumissions' && x.versionnage));
  test('versions do marquée versionnée', dico.tables.some((x) => x.nom === 'do_soumission_versions' && x.versionnage));
  // Valeurs autorisées des CHECK documentées (étape 1/10 D&O)
  test('statut do : valeurs documentées', (col('do_soumissions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('base do : valeurs documentées', (col('do_garanties', 'base').valeurs || []).join(',') === 'reclamations_presentees,occurrences');
  test('avenants do : clés documentées', ((col('do_garanties', 'avenants').valeurs || []).includes('frais_defense') && (col('do_garanties', 'avenants').valeurs || []).includes('pratiques_emploi') && (col('do_garanties', 'avenants').valeurs || []).includes('fidelite_crime')));
  test('unicité garanties par soumission documentée (table do)', /UNIQUE/.test(tbl('do_garanties').description));
  test('unicité antécédents par soumission documentée (table do)', /UNIQUE/.test(tbl('do_antecedents').description));
  test('versions do : colonnes figées marquées', /figé/.test(col('do_soumission_versions', 'donnees').libelle));
  test('règle d\'or mentionne les versions do', /do_soumission_versions/.test(dico.regle_or || ''));
  // Enrichissement du domaine do (étape 4/10 D&O) : descriptions métier utiles à la
  // tarification D&O — exposition personnelle des dirigeants, base claims-made,
  // question piège des poursuites, avenants détaillés.
  test('exposition : nombre de dirigeants = exposition (table)', /élargit l'exposition|exposition/i.test(tbl('do_soumissions').description));
  test('dirigeants : exposition personnelle documentée (table)', /exposition D&O est personnelle/i.test(tbl('do_dirigeants').description));
  test('dirigeants : internes vs indépendants documentés (table)', /indépendants/i.test(tbl('do_dirigeants').description));
  test('fonction : exposition selon le titre documentée', /président|directeur général/i.test(col('do_dirigeants', 'fonction').description));
  test('antécédents personnels : question la plus sensible', /sensible/i.test(col('do_dirigeants', 'antecedents_personnels').description));
  test('antécédents personnels : incidents non réclamés comptent', /non réclamés/i.test(col('do_dirigeants', 'antecedents_personnels').description));
  test('base do : continuité et rétroactivité documentées', /continuité/i.test(col('do_garanties', 'base').description) && /rétroactivité/i.test(col('do_garanties', 'base').description));
  test('base do : occurrences rare et plus cher', /rare|plus cher/i.test(col('do_garanties', 'base').description));
  test('claims-made : forme dominante en D&O (table)', /quasi systématique|claims-made/i.test(tbl('do_garanties').description));
  test('avenants do : frais de défense en sus des limites', /en sus/i.test(col('do_garanties', 'avenants').description));
  test('avenants do : frais de défense érodent la limite sinon', /érodent/i.test(col('do_garanties', 'avenants').description));
  test('avenants do : pratiques d\'emploi — congédiement, harcèlement', /congédiement|harcèlement/i.test(col('do_garanties', 'avenants').description));
  test('avenants do : fidélité/crime — détournements', /détournements|infidélité/i.test(col('do_garanties', 'avenants').description));
  test('agrégat : frais de défense dedans ou en sus', /en sus|agrégat/i.test(col('do_garanties', 'limite_agregat').description));
  test('limites usuelles 1 M$ à 5 M$ documentées (table)', /1 M\$|5 M\$/i.test(tbl('do_garanties').description));
  test('poursuites : question piège documentée', /piège/i.test(col('do_antecedents', 'poursuites_en_cours').description));
  test('poursuites : non-déclaration = refus pur et simple', /refus/i.test(col('do_antecedents', 'poursuites_en_cours').description));
  test('poursuites : avis de circonstance verrouille la couverture', /verrouille/i.test(col('do_antecedents', 'poursuites_en_cours').description));
  test('réclamations 5 ans : indicateur de sinistralité (do)', /sinistralité/i.test(col('do_antecedents', 'reclamations_5ans').description));
  test('versions do : colonnes figées marquées (figee)', ['statut', 'notes', 'date_effet_souhaitee', 'donnees'].every((c) => col('do_soumission_versions', c).figee === true));
  test('versions do : statut valeurs documentées', (col('do_soumission_versions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('versions do : snapshot de conformité documenté', /conformité|snapshot/i.test(col('do_soumission_versions', 'donnees').description));
  // Domaine Perte d'exploitation : les tables sont regroupées sous le domaine « pe » (étape 1/10 PE)
  const peTables = dico.tables.filter((x) => x.domaine === 'pe').map((x) => x.nom);
  test('domaine « Perte d\'exploitation » présent', dico.domaines.pe === "Perte d'exploitation");
  test('5 tables dans le domaine pe', peTables.length === 5, peTables.join(', '));
  test('soumissions pe marquée versionnée', dico.tables.some((x) => x.nom === 'pe_soumissions' && x.versionnage));
  test('versions pe marquée versionnée', dico.tables.some((x) => x.nom === 'pe_soumission_versions' && x.versionnage));
  // Valeurs autorisées des CHECK documentées (étape 1/10 PE)
  test('statut pe : valeurs documentées', (col('pe_soumissions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('base_valeur pe : valeurs documentées', (col('pe_etablissements', 'base_valeur').valeurs || []).join(',') === 'remplacement,depreciation');
  test('période d\'indemnité pe : valeurs documentées', (col('pe_garanties', 'periode_indemnite_mois').valeurs || []).join(',') === '12,18,24');
  test('base d\'indemnité pe : valeurs documentées', (col('pe_garanties', 'base_montant').valeurs || []).join(',') === 'benefice_brut,marge_brute,chiffre_affaires');
  test('avenants pe : clés documentées', ((col('pe_garanties', 'avenants').valeurs || []).includes('frais_supplementaires') && (col('pe_garanties', 'avenants').valeurs || []).includes('dependance_fournisseurs') && (col('pe_garanties', 'avenants').valeurs || []).includes('acces_civil') && (col('pe_garanties', 'avenants').valeurs || []).includes('deterioration_stocks')));
  test('unicité garanties par soumission documentée (table pe)', /UNIQUE/.test(tbl('pe_garanties').description));
  test('unicité antécédents par soumission documentée (table pe)', /UNIQUE/.test(tbl('pe_antecedents').description));
  test('versions pe : colonnes figées marquées', /figé/.test(col('pe_soumission_versions', 'donnees').libelle));
  test('règle d\'or mentionne les versions pe', /pe_soumission_versions/.test(dico.regle_or || ''));
  // Enrichissement du domaine pe (étape 4/10 PE) : descriptions métier utiles à la
  // tarification PE — exposition par lieu, période d'indemnité, délai de carence,
  // base d'indemnité, 4 avenants, question piège des interruptions non déclarées.
  test('exposition : somme des CA par lieu (table)', /somme des chiffres d'affaires|exposition/i.test(tbl('pe_soumissions').description));
  test('établissements : chaîne d\'exploitation documentée (table)', /chaîne|nourrit le magasin/i.test(tbl('pe_etablissements').description));
  test('période : trop courte = limite épuisée avant reprise', /épuise|épuisée/i.test(col('pe_garanties', 'periode_indemnite_mois').description));
  test('franchise : en jours, pas un montant', /pas un montant/i.test(col('pe_garanties', 'franchise_jours').description));
  test('franchise : carence illustrée (7 jours indemnisés)', /7 jours/i.test(col('pe_garanties', 'franchise_jours').description));
  test('base : marge brute la plus courante au Québec', /plus courante au Québec/i.test(col('pe_garanties', 'base_montant').description));
  test('avenants pe : frais supplémentaires — continuer d\'opérer', /continuer d'opérer/i.test(col('pe_garanties', 'avenants').description));
  test('avenants pe : dépendance fournisseurs — fournisseur critique', /fournisseur/i.test(col('pe_garanties', 'avenants').description));
  test('avenants pe : accès civil — interdiction d\'accès', /interdiction d'accès/i.test(col('pe_garanties', 'avenants').description));
  test('avenants pe : détérioration des stocks réfrigérés', /réfrigérés/i.test(col('pe_garanties', 'avenants').description));
  test('interruptions : fragilité et plan de continuité', /plan de continuité/i.test(col('pe_antecedents', 'interruptions_5ans').description));
  test('interruptions : incidents non réclamés comptent', /non réclamés/i.test(col('pe_antecedents', 'interruptions_5ans').description));
  test('question piège : interruption non déclarée (table)', /piège/i.test(tbl('pe_antecedents').description));
  test('versions pe : colonnes figées marquées (figee)', ['statut', 'notes', 'date_effet_souhaitee', 'donnees'].every((c) => col('pe_soumission_versions', c).figee === true));
  test('versions pe : statut valeurs documentées', (col('pe_soumission_versions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('versions pe : snapshot de conformité documenté', /conformité|snapshot/i.test(col('pe_soumission_versions', 'donnees').description));
  // Domaine Flotte automobile : les tables sont regroupées sous le domaine « flotte » (étape 1/10 flotte)
  const flotteTables = dico.tables.filter((x) => x.domaine === 'flotte').map((x) => x.nom);
  test('domaine « Flotte automobile » présent', dico.domaines.flotte === 'Flotte automobile');
  test('6 tables dans le domaine flotte', flotteTables.length === 6, flotteTables.join(', '));
  test('soumissions flotte marquée versionnée', dico.tables.some((x) => x.nom === 'flotte_soumissions' && x.versionnage));
  test('versions flotte marquée versionnée', dico.tables.some((x) => x.nom === 'flotte_soumission_versions' && x.versionnage));
  // Valeurs autorisées des CHECK documentées (étape 1/10 flotte)
  test('statut flotte : valeurs documentées', (col('flotte_soumissions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('usage_dominant flotte : valeurs documentées', (col('flotte_soumissions', 'usage_dominant').valeurs || []).join(',') === 'livraison,service,transport_marchandises,personnel,mixte');
  test('type_vehicule flotte : valeurs documentées', (col('flotte_vehicules', 'type_vehicule').valeurs || []).join(',') === 'camion,automobile,remorque,equipement');
  test('usage véhicule flotte : valeurs documentées', (col('flotte_vehicules', 'usage').valeurs || []).join(',') === 'livraison,service,transport_marchandises,personnel');
  test('avenants FAQ flotte : clés documentées', ((col('flotte_garanties', 'avenants').valeurs || []).includes('faq43') && (col('flotte_garanties', 'avenants').valeurs || []).includes('faq20') && (col('flotte_garanties', 'avenants').valeurs || []).includes('faq27') && (col('flotte_garanties', 'avenants').valeurs || []).includes('faq34') && (col('flotte_garanties', 'avenants').valeurs || []).includes('faq5a')));
  test('unicité garanties par soumission documentée (table flotte)', /UNIQUE/.test(tbl('flotte_garanties').description));
  test('unicité antécédents par soumission documentée (table flotte)', /UNIQUE/.test(tbl('flotte_antecedents').description));
  test('versions flotte : colonnes figées marquées', /figé/.test(col('flotte_soumission_versions', 'donnees').libelle));
  test('règle d\'or mentionne les versions flotte', /flotte_soumission_versions/.test(dico.regle_or || ''));
  test('liaison police flotte : UNIQUE documentée', /UNIQUE/.test(col('polices', 'flotte_soumission_id').description));
  test('liaison police flotte : version figée documentée', /figée/.test(col('polices', 'flotte_soumission_version').description));
  // Enrichissement du domaine flotte (étape 4/10 flotte) : descriptions métier utiles à la
  // tarification flotte — exposition = somme des valeurs des véhicules + profil des
  // conducteurs, garanties à la police et non par véhicule, NIV tarifaire, rayon et
  // usage facteurs de prime, FAQ détaillés, ratio de pertes, questions pièges.
  test('exposition : somme des valeurs des véhicules (table)', /somme des valeurs des véhicules/i.test(tbl('flotte_soumissions').description));
  test('exposition : profil des conducteurs (table)', /profil des conducteurs/i.test(tbl('flotte_soumissions').description));
  test('garanties à la police, pas par véhicule (table)', /pas par véhicule/i.test(tbl('flotte_garanties').description));
  test('NIV : identifiant tarifaire clé', /identifiant tarifaire clé/i.test(col('flotte_vehicules', 'niv').description));
  test('rayon flotte : facteur de tarification majeur', /facteur de tarification majeur/i.test(col('flotte_soumissions', 'rayon_operation_km').description));
  test('usage véhicule : facteur de prime majeur', /facteur de prime majeur/i.test(col('flotte_vehicules', 'usage').description));
  test('question piège : usage réel différent de l\'usage déclaré (table)', /usage réel différent/i.test(tbl('flotte_soumissions').description));
  test('conducteurs : exposition principale (table)', /exposition principale/i.test(tbl('flotte_conducteurs').description));
  test('question piège : conducteur non déclaré (table)', /conducteur non déclaré/i.test(tbl('flotte_conducteurs').description));
  test('classe de permis SAAQ documentée', /SAAQ/i.test(col('flotte_conducteurs', 'classe_permis').description));
  test('expérience véhicules lourds documentée', /véhicules lourds/i.test(col('flotte_conducteurs', 'annees_experience_lourds').description));
  test('sinistres conducteur : incidents non réclamés comptent', /non réclamés/i.test(col('flotte_conducteurs', 'sinistres_5ans').description));
  test('infractions : points SAAQ documentés', /points/i.test(col('flotte_conducteurs', 'infractions_3ans').description));
  test('limite RC 2 M$ courante en transport documentée', /2 000 000/.test(col('flotte_garanties', 'limite_rc').description));
  test('avenants flotte : FAQ 43 valeur à neuf véhicules récents', /valeur à neuf/i.test(col('flotte_garanties', 'avenants').description) && /véhicules récents/i.test(col('flotte_garanties', 'avenants').description));
  test('avenants flotte : FAQ 20 privation de jouissance', /privation de jouissance/i.test(col('flotte_garanties', 'avenants').description));
  test('avenants flotte : FAQ 27 véhicule n\'appartenant pas à l\'assuré', /n'appartenant pas/i.test(col('flotte_garanties', 'avenants').description));
  test('avenants flotte : FAQ 34 indemnités d\'accident', /indemnités d'accident/i.test(col('flotte_garanties', 'avenants').description));
  test('avenants flotte : FAQ 5a crédit-bail', /crédit-bail/i.test(col('flotte_garanties', 'avenants').description));
  test('ratio de pertes : indicateur de sinistralité (flotte)', /sinistres payés/i.test(col('flotte_antecedents', 'ratio_pertes').description));
  test('sinistres flotte : incidents non réclamés comptent', /non réclamés/i.test(col('flotte_antecedents', 'sinistres_flotte_5ans').description));
  test('consentements flotte : dossier SAAQ essentiel', /dossier SAAQ/i.test(col('flotte_antecedents', 'consentements').description));
  test('versions flotte : colonnes figées marquées (figee)', ['statut', 'notes', 'date_effet_souhaitee', 'donnees'].every((c) => col('flotte_soumission_versions', c).figee === true));
  test('versions flotte : statut valeurs documentées', (col('flotte_soumission_versions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('versions flotte : snapshot de conformité documenté', /conformité|snapshot/i.test(col('flotte_soumission_versions', 'donnees').description));
  test('flotte : aucune description « undefined »', dico.tables.filter((x) => x.domaine === 'flotte').every((t) => t.colonnes.every((c) => c.description && !/undefined/i.test(c.description))));
  test('flotte : descriptions enrichies non vides', dico.tables.filter((x) => x.domaine === 'flotte').every((t) => t.description && t.description.length > 50));
  // Domaine Cautionnement : les tables sont regroupées sous le domaine « cautionnement » (étape 1/10 cautionnement)
  const cautTables = dico.tables.filter((x) => x.domaine === 'cautionnement').map((x) => x.nom);
  test('domaine « Cautionnement » présent', dico.domaines.cautionnement === 'Cautionnement');
  test('5 tables dans le domaine cautionnement', cautTables.length === 5, cautTables.join(', '));
  test('soumissions cautionnement marquée versionnée', dico.tables.some((x) => x.nom === 'caut_soumissions' && x.versionnage));
  test('versions cautionnement marquée versionnée', dico.tables.some((x) => x.nom === 'caut_soumission_versions' && x.versionnage));
  // Valeurs autorisées des CHECK documentées (étape 1/10 cautionnement)
  test('statut cautionnement : valeurs documentées', (col('caut_soumissions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('type obligation : valeurs documentées', (col('caut_obligations', 'type').valeurs || []).join(',') === 'soumission,execution,paiement_mo,rbq,autre');
  test('unicité ligne par soumission documentée (table caut)', /UNIQUE/.test(tbl('caut_garanties').description));
  test('unicité antécédents par soumission documentée (table caut)', /UNIQUE/.test(tbl('caut_antecedents').description));
  test('règle d\'or mentionne les versions cautionnement', /caut_soumission_versions/.test(dico.regle_or || ''));
  test('liaison police cautionnement : UNIQUE documentée', /UNIQUE/.test(col('polices', 'caut_soumission_id').description));
  test('liaison police cautionnement : version figée documentée', /figée/.test(col('polices', 'caut_soumission_version').description));
  // Enrichissement du domaine cautionnement (étape 4/10 cautionnement) : le cautionnement
  // n'est pas une assurance — trois parties (caution, principal, bénéficiaire), la caution
  // se retourne contre le principal (convention d'indemnisation), la ligne = capacité
  // accordée après analyse financière (fonds de roulement critère clé), exécution 50 %,
  // RBQ 20 000 $/40 000 $, question piège des réclamations non déclarées.
  test('cautionnement : trois parties documentées (table)', /trois parties/i.test(tbl('caut_soumissions').description));
  test('cautionnement : pas une assurance (table)', /n'est pas une assurance/i.test(tbl('caut_soumissions').description));
  test('cautionnement : retournement via convention d\'indemnisation', /convention d'indemnisation/i.test(tbl('caut_soumissions').description));
  test('bénéficiaire : donneur d\'ouvrage qui peut réclamer', /peut réclamer/i.test(col('caut_obligations', 'beneficiaire').description));
  test('exécution : 50 % du contrat', /50 %/.test(col('caut_obligations', 'montant_cautionnement').description));
  test('RBQ : 20 000 $ spécialisés / 40 000 $ généraux', /20 000/.test(col('caut_obligations', 'type').description) && /40 000/.test(col('caut_obligations', 'type').description));
  test('limite globale : capacité accordée après analyse financière', /capacité/i.test(col('caut_garanties', 'limite_globale').description) && /états financiers/i.test(col('caut_garanties', 'limite_globale').description));
  test('limite par projet : jamais au-dessus de la globale', /ne peut jamais dépasser/i.test(col('caut_garanties', 'limite_par_projet').description));
  test('fonds de roulement : critère clé de la caution', /critère clé/i.test(col('caut_garanties', 'fonds_roulement').description));
  test('question piège : réclamation non déclarée (table)', /piège/i.test(tbl('caut_antecedents').description));
  test('réclamations : la caution se retourne contre le principal', /se retourne/i.test(col('caut_antecedents', 'reclamations_5ans').description));
  test('refus/résiliation : à déclarer obligatoirement', /déclarer obligatoirement/i.test(col('caut_antecedents', 'refus_resiliation_ant').description));
  test('consentements caut : pièces exigées par la caution', /exigées/i.test(col('caut_antecedents', 'consentements').description));
  test('versions caut : colonnes figées marquées (figee)', ['statut', 'notes', 'date_effet_souhaitee', 'donnees'].every((c) => col('caut_soumission_versions', c).figee === true));
  test('versions caut : statut valeurs documentées', (col('caut_soumission_versions', 'statut').valeurs || []).join(',') === 'brouillon,soumise,convertie_police');
  test('versions caut : snapshot de conformité documenté', /conformité|snapshot/i.test(col('caut_soumission_versions', 'donnees').description));
  test('cautionnement : aucune description « undefined »', dico.tables.filter((x) => x.domaine === 'cautionnement').every((t) => t.colonnes.every((c) => c.description && !/undefined/i.test(c.description))));
  test('cautionnement : descriptions enrichies non vides', dico.tables.filter((x) => x.domaine === 'cautionnement').every((t) => t.description && t.description.length > 50));
  const usages = new Set(['soumission', 'gestion', 'les_deux', 'technique']);
  const mauvais = [];
  for (const t of dico.tables) for (const c of t.colonnes) {
    if (!usages.has(c.usage)) mauvais.push(`${t.nom}.${c.nom}`);
  }
  test('usages valides partout', mauvais.length === 0, mauvais.slice(0, 3).join(', '));
  test('règle d\'or mentionnée', /rien ne se supprime/i.test(dico.regle_or || ''));

  // ---- 2. Aucune donnée personnelle dans le dictionnaire -------------------------
  console.log('2. Métadonnées uniquement');
  const brut = JSON.stringify(dico);
  test('aucune adresse demo.ca', !/demo\.ca/i.test(brut));
  test('aucun nom de client démo', !/Méthot|Petit Four|Saint-Michel/i.test(brut));
  test('aucun hash ou secret documenté en valeur', !/ChangeMoi|totp_secret.{0,20}[A-Z2-7]{10,}/i.test(brut));

  // ---- 3. contexteDonnees() -------------------------------------------------------
  console.log('3. Contexte IA');
  const { contexteDonnees, contexteTables } = require('../lib/contexte-ia');
  const ctx = contexteDonnees();
  test('contexteDonnees() retourne un texte non vide', typeof ctx === 'string' && ctx.length > 1000, String(ctx && ctx.length));
  for (const t of ['clients', 'polices', 'auto_vehicules', 'factures', 'biens_batiments', 'biens_garanties', 'biens_soumission_versions',
    'rc_exploitations', 'rc_garanties', 'rc_soumission_versions']) {
    test(`contexte contient TABLE ${t}`, ctx.includes(`TABLE ${t}`));
  }
  test('contexte mentionne la règle d\'or', /rien ne se supprime/i.test(ctx));
  test('contexte mentionne les versions biens', ctx.includes('biens_soumission_versions'));
  test('contexte mentionne les versions RC', ctx.includes('rc_soumission_versions'));
  test('contexte expose les valeurs type_construction', ctx.includes('bois|acier|beton|maconnerie|mixte'));
  test('contexte expose les valeurs sous_traitants', ctx.includes('aucun|assures|non_assures'));
  test('contexte expose les valeurs formule RC', ctx.includes('locaux_operations|produits_completes|globale'));
  test('contexte expose les valeurs type_mesure (cyber)', ctx.includes('mfa|sauvegardes|antivirus_edr'));
  test('contexte expose les valeurs statut mesure (cyber)', ctx.includes('en_place|partiel|absent|prevu'));
  test('contexte mentionne les versions E&O', ctx.includes('eo_soumission_versions'));
  test('contexte expose les valeurs base (E&O)', ctx.includes('reclamations_presentees|occurrences'));
  test('contexte expose les avenants E&O', ctx.includes('frais_defense|medias_contenu|cyber_associe'));
  test('contexte mentionne les versions D&O', ctx.includes('do_soumission_versions'));
  test('contexte expose les avenants D&O', ctx.includes('frais_defense|pratiques_emploi|fidelite_crime'));
  test('contexte contient TABLE do_garanties', ctx.includes('TABLE do_garanties'));
  test('contexte mentionne les versions PE', ctx.includes('pe_soumission_versions'));
  test('contexte expose la période d\'indemnité (PE)', ctx.includes('12|18|24'));
  test('contexte expose la base PE', ctx.includes('benefice_brut|marge_brute|chiffre_affaires'));
  test('contexte expose les avenants PE', ctx.includes('frais_supplementaires|dependance_fournisseurs|acces_civil|deterioration_stocks'));
  test('contexte contient TABLE pe_garanties', ctx.includes('TABLE pe_garanties'));
  test('contexte règle d\'or mentionne les versions pe', ctx.includes('pe_soumission_versions'));
  test('contexte mentionne les versions flotte', ctx.includes('flotte_soumission_versions'));
  test('contexte contient TABLE flotte_vehicules', ctx.includes('TABLE flotte_vehicules'));
  test('contexte contient TABLE flotte_conducteurs', ctx.includes('TABLE flotte_conducteurs'));
  test('contexte contient TABLE flotte_garanties', ctx.includes('TABLE flotte_garanties'));
  test('contexte expose les valeurs usage_dominant (flotte)', ctx.includes('livraison|service|transport_marchandises|personnel|mixte'));
  test('contexte expose les valeurs type_vehicule (flotte)', ctx.includes('camion|automobile|remorque|equipement'));
  test('contexte expose les avenants FAQ (flotte)', ctx.includes('faq43|faq20|faq27|faq34|faq5a'));
  test('contexte expose l\'exposition flotte (somme des valeurs)', ctx.includes('somme des valeurs des véhicules'));
  test('contexteTables() non vide', contexteTables().includes('- clients'));
  const ctxS = contexteDonnees({ usages: ['soumission'] });
  test('filtre par usage (soumission)', ctxS.includes('raison_sociale') && !ctxS.includes('mot_de_passe_hash'));
  test('contexteDonnees() sans données personnelles', !/demo\.ca|Méthot/i.test(ctx));

  // ---- 4. Page admin ---------------------------------------------------------------
  console.log('4. Page Admin → Dictionnaire');
  const jar = nouveauJar();
  let r = await connexion(jar, 'admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  r = await req(jar, 'GET', '/admin/dictionnaire');
  test('GET /admin/dictionnaire → 200 (admin)', r.statut === 200, r.statut);
  test('titre présent', /Dictionnaire des champs/.test(r.texte));
  test('table auto_vehicules affichée', r.texte.includes('<code>auto_vehicules</code>'));
  test('champ vin documenté affiché', /NIV \(VIN\)/.test(r.texte));
  test('règle d\'or affichée', /rien ne se supprime/i.test(r.texte));
  test('aucune donnée client sur la page', !/Méthot|demo\.ca/i.test(r.texte));
  test('champ de recherche présent', r.texte.includes('data-dictionnaire-recherche'));
  test('domaine Biens commerciaux affiché', r.texte.includes('Biens commerciaux'));
  test('table biens_batiments affichée', r.texte.includes('<code>biens_batiments</code>'));
  test('valeurs type_construction affichées', r.texte.includes('maconnerie'));
  test('badge versionnée sur biens_soumissions', /biens_soumissions<\/code>[\s\S]{0,200}badge-bleu/.test(r.texte));
  test('domaine Responsabilité civile (CGL) affiché', r.texte.includes('Responsabilité civile (CGL)'));
  test('table rc_exploitations affichée', r.texte.includes('<code>rc_exploitations</code>'));
  test('table rc_garanties affichée', r.texte.includes('<code>rc_garanties</code>'));
  test('valeurs sous_traitants affichées', r.texte.includes('non_assures'));
  test('valeurs formule RC affichées', r.texte.includes('produits_completes'));
  test('badge versionnée sur rc_soumissions', /rc_soumissions<\/code>[\s\S]{0,200}badge-bleu/.test(r.texte));
  test('domaine Cyberrisques affiché', r.texte.includes('Cyberrisques'));
  test('table cyber_mesures affichée', r.texte.includes('<code>cyber_mesures</code>'));
  test('table cyber_garanties affichée', r.texte.includes('<code>cyber_garanties</code>'));
  test('valeurs type_mesure affichées', r.texte.includes('formation_hameconnage'));
  test('badge figée sur les versions cyber', /cyber_soumission_versions<\/code>[\s\S]{0,3000}figée<\/span>/.test(r.texte));
  test('domaine Responsabilité professionnelle (E&O) affiché', r.texte.includes('Responsabilité professionnelle'));
  test('table eo_activites affichée', r.texte.includes('<code>eo_activites</code>'));
  test('table eo_garanties affichée', r.texte.includes('<code>eo_garanties</code>'));
  test('valeurs base affichées', r.texte.includes('reclamations_presentees'));
  test('badge figée sur les versions eo', /eo_soumission_versions<\/code>[\s\S]{0,3000}figée<\/span>/.test(r.texte));
  test('domaine Responsabilité des administrateurs et dirigeants (D&O) affiché', r.texte.includes('Responsabilité des administrateurs et dirigeants'));
  test('table do_dirigeants affichée', r.texte.includes('<code>do_dirigeants</code>'));
  test('table do_garanties affichée', r.texte.includes('<code>do_garanties</code>'));
  test('badge figée sur les versions do', /do_soumission_versions<\/code>[\s\S]{0,3000}figée<\/span>/.test(r.texte));
  test('domaine Perte d\'exploitation affiché', r.texte.includes("Perte d'exploitation"));
  test('table pe_etablissements affichée', r.texte.includes('<code>pe_etablissements</code>'));
  test('table pe_garanties affichée', r.texte.includes('<code>pe_garanties</code>'));
  test('valeurs base_montant affichées', r.texte.includes('marge_brute'));
  test('badge figée sur les versions pe', /pe_soumission_versions<\/code>[\s\S]{0,3000}figée<\/span>/.test(r.texte));
  test('domaine Flotte automobile affiché', r.texte.includes('Flotte automobile'));
  test('table flotte_vehicules affichée', r.texte.includes('<code>flotte_vehicules</code>'));
  test('table flotte_conducteurs affichée', r.texte.includes('<code>flotte_conducteurs</code>'));
  test('table flotte_garanties affichée', r.texte.includes('<code>flotte_garanties</code>'));
  test('valeurs usage_dominant affichées', r.texte.includes('transport_marchandises'));
  test('valeurs type_vehicule affichées', r.texte.includes('equipement'));
  test('badge figée sur les versions flotte', /flotte_soumission_versions<\/code>[\s\S]{0,3000}figée<\/span>/.test(r.texte));

  // Lien depuis la page Utilisateurs
  r = await req(jar, 'GET', '/admin/utilisateurs');
  test('lien vers le dictionnaire depuis Utilisateurs', r.texte.includes('/admin/dictionnaire'));

  // ---- 5. Réservé à l'admin ---------------------------------------------------------
  console.log('5. Réservé au rôle admin');
  r = await req(jar, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jar, 'POST', '/admin/utilisateurs', {
    form: { _csrf: csrf(r.texte), nom: 'Courtier Dico', email: 'courtier-dico@test.ca', cabinet_id: '1', role: 'courtier', mot_de_passe: 'CourtierDico1!' },
  });
  test('création courtier → 302', r.statut === 302, r.statut);
  const jarC = nouveauJar();
  r = await connexion(jarC, 'courtier-dico@test.ca', 'CourtierDico1!');
  r = await req(jarC, 'GET', '/mot-de-passe');
  r = await req(jarC, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'CourtierDico1!', nouveau: 'CourtierDico2!', confirmation: 'CourtierDico2!' } });
  r = await req(jarC, 'GET', '/admin/dictionnaire');
  test('GET /admin/dictionnaire → 403 (courtier)', r.statut === 403, r.statut);

  // ---- 6. Branchement IA : le prompt Cohere connaît le schéma -----------------------
  console.log('6. Branchement IA');
  const srcAssistant = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'assistant.js'), 'utf8');
  test('assistant.js injecte le schéma dans le prompt Cohere', /contexteTables\(\)/.test(srcAssistant));

  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE :', e); process.exit(1); });
