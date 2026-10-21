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
  role TEXT NOT NULL CHECK (role IN ('admin','manager','courtier','expert_sinistre','adjoint')),
  nom TEXT NOT NULL,
  manager_id INTEGER REFERENCES users(id),
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
  ligne TEXT NOT NULL CHECK (ligne IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
  assureur TEXT NOT NULL,
  numero_police TEXT NOT NULL,
  date_effet TEXT NOT NULL,
  date_echeance TEXT NOT NULL,
  franchise REAL NOT NULL DEFAULT 0,
  statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active','a_renouveler','resiliee')),
  notes TEXT,
  responsable_id INTEGER REFERENCES users(id),
  assureur_id INTEGER REFERENCES assureurs(id),
  auto_soumission_id INTEGER REFERENCES auto_soumissions(id),
  auto_soumission_version INTEGER,
  biens_soumission_id INTEGER REFERENCES biens_soumissions(id),
  biens_soumission_version INTEGER,
  rc_soumission_id INTEGER REFERENCES rc_soumissions(id),
  rc_soumission_version INTEGER,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cabinet_id, numero_police),
  UNIQUE (auto_soumission_id),
  UNIQUE (biens_soumission_id),
  UNIQUE (rc_soumission_id)
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

-- Analyse de documents IA : un document téléversé (police d'assureur,
-- proposition remplie, scan) est extrait (texte natif ou OCR local), puis le
-- moteur propose des champs à réviser avant toute insertion. Règle d'or :
-- l'analyse et son document ne sont JAMAIS supprimés (archivage doux).
CREATE TABLE IF NOT EXISTS analyses_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  utilisateur_id INTEGER REFERENCES users(id),
  nom_origine TEXT NOT NULL,
  chemin TEXT NOT NULL,
  mime TEXT,
  taille INTEGER,
  texte_extrait TEXT,
  methode_extraction TEXT,
  statut TEXT NOT NULL DEFAULT 'recu' CHECK (statut IN ('recu','en_cours','analyse','pret','a_reviser','insere','echec')),
  produit_detecte TEXT,
  confiance_globale REAL,
  champs_proposes TEXT,
  listes_proposees TEXT,
  moteur TEXT,
  message TEXT,
  produit_insere TEXT,
  soumission_id INTEGER,
  police_id INTEGER REFERENCES polices(id),
  document_id INTEGER REFERENCES documents(id),
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_analyses_cabinet ON analyses_documents(cabinet_id);

-- Réglages IA par cabinet : clé API Cohere CHIFFRÉE (AES-256-GCM,
-- lib/chiffrement.js) et choix du moteur (local / cohere / auto).
CREATE TABLE IF NOT EXISTS reglages_ia (
  cabinet_id INTEGER PRIMARY KEY REFERENCES cabinets(id),
  cle_cohere_chiffree TEXT,
  moteur TEXT NOT NULL DEFAULT 'auto' CHECK (moteur IN ('local','cohere','augure','auto')),
  maj_le TEXT NOT NULL DEFAULT (datetime('now')),
  cle_google_chiffree TEXT,
  cle_augure_chiffree TEXT,
  modele_augure TEXT NOT NULL DEFAULT 'ossington-5'
);

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
  avenant_note TEXT,
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

-- Pièces jointes des courriels reçus (boucle courriel : elles alimentent le
-- même pipeline d'analyse que les documents téléversés). Le fichier est
-- conservé sur disque (uploads/<cabinet>/courriels/) ; règle d'or : archivage
-- doux seulement, jamais de suppression.
CREATE TABLE IF NOT EXISTS courriel_pieces_jointes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  courriel_id INTEGER NOT NULL REFERENCES courriels(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  mime TEXT,
  taille INTEGER,
  chemin TEXT NOT NULL,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_courriel_pj_courriel ON courriel_pieces_jointes(courriel_id);

-- Demandes d'informations au client (boucle courriel) : le système détecte
-- les informations manquantes d'une soumission (lib/manques.js), génère un
-- courriel de questions, puis la réponse du client est analysée et complète
-- la fiche après révision. Aucun envoi sans validation humaine explicite.
-- Règle d'or : jamais supprimée (archivage doux) ; une relance est une
-- NOUVELLE demande liée par parent_id, jamais un écrasement.
CREATE TABLE IF NOT EXISTS demandes_infos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  parent_id INTEGER REFERENCES demandes_infos(id),
  produit TEXT NOT NULL,
  soumission_id INTEGER NOT NULL,
  client_id INTEGER REFERENCES clients(id),
  destinataire TEXT,
  sujet TEXT NOT NULL,
  corps TEXT NOT NULL,
  questions TEXT,
  statut TEXT NOT NULL DEFAULT 'brouillon'
    CHECK (statut IN ('brouillon','envoyee','partiellement_completee','completee')),
  mode_envoi TEXT,
  message_id TEXT,
  courriel_id INTEGER REFERENCES courriels(id),
  cree_par INTEGER REFERENCES users(id),
  envoyee_le TEXT,
  completee_le TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demandes_infos_cabinet ON demandes_infos(cabinet_id, statut);
CREATE INDEX IF NOT EXISTS idx_demandes_infos_soumission ON demandes_infos(produit, soumission_id);

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
  compta_nom TEXT,
  compta_telephone TEXT,
  compta_courriel TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cabinet_id, nom)
);
CREATE INDEX IF NOT EXISTS idx_assureurs_cabinet ON assureurs(cabinet_id, archive);

-- Produits offerts par assureur + taux de commission par produit (2026-10-10) ----
-- Une ligne = un produit offert (case cochée dans la fiche). Les produits
-- décochés sont retirés : c'est de la configuration d'offre, pas une suppression métier.
CREATE TABLE IF NOT EXISTS assureur_produits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assureur_id INTEGER NOT NULL REFERENCES assureurs(id) ON DELETE CASCADE,
  produit TEXT NOT NULL CHECK (produit IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
  commission_pct REAL,
  UNIQUE (assureur_id, produit)
);
CREATE INDEX IF NOT EXISTS idx_assureur_produits_assureur ON assureur_produits(assureur_id);

-- FPQ1 — Questionnaire de soumission automobile (étape 1/10, 2026-10-19) -----------
-- Couche données uniquement (aucune route/UI à cette étape).
-- Règle d'or : archive 0/1 partout, jamais de DELETE métier.
-- Véhicules et conducteurs en nombre illimité (blocs répétables par soumission).
CREATE TABLE IF NOT EXISTS auto_soumissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','soumise','convertie_police')),
  date_effet_souhaitee TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_auto_soumissions_cabinet ON auto_soumissions(cabinet_id, archive);

CREATE TABLE IF NOT EXISTS auto_conducteurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES auto_soumissions(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  date_naissance TEXT,
  sexe TEXT CHECK (sexe IN ('M','F')),
  etat_civil TEXT,
  numero_permis TEXT,
  province_permis TEXT NOT NULL DEFAULT 'QC',
  date_obtention_permis TEXT,
  annees_experience_ca INTEGER,
  annees_experience_ailleurs INTEGER,
  lien_assure TEXT,
  telephone TEXT,
  courriel TEXT,
  profession TEXT,
  employeur TEXT,
  conducteur_principal INTEGER NOT NULL DEFAULT 0,
  vehicules_conduits TEXT,  -- JSON : [{vehicule_id, usage:'principal'|'occasionnel'}]
  infractions TEXT,         -- JSON : [{date, type, points}]
  suspensions TEXT,         -- JSON : [{debut, fin, motif}]
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auto_conducteurs_soumission ON auto_conducteurs(soumission_id, archive);

CREATE TABLE IF NOT EXISTS auto_vehicules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES auto_soumissions(id) ON DELETE CASCADE,
  annee INTEGER,
  marque TEXT,
  modele TEXT,
  version_finition TEXT,
  vin TEXT,
  carrosserie TEXT,
  neuf_occasion TEXT CHECK (neuf_occasion IN ('neuf','occasion')),
  date_achat TEXT,
  prix_achat REAL,
  valeur_estimee REAL,
  financement TEXT CHECK (financement IN ('comptant','finance','loue')),
  creancier_nom TEXT,
  creancier_courriel TEXT,
  usage TEXT CHECK (usage IN ('promenade','affaires','navette')),
  km_annuel INTEGER,
  pct_hors_quebec REAL,
  stationnement TEXT,
  remisage_hiver INTEGER NOT NULL DEFAULT 0,
  modifications TEXT,       -- JSON : [{description, valeur}]
  antivol_tag INTEGER NOT NULL DEFAULT 0,
  pneus_hiver INTEGER NOT NULL DEFAULT 0,
  conducteur_principal_id INTEGER REFERENCES auto_conducteurs(id) ON DELETE SET NULL,
  remorque INTEGER NOT NULL DEFAULT 0,
  remorque_details TEXT,    -- JSON
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auto_vehicules_soumission ON auto_vehicules(soumission_id, archive);

CREATE TABLE IF NOT EXISTS auto_garanties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  vehicule_id INTEGER NOT NULL REFERENCES auto_vehicules(id) ON DELETE CASCADE,
  rc_montant REAL,          -- 50000 / 1000000 / 2000000 / autre montant libre
  protection_b TEXT CHECK (protection_b IN ('aucune','b1','b2','b3','b4')),
  franchise_b REAL,
  avenants TEXT,            -- JSON : {faq43:1, faq20:1, ...} (clés courtes = codes FAQ, 1 = présent)
                            --         faq27_vehicule_non_appartenant:{...}, faq34_assurance_personnes:{...},
                            --         faq5a_credit_bail:{...}, ...}
  prime REAL,               -- remplie à la tarification (nullable)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (vehicule_id)
);
CREATE INDEX IF NOT EXISTS idx_auto_garanties_vehicule ON auto_garanties(vehicule_id);

CREATE TABLE IF NOT EXISTS auto_antecedents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES auto_soumissions(id) ON DELETE CASCADE,
  assureur_actuel TEXT,
  numero_police_actuelle TEXT,
  date_expiration_actuelle TEXT,
  annees_assurance_continue INTEGER,
  resiliation_ant INTEGER NOT NULL DEFAULT 0,
  resiliation_details TEXT,
  non_paiement_ant INTEGER NOT NULL DEFAULT 0,
  faillite INTEGER NOT NULL DEFAULT 0,
  casier_judiciaire INTEGER NOT NULL DEFAULT 0,
  sinistres_6ans TEXT,      -- JSON : [{date, type, montant, responsabilite}]
  consentements TEXT,       -- JSON : {credit:{accepte,date}, dossier_saaq:{accepte,date}, fcsa:{accepte,date}}
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_auto_antecedents_soumission ON auto_antecedents(soumission_id);

-- Historique des versions d'une soumission FPQ1 (règle d'or : rien ne se supprime,
-- traçabilité complète comme les notes de conformité).
-- v1 = création ; chaque modification (conducteur, véhicule, garanties,
-- antécédents, statut) applique le changement PUIS fige le nouvel état en v(n+1).
-- L'état précédent reste consultable en lecture seule dans v(n).
CREATE TABLE IF NOT EXISTS auto_soumission_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  soumission_id INTEGER NOT NULL REFERENCES auto_soumissions(id) ON DELETE CASCADE,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  version INTEGER NOT NULL,
  statut TEXT NOT NULL,
  notes TEXT,
  date_effet_souhaitee TEXT,
  donnees TEXT NOT NULL,   -- JSON : {conducteurs:[...], vehicules:[{..., garanties}], antecedents}
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id),
  UNIQUE (soumission_id, version)
);
CREATE INDEX IF NOT EXISTS idx_auto_soumission_versions_soumission ON auto_soumission_versions(soumission_id);

-- BIENS COMMERCIAUX — Questionnaire de soumission (étape 1/10 biens, 2026-10-19) --
-- Couche données uniquement (aucune route/UI à cette étape).
-- Règle d'or : archive 0/1 partout, jamais de DELETE métier.
-- Bâtiments et contenus en nombre illimité (blocs répétables par soumission).
-- Garanties : une fiche par bâtiment. Antécédents : une fiche par soumission.
CREATE TABLE IF NOT EXISTS biens_soumissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','soumise','convertie_police')),
  date_effet_souhaitee TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_biens_soumissions_cabinet ON biens_soumissions(cabinet_id, archive);

CREATE TABLE IF NOT EXISTS biens_batiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES biens_soumissions(id) ON DELETE CASCADE,
  adresse TEXT,
  ville TEXT,
  code_postal TEXT,
  type_construction TEXT CHECK (type_construction IN ('bois','acier','beton','maconnerie','mixte')),
  annee_construction INTEGER,
  superficie_pi2 REAL,
  nb_etages INTEGER,
  occupation TEXT,            -- commerce de détail, bureau, entrepôt, restaurant, atelier…
  valeur_batiment REAL,
  gicleurs INTEGER NOT NULL DEFAULT 0,   -- protection incendie par gicleurs
  distance_caserne_km REAL,
  chauffage TEXT,             -- électrique, gaz, huile, …
  annee_toiture INTEGER,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biens_batiments_soumission ON biens_batiments(soumission_id, archive);

