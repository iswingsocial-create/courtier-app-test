/**
 * lib/proposition-combinee.js — Proposition combinée entreprise (demande de
 * prix) calquée sur le gabarit réel des envois : en-tête du cabinet →
 * demande de prix → renseignements généraux → sommaire de la police
 * antérieure et des réclamations → tableau des garanties consolidé
 * (Franchise / Règle proportionnelle / Montant / Taux / Prime — taux et
 * primes laissés vides : c'est une demande de prix) → une page par
 * emplacement → bénéficiaires → annexes conditionnelles (flottante,
 * umbrella) → signature.
 * Source unique pour la page HTML, l'aperçu et le PDF.
 */
const bd = require('./bd');
const combine = require('./combine');
const { libelleFormeJuridique, LIBELLES_REPARTITION_TYPES, LIBELLES_REPARTITION_GEO } = require('./combine');

const TIRET = '—';
function ech(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function val(v) {
  return v === null || v === undefined || v === '' ? TIRET : String(v);
}
function argent(v) {
  return v === null || v === undefined || v === '' ? TIRET : Number(v).toLocaleString('fr-CA') + ' $';
}
function ouiNon(v) {
  return v === null || v === undefined ? TIRET : (v ? 'Oui' : 'Non');
}
function dateFr(iso) {
  if (!iso) return TIRET;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}
function adresseComplete(l) {
  if (!l) return TIRET;
  const villeCp = [l.ville, l.province, l.code_postal].filter(Boolean).join(' ');
  return [l.adresse, villeCp].filter(Boolean).join(', ') || TIRET;
}

const NOMS_FORMULE_BIENS = { tous_risques: 'Tous risques', risques_designes: 'Risques désignés' };
const NOMS_FORMULE_RC = {
  locaux_operations: 'Locaux et opérations',
  produits_completes: 'Produits et opérations complétées',
  globale: 'Globale',
};
const NOMS_BASE_PE = { benefice_brut: 'Bénéfice brut', marge_brute: 'Marge brute', chiffre_affaires: 'Chiffre d\u2019affaires' };
const NOMS_FORMULE_PE = {
  pertes_loyers: 'Pertes de loyers', benefice_brut: 'Bénéfice brut', formule_etendue: 'Formule étendue',
};
const LIBELLES_CLASSE_CONSTRUCTION = Object.fromEntries(combine.CLASSES_CONSTRUCTION);

// --- Assemblage des données -------------------------------------------------------
function preparerPropositionCombinee(cabinetId, dossier) {
  const cabinet = bd.prepare('SELECT * FROM cabinets WHERE id = ?').get(cabinetId) || {};
  const client = dossier.client || {};
  const sB = dossier.soumissions.biens || null;
  const sRC = dossier.soumissions.rc || null;
  const sPE = dossier.soumissions.perte_exploitation || null;

  const bloc = dossier.antecedents_bloc || null;
  const antecedents = bloc || (sB ? sB.antecedents : null) || {};
  const sinistres = (bloc && bloc.sinistres_5ans) || (sB && sB.antecedents && sB.antecedents.sinistres_5ans) || [];
  const interruptions = (bloc && bloc.interruptions_5ans) || [];

  const batiments = sB ? sB.batiments.filter((b) => !b.archive) : [];
  const peParBatiment = {};
  if (sPE) for (const e of sPE.etablissements.filter((x) => !x.archive)) {
    if (e.batiment_id) peParBatiment[e.batiment_id] = e;
  }
  const rcParBatiment = {};
  if (sRC) for (const e of sRC.exploitations.filter((x) => !x.archive)) {
    if (e.batiment_id) rcParBatiment[e.batiment_id] = e;
  }

  const emplacements = batiments.map((b) => ({
    batiment: b,
    contenus: (b.contenus || []).filter((c) => !c.archive),
    garanties: b.garanties || null,
    alarme: combine.obtenirAlarme(b.id, cabinetId),
    beneficiaires: combine.listerBeneficiaires(b.id, cabinetId),
    pe: peParBatiment[b.id] || null,
    rc: rcParBatiment[b.id] || null,
  }));

  const flottante = sB ? combine.listerArticlesFlottante(sB.id, cabinetId) : [];
  const flottanteTotal = flottante.reduce((n, a) => n + (a.montant || 0), 0);

  const umbrellaPresente = emplacements.some((e) => e.rc && e.rc.garanties
    && (e.rc.garanties.umbrella_montant || e.rc.garanties.umbrella_retention));

  const reponsesMap = {};
  for (const r of combine.obtenirReponsesSectorielles(client.id, cabinetId)) {
    if (r.reponse) reponsesMap[r.code_question] = r.reponse;
  }
  const questions = combine.QUESTIONS_SECTORIELLES
    .filter((q) => reponsesMap[q.code])
    .map((q) => ({ ...q, reponse: reponsesMap[q.code] }));

  const placement = dossier.courtier_placement_id
    ? bd.prepare('SELECT nom FROM users WHERE id = ?').get(dossier.courtier_placement_id) : null;

  return {
    dossierId: dossier.id,
    dateGeneration: new Date().toISOString().slice(0, 10),
    cabinet,
    cabinetNom: cabinet.nom || 'Cabinet',
    client: {
      ...client,
      repartition_revenus_types: combine.jsonOut(client.repartition_revenus_types),
      repartition_revenus_geo: combine.jsonOut(client.repartition_revenus_geo),
      formeLibelle: libelleFormeJuridique(client.forme_juridique),
    },
    dossier,
    placementNom: placement ? placement.nom : null,
    antecedents,
    sinistres: Array.isArray(sinistres) ? sinistres : [],
    interruptions: Array.isArray(interruptions) ? interruptions : [],
    emplacements,
    contenusGeneraux: sB ? (sB.contenus_generaux || []) : [],
    garantiesPE: sPE ? sPE.garanties : null,
    etablissementsPE: sPE ? sPE.etablissements.filter((e) => !e.archive) : [],
    exploitationsRCOrphelines: sRC
      ? sRC.exploitations.filter((e) => !e.archive && !e.batiment_id) : [],
    flottante,
    flottanteTotal,
    umbrellaPresente,
    questions,
    assures: [
      ...combine.listerAssuresAdditionnels('combine', dossier.id, cabinetId),
      ...(sB ? combine.listerAssuresAdditionnels('biens', sB.id, cabinetId) : []),
    ],
  };
}

// --- Lignes du tableau des garanties ------------------------------------------------
function lignesTableauGaranties(d) {
  const lignes = [];
  const L = (garantie, franchise, regle, montant) => lignes.push({ garantie, franchise, regle, montant });
  d.emplacements.forEach((e, i) => {
    const lieu = `Emplacement ${i + 1} — ${e.batiment.adresse}`;
    const g = e.garanties;
    if (g) {
      L(`${lieu} · Bâtiment (${val(NOMS_FORMULE_BIENS[g.formule] || g.formule)})`,
        g.franchise, g.regle_proportionnelle, g.montant_assurance);
      const totalContenus = e.contenus.reduce((n, c) => n + (c.valeur || 0), 0);
      if (e.contenus.length) {
        L(`${lieu} · Contenu`, g.franchise_contenu, g.regle_proportionnelle_contenu, totalContenus || null);
      }
      for (const [code, libelle] of combine.AVENANTS_BIENS_ENRICHIS) {
        const av = g.avenants ? g.avenants[code] : null;
        if (!combine.avenantActif(av)) continue;
        const det = av && typeof av === 'object' ? av : {};
        let suffixe = '';
        if (code === 'tremblement_terre' && det.franchise_pct != null) {
          suffixe = ` — franchise ${det.franchise_pct} % (min. ${argent(det.franchise_min)})`;
        }
        if (code === 'bris_equipement' && det.montant_par_accident != null) {
          suffixe = ` — montant par accident ${argent(det.montant_par_accident)}`;
        }
        L(`${lieu} · ${libelle}${suffixe}`, det.franchise, null, det.montant);
      }
    }
    const grc = e.rc && e.rc.garanties;
    if (grc) {
      const base = `${lieu} · RC (${val(NOMS_FORMULE_RC[grc.formule] || grc.formule)})`;
      L(`${base} — par sinistre`, grc.franchise, null, grc.limite_par_sinistre);
      if (grc.limite_agregat) L(`${base} — agrégat`, null, null, grc.limite_agregat);
      if (grc.prejudice_personnel_publicite) L(`${lieu} · Préjudice personnel et publicité`, null, null, grc.prejudice_personnel_publicite);
      if (grc.frais_medicaux_par_personne || grc.frais_medicaux_par_sinistre) {
        L(`${lieu} · Frais médicaux — par personne`, null, null, grc.frais_medicaux_par_personne);
        L(`${lieu} · Frais médicaux — par sinistre`, null, null, grc.frais_medicaux_par_sinistre);
      }
      if (grc.responsabilite_locative) L(`${lieu} · Responsabilité locative`, null, null, grc.responsabilite_locative);
      if (grc.rc_auto_non_proprietaires) L(`${lieu} · RC automobiles non-propriétaires`, null, null, grc.rc_auto_non_proprietaires);
      if (grc.produits_travaux_termines_montant) L(`${lieu} · Produits et travaux terminés`, null, null, grc.produits_travaux_termines_montant);
      if (grc.pollution_montant) L(`${lieu} · Pollution`, null, null, grc.pollution_montant);
    }
  });
  const totalGen = d.contenusGeneraux.reduce((n, c) => n + (c.valeur || 0), 0);
  if (d.contenusGeneraux.length) L('Contenus — ensemble des lieux', null, null, totalGen || null);
  const gpe = d.garantiesPE;
  if (gpe) {
    L(`Perte d\u2019exploitation (${val(NOMS_FORMULE_PE[gpe.formule] || NOMS_BASE_PE[gpe.base_montant])}, `
      + `période ${val(gpe.periode_indemnite_mois)} mois, franchise ${val(gpe.franchise_jours)} jours)`,
      null, gpe.regle_proportionnelle, gpe.limite);
    if (gpe.honoraires_comptables) L('Honoraires de comptables', null, null, gpe.honoraires_comptables);
  }
  if (d.flottante.length) L('Assurance flottante des outils (voir l\u2019annexe)', null, null, d.flottanteTotal || null);
  return lignes;
}

// --- Rendu HTML ----------------------------------------------------------------------
function rendreHtmlPropositionCombinee(d) {
  const c = d.client;
  const dos = d.dossier;
  const ent = d.cabinet;
  const h = [];
  const ligne = (libelle, valeur) => `<tr><th>${ech(libelle)}</th><td>${ech(val(valeur))}</td></tr>`;
  const ligneArgent = (libelle, valeur) => `<tr><th>${ech(libelle)}</th><td>${ech(argent(valeur))}</td></tr>`;

  h.push(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Demande de prix — Assurance combinée — ${ech(c.raison_sociale || '')}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 28px; font-size: 13px; }
  h1 { font-size: 19px; margin: 4px 0; } h2 { font-size: 15px; border-bottom: 2px solid #1e3a5f; color: #1e3a5f; padding-bottom: 3px; margin: 22px 0 8px; }
  h3 { font-size: 13.5px; color: #1e3a5f; margin: 14px 0 6px; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0 12px; }
  th, td { border: 1px solid #bbb; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #eef2f7; width: 34%; font-weight: 600; }
  td.num, th.num { text-align: right; }
  .entete { display: flex; justify-content: space-between; border-bottom: 3px solid #1e3a5f; padding-bottom: 8px; }
  .entete .cab { font-size: 15px; font-weight: 700; color: #1e3a5f; }
  .petit { color: #555; font-size: 11.5px; }
  .page { page-break-before: always; }
  .signature { margin-top: 34px; display: flex; gap: 60px; }
  .signature div { border-top: 1px solid #111; padding-top: 4px; min-width: 220px; }
  @media print { body { margin: 10mm; } }
</style></head><body>`);

  // En-tête + demande de prix
  h.push(`<div class="entete"><div>
    <div class="cab">${ech(d.cabinetNom)}</div>
    <div class="petit">${ech([ent.adresse, ent.ville, ent.code_postal].filter(Boolean).join(', '))}<br>
    ${ent.telephone ? 'Tél. : ' + ech(ent.telephone) : ''}${ent.telecopieur ? ' · Téléc. : ' + ech(ent.telecopieur) : ''}<br>
    ${ech(ent.courriel || '')}${ent.site_web ? ' · ' + ech(ent.site_web) : ''}</div>
  </div><div class="petit" style="text-align:right">Demande de prix<br>${ech(dateFr(d.dateGeneration))}</div></div>`);

  h.push(`<h1>DEMANDE DE SOUMISSION — ASSURANCE COMBINÉE</h1>
  <p><strong>Assuré :</strong> ${ech(val(c.raison_sociale))}<br>
  <strong>Date d\u2019effet demandée :</strong> ${ech(dateFr(dos.date_effet))} &nbsp;·&nbsp;
  <strong>Date d\u2019échéance :</strong> ${ech(dateFr(dos.date_echeance))} &nbsp;·&nbsp;
  <strong>Plan de paiement :</strong> ${ech(val(dos.plan_paiement))}<br>
  ${dos.code_courtier_assureur ? '<strong>Code du courtier :</strong> ' + ech(dos.code_courtier_assureur) + '<br>' : ''}
  <span class="petit">Nous vous demandons vos meilleurs prix pour les garanties décrites ci-après (biens, contenu, responsabilité civile et perte d\u2019exploitation). Les colonnes Taux et Prime sont à compléter par l\u2019assureur.</span></p>`);

  // Renseignements généraux
  h.push('<h2>RENSEIGNEMENTS GÉNÉRAUX</h2><table>');
  h.push(ligne('Dénomination sociale complète', c.raison_sociale));
  h.push(ligne('Adresse postale', adresseComplete(c)));
  h.push(ligne('NEQ', c.neq));
  h.push(ligne('Forme juridique', c.formeLibelle));
  h.push(ligne('Année de fondation', c.annee_fondation));
  h.push(ligne('Années d\u2019expérience dans un domaine lié', c.annees_experience_liee));
  h.push(ligne('Nom(s) sous lequel (lesquels) l\u2019assuré fait affaire', c.noms_exploitation));
  h.push(ligne('Description des activités', c.description_activites));
  h.push(ligne('Secteur d\u2019activité', c.secteur_activite));
  h.push(ligne('Code d\u2019industrie', c.code_industrie));
  h.push(ligne('Description du code d\u2019industrie', c.code_industrie_description));
  h.push(ligne('% des revenus du code d\u2019industrie principal',
    c.code_industrie_pct_revenus != null ? c.code_industrie_pct_revenus + ' %' : null));
  h.push('</table>');

  const repT = Object.entries(c.repartition_revenus_types || {}).filter(([, x]) => x != null && x !== '');
  if (repT.length) {
    h.push('<h3>Répartition des recettes par type d\u2019activité</h3><table>');
    for (const [cle, pct] of repT) h.push(ligne(LIBELLES_REPARTITION_TYPES[cle] || cle, pct + ' %'));
    h.push('</table>');
  }
  const repG = Object.entries(c.repartition_revenus_geo || {}).filter(([, x]) => x != null && x !== '');
  if (repG.length) {
    h.push('<h3>Répartition géographique des recettes</h3><table>');
    for (const [cle, pct] of repG) h.push(ligne(LIBELLES_REPARTITION_GEO[cle] || cle, pct + ' %'));
    h.push('</table>');
  }
  h.push('<table>');
  h.push(ligne('Nombre d\u2019employés — temps plein', c.nb_employes_temps_plein));
  h.push(ligne('Nombre d\u2019employés — temps partiel', c.nb_employes_temps_partiel));
  h.push(ligne('Employés couverts par la CSST', ouiNon(c.employes_csst)));
  h.push(ligneArgent('Masse salariale', c.masse_salariale));
  h.push(ligne('Responsabilité pour l\u2019alcool', ouiNon(c.responsabilite_alcool)));
  h.push(ligne('% de sous-traitance', c.pct_sous_traitance != null ? c.pct_sous_traitance + ' %' : null));
  h.push('</table>');

  if (d.questions.length) {
    h.push('<h3>Questions additionnelles</h3><table>');
    for (const q of d.questions) h.push(ligne(q.question, q.reponse));
    h.push('</table>');
  }

  // Sommaire police antérieure et réclamations
  const a = d.antecedents || {};
  h.push('<h2>SOMMAIRE — POLICE ANTÉRIEURE ET RÉCLAMATIONS</h2><table>');
  h.push(ligne('Assureur actuel', a.assureur_actuel));
  h.push(ligne('N° de police actuelle', a.numero_police_actuelle));
  h.push(ligne('Expiration', dateFr(a.date_expiration_actuelle)));
  h.push(ligne('Années d\u2019assurance continue', a.annees_assurance_continue));
  h.push(ligne('Type de police précédente', a.type_police_precedente));
  h.push(ligne('Date d\u2019effet de la police précédente', dateFr(a.date_effet_precedente)));
  h.push(ligneArgent('Prime de la police précédente', a.prime_precedente));
  h.push(ligne('Refus, résiliation ou non-renouvellement (5 ans)', ouiNon(a.refus_resiliation_nonrenouvellement)));
  if (a.refus_explication) h.push(ligne('Refus — explication', a.refus_explication));
  h.push(ligne('Faillite ou jugement contre l\u2019assuré', ouiNon(a.faillite_jugement)));
  if (a.faillite_explication) h.push(ligne('Faillite ou jugement — explication', a.faillite_explication));
  h.push(ligne('Condamnation — infraction impliquant la malhonnêteté', ouiNon(a.condamnation_honnetete)));
  if (a.condamnation_explication) h.push(ligne('Condamnation — explication', a.condamnation_explication));
  h.push('</table>');

  h.push('<h3>Réclamations des 5 dernières années</h3>');
  if (d.sinistres.length) {
    h.push('<table><tr><th>Date</th><th>Type</th><th>Description</th><th class="num">Montant</th><th class="num">Payé</th><th class="num">Réserve</th><th>Statut</th></tr>');
    for (const s of d.sinistres) {
      h.push(`<tr><td>${ech(dateFr(s.date))}</td><td>${ech(val(s.type))}</td><td>${ech(val(s.description))}</td>`
        + `<td class="num">${ech(argent(s.montant))}</td><td class="num">${ech(argent(s.montant_paye))}</td>`
        + `<td class="num">${ech(argent(s.reserve))}</td><td>${ech(val(s.statut))}</td></tr>`);
    }
    h.push('</table>');
  } else {
    h.push('<p>Aucunes</p>');
  }
  if (d.interruptions.length) {
    h.push('<h3>Interruptions d\u2019exploitation des 5 dernières années</h3><table>');
    h.push('<tr><th>Date</th><th>Cause</th><th>Durée (jours)</th><th class="num">Montant</th></tr>');
    for (const s of d.interruptions) {
      h.push(`<tr><td>${ech(dateFr(s.date))}</td><td>${ech(val(s.cause))}</td><td>${ech(val(s.duree_jours))}</td><td class="num">${ech(argent(s.montant))}</td></tr>`);
    }
    h.push('</table>');
  }

  // Tableau des garanties consolidé
  h.push('<h2>TABLEAU DES GARANTIES</h2>');
  h.push('<table><tr><th>Garantie</th><th class="num">Franchise</th><th class="num">Règle prop. (%)</th><th class="num">Montant</th><th class="num">Taux</th><th class="num">Prime</th></tr>');
  for (const l of lignesTableauGaranties(d)) {
    h.push(`<tr><td>${ech(l.garantie)}</td><td class="num">${ech(l.franchise != null ? argent(l.franchise) : TIRET)}</td>`
      + `<td class="num">${ech(l.regle != null ? l.regle + ' %' : TIRET)}</td>`
      + `<td class="num">${ech(argent(l.montant))}</td><td class="num"></td><td class="num"></td></tr>`);
  }
  h.push('</table>');

  // Pages par emplacement
  d.emplacements.forEach((e, i) => {
    const b = e.batiment;
    h.push(`<div class="${i === 0 ? '' : 'page'}"><h2>EMPLACEMENT ${i + 1} — ${ech(b.adresse)}${b.ville ? ', ' + ech(b.ville) : ''}</h2>`);
    h.push('<table>');
    h.push(ligne('Adresse complète', adresseComplete(b)));
    h.push(ligne('Affectation / activités à cet endroit', b.type_activite));
    h.push(ligne('Type d\u2019emplacement', b.type_emplacement));
    h.push(ligne('Intérêt de l\u2019assuré', b.interet_assure));
    h.push(ligne('Superficie occupée (pi²)', b.superficie_occupee_pi2));
    h.push(ligne('% des lieux vacant', b.pct_vacant != null ? b.pct_vacant + ' %' : null));
    h.push(ligne('Lieux partagés avec des tiers', ouiNon(b.partage_lieux)));
    h.push(ligne('Autres occupants de l\u2019immeuble', b.autres_occupants));
    h.push(ligne('Année de construction', b.annee_construction));
    h.push(ligne('Nombre d\u2019étages', b.nombre_etages));
    h.push('</table>');

    h.push('<h3>Construction</h3><table>');
    h.push(ligne('Classe de construction (assureur)', LIBELLES_CLASSE_CONSTRUCTION[b.classe_construction] || b.classe_construction));
    h.push(ligne('Murs extérieurs', b.construction_mur));
    h.push(ligne('Structure du toit', b.construction_toit_structure));
    h.push(ligne('Finition du toit', b.finition_toit));
    h.push(ligne('Matériau des sols', b.materiau_sol));
    h.push(ligne('Sous-sol', b.sous_sol));
    h.push(ligne('Type d\u2019électricité', b.electricite_type));
    h.push(ligne('Matériau de la plomberie', b.plomberie_materiau));
    h.push(ligne('Type de carburant (chauffage)', b.carburant));
    h.push('</table>');

    h.push('<h3>Rénovations</h3><table>');
    for (const [libelle, anneeK, ampleurK] of [
      ['Toiture', 'annee_toiture', 'renovation_toiture_ampleur'],
      ['Électricité', 'renovation_electricite_annee', 'renovation_electricite_ampleur'],
      ['Plomberie', 'renovation_plomberie_annee', 'renovation_plomberie_ampleur'],
      ['Chauffage', 'renovation_chauffage_annee', 'renovation_chauffage_ampleur'],
    ]) {
      h.push(ligne(libelle, [b[anneeK], b[ampleurK]].filter(Boolean).join(' — ') || null));
    }
    h.push('</table>');

    h.push('<h3>Protection incendie</h3><table>');
    h.push(ligne('Prise d\u2019eau', b.prise_eau_distance));
    h.push(ligne('Caserne de pompiers', b.caserne_type));
    h.push(ligne('Distance de la caserne (km)', b.caserne_distance_km));
    h.push(ligne('Gicleurs', ouiNon(b.gicleurs)));
    h.push(ligne('Couverture des gicleurs', b.gicleurs_couverture));
    h.push(ligne('Alarme incendie', b.alarme_incendie_type));
    h.push(ligne('Colonne montante', ouiNon(b.colonne_montante)));
    h.push(ligne('Extincteurs', [b.extincteurs_categorie, b.extincteurs_agent,
      b.extincteurs_pct_couvert != null ? b.extincteurs_pct_couvert + ' % des lieux' : null].filter(Boolean).join(' — ') || null));
    h.push('</table>');

    h.push('<h3>Risques criminels</h3><table>');
    h.push(ligne('Alarme antivol', b.alarme_vol_type));
    h.push(ligne('Pêne dormant', ouiNon(b.pene_dormant)));
    h.push(ligne('Fenêtres grillagées', ouiNon(b.fenetres_grillagees)));
    h.push(ligne('Glaces incassables', ouiNon(b.glaces_incassables)));
    h.push(ligne('Caméras', ouiNon(b.cameras)));
    h.push(ligne('Coffre-fort', [b.coffre_type, b.coffre_categorie].filter(Boolean).join(' — ') || null));
    h.push(ligne('Autres protections', b.autres_protections_criminelles));
    h.push('</table>');

    h.push('<h3>Voisinage</h3><table>');
    for (const [libelle, affK, distK] of [
      ['À gauche', 'voisin_gauche_affectation', 'voisin_gauche_distance_m'],
      ['À droite', 'voisin_droite_affectation', 'voisin_droite_distance_m'],
      ['À l\u2019arrière', 'voisin_arriere_affectation', 'voisin_arriere_distance_m'],
      ['En face', 'voisin_enface_affectation', 'voisin_enface_distance_m'],
    ]) {
      h.push(ligne(libelle, [b[affK], b[distK] != null ? b[distK] + ' m' : null].filter(Boolean).join(' — ') || null));
    }
    if (b.aucun_risque_alentours) h.push(ligne('Risques alentours', 'Aucun risque alentours'));
    h.push('</table>');

    const al = e.alarme;
    if (al) {
      h.push('<h3>Questionnaire alarme (sommaire)</h3><table>');
      h.push(ligne('Compagnie d\u2019alarme', al.compagnie_alarme));
      h.push(ligne('Centrale de surveillance', al.centrale_nom_lieu));
      h.push(ligne('Transmission primaire', (al.transmission_primaire || []).join(', ') || null));
      h.push(ligne('Transmission secondaire', (al.transmission_secondaire || []).join(', ') || null));
      h.push(ligne('Certificat ULC', al.certificat_ulc_actif
        ? `Actif — n° ${val(al.certificat_ulc_numero)}, expire le ${dateFr(al.certificat_ulc_expiration)}` : 'Non'));
      h.push(ligne('Contrat annuel d\u2019entretien', ouiNon(al.contrat_entretien_annuel)));
      h.push('</table>');
    }

    if (e.contenus.length) {
      h.push('<h3>Contenus de cet emplacement</h3><table><tr><th>Description</th><th class="num">Valeur</th></tr>');
      for (const ct of e.contenus) {
        h.push(`<tr><td>${ech(val(ct.description))}</td><td class="num">${ech(argent(ct.valeur))}</td></tr>`);
      }
      h.push('</table>');
    }
    if (e.pe) {
      h.push(`<p><strong>Perte d\u2019exploitation à cet emplacement :</strong> montant ${ech(argent(e.pe.montant_pe))} · chiffre d\u2019affaires du lieu ${ech(argent(e.pe.chiffre_affaires))}</p>`);
    }
    if (e.rc && e.rc.garanties && e.rc.garanties.responsabilite_locative) {
      h.push(`<p><strong>Responsabilité locative à cet emplacement :</strong> ${ech(argent(e.rc.garanties.responsabilite_locative))}</p>`);
    }
    if (e.beneficiaires.length) {
      h.push('<h3>Bénéficiaires de cet emplacement</h3><table><tr><th>Nom</th><th>Adresse</th><th>Qualité</th><th>Préavis</th></tr>');
      for (const ben of e.beneficiaires) {
        h.push(`<tr><td>${ech(ben.nom)}</td><td>${ech(adresseComplete(ben))}</td><td>${ech(val(ben.qualite))}</td><td>${ech(val(ben.clause_preavis))}</td></tr>`);
      }
      h.push('</table>');
    }
    h.push('</div>');
  });

  if (d.contenusGeneraux.length) {
    h.push('<h2>CONTENUS — ENSEMBLE DES LIEUX</h2><table><tr><th>Description</th><th class="num">Valeur</th></tr>');
    for (const ct of d.contenusGeneraux) {
      h.push(`<tr><td>${ech(val(ct.description))}</td><td class="num">${ech(argent(ct.valeur))}</td></tr>`);
    }
    h.push('</table>');
  }
  for (const e of d.exploitationsRCOrphelines) {
    h.push(`<h2>LIEU RC — ${ech(e.adresse || '')}</h2><p>Activités : ${ech(val(e.description_activites || e.type_activite))} · Chiffre d\u2019affaires : ${ech(argent(e.chiffre_affaires))}</p>`);
  }

  // Bénéficiaires (sommaire global)
  const tousBeneficiaires = d.emplacements.flatMap((e, i) => e.beneficiaires.map((ben) => ({ ben, lieu: e.batiment.adresse })));
  if (tousBeneficiaires.length) {
    h.push('<h2>BÉNÉFICIAIRES</h2><table><tr><th>Emplacement</th><th>Nom</th><th>Adresse</th><th>Qualité</th><th>Préavis de résiliation</th></tr>');
    for (const { ben, lieu } of tousBeneficiaires) {
      h.push(`<tr><td>${ech(lieu)}</td><td>${ech(ben.nom)}</td><td>${ech(adresseComplete(ben))}</td><td>${ech(val(ben.qualite))}</td><td>${ech(val(ben.clause_preavis))}</td></tr>`);
    }
    h.push('</table>');
  }

  if (d.assures.length) {
    h.push('<h2>ASSURÉS ADDITIONNELS</h2><table><tr><th>Nom</th><th>Adresse</th><th>Intérêt assurable</th></tr>');
    for (const aa of d.assures) {
      h.push(`<tr><td>${ech(aa.nom)}</td><td>${ech(adresseComplete(aa))}</td><td>${ech(val(aa.interet))}</td></tr>`);
    }
    h.push('</table>');
  }

  // Annexes conditionnelles
  if (d.flottante.length) {
    h.push('<div class="page"><h2>ANNEXE — ASSURANCE FLOTTANTE DES OUTILS</h2>');
    h.push('<table><tr><th>Description</th><th>Base de règlement</th><th>Assuré additionnel</th><th class="num">Montant</th></tr>');
    for (const art of d.flottante) {
      h.push(`<tr><td>${ech(art.description)}</td><td>${ech(val(art.base_reglement))}</td><td>${ech(val(art.assure_additionnel))}</td><td class="num">${ech(argent(art.montant))}</td></tr>`);
    }
    h.push(`<tr><th colspan="3">Total</th><td class="num"><strong>${ech(argent(d.flottanteTotal))}</strong></td></tr></table></div>`);
  }
  if (d.umbrellaPresente) {
    h.push('<div class="page"><h2>ANNEXE — POLICE UMBRELLA</h2><table>');
    h.push('<tr><th>Emplacement / lieu</th><th class="num">Montant umbrella</th><th class="num">Rétention</th><th>Polices de base</th></tr>');
    for (const e of d.emplacements) {
      const grc = e.rc && e.rc.garanties;
      if (!grc || (!grc.umbrella_montant && !grc.umbrella_retention)) continue;
      h.push(`<tr><td>${ech(e.batiment.adresse)}</td><td class="num">${ech(argent(grc.umbrella_montant))}</td>`
        + `<td class="num">${ech(argent(grc.umbrella_retention))}</td>`
        + `<td>${ech((grc.umbrella_polices_base || []).join(', ') || TIRET)}</td></tr>`);
    }
    h.push('</table></div>');
  }

  if (dos.circonstances_speciales) {
    h.push(`<h2>CIRCONSTANCES SPÉCIALES</h2><p>${ech(dos.circonstances_speciales)}</p>`);
  }
  if (dos.remarques_diverses) {
    h.push(`<h2>REMARQUES DIVERSES</h2><p>${ech(dos.remarques_diverses)}</p>`);
  }

  h.push(`<div class="signature">
    <div>${ech(val(dos.signataire_nom))}<br><span class="petit">${ech(val(dos.signataire_titre))} — Signature</span></div>
    <div>${ech(dateFr(dos.date_signature))}<br><span class="petit">Date</span></div>
    ${d.placementNom ? `<div>${ech(d.placementNom)}<br><span class="petit">Courtier de placement</span></div>` : ''}
  </div>
  <p class="petit" style="margin-top:26px">Document généré le ${ech(dateFr(d.dateGeneration))} par ${ech(d.cabinetNom)} — dossier combiné n° ${d.dossierId}. Demande de prix : les taux et primes sont à compléter par l\u2019assureur.</p>
  </body></html>`);
  return h.join('\n');
}

// Texte du courriel « demande de prix » (brouillon — envoi au clic seulement).
function texteBrouillonDemandePrix(d) {
  const c = d.client;
  const sujet = `Demande de prix — Assurance combinée — ${c.raison_sociale || ''} — effet le ${dateFr(d.dossier.date_effet)}`;
  const lignes = [
    'Bonjour,',
    '',
    `Nous vous prions de nous soumettre vos meilleurs prix pour l'assurance combinée (biens, contenu, responsabilité civile et perte d'exploitation) de :`,
    '',
    `${val(c.raison_sociale)} — ${adresseComplete(c)}`,
    `Activités : ${val(c.description_activites)}`,
    `Date d'effet demandée : ${dateFr(d.dossier.date_effet)} — Échéance : ${dateFr(d.dossier.date_echeance)} — Plan de paiement : ${val(d.dossier.plan_paiement)}`,
    `Emplacements assurés : ${d.emplacements.length}`,
    '',
    'La proposition combinée complète (renseignements généraux, sommaire de la police antérieure et des réclamations, tableau des garanties, détail par emplacement et annexes) est jointe en format PDF.',
    '',
    'Merci de nous faire parvenir vos taux et primes dans les colonnes prévues du tableau des garanties.',
    '',
    `Cordialement,`,
    `${val(d.dossier.signataire_nom) || ''}`,
    `${d.cabinetNom}`,
  ];
  return { sujet, contenu: lignes.join('\n') };
}

module.exports = {
  preparerPropositionCombinee, rendreHtmlPropositionCombinee, lignesTableauGaranties,
  texteBrouillonDemandePrix, ech, val, argent, ouiNon, dateFr, adresseComplete,
  NOMS_FORMULE_BIENS, NOMS_FORMULE_RC, NOMS_FORMULE_PE, LIBELLES_CLASSE_CONSTRUCTION,
};
