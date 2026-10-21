/**
 * routes/combinees.js — Soumissions combinées entreprise (Biens + RC +
 * Perte d'exploitation liées). Le questionnaire unique écrit EXCLUSIVEMENT
 * via les modules produits existants et lib/combine.js : aucune logique
 * métier n'est dupliquée ici, seulement la lecture des formulaires.
 */
const express = require('express');
const bd = require('../lib/bd');
const {
  exigeAuth, exigeMotDePasseChange, estCourtier, clientHorsPortefeuille,
} = require('../lib/middleware');
const combine = require('../lib/combine');
const marche = require('../lib/marche');
const biens = require('../lib/biens');
const rc = require('../lib/rc');
const pesoum = require('../lib/pe');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

// Listes d'affichage des volets RC et PE (miroirs des routes produits —
// libellés seulement, la validation reste dans les modules produits).
const FORMULES_RC = ['locaux_operations', 'produits_completes', 'globale'];
const NOMS_FORMULE_RC = {
  locaux_operations: 'Locaux et opérations',
  produits_completes: 'Produits et opérations complétées',
  globale: 'Globale',
};
const AVENANTS_RC = [
  ['pollution', 'Pollution'],
  ['parapluie', 'Parapluie'],
];
const AVENANTS_PE = [
  ['frais_supplementaires', 'Frais supplémentaires'],
  ['dependance_fournisseurs', 'Dépendance aux fournisseurs'],
  ['acces_civil', 'Accès civil (interdiction d\u2019accès)'],
  ['deterioration_stocks', 'Détérioration des stocks'],
];
const NOMS_BASE_MONTANT = {
  benefice_brut: 'Bénéfice brut', marge_brute: 'Marge brute', chiffre_affaires: 'Chiffre d\u2019affaires',
};
const NOMS_PERIODE_INDEMNITE = { 12: '12 mois', 18: '18 mois', 24: '24 mois' };

function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

// --- Utilitaires de lecture de formulaires --------------------------------------
const v = (x) => (x == null ? '' : String(x)).trim();
const txt = (body, k) => v(body[k]) || null;
const num = (body, k) => {
  const s = v(body[k]);
  return s === '' || isNaN(Number(s)) ? null : Number(s);
};
const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const estNumerique = (s) => /^-?\d+(\.\d+)?$/.test(s);

// Bâtiment : les noms de champs du formulaire sont les noms de colonnes.
function lireBatimentForm(body) {
  const data = {};
  for (const col of biens.COLS_BATIMENT) {
    if (biens.BOOL_BATIMENT.has(col)) { data[col] = body[col] === 'on' ? 1 : 0; continue; }
    const brut = body[col];
    if (brut === undefined) continue;
    const s = v(brut);
    if (s === '') { data[col] = null; continue; }
    data[col] = estNumerique(s) ? Number(s) : s;
  }
  return data;
}

function lireAlarmeForm(body) {
  const data = {};
  for (const col of combine.COLS_ALARME_TEXTE) data[col] = txt(body, 'alarme_' + col);
  for (const col of combine.COLS_ALARME_JSON) {
    data[col] = asArray(body['alarme_' + col]).map((x) => String(x));
  }
  for (const col of combine.COLS_ALARME_BOOL) data[col] = body['alarme_' + col] === 'on' ? 1 : 0;
  data.signaux_ouverture_fermeture = txt(body, 'alarme_signaux_ouverture_fermeture');
  for (const groupe of ['cameras_detail', 'protections_physiques', 'coffre_detail']) {
    // déjà traités ci-dessus via les listes JSON / objet ci-dessous
  }
  data.cameras_detail = {
    presente: body.alarme_cam_presente === 'on' ? 1 : 0,
    couvre_tout_sauf_toilettes: body.alarme_cam_tout === 'on' ? 1 : 0,
    enregistre_24h: body.alarme_cam_24h === 'on' ? 1 : 0,
    sauvegardes_hors_site: body.alarme_cam_hors_site === 'on' ? 1 : 0,
    exterieures: body.alarme_cam_ext === 'on' ? 1 : 0,
  };
  data.coffre_detail = {
    fabricant: txt(body, 'alarme_coffre_fabricant'),
    modele: txt(body, 'alarme_coffre_modele'),
    cote: txt(body, 'alarme_coffre_cote'),
    poids_moins_500lb: body.alarme_coffre_poids === 'on' ? 1 : 0,
    boulonne: body.alarme_coffre_boulonne === 'on' ? 1 : 0,
    chambre_forte: body.alarme_coffre_chambre === 'on' ? 1 : 0,
  };
  return data;
}

