# 🛡️ Courtier — Outil de gestion pour cabinet de courtage en assurance commerciale (Québec)

Application web en français pour courtier en **assurance commerciale** (entreprises, Québec).
Données hébergées localement — **rien ne part aux USA**, conformément à la Loi 25 et aux exigences de l'ordre professionnel.

**Phase 1 = fondation** : multi-cabinets et utilisateurs (rôles), fiches **entreprises**
(raison sociale, NEQ, secteur d'activité, personne-contact, consentements Loi 25, documents),
polices par **produit commercial** (CGL, biens, perte d'exploitation, E&O, cyber, flotte,
cautionnement, D&O) avec catalogue de protections québécois, **réclamations** (sinistres,
statuts, montants, expert, historique de suivi, rappels), **tâches** manuelles, import CSV en lot,
tableau des renouvellements (J-90 / J-60 / J-30), fiches de révision avec détection des
protections manquantes, brouillons de messages IA (Cohere optionnel, modèle local sinon),
**journal d'audit** consultable, et courtier responsable par dossier.

> ⚠️ Les brouillons restent des **brouillons à valider** — aucun envoi
> automatique n'est effectué.

## Prérequis

- Node.js 20+ (testé avec Node 24)
- `npm`

## Installation et lancement

```bash
cd ~/workspace/courtier-app
npm install
npm start
```

Puis ouvrez http://localhost:3000

Au **premier lancement**, des données de démonstration sont créées
automatiquement (cabinet, catalogues de protections, entreprises, polices,
réclamations, tâches).

## Compte de démonstration

- Cabinet : **Cabinet Démo**
- Courriel : `admin@demo.ca`
- Mot de passe : `ChangeMoi123!`

⚠️ **Au premier login, le changement du mot de passe est obligatoire**
(un bandeau l'exige avant tout accès). Pensez ensuite à activer la
**double authentification** dans le profil (menu → votre nom).

Données démo : Constructions Méthot inc. (CGL + biens), Resto Le Petit Four inc.
(CGL + 1 réclamation en évaluation avec rappel dépassé), Garage Saint-Michel inc.
(flotte + 1 réclamation réglée), 2 tâches (dont 1 en retard).

## Variables d'environnement

| Variable         | Défaut              | Description                                              |
|------------------|---------------------|----------------------------------------------------------|
| `PORT`           | `3000`              | Port d'écoute                                            |
| `SESSION_SECRET` | aléatoire           | Secret des sessions — **à fixer en production**           |
| `COOKIE_SECURE`  | (désactivé)         | Mettre à `1` derrière HTTPS (cookies `Secure`)           |
| `COHERE_API_KEY` | (absent)            | Clé API Cohere — sans elle, les brouillons utilisent un modèle de texte local |
| `COHERE_MODEL`   | `command-a-03-2025` | Modèle Cohere utilisé pour les brouillons                |
| `AUGURE_API_KEY` | (absent)            | Clé API Augure (IA canadienne) de repli — le réglage du cabinet (Admin → Clé IA) a priorité |
| `AUGURE_BASE_URL` | `https://api.augureai.ca/v1` | Base de l'API Augure — surchargée par les tests (harnais local, aucun appel réel) |
| `CHEMIN_BD`      | `./courtier.db`     | Chemin du fichier SQLite                                 |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_REDIRECT_URI` | (absent) | OAuth Microsoft 365 (création auto des liens Teams) — voir « Microsoft 365 » |
| `MS_TENANT`      | `common`            | Locataire Azure AD pour l'OAuth Microsoft                |
| `CHIFFRE_CLE`    | (dérivée de SESSION_SECRET) | Clé AES-256-GCM (64 car. hex) pour chiffrer les jetons Microsoft en base |

## Structure

```
courtier-app/
├── server.js            # Point d'entrée Express (helmet, sessions, CSRF, rate-limit)
├── seed.js              # Catalogues commerciaux + données démo (npm run seed)
├── lib/
│   ├── bd.js            # SQLite (better-sqlite3) + schéma
│   ├── fpq1.js          # Couche données FPQ1 : versionnage systématique (étape 1/10)
│   ├── biens.js         # Couche données biens commerciaux : versionnage systématique (biens étape 1/10)
│   ├── rc.js            # Couche données RC/CGL : versionnage systématique (RC étape 1/10)
│   ├── cyber.js         # Couche données cyberrisques : versionnage systématique (cyber étape 1/10)
│   ├── proposition.js   # Données normalisées pour la proposition pré-remplie (étape 7/10)
│   ├── proposition-pdf.js # Génération PDF (pdfkit) de la proposition (étape 7/10)
│   ├── proposition-biens.js   # Données normalisées pour la proposition biens (biens étape 7/10)
│   ├── proposition-biens-pdf.js # Génération PDF (pdfkit) de la proposition biens (biens étape 7/10)
│   ├── magasin-session.js # Sessions Express stockées en SQLite
│   ├── middleware.js    # Auth, rôles, CSRF maison, audit, validation
│   ├── ia.js            # Brouillons IA : Cohere si clé dispo, sinon modèle local
│   ├── contexte-ia.js   # Dictionnaire de champs exposé à l'IA (contexteDonnees)
│   ├── dictionnaire-champs.json # Dictionnaire documenté : 50 tables, 566 colonnes (étapes 4/10 auto + biens + RC + cyber)
│   ├── assistant.js     # Assistant IA conversationnel (commandes en langage naturel)
│   ├── commandes-ia.js  # Commandes texte IA (étapes 8/10 FPQ1/biens/RC) : analyseur FR + exécuteurs FPQ1/biens/RC/navigation/recherche
│   ├── chiffrement.js   # AES-256-GCM (jetons Microsoft)
│   └── microsoft.js     # OAuth Microsoft Graph + création de réunions Teams
├── routes/
│   ├── auth.js          # Connexion, 2FA TOTP, changement de mot de passe
│   ├── admin.js         # Cabinets, utilisateurs, journal d'audit, dictionnaire des champs, réinitialisation mdp, Microsoft 365
│   ├── clients.js       # CRUD entreprises, consentements Loi 25, documents
│   ├── polices.js       # CRUD polices, protections, documents par police
│   ├── auto.js          # Soumissions auto FPQ1 : questionnaire, garanties, conversion en police, proposition (étapes 1-3, 7/10)
│   ├── biens.js         # Soumissions biens commerciaux : questionnaire, garanties, conversion, proposition (biens étapes 1-3, 7/10)
│   ├── exports.js       # Exports CSV/JSON par module, sauvegarde et pont BMS (étape 5/10)
│   ├── assistant.js     # Assistant IA : chat, commandes, confirmations (étapes 8-9/10)
│   ├── assureurs.js     # Fiches assureurs : contacts comptabilité, produits + taux de commission
│   ├── reclamations.js  # Réclamations : CRUD, statuts, suivis, rappels
│   ├── taches.js        # Tâches manuelles : CRUD, statuts, échéances
│   ├── echeances.js     # Tableau J-90/J-60/J-30, fiche de révision, rappels, comptes en retard, réunions
│   ├── import.js        # Import CSV en lot + modèle + rapport d'erreurs (étendu auto, étape 6/10)
│   ├── brouillons.js    # Brouillons IA (jamais d'envoi auto)
│   ├── courriels.js     # Messagerie intégrée : comptes IMAP/SMTP, réception, envoi, liaison entreprises
│   ├── factures.js      # Facturation : CRUD, paiements, relances via brouillons IA
│   ├── leads.js         # Leads : pipeline, suivis, conversion en entreprise, stats
│   ├── capture.js       # Formulaire public de capture (/capture/<jeton>, sans auth)
│   ├── campagnes.js     # Campagnes de sollicitation par classe d'affaires (export CSV)
│   └── reunions.js      # Réunions : CRUD, lien Teams manuel ou auto (Microsoft 365)
├── views/               # Gabarits EJS en français (partials/, pages par module)
├── public/              # style.css + app.js (aucun framework frontend) ; dictee.js (voix, étape 9/10) ;
│                        # attestation.css/js et proposition.css/js (documents imprimables, hors CSP)
├── uploads/             # Documents (par cabinet)
└── scripts/
    ├── test-phase1.js       # Ancienne suite (schéma pré-commercial, obsolète — non exécutée)
    ├── test-ajustements.js  # Suite de référence : 48 tests bout en bout
    ├── test-nouveaux-modules.js # Nouveaux modules : 65 tests bout en bout
    ├── test-principes.js        # Règle d'or : 112 tests (archivage, versionnage, aucun DELETE)
    ├── test-courriels.js        # Module Courriels : 35 tests bout en bout + unitaires
    ├── test-assureurs.js        # Fiches assureurs : 47 tests
    ├── test-demandes-2026-10-09.js # Demandes du 2026-10-09 : 57 tests
    ├── test-droits-2026-10-09.js   # Droits par rôle : 48 tests (CHEMIN_BD des deux côtés)
    ├── test-fpq1-etape1.js     # Étape 1/10 : 53 tests (couche données, sans serveur)
    ├── test-fpq1-etape2.js     # Étape 2/10 : 62 tests (questionnaire UI)
    ├── test-fpq1-etape3.js     # Étape 3/10 : 52 tests (gestion police auto, attestation)
    ├── test-dictionnaire.js     # Étape 4/10 (auto + biens) : 69 tests (dictionnaire, page admin, contexte IA)
    ├── test-exports.js         # Étape 5/10 : 55 tests (exports CSV/JSON + round-trip avenants)
    ├── test-import-auto.js      # Étape 6/10 : 33 tests (import auto FPQ1)
    ├── test-proposition-pdf.js  # Étape 7/10 : 31 tests (proposition HTML + PDF)
    ├── test-commandes-ia.js     # Étape 8/10 : 48 tests (analyseur FR, confirmation, portefeuille, audit)
    ├── test-voix.js             # Étapes 9/10 (FPQ1 + biens + RC + cyber + E&O + D&O + PE + flotte + cautionnement) : 225 tests (normalisation dictée, Web Speech, pipelines)
    ├── test-biens-etape1.js     # Biens étape 1/10 : 57 tests (couche données, sans serveur)
    ├── test-biens-etape2.js     # Biens étape 2/10 : 74 tests (questionnaire UI, HTTP)
    ├── test-biens-etape3.js     # Biens étape 3/10 : 52 tests (gestion police biens, HTTP)
    ├── test-exports-biens.js    # Biens étape 5/10 : 44 tests (exports biens, HTTP)
    ├── test-exports-rc.js       # RC étape 5/10 : 41 tests (exports RC, HTTP)
    ├── test-exports-cyber.js    # Cyber étape 5/10 : 43 tests (exports cyber, HTTP)
    ├── test-import-biens.js     # Biens étape 6/10 : 36 tests (import biens, HTTP)
    ├── test-import-rc.js        # RC étape 6/10 : 33 tests (import RC, HTTP)
    ├── test-proposition-biens-pdf.js # Biens étape 7/10 : 33 tests (proposition biens HTML + PDF)
    ├── test-proposition-rc-pdf.js # RC étape 7/10 : 32 tests (proposition RC HTML + PDF)
    ├── test-commandes-biens.js    # Biens étape 8/10 : 47 tests (commandes texte IA biens, confirmation, audit)
    ├── test-commandes-rc.js       # RC étape 8/10 : 48 tests (commandes texte IA RC, confirmation, audit)
    ├── test-commandes-cyber.js    # Cyber étape 8/10 : 57 tests (commandes texte IA cyber, confirmation, audit)
    ├── test-commandes-eo.js       # E&O étape 8/10 : 62 tests (commandes texte IA E&O, confirmation, audit)
    ├── test-commandes-do.js       # D&O étape 8/10 : 70 tests (commandes texte IA D&O, confirmation avant/après, audit)
    ├── test-commandes-pe.js       # PE étape 8/10 : 67 tests (commandes texte IA perte d'exploitation, confirmation avant/après, audit)
    ├── test-commandes-flotte.js   # Flotte étape 8/10 : 77 tests (commandes texte IA flotte, anti-collision FPQ1, confirmation avant/après, audit)
    ├── test-cautionnement-etape1.js # Cautionnement étape 1/10 : 60 tests (couche données, sans serveur)
    ├── test-cautionnement-etape2.js # Cautionnement étape 2/10 : 102 tests (questionnaire UI, HTTP)
    ├── test-cautionnement-etape3.js # Cautionnement étape 3/10 : 76 tests (conversion, police cautionnement, avenants, HTTP)
    ├── test-exports-cautionnement.js # Cautionnement étape 5/10 : 44 tests (exports cautionnement, HTTP)
    ├── test-import-cautionnement.js # Cautionnement étape 6/10 : 45 tests (import cautionnement, HTTP)
    ├── test-proposition-cautionnement-pdf.js # Cautionnement étape 7/10 : 58 tests (proposition cautionnement HTML + PDF)
    ├── test-commandes-cautionnement.js # Cautionnement étape 8/10 : 43 tests (commandes texte IA cautionnement, anti-collision 8 produits, confirmation, audit)
    ├── test-rc-etape1.js        # RC étape 1/10 : 48 tests (couche données, sans serveur)
    ├── test-cyber-etape1.js     # Cyber étape 1/10 : 47 tests (couche données, sans serveur)
    ├── test-rc-etape2.js        # RC étape 2/10 : 70 tests (questionnaire UI, HTTP)
    ├── test-cyber-etape2.js     # Cyber étape 2/10 : 71 tests (questionnaire UI, HTTP)
    ├── test-cyber-etape3.js     # Cyber étape 3/10 : 55 tests (conversion, police cyber, avenants, HTTP)
    ├── test-rc-etape3.js        # RC étape 3/10 : 54 tests (conversion, police RC, avenants, HTTP)
    ├── generer-dictionnaire.js  # Vérifie que le JSON documente tout le schéma réel
    ├── exemple-import.csv       # Modèle CSV (entreprises, produits commerciaux)
    ├── exemple-import-auto.csv  # Modèle CSV (soumissions, conducteurs, véhicules, antécédents auto)
    ├── exemple-import-biens.csv # Modèle CSV (soumissions, bâtiments, contenus, garanties, antécédents biens)
    └── exemple-import-rc.csv    # Modèle CSV RC (soumission, lieu d’exploitation, garanties, antécédents RC)
```

## Nouveaux modules (facturation, leads, campagnes, réunions)

### 💰 Facturation (onglet « Facturation »)
- Factures reliées à l'entreprise (obligatoire) et à la police (optionnel). Numérotation
  automatique `FAC-AAAA-NNNN` par cabinet. Statuts : émise, partielle, payée, en retard, annulée.
- **Paiements** : chaque paiement recalcule le montant payé et le statut (soldé → payée,
  partiel → partielle, échéance dépassée non soldée → en retard).
- **Comptes en retard** : vue dédiée + badge sur le tableau de bord (total dû).
- **Relances** : bouton « Générer une relance » → brouillon IA via le système de brouillons
  existant (type `relance`) — jamais d'envoi automatique.

### 🎯 Leads (onglet « Leads »)
- Pipeline par statut (nouveau → contacté → qualifié → soumission → devenu client / perdu),
  suivis horodatés, responsable, date de rappel, source + campagne + UTM.
- **Formulaire de capture public** : `/capture/<jeton>` (jeton unique par cabinet, régénérable
  dans **Admin → Cabinets**). Sans authentification par design, mais : rate-limit agressif
  (10/h par IP), champ honeypot anti-spam, validation stricte, **aucune donnée existante
  n'est exposée** (la route ne lit rien d'autre que le jeton).
- **Convertir en entreprise** : crée la fiche entreprise et y rattache les suivis.
- **Statistiques** par campagne/source avec taux de conversion vers « devenu client ».

### 📣 Campagnes de sollicitation (onglet « Campagnes »)
- Sollicitation par **classe d'affaires** (secteurs d'activité ciblés). Contenu initial
  généré par l'IA, modifiable.
- **Loi 25 + LCAP** : les destinataires sont calculés automatiquement — seules les entreprises
  du secteur **ayant consenti au marketing** sont retenues ; les autres sont affichées comme
  « exclues » (compte ciblés / consentis / exclus). Mention de désinscription ajoutée
  automatiquement au contenu.
- **Pas d'envoi automatique** : la campagne produit la liste + le brouillon, exportables en
  **CSV** (BOM UTF-8, compatible Excel) pour l'envoi depuis l'outil de courriel habituel.

### 📅 Réunions (onglet « Réunions »)
- Réunions reliées à une entreprise (optionnel) et/ou un lead (optionnel). Création depuis la
  fiche entreprise, la fiche lead ou l'onglet. Les réunions à venir (7 jours) s'affichent sur
  le tableau de bord.
- **Lien Teams** : si Microsoft 365 n'est pas connecté, la réunion s'enregistre quand même
  avec un champ « coller le lien Teams manuellement ».

### 🔗 Microsoft 365 (Admin → Microsoft 365 / Teams)
- Intégration OAuth 2.0 complète : `/admin/microsoft/connecter` → consentement Microsoft →
  retour → jetons stockés **chiffrés (AES-256-GCM)** en base (`microsoft_tokens`).
- Quand un cabinet est connecté, la création d'une réunion génère automatiquement le lien
  Teams via Microsoft Graph (`creerReunionTeams()` dans `lib/microsoft.js`), avec
  rafraîchissement automatique du jeton.
- **Sans identifiants, tout fonctionne en mode dégradé** (lien manuel) — aucun blocage.
- **Marche à suivre pour activer** (affichée aussi dans l'app) :
  1. Dans le portail Azure (portal.azure.com), créer une **inscription d'application**.
  2. URI de redirection (Web) : `https://VOTRE-DOMAINE/admin/microsoft/retour`.
  3. Autorisations déléguées Microsoft Graph : `OnlineMeetings.ReadWrite`, `offline_access`, `openid`.
  4. Créer un **secret client**, noter l'ID d'application.
  5. Définir `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` (ou `common`), `MS_REDIRECT_URI`
     sur le serveur, redémarrer, puis cliquer « Connecter Microsoft 365 ».

### 📧 Courriels (onglet « Courriels ») — messagerie intégrée
- **Comptes** : ajoutez vos boîtes (Gmail, Outlook/Microsoft 365, autre) avec préconfigurations
  IMAP/SMTP. Mots de passe **chiffrés (AES-256-GCM)** en base. Bouton « Tester » (IMAP + SMTP).
  Pour Gmail : utilisez un *mot de passe d'application* (pas votre mot de passe habituel).
- **Réception** : synchronisation IMAP automatique toutes les 5 minutes + bouton manuel
  (30 derniers jours, 200 messages max/synchro). Recherche, filtre non lus, marquer lu/non lu.
- **Rédaction** : nouveau message, répondre (avec citation), bouton « ✨ Rédiger avec l'IA »
  (Cohere si `COHERE_API_KEY`, sinon modèle local). Envoi via SMTP, copie en « Envoyés ».
- **Liaison entreprises** : chaque courriel est rattaché automatiquement à l'entreprise quand
  l'adresse de l'expéditeur/destinataire correspond à `clients.courriel` ; liaison manuelle
  possible depuis la fiche du courriel. Filtrable par entreprise.
- Règle d'or respectée : comptes et courriels s'archivent, jamais supprimés.
- Les pièces jointes ne sont pas conservées en v1.

### 🏦 Assureurs (onglet « Assureurs »)
- **Fiche assureur** : coordonnées générales, contacts **nouvelle affaire**,
  **modifications / avenants** et **comptabilité** (financement par prélèvement direct),
  notes, archivage (impossible s'il reste des polices actives reliées).
- **Produits offerts** : cases à cocher parmi les 9 produits (CGL, biens, perte
  d'exploitation, E&O, cyber, flotte, cautionnement, D&O, autre) + **taux de
  commission (%) par produit**. Ex. : un assureur peut ne pas offrir le cyber
  ou la flotte. Les produits décochés sont retirés de la configuration
  (simple paramétrage, pas une suppression métier).
- **Statistiques par assureur** sur la fiche, calculées **selon le rôle** :
  nombre de polices actives, volume de primes (somme des primes des protections),
  commissions estimées (prime × taux du produit ; alerte si un taux manque).
  - **Admin** : tout le cabinet · **Courtier** : son portefeuille uniquement ·
    **Manager** : son équipe uniquement.
- **Équipes** : dans **Admin → Utilisateurs**, l'admin rattache chaque utilisateur
  à un manager (`manager_id`) via le menu « Équipe ». L'équipe d'un manager =
  lui-même + ses rattachés (sans rattaché : lui seul).
- **Formulaire police** : le menu « Assureur » ne propose que les assureurs offrant
  le produit sélectionné (filtrage côté client via `data-produits` ; si aucun
  produit n'est configuré, tout est proposé comme avant).

### 🏷️ Terminologie et libellés d'interface
Les libellés affichés ne sont **pas** dispersés au hasard : les statuts et constantes
d'interface sont centralisés dans chaque route sous forme de constantes `NOMS_*`
(ex. `NOMS_STATUTS_FACTURE` dans `routes/factures.js`, `NOMS_STATUTS_LEAD` dans
`routes/leads.js`), et les textes courants vivent dans les vues `views/…/*.ejs`
ainsi que `views/partials/haut.ejs` (navigation). Aucun libellé n'a été renommé dans
cette passe — les ajustements se feront au cas par cas.

## Règle d'or : rien ne se supprime

L'application n'efface jamais de données métier. Trois mécanismes remplacent
toute suppression :

### 📦 Archivage restorable

Les entreprises, tâches, leads, campagnes, réunions, brouillons, réclamations
et documents portent un drapeau `archive` (0 = actif, 1 = archivé).
« Archiver » retire l'élément des listes actives sans l'effacer ; « Désarchiver »
le restaure. Chaque liste exclut les archivés par défaut et propose un filtre
**« Voir les archivés »**. Les actions `archiver` / `desarchiver` sont
consignées au journal d'audit.

- **Utilisateurs** : un compte n'est jamais supprimé — il est **désactivé**
  (`actif = 0`). Un utilisateur désactivé ne peut plus se connecter et sa
  session active est coupée immédiatement. Réactivation possible par un admin
  (impossible de désactiver son propre compte).
- **Factures** : pas de suppression — la voie officielle est l'**annulation**
  via le statut `annulee` (les paiements déjà saisis sont conservés).

### 🕘 Versioning des polices (avenants)

La table `police_versions` conserve un **instantané figé** de chaque état d'une
police : champs (effet, échéance, franchise, notes) + protections au format JSON,
avec date de création et auteur. Règles :

- la **création** d'une police crée la **version 1** ;
- chaque **enregistrement** du formulaire crée une **nouvelle version** ;
- chaque **ajout ou retrait de protection** crée une **nouvelle version**
  (l'état précédent, protections incluses, reste consultable) ;
- jamais de modification silencieuse : la fiche affiche une section
  **« Historique des versions »** (v1, v2… avec dates) et un bouton
  **« Voir »** ouvre le snapshot en **lecture seule**.

### 🧾 Réclamations : deux statuts

**Ouverte** / **Fermée** uniquement (contrainte `CHECK`). Les anciennes routes
`POST …/supprimer` n'existent plus (→ 404).

### Nettoyages techniques (seules exceptions documentées)

Aucun `DELETE FROM` métier ne subsiste. Les seules suppressions sont des
nettoyages techniques internes : sessions expirées (`magasin-session.js`) et
révocation des jetons Microsoft 365 (`microsoft.js`).

## Sécurité

- Mots de passe hachés avec **bcrypt (coût 12)** ; politique de robustesse (10 car. min, majuscule, minuscule, chiffre).
- **Double authentification TOTP** incluse (otplib) : activation dans le profil, code exigé au login.
- Sessions stockées en **SQLite** (pas de MemoryStore), cookies `httpOnly`, `SameSite=Lax`, `Secure` activable.
- **Helmet** : en-têtes de sécurité + CSP stricte (aucun script inline, aucun CDN).
- **CSRF** : jeton par session vérifié sur tous les POST.
- **Rate-limit** sur `/connexion` (20 tentatives / 15 min).
- **Requêtes SQL paramétrées partout** (better-sqlite3) — aucune concaténation.
- **Cloisonnement par cabinet** : chaque requête est filtrée par `cabinet_id` (entreprises, polices, réclamations, tâches, documents, brouillons, **factures, leads, campagnes, réunions**).
- **Formulaire public `/capture/<jeton>`** : rate-limit 10/h par IP, honeypot, validation stricte, ne lit aucune donnée existante ; jeton régénérable par l'admin.
- **Journal d'audit consultable** (Admin → Journal) : filtrable par utilisateur/action, paginé.
- Uploads limités (type MIME, 10 Mo), noms de fichiers assainis, stockés par cabinet.
- Changement de mot de passe **forcé** au premier login (compte démo, nouveaux utilisateurs, réinitialisations).

## Import CSV

Modèle téléchargeable depuis **Import → Téléchargez le modèle CSV**
(séparateur `;`, compatible Excel).

Colonnes : `type;raison_sociale;neq;secteur_activite;prenom;nom;titre_contact;courriel;telephone;adresse;ville;code_postal;langue;produit;assureur;numero_police;date_effet;date_echeance;franchise;statut;protection_code;protection_libelle;prime`

- `type=entreprise` → crée une entreprise (`raison_sociale`, `prenom`, `nom` requis ; NEQ = 10 chiffres si fourni).
- `type=police` → crée une police ; l'entreprise est retrouvée par `raison_sociale` (ou `courriel`).
- `type=protection` → ajoute une protection à la police retrouvée par `numero_police` (le libellé est repris du catalogue si le code existe).

Produits : `cgl`, `biens`, `perte_exploitation`, `eo`, `cyber`, `flotte`, `cautionnement`, `do`, `autre`.

Un **rapport ligne par ligne** indique les créations et les erreurs.

## Proposition pré-remplie (étape 7/10)

Depuis la fiche d'une soumission auto, le bouton **📄 Proposition** génère le
formulaire à envoyer aux assureurs, pré-rempli avec les données déjà saisies —
sans ressaisie :

- `GET /auto/:id/proposition` — page HTML imprimable (même pattern que
  l'attestation : bouton Imprimer, CSS `@media print`) : proposant, tableau des
  conducteurs (illimités), véhicules (illimités) avec garanties (RC, B1–B4,
  franchises, avenants FAQ), antécédents, consentements, date d'effet souhaitée,
  courtier. Mention « Document généré le … à partir de la soumission #…
  (version vN) — vérifiez avant envoi » + lignes de signature.
- `GET /auto/:id/proposition.pdf` — le même contenu en **PDF téléchargeable**
  (généré avec `pdfkit`, texte en clair dans le flux pour la traçabilité).
- `?v=N` génère la proposition à partir d'une **version figée** de la
  soumission (règle d'or) ; sinon l'état courant avec mention de la version.
- Chaque génération est journalisée (`proposition_generee`, avec la version
  utilisée). Accès : exigeAuth + cabinet + portefeuille courtier.

`test-proposition-pdf.js` — 30 tests : page 200 + contenu (conducteurs,
véhicules, garanties, antécédents, consentements, mention version), version
figée ?v=1 (mention « figée ») / ?v=999 → 404, soumission inexistante → 404,
PDF 200 (`application/pdf`, en-tête `%PDF`, contenu décodé : conducteur,
véhicule, n° soumission), inter-cabinets → 404 (aucune fuite), portefeuille
courtier (403 hors portefeuille, 200 dans son portefeuille), 302 sans login,
journal d'audit (`proposition_generee` avec version, rien vers l'autre
cabinet).

## Import auto FPQ1 (étape 6/10)

Mêmes conventions (séparateur `;`, BOM, rapport ligne par ligne), avec des
**en-têtes en français** — miroir des exports (voir « Exports CSV/JSON »).
Quatre modèles téléchargeables depuis la page **Import** :
`Soumissions auto`, `Conducteurs auto`, `Véhicules auto`, `Antécédents auto`.
Les lignes commençant par `#` sont des commentaires et sont ignorées.

- `type=soumission` → crée une soumission auto pour l'entreprise (retrouvée par
  `Entreprise` ou `Courriel entreprise`).
- `type=conducteur` → ajoute un conducteur (rattaché via `Soumission (id)`, ou
  via `Entreprise` : la soumission active la plus récente est utilisée).
- `type=vehicule` → ajoute un véhicule + ses garanties (`RC — montant` :
  50000/1000000/2000000 ; `Protection B` : aucune/b1/b2/b3/b4 ; avenants FAQ
  43/20/27/34/5a en oui/non).
- `type=antecedents` → enregistre les antécédents de la soumission
  (une fiche par soumission).

Validation : dates au format AAAA-MM-JJ, NIV de 17 caractères (avertissement
sinon, la ligne est quand même créée), valeurs fermées pour les garanties.
**Chaque ligne crée une version** (règle d'or : rien n'est écrasé ni supprimé).
Le courtier ne peut importer que vers les entreprises de son portefeuille
(une entreprise qu'il crée via l'import lui est rattachée automatiquement).

Exemple : `scripts/exemple-import-auto.csv` (1 soumission, 2 conducteurs,
2 véhicules avec garanties, antécédents).

## Exports CSV/JSON (étape 5/10)

Page **Exports** (onglet dans la navigation) : 15 modules exportables (11 + 4 biens),
chacun en
**CSV** (séparateur `;`, BOM UTF-8, en-têtes en français tirés du dictionnaire
des champs, compatible Excel) ou **JSON** structuré (objets imbriqués :
protections, versions, suivis, paiements, produits…).

Modules : entreprises (+ consentements Loi 25), polices (+ protections et prime
totale), versions de polices (avenants), conducteurs auto, véhicules auto
(+ garanties et avenants FAQ aplatis), soumissions auto (+ antécédents),
réclamations, factures (+ paiements), tâches, leads, assureurs (+ produits et
taux de commission), bâtiments biens (+ garanties et avenants aplatis en 0/1),
contenus biens (rattachés ou « Contenu général »), soumissions biens
(+ antécédents, consentements, décomptes), versions de soumissions biens
(historique figé — règle d'or).
Les polices biens sont couvertes par le module **Polices** existant
(ligne « Biens commerciaux ») : pas de module séparé, pour éviter les doublons.

- Archivés exclus par défaut, case « Inclure les archivés ».
- Périmètre : admin/manager/adjoint = tout le cabinet ; **courtier = son
  portefeuille uniquement** (les assureurs, référentiel partagé, restent
  accessibles).
- **Aucun mot de passe ni secret n'est jamais exporté** (pas de module
  utilisateurs/comptes/jetons).
- Chaque export est journalisé ; rate-limit doux (100 / 10 min).
- **Convention unifiée des avenants** (étape 10/10) : les avenants FAQ sont
  stockés et échangés avec des **clés courtes** (`faq43`, `faq20`, `faq27`,
  `faq34`, `faq5a`, valeur `1`) partout — UI, import, export, proposition,
  seed. L'export accepte aussi en lecture les anciennes clés longues
  (`faq43_valeur_a_neuf`, …) des bases créées avant cette unification, et les
  colonnes CSV (`Avenant FAQ 43 (valeur à neuf)`, …) sont reconnues par
  l'import : un export se réimporte sans perte (round-trip testé).

## Tests

```bash
# lancer le serveur sur un port de test avec une base FRAÎCHE, puis :
PORT=3101 node scripts/test-ajustements.js
PORT=3101 node scripts/test-nouveaux-modules.js
PORT=3101 node scripts/test-principes.js
PORT=3101 node scripts/test-courriels.js
PORT=3101 node scripts/test-assureurs.js
PORT=3101 node scripts/test-demandes-2026-10-09.js
PORT=3101 node scripts/test-fpq1-etape2.js
PORT=3101 node scripts/test-fpq1-etape3.js
PORT=3101 node scripts/test-dictionnaire.js
# boucle courriel (étapes 1-4) :
CHEMIN_BD=/tmp/test-manques.db node scripts/test-manques.js
CHEMIN_BD=/tmp/test-demande.db PORT=3101 node scripts/test-demande-questions.js
CHEMIN_BD=/tmp/test-reponse.db PORT=3101 node scripts/test-analyse-reponse.js
CHEMIN_BD=/tmp/test-relance.db PORT=3101 node scripts/test-relance-demande.js
PORT=3101 node scripts/test-commandes-ia.js
PORT=3101 node scripts/test-voix.js
PORT=3101 node scripts/test-proposition-pdf.js
PORT=3101 node scripts/test-exports.js
PORT=3101 node scripts/test-import-auto.js
PORT=3101 node scripts/test-biens-etape2.js
PORT=3101 node scripts/test-biens-etape3.js
PORT=3101 node scripts/test-exports-biens.js
PORT=3101 node scripts/test-exports-rc.js
PORT=3101 node scripts/test-exports-cyber.js
PORT=3101 node scripts/test-import-biens.js
PORT=3101 node scripts/test-import-rc.js
PORT=3101 node scripts/test-proposition-biens-pdf.js
PORT=3101 node scripts/test-proposition-rc-pdf.js
PORT=3101 node scripts/test-commandes-rc.js
PORT=3101 node scripts/test-rc-etape2.js
PORT=3101 node scripts/test-cyber-etape2.js
PORT=3101 node scripts/test-cyber-etape3.js
PORT=3101 node scripts/test-flotte-etape2.js
PORT=3101 node scripts/test-flotte-etape3.js
# droits par rôle (serveur ET script avec la même base via CHEMIN_BD) :
CHEMIN_BD=/tmp/test-droits.db PORT=3101 node server.js &
CHEMIN_BD=/tmp/test-droits.db PORT=3101 node scripts/test-droits-2026-10-09.js
# couche données FPQ1 (pas de serveur requis, base via CHEMIN_BD) :
CHEMIN_BD=/tmp/test-fpq1.db node scripts/test-fpq1-etape1.js
# couche données biens commerciaux (pas de serveur requis, base via CHEMIN_BD) :
CHEMIN_BD=/tmp/test-biens1.db node scripts/test-biens-etape1.js
# couche données RC (pas de serveur requis, base via CHEMIN_BD) :
CHEMIN_BD=/tmp/test-rc1.db node scripts/test-rc-etape1.js
```
# couche données cyber (pas de serveur requis, base via CHEMIN_BD) :
CHEMIN_BD=/tmp/test-cyber1.db node scripts/test-cyber-etape1.js
# couche données flotte (pas de serveur requis, base via CHEMIN_BD) :
CHEMIN_BD=/tmp/test-flotte1.db node scripts/test-flotte-etape1.js
```

`test-ajustements.js` — 48 tests : login/CSRF, changement de mdp forcé, seed commercial, CRUD entreprise
(validation raison sociale, NEQ), polices par produit commercial + détection des
manquantes, réclamations (création, statuts, suivis, validation), tâches
(création, retard, terminer), journal d'audit + filtres, import CSV (modèle +
rapport d'erreurs), cloisonnement par cabinet, rôles (403 sur /admin/journal).

`test-nouveaux-modules.js` — 65 tests : factures (CRUD, numérotation auto, paiement
partiel → statut, détection en retard, relance → brouillon IA, 400 sans entreprise),
leads (capture publique avec jeton valide/invalide, honeypot bloqué, conversion en
entreprise, pipeline, stats), campagnes (segmentation par secteur, exclusion des
non-consentis LCAP, mention de désinscription, export CSV), réunions (création manuelle,
affichage sur le tableau de bord, page Microsoft), cloisonnement inter-cabinets sur
chaque nouveau module, formulaire public : 404 sans jeton valide.

`test-principes.js` — 112 tests : règle d'or « rien ne se supprime ». Cycle complet
d'archivage (archiver → invisible en liste → visible via « Voir les archivés » →
désarchiver → visible) pour entreprises, tâches, leads, campagnes, réunions,
brouillons et réclamations ; CSRF exigé sur ces routes ; archivages journalisés ;
versioning des polices (création = v1, modification = v2, ajout/retrait de
protection = v3/v4, snapshots intacts et consultables en lecture seule) ;
statuts de réclamation Ouverte/Fermée (anciens statuts → 400) ; anciennes routes
`…/supprimer` → 404 ; désactivation d'utilisateur (login refusé 401, session
coupée, réactivation, auto-désactivation refusée) ; cloisonnement des archives
et des versions entre cabinets.

`test-courriels.js` — 35 tests : module Courriels. Comptes (création, validation,
mot de passe jamais réaffiché en clair, test de connexion et synchro en échec gracieux
vers un hôte fictif, activer/désactiver, cycle archiver/désarchiver) ; rédaction
(page, validation, IA avec et sans contexte, envoi en échec SMTP gracieux) ;
404 sur courriel inexistant ; parsing MIME (RFC 2047, quoted-printable, multipart),
assainissement HTML, chiffrement roundtrip, liaison auto entreprise (connue/inconnue).

`test-assureurs.js` — 47 tests : fiches assureurs enrichies. Contacts comptabilité ;
produits offerts (cases à cocher, taux de commission par produit, validation 0–100 %,
retrait d'un produit décoché) ; liste sans compteur de polices ; filtre du menu
assureur par produit dans le formulaire police (`data-produits` + JS) ; équipes
(`manager_id` assigné par l'admin, validation même cabinet / pas d'auto-rattachement) ;
statistiques par assureur selon le rôle — admin (tout le cabinet), manager (son équipe),
courtier (son portefeuille : nombres vérifiés, pas de fuite inter-courtiers),
manager sans équipe (lui seul) ; cloisonnement inter-cabinets ; audit.

`test-fpq1-etape1.js` — 53 tests : couche données FPQ1 (étape 1/10, sans UI).
Création soumission → v1 ; ajouts illimités (5 conducteurs, 4 véhicules, chaque
ajout = 1 version) ; garanties par véhicule (upsert) ; antécédents (upsert) ;
modification → nouvelle version avec état précédent figé (vérifié) ; archivage
conducteur/véhicule/soumission (ligne conservée, exclue du snapshot courant,
présente dans l'historique) ; désarchivage ; changement de statut (+ refus des
statuts invalides) ; historique ordonné DESC avec auteur ; audit complet
(`fpq1_version` × N + actions) ; cloisonnement inter-cabinets (lecture,
modification, versionnage refusés) ; contraintes CHECK ; **aucun DELETE FROM
dans `lib/fpq1.js`** (vérifié par lecture du source) ; filtres liste/statut.

`test-biens-etape1.js` — 57 tests : couche données biens commerciaux (biens
étape 1/10, sans UI). Création soumission → v1 ; ajouts illimités (5 bâtiments,
4 contenus dont 1 général, chaque ajout = 1 version) ; garanties par bâtiment
(upsert, avenants JSON) ; antécédents (upsert) ; modification → nouvelle version
avec état précédent figé (vérifié) ; archivage bâtiment/contenu/soumission
(ligne conservée, exclue du snapshot courant, présente dans l'historique) ;
désarchivage ; changement de statut (+ refus des statuts invalides) ;
historique ordonné DESC avec auteur ; audit complet (`biens_version` × N +
actions) ; cloisonnement inter-cabinets ; contraintes CHECK (type_construction,
formule, type_contenu) ; **aucun DELETE FROM dans `lib/biens.js`** (vérifié par
lecture du source) ; filtres liste/statut.

`test-biens-etape2.js` — 74 tests : questionnaire de soumission biens (biens
étape 2/10, HTTP). Création, bâtiments/contenus illimités, garanties par
bâtiment, antécédents, versions, archivage, cloisonnement, portefeuille, audit.

`test-rc-etape2.js` — 70 tests : questionnaire de soumission RC (RC étape
2/10, HTTP). Création, 2 lieux d’exploitation, garanties par lieu (upsert :
limites, formule globale/locaux et opérations, avenants pollution/parapluie),
antécédents, versions à chaque mutation, archivage, statuts, versions lecture
seule, cloisonnement inter-cabinets, portefeuille courtier, CSRF, audit
(`rc_%`).

`test-cyber-etape2.js` — 71 tests : questionnaire de soumission cyber (cyber
étape 2/10, HTTP). Création, 2 mesures de sécurité, modification (maturité),
archivage/désarchivage, garanties par soumission (limites 1 M$/1 M$, franchise
5 000 $, carence « 8 heures », avenants rançongiciel/fraude transfert/données
vie privée/interruption, prime), antécédents avec incident cyber 5 ans (date,
type, montant, réclamé oui/non), versions à chaque mutation, archivage,
statuts, versions lecture seule, cloisonnement inter-cabinets, portefeuille
courtier, CSRF, audit (`cyber_%`).

`test-biens-etape3.js` — 52 tests : gestion de la police biens (biens étape
3/10, HTTP, miroir de test-fpq1-etape3.js). Conversion soumission → police
(produit `biens`, `biens_soumission_id`/`_version`, statut convertie_police,
v1, audit) ; fiche police avec bloc « Données biens » (snapshot figé :
bâtiments, contenus, garanties, antécédents, lien voir le snapshot) ;
avenants en cours de terme (bâtiment ajouté → v2 avec note, garanties
modifiées → v3) ; échéances ; double conversion refusée (400) ; liaison police
existante (302, police non-biens → 400, déjà liée → 400) ; CSRF 403 ;
cloisonnement inter-cabinets (404) ; portefeuille courtier (403 hors
portefeuille, conversion dans son portefeuille) ; audit `police_version`.

`test-exports.js` — 55 tests : exports CSV/JSON par module (étape 5/10). Page
200 + 11 modules proposés ; 302 non connecté ; CSRF 403 ; chaque module en CSV
(200, BOM, `;`, en-têtes français) et en JSON (structure : module, données,
périmètre) ; aucun hash ni secret dans les exports ; données démo présentes
(consentements Loi 25, garanties, produits assureurs) ; archivés exclus par
défaut / inclus avec la case ; périmètre courtier (son portefeuille uniquement,
référentiel assureurs accessible) ; journal d'audit ; 400 module/format inconnu ;
**round-trip avenants** : garanties posées via l'UI (faq43+faq20) → export CSV
(colonnes `1`) → import de la ligne → avenants conservés en base (clés courtes
unifiées, étape 10/10).

`test-import-auto.js` — 33 tests : import CSV étendu auto FPQ1 (étape 6/10).
Page et 4 modèles téléchargeables (soumission, conducteur, vehicule,
antecedents) ; fichier exemple complet (6 lignes créées, 0 erreur, 8 versions
figées) ; validation stricte (dates ISO, garanties fermées, NIV = avertissement)
; rapport d'erreurs exact ; cloisonnement inter-cabinets ; portefeuille courtier
(rejet hors portefeuille, rattachement auto à la création) ; journal d'audit.

`test-demandes-2026-10-09.js` — 57 tests : demandes du 2026-10-09. Menus
Police/Réclamation filtrés par entreprise ; fiche entreprise complète + contacts
multiples ; Assistant IA (chat, commandes locales) ; fiches assureurs + liaison
polices + dossier client groupé.

`test-droits-2026-10-09.js` — 48 tests : droits par rôle. Manager (tout sauf
/admin et comptes courriels) ; courtier (son portefeuille uniquement, ne change
pas le responsable) ; expert en sinistre (lecture partout, écriture limitée aux
réclamations) ; cloisonnement inter-cabinets. Se lance avec `CHEMIN_BD` identique
côté serveur et script.

`test-voix.js` — 53 tests : commande vocale (étapes 9/10 FPQ1 + biens). `normaliserDictee()`
(années en lettres, montants, codes épelés, ponctuation, texte libre intact) ;
câblage Web Speech API (`fr-CA`, indicateur d'écoute, pas d'envoi automatique,
dégradation gracieuse) ; pipeline serveur de bout en bout via un texte dicté
normalisé (confirmation → conducteur créé + version figée).

`test-proposition-pdf.js` — 31 tests HTTP : proposition pré-remplie (étape
7/10). Page HTML 200 + contenu (conducteur, véhicule, garanties RC/B1/franchise,
avenants FAQ, antécédents, consentements, mention version + « vérifiez avant
envoi », boutons Imprimer/PDF) ; version figée ?v=1 (200 + « figée »), ?v=999 →
404 ; soumission inexistante → 404 ; PDF 200 (`application/pdf`, `%PDF`,
texte décodé : conducteur, VIN, n° soumission) ; inter-cabinets → 404 (aucune
fuite) ; portefeuille courtier (403 hors portefeuille, 200 dedans) ; 302 sans
login ; audit `proposition_generee` (avec version, rien vers l'autre cabinet).

## FPQ1 — étape 8/10 : commande texte IA

L'utilisateur pilote l'application au texte depuis l'onglet **Assistant IA**
(la voix est branchée à l'étape 9/10 — voir ci-dessous) :

- `lib/commandes-ia.js` — **analyseur français à règles** (aucune clé requise) :
  `ajouter_conducteur` (« ajoute un conducteur Marie Tremblay permis T1234567
  à la soumission 1 »), `ajouter_vehicule` (marque, modèle, année, NIV),
  `modifier_garantie` (« mets la RC à 2 millions pour le véhicule 1 de la
  soumission 1 », protection B, franchise), `creer_rappel` (« rappelle-moi de…
  », délégué à l'exécuteur `creer_tache` validé), `aller_a` (« montre-moi la
  soumission 1 », « ouvre les échéances » → navigation), `rechercher`
  (« cherche le client Dubois », « cherche la police AUTO-2026-001 »).
  Synonymes (« ajoute », « rajoute »), résolution de la soumission par n° ou
  par nom de client (avec demande de précision si ambiguë), noms de champs
  validés via `lib/dictionnaire-champs.json`.
- **Deux moteurs** : sans `COHERE_API_KEY`, l'analyseur local ; avec la clé,
  Cohere reformule en JSON strict (schéma validé) exécuté par les mêmes
  fonctions (`interpreterCohere` dans `lib/commandes-ia.js`).
- **Confirmation** : toute modification FPQ1 affiche d'abord un résumé
  (« Je vais ajouter… Confirmez-vous ? ») avec boutons **✓ Confirmer** /
  Annuler (`POST /assistant/confirmer`, CSRF) — rien ne s'exécute avant le
  2e clic, et tout est **revérifié** à la confirmation (cabinet, portefeuille).
- **Sécurité** : exigeAuth ; le courtier ne peut commander que sur son
  portefeuille (refus poli sinon) ; toute modification passe par `lib/fpq1.js`
  (versionnage, règle d'or) ; chaque commande est journalisée (`commande_ia`).
- Les commandes historiques (contact, tâche, note) gardent leur comportement
  direct, sans confirmation.
- Tests : `scripts/test-commandes-ia.js` (48 tests : analyseur, synonymes,
  confirmation requise, fusion des garanties, ambiguïtés, hors portefeuille,
  inter-cabinets, audit, historique).

## FPQ1 — étape 9/10 : commande vocale

Le bouton 🎤 de l'assistant dicte au lieu de taper, et alimente le pipeline
de l'étape 8 (analyse → confirmation → exécution) :

- `public/dictee.js` — **module partagé** (navigateur + Node pour les tests) :
  `normaliserDictee()` re-convertit en chiffres ce que la reconnaissance
  vocale transcrit en lettres : « deux mille vingt-six » → 2026,
  « 2 millions » / « deux millions » → 2000000,
  « un million cinq cent mille » → 1500000,
  « T un deux trois… » → T1234567 (NIV, permis, téléphones épelés).
  Le texte libre n'est jamais modifié.
- `public/assistant.js` — Web Speech API (`fr-CA`) : clic = démarrer/arrêter,
  indicateur « 🎙️ Écoute… », le texte normalisé remplit le champ (l'utilisateur
  vérifie puis appuie sur **Envoyer** — jamais d'envoi automatique),
  dégradation gracieuse si le navigateur ne supporte pas la dictée.
- **Confidentialité** (rappelée dans l'aide de l'assistant) : la transcription
  navigateur passe par le service vocal du navigateur (Google/Apple selon le
  navigateur). **Option au déploiement VPS** : brancher Whisper auto-hébergé
  (modèle local, 100 % au Québec) à la place — à implémenter au déploiement,
  le pipeline d'interprétation/exécution restant inchangé.
- Tests : `scripts/test-voix.js` (normalisation, câblage, pipeline serveur
  de bout en bout via un texte dicté normalisé).

`test-fpq1-etape2.js` — 62 tests HTTP : UI questionnaire FPQ1 (étape 2/10).
Onglet Auto, création (400 sans client / client invalide), fiche et ses 5
sections, 3 conducteurs + 2 véhicules (illimités), garanties (400 si protection
B invalide), antécédents, versions v1…vN consultables (404 si inexistante),
statuts (400 si invalide) + filtre liste, archivage conducteur/soumission
(invisible → « Voir les archivées » → désarchivé), 403 sans CSRF, 404
soumission inexistante, cloisonnement inter-cabinets, portefeuille courtier
(400 hors portefeuille, 403 sur la fiche d’autrui), audit `fpq1_%`.

`test-fpq1-etape3.js` — 52 tests HTTP : gestion de la police auto (étape 3/10).
Conversion soumission → police (produit `auto`, 403 sans CSRF, 400 si déjà
convertie, données figées vérifiées en base), fiche police avec section Données
FPQ1 (conducteur + VIN affichés), avenant en cours de terme (ajout conducteur →
police v2 avec note d’avenant, visible dans l’historique), police auto dans les
échéances J-30, attestation imprimable (200 + contenu, 404 véhicule inexistant
et police non-auto), liaison d’une police existante (400 si non-auto, déjà liée
ou autre entreprise), cloisonnement inter-cabinets (404), portefeuille courtier
(403 hors portefeuille, conversion dans son portefeuille), audit.

### FPQ1 — étape 1/10 : couche données (sans interface)

Tables `auto_soumissions`, `auto_conducteurs`, `auto_vehicules`, `auto_garanties`,
`auto_antecedents` (+ `auto_soumission_versions`) : `cabinet_id` et `archive`
partout, conducteurs et véhicules en nombre illimité, champs JSON pour les
listes (infractions, suspensions, avenants FAQ, sinistres, consentements).
**Versionnage systématique** (modèle `police_versions`) : v1 à la création,
chaque modification applique le changement puis fige le nouvel état en v(n+1) ;
historique consultable en lecture seule (`versionsSoumission`,
`obtenirVersion`) ; journal d'audit sur chaque version. Accès via
`lib/fpq1.js` (requêtes paramétrées, filtre `cabinet_id`).

### Biens commerciaux — étape 1/10 : couche données (sans interface)

Même recette que le FPQ1, appliquée aux biens commerciaux. Tables
`biens_soumissions`, `biens_batiments`, `biens_contenus`, `biens_garanties`,
`biens_antecedents` (+ `biens_soumission_versions`) : `cabinet_id` et `archive`
partout, bâtiments et contenus en **nombre illimité**, contenus rattachés à un
bâtiment ou généraux (`batiment_id` NULL).

- **Bâtiment** : adresse, ville, code postal, type de construction
  (bois/acier/béton/maçonnerie/mixte), année de construction, superficie (pi²),
  nombre d'étages, occupation, valeur du bâtiment, gicleurs, distance caserne,
  chauffage, année de toiture.
- **Contenu** : description, type (mobilier/équipements/stock/améliorations/autre),
  valeur — par bâtiment ou général.
- **Garanties** (une fiche par bâtiment) : formule (tous risques / risques
  désignés), franchise, montant d'assurance, avenants JSON
  (`tremblement_terre`, `inondation`, `refoulement_egout`, `bris_machines`,
  `perte_exploitation_liee` — 1 = présent, clés courtes comme les FAQ auto),
  prime.
- **Antécédents** (une fiche par soumission) : assureur actuel, sinistres 5 ans
  en JSON, consentements.

**Versionnage systématique** : v1 à la création, chaque modification applique le
changement puis fige le nouvel état en v(n+1) ; historique lecture seule.
Accès via `lib/biens.js` (miroir de `lib/fpq1.js`, audit `biens_%`).
Tables documentées dans `lib/dictionnaire-champs.json` (domaine « biens »).
Seed : 1 soumission biens démo (Garage Saint-Michel inc. : 2 bâtiments,
3 contenus, garanties, antécédents).
Tests : `scripts/test-biens-etape1.js` (57 tests, sans serveur).

### RC (responsabilité civile / CGL) — étape 1/10 : couche données (sans interface)

Même recette que le FPQ1 et les biens, appliquée à la responsabilité civile des
entreprises (CGL). Tables `rc_soumissions`, `rc_exploitations`,
`rc_garanties`, `rc_antecedents` (+ `rc_soumission_versions`) : `cabinet_id` et
`archive` partout, lieux d'exploitation en **nombre illimité**. Coexiste avec le
module commercial existant (ligne `cgl` de `polices`), sans le modifier.

- **Lieu d'exploitation** : adresse, ville, code postal, type d'activité,
  code de classification (responsabilité), description des activités,
  chiffre d'affaires, masse salariale, nombre d'employés, superficie (pi²),
  sous-traitants (aucun/assurés/non assurés).
- **Garanties** (une fiche par lieu d'exploitation) : limite par sinistre
  (chaque occurrence), limite agrégat annuel, franchise, formule
  (locaux et opérations / produits et opérations complétées / globale),
  avenants JSON (`pollution`, `parapluie` — 1 = présent), prime.
- **Antécédents** (une fiche par soumission) : assureur actuel, sinistres RC
  5 ans en JSON, consentements.

**Versionnage systématique** : v1 à la création, chaque modification applique le
changement puis fige le nouvel état en v(n+1) ; historique lecture seule.
Accès via `lib/rc.js` (miroir de `lib/biens.js`, audit `rc_%`).
Tables documentées dans `lib/dictionnaire-champs.json` (domaine « rc » —
dictionnaire total : 45 tables, 516 colonnes).
Seed : 1 soumission RC démo (Constructions Méthot inc. : 2 lieux
d'exploitation, garanties 2 M$/4 M$, antécédents).
Tests : `scripts/test-rc-etape1.js` (48 tests, sans serveur).

### Cyber (cyberrisques) — étape 1/10 : couche données (sans interface)

Même recette que le FPQ1, les biens et la RC, appliquée aux cyberrisques des
entreprises. Tables `cyber_soumissions`, `cyber_mesures`, `cyber_garanties`,
`cyber_antecedents` (+ `cyber_soumission_versions`) : `cabinet_id` et `archive`
partout, mesures de sécurité en **nombre illimité**. Coexiste avec le module
commercial existant (ligne `cyber` de `polices`), sans le modifier.

- **Mesure de sécurité** : type de mesure (MFA, sauvegardes, antivirus/EDR,
  pare-feu, formation anti-hameçonnage, plan de réponse aux incidents,
  chiffrement…), statut (en place / partiel / absent / prévu), détails, notes.
- **Garanties** (une fiche par soumission) : limite par sinistre, limite
  agrégat annuel, franchise, délai de carence (ex. « 8 heures »), avenants
  JSON (`rancongiciel`, `fraude_transfert`, `donnees_vie_privee`,
  `interruption` — cf. codes CYB-* du catalogue commercial), prime.
- **Antécédents** (une fiche par soumission) : assureur actuel, **incidents
  cyber 5 ans** en JSON (date, type, montant, réclamé ou non), consentements.

**Versionnage systématique** : v1 à la création, chaque modification applique le
changement puis fige le nouvel état en v(n+1) ; historique lecture seule.
Accès via `lib/cyber.js` (miroir de `lib/rc.js`, audit `cyber_%`).
Tables documentées dans `lib/dictionnaire-champs.json` (domaine « cyber » —
dictionnaire total : 50 tables, 566 colonnes).
Seed : 1 soumission cyber démo (Clinique Dentaire Bouchard inc. : 4 mesures,
garanties 1 M$/1 M$, 1 incident rançongiciel non réclamé).
Tests : `scripts/test-cyber-etape1.js` (47 tests, sans serveur).

### Cyber (cyberrisques) — étape 2/10 : questionnaire de soumission (interface)

Nouvel onglet **« Cyber »** (`/cyber`), après « RC », miroir du questionnaire
RC : liste des soumissions (filtre par statut, « Voir les archivées », colonne
« Mesures de sécurité »), création (entreprise cliente, date d’effet souhaitée,
notes), puis **fiche soumission** en sections :

- **Mesures de sécurité (illimitées)** : formulaire d’ajout (type de mesure en
  liste fermée : MFA, sauvegardes, antivirus/EDR, pare-feu, formation
  anti-hameçonnage, plan de réponse aux incidents, chiffrement, gestion des
  correctifs, contrôle d’accès, autre ; niveau de maturité : en place / partiel /
  absent / prévu ; détails, notes) + liste avec **modifier** et
  archiver/désarchiver.
- **Garanties** (une fiche par soumission) : limite par sinistre, limite agrégat
  annuel, franchise, délai de carence (ex. « 8 heures »), avenants en cases à
  cocher (rançongiciel, fraude par transfert de fonds, données et vie privée,
  interruption d’activité), prime.
- **Antécédents** : assureur actuel, **incidents cyber 5 ans** (lignes
  dynamiques : date, type, montant, réclamé oui/non), consentements (dossier de
  crédit, dossier d’assurance).
- **Historique des versions** en lecture seule (`/cyber/:id/versions/:v`).

Toute mutation passe par `lib/cyber.js` (versionnage automatique, audit
`cyber_%`, cloisonnement cabinet_id, portefeuille courtier, CSRF). Le bloc
« 🏛️ Convertir en police » est en place sur la fiche (étape 3/10) ;
l’emplacement du bouton « 📄 Proposition » est réservé sur la fiche pour
l’étape 7/10.
Tests : `scripts/test-cyber-etape2.js` (71 tests, HTTP).

### Cyber (cyberrisques) — étape 3/10 : fiche police (gestion)

Miroir de l’étape 3/10 RC, appliqué aux cyberrisques :

- **`polices.cyber_soumission_id` + `polices.cyber_soumission_version`**
  (UNIQUE, migration avec reconstruction de table — mêmes conventions que
  l’auto, les biens et la RC, en préservant les colonnes existantes). La ligne
  utilisée est **`cyber`**, déjà présente dans le CHECK de `polices.ligne`.
- **Conversion** `POST /cyber/:id/convertir` : crée la police (ligne `cyber`),
  fige la version de la soumission, crée la v1 de la police, journal
  `police_creee`. **Liaison** `POST /cyber/:id/lier-police` : police cyber
  existante de la même entreprise (refus : police d’une autre ligne, déjà
  liée, autre entreprise). Bloc « 🏛️ Convertir en police » sur la fiche
  cyber (`views/cyber/fiche.ejs`).
- **Avenants en cours de terme** : `noterAvenantPolice()` branchée aux 9
  points de mutation de `routes/cyber.js` (ajout / modification / archivage /
  désarchivage de mesure de sécurité, garanties, antécédents, changement de
  statut, archivage de soumission) — chaque mutation d’une soumission
  convertie crée une version de la police avec note (règle d’or).
- **Fiche police** (`/echeances/police/:id`) : bloc **« 🛡️ Données cyber »**
  (mesures de sécurité figées à la conversion — type, niveau de maturité,
  détails — + garanties — limite par sinistre, agrégat, franchise, délai de
  carence, avenants — + antécédents avec incidents cyber 5 ans, lien « voir
  le snapshot »).
- Dictionnaire : les 2 nouvelles colonnes `polices` sont documentées
  (l’enrichissement complet du domaine cyber viendra à l’étape 4/10).
Tests : `scripts/test-cyber-etape3.js` (55 tests, HTTP).

### Cyber (cyberrisques) — étape 4/10 : dictionnaire IA enrichi

Enrichissement du domaine « cyber » dans `lib/dictionnaire-champs.json`,
miroir de l'étape 4/10 RC : descriptions métier utiles à la tarification, toutes
les valeurs CHECK documentées, colonnes figées marquées.

- **Descriptions métier** : pourquoi la maturité des mesures de sécurité fait
  varier la prime (MFA généralisé, sauvegardes hors site testées, plan de
  réponse = risque rançongiciel plus faible ; absence de mesures de base =
  surprime, franchise majorée ou refus) ; à quoi sert le **délai de carence**
  (équivalent de la franchise pour la garantie interruption — une carence plus
  longue fait baisser la prime) ; ce que couvre chacun des 4 avenants
  (rançongiciel, fraude par transfert de fonds, données et vie privée — Loi 25
  au Québec —, interruption d'activité) ; ce que disent les **incidents 5 ans**
  sur le risque (rançongiciel payé ou fuite de données = risque aggravé).
- **Valeurs documentées** : `type_mesure` (mfa, sauvegardes, antivirus_edr,
  pare_feu, formation_hameconnage, plan_reponse_incident, chiffrement,
  gestion_correctifs, controle_acces, autre), maturités
  (en_place/partiel/absent/prevu), statuts de soumission et de version,
  clés des avenants.
- **Colonnes figées marquées** : `statut`, `notes`, `date_effet_souhaitee`,
  `donnees` de `cyber_soumission_versions` portent le marqueur `figee: true`
  (lisible par l'IA) + badge « figée » sur la page `/admin/dictionnaire`.
- `lib/contexte-ia.js` expose automatiquement les nouvelles valeurs au moteur
  IA (ex. `mfa|sauvegardes|antivirus_edr`, `en_place|partiel|absent|prevu`).

Tests : `scripts/test-dictionnaire.js` étendu (132 tests, HTTP).

### Cyber (cyberrisques) — étape 5/10 : exports CSV/JSON

Miroir de l'étape 5/10 RC : **3 nouveaux modules** dans `routes/exports.js`
→ **21 modules au total** (11 FPQ1 + 4 biens + 3 RC + 3 cyber).

- **`cyber_mesures`** : une ligne par mesure de sécurité (soumission,
  entreprise, **type de mesure en libellé FR** — « MFA — authentification
  multifacteur » — pas le code brut, maturité en français, détails, notes,
  archivé).
- **`cyber_soumissions`** : une ligne par soumission (id, entreprise, statut,
  date d'effet, version courante, nb mesures, nb versions, limite par
  sinistre, limite agrégat, franchise, **délai de carence**, prime,
  **4 avenants en colonnes 0/1** — rançongiciel, fraude par transfert de
  fonds, données et vie privée, interruption d'activité —, assureur actuel,
  nb d'incidents 5 ans, consentements 0/1, archivé).
- **`cyber_versions`** : une ligne par version figée (soumission, version,
  statut, auteur, date, snapshot JSON parsé `{mesures, garanties,
  antecedents}`).

Conventions des autres modules : CSV séparateur `;` + BOM, en-têtes en
français du dictionnaire, périmètre par rôle (courtier = son portefeuille
uniquement), archivés exclus par défaut (case à cocher), aucun secret,
journal d'audit `export_*`. Les 3 modules apparaissent sur la page
**Exports** comme les modules RC.

Tests : `scripts/test-exports-cyber.js` (**43 tests**, HTTP) — données créées
via les routes (`/cyber`), chaque module en CSV (BOM, `;`, en-têtes FR,
libellés pas codes bruts, colonnes avenants 0/1, « Nb d'incidents 5 ans »)
et JSON (structure, garanties imbriquées, incidents, consentements,
snapshot parsé), archivés exclus/inclus, périmètre courtier, aucun secret,
journal d'audit, 400 module inconnu, 403 sans CSRF. Compte des modules
21 mis à jour dans `scripts/test-exports-biens.js`.
Capture : `demo-captures/commercial/57-exports-cyber.png`.

### Cyber (cyberrisques) — étape 6/10 : import CSV en lot

Miroir de l'étape 6/10 RC : **4 nouveaux types** dans `routes/import.js`
(en-têtes en français, miroir des exports cyber) :

- **`soumission_cyber`** : création d'une soumission (entreprise par « Entreprise »
  ou « Courriel entreprise », date d'effet souhaitée AAAA-MM-JJ, statut
  brouillon/soumise, notes).
- **`mesure_cyber`** : ajout de mesures de sécurité — rattachement par
  « Soumission (id) » ou « Entreprise » (la plus récente) — type validé parmi les
  10 codes (`mfa`, `sauvegardes`, `antivirus_edr`, `pare_feu`,
  `formation_hameconnage`, `plan_reponse_incident`, `chiffrement`,
  `gestion_correctifs`, `controle_acces`, `autre`), maturité
  (`en_place`, `partiel`, `absent`, `prevu`), détails.
- **`garanties_cyber`** : fiche garanties par soumission (limite par sinistre,
  limite agrégat, franchise ≥ 0, délai de carence en texte libre, prime,
  4 avenants 0/1 — rançongiciel, fraude par transfert de fonds, données et vie
  privée, interruption d'activité).
- **`antecedents_cyber`** : fiche antécédents (assureur actuel, incidents cyber
  5 ans en lignes `AAAA-MM-JJ|type|montant` séparées par « ; » — 4ᵉ champ
  `|oui` optionnel si le sinistre a été réclamé —, consentements).

Validation stricte (types, maturités, nombres ≥ 0, dates ISO), chaque ligne
crée une version via `lib/cyber.js` (règle d'or), erreurs ligne par ligne avec
résumé. Modèles téléchargeables `/import/modele-cyber/:type`, exemple
`scripts/exemple-import-cyber.csv`, 4 types visibles sur la page **Import**.

Tests : `scripts/test-import-cyber.js` (HTTP) — page + section + 4 modèles,
exemple (4 créées, 0 erreur), vérification miroir via exports (type et
maturité en français, carence, avenants 1/0, **4 versions**), en-tête avec
apostrophe courbe reconnu (bug racine corrigé à l'étape 6 RC), fichier
d'erreurs (type inconnu, maturité invalide, montant négatif, date invalide,
soumission introuvable, montant incident invalide), cloisonnement
inter-cabinets, portefeuille courtier (hors portefeuille rejeté, son
entreprise/soumission/mesure OK), journal d'audit.
Capture : `demo-captures/commercial/58-import-cyber.png`.

### Cyber (cyberrisques) — étape 7/10 : proposition PDF pré-remplie

Miroir de l'étape 7/10 RC : proposition d'assurance cyberrisques
**pré-remplie**, générée à partir de la soumission — état courant OU version
figée `?v=N` (règle d'or : la proposition d'une version figée n'est jamais
réécrite). Lecture seule : la proposition ne modifie JAMAIS la soumission.

- **`lib/proposition-cyber.js`** : source unique des données — proposant
  (entreprise, contact, courtier responsable), **mesures de sécurité** (type,
  maturité, détails), **garanties** (limite par sinistre, agrégat annuel,
  franchise, **délai de carence**, avenants rançongiciel / fraude par transfert
  de fonds / données et vie privée / interruption d'activité, prime),
  **antécédents** (assureur actuel, **incidents cyber 5 ans** avec statut
  réclamé/non réclamé), consentements, signatures.
- **`lib/proposition-cyber-pdf.js`** : PDF (pdfkit, texte non compressé pour
  la traçabilité) avec le même contenu que la page HTML.
- **Vue** `views/cyber/proposition.ejs` (CSS/JS externes `/proposition.css`,
  `/proposition.js` — aucun JS inline, CSP) avec boutons 🖨️ Imprimer et
  ⬇️ Télécharger PDF.
- **Routes** `GET /cyber/:id/proposition` et `GET /cyber/:id/proposition.pdf`
  (périmètre cabinet/portefeuille, audit `proposition_cyber_generee` avec le
  n° de version). Le bouton **« 📄 Proposition »** sur la fiche cyber est
  désormais actif (était grisé jusqu'à l'étape 7).

Tests : `scripts/test-proposition-cyber-pdf.js` (HTTP) — page HTML (mesures /
maturités / garanties / carence / avenants / incidents / consentements /
signatures, pas de JS inline, CSS externe), version figée `?v=1`, 404 (`?v=999`,
soumission inexistante), PDF valide (en-tête %PDF, contenu), 403/404 sécurité
(inter-cabinets, courtier hors portefeuille / dans le portefeuille, anonyme),
journal d'audit.
Capture : `demo-captures/commercial/59-proposition-cyber.png`.

### Cyber (cyberrisques) — étape 8/10 : commandes texte IA

Miroir de l'étape 8/10 RC, étendu au cyber dans `lib/commandes-ia.js`
(analyseur local à règles, même protocole analyse → confirmation →
exécution, sans envoi auto) :

- **Nouvelles actions** : `ajouter_mesure_cyber` (« ajoute la mesure MFA en
  place à la soumission cyber 1 » — 10 types de mesure reconnus
  (MFA, sauvegardes, antivirus/EDR, pare-feu, formation anti-hameçonnage,
  plan de réponse aux incidents, chiffrement, gestion des correctifs,
  contrôle d'accès, autre), maturité en place/partiel/absent/prévu,
  détails en texte libre), `modifier_garanties_cyber` (« mets la limite par
  sinistre à 2 millions et retire l'avenant interruption pour la soumission
  cyber 1 » — limite par sinistre, agrégat, franchise, délai de carence,
  prime, avenants rançongiciel / fraude par transfert de fonds / données
  et vie privée / interruption avec ajout ET retrait, **fusion** : les champs
  non mentionnés sont conservés) et `modifier_maturite_mesure` (« passe la
  mesure MFA en partiel sur la soumission cyber 1 » — rattachement par type
  ou par n°).
- **Résolution** : « soumission cyber 1 » vs « soumission RC 1 » vs
  « soumission biens 1 » vs « soumission 1 » (auto) distingués partout
  (`aller_a` aussi : « montre-moi la soumission cyber 1 » → `/cyber/1`,
  « ouvre le cyber » → `/cyber`) ; dans les actions cyber, « à la
  soumission 1 » vise implicitement une soumission cyber ; résolution par nom
  de client avec demande de précision si ambiguë. Gardes anti-collision :
  les analyseurs auto/biens/RC ignorent les commandes mentionnant « cyber »
  et inversement.
- **Mode Cohere** : schéma JSON strict étendu aux 3 actions
  (`ACTIONS_COHERE`). **Sécurité** : exigeAuth ; courtier = son portefeuille
  (refus poli) ; modifications via `lib/cyber.js` (versionnage, règle d'or) ;
  **confirmation obligatoire** (`ACTIONS_CONFIRMABLES` dans
  `lib/assistant.js`, revérifiée au 2e clic, CSRF) ; audit `commande_ia`.
- Aide de l'assistant : 4 exemples de commandes cyber ajoutés.

Tests : `scripts/test-commandes-cyber.js` — 57 tests : analyseur (types de
mesure, maturités, fusion des garanties, ajout/retrait d'avenants, carence,
distinction auto/biens/RC/cyber, non-régressions), confirmation requise
(rien exécuté avant le 2e clic), mesure créée + version figée, maturité
changée, ambiguïtés, inter-cabinets sans fuite, portefeuille courtier
(refus + OK), CSRF 403, audit, règle d'or (aucun DELETE FROM cyber_).
Capture : `demo-captures/commercial/60-commande-cyber.png`.

### Cyber (cyberrisques) — étape 9/10 : dictée vocale (voix)

Miroir de l'étape 9/10 RC, étendu au vocabulaire cyber dans
`public/dictee.js` (`normaliserDictee()`, réutilise les règles
FPQ1/biens/RC — années, montants en lettres, montants décimaux) :

- **Durées** : « délai de carence de huit heures » → « délai de carence de
  8 heures » (« vingt-quatre heures » → « 24 heures ») — l'unité « heures »
  est **conservée** (le délai est stocké avec son unité, contrairement aux
  montants).
- **Références** : « à la soumission cyber un » → « à la soumission cyber
  1 » (l'analyseur exige des chiffres) ; « la mesure deux » → « la mesure
  2 » (index de mesure).
- **Vocabulaire cyber en texte libre** (reconnu tel quel par l'analyseur à
  règles : MFA, sauvegardes, antivirus/EDR, pare-feu, formation
  anti-hameçonnage, plan de réponse aux incidents, chiffrement, correctifs,
  contrôle d'accès ; maturités en place/partiel/absent/prévu ; avenants
  rançongiciel / fraude par transfert de fonds / données et vie privée /
  interruption d'activité ; « délai de carence »).
- **Pipeline voix → confirmation → exécution** vérifié : « ajoute la mesure
  MFA en place à la soumission cyber un » → normalisé → analysé par
  `ajouter_mesure_cyber` → confirmation → exécution (mesure en base,
  version figée, règle d'or). Bouton 🎤 (Web Speech API `fr-CA`) sur le
  chat de l'assistant ; jamais d'envoi automatique. **Limite honnête** : la
  transcription passe par le service vocal du navigateur (Google/Apple selon
  le navigateur) ; une transcription 100 % locale (Whisper auto-hébergé)
  est prévue comme option au déploiement VPS.

Tests : `scripts/test-voix.js` — 71 → **94 tests** (12 nouvelles règles
cyber + 11 tests de pipeline cyber, non-régression des règles
FPQ1/biens/RC).
Capture : `demo-captures/commercial/61-voix-cyber.png`.

### Cyber (cyberrisques) — étape 10/10 : final (balayage complet)

Balayage final du module cyber (2026-10-19) : toutes les suites exécutées
une par une sur bases fraîches (serveur tué + base supprimée entre chaque ;
suites modèle avec `CHEMIN_BD` seul, sans serveur — lancer un serveur en
parallèle pollue les comptes du seed et fait échouer à tort `test-cyber-etape1.js`
et `test-rc-etape1.js`, leçon apprise ; `test-droits-2026-10-09.js` et
`test-voix.js` avec `CHEMIN_BD` identique sur serveur ET script ;
`test-phase1.js` exclue — obsolète).

**Résultat : 1986/1986 tests verts, zéro échec** (37 suites).

| Suite | Tests |
|---|---|
| test-principes.js (règle d'or) | 112 |
| test-dictionnaire.js (auto + biens + RC + cyber) | 132 |
| test-voix.js (FPQ1 + biens + RC + cyber) | 94 |
| test-biens-etape2.js (questionnaire biens) | 74 |
| test-cyber-etape2.js (questionnaire cyber) | 71 |
| test-rc-etape2.js (questionnaire RC) | 70 |
| test-nouveaux-modules.js | 65 |
| test-fpq1-etape2.js | 62 |
| test-demandes-2026-10-09.js | 57 |
| test-biens-etape1.js (modèle biens) | 57 |
| test-commandes-cyber.js | 57 |
| test-exports.js | 55 |
| test-cyber-etape3.js (police cyber) | 55 |
| test-rc-etape3.js (police RC) | 54 |
| test-fpq1-etape1.js (modèle auto) | 53 |
| test-fpq1-etape3.js | 52 |
| test-biens-etape3.js (police biens) | 52 |
| test-ajustements.js | 48 |
| test-commandes-ia.js (auto) | 48 |
| test-commandes-rc.js | 48 |
| test-rc-etape1.js (modèle RC) | 48 |
| test-droits-2026-10-09.js | 48 |
| test-assureurs.js | 47 |
| test-commandes-biens.js | 47 |
| test-cyber-etape1.js (modèle cyber) | 47 |
| test-exports-biens.js | 44 |
| test-exports-cyber.js | 43 |
| test-exports-rc.js | 41 |
| test-courriels.js | 37 |
| test-import-biens.js | 36 |
| test-import-cyber.js | 36 |
| test-proposition-biens-pdf.js | 33 |
| test-import-auto.js | 33 |
| test-import-rc.js | 33 |
| test-proposition-cyber-pdf.js | 34 |
| test-proposition-rc-pdf.js | 32 |
| test-proposition-pdf.js | 31 |
| **Total** | **1986** |

- Captures 53–61 revues visuellement : `demo-captures/commercial/`
  (53-cyber-liste, 54-cyber-fiche, 55-police-cyber, 56-dictionnaire-cyber,
  57-exports-cyber, 58-import-cyber, 59-proposition-cyber,
  60-commande-cyber, 61-voix-cyber).
- **Règle d'or re-vérifiée** : zéro « supprimer » dans `views/cyber/`, zéro
  « zone dangereuse », zéro route DELETE sur `/cyber`, zéro
  `DELETE FROM cyber_*` en dur (seule occurrence : un commentaire dans
  `lib/cyber.js` et le test qui l'interdit) — archivage doux partout,
  chaque mutation crée une version figée.
- **ZIP de livraison** : `courtier-cyber-final.zip` (préfixe `courtier-app/`,
  captures incluses, aucun `courtier.db*`, aucun `.env`, aucun
  `node_modules`, aucun `.git` — contenu vérifié par inspection).

### E&O (responsabilité professionnelle) — étape 1/10 : couche données (sans interface)

Même recette que le FPQ1, les biens, la RC et le cyber, appliquée à la
responsabilité professionnelle (erreurs et omissions) des entreprises.
Tables `eo_soumissions`, `eo_activites`, `eo_garanties`, `eo_antecedents`
(+ `eo_soumission_versions`) : `cabinet_id` et `archive` partout, activités
professionnelles en **nombre illimité**. Coexiste avec le module commercial
existant (ligne `eo` de `polices`), sans le modifier.

- **Activité professionnelle** (illimitée) : description du service
  professionnel (tenue de livres, fiscalité, conseil en TI…), chiffre
  d'affaires annuel de l'activité, nombre de professionnels, notes.
- **Garanties** (une fiche par soumission) : limite par sinistre, limite
  agrégat annuel, franchise, base CHECK `reclamations_presentees` /
  `occurrences` (la forme claims-made est la plus courante en E&O), avenants
  JSON (`frais_defense`, `medias_contenu`, `cyber_associe` — cf. codes EO-*
  du catalogue commercial), prime.
- **Antécédents** (une fiche par soumission) : assureur actuel, **réclamations
  E&O 5 ans** en JSON (date, nature, montant, réclamé ou non),
  **circonstances pouvant donner lieu à réclamation** (question piège du
  questionnaire E&O en base réclamations-présentées), consentements.

**Versionnage systématique** : v1 à la création, chaque modification applique le
changement puis fige le nouvel état en v(n+1) ; historique lecture seule.
Accès via `lib/eo.js` (miroir de `lib/cyber.js`, audit `eo_%`).
Tables documentées dans `lib/dictionnaire-champs.json` (domaine « eo » —
dictionnaire total : 55 tables, 619 colonnes).
Seed : 1 soumission E&O démo (Groupe Conseil Lussier inc., consultants en TI :
3 activités, garanties 2 M$/2 M$ base réclamations-présentées, 1 réclamation
45 000 $ réclamée + circonstances déclarées).
Tests : `scripts/test-eo-etape1.js` (47 tests, sans serveur).
Balayage complet après l'étape (38 suites, une à la fois, bases fraîches,
`test-phase1.js` exclue — obsolète) : **2033/2033 tests verts, zéro échec**
(1986 du final cyber + 47 E&O).

### E&O (responsabilité professionnelle) — étape 2/10 : questionnaire de soumission (interface)

Nouvel onglet **« E&O »** (`/eo`), après « Cyber », miroir du questionnaire
cyber : liste des soumissions (filtre par statut, « Voir les archivées »,
colonne « Activités professionnelles »), création (entreprise cliente, date
d’effet souhaitée, notes), puis **fiche soumission** en sections :

- **Proposant/dates** : entreprise, effet souhaité, notes, statut
  (brouillon → soumise → convertie en police), archivage doux.
- **Activités professionnelles (illimitées)** : description du service,
  chiffre d’affaires annuel, nombre de professionnels, notes —
  ajouter / modifier / archiver / désarchiver (bouton grisé
  « 📄 Proposition (bientôt) », câblé à l’étape 7/10).
- **Garanties** : limite par sinistre, limite agrégat annuel, franchise,
  **base de garantie** en boutons radio (réclamations-présentées /
  occurrences), avenants frais de défense / médias et contenu / cyber
  associé, prime.
- **Antécédents** : assureur actuel, n° police, échéance, années continues,
  **réclamations E&O 5 ans** en lignes dynamiques (date, nature, montant $,
  réclamé oui/non), **circonstances pouvant donner lieu à réclamation**,
  consentements (crédit, dossier d’assurance).
- **Historique des versions** en lecture seule (v1, v2…).

Routes `routes/eo.js` + vues `views/eo/` (liste, formulaire, fiche, version),
toutes les mutations passent par `lib/eo.js` (versionnage automatique, audit
`eo_%`), cloisonnement cabinet + portefeuille courtier, CSRF. Règle d’or :
aucun bouton de suppression, archivage doux partout (vérifié statiquement
dans les tests). Captures : `62-eo-liste.png`, `63-eo-fiche.png`.
Tests : `scripts/test-eo-etape2.js` (**82/82** : création 400 sans client /
client invalide / date invalide, 2 activités + CA négatif rejeté, modification,
archivage/désarchivage, garanties claims-made + upsert sans doublon +
base invalide rejetée, antécédents avec réclamation + circonstances +
consentements, versions à chaque mutation, statuts, 404, archivage soumission,
portefeuille courtier 403, inter-cabinets 404, anonyme 302, sans CSRF 403,
audit `eo_%`, zéro `DELETE FROM eo_` en dur).
Balayage complet après l'étape (39 suites, une à la fois, bases fraîches,
`test-phase1.js` exclue — obsolète) : **2114/2114 tests verts, zéro échec**
(2033 de l'étape 1 + 82 E&O étape 2 − 1 : `test-droits` compte réellement
47 tests, pas 48 comme indiqué précédemment ; son unique échec en balayage
était un artefact du harnais — le `curl /connexion` de santé consommait une
des 20 requêtes du rate-limit — 47/47 en relance propre).

### E&O (responsabilité professionnelle) — étape 3/10 : fiche police (gestion)

Migration `lib/bd.js` : ajout de `polices.eo_soumission_id` +
`polices.eo_soumission_version` (UNIQUE, reconstruction de table préservant
les colonnes auto/biens/RC/cyber — mêmes conventions que les migrations
précédentes), miroir exact du pattern cyber :

- `POST /eo/:id/convertir` : crée la police (**ligne `eo`**, déjà dans le
  CHECK), fige la version de la soumission, crée la v1 de la police,
  statut → `convertie_police`, audit `police_creee` ; bouton « Convertir en
  police » câblé sur la fiche (numéro, assureur, dates, franchise).
- `POST /eo/:id/lier-police` : liaison à une police E&O existante de la même
  entreprise (refus : autre ligne, déjà liée, autre entreprise, hors
  portefeuille).
- `noterAvenantPolice()` branchée aux **8 points de mutation** de
  `routes/eo.js` (ajout / modification / archivage / désarchivage d'activité,
  garanties, antécédents, changement de statut, archivage de soumission) :
  chaque mutation en cours de terme crée une version de la police avec note
  (règle d'or).
- Fiche police `/echeances/police/:id` : bloc **« 💼 Données E&O »** affichant
  le snapshot figé (activités professionnelles avec CA et nb de
  professionnels, garanties — limites, franchise, **base
  réclamations-présentées/occurrences**, avenants, prime —, antécédents avec
  réclamations 5 ans et circonstances) + lien « voir le snapshot ».
- Dictionnaire : les 2 nouvelles colonnes `polices` documentées
  (vérificateur vert : **55 tables, 621 colonnes**).

Tests : `scripts/test-eo-etape3.js` (**56/56** : conversion → police ligne
`eo` liée + version figée, bloc Données E&O visible — activité, CA, base,
avenant, circonstances —, avenants auto-versionnés à chaque mutation
(v2/v3/v4 avec notes), double conversion refusée, liaison + refus
non-E&O/déjà-liée, inter-cabinets 404, portefeuille courtier 403, CSRF 403,
audit, aucun `DELETE FROM eo_*` en dur). Capture : `64-police-eo.png`
(revue visuellement : fiche EO-001, bloc Données E&O complet, historique
v1–v4, protections recommandées EO-FRAIS / EO-RESP du catalogue commercial).
Balayage complet après l'étape (**40 suites**, une à la fois, bases fraîches,
`test-phase1.js` exclue — obsolète) : **2172/2172 tests verts, zéro échec**
(2114 de l'étape 2 − 82 E&O étape 2 + 83 E&O étape 2 corrigée : l'assertion
« pas de bouton de conversion » écrite à l'étape 2 est devenue
« bouton de conversion présent » + « route de conversion câblée », la
conversion étant livrée à l'étape 3 — + 56 E&O étape 3).
Règle d'or vérifiée : aucun `DELETE FROM eo_*` dans `routes/eo.js` ni
`lib/eo.js`.

### E&O (responsabilité professionnelle) — étape 4/10 : dictionnaire IA enrichi

Enrichissement du domaine « eo » dans `lib/dictionnaire-champs.json`,
miroir de l'étape 4/10 cyber : descriptions métier utiles à la tarification,
toutes les valeurs CHECK documentées, colonnes figées marquées.

- **Descriptions métier** : le CA par activité = mesure d'exposition
  (tarifs souvent exprimés en taux par tranche de 1 000 $ de CA ; activité
  non déclarée = erreur non couverte) ; la **base réclamations-présentées
  (claims-made) vs occurrences** — en claims-made la continuité d'assurance
  et la **date de rétroactivité** sont critiques (une interruption peut faire
  perdre la rétroactivité) ; les **circonstances pouvant donner lieu à
  réclamation** = la question piège — en claims-made, déclarer une
  circonstance agit comme un avis de circonstance qui verrouille la
  couverture future, ne pas déclarer une circonstance connue peut entraîner
  le refus pur et simple ; ce que couvre chacun des 3 avenants (frais de
  défense — souvent en sus des limites, médias et contenu — diffamation,
  propriété intellectuelle —, cyber-incident lié à une erreur
  professionnelle) ; les **réclamations 5 ans** comme indicateur de
  sinistralité (même les incidents non réclamés comptent).
- **Valeurs documentées** : `base` (reclamations_presentees, occurrences),
  clés des avenants (frais_defense, medias_contenu, cyber_associe), statuts
  de soumission et de version.
- **Colonnes figées marquées** : `statut`, `notes`, `date_effet_souhaitee`,
  `donnees` de `eo_soumission_versions` portent le marqueur `figee: true`
  (lisible par l'IA) + badge « figée » sur la page `/admin/dictionnaire`.
- `lib/contexte-ia.js` : `eo_soumission_versions` ajouté à la ligne de la
  règle d'or (les nouvelles valeurs `reclamations_presentees|occurrences`,
  `frais_defense|medias_contenu|cyber_associe` sont exposées
  automatiquement).

Tests : `scripts/test-dictionnaire.js` étendu (167 tests, HTTP) — 35
nouveaux tests E&O (domaine, valeurs CHECK, descriptions métier
claims-made/circonstances/CA, marqueur figee, contexte IA, page admin).
Correction en route : le test du libellé de domaine échouait à cause de
l'échappement HTML (`E&O` → `E&amp;O` sur la page) — test assoupli sur
« Responsabilité professionnelle ».

Balayage complet après l'étape (**40 suites**, une à la fois, bases fraîches,
`test-phase1.js` exclue — obsolète ; suites modèle SANS serveur, suites HTTP
avec CHEMIN_BD identique serveur+script) : **2207/2207 tests verts, zéro
échec** (2172 de l'étape 3 + 35 nouveaux tests E&O du dictionnaire).
Dictionnaire : **55 tables, 621 colonnes** (vérificateur vert).
Règle d'or vérifiée : zéro `DELETE FROM eo_*` en dur, aucun bouton
« supprimer », aucune « zone dangereuse » dans `views/eo/`, aucune route
DELETE sur `/eo`. Capture : `65-dictionnaire-eo.png` (revue visuellement :
section « Responsabilité professionnelle (E&O) », badge « versionnée »,
valeurs documentées).

### E&O (responsabilité professionnelle) — étape 5/10 : exports CSV/JSON

Miroir de l'étape 5/10 cyber : **3 nouveaux modules** dans `routes/exports.js`
→ **24 modules au total** (11 FPQ1 + 4 biens + 3 RC + 3 cyber + 3 E&O).

- **`eo_activites`** : une ligne par activité professionnelle (soumission,
  entreprise, description du service, **chiffre d'affaires ($)**,
  nb de professionnels, notes, archivé).
- **`eo_soumissions`** : une ligne par soumission (id, entreprise, statut,
  date d'effet, version courante, nb activités, nb versions, limite par
  sinistre, limite agrégat, franchise, **base de garantie en libellé FR**
  — « Réclamations-présentées » / « Occurrences » — prime, **3 avenants en
  colonnes 0/1** — frais de défense, médias et contenu, cyber associé —,
  assureur actuel, **nb de réclamations 5 ans** (calculé du JSON),
  **circonstances déclarées** 0/1, consentements 0/1 — dossier de crédit,
  dossier d'assurance —, archivé).
- **`eo_versions`** : une ligne par version figée (soumission, version,
  statut, auteur, date, snapshot JSON parsé `{activites, garanties,
  antecedents}`).

Conventions des autres modules : CSV séparateur `;` + BOM, en-têtes en
français du dictionnaire, périmètre par rôle (courtier = son portefeuille
uniquement), archivés exclus par défaut (case à cocher), aucun secret,
journal d'audit `export_*`. Les 3 modules apparaissent sur la page
**Exports** comme les modules cyber. Comptes des modules 21→24 mis à jour
dans `scripts/test-exports-biens.js`, `scripts/test-exports-rc.js` et
`scripts/test-exports-cyber.js`.
Tests : `scripts/test-exports-eo.js` (**45 tests**, HTTP) — données créées
via les routes (`/eo`), chaque module en CSV (BOM, `;`, en-têtes FR, base
en libellé pas en code, colonnes avenants 0/1, « Nb de réclamations 5 ans »,
« Circonstances déclarées ») et JSON (structure, garanties imbriquées,
réclamations, consentements, snapshot parsé), archivés exclus/inclus,
périmètre courtier, aucun secret, journal d'audit, 400 module inconnu,
403 sans CSRF. Capture : `demo-captures/commercial/66-exports-eo.png`.

### E&O (responsabilité professionnelle) — étape 6/10 : import CSV étendu

Miroir de l'étape 6/10 cyber : la page **Import** existante gagne une section
**« Import E&O — responsabilité professionnelle »** (séparateur `;`, BOM,
rapport ligne par ligne, modèles téléchargeables avec commentaires `#`,
CSRF, 5 Mo max, courtier = son portefeuille uniquement, journal d'audit) :

- **4 nouveaux types de lignes** (en-têtes en français, **miroir des exports
  E&O**) : `soumission_eo` (entreprise, date d'effet souhaitée, statut,
  notes), `activite_eo` (description de l'activité **obligatoire** —
  rattachement illimité, chiffre d'affaires ($) = exposition, nb de
  professionnels), `garanties_eo` (limite par sinistre, limite agrégat,
  franchise, **base de garantie** — codes ou libellés FR « Réclamations-
  présentées » / « Occurrences » — prime, 3 avenants en colonnes 0/1 :
  frais de défense, médias et contenu, cyber associé),
  `antecedents_eo` (assureur actuel, **réclamations E&O 5 ans**
  `AAAA-MM-JJ|nature|montant|sinistre` via `parserReclamationsEo`,
  **circonstances** pouvant donner lieu à réclamation, consentements
  crédit et dossier d'assurance).
- **Rattachement** : colonne `Soumission (id)`, ou `Entreprise` (la
  soumission E&O active la plus récente est utilisée — la date d'effet
  permet de départager).
- **Round-trip export→import** : les en-têtes FR des 3 modules d'export
  E&O sont reconnus à l'import (apostrophes courbes tolérées, base en
  libellé FR acceptée) — testé explicitement.
- **Règle d'or** : chaque ligne crée une version via `lib/eo.js` —
  aucun écrasement, aucun DELETE (vérifié statiquement dans les tests).
- Modèles : `/import/modele-eo/:type` (4 fichiers, exemples + valeurs
  autorisées en commentaires).
- Exemple : `scripts/exemple-import-eo.csv` (4 lignes : 1 soumission,
  1 activité, garanties, antécédents — Groupe Conseil Lussier inc.).
- Équivalences : 9 entrées E&O ajoutées à `EQUIV`/`EQUIV_NORM`
  (activité, CA, nb professionnels, base, 3 avenants, réclamations 5 ans,
  circonstances).

Tests : `scripts/test-import-eo.js` (**49 tests**, HTTP) — page + 4 modèles
(+ 404), exemple complet (4 créées, 0 erreur, **4 versions figées**
vérifiées via l'export, base en libellé FR, avenants 1;1;0, circonstances
et nb réclamations calculés), apostrophe courbe, validation (6 cas
d'erreur ligne par ligne), **round-trip export→import**, règle d'or
statique (aucun `DELETE FROM eo_*`), cloisonnement inter-cabinets,
portefeuille courtier (rejet + rattachement), journal d'audit.
Capture : `demo-captures/commercial/67-import-eo.png`.

### E&O (responsabilité professionnelle) — étape 7/10 : proposition pré-remplie (HTML + PDF)

Miroir de l'étape 7/10 cyber : depuis la fiche d'une soumission E&O, le
bouton **« 📄 Proposition »** (dégrisé à cette étape) génère la proposition
d'assurance responsabilité professionnelle pré-remplie, en **page HTML
imprimable** (`GET /eo/:id/proposition`) ou **PDF téléchargeable**
(`GET /eo/:id/proposition.pdf`, pdfkit, non compressé pour la
traçabilité), reflétant l'état courant ou une version figée (`?v=N` —
`eo.obtenirVersion`, règle d'or) :

- **Source unique** : `lib/proposition-eo.js` (`preparerPropositionEo`) —
  proposant, **activités professionnelles** (description, chiffre
  d'affaires, nb de professionnels), garanties (limites, franchise,
  **base en libellé FR « Réclamations-présentées » / « Occurrences »**,
  avenants, prime), antécédents (**réclamations E&O 5 ans** — date,
  nature, montant, réclamée ou non —, **circonstances** pouvant donner
  lieu à réclamation, consentements). La proposition ne modifie JAMAIS
  la soumission : lecture seule.
- **Mention claims-made** (HTML + PDF) : « Base réclamations-présentées :
  la date de déclaration compte — maintenir la continuité d'assurance »
  — affichée quand la base est réclamations-présentées ; le pied de page
  rappelle « proposition conforme à la version figée, vérifiez avant
  envoi à l'assureur ».
- Vue `views/eo/proposition.ejs` : CSS/JS externes `/proposition.css` et
  `/proposition.js` (CSP — aucun `onclick` inline), boutons Imprimer /
  Télécharger PDF / Retour, signatures proposant et courtier.
- Audit `proposition_eo_generee` avec n° de version, sécurité par rôle
  (courtier = portefeuille, cloisonnement par cabinet).

Tests : `scripts/test-proposition-eo-pdf.js` (**39 tests**, HTTP) —
préparation (2 activités, garanties claims-made + 2 avenants, réclamation
+ circonstances), HTML (titre, activités, CA, base en libellé FR,
**mention claims-made**, avenants, prime, réclamation « réclamée »,
circonstances, version + vérification, bouton Imprimer + lien PDF, CSS
externe, aucun JS inline), **version figée `?v=1` (données d'époque :
aucune activité en v1)**, `?v=999` → 404, PDF (content-type, `%PDF`,
activité, avenant, **mention claims-made**, mention soumission, taille),
sécurité (inter-cabinets 404, courtier hors portefeuille 403, sans
login 302), audit avec version, aucune fuite vers l'autre cabinet.
Capture : `demo-captures/commercial/68-proposition-eo.png`.

**Balayage complet : 43 suites, 2340/2340 tests verts, zéro échec**
(2301 de l'étape 6 + 39 nouveaux tests proposition E&O ; l'assertion
« bouton Proposition grisé » de `test-eo-etape2.js` est devenue
« bouton Proposition dégrisé » — 83/83 ; chaque suite sur base fraîche,
une à la fois ; suites modèle SANS serveur, suites HTTP avec
`CHEMIN_BD` identique serveur+script ; `test-phase1.js` exclue —
obsolète).

### E&O (responsabilité professionnelle) — étape 8/10 : commandes texte IA

Miroir de l'étape 8/10 cyber, étendu à l'E&O dans `lib/commandes-ia.js`
(analyseur local à règles, même protocole analyse → confirmation →
exécution, sans envoi auto) :

- **Nouvelles actions** : `ajouter_activite_eo` (« ajoute l'activité conseil
  fiscal avec 180 000 $ de chiffre d'affaires à la soumission E&O 2 » —
  description, **chiffre d'affaires** (ordre direct « chiffre d'affaires de
  500000 » ou inversé « avec 180 000 $ de chiffre d'affaires », millions
  acceptés), **nb de professionnels**), `modifier_garanties_eo` (« mets la
  franchise de la soumission E&O 1 à 10 000 $ » — limite par sinistre,
  agrégat, franchise, **base réclamations-présentées / occurrences**
  (synonymes « claims-made », « occurrences »), prime, avenants frais de
  défense / médias et contenu / cyber associé avec ajout ET retrait,
  **fusion** : les champs non mentionnés sont conservés) et
  `modifier_activite_eo` (« change le chiffre d'affaires de l'activité
  conseil fiscal de la soumission E&O 2 à 200 000 $ » — rattachement par
  description ou par n°).
- **Résolution** : « soumission E&O 1 » vs « soumission cyber 1 » vs
  « soumission RC 1 » vs « soumission biens 1 » vs « soumission 1 » (auto)
  distingués partout (`aller_a` aussi : « montre-moi la soumission E&O 1 »
  → `/eo/1`, « ouvre l'E&O » → `/eo`) ; dans les actions E&O, « à la
  soumission 1 » vise implicitement une soumission E&O ; résolution par nom
  de client avec demande de précision si ambiguë. **Gardes anti-collision
  bidirectionnelles** : les analyseurs auto/biens/RC/cyber ignorent les
  commandes mentionnant « E&O » (« ajoute un lieu à la soumission E&O 1 »
  n'est pas pris par RC, « ajoute la mesure MFA à la soumission E&O 1 »
  n'est pas pris par cyber) et inversement (« retire l'avenant cyber
  associé pour la soumission E&O 1 » est pris par E&O, pas par cyber) ;
  franchise en fin de phrase (« …de la soumission E&O 1 à 10 000 $ » —
  le n° de soumission n'est pas confondu avec le montant).
- **Mode Cohere** : schéma JSON strict étendu aux 3 actions
  (`ACTIONS_COHERE`). **Sécurité** : exigeAuth ; courtier = son portefeuille
  (refus poli) ; modifications via `lib/eo.js` (versionnage, règle d'or) ;
  **confirmation obligatoire** (`ACTIONS_CONFIRMABLES` dans
  `lib/assistant.js`, revérifiée au 2e clic, CSRF) ; audit `commande_ia`.
- Aide de l'assistant : 4 exemples de commandes E&O ajoutés.

Tests : `scripts/test-commandes-eo.js` (**62 tests**, HTTP) — analyseur
(activité complète, CA ordre direct/inversé, nb professionnels, intrinsèque,
autre produit → null, franchise fin de phrase / immédiate, limites, base,
prime, ajout/retrait d'avenants, E&O gagne contre cyber, modifier activité
par description/n°, **anti-collisions ×5**, garanties sans marqueur → null,
aller_a E&O + non-régressions, ACTIONS_COHERE), confirmation requise
(rien exécuté avant le 2e clic), activité créée + version figée, fusion des
garanties (base changée, avenant conservé), retrait d'avenant (= 0), CA
changé en base, ambiguïtés, inter-cabinets sans fuite, portefeuille courtier
(refus + OK), CSRF 403, audit, règle d'or (aucun DELETE FROM eo_).
Capture : `demo-captures/commercial/69-commande-eo.png`.

**Balayage complet : 44 suites, 2402/2402 tests verts, zéro échec**
(2340 de l'étape 7 + 62 nouveaux tests commandes E&O ; chaque suite sur
base fraîche, une à la fois ; suites modèle SANS serveur, suites HTTP avec
`CHEMIN_BD` identique serveur+script ; `test-phase1.js` exclue —
obsolète).

### E&O (responsabilité professionnelle) — étape 9/10 : dictée vocale (voix)

Miroir de l'étape 9/10 cyber, étendu au vocabulaire E&O dans
`public/dictee.js` (`normaliserDictee()`, réutilise les règles
FPQ1/biens/RC/cyber — années, montants en lettres, montants décimaux,
durées) :

- **Références** : « à la soumission E&O un » → « à la soumission E&O 1 »
  (l'analyseur exige des chiffres) ; « l'activité deux » → « l'activité 2 »
  (index d'activité, accepté par `modifier_activite_eo`).
- **Montants de CA** (règles existantes réutilisées) : « avec cent
  quatre-vingt mille dollars de chiffre d'affaires » → « avec 180000 de
  chiffre d'affaires » (ancrage « dollars », comme les biens) ; « un
  virgule deux million » → « 1200000 » (montants décimaux RC) ; « un
  chiffre d'affaires de deux cent cinquante mille dollars » → « 250000 ».
- **Vocabulaire E&O en texte libre** (reconnu tel quel par l'analyseur à
  règles) : « base réclamations présentées », « base occurrences »,
  avenants « frais de défense », « médias et contenu », « cyber associé ».
- **Pipeline voix → confirmation → exécution** vérifié : « ajoute
  l'activité conseil fiscal avec cent quatre-vingt mille dollars de chiffre
  d'affaires à la soumission E&O un » → normalisé → analysé par
  `ajouter_activite_eo` → confirmation → exécution (activité en base avec
  CA 180000, version figée, règle d'or) ; « mets la base occurrences pour
  la soumission E&O un » → confirmation `modifier_garanties_eo`. Bouton 🎤
  (Web Speech API `fr-CA`) sur le chat de l'assistant ; jamais d'envoi
  automatique. **Limite honnête** : la transcription passe par le service
  vocal du navigateur (Google/Apple selon le navigateur) ; une
  transcription 100 % locale (Whisper auto-hébergé) est prévue comme option
  au déploiement VPS.

Tests : `scripts/test-voix.js` — 94 → **116 tests** (11 nouvelles règles
E&O + 11 tests de pipeline E&O, non-régression des règles
FPQ1/biens/RC/cyber).
Capture : `demo-captures/commercial/70-voix-eo.png`.

**Balayage complet : 44 suites, 2424/2424 tests verts, zéro échec**
(2402 de l'étape 8 + 22 nouveaux tests voix E&O ; chaque suite sur base
fraîche, une à la fois ; suites modèle SANS serveur, suites HTTP avec
`CHEMIN_BD` identique serveur+script ; `test-phase1.js` exclue —
obsolète). Règle d'or re-vérifiée : zéro `DELETE FROM eo_` en dur, aucune
route DELETE sur `/eo`, aucun bouton de suppression dans `views/eo/`.


### E&O (responsabilité professionnelle) — étape 10/10 : final (balayage complet)

Balayage final du module E&O (2026-10-19) : toutes les suites exécutées
une par une sur bases fraîches (serveur tué + base supprimée entre chaque ;
suites modèle avec `CHEMIN_BD` seul, sans serveur — lancer un serveur en
parallèle pollue les comptes du seed et fait échouer à tort
`test-eo-etape1.js` et les autres suites modèle, leçon apprise ;
`test-droits-2026-10-09.js`, `test-voix.js`, `test-principes.js` et
`test-dictionnaire.js` avec `CHEMIN_BD` identique sur serveur ET script ;
ne jamais sonder `/connexion` avant une suite (rate-limit 20 logins/15 min) ;
`test-phase1.js` exclue — obsolète).

**Résultat : 2424/2424 tests verts, zéro échec** (44 suites).

| Suite | Tests |
|---|---|
| test-dictionnaire.js (auto + biens + RC + cyber + E&O) | 167 |
| test-voix.js (FPQ1 + biens + RC + cyber + E&O) | 116 |
| test-principes.js (règle d'or) | 112 |
| test-eo-etape2.js (questionnaire E&O) | 83 |
| test-biens-etape2.js (questionnaire biens) | 74 |
| test-cyber-etape2.js (questionnaire cyber) | 71 |
| test-rc-etape2.js (questionnaire RC) | 70 |
| test-nouveaux-modules.js | 65 |
| test-fpq1-etape2.js | 62 |
| test-commandes-eo.js | 62 |
| test-demandes-2026-10-09.js | 57 |
| test-biens-etape1.js (modèle biens) | 57 |
| test-commandes-cyber.js | 57 |
| test-eo-etape3.js (police E&O) | 56 |
| test-cyber-etape3.js (police cyber) | 55 |
| test-exports.js | 55 |
| test-rc-etape3.js (police RC) | 54 |
| test-fpq1-etape1.js (modèle auto) | 53 |
| test-fpq1-etape3.js | 52 |
| test-biens-etape3.js (police biens) | 52 |
| test-import-eo.js | 49 |
| test-rc-etape1.js (modèle RC) | 48 |
| test-commandes-ia.js (auto) | 48 |
| test-commandes-rc.js | 48 |
| test-droits-2026-10-09.js | 48 |
| test-ajustements.js | 48 |
| test-cyber-etape1.js | 47 |
| test-eo-etape1.js (modèle E&O) | 47 |
| test-assureurs.js | 47 |
| test-commandes-biens.js | 47 |
| test-exports-eo.js | 45 |
| test-exports-do.js | 45 |
| test-exports-biens.js | 44 |
| test-exports-cyber.js | 43 |
| test-exports-rc.js | 41 |
| test-proposition-eo-pdf.js | 39 |
| test-proposition-do-pdf.js | 39 |
| test-courriels.js | 37 |
| test-import-biens.js | 36 |
| test-import-cyber.js | 36 |
| test-proposition-cyber-pdf.js | 34 |
| test-import-auto.js | 33 |
| test-import-rc.js | 33 |
| test-proposition-biens-pdf.js | 33 |
| test-proposition-rc-pdf.js | 32 |
| test-proposition-pdf.js | 31 |

Règle d'or re-vérifiée : zéro `DELETE FROM eo_*` en dur dans `lib/` et
`routes/`, aucune route DELETE sur `/eo`, aucun bouton « supprimer » dans
`views/eo/`, archivage doux partout, chaque mutation E&O crée une version
figée.

Captures 62-70 revues (lisibles et conformes) :
`62-eo-liste.png` (liste des soumissions), `63-eo-fiche.png` (fiche avec
activités, garanties claims-made, antécédents), `64-police-eo.png`
(bloc « Données E&O » sur la fiche police), `65-dictionnaire-eo.png`
(dictionnaire enrichi), `66-exports-eo.png` (3 modules d'export),
`67-import-eo.png` (4 types d'import), `68-proposition-eo.png`
(proposition HTML), `69-commande-eo.png` (commande IA texte),
`70-voix-eo.png` (dictée vocale → confirmation).


### D&O (responsabilité des administrateurs et dirigeants) — étape 1/10 : couche données (sans interface)

Même recette que le FPQ1, les biens, la RC, le cyber et l'E&O, appliquée à la
responsabilité des administrateurs et dirigeants (D&O).
Tables `do_soumissions`, `do_dirigeants`, `do_garanties`, `do_antecedents`
(+ `do_soumission_versions`) : `cabinet_id` et `archive` partout, dirigeants en
**nombre illimité**. Coexiste avec le module commercial existant (ligne `do`
de `polices`), sans le modifier.

- **Dirigeant** (illimité) : nom, fonction/titre (président, vice-président,
  trésorier, secrétaire, administrateur, directeur général…), années
  d'expérience, **antécédents personnels** (réclamations ou poursuites
  personnelles antérieures — question clé de tarification).
- **Garanties** (une fiche par soumission) : limite par sinistre, limite
  agrégat annuel, franchise, base CHECK `reclamations_presentees` /
  `occurrences` (la forme réclamations-présentées / claims-made est quasi
  systématique en D&O), avenants JSON (`frais_defense` — code DO-FRAIS du
  catalogue commercial —, `pratiques_emploi`, `fidelite_crime`), prime.
- **Antécédents** (une fiche par soumission) : assureur actuel, **réclamations
  D&O 5 ans** en JSON (date, nature, montant, réclamé ou non), **poursuites
  ou actions en justice en cours ou envisagées** (question piège du
  questionnaire D&O en base réclamations-présentées : une poursuite connue
  non déclarée = refus de couverture), consentements.

**Versionnage systématique** : v1 à la création, chaque modification applique le
changement puis fige le nouvel état en v(n+1) ; historique lecture seule.
Accès via `lib/do.js` (miroir de `lib/eo.js`, audit `do_%`).
Tables documentées dans `lib/dictionnaire-champs.json` (domaine « do » —
dictionnaire total : 60 tables, 672 colonnes).
Seed : 1 soumission D&O démo (Forges Bélanger inc., manufacture à Longueuil :
3 dirigeants, garanties 2 M$/2 M$ base réclamations-présentées,
1 poursuite 2022 de 120 000 $ réclamée, aucune poursuite en cours déclarée).
Tests : `scripts/test-do-etape1.js` (47 tests, sans serveur).
Balayage complet après l'étape (suites une à la fois, bases fraîches,
`test-phase1.js` exclue — obsolète) : **2471/2471 tests verts, zéro échec**
(2424 du final E&O + 47 D&O).

### D&O (responsabilité des administrateurs et dirigeants) — étape 2/10 : questionnaire de soumission (interface)

Nouvel onglet **« D&O »** (`/do`), après « E&O », miroir du questionnaire E&O :
liste des soumissions (client, statut, effet souhaité, nb dirigeants, filtre
par statut, « Voir les archivées »), création (entreprise cliente, date
d'effet souhaitée, notes), puis **fiche soumission** en 4 sections :

- **Dirigeants (illimités)** : formulaire d'ajout (nom *, fonction/titre,
  années d'expérience, antécédents personnels), tableau avec
  modifier/archiver par ligne, restaurables depuis « Archivés » —
  l'exposition D&O est personnelle : le nom + la fonction de chaque
  dirigeant et ses antécédents personnels sont des questions clés de
  tarification.
- **Garanties** : limite par sinistre, limite agrégat annuel, franchise,
  prime, **base** en boutons radio (`Réclamations-présentées (claims-made)`
  / `Occurrences (survenance)` — libellés du dictionnaire), avenants en
  cases : `frais_defense` (Frais de défense), `pratiques_emploi`
  (Pratiques d'emploi), `fidelite_crime` (Fidélité / crime).
- **Antécédents d'assurance** : assureur actuel, n° police actuelle,
  expiration, années d'assurance continue, réclamations D&O 5 ans en
  lignes dynamiques (date, nature, montant $, réclamé oui/non),
  **poursuites ou actions en justice en cours ou envisagées** (la
  question piège du D&O en base réclamations-présentées), consentements
  (dossier de crédit, dossier d'assurance).
- **Historique des versions** : lecture seule, une version figée à chaque
  mutation (création, dirigeant, garanties, antécédents, statut, archivage).

Pas de conversion (étape 3/10), pas de proposition (étape 7/10 — bouton
grisé « 📄 Proposition (bientôt) »). Sécurité : `exigeAuth`,
`exigeMotDePasseChange`, cloisonnement `cabinet_id` partout, portefeuille
courtier (`clausePortefeuille` / `clientHorsPortefeuille`), CSRF, audit
`do_%`. Règle d'or : archivage doux partout, aucun bouton de suppression.

Routes `routes/do.js` (miroir de `routes/eo.js`), vues `views/do/`
(`liste.ejs`, `formulaire.ejs`, `fiche.ejs`, `version.ejs`).
Tests : `scripts/test-do-etape2.js` (82 tests) — création (400 sans
client / client invalide / date invalide, 302 → v1), 2 dirigeants
(nom requis, expérience négative → 400), modification (→ v4),
archivage/désarchivage, garanties claims-made + upsert sans doublon +
base invalide → 400, antécédents (réclamation + poursuites +
consentement), statuts, versions à chaque mutation, 404, archivage,
portefeuille courtier (403), inter-cabinets (404), anonyme (302),
sans CSRF (403), audit `do_%`, zéro `DELETE FROM do_` en dur (vérifié
statiquement).
Captures vérifiées visuellement : `71-do-liste.png` (liste, 3 soumissions
dont Forges Bélanger inc.) et `72-do-fiche.png` (fiche : dirigeants,
garanties base + avenants, antécédents avec poursuites, versions).
Balayage complet après l'étape : **2553/2553 tests verts, 46 suites,
zéro échec** (2471 de l'étape 1 + 82 du nouveau test-do-etape2 ;
`test-phase1.js` exclue — obsolète).

### D&O (responsabilité des administrateurs et dirigeants) — étape 3/10 : fiche police (gestion)

Migration `lib/bd.js` : ajout de `polices.do_soumission_id` +
`polices.do_soumission_version` (UNIQUE, reconstruction de table préservant
les colonnes auto/biens/RC/cyber/E&O — mêmes conventions que les migrations
précédentes), miroir exact du pattern E&O :

- `POST /do/:id/convertir` : crée la police (**ligne `do`**, déjà dans le
  CHECK), fige la version de la soumission, crée la v1 de la police,
  statut → `convertie_police`, audit `police_creee` ; bouton « Convertir en
  police » câblé sur la fiche (numéro, assureur, dates, franchise).
- `POST /do/:id/lier-police` : liaison à une police D&O existante de la même
  entreprise (refus : autre ligne, déjà liée, autre entreprise, hors
  portefeuille).
- `noterAvenantPolice()` branchée aux **8 points de mutation** de
  `routes/do.js` (ajout / modification / archivage / désarchivage de
  dirigeant, garanties, antécédents, changement de statut, archivage de
  soumission) : chaque mutation en cours de terme crée une version de la
  police avec note (règle d'or : jamais de modification silencieuse).
- Bloc **« 🛡️ Données D&O »** sur `/echeances/police/:id` : dirigeants
  figés (nom, fonction, expérience, antécédents personnels), garanties
  (limites, franchise, **base réclamations-présentées / occurrences**,
  avenants, prime), antécédents (réclamations D&O 5 ans, **poursuites ou
  actions en justice en cours ou envisagées**) + lien « voir le snapshot ».
- Dictionnaire : 2 colonnes documentées (vérificateur vert : **60 tables,
  674 colonnes**).

Tests : `scripts/test-do-etape3.js` (56 tests, HTTP — conversion, police
liée + version figée, bloc Données D&O, avenants v2/v3/v4, double
conversion 400, liaison + refus non-D&O/déjà-liée, inter-cabinets 404,
portefeuille courtier 403, CSRF 403, audit, zéro `DELETE FROM do_`).
Capture vérifiée visuellement : `73-police-do.png` (fiche DO-001, Données
D&O, historique v1-v4).
Balayage complet après l'étape (avec correction de l'assertion obsolète de
test-do-etape2 — le bouton de conversion est maintenant attendu) :
**2610/2610 tests verts, 48 suites, zéro échec** (`test-phase1.js` exclue —
obsolète).

### D&O (responsabilité des administrateurs et dirigeants) — étape 4/10 : dictionnaire IA enrichi

Enrichissement du domaine « do » dans `lib/dictionnaire-champs.json` avec
des descriptions métier utiles à la tarification D&O (miroir de l'étape 4/10
E&O — 11 descriptions enrichies, domaine « do » uniquement, round-trip JSON
fidèle, vérificateur vert : **60 tables, 674 colonnes**) :

- **Dirigeants = exposition personnelle** : chaque dirigeant ajouté élargit
  l'exposition ; la composition du groupe compte (dirigeants internes vs
  administrateurs indépendants) ; la fonction détermine l'exposition (un
  président ou directeur général engage la société, bien plus qu'un
  administrateur indépendant qui ne fait que surveiller) ; les antécédents
  personnels de poursuites font grimper la prime — la question la plus
  sensible du questionnaire (même les incidents non réclamés comptent).
- **Base réclamations-présentées (claims-made) vs occurrences** : la forme
  quasi systématique en D&O — la date de déclaration compte ; la continuité
  d'assurance et la **date de rétroactivité** sont critiques (une
  interruption peut faire perdre la rétroactivité et laisser les actes
  antérieurs des dirigeants sans couverture) ; occurrences plus rare et
  plus cher.
- **Question piège des poursuites ou actions en justice en cours ou
  envisagées** : en base claims-made, une poursuite connue non déclarée =
  refus de couverture pur et simple ; à l'inverse, déclarer une circonstance
  connue verrouille la couverture future pour cette affaire.
- **Les 3 avenants détaillés** : frais de défense (DO-FRAIS — souvent en sus
  des limites, sinon ils érodent la limite), pratiques d'emploi
  (congédiement abusif, harcèlement, discrimination), fidélité/crime
  (détournements, fraude ou vol par des employés).
- **Agrégat** : vérifier si les frais de défense sont compris dans l'agrégat
  ou en sus ; réclamations 5 ans = indicateur de sinistralité principal ;
  limites usuelles de 1 M$ à 5 M$.
- Valeurs CHECK documentées (`base` : reclamations_presentees,
  occurrences ; statuts ; clés des 3 avenants), colonnes figées marquées
  `figee: true`, unicités (UNIQUE) documentées, `do_soumission_versions`
  ajouté à `regle_or` et déjà présent dans `lib/contexte-ia.js`.

Tests : `scripts/test-dictionnaire.js` 167 → **207/207 verts** (40 nouveaux
tests D&O : domaine, versionnage, valeurs CHECK, 20 tests de descriptions
métier claims-made/poursuites/dirigeants, marqueur `figee`, règle d'or,
3 tests contexte IA, 4 tests page admin). Capture vérifiée visuellement :
`74-dictionnaire-do.png` (section « Responsabilité des administrateurs et
dirigeants (D&O) », badge « versionnée », valeurs CHECK documentées).

### D&O (responsabilité des administrateurs et dirigeants) — étape 5/10 : exports CSV/JSON

Miroir de l'étape 5/10 E&O : **3 nouveaux modules** dans `routes/exports.js`
→ **27 modules au total** (11 FPQ1 + 4 biens + 3 RC + 3 cyber + 3 E&O + 3 D&O).

- **`do_dirigeants`** : une ligne par dirigeant (soumission, entreprise,
  nom du dirigeant, **fonction / titre**, **années d'expérience**,
  **antécédents personnels**, archivé).
- **`do_soumissions`** : une ligne par soumission (id, entreprise, statut,
  date d'effet, version courante, nb dirigeants, nb versions, limite par
  sinistre, limite agrégat, franchise, **base de garantie en libellé FR**
  — « Réclamations-présentées » / « Occurrences » — prime, **3 avenants en
  colonnes 0/1** — frais de défense, pratiques d'emploi, fidélité / crime —,
  assureur actuel, **nb de réclamations 5 ans** (calculé du JSON),
  **poursuites déclarées** 0/1, consentements 0/1 — dossier de crédit,
  dossier d'assurance —, archivé).
- **`do_versions`** : une ligne par version figée (soumission, version,
  statut, auteur, date, snapshot JSON parsé `{dirigeants, garanties,
  antecedents}`).

Conventions des autres modules : CSV séparateur `;` + BOM, en-têtes en
français du dictionnaire, périmètre par rôle (courtier = son portefeuille
uniquement), archivés exclus par défaut (case à cocher), aucun secret,
journal d'audit `export_*`. Les 3 modules apparaissent sur la page
**Exports** comme les modules E&O. Comptes des modules 24→27 mis à jour
dans `scripts/test-exports-biens.js`, `scripts/test-exports-rc.js`,
`scripts/test-exports-cyber.js` et `scripts/test-exports-eo.js`.
Tests : `scripts/test-exports-do.js` (**45 tests**, HTTP) — données créées
via les routes (`/do`), chaque module en CSV (BOM, `;`, en-têtes FR, base
en libellé pas en code, colonnes avenants 0/1, « Nb de réclamations 5 ans »,
« Poursuites déclarées ») et JSON (structure, garanties imbriquées,
réclamations, poursuites, consentements, snapshot parsé), archivés
exclus/inclus, périmètre courtier, aucun secret, journal d'audit, 400
module inconnu, 403 sans CSRF. Capture : `demo-captures/commercial/75-exports-do.png`.

### D&O (responsabilité des administrateurs et dirigeants) — étape 6/10 : import CSV en lot

Miroir de l'étape 6/10 E&O : **4 nouveaux types** dans `routes/import.js`
(en-têtes en français, miroir des exports D&O) :

- **`soumission_do`** : création d'une soumission (entreprise par « Entreprise »
  ou « Courriel entreprise », date d'effet souhaitée AAAA-MM-JJ, statut
  brouillon/soumise/convertie_police, notes).
- **`dirigeant_do`** : ajout d'un dirigeant (**illimités**) — rattachement par
  « Soumission (id) » ou « Entreprise » (la soumission la plus récente) —
  **nom obligatoire**, fonction / titre, **années d'expérience** (entier 0-80),
  antécédents personnels.
- **`garanties_do`** : fiche garanties par soumission (limite par sinistre,
  limite agrégat, franchise ≥ 0, **base de garantie** — codes
  `reclamations_presentees`/`occurrences` ou libellés FR des exports
  « Réclamations-présentées »/« Occurrences » —, prime, **3 avenants 0/1** —
  frais de défense, pratiques d'emploi, fidélité / crime).
- **`antecedents_do`** : fiche antécédents (assureur actuel, police actuelle,
  expiration, années continues, **réclamations D&O 5 ans en lignes
  `AAAA-MM-JJ|nature|montant|sinistre`** séparées par « ; » — 4ᵉ champ
  `|oui` optionnel si le sinistre a été réclamé — via le parseur miroir de
  `parserReclamationsEo`, **poursuites en cours ou envisagées**, consentements
  crédit/dossier d'assurance).

Validation stricte (nom requis, base validée, nombres ≥ 0, dates ISO,
montants des réclamations), chaque ligne crée une version via `lib/do.js`
(règle d'or : aucun `DELETE FROM do_`), erreurs ligne par ligne avec résumé.
Modèles téléchargeables `/import/modele-do/:type`, exemple
`scripts/exemple-import-do.csv` (Forges Bélanger inc.), 4 types visibles sur
la page **Import**. Les en-têtes FR des exports sont reconnus en miroir
(round-trip export→import, apostrophes courbes tolérées — bug racine
corrigé à l'étape 6 RC).

Tests : `scripts/test-import-do.js` (HTTP, **50 tests**) — page + section D&O
+ 4 modèles (+404), exemple (4 créées, 0 erreur), vérification miroir via
exports (base en libellé FR, avenants 1;0;0, **4 versions**, poursuites
déclarées = 1, nb réclamations 5 ans = 1), en-tête avec apostrophe courbe
reconnu, fichier d'erreurs (nom requis, expérience > 80, base invalide,
limite négative, date invalide, soumission introuvable, montant réclamation
invalide), **round-trip export→import** (en-têtes des exports avec points
finaux reconnus), règle d'or statique, cloisonnement inter-cabinets,
portefeuille courtier (hors portefeuille rejeté, son entreprise/soumission/
dirigeant OK), journal d'audit.
Capture : `demo-captures/commercial/76-import-do.png`.

### D&O (responsabilité des administrateurs et dirigeants) — étape 7/10 : proposition pré-remplie (HTML + PDF)

Miroir de l'étape 7/10 E&O : depuis la fiche d'une soumission D&O, le
bouton **« 📄 Proposition »** (dégrisé à cette étape) génère la proposition
d'assurance responsabilité des administrateurs et dirigeants pré-remplie,
en **page HTML imprimable** (`GET /do/:id/proposition`) ou **PDF
téléchargeable** (`GET /do/:id/proposition.pdf`, pdfkit, non compressé pour
la traçabilité), reflétant l'état courant ou une version figée (`?v=N` —
`dosoum.obtenirVersion`, règle d'or) :

- **Source unique** : `lib/proposition-do.js` (`preparerPropositionDo`) —
  proposant, **dirigeants** (nom, fonction / titre, années d'expérience,
  antécédents personnels), garanties (limites, franchise, **base en
  libellé FR « Réclamations-présentées » / « Occurrences »**, avenants,
  prime), antécédents (**réclamations D&O 5 ans** — date, nature, montant,
  réclamée ou non —, **poursuites ou actions en justice en cours ou
  envisagées**, consentements). La proposition ne modifie JAMAIS la
  soumission : lecture seule.
- **Mention claims-made** (HTML + PDF) : « Base réclamations-présentées :
  la date de déclaration compte — maintenir la continuité d'assurance »
  — affichée quand la base est réclamations-présentées ; le pied de page
  rappelle « proposition conforme à la version figée, vérifiez avant
  envoi à l'assureur ».
- Vue `views/do/proposition.ejs` : CSS/JS externes `/proposition.css` et
  `/proposition.js` (CSP — aucun `onclick` inline), boutons Imprimer /
  Télécharger PDF / Retour, signatures proposant et courtier.
- Audit `proposition_do_generee` avec n° de version, sécurité par rôle
  (courtier = portefeuille, cloisonnement par cabinet).

Tests : `scripts/test-proposition-do-pdf.js` (**39 tests**, HTTP) —
préparation (2 dirigeants, garanties claims-made + 2 avenants, réclamation
+ poursuites), HTML (titre, dirigeants, fonction, expérience, base en
libellé FR, **mention claims-made**, avenants, prime, réclamation
« réclamée », poursuites, version + vérification, bouton Imprimer + lien
PDF, CSS externe, aucun JS inline), **version figée `?v=1` (données
d'époque : aucun dirigeant en v1)**, `?v=999` → 404, PDF (content-type,
`%PDF`, dirigeant, avenant, **mention claims-made**, mention soumission,
taille), sécurité (inter-cabinets 404, courtier hors portefeuille 403,
sans login 302), audit avec version, aucune fuite vers l'autre cabinet.
Capture : `demo-captures/commercial/77-proposition-do.png`.

**Balayage complet : 50 suites, 2784/2784 tests verts, zéro échec**
(2745 de l'étape 6 + 39 nouveaux tests proposition D&O ; l'assertion
« bouton Proposition (bientôt) » de `test-do-etape2.js` est devenue
« bouton Proposition actif » — 83/83 ; chaque suite sur base fraîche,
une à la fois ; suites modèle SANS serveur, suites HTTP avec
`CHEMIN_BD` identique serveur+script ; `test-phase1.js` exclue —
obsolète).

### D&O (responsabilité des administrateurs et dirigeants) — étape 8/10 : commandes texte IA

Miroir de l'étape 8/10 E&O, étendu au D&O dans `lib/commandes-ia.js`
(analyseur local à règles, même protocole analyse → confirmation →
exécution, sans envoi auto) :

- **Nouvelles actions** : `ajouter_dirigeant_do` (« ajoute le dirigeant
  Marc Bouchard comme trésorier à la soumission D&O 2 » — nom obligatoire,
  **fonction / titre** (« comme trésorier », « fonction
  présidente-directrice générale »), **années d'expérience** (« 15 ans
  d'expérience », validées 0–80), **antécédents personnels** — distinct de
  « conducteur » en FPQ1 : aucune collision), `modifier_garanties_do`
  (« mets la franchise de la soumission D&O 1 à 10 000 $ » — limite par
  sinistre, agrégat, franchise, **base réclamations-présentées /
  occurrences**, prime, avenants frais de défense / pratiques d'emploi /
  fidélité-crime avec ajout ET retrait, **fusion** : les champs non
  mentionnés sont conservés) et `modifier_dirigeant_do` (« change la
  fonction du dirigeant Marie Tremblay de la soumission D&O 2 à trésorier »
  — nom, fonction, années d'expérience, antécédents personnels —
  rattachement par nom ou par n°).
- **Confirmation en avant/après** : « franchise : — → 10 000 $ »,
  « avenant pratiques d'emploi : absent → ajouté », « base :
  réclamations-présentées → occurrences » — le courtier voit ce qui change
  avant de confirmer. **Antécédents personnels sensibles** : la commande
  peut les écrire, mais la valeur n'est **jamais réaffichée** dans les
  résumés ni les messages (ni à l'écran, ni dans l'historique).
- **Distinction des 6 produits** : « soumission D&O 1 » vs « soumission
  E&O 1 » vs « soumission cyber 1 » vs « soumission RC 1 » vs
  « soumission biens 1 » vs « soumission 1 » (auto) distingués partout
  (`aller_a` aussi : « montre-moi la soumission D&O 1 » → `/do/1`,
  « ouvre le D&O » → `/do`) ; dans les actions D&O, « à la soumission 1 »
  vise implicitement une soumission D&O ; résolution par nom de client
  avec demande de précision si ambiguë. **Gardes anti-collision
  bidirectionnelles** : les analyseurs auto/biens/RC/cyber/E&O ignorent les
  commandes mentionnant « D&O » (« ajoute la mesure MFA à la soumission
  D&O 1 » n'est pas pris par cyber, « ajoute un bâtiment à la soumission
  D&O 1 » n'est pas pris par biens, « ajoute une activité à la soumission
  D&O 1 » n'est pas pris par E&O) et inversement (« mets la franchise à
  10 000 $ pour la soumission E&O 1 » est pris par E&O, pas par D&O ;
  « retire l'avenant rançongiciel pour la soumission cyber 1 » reste
  cyber) ; sans marqueur de produit, aucune action D&O ne se déclenche.
- **Mode Cohere** : schéma JSON strict étendu aux 3 actions
  (`ACTIONS_COHERE`). **Sécurité** : exigeAuth ; courtier = son portefeuille
  (refus poli) ; modifications via `lib/do.js` (versionnage, règle d'or) ;
  **confirmation obligatoire** (`ACTIONS_CONFIRMABLES` dans
  `lib/assistant.js`, revérifiée au 2e clic, CSRF) ; audit `commande_ia` ;
  cloisonnement par cabinet (aucune fuite, y compris sur les antécédents
  personnels).
- Aide de l'assistant : 4 exemples de commandes D&O ajoutés.

Tests : `scripts/test-commandes-do.js` (**70 tests**, HTTP) — analyseur
(dirigeant complet, fonction + années + antécédents, synonyme « rajoute »,
intrinsèque, autre produit → null, **dirigeant ≠ conducteur**, franchise
fin de phrase / immédiate, limites, base, prime, ajout/retrait d'avenants,
modifier dirigeant par nom/n° + années + antécédents, **anti-collisions
×11** (E&O, cyber, RC, auto, biens dans les deux sens, sans marqueur →
null), aller_a D&O + non-régressions, ACTIONS_COHERE), confirmation requise
(rien exécuté avant le 2e clic), dirigeant créé + version figée, fusion des
garanties (base changée, avenant conservé), retrait d'avenant (= 0),
fonction changée en base, ambiguïtés, inter-cabinets sans fuite,
portefeuille courtier (refus + OK), CSRF 403, audit, règle d'or (aucun
DELETE FROM do_), **antécédents personnels écrits mais jamais réaffichés
ni fuités**.
Capture : `demo-captures/commercial/78-commandes-ia-do.png`.

**Balayage complet : 51 suites, 2854/2854 tests verts, zéro échec**
(2784 de l'étape 7 + 70 nouveaux tests commandes D&O ; chaque suite sur
base fraîche, une à la fois ; suites modèle SANS serveur, suites HTTP avec
`CHEMIN_BD` identique serveur+script ; `test-phase1.js` exclue —
obsolète).

### D&O (responsabilité des administrateurs et dirigeants) — étape 9/10 : dictée vocale (voix)

Miroir de l'étape 9/10 E&O, étendu au vocabulaire D&O dans
`public/dictee.js` (`normaliserDictee()`, réutilise les règles
FPQ1/biens/RC/cyber/E&O — années, montants en lettres, montants décimaux,
durées) :

- **Références** : « à la soumission D&O un » → « à la soumission D&O 1 »
  (l'analyseur exige des chiffres) ; aussi dicté « d o », en deux mots —
  « à la soumission d o un » → « à la soumission d o 1 » (la règle des codes
  épelés ne doit pas avaler le « o » du produit : « O1 » ne se produit pas) ;
  « le dirigeant deux » → « le dirigeant 2 » (index de dirigeant, accepté
  par `modifier_dirigeant_do`) — **distinct de « conducteur » FPQ1** :
  « ajoute un conducteur Marie Tremblay à la soumission 1 » passe intact.
- **Années d'expérience** : « quinze ans d'expérience » → « 15 ans
  d'expérience » (l'unité « ans d'expérience » est conservée, l'analyseur
  exige un chiffre suivi de « ans d'expérience »).
- **Élision** : la dictée sépare parfois le « d' » de son mot alors que
  l'analyseur exige l'apostrophe — « pratiques d emploi » → « pratiques
  d'emploi », « ans d expérience » → « ans d'expérience ».
- **Montants D&O** (règles existantes réutilisées) : « dix mille dollars »
  → 10000 (ancrage « dollars », comme les biens) ; « deux millions » →
  2000000 ; « un virgule deux million » → 1200000 (montants décimaux RC).
- **Vocabulaire D&O en texte libre** (reconnu tel quel par l'analyseur à
  règles) : fonctions « président-directeur général », « trésorier »,
  avenants « frais de défense », « pratiques d'emploi », « fidélité
  crime ».
- **Pipeline voix → confirmation → exécution** vérifié : « ajoute le
  dirigeant Marc Bouchard comme trésorier à la soumission D&O un » →
  normalisé → analysé par `ajouter_dirigeant_do` → confirmation →
  exécution (dirigeant en base avec fonction trésorier, version figée,
  règle d'or) ; « mets la franchise à dix mille dollars pour la soumission
  D&O un » → confirmation `modifier_garanties_do`. Bouton 🎤 (Web Speech
  API `fr-CA`) sur le chat de l'assistant ; jamais d'envoi automatique.
  **Limite honnête** : la transcription passe par le service vocal du
  navigateur (Google/Apple selon le navigateur) ; une transcription 100 %
  locale (Whisper auto-hébergé) est prévue comme option au déploiement
  VPS.

Tests : `scripts/test-voix.js` — 116 → **141 tests** (14 nouvelles règles
D&O + 11 tests de pipeline D&O, non-régression des règles
FPQ1/biens/RC/cyber/E&O).
Capture : `demo-captures/commercial/79-voix-do.png`.

**Balayage complet : 51 suites, 2879/2879 tests verts, zéro échec**
(2854 de l'étape 8 + 25 nouveaux tests voix D&O ; chaque suite sur base
fraîche, une à la fois ; suites modèle SANS serveur, suites HTTP avec
`CHEMIN_BD` identique serveur+script ; `test-phase1.js` exclue —
obsolète). Règle d'or re-vérifiée : zéro `DELETE FROM do_` en dur, aucune
route DELETE sur `/do`, aucun bouton de suppression dans `views/do/`.

### D&O (responsabilité des administrateurs et dirigeants) — étape 10/10 : final (balayage complet)

Balayage final du module D&O (2026-10-20) : toutes les suites exécutées
une par une sur bases fraîches (serveur tué + base supprimée entre chaque ;
suites modèle avec `CHEMIN_BD` seul, sans serveur ; suites HTTP avec
`CHEMIN_BD` identique sur serveur ET script ; ne jamais sonder `/connexion`
avant une suite — rate-limit 20 logins/15 min ; `test-phase1.js` exclue —
obsolète ; logs de balayage sous `~/workspace/`, pas `/tmp` — un redémarrage
de service vide `/tmp` en cours de route).

**Résultat : 2879/2879 tests verts, zéro échec** (51 suites).

Balayage après PE étape 3/10 (2026-10-20) : **3071/3071 tests verts,
zéro échec** (53 suites — +47 test-pe-etape1, +89 test-pe-etape2,
+56 test-pe-etape3). Suites `test-dictionnaire` (207) et
`test-import-biens` (36) relancées proprement après corrections
(dictionnaire enrichi du domaine « pe » : 65 tables, 729 colonnes).

Balayage après PE étape 4/10 (2026-10-20) : **3111/3111 tests verts,
zéro échec** (54 suites — test-dictionnaire 207 → 247, +40 tests PE).
Preuve : `~/workspace/balayage-pe4.log`.

| Suite | Tests |
|---|---|
| test-dictionnaire.js (auto + biens + RC + cyber + E&O + D&O + PE) | 247 |
| test-voix.js (FPQ1 + biens + RC + cyber + E&O + D&O) | 141 |
| test-principes.js (règle d'or) | 112 |
| test-do-etape2.js (questionnaire D&O) | 83 |
| test-eo-etape2.js (questionnaire E&O) | 83 |
| test-biens-etape2.js (questionnaire biens) | 74 |
| test-cyber-etape2.js (questionnaire cyber) | 71 |
| test-commandes-do.js (commandes IA D&O) | 70 |
| test-rc-etape2.js (questionnaire RC) | 70 |
| test-commandes-pe.js (commandes IA perte d'exploitation) | 67 |
| test-nouveaux-modules.js | 65 |
| test-commandes-eo.js | 62 |
| test-fpq1-etape2.js | 62 |
| test-demandes-2026-10-09.js | 57 |
| test-commandes-cyber.js | 57 |
| test-biens-etape1.js (modèle biens) | 57 |
| test-eo-etape3.js (police E&O) | 56 |
| test-do-etape3.js (police D&O) | 56 |
| test-cyber-etape3.js (police cyber) | 55 |
| test-exports.js | 55 |
| test-rc-etape3.js (police RC) | 54 |
| test-fpq1-etape1.js (modèle auto) | 53 |
| test-fpq1-etape3.js | 52 |
| test-biens-etape3.js (police biens) | 52 |
| test-import-do.js | 50 |
| test-import-eo.js | 49 |
| test-rc-etape1.js (modèle RC) | 48 |
| test-commandes-ia.js (auto) | 48 |
| test-commandes-rc.js | 48 |
| test-ajustements.js | 48 |
| test-droits-2026-10-09.js | 48 |
| test-cyber-etape1.js | 47 |
| test-eo-etape1.js (modèle E&O) | 47 |
| test-do-etape1.js (modèle D&O) | 47 |
| test-pe-etape1.js (modèle PE) | 47 |
| test-pe-etape2.js (questionnaire PE) | 89 |
| test-pe-etape3.js (fiche police PE) | 56 |
| test-exports-pe.js (exports PE) | 46 |
| test-import-pe.js (import PE) | 54 |
| test-proposition-pe-pdf.js (proposition PE HTML + PDF) | 40 |
| test-commandes-biens.js | 47 |
| test-assureurs.js | 47 |
| test-exports-eo.js | 45 |
| test-exports-do.js | 45 |
| test-exports-biens.js | 44 |
| test-exports-cyber.js | 43 |
| test-exports-rc.js | 41 |
| test-proposition-eo-pdf.js | 39 |
| test-proposition-do-pdf.js | 39 |
| test-courriels.js | 37 |
| test-import-biens.js | 36 |
| test-import-cyber.js | 36 |
| test-proposition-cyber-pdf.js | 34 |
| test-proposition-biens-pdf.js | 33 |
| test-import-auto.js | 33 |
| test-import-rc.js | 33 |
| test-proposition-rc-pdf.js | 32 |
| test-proposition-pdf.js | 31 |

Règle d'or re-vérifiée : zéro `DELETE FROM do_*` en dur dans `lib/`,
`routes/` et `public/` (les occurrences dans `scripts/` sont les
vérifications statiques elles-mêmes), aucune route DELETE sur `/do`,
aucun bouton « supprimer » dans `views/do/`, archivage doux partout,
chaque mutation D&O crée une version figée.

Captures 71-79 revues (lisibles et conformes) :
`71-do-liste.png` (liste des soumissions), `72-do-fiche.png` (fiche avec
dirigeants, garanties claims-made, antécédents — « Proposition (bientôt) »
car prise à l'étape 2), `73-police-do.png` (bloc « Données D&O » sur la
fiche police), `74-dictionnaire-do.png` (dictionnaire enrichi),
`75-exports-do.png` (3 modules d'export), `76-import-do.png`
(4 types d'import), `77-proposition-do.png` (proposition HTML),
`78-commandes-ia-do.png` (commande IA texte → confirmation),
`79-voix-do.png` (dictée vocale → texte normalisé prêt à envoyer).

ZIP final : `~/workspace/your_files/courtier-do-final.zip` (12,3 Mo,
334 fichiers, préfixe `courtier-app/`, captures incluses, sans
`courtier.db*`/`.env`/`node_modules`/`.git`).

### RC (responsabilité civile) — étape 2/10 : questionnaire de soumission (interface)

Nouvel onglet **« RC »** (`/rc`), après « Biens », miroir du questionnaire
biens : liste des soumissions (filtre par statut, « Voir les archivées »),
création (entreprise cliente, date d’effet souhaitée, notes), puis **fiche
soumission** en sections :

- **Lieux d’exploitation (illimités)** : formulaire d’ajout (adresse, ville,
  code postal, type d’activité, code de classification, description des
  activités, chiffre d’affaires, masse salariale, nombre d’employés,
  superficie pi², sous-traitants aucun/assurés/non assurés) + liste avec
  **modifier** et archiver/désarchiver.
- **Garanties par lieu d’exploitation** : limite par sinistre (chaque
  occurrence), limite agrégat annuel, franchise, formule (locaux et
  opérations / produits et opérations complétées / globale), avenants en
  cases à cocher (pollution, parapluie), prime.
- **Antécédents** : assureur actuel, sinistres 5 ans (lignes dynamiques :
  date, type, montant), consentements (dossier de crédit, dossier
  d’assurance).
- **Historique des versions** en lecture seule (`/rc/:id/versions/:v`).

La conversion en police arrivera à l’étape 3/10 (la table `polices` n’a pas
encore de colonne `rc_soumission_id`) ; l’emplacement du bouton « 📄
Proposition » est réservé sur la fiche pour l’étape 7/10.
Tests : `scripts/test-rc-etape2.js` (70 tests, HTTP).

### RC (responsabilité civile / CGL) — étape 3/10 : fiche police (gestion)

Miroir de l’étape 3/10 biens, appliqué à la RC commerciale :

- **`polices.rc_soumission_id` + `polices.rc_soumission_version`** (UNIQUE,
  migration avec reconstruction de table — mêmes conventions que
  l’auto et les biens). La ligne utilisée est **`cgl`** (« Responsabilité
  civile (CGL) »), déjà présente dans le CHECK — la RC commerciale est la
  CGL du module commercial existant, non modifié.
- **Conversion** `POST /rc/:id/convertir` : crée la police (ligne `cgl`),
  fige la version de la soumission, crée la v1 de la police, journal
  `police_creee`. **Liaison** `POST /rc/:id/lier-police` : police CGL
  existante de la même entreprise. Bloc « Convertir en police » ajouté sur
  la fiche RC (`views/rc/fiche.ejs`).
- **Avenants en cours de terme** : `noterAvenantPolice()` branchée aux 8
  points de mutation de `routes/rc.js` (ajout / modification / archivage /
  désarchivage de lieu d’exploitation, garanties, antécédents, changement
  de statut, archivage de soumission) — chaque mutation d’une soumission
  convertie crée une version de la police avec note (règle d’or).
- **Fiche police** (`/echeances/police/:id`) : bloc **« Données RC »**
  (lieux d’exploitation figés à la conversion avec garanties par lieu —
  formule, limites, franchise, avenants — + antécédents, lien « voir le
  snapshot »).
- Dictionnaire : les 2 nouvelles colonnes `polices` sont documentées
  (l’enrichissement complet du domaine RC viendra à l’étape 4/10).
Tests : `scripts/test-rc-etape3.js` (54 tests, HTTP).

### RC (responsabilité civile / CGL) — étape 4/10 : dictionnaire des champs enrichi

L'étape 4 du module RC réutilise l'infrastructure des étapes 4/10 auto et
biens (vérificateur `generer-dictionnaire.js`, page `/admin/dictionnaire`,
`lib/contexte-ia.js`) et complète le domaine « Responsabilité civile (CGL) » :
- **5 tables RC documentées** : `rc_soumissions` (versionnée),
  `rc_exploitations` (lieux d'exploitation illimités), `rc_garanties`,
  `rc_antecedents`, `rc_soumission_versions` (versionnée) — 58 colonnes.
- **Valeurs autorisées des CHECK** documentées : `statut` (brouillon, soumise,
  convertie_police), `sous_traitants` (aucun, assures, non_assures),
  `formule` (locaux_operations, produits_completes, globale), clés des
  avenants (pollution, parapluie).
- **Conventions alignées sur les domaines auto et biens** : colonnes figées
  marquées « (figé) », unicités documentées (une fiche de garanties par lieu
  d'exploitation, une fiche d'antécédents par soumission), descriptions
  métier (tarification CGL : chiffre d'affaires, masse salariale,
  classification, limites par sinistre / agrégat, fidélité, relances).
- **Branchement IA** : `contexteDonnees()` et `contexteTables()` exposent les
  tables RC ; la mention de la règle d'or couvre aussi
  `rc_soumission_versions` (JSON `regle_or` et `lib/contexte-ia.js`).
- Total : 45 tables, 516 colonnes. Tests : `scripts/test-dictionnaire.js`
  étendu à 101 tests.

### RC (responsabilité civile / CGL) — étape 5/10 : exports CSV/JSON par module

L'étape 5 du module RC ajoute 3 modules à la page **Exports** existante
(mêmes conventions que les étapes 5/10 FPQ1 et biens : CSV `;` + BOM UTF-8
+ en-têtes français, JSON structuré, POST + CSRF, rate-limit, périmètre par
rôle, archivés exclus par défaut, aucun secret, journal d'audit) :

- **Lieux d'exploitation (RC)** : lieux avec garanties aplaties (formule
  en français — Locaux et opérations / Produits et opérations complétées /
  Globale, limite par sinistre, limite agrégat, franchise, prime), activité,
  chiffre d'affaires, masse salariale, employés, sous-traitants en français,
  et avenants en colonnes 0/1 (pollution, parapluie — même convention que
  l'UI) ; JSON avec objet `garanties` imbriqué.
- **Soumissions RC** : statut en français, version courante (MAX figée),
  décomptes (nb lieux, nb versions), antécédents (assureur actuel, sinistres
  5 ans en JSON) et consentements (crédit, dossier d'assurance) aplatis
  en 0/1.
- **Versions de soumissions RC** : historique figé v1, v2… avec le
  snapshot complet parsé en JSON (règle d'or).
- Les **polices CGL** restent couvertes par le module **Polices** existant
  — aucun doublon.

Tests : `scripts/test-exports-rc.js` — 41 tests : page (18 modules :
11 + 4 biens + 3 RC), données créées via les routes (`/rc`), chaque
module en CSV (BOM, `;`, en-têtes FR) et JSON (structure),
garanties/avenants vérifiés, archivés exclus/inclus, périmètre courtier
(son portefeuille uniquement), aucun secret, journal d'audit, 400 module
inconnu, 403 sans CSRF.

Capture : `demo-captures/commercial/48-exports-rc.png`.

### RC (responsabilité civile / CGL) — étape 6/10 : import CSV étendu

L'étape 6 du module RC étend la page **Import** existante (mêmes conventions
que les étapes 6/10 FPQ1 et biens : séparateur `;`, BOM, rapport ligne par
ligne, modèles téléchargeables avec commentaires `#`, CSRF, 5 Mo max,
courtier = son portefeuille uniquement, journal d'audit) avec une nouvelle
section **« Import RC — responsabilité civile »** :

- **4 nouveaux types de lignes** (en-têtes en français, **miroir des exports
  RC**) : `soumission_rc` (entreprise, date d'effet souhaitée, notes),
  `lieu_rc` (adresse, ville, code postal, activité, code de classification,
  description des activités, chiffre d'affaires, masse salariale,
  nb d'employés, superficie, sous-traitants `aucun`/`assures`/`non_assures`),
  `garanties_rc` (formule `locaux_operations`/`produits_completes`/
  `globale`, limite par sinistre, limite agrégat, franchise, prime,
  2 avenants en colonnes 0/1 : pollution, parapluie),
  `antecedents_rc` (assureur actuel, sinistres 5 ans
  `AAAA-MM-JJ|type|montant`, consentements crédit et dossier d'assurance).
- **Rattachement** : colonne `Soumission (id)`, ou `Entreprise` (la soumission
  RC active la plus récente est utilisée — la date d'effet permet de
  départager) ; lieu par `Lieu (id)` ou par `Adresse du lieu` (insensible
  à la casse).
- **Validation stricte avant toute écriture** : valeurs fermées
  (`sous_traitants`, `formule`), nombres ≥ 0, entiers, dates ISO.
- **Règle d'or** : chaque ligne crée une version via `lib/rc.js` —
  aucun écrasement, aucun DELETE.
- Modèles : `/import/modele-rc/:type` (4 fichiers, exemples + valeurs
  autorisées en commentaires).
- Exemple : `scripts/exemple-import-rc.csv` (4 lignes : 1 soumission,
  1 lieu, garanties, antécédents).
- **Correctif au passage** : les en-têtes français avec apostrophe courbe
  (`Nb d’étages`, `Montant d’assurance`, `Avenant — refoulement d’égout`,
  `Consentement dossier d’assurance`…) n'étaient jamais reconnus à
  l'import — l'index des équivalences est désormais normalisé comme les
  en-têtes lus (correctif silencieux aussi pour les imports biens/auto).

Tests : `scripts/test-import-rc.js` — 33 tests : page + 4 modèles, exemple
complet (4 créées, 0 erreur, **4 versions figées** vérifiées via l'export),
validation (5 cas d'erreur), cloisonnement inter-cabinets, portefeuille
courtier (rejet + rattachement), journal d'audit.
Capture : `demo-captures/commercial/49-import-rc.png`.

### RC (responsabilité civile / CGL) — étape 7/10 : proposition pré-remplie (HTML + PDF)

L'étape 7 du module RC miroir exact de l'étape 7/10 biens : la **proposition
d'assurance responsabilité civile pré-remplie** (`GET /rc/:id/proposition` et
`/rc/:id/proposition.pdf`), à partir de l'état courant ou d'une version figée
(`?v=N` — règle d'or : traçabilité).

- **Source unique** : `lib/proposition-rc.js` (`preparerPropositionRc`) —
  proposant, lieux d'exploitation illimités (activité, code de
  classification, description, CA, masse salariale, employés, superficie,
  sous-traitants), garanties par lieu (formule traduite : Locaux et
  opérations / Produits et opérations complétées / Globale, limite par
  sinistre, limite agrégat, franchise, avenants Pollution/Parapluie, prime),
  antécédents (sinistres 5 ans), consentements (crédit, dossier d'assurance).
  Libellés français identiques à `routes/rc.js`.
- **PDF** : `lib/proposition-rc-pdf.js` (pdfkit, texte non compressé) —
  titre « PROPOSITION D'ASSURANCE RESPONSABILITÉ CIVILE », sections
  proposant / lieux + garanties / antécédents / consentements, mention
  version + date de génération, lignes de signature proposant/courtier.
- **Vue** : `views/rc/proposition.ejs` — CSS/JS externes (`/proposition.css`,
  `/proposition.js`, CSP OK), boutons 🖨️ Imprimer / ⬇️ Télécharger PDF.
- **Bouton « 📄 Proposition »** sur la fiche RC (`views/rc/fiche.ejs`,
  remplace l'emplacement réservé de l'étape 2).
- **Sécurité** : exigeAuth + cabinet_id + portefeuille courtier, 404 version
  inconnue, audit `proposition_rc_generee` avec la version. La proposition
  ne modifie JAMAIS la soumission : lecture seule.
- Total général : **1569 tests** (1521 + 48).

Tests : `scripts/test-proposition-rc-pdf.js` — 32 tests : page 200 +
contenu (lieux, formules, limites, franchise, avenants, antécédents,
consentements, mention version), version figée ?v=1 / ?v=999 → 404,
PDF 200 (`%PDF`, texte décodé : adresse du lieu, avenant, n° soumission),
inter-cabinets → 404, portefeuille courtier (403/200), 302 sans login,
audit (`proposition_rc_generee` avec version).
Capture : `demo-captures/commercial/50-proposition-rc.png`.

### RC (responsabilité civile / CGL) — étape 8/10 : commandes texte IA

Miroir de l'étape 8/10 biens, étendu aux RC commerciales dans
`lib/commandes-ia.js` (analyseur local à règles, même protocole
analyse → confirmation → exécution, sans envoi auto) :

- **Nouvelles actions** : `ajouter_lieu_rc` (« ajoute un lieu au 456
  boulevard Industriel à Laval activité entrepôt chiffre d'affaires 1,2
  million à la soumission RC 1 » — adresse, ville, code postal, activité,
  code de classification, description, CA, masse salariale, employés,
  superficie, sous-traitants) et `modifier_garanties_rc` (« mets la limite
  par sinistre à 2 millions et l'agrégat à 4 millions franchise 5000
  formule globale avec l'avenant pollution pour le lieu 1 de la soumission
  RC 1 » — limite par sinistre, agrégat, franchise, formule
  locaux_operations / produits_completes / globale, avenants
  pollution/parapluie avec ajout ET retrait, **fusion** : les champs non
  mentionnés sont conservés).
- **Résolution** : « soumission RC 1 » vs « soumission biens 1 » vs
  « soumission 1 » (auto) distingués partout (`aller_a` aussi) ; dans les
  actions RC, « à la soumission 1 » vise implicitement une soumission RC ;
  résolution par nom de client avec demande de précision si ambiguë.
- **Mode Cohere** : schéma JSON strict étendu aux 2 actions
  (`ACTIONS_COHERE`). **Sécurité** : exigeAuth ; courtier = son portefeuille
  (refus poli) ; modifications via `lib/rc.js` (versionnage, règle d'or) ;
  **confirmation obligatoire** (`ACTIONS_CONFIRMABLES` dans
  `lib/assistant.js`, revérifiée au 2e clic, CSRF) ; audit `commande_ia`.
- Aide de l'assistant : 3 exemples de commandes RC ajoutés.

Tests : `scripts/test-commandes-rc.js` — 48 tests : analyseur (montants
« 1,2 million », synonymes, formules, retrait d'avenant, distinction
auto/biens/RC, non-régressions), confirmation requise (rien exécuté avant
le 2e clic), lieu créé avec tous les champs + version figée, fusion des
garanties, retrait d'avenant, lieu inexistant, ambiguïtés, inter-cabinets
sans fuite, portefeuille courtier (refus + OK), CSRF 403, audit.
Capture : `demo-captures/commercial/51-commande-rc.png`.

### RC (responsabilité civile / CGL) — étape 9/10 : commande vocale

Le bouton 🎤 dicte aussi les commandes RC : la voix alimente le pipeline
de l'étape 8/10 RC (analyse → confirmation → exécution), sans envoi
automatique. `normaliserDictee()` (`public/dictee.js`, module partagé
navigateur + Node) a été étendu au vocabulaire RC — conversion uniquement
quand le nombre est ancré (unité, mot de rue ou mot-clé de champ), le texte
libre n'est jamais touché :

- **Montants décimaux dictés** (nouveau) : « un virgule deux million » →
  `1200000` (chiffre d'affaires), « deux virgule cinq millions » →
  `2500000` (limites), « un milliard virgule cinq » → `1500000000` —
  ancrés sur million(s)/milliard(s) uniquement ; « un virgule deux
  options » (sans ancrage) reste du texte libre. La règle passe avant la
  règle des montants entiers (plus spécifique : sinon « un milliard
  virgule cinq » serait avalé partiellement).
- « dix-huit mille pieds carrés » → `18000` ; « quatre cent cinquante-six
  boulevard Industriel » → `456 boulevard Industriel` (règles ancrées de
  l'étape 9/10 biens, réutilisées) ; « locaux et opérations »,
  « sous-traitants assurés » restent tels quels.

Exemple dicté de bout en bout (vérifié) : « ajoute un lieu au quatre cent
cinquante-six boulevard Industriel à Laval activité entrepôt chiffre
d'affaires un virgule deux million à la soumission RC 1 » → normalisé →
confirmation (« Je vais ajouter le lieu d'exploitation 456 boulevard
Industriel, Laval (activité : entrepôt) à la soumission RC #1… ») → lieu
créé en base (adresse, ville, activité, CA 1200000) + version figée.

Tests : `scripts/test-voix.js` — 71 tests (53 existants + 18 RC : 10 cas de
normalisation RC, pipeline RC complet dictée → confirmation → création en
base + version). Note de confidentialité (service vocal du navigateur ;
Whisper 100 % local prévu au déploiement) toujours affichée dans l'aide.
Capture : `demo-captures/commercial/52-voix-rc.png`.

### RC (responsabilité civile / CGL) — étape 10/10 : final (balayage complet)

Balayage final du module RC (2026-10-19) : toutes les suites exécutées
une par une sur bases fraîches (serveur tué + base supprimée entre chaque ;
suites modèle avec `CHEMIN_BD`, sans serveur ; `test-droits-2026-10-09.js`
avec `CHEMIN_BD` des deux côtés ; `test-phase1.js` exclue — obsolète).

**Résultat : 1771/1771 tests verts, zéro échec** (balayage complet après Cyber étape 3/10).

| Suite | Tests |
|---|---|
| test-principes.js (règle d'or) | 112 |
| test-dictionnaire.js (auto + biens + RC + cyber) | 112 |
| test-biens-etape2.js (questionnaire biens) | 74 |
| test-voix.js (FPQ1 + biens + RC + cyber) | 71 |
| test-cyber-etape2.js (questionnaire cyber) | 71 |
| test-rc-etape2.js (questionnaire RC) | 70 |
| test-nouveaux-modules.js | 65 |
| test-fpq1-etape2.js | 62 |
| test-demandes-2026-10-09.js | 57 |
| test-biens-etape1.js (modèle biens) | 57 |
| test-exports.js | 55 |
| test-cyber-etape3.js (police cyber) | 55 |
| test-rc-etape3.js (police RC) | 54 |
| test-fpq1-etape1.js (modèle auto) | 53 |
| test-fpq1-etape3.js | 52 |
| test-biens-etape3.js (police biens) | 52 |
| test-ajustements.js | 48 |
| test-commandes-ia.js (auto) | 48 |
| test-commandes-rc.js | 48 |
| test-rc-etape1.js (modèle RC) | 48 |
| test-droits-2026-10-09.js | 48 |
| test-assureurs.js | 47 |
| test-commandes-biens.js | 47 |
| test-cyber-etape1.js (modèle cyber) | 47 |
| test-exports-biens.js | 44 |
| test-exports-rc.js | 41 |
| test-import-biens.js | 36 |
| test-courriels.js | 35 |
| test-proposition-biens-pdf.js | 33 |
| test-import-auto.js | 33 |
| test-import-rc.js | 33 |
| test-proposition-rc-pdf.js | 32 |
| test-proposition-pdf.js | 31 |
| **Total** | **1771** |

- Captures 44–55 revues visuellement : `demo-captures/commercial/`
  (44-rc-liste, 45-rc-fiche, 46-police-rc, 47-dictionnaire-rc,
  48-exports-rc, 49-import-rc, 50-proposition-rc, 51-commande-rc,
  52-voix-rc, 53-cyber-liste, 54-cyber-fiche, 55-police-cyber).
- Règle d'or re-vérifiée sur les écrans RC : aucun bouton « Supprimer »,
  aucune « zone dangereuse », aucune route DELETE sur `/rc`, aucun
  `DELETE FROM rc_*` en dur — archivage doux partout, chaque mutation
  passe par `lib/rc.js` (versionnage systématique).
- Livraison : `~/workspace/your_files/courtier-rc-final.zip` (même
  recette que les ZIP FPQ1/biens : tout le code, captures incluses, sans
  `courtier.db*`, sans `.env`, sans `node_modules`).

### Biens commerciaux — étape 2/10 : questionnaire de soumission (interface)

Nouvel onglet **« Biens »** (`/biens`), à côté d'« Auto », miroir du questionnaire
FPQ1 : liste des soumissions (filtre par statut, « Voir les archivées »),
création (entreprise cliente, date d’effet souhaitée, notes), puis **fiche
soumission** en sections :

- **Bâtiments (illimités)** : formulaire d’ajout (adresse, ville, code postal,
  type de construction, année, superficie pi², nb étages, occupation, valeur,
  gicleurs, distance caserne, chauffage, année toiture) + liste avec
  **modifier** et archiver/désarchiver.
- **Contenus (illimités)** : formulaire (description, type
  mobilier/équipements/stock/améliorations/autre, valeur, bâtiment concerné ou
  « général ») + liste avec modifier et archiver/désarchiver.
- **Garanties par bâtiment** : formule (tous risques / risques désignés),
  franchise, montant d’assurance, avenants en cases à cocher (tremblement de
  terre, inondation, refoulement d’égout, bris de machines, perte
  d’exploitation liée), prime.
- **Antécédents** : assureur actuel, sinistres 5 ans (lignes dynamiques :
  date, type, montant), consentements (dossier de crédit, dossier d’assurance).
- **Historique des versions** en lecture seule (`/biens/:id/versions/:v`).

Chaque écriture passe par `lib/biens.js` (versionnage auto, règle d’or).
Sécurité : exigeAuth + cabinet_id + portefeuille courtier (mêmes helpers que
`routes/auto.js`) ; journal d’audit `biens_%` sur chaque action.
Routes : `routes/biens.js` ; vues `views/biens/*.ejs`.
Tests : `scripts/test-biens-etape2.js` (74 tests HTTP).

### Biens commerciaux — étape 3/10 : fiche police biens (gestion)

Miroir exact de l’étape 3/10 FPQ1 :

- **`polices.biens_soumission_id` + `biens_soumission_version`** (mêmes conventions
  que les colonnes auto ; migration avec reconstruction pour les bases
  existantes, données auto préservées). Produit `biens` (déjà dans le CHECK).
- **`POST /biens/:id/convertir`** : crée la police (numéro, assureur, dates,
  franchise) liée à la soumission avec la version figée ; statut soumission →
  `convertie_police`. **`POST /biens/:id/lier-police`** : lie une police biens
  existante (même entreprise, non liée).
- **Fiche police** (`/echeances/police/:id`) : bloc « 🏢 Données biens » avec le
  snapshot figé (bâtiments, contenus, garanties, antécédents) + lien
  « voir le snapshot » (`/biens/:id/versions/:v`).
- **Avenants** : toute modification d’une soumission convertie (bâtiment,
  contenu, garanties, antécédents — ajout/modification/archivage) crée une
  nouvelle version de police avec `avenant_note` (ex. « Avenant — bâtiment
  ajouté (soumission biens #3) »).
- Polices biens visibles dans les **Échéances** (aucun filtre produit : la
  requête couvre toutes les lignes).
- Sécurité : exigeAuth + cabinet_id + portefeuille courtier, CSRF, audit sur
  chaque action, règle d’or (aucun DELETE).
- Dictionnaire : colonnes documentées dans `lib/dictionnaire-champs.json`
  (vérification automatique du schéma).
Tests : `scripts/test-biens-etape3.js` (52 tests HTTP : conversion, liaison,
avenants, snapshot figé, 404/403, portefeuille, audit). Capture :
`demo-captures/commercial/37-police-biens.png`.

### FPQ1 — étape 2/10 : questionnaire de soumission (interface)

Nouvel onglet **« Auto »** (`/auto`) : liste des soumissions (filtre par statut,
« Voir les archivées »), création (entreprise cliente, date d’effet souhaitée,
notes), puis **fiche soumission** en sections : conducteurs et véhicules en
**nombre illimité** (ajout dynamique en JS, aucun script inline — CSP stricte),
garanties par véhicule (RC 50 000 $ / 1 M$ / 2 M$, B1–B4, franchise, avenants
FAQ 43/20/27/34/5a à cocher), antécédents (assureur actuel, sinistres 6 ans en
lignes dynamiques, résiliation/non-paiement/faillite/casier, consentements
crédit/SAAQ/FCSA), statuts brouillon → soumise → convertie en police,
archivage (jamais de suppression), et **historique des versions** en lecture
seule (`/auto/:id/versions/:v`). Les courtiers ne voient que les soumissions
des entreprises de leur portefeuille (`clausePortefeuille`, 403 sinon).
Routes : `routes/auto.js` ; vues `views/auto/*.ejs` ; JS dans `public/app.js` ;
tests : `scripts/test-fpq1-etape2.js` (62 tests HTTP).

### FPQ1 — étape 3/10 : gestion de la police auto

Quand une soumission est acceptée par l'assureur, elle devient une police à gérer :
- **Produit `auto`** (« Assurance automobile (FPQ1) ») ajouté aux lignes d'affaires
  (`polices.ligne`, filtre, import CSV, cases « produits offerts » des assureurs).
- **Conversion** : depuis la fiche soumission, « Convertir en police » crée la police
  auto liée (`polices.auto_soumission_id`, version FPQ1 figée en
  `auto_soumission_version`) et fait passer la soumission à `convertie_police` ;
  on peut aussi **lier une police auto existante** (même entreprise, non liée).
- **Fiche de révision** (`/echeances/police/:id`) : pour une police auto, section
  **« Données FPQ1 »** — snapshot figé à la conversion (conducteurs, véhicules,
  garanties RC/B1–B4/franchise/avenants FAQ, lecture seule) + liens d'attestation.
- **Avenants en cours de terme** : toute modification des conducteurs/véhicules/
  garanties/antécédents d'une soumission convertie crée automatiquement une
  **nouvelle version de la police avec note d'avenant** (`police_versions.avenant_note`),
  visible dans l'historique des versions.
- **Échéances** : les polices auto apparaissent dans le tableau J-90/J-60/J-30
  comme les autres (aucun changement nécessaire — requêtes génériques).
- **Attestation d'assurance (carte rose)** : page imprimable par véhicule
  (`/polices/:id/attestation/:vid`) — assuré, véhicule (année/marque/modèle/VIN),
  n° police, assureur, période d'assurance.
- Règle d'or respectée : aucun DELETE, archivage uniquement, versionnage
  systématique, journal d'audit (`police_creee`, `police_version`, `police_liee_soumission`).
- Routes : conversion/liaison dans `routes/auto.js` ; fiche et attestations dans
  `routes/polices.js` + `routes/echeances.js` ; vues `views/auto/fiche.ejs`
  (conversion), `views/echeances/revision.ejs` (section FPQ1),
  `views/polices/attestation.ejs` (imprimable) ;
  tests : `scripts/test-fpq1-etape3.js` (52 tests HTTP).

### FPQ1 — étape 4/10 : dictionnaire des champs IA-friendly

Pour que l'IA « s'y retrouve » dans toutes les données (soumission + gestion) :
- **`lib/dictionnaire-champs.json`** : 34 tables et 385 colonnes documentées
  (nom, libellé français, description, type, usage `soumission`/`gestion`/
  `les_deux`/`technique`, relations, tables de versionnage, règle d'or).
  Aucune donnée client — que des métadonnées.
- **`scripts/generer-dictionnaire.js`** : vérifie que le JSON documente
  exactement le schéma réel (échoue en listant les manquants) — le
  dictionnaire ne peut pas pourrir.
- **Page Admin → Dictionnaire des champs** (`/admin/dictionnaire`, rôle admin) :
  présentation lisible par domaine, recherche par mot-clé (sans script inline,
  CSP stricte), lien depuis Admin → Utilisateurs.
- **`lib/contexte-ia.js`** : `contexteDonnees()` retourne le dictionnaire en
  texte compact, prêt pour les prompts. Branché dans `lib/assistant.js` :
  l'interpréteur Cohere reçoit le schéma des tables dans son prompt.
- Tests : `scripts/test-dictionnaire.js` (69 tests : JSON complet, page 200/403,
  recherche, `contexteDonnees()` incluant les tables biens, aucune donnée personnelle).

### Biens — étape 4/10 : dictionnaire des champs enrichi

L'étape 4 du module biens réutilise l'infrastructure de l'étape 4/10 FPQ1
(vérificateur `generer-dictionnaire.js`, page `/admin/dictionnaire`,
`lib/contexte-ia.js`) et complète le domaine « Biens commerciaux » :
- **6 tables biens documentées** : `biens_soumissions` (versionnée),
  `biens_batiments`, `biens_contenus`, `biens_garanties`, `biens_antecedents`,
  `biens_soumission_versions` (versionnée) — 69 colonnes.
- **Valeurs autorisées des CHECK** documentées : `statut` (brouillon, soumise,
  convertie_police), `type_construction` (bois, acier, beton, maconnerie, mixte),
  `type_contenu` (mobilier, equipements, stock, ameliorations, autre),
  `formule` (tous_risques, risques_designes), clés des avenants
  (tremblement_terre, inondation, refoulement_egout, bris_machines,
  perte_exploitation_liee).
- **Conventions alignées sur le domaine auto** : colonnes figées marquées
  « (figé) », unicités documentées (une fiche de garanties par bâtiment, une
  fiche d'antécédents par soumission), descriptions métier (tarification,
  fidélité, relances).
- **Branchement IA** : `contexteDonnees()` et `contexteTables()` exposent les
  tables biens ; la mention de la règle d'or couvre aussi
  `biens_soumission_versions`.
- Total : 45 tables, 516 colonnes (domaine RC enrichi à l'étape 4/10 RC). Tests : `scripts/test-dictionnaire.js`
  étendu à 101 tests.

### Biens — étape 5/10 : exports CSV/JSON par module

L'étape 5 du module biens ajoute 4 modules à la page **Exports** existante
(mêmes conventions que l'étape 5/10 FPQ1 : CSV `;` + BOM UTF-8 + en-têtes
français du dictionnaire, JSON structuré, POST + CSRF, rate-limit, périmètre
par rôle, archivés exclus par défaut, aucun secret, journal d'audit) :

- **Bâtiments (biens)** : bâtiments avec garanties aplaties (formule en
  français, franchise, montant d'assurance, prime) et avenants en colonnes
  0/1 (tremblement de terre, inondation, refoulement d'égout, bris de
  machines, perte d'exploitation liée — clés courtes, même convention que
  l'UI) ; JSON avec objet `garanties` imbriqué.
- **Contenus (biens)** : contenus rattachés à leur bâtiment (« Bâtiment
  rattaché ») ou marqués « Contenu général » quand `batiment_id` est NULL.
- **Soumissions biens** : statut en français, décomptes (nb bâtiments,
  nb contenus, nb versions), antécédents (assureur actuel, sinistres 5 ans
  en JSON) et consentements (crédit, dossier d'assurance) aplatis en 0/1.
- **Versions de soumissions biens** : historique figé v1, v2… avec le
  snapshot complet parsé en JSON (règle d'or).
- Les **polices biens** restent couvertes par le module **Polices** existant
  (ligne « Biens commerciaux ») — aucun doublon.

Tests : `scripts/test-exports-biens.js` — 44 tests : page (18 modules :
11 + 4 biens + 3 RC — vérifié à nouveau à l'étape 5/10 RC),
données créées via les routes (`/biens`), chaque module en CSV (BOM, `;`,
en-têtes FR) et JSON (structure), garanties/avenants vérifiés, archivés
exclus/inclus, périmètre courtier (son portefeuille uniquement), aucun
secret, journal d'audit, 400 module inconnu.

### Biens — étape 6/10 : import CSV étendu

L'étape 6 du module biens étend la page **Import** existante (mêmes conventions
que l'étape 6/10 FPQ1 : séparateur `;`, BOM, rapport ligne par ligne, modèles
téléchargeables avec commentaires `#`, CSRF, 5 Mo max, courtier = son
portefeuille uniquement, journal d'audit) avec une nouvelle section
**« Import biens — soumissions commerciales »** :

- **5 nouveaux types de lignes** (en-têtes en français, **miroir des exports
  biens**) : `soumission_biens` (entreprise, date d'effet souhaitée, notes),
  `batiment` (adresse, ville, code postal, type de construction, année,
  superficie, étages, occupation, valeur, gicleurs, distance caserne,
  chauffage, année de toiture), `contenu` (rattaché via `Bâtiment (id)` ou
  `Adresse du bâtiment`, ou « général »), `garanties_biens` (formule,
  franchise, montant, prime, 5 avenants en colonnes 0/1), `antecedents_biens`
  (assureur actuel, sinistres 5 ans `AAAA-MM-JJ|type|montant`, consentements).
- **Rattachement** : colonne `Soumission (id)`, ou `Entreprise` (la soumission
  biens active la plus récente est utilisée — la date d'effet permet de
  départager) ; bâtiment par id ou par adresse (insensible à la casse).
- **Validation stricte avant toute écriture** : valeurs fermées
  (`type_construction` : bois/acier/beton/maconnerie/mixte ; `formule` :
  tous_risques/risques_designes ; `type_contenu` :
  mobilier/equipements/stock/ameliorations/autre), nombres ≥ 0, dates ISO.
- **Règle d'or** : chaque ligne crée une version via `lib/biens.js` —
  aucun écrasement, aucun DELETE.
- Modèles : `/import/modele-biens/:type` (5 fichiers, exemples + valeurs
  autorisées en commentaires).
- Exemple : `scripts/exemple-import-biens.csv` (7 lignes : 1 soumission,
  2 bâtiments, 2 contenus dont 1 général, garanties, antécédents).

Tests : `scripts/test-import-biens.js` — 36 tests : page + 5 modèles, exemple
complet (7 créées, 0 erreur, **7 versions figées** vérifiées via l'export),
validation (6 cas d'erreur), cloisonnement inter-cabinets, portefeuille
courtier (rejet + rattachement), journal d'audit.

### Biens — étape 7/10 : proposition pré-remplie (HTML imprimable + PDF)

Miroir de l'étape 7/10 FPQ1, adapté aux biens commerciaux. Depuis la fiche
d'une soumission biens, le bouton **📄 Proposition** génère le formulaire à
envoyer aux assureurs, pré-rempli avec les données déjà saisies — sans
ressaisie :

- `GET /biens/:id/proposition` — page HTML imprimable : proposant,
  bâtiments (illimités) avec détails (construction, superficie, occupation,
  valeur, protection incendie, chauffage/toiture) et garanties par bâtiment
  (formule Tous risques / Risques désignés, montant, franchise, prime,
  avenants tremblement de terre / inondation / refoulement d'égout /
  bris de machines / perte d'exploitation liée), contenus par bâtiment
  (tableau) + contenus généraux, antécédents (sinistres **5 ans**),
  consentements, mention « Document généré le … à partir de la soumission
  biens #… (version vN) — vérifiez avant envoi » + signatures. CSS/JS
  externes (`/proposition.css`, `/proposition.js`) — CSP stricte.
- `GET /biens/:id/proposition.pdf` — le même contenu en **PDF téléchargeable**
  (`pdfkit`, texte en clair dans le flux pour la traçabilité).
- `?v=N` : version figée (règle d'or), sinon état courant avec mention de
  la version.
- Chaque génération est journalisée (`proposition_biens_generee`, avec la
  version utilisée). Accès : exigeAuth + cabinet + portefeuille courtier.
- Source unique : `lib/proposition-biens.js` (données normalisées, libellés
  identiques à `routes/biens.js`) + `lib/proposition-biens-pdf.js`.

Tests : `scripts/test-proposition-biens-pdf.js` — 33 tests : page 200 +
contenu (bâtiment, garanties, avenants, contenus, antécédents,
consentements, mention version), version figée ?v=1 / ?v=999 → 404,
PDF 200 (`%PDF`, texte décodé : bâtiment, n° soumission),
inter-cabinets → 404, portefeuille courtier (403/200), 302 sans login,
audit (`proposition_biens_generee` avec version).
Capture : `demo-captures/commercial/41-proposition-biens.png`.

### Biens — étape 8/10 : commande texte IA

Miroir de l'étape 8/10 FPQ1, étendu aux biens commerciaux dans
`lib/commandes-ia.js` (mêmes patterns, mêmes garanties de sécurité) :

- **Nouvelles actions** : `ajouter_batiment` (« ajoute un bâtiment au
  123 rue Principale à Montréal construction béton année 1985 superficie
  12000 occupation entrepôt valeur 1500000 à la soumission biens 1 » —
  l'adresse est obligatoire ; le type de construction est normalisé vers les
  valeurs fermées de la base (`beton`, `maconnerie`…) avec message clair si
  non reconnu), `ajouter_contenu` (« ajoute un contenu outillage 50000 $ au
  bâtiment 1 de la soumission biens 1 » — valeur avec ou sans `$`, nombre nu
  accepté), `modifier_garantie_biens` (« mets la formule tous risques et la
  franchise à 1000 $ pour le bâtiment 1 de la soumission biens 1 » — formule
  `tous_risques` / `risques_designes`, franchise, montant d'assurance, avec
  fusion : les champs non mentionnés sont conservés).
- **Distinction auto/biens** : « soumission biens 1 » → `/biens/1`,
  « soumission 1 » → `/auto/1` (inchangé) ; « ouvre les biens » →
  l'onglet Biens. Dans les actions biens, « à la soumission 1 » vise
  implicitement une soumission biens ; la résolution par nom de client
  (« la soumission biens de Méthot ») demande une précision si ambiguë.
- **Mode Cohere** : schéma JSON strict étendu aux 3 nouvelles actions
  (`ACTIONS_COHERE`), exécutées par les mêmes fonctions validées.
- **Sécurité** : exigeAuth ; courtier = son portefeuille (refus poli) ;
  toute modification passe par `lib/biens.js` (versionnage, règle d'or) ;
  **confirmation obligatoire** avant exécution (`POST /assistant/confirmer`,
  CSRF, tout revérifié) ; audit `commande_ia`.
- Aide de l'assistant (`texteAide()`) : exemples de commandes biens ajoutés.
- La dictée vocale (étape 9/10 FPQ1) alimente le même pipeline — aucun
  changement serveur requis.

Tests : `scripts/test-commandes-biens.js` — 47 tests : analyseur
(14 cas : champs complets, synonymes, valeur nue, formule+franchise
combinées, risques désignés, distinction auto/biens, adresse manquante,
type de construction inconnu, non-régression auto), confirmation requise
(rien exécuté avant le 2e clic), bâtiment créé avec tous les champs +
version figée, contenu rattaché au bâtiment, fusion des garanties,
bâtiment inexistant, ambiguïtés, inter-cabinets, portefeuille courtier,
CSRF 403, audit.
Capture : `demo-captures/commercial/42-commande-biens.png`.

### Biens — étape 9/10 : commande vocale

Le bouton 🎤 dicte aussi les commandes biens : la voix alimente le pipeline
de l'étape 8/10 biens (analyse → confirmation → exécution), sans envoi
automatique. `normaliserDictee()` (`public/dictee.js`, module partagé
navigateur + Node) a été étendu au vocabulaire biens — conversion uniquement
quand le nombre est ancré (unité, mot de rue ou mot-clé de champ), le texte
libre n'est jamais touché :

- « douze mille pieds carrés » → `12000` (aussi « 12000 pieds carrés »,
  « 12000 pi2 » déjà en chiffres — l'unité redondante est supprimée)
- « neuf cent cinquante mille dollars » → `950000` (« 1500000 dollars »,
  « deux millions de dollars » → `2000000`)
- « cent vingt-trois rue Principale » → `123 rue Principale` (rue, avenue,
  boulevard, chemin… ; chiffres épelés acceptés : « un deux trois rue… »)
- « année de construction deux mille dix » → `2010` (règle des années,
  inchangée) ; « tous risques » reste tel quel
- Robustesse analyseur (`lib/commandes-ia.js`, `prendreChampBiens`) : le
  « de » après le mot-clé est optionnel (« superficie de 12000 ») et la
  valeur peut être suivie d'une virgule.

Exemple dicté de bout en bout (vérifié) : « ajoute un bâtiment au cent
vingt-trois rue Principale à Montréal construction béton année deux mille
dix superficie douze mille pieds carrés occupation entrepôt valeur neuf
cent cinquante mille dollars à la soumission biens 1 » → normalisé →
confirmation → bâtiment créé (adresse, ville, construction, année,
superficie, occupation, valeur) + version figée.

Tests : `scripts/test-voix.js` — 53 tests (32 FPQ1 + 21 biens : 13 cas de
normalisation biens, pipeline biens complet dictée → confirmation →
création en base + version). Note de confidentialité (service vocal du
navigateur ; Whisper 100 % local prévu au déploiement) toujours affichée
dans l'aide.
Capture : `demo-captures/commercial/43-voix-biens.png`.

### Biens — étape 10/10 : final (balayage complet)

Balayage final du module biens (2026-10-19) : toutes les suites exécutées
une par une sur bases fraîches (serveur tué + base supprimée entre chaque ;
suites modèle avec `CHEMIN_BD`, sans serveur ; `test-droits-2026-10-09.js`
avec `CHEMIN_BD` des deux côtés ; `test-phase1.js` exclue — obsolète).

**Résultat : 1211/1211 tests verts, zéro échec.**

| Suite | Tests |
|---|---|
| test-principes.js (règle d'or) | 112 |
| test-biens-etape2.js (questionnaire biens) | 74 |
| test-dictionnaire.js (auto + biens + RC) | 69 |
| test-nouveaux-modules.js | 65 |
| test-fpq1-etape2.js | 62 |
| test-demandes-2026-10-09.js | 57 |
| test-biens-etape1.js (modèle biens) | 57 |
| test-exports.js | 55 |
| test-fpq1-etape1.js (modèle auto) | 53 |
| test-voix.js (FPQ1 + biens) | 53 |
| test-fpq1-etape3.js | 52 |
| test-biens-etape3.js (police biens) | 52 |
| test-ajustements.js | 48 |
| test-droits-2026-10-09.js | 48 |
| test-commandes-ia.js (auto) | 48 |
| test-rc-etape1.js (modèle RC) | 48 |
| test-assureurs.js | 47 |
| test-commandes-biens.js | 47 |
| test-exports-biens.js | 44 |
| test-exports-rc.js | 41 |
| test-import-biens.js | 36 |
| test-courriels.js | 35 |
| test-proposition-biens-pdf.js | 33 |
| test-proposition-rc-pdf.js | 32 |
| test-import-auto.js | 33 |
| test-proposition-pdf.js | 31 |
| **Total** | **1300** |

- Captures 35–43 revues visuellement : `demo-captures/commercial/`
  (35-biens-liste, 36-biens-fiche, 37-police-biens, 38-dictionnaire-biens,
  39-exports-biens, 40-import-biens, 41-proposition-biens,
  42-commande-biens, 43-voix-biens).
- Règle d'or re-vérifiée sur les écrans biens : aucun bouton « Supprimer »,
  aucune « zone dangereuse », aucune route DELETE sur `/biens`, aucun
  `DELETE FROM biens_*` en dur — archivage doux partout, chaque mutation
  passe par `lib/biens.js` et fige une version.
- Livraison : `~/workspace/your_files/courtier-biens-final.zip` (même
  recette que le ZIP FPQ1 : tout le code, captures incluses, sans
  `courtier.db*`, sans `.env`, sans `node_modules`).

> `test-phase1.js` correspond à l'ancien schéma (auto/habitation) et n'est plus
> exécuté — la suite de référence est `test-ajustements.js`.

### Perte d'exploitation — étape 1/10 : couche données (sans interface)

Couche d'accès `lib/pe.js` (miroir de `lib/do.js`) pour les soumissions
**perte d'exploitation / interruption des affaires** :

- **5 tables `pe_*`** : `pe_soumissions` (statuts brouillon/soumise/convertie_police),
  `pe_etablissements` (**illimités** : nom du lieu, adresse, occupation,
  chiffre d’affaires, superficie, année de construction, base de valeur —
  CHECK `remplacement`/`depreciation`),
  `pe_garanties` (UNIQUE par soumission : limite, **période d’indemnité en
  mois** — CHECK 12/18/24 —, **franchise en jours** — délai de carence —,
  **base d’indemnité** — CHECK `benefice_brut`/`marge_brute`/`chiffre_affaires` —,
  avenants JSON : `frais_supplementaires`, `dependance_fournisseurs`,
  `acces_civil`, `deterioration_stocks`, prime),
  `pe_antecedents` (assureur actuel, **interruptions des 5 dernières années**
  JSON `{date, cause, duree_jours, montant}`, consentements),
  `pe_soumission_versions` (snapshot figé `{etablissements, garanties,
  antecedents}` à **chaque** mutation — règle d’or : aucune suppression).
- Validations métier en couche (franchise ≥ 0, CA ≥ 0, nom du lieu **ou**
  adresse requis), audit `pe_%` sur chaque écriture, cloisonnement
  inter-cabinets.
- Démo : **Boulangerie Chaleur inc.** (fournil 750 k$, magasin 450 k$,
  entrepôt ; limite 800 000 $, 12 mois, franchise 3 jours, base marge
  brute, avenants frais supplémentaires + détérioration des stocks ;
  interruption 2022 — bris d’équipement (four), 6 jours, 28 000 $).

Tests : `scripts/test-pe-etape1.js` (47 tests, sans serveur).

### Perte d'exploitation — étape 2/10 : questionnaire de soumission (interface)

Nouvel onglet **« Perte d'exploitation »** (`/pe`), après « D&O », miroir
du questionnaire D&O : liste des soumissions (filtre par statut, « Voir les
archivées », colonnes entreprise/statut/effet souhaité/établissements/limite),
création (entreprise cliente, date d’effet souhaitée, notes), puis **fiche
soumission** en sections :

- **Établissements assurés (illimités)** : formulaire d’ajout (nom du lieu,
  adresse, occupation, chiffre d’affaires, superficie, année de construction,
  base de valeur — coût de remplacement / valeur dépréciée) + liste avec
  **modifier** et archiver/désarchiver.
- **Garanties par soumission** : limite, **période d’indemnité (radio :
  12 / 18 / 24 mois)**, **franchise — délai de carence (jours)**,
  **base d’indemnité (radio : Bénéfice brut / Marge brute / Chiffre
  d’affaires)**, avenants en cases à cocher (frais supplémentaires,
  dépendance aux fournisseurs, accès civil, détérioration des stocks), prime.
- **Antécédents** : assureur actuel, **interruptions des 5 dernières années
  via textarea** (une par ligne, format `AAAA-MM-JJ | cause | durée (jours) |
  montant` — parsé en JSON `{date, cause, duree_jours, montant}`),
  consentements (dossier de crédit, dossier d’assurance).
- **Historique des versions** en lecture seule (`/pe/:id/versions/:v`).

La conversion en police arrivera à l’étape 3/10 (ligne de police
`perte_exploitation` déjà réservée dans le CHECK `polices.ligne`) ;
l’emplacement du bouton « 📄 Proposition » est réservé sur la fiche
(grisé « (bientôt) ») pour l’étape 7/10.

Tests : `scripts/test-pe-etape2.js` (**89 tests**, HTTP) — création (400 sans
client / client invalide / date invalide), établissements illimités
(modification, archivage/restauration, CA négatif rejeté), garanties
(période et base radio, avenants cochés, période/base/franchise invalides
rejetés, mise à jour sans doublon), antécédents (textarea parsé en nombres,
consentements), statuts, versions figées (lecture seule), archivage de la
soumission, portefeuille courtier (403), inter-cabinets (404), CSRF (403),
journal d’audit `pe_%`, règle d’or (zéro `DELETE FROM pe_*` en dur).

Captures : `demo-captures/commercial/` (`80-pe-liste.png` — liste avec la
démo Boulangerie Chaleur, onglet après D&O ; `81-pe-fiche.png` — fiche
complète : 3 établissements, radios période 12/18/24, base marge brute,
4 avenants, textarea d’interruptions, versions v1–v6).

### Perte d'exploitation — étape 3/10 : fiche police (gestion)

Miroir de l’étape 3/10 D&O :

- Migration `polices.pe_soumission_id` + `pe_soumission_version` (reconstruction
  préservant les colonnes auto/biens/RC/cyber/E&O/D&O, `UNIQUE` sur
  `pe_soumission_id` — une version = une police max).
- `POST /pe/:id/convertir` : crée la police en ligne `perte_exploitation`
  liée à la version courante de la soumission (prime, dates, assureur depuis
  le formulaire), statut → `convertie_police`, audit `police_creee`.
- `POST /pe/:id/lier-police` : lie une police `perte_exploitation` existante
  de la même entreprise (erreur claire si déjà liée ou d’une autre ligne).
- `noterAvenantPolice()` aux 8 points de mutation de la fiche soumission
  (établissement ajouté / modifié / archivé / désarchivé, garanties,
  antécédents, statut, soumission archivée) : chaque avenant crée une
  nouvelle version de la police avec note.
- Bloc « 📉 Données perte d'exploitation » sur `/echeances/police/:id` :
  snapshot figé de la version liée (établissements, garanties — limite,
  période d’indemnité en mois, franchise en jours, base en libellé FR,
  avenants, prime —, antécédents avec interruptions).
- Bouton de conversion dégrisé sur la fiche soumission PE (carte
  « 🏛️ Convertir en police » + liaison).

Tests : `scripts/test-pe-etape3.js` (**56 tests**, HTTP) — migration,
conversion (ligne, lien, version figée, statut, v1, audit), bloc figé sur
la fiche police, avenants (v2/v3/v4 avec notes), double conversion refusée,
liaison (police manuelle, non-PE refusée, déjà liée refusée), CSRF (403),
inter-cabinets (404), portefeuille courtier (403), audit, règle d’or
(zéro `DELETE FROM pe_*` en dur). `test-pe-etape2.js` inchangé et vert
(89/89 — la seule assertion de fiche, le bouton Proposition grisé,
est intacte).

Capture : `demo-captures/commercial/82-police-pe.png` — fiche police
PE-001 de Boulangerie Chaleur inc. avec le bloc « 📉 Données perte
d'exploitation » (établissements, garanties, interruption 2022).

### Perte d'exploitation — étape 4/10 : dictionnaire IA enrichi

Enrichissement du domaine « pe » dans `lib/dictionnaire-champs.json` avec
des descriptions métier utiles à la tarification PE (miroir de l'étape 4/10
D&O — 40 descriptions enrichies, domaine « pe » uniquement, round-trip JSON
fidèle, vérificateur vert : **65 tables, 729 colonnes**) :

- **Exposition = somme des chiffres d'affaires par lieu** : un seul lieu
  arrêté peut priver l'entreprise de sa capacité à produire ou à servir —
  un fournil sans courant arrête le magasin qui n'a plus rien à vendre ;
  un lieu sans CA déclaré (entrepôt) peut quand même arrêter la chaîne.
- **Période d'indemnité (12/18/24 mois)** : trop courte = l'entreprise
  épuise sa limite avant le retour à la normale — travaux, importation
  d'équipements, permis : la réouverture dépasse souvent 12 mois ;
  18 ou 24 mois protègent les dossiers complexes.
- **Franchise = délai de carence en jours, pas un montant** : les premiers
  jours d'arrêt ne sont jamais indemnisés (typiques 3, 5 ou 7 jours ;
  72 h = 3 jours). Sur une interruption de 10 jours avec 3 jours de
  carence, seuls 7 jours sont indemnisés.
- **Base d'indemnité** : la marge brute (chiffre d'affaires moins coûts
  variables) est la plus courante au Québec — c'est ce que l'entreprise
  perd réellement pendant l'arrêt ; la base change le calcul et donc le
  montant à assurer.
- **Les 4 avenants détaillés** : frais supplémentaires (continuer d'opérer
  — location temporaire, heures supplémentaires — code PE-FRAIS du
  catalogue commercial), dépendance aux fournisseurs (fournisseur ou
  donneur d'ordres critique — ex. : l'unique fournisseur de farine),
  accès civil (interdiction d'accès par les autorités — incendie voisin,
  ordre d'évacuation), détérioration des stocks (stocks réfrigérés —
  incontournable en restauration et agroalimentaire).
- **Question piège des interruptions non déclarées** : une interruption
  non déclarée — même sans réclamation à l'époque — peut invalider la
  couverture ; les incidents non réclamés comptent quand même ; un bris
  d'équipement répété peut imposer un plan de continuité d'affaires ou
  une franchise majorée.
- Valeurs CHECK documentées (`statut` : brouillon, soumise,
  convertie_police ; `base_valeur` : remplacement, depreciation ;
  `periode_indemnite_mois` : 12, 18, 24 ; `base_montant` :
  benefice_brut, marge_brute, chiffre_affaires ; clés des 4 avenants),
  types SQL et relations documentés sur toutes les colonnes pe,
  colonnes figées marquées `figee: true` (`statut`, `notes`,
  `date_effet_souhaitee`, `donnees`), unicités (UNIQUE) documentées,
  `pe_soumission_versions` déjà dans `regle_or` et ajouté dans
  `lib/contexte-ia.js` (ligne de la règle d'or).

Tests : `scripts/test-dictionnaire.js` 207 → **247/247 verts** (40 nouveaux
tests PE : domaine, versionnage, valeurs CHECK, 13 tests de descriptions
métier exposition/période/franchise/base/avenants/interruptions, marqueur
`figee`, règle d'or, 6 tests contexte IA, 5 tests page admin). Capture
vérifiée visuellement : `83-dictionnaire-pe.png` (section « Perte
d'exploitation », table `pe_garanties` — badge « versionnée », valeurs
CHECK `12 · 18 · 24` documentées).

### Perte d'exploitation — étape 5/10 : exports CSV/JSON

Miroir de l'étape 5/10 D&O : **3 nouveaux modules** dans `routes/exports.js`
→ **30 modules au total** (11 FPQ1 + 4 biens + 3 RC + 3 cyber + 3 E&O + 3
D&O + 3 PE).

- **`pe_etablissements`** : une ligne par établissement (soumission,
  entreprise, nom du lieu, adresse, occupation, chiffre d'affaires,
  superficie, année de construction, **base de valeur en libellé FR**
  — « Coût de remplacement » / « Valeur dépréciée » —, archivé).
- **`pe_soumissions`** : une ligne par soumission (id, entreprise, statut,
  date d'effet, version courante, nb établissements, nb versions, limite,
  **période d'indemnité en libellé** — « 12 mois » / « 18 mois » /
  « 24 mois » —, **franchise (jours)**, **base d'indemnité en libellé FR**
  — « Bénéfice brut » / « Marge brute » / « Chiffre d'affaires » (jamais
  les codes) —, prime, **4 avenants en colonnes 0/1** — frais
  supplémentaires, dépendance aux fournisseurs, accès civil, détérioration
  des stocks —, assureur actuel, **nb interruptions 5 ans** (calculé du
  JSON), interruptions 5 ans (JSON), consentements 0/1, archivé).
- **`pe_versions`** : une ligne par version figée (soumission, version,
  statut, auteur, date, snapshot JSON parsé `{etablissements, garanties,
  antecedents}`).

Conventions des autres modules : CSV séparateur `;` + BOM, en-têtes en
français du dictionnaire, périmètre par rôle (courtier = son portefeuille
uniquement), archivés exclus par défaut (case à cocher), aucun secret,
journal d'audit `export_*`. Comptes des modules 27→30 mis à jour dans
`scripts/test-exports-biens.js`, `scripts/test-exports-rc.js`,
`scripts/test-exports-cyber.js`, `scripts/test-exports-eo.js` et
`scripts/test-exports-do.js`.
Tests : `scripts/test-exports-pe.js` (**46 tests**, HTTP) — données créées
via les routes (`/pe`), chaque module en CSV (BOM, `;`, en-têtes FR, base
en libellé pas en code, colonnes avenants 0/1, « Nb interruptions 5 ans »)
et JSON (structure, garanties imbriquées, interruptions, consentements,
snapshot parsé), archivés exclus/inclus, périmètre courtier, aucun secret,
journal d'audit, 400 module inconnu, 403 sans CSRF. Capture :
`demo-captures/commercial/84-exports-pe.png`.

### Perte d'exploitation — étape 6/10 : import CSV en lot

Quatre nouveaux types dans `routes/import.js` (en-têtes en français, miroir
des exports PE de l'étape 5/10) :

- **`soumission_pe`** : création (entreprise, date d'effet AAAA-MM-JJ,
  statut brouillon/soumise/convertie_police, notes).
- **`etablissement_pe`** : rattachement par « Soumission (id) » ou
  « Entreprise », **nom du lieu ou adresse obligatoire**, occupation,
  chiffre d'affaires ≥ 0, superficie, année de construction, base de
  valeur (codes ou libellés FR « Coût de remplacement » / « Valeur
  dépréciée ») — établissements illimités.
- **`garanties_pe`** : limite, **période d'indemnité** (12/18/24 — nombres
  ou libellés « 12 mois » acceptés en miroir des exports), franchise
  (jours) ≥ 0, **base d'indemnité** (codes ou libellés FR « Bénéfice
  brut » / « Marge brute » / « Chiffre d'affaires »), 4 avenants 0/1
  (frais supplémentaires, dépendance aux fournisseurs, accès civil,
  détérioration des stocks), prime.
- **`antecedents_pe`** : assureur actuel, police, expiration, années
  continues, **interruptions 5 ans en lignes
  `AAAA-MM-JJ|cause|durée (jours)|montant`** (parseur miroir), consentements
  crédit/dossier d'assurance.

Modèles téléchargeables `/import/modele-pe/:type`, page `/import` — section
« 📉 Import perte d'exploitation ». Chaque ligne crée une version via
`lib/pe.js` (règle d'or : rien n'est écrasé) ; erreurs ligne par ligne avec
résumé. Fichier d'exemple : `scripts/exemple-import-pe.csv` (Boulangerie
Chaleur inc. — 4 lignes). **Round-trip export→import** vérifié : les
en-têtes des exports (avec le point final des libellés du dictionnaire et
les apostrophes courbes) sont reconnus à l'import. Bug trouvé et corrigé
en route : la base « Chiffre d'affaires » normalise en `chiffredaffaires`
(avec le « d » élidé) — les parseurs comparent désormais sur formes
normalisées sans ponctuation.
Tests : `scripts/test-import-pe.js` (**54 tests**, HTTP) — page + 4 modèles
(+ 404), exemple, vérification miroir via les exports (période « 12 mois »,
base « Marge brute » en libellé, avenants 1;0;0;1, 4 versions, nb
interruptions = 1), apostrophe courbe tolérée, 8 cas d'erreur (lieu sans
nom ni adresse, CA négatif, période invalide, base invalide, franchise
négative, date invalide, soumission introuvable, montant d'interruption
invalide), round-trip complet, règle d'or statique (zéro
`DELETE FROM pe_` dans routes/import.js et lib/pe.js), inter-cabinets,
portefeuille courtier (hors portefeuille rejeté, propres lignes OK),
journal d'audit. Capture :
`demo-captures/commercial/85-import-pe.png`.

### Perte d'exploitation — étape 7/10 : proposition PDF

Proposition d'assurance perte d'exploitation pré-remplie (HTML imprimable +
PDF téléchargeable), état courant ou version figée `?v=N` — miroir de l'étape
7/10 D&O :

- **`lib/proposition-pe.js`** : `preparerPropositionPe(cabinetId, soumission,
  vParam)` — proposant, **établissements illimités** (nom du lieu, adresse,
  occupation, CA, superficie, année de construction, base de valeur en
  libellé FR), garanties (limite, **période d'indemnité « 12 mois »**,
  **franchise « 3 jours »** (délai de carence), **base en libellé FR**
  « Bénéfice brut » / « Marge brute » / « Chiffre d’affaires » — jamais les
  codes —, avenants libellés, prime), antécédents (interruptions 5 ans —
  date, cause, durée en jours, montant —, consentements), n° de version.
  Lecture seule : ne modifie jamais la soumission.
- **`lib/proposition-pe-pdf.js`** (pdfkit) : PDF A4 FR — en-tête Cabinet +
  proposant, sections établissements/garanties/antécédents, **mention
  métier : « La période d’indemnité doit couvrir le retour complet à la
  normale — travaux, permis, équipements ; une période trop courte épuise
  la limite avant la reprise. La franchise est un délai de carence en
  jours : les premiers jours d’arrêt ne sont pas indemnisés. »**, pied
  « proposition conforme à la version N figée », signatures
  proposant/courtier.
- **Routes** `GET /pe/:id/proposition` (HTML) et `GET
  /pe/:id/proposition.pdf` (téléchargeable), audit `proposition_pe_generee`
  avec n° de version ; vue `views/pe/proposition.ejs` (CSS/JS externes
  `/proposition.css` + `/proposition.js`, CSP : aucun inline).
- **Bouton « 📄 Proposition » dégrisé** sur la fiche PE (était grisé
  « (bientôt) » depuis l'étape 2/10).
Tests : `scripts/test-proposition-pe-pdf.js` (**40 tests**, HTTP) — état
courant (établissements, CA/superficie, base de valeur, limite, période,
franchise jours, base « Marge brute », mention métier, avenants, prime,
interruptions, consentements, boutons, CSP), version figée `?v=1` (données
d'époque : aucun établissement), `?v=999` → 404, PDF (content-type, `%PDF`,
établissement, mention métier, taille), sécurité (inter-cabinets 404,
courtier hors portefeuille 403, sans login 302), audit avec version, aucune
fuite inter-cabinets. Capture :
`demo-captures/commercial/86-proposition-pe.png`.

### Perte d'exploitation — étape 8/10 : commandes texte IA

3 actions de modification PE dans `lib/commandes-ia.js` (miroir de l'étape
8/10 D&O), pilotables depuis l'assistant (« 💬 Assistant IA »), **confirmation
explicite obligatoire** avant toute exécution :

- **`ajouter_etablissement_pe`** : « ajoute l’établissement Entrepôt
  occupation entreposage avec 300 000 $ de chiffre d’affaires à la
  soumission perte d’exploitation 1 » — champs : nom du lieu, adresse,
  occupation, chiffre d’affaires (forme « avec 750 000 $ de chiffre
  d’affaires » reconnue), superficie, année de construction, base de valeur
  (coût de remplacement / valeur dépréciée) ; référence par n° (« soumission
  perte d’exploitation 2 », « soumission PE 2 », « soumission interruption
  des affaires 2 ») ou par entreprise (« …de Boulangerie Chaleur »).
- **`modifier_garanties_pe`** : « mets la période d’indemnité à 18 mois, la
  franchise à 5 jours et ajoute l’avenant accès civil pour la soumission
  perte d’exploitation 1 » — limite, période 12/18/24, **franchise en
  jours** (« délai de carence » reconnu), base (bénéfice brut / marge brute
  / chiffre d’affaires), prime, **avenants ajout ET retrait**
  (frais_supplementaires, dependance_fournisseurs, acces_civil,
  deterioration_stocks) ; résumé avant/après affiché à la confirmation
  (« période d’indemnité : 12 mois → 18 mois », « avenant accès civil :
  absent → ajouté »).
- **`modifier_etablissement_pe`** : « change l’occupation de l’établissement
  Fournil de la soumission perte d’exploitation 1 à commerce de détail » —
  nom, occupation, chiffre d’affaires, superficie, année de construction,
  base de valeur ; établissement résolu par nom, adresse ou n°.
- **Routage 7 produits** : marqueurs « perte d’exploitation »,
  « interruption des affaires », « établissement », « période d’indemnité »,
  « délai de carence » ; une commande sans marqueur PE explicite ne
  déclenche aucune action PE ; une commande PE explicite n’est captée par
  aucun autre produit (gardes bidirectionnelles FPQ1/biens/RC/cyber/E&O/D&O
  ↔ PE : « ajoute le lieu X à la soumission RC 1 » reste RC, « ajoute le
  bâtiment X à la soumission biens 1 » reste biens).
- **Navigation** : « montre-moi la soumission perte d’exploitation 1 »
  → `/pe/1`, « ouvre la perte d’exploitation » → `/pe`.
- **ACTIONS_CONFIRMABLES** (`lib/assistant.js`) : les 3 actions y sont
  déclarées ; sans confirmation, rien n’est exécuté ; audit `commande_ia` ;
  règle d’or (zéro `DELETE FROM pe_`) ; cloisonnement cabinet + périmètre
  courtier appliqués.
Tests : `scripts/test-commandes-pe.js` (**67 tests**, HTTP) — analyseur
local (cas nominaux + anti-collisions bidirectionnelles ×7 produits),
confirmation requise, fusion garanties, ajout ET retrait d’avenants,
ambiguïté → aucune action, hors portefeuille 403, inter-cabinets 404, CSRF
403, audit, règle d’or. Capture :
`demo-captures/commercial/87-commandes-ia-pe.png`.

### Perte d'exploitation — étape 9/10 : dictée vocale (voix)

`normaliserDictee()` (`public/dictee.js`) étendu au vocabulaire PE (miroir
de l'étape 9/10 D&O) :

- **Références** : « à la soumission perte d’exploitation un » →
  « à la soumission perte d’exploitation 1 » ; « à la soumission PE un » →
  « PE 1 » ; « l’établissement deux » → « l’établissement 2 » (index
  d’établissement — jamais confondu avec « le lieu » RC ni « le bâtiment »
  biens, anti-collision vérifiée).
- **Période d’indemnité** : « période d’indemnité à dix-huit mois » →
  « 18 mois » (unité conservée, l’analyseur exige 12/18/24, dans le
  contexte indemnité/période uniquement).
- **Franchise / carence** : « franchise à cinq jours » → « 5 jours »,
  « délai de carence de huit jours » → « de 8 jours » (unité conservée,
  l’analyseur exige « <chiffre> jours »).
- **Élision** : « perte d exploitation » → « perte d’exploitation »,
  « d indemnité » → « d’indemnité », « d affaires » → « d’affaires » (la
  dictée sépare parfois le « d’ », le marqueur PE exige l’apostrophe).
- **Montants** : règles existantes réutilisées (« cent quatre-vingt mille
  dollars de chiffre d’affaires » → 180000, « deux millions » → 2000000).
- **Correction d’un bug de l’étape 8 en route** : le garde-fou `\b...\b`
  des mots-clés de `analyserModifierGarantiesPE` ne matchait jamais après
  « indemnité » (JavaScript ne considère pas « é » comme un caractère de
  mot) — « mets la période d’indemnité à 18 mois » seul était rejeté ;
  remplacé par un lookahead négatif `(?![\wÀ-ÿ])`, à comportement égal
  ailleurs.
- **Pipeline vérifié** : « ajoute l’établissement Entrepôt à la soumission
  perte d’exploitation un » → normalisé → confirmation
  `ajouter_etablissement_pe` → établissement créé + version figée (règle
  d’or). Bouton 🎤 déjà présent sur le chat de l’assistant ; **jamais
  d’envoi automatique** — la dictée remplit le champ, l’utilisateur
  confirme.

Tests : `scripts/test-voix.js` — 141 → **168 tests** (14 nouvelles règles
PE + 13 tests de pipeline PE, non-régression des règles
FPQ1/biens/RC/cyber/E&O/D&O).
Capture : `demo-captures/commercial/88-voix-pe.png`.

**Balayage complet : 58 suites, 3345/3345 tests verts, zéro échec**
(3318 de l'étape 8 + 27 nouveaux tests voix PE ; chaque suite sur base
fraîche, une à la fois ; suites modèle SANS serveur, suites HTTP avec
`CHEMIN_BD` identique serveur+script ; `test-phase1.js` exclue —
obsolète). Preuve : `~/workspace/balayage-pe9.log`. Règle d'or
re-vérifiée : zéro `DELETE FROM pe_` / `DROP TABLE pe_` dans `lib/`,
`routes/`, `public/`, `views/`.

### Perte d'exploitation — étape 10/10 : final (balayage complet)

Balayage final du module Perte d'exploitation (2026-10-20) : toutes les
suites exécutées une par une sur bases fraîches (serveur tué + base
supprimée entre chaque ; suites modèle avec `CHEMIN_BD` seul, sans
serveur ; suites HTTP avec `CHEMIN_BD` identique sur serveur ET script ;
ne jamais sonder `/connexion` avant une suite — rate-limit
20 logins/15 min ; `test-phase1.js` exclue — obsolète ; logs de balayage
sous `~/workspace/`, pas `/tmp` — un redémarrage de service vide `/tmp`
en cours de route). Preuve : `~/workspace/balayage-pe10.log`
(58 lignes `exit=0` + annexe des comptes détaillés ;
`~/workspace/balayage-pe10-details/` conserve les 29 sorties complètes
dont la ligne résumé du log ne captait pas le total ; aucune suite
n'a échoué).

**Résultat : 58 suites, 3345/3345 tests verts, zéro échec.**

| Suite | Tests |
|---|---|
| test-dictionnaire.js (auto + biens + RC + cyber + E&O + D&O + PE, 65 tables, 729 colonnes) | 247 |
| test-voix.js (FPQ1 + biens + RC + cyber + E&O + D&O + PE) | 168 |
| test-principes.js (règle d'or) | 112 |
| test-pe-etape2.js (questionnaire PE) | 89 |
| test-do-etape2.js (questionnaire D&O) | 83 |
| test-eo-etape2.js (questionnaire E&O) | 83 |
| test-biens-etape2.js (questionnaire biens) | 74 |
| test-cyber-etape2.js (questionnaire cyber) | 71 |
| test-rc-etape2.js (questionnaire RC) | 70 |
| test-commandes-do.js (commandes IA D&O) | 70 |
| test-commandes-pe.js (commandes IA perte d'exploitation) | 67 |
| test-nouveaux-modules.js | 65 |
| test-commandes-eo.js | 62 |
| test-fpq1-etape2.js | 62 |
| test-demandes-2026-10-09.js | 57 |
| test-commandes-cyber.js | 57 |
| test-biens-etape1.js (modèle biens) | 57 |
| test-eo-etape3.js (police E&O) | 56 |
| test-do-etape3.js (police D&O) | 56 |
| test-pe-etape3.js (fiche police PE) | 56 |
| test-exports.js | 55 |
| test-cyber-etape3.js (police cyber) | 55 |
| test-import-pe.js (import PE) | 54 |
| test-rc-etape3.js (police RC) | 54 |
| test-fpq1-etape1.js (modèle auto) | 53 |
| test-fpq1-etape3.js | 52 |
| test-biens-etape3.js (police biens) | 52 |
| test-import-do.js | 50 |
| test-import-eo.js | 49 |
| test-commandes-ia.js (auto) | 48 |
| test-commandes-rc.js | 48 |
| test-rc-etape1.js (modèle RC) | 48 |
| test-ajustements.js | 48 |
| test-droits-2026-10-09.js | 48 |
| test-commandes-biens.js | 47 |
| test-assureurs.js | 47 |
| test-pe-etape1.js (modèle PE) | 47 |
| test-cyber-etape1.js | 47 |
| test-eo-etape1.js (modèle E&O) | 47 |
| test-do-etape1.js (modèle D&O) | 47 |
| test-exports-pe.js (exports PE) | 46 |
| test-exports-eo.js | 45 |
| test-exports-do.js | 45 |
| test-exports-biens.js | 44 |
| test-exports-cyber.js | 43 |
| test-exports-rc.js | 41 |
| test-proposition-pe-pdf.js (proposition PE HTML + PDF) | 40 |
| test-proposition-eo-pdf.js | 39 |
| test-proposition-do-pdf.js | 39 |
| test-courriels.js | 37 |
| test-import-biens.js | 36 |
| test-import-cyber.js | 36 |
| test-proposition-cyber-pdf.js | 34 |
| test-proposition-biens-pdf.js | 33 |
| test-import-auto.js | 33 |
| test-import-rc.js | 33 |
| test-proposition-rc-pdf.js | 32 |
| test-proposition-pdf.js | 31 |

Règle d'or re-vérifiée (statique) : `grep -rn "DELETE FROM pe_" lib/
routes/ public/ views/` → vide (les occurrences dans `scripts/` sont les
vérifications statiques elles-mêmes : `test-pe-etape1.js`,
`test-pe-etape3.js`, `test-import-pe.js`, `test-commandes-pe.js`) ;
aucun `DROP TABLE pe_` ; aucune route DELETE sur `/pe` (`routes/pe.js`
ne contient aucune route `delete`/`supprimer`) ; aucun bouton
« supprimer » dans `views/pe/` (archivage doux partout ; chaque mutation
PE crée une version figée — les 47 tests `test-pe-etape1.js` l'exigent).

Captures 80-88 revues (présentes dans `demo-captures/commercial/`,
visuellement propres — navigation cohérente, aucun texte coupé, aucun
404 visible) : `80-pe-liste.png` (liste des soumissions perte
d'exploitation avec filtre de statut), `81-pe-fiche.png` (fiche soumission
#1 : établissements assurés, garanties — période d'indemnité, franchise en
jours, avenants —, antécédents, historique des versions), `82-police-pe.png`
(fiche police avec bloc « 📉 Données perte d'exploitation » figé à la
conversion + protections recommandées manquantes), `83-dictionnaire-pe.png`
(dictionnaire enrichi, section « Perte d'exploitation »),
`84-exports-pe.png` (page Exports avec les 3 modules PE : établissements,
soumissions, versions), `85-import-pe.png` (page Import PE : 4 types
`soumission_pe`, `etablissement_pe`, `garanties_pe`, `antecedents_pe`),
`86-proposition-pe.png` (proposition HTML imprimable : établissements,
garanties demandées, antécédents, consentements, signatures),
`87-commandes-ia-pe.png` (commande IA texte → confirmation avant ajout
d'établissement), `88-voix-pe.png` (dictée vocale → texte normalisé prêt
à envoyer).

ZIP final : `~/workspace/your_files/courtier-pe-final.zip` (13,3 Mo,
327 fichiers, préfixe `courtier-app/`, captures 80-88 incluses, sans
`courtier.db*`/`.env`/`node_modules`/`.git`).

### Flotte automobile — étape 1/10 : couche données (sans interface)

Couche d'accès `lib/flotte.js` (miroir de `lib/pe.js`) pour les soumissions
**flotte automobile** (véhicules et conducteurs en nombre illimité) :

- **6 tables `flotte_*`** : `flotte_soumissions` (en-tête : entreprise,
  assureur, n° de police si connu, responsable, nombre de véhicules déclaré,
  rayon d'opération, usage dominant — CHECK `livraison` / `service` /
  `transport_marchandises` / `personnel` / `mixte` —, dates d'effet
  souhaitée et d'échéance visée),
  `flotte_vehicules` (**illimités** : NIV, année/marque/modèle, type —
  CHECK `camion` / `automobile` / `remorque` / `equipement` —, usage, rayon,
  lieu de remisage, valeur, année d'acquisition, conducteur principal lié à
  une fiche conducteur **ou** en nom libre, équipements spéciaux JSON),
  `flotte_conducteurs` (**illimités** : nom/prénom, date de naissance ou âge,
  n° et classe de permis, années d'expérience + véhicules lourds, date
  d'embauche, sinistres 5 ans / infractions 3 ans / formations en JSON),
  `flotte_garanties` (UNIQUE par soumission : limite de responsabilité
  civile, franchises collision et versement, avenants FAQ en clés courtes
  `faq43` / `faq20` / `faq27` / `faq34` / `faq5a`, prime),
  `flotte_antecedents` (assureur actuel, années d'assurance flotte continue,
  sinistres de la flotte 5 ans JSON, ratio de pertes, refus/annulation,
  consentements dont le dossier SAAQ),
  `flotte_soumission_versions` (snapshot figé `{vehicules, conducteurs,
  garanties, antecedents}` à **chaque** mutation — règle d'or : aucune
  suppression).
- Validations métier en couche (types et usages fermés, montants ≥ 0, nom
  et prénom du conducteur requis), audit `flotte_%` sur chaque écriture,
  cloisonnement inter-cabinets.
- Démo : **Transport Lapointe inc.** (Laval — 4 véhicules : 2 camions de
  livraison, 1 automobile de service, 1 remorque ; 3 conducteurs ; RC 2 M$,
  collision 1 000 $, FAQ43 valeur à neuf sur les camions ; 1 sinistre
  flotte 2023).

Tests : `scripts/test-flotte-etape1.js` (70 tests, sans serveur).

### Flotte automobile — étape 2/10 : questionnaire de soumission (interface)

Nouvel onglet **« Flotte »** (`/flotte`), juste après « Perte
d'exploitation », miroir du questionnaire Perte d'exploitation : liste des
soumissions (filtre par statut, « Voir les archivées », colonnes
entreprise/statut/effet souhaité/véhicules/conducteurs/limite RC), création
(en-tête complet), puis **fiche soumission** en sections :

- **En-tête modifiable** (entreprise cliente, assureur, n° de police si
  connu, nombre de véhicules déclarés, rayon d'opération principal, usage
  dominant, dates d'effet souhaitée et d'échéance visée, notes) — chaque
  modification fige une nouvelle version via `lib/flotte.js`.
- **Véhicules (illimités)** : formulaire d'ajout (NIV, année/marque/modèle,
  type camion/automobile/remorque/équipement, usage, rayon, lieu de
  remisage, valeur, année d'acquisition, conducteur principal — fiche
  conducteur liée **ou** nom libre —, équipements spéciaux via textarea,
  un par ligne `description | valeur $`) + liste avec **modifier** et
  archiver/désarchiver.
- **Conducteurs (illimités)** : formulaire d'ajout (nom/prénom, date de
  naissance ou âge, n° de permis, classe de permis, années d'expérience et
  d'expérience véhicules lourds, date d'embauche, sinistres 5 ans, infractions
  3 ans et formations via textareas, un par ligne au format
  `date | description | …` — parsés en JSON) + liste avec **modifier** et
  archiver/désarchiver.
- **Garanties par soumission** : limite de responsabilité civile, franchises
  collision et versement, avenants FAQ en cases à cocher (FAQ43 valeur à
  neuf, FAQ20 privation de jouissance, FAQ27 véhicule loué ou n'appartenant
  pas à l'assuré, FAQ34 indemnités d'accident, FAQ5a crédit-bail), prime.
- **Antécédents** : assureur actuel, années d'assurance flotte continue,
  **sinistres de la flotte des 5 dernières années via textarea** (un par
  ligne, format `AAAA-MM-JJ | description | montant` — parsé en JSON
  `{date, description, montant}`), ratio de pertes, refus ou annulation
  par un assureur (case + détails), consentements (dossier de crédit,
  **dossier SAAQ**, FCSA).
- **Historique des versions** en lecture seule (`/flotte/:id/versions/:v`).

Cloisonnement par cabinet et par rôle comme les autres modules (le courtier
ne voit et ne modifie que son portefeuille, 403 sinon). La conversion en
police arrivera à l'étape 3/10. Les 6 tables `flotte_*` sont aussi
documentées dans `lib/dictionnaire-champs.json` (nouveau domaine
« flotte » — dictionnaire total : **71 tables, 814 colonnes**, vérifié par
`scripts/generer-dictionnaire.js`).

Tests : `scripts/test-flotte-etape2.js` (**129 tests**, HTTP) — création
(400 sans client / client invalide / date invalide / usage dominant
invalide, en-tête complet stocké), fiche et ses sections, conducteurs
illimités (sinistres/infractions/formations parsés en nombres, modification,
archivage/restauration, nom requis), véhicules illimités (dont une
remorque ; conducteur principal lié par id et en nom libre ; équipements
spéciaux parsés ; type invalide et valeur négative rejetés ; modification,
archivage/restauration), garanties (avenants FAQ cochés, franchise négative
rejetée, mise à jour sans doublon), antécédents (textarea parsé en nombres,
ratio de pertes, refus, consentement dossier SAAQ), en-tête modifiable
(version créée, usage invalide rejeté), statuts, versions figées (v1 vide,
dernière version complète), archivage de la soumission, portefeuille
courtier (403 sur fiche et sur les mutations véhicule/conducteur/garanties,
400 à la création), inter-cabinets (404), CSRF (403), journal d'audit
`flotte_%`, règle d'or (zéro `DELETE FROM flotte_*` en dur, aucune route
DELETE, aucun bouton « supprimer » dans `views/flotte/`).

Captures : `demo-captures/commercial/` (`89-flotte-liste.png` — liste avec
la démo Transport Lapointe, onglet après Perte d'exploitation ;
`90-flotte-fiche.png` — fiche complète : 4 véhicules, 3 conducteurs,
avenants FAQ, antécédents avec sinistre 2023, versions) — **à produire via
le navigateur** (le rendu headless local est bloqué par la porte « Local
Network Access » de Chrome 152 sur les URL loopback ; voir le résumé de
livraison de l'étape).

### Flotte automobile — étape 3/10 : fiche police (gestion)

Miroir de l'étape 3/10 Perte d'exploitation, appliqué à la flotte
automobile :

- **Conversion soumission → police** : bouton « 🏛️ Convertir en police »
  sur la fiche soumission (ou liaison d'une police flotte existante de la
  même entreprise). La police est créée avec `ligne = 'flotte'` et liée par
  les nouvelles colonnes `polices.flotte_soumission_id` +
  `polices.flotte_soumission_version` (**UNIQUE**, migration par
  reconstruction de la table dans `lib/bd.js`, mêmes conventions que PE) ;
  la soumission passe au statut `convertie_police` et la police naît en
  version 1. La version de conversion est **figée et immuable** : modifier
  la soumission ensuite crée de nouvelles versions de la soumission, jamais
  un nouveau snapshot pour la police.
- **Bloc « 🚚 Données flotte automobile »** sur la fiche de gestion de la
  police (`/echeances/police/:id`) : en-tête figé (nombre de véhicules
  déclarés, rayon d'opération, usage dominant — l'en-tête fait désormais
  partie du snapshot `flotte_soumission_versions`), véhicules figés avec
  valeur et conducteur principal, conducteurs figés, garanties figées
  (limite RC, franchises collision/versement, **avenants FAQ cochés**,
  prime) et antécédents figés (sinistres de la flotte des 5 ans, ratio de
  pertes), avec lien « voir le snapshot ».
- **Avenants en cours de terme** : chaque mutation de la soumission
  convertie (en-tête, véhicule ajouté/modifié/archivé/désarchivé,
  conducteur ajouté/modifié/archivé/désarchivé, garanties, antécédents,
  statut, archivage) crée automatiquement une **nouvelle version de la
  police avec note d'avenant** — jamais de modification silencieuse
  (règle d'or).
- **Avenants FAQ usuels non souscrits** : le bloc signale les avenants FAQ
  absents du snapshot figé — **FAQ 34** (indemnités d'accident) quand des
  conducteurs sont au dossier, **FAQ 43** (valeur à neuf) quand un
  camion/automobile récent (≤ 3 ans) est assuré sans elle, **FAQ 20**
  (privation de jouissance) quand la flotte roule sans véhicule de
  remplacement, **FAQ 27** quand des véhicules sont conduits « selon
  affectation ». Les protections recommandées du catalogue (`FLT-RC`,
  `FLT-VN`) continuent d'être signalées comme pour les autres produits.
- Dictionnaire : les 6 tables `flotte_*` étaient déjà documentées depuis
  l'étape 1/10 ; l'étape 3 ajoute les colonnes `flotte_soumission_id` et
  `flotte_soumission_version` à l'entrée `polices` de
  `lib/dictionnaire-champs.json` (total : **71 tables, 816 colonnes**,
  vérifié par `scripts/generer-dictionnaire.js` et
  `scripts/test-dictionnaire.js`).
- Correction au passage : la fiche police (`routes/echeances.js`)
  vérifiait le portefeuille courtier sur `fiche.client_id` (toujours vide)
  au lieu de `fiche.police.client_id` — le contrôle 403 du courtier sur
  les polices hors portefeuille est maintenant effectif pour **tous** les
  produits.

Tests : `scripts/test-flotte-etape3.js` (**77 tests**, HTTP) — colonnes et
UNIQUE en base, soumission complète (2 véhicules, 2 conducteurs, garanties
FAQ43 seul), conversion (CSRF 403, 302, liaison et version figée en base,
statut, police v1, audits), fiche police (bloc figé complet, alertes
FAQ 34/FAQ 20 présentes, FAQ 43 présent non signalé), avenant (véhicule
ajouté → police v2 avec note, garanties modifiées → v3), **snapshot
immuable** (version figée inchangée, véhicule d'avenant absent de la
fiche, limite RC d'origine conservée), double conversion 400, liaison
d'une police existante (et refus : mauvaise ligne 400, déjà liée 400),
cloisonnement inter-cabinets (404), portefeuille courtier (403 sur la
soumission **et** sur la fiche police, conversion dans son portefeuille),
audit, règle d'or statique (aucun `DELETE FROM flotte_*`, aucune route
DELETE, aucun bouton « supprimer » dans les vues modifiées).
Non-régression : `test-flotte-etape2.js` **129/129**, `test-flotte-etape1.js`
**70/70**, `test-pe-etape3.js` **56/56**.

Capture : `demo-captures/commercial/91-police-flotte.png` — fiche police
avec le bloc « 🚚 Données flotte automobile » — **à produire via le
navigateur principal** (le rendu headless local est bloqué par la porte
« Local Network Access » de Chrome sur les URL loopback, DOM vide
confirmé). Conditions exactes : démarrer le serveur sur une base fraîche
(le seed crée la soumission démo « Transport Lapointe inc. »), se
connecter sur `/connexion` avec `admin@demo.ca` (champs `#email` / `#mdp`,
mot de passe de démonstration puis changement forcé), ouvrir
`/flotte/:id` de la soumission Transport Lapointe, la convertir via la
carte « 🏛️ Convertir en police », puis photographier la fiche
`/echeances/police/:id` obtenue, bloc « 🚚 Données flotte automobile »
visible.

Reste pour l'étape 4/10 : dictionnaire IA enrichi flotte (contexte et
commandes IA du domaine « flotte », comme les étapes 4 des autres
produits).

### Flotte automobile — étape 4/10 : dictionnaire IA enrichi

Enrichissement du domaine « flotte » dans `lib/dictionnaire-champs.json`
avec des descriptions métier utiles à la tarification flotte (miroir de
l'étape 4/10 Perte d'exploitation — domaine « flotte » uniquement,
round-trip JSON fidèle, vérificateur vert : **71 tables, 816 colonnes**) :

- **Exposition = somme des valeurs des véhicules + profil des
  conducteurs** : les conducteurs sont l'exposition principale en flotte
  (expérience, sinistres, infractions, dossier SAAQ) — un conducteur à
  sinistres répétés fait grimper la prime de toute la flotte ; les
  garanties se définissent **à la police** (à la flotte entière), pas par
  véhicule.
- **NIV = identifiant tarifaire clé** : il décode année, marque, modèle
  et groupe de tarification et permet les vérifications SAAQ et FCSA ;
  le **rayon d'opération** et l'**usage** (par véhicule et dominant) sont
  des facteurs de prime majeurs ; les classes de permis SAAQ (1, 3, 5)
  et l'expérience véhicules lourds sont documentées.
- **Avenants FAQ détaillés** : FAQ 43 valeur à neuf (pertinente pour les
  véhicules récents), FAQ 20 privation de jouissance et FAQ 27 véhicule
  n'appartenant pas à l'assuré (fréquents en flotte de service), FAQ 34
  indemnités d'accident, FAQ 5a crédit-bail ; **RC usuelle 1 à 2 M$**
  (2 M$ courant en transport, souvent exigé par les donneurs d'ordres).
- **Antécédents = sinistralité** : sinistres de la flotte des 5 ans
  (claims) et **ratio de pertes** lus ensemble ; les incidents non
  réclamés comptent quand même.
- **Questions pièges documentées** : conducteurs non déclarés (un
  conducteur régulier sans fiche n'est pas couvert) et usage réel
  différent de l'usage déclaré (livraison déclarée en service).
- Valeurs CHECK documentées (`statut` : brouillon, soumise,
  convertie_police ; `usage_dominant` : livraison, service,
  transport_marchandises, personnel, mixte ; `type_vehicule` : camion,
  automobile, remorque, equipement ; `usage` véhicule ; clés des 5
  avenants FAQ), types SQL et relations sur toutes les colonnes flotte,
  colonnes figées marquées `figee: true` (`statut`, `notes`,
  `date_effet_souhaitee`, `donnees` de `flotte_soumission_versions`),
  unicités (UNIQUE) documentées — garanties et antécédents par
  soumission, liaison `polices.flotte_soumission_id` —,
  `flotte_soumission_versions` déjà dans `regle_or` et dans
  `lib/contexte-ia.js` (ligne de la règle d'or) : le contexte IA expose
  les tables flotte, leurs valeurs et l'exposition à l'assistant.
  Aucune description « undefined » sur les colonnes flotte (apostrophe
  droite partout dans les descriptions enrichies).

Tests : `scripts/test-dictionnaire.js` → **304/304 verts** (58 nouveaux
tests flotte : domaine, versionnage, valeurs CHECK, descriptions métier
exposition/NIV/rayon/usage/FAQ/ratio/pièges, marqueur `figee`, règle
d'or, aucun « undefined », 9 tests contexte IA, 7 tests page admin).
Non-régression : `test-flotte-etape3.js` **77/77**. Capture vérifiée
visuellement : `demo-captures/commercial/92-dictionnaire-flotte.png`
(section « Flotte automobile », table `flotte_soumissions` — badge
« versionnée », description d'exposition enrichie ; rendue avec
Chromium headless + playwright-core, base fraîche, login
`admin@demo.ca` sur `/connexion` champs `#email` / `#mdp`, changement
de mot de passe forcé via le formulaire contenant `#actuel` — le
premier `button[type=submit]` de la page est le bouton Déconnexion de
l'en-tête).

### Flotte automobile — étape 5/10 : exports CSV/JSON

Miroir de l'étape 5/10 Perte d'exploitation : **3 nouveaux modules** dans
`routes/exports.js` → **33 modules au total** (11 FPQ1 + 4 biens + 3 RC +
3 cyber + 3 E&O + 3 D&O + 3 PE + 3 flotte).

Choix des 3 modules : les deux collections illimitées de la flotte ont
chacune leur module plat — `flotte_vehicules` et `flotte_conducteurs`
(miroir de `biens_batiments` + `biens_contenus`) — et l'historique figé est
exporté **dans `flotte_soumissions`** (versions imbriquées en JSON, comme
le module `polices` imbrique ses versions ; le CSV porte `version_courante`
et `nb_versions`). Aucune donnée n'est perdue et le total reste à +3
comme PE.

- **`flotte_vehicules`** : une ligne par véhicule (soumission, entreprise,
  NIV, année, marque, modèle, **type en libellé FR** — « Camion »,
  « Automobile », « Remorque », « Équipement » —, **usage en libellé FR**
  — « Livraison », « Service », « Transport de marchandises »,
  « Personnel » —, rayon d'opération, lieu de remisage, valeur, année
  d'acquisition, **conducteur principal** — nom de la fiche liée ou nom
  libre —, équipements spéciaux (JSON), archivé).
- **`flotte_conducteurs`** : une ligne par conducteur (soumission,
  entreprise, nom, prénom, date de naissance, âge, N° de permis, classe de
  permis, années d'expérience — dont véhicules lourds —, date d'embauche,
  **nb sinistres 5 ans** et **nb infractions 3 ans calculés depuis le
  JSON**, sinistres / infractions / formations en JSON, archivé).
- **`flotte_soumissions`** : une ligne par soumission (id, entreprise,
  statut et **usage dominant en libellés FR** — jamais les codes —,
  assureur, N° de police, dates visées, version courante, nb versions,
  rayon, **nb véhicules déclaré vs nb véhicules réel compté**, nb
  conducteurs, **somme des valeurs des véhicules**, garanties — limite RC,
  franchises collision / versement, prime, **5 avenants FAQ en colonnes
  0/1** (FAQ 43 valeur à neuf, FAQ 20, FAQ 27, FAQ 34, FAQ 5a) —,
  antécédents — assureur actuel, **années d'assurance flotte continue**,
  **nb sinistres flotte 5 ans calculé**, ratio de pertes, refus/annulation
  antérieur, consentements crédit / dossier SAAQ / FCSA en 0/1 —,
  archivé). En JSON : garanties imbriquées, sinistres parsés,
  consentements et **versions figées imbriquées** (snapshot complet
  `{entete, vehicules, conducteurs, garanties, antecedents}` parsé).

Conventions des autres modules : CSV séparateur `;` + BOM UTF-8, en-têtes
en français, périmètre par rôle (courtier = son portefeuille uniquement,
`clausePortefeuille` sur l'entreprise partout), archivés exclus par défaut
(case à cocher), aucun secret, journal d'audit `export_*`. **Règle d'or :
exports en lecture seule** — le test vérifie qu'aucune ligne flotte n'est
créée, archivée ou supprimée par un export. Comptes des modules 30→33 mis
à jour dans `scripts/test-exports-biens.js`, `scripts/test-exports-rc.js`,
`scripts/test-exports-cyber.js`, `scripts/test-exports-eo.js`,
`scripts/test-exports-do.js` et `scripts/test-exports-pe.js`.
Tests : `scripts/test-exports-flotte.js` (**60 tests**, HTTP) — données
créées via les routes (`/flotte`) + seed « Transport Lapointe inc. »
vérifié (4 véhicules, 3 conducteurs, somme des valeurs 155 500 $,
conducteur principal lié et en nom libre, Gagnon 1 sinistre / 1
infraction), chaque module en CSV (BOM, `;`, en-têtes FR, libellés FR pas
les codes, colonnes avenants 0/1, décomptes calculés) et JSON (structure,
garanties imbriquées, versions figées imbriquées, somme des valeurs),
archivés exclus/inclus, périmètre courtier, aucun secret, lecture seule,
journal d'audit, 400 module inconnu, 403 sans CSRF. Non-régression :
`test-exports-pe.js` **46/46**, `test-flotte-etape3.js` **77/77**.
Capture vérifiée visuellement :
`demo-captures/commercial/93-exports-flotte.png` (page `/exports`, les 3
modules flotte visibles dans le tableau des modules ; rendue avec
Chromium headless + playwright-core, base fraîche, login `admin@demo.ca`,
changement de mot de passe forcé via `form:has(#actuel)`).

### Flotte automobile — étape 6/10 : import CSV en lot

**Cinq** nouveaux types dans `routes/import.js` (en-têtes en français,
miroir des exports flotte de l'étape 5/10). Choix des types : le pattern PE
compte 4 types parce que PE n'a qu'**une** ligne illimitée (établissements) ;
la flotte en a **deux** — véhicules ET conducteurs — chacune avec son type,
plus soumission / garanties / antécédents calqués sur PE, soit 5 types :

- **`soumission_flotte`** : création (entreprise, dates d'effet et
  d'échéance visée AAAA-MM-JJ, statut brouillon/soumise/convertie_police,
  **usage dominant** — codes ou libellés FR, ex. « Transport de
  marchandises » —, rayon d'opération, nb véhicules déclarés, assureur,
  N° de police, notes).
- **`vehicule_flotte`** : rattachement par « Soumission (id) » ou
  « Entreprise », marque et modèle requis, NIV, année, **type de véhicule**
  (codes ou libellés FR « Camion » / « Automobile » / « Remorque » /
  « Équipement »), **usage** (codes ou libellés FR), rayon, lieu de
  remisage, valeur ≥ 0, année d'acquisition, **conducteur principal**
  (fiche liée si le nom correspond à un conducteur de la soumission, nom
  libre sinon), **équipements spéciaux** (format pipe
  `description|valeur` ou le JSON des exports) — véhicules illimités.
- **`conducteur_flotte`** : **nom et prénom requis**, date de naissance,
  âge, N° et classe de permis, années d'expérience (dont véhicules
  lourds), date d'embauche, **sinistres 5 ans** en lignes
  `AAAA-MM-JJ|description|montant` (+ `|responsabilité` optionnel),
  **infractions 3 ans** en lignes `AAAA-MM-JJ|description|points`,
  **formations** en lignes `formation|AAAA-MM-JJ|organisme` — conducteurs
  illimités.
- **`garanties_flotte`** : limite RC, franchises collision / versement,
  prime, **avenants FAQ** par colonnes 0/1 (FAQ 43/20/27/34/5a — mêmes
  en-têtes que FPQ1) **ou** par libellés dans la colonne « Avenants »
  (ex. `valeur à neuf, FAQ 20, crédit-bail` → faq43/faq20/faq5a).
- **`antecedents_flotte`** : assureur actuel, police, expiration, années
  d'assurance flotte continue, **sinistres flotte 5 ans** en lignes
  `AAAA-MM-JJ|description|montant`, ratio de pertes, refus/annulation
  antérieur + détails, consentements crédit / dossier SAAQ / FCSA.

Modèles téléchargeables `/import/modele-flotte/:type`, page `/import` —
section « 🚚 Import flotte automobile ». Chaque ligne crée une version via
`lib/flotte.js` (règle d'or : rien n'est écrasé, aucune suppression) ;
rattachement par cabinet/portefeuille (un courtier n'importe que dans son
périmètre), erreurs ligne par ligne rapportées, jamais d'import partiel
silencieux. Fichier d'exemple : `scripts/exemple-import-flotte.csv`
(Transport Lapointe inc. — 5 lignes). **Round-trip export→import** vérifié :
les en-têtes des 3 modules flotte de l'étape 5 et leurs libellés FR (types,
usages, équipements en JSON, avenants FAQ) sont reconnus à l'import ;
l'en-tête « NIV » transite par la clé FPQ1 `vin` (documenté dans le code).
Tests : `scripts/test-import-flotte.js` (**63 tests**, HTTP) — page + 5
modèles (+ 404), exemple (5 lignes, 0 erreur), vérification miroir via les
exports (conducteur principal lié, sinistres/infractions décomptés,
avenants 1;1;1;1;0, 5 versions, ratio de pertes), apostrophe courbe
tolérée, avenants par libellés FR, 8 cas d'erreur (conducteur sans nom,
véhicule sans marque/modèle, type de véhicule invalide, valeur négative,
limite RC négative, date invalide, soumission introuvable, montant de
sinistre invalide), round-trip complet, règle d'or statique (zéro
`DELETE FROM flotte_` dans routes/import.js et lib/flotte.js),
inter-cabinets, portefeuille courtier (hors portefeuille rejeté, propres
lignes OK), journal d'audit. Non-régression : `test-import-pe.js`
**54/54**, `test-exports-flotte.js` **60/60**. Capture vérifiée
visuellement : `demo-captures/commercial/94-import-flotte.png` (page
`/import`, carte flotte avec les 5 modèles ; un modèle véhicule a été
téléchargé dans le navigateur pendant la capture — Chromium headless +
playwright-core, base fraîche, login `admin@demo.ca`, changement de mot
de passe forcé via `form:has(#actuel)`).

Reste pour l'étape 7/10 : proposition PDF flotte — **fait ci-dessous**.

### Flotte automobile — étape 7/10 : proposition PDF

Proposition d'assurance flotte automobile pré-remplie (HTML imprimable +
PDF téléchargeable), état courant ou version figée `?v=N` — miroir de
l'étape 7/10 PE :

- **`lib/proposition-flotte.js`** : `preparerPropositionFlotte(cabinetId,
  soumission, vParam)` — proposant, **résumé de la flotte** (nombre de
  véhicules détaillés et déclarés, **valeur totale** = somme des valeurs,
  usage dominant et usages des véhicules en libellés FR, rayon principal
  et rayon maximal), **véhicules illimités** (désignation, NIV, type et
  usage en libellés FR — jamais les codes —, valeur, rayon, lieu de
  remisage, conducteur principal résolu par fiche ou nom libre,
  équipements spéciaux), **conducteurs illimités** (permis et classe,
  expérience et expérience véhicules lourds, sinistres 5 ans, infractions
  3 ans, formations), garanties (limite RC chapitre A, franchises
  collision / versement, prime, **avenants FAQ en libellés FR** — « FAQ 43
  — Valeur à neuf », « FAQ 34 — Indemnités d'accident »…), antécédents
  (sinistres de la flotte 5 ans, **ratio de pertes**, refus/annulation),
  consentements (crédit / dossier SAAQ / FCSA — format plat de l'UI ou
  format semé `{accepte:true}`), n° de version. Lecture seule : ne modifie
  jamais la soumission.
- **`lib/proposition-flotte-pdf.js`** (pdfkit) : PDF FR — en-tête Cabinet
  + proposant, résumé, **tableaux véhicules et conducteurs** (colonnes),
  garanties, **mentions métier flotte : « Tout conducteur doit détenir un
  permis de conduire valide de la classe appropriée au véhicule conduit ;
  un conducteur non déclaré, ou dont le dossier de conduite n'a pas été
  vérifié, ne peut prendre le volant d'un véhicule de la flotte. »**,
  **« Tout véhicule ajouté, remplacé ou retiré doit être déclaré sans
  délai au courtier : un véhicule non déclaré n'est pas couvert, et
  l'usage réel de chaque véhicule doit correspondre à l'usage
  déclaré. »** et, quand la FAQ 43 est souscrite, **« La FAQ 43 (valeur
  à neuf) est souscrite : en cas de perte totale d'un véhicule visé par
  l'avenant, l'indemnité est calculée sans dépréciation, sur la valeur à
  neuf du véhicule. »**, pied « proposition conforme à la version N
  figée », signatures proposant/courtier.
- **Routes** `GET /flotte/:id/proposition` (HTML) et `GET
  /flotte/:id/proposition.pdf` (téléchargeable), audit
  `proposition_flotte_generee` avec n° de version ; vue
  `views/flotte/proposition.ejs` (CSS/JS externes `/proposition.css` +
  `/proposition.js`, CSP : aucun inline).
- **Bouton « 📄 Proposition »** sur la fiche flotte : **grisé
  « (incomplète) » tant que la soumission n'a aucun véhicule ou aucune
  garantie définie**, lien actif sinon.
Tests : `scripts/test-proposition-flotte-pdf.js` (**65 tests**, HTTP) —
préparation directe, bouton (actif sur fiche complète, grisé sur fiche
vide et sur fiche véhicule sans garanties), état courant (résumé,
véhicules, conducteurs, limite RC, franchises, avenants libellés,
mentions métier, prime, sinistres, ratio de pertes, consentements,
boutons, CSP), version figée `?v=1` (données d'époque : aucun véhicule)
et `?v=N` = snapshot (un 4e véhicule ajouté après coup n'y figure pas,
mais figure dans l'état courant), `?v=999` → 404, PDF (content-type,
`%PDF`, entreprise, véhicule, conducteurs, FAQ 43, mention métier,
taille, PDF figé), règle d'or (générations en lecture seule : aucune
version créée ; aucun `DELETE` dans les modules proposition), sécurité
(inter-cabinets 404, courtier hors portefeuille 403, sans login 302),
audit avec version, aucune fuite inter-cabinets. Non-régression :
`test-proposition-pe-pdf.js` **40/40**, `test-import-flotte.js`
**63/63**. Capture vérifiée visuellement :
`demo-captures/commercial/95-proposition-flotte.png` (proposition HTML
de la soumission démo « Transport Lapointe inc. » — 4 véhicules, 3
conducteurs, valeur totale 155 500 $, RC 2 000 000 $, mentions métier —
Chromium headless + playwright-core, base fraîche, login
`admin@demo.ca`, changement de mot de passe forcé via
`form:has(#actuel)`).

### Flotte automobile — étape 8/10 : commandes texte IA

4 actions de modification flotte dans `lib/commandes-ia.js` (miroir de
l'étape 8/10 PE, plus `ajouter_conducteur_flotte` — le conducteur est
l'autre item illimité de la flotte et l'autre mot partagé avec le FPQ1),
pilotables depuis l'assistant (« 💬 Assistant IA »), **confirmation
explicite obligatoire** avant toute exécution :

- **`ajouter_vehicule_flotte`** : « ajoute le véhicule Ford Transit 2023
  à la soumission flotte un » — année, marque, modèle, NIV, type
  (camion / automobile / remorque / équipement — « ajoute le camion… »
  accepté), valeur (« avec 45 000 $ de valeur »), usage, rayon ;
  référence par n° (« soumission flotte 2 », « soumission flotte
  automobile 2 », n° en chiffres ou en lettres) ou par entreprise
  (« …flotte de Transport Lapointe inc. »).
- **`ajouter_conducteur_flotte`** : « ajoute un conducteur Marc Gagnon
  permis G1234567 classe 3 à la soumission flotte 1 » — prénom, nom,
  n° de permis, classe de permis, années d'expérience.
- **`modifier_garanties_flotte`** : « mets la limite RC à 2 millions, la
  franchise collision à 1 000 $ et ajoute la FAQ 20 pour la soumission
  flotte 1 » — limite RC, franchises **collision / versement**
  (préposition « à » gérée, leçon PE), prime, **avenants FAQ ajout ET
  retrait** (faq43 valeur à neuf, faq20 privation de jouissance, faq27
  véhicule loué, faq34 indemnités d'accident, faq5a crédit-bail) ;
  résumé avant/après à la confirmation (« limite RC : 1 000 000 $ →
  2 000 000 $ », « avenant FAQ 27 … : présent → retiré »), fusion avec
  l'existant (les champs non mentionnés sont conservés).
- **`modifier_vehicule_flotte`** (l'item illimité, comme
  `modifier_etablissement_pe`) : « mets le véhicule deux à 45 000 $ de
  valeur pour la soumission flotte 1 », « change le rayon du véhicule
  un de la soumission flotte 2 à 150 km », « change l'usage du véhicule
  Ford Transit … à personnel » — véhicule résolu par n° (chiffres ou
  lettres), NIV ou marque/modèle.
- **Routage 8 produits — LE point critique de l'étape** : « véhicule »,
  « conducteur » et « garanties » sont partagés entre la flotte et le
  FPQ1 (auto personnelle). Le marqueur **« flotte » est obligatoire**
  pour toute action flotte ; réciproquement les analyseurs FPQ1
  refusent le marqueur flotte et « soumission auto N » / « soumission
  automobile N » (sans « flotte ») restent FPQ1, de même que la
  référence courte historique « soumission N » (non-régression étape 8
  FPQ1, 48/48). Une commande « véhicule » **sans produit nommé et sans
  référence de soumission** ne déclenche ni action flotte ni action
  FPQ1 : demande de précision existante (« Pour quelle soumission ? »),
  aucune exécution silencieuse, rien créé ni en `flotte_vehicules` ni en
  `auto_vehicules` (prouvé en base par la suite). Gardes
  bidirectionnelles complétées dans les analyseurs des 7 autres
  produits (une commande « …à la soumission flotte 1 » pour un lieu RC,
  un bâtiment, une mesure cyber, une activité E&O, un dirigeant D&O ou
  un établissement PE retourne `null`, et réciproquement). Garde-fou
  accentué : lookahead `(?![\wÀ-ÿ])`, jamais `\b` après un mot accentué.
- **Navigation** : « montre-moi la soumission flotte 1 » → `/flotte/1`,
  « ouvre la flotte » → `/flotte`.
- **Mode Cohere** : les 4 actions sont déclarées dans `ACTIONS_COHERE`
  (schéma JSON strict, mêmes paramètres) et dans
  `ACTIONS_CONFIRMABLES` (`lib/assistant.js`) ; audit `commande_ia` ;
  règle d'or (zéro `DELETE FROM flotte_`) ; cloisonnement cabinet +
  périmètre courtier appliqués ; passages par `lib/flotte.js`
  (versionnage systématique).
Tests : `scripts/test-commandes-flotte.js` (**77 tests**, HTTP) —
analyseur local (cas nominaux + anti-collisions bidirectionnelles ×8
produits + commandes ambiguës), confirmation requise (rien exécuté
avant le « ✓ Confirmer »), fusion des garanties, ajout ET retrait
d'avenants FAQ, modification de véhicule (valeur, rayon), ambiguïté par
entreprise → demande de précision, ambigu sans produit → aucune
création, hors portefeuille, inter-cabinets, CSRF 403, audit, règle
d'or, FPQ1 inchangé en base. Non-régression : `test-commandes-pe.js`
**67/67**, `test-proposition-flotte-pdf.js` **65/65**,
`test-commandes-ia.js` **48/48**. Capture vérifiée visuellement :
`demo-captures/commercial/96-commandes-ia-flotte.png` (assistant IA,
commande « ajoute le véhicule Ford Transit 2023 avec 45 000 $ de valeur
à la soumission flotte 1 » analysée, aperçu de confirmation visible —
« Je vais ajouter le véhicule 2023 Ford Transit (valeur : 45 000 $) à la
soumission flotte #1 (Transport Lapointe inc.). Confirmez-vous ? » —
boutons ✓ Confirmer / Annuler, **non exécutée** : la soumission démo
compte toujours ses 4 véhicules du seed ; Chromium headless +
playwright-core, base fraîche, login `admin@demo.ca`, changement de
mot de passe forcé via `form:has(#actuel)`).

### Flotte automobile — étape 9/10 : dictée vocale (voix)

`normaliserDictee()` (`public/dictee.js`) étendu au vocabulaire flotte
(miroir de l'étape 9/10 PE) :

- **Références** : « à la soumission flotte un » → « à la soumission
  flotte 1 » ; « à la soumission flotte automobile deux » → « flotte
  automobile 2 » ; « montre-moi la soumission flotte trois » → « flotte
  3 ». **Anti-collision voix** : le mot « flotte » est toujours conservé
  — jamais de conversion vers une référence auto/FPQ1 — et
  réciproquement « soumission auto un » FPQ1 et la référence courte
  « soumission 1 » restent intactes.
- **Items illimités** : « le véhicule deux » → « le véhicule 2 »,
  « le conducteur trois » → « le conducteur 3 » (index véhicule /
  conducteur flotte), « classe trois » → « classe 3 » (classe de permis
  SAAQ, chiffre exigé par l'analyseur conducteur).
- **Rayon d'opération** : « rayon de cent cinquante kilomètres » →
  « rayon de 150 km » (aussi « 150 kilomètres » → « 150 km ») —
  l'unité est normalisée en « km », la forme qu'exigent les analyseurs
  flotte (`modifier_vehicule_flotte`, `ajouter_vehicule_flotte`).
- **Avenants FAQ** : « valeur a neuf » → « valeur à neuf » (l'accent
  est rétabli, « neuf » n'est jamais converti en 9 : c'est le libellé
  de la FAQ 43) ; codes épelés « f a q quarante-trois » → « FAQ 43 »
  — « f a q » est recollé **sans avaler le nombre qui suit** (leçon du
  bug des codes épelés D&O : « soumission d o un » ne doit pas devenir
  « O1 »), le nombre est converti par la référence FAQ (« FAQ
  quarante-trois » → « FAQ 43 », « f a q cinq a » → « FAQ 5 a » pour
  la FAQ 5a) ; « privation de jouissance » (FAQ 20) passe en texte
  libre ; élision « indemnités d accident » → « indemnités
  d'accident » (FAQ 34).
- **Montants** : règles existantes réutilisées (« deux millions » →
  2000000 pour la limite RC, « quarante-cinq mille dollars » → 45000,
  permis épelé « G un deux trois… » → G1234567).
- **Pipeline vérifié** : « ajoute le véhicule Ford Transit à la
  soumission flotte un » → normalisé « …flotte 1 » → confirmation
  `ajouter_vehicule_flotte` → véhicule créé + version figée (règle
  d'or) ; rayon dicté (« …à cent cinquante kilomètres » → « 150 km »)
  et avenant dicté épelé (« f a q quarante-trois » → « FAQ 43 »)
  vérifiés jusqu'à l'aperçu de confirmation (non exécutés). Bouton 🎤
  déjà présent sur le chat de l'assistant ; **jamais d'envoi
  automatique** — la dictée remplit le champ, l'utilisateur confirme.

Tests : `scripts/test-voix.js` — 168 → **203 tests** (22 nouvelles
règles flotte + 13 tests de pipeline flotte, non-régression des règles
FPQ1/biens/RC/cyber/E&O/D&O/PE : toutes les pipelines voix des 7 autres
produits restent vertes dans la même suite). Non-régression :
`scripts/test-commandes-flotte.js` **77/77**. Capture vérifiée
visuellement : `demo-captures/commercial/97-voix-flotte.png`
(assistant IA, dictée brute « ajoute le véhicule Ford Transit à la
soumission flotte un » normalisée dans le champ — « …à la soumission
flotte 1 » — prête à envoyer, **non soumise** ; Chromium headless +
playwright-core, base fraîche, login `admin@demo.ca` sur `/connexion`
champs `#email` / `#mdp`, changement de mot de passe forcé via
`form:has(#actuel)`, dictée simulée en injectant le texte brut dans
`#chat-input` puis en appliquant `Dictee.normaliserDictee()` comme le
fait l'UI).

Reste pour l'étape 10/10 : finalisation (balayage complet, règle d'or,
captures revues, ZIP final `courtier-flotte-final.zip`).

### Flotte automobile — étape 10/10 : final (balayage complet)

Balayage final du module Flotte automobile (2026-10-20) : toutes les
suites exécutées une par une sur bases fraîches (serveur tué + base
supprimée entre chaque ; suites modèle avec `CHEMIN_BD` seul, sans
serveur ; suites HTTP avec `CHEMIN_BD` identique sur serveur ET script ;
ne jamais sonder `/connexion` avant une suite — rate-limit
20 logins/15 min ; `test-phase1.js` exclue — obsolète ; logs de balayage
sous `~/workspace/`, pas `/tmp`). Preuve :
`~/workspace/balayage-flotte10-final.log` (65 lignes `exit=0`, aucune
suite en échec ; `~/workspace/balayage-flotte10-final-details/` conserve
les 65 sorties complètes).

**Résultat : 65 suites, 3978/3978 tests verts, zéro échec.**

| Suite | Tests |
|---|---|
| test-dictionnaire.js (8 produits, 71 tables, 816 colonnes) | 304 |
| test-voix.js (FPQ1 + biens + RC + cyber + E&O + D&O + PE + flotte) | 203 |
| test-flotte-etape2.js (questionnaire flotte) | 129 |
| test-principes.js (règle d'or) | 112 |
| test-pe-etape2.js (questionnaire PE) | 89 |
| test-do-etape2.js (questionnaire D&O) | 83 |
| test-eo-etape2.js (questionnaire E&O) | 83 |
| test-flotte-etape3.js (fiche police flotte) | 77 |
| test-commandes-flotte.js (commandes IA flotte) | 77 |
| test-biens-etape2.js (questionnaire biens) | 74 |
| test-cyber-etape2.js (questionnaire cyber) | 71 |
| test-rc-etape2.js (questionnaire RC) | 70 |
| test-commandes-do.js (commandes IA D&O) | 70 |
| test-flotte-etape1.js (modèle flotte) | 70 |
| test-commandes-pe.js (commandes IA perte d'exploitation) | 67 |
| test-nouveaux-modules.js | 65 |
| test-proposition-flotte-pdf.js (proposition flotte HTML + PDF) | 65 |
| test-import-flotte.js (import flotte) | 63 |
| test-commandes-eo.js | 62 |
| test-fpq1-etape2.js | 62 |
| test-exports-flotte.js (exports flotte) | 60 |
| test-demandes-2026-10-09.js | 57 |
| test-commandes-cyber.js | 57 |
| test-biens-etape1.js (modèle biens) | 57 |
| test-eo-etape3.js (police E&O) | 56 |
| test-do-etape3.js (police D&O) | 56 |
| test-pe-etape3.js (fiche police PE) | 56 |
| test-exports.js | 55 |
| test-cyber-etape3.js (police cyber) | 55 |
| test-import-pe.js (import PE) | 54 |
| test-rc-etape3.js (police RC) | 54 |
| test-fpq1-etape1.js (modèle auto) | 53 |
| test-fpq1-etape3.js | 52 |
| test-biens-etape3.js (police biens) | 52 |
| test-import-do.js | 50 |
| test-import-eo.js | 49 |
| test-commandes-ia.js (auto) | 48 |
| test-commandes-rc.js | 48 |
| test-rc-etape1.js (modèle RC) | 48 |
| test-ajustements.js | 48 |
| test-droits-2026-10-09.js | 48 |
| test-commandes-biens.js | 47 |
| test-assureurs.js | 47 |
| test-pe-etape1.js (modèle PE) | 47 |
| test-cyber-etape1.js | 47 |
| test-eo-etape1.js (modèle E&O) | 47 |
| test-do-etape1.js (modèle D&O) | 47 |
| test-exports-pe.js (exports PE) | 46 |
| test-exports-eo.js | 45 |
| test-exports-do.js | 45 |
| test-exports-biens.js | 44 |
| test-exports-cyber.js | 43 |
| test-exports-rc.js | 41 |
| test-proposition-pe-pdf.js (proposition PE HTML + PDF) | 40 |
| test-proposition-eo-pdf.js | 39 |
| test-proposition-do-pdf.js | 39 |
| test-courriels.js | 37 |
| test-import-biens.js | 36 |
| test-import-cyber.js | 36 |
| test-proposition-cyber-pdf.js | 34 |
| test-proposition-biens-pdf.js | 33 |
| test-import-auto.js | 33 |
| test-import-rc.js | 33 |
| test-proposition-rc-pdf.js | 32 |
| test-proposition-pdf.js | 31 |

Règle d'or re-vérifiée (statique) : `grep -rn "DELETE FROM flotte_"
lib/ routes/ public/ views/` → vide, et aucun `DROP TABLE flotte_`
(les occurrences dans `scripts/` sont les vérifications statiques
elles-mêmes) ; aucune route DELETE sur `/flotte` (`routes/flotte.js`
ne contient aucune route `delete`) ; aucun bouton « supprimer » dans
`views/flotte/` (archivage doux partout ; chaque mutation flotte crée
une version figée — les 70 tests `test-flotte-etape1.js` l'exigent).

Captures 89-97 revues (présentes dans `demo-captures/commercial/`,
visuellement propres — navigation cohérente avec l'onglet « Flotte »,
aucun texte coupé, aucun 404 visible) : `89-flotte-liste.png` (liste
des soumissions flotte — Transport Lapointe inc., 4 véhicules,
3 conducteurs, limite RC 2 000 000 $), `90-flotte-fiche.png` (fiche
soumission #1 complète : véhicules avec NIV et équipements, conducteurs
avec permis/classes/expérience, garanties FAQ 43/20/27/34, antécédents,
historique des versions v1-v10), `91-police-flotte.png` (fiche police
FLT-2026-90001 avec bloc « 🚚 Données flotte automobile » figé à la
conversion + protections recommandées manquantes FLT-RC/FLT-VN),
`92-dictionnaire-flotte.png` (dictionnaire enrichi, domaine flotte),
`93-exports-flotte.png` (page Exports avec les 3 modules flotte :
véhicules, conducteurs, soumissions — 33 modules au total),
`94-import-flotte.png` (page Import flotte : 5 types `soumission_flotte`,
`vehicule_flotte`, `conducteur_flotte`, `garanties_flotte`,
`antecedents_flotte`), `95-proposition-flotte.png` (proposition HTML
imprimable : véhicules, conducteurs, garanties, antécédents,
signatures), `96-commandes-ia-flotte.png` (commande IA texte →
confirmation avant ajout de véhicule), `97-voix-flotte.png` (dictée
vocale → texte normalisé prêt à envoyer).

ZIP final : `~/workspace/your_files/courtier-flotte-final.zip`
(16,0 Mo, 387 fichiers, préfixe `courtier-app/`, captures 89-97
incluses, sans `courtier.db*`/`.env`/`node_modules`/`.git`).

**Module Flotte automobile : 10/10 terminées.** Prochain produit :
cautionnement (le dernier de la liste), puis la production (export du
portefeuille, VPS Québec, clé Cohere optionnelle, SMTP, validation
conformité, suppression du token GitHub exposé).

### Cautionnement — étape 1/10 : couche données (sans interface)

Couche d'accès `lib/cautionnement.js` (miroir de `lib/flotte.js`) pour les
soumissions de **cautionnement** (bonds / sûreté). Le cautionnement n'est
PAS une assurance : c'est une garantie à **trois parties** — la **caution**
(assureur : Intact Cautionnement, Travelers Canada, Aviva), le **principal**
(l'entrepreneur client, débiteur) et le **bénéficiaire/obligé** (le donneur
d'ouvrage). Si la caution paie le bénéficiaire, elle se retourne contre le
principal (convention d'indemnisation signée par les actionnaires).

- **5 tables `caut_*`** : `caut_soumissions` (en-tête : entreprise =
  principal, caution visée, secteur d'activité, année de fondation, chiffre
  d'affaires, nombre d'employés, statut, dates visées, notes),
  `caut_obligations` (**illimitées** : type — `soumission` (bid bond),
  `execution` (performance, typiquement 50 % du contrat), `paiement_mo`
  (main-d'œuvre et matériaux), `rbq` (licence RBQ : 20 000 $ spécialisés /
  40 000 $ généraux), `autre` —, bénéficiaire, description du projet,
  montant du contrat, montant du cautionnement, taux %, prime estimée,
  durée), `caut_garanties` (UNIQUE par soumission : la **ligne de
  cautionnement** — limite globale = capacité, limite par projet, fonds de
  roulement, valeur nette, prime), `caut_antecedents` (assureur actuel,
  années de cautionnement continu, réclamations contre cautionnements
  5 ans JSON {date, cautionnement, montant, statut}, refus/résiliations,
  consentements crédit + états financiers),
  `caut_soumission_versions` (snapshots JSON figés, numérotés).
- **Validation métier** : la limite par projet ne peut jamais dépasser la
  limite globale (rejet à la création comme à la modification, avant/après
  fusionnés pour les mises à jour partielles).
- **Versionnage à chaque mutation** (règle d'or) : aucune suppression —
  archivage doux des obligations et des soumissions, toujours restorable ;
  audit `caut_%`.
- Seed démo : **Construction Verdon inc.** (Laval, entrepreneur général,
  fondé en 2008, CA 8,5 M$, 42 employés, caution Intact Cautionnement) —
  ligne globale 5 M$, limite par projet 2,5 M$, fonds de roulement 850 k$,
  valeur nette 1,9 M$, prime 21 500 $ ; 4 obligations (soumission 220 k$,
  exécution 1,1 M$ = 50 % du contrat d'école de 2,2 M$ pour le Centre de
  services scolaire des Mille-Îles, paiement main-d'œuvre et matériaux
  1,1 M$, RBQ 40 000 $) ; aucune réclamation en 5 ans, 8 ans de
  cautionnement continu.
- Tests : `scripts/test-cautionnement-etape1.js` — **60/60** (base fraîche
  via `CHEMIN_BD`, sans serveur). Non-régression : flotte étape 1 (70/70),
  PE étape 1 (47/47).

### Cautionnement — étape 2/10 : questionnaire de soumission (interface)

`routes/cautionnement.js` + `views/cautionnement/` (miroir flotte) :
onglet « Cautionnement » dans la barre (après « Flotte »), liste avec
filtres (recherche, statut, caution — colonnes Obligations, Limite globale,
Limite/projet), fiche complète : en-tête (principal, caution visée, profil
d'entreprise), obligations **illimitées** (ajout/modification/archivage/
désarchivage, taux et prime estimée), ligne de cautionnement (limite
globale, limite par projet, fonds de roulement, valeur nette, prime —
validation limite par projet ≤ limite globale avec message clair),
antécédents (réclamations 5 ans au format pipe
`AAAA-MM-JJ|cautionnement|montant|statut`, refus/résiliations,
consentements crédit + états financiers), statut, archivage, historique
des versions en lecture seule. Cloisonnement : inter-cabinets 404,
portefeuille courtier 403 (accès propre 200). Aucun bouton « supprimer »
(suppression interdite du périmètre). Tests :
`scripts/test-cautionnement-etape2.js` — **102/102** (HTTP). Captures :
`98-cautionnement-liste.png`, `99-cautionnement-fiche.png`.

### Cautionnement — étape 3/10 : fiche police (gestion)

Migration `polices.caut_soumission_id` + `caut_soumission_version`
(UNIQUE, reconstruction préservant les 8 liens produits existants).
`POST /cautionnement/:id/convertir` (crée la police ligne `cautionnement`,
fige la version courante, statut `convertie_police`) + `/lier-police`
(police existante de la même ligne seulement, jamais déjà liée). Chaque
mutation d'une soumission liée note un **avenant** sur la police
(`noterAvenantPolice()`, version de police incrémentée, snapshot figé
immuable). Bloc « 📜 Données cautionnement » figé sur
`/echeances/police/:id` (en-tête, obligations, ligne, antécédents de la
version liée) + alertes protections recommandées : **CAUT-MO** (exécution
sans paiement main-d'œuvre/matériaux), **CAUT-EXEC** (soumission sans
exécution), **CAUT-LIGNE** (obligation figée au-dessus de la limite par
projet). Tests : `scripts/test-cautionnement-etape3.js` — **76/76**
(HTTP). Capture : `100-police-cautionnement.png`.

### Cautionnement — étape 4/10 : dictionnaire IA enrichi

Domaine « cautionnement » de `lib/dictionnaire-champs.json` (76 tables,
882 colonnes au total) : descriptions métier FR (apostrophe droite) — les
trois parties (caution/principal/bénéficiaire), la ligne globale =
capacité accordée après analyse des états financiers, la limite par projet
jamais au-dessus de la globale, le fonds de roulement comme critère clé
d'analyse, le cautionnement d'exécution typiquement à 50 % du contrat, le
RBQ à 20 000 $ (spécialisés) / 40 000 $ (généraux), le piège des
réclamations ou résiliations non déclarées, les refus à déclarer
obligatoirement, les consentements = pièces exigées par la caution, la
convention d'indemnisation. Valeurs CHECK documentées (types
d'obligations, statuts), colonnes figées `figee: true`,
`caut_soumission_versions` ajoutée à la `regle_or` du JSON et de
`lib/contexte-ia.js`. Tests : `test-dictionnaire.js` — **333/333**.
Capture : `101-dictionnaire-cautionnement.png`.

### Cautionnement — étape 5/10 : exports CSV/JSON

3 modules dans `routes/exports.js` (**36 modules au total**) :
`caut_obligations` (une ligne par obligation, libellés FR),
`caut_soumissions` (une ligne par soumission : ligne aplatie —
`prime_ligne`, fonds de roulement, valeur nette —, antécédents aplatis,
`nb_reclamations_5ans` calculé depuis le JSON, versions imbriquées en
JSON), `caut_versions` (historique figé). CSV (BOM, « ; », en-têtes FR) et
JSON structuré ; archivés exclus par défaut (`inclure_archives=1`) ;
périmètre courtier = son portefeuille ; audit `export_csv`/`export_json`.
Tests : `scripts/test-exports-cautionnement.js` — **44/44**. Capture :
`102-exports-cautionnement.png`.

### Cautionnement — étape 6/10 : import CSV en lot

4 types dans `routes/import.js` : `soumission_caut`, `obligation_caut`,
`ligne_caut`, `antecedents_caut` (modèles téléchargeables
`/import/modele-cautionnement/:type`). Type d'obligation par code OU
libellé FR ; réclamations au format pipe ; en-têtes FR avec apostrophes
droites ou courbes (EQUIV/EQUIV_NORM) ; statut par code ou libellé ;
validation limite par projet ≤ limite globale AVANT écriture ; erreurs
ligne par ligne sans interrompre le lot ; round-trips export → import
vérifiés ; `scripts/exemple-import-cautionnement.csv` fourni (5 lignes).
Tests : `scripts/test-import-cautionnement.js` — **45/45**. Capture :
`103-import-cautionnement.png`.

### Cautionnement — étape 7/10 : proposition PDF

`lib/proposition-cautionnement.js` + `lib/proposition-cautionnement-pdf.js`
(pdfkit) : `GET /cautionnement/:id/proposition` (HTML imprimable) et
`.pdf`, état courant OU version figée `?v=N` (404 si inexistante),
libellés FR partout (jamais les codes), bouton dégrisé sur la fiche
(seulement si obligations + ligne saisies), audit
`proposition_cautionnement_generee`. Contenu : profil du principal,
résumé (nombre d'obligations, somme des cautionnements, utilisation de la
capacité en % de la limite globale), tableau des obligations (avec part
du contrat, ex. « 50 % du contrat »), ligne de cautionnement,
antécédents, consentements, signatures (principal + courtier), et la
**mention métier** : « Un cautionnement n'est pas une assurance : la
caution qui paie le bénéficiaire se retourne contre le principal
(convention d'indemnisation signée par les actionnaires). La limite
globale et la limite par projet forment la capacité accordée après analyse
des états financiers. » Tests :
`scripts/test-proposition-cautionnement-pdf.js` — **58/58**. Capture :
`104-proposition-cautionnement.png`.

### Cautionnement — étape 8/10 : commandes texte IA

3 actions dans `lib/commandes-ia.js` (+ `ACTIONS_CONFIRMABLES` dans
`lib/assistant.js`, schémas Cohere, aide, aller_a « cautionnement ») :
`ajouter_obligation_caut` (type, bénéficiaire, projet, montant du contrat,
montant du cautionnement, prime estimée), `modifier_ligne_caut` (limite
globale, limite par projet, fonds de roulement, valeur nette, prime —
refus si la limite par projet dépasserait la globale, même confirmé),
`modifier_obligation_caut` (par index ou par type, montants, bénéficiaire).
**Marqueur « cautionnement »/« caution » OBLIGATOIRE** : le mot
« soumission » seul désigne déjà la référence courte FPQ1/flotte — gardes
anti-collision bidirectionnelles avec les 8 autres produits (une commande
flotte/biens/RC/cyber/E&O/D&O/PE/FPQ1 mentionnant « cautionnement » n'est
plus captée par ces produits, et réciproquement). Confirmation obligatoire
avant toute exécution (avant → après affichés), jamais d'exécution sans
confirmation. Tests : `scripts/test-commandes-cautionnement.js` —
**43/43**. Capture : `105-commandes-ia-cautionnement.png`.

### Cautionnement — étape 9/10 : dictée vocale (voix)

`normaliserDictee()` (`public/dictee.js`) étendu : « à la soumission
cautionnement un » → « à la soumission cautionnement 1 » (jamais confondu
avec la référence courte FPQ1 « soumission N », et réciproquement),
« l'obligation deux » → « l'obligation 2 », élision « cautionnement
d'exécution » rétablie, montants par les règles existantes (« limite
globale cinq millions » → « limite globale 5000000 », RBQ « quarante mille
dollars » → 40000). Aucun envoi automatique après dictée (le texte remplit
le champ, l'envoi reste manuel) ; pipeline complet vérifié : dictée →
normalisation → confirmation → exécution (obligation créée + version
figée) et dictée → confirmation pour la ligne. Non-régression des 8 autres
produits. Tests : `test-voix.js` — **225/225**. Capture :
`106-voix-cautionnement.png`.

### Cautionnement — étape 10/10 : final (balayage complet)

Balayage final du module Cautionnement (2026-10-20) : toutes les suites
exécutées une par une sur bases fraîches (serveur tué + base supprimée
entre chaque ; suites modèle avec `CHEMIN_BD` seul, sans serveur ; suites
HTTP avec `CHEMIN_BD` identique sur serveur ET script ; jamais de sonde
`/connexion` avant une suite — rate-limit 20 logins/15 min ;
`test-phase1.js` exclue — obsolète ; logs de balayage sous `~/workspace/`,
pas `/tmp`). Preuve : `~/workspace/balayage-cautionnement10-final.log`
(72 lignes `exit=0`, aucune suite en échec ;
`~/workspace/balayage-cautionnement10-final-details/` conserve les 72
sorties complètes).

**Résultat : 72 suites, 4457/4457 tests verts, zéro échec.**

| Suite | Tests |
|---|---|
| test-dictionnaire.js (9 produits, 76 tables, 882 colonnes) | 333 |
| test-voix.js (FPQ1 + biens + RC + cyber + E&O + D&O + PE + flotte + cautionnement) | 225 |
| test-flotte-etape2.js (questionnaire flotte) | 129 |
| test-principes.js (règle d'or) | 112 |
| test-cautionnement-etape2.js (questionnaire cautionnement) | 102 |
| test-pe-etape2.js (questionnaire PE) | 89 |
| test-do-etape2.js (questionnaire D&O) | 83 |
| test-eo-etape2.js (questionnaire E&O) | 83 |
| test-commandes-flotte.js (commandes IA flotte) | 77 |
| test-flotte-etape3.js (fiche police flotte) | 77 |
| test-cautionnement-etape3.js (fiche police cautionnement) | 76 |
| test-biens-etape2.js (questionnaire biens) | 74 |
| test-cyber-etape2.js (questionnaire cyber) | 71 |
| test-flotte-etape1.js (modèle flotte) | 70 |
| test-commandes-do.js (commandes IA D&O) | 70 |
| test-rc-etape2.js (questionnaire RC) | 70 |
| test-commandes-pe.js (commandes IA perte d'exploitation) | 67 |
| test-nouveaux-modules.js | 65 |
| test-proposition-flotte-pdf.js (proposition flotte HTML + PDF) | 65 |
| test-import-flotte.js (import flotte) | 63 |
| test-commandes-eo.js | 62 |
| test-fpq1-etape2.js | 62 |
| test-cautionnement-etape1.js (modèle cautionnement) | 60 |
| test-exports-flotte.js (exports flotte) | 60 |
| test-proposition-cautionnement-pdf.js (proposition cautionnement HTML + PDF) | 58 |
| test-biens-etape1.js (modèle biens) | 57 |
| test-commandes-cyber.js | 57 |
| test-demandes-2026-10-09.js | 57 |
| test-do-etape3.js (police D&O) | 56 |
| test-eo-etape3.js (police E&O) | 56 |
| test-pe-etape3.js (fiche police PE) | 56 |
| test-cyber-etape3.js (police cyber) | 55 |
| test-exports.js | 55 |
| test-import-pe.js (import PE) | 54 |
| test-rc-etape3.js (police RC) | 54 |
| test-fpq1-etape1.js (modèle auto) | 53 |
| test-biens-etape3.js (police biens) | 52 |
| test-fpq1-etape3.js | 52 |
| test-import-do.js | 50 |
| test-import-eo.js | 49 |
| test-rc-etape1.js (modèle RC) | 48 |
| test-ajustements.js | 48 |
| test-commandes-ia.js (auto) | 48 |
| test-commandes-rc.js | 48 |
| test-droits-2026-10-09.js | 48 |
| test-cyber-etape1.js | 47 |
| test-do-etape1.js (modèle D&O) | 47 |
| test-eo-etape1.js (modèle E&O) | 47 |
| test-pe-etape1.js (modèle PE) | 47 |
| test-assureurs.js | 47 |
| test-commandes-biens.js | 47 |
| test-exports-pe.js (exports PE) | 46 |
| test-exports-do.js | 45 |
| test-exports-eo.js | 45 |
| test-import-cautionnement.js (import cautionnement) | 45 |
| test-exports-biens.js | 44 |
| test-exports-cautionnement.js (exports cautionnement) | 44 |
| test-commandes-cautionnement.js (commandes IA cautionnement) | 43 |
| test-exports-cyber.js | 43 |
| test-exports-rc.js | 41 |
| test-proposition-pe-pdf.js (proposition PE HTML + PDF) | 40 |
| test-proposition-do-pdf.js | 39 |
| test-proposition-eo-pdf.js | 39 |
| test-courriels.js | 37 |
| test-import-biens.js | 36 |
| test-import-cyber.js | 36 |
| test-proposition-cyber-pdf.js | 34 |
| test-import-auto.js | 33 |
| test-import-rc.js | 33 |
| test-proposition-biens-pdf.js | 33 |
| test-proposition-rc-pdf.js | 32 |
| test-proposition-pdf.js | 31 |

Règle d'or re-vérifiée (statique) : `grep -rn "DELETE FROM caut_"
lib/ routes/ public/ views/` → vide, et aucun `DROP TABLE caut_`
(la seule occurrence du mot DELETE dans `lib/cautionnement.js` est le
commentaire qui énonce la règle) ; aucune route DELETE sur
`/cautionnement` ; aucun bouton « supprimer » dans
`views/cautionnement/` (archivage doux partout ; chaque mutation
cautionnement crée une version figée — les 60 tests
`test-cautionnement-etape1.js` l'exigent).

Captures 98-106 revues (présentes dans `demo-captures/commercial/`,
visuellement propres — navigation cohérente avec l'onglet
« Cautionnement », aucun texte coupé, aucun 404 visible) :
`98-cautionnement-liste.png` (liste des soumissions cautionnement —
Construction Verdon inc., 4 obligations, limite globale 5 000 000 $),
`99-cautionnement-fiche.png` (fiche soumission #1 complète : obligations
avec bénéficiaires et parts du contrat, ligne de cautionnement,
antécédents, historique des versions), `100-police-cautionnement.png`
(fiche police CAUT-001 avec bloc « 📜 Données cautionnement » figé à la
conversion), `101-dictionnaire-cautionnement.png` (dictionnaire enrichi,
domaine cautionnement), `102-exports-cautionnement.png` (page Exports
avec les 3 modules cautionnement : obligations, soumissions, versions —
36 modules au total), `103-import-cautionnement.png` (page Import
cautionnement : 4 types `soumission_caut`, `obligation_caut`,
`ligne_caut`, `antecedents_caut`), `104-proposition-cautionnement.png`
(proposition HTML imprimable : profil du principal, résumé avec
utilisation de la capacité, obligations, ligne, antécédents,
consentements, mention métier, signatures),
`105-commandes-ia-cautionnement.png` (commande IA texte → confirmation
avant ajout d'obligation), `106-voix-cautionnement.png` (dictée vocale →
texte normalisé → confirmation avant modification de la ligne).

ZIP final : `~/workspace/your_files/courtier-cautionnement-final.zip`
(17,2 Mo, 415 fichiers, préfixe `courtier-app/`, captures 98-106
incluses, sans `courtier.db*`/`.env`/`node_modules`/`.git`).

**Module Cautionnement : 10/10 terminées.** C'était le dernier produit de
la liste : FPQ1, biens, RC, cyber, E&O, D&O, perte d'exploitation, flotte
et cautionnement sont tous terminés. Reste la production (export du
portefeuille, VPS Québec, clé Cohere optionnelle, SMTP, validation
conformité, suppression du token GitHub exposé).

### Analyse de documents IA + clé Cohere — module complet (5 étapes)

Nouvel onglet **« 📥 Analyser un document »** (après « Assistant IA ») :
on glisse un document — police d'assureur, proposition déjà remplie,
scan ou photo — le système l'analyse et propose les champs à insérer,
**après révision humaine obligatoire**. Rien n'est inséré sans le clic
« Insérer les champs retenus ».

- **Étape 1 — Fondation et extraction** (`lib/analyses-documents.js`,
  `lib/extraction-document.js`, table `analyses_documents`) : téléversement
  (PDF, PNG, JPEG, Word, Excel — mêmes formats que les documents de
  police), stockage `uploads/<cabinet>/analyses/`, statuts
  recu → en_cours → a_reviser → insere / echec, audit `analyse_%`,
  archivage doux. Extraction du texte **100 % locale** : texte natif des
  PDF (`pdf-parse`), **OCR français** pour les images et scans
  (`tesseract.js`, données `fra` embarquées dans `lib/ocr-data/` — aucune
  donnée ne sort du serveur), texte des `.docx`/`.xlsx` ; les anciens
  formats binaires (.doc/.xls) sont acceptés mais signalés honnêtement
  « extraction limitée ». Test : `test-analyse-documents-etape1.js` (31).
- **Étape 2 — Moteur de correspondance local** (`lib/analyse-document.js`) :
  détection du produit par mots-clés métier pondérés (les 9 produits ;
  texte ambigu → produit indéterminé honnête, champs communs quand même
  proposés) et propositions de champs ancrées sur les libellés, appuyées
  sur le dictionnaire (78 tables, 908 colonnes) pour la destination
  table/colonne et le libellé affiché. Chaque champ proposé porte sa
  valeur, sa confiance (haute/moyenne/basse) et son extrait source.
  Aucune écriture métier à ce stade. Test : `test-analyse-moteur.js` (41).
- **Étape 3 — Révision et insertion** (`lib/analyse-insertion.js`) :
  tableau de révision (valeur modifiable, inclure/exclure, confiance en
  couleur), produit pré-sélectionné modifiable, trois cibles — **créer une
  soumission** du produit (via les couches `lib/<produit>.js` : en-tête,
  garanties, antécédents, items selon le produit ; le client est résolu
  par raison sociale ou créé minimal), **créer une police** du module
  commercial, ou **rattacher le document à une police existante** (copie
  dans ses pièces jointes). L'analyse passe à « inséré » avec les ids
  créés ; ré-analyser régénère une proposition sans écraser l'historique.
  Cloisonnement inter-cabinets et portefeuille courtier appliqués.
  Test : `test-analyse-insertion.js` (37).
- **Étape 4 — Réglages clé API Cohere** (`lib/reglages-ia.js`, table
  `reglages_ia`, page **Admin → « 🔑 Clé IA (Cohere) »**, admin seulement) :
  la clé est stockée **chiffrée AES-256-GCM** (même mécanisme que les
  jetons Microsoft), affichée seulement masquée (4 derniers caractères),
  absente des journaux, des réponses et des tests. Bouton « Tester la
  connexion » (échec propre et expliqué sans clé ou avec une mauvaise
  clé). Interrupteur moteur **Local / Cohere / Auto** (défaut Auto :
  Cohere si une clé est présente, sinon local) — il gouverne l'analyse de
  documents **et** l'assistant IA, et le badge moteur des deux écrans
  reflète le mode réel. En mode Cohere, le moteur envoie le texte extrait
  et la liste des champs autorisés du dictionnaire en JSON strict ; la
  réponse est **validée contre le dictionnaire** (tout champ inconnu est
  rejeté) et tout échec déclenche un **repli automatique sur le moteur
  local**, signalé dans le message de l'analyse. Aucune clé n'est livrée :
  Patrick la saisira lui-même dans cet écran quand il l'aura.
  Test : `test-reglages-cohere.js` (33).
- **Étape 5 — Finalisation** : balayage complet (voir le tableau des
  suites dans le journal `~/workspace/balayage-analyse-ia-final.log`),
  règle d'or statique (zéro `DELETE FROM analyses_documents`, aucune
  route DELETE, documents d'analyse jamais supprimés), captures 107-110
  revues, ZIP `~/workspace/your_files/courtier-analyse-ia-final.zip`.

**Balayage final : 4599/4599 tests, 76 suites** (les 72 suites
existantes + `test-analyse-documents-etape1` 31, `test-analyse-moteur`
41, `test-analyse-insertion` 37, `test-reglages-cohere` 33). Dictionnaire
mis à jour : **78 tables, 908 colonnes** (domaine `analyse_ia` :
`analyses_documents`, `reglages_ia`). ZIP final :
`~/workspace/your_files/courtier-analyse-ia-final.zip` (24,1 Mo,
399 fichiers, préfixe `courtier-app/`, captures 107-110 incluses, sans
`courtier.db*`/`.env`/`node_modules`/`.git`).

**Limites honnêtes** : la qualité de l'OCR dépend du scan (photo floue =
champs manquants ou confiance basse — d'où la révision obligatoire) ; le
moteur local lit bien les documents structurés avec libellés (« Assureur :
… », « Prime : … ») et moins bien les mises en page libres — le mode
Cohere lèvera une partie de cette limite le jour où la clé sera saisie ;
les champs très spécifiques (avenants détaillés, listes de véhicules ou
de bâtiments) ne sont pas extraits à ce stade, seulement les champs
d'en-tête, de garanties et d'antécédents courants.

Captures : `107-analyse-liste.png` (page d'analyse : zone de
glisser-déposer + analyses avec statut/produit/confiance),
`108-analyse-revision.png` (écran de révision RC : champs proposés,
confiances, cibles), `109-analyse-inseree.png` (analyse insérée avec
lien vers la soumission créée), `110-reglages-cohere.png` (Admin → Clé
IA : masque •••• 1234, choix du moteur, test de connexion).

### Analyse de documents IA — v2 listes complètes et Excel

La v1 n'extrayait qu'**un seul véhicule** (le premier NIV) et **aucun
conducteur**, et un Excel téléversé était lu comme du texte plat. La v2
sort les **listes complètes** et analyse les **tableurs directement** —
le scénario visé : le courtier téléverse la **police actuelle (PDF)** et
l'**Excel des permis** du client, et obtient une **soumission flotte
complète** (tous les véhicules, tous les conducteurs) prête pour la
proposition PDF, **sans conversion de fichier ni ressaisie des listes**.

- **Étape 1 — Listes complètes depuis texte/PDF** (`lib/analyse-document.js`) :
  extraction **multi-occurrences** — tous les NIV (17 caractères) trouvés,
  chacun avec son bloc (année, marque/modèle, valeur, usage) ; blocs
  « Conducteur n°… » (nom, n° de permis SAAQ, classe, naissance, embauche,
  expérience) ; mécanique générique par blocs répétés pour les 7 autres
  listes. Neuf types de listes (`META_LISTES`) : `vehicules` et
  `conducteurs` (auto + flotte), `batiments` (biens), `exploitations`
  (RC), `dirigeants` (D&O), `etablissements` (perte d'exploitation),
  `obligations` (cautionnement), `activites` (E&O), `mesures` (cyber).
  Format de proposition : `{ champs: [...], listes: { <type>: [{ champs,
  confiance, extrait }] } }`. Le mode **Cohere** produit le même format
  (schéma JSON étendu, validation stricte contre le dictionnaire, repli
  local inchangé). Test : `test-analyse-listes.js` (39).
- **Étape 2 — Analyse directe d'un tableur** (`lib/analyse-tableur.js`,
  `lib/extraction-document.js`, `lib/entetes-import.js`) : pour un
  `.xlsx`/`.csv` téléversé, l'extraction conserve la **structure
  tabulaire** `{ colonnes, lignes }` (xlsx lu en interne, feuille 1 ;
  CSV avec détection du délimiteur). Le moteur tabulaire mappe les
  en-têtes aux champs en **réutilisant les correspondances de l'import**
  (`EQUIV`/`EQUIV_NORM`, extraites dans `lib/entetes-import.js` — point
  de vérité unique partagé avec `routes/import.js` ; apostrophes droites
  et courbes, « Chiffre d'affaires », synonymes « entrepreneur » : numéro
  de permis, classe, expérience, embauche…), détecte le **type de liste**
  (permis/classe → conducteurs ; NIV → véhicules…) et le produit, convertit
  les **dates Excel en numéro de série** et normalise les codes fermés.
  L'entrepreneur envoie son Excel tel quel — aucune conversion en CSV.
  Test : `test-analyse-tableur.js` (24, vrai .xlsx fabriqué par
  `scripts/fixtures/fabriquer-xlsx.js`).
- **Étape 3 — Révision des listes + soumission existante** : l'écran de
  révision gagne une **section par liste proposée** — tableau éditable
  (cellule modifiable, case d'inclusion par ligne, bouton « + Ajouter une
  ligne », confiance par ligne ; JS externe `public/analyse-revision.js`)
  — et une **quatrième cible : « Ajouter à une soumission existante »**
  (sélecteur des soumissions non archivées du cabinet ; contrôles avant
  écriture : existence dans le cabinet, produit cohérent, portefeuille du
  courtier). L'insertion passe par les couches produit (`ajouterVehicule`,
  `ajouterConducteur`, `ajouterBatiment`…) — chaque élément crée sa
  version figée ; audit `analyse_inseree` détaillé (nombre d'éléments par
  liste) et `analyse_listes_ajoutees`. Quand une liste est insérée à la
  création d'une soumission auto/biens/RC, les garanties se rattachent au
  **premier élément de la liste**. Colonne `analyses_documents.listes_proposees`
  ajoutée (les propositions scalaires restent dans `champs_proposes`).
  Test bout-en-bout : `test-analyse-parcours-flotte.js` (37) — police PDF
  (annexe 4 véhicules) → soumission créée (4 véhicules + garanties, valeur
  corrigée à la révision respectée) ; Excel permis (4 conducteurs) →
  ajoutés à la **même** soumission (+ 1 ligne manuelle) ; fiche flotte
  complète, bouton Proposition actif, PDF généré.
- **Étape 4 — Finalisation** : balayage complet (journal
  `~/workspace/balayage-analyse-ia-v2-final.log`), règle d'or statique
  (zéro `DELETE` dans tout le code v2 ; les lignes décochées à la révision
  ne sont simplement pas insérées ; les analyses restent archivées
  douces), captures 111-113 revues, ZIP
  `~/workspace/your_files/courtier-analyse-ia-v2-final.zip`.

**Balayage final v2 : 4699/4699 tests, 79 suites** (les 76 suites de la
v1 + `test-analyse-listes` 39, `test-analyse-tableur` 24,
`test-analyse-parcours-flotte` 37 ; `test-dictionnaire` relancée verte
après documentation de la nouvelle colonne). Dictionnaire : **78 tables,
909 colonnes** (nouvelle colonne `analyses_documents.listes_proposees`) ;
exports inchangés : **36 modules**.

**Limites honnêtes v2** : la qualité du découpage en blocs dépend de la
mise en page du document source (annexes « un véhicule par bloc » ou
« une ligne par véhicule » bien lues ; tableaux très libres ou scans de
mauvaise qualité → éléments manquants ou confiance basse, d'où la
révision obligatoire) ; les tableurs très tordus (en-têtes sur deux
lignes, en-têtes décalés par des lignes de titre, feuilles multiples)
sont traités au mieux — **feuille 1 par défaut** ; les sinistres (5 ans)
et infractions (3 ans) par conducteur ne sont ni dans la police ni dans
l'Excel de permis : ils restent à obtenir du client ou du dossier SAAQ ;
les garanties *voulues* différentes de la police actuelle restent un
choix du courtier à la révision.

Captures v2 : `111-analyse-listes-revision.png` (révision de la police
PDF : section « Véhicules (4) » éditable, nouvelle cible visible),
`112-analyse-excel-conducteurs.png` (révision de l'Excel des permis :
« Conducteurs (4) » champ par champ, message « Tableur reconnu »),
`113-soumission-flotte-complete.png` (fiche flotte après les deux
insertions : 4 véhicules, 4 conducteurs, garanties, bouton Proposition
actif, historique des versions).

## Boucle courriel : informations manquantes

La boucle ferme le circuit entre la détection des manques, le client et
la fiche : le système repère ce qui manque à une soumission, compose un
courriel de questions, puis analyse la réponse du client (texte + pièces
jointes) et complète la fiche — **toujours après révision humaine, et
jamais d'envoi sans validation explicite**.

- **Étape 1 — Détection des informations manquantes** (`lib/manques.js`) :
  pour chacun des 9 produits, calcule les manques structurés `{ cle,
  niveau (entete/garanties/antecedents/liste), element, champ, libelle,
  question }` — la question est une phrase FR contextualisée prête à
  poser (« Pour le bâtiment situé au 1200 boul. Industriel (Laval) : le
  bâtiment est-il protégé par des gicleurs ? »). Règles : en-tête
  incomplet, garanties absentes ou partielles, antécédents absents
  (questions de confirmation), et **par élément de liste** les champs
  critiques vides (en profondeur pour les bâtiments biens et les
  conducteurs/véhicules flotte et auto ; mesures de sécurité clés en
  cyber : MFA, sauvegardes, antivirus/EDR ; base de calcul en perte
  d'exploitation ; finances de la ligne en cautionnement ; pièges E&O
  circonstances / D&O poursuites même quand le bloc antécédents existe).
  Section **« ❓ Informations manquantes »** sur les 9 fiches soumission :
  manques groupés + compteur, suivi des demandes, ou « ✅ Dossier
  complet ». Test : `test-manques.js` (30, suite modèle).
- **Étape 2 — Courriel de questions** (`lib/demandes-infos.js`,
  `routes/demandes-infos.js`, table `demandes_infos`) : bouton **« ✉️
  Demander au client »** → brouillon généré par gabarit FR (destinataire
  pré-rempli depuis l'entreprise, questions numérotées groupées par
  élément, demande explicite de répondre dans le même courriel),
  **entièrement modifiable** (destinataire, sujet, corps). Envoi
  seulement au clic sur « Envoyer » : SMTP du module Courriels si un
  compte d'envoi est actif, sinon **mode simulé** clairement affiché et
  journalisé (`mode_envoi = 'simule'`, aucun courriel réel ne part).
  Statuts : `brouillon → envoyee → partiellement_completee → completee` ;
  audit `demande_info_%`. Test : `test-demande-questions.js` (32 —
  génération, édition, envoi simulé journalisé, cloisonnement
  inter-cabinets, courtier hors portefeuille 403, CSRF).
- **Étape 3 — Analyse de la réponse** (`lib/reponses-infos.js`) : sur un
  courriel reçu, bouton **« 🤖 Analyser la réponse »**. Correspondance
  avec la demande : par le **fil** (In-Reply-To = message_id de la
  demande — la synchro IMAP conserve désormais l'en-tête et les **pièces
  jointes**, table `courriel_pieces_jointes`), sinon par l'**objet**
  (Re: retiré), sinon **choix manuel** parmi les demandes ouvertes. Le
  corps passe par le moteur d'analyse de documents (local/Cohere selon
  les réglages), chaque pièce jointe par le pipeline complet (PDF, OCR,
  tableur — le moteur tabulaire couvre désormais aussi la mécanique des
  bâtiments : superficie, étages, gicleurs, caserne, chauffage, toiture,
  et normalise « Béton » → `beton`) ; les propositions fusionnées
  affichent leur **source** (« Réponse courriel » ou nom du fichier).
  Des **propositions ciblées** repèrent dans le texte les réponses aux
  questions posées (« Gicleurs : oui », « Superficie : 12 000 pi² »,
  année de toiture, type de construction…), présentées dans un tableau
  dédié de la révision, avec la **soumission de la demande
  pré-sélectionnée** comme cible « soumission existante ». À
  l'insertion : listes ajoutées + réponses ciblées écrites dans les
  éléments existants, puis questions fermées **de deux façons** — la
  réponse ciblée acceptée (couvre « Gicleurs : non » = 0) et le recalcul
  des manques — et statut de la demande mis à jour. Audit
  `reponse_analysee`. Test parcours complet + partiel :
  `test-analyse-reponse.js` (31).
- **Étape 4 — Suivi et relance** : la fiche soumission affiche
  l'historique des demandes (envoyée le…, complétée le…, questions
  restantes en évidence). **« 🔁 Relancer »** crée une **nouvelle**
  demande liée (`parent_id`), pré-rédigée en ton de relance, avec
  **seulement les questions restantes** — même circuit de validation
  avant envoi, jamais d'écrasement de la demande initiale. Test :
  `test-relance-demande.js` (18).

Règle d'or : les demandes et les pièces jointes ne se suppriment pas
(archivage doux) ; aucun `DELETE` sur `demandes_infos`.

**Balayage final boucle courriel : 4810/4810 tests, 83 suites**
(journal `~/workspace/balayage-boucle-courriel-final.log`) — les 79
suites de l'analyse IA v2 (4699) + les 4 nouvelles (111). Dictionnaire :
**80 tables, 942 colonnes** (nouvelles tables `demandes_infos` et
`courriel_pieces_jointes` ; nouvelles colonnes `analyses_documents.
demande_info_id`, `.courriel_id`, `.reponses_ciblees` et
`courriels.en_reponse_a`) ; exports inchangés : 36 modules.

**Limites honnêtes** : les réponses en texte très libre (sans formule
« champ : valeur ») passent par le moteur général avec une confiance
parfois basse — la révision reste le garde-fou ; la correspondance par
le fil suppose que le client réponde dans le même fil (s'il change
l'objet, le choix manuel prend le relais) ; l'envoi **réel** exige le
SMTP du cabinet, configuré au déploiement (sinon mode simulé).

Captures boucle courriel : `114-manques-fiche.png` (fiche biens : 12
manques groupés, demande envoyée en attente), `115-courriel-questions.png`
(page de préparation : questions numérotées, mention du mode simulé,
corps modifiable), `116-analyse-reponse.png` (révision d'une réponse :
réponses aux questions, sources, cible pré-sélectionnée, liste bâtiments
de la pièce jointe), `117-demande-completee.png` (fiche : demande
complétée, dossier complet).

## Classement intelligent des courriels

À la réception, un courriel d'**assureur** (avis, note de couverture,
certificat) arrivait non classé : son adresse ne correspond à aucun
client. Le classement intelligent (`lib/classement-courriels.js`)
rattache désormais chaque courriel — reçu **et** envoyé — au bon
dossier, et peut le lier à la **police précise**.

**Ordre de priorité** (fonction pure `classerCourriel`, lecture seule —
l'appelant décide d'écrire) :

1. **Numéro de police** — les numéros connus **du cabinet seulement**
   sont cherchés dans le sujet + le corps : `polices.numero_police`
   (→ client **et** police), le `numero_police` des soumissions qui en
   portent un (flotte, cautionnement) et le `numero_police_actuelle`
   des antécédents des 9 produits (→ client seulement, via la
   soumission parente ; `numero_ligne_actuelle` en cautionnement).
   Comparaison **exacte** après normalisation (majuscules, sans
   accents, espaces ni tirets — un numéro écrit « FLT 2026 90001 » est
   reconnu) ; les fragments de moins de 5 caractères sont ignorés.
2. **Fil** — le message répond (In-Reply-To) à une demande
   d'informations du cabinet : il rejoint le client de cette demande.
3. **Adresse** — l'adresse de l'expéditeur (ou du destinataire pour les
   envois) correspond à un client ou à un de ses contacts
   (`lierClientAuto`, le mécanisme historique).
4. **Nom d'entreprise** — la raison sociale **complète** d'un client
   (normalisée casse/accents, 6 caractères significatifs minimum) est
   repérée dans le sujet ou le corps.

**Garde-fous** : correspondance **unique** exigée — un numéro porté par
deux clients différents ne classe rien ; si deux méthodes désignent
deux clients différents, **aucun classement automatique** : la
correspondance la plus précise devient une **suggestion** affichée dans
le filtre « À classer », validable en un clic. Un lien posé
manuellement (`classement_methode = 'manuel'`, y compris un déliage
délibéré) n'est **jamais** réécrit par le classement automatique — la
synchro n'insère que les nouveaux messages et le reclassement en lot
saute les lignes manuelles.

**Traçabilité** : nouvelles colonnes `courriels.police_id`,
`courriels.classement_methode` (`fil`/`numero_police`/`adresse`/
`nom_entreprise`/`manuel`/`aucun`) et `courriels.classement_detail`
(le numéro, l'adresse ou le nom ayant servi), documentées au
dictionnaire dès la migration.

**Interface** : badge de méthode sur chaque courriel classé de la
liste (« 🔗 N° de police FLT-2026-90001 », « ✉️ Adresse connue »,
« 🏢 Nom d'entreprise », « ✋ Manuel », « 🧵 Fil de réponse ») ;
filtre **« 🗂️ À classer (n) »** avec suggestion et liaison en un
clic ; bouton **« ♻️ Reclasser les non classés »** (applique les
classements non ambigus seulement, journalise le lot dans l'audit —
action `courriels_reclasses` — et affiche le résumé : X classés,
Y suggestions, Z sans correspondance) ; la vue d'un message affiche
son classement et permet de lier à un client **et à une de ses
polices** (une police d'un autre client est refusée) ; la **fiche
police** (`/echeances/police/:id`) gagne une section **« ✉️ Courriels
liés »** (date, expéditeur/destinataire, sujet, lien vers le message).

Test : `test-classement-courriels.js` (33 — moteur : numéro dans le
sujet, dans le corps transféré, écrit avec espaces, venu d'une
soumission ou d'un antécédent, adresse, nom, fil, conflit avec
suggestion, numéro ambigu, fragment trop court, numéro proche,
cloisonnement inter-cabinets ; HTTP : filtre et suggestions,
reclassement en lot + audit + CSRF, badge, liaison manuelle
client + police jamais réécrite, fiche police, 404 inter-cabinets).
Aucun courriel réel n'est envoyé ni reçu pendant les tests : les
messages sont insérés en base tels que la synchro les écrirait.

**Balayage final classement courriels : 4843/4843 tests, 84 suites**
(journal `~/workspace/balayage-classement-courriels-final.log`) — les
83 suites de la boucle courriel (4810) + la nouvelle suite (33).
Dictionnaire : **80 tables, 945 colonnes** (nouvelles colonnes
`courriels.police_id`, `.classement_methode`, `.classement_detail`) ;
exports inchangés : 36 modules.

**Limites honnêtes** : le nom d'entreprise doit apparaître **en
entier** tel qu'il figure au dossier (une abréviation ou un surnom ne
classe pas — l'adresse et le numéro restent les signaux forts) ; un
numéro de police partagé entre deux clients (ex. police mère citée
dans les antécédents d'un autre dossier) reste volontairement non
classé, avec suggestion si une autre méthode désigne un client ; les
courriels reçus **avant** cette fonction gardent leur classement
d'origine (adresse ou manuel) — le bouton « Reclasser » ne touche que
les non classés.

Captures classement courriels : `118-courriels-badges.png` (liste des
courriels reçus : badges des quatre méthodes, compteur « À classer
(1) », bouton de reclassement), `119-police-courriels.png` (fiche
police CGL-2025-10001 : section « Courriels liés » avec l'avis de
renouvellement de l'assureur).

## Ouvrir un dossier à la voix + Google Maps

Chez un client, on ouvre un dossier en dictant une note libre — sans rien taper au clavier.

**Le parcours** (menu « 🎙️ Ouvrir un dossier ») :

1. **Dictée ou texte.** Micro (reconnaissance vocale fr-CA du navigateur, la même que l'assistant) ou zone de texte — le résultat est identique. Exemple : « Nouveau dossier : Plomberie Saint-Laurent inc., contact Mario Tremblay, téléphone 514 555-0142, situé au 450 rue des Érables, Montréal. Commence une soumission biens. Bâtiment : construction béton, année 1998, superficie 12 000 pieds carrés, gicleurs oui, valeur 1 500 000 dollars. »
2. **Analyse.** Le texte passe par le moteur d'analyse de documents (produit détecté, champs, listes) complété par les motifs de la dictée : la note est restructurée en lignes (« Bâtiment : », « Véhicule : », « Conducteur : »…), l'entreprise et le contact sont extraits, les faits du bâtiment dicté (béton, année, superficie, gicleurs, valeur) et la valeur du véhicule (« valeur 45 000 dollars ») sont comblés.
3. **Enrichissement Google Maps** (si la clé est configurée) : la recherche **Places (New)** part automatiquement sur le nom + la ville ; la section « 🗺️ Trouvé sur Google Maps » propose les candidats (adresse complète, téléphone, note et nombre d'avis, statut). Un clic remplit l'entreprise (adresse normalisée, ville, province, code postal, téléphone, site web) et retient le `place_id`. Si un client du cabinet porte déjà ce `place_id`, la bannière **« Ce dossier existe déjà »** pointe vers lui. Sans clé, la section le dit sobrement — l'ouverture fonctionne sans l'enrichissement.
4. **Révision complète, toujours.** Entreprise (avec bannière « Entreprise existante probable » si le nom normalisé correspond à un dossier, choix Créer quand même / Utiliser l'existante), contact, produit (détecté, modifiable ; obligatoire si rien n'a été détecté), champs de la soumission et éléments dictés éditables ligne par ligne. **Rien n'est créé avant le clic.**
5. **« ✅ Créer le dossier »** : le client est créé (avec son `place_id_google`), le contact principal aussi, la soumission du produit est ouverte chez CE client avec les éléments versés, et la note dictée reste conservée dans le dossier (fichier + texte de l'analyse). Journal : `dossier_ouvert_voix`. On arrive sur la fiche de la soumission, avec la section « ❓ Informations manquantes » déjà affichée — la boucle courriel peut partir de là.

**Le même enrichissement existe au formulaire d'entreprise** : bouton « 🔍 Rechercher sur Google Maps », candidat choisi = formulaire rempli et `place_id_google` enregistré à la création.

**La clé Google** se règle dans **Admin → 🔑 Clé IA (Cohere)**, section « 🗺️ Clé Google Maps (Places) » : même mécanique que la clé Cohere (chiffrée AES-256-GCM, affichée masquée, bouton « Tester la connexion », admin seulement). Elle se crée dans **Google Cloud Console** (projet du cabinet, facturation activée, API « Places API (New) » activée) — coût : quelques cents par dossier ouvert. Google fournit l'adresse, le téléphone, le site web et la note ; **pas** le NEQ ni les détails du bâtiment : l'enrichissement est un pré-remplissage, toujours révisé par un humain. La base d'URL de l'API est surchargeable (`PLACES_BASE_URL`) pour les tests, qui n'appellent jamais le vrai Google (harnais local : `scripts/harnais-places.js`, suites `test-places-google` et `test-ouverture-voix`).

## Vérification automatique des avenants

Quand l'assureur retourne son document (avenant, note de couverture), le système compare **ce qui avait été demandé** avec **ce que l'assureur a réellement appliqué** — et produit un rapport d'écarts. Le rapport propose, l'utilisateur tranche : rien n'est décidé automatiquement.

**Où** : sur la fiche police (`/echeances/police/:id`), carte « 🔍 Vérification de l'avenant ».

**Deux sources possibles** pour le document de l'assureur :
1. **Déposer le document** (PDF, image, Word, Excel — 15 Mo max) : il passe par le pipeline d'analyse existant et l'analyse produite est rattachée à la police.
2. **Choisir une pièce jointe** d'un courriel déjà classé sur cette police (liste tirée des courriels liés) : elle est analysée à la demande.

**Le rapport** (table `verifications_avenants`, moteur `lib/verification-avenant.js`) compare champ par champ, avec normalisations : nombres (« 2 500 $ » = 2500, virgule décimale, espaces insécables), dates (formats FR et ISO ramenés à l'ISO), booléens (oui/non/1/0), textes et codes (« Béton » = `beton`), numéros (espaces et tirets ignorés — le n° de police écrit « bie 2026 001 » égale « BIE-2026-001 »). Verdicts par ligne : **conforme**, **écart** (les deux valeurs citées), **absent** (demandé, introuvable dans le document), **à confirmer** (extraction incertaine ou formats non comparables — jamais de verdict sec, les deux valeurs restent affichées côte à côte) et **non demandé** (présent dans le document seulement). Statut global : conforme / écarts détectés / à confirmer.

- **En profondeur pour les biens** : bâtiments appariés par adresse normalisée, garanties par bâtiment (formule, franchise, montant, prime), contenus par description, valeurs.
- **Pour les 9 produits** : en-tête (assureur, n° de police, dates, prime), garanties principales (franchise et limite de la police, montants du produit) et présence des éléments des listes (véhicule par NIV, conducteur par n° de permis, dirigeant par nom, établissement par adresse, obligation par type et bénéficiaire…). Pour les éléments appariés, seuls les champs présents des deux côtés sont comparés.
- L'**état « demandé »** est l'état courant de la fiche de la police au moment de la vérification (c'est là que la modification a été faite et versionnée).

**« ✔ Marquer comme vérifiée »** : quand l'utilisateur accepte le rapport ; journalisé (`avenant_verifie`, avec le statut). Une vérification déjà marquée refuse un second marquage.

**Correction à l'assureur** : si le rapport contient des écarts, des absents ou des éléments non demandés, le bouton **« ✉️ Demander la correction à l'assureur »** ouvre un brouillon pré-rédigé — destinataire : le service des modifications de l'assureur (sinon son courriel général), sujet « Correction d'avenant — police … », corps qui **cite chaque écart un par un** (« Franchise demandée : 1 000 $ — appliquée dans votre document : 2 500 $. »). Entièrement modifiable ; l'envoi part par le module Courriels, **au clic explicite seulement** — sans compte d'envoi configuré, il est simulé et journalisé comme tel (`correction_avenant_envoyee`, mode `simule`/`smtp` conservé sur la vérification). Aucun bouton de correction quand tout est conforme.

**Limites assumées** : la comparaison est fiable sur les montants, les dates, les franchises et les éléments identifiés (adresse, NIV, permis) ; un avenant rédigé en texte libre exotique produira des verdicts « à confirmer » avec les valeurs côte à côte plutôt que de faux écarts. Les contenus des bâtiments et les garanties par élément ne sont comparés que si le document de l'assureur les énumère aussi.

## Correctif — révision d'analyse : le client d'abord

Retour de Patrick en testant la version publiée : la révision d'une analyse proposait, pour un document « Cyber », une soumission Auto d'un autre client et une police d'un troisième — alors qu'un document, ses soumissions et ses polices appartiennent au **même client**. Correctif appliqué (`routes/analyses.js`, `views/analyses/fiche.ejs`, `public/analyse-revision.js`, `lib/analyse-insertion.js`) :

- **« Client du document » choisi en premier**, au-dessus du produit et des cibles : sélecteur des entreprises du cabinet, **pré-sélectionné** par résolution en lecture seule (`trouverClient` — correspondance de la raison sociale extraite, sans jamais créer de client sur un affichage). Analyse liée à une demande d'informations : client = celui de la demande, **verrouillé** en lecture seule.
- **Rattachements filtrés** : les sélecteurs « soumission existante » et « police existante » ne proposent que les éléments **du client choisi** (soumissions : **du produit choisi** en plus), filtrés en page à chaque changement ; messages « Aucune soumission du produit choisi pour ce client » / « Aucune police pour ce client » quand la liste filtrée est vide. Sans client choisi, les rattachements sont désactivés.
- **Contrôle serveur** (l'écran ne suffit pas) : le POST d'insertion reçoit `client_id` et refuse en **400 explicite** (« La soumission choisie n'appartient pas au client sélectionné » / idem police) tout rattachement incohérent. Les créations acceptent le **client forcé** (`options.clientId` de `creerSoumission`/`creerPolice`) : la soumission/police naît chez CE client, même si le nom extrait du document ne correspond à personne. Sans choix, l'ancien comportement (résolution/création par raison sociale) est conservé. Le contrôle portefeuille courtier s'applique au client final. Analyse liée à une demande : le client est **imposé par la demande** côté serveur, quoi que le formulaire envoie.

Test : `scripts/test-analyse-client-cible.js` (36 vérifications — fiche et pré-sélection, données de filtrage, refus 400 sans rien insérer, insertion cohérente, création forcée, verrouillage demande, CSRF). Capture 126.

## Menu principal réorganisé par sections

Demande de Patrick : « réorganise le menu pour qu'il soit plus naturel, moins de liens, mets-les par section, plus simple à trouver ». La barre du haut (`views/partials/haut.ejs`) ne présente plus ~26 liens à plat mais :

- **Échéances** en lien direct, seul en tête (l'écran du travail quotidien) ;
- **7 sections métier dépliantes** — 👥 Clients (Entreprises, Leads) · 📝 Soumissions (les 9 produits) · 🛡️ Polices (Polices, Réclamations) · ✉️ Communications (Courriels, Brouillons, Campagnes, Réunions) · 🤖 Outils IA (🎙️ Ouvrir un dossier, 📥 Analyser un document, Assistant IA) · 🗂️ Gestion (Assureurs, Facturation, Tâches, Import, Exports) · ⚙️ Admin (Admin, Journal — rôle admin seulement, comme avant).

Mécanique : `<details>`/`<summary>` natifs stylés dans `public/style.css` — **aucun JavaScript requis**, tous les liens restent présents dans le HTML. La section de la page courante est **ouverte par défaut**, son libellé est marqué (`summary.courant`, souligné) et le lien courant est surligné (`a.actif`), à partir de `res.locals.cheminActuel` posé par `lib/middleware.js`. Mobile d'abord : sous 760 px, la nav passe en pleine largeur en colonne (zones tactiles ≥ 40 px) ; sur écran large, les sections sont en ligne dans la barre et le panneau se déplie en surimpression. Aucune URL ni aucun libellé n'a changé, aucun lien perdu.

Test : `scripts/test-menu-sections.js` (101 vérifications — chaque page principale répond, les 7 en-têtes de section présents, les 28 liens historiques présents exactement une fois avec la bonne URL, section courante marquée page par page, section Admin absente pour un rôle non-admin). Captures 127 (mobile, menu fermé), 128 (mobile, Soumissions dépliée), 129 (bureau, panneau en surimpression).

## Moteur IA Augure (canadien)

**Augure AI** (augureai.ca) est un fournisseur d'inférence **entièrement canadien** — aucun fournisseur américain, entente de traitement des données (DPA) disponible. Son API est **compatible OpenAI** : `POST https://api.augureai.ca/v1/chat/completions`, authentification par clé Bearer, aucun SDK requis. Il est intégré comme troisième moteur IA de l'application, en symétrique de Cohere, sans rien changer au moteur local.

**Réglage** — **Admin → 🔑 Clé IA (Cohere)**, section « 🇨🇦 Clé Augure (IA canadienne) », admin seulement :

- **Clé API du cabinet** : stockée **chiffrée AES-256-GCM** (colonne `reglages_ia.cle_augure_chiffree`, même mécanisme que les clés Cohere et Google), affichée **masquée** (4 derniers caractères), jamais journalisée en clair ; boutons enregistrer / retirer / « Tester la connexion » (GET `/models`, repli sur un micro-appel chat). Une clé d'environnement `AUGURE_API_KEY` peut aussi servir au déploiement (le réglage du cabinet a priorité).
- **Modèle du cabinet** (colonne `reglages_ia.modele_augure`, défaut `ossington-5`), prix en CAD par 1M de jetons entrée/sortie : `ossington-5` raisonnement rapide, contexte 256K (1,50/3,00) · `ossington-4` (2,00/5,00) · `ossington-4-1` (2,50/6,00) · `rosedale-1` raisonnement premium multi-étapes, contexte 1M (2,50/6,00) · `tofino-3` léger rapide (0,60/2,00) · `open-glm-5-3` aperçu poids ouverts (3,00/7,00).

**Choix du moteur** (même sélecteur qu'avant, `lib/reglages-ia.js`) : **Local / Cohere / Augure / Auto**. **Auto = Augure si sa clé est configurée, sinon Cohere si la sienne l'est, sinon Local.** En cas d'erreur d'appel du moteur externe, repli sur le moteur local, **signalé** dans le résultat comme pour Cohere.

**Points d'appel** (`lib/augure.js` : `appelerAugure({ cle, modele, systeme, prompt, jsonMode })`, température 0, `response_format: { type: 'json_object' }` en mode JSON avec réessai sans `response_format` si le fournisseur le refuse) :

- **Analyse de documents** (`analyserAugure` dans `lib/analyse-document.js`) : même prompt JSON strict et même validation contre le dictionnaire que Cohere (fonctions partagées) — champs inconnus rejetés ; erreur → repli local signalé.
- **Commandes de l'assistant** (`interpreterAugure` dans `lib/commandes-ia.js` et `lib/assistant.js`) : même contrat JSON que `interpreterCohere` (prompt et parseur factorisés).
- **Brouillons IA** (`lib/ia.js`) : les 4 générateurs (renouvellement, relance, campagne, courriel libre) passent par Augure quand il est le moteur effectif du cabinet (les routes transmettent `cabinetId`) ; source affichée : `augure`.

**Mention de marque** : condition du fournisseur, le pied de page (`views/partials/bas.ejs`) affiche « Propulsé par Augure » **uniquement quand le moteur effectif du cabinet est Augure** (texte sobre, aucun logo externe ; `res.locals.moteurAugure` posé par `lib/middleware.js`).

**Tests** — aucun appel réel à Augure : base surchargeable par `AUGURE_BASE_URL` (défaut `https://api.augureai.ca/v1`) et harnais local au format OpenAI. `scripts/test-augure-reglage.js` (35 vérifications : client, erreurs 401/429/400, clé chiffrée et masquée, 403 non-admin, modèle persisté, `moteurEffectif` dans chaque configuration) et `scripts/test-augure-moteur.js` (24 vérifications : analyse flotte via Augure, JSON invalide → repli local signalé, commande interprétée, brouillon généré, moteur Local → zéro appel au harnais, mention de marque présente/absente). Captures 130 (Admin, section Augure) et 131 (analyse « Moteur : augure »).

## Soumission combinée entreprise (Biens + RC + Perte d'exploitation)

La plupart des soumissions commerciales sont des **combinées** : un seul dossier qui **lie** — sans les fusionner — une soumission **biens**, une soumission **responsabilité civile** et une soumission **perte d'exploitation** du **même client** (menu 📝 Soumissions → **Combinée**, routes `/combinees`). Toute la mécanique des produits survit (versions, exports, analyses de documents, conversion en police) ; le contrôle « même client » des liaisons est fait **côté serveur**.

**Saisie unique, aux bons endroits** :

- **Entreprise** : le profil de souscription vit sur la fiche client (forme juridique, année de fondation, années d'expérience, noms d'exploitation, description des activités, code et description d'industrie + % des revenus, répartition des recettes par type d'activité et géographique Canada/États-Unis/étranger/internet, employés temps plein/partiel, CSST, masse salariale, responsabilité pour l'alcool, % de sous-traitance) — il alimente toutes les soumissions du client.
- **Emplacement maître** : `biens_batiments` devient la fiche emplacement unique (les établissements PE et les lieux RC s'y rattachent par `batiment_id`) : construction par composant (murs, structure et finition de toit, sols, sous-sol) + **classe de construction assureur**, rénovations par système (année **et** ampleur), mécanique, protection incendie (prise d'eau, caserne, gicleurs % couvert), risques criminels, **voisinage structuré** (gauche/droite/arrière/en face : affectation + distance), affectation (intérêt, superficie occupée, autres occupants), + **questionnaire alarme** technique par emplacement (transmissions, centrale, certificat ULC, répondants, protections physiques, coffre-fort).
- **Garanties structurées** : règle proportionnelle (bâtiment, contenu, perte), franchise propre au contenu, **avenants avec franchise et montant propres** (refoulement d'égouts, inondation, tremblement de terre + sous-franchises % et minimum, frais communautaires de copropriété, extension hors lieux, pointe saisonnière, argent et valeurs, bris d'équipement avec montant par accident), RC complétée (préjudice personnel/publicité, frais médicaux par personne/par sinistre, responsabilité locative par lieu, autos non-propriétaires, **umbrella** montant + rétention + polices de base), perte complétée (formule, honoraires de comptables, montant PE par établissement), **assurance flottante des outils** en liste d'articles.
- **Antécédents communs** : saisis **une fois** dans la combinée (assureur et police précédente — type, date d'effet, prime —, refus/résiliation/non-renouvellement 5 ans, faillite/jugement, condamnation pour malhonnêteté, sinistres 5 ans enrichis payé/réserve/statut/description, interruptions PE) puis **synchronisés** vers les tables `*_antecedents` des 3 produits via leurs propres fonctions ; un enregistrement depuis une fiche produit n'écrase jamais ces champs.
- **Questions sectorielles** par code d'industrie (copropriété : carnet d'entretien, fonds de prévoyance, gestionnaire, ascenseur… ; entrepreneur : licence RBQ, types de travaux, sous-traitance…), réponses libres structurées rattachées au client.
- **Bénéficiaires et assurés additionnels** : créanciers/bénéficiaires **par emplacement** (adresse, qualité, clause de préavis de résiliation) et assurés additionnels réutilisables sur tout dossier (biens, RC, perte, combinée).

**Proposition combinée (demande de prix)** : génération **HTML et PDF** calquée sur le gabarit réel des envois — en-tête du cabinet (adresse, téléphone, télécopieur, site web, courriel, réglables dans Admin → Cabinets) → demande de prix (les colonnes **Taux et Prime restent vides**, à compléter par l'assureur) → renseignements généraux → sommaire de la police antérieure et des réclamations → **tableau des garanties consolidé** (Franchise / Règle proportionnelle / Montant) → **une page par emplacement** → bénéficiaires → **annexes conditionnelles** (flottante seulement si des articles existent, umbrella seulement si présent) → signature. Bouton « Créer le brouillon demande de prix » : le courriel est préparé dans **Brouillons** (envoi au clic seulement, jamais automatique).

**Alignement IA** : le dictionnaire des champs (88 tables) alimente l'analyse de documents — les nouveaux champs sont proposables par le moteur local (classe de construction convertie en code assureur, voisinage, rénovation de toiture, règle proportionnelle, umbrella, frais médicaux…) et par les moteurs externes (listes `META_LISTES.batiments` et champs `META_CHAMPS` étendus, validation inchangée), puis insérés dans la fiche emplacement. `lib/manques.js` ajoute les manques critiques de la combinée (profil entreprise, classe de construction, voisinage, liaisons PE/RC). Commandes de l'assistant : « crée une soumission combinée pour X » (confirmation d'abord) et « ouvre la soumission combinée de X ».

**Tests** : `scripts/test-combine-etape1.js` à `test-combine-etape10.js` (une suite par étape du plan : en-tête + entreprise, emplacement enrichi, alarme, garanties, RC/PE, antécédents + questions, bénéficiaires, dossier combiné en HTTP, proposition HTML/PDF, alignement IA). Captures 132 à 137 dans `demo-captures/commercial/`.

## Volontairement non inclus (phases suivantes)

- **Phase 2** : classification automatique des courriels (reçus/envoyés),
  brouillons de réponse, journal des communications, **notes vocales**
  (transcription Whisper auto-hébergée).
- **Phase 3** : soumissions (questionnaire par produit, dossier PDF,
  envoi aux assureurs), avenants et suivi.
- **Phase 4** : prix moyens calculés sur le portefeuille, alertes d'écart,
  détection des protections non souscrites + relances automatiques.
- Import **Excel (.xlsx)** natif (actuellement : CSV uniquement).
- Envoi réel des courriels (SMTP) — les brouillons sont à copier pour l'instant.
- Chiffrement AES-256 **au repos** de la base (SQLCipher) et sauvegardes
  chiffrées automatisées — prévus pour le déploiement sur le VPS du Québec.
