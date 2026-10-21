/**
 * lib/cautionnement.js — Couche d'accès aux données « Cautionnement »
 * (étape 1/10 cautionnement).
 * Questionnaire de soumission : soumissions, obligations (cautionnements
 * demandés) en nombre illimité, ligne de cautionnement par soumission
 * (limite globale / par projet, fonds de roulement, valeur nette),
 * antécédents (réclamations contre des cautionnements 5 ans).
 * AUCUNE route/UI ici : ce module est utilisé par les tests (étape 1)
 * et sera utilisé par les routes de l'étape 2.
 * Miroir de lib/flotte.js (mêmes conventions, préfixe caut_).
 *
 * Le cautionnement n'est PAS une assurance : garantie à trois parties —
 * la caution (assureur), le principal/débiteur (l'entrepreneur, entreprise
 * cliente) et le bénéficiaire/obligé (le donneur d'ouvrage). La caution qui
 * paie le bénéficiaire se retourne contre le principal (convention
 * d'indemnisation signée par les actionnaires).
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
    SELECT client_id, assureur, numero_police, secteur_activite, annee_fondation,
      chiffre_affaires, nb_employes, date_effet_souhaitee, date_echeance_visee
    FROM caut_soumissions WHERE id = ? AND cabinet_id = ?
  `).get(id, cabinetId);
  const obligations = bd.prepare(`
    SELECT * FROM caut_obligations WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id
  `).all(id, cabinetId);
  const g = bd.prepare(`
    SELECT * FROM caut_garanties WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  const a = bd.prepare(`
    SELECT * FROM caut_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND archive = 0
  `).get(id, cabinetId);
  return {
    entete: enteteBrut || null,
    obligations,
    garanties: g || null,
    antecedents: a ? deserialiserAntecedents(a) : null,
  };
}

function creerVersionSoumission(soumissionId, cabinetId, userId) {
  const s = bd.prepare('SELECT * FROM caut_soumissions WHERE id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (!s) return null;
  const maxV = bd.prepare('SELECT COALESCE(MAX(version), 0) AS m FROM caut_soumission_versions WHERE soumission_id = ?')
    .get(soumissionId).m;
  const v = maxV + 1;
  bd.prepare(`
    INSERT INTO caut_soumission_versions (soumission_id, cabinet_id, version, statut, notes, date_effet_souhaitee, donnees, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(soumissionId, cabinetId, v, s.statut, s.notes, s.date_effet_souhaitee,
    JSON.stringify(snapshotSoumission(soumissionId, cabinetId)), userId || null);
  auditer(cabinetId, userId, 'caut_version', `Soumission cautionnement #${soumissionId} → version ${v}`);
  return v;
}

function versionsSoumission(soumissionId, cabinetId) {
  return bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM caut_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.cabinet_id = ? ORDER BY v.version DESC
  `).all(soumissionId, cabinetId);
}

function obtenirVersion(soumissionId, version, cabinetId) {
  const v = bd.prepare(`
    SELECT v.*, u.nom AS auteur FROM caut_soumission_versions v
    LEFT JOIN users u ON u.id = v.cree_par
    WHERE v.soumission_id = ? AND v.version = ? AND v.cabinet_id = ?
  `).get(soumissionId, version, cabinetId);
  if (!v) return null;
  try { v.donnees = JSON.parse(v.donnees); } catch { v.donnees = null; }
  return v;
}

// --- Soumissions --------------------------------------------------------
const STATUTS_SOUMISSION = ['brouillon', 'soumise', 'convertie_police'];

const COLS_SOUMISSION_MODIFIABLES = ['client_id', 'assureur', 'numero_police', 'responsable_id',
  'secteur_activite', 'annee_fondation', 'chiffre_affaires', 'nb_employes',
  'date_effet_souhaitee', 'date_echeance_visee', 'notes'];

function validerChampsSoumission(data) {
  if (data.annee_fondation !== undefined && data.annee_fondation !== null && data.annee_fondation !== '') {
    const a = Number(data.annee_fondation);
    if (!Number.isInteger(a) || a < 1800 || a > 2100) {
      throw new Error('Année de fondation invalide');
    }
  }
  if (data.chiffre_affaires !== undefined && data.chiffre_affaires !== null && Number(data.chiffre_affaires) < 0) {
    throw new Error('Le chiffre d’affaires ne peut pas être négatif');
  }
  if (data.nb_employes !== undefined && data.nb_employes !== null && Number(data.nb_employes) < 0) {
    throw new Error('Le nombre d’employés ne peut pas être négatif');
  }
}

function creerSoumission({ cabinetId, userId, clientId = null, assureur = null, numeroPolice = null,
  responsableId = null, secteurActivite = null, anneeFondation = null, chiffreAffaires = null,
  nbEmployes = null, dateEffetSouhaitee = null, dateEcheanceVisee = null, notes = null }) {
  validerChampsSoumission({ annee_fondation: anneeFondation, chiffre_affaires: chiffreAffaires, nb_employes: nbEmployes });
  const r = bd.prepare(`
    INSERT INTO caut_soumissions (cabinet_id, client_id, assureur, numero_police, responsable_id,
      secteur_activite, annee_fondation, chiffre_affaires, nb_employes, date_effet_souhaitee,
      date_echeance_visee, notes, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, clientId, assureur, numeroPolice, responsableId, secteurActivite, anneeFondation,
    chiffreAffaires, nbEmployes, dateEffetSouhaitee, dateEcheanceVisee, notes, userId || null);
  auditer(cabinetId, userId, 'caut_soumission_creee', `Soumission cautionnement #${r.lastInsertRowid}`);
  creerVersionSoumission(r.lastInsertRowid, cabinetId, userId); // v1
  return r.lastInsertRowid;
}

function obtenirSoumission(id, cabinetId, { inclureArchives = false } = {}) {
  const s = bd.prepare(`
    SELECT * FROM caut_soumissions WHERE id = ? AND cabinet_id = ? AND (archive = 0 OR ? = 1)
  `).get(id, cabinetId, inclureArchives ? 1 : 0);
  if (!s) return null;
  const arch = inclureArchives ? '1' : 'archive = 0';
  s.obligations = bd.prepare(`
    SELECT * FROM caut_obligations WHERE soumission_id = ? AND cabinet_id = ? AND (${arch}) ORDER BY id
  `).all(id, cabinetId);
  const g = bd.prepare(`
    SELECT * FROM caut_garanties WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.garanties = g || null;
  const a = bd.prepare(`
    SELECT * FROM caut_antecedents WHERE soumission_id = ? AND cabinet_id = ? AND (${arch})
  `).get(id, cabinetId);
  s.antecedents = a ? deserialiserAntecedents(a) : null;
  return s;
}

function listerSoumissions(cabinetId, { inclureArchives = false, statut = null } = {}) {
  let sql = 'SELECT * FROM caut_soumissions WHERE cabinet_id = ?';
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
  const s = bd.prepare('SELECT * FROM caut_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(id, cabinetId);
  if (!s) return false;
  validerChampsSoumission({ ...s, ...data });
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE caut_soumissions SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'caut_soumission_modifiee', `Soumission cautionnement #${id} modifiée`);
    creerVersionSoumission(id, cabinetId, userId);
  }
  return r.changes > 0;
}

function changerStatutSoumission(id, cabinetId, userId, statut) {
  if (!STATUTS_SOUMISSION.includes(statut)) throw new Error('Statut de soumission invalide');
  const r = bd.prepare(`
    UPDATE caut_soumissions SET statut = ? WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(statut, id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'caut_soumission_statut', `Soumission cautionnement #${id} → ${statut}`);
    creerVersionSoumission(id, cabinetId, userId);
  }
  return r.changes > 0;
}

function noterConversion(id, cabinetId, userId, policeId) {
  const ok = changerStatutSoumission(id, cabinetId, userId, 'convertie_police');
  if (ok) {
    auditer(cabinetId, userId, 'caut_soumission_convertie',
      `Soumission cautionnement #${id} convertie en police #${policeId || '?'}`);
  }
  return ok;
}

function archiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE caut_soumissions SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'caut_soumission_archivee', `Soumission cautionnement #${id} archivée`);
  return r.changes > 0;
}

function desarchiverSoumission(id, cabinetId, userId) {
  const r = bd.prepare(`
    UPDATE caut_soumissions SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) auditer(cabinetId, userId, 'caut_soumission_desarchivee', `Soumission cautionnement #${id} désarchivée`);
  return r.changes > 0;
}

// --- Obligations / cautionnements demandés (illimités) -----------------------
// Types : soumission (bid bond), execution (performance — typiquement 50 % du
// contrat), paiement_mo (paiement de la main-d'œuvre et des matériaux),
// rbq (licence RBQ : 20 000 $ spécialisés / 40 000 $ généraux), autre.
const TYPES_OBLIGATION = ['soumission', 'execution', 'paiement_mo', 'rbq', 'autre'];
const COLS_OBLIGATION = ['type', 'beneficiaire', 'description_projet', 'montant_contrat',
  'montant_cautionnement', 'taux_pct', 'prime_estimee', 'date_debut', 'duree_mois'];

function validerObligation(data) {
  if (!data.beneficiaire && !data.description_projet) {
    throw new Error('Bénéficiaire ou description du projet requis');
  }
  if (data.type !== undefined && data.type !== null && data.type !== ''
      && !TYPES_OBLIGATION.includes(data.type)) {
    throw new Error('Type de cautionnement invalide (soumission, execution, paiement_mo, rbq ou autre)');
  }
  for (const champ of ['montant_contrat', 'montant_cautionnement', 'taux_pct', 'prime_estimee']) {
    if (data[champ] !== undefined && data[champ] !== null && Number(data[champ]) < 0) {
      throw new Error('Les montants et le taux ne peuvent pas être négatifs');
    }
  }
  if (data.duree_mois !== undefined && data.duree_mois !== null && Number(data.duree_mois) < 0) {
    throw new Error('La durée ne peut pas être négative');
  }
}

function ajouterObligation(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM caut_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  validerObligation(data);
  const vals = COLS_OBLIGATION.map((col) => (data[col] !== undefined ? data[col] : null));
  const r = bd.prepare(`
    INSERT INTO caut_obligations (cabinet_id, soumission_id, ${COLS_OBLIGATION.join(', ')})
    VALUES (?, ?, ${COLS_OBLIGATION.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'caut_obligation_ajoutee',
    `Cautionnement « ${data.type || 'autre'} » pour ${data.beneficiaire || ''} (soumission cautionnement #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

function modifierObligation(id, cabinetId, userId, data) {
  const sets = [];
  const params = [];
  for (const col of COLS_OBLIGATION) {
    if (data[col] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(data[col]);
  }
  if (!sets.length) return false;
  const ob = bd.prepare('SELECT * FROM caut_obligations WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(id, cabinetId);
  if (!ob) return false;
  validerObligation({ ...ob, ...data });
  params.push(id, cabinetId);
  const r = bd.prepare(`
    UPDATE caut_obligations SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(...params);
  if (r.changes) {
    auditer(cabinetId, userId, 'caut_obligation_modifiee', `Obligation cautionnement #${id} modifiée`);
    const s = bd.prepare('SELECT soumission_id FROM caut_obligations WHERE id = ?').get(id);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function archiverObligation(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM caut_obligations WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE caut_obligations SET archive = 1 WHERE id = ? AND cabinet_id = ? AND archive = 0
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'caut_obligation_archivee', `Obligation cautionnement #${id} archivée`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

function desarchiverObligation(id, cabinetId, userId) {
  const s = bd.prepare('SELECT soumission_id FROM caut_obligations WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
  const r = bd.prepare(`
    UPDATE caut_obligations SET archive = 0 WHERE id = ? AND cabinet_id = ? AND archive = 1
  `).run(id, cabinetId);
  if (r.changes) {
    auditer(cabinetId, userId, 'caut_obligation_desarchivee', `Obligation cautionnement #${id} désarchivée`);
    if (s) creerVersionSoumission(s.soumission_id, cabinetId, userId);
  }
  return r.changes > 0;
}

// --- Ligne de cautionnement (une fiche par soumission) -----------------------
// La ligne = la capacité accordée par la caution après analyse des états
// financiers du principal. limite_globale : capacité totale ; limite_par_projet :
// capacité pour un seul contrat (jamais supérieure à la globale) ;
// fonds_roulement : critère clé de l'analyse de la caution.
function validerLigne(data) {
  for (const [champ, libelle] of [['limite_globale', 'La limite globale'],
    ['limite_par_projet', 'La limite par projet'],
    ['fonds_roulement', 'Le fonds de roulement'],
    ['valeur_nette', 'La valeur nette'],
    ['prime', 'La prime']]) {
    if (data[champ] !== undefined && data[champ] !== null && data[champ] !== ''
        && Number(data[champ]) < 0) {
      throw new Error(`${libelle} ne peut pas être négative`);
    }
  }
  const glob = data.limite_globale !== undefined && data.limite_globale !== null && data.limite_globale !== ''
    ? Number(data.limite_globale) : null;
  const proj = data.limite_par_projet !== undefined && data.limite_par_projet !== null && data.limite_par_projet !== ''
    ? Number(data.limite_par_projet) : null;
  if (glob !== null && proj !== null && proj > glob) {
    throw new Error('La limite par projet ne peut pas dépasser la limite globale');
  }
}

function definirGaranties(soumissionId, cabinetId, userId, data) {
  const s = bd.prepare('SELECT id FROM caut_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  validerLigne(data);
  const vals = [
    data.limite_globale ?? null,
    data.limite_par_projet ?? null,
    data.fonds_roulement ?? null,
    data.valeur_nette ?? null,
    data.prime ?? null,
  ];
  const exist = bd.prepare('SELECT id FROM caut_garanties WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  if (exist) {
    bd.prepare(`
      UPDATE caut_garanties
      SET limite_globale = ?, limite_par_projet = ?, fonds_roulement = ?, valeur_nette = ?, prime = ?, archive = 0
      WHERE id = ?
    `).run(...vals, exist.id);
    auditer(cabinetId, userId, 'caut_garanties_modifiees', `Ligne de cautionnement (soumission cautionnement #${soumissionId}) modifiée`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO caut_garanties (cabinet_id, soumission_id, limite_globale, limite_par_projet, fonds_roulement, valeur_nette, prime)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, soumissionId, ...vals);
  auditer(cabinetId, userId, 'caut_garanties_definies', `Ligne de cautionnement définie (soumission cautionnement #${soumissionId})`);
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
  const s = bd.prepare('SELECT id FROM caut_soumissions WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(soumissionId, cabinetId);
  if (!s) throw new Error('Soumission introuvable');
  const vals = {
    assureur_actuel: data.assureur_actuel ?? null,
    numero_ligne_actuelle: data.numero_ligne_actuelle ?? null,
    date_expiration_actuelle: data.date_expiration_actuelle ?? null,
    annees_cautionnement_continu: data.annees_cautionnement_continu ?? null,
    reclamations_5ans: jsonIn(data.reclamations_5ans),
    refus_resiliation_ant: data.refus_resiliation_ant ? 1 : 0,
    refus_resiliation_details: data.refus_resiliation_details ?? null,
    consentements: jsonIn(data.consentements),
  };
  const exist = bd.prepare('SELECT id FROM caut_antecedents WHERE soumission_id = ? AND cabinet_id = ?')
    .get(soumissionId, cabinetId);
  const cols = Object.keys(vals);
  if (exist) {
    bd.prepare(`
      UPDATE caut_antecedents SET ${cols.map((c) => `${c} = ?`).join(', ')}, archive = 0 WHERE id = ?
    `).run(...cols.map((c) => vals[c]), exist.id);
    auditer(cabinetId, userId, 'caut_antecedents_modifies', `Antécédents (soumission cautionnement #${soumissionId}) modifiés`);
    creerVersionSoumission(soumissionId, cabinetId, userId);
    return exist.id;
  }
  const r = bd.prepare(`
    INSERT INTO caut_antecedents (cabinet_id, soumission_id, ${cols.join(', ')})
    VALUES (?, ?, ${cols.map(() => '?').join(', ')})
  `).run(cabinetId, soumissionId, ...cols.map((c) => vals[c]));
  auditer(cabinetId, userId, 'caut_antecedents_definis', `Antécédents définis (soumission cautionnement #${soumissionId})`);
  creerVersionSoumission(soumissionId, cabinetId, userId);
  return r.lastInsertRowid;
}

// --- Seed de démonstration (seulement si absent) -------------------------------
// Entreprise « Construction Verdon inc. » (Laval) : entrepreneur général,
// ligne globale 5 M$, limite par projet 2,5 M$, cautionnement d'exécution de
// 50 % sur un contrat d'école de 2,2 M$ (centre de services scolaire),
// cautionnement de licence RBQ 40 000 $ (entrepreneur général), aucune
// réclamation contre un cautionnement depuis 5 ans. Idempotent.
function semerSoumissionDemo(cabinetId, userId) {
  let client = bd.prepare(`
    SELECT id FROM clients WHERE cabinet_id = ? AND raison_sociale = ?
  `).get(cabinetId, 'Construction Verdon inc.');
  if (client) {
    const exist = bd.prepare(`
      SELECT id FROM caut_soumissions WHERE cabinet_id = ? AND client_id = ? AND archive = 0 ORDER BY id LIMIT 1
    `).get(cabinetId, client.id);
    if (exist) return exist.id;
  } else {
    const r = bd.prepare(`
      INSERT INTO clients (cabinet_id, raison_sociale, neq, secteur_activite, prenom, nom, titre_contact,
        courriel, telephone, adresse, ville, code_postal, langue, notes, responsable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cabinetId, 'Construction Verdon inc.', '1167890123', 'Construction — entrepreneur général',
      'Marc', 'Verdon', 'Président', 'm.verdon@constructionverdon.ca', '450-555-0142',
      '1850 boulevard Saint-Martin Ouest', 'Laval', 'H7S 1M9', 'FR',
      'Entrepreneur général, projets institutionnels et commerciaux.', userId || null);
    client = { id: r.lastInsertRowid };
  }
  const soumissionId = creerSoumission({
    cabinetId, userId, clientId: client.id,
    assureur: 'Intact Cautionnement', responsableId: userId || null,
    secteurActivite: 'Construction — entrepreneur général', anneeFondation: 2008,
    chiffreAffaires: 8500000, nbEmployes: 42,
    notes: 'Renouvellement de la ligne de cautionnement — capacité demandée pour les appels d’offres institutionnels 2026.',
  });
  ajouterObligation(soumissionId, cabinetId, userId, {
    type: 'soumission', beneficiaire: 'Centre de services scolaire des Mille-Îles',
    description_projet: 'Cautionnement de soumission — agrandissement de l’école primaire Saint-Paul, Laval',
    montant_contrat: 2200000, montant_cautionnement: 220000, taux_pct: null, prime_estimee: 350,
    date_debut: '2026-03-01', duree_mois: 14,
  });
  ajouterObligation(soumissionId, cabinetId, userId, {
    type: 'execution', beneficiaire: 'Centre de services scolaire des Mille-Îles',
    description_projet: 'Agrandissement de l’école primaire Saint-Paul, Laval (contrat de construction)',
    montant_contrat: 2200000, montant_cautionnement: 1100000, taux_pct: 1.1, prime_estimee: 12100,
    date_debut: '2026-04-15', duree_mois: 14,
  });
  ajouterObligation(soumissionId, cabinetId, userId, {
    type: 'paiement_mo', beneficiaire: 'Centre de services scolaire des Mille-Îles',
    description_projet: 'Paiement de la main-d’œuvre et des matériaux — agrandissement de l’école primaire Saint-Paul',
    montant_contrat: 2200000, montant_cautionnement: 1100000, taux_pct: 0.8, prime_estimee: 8800,
    date_debut: '2026-04-15', duree_mois: 14,
  });
  ajouterObligation(soumissionId, cabinetId, userId, {
    type: 'rbq', beneficiaire: 'Régie du bâtiment du Québec (RBQ)',
    description_projet: 'Cautionnement de licence RBQ — entrepreneur général (40 000 $)',
    montant_contrat: null, montant_cautionnement: 40000, taux_pct: null, prime_estimee: 250,
    date_debut: '2026-01-01', duree_mois: 12,
  });
  definirGaranties(soumissionId, cabinetId, userId, {
    limite_globale: 5000000, limite_par_projet: 2500000,
    fonds_roulement: 850000, valeur_nette: 1900000, prime: 21500.00,
  });
  definirAntecedents(soumissionId, cabinetId, userId, {
    assureur_actuel: 'Intact Cautionnement', numero_ligne_actuelle: 'CAUT-2021-3355',
    annees_cautionnement_continu: 8,
    reclamations_5ans: [],
    refus_resiliation_ant: 0,
    consentements: {
      credit: { accepte: true, date: new Date().toISOString().slice(0, 10) },
      etats_financiers: { accepte: true, date: new Date().toISOString().slice(0, 10) },
    },
  });
  auditer(cabinetId, userId, 'caut_demo_semee', `Soumission cautionnement démo « Construction Verdon inc. » #${soumissionId}`);
  return soumissionId;
}

module.exports = {
  STATUTS_SOUMISSION,
  TYPES_OBLIGATION,
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
  ajouterObligation,
  modifierObligation,
  archiverObligation,
  desarchiverObligation,
  definirGaranties,
  definirAntecedents,
  semerSoumissionDemo,
};
