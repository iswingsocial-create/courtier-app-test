# Référence — Propositions FPQ1 et FPQ4 (dossier remorquage)

Inventaire des champs de deux propositions réelles fournies par Patrick (2026-10-21) et cartographie contre l'outil courtier. **Aucun identifiant personnel n'est reproduit** : seuls la structure, les libellés, les sections, les listes de choix et les formats sont décrits.

Sources :
- `FPQ-1_remoquage_auto_plus.xlsx` — feuille « FPQ-1 Proposition », formulaire officiel F.P.Q. n° 1 rempli pour une entreprise de remorquage (1 véhicule lourd de remorquage, 2 conducteurs).
- `propo_base_FPQ4_remorquage_auto_plus.xlsx` — feuille « Feuil1 », proposition d'assurance automobile des garagistes F.P.Q. n° 4 (gabarit d'assureur/grossiste), remplie pour la même entreprise.

Légende : ✅ existe dans l'outil (champ nommé) · 🟡 partiel (existe en partie ou dans un autre module) · ❌ manquant.
Cible principale FPQ1 : module **FPQ1** (`lib/fpq1.js`, tables `auto_*`) ; cible secondaire : module **Flotte** (`flotte_*`). Cible FPQ4 : aucun produit dédié — comparaison contre FPQ1 + Flotte + RC.

---

## 1. Proposition FPQ1 — inventaire et cartographie (81 champs)

### En-tête

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 1 | Compagnie d'assurance (assureur visé) | Texte | 🟡 `polices.assureur` au niveau police seulement ; la soumission FPQ1 n'a pas de champ assureur (Flotte l'a : `flotte_soumissions.assureur`) |
| 2 | Langue de la police | Français / Anglais | ✅ `clients.langue` |
| 3 | Numéro de police attribué | Texte | ✅ `polices.numero_police` (à la conversion) |
| 4 | Nouvelle police / Remplace la police n° | Choix + n° | 🟡 `auto_antecedents.numero_police_actuelle` ; pas de notion explicite « remplace » |

### Section 1 — Proposant

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 5 | Nom complet du proposant | Texte | ✅ `clients.raison_sociale` (+ `prenom`/`nom` du contact) |
| 6 | Référence client | N° interne du cabinet | 🟡 seulement l'`id` interne ; aucun champ « référence client » externe |
| 7 | Adresse | Texte | ✅ `clients.adresse` |
| 8 | Ville | Texte | ✅ `clients.ville` |
| 9 | Province | Texte | ✅ `clients.province` |
| 10 | Code postal | A1A 1A1 | ✅ `clients.code_postal` |
| 11 | Téléphone domicile | Téléphone | 🟡 un seul champ `clients.telephone` (pas de distinction domicile/travail) |
| 12 | Téléphone travail | Téléphone | 🟡 `clients.telephone_entreprise` |
| 13 | Cellulaire | Téléphone | ❌ aucun champ distinct |
| 14 | Télécopieur | Téléphone | ❌ aucun champ client (existe seulement pour le cabinet) |
| 15 | Courriel | Courriel | ✅ `clients.courriel` / `courriel_entreprise` |
| 16 | Activités de l'assuré | Texte | ✅ `clients.secteur_activite`, `description_activites` |
| 17 | Mode de facturation | Agence / Directe | ❌ aucun champ sur la soumission ou la police |

### Section 2 — Durée du contrat

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 18 | Date d'effet (du) | Date | ✅ `auto_soumissions.date_effet_souhaitee`, `polices.date_effet` |
| 19 | Date d'échéance (au) | Date | 🟡 `polices.date_echeance` seulement ; absente de la soumission FPQ1 (Flotte l'a : `date_echeance_visee`) |

### Informations sur l'entreprise

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 20 | Nom de l'entreprise | Texte | ✅ `clients.raison_sociale` |
| 21 | Numéro d'entreprise (NEQ) | 10 chiffres | ✅ `clients.neq` |
| 22 | Adresse de l'entreprise | Texte | ✅ `clients.adresse` |
| 23 | Type d'entreprise | Texte / liste | 🟡 `clients.forme_juridique` (liste des formes juridiques, pas « type d'entreprise » au sens du formulaire) |
| 24 | Nature des activités | Texte | ✅ `clients.description_activites` |

