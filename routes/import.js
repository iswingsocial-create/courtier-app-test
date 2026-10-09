/**
 * routes/import.js — Import en lot d'entreprises, polices et protections via CSV.
 * Format (séparateur « ; », première ligne d'en-tête) :
 *   type;raison_sociale;neq;secteur_activite;prenom;nom;titre_contact;courriel;telephone;
 *   adresse;ville;code_postal;langue;produit;assureur;numero_police;date_effet;date_echeance;
 *   franchise;statut;protection_code;protection_libelle;prime
 * type = entreprise | police | protection
 * Un modèle téléchargeable est offert, avec rapport d'erreurs ligne par ligne.
 */
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, verifieCsrf, journal, estCourrielValide, estDateValide } = require('../lib/middleware');
const { NOMS_LIGNES } = require('./polices');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const PRODUITS = Object.keys(NOMS_LIGNES);

const televersement = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo
  fileFilter: (req, file, cb) => {
    const nom = (file.originalname || '').toLowerCase();
    cb(null, nom.endsWith('.csv') || file.mimetype.includes('csv') || file.mimetype.includes('text'));
  },
});

const ENTETE = ['type', 'raison_sociale', 'neq', 'secteur_activite', 'courriel_entreprise', 'telephone_entreprise',
  'chiffre_affaires', 'nb_employes', 'prenom', 'nom', 'titre_contact',
  'courriel', 'telephone', 'adresse', 'ville', 'code_postal', 'langue', 'produit', 'assureur',
  'numero_police', 'date_effet', 'date_echeance', 'franchise', 'statut',
  'protection_code', 'protection_libelle', 'prime'];

const EXEMPLES = [
  ['entreprise', 'Constructions Méthot inc.', '1161234567', 'Construction', 'info@constructionsmethot.ca', '450-555-0199', '5200000', '35', 'Sylvain', 'Méthot', 'Président', 'sylvain.methot@constructionsmethot.ca', '514-555-0123', '1200 boul. Industriel', 'Laval', 'H7L 4B2', 'FR', '', '', '', '', '', '', '', '', '', ''],
  ['police', 'Constructions Méthot inc.', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'cgl', 'Intact Assurance', 'CGL-2025-10001', '2025-06-01', '2026-06-01', '2500', 'active', '', '', ''],
  ['protection', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'CGL-2025-10001', '', '', '', '', 'RC-GEN', 'Responsabilité civile générale (2 000 000 $)', '2850.00'],
];

// --- Page d'import ---------------------------------------------------------------------------------
router.get('/', (req, res) => {
  res.render('import/index', { rapport: null, produits: PRODUITS, NOMS_LIGNES });
});

// --- Modèle téléchargeable ------------------------------------------------------------------------------
router.get('/modele', (req, res) => {
  const lignes = [ENTETE.join(';'), ...EXEMPLES.map((l) => l.join(';'))];
  const contenu = '﻿' + lignes.join('\r\n'); // BOM pour Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modele-import.csv"');
  res.send(contenu);
});

