/**
 * lib/contexte-ia.js — Dictionnaire de champs exposé à l'IA (étape 4/10).
 *
 * L'IA « s'y retrouve » dans les données grâce à ce module : il transforme
 * lib/dictionnaire-champs.json en texte compact, prêt à être injecté dans
 * les prompts (Cohere ou futur moteur québécois).
 *
 * Aucune donnée client ici : uniquement des métadonnées (noms de tables,
 * de colonnes et descriptions). Le texte est volontairement compact pour
 * limiter la taille des prompts.
 */
const dico = require('./dictionnaire-champs.json');

const NOMS_USAGES = {
  soumission: 'soumission',
  gestion: 'gestion',
  les_deux: 'soumission+gestion',
  technique: 'technique',
};

/**
 * Retourne le dictionnaire en texte compact, par ex. :
 *   TABLE clients — Fiches entreprises clientes (…) [entreprises]
 *     raison_sociale (Raison sociale, TEXT, soumission+gestion) : Nom légal…
 */
function contexteDonnees({ usages = null } = {}) {
  // « les_deux » appartient aux deux familles métier (soumission et gestion),
  // mais jamais au filtre purement technique.
  const correspond = (u) => usages.includes(u)
    || (u === 'les_deux' && usages.some((x) => x === 'soumission' || x === 'gestion'));
  const lignes = [];
  lignes.push('MODÈLE DE DONNÉES — ' + dico.tables.length + ' tables.');
  lignes.push('RÈGLE D\'OR : rien ne se supprime jamais ; archivage (archive=1) et versions figées (police_versions, auto_soumission_versions, biens_soumission_versions, rc_soumission_versions, cyber_soumission_versions, eo_soumission_versions, do_soumission_versions, pe_soumission_versions, flotte_soumission_versions, caut_soumission_versions).');
  for (const t of dico.tables) {
    const domaine = (dico.domaines[t.domaine] || t.domaine);
    lignes.push('');
    lignes.push(`TABLE ${t.nom} [${domaine}] — ${t.description}${t.versionnage ? ' (VERSIONNÉE)' : ''}`);
    for (const c of t.colonnes) {
      if (usages && !correspond(c.usage)) continue;
      const rel = (c.relations && c.relations.length) ? ` → ${c.relations.join(', ')}` : '';
      const vals = c.valeurs ? ` [${c.valeurs.join('|')}]` : '';
      lignes.push(`  - ${c.nom} (${c.libelle}, ${c.type}, ${NOMS_USAGES[c.usage] || c.usage})${vals}${rel} : ${c.description}`);
    }
  }
  return lignes.join('\n');
}

/**
 * Version ultra-compacte : uniquement tables + descriptions (pour les
 * prompts courts).
 */
function contexteTables() {
  const lignes = ['TABLES :'];
  for (const t of dico.tables) {
    lignes.push(`- ${t.nom} [${dico.domaines[t.domaine] || t.domaine}] : ${t.description}`);
  }
  return lignes.join('\n');
}

module.exports = { contexteDonnees, contexteTables, dictionnaire: dico };
