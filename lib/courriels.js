/**
 * lib/courriels.js — Messagerie intégrée (style Outlook) pour l'app Courtier.
 *
 * - Réception via IMAP (imapflow), envoi via SMTP (nodemailer).
 * - Les mots de passe des comptes sont chiffrés (AES-256-GCM, lib/chiffrement.js).
 * - Parsing MIME maison (RFC 2047, quoted-printable, base64, multipart) sans
 *   dépendance lourde ; les pièces jointes ne sont pas conservées en v1.
 * - Liaison automatique aux entreprises : on cherche l'adresse de l'expéditeur
 *   dans clients.courriel.
 *
 * Sécurité : aucun mot de passe ni corps de message n'est journalisé.
 */
const { chiffrer, dechiffrer } = require('./chiffrement');

// --- Préconfigurations ---------------------------------------------------------
const PRECONFIGS = {
  gmail: {
    etiquette: 'Gmail',
    imap_hote: 'imap.gmail.com', imap_port: 993, imap_tls: 1,
    smtp_hote: 'smtp.gmail.com', smtp_port: 587, smtp_tls: 1,
    note: 'Gmail exige un « mot de passe d’application » (compte Google → Sécurité → Validation en 2 étapes → Mots de passe d’application). Votre mot de passe Gmail habituel sera refusé.',
  },
  outlook: {
    etiquette: 'Outlook / Microsoft 365',
    imap_hote: 'outlook.office365.com', imap_port: 993, imap_tls: 1,
    smtp_hote: 'smtp.office365.com', smtp_port: 587, smtp_tls: 1,
    note: 'Avec Microsoft 365, l’authentification de base (mot de passe) est souvent désactivée par l’administrateur — un mot de passe d’application peut être requis.',
  },
  autre: {
    etiquette: 'Autre fournisseur (manuel)',
    imap_hote: '', imap_port: 993, imap_tls: 1,
    smtp_hote: '', smtp_port: 587, smtp_tls: 1,
    note: 'Renseignez les serveurs IMAP et SMTP de votre fournisseur.',
  },
};

// --- Décodage RFC 2047 (« mots encodés » des en-têtes) ---------------------------
function decoderMotEncode(texte) {
  return String(texte || '').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (m, charset, enc, data) => {
    try {
      let buf;
      if (enc.toUpperCase() === 'B') {
        buf = Buffer.from(data, 'base64');
      } else {
        const bin = data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16)));
        buf = Buffer.from(bin, 'binary');
      }
      const cs = charset.toLowerCase();
      if (cs.includes('iso-8859-1') || cs === 'latin1' || cs.includes('windows-1252')) return buf.toString('latin1');
      return buf.toString('utf8');
    } catch { return m; }
  });
}

// --- Quoted-printable ------------------------------------------------------------
function decoderQP(texte) {
  const bin = String(texte)
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bin, 'binary');
}

function decoderTransfert(corps, encodage) {
  const enc = String(encodage || '7bit').toLowerCase().trim();
  if (enc === 'base64') return Buffer.from(String(corps).replace(/\s/g, ''), 'base64');
  if (enc === 'quoted-printable') return decoderQP(corps);
  return Buffer.from(String(corps), 'binary');
}

function texteDuBuffer(buf, charset) {
  const cs = String(charset || 'utf-8').toLowerCase();
  if (cs.includes('iso-8859-1') || cs === 'latin1' || cs.includes('windows-1252')) return buf.toString('latin1');
  return buf.toString('utf8');
}

// --- En-têtes ----------------------------------------------------------------------
function analyserEntetes(bloc) {
  const entetes = {};
  let nom = null;
  let valeur = '';
  const flush = () => {
    if (nom) {
      const cle = nom.toLowerCase();
      entetes[cle] = entetes[cle] ? entetes[cle] + ' ' + valeur.trim() : valeur.trim();
    }
  };
  for (const ligne of String(bloc).split(/\r?\n/)) {
    if (/^[ \t]/.test(ligne) && nom) { valeur += ' ' + ligne.trim(); continue; }
    flush();
    const i = ligne.indexOf(':');
    if (i > 0) { nom = ligne.slice(0, i).trim(); valeur = ligne.slice(i + 1).trim(); }
    else { nom = null; valeur = ''; }
  }
  flush();
  return entetes;
}

const RE_COURRIEL = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
function extraireCourriels(texte) {
  const trouves = [];
  let m;
  const src = decoderMotEncode(texte || '');
  RE_COURRIEL.lastIndex = 0;
  while ((m = RE_COURRIEL.exec(src))) {
    const c = m[1].toLowerCase();
    if (!trouves.includes(c)) trouves.push(c);
  }
  return trouves;
}

