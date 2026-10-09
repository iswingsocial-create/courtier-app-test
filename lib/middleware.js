/**
 * lib/middleware.js — Middlewares partagés : authentification, rôles,
 * protection CSRF maison, journal d'audit, helpers de validation.
 */
const crypto = require('crypto');
const bd = require('./bd');

// --- Authentification -------------------------------------------------------
function exigeAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/connexion?retour=' + encodeURIComponent(req.originalUrl));
  }
  const user = bd.prepare(`
    SELECT u.*, c.nom AS cabinet_nom FROM users u
    JOIN cabinets c ON c.id = u.cabinet_id
    WHERE u.id = ?
  `).get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.redirect('/connexion');
  }
  if (!user.actif) {
    // Compte désactivé en cours de session → déconnexion immédiate
    req.session.destroy(() => {});
    return res.status(401).render('connexion', { erreur: 'Ce compte a été désactivé.', retour: '' });
  }
  req.utilisateur = user;
  res.locals.utilisateur = { id: user.id, nom: user.nom, email: user.email, role: user.role, cabinet_nom: user.cabinet_nom };
  res.locals.cabinetId = user.cabinet_id;
  next();
}

// Force le changement de mot de passe (ex. : premier login du compte démo)
function exigeMotDePasseChange(req, res, next) {
  if (req.utilisateur.doit_changer_mot_de_passe && req.path !== '/mot-de-passe' && req.path !== '/deconnexion') {
    return res.redirect('/mot-de-passe?premier=1');
  }
  next();
}

function exigeRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.utilisateur.role)) {
      return res.status(403).render('erreur', { titre: 'Accès refusé', message: 'Votre rôle ne permet pas cette action.' });
    }
    next();
  };
}

// --- CSRF maison (jeton par session) ----------------------------------------
function jetonCsrf(req, res, next) {
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrf;
  next();
}

function verifieCsrf(req, res, next) {
  const methode = req.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(methode)) {
    // Le formulaire public de capture de leads n'a pas de session : pas de CSRF.
    if (req.path.startsWith('/capture/')) return next();
    // Les formulaires multipart sont vérifiés après multer, dans la route concernée
    const ct = req.get('content-type') || '';
    if (ct.startsWith('multipart/form-data')) return next();
    const recu = req.body && req.body._csrf;
    if (!recu || recu !== req.session.csrf) {
      return res.status(403).render('erreur', { titre: 'Jeton invalide', message: 'Jeton de sécurité invalide ou expiré. Rechargez la page et réessayez.' });
    }
  }
  next();
}

// --- Journal d'audit ----------------------------------------------------------
function journal(cabinetId, userId, action, details) {
  try {
    bd.prepare('INSERT INTO journal_audit (cabinet_id, user_id, action, details) VALUES (?, ?, ?, ?)')
      .run(cabinetId || null, userId || null, action, details || null);
  } catch (e) {
    console.error('Échec du journal d’audit :', e.message);
  }
}

// --- Validation des entrées ---------------------------------------------------
const REGEX_COURRIEL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REGEX_DATE = /^\d{4}-\d{2}-\d{2}$/;

function estCourrielValide(v) { return !v || REGEX_COURRIEL.test(v.trim()); }
function estDateValide(v) {
  if (!v || !REGEX_DATE.test(v)) return false;
  const d = new Date(v + 'T00:00:00');
  return !isNaN(d.getTime());
}
function estNombreValide(v) { return v === '' || v === null || v === undefined || !isNaN(Number(v)); }

function echapperHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = {
  exigeAuth, exigeMotDePasseChange, exigeRole,
  jetonCsrf, verifieCsrf, journal,
  estCourrielValide, estDateValide, estNombreValide, echapperHtml,
};
