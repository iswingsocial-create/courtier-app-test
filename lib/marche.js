/**
 * lib/marche.js — Registre de mise en marché (formulaire F15 du
 * référentiel métier ; feuille de route d'automatisation, phase 1).
 *
 * Un envoi = UNE transmission d'UNE soumission (un des 9 produits) ou
 * d'UN dossier combiné à UN marché (assureur/grossiste de l'annuaire ou
 * nom libre). Le registre trace : marché et souscripteur (pré-rempli
 * depuis le contact « nouvelles affaires » de l'assureur), version de la
 * proposition transmise, documents, statut (brouillon → envoyé → en
 * analyse → questions → offre reçue / refusé / accepté / annulé),
 * questions en attente et leur responsable, relances (compteur, dates)
 * et offre reçue structurée (prime, limites/franchises, conditions,
 * validité) — qui alimentera le comparateur de la phase 2.
 *
 * Principes (inchangés) : le système prépare, l'humain envoie — le
 * courriel « demande de prix » part au clic seulement, en mode simulé
 * sans compte d'envoi actif (patron de la boucle courriel,
 * lib/demandes-infos.js). Règle d'or : aucune suppression — un envoi
 * s'annule par son statut ; chaque événement est conservé dans
 * marche_evenements et les transitions au journal d'audit.
 */
const bd = require('./bd');
const { journal } = require('./middleware');
const demandesInfos = require('./demandes-infos');
const { NOMS_PRODUITS } = demandesInfos;

const PRODUITS = ['auto', 'biens', 'rc', 'cyber', 'eo', 'do', 'pe', 'flotte', 'cautionnement'];
const TABLES_VERSIONS = {
  auto: 'auto_soumission_versions', biens: 'biens_soumission_versions',
  rc: 'rc_soumission_versions', cyber: 'cyber_soumission_versions',
  eo: 'eo_soumission_versions', do: 'do_soumission_versions',
  pe: 'pe_soumission_versions', flotte: 'flotte_soumission_versions',
  cautionnement: 'caut_soumission_versions',
};

const STATUTS_ENVOI = ['brouillon', 'envoye', 'en_analyse', 'questions', 'offre_recue', 'refuse', 'accepte', 'annule'];
const NOMS_STATUTS_ENVOI = {
  brouillon: '📝 Brouillon', envoye: '📤 Envoyé', en_analyse: '🔍 En analyse',
  questions: '❓ Questions', offre_recue: '💰 Offre reçue', refuse: '⛔ Refusé',
  accepte: '✅ Accepté', annule: '🚫 Annulé',
};
// Statuts « en attente d'une réponse du marché » (relances pertinentes).
const STATUTS_EN_ATTENTE = ['envoye', 'en_analyse', 'questions'];
// Transitions permises (jamais depuis un statut terminal).
const TRANSITIONS = {
  brouillon: ['envoye', 'annule'],
  envoye: ['en_analyse', 'questions', 'offre_recue', 'refuse', 'annule'],
  en_analyse: ['questions', 'offre_recue', 'refuse', 'annule'],
  questions: ['en_analyse', 'offre_recue', 'refuse', 'annule'],
  offre_recue: ['accepte', 'questions', 'annule'],
  refuse: [], accepte: [], annule: [],
};
const RESPONSABLES_QUESTIONS = ['client', 'courtier', 'assureur'];
const NOMS_RESPONSABLES = { client: 'Le client', courtier: 'Le courtier', assureur: "L'assureur" };
const DELAI_RELANCE_DEFAUT_JOURS = 7;