### Section 3 — Caractéristiques des véhicules désignés (par véhicule, répétable)

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 25 | Année | AAAA | ✅ `auto_vehicules.annee` |
| 26 | Marque | Texte | ✅ `auto_vehicules.marque` |
| 27 | Modèle | Texte | ✅ `auto_vehicules.modele` |
| 28 | Type (carrosserie) | Texte (ex. remorqueuse) | ✅ `auto_vehicules.carrosserie` |
| 29 | Numéro de série (NIV) | 17 caractères | ✅ `auto_vehicules.vin` |
| 30 | Achat (année/mois) | Date | ✅ `auto_vehicules.date_achat` |
| 31 | État | N = neuf / U = usagé / D = démo | 🟡 `auto_vehicules.neuf_occasion` (neuf/occasion ; « démo » absent) |
| 32 | Prix à l'état neuf | Montant $ | 🟡 `prix_achat` = prix payé et `valeur_estimee` = valeur actuelle ; le prix neuf d'origine n'est pas un champ distinct |

### Utilisation des véhicules (par véhicule)

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 33 | Utilisation | Texte (ex. remorquage) | ✅ `auto_vehicules.usage` |
| 34 | % d'utilisation | % | ❌ aucun pourcentage par usage |
| 35 | Rayon d'opération (km) | Nombre | ❌ absent du FPQ1 — ✅ présent en Flotte (`flotte_soumissions` et `flotte_vehicules.rayon_operation_km`) |
| 36 | % hors-Québec | % | ✅ `auto_vehicules.pct_hors_quebec` |
| 37 | % États-Unis | % | ❌ pas de ventilation États-Unis distincte du hors-Québec |

### Système anti-vol / repérage (par véhicule)

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 38 | Description du système antivol | Texte | 🟡 `auto_vehicules.antivol_tag` (booléen, système TAG seulement) |
| 39 | Marque du système | Texte | ❌ |
| 40 | Créancier — nom et adresse | Texte | 🟡 `creancier_nom` + `creancier_courriel` ; adresse postale du créancier absente |
| 41 | Locateur — nom et adresse | Texte | 🟡 même champ créancier/locateur ; adresse absente |

### Garanties demandées et limites (par véhicule)

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 42 | Chapitre A — Responsabilité civile (limite) | Montant $ (ex. 2 000 000) | ✅ `auto_garanties.rc_montant` |
| 43 | B1 — Tous risques | Choix | ✅ `auto_garanties.protection_b` (choix unique B1 à B4) |
| 44 | B2 — Collision ou versement | Choix | ✅ idem |
| 45 | B3 — Accidents sans collision | Choix | ✅ idem |
| 46 | B4 — Risques spécifiés | Choix | ✅ idem |
| 47 | Franchise — chapitre B | Montant $ | 🟡 `franchise_b` unique par véhicule ; le formulaire permet une franchise par division |
| 48 | F.A.Q. n° 20 — Privation de jouissance | Avenant + montants (indemnité/jour, limite) | 🟡 avenant présent en JSON (`avenants.faq20`) ; montants quotidien/total non structurés |
| 49 | F.A.Q. n° 27 — Véhicules n'appartenant pas à l'assuré | Avenant | ✅ `avenants.faq27` |
| 50 | F.A.Q. n° 34 — Assurance des personnes | Avenant + montant | 🟡 avenant présent (`avenants.faq34`) ; montant non structuré |
| 51 | F.A.Q. 43A-E — Valeur à neuf | Avenant | ✅ `avenants.faq43` |
| 52 | Prime totale payable | Montant $ | ✅ `auto_garanties.prime` (par véhicule) |

