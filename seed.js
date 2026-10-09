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
    const insererPolice = bd.prepare(`
      INSERT INTO polices (cabinet_id, client_id, ligne, assureur, numero_police, date_effet, date_echeance,
                           franchise, statut, responsable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `);
    const insererProt = bd.prepare(`
      INSERT INTO police_protections (police_id, code, libelle, prime) VALUES (?, ?, ?, ?)
    `);
    const libelleDe = (ligne, code) =>
      bd.prepare('SELECT libelle FROM catalogue_protections WHERE ligne = ? AND code = ?').get(ligne, code).libelle;

    // --- Entreprise 1 : Constructions Méthot inc. — CGL (J-25) + Biens (J-60) ---
    const methot = insererEntreprise.run(cab.lastInsertRowid, 'Constructions Méthot inc.', '1161234567', 'Construction',
      'Sylvain', 'Méthot', 'Président', 'sylvain.methot@constructionsmethot.ca', '514-555-0123',
      '1200 boulevard Industriel', 'Laval', 'H7L 4B2', 'FR', 'Entrepreneur général, 25 employés.', adminId).lastInsertRowid;
    const policeCgl = insererPolice.run(cab.lastInsertRowid, methot, 'cgl', 'Intact Assurance', 'CGL-2025-10001',
      ajouterJours(-340), ajouterJours(25), 2500, adminId).lastInsertRowid;
    // Note : pas de PREJ → sera détectée comme protection manquante (non recommandée toutefois)
    insererProt.run(policeCgl, 'RC-GEN', libelleDe('cgl', 'RC-GEN'), 2850.00);
    insererProt.run(policeCgl, 'PROD', libelleDe('cgl', 'PROD'), 640.00);
    const policeBiens = insererPolice.run(cab.lastInsertRowid, methot, 'biens', 'Beneva', 'BIEN-2024-20002',
      ajouterJours(-305), ajouterJours(60), 5000, adminId).lastInsertRowid;
    insererProt.run(policeBiens, 'BAT', libelleDe('biens', 'BAT'), 1200.00);
    insererProt.run(policeBiens, 'CONTENU', libelleDe('biens', 'CONTENU'), 840.00);
    // STOCK manquant → détecté comme manquant (recommandée)

    // --- Entreprise 2 : Resto Le Petit Four inc. — CGL (J-80) + 1 réclamation ---
    const petitFour = insererEntreprise.run(cab.lastInsertRowid, 'Resto Le Petit Four inc.', '1172345678', 'Restauration',
      'Chantal', 'Dubois', 'Propriétaire', 'chantal.dubois@petitfour.ca', '418-555-0145',
      '88 rue Saint-Jean', 'Québec', 'G1R 1N4', 'FR', 'Restaurant, salle de 60 places.', adminId).lastInsertRowid;
    const policeCglPf = insererPolice.run(cab.lastInsertRowid, petitFour, 'cgl', 'Desjardins Assurances', 'CGL-2024-30003',
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
    const policeFlotte = insererPolice.run(cab.lastInsertRowid, garage, 'flotte', 'Intact Assurance', 'FLT-2025-40004',
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
  });
  tx();

  console.log('Données de démonstration créées : Cabinet Démo, admin@demo.ca / ChangeMoi123!, 3 entreprises, 4 polices, 2 réclamations, 2 tâches, 3 factures, 5 leads, 1 réunion.');
}

semer();
