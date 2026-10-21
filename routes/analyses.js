/**
 * routes/analyses.js — Module « Analyse de documents IA » :
 * téléverser un document (police d'assureur, proposition remplie, scan,
 * photo) → extraction du texte (PDF natif ou OCR local) → le moteur propose
 * des champs → RÉVISION HUMAINE obligatoire → insertion (étape 3).
 *
 * Règle d'or : le document et l'analyse ne sont jamais supprimés
 * (archivage doux, restorable). Aucune insertion sans confirmation.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const bd = require('../lib/bd');
const analyses = require('../lib/analyses-documents');
const extraction = require('../lib/extraction-document');
const moteurAnalyse = require('../lib/analyse-document');
const insertion = require('../lib/analyse-insertion');
const reglagesIA = require('../lib/reglages-ia');
const { exigeAuth, exigeMotDePasseChange, journal, clientHorsPortefeuille, reponseHorsPortefeuille, verifieCsrf } = require('../lib/middleware');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const NOMS_STATUTS = {
  recu: 'Reçu', en_cours: 'Extraction…', analyse: 'Analysé', pret: 'Prêt',
  a_reviser: 'À réviser', insere: 'Inséré', echec: 'Échec',
};
const NOMS_PRODUITS = {
  auto: 'Auto (FPQ1)', biens: 'Biens', rc: 'RC', cyber: 'Cyber', eo: 'E&O',
  do: 'D&O', pe: "Perte d'exploitation", flotte: 'Flotte', cautionnement: 'Cautionnement',
};

function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

function analyseAutorisee(req, res, inclureArchives = false) {
  const a = analyses.obtenirAnalyse(Number(req.params.id), res.locals.cabinetId, { inclureArchives });
  if (!a) { pageErreur(res, 404, 'Introuvable', 'Analyse introuvable.'); return null; }
  return a;
}

// --- Téléversement (mêmes formats que les documents de police) -------------------
const stockage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', String(req.utilisateur.cabinet_id), 'analyses');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const base = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    cb(null, Date.now() + '-' + base);
  },
});
const televersement = multer({
  storage: stockage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^(application\/pdf|image\/(png|jpeg)|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))$/.test(file.mimetype)
      || /\.csv$/i.test(file.originalname || '') || /csv/.test(file.mimetype || '');
    cb(ok ? null : new Error('Type de fichier non accepté (PDF, images PNG/JPEG, Word, Excel, CSV).'), ok);
  },
});

router.get('/', (req, res) => {
  const liste = analyses.listerAnalyses(res.locals.cabinetId, { inclureArchives: req.query.archives === '1' });
  res.render('analyses/liste', {
    analyses: liste, NOMS_STATUTS, NOMS_PRODUITS,
    moteur: reglagesIA.moteurEffectif(res.locals.cabinetId),
    avecArchives: req.query.archives === '1',
    ok: req.query.ok || null,
  });
});

router.post('/', televersement.single('document'), verifieCsrf, async (req, res) => {
  if (!req.file) {
    return pageErreur(res, 400, 'Aucun fichier', 'Choisissez un fichier à analyser.');
  }
  const cabinetId = res.locals.cabinetId;
  const userId = req.utilisateur.id;
  const id = analyses.creerAnalyse(cabinetId, userId, {
    nomOrigine: req.file.originalname, chemin: req.file.path,
    mime: req.file.mimetype, taille: req.file.size,
  });
  try {
    analyses.majStatut(id, cabinetId, 'en_cours');
    const ext = await extraction.extraireTexte({
      chemin: req.file.path, mime: req.file.mimetype, nom: req.file.originalname,
    });
    analyses.enregistrerExtraction(id, cabinetId, userId, { texte: ext.texte, methode: ext.methode });
    if (!ext.texte) {
      analyses.majStatut(id, cabinetId, 'echec', { message: ext.avertissement, methodeExtraction: ext.methode });
      return res.redirect('/analyses?ok=echec');
    }
    const r = await moteurAnalyse.analyser(ext.texte, { cabinetId, tableau: ext.tableau || null });
    analyses.enregistrerPropositions(id, cabinetId, userId, {
      produit: r.produit, confianceGlobale: r.confiance, champs: r.champs, listes: r.listes,
      moteur: r.moteur, message: [ext.avertissement, r.message].filter(Boolean).join(' ') || null,
    });
    return res.redirect('/analyses/' + id);
  } catch (e) {
    analyses.majStatut(id, cabinetId, 'echec', { message: `Analyse impossible : ${e.message}` });
    return res.redirect('/analyses?ok=echec');
  }
}, (err, req, res, next) => {
  res.status(400).render('erreur', { titre: 'Téléversement refusé', message: err.message });
});

// Ré-analyser : relance extraction + moteur sur le fichier conservé.
// Les propositions précédentes restent au journal ; la fiche est mise à jour.
router.post('/:id/relancer', async (req, res) => {
  const a = analyseAutorisee(req, res, true);
  if (!a) return;
  const cabinetId = res.locals.cabinetId;
  const userId = req.utilisateur.id;
  try {
    analyses.majStatut(a.id, cabinetId, 'en_cours');
    const ext = await extraction.extraireTexte({ chemin: a.chemin, mime: a.mime, nom: a.nom_origine });
    analyses.enregistrerExtraction(a.id, cabinetId, userId, { texte: ext.texte, methode: ext.methode });
    if (!ext.texte) {
      analyses.majStatut(a.id, cabinetId, 'echec', { message: ext.avertissement, methodeExtraction: ext.methode });
      return res.redirect('/analyses/' + a.id);
    }
    const r = await moteurAnalyse.analyser(ext.texte, { cabinetId, tableau: ext.tableau || null });
    analyses.enregistrerPropositions(a.id, cabinetId, userId, {
      produit: r.produit, confianceGlobale: r.confiance, champs: r.champs, listes: r.listes,
      moteur: r.moteur, message: [ext.avertissement, r.message].filter(Boolean).join(' ') || null,
    });
    journal(cabinetId, userId, 'analyse_relancee', `Analyse #${a.id} relancée (« ${a.nom_origine} »)`);
  } catch (e) {
    analyses.majStatut(a.id, cabinetId, 'echec', { message: `Analyse impossible : ${e.message}` });
  }
  res.redirect('/analyses/' + a.id);
});

const TABLES_SOUMISSIONS_EXISTANTES = {
  auto: 'auto_soumissions', biens: 'biens_soumissions', rc: 'rc_soumissions',
  cyber: 'cyber_soumissions', eo: 'eo_soumissions', do: 'do_soumissions',
  pe: 'pe_soumissions', flotte: 'flotte_soumissions', cautionnement: 'caut_soumissions',
};

router.get('/:id', (req, res) => {
  const a = analyseAutorisee(req, res, true);
  if (!a) return;
  const polices = bd.prepare(`
    SELECT p.id, p.client_id, p.numero_police, p.ligne, p.assureur, c.raison_sociale
    FROM polices p JOIN clients c ON c.id = p.client_id
    WHERE p.cabinet_id = ? ORDER BY p.date_echeance
  `).all(res.locals.cabinetId);
  // Cible « Ajouter à une soumission existante » (v2) : soumissions non
  // archivées du cabinet, tous produits, pour le sélecteur de la révision.
  // Chaque option porte son client_id : la révision ne propose que les
  // soumissions DU client choisi (et du produit choisi) — correctif
  // demandé par Patrick : un document, ses soumissions et ses polices
  // appartiennent au même client.
  const soumissionsExistantes = [];
  for (const [produit, table] of Object.entries(TABLES_SOUMISSIONS_EXISTANTES)) {
    const lignes = bd.prepare(`
      SELECT s.id, s.client_id, s.statut, s.cree_le, c.raison_sociale
      FROM ${table} s LEFT JOIN clients c ON c.id = s.client_id
      WHERE s.cabinet_id = ? AND s.archive = 0
      ORDER BY s.id DESC LIMIT 100
    `).all(res.locals.cabinetId);
    for (const l of lignes) soumissionsExistantes.push({ produit, ...l });
  }
  // Analyse liée à une demande d'informations (boucle courriel) : la fiche
  // affiche les réponses aux questions posées et pré-sélectionne la
  // soumission de la demande comme cible.
  let demandeLiee = null;
  if (a.demande_info_id) {
    const demandesInfos = require('../lib/demandes-infos');
    demandeLiee = demandesInfos.obtenirDemande(a.demande_info_id, res.locals.cabinetId);
  }
  // --- Client du document (correctif) ------------------------------------
  // Le client se choisit AVANT les rattachements. Pré-sélection : le client
  // résolu par lecture seule depuis la raison sociale extraite. Analyse
  // liée à une demande : le client est celui de la demande, VERROUILLÉ.
  const clients = bd.prepare(`
    SELECT id, raison_sociale FROM clients
    WHERE cabinet_id = ? AND archive = 0 ORDER BY raison_sociale
  `).all(res.locals.cabinetId);
  let clientPreselectionne = null;
  let clientVerrouille = null;
  if (demandeLiee) {
    let cid = demandeLiee.client_id || null;
    if (!cid) {
      const table = TABLES_SOUMISSIONS_EXISTANTES[demandeLiee.produit];
      if (table) {
        const s = bd.prepare(`SELECT client_id FROM ${table} WHERE id = ? AND cabinet_id = ?`)
          .get(demandeLiee.soumission_id, res.locals.cabinetId);
        cid = s ? s.client_id : null;
      }
    }
    if (cid) {
      const c = clients.find((x) => x.id === cid);
      clientVerrouille = { id: cid, raison_sociale: c ? c.raison_sociale : `Client #${cid}` };
      clientPreselectionne = cid;
    }
  } else {
    const valeursProposees = {};
    (a.champs || []).forEach((c) => { if (c.champ) valeursProposees[c.champ] = c.valeur; });
    const resolu = insertion.trouverClient(res.locals.cabinetId, valeursProposees['client.entreprise']);
    if (resolu) clientPreselectionne = resolu.id;
  }
  res.render('analyses/fiche', {
    a, NOMS_STATUTS, NOMS_PRODUITS, polices, soumissionsExistantes, demandeLiee,
    clients, clientPreselectionne, clientVerrouille,
    META_LISTES: moteurAnalyse.META_LISTES,
    insere: req.query.insere === '1',
  });
});

const CHAMPS_NUMERIQUES = new Set([
  'garanties.prime', 'garanties.franchise', 'garanties.limite', 'garanties.limite_par_sinistre',
  'garanties.limite_agregat', 'garanties.limite_globale', 'garanties.limite_par_projet',
  'garanties.periode_indemnite_mois', 'garanties.franchise_jours',
  'obligation.montant_contrat', 'vehicule.annee', 'entete.nb_vehicules', 'entete.rayon_operation_km',
]);

function coercer(champ, valeur) {
  if (!CHAMPS_NUMERIQUES.has(champ)) return valeur;
  const n = Number(String(valeur).replace(/[\s$]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : valeur;
}

// Listes retenues à la révision (v2) : lignes cochées des tableaux éditables.
// Noms de champs : liste_<type>_<index>_inclure / liste_<type>_<index>_<champ>.
// Les lignes ajoutées à l'écran (bouton « + Ajouter une ligne ») suivent la
// même numérotation — le serveur balaie donc les clés du corps de requête.
function lireListesForm(req) {
  const listes = {};
  for (const cle of Object.keys(req.body)) {
    const m = cle.match(/^liste_([a-z]+)_(\d+)_inclure$/);
    if (!m || req.body[cle] !== 'on') continue;
    const [, type, idx] = m;
    const meta = moteurAnalyse.META_LISTES[type];
    if (!meta) continue;
    const champs = {};
    for (const [champCle, cm] of Object.entries(meta.champs)) {
      const brut = req.body[`liste_${type}_${idx}_${champCle}`];
      if (brut === undefined) continue;
      const v = String(brut).trim();
      if (v === '') continue;
      if (cm.numerique) {
        const n = Number(v.replace(/[\s$]/g, '').replace(',', '.'));
        champs[champCle] = Number.isFinite(n) ? n : v;
      } else {
        champs[champCle] = v;
      }
    }
    if (Object.keys(champs).length) {
      (listes[type] = listes[type] || []).push({ champs, confiance: 'moyenne', extrait: 'Révision' });
    }
  }
  return listes;
}

// Insertion : JAMAIS sans confirmation explicite (ce POST est la confirmation).
router.post('/:id/inserer', (req, res) => {
  const a = analyseAutorisee(req, res);
  if (!a) return;
  if (!['a_reviser', 'analyse', 'pret'].includes(a.statut)) {
    return pageErreur(res, 400, 'Insertion impossible',
      a.statut === 'insere'
        ? 'Cette analyse a déjà été insérée. Relancez l\u2019analyse pour obtenir une nouvelle proposition.'
        : `Statut actuel « ${a.statut} » : l\u2019analyse n\u2019est pas prête à insérer.`);
  }
  const cabinetId = res.locals.cabinetId;
  const utilisateur = req.utilisateur;
  const cible = String(req.body.cible || 'soumission');
  const produit = String(req.body.produit || a.produit_detecte || '');

  // --- Client du document (correctif) ---------------------------------------
  // Le client choisi à la révision prime : une soumission ou une police
  // existante d'un AUTRE client est refusée (400), et les créations se font
  // chez CE client. Analyse liée à une demande d'informations : le client
  // est imposé par la demande, quoi que le formulaire envoie.
  let clientIdChoisi = Number(req.body.client_id) || null;
  if (a.demande_info_id) {
    const demandesInfos = require('../lib/demandes-infos');
    const demandeLieePost = demandesInfos.obtenirDemande(a.demande_info_id, cabinetId);
    if (demandeLieePost) {
      let cid = demandeLieePost.client_id || null;
      if (!cid) {
        const table = TABLES_SOUMISSIONS_EXISTANTES[demandeLieePost.produit];
        if (table) {
          const s = bd.prepare(`SELECT client_id FROM ${table} WHERE id = ? AND cabinet_id = ?`)
            .get(demandeLieePost.soumission_id, cabinetId);
          cid = s ? s.client_id : null;
        }
      }
      if (cid) clientIdChoisi = cid;
    }
  }
  if (clientIdChoisi) {
    const cliChoisi = bd.prepare('SELECT id FROM clients WHERE id = ? AND cabinet_id = ? AND archive = 0')
      .get(clientIdChoisi, cabinetId);
    if (!cliChoisi) {
      return pageErreur(res, 400, 'Client invalide', 'Le client sélectionné est introuvable dans votre cabinet.');
    }
  }

  // Valeurs retenues (cases cochées), avec les corrections de l'utilisateur.
  const valeurs = {};
  a.champs.forEach((c, i) => {
    if (req.body['inclure_' + i] === 'on') {
      const brut = req.body['valeur_' + i];
      valeurs[c.champ] = coercer(c.champ, brut !== undefined ? String(brut).trim() : c.valeur);
    }
  });
  if (!Object.keys(valeurs).length && cible !== 'police_existante' && cible !== 'soumission_existante') {
    return pageErreur(res, 400, 'Aucun champ retenu', 'Cochez au moins un champ à insérer.');
  }
  const listes = lireListesForm(req);
  const nbElementsListes = Object.values(listes).reduce((s, l) => s + l.length, 0);
  if (cible === 'soumission' && !Object.keys(valeurs).length && !nbElementsListes) {
    return pageErreur(res, 400, 'Aucun champ retenu', 'Cochez au moins un champ ou un élément de liste à insérer.');
  }

  try {
    if (cible === 'soumission_existante') {
      const brut = String(req.body.soumission_existante || '');
      const [produitCible, idTxt] = brut.split(':');
      const soumissionId = Number(idTxt);
      if (!moteurAnalyse.PRODUITS.includes(produitCible) || !soumissionId) {
        return pageErreur(res, 400, 'Soumission manquante', 'Choisissez la soumission existante à compléter.');
      }
      if (produitCible !== produit) {
        return pageErreur(res, 400, 'Produit incohérent',
          `La soumission choisie est du produit « ${produitCible} » mais le produit de l'analyse est « ${produit} ». Alignez le produit de la révision sur celui de la soumission.`);
      }
      // Réponses ciblées retenues (boucle courriel : analyse d'une réponse à
      // une demande d'informations) — valeurs possiblement corrigées.
      const ciblesRetenues = [];
      if (a.demande_info_id && Array.isArray(a.reponsesCiblees)) {
        a.reponsesCiblees.forEach((c, i) => {
          if (req.body['cible_' + i + '_inclure'] === 'on') {
            const brut = req.body['cible_' + i + '_valeur'];
            let valeur = brut !== undefined ? String(brut).trim() : c.valeur;
            if (typeof c.valeur === 'number') {
              const n = Number(String(valeur).replace(/[\s\u202F]/g, '').replace(',', '.'));
              valeur = Number.isFinite(n) ? n : c.valeur;
            }
            ciblesRetenues.push({ cle: c.cle, type: c.type, id: c.id, champ: c.champ, valeur });
          }
        });
      }
      if (!nbElementsListes && !ciblesRetenues.length) {
        return pageErreur(res, 400, 'Aucun élément retenu', 'Cochez au moins un élément de liste ou une réponse aux questions à ajouter à la soumission.');
      }
      // Contrôles AVANT toute écriture : existence dans le cabinet et
      // portefeuille du courtier (même rigueur que les autres cibles).
      const table = TABLES_SOUMISSIONS_EXISTANTES[produit];
      const soum = bd.prepare(`SELECT client_id FROM ${table} WHERE id = ? AND cabinet_id = ? AND archive = 0`)
        .get(soumissionId, cabinetId);
      if (!soum) return pageErreur(res, 404, 'Introuvable', 'Soumission introuvable dans votre cabinet.');
      if (soum.client_id && clientHorsPortefeuille(cabinetId, utilisateur, soum.client_id)) {
        return reponseHorsPortefeuille(res);
      }
      if (clientIdChoisi && soum.client_id && soum.client_id !== clientIdChoisi) {
        return pageErreur(res, 400, 'Client incohérent',
          "La soumission choisie n'appartient pas au client sélectionné. Choisissez d'abord le client du document, puis une de ses soumissions.");
      }
      const detailsInsertion = [];
      if (nbElementsListes) {
        const r = insertion.ajouterListesAExistante(cabinetId, utilisateur, produit, soumissionId, listes);
        const echecs = r.sections.filter((s) => !s.ok);
        detailsInsertion.push(`listes ajoutées à la soumission existante : ${insertion.detailComptes(r.comptesListes)}`);
        if (echecs.length) {
          journal(cabinetId, utilisateur.id, 'analyse_insertion_partielle',
            `Analyse #${a.id} : listes ajoutées à la soumission ${produit} #${soumissionId}, sections en échec : ${echecs.map((s) => s.nom).join(', ')}`);
        }
      }
      if (ciblesRetenues.length && a.demande_info_id) {
        const reponsesInfos = require('../lib/reponses-infos');
        const demandesInfos = require('../lib/demandes-infos');
        const app = reponsesInfos.appliquerReponsesCiblees(cabinetId, utilisateur, produit, soumissionId, ciblesRetenues);
        if (app.cles.length) {
          demandesInfos.marquerReponses(a.demande_info_id, cabinetId, utilisateur.id, app.cles,
            'réponse ciblée acceptée à la révision');
          detailsInsertion.push(`${app.cles.length} réponse(s) aux questions appliquée(s)`);
        }
        // Fermer aussi les questions dont le manque a disparu (listes/champs).
        demandesInfos.recalculerDepuisSoumission(a.demande_info_id, cabinetId, utilisateur.id,
          'recalcul des manques après insertion de la réponse');
      }
      analyses.marquerInseree(a.id, cabinetId, utilisateur.id, {
        produit, soumissionId,
        detail: detailsInsertion.join(' ; ') || null,
      });
      return res.redirect('/analyses/' + a.id + '?insere=1');
    }
    if (cible === 'soumission') {
      if (!moteurAnalyse.PRODUITS.includes(produit)) {
        return pageErreur(res, 400, 'Produit manquant', 'Choisissez le produit de la soumission à créer.');
      }
      // Client du document : le choix explicite prime (la soumission est
      // créée chez CE client) ; sinon, résolution par raison sociale comme
      // avant. Le contrôle portefeuille s'applique au client final.
      let r;
      if (clientIdChoisi) {
        if (clientHorsPortefeuille(cabinetId, utilisateur, clientIdChoisi)) {
          return reponseHorsPortefeuille(res);
        }
        r = insertion.creerSoumission(cabinetId, utilisateur, produit, valeurs, listes, { clientId: clientIdChoisi });
      } else {
        const { client } = insertion.resoudreClient(cabinetId, utilisateur, valeurs);
        if (client && clientHorsPortefeuille(cabinetId, utilisateur, client.id)) {
          return reponseHorsPortefeuille(res);
        }
        r = insertion.creerSoumission(cabinetId, utilisateur, produit, valeurs, listes);
      }
      const echecs = r.sections.filter((s) => !s.ok);
      analyses.marquerInseree(a.id, cabinetId, utilisateur.id, {
        produit, soumissionId: r.soumissionId,
        detail: nbElementsListes ? `listes insérées : ${insertion.detailComptes(r.comptesListes)}` : null,
      });
      if (echecs.length) {
        journal(cabinetId, utilisateur.id, 'analyse_insertion_partielle',
          `Analyse #${a.id} : soumission ${produit} #${r.soumissionId} créée, sections en échec : ${echecs.map((s) => s.nom).join(', ')}`);
      }
      return res.redirect('/analyses/' + a.id + '?insere=1');
    }
    if (cible === 'police_nouvelle') {
      if (!moteurAnalyse.PRODUITS.includes(produit)) {
        return pageErreur(res, 400, 'Produit manquant', 'Choisissez le produit (ligne) de la police à créer.');
      }
      if (clientIdChoisi && clientHorsPortefeuille(cabinetId, utilisateur, clientIdChoisi)) {
        return reponseHorsPortefeuille(res);
      }
      const r = insertion.creerPolice(cabinetId, utilisateur, produit, valeurs, a, { clientId: clientIdChoisi || undefined });
      const documentId = insertion.copierDocumentVersPolice(cabinetId, utilisateur, a, r.policeId);
      analyses.marquerInseree(a.id, cabinetId, utilisateur.id, {
        produit, policeId: r.policeId, documentId,
      });
      return res.redirect('/analyses/' + a.id + '?insere=1');
    }
    if (cible === 'police_existante') {
      const police = bd.prepare('SELECT * FROM polices WHERE id = ? AND cabinet_id = ?')
        .get(Number(req.body.police_id), cabinetId);
      if (!police) return pageErreur(res, 404, 'Introuvable', 'Police introuvable dans votre cabinet.');
      if (clientHorsPortefeuille(cabinetId, utilisateur, police.client_id)) {
        return reponseHorsPortefeuille(res);
      }
      if (clientIdChoisi && police.client_id !== clientIdChoisi) {
        return pageErreur(res, 400, 'Client incohérent',
          "La police choisie n'appartient pas au client sélectionné. Choisissez d'abord le client du document, puis une de ses polices.");
      }
      const documentId = insertion.copierDocumentVersPolice(cabinetId, utilisateur, a, police.id);
      analyses.marquerInseree(a.id, cabinetId, utilisateur.id, {
        produit: a.produit_detecte, policeId: police.id, documentId,
      });
      return res.redirect('/analyses/' + a.id + '?insere=1');
    }
    return pageErreur(res, 400, 'Cible invalide', 'Choisissez une cible d\u2019insertion.');
  } catch (e) {
    return pageErreur(res, 400, 'Insertion impossible', e.message);
  }
});

router.post('/:id/archiver', (req, res) => {
  const a = analyseAutorisee(req, res);
  if (!a) return;
  analyses.archiverAnalyse(a.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/analyses');
});

router.post('/:id/desarchiver', (req, res) => {
  const a = analyseAutorisee(req, res, true);
  if (!a) return;
  analyses.desarchiverAnalyse(a.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/analyses/' + a.id);
});

module.exports = router;
module.exports.NOMS_STATUTS = NOMS_STATUTS;
module.exports.NOMS_PRODUITS = NOMS_PRODUITS;
