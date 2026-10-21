/**
 * lib/do.js — Couche d'accès aux données « D&O / responsabilité des administrateurs et dirigeants »
 * (étape 1/10 D&O).
 * Questionnaire de soumission : soumissions, dirigeants en nombre
 * illimité, garanties par soumission, antécédents (réclamations D&O 5 ans,
 * poursuites ou actions en justice en cours/envisagées).
 * AUCUNE route/UI ici : ce module est utilisé par les tests (étape 1)
 * et sera utilisé par les routes de l'étape 2.
 * Miroir de lib/cyber.js (mêmes conventions, préfixe do_).
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
  const dirigeants = bd.prepare(`
    SELECT * FROM do_dirigeants WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(id, cabinetId);
  const g = bd.prepare(`
    SELECT * FROM do_garanties WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  const a = bd.prepare(`
    SELECT * FROM do_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  return {
    dirigeants,
    garanties: g ? deserialiserGaranties(g) : null,
    antecedents: a ? deserialiserAntecedents(a) : null,
  };
}

function creerVersionSoumission(soumissionId, cabinetId, userId) {
  const s = bd.prepare('SELECT * FROM do_soumissions WHERE id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (!s) return null;
  const maxV = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM do_soumission_versions WHERE soumission_id = ?')
    .get(soumissionId).m;
  const v = maxV + 1;
  bd.prepare(`
    INSERT INTO do_soumission_versions (soumission_id, cabinet_id, version, statut, notes, date_effet_souhaitee, donnees, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(soumissionId, cabinetId, v, s.statut, s.notes, s.date_effet_souhaitee,
    JSON.stringify(snapshotSoumission(soumissionId, cabinetId)), userId || null);
  auditer(cabinetId, userId, 'do_version', `Soumission D&O #${soumissionId} → version ${v}`);
  return v;
}

function versionsSoumission(soumissionId, cabinetId) {
  return bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM do_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.cabinet_id = ? ORDER BY v.version DESC
  `).all(soumissionId, cabinetId);
}

function obtenirVersion(soumissionId, version, cabinetId) {
  const v = bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM do_soumission_versions v
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
    INSERT INTO do_soumissions (cabinet_id, client_id, date_effet_souhaitee, notes, cree_par)
    VALUES (?, ?, ?, ?, ?)
  `).run(cabinetId, clientId, dateEffetSouhaitee, notes, userId || null);
  auditer(cabinetId, userId, 'do_soumission_creee', `Soumission D&O #${r.lastInsertRowid}`);
  creerVersionSoumission(r.lastInsertRowid, cabinetId, userId); // v1
  return r.lastInsertRowid;
}

function obtenirSoumission(id, cabinetId, { inclureArchives = false } = {}) {
  const s = bd.prepare(`
    SELECT * FROM do_soumissions WHERE id = ? AND cabinet_id = ? AND (archive = 0 OR ? = 1)
  `).get(id, cabinetId, inclureArchives ? 1 : 0);
  if (!s) return null;
  const arch = inclureArchives ? '1' : 'archive = 0';
  s.dirigeants = bd.prepare(`
    SELECT * FROM do_dirigeants WHERE soumission_id = ? AND cabinet_id = ? AND (${arch}) ORDER BY id
  `).all(id, cabinetId);
  const g = bd.prepare(`
    SELECT * FROM do_garanties WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.garanties = g ? deserialiserGaranties(g) : null;
  const a = bd.prepare(`
    SELECT * FROM do_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.antecedents = a ? deserialiserAntecedents(a) : null;
  return s;
}

function listerSoumissions(cabinetId, { inclureArchives = false, statut = null } = {}) {
  let sql = 'SELECT * FROM do_soumissions WHERE cabinet_id = ?';
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
    UPDATE do_soumissions SET statut = ? WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(statut, id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'do_soumission_statut', `Soumission D&O #${id} → ${statut}`);
    creerVersionSoumission(id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE do_soumissions SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'do_soumission_archivee', `Soumission D&O #${id} archivée`);
  return r.changes > 0;
}

function desarchiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE do_soumissions SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'do_soumission_desarchivee', `Soumission D&O #${id} désarchivée`);
  return r.changes > 0;
}

// --- Dirigeants (administrateurs et cadres, illimités) -------------------------
const COLS_DIRIGEANT = ['nom', 'fonction', 'annees_experience', 'antecedents_personnels'];

function ajouterDirigeant(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM do_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  if (!data.nom) throw new Error('Nom du dirigeant requis');
  const vals = COLS_DIRIGEANT.map((col) => (data[col] !== undefined ? data[col] : null));
  const r = bd.prepare(`
    INSERT INTO do_dirigeants (cabinet_id, soumission_id, ${COLS_DIRIGEANT.join(', ')})
    VALUES (?, ?, ${COLS_DIRIGEANT.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'do_dirigeant_ajoutee',
    `Dirigeant « ${data.nom} » (soumission D&O #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

function modifierDirigeant(id, cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const col of COLS_DIRIGEANT) {
    if (data[col] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(data[col]);
  }
  if (!sets.length) return false;
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE do_dirigeants SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'do_dirigeant_modifiee', `Dirigeant #${id} modifié`);
    const s = bd.prepare('SELECT soumission_id FROM do_dirigeants WHERE id = ?').get(id);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverDirigeant(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM do_dirigeants WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE do_dirigeants SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'do_dirigeant_archivee', `Dirigeant #${id} archivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function desarchiverDirigeant(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM do_dirigeants WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE do_dirigeants SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'do_dirigeant_desarchivee', `Dirigeant #${id} désarchivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

// --- Garanties (une fiche par soumission) ------------------------------------
const BASES_GARANTIE = ['reclamations_presentees', 'occurrences'];

function deserialiserGaranties(g) {
  g.avenants = jsonOut(g.avenants);
  return g;
}

function definirGaranties(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM do_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  if (data.base !== undefined && data.base !== null && !BASES_GARANTIE.includes(data.base)) {
    throw new Error('Base de garantie invalide (reclamations_presentees ou occurrences)');
  }
  const avenants = jsonIn(data.avenants);
  const exist = bd.prepare('SELECT id FROM do_garanties WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (exist) {
    bd.prepare(`
      UPDATE do_garanties
      SET limite_par_sinistre = ?, limite_agregat = ?, franchise = ?, base = ?, avenants = ?, prime = ?, archive = 0
      WHERE id = ?
    `).run(data.limite_par_sinistre ?? null, data.limite_agregat ?? null, data.franchise ?? null,
      data.base ?? null, avenants, data.prime ?? null, exist.id);
    auditer(cabinetId, userId, 'do_garanties_modifiees', `Garanties (soumission D&O #${soumissionId}) modifiées`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO do_garanties (cabinet_id, soumission_id, limite_par_sinistre, limite_agregat, franchise, base, avenants, prime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, soumissionId, data.limite_par_sinistre ?? null, data.limite_agregat ?? null,
    data.franchise ?? null, data.base ?? null, avenants, data.prime ?? null);
  auditer(cabinetId, userId, 'do_garanties_definies', `Garanties définies (soumission D&O #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

// --- Antécédents (une fiche par soumission) ----------------------------------
function deserialiserAntecedents(a) {
  a.reclamations_5ans = jsonOut(a.reclamations_5ans);
  a.consentements = jsonOut(a.consentements);
  return a;
}

function definirAntecedents(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM do_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  const vals = {
    assureur_actuel: data.assureur_actuel ?? null,
    numero_police_actuelle: data.numero_police_actuelle ?? null,
    date_expiration_actuelle: data.date_expiration_actuelle ?? null,
    annees_assurance_continue: data.annees_assurance_continue ?? null,
    reclamations_5ans: jsonIn(data.reclamations_5ans),
    poursuites_en_cours: data.poursuites_en_cours ?? null,
    consentements: jsonIn(data.consentements),
  };
  const exist = bd.prepare('SELECT id FROM do_antecedents WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  const cols = Object.keys(vals);
  if (exist) {
    bd.prepare(`
      UPDATE do_antecedents SET ${cols.map((c) => `${c} = ?`).join(', ')}, archive = 0 WHERE id = ?
    `).run(...cols.map((c) => vals[c]), exist.id);
    auditer(cabinetId, userId, 'do_antecedents_modifies', `Antécédents (soumission D&O #${soumissionId}) modifiés`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO do_antecedents (cabinet_id, soumission_id, ${cols.join(', ')})
    VALUES (?, ?, ${cols.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...cols.map((c) => vals[c]));
  auditer(cabinetId, userId, 'do_antecedents_definis', `Antécédents définis (soumission D&O #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

module.exports = {
  STATUTS_SOUMISSION,
  BASES_GARANTIE,
  creerSoumission,
  obtenirSoumission,
  listerSoumissions,
  changerStatutSoumission,
  archiverSoumission,
  desarchiverSoumission,
  creerVersionSoumission,
  versionsSoumission,
  obtenirVersion,
  ajouterDirigeant,
  modifierDirigeant,
  archiverDirigeant,
  desarchiverDirigeant,
  definirGaranties,
  definirAntecedents,
};