CREATE TABLE IF NOT EXISTS biens_contenus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES biens_soumissions(id) ON DELETE CASCADE,
  batiment_id INTEGER REFERENCES biens_batiments(id) ON DELETE CASCADE,  -- NULL = contenu général de la soumission
  description TEXT NOT NULL,
  type_contenu TEXT CHECK (type_contenu IN ('mobilier','equipements','stock','ameliorations','autre')),
  valeur REAL,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biens_contenus_soumission ON biens_contenus(soumission_id, archive);

CREATE TABLE IF NOT EXISTS biens_garanties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  batiment_id INTEGER NOT NULL REFERENCES biens_batiments(id) ON DELETE CASCADE,
  formule TEXT CHECK (formule IN ('tous_risques','risques_designes')),
  franchise REAL,
  montant_assurance REAL,
  avenants TEXT,              -- JSON : {tremblement_terre:1, inondation:1, refoulement_egout:1,
                              --          bris_machines:1, perte_exploitation_liee:1, ...} (1 = présent)
  prime REAL,                 -- remplie à la tarification (nullable)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (batiment_id)
);
CREATE INDEX IF NOT EXISTS idx_biens_garanties_batiment ON biens_garanties(batiment_id);

CREATE TABLE IF NOT EXISTS biens_antecedents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES biens_soumissions(id) ON DELETE CASCADE,
  assureur_actuel TEXT,
  numero_police_actuelle TEXT,
  date_expiration_actuelle TEXT,
  annees_assurance_continue INTEGER,
  sinistres_5ans TEXT,        -- JSON : [{date, type, montant}]
  consentements TEXT,         -- JSON : {credit:{accepte,date}, ...}
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_biens_antecedents_soumission ON biens_antecedents(soumission_id);

-- Historique des versions d'une soumission biens (règle d'or : rien ne se supprime,
-- traçabilité complète comme les notes de conformité).
-- v1 = création ; chaque modification (bâtiment, contenu, garanties,
-- antécédents, statut) applique le changement PUIS fige le nouvel état en v(n+1).
-- L'état précédent reste consultable en lecture seule dans v(n).
CREATE TABLE IF NOT EXISTS biens_soumission_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  soumission_id INTEGER NOT NULL REFERENCES biens_soumissions(id) ON DELETE CASCADE,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  version INTEGER NOT NULL,
  statut TEXT NOT NULL,
  notes TEXT,
  date_effet_souhaitee TEXT,
  donnees TEXT NOT NULL,   -- JSON : {batiments:[{..., garanties, contenus}], antecedents}
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id),
  UNIQUE (soumission_id, version)
);
CREATE INDEX IF NOT EXISTS idx_biens_soumission_versions_soumission ON biens_soumission_versions(soumission_id);

-- RC (RESPONSABILITÉ CIVILE / CGL) — Questionnaire de soumission (étape 1/10 RC, 2026-10-19) --
-- Couche données uniquement (aucune route/UI à cette étape).
-- Règle d'or : archive 0/1 partout, jamais de DELETE métier.
-- Exploitations (lieux d'exploitation) en nombre illimité (blocs répétables par soumission).
-- Garanties : une fiche par exploitation (limite par sinistre, limite agrégat, franchise,
-- formule locaux-et-opérations / produits-et-opérations-complétées, avenants).
-- Antécédents : une fiche par soumission (sinistres RC 5 ans).
CREATE TABLE IF NOT EXISTS rc_soumissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','soumise','convertie_police')),
  date_effet_souhaitee TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_rc_soumissions_cabinet ON rc_soumissions(cabinet_id, archive);

CREATE TABLE IF NOT EXISTS rc_exploitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES rc_soumissions(id) ON DELETE CASCADE,
  adresse TEXT,
  ville TEXT,
  code_postal TEXT,
  type_activite TEXT,         -- activité exercée à ce lieu (ex. rénovation résidentielle)
  code_classification TEXT,   -- code de classification responsabilité de l'assureur
  description_activites TEXT, -- description détaillée pour le souscripteur
  chiffre_affaires REAL,      -- CA projeté pour cette activité / ce lieu
  masse_salariale REAL,
  nb_employes INTEGER,
  superficie_pi2 REAL,
  sous_traitants TEXT CHECK (sous_traitants IN ('aucun','assures','non_assures')),
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rc_exploitations_soumission ON rc_exploitations(soumission_id, archive);

CREATE TABLE IF NOT EXISTS rc_garanties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  exploitation_id INTEGER NOT NULL REFERENCES rc_exploitations(id) ON DELETE CASCADE,
  limite_par_sinistre REAL,  -- limite par sinistre / chaque occurrence (1M, 2M, 5M…)
  limite_agregat REAL,       -- agrégat général annuel
  franchise REAL,
  formule TEXT CHECK (formule IN ('locaux_operations','produits_completes','globale')),
                             -- locaux et opérations / produits et opérations complétées / globale
  avenants TEXT,              -- JSON : {pollution:1, parapluie:1, ...} (1 = présent)
  prime REAL,                 -- remplie à la tarification (nullable)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (exploitation_id)
);
CREATE INDEX IF NOT EXISTS idx_rc_garanties_exploitation ON rc_garanties(exploitation_id);

CREATE TABLE IF NOT EXISTS rc_antecedents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES rc_soumissions(id) ON DELETE CASCADE,
  assureur_actuel TEXT,
  numero_police_actuelle TEXT,
  date_expiration_actuelle TEXT,
  annees_assurance_continue INTEGER,
  sinistres_5ans TEXT,        -- JSON : [{date, type, montant}]
  consentements TEXT,         -- JSON : {credit:{accepte,date}, ...}
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_rc_antecedents_soumission ON rc_antecedents(soumission_id);

-- Historique des versions d'une soumission RC (règle d'or : rien ne se supprime,
-- traçabilité complète comme les notes de conformité).
-- v1 = création ; chaque modification (exploitation, garanties, antécédents, statut)
-- applique le changement PUIS fige le nouvel état en v(n+1).
-- L'état précédent reste consultable en lecture seule dans v(n).
CREATE TABLE IF NOT EXISTS rc_soumission_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  soumission_id INTEGER NOT NULL REFERENCES rc_soumissions(id) ON DELETE CASCADE,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  version INTEGER NOT NULL,
  statut TEXT NOT NULL,
  notes TEXT,
  date_effet_souhaitee TEXT,
  donnees TEXT NOT NULL,   -- JSON : {exploitations:[{..., garanties}], antecedents}
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id),
  UNIQUE (soumission_id, version)
);
CREATE INDEX IF NOT EXISTS idx_rc_soumission_versions_soumission ON rc_soumission_versions(soumission_id);

-- CYBER (CYBERRISQUES) — Questionnaire de soumission (étape 1/10 cyber, 2026-10-19) --
-- Couche données uniquement (aucune route/UI à cette étape).
-- Règle d'or : archive 0/1 partout, jamais de DELETE métier.
-- Mesures de sécurité en nombre illimité (blocs répétables par soumission).
-- Garanties : une fiche par soumission (limite par sinistre, limite agrégat,
-- franchise, délai de carence, avenants CYB-* du catalogue commercial).
-- Antécédents : une fiche par soumission (incidents cyber 5 ans en JSON).
CREATE TABLE IF NOT EXISTS cyber_soumissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','soumise','convertie_police')),
  date_effet_souhaitee TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_cyber_soumissions_cabinet ON cyber_soumissions(cabinet_id, archive);

CREATE TABLE IF NOT EXISTS cyber_mesures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES cyber_soumissions(id) ON DELETE CASCADE,
  type_mesure TEXT,          -- type de contrôle de sécurité (mfa, sauvegardes, antivirus_edr,
                             -- pare_feu, formation_hameconnage, plan_reponse_incident, chiffrement,
                             -- gestion_correctifs, controle_acces, autre)
  statut TEXT CHECK (statut IN ('en_place','partiel','absent','prevu')),
  details TEXT,              -- détails de la mesure (ex. « MFA sur tous les accès admin »)
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cyber_mesures_soumission ON cyber_mesures(soumission_id, archive);

CREATE TABLE IF NOT EXISTS cyber_garanties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES cyber_soumissions(id) ON DELETE CASCADE,
  limite_par_sinistre REAL,  -- limite par sinistre / chaque occurrence (500K, 1M, 2M…)
  limite_agregat REAL,       -- agrégat annuel
  franchise REAL,
  delai_carence TEXT,        -- délai de carence avant indemnisation de l'interruption (ex. « 8 heures »)
  avenants TEXT,             -- JSON : {rancongiciel:1, fraude_transfert:1, donnees_vie_privee:1,
                             --         interruption:1} (1 = présent — cf. codes CYB-* du catalogue)
  prime REAL,                -- remplie à la tarification (nullable)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_cyber_garanties_soumission ON cyber_garanties(soumission_id);

CREATE TABLE IF NOT EXISTS cyber_antecedents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES cyber_soumissions(id) ON DELETE CASCADE,
  assureur_actuel TEXT,
  numero_police_actuelle TEXT,
  date_expiration_actuelle TEXT,
  annees_assurance_continue INTEGER,
  incidents_5ans TEXT,       -- JSON : [{date, type, montant, sinistre}] (sinistre = réclamé ou non)
  consentements TEXT,        -- JSON : {credit:{accepte,date}, ...}
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_cyber_antecedents_soumission ON cyber_antecedents(soumission_id);

-- Historique des versions d'une soumission cyber (règle d'or : rien ne se supprime,
-- traçabilité complète comme les notes de conformité).
-- v1 = création ; chaque modification (mesure, garanties, antécédents, statut)
-- applique le changement PUIS fige le nouvel état en v(n+1).
-- L'état précédent reste consultable en lecture seule dans v(n).
CREATE TABLE IF NOT EXISTS cyber_soumission_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  soumission_id INTEGER NOT NULL REFERENCES cyber_soumissions(id) ON DELETE CASCADE,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  version INTEGER NOT NULL,
  statut TEXT NOT NULL,
  notes TEXT,
  date_effet_souhaitee TEXT,
  donnees TEXT NOT NULL,   -- JSON : {mesures:[...], garanties, antecedents}
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id),
  UNIQUE (soumission_id, version)
);
CREATE INDEX IF NOT EXISTS idx_cyber_soumission_versions_soumission ON cyber_soumission_versions(soumission_id);

-- E&O (responsabilité professionnelle / erreurs et omissions) — étape 1/10 E&O.
-- Couche données uniquement (aucune route/UI à cette étape).
-- Règle d'or : archive 0/1 partout, jamais de DELETE métier.
-- Activités professionnelles en nombre illimité (blocs répétables par soumission).
-- Garanties : une fiche par soumission (limite par sinistre, limite agrégat,
-- franchise, base réclamations-présentées/occurrences, avenants EO-* du catalogue).
-- Antécédents : une fiche par soumission (réclamations E&O 5 ans en JSON,
-- circonstances pouvant donner lieu à réclamation).
CREATE TABLE IF NOT EXISTS eo_soumissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','soumise','convertie_police')),
  date_effet_souhaitee TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_eo_soumissions_cabinet ON eo_soumissions(cabinet_id, archive);

CREATE TABLE IF NOT EXISTS eo_activites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES eo_soumissions(id) ON DELETE CASCADE,
  description_activite TEXT NOT NULL,  -- service professionnel (ex. tenue de livres, fiscalité, conseil en TI)
  chiffre_affaires REAL,               -- chiffre d'affaires annuel de cette activité ($)
  nb_professionnels INTEGER,           -- nombre de professionnels exerçant cette activité
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eo_activites_soumission ON eo_activites(soumission_id, archive);

CREATE TABLE IF NOT EXISTS eo_garanties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES eo_soumissions(id) ON DELETE CASCADE,
  limite_par_sinistre REAL,  -- limite par sinistre / chaque réclamation (1M, 2M, 5M…)
  limite_agregat REAL,       -- agrégat annuel
  franchise REAL,
  base TEXT CHECK (base IN ('reclamations_presentees','occurrences')),
                             -- base de garantie : réclamations présentées (claims-made)
                             -- ou occurrences (survenance)
  avenants TEXT,             -- JSON : {frais_defense:1, medias_contenu:1, cyber_associe:1}
                             -- (1 = présent — cf. codes EO-* du catalogue commercial)
  prime REAL,                -- remplie à la tarification (nullable)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_eo_garanties_soumission ON eo_garanties(soumission_id);

