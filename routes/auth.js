/**
 * routes/auth.js — Connexion, déconnexion, 2FA (TOTP), changement de mot de passe.
 */
const express = require('express');
const bcrypt = require('bcrypt');
const { generateSecret, generateURI, verify } = require('otplib');

const bd = require('../lib/bd');
const { exigeAuth, exigeMotDePasseChange, journal, estCourrielValide } = require('../lib/middleware');

const router = express.Router();

// --- Formulaire de connexion -----------------------------------------------------
router.get('/connexion', (req, res) => {
  if (req.session.userId) return res.redirect('/echeances');
  res.render('connexion', { erreur: null, retour: req.query.retour || '' });
});

router.post('/connexion', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const motDePasse = String(req.body.mot_de_passe || '');

  if (!estCourrielValide(email) || !motDePasse) {
    return res.status(400).render('connexion', { erreur: 'Courriel ou mot de passe invalide.', retour: req.body.retour || '' });
  }

  const user = bd.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = user && await bcrypt.compare(motDePasse, user.mot_de_passe_hash);
  if (!ok) {
    journal(null, null, 'connexion_echouee', `Tentative pour ${email}`);
    // Message générique : ne pas révéler si le compte existe
    return res.status(401).render('connexion', { erreur: 'Courriel ou mot de passe incorrect.', retour: req.body.retour || '' });
  }
  if (!user.actif) {
    journal(user.cabinet_id, user.id, 'connexion_refusee', `Compte désactivé : ${email}`);
    return res.status(401).render('connexion', { erreur: 'Ce compte a été désactivé. Contactez votre administrateur.', retour: req.body.retour || '' });
  }

  // 2FA activée → étape supplémentaire
  if (user.totp_actif) {
    req.session.attente2fa = user.id;
    return res.redirect('/double-auth' + (req.body.retour ? '?retour=' + encodeURIComponent(req.body.retour) : ''));
  }

  terminerConnexion(req, res, user, req.body.retour);
});

function terminerConnexion(req, res, user, retour) {
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('erreur', { titre: 'Erreur', message: 'Session impossible.' });
    req.session.userId = user.id;
    journal(user.cabinet_id, user.id, 'connexion', `Connexion de ${user.email}`);
    const destination = retour && retour.startsWith('/') ? retour : '/echeances';
    res.redirect(destination);
  });
}

// --- Deuxième facteur (TOTP) ------------------------------------------------------
router.get('/double-auth', (req, res) => {
  if (!req.session.attente2fa) return res.redirect('/connexion');
  res.render('double-auth', { erreur: null, retour: req.query.retour || '' });
});

router.post('/double-auth', async (req, res) => {
  const userId = req.session.attente2fa;
  if (!userId) return res.redirect('/connexion');
  const user = bd.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const code = String(req.body.code || '').replace(/\s/g, '');
  // NOTE otplib v13 : verify() retourne un objet { valid: bool } — tester .valid, pas l'objet !
  let valide = false;
  try {
    const resultat = user && user.totp_actif ? await verify({ secret: user.totp_secret, token: code }) : null;
    valide = !!(resultat && resultat.valid);
  } catch (e) { valide = false; }
  if (!valide) {
    journal(user ? user.cabinet_id : null, userId, '2fa_echoue', 'Code 2FA invalide');
    return res.status(401).render('double-auth', { erreur: 'Code invalide. Réessayez.', retour: req.body.retour || '' });
  }
  delete req.session.attente2fa;
  terminerConnexion(req, res, user, req.body.retour);
});

// --- Déconnexion ---------------------------------------------------------------------
router.post('/deconnexion', exigeAuth, (req, res) => {
  journal(req.utilisateur.cabinet_id, req.utilisateur.id, 'deconnexion', `Déconnexion de ${req.utilisateur.email}`);
  req.session.destroy(() => res.redirect('/connexion'));
});

// --- Changement de mot de passe (obligatoire au premier login démo) -------------------
router.get('/mot-de-passe', exigeAuth, (req, res) => {
  res.render('changer-mot-de-passe', { erreur: null, premier: req.query.premier === '1' });
});