function parserInterruptions(texte) {
  if (!texte) return [];
  return String(texte).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const cols = l.split('|').map((x) => (x || '').trim());
    const duree = cols[2] === undefined || cols[2] === '' ? null : Number(cols[2]);
    const montant = cols[3] === undefined || cols[3] === '' ? null : Number(cols[3]);
    return {
      date: cols[0] || '', cause: cols[1] || '',
      duree_jours: duree !== null && isNaN(duree) ? null : duree,
      montant: montant !== null && isNaN(montant) ? null : montant,
    };
  }).filter((o) => o.date || o.cause);
}

function serialiserInterruptions(liste) {
  if (!Array.isArray(liste)) return '';
  return liste.map((x) => [
    x.date || '', x.cause || '',
    x.duree_jours === null || x.duree_jours === undefined ? '' : x.duree_jours,
    x.montant === null || x.montant === undefined ? '' : x.montant,
  ].join(' | ')).join('\n');
}

// --- Accès ----------------------------------------------------------------------
function dossierAutorise(req, res) {
  const d = combine.obtenirDossier(Number(req.params.id), res.locals.cabinetId);
  if (!d) { pageErreur(res, 404, 'Introuvable', 'Dossier combiné introuvable.'); return null; }
  if (estCourtier(req) && clientHorsPortefeuille(res.locals.cabinetId, req.utilisateur, d.client_id)) {
    pageErreur(res, 403, 'Accès refusé', 'Ce dossier ne fait pas partie de votre portefeuille.');
    return null;
  }
  return d;
}

function erreur400(res, e) {
  return pageErreur(res, 400, 'Enregistrement impossible', e.message);
}

// --- Liste ----------------------------------------------------------------------
router.get('/', (req, res) => {
  let dossiers = combine.listerDossiers(res.locals.cabinetId);
  if (estCourtier(req)) {
    const ids = new Set(bd.prepare('SELECT id FROM clients WHERE cabinet_id = ? AND responsable_id = ?')
      .all(res.locals.cabinetId, req.utilisateur.id).map((c) => c.id));
    dossiers = dossiers.filter((d) => ids.has(d.client_id));
  }
  const clients = bd.prepare('SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0 ORDER BY raison_sociale')
    .all(res.locals.cabinetId);
  res.render('combinees/liste', { titre: 'Soumissions combinées', dossiers, clients });
});

// --- Nouvelle -------------------------------------------------------------------
router.get('/nouvelle', (req, res) => {
  const clients = bd.prepare('SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0 ORDER BY raison_sociale')
    .all(res.locals.cabinetId);
  let clientChoisi = null;
  let existantes = null;
  if (req.query.client_id) {
    clientChoisi = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ? AND archive = 0')
      .get(Number(req.query.client_id), res.locals.cabinetId) || null;
    if (clientChoisi) {
      existantes = {
        biens: bd.prepare('SELECT id, statut, cree_le FROM biens_soumissions WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC')
          .all(clientChoisi.id, res.locals.cabinetId),
        rc: bd.prepare('SELECT id, statut, cree_le FROM rc_soumissions WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC')
          .all(clientChoisi.id, res.locals.cabinetId),
        perte_exploitation: bd.prepare('SELECT id, statut, cree_le FROM pe_soumissions WHERE client_id = ? AND cabinet_id = ? AND archive = 0 ORDER BY id DESC')
          .all(clientChoisi.id, res.locals.cabinetId),
      };
    }
  }
  res.render('combinees/nouvelle', { titre: 'Nouvelle soumission combinée', clients, clientChoisi, existantes });
});