CREATE TABLE IF NOT EXISTS eo_antecedents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES eo_soumissions(id) ON DELETE CASCADE,
  assureur_actuel TEXT,
  numero_police_actuelle TEXT,
  date_expiration_actuelle TEXT,
  annees_assurance_continue INTEGER,
  reclamations_5ans TEXT,    -- JSON : [{date, nature, montant, sinistre}] (sinistre = réclamé ou non)
  circonstances TEXT,        -- circonstances connues pouvant donner lieu à une réclamation
  consentements TEXT,        -- JSON : {credit:{accepte,date}, ...}
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_eo_antecedents_soumission ON eo_antecedents(soumission_id);

-- Historique des versions d'une soumission E&O (règle d'or : rien ne se supprime,
-- traçabilité complète comme les notes de conformité).
-- v1 = création ; chaque modification (activité, garanties, antécédents, statut)
-- applique le changement PUIS fige le nouvel état en v(n+1).
-- L'état précédent reste consultable en lecture seule dans v(n).
CREATE TABLE IF NOT EXISTS eo_soumission_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  soumission_id INTEGER NOT NULL REFERENCES eo_soumissions(id) ON DELETE CASCADE,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  version INTEGER NOT NULL,
  statut TEXT NOT NULL,
  notes TEXT,
  date_effet_souhaitee TEXT,
  donnees TEXT NOT NULL,   -- JSON : {activites:[...], garanties, antecedents}
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id),
  UNIQUE (soumission_id, version)
);
CREATE INDEX IF NOT EXISTS idx_eo_soumission_versions_soumission ON eo_soumission_versions(soumission_id);

-- D&O (responsabilité des administrateurs et dirigeants) — étape 1/10 D&O.
-- Couche données uniquement (aucune route/UI à cette étape).
-- Règle d'or : archive 0/1 partout, jamais de DELETE métier.
-- Dirigeants en nombre illimité (blocs répétables par soumission).
-- Garanties : une fiche par soumission (limite par sinistre, limite agrégat,
-- franchise, base réclamations-présentées/occurrences — le D&O est typiquement
-- en base réclamations présentées (claims-made) —, avenants DO-* du catalogue).
-- Antécédents : une fiche par soumission (réclamations D&O 5 ans en JSON,
-- poursuites ou actions en justice en cours/envisagées).
CREATE TABLE IF NOT EXISTS do_soumissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','soumise','convertie_police')),
  date_effet_souhaitee TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_do_soumissions_cabinet ON do_soumissions(cabinet_id, archive);

CREATE TABLE IF NOT EXISTS do_dirigeants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES do_soumissions(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,               -- nom du dirigeant / administrateur
  fonction TEXT,                   -- titre (président, vice-président, trésorier, secrétaire, administrateur, directeur général)
  annees_experience INTEGER,       -- années d'expérience dans cette fonction
  antecedents_personnels TEXT,     -- réclamations ou poursuites personnelles antérieures (néant = bon risque)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_do_dirigeants_soumission ON do_dirigeants(soumission_id, archive);

CREATE TABLE IF NOT EXISTS do_garanties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES do_soumissions(id) ON DELETE CASCADE,
  limite_par_sinistre REAL,  -- limite par sinistre / chaque réclamation (1M, 2M, 5M…)
  limite_agregat REAL,       -- agrégat annuel
  franchise REAL,
  base TEXT CHECK (base IN ('reclamations_presentees','occurrences')),
                             -- base de garantie : réclamations présentées (claims-made,
                             -- la forme courante en D&O) ou occurrences (survenance)
  avenants TEXT,             -- JSON : {frais_defense:1, pratiques_emploi:1, fidelite_crime:1}
                             -- (1 = présent — frais_defense = code DO-FRAIS du catalogue commercial)
  prime REAL,                -- remplie à la tarification (nullable)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_do_garanties_soumission ON do_garanties(soumission_id);

CREATE TABLE IF NOT EXISTS do_antecedents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES do_soumissions(id) ON DELETE CASCADE,
  assureur_actuel TEXT,
  numero_police_actuelle TEXT,
  date_expiration_actuelle TEXT,
  annees_assurance_continue INTEGER,
  reclamations_5ans TEXT,    -- JSON : [{date, nature, montant, sinistre}] (sinistre = réclamé ou non)
  poursuites_en_cours TEXT,  -- poursuites ou actions en justice en cours ou envisagées
                             -- (la question clé du questionnaire D&O en base réclamations-présentées)
  consentements TEXT,        -- JSON : {credit:{accepte,date}, ...}
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_do_antecedents_soumission ON do_antecedents(soumission_id);

-- Historique des versions d'une soumission D&O (règle d'or : rien ne se supprime,
-- traçabilité complète comme les notes de conformité).
-- v1 = création ; chaque modification (dirigeant, garanties, antécédents, statut)
-- applique le changement PUIS fige le nouvel état en v(n+1).
-- L'état précédent reste consultable en lecture seule dans v(n).
CREATE TABLE IF NOT EXISTS do_soumission_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  soumission_id INTEGER NOT NULL REFERENCES do_soumissions(id) ON DELETE CASCADE,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  version INTEGER NOT NULL,
  statut TEXT NOT NULL,
  notes TEXT,
  date_effet_souhaitee TEXT,
  donnees TEXT NOT NULL,   -- JSON : {dirigeants:[...], garanties, antecedents}
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id),
  UNIQUE (soumission_id, version)
);
CREATE INDEX IF NOT EXISTS idx_do_soumission_versions_soumission ON do_soumission_versions(soumission_id);

-- Perte d'exploitation / interruption des affaires (business interruption) —
-- étape 1/10 perte d'exploitation. Couche données uniquement (aucune route/UI
-- à cette étape). Règle d'or : archive 0/1 partout, jamais de DELETE métier.
-- Établissements en nombre illimité (blocs répétables par soumission :
-- usine, entrepôt, magasin, fournil, restaurant, bureau…).
-- Garanties : une fiche par soumission (limite, période d'indemnité 12/18/24 mois,
-- franchise en jours / délai de carence, base d'indemnité bénéfice brut /
-- marge brute / chiffre d'affaires, avenants PE-* du catalogue).
-- Antécédents : une fiche par soumission (interruptions 5 ans en JSON :
-- incendie, bris d'équipement, panne d'électricité, tempête, inondation…).
CREATE TABLE IF NOT EXISTS pe_soumissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','soumise','convertie_police')),
  date_effet_souhaitee TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pe_soumissions_cabinet ON pe_soumissions(cabinet_id, archive);

CREATE TABLE IF NOT EXISTS pe_etablissements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES pe_soumissions(id) ON DELETE CASCADE,
  nom_lieu TEXT,                 -- nom du lieu (fournil, magasin, entrepôt, siège…)
  adresse TEXT,                  -- adresse de l'établissement assuré
  occupation TEXT,               -- occupation / activité à ce lieu (boulangerie, détail, entreposage…)
  chiffre_affaires REAL,         -- chiffre d'affaires annuel de ce lieu ($)
  superficie REAL,               -- superficie du lieu (m² ou pi²)
  annee_construction INTEGER,    -- année de construction du bâtiment
  base_valeur TEXT CHECK (base_valeur IN ('remplacement','depreciation')),
                                 -- base de valeur du bâtiment : coût de remplacement ou valeur dépréciée
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pe_etablissements_soumission ON pe_etablissements(soumission_id, archive);

CREATE TABLE IF NOT EXISTS pe_garanties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES pe_soumissions(id) ON DELETE CASCADE,
  limite REAL,                            -- limite d'indemnité globale ($)
  periode_indemnite_mois INTEGER CHECK (periode_indemnite_mois IN (12,18,24)),
                                          -- période d'indemnité : 12, 18 ou 24 mois
  franchise_jours INTEGER,                -- franchise / délai de carence en jours (typique 3, 5, 7 j — 72 h = 3 j)
  base_montant TEXT CHECK (base_montant IN ('benefice_brut','marge_brute','chiffre_affaires')),
                                          -- base d'indemnité : bénéfice brut, marge brute ou chiffre d'affaires
  avenants TEXT,                           -- JSON : {frais_supplementaires:1, dependance_fournisseurs:1,
                                          --          acces_civil:1, deterioration_stocks:1} (1 = présent)
  prime REAL,                             -- remplie à la tarification (nullable)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_pe_garanties_soumission ON pe_garanties(soumission_id);

CREATE TABLE IF NOT EXISTS pe_antecedents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES pe_soumissions(id) ON DELETE CASCADE,
  assureur_actuel TEXT,
  numero_police_actuelle TEXT,
  date_expiration_actuelle TEXT,
  annees_assurance_continue INTEGER,
  interruptions_5ans TEXT,  -- JSON : [{date, cause, duree_jours, montant}]
                            -- cause : incendie, bris d'équipement, panne d'électricité,
                            --         tempête, inondation, autre
  consentements TEXT,       -- JSON : {credit:{accepte,date}, dossier_assurance:{...}}
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_pe_antecedents_soumission ON pe_antecedents(soumission_id);

-- Historique des versions d'une soumission perte d'exploitation (règle d'or :
-- rien ne se supprime, traçabilité complète comme les notes de conformité).
-- v1 = création ; chaque modification (établissement, garanties, antécédents,
-- statut) applique le changement PUIS fige le nouvel état en v(n+1).
-- L'état précédent reste consultable en lecture seule dans v(n).
CREATE TABLE IF NOT EXISTS pe_soumission_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  soumission_id INTEGER NOT NULL REFERENCES pe_soumissions(id) ON DELETE CASCADE,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  version INTEGER NOT NULL,
  statut TEXT NOT NULL,
  notes TEXT,
  date_effet_souhaitee TEXT,
  donnees TEXT NOT NULL,   -- JSON : {etablissements:[...], garanties, antecedents}
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id),
  UNIQUE (soumission_id, version)
);
CREATE INDEX IF NOT EXISTS idx_pe_soumission_versions_soumission ON pe_soumission_versions(soumission_id);

-- Flotte automobile commerciale (police flotte, ligne 'flotte') —
-- étape 1/10 flotte. Couche données uniquement (aucune route/UI à cette étape).
-- Règle d'or : archive 0/1 partout, jamais de DELETE métier.
-- Véhicules et conducteurs en nombre illimité (blocs répétables par soumission),
-- modèle calqué sur FPQ1 (lib/fpq1.js : NIV, usage, rayon, permis, sinistres).
-- Garanties : une fiche par soumission (limite RC, franchises collision /
-- versement, avenants FAQ en JSON — mêmes clés courtes que FPQ1 : faq43 valeur
-- à neuf, faq20 privation de jouissance, faq27 véhicule n'appartenant pas à
-- l'assuré / location, faq34 assurance de personnes, faq5a crédit-bail).
-- Antécédents : une fiche par soumission (sinistres flotte 5 ans en JSON).
CREATE TABLE IF NOT EXISTS flotte_soumissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','soumise','convertie_police')),
  assureur TEXT,              -- assureur visé ou actuel, si connu
  numero_police TEXT,         -- numéro de police, si connu (flotte en vigueur / conversion)
  responsable_id INTEGER REFERENCES users(id),
  nb_vehicules INTEGER,       -- nombre de véhicules de la flotte (déclaré)
  rayon_operation_km INTEGER, -- rayon d'opération principal (km)
  usage_dominant TEXT CHECK (usage_dominant IN ('livraison','service','transport_marchandises','personnel','mixte')),
  date_effet_souhaitee TEXT,
  date_echeance_visee TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_flotte_soumissions_cabinet ON flotte_soumissions(cabinet_id, archive);

CREATE TABLE IF NOT EXISTS flotte_conducteurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES flotte_soumissions(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  date_naissance TEXT,
  age INTEGER,                -- âge déclaré si la date de naissance n'est pas connue
  numero_permis TEXT,
  classe_permis TEXT,         -- classe du permis (ex. 5, 3, 1)
  annees_experience INTEGER,          -- années d'expérience de conduite
  annees_experience_lourds INTEGER,   -- années d'expérience véhicules lourds, si applicable
  date_embauche TEXT,
  sinistres_5ans TEXT,        -- JSON : [{date, description, montant, responsabilite}]
  infractions_3ans TEXT,      -- JSON : [{date, type, description, points}]
  formations TEXT,            -- JSON : [{formation, date, organisme}] (ex. conduite préventive)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_flotte_conducteurs_soumission ON flotte_conducteurs(soumission_id, archive);

CREATE TABLE IF NOT EXISTS flotte_vehicules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES flotte_soumissions(id) ON DELETE CASCADE,
  niv TEXT,                   -- numéro d'identification du véhicule (VIN)
  annee INTEGER,
  marque TEXT,
  modele TEXT,
  type_vehicule TEXT CHECK (type_vehicule IN ('camion','automobile','remorque','equipement')),
  usage TEXT CHECK (usage IN ('livraison','service','transport_marchandises','personnel')),
  rayon_operation_km INTEGER, -- rayon d'opération de ce véhicule (km)
  lieu_remisage TEXT,         -- lieu de remisage habituel
  valeur REAL,                -- valeur du véhicule ($)
  annee_acquisition INTEGER,
  conducteur_principal_id INTEGER REFERENCES flotte_conducteurs(id) ON DELETE SET NULL,
  conducteur_principal_nom TEXT, -- conducteur principal en texte libre si pas de fiche liée
  equipements_speciaux TEXT,  -- JSON : [{description, valeur}] (hayon, grue, réfrigération…)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_flotte_vehicules_soumission ON flotte_vehicules(soumission_id, archive);

CREATE TABLE IF NOT EXISTS flotte_garanties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES flotte_soumissions(id) ON DELETE CASCADE,
  limite_rc REAL,             -- limite de responsabilité civile ($) — ex. 1 000 000 / 2 000 000
  franchise_collision REAL,   -- franchise collision ($)
  franchise_versement REAL,   -- franchise versement / tous risques ($)
  avenants TEXT,              -- JSON : {faq43:1, faq20:1, faq27:1, faq34:1, faq5a:1} (clés FPQ1, 1 = présent)
  prime REAL,                 -- remplie à la tarification (nullable)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_flotte_garanties_soumission ON flotte_garanties(soumission_id);

CREATE TABLE IF NOT EXISTS flotte_antecedents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES flotte_soumissions(id) ON DELETE CASCADE,
  assureur_actuel TEXT,
  numero_police_actuelle TEXT,
  date_expiration_actuelle TEXT,
  annees_assurance_flotte_continue INTEGER,
  sinistres_flotte_5ans TEXT, -- JSON : [{date, description, montant}]
  ratio_pertes REAL,          -- ratio de pertes (loss ratio) si connu, en %
  refus_annulation_ant INTEGER NOT NULL DEFAULT 0, -- refus ou annulation par un assureur
  refus_annulation_details TEXT,
  consentements TEXT,         -- JSON : {credit:{accepte,date}, dossier_saaq:{accepte,date}, fcsa:{accepte,date}}
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_flotte_antecedents_soumission ON flotte_antecedents(soumission_id);

-- Historique des versions d'une soumission flotte (règle d'or : rien ne se
-- supprime, traçabilité complète comme les notes de conformité).
-- v1 = création ; chaque modification (véhicule, conducteur, garanties,
-- antécédents, en-tête, statut) applique le changement PUIS fige le nouvel
-- état en v(n+1). L'état précédent reste consultable en lecture seule dans v(n).
CREATE TABLE IF NOT EXISTS flotte_soumission_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  soumission_id INTEGER NOT NULL REFERENCES flotte_soumissions(id) ON DELETE CASCADE,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  version INTEGER NOT NULL,
  statut TEXT NOT NULL,
  notes TEXT,
  date_effet_souhaitee TEXT,
  donnees TEXT NOT NULL,   -- JSON : {vehicules:[...], conducteurs:[...], garanties, antecedents}
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id),
  UNIQUE (soumission_id, version)
);
CREATE INDEX IF NOT EXISTS idx_flotte_soumission_versions_soumission ON flotte_soumission_versions(soumission_id);

