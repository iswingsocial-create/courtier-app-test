/**
 * lib/ouverture-dossier.js — Ouverture de dossier à la voix (ou au texte) :
 * Patrick dicte une note libre chez le client (« Nouveau dossier :
 * Plomberie Saint-Laurent inc., contact Mario Tremblay, à Montréal.
 * Commence une soumission biens : bâtiment béton 1998, 12 000 pi²,
 * gicleurs oui… ») ; ce module prépare la RÉVISION :
 *  - normalisation de la dictée (public/dictee.js, côté serveur aussi) ;
 *  - produit dicté explicitement (« soumission biens », « soumission
 *    flotte »…) — sinon détection du moteur d'analyse ;
 *  - champs du moteur d'analyse (lib/analyse-document.js) COMPLÉTÉS par des
 *    motifs FR sobres propres à la dictée (en-tête « Nouveau dossier : »,
 *    « contact : Prénom Nom », adresse civique complète, ville après « à ») ;
 *  - faits de bâtiment dictés (construction, année, superficie, gicleurs…)
 *    fusionnés dans la liste des bâtiments — le moteur texte ne les lit
 *    que dans les documents structurés.
 *
 * RIEN n'est créé ici : la création (client + contact + soumission) passe
 * par l'écran de révision et lib/analyse-insertion.js, après confirmation.
 * La transcription est conservée comme analyse (analyses_documents) —
 * jamais perdue.
 */
const bd = require('./bd');
const { journal } = require('./middleware');
const moteurAnalyse = require('./analyse-document');
const { normaliserDictee } = require('../public/dictee');

// --- Noms d'entreprises : correspondance « probable » ----------------------------

const SUFFIXES_LEGAUX = new Set([
  'inc', 'ltee', 'enr', 'senc', 'cie', 'compagnie', 'ltd', 'limitee',
  'corporation', 'corp', 'sa', 'srl', 'spa',
]);

function normaliserNomEntreprise(nom) {
  let t = String(nom || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g, ' ');
  const mots = t.split(' ').filter(Boolean);
  while (mots.length > 1 && SUFFIXES_LEGAUX.has(mots[mots.length - 1])) mots.pop();
  return mots.join(' ');
}

/** Entreprises du cabinet dont le nom normalisé correspond (égal ou contenu). */
function trouverEntreprisesExistantes(cabinetId, nom) {
  const cible = normaliserNomEntreprise(nom);
  if (cible.length < 3) return [];
  return bd.prepare('SELECT * FROM clients WHERE cabinet_id = ? AND archive = 0 ORDER BY raison_sociale')
    .all(cabinetId)
    .filter((c) => {
      const n = normaliserNomEntreprise(c.raison_sociale);
      return n === cible || (n.length >= 4 && cible.length >= 4 && (n.includes(cible) || cible.includes(n)));
    });
}

/** Entreprise du cabinet portant déjà ce place_id Google (doublon d'établissement). */
function trouverParPlaceId(cabinetId, placeId) {
  if (!placeId) return null;
  return bd.prepare('SELECT * FROM clients WHERE cabinet_id = ? AND archive = 0 AND place_id_google = ?')
    .get(cabinetId, placeId) || null;
}

// --- Motifs propres à la dictée ---------------------------------------------------