router.post('/', (req, res) => {
  const clientId = Number(req.body.client_id);
  if (!clientId) return pageErreur(res, 400, 'Client requis', 'Choisissez le client du dossier combiné.');
  const lier = {};
  for (const produit of combine.PRODUITS_COMBINE) {
    const choix = req.body['lier_' + produit];
    if (choix && choix !== 'nouvelle') lier[produit] = Number(choix);
  }
  try {
    const id = combine.creerDossier({
      cabinetId: res.locals.cabinetId, userId: req.utilisateur.id, clientId,
      donnees: {
        lier,
        date_effet: txt(req.body, 'date_effet'),
        date_echeance: txt(req.body, 'date_echeance'),
        plan_paiement: txt(req.body, 'plan_paiement'),
      },
    });
    res.redirect('/combinees/' + id);
  } catch (e) {
    return erreur400(res, e);
  }
});

// --- Fiche ----------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  const cabinetId = res.locals.cabinetId;
  const sB = d.soumissions.biens;
  const batiments = sB ? sB.batiments.filter((b) => !b.archive) : [];
  const alarmes = {};
  const beneficiaires = {};
  for (const b of batiments) {
    const al = combine.obtenirAlarme(b.id, cabinetId);
    if (al) alarmes[b.id] = al;
    beneficiaires[b.id] = combine.listerBeneficiaires(b.id, cabinetId);
  }
  const sPE = d.soumissions.perte_exploitation;
  const sRC = d.soumissions.rc;
  const peParBatiment = {};
  if (sPE) for (const e of sPE.etablissements.filter((x) => !x.archive)) {
    if (e.batiment_id) peParBatiment[e.batiment_id] = e;
  }
  const rcParBatiment = {};
  if (sRC) for (const e of sRC.exploitations.filter((x) => !x.archive)) {
    if (e.batiment_id) rcParBatiment[e.batiment_id] = e;
  }
  const client = d.client ? { ...d.client } : null;
  if (client) {
    client.repartition_revenus_types = combine.jsonOut(client.repartition_revenus_types);
    client.repartition_revenus_geo = combine.jsonOut(client.repartition_revenus_geo);
  }
  const reponses = {};
  for (const r of combine.obtenirReponsesSectorielles(d.client_id, cabinetId)) {
    reponses[r.code_question] = r.reponse;
  }
  const utilisateurs = bd.prepare('SELECT id, nom, email, role FROM users WHERE cabinet_id = ? AND actif = 1 ORDER BY nom')
    .all(cabinetId);
  res.render('combinees/fiche', {
    titre: `Soumission combinée — ${client ? client.raison_sociale : ''}`,
    d, client, batiments, alarmes, beneficiaires, peParBatiment, rcParBatiment,
    sectionMarche: marche.sectionPourCible(cabinetId, { produit: 'combinee', combineDossierId: d.id }), NOMS_STATUTS_ENVOI: marche.NOMS_STATUTS_ENVOI,
    flottante: sB ? combine.listerArticlesFlottante(sB.id, cabinetId) : [],
    assures: combine.listerAssuresAdditionnels('combine', d.id, cabinetId),
    reponses, utilisateurs,
    interruptionsTexte: serialiserInterruptions(
      d.antecedents_bloc ? d.antecedents_bloc.interruptions_5ans : []),
    FORMES_JURIDIQUES: combine.FORMES_JURIDIQUES,
    CLES_REPARTITION_TYPES: combine.CLES_REPARTITION_TYPES,
    CLES_REPARTITION_GEO: combine.CLES_REPARTITION_GEO,
    QUESTIONS_SECTORIELLES: combine.QUESTIONS_SECTORIELLES,
    SECTEURS_QUESTIONS: combine.SECTEURS_QUESTIONS,
    STATUTS_DOSSIER: combine.STATUTS_DOSSIER_COMBINE,
    AVENANTS_DETAILLES: combine.AVENANTS_BIENS_ENRICHIS,
    CHAMPS_AVENANT_SUPPL: combine.CHAMPS_AVENANT_SUPPL,
    LISTES_ALARME: {
      TRANSMISSIONS: combine.TRANSMISSIONS,
      COUVERTURES_DETECTION: combine.COUVERTURES_DETECTION,
      PROTECTIONS_COFFRES: combine.PROTECTIONS_COFFRES,
      REPONDANTS_ALARME: combine.REPONDANTS_ALARME,
      PROTECTIONS_PHYSIQUES: combine.PROTECTIONS_PHYSIQUES,
      SIGNAUX_OUVERTURE_FERMETURE: combine.SIGNAUX_OUVERTURE_FERMETURE,
    },
    NOMS_FORMULE_BIENS: { tous_risques: 'Tous risques', risques_designes: 'Risques désignés' },
    FORMULES_BIENS: ['tous_risques', 'risques_designes'],
    REP_TYPES_PAIRES: combine.CLES_REPARTITION_TYPES.map((c) => [c, combine.LIBELLES_REPARTITION_TYPES[c]]),
    REP_GEO_PAIRES: combine.CLES_REPARTITION_GEO.map((c) => [c, combine.LIBELLES_REPARTITION_GEO[c]]),
    AVENANTS_RC, FORMULES_RC, NOMS_FORMULE_RC,
    AVENANTS_PE, BASES_MONTANT: pesoum.BASES_MONTANT,
    NOMS_BASE_MONTANT, PERIODES_INDEMNITE_MOIS: pesoum.PERIODES_INDEMNITE_MOIS,
    NOMS_PERIODE_INDEMNITE,
    FORMULES_PE: pesoum.FORMULES_PE, NOMS_FORMULE_PE: pesoum.NOMS_FORMULE_PE,
  });
});

