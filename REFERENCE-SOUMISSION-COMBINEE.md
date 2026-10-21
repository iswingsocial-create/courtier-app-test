# Référence — Soumission combinée entreprise (inventaire, cartographie, plan)

Document de travail interne — inventaire **structurel seulement** (noms de champs, sections, types, listes de choix). Aucune donnée de client identifiable n'y figure : les documents sources sont cités génériquement.

**Sources analysées (8 documents, octobre 2026)**

- **Application JM « Single Application »** (bilingue, 14 pp) : trousse d'un assureur spécialisé (bijouterie) en trois formulaires — *Underwriting Application* (4 pp), *Jewellers Block Application* (6 pp), *Requested Coverage Limits* (3 pp). Sa « Partie A — Renseignements généraux sur le risque » est un squelette commercial générique réutilisable ; les parties B à F sont largement sectorielles.
- **Application AOL/COL Canada** (5 pp) : **AOL = « Add a Location », COL = « Change of Location »** — formulaire du même assureur pour ajouter/retirer un emplacement à une police existante. Il reprend la même Partie A par emplacement + un bloc « Businessowners Coverages » (bâtiment en valeur à neuf ou valeur au jour du sinistre, contenu, franchises normalisées) + assurés additionnels.
- **Questionnaire système d'alarme** (2 pp) : questionnaire technique du même groupe d'assureurs — transmissions primaire/secondaire, sécurité de ligne, centrale, couverture de détection, répondants, entretien.
- **5 soumissions remplies réelles** (format « Assurance des Entreprises — Soumission — Demande de prix », sortie du système actuel du cabinet) : 2 soumissions copropriété remplies, 1 soumission immeuble commercial remplie, 1 soumission hébergement touristique remplie, 1 soumission entrepreneur (nettoyage après sinistre) remplie. **Ce sont elles qui définissent le vrai format d'envoi aux assureurs** : un seul document combiné par client.

**Comment lire la cartographie** — ✅ existe dans l'app (colonne/table nommée) · 🟡 partiel (existe en plus sommaire, écart précisé) · ❌ manquant. « Portée » = **E** entreprise · **L** emplacement/bâtiment · **S** soumission/dossier.

---

## 1. Inventaire des champs de référence et cartographie vs l'app actuelle

### 1.1 En-tête et envoi

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 1 | Plan de paiement souhaité | S | Liste : Annuel, 2 versements, 4 versements, 8 versements, 12 versements | ❌ Aucun champ |
| 2 | Code courtier chez l'assureur | S | Texte | ❌ Aucun champ |
| 3 | Coordonnées du courtage émetteur (adresse, téléphone, télécopieur, site Web, courriel) | Cabinet | Texte | ❌ `cabinets` ne contient que `nom` — aucun en-tête d'envoi possible |
| 4 | Courtier en placement et producteur (nom, téléphone, poste) | S | Réf. utilisateur | 🟡 `users` + `cree_par` existent ; poste téléphonique et rôle « placement » absents |
| 5 | Durée de la garantie proposée (du – au) / date d'effet proposée | S | Dates | 🟡 `*_soumissions.date_effet_souhaitee` seule ; pas de date de fin |

### 1.2 Proposant / entreprise

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 6 | Nom légal du proposant (dénomination sociale) | E | Texte | ✅ `clients.raison_sociale` |
| 7 | Noms d'exploitation et filiales à assurer | E | Texte | ❌ Aucun champ (notes seulement) |
| 8 | Adresse postale (rue, ville, province, code postal) | E | Texte | ✅ `clients.adresse`, `ville`, `code_postal`, `province` |
| 9 | Dirigeants / administrateurs (nom + titre, en nombre illimité) | E | Répétable | 🟡 `contacts` (prenom, nom, titre, principal) — pas de notion « dirigeant » |
| 10 | Personne-contact (nom, téléphone, courriel) | E | Texte | ✅ `contacts` / `clients` (prenom, nom, telephone, courriel) |
| 11 | Forme juridique | E | Liste : Société par actions, Propriétaire unique, Société à responsabilité limitée, Fiducie, Société en nom collectif, Coentreprise, Association, Autre | ❌ Aucun champ (vu en pratique en texte libre « Description de l'entité légale ») |
| 12 | Description des activités de l'assuré | E | Texte riche | 🟡 `clients.secteur_activite` (sommaire) ; description détaillée seulement par lieu dans `rc_exploitations.description_activites` |
| 13 | Code de l'industrie (code + description + % des revenus) | E/L | Code + % | 🟡 `rc_exploitations.code_classification` (code RC assureur, sans % de revenus ni répertoire de codes d'industrie) |
| 14 | **Année de fondation de l'entreprise (« En affaire depuis »)** | E | Année (4 chiffres) | ❌ Absent de `clients` et des produits combinés ; n'existe qu'en cautionnement (`annee_fondation`, principal) — **manque signalé par Patrick** |
| 15 | Expérience antérieure liée (années) | E | Nombre | ❌ Aucun champ |

### 1.3 Exploitation — base de tarification (renseignements RC de l'envoi réel)

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 16 | Recettes brutes annuelles | E | Montant $ | ✅ `clients.chiffre_affaires` ; aussi `rc_exploitations.chiffre_affaires` par lieu |
| 17 | Répartition des recettes par type d'activité (%) | E | % par type : détail, gros, réparation, fabrication, estimation, affinage, achat d'or, autre | ❌ Aucune ventilation structurée (texte libre seulement) |
| 18 | Répartition géographique des recettes (%) | E | % : Canada, États-Unis, étranger, Internet | ❌ Aucun champ |
| 19 | Masse salariale annuelle | E | Montant $ | 🟡 `rc_exploitations.masse_salariale` — par lieu seulement, pas au niveau entreprise |
| 20 | Nombre d'employés à temps plein | E | Nombre | 🟡 `clients.nb_employes` (total, sans ventilation) ; `rc_exploitations.nb_employes` par lieu |
| 21 | Nombre d'employés à temps partiel | E | Nombre | ❌ Aucune distinction plein/partiel |
| 22 | Employés couverts par la CSST | E | Oui/Non | ❌ Aucun champ |
| 23 | Sous-traitance (% des recettes + recours aux sous-traitants) | E/L | % + liste | 🟡 `rc_exploitations.sous_traitants` (aucun/assurés/non assurés) ; le % est absent |
| 24 | Responsabilité liée à la vente de boissons alcoolisées | E | Oui/Non | ❌ Aucun champ |

