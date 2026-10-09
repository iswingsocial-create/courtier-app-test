/**
 * routes/courriels.js — Messagerie intégrée (réception IMAP, envoi SMTP).
 * Les mots de passe sont chiffrés en base (lib/chiffrement.js).
 * Règle d'or : les comptes et courriels s'archivent, jamais supprimés.
 */
const express = require('express');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, exigeRole, journal, estCourrielValide, echapperHtml } = require('../lib/middleware');
const {
  PRECONFIGS, chiffrerMotDePasse, assainirHtml, synchroniserCompte,
  synchroniserTousLesComptes, testerCompte, envoyerCourriel,
} = require('../lib/courriels');
const { genererCourrielLibre } = require('../lib/ia');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

// Délai de sécurité pour les opérations réseau (évite les requêtes pendantes)
function avecDelai(promesse, ms, message) {
  return Promise.race([
    promesse,
    new Promise((_, rej) => setTimeout(() => rej(new Error(message || 'Délai dépassé (30 s)')), ms)),
  ]);
}

function compteDuCabinet(id, cabinetId) {
  return bd.prepare('SELECT * FROM courriel_comptes WHERE id = ? AND cabinet_id = ?').get(id, cabinetId);
}

// --- Boîte de réception -----------------------------------------------------------------
router.get('/', (req, res) => {
  const dossier = 'reception';
  const q = (req.query.q || '').trim();
  const nonLus = req.query.nonlus === '1';
  const voirArchives = req.query.archives === '1';
  const clientId = req.query.client_id || '';
  let sql = `
    SELECT c.*, cl.raison_sociale AS client_raison_sociale,
           cc.nom AS compte_nom
    FROM courriels c
    LEFT JOIN clients cl ON cl.id = c.client_id
    LEFT JOIN courriel_comptes cc ON cc.id = c.compte_id
    WHERE c.cabinet_id = ? AND c.dossier = 'reception' AND c.archive = ${voirArchives ? '1' : '0'}`;
  const params = [res.locals.cabinetId];
  if (nonLus) sql += ' AND c.lu = 0';
  if (clientId) { sql += ' AND c.client_id = ?'; params.push(clientId); }
  if (q) { sql += ' AND (c.sujet LIKE ? OR c.expediteur LIKE ? OR c.corps_texte LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY c.cree_le DESC LIMIT 200';
  const courriels = bd.prepare(sql).all(...params);
  const comptes = bd.prepare('SELECT id, nom FROM courriel_comptes WHERE cabinet_id = ? AND archive = 0').all(res.locals.cabinetId);
  res.render('courriels/liste', { titre: 'Courriels reçus', courriels, comptes, q, nonLus, voirArchives, clientId, dossier, synchro: req.query.synchro || '' });
});

// --- Envoyés -----------------------------------------------------------------------------
router.get('/envoyes', (req, res) => {
  const voirArchives = req.query.archives === '1';
  const courriels = bd.prepare(`
    SELECT c.*, cl.raison_sociale AS client_raison_sociale, cc.nom AS compte_nom
    FROM courriels c
    LEFT JOIN clients cl ON cl.id = c.client_id
    LEFT JOIN courriel_comptes cc ON cc.id = c.compte_id
    WHERE c.cabinet_id = ? AND c.dossier = 'envoyes' AND c.archive = ${voirArchives ? '1' : '0'}
    ORDER BY c.cree_le DESC LIMIT 200
  `).all(res.locals.cabinetId);
  res.render('courriels/liste', { titre: 'Courriels envoyés', courriels, comptes: [], q: '', nonLus: false, voirArchives, clientId: '', dossier: 'envoyes' });
});

// --- Comptes : liste -----------------------------------------------------------------------
router.get('/comptes', (req, res) => {
  const voirArchives = req.query.archives === '1';
  const comptes = bd.prepare(`
    SELECT *, (SELECT COUNT(*) FROM courriels WHERE compte_id = courriel_comptes.id) AS nb_courriels
    FROM courriel_comptes WHERE cabinet_id = ? AND archive = ${voirArchives ? '1' : '0'}
    ORDER BY nom
  `).all(res.locals.cabinetId);
  res.render('courriels/comptes', { comptes, voirArchives });
});

// --- Comptes : formulaire --------------------------------------------------------------------
router.get('/comptes/nouveau', exigeRole('admin'), (req, res) => {
  res.render('courriels/compte-form', { compte: null, preconfigs: PRECONFIGS, erreurs: [], valeurs: {} });
});

function validerCompteFormulaire(body) {
  const erreurs = [];
  const v = {
    nom: (body.nom || '').trim(),
    adresse: (body.adresse || '').trim(),
    preconfig: body.preconfig || 'autre',
    imap_hote: (body.imap_hote || '').trim(),
    imap_port: parseInt(body.imap_port, 10) || 993,
    imap_tls: body.imap_tls === '1' ? 1 : 0,
    smtp_hote: (body.smtp_hote || '').trim(),
    smtp_port: parseInt(body.smtp_port, 10) || 587,
    smtp_tls: body.smtp_tls === '1' ? 1 : 0,
    utilisateur: (body.utilisateur || '').trim(),
    mot_de_passe: body.mot_de_passe || '',
  };
  if (!v.nom) erreurs.push('Le nom du compte est requis.');
  if (!estCourrielValide(v.adresse) || !v.adresse) erreurs.push('L’adresse courriel est invalide.');
  if (!v.imap_hote) erreurs.push('Le serveur IMAP est requis.');
  if (!v.smtp_hote) erreurs.push('Le serveur SMTP est requis.');
  if (!v.utilisateur) erreurs.push('Le nom d’utilisateur est requis.');
  return { v, erreurs };
}

router.post('/comptes', exigeRole('admin'), (req, res) => {
  const { v, erreurs } = validerCompteFormulaire(req.body);
  if (!v.mot_de_passe) erreurs.push('Le mot de passe est requis.');
  if (erreurs.length) {
    return res.status(400).render('courriels/compte-form', { compte: null, preconfigs: PRECONFIGS, erreurs, valeurs: v });
  }
  const r = bd.prepare(`
    INSERT INTO courriel_comptes (cabinet_id, nom, adresse, imap_hote, imap_port, imap_tls,
      smtp_hote, smtp_port, smtp_tls, utilisateur, mot_de_passe_chiffre)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(res.locals.cabinetId, v.nom, v.adresse, v.imap_hote, v.imap_port, v.imap_tls,
    v.smtp_hote, v.smtp_port, v.smtp_tls, v.utilisateur, chiffrerMotDePasse(v.mot_de_passe));
  journal(res.locals.cabinetId, req.utilisateur.id, 'courriel_compte_cree', `Compte « ${v.nom} » (${v.adresse})`);
  res.redirect('/courriels/comptes');
});

router.get('/comptes/:id/modifier', exigeRole('admin'), (req, res) => {
  const compte = compteDuCabinet(req.params.id, res.locals.cabinetId);
  if (!compte) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Compte introuvable.' });
  res.render('courriels/compte-form', { compte, preconfigs: PRECONFIGS, erreurs: [], valeurs: {} });
});

router.post('/comptes/:id', exigeRole('admin'), (req, res) => {
  const compte = compteDuCabinet(req.params.id, res.locals.cabinetId);
  if (!compte) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Compte introuvable.' });
  const { v, erreurs } = validerCompteFormulaire(req.body);
  if (erreurs.length) {
    return res.status(400).render('courriels/compte-form', { compte, preconfigs: PRECONFIGS, erreurs, valeurs: v });
  }
  const mdpChiffre = v.mot_de_passe ? chiffrerMotDePasse(v.mot_de_passe) : compte.mot_de_passe_chiffre;
  bd.prepare(`
    UPDATE courriel_comptes SET nom = ?, adresse = ?, imap_hote = ?, imap_port = ?, imap_tls = ?,
      smtp_hote = ?, smtp_port = ?, smtp_tls = ?, utilisateur = ?, mot_de_passe_chiffre = ?
    WHERE id = ?
  `).run(v.nom, v.adresse, v.imap_hote, v.imap_port, v.imap_tls, v.smtp_hote, v.smtp_port,
    v.smtp_tls, v.utilisateur, mdpChiffre, compte.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'courriel_compte_modifie', `Compte « ${v.nom} »`);
  res.redirect('/courriels/comptes');
});

// --- Comptes : tester / synchroniser / activer / archiver ---------------------------------------
router.post('/comptes/:id/tester', exigeRole('admin'), async (req, res) => {
  const compte = compteDuCabinet(req.params.id, res.locals.cabinetId);
  if (!compte) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Compte introuvable.' });
  let erreurs = [];
  try {
    erreurs = await avecDelai(testerCompte(compte), 30000);
  } catch (e) {
    erreurs = [e.message];
  }
  journal(res.locals.cabinetId, req.utilisateur.id, 'courriel_compte_teste',
    `Compte « ${compte.nom} » : ${erreurs.length ? 'échec — ' + erreurs.join(' | ') : 'OK'}`);
  res.render('courriels/test-resultat', { compte, erreurs });
});

router.post('/comptes/:id/synchroniser', async (req, res) => {
  const compte = compteDuCabinet(req.params.id, res.locals.cabinetId);
  if (!compte) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Compte introuvable.' });
  let ajoutes = 0;
  let erreur = null;
  try {
    ajoutes = await avecDelai(synchroniserCompte(bd, compte), 120000, 'Synchronisation trop longue (2 min)');
  } catch (e) {
    erreur = e.message;
  }
  journal(res.locals.cabinetId, req.utilisateur.id, 'courriel_synchronise',
    `Compte « ${compte.nom} » : ${ajoutes} nouveau(x)${erreur ? ' — erreur : ' + erreur : ''}`);
  res.redirect('/courriels?synchro=' + (erreur ? 'erreur' : ajoutes));
});

router.post('/comptes/synchroniser-tous', async (req, res) => {
  let total = 0;
  try {
    const resultats = await avecDelai(synchroniserTousLesComptes(bd), 180000, 'Synchronisation trop longue (3 min)');
    total = resultats.reduce((s, r) => s + r.ajoutes, 0);
    journal(res.locals.cabinetId, req.utilisateur.id, 'courriel_synchronise_tous', `${total} nouveau(x)`);
  } catch (e) {
    journal(res.locals.cabinetId, req.utilisateur.id, 'courriel_synchronise_tous', 'Erreur : ' + e.message);
  }
  res.redirect('/courriels?synchro=' + total);
});

// --- Comptes : activer / désactiver / archiver / désarchiver (explicite, sans boucle) ---
function actionCompte(action, champ, valeur) {
  return (req, res) => {
    const compte = compteDuCabinet(req.params.id, res.locals.cabinetId);
    if (!compte) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Compte introuvable.' });
    bd.prepare(`UPDATE courriel_comptes SET ${champ} = ? WHERE id = ?`).run(valeur, compte.id);
    journal(res.locals.cabinetId, req.utilisateur.id, 'courriel_compte_' + action, 'Compte « ' + compte.nom + ' »');
    res.redirect('/courriels/comptes' + (action === 'desarchiver' ? '?archives=1' : ''));
  };
}
router.post('/comptes/:id/activer', exigeRole('admin'), actionCompte('activer', 'actif', 1));
router.post('/comptes/:id/desactiver', exigeRole('admin'), actionCompte('desactiver', 'actif', 0));
router.post('/comptes/:id/archiver', exigeRole('admin'), actionCompte('archiver', 'archive', 1));
router.post('/comptes/:id/desarchiver', exigeRole('admin'), actionCompte('desarchiver', 'archive', 0));

// --- Rédaction ---------------------------------------------------------------------------------------
router.get('/rediger', (req, res) => {
  const comptes = bd.prepare(
    'SELECT id, nom, adresse FROM courriel_comptes WHERE cabinet_id = ? AND actif = 1 AND archive = 0 ORDER BY nom'
  ).all(res.locals.cabinetId);
  let prefill = { a: req.query.a || '', cc: '', sujet: req.query.sujet || '', texte: '' };
  if (req.query.reponse_id) {
    const orig = bd.prepare('SELECT * FROM courriels WHERE id = ? AND cabinet_id = ?').get(req.query.reponse_id, res.locals.cabinetId);
    if (orig && orig.dossier === 'reception') {
      const emails = (orig.expediteur.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g) || []);
      prefill = {
        a: emails[0] || '',
        cc: '',
        sujet: orig.sujet.startsWith('Re:') ? orig.sujet : 'Re: ' + orig.sujet,
        texte: `\n\n--- Message d'origine ---\nDe : ${orig.expediteur}\nDate : ${orig.date_courriel || ''}\nSujet : ${orig.sujet}\n\n${orig.corps_texte || ''}`,
      };
    }
  }
  if (req.query.client_id) {
    const cli = bd.prepare('SELECT courriel FROM clients WHERE id = ? AND cabinet_id = ?').get(req.query.client_id, res.locals.cabinetId);
    if (cli && cli.courriel) prefill.a = cli.courriel;
  }
  res.render('courriels/rediger', { comptes, prefill, erreurs: [] });
});

