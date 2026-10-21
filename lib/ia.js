/**
 * lib/ia.js — Génération du brouillon de renouvellement.
 * Si COHERE_API_KEY est définie, on appelle l'API Cohere.
 * Sinon, on utilise un modèle de texte paramétré de qualité.
 * Le résultat est TOUJOURS un brouillon à valider — jamais d'envoi automatique.
 * Garde-fou : les invites n'emportent QUE les faits du dossier en cours et
 * interdisent d'inventer tout fait, montant, date ou nom absent des données
 * fournies.
 */
const https = require('https');

// Garde-fou commun aux brouillons : aucun fait inventé, seuls les éléments
// fournis dans l'invite (qui ne contient que le dossier en cours).
const ANCRAGE_BROUILLON = `N'invente aucun fait, montant, date ou nom : utilise uniquement les informations fournies ci-dessus, sans rien emprunter à un autre dossier. `;

const LIGNES = {
  cgl: 'responsabilité civile des entreprises',
  biens: 'biens commerciaux',
  perte_exploitation: 'perte d’exploitation',
  eo: 'responsabilité professionnelle',
  cyber: 'cyberrisques',
  flotte: 'flotte automobile',
  cautionnement: 'cautionnement',
  do: 'administrateurs et dirigeants',
  autre: 'assurance',
};

function modeleParDefaut({ client, police, protections, primeTotale, manquantes, joursRestants }) {
  const prenom = client.prenom || '';
  const entreprise = client.raison_sociale || '';
  const ligne = LIGNES[police.ligne] || police.ligne;
  const manque = manquantes.length > 0
    ? `\n\nEn révisant votre dossier, je remarque que vous ne bénéficiez pas encore de : ${manquantes.map((m) => m.libelle).join(', ')}. `
      + `Cela pourrait valoir la peine d'en discuter — dites-m'en des nouvelles si ça vous intéresse.`
    : '';
  return {
    sujet: `Renouvellement de votre assurance ${ligne} — police ${police.numero_police}`,
    contenu:
`Bonjour ${prenom},

Votre police d'assurance ${ligne} n° ${police.numero_police} chez ${police.assureur}${entreprise ? ` pour ${entreprise}` : ''} arrive à échéance le ${police.date_echeance} (dans ${joursRestants} jours).

Voici le sommaire de vos protections actuelles :
${protections.map((p) => `• ${p.libelle} — ${Number(p.prime).toFixed(2)} $`).join('\n')}
Prime totale estimée : ${primeTotale.toFixed(2)} $
Franchise : ${Number(police.franchise).toFixed(2)} $${manque}

Je vous propose qu'on prenne quelques minutes ensemble pour réviser tout ça avant le renouvellement, et vérifier que vos protections correspondent toujours à votre situation.

Au plaisir,`,
  };
}