// --- En-tête du dossier ------------------------------------------------------------
router.post('/:id/entete', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  try {
    combine.mettreAJourDossier(d.id, res.locals.cabinetId, req.utilisateur.id, {
      date_effet: txt(req.body, 'date_effet'),
      date_echeance: txt(req.body, 'date_echeance'),
      plan_paiement: txt(req.body, 'plan_paiement'),
      code_courtier_assureur: txt(req.body, 'code_courtier_assureur'),
      courtier_placement_id: req.body.courtier_placement_id ? Number(req.body.courtier_placement_id) : null,
      signataire_nom: txt(req.body, 'signataire_nom'),
      signataire_titre: txt(req.body, 'signataire_titre'),
      date_signature: txt(req.body, 'date_signature'),
      remarques_diverses: txt(req.body, 'remarques_diverses'),
      circonstances_speciales: txt(req.body, 'circonstances_speciales'),
      commentaires_courtier: txt(req.body, 'commentaires_courtier'),
      courtier_connait_depuis: txt(req.body, 'courtier_connait_depuis'),
      client_nouveau: req.body.client_nouveau === 'on',
      transition_entite_nom: txt(req.body, 'transition_entite_nom'),
      transition_note: txt(req.body, 'transition_note'),
      statut: req.body.statut || undefined,
    });
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#entete');
});