// Rédaction assistée par IA (retourne JSON)
router.post('/rediger-ia', async (req, res) => {
  const contexte = (req.body.contexte || '').trim();
  const destinataire = (req.body.destinataire || '').trim();
  const ton = ['pro', 'formel', 'amical'].includes(req.body.ton) ? req.body.ton : 'pro';
  if (!contexte) return res.status(400).json({ erreur: 'Décrivez le sujet du courriel.' });
  try {
    const { sujet, contenu, source } = await genererCourrielLibre({
      destinataire, contexte, ton, nomCourtier: req.utilisateur.nom,
    });
    journal(res.locals.cabinetId, req.utilisateur.id, 'courriel_ia_redige', `Brouillon IA (source : ${source})`);
    res.json({ sujet, contenu, source });
  } catch (e) {
    res.status(500).json({ erreur: 'La rédaction IA a échoué : ' + e.message });
  }
});

router.post('/envoyer', async (req, res) => {
  const comptes = bd.prepare(
    'SELECT * FROM courriel_comptes WHERE cabinet_id = ? AND actif = 1 AND archive = 0 ORDER BY nom'
  ).all(res.locals.cabinetId);
  const erreurs = [];
  const a = (req.body.a || '').trim();
  const cc = (req.body.cc || '').trim();
  const sujet = (req.body.sujet || '').trim();
  const texte = (req.body.texte || '').trim();
  const compte = comptes.find((c) => String(c.id) === String(req.body.compte_id));
  if (!compte) erreurs.push('Choisissez un compte d’envoi.');
  if (!estCourrielValide(a) || !a) erreurs.push('Adresse destinataire invalide.');
  if (cc && !cc.split(',').every((x) => estCourrielValide(x.trim()))) erreurs.push('Adresse(s) en copie invalide(s).');
  if (!sujet) erreurs.push('Le sujet est requis.');
  if (!texte) erreurs.push('Le message est vide.');
  if (erreurs.length) {
    return res.status(400).render('courriels/rediger', {
      comptes: comptes.map((c) => ({ id: c.id, nom: c.nom, adresse: c.adresse })),
      prefill: { a, cc, sujet, texte }, erreurs,
    });
  }
  try {
    await avecDelai(envoyerCourriel(bd, compte, { a, cc, sujet, texte }), 60000, 'Envoi trop long (1 min)');
    journal(res.locals.cabinetId, req.utilisateur.id, 'courriel_envoye', `« ${sujet} » → ${a} (via ${compte.nom})`);
    res.redirect('/courriels/envoyes');
  } catch (e) {
    journal(res.locals.cabinetId, req.utilisateur.id, 'courriel_envoi_echec', `« ${sujet} » → ${a} : ${e.message}`);
    res.status(502).render('courriels/rediger', {
      comptes: comptes.map((c) => ({ id: c.id, nom: c.nom, adresse: c.adresse })),
      prefill: { a, cc, sujet, texte },
      erreurs: ['Échec de l’envoi : ' + e.message],
    });
  }
});