-- Cautionnement commercial (ligne 'cautionnement') — étape 1/10 cautionnement.
-- Couche données uniquement (aucune route/UI à cette étape).
-- Règle d'or : archive 0/1 partout, jamais de DELETE métier.
-- Le cautionnement n'est PAS une assurance : garantie à TROIS parties —
-- la caution (assureur, ex. Intact Cautionnement), le principal/débiteur
-- (l'entrepreneur, ici l'entreprise cliente) et le bénéficiaire/obligé
-- (le donneur d'ouvrage). Les cautionnements demandés (obligations) sont en
-- nombre illimité par soumission : soumission (bid bond), exécution
-- (performance, typiquement 50 % du contrat), paiement de la main-d'œuvre et
-- des matériaux, licence RBQ (20 000 $ spécialisés / 40 000 $ généraux), autre.
-- Garanties : une fiche par soumission = la LIGNE de cautionnement accordée
-- (limite globale = capacité après analyse des états financiers, limite par
-- projet, fonds de roulement, valeur nette).
-- Antécédents : une fiche par soumission (réclamations contre des
-- cautionnements 5 ans en JSON).
CREATE TABLE IF NOT EXISTS caut_soumissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','soumise','convertie_police')),
  assureur TEXT,              -- caution visée ou actuelle, si connue
  numero_police TEXT,         -- numéro de police / de ligne, si connu
  responsable_id INTEGER REFERENCES users(id),
  secteur_activite TEXT,      -- secteur du principal (ex. construction — entrepreneur général)
  annee_fondation INTEGER,    -- année de fondation de l'entreprise du principal
  chiffre_affaires REAL,      -- chiffre d'affaires annuel du principal ($)
  nb_employes INTEGER,        -- nombre d'employés du principal
  date_effet_souhaitee TEXT,
  date_echeance_visee TEXT,
  notes TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_caut_soumissions_cabinet ON caut_soumissions(cabinet_id, archive);

CREATE TABLE IF NOT EXISTS caut_obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES caut_soumissions(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('soumission','execution','paiement_mo','rbq','autre')),
  beneficiaire TEXT,          -- bénéficiaire / obligé (donneur d'ouvrage)
  description_projet TEXT,    -- description du projet / des travaux
  montant_contrat REAL,       -- montant du contrat visé ($), si applicable
  montant_cautionnement REAL, -- montant du cautionnement demandé ($)
  taux_pct REAL,              -- taux de prime (%), si connu
  prime_estimee REAL,         -- prime estimée ($)
  date_debut TEXT,            -- date de début visée
  duree_mois INTEGER,         -- durée du projet / de l'obligation (mois)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_caut_obligations_soumission ON caut_obligations(soumission_id, archive);

CREATE TABLE IF NOT EXISTS caut_garanties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES caut_soumissions(id) ON DELETE CASCADE,
  limite_globale REAL,        -- limite globale de la ligne (capacité totale, $)
  limite_par_projet REAL,     -- limite par projet (capacité par contrat, $)
  fonds_roulement REAL,       -- fonds de roulement du principal ($, critère clé de la caution)
  valeur_nette REAL,          -- valeur nette / avoir des actionnaires ($)
  prime REAL,                 -- prime de la ligne, remplie à la tarification (nullable)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_caut_garanties_soumission ON caut_garanties(soumission_id);

CREATE TABLE IF NOT EXISTS caut_antecedents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES caut_soumissions(id) ON DELETE CASCADE,
  assureur_actuel TEXT,           -- caution actuelle
  numero_ligne_actuelle TEXT,     -- numéro de la ligne / police actuelle
  date_expiration_actuelle TEXT,
  annees_cautionnement_continu INTEGER,
  reclamations_5ans TEXT,     -- JSON : [{date, cautionnement, montant, statut}]
  refus_resiliation_ant INTEGER NOT NULL DEFAULT 0, -- refus ou résiliation de cautionnement
  refus_resiliation_details TEXT,
  consentements TEXT,         -- JSON : {credit:{accepte,date}, etats_financiers:{accepte,date}}
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (soumission_id)
);
CREATE INDEX IF NOT EXISTS idx_caut_antecedents_soumission ON caut_antecedents(soumission_id);

-- Historique des versions d'une soumission cautionnement (règle d'or).
-- v1 = création ; chaque modification (obligations, ligne, antécédents,
-- en-tête, statut) applique le changement PUIS fige le nouvel état en v(n+1).
CREATE TABLE IF NOT EXISTS caut_soumission_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  soumission_id INTEGER NOT NULL REFERENCES caut_soumissions(id) ON DELETE CASCADE,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  version INTEGER NOT NULL,
  statut TEXT NOT NULL,
  notes TEXT,
  date_effet_souhaitee TEXT,
  donnees TEXT NOT NULL,   -- JSON : {obligations:[...], garanties, antecedents}
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES users(id),
  UNIQUE (soumission_id, version)
);
CREATE INDEX IF NOT EXISTS idx_caut_soumission_versions_soumission ON caut_soumission_versions(soumission_id);

-- Vérification automatique des avenants : le document de retour de
-- l'assureur (déposé sur la fiche police, ou pièce jointe d'un courriel
-- déjà classé sur cette police) est analysé par le moteur de documents,
-- puis comparé champ par champ à l'état DEMANDÉ (l'état courant de la
-- fiche produit de la police). Le rapport propose des verdicts
-- (conforme / écart / absent / à confirmer / surplus) — l'humain tranche
-- (« Marquer comme vérifiée »), aucun correctif ne part tout seul.
-- Règle d'or : jamais supprimée (archivage doux).
CREATE TABLE IF NOT EXISTS verifications_avenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  police_id INTEGER NOT NULL REFERENCES polices(id),
  produit TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('document','piece_jointe_courriel')),
  source_id INTEGER,          -- document : id de l'analyse ; pièce jointe : id courriel_pieces_jointes
  analyse_id INTEGER REFERENCES analyses_documents(id),
  rapport TEXT,               -- JSON : { lignes: [...], compteurs: {...}, meta: {...} }
  statut TEXT NOT NULL DEFAULT 'a_confirmer'
    CHECK (statut IN ('conforme','ecarts','a_confirmer')),
  verifiee_par INTEGER REFERENCES users(id),
  verifiee_le TEXT,
  correction_destinataire TEXT,
  correction_sujet TEXT,
  correction_corps TEXT,
  correction_envoyee_le TEXT,
  correction_mode_envoi TEXT, -- 'smtp' | 'simule'
  correction_message_id TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_par INTEGER REFERENCES users(id),
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_verif_avenants_police ON verifications_avenants(police_id, archive);
CREATE INDEX IF NOT EXISTS idx_verif_avenants_cabinet ON verifications_avenants(cabinet_id, statut);
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

// listes_proposees sur analyses_documents (Analyse IA v2 : listes complètes)
if (!colonneExiste('analyses_documents', 'listes_proposees')) {
  bd.exec('ALTER TABLE analyses_documents ADD COLUMN listes_proposees TEXT');
}

// Boucle courriel : lien d'une analyse vers la demande d'informations et le
// courriel de réponse dont elle provient, et réponses ciblées proposées.
if (!colonneExiste('analyses_documents', 'demande_info_id')) {
  bd.exec('ALTER TABLE analyses_documents ADD COLUMN demande_info_id INTEGER REFERENCES demandes_infos(id)');
}
if (!colonneExiste('analyses_documents', 'courriel_id')) {
  bd.exec('ALTER TABLE analyses_documents ADD COLUMN courriel_id INTEGER REFERENCES courriels(id)');
}
if (!colonneExiste('analyses_documents', 'reponses_ciblees')) {
  bd.exec('ALTER TABLE analyses_documents ADD COLUMN reponses_ciblees TEXT');
}

// Boucle courriel : fil de réponse des courriels reçus (In-Reply-To) pour
// rattacher une réponse à la demande d'informations envoyée.
if (!colonneExiste('courriels', 'en_reponse_a')) {
  bd.exec('ALTER TABLE courriels ADD COLUMN en_reponse_a TEXT');
}

// Classement intelligent des courriels (lib/classement-courriels.js) : lien
// vers une police précise et trace transparente de la méthode de classement
// (numéro de police repéré, adresse connue, nom d'entreprise, fil, manuel).
if (!colonneExiste('courriels', 'police_id')) {
  bd.exec('ALTER TABLE courriels ADD COLUMN police_id INTEGER REFERENCES polices(id)');
}
if (!colonneExiste('courriels', 'classement_methode')) {
  bd.exec('ALTER TABLE courriels ADD COLUMN classement_methode TEXT');
}
if (!colonneExiste('courriels', 'classement_detail')) {
  bd.exec('ALTER TABLE courriels ADD COLUMN classement_detail TEXT');
}
bd.exec('CREATE INDEX IF NOT EXISTS idx_courriels_police ON courriels(police_id)');

// Ouverture de dossier à la voix + enrichissement Google Maps (API Places) :
// clé Places du cabinet, chiffrée au repos dans reglages_ia (même pattern
// que la clé Cohere) ; identifiant Google de l'entreprise et coordonnées
// enrichies sur la fiche client (le place_id sert à repérer un doublon).
if (!colonneExiste('reglages_ia', 'cle_google_chiffree')) {
  bd.exec('ALTER TABLE reglages_ia ADD COLUMN cle_google_chiffree TEXT');
}