router.post('/mot-de-passe', exigeAuth, async (req, res) => {
  const actuel = String(req.body.actuel || '');
  const nouveau = String(req.body.nouveau || '');
  const confirmation = String(req.body.confirmation || '');

  const user = bd.prepare('SELECT * FROM users WHERE id = ?').get(req.utilisateur.id);
  if (!await bcrypt.compare(actuel, user.mot_de_passe_hash)) {
    return res.status(400).render('changer-mot-de-passe', { erreur: 'Le mot de passe actuel est incorrect.', premier: false });
  }
  if (nouveau.length < 10 || !/[A-Z]/.test(nouveau) || !/[a-z]/.test(nouveau) || !/[0-9]/.test(nouveau)) {
    return res.status(400).render('changer-mot-de-passe', {
      erreur: 'Le nouveau mot de passe doit contenir au moins 10 caractères, une majuscule, une minuscule et un chiffre.',
      premier: false,
    });
  }
  if (nouveau !== confirmation) {
    return res.status(400).render('changer-mot-de-passe', { erreur: 'La confirmation ne correspond pas.', premier: false });
  }

  const hash = await bcrypt.hash(nouveau, 12);
  bd.prepare('UPDATE users SET mot_de_passe_hash = ?, doit_changer_mot_de_passe = 0 WHERE id = ?').run(hash, user.id);
  journal(user.cabinet_id, user.id, 'mot_de_passe_change', 'Mot de passe modifié');
  res.redirect('/echeances?mdp=ok');
});

// --- 2FA : activation / désactivation (profil) ------------------------------------------
router.get('/profil/deux-facteurs', exigeAuth, exigeMotDePasseChange, (req, res) => {
  const user = bd.prepare('SELECT totp_actif FROM users WHERE id = ?').get(req.utilisateur.id);
  res.render('profil/deux-facteurs', { erreur: null, actif: !!user.totp_actif, secret: null, otpauth: null });
});

router.post('/profil/deux-facteurs/activer', exigeAuth, exigeMotDePasseChange, (req, res) => {
  const secret = generateSecret();
  // On garde le secret en session le temps de la vérification
  req.session.secret2fa = secret;
  const otpauth = generateURI({ issuer: 'Courtier', label: req.utilisateur.email, secret });
  res.render('profil/deux-facteurs', { erreur: null, actif: false, secret, otpauth });
});

router.post('/profil/deux-facteurs/confirmer', exigeAuth, exigeMotDePasseChange, async (req, res) => {
  const secret = req.session.secret2fa;
  const code = String(req.body.code || '').replace(/\s/g, '');
  // NOTE otplib v13 : verify() retourne un objet { valid: bool } — tester .valid, pas l'objet !
  let valide = false;
  try {
    const resultat = secret ? await verify({ secret, token: code }) : null;
    valide = !!(resultat && resultat.valid);
  } catch (e) { valide = false; }
  if (!valide) {
    return res.status(400).render('profil/deux-facteurs', {
      erreur: 'Code invalide — vérifiez l’heure de votre téléphone et réessayez.', actif: false, secret, otpauth: null,
    });
  }
  bd.prepare('UPDATE users SET totp_secret = ?, totp_actif = 1 WHERE id = ?').run(secret, req.utilisateur.id);
  delete req.session.secret2fa;
  journal(req.utilisateur.cabinet_id, req.utilisateur.id, '2fa_activee', 'Double authentification activée');
  res.redirect('/profil/deux-facteurs?ok=1');
});

router.post('/profil/deux-facteurs/desactiver', exigeAuth, exigeMotDePasseChange, async (req, res) => {
  const user = bd.prepare('SELECT * FROM users WHERE id = ?').get(req.utilisateur.id);
  const motDePasse = String(req.body.mot_de_passe || '');
  if (!await bcrypt.compare(motDePasse, user.mot_de_passe_hash)) {
    return res.status(400).render('profil/deux-facteurs', { erreur: 'Mot de passe incorrect.', actif: true, secret: null, otpauth: null });
  }
  bd.prepare('UPDATE users SET totp_secret = NULL, totp_actif = 0 WHERE id = ?').run(user.id);
  journal(user.cabinet_id, user.id, '2fa_desactivee', 'Double authentification désactivée');
  res.redirect('/profil/deux-facteurs?off=1');
});

module.exports = router;