### 1.4 Questions additionnelles sectorielles

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 25 | Jeu de questions additionnelles selon le code d'industrie (ex. copropriété : nombre d'unités, déneigement sous-traité à un tiers assuré, durée de location la plus courte, résidence étudiante ; entrepreneur : démolition, amiante/MIUF, travaux structurels, étayage, % de travaux par type…) | E | Oui/Non, nombres, % — jeu variable | ❌ Aucun mécanisme de questionnaire sectoriel |

### 1.5 Emplacement — identification et affectation

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 26 | Adresse de l'emplacement (étage, rue, bureau/suite, ville, province, code postal) | L | Texte | 🟡 `biens_batiments.adresse`, `ville`, `code_postal` ; étage, bureau et province absents |
| 27 | Type d'emplacement | L | Liste : Condominium commercial, Indépendant, Centre-ville (hors centre commercial), Kiosque, Centre commercial fermé, Galerie marchande, Domicile, Autre | ❌ Aucun champ |
| 28 | Type de bâtiment | L | Liste : Commercial, Détaché, Habitation, Copropriété résidentielle (sans commerces)… | 🟡 `biens_batiments.occupation` en texte libre fait office de substitut sommaire |
| 29 | Intérêt de l'assuré (Propriétaire de l'immeuble, Locataire…) | L | Liste | ❌ Aucun champ |
| 30 | Superficie occupée par l'assuré (pi²) | L | Nombre | ❌ Seule la superficie totale existe (`superficie_pi2`) |
| 31 | Pourcentage vacant (%) | L | % | ❌ Aucun champ |
| 32 | Partage des lieux / autres occupants (oui/non + description des autres occupations du bâtiment) | L | Oui/Non + texte | ❌ Aucun champ |
| 33 | Étage(s) occupé(s) par l'assuré | L | Texte/nombre | ❌ Aucun champ |

