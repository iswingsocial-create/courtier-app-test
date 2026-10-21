/**
 * lib/cyber.js — Couche d'accès aux données « Cyber / cyberrisques » (étape 1/10 cyber).
 * Questionnaire de soumission : soumissions, mesures de sécurité en nombre
 * illimité, garanties par soumission, antécédents (incidents cyber 5 ans).
 * AUCUNE route/UI ici : ce module est utilisé par les tests (étape 1)
 * et sera utilisé par les routes de l'étape 2.
 * Miroir de lib/rc.js (mêmes conventions, préfixe cyber_).
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
  const mesures = bd.prepare(`
    SELECT * FROM cyber_mesures WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(id, cabinetId);
  const g = bd.prepare(`
    SELECT * FROM cyber_garanties WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  const a = bd.prepare(`
    SELECT * FROM cyber_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  return {
    mesures,
    garanties: g ? deserialiserGaranties(g) : null,
    antecedents: a ? deserialiserAntecedents(a) : null,
  };
}

function creerVersionSoumission(soumissionId, cabinetId, userId) {
  const s = bd.prepare('SELECT * FROM cyber_soumissions WHERE id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (!s) return null;
  const maxV = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM cyber_soumission_versions WHERE soumission_id = ?')
    .get(soumissionId).m;
  const v = maxV + 1;
  bd.prepare(`
    INSERT INTO cyber_soumission_versions (soumission_id, cabinet_id, version, statut, notes, date_effet_souhaitee, donnees, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(soumissionId, cabinetId, v, s.statut, s.notes, s.date_effet_souhaitee,
    JSON.stringify(snapshotSoumission(soumissionId, cabinetId)), userId || null);
  auditer(cabinetId, userId, 'cyber_version', `Soumission cyber #${soumissionId} → version ${v}`);
  return v;
}

function versionsSoumission(soumissionId, cabinetId) {
  return bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM cyber_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.cabinet_id = ? ORDER BY v.version DESC
  `).all(soumissionId, cabinetId);
}

function obtenirVersion(soumissionId, version, cabinetId) {
  const v = bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM cyber_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.version = ? AND v.cabinet_id = ?
  `).get(soumissionId, version, cabinetId);
  if (!v) return null;
  try { v.donnees = JSON.parse(v.donnees); } catch { v.donnees = null; }
  return v;
}

// --- Soumissions --------------------------------------------------------
function creerSoumission({ cabinetId, userId, clientId = null, dateEffetSouhaitee = null, notes = null }) {
  const r = bd.prepare(`
    INSERT INTO cyber_soumissions (cabinet_id, client_id, date_effet_souhaitee, notes, cree_par)
    VALUES (?, ?, ?, ?, ?)
  `).run(cabinetId, clientId, dateEffetSouhaitee, notes, userId || null);
  auditer(cabinetId, userId, 'cyber_soumission_creee', `Soumission cyber #${r.lastInsertRowid}`);
  creerVersionSoumission(r.lastInsertRowid, cabinetId, userId); // v1
  return r.lastInsertRowid;
}

function obtenirSoumission(id, cabinetId, { inclureArchives = false } = {}) {
  const s = bd.prepare(`
    SELECT * FROM cyber_soumissions WHERE id = ? AND cabinet_id = ? AND (archive = 0 OR ? = 1)
  `).get(id, cabinetId, inclureArchives ? 1 : 0);
  if (!s) return null;
  const arch = inclureArchives ? '1' : 'archive = 0';
  s.mesures = bd.prepare(`
    SELECT * FROM cyber_mesures WHERE soumission_id = ? AND cabinet_id = ? AND (${arch}) ORDER BY id
  `).all(id, cabinetId);
  const g = bd.prepare(`
    SELECT * FROM cyber_garanties WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.garanties = g ? deserialiserGaranties(g) : null;
  const a = bd.prepare(`
    SELECT * FROM cyber_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.antecedents = a ? deserialiserAntecedents(a) : null;
  s.types_donnees = jsonOut(s.types_donnees_json);
  s.normes = jsonOut(s.normes_json);
  s.revenus_territoires = jsonOut(s.revenus_territoires_json);
  return s;
}

function listerSoumissions(cabinetId, { inclureArchives = false, statut = null } = {}) {
  let sql = 'SELECT * FROM cyber_soumissions WHERE cabinet_id = ?';
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
    UPDATE cyber_soumissions SET statut = ? WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(statut, id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'cyber_soumission_statut', `Soumission cyber #${id} → ${statut}`);
    creerVersionSoumission(id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE cyber_soumissions SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'cyber_soumission_archivee', `Soumission cyber #${id} archivée`);
  return r.changes > 0;
}

function desarchiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE cyber_soumissions SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'cyber_soumission_desarchivee', `Soumission cyber #${id} désarchivée`);
  return r.changes > 0;
}

// --- Mesures de sécurité (contrôles, illimités) -----------------------------
const COLS_MESURE = ['type_mesure', 'statut', 'details', 'notes'];

function ajouterMesure(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM cyber_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  if (!data.type_mesure) throw new Error('Type de mesure requis');
  const vals = COLS_MESURE.map((col) => (data[col] !== undefined ? data[col] : null));
  const r = bd.prepare(`
    INSERT INTO cyber_mesures (cabinet_id, soumission_id, ${COLS_MESURE.join(', ')})
    VALUES (?, ?, ${COLS_MESURE.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'cyber_mesure_ajoutee',
    `Mesure ${data.type_mesure} (soumission cyber #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

function modifierMesure(id, cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const col of COLS_MESURE) {
    if (data[col] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(data[col]);
  }
  if (!sets.length) return false;
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE cyber_mesures SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'cyber_mesure_modifiee', `Mesure #${id} modifiée`);
    const s = bd.prepare('SELECT soumission_id FROM cyber_mesures WHERE id = ?').get(id);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverMesure(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM cyber_mesures WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE cyber_mesures SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'cyber_mesure_archivee', `Mesure #${id} archivée`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function desarchiverMesure(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM cyber_mesures WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE cyber_mesures SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'cyber_mesure_desarchivee', `Mesure #${id} désarchivée`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

// --- Garanties (une fiche par soumission) ------------------------------------
function deserialiserGaranties(g) {
  g.avenants = jsonOut(g.avenants);
  return g;
}

function definirGaranties(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM cyber_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  const avenants = jsonIn(data.avenants);
  const exist = bd.prepare('SELECT id FROM cyber_garanties WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (exist) {
    bd.prepare(`
      UPDATE cyber_garanties
      SET limite_par_sinistre = ?, limite_agregat = ?, franchise = ?, delai_carence = ?, avenants = ?, prime = ?, archive = 0
      WHERE id = ?
    `).run(data.limite_par_sinistre ?? null, data.limite_agregat ?? null, data.franchise ?? null,
      data.delai_carence ?? null, avenants, data.prime ?? null, exist.id);
    auditer(cabinetId, userId, 'cyber_garanties_modifiees', `Garanties (soumission cyber #${soumissionId}) modifiées`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO cyber_garanties (cabinet_id, soumission_id, limite_par_sinistre, limite_agregat, franchise, delai_carence, avenants, prime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, soumissionId, data.limite_par_sinistre ?? null, data.limite_agregat ?? null,
    data.franchise ?? null, data.delai_carence ?? null, avenants, data.prime ?? null);
  auditer(cabinetId, userId, 'cyber_garanties_definies', `Garanties définies (soumission cyber #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

// --- Antécédents (une fiche par soumission) ----------------------------------
function deserialiserAntecedents(a) {
  a.incidents_5ans = jsonOut(a.incidents_5ans);
  a.consentements = jsonOut(a.consentements);
  return a;
}

function definirAntecedents(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM cyber_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  const vals = {
    assureur_actuel: data.assureur_actuel ?? null,
    numero_police_actuelle: data.numero_police_actuelle ?? null,
    date_expiration_actuelle: data.date_expiration_actuelle ?? null,
    annees_assurance_continue: data.annees_assurance_continue ?? null,
    incidents_5ans: jsonIn(data.incidents_5ans),
    consentements: jsonIn(data.consentements),
  };
  const exist = bd.prepare('SELECT id FROM cyber_antecedents WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  const cols = Object.keys(vals);
  if (exist) {
    bd.prepare(`
      UPDATE cyber_antecedents SET ${cols.map((c) => `${c} = ?`).join(', ')}, archive = 0 WHERE id = ?
    `).run(...cols.map((c) => vals[c]), exist.id);
    auditer(cabinetId, userId, 'cyber_antecedents_modifies', `Antécédents (soumission cyber #${soumissionId}) modifiés`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO cyber_antecedents (cabinet_id, soumission_id, ${cols.join(', ')})
    VALUES (?, ?, ${cols.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...cols.map((c) => vals[c]));
  auditer(cabinetId, userId, 'cyber_antecedents_definis', `Antécédents définis (soumission cyber #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

// --- Exposition aux données (questionnaire type CFC) --------------------------------
// Champs portés par la soumission : volume d'enregistrements, types de
// données traitées, responsable de la sécurité, normes suivies et
// revenus répartis par territoire (tarification cyber/E&O TI).
function definirExposition(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM cyber_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  bd.prepare(`
    UPDATE cyber_soumissions
    SET nb_enregistrements = ?, types_donnees_json = ?, responsable_securite = ?,
        normes_json = ?, revenus_territoires_json = ?
    WHERE id = ? AND cabinet_id = ?
  `).run(data.nb_enregistrements ?? null, jsonIn(data.types_donnees),
    data.responsable_securite ?? null, jsonIn(data.normes),
    jsonIn(data.revenus_territoires), soumissionId, cabinetId);
  auditer(cabinetId, userId, 'cyber_exposition_definie', `Exposition aux données (soumission cyber #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return soumissionId;
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
  ajouterMesure,
  modifierMesure,
  archiverMesure,
  desarchiverMesure,
  definirGaranties,
  definirAntecedents,
  definirExposition,
};
