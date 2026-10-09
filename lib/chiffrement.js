/**
 * lib/chiffrement.js — Chiffrement symétrique AES-256-GCM pour les secrets
 * stockés en base (ex. : jetons Microsoft 365).
 *
 * La clé vient de CHIFFRE_CLE (64 caractères hexadécimaux = 32 octets).
 * À défaut, elle est dérivée de SESSION_SECRET via scrypt — à fixer en
 * production avec CHIFFRE_CLE pour ne pas perdre les secrets si le secret
 * de session change.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function cleChiffrement() {
  const brute = process.env.CHIFFRE_CLE;
  if (brute && /^[0-9a-fA-F]{64}$/.test(brute.trim())) {
    return Buffer.from(brute.trim(), 'hex');
  }
  const sel = process.env.SESSION_SECRET || 'cle-chiffrement-dev-non-production';
  return crypto.scryptSync(String(sel), 'courtier-chiffrement', 32);
}

// Format : iv_hex:tag_hex:donnees_hex
function chiffrer(texteClair) {
  const cle = cleChiffrement();
  const iv = crypto.randomBytes(12);
  const chiffreur = crypto.createCipheriv(ALGO, cle, iv);
  const donnees = Buffer.concat([chiffreur.update(String(texteClair), 'utf8'), chiffreur.final()]);
  const tag = chiffreur.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${donnees.toString('hex')}`;
}

function dechiffrer(paquet) {
  const cle = cleChiffrement();
  const [ivHex, tagHex, donneesHex] = String(paquet).split(':');
  if (!ivHex || !tagHex || !donneesHex) throw new Error('Paquet chiffré invalide');
  const dechiffreur = crypto.createDecipheriv(ALGO, cle, Buffer.from(ivHex, 'hex'));
  dechiffreur.setAuthTag(Buffer.from(tagHex, 'hex'));
  const clair = Buffer.concat([
    dechiffreur.update(Buffer.from(donneesHex, 'hex')),
    dechiffreur.final(),
  ]);
  return clair.toString('utf8');
}

module.exports = { chiffrer, dechiffrer };
