# Référence — Automatisation du métier de courtier : couverture actuelle et feuille de route

**Objet** : croisement entre le *Guide complet des fonctions, responsabilités et obligations d'un courtier en assurance de dommages* (fourni par Patrick le 2026-10-21, sauvegardé dans `REFERENCE-REFERENTIEL-COURTIER.md`) et l'état réel de l'application `courtier-app` (Node/Express/SQLite — 5404 tests, 101 suites, dictionnaire 88 tables / 1199 colonnes au moment de l'analyse).

**Demande de Patrick** : que l'IA connectée puisse automatiser l'ensemble de ses tâches de courtier à partir des informations entrées et sorties du système (« 100 % automatisé »).

**Principe directeur (posé par le guide lui-même, §15.2, et déjà appliqué dans l'app)** : l'automatisation **prépare, détecte, génère, classe, vérifie et suit** — elle ne décide **pas** seule de l'adéquation d'une couverture, n'atteste **pas** qu'une garantie est en vigueur et ne modifie **pas** une déclaration importante sans validation humaine. Dans l'app, ce principe est déjà concret : aucun courriel ne part sans un clic explicite (envois SMTP réels ou mode simulé journalisé), aucune analyse de document ne s'insère sans révision humaine, aucun brouillon n'est envoyé automatiquement.

**Méthode** : chaque statut ci-dessous est appuyé sur des preuves vérifiées dans le code (tables de `lib/bd.js`, modules `lib/`, routes `routes/`, fonctions nommées). Aucun statut n'est deviné. Légende : ✅ couvert · 🟡 partiel · ❌ absent.

**Synthèse chiffrée (détails plus bas)** :

| Axe | ✅ | 🟡 | ❌ | Total |
|---|---|---|---|---|
| Modules (§15 du guide) | 2 | 15 | 1 | 18 |
| Formulaires (F01–F20) | 3 | 13 | 4 | 20 |
| Automatisations (§15.2) | 3 | 7 | 6 | 16 |

---

## 1. Matrice de couverture par module (§15 du guide)

### 01 — Client (identité, coordonnées, autorisations) — ✅ Couvert

**Preuves** : table `clients` (raison sociale, NEQ, secteur, adresse, langue, responsable_id, archivage) ; table `contacts` (contacts multiples par entreprise, contact principal) ; table `consentements` (type, accepté, date — par client) ; `leads` + `lead_suivis` avec conversion en client (`routes/leads.js` POST `/:id/convertir`) ; réunions liées au client ; cloisonnement par cabinet et par portefeuille (courtier = ses clients via `responsable_id`).

**Ce qui manque** : personne autorisée à signer nommée comme telle (les contacts ont un titre, pas un rôle « signataire ») ; adresses distinctes siège social / postale / risque (une seule adresse + les adresses des emplacements) ; motif de la demande structuré à l'ouverture (voir F01).

### 02 — Entreprise (activités, revenus, employés, opérations) — 🟡 Partiel

**Preuves** : profil de souscription du client construit avec la combinée (`lib/combine.js`, colonnes ajoutées à `clients` dans `lib/bd.js` vers la ligne 2401 : `forme_juridique`, `annee_fondation`, `annees_experience`, `repartition_revenus_types` et `repartition_revenus_geo` en JSON, `masse_salariale`, `nb_employes_temps_plein/partiel`, `employes_csst`, `responsabilite_alcool`, code et description d'industrie) ; `chiffre_affaires`, `nb_employes` historiques ; questions sectorielles par client (`client_questions_sectorielles`).

**Ce qui manque** : revenus des 3 dernières années et prévisions ; obligations contractuelles du client (clauses d'indemnisation, limites exigées par contrat, renonciation à subrogation, assurés additionnels exigés) comme données structurées ; produits fabriqués/importés/distribués détaillés hors questions sectorielles ; états financiers comme documents attendus suivis.

### 03 — Emplacements (bâtiments, occupation, prévention) — ✅ Couvert

**Preuves** : `biens_batiments` enrichi à l'étape 2 de la combinée (+58 colonnes : construction par composant — murs, structure, finition de toit, planchers, sous-sol — classe de construction assureur, rénovations par système avec année **et** ampleur, mécanique, protection incendie, risques criminels, affectation, **voisinage structuré 4 côtés** avec affectation et distance) ; table `biens_protections_alarme` (transmissions, centrale, certificat ULC, répondants, entretien, coffre) ; `emplacement_beneficiaires` ; l'emplacement biens est la fiche maîtresse référencée par `rc_exploitations.batiment_id` et `pe_etablissements.batiment_id`.

**Ce qui manque (mineur)** : date et auteur de l'évaluation du coût de reconstruction comme champs dédiés exploités par des alertes ; statut patrimonial ; périodes d'inoccupation datées ; mitoyenneté/murs coupe-feu en champs propres (présents seulement en texte libre dans certains champs).

### 04 — Actifs (véhicules, équipements, inventaires) — 🟡 Partiel

**Preuves** : véhicules et conducteurs illimités (FPQ1 `auto_vehicules`/`auto_conducteurs`, flotte `flotte_vehicules`/`flotte_conducteurs`) ; contenus par bâtiment (`biens_contenus`) ; assurance flottante des outils avec liste d'articles (`biens_flottante_articles`).

**Ce qui manque** : inventaire d'équipements et de machines structuré (âge, puissance, entretien, inspection — requis pour le bris d'équipement, §6.12 du guide) ; inventaires moyen/maximal et fluctuations saisonnières comme valeurs suivies par emplacement ; équipements hors véhicules pour les lignes autres que biens.

### 05 — Expositions (responsabilités, contrats, territoires) — 🟡 Partiel

**Preuves** : expositions portées par les produits (exploitations RC, activités E&O, questions additionnelles de la combinée par code d'industrie — observées dans les envois réels : dynamitage, amiante, travaux à chaud, etc.) ; répartitions géographiques des revenus (profil entreprise) ; `soumission_assures_additionnels`.

**Ce qui manque** : un registre des **contrats du client** (contrats de service, baux, contrats de construction) avec leurs exigences d'assurance (limites imposées, assurés additionnels, renonciation à subrogation, certificats à émettre) — aujourd'hui ces exigences ne sont ni saisies de façon structurée ni confrontées aux polices en vigueur.

### 06 — Sinistralité (historique, circonstances, mesures correctives) — 🟡 Partiel

**Preuves** : antécédents par produit (`*_antecedents` × 9) enrichis à l'étape 6 de la combinée (refus/résiliation/non-renouvellement 5 ans, type et prime de la police précédente, faillite, malhonnêteté) avec synchronisation depuis une saisie unique ; sinistres 5 ans dans les antécédents ; module `reclamations` + `reclamation_suivis` (montants réclamé/réglé, franchise appliquée, expert, date de rappel).

**Ce qui manque** : une vue sinistralité **au niveau client, tous produits confondus** (l'historique est éclaté par produit) ; la distinction du guide entre sinistre déclaré / réclamation payée / refusée / simple incident (statuts actuels simplifiés : ouverte/fermée) ; historique des primes par année ; litiges et circonstances connues suivis hors E&O/D&O.

### 07 — Besoins (protections recommandées et limites) — 🟡 Partiel

**Preuves** : `catalogue_protections` (protections par ligne, drapeau `recommandee`) et `police_protections` ; la fiche de révision d'une police (`routes/echeances.js`, `ficheRevision`) calcule les **protections recommandées manquantes** ; `lib/manques.js` détecte les informations manquantes par produit et pour la combinée.

**Ce qui manque** : la gradation du guide (protections **nécessaires / souhaitables / facultatives**) ; la trace des **protections offertes et refusées par le client** (aucun statut « refusée par le client » daté et signé — enjeu direct de responsabilité professionnelle, voir F16) ; l'analyse d'adéquation des limites (sous-assurance, coassurance) comme diagnostic structuré plutôt que comme simple absence de champ.

### 08 — Souscription (propositions et questionnaires spécialisés) — 🟡 Partiel (cœur complet, spécialisation embryonnaire)

**Preuves** : 9 produits complets (FPQ1, biens, RC, cyber, E&O, D&O, perte d'exploitation, flotte, cautionnement) avec questionnaires, propositions HTML/PDF et versions figées ; **soumission combinée** (Biens + RC + Perte liées, questionnaire unique en sections, proposition au gabarit réel de Patrick) ; analyse de documents IA qui propose les champs (local + Cohere + Augure) ; ouverture de dossier à la voix + Google Places.

**Ce qui manque** : les questionnaires spécialisés par secteur au-delà des 2 jeux actuels (copropriété 17 questions, entrepreneur 7 questions dans `lib/combine.js`) — le guide en exige par type de risque (F04–F14) ; les questionnaires d'assureurs réels (le BAC ne les publie pas ; ils viennent des assureurs/MGA, à alimenter par les documents de Patrick).

### 09 — Marchés (assureurs, soumissions, refus et relances) — ❌ Absent

**Preuves de l'absence** : aucune table d'envois aux assureurs dans `lib/bd.js` (88 tables vérifiées) ; la table `assureurs` + `assureur_produits` (`routes/assureurs.js`) est un **annuaire** (produits offerts, taux de commission, statistiques de portefeuille) — pas un registre de mise en marché. La combinée produit un brouillon « demande de prix » (`routes/combinees.js` POST `/:id/proposition-brouillon` → table `brouillons`, envoi au clic seulement) et le module Courriels permet d'écrire à n'importe qui (SMTP réel, `lib/courriels.js envoyerCourriel`), mais **rien ne relie un envoi à un assureur, à une version de proposition, à un statut ou à une réponse**. Aucune offre reçue, aucun refus, aucune relance assureur n'est enregistré de façon structurée.

**Ce qui manque** : tout le Formulaire 15 (voir §2) — c'est le plus gros trou fonctionnel du système, car il bloque la comparaison des offres (F16, §7.2 du guide) et les relances automatiques aux assureurs.

### 10 — Contrats (polices, garanties, franchises, exclusions) — 🟡 Partiel

**Preuves** : `polices` (lignes, assureur, numéro, effet/échéance, statut, liens vers la soumission et la version figée d'origine — y compris `combine_dossier_id`) ; `police_versions` (instantanés complets, lecture seule) ; `police_protections` (limites/primes par protection) ; **attestation/certificat généré** depuis une version (`routes/polices.js` GET `/:id/attestation/:vid`) ; vérification des documents reçus contre l'état demandé (`lib/verification-avenant.js`).

**Ce qui manque** : note de couverture (aucune génération — recherche négative) ; exclusions et conditions particulières structurées (elles vivent dans les avenants JSON des produits, pas comme clauses comparables) ; libellés de référence rattachés aux garanties (bibliothèque de wordings demandée par Patrick, non commencée) ; prime totale structurée au niveau police (elle est la somme des protections, sans taxes/honoraires).

### 11 — Modifications (avenants et changements de risque) — 🟡 Partiel (contrôle fort, demande absente)

**Preuves** : chaque modification d'une police crée une **nouvelle version figée** (`police_versions`, avec `avenant_note`) ; la **vérification automatique des avenants** compare le document de l'assureur à l'état demandé (conforme / écart / absent / à confirmer / surplus) et génère, en cas d'écart, un brouillon de demande de correction à l'assureur (envoi au clic).

**Ce qui manque** : la **demande** d'avenant elle-même (Formulaire 17) : formulaire avant/après structuré, autorisation du client datée, envoi à l'assureur tracé, suivi « envoyé le X → réponse → avenant reçu → vérifié → client avisé », prime additionnelle/ristourne rattachée à la facture. Aujourd'hui on contrôle le résultat, mais on ne pilote pas le processus.

### 12 — Renouvellements (révision annuelle et comparaisons) — 🟡 Partiel

**Preuves** : page **Échéances** (polices échues, J-30, J-60, J-90 — `routes/echeances.js`) ; fiche de révision par police (protections manquantes, documents, courriels liés, vérifications, réclamations) ; **brouillon de renouvellement généré par IA** (`lib/ia.js genererBrouillonRenouvellement`, jamais envoyé automatiquement) ; statut `a_renouveler` sur les polices.

**Ce qui manque** : la procédure phasée du guide (J-120/90/60/30 avec actions par phase et tâches générées) ; le **questionnaire de révision annuelle** (Formulaire 18) envoyé au client et analysé à la réponse (la boucle courriel existe pour les soumissions, pas pour la révision annuelle) ; la comparaison des valeurs/revenus **année sur année** ; la création systématique du dossier de renouvellement (remise en marché ou renouvellement direct) comme objet suivi.

### 13 — Réclamations (avis, références et suivis autorisés) — 🟡 Partiel

**Preuves** : `reclamations` + `reclamation_suivis` (`routes/reclamations.js` : CRUD complet, expert en sinistre nommé, rappels datés remontés au tableau de bord Échéances, rôle expert en sinistre prévu dans les accès) ; réclamations visibles sur la fiche police et la fiche de révision.

**Ce qui manque** : la **déclaration initiale structurée** du guide (Formulaire 19 : heure, circonstances, cause présumée, tiers, blessés, services d'urgence, mesures conservatoires, témoins, numéros de rapport, photos) ; la **transmission de la déclaration à l'assureur** depuis le dossier (avec accusé et numéro de réclamation retourné) ; le suivi des conséquences sur les renouvellements (lien sinistre → antécédents de la prochaine soumission).

### 14 — Comptabilité (primes, honoraires, taxes et paiements) — 🟡 Partiel

**Preuves** : `factures` + `paiements` (`routes/factures.js` : émission manuelle, paiements partiels, statuts émise/partielle/payée/en retard/annulée — jamais supprimée, annulation seulement) ; `marquerRetards` automatique ; soldes en retard au tableau de bord ; **brouillon de relance généré par IA** au clic (`genererBrouillonRelance`), jamais d'envoi automatique.

**Ce qui manque** : ventilation prime / taxes / honoraires (Formulaire 20) — la facture est un montant unique avec description libre ; échéancier de versements ; primes additionnelles et ristournes d'avenants liées automatiquement ; alerte « risque d'annulation pour non-paiement » comme suivi dédié ; rapprochement avec les commissions des assureurs (les taux existent dans `assureur_produits`, le calcul par police n'existe pas).

### 15 — Conformité (consentements, divulgations, vérifications) — 🟡 Partiel

**Preuves** : `journal_audit` (toute action sensible est journalisée, consultable dans Admin) ; `consentements` par client ; sécurité (bcrypt, 2FA TOTP, CSRF, sessions, chiffrement AES-256-GCM des clés et jetons) ; règle d'or « rien ne se supprime » appliquée partout (archivage, versions) ; dictionnaire des champs documenté et page Admin associée ; rôles et cloisonnement par cabinet.

**Ce qui manque** : la **grille de contrôle qualité d'un dossier** (§13.1 du guide, 15 vérifications) comme liste cochée et signée par dossier ; le suivi de la **formation continue** des courtiers (UFC ChAD, période 2026-2028) ; le registre des **divulgations** (honoraires communiqués, conflits d'intérêts) comme preuves datées plutôt que comme notes libres ; un rapport de conformité générable pour révision humaine (voir automatisation n° 16).

### 16 — Documents (versions, signatures et pièces justificatives) — 🟡 Partiel

**Preuves** : `documents` (téléversement par client/police, archivage doux) ; versions figées des soumissions et des polices ; pièces jointes des courriels conservées et analysables ; analyse de documents IA avec extraction et révision humaine ; export des propositions en PDF.

**Ce qui manque** : la **classification par type** des documents du guide (§12.1 : police antérieure, évaluation, rapport d'inspection, rapport de sinistralité, refus, comparaison, note de couverture…) — les documents sont une liste plate nom/date ; la notion de **documents attendus par dossier** (liste de contrôle des pièces à obtenir selon le type de risque) ; les signatures (aucune signature électronique ; la combinée conserve signataire/date en champs, sans preuve).

### 17 — Tâches (responsables, priorités et échéances) — 🟡 Partiel

**Preuves** : `taches` (`routes/taches.js` : assignation, échéance, statut, liens entreprise/police/réclamation) ; tableau de bord Échéances qui remonte tâches en retard, rappels de réclamations dépassés, factures en retard et réunions à venir ; création de tâches par l'assistant IA et à la voix.

**Ce qui manque** : la **génération automatique** de tâches par règles métier (relance d'une demande d'infos sans réponse, dossier de renouvellement à ouvrir à J-120, avenant demandé non reçu, recommandation d'assureur non suivie) — les tâches naissent aujourd'hui à la main ou par commande, jamais du système lui-même ; pas de priorités structurées.

### 18 — Rapports (qualité des dossiers et indicateurs opérationnels) — 🟡 Partiel

**Preuves** : exports CSV/JSON par module avec périmètre par rôle (`routes/exports.js`) ; statistiques par assureur (portefeuille, commissions) et par campagne/lead ; compteurs du tableau de bord Échéances ; journal d'audit interrogeable.

**Ce qui manque** : indicateurs de **qualité des dossiers** (dossiers incomplets, polices non vérifiées, renouvellements en retard de traitement) ; rapports de production (nouvelles affaires, taux de refus par assureur — impossible sans le module Marchés) ; rapport de conformité périodique.

---

## 2. Matrice par formulaire du guide (F01 à F20)

### F01 — Identification du client — 🟡 Partiel

Couvert : numéro de dossier (id), nom légal (raison sociale) et nom du contact, NEQ, forme juridique (profil combinée), adresse, téléphone, courriel, site web (enrichi par Google Places), langue FR/EN, courtier responsable, consentements datés. Manque : **personne autorisée à signer** identifiée comme telle ; **motif de la demande** structuré (recommandation, transfert, renouvellement…) ; date d'effet souhaitée hors combinée ; assureur/police/prime actuels en champs d'ouverture (ils vivent dans les antécédents, par produit) ; distinction siège social / adresse postale.

### F02 — Profil général du risque commercial — 🟡 Partiel

Couvert : description des activités, répartitions des revenus par type et par géographie, années d'exploitation et expérience, employés temps plein/partiel et CSST, masse salariale, sous-traitance (questions sectorielles + champs RC), chiffre d'affaires. Manque : revenus sur 3 ans et prévisions ; concentration des revenus par client ; obligations contractuelles (indemnisation, limites exigées, renonciation à subrogation) ; travail à chaud / en hauteur / espace clos comme expositions du profil (présents seulement dans le jeu entrepreneur et les questions additionnelles des envois réels) ; produits fabriqués/importés et pays d'origine structurés.

### F03 — Antécédents — 🟡 Partiel

Couvert (le plus avancé des formulaires « papier ») : assureur actuel et numéro de police par produit, refus/résiliation/non-renouvellement sur 5 ans avec explications, type et prime de la police précédente, faillite/jugements, condamnations liées à l'honnêteté, sinistres des 5 dernières années, saisie unique synchronisée entre Biens/RC/Perte dans la combinée, protection anti-écrasement. Manque : historique des **primes par année** ; **restrictions de garantie** subies ; **litiges** en cours ; distinction déclaré/payé/refusé/incident et statut ouvert/fermé des sinistres d'antécédents ; réserve connue par sinistre ; mesures correctives rattachées à chaque sinistre d'historique (présentes en texte, pas en suivi).

### F04 — Bâtiments, contenu et équipements (biens) — ✅ Couvert

Le formulaire le plus complet de l'app depuis la combinée : par emplacement — identification, construction par composant et classe assureur, toiture (âge, réfection), chauffage/combustible, électricité, plomberie, gicleurs et % protégé, alarme incendie et antivol détaillées (table alarme dédiée), bornes/caserne (prise d'eau et distance, caserne et distance), voisinage, expositions eau (refoulement, clapets, pompe de puisard dans les champs enrichis), valeurs (bâtiment, contenus par catégorie, flottante), garanties structurées avec règle proportionnelle, franchises et montants par avenant (refoulement, inondation, tremblement de terre et sous-franchises, bris d'équipement par accident). Manques résiduels : date/auteur de l'évaluation formelle, périodes d'inoccupation, inventaire moyen/maximal et saisonnalité en valeurs suivies.

### F05 — Syndicat de copropriété (SDC) — 🟡 Partiel

Couvert : 17 questions sectorielles copropriété (`lib/combine.js` : nombre de copropriétaires, fiducie, carnet d'entretien, étude et fonds de prévoyance, autogestion/gestionnaire, déclarations, fraction commerciale, locations à court terme, ascenseur, piscine/spa/gym, procédures) ; frais communautaires comme ligne de garantie structurée ; emplacements et bâtiments complets ; D&O du syndicat via le produit D&O. Manque : **fonds d'auto-assurance** (montant, plus haute franchise) ; **unité de référence** et parties privatives incluses/exclues ; nombre d'unités ventilé (résidentielles/commerciales/louées/vacantes), stationnements et rangements en champs ; programme d'entretien suivi (chauffe-eau, drains, façades) ; sinistralité **par unité d'origine** ; documents du syndicat (déclaration, étude de fonds, carnet) comme pièces attendues suivies.

### F06 — Responsabilité civile générale (CGL) — ✅ Couvert

Produit RC complet, complété à l'étape 5 de la combinée : exploitations illimitées rattachées aux emplacements, limites par sinistre et globales, produits et travaux terminés, préjudice personnel/publicité, frais médicaux (par personne/par sinistre), responsabilité locative par lieu, autos non-propriétaires, pollution (montant), **umbrella** (montant, rétention, polices de base), avenants structurés, antécédents communs. Manque : suivi des **certificats des sous-traitants** (existence, échéance) ; expositions par produit importé/pays en champs dédiés ; renonciation à subrogation comme champ propre (présente via assurés additionnels et texte).

### F07 — Erreurs et omissions (E&O) — 🟡 Partiel

Couvert : produit E&O complet — activités professionnelles illimitées, garanties (limite, franchise, base réclamations présentées/occurrences), avenants, **circonstances connues** (`eo_antecedents.circonstances`), antécédents. Manque par rapport au guide : revenus **par service** ; gestion des risques structurée (contrats écrits, limitation contractuelle, contrôle qualité, révision par un second professionnel, gestion des plaintes) ; date de **rétroactivité** et de continuité comme champs de garantie de premier plan ; défense à l'intérieur/extérieur de la limite ; période de déclaration prolongée en champ dédié.

### F08 — Cyber — 🟡 Partiel

Couvert : produit cyber complet — mesures de sécurité illimitées avec maturité, garanties, délai de carence, incidents sur 5 ans dans les antécédents. Manque : le profil informatique du guide (postes, serveurs, hébergement et **pays d'hébergement**, MSP, nature/volume des données, commerce électronique) en champs dédiés plutôt qu'en mesures libres ; les contrôles nommés du guide en cases structurées (MFA courriel / accès distants / administrateurs, sauvegardes immuables et **tests de restauration**, EDR, double validation des virements) ; garanties fines (ingénierie sociale, interruption dépendante d'un fournisseur) comme lignes distinctes.

### F09 — Véhicules et flotte — ✅ Couvert

Couvert : FPQ1 et flotte complets — véhicules illimités (marque, modèle, année, NIV, valeur, usage, créanciers), conducteurs illimités (permis, expérience, historique), garanties par chapitre et avenants F.A.Q., anti-collision des listes. Manques résiduels : poids nominal brut et nombre d'essieux, rayon d'utilisation et kilométrage annuel structurés, matières dangereuses par véhicule — présents au mieux en notes selon le gabarit actuel.

### F10 — Cargo, transport et entreposage — ❌ Absent

Aucun produit, aucune table, aucun questionnaire : les seules traces sont le « biens en transit » des contenus et des propositions. Tout le formulaire manque : opérations (pour autrui/compte propre, valeurs moyenne et maximale par chargement, voyages, territoires), sécurité (GPS, stationnements sécurisés, contrôle des températures), protections (facultés/cargo, responsabilité du transporteur, responsabilité légale d'entreposeur, limites par voyage/véhicule/emplacement).

### F11 — Entrepreneurs et construction — 🟡 Partiel (faible)

Couvert : 7 questions sectorielles entrepreneur (licence RBQ, cautionnement de licence, types de travaux, sous-traitance, autres provinces, expérience, saisonniers) et la combinée complète pour le reste (biens, RC, perte) ; les envois réels montrent que le jeu réel est beaucoup plus riche (±30 questions : % résidentiel/commercial/industriel/institutionnel, travaux structuraux, excavation, toiture, amiante, dynamitage…). Manque : le questionnaire F11 complet en champs structurés ; valeur maximale d'un chantier et nombre de chantiers ; produits chantier (tous risques chantier, installation) comme lignes dédiées.

### F12 — Bijouteries et commerces de luxe — 🟡 Partiel

Couvert : le formulaire d'assureur réel fourni par Patrick (application combinée JM) a alimenté l'étape 1 (répartition des revenus par type incluant l'achat d'or) et le bloc alarme/coffre (`biens_protections_alarme` : type et catégorie de coffre, transmissions, centrale, ULC) ; garanties biens/RC standard. Manque : inventaire structuré par catégorie (diamants, pierres, or, montres, valeur en vitrine vs en coffre, consignation, biens de tiers, salons/expositions) ; garanties **Jewelers Block** nommées (vol à main armée, disparition mystérieuse, transit/expéditions) comme lignes de garantie ; procédures de sécurité (ouverture/fermeture, transport spécialisé, vérification d'inventaire) en questions dédiées.

### F13 — Administrateurs et dirigeants (D&O) — 🟡 Partiel

Couvert : produit D&O complet — dirigeants illimités, garanties (limites par sinistre/agrégat, franchise, base claims-made/occurrences), avenants (frais de défense, pratiques d'emploi, fidélité/crime), poursuites dans les antécédents. Manque : le volet financier et gouvernance du guide en champs structurés (actifs, dettes, états financiers, fusions/acquisitions, changements de contrôle, filiales, actionnaires importants, conflits d'intérêts, exposition emploi/réglementaire) ; date de rétroactivité/continuité ; période de déclaration prolongée.

### F14 — Pollution et environnement — ❌ Absent

Aucun questionnaire : la pollution n'existe que comme **montant d'avenant** dans les garanties RC. Tout manque : substances et quantités, réservoirs aériens/souterrains, traitement de déchets, historique de contamination, rapports et permis, plans d'urgence, garanties (nettoyage, pollution soudaine vs graduelle, transport).

### F15 — Registre de mise en marché — ❌ Absent (priorité n° 1)

**Vérification ciblée** : aucune table, aucune route, aucun champ ne trace un envoi à un assureur. Ce qui existe autour, sans être un registre : la table `assureurs` (annuaire + produits + commissions + statistiques de portefeuille) ; le brouillon « demande de prix » de la combinée (le document à envoyer, pas l'envoi) ; le module Courriels (envoi SMTP générique au clic, classement intelligent des réponses au client et à la police — pas à un envoi de soumission) ; le statut `envoye` du dossier combiné (drapeau manuel, sans destinataire ni date d'envoi structurée). **Tout le formulaire manque** : assureur/grossiste, souscripteur contact, date/heure de transmission, version de la proposition envoyée, documents transmis, statut (envoyé, en analyse, questions, refus, offre), questions en attente et responsable de la réponse, date de relance, motif de refus, prime proposée, limites/franchises offertes, conditions préalables, date de validité, prochaine action.

### F16 — Recommandation et décision du client — ❌ Absent (priorité n° 1, à égalité)

**Vérification ciblée** : le mot « recommandation » n'apparaît dans le code que pour les *protections recommandées du catalogue* — rien pour la présentation au client. Aucune trace structurée : date de présentation, personne rejointe, options présentées, option recommandée et justification, garanties non offertes, **garanties refusées par le client**, franchises/limites choisies, exclusions expliquées, honoraires communiqués, **autorisation de procéder datée et son mode**, confirmation de prise d'effet. Éléments voisins seulement : brouillons de courriels (renouvellement, relance), protections recommandées manquantes sur la fiche de révision. C'est le formulaire dont l'absence coûte le plus cher en cas de litige E&O.

### F17 — Demande d'avenant — 🟡 Partiel

Couvert : la **vérification** du document d'avenant reçu contre l'état demandé (écarts détaillés, brouillon de correction à l'assureur) et le versionnement complet des polices. Manque : la **demande** elle-même — type de modification en sélection, description avant/après, date/heure d'effet demandée, autorisation du client, date d'envoi à l'assureur, réponse, prime additionnelle/ristourne, drapeaux « avenant reçu / vérifié / client avisé / dossier fermé ». Le processus est contrôlé à l'arrivée, pas piloté au départ.

### F18 — Révision annuelle — 🟡 Partiel

Couvert : fiche de révision par police, protections recommandées manquantes, brouillon de renouvellement IA, page Échéances en bandes J-30/60/90. Manque : le **questionnaire de révision annuelle** du guide (revenus N-1 et prévus, changements d'activités/produits/territoires/employés, nouveaux bâtiments, rénovations, valeurs actualisées, nouveaux contrats, mesures de prévention, protections supplémentaires, **confirmation des garanties non retenues**) comme formulaire envoyé au client, analysé à la réponse et versé au dossier — la mécanique de boucle courriel existe, elle n'est pas branchée sur la révision annuelle.

### F19 — Déclaration initiale de sinistre — 🟡 Partiel

Couvert : numéro de réclamation, dates du sinistre et de déclaration, description, montants réclamé/réglé, franchise appliquée, expert nommé et ses coordonnées, date de rappel, suivis horodatés. Manque : heure du sinistre, circonstances et cause présumée structurées, adresse du sinistre, tiers et blessés, services d'urgence, mesures conservatoires, entrepreneurs d'urgence, témoins, numéros de rapport (police/incendie), photos et factures rattachées à l'événement, **transmission de la déclaration à l'assureur depuis l'app**, prochain suivi comme champ de pilotage (le rappel existe, générique).

### F20 — Suivi financier — 🟡 Partiel

Couvert : montant, montant payé, solde implicite, échéance, statuts, retards marqués automatiquement, paiements multiples par mode, relance en brouillon IA, comptes en retard au tableau de bord. Manque : ventilation **prime de base / prime additionnelle / ristourne / taxes / honoraires** ; échéancier de versements ; avis de retard et dates de relance tracés sur la facture ; **risque d'annulation pour non-paiement** comme statut suivi avec alerte ; confirmation comptable.

---

## 3. Inventaire des 16 automatisations du guide (§15.2)

| # | Automatisation (guide) | Statut | Preuve / écart |
|---|---|---|---|
| 1 | Détecter les champs obligatoires manquants | ✅ Fait | `lib/manques.js` — `calculerManques` (9 produits) et `calculerManquesCombinee` ; section « Informations manquantes » sur les fiches ; questions contextualisées numérotées |
| 2 | Identifier les incohérences entre les déclarations | 🟡 Partiel | La **vérification d'avenant** (`lib/verification-avenant.js`) compare le document de l'assureur à l'état demandé et classe conforme/écart/absent/à confirmer/surplus ; le classement des courriels signale les conflits en « 🗂️ À classer » sans forcer. **Manque** : un contrôle de cohérence *interne* au dossier (valeurs impossibles, superficie vs valeur, revenus vs masse salariale, dates contradictoires entre volets de la combinée) |
| 3 | Comparer les valeurs d'une année à l'autre | ❌ Absent | Les versions figées existent (soumissions et polices) mais **aucune comparaison automatique** N vs N-1 n'est produite au renouvellement ou à la révision |
| 4 | Signaler les revenus ou valeurs qui ont fortement changé | ❌ Absent | Dépend du n° 3 ; aucun seuil ni alerte de variation n'existe |
| 5 | Identifier les bâtiments sans évaluation récente | ❌ Absent | Pas de date d'évaluation structurée exploitée, donc aucune alerte d'évaluation périmée (le champ reste à formaliser, voir F04) |
| 6 | Signaler les polices proches de l'expiration | ✅ Fait | Page **Échéances** : échues, J-30, J-60, J-90, plus loin ; statut `a_renouveler` ; fiche de révision par police ; brouillon de renouvellement IA prêt au clic |
| 7 | Créer des relances pour les demandes en attente | 🟡 Partiel | **Côté client** : boucle courriel complète — relance en 1 clic qui crée une *nouvelle* demande avec seulement les questions restantes (le parent n'est jamais écrasé). **Côté assureurs** : rien (pas de registre F15). **Côté factures** : brouillon de relance au clic. Les relances sont *préparées*, jamais envoyées automatiquement — conformément au principe |
| 8 | Rappeler les recommandations de prévention non complétées | ❌ Absent | Aucun registre de recommandations (d'assureur ou du courtier) avec statut à suivre ; seules les *protections recommandées manquantes* du catalogue sont affichées, ce qui n'est pas la même chose qu'une recommandation d'inspection à échéance |
| 9 | Vérifier si les avenants demandés ont été reçus | 🟡 Partiel | La vérification compare un document **reçu et déposé** à l'état demandé ; mais il n'existe pas de demande d'avenant suivie (F17), donc pas de détection « demandé il y a N jours, jamais reçu » |
| 10 | Signaler les documents contractuels non vérifiés | 🟡 Partiel | Les vérifications effectuées sont conservées (`verifications_avenants`) et visibles sur la fiche police ; **manque** le drapeau inverse : « cette police/version n'a jamais été vérifiée » signalé au tableau de bord |
| 11 | Générer des résumés de souscription | 🟡 Partiel | Les propositions complètes (par produit et combinée, au gabarit réel) sont générées en HTML/PDF ; l'assistant IA rédige à la demande. **Manque** : le *résumé du risque* court du guide (§8.1 point 7) — synthèse narrative points forts/points de vigilance destinée au souscripteur, distincte de la proposition intégrale |
| 12 | Produire des tableaux comparatifs | ❌ Absent | Le tableau « police actuelle vs nouvelle proposition » du guide (§7.2) n'existe pas ; impossible à alimenter tant que les offres des assureurs ne sont pas enregistrées (F15) |
| 13 | Préparer des courriels de présentation | 🟡 Partiel | Brouillons IA existants : renouvellement, relance de facture, demande d'informations au client, demande de prix (combinée), correction d'avenant. **Manque** : le courriel de **présentation des options au client** (lié à F16) |
| 14 | Générer des listes de questions pour le client | ✅ Fait | Boucle courriel complète : manques détectés → questions numérotées contextualisées → brouillon modifiable → envoi au clic → réponse analysée (texte + pièces jointes) → insertion après révision → questions répondues fermées automatiquement |
| 15 | Signaler les garanties importantes non retenues | 🟡 Partiel | Les protections recommandées absentes sont affichées sur la fiche de révision ; **manque** la trace opposable « offerte le X, refusée par le client » et le signalement actif au renouvellement (confirmation des garanties non retenues, F18) |
| 16 | Produire des rapports de conformité pour révision humaine | ❌ Absent | Le journal d'audit est complet et consultable, mais **aucun rapport** n'est généré : pas de grille de contrôle de dossier (§13.1), pas de synthèse périodique des dossiers à risque de non-conformité |

**Compte des automatisations : ✅ 3 · 🟡 7 · ❌ 6 (sur 16).**

Ce qui est déjà automatisé forme un socle cohérent : **détection des manques, échéances, collecte de réponses clients, classement des courriels** (numéro de police → client et police précise, avec garde-fou « à classer »), **analyse de documents entrants** (PDF/OCR/tableurs → champs proposés, révision humaine) et **vérification des documents d'avenant**. Tout ce qui touche au **marché** (envois, offres, refus, négociations) et à la **preuve de décision** est en revanche manuel ou absent — c'est là que se concentre la feuille de route.

---

## 4. Feuille de route d'automatisation proposée

Ordre choisi : **les dépendances d'abord** (le registre de mise en marché débloque la comparaison, les relances assureurs et la présentation au client), **la valeur métier et le risque professionnel ensuite** (la preuve de décision protège le cabinet), puis l'industrialisation des processus récurrents (avenants, renouvellements), la vigie, et enfin la profondeur sectorielle. Dans chaque phase : le système **prépare tout** ; l'humain **valide et envoie** — aucun envoi automatique n'est introduit.

### Phase 1 — Registre de mise en marché (F15) : le système sait à qui la soumission a été envoyée

**Périmètre** : nouvelle table d'envois rattachée à chaque soumission (et au dossier combiné) : assureur/grossiste (depuis l'annuaire existant), souscripteur contact, date/heure d'envoi, version de la proposition transmise, documents joints, statut (envoyé, en analyse, questions, refus, offre), questions en attente et responsable de la réponse, date de relance, motif de refus, prime proposée, limites/franchises offertes, conditions préalables, date de validité, prochaine action. Bouton « Envoyer à l'assureur » depuis la fiche : génère le courriel avec la proposition PDF en pièce jointe, pré-remplit le registre, **envoi au clic seulement**. Les réponses des assureurs reçues par courriel sont proposées au rattachement de l'envoi correspondant (extension du classement intelligent existant).
**Le système fait** : préparer l'envoi, tracer, relancer au jour dit (brouillon prêt), alerter sur les dossiers sans réponse. **Reste humain** : le choix des marchés, le clic d'envoi, la négociation.
**Patrick doit fournir** : sa liste de marchés et contacts souscripteurs par type de risque ; des exemples réels de réponses d'assureurs (offre, refus motivé, demande de précisions) ; la **vidéo de son processus actuel** d'envoi et de suivi (annoncée) — c'est elle qui fixe les statuts et les délais de relance qu'il utilise vraiment.

### Phase 2 — Offres reçues, comparateur et décision du client (F16 + §7.2 du guide)

**Périmètre** : saisie/analyse des offres reçues (montants, limites, franchises, conditions — adossées au registre de la phase 1 ; les documents d'offre des assureurs alimentent le pipeline d'analyse existant) ; **tableau comparatif automatique** police actuelle vs chaque offre (le tableau du §7.2 : prime, bâtiment, contenu, RC, perte d'exploitation, bris, refoulement, inondation, tremblement de terre, exclusions, conditions) ; écran de **présentation au client** (options, recommandation et justification rédigées avec l'assistant IA) ; **fiche de décision** : options présentées, option recommandée, garanties non offertes, **garanties refusées par le client**, limites/franchises choisies, honoraires communiqués, **autorisation de procéder datée avec son mode**, confirmation de prise d'effet — la décision validée déclenche la création de la police (mécanisme de conversion existant).
**Le système fait** : comparer, rédiger la présentation, conserver la preuve. **Reste humain** : la recommandation elle-même et la présentation au client.
**Patrick doit fournir** : un exemple de présentation qu'il fait aujourd'hui (document ou courriel type à un client) et 1–2 offres réelles d'assureurs reçues récemment (pour caler l'extraction).

### Phase 3 — Demande d'avenant de bout en bout (F17) + note de couverture

**Périmètre** : formulaire de demande d'avenant structuré (type de modification en sélection, avant/après, date/heure d'effet, autorisation du client, documents justificatifs) ; envoi à l'assureur tracé dans le registre (phase 1) ; suivi des états « envoyé → répondu → document reçu » qui **déclenche la vérification automatique déjà existante** dès le document classé ; prime additionnelle/ristourne versée à la facturation ; génération de la **note de couverture** quand la garantie est liée avant l'émission du document.
**Le système fait** : préparer la demande, suivre les délais, vérifier le document reçu, signaler tout avenant demandé sans réponse. **Reste humain** : valider la demande et les écarts.
**Patrick doit fournir** : des exemples d'avenants reçus et de demandes qu'il envoie aujourd'hui ; ses délais habituels avant relance.

### Phase 4 — Renouvellement industrialisé (F18 + procédure phasée + comparaisons annuelles)

**Périmètre** : création automatique (proposée, à valider) du **dossier de renouvellement** à J-120 avec tâches par phase (J-120/90 : informations à jour et rapports ; J-90/60 : transmission et remise en marché via la phase 1 ; J-60/30 : présentation via la phase 2 ; avant expiration : confirmation et continuité) ; **questionnaire de révision annuelle** branché sur la boucle courriel existante (réponses analysées, écarts signalés) ; **comparaison automatique année sur année** des valeurs, revenus et limites avec alertes de variation forte (automatisations n° 3 et 4) ; confirmation des garanties non retenues dans la révision.
**Le système fait** : ouvrir, questionner, comparer, alerter, préparer. **Reste humain** : décider remise en marché ou renouvellement direct, présenter au client.
**Patrick doit fournir** : ses délais réels de traitement par type de dossier ; un exemple de renouvellement complet récent (police N-1 + police N) pour calibrer la comparaison.

### Phase 5 — Vigie du portefeuille et conformité (automatisations n° 5, 8, 10, 16 + module Conformité)

**Périmètre** : registre des **recommandations** (assureur/courtier) avec échéance et statut, rappels automatiques ; date d'évaluation structurée sur les bâtiments et alerte « évaluation à renouveler » ; drapeau « document contractuel non vérifié » au tableau de bord ; **grille de contrôle de dossier** (§13.1 du guide, 15 points) cochable par dossier avec signature du vérificateur ; **rapport de conformité** périodique pour révision humaine (dossiers incomplets, polices non vérifiées, renouvellements en retard, avenants en souffrance) ; suivi de la **formation continue** (UFC par courtier et par période ChAD).
**Le système fait** : surveiller, lister, rapporter. **Reste humain** : juger et corriger.
**Patrick doit fournir** : des exemples de rapports d'inspection avec recommandations d'assureurs ; sa grille de vérification actuelle si elle existe ; les UFC à suivre par personne.

### Phase 6 — Profondeur sectorielle (F05 approfondi, F11, F12, puis F10 et F14)

**Périmètre** : compléter les jeux de questions existants à partir des formulaires réels (SDC : fonds d'auto-assurance, unité de référence, entretien programmé ; entrepreneur : le jeu complet des envois réels ; bijouterie : inventaire par catégorie et garanties Jewelers Block) ; **nouveau produit cargo/transport** (F10) construit avec la recette habituelle en 10 étapes ; **questionnaire environnement/pollution** (F14) en supplément RC ; amorce de la **bibliothèque de libellés** (libellé de base vs versions bonifiées par assureur, rattachés aux garanties) au fil des documents reçus.
**Le système fait** : poser les bonnes questions selon le secteur, aligner l'analyse de documents et les manques sur ces champs. **Reste humain** : fournir les formulaires et valider les jeux de questions.
**Patrick doit fournir** : les formulaires d'assureurs par secteur au fil de l'eau (SDC, cargo, environnement en priorité) — le patron est connu : application de base + questionnaire supplémentaire par industrie, aucun catalogue public n'existe.

### Phase 7 — Sinistres : déclaration structurée et transmission (F19)

**Périmètre** : formulaire de déclaration initiale complet (circonstances, cause, tiers, blessés, urgences, mesures conservatoires, témoins, rapports, photos rattachées) ; transmission à l'assureur depuis le dossier avec suivi de l'accusé et du numéro de réclamation ; versement automatique de l'événement dans les antécédents des prochains dossiers du client ; rappels de suivi par type de sinistre.
**Patrick doit fournir** : le formulaire/canal de déclaration qu'il utilise avec ses principaux assureurs.

### Phase 8 — Finances complétées (F20)

**Périmètre** : factures ventilées (prime, taxes, honoraires, frais), échéanciers de versements, primes additionnelles/ristournes d'avenants automatiques (phase 3), suivi du risque d'annulation pour non-paiement avec alertes, calcul des commissions attendues par assureur depuis les taux de l'annuaire.
**Patrick doit fournir** : un modèle de facture réelle avec ses taxes et honoraires habituels.

---

## 5. Synthèse

**Fonctions couvertes / partielles / absentes** :

- **Modules : ✅ 2 / 🟡 15 / ❌ 1** — couverts : Client, Emplacements. Absent : **Marchés**. Tout le reste existe mais à des profondeurs très inégales : le cœur de souscription (9 produits + combinée) est profond ; tout ce qui entoure le placement est mince.
- **Formulaires : ✅ 3 / 🟡 13 / ❌ 4** — couverts : F04 Biens, F06 RC, F09 Flotte. Absents : **F10 Cargo, F14 Environnement, F15 Mise en marché, F16 Décision du client**.
- **Automatisations visées par le guide : ✅ 3 / 🟡 7 / ❌ 6** — faites : détection des manques, signalement des expirations, listes de questions au client (boucle courriel complète). Absentes : comparaisons annuelles et alertes de variation, évaluations périmées, recommandations de prévention suivies, tableaux comparatifs, rapports de conformité.

**Lecture d'ensemble** : le système actuel est un excellent outil de **production de soumissions** et de **gestion documentaire contrôlée**. Il n'est pas encore un outil de **placement** (le marché n'y existe pas) ni de **preuve** (la décision du client n'y est pas conservée). Les phases 1 et 2 corrigent exactement ces deux angles ; les phases 3 à 5 industrialisent ce qui existe ; la phase 6 donne la profondeur sectorielle demandée.

**Les 5 plus gros chantiers** :

1. **Registre de mise en marché (F15)** — envois aux assureurs tracés, statuts, offres et refus, relances : la fonction entièrement absente dont tout le reste dépend.
2. **Présentation au client et preuve de décision (F16)** — comparateur d'offres, recommandation documentée, garanties refusées par le client, autorisation datée : l'enjeu de responsabilité professionnelle n° 1 du guide.
3. **Demande d'avenant de bout en bout (F17)** — brancher la demande et son suivi sur la vérification automatique déjà en place, plus la note de couverture.
4. **Vigie automatique du portefeuille** — comparaisons année sur année, variations fortes, évaluations périmées, recommandations non suivies, documents non vérifiés, tâches générées par règles (automatisations n° 3, 4, 5, 8, 10) et rapport de conformité (n° 16).
5. **Profondeur sectorielle et nouveaux risques** — SDC complet, entrepreneur complet, bijouterie structurée, nouveau produit cargo (F10), questionnaire environnement (F14), bibliothèque de libellés de référence.
