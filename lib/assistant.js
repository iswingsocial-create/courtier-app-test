/**
 * lib/assistant.js — Assistant IA conversationnel (page « Assistant »).
 *
 * Moteur branchable (variable ASSISTANT_MOTEUR, sinon Cohere si la clé existe) :
 *   - « local »   (défaut, tests) : analyseur de commandes en français qui exécute
 *     des actions concrètes : ajouter un contact, créer une tâche, ajouter une note,
 *     lister les tâches. Aucun appel externe.
 *   - « cohere »  : Cohere (données au Canada) reformule la demande en commande
 *     structurée JSON, exécutée par les mêmes fonctions validées.
 *   - Prévu      : connecteur IA québécoise — même interface (texte -> commande
 *     JSON validée), à brancher ici sans toucher aux routes ni aux vues.
 *
 * Règles : rien ne s'exécute sans être validé (client existant, champs requis) ;
 * chaque action est inscrite au journal d'audit.
 */
const bd = require('./bd');
const { journal } = require('./middleware');

const MOTEUR = process.env.ASSISTANT_MOTEUR || (process.env.COHERE_API_KEY ? 'cohere' : 'local');
const LONGUEUR_MAX = 2000;

function moteurActif() { return MOTEUR; }

// --- Utilitaires ---------------------------------------------------------------------------------
function trouverClient(cabinetId, nomBrut) {
  const nom = String(nomBrut || '').trim().replace(/\s+/g, ' ');
  if (nom.length < 2) return { statut: 'introuvable' };
  const exact = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0 AND lower(raison_sociale) = lower(?)'
  ).get(cabinetId, nom);
  if (exact) return { statut: 'ok', client: exact };
  const liste = bd.prepare(
    'SELECT id, raison_sociale FROM clients WHERE cabinet_id = ? AND archive = 0 AND lower(raison_sociale) LIKE lower(?) ORDER BY raison_sociale LIMIT 6'
  ).all(cabinetId, `%${nom}%`);
  if (liste.length === 1) return { statut: 'ok', client: liste[0] };
  if (liste.length > 1) return { statut: 'ambigu', options: liste.map((l) => l.raison_sociale) };
  return { statut: 'introuvable', recherche: nom };
}

function reponseClientIntrouvable(res) {
  if (res.statut === 'ambigu') {
    return `Plusieurs entreprises correspondent : ${res.options.join(' · ')}. Précisez le nom exact, s'il vous plaît.`;
  }
  return `Je n'ai pas trouvé l'entreprise « ${res.recherche || '?'} ». Vérifiez le nom dans la liste des entreprises.`;
}

const MOIS_FR = {
  janvier: '01', fevrier: '02', février: '02', mars: '03', avril: '04', mai: '05', juin: '06',
  juillet: '07', aout: '08', août: '08', septembre: '09', oct: '10', octobre: '10',
  novembre: '11', decembre: '12', décembre: '12',
};

function analyserDate(texte) {
  if (!texte) return null;
  let m = texte.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/\bdemain\b/i.test(texte)) {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  m = texte.match(/(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(\d{4}))?/i);
  if (m) {
    const annee = m[3] || String(new Date().getFullYear());
    return `${annee}-${MOIS_FR[m[2].toLowerCase()]}-${String(m[1]).padStart(2, '0')}`;
  }
  return null;
}

