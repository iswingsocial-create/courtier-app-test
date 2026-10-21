/**
 * lib/rc.js — Couche d'accès aux données « RC / responsabilité civile (CGL) » (étape 1/10 RC).
 * Questionnaire de soumission : soumissions, lieux d'exploitation en nombre
 * illimité, garanties par exploitation, antécédents.
 * AUCUNE route/UI ici : ce module est utilisé par les tests (étape 1)
 * et sera utilisé par les routes de l'étape 2.
 * Miroir de lib/biens.js (mêmes conventions, préfixe rc_).
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
  const exploitations = bd.prepare(`
    SELECT * FROM rc_exploitations WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(id, cabinetId).map((e) => {
    const ee = deserialiserExploitation(e);
    const g = bd.prepare(`
      SELECT * FROM rc_garanties WHERE exploitation_id = ? AND cabinet_id = ? AND archive = 0
    `).get(e.id, cabinetId);
    ee.garanties = g ? deserialiserGaranties(g) : null;
    return ee;
  });
  const a = bd.prepare(`
    SELECT * FROM rc_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  return {
    exploitations,
    antecedents: a ? deserialiserAntecedents(a) : null,
  };
}

function creerVersionSoumission(soumissionId, cabinetId, userId) {
  const s = bd.prepare('SELECT * FROM rc_soumissions WHERE id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (!s) return null;
  const maxV = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM rc_soumission_versions WHERE soumission_id = ?')
    .get(soumissionId).m;
  const v = maxV + 1;
  bd.prepare(`
    INSERT INTO rc_soumission_versions (soumission_id, cabinet_id, version, statut, notes, date_effet_souhaitee, donnees, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(soumissionId, cabinetId, v, s.statut, s.notes, s.date_effet_souhaitee,
    JSON.stringify(snapshotSoumission(soumissionId, cabinetId)), userId || null);
  auditer(cabinetId, userId, 'rc_version', `Soumission RC #${soumissionId} → version ${v}`);
  return v;
}

function versionsSoumission(soumissionId, cabinetId) {
  return bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM rc_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.cabinet_id = ? ORDER BY v.version DESC
  `).all(soumissionId, cabinetId);
}

function obtenirVersion(soumissionId, version, cabinetId) {
  const v = bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM rc_soumission_versions v
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
    INSERT INTO rc_soumissions (cabinet_id, client_id, date_effet_souhaitee, notes, cree_par)
    VALUES (?, ?, ?, ?, ?)
  `).run(cabinetId, clientId, dateEffetSouhaitee, notes, userId || null);
  auditer(cabinetId, userId, 'rc_soumission_creee', `Soumission RC #${r.lastInsertRowid}`);
  creerVersionSoumission(r.lastInsertRowid, cabinetId, userId); // v1
  return r.lastInsertRowid;
}

function obtenirSoumission(id, cabinetId, { inclureArchives = false } = {}) {
  const s = bd.prepare(`
    SELECT * FROM rc_soumissions WHERE id = ? AND cabinet_id = ? AND (archive = 0 OR ? = 1)
  `).get(id, cabinetId, inclureArchives ? 1 : 0);
  if (!s) return null;
  const arch = inclureArchives ? '1' : 'archive = 0';
  s.exploitations = bd.prepare(`
    SELECT * FROM rc_exploitations WHERE soumission_id = ? AND cabinet_id = ? AND (${arch}) ORDER BY id
  `).all(id, cabinetId).map((e) => {
    const ee = deserialiserExploitation(e);
    const g = bd.prepare(`
      SELECT * FROM rc_garanties WHERE exploitation_id = ? AND cabinet_id = ? AND (${arch})
    `).get(e.id, cabinetId);
    ee.garanties = g ? deserialiserGaranties(g) : null;
    return ee;
  });
  const a = bd.prepare(`
    SELECT * FROM rc_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.antecedents = a ? deserialiserAntecedents(a) : null;
  return s;
}

function listerSoumissions(cabinetId, { inclureArchives = false, statut = null } = {}) {
  let sql = 'SELECT * FROM rc_soumissions WHERE cabinet_id = ?';
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
    UPDATE rc_soumissions SET statut = ? WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(statut, id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'rc_soumission_statut', `Soumission RC #${id} → ${statut}`);
    creerVersionSoumission(id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE rc_soumissions SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'rc_soumission_archivee', `Soumission RC #${id} archivée`);
  return r.changes > 0;
}

function desarchiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE rc_soumissions SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'rc_soumission_desarchivee', `Soumission RC #${id} désarchivée`);
  return r.changes > 0;
}

// --- Exploitations (lieux d'exploitation, illimités) ------------------------
const COLS_EXPLOITATION = ['adresse', 'ville', 'code_postal', 'type_activite', 'code_classification',
  'description_activites', 'chiffre_affaires', 'masse_salariale', 'nb_employes',
  'superficie_pi2', 'sous_traitants', 'notes',
  // Soumission combinée (étape 8/10) : emplacement maître auquel le lieu se rattache.
  'batiment_id'];

function deserialiserExploitation(e) {
  return e;
}

function ajouterExploitation(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM rc_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  if (!data.adresse) throw new Error('Adresse du lieu d’exploitation requise');
  const vals = COLS_EXPLOITATION.map((col) => (data[col] !== undefined ? data[col] : null));
  const r = bd.prepare(`
    INSERT INTO rc_exploitations (cabinet_id, soumission_id, ${COLS_EXPLOITATION.join(', ')})
    VALUES (?, ?, ${COLS_EXPLOITATION.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'rc_exploitation_ajoutee',
    `Lieu d’exploitation ${data.adresse} (soumission RC #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

function modifierExploitation(id, cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const col of COLS_EXPLOITATION) {
    if (data[col] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(data[col]);
  }
  if (!sets.length) return false;
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE rc_exploitations SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'rc_exploitation_modifiee', `Lieu d’exploitation #${id} modifié`);
    const s = bd.prepare('SELECT soumission_id FROM rc_exploitations WHERE id = ?').get(id);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverExploitation(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM rc_exploitations WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE rc_exploitations SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'rc_exploitation_archivee', `Lieu d’exploitation #${id} archivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function desarchiverExploitation(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM rc_exploitations WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE rc_exploitations SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'rc_exploitation_desarchivee', `Lieu d’exploitation #${id} désarchivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

// --- Garanties (une fiche par lieu d'exploitation) -----------------------------
function deserialiserGaranties(g) {
  g.avenants = jsonOut(g.avenants);
  g.umbrella_polices_base = jsonOut(g.umbrella_polices_base);
  return g;
}

// Colonnes numériques des garanties RC (dont les ajouts de la combinée, étape 5/10).
const COLS_GARANTIES_RC_NUM = ['limite_par_sinistre', 'limite_agregat', 'franchise', 'prime',
  'prejudice_personnel_publicite', 'frais_medicaux_par_personne', 'frais_medicaux_par_sinistre',
  'responsabilite_locative', 'rc_auto_non_proprietaires',
  'umbrella_montant', 'umbrella_retention',
  'produits_travaux_termines_montant', 'pollution_montant'];

function definirGaranties(exploitationId, cabinetId, userId, data) {
  const e = bd.prepare('SELECT id FROM rc_exploitations WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(exploitationId, cabinetId);
  if (!e) throw new Error('Lieu d’exploitation introuvable');
  const avenants = jsonIn(data.avenants);
  const valeurs = {};
  for (const c of COLS_GARANTIES_RC_NUM) valeurs[c] = data[c] ?? null;
  valeurs.formule = data.formule ?? null;
  valeurs.avenants = avenants;
  valeurs.umbrella_polices_base = jsonIn(data.umbrella_polices_base);
  const cols = Object.keys(valeurs);
  const exist = bd.prepare('SELECT id FROM rc_garanties WHERE exploitation_id = ? AND cabinet_id = ?')
    .get(exploitationId, cabinetId);
  let id;
  if (exist) {
    bd.prepare(`
      UPDATE rc_garanties SET ${cols.map((c) => `${c} = ?`).join(', ')}, archive = 0 WHERE id = ?
    `).run(...cols.map((c) => valeurs[c]), exist.id);
    id = exist.id;
    auditer(cabinetId, userId, 'rc_garanties_modifiees', `Garanties du lieu d’exploitation #${exploitationId} modifiées`);
  } else {
    id = bd.prepare(`
      INSERT INTO rc_garanties (cabinet_id, exploitation_id, ${cols.join(', ')})
      VALUES (?, ?, ${cols.map(() => '?').join(', ')})
    `).run(cabinetId, exploitationId, ...cols.map((c) => valeurs[c])).lastInsertRowid;
    auditer(cabinetId, userId, 'rc_garanties_definies', `Garanties définies pour le lieu d’exploitation #${exploitationId}`);
  }
  const s = bd.prepare('SELECT soumission_id FROM rc_exploitations WHERE id = ?').get(exploitationId);
  if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  return id;
}

// --- Antécédents (une fiche par soumission) -----------------------------------
function deserialiserAntecedents(a) {
  a.sinistres_5ans = jsonOut(a.sinistres_5ans);
  a.consentements = jsonOut(a.consentements);
  return a;
}

function definirAntecedents(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM rc_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  const exist = bd.prepare('SELECT * FROM rc_antecedents WHERE soumission_id = ? AND cabinet_id = ?')
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
      UPDATE rc_antecedents SET ${cols.map((c) => `${c} = ?`).join(', ')}, archive = 0 WHERE id = ?
    `).run(...cols.map((c) => vals[c]), exist.id);
    auditer(cabinetId, userId, 'rc_antecedents_modifies', `Antécédents (soumission RC #${soumissionId}) modifiés`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO rc_antecedents (cabinet_id, soumission_id, ${cols.join(', ')})
    VALUES (?, ?, ${cols.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...cols.map((c) => vals[c]));
  auditer(cabinetId, userId, 'rc_antecedents_definis', `Antécédents définis (soumission RC #${soumissionId})`);
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
  ajouterExploitation,
  modifierExploitation,
  archiverExploitation,
  desarchiverExploitation,
  definirGaranties,
  definirAntecedents,
};
