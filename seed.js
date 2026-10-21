/**
 * seed.js — Données initiales : catalogues de protections commerciales (Québec),
 * cabinet de démonstration, compte admin, entreprises, polices, réclamations et tâches.
 * Les dates d'échéance sont calculées par rapport à aujourd'hui pour que
 * le tableau des renouvellements (J-90 / J-60 / J-30) soit parlant en démo.
 *
 * Usage : npm run seed
 */
const bcrypt = require('bcrypt');
const bd = require('./lib/bd');

// ---------------------------------------------------------------------------
// 1. Catalogues de protections par produit — assurance commerciale (Québec)
// ---------------------------------------------------------------------------
const CATALOGUE = [
  // ---- CGL : Responsabilité civile des entreprises ----
  { ligne: 'cgl', code: 'RC-GEN', libelle: 'Responsabilité civile générale (2 000 000 $)', description: 'Dommages corporels et matériels causés aux tiers', recommandee: 1 },
  { ligne: 'cgl', code: 'PROD', libelle: 'Produits et travaux terminés', description: 'Dommages causés par les produits vendus ou travaux exécutés', recommandee: 1 },
  { ligne: 'cgl', code: 'PREJ', libelle: 'Préjudice personnel et publicitaire', description: 'Diffamation, atteinte à la réputation, publicité', recommandee: 0 },
  { ligne: 'cgl', code: 'LOCATIF', libelle: 'Responsabilité locative', description: 'Dommages aux locaux loués par l’entreprise', recommandee: 0 },
  { ligne: 'cgl', code: 'POLL', libelle: 'Pollution (avenant)', description: 'Atteintes graduelles à l’environnement', recommandee: 0 },
  // ---- BIENS : Biens commerciaux ----
  { ligne: 'biens', code: 'BAT', libelle: 'Bâtiment commercial', description: 'Immeuble occupé par l’entreprise', recommandee: 1 },
  { ligne: 'biens', code: 'CONTENU', libelle: 'Contenu et améliorations locatives', description: 'Mobilier, équipement, aménagements', recommandee: 1 },
  { ligne: 'biens', code: 'STOCK', libelle: 'Stocks et marchandises', description: 'Inventaire et produits en stock', recommandee: 1 },
  { ligne: 'biens', code: 'BRIS', libelle: 'Bris de machines', description: 'Pannes d’équipements spécialisés', recommandee: 0 },
  { ligne: 'biens', code: 'VITRAGE', libelle: 'Bris de vitres et enseignes', description: 'Vitrines, devantures, enseignes', recommandee: 0 },
  // ---- PERTE D'EXPLOITATION ----
  { ligne: 'perte_exploitation', code: 'PE-REV', libelle: 'Perte de revenus d’exploitation', description: 'Bénéfice net et charges fixes après sinistre', recommandee: 1 },
  { ligne: 'perte_exploitation', code: 'PE-FRAIS', libelle: 'Frais supplémentaires', description: 'Coûts pour maintenir l’activité après sinistre', recommandee: 1 },
  { ligne: 'perte_exploitation', code: 'PE-INTERDEP', libelle: 'Interdépendance', description: 'Dépendance envers fournisseurs ou clients clés', recommandee: 0 },
  // ---- E&O : Responsabilité professionnelle ----
  { ligne: 'eo', code: 'EO-RESP', libelle: 'Erreurs et omissions (2 000 000 $)', description: 'Fautes professionnelles, négligence, manquements', recommandee: 1 },
  { ligne: 'eo', code: 'EO-FRAIS', libelle: 'Frais de défense', description: 'Frais juridiques en cas de poursuite', recommandee: 1 },
  { ligne: 'eo', code: 'EO-MEDIAS', libelle: 'Responsabilité médias et contenu', description: 'Contenu publié, propriété intellectuelle', recommandee: 0 },
  // ---- CYBER : Cyberrisques ----
  { ligne: 'cyber', code: 'CYB-DONNEES', libelle: 'Atteinte aux données et vie privée', description: 'Fuites de données, notification, crédit de surveillance', recommandee: 1 },
  { ligne: 'cyber', code: 'CYB-INTERRUPT', libelle: 'Interruption d’activité cyber', description: 'Perte de revenus après incident informatique', recommandee: 1 },
  { ligne: 'cyber', code: 'CYB-RANCON', libelle: 'Extorsion et rançongiciel', description: 'Négociation et paiement en cas de cyberattaque', recommandee: 0 },
  { ligne: 'cyber', code: 'CYB-FRAUDE', libelle: 'Fraude par transfert de fonds', description: 'Hameçonnage ciblé, fraude au président', recommandee: 0 },
  // ---- FLOTTE : Flotte automobile ----
  { ligne: 'flotte', code: 'FLT-RC', libelle: 'Responsabilité civile (2 000 000 $)', description: 'Chapitre A — dommages causés aux tiers', recommandee: 1 },
  { ligne: 'flotte', code: 'FLT-TR', libelle: 'Tous risques (chapitre B1)', description: 'Collision, renversement et autres risques', recommandee: 0 },
  { ligne: 'flotte', code: 'FLT-COLL', libelle: 'Collision et renversement (chapitre B2)', description: 'Uniquement collision et renversement', recommandee: 0 },
  { ligne: 'flotte', code: 'FLT-VN', libelle: 'Valeur à neuf (avenant 43)', description: 'Remplacement à neuf sans dépréciation', recommandee: 1 },
  { ligne: 'flotte', code: 'FLT-LOC', libelle: 'Véhicule de location (avenant 20)', description: 'Indemnisation d’un véhicule de remplacement', recommandee: 0 },
  // ---- CAUTIONNEMENT ----
  { ligne: 'cautionnement', code: 'CAUT-SOUM', libelle: 'Cautionnement de soumission', description: 'Garantie jointe à une soumission', recommandee: 1 },
  { ligne: 'cautionnement', code: 'CAUT-EXEC', libelle: 'Cautionnement d’exécution', description: 'Garantie de bonne exécution des travaux', recommandee: 1 },
  { ligne: 'cautionnement', code: 'CAUT-MO', libelle: 'Main-d’œuvre et matériaux', description: 'Paiement des sous-traitants et fournisseurs', recommandee: 0 },
  // ---- D&O : Administrateurs et dirigeants ----
  { ligne: 'do', code: 'DO-RESP', libelle: 'Responsabilité des administrateurs et dirigeants', description: 'Fautes de gestion, décisions du conseil', recommandee: 1 },
  { ligne: 'do', code: 'DO-FRAIS', libelle: 'Frais de défense des dirigeants', description: 'Frais juridiques des personnes assurées', recommandee: 1 },
  { ligne: 'do', code: 'DO-EMPLOI', libelle: 'Pratiques d’emploi', description: 'Congédiement injustifié, harcèlement, discrimination', recommandee: 0 },
  // ---- AUTRE ----
  { ligne: 'autre', code: 'AUTRE', libelle: 'Protection personnalisée', description: 'Protection hors catalogue', recommandee: 0 },
];

