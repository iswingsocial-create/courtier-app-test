# RÉFÉRENCE — Formulaires et documents d'assureurs (inventaire + cartographie)

Documents réels fournis par Patrick le 2026-10-21, inventoriés champ par champ et cartographiés contre l'outil courtier (✅ existe / 🟡 partiel / ❌ manquant). Aucun identifiant personnel reproduit : structure, libellés, formats seulement. Le volet FPQ-1/FPQ-4 (Excel remorquage) est dans `REFERENCE-FPQ1-FPQ4.md`.

Légende des totaux : champs comptés = éléments remplissables distincts du document (une ligne de garantie = 1 champ-groupe ; un tableau répété par emplacement compte par emplacement type).

---

## 1. Proposition Biens — Policy Works (nouvelle affaire / ajout, concessionnaire de véhicules usagés, PDF 6 p.)

**137 champs — ✅ 84 · 🟡 35 · ❌ 18**

Sections : en-tête cabinet/courtier · candidat à l'assurance · renseignements généraux enrichis (répartitions des revenus par géographie et par type d'activité, masse salariale, année de fondation, expérience liée) · sommaire police antérieure et réclamations · tableau des garanties (par emplacement : bâtiment, contenu, avenants ; colonnes Franchise / Règle-prop / Montant / Taux / Prime) · fiche emplacement détaillée (construction complète : murs, structure et finition du toit, sol, sous-sol, mécanique, 4 rénovations, 4 voisins avec distance + affectation, protection incendie, protections criminelles, bénéficiaires/créanciers par emplacement) · sinistres détaillés (date, genre, description, montant payé, réserve, statut).

| Bloc | État | Détail |
|---|---|---|
| Fiche client enrichie (répartitions revenus, fondation, masse salariale) | ✅ | `clients` (repartition_revenus_geo/types, masse_salariale, annee_fondation…) |
| Fiche emplacement/bâtiment complète | ✅ | `biens_batiments` (taxonomies, rénovations ×4, voisins ×4, inspection, évaluation) |
| Bénéficiaires/créanciers par emplacement | ✅ | `emplacement_beneficiaires` (nom, adresse, qualité, clause de préavis) |
| Sinistres détaillés | ✅ | combinée : date/genre/description/montant/réserve/statut |
| Franchise / règle-prop / limite **par ligne** du tableau | 🟡 | structuré pour bâtiment + contenu seulement (`biens_garanties`) ; les autres lignes passent en avenants JSON |
| Section **Crime** complète (3D, argent et valeurs, contrefaçons billets et cartes, destruction suite à vol, vol de coffre-fort) | ❌ | aucun champ crime structuré en garanties biens |
| Comptes clients (montant assuré) | ❌ | pas de ligne dédiée |
| Assurance chantier (montant global) | ❌ | pas de champ |
| Perte réelle subie (ALS) comme base PE | ❌ | bases PE : bénéfice brut / marge brute / chiffre d'affaires seulement |
| Recettes alcool / nourriture en $ | ❌ | seul le booléen responsabilité alcool existe |
| Déclaration du courtier (« je connais ce client depuis… », « client nouveau ») | ❌ | absent de la combinée |
| Pays du client, télécopieur du client, civilité des contacts | ❌ | champs absents |

## 2. CFC Technology & Media (can-fr-v21, PDF 11 p., entreprise TI)

**107 champs — ✅ 31 · 🟡 30 · ❌ 46** (répartis Cyber + E&O)

Sections : S1 entreprise (revenus par territoire × 3 exercices en $, filiales structurées, fin d'exercice, masse salariale ventilée intérieur/extérieur × bureau/manuel/dangereux) · S2 activités tech (ventilation des revenus par service en %, hébergement et tier, clientèle par 11 secteurs) · S3 contrats et gestion des risques (3 plus gros projets, contrats écrits, limitation de responsabilité, examen juridique, sous-traitants) · S4 cyber (types d'informations sensibles + nombre d'enregistrements, données précieuses, mesures et responsable, normes de gouvernance) · S5 propriété intellectuelle · S6 renvoi annexe biens · S7 lignes demandées E&O/Cyber/RC (date d'effet, limite, franchise par ligne) · S8 informations supplémentaires · S9 sinistres précédents + signature · Annexe 1 biens par local (montants par catégorie dont matériel informatique et équipement portable, panneaux composites, ~25 questions de sécurité physique O/N, plan de continuité).

