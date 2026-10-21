/**
 * lib/analyse-insertion.js — Insertion des champs retenus à la révision
 * (module « Analyse de documents IA », étape 3/5).
 *
 * Trois cibles, toujours après confirmation explicite à l'écran de révision :
 *  1. creerSoumission : nouvelle soumission du produit choisi, via les
 *     couches lib/<produit>.js existantes (en-tête + garanties +
 *     antécédents selon les champs retenus ; chaque couche fige ses
 *     versions — règle d'or).
 *  2. creerPolice : nouvelle police du module commercial (lignes), avec le
 *     document copié dans ses pièces jointes.
 *  3. rattacherPolice : le document est copié dans les documents d'une
 *     police existante du même cabinet.
 *
 * Le client (entreprise) est résolu par raison sociale : correspondance
 * exacte ou unique ; sinon un client minimal est créé (raison sociale +
 * coordonnées détectées). Chaque section est tentée séparément : un échec
 * de garanties n'empêche pas la création de la soumission, et le résultat
 * détaille honnêtement ce qui a été inséré ou non.
 */
const fs = require('fs');
const path = require('path');
const bd = require('./bd');
const { journal } = require('./middleware');
const { META_LISTES } = require('./analyse-document');

const LIGNES_POLICE = {
  auto: 'auto', biens: 'biens', rc: 'cgl', cyber: 'cyber', eo: 'eo', do: 'do',
  pe: 'perte_exploitation', flotte: 'flotte', cautionnement: 'cautionnement',
};

const LIBS = {
  auto: () => require('./fpq1'),
  biens: () => require('./biens'),
  rc: () => require('./rc'),
  cyber: () => require('./cyber'),
  eo: () => require('./eo'),
  do: () => require('./do'),
  pe: () => require('./pe'),
  flotte: () => require('./flotte'),
  cautionnement: () => require('./cautionnement'),
};

