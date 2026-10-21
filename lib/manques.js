/**
 * lib/manques.js — Détection des informations manquantes d'une soumission
 * (boucle courriel, étape 1/5).
 *
 * Pour une soumission d'un des 9 produits (objet retourné par le
 * obtenirSoumission de la couche produit), calcule la liste structurée des
 * manques : en-tête incomplet, garanties absentes ou partielles, antécédents
 * absents (questions de confirmation), et champs critiques vides de chaque
 * élément de liste (bâtiment, conducteur, dirigeant, établissement…).
 *
 * Chaque manque porte une PHRASE DE QUESTION en français, prête à poser au
 * client et contextualisée par l'élément visé — c'est cette question qui
 * part dans le courriel de demande d'informations (lib/demandes-infos.js)
 * et dont la clé stable permet de la marquer « répondue » quand le champ
 * correspondant se remplit.
 *
 * Lecture seule : ce module ne modifie rien.
 */

const NOMS_PRODUITS = {
  auto: 'Auto (FPQ1)', biens: 'Biens', rc: 'RC', cyber: 'Cyber', eo: 'E&O',
  do: 'D&O', pe: "Perte d'exploitation", flotte: 'Flotte', cautionnement: 'Cautionnement',
};

function vide(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
    || (Array.isArray(v) && v.length === 0);
}

// --- Libellés d'éléments (contexte des questions) ------------------------------
function libelleElement(type, el) {
  switch (type) {
    case 'batiments': return `le bâtiment situé au ${el.adresse || 'adresse à confirmer'}${el.ville ? ` (${el.ville})` : ''}`;
    case 'exploitations': return `le lieu d'exploitation situé au ${el.adresse || 'adresse à confirmer'}${el.ville ? ` (${el.ville})` : ''}`;
    case 'conducteurs': return `le conducteur ${[el.prenom, el.nom].filter(Boolean).join(' ') || 'sans nom'}`;
    case 'vehicules': return `le véhicule ${[el.annee, el.marque, el.modele].filter(Boolean).join(' ') || el.niv || el.vin || 'sans description'}`;
    case 'dirigeants': return `le dirigeant ${el.nom || 'sans nom'}${el.fonction ? ` (${el.fonction})` : ''}`;
    case 'etablissements': return `l'établissement « ${el.nom_lieu || el.adresse || 'sans nom'} »`;
    case 'obligations': return `le cautionnement ${el.beneficiaire ? `pour ${el.beneficiaire}` : `(${el.type || 'type à préciser'})`}`;
    case 'activites': return `l'activité « ${el.description_activite || el.description || 'sans description'} »`;
    default: return "l'élément";
  }
}

