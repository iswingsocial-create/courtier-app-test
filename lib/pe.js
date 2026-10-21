/**
 * lib/pe.js — Couche d'accès aux données « Perte d'exploitation / interruption
 * des affaires » (étape 1/10 perte d'exploitation).
 * Questionnaire de soumission : soumissions, établissements assurés en nombre
 * illimité, garanties par soumission (période d'indemnité, franchise en jours,
 * base d'indemnité), antécédents (interruptions 5 ans).
 * AUCUNE route/UI ici : ce module est utilisé par les tests (étape 1)
 * et sera utilisé par les routes de l'étape 2.
 * Miroir de lib/do.js (mêmes conventions, préfixe pe_).
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
  const etablissements = bd.prepare(`
    SELECT * FROM pe_etablissements WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(id, cabinetId);
  const g = bd.prepare(`
    SELECT * FROM pe_garanties WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  const a = bd.prepare(`
    SELECT * FROM pe_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  return {
    etablissements,
    garanties: g ? deserialiserGaranties(g) : null,
    antecedents: a ? deserialiserAntecedents(a) : null,
  };
}

function creerVersionSoumission(soumissionId, cabinetId, userId) {
  const s = bd.prepare('SELECT * FROM pe_soumissions WHERE id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (!s) return null;
  const maxV = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM pe_soumission_versions WHERE soumission_id = ?')
    .get(soumissionId).m;
  const v = maxV + 1;
  bd.prepare(`
    INSERT INTO pe_soumission_versions (soumission_id, cabinet_id, version, statut, notes, date_effet_souhaitee, donnees, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(soumissionId, cabinetId, v, s.statut, s.notes, s.date_effet_souhaitee,
    JSON.stringify(snapshotSoumission(soumissionId, cabinetId)), userId || null);
  auditer(cabinetId, userId, 'pe_version', `Soumission perte d'exploitation #${soumissionId} → version ${v}`);
  return v;
}

function versionsSoumission(soumissionId, cabinetId) {
  return bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM pe_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.cabinet_id = ? ORDER BY v.version DESC
  `).all(soumissionId, cabinetId);
}

function obtenirVersion(soumissionId, version, cabinetId) {
  const v = bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM pe_soumission_versions v
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
    INSERT INTO pe_soumissions (cabinet_id, client_id, date_effet_souhaitee, notes, cree_par)
    VALUES (?, ?, ?, ?, ?)
  `).run(cabinetId, clientId, dateEffetSouhaitee, notes, userId || null);
  auditer(cabinetId, userId, 'pe_soumission_creee', `Soumission perte d'exploitation #${r.lastInsertRowid}`);
  creerVersionSoumission(r.lastInsertRowid, cabinetId, userId); // v1
  return r.lastInsertRowid;
}

function obtenirSoumission(id, cabinetId, { inclureArchives = false } = {}) {
  const s = bd.prepare(`
    SELECT * FROM pe_soumissions WHERE id = ? AND cabinet_id = ? AND (archive = 0 OR ? = 1)
  `).get(id, cabinetId, inclureArchives ? 1 : 0);
  if (!s) return null;
  const arch = inclureArchives ? '1' : 'archive = 0';
  s.etablissements = bd.prepare(`
    SELECT * FROM pe_etablissements WHERE soumission_id = ? AND cabinet_id = ? AND (${arch}) ORDER BY id
  `).all(id, cabinetId);
  const g = bd.prepare(`
    SELECT * FROM pe_garanties WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.garanties = g ? deserialiserGaranties(g) : null;
  const a = bd.prepare(`
    SELECT * FROM pe_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.antecedents = a ? deserialiserAntecedents(a) : null;
  return s;
}

function listerSoumissions(cabinetId, { inclureArchives = false, statut = null } = {}) {
  let sql = 'SELECT * FROM pe_soumissions WHERE cabinet_id = ?';
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
    UPDATE pe_soumissions SET statut = ? WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(statut, id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'pe_soumission_statut', `Soumission perte d'exploitation #${id} → ${statut}`);
    creerVersionSoumission(id, cabinetId, userId);
  }
  return r.changes > 0;
}

function noterConversion(id, cabinetId, userId, policeId) {
  const ok = changerStatutSoumission(id, cabinetId, userId, 'convertie_police');
  if (ok) {
    auditer(cabinetId, userId, 'pe_soumission_convertie',
      `Soumission perte d'exploitation #${id} convertie en police #${policeId || '?'}`);
  }
  return ok;
}

function archiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE pe_soumissions SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'pe_soumission_archivee', `Soumission perte d'exploitation #${id} archivée`);
  return r.changes > 0;
}

function desarchiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE pe_soumissions SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'pe_soumission_desarchivee', `Soumission perte d'exploitation #${id} désarchivée`);
  return r.changes > 0;
}

// --- Établissements assurés (illimités) -------------------------------------
const COLS_ETABLISSEMENT = ['nom_lieu', 'adresse', 'occupation', 'chiffre_affaires',
  'superficie', 'annee_construction', 'base_valeur',
  // Soumission combinée (étapes 5 et 8/10) : montant PE propre à
  // l'établissement et emplacement maître auquel il se rattache.
  'montant_pe', 'batiment_id'];
const BASES_VALEUR = ['remplacement', 'depreciation'];

function validerEtablissement(data) {
  if (!data.nom_lieu && !data.adresse) {
    throw new Error("Nom du lieu ou adresse de l'établissement requis");
  }
  if (data.base_valeur !== undefined && data.base_valeur !== null && data.base_valeur !== ''
      && !BASES_VALEUR.includes(data.base_valeur)) {
    throw new Error('Base de valeur invalide (remplacement ou depreciation)');
  }
  if (data.chiffre_affaires !== undefined && data.chiffre_affaires !== null
      && Number(data.chiffre_affaires) < 0) {
    throw new Error('Le chiffre d’affaires ne peut pas être négatif');
  }
  if (data.montant_pe !== undefined && data.montant_pe !== null
      && Number(data.montant_pe) < 0) {
    throw new Error('Le montant de perte d\u2019exploitation ne peut pas être négatif');
  }
}

function ajouterEtablissement(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM pe_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  validerEtablissement(data);
  const vals = COLS_ETABLISSEMENT.map((col) => (data[col] !== undefined ? data[col] : null));
  const r = bd.prepare(`
    INSERT INTO pe_etablissements (cabinet_id, soumission_id, ${COLS_ETABLISSEMENT.join(', ')})
    VALUES (?, ?, ${COLS_ETABLISSEMENT.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'pe_etablissement_ajoute',
    `Établissement « ${data.nom_lieu || data.adresse} » (soumission perte d'exploitation #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

function modifierEtablissement(id, cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const col of COLS_ETABLISSEMENT) {
    if (data[col] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(data[col]);
  }
  if (!sets.length) return false;
  const etab = bd.prepare('SELECT * FROM pe_etablissements WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(id, cabinetId);
  if (!etab) return false;
  validerEtablissement({ ...etab, ...data });
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE pe_etablissements SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'pe_etablissement_modifie', `Établissement #${id} modifié`);
    const s = bd.prepare('SELECT soumission_id FROM pe_etablissements WHERE id = ?').get(id);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverEtablissement(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM pe_etablissements WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE pe_etablissements SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'pe_etablissement_archive', `Établissement #${id} archivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function desarchiverEtablissement(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM pe_etablissements WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE pe_etablissements SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'pe_etablissement_desarchive', `Établissement #${id} désarchivé`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

// --- Garanties (une fiche par soumission) ------------------------------------
const PERIODES_INDEMNITE_MOIS = [12, 18, 24];
const BASES_MONTANT = ['benefice_brut', 'marge_brute', 'chiffre_affaires', 'loyers', 'perte_reelle_subie'];
// Formules de perte d'exploitation des envois réels (étape 5/10 combinée).
const FORMULES_PE = ['pertes_loyers', 'benefice_brut', 'formule_etendue'];
const NOMS_FORMULE_PE = {
  pertes_loyers: 'Pertes de loyers',
  benefice_brut: 'Bénéfice brut',
  formule_etendue: 'Formule étendue',
};

function deserialiserGaranties(g) {
  g.avenants = jsonOut(g.avenants);
  return g;
}

function validerGaranties(data) {
  if (data.periode_indemnite_mois !== undefined && data.periode_indemnite_mois !== null
      && !PERIODES_INDEMNITE_MOIS.includes(Number(data.periode_indemnite_mois))) {
    throw new Error('Période d’indemnité invalide (12, 18 ou 24 mois)');
  }
  if (data.base_montant !== undefined && data.base_montant !== null && data.base_montant !== ''
      && !BASES_MONTANT.includes(data.base_montant)) {
    throw new Error('Base d’indemnité invalide (benefice_brut, marge_brute ou chiffre_affaires)');
  }
  if (data.franchise_jours !== undefined && data.franchise_jours !== null
      && Number(data.franchise_jours) < 0) {
    throw new Error('La franchise (en jours) ne peut pas être négative');
  }
  if (data.limite !== undefined && data.limite !== null && Number(data.limite) < 0) {
    throw new Error('La limite ne peut pas être négative');
  }
  if (data.prime !== undefined && data.prime !== null && Number(data.prime) < 0) {
    throw new Error('La prime ne peut pas être négative');
  }
  // Soumission combinée (étape 5/10).
  if (data.regle_proportionnelle !== undefined && data.regle_proportionnelle !== null
      && (Number(data.regle_proportionnelle) < 0 || Number(data.regle_proportionnelle) > 100)) {
    throw new Error('Règle proportionnelle invalide (0 à 100 %)');
  }
  if (data.honoraires_comptables !== undefined && data.honoraires_comptables !== null
      && Number(data.honoraires_comptables) < 0) {
    throw new Error('Les honoraires de comptables ne peuvent pas être négatifs');
  }
  if (data.formule !== undefined && data.formule !== null && data.formule !== ''
      && !FORMULES_PE.includes(data.formule)) {
    throw new Error('Formule de perte d\u2019exploitation invalide');
  }
}

function definirGaranties(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM pe_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  validerGaranties(data);
  const avenants = jsonIn(data.avenants);
  const vals = [
    data.limite ?? null,
    data.periode_indemnite_mois ?? null,
    data.franchise_jours ?? null,
    data.base_montant ?? null,
    avenants,
    data.prime ?? null,
    // Soumission combinée (étape 5/10).
    data.regle_proportionnelle ?? null,
    data.honoraires_comptables ?? null,
    data.formule ?? null,
  ];
  const exist = bd.prepare('SELECT id FROM pe_garanties WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (exist) {
    bd.prepare(`
      UPDATE pe_garanties
      SET limite = ?, periode_indemnite_mois = ?, franchise_jours = ?, base_montant = ?, avenants = ?, prime = ?,
          regle_proportionnelle = ?, honoraires_comptables = ?, formule = ?, archive = 0
      WHERE id = ?
    `).run(...vals, exist.id);
    auditer(cabinetId, userId, 'pe_garanties_modifiees', `Garanties (soumission perte d'exploitation #${soumissionId}) modifiées`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO pe_garanties (cabinet_id, soumission_id, limite, periode_indemnite_mois, franchise_jours, base_montant, avenants, prime,
      regle_proportionnelle, honoraires_comptables, formule)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'pe_garanties_definies', `Garanties définies (soumission perte d'exploitation #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

// --- Antécédents (une fiche par soumission) ----------------------------------
function deserialiserAntecedents(a) {
  a.interruptions_5ans = jsonOut(a.interruptions_5ans);
  a.consentements = jsonOut(a.consentements);
  return a;
}

function definirAntecedents(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM pe_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  const exist = bd.prepare('SELECT * FROM pe_antecedents WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  // Champs communs de la combinée : absents de l'appel = conservés (jamais écrasés par une fiche produit).
  const garde = (cle) => (data[cle] !== undefined ? data[cle] : (exist ? exist[cle] : null));
  const vals = {
    assureur_actuel: data.assureur_actuel ?? null,
    numero_police_actuelle: data.numero_police_actuelle ?? null,
    date_expiration_actuelle: data.date_expiration_actuelle ?? null,
    annees_assurance_continue: data.annees_assurance_continue ?? null,
    interruptions_5ans: jsonIn(data.interruptions_5ans),
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
      UPDATE pe_antecedents SET ${cols.map((c) => `${c} = ?`).join(', ')}, archive = 0 WHERE id = ?
    `).run(...cols.map((c) => vals[c]), exist.id);
    auditer(cabinetId, userId, 'pe_antecedents_modifies', `Antécédents (soumission perte d'exploitation #${soumissionId}) modifiés`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO pe_antecedents (cabinet_id, soumission_id, ${cols.join(', ')})
    VALUES (?, ?, ${cols.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...cols.map((c) => vals[c]));
  auditer(cabinetId, userId, 'pe_antecedents_definis', `Antécédents définis (soumission perte d'exploitation #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

module.exports = {
  STATUTS_SOUMISSION,
  PERIODES_INDEMNITE_MOIS,
  BASES_MONTANT,
  BASES_VALEUR,
  FORMULES_PE, NOMS_FORMULE_PE,
  creerSoumission,
  obtenirSoumission,
  listerSoumissions,
  changerStatutSoumission,
  noterConversion,
  archiverSoumission,
  desarchiverSoumission,
  creerVersionSoumission,
  versionsSoumission,
  obtenirVersion,
  ajouterEtablissement,
  modifierEtablissement,
  archiverEtablissement,
  desarchiverEtablissement,
  definirGaranties,
  definirAntecedents,
};