// --- Entreprise (profil de souscription du client) ----------------------------------
router.post('/:id/profil', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  const rep = (prefixe, cles) => {
    const o = {};
    for (const cle of cles) {
      const val = num(req.body, prefixe + cle);
      if (val !== null) o[cle] = val;
    }
    return o;
  };
  try {
    combine.definirProfilClient(d.client_id, res.locals.cabinetId, req.utilisateur.id, {
      forme_juridique: txt(req.body, 'forme_juridique'),
      annee_fondation: num(req.body, 'annee_fondation'),
      annees_experience_liee: num(req.body, 'annees_experience_liee'),
      noms_exploitation: txt(req.body, 'noms_exploitation'),
      description_activites: txt(req.body, 'description_activites'),
      code_industrie: txt(req.body, 'code_industrie'),
      code_industrie_description: txt(req.body, 'code_industrie_description'),
      code_industrie_pct_revenus: num(req.body, 'code_industrie_pct_revenus'),
      repartition_revenus_types: rep('rep_type_', combine.CLES_REPARTITION_TYPES),
      repartition_revenus_geo: rep('rep_geo_', combine.CLES_REPARTITION_GEO),
      masse_salariale: num(req.body, 'masse_salariale'),
      nb_employes_temps_plein: num(req.body, 'nb_employes_temps_plein'),
      nb_employes_temps_partiel: num(req.body, 'nb_employes_temps_partiel'),
      employes_csst: req.body.employes_csst === 'on' ? 1 : 0,
      responsabilite_alcool: req.body.responsabilite_alcool === 'on' ? 1 : 0,
      pct_sous_traitance: num(req.body, 'pct_sous_traitance'),
    });
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#entreprise');
});

// --- Antécédents communs (saisis une fois, synchronisés) -----------------------------
router.post('/:id/antecedents', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  let sinistres = [];
  try { sinistres = JSON.parse(req.body.sinistres_json || '[]'); } catch { sinistres = []; }
  const bloc = {
    assureur_actuel: txt(req.body, 'assureur_actuel'),
    numero_police_actuelle: txt(req.body, 'numero_police_actuelle'),
    date_expiration_actuelle: txt(req.body, 'date_expiration_actuelle'),
    annees_assurance_continue: num(req.body, 'annees_assurance_continue'),
    refus_resiliation_nonrenouvellement: req.body.refus === 'on' ? 1 : 0,
    refus_explication: txt(req.body, 'refus_explication'),
    type_police_precedente: txt(req.body, 'type_police_precedente'),
    date_effet_precedente: txt(req.body, 'date_effet_precedente'),
    prime_precedente: num(req.body, 'prime_precedente'),
    faillite_jugement: req.body.faillite === 'on' ? 1 : 0,
    faillite_explication: txt(req.body, 'faillite_explication'),
    condamnation_honnetete: req.body.condamnation === 'on' ? 1 : 0,
    condamnation_explication: txt(req.body, 'condamnation_explication'),
    sinistres_5ans: Array.isArray(sinistres) ? sinistres : [],
    interruptions_5ans: parserInterruptions(req.body.interruptions),
    consentements: d.soumissions.biens && d.soumissions.biens.antecedents
      ? d.soumissions.biens.antecedents.consentements || {} : {},
  };
  try {
    combine.synchroniserAntecedents(d.id, res.locals.cabinetId, req.utilisateur.id, bloc);
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#antecedents');
});

// --- Emplacements ---------------------------------------------------------------------
router.post('/:id/emplacement', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  const sB = d.soumissions.biens;
  if (!sB) return pageErreur(res, 400, 'Volet biens absent', 'Ce dossier n\u2019a pas de soumission biens liée.');
  try {
    biens.ajouterBatiment(sB.id, res.locals.cabinetId, req.utilisateur.id, lireBatimentForm(req.body));
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#emplacements');
});

router.post('/:id/emplacement/:bid', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  try {
    biens.modifierBatiment(Number(req.params.bid), res.locals.cabinetId, req.utilisateur.id, lireBatimentForm(req.body));
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#emplacements');
});

router.post('/:id/emplacement/:bid/alarme', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  try {
    combine.definirAlarme(Number(req.params.bid), res.locals.cabinetId, req.utilisateur.id, lireAlarmeForm(req.body));
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#emplacements');
});

