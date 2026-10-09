/**
 * lib/bd.js — Connexion SQLite et création du schéma.
 * Base de données locale (better-sqlite3). Toutes les requêtes de l'app
 * utilisent des requêtes paramétrées définies ici ou dans les routes.
 */
const Database = require('better-sqlite3');
const path = require('path');

const CHEMIN_BD = process.env.CHEMIN_BD || path.join(__dirname, '..', 'courtier.db');

const bd = new Database(CHEMIN_BD);
// Intégrité et performances raisonnables
bd.pragma('journal_mode = WAL');
bd.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cabinets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  token_capture TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  email TEXT NOT NULL UNIQUE,
  mot_de_passe_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','courtier','adjoint')),
  nom TEXT NOT NULL,
  totp_secret TEXT,
  totp_actif INTEGER NOT NULL DEFAULT 0,
  doit_changer_mot_de_passe INTEGER NOT NULL DEFAULT 0,
  actif INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  raison_sociale TEXT NOT NULL,
  neq TEXT,
  secteur_activite TEXT,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  titre_contact TEXT,
  courriel TEXT,
  telephone TEXT,
  adresse TEXT,
  ville TEXT,
  code_postal TEXT,
  langue TEXT NOT NULL DEFAULT 'FR' CHECK (langue IN ('FR','EN')),
  notes TEXT,
  responsable_id INTEGER REFERENCES users(id),
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clients_cabinet ON clients(cabinet_id);

CREATE TABLE IF NOT EXISTS consentements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  accepte INTEGER NOT NULL DEFAULT 0,
  date_consentement TEXT,
  UNIQUE (client_id, type)
);

CREATE TABLE IF NOT EXISTS polices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ligne TEXT NOT NULL CHECK (ligne IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre')),
  assureur TEXT NOT NULL,
  numero_police TEXT NOT NULL,
  date_effet TEXT NOT NULL,
  date_echeance TEXT NOT NULL,
  franchise REAL NOT NULL DEFAULT 0,
  statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active','a_renouveler','resiliee')),
  notes TEXT,
  responsable_id INTEGER REFERENCES users(id),
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cabinet_id, numero_police)
);
CREATE INDEX IF NOT EXISTS idx_polices_cabinet ON polices(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_polices_echeance ON polices(date_echeance);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  police_id INTEGER REFERENCES polices(id) ON DELETE CASCADE,
  nom_origine TEXT NOT NULL,
  chemin TEXT NOT NULL,
  mime TEXT,
  taille INTEGER,
  archive INTEGER NOT NULL DEFAULT 0,
  televerse_le TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (client_id IS NOT NULL OR police_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_documents_police ON documents(police_id);

CREATE TABLE IF NOT EXISTS catalogue_protections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ligne TEXT NOT NULL,
  code TEXT NOT NULL,
  libelle TEXT NOT NULL,
  description TEXT,
  recommandee INTEGER NOT NULL DEFAULT 0,
  UNIQUE (ligne, code)
);

CREATE TABLE IF NOT EXISTS police_protections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  police_id INTEGER NOT NULL REFERENCES polices(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  libelle TEXT NOT NULL,
  prime REAL NOT NULL DEFAULT 0,
  UNIQUE (police_id, code)
);

-- Historique des versions d'une police (avenants) — règle d'or : rien ne se supprime.
-- Chaque version est un snapshot complet (champs + protections) en lecture seule.
CREATE TABLE IF NOT EXISTS police_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  police_id INTEGER NOT NULL REFERENCES polices(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  date_effet TEXT NOT NULL,
  date_echeance TEXT NOT NULL,
  franchise REAL NOT NULL DEFAULT 0,
  notes TEXT,
  protections_json TEXT NOT NULL DEFAULT '[]',
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id),
  UNIQUE (police_id, version)
);
CREATE INDEX IF NOT EXISTS idx_police_versions_police ON police_versions(police_id);