function appelerCohere(prompt, cleOverride, options = {}) {
  return new Promise((resolve, reject) => {
    const cle = cleOverride || process.env.COHERE_API_KEY;
    const modele = process.env.COHERE_MODEL || 'command-a-03-2025';
    // Température : 0,4 par défaut (rédaction de brouillons) ; les usages
    // d'EXTRACTION et d'interprétation de commandes passent 0 explicitement
    // (déterministe — l'IA ne doit jamais partir en déroute).
    const temperature = typeof options.temperature === 'number' ? options.temperature : 0.4;
    const corps = JSON.stringify({
      model: modele,
      messages: [{ role: 'user', content: prompt }],
      temperature,
    });
    const req = https.request({
      hostname: 'api.cohere.ai',
      path: '/v2/chat',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cle}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(corps),
      },
      timeout: 25000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const texte = json.message && json.message.content
            ? json.message.content.map((b) => b.text || '').join('')
            : null;
          if (texte) resolve(texte.trim());
          else reject(new Error('Réponse Cohere inattendue'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Délai dépassé (Cohere)')); });
    // Délai dur : borne l'attente totale même si le TLS/réseau traîne.
    setTimeout(() => { try { req.destroy(); } catch (e) {} reject(new Error('Délai dépassé (Cohere)')); }, 30000);
    req.write(corps);
    req.end();
  });
}

// Moteur externe des brouillons : Augure (IA canadienne) quand il est le
// moteur effectif du cabinet (cabinetId fourni par la route), sinon
// Cohere quand COHERE_API_KEY est définie (comportement historique).
// Retourne { texte, source } ou null → modèle de texte paramétré.
// En cas d'erreur du moteur, repli signalé par la console, jamais levé.
async function appelerMoteurBrouillon(cabinetId, prompt) {
  if (cabinetId) {
    try {
      const eff = require('./reglages-ia').moteurEffectif(cabinetId);
      if (eff.mode === 'augure') {
        const texte = await require('./augure').appelerAugureCabinet(cabinetId, { prompt, temperature: 0.4 });
        return { texte, source: 'augure' };
      }
    } catch (e) {
      console.error('Augure indisponible, repli sur le modèle :', e.message);
      return null;
    }
  }
  if (process.env.COHERE_API_KEY) {
    try {
      const texte = await appelerCohere(prompt);
      return { texte, source: 'cohere' };
    } catch (e) {
      console.error('Cohere indisponible, repli sur le modèle :', e.message);
      return null;
    }
  }
  return null;
}

async function genererBrouillonRenouvellement({ client, police, protections, primeTotale, manquantes, joursRestants, nomCourtier, cabinetId }) {
  const defaut = modeleParDefaut({ client, police, protections, primeTotale, manquantes, joursRestants });

  const prompt =
`Tu es l'assistant d'un cabinet de courtage en assurance de dommages au Québec. ` +
`Rédige un courriel de renouvellement en français, ton professionnel et chaleureux, adressé à ${client.prenom} ${client.nom}${client.raison_sociale ? ` (${client.titre_contact || 'contact'} chez ${client.raison_sociale})` : ''}. ` +
`Police ${police.ligne} n° ${police.numero_police} chez ${police.assureur}, échéance le ${police.date_echeance} (dans ${joursRestants} jours). ` +
`Protections : ${protections.map((p) => `${p.libelle} (${Number(p.prime).toFixed(2)} $)`).join('; ')}. ` +
`Prime totale : ${primeTotale.toFixed(2)} $. Franchise : ${Number(police.franchise).toFixed(2)} $. ` +
(manquantes.length > 0
  ? `Protections recommandées manquantes à suggérer délicatement : ${manquantes.map((m) => m.libelle).join(', ')}. `
  : '') +
`Propose une courte rencontre de révision. Signé : ${nomCourtier}. ` +
ANCRAGE_BROUILLON +
`Réponds UNIQUEMENT avec le courriel, sans préambule. Commence par une ligne "Sujet : ..." puis le corps.`;

  const appel = await appelerMoteurBrouillon(cabinetId, prompt);
  if (!appel) return { ...defaut, source: 'modele' };
  const texte = appel.texte;
  const lignes = texte.split('\n');
  let sujet = defaut.sujet;
  let contenu = texte;
  if (/^sujet\s*:/i.test(lignes[0])) {
    sujet = lignes[0].replace(/^sujet\s*:\s*/i, '').trim();
    contenu = lignes.slice(1).join('\n').trim();
  }
  return { sujet, contenu, source: appel.source };
}

function modeleRelanceParDefaut({ client, facture, joursRetard }) {
  const entreprise = client.raison_sociale || '';
  const prenom = client.prenom || '';
  const solde = (Number(facture.montant) - Number(facture.montant_paye || 0)).toFixed(2);
  return {
    sujet: `Rappel : facture ${facture.numero_facture} en souffrance (${solde} $)`,
    contenu:
`Bonjour ${prenom},

Je me permets de vous rappeler que la facture ${facture.numero_facture}${entreprise ? ` pour ${entreprise}` : ''} — « ${facture.description} » — d'un montant de ${Number(facture.montant).toFixed(2)} $ est échue depuis le ${facture.date_echeance} (il y a ${joursRetard} jour${joursRetard > 1 ? 's' : ''}).

Solde restant dû : ${solde} $.

Si le paiement a déjà été effectué, veuillez ignorer ce message. Sinon, pourriez-vous procéder au règlement dans les plus brefs délais ? N'hésitez pas à me contacter si vous avez des questions ou si vous souhaitez convenir d'une entente de paiement.

Merci de votre collaboration,

Au plaisir,`,
  };
}

async function genererBrouillonRelance({ client, facture, joursRetard, nomCourtier, cabinetId }) {
  const defaut = modeleRelanceParDefaut({ client, facture, joursRetard });

  const solde = (Number(facture.montant) - Number(facture.montant_paye || 0)).toFixed(2);
  const prompt =
`Tu es l'assistant d'un cabinet de courtage en assurance de dommages au Québec. ` +
`Rédige un courriel de relance de paiement en français, ton professionnel, ferme mais courtois, adressé à ${client.prenom} ${client.nom}${client.raison_sociale ? ` (${client.titre_contact || 'contact'} chez ${client.raison_sociale})` : ''}. ` +
`Facture ${facture.numero_facture} : « ${facture.description} », montant total ${Number(facture.montant).toFixed(2)} $, déjà payé ${Number(facture.montant_paye || 0).toFixed(2)} $, solde dû ${solde} $, échue depuis le ${facture.date_echeance} (il y a ${joursRetard} jours). ` +
`Demande le règlement rapide, propose une entente de paiement si besoin, reste courtois. Signé : ${nomCourtier}. ` +
ANCRAGE_BROUILLON +
`Réponds UNIQUEMENT avec le courriel, sans préambule. Commence par une ligne "Sujet : ..." puis le corps.`;

  const appel = await appelerMoteurBrouillon(cabinetId, prompt);
  if (!appel) return { ...defaut, source: 'modele' };
  const texte = appel.texte;
  const lignes = texte.split('\n');
  let sujet = defaut.sujet;
  let contenu = texte;
  if (/^sujet\s*:/i.test(lignes[0])) {
    sujet = lignes[0].replace(/^sujet\s*:\s*/i, '').trim();
    contenu = lignes.slice(1).join('\n').trim();
  }
  return { sujet, contenu, source: appel.source };
}

function modeleCampagneParDefaut({ nom, secteurs, nomCabinet }) {
  const liste = secteurs.join(', ');
  return {
    contenu:
`Bonjour,

Je me permets de vous écrire parce que votre entreprise évolue dans le secteur ${secteurs.length === 1 ? `« ${secteurs[0]} »` : `suivant : ${liste}`} — un secteur où nous accompagnons déjà plusieurs entreprises pour leurs assurances commerciales.

En tant que courtier, mon travail est de m'assurer que vos protections correspondent vraiment à vos risques : responsabilité civile, biens, perte d'exploitation, cyberrisques… Une courte révision suffit souvent à repérer des protections manquantes ou des économies possibles.

Souhaitez-vous qu'on prenne 15 minutes ensemble pour faire le point sur vos assurances ? Sans engagement, bien sûr.

Au plaisir d'échanger,`,
  };
}

async function genererContenuCampagne({ nom, secteurs, nomCabinet, nomCourtier, cabinetId }) {
  const defaut = modeleCampagneParDefaut({ nom, secteurs, nomCabinet });

  const prompt =
`Tu es l'assistant d'un cabinet de courtage en assurance de dommages au Québec. ` +
`Rédige un courriel de sollicitation commerciale en français, ton professionnel et chaleureux, pour une campagne nommée « ${nom} » ciblant les entreprises des secteurs suivants : ${secteurs.join(', ')}. ` +
`Le courriel doit : présenter brièvement le cabinet (${nomCabinet || 'notre cabinet'}), expliquer pourquoi ces secteurs ont des besoins d'assurance spécifiques, proposer une courte rencontre de révision sans engagement, rester concis (150 mots max). ` +
`Ne pas inclure de ligne d'objet. Signé : ${nomCourtier || 'votre courtier'}. ` +
ANCRAGE_BROUILLON +
`Réponds UNIQUEMENT avec le corps du courriel, sans préambule.`;

  const appel = await appelerMoteurBrouillon(cabinetId, prompt);
  if (!appel) return { ...defaut, source: 'modele' };
  return { contenu: appel.texte.trim(), source: appel.source };
}

function modeleLibreParDefaut({ destinataire, contexte, ton }) {
  const qui = destinataire ? ` ${destinataire}` : '';
  const tonTxt = ton === 'formel' ? 'formel et respectueux'
    : ton === 'amical' ? 'chaleureux et amical'
    : 'professionnel et courtois';
  return {
    sujet: `Suivi — ${contexte.slice(0, 60)}${contexte.length > 60 ? '…' : ''}`,
    contenu:
`Bonjour${qui ? ' ' + qui : ''},

Je vous écris au sujet de : ${contexte}.

[Précisez ici les détails : dates, montants, pièces jointes…]

N'hésitez pas à me répondre si vous avez des questions.

Au plaisir,`,
    _ton: tonTxt,
  };
}

async function genererCourrielLibre({ destinataire, contexte, ton, nomCourtier, cabinetId }) {
  const defaut = modeleLibreParDefaut({ destinataire, contexte, ton });
  delete defaut._ton;

  const tonTxt = ton === 'formel' ? 'formel et respectueux'
    : ton === 'amical' ? 'chaleureux et amical'
    : 'professionnel et courtois';
  const prompt =
`Tu es l'assistant d'un cabinet de courtage en assurance de dommages au Québec. ` +
`Rédige un courriel en français, ton ${tonTxt}, ` +
(destinataire ? `adressé à ${destinataire}. ` : 'sans nom de destinataire précis. ') +
`Sujet à traiter : ${contexte}. ` +
`Reste concis et concret. Signé : ${nomCourtier || 'votre courtier'}. ` +
ANCRAGE_BROUILLON +
`Réponds UNIQUEMENT avec le courriel, sans préambule. Commence par une ligne "Sujet : ..." puis le corps.`;

  const appel = await appelerMoteurBrouillon(cabinetId, prompt);
  if (!appel) return { ...defaut, source: 'modele' };
  const texte = appel.texte;
  const lignes = texte.split('\n');
  let sujet = defaut.sujet;
  let contenu = texte;
  if (/^sujet\s*:/i.test(lignes[0])) {
    sujet = lignes[0].replace(/^sujet\s*:\s*/i, '').trim();
    contenu = lignes.slice(1).join('\n').trim();
  }
  return { sujet, contenu, source: appel.source };
}

module.exports = {
  genererBrouillonRenouvellement,
  genererBrouillonRelance,
  genererContenuCampagne,
  genererCourrielLibre,
  appelerCohere,
};