router.post('/:id/emplacement/:bid/beneficiaire', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  try {
    combine.ajouterBeneficiaire(Number(req.params.bid), res.locals.cabinetId, req.utilisateur.id, {
      nom: txt(req.body, 'nom'),
      adresse: txt(req.body, 'adresse'),
      ville: txt(req.body, 'ville'),
      code_postal: txt(req.body, 'code_postal'),
      qualite: txt(req.body, 'qualite'),
      clause_preavis: txt(req.body, 'clause_preavis'),
    });
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#emplacements');
});

// Rattacher l'emplacement à la perte d'exploitation : crée l'établissement
// (adresse copiée de l'emplacement) ou met à jour celui déjà lié.
router.post('/:id/emplacement/:bid/lier-pe', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  const sPE = d.soumissions.perte_exploitation;
  const sB = d.soumissions.biens;
  if (!sPE || !sB) return pageErreur(res, 400, 'Volet absent', 'Dossier incomplet.');
  const b = sB.batiments.find((x) => x.id === Number(req.params.bid));
  if (!b) return pageErreur(res, 404, 'Introuvable', 'Emplacement introuvable.');
  const existant = sPE.etablissements.find((e) => !e.archive && e.batiment_id === b.id);
  const donnees = {
    nom_lieu: txt(req.body, 'nom_lieu') || b.adresse,
    adresse: [b.adresse, b.ville].filter(Boolean).join(', '),
    occupation: txt(req.body, 'occupation') || b.type_activite || null,
    chiffre_affaires: num(req.body, 'chiffre_affaires'),
    montant_pe: num(req.body, 'montant_pe'),
    batiment_id: b.id,
  };
  try {
    if (existant) pesoum.modifierEtablissement(existant.id, res.locals.cabinetId, req.utilisateur.id, donnees);
    else pesoum.ajouterEtablissement(sPE.id, res.locals.cabinetId, req.utilisateur.id, donnees);
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#emplacements');
});

// Rattacher l'emplacement à la RC : crée le lieu d'exploitation ou met à
// jour celui déjà lié.
router.post('/:id/emplacement/:bid/lier-rc', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  const sRC = d.soumissions.rc;
  const sB = d.soumissions.biens;
  if (!sRC || !sB) return pageErreur(res, 400, 'Volet absent', 'Dossier incomplet.');
  const b = sB.batiments.find((x) => x.id === Number(req.params.bid));
  if (!b) return pageErreur(res, 404, 'Introuvable', 'Emplacement introuvable.');
  const existant = sRC.exploitations.find((e) => !e.archive && e.batiment_id === b.id);
  const donnees = {
    adresse: b.adresse, ville: b.ville, code_postal: b.code_postal,
    type_activite: txt(req.body, 'type_activite') || b.type_activite || null,
    description_activites: txt(req.body, 'description_activites'),
    chiffre_affaires: num(req.body, 'chiffre_affaires'),
    batiment_id: b.id,
  };
  try {
    if (existant) rc.modifierExploitation(existant.id, res.locals.cabinetId, req.utilisateur.id, donnees);
    else rc.ajouterExploitation(sRC.id, res.locals.cabinetId, req.utilisateur.id, donnees);
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#emplacements');
});