// --- Corps MIME (récursif, 1 à 2 niveaux) --------------------------------------------
function analyserPartie(entetes, corps, resultat) {
  const ct = String(entetes['content-type'] || 'text/plain').toLowerCase();
  const enc = entetes['content-transfer-encoding'];
  const m = ct.match(/boundary="?([^";]+)"?/);
  if (ct.includes('multipart/') && m) {
    const frontiere = '--' + m[1].trim();
    const morceaux = String(corps).split(frontiere);
    for (const morceau of morceaux.slice(1)) {
      const propre = morceau.replace(/--\s*$/, '').trim();
      if (!propre || propre === '--') continue;
      const idx = propre.search(/\r?\n\r?\n/);
      if (idx < 0) continue;
      analyserPartie(
        analyserEntetes(propre.slice(0, idx)),
        propre.slice(idx).replace(/^\r?\n\r?\n/, ''),
        resultat
      );
    }
    return;
  }
  const buf = decoderTransfert(corps, enc);
  const cs = (ct.match(/charset="?([^";\s]+)"?/) || [])[1];
  const texte = texteDuBuffer(buf, cs);
  if (ct.includes('text/html')) { if (!resultat.html) resultat.html = texte; }
  else if (ct.includes('text/plain')) { if (!resultat.texte) resultat.texte = texte; }
  // Les autres types (pièces jointes) sont ignorés en v1.
}

function analyserMessage(brut) {
  const src = Buffer.isBuffer(brut) ? brut.toString('binary') : String(brut);
  const idx = src.search(/\r?\n\r?\n/);
  const entetes = analyserEntetes(idx >= 0 ? src.slice(0, idx) : src);
  const corps = idx >= 0 ? src.slice(idx).replace(/^\r?\n\r?\n/, '') : '';
  const resultat = { texte: '', html: '' };
  analyserPartie(entetes, corps, resultat);
  return {
    expediteur: decoderMotEncode(entetes.from || ''),
    expediteurCourriels: extraireCourriels(entetes.from || ''),
    destinataires: extraireCourriels(entetes.to || ''),
    cc: extraireCourriels(entetes.cc || ''),
    sujet: decoderMotEncode(entetes.subject || '') || '(sans objet)',
    messageId: (entetes['message-id'] || '').trim(),
    date: (entetes.date || '').trim(),
    texte: resultat.texte.trim(),
    html: resultat.html.trim(),
  };
}

// --- Assainissement HTML basique pour l'affichage ------------------------------------
function assainirHtml(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style\s*>/gi, '');
  s = s.replace(/<(iframe|object|embed|form|input|button|select|textarea|link|meta)[\s>][\s\S]*?<\/(iframe|object|embed|form|select|textarea)\s*>/gi, '');
  s = s.replace(/<(iframe|object|embed|link|meta|input|button)[^>]*\/?>/gi, '');
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
  return s;
}

// --- Liaison automatique à une entreprise ----------------------------------------------
function lierClientAuto(bd, cabinetId, adresses) {
  for (const a of adresses || []) {
    const cli = bd.prepare(
      'SELECT id FROM clients WHERE cabinet_id = ? AND lower(courriel) = ? AND archive = 0'
    ).get(cabinetId, String(a).toLowerCase());
    if (cli) return cli.id;
  }
  return null;
}