// --- Exécuteurs (utilisés par l'analyseur local ET par Cohere) -----------------------------------
function execAjouterContact(cabinetId, utilisateurId, p) {
  const res = trouverClient(cabinetId, p.entreprise);
  if (res.statut !== 'ok') return reponseClientIntrouvable(res);
  if (!p.prenom || !p.nom) return 'Il me manque le prénom et le nom du contact. Exemple : « ajoute le contact Marie Tremblay chez Acme ».';
  const r = bd.prepare(`
    INSERT INTO contacts (cabinet_id, client_id, prenom, nom, titre, courriel, telephone)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cabinetId, res.client.id, p.prenom, p.nom, p.titre || null, p.courriel || null, p.telephone || null);
  journal(cabinetId, utilisateurId, 'assistant_contact_ajoute',
    `Assistant : contact ${p.prenom} ${p.nom} ajouté à ${res.client.raison_sociale} (id ${r.lastInsertRowid})`);
  return `C'est fait : ${p.prenom} ${p.nom}${p.titre ? ' (' + p.titre + ')' : ''} ajouté aux contacts de ${res.client.raison_sociale}.`;
}

function execCreerTache(cabinetId, utilisateurId, p) {
  const res = trouverClient(cabinetId, p.entreprise);
  if (res.statut !== 'ok') return reponseClientIntrouvable(res);
  if (!p.titre || p.titre.trim().length < 2) return 'Il me manque le titre de la tâche. Exemple : « crée une tâche appeler le comptable pour Acme ».';
  const echeance = analyserDate(p.echeance || '');
  const r = bd.prepare(`
    INSERT INTO taches (cabinet_id, assigne_a, entreprise_id, titre, date_echeance, statut)
    VALUES (?, ?, ?, ?, ?, 'a_faire')
  `).run(cabinetId, utilisateurId, res.client.id, p.titre.trim(), echeance);
  journal(cabinetId, utilisateurId, 'assistant_tache_creee',
    `Assistant : tâche « ${p.titre.trim()} » pour ${res.client.raison_sociale} (id ${r.lastInsertRowid})`);
  return `Tâche créée pour ${res.client.raison_sociale} : « ${p.titre.trim()} »${echeance ? ', échéance le ' + echeance : ''}.`;
}

function execAjouterNote(cabinetId, utilisateurId, p) {
  const res = trouverClient(cabinetId, p.entreprise);
  if (res.statut !== 'ok') return reponseClientIntrouvable(res);
  if (!p.note || p.note.trim().length < 2) return 'Il me manque le contenu de la note.';
  const cli = bd.prepare('SELECT notes FROM clients WHERE id = ?').get(res.client.id);
  const nouvelles = ((cli.notes || '') + '\n[' + new Date().toISOString().slice(0, 10) + ' — assistant] ' + p.note.trim()).trim();
  bd.prepare('UPDATE clients SET notes = ? WHERE id = ?').run(nouvelles, res.client.id);
  journal(cabinetId, utilisateurId, 'assistant_note_ajoutee', `Assistant : note ajoutée à ${res.client.raison_sociale}`);
  return `Note ajoutée au dossier de ${res.client.raison_sociale}.`;
}

function execListerTaches(cabinetId, p) {
  const auj = new Date().toISOString().slice(0, 10);
  let lignes;
  if (p.filtre === 'retard') {
    lignes = bd.prepare(`
      SELECT t.titre, t.date_echeance, c.raison_sociale FROM taches t
      LEFT JOIN clients c ON c.id = t.entreprise_id
      WHERE t.cabinet_id = ? AND t.archive = 0 AND t.statut != 'terminee'
        AND t.date_echeance IS NOT NULL AND t.date_echeance < ?
      ORDER BY t.date_echeance LIMIT 20
    `).all(cabinetId, auj);
    if (!lignes.length) return 'Aucune tâche en retard. Beau travail.';
    return 'Tâches en retard :\n' + lignes.map((l) => `• ${l.titre} — ${l.raison_sociale || 'sans entreprise'} (échéance ${l.date_echeance})`).join('\n');
  }
  lignes = bd.prepare(`
    SELECT t.titre, t.date_echeance, c.raison_sociale FROM taches t
    LEFT JOIN clients c ON c.id = t.entreprise_id
    WHERE t.cabinet_id = ? AND t.archive = 0 AND t.statut != 'terminee'
    ORDER BY t.date_echeance LIMIT 20
  `).all(cabinetId);
  if (!lignes.length) return 'Aucune tâche en cours.';
  return 'Tâches en cours :\n' + lignes.map((l) => `• ${l.titre} — ${l.raison_sociale || 'sans entreprise'}${l.date_echeance ? ' (échéance ' + l.date_echeance + ')' : ''}`).join('\n');
}

function messageAide() {
  return `Voici ce que je peux faire pour l'instant :
• « ajoute le contact Marie Tremblay chez Acme, courriel marie@acme.ca, téléphone 514-555-1234, titre contrôleur »
• « crée une tâche appeler le comptable pour Acme pour le 2026-10-20 »
• « ajoute une note pour Acme : client rappelé, tout est beau »
• « liste les tâches en retard »
Écrivez ou utilisez le micro pour dicter. Dites « aide » pour revoir cette liste.`;
}

// --- Analyseur local (français) ------------------------------------------------------------------
function analyserLocal(texte) {
  const t = texte.trim();

  let m = t.match(/ajout(?:e|er)?\s+(?:le\s+|un\s+|une\s+)?contacts?\s+([a-zàâäéèêëîïôöùûüç'\- ]+?)\s+(?:chez|pour|à|de)\s+([^,;.]+?)([,;.]|$)/i);
  if (m) {
    const reste = t.slice(m.index + m[0].length);
    const mc = reste.match(/courriel\s*[: ]\s*(\S+@\S+)/i);
    const mt = reste.match(/t[ée]l[ée]phone\s*[: ]\s*([\d\s().+\-]{7,})/i);
    const mti = reste.match(/titre\s*[: ]\s*([^,;.]+)/i);
    const morceaux = m[1].trim().split(/\s+/);
    return {
      action: 'ajouter_contact',
      params: {
        prenom: morceaux[0], nom: morceaux.slice(1).join(' ') || '',
        entreprise: m[2].trim(),
        courriel: mc ? mc[1] : null,
        telephone: mt ? mt[1].trim() : null,
        titre: mti ? mti[1].trim() : null,
      },
    };
  }

  m = t.match(/(?:cr[ée]e(?:r)?\s+(?:une\s+)?t[âa]che|rappelle-?moi\s+de)\s+(.+?)\s+pour\s+([^,;.]+?)(?:\s+(?:pour\s+)?le\s+(.+?))?\s*$/i);
  if (m) {
    return {
      action: 'creer_tache',
      params: { titre: m[1].trim(), entreprise: m[2].trim(), echeance: (m[3] || '').trim() || null },
    };
  }

  m = t.match(/ajout(?:e|er)?\s+(?:une\s+)?note\s+(?:à|au|pour|chez)\s+([^:;]+?)\s*:\s*(.+)/i)
    || t.match(/note\s+(?:pour|chez)\s+([^:;]+?)\s*:\s*(.+)/i);
  if (m) {
    return { action: 'ajouter_note', params: { entreprise: m[1].trim(), note: m[2].trim() } };
  }

  if (/t[âa]ches?\s+en\s+retard/i.test(t) || /en\s+retard/i.test(t)) {
    return { action: 'lister_taches', params: { filtre: 'retard' } };
  }
  if (/mes\s+t[âa]ches/i.test(t) || /mes\s+[ée]ch[ée]ances/i.test(t) || /t[âa]ches?\s+[àa]\s+faire/i.test(t)) {
    return { action: 'lister_taches', params: { filtre: 'toutes' } };
  }
  if (/^\s*(aide|help|bonjour|salut|allo)\s*[!?.]?\s*$/i.test(t)) return { action: 'aide', params: {} };

  return null;
}

// --- Interprétation via Cohere (ou future IA québécoise) -----------------------------------------
async function interpreterCohere(texte) {
  const { appelerCohere } = require('./ia');
  const prompt = `Tu es un interpréteur de commandes pour une application de courtier d'assurance.
L'utilisateur écrit en français. Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte autour.
Commandes possibles :
- {"action":"ajouter_contact","params":{"entreprise":"NOM","prenom":"...","nom":"...","titre":"...","courriel":"...","telephone":"..."}}
- {"action":"creer_tache","params":{"entreprise":"NOM","titre":"...","echeance":"AAAA-MM-JJ ou null"}}
- {"action":"ajouter_note","params":{"entreprise":"NOM","note":"..."}}
- {"action":"lister_taches","params":{"filtre":"retard ou toutes"}}
- {"action":"aide","params":{}}
- {"action":"inconnue","params":{}}
Demande de l'utilisateur : """${texte.slice(0, 500)}"""`;
  try {
    const brut = await appelerCohere(prompt);
    const debut = brut.indexOf('{');
    const fin = brut.lastIndexOf('}');
    if (debut < 0 || fin < 0) return null;
    const cmd = JSON.parse(brut.slice(debut, fin + 1));
    if (!cmd || typeof cmd.action !== 'string') return null;
    if (!['ajouter_contact', 'creer_tache', 'ajouter_note', 'lister_taches', 'aide'].includes(cmd.action)) return null;
    return { action: cmd.action, params: cmd.params || {} };
  } catch (e) {
    return null;
  }
}

// --- Point d'entrée -----------------------------------------------------------------------------
function executer(cabinetId, utilisateurId, cmd) {
  try {
    switch (cmd.action) {
      case 'ajouter_contact': return execAjouterContact(cabinetId, utilisateurId, cmd.params);
      case 'creer_tache': return execCreerTache(cabinetId, utilisateurId, cmd.params);
      case 'ajouter_note': return execAjouterNote(cabinetId, utilisateurId, cmd.params);
      case 'lister_taches': return execListerTaches(cabinetId, cmd.params);
      case 'aide': return messageAide();
      default: return messageAide();
    }
  } catch (e) {
    return "Une erreur est survenue pendant l'exécution. Réessayez ou reformulez votre demande.";
  }
}

async function traiter(cabinetId, utilisateurId, texteBrut) {
  const texte = String(texteBrut || '').trim().slice(0, LONGUEUR_MAX);
  if (!texte) return 'Écrivez ou dictez votre demande.';
  bd.prepare(`
    INSERT INTO assistant_messages (cabinet_id, utilisateur_id, role, contenu)
    VALUES (?, ?, 'utilisateur', ?)
  `).run(cabinetId, utilisateurId, texte);

  let cmd = analyserLocal(texte);
  if (!cmd && moteurActif() === 'cohere') cmd = await interpreterCohere(texte);
  const reponse = cmd ? executer(cabinetId, utilisateurId, cmd) : messageAide();

  bd.prepare(`
    INSERT INTO assistant_messages (cabinet_id, utilisateur_id, role, contenu)
    VALUES (?, ?, 'assistant', ?)
  `).run(cabinetId, utilisateurId, reponse);
  return reponse;
}

function historique(cabinetId, limite = 50) {
  return bd.prepare(`
    SELECT role, contenu, cree_le FROM assistant_messages
    WHERE cabinet_id = ? ORDER BY id DESC LIMIT ?
  `).all(cabinetId, limite).reverse();
}

module.exports = { traiter, historique, moteurActif, messageAide };
