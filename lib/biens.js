/**
 * lib/biens.js — Couche d'accès aux données « biens commerciaux » (étape 1/10 biens).
 * Questionnaire de soumission : soumissions, bâtiments et contenus en nombre
 * illimité, garanties par bâtiment, antécédents.
 * AUCUNE route/UI ici : ce module est utilisé par les tests (étape 1)
 * et sera utilisé par les routes de l'étape 2.
 * Miroir de lib/fpq1.js (mêmes conventions, préfixe biens_).
 *
 * Conventions : requêtes paramétrées partout, filtre cabinet_id sur chaque
 * lecture/écriture, archivage (archive=1) au lieu de suppressions (règle d'or),
 * journal d'audit sur chaque écriture.
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

// --- Versionnage (règle d'or : jamais de modification silencieuse) ----------------
// Chaque version est un snapshot complet et figé de la soumission en lecture seule.
// v1 = création ; chaque modification de contenu applique le changement PUIS fige
// le nouvel état en v(n+1). L'état précédent reste consultable dans v(n).
// Aucun UPDATE destructeur sans snapshot préalable, aucun DELETE.
function snapshotSoumission(id, cabinetId) {
  const batiments = bd.prepare(`
    SELECT * FROM biens_batiments WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(id, cabinetId).map((b) => {
    const bb = deserialiserBatiment(b);
    const g = bd.prepare(`
      SELECT * FROM biens_garanties WHERE batiment_id = ? AND cabinet_id = ? AND archive = 0
    `).get(b.id, cabinetId);
    bb.garanties = g ? deserialiserGaranties(g) : null;
    bb.contenus = bd.prepare(`
      SELECT * FROM biens_contenus WHERE batiment_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
    `).all(b.id, cabinetId).map(deserialiserContenu);
    return bb;
  });
  const contenusGeneraux = bd.prepare(`
    SELECT * FROM biens_contenus
    WHERE soumission_id = ? AND cabinet_id = ? AND batiment_id IS NULL AND archive = 0 ORDER BY id
  `).all(id, cabinetId).map(deserialiserContenu);
  const a = bd.prepare(`
    SELECT * FROM biens_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  return {
    batiments,
    contenus_generaux: contenusGeneraux,
    antecedents: a ? deserialiserAntecedents(a) : null,
  };
}

function creerVersionSoumission(soumissionId, cabinetId, userId) {
  const s = bd.prepare('SELECT * FROM biens_soumissions WHERE id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (!s) return null;
  const maxV = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM biens_soumission_versions WHERE soumission_id = ?')
    .get(soumissionId).m;
  const v = maxV + 1;
  bd.prepare(`
    INSERT INTO biens_soumission_versions (soumission_id, cabinet_id, version, statut, notes, date_effet_souhaitee, donnees, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(soumissionId, cabinetId, v, s.statut, s.notes, s.date_effet_souhaitee,
    JSON.stringify(snapshotSoumission(soumissionId, cabinetId)), userId || null);
  auditer(cabinetId, userId, 'biens_version', `Soumission biens #${soumissionId} → version ${v}`);
  return v;
}

function versionsSoumission(soumissionId, cabinetId) {
  return bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM biens_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.cabinet_id = ? ORDER BY v.version DESC
  `).all(soumissionId, cabinetId);
}

function obtenirVersion(soumissionId, version, cabinetId) {
  const v = bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM biens_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.version = ? AND v.cabinet_id = ?
  `).get(soumissionId, version, cabinetId);
  if (!v) return null;
  try { v.donnees = JSON.parse(v.donnees); } catch { v.donnees = null; }
  return v;
}

// --- Soumissions --------------------------------------------------------
const COLS_SOUMISSION = ['client_id', 'statut', 'date_effet_souhaitee', 'notes'];

function creerSoumission({ cabinetId, userId, clientId = null, dateEffetSouhaitee = null, notes = null }) {
  const r = bd.prepare(`
    INSERT INTO biens_soumissions (cabinet_id, client_id, date_effet_souhaitee, notes, cree_par)
    VALUES (?, ?, ?, ?, ?)
  `).run(cabinetId, clientId, dateEffetSouhaitee, notes, userId || null);
  auditer(cabinetId, userId, 'biens_soumission_creee', `Soumission biens #${r.lastInsertRowid}`);
  creerVersionSoumission(r.lastInsertRowid, cabinetId, userId); // v1
  return r.lastInsertRowid;
}

function obtenirSoumission(id, cabinetId, { inclureArchives = false } = {}) {
  const s = bd.prepare(`
    SELECT * FROM biens_soumissions WHERE id = ? AND cabinet_id = ? AND (archive = 0 OR ? = 1)
  `).get(id, cabinetId, inclureArchives ? 1 : 0);
  if (!s) return null;
  const arch = inclureArchives ? '1' : 'archive = 0';
  s.batiments = bd.prepare(`
    SELECT * FROM biens_batiments WHERE soumission_id = ? AND cabinet_id = ? AND (${arch}) ORDER BY id
  `).all(id, cabinetId).map((b) => {
    const bb = deserialiserBatiment(b);
    const g = bd.prepare(`
      SELECT * FROM biens_garanties WHERE batiment_id = ? AND cabinet_id = ? AND (${arch})
    `).get(b.id, cabinetId);
    bb.garanties = g ? deserialiserGaranties(g) : null;
    bb.contenus = bd.prepare(`
      SELECT * FROM biens_contenus WHERE batiment_id = ? AND cabinet_id = ? AND (${arch}) ORDER BY id
    `).all(b.id, cabinetId).map(deserialiserContenu);
    return bb;
  });
  s.contenus_generaux = bd.prepare(`
    SELECT * FROM biens_contenus
    WHERE soumission_id = ? AND cabinet_id = ? AND batiment_id IS NULL AND (${arch}) ORDER BY id
  `).all(id, cabinetId).map(deserialiserContenu);
  const a = bd.prepare(`
    SELECT * FROM biens_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.antecedents = a ? deserialiserAntecedents(a) : null;
  return s;
}

function listerSoumissions(cabinetId, { inclureArchives = false, statut = null } = {}) {
  let sql = 'SELECT * FROM biens_soumissions WHERE cabinet_id = ?';
  const params = [cabinetId];
  if (!inclureArchives) sql += ' AND archive = 0';
  if (statut) { sql += ' AND statut = ?'; params.push(statut); }
  sql += ' ORDER BY id DESC';
  return bd.prepare(sql).all(...params);
}

const STATUTS_SOUMISSION = ['brouillon', 'soumise', 'convertie_police'];

function changerStatutSoumission(id, cabinetId, userId, statut) {
  if (!STATUTS_SOUMISSION.includes(statut)) throw new Error('Statut de soumission invalide');
  const r = bd.prepare(`
    UPDATE biens_soumissions SET statut = ? WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(statut, id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'biens_soumission_statut', `Soumission biens #${id} → ${statut}`);
    creerVersionSoumission(id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE biens_soumissions SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'biens_soumission_archivee', `Soumission biens #${id} archivée`);
  return r.changes > 0;
}

function desarchiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE biens_soumissions SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'biens_soumission_desarchivee', `Soumission biens #${id} désarchivée`);
  return r.changes > 0;
}

// --- Bâtiments ------------------------------------------------------------
const COLS_BATIMENT = ['adresse', 'ville', 'code_postal', 'type_construction', 'annee_construction',
  'superficie_pi2', 'nb_etages', 'occupation', 'valeur_batiment', 'gicleurs', 'distance_caserne_km',
  'chauffage', 'annee_toiture', 'notes',
  // Fiche emplacement enrichie (soumission combinée, étape 2/10)
  'province', 'etage', 'bureau',
  'type_emplacement', 'type_batiment', 'interet_assure', 'superficie_occupee_pi2', 'pct_vacant',
  'partage_lieux', 'autres_occupants', 'etages_occupes',
  'classe_construction', 'construction_mur', 'construction_toit_structure', 'finition_toit',
  'materiau_sol', 'sous_sol',
  'electricite_type', 'carburant', 'plomberie_materiau',
  'renovation_toiture_ampleur',
  'renovation_electricite_annee', 'renovation_electricite_ampleur',
  'renovation_plomberie_annee', 'renovation_plomberie_ampleur',
  'renovation_chauffage_annee', 'renovation_chauffage_ampleur',
  'inspection_statut', 'inspection_date', 'inspection_notes',
  'evaluation_date', 'evaluation_par', 'evaluation_cout_remplacement', 'evaluation_details_joints',
  'prise_eau_distance', 'extincteurs_categorie', 'extincteurs_agent', 'extincteurs_pct_couvert',
  'alarme_incendie_type', 'colonne_montante', 'gicleurs_couverture',
  'voisin_gauche_distance_m', 'voisin_gauche_affectation',
  'voisin_droite_distance_m', 'voisin_droite_affectation',
  'voisin_arriere_distance_m', 'voisin_arriere_affectation',
  'voisin_enface_distance_m', 'voisin_enface_affectation', 'aucun_risque_alentours',
  'alarme_vol_type', 'pene_dormant', 'fenetres_grillagees', 'glaces_incassables',
  'coffre_type', 'coffre_categorie', 'autres_protections_criminelles', 'cameras'];
const BOOL_BATIMENT = new Set(['gicleurs', 'partage_lieux', 'evaluation_details_joints',
  'colonne_montante', 'aucun_risque_alentours', 'pene_dormant', 'fenetres_grillagees',
  'glaces_incassables', 'cameras']);

function deserialiserBatiment(b) {
  return b;
}

function ajouterBatiment(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM biens_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  if (!data.adresse) throw new Error('Adresse du bâtiment requise');
  const vals = COLS_BATIMENT.map((col) => {
    let v = data[col] !== undefined ? data[col] : null;
    if (BOOL_BATIMENT.has(col)) v = v ? 1 : 0;
    return v;
  });
  const r = bd.prepare(`
    INSERT INTO biens_batiments (cabinet_id, soumission_id, ${COLS_BATIMENT.join(', ')})
    VALUES (?, ?, ${COLS_BATIMENT.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'biens_batiment_ajoute',
    `Bâtiment ${data.adresse} (soumission biens #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

function modifierBatiment(id, cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const col of COLS_BATIMENT) {
    if (data[col] === undefined) continue;
    let v = data[col];
    if (BOOL_BATIMENT.has(col)) v = v ? 1 : 0;
    sets.push(`${col} = ?`);
    params.push(v);
  }
  if (!sets.length) return false;
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE biens_batiments SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'biens_batiment_modifie', `Bâtiment #${id} modifié`);
    const s = bd.prepare('SELECT soumission_id FROM biens_batiments WHERE id = ?').get(id);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverBatiment(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM biens_batiments WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE biens_batiments SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'biens_batiment_archive', `Bâtiment #${id} archivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function desarchiverBatiment(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM biens_batiments WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE biens_batiments SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'biens_batiment_desarchive', `Bâtiment #${id} désarchivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

// --- Contenus ---------------------------------------------------------------
const COLS_CONTENU = ['description', 'type_contenu', 'valeur', 'notes'];

function deserialiserContenu(c) {
  return c;
}

function ajouterContenu(soumissionId, cabinetId, userId, data, batimentId = null) {
  const s = bd.prepare('SELECT id FROM biens_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  if (batimentId) {
    const b = bd.prepare('SELECT id FROM biens_batiments WHERE id = ? AND soumission_id = ? AND cabinet_id = ? AND archive = 0')
      .get(batimentId, soumissionId, cabinetId);
    if (!b) throw new Error('Bâtiment introuvable');
  }
  if (!data.description) throw new Error('Description du contenu requise');
  const vals = COLS_CONTENU.map((col) => (data[col] !== undefined ? data[col] : null));
  const r = bd.prepare(`
    INSERT INTO biens_contenus (cabinet_id, soumission_id, batiment_id, ${COLS_CONTENU.join(', ')})
    VALUES (?, ?, ?, ${COLS_CONTENU.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, batimentId, ...vals);
  auditer(cabinetId, userId, 'biens_contenu_ajoute',
    `Contenu « ${data.description} » (soumission biens #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

function modifierContenu(id, cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const col of COLS_CONTENU) {
    if (data[col] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(data[col]);
  }
  if (!sets.length) return false;
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE biens_contenus SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'biens_contenu_modifie', `Contenu #${id} modifié`);
    const s = bd.prepare('SELECT soumission_id FROM biens_contenus WHERE id = ?').get(id);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverContenu(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM biens_contenus WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE biens_contenus SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'biens_contenu_archive', `Contenu #${id} archivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function desarchiverContenu(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM biens_contenus WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE biens_contenus SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'biens_contenu_desarchive', `Contenu #${id} désarchivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

// --- Garanties (par bâtiment, une fiche par bâtiment) -------------------------
function deserialiserGaranties(g) {
  g.avenants = jsonOut(g.avenants);
  return g;
}

function definirGaranties(batimentId, cabinetId, userId, data) {
  const b = bd.prepare('SELECT id FROM biens_batiments WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(batimentId, cabinetId);
  if (!b) throw new Error('Bâtiment introuvable');
  const avenants = jsonIn(data.avenants);
  const exist = bd.prepare('SELECT id FROM biens_garanties WHERE batiment_id = ? AND cabinet_id = ?')
    .get(batimentId, cabinetId);
  if (exist) {
    bd.prepare(`
      UPDATE biens_garanties
      SET formule = ?, franchise = ?, montant_assurance = ?, avenants = ?, prime = ?,
          regle_proportionnelle = ?, franchise_contenu = ?, regle_proportionnelle_contenu = ?,
          archive = 0
      WHERE id = ?
    `).run(data.formule ?? null, data.franchise ?? null, data.montant_assurance ?? null,
      avenants, data.prime ?? null,
      data.regle_proportionnelle ?? null, data.franchise_contenu ?? null,
      data.regle_proportionnelle_contenu ?? null, exist.id);
    auditer(cabinetId, userId, 'biens_garanties_modifiees', `Garanties du bâtiment #${batimentId} modifiées`);
    const s = bd.prepare('SELECT soumission_id FROM biens_batiments WHERE id = ?').get(batimentId);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO biens_garanties (cabinet_id, batiment_id, formule, franchise, montant_assurance, avenants, prime,
      regle_proportionnelle, franchise_contenu, regle_proportionnelle_contenu)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, batimentId, data.formule ?? null, data.franchise ?? null,
    data.montant_assurance ?? null, avenants, data.prime ?? null,
    data.regle_proportionnelle ?? null, data.franchise_contenu ?? null,
    data.regle_proportionnelle_contenu ?? null);
  auditer(cabinetId, userId, 'biens_garanties_definies', `Garanties définies pour le bâtiment #${batimentId}`);
  const s = bd.prepare('SELECT soumission_id FROM biens_batiments WHERE id = ?').get(batimentId);
  if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  return r.lastInsertRowid;
}

// --- Antécédents (une fiche par soumission) -----------------------------------
function deserialiserAntecedents(a) {
  a.sinistres_5ans = jsonOut(a.sinistres_5ans);
  a.consentements = jsonOut(a.consentements);
  return a;
}

function definirAntecedents(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM biens_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  const exist = bd.prepare('SELECT * FROM biens_antecedents WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  // Champs communs de la combinée : absents de l'appel = conservés (jamais écrasés par une fiche produit).
  const garde = (cle) => (data[cle] !== undefined ? data[cle] : (exist ? exist[cle] : null));
  const vals = {
    assureur_actuel: data.assureur_actuel ?? null,
    numero_police_actuelle: data.numero_police_actuelle ?? null,
    date_expiration_actuelle: data.date_expiration_actuelle ?? null,
    annees_assurance_continue: data.annees_assurance_continue ?? null,
    sinistres_5ans: jsonIn(data.sinistres_5ans),
    consentements: jsonIn(data.consentements),
    // Antécédents communs de la soumission combinée (étape 6/10).
    refus_resiliation_nonrenouvellement: garde('refus_resiliation_nonrenouvellement'),
    refus_explication: garde('refus_explication'),
    type_police_precedente: garde('type_police_precedente'),
    date_effet_precedente: garde('date_effet_precedente'),
    prime_precedente: garde('prime_precedente'),
    faillite_jugement: garde('faillite_jugement'),
    faillite_explication: garde('faillite_explication'),
    condamnation_honnetete: garde('condamnation_honnetete'),
    condamnation_explication: garde('condamnation_explication'),
  };
  const cols = Object.keys(vals);
  if (exist) {
    bd.prepare(`
      UPDATE biens_antecedents SET ${cols.map((c) => `${c} = ?`).join(', ')}, archive = 0 WHERE id = ?
    `).run(...cols.map((c) => vals[c]), exist.id);
    auditer(cabinetId, userId, 'biens_antecedents_modifies', `Antécédents (soumission biens #${soumissionId}) modifiés`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO biens_antecedents (cabinet_id, soumission_id, ${cols.join(', ')})
    VALUES (?, ?, ${cols.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...cols.map((c) => vals[c]));
  auditer(cabinetId, userId, 'biens_antecedents_definis', `Antécédents définis (soumission biens #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

module.exports = {
  STATUTS_SOUMISSION,
  COLS_BATIMENT, BOOL_BATIMENT,
  creerSoumission,
  obtenirSoumission,
  listerSoumissions,
  changerStatutSoumission,
  archiverSoumission,
  desarchiverSoumission,
  creerVersionSoumission,
  versionsSoumission,
  obtenirVersion,
  ajouterBatiment,
  modifierBatiment,
  archiverBatiment,
  desarchiverBatiment,
  ajouterContenu,
  modifierContenu,
  archiverContenu,
  desarchiverContenu,
  definirGaranties,
  definirAntecedents,
};
