/**
 * lib/analyses-documents.js — Couche d'accès du module « Analyse de
 * documents IA » : un document téléversé est extrait, le moteur propose des
 * champs, un humain révise, puis les champs retenus sont insérés.
 *
 * Règle d'or : AUCUNE suppression — une analyse se archive (restorable),
 * son fichier reste sur disque, et ré-analyser crée une NOUVELLE proposition
 * tracée au journal, jamais un écrasement silencieux.
 * Journal d'audit : actions « analyse_% ».
 */
const bd = require('./bd');
const { journal } = require('./middleware');

const STATUTS = ['recu', 'en_cours', 'analyse', 'pret', 'a_reviser', 'insere', 'echec'];

function creerAnalyse(cabinetId, userId, { nomOrigine, chemin, mime, taille }) {
  const r = bd.prepare(`
    INSERT INTO analyses_documents (cabinet_id, utilisateur_id, nom_origine, chemin, mime, taille, statut)
    VALUES (?, ?, ?, ?, ?, ?, 'recu')
  `).run(cabinetId, userId, nomOrigine, chemin, mime || null, taille || null);
  journal(cabinetId, userId, 'analyse_recue',
    `Document « ${nomOrigine} » reçu pour analyse (analyse #${r.lastInsertRowid})`);
  return r.lastInsertRowid;
}

function obtenirAnalyse(id, cabinetId, { inclureArchives = false } = {}) {
  const a = bd.prepare(`
    SELECT * FROM analyses_documents WHERE id = ? AND cabinet_id = ?${inclureArchives ? '' : ' AND archive = 0'}
  `).get(id, cabinetId);
  if (!a) return null;
  a.champs = [];
  if (a.champs_proposes) {
    try { a.champs = JSON.parse(a.champs_proposes) || []; } catch (e) { a.champs = []; }
  }
  a.listes = {};
  if (a.listes_proposees) {
    try { a.listes = JSON.parse(a.listes_proposees) || {}; } catch (e) { a.listes = {}; }
  }
  a.reponsesCiblees = [];
  if (a.reponses_ciblees) {
    try { a.reponsesCiblees = JSON.parse(a.reponses_ciblees) || []; } catch (e) { a.reponsesCiblees = []; }
  }
  return a;
}

function listerAnalyses(cabinetId, { inclureArchives = false } = {}) {
  return bd.prepare(`
    SELECT a.*, u.nom AS utilisateur_nom
    FROM analyses_documents a
    LEFT JOIN users u ON u.id = a.utilisateur_id
    WHERE a.cabinet_id = ?${inclureArchives ? '' : ' AND a.archive = 0'}
    ORDER BY a.cree_le DESC, a.id DESC
  `).all(cabinetId);
}

function majStatut(id, cabinetId, statut, champs = {}) {
  if (!STATUTS.includes(statut)) throw new Error(`Statut d'analyse invalide : ${statut}`);
  const sets = ['statut = ?', "maj_le = datetime('now')"];
  const vals = [statut];
  for (const [cle, colonne] of [['message', 'message'], ['methodeExtraction', 'methode_extraction'], ['moteur', 'moteur']]) {
    if (champs[cle] !== undefined) { sets.push(`${colonne} = ?`); vals.push(champs[cle]); }
  }
  bd.prepare(`UPDATE analyses_documents SET ${sets.join(', ')} WHERE id = ? AND cabinet_id = ?`)
    .run(...vals, id, cabinetId);
}

function enregistrerExtraction(id, cabinetId, userId, { texte, methode }) {
  bd.prepare(`
    UPDATE analyses_documents
    SET texte_extrait = ?, methode_extraction = ?, statut = 'en_cours', maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(texte || null, methode || null, id, cabinetId);
  journal(cabinetId, userId, 'analyse_extraction',
    `Analyse #${id} : texte extrait (${methode}, ${(texte || '').length} caractères)`);
}

function enregistrerPropositions(id, cabinetId, userId, { produit, confianceGlobale, champs, listes, moteur, message }) {
  bd.prepare(`
    UPDATE analyses_documents
    SET produit_detecte = ?, confiance_globale = ?, champs_proposes = ?, listes_proposees = ?, moteur = ?,
        statut = 'a_reviser', message = ?, maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(produit || null, confianceGlobale ?? null, JSON.stringify(champs || []),
    JSON.stringify(listes || {}),
    moteur || null, message || null, id, cabinetId);
  const nbListes = Object.values(listes || {}).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);
  journal(cabinetId, userId, 'analyse_propositions',
    `Analyse #${id} : ${(champs || []).length} champ(s) proposé(s), ${nbListes} élément(s) de listes, produit « ${produit || 'indéterminé'} », moteur ${moteur || 'local'}`);
}

function marquerInseree(id, cabinetId, userId, { produit, soumissionId = null, policeId = null, documentId = null, detail = null }) {
  bd.prepare(`
    UPDATE analyses_documents
    SET statut = 'insere', produit_insere = ?, soumission_id = ?, police_id = ?, document_id = ?,
        maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(produit || null, soumissionId, policeId, documentId, id, cabinetId);
  journal(cabinetId, userId, 'analyse_inseree',
    `Analyse #${id} insérée : produit ${produit || '—'}, soumission ${soumissionId || '—'}, police ${policeId || '—'}${detail ? ` — ${detail}` : ''}`);
}

// Lie une analyse à une demande d'informations et au courriel source
// (boucle courriel, étape 3) : les propositions « ciblées » (réponses aux
// questions posées) sont stockées à part des champs génériques du moteur.
function lierDemande(id, cabinetId, demandeId, courrielId, ciblees = []) {
  bd.prepare(`
    UPDATE analyses_documents
    SET demande_info_id = ?, courriel_id = ?, reponses_ciblees = ?, maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(demandeId || null, courrielId || null, JSON.stringify(ciblees || []), id, cabinetId);
}

function archiverAnalyse(id, cabinetId, userId) {
  const a = obtenirAnalyse(id, cabinetId);
  if (!a) return false;
  bd.prepare("UPDATE analyses_documents SET archive = 1, maj_le = datetime('now') WHERE id = ? AND cabinet_id = ?")
    .run(id, cabinetId);
  journal(cabinetId, userId, 'analyse_archivee', `Analyse #${id} archivée (« ${a.nom_origine} »)`);
  return true;
}

function desarchiverAnalyse(id, cabinetId, userId) {
  const a = obtenirAnalyse(id, cabinetId, { inclureArchives: true });
  if (!a) return false;
  bd.prepare("UPDATE analyses_documents SET archive = 0, maj_le = datetime('now') WHERE id = ? AND cabinet_id = ?")
    .run(id, cabinetId);
  journal(cabinetId, userId, 'analyse_desarchivee', `Analyse #${id} désarchivée (« ${a.nom_origine} »)`);
  return true;
}

module.exports = {
  STATUTS,
  creerAnalyse, obtenirAnalyse, listerAnalyses,
  majStatut, enregistrerExtraction, enregistrerPropositions, marquerInseree, lierDemande,
  archiverAnalyse, desarchiverAnalyse,
};
