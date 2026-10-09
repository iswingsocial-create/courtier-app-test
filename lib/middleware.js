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

  // Expert en sinistre : lecture seule partout sauf réclamations
  // ( + mot de passe, profil/2FA et déconnexion).
  if (user.role === 'expert_sinistre' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const racine = ((req.baseUrl || '') + req.path).replace(/\/{2,}/g, '/');
    const autorise = racine.startsWith('/reclamations')
      || racine === '/mot-de-passe' || racine === '/deconnexion'
      || racine.startsWith('/profil');
    if (!autorise) {
      return res.status(403).render('erreur', {
        titre: 'Accès refusé',
        message: 'Votre rôle permet la consultation partout et la modification des réclamations uniquement.',
      });
    }
  }
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

// --- Droits par rôle (2026-10-09) ------------------------------------------------------
// admin          : tout.
// manager        : tout sauf le paramétrage du site (/admin, comptes courriels).
// courtier       : seulement les entreprises de son portefeuille (responsable_id) ;
//                  peut tout modifier sur ses dossiers, mais seul l'admin peut
//                  changer le courtier responsable d'un compte.
// expert_sinistre: consultation partout, écriture limitée aux réclamations
//                  (voir exigeAuth ci-dessus).
// adjoint        : comme avant (tout sauf /admin).
const ROLES = ['admin', 'manager', 'courtier', 'expert_sinistre', 'adjoint'];
const NOMS_ROLES = {
  admin: 'Administrateur', manager: 'Gestionnaire', courtier: 'Courtier',
  expert_sinistre: 'Expert en sinistre', adjoint: 'Adjoint',
};

function estAdmin(req) { return !!req.utilisateur && req.utilisateur.role === 'admin'; }
function estCourtier(req) { return !!req.utilisateur && req.utilisateur.role === 'courtier'; }

// Fragment SQL à ajouter aux requêtes listant des dossiers clients.
// alias = alias de la table clients dans la requête.
function clausePortefeuille(req, alias) {
  if (estCourtier(req)) return ` AND ${alias}.responsable_id = ${Number(req.utilisateur.id)}`;
  return '';
}

// true si le client est hors du portefeuille du courtier connecté.
function clientHorsPortefeuille(cabinetId, utilisateur, clientId) {
  if (!utilisateur || utilisateur.role !== 'courtier' || !clientId) return false;
  const c = bd.prepare('SELECT responsable_id FROM clients WHERE id = ? AND cabinet_id = ?')
    .get(Number(clientId), cabinetId);
  return !c || c.responsable_id !== utilisateur.id;
}

// Les courtiers voient les courriels liés à leur portefeuille (+ les non liés).
function clausePortefeuilleCourriels(req) {
  if (estCourtier(req)) {
    return ` AND (c.client_id IS NULL OR cl.responsable_id = ${Number(req.utilisateur.id)})`;
  }
  return '';
}

function reponseHorsPortefeuille(res) {
  return res.status(403).render('erreur', {
    titre: 'Accès refusé', message: 'Ce dossier n’est pas dans votre portefeuille.',
  });
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
  ROLES, NOMS_ROLES, estAdmin, estCourtier, clausePortefeuille, clausePortefeuilleCourriels,
  clientHorsPortefeuille, reponseHorsPortefeuille,
};