// --- Formulations de questions par champ ---------------------------------------
const QUESTIONS_CHAMPS = {
  type_construction: (ctx) => `Pour ${ctx} : quel est le type de construction (bois, acier, béton, maçonnerie ou mixte) ?`,
  superficie_pi2: (ctx) => `Pour ${ctx} : quelle est la superficie, en pieds carrés ?`,
  superficie: (ctx) => `Pour ${ctx} : quelle est la superficie, en pieds carrés ?`,
  nb_etages: (ctx) => `Pour ${ctx} : combien d'étages compte le bâtiment ?`,
  gicleurs: (ctx) => `Pour ${ctx} : le bâtiment est-il protégé par des gicleurs (sprinklers) ?`,
  chauffage: (ctx) => `Pour ${ctx} : quel est le type de chauffage principal (électrique, gaz, huile, autre) ?`,
  annee_toiture: (ctx) => `Pour ${ctx} : en quelle année la toiture a-t-elle été installée ou refaite ?`,
  distance_caserne_km: (ctx) => `Pour ${ctx} : à quelle distance (en kilomètres) se trouve la caserne de pompiers la plus proche ?`,
  chiffre_affaires: (ctx) => `Pour ${ctx} : quel est le chiffre d'affaires annuel ?`,
  masse_salariale: (ctx) => `Pour ${ctx} : quelle est la masse salariale annuelle ?`,
  nb_employes: (ctx) => `Pour ${ctx} : combien d'employés y travaillent ?`,
  nb_professionnels: (ctx) => `Pour ${ctx} : combien de professionnels exercent cette activité ?`,
  description_activites: (ctx) => `Pour ${ctx} : pouvez-vous décrire les activités qui s'y déroulent ?`,
  fonction: (ctx) => `Pour ${ctx} : quelle est sa fonction ou son titre exact dans l'entreprise ?`,
  annees_experience: (ctx) => `Pour ${ctx} : combien d'années d'expérience possède-t-il ?`,
  antecedents_personnels: (ctx) => `Pour ${ctx} : a-t-il des antécédents personnels pertinents à déclarer (faillite, casier judiciaire, réclamations antérieures) ? Si oui, précisez ; sinon, confirmez « aucun ».`,
  base_valeur: (ctx) => `Pour ${ctx} : la valeur doit-elle être établie au coût de remplacement ou à la valeur dépréciée ?`,
  annee_construction: (ctx) => `Pour ${ctx} : en quelle année a-t-il été construit ?`,
  date_naissance: (ctx) => `Pour ${ctx} : quelle est sa date de naissance ?`,
  numero_permis: (ctx) => `Pour ${ctx} : quel est son numéro de permis de conduire ?`,
  classe_permis: (ctx) => `Pour ${ctx} : quelle est la classe de son permis de conduire ?`,
  date_obtention_permis: (ctx) => `Pour ${ctx} : en quelle année a-t-il obtenu son premier permis de conduire ?`,
  annees_experience_ca: (ctx) => `Pour ${ctx} : combien d'années d'expérience de conduite a-t-il au Canada ?`,
  date_embauche: (ctx) => `Pour ${ctx} : quelle est sa date d'embauche ?`,
  valeur: (ctx) => `Pour ${ctx} : quelle est sa valeur actuelle ?`,
  valeur_estimee: (ctx) => `Pour ${ctx} : quelle est sa valeur estimée ?`,
  usage: (ctx) => `Pour ${ctx} : quel est son usage principal ?`,
  km_annuel: (ctx) => `Pour ${ctx} : combien de kilomètres parcourt-il par année ?`,
  vin: (ctx) => `Pour ${ctx} : quel est son numéro d'identification (NIV) ?`,
  beneficiaire: (ctx) => `Pour ${ctx} : qui est le bénéficiaire (donneur d'ouvrage) ?`,
  description_projet: (ctx) => `Pour ${ctx} : pouvez-vous décrire le projet visé ?`,
  montant_contrat: (ctx) => `Pour ${ctx} : quel est le montant du contrat ?`,
  montant_cautionnement: (ctx) => `Pour ${ctx} : quel est le montant du cautionnement demandé ?`,
};

const LIBELLES_CHAMPS = {
  type_construction: 'Type de construction', superficie_pi2: 'Superficie (pi²)', superficie: 'Superficie',
  nb_etages: "Nombre d'étages", gicleurs: 'Gicleurs', chauffage: 'Chauffage',
  annee_toiture: 'Année de la toiture', distance_caserne_km: 'Distance de la caserne',
  chiffre_affaires: "Chiffre d'affaires", masse_salariale: 'Masse salariale',
  nb_employes: "Nombre d'employés", nb_professionnels: 'Nombre de professionnels',
  description_activites: 'Description des activités', fonction: 'Fonction / titre',
  annees_experience: "Années d'expérience", antecedents_personnels: 'Antécédents personnels',
  base_valeur: 'Base de valeur', annee_construction: 'Année de construction',
  date_naissance: 'Date de naissance', numero_permis: 'Numéro de permis',
  classe_permis: 'Classe de permis', date_obtention_permis: "Date d'obtention du permis",
  annees_experience_ca: "Années d'expérience (Canada)", date_embauche: "Date d'embauche",
  valeur: 'Valeur', valeur_estimee: 'Valeur estimée', usage: 'Usage', km_annuel: 'Kilométrage annuel',
  vin: 'NIV', beneficiaire: 'Bénéficiaire', description_projet: 'Description du projet',
  montant_contrat: 'Montant du contrat', montant_cautionnement: 'Montant du cautionnement',
  // Soumission combinée (étape 10/10).
  classe_construction: 'Classe de construction (assureur)', voisinage: 'Voisinage',
  interet_assure: "Intérêt de l'assuré dans l'emplacement", forme_juridique: 'Forme juridique',
  annee_fondation: 'Année de fondation', code_industrie: "Code d'industrie",
  liaison_pe: "Lien avec la perte d'exploitation", liaison_rc: 'Lien avec la responsabilité civile',
};

