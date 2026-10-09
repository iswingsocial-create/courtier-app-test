/**
 * server.js — Point d'entrée de l'application « Courtier ».
 * Phase 1 : fondation multi-cabinets, clients, polices, renouvellements.
 *
 * Lancement : npm start  (puis http://localhost:3000)
 * Variables d'environnement :
 *   PORT            — port d'écoute (défaut 3000)
 *   COOKIE_SECURE=1 — active le flag Secure des cookies (requis derrière HTTPS)
 *   COHERE_API_KEY  — clé API Cohere pour les brouillons IA (optionnel)
 *   COHERE_MODEL    — modèle Cohere (défaut : command-a-03-2025)
 *   CHEMIN_BD       — chemin du fichier SQLite (défaut : ./courtier.db)
 */
require('./lib/bd'); // crée le schéma au besoin
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const MagasinSessionSQLite = require('./lib/magasin-session');
const bd = require('./lib/bd');
const { jetonCsrf, verifieCsrf } = require('./lib/middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Sécurité des en-têtes ----------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      // Pas de scripts/externes : tout est servi localement
    },
  },
}));

// --- Vues et fichiers statiques ------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// --- Sessions sécurisées (stockées en SQLite) ----------------------------------
app.use(session({
  store: new MagasinSessionSQLite(bd),
  secret: process.env.SESSION_SECRET || 'changez-moi-en-production-' + require('crypto').randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: false,
  name: 'courtier.sid',
  cookie: {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === '1', // activer derrière HTTPS
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000, // 8 heures
  },
}));

// --- CSRF : jeton dispo dans les vues, vérifié sur les POST --------------------
app.use(jetonCsrf);
app.use(verifieCsrf);

// --- Limitation du nombre de tentatives de connexion ---------------------------
const limiteurConnexion = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop de tentatives. Réessayez dans 15 minutes.',
});
app.use('/connexion', limiteurConnexion);

// --- Routes ----------------------------------------------------------------------
app.use('/', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/clients', require('./routes/clients'));
app.use('/polices', require('./routes/polices'));
app.use('/reclamations', require('./routes/reclamations'));
app.use('/taches', require('./routes/taches'));
app.use('/factures', require('./routes/factures'));
app.use('/leads', require('./routes/leads'));
app.use('/capture', require('./routes/capture')); // formulaire public (sans auth)
app.use('/campagnes', require('./routes/campagnes'));
app.use('/reunions', require('./routes/reunions'));
app.use('/import', require('./routes/import'));
app.use('/echeances', require('./routes/echeances'));
app.use('/brouillons', require('./routes/brouillons'));
app.use('/courriels', require('./routes/courriels'));

// --- Synchronisation IMAP automatique (toutes les 5 minutes) --------------------------
// Ne fait rien s'il n'y a aucun compte actif. Les erreurs sont journalisées,
// jamais propagées (le serveur ne doit pas planter à cause d'un compte).
function lancerSynchroCourriels() {
  try {
    const { synchroniserTousLesComptes } = require('./lib/courriels');
    synchroniserTousLesComptes(bd)
      .then((r) => {
        const n = r.reduce((s, x) => s + x.ajoutes, 0);
        if (n > 0) console.log(`Synchro courriels : ${n} nouveau(x)`);
        for (const x of r) {
          if (x.erreur) console.error(`Synchro courriels (${x.compte}) : ${x.erreur}`);
        }
      })
      .catch((e) => console.error('Synchro courriels :', e.message));
  } catch (e) {
    console.error('Synchro courriels :', e.message);
  }
}
setTimeout(lancerSynchroCourriels, 30000);
setInterval(lancerSynchroCourriels, 5 * 60 * 1000);

// Accueil → tableau des échéances (ou connexion)
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/echeances');
  res.redirect('/connexion');
});

// 404
app.use((req, res) => {
  res.status(404).render('erreur', { titre: 'Page introuvable', message: 'La page demandée n’existe pas.' });
});

// Erreurs
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Erreur serveur :', err);
  res.status(500).render('erreur', { titre: 'Erreur interne', message: 'Une erreur inattendue est survenue.' });
});

// --- Données de démonstration au premier lancement ---------------------------------
try {
  const nb = bd.prepare('SELECT COUNT(*) AS n FROM cabinets').get().n;
  if (nb === 0) {
    console.log('Premier lancement : création des données de démonstration…');
    require('./seed');
  }
} catch (e) {
  console.error('Échec du seed initial :', e.message);
}

app.listen(PORT, () => {
  console.log(`Courtier (phase 1) en écoute sur http://localhost:${PORT}`);
});