function maintenant() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
function aujourdhui() {
  return new Date().toISOString().slice(0, 10);
}
function dateDans(jours) {
  return new Date(Date.now() + jours * 86400000).toISOString().slice(0, 10);
}
function texte(v) {
  const s = String(v == null ? '' : v).trim();
  return s === '' ? null : s;
}
function montant(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// --- Cible : soumission d'un produit OU dossier combiné -------------------------
// Résolution + contrôle serveur « même client » : la cible doit exister
// dans le cabinet et son client est la source de vérité du rattachement.
function resoudreCible(cabinetId, { produit, soumissionId, combineDossierId } = {}) {
  if (combineDossierId || produit === 'combinee') {
    const combine = require('./combine');
    const d = combine.obtenirDossier(Number(combineDossierId), cabinetId);
    if (!d) throw new Error('Dossier combiné introuvable dans votre cabinet.');
    return {
      produit: 'combinee', soumissionId: null, combineDossierId: d.id,
      clientId: d.client_id,
      clientNom: d.client ? d.client.raison_sociale : null,
      titre: `Soumission combinée #${d.id}`,
    };
  }
  if (!PRODUITS.includes(produit)) throw new Error('Produit inconnu pour un envoi au marché.');
  const s = demandesInfos.chargerSoumission(produit, Number(soumissionId), cabinetId);
  if (!s) throw new Error('Soumission introuvable dans votre cabinet.');
  if (!s.client_id) throw new Error('Cette soumission n\u2019est rattachée à aucun client : rattachez-la d\u2019abord.');
  const client = bd.prepare('SELECT raison_sociale FROM clients WHERE id = ? AND cabinet_id = ?')
    .get(s.client_id, cabinetId);
  return {
    produit, soumissionId: s.id, combineDossierId: null,
    clientId: s.client_id,
    clientNom: client ? client.raison_sociale : null,
    titre: `Soumission ${NOMS_PRODUITS[produit] || produit} #${s.id}`,
  };
}

// Version courante de la proposition d'une cible (dernière version figée).
function versionCourante(cible) {
  if (cible.produit === 'combinee') return 'Proposition combinée (état courant)';
  const table = TABLES_VERSIONS[cible.produit];
  if (!table) return null;
  const r = bd.prepare(`SELECT MAX(version) AS v FROM ${table} WHERE soumission_id = ?`)
    .get(cible.soumissionId);
  return r && r.v ? `Version ${r.v}` : 'État courant (aucune version figée)';
}

function documentsParDefaut(cible) {
  if (cible.produit === 'combinee') {
    return ['Proposition combinée (demande de prix) générée par l\u2019application'];
  }
  return [`Proposition ${NOMS_PRODUITS[cible.produit] || cible.produit} générée par l\u2019application`];
}

// --- Événements ---------------------------------------------------------------------
function evenement(cabinetId, envoiId, userId, type, detail) {
  bd.prepare('INSERT INTO marche_evenements (cabinet_id, envoi_id, user_id, type, detail) VALUES (?, ?, ?, ?, ?)')
    .run(cabinetId, envoiId, userId || null, type, detail || null);
}
function listerEvenements(envoiId, cabinetId) {
  return bd.prepare(`
    SELECT e.*, u.nom AS auteur_nom FROM marche_evenements e
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.envoi_id = ? AND e.cabinet_id = ? ORDER BY e.id
  `).all(envoiId, cabinetId);
}

// --- Gabarits courriel ------------------------------------------------------------------
function genererSujetDemandePrix(cible) {
  return `Demande de soumission — ${cible.titre}${cible.clientNom ? ` — ${cible.clientNom}` : ''}`;
}
function genererCorpsDemandePrix({ cible, envoi, auteurNom }) {
  const lignes = ['Bonjour' + (envoi.souscripteur_nom ? ` ${envoi.souscripteur_nom}` : '') + ',', ''];
  lignes.push(`Nous vous transmettons une demande de soumission pour notre client ${cible.clientNom || ''} :`);
  lignes.push(`- Dossier : ${cible.titre}`);
  if (envoi.version_proposition) lignes.push(`- Proposition transmise : ${envoi.version_proposition}`);
  const docs = envoi.documents || [];
  if (docs.length) {
    lignes.push('', 'Documents transmis :');
    for (const doc of docs) lignes.push(`- ${doc}`);
  }
  lignes.push('', 'Nous vous serions reconnaissants de nous faire parvenir votre proposition (prime, limites, franchises et conditions) ou, le cas échéant, vos questions et précisions requises.');
  lignes.push('', 'Merci de votre collaboration.', '', 'Cordialement,', auteurNom || '');
  return lignes.join('\n');
}
function genererSujetRelance(cible) {
  return `Relance — demande de soumission — ${cible.titre}${cible.clientNom ? ` — ${cible.clientNom}` : ''}`;
}
function genererCorpsRelance({ cible, envoi, auteurNom }) {
  const lignes = ['Bonjour' + (envoi.souscripteur_nom ? ` ${envoi.souscripteur_nom}` : '') + ',', ''];
  lignes.push(`Je me permets de revenir vers vous au sujet de la demande de soumission transmise pour notre client ${cible.clientNom || ''} (${cible.titre}${envoi.transmis_le ? `, transmise le ${envoi.transmis_le.slice(0, 10)}` : ''}).`);
  if (envoi.statut === 'questions' && envoi.questions_en_attente) {
    lignes.push('', 'Votre réponse aux questions en attente nous permettrait de faire avancer le dossier :', envoi.questions_en_attente);
  } else {
    lignes.push('', 'Nous demeurons en attente de votre proposition ou de vos questions afin de faire avancer le dossier.');
  }
  lignes.push('', 'Merci de votre collaboration.', '', 'Cordialement,', auteurNom || '');
  return lignes.join('\n');
}

// --- Création -----------------------------------------------------------------------------
function creerEnvoi(cabinetId, utilisateur, data = {}) {
  const cible = resoudreCible(cabinetId, data);
  // Marché : annuaire (pré-remplissage nouvelles affaires) ou nom libre.
  let assureur = null;
  if (data.assureurId) {
    assureur = bd.prepare('SELECT * FROM assureurs WHERE id = ? AND cabinet_id = ? AND archive = 0')
      .get(Number(data.assureurId), cabinetId);
    if (!assureur) throw new Error('Assureur introuvable dans l\u2019annuaire de votre cabinet.');
  }
  const marcheNom = texte(data.marcheNom) || (assureur ? assureur.nom : null);
  if (!marcheNom) throw new Error('Choisissez un marché dans l\u2019annuaire ou indiquez son nom.');
  const souscripteurNom = texte(data.souscripteurNom) || (assureur ? texte(assureur.na_nom) : null);
  const souscripteurCourriel = texte(data.souscripteurCourriel) || (assureur ? texte(assureur.na_courriel) : null);
  const version = texte(data.versionProposition) || versionCourante(cible);
  let documents = Array.isArray(data.documents) ? data.documents.map((x) => String(x).trim()).filter(Boolean) : [];
  if (!documents.length) documents = documentsParDefaut(cible);
  const r = bd.prepare(`
    INSERT INTO marche_envois (cabinet_id, produit, soumission_id, combine_dossier_id, client_id,
      assureur_id, marche_nom, souscripteur_nom, souscripteur_courriel, statut,
      version_proposition, documents_transmis, autorite_intermediaire,
      date_relance, prochaine_action, prochaine_action_echeance, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'brouillon', ?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, cible.produit, cible.soumissionId, cible.combineDossierId, cible.clientId,
    assureur ? assureur.id : null, marcheNom, souscripteurNom, souscripteurCourriel,
    version, JSON.stringify(documents), texte(data.autoriteIntermediaire),
    texte(data.dateRelance), texte(data.prochaineAction), texte(data.prochaineActionEcheance),
    utilisateur.id);
  const envoiId = r.lastInsertRowid;
  evenement(cabinetId, envoiId, utilisateur.id, 'creation',
    `Envoi créé (brouillon) — marché : ${marcheNom}${souscripteurNom ? `, souscripteur : ${souscripteurNom}` : ''} ; ${version || 'version non précisée'} ; ${documents.length} document(s) déclaré(s).`);
  journal(cabinetId, utilisateur.id, 'marche_envoi_cree',
    `Envoi de mise en marché #${envoiId} créé (brouillon) : ${cible.titre} → ${marcheNom}`);
  // Brouillon courriel « demande de prix » prêt à réviser (patron boucle courriel).
  const envoi = obtenirEnvoi(envoiId, cabinetId);
  const brouillonId = creerBrouillonCourriel(cabinetId, utilisateur, envoi, 'demande_prix');
  return { envoi: obtenirEnvoi(envoiId, cabinetId), brouillonId };
}

function creerBrouillonCourriel(cabinetId, utilisateur, envoi, type) {
  const cible = {
    produit: envoi.produit, soumissionId: envoi.soumission_id,
    combineDossierId: envoi.combine_dossier_id, clientId: envoi.client_id,
    clientNom: envoi.client_nom || null,
    titre: envoi.produit === 'combinee'
      ? `Soumission combinée #${envoi.combine_dossier_id}`
      : `Soumission ${NOMS_PRODUITS[envoi.produit] || envoi.produit} #${envoi.soumission_id}`,
  };
  const sujet = type === 'relance' ? genererSujetRelance(cible) : genererSujetDemandePrix(cible);
  const corps = type === 'relance'
    ? genererCorpsRelance({ cible, envoi, auteurNom: utilisateur.nom })
    : genererCorpsDemandePrix({ cible, envoi, auteurNom: utilisateur.nom });
  const r = bd.prepare(`
    INSERT INTO marche_courriels (cabinet_id, envoi_id, type, destinataire, sujet, corps, statut, cree_par)
    VALUES (?, ?, ?, ?, ?, ?, 'brouillon', ?)
  `).run(cabinetId, envoi.id, type, envoi.souscripteur_courriel || null, sujet, corps, utilisateur.id);
  return r.lastInsertRowid;
}

// --- Lectures --------------------------------------------------------------------------------
function ligneEnvoi(id, cabinetId) {
  return bd.prepare(`
    SELECT e.*, c.raison_sociale AS client_nom, c.responsable_id AS client_responsable_id
    FROM marche_envois e JOIN clients c ON c.id = e.client_id
    WHERE e.id = ? AND e.cabinet_id = ?
  `).get(id, cabinetId);
}

function obtenirEnvoi(id, cabinetId, { complet = true } = {}) {
  const e = ligneEnvoi(id, cabinetId);
  if (!e) return null;
  try { e.documents = JSON.parse(e.documents_transmis || '[]'); } catch (err) { e.documents = []; }
  if (!Array.isArray(e.documents)) e.documents = [];
  if (complet) {
    e.evenements = listerEvenements(e.id, cabinetId);
    e.brouillons = bd.prepare(`
      SELECT * FROM marche_courriels WHERE envoi_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC
    `).all(e.id, cabinetId);
    e.courrielsLies = bd.prepare(`
      SELECT id, dossier, expediteur, destinataires, sujet, date_courriel, cree_le, classement_methode
      FROM courriels WHERE cabinet_id = ? AND envoi_id = ? AND archive = 0 ORDER BY cree_le DESC
    `).all(cabinetId, e.id);
  }
  return e;
}

// Filtres : statut, assureurId, marcheNom (recherche), clientId, relancesDues.
// req (optionnel) : applique le cloisonnement portefeuille des courtiers.
function listerEnvois(cabinetId, filtres = {}, req = null) {
  const conds = ['e.cabinet_id = ?', 'e.archive = 0'];
  const params = [cabinetId];
  if (filtres.statut && STATUTS_ENVOI.includes(filtres.statut)) {
    conds.push('e.statut = ?'); params.push(filtres.statut);
  }
  if (filtres.assureurId) { conds.push('e.assureur_id = ?'); params.push(Number(filtres.assureurId)); }
  if (filtres.marcheNom) { conds.push('e.marche_nom LIKE ?'); params.push(`%${filtres.marcheNom}%`); }
  if (filtres.clientId) { conds.push('e.client_id = ?'); params.push(Number(filtres.clientId)); }
  if (filtres.relancesDues) {
    conds.push(`e.statut IN ('envoye','en_analyse','questions') AND e.date_relance IS NOT NULL AND e.date_relance <= ?`);
    params.push(aujourdhui());
  }
  if (req) {
    const { clausePortefeuille } = require('./middleware');
    // clausePortefeuille produit un fragment « AND c.responsable_id = N ».
    const frag = clausePortefeuille(req, 'c');
    if (frag) conds.push(frag.replace(/^\s*AND\s+/i, ''));
  }
  return bd.prepare(`
    SELECT e.*, c.raison_sociale AS client_nom
    FROM marche_envois e JOIN clients c ON c.id = e.client_id
    WHERE ${conds.join(' AND ')}
    ORDER BY (e.date_relance IS NULL), e.date_relance, e.id DESC
  `).all(...params).map((e) => {
    try { e.documents = JSON.parse(e.documents_transmis || '[]'); } catch (err) { e.documents = []; }
    e.relanceDue = STATUTS_EN_ATTENTE.includes(e.statut) && e.date_relance && e.date_relance <= aujourdhui();
    return e;
  });
}

function listerPourCible(cabinetId, { produit, soumissionId, combineDossierId } = {}) {
  const conds = ['cabinet_id = ?', 'archive = 0'];
  const params = [cabinetId];
  if (combineDossierId) { conds.push('combine_dossier_id = ?'); params.push(Number(combineDossierId)); }
  else { conds.push('produit = ? AND soumission_id = ?'); params.push(produit, Number(soumissionId)); }
  const ids = bd.prepare(`SELECT id FROM marche_envois WHERE ${conds.join(' AND ')} ORDER BY id DESC`)
    .all(...params).map((r) => r.id);
  return ids.map((id) => obtenirEnvoi(id, cabinetId, { complet: false }));
}

// Section pour les fiches soumission / combinée : envois du dossier +
// signal « aucun envoi au marché » (alignement calculerManques).
function sectionPourCible(cabinetId, cible) {
  const envois = listerPourCible(cabinetId, cible);
  return {
    produit: cible.produit,
    soumissionId: cible.soumissionId || null,
    combineDossierId: cible.combineDossierId || null,
    envois,
    aucunEnvoi: envois.length === 0,
    envoisActifs: envois.filter((e) => !['annule'].includes(e.statut)).length,
  };
}

function indicateurs(cabinetId, req = null) {
  const tous = listerEnvois(cabinetId, {}, req);
  return {
    total: tous.length,
    enCours: tous.filter((e) => STATUTS_EN_ATTENTE.includes(e.statut) || e.statut === 'brouillon').length,
    relancesDues: tous.filter((e) => e.relanceDue).length,
    offresRecues: tous.filter((e) => e.statut === 'offre_recue').length,
    refus: tous.filter((e) => e.statut === 'refuse').length,
  };
}

function relancesDues(cabinetId, req = null) {
  return listerEnvois(cabinetId, { relancesDues: true }, req);
}

// --- Modifications et transitions -------------------------------------------------------------
function majEnvoi(id, cabinetId, utilisateur, data = {}) {
  const e = obtenirEnvoi(id, cabinetId, { complet: false });
  if (!e) throw new Error('Envoi introuvable.');
  if (['accepte', 'annule', 'refuse'].includes(e.statut)) {
    throw new Error('Cet envoi est clos : ses champs ne sont plus modifiables.');
  }
  const champs = {
    marche_nom: texte(data.marcheNom) || e.marche_nom,
    souscripteur_nom: texte(data.souscripteurNom),
    souscripteur_courriel: texte(data.souscripteurCourriel),
    version_proposition: texte(data.versionProposition),
    autorite_intermediaire: texte(data.autoriteIntermediaire),
    date_relance: texte(data.dateRelance),
    prochaine_action: texte(data.prochaineAction),
    prochaine_action_echeance: texte(data.prochaineActionEcheance),
  };
  if (Array.isArray(data.documents)) {
    champs.documents_transmis = JSON.stringify(data.documents.map((x) => String(x).trim()).filter(Boolean));
  }
  bd.prepare(`
    UPDATE marche_envois SET marche_nom = ?, souscripteur_nom = ?, souscripteur_courriel = ?,
      version_proposition = ?, autorite_intermediaire = ?, date_relance = ?,
      prochaine_action = ?, prochaine_action_echeance = ?,
      documents_transmis = COALESCE(?, documents_transmis), maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(champs.marche_nom, champs.souscripteur_nom, champs.souscripteur_courriel,
    champs.version_proposition, champs.autorite_intermediaire, champs.date_relance,
    champs.prochaine_action, champs.prochaine_action_echeance,
    champs.documents_transmis || null, id, cabinetId);
  journal(cabinetId, utilisateur.id, 'marche_envoi_modifie', `Envoi de mise en marché #${id} modifié`);
  return obtenirEnvoi(id, cabinetId);
}

function transitionner(id, cabinetId, utilisateur, nouveauStatut, { typeEvenement = 'statut', detail = '' } = {}) {
  const e = obtenirEnvoi(id, cabinetId, { complet: false });
  if (!e) throw new Error('Envoi introuvable.');
  const permises = TRANSITIONS[e.statut] || [];
  if (!permises.includes(nouveauStatut)) {
    throw new Error(`Transition impossible : ${NOMS_STATUTS_ENVOI[e.statut] || e.statut} → ${NOMS_STATUTS_ENVOI[nouveauStatut] || nouveauStatut}.`);
  }
  bd.prepare("UPDATE marche_envois SET statut = ?, maj_le = datetime('now') WHERE id = ? AND cabinet_id = ?")
    .run(nouveauStatut, id, cabinetId);
  evenement(cabinetId, id, utilisateur.id, typeEvenement,
    detail || `Statut : ${NOMS_STATUTS_ENVOI[e.statut] || e.statut} → ${NOMS_STATUTS_ENVOI[nouveauStatut] || nouveauStatut}.`);
  journal(cabinetId, utilisateur.id, 'marche_envoi_statut',
    `Envoi de mise en marché #${id} : ${e.statut} → ${nouveauStatut}${detail ? ` — ${detail}` : ''}`);
  return obtenirEnvoi(id, cabinetId);
}

// Transmission marquée à la main (envoi fait hors application : portail,
// téléphone…) — équivalent manuel de l'envoi du courriel.
function marquerTransmis(id, cabinetId, utilisateur, { dateRelance = null } = {}) {
  const e = obtenirEnvoi(id, cabinetId, { complet: false });
  if (!e) throw new Error('Envoi introuvable.');
  if (e.statut !== 'brouillon') throw new Error('Cet envoi a déjà été transmis.');
  bd.prepare(`
    UPDATE marche_envois SET statut = 'envoye', transmis_le = datetime('now'), mode_transmission = 'manuel',
      date_relance = COALESCE(?, date_relance), maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(texte(dateRelance) || dateDans(DELAI_RELANCE_DEFAUT_JOURS), id, cabinetId);
  evenement(cabinetId, id, utilisateur.id, 'transmission',
    'Transmission marquée manuellement (envoi fait hors application).');
  journal(cabinetId, utilisateur.id, 'marche_envoi_transmis',
    `Envoi de mise en marché #${id} transmis (marquage manuel) → ${e.marche_nom}`);
  return obtenirEnvoi(id, cabinetId);
}

function enregistrerQuestions(id, cabinetId, utilisateur, { texteQuestions, responsable } = {}) {
  const tq = texte(texteQuestions);
  if (!tq) throw new Error('Inscrivez les questions du marché.');
  const resp = RESPONSABLES_QUESTIONS.includes(responsable) ? responsable : 'courtier';
  const e = obtenirEnvoi(id, cabinetId, { complet: false });
  if (!e) throw new Error('Envoi introuvable.');
  if (e.statut === 'questions') {
    bd.prepare(`
      UPDATE marche_envois SET questions_en_attente = ?, questions_responsable = ?, maj_le = datetime('now')
      WHERE id = ? AND cabinet_id = ?
    `).run(tq, resp, id, cabinetId);
    evenement(cabinetId, id, utilisateur.id, 'question',
      `Questions mises à jour (responsable de la réponse : ${NOMS_RESPONSABLES[resp]}) : ${tq}`);
    journal(cabinetId, utilisateur.id, 'marche_envoi_questions',
      `Envoi de mise en marché #${id} : questions mises à jour`);
    return obtenirEnvoi(id, cabinetId);
  }
  bd.prepare('UPDATE marche_envois SET questions_en_attente = ?, questions_responsable = ? WHERE id = ? AND cabinet_id = ?')
    .run(tq, resp, id, cabinetId);
  return transitionner(id, cabinetId, utilisateur, 'questions', {
    typeEvenement: 'question',
    detail: `Questions du marché (responsable de la réponse : ${NOMS_RESPONSABLES[resp]}) : ${tq}`,
  });
}

// Les questions ont reçu leur réponse : retour à l'analyse du marché.
function questionsResolues(id, cabinetId, utilisateur) {
  const e = obtenirEnvoi(id, cabinetId, { complet: false });
  if (!e) throw new Error('Envoi introuvable.');
  if (e.statut !== 'questions') throw new Error('Cet envoi n\u2019est pas en attente de questions.');
  bd.prepare('UPDATE marche_envois SET questions_en_attente = NULL, questions_responsable = NULL WHERE id = ? AND cabinet_id = ?')
    .run(id, cabinetId);
  return transitionner(id, cabinetId, utilisateur, 'en_analyse', {
    typeEvenement: 'question', detail: 'Questions résolues : le dossier retourne en analyse au marché.',
  });
}

function saisirOffre(id, cabinetId, utilisateur, { prime, limites, conditions, validite } = {}) {
  const e = obtenirEnvoi(id, cabinetId, { complet: false });
  if (!e) throw new Error('Envoi introuvable.');
  const p = montant(prime);
  if (p === null) throw new Error('Inscrivez la prime proposée par le marché.');
  bd.prepare(`
    UPDATE marche_envois SET offre_prime = ?, offre_limites = ?, offre_conditions = ?, offre_validite = ?
    WHERE id = ? AND cabinet_id = ?
  `).run(p, texte(limites), texte(conditions), texte(validite), id, cabinetId);
  const detail = `Offre reçue de ${e.marche_nom} : prime proposée ${p.toLocaleString('fr-CA')} $` +
    (texte(validite) ? `, valide jusqu'au ${texte(validite)}` : '') +
    (texte(limites) ? ` — limites/franchises : ${texte(limites)}` : '') +
    (texte(conditions) ? ` — conditions : ${texte(conditions)}` : '');
  if (e.statut === 'offre_recue') {
    evenement(cabinetId, id, utilisateur.id, 'offre', detail + ' (offre mise à jour)');
    journal(cabinetId, utilisateur.id, 'marche_envoi_offre', `Envoi de mise en marché #${id} : offre mise à jour`);
    bd.prepare("UPDATE marche_envois SET maj_le = datetime('now') WHERE id = ? AND cabinet_id = ?").run(id, cabinetId);
    return obtenirEnvoi(id, cabinetId);
  }
  return transitionner(id, cabinetId, utilisateur, 'offre_recue', { typeEvenement: 'offre', detail });
}

function enregistrerRefus(id, cabinetId, utilisateur, { motif } = {}) {
  const m = texte(motif);
  if (!m) throw new Error('Inscrivez le motif du refus communiqué par le marché.');
  const e = obtenirEnvoi(id, cabinetId, { complet: false });
  if (!e) throw new Error('Envoi introuvable.');
  bd.prepare('UPDATE marche_envois SET motif_refus = ? WHERE id = ? AND cabinet_id = ?').run(m, id, cabinetId);
  return transitionner(id, cabinetId, utilisateur, 'refuse', {
    typeEvenement: 'refus', detail: `Refus de ${e.marche_nom} — motif : ${m}`,
  });
}

function accepter(id, cabinetId, utilisateur) {
  const e = obtenirEnvoi(id, cabinetId, { complet: false });
  if (!e) throw new Error('Envoi introuvable.');
  return transitionner(id, cabinetId, utilisateur, 'accepte', {
    detail: `Offre de ${e.marche_nom} acceptée (statut du registre ; la décision formelle du client relève de la phase 2 — F16).`,
  });
}

function annuler(id, cabinetId, utilisateur, { motif = '' } = {}) {
  return transitionner(id, cabinetId, utilisateur, 'annule', {
    detail: `Envoi annulé${texte(motif) ? ` — ${texte(motif)}` : ''}.`,
  });
}

// --- Brouillons courriel : modification et envoi ------------------------------------------------
function obtenirBrouillonCourriel(id, cabinetId) {
  return bd.prepare('SELECT * FROM marche_courriels WHERE id = ? AND cabinet_id = ? AND archive = 0')
    .get(id, cabinetId) || null;
}

function majBrouillonCourriel(id, cabinetId, utilisateur, { destinataire, sujet, corps }) {
  const b = obtenirBrouillonCourriel(id, cabinetId);
  if (!b) throw new Error('Brouillon introuvable.');
  if (b.statut !== 'brouillon') throw new Error('Seul un brouillon peut être modifié.');
  bd.prepare(`
    UPDATE marche_courriels SET destinataire = ?, sujet = ?, corps = ?, maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(texte(destinataire), sujet, corps, id, cabinetId);
  journal(cabinetId, utilisateur.id, 'marche_courriel_modifie',
    `Brouillon de mise en marché #${id} (${b.type}) modifié`);
  return obtenirBrouillonCourriel(id, cabinetId);
}

function preparerRelance(id, cabinetId, utilisateur) {
  const e = obtenirEnvoi(id, cabinetId, { complet: false });
  if (!e) throw new Error('Envoi introuvable.');
  if (!STATUTS_EN_ATTENTE.includes(e.statut)) {
    throw new Error('Seul un envoi en attente (envoyé, en analyse ou en questions) peut être relancé.');
  }
  const existant = bd.prepare(`
    SELECT id FROM marche_courriels WHERE envoi_id = ? AND cabinet_id = ? AND archive = 0
      AND type = 'relance' AND statut = 'brouillon' ORDER BY id DESC LIMIT 1
  `).get(id, cabinetId);
  if (existant) return existant.id;
  return creerBrouillonCourriel(cabinetId, utilisateur, e, 'relance');
}

async function envoyerBrouillonCourriel(id, cabinetId, utilisateur) {
  const b = obtenirBrouillonCourriel(id, cabinetId);
  if (!b) throw new Error('Brouillon introuvable.');
  if (b.statut !== 'brouillon') throw new Error('Ce courriel a déjà été envoyé.');
  const e = obtenirEnvoi(b.envoi_id, cabinetId, { complet: false });
  if (!e) throw new Error('Envoi introuvable.');
  const destinataire = String(b.destinataire || '').trim();
  if (!destinataire || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinataire)) {
    throw new Error('Adresse destinataire invalide : corrigez-la avant l\u2019envoi.');
  }
  const compte = bd.prepare(
    'SELECT * FROM courriel_comptes WHERE cabinet_id = ? AND actif = 1 AND archive = 0 ORDER BY nom LIMIT 1'
  ).get(cabinetId);
  let mode = 'simule';
  let messageId = `simule-marche-${id}-${Date.now()}@courtier.local`;
  let courrielId = null;
  if (compte) {
    const courrielsLib = require('./courriels');
    const envoiSmtp = await courrielsLib.envoyerCourriel(bd, compte, {
      a: destinataire, sujet: b.sujet, texte: b.corps,
    });
    mode = 'smtp';
    messageId = envoiSmtp.messageId || null;
    if (messageId) {
      const copie = bd.prepare(
        "SELECT id FROM courriels WHERE cabinet_id = ? AND message_id = ? AND dossier = 'envoyes' ORDER BY id DESC LIMIT 1"
      ).get(cabinetId, messageId);
      courrielId = copie ? copie.id : null;
      if (courrielId) {
        bd.prepare('UPDATE courriels SET envoi_id = ? WHERE id = ?').run(e.id, courrielId);
      }
    }
  }
  bd.prepare(`
    UPDATE marche_courriels SET statut = 'envoye', mode_envoi = ?, message_id = ?, courriel_id = ?,
      envoye_le = datetime('now'), maj_le = datetime('now')
    WHERE id = ? AND cabinet_id = ?
  `).run(mode, messageId, courrielId, id, cabinetId);
  const modeTxt = mode === 'simule' ? 'SIMULÉ (aucun compte d\u2019envoi configuré, aucun courriel réel n\u2019est parti)' : 'SMTP via le compte du cabinet';
  if (b.type === 'demande_prix') {
    bd.prepare(`
      UPDATE marche_envois SET statut = 'envoye', transmis_le = datetime('now'), mode_transmission = 'courriel',
        date_relance = COALESCE(date_relance, ?), maj_le = datetime('now')
      WHERE id = ? AND cabinet_id = ?
    `).run(dateDans(DELAI_RELANCE_DEFAUT_JOURS), e.id, cabinetId);
    evenement(cabinetId, e.id, utilisateur.id, 'transmission',
      `Demande de prix transmise à ${destinataire} — mode ${modeTxt}.`);
    journal(cabinetId, utilisateur.id, 'marche_envoi_transmis',
      `Envoi de mise en marché #${e.id} transmis par courriel à ${destinataire} — mode ${mode === 'simule' ? 'SIMULÉ' : 'SMTP'}`);
  } else {
    bd.prepare(`
      UPDATE marche_envois SET nb_relances = nb_relances + 1, derniere_relance_le = datetime('now'),
        date_relance = ?, maj_le = datetime('now')
      WHERE id = ? AND cabinet_id = ?
    `).run(dateDans(DELAI_RELANCE_DEFAUT_JOURS), e.id, cabinetId);
    evenement(cabinetId, e.id, utilisateur.id, 'relance',
      `Relance n° ${(e.nb_relances || 0) + 1} transmise à ${destinataire} — mode ${modeTxt}. Prochaine relance : ${dateDans(DELAI_RELANCE_DEFAUT_JOURS)}.`);
    journal(cabinetId, utilisateur.id, 'marche_envoi_relance',
      `Envoi de mise en marché #${e.id} relancé (n° ${(e.nb_relances || 0) + 1}) — mode ${mode === 'simule' ? 'SIMULÉ' : 'SMTP'}`);
  }
  return { brouillon: obtenirBrouillonCourriel(id, cabinetId), envoi: obtenirEnvoi(e.id, cabinetId), mode };
}

module.exports = {
  PRODUITS, STATUTS_ENVOI, NOMS_STATUTS_ENVOI, STATUTS_EN_ATTENTE, TRANSITIONS,
  RESPONSABLES_QUESTIONS, NOMS_RESPONSABLES, DELAI_RELANCE_DEFAUT_JOURS, NOMS_PRODUITS,
  resoudreCible, versionCourante, documentsParDefaut,
  genererSujetDemandePrix, genererCorpsDemandePrix, genererSujetRelance, genererCorpsRelance,
  creerEnvoi, creerBrouillonCourriel, obtenirEnvoi, listerEnvois, listerPourCible,
  sectionPourCible, indicateurs, relancesDues, majEnvoi, transitionner, marquerTransmis,
  enregistrerQuestions, questionsResolues, saisirOffre, enregistrerRefus, accepter, annuler,
  obtenirBrouillonCourriel, majBrouillonCourriel, preparerRelance, envoyerBrouillonCourriel,
  evenement,
};
