/**
 * routes/assureurs.js — Fiches assureurs : coordonnées générales, contacts
 * nouvelle affaire, contacts modifications/avenants, comptabilité,
 * produits offerts + taux de commission par produit, statistiques
 * (polices, volume de primes, commissions estimées) calculées selon le rôle.
 * Les polices sont reliées aux fiches (polices.assureur_id).
 * Cloisonnement par cabinet_id ; archivage (règle d'or), jamais de suppression.
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, journal, estCourrielValide } = require('../lib/middleware');
const { NOMS_LIGNES } = require('./polices');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const LIGNES = Object.keys(NOMS_LIGNES);

function assureurDuCabinet(id, cabinetId) {
  return bd.prepare('SELECT * FROM assureurs WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
}

function produitsAssureur(assureurId) {
  return bd.prepare('SELECT produit, commission_pct FROM assureur_produits WHERE assureur_id = ? ORDER BY produit')
    .all(assureurId);
}

function validerAssureur(corps, cabinetId, exclureId) {
  const erreurs = [];
  if (!corps.nom || corps.nom.trim().length < 2) erreurs.push('Le nom de l’assureur est requis.');
  if (!estCourrielValide(corps.courriel_general)) erreurs.push('Courriel général invalide.');
  if (!estCourrielValide(corps.na_courriel)) erreurs.push('Courriel (nouvelle affaire) invalide.');
  if (!estCourrielValide(corps.mod_courriel)) erreurs.push('Courriel (modifications) invalide.');
  if (!estCourrielValide(corps.compta_courriel)) erreurs.push('Courriel (comptabilité) invalide.');
  const nom = corps.nom.trim();
  const doublon = bd.prepare(
    'SELECT id FROM assureurs WHERE cabinet_id = ? AND lower(nom) = lower(?) AND id != ?'
  ).get(cabinetId, nom, exclureId || -1);
  if (doublon) erreurs.push('Un assureur porte déjà ce nom.');
  // Taux de commission : nombres positifs uniquement, seulement pour les produits cochés
  for (const ligne of LIGNES) {
    const brut = (corps['commission_' + ligne] || '').trim();
    if (brut !== '' && !(Number(brut) >= 0 && Number(brut) <= 100)) {
      erreurs.push(`Taux de commission invalide pour « ${NOMS_LIGNES[ligne]} » (0 à 100 %).`);
    }
  }
  return erreurs;
}

function corpsAssureur(corps) {
  const v = (x) => (x || '').trim() || null;
  return {
    nom: v(corps.nom),
    site_web: v(corps.site_web),
    telephone_general: v(corps.telephone_general),
    courriel_general: v(corps.courriel_general),
    na_nom: v(corps.na_nom),
    na_telephone: v(corps.na_telephone),
    na_courriel: v(corps.na_courriel),
    mod_nom: v(corps.mod_nom),
    mod_telephone: v(corps.mod_telephone),
    mod_courriel: v(corps.mod_courriel),
    compta_nom: v(corps.compta_nom),
    compta_telephone: v(corps.compta_telephone),
    compta_courriel: v(corps.compta_courriel),
    notes: v(corps.notes),
  };
}

// Produits cochés dans le formulaire → { produit: commission_pct|null }
function produitsDuFormulaire(corps) {
  let coches = corps.produits;
  if (!coches) coches = [];
  else if (!Array.isArray(coches)) coches = [coches];
  const resultat = {};
  for (const ligne of LIGNES) {
    if (coches.includes(ligne)) {
      const brut = (corps['commission_' + ligne] || '').trim();
      resultat[ligne] = brut === '' ? null : Number(brut);
    }
  }
  return resultat;
}

function enregistrerProduits(assureurId, produits) {
  const tx = bd.transaction(() => {
    bd.prepare('DELETE FROM assureur_produits WHERE assureur_id = ?').run(assureurId);
    const ins = bd.prepare('INSERT INTO assureur_produits (assureur_id, produit, commission_pct) VALUES (?, ?, ?)');
    for (const [produit, taux] of Object.entries(produits)) {
      ins.run(assureurId, produit, taux);
    }
  });
  tx();
}

// --- Portée des statistiques selon le rôle -------------------------------------------
// admin : tout le cabinet ; courtier : ses entreprises (responsable_id, même base que
// clausePortefeuille) ; manager : son équipe (lui-même + users rattachés via manager_id).
function porteeStats(req) {
  const u = req.utilisateur;
  if (u.role === 'courtier') {
    return { clause: ' AND c.responsable_id = ?', params: [u.id], libelle: 'votre portefeuille' };
  }
  if (u.role === 'manager') {
    const equipe = bd.prepare('SELECT id FROM users WHERE cabinet_id = ? AND (id = ? OR manager_id = ?)')
      .all(u.cabinet_id, u.id, u.id).map((r) => Number(r.id));
    const trous = equipe.map(() => '?').join(',');
    return { clause: ` AND c.responsable_id IN (${trous})`, params: equipe, libelle: 'votre équipe' };
  }
  return { clause: '', params: [], libelle: 'tout le cabinet' };
}

function statsAssureur(req, cabinetId, assureurId) {
  const portee = porteeStats(req);
  const polices = bd.prepare(`
    SELECT p.id, p.ligne,
           (SELECT COALESCE(SUM(prime), 0) FROM police_protections pp WHERE pp.police_id = p.id) AS prime_totale
    FROM polices p JOIN clients c ON c.id = p.client_id
    WHERE p.cabinet_id = ? AND p.assureur_id = ? AND p.statut IN ('active', 'a_renouveler')
      AND c.archive = 0${portee.clause}
  `).all(cabinetId, assureurId, ...portee.params);
  const taux = {};
  for (const r of produitsAssureur(assureurId)) taux[r.produit] = r.commission_pct;
  let volume = 0;
  let commissions = 0;
  let sansTaux = 0;
  for (const p of polices) {
    volume += p.prime_totale;
    if (taux[p.ligne] != null) commissions += (p.prime_totale * taux[p.ligne]) / 100;
    else if (p.prime_totale > 0) sansTaux += 1;
  }
  return {
    nbPolices: polices.length,
    volumePrimes: Math.round(volume * 100) / 100,
    commissionsEstimees: Math.round(commissions * 100) / 100,
    policesSansTaux: sansTaux,
    portee: portee.libelle,
  };
}

// --- Liste ----------------------------------------------------------------------------------
router.get('/', (req, res) => {
  const voirArchives = req.query.archives === '1';
  const assureurs = bd.prepare(`
    SELECT a.* FROM assureurs a
    WHERE a.cabinet_id = ? AND a.archive = ${voirArchives ? '1' : '0'}
    ORDER BY a.nom
  `).all(res.locals.cabinetId);
  res.render('assureurs/liste', { assureurs, voirArchives });
});

// --- Nouveau --------------------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  res.render('assureurs/formulaire', { erreur: null, assureur: null, produits: {}, LIGNES, NOMS_LIGNES });
});

router.post('/', (req, res) => {
  const erreurs = validerAssureur(req.body, res.locals.cabinetId, null);
  const produits = produitsDuFormulaire(req.body);
  if (erreurs.length) {
    return res.status(400).render('assureurs/formulaire',
      { erreur: erreurs.join(' '), assureur: req.body, produits, LIGNES, NOMS_LIGNES });
  }
  const a = corpsAssureur(req.body);
  const r = bd.prepare(`
    INSERT INTO assureurs (cabinet_id, nom, site_web, telephone_general, courriel_general,
                           na_nom, na_telephone, na_courriel, mod_nom, mod_telephone, mod_courriel,
                           compta_nom, compta_telephone, compta_courriel, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, a.nom, a.site_web, a.telephone_general, a.courriel_general,
    a.na_nom, a.na_telephone, a.na_courriel, a.mod_nom, a.mod_telephone, a.mod_courriel,
    a.compta_nom, a.compta_telephone, a.compta_courriel, a.notes);
  enregistrerProduits(r.lastInsertRowid, produits);
  journal(res.locals.cabinetId, req.utilisateur.id, 'assureur_cree', `Assureur ${a.nom} (id ${r.lastInsertRowid})`);
  res.redirect('/assureurs/' + r.lastInsertRowid);
});

// --- Fiche ----------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const assureur = assureurDuCabinet(req.params.id, res.locals.cabinetId);
  if (!assureur) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Assureur introuvable.' });
  const portee = porteeStats(req);
  const polices = bd.prepare(`
    SELECT p.*, c.raison_sociale FROM polices p
    JOIN clients c ON c.id = p.client_id
    WHERE p.cabinet_id = ? AND p.assureur_id = ? AND p.statut IN ('active', 'a_renouveler')
      AND c.archive = 0${portee.clause}
    ORDER BY c.raison_sociale, p.numero_police
  `).all(res.locals.cabinetId, assureur.id, ...portee.params);
  const produits = produitsAssureur(assureur.id);
  const stats = statsAssureur(req, res.locals.cabinetId, assureur.id);
  res.render('assureurs/fiche', { assureur, polices, produits, stats, NOMS_LIGNES });
});

// --- Modifier -------------------------------------------------------------------------------
router.get('/:id/modifier', (req, res) => {
  const assureur = assureurDuCabinet(req.params.id, res.locals.cabinetId);
  if (!assureur) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Assureur introuvable.' });
  const produits = {};
  for (const r of produitsAssureur(assureur.id)) produits[r.produit] = r.commission_pct;
  res.render('assureurs/formulaire', { erreur: null, assureur, produits, LIGNES, NOMS_LIGNES });
});

router.post('/:id', (req, res) => {
  const assureur = assureurDuCabinet(req.params.id, res.locals.cabinetId);
  if (!assureur) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Assureur introuvable.' });
  const erreurs = validerAssureur(req.body, res.locals.cabinetId, assureur.id);
  const produits = produitsDuFormulaire(req.body);
  if (erreurs.length) {
    return res.status(400).render('assureurs/formulaire',
      { erreur: erreurs.join(' '), assureur: { ...assureur, ...req.body }, produits, LIGNES, NOMS_LIGNES });
  }
  const a = corpsAssureur(req.body);
  bd.prepare(`
    UPDATE assureurs SET nom = ?, site_web = ?, telephone_general = ?, courriel_general = ?,
                        na_nom = ?, na_telephone = ?, na_courriel = ?,
                        mod_nom = ?, mod_telephone = ?, mod_courriel = ?,
                        compta_nom = ?, compta_telephone = ?, compta_courriel = ?, notes = ?
    WHERE id = ? AND cabinet_id = ?
  `).run(a.nom, a.site_web, a.telephone_general, a.courriel_general,
    a.na_nom, a.na_telephone, a.na_courriel, a.mod_nom, a.mod_telephone, a.mod_courriel,
    a.compta_nom, a.compta_telephone, a.compta_courriel, a.notes,
    assureur.id, res.locals.cabinetId);
  enregistrerProduits(assureur.id, produits);
  // Garder le nom synchronisé sur les polices liées (affichage historique)
  bd.prepare('UPDATE polices SET assureur = ? WHERE assureur_id = ?').run(a.nom, assureur.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'assureur_modifie', `Assureur ${a.nom} (id ${assureur.id})`);
  res.redirect('/assureurs/' + assureur.id);
});

// --- Archiver / désarchiver (règle d'or : jamais de suppression) ------------------------------
router.post('/:id/archiver', (req, res) => {
  const assureur = assureurDuCabinet(req.params.id, res.locals.cabinetId);
  if (!assureur) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Assureur introuvable.' });
  const nb = bd.prepare(`SELECT COUNT(*) AS n FROM polices WHERE assureur_id = ? AND statut IN ('active', 'a_renouveler')`).get(assureur.id).n;
  if (nb > 0) {
    return res.status(400).render('erreur', { titre: 'Action refusée', message: `Cet assureur a encore ${nb} police(s) active(s) reliée(s). Réassignez d’abord ces polices.` });
  }
  bd.prepare('UPDATE assureurs SET archive = 1 WHERE id = ?').run(assureur.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'assureur_archive', `Assureur ${assureur.nom} (id ${assureur.id})`);
  res.redirect('/assureurs');
});

router.post('/:id/desarchiver', (req, res) => {
  const assureur = assureurDuCabinet(req.params.id, res.locals.cabinetId);
  if (!assureur) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Assureur introuvable.' });
  bd.prepare('UPDATE assureurs SET archive = 0 WHERE id = ?').run(assureur.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'assureur_desarchive', `Assureur ${assureur.nom} (id ${assureur.id})`);
  res.redirect('/assureurs/' + assureur.id);
});

module.exports = router;
module.exports.porteeStats = porteeStats;
module.exports.statsAssureur = statsAssureur;