// --- Lecture d'un courriel -----------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const courriel = bd.prepare(`
    SELECT c.*, cl.raison_sociale AS client_raison_sociale, cc.nom AS compte_nom
    FROM courriels c
    LEFT JOIN clients cl ON cl.id = c.client_id
    LEFT JOIN courriel_comptes cc ON cc.id = c.compte_id
    WHERE c.id = ? AND c.cabinet_id = ?
  `).get(req.params.id, res.locals.cabinetId);
  if (!courriel) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Courriel introuvable.' });
  if (!courriel.lu) bd.prepare('UPDATE courriels SET lu = 1 WHERE id = ?').run(courriel.id);
  const corpsHtml = courriel.corps_html ? assainirHtml(courriel.corps_html) : null;
  const clients = bd.prepare(
    'SELECT id, raison_sociale, courriel FROM clients WHERE cabinet_id = ? AND archive = 0 ORDER BY raison_sociale'
  ).all(res.locals.cabinetId);
  res.render('courriels/voir', { courriel, corpsHtml, clients, echapperHtml });
});

router.post('/:id/lu', (req, res) => {
  bd.prepare('UPDATE courriels SET lu = 1 WHERE id = ? AND cabinet_id = ?').run(req.params.id, res.locals.cabinetId);
  res.redirect('/courriels');
});

router.post('/:id/non-lu', (req, res) => {
  bd.prepare('UPDATE courriels SET lu = 0 WHERE id = ? AND cabinet_id = ?').run(req.params.id, res.locals.cabinetId);
  res.redirect('/courriels');
});

router.post('/:id/lier', (req, res) => {
  const courriel = bd.prepare('SELECT * FROM courriels WHERE id = ? AND cabinet_id = ?').get(req.params.id, res.locals.cabinetId);
  if (!courriel) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Courriel introuvable.' });
  const client = bd.prepare('SELECT id FROM clients WHERE id = ? AND cabinet_id = ?').get(req.body.client_id, res.locals.cabinetId);
  bd.prepare('UPDATE courriels SET client_id = ? WHERE id = ?').run(client ? client.id : null, courriel.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'courriel_lie',
    `Courriel « ${courriel.sujet} » lié à ${client ? 'entreprise id ' + client.id : 'aucune entreprise'}`);
  res.redirect('/courriels/' + courriel.id);
});

router.post('/:id/archiver', (req, res) => {
  bd.prepare('UPDATE courriels SET archive = 1 WHERE id = ? AND cabinet_id = ?').run(req.params.id, res.locals.cabinetId);
  res.redirect('/courriels');
});

router.post('/:id/desarchiver', (req, res) => {
  bd.prepare('UPDATE courriels SET archive = 0 WHERE id = ? AND cabinet_id = ?').run(req.params.id, res.locals.cabinetId);
  res.redirect('/courriels?archives=1');
});

module.exports = router;