// Moteur IA Augure (canadien, API compatible OpenAI) : clé du cabinet
// chiffrée au repos dans reglages_ia (même pattern que Cohere/Google) et
// modèle choisi. Le choix du moteur gagne la valeur 'augure' : SQLite ne
// permet pas de modifier un CHECK, on reconstruit la table en préservant
// toutes les colonnes existantes (liste lue depuis le schéma réel).
if (!colonneExiste('reglages_ia', 'cle_augure_chiffree')) {
  bd.exec('ALTER TABLE reglages_ia ADD COLUMN cle_augure_chiffree TEXT');
}
if (!colonneExiste('reglages_ia', 'modele_augure')) {
  bd.exec("ALTER TABLE reglages_ia ADD COLUMN modele_augure TEXT NOT NULL DEFAULT 'ossington-5'");
}
const sqlReglagesIa = bd.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reglages_ia'").get();
if (sqlReglagesIa && !sqlReglagesIa.sql.includes("'augure'")) {
  const colsReglages = bd.prepare('PRAGMA table_info(reglages_ia)').all().map((c) => c.name);
  const listeCols = colsReglages.join(', ');
  bd.exec('PRAGMA foreign_keys = OFF');
  try {
    bd.exec(`
      CREATE TABLE reglages_ia_new (
        cabinet_id INTEGER PRIMARY KEY REFERENCES cabinets(id),
        cle_cohere_chiffree TEXT,
        moteur TEXT NOT NULL DEFAULT 'auto' CHECK (moteur IN ('local','cohere','augure','auto')),
        maj_le TEXT NOT NULL DEFAULT (datetime('now')),
        cle_google_chiffree TEXT,
        cle_augure_chiffree TEXT,
        modele_augure TEXT NOT NULL DEFAULT 'ossington-5'
      );
      INSERT INTO reglages_ia_new (${listeCols}) SELECT ${listeCols} FROM reglages_ia;
      DROP TABLE reglages_ia;
      ALTER TABLE reglages_ia_new RENAME TO reglages_ia;
    `);
  } finally {
    bd.exec('PRAGMA foreign_keys = ON');
  }
}
if (!colonneExiste('clients', 'place_id_google')) {
  bd.exec('ALTER TABLE clients ADD COLUMN place_id_google TEXT');
}
if (!colonneExiste('clients', 'site_web')) {
  bd.exec('ALTER TABLE clients ADD COLUMN site_web TEXT');
}
if (!colonneExiste('clients', 'province')) {
  bd.exec('ALTER TABLE clients ADD COLUMN province TEXT');
}
bd.exec('CREATE INDEX IF NOT EXISTS idx_clients_place ON clients(cabinet_id, place_id_google)');

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