| Bloc | État | Détail |
|---|---|---|
| Mesures cyber de base (MFA, EDR, sauvegardes, pare-feu, formation, plan de réponse, chiffrement, correctifs, contrôle d'accès) | ✅ | `cyber_mesures` (type + statut + détails) |
| Garanties et antécédents Cyber et E&O (limites, franchises, incidents, circonstances) | ✅ | `cyber_garanties/antecedents`, `eo_garanties/antecedents` |
| Ventilation des activités par service en % | 🟡 | `eo_activites` et `clients.repartition_revenus_types` existent, mais pas la grille CFC (hébergement, tiers, 11 secteurs clients) |
| Revenus par territoire en $ sur 3 exercices | ❌ | l'outil tient des % géographiques, pas de montants par année |
| Nombre d'enregistrements de données sensibles, par type | ❌ | aucun champ d'exposition données |
| Responsable de la sécurité nommé, normes de gouvernance (ISO, SOC…) | ❌ | absent |
| 3 plus gros projets / contrats, limitation de responsabilité, examen juridique | ❌ | absent d'E&O |
| Propriété intellectuelle (procédures, lettres de cessation, litiges) | ❌ | absent |
| Annexe biens : sécurité physique détaillée (~25 O/N), plan de continuité | 🟡 | le questionnaire alarme de la combinée couvre une partie, pas rattaché à Cyber/E&O |

**Verdict** : pas un produit « tech » autonome — un **questionnaire sectoriel TI** adossé à Cyber + E&O (même patron que les questions sectorielles existantes), plus quelques champs d'exposition structurés au module Cyber.

## 3. Attestation d'assurance commerciale (certificat, 1 p., cabinet émetteur)

**25 champs — ✅ 11 · 🟡 11 · ❌ 3**

**Constat clé** : l'outil ne génère PAS ce certificat. La seule « attestation » existante est la carte rose automobile FPQ1 (par véhicule, `views/polices/attestation.ejs`). Toutes les données sources existent sauf le gabarit et les limites par ligne.

| Champ | État | Détail |
|---|---|---|
| Assuré, adresse, lieux/activités, période, assureur, n° de police | ✅ | `clients`, `biens_batiments`, `polices` |
| Créancier (nom, adresse, qualité, clause de préavis) | ✅ | `emplacement_beneficiaires` |
| Coordonnées du cabinet émetteur | ✅ | `cabinets` |
| Limites et franchises **par ligne de garantie** | 🟡 | `police_protections` ne tient que code/libellé/prime ; les limites vivent dans les soumissions liées |
| Genre d'assurance au code de l'assureur | 🟡 | `polices.ligne` est un code interne, pas le libellé assureur |
| Signataire + titre | 🟡 | existe dans `combine_dossiers`, pas au niveau police |
| Destinataire libre (« À qui de droit » / tiers nommé) | ❌ | aucun champ destinataire de certificat |
| Mentions légales du certificat (3 paragraphes types) | ❌ | aucun texte de mentions |
| Initiales de l'émetteur | ❌ | absent |

**Effort estimé** : faible à moyen — un gabarit d'impression + 3 champs (destinataire, mentions, initiales) + limites/franchises sur `police_protections`.

## 4. MAJ Economical — Produit (questionnaire fabricants/transformateurs, renouvellement, PDF 5 p.)

**70 champs — ✅ 13 · 🟡 15 · ❌ 42**

Blocs ❌ massifs : inventaire des produits actuels et passés · ventes par produit × pays en $ · fabrication hors Canada / filiale étrangère · rappels de produits sur 10 ans · 5 plus gros clients · installation/entretien chez les clients · programme d'assurance qualité, certification ISO 9001, registre des plaintes, programme de rappel · volet alimentaire/allergènes · documentation fournisseurs, étiquetage, registres de lots · biens frigorifiques (système de réfrigération, panneaux d'uréthane, poussières et risque d'explosion, plans d'urgence, équipement spécialisé) · **date de rétroactivité E&O** (❌ notable, absente du module E&O).
✅ : en-tête et identification, emplacements, assureur actuel, refus sur 3 ans, fondation, réclamations 5 ans, limite E&O.

