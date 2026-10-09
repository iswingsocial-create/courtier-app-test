/**
 * routes/admin.js — Gestion des cabinets et des utilisateurs (rôle admin).
 */
const express = require('express');
const bcrypt = require('bcrypt');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, exigeRole, journal, estCourrielValide, ROLES, NOMS_ROLES } = require('../lib/middleware');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange, exigeRole('admin'));

// --- Cabinets -----------------------------------------------------------------------
router.get('/cabinets', (req, res) => {
  const cabinets = bd.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.cabinet_id = c.id) AS nb_users,
           (SELECT COUNT(*) FROM clients cl WHERE cl.cabinet_id = c.id) AS nb_clients
    FROM cabinets c ORDER BY c.nom
  `).all();
  res.render('admin/cabinets', { cabinets });
});

router.post('/cabinets', (req, res) => {
  const nom = String(req.body.nom || '').trim();
  if (nom.length < 2 || nom.length > 120) {
    return res.status(400).render('erreur', { titre: 'Nom invalide', message: 'Le nom du cabinet doit contenir entre 2 et 120 caractères.' });
  }
  const r = bd.prepare('INSERT INTO cabinets (nom, token_capture) VALUES (?, ?)').run(nom, bd.genererJetonCapture());
  journal(null, req.utilisateur.id, 'cabinet_cree', `Cabinet « ${nom} » (id ${r.lastInsertRowid})`);
  res.redirect('/admin/cabinets');
});

// --- Régénérer le jeton de capture publique de leads (par cabinet) -------------------------
router.post('/cabinets/:id/token-capture', (req, res) => {
  const cabinet = bd.prepare('SELECT * FROM cabinets WHERE id = ?').get(req.params.id);
  if (!cabinet) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Cabinet introuvable.' });
  const jeton = bd.genererJetonCapture();
  bd.prepare('UPDATE cabinets SET token_capture = ? WHERE id = ?').run(jeton, cabinet.id);
  journal(cabinet.id, req.utilisateur.id, 'token_capture_regenere', `Jeton de capture régénéré (cabinet « ${cabinet.nom} »)`);
  res.redirect('/admin/cabinets');
});

// --- Microsoft 365 / Teams ----------------------------------------------------------------------
router.get('/microsoft', (req, res) => {
  const ms = require('../lib/microsoft');
  const statut = ms.statutConnexion(res.locals.cabinetId);
  res.render('admin/microsoft', {
    statut, configure: ms.estConfigure(), erreur: req.query.erreur || null, ok: req.query.ok === '1',
    redirectUri: (process.env.MS_REDIRECT_URI || '').trim(),
  });
});

router.get('/microsoft/connecter', (req, res) => {
  const ms = require('../lib/microsoft');
  try {
    res.redirect(ms.urlAutorisation(res.locals.cabinetId));
  } catch (e) {
    res.redirect('/admin/microsoft?erreur=' + encodeURIComponent(e.message));
  }
});

router.get('/microsoft/retour', async (req, res) => {
  const ms = require('../lib/microsoft');
  const code = String(req.query.code || '');
  const erreurMs = req.query.error_description || req.query.error;
  if (erreurMs || !code) {
    return res.redirect('/admin/microsoft?erreur=' + encodeURIComponent(erreurMs || 'Autorisation refusée.'));
  }
  try {
    const jetons = await ms.echangerCode(code);
    ms.sauvegarderJetons(res.locals.cabinetId, jetons);
    journal(res.locals.cabinetId, req.utilisateur.id, 'microsoft_connecte', 'Microsoft 365 connecté (Teams)');
    res.redirect('/admin/microsoft?ok=1');
  } catch (e) {
    res.redirect('/admin/microsoft?erreur=' + encodeURIComponent(e.message));
  }
});

router.post('/microsoft/deconnecter', (req, res) => {
  const ms = require('../lib/microsoft');
  ms.supprimerJetons(res.locals.cabinetId);
  journal(res.locals.cabinetId, req.utilisateur.id, 'microsoft_deconnecte', 'Microsoft 365 déconnecté');
  res.redirect('/admin/microsoft');
});

// --- Utilisateurs ----------------------------------------------------------------------
router.get('/utilisateurs', (req, res) => {
  const cabinetFiltre = req.query.cabinet ? Number(req.query.cabinet) : null;
  let utilisateurs;
  if (cabinetFiltre) {
    utilisateurs = bd.prepare(`
      SELECT u.*, c.nom AS cabinet_nom FROM users u JOIN cabinets c ON c.id = u.cabinet_id
      WHERE u.cabinet_id = ? ORDER BY u.nom`).all(cabinetFiltre);
  } else {
    utilisateurs = bd.prepare(`
      SELECT u.*, c.nom AS cabinet_nom FROM users u JOIN cabinets c ON c.id = u.cabinet_id
      ORDER BY c.nom, u.nom`).all();
  }
  const cabinets = bd.prepare('SELECT * FROM cabinets ORDER BY nom').all();
  res.render('admin/utilisateurs', { utilisateurs, cabinets, cabinetFiltre, NOMS_ROLES });
});

router.get('/utilisateurs/nouveau', (req, res) => {
  const cabinets = bd.prepare('SELECT * FROM cabinets ORDER BY nom').all();
  res.render('admin/formulaire-utilisateur', { erreur: null, cabinets, NOMS_ROLES, valeurs: {} });
});

router.post('/utilisateurs', async (req, res) => {
  const cabinets = bd.prepare('SELECT * FROM cabinets ORDER BY nom').all();
  const email = String(req.body.email || '').trim().toLowerCase();
  const nom = String(req.body.nom || '').trim();
  const role = String(req.body.role || '');
  const cabinet_id = Number(req.body.cabinet_id);
  const motDePasse = String(req.body.mot_de_passe || '');

  const erreur = (msg) => res.status(400).render('admin/formulaire-utilisateur',
    { erreur: msg, cabinets, NOMS_ROLES, valeurs: { email, nom, role, cabinet_id } });

  if (!estCourrielValide(email)) return erreur('Courriel invalide.');
  if (nom.length < 2) return erreur('Le nom est requis.');
  if (!ROLES.includes(role)) return erreur('Rôle invalide.');
  if (!cabinets.some((c) => c.id === cabinet_id)) return erreur('Cabinet invalide.');
  if (motDePasse.length < 10) return erreur('Le mot de passe doit contenir au moins 10 caractères.');
  if (bd.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return erreur('Ce courriel est déjà utilisé.');
  }

  const hash = await bcrypt.hash(motDePasse, 12);
  bd.prepare(`
    INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom, doit_changer_mot_de_passe)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(cabinet_id, email, hash, role, nom);
  journal(cabinet_id, req.utilisateur.id, 'utilisateur_cree', `Utilisateur ${email} (${role})`);
  res.redirect('/admin/utilisateurs');
});

