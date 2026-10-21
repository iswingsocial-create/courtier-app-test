/**
 * lib/combine.js — Soumission combinée entreprise (Biens + Contenu + RC +
 * Perte d'exploitation), d'après REFERENCE-SOUMISSION-COMBINEE.md.
 *
 * Principe : un dossier qui LIE, pas une fusion. Les tables produits
 * (biens_*, rc_*, pe_*) restent la source de vérité ; ce module porte les
 * référentiels partagés (listes de choix), la fiche emplacement enrichie
 * (bloc alarme, flottante, bénéficiaires), les questions sectorielles,
 * le dossier combiné lui-même et la synchronisation des antécédents.
 *
 * Conventions : requêtes paramétrées, filtre cabinet_id partout,
 * archivage au lieu de suppressions (règle d'or), journal d'audit.
 */
const bd = require('./bd');

// --- JSON ---------------------------------------------------------------
function jsonIn(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
function jsonOut(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// --- Audit --------------------------------------------------------------
function auditer(cabinetId, userId, action, details) {
  bd.prepare('INSERT INTO journal_audit (cabinet_id, user_id, action, details) VALUES (?, ?, ?, ?)')
    .run(cabinetId || null, userId || null, action, details || null);
}

// --- Référentiels (listes des envois réels et des formulaires assureurs) ------
const FORMES_JURIDIQUES = [
  ['societe_actions', 'Société par actions'],
  ['proprietaire_unique', 'Propriétaire unique'],
  ['srl', 'Société à responsabilité limitée'],
  ['fiducie', 'Fiducie'],
  ['snc', 'Société en nom collectif'],
  ['coentreprise', 'Coentreprise'],
  ['association', 'Association'],
  ['autre', 'Autre'],
];

const LIBELLES_FORME_JURIDIQUE = Object.fromEntries(FORMES_JURIDIQUES);

function libelleFormeJuridique(code) {
  return LIBELLES_FORME_JURIDIQUE[code] || code || '';
}

// Répartition des recettes par type d'activité (%) — en-tête des envois réels.
const CLES_REPARTITION_TYPES = ['detail', 'gros', 'reparation', 'fabrication',
  'estimation', 'affinage', 'achat_or', 'autre'];
const LIBELLES_REPARTITION_TYPES = {
  detail: 'Détail', gros: 'Gros', reparation: 'Réparation', fabrication: 'Fabrication',
  estimation: 'Estimation', affinage: 'Affinage', achat_or: "Achat d'or", autre: 'Autre',
};

// Répartition géographique des recettes (%) — bloc RC des envois réels.
const CLES_REPARTITION_GEO = ['canada', 'etats_unis', 'etranger', 'internet'];
const LIBELLES_REPARTITION_GEO = {
  canada: 'Canada', etats_unis: 'États-Unis', etranger: 'Étranger', internet: 'Internet',
};

// Classes de construction des assureurs (résistance au feu) — fiche
// emplacement des envois réels ; `biens_batiments.type_construction`
// (taxonomie historique de l'app) reste inchangé, cette classe s'y ajoute.
const CLASSES_CONSTRUCTION = [
  ['bois', 'Bois (Frame)'],
  ['maconnerie_solives', 'Maçonnerie avec solives'],
  ['incombustible', 'Incombustible'],
  ['maconnerie_incombustible', 'Maçonnerie incombustible'],
  ['resistant_feu_modifie', 'Résistant au feu modifié'],
  ['resistant_feu', 'Résistant au feu'],
];

const TYPES_EMPLACEMENT = [
  'Condominium commercial', 'Indépendant', 'Centre-ville (hors centre commercial)',
  'Kiosque', 'Centre commercial fermé', 'Galerie marchande', 'Domicile', 'Autre',
];

const TYPES_BATIMENT = [
  'Commercial', 'Détaché', 'Habitation', 'Copropriété résidentielle (sans commerces)',
  'Industriel', 'Entrepôt', 'Mixte', 'Autre',
];

const INTERETS_ASSURE = [
  'Propriétaire de l\u2019immeuble', 'Locataire', 'Propriétaire et locataire',
  'Créancier hypothécaire', 'Autre',
];

const AMPLEURS_RENOVATION = ['Complète', 'Partielle'];

const DISTANCES_PRISE_EAU = [
  'À moins de 150 mètres', 'À moins de 300 mètres', 'À moins de 500 mètres',
  'Plus de 500 mètres', 'Aucune prise d\u2019eau',
];

const TYPES_ALARME_INCENDIE = [
  'Aucune', 'Alarme locale', 'Poste de surveillance (service complet)',
  'Alarme reliée à une centrale', 'Alarme reliée à la caserne',
];

const TYPES_ALARME_VOL = [
  'Aucune', 'Alarme locale', 'Poste de surveillance (service complet)',
  'Alarme reliée à une centrale',
];

const COUVERTURES_GICLEURS = ['non', 'partiel', 'entier'];
const LIBELLES_COUVERTURE_GICLEURS = {
  non: 'Non giclé', partiel: 'Partiellement giclé', entier: 'Entièrement giclé',
};

// --- En-tête d'envoi du cabinet ------------------------------------------------
const COLS_ENTETE_CABINET = ['adresse', 'ville', 'code_postal', 'telephone',
  'telecopieur', 'site_web', 'courriel'];

function majEnteteCabinet(cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const col of COLS_ENTETE_CABINET) {
    if (data[col] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(data[col] === '' ? null : data[col]);
  }
  if (!sets.length) return false;
  params.push(cabinetId);
  const r = bd.prepare(`UPDATE cabinets SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'cabinet_entete_maj',
      `En-tête d'envoi du cabinet #${cabinetId} mis à jour`);
  }
  return r.changes > 0;
}

// --- Bloc alarme (étape 3/10) ---------------------------------------------------
// Listes du questionnaire technique des assureurs (transmissions, détection,
// coffres, répondants, protections physiques).
const TRANSMISSIONS = [
  'Cellulaire', 'Canal local dérivé (Pulsenet)', 'Communicateur numérique DACT/POTS',
  'GSM/GPRS/CDMA', 'Internet (IP)', 'Radio unidirectionnelle',
  'Radio bidirectionnelle', 'Autre',
];
const COUVERTURES_DETECTION = [
  'Tout le local', 'Coffres / chambre forte', 'Panneau de contrôle',
  'Dessus du plafond suspendu', 'Zones de stock hors coffre',
];
const PROTECTIONS_COFFRES = [
  'Contact de porte', 'Détecteur de vibration (EVD)', 'Capacitif / proximité',
  'Sismique', 'Autre',
];
const REPONDANTS_ALARME = ['Abonné', 'Service de garde', 'Police'];
const PROTECTIONS_PHYSIQUES = [
  'Serrures à pêne dormant à double cylindre', 'Double surveillance d\u2019alarme',
  'Garde armé de jour', 'Alarme anti-hold-up', 'Barres aux fenêtres',
  'Étiquettes RFID / suivi électronique', 'Pellicule ou vitrage antieffraction',
  'Bornes anticollision', 'Sas de sécurité', 'Rideaux ou portes d\u2019acier',
  'Sonnette de porte verrouillée', 'Bâtiment sécurisé', 'Pêne dormant',
  'Fenêtres grillagées / armature métallique', 'Glaces incassables', 'Autre',
];
const SIGNAUX_OUVERTURE_FERMETURE = [
  ['surveilles', 'Surveillés'], ['supervises', 'Supervisés'], ['aucun', 'Aucun'],
];

const COLS_ALARME_TEXTE = ['compagnie_alarme', 'compagnie_telephone', 'compagnie_courriel',
  'compagnie_contact', 'transmission_primaire_fabricant', 'transmission_primaire_modele',
  'transmission_secondaire_fabricant', 'transmission_secondaire_modele', 'taux_interrogation',
  'centrale_nom_lieu', 'dispositifs_perimetre', 'signaux_ouverture_fermeture',
  'certificat_ulc_numero', 'certificat_ulc_expiration'];
const COLS_ALARME_JSON = ['transmission_primaire', 'transmission_secondaire',
  'couverture_detection', 'protection_coffres', 'repondants', 'cameras_detail',
  'protections_physiques', 'coffre_detail'];
const COLS_ALARME_BOOL = ['securite_ligne', 'reponse_en_personne',
  'contrat_entretien_annuel', 'certificat_ulc_actif'];

function deserialiserAlarme(a) {
  if (!a) return null;
  for (const c of COLS_ALARME_JSON) a[c] = jsonOut(a[c]);
  return a;
}

function obtenirAlarme(batimentId, cabinetId) {
  const a = bd.prepare(`
    SELECT * FROM biens_protections_alarme
    WHERE batiment_id = ? AND cabinet_id = ? AND archive = 0
  `).get(batimentId, cabinetId);
  return deserialiserAlarme(a || null);
}

function definirAlarme(batimentId, cabinetId, userId, data) {
  const b = bd.prepare('SELECT id, soumission_id FROM biens_batiments WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(batimentId, cabinetId);
  if (!b) throw new Error('Bâtiment introuvable');
  const vals = {};
  for (const c of COLS_ALARME_TEXTE) vals[c] = data[c] ?? null;
  for (const c of COLS_ALARME_JSON) vals[c] = jsonIn(data[c]);
  for (const c of COLS_ALARME_BOOL) vals[c] = data[c] ? 1 : 0;
  const cols = Object.keys(vals);
  const exist = bd.prepare('SELECT id FROM biens_protections_alarme WHERE batiment_id = ? AND cabinet_id = ?')
    .get(batimentId, cabinetId);
  let id;
  if (exist) {
    bd.prepare(`
      UPDATE biens_protections_alarme SET ${cols.map((c) => `${c} = ?`).join(', ')}, archive = 0 WHERE id = ?
    `).run(...cols.map((c) => vals[c]), exist.id);
    id = exist.id;
    auditer(cabinetId, userId, 'alarme_modifiee', `Questionnaire alarme du bâtiment #${batimentId} modifié`);
  } else {
    const r = bd.prepare(`
      INSERT INTO biens_protections_alarme (cabinet_id, batiment_id, ${cols.join(', ')})
      VALUES (?, ?, ${cols.map(() => '?').join(', ')})
    `).run(cabinetId, batimentId, ...cols.map((c) => vals[c]));
    id = r.lastInsertRowid;
    auditer(cabinetId, userId, 'alarme_definie', `Questionnaire alarme défini pour le bâtiment #${batimentId}`);
  }
  return id;
}

// --- Garanties structurées (étape 4/10) -----------------------------------------
// Avenants biens au format enrichi : la valeur d'une clé peut être 1 (format
// historique : présent, sans détail) ou un objet {present, franchise,
// montant, ...} portant la franchise et le montant propres à l'avenant,
// comme les lignes du tableau des garanties des envois réels.
const AVENANTS_BIENS_ENRICHIS = [
  ['valeur_neuf', 'Valeur à neuf'],
  ['tremblement_terre', 'Tremblement de terre'],
  ['inondation', 'Inondation'],
  ['refoulement_egout', 'Refoulement d\u2019égout'],
  ['frais_communautaires', 'Frais communautaires (copropriété)'],
  ['extension_hors_lieux', 'Biens temporairement hors des lieux assurés'],
  ['pointe_saisonniere', 'Stock — pointe saisonnière'],
  ['argent_valeurs', 'Argent et valeurs'],
  ['transit_tiers', 'Biens en transit et chez des tiers'],
  ['bris_equipement', 'Bris d\u2019équipement'],
  ['bris_machines', 'Bris de machines (historique)'],
  ['perte_exploitation_liee', 'Perte d\u2019exploitation liée'],
];
const CODES_AVENANTS_BIENS = AVENANTS_BIENS_ENRICHIS.map(([c]) => c);
// Champs supplémentaires reconnus par avenant, en plus de franchise/montant.
const CHAMPS_AVENANT_SUPPL = {
  tremblement_terre: ['franchise_pct', 'franchise_min'],
  pointe_saisonniere: ['date_debut', 'date_fin'],
  argent_valeurs: ['montant_hors_lieux'],
  bris_equipement: ['montant_par_accident', 'limitations'],
};

function avenantActif(v) {
  return v === 1 || v === true || (v != null && typeof v === 'object' && !!v.present);
}

// Ne conserve que les avenants actifs et leurs champs reconnus.
function normaliserAvenantsBiens(entree) {
  const sortie = {};
  if (!entree || typeof entree !== 'object') return sortie;
  for (const code of CODES_AVENANTS_BIENS) {
    const v = entree[code];
    if (!avenantActif(v)) continue;
    if (v === 1 || v === true) { sortie[code] = 1; continue; }
    const o = { present: 1 };
    for (const champ of ['franchise', 'montant', ...(CHAMPS_AVENANT_SUPPL[code] || [])]) {
      if (v[champ] !== undefined && v[champ] !== null && v[champ] !== '') o[champ] = v[champ];
    }
    sortie[code] = o;
  }
  return sortie;
}

// --- Assurance flottante des outils (étape 4/10) ----------------------------------
const COLS_FLOTTANTE = ['description', 'base_reglement', 'assure_additionnel', 'montant'];

function ajouterArticleFlottante(soumissionId, cabinetId, userId, data, batimentId = null) {
  const s = bd.prepare('SELECT id FROM biens_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission biens introuvable');
  if (!data.description) throw new Error('Description de l\u2019article requise');
  const r = bd.prepare(`
    INSERT INTO biens_flottante_articles (cabinet_id, soumission_id, batiment_id, ${COLS_FLOTTANTE.join(', ')})
    VALUES (?, ?, ?, ${COLS_FLOTTANTE.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, batimentId, ...COLS_FLOTTANTE.map((c) => data[c] ?? null));
  auditer(cabinetId, userId, 'flottante_article_ajoute',
    `Article flottante « ${data.description} » (soumission biens #${soumissionId})`);
  return r.lastInsertRowid;
}

function modifierArticleFlottante(id, cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const c of COLS_FLOTTANTE) {
    if (data[c] === undefined) continue;
    sets.push(`${c} = ?`);
    params.push(data[c]);
  }
  if (!sets.length) return false;
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE biens_flottante_articles SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) auditer(cabinetId, userId, 'flottante_article_modifie', `Article flottante #${id} modifié`);
  return r.changes > 0;
}

function archiverArticleFlottante(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE biens_flottante_articles SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'flottante_article_archive', `Article flottante #${id} archivé`);
  return r.changes > 0;
}

function listerArticlesFlottante(soumissionId, cabinetId, { inclureArchives = false } = {}) {
  return bd.prepare(`
    SELECT * FROM biens_flottante_articles
    WHERE soumission_id = ? AND cabinet_id = ? ${inclureArchives ? '' : 'AND archive = 0'}
    ORDER BY id
  `).all(soumissionId, cabinetId);
}

// --- Questions sectorielles (étape 6/10) -----------------------------------------
// Jeux de « questions additionnelles » observés dans les envois réels,
// choisis par secteur d'activité. Réponses libres structurées
// question/réponse, rattachées au CLIENT (donc partagées par ses dossiers).
const QUESTIONS_SECTORIELLES = [
  // Copropriété (syndicat de copropriétaires)
  { code: 'copro_coproprietaires_nb', secteur: 'copropriete', question: 'Nombre de copropriétaires' },
  { code: 'copro_fiducie', secteur: 'copropriete', question: 'Fiducie' },
  { code: 'copro_carnet_entretien', secteur: 'copropriete', question: 'Carnet d\u2019entretien' },
  { code: 'copro_etude_fonds_prevoyance', secteur: 'copropriete', question: 'Étude du fonds de prévoyance' },
  { code: 'copro_fonds_prevoyance', secteur: 'copropriete', question: 'Fonds de prévoyance' },
  { code: 'copro_autogestion', secteur: 'copropriete', question: 'Autogestion' },
  { code: 'copro_gestionnaire', secteur: 'copropriete', question: 'Gestionnaire ?' },
  { code: 'copro_annee_gestionnaire', secteur: 'copropriete', question: 'Année du gestionnaire' },
  { code: 'copro_declarations', secteur: 'copropriete', question: 'Déclarations de copropriété' },
  { code: 'copro_nouvelle_construction', secteur: 'copropriete', question: 'Nouvelle construction' },
  { code: 'copro_fraction_commerciale', secteur: 'copropriete', question: 'Fraction commerciale' },
  { code: 'copro_locations_court_terme', secteur: 'copropriete', question: 'Locations à court terme permises ?' },
  { code: 'copro_coproprietaires_assures', secteur: 'copropriete', question: 'Copropriétaires assurés ?' },
  { code: 'copro_statuts_impayes', secteur: 'copropriete', question: 'Statuts / créances impayées' },
  { code: 'copro_ascenseur', secteur: 'copropriete', question: 'Ascenseur' },
  { code: 'copro_piscine_spa_gym', secteur: 'copropriete', question: 'Piscine / spa / gymnase' },
  { code: 'copro_procedures', secteur: 'copropriete', question: 'Procédures judiciaires' },
  // Entrepreneur (construction)
  { code: 'entr_licence_rbq', secteur: 'entrepreneur', question: 'Licence RBQ' },
  { code: 'entr_cautionnement_licence', secteur: 'entrepreneur', question: 'Cautionnement de licence RBQ' },
  { code: 'entr_types_travaux', secteur: 'entrepreneur', question: 'Types de travaux' },
  { code: 'entr_travaux_sous_traitants', secteur: 'entrepreneur', question: 'Travaux en sous-traitance' },
  { code: 'entr_travaux_autres_provinces', secteur: 'entrepreneur', question: 'Travaux dans d\u2019autres provinces' },
  { code: 'entr_experience', secteur: 'entrepreneur', question: 'Expérience dans le domaine' },
  { code: 'entr_employes_saisonniers', secteur: 'entrepreneur', question: 'Employés saisonniers' },
  // Bijouterie (formulaire JM Partner Solutions / Jewelers Mutual)
  { code: "bjo_mix_activites", secteur: "bijouterie", question: "Répartition des activités (% : détail, gros, réparation, fabrication, estimation, affinage, achat d’or)" },
  { code: "bjo_type_emplacement", secteur: "bijouterie", question: "Type d’emplacement (condo commercial, indépendant, centre-ville, kiosque, centre commercial fermé, galerie marchande, domicile, autre)" },
  { code: "bjo_lieux_partages", secteur: "bijouterie", question: "Lieux partagés avec une autre entreprise (type d’entreprise)" },
  { code: "bjo_associations", secteur: "bijouterie", question: "Membre d’une association (CJA, Canadian Jewellery Group, Joailliers Vigilance du Canada)" },
  { code: "bjo_autres_entreprises", secteur: "bijouterie", question: "Autres entreprises de bijouterie détenues ou gérées par les dirigeants" },
  { code: "bjo_bloc_anterieur", secteur: "bijouterie", question: "Police bloc des bijoutiers antérieure (assureur, année, prime)" },
  { code: "bjo_sinistres_5ans", secteur: "bijouterie", question: "Sinistres liés à des entreprises de bijouterie, 5 ans, non déclarés (lieu, type, date, montant, indemnités reçues)" },
  { code: "bjo_refus_resiliation", secteur: "bijouterie", question: "Police ou garantie refusée, résiliée ou non renouvelée au cours des 3 dernières années" },
  { code: "bjo_jugements_faillite", secteur: "bijouterie", question: "Jugement, saisie, privilège, reprise de possession ou faillite au cours des 5 dernières années" },
  { code: "bjo_condamnations", secteur: "bijouterie", question: "Condamnation pour fraude, corruption, incendie criminel ou crime lié à la malhonnêteté" },
  { code: "bjo_protections", secteur: "bijouterie", question: "Systèmes de protection en place (multiples centrales, pêne dormant double cylindre, double surveillance, garde armé, alarme hold-up, barres, RFID, pellicule/BRGM, alarme incendie reliée, bornes, sas, rideaux d’acier, buzzer, bâtiment sécurisé)" },
  { code: "bjo_videosurveillance", secteur: "bijouterie", question: "Vidéosurveillance en fonction (couvre tous les lieux, 24 h/24, enregistrements conservés hors site, caméras extérieures)" },
  { code: "bjo_alarme_transmission", secteur: "bijouterie", question: "Transmission des signaux d’alarme antivol (cellulaire, IP, radio, DACT, DVAC, GSM/GPRS/CDMA) + fabricant/modèle" },
  { code: "bjo_alarme_detection", secteur: "bijouterie", question: "Détection de mouvements : couvre les zones de marchandises hors coffre, le panneau de contrôle, la zone coffre-fort/chambre forte" },
  { code: "bjo_alarme_repondant", secteur: "bijouterie", question: "Réponse en personne à toutes les alertes d’alarme (par qui)" },
  { code: "bjo_alarme_codes", secteur: "bijouterie", question: "Qui, autre qu’un employé ou dirigeant, possède les codes d’alarme" },
  { code: "bjo_coffre_mur_mitoyen", secteur: "bijouterie", question: "Coffres-forts installés contre un mur mitoyen" },
  { code: "bjo_effectif_min", secteur: "bijouterie", question: "Nombre minimal d’employés/dirigeants/propriétaires sur les lieux (ouverture, heures d’ouverture, fermeture)" },
  { code: "bjo_inventaire_hors_site", secteur: "bijouterie", question: "Sauvegarde des registres d’inventaire conservée hors des locaux" },
  { code: "bjo_montres_luxe", secteur: "bijouterie", question: "Montres de luxe en inventaire (marques : Rolex, Cartier, Omega, Patek Philippe, Breitling, Blancpain, autres)" },
  { code: "bjo_inventaire_physique", secteur: "bijouterie", question: "Inventaire physique complet et documenté aux 12 mois (date du dernier, total du stock, type : physique/perpétuel)" },
  { code: "bjo_registres", secteur: "bijouterie", question: "Registres conservés : inventaire détaillé (quantité, description, valeur), factures d’achat/reçus de vente, liste des biens hors des lieux" },
  { code: "bjo_composition_stock", secteur: "bijouterie", question: "Composition du stock (% : diamants non sertis, montres ≤ 5 000 $, montres > 5 000 $, bijoux ≥ 500 $/article, bijoux < 500 $, débris de métaux précieux, stock non-bijouterie en métaux précieux, autre)" },
  { code: "bjo_inventaire_precedent", secteur: "bijouterie", question: "Inventaire complet précédent (au moins 6 mois avant, total)" },
  { code: "bjo_valeur_max_stock", secteur: "bijouterie", question: "Valeur maximale du stock sur les 12 derniers mois" },
  { code: "bjo_valeur_max_debris", secteur: "bijouterie", question: "Valeur quotidienne maximale des débris de métaux précieux (12 derniers mois)" },
  { code: "bjo_biens_tiers", secteur: "bijouterie", question: "Biens de tiers en garde : clients (valeur quotidienne moyenne), consignation/mémorandum (valeur moyenne)" },
  { code: "bjo_biens_gage", secteur: "bijouterie", question: "Biens pris en gage (dernier inventaire, inventaire précédent, montant maximal prêté + intérêts courus)" },
  { code: "bjo_expeditions", secteur: "bijouterie", question: "Biens expédiés, 12 mois (valeur totale) : Registered Mail, Priority Mail Express, véhicule blindé, livraison privée spécifiée, livraison privée non spécifiée" },
  { code: "bjo_biens_marchands", secteur: "bijouterie", question: "Biens chez des marchands de bijoux (évaluateurs, réparateurs, consignation) : valeur quotidienne moyenne, maximum chez un seul marchand" },
  { code: "bjo_vitrines_verrouillees", secteur: "bijouterie", question: "Vitrines et comptoirs vitrés : serrures, fermés en permanence sauf manipulation" },
  { code: "bjo_alarme_fermeture", secteur: "bijouterie", question: "Alarme antivol en fonction quand l’entreprise est fermée (compagnie de sécurité)" },
  { code: "bjo_certificat_ulc", secteur: "bijouterie", question: "Certificat ULC actif du système d’alarme (numéro, expiration)" },
  { code: "bjo_coffres", secteur: "bijouterie", question: "Coffres-forts : fabricant, modèle, cote feu/cambriolage, < 500 lb (boulonné au plancher ?), dans une chambre forte ?, protection (contact de porte, capacitif/vibrations), détection de mouvements, certificat ULC" },
  { code: "bjo_chambre_forte", secteur: "bijouterie", question: "Chambre(s) forte(s) (formulaire CO 00 06)" },
  { code: "bjo_reserve", secteur: "bijouterie", question: "Réserve(s) (formulaire CO 00 07)" },
  { code: "bjo_valeur_hors_coffre", secteur: "bijouterie", question: "Valeur maximale des biens hors coffre-fort/chambre forte/réserve quand l’entreprise est fermée" },
  // Manufacturier (formulaire de mise à jour assureur, type Economical)
  { code: 'manu_produits_fabriques', secteur: 'manufacturier', question: 'Produits fabriqués (description détaillée)' },
  { code: 'manu_materiaux', secteur: 'manufacturier', question: 'Matières premières utilisées' },
  { code: 'manu_procedes', secteur: 'manufacturier', question: 'Procédés de fabrication (soudure, peinture, produits chimiques…)' },
  { code: 'manu_controle_qualite', secteur: 'manufacturier', question: 'Contrôle de la qualité / programme d’assurance qualité' },
  { code: 'manu_iso_9001', secteur: 'manufacturier', question: 'Certification ISO 9001 ou équivalente' },
  { code: 'manu_rappels_produits', secteur: 'manufacturier', question: 'Rappels de produits (historique et procédure)' },
  { code: 'manu_allergenes', secteur: 'manufacturier', question: 'Allergènes présents (alimentaire / pharmaceutique)' },
  { code: 'manu_stockage_frigorifique', secteur: 'manufacturier', question: 'Stockage frigorifique / chaîne du froid' },
  { code: 'manu_produits_importes', secteur: 'manufacturier', question: 'Produits importés (% et provenance)' },
  { code: 'manu_produits_exportes', secteur: 'manufacturier', question: 'Produits exportés (% et destinations)' },
  { code: 'manu_marque_privee', secteur: 'manufacturier', question: 'Fabrication sous marque privée / pour des tiers' },
  { code: 'manu_etiquetage', secteur: 'manufacturier', question: 'Étiquetage et avertissements conformes' },
  { code: 'manu_sinistres_produits', secteur: 'manufacturier', question: 'Réclamations liées aux produits (5 ans)' },
  { code: 'manu_entretien_equipement', secteur: 'manufacturier', question: 'Programme d’entretien préventif des équipements' },
  // Technologies et médias (formulaire type CFC Technology & Media)
  { code: 'tech_services', secteur: 'technologies', question: 'Services offerts (soutien informatique, consultation TI, développement, hébergement…)' },
  { code: 'tech_produits_logiciels', secteur: 'technologies', question: 'Produits logiciels développés ou revendus' },
  { code: 'tech_hebergement_donnees', secteur: 'technologies', question: 'Hébergement de données de clients (où, chez qui)' },
  { code: 'tech_acces_donnees_sensibles', secteur: 'technologies', question: 'Accès aux données sensibles des clients (paiement, santé, identifiants)' },
  { code: 'tech_contrats_types', secteur: 'technologies', question: 'Contrats types avec limitation de responsabilité' },
  { code: 'tech_sous_traitants_ti', secteur: 'technologies', question: 'Sous-traitants TI et fournisseurs infonuagiques' },
  { code: 'tech_plus_gros_projets', secteur: 'technologies', question: 'Trois plus gros projets / contrats (client, valeur, durée)' },
  { code: 'tech_echecs_projets', secteur: 'technologies', question: 'Projets échoués, retardés ou litigieux (5 ans)' },
  { code: 'tech_propriete_intellectuelle', secteur: 'technologies', question: 'Propriété intellectuelle (brevets, marques, litiges)' },
  { code: 'tech_contenu_media', secteur: 'technologies', question: 'Contenu média publié (diffamation, droits d’auteur)' },
];
const SECTEURS_QUESTIONS = [
  ['copropriete', 'Copropriété (syndicat)'],
  ['entrepreneur', 'Entrepreneur (construction)'],
  ['bijouterie', 'Bijouterie'],
  ['manufacturier', 'Manufacturier'],
  ['technologies', 'Technologies et médias (TI)'],
];

function questionSectorielle(code) {
  return QUESTIONS_SECTORIELLES.find((q) => q.code === code) || null;
}

function obtenirReponsesSectorielles(clientId, cabinetId) {
  return bd.prepare(`
    SELECT * FROM client_questions_sectorielles
    WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(clientId, cabinetId);
}

// reponses : {code_question: reponse} — les codes inconnus sont ignorés.
function definirReponsesSectorielles(clientId, cabinetId, userId, reponses) {
  const client = bd.prepare('SELECT id FROM clients WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(clientId, cabinetId);
  if (!client) throw new Error('Client introuvable');
  let maj = 0;
  for (const [code, reponse] of Object.entries(reponses || {})) {
    const q = questionSectorielle(code);
    if (!q) continue;
    const exist = bd.prepare(`
      SELECT id FROM client_questions_sectorielles WHERE client_id = ? AND code_question = ?
    `).get(clientId, code);
    if (exist) {
      bd.prepare(`
        UPDATE client_questions_sectorielles
        SET reponse = ?, question = ?, archive = 0, maj_le = datetime('now')
        WHERE id = ?
      `).run(reponse ?? null, q.question, exist.id);
    } else {
      bd.prepare(`
        INSERT INTO client_questions_sectorielles (cabinet_id, client_id, code_question, question, reponse)
        VALUES (?, ?, ?, ?, ?)
      `).run(cabinetId, clientId, code, q.question, reponse ?? null);
    }
    maj++;
  }
  if (maj) auditer(cabinetId, userId, 'questions_sectorielles_maj',
    `Questions sectorielles du client #${clientId} mises à jour (${maj})`);
  return maj;
}

// --- Bénéficiaires et assurés additionnels (étape 7/10) ---------------------------
const COLS_BENEFICIAIRE = ['nom', 'adresse', 'ville', 'code_postal', 'qualite', 'clause_preavis'];

function ajouterBeneficiaire(batimentId, cabinetId, userId, data) {
  const b = bd.prepare('SELECT id FROM biens_batiments WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(batimentId, cabinetId);
  if (!b) throw new Error('Bâtiment introuvable');
  if (!data.nom) throw new Error('Nom du bénéficiaire requis');
  const r = bd.prepare(`
    INSERT INTO emplacement_beneficiaires (cabinet_id, batiment_id, ${COLS_BENEFICIAIRE.join(', ')})
    VALUES (?, ?, ${COLS_BENEFICIAIRE.map(() => '?').join(', ')})
  `).run(cabinetId, batimentId, ...COLS_BENEFICIAIRE.map((c) => data[c] ?? null));
  auditer(cabinetId, userId, 'beneficiaire_ajoute',
    `Bénéficiaire « ${data.nom} » (bâtiment #${batimentId})`);
  return r.lastInsertRowid;
}

function archiverBeneficiaire(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE emplacement_beneficiaires SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'beneficiaire_archive', `Bénéficiaire #${id} archivé`);
  return r.changes > 0;
}

function listerBeneficiaires(batimentId, cabinetId) {
  return bd.prepare(`
    SELECT * FROM emplacement_beneficiaires
    WHERE batiment_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(batimentId, cabinetId);
}

const TYPES_DOSSIER_ASSURES = ['biens', 'rc', 'perte_exploitation', 'combine'];
const COLS_ASSURE_ADD = ['nom', 'adresse', 'ville', 'code_postal', 'interet'];

function ajouterAssureAdditionnel(dossierType, dossierId, cabinetId, userId, data) {
  if (!TYPES_DOSSIER_ASSURES.includes(dossierType)) throw new Error('Type de dossier invalide');
  if (!data.nom) throw new Error('Nom de l\u2019assuré additionnel requis');
  const r = bd.prepare(`
    INSERT INTO soumission_assures_additionnels (cabinet_id, dossier_type, dossier_id, ${COLS_ASSURE_ADD.join(', ')})
    VALUES (?, ?, ?, ${COLS_ASSURE_ADD.map(() => '?').join(', ')})
  `).run(cabinetId, dossierType, dossierId, ...COLS_ASSURE_ADD.map((c) => data[c] ?? null));
  auditer(cabinetId, userId, 'assure_additionnel_ajoute',
    `Assuré additionnel « ${data.nom} » (${dossierType} #${dossierId})`);
  return r.lastInsertRowid;
}

function archiverAssureAdditionnel(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE soumission_assures_additionnels SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'assure_additionnel_archive', `Assuré additionnel #${id} archivé`);
  return r.changes > 0;
}

function listerAssuresAdditionnels(dossierType, dossierId, cabinetId) {
  return bd.prepare(`
    SELECT * FROM soumission_assures_additionnels
    WHERE dossier_type = ? AND dossier_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(dossierType, dossierId, cabinetId);
}

// --- Dossier combiné (étape 8/10) --------------------------------------------------
const biensModule = require('./biens');
const rcModule = require('./rc');
const peModule = require('./pe');

const STATUTS_DOSSIER_COMBINE = ['brouillon', 'en_cours', 'envoye', 'clos'];
const PRODUITS_COMBINE = ['biens', 'rc', 'perte_exploitation'];
const TABLES_SOUMISSIONS_COMBINE = {
  biens: 'biens_soumissions',
  rc: 'rc_soumissions',
  perte_exploitation: 'pe_soumissions',
};
const COLS_DOSSIER_TEXTE = ['date_effet', 'date_echeance', 'plan_paiement',
  'code_courtier_assureur', 'signataire_nom', 'signataire_titre', 'date_signature',
  'remarques_diverses', 'circonstances_speciales', 'commentaires_courtier',
  'courtier_connait_depuis', 'transition_entite_nom', 'transition_note'];

function dossierBrut(id, cabinetId) {
  return bd.prepare('SELECT * FROM combine_dossiers WHERE id = ? AND cabinet_id = ?')
    .get(id, cabinetId) || null;
}

function liensDossier(dossierId, cabinetId) {
  return bd.prepare('SELECT * FROM combine_liens WHERE dossier_id = ? AND cabinet_id = ? ORDER BY id')
    .all(dossierId, cabinetId);
}

// Crée un dossier combiné pour un client : crée les 3 soumissions via les
// modules produits, ou LIE des soumissions existantes du même client
// (donnees.lier = {biens: id, rc: id, perte_exploitation: id}).
function creerDossier({ cabinetId, userId, clientId, donnees = {} }) {
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(clientId, cabinetId);
  if (!client) throw new Error('Client introuvable');
  const lier = donnees.lier || {};
  // Contrôle serveur : toute soumission liée appartient au même client.
  for (const produit of PRODUITS_COMBINE) {
    if (!lier[produit]) continue;
    const table = TABLES_SOUMISSIONS_COMBINE[produit];
    const s = bd.prepare(`SELECT client_id FROM ${table} WHERE id = ? AND cabinet_id = ? AND archive = 0`)
      .get(lier[produit], cabinetId);
    if (!s) throw new Error(`Soumission ${produit} à lier introuvable`);
    if (s.client_id !== clientId) {
      throw new Error(`La soumission ${produit} #${lier[produit]} n\u2019appartient pas à ce client`);
    }
  }
  const champs = {};
  for (const c of COLS_DOSSIER_TEXTE) champs[c] = donnees[c] ?? null;
  champs.courtier_placement_id = donnees.courtier_placement_id ?? null;
  champs.client_nouveau = donnees.client_nouveau ? 1 : 0;
  const r = bd.prepare(`
    INSERT INTO combine_dossiers (cabinet_id, client_id, statut, ${COLS_DOSSIER_TEXTE.join(', ')},
      courtier_placement_id, client_nouveau, cree_par)
    VALUES (?, ?, 'brouillon', ${COLS_DOSSIER_TEXTE.map(() => '?').join(', ')}, ?, ?, ?)
  `).run(cabinetId, clientId, ...COLS_DOSSIER_TEXTE.map((c) => champs[c]),
    champs.courtier_placement_id, champs.client_nouveau, userId);
  const dossierId = r.lastInsertRowid;
  const creer = {
    biens: () => biensModule.creerSoumission({ cabinetId, userId, clientId }),
    rc: () => rcModule.creerSoumission({ cabinetId, userId, clientId }),
    perte_exploitation: () => peModule.creerSoumission({ cabinetId, userId, clientId }),
  };
  for (const produit of PRODUITS_COMBINE) {
    const soumissionId = lier[produit] || creer[produit]();
    bd.prepare(`
      INSERT INTO combine_liens (cabinet_id, dossier_id, produit, soumission_id) VALUES (?, ?, ?, ?)
    `).run(cabinetId, dossierId, produit, soumissionId);
  }
  auditer(cabinetId, userId, 'combine_dossier_cree',
    `Dossier combiné #${dossierId} créé pour le client #${clientId}`);
  return dossierId;
}

function mettreAJourDossier(id, cabinetId, userId, data) {
  const d = dossierBrut(id, cabinetId);
  if (!d || d.archive) throw new Error('Dossier combiné introuvable');
  const sets = [];
  const params = [];
  for (const c of COLS_DOSSIER_TEXTE) {
    if (data[c] === undefined) continue;
    sets.push(`${c} = ?`);
    params.push(data[c]);
  }
  if (data.courtier_placement_id !== undefined) {
    sets.push('courtier_placement_id = ?');
    params.push(data.courtier_placement_id);
  }
  if (data.client_nouveau !== undefined) {
    sets.push('client_nouveau = ?');
    params.push(data.client_nouveau ? 1 : 0);
  }
  if (data.statut !== undefined) {
    if (!STATUTS_DOSSIER_COMBINE.includes(data.statut)) throw new Error('Statut de dossier invalide');
    sets.push('statut = ?');
    params.push(data.statut);
  }
  if (!sets.length) return false;
  sets.push("maj_le = datetime('now')");
  params.push(id, cabinetId);
  const r = bd.prepare(`UPDATE combine_dossiers SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ?`).run(...params);
  if (r.changes) auditer(cabinetId, userId, 'combine_dossier_maj', `Dossier combiné #${id} mis à jour`);
  return r.changes > 0;
}

function archiverDossier(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE combine_dossiers SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'combine_dossier_archive', `Dossier combiné #${id} archivé`);
  return r.changes > 0;
}

// Le dossier complet : en-tête, client, les 3 soumissions via leurs modules,
// et les rattachements emplacement ↔ établissement PE / lieu RC.
function obtenirDossier(id, cabinetId) {
  const d = dossierBrut(id, cabinetId);
  if (!d || d.archive) return null;
  const client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?')
    .get(d.client_id, cabinetId);
  const liens = liensDossier(id, cabinetId);
  const parProduit = {};
  for (const l of liens) parProduit[l.produit] = l.soumission_id;
  const soumissions = {};
  if (parProduit.biens) soumissions.biens = biensModule.obtenirSoumission(parProduit.biens, cabinetId);
  if (parProduit.rc) soumissions.rc = rcModule.obtenirSoumission(parProduit.rc, cabinetId);
  if (parProduit.perte_exploitation) {
    soumissions.perte_exploitation = peModule.obtenirSoumission(parProduit.perte_exploitation, cabinetId);
  }
  return {
    ...d,
    antecedents_bloc: jsonOut(d.antecedents),
    client,
    liens,
    soumissions,
  };
}

function listerDossiers(cabinetId, { inclureArchives = false } = {}) {
  return bd.prepare(`
    SELECT d.*, c.raison_sociale AS client_nom,
      (SELECT COUNT(*) FROM combine_liens l WHERE l.dossier_id = d.id) AS nb_liens
    FROM combine_dossiers d
    JOIN clients c ON c.id = d.client_id AND c.cabinet_id = d.cabinet_id
    WHERE d.cabinet_id = ? ${inclureArchives ? '' : 'AND d.archive = 0'}
    ORDER BY d.id DESC
  `).all(cabinetId);
}

// Synchronise le bloc d'antécédents communs, saisi UNE fois dans la
// combinée, vers les tables *_antecedents des 3 produits liés — via leurs
// propres fonctions (aucune logique métier dupliquée).
function synchroniserAntecedents(dossierId, cabinetId, userId, bloc) {
  const d = obtenirDossier(dossierId, cabinetId);
  if (!d) throw new Error('Dossier combiné introuvable');
  bd.prepare("UPDATE combine_dossiers SET antecedents = ?, maj_le = datetime('now') WHERE id = ? AND cabinet_id = ?")
    .run(jsonIn(bloc), dossierId, cabinetId);
  const ids = {};
  for (const l of d.liens) ids[l.produit] = l.soumission_id;
  const communs = {
    assureur_actuel: bloc.assureur_actuel ?? null,
    numero_police_actuelle: bloc.numero_police_actuelle ?? null,
    date_expiration_actuelle: bloc.date_expiration_actuelle ?? null,
    annees_assurance_continue: bloc.annees_assurance_continue ?? null,
    refus_resiliation_nonrenouvellement: bloc.refus_resiliation_nonrenouvellement ?? null,
    refus_explication: bloc.refus_explication ?? null,
    type_police_precedente: bloc.type_police_precedente ?? null,
    date_effet_precedente: bloc.date_effet_precedente ?? null,
    prime_precedente: bloc.prime_precedente ?? null,
    faillite_jugement: bloc.faillite_jugement ?? null,
    faillite_explication: bloc.faillite_explication ?? null,
    condamnation_honnetete: bloc.condamnation_honnetete ?? null,
    condamnation_explication: bloc.condamnation_explication ?? null,
    consentements: bloc.consentements ?? {},
  };
  if (ids.biens) biensModule.definirAntecedents(ids.biens, cabinetId, userId,
    { ...communs, sinistres_5ans: bloc.sinistres_5ans || [] });
  if (ids.rc) rcModule.definirAntecedents(ids.rc, cabinetId, userId,
    { ...communs, sinistres_5ans: bloc.sinistres_5ans || [] });
  if (ids.perte_exploitation) peModule.definirAntecedents(ids.perte_exploitation, cabinetId, userId,
    { ...communs, interruptions_5ans: bloc.interruptions_5ans || [] });
  auditer(cabinetId, userId, 'combine_antecedents_synchronises',
    `Antécédents du dossier combiné #${dossierId} synchronisés vers les 3 produits`);
  return true;
}

// Profil de souscription du client (section Entreprise du questionnaire) :
// ne touche que les colonnes du profil, jamais l'identité du client.
const COLS_PROFIL_CLIENT_TEXTE = ['forme_juridique', 'noms_exploitation', 'description_activites',
  'code_industrie', 'code_industrie_description', 'repartition_revenus_types', 'repartition_revenus_geo'];
const COLS_PROFIL_CLIENT_NUM = ['annee_fondation', 'annees_experience_liee', 'code_industrie_pct_revenus',
  'masse_salariale', 'nb_employes_temps_plein', 'nb_employes_temps_partiel', 'pct_sous_traitance'];
const COLS_PROFIL_CLIENT_BOOL = ['employes_csst', 'responsabilite_alcool'];

function definirProfilClient(clientId, cabinetId, userId, data) {
  const client = bd.prepare('SELECT id FROM clients WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(clientId, cabinetId);
  if (!client) throw new Error('Client introuvable');
  if (data.forme_juridique !== undefined && data.forme_juridique !== null && data.forme_juridique !== ''
      && !FORMES_JURIDIQUES.some(([c]) => c === data.forme_juridique)) {
    throw new Error('Forme juridique invalide');
  }
  const sets = [];
  const params = [];
  for (const c of COLS_PROFIL_CLIENT_TEXTE) {
    if (data[c] === undefined) continue;
    sets.push(`${c} = ?`);
    params.push(c === 'repartition_revenus_types' || c === 'repartition_revenus_geo' ? jsonIn(data[c]) : data[c]);
  }
  for (const c of COLS_PROFIL_CLIENT_NUM) {
    if (data[c] === undefined) continue;
    sets.push(`${c} = ?`);
    params.push(data[c]);
  }
  for (const c of COLS_PROFIL_CLIENT_BOOL) {
    if (data[c] === undefined) continue;
    sets.push(`${c} = ?`);
    params.push(data[c] ? 1 : 0);
  }
  if (!sets.length) return false;
  params.push(clientId, cabinetId);
  const r = bd.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ?`).run(...params);
  if (r.changes) auditer(cabinetId, userId, 'client_profil_souscription_maj',
    `Profil de souscription du client #${clientId} mis à jour (combinée)`);
  return r.changes > 0;
}

module.exports = {
  jsonIn, jsonOut, auditer,
  FORMES_JURIDIQUES, libelleFormeJuridique,
  CLES_REPARTITION_TYPES, LIBELLES_REPARTITION_TYPES,
  CLES_REPARTITION_GEO, LIBELLES_REPARTITION_GEO,
  CLASSES_CONSTRUCTION, TYPES_EMPLACEMENT, TYPES_BATIMENT, INTERETS_ASSURE,
  AMPLEURS_RENOVATION, DISTANCES_PRISE_EAU, TYPES_ALARME_INCENDIE,
  TYPES_ALARME_VOL, COUVERTURES_GICLEURS, LIBELLES_COUVERTURE_GICLEURS,
  COLS_ENTETE_CABINET, majEnteteCabinet,
  TRANSMISSIONS, COUVERTURES_DETECTION, PROTECTIONS_COFFRES, REPONDANTS_ALARME,
  PROTECTIONS_PHYSIQUES, SIGNAUX_OUVERTURE_FERMETURE,
  COLS_ALARME_TEXTE, COLS_ALARME_JSON, COLS_ALARME_BOOL,
  obtenirAlarme, definirAlarme, deserialiserAlarme,
  AVENANTS_BIENS_ENRICHIS, CODES_AVENANTS_BIENS, CHAMPS_AVENANT_SUPPL,
  avenantActif, normaliserAvenantsBiens,
  ajouterArticleFlottante, modifierArticleFlottante, archiverArticleFlottante,
  listerArticlesFlottante,
  QUESTIONS_SECTORIELLES, SECTEURS_QUESTIONS, questionSectorielle,
  obtenirReponsesSectorielles, definirReponsesSectorielles,
  COLS_BENEFICIAIRE, ajouterBeneficiaire, archiverBeneficiaire, listerBeneficiaires,
  TYPES_DOSSIER_ASSURES, ajouterAssureAdditionnel, archiverAssureAdditionnel,
  listerAssuresAdditionnels,
  STATUTS_DOSSIER_COMBINE, PRODUITS_COMBINE, COLS_DOSSIER_TEXTE,
  creerDossier, mettreAJourDossier, archiverDossier, obtenirDossier, listerDossiers,
  synchroniserAntecedents, definirProfilClient,
  COLS_PROFIL_CLIENT_TEXTE, COLS_PROFIL_CLIENT_NUM, COLS_PROFIL_CLIENT_BOOL,
};