**Verdict** : l'outil peut pré-remplir l'en-tête, les antécédents et les garanties ; le questionnaire manufacturier n'existe pas → **jeu de questions sectorielles « manufacturier »** (patron existant) + date de rétroactivité en E&O. Aucun gabarit de sortie au format d'un assureur n'existe (les propositions générées sont au gabarit du cabinet).

## 5. MAJ Economical — Perte de revenu (feuille de calcul PE, PDF 2 p.)

**29 champs — ✅ 4 · 🟡 11 · ❌ 14**

Le module PE tient le **résultat** (limite, période 12/18/24 mois, base, règle proportionnelle) mais pas la **feuille de calcul** : recettes A1 (année échue) et A2 (12 prochains mois), autres revenus B, dépenses variables D1 à D10 (lignes libres libellé + montant), salaires ordinaires E et G (montant + période 90/120 jours), revenu d'entreprise F calculé. Le chiffre d'affaires et la masse salariale existent au niveau client/établissement, sans série réel/estimé par année.

## 6. Umbrella commerciale — Nexus/Victor (formulaire CUL33E, EN, 5 p., entreprise de logiciels)

**62 champs — ✅ 11 · 🟡 28 · ❌ 23**

L'outil tient l'umbrella comme **3 champs** dans `rc_garanties` (`umbrella_montant`, `umbrella_retention`, `umbrella_polices_base` = JSON de noms) + une annexe d'impression dans la combinée.

❌ principaux : ISN (identifiant US) · ventes / masse salariale / employés **par territoire en montants** (l'outil tient des % géographiques) · tableau croisé véhicules (type × rayon × territoire) · matières dangereuses transportées · produits abandonnés · aéronefs/embarcations · responsabilité contractuelle détaillée · opérations ferroviaires · tableau structuré des polices sous-jacentes (assureur, n°, période, limite par occurrence, agrégat, prime — les données existent dans le portefeuille mais dispersées, d'où les 🟡) · type d'agrégat. Grille des 24 extensions de la CGL de base : 🟡 (~1/3 couverte par `rc_garanties`). Historique de pertes > 10 k$ : ✅ (module réclamations).

