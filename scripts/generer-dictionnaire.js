/**
 * scripts/generer-dictionnaire.js — Vérifie que lib/dictionnaire-champs.json
 * documente EXACTEMENT le schéma réel (lib/bd.js).
 *
 * Usage : node scripts/generer-dictionnaire.js
 * Sortie 0 = dictionnaire complet ; sortie 1 = tables/colonnes manquantes
 * ou en trop (le dictionnaire aurait pourri) — la liste est affichée.
 *
 * À lancer après toute évolution du schéma, et dans les tests
 * (scripts/test-dictionnaire.js).
 */
const path = require('path');
const bd = require('../lib/bd');
const dico = require('../lib/dictionnaire-champs.json');

const IGNORER_TABLES = new Set([]); // aucune : tout doit être documenté

function tablesReelles() {
  return bd.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((r) => r.name);
}

function colonnesReelles(table) {
  return bd.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function verifier() {
  const erreurs = [];
  const docTables = new Map(dico.tables.map((t) => [t.nom, t]));

  for (const table of tablesReelles()) {
    if (IGNORER_TABLES.has(table)) continue;
    const t = docTables.get(table);
    if (!t) {
      erreurs.push(`Table non documentée : ${table}`);
      continue;
    }
    const docCols = new Set(t.colonnes.map((c) => c.nom));
    for (const col of colonnesReelles(table)) {
      if (!docCols.has(col)) erreurs.push(`Colonne non documentée : ${table}.${col}`);
    }
    const reelles = new Set(colonnesReelles(table));
    for (const col of docCols) {
      if (!reelles.has(col)) erreurs.push(`Colonne documentée mais absente du schéma : ${table}.${col}`);
    }
  }
  for (const t of dico.tables) {
    if (!tablesReelles().includes(t.nom) && !IGNORER_TABLES.has(t.nom)) {
      erreurs.push(`Table documentée mais absente du schéma : ${t.nom}`);
    }
    if (!dico.domaines[t.domaine]) {
      erreurs.push(`Domaine inconnu pour la table ${t.nom} : ${t.domaine}`);
    }
    const usages = new Set(['soumission', 'gestion', 'les_deux', 'technique']);
    for (const c of t.colonnes) {
      if (!usages.has(c.usage)) erreurs.push(`Usage invalide : ${t.nom}.${c.nom} = ${c.usage}`);
    }
  }
  return erreurs;
}

const erreurs = verifier();
if (erreurs.length) {
  console.error(`Dictionnaire incomplet : ${erreurs.length} problème(s)`);
  for (const e of erreurs) console.error('  - ' + e);
  process.exit(1);
}
console.log(`Dictionnaire complet : ${dico.tables.length} tables, ` +
  `${dico.tables.reduce((n, t) => n + t.colonnes.length, 0)} colonnes documentées.`);