function semer() {
  // Si un cabinet existe déjà, on ne sème que le catalogue manquant.
  const nbCabinets = bd.prepare('SELECT COUNT(*) AS n FROM cabinets').get().n;

  const insererProtection = bd.prepare(`
    INSERT OR IGNORE INTO catalogue_protections (ligne, code, libelle, description, recommandee)
    VALUES (@ligne, @code, @libelle, @description, @recommandee)
  `);
  const txCatalogue = bd.transaction(() => {
    for (const p of CATALOGUE) insererProtection.run(p);
  });
  txCatalogue();

  if (nbCabinets > 0) {
    console.log('Des cabinets existent déjà — catalogue vérifié, données démo non ajoutées.');
    return;
  }

  const ajouterJours = (jours) => {
    const d = new Date();
    d.setDate(d.getDate() + jours);
    return d.toISOString().slice(0, 10); // AAAA-MM-JJ
  };

  const tx = bd.transaction(() => {
    // Cabinet démo + admin (mot de passe à changer au premier login)
    const cab = bd.prepare('INSERT INTO cabinets (nom, token_capture) VALUES (?, ?)').run('Cabinet Démo', bd.genererJetonCapture());
    const hash = bcrypt.hashSync('ChangeMoi123!', 12);
    bd.prepare(`
      INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe)
      VALUES (?, ?, ?, 'admin', ?, 1)
    `).run(cab.lastInsertRowid, 'admin@demo.ca', hash, 'Administrateur Démo');
    const adminId = bd.prepare('SELECT id FROM users WHERE email = ?').get('admin@demo.ca').id;

    const insererEntreprise = bd.prepare(`
      INSERT INTO clients (cabinet_id, raison_sociale, neq, secteur_activite, prenom, nom, titre_contact,
                           courriel, telephone, adresse, ville, code_postal, langue, notes, responsable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Fiches assureurs de démonstration (reliées aux polices ci-dessous)
    const insererAssureur = bd.prepare(`
      INSERT OR IGNORE INTO assureurs (cabinet_id, nom, telephone_general, na_nom, mod_nom,
                                       compta_nom, compta_telephone, compta_courriel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const idAssureur = (nom) => bd.prepare('SELECT id FROM assureurs WHERE cabinet_id = ? AND nom = ?').get(cab.lastInsertRowid, nom).id;
    insererAssureur.run(cab.lastInsertRowid, 'Intact Assurance', '1-866-464-2424', 'Équipe nouvelles affaires', 'Service avenants',
      'Comptabilité Intact', '1-866-464-2424', 'comptabilite@intact.demo');
    insererAssureur.run(cab.lastInsertRowid, 'Beneva', '1-866-899-4845', 'Équipe nouvelles affaires', 'Service avenants',
      'Comptabilité Beneva', '1-866-899-4845', 'comptabilite@beneva.demo');
    insererAssureur.run(cab.lastInsertRowid, 'Desjardins Assurances', '1-866-838-7584', 'Équipe nouvelles affaires', 'Service avenants',
      'Comptabilité Desjardins', '1-866-838-7584', 'comptabilite@desjardins.demo');
    // Produits offerts + taux de commission (démo : Intact sans cyber, Beneva sans flotte)
    const insererProduit = bd.prepare(`
      INSERT OR IGNORE INTO assureur_produits (assureur_id, produit, commission_pct) VALUES (?, ?, ?)
    `);
    const produitsDemo = {
      'Intact Assurance': { cgl: 12.5, biens: 12.5, perte_exploitation: 12.5, eo: 15, flotte: 10, cautionnement: 10, do: 15, autre: 12.5 },
      'Beneva': { cgl: 15, biens: 15, perte_exploitation: 15, eo: 15, cyber: 17.5, cautionnement: 12, do: 15, autre: 15 },
      'Desjardins Assurances': { cgl: 12, biens: 12, perte_exploitation: 12, eo: 12, cyber: 12, flotte: 12, cautionnement: 12, do: 12, autre: 12 },
    };
    for (const [nomAss, produits] of Object.entries(produitsDemo)) {
      const aid = idAssureur(nomAss);
      for (const [produit, taux] of Object.entries(produits)) insererProduit.run(aid, produit, taux);
    }
    const insererPolice = bd.prepare(`
      INSERT INTO polices (cabinet_id, client_id, ligne, assureur, assureur_id, numero_police, date_effet, date_echeance,
                           franchise, statut, responsable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `);
    const policeAssureur = (nom) => { const n = idAssureur(nom); return [nom, n]; };
    const insererProt = bd.prepare(`
      INSERT INTO police_protections (police_id, code, libelle, prime) VALUES (?, ?, ?, ?)
    `);
    const libelleDe = (ligne, code) =>
      bd.prepare('SELECT libelle FROM catalogue_protections WHERE ligne = ? AND code = ?').get(ligne, code).libelle;

    // --- Entreprise 1 : Constructions Méthot inc. — CGL (J-25) + Biens (J-60) ---
    const methot = insererEntreprise.run(cab.lastInsertRowid, 'Constructions Méthot inc.', '1161234567', 'Construction',
      'Sylvain', 'Méthot', 'Président', 'sylvain.methot@constructionsmethot.ca', '514-555-0123',
      '1200 boulevard Industriel', 'Laval', 'H7L 4B2', 'FR', 'Entrepreneur général, 25 employés.', adminId).lastInsertRowid;
    const policeCgl = insererPolice.run(cab.lastInsertRowid, methot, 'cgl', ...policeAssureur('Intact Assurance'), 'CGL-2025-10001',
      ajouterJours(-340), ajouterJours(25), 2500, adminId).lastInsertRowid;
    // Note : pas de PREJ → sera détectée comme protection manquante (non recommandée toutefois)
    insererProt.run(policeCgl, 'RC-GEN', libelleDe('cgl', 'RC-GEN'), 2850.00);
    insererProt.run(policeCgl, 'PROD', libelleDe('cgl', 'PROD'), 640.00);
    const policeBiens = insererPolice.run(cab.lastInsertRowid, methot, 'biens', ...policeAssureur('Beneva'), 'BIEN-2024-20002',
      ajouterJours(-305), ajouterJours(60), 5000, adminId).lastInsertRowid;
    insererProt.run(policeBiens, 'BAT', libelleDe('biens', 'BAT'), 1200.00);
    insererProt.run(policeBiens, 'CONTENU', libelleDe('biens', 'CONTENU'), 840.00);
    // STOCK manquant → détecté comme manquant (recommandée)

    // --- Entreprise 2 : Resto Le Petit Four inc. — CGL (J-80) + 1 réclamation ---
    const petitFour = insererEntreprise.run(cab.lastInsertRowid, 'Resto Le Petit Four inc.', '1172345678', 'Restauration',
      'Chantal', 'Dubois', 'Propriétaire', 'chantal.dubois@petitfour.ca', '418-555-0145',
      '88 rue Saint-Jean', 'Québec', 'G1R 1N4', 'FR', 'Restaurant, salle de 60 places.', adminId).lastInsertRowid;
    const policeCglPf = insererPolice.run(cab.lastInsertRowid, petitFour, 'cgl', ...policeAssureur('Desjardins Assurances'), 'CGL-2024-30003',
      ajouterJours(-285), ajouterJours(80), 1000, adminId).lastInsertRowid;
    insererProt.run(policeCglPf, 'RC-GEN', libelleDe('cgl', 'RC-GEN'), 1980.00);
    insererProt.run(policeCglPf, 'PROD', libelleDe('cgl', 'PROD'), 420.00);

    // Réclamation : dégât d'eau, en évaluation, rappel dépassé
    const rec1 = bd.prepare(`
      INSERT INTO reclamations (cabinet_id, client_id, police_id, numero_reclamation, date_sinistre, date_declaration,
        description, statut, montant_reclame, franchise_appliquee, expert_nom, expert_contact, responsable_id, date_rappel, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ouverte', ?, ?, ?, ?, ?, ?, ?)
    `).run(cab.lastInsertRowid, petitFour, policeCglPf, 'SIN-2026-4471', ajouterJours(-12), ajouterJours(-10),
      'Dégât d’eau : bris d’un tuyau d’alimentation sous l’évier de la cuisine, plancher et bas des murs endommagés.',
      45000, 1000, 'Marie-Claude Roy', 'm.roy@experts.ca · 418-555-0220', adminId, ajouterJours(-2),
      'Photos reçues. En attente du rapport de l’experte.').lastInsertRowid;
    bd.prepare('INSERT INTO reclamation_suivis (reclamation_id, user_id, texte) VALUES (?, ?, ?)')
      .run(rec1, adminId, 'Déclaration reçue de l’assurée. Dossier ouvert chez Desjardins, numéro SIN-2026-4471.');
    bd.prepare('INSERT INTO reclamation_suivis (reclamation_id, user_id, texte) VALUES (?, ?, ?)')
      .run(rec1, adminId, 'Experte mandatée. Visite prévue cette semaine. Rappel à faire si pas de nouvelles.');

    // --- Entreprise 3 : Garage Saint-Michel inc. — Flotte (J-120, hors radar) ---
    const garage = insererEntreprise.run(cab.lastInsertRowid, 'Garage Saint-Michel inc.', '1143456789', 'Réparation automobile',
      'Karim', 'Haddad', 'Directeur', 'karim.haddad@garagesaintmichel.ca', '514-555-0177',
      '4500 boulevard Saint-Michel', 'Montréal', 'H1Z 1Z9', 'FR', 'Garage, 4 véhicules de courtoisie.', adminId).lastInsertRowid;
    const policeFlotte = insererPolice.run(cab.lastInsertRowid, garage, 'flotte', ...policeAssureur('Intact Assurance'), 'FLT-2025-40004',
      ajouterJours(-245), ajouterJours(120), 1000, adminId).lastInsertRowid;
    insererProt.run(policeFlotte, 'FLT-RC', libelleDe('flotte', 'FLT-RC'), 2350.00);
    insererProt.run(policeFlotte, 'FLT-TR', libelleDe('flotte', 'FLT-TR'), 1890.00);
    // FLT-VN manquant → détecté comme manquant (recommandée)

    // Réclamation réglée (historique)
    const rec2 = bd.prepare(`
      INSERT INTO reclamations (cabinet_id, client_id, police_id, numero_reclamation, date_sinistre, date_declaration,
        description, statut, montant_reclame, montant_regle, franchise_appliquee, responsable_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'fermee', ?, ?, ?, ?, ?)
    `).run(cab.lastInsertRowid, garage, policeFlotte, 'SIN-2025-3890', ajouterJours(-200), ajouterJours(-198),
      'Collision avec un véhicule de courtoisie dans le stationnement du garage.',
      8200, 7200, 1000, adminId, 'Réglée à l’amiable. Chèque reçu.').lastInsertRowid;
    bd.prepare('INSERT INTO reclamation_suivis (reclamation_id, user_id, texte) VALUES (?, ?, ?)')
      .run(rec2, adminId, 'Règlement final reçu et confirmé. Dossier fermé.');

    // --- Tâches démo ---
    bd.prepare(`
      INSERT INTO taches (cabinet_id, assigne_a, entreprise_id, titre, date_echeance, statut, notes)
      VALUES (?, ?, ?, ?, ?, 'a_faire', ?)
    `).run(cab.lastInsertRowid, adminId, garage, 'Rappeler Karim Haddad — révision flotte avant renouvellement',
      ajouterJours(-3), 'Préparer la comparaison avec et sans valeur à neuf.');
    bd.prepare(`
      INSERT INTO taches (cabinet_id, assigne_a, entreprise_id, titre, date_echeance, statut, notes)
      VALUES (?, ?, ?, ?, ?, 'a_faire', ?)
    `).run(cab.lastInsertRowid, adminId, methot, 'Envoyer l’attestation d’assurance au donneur d’ouvrage',
      ajouterJours(5), 'Chantier du 1200 Industriel — preuve de CGL exigée.');

    // Consentements Loi 25 d'exemple pour Constructions Méthot
    const insererConsent = bd.prepare(`
      INSERT INTO consentements (client_id, type, accepte, date_consentement) VALUES (?, ?, ?, ?)
    `);
    insererConsent.run(methot, 'communications', 1, ajouterJours(-300));
    insererConsent.run(methot, 'partage_assureur', 1, ajouterJours(-300));
    insererConsent.run(methot, 'marketing', 0, null);

    // --- Factures démo : une payée, une partielle, une en retard ---
    const insererFacture = bd.prepare(`
      INSERT INTO factures (cabinet_id, client_id, police_id, numero_facture, description, montant,
        montant_paye, date_emission, date_echeance, statut, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insererPaiement = bd.prepare(`
      INSERT INTO paiements (facture_id, montant, date_paiement, mode, notes) VALUES (?, ?, ?, ?, ?)
    `);
    // Payée : prime CGL Méthot
    const fac1 = insererFacture.run(cab.lastInsertRowid, methot, policeCgl, 'FAC-2026-0001',
      'Prime assurance CGL 2026 — Constructions Méthot inc.', 3490.00, 3490.00,
      ajouterJours(-60), ajouterJours(-30), 'payee', 'Payée en totalité.').lastInsertRowid;
    insererPaiement.run(fac1, 3490.00, ajouterJours(-35), 'virement', 'Paiement complet reçu.');
    // Partielle : prime biens Méthot
    const fac2 = insererFacture.run(cab.lastInsertRowid, methot, policeBiens, 'FAC-2026-0002',
      'Prime assurance biens 2026 — Constructions Méthot inc.', 2040.00, 1000.00,
      ajouterJours(-40), ajouterJours(20), 'partielle', 'Premier versement reçu.').lastInsertRowid;
    insererPaiement.run(fac2, 1000.00, ajouterJours(-10), 'cheque', 'Chèque #1024.');
    // En retard : prime CGL Petit Four
    insererFacture.run(cab.lastInsertRowid, petitFour, policeCglPf, 'FAC-2026-0003',
      'Prime assurance CGL 2026 — Resto Le Petit Four inc.', 2400.00, 0,
      ajouterJours(-75), ajouterJours(-15), 'en_retard', 'À relancer.');

    // --- Leads démo (campagnes publicitaires) ---
    const insererLead = bd.prepare(`
      INSERT INTO leads (cabinet_id, nom, entreprise, courriel, telephone, besoin, source, campagne,
        utm_source, utm_medium, utm_campaign, statut, responsable_id, date_rappel, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const lead1 = insererLead.run(cab.lastInsertRowid, 'Sophie Lavoie', 'Boulangerie Lavoie inc.',
      'sophie@boulangerielavoie.ca', '514-555-0310', 'Assurance pour ma boulangerie : local, RC et perte d’exploitation.',
      'facebook_ads', 'promo-commerces-2026', 'facebook', 'cpc', 'promo-commerces-2026', 'nouveau', adminId,
      ajouterJours(2), 'Cliqué sur la pub « Protégez votre commerce ».').lastInsertRowid;
    bd.prepare('INSERT INTO lead_suivis (lead_id, user_id, texte) VALUES (?, ?, ?)')
      .run(lead1, adminId, 'Premier contact à faire cette semaine.');
    insererLead.run(cab.lastInsertRowid, 'Jean-François Roy', 'Toitures Roy inc.',
      'jf@toituresroy.ca', '450-555-0288', 'CGL + cautionnement pour soumissions municipales.',
      'google_ads', 'artisans-2026', 'google', 'cpc', 'artisans-2026', 'contacte', adminId,
      null, 'A appelé, veut une soumission pour avril.');
    insererLead.run(cab.lastInsertRowid, 'Marie-Claude Bouchard', 'Clinique Dentaire Bouchard inc.',
      'mc.bouchard@cliniquebouchard.ca', '418-555-0331', 'Responsabilité professionnelle + cyber pour la clinique.',
      'site_web', null, 'site', 'organique', null, 'qualifie', adminId,
      ajouterJours(7), 'Budget confirmé, dossier sérieux.');
    insererLead.run(cab.lastInsertRowid, 'Pierre Gagnon', 'Transport Gagnon inc.',
      'p.gagnon@transportgagnon.ca', '819-555-0477', 'Flotte de 8 camions, renouvellement en juin.',
      'reference', null, null, null, null, 'soumission', adminId, null, 'Référé par Constructions Méthot.');
    insererLead.run(cab.lastInsertRowid, 'Isabelle Fortin', 'Boutique Fortin inc.',
      'isabelle@boutiquefortin.ca', '514-555-0520', 'Petite boutique, voulait seulement un prix.',
      'facebook_ads', 'promo-commerces-2026', 'facebook', 'cpc', 'promo-commerces-2026', 'perdu', adminId,
      null, 'A choisi un concurrent moins cher.');

    // --- Réunion démo : révision avec Méthot dans 3 jours ---
    bd.prepare(`
      INSERT INTO reunions (cabinet_id, client_id, titre, date_heure, lien_teams, statut, notes)
      VALUES (?, ?, ?, ?, ?, 'planifiee', ?)
    `).run(cab.lastInsertRowid, methot, 'Révision annuelle — CGL et biens',
      (() => { const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(10, 0, 0, 0);
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; })(),
      'https://teams.microsoft.com/l/meetup-join/exemple-demo', 'Préparer la comparaison des protections manquantes.');

    // --- FPQ1 démo (étape 1/10) : soumission auto — 2 conducteurs, 2 véhicules ---
    const fpq1 = require('./lib/fpq1');
    const dubois = insererEntreprise.run(cab.lastInsertRowid, 'Martin Dubois (particulier)', null, 'Particulier',
      'Martin', 'Dubois', null, 'martin.dubois@exemple.ca', '514-555-0199',
      '4520 rue Sherbrooke Est', 'Montréal', 'H1V 1B3', 'FR', 'Client automobile (FPQ1).', adminId).lastInsertRowid;
    const soumAuto = fpq1.creerSoumission({
      cabinetId: cab.lastInsertRowid, userId: adminId, clientId: dubois,
      dateEffetSouhaitee: ajouterJours(30), notes: 'Renouvellement anticipé — comparer Intact vs Beneva.',
    });
    const cond1 = fpq1.ajouterConducteur(soumAuto, cab.lastInsertRowid, adminId, {
      nom: 'Dubois', prenom: 'Martin', date_naissance: '1982-04-17', sexe: 'M', etat_civil: 'Marié',
      numero_permis: 'D1234-567890-12', province_permis: 'QC', date_obtention_permis: '2000-06-15',
      annees_experience_ca: 26, lien_assure: 'Assuré désigné', telephone: '514-555-0199',
      courriel: 'martin.dubois@exemple.ca', profession: 'Électricien', employeur: 'Hydro-Québec',
      conducteur_principal: 1,
      infractions: [{ date: '2023-05-02', type: 'Excès de vitesse', points: 2 }],
      suspensions: [],
    });
    const cond2 = fpq1.ajouterConducteur(soumAuto, cab.lastInsertRowid, adminId, {
      nom: 'Dubois', prenom: 'Sophie', date_naissance: '1985-09-30', sexe: 'F', etat_civil: 'Mariée',
      numero_permis: 'D2345-678901-23', province_permis: 'QC', date_obtention_permis: '2003-11-20',
      annees_experience_ca: 22, lien_assure: 'Conjointe', conducteur_principal: 0,
      infractions: [], suspensions: [],
    });
    const veh1 = fpq1.ajouterVehicule(soumAuto, cab.lastInsertRowid, adminId, {
      annee: 2022, marque: 'Honda', modele: 'CR-V', version_finition: 'EX-L', vin: '2HKRW2H54NH123456',
      carrosserie: 'VUS', neuf_occasion: 'neuf', date_achat: '2022-03-10', prix_achat: 42000, valeur_estimee: 31000,
      financement: 'finance', creancier_nom: 'Financière Démo', creancier_courriel: 'comptes@financiere.demo',
      usage: 'navette', km_annuel: 18000, pct_hors_quebec: 5, stationnement: 'Garage privé',
      remisage_hiver: 0, antivol_tag: 1, pneus_hiver: 1, conducteur_principal_id: cond1, remorque: 0,
    });
    const veh2 = fpq1.ajouterVehicule(soumAuto, cab.lastInsertRowid, adminId, {
      annee: 2019, marque: 'Mazda', modele: 'Mazda3', vin: 'JM1BPACLXK1123456',
      carrosserie: 'Berline', neuf_occasion: 'occasion', date_achat: '2021-07-22', prix_achat: 18500,
      valeur_estimee: 14000, financement: 'comptant', usage: 'promenade', km_annuel: 9000,
      pct_hors_quebec: 0, stationnement: 'Entrée privée', antivol_tag: 0, pneus_hiver: 1,
      conducteur_principal_id: cond2, remorque: 0,
    });
    fpq1.definirGaranties(veh1, cab.lastInsertRowid, adminId, {
      rc_montant: 2000000, protection_b: 'b1', franchise_b: 500,
      avenants: {
        faq43: 1,
        faq20: 1,
      },
      prime: 1450.00,
    });
    fpq1.definirGaranties(veh2, cab.lastInsertRowid, adminId, {
      rc_montant: 2000000, protection_b: 'b3', franchise_b: 1000,
      avenants: { faq27: 1 },
      prime: 890.00,
    });
    fpq1.definirAntecedents(soumAuto, cab.lastInsertRowid, adminId, {
      assureur_actuel: 'Assureur Démo', numero_police_actuelle: 'AUTO-2024-555',
      date_expiration_actuelle: ajouterJours(30), annees_assurance_continue: 8,
      sinistres_6ans: [{ date: '2022-11-14', type: 'Collision', montant: 3200, responsabilite: 'responsable' }],
      consentements: {
        credit: { accepte: true, date: ajouterJours(0) },
        dossier_saaq: { accepte: true, date: ajouterJours(0) },
        fcsa: { accepte: true, date: ajouterJours(0) },
      },
    });
    // --- Biens démo (étape 1/10 biens) : soumission biens — 2 bâtiments, contenus, garanties, antécédents ---
    const biens = require('./lib/biens');
    const soumBiens = biens.creerSoumission({
      cabinetId: cab.lastInsertRowid, userId: adminId, clientId: garage,
      dateEffetSouhaitee: ajouterJours(45), notes: 'Renouvellement biens — comparer Beneva vs Intact.',
    });
    const bat1 = biens.ajouterBatiment(soumBiens, cab.lastInsertRowid, adminId, {
      adresse: '4500 boulevard Saint-Michel', ville: 'Montréal', code_postal: 'H1Z 1Z9',
      type_construction: 'acier', annee_construction: 1987, superficie_pi2: 8500, nb_etages: 1,
      occupation: 'Atelier de réparation automobile', valeur_batiment: 950000,
      gicleurs: 1, distance_caserne_km: 1.2, chauffage: 'Gaz naturel', annee_toiture: 2019,
      notes: 'Atelier principal avec 6 ponts élévateurs.',
    });
    const bat2 = biens.ajouterBatiment(soumBiens, cab.lastInsertRowid, adminId, {
      adresse: '4500 boulevard Saint-Michel (arrière)', ville: 'Montréal', code_postal: 'H1Z 1Z9',
      type_construction: 'maconnerie', annee_construction: 1975, superficie_pi2: 3200, nb_etages: 1,
      occupation: 'Entrepôt', valeur_batiment: 380000,
      gicleurs: 0, distance_caserne_km: 1.2, chauffage: 'Électrique', annee_toiture: 2015,
      notes: 'Entrepôt de pièces détachées.',
    });
    biens.ajouterContenu(soumBiens, cab.lastInsertRowid, adminId, {
      description: 'Outillage spécialisé (ponts, compresseurs, bancs de diagnostic)',
      type_contenu: 'equipements', valeur: 220000,
    }, bat1);
    biens.ajouterContenu(soumBiens, cab.lastInsertRowid, adminId, {
      description: 'Stock de pièces détachées (pneus, freins, filtres)',
      type_contenu: 'stock', valeur: 145000,
    }, bat2);
    biens.ajouterContenu(soumBiens, cab.lastInsertRowid, adminId, {
      description: 'Mobilier de bureau et salle d’attente',
      type_contenu: 'mobilier', valeur: 18000,
    }, null);
    biens.definirGaranties(bat1, cab.lastInsertRowid, adminId, {
      formule: 'tous_risques', franchise: 2500, montant_assurance: 950000,
      avenants: { tremblement_terre: 1, refoulement_egout: 1, bris_machines: 1 },
      prime: 2850.00,
    });
    biens.definirGaranties(bat2, cab.lastInsertRowid, adminId, {
      formule: 'risques_designes', franchise: 5000, montant_assurance: 380000,
      avenants: { inondation: 1 },
      prime: 1240.00,
    });
    biens.definirAntecedents(soumBiens, cab.lastInsertRowid, adminId, {
      assureur_actuel: 'Beneva', numero_police_actuelle: 'BIEN-2024-20002',
      date_expiration_actuelle: ajouterJours(45), annees_assurance_continue: 6,
      sinistres_5ans: [{ date: '2023-02-18', type: 'Dégât d’eau (toiture)', montant: 18400 }],
      consentements: {
        credit: { accepte: true, date: ajouterJours(0) },
      },
    });
    // --- RC démo (étape 1/10 RC) : soumission RC — entrepreneur général, 2 lieux d'exploitation ---
    const rc = require('./lib/rc');
    const soumRC = rc.creerSoumission({
      cabinetId: cab.lastInsertRowid, userId: adminId, clientId: methot,
      dateEffetSouhaitee: ajouterJours(25), notes: 'Renouvellement RC — comparer Intact vs Desjardins.',
    });
    const exp1 = rc.ajouterExploitation(soumRC, cab.lastInsertRowid, adminId, {
      adresse: '850 avenue Centrale', ville: 'Laval', code_postal: 'H7S 1A1',
      type_activite: 'Gestion de chantier et bureau administratif',
      code_classification: '91552',
      description_activites: 'Siège social : bureau de gestion de chantiers, soumissions et administration. Aucune fabrication.',
      chiffre_affaires: 800000, masse_salariale: 400000, nb_employes: 8,
      superficie_pi2: 2500, sous_traitants: 'aucun',
      notes: 'Bureau au 2e étage, 1 réception.',
    });
    const exp2 = rc.ajouterExploitation(soumRC, cab.lastInsertRowid, adminId, {
      adresse: '22 rue des Bâtisseurs', ville: 'Laval', code_postal: 'H7S 2B2',
      type_activite: 'Rénovation résidentielle et commerciale',
      code_classification: '91551',
      description_activites: 'Chantier principal : rénovation, agrandissement et toiture. Travaux de sous-sol exclus.',
      chiffre_affaires: 2400000, masse_salariale: 900000, nb_employes: 22,
      superficie_pi2: 18000, sous_traitants: 'assures',
      notes: 'Entrepreneur général — sous-traitants assurés exigés (électricité, plomberie).',
    });
    rc.definirGaranties(exp1, cab.lastInsertRowid, adminId, {
      limite_par_sinistre: 2000000, limite_agregat: 4000000, franchise: 2500,
      formule: 'locaux_operations', avenants: { pollution: 1 }, prime: 5200.00,
    });
    rc.definirGaranties(exp2, cab.lastInsertRowid, adminId, {
      limite_par_sinistre: 2000000, limite_agregat: 4000000, franchise: 2500,
      formule: 'globale', avenants: { pollution: 1, parapluie: 1 }, prime: 7800.00,
    });
    rc.definirAntecedents(soumRC, cab.lastInsertRowid, adminId, {
      assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'CGL-2024-30111',
      date_expiration_actuelle: ajouterJours(25), annees_assurance_continue: 5,
      sinistres_5ans: [{ date: '2024-06-10', type: 'Blessure corporelle (chantier)', montant: 45000 }],
      consentements: {
        credit: { accepte: true, date: ajouterJours(0) },
      },
    });
    // --- CYBER démo (étape 1/10 cyber) : soumission cyber — clinique dentaire, 4 mesures ---
    const cyber = require('./lib/cyber');
    const bouchard = insererEntreprise.run(cab.lastInsertRowid, 'Clinique Dentaire Bouchard inc.', '1167890123', 'Soins dentaires',
      'Marie-Claude', 'Bouchard', 'Propriétaire', 'mc.bouchard@cliniquebouchard.ca', '418-555-0331',
      '700 rue Saint-Jean', 'Québec', 'G1R 1P9', 'FR', 'Clinique dentaire, 12 employés, dossiers patients informatisés.', adminId).lastInsertRowid;
    const soumCyber = cyber.creerSoumission({
      cabinetId: cab.lastInsertRowid, userId: adminId, clientId: bouchard,
      dateEffetSouhaitee: ajouterJours(30), notes: 'Renouvellement cyber — protection des dossiers patients.',
    });
    cyber.ajouterMesure(soumCyber, cab.lastInsertRowid, adminId, {
      type_mesure: 'mfa', statut: 'en_place',
      details: 'Authentification multifacteur sur tous les accès admin et la messagerie.',
    });
    cyber.ajouterMesure(soumCyber, cab.lastInsertRowid, adminId, {
      type_mesure: 'sauvegardes', statut: 'en_place',
      details: 'Sauvegardes quotidiennes chiffrées, conservées hors site (infogéré).',
    });
    cyber.ajouterMesure(soumCyber, cab.lastInsertRowid, adminId, {
      type_mesure: 'formation_hameconnage', statut: 'partiel',
      details: 'Formation anti-hameçonnage complétée par 7 employés sur 12.',
    });
    cyber.ajouterMesure(soumCyber, cab.lastInsertRowid, adminId, {
      type_mesure: 'plan_reponse_incident', statut: 'prevu',
      details: 'Plan de réponse aux incidents en préparation (Q1 2026).',
    });
    cyber.definirGaranties(soumCyber, cab.lastInsertRowid, adminId, {
      limite_par_sinistre: 1000000, limite_agregat: 1000000, franchise: 5000,
      delai_carence: '8 heures', avenants: { rancongiciel: 1, donnees_vie_privee: 1 }, prime: 2400.00,
    });
    cyber.definirAntecedents(soumCyber, cab.lastInsertRowid, adminId, {
      assureur_actuel: 'Beneva', numero_police_actuelle: 'CYB-2024-70112',
      date_expiration_actuelle: ajouterJours(30), annees_assurance_continue: 3,
      incidents_5ans: [{ date: '2024-11-02', type: 'Rançongiciel (poste de réception)', montant: 28000, sinistre: false }],
      consentements: {
        credit: { accepte: true, date: ajouterJours(0) },
      },
    });
    // --- E&O démo (étape 1/10 E&O) : soumission E&O — consultants en TI, 3 activités ---
    const eo = require('./lib/eo');
    const lussier = insererEntreprise.run(cab.lastInsertRowid, 'Groupe Conseil Lussier inc.', '1176543210', 'Conseil en TI',
      'Hélène', 'Lussier', 'Associée', 'h.lussier@gclussier.ca', '514-555-0412',
      '1200 avenue McGill College, bureau 800', 'Montréal', 'H3B 4G7', 'FR', 'Consultants en TI, 8 professionnels.', adminId).lastInsertRowid;
    const soumEo = eo.creerSoumission({
      cabinetId: cab.lastInsertRowid, userId: adminId, clientId: lussier,
      dateEffetSouhaitee: ajouterJours(45), notes: 'Renouvellement E&O — croissance des activités d’implantation.',
    });
    eo.ajouterActivite(soumEo, cab.lastInsertRowid, adminId, {
      description_activite: 'Conseil en transformation numérique',
      chiffre_affaires: 450000, nb_professionnels: 4,
      notes: 'Diagnostics, feuilles de route, accompagnement au changement.',
    });
    eo.ajouterActivite(soumEo, cab.lastInsertRowid, adminId, {
      description_activite: 'Implantation de progiciels',
      chiffre_affaires: 300000, nb_professionnels: 3,
      notes: 'Paramétrage et déploiement de progiciels de gestion.',
    });
    eo.ajouterActivite(soumEo, cab.lastInsertRowid, adminId, {
      description_activite: 'Formation des utilisateurs',
      chiffre_affaires: 75000, nb_professionnels: 1,
      notes: 'Formations sur mesure chez les clients.',
    });
    eo.definirGaranties(soumEo, cab.lastInsertRowid, adminId, {
      limite_par_sinistre: 2000000, limite_agregat: 2000000, franchise: 10000,
      base: 'reclamations_presentees', avenants: { frais_defense: 1, medias_contenu: 1 }, prime: 3200.00,
    });
    eo.definirAntecedents(soumEo, cab.lastInsertRowid, adminId, {
      assureur_actuel: 'Intact Assurance', numero_police_actuelle: 'EO-2023-90412',
      date_expiration_actuelle: ajouterJours(45), annees_assurance_continue: 4,
      reclamations_5ans: [{ date: '2023-05-14', nature: 'Erreur d’implantation (retard de projet)', montant: 45000, sinistre: true }],
      circonstances: 'Un client menace de réclamer pour un dépassement de budget sur un projet 2025.',
      consentements: {
        credit: { accepte: true, date: ajouterJours(0) },
      },
    });
    // --- D&O démo (étape 1/10 D&O) : soumission D&O — manufacture québécoise, 3 dirigeants ---
    const dom = require('./lib/do');
    const forges = insererEntreprise.run(cab.lastInsertRowid, 'Forges Bélanger inc.', '2244556677', 'Fabrication de pièces métalliques',
      'Marc', 'Bélanger', 'Président', 'm.belanger@forgesbelanger.ca', '450-555-0198',
      '875 boulevard Saint-Laurent, bureau 100', 'Longueuil', 'J4K 1C2', 'FR', 'PME manufacturière, 45 employés, ventes au Canada.', adminId).lastInsertRowid;
    const soumDo = dom.creerSoumission({
      cabinetId: cab.lastInsertRowid, userId: adminId, clientId: forges,
      dateEffetSouhaitee: ajouterJours(60), notes: 'Première police D&O — levée de fonds privée en vue.',
    });
    dom.ajouterDirigeant(soumDo, cab.lastInsertRowid, adminId, {
      nom: 'Marc Bélanger', fonction: 'Président', annees_experience: 18,
      antecedents_personnels: 'Aucune réclamation ou poursuite personnelle.',
    });
    dom.ajouterDirigeant(soumDo, cab.lastInsertRowid, adminId, {
      nom: 'Julie Bélanger', fonction: 'Trésorière', annees_experience: 12,
      antecedents_personnels: 'Aucune réclamation ou poursuite personnelle.',
    });
    dom.ajouterDirigeant(soumDo, cab.lastInsertRowid, adminId, {
      nom: 'Robert Gagnon', fonction: 'Administrateur indépendant', annees_experience: 22,
      antecedents_personnels: 'Aucune réclamation ou poursuite personnelle.',
    });
    dom.definirGaranties(soumDo, cab.lastInsertRowid, adminId, {
      limite_par_sinistre: 2000000, limite_agregat: 2000000, franchise: 25000,
      base: 'reclamations_presentees', avenants: { frais_defense: 1 }, prime: 4500.00,
    });
    dom.definirAntecedents(soumDo, cab.lastInsertRowid, adminId, {
      assureur_actuel: 'Aucun', numero_police_actuelle: null,
      date_expiration_actuelle: null, annees_assurance_continue: 0,
      reclamations_5ans: [{ date: '2022-08-30', nature: 'Poursuite d’un actionnaire minoritaire (faute de gestion alléguée)', montant: 120000, sinistre: true }],
      poursuites_en_cours: 'Aucune poursuite ou action en justice en cours ou envisagée à la date de la soumission.',
      consentements: {
        credit: { accepte: true, date: ajouterJours(0) },
      },
    });
    // --- PE démo (étape 1/10 perte d'exploitation) : soumission PE — boulangerie, 3 établissements ---
    const pemod = require('./lib/pe');
    const chaleur = insererEntreprise.run(cab.lastInsertRowid, 'Boulangerie Chaleur inc.', '2255667788', 'Boulangerie et pâtisserie',
      'Robert', 'Chaleur', 'Propriétaire', 'r.chaleur@boulangeriechaleur.ca', '514-555-0274',
      '123 rue Sainte-Catherine E', 'Montréal', 'H2X 1K4', 'FR', 'Boulangerie artisanale, 18 employés, fournil + magasin + entrepôt.', adminId).lastInsertRowid;
    const soumPe = pemod.creerSoumission({
      cabinetId: cab.lastInsertRowid, userId: adminId, clientId: chaleur,
      dateEffetSouhaitee: ajouterJours(40), notes: 'Renouvellement perte d’exploitation — inclure la détérioration des stocks réfrigérés.',
    });
    pemod.ajouterEtablissement(soumPe, cab.lastInsertRowid, adminId, {
      nom_lieu: 'Fournil', adresse: '123 rue Sainte-Catherine E, Montréal', occupation: 'Boulangerie — fournil',
      chiffre_affaires: 750000, superficie: 250, annee_construction: 1965, base_valeur: 'remplacement',
    });
    pemod.ajouterEtablissement(soumPe, cab.lastInsertRowid, adminId, {
      nom_lieu: 'Magasin', adresse: '4800 boul. Saint-Laurent, Montréal', occupation: 'Commerce de détail — pain et pâtisseries',
      chiffre_affaires: 450000, superficie: 120, annee_construction: 1965, base_valeur: 'remplacement',
    });
    pemod.ajouterEtablissement(soumPe, cab.lastInsertRowid, adminId, {
      nom_lieu: 'Entrepôt', adresse: '12 rue d’Iberville, Montréal', occupation: 'Entreposage',
      superficie: 300, base_valeur: 'depreciation',
    });
    pemod.definirGaranties(soumPe, cab.lastInsertRowid, adminId, {
      limite: 800000, periode_indemnite_mois: 12, franchise_jours: 3,
      base_montant: 'marge_brute', avenants: { frais_supplementaires: 1, deterioration_stocks: 1 }, prime: 2800.00,
    });
    pemod.definirAntecedents(soumPe, cab.lastInsertRowid, adminId, {
      assureur_actuel: 'Beneva', numero_police_actuelle: 'PE-2022-4410',
      date_expiration_actuelle: ajouterJours(40), annees_assurance_continue: 4,
      interruptions_5ans: [{ date: '2022-03-11', cause: 'Bris d’équipement (four)', duree_jours: 6, montant: 28000 }],
      consentements: {
        credit: { accepte: true, date: ajouterJours(0) },
      },
    });
    // --- Flotte démo (étape 1/10 flotte) : soumission flotte — Transport Lapointe inc., 4 véhicules, 3 conducteurs ---
    const flottemod = require('./lib/flotte');
    flottemod.semerSoumissionDemo(cab.lastInsertRowid, adminId);

    // --- Cautionnement démo (étape 1/10 cautionnement) : Construction Verdon inc., ligne 5 M$, 4 obligations ---
    const cautmod = require('./lib/cautionnement');
    cautmod.semerSoumissionDemo(cab.lastInsertRowid, adminId);
  });
  tx();

  console.log('Données de démonstration créées : Cabinet Démo, admin@demo.ca / ChangeMoi123!, 8 entreprises, 4 polices, 2 réclamations, 2 tâches, 3 factures, 5 leads, 1 réunion, 1 soumission auto FPQ1 (2 conducteurs, 2 véhicules), 1 soumission biens (2 bâtiments), 1 soumission RC (2 lieux d\'exploitation), 1 soumission cyber (4 mesures), 1 soumission E&O (3 activités), 1 soumission D&O (3 dirigeants), 1 soumission perte d\'exploitation (3 établissements), 1 soumission flotte (4 véhicules, 3 conducteurs), 1 soumission cautionnement (ligne 5 M$, 4 obligations).');
}

semer();