**Verdict** : pas un produit autonome — une **section umbrella enrichie** dans RC (le cas Nexus est une PME de services sans biens, où l'umbrella est le produit principal : la section doit donc pouvoir vivre seule dans une soumission RC).

## 7. Police combinée SDC émise — Intact (PDF 131 p., copropriété)

**85 données de déclarations — ✅ 30 · 🟡 33 · ❌ 22**

Structure : feuillets d'assistance (formulaire 003-M-380.1) · Conditions particulières (7 p.) : en-tête (n° de contrat, assureur, assuré collectif « Les propriétaires du… », courtier avec code assureur, type RENOUVELLEMENT, durée, **méthode de facturation « Perception assuré »**, prime totale) · page de résiliation à signer · **par Situation (emplacement)** : tableau des garanties avec colonnes **Formulaire (code assureur) / R.P. % / Franchise $ / Montant de garantie $** — bâtiment et contenu formule étendue (034.0-8), extensions (débordement, Latitude Affaires, franchise eau, **frais communautaires 036.4-2**), tremblement de terre (franchise proportionnelle 10 %), inondation, refoulement, bris des équipements Max (PE incluse + extension frais communautaires), **Crime 1.0 (garanties 1 à 4)**, atteinte à la confidentialité (frais + PE + RC) · section RC commune : garanties A/B/C/D (dont **abus**, responsabilité locative), FPQ nº 6 non-propriétaires, FAQ 6-94/6-96/6-99, **RC des administrateurs d'immeubles en copropriété (036.5-2)** · information de tarification (prime fixe par lieu, nb d'unités) · dispositions supplémentaires (liste de formulaires) · puis les libellés et avenants (le reste des 131 p.).

| Écart | État | Détail |
|---|---|---|
| **Code de formulaire assureur par garantie** (034.0-8, 159.2-2…) | ❌ | `police_protections.code` est le code du catalogue interne ; aucun champ code-formulaire |
| Limite / franchise / règle-prop **par protection au registre** | ❌ | `police_protections` = code + libellé + prime seulement |
| Méthode de facturation (perception assuré / agence) | ❌ | absente des polices |
| Prime par garantie | — | absente de la police elle-même (prime totale seulement) : rien à tenir côté outil |
| Frais communautaires en garantie structurée | 🟡 | tenable en formule PE libre, pas une ligne nommée |
| RC administrateurs de copropriété | 🟡 | ligne D&O possible, pas rattachée au dossier SDC |
| Garantie « abus », FAQ 6-94/6-96 au registre | 🟡 | `rc_garanties` a la RC autos non-propriétaires ; le reste en avenants JSON |
| Extraction IA d'une police combinée | 🟡 | l'analyse détecte **un seul produit** par document ; une police Biens+RC+PE+D&O serait classée sur le produit dominant, les autres volets ne sont pas extraits |

**Écart principal proposition vs police émise** : la proposition combinée de l'outil demande des prix (Taux/Prime vides, pas de codes de formulaires) ; la police émise est un **registre par emplacement et par garantie avec codes de formulaires, R.P., franchises et limites par ligne** — c'est le registre des polices qui doit absorber cette granularité, pas la proposition.

## 8. Certificat de continuation de cautionnement (1 p., bénéficiaire = Régie du bâtiment du Québec)

**11 champs — ✅ 6 · 🟡 2 · ❌ 3**

Champs : cabinet (nom, adresse) ✅ `cabinets` · n° de cautionnement 🟡 (`caut_soumissions.numero_police` = n° de ligne, pas un n° de certificat) · date de début de prolongation ✅ et date de fin ✅ (`polices.date_effet/date_echeance` une fois converti ; les alertes J-90/60/30 des échéances s'appliquent alors) · débiteur principal ✅ (`caut_soumissions.client_id`) · bénéficiaire 🟡 (`caut_obligations.beneficiaire`, texte libre rattaché à une obligation — **aucun catalogue de bénéficiaires types** comme la RBQ, aucun bénéficiaire au niveau certificat) · montant ✅ (`caut_obligations.montant_cautionnement`) · mention « ce certificat ne doit pas être transmis au bénéficiaire » ❌ · mandataire signataire (nom + titre) ❌ · **la notion même de certificat de continuation** ❌ (aucune entité certificat ; le PDF peut être rangé dans `documents`, sans date structurée ni alerte propre).

## 9. Soumission propriétaire foncier — Policy Works (6 p., immeuble commercial multi-locataires)

**100 champs — ✅ 62 · 🟡 28 · ❌ 10**

**Même gabarit constant** que la soumission combinée construite le 2026-10-21 (lettre de demande de prix, page titre, renseignements généraux, sommaire police antérieure/réclamations, tableau des garanties Franchise/Règle-prop/Montant/Taux/Prime, fiche emplacement complète) — le gabarit est **confirmé**, pas une variante.

Propres au propriétaire foncier : **assurance des loyers ou de la valeur locative** (formule étendue, règle-prop 100 %, montant = revenus locatifs annuels) à la place de la PE classique — 🟡 (les bases PE de l'outil ne nomment pas les loyers) · **améliorations locatives** comme ligne biens distincte par emplacement — 🟡 (rattachable au contenu, avec franchise et règle-prop propres qui existent pour le contenu) · occupants tiers listés en remarques (types de commerces locataires) — 🟡 (autres_occupants existe à l'emplacement) · bris d'équipement présent en en-tête de section sans détail — 🟡. Le reste (fiche emplacement, RC et ses 9 extensions, antécédents) est couvert par les champs de la combinée.

## 10. Soumission SDC commercial — Policy Works (6 p., même immeuble que le §9, en transition d'entité)

**102 champs — ✅ 58 · 🟡 30 · ❌ 14**

Même gabarit, mêmes valeurs d'immeuble. Différences propres au syndicat : **« Frais communautaire »** (charges communes de copropriété) comme ligne de type PE, règle-prop 100 %, montant propre — ❌ (aucune ligne nommée ; la police Intact du §7 la porte comme garantie 036.4-2) · ligne biens « Tous les biens » globale plutôt que par composante — 🟡 · **dossier en transition** : le document est préparé pour le syndicat, mais le « candidat à l'assurance » reste l'ancienne entité propriétaire, avec la mention libre « SDC commercial assuré sous [ancienne entité] en transition vers le syndicat » — ❌ (l'outil a les **assurés additionnels** `soumission_assures_additionnels`, mais aucune notion d'entité assurée **en transition** : ancienne entité → nouvelle entité, avec date de bascule) · questions sectorielles copropriété de l'outil (17 : carnet d'entretien, étude et fonds de prévoyance, autogestion/gestionnaire, fraction commerciale, locations court terme…) : ✅ présentes dans l'outil, absentes du formulaire Policy Works (elles vivent dans le questionnaire séparé).

## 11. Police entrepreneur émise — Soplex (renouvellement, 92 p., RC seulement)

**48 données de déclarations — ✅ 20 · 🟡 16 · ❌ 12**

Structure type Soplex : page titre (préparé pour / par l'intermédiaire de Soplex) · Conditions particulières : n° de police (préfixe SOP), **assureur nommé « en vertu du contrat nº [contrat-cadre] » du grossiste**, assuré, adresse, « Emplacements et bénéficiaires : voir liste jointe », société de courtage = Soplex (adresse du grossiste), **Sous-Agent = le cabinet** (avec son adresse de succursale), durée, entité légale, activités · Sommaire d'assurance (prime par grande section : Responsabilité 100 % de la prime, Autre 0 $ ; prime minimum retenue) · Garanties (3 p.) : tableau Nº de formulaire / Garantie / Franchise / Règle-prop / Montant / Taux / Prime — CGL formule par sinistre avec sous-limites (produits et travaux terminés, préjudice personnel, frais médicaux par personne et par sinistre, responsabilité locative par lieu), avenants de franchise (combinée, locative), exclusions nommées (E&O, produits/après travaux, ventes aux États-Unis, pollution, chaleur, malfaçon), FPQ nº 6 et FAQ 6-94/6-96, **engagements entrepreneurs** (les sous-traitants doivent détenir une police d'au moins la limite exigée ; droit de recours maintenu contre fabricants/fournisseurs), **prime minimale retenue 25 %**, puis le bloc de clauses Lloyd's (LMA/LSW/NMA : sanctions, fraude, maladies transmissibles, contrat en coassurance, avis de responsabilité individuelle) et les libellés.

❌ majeurs : **assureur « en vertu d'un contrat-cadre » du grossiste** (voir §14) · codes de formulaires au registre ❌ (même écart que §7) · franchises multiples par avenant (l'outil tient une franchise RC unique) 🟡 · exclusion malfaçon et engagements sous-traitants en données structurées ❌/🟡 (`rc_exploitations.sous_traitants` couvre assurés/non-assurés, pas l'engagement formel) · prime minimale retenue ❌. Les 7 questions sectorielles entrepreneur de l'outil (licence RBQ, cautionnement de licence, types de travaux, sous-traitance, autres provinces, expérience, employés saisonniers) couvrent la **soumission**, pas les données de la police émise.

## 12. Calendrier de prélèvement / d'amortissement du financement de prime (assureur/grossiste, 1 p.)

**12 champs structurels — ✅ 2 · 🟡 3 · ❌ 7**

Contenu : courtier (nom + code courtier) et assuré · n° de cotation du financement · **taux annuel** · **montant financé** · prime brute et acompte initial · **échéancier détaillé** (11 versements mensuels égaux ; par versement : date, n°, solde d'ouverture, paiement, intérêt, capital, intérêts cumulatifs, intérêt différé, solde) · totaux.
Outil : `factures` (montant total, une date d'échéance) + `paiements` (montant, date, mode) permettent de saisir des paiements à la main 🟡 ; **aucune notion de financement de prime** : n° de cotation ❌, taux ❌, montant financé ❌, acompte ❌, échéancier généré ❌, ventilation intérêt/capital ❌, lien échéancier ↔ police/facture ❌. Aucun suivi automatique des prélèvements à venir.

## 13. Avis de l'assureur « à transmettre au client » — MAJ renouvellement entreprise (1 p.)

**6 éléments — ✅ 1 · 🟡 3 · ❌ 2**

Document générique de l'équipe de souscription du grossiste : titre « Message important — Renouvellement », rappel de déclarer tout changement affectant la couverture (affectation commerciale non déclarée, rénovations majeures, coût de reconstruction/valeur des biens, entreposage, risque vacant), invitation à contacter le courtier, coordonnées de l'émetteur.
Outil : le PDF peut être rangé (`documents`, lié client/police) ✅ ; la transmission au client peut passer par les brouillons/courriels 🟡 ; **aucun type « avis assureur à retransmettre »** ❌, **aucun suivi de transmission** (reçu le, transmis le, accusé) ❌.

## 14. Facture interne du cabinet (format KEAL, 1 p.)

**18 champs — ✅ 7 · 🟡 5 · ❌ 6**

Contenu : en-tête du cabinet · **n° de client externe** (compte client du système de gestion) · n° de police · n° de facture externe · date · client (nom, adresse) · **directeur de comptes** (Account Executive) et **représentant** (code interne) · période de la police · **lignes de transaction** (type « Renew policy », date d'effet, compagnie — ici le grossiste —, description par garantie, montant par ligne ; lignes distinctes pour les frais d'administration du cabinet, les frais d'administration de l'assureur et la **taxe sur les primes QC**) · total · instructions de paiement · mention de rémunération (commissions et/ou frais) · coupon détachable de remise.
Outil : `factures` tient un **montant total unique, sans lignes** ❌ (lignes de transaction) ; n° de client externe ❌ ; code du représentant ❌ ; n° de facture au format externe 🟡 (numérotation interne FAC-AAAA-NNNN) ; instructions de paiement et mention de rémunération 🟡 (texte libre) ; coupon détachable ❌ (gabarit).

## 15. Police de grossiste Soplex — renouvellement (161 p.) et SOUSCRIPTION PARTAGÉE

**92 données de déclarations — ✅ 26 · 🟡 30 · ❌ 36** (dont la section participants : 9 lignes, toutes ❌ au modèle actuel)

Structure : page titre · page « En cas de sinistre » (procédure, urgence 24 h) · Conditions particulières (6 p.) : en-tête (n° de police SOP, entrée en vigueur), assuré (société par actions FAS nom d'exploitation), adresse, « Emplacements et bénéficiaires : voir liste des situations et bénéficiaires ci-jointe », société de courtage = Soplex, **Sous-Agent = le cabinet**, durée, entité légale, activités (avec n° d'enregistrement sectoriel type CITQ) · Sommaire d'assurance (prime par section : Biens / Bris d'équipement / Vol / Responsabilité / Autre, toutes « Inclus », prime minimum retenue « Nulle », prime totale) · **section « Souscripteurs — Assureurs Participants »** · Garanties détaillées par section avec Nº de formulaire (codes du grossiste : PA6, PE1, PE8, PE9, PE10, BA4, EBR1, EBP1, EG1F, exclusions PX…), franchises, règles proportionnelles, montants, taux et primes par ligne, sous-groupes de garanties du bris d'équipement et de la PE-bris (groupes 1/2/3, périodes d'attente en heures, distances en km) · liste des situations et bénéficiaires · libellés (le reste des 161 p.).

### La section « Assureurs Participants » (le point de Patrick)

Clause d'ouverture : toute référence à « l'Assureur » vise **individuellement** chacun des assureurs listés ; la part de sinistre de chacun est **plafonnée à sa proportion assurée** (responsabilité **proportionnelle**, non solidaire). Le tableau est **par section de garantie** ; colonnes : assureur participant · **n° du contrat-cadre** en vertu duquel il participe (le contrat de facility du grossiste) · **proportion assurée %** · **montant de prime (sa part)** · prime fixe · représentant autorisé (signature).

Exemple chiffré du document : section Biens = **5 participants** (27,0 % + 23,0 % + 12,5 % + 12,5 % + 25,0 % = **100,0 %** ; parts de prime additionnant la prime de la section), dont un syndicat du Lloyd's de Londres dirigé par un agent de souscription nommé ; les 4 autres sections (Bris, Vol, Responsabilité, Autre) sont à participant unique à 100 %. Total : **9 lignes de participants, 5 assureurs distincts**.

### Cartographie du modèle de police de l'outil

| Capacité | État | Preuve |
|---|---|---|
| (a) Assureur unique | ✅ | `polices.assureur` (texte) + `polices.assureur_id` (une seule fiche assureur) |
| (b) Grossiste/intermédiaire distinct de l'assureur | ❌ | aucun champ grossiste sur la police ; le grossiste n'existe que comme « marché » dans le registre de mise en marché F15 (`marche_envois.marche_nom`), pas au registre des polices. Le rôle « Sous-Agent » du cabinet n'est pas non plus modélisé |
| (c) Plusieurs assureurs participants avec parts en % | ❌ | aucune table de participants ; un seul `assureur_id` par police ; la coassurance n'existe que comme clause dans les libellés des polices reçues |
| Contrat-cadre du grossiste (nº de facility par participant) | ❌ | absent |
| Responsabilité proportionnelle notée | ❌ | absent |

**Ce qu'exigerait la prise en charge** : une table de participants liée à la police (section de garantie, assureur, n° de contrat-cadre, part %, part de prime, représentant autorisé), un champ grossiste sur la police (+ son contrat-cadre quand l'assureur est unique, cas de la police entrepreneur du §11), le drapeau « responsabilité proportionnelle », l'extraction IA d'une liste « participants » avec ancrage, et l'affichage aux échéances/à la fiche police. La somme des parts par section doit valider 100 %.

---

## Synthèse des écarts transversaux (base de la construction)

1. **Registre des polices trop pauvre** : pas de limite/franchise/règle-prop/code-formulaire **par protection** ; pas de méthode de facturation ; pas de grossiste ; pas de participants. → §§3, 7, 11, 15.
2. **Certificats non générés** : attestation commerciale et certificat de continuation existent comme données, pas comme documents produits ni suivis. → §§3, 8.
3. **Financement de prime absent** : aucun échéancier, donc aucun suivi de prélèvements. → §12.
4. **Facture sans lignes** : impossible de reproduire la facture interne réelle (lignes par garantie, frais, taxe QC). → §14.
5. **Avis assureur à retransmettre** : pas de type ni de suivi de transmission. → §13.
6. **Questionnaires sectoriels manquants** : manufacturier (MAJ Economical) et TI (CFC) ; feuille de calcul PE absente. → §§2, 4, 5.
7. **Umbrella** : 3 champs seulement contre un formulaire complet. → §6.
8. **Crime structuré absent** des garanties biens alors que deux polices réelles le portent. → §§1, 7.
9. **Entité en transition** (SDC assuré sous une autre entité) : aucun mécanisme. → §10.
10. **Extraction IA mono-produit** : une police combinée ou partagée n'est extraite que sous un seul produit, sans participants. → §§7, 15.