### Section 4 — Détails concernant tous les conducteurs (par conducteur, répétable)

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 53 | Véhicule(s) conduit(s) (n°) | Référence | ✅ `auto_conducteurs.vehicules_conduits` (JSON) + `conducteur_principal` |
| 54 | Nom complet | Texte | ✅ `auto_conducteurs.nom` / `prenom` |
| 55 | Numéro de permis | Texte | ✅ `auto_conducteurs.numero_permis` |
| 56 | Permis depuis (AAAA-MM) | Date | ✅ `auto_conducteurs.date_obtention_permis` |
| 57 | Lien avec l'assuré | Texte (ex. employé) | ✅ `auto_conducteurs.lien_assure` |

### Condamnations et interdictions (6 dernières années, par conducteur)

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 58 | Date de la condamnation | Date | 🟡 `auto_conducteurs.infractions` (JSON {date, type, points}) et `suspensions` — pensée « infractions », pas « condamnations Code de la route / Code criminel » |
| 59 | Description de la condamnation | Texte | 🟡 idem (`infractions.type`) |

### Sinistres (6 dernières années, par événement)

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 60 | Véhicule n° | Référence | 🟡 `auto_antecedents.sinistres_6ans` (JSON) sans lien au véhicule |
| 61 | Conducteur n° | Référence | 🟡 idem, sans lien au conducteur |
| 62 | Date du sinistre | Date | ✅ `sinistres_6ans[].date` |
| 63 | Type de sinistre | Texte | ✅ `sinistres_6ans[].type` |
| 64 | % de responsabilité | % | ✅ `sinistres_6ans[].responsabilite` |
| 65 | Montant payé/estimé | Montant $ | ✅ `sinistres_6ans[].montant` |
| 66 | Description | Texte | 🟡 seulement le « type » ; pas de description libre distincte |

### Questions générales et remarques

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 67 | Véhicule déclaré perte totale ou gravement accidenté | Oui/Non + lequel | ❌ aucun champ |
| 68 | Nombre de voitures de tourisme résidant avec le proposant | Nombre | ❌ (question « ménage » du formulaire personnel, absente) |
| 69 | Personnes avec permis valide domiciliées avec le proposant | Nombre | ❌ idem |
| 70 | Adresses précédentes (3 dernières années) | Texte | ❌ aucun champ |
| 71 | Description des remorques (si applicable) | Texte | ✅ `auto_vehicules.remorque` + `remorque_details` (JSON) |
| 72 | Remarques et informations complémentaires | Texte libre | ✅ `auto_soumissions.notes` |

### Assureur antérieur

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 73 | Assureur antérieur | Texte | ✅ `auto_antecedents.assureur_actuel` |
| 74 | N° de police antérieur | Texte | ✅ `auto_antecedents.numero_police_actuelle` |
| 75 | Échéance | Date | ✅ `auto_antecedents.date_expiration_actuelle` |
| 76 | Refus ou résiliation d'un contrat d'assurance automobile | Oui/Non + assureur | ✅ `auto_antecedents.resiliation_ant` + `resiliation_details` |

### Signatures

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 77 | Signature du proposant | Signature | ❌ aucun bloc signature dans le module FPQ1 (existe dans la soumission combinée : `combine_dossiers.signataire_*`) |
| 78 | Signature du coproposant | Signature | ❌ |
| 79 | Date de signature (proposant) | Date | ❌ |
| 80 | Signature du courtier | Signature | ❌ |
| 81 | Date (courtier) | Date | ❌ |

### Totaux FPQ1

**81 champs — ✅ 45 · 🟡 20 · ❌ 16**

Manques les plus significatifs pour un dossier commercial : rayon d'opération par véhicule (seulement en Flotte), % États-Unis, mode de facturation, franchises du chapitre B par division, montants des avenants FAQ 20/34, liens véhicule/conducteur des sinistres, question « perte totale / gravement accidenté », signatures.

---

## 2. Proposition FPQ4 — Garagistes (48 champs)

**Constat de départ : l'outil n'a aucun produit FPQ4.** La liste des produits de l'analyse de documents est : auto (FPQ1), biens, rc, cyber, eo, do, pe, flotte, cautionnement. Aucune table, aucun formulaire, aucune ligne de police « FPQ4 / garagistes ». La cartographie ci-dessous compare donc chaque champ au plus proche équivalent (FPQ1, Flotte, RC, fiche client).