// --- Rôles élargis (2026-10-09) : manager, expert_sinistre ------------------------------
// SQLite ne permet pas de modifier un CHECK : on recrée la table users.
// On ne recopie que les colonnes présentes dans l'ancienne table (robustesse
// pour les bases très anciennes) ; les manquantes prennent leur défaut.
const sqlUsers = (bd.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`).get() || {}).sql || '';
if (!sqlUsers.includes("'manager'")) {
  const colsOld = bd.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
  const colsNew = ['id', 'cabinet_id', 'email', 'mot_de_passe_hash', 'role', 'nom', 'manager_id', 'totp_secret',
    'totp_actif', 'doit_changer_mot_de_passe', 'actif', 'cree_le'];
  const communes = colsNew.filter((c) => colsOld.includes(c));
  const mig = bd.transaction(() => {
    bd.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
        email TEXT NOT NULL UNIQUE,
        mot_de_passe_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','manager','courtier','expert_sinistre','adjoint')),
        nom TEXT NOT NULL,
        manager_id INTEGER REFERENCES users(id),
        totp_secret TEXT,
        totp_actif INTEGER NOT NULL DEFAULT 0,
        doit_changer_mot_de_passe INTEGER NOT NULL DEFAULT 0,
        actif INTEGER NOT NULL DEFAULT 1,
        cree_le TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (${communes.join(', ')}) SELECT ${communes.join(', ')} FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  });
  mig();
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

// --- Assureurs : contacts comptabilité + équipes (2026-10-10) ----------------------
for (const col of ['compta_nom', 'compta_telephone', 'compta_courriel']) {
  if (!colonneExiste('assureurs', col)) {
    bd.exec(`ALTER TABLE assureurs ADD COLUMN ${col} TEXT`);
  }
}
if (!colonneExiste('users', 'manager_id')) {
  bd.exec('ALTER TABLE users ADD COLUMN manager_id INTEGER REFERENCES users(id)');
}

// --- Biens étape 3/10 : lien soumission biens → police (mêmes conventions que l'auto) --
// SQLite ne permet pas d'ajouter une contrainte UNIQUE : on reconstruit la table.
// Contrairement à la migration FPQ1 (qui s'exécutait à l'introduction des colonnes,
// donc sans données), on préserve ici les colonnes auto_soumission_* existantes.
const sqlPolB3 = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get();
if (sqlPolB3 && !sqlPolB3.sql.includes('biens_soumission_id')) {
  bd.exec('PRAGMA foreign_keys = OFF');
  try {
    const colsAncB = bd.prepare('PRAGMA table_info(polices)').all().map((c) => c.name);
    const colsCiblesB = ['id', 'cabinet_id', 'client_id', 'ligne', 'assureur', 'numero_police',
      'date_effet', 'date_echeance', 'franchise', 'statut', 'notes', 'responsable_id',
      'assureur_id', 'auto_soumission_id', 'auto_soumission_version', 'cree_le'];
    const communesB = colsCiblesB.filter((c) => colsAncB.includes(c));
    const selectColsB = communesB.map((c) =>
      (c === 'date_effet' || c === 'date_echeance') ? `COALESCE(${c}, '1900-01-01') AS ${c}` : c
    );
    bd.exec(`
      CREATE TABLE polices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        ligne TEXT NOT NULL CHECK (ligne IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
        assureur TEXT NOT NULL,
        numero_police TEXT NOT NULL,
        date_effet TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        franchise REAL NOT NULL DEFAULT 0,
        statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active','a_renouveler','resiliee')),
        notes TEXT,
        responsable_id INTEGER REFERENCES users(id),
        assureur_id INTEGER REFERENCES assureurs(id),
        auto_soumission_id INTEGER REFERENCES auto_soumissions(id),
        auto_soumission_version INTEGER,
        biens_soumission_id INTEGER REFERENCES biens_soumissions(id),
        biens_soumission_version INTEGER,
        cree_le TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (cabinet_id, numero_police),
        UNIQUE (auto_soumission_id),
        UNIQUE (biens_soumission_id)
      );
      INSERT INTO polices_new (${communesB.join(', ')})
      SELECT ${selectColsB.join(', ')} FROM polices;
      DROP TABLE polices;
      ALTER TABLE polices_new RENAME TO polices;
      CREATE INDEX IF NOT EXISTS idx_polices_cabinet ON polices(cabinet_id);
      CREATE INDEX IF NOT EXISTS idx_polices_echeance ON polices(date_echeance);
    `);
  } finally {
    bd.exec('PRAGMA foreign_keys = ON');
  }
}
// --- RC étape 3/10 : lien soumission RC → police (mêmes conventions que les biens) --
// SQLite ne permet pas d'ajouter une contrainte UNIQUE : on reconstruit la table.
// On préserve ici les colonnes auto_soumission_* et biens_soumission_* existantes.
const sqlPolR3 = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get();
if (sqlPolR3 && !sqlPolR3.sql.includes('rc_soumission_id')) {
  bd.exec('PRAGMA foreign_keys = OFF');
  try {
    const colsAncR = bd.prepare('PRAGMA table_info(polices)').all().map((c) => c.name);
    const colsCiblesR = ['id', 'cabinet_id', 'client_id', 'ligne', 'assureur', 'numero_police',
      'date_effet', 'date_echeance', 'franchise', 'statut', 'notes', 'responsable_id',
      'assureur_id', 'auto_soumission_id', 'auto_soumission_version',
      'biens_soumission_id', 'biens_soumission_version', 'cree_le'];
    const communesR = colsCiblesR.filter((c) => colsAncR.includes(c));
    const selectColsR = communesR.map((c) =>
      (c === 'date_effet' || c === 'date_echeance') ? `COALESCE(${c}, '1900-01-01') AS ${c}` : c
    );
    bd.exec(`
      CREATE TABLE polices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        ligne TEXT NOT NULL CHECK (ligne IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
        assureur TEXT NOT NULL,
        numero_police TEXT NOT NULL,
        date_effet TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        franchise REAL NOT NULL DEFAULT 0,
        statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active','a_renouveler','resiliee')),
        notes TEXT,
        responsable_id INTEGER REFERENCES users(id),
        assureur_id INTEGER REFERENCES assureurs(id),
        auto_soumission_id INTEGER REFERENCES auto_soumissions(id),
        auto_soumission_version INTEGER,
        biens_soumission_id INTEGER REFERENCES biens_soumissions(id),
        biens_soumission_version INTEGER,
        rc_soumission_id INTEGER REFERENCES rc_soumissions(id),
        rc_soumission_version INTEGER,
        cree_le TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (cabinet_id, numero_police),
        UNIQUE (auto_soumission_id),
        UNIQUE (biens_soumission_id),
        UNIQUE (rc_soumission_id)
      );
      INSERT INTO polices_new (${communesR.join(', ')})
      SELECT ${selectColsR.join(', ')} FROM polices;
      DROP TABLE polices;
      ALTER TABLE polices_new RENAME TO polices;
      CREATE INDEX IF NOT EXISTS idx_polices_cabinet ON polices(cabinet_id);
      CREATE INDEX IF NOT EXISTS idx_polices_echeance ON polices(date_echeance);
    `);
  } finally {
    bd.exec('PRAGMA foreign_keys = ON');
  }
}
// --- Cyber étape 3/10 : lien soumission cyber → police (mêmes conventions que la RC) --
// SQLite ne permet pas d'ajouter une contrainte UNIQUE : on reconstruit la table.
// On préserve ici les colonnes auto_soumission_*, biens_soumission_* et rc_soumission_* existantes.
const sqlPolC3 = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get();
if (sqlPolC3 && !sqlPolC3.sql.includes('cyber_soumission_id')) {
  bd.exec('PRAGMA foreign_keys = OFF');
  try {
    const colsAncC = bd.prepare('PRAGMA table_info(polices)').all().map((c) => c.name);
    const colsCiblesC = ['id', 'cabinet_id', 'client_id', 'ligne', 'assureur', 'numero_police',
      'date_effet', 'date_echeance', 'franchise', 'statut', 'notes', 'responsable_id',
      'assureur_id', 'auto_soumission_id', 'auto_soumission_version',
      'biens_soumission_id', 'biens_soumission_version',
      'rc_soumission_id', 'rc_soumission_version', 'cree_le'];
    const communesC = colsCiblesC.filter((c) => colsAncC.includes(c));
    const selectColsC = communesC.map((c) =>
      (c === 'date_effet' || c === 'date_echeance') ? `COALESCE(${c}, '1900-01-01') AS ${c}` : c
    );
    bd.exec(`
      CREATE TABLE polices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        ligne TEXT NOT NULL CHECK (ligne IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
        assureur TEXT NOT NULL,
        numero_police TEXT NOT NULL,
        date_effet TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        franchise REAL NOT NULL DEFAULT 0,
        statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active','a_renouveler','resiliee')),
        notes TEXT,
        responsable_id INTEGER REFERENCES users(id),
        assureur_id INTEGER REFERENCES assureurs(id),
        auto_soumission_id INTEGER REFERENCES auto_soumissions(id),
        auto_soumission_version INTEGER,
        biens_soumission_id INTEGER REFERENCES biens_soumissions(id),
        biens_soumission_version INTEGER,
        rc_soumission_id INTEGER REFERENCES rc_soumissions(id),
        rc_soumission_version INTEGER,
        cyber_soumission_id INTEGER REFERENCES cyber_soumissions(id),
        cyber_soumission_version INTEGER,
        cree_le TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (cabinet_id, numero_police),
        UNIQUE (auto_soumission_id),
        UNIQUE (biens_soumission_id),
        UNIQUE (rc_soumission_id),
        UNIQUE (cyber_soumission_id)
      );
      INSERT INTO polices_new (${communesC.join(', ')})
      SELECT ${selectColsC.join(', ')} FROM polices;
      DROP TABLE polices;
      ALTER TABLE polices_new RENAME TO polices;
      CREATE INDEX IF NOT EXISTS idx_polices_cabinet ON polices(cabinet_id);
      CREATE INDEX IF NOT EXISTS idx_polices_echeance ON polices(date_echeance);
    `);
  } finally {
    bd.exec('PRAGMA foreign_keys = ON');
  }
}
// --- E&O étape 3/10 : lien soumission E&O → police (mêmes conventions que cyber/RC) --
// SQLite ne permet pas d'ajouter une contrainte UNIQUE : on reconstruit la table.
// On préserve ici les colonnes auto_soumission_*, biens_soumission_*, rc_soumission_*
// et cyber_soumission_* existantes.
const sqlPolE3 = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get();
if (sqlPolE3 && !sqlPolE3.sql.includes('eo_soumission_id')) {
  bd.exec('PRAGMA foreign_keys = OFF');
  try {
    const colsAncE = bd.prepare('PRAGMA table_info(polices)').all().map((c) => c.name);
    const colsCiblesE = ['id', 'cabinet_id', 'client_id', 'ligne', 'assureur', 'numero_police',
      'date_effet', 'date_echeance', 'franchise', 'statut', 'notes', 'responsable_id',
      'assureur_id', 'auto_soumission_id', 'auto_soumission_version',
      'biens_soumission_id', 'biens_soumission_version',
      'rc_soumission_id', 'rc_soumission_version',
      'cyber_soumission_id', 'cyber_soumission_version', 'cree_le'];
    const communesE = colsCiblesE.filter((c) => colsAncE.includes(c));
    const selectColsE = communesE.map((c) =>
      (c === 'date_effet' || c === 'date_echeance') ? `COALESCE(${c}, '1900-01-01') AS ${c}` : c
    );
    bd.exec(`
      CREATE TABLE polices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        ligne TEXT NOT NULL CHECK (ligne IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
        assureur TEXT NOT NULL,
        numero_police TEXT NOT NULL,
        date_effet TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        franchise REAL NOT NULL DEFAULT 0,
        statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active','a_renouveler','resiliee')),
        notes TEXT,
        responsable_id INTEGER REFERENCES users(id),
        assureur_id INTEGER REFERENCES assureurs(id),
        auto_soumission_id INTEGER REFERENCES auto_soumissions(id),
        auto_soumission_version INTEGER,
        biens_soumission_id INTEGER REFERENCES biens_soumissions(id),
        biens_soumission_version INTEGER,
        rc_soumission_id INTEGER REFERENCES rc_soumissions(id),
        rc_soumission_version INTEGER,
        cyber_soumission_id INTEGER REFERENCES cyber_soumissions(id),
        cyber_soumission_version INTEGER,
        eo_soumission_id INTEGER REFERENCES eo_soumissions(id),
        eo_soumission_version INTEGER,
        cree_le TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (cabinet_id, numero_police),
        UNIQUE (auto_soumission_id),
        UNIQUE (biens_soumission_id),
        UNIQUE (rc_soumission_id),
        UNIQUE (cyber_soumission_id),
        UNIQUE (eo_soumission_id)
      );
      INSERT INTO polices_new (${communesE.join(', ')})
      SELECT ${selectColsE.join(', ')} FROM polices;
      DROP TABLE polices;
      ALTER TABLE polices_new RENAME TO polices;
      CREATE INDEX IF NOT EXISTS idx_polices_cabinet ON polices(cabinet_id);
      CREATE INDEX IF NOT EXISTS idx_polices_echeance ON polices(date_echeance);
    `);
  } finally {
    bd.exec('PRAGMA foreign_keys = ON');
  }
}
// --- D&O étape 3/10 : lien soumission D&O → police (mêmes conventions que E&O/cyber/RC) --
// SQLite ne permet pas d'ajouter une contrainte UNIQUE : on reconstruit la table.
// On préserve ici les colonnes auto_soumission_*, biens_soumission_*, rc_soumission_*,
// cyber_soumission_* et eo_soumission_* existantes.
const sqlPolD3 = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get();
if (sqlPolD3 && !sqlPolD3.sql.includes('do_soumission_id')) {
  bd.exec('PRAGMA foreign_keys = OFF');
  try {
    const colsAncD = bd.prepare('PRAGMA table_info(polices)').all().map((c) => c.name);
    const colsCiblesD = ['id', 'cabinet_id', 'client_id', 'ligne', 'assureur', 'numero_police',
      'date_effet', 'date_echeance', 'franchise', 'statut', 'notes', 'responsable_id',
      'assureur_id', 'auto_soumission_id', 'auto_soumission_version',
      'biens_soumission_id', 'biens_soumission_version',
      'rc_soumission_id', 'rc_soumission_version',
      'cyber_soumission_id', 'cyber_soumission_version',
      'eo_soumission_id', 'eo_soumission_version', 'cree_le'];
    const communesD = colsCiblesD.filter((c) => colsAncD.includes(c));
    const selectColsD = communesD.map((c) =>
      (c === 'date_effet' || c === 'date_echeance') ? `COALESCE(${c}, '1900-01-01') AS ${c}` : c
    );
    bd.exec(`
      CREATE TABLE polices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        ligne TEXT NOT NULL CHECK (ligne IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
        assureur TEXT NOT NULL,
        numero_police TEXT NOT NULL,
        date_effet TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        franchise REAL NOT NULL DEFAULT 0,
        statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active','a_renouveler','resiliee')),
        notes TEXT,
        responsable_id INTEGER REFERENCES users(id),
        assureur_id INTEGER REFERENCES assureurs(id),
        auto_soumission_id INTEGER REFERENCES auto_soumissions(id),
        auto_soumission_version INTEGER,
        biens_soumission_id INTEGER REFERENCES biens_soumissions(id),
        biens_soumission_version INTEGER,
        rc_soumission_id INTEGER REFERENCES rc_soumissions(id),
        rc_soumission_version INTEGER,
        cyber_soumission_id INTEGER REFERENCES cyber_soumissions(id),
        cyber_soumission_version INTEGER,
        eo_soumission_id INTEGER REFERENCES eo_soumissions(id),
        eo_soumission_version INTEGER,
        do_soumission_id INTEGER REFERENCES do_soumissions(id),
        do_soumission_version INTEGER,
        cree_le TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (cabinet_id, numero_police),
        UNIQUE (auto_soumission_id),
        UNIQUE (biens_soumission_id),
        UNIQUE (rc_soumission_id),
        UNIQUE (cyber_soumission_id),
        UNIQUE (eo_soumission_id),
        UNIQUE (do_soumission_id)
      );
      INSERT INTO polices_new (${communesD.join(', ')})
      SELECT ${selectColsD.join(', ')} FROM polices;
      DROP TABLE polices;
      ALTER TABLE polices_new RENAME TO polices;
      CREATE INDEX IF NOT EXISTS idx_polices_cabinet ON polices(cabinet_id);
      CREATE INDEX IF NOT EXISTS idx_polices_echeance ON polices(date_echeance);
    `);
  } finally {
    bd.exec('PRAGMA foreign_keys = ON');
  }
}
// --- PE étape 3/10 : lien soumission perte d'exploitation → police (mêmes conventions que D&O) --
// SQLite ne permet pas d'ajouter une contrainte UNIQUE : on reconstruit la table.
// On préserve ici les colonnes auto_soumission_*, biens_soumission_*, rc_soumission_*,
// cyber_soumission_*, eo_soumission_* et do_soumission_* existantes.
const sqlPolPE3 = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get();
if (sqlPolPE3 && !sqlPolPE3.sql.includes('pe_soumission_id')) {
  bd.exec('PRAGMA foreign_keys = OFF');
  try {
    const colsAncPE = bd.prepare('PRAGMA table_info(polices)').all().map((c) => c.name);
    const colsCiblesPE = ['id', 'cabinet_id', 'client_id', 'ligne', 'assureur', 'numero_police',
      'date_effet', 'date_echeance', 'franchise', 'statut', 'notes', 'responsable_id',
      'assureur_id', 'auto_soumission_id', 'auto_soumission_version',
      'biens_soumission_id', 'biens_soumission_version',
      'rc_soumission_id', 'rc_soumission_version',
      'cyber_soumission_id', 'cyber_soumission_version',
      'eo_soumission_id', 'eo_soumission_version',
      'do_soumission_id', 'do_soumission_version', 'cree_le'];
    const communesPE = colsCiblesPE.filter((c) => colsAncPE.includes(c));
    const selectColsPE = communesPE.map((c) =>
      (c === 'date_effet' || c === 'date_echeance') ? `COALESCE(${c}, '1900-01-01') AS ${c}` : c
    );
    bd.exec(`
      CREATE TABLE polices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        ligne TEXT NOT NULL CHECK (ligne IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
        assureur TEXT NOT NULL,
        numero_police TEXT NOT NULL,
        date_effet TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        franchise REAL NOT NULL DEFAULT 0,
        statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active','a_renouveler','resiliee')),
        notes TEXT,
        responsable_id INTEGER REFERENCES users(id),
        assureur_id INTEGER REFERENCES assureurs(id),
        auto_soumission_id INTEGER REFERENCES auto_soumissions(id),
        auto_soumission_version INTEGER,
        biens_soumission_id INTEGER REFERENCES biens_soumissions(id),
        biens_soumission_version INTEGER,
        rc_soumission_id INTEGER REFERENCES rc_soumissions(id),
        rc_soumission_version INTEGER,
        cyber_soumission_id INTEGER REFERENCES cyber_soumissions(id),
        cyber_soumission_version INTEGER,
        eo_soumission_id INTEGER REFERENCES eo_soumissions(id),
        eo_soumission_version INTEGER,
        do_soumission_id INTEGER REFERENCES do_soumissions(id),
        do_soumission_version INTEGER,
        pe_soumission_id INTEGER REFERENCES pe_soumissions(id),
        pe_soumission_version INTEGER,
        cree_le TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (cabinet_id, numero_police),
        UNIQUE (auto_soumission_id),
        UNIQUE (biens_soumission_id),
        UNIQUE (rc_soumission_id),
        UNIQUE (cyber_soumission_id),
        UNIQUE (eo_soumission_id),
        UNIQUE (do_soumission_id),
        UNIQUE (pe_soumission_id)
      );
      INSERT INTO polices_new (${communesPE.join(', ')})
      SELECT ${selectColsPE.join(', ')} FROM polices;
      DROP TABLE polices;
      ALTER TABLE polices_new RENAME TO polices;
      CREATE INDEX IF NOT EXISTS idx_polices_cabinet ON polices(cabinet_id);
      CREATE INDEX IF NOT EXISTS idx_polices_echeance ON polices(date_echeance);
    `);
  } finally {
    bd.exec('PRAGMA foreign_keys = ON');
  }
}
// --- FPQ1 étape 3/10 : produit 'auto', lien soumission → police, note d'avenant --
// SQLite ne permet pas de modifier un CHECK : on reconstruit les tables.
const sqlPol3 = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get();
if (sqlPol3 && !sqlPol3.sql.includes("'auto'")) {
  bd.exec('PRAGMA foreign_keys = OFF');
  try {
    // Copie défensive : seules les colonnes existant dans l'ancienne table
    // (les très vieilles bases n'ont pas forcément cree_le, assureur_id…).
    const colsAnc = bd.prepare('PRAGMA table_info(polices)').all().map((c) => c.name);
    const colsCibles = ['id', 'cabinet_id', 'client_id', 'ligne', 'assureur', 'numero_police',
      'date_effet', 'date_echeance', 'franchise', 'statut', 'notes', 'responsable_id',
      'assureur_id', 'cree_le'];
    const communes = colsCibles.filter((c) => colsAnc.includes(c));
    // Les très vieilles bases de test peuvent avoir des dates NULL (colonnes
    // NOT NULL dans le vrai schéma) : valeur sentinelle, à corriger ensuite.
    const selectCols = communes.map((c) =>
      (c === 'date_effet' || c === 'date_echeance') ? `COALESCE(${c}, '1900-01-01') AS ${c}` : c
    );
    bd.exec(`
      CREATE TABLE polices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        ligne TEXT NOT NULL CHECK (ligne IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
        assureur TEXT NOT NULL,
        numero_police TEXT NOT NULL,
        date_effet TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        franchise REAL NOT NULL DEFAULT 0,
        statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active','a_renouveler','resiliee')),
        notes TEXT,
        responsable_id INTEGER REFERENCES users(id),
        assureur_id INTEGER REFERENCES assureurs(id),
        auto_soumission_id INTEGER REFERENCES auto_soumissions(id),
        auto_soumission_version INTEGER,
        cree_le TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (cabinet_id, numero_police),
        UNIQUE (auto_soumission_id)
      );
      INSERT INTO polices_new (${communes.join(', ')})
      SELECT ${selectCols.join(', ')} FROM polices;
      DROP TABLE polices;
      ALTER TABLE polices_new RENAME TO polices;
      CREATE INDEX IF NOT EXISTS idx_polices_cabinet ON polices(cabinet_id);
      CREATE INDEX IF NOT EXISTS idx_polices_echeance ON polices(date_echeance);
    `);
  } finally {
    bd.exec('PRAGMA foreign_keys = ON');
  }
}
const sqlAp3 = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'assureur_produits'").get();
if (sqlAp3 && !sqlAp3.sql.includes("'auto'")) {
  bd.exec(`
    CREATE TABLE assureur_produits_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assureur_id INTEGER NOT NULL REFERENCES assureurs(id) ON DELETE CASCADE,
      produit TEXT NOT NULL CHECK (produit IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
      commission_pct REAL,
      UNIQUE (assureur_id, produit)
    );
    INSERT INTO assureur_produits_new (id, assureur_id, produit, commission_pct)
    SELECT id, assureur_id, produit, commission_pct FROM assureur_produits;
    DROP TABLE assureur_produits;
    ALTER TABLE assureur_produits_new RENAME TO assureur_produits;
    CREATE INDEX IF NOT EXISTS idx_assureur_produits_assureur ON assureur_produits(assureur_id);
  `);
}
if (!colonneExiste('police_versions', 'avenant_note')) {
  bd.exec('ALTER TABLE police_versions ADD COLUMN avenant_note TEXT');
}
// --- Flotte étape 3/10 : lien soumission flotte → police (mêmes conventions que PE) --
// SQLite ne permet pas d'ajouter une contrainte UNIQUE : on reconstruit la table.
// On préserve ici les colonnes auto_soumission_*, biens_soumission_*, rc_soumission_*,
// cyber_soumission_*, eo_soumission_*, do_soumission_* et pe_soumission_* existantes.
const sqlPolF3 = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get();
if (sqlPolF3 && !sqlPolF3.sql.includes('flotte_soumission_id')) {
  bd.exec('PRAGMA foreign_keys = OFF');
  try {
    const colsAncF = bd.prepare('PRAGMA table_info(polices)').all().map((c) => c.name);
    const colsCiblesF = ['id', 'cabinet_id', 'client_id', 'ligne', 'assureur', 'numero_police',
      'date_effet', 'date_echeance', 'franchise', 'statut', 'notes', 'responsable_id',
      'assureur_id', 'auto_soumission_id', 'auto_soumission_version',
      'biens_soumission_id', 'biens_soumission_version',
      'rc_soumission_id', 'rc_soumission_version',
      'cyber_soumission_id', 'cyber_soumission_version',
      'eo_soumission_id', 'eo_soumission_version',
      'do_soumission_id', 'do_soumission_version',
      'pe_soumission_id', 'pe_soumission_version', 'cree_le'];
    const communesF = colsCiblesF.filter((c) => colsAncF.includes(c));
    const selectColsF = communesF.map((c) =>
      (c === 'date_effet' || c === 'date_echeance') ? `COALESCE(${c}, '1900-01-01') AS ${c}` : c
    );
    bd.exec(`
      CREATE TABLE polices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        ligne TEXT NOT NULL CHECK (ligne IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
        assureur TEXT NOT NULL,
        numero_police TEXT NOT NULL,
        date_effet TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        franchise REAL NOT NULL DEFAULT 0,
        statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active','a_renouveler','resiliee')),
        notes TEXT,
        responsable_id INTEGER REFERENCES users(id),
        assureur_id INTEGER REFERENCES assureurs(id),
        auto_soumission_id INTEGER REFERENCES auto_soumissions(id),
        auto_soumission_version INTEGER,
        biens_soumission_id INTEGER REFERENCES biens_soumissions(id),
        biens_soumission_version INTEGER,
        rc_soumission_id INTEGER REFERENCES rc_soumissions(id),
        rc_soumission_version INTEGER,
        cyber_soumission_id INTEGER REFERENCES cyber_soumissions(id),
        cyber_soumission_version INTEGER,
        eo_soumission_id INTEGER REFERENCES eo_soumissions(id),
        eo_soumission_version INTEGER,
        do_soumission_id INTEGER REFERENCES do_soumissions(id),
        do_soumission_version INTEGER,
        pe_soumission_id INTEGER REFERENCES pe_soumissions(id),
        pe_soumission_version INTEGER,
        flotte_soumission_id INTEGER REFERENCES flotte_soumissions(id),
        flotte_soumission_version INTEGER,
        cree_le TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (cabinet_id, numero_police),
        UNIQUE (auto_soumission_id),
        UNIQUE (biens_soumission_id),
        UNIQUE (rc_soumission_id),
        UNIQUE (cyber_soumission_id),
        UNIQUE (eo_soumission_id),
        UNIQUE (do_soumission_id),
        UNIQUE (pe_soumission_id),
        UNIQUE (flotte_soumission_id)
      );
      INSERT INTO polices_new (${communesF.join(', ')})
      SELECT ${selectColsF.join(', ')} FROM polices;
      DROP TABLE polices;
      ALTER TABLE polices_new RENAME TO polices;
      CREATE INDEX IF NOT EXISTS idx_polices_cabinet ON polices(cabinet_id);
      CREATE INDEX IF NOT EXISTS idx_polices_echeance ON polices(date_echeance);
    `);
  } finally {
    bd.exec('PRAGMA foreign_keys = ON');
  }
}

// --- Cautionnement étape 3/10 : lien soumission cautionnement → police (mêmes conventions que flotte) --
// SQLite ne permet pas d'ajouter une contrainte UNIQUE : on reconstruit la table.
// On préserve ici les colonnes auto_soumission_*, biens_soumission_*, rc_soumission_*,
// cyber_soumission_*, eo_soumission_*, do_soumission_*, pe_soumission_* et flotte_soumission_*.
const sqlPolK3 = bd.prepare("SELECT sql FROM sqlite_master WHERE name = 'polices'").get();
if (sqlPolK3 && !sqlPolK3.sql.includes('caut_soumission_id')) {
  bd.exec('PRAGMA foreign_keys = OFF');
  try {
    const colsAncC = bd.prepare('PRAGMA table_info(polices)').all().map((c) => c.name);
    const colsCiblesC = ['id', 'cabinet_id', 'client_id', 'ligne', 'assureur', 'numero_police',
      'date_effet', 'date_echeance', 'franchise', 'statut', 'notes', 'responsable_id',
      'assureur_id', 'auto_soumission_id', 'auto_soumission_version',
      'biens_soumission_id', 'biens_soumission_version',
      'rc_soumission_id', 'rc_soumission_version',
      'cyber_soumission_id', 'cyber_soumission_version',
      'eo_soumission_id', 'eo_soumission_version',
      'do_soumission_id', 'do_soumission_version',
      'pe_soumission_id', 'pe_soumission_version',
      'flotte_soumission_id', 'flotte_soumission_version', 'cree_le'];
    const communesC = colsCiblesC.filter((c) => colsAncC.includes(c));
    const selectColsC = communesC.map((c) =>
      (c === 'date_effet' || c === 'date_echeance') ? `COALESCE(${c}, '1900-01-01') AS ${c}` : c
    );
    bd.exec(`
      CREATE TABLE polices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        ligne TEXT NOT NULL CHECK (ligne IN ('cgl','biens','perte_exploitation','eo','cyber','flotte','cautionnement','do','autre','auto')),
        assureur TEXT NOT NULL,
        numero_police TEXT NOT NULL,
        date_effet TEXT NOT NULL,
        date_echeance TEXT NOT NULL,
        franchise REAL NOT NULL DEFAULT 0,
        statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active','a_renouveler','resiliee')),
        notes TEXT,
        responsable_id INTEGER REFERENCES users(id),
        assureur_id INTEGER REFERENCES assureurs(id),
        auto_soumission_id INTEGER REFERENCES auto_soumissions(id),
        auto_soumission_version INTEGER,
        biens_soumission_id INTEGER REFERENCES biens_soumissions(id),
        biens_soumission_version INTEGER,
        rc_soumission_id INTEGER REFERENCES rc_soumissions(id),
        rc_soumission_version INTEGER,
        cyber_soumission_id INTEGER REFERENCES cyber_soumissions(id),
        cyber_soumission_version INTEGER,
        eo_soumission_id INTEGER REFERENCES eo_soumissions(id),
        eo_soumission_version INTEGER,
        do_soumission_id INTEGER REFERENCES do_soumissions(id),
        do_soumission_version INTEGER,
        pe_soumission_id INTEGER REFERENCES pe_soumissions(id),
        pe_soumission_version INTEGER,
        flotte_soumission_id INTEGER REFERENCES flotte_soumissions(id),
        flotte_soumission_version INTEGER,
        caut_soumission_id INTEGER REFERENCES caut_soumissions(id),
        caut_soumission_version INTEGER,
        cree_le TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (cabinet_id, numero_police),
        UNIQUE (auto_soumission_id),
        UNIQUE (biens_soumission_id),
        UNIQUE (rc_soumission_id),
        UNIQUE (cyber_soumission_id),
        UNIQUE (eo_soumission_id),
        UNIQUE (do_soumission_id),
        UNIQUE (pe_soumission_id),
        UNIQUE (flotte_soumission_id),
        UNIQUE (caut_soumission_id)
      );
      INSERT INTO polices_new (${communesC.join(', ')})
      SELECT ${selectColsC.join(', ')} FROM polices;
      DROP TABLE polices;
      ALTER TABLE polices_new RENAME TO polices;
      CREATE INDEX IF NOT EXISTS idx_polices_cabinet ON polices(cabinet_id);
      CREATE INDEX IF NOT EXISTS idx_polices_echeance ON polices(date_echeance);
    `);
  } finally {
    bd.exec('PRAGMA foreign_keys = ON');
  }
}

// --- Soumission combinée entreprise (2026-10-21) -----------------------------------
// Référence : REFERENCE-SOUMISSION-COMBINEE.md (inventaire des 124 champs des
// envois réels du cabinet, plan en 10 étapes). Un dossier qui LIE les trois
// soumissions produits (biens + RC + perte d'exploitation) du même client ;
// les nouvelles colonnes arrivent par migrations additives (jamais de
// suppression, règle d'or) et chaque colonne est documentée au dictionnaire
// dès sa création.
function ajouterColonneSiAbsente(table, colonne, definition) {
  if (!colonneExiste(table, colonne)) {
    bd.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
  }
}

// Étape 1/10 combinée — en-tête d'envoi du cabinet (propositions) et fiche
// entreprise complète (le « Renseignements généraux » des envois réels).
for (const [col, def] of [
  ['adresse', 'TEXT'], ['ville', 'TEXT'], ['code_postal', 'TEXT'],
  ['telephone', 'TEXT'], ['telecopieur', 'TEXT'], ['site_web', 'TEXT'], ['courriel', 'TEXT'],
]) ajouterColonneSiAbsente('cabinets', col, def);

for (const [col, def] of [
  ['forme_juridique', "TEXT CHECK (forme_juridique IN ('societe_actions','proprietaire_unique','srl','fiducie','snc','coentreprise','association','autre'))"],
  ['annee_fondation', 'INTEGER'],
  ['annees_experience_liee', 'INTEGER'],
  ['noms_exploitation', 'TEXT'],
  ['description_activites', 'TEXT'],
  ['code_industrie', 'TEXT'],
  ['code_industrie_description', 'TEXT'],
  ['code_industrie_pct_revenus', 'REAL'],
  ['repartition_revenus_types', 'TEXT'], // JSON : {detail, gros, reparation, fabrication, estimation, affinage, achat_or, autre} en %
  ['repartition_revenus_geo', 'TEXT'],   // JSON : {canada, etats_unis, etranger, internet} en %
  ['masse_salariale', 'REAL'],
  ['nb_employes_temps_plein', 'INTEGER'],
  ['nb_employes_temps_partiel', 'INTEGER'],
  ['employes_csst', 'INTEGER'],
  ['responsabilite_alcool', 'INTEGER'],
  ['pct_sous_traitance', 'REAL'],
]) ajouterColonneSiAbsente('clients', col, def);

// Étape 2/10 combinée — fiche emplacement enrichie (biens_batiments) :
// la page « Emplacement » des envois réels du cabinet (adresse complète,
// affectation, construction par composant, mécanique, rénovations par
// système, inspection/évaluation, protection incendie, voisinage,
// risques criminels). type_construction (taxonomie historique) est
// conservé tel quel ; la classe assureur s'ajoute en classe_construction.
for (const [col, def] of [
  // Adresse complète
  ['province', 'TEXT'], ['etage', 'TEXT'], ['bureau', 'TEXT'],
  // Affectation de l'assuré
  ['type_emplacement', 'TEXT'], ['type_batiment', 'TEXT'], ['interet_assure', 'TEXT'],
  ['superficie_occupee_pi2', 'REAL'], ['pct_vacant', 'REAL'],
  ['partage_lieux', 'INTEGER'], ['autres_occupants', 'TEXT'], ['etages_occupes', 'TEXT'],
  // Construction détaillée
  ['classe_construction', "TEXT CHECK (classe_construction IN ('bois','maconnerie_solives','incombustible','maconnerie_incombustible','resistant_feu_modifie','resistant_feu'))"],
  ['construction_mur', 'TEXT'], ['construction_toit_structure', 'TEXT'],
  ['finition_toit', 'TEXT'], ['materiau_sol', 'TEXT'], ['sous_sol', 'TEXT'],
  // Mécanique / systèmes
  ['electricite_type', 'TEXT'], ['carburant', 'TEXT'], ['plomberie_materiau', 'TEXT'],
  // Rénovations par système (année + ampleur) — annee_toiture existait déjà
  ['renovation_toiture_ampleur', 'TEXT'],
  ['renovation_electricite_annee', 'INTEGER'], ['renovation_electricite_ampleur', 'TEXT'],
  ['renovation_plomberie_annee', 'INTEGER'], ['renovation_plomberie_ampleur', 'TEXT'],
  ['renovation_chauffage_annee', 'INTEGER'], ['renovation_chauffage_ampleur', 'TEXT'],
  // Inspection et évaluation
  ['inspection_statut', "TEXT CHECK (inspection_statut IN ('inspecte','non_inspecte'))"],
  ['inspection_date', 'TEXT'], ['inspection_notes', 'TEXT'],
  ['evaluation_date', 'TEXT'], ['evaluation_par', 'TEXT'],
  ['evaluation_cout_remplacement', 'REAL'], ['evaluation_details_joints', 'INTEGER'],
  // Protection incendie
  ['prise_eau_distance', 'TEXT'],
  ['extincteurs_categorie', 'TEXT'], ['extincteurs_agent', 'TEXT'],
  ['extincteurs_pct_couvert', 'REAL'],
  ['alarme_incendie_type', 'TEXT'], ['colonne_montante', 'INTEGER'],
  ['gicleurs_couverture', "TEXT CHECK (gicleurs_couverture IN ('non','partiel','entier'))"],
  // Voisinage — risques encourus (gauche, droite, arrière, en face)
  ['voisin_gauche_distance_m', 'REAL'], ['voisin_gauche_affectation', 'TEXT'],
  ['voisin_droite_distance_m', 'REAL'], ['voisin_droite_affectation', 'TEXT'],
  ['voisin_arriere_distance_m', 'REAL'], ['voisin_arriere_affectation', 'TEXT'],
  ['voisin_enface_distance_m', 'REAL'], ['voisin_enface_affectation', 'TEXT'],
  ['aucun_risque_alentours', 'INTEGER'],
  // Risques criminels (base — le questionnaire alarme complet est à l'étape 3)
  ['alarme_vol_type', 'TEXT'], ['pene_dormant', 'INTEGER'],
  ['fenetres_grillagees', 'INTEGER'], ['glaces_incassables', 'INTEGER'],
  ['coffre_type', 'TEXT'], ['coffre_categorie', 'TEXT'],
  ['autres_protections_criminelles', 'TEXT'], ['cameras', 'INTEGER'],
]) ajouterColonneSiAbsente('biens_batiments', col, def);

// Étape 3/10 combinée — questionnaire technique d'alarme par emplacement
// (transmissions, centrale, ULC, répondants, protections physiques) :
// une fiche par bâtiment, alimentée par le questionnaire alarme des assureurs.
bd.exec(`
CREATE TABLE IF NOT EXISTS biens_protections_alarme (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  batiment_id INTEGER NOT NULL REFERENCES biens_batiments(id) ON DELETE CASCADE,
  compagnie_alarme TEXT,
  compagnie_telephone TEXT,
  compagnie_courriel TEXT,
  compagnie_contact TEXT,
  transmission_primaire TEXT,          -- JSON : liste des modes de transmission primaire
  transmission_primaire_fabricant TEXT,
  transmission_primaire_modele TEXT,
  transmission_secondaire TEXT,        -- JSON : liste des modes de transmission secondaire
  transmission_secondaire_fabricant TEXT,
  transmission_secondaire_modele TEXT,
  securite_ligne INTEGER,              -- sécurité de ligne (1 = oui, 0 = non)
  taux_interrogation TEXT,             -- taux d'interrogation (polling) de la centrale
  centrale_nom_lieu TEXT,
  couverture_detection TEXT,           -- JSON : couverture de la détection de mouvements
  dispositifs_perimetre TEXT,
  protection_coffres TEXT,             -- JSON : protections des coffres-forts
  repondants TEXT,                     -- JSON : répondants aux alarmes
  reponse_en_personne INTEGER,
  signaux_ouverture_fermeture TEXT CHECK (signaux_ouverture_fermeture IN ('surveilles','supervises','aucun')),
  contrat_entretien_annuel INTEGER,
  certificat_ulc_actif INTEGER,
  certificat_ulc_numero TEXT,
  certificat_ulc_expiration TEXT,
  cameras_detail TEXT,                 -- JSON : les 5 réponses vidéosurveillance
  protections_physiques TEXT,          -- JSON : liste à cocher des protections physiques
  coffre_detail TEXT,                  -- JSON : {fabricant, modele, cote, poids_moins_500lb, boulonne, chambre_forte}
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (batiment_id)
);
CREATE INDEX IF NOT EXISTS idx_alarme_batiment ON biens_protections_alarme(batiment_id, archive);
`);

// Étape 4/10 combinée — garanties structurées : règle proportionnelle sur
// les lignes biens et contenu, avenants à franchise/montant propres (le JSON
// biens_garanties.avenants passe au format enrichi {code: {present,
// franchise, montant, ...}} en gardant la compatibilité avec {code: 1}),
// et assurance flottante des outils (liste d'articles, annexe de l'envoi réel).
for (const [col, def] of [
  ['regle_proportionnelle', 'REAL'],
  ['franchise_contenu', 'REAL'],
  ['regle_proportionnelle_contenu', 'REAL'],
]) ajouterColonneSiAbsente('biens_garanties', col, def);

bd.exec(`
CREATE TABLE IF NOT EXISTS biens_flottante_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  soumission_id INTEGER NOT NULL REFERENCES biens_soumissions(id) ON DELETE CASCADE,
  batiment_id INTEGER REFERENCES biens_batiments(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  base_reglement TEXT,          -- base de règlement (valeur à neuf, valeur au jour du sinistre…)
  assure_additionnel TEXT,      -- assuré additionnel rattaché à l'article
  montant REAL,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_flottante_soumission ON biens_flottante_articles(soumission_id, archive);
`);

// Étape 5/10 combinée — RC et Perte d'exploitation complétées : montants des
// volets que le tableau consolidé et les pages d'emplacement des envois
// réels détaillaient (frais médicaux, responsabilité locative, auto
// non-propriétaires, umbrella ; bénéfice brut, honoraires de comptables,
// montant PE propre à chaque établissement).
for (const [col, def] of [
  ['prejudice_personnel_publicite', 'REAL'],
  ['frais_medicaux_par_personne', 'REAL'],
  ['frais_medicaux_par_sinistre', 'REAL'],
  ['responsabilite_locative', 'REAL'],
  ['rc_auto_non_proprietaires', 'REAL'],
  ['umbrella_montant', 'REAL'],
  ['umbrella_retention', 'REAL'],
  ['umbrella_polices_base', 'TEXT'],
  ['produits_travaux_termines_montant', 'REAL'],
  ['pollution_montant', 'REAL'],
]) ajouterColonneSiAbsente('rc_garanties', col, def);

for (const [col, def] of [
  ['regle_proportionnelle', 'REAL'],
  ['honoraires_comptables', 'REAL'],
  ['formule', "TEXT CHECK (formule IN ('pertes_loyers', 'benefice_brut', 'formule_etendue'))"],
]) ajouterColonneSiAbsente('pe_garanties', col, def);
ajouterColonneSiAbsente('pe_etablissements', 'montant_pe', 'REAL');

// Étape 6/10 combinée — antécédents communs aux 3 produits (saisis une fois
// dans la combinée, synchronisés vers chaque *_antecedents) et questions
// sectorielles par code d'industrie, rattachées au client.
for (const table of ['biens_antecedents', 'rc_antecedents', 'pe_antecedents']) {
  for (const [col, def] of [
    ['refus_resiliation_nonrenouvellement', 'INTEGER'],
    ['refus_explication', 'TEXT'],
    ['type_police_precedente', 'TEXT'],
    ['date_effet_precedente', 'TEXT'],
    ['prime_precedente', 'REAL'],
    ['faillite_jugement', 'INTEGER'],
    ['faillite_explication', 'TEXT'],
    ['condamnation_honnetete', 'INTEGER'],
    ['condamnation_explication', 'TEXT'],
  ]) ajouterColonneSiAbsente(table, col, def);
}

bd.exec(`
CREATE TABLE IF NOT EXISTS client_questions_sectorielles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  code_question TEXT NOT NULL,
  question TEXT NOT NULL,
  reponse TEXT,
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le TEXT,
  UNIQUE (client_id, code_question)
);
CREATE INDEX IF NOT EXISTS idx_questions_client ON client_questions_sectorielles(client_id, archive);
`);

// Étape 7/10 combinée — bénéficiaires/créanciers par emplacement et assurés
// additionnels réutilisables (mécanisme générique, hors FPQ1).
bd.exec(`
CREATE TABLE IF NOT EXISTS emplacement_beneficiaires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  batiment_id INTEGER NOT NULL REFERENCES biens_batiments(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  adresse TEXT,
  ville TEXT,
  code_postal TEXT,
  qualite TEXT,               -- qualité en vertu de laquelle le bénéficiaire est désigné (créancier hypothécaire…)
  clause_preavis TEXT,        -- clause de préavis de résiliation (ex. 30 jours)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_beneficiaires_batiment ON emplacement_beneficiaires(batiment_id, archive);

CREATE TABLE IF NOT EXISTS soumission_assures_additionnels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  dossier_type TEXT NOT NULL CHECK (dossier_type IN ('biens', 'rc', 'perte_exploitation', 'combine')),
  dossier_id INTEGER NOT NULL,
  nom TEXT NOT NULL,
  adresse TEXT,
  ville TEXT,
  code_postal TEXT,
  interet TEXT,               -- intérêt assurable de l'assuré additionnel
  archive INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assures_add_dossier ON soumission_assures_additionnels(dossier_type, dossier_id, archive);
`);

// Étape 8/10 combinée — le dossier combiné LIE une soumission biens, une
// soumission RC et une soumission perte d'exploitation du MÊME client
// (aucune fusion : versions, exports, analyses et conversions des produits
// continuent de fonctionner). L'emplacement (biens_batiments) est saisi une
// seule fois et référencé par les établissements PE et les lieux RC.
bd.exec(`
CREATE TABLE IF NOT EXISTS combine_dossiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  statut TEXT NOT NULL DEFAULT 'brouillon'
    CHECK (statut IN ('brouillon', 'en_cours', 'envoye', 'clos')),
  date_effet TEXT,
  date_echeance TEXT,
  plan_paiement TEXT,
  code_courtier_assureur TEXT,
  courtier_placement_id INTEGER REFERENCES users(id),
  signataire_nom TEXT,
  signataire_titre TEXT,
  date_signature TEXT,
  remarques_diverses TEXT,
  circonstances_speciales TEXT,
  commentaires_courtier TEXT,
  antecedents TEXT,           -- bloc d'antécédents communs saisi dans la combinée (JSON, source de la synchronisation)
  archive INTEGER NOT NULL DEFAULT 0,
  cree_par INTEGER REFERENCES users(id),
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le TEXT
);
CREATE INDEX IF NOT EXISTS idx_combine_dossiers_client ON combine_dossiers(client_id, archive);

