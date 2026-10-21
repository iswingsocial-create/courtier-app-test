/**
 * public/dictee.js — Normalisation d'un texte dicté (français) avant envoi
 * au pipeline de commandes IA.
 *
 * Module partagé : fonctionne dans le navigateur (window.Dictee) et dans
 * Node (require, pour les tests). La reconnaissance vocale (Web Speech API)
 * transcrit les nombres en lettres (« deux mille vingt-six ») et épelle les
 * codes (« T un deux trois ») ; cette normalisation les re-convertit en
 * chiffres là où le sens est sans ambiguïté :
 *   - « X million(s)/milliard(s) » → « 2 millions » devient 2000000
 *     (l'unité est supprimée, comme « millions » ici)
 *   - années 1900–2100 en lettres → « deux mille vingt-six » devient 2026
 *   - suites de ≥ 4 chiffres épelés (NIV, permis, téléphone) → 1234567
 *     (lettre isolée conservée : « T un deux trois » → « T123 »)
 *   - biens (étape 9/10 biens), uniquement quand le nombre est ancré par une
 *     unité ou un mot de rue :
 *     « neuf cent cinquante mille dollars » → « 950000 »
 *     « douze mille pieds carrés » → « 12000 »
 *     « cent vingt-trois rue Principale » → « 123 rue Principale »
 *     (« 1500000 dollars » déjà en chiffres → « 1500000 »)
 *   - RC (étape 9/10 RC) : montants décimaux dictés, ancrés sur
 *     million(s)/milliard(s) :
 *     « un virgule deux million » → « 1200000 »
 *     (« un virgule deux options », sans ancrage, reste du texte libre)
 *   - Cyber (étape 9/10 cyber), durées et références :
 *     « délai de carence de huit heures » → « délai de carence de 8 heures »
 *     (l'unité « heures » est conservée : le délai est stocké avec son unité)
 *     « à la soumission cyber un » → « à la soumission cyber 1 »
 *     (l'analyseur exige des chiffres) ; « la mesure deux » → « la mesure 2 »
 *   - E&O (étape 9/10 E&O), références :
 *     « à la soumission E&O un » → « à la soumission E&O 1 »
 *     « l'activité deux » → « l'activité 2 » (index d'activité)
 *     Les montants de CA sont déjà couverts par la règle « biens » ancrée
 *     sur « dollars » (« avec cent quatre-vingt mille dollars de chiffre
 *     d'affaires » → « avec 180000 de chiffre d'affaires ») et les montants
 *     décimaux RC (« un virgule deux million » → « 1200000 »). Les libellés
 *     métier (« base réclamations présentées », « base occurrences »,
 *     « frais de défense », « médias et contenu », « cyber associé »)
 *     passent en texte libre : l'analyseur les reconnaît tels quels.
 *   - D&O (étape 9/10 D&O), références et vocabulaire :
 *     « à la soumission D&O un » → « à la soumission D&O 1 » (aussi dicté
 *     « d o », en deux mots)
 *     « le dirigeant deux » → « le dirigeant 2 » (index de dirigeant —
 *     distinct de « le conducteur deux » FPQ1, jamais confondus)
 *     « quinze ans d'expérience » → « 15 ans d'expérience » (l'unité
 *     « ans d'expérience » est conservée : l'analyseur exige des chiffres)
 *     élision : « pratiques d emploi » → « pratiques d'emploi » (la dictée
 *     sépare parfois le « d' » alors que l'analyseur exige l'apostrophe)
 *     Les montants D&O sont couverts par les règles existantes (« dix mille
 *     dollars » → 10000, « deux millions » → 2000000, « un virgule deux
 *     million » → 1200000).
 *   - Perte d'exploitation (étape 9/10 PE), références et vocabulaire :
 *     « à la soumission perte d'exploitation un » → « à la soumission perte
 *     d'exploitation 1 » (aussi « à la soumission PE un » → « PE 1 »)
 *     « l'établissement deux » → « l'établissement 2 » (index
 *     d'établissement — distinct du « lieu » RC et du « bâtiment » biens)
 *     « période d'indemnité dix-huit mois » → « période d'indemnité 18 mois »
 *     (l'unité « mois » est conservée : l'analyseur exige 12, 18 ou 24)
 *     « franchise cinq jours » → « franchise 5 jours » (l'unité « jours »
 *     est conservée : l'analyseur exige « <chiffre> jours »)
 *     élision : « perte d exploitation » → « perte d'exploitation »,
 *     « d indemnité » → « d'indemnité », « d affaires » → « d'affaires »
 *     (la dictée sépare parfois le « d' », le marqueur PE exige
 *     l'apostrophe)
 *   - Flotte automobile (étape 9/10 flotte), références et vocabulaire :
 *     « à la soumission flotte un » → « à la soumission flotte 1 »
 *     (aussi « à la soumission flotte automobile deux » → « flotte
 *     automobile 2 ») — jamais confondu avec « soumission auto N » FPQ1,
 *     qui reste intacte, et réciproquement
 *     « le véhicule deux » → « le véhicule 2 », « le conducteur trois » →
 *     « le conducteur 3 » (index véhicule / conducteur flotte),
 *     « classe trois » → « classe 3 » (classe de permis SAAQ)
 *     « rayon de cent cinquante kilomètres » → « rayon de 150 km »
 *     (l'analyseur flotte exige « km », pas « kilomètres »)
 *     « valeur a neuf » → « valeur à neuf » (l'analyseur exige « à » ;
 *     « neuf » n'est PAS converti en 9 : c'est le libellé FAQ 43)
 *     codes FAQ épelés : « f a q quarante-trois » → « FAQ 43 »
 *     (« f a q » est recollé sans avaler le nombre qui suit, lequel est
 *     converti par la référence FAQ), « FAQ quarante-trois » → « FAQ 43 »,
 *     « f a q cinq a » → « FAQ 5 a » (FAQ 5a)
 *     élision : « indemnités d accident » → « indemnités d'accident »
 *     (« privation de jouissance » et « indemnités d'accident » passent
 *     en texte libre, reconnus tels quels par les analyseurs flotte)
 *     Les montants flotte sont couverts par les règles existantes
 *     (« deux millions » → 2000000, « quarante-cinq mille dollars » → 45000).
 *   - Cautionnement (étape 9/10 cautionnement), références et vocabulaire :
 *     « à la soumission cautionnement un » → « à la soumission
 *     cautionnement 1 » — jamais confondu avec la référence courte FPQ1
 *     « soumission N », qui reste intacte, et réciproquement
 *     « l'obligation deux » → « l'obligation 2 » (index d'obligation)
 *     élision : « cautionnement d exécution » → « cautionnement
 *     d'exécution » (la dictée sépare parfois le « d' », l'analyseur
 *     exige l'apostrophe pour reconnaître le type d'obligation)
 *     Les montants cautionnement sont couverts par les règles existantes
 *     (« limite globale cinq millions » → « limite globale 5000000 »,
 *     « 40 000 $ » pour le RBQ, « 50 % du contrat » en texte libre).
 * Rien d'autre n'est modifié : le texte libre (« ajoute un conducteur »)
 * reste intact.
 */