### Informations générales

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 1 | Nom de l'assuré | Texte | ✅ `clients.raison_sociale` |
| 2 | Adresse postale | Texte | ✅ `clients.adresse`/`ville`/`code_postal` |
| 3 | Adresse du risque | Texte | 🟡 seulement via `biens_batiments` (module Biens) ; rien côté auto/flotte |
| 4 | Activité | Texte | ✅ `clients.secteur_activite` |
| 5 | Date requise — du | Date | ✅ `date_effet_souhaitee` / `polices.date_effet` |
| 6 | Date requise — au | Date | 🟡 `polices.date_echeance` seulement |

### Remorqueuse / Employés

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 7 | L'assuré est-il propriétaire d'une remorqueuse ? | Oui/Non | ❌ aucun champ (la FPQ1 décrit les véhicules, sans ce drapeau garagiste) |
| 8 | Renvoi : détails pris sur la police F.P.Q. n° 1 | Référence croisée | ❌ aucun lien FPQ1 ↔ FPQ4 dans l'outil |
| 9 | Nombre d'employés — total | Nombre | 🟡 `clients.nb_employes` (total seulement) |
| 10 | Employés par catégorie (vendeurs, mécaniciens, manœuvres, direction) | Nombres × 4 | ❌ aucune ventilation par catégorie |

### Terrain / Sécurité

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 11 | Terrain clôturé | Oui/Non | ❌ |
| 12 | Éclairé la nuit | Oui/Non | ❌ |
| 13 | Gardien de nuit | Oui/Non | ❌ |
| 14 | Où sont gardées les clés ? | Texte | ❌ |
| 15 | Marque du système d'alarme | Texte | 🟡 `biens_batiments.alarme_vol_type` et questionnaire alarme de la combinée (fabricants des transmissions) — pas la « marque du système » du garage |
| 16 | Alarme reliée à une centrale | Oui/Non | 🟡 via `alarme_vol_type` (valeurs « reliée à une centrale ») |
| 17 | Nombre de plaques X (plaques de commerçant) | Nombre | ❌ champ propre aux garagistes, absent partout |
| 18 | Nombre de véhicules immatriculés | Nombre | 🟡 `flotte_soumissions.nb_vehicules` ou la liste des véhicules |
| 19 | Nombre maximal de véhicules — intérieur | Nombre | ❌ capacité du terrain/bâtiment, absente |
| 20 | Nombre maximal de véhicules — extérieur | Nombre | ❌ idem |

### Couvertures — franchises — limites

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 21 | Chapitre A — Responsabilité civile (limite) | Montant $ (ex. 2 000 000) | ✅ équivalents : `auto_garanties.rc_montant`, `flotte_garanties.limite_rc`, `rc_garanties.limite_par_sinistre` |
| 22 | Chapitre B Div. I — Tous risques (oui, franchise, limite) | Case + 2 montants | 🟡 FPQ1 : choix `protection_b` par véhicule (pas une garantie globale du parc avec limite propre) |
| 23 | Chapitre B Div. II — Collision ou versement | Case + 2 montants | 🟡 Flotte : `franchise_collision` (sans limite distincte) |
| 24 | Chapitre B Div. III — Accident sans collision | Case + 2 montants | 🟡 Flotte : `franchise_versement` |
| 25 | Chapitre B Div. IV — Risques spécifiés | Case + 2 montants | 🟡 seulement via le choix `protection_b` FPQ1 |
| 26 | Chapitre C Div. I — Tous risques (véhicules confiés) | Case + 2 montants | ❌ **le chapitre C — dommages aux véhicules des clients en garde — n'existe nulle part dans l'outil** |
| 27 | Chapitre C Div. II — Collision ou versement (véhicules confiés) | Case + 2 montants | ❌ idem |
| 28 | Chapitre C Div. III — Accident sans collision (véhicules confiés) | Case + franchise (ex. 1 000 $) + limite (ex. 50 000 $) | ❌ idem |
| 29 | Chapitre C Div. IV — Risques spécifiés (véhicules confiés) | Case + 2 montants | ❌ idem |

