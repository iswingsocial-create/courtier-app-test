# Référence — Vidéos du parcours actuel de Patrick (système en place)

*Analyse des 3 vidéos reçues le 2026-10-21 via WeTransfer, filmées par Patrick pour montrer ce qu'il remplit présentement dans son système. Document structurel : on y relève les écrans, champs, questions et options — pas de données clients identifiables au-delà du nécessaire (les captures restent dans `video-patrick/captures/`).*

## 0. Méthode et avertissement majeur

| Vidéo | Durée | Résolution | Audio |
|---|---|---|---|
| `debut soumission.mp4` | 595,97 s (9 min 56 s) | 1890×1126 | Piste AAC présente mais **silencieuse** |
| `protection .mp4` | 171,43 s (2 min 51 s) | 1848×992 | Piste AAC présente mais **silencieuse** |
| `risque.mp4` | 151,04 s (2 min 31 s) | 1898×1018 | Piste AAC présente mais **silencieuse** |

**⚠️ Aucune narration n'a été enregistrée** : sur les 3 fichiers, la piste audio est numériquement vide du début à la fin (volumedetect : moyenne et maximum à −91,0 dB ; astats : niveau de crête −inf dB). Il n'y a donc **ni choix expliqués, ni raisons, ni irritants racontés par Patrick** — tout ce qui suit vient uniquement des écrans. Les « irritants » mentionnés plus loin sont des **inférences à partir des gestes filmés**, signalées comme telles, pas des propos de Patrick. Voir `video-patrick/transcriptions/` pour le constat formel par fichier.

Méthode : échantillonnage d'images toutes les 15 s (61 images) + détection de changements de scène (29 images, vidéo 1 seulement — les vidéos 2 et 3 défilent en listes, sans rupture franche), OCR français (tesseract.js + données `fra` embarquées de l'app, mêmes que son moteur), puis relecture visuelle en pleine résolution des écrans clés. Textes OCR bruts : `video-patrick/ocr/`.

## 1. Le système filmé

