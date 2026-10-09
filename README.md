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
│   ├── magasin-session.js # Sessions Express stockées en SQLite
│   ├── middleware.js    # Auth, rôles, CSRF maison, audit, validation
│   ├── ia.js            # Brouillons IA : Cohere si clé dispo, sinon modèle local
│   ├── chiffrement.js   # AES-256-GCM (jetons Microsoft)
│   └── microsoft.js     # OAuth Microsoft Graph + création de réunions Teams
├── routes/
│   ├── auth.js          # Connexion, 2FA TOTP, changement de mot de passe
│   ├── admin.js         # Cabinets, utilisateurs, journal d'audit, réinitialisation mdp, Microsoft 365
│   ├── clients.js       # CRUD entreprises, consentements Loi 25, documents
│   ├── polices.js       # CRUD polices, protections, documents par police
│   ├── reclamations.js  # Réclamations : CRUD, statuts, suivis, rappels
│   ├── taches.js        # Tâches manuelles : CRUD, statuts, échéances
│   ├── echeances.js     # Tableau J-90/J-60/J-30, fiche de révision, rappels, comptes en retard, réunions
│   ├── import.js        # Import CSV en lot + modèle + rapport d'erreurs
│   ├── brouillons.js    # Brouillons IA (jamais d'envoi auto)
│   ├── factures.js      # Facturation : CRUD, paiements, relances via brouillons IA
│   ├── leads.js         # Leads : pipeline, suivis, conversion en entreprise, stats
│   ├── capture.js       # Formulaire public de capture (/capture/<jeton>, sans auth)
│   ├── campagnes.js     # Campagnes de sollicitation par classe d'affaires (export CSV)
│   └── reunions.js      # Réunions : CRUD, lien Teams manuel ou auto (Microsoft 365)
├── views/               # Gabarits EJS en français (partials/, pages par module)
├── public/              # style.css + app.js (aucun framework frontend)
├── uploads/             # Documents (par cabinet)
└── scripts/
    ├── test-phase1.js       # Ancienne suite (schéma pré-commercial, obsolète)
    ├── test-ajustements.js  # Suite de référence : 47 tests bout en bout
    ├── test-nouveaux-modules.js # Nouveaux modules : 65 tests bout en bout
    └── exemple-import.csv   # Modèle CSV (entreprises, produits commerciaux)
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

> **SMTP à venir** : l'envoi réel des courriels (relances, campagnes) n'est pas encore
> intégré — tout passe par des brouillons à valider manuellement. L'envoi SMTP sera ajouté
> au déploiement.

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

## Tests

```bash
# lancer le serveur sur un port de test avec une base FRAÎCHE, puis :
PORT=3101 node scripts/test-ajustements.js
PORT=3101 node scripts/test-nouveaux-modules.js
PORT=3101 node scripts/test-principes.js
```

`test-ajustements.js` — 47 tests : login/CSRF, changement de mdp forcé, seed commercial, CRUD entreprise
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

`test-principes.js` — 111 tests : règle d'or « rien ne se supprime ». Cycle complet
d'archivage (archiver → invisible en liste → visible via « Voir les archivés » →
désarchiver → visible) pour entreprises, tâches, leads, campagnes, réunions,
brouillons et réclamations ; CSRF exigé sur ces routes ; archivages journalisés ;
versioning des polices (création = v1, modification = v2, ajout/retrait de
protection = v3/v4, snapshots intacts et consultables en lecture seule) ;
statuts de réclamation Ouverte/Fermée (anciens statuts → 400) ; anciennes routes
`…/supprimer` → 404 ; désactivation d'utilisateur (login refusé 401, session
coupée, réactivation, auto-désactivation refusée) ; cloisonnement des archives
et des versions entre cabinets.

> `test-phase1.js` correspond à l'ancien schéma (auto/habitation) et n'est plus
> exécuté — la suite de référence est `test-ajustements.js`.

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
