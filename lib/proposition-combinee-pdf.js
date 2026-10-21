/**
 * lib/proposition-combinee-pdf.js — PDF de la proposition combinée
 * (demande de prix), même gabarit que la version HTML
 * (lib/proposition-combinee.js, source unique des données préparées).
 * pdfkit pur JS ; PDF non compressé (texte lisible dans le flux).
 */
const PDFDocument = require('pdfkit');
const {
  val, argent, ouiNon, dateFr, adresseComplete,
  lignesTableauGaranties, NOMS_FORMULE_BIENS, LIBELLES_CLASSE_CONSTRUCTION,
} = require('./proposition-combinee');
const combine = require('./combine');

const NOIR = '#111111';
const GRIS = '#555555';
const BLEU = '#1e3a5f';

function genererPropositionCombineePdf(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 48, bottom: 56, left: 52, right: 52 },
      compress: false,
      info: {
        Title: `Demande de prix — Assurance combinée — ${d.client.raison_sociale || ''}`,
        Author: d.cabinetNom,
        Subject: 'Soumission combinée entreprise (Québec)',
      },
    });
    const morceaux = [];
    doc.on('data', (c) => morceaux.push(c));
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);

    const G = doc.page.margins.left;
    const LARG = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const titre = (t) => {
      doc.moveDown(0.9).fillColor(BLEU).font('Helvetica-Bold').fontSize(13).text(t, G);
      doc.moveTo(G, doc.y + 2).lineTo(G + LARG, doc.y + 2).strokeColor(BLEU).lineWidth(1.2).stroke();
      doc.moveDown(0.35).fillColor(NOIR).font('Helvetica').fontSize(10);
    };
    const champ = (libelle, valeur) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR)
        .text(`${libelle} : `, G, doc.y, { continued: true })
        .font('Helvetica').text(val(valeur));
    };
    const champArgent = (libelle, valeur) => champ(libelle, argent(valeur));

    // En-tête du cabinet
    const ent = d.cabinet;
    doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(15).text(d.cabinetNom, G);
    doc.fillColor(GRIS).font('Helvetica').fontSize(9)
      .text([ent.adresse, ent.ville, ent.code_postal].filter(Boolean).join(', '))
      .text([ent.telephone ? 'Tél. : ' + ent.telephone : '', ent.telecopieur ? 'Téléc. : ' + ent.telecopieur : '']
        .filter(Boolean).join(' · '))
      .text([ent.courriel, ent.site_web].filter(Boolean).join(' · '));
    doc.moveTo(G, doc.y + 4).lineTo(G + LARG, doc.y + 4).strokeColor(BLEU).lineWidth(1.6).stroke();
    doc.fillColor(NOIR);

    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(16)
      .text('DEMANDE DE SOUMISSION — ASSURANCE COMBINÉE');
    doc.font('Helvetica').fontSize(10);
    champ('Assuré', d.client.raison_sociale);
    champ('Date d\u2019effet demandée', dateFr(d.dossier.date_effet));
    champ('Date d\u2019échéance', dateFr(d.dossier.date_echeance));
    champ('Plan de paiement', d.dossier.plan_paiement);
    if (d.dossier.code_courtier_assureur) champ('Code du courtier', d.dossier.code_courtier_assureur);
    doc.fontSize(9).fillColor(GRIS).text('Nous vous demandons vos meilleurs prix pour les garanties décrites ci-après (biens, contenu, responsabilité civile et perte d\u2019exploitation). Les colonnes Taux et Prime sont à compléter par l\u2019assureur.');
    doc.fillColor(NOIR).fontSize(10);

    // Renseignements généraux
    const c = d.client;
    titre('RENSEIGNEMENTS GÉNÉRAUX');
    champ('Dénomination sociale complète', c.raison_sociale);
    champ('Adresse postale', adresseComplete(c));
    champ('NEQ', c.neq);
    champ('Forme juridique', c.formeLibelle);
    champ('Année de fondation', c.annee_fondation);
    champ('Années d\u2019expérience dans un domaine lié', c.annees_experience_liee);
    champ('Nom(s) d\u2019exploitation', c.noms_exploitation);
    champ('Description des activités', c.description_activites);
    champ('Code d\u2019industrie', [c.code_industrie, c.code_industrie_description].filter(Boolean).join(' — ') || null);
    champ('Employés (temps plein / partiel)', [c.nb_employes_temps_plein, c.nb_employes_temps_partiel]
      .filter((x) => x != null).join(' / ') || null);
    champ('Employés couverts par la CSST', ouiNon(c.employes_csst));
    champArgent('Masse salariale', c.masse_salariale);
    champ('Responsabilité pour l\u2019alcool', ouiNon(c.responsabilite_alcool));
    if (d.questions.length) {
      doc.moveDown(0.4).font('Helvetica-Bold').text('Questions additionnelles');
      doc.font('Helvetica');
      for (const q of d.questions) champ(q.question, q.reponse);
    }

    // Sommaire police antérieure et réclamations
    const a = d.antecedents || {};
    titre('SOMMAIRE — POLICE ANTÉRIEURE ET RÉCLAMATIONS');
    champ('Assureur actuel', a.assureur_actuel);
    champ('N° de police actuelle', a.numero_police_actuelle);
    champ('Expiration', dateFr(a.date_expiration_actuelle));
    champ('Années d\u2019assurance continue', a.annees_assurance_continue);
    champ('Type de police précédente', a.type_police_precedente);
    champArgent('Prime de la police précédente', a.prime_precedente);
    champ('Refus, résiliation ou non-renouvellement (5 ans)', ouiNon(a.refus_resiliation_nonrenouvellement));
    if (a.refus_explication) champ('Refus — explication', a.refus_explication);
    champ('Faillite ou jugement', ouiNon(a.faillite_jugement));
    champ('Condamnation — malhonnêteté', ouiNon(a.condamnation_honnetete));
    doc.moveDown(0.4).font('Helvetica-Bold').text('Réclamations des 5 dernières années');
    doc.font('Helvetica');
    if (!d.sinistres.length) doc.text('Aucunes');
    for (const s of d.sinistres) {
      doc.text(`• ${dateFr(s.date)} — ${val(s.type)} — ${val(s.description)} — Montant ${argent(s.montant)}`
        + ` — Payé ${argent(s.montant_paye)} — Réserve ${argent(s.reserve)} — ${val(s.statut)}`);
    }

    // Tableau des garanties
    titre('TABLEAU DES GARANTIES');
    const colG = [G, G + 262, G + 330, G + 404, G + 452];
    const enteteTableau = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('Garantie', colG[0], y, { width: 258 });
      doc.text('Franchise', colG[1], y, { width: 66, align: 'right' });
      doc.text('Règle prop.', colG[2], y, { width: 70, align: 'right' });
      doc.text('Montant', colG[3], y, { width: 76, align: 'right' });
      doc.text('Taux / Prime', colG[4], y, { width: 56, align: 'right' });
      doc.font('Helvetica');
      doc.y = y + 14;
      doc.moveTo(G, doc.y).lineTo(G + LARG, doc.y).strokeColor('#999').lineWidth(0.6).stroke();
      doc.moveDown(0.2);
    };
    enteteTableau();
    for (const l of lignesTableauGaranties(d)) {
      if (doc.y > doc.page.height - 90) { doc.addPage(); enteteTableau(); }
      const y = doc.y;
      doc.fontSize(9).text(l.garantie, colG[0], y, { width: 258 });
      const hLigne = doc.heightOfString(l.garantie, { width: 258, fontSize: 9 });
      doc.text(l.franchise != null ? argent(l.franchise) : '—', colG[1], y, { width: 66, align: 'right' });
      doc.text(l.regle != null ? l.regle + ' %' : '—', colG[2], y, { width: 70, align: 'right' });
      doc.text(argent(l.montant), colG[3], y, { width: 76, align: 'right' });
      doc.y = y + Math.max(13, hLigne + 2);
    }
    doc.fontSize(10);

    // Pages par emplacement
    d.emplacements.forEach((e, i) => {
      const b = e.batiment;
      doc.addPage();
      doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(13)
        .text(`EMPLACEMENT ${i + 1} — ${b.adresse}${b.ville ? ', ' + b.ville : ''}`, G);
      doc.moveTo(G, doc.y + 2).lineTo(G + LARG, doc.y + 2).strokeColor(BLEU).lineWidth(1.2).stroke();
      doc.moveDown(0.35).fillColor(NOIR).font('Helvetica').fontSize(10);
      champ('Adresse complète', adresseComplete(b));
      champ('Affectation / activités', b.type_activite);
      champ('Intérêt de l\u2019assuré', b.interet_assure);
      champ('Superficie occupée (pi²)', b.superficie_occupee_pi2);
      champ('Année de construction', b.annee_construction);
      champ('Nombre d\u2019étages', b.nombre_etages);
      doc.moveDown(0.3).font('Helvetica-Bold').text('Construction');
      doc.font('Helvetica');
      champ('Classe de construction (assureur)', LIBELLES_CLASSE_CONSTRUCTION[b.classe_construction] || b.classe_construction);
      champ('Murs extérieurs', b.construction_mur);
      champ('Structure du toit', b.construction_toit_structure);
      champ('Finition du toit', b.finition_toit);
      champ('Matériau des sols', b.materiau_sol);
      champ('Sous-sol', b.sous_sol);
      champ('Électricité / plomberie / carburant', [b.electricite_type, b.plomberie_materiau, b.carburant].filter(Boolean).join(' / ') || null);
      champ('Rénovations', [
        b.annee_toiture ? `Toiture ${b.annee_toiture}` : '',
        b.renovation_electricite_annee ? `Électricité ${b.renovation_electricite_annee}` : '',
        b.renovation_plomberie_annee ? `Plomberie ${b.renovation_plomberie_annee}` : '',
        b.renovation_chauffage_annee ? `Chauffage ${b.renovation_chauffage_annee}` : '',
      ].filter(Boolean).join(' · ') || null);
      doc.moveDown(0.3).font('Helvetica-Bold').text('Protection incendie et risques criminels');
      doc.font('Helvetica');
      champ('Prise d\u2019eau', b.prise_eau_distance);
      champ('Caserne', [b.caserne_type, b.caserne_distance_km != null ? b.caserne_distance_km + ' km' : ''].filter(Boolean).join(' — ') || null);
      champ('Gicleurs', ouiNon(b.gicleurs) + (b.gicleurs_couverture ? ` (${b.gicleurs_couverture})` : ''));
      champ('Alarme incendie', b.alarme_incendie_type);
      champ('Alarme antivol', b.alarme_vol_type);
      champ('Pêne dormant / fenêtres grillagées / glaces incassables / caméras',
        [ouiNon(b.pene_dormant), ouiNon(b.fenetres_grillagees), ouiNon(b.glaces_incassables), ouiNon(b.cameras)].join(' / '));
      doc.moveDown(0.3).font('Helvetica-Bold').text('Voisinage');
      doc.font('Helvetica');
      champ('À gauche', [b.voisin_gauche_affectation, b.voisin_gauche_distance_m != null ? b.voisin_gauche_distance_m + ' m' : ''].filter(Boolean).join(' — ') || null);
      champ('À droite', [b.voisin_droite_affectation, b.voisin_droite_distance_m != null ? b.voisin_droite_distance_m + ' m' : ''].filter(Boolean).join(' — ') || null);
      champ('À l\u2019arrière', [b.voisin_arriere_affectation, b.voisin_arriere_distance_m != null ? b.voisin_arriere_distance_m + ' m' : ''].filter(Boolean).join(' — ') || null);
      champ('En face', [b.voisin_enface_affectation, b.voisin_enface_distance_m != null ? b.voisin_enface_distance_m + ' m' : ''].filter(Boolean).join(' — ') || null);
      if (e.garanties) {
        doc.moveDown(0.3).font('Helvetica-Bold').text('Garanties de cet emplacement');
        doc.font('Helvetica');
        champ('Formule', NOMS_FORMULE_BIENS[e.garanties.formule] || e.garanties.formule);
        champArgent('Montant — bâtiment', e.garanties.montant_assurance);
        champArgent('Franchise — bâtiment', e.garanties.franchise);
      }
      if (e.contenus.length) {
        doc.moveDown(0.3).font('Helvetica-Bold').text('Contenus');
        doc.font('Helvetica');
        for (const ct of e.contenus) doc.text(`• ${val(ct.description)} — ${argent(ct.valeur)}`);
      }
      if (e.beneficiaires.length) {
        doc.moveDown(0.3).font('Helvetica-Bold').text('Bénéficiaires de cet emplacement');
        doc.font('Helvetica');
        for (const ben of e.beneficiaires) {
          doc.text(`• ${ben.nom} — ${adresseComplete(ben)} — ${val(ben.qualite)} — Préavis : ${val(ben.clause_preavis)}`);
        }
      }
    });

    // Bénéficiaires (sommaire) + assurés additionnels
    const tousBen = d.emplacements.flatMap((e) => e.beneficiaires.map((ben) => ({ ben, lieu: e.batiment.adresse })));
    if (tousBen.length) {
      titre('BÉNÉFICIAIRES');
      for (const { ben, lieu } of tousBen) {
        doc.text(`• ${lieu} — ${ben.nom} — ${adresseComplete(ben)} — ${val(ben.qualite)} — Préavis : ${val(ben.clause_preavis)}`);
      }
    }
    if (d.assures.length) {
      titre('ASSURÉS ADDITIONNELS');
      for (const aa of d.assures) doc.text(`• ${aa.nom} — ${adresseComplete(aa)} — ${val(aa.interet)}`);
    }

    // Annexes conditionnelles
    if (d.flottante.length) {
      doc.addPage();
      titre('ANNEXE — ASSURANCE FLOTTANTE DES OUTILS');
      for (const art of d.flottante) {
        doc.text(`• ${art.description} — Base : ${val(art.base_reglement)} — ${argent(art.montant)}`);
      }
      doc.moveDown(0.3).font('Helvetica-Bold').text(`Total : ${argent(d.flottanteTotal)}`);
      doc.font('Helvetica');
    }
    if (d.umbrellaPresente) {
      if (!d.flottante.length) doc.addPage();
      titre('ANNEXE — POLICE UMBRELLA');
      for (const e of d.emplacements) {
        const grc = e.rc && e.rc.garanties;
        if (!grc || (!grc.umbrella_montant && !grc.umbrella_retention)) continue;
        doc.text(`• ${e.batiment.adresse} — Montant ${argent(grc.umbrella_montant)} — Rétention ${argent(grc.umbrella_retention)}`
          + ` — Polices de base : ${val((grc.umbrella_polices_base || []).join(', ') || null)}`);
      }
    }

    if (d.dossier.circonstances_speciales) {
      titre('CIRCONSTANCES SPÉCIALES');
      doc.text(d.dossier.circonstances_speciales);
    }
    if (d.dossier.remarques_diverses) {
      titre('REMARQUES DIVERSES');
      doc.text(d.dossier.remarques_diverses);
    }

    // Signature
    doc.moveDown(1.6);
    const ySig = doc.y;
    doc.moveTo(G, ySig).lineTo(G + 200, ySig).strokeColor(NOIR).lineWidth(0.8).stroke();
    doc.moveTo(G + 260, ySig).lineTo(G + 400, ySig).stroke();
    doc.fontSize(10).text(val(d.dossier.signataire_nom), G, ySig + 6, { width: 200 });
    doc.text(dateFr(d.dossier.date_signature), G + 260, ySig + 6, { width: 140 });
    doc.fontSize(8.5).fillColor(GRIS)
      .text(`${val(d.dossier.signataire_titre)} — Signature`, G, ySig + 22, { width: 200 })
      .text('Date', G + 260, ySig + 22, { width: 140 });
    if (d.placementNom) doc.text(`Courtier de placement : ${d.placementNom}`, G, ySig + 40);
    doc.moveDown(2).fontSize(8.5)
      .text(`Document généré le ${dateFr(d.dateGeneration)} par ${d.cabinetNom} — dossier combiné n° ${d.dossierId}. Demande de prix : les taux et primes sont à compléter par l\u2019assureur.`);

    doc.end();
  });
}

module.exports = { genererPropositionCombineePdf };