- **Applied Policy Works** (Vertafore Canada, SaaS) — menus : Fichier, Éditer, Souscription, **Marchandage**, Police, Listes, Outils, Fenêtre, Aide. Barre d'outils du dossier : Ouvrir, Enregistrer, Dossier parent, Impr./Envoy., Aperçu, Souscription, Emplacements, Risques, Tabl. d'assce, Détails de police, Liste à faire, Indio, Portail, Ajouter note.
- Cas filmé : un **renouvellement de combinée commerciale** (cycle présent 1-12-2026) pour une entreprise de **fabrication de crèmes glacées** comptant **4 emplacements à Montréal**, actuellement chez **Intact** (note de couverture NC-319-0302, produit-programme « Assurance des Entreprises »). Le dossier de marchandage contient un seul document : **« Soumission (courriel) »**.
- Contexte aperçu hors parcours (bascules vers Outlook/bureau) : le cabinet est **en migration vers Acturis** (réunions de suivi UAT Vertafore, courriel interne parlant d'un « ménage avant le changement de système informatique »). La vidéo documente donc le processus *actuel*, dans l'outil *sortant*.

## 2. Vidéo 1 — « debut soumission » (9 min 56 s) : création de la demande et détails de souscription

### Parcours, étape par étape

1. **Polices** (0:00) — Liste des polices du client : la note de couverture existante (Combinée Commerciale, Intact, effective 1-12-2025, expiration 1-12-2026, prime du terme 0 $). Panneau « Aide-souscripteur » récapitulant la police.
2. **Transactions** (~0:05-0:35, images de scène) — Registre des transactions de la police : colonnes Type, Effective, Expiration, Description, Prime payable, Prime du terme, Dernier u…, Créé… ; onglets **Transactions | Demandes d'avenant**.
3. **Assurés** (~0:30) — Recherche du client (10 858 assurés au système ; filtres Tous / Clients / Clients potentiels).
4. **Ajouter une police → modèle** (~1:00) — Fenêtre « Ajouter une police » : choix d'un **Modèle** (« Relevé IARD » vu), puis fenêtre de copie : « Copier les détails de souscription, emplacements et risques à partir de : [police source] » + case « Copier également les garanties à partir du tableau d'assurance ». Détails de police initiaux : Transaction initiale = **« Soumission (courrier) »** (liste), Langue = Français.
5. **Consultation des documents sources** (~2:15-2:45) — Patrick bascule vers des PDF ouverts : la **police actuelle Intact** du client (pages de garanties par situation : affectation, formule, franchise, montant, règle proportionnelle — d'où il recopie les valeurs) et, brièvement, un FPQ1 d'un autre dossier. La saisie se fait donc **en recopiant la police en vigueur**, écran contre écran.
6. **Détails de souscription** (~1:15 puis ~2:45-5:45) — L'écran central, à **11 onglets** : Société de courtage | Client | Personnes-ressources | Exploitation | Questions additionnelles | Responsabilité | Réclamations | Police précédente | Divers/Remarques | Pièces jointes.
7. **Emplacements** (~5:45-8:30) — Ajout des 4 emplacements **un par un** (voir §2.3).
8. **Pièces jointes de la souscription** (~8:45) — Options par pièce jointe : Afficher (Tout…), Taille, Impression (Compresser, Imprimer), Coupure de page avant/après.
9. **Liste à faire** (~9:30) — Ouverture de la liste des tâches du dossier ; une tâche **« Soumission (courriel) »** y apparaît en chargement : la sortie du processus est une **tâche de courriel**, pas un envoi filmé.
10. **Détails de police** (~9:45, fin) — Onglets Général | Souscriptions | Primes | Paiement ; Titre du produit-programme = « Assurance des Entreprises », Thème = « Invessa (CC) (Défaut) », Contrat = Sélectionner, Période de couverture. **Fenêtre surgissante : « Une conversion de l'adresse est requise — Veuillez convertir votre adresse en format civique »** (le système impose une normalisation d'adresse en fin de parcours).

### 2.1 Onglet « Société de courtage »

- Société ou maison de courtage, Sous-courtier (listes du cabinet).
- **Personnes-ressources** : listes déroulantes des intervenants du cabinet (courtier en placement, producteur…), chacune alimentée par l'annuaire complet des courtiers du cabinet.
- **Signatures sur la police** : Signature du courtier, Signature de l'émetteur (listes de personnes).

### 2.2 Onglet « Client » (petits caractères — lecture partielle)

- Nom légal de l'entreprise, Numéro de compte, **Type d'adresse : « Simple »** (liste), Adresse postale complète, section « Renseignements ».
- **Type d'entité / forme juridique** (liste ouverte, lecture partielle) : Association…, Autre — voir description des activités professionnelles, Coentreprise, Commission scolaire, École, Entreprise individuelle, Hôpital, Municipalité, Œuvre de bienfaisance (enregistrée / non enregistrée), Organisation, Organisme gouvernemental, Région, Société à but non lucratif, Société de personnes ou société de personnes à responsabilité limitée, Société par actions, Société par actions à responsabilité limitée, Urbain… — chaque entité est associée à un **« Code du BAC »**.
- **Codes d'industrie** : Code d'industrie principal (Code du BAC + bouton Rechercher + **% des revenus totaux**) ; Code(s) d'industrie supplémentaire(s) (2 lignes visibles, même structure) ; **Description des activités de l'assuré** (texte libre — saisi : fabrication de crème glacée et produits reliés à base de glace).
- Aide-souscripteur (en anglais) : « The address at which the first named Insured is to receive all correspondence regarding the insurance. »

### 2.3 Onglet « Personnes-ressources »

Tableau répétable : Nom de famille | Prénom | Poste | Téléphone | Cellulaire | Courriel (Ajouter… / Éditer / Supprimer).

### 2.4 Onglets « Exploitation » / « Responsabilité » — base de tarification

**Renseignements sur l'exploitation** :
- En affaire depuis : (année)
- Employés T/Plein : / T/Partiel : (nombres) — **☑ Couvert(s) par la CSST**
- Expérience antérieure liée (nombre d'années) : / (Depuis l'année) :

**Base de calcul de la prime — Responsabilité** :
- Recettes brutes annuelles : ($)
- % Internet : / % de sous-traitants :
- % Canadien : * 100 % / % E.-U. : * 0 % / % Étranger : * (les % géographiques sont **obligatoires**, marqués *)
- Note affichée : « La base de calcul varie selon le code de l'industrie du BAC de l'assuré. »

**Alcool — Responsabilité** (vu en OCR, écran adjacent) : « De l'alcool vendu sur les lieux? » ; Recettes fractionnées : Alcool / Nourriture / Autre.

**Aide-souscripteur « Questions additionnelles » (texte intégral, important)** : « Les questions additionnelles permettent aux assureurs de coter rapidement, des cotations justes. **Le nombre et le type de questions dépendent du code de l'industrie sélectionné.** » — Le mécanisme sectoriel de Policy Works est donc **déclenché par le code d'industrie BAC**, exactement le modèle visé pour la bibliothèque de questions de l'app.

### 2.5 Onglet « Police précédente »

- Question en tête : « **Un assureur a-t-il résilié, refusé, ou non renouvelé une assurance des entreprises au proposant au cours des 5 dernières années?** » (liste Oui/Non)
- ☐ Aucune police antérieure ☐ Assureur antérieur inconnu ; Remarques.
- Tableau des polices (Catégorie | Type | Assureur | Effective…) et fenêtre « Police précédente ou autres » :
  - Catégorie : (liste — « Police précédente »)
  - Type de police : (liste — valeur choisie : **« Police multirisques »**)
  - Assureur : (liste — valeur choisie : **« Intact Compagnie d'assurance »**)
  - Courtier : (texte)
  - Numéro de police : / **Prime : (valeur saisie : 18 505 $)**
  - Date effective : / Date d'expiration : (jj-mm-aaaa, sélecteur calendrier)
  - Raison du non-renouvellement : (liste) / Raison de l'annulation : (liste)
  - Remarques : (texte)
  - Aide : « Note there can only be one previous policy. »

### 2.6 Onglet « Divers/Remarques »

- « Renseignements divers relatifs à cette police : » (texte)
- « Circonstances spéciales relatives à cette police/application pour lesquelles la compagnie doit en être avisée : » (texte)
- **Déclaration du courtier** : « Cette entreprise/ce client est nouveau pour nous? Oui / Non »

### 2.7 Emplacements (écran « Tous les emplacements »)

- Liste : N° | Rue | Ville | Province | Code postal ; actions : Éditer, **Ajouter emplacement**, Supprimer, Copier, Couper, Coller, Renuméroter les emplacements, Excel, Colonnes.
- Fenêtre « Détails de l'emplacement » à **5 onglets : Général | Inspection | Évaluation | Codification | Pièces jointes**.
  - Général : Numéro de l'emplacement, Type d'adresse (« Simple »), adresse complète, « Fixer par défaut ».
  - **Inspection** : ○ « Ce risque n'a pas été inspecté » / ○ « Ce risque a été inspecté le : [date] Inspecté par : » ; « Les détails de l'inspection sont joints : Oui/Non ».
- Les 4 adresses sont saisies **séquentiellement, une fenêtre par emplacement**, avec renumérotation automatique au fil des ajouts (la fenêtre propose à chaque fois le numéro suivant).
- *Inférence (geste filmé, pas une narration)* : la saisie des 4 emplacements est répétitive — même fenêtre rouverte 4 fois, adresse tapée champ par champ.

## 3. Vidéo 2 — « protection » (2 min 51 s) : le tableau d'assurance et le catalogue de libellés

La vidéo entière se déroule dans le **Tableau d'assurance** de la demande, et surtout dans sa fenêtre **« Sélectionner des garanties »** — le cœur de la « bibliothèque de libellés » que Patrick veut dans l'app.

### 3.1 La fenêtre « Sélectionner des garanties »

- Deux zones : **Sélectionnés** / **Disponibles**, avec recherche texte.
- **Onglets de catégories** : Tout | Biens | Pertes de BB | Pertes d'expl. | Bris d'équipement | Crime | RC | CYBER | RC compl. | XS | Autres.
- Colonnes du catalogue : Nom | **No de form.** (numéro de formulaire du libellé) | type de formule (Étendue / Risques désignés / Standard / Prime fixe…).
- Libellés relevés au fil du défilement (liste partielle — le catalogue complet n'est pas visible) :
  - *Transport/flottantes* : Assurance du transport unique (formule étendue) ; Garantie des marchandises transportées par camion (assurance complémentaire) ; Assurance des chantiers (formule étendue) ; Assurance flottante d'installation (formule étendue) ; Assurance des clients des dépositaires (formule étendue) ; Assurance de responsabilité des entreposeurs ; Garantie du matériel et des marchandises des équipementiers (formule étendue) ; Assurance flottante des risques d'exposition (formule étendue) ; Autres assurances flottantes ; Assurance des autres activités commerciales (formule étendue).
  - *Pertes d'exploitation* : Assurance des bénéfices (formule étendue) ; Assurance des pertes de bénéfice brut — risques commerciaux ou non industriels (formule étendue) / risques industriels (formule étendue) / sans coassurance (formule étendue) ; Assurance des loyers ou de la valeur locative (formule étendue) ; Assurance des revenus de location bruts (formule étendue) ; Assurance des frais supplémentaires (formule étendue) ; Assurance des autres pertes d'exploitation (formule étendue) ; Assurance de carence.
  - *Responsabilité civile* : Assurance de la responsabilité civile générale des entreprises (formule par sinistre) ; Assurance de la responsabilité civile des entreprises (formule par sinistre) (**BAC 04/98**) ; Assurance de la responsabilité civile des entreprises (formule par sinistre) (**BAC 04/86**) ; Assurance de la responsabilité civile des entreprises (sur la base des réclamations présentées) ; Assurance de la responsabilité civile (formule générale) ; Assurance de la responsabilité civile des propriétaires, des bailleurs et des locataires ; Assurance de la responsabilité locative (formule étendue) / (formule restreinte) ; Assurance de la responsabilité civile automobile (formule des non-propriétaires) ; Assurance de la responsabilité civile automobile dans le monde entier (formule des non-propriétaires) ; Assurance de la responsabilité civile imputable à la pollution.
  - *Exclusions (libellés autonomes, à ajouter comme des garanties)* : Exclusion des actes de terrorisme ; Exclusion des données ; Exclusion de l'amiante ; Exclusion du risque de guerre civile et étrangère ; Exclusion des substances illicites ; Exclusion du sol, de l'eau et de l'air ; Exclusion de la reconnaissance électronique de la date ; Exclusion des champignons et dérivés fongiques.
  - *Divers* : Extension du programme ; « Autre libellé » (× plusieurs variantes : formule étendue / risques désignés, avec ou sans Prime fixe, sur la base des réclamations présentées) — le mécanisme de **libellé libre** quand le catalogue ne contient pas la garantie voulue.
- Sélection finale visible : « Assurance des Biens commerciaux (formule étendue) » + « Assurance de la responsabilité civile générale des entreprises (formule par sinistre) ».

### 3.2 Le tableau d'assurance rempli (structure)

Colonnes : **No de form. | Description | Divers | Fra (franchise) | R.P. % (règle proportionnelle) | Limite | Taux | Prime annuelle**. Arborescence éditable (Déplacer vers le haut/bas, Retrait à gauche/droite, Ajouter garantie, Éditer les détails, Rech./Remp.) :

- Section **Biens**
  - *Assurance des Biens commerciaux (formule étendue)* → par emplacement (Empl. 1 à 4) → lignes **Bâtiment(s)** et **Contenu**, chacune : franchise 1 000, R.P. 90 %, Limite (à remplir).
  - *Assurance prolongée des pertes de bénéfice brut (formule étendue)* — R.P. 100 %, lignes par emplacement, puis paramètres : Période d'indemnisation maximale (en mois) : 12 ; Salaires ordinaires : 100 % ; Nombre de jours consécutifs : 90 ; Honoraires de comptables : limite 5 000.
  - *Avenant — refoulements d'égouts*.
- Section **Bris d'équipement**
  - *Assurance bris d'équipement* → « Montant de garantie par accident » par emplacement ; « Réparations ou remplacement inclus » ; « Limitations de la garantie » (texte : « indiquer les limitations de la garantie »).
- Section **Responsabilité** (bas d'écran, partiellement visible)
  - *Assurance de la responsabilité civile générale des entreprises (formule par sinistre)* → Montant de garantie par sinistre ; Responsabilité civile produits et travaux terminés incluse ; Montant par période d'assurance — RC produits et travaux terminés ; Montant de garantie pour préjudice personnel ou imputable à la publicité ; Plafond pour frais médicaux…

Point structurant : **le tableau est un arbre de libellés paramétrés par emplacement**, où chaque libellé apporte ses propres sous-lignes de paramètres ({Misc} = champs libres du libellé). Les colonnes Taux et Prime annuelle restent **vides** dans une demande de prix — comme dans la proposition combinée de l'app.

## 4. Vidéo 3 — « risque » (2 min 31 s) : les risques « Bâtiments » par emplacement

### Parcours

1. **Tous les risques** — Liste des risques de la demande : un risque **« Bâtiments » par emplacement** (4 lignes : Emplacement / Risque n° / Adresse / Nom). Actions : Éditer, Ajouter risque, Supprimer, Copier/Couper/Coller, Renuméroter les risques, Excel, Colonnes.
2. Fenêtre **« Bâtiments au [adresse] »** à **10 onglets : Général | Construction | Rénovations | Feu | Vol | Affectation | Exploitation | Voisinage | Pièces jointes | Bénéficiaires**. Patrick passe les onglets en revue pour les emplacements 1, 2 et 4 (démonstration de la structure, peu de saisie).

### 4.1 Onglet « Général »

Nom/description du bâtiment (« Name — Provide a description of the building at this location »), étages, **Année de construction**, **Superficie totale du bâtiment** (pi²).

### 4.2 Onglet « Construction » — listes déroulantes ouvertes (relevés)

- **Type de bâtiment / classe** (liste partielle) : Maçonnerie ; Incombustible (acier) avec maçonnerie ; Incombustible (acier) sans maçonnerie ; Maçonnerie sur structure de bois ou autres matériaux combustibles ; Type « Mills » (bois de faible combustion)…
- **Sous-sol** : Béton ou matériaux résistant au feu ; Bois ou autres constructions combustibles…
- **Recouvrement de la toiture** (liste ouverte) : Bardeaux laminés (d'asphalte) ; Bardeaux de fente ; Béton sur structure d'acier ; Caoutchouc ou polymère ; Dôme en verre (fenestration) ; Goudron et gravier ; Papier goudronné ; Plastique ; Platelage en tôle ou métallique ; Verre, polyéthylène ou polymère sur métal ; Autres…
- Chauffage : type d'appareil, combustible utilisé (voir liste suivante).
- **Type d'appareil de chauffage** (liste ouverte, ~30 valeurs — taxonomie très fine) : Appareil à air chaud (central) ; Appareil à air chaud (central) avec ajout d'un appareil de chauffage au bois ; Appareil de chauffage au sol ; Appareil de chauffage d'appoint ; Appareil de chauffage extérieur à combustible solide ; Appareil de chauffage intérieur à combustible solide ; Appareil de chauffage intérieur au bois ; Appareil de chauffage mural ; Appareil de chauffage par rayonnement ; Appareil électrique ; Chaudière ; Cheminée encastrable ; Combinaison bois/huile ; Combinaison d'un système de chauffage principal à l'extérieur et d'un système complémentaire à l'intérieur ; Four à réverbère sans tuyauterie ; Fournaise à bois ; Fournaise à bois rajoutée ; Foyer de briques ; Générateur électrique d'air chaud ; Poêle à bois à combustion lente ou hermétique ; Poêle à bois non étanche ; Poêle à granules ; Poêle ACORN, Franklin ou Potbelly (installation détachée ou aucune porte) ; Poêle alimenté au charbon ; Poêle-cuisinière ; Poêle cuisinière à bois ; Radiateur encastré…

### 4.3 Onglet « Rénovations » (écran complet, lu en pleine résolution)

- **☑ Aucune connue**
- ☐ Électricité — Année : — Complète ou partielle : (liste)
- ☐ Plomberie — Année : — Complète ou partielle : (liste)
- ☐ Chauffage — Année : — Complète ou partielle : (liste)
- ☐ Toiture — Année : — Complète ou partielle : (liste)

### 4.4 Onglet « Feu » (aperçu partiel)

« Entièrement couvert par système de gicleurs » ; « Système d'extincteurs » (champs en partie illisibles à cette résolution).

### 4.5 Onglet « Exploitation » (par bâtiment)

Code d'industrie principal : Code du BAC + % des revenus + occupation ; Code(s) d'industrie supplémentaire(s) (2 lignes : code BAC, % des revenus, occupation). — Les codes d'industrie existent donc **aussi au niveau de chaque emplacement/bâtiment**, pas seulement au niveau de l'entreprise.

### 4.6 Onglet « Bénéficiaires » (écran complet, lu en pleine résolution)

- Liste répétable des bénéficiaires **du bâtiment** (Ajouter… / Éditer / Supprimer, ordre modifiable).
- « **Imprimer la clause suivante sur le tableau des bénéficiaires :** » (liste de clauses)
- ☐ « Imprimer les ordinaux avec les bénéficiaires (ex : 1er, 2e, 3e, etc.) »

### 4.7 Onglets « Vol », « Affectation », « Voisinage »

Seuls les libellés d'onglets et, pour Voisinage/Affectation, un champ **Notes** libre sont aperçus (« Use this section to list any additional, pertinent information that the underwriter should know about the overall exposures at this location ») avec sélecteur d'emplacement. Le détail structuré (distances, affectations voisines) n'est **pas visible** dans la vidéo.

## 5. Croisement avec l'app actuelle

Base : état **après** la construction de la soumission combinée (2026-10-21), d'après `REFERENCE-SOUMISSION-COMBINEE.md` (cartographie), `REFERENCE-AUTOMATISATION.md` (matrices) et le dictionnaire de l'app (`lib/dictionnaire-champs.json`).

| Bloc vu dans la vidéo | État app | Commentaire |
|---|---|---|
| Demande combinée Biens + RC + PE en un dossier, cycle de renouvellement | ✅ | Dossier combiné liant les 3 soumissions du même client. |
| Emplacements multiples, fiche par emplacement | ✅ | `biens_batiments` = fiche emplacement maîtresse. |
| Onglets Inspection / Évaluation de l'emplacement (inspecté le/par, détails joints ; évaluation datée) | ✅ | Colonnes `inspecte`, `inspection_date`, `inspection_statut`, `evaluation_date`, `evaluation_par`, `evaluation_cout_remplacement` au dictionnaire. |
| Construction par composant (murs, toit, planchers, sous-sol) + classe assureur | ✅ | Ajouté à la combinée (+58 colonnes, `classe_construction`). Les **listes de valeurs** de Policy Works (toiture : 11 valeurs ; chauffage : ~30) restent à aligner finement — voir 🟡 chauffage. |
| Rénovations : 4 systèmes, année + complète/partielle, « Aucune connue » | ✅ | Même patron construit à la combinée. |
| Voisinage structuré (4 côtés, distance + affectation) | ✅ (app) / ❌ (vidéo) | L'app est **plus structurée que ce que la vidéo montre** : Policy Works n'affiche qu'un champ Notes à cet onglet dans la vidéo. |
| Bénéficiaires par emplacement | ✅ | `emplacement_beneficiaires` à la combinée. La **clause à imprimer sur le tableau des bénéficiaires** et les ordinaux : ❌ détail nouveau. |
| Exploitation entreprise : fondation, expérience liée, employés TP/partiel, CSST, recettes + % géo (Can/EU/Étranger) + % Internet + % sous-traitants, alcool | ✅ | Profil de souscription du client construit à la combinée (étapes 1 et 5-6). |
| Codes d'industrie **BAC** : répertoire avec recherche, principal + supplémentaires, **% de revenus par code** | 🟡 | L'app a code + description d'industrie et répartitions au niveau client ; pas de **répertoire de codes BAC** intégré ni de recherche, et pas de déclinaison **par emplacement** (onglet Exploitation du bâtiment) comme dans Policy Works. |
| Forme juridique / type d'entité | 🟡 | Liste présente au profil client ; la taxonomie filmée est celle des **types d'entité BAC** (commissions scolaires, hôpitaux, municipalités, œuvres de bienfaisance, organismes gouvernementaux, sociétés de personnes à responsabilité limitée…) — plus large, à aligner. |
| Police précédente : question résilié/refusé/non-renouvelé (5 ans), type (« Police multirisques »), assureur, courtier, n° de police, **prime**, dates d'effet/expiration, raisons de non-renouvellement/annulation | ✅ | Antécédents communs construits à la combinée (étape 6). Les **listes de raisons** (non-renouvellement, annulation) ne sont pas documentées côté app : 🟡 sur ce point précis. |
| Divers/Remarques : renseignements divers, circonstances spéciales, déclaration « nouveau client » | 🟡 | L'app a des notes par soumission et 4 rubriques de remarques visées par la cartographie ; la **déclaration du courtier « nouveau pour nous Oui/Non »** n'y figure pas. |
| Personnes-ressources (nom, prénom, poste, téléphone, cellulaire, courriel) | ✅ | `contacts` du client. |
| Société de courtage : en-tête d'envoi, signatures (courtier, émetteur), courtier en placement / producteur | 🟡 | En-tête cabinet construit (étape 1) ; les **signatures nommées sur la police** et le rôle « courtier en placement » distinct du producteur : partiels. |
| Plan de paiement souhaité, code courtier chez l'assureur | 🟡 | Relevés dans la cartographie des envois réels (§1.1), pas revus dans la vidéo. |
| **Catalogue de libellés sélectionnables (avec No de formulaire, catégories, variantes étendue/risques désignés/claims-made/BAC 04/86-04/98, libellés d'exclusion autonomes, « autre libellé » libre)** | ❌ | **Apport majeur de la vidéo.** L'app structure les garanties par produit (lignes, avenants {présent, franchise, montant}), mais n'a **aucune bibliothèque de libellés** rattachable ligne à ligne, ni numéros de formulaires, ni variantes de libellé par assureur. |
| **Tableau d'assurance en arbre** : sections → libellés → lignes par emplacement, colonnes No de form. / Divers / Franchise / R.P. % / Limite / Taux / Prime | 🟡 | La proposition combinée de l'app produit un tableau des garanties consolidé au même esprit (Taux/Prime vides), mais pas un **arbre éditable de libellés paramétrés par emplacement** alimenté par le catalogue ci-dessus. |
| Paramètres propres à un libellé (période d'indemnisation, salaires ordinaires %, jours consécutifs, honoraires de comptables) portés par la ligne PE du tableau | ✅ | PE complétée à la combinée (formule, période, salaires, honoraires de comptables, montant par établissement). |
| **Modèle de police + copie depuis une police existante** (« Relevé IARD » ; copier détails de souscription, emplacements, risques et garanties) | ❌ | L'app versionne un dossier, mais n'a ni **modèles de demandes** ni **copie inter-dossiers** (le geste d'ouverture de chaque renouvellement dans Policy Works). |
| **Document de sortie « Soumission (courriel) »** rangé dans l'arbre du dossier + **tâche « Liste à faire »** associée | ❌ | Cohérent avec F15 ❌ (registre de mise en marché absent, `REFERENCE-AUTOMATISATION.md`) : l'app crée un brouillon de demande de prix, mais pas le document-courriel de marchandage ni sa tâche de suivi. **Aucun écran d'envoi à l'assureur n'est filmé** (destinataires, pièces jointes, envoi) : la mécanique d'envoi reste à documenter. |
| Registre **Transactions / Demandes d'avenant** de la police (prime payable, dates, descriptions) | 🟡 | F17 partiel : la vérification d'avenant existe ; le registre transactionnel de la police, non. |
| **Conversion d'adresse en format civique** imposée en fin de saisie + type d'adresse « Simple » | ❌ | L'app n'a de normalisation d'adresses que via Google Places à l'ouverture vocale de dossier ; pas de validation civique systématique à la saisie d'un emplacement. |
| **Aide-souscripteur contextuelle** (panneau d'aide par écran/champ, souvent en anglais) | ❌ | Aucun équivalent structuré dans l'app (le dictionnaire donne des libellés, pas des aides contextuelles). |
| Détails de police côté assureur : produit-programme, thème du cabinet, onglets Primes/Paiement | 🟡 | F20 partiel (finances) ; la notion de « produit-programme » assureur n'est pas modélisée. |
| Questions additionnelles sectorielles **déclenchées par le code d'industrie** | 🟡 | Mécanisme amorcé (17 questions copropriété + 7 entrepreneur dans `client_questions_sectorielles`) ; la vidéo confirme le déclencheur (code BAC) mais **ne montre aucun jeu de questions réel** : l'onglet « Questions additionnelles » n'est jamais ouvert. |

## 6. Synthèse — ce que la vidéo apporte de nouveau

1. **Le catalogue de libellés est réel, structuré et filmé** : catégories (Biens, PE, Bris, Crime, RC, Cyber, RC complémentaire, XS, Autres), numéros de formulaires, variantes (formule étendue / risques désignés / standard / prime fixe / par sinistre / réclamations présentées / BAC 04/86 et 04/98), libellés d'**exclusion** autonomes et mécanisme « autre libellé » libre. C'est la matière première exacte de la bibliothèque de libellés demandée par Patrick (base + versions par assureur) — elle n'existait dans nos référentiels que comme principe (BAC) et comme lignes de garanties des envois réels.
2. **Le tableau d'assurance est un arbre de libellés paramétrés par emplacement**, pas un tableau plat : section → libellé → emplacement → bâtiment/contenu, avec franchise et règle proportionnelle **par ligne** et paramètres propres au libellé ({Misc}). La proposition combinée de l'app devra s'y aligner si on veut produire le même document.
3. **Le point d'entrée de chaque dossier est un modèle + une copie** (« Relevé IARD », copie des détails/emplacements/risques/garanties depuis la police en vigueur) : le renouvellement ne repart jamais d'une page blanche. Ni modèles ni copie inter-dossiers n'existent dans l'app.
4. **La sortie du processus est un document « Soumission (courriel) » + une tâche** dans la Liste à faire — la mise en marché (F15) commence là dans Policy Works ; aucun écran d'envoi proprement dit n'est filmé, donc les étapes « choisir les assureurs / envoyer / suivre » restent à documenter autrement (exemples réels demandés pour la phase 1 de la feuille de route).
5. **Les codes d'industrie sont des codes BAC**, avec répertoire recherchable, % de revenus par code, code principal + codes supplémentaires, déclinés **au niveau entreprise ET au niveau de chaque bâtiment** ; ils pilotent à la fois la base de tarification RC et le jeu de « Questions additionnelles ».
6. **Taxonomies assureurs très fines** désormais relevées : recouvrement de toiture (11+ valeurs), appareils de chauffage (~30 valeurs, dont tout le bois/poêles), classes de construction et de sous-sol — des listes de valeurs prêtes à importer, plus granulaires que les listes actuelles de l'app.
7. **Détails de conformité/présentation nouveaux** : clause à imprimer sur le tableau des bénéficiaires (+ ordinaux), déclaration du courtier « nouveau client pour nous », signatures nommées (courtier, émetteur) et rôles distincts courtier en placement / producteur, conversion d'adresse au format civique exigée par le système.
8. **Le registre Transactions / Demandes d'avenant** de la police (prime payable, dates d'effet/expiration par transaction) — la vue « vie de la police » qui manque entre F17 et F20.
9. Confirmation de plusieurs patrons déjà construits dans l'app (rénovations année + ampleur + « aucune connue », police précédente complète avec prime, inspection/évaluation par emplacement, PE paramétrée) : la vidéo **valide** ces choix plutôt qu'elle ne les contredit — sauf le voisinage, où l'app est plus structurée que Policy Works.

## 7. Ce qui reste flou ou absent de la vidéo

- **Aucune narration** (audio silencieux) : aucun choix expliqué, aucun irritant raconté, aucune raison donnée. Les seuls « pourquoi » visibles sont les aides-souscripteur du logiciel.
- **Onglet « Questions additionnelles » jamais ouvert** : le jeu de questions sectoriel du cas filmé (fabrication alimentaire/crèmerie) reste inconnu ; idem pour l'onglet **« Réclamations »** (jamais ouvert) — l'historique de sinistres du parcours n'est pas documenté par la vidéo.
- **Onglets « Vol » et « Affectation »** des bâtiments : jamais ouverts ; « Feu » et « Voisinage » seulement entrevus (le voisinage structuré gauche/droite/arrière que Patrick avait signalé comme manque n'apparaît pas — seul un champ Notes est visible).
- **Aucun écran de mise en marché** : pas de choix d'assureurs destinataires, pas de composition/envoi du courriel de soumission, pas de réponses d'assureurs. La vidéo couvre la **préparation** de la demande, pas son **envoi** ni son suivi.
- **Onglet « Client » en petits caractères** : plusieurs libellés restent partiels malgré l'OCR (adresse postale, section « Renseignements ») ; la liste des types d'entité est tronquée (défilement non terminé).
- **Catalogue de libellés incomplet** : la fenêtre « Sélectionner des garanties » défile vite ; les catégories Crime, CYBER, RC compl., XS et Autres ne sont pas explorées, et les numéros de formulaires (colonne « No de form. ») sont le plus souvent illisibles à cette résolution.
- Valeurs du cas filmé : il s'agit d'un **renouvellement** (recopie de la police Intact en vigueur) — les écrans de **nouvelle affaire** (prospect sans police précédente) peuvent différer et ne sont pas montrés.
- Quelques incohérences de lecture dues à l'OCR/résolution (ex. adresse du 3e emplacement lue « 324 » puis « 334 » rue de Castelnau Est ; jours consécutifs PE lus 20 puis **90** en pleine résolution — retenir 90).