// --- Journal d'audit ---------------------------------------------------------------------------------
router.get('/journal', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const parPage = 50;
  const filtreUser = req.query.utilisateur ? Number(req.query.utilisateur) : null;
  const filtreAction = String(req.query.action || '').trim();

  const conditions = ['j.cabinet_id = ?'];
  const params = [res.locals.cabinetId];
  // Les admins voient le journal de leur propre cabinet ; le cabinet_id NULL (actions système) est exclu
  if (filtreUser) { conditions.push('j.user_id = ?'); params.push(filtreUser); }
  if (filtreAction) { conditions.push('j.action LIKE ?'); params.push(`%${filtreAction}%`); }
  const where = 'WHERE ' + conditions.join(' AND ');

  const total = bd.prepare(`SELECT COUNT(*) AS n FROM journal_audit j ${where}`).get(...params).n;
  const pages = Math.max(1, Math.ceil(total / parPage));
  const pageCourante = Math.min(page, pages);
  const lignes = bd.prepare(`
    SELECT j.*, u.nom AS utilisateur_nom, u.email AS utilisateur_email
    FROM journal_audit j LEFT JOIN users u ON u.id = j.user_id
    ${where} ORDER BY j.cree_le DESC LIMIT ? OFFSET ?
  `).all(...params, parPage, (pageCourante - 1) * parPage);

  const utilisateurs = bd.prepare('SELECT id, nom FROM users WHERE cabinet_id = ? ORDER BY nom').all(res.locals.cabinetId);
  const actions = bd.prepare('SELECT DISTINCT action FROM journal_audit WHERE cabinet_id = ? ORDER BY action').all(res.locals.cabinetId);
  res.render('admin/journal', { lignes, utilisateurs, actions, filtreUser, filtreAction, page: pageCourante, pages, total });
});

// Réinitialiser le mot de passe d'un utilisateur (génère un temporaire à changer)
router.post('/utilisateurs/:id/reinitialiser', async (req, res) => {
  const cible = bd.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!cible) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Utilisateur introuvable.' });
  const temporaire = 'Temp' + Math.random().toString(36).slice(2, 10) + '!';
  const hash = await bcrypt.hash(temporaire, 12);
  bd.prepare('UPDATE users SET mot_de_passe_hash = ?, doit_changer_mot_de_passe = 1, totp_secret = NULL, totp_actif = 0 WHERE id = ?')
    .run(hash, cible.id);
  journal(cible.cabinet_id, req.utilisateur.id, 'mdp_reinitialise', `Mot de passe réinitialisé pour ${cible.email}`);
  res.render('admin/mdp-temporaire', { email: cible.email, temporaire });
});

// --- Désactiver / réactiver un utilisateur (règle d'or : on ne supprime jamais un compte) ---------------
router.post('/utilisateurs/:id/desactiver', (req, res) => {
  const cible = bd.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!cible) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Utilisateur introuvable.' });
  if (cible.id === req.utilisateur.id) {
    return res.status(400).render('erreur', { titre: 'Action impossible', message: 'Vous ne pouvez pas désactiver votre propre compte.' });
  }
  bd.prepare('UPDATE users SET actif = 0 WHERE id = ?').run(cible.id);
  journal(cible.cabinet_id, req.utilisateur.id, 'utilisateur_desactive', `Compte désactivé : ${cible.email}`);
  res.redirect('/admin/utilisateurs');
});

router.post('/utilisateurs/:id/activer', (req, res) => {
  const cible = bd.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!cible) return res.status(404).render('erreur', { titre: 'Introuvable', message: 'Utilisateur introuvable.' });
  bd.prepare('UPDATE users SET actif = 1 WHERE id = ?').run(cible.id);
  journal(cible.cabinet_id, req.utilisateur.id, 'utilisateur_active', `Compte réactivé : ${cible.email}`);
  res.redirect('/admin/utilisateurs');
});

module.exports = router;