### Avenants (propres à la FPQ4)

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 30 | F.A.Q. n° 4-34 | Oui/Non | ❌ (le `faq34` du FPQ1 est un autre avenant) |
| 31 | F.A.Q. n° 4-70 | Oui/Non | ❌ |
| 32 | F.A.Q. n° 4-74 | Oui/Non | ❌ |
| 33 | F.A.Q. n° 4-82A | Oui/Non | ❌ |
| 34 | F.A.Q. n° 4-82B | Oui/Non | ❌ |
| 35 | F.A.Q. n° 4-82C | Oui/Non | ❌ |
| 36 | F.A.Q. n° 4-82D | Oui/Non | ❌ |

(Les `avenants` JSON de FPQ1/Flotte sont extensibles techniquement, mais aucun code 4-xx n'est au catalogue ni géré dans les propositions.)

### Historique

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 37 | Assureur antérieur | Texte | ✅ `*_antecedents.assureur_actuel` |
| 38 | Numéro de police antérieur | Texte | ✅ `*_antecedents.numero_police_actuelle` |
| 39 | Prime antérieure | Montant $ | 🟡 existe dans les antécédents Biens/RC/PE (`prime_precedente`) ; absent des antécédents auto/flotte |
| 40 | Pertes antérieures (détails : date, montant — lignes répétables) | Tableau | ✅ `sinistres_6ans` (auto) / `sinistres_flotte_5ans` (flotte) en JSON |

### Conducteurs (tous les conducteurs)

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 41 | Nom complet | Texte | ✅ FPQ1 et Flotte |
| 42 | Numéro de permis | Texte | ✅ FPQ1 et Flotte |
| 43 | Date de naissance | Date | ✅ FPQ1 et Flotte |
| 44 | Permis depuis (AAAA-MM) | Date | ✅ FPQ1 `date_obtention_permis` ; Flotte : années d'expérience |
| 45 | Lien | Texte | 🟡 FPQ1 `lien_assure` ; absent en Flotte |
| 46 | Employé depuis | Date | 🟡 Flotte `date_embauche` ; absent en FPQ1 |

### Signature

| # | Champ | Format / choix | Statut |
|---|-------|----------------|--------|
| 47 | Signature | Signature | ❌ |
| 48 | Date | Date | ❌ |

### Totaux FPQ4

**48 champs — ✅ 12 · 🟡 13 · ❌ 23**

---

## 3. Ce qui manque pour un dossier « remorquage » complet

Le dossier réel combine FPQ1 (les dépanneuses assurées comme véhicules désignés) + FPQ4 (l'exploitation du garage). Pour le traiter au complet, il manque à l'outil, par ordre d'importance :

1. **Tout le chapitre C de la FPQ4** — responsabilité/dommages pour les **véhicules des clients en garde** (les véhicules remorqués ou en réparation) : c'est la garantie signature du garagiste, inexistante dans l'outil.
2. **Les garanties FPQ4 chapitres A et B en mode « parc »** (franchise + limite par division, pour l'ensemble des véhicules) — l'outil ne connaît que le par-véhicule (FPQ1) ou deux franchises globales (Flotte).
3. **Le bloc Terrain/Sécurité du garage** : terrain clôturé, éclairage de nuit, gardien, garde des clés, alarme du garage, **nombre de plaques X**, **capacité maximale intérieur/extérieur**.
4. **Les avenants 4-34, 4-70, 4-74, 4-82A à 4-82D** au catalogue.
5. **Le lien FPQ1 ↔ FPQ4** (le formulaire FPQ4 renvoie explicitement à la police FPQ1 pour le détail des remorqueuses).
6. **Les employés par catégorie** (vendeurs / mécaniciens / manœuvres / direction).
7. Côté FPQ1 : **rayon d'opération par véhicule** (présent en Flotte seulement — critique en remorquage), **% États-Unis**, franchises B par division, question perte totale, signatures.
8. La **prime antérieure** dans les antécédents auto/flotte (le formulaire FPQ4 la demande).

À l'inverse, déjà solides : l'identité du proposant et de l'entreprise (fiche client), les véhicules désignés et leurs NIV, les conducteurs complets, l'historique d'assureur et de sinistres, la limite RC de 2 000 000 $.

---

## 4. Verdict — forme à donner

**Recommandation : un volet « FPQ4 — Garagistes » adossé au dossier auto, pas un 10e produit autonome.**

- **Pas un module FPQ4 autonome complet** : la FPQ4 ne se vend pratiquement jamais seule ; le formulaire lui-même renvoie à la FPQ1 pour le détail des véhicules. Un produit séparé dupliquerait l'assuré, les conducteurs et l'historique (déjà le point faible relevé : 12 ✅ seulement, presque tous empruntés à FPQ1/Flotte/client).
- **Pas une simple extension du FPQ1** : le chapitre C, le bloc terrain/sécurité et les avenants 4-xx sont un domaine différent (exploitation de garage, pas véhicule désigné) ; les noyer dans le formulaire FPQ1 briserait le miroir du formulaire officiel F.P.Q. n° 1.
- **La bonne forme : le patron « dossier combiné » déjà éprouvé** (Biens + RC + PE) appliqué à l'auto : un **dossier combiné auto** qui lie une soumission FPQ1 (véhicules + conducteurs) et une fiche FPQ4 (garage : terrain/sécurité, employés, garanties chapitres A/B/C, avenants 4-xx), avec une **proposition combinée FPQ1 + FPQ4** en un seul document — exactement comme l'assureur les reçoit ensemble dans le cas réel.

### Ce qu'impliquerait la construction (étapes courtes, patron des produits existants)

1. Tables `fpq4_*` minimales : fiche garage (terrain/sécurité, employés par catégorie, plaques X, capacités), garanties (chapitres A, B et C par division : oui/franchise/limite), avenants 4-xx, antécédents — ou réutilisation des antécédents FPQ1 liés.
2. Couche données `lib/fpq4.js` (miroir de `fpq1.js` : CRUD, versions figées, audit, cloisonnement cabinet).
3. Liaison au dossier : rattacher la fiche FPQ4 à la soumission FPQ1 (lien type `combine_liens`) et à la fiche client.
4. Formulaire + fiche (vues EJS, miroir des autres produits).
5. Catalogue d'avenants 4-34/4-70/4-74/4-82A-D et lignes de garanties chapitre C.
6. Proposition HTML/PDF combinée FPQ1 + FPQ4 calquée sur les deux formulaires réels.
7. Analyse de documents : reconnaître la FPQ4 (nouveau produit `fpq4` ou section du produit `auto`) et extraire vers les nouvelles tables.
8. Conversion en police : ajouter la ligne « FPQ4 » aux lignes de polices, conversion depuis le dossier lié.
9. Balayage de tests complet par étapes, comme pour les 9 produits existants.
10. Republication seulement sur Go de Patrick (instance gelée pendant ses tests).

---

## Documents de référence complémentaires

Les 15 autres documents réels fournis le 2026-10-21 (proposition Biens Policy Works, formulaire CFC Tech & Media, attestation d'assurance commerciale, mises à jour Economical Produit et Perte de revenu, demande umbrella Nexus, police combinée SDC Intact émise, certificat de continuation de cautionnement, soumissions propriétaire foncier et syndicat de copropriété, dossier complet entrepreneur — police, calendrier de prélèvement, avis « à transmettre au client », facture interne — et police de grossiste en souscription partagée) sont inventoriés et cartographiés dans le fichier compagnon :

**`REFERENCE-FORMULAIRES-ASSUREURS.md`** (même répertoire) — inventaire par document, cartographie ✅/🟡/❌ contre les modules de l'outil, synthèse des écarts transversaux et verdicts (sous-assureurs, certificats, modèle de police).

Les ajustements construits à partir des deux cartographies (directive de Patrick du 2026-10-21, 17 h 42) sont décrits dans `lib/ajustements-documents.js` et couverts par `scripts/test-ajustements-documents.js`.