// --- Garanties ---------------------------------------------------------------------------
router.post('/:id/garanties-biens/:bid', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  const avenants = {};
  for (const code of combine.CODES_AVENANTS_BIENS) {
    if (req.body['avenant_det_' + code] !== 'on') continue;
    const o = { present: 1 };
    const fr = num(req.body, `avenant_det_${code}_franchise`);
    const mo = num(req.body, `avenant_det_${code}_montant`);
    if (fr !== null) o.franchise = fr;
    if (mo !== null) o.montant = mo;
    for (const champ of combine.CHAMPS_AVENANT_SUPPL[code] || []) {
      const brut = req.body[`avenant_det_${code}_${champ}`];
      if (brut !== undefined && v(brut) !== '') {
        o[champ] = champ === 'limitations' || champ.startsWith('date') ? v(brut) : Number(brut);
      }
    }
    avenants[code] = o;
  }
  for (const code of asArray(req.body.avenants)) avenants[code] = avenants[code] || 1;
  try {
    biens.definirGaranties(Number(req.params.bid), res.locals.cabinetId, req.utilisateur.id, {
      formule: txt(req.body, 'formule'),
      franchise: num(req.body, 'franchise'),
      montant_assurance: num(req.body, 'montant_assurance'),
      avenants: combine.normaliserAvenantsBiens(avenants),
      prime: num(req.body, 'prime'),
      regle_proportionnelle: num(req.body, 'regle_proportionnelle'),
      franchise_contenu: num(req.body, 'franchise_contenu'),
      regle_proportionnelle_contenu: num(req.body, 'regle_proportionnelle_contenu'),
    });
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#garanties');
});

router.post('/:id/garanties-rc/:eid', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  const avenants = {};
  for (const code of asArray(req.body.avenants)) {
    if (AVENANTS_RC.some(([c]) => c === code)) avenants[code] = 1;
  }
  try {
    rc.definirGaranties(Number(req.params.eid), res.locals.cabinetId, req.utilisateur.id, {
      limite_par_sinistre: num(req.body, 'limite_par_sinistre'),
      limite_agregat: num(req.body, 'limite_agregat'),
      franchise: num(req.body, 'franchise'),
      formule: txt(req.body, 'formule'),
      avenants,
      prime: num(req.body, 'prime'),
      prejudice_personnel_publicite: num(req.body, 'prejudice_personnel_publicite'),
      frais_medicaux_par_personne: num(req.body, 'frais_medicaux_par_personne'),
      frais_medicaux_par_sinistre: num(req.body, 'frais_medicaux_par_sinistre'),
      responsabilite_locative: num(req.body, 'responsabilite_locative'),
      rc_auto_non_proprietaires: num(req.body, 'rc_auto_non_proprietaires'),
      umbrella_montant: num(req.body, 'umbrella_montant'),
      umbrella_retention: num(req.body, 'umbrella_retention'),
      produits_travaux_termines_montant: num(req.body, 'produits_travaux_termines_montant'),
      pollution_montant: num(req.body, 'pollution_montant'),
    });
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#garanties');
});

router.post('/:id/garanties-pe', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  const sPE = d.soumissions.perte_exploitation;
  if (!sPE) return pageErreur(res, 400, 'Volet absent', 'Pas de soumission perte d\u2019exploitation liée.');
  const avenants = {};
  for (const code of asArray(req.body.avenants)) {
    if (AVENANTS_PE.some(([c]) => c === code)) avenants[code] = 1;
  }
  try {
    pesoum.definirGaranties(sPE.id, res.locals.cabinetId, req.utilisateur.id, {
      limite: num(req.body, 'limite'),
      periode_indemnite_mois: num(req.body, 'periode_indemnite_mois'),
      franchise_jours: num(req.body, 'franchise_jours'),
      base_montant: txt(req.body, 'base_montant'),
      avenants,
      prime: num(req.body, 'prime'),
      regle_proportionnelle: num(req.body, 'regle_proportionnelle'),
      honoraires_comptables: num(req.body, 'honoraires_comptables'),
      formule: txt(req.body, 'formule'),
    });
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#garanties');
});

// --- Questions sectorielles ------------------------------------------------------------------
router.post('/:id/questions', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  const reponses = {};
  for (const q of combine.QUESTIONS_SECTORIELLES) {
    const val = txt(req.body, 'q_' + q.code);
    if (val !== null) reponses[q.code] = val;
  }
  try {
    combine.definirReponsesSectorielles(d.client_id, res.locals.cabinetId, req.utilisateur.id, reponses);
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#questions');
});

