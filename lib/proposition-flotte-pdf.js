/**
 * lib/proposition-flotte-pdf.js — Génération du PDF de la proposition
 * d'assurance flotte automobile pré-remplie (flotte — étape 7/10).
 * Même contenu que la page HTML (views/flotte/proposition.ejs), mis en page
 * avec pdfkit (pur JS, sans binaire). Les données viennent de
 * lib/proposition-flotte.js (source unique). Le PDF n'est PAS compressé :
 * le texte reste lisible dans le flux.
 * Miroir de lib/proposition-pe-pdf.js (étape 7/10 PE).
 *
 * La proposition ne modifie JAMAIS la soumission : lecture seule.
 */
const PDFDocument = require('pdfkit');

const TIRET = '—';
const NOIR = '#111111';
const GRIS = '#555555';
const BLEU = '#1e3a5f';

function val(v) {
  if (v === null || v === undefined || v === '') return TIRET;
  return String(v);
}

function genererPropositionFlottePdf(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 48, bottom: 56, left: 52, right: 52 },
      compress: false, // texte en clair dans le flux : traçabilité (règle d'or)
      info: {
        Title: `Proposition d'assurance flotte automobile — Soumission flotte #${d.soumissionId}`,
        Author: d.cabinetNom,
        Subject: 'Flotte automobile commerciale (Québec)',
      },
    });
    const morceaux = [];
    doc.on('data', (c) => morceaux.push(c));
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);

    const largeur = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const gauche = doc.page.margins.left;

    function saut(h = 8) { doc.moveDown(h / 12); }
    function titreSection(texte) {
      saut(10);
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(13).fillColor(BLEU).text(texte);
      doc.moveTo(gauche, doc.y + 2)
        .lineTo(gauche + largeur, doc.y + 2)
        .strokeColor('#9db3c8').lineWidth(1).stroke();
      saut(6);
    }
    function ligne(label, valeur, opts = {}) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR)
        .text(label + ' : ', { continued: true, ...opts });
      doc.font('Helvetica').fillColor(GRIS).text(val(valeur), opts);
    }
    function paragraphe(texte) {
      doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(val(texte));
    }
    function mentionImportante(texte) {
      saut(2);
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.font('Helvetica-BoldOblique').fontSize(10).fillColor(NOIR).text(texte);
      saut(2);
    }
    // Ligne de tableau : colonnes à positions fixes (x relatifs à la marge).
    function ligneTableau(cols) {
      const y = doc.y;
      let hauteur = 0;
      for (const c of cols) {
        doc.font(c.gras ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(c.taille || 9.5)
          .fillColor(c.couleur || GRIS)
          .text(val(c.texte), gauche + c.x, y, { width: c.largeur, align: c.align || 'left' });
        hauteur = Math.max(hauteur, doc.heightOfString(val(c.texte), { width: c.largeur }));
      }
      doc.y = y + hauteur + 3;
      doc.x = gauche;
    }
    function enteteTableau(cols) {
      ligneTableau(cols.map((c) => ({ ...c, gras: true, couleur: BLEU, taille: 9.5 })));
      doc.moveTo(gauche, doc.y).lineTo(gauche + largeur, doc.y)
        .strokeColor('#9db3c8').lineWidth(0.7).stroke();
      doc.y += 4;
    }

    // --- En-tête -----------------------------------------------------------
    doc.font('Helvetica-Bold').fontSize(17).fillColor(NOIR)
      .text(d.cabinetNom, { align: 'center' });
    doc.font('Helvetica-Bold').fontSize(14).fillColor(BLEU)
      .text('Proposition d’assurance flotte automobile', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor(GRIS)
      .text('Formulaire de proposition — Flotte automobile commerciale (Québec)', { align: 'center' });
    saut(4);
    doc.font('Helvetica').fontSize(10).fillColor(NOIR)
      .text(`Soumission flotte #${d.soumissionId} — version v${d.versionNumero}${d.versionFigee ? ' (figée)' : ''}`, { align: 'center' });
    if (d.dateEffet) {
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Date d’effet souhaitée : ${d.dateEffet}`, { align: 'center' });
    }

    // --- 1. Proposant ------------------------------------------------------
    titreSection('1. Proposant / assuré');
    const c = d.client || {};
    ligne('Nom', c.raison_sociale);
    if (c.adresse || c.ville || c.code_postal) {
      ligne('Adresse', [c.adresse, c.ville, c.code_postal].filter(Boolean).join(', '));
    }
    if (c.telephone) ligne('Téléphone', c.telephone);
    if (c.courriel) ligne('Courriel', c.courriel);
    if (c.prenom || c.nom) {
      ligne('Personne-contact', [c.prenom, c.nom].filter(Boolean).join(' ')
        + (c.titre_contact ? ` (${c.titre_contact})` : ''));
    }
    if (d.courtierNom) ligne('Courtier responsable', d.courtierNom);
    if (d.notes) { saut(2); ligne('Notes', d.notes); }

    // --- 2. Résumé de la flotte ---------------------------------------------
    titreSection('2. Résumé de la flotte');
    const r = d.resume;
    ligne('Véhicules détaillés', r.nbVehicules);
    if (r.nbVehiculesDeclares !== null && r.nbVehiculesDeclares !== r.nbVehicules) {
      ligne('Véhicules déclarés (en-tête)', r.nbVehiculesDeclares);
    }
    ligne('Valeur totale des véhicules', r.valeurTotale_libelle);
    ligne('Usage dominant', r.usageDominant_libelle);
    if (r.usagesLibelles.length) ligne('Usages des véhicules', r.usagesLibelles.join(', '));
    ligne('Rayon d’opération principal', r.rayonPrincipal_libelle);
    if (r.rayonMaxVehicules) ligne('Rayon maximal (véhicules)', `${Number(r.rayonMaxVehicules).toLocaleString('fr-CA')} km`);
    if (d.entete.assureur) ligne('Assureur visé', d.entete.assureur);
    if (d.entete.date_echeance_visee) ligne('Date d’échéance visée', d.entete.date_echeance_visee);

    // --- 3. Véhicules ---------------------------------------------------------
    titreSection(`3. Véhicules (${d.vehicules.length})`);
    if (!d.vehicules.length) {
      paragraphe('Aucun véhicule saisi.');
    } else {
      enteteTableau([
        { x: 0, largeur: 168, texte: 'Véhicule' },
        { x: 172, largeur: 128, texte: 'NIV' },
        { x: 304, largeur: 74, texte: 'Type' },
        { x: 382, largeur: 126, texte: 'Valeur', align: 'right' },
      ]);
      d.vehicules.forEach((x) => {
        if (doc.y > doc.page.height - 110) doc.addPage();
        ligneTableau([
          { x: 0, largeur: 168, texte: x.designation, gras: true, couleur: NOIR },
          { x: 172, largeur: 128, texte: x.niv || TIRET },
          { x: 304, largeur: 74, texte: x.type_libelle },
          { x: 382, largeur: 126, texte: x.valeur_libelle, align: 'right' },
        ]);
        const details = [
          `Usage : ${x.usage_libelle}`,
          `Rayon : ${x.rayon_libelle}`,
          `Conducteur principal : ${x.conducteur_principal_libelle}`,
          x.lieu_remisage ? `Remisage : ${x.lieu_remisage}` : null,
          x.equipements_libelles.length ? `Équipements : ${x.equipements_libelles.join(', ')}` : null,
        ].filter(Boolean);
        doc.font('Helvetica').fontSize(9).fillColor(GRIS)
          .text(details.join(' — '), gauche + 8, doc.y, { width: largeur - 8 });
        doc.y += 3;
        doc.x = gauche;
      });
    }

    // --- 4. Conducteurs -------------------------------------------------------
    titreSection(`4. Conducteurs (${d.conducteurs.length})`);
    if (!d.conducteurs.length) {
      paragraphe('Aucun conducteur saisi.');
    } else {
      enteteTableau([
        { x: 0, largeur: 168, texte: 'Conducteur' },
        { x: 172, largeur: 128, texte: 'Permis' },
        { x: 304, largeur: 74, texte: 'Expérience' },
        { x: 382, largeur: 126, texte: 'Sinistres 5 ans', align: 'right' },
      ]);
      d.conducteurs.forEach((x) => {
        if (doc.y > doc.page.height - 110) doc.addPage();
        ligneTableau([
          { x: 0, largeur: 168, texte: x.nom_complet, gras: true, couleur: NOIR },
          { x: 172, largeur: 128, texte: x.numero_permis || TIRET },
          { x: 304, largeur: 74, texte: x.experience_libelle },
          { x: 382, largeur: 126, texte: String(x.sinistres_libelles.length), align: 'right' },
        ]);
        const details = [
          x.classe_permis ? `Classe ${x.classe_permis}` : null,
          (x.annees_experience_lourds !== null && x.annees_experience_lourds !== undefined && x.annees_experience_lourds !== '')
            ? `dont ${x.experience_lourds_libelle} en véhicules lourds` : null,
          x.date_embauche ? `Embauché(e) le ${x.date_embauche}` : null,
          `Sinistres (5 ans) : ${x.sinistres_libelles.length ? x.sinistres_libelles.join(' ; ') : 'Aucun'}`,
          `Infractions (3 ans) : ${x.infractions_libelles.length ? x.infractions_libelles.join(' ; ') : 'Aucune'}`,
          x.formations_libelles.length ? `Formations : ${x.formations_libelles.join(' ; ')}` : null,
        ].filter(Boolean);
        doc.font('Helvetica').fontSize(9).fillColor(GRIS)
          .text(details.join(' — '), gauche + 8, doc.y, { width: largeur - 8 });
        doc.y += 3;
        doc.x = gauche;
      });
    }

    // --- 5. Garanties proposées ------------------------------------------------
    titreSection('5. Garanties proposées');
    const g = d.garanties;
    if (!g) {
      paragraphe('Non définies.');
    } else {
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Limite de responsabilité civile (chapitre A) : ${g.limite_rc_libelle}`);
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Franchise collision / renversement : ${g.franchise_collision_libelle}`);
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Franchise versement : ${g.franchise_versement_libelle}`);
      if (g.prime && g.prime_libelle !== TIRET) {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(`Prime : ${g.prime_libelle}`);
      }
      if (g.avenants_libelles && g.avenants_libelles.length) {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS)
          .text('Avenants : ' + g.avenants_libelles.join(', '));
      }
      mentionImportante('Tout conducteur doit détenir un permis de conduire valide de la classe appropriée au véhicule conduit ; un conducteur non déclaré, ou dont le dossier de conduite n’a pas été vérifié, ne peut prendre le volant d’un véhicule de la flotte.');
      mentionImportante('Tout véhicule ajouté, remplacé ou retiré doit être déclaré sans délai au courtier : un véhicule non déclaré n’est pas couvert, et l’usage réel de chaque véhicule doit correspondre à l’usage déclaré.');
      if (g.faq43) {
        mentionImportante('La FAQ 43 (valeur à neuf) est souscrite : en cas de perte totale d’un véhicule visé par l’avenant, l’indemnité est calculée sans dépréciation, sur la valeur à neuf du véhicule.');
      }
    }

    // --- 6. Antécédents ----------------------------------------------------------
    titreSection('6. Antécédents d’assurance');
    const a = d.antecedents;
    if (!a) {
      paragraphe('Non renseignés.');
    } else {
      if (a.assureur_actuel) ligne('Assureur actuel', a.assureur_actuel);
      if (a.numero_police_actuelle) ligne('Police actuelle', a.numero_police_actuelle);
      if (a.date_expiration_actuelle) ligne('Expiration', a.date_expiration_actuelle);
      if (a.annees_assurance_flotte_continue) ligne('Années d’assurance flotte continue', a.annees_assurance_flotte_continue);
      ligne('Sinistres de la flotte (5 ans)',
        (a.sinistres_flotte_libelles && a.sinistres_flotte_libelles.length)
          ? a.sinistres_flotte_libelles.join(' ; ')
          : 'Aucun');
      ligne('Ratio de pertes', a.ratio_pertes_libelle);
      if (a.refus_annulation_ant) {
        ligne('Refus ou annulation antérieur', a.refus_annulation_details || 'Oui');
      }
    }

    // --- 7. Consentements ---------------------------------------------------------
    titreSection('7. Consentements');
    if (d.consentementsLibelles.length) {
      d.consentementsLibelles.forEach((lib) => {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS).text('☑ ' + lib);
      });
    } else {
      paragraphe('Aucun consentement enregistré.');
    }

    // --- Pied + signatures ----------------------------------------------------------
    saut(10);
    if (doc.y > doc.page.height - 150) doc.addPage();
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRIS).text(
      `Document généré le ${d.genereLe} à partir de la soumission flotte #${d.soumissionId} (version v${d.versionNumero}${d.versionFigee ? ', figée' : ''}) — proposition conforme à la version figée, vérifiez avant envoi à l’assureur.`
    );
    saut(12);
    const y0 = doc.y;
    const colW = largeur / 2 - 12;
    doc.font('Helvetica').fontSize(10).fillColor(NOIR).text('Signature du proposant', gauche, y0);
    doc.font('Helvetica').fontSize(10).fillColor(NOIR).text('Signature du courtier', gauche + colW + 24, y0);
    doc.moveTo(gauche, y0 + 44).lineTo(gauche + colW, y0 + 44).strokeColor(GRIS).stroke();
    doc.moveTo(gauche + colW + 24, y0 + 44).lineTo(gauche + largeur, y0 + 44).strokeColor(GRIS).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(GRIS).text('Date : _______________', gauche, y0 + 50);
    doc.font('Helvetica').fontSize(9).fillColor(GRIS).text('Date : _______________', gauche + colW + 24, y0 + 50);

    doc.end();
  });
}

module.exports = { genererPropositionFlottePdf };