### 1.6 Bâtiment — construction et matériaux

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 34 | Année de construction | L | Année | ✅ `biens_batiments.annee_construction` |
| 35 | Superficie totale du bâtiment (pi²) | L | Nombre | ✅ `biens_batiments.superficie_pi2` |
| 36 | Nombre d'étages | L | Nombre | ✅ `biens_batiments.nb_etages` |
| 37 | Classe de construction | L | Liste assureur : Bois (Frame), Maçonnerie avec solives, Incombustible, Maçonnerie incombustible, Résistant au feu modifié, Résistant au feu | 🟡 `biens_batiments.type_construction` (bois/acier/béton/maçonnerie/mixte) — taxonomie différente, aucune notion de résistance au feu |
| 38 | **Matériau des murs** (ex. Bois ; Acier sur acier ; Bois lambrissé briques ; Béton) | L | Liste/texte | ❌ Aucun champ — **manque signalé par Patrick** |
| 39 | **Structure du toit** (ex. Poutres d'acier ; Structure de bois sur poutres de bois) | L | Liste/texte | ❌ Aucun champ — idem |
| 40 | **Finition du toit / couverture** (ex. Bardeaux d'asphalte ; Goudron et gravier ; Toiture d'acier ; Caoutchouc ou polymère) | L | Liste/texte | ❌ Aucun champ — idem |
| 41 | Matériau des planchers / sol (Béton, Bois, matériau résistant au feu…) | L | Liste/texte | ❌ Aucun champ |
| 42 | Sous-sol (Aucun, Béton…) | L | Liste/texte | ❌ Aucun champ |
| 43 | Valeur du bâtiment / coût de remplacement ($) | L | Montant | ✅ `biens_batiments.valeur_batiment` |

### 1.7 Bâtiment — mécanique / systèmes

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 44 | Électricité — type (Disjoncteurs, Fusibles…) | L | Liste | ❌ Aucun champ côté biens |
| 45 | Chauffage — type d'appareil (Appareil à air chaud central, Électrique, Mural, Biénergie…) | L | Liste/texte | 🟡 `biens_batiments.chauffage` en texte libre, sans liste d'appareils |
| 46 | Carburant utilisé (Gaz naturel, Énergie électrique, Pétrole, combinaison) | L | Liste | ❌ Aucun champ distinct |
| 47 | Plomberie — matériaux (Cuivre/PVC, Plastique…) | L | Liste/texte | ❌ Aucun champ |

### 1.8 Bâtiment — rénovations

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 48 | Rénovation de la toiture (année + ampleur : Complète/Partielle) | L | Année + liste | 🟡 `biens_batiments.annee_toiture` — année seule, ampleur absente |
| 49 | Rénovation de l'électricité (année + ampleur) | L | Année + liste | ❌ Aucun champ — **manque signalé par Patrick** |
| 50 | Rénovation de la plomberie (année + ampleur) | L | Année + liste | ❌ Aucun champ — idem |
| 51 | Rénovation du chauffage (année + ampleur) | L | Année + liste | ❌ Aucun champ — idem |
| — | Mention « Aucune rénovation connue » | L | Déclaration | ❌ (conséquence des 4 champs ci-dessus laissés vides) |

### 1.9 Inspection et évaluation

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 52 | Inspection (emplacement inspecté ou non, date, remarques) | L | Oui/Non + date + texte | ❌ Aucun champ |
| 53 | Évaluation (évalué ou non, date, évaluateur, coût de remplacement, détails joints oui/non) | L | Oui/Non + date + texte + montant | ❌ Aucun champ (`valeur_batiment` ne porte ni date ni évaluateur) |

### 1.10 Protection incendie

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 54 | Prise d'eau / borne-fontaine — distance | L | Liste : À moins de 150 mètres, À moins de 300 mètres, Plus… | ❌ Aucun champ |
| 55 | Caserne de pompiers — distance | L | Liste en tranches (à moins de 5 km…) | 🟡 `biens_batiments.distance_caserne_km` — nombre libre au lieu de tranches |
| 56 | Gicleurs — entièrement couvert par un système de gicleurs | L | Oui/Non | 🟡 `biens_batiments.gicleurs` (booléen ; ni % de couverture ni « partiel ») |
| 57 | Extincteurs (catégorie, type d'agent, % couvert) | L | Texte/% | ❌ Aucun champ |
| 58 | Système d'alarme incendie (Alarme locale, Poste de surveillance — service complet, Alarme reliée à une centrale…) | L | Liste | ❌ Aucun champ |
| 59 | Prise d'eau et tuyau d'incendie / colonne montante | L | Oui/Non | ❌ Aucun champ |

### 1.11 Voisinage — risques encourus autour de l'emplacement

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 60 | **Risque à gauche** (distance en mètres + affectation voisine) | L | Nombre + texte | ❌ Aucun champ — **manque signalé par Patrick** |
| 61 | **Risque à droite** (distance + affectation) | L | Nombre + texte | ❌ Aucun champ — idem |
| 62 | **Risque en arrière** (distance + affectation) | L | Nombre + texte | ❌ Aucun champ — idem |
| 63 | Risque en face (distance + affectation) | L | Nombre + texte | ❌ Aucun champ |
| — | Mention « Aucun risque aux alentours » | L | Déclaration | ❌ (alternative aux 4 champs ci-dessus) |

### 1.12 Alarme, vol et protections physiques

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 64 | Système d'alarme antivol (présence + type : alarme locale, poste de surveillance…) | L | Oui/Non + liste | ❌ Aucun champ alarme dans toute l'app |
| 65 | Compagnie d'alarme (nom, téléphone, courriel, personne-contact) | L | Texte | ❌ Aucun champ |
| 66 | Transmissions primaire et secondaire (Cellulaire ; Canal local dérivé (Pulsenet) ; Communicateur numérique DACT/POTS — avec coupure de ligne ou saisie de ligne ; GSM/GPRS/CDMA ou Internet (IP) ; Radio unidirectionnelle/bidirectionnelle ; Autre) + fabricant + n° de modèle | L | Multi-choix ×2 + texte | ❌ Aucun champ |
| 67 | Sécurité de ligne + taux d'interrogation de la centrale (polling) | L | Oui/Non + texte | ❌ Aucun champ |
| 68 | Centrale de surveillance (nom et lieu) | L | Texte | ❌ Aucun champ |
| 69 | Couverture de la détection de mouvements (tout le local ; coffres/chambre forte ; panneau de contrôle ; dessus du plafond suspendu ; zones de stock hors coffre) | L | Multi-choix | ❌ Aucun champ |
| 70 | Protection des coffres-forts (Contact de porte ; Détecteur de vibration (EVD) ; Capacitif/proximité ; Sismique ; Autre) | L | Multi-choix | ❌ Aucun champ |
| 71 | Répondants aux alarmes (Abonné ; Service de garde — nom ; Police) + réponse en personne | L | Multi-choix + Oui/Non | ❌ Aucun champ |
| 72 | Signaux d'ouverture/fermeture (Surveillés, Supervisés, Aucun) | L | Liste | ❌ Aucun champ |
| 73 | Contrat annuel d'entretien du système d'alarme | L | Oui/Non | ❌ Aucun champ |
| 74 | Certificat ULC de l'alarme (actif, n° de certificat, date d'expiration) | L | Oui/Non + texte + date | ❌ Aucun champ |
| 75 | Vidéosurveillance (présence ; couvre tout sauf les toilettes ; enregistre 24 h/24 ; sauvegardes hors site ; caméras extérieures) | L | Oui/Non ×5 | ❌ Aucun champ |
| 76 | Protections physiques (liste à cocher : serrures à pêne dormant à double cylindre, double surveillance d'alarme, garde armé de jour, alarme anti-hold-up, barres aux fenêtres, étiquettes RFID/suivi électronique, pellicule/vitrage antieffraction, bornes anticollision, sas de sécurité, rideaux/portes d'acier, sonnette de porte verrouillée, bâtiment sécurisé, pêne dormant, fenêtres grillagées/armature métallique, glaces incassables, autre) | L | Multi-choix | ❌ Aucun champ |
| 77 | Coffre-fort (type, catégorie ; détail possible : fabricant, modèle, cote feu/cambriolage, poids < 500 lb, boulonné au sol, situé dans une chambre forte) | L | Texte/liste | ❌ Aucun champ |

### 1.13 Garanties — biens et contenu (par emplacement)

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 78 | Garantie bâtiment (formule, franchise, montant de garantie) | L | Formule + montants | 🟡 `biens_garanties` (formule `tous_risques`/`risques_designes`, franchise, montant, par bâtiment) ; l'envoi réel parle de « formule étendue » |
| 79 | Règle proportionnelle / coassurance (%) des garanties biens | L | % (80, 90, 100…) | ❌ Aucun champ — pourtant présente sur chaque ligne de l'envoi réel |
| 80 | Contenu — matériel et marchandises (catégories et montants) | L | Répétable | 🟡 `biens_contenus` (description, type : mobilier/équipements/stock/améliorations/autre, valeur ; rattaché au bâtiment) |
| 81 | Franchise et règle proportionnelle propres au contenu | L | Montant + % | ❌ `biens_garanties` est unique par bâtiment — pas de franchise distincte contenu |
| 82 | Avenant « valeur à neuf » | L | Oui/Non | 🟡 JSON `biens_garanties.avenants` extensible, mais clé non normalisée (les 5 avenants documentés sont tremblement de terre, inondation, refoulement, bris de machines, perte d'exploitation liée) |
| 83 | Avenant refoulement d'égout (franchise propre, montant) | L | Oui/Non + montants | 🟡 Clé JSON présente, sans franchise ni montant propres |
| 84 | Garantie des inondations (franchise, montant) | L | Oui/Non + montants | 🟡 Idem #83 |
| 85 | Avenant tremblement de terre (franchise proportionnelle %, franchise minimale $, montant) | L | Oui/Non + montants | 🟡 Idem ; les sous-franchises (%, minimum) sont absentes |
| 86 | Frais communautaires — copropriété (franchise, montant) | L | Montants | ❌ Aucune ligne de garantie correspondante |
| 87 | Extension — biens temporairement hors des lieux assurés (montant) | L | Montant | ❌ Aucun champ |
| 88 | Améliorations locatives (montant) | L | Montant | 🟡 `biens_contenus` type « ameliorations » avec valeur |
| 89 | Stock — limite supplémentaire en période de pointe (montant + dates du/au) | L | Montant + dates | ❌ Aucun champ |
| 90 | Argent et valeurs — sur les lieux et hors des lieux (montant, franchise) | L | Montants | ❌ Aucun champ |
| 91 | Biens en transit et chez des tiers (montants par mode de transport ou gardien) | L | Montants | ❌ Aucun champ |
| 92 | Assurance flottante des outils (liste d'articles : description, base de règlement, assuré additionnel, montant ; biens appartenant à autrui inclus ; engagement de verrouillage des véhicules) | S/L | Répétable + montants | ❌ Aucun champ (les envois réels l'ont en annexe) |

### 1.14 Bris d'équipement

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 93 | Bris d'équipement (montant de garantie par accident par emplacement, réparations ou remplacement inclus, limitations de la garantie en texte) | L | Montant + texte | 🟡 Simple clé d'avenant `bris_machines` dans `biens_garanties.avenants` — sans montant par accident ni limitations |

### 1.15 Perte d'exploitation (et pertes de loyers / bénéfices)

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 94 | Formule PE (Pertes de loyers restreinte, Bénéfices/Bénéfice brut, formule étendue…) | S/L | Liste | 🟡 `pe_garanties.base_montant` (benefice_brut/marge_brute/chiffre_affaires) ; « pertes de loyers » non distinguée |
| 95 | Montant PE par emplacement | L | Montant | 🟡 `pe_garanties.limite` au niveau de la soumission seulement ; `pe_etablissements` n'a pas de montant PE |
| 96 | Période d'indemnisation maximale (mois) | S | Nombre (12, 18, 24) | ✅ `pe_garanties.periode_indemnite_mois` |
| 97 | Règle proportionnelle PE (%) | S | % | ❌ Aucun champ |
| 98 | Honoraires de comptables (montant) | L | Montant | ❌ Aucun champ |
| 99 | Délai de carence / franchise PE (jours) | S | Nombre de jours | ✅ `pe_garanties.franchise_jours` |

### 1.16 Responsabilité civile

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 100 | RC générale — montant de garantie par sinistre | S/L | Montant | ✅ `rc_garanties.limite_par_sinistre` |
| 101 | RC produits et travaux terminés (incluse ; montant par période d'assurance) | S/L | Oui/Non + montant | 🟡 `rc_garanties.formule` (produits_completes) + `limite_agregat` ; pas de limite distincte « produits » |
| 102 | Préjudice personnel et imputable à la publicité (montant) | S | Montant | ❌ Aucun champ dédié |
| 103 | Frais médicaux (plafond par personne ; plafond par sinistre) | S | Montants | ❌ Aucun champ |
| 104 | Responsabilité locative (montant par lieu assuré) | L | Montant | ❌ Aucun champ |
| 105 | Avenant de franchise pour dommages matériels (montant par sinistre) | S | Montant | 🟡 `rc_garanties.franchise` globale par exploitation seulement |
| 106 | RC des administrateurs et dirigeants — volet copropriété (montant, frais de défense inclus, montant de rétention, date de rétroactivité) | S | Montants + date | ❌ Absent du combiné ; le produit D&O séparé (`do_*`) existe mais n'est lié à aucun dossier combiné |
| 107 | RC automobile des non-propriétaires (montant) | S | Montant | ❌ Aucun champ |
| 108 | RC imputable à la pollution (montant) | S | Montant | 🟡 Clé d'avenant `pollution` prévue dans `rc_garanties.avenants` (JSON), sans montant propre |
| 109 | RC complémentaire / parapluie (montant, rétention autoassurée, liste des polices de base) | S | Montants + liste | 🟡 Clé d'avenant `parapluie` en JSON ; ni rétention ni polices de base |

### 1.17 Antécédents et police antérieure

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 110 | Un assureur a-t-il résilié, refusé ou non renouvelé une assurance au proposant (5 dernières années ; oui/non + explication) | E/S | Oui/Non + texte | ❌ Aucun champ dédié dans `biens/rc/pe_antecedents` — question pourtant en tête du sommaire de chaque envoi réel (le formulaire JM la pose sur 3 ans) |
| 111 | Assureur précédent / actuel (nom) | S | Texte | ✅ `*_antecedents.assureur_actuel` |
| 112 | Type de la police précédente (Police multirisques…) | S | Texte/liste | ❌ Aucun champ |
| 113 | Numéro de la police actuelle | S | Texte | ✅ `*_antecedents.numero_police_actuelle` |
| 114 | Période de la police précédente (du – au) | S | Dates | 🟡 `*_antecedents.date_expiration_actuelle` seulement (pas de date de début) |
| 115 | Prime de la police précédente | S | Montant | ❌ Aucun champ |
| 116 | Sinistres des 5 dernières années (date, type de sinistre, montant payé, réserve, statut, description) | S | Répétable | 🟡 `*_antecedents.sinistres_5ans` JSON limité à {date, type, montant} — réserve, statut et description absents |
| 117 | Faillite, jugement, privilège, saisie ou reprise de possession (5 ans ; oui/non + explication) | E | Oui/Non + texte | ❌ Aucun champ |
| 118 | Condamnation pour fraude, corruption, incendie criminel ou crime lié à l'honnêteté (oui/non + explication) | E | Oui/Non + texte | ❌ Aucun champ |
| 119 | Consentements (vérification de crédit, dossier d'assurance/sinistres) | S | Oui/Non + date | ✅ `*_antecedents.consentements` (JSON) |

### 1.18 Stocks et biens de tiers (bloc sectoriel des formulaires JM)

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 120 | Tenue des stocks (inventaire physique complet documenté au moins annuel : oui/non, date du dernier, total des biens possédés $, source physique/perpétuel ; registres conservés ; composition du stock par catégories en % ; valeur maximale du stock sur 12 mois ; biens de tiers en garde — moyenne quotidienne clients et consignation ; biens pris en gage) | E/L | Oui/Non, dates, montants, % | ❌ Aucun équivalent — bloc spécifique au secteur bijouterie des formulaires JM ; noté pour mémoire, reprise générique non requise pour le combiné général |

### 1.19 Bénéficiaires et assurés additionnels

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 121 | Bénéficiaires par emplacement (nom, adresse, qualité — créancier hypothécaire, bénéficiaire de perte « loss payee » — clause de préavis de résiliation) | L | Répétable | ❌ Aucun concept côté biens ; `creancier_nom`/`creancier_courriel` n'existent qu'en FPQ1 (auto) |
| 122 | Assurés additionnels (nom, adresse postale, qualité : bailleur ou gérant des lieux, propriétaire du bâtiment, franchiseur, co-propriétaire des lieux, locateur d'équipement loué, personne/organisation désignée, autre) | S/L | Répétable | ❌ Aucun champ |

### 1.20 Remarques et signature

| # | Champ | Portée | Type / choix | Statut app actuelle |
|---|-------|--------|--------------|---------------------|
| 123 | Remarques structurées de l'envoi (remarques diverses, circonstances spéciales, commentaires du courtier, remarques relatives à la RC) | S | Textes libres ×4 rubriques | 🟡 Un seul champ `notes` par soumission produit ; les 4 rubriques de l'envoi réel n'existent pas |
| 124 | Signature du proposant (signature, nom et titre en lettres moulées, date) + déclaration de véracité et avertissement de fraude | S | Signature + date | ❌ Aucun champ de signature/déclaration dans les propositions actuelles |

### Comptes de la cartographie

- **Total des champs de référence inventoriés : 124**
- ✅ **Existe : 14** (11 %)
- 🟡 **Partiel : 32** (26 %)
- ❌ **Manquant : 78** (63 %)

Lecture honnête : l'app couvre bien les montants de base (bâtiment, contenu, RC par sinistre, période PE, assureur actuel) et la mécanique (versions, propositions par produit), mais **la fiche descriptive du risque** — celle qui occupe la moitié de chaque envoi réel — est à construire : construction détaillée, rénovations, voisinage, protections, fiche entreprise, garanties structurées par ligne, antécédents complets, bénéficiaires. Les quatre manques nommés par Patrick (matériaux détaillés #38–42, rénovations #48–51, voisinage #60–63, année de fondation #14) sont tous confirmés ❌/🟡 dans le code actuel.

### Les 10 manques les plus importants pour une vraie proposition

1. **Construction détaillée par composant** (#38–42 + #37) : murs, structure de toit, finition de toit, planchers, sous-sol — présents dans 5/5 envois, absents de l'app ; la classe actuelle (bois/acier/béton) ne correspond pas aux classes assureurs (résistance au feu).
2. **Rénovations par système, année + ampleur** (#48–51) : toiture, électricité, plomberie, chauffage — l'app n'a que l'année de toiture.
3. **Voisinage structuré** (#60–63) : gauche/droite/arrière/en face, distance + affectation.
4. **Fiche entreprise complète** (#11, #14, #15, #17, #18, #20–22, #24) : forme juridique, année de fondation, répartitions de recettes, employés plein/partiel, CSST, alcool.
5. **Bloc protection incendie et risques criminels** (#54, #57–59, #64, #76, #77) : prise d'eau, extincteurs, alarme incendie, colonne montante, alarme antivol, protections physiques, coffre-fort.
6. **Questionnaire alarme technique** (#65–75) : compagnie d'alarme, transmissions, ULC, centrale, répondants, entretien, caméras — exigé par les assureurs dès qu'il y a du vol/contenu significatif.
7. **Garanties structurées comme l'envoi réel** (#79, #81, #83–85, #93) : règle proportionnelle sur chaque ligne ; franchise ET montant propres à chaque avenant (inondation, refoulement, tremblement de terre avec sous-franchises) ; bris d'équipement avec montant par accident et limitations.
8. **Lignes de garantie entièrement absentes** (#86, #87, #89–92, #97, #98, #102–104, #107) : frais communautaires (copropriété), extension hors lieux, pointe saisonnière, argent et valeurs, transit, flottante des outils, honoraires de comptables, PE « pertes de loyers », RC préjudice personnel, frais médicaux, responsabilité locative, RC auto non-propriétaires.
9. **Antécédents complets** (#110, #112, #115–118) : question refus/résiliation/non-renouvellement en champ dédié, police précédente (type, période complète, prime), sinistres détaillés (réserve, statut, description), questions faillite et fraude des formulaires assureurs.
10. **Bénéficiaires/créanciers par emplacement et assurés additionnels** (#121, #122) : présents dans les envois réels (avec clause de préavis), absents partout dans l'app sauf FPQ1.

---

## 2. Constats — les 5 soumissions remplies

Les 5 envois réels partagent **exactement le même gabarit** (sortie du système de gestion actuel du cabinet), ce qui en fait la vraie spécification du format « Soumission combinée » :

**Structure constante de l'envoi (dans l'ordre)** : (1) lettre « Demande de prix » datée, avec expéditeur et objet ; (2) page de présentation « Document préparé pour / Par / Soumis par » ; (3) **Renseignements généraux** (bloc courtage, candidat à l'assurance, adresse postale, durée de la garantie proposée, entité légale, code de l'industrie, description des activités, renseignements relatifs à la responsabilité civile, remarques) ; (4) **Sommaire de la police antérieure ainsi que des réclamations** ; (5) **Garanties** — un seul tableau consolidé (Biens, Bris d'équipement, Perte d'exploitation/loyers/bénéfices, Vol, Responsabilité) avec colonnes Franchise / Règle proportionnelle / Montant de garantie / Taux / Prime ; (6) **une page par emplacement** (adresse, inspection, évaluation, bâtiment, construction, mécanique, rénovations, protection incendie, risques criminels, affectation de l'assuré, risques encourus/voisinage, code de l'industrie) ; (7) **Emplacements et bénéficiaires** ; (8) annexes conditionnelles (liste de la flottante des outils, détail de la RC complémentaire) seulement quand la garantie s'applique.

**Systématiquement rempli** :
- Le bloc « Renseignements relatifs à la responsabilité civile » : « En affaire depuis », CSST, pourcentages géographiques (Canada/États-Unis/étranger), alcool — c'est le cœur de tarification RC et il apparaît même pour une pure copropriété.
- La fiche emplacement descriptive : année, superficie, étages, **les 4 matériaux de construction et les 4 items de mécanique sont remplis dans 5/5 envois** — c'est la partie la plus complète des envois, et précisément celle qui manque dans l'app.
- Protection incendie : prise d'eau et caserne remplis dans 5/5 (en tranches : « à moins de 150 mètres », « à moins de 5 kilomètres »).
- Le tableau des garanties : franchises et montants toujours présents ; **les colonnes Taux et Prime sont toujours vides** — c'est une *demande de prix*, l'assureur les remplit.
- La question refus/résiliation/non-renouvellement (5 ans) ouvre toujours le sommaire ; la réponse est tantôt explicite, tantôt laissée à l'en-tête.

**Systématiquement vide ou quasi vide** :
- Le **numéro de la police précédente** : vide dans 5/5 envois (l'assureur précédent et la prime le sont, eux, 3 fois sur 5).
- Les **extincteurs** (catégorie, agent, % couvert) : vides dans 5/5 — champ présent au gabarit mais jamais alimenté ; à garder, mais en saisie facultative.
- Le **coffre-fort** (type, catégorie) : vide dans 5/5 ; les champs criminels remplis sont l'alarme et le pêne dormant.
- **Masse salariale, % de sous-traitants, expérience antérieure liée** : presque toujours vides ; les recettes brutes, elles, sont remplies 3 fois sur 5.
- **Inspection** : « Cet emplacement n'a pas été inspecté » dans 5/5 ; **évaluation** : présente 2 fois sur 5 (avec date et coût de remplacement) — donc champs à prévoir, à défaut « non inspecté/non évalué » explicites plutôt qu'absents.
- **Voisinage** : « à gauche » est le plus souvent rempli ; droite/arrière/en face restent fréquemment vides, ou mention globale « Aucun risque aux alentours » — le besoin est réel mais la saisie doit rester rapide (4 paires distance/affectation + case globale).
- Rénovations : quand elles existent, elles sont toujours données **par système avec l'ampleur** (« Toiture : 2011 Complète » ; un envoi donne les 4 systèmes à la même année) ; sinon « Aucune rénovation connue ».

**Adaptations par type de risque observées** :
- **Copropriétés** (2 envois) : description de l'entité légale, questions propres (nombre d'unités, fonds de prévoyance et fonds d'auto-assurance et carnet d'entretien en remarques, unité de référence), garanties spécifiques (**frais communautaires**, RC des administrateurs et dirigeants avec rétention et date de rétroactivité), bénéficiaires rares.
- **Entrepreneur** (1 envoi) : long jeu de « Questions additionnelles » métier (démolition oui/non, amiante, travaux structurels, pourcentages de travaux par type et par secteur résidentiel/commercial/industriel/institutionnel, sous-traitance), flottante des outils en annexe avec liste d'articles, RC pollution et RC complémentaire (umbrella) avec rétention et page « polices de base », bénéficiaire = propriétaire/bailleur avec clause de préavis de résiliation.
- **Hébergement** (1 envoi) : remarques et circonstances spéciales très développées (présentation du risque rédigée) — les rubriques de texte libre portent une vraie charge de souscription quand le risque est atypique ou non renouvelé.

**Format de sortie** : document unique paginé (en-têtes « Assurance des Entreprises — Soumission — <section> » répétés, pied de page daté), en français, adressé aux assureurs comme demande de prix. Aucun des 5 envois n'est produit par les formulaires assureurs (JM/AOL-COL/alarme) : ceux-ci servent de **questionnaires d'appoint** (nouvel emplacement, alarme) pendant que le format combiné du cabinet reste le véhicule principal.

---

## 3. Plan de construction proposé (à valider — rien n'est construit)

### 3.1 Champs à ajouter, par table

**`clients` (entreprise)** — nouvelles colonnes :
- `forme_juridique` TEXT (liste CHECK : societe_actions, proprietaire_unique, srl, fiducie, snc, coentreprise, association, autre)
- `annee_fondation` INTEGER (le « En affaire depuis »)
- `annees_experience_liee` INTEGER
- `noms_exploitation` TEXT (noms commerciaux et filiales à assurer)
- `description_activites` TEXT (riche ; `secteur_activite` reste le libellé court)
- `code_industrie` TEXT + `code_industrie_description` TEXT + `code_industrie_pct_revenus` REAL
- `repartition_revenus_types` TEXT (JSON {% par type d'activité}) ; `repartition_revenus_geo` TEXT (JSON {canada, etats_unis, etranger, internet})
- `nb_employes_temps_plein` INTEGER, `nb_employes_temps_partiel` INTEGER (garder `nb_employes` comme total calculé ou le migrer)
- `employes_csst` INTEGER (0/1), `responsabilite_alcool` INTEGER (0/1), `pct_sous_traitance` REAL
- Nouvelle table **`client_questions_sectorielles`** (client_id, code_question, question, reponse) — mécanisme générique pour les jeux de questions par code d'industrie, alimenté par un catalogue de questions codé en dur au départ (copropriété, entrepreneur/restauration après sinistre).

**`biens_batiments` (emplacement)** — nouvelles colonnes :
- Adresse : `province` TEXT, `etage` TEXT, `bureau` TEXT
- Affectation : `type_emplacement` TEXT (liste), `type_batiment` TEXT (liste), `interet_assure` TEXT (liste), `superficie_occupee_pi2` REAL, `pct_vacant` REAL, `partage_lieux` INTEGER + `autres_occupants` TEXT, `etages_occupes` TEXT
- Construction : conserver `type_construction` mais **remapper ses valeurs sur les classes assureurs** (frame/bois, maconnerie_solives, incombustible, maconnerie_incombustible, resistant_feu_modifie, resistant_feu — migration de données à prévoir) ; ajouter `construction_mur`, `construction_toit_structure`, `finition_toit`, `materiau_sol`, `sous_sol` (TEXT avec listes suggérées en UI, saisie libre tolérée comme dans les envois réels)
- Mécanique : `electricite_type` TEXT, `carburant` TEXT, `plomberie_materiau` TEXT ; `chauffage` devient liste + texte
- Rénovations : `renovation_electricite_annee`/`_ampleur`, `renovation_plomberie_annee`/`_ampleur`, `renovation_chauffage_annee`/`_ampleur` ; `annee_toiture` conservée + `renovation_toiture_ampleur`
- Inspection/évaluation : `inspection_statut` TEXT + `inspection_date` + `inspection_notes` ; `evaluation_date`, `evaluation_par`, `evaluation_cout_remplacement` REAL, `evaluation_details_joints` INTEGER
- Protection incendie : `prise_eau_distance` TEXT (liste en tranches), `extincteurs_categorie`, `extincteurs_agent`, `extincteurs_pct_couvert`, `alarme_incendie_type` TEXT (liste), `colonne_montante` INTEGER ; `gicleurs` enrichi en `gicleurs_couverture` TEXT (non/partiel/entier)
- Voisinage : `voisin_gauche_distance_m`/`_affectation`, `voisin_droite_*`, `voisin_arriere_*`, `voisin_enface_*` (8 colonnes simples plutôt qu'une table fille : un seul emplacement, 4 directions fixes — correspond exactement au gabarit)
- Risques criminels (base) : `alarme_vol_type` TEXT, `pene_dormant` INTEGER, `fenetres_grillagees` INTEGER, `glaces_incassables` INTEGER, `coffre_type` TEXT, `coffre_categorie` TEXT, `autres_protections_criminelles` TEXT, `cameras` INTEGER

**Nouvelle table `biens_protections_alarme`** (1 par bâtiment, alimentée par le questionnaire alarme) :
- `compagnie_alarme`, `compagnie_telephone`, `compagnie_courriel`, `compagnie_contact`
- `transmission_primaire` (JSON multi-choix), `transmission_primaire_fabricant`, `transmission_primaire_modele`, `transmission_secondaire` (JSON), `transmission_secondaire_fabricant`, `transmission_secondaire_modele`
- `securite_ligne` INTEGER, `taux_interrogation` TEXT, `centrale_nom_lieu` TEXT
- `couverture_detection` TEXT (JSON), `dispositifs_perimetre` TEXT, `protection_coffres` TEXT (JSON)
- `repondants` TEXT (JSON), `reponse_en_personne` INTEGER, `signaux_ouverture_fermeture` TEXT
- `contrat_entretien_annuel` INTEGER, `certificat_ulc_actif` INTEGER, `certificat_ulc_numero` TEXT, `certificat_ulc_expiration` TEXT
- `cameras_detail` TEXT (JSON des 5 réponses), `protections_physiques` TEXT (JSON de la liste à cocher), `coffre_detail` TEXT (JSON : fabricant, modèle, cote, poids, boulonné, chambre forte)

**`biens_garanties` et lignes de garantie** :
- Ajouter `regle_proportionnelle` REAL (%) à `biens_garanties`
- Passer les avenants d'un JSON booléen à un **JSON enrichi** `{code: {present, franchise, montant}}` (moins invasif qu'une table fille ; la proposition et l'analyse savent déjà lire le JSON) — couvre valeur à neuf, refoulement, inondation, tremblement de terre (+ `franchise_pct` et `franchise_min` pour ce dernier)
- Franchise/montant contenu : ajouter `franchise_contenu` et `regle_proportionnelle_contenu` à `biens_garanties`, ou une ligne de garantie « contenu » générée depuis `biens_contenus`
- Bris d'équipement : clés d'avenant enrichies `bris_equipement: {montant_par_accident, limitations}`
- Nouvelles lignes (clés d'avenants normalisées) : `frais_communautaires`, `extension_hors_lieux`, `pointe_saisonniere` (avec dates), `argent_valeurs`, `transit_tiers`
- Nouvelle table **`biens_flottante_articles`** (soumission_id, batiment_id nullable, description, base_reglement, assure_additionnel, montant) pour la flottante des outils et ses annexes

**`rc_garanties`** — nouvelles colonnes : `prejudice_personnel_publicite` REAL, `frais_medicaux_par_personne` REAL, `frais_medicaux_par_sinistre` REAL, `responsabilite_locative` REAL, `rc_auto_non_proprietaires` REAL, `umbrella_montant` REAL, `umbrella_retention` REAL, `umbrella_polices_base` TEXT (JSON), `produits_travaux_termines_montant` REAL ; la pollution garde sa clé d'avenant mais gagne un montant (`rc_garanties.pollution_montant` ou JSON enrichi comme en biens)

**`pe_garanties` / `pe_etablissements`** : ajouter `regle_proportionnelle` REAL et `honoraires_comptables` REAL à `pe_garanties` ; ajouter `formule` TEXT (loyers/benefices/benefice_brut) ; montant par emplacement : ajouter `montant_pe` REAL à `pe_etablissements` (la limite de soumission reste le total/plafond)

**`*_antecedents` (biens, rc, pe — patron commun)** : `refus_resiliation_nonrenouvellement` INTEGER + `refus_explication` TEXT, `type_police_precedente` TEXT, `date_effet_precedente` TEXT, `prime_precedente` REAL, `faillite_jugement` INTEGER + `faillite_explication` TEXT, `condamnation_honnetete` INTEGER + `condamnation_explication` TEXT ; enrichir le JSON `sinistres_5ans` : {date, type, montant_paye, reserve, statut, description}

**Bénéficiaires et assurés additionnels** — nouvelle table **`emplacement_beneficiaires`** (cabinet_id, batiment_id, nom, adresse, ville, code_postal, qualite, clause_preavis TEXT) et table **`soumission_assures_additionnels`** rattachée au dossier combiné (nom, adresse, qualite)

**`cabinets`** : `adresse`, `ville`, `code_postal`, `telephone`, `telecopieur`, `site_web`, `courriel` — pour l'en-tête d'envoi des propositions

### 3.2 Design du format « Soumission combinée »

**Principe : un dossier qui lie, pas une fusion.** Les tables par produit (biens_*, rc_*, pe_*) restent la source de vérité — toute la mécanique existante (versions figées, exports, analyse de documents, conversion en police) continue de fonctionner.

- Nouvelle table **`combine_dossiers`** : cabinet_id, client_id, statut (brouillon/soumise/convertie), date_effet, date_echeance, plan_paiement, code_courtier_assureur, courtier_placement_id, signataire_nom, signataire_titre, date_signature, remarques_diverses, circonstances_speciales, commentaires_courtier, cree_par — + **`combine_liens`** (dossier_id, produit, soumission_id) reliant **une** soumission biens + **une** soumission RC + **une** soumission PE (et, en option, une soumission D&O pour les copropriétés), toutes du même client (contrôle serveur : même client_id partout).
- **L'emplacement devient la pièce commune** : `biens_batiments` est la fiche emplacement maîtresse (c'est déjà là que vivent adresse et construction) ; ajouter `batiment_id` (nullable) à `pe_etablissements` et `rc_exploitations` pour rattacher chaque établissement/exploitation RC et PE au même emplacement physique au lieu de retaper adresse et construction trois fois. Le questionnaire combiné ne demande l'emplacement qu'une fois.
- **Questionnaire combiné** = un parcours unique en étapes (Entreprise → Emplacements et bâtiments → Garanties biens/contenu → RC → Perte d'exploitation → Antécédents communs → Bénéficiaires et assurés additionnels → Révision), qui écrit dans les tables produits existantes via leurs modules `lib/biens.js`, `lib/rc.js`, `lib/pe.js` (création automatique des 3 soumissions liées à l'ouverture du dossier). Les questionnaires par produit restent accessibles tels quels.
- **Antécédents saisis une fois** : le dossier combiné porte un bloc antécédents unique, synchronisé vers les 3 tables `*_antecedents` à l'enregistrement (elles restent la source pour les propositions par produit et la conversion en police).
- **Proposition combinée** : nouveau générateur HTML + PDF (`lib/proposition-combinee.js` / `-pdf.js`) calqué sur le gabarit réel observé : lettre de demande de prix, page de présentation, renseignements généraux, sommaire police antérieure et réclamations, **tableau des garanties consolidé** (Franchise / Règle proportionnelle / Montant / Taux / Prime — taux et prime laissés vides, comme l'envoi réel), une page par emplacement, bénéficiaires, annexes conditionnelles (flottante, umbrella). Les propositions par produit ne changent pas.
- **Conversion en police** : à la conversion du dossier, les `polices` créées référencent déjà chaque soumission par produit (`biens_soumission_id`, `rc_soumission_id`, …) — ajouter `combine_dossier_id` à `polices` pour garder le lien du tout.
- **Analyse de documents alignée** : chaque nouvelle colonne entre au dictionnaire dès sa création (règle du projet) — l'extraction IA reconnaîtra alors matériaux, rénovations et voisinage dans les vraies polices ; `lib/manques.js` ajoute les champs critiques du combiné (classe de construction, rénovations, voisinage, bénéficiaires) pour que la boucle « Demander au client » les réclame.
- **Dictionnaire et listes** : les listes de choix du présent inventaire deviennent les listes des formulaires (déroulantes), avec saisie libre tolérée là où les envois réels montrent des valeurs hors liste (matériaux, chauffage).

### 3.3 Ordre de construction suggéré (chaque étape suit la recette du projet : modèle → questionnaire → fiche → dictionnaire → exports → proposition → commandes IA → voix → balayage complet → captures → ZIP)

1. **En-tête et entreprise** : colonnes `cabinets` (en-tête d'envoi), colonnes `clients` (forme juridique, fondation, répartitions, employés, CSST, alcool…) + fiche client et ouverture vocale alignées.
2. **Emplacement enrichi (biens)** : construction détaillée, mécanique, rénovations ×4, inspection/évaluation, protection incendie, voisinage, affectation — questionnaire et fiche bâtiment ; migration des valeurs de `type_construction`.
3. **Bloc alarme et protections** : table `biens_protections_alarme` + questionnaire alarme intégré à la fiche emplacement.
4. **Garanties structurées** : règle proportionnelle, avenants à franchise/montant (JSON enrichi), bris d'équipement détaillé, nouvelles lignes (frais communautaires, hors lieux, pointe, argent/valeurs, transit), flottante des outils + articles.
5. **RC et PE complétées** : colonnes RC détaillées (préjudice personnel, frais médicaux, responsabilité locative, auto non-propriétaires, umbrella) ; PE par emplacement, formule loyers, honoraires de comptables, règle proportionnelle.
6. **Antécédents communs enrichis** : les 3 tables `*_antecedents` (refus, faillite, fraude, police précédente complète, sinistres détaillés) + questions sectorielles (table + 2 jeux initiaux : copropriété, entrepreneur).
7. **Bénéficiaires et assurés additionnels** : tables + saisie depuis la fiche emplacement et le dossier.
8. **Dossier combiné** : tables `combine_dossiers`/`combine_liens`, rattachement des emplacements (`batiment_id` dans pe/rc), parcours questionnaire unique, synchronisation des antécédents.
9. **Proposition combinée** : générateur HTML/PDF au gabarit réel + envoi « demande de prix » (brouillon courriel, envoi au clic seulement, comme l'existant).
10. **Alignement IA et finalisation** : analyse de documents et `manques.js` sur les nouveaux champs, commandes IA du combiné, balayage complet, captures, ZIP.

### 3.4 Ce que ce plan ne couvre pas (limites honnêtes)

- **Les formulaires JM/AOL-COL/alarme sont d'un assureur de niche (bijouterie)** : leur squelette général (partie A, garanties Businessowners, questionnaire alarme) est repris, mais leurs blocs sectoriels (inventaire de bijoux par catégories, coffres-forts détaillés, limites de transit bijouterie, montres de luxe) ne sont pas repris dans le combiné général — le champ #120 est inventorié pour mémoire seulement. Si Patrick développe ce créneau, ce serait un questionnaire sectoriel de plus (mécanisme de l'étape 6).
- **Les « Questions additionnelles » par code d'industrie sont potentiellement des dizaines de jeux** : le plan livre le mécanisme + les 2 jeux observés dans les envois (copropriété, entrepreneur en restauration après sinistre). Chaque nouveau secteur exigera son jeu, à définir avec Patrick à partir de ses envois réels.
- **La fidélité au gabarit de sortie** : le plan reproduit la structure des 5 envois ; la validation définitive exigera de comparer la proposition combinée générée à un envoi réel, champ par champ, avec Patrick — certaines rubriques du gabarit actuel (ex. « Règle proportionnelle » par ligne, annexes) ont des présentations fines que seul cet aller-retour peut confirmer.
- **Formulaires propres à chaque assureur** : le combiné vise la *demande de prix* générique du cabinet (le format que Patrick envoie déjà) ; il ne remplit pas les formulaires propriétaires de chaque assureur — ceux-ci resteraient à produire assureur par assureur si le besoin se confirme.
- **Tarification** : taux et primes restent hors de l'app (colonnes volontairement vides dans les demandes de prix réelles) ; le plan ne touche ni aux taux ni au calcul de primes.
- **Aucun accès au système actuel** n'a été utilisé : l'inventaire repose uniquement sur les 8 PDF fournis. Si le système actuel exporte un gabarit (CSV/Excel) de sa fiche emplacement, il pourrait affiner les listes de choix des étapes 2 à 4.