// --- Synchronisation IMAP ------------------------------------------------------------------
async function synchroniserCompte(bd, compte) {
  const { ImapFlow } = require('imapflow');
  const mdp = dechiffrer(compte.mot_de_passe_chiffre);
  const client = new ImapFlow({
    host: compte.imap_hote,
    port: Number(compte.imap_port) || 993,
    secure: Number(compte.imap_tls) !== 0,
    auth: { user: compte.utilisateur, pass: mdp },
    logger: false,
  });
  await client.connect();
  const verrou = await client.getMailboxLock('INBOX');
  let ajoutes = 0;
  try {
    const depuis = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const uids = [];
    for await (const msg of client.fetch({ since: depuis }, { uid: true })) {
      uids.push(msg.uid);
    }
    const existeStmt = bd.prepare(
      'SELECT 1 FROM courriels WHERE cabinet_id = ? AND compte_id = ? AND message_id = ?'
    );
    const insererStmt = bd.prepare(`
      INSERT INTO courriels (cabinet_id, compte_id, message_id, dossier, expediteur,
        destinataires, cc, sujet, corps_texte, corps_html, date_courriel, client_id)
      VALUES (?, ?, ?, 'reception', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const uid of uids.slice(-200)) {
      let contenu;
      try {
        const dl = await client.download(String(uid));
        contenu = Buffer.isBuffer(dl) ? dl : dl && dl.content;
      } catch { continue; }
      if (!contenu) continue;
      const p = analyserMessage(contenu);
      const mid = p.messageId || `uid-${uid}`;
      if (existeStmt.get(compte.cabinet_id, compte.id, mid)) continue;
      const clientId = lierClientAuto(bd, compte.cabinet_id, p.expediteurCourriels);
      insererStmt.run(
        compte.cabinet_id, compte.id, mid, p.expediteur,
        p.destinataires.join(', '), p.cc.join(', '), p.sujet,
        p.texte || null, p.html || null, p.date || null, clientId
      );
      ajoutes++;
    }
    bd.prepare("UPDATE courriel_comptes SET derniere_synchro = datetime('now') WHERE id = ?").run(compte.id);
  } finally {
    verrou.release();
    await client.logout().catch(() => {});
  }
  return ajoutes;
}

async function synchroniserTousLesComptes(bd) {
  const comptes = bd.prepare(
    'SELECT * FROM courriel_comptes WHERE actif = 1 AND archive = 0'
  ).all();
  const resultats = [];
  for (const c of comptes) {
    try {
      const n = await synchroniserCompte(bd, c);
      resultats.push({ compte: c.nom, ajoutes: n, erreur: null });
    } catch (e) {
      resultats.push({ compte: c.nom, ajoutes: 0, erreur: e.message });
    }
  }
  return resultats;
}

// --- Test de connexion (IMAP + SMTP) ---------------------------------------------------------
async function testerCompte(compte) {
  const erreurs = [];
  const mdp = dechiffrer(compte.mot_de_passe_chiffre);
  try {
    const { ImapFlow } = require('imapflow');
    const client = new ImapFlow({
      host: compte.imap_hote, port: Number(compte.imap_port) || 993,
      secure: Number(compte.imap_tls) !== 0,
      auth: { user: compte.utilisateur, pass: mdp },
      logger: false,
    });
    await client.connect();
    await client.logout();
  } catch (e) {
    erreurs.push('Réception (IMAP) : ' + (e.message || 'échec de connexion'));
  }
  try {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: compte.smtp_hote, port: Number(compte.smtp_port) || 587,
      secure: Number(compte.smtp_port) === 465,
      auth: { user: compte.utilisateur, pass: mdp },
    });
    await transport.verify();
    transport.close();
  } catch (e) {
    erreurs.push('Envoi (SMTP) : ' + (e.message || 'échec de connexion'));
  }
  return erreurs;
}

// --- Envoi SMTP ------------------------------------------------------------------------------------
async function envoyerCourriel(bd, compte, { a, cc, sujet, texte }) {
  const nodemailer = require('nodemailer');
  const mdp = dechiffrer(compte.mot_de_passe_chiffre);
  const transport = nodemailer.createTransport({
    host: compte.smtp_hote, port: Number(compte.smtp_port) || 587,
    secure: Number(compte.smtp_port) === 465,
    auth: { user: compte.utilisateur, pass: mdp },
  });
  try {
    const info = await transport.sendMail({
      from: `"${compte.nom}" <${compte.adresse}>`,
      to: a,
      cc: cc || undefined,
      subject: sujet,
      text: texte,
    });
    // Copie locale dans les envoyés
    const clientId = lierClientAuto(bd, compte.cabinet_id, extraireCourriels(a));
    bd.prepare(`
      INSERT INTO courriels (cabinet_id, compte_id, message_id, dossier, expediteur,
        destinataires, cc, sujet, corps_texte, date_courriel, lu, client_id)
      VALUES (?, ?, ?, 'envoyes', ?, ?, ?, ?, ?, datetime('now'), 1, ?)
    `).run(
      compte.cabinet_id, compte.id, info.messageId || null,
      `${compte.nom} <${compte.adresse}>`, a, cc || null, sujet, texte, clientId
    );
    return { messageId: info.messageId || null };
  } finally {
    transport.close();
  }
}

module.exports = {
  PRECONFIGS,
  chiffrerMotDePasse: chiffrer,
  dechiffrerMotDePasse: dechiffrer,
  decoderMotEncode,
  decoderQP,
  analyserEntetes,
  extraireCourriels,
  analyserMessage,
  assainirHtml,
  lierClientAuto,
  synchroniserCompte,
  synchroniserTousLesComptes,
  testerCompte,
  envoyerCourriel,
};