(function (racine, fabrique) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = fabrique();
  } else {
    racine.Dictee = fabrique();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var UNITES = {
    'zero': 0, 'zéro': 0, 'un': 1, 'une': 1, 'deux': 2, 'trois': 3,
    'quatre': 4, 'cinq': 5, 'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9,
    'dix': 10, 'onze': 11, 'douze': 12, 'treize': 13, 'quatorze': 14,
    'quinze': 15, 'seize': 16,
  };
  var DIZAINES = { 'vingt': 20, 'trente': 30, 'quarante': 40, 'cinquante': 50, 'soixante': 60 };
  var CHIFFRES_SEULS = {
    'zero': '0', 'zéro': '0', 'un': '1', 'une': '1', 'deux': '2', 'trois': '3',
    'quatre': '4', 'cinq': '5', 'six': '6', 'sept': '7', 'huit': '8', 'neuf': '9',
  };

  // Valeur d'un mot simple ou composé (« quatre-vingt-dix-sept » → 97).
  // « quatre-vingt » doit être traité comme un bloc (80), pas comme 4 + 20.
  function valeurMot(mot) {
    var m80 = mot.match(/^quatre-vingts?(?:-(.+))?$/);
    if (m80) {
      if (!m80[1]) return 80;
      var reste = valeurMotSimple(m80[1]);
      return reste === null ? null : 80 + reste;
    }
    return valeurMotSimple(mot);
  }

  function valeurMotSimple(mot) {
    var parties = mot.split('-');
    var total = 0;
    for (var i = 0; i < parties.length; i++) {
      var p = parties[i];
      if (p === 'et') continue;
      if (p in UNITES) { total += UNITES[p]; continue; }
      if (p in DIZAINES) { total += DIZAINES[p]; continue; }
      return null;
    }
    return total;
  }

  function estMotNombre(tok) {
    var t = tok.toLowerCase();
    return t === 'et' || t === 'mille' || t === 'cent' || t === 'cents'
      || t === 'quatre-vingt' || t === 'quatre-vingts'
      || t in UNITES || t in DIZAINES || valeurMot(t) !== null;
  }

  function estChiffreSeul(tok) {
    return tok.toLowerCase() in CHIFFRES_SEULS;
  }

  // Parse une expression numérique simple (sans million/milliard) :
  // « deux mille vingt-six » → { valeur: 2026, longueur: 3 }.
  // Retourne null si rien de valide à partir de `debut`.
  function parseNombre(tokens, debut) {
    var total = 0, courant = 0, n = 0, i = debut;
    while (i < tokens.length) {
      var t = tokens[i].toLowerCase();
      if (t === 'et') { i++; continue; }
      if (t === 'mille') {
        total += (courant || 1) * 1000; courant = 0; n++; i++; continue;
      }
      var v = (t === 'cent' || t === 'cents') ? 100 : valeurMot(t);
      if (v === null || v === undefined || v >= 1000) break;
      if (v === 100) { courant = (courant || 1) * 100; }
      else { courant += v; }
      n++; i++;
    }
    if (n === 0) return null;
    return { valeur: total + courant, longueur: i - debut };
  }

  // Parse une expression numérique SANS « mille » (pour la partie après
  // « million » : « cinq cent » dans « un million cinq cent mille »).
  function parseNombreAvantMille(tokens, debut) {
    var courant = 0, n = 0, i = debut;
    while (i < tokens.length) {
      var t = tokens[i].toLowerCase();
      if (t === 'et') { i++; continue; }
      if (t === 'mille') break;
      var v = (t === 'cent' || t === 'cents') ? 100 : valeurMot(t);
      if (v === null || v === undefined || v >= 1000) break;
      if (v === 100) { courant = (courant || 1) * 100; }
      else { courant += v; }
      n++; i++;
    }
    return n ? { valeur: courant, longueur: n } : null;
  }

  // « X million(s)/milliard(s) [Y mille] » → { v, n } ou null.
  function parseMontant(tokens, i) {
    var base, n;
    if (/^\d+$/.test(tokens[i])) { base = Number(tokens[i]); n = 1; }
    else {
      var pb = parseNombre(tokens, i);
      if (!pb) return null;
      base = pb.valeur; n = pb.longueur;
    }
    var suiv = (tokens[i + n] || '').toLowerCase();
    var mult = 0;
    if (suiv === 'million' || suiv === 'millions') mult = 1e6;
    else if (suiv === 'milliard' || suiv === 'milliards') mult = 1e9;
    else return null;
    n++;
    var v = (base || 1) * mult;
    // « un million cinq cent mille » → 1 500 000
    var pr = parseNombreAvantMille(tokens, i + n);
    if (pr && pr.valeur < 1000) {
      var ap = (tokens[i + n + pr.longueur] || '').toLowerCase();
      if (ap === 'mille') { v += pr.valeur * 1000; n += pr.longueur + 1; }
    }
    return { v: v, n: n };
  }

  // --- RC commerciale (étape 9/10 RC) : montants décimaux dictés --------------------
  // Deux motifs, tous deux ancrés sur « million(s)/milliard(s) » :
  //   A. « un virgule deux million » → 1200000 (décimale avant l'unité)
  //   B. « un milliard virgule cinq » → 1500000000 (décimale après l'unité)
  // Sans ancrage, rien n'est converti (« un virgule deux options » reste
  // du texte libre).
  function multMillion(tok) {
    var t = (tok || '').toLowerCase();
    if (t === 'million' || t === 'millions') return 1e6;
    if (t === 'milliard' || t === 'milliards') return 1e9;
    return 0;
  }
  function parseFraction(tokens, debut) {
    if (debut < tokens.length && /^\d+$/.test(tokens[debut])) {
      return { valeur: Number(tokens[debut]), longueur: 1 };
    }
    return parseNombre(tokens, debut);
  }
  function parseMontantDecimal(tokens, i) {
    var pb;
    if (/^\d+$/.test(tokens[i])) {
      pb = { valeur: Number(tokens[i]), longueur: 1 };
    } else {
      pb = parseNombre(tokens, i);
      if (!pb) return null;
    }
    var j = i + pb.longueur;
    var multA = multMillion(tokens[j]);
    if (multA) {
      // Motif B : « un milliard virgule cinq »
      if ((tokens[j + 1] || '').toLowerCase() !== 'virgule') return null;
      var pf = parseFraction(tokens, j + 2);
      if (!pf) return null;
      var decB = String(pf.valeur).length;
      var vB = Math.round((pb.valeur + pf.valeur / Math.pow(10, decB)) * multA);
      return { v: vB, n: j + 2 + pf.longueur - i };
    }
    if ((tokens[j] || '').toLowerCase() !== 'virgule') return null;
    // Motif A : « un virgule deux million »
    var pfA = parseFraction(tokens, j + 1);
    if (!pfA) return null;
    var mult = multMillion(tokens[j + 1 + pfA.longueur]);
    if (!mult) return null;
    var decA = String(pfA.valeur).length;
    var v = Math.round((pb.valeur + pfA.valeur / Math.pow(10, decA)) * mult);
    return { v: v, n: j + 1 + pfA.longueur + 1 - i };
  }

  // --- Biens commerciaux (étape 9/10 biens) : nombres ancrés -----------------------
  // La dictée produit des nombres en lettres là où l'analyseur attend des
  // chiffres (« superficie douze mille pieds carrés »). Conversion uniquement
  // quand le nombre est ancré par une unité (« dollars », « pieds carrés »),
  // par un mot de rue (« cent vingt-trois rue Principale ») ou par un mot-clé
  // de champ (« superficie de douze mille »). L'unité redondante est supprimée
  // (comme « millions » dans parseMontant) ; le texte libre n'est pas touché.
  var MOTS_RUE = ['rue', 'avenue', 'boulevard', 'chemin', 'route', 'rang',
    'montée', 'montee', 'impasse', 'place', 'allée', 'allee', 'côte', 'cote',
    'croissant', 'terrasse'];
  var MOTS_CHAMP_NOMBRE = ['superficie', 'valeur', 'franchise', 'montant'];

  function estUniteDollars(tok) {
    var t = (tok || '').toLowerCase();
    return t === 'dollar' || t === 'dollars' || t === '$';
  }
  // Nombre de tokens de l'unité « pieds carrés » / « pi2 » / « pi carré » (0 sinon).
  function longueurUniteSuperficie(tokens, i) {
    var t1 = (tokens[i] || '').toLowerCase();
    var t2 = (tokens[i + 1] || '').toLowerCase();
    if (t1 === 'pi2') return 1;
    if ((t1 === 'pied' || t1 === 'pieds' || t1 === 'pi')
        && /^(carré|carrés|carre|carres)$/.test(t2)) return 2;
    return 0;
  }
  // Parse une expression numérique pour les règles ancrées. Si tous les mots
  // sont des chiffres isolés (« un deux trois »), ils sont concaténés
  // (« 123 ») ; sinon parseNombre (« douze mille » → 12000).
  function parseNombreAncre(tokens, debut) {
    var mots = [], i = debut;
    while (i < tokens.length && estMotNombre(tokens[i])) { mots.push(tokens[i].toLowerCase()); i++; }
    if (!mots.length) return null;
    var epele = mots.every(function (m) { return m in CHIFFRES_SEULS; });
    var valeur = epele
      ? Number(mots.map(function (m) { return CHIFFRES_SEULS[m]; }).join(''))
      : (parseNombre(tokens, debut) || {}).valeur;
    if (valeur === undefined || valeur === null || isNaN(valeur)) return null;
    return { valeur: valeur, longueur: i - debut };
  }
  // Dernier mot significatif déjà émis (saute un « de » / « d' » parasite).
  function motPrecedent(sortie) {
    for (var k = sortie.length - 1; k >= 0; k--) {
      var w = sortie[k].toLowerCase().replace(/[.,;:!?]$/, '');
      if (w === 'de' || w === "d'") continue;
      return w;
    }
    return '';
  }
  // Les n derniers mots significatifs déjà émis (sans « de » / « d' »).
  function derniersMots(sortie, n) {
    var mots = [];
    for (var k = sortie.length - 1; k >= 0 && mots.length < n; k--) {
      var w = sortie[k].toLowerCase().replace(/[.,;:!?]$/, '');
      if (w === 'de' || w === "d'") continue;
      mots.unshift(w);
    }
    return mots;
  }

  function normaliserDictee(texte) {
    var t = String(texte || '');
    t = t.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
    if (!t) return t;
    var tokens = t.split(' ');
    var sortie = [];
    var i = 0;
    while (i < tokens.length) {
      // 0a) Flotte : code FAQ épelé — « f a q » (trois lettres isolées) est
      //     recollé en « FAQ » SANS avaler le nombre qui suit : celui-ci est
      //     converti à l'itération suivante par la référence FAQ (règle 1b).
      //     Leçon du bug des codes épelés (D&O) : ne jamais fusionner la
      //     lettre/le code avec le nombre (« f a q quarante-trois » ne doit
      //     pas devenir un code opaque, mais « FAQ 43 »).
      if (/^f$/i.test(tokens[i]) && /^a$/i.test(tokens[i + 1] || '')
          && /^q$/i.test(tokens[i + 2] || '')) {
        sortie.push('FAQ');
        i += 3;
        continue;
      }
      // 0b) Flotte : « valeur a neuf » → « valeur à neuf ». La dictée perd
      //     l'accent de « à » alors que l'analyseur FAQ 43 exige
      //     « valeur à neuf » ; « neuf » reste un mot (jamais « 9 » ici).
      if (/^a$/i.test(tokens[i])
          && motPrecedent(sortie) === 'valeur'
          && /^neuf$/i.test(tokens[i + 1] || '')) {
        sortie.push('à');
        i += 1;
        continue;
      }
      // 0) Élision — la dictée sépare parfois le « d' » de son mot
      //    (« pratiques d emploi », « ans d expérience », « perte
      //    d exploitation », « d indemnité », « d affaires », « indemnités
      //    d accident ») alors que l'analyseur exige l'apostrophe. Seuls
      //    les mots métier connus sont éliés (« d o », le produit D&O
      //    dicté en deux mots, passe intact).
      if (/^[dD]$/.test(tokens[i]) && /^(emploi|exp[ée]rience|exploitation|indemnit[ée]|affaires|accident|ex[ée]cution)$/i.test(tokens[i + 1] || '')) {
        sortie.push("d'" + tokens[i + 1].toLowerCase());
        i += 2;
        continue;
      }
      // 1a) RC : montants décimaux dictés, « un virgule deux million » → 1200000.
      //     Passe AVANT la règle 1 (plus spécifique) : sinon « un milliard
      //     virgule cinq » serait avalé partiellement par la règle 1
      //     (« un milliard » → 1000000000 + « virgule cinq » orphelin).
      var montantDecimal = parseMontantDecimal(tokens, i);
      if (montantDecimal) {
        sortie.push(String(montantDecimal.v));
        i += montantDecimal.n;
        continue;
      }
      // 1) Montants : « 2 millions », « un million cinq cent mille »
      var montant = parseMontant(tokens, i);
      if (montant) {
        sortie.push(String(montant.v));
        i += montant.n;
        continue;
      }
      // 1b) Biens : nombre ancré par une unité, un mot de rue ou un mot-clé de champ
      var ancre = parseNombreAncre(tokens, i);
      if (ancre) {
        var a1 = (tokens[i + ancre.longueur] || '').toLowerCase();
        var a2 = (tokens[i + ancre.longueur + 1] || '').toLowerCase();
        var saut = 0;
        // Flotte (étape 9/10 flotte) : distances — « rayon de cent cinquante
        // kilomètres » → « rayon de 150 km ». L'unité est normalisée en
        // « km » (c'est la forme qu'exigent les analyseurs flotte :
        // « rayon 200 km », « … à 150 km ») — contrairement à « heures » /
        // « jours » qui conservent leur libellé complet.
        if (/^(kilom[èe]tres?|km)$/.test(a1)) {
          sortie.push(String(ancre.valeur));
          sortie.push('km');
          i += ancre.longueur + 1;
          continue;
        }
        // Cyber (étape 9/10 cyber) : durées — « délai de carence de huit
        // heures » → « délai de carence de 8 heures ». L'unité est conservée
        // (le délai est stocké avec son unité), contrairement aux montants.
        if (/^heures?$/.test(a1)) {
          sortie.push(String(ancre.valeur));
          sortie.push('heures');
          i += ancre.longueur + 1;
          continue;
        }
        // PE (étape 9/10 PE) : jours de carence — « franchise cinq jours » →
        // « franchise 5 jours », « délai de carence de huit jours » →
        // « délai de carence de 8 jours ». L'unité est conservée
        // (l'analyseur exige « <chiffre> jours »), comme pour les heures.
        if (/^jours?$/.test(a1)) {
          sortie.push(String(ancre.valeur));
          sortie.push('jours');
          i += ancre.longueur + 1;
          continue;
        }
        // PE : période d'indemnité — « période d'indemnité dix-huit mois » →
        // « période d'indemnité 18 mois ». L'unité « mois » est conservée
        // (l'analyseur exige 12, 18 ou 24). Seulement dans le contexte
        // indemnité/période (on remonte au-delà d'un éventuel « à »).
        if (a1 === 'mois') {
          var wMois = [];
          for (var kk = sortie.length - 1; kk >= 0 && wMois.length < 2; kk--) {
            var ww = sortie[kk].toLowerCase().replace(/[.,;:!?]$/, '');
            if (ww === 'de' || ww === "d'" || ww === 'à' || ww === 'la' || ww === 'le'
                || ww === 'l' || ww === 'les' || ww === 'du' || ww === 'des') continue;
            wMois.unshift(ww);
          }
          var contexteMois = wMois.some(function (w) {
            return /(indemnit[ée]|p[ée]riode)$/.test(w);
          });
          if (contexteMois) {
            sortie.push(String(ancre.valeur));
            sortie.push('mois');
            i += ancre.longueur + 1;
            continue;
          }
        }
        // D&O (étape 9/10 D&O) : années d'expérience — « quinze ans
        // d'expérience » → « 15 ans d'expérience ». L'unité est conservée
        // (l'analyseur exige un chiffre suivi de « ans d'expérience »).
        var a3 = (tokens[i + ancre.longueur + 2] || '').toLowerCase();
        if (/^ans?$/.test(a1)
            && (/^d['’]? ?exp[ée]rience$/.test(a2)
                || (a2 === 'd' && /^exp[ée]rience$/.test(a3)))) {
          sortie.push(String(ancre.valeur));
          sortie.push('ans');
          sortie.push("d'expérience");
          i += ancre.longueur + (a2 === 'd' ? 3 : 2);
          continue;
        }
        // Cyber : références — « à la soumission cyber un » → « à la
        // soumission cyber 1 » (l'analyseur exige des chiffres),
        // « la mesure deux » → « la mesure 2 » (index de mesure).
        // E&O (étape 9/10 E&O) — « à la soumission E&O un » → « à la
        // soumission E&O 1 » ; « l'activité deux » → « l'activité 2 »
        // (index d'activité).
        // D&O (étape 9/10 D&O) — « à la soumission D&O un » → « à la
        // soumission D&O 1 » (aussi dicté « d o » en deux mots) ;
        // « le dirigeant deux » → « le dirigeant 2 » (index de dirigeant).
        var dm = derniersMots(sortie, 2);
        var dm3 = derniersMots(sortie, 3);
        var refSoumission = (dm[0] === 'soumission'
          && (dm[1] === 'cyber' || dm[1] === 'e&o' || dm[1] === 'd&o'))
          || (dm3[0] === 'soumission' && dm3[1] === 'e' && dm3[2] === 'o')
          || (dm3[0] === 'soumission' && dm3[1] === 'd' && dm3[2] === 'o');
        var refMesure = /^(la|une|cette|sa|ma|ta|notre|votre)$/.test(dm[0] || '') && dm[1] === 'mesure';
        var dernier = (dm[dm.length - 1] || '').replace(/[’‘]/g, "'");
        var refActivite = dernier === "l'activité" || dernier === 'activité';
        var refDirigeant = dernier === 'dirigeant';
        // PE (étape 9/10 PE) — « à la soumission perte d'exploitation un » →
        // « à la soumission perte d'exploitation 1 » (dernier mot =
        // « d'exploitation »), « à la soumission PE un » → « PE 1 »,
        // « soumission interruption des affaires un » → « affaires 1 ».
        // « l'établissement deux » → « l'établissement 2 » (index
        // d'établissement — jamais confondu avec « le lieu » RC ni
        // « le bâtiment » biens).
        var refPE = dernier === "d'exploitation"
          || (dm[0] === 'soumission' && dm[1] === 'pe')
          || (dm3[0] === 'interruption' && dernier === 'affaires');
        var refEtablissement = dernier === "l'établissement" || dernier === 'établissement';
        // Flotte (étape 9/10 flotte) — « à la soumission flotte un » →
        // « à la soumission flotte 1 », « à la soumission flotte automobile
        // deux » → « flotte automobile 2 » (le mot « flotte » est conservé :
        // jamais de conversion vers une référence auto/FPQ1, et la
        // référence « soumission auto N » n'est jamais touchée ici) ;
        // « le véhicule deux » → « le véhicule 2 », « le conducteur
        // trois » → « le conducteur 3 » (index véhicule / conducteur) ;
        // « FAQ quarante-trois » → « FAQ 43 », « avenant quarante-trois »
        // → « avenant 43 » (codes FAQ en lettres).
        var refFlotte = (dm[0] === 'soumission' && dm[1] === 'flotte')
          || (dm3[0] === 'soumission' && dm3[1] === 'flotte' && dm3[2] === 'automobile');
        // Cautionnement (étape 9/10 cautionnement) — « à la soumission
        // cautionnement un » → « à la soumission cautionnement 1 » (le mot
        // « cautionnement » est conservé : jamais de conversion vers la
        // référence courte FPQ1 « soumission N », et la référence
        // « soumission cautionnement N » n'est jamais touchée par les
        // règles FPQ1/flotte) ; « l'obligation deux » → « l'obligation 2 »
        // (index d'obligation). Les montants (« limite globale cinq
        // millions » → « 5000000 ») sont couverts par la règle 1.
        var refCaut = (dm[0] === 'soumission' && dm[1] === 'cautionnement');
        var refObligation = dernier === 'obligation' || dernier === "l'obligation";
        var refVehicule = dernier === 'véhicule' || dernier === 'vehicule';
        var refConducteur = dernier === 'conducteur' || dernier === 'conducteurs';
        var refFaq = dernier === 'faq' || dernier === 'avenant' || dernier === "l'avenant";
        // « classe trois » → « classe 3 » (classe de permis SAAQ, chiffre
        // exigé par l'analyseur conducteur flotte).
        var refClasse = dernier === 'classe';
        if (refSoumission || refMesure || refActivite || refDirigeant || refEtablissement || refPE
            || refFlotte || refVehicule || refConducteur || refFaq || refClasse
            || refCaut || refObligation) {
          sortie.push(String(ancre.valeur));
          i += ancre.longueur;
          continue;
        }
        if (estUniteDollars(a1)) saut = 1;
        else if (a1 === 'de' && estUniteDollars(a2)) saut = 2;
        else saut = longueurUniteSuperficie(tokens, i + ancre.longueur);
        if (saut) {
          sortie.push(String(ancre.valeur));
          i += ancre.longueur + saut;
          continue;
        }
        if (MOTS_RUE.indexOf(a1) !== -1) {
          sortie.push(String(ancre.valeur));
          sortie.push(tokens[i + ancre.longueur]);
          i += ancre.longueur + 1;
          continue;
        }
        if (MOTS_CHAMP_NOMBRE.indexOf(motPrecedent(sortie)) !== -1) {
          sortie.push(String(ancre.valeur));
          i += ancre.longueur;
          continue;
        }
      }
      // 1c) Unité redondante après des chiffres déjà émis
      // (« 1500000 dollars » → « 1500000 », « 2000000 de dollars » → « 2000000 »)
      var emis = sortie.length ? sortie[sortie.length - 1] : '';
      if (/^\d+$/.test(emis)) {
        var u1 = (tokens[i] || '').toLowerCase();
        var u2 = (tokens[i + 1] || '').toLowerCase();
        // Flotte : « 150 kilomètres » → « 150 km » (l'analyseur exige
        // « km » ; la forme en lettres est déjà convertie en règle 1b).
        if (/^kilom[èe]tres?$/.test(u1)) {
          sortie.push('km');
          i += 1;
          continue;
        }
        var uniteSeule = 0;
        if (estUniteDollars(u1) || u1 === 'pi2') uniteSeule = 1;
        else if (u1 === 'de' && estUniteDollars(u2)) uniteSeule = 2;
        else uniteSeule = longueurUniteSuperficie(tokens, i);
        if (uniteSeule) { i += uniteSeule; continue; }
      }
      // 2) Années 1900–2100 en lettres (au moins 2 mots pour éviter les faux positifs)
      if (estMotNombre(tokens[i])) {
        var pa = parseNombre(tokens, i);
        if (pa && pa.longueur >= 2 && pa.valeur >= 1900 && pa.valeur <= 2100) {
          sortie.push(String(pa.valeur));
          i += pa.longueur;
          continue;
        }
      }
      // 3) Codes épelés : lettre isolée + chiffres, ou ≥ 4 chiffres épelés
      //    (« T un deux trois » → « T123 »). Les mots-outils d'une lettre
      //    (« a », « à », « y ») ne sont jamais des préfixes de code.
      //    Une lettre après « soumission d » / « soumission e » n'est pas un
      //    code : c'est le produit D&O/E&O dicté en deux mots
      //    (« soumission d o un » → la référence, pas « O1 »).
      var lettre = null, j = i;
      var apresProduit = /^(soumission (d|e))$/i.test(derniersMots(sortie, 2).join(' '));
      if (/^[A-Za-zÀ]$/.test(tokens[j]) && !/^(a|à|y)$/i.test(tokens[j])
          && j + 1 < tokens.length && estChiffreSeul(tokens[j + 1])
          && !apresProduit) {
        lettre = tokens[j].toUpperCase(); j++;
      }
      var chiffres = '';
      while (j < tokens.length && estChiffreSeul(tokens[j])) {
        chiffres += CHIFFRES_SEULS[tokens[j].toLowerCase()];
        j++;
      }
      if (chiffres.length >= 4 || (lettre && chiffres.length >= 1)) {
        sortie.push((lettre || '') + chiffres);
        i = j;
        continue;
      }
      sortie.push(tokens[i]);
      i++;
    }
    return sortie.join(' ').replace(/\s+/g, ' ').trim();
  }

  return { normaliserDictee: normaliserDictee };
});