CREATE TABLE IF NOT EXISTS combine_liens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id),
  dossier_id INTEGER NOT NULL REFERENCES combine_dossiers(id) ON DELETE CASCADE,
  produit TEXT NOT NULL CHECK (produit IN ('biens', 'rc', 'perte_exploitation')),
  soumission_id INTEGER NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (dossier_id, produit)
);
CREATE INDEX IF NOT EXISTS idx_combine_liens_dossier ON combine_liens(dossier_id);
`);

ajouterColonneSiAbsente('pe_etablissements', 'batiment_id', 'INTEGER REFERENCES biens_batiments(id)');
ajouterColonneSiAbsente('rc_exploitations', 'batiment_id', 'INTEGER REFERENCES biens_batiments(id)');
ajouterColonneSiAbsente('polices', 'combine_dossier_id', 'INTEGER REFERENCES combine_dossiers(id)');
ajouterColonneSiAbsente('brouillons', 'combine_dossier_id', 'INTEGER REFERENCES combine_dossiers(id)');

// Étape 9/10 combinée — un brouillon « demande de prix » est rattaché à un
// dossier combiné, sans police ni facture : le CHECK d'origine de la table
// brouillons l'interdisait. Rebuild sûr et idempotent (copie intégrale des
// données, aucun enregistrement supprimé).
{
  const defBrouillons = bd.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'brouillons'"
  ).get();
  if (defBrouillons && defBrouillons.sql
      && defBrouillons.sql.includes('police_id IS NOT NULL OR facture_id IS NOT NULL')) {
    bd.exec(`
      ALTER TABLE brouillons RENAME TO brouillons_avant_combine;
      CREATE TABLE brouillons (
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
        combine_dossier_id INTEGER REFERENCES combine_dossiers(id)
      );
      INSERT INTO brouillons (id, cabinet_id, police_id, facture_id, type, sujet, contenu, statut, archive, cree_le, combine_dossier_id)
        SELECT id, cabinet_id, police_id, facture_id, type, sujet, contenu, statut, archive, cree_le, combine_dossier_id
        FROM brouillons_avant_combine;
      DROP TABLE brouillons_avant_combine;
    `);
  }
}

module.exports = bd;
module.exports.genererJetonCapture = genererJetonCapture;
