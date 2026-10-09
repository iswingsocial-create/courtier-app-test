/**
 * lib/magasin-session.js — Magasin de sessions Express adossé à SQLite.
 * Évite le MemoryStore par défaut (fuite mémoire, non adapté à la production).
 */
const session = require('express-session');

class MagasinSessionSQLite extends session.Store {
  constructor(bd) {
    super();
    this.bd = bd;
    this.reqGet = bd.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?');
    this.reqSet = bd.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expire) VALUES (?, ?, ?)');
    this.reqDestroy = bd.prepare('DELETE FROM sessions WHERE sid = ?');
    this.reqTouch = bd.prepare('UPDATE sessions SET expire = ? WHERE sid = ?');
    this.reqClearExpired = bd.prepare('DELETE FROM sessions WHERE expire <= ?');
  }

  get(sid, cb) {
    try {
      const ligne = this.reqGet.get(sid, Date.now());
      cb(null, ligne ? JSON.parse(ligne.sess) : null);
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      const expire = Date.now() + (sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 3600000);
      this.reqSet.run(sid, JSON.stringify(sess), expire);
      // Nettoyage opportuniste des sessions expirées
      if (Math.random() < 0.05) this.reqClearExpired.run(Date.now());
      cb(null);
    } catch (err) { cb(err); }
  }

  destroy(sid, cb) {
    try { this.reqDestroy.run(sid); cb(null); }
    catch (err) { cb(err); }
  }

  touch(sid, sess, cb) {
    try {
      const expire = Date.now() + (sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 3600000);
      this.reqTouch.run(expire, sid);
      cb(null);
    } catch (err) { cb(err); }
  }
}

module.exports = MagasinSessionSQLite;
