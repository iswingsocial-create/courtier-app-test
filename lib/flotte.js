/**
 * lib/flotte.js — Couche d'accès aux données « Flotte automobile » (étape 1/10 flotte).
 * Questionnaire de soumission : soumissions, véhicules et conducteurs en nombre
 * illimité, garanties par soumission (limite RC, franchises collision/versement,
 * avenants FAQ), antécédents (sinistres flotte 5 ans).
 * AUCUNE route/UI ici : ce module est utilisé par les tests (étape 1)
 * et sera utilisé par les routes de l'étape 2.
 * Miroir de lib/pe.js (mêmes conventions, préfixe flotte_) ; champs véhicules /
 * conducteurs calqués sur lib/fpq1.js (NIV, usage, rayon d'opération, classe de
 * permis, expérience, sinistres/infractions en JSON).
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
  const enteteBrut = bd.prepare(`
    SELECT client_id, assureur, numero_police, nb_vehicules, rayon_operation_km,
      usage_dominant, date_effet_souhaitee, date_echeance_visee
    FROM flotte_soumissions WHERE id = ? AND cabinet_id = ?
  `).get(id, cabinetId);
  const vehicules = bd.prepare(`
    SELECT * FROM flotte_vehicules WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(id, cabinetId).map(deserialiserVehicule);
  const conducteurs = bd.prepare(`
    SELECT * FROM flotte_conducteurs WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(id, cabinetId).map(deserialiserConducteur);
  const g = bd.prepare(`
    SELECT * FROM flotte_garanties WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  const a = bd.prepare(`
    SELECT * FROM flotte_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  return {
    entete: enteteBrut || null,
    vehicules,
    conducteurs,
    garanties: g ? deserialiserGaranties(g) : null,
    antecedents: a ? deserialiserAntecedents(a) : null,
  };
}

function creerVersionSoumission(soumissionId, cabinetId, userId) {
  const s = bd.prepare('SELECT * FROM flotte_soumissions WHERE id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (!s) return null;
  const maxV = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM flotte_soumission_versions WHERE soumission_id = ?')
    .get(soumissionId).m;
  const v = maxV + 1;
  bd.prepare(`
    INSERT INTO flotte_soumission_versions (soumission_id, cabinet_id, version, statut, notes, date_effet_souhaitee, donnees, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(soumissionId, cabinetId, v, s.statut, s.notes, s.date_effet_souhaitee,
    JSON.stringify(snapshotSoumission(soumissionId, cabinetId)), userId || null);
  auditer(cabinetId, userId, 'flotte_version', `Soumission flotte #${soumissionId} → version ${v}`);
  return v;
}

function versionsSoumission(soumissionId, cabinetId) {
  return bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM flotte_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.cabinet_id = ? ORDER BY v.version DESC
  `).all(soumissionId, cabinetId);
}

function obtenirVersion(soumissionId, version, cabinetId) {
  const v = bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM flotte_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.version = ? AND v.cabinet_id = ?
  `).get(soumissionId, version, cabinetId);
  if (!v) return null;
  try { v.donnees = JSON.parse(v.donnees); } catch { v.donnees = null; }
  return v;
}

// --- Soumissions --------------------------------------------------------
const STATUTS_SOUMISSION = ['brouillon', 'soumise', 'convertie_police'];
const USAGES_DOMINANTS = ['livraison', 'service', 'transport_marchandises', 'personnel', 'mixte'];

const COLS_SOUMISSION_MODIFIABLES = ['client_id', 'assureur', 'numero_police', 'responsable_id',
  'nb_vehicules', 'rayon_operation_km', 'usage_dominant', 'date_effet_souhaitee',
  'date_echeance_visee', 'notes'];

function validerChampsSoumission(data) {
  if (data.usage_dominant !== undefined && data.usage_dominant !== null && data.usage_dominant !== ''
      && !USAGES_DOMINANTS.includes(data.usage_dominant)) {
    throw new Error('Usage dominant invalide (livraison, service, transport_marchandises, personnel ou mixte)');
  }
  if (data.nb_vehicules !== undefined && data.nb_vehicules !== null && Number(data.nb_vehicules) < 0) {
    throw new Error('Le nombre de véhicules ne peut pas être négatif');
  }
  if (data.rayon_operation_km !== undefined && data.rayon_operation_km !== null && Number(data.rayon_operation_km) < 0) {
    throw new Error('Le rayon d’opération ne peut pas être négatif');
  }
}

function creerSoumission({ cabinetId, userId, clientId = null, assureur = null, numeroPolice = null,
  responsableId = null, nbVehicules = null, rayonOperationKm = null, usageDominant = null,
  dateEffetSouhaitee = null, dateEcheanceVisee = null, notes = null }) {
  validerChampsSoumission({ usage_dominant: usageDominant, nb_vehicules: nbVehicules, rayon_operation_km: rayonOperationKm });
  const r = bd.prepare(`
    INSERT INTO flotte_soumissions (cabinet_id, client_id, assureur, numero_police, responsable_id,
      nb_vehicules, rayon_operation_km, usage_dominant, date_effet_souhaitee, date_echeance_visee, notes, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, clientId, assureur, numeroPolice, responsableId, nbVehicules, rayonOperationKm,
    usageDominant, dateEffetSouhaitee, dateEcheanceVisee, notes, userId || null);
  auditer(cabinetId, userId, 'flotte_soumission_creee', `Soumission flotte #${r.lastInsertRowid}`);
  creerVersionSoumission(r.lastInsertRowid, cabinetId, userId); // v1
  return r.lastInsertRowid;
}

function obtenirSoumission(id, cabinetId, { inclureArchives = false } = {}) {
  const s = bd.prepare(`
    SELECT * FROM flotte_soumissions WHERE id = ? AND cabinet_id = ? AND (archive = 0 OR ? = 1)
  `).get(id, cabinetId, inclureArchives ? 1 : 0);
  if (!s) return null;
  const arch = inclureArchives ? '1' : 'archive = 0';
  s.vehicules = bd.prepare(`
    SELECT * FROM flotte_vehicules WHERE soumission_id = ? AND cabinet_id = ? AND (${arch}) ORDER BY id
  `).all(id, cabinetId).map(deserialiserVehicule);
  s.conducteurs = bd.prepare(`
    SELECT * FROM flotte_conducteurs WHERE soumission_id = ? AND cabinet_id = ? AND (${arch}) ORDER BY id
  `).all(id, cabinetId).map(deserialiserConducteur);
  const g = bd.prepare(`
    SELECT * FROM flotte_garanties WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.garanties = g ? deserialiserGaranties(g) : null;
  const a = bd.prepare(`
    SELECT * FROM flotte_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.antecedents = a ? deserialiserAntecedents(a) : null;
  return s;
}

function listerSoumissions(cabinetId, { inclureArchives = false, statut = null } = {}) {
  let sql = 'SELECT * FROM flotte_soumissions WHERE cabinet_id = ?';
  const params = [cabinetId];
  if (!inclureArchives) sql += ' AND archive = 0';
  if (statut) { sql += ' AND statut = ?'; params.push(statut); }
  sql += ' ORDER BY id DESC';
  return bd.prepare(sql).all(...params);
}

function modifierSoumission(id, cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const col of COLS_SOUMISSION_MODIFIABLES) {
    if (data[col] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(data[col]);
  }
  if (!sets.length) return false;
  const s = bd.prepare('SELECT * FROM flotte_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(id, cabinetId);
  if (!s) return false;
  validerChampsSoumission({ ...s, ...data });
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE flotte_soumissions SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'flotte_soumission_modifiee', `Soumission flotte #${id} modifiée`);
    creerVersionSoumission(id, cabinetId, userId);
  }
  return r.changes > 0;
}

function changerStatutSoumission(id, cabinetId, userId, statut) {
  if (!STATUTS_SOUMISSION.includes(statut)) throw new Error('Statut de soumission invalide');
  const r = bd.prepare(`
    UPDATE flotte_soumissions SET statut = ? WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(statut, id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'flotte_soumission_statut', `Soumission flotte #${id} → ${statut}`);
    creerVersionSoumission(id, cabinetId, userId);
  }
  return r.changes > 0;
}

function noterConversion(id, cabinetId, userId, policeId) {
  const ok = changerStatutSoumission(id, cabinetId, userId, 'convertie_police');
  if (ok) {
    auditer(cabinetId, userId, 'flotte_soumission_convertie',
      `Soumission flotte #${id} convertie en police #${policeId || '?'}`);
  }
  return ok;
}

function archiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE flotte_soumissions SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'flotte_soumission_archivee', `Soumission flotte #${id} archivée`);
  return r.changes > 0;
}

function desarchiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE flotte_soumissions SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'flotte_soumission_desarchivee', `Soumission flotte #${id} désarchivée`);
  return r.changes > 0;
}

// --- Véhicules (illimités) ---------------------------------------------------
const TYPES_VEHICULE = ['camion', 'automobile', 'remorque', 'equipement'];
const USAGES_VEHICULE = ['livraison', 'service', 'transport_marchandises', 'personnel'];
const COLS_VEHICULE = ['niv', 'annee', 'marque', 'modele', 'type_vehicule', 'usage',
  'rayon_operation_km', 'lieu_remisage', 'valeur', 'annee_acquisition',
  'conducteur_principal_id', 'conducteur_principal_nom', 'equipements_speciaux'];
const JSON_VEHICULE = new Set(['equipements_speciaux']);

function deserialiserVehicule(v) {
  for (const k of JSON_VEHICULE) v[k] = jsonOut(v[k]);
  return v;
}

function validerVehicule(data) {
  if (data.type_vehicule !== undefined && data.type_vehicule !== null && data.type_vehicule !== ''
      && !TYPES_VEHICULE.includes(data.type_vehicule)) {
    throw new Error('Type de véhicule invalide (camion, automobile, remorque ou equipement)');
  }
  if (data.usage !== undefined && data.usage !== null && data.usage !== ''
      && !USAGES_VEHICULE.includes(data.usage)) {
    throw new Error('Usage du véhicule invalide (livraison, service, transport_marchandises ou personnel)');
  }
  if (data.valeur !== undefined && data.valeur !== null && Number(data.valeur) < 0) {
    throw new Error('La valeur du véhicule ne peut pas être négative');
  }
  if (data.rayon_operation_km !== undefined && data.rayon_operation_km !== null
      && Number(data.rayon_operation_km) < 0) {
    throw new Error('Le rayon d’opération du véhicule ne peut pas être négatif');
  }
}

function ajouterVehicule(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM flotte_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  validerVehicule(data);
  const vals = COLS_VEHICULE.map((col) => {
    let v = data[col] !== undefined ? data[col] : null;
    if (JSON_VEHICULE.has(col)) v = jsonIn(v);
    return v;
  });
  const r = bd.prepare(`
    INSERT INTO flotte_vehicules (cabinet_id, soumission_id, ${COLS_VEHICULE.join(', ')})
    VALUES (?, ?, ${COLS_VEHICULE.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'flotte_vehicule_ajoute',
    `Véhicule ${data.annee || ''} ${data.marque || ''} ${data.modele || ''} (soumission flotte #${soumissionId})`);
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
    sets.push(`${col} = ?`);
    params.push(v);
  }
  if (!sets.length) return false;
  const veh = bd.prepare('SELECT * FROM flotte_vehicules WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(id, cabinetId);
  if (!veh) return false;
  validerVehicule({ ...veh, ...data });
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE flotte_vehicules SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'flotte_vehicule_modifie', `Véhicule flotte #${id} modifié`);
    const s = bd.prepare('SELECT soumission_id FROM flotte_vehicules WHERE id = ?').get(id);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverVehicule(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM flotte_vehicules WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE flotte_vehicules SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'flotte_vehicule_archive', `Véhicule flotte #${id} archivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function desarchiverVehicule(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM flotte_vehicules WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE flotte_vehicules SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'flotte_vehicule_desarchive', `Véhicule flotte #${id} désarchivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

// --- Conducteurs (illimités) ---------------------------------------------------
const COLS_CONDUCTEUR = ['nom', 'prenom', 'date_naissance', 'age', 'numero_permis',
  'classe_permis', 'annees_experience', 'annees_experience_lourds', 'date_embauche',
  'sinistres_5ans', 'infractions_3ans', 'formations'];
const JSON_CONDUCTEUR = new Set(['sinistres_5ans', 'infractions_3ans', 'formations']);

function deserialiserConducteur(c) {
  for (const k of JSON_CONDUCTEUR) c[k] = jsonOut(c[k]);
  return c;
}

function validerConducteur(data) {
  if (data.annees_experience !== undefined && data.annees_experience !== null
      && Number(data.annees_experience) < 0) {
    throw new Error('Les années d’expérience ne peuvent pas être négatives');
  }
  if (data.annees_experience_lourds !== undefined && data.annees_experience_lourds !== null
      && Number(data.annees_experience_lourds) < 0) {
    throw new Error('Les années d’expérience véhicules lourds ne peuvent pas être négatives');
  }
}

function ajouterConducteur(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM flotte_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  if (!data.nom || !data.prenom) throw new Error('Nom et prénom du conducteur requis');
  validerConducteur(data);
  const vals = COLS_CONDUCTEUR.map((col) => {
    let v = data[col] !== undefined ? data[col] : null;
    if (JSON_CONDUCTEUR.has(col)) v = jsonIn(v);
    return v;
  });
  const r = bd.prepare(`
    INSERT INTO flotte_conducteurs (cabinet_id, soumission_id, ${COLS_CONDUCTEUR.join(', ')})
    VALUES (?, ?, ${COLS_CONDUCTEUR.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'flotte_conducteur_ajoute',
    `Conducteur ${data.prenom} ${data.nom} (soumission flotte #${soumissionId})`);
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
    sets.push(`${col} = ?`);
    params.push(v);
  }
  if (!sets.length) return false;
  const cond = bd.prepare('SELECT * FROM flotte_conducteurs WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(id, cabinetId);
  if (!cond) return false;
  validerConducteur({ ...cond, ...data });
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE flotte_conducteurs SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'flotte_conducteur_modifie', `Conducteur flotte #${id} modifié`);
    const s = bd.prepare('SELECT soumission_id FROM flotte_conducteurs WHERE id = ?').get(id);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverConducteur(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM flotte_conducteurs WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE flotte_conducteurs SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'flotte_conducteur_archive', `Conducteur flotte #${id} archivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function desarchiverConducteur(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM flotte_conducteurs WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE flotte_conducteurs SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'flotte_conducteur_desarchive', `Conducteur flotte #${id} désarchivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

// --- Garanties (une fiche par soumission) ------------------------------------
// Avenants FAQ québécois : mêmes clés courtes que FPQ1 (lib/fpq1.js /
// routes/auto.js) — faq43 valeur à neuf, faq20 privation de jouissance (frais
// de déplacement), faq27 véhicule n'appartenant pas à l'assuré (location),
// faq34 assurance de personnes (indemnités d'accident), faq5a crédit-bail.
// La « protection du conducteur » passe par faq34.
const AVENANTS_FAQ = ['faq43', 'faq20', 'faq27', 'faq34', 'faq5a'];

function deserialiserGaranties(g) {
  g.avenants = jsonOut(g.avenants);
  return g;
}

function validerGaranties(data) {
  for (const [champ, libelle] of [['limite_rc', 'La limite de responsabilité civile'],
    ['franchise_collision', 'La franchise collision'],
    ['franchise_versement', 'La franchise versement'],
    ['prime', 'La prime']]) {
    if (data[champ] !== undefined && data[champ] !== null && Number(data[champ]) < 0) {
      throw new Error(`${libelle} ne peut pas être négative`);
    }
  }
}

function definirGaranties(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM flotte_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  validerGaranties(data);
  const avenants = jsonIn(data.avenants);
  const vals = [
    data.limite_rc ?? null,
    data.franchise_collision ?? null,
    data.franchise_versement ?? null,
    avenants,
    data.prime ?? null,
  ];
  const exist = bd.prepare('SELECT id FROM flotte_garanties WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (exist) {
    bd.prepare(`
      UPDATE flotte_garanties
      SET limite_rc = ?, franchise_collision = ?, franchise_versement = ?, avenants = ?, prime = ?, archive = 0
      WHERE id = ?
    `).run(...vals, exist.id);
    auditer(cabinetId, userId, 'flotte_garanties_modifiees', `Garanties (soumission flotte #${soumissionId}) modifiées`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO flotte_garanties (cabinet_id, soumission_id, limite_rc, franchise_collision, franchise_versement, avenants, prime)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'flotte_garanties_definies', `Garanties définies (soumission flotte #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

// --- Antécédents (une fiche par soumission) ----------------------------------
function deserialiserAntecedents(a) {
  a.sinistres_flotte_5ans = jsonOut(a.sinistres_flotte_5ans);
  a.consentements = jsonOut(a.consentements);
  return a;
}

function definirAntecedents(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM flotte_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  if (data.ratio_pertes !== undefined && data.ratio_pertes !== null && Number(data.ratio_pertes) < 0) {
    throw new Error('Le ratio de pertes ne peut pas être négatif');
  }
  const vals = {
    assureur_actuel: data.assureur_actuel ?? null,
    numero_police_actuelle: data.numero_police_actuelle ?? null,
    date_expiration_actuelle: data.date_expiration_actuelle ?? null,
    annees_assurance_flotte_continue: data.annees_assurance_flotte_continue ?? null,
    sinistres_flotte_5ans: jsonIn(data.sinistres_flotte_5ans),
    ratio_pertes: data.ratio_pertes ?? null,
    refus_annulation_ant: data.refus_annulation_ant ? 1 : 0,
    refus_annulation_details: data.refus_annulation_details ?? null,
    consentements: jsonIn(data.consentements),
  };
  const exist = bd.prepare('SELECT id FROM flotte_antecedents WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  const cols = Object.keys(vals);
  if (exist) {
    bd.prepare(`
      UPDATE flotte_antecedents SET ${cols.map((c) => `${c} = ?`).join(', ')}, archive = 0 WHERE id = ?
    `).run(...cols.map((c) => vals[c]), exist.id);
    auditer(cabinetId, userId, 'flotte_antecedents_modifies', `Antécédents (soumission flotte #${soumissionId}) modifiés`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO flotte_antecedents (cabinet_id, soumission_id, ${cols.join(', ')})
    VALUES (?, ?, ${cols.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...cols.map((c) => vals[c]));
  auditer(cabinetId, userId, 'flotte_antecedents_definis', `Antécédents définis (soumission flotte #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

// --- Seed de démonstration (seulement si absent) -------------------------------
// Entreprise « Transport Lapointe inc. » (Laval) : 4 véhicules (2 camions de
// livraison, 1 automobile de service, 1 remorque), 3 conducteurs, garanties
// (responsabilité 2 M$, collision franchise 1 000 $, valeur à neuf sur les
// camions), 1 sinistre flotte 2023. Idempotent : si une soumission flotte
// existe déjà pour cette entreprise dans le cabinet, elle est retournée
// telle quelle, sans doublon.
function semerSoumissionDemo(cabinetId, userId) {
  let client = bd.prepare(`
    SELECT id FROM clients WHERE cabinet_id = ? AND raison_sociale = ?
  `).get(cabinetId, 'Transport Lapointe inc.');
  if (client) {
    const exist = bd.prepare(`
      SELECT id FROM flotte_soumissions WHERE cabinet_id = ? AND client_id = ? AND archive = 0 ORDER BY id LIMIT 1
    `).get(cabinetId, client.id);
    if (exist) return exist.id;
  } else {
    const r = bd.prepare(`
      INSERT INTO clients (cabinet_id, raison_sociale, neq, secteur_activite, prenom, nom, titre_contact,
        courriel, telephone, adresse, ville, code_postal, langue, notes, responsable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cabinetId, 'Transport Lapointe inc.', '1145678901', 'Transport et livraison',
      'Jean-François', 'Lapointe', 'Président', 'jf.lapointe@transportlapointe.ca', '450-555-0198',
      '2450 boulevard Industriel', 'Laval', 'H7S 1P9', 'FR',
      'Transport local et régional, livraison de marchandises générales.', userId || null);
    client = { id: r.lastInsertRowid };
  }
  const soumissionId = creerSoumission({
    cabinetId, userId, clientId: client.id,
    assureur: 'Intact Assurance', responsableId: userId || null,
    nbVehicules: 4, rayonOperationKm: 160, usageDominant: 'livraison',
    notes: 'Renouvellement flotte — valeur à neuf demandée sur les deux camions de livraison.',
  });
  const c1 = ajouterConducteur(soumissionId, cabinetId, userId, {
    nom: 'Lapointe', prenom: 'Jean-François', date_naissance: '1978-04-12',
    numero_permis: 'L152-040478-01', classe_permis: '3', annees_experience: 24,
    annees_experience_lourds: 18, date_embauche: '2009-06-01',
    sinistres_5ans: [], infractions_3ans: [],
    formations: [{ formation: 'Conduite préventive', date: '2024-05-10', organisme: 'Centre de formation en transport' }],
  });
  const c2 = ajouterConducteur(soumissionId, cabinetId, userId, {
    nom: 'Gagnon', prenom: 'Marc', date_naissance: '1985-09-23',
    numero_permis: 'G556-230985-02', classe_permis: '3', annees_experience: 15,
    annees_experience_lourds: 11, date_embauche: '2016-03-14',
    sinistres_5ans: [{ date: '2023-07-19', description: 'Accrochage en reculant dans une cour de livraison, dommages au pare-chocs arrière', montant: 4200, responsabilite: 'partagee' }],
    infractions_3ans: [{ date: '2024-02-02', type: 'Excès de vitesse', description: 'Excès de vitesse 20 km/h en zone urbaine', points: 3 }],
    formations: [{ formation: 'Conduite préventive', date: '2024-05-10', organisme: 'Centre de formation en transport' }],
  });
  const c3 = ajouterConducteur(soumissionId, cabinetId, userId, {
    nom: 'Tremblay', prenom: 'Sophie', date_naissance: '1992-01-30',
    numero_permis: 'T621-300192-03', classe_permis: '5', annees_experience: 9,
    annees_experience_lourds: 0, date_embauche: '2021-08-23',
    sinistres_5ans: [], infractions_3ans: [], formations: [],
  });
  ajouterVehicule(soumissionId, cabinetId, userId, {
    niv: '1FTBW3CM5KKB12345', annee: 2022, marque: 'Ford', modele: 'Transit 250',
    type_vehicule: 'camion', usage: 'livraison', rayon_operation_km: 160,
    lieu_remisage: '2450 boulevard Industriel, Laval', valeur: 62000, annee_acquisition: 2022,
    conducteur_principal_id: c1,
    equipements_speciaux: [{ description: 'Hayon élévateur', valeur: 6500 }],
  });
  ajouterVehicule(soumissionId, cabinetId, userId, {
    niv: '3C6TRVBG8ME512340', annee: 2021, marque: 'Ram', modele: 'ProMaster 3500',
    type_vehicule: 'camion', usage: 'livraison', rayon_operation_km: 200,
    lieu_remisage: '2450 boulevard Industriel, Laval', valeur: 54000, annee_acquisition: 2021,
    conducteur_principal_id: c2,
    equipements_speciaux: [{ description: 'Compartiment réfrigéré', valeur: 12000 }],
  });
  ajouterVehicule(soumissionId, cabinetId, userId, {
    niv: '2T1BURHE8JC045678', annee: 2020, marque: 'Toyota', modele: 'Corolla',
    type_vehicule: 'automobile', usage: 'service', rayon_operation_km: 100,
    lieu_remisage: '2450 boulevard Industriel, Laval', valeur: 18500, annee_acquisition: 2020,
    conducteur_principal_id: c3, equipements_speciaux: [],
  });
  ajouterVehicule(soumissionId, cabinetId, userId, {
    niv: '1T9UT2825NA334455', annee: 2019, marque: 'Manac', modele: 'Remorque fermée 28 pi',
    type_vehicule: 'remorque', usage: 'transport_marchandises', rayon_operation_km: 160,
    lieu_remisage: '2450 boulevard Industriel, Laval', valeur: 21000, annee_acquisition: 2019,
    conducteur_principal_nom: 'Selon affectation', equipements_speciaux: [],
  });
  definirGaranties(soumissionId, cabinetId, userId, {
    limite_rc: 2000000, franchise_collision: 1000, franchise_versement: 1000,
    avenants: { faq43: 1, faq27: 1, faq20: 1, faq34: 1 }, prime: 9850.00,
  });
  definirAntecedents(soumissionId, cabinetId, userId, {
    assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'FLT-2023-7781',
    annees_assurance_flotte_continue: 6,
    sinistres_flotte_5ans: [{ date: '2023-07-19', description: 'Accrochage en manœuvre de recul (camion Ram ProMaster), pare-chocs et porte arrière', montant: 4200 }],
    ratio_pertes: 18.5, refus_annulation_ant: 0,
    consentements: { dossier_saaq: { accepte: true, date: new Date().toISOString().slice(0, 10) } },
  });
  auditer(cabinetId, userId, 'flotte_demo_semee', `Soumission flotte démo « Transport Lapointe inc. » #${soumissionId}`);
  return soumissionId;
}

module.exports = {
  STATUTS_SOUMISSION,
  USAGES_DOMINANTS,
  TYPES_VEHICULE,
  USAGES_VEHICULE,
  AVENANTS_FAQ,
  creerSoumission,
  obtenirSoumission,
  listerSoumissions,
  modifierSoumission,
  changerStatutSoumission,
  noterConversion,
  archiverSoumission,
  desarchiverSoumission,
  creerVersionSoumission,
  versionsSoumission,
  obtenirVersion,
  ajouterVehicule,
  modifierVehicule,
  archiverVehicule,
  desarchiverVehicule,
  ajouterConducteur,
  modifierConducteur,
  archiverConducteur,
  desarchiverConducteur,
  definirGaranties,
  definirAntecedents,
  semerSoumissionDemo,
};