const MOTS_PRODUITS_DICTE = [
  ['cautionnement', /soumission\s+(?:de\s+)?cautionnement/i],
  ['flotte', /soumission\s+(?:de\s+)?flotte/i],
  ['pe', /soumission\s+(?:de\s+)?(?:perte\s+d['’]exploitation|pe)\b/i],
  ['do', /soumission\s+(?:de\s+)?(?:d\s?[&\/\-]?\s?o|administrateurs?\s+et\s+dirigeants?)/i],
  ['eo', /soumission\s+(?:de\s+)?(?:e\s?[&\/]\s?o|erreurs?\s+et\s+omissions?)/i],
  ['cyber', /soumission\s+(?:de\s+)?cyber/i],
  ['rc', /soumission\s+(?:de\s+)?(?:rc|responsabilit[ée]\s+civile)/i],
  ['biens', /soumission\s+(?:de\s+)?biens/i],
  ['auto', /soumission\s+(?:de\s+)?(?:auto(?:mobile)?|fpq\s?1)/i],
];

function detecterProduitDicte(texte) {
  for (const [produit, re] of MOTS_PRODUITS_DICTE) {
    if (re.test(texte)) return produit;
  }
  return null;
}

const RE_NOM_PERSONNE = /([A-ZÀ-Þ][a-zà-ÿ'’-]+)\s+([A-ZÀ-Þ][a-zà-ÿ'’-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿ'’-]+)?)/;

/**
 * Extraction « dictée » de l'entreprise et du contact — complète le moteur
 * (qui lit surtout des libellés de documents). Retourne des champs au même
 * format que le moteur ({ champ, table, colonne, libelle, valeur, confiance,
 * extrait }) pour client.* et contact.* (pseudo-champs de la révision).
 */
function extraireEntrepriseDictee(texte) {
  const champs = [];
  const pousser = (champ, table, colonne, libelle, valeur, extrait) => {
    if (valeur === null || valeur === undefined || String(valeur).trim() === '') return;
    champs.push({
      produit: null, champ, table, colonne, libelle,
      valeur: String(valeur).trim(), confiance: 'moyenne', extrait: extrait || null,
    });
  };

  // Entreprise : « Nouveau dossier : X », « Dossier : X », « Entreprise : X »
  let m = texte.match(/(?:nouveau\s+dossier|nouvel\s+assur[ée]|dossier|entreprise|client)\s*[:\-]\s*([^,.\n;]+)/i);
  if (m) pousser('client.entreprise', 'clients', 'raison_sociale', 'Entreprise (raison sociale)', m[1], m[0]);

  // Adresse civique complète : « 450 rue des Érables, Montréal » (ou « situé au … »)
  m = texte.match(/(\d{1,6}\s+(?:rue|avenue|av\.?|boulevard|boul\.?|chemin|route|rang|mont[ée]e|place|impasse|all[ée]e|c[ôo]te|croissant|terrasse)\s+[^,.\n;]+?)(?:\s*,\s*([A-ZÀ-Þ][\wÀ-ÿ'’ -]+?))?(?=\s*(?:,|\.|;|\n|$))/i);
  if (m) {
    pousser('client.adresse', 'clients', 'adresse', 'Adresse', m[1], m[0]);
    if (m[2] && !/^(qu[ée]bec|canada)$/i.test(m[2].trim())) {
      pousser('client.ville', 'clients', 'ville', 'Ville', m[2], m[0]);
    }
  }

  // Ville seule : « …, à Montréal. »
  m = texte.match(/[,.]\s+à\s+([A-ZÀ-Þ][a-zà-ÿ'’ -]{1,38}?)(?=\s*(?:\.|,|;|\n|$))/);
  if (m) pousser('client.ville', 'clients', 'ville', 'Ville', m[1], m[0]);

  // Contact : « contact : Mario Tremblay », « personne-ressource : … », « demander Mario Tremblay »
  m = texte.match(/(?:contact|personne-ressource|personne\s+ressource|propri[ée]taire|demander)\s*[:\-]?\s+([A-ZÀ-Þ][a-zà-ÿ'’-]+)\s+([A-ZÀ-Þ][a-zà-ÿ'’-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿ'’-]+)?)/i);
  if (m) {
    pousser('contact.prenom', 'contacts', 'prenom', 'Contact — prénom', m[1], m[0]);
    pousser('contact.nom', 'contacts', 'nom', 'Contact — nom', m[2], m[0]);
  }
  m = texte.match(/(?:titre|fonction)\s*(?:du contact)?\s*[:\-]\s*([^,.\n;]+)/i);
  if (m) pousser('contact.titre', 'contacts', 'titre', 'Contact — titre / fonction', m[1], m[0]);

  return champs;
}

// --- Faits de bâtiment dictés --------------------------------------------------------

const CONSTRUCTIONS_DICTE = [
  [/b[ée]ton/i, 'beton'], [/acier/i, 'acier'], [/bois/i, 'bois'],
  [/brique|ma[çc]onnerie/i, 'maconnerie'], [/mixte/i, 'mixte'],
];

function faitsBatimentDicte(bloc) {
  const faits = {};
  for (const [re, code] of CONSTRUCTIONS_DICTE) {
    if (re.test(bloc)) { faits.type_construction = code; break; }
  }
  let m = bloc.match(/(?:constru\w*|ann[ée]e(?:\s+de\s+construction)?)\s*(?:en\s+)?[:\-]?\s*((?:19|20)\d{2})/i)
    || bloc.match(/\b((?:19|20)\d{2})\b/);
  if (m) faits.annee_construction = Number(m[1]);
  m = bloc.match(/(\d[\d\s\u202F]*)\s*(?:pi²|pi2|pieds?\s*carr[ée]s?)/i);
  if (m) faits.superficie_pi2 = Number(m[1].replace(/[\s\u202F]/g, ''));
  m = bloc.match(/gicleurs?\s*[:\-]?\s*(oui|non)/i);
  if (m) faits.gicleurs = /oui/i.test(m[1]) ? 1 : 0;
  else if (/sans\s+gicleurs?/i.test(bloc)) faits.gicleurs = 0;
  else if (/avec\s+(?:des\s+)?gicleurs?/i.test(bloc)) faits.gicleurs = 1;
  m = bloc.match(/(\d+)\s*[ée]tages?/i);
  if (m) faits.nb_etages = Number(m[1]);
  m = bloc.match(/toiture\s*(?:refaite\s*)?(?:en|de)?\s*[:\-]?\s*((?:19|20)\d{2})/i);
  if (m) faits.annee_toiture = Number(m[1]);
  m = bloc.match(/caserne\s*(?:à|a)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*km/i);
  if (m) faits.distance_caserne_km = Number(m[1].replace(',', '.'));
  m = bloc.match(/chauffage\s*[:\-]\s*([^,.\n;]+)/i);
  if (m) faits.chauffage = m[1].trim();
  m = bloc.match(/valeur\s*[:\-]?\s*(\d[\d\s\u202F]*)\s*(?:dollars|\$)?/i);
  if (m) faits.valeur_batiment = Number(m[1].replace(/[\s\u202F]/g, ''));
  return faits;
}

/**
 * Fusionne les faits dictés dans la liste des bâtiments du moteur (même
 * ordre de blocs « Bâtiment : … ») — sans écraser ce que le moteur a lu.
 * Crée l'élément si le bloc existe mais que le moteur n'a rien retenu.
 */
function enrichirBatimentsDicte(texte, listes) {
  const blocs = [];
  let courant = null;
  for (const ligne of String(texte).split(/\r?\n/)) {
    if (/^\s*(?:[-•*]\s*)?b[âa]timent\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i.test(ligne)) {
      if (courant) blocs.push(courant);
      courant = [ligne];
    } else if (courant) {
      courant.push(ligne);
    }
  }
  if (courant) blocs.push(courant);
  // Dictée d'une seule phrase : « … soumission biens : bâtiment béton 1998 … »
  if (!blocs.length) {
    const m = String(texte).match(/b[âa]timent\s*[:\-]\s*([^]+)/i);
    if (m) blocs.push([m[0]]);
  }
  if (!blocs.length) return listes;
  const sortie = { ...(listes || {}) };
  const items = [...((sortie.batiments) || [])];
  blocs.forEach((lignes, i) => {
    const faits = faitsBatimentDicte(lignes.join('\n'));
    if (!Object.keys(faits).length) return;
    if (!items[i]) {
      items[i] = { champs: {}, confiance: 'moyenne', extrait: lignes[0].trim().slice(0, 140) };
    }
    for (const [cle, valeur] of Object.entries(faits)) {
      if (items[i].champs[cle] === undefined || items[i].champs[cle] === null || items[i].champs[cle] === '') {
        items[i].champs[cle] = valeur;
      }
    }
  });
  const propres = items.filter((it) => it && Object.keys(it.champs || {}).length);
  if (propres.length) sortie.batiments = propres;
  return sortie;
}

// --- Faits de véhicule dictés + noms de conducteurs ----------------------------------
// Le moteur lit « Valeur : 45 000 $ » dans les documents ; la dictée dit
// « valeur 45 000 dollars » — on comble la valeur et on nettoie le modèle
// (« F-150 2022, valeur… » → « F-150 ») et le nom du conducteur lu dans
// l'en-tête (« Lapointe, permis … » → « Lapointe »).
function enrichirVehiculesDicte(texte, listes) {
  if (!listes || !Array.isArray(listes.vehicules)) return listes;
  const blocs = [];
  let courant = null;
  for (const ligne of String(texte).split(/\r?\n/)) {
    if (/^\s*(?:[-•*]\s*)?v[ée]hicule\s*(?:n°|no\.?|#)?\s*\d*\s*[:\-]/i.test(ligne)) {
      if (courant) blocs.push(courant);
      courant = [ligne];
    } else if (courant) {
      courant.push(ligne);
    }
  }
  if (courant) blocs.push(courant);
  listes.vehicules.forEach((item, i) => {
    const bt = (blocs[i] || []).join('\n');
    if (item.champs.valeur === undefined && bt) {
      const m = bt.match(/valeur\s*[:\-]?\s*(\d[\d\s\u202F]*)\s*(?:dollars|\$)?/i);
      if (m) item.champs.valeur = Number(m[1].replace(/[\s\u202F]/g, ''));
    }
    if (typeof item.champs.modele === 'string') {
      let modele = item.champs.modele.split(/,\s*valeur\b/i)[0].trim();
      if (item.champs.annee) modele = modele.replace(new RegExp(`\\s+${item.champs.annee}$`), '').trim();
      item.champs.modele = modele.replace(/[.\s]+$/, '');
    }
  });
  return listes;
}

function nettoyerConducteursDicte(listes) {
  if (!listes || !Array.isArray(listes.conducteurs)) return listes;
  for (const item of listes.conducteurs) {
    const nomBrut = String(item.champs.nom || '');
    if (!nomBrut.includes(',')) continue;
    const avantVirgule = `${item.champs.prenom || ''} ${nomBrut}`.split(',')[0].trim();
    const mots = avantVirgule.split(/\s+/).filter(Boolean);
    if (mots.length >= 2) {
      item.champs.prenom = mots[0];
      item.champs.nom = mots.slice(1).join(' ');
    }
  }
  return listes;
}

// --- Analyse complète d'une dictée ---------------------------------------------------

// La dictée arrive en un seul bloc de phrases ; le moteur d'analyse lit
// ligne par ligne (blocs « Bâtiment : », « Véhicule : »…). On réintroduit
// donc des sauts de ligne devant les marqueurs de segment quand ils
// suivent une fin de phrase — les mots ne changent pas, seule la mise en
// lignes rend la note lisible par le moteur (et par l'humain).
const MARQUEURS_SEGMENTS = 'Véhicule|Vehicule|Conducteur|Bâtiment|Batiment|Lieu|Exploitation|Dirigeant|Établissement|Etablissement|Obligation|Cautionnement|Activité|Activite|Mesure';
const RE_SEGMENTS = new RegExp(`([.;])\\s+(?=(${MARQUEURS_SEGMENTS})\\s*(?:n°|no\\.?|#)?\\s*\\d*\\s*[:\\-])`, 'gi');

function restructurerDictee(texte) {
  return String(texte || '').replace(RE_SEGMENTS, '$1\n');
}

/**
 * Analyse le texte dicté (ou tapé) et prépare la révision d'ouverture :
 * { texte, produit, champs, listes, moteur, message }.
 * Les champs client.* / contact.* alimentent les blocs Entreprise et
 * Contact de la révision ; les autres, le bloc soumission.
 */
async function analyserDictee(texteBrut, cabinetId) {
  const texte = restructurerDictee(normaliserDictee(String(texteBrut || '')));
  const produitDicte = detecterProduitDicte(texte);
  const r = await moteurAnalyse.analyser(texte, { cabinetId });
  const produit = produitDicte || r.produit;

  // Listes : si le produit dicté diffère de celui du moteur, relire les
  // listes pour le BON produit (le moteur ne lit que celles du sien).
  let listes = r.listes || {};
  if (produitDicte && produitDicte !== r.produit) {
    const l2 = moteurAnalyse.extraireListes(texte, produitDicte);
    if (Object.keys(l2).length) listes = l2;
  }
  if (produit === 'biens') listes = enrichirBatimentsDicte(texte, listes);
  if (produit === 'auto' || produit === 'flotte') {
    listes = enrichirVehiculesDicte(texte, listes);
    listes = nettoyerConducteursDicte(listes);
  }

  // Champs : le moteur d'abord, les motifs de dictée comblent les manques.
  const parCle = new Map();
  for (const c of r.champs || []) if (!parCle.has(c.champ)) parCle.set(c.champ, c);
  for (const c of extraireEntrepriseDictee(texte)) {
    if (!parCle.has(c.champ)) parCle.set(c.champ, { ...c, produit: produit || null });
  }
  const champs = [...parCle.values()].map((c) => ({ ...c, produit: produit || c.produit || null }));

  let message = r.message;
  if (produitDicte && produitDicte !== r.produit) message = null;
  if (!produit) {
    message = 'Produit non détecté dans la dictée : choisissez le produit de la soumission à la révision (obligatoire pour créer le dossier).';
  }
  return { texte, produit, champs, listes, moteur: r.moteur, message };
}

// --- Création du client (révision confirmée seulement) ---------------------------------

function creerClientOuverture(cabinetId, utilisateur, entreprise, contact) {
  const responsableId = utilisateur.role === 'courtier' ? utilisateur.id : null;
  const prenom = String(contact.prenom || '').trim();
  const nom = String(contact.nom || '').trim();
  const r = bd.prepare(`
    INSERT INTO clients (cabinet_id, raison_sociale, neq, prenom, nom, titre_contact,
      courriel, telephone, adresse, ville, province, code_postal,
      courriel_entreprise, telephone_entreprise, site_web, place_id_google,
      responsable_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cabinetId, entreprise.raison_sociale, entreprise.neq || null, prenom, nom,
    contact.titre || null, contact.courriel || null, contact.telephone || null,
    entreprise.adresse || null, entreprise.ville || null, entreprise.province || null,
    entreprise.code_postal || null, entreprise.courriel_entreprise || null,
    entreprise.telephone_entreprise || null, entreprise.site_web || null,
    entreprise.place_id_google || null, responsableId,
    'Entreprise créée depuis une ouverture de dossier dictée (à compléter).',
  );
  const clientId = r.lastInsertRowid;
  if (prenom || nom) {
    bd.prepare(`
      INSERT INTO contacts (cabinet_id, client_id, prenom, nom, titre, courriel, telephone, principal)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(cabinetId, clientId, prenom, nom, contact.titre || null,
      contact.courriel || null, contact.telephone || null);
  }
  journal(cabinetId, utilisateur.id, 'entreprise_creee',
    `Entreprise ${entreprise.raison_sociale} (id ${clientId}) — ouverture de dossier dictée`);
  return clientId;
}

module.exports = {
  normaliserNomEntreprise, trouverEntreprisesExistantes, trouverParPlaceId,
  detecterProduitDicte, extraireEntrepriseDictee, faitsBatimentDicte,
  enrichirBatimentsDicte, restructurerDictee, enrichirVehiculesDicte,
  nettoyerConducteursDicte, analyserDictee, creerClientOuverture,
};