// --- Assurés additionnels et flottante ---------------------------------------------------------
router.post('/:id/assures', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  try {
    combine.ajouterAssureAdditionnel('combine', d.id, res.locals.cabinetId, req.utilisateur.id, {
      nom: txt(req.body, 'nom'), adresse: txt(req.body, 'adresse'), ville: txt(req.body, 'ville'),
      code_postal: txt(req.body, 'code_postal'), interet: txt(req.body, 'interet'),
    });
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#assures');
});

router.post('/:id/assures/:aid/archiver', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  combine.archiverAssureAdditionnel(Number(req.params.aid), res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/combinees/' + d.id + '#assures');
});

router.post('/:id/flottante', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  const sB = d.soumissions.biens;
  if (!sB) return pageErreur(res, 400, 'Volet absent', 'Pas de soumission biens liée.');
  try {
    combine.ajouterArticleFlottante(sB.id, res.locals.cabinetId, req.utilisateur.id, {
      description: txt(req.body, 'description'),
      base_reglement: txt(req.body, 'base_reglement'),
      assure_additionnel: txt(req.body, 'assure_additionnel'),
      montant: num(req.body, 'montant'),
    }, req.body.batiment_id ? Number(req.body.batiment_id) : null);
  } catch (e) { return erreur400(res, e); }
  res.redirect('/combinees/' + d.id + '#garanties');
});

router.post('/:id/archiver', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  combine.archiverDossier(d.id, res.locals.cabinetId, req.utilisateur.id);
  res.redirect('/combinees');
});

// --- Proposition combinée (demande de prix, gabarit réel) ------------------------------
const propositionCombinee = require('../lib/proposition-combinee');
const { genererPropositionCombineePdf } = require('../lib/proposition-combinee-pdf');
const { journal } = require('../lib/middleware');

function dossierEtProposition(req, res) {
  const d = dossierAutorise(req, res);
  if (!d) return null;
  return propositionCombinee.preparerPropositionCombinee(res.locals.cabinetId, d);
}

router.get('/:id/proposition', (req, res) => {
  const p = dossierEtProposition(req, res);
  if (!p) return;
  journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_combinee_generee',
    `Proposition combinée (HTML) du dossier #${p.dossierId}`);
  res.type('html').send(propositionCombinee.rendreHtmlPropositionCombinee(p));
});

router.get('/:id/proposition.pdf', async (req, res) => {
  const p = dossierEtProposition(req, res);
  if (!p) return;
  try {
    const pdf = await genererPropositionCombineePdf(p);
    journal(res.locals.cabinetId, req.utilisateur.id, 'proposition_combinee_generee',
      `Proposition combinée (PDF) du dossier #${p.dossierId}`);
    res.type('pdf')
      .set('Content-Disposition', `attachment; filename="proposition-combinee-${p.dossierId}.pdf"`)
      .send(pdf);
  } catch (e) {
    return pageErreur(res, 500, 'PDF impossible', e.message);
  }
});

// Brouillon « demande de prix » : créé dans la table brouillons, l'envoi
// reste au clic dans l'écran Brouillons (jamais d'envoi automatique).
router.post('/:id/proposition-brouillon', (req, res) => {
  const d = dossierAutorise(req, res);
  if (!d) return;
  const p = propositionCombinee.preparerPropositionCombinee(res.locals.cabinetId, d);
  const { sujet, contenu } = propositionCombinee.texteBrouillonDemandePrix(p);
  const r = bd.prepare(`
    INSERT INTO brouillons (cabinet_id, type, sujet, contenu, statut, combine_dossier_id)
    VALUES (?, 'demande_prix', ?, ?, 'brouillon', ?)
  `).run(res.locals.cabinetId, sujet, contenu, d.id);
  journal(res.locals.cabinetId, req.utilisateur.id, 'brouillon_demande_prix_cree',
    `Brouillon « demande de prix » #${r.lastInsertRowid} (dossier combiné #${d.id})`);
  res.redirect('/brouillons/' + r.lastInsertRowid);
});

module.exports = router;