function questionPourChamp(ctx, champ) {
  const f = QUESTIONS_CHAMPS[champ];
  if (f) return f(ctx);
  return `Pour ${ctx} : pouvez-vous nous indiquer ${LIBELLES_CHAMPS[champ] || champ} ?`;
}

// --- Construction des manques ----------------------------------------------------
function calculerManques(produit, s) {
  const manques = [];
  if (!s) return manques;
  const ajouter = (m) => manques.push({ produit, ...m });

  // En-tête : date d'effet souhaitée (présente sur tous les produits).
  if (vide(s.date_effet_souhaitee)) {
    ajouter({
      cle: 'entete:date_effet_souhaitee', niveau: 'entete', element: null,
      champ: 'date_effet_souhaitee', libelle: "Date d'effet souhaitée",
      question: "À partir de quelle date souhaitez-vous que la nouvelle couverture entre en vigueur ?",
    });
  }

  const garantiesSoumission = (question) => ajouter({
    cle: 'garanties:absentes', niveau: 'garanties', element: null,
    champ: 'garanties', libelle: 'Garanties', question,
  });
  const garantiesPartielles = (champ, libelle, question) => ajouter({
    cle: `garanties:${champ}`, niveau: 'garanties', element: null, champ, libelle, question,
  });

  // Champs critiques d'une liste d'éléments.
  const champsElements = (type, elements, champs) => {
    for (const el of elements || []) {
      const ctx = libelleElement(type, el);
      const element = { type, id: el.id, libelle: ctx };
      for (const champ of champs) {
        const v = el[champ];
        const manquant = champ === 'gicleurs' ? (v === null || v === undefined || Number(v) === 0) : vide(v);
        if (manquant) {
          ajouter({
            cle: `liste:${type}:${el.id}:${champ}`, niveau: 'liste', element,
            champ, libelle: LIBELLES_CHAMPS[champ] || champ,
            question: questionPourChamp(ctx, champ),
          });
        }
      }
    }
  };
  const garantiesElement = (type, el, question) => ajouter({
    cle: `garanties:${type}:${el.id}`, niveau: 'garanties',
    element: { type, id: el.id, libelle: libelleElement(type, el) },
    champ: 'garanties', libelle: 'Garanties', question,
  });

  switch (produit) {
    case 'biens': {
      for (const b of s.batiments || []) {
        champsElements('batiments', [b],
          ['type_construction', 'superficie_pi2', 'nb_etages', 'gicleurs', 'chauffage', 'annee_toiture', 'distance_caserne_km']);
        if (!(b.contenus && b.contenus.length) && !(s.contenus_generaux && s.contenus_generaux.length)) {
          ajouter({
            cle: `liste:batiments:${b.id}:contenus`, niveau: 'liste',
            element: { type: 'batiments', id: b.id, libelle: libelleElement('batiments', b) },
            champ: 'contenus', libelle: 'Contenus',
            question: `Pour ${libelleElement('batiments', b)} : pouvez-vous nous fournir la liste des contenus à assurer (équipements, stock, mobilier, améliorations) avec leurs valeurs approximatives ? Un tableau Excel ou une liste dans votre réponse suffit.`,
          });
        }
        if (!b.garanties) {
          garantiesElement('batiments', b,
            `Pour ${libelleElement('batiments', b)} : quel montant d'assurance souhaitez-vous pour le bâtiment, et selon quelle formule (tous risques ou risques désignés) ?`);
        }
      }
      break;
    }
    case 'rc': {
      for (const e of s.exploitations || []) {
        champsElements('exploitations', [e],
          ['chiffre_affaires', 'masse_salariale', 'nb_employes', 'description_activites']);
        if (!e.garanties) {
          garantiesElement('exploitations', e,
            `Pour ${libelleElement('exploitations', e)} : quelle limite de responsabilité civile souhaitez-vous (par sinistre et en agrégat) ?`);
        }
      }
      break;
    }
    case 'cyber': {
      if (!s.garanties) {
        garantiesSoumission("Quelles limites de garantie cyber souhaitez-vous (par sinistre et en agrégat), et quelle franchise pouvez-vous assumer ?");
      } else if (vide(s.garanties.delai_carence)) {
        garantiesPartielles('delai_carence', 'Délai de carence',
          "Quel délai de carence (période d'attente avant indemnisation en cas d'interruption) vous convient ?");
      }
      const typesPresents = new Set((s.mesures || []).map((m) => m.type_mesure));
      const CLES_MESURES = {
        mfa: ["l'authentification multifacteur (MFA)", 'Utilisez-vous l\u2019authentification multifacteur (MFA) pour les courriels, le VPN et les applications infonuagiques ?'],
        sauvegardes: ['les sauvegardes', 'Effectuez-vous des sauvegardes régulières de vos données ? À quelle fréquence, où sont-elles conservées (hors ligne ou infonuagique), et les avez-vous déjà testées en restauration ?'],
        antivirus_edr: ["l'antivirus / EDR", 'Vos postes et serveurs sont-ils protégés par un antivirus ou un EDR ? Lequel, et sur combien d\u2019appareils ?'],
      };
      for (const [typeMesure, [lib, question]] of Object.entries(CLES_MESURES)) {
        if (!typesPresents.has(typeMesure)) {
          ajouter({
            cle: `liste:mesures:absente:${typeMesure}`, niveau: 'liste', element: null,
            champ: 'type_mesure', libelle: `Mesure — ${lib}`, question,
          });
        }
      }
      break;
    }
    case 'eo': {
      if (!s.garanties) garantiesSoumission("Quelles limites de garantie erreurs et omissions souhaitez-vous (par réclamation et en agrégat), et quelle franchise pouvez-vous assumer ?");
      else if (vide(s.garanties.base)) garantiesPartielles('base', 'Base de couverture',
        "La garantie doit-elle être sur base de réclamations présentées (claims-made) ou d'occurrences ?");
      champsElements('activites', s.activites, ['chiffre_affaires', 'nb_professionnels']);
      break;
    }
    case 'do': {
      if (!s.garanties) garantiesSoumission("Quelles limites de garantie administrateurs et dirigeants souhaitez-vous (par réclamation et en agrégat), et quelle franchise pouvez-vous assumer ?");
      else if (vide(s.garanties.base)) garantiesPartielles('base', 'Base de couverture',
        "La garantie doit-elle être sur base de réclamations présentées (claims-made) ou d'occurrences ?");
      champsElements('dirigeants', s.dirigeants, ['fonction', 'annees_experience', 'antecedents_personnels']);
      break;
    }
    case 'pe': {
      if (!s.garanties) garantiesSoumission("Quelle limite d'indemnité souhaitez-vous pour la perte d'exploitation, et sur quelle période (12, 18 ou 24 mois) ?");
      else {
        if (vide(s.garanties.periode_indemnite_mois)) garantiesPartielles('periode_indemnite_mois', "Période d'indemnité",
          "Sur quelle période d'indemnité la couverture doit-elle porter (12, 18 ou 24 mois) ?");
        if (vide(s.garanties.base_montant)) garantiesPartielles('base_montant', "Base d'indemnité",
          "Le montant doit-il être calculé sur le bénéfice brut, la marge brute ou le chiffre d'affaires ?");
      }
      champsElements('etablissements', s.etablissements, ['base_valeur', 'chiffre_affaires', 'superficie', 'annee_construction']);
      break;
    }
    case 'flotte': {
      if (!s.garanties) garantiesSoumission("Quelle limite de responsabilité civile souhaitez-vous pour la flotte, et quelles franchises (collision, versement) pouvez-vous assumer ?");
      else if (vide(s.garanties.limite_rc)) garantiesPartielles('limite_rc', 'Limite de responsabilité civile',
        'Quelle limite de responsabilité civile souhaitez-vous pour la flotte ?');
      champsElements('vehicules', s.vehicules, ['valeur', 'usage']);
      champsElements('conducteurs', s.conducteurs,
        ['date_naissance', 'numero_permis', 'classe_permis', 'annees_experience', 'date_embauche']);
      break;
    }
    case 'auto': {
      for (const v of s.vehicules || []) {
        champsElements('vehicules', [v], ['vin', 'valeur_estimee', 'usage', 'km_annuel']);
        if (!v.garanties) {
          garantiesElement('vehicules', v,
            `Pour ${libelleElement('vehicules', v)} : quelles protections et franchises souhaitez-vous (chapitre A obligatoire, chapitre B, avenants) ?`);
        }
      }
      champsElements('conducteurs', s.conducteurs,
        ['date_naissance', 'numero_permis', 'date_obtention_permis', 'annees_experience_ca']);
      break;
    }
    case 'cautionnement': {
      if (!s.garanties) {
        ajouter({
          cle: 'garanties:absentes', niveau: 'garanties', element: null, champ: 'garanties', libelle: 'Ligne de cautionnement',
          question: "Quelle limite globale de cautionnement souhaitez-vous, et quelle limite par projet ?",
        });
      } else {
        if (vide(s.garanties.fonds_roulement)) garantiesPartielles('fonds_roulement', 'Fonds de roulement',
          "Pouvez-vous nous transmettre vos états financiers récents (le fonds de roulement y figure) ? La caution les exige pour établir votre ligne.");
        if (vide(s.garanties.valeur_nette)) garantiesPartielles('valeur_nette', 'Valeur nette',
          "Quelle est la valeur nette de l'entreprise selon vos derniers états financiers ?");
      }
      champsElements('obligations', s.obligations,
        ['beneficiaire', 'description_projet', 'montant_contrat', 'montant_cautionnement']);
      break;
    }
    default:
      break;
  }

  // --- Antécédents : bloc absent = questions de confirmation -------------------
  const QUESTIONS_ANTECEDENTS = {
    auto: "Pouvez-vous nous confirmer les sinistres automobiles des 6 dernières années (dates, descriptions, montants), ainsi que toute résiliation, tout non-paiement ou refus d'un assureur dans le passé ?",
    biens: "Pouvez-vous nous confirmer les sinistres des 5 dernières années touchant vos bâtiments (dates, causes, montants), même ceux sans réclamation ?",
    rc: "Pouvez-vous nous confirmer les réclamations en responsabilité civile des 5 dernières années (dates, descriptions, montants) ?",
    cyber: "Avez-vous subi un incident de cybersécurité dans les 5 dernières années (rançongiciel, intrusion, fuite de données) ? Si oui, précisez la date, la nature et les mesures prises depuis ; sinon, confirmez « aucun ».",
    eo: "Pouvez-vous nous confirmer les réclamations erreurs et omissions des 5 dernières années (dates, descriptions, montants) ?",
    do: "Pouvez-vous nous confirmer les réclamations contre les administrateurs et dirigeants des 5 dernières années (dates, descriptions, montants) ?",
    pe: "Pouvez-vous nous confirmer les interruptions d'exploitation des 5 dernières années (dates, causes, durées, montants), même celles sans réclamation ?",
    flotte: "Pouvez-vous confirmer les sinistres des 5 dernières années et les infractions des 3 dernières années pour chaque conducteur ?",
    cautionnement: "Pouvez-vous nous confirmer les réclamations contre un cautionnement des 5 dernières années, ainsi que tout refus ou résiliation de cautionnement dans le passé ?",
  };
  if (!s.antecedents) {
    ajouter({
      cle: 'antecedents:absents', niveau: 'antecedents', element: null,
      champ: 'antecedents', libelle: 'Antécédents',
      question: QUESTIONS_ANTECEDENTS[produit] || 'Pouvez-vous nous confirmer vos antécédents des 5 dernières années ?',
    });
    if (produit === 'biens' || produit === 'rc' || produit === 'cyber') {
      ajouter({
        cle: 'antecedents:assureur_actuel', niveau: 'antecedents', element: null,
        champ: 'assureur_actuel', libelle: 'Assureur actuel',
        question: "Quel est votre assureur actuel, le numéro de votre police actuelle et sa date d'échéance ?",
      });
    }
  } else {
    if (produit === 'eo' && vide(s.antecedents.circonstances)) {
      ajouter({
        cle: 'antecedents:circonstances', niveau: 'antecedents', element: null,
        champ: 'circonstances', libelle: 'Circonstances connues',
        question: "Avez-vous connaissance de circonstances pouvant donner lieu à une réclamation (plainte d'un client, erreur soupçonnée, litige naissant) ? C'est une question déterminante pour une police sur base de réclamations présentées : précisez, ou confirmez « aucune ».",
      });
    }
    if (produit === 'do' && vide(s.antecedents.poursuites_en_cours)) {
      ajouter({
        cle: 'antecedents:poursuites', niveau: 'antecedents', element: null,
        champ: 'poursuites_en_cours', libelle: 'Poursuites en cours',
        question: "Y a-t-il des poursuites ou des actions en justice en cours ou envisagées contre l'entreprise ou ses dirigeants ? Précisez, ou confirmez « aucune ».",
      });
    }
  }

  return manques;
}