// --- Traitement du fichier -------------------------------------------------------------------------------
router.post('/', televersement.single('fichier'), verifieCsrf, (req, res) => {
  if (!req.file) {
    return res.status(400).render('import/index', { rapport: { erreurGlobale: 'Aucun fichier reçu (format CSV attendu).' }, produits: PRODUITS, NOMS_LIGNES });
  }

  let lignes;
  try {
    const texte = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const delim = (texte.split('\n')[0].match(/;/g) || []).length >= (texte.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    lignes = parse(texte, { columns: true, delimiter: delim, skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (e) {
    return res.status(400).render('import/index', { rapport: { erreurGlobale: 'Fichier illisible : ' + e.message }, produits: PRODUITS, NOMS_LIGNES });
  }

  const rapport = { total: lignes.length, crees: 0, erreurs: 0, details: [] };
  const cabinetId = res.locals.cabinetId;

  const reqEntParRaison = bd.prepare('SELECT id FROM clients WHERE cabinet_id = ? AND raison_sociale = ?');
  const reqEntParCourriel = bd.prepare('SELECT id FROM clients WHERE cabinet_id = ? AND courriel = ?');
  const reqPoliceParNumero = bd.prepare('SELECT id, ligne FROM polices WHERE cabinet_id = ? AND numero_police = ?');

  const inserer = bd.transaction((l, numeroLigne) => {
    const type = String(l.type || '').toLowerCase();
    if (type === 'entreprise' || type === 'client') return importerEntreprise(l, numeroLigne);
    if (type === 'police') return importerPolice(l, numeroLigne);
    if (type === 'protection') return importerProtection(l, numeroLigne);
    throw new Error(`type inconnu « ${l.type} » (attendu : entreprise, police ou protection)`);
  });

  function ok(numeroLigne, message) {
    rapport.crees += 1;
    rapport.details.push({ ligne: numeroLigne, statut: 'ok', message });
  }
  function ko(numeroLigne, message) {
    rapport.erreurs += 1;
    rapport.details.push({ ligne: numeroLigne, statut: 'erreur', message });
  }

  function importerEntreprise(l, numeroLigne) {
    const raison = (l.raison_sociale || '').trim();
    const prenom = (l.prenom || '').trim(), nom = (l.nom || '').trim();
    if (raison.length < 2) throw new Error('raison_sociale requise');
    if (!prenom || !nom) throw new Error('prénom et nom de la personne-contact requis');
    if (l.courriel && !estCourrielValide(l.courriel)) throw new Error('courriel invalide');
    const langue = (l.langue || 'FR').toUpperCase();
    if (!['FR', 'EN'].includes(langue)) throw new Error('langue invalide (FR/EN)');
    const neq = (l.neq || '').replace(/\s/g, '');
    if (neq && !/^\d{10}$/.test(neq)) throw new Error('neq invalide (10 chiffres)');
    const ca = l.chiffre_affaires ? Number(l.chiffre_affaires) : null;
    if (l.chiffre_affaires && (isNaN(ca) || ca < 0)) throw new Error('chiffre_affaires invalide');
    const nbEmp = l.nb_employes ? Number(l.nb_employes) : null;
    if (l.nb_employes && (!Number.isInteger(nbEmp) || nbEmp < 0)) throw new Error('nb_employes invalide');
    if (l.courriel_entreprise && !estCourrielValide(l.courriel_entreprise)) throw new Error('courriel_entreprise invalide');
    const r = bd.prepare(`
      INSERT INTO clients (cabinet_id, raison_sociale, neq, secteur_activite,
                           courriel_entreprise, telephone_entreprise, chiffre_affaires, nb_employes,
                           prenom, nom, titre_contact,
                           courriel, telephone, adresse, ville, code_postal, langue)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cabinetId, raison, neq || null, (l.secteur_activite || '').trim() || null,
      (l.courriel_entreprise || '').trim() || null, (l.telephone_entreprise || '').trim() || null, ca, nbEmp,
      prenom, nom, (l.titre_contact || '').trim() || null,
      l.courriel || null, l.telephone || null, l.adresse || null,
      l.ville || null, l.code_postal || null, langue);
    bd.prepare(`
      INSERT INTO contacts (cabinet_id, client_id, prenom, nom, titre, courriel, telephone, principal)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(cabinetId, r.lastInsertRowid, prenom, nom,
      (l.titre_contact || '').trim() || null, l.courriel || null, l.telephone || null);
    ok(numeroLigne, `Entreprise ${raison} créée`);
    return r.lastInsertRowid;
  }

  function trouverEntreprise(l) {
    if (l.raison_sociale) {
      const c = reqEntParRaison.get(cabinetId, l.raison_sociale.trim());
      if (c) return c.id;
    }
    if (l.courriel) {
      const c = reqEntParCourriel.get(cabinetId, l.courriel.trim().toLowerCase());
      if (c) return c.id;
    }
    return null;
  }

  function importerPolice(l, numeroLigne) {
    const clientId = trouverEntreprise(l);
    if (!clientId) throw new Error('entreprise introuvable (raison_sociale ou courriel)');
    const produit = (l.produit || l.ligne || '').toLowerCase();
    if (!PRODUITS.includes(produit)) throw new Error(`produit invalide (${PRODUITS.join('/')})`);
    if (!l.assureur || !l.numero_police) throw new Error('assureur et numero_police requis');
    if (!estDateValide(l.date_effet) || !estDateValide(l.date_echeance)) throw new Error('dates invalides (AAAA-MM-JJ)');
    const statut = (l.statut || 'active').toLowerCase();
    if (!['active', 'a_renouveler', 'resiliee'].includes(statut)) throw new Error('statut invalide');
    const franchise = l.franchise === '' || l.franchise == null ? 0 : Number(l.franchise);
    if (isNaN(franchise)) throw new Error('franchise invalide');
    const nomAssureur = l.assureur.trim();
    let ficheAss = bd.prepare('SELECT id FROM assureurs WHERE cabinet_id = ? AND lower(nom) = lower(?)').get(cabinetId, nomAssureur);
    if (!ficheAss) {
      ficheAss = { id: bd.prepare('INSERT INTO assureurs (cabinet_id, nom) VALUES (?, ?)').run(cabinetId, nomAssureur).lastInsertRowid };
    }
    try {
      const r = bd.prepare(`
        INSERT INTO polices (cabinet_id, client_id, ligne, assureur, assureur_id, numero_police, date_effet, date_echeance, franchise, statut)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cabinetId, clientId, produit, nomAssureur, ficheAss.id, l.numero_police.trim(), l.date_effet, l.date_echeance, franchise, statut);
      ok(numeroLigne, `Police ${l.numero_police} créée`);
      return r.lastInsertRowid;
    } catch (e) {
      if (e.message.includes('UNIQUE')) throw new Error(`numero_police « ${l.numero_police} » déjà utilisé`);
      throw e;
    }
  }

  function importerProtection(l, numeroLigne) {
    if (!l.numero_police) throw new Error('numero_police requis');
    const police = reqPoliceParNumero.get(cabinetId, l.numero_police.trim());
    if (!police) throw new Error(`police « ${l.numero_police} » introuvable`);
    const code = (l.protection_code || '').trim().toUpperCase();
    if (!code) throw new Error('protection_code requis');
    const prime = Number(l.prime);
    if (isNaN(prime) || prime < 0) throw new Error('prime invalide');
    const cat = bd.prepare('SELECT libelle FROM catalogue_protections WHERE ligne = ? AND code = ?').get(police.ligne, code);
    const libelle = cat ? cat.libelle : (l.protection_libelle || code);
    try {
      bd.prepare('INSERT INTO police_protections (police_id, code, libelle, prime) VALUES (?, ?, ?, ?)')
        .run(police.id, code, libelle, prime);
      ok(numeroLigne, `Protection ${code} ajoutée à ${l.numero_police}`);
    } catch (e) {
      if (e.message.includes('UNIQUE')) throw new Error(`protection ${code} déjà présente sur ${l.numero_police}`);
      throw e;
    }
  }

  lignes.forEach((l, i) => {
    const numeroLigne = i + 2; // +1 en-tête, +1 index base 1
    try { inserer(l, numeroLigne); }
    catch (e) { ko(numeroLigne, e.message); }
  });

  journal(cabinetId, req.utilisateur.id, 'import_csv',
    `Import : ${rapport.crees} créés, ${rapport.erreurs} erreurs sur ${rapport.total} lignes`);
  res.render('import/index', { rapport, produits: PRODUITS, NOMS_LIGNES });
}, (err, req, res, next) => {
  res.status(400).render('import/index', { rapport: { erreurGlobale: 'Téléversement refusé : ' + err.message }, produits: PRODUITS, NOMS_LIGNES });
});

module.exports = router;