function resoudreClient(cabinetId, utilisateur, v) {
  const entreprise = String(v['client.entreprise'] || '').trim();
  if (!entreprise) return { client: null, cree: false };
  const exact = bd.prepare(
    'SELECT * FROM clients WHERE cabinet_id = ? AND archive = 0 AND lower(raison_sociale) = lower(?)'
  ).get(cabinetId, entreprise);
  if (exact) return { client: exact, cree: false };
  const liste = bd.prepare(
    'SELECT * FROM clients WHERE cabinet_id = ? AND archive = 0 AND lower(raison_sociale) LIKE lower(?) ORDER BY raison_sociale LIMIT 2'
  ).all(cabinetId, `%${entreprise}%`);
  if (liste.length === 1) return { client: liste[0], cree: false };
  const r = bd.prepare(`
    INSERT INTO clients (cabinet_id, raison_sociale, neq, prenom, nom, courriel, telephone,
      adresse, ville, code_postal, responsable_id, notes)
    VALUES (?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, entreprise, v['client.neq'] || null,
    v['client.courriel'] || null, v['client.telephone'] || null,
    v['client.adresse'] || null, v['client.ville'] || null, v['client.code_postal'] || null,
    utilisateur.role === 'courtier' ? utilisateur.id : null,
    'Client créé depuis une analyse de document IA (à compléter).');
  journal(cabinetId, utilisateur.id, 'analyse_client_cree',
    `Entreprise « ${entreprise} » créée depuis une analyse de document (client #${r.lastInsertRowid})`);
  return { client: bd.prepare('SELECT * FROM clients WHERE id = ?').get(r.lastInsertRowid), cree: true };
}

function section(sections, nom, fn) {
  try { const detail = fn(); sections.push({ nom, ok: true, detail: detail || null }); }
  catch (e) { sections.push({ nom, ok: false, erreur: e.message }); }
}

// --- Listes (v2) ------------------------------------------------------------------
// Chaque élément de liste retenu à la révision est inséré via la fonction
// d'ajout de la couche produit (qui fige sa propre version — règle d'or).
const FONCTIONS_AJOUT = {
  vehicules: 'ajouterVehicule', conducteurs: 'ajouterConducteur',
  batiments: 'ajouterBatiment', exploitations: 'ajouterExploitation',
  dirigeants: 'ajouterDirigeant', etablissements: 'ajouterEtablissement',
  obligations: 'ajouterObligation', activites: 'ajouterActivite',
  mesures: 'ajouterMesure',
};

// Convertit les champs logiques d'un élément en clés de données de la couche
// produit (ex. « niv » → « vin » pour FPQ1, « valeur » → « valeur_estimee »).
function versDonnees(produit, type, champs) {
  const meta = META_LISTES[type];
  const data = {};
  for (const [cle, valeur] of Object.entries(champs || {})) {
    const cm = meta && meta.champs[cle];
    if (!cm || valeur === null || valeur === undefined || valeur === '') continue;
    if (cm.produits && !cm.produits.includes(produit)) continue;
    data[cm.colonne(produit)] = valeur;
  }
  return data;
}

/**
 * Insère les éléments de listes dans une soumission via les couches produit.
 * Un élément en échec n'empêche pas les autres (sections détaillées).
 * @returns {{comptes: Object, premiersIds: Object, sections: Array}}
 */
function insererListes(lib, produit, soumissionId, cabinetId, userId, listes, sections) {
  const comptes = {};
  const premiersIds = {};
  for (const [type, items] of Object.entries(listes || {})) {
    const meta = META_LISTES[type];
    const fnNom = FONCTIONS_AJOUT[type];
    if (!meta || !fnNom || !meta.produits.includes(produit) || !Array.isArray(items) || !items.length) continue;
    if (typeof lib[fnNom] !== 'function') continue;
    let inseres = 0;
    const erreurs = [];
    for (const item of items) {
      try {
        const id = lib[fnNom](soumissionId, cabinetId, userId, versDonnees(produit, type, item.champs));
        if (premiersIds[type] === undefined) premiersIds[type] = id;
        inseres++;
      } catch (e) {
        erreurs.push(e.message);
      }
    }
    comptes[type] = inseres;
    sections.push({
      nom: `liste ${type}`,
      ok: erreurs.length === 0,
      detail: `${inseres}/${items.length} élément(s) inséré(s)${erreurs.length ? ` — échecs : ${[...new Set(erreurs)].join(' ; ')}` : ''}`,
    });
  }
  return { comptes, premiersIds };
}

function detailComptes(comptes) {
  const parts = Object.entries(comptes || {}).filter(([, n]) => n > 0)
    .map(([type, n]) => `${n} ${type}`);
  return parts.length ? parts.join(', ') : 'aucun élément de liste';
}

/**
 * Crée une soumission du produit choisi avec les valeurs retenues.
 * @param {object} v valeurs par clé logique (ex. 'garanties.prime')
 * @param {object} listes listes retenues (v2) : { vehicules: [{champs}], ... }
 * @param {object} options { clientId, notes } — ouverture de dossier dictée :
 *   le client est créé/choisi à la révision et imposé ici (pas de résolution
 *   par raison sociale) ; les notes par défaut parlent alors de la dictée.
 * @returns {{soumissionId, clientId, clientCree, sections, comptesListes}}
 */
function creerSoumission(cabinetId, utilisateur, produit, v, listes = {}, options = {}) {
  const lib = LIBS[produit]();
  const userId = utilisateur.id;
  let client, cree;
  if (options.clientId) {
    client = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ?').get(options.clientId, cabinetId);
    if (!client) throw new Error('Entreprise cible introuvable dans votre cabinet.');
    cree = false;
  } else {
    ({ client, cree } = resoudreClient(cabinetId, utilisateur, v));
  }
  const sections = [];
  const notes = options.notes
    || `Créée depuis une analyse de document IA${v['entete.assureur'] ? ` — assureur du document : ${v['entete.assureur']}` : ''}.`;

  let soumissionId = null;
  if (produit === 'flotte' || produit === 'cautionnement') {
    soumissionId = lib.creerSoumission({
      cabinetId, userId, clientId: client ? client.id : null,
      assureur: v['entete.assureur'] || null,
      numeroPolice: v['entete.numero_police'] || null,
      dateEffetSouhaitee: v['entete.date_effet'] || null,
      dateEcheanceVisee: v['entete.date_echeance'] || null,
      nbVehicules: produit === 'flotte' ? (v['entete.nb_vehicules'] ?? null) : null,
      rayonOperationKm: produit === 'flotte' ? (v['entete.rayon_operation_km'] ?? null) : null,
      notes,
    });
  } else {
    soumissionId = lib.creerSoumission({
      cabinetId, userId, clientId: client ? client.id : null,
      dateEffetSouhaitee: v['entete.date_effet'] || null, notes,
    });
  }
  sections.push({ nom: 'en-tête', ok: true, detail: `soumission #${soumissionId}` });

  // Listes retenues (v2) : insérées AVANT les garanties, car pour auto /
  // biens / RC les garanties se rattachent au premier élément de la liste
  // (véhicule, bâtiment, lieu) quand il y en a un.
  const { comptes: comptesListes, premiersIds } = insererListes(
    lib, produit, soumissionId, cabinetId, userId, listes, sections);

  // Garanties (selon le produit : par soumission ou rattachées à un item).
  const aGaranties = ['garanties.prime', 'garanties.limite', 'garanties.limite_par_sinistre',
    'garanties.limite_agregat', 'garanties.franchise', 'garanties.delai_carence', 'garanties.base',
    'garanties.periode_indemnite_mois', 'garanties.base_montant', 'garanties.franchise_jours',
    'garanties.limite_globale', 'garanties.limite_par_projet']
    .some((k) => v[k] !== undefined && v[k] !== null && v[k] !== '');
  if (aGaranties) {
    section(sections, 'garanties', () => {
      if (produit === 'cyber') {
        lib.definirGaranties(soumissionId, cabinetId, userId, {
          limite_par_sinistre: v['garanties.limite_par_sinistre'] ?? v['garanties.limite'] ?? null,
          limite_agregat: v['garanties.limite_agregat'] ?? null,
          franchise: v['garanties.franchise'] ?? null,
          delai_carence: v['garanties.delai_carence'] ?? null,
          prime: v['garanties.prime'] ?? null,
        });
      } else if (produit === 'eo' || produit === 'do') {
        lib.definirGaranties(soumissionId, cabinetId, userId, {
          limite_par_sinistre: v['garanties.limite_par_sinistre'] ?? v['garanties.limite'] ?? null,
          limite_agregat: v['garanties.limite_agregat'] ?? null,
          franchise: v['garanties.franchise'] ?? null,
          base: v['garanties.base'] ?? null,
          prime: v['garanties.prime'] ?? null,
        });
      } else if (produit === 'pe') {
        lib.definirGaranties(soumissionId, cabinetId, userId, {
          limite: v['garanties.limite'] ?? null,
          periode_indemnite_mois: v['garanties.periode_indemnite_mois'] ?? null,
          franchise_jours: v['garanties.franchise_jours'] ?? null,
          base_montant: v['garanties.base_montant'] ?? null,
          prime: v['garanties.prime'] ?? null,
        });
      } else if (produit === 'flotte') {
        lib.definirGaranties(soumissionId, cabinetId, userId, {
          limite_rc: v['garanties.limite'] ?? v['garanties.limite_par_sinistre'] ?? null,
          franchise_collision: v['garanties.franchise'] ?? null,
          prime: v['garanties.prime'] ?? null,
        });
      } else if (produit === 'cautionnement') {
        lib.definirGaranties(soumissionId, cabinetId, userId, {
          limite_globale: v['garanties.limite_globale'] ?? null,
          limite_par_projet: v['garanties.limite_par_projet'] ?? null,
          prime: v['garanties.prime'] ?? null,
        });
      } else if (produit === 'auto') {
        const vehiculeId = premiersIds.vehicules || lib.ajouterVehicule(soumissionId, cabinetId, userId, {
          vin: v['vehicule.niv'] || null,
          marque: v['vehicule.description'] || null,
          annee: v['vehicule.annee'] ?? null,
        });
        lib.definirGaranties(vehiculeId, cabinetId, userId, {
          rc_montant: v['garanties.limite'] ?? v['garanties.limite_par_sinistre'] ?? null,
          franchise_b: v['garanties.franchise'] ?? null,
          prime: v['garanties.prime'] ?? null,
        });
        return `véhicule #${vehiculeId} + garanties`;
      } else if (produit === 'biens') {
        let batimentId = premiersIds.batiments;
        if (!batimentId) {
          const adresse = v['client.adresse'] || 'Adresse à confirmer';
          batimentId = lib.ajouterBatiment(soumissionId, cabinetId, userId, {
            adresse, ville: v['client.ville'] || null, valeur_batiment: v['garanties.limite'] ?? null,
          });
        }
        lib.definirGaranties(batimentId, cabinetId, userId, {
          montant_assurance: v['garanties.limite'] ?? null,
          franchise: v['garanties.franchise'] ?? null,
          prime: v['garanties.prime'] ?? null,
        });
        return `bâtiment #${batimentId} + garanties`;
      } else if (produit === 'rc') {
        let exploitationId = premiersIds.exploitations;
        if (!exploitationId) {
          const adresse = v['client.adresse'] || 'Adresse à confirmer';
          exploitationId = lib.ajouterExploitation(soumissionId, cabinetId, userId, {
            adresse, ville: v['client.ville'] || null,
          });
        }
        lib.definirGaranties(exploitationId, cabinetId, userId, {
          limite_par_sinistre: v['garanties.limite_par_sinistre'] ?? v['garanties.limite'] ?? null,
          limite_agregat: v['garanties.limite_agregat'] ?? null,
          franchise: v['garanties.franchise'] ?? null,
          prime: v['garanties.prime'] ?? null,
        });
        return `lieu d'exploitation #${exploitationId} + garanties`;
      }
      return null;
    });
  }

  // Obligation de cautionnement (bénéficiaire / contrat détectés) — seulement
  // en repli v1 : si une liste d'obligations a été insérée, elle fait foi.
  if (produit === 'cautionnement' && !comptesListes.obligations
    && (v['obligation.beneficiaire'] || v['obligation.montant_contrat'])) {
    section(sections, 'obligation', () => {
      lib.ajouterObligation(soumissionId, cabinetId, userId, {
        type: v['obligation.type'] || 'autre',
        beneficiaire: v['obligation.beneficiaire'] || null,
        montant_contrat: v['obligation.montant_contrat'] ?? null,
      });
      return null;
    });
  }

  // Antécédents : assureur / police actuelle lus dans le document.
  if (v['entete.assureur'] || v['entete.numero_police']) {
    section(sections, 'antécédents', () => {
      lib.definirAntecedents(soumissionId, cabinetId, userId, {
        assureur_actuel: v['entete.assureur'] || null,
        numero_police_actuelle: v['entete.numero_police'] || null,
        date_expiration_actuelle: v['entete.date_echeance'] || null,
      });
      return null;
    });
  }

  return { soumissionId, clientId: client ? client.id : null, clientCree: cree, sections, comptesListes };
}

/**
 * Ajoute les éléments de listes retenus à une soumission EXISTANTE du même
 * produit (parcours v2 : police téléversée → soumission créée, puis Excel de
 * permis téléversé → conducteurs ajoutés à la même soumission).
 * @returns {{soumissionId, clientId, sections, comptesListes}}
 */
function ajouterListesAExistante(cabinetId, utilisateur, produit, soumissionId, listes) {
  const lib = LIBS[produit]();
  if (typeof lib.obtenirSoumission !== 'function') {
    throw new Error(`Le produit « ${produit} » ne permet pas l'ajout à une soumission existante.`);
  }
  const s = lib.obtenirSoumission(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable dans votre cabinet.');
  const sections = [];
  const { comptes } = insererListes(lib, produit, soumissionId, cabinetId, utilisateur.id, listes, sections);
  journal(cabinetId, utilisateur.id, 'analyse_listes_ajoutees',
    `Listes ajoutées à la soumission ${produit} #${soumissionId} : ${detailComptes(comptes)}`);
  return { soumissionId, clientId: s.client_id, sections, comptesListes: comptes };
}

/** Copie le fichier de l'analyse dans les documents d'une police. */
function copierDocumentVersPolice(cabinetId, utilisateur, analyse, policeId) {
  const dir = path.join(__dirname, '..', 'uploads', String(cabinetId));
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(analyse.chemin).replace(/[^a-zA-Z0-9._-]/g, '_');
  const dest = path.join(dir, `analyse-${analyse.id}-${base}`);
  fs.copyFileSync(analyse.chemin, dest);
  const r = bd.prepare(`
    INSERT INTO documents (cabinet_id, police_id, nom_origine, chemin, mime, taille)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(cabinetId, policeId, analyse.nom_origine, dest, analyse.mime, analyse.taille);
  journal(cabinetId, utilisateur.id, 'analyse_document_rattache',
    `Document « ${analyse.nom_origine} » (analyse #${analyse.id}) copié vers la police #${policeId}`);
  return r.lastInsertRowid;
}

/** Crée une police du module commercial à partir des valeurs retenues. */
function creerPolice(cabinetId, utilisateur, produit, v, analyse) {
  const { client } = resoudreClient(cabinetId, utilisateur, v);
  if (!client) throw new Error("Entreprise non détectée : impossible de créer une police sans client. Retenez le champ « Entreprise » ou rattachez le document à une police existante.");
  const numero = String(v['entete.numero_police'] || '').trim();
  if (!numero) throw new Error('N° de police non détecté : saisissez-le dans la valeur du champ à la révision, ou choisissez une autre cible.');
  const assureur = String(v['entete.assureur'] || '').trim() || 'À confirmer';
  const auj = new Date();
  const effet = v['entete.date_effet'] || auj.toISOString().slice(0, 10);
  let echeance = v['entete.date_echeance'];
  if (!echeance) {
    const d = new Date(effet); d.setFullYear(d.getFullYear() + 1);
    echeance = d.toISOString().slice(0, 10);
  }
  const existante = bd.prepare('SELECT id FROM polices WHERE cabinet_id = ? AND numero_police = ?')
    .get(cabinetId, numero);
  if (existante) throw new Error(`Une police porte déjà le n° ${numero} dans ce cabinet (id ${existante.id}). Rattachez plutôt le document à cette police.`);
  const responsableId = client.responsable_id || utilisateur.id;
  const r = bd.prepare(`
    INSERT INTO polices (cabinet_id, client_id, ligne, assureur, numero_police,
      date_effet, date_echeance, franchise, statut, notes, responsable_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(cabinetId, client.id, LIGNES_POLICE[produit] || 'autre', assureur, numero,
    effet, echeance, Number(v['garanties.franchise'] || 0) || 0,
    `Créée depuis une analyse de document IA (analyse #${analyse.id}).`, responsableId);
  const policeId = r.lastInsertRowid;
  try {
    const { creerVersionPolice } = require('../routes/polices');
    creerVersionPolice(policeId, utilisateur.id);
  } catch (e) { /* version initiale optionnelle : la police reste créée */ }
  journal(cabinetId, utilisateur.id, 'analyse_police_creee',
    `Police ${numero} (id ${policeId}) créée depuis l'analyse #${analyse.id}`);
  return { policeId, clientId: client.id };
}

module.exports = { creerSoumission, creerPolice, copierDocumentVersPolice, resoudreClient, ajouterListesAExistante, detailComptes, LIGNES_POLICE };