// --- Manques critiques d'un dossier combiné (étape 10/10) ------------------------
// Agrège les manques des 3 volets (calculerManques par produit) et ajoute
// les contrôles propres à la combinée : profil entreprise, fiche emplacement
// enrichie (classe de construction, voisinage, intérêt) et liaisons
// emplacement ↔ PE / RC. `dossier` = combine.obtenirDossier().
function calculerManquesCombinee(dossier) {
  if (!dossier) return [];
  const manques = [];
  const s = dossier.soumissions || {};
  if (s.biens) manques.push(...calculerManques('biens', s.biens));
  if (s.rc) manques.push(...calculerManques('rc', s.rc));
  if (s.perte_exploitation) manques.push(...calculerManques('pe', s.perte_exploitation));

  const ajouter = (m) => manques.push({ produit: 'combinee', ...m });
  const client = dossier.client || {};
  for (const [champ, question] of [
    ['forme_juridique', "Quelle est la forme juridique de l'entreprise (société par actions, propriétaire unique, fiducie…) ?"],
    ['annee_fondation', "En quelle année l'entreprise a-t-elle été fondée ?"],
    ['description_activites', "Pouvez-vous décrire les activités de l'entreprise (produits, services, clientèle) ?"],
    ['code_industrie', "Quel est le code d'industrie de l'entreprise (code de classification de vos activités) ?"],
  ]) {
    if (vide(client[champ])) {
      ajouter({
        cle: `combinee:client:${champ}`, niveau: 'client', element: null, champ,
        libelle: LIBELLES_CHAMPS[champ] || champ, question,
      });
    }
  }
  if (vide(dossier.date_effet)) {
    ajouter({
      cle: 'combinee:dossier:date_effet', niveau: 'entete', element: null,
      champ: 'date_effet', libelle: "Date d'effet du dossier combiné",
      question: "À partir de quelle date la couverture combinée doit-elle entrer en vigueur ?",
    });
  }

  const peParBatiment = {};
  if (s.perte_exploitation) {
    for (const e of s.perte_exploitation.etablissements || []) {
      if (e.batiment_id) peParBatiment[e.batiment_id] = e;
    }
  }
  const rcParBatiment = {};
  if (s.rc) {
    for (const e of s.rc.exploitations || []) {
      if (e.batiment_id) rcParBatiment[e.batiment_id] = e;
    }
  }
  for (const b of (s.biens && s.biens.batiments) || []) {
    if (b.archive) continue;
    const ctx = libelleElement('batiments', b);
    const element = { type: 'batiments', id: b.id, libelle: ctx };
    if (vide(b.classe_construction)) {
      ajouter({
        cle: `combinee:batiments:${b.id}:classe_construction`, niveau: 'liste', element,
        champ: 'classe_construction', libelle: LIBELLES_CHAMPS.classe_construction,
        question: `Pour ${ctx} : quelle est la classe de construction de l'immeuble selon les classes des assureurs (bois, maçonnerie avec solives, incombustible, maçonnerie incombustible, résistant au feu) ?`,
      });
    }
    const voisinageVide = !b.aucun_risque_alentours
      && vide(b.voisin_gauche_affectation) && vide(b.voisin_droite_affectation)
      && vide(b.voisin_arriere_affectation) && vide(b.voisin_enface_affectation);
    if (voisinageVide) {
      ajouter({
        cle: `combinee:batiments:${b.id}:voisinage`, niveau: 'liste', element,
        champ: 'voisinage', libelle: LIBELLES_CHAMPS.voisinage,
        question: `Pour ${ctx} : pouvez-vous décrire le voisinage immédiat (à gauche, à droite, à l'arrière et en face : affectation et distance approximative), ou confirmer qu'il n'y a aucun risque alentours ?`,
      });
    }
    if (vide(b.interet_assure)) {
      ajouter({
        cle: `combinee:batiments:${b.id}:interet_assure`, niveau: 'liste', element,
        champ: 'interet_assure', libelle: LIBELLES_CHAMPS.interet_assure,
        question: `Pour ${ctx} : quel est l'intérêt de l'assuré dans cet emplacement (propriétaire occupant, locataire, propriétaire non occupant…) ?`,
      });
    }
    if (s.perte_exploitation && !peParBatiment[b.id]) {
      ajouter({
        cle: `combinee:batiments:${b.id}:liaison_pe`, niveau: 'liste', element,
        champ: 'liaison_pe', libelle: LIBELLES_CHAMPS.liaison_pe,
        question: `Pour ${ctx} : quel montant de perte d'exploitation s'applique à cet emplacement ? (À compléter dans le dossier combiné, section Emplacements.)`,
      });
    }
    if (s.rc && !rcParBatiment[b.id]) {
      ajouter({
        cle: `combinee:batiments:${b.id}:liaison_rc`, niveau: 'liste', element,
        champ: 'liaison_rc', libelle: LIBELLES_CHAMPS.liaison_rc,
        question: `Pour ${ctx} : les activités de cet emplacement sont-elles couvertes par le volet responsabilité civile du dossier ? (À lier dans le dossier combiné, section Emplacements.)`,
      });
    }
  }
  return manques;
}

module.exports = { calculerManques, calculerManquesCombinee, libelleElement, NOMS_PRODUITS, LIBELLES_CHAMPS };
