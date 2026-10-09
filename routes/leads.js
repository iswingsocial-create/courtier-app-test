/**
 * routes/leads.js — Module Leads : prospects issus des campagnes publicitaires.
 * Pipeline de suivi (nouveau → contacté → qualifié → soumission → client/perdu),
 * historique de suivi, conversion en entreprise, statistiques par campagne.
 * Un lead n'est PAS encore un client : leads.client_id reste NULL jusqu'à
 * la conversion (principe « tout relié au client », avec justification).
 * Cloisonnement par cabinet_id sur toutes les requêtes.
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, journal, estCourrielValide, estCourtier } = require('../lib/middleware');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const STATUTS = ['nouveau', 'contacte', 'qualifie', 'soumission', 'client', 'perdu'];
const NOMS_STATUTS_LEAD = {
  nouveau: 'Nouveau',
  contacte: 'Contacté',
  qualifie: 'Qualifié',
  soumission: 'Soumission',
  client: 'Devenu client',
  perdu: 'Perdu',
};
const SOURCES = ['facebook_ads', 'google_ads', 'site_web', 'reference', 'salon', 'autre'];
const NOMS_SOURCES = {
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  site_web: 'Site web',
  reference: 'Référence',
  salon: 'Salon / événement',
  autre: 'Autre',
};

function leadDuCabinet(id, cabinetId) {
  return bd.prepare(`
    SELECT l.*, u.nom AS responsable_nom, c.raison_sociale AS entreprise_liee
    FROM leads l
    LEFT JOIN users u ON u.id = l.responsable_id
    LEFT JOIN clients c ON c.id = l.client_id
    WHERE l.id = ? AND l.cabinet_id = ?
  `).get(id, cabinetId);
}

function utilisateursCabinet(cabinetId) {
  return bd.prepare('SELECT id, nom, role FROM users WHERE cabinet_id = ? ORDER BY nom').all(cabinetId);
}

function validerLead(corps, publicCapture) {
  const erreurs = [];
  if (!corps.nom || corps.nom.trim().length < 2) erreurs.push('Le nom est requis.');
  if (corps.courriel && !estCourrielValide(corps.courriel)) erreurs.push('Courriel invalide.');
  if (!corps.courriel && !corps.telephone) erreurs.push('Un courriel ou un téléphone est requis pour recontacter le prospect.');
  if (corps.source && !SOURCES.includes(corps.source)) erreurs.push('Source invalide.');
  if (corps.statut && !STATUTS.includes(corps.statut)) erreurs.push('Statut invalide.');
  if (corps.date_rappel && !/^\d{4}-\d{2}-\d{2}$/.test(corps.date_rappel)) erreurs.push('Date de rappel invalide.');
  return erreurs;
}

// --- Pipeline (liste groupée par statut) -------------------------------------------------------
router.get('/', (req, res) => {
  const voirArchives = req.query.archives === '1';
  const groupes = {};
  for (const s of STATUTS) {
    groupes[s] = bd.prepare(`
      SELECT l.*, u.nom AS responsable_nom FROM leads l
      LEFT JOIN users u ON u.id = l.responsable_id
      WHERE l.cabinet_id = ? AND l.statut = ? AND l.archive = ${voirArchives ? '1' : '0'} ORDER BY l.cree_le DESC
    `).all(res.locals.cabinetId, s);
  }
  const nbRappels = bd.prepare(`
    SELECT COUNT(*) AS n FROM leads
    WHERE cabinet_id = ? AND statut NOT IN ('client','perdu')
      AND date_rappel IS NOT NULL AND date_rappel < date('now')
  `).get(res.locals.cabinetId).n;
  res.render('leads/liste', { groupes, STATUTS, NOMS_STATUTS_LEAD, NOMS_SOURCES, nbRappels, voirArchives });
});

// --- Statistiques par campagne -------------------------------------------------------------------
router.get('/stats', (req, res) => {
  const stats = bd.prepare(`
    SELECT COALESCE(NULLIF(campagne, ''), '(sans campagne)') AS campagne,
           COALESCE(source, 'autre') AS source,
           COUNT(*) AS nb,
           SUM(CASE WHEN statut = 'client' THEN 1 ELSE 0 END) AS nb_clients
    FROM leads WHERE cabinet_id = ?
    GROUP BY campagne, source ORDER BY nb DESC
  `).all(res.locals.cabinetId);
  res.render('leads/stats', { stats, NOMS_SOURCES });
});

// --- Nouveau lead (manuel) --------------------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  res.render('leads/formulaire', {
    erreur: null, lead: { statut: 'nouveau' },
    utilisateurs: utilisateursCabinet(res.locals.cabinetId),
    STATUTS, NOMS_STATUTS_LEAD, SOURCES, NOMS_SOURCES,
  });
});

router.post('/', (req, res) => {
  const erreurs = validerLead(req.body);
  const responsableId = req.body.responsable_id ? Number(req.body.responsable_id) : null;
  if (responsableId && !bd.prepare('SELECT id FROM users WHERE id = ? AND cabinet_id = ?').get(responsableId, res.locals.cabinetId)) {
    erreurs.push('Responsable invalide.');
  }
  if (erreurs.length) {
    return res.status(400).render('leads/formulaire', {
      erreur: erreurs.join(' '), lead: req.body,
      utilisateurs: utilisateursCabinet(res.locals.cabinetId),
      STATUTS, NOMS_STATUTS_LEAD, SOURCES, NOMS_SOURCES,
    });
  }
  const r = bd.prepare(`
    INSERT INTO leads (cabinet_id, nom, entreprise, courriel, telephone, besoin, source, campagne,
      utm_source, utm_medium, utm_campaign, statut, responsable_id, date_rappel, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, req.body.nom.trim(),
    (req.body.entreprise || '').trim() || null, (req.body.courriel || '').trim() || null,
    (req.body.telephone || '').trim() || null, (req.body.besoin || '').trim() || null,
    req.body.source || 'autre', (req.body.campagne || '').trim() || null,
    (req.body.utm_source || '').trim() || null, (req.body.utm_medium || '').trim() || null,
    (req.body.utm_campaign || '').trim() || null, req.body.statut || 'nouveau',
    responsableId, req.body.date_rappel || null, (req.body.notes || '').trim() || null);
  journal(res.locals.cabinetId, req.utilisateur.id, 'lead_cree', `Lead id ${r.lastInsertRowid} (${req.body.nom.trim()})`);
  res.redirect('/leads/' + r.lastInsertRowid);
});

// --- Fiche --------------------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const lead = leadDuCabinet(req.params.id, res.locals.cabinetId);
  if (!lead) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Lead introuvable.' });
  const suivis = bd.prepare(`
    SELECT s.*, u.nom AS auteur FROM lead_suivis s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.lead_id = ? ORDER BY s.cree_le DESC
  `).all(lead.id);
  res.render('leads/fiche', {
    lead, suivis, STATUTS, NOMS_STATUTS_LEAD, NOMS_SOURCES,
    utilisateurs: utilisateursCabinet(res.locals.cabinetId),
    mSuivi: req.query.suivi === 'ok', mConverti: req.query.converti === 'ok',
  });
});

// --- Changement de statut ----------------------------------------------------------------------------
router.post('/:id/statut', (req, res) => {
  const lead = leadDuCabinet(req.params.id, res.locals.cabinetId);
  if (!lead) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Lead introuvable.' });
  const statut = String(req.body.statut || '');
  if (!STATUTS.includes(statut)) {
    return res.status(400).render('erreur', { titre: 'Statut invalide', message: 'Le statut demandé est invalide.' });
  }
  bd.prepare('UPDATE leads SET statut = ? WHERE id = ? AND cabinet_id = ?').run(statut, lead.id, res.locals.cabinetId);
  bd.prepare('INSERT INTO lead_suivis (lead_id, user_id, texte) VALUES (?, ?, ?)')
    .run(lead.id, req.utilisateur.id, `Statut changé : ${NOMS_STATUTS_LEAD[lead.statut]} → ${NOMS_STATUTS_LEAD[statut]}.`);
  journal(res.locals.cabinetId, req.utilisateur.id, 'lead_statut', `Lead id ${lead.id} → ${statut}`);
  res.redirect('/leads/' + lead.id);
});

// --- Ajouter un suivi -----------------------------------------------------------------------------------
router.post('/:id/suivis', (req, res) => {
  const lead = leadDuCabinet(req.params.id, res.locals.cabinetId);
  if (!lead) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Lead introuvable.' });
  const texte = String(req.body.texte || '').trim();
  if (texte.length < 2) {
    return res.status(400).render('erreur', { titre: 'Texte requis', message: 'Le texte du suivi est requis.' });
  }
  bd.prepare('INSERT INTO lead_suivis (lead_id, user_id, texte) VALUES (?, ?, ?)')
    .run(lead.id, req.utilisateur.id, texte.slice(0, 2000));
  journal(res.locals.cabinetId, req.utilisateur.id, 'lead_suivi', `Suivi ajouté au lead id ${lead.id}`);
  res.redirect('/leads/' + lead.id + '?suivi=ok');
});

// --- Convertir en entreprise -------------------------------------------------------------------------------
router.post('/:id/convertir', (req, res) => {
  const lead = leadDuCabinet(req.params.id, res.locals.cabinetId);
  if (!lead) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Lead introuvable.' });
  if (lead.client_id) {
    return res.redirect('/clients/' + lead.client_id + '?converti=ok');
  }
  const raisonSociale = (lead.entreprise || '').trim() || lead.nom.trim();
  const parties = lead.nom.trim().split(/\s+/);
  const prenom = parties[0] || '';
  const nom = parties.slice(1).join(' ') || prenom;
  const r = bd.prepare(`
    INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel, telephone, notes, responsable_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, raisonSociale, prenom, nom,
    lead.courriel, lead.telephone,
    `Converti du lead #${lead.id} (source : ${NOMS_SOURCES[lead.source] || lead.source}${lead.campagne ? `, campagne « ${lead.campagne} »` : ''}). Besoin exprimé : ${lead.besoin || '—'}`,
    lead.responsable_id || (estCourtier(req) ? req.utilisateur.id : null));
  bd.prepare("UPDATE leads SET client_id = ?, statut = 'client' WHERE id = ? AND cabinet_id = ?")
    .run(r.lastInsertRowid, lead.id, res.locals.cabinetId);
  bd.prepare('INSERT INTO lead_suivis (lead_id, user_id, texte) VALUES (?, ?, ?)')
    .run(lead.id, req.utilisateur.id, `Converti en entreprise : ${raisonSociale} (fiche #${r.lastInsertRowid}).`);
  journal(res.locals.cabinetId, req.utilisateur.id, 'lead_converti', `Lead id ${lead.id} → entreprise id ${r.lastInsertRowid}`);
  res.redirect('/clients/' + r.lastInsertRowid + '?converti=ok');
});

// --- Archiver / désarchiver (règle d'or : rien ne se supprime) -------------------------------------
router.post('/:id/archiver', (req, res) => {
  const lead = leadDuCabinet(req.params.id, res.locals.cabinetId);
  if (!lead) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Lead introuvable.' });
  bd.prepare('UPDATE leads SET archive = 1 WHERE id = ? AND cabinet_id = ?').run(lead.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'lead_archive', `Lead id ${lead.id}`);
  res.redirect('/leads');
});

router.post('/:id/desarchiver', (req, res) => {
  const lead = leadDuCabinet(req.params.id, res.locals.cabinetId);
  if (!lead) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Lead introuvable.' });
  bd.prepare('UPDATE leads SET archive = 0 WHERE id = ? AND cabinet_id = ?').run(lead.id, res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'lead_desarchive', `Lead id ${lead.id}`);
  res.redirect('/leads/' + lead.id);
});

module.exports = router;
module.exports.STATUTS_LEAD = STATUTS;
module.exports.NOMS_STATUTS_LEAD = NOMS_STATUTS_LEAD;
module.exports.SOURCES_LEAD = SOURCES;
module.exports.NOMS_SOURCES_LEAD = NOMS_SOURCES;
module.exports.validerLead = validerLead;
