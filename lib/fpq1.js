/**
 * lib/fpq1.js — Couche d'accès aux données FPQ1 (étape 1/10).
 * Questionnaire de soumission automobile : soumissions, conducteurs et
 * véhicules en nombre illimité, garanties par véhicule, antécédents.
 * AUCUNE route/UI ici : ce module est utilisé par les tests (étape 1)
 * et sera utilisé par les routes de l'étape 2.
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
  const conducteurs = bd.prepare(`
    SELECT * FROM auto_conducteurs WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(id, cabinetId).map(deserialiserConducteur);
  const vehicules = bd.prepare(`
    SELECT * FROM auto_vehicules WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(id, cabinetId).map((v) => {
    const vv = deserialiserVehicule(v);
    const g = bd.prepare(`
      SELECT * FROM auto_garanties WHERE vehicule_id = ? AND cabinet_id = ? AND archive = 0
    `).get(v.id, cabinetId);
    vv.garanties = g ? deserialiserGaranties(g) : null;
    return vv;
  });
  const a = bd.prepare(`
    SELECT * FROM auto_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  return {
    conducteurs,
    vehicules,
    antecedents: a ? deserialiserAntecedents(a) : null,
  };
}

function creerVersionSoumission(soumissionId, cabinetId, userId) {
  const s = bd.prepare('SELECT * FROM auto_soumissions WHERE id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (!s) return null;
  const maxV = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM auto_soumission_versions WHERE soumission_id = ?')
    .get(soumissionId).m;
  const v = maxV + 1;
  bd.prepare(`
    INSERT INTO auto_soumission_versions (soumission_id, cabinet_id, version, statut, notes, date_effet_souhaitee, donnees, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(soumissionId, cabinetId, v, s.statut, s.notes, s.date_effet_souhaitee,
    JSON.stringify(snapshotSoumission(soumissionId, cabinetId)), userId || null);
  auditer(cabinetId, userId, 'fpq1_version', `Soumission auto #${soumissionId} → version ${v}`);
  return v;
}

function versionsSoumission(soumissionId, cabinetId) {
  return bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM auto_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.cabinet_id = ? ORDER BY v.version DESC
  `).all(soumissionId, cabinetId);
}

function obtenirVersion(soumissionId, version, cabinetId) {
  const v = bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM auto_soumission_versions v
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
    INSERT INTO auto_soumissions (cabinet_id, client_id, date_effet_souhaitee, notes, cree_par)
    VALUES (?, ?, ?, ?, ?)
  `).run(cabinetId, clientId, dateEffetSouhaitee, notes, userId || null);
  auditer(cabinetId, userId, 'fpq1_soumission_creee', `Soumission auto #${r.lastInsertRowid}`);
  creerVersionSoumission(r.lastInsertRowid, cabinetId, userId); // v1
  return r.lastInsertRowid;
}

function obtenirSoumission(id, cabinetId, { inclureArchives = false } = {}) {
  const s = bd.prepare(`
    SELECT * FROM auto_soumissions WHERE id = ? AND cabinet_id = ? AND (archive = 0 OR ? = 1)
  `).get(id, cabinetId, inclureArchives ? 1 : 0);
  if (!s) return null;
  const arch = inclureArchives ? '1' : 'archive = 0';
  s.conducteurs = bd.prepare(`
    SELECT * FROM auto_conducteurs WHERE soumission_id = ? AND cabinet_id = ? AND (${arch}) ORDER BY id
  `).all(id, cabinetId).map(deserialiserConducteur);
  s.vehicules = bd.prepare(`
    SELECT * FROM auto_vehicules WHERE soumission_id = ? AND cabinet_id = ? AND (${arch}) ORDER BY id
  `).all(id, cabinetId).map((v) => {
    const vv = deserialiserVehicule(v);
    const g = bd.prepare(`
      SELECT * FROM auto_garanties WHERE vehicule_id = ? AND cabinet_id = ? AND (${arch})
    `).get(v.id, cabinetId);
    vv.garanties = g ? deserialiserGaranties(g) : null;
    return vv;
  });
  const a = bd.prepare(`
    SELECT * FROM auto_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.antecedents = a ? deserialiserAntecedents(a) : null;
  return s;
}

function listerSoumissions(cabinetId, { inclureArchives = false, statut = null } = {}) {
  let sql = 'SELECT * FROM auto_soumissions WHERE cabinet_id = ?';
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
    UPDATE auto_soumissions SET statut = ? WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(statut, id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'fpq1_soumission_statut', `Soumission auto #${id} → ${statut}`);
    creerVersionSoumission(id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE auto_soumissions SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'fpq1_soumission_archivee', `Soumission auto #${id} archivée`);
  return r.changes > 0;
}

function desarchiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE auto_soumissions SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'fpq1_soumission_desarchivee', `Soumission auto #${id} désarchivée`);
  return r.changes > 0;
}

// --- Conducteurs ----------------------------------------------------------
const COLS_CONDUCTEUR = ['nom', 'prenom', 'date_naissance', 'sexe', 'etat_civil', 'numero_permis',
  'province_permis', 'date_obtention_permis', 'annees_experience_ca', 'annees_experience_ailleurs',
  'lien_assure', 'telephone', 'courriel', 'profession', 'employeur', 'conducteur_principal',
  'vehicules_conduits', 'infractions', 'suspensions'];
const JSON_CONDUCTEUR = new Set(['vehicules_conduits', 'infractions', 'suspensions']);

function deserialiserConducteur(c) {
  for (const k of JSON_CONDUCTEUR) c[k] = jsonOut(c[k]);
  return c;
}

function ajouterConducteur(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM auto_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  if (!data.nom || !data.prenom) throw new Error('Nom et prénom du conducteur requis');
  const vals = COLS_CONDUCTEUR.map((col) => {
    let v = data[col] !== undefined ? data[col] : (col === 'province_permis' ? 'QC' : null);
    if (JSON_CONDUCTEUR.has(col)) v = jsonIn(v);
    if (col === 'conducteur_principal') v = v ? 1 : 0;
    return v;
  });
  const r = bd.prepare(`
    INSERT INTO auto_conducteurs (cabinet_id, soumission_id, ${COLS_CONDUCTEUR.join(', ')})
    VALUES (?, ?, ${COLS_CONDUCTEUR.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'fpq1_conducteur_ajoute',
    `Conducteur ${data.prenom} ${data.nom} (soumission auto #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

function modifierConducteur(id, cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const col of COLS_CONDUCTEUR) {
    if (data[col] === undefined) continue;
    let v = data[col];
    if (JSON_CONDUCTEUR.has(col)) v = jsonIn(v);
    if (col === 'conducteur_principal') v = v ? 1 : 0;
    sets.push(`${col} = ?`);
    params.push(v);
  }
  if (!sets.length) return false;
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE auto_conducteurs SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'fpq1_conducteur_modifie', `Conducteur #${id} modifié`);
    const s = bd.prepare('SELECT soumission_id FROM auto_conducteurs WHERE id = ?').get(id);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverConducteur(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM auto_conducteurs WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE auto_conducteurs SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'fpq1_conducteur_archive', `Conducteur #${id} archivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function desarchiverConducteur(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM auto_conducteurs WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE auto_conducteurs SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'fpq1_conducteur_desarchive', `Conducteur #${id} désarchivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

// --- Véhicules ------------------------------------------------------------
const COLS_VEHICULE = ['annee', 'marque', 'modele', 'version_finition', 'vin', 'carrosserie',
  'neuf_occasion', 'date_achat', 'prix_achat', 'valeur_estimee', 'financement',
  'creancier_nom', 'creancier_courriel', 'usage', 'km_annuel', 'pct_hors_quebec',
  'stationnement', 'remisage_hiver', 'modifications', 'antivol_tag', 'pneus_hiver',
  'conducteur_principal_id', 'remorque', 'remorque_details'];
const JSON_VEHICULE = new Set(['modifications', 'remorque_details']);
const BOOL_VEHICULE = new Set(['remisage_hiver', 'antivol_tag', 'pneus_hiver', 'remorque']);

function deserialiserVehicule(v) {
  for (const k of JSON_VEHICULE) v[k] = jsonOut(v[k]);
  return v;
}

function ajouterVehicule(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM auto_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  const vals = COLS_VEHICULE.map((col) => {
    let v = data[col] !== undefined ? data[col] : null;
    if (JSON_VEHICULE.has(col)) v = jsonIn(v);
    if (BOOL_VEHICULE.has(col)) v = v ? 1 : 0;
    return v;
  });
  const r = bd.prepare(`
    INSERT INTO auto_vehicules (cabinet_id, soumission_id, ${COLS_VEHICULE.join(', ')})
    VALUES (?, ?, ${COLS_VEHICULE.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'fpq1_vehicule_ajoute',
    `Véhicule ${data.annee || ''} ${data.marque || ''} ${data.modele || ''} (soumission auto #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

function modifierVehicule(id, cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const col of COLS_VEHICULE) {
    if (data[col] === undefined) continue;
    let v = data[col];
    if (JSON_VEHICULE.has(col)) v = jsonIn(v);
    if (BOOL_VEHICULE.has(col)) v = v ? 1 : 0;
    sets.push(`${col} = ?`);
    params.push(v);
  }
  if (!sets.length) return false;
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE auto_vehicules SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'fpq1_vehicule_modifie', `Véhicule #${id} modifié`);
    const s = bd.prepare('SELECT soumission_id FROM auto_vehicules WHERE id = ?').get(id);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverVehicule(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM auto_vehicules WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE auto_vehicules SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'fpq1_vehicule_archive', `Véhicule #${id} archivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function desarchiverVehicule(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM auto_vehicules WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE auto_vehicules SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'fpq1_vehicule_desarchive', `Véhicule #${id} désarchivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

// --- Garanties (par véhicule, une fiche par véhicule) ----------------------
function deserialiserGaranties(g) {
  g.avenants = jsonOut(g.avenants);
  return g;
}

function definirGaranties(vehiculeId, cabinetId, userId, data) {
  const v = bd.prepare('SELECT id FROM auto_vehicules WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(vehiculeId, cabinetId);
  if (!v) throw new Error('Véhicule introuvable');
  const avenants = jsonIn(data.avenants);
  const exist = bd.prepare('SELECT id FROM auto_garanties WHERE vehicule_id = ? AND cabinet_id = ?')
    .get(vehiculeId, cabinetId);
  if (exist) {
    bd.prepare(`
      UPDATE auto_garanties
      SET rc_montant = ?, protection_b = ?, franchise_b = ?, avenants = ?, prime = ?, archive = 0
      WHERE id = ?
    `).run(data.rc_montant ?? null, data.protection_b ?? null, data.franchise_b ?? null,
      avenants, data.prime ?? null, exist.id);
    auditer(cabinetId, userId, 'fpq1_garanties_modifiees', `Garanties du véhicule #${vehiculeId} modifiées`);
    const s = bd.prepare('SELECT soumission_id FROM auto_vehicules WHERE id = ?').get(vehiculeId);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO auto_garanties (cabinet_id, vehicule_id, rc_montant, protection_b, franchise_b, avenants, prime)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, vehiculeId, data.rc_montant ?? null, data.protection_b ?? null,
    data.franchise_b ?? null, avenants, data.prime ?? null);
  auditer(cabinetId, userId, 'fpq1_garanties_definies', `Garanties définies pour le véhicule #${vehiculeId}`);
  const s = bd.prepare('SELECT soumission_id FROM auto_vehicules WHERE id = ?').get(vehiculeId);
  if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  return r.lastInsertRowid;
}

// --- Antécédents (une fiche par soumission) --------------------------------
function deserialiserAntecedents(a) {
  a.sinistres_6ans = jsonOut(a.sinistres_6ans);
  a.consentements = jsonOut(a.consentements);
  return a;
}

function definirAntecedents(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM auto_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  const vals = {
    assureur_actuel: data.assureur_actuel ?? null,
    numero_police_actuelle: data.numero_police_actuelle ?? null,
    date_expiration_actuelle: data.date_expiration_actuelle ?? null,
    annees_assurance_continue: data.annees_assurance_continue ?? null,
    resiliation_ant: data.resiliation_ant ? 1 : 0,
    resiliation_details: data.resiliation_details ?? null,
    non_paiement_ant: data.non_paiement_ant ? 1 : 0,
    faillite: data.faillite ? 1 : 0,
    casier_judiciaire: data.casier_judiciaire ? 1 : 0,
    sinistres_6ans: jsonIn(data.sinistres_6ans),
    consentements: jsonIn(data.consentements),
  };
  const exist = bd.prepare('SELECT id FROM auto_antecedents WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  const cols = Object.keys(vals);
  if (exist) {
    bd.prepare(`
      UPDATE auto_antecedents SET ${cols.map((c) => `${c} = ?`).join(', ')}, archive = 0 WHERE id = ?
    `).run(...cols.map((c) => vals[c]), exist.id);
    auditer(cabinetId, userId, 'fpq1_antecedents_modifies', `Antécédents (soumission auto #${soumissionId}) modifiés`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO auto_antecedents (cabinet_id, soumission_id, ${cols.join(', ')})
    VALUES (?, ?, ${cols.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...cols.map((c) => vals[c]));
  auditer(cabinetId, userId, 'fpq1_antecedents_definis', `Antécédents définis (soumission auto #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

module.exports = {
  STATUTS_SOUMISSION,
  creerSoumission,
  obtenirSoumission,
  listerSoumissions,
  changerStatutSoumission,
  archiverSoumission,
  desarchiverSoumission,
  creerVersionSoumission,
  versionsSoumission,
  obtenirVersion,
  ajouterConducteur,
  modifierConducteur,
  archiverConducteur,
  desarchiverConducteur,
  ajouterVehicule,
  modifierVehicule,
  archiverVehicule,
  desarchiverVehicule,
  definirGaranties,
  definirAntecedents,
};
