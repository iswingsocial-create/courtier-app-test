/**
 * routes/ouverture.js — « 🎙️ Ouvrir un dossier » : dictée vocale (ou texte
 * tapé) chez le client → analyse (moteur + motifs de dictée) → enrichissement
 * Google Maps → RÉVISION HUMAINE → création du dossier (entreprise + contact
 * + soumission du produit, éléments dictés versés).
 *
 * Règle d'or : rien n'est créé avant le clic « Créer le dossier » ; la
 * transcription est conservée comme une analyse (analyses_documents) et le
 * tout est journalisé (dossier_ouvert_voix). Aucune suppression.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const bd = require('../lib/bd');
const analyses = require('../lib/analyses-documents');
const moteurAnalyse = require('../lib/analyse-document');
const insertion = require('../lib/analyse-insertion');
const ouverture = require('../lib/ouverture-dossier');
const placesGoogle = require('../lib/places-google');
const { exigeAuth, exigeMotDePasseChange, journal, clientHorsPortefeuille, reponseHorsPortefeuille } = require('../lib/middleware');

const router = express.Router();
router.use(exigeAuth, exigeMotDePasseChange);

const NOMS_PRODUITS = {
  auto: 'Auto (FPQ1)', biens: 'Biens', rc: 'RC', cyber: 'Cyber', eo: 'E&O',
  do: 'D&O', pe: "Perte d'exploitation", flotte: 'Flotte', cautionnement: 'Cautionnement',
};

function pageErreur(res, statut, titre, message) {
  return res.status(statut).render('erreur', { titre, message });
}

// --- Page de dictée -----------------------------------------------------------------

router.get('/', (req, res) => {
  res.render('ouverture/nouveau', {
    googleConfiguree: placesGoogle.obtenirReglageGoogle(res.locals.cabinetId).configuree,
  });
});

// --- Analyse de la dictée -------------------------------------------------------------

router.post('/analyser', async (req, res) => {
  const cabinetId = res.locals.cabinetId;
  const userId = req.utilisateur.id;
  const texteBrut = String(req.body.texte || '').trim();
  if (texteBrut.length < 10) {
    return pageErreur(res, 400, 'Dictée trop courte', 'Dictez ou tapez quelques phrases : le nom de l’entreprise, le contact, le produit visé et ce que vous savez déjà (bâtiment, véhicules…).');
  }
  try {
    const r = await ouverture.analyserDictee(texteBrut, cabinetId);
    // La transcription est conservée comme une analyse (jamais perdue).
    const dir = path.join(__dirname, '..', 'uploads', String(cabinetId), 'analyses');
    fs.mkdirSync(dir, { recursive: true });
    const chemin = path.join(dir, `${Date.now()}-note-dictee.txt`);
    fs.writeFileSync(chemin, r.texte, 'utf8');
    const id = analyses.creerAnalyse(cabinetId, userId, {
      nomOrigine: 'Note dictée — ouverture de dossier', chemin,
      mime: 'text/plain', taille: Buffer.byteLength(r.texte, 'utf8'),
    });
    analyses.enregistrerExtraction(id, cabinetId, userId, { texte: r.texte, methode: 'dictée vocale / texte saisi' });
    analyses.enregistrerPropositions(id, cabinetId, userId, {
      produit: r.produit, confianceGlobale: null, champs: r.champs, listes: r.listes,
      moteur: r.moteur, message: r.message,
    });
    journal(cabinetId, userId, 'ouverture_dictee_analysee',
      `Ouverture de dossier : dictée analysée (analyse #${id}) — produit « ${r.produit || 'indéterminé'} », ${r.champs.length} champ(s), ${Object.values(r.listes || {}).reduce((s, l) => s + l.length, 0)} élément(s) de listes`);
    return res.redirect('/ouverture/' + id);
  } catch (e) {
    return pageErreur(res, 500, 'Analyse impossible', e.message);
  }
});

// --- Révision d'ouverture ---------------------------------------------------------------

function analyseOuverture(req, res) {
  const a = analyses.obtenirAnalyse(Number(req.params.id), res.locals.cabinetId, { inclureArchives: true });
  if (!a) { pageErreur(res, 404, 'Introuvable', 'Ouverture introuvable.'); return null; }
  return a;
}

function valeurChamp(a, cle) {
  const c = (a.champs || []).find((x) => x.champ === cle);
  return c ? c.valeur : '';
}

router.get('/:id', async (req, res) => {
  const a = analyseOuverture(req, res);
  if (!a) return;
  if (a.statut === 'insere') {
    return res.render('ouverture/revision', {
      a, dejaInsere: true, NOMS_PRODUITS,
      entreprise: {}, contact: {}, existantes: [], candidats: [], googleStatut: 'non_configure',
      soumissionChamps: [], META_LISTES: moteurAnalyse.META_LISTES,
    });
  }
  if (a.statut !== 'a_reviser') {
    return pageErreur(res, 400, 'Ouverture non prête', `Statut actuel « ${a.statut} » : la dictée n'a pas produit de révision. Repassez par « Ouvrir un dossier ».`);
  }
  const cabinetId = res.locals.cabinetId;
  const entreprise = {
    raison_sociale: valeurChamp(a, 'client.entreprise'),
    neq: valeurChamp(a, 'client.neq'),
    adresse: valeurChamp(a, 'client.adresse'),
    ville: valeurChamp(a, 'client.ville'),
    code_postal: valeurChamp(a, 'client.code_postal'),
    province: '', telephone_entreprise: '', courriel_entreprise: '', site_web: '',
  };
  const contact = {
    prenom: valeurChamp(a, 'contact.prenom'),
    nom: valeurChamp(a, 'contact.nom'),
    titre: valeurChamp(a, 'contact.titre'),
    courriel: valeurChamp(a, 'client.courriel'),
    telephone: valeurChamp(a, 'client.telephone'),
  };
  const soumissionChamps = (a.champs || [])
    .map((c, index) => ({ ...c, index }))
    .filter((c) => !c.champ.startsWith('client.') && !c.champ.startsWith('contact.'));

  // Un bâtiment / un lieu dicté sans adresse hérite de l'adresse de
  // l'entreprise (visible dès la révision ; même repli à la création).
  if (a.listes && entreprise.adresse) {
    for (const type of ['batiments', 'exploitations']) {
      for (const item of a.listes[type] || []) {
        if (!item.champs.adresse) item.champs.adresse = entreprise.adresse;
        if (!item.champs.ville && entreprise.ville) item.champs.ville = entreprise.ville;
        if (!item.champs.code_postal && entreprise.codePostal) item.champs.code_postal = entreprise.codePostal;
      }
    }
  }

  // Entreprises existantes probables : nom normalisé, puis place_id Google.
  const nomNorm = ouverture.normaliserNomEntreprise(entreprise.raison_sociale);
  const existantes = ouverture.trouverEntreprisesExistantes(cabinetId, entreprise.raison_sociale)
    .map((c) => ({ ...c, source: 'nom', exact: ouverture.normaliserNomEntreprise(c.raison_sociale) === nomNorm }));

  // Enrichissement Google Maps (si la clé est configurée) : recherche
  // automatique sur le nom dicté ; un candidat dont le place_id est déjà
  // au dossier signale le doublon.
  let candidats = [];
  let googleStatut = placesGoogle.obtenirReglageGoogle(cabinetId).configuree ? 'ok' : 'non_configure';
  let googleMessage = null;
  if (googleStatut === 'ok' && entreprise.raison_sociale) {
    const requete = [entreprise.raison_sociale, entreprise.ville].filter(Boolean).join(' ');
    const r = await placesGoogle.rechercherPourCabinet(cabinetId, requete);
    googleStatut = r.statut;
    googleMessage = r.message || null;
    candidats = (r.resultats || []).map((cand) => {
      const deja = ouverture.trouverParPlaceId(cabinetId, cand.place_id);
      if (deja && !existantes.some((e) => e.id === deja.id)) {
        existantes.push({ ...deja, source: 'google', exact: false });
      }
      return { ...cand, clientExistantId: deja ? deja.id : null };
    });
  }

  res.render('ouverture/revision', {
    a, dejaInsere: false, NOMS_PRODUITS,
    entreprise, contact, existantes, candidats, googleStatut, googleMessage,
    soumissionChamps, META_LISTES: moteurAnalyse.META_LISTES,
  });
});

// --- Création du dossier (confirmation explicite) -----------------------------------------

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

// Même convention de nommage que la révision d'analyse (liste_<type>_<i>_<champ>),
// avec coercition des booléens dictés (gicleurs : « 1 »/« oui » → 1, « 0 »/« non » → 0).
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
      if (type === 'batiments' && champCle === 'gicleurs') {
        if (/^(1|oui|vrai|x)$/i.test(v)) champs[champCle] = 1;
        else if (/^(0|non|faux)$/i.test(v)) champs[champCle] = 0;
        else champs[champCle] = v;
      } else if (cm.numerique) {
        const n = Number(v.replace(/[\s$]/g, '').replace(',', '.'));
        champs[champCle] = Number.isFinite(n) ? n : v;
      } else {
        champs[champCle] = v;
      }
    }
    if (Object.keys(champs).length) {
      (listes[type] = listes[type] || []).push({ champs, confiance: 'moyenne', extrait: 'Révision d’ouverture' });
    }
  }
  return listes;
}

router.post('/:id/creer', (req, res) => {
  const a = analyseOuverture(req, res);
  if (!a) return;
  if (a.statut === 'insere') {
    return pageErreur(res, 400, 'Dossier déjà créé', 'Cette dictée a déjà servi à ouvrir un dossier. Dictez une nouvelle note pour un autre dossier.');
  }
  if (a.statut !== 'a_reviser') {
    return pageErreur(res, 400, 'Ouverture non prête', `Statut actuel « ${a.statut} ».`);
  }
  const cabinetId = res.locals.cabinetId;
  const utilisateur = req.utilisateur;
  const produit = String(req.body.produit || '');
  if (!moteurAnalyse.PRODUITS.includes(produit)) {
    return pageErreur(res, 400, 'Produit manquant', 'Choisissez le produit de la soumission à créer — c’est obligatoire pour ouvrir le dossier.');
  }
  const v = (x) => String(x == null ? '' : x).trim();
  const entreprise = {
    raison_sociale: v(req.body.ent_raison_sociale),
    neq: v(req.body.ent_neq).replace(/\s/g, '') || null,
    adresse: v(req.body.ent_adresse) || null,
    ville: v(req.body.ent_ville) || null,
    province: v(req.body.ent_province) || null,
    code_postal: v(req.body.ent_code_postal) || null,
    telephone_entreprise: v(req.body.ent_telephone_entreprise) || null,
    courriel_entreprise: v(req.body.ent_courriel_entreprise) || null,
    site_web: v(req.body.ent_site_web) || null,
    place_id_google: v(req.body.google_place_id) || null,
  };
  const contact = {
    prenom: v(req.body.contact_prenom), nom: v(req.body.contact_nom),
    titre: v(req.body.contact_titre) || null,
    courriel: v(req.body.contact_courriel) || null,
    telephone: v(req.body.contact_telephone) || null,
  };
  if (entreprise.neq && !/^\d{10}$/.test(entreprise.neq)) {
    return pageErreur(res, 400, 'NEQ invalide', 'Le NEQ doit contenir 10 chiffres (ou être laissé vide).');
  }

  try {
    // --- Entreprise : nouvelle, ou existante choisie à la révision --------------
    let clientId = null;
    const mode = String(req.body.mode_entreprise || 'nouveau');
    if (mode.startsWith('existant:')) {
      const idExistant = Number(mode.split(':')[1]);
      const existant = bd.prepare('SELECT * FROM clients WHERE id = ? AND cabinet_id = ? AND archive = 0')
        .get(idExistant, cabinetId);
      if (!existant) return pageErreur(res, 404, 'Introuvable', 'Entreprise existante introuvable dans votre cabinet.');
      if (clientHorsPortefeuille(cabinetId, utilisateur, existant.id)) return reponseHorsPortefeuille(res);
      clientId = existant.id;
      // Enrichissement sobre : poser le place_id Google s'il manquait.
      if (entreprise.place_id_google && !existant.place_id_google) {
        bd.prepare('UPDATE clients SET place_id_google = ? WHERE id = ?').run(entreprise.place_id_google, clientId);
      }
    } else {
      if (entreprise.raison_sociale.length < 2) {
        return pageErreur(res, 400, 'Entreprise manquante', 'La raison sociale est requise pour créer le dossier (corrigez-la à la révision).');
      }
      clientId = ouverture.creerClientOuverture(cabinetId, utilisateur, entreprise, contact);
    }

    // --- Valeurs de la soumission retenues à la révision -------------------------
    const valeurs = {};
    (a.champs || []).forEach((c, i) => {
      if (c.champ.startsWith('client.') || c.champ.startsWith('contact.')) return;
      if (req.body['inclure_' + i] === 'on') {
        const brut = req.body['valeur_' + i];
        valeurs[c.champ] = coercer(c.champ, brut !== undefined ? String(brut).trim() : c.valeur);
      }
    });
    if (entreprise.adresse) valeurs['client.adresse'] = entreprise.adresse;
    if (entreprise.ville) valeurs['client.ville'] = entreprise.ville;

    // --- Éléments dictés : l'adresse de l'entreprise complète un bâtiment ou
    // un lieu dont l'adresse n'a pas été dictée (cas fréquent chez le client).
    const listes = lireListesForm(req);
    for (const type of ['batiments', 'exploitations']) {
      for (const item of listes[type] || []) {
        if (!item.champs.adresse && entreprise.adresse) item.champs.adresse = entreprise.adresse;
        if (!item.champs.ville && entreprise.ville) item.champs.ville = entreprise.ville;
        if (!item.champs.code_postal && entreprise.code_postal) item.champs.code_postal = entreprise.code_postal;
      }
    }

    const r = insertion.creerSoumission(cabinetId, utilisateur, produit, valeurs, listes, {
      clientId,
      notes: `Créée depuis une ouverture de dossier dictée (analyse #${a.id}).`,
    });
    analyses.marquerInseree(a.id, cabinetId, utilisateur.id, {
      produit, soumissionId: r.soumissionId,
      detail: 'ouverture de dossier dictée',
    });
    journal(cabinetId, utilisateur.id, 'dossier_ouvert_voix',
      `Dossier ouvert par dictée : entreprise #${clientId}, soumission ${produit} #${r.soumissionId} (${insertion.detailComptes(r.comptesListes)})${entreprise.place_id_google ? `, place_id Google ${entreprise.place_id_google}` : ''} — analyse #${a.id}`);
    return res.redirect('/' + produit + '/' + r.soumissionId);
  } catch (e) {
    return pageErreur(res, 400, 'Création impossible', e.message);
  }
});

module.exports = router;
module.exports.NOMS_PRODUITS = NOMS_PRODUITS;