CREATE TABLE IF NOT EXISTS brouillons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  police_id INTEGER REFERENCES polices(id) ON DELETE CASCADE,
  facture_id INTEGER REFERENCES factures(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'renouvellement',
  sujet TEXT NOT NULL,
  contenu TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','valide')),
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (police_id IS NOT NULL OR facture_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS journal_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_journal_cabinet ON journal_audit(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_audit(cree_le);

-- Réclamations (sinistres) — assurance commerciale
-- Statuts simplifiés : ouverte / fermee (règle du 2026-10-08)
CREATE TABLE IF NOT EXISTS reclamations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  police_id INTEGER REFERENCES polices(id) ON DELETE SET NULL,
  numero_reclamation TEXT,
  date_sinistre TEXT NOT NULL,
  date_declaration TEXT,
  description TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'ouverte'
    CHECK (statut IN ('ouverte','fermee')),
  montant_reclame REAL,
  montant_regle REAL,
  franchise_appliquee REAL,
  expert_nom TEXT,
  expert_contact TEXT,
  responsable_id INTEGER REFERENCES users(id),
  date_rappel TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reclamations_cabinet ON reclamations(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_reclamations_rappel ON reclamations(date_rappel);

-- Historique de suivi d'une réclamation
CREATE TABLE IF NOT EXISTS reclamation_suivis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reclamation_id INTEGER NOT NULL REFERENCES reclamations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  texte TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tâches et rappels manuels
CREATE TABLE IF NOT EXISTS taches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  assigne_a INTEGER REFERENCES users(id),
  entreprise_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  police_id INTEGER REFERENCES polices(id) ON DELETE CASCADE,
  reclamation_id INTEGER REFERENCES reclamations(id) ON DELETE CASCADE,
  titre TEXT NOT NULL,
  date_echeance TEXT,
  statut TEXT NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire','en_cours','terminee')),
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_taches_cabinet ON taches(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_taches_echeance ON taches(date_echeance);

-- Facturation : factures émises aux entreprises clientes
CREATE TABLE IF NOT EXISTS factures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  police_id INTEGER REFERENCES polices(id) ON DELETE SET NULL,
  numero_facture TEXT NOT NULL,
  description TEXT NOT NULL,
  montant REAL NOT NULL CHECK (montant > 0),
  montant_paye REAL NOT NULL DEFAULT 0,
  date_emission TEXT NOT NULL,
  date_echeance TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'emise'
    CHECK (statut IN ('emise','partielle','payee','en_retard','annulee')),
  notes TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cabinet_id, numero_facture)
);
CREATE INDEX IF NOT EXISTS idx_factures_cabinet ON factures(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_factures_client ON factures(client_id);
CREATE INDEX IF NOT EXISTS idx_factures_echeance ON factures(date_echeance);

-- Paiements reçus sur une facture
CREATE TABLE IF NOT EXISTS paiements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
  montant REAL NOT NULL CHECK (montant > 0),
  date_paiement TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'virement' CHECK (mode IN ('virement','cheque','carte','autre')),
  notes TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Leads : prospects issus des campagnes publicitaires (pas encore clients)
-- client_id reste NULL tant que le lead n'est pas converti en entreprise.
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  nom TEXT NOT NULL,
  entreprise TEXT,
  courriel TEXT,
  telephone TEXT,
  besoin TEXT,
  source TEXT,
  campagne TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  statut TEXT NOT NULL DEFAULT 'nouveau'
    CHECK (statut IN ('nouveau','contacte','qualifie','soumission','client','perdu')),
  responsable_id INTEGER REFERENCES users(id),
  date_rappel TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_cabinet ON leads(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_leads_statut ON leads(statut);

-- Historique de suivi d'un lead
CREATE TABLE IF NOT EXISTS lead_suivis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  texte TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Campagnes de sollicitation par classe d'affaires (secteur d'activité)
CREATE TABLE IF NOT EXISTS campagnes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  nom TEXT NOT NULL,
  secteurs TEXT NOT NULL DEFAULT '[]',
  objet TEXT NOT NULL,
  contenu TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','prete')),
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Réunions (avec ou sans lien Teams)
CREATE TABLE IF NOT EXISTS reunions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  titre TEXT NOT NULL,
  date_heure TEXT NOT NULL,
  lien_teams TEXT,
  statut TEXT NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee','terminee','annulee')),
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reunions_cabinet ON reunions(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_reunions_date ON reunions(date_heure);

-- Jetons Microsoft 365 (chiffrés) par cabinet — réunions Teams automatiques
CREATE TABLE IF NOT EXISTS microsoft_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL UNIQUE REFERENCES cabinets(id) ON DELETE CASCADE,
  access_chiffre TEXT NOT NULL,
  refresh_chiffre TEXT NOT NULL,
  expire_le TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions Express stockées en base (au lieu du MemoryStore par défaut)
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

-- Courriels : comptes IMAP/SMTP par cabinet (mots de passe chiffrés via lib/chiffrement.js)
-- Règle d'or : un compte ne se supprime jamais, il s'archive.
CREATE TABLE IF NOT EXISTS courriel_comptes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  nom TEXT NOT NULL,
  adresse TEXT NOT NULL,
  imap_hote TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_tls INTEGER NOT NULL DEFAULT 1,
  smtp_hote TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_tls INTEGER NOT NULL DEFAULT 1,
  utilisateur TEXT NOT NULL,
  mot_de_passe_chiffre TEXT NOT NULL,
  actif INTEGER NOT NULL DEFAULT 1,
  archive INTEGER NOT NULL DEFAULT 0,
  derniere_synchro TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_courriel_comptes_cabinet ON courriel_comptes(cabinet_id);

-- Courriels reçus (synchronisés en IMAP) et envoyés (via SMTP).
-- client_id : entreprise liée (auto par adresse courriel, ou manuellement).
CREATE TABLE IF NOT EXISTS courriels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  compte_id INTEGER REFERENCES courriel_comptes(id) ON DELETE SET NULL,
  message_id TEXT,
  dossier TEXT NOT NULL DEFAULT 'reception' CHECK (dossier IN ('reception','envoyes')),
  expediteur TEXT,
  destinataires TEXT,
  cc TEXT,
  sujet TEXT,
  corps_texte TEXT,
  corps_html TEXT,
  date_courriel TEXT,
  lu INTEGER NOT NULL DEFAULT 0,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cabinet_id, compte_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_courriels_cabinet ON courriels(cabinet_id, dossier);
CREATE INDEX IF NOT EXISTS idx_courriels_client ON courriels(client_id);

-- Contacts multiples par entreprise (le contact historique unique est migré
-- vers cette table avec principal = 1). Règle d'or : on archive, on ne supprime pas.
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  titre TEXT,
  courriel TEXT,
  telephone TEXT,
  principal INTEGER NOT NULL DEFAULT 0,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_client ON contacts(client_id);

-- Assistant IA : historique des conversations (2026-10-09) ---------------------
CREATE TABLE IF NOT EXISTS assistant_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  utilisateur_id INTEGER REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('utilisateur', 'assistant')),
  contenu TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assistant_cabinet ON assistant_messages(cabinet_id, id);

-- Assureurs (2026-10-09) : fiches avec contacts nouvelle affaire / modifications ----
CREATE TABLE IF NOT EXISTS assureurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  nom TEXT NOT NULL,
  site_web TEXT,
  telephone_general TEXT,
  courriel_general TEXT,
  na_nom TEXT,
  na_telephone TEXT,
  na_courriel TEXT,
  mod_nom TEXT,
  mod_telephone TEXT,
  mod_courriel TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cabinet_id, nom)
);
CREATE INDEX IF NOT EXISTS idx_assureurs_cabinet ON assureurs(cabinet_id, archive);
`;

bd.exec(SCHEMA);

// --- Migrations légères (bases créées avant les nouveaux modules) -----------------
const crypto = require('crypto');

function colonneExiste(table, colonne) {
  return bd.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === colonne);
}

function genererJetonCapture() {
  return crypto.randomBytes(24).toString('hex');
}

// token_capture sur cabinets (capture publique de leads)
if (!colonneExiste('cabinets', 'token_capture')) {
  bd.exec('ALTER TABLE cabinets ADD COLUMN token_capture TEXT');
}
for (const c of bd.prepare('SELECT id FROM cabinets WHERE token_capture IS NULL').all()) {
  bd.prepare('UPDATE cabinets SET token_capture = ? WHERE id = ?').run(genererJetonCapture(), c.id);
}

// facture_id sur brouillons (relances de factures)
if (!colonneExiste('brouillons', 'facture_id')) {
  bd.exec('ALTER TABLE brouillons ADD COLUMN facture_id INTEGER REFERENCES factures(id) ON DELETE CASCADE');
}

// --- Règle d'or (2026-10-08) : archivage partout, statuts de réclamation simplifiés ---
for (const t of ['clients', 'leads', 'taches', 'campagnes', 'reunions', 'brouillons', 'documents', 'reclamations']) {
  if (!colonneExiste(t, 'archive')) {
    bd.exec(`ALTER TABLE ${t} ADD COLUMN archive INTEGER NOT NULL DEFAULT 0`);
  }
}

// --- Fiche entreprise complète (2026-10-09) : courriel/téléphone de l'entreprise,
// chiffre d'affaires, nombre d'employés ------------------------------------------
for (const [col, def] of [
  ['courriel_entreprise', 'TEXT'],
  ['telephone_entreprise', 'TEXT'],
  ['chiffre_affaires', 'REAL'],
  ['nb_employes', 'INTEGER'],
]) {
  if (!colonneExiste('clients', col)) {
    bd.exec(`ALTER TABLE clients ADD COLUMN ${col} ${def}`);
  }
}

// --- Assureurs : liaison des polices aux fiches (2026-10-09) --------------------------
// Les noms d'assureurs saisis en texte libre sont migrés vers des fiches assureurs.
if (!colonneExiste('polices', 'assureur_id')) {
  bd.exec('ALTER TABLE polices ADD COLUMN assureur_id INTEGER REFERENCES assureurs(id)');
  const migrer = bd.transaction(() => {
    const noms = bd.prepare(`
      SELECT DISTINCT cabinet_id, trim(assureur) AS nom FROM polices
      WHERE assureur IS NOT NULL AND trim(assureur) != ''
    `).all();
    const inserer = bd.prepare('INSERT OR IGNORE INTO assureurs (cabinet_id, nom) VALUES (?, ?)');
    for (const r of noms) {
      inserer.run(r.cabinet_id, r.nom);
      const a = bd.prepare('SELECT id FROM assureurs WHERE cabinet_id = ? AND lower(nom) = lower(?)').get(r.cabinet_id, r.nom);
      if (a) {
        bd.prepare(`
          UPDATE polices SET assureur_id = ?
          WHERE cabinet_id = ? AND trim(assureur) = ? AND assureur_id IS NULL
        `).run(a.id, r.cabinet_id, r.nom);
      }
    }
  });
  migrer();
}

// --- Contacts multiples (2026-10-09) : migrer le contact unique historique ------
const nbContacts = bd.prepare('SELECT COUNT(*) AS n FROM contacts').get().n;
if (nbContacts === 0) {
  const inserer = bd.prepare(`
    INSERT INTO contacts (cabinet_id, client_id, prenom, nom, titre, courriel, telephone, principal)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const migrer = bd.transaction((rows) => {
    for (const c of rows) inserer.run(c.cabinet_id, c.id, c.prenom, c.nom, c.titre_contact, c.courriel, c.telephone);
  });
  migrer(bd.prepare('SELECT id, cabinet_id, prenom, nom, titre_contact, courriel, telephone FROM clients').all());
}
if (!colonneExiste('users', 'actif')) {
  bd.exec('ALTER TABLE users ADD COLUMN actif INTEGER NOT NULL DEFAULT 1');
}

// Migration des statuts de réclamation vers ouverte/fermee (ancien CHECK à 6 valeurs).
// SQLite ne permet pas de modifier un CHECK : on reconstruit la table.
const sqlRecl = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'reclamations'").get();
if (sqlRecl && sqlRecl.sql.includes("'declaree'")) {
  bd.exec('PRAGMA foreign_keys = OFF');
  try {
    bd.exec(`
      CREATE TABLE reclamations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        police_id INTEGER REFERENCES polices(id) ON DELETE SET NULL,
        numero_reclamation TEXT,
        date_sinistre TEXT NOT NULL,
        date_declaration TEXT,
        description TEXT NOT NULL,
        statut TEXT NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte','fermee')),
        montant_reclame REAL,
        montant_regle REAL,
        franchise_appliquee REAL,
        expert_nom TEXT,
        expert_contact TEXT,
        responsable_id INTEGER REFERENCES users(id),
        date_rappel TEXT,
        notes TEXT,
        archive INTEGER NOT NULL DEFAULT 0,
        cree_le TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO reclamations_new (id, cabinet_id, client_id, police_id, numero_reclamation,
        date_sinistre, date_declaration, description, statut, montant_reclame, montant_regle,
        franchise_appliquee, expert_nom, expert_contact, responsable_id, date_rappel, notes,
        cree_le)
      SELECT id, cabinet_id, client_id, police_id, numero_reclamation, date_sinistre,
        date_declaration, description,
        CASE WHEN statut IN ('declaree','en_evaluation','en_negociation') THEN 'ouverte' ELSE 'fermee' END,
        montant_reclame, montant_regle, franchise_appliquee, expert_nom, expert_contact,
        responsable_id, date_rappel, notes, cree_le
      FROM reclamations;
      DROP TABLE reclamations;
      ALTER TABLE reclamations_new RENAME TO reclamations;
      CREATE INDEX IF NOT EXISTS idx_reclamations_cabinet ON reclamations(cabinet_id);
      CREATE INDEX IF NOT EXISTS idx_reclamations_rappel ON reclamations(date_rappel);
    `);
  } finally {
    bd.exec('PRAGMA foreign_keys = ON');
  }
}

module.exports = bd;
module.exports.genererJetonCapture = genererJetonCapture;
