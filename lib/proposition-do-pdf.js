/**
 * lib/proposition-do-pdf.js — Génération du PDF de la proposition
 * d'assurance responsabilité des administrateurs et dirigeants pré-remplie
 * (D&O — étape 7/10).
 * Même contenu que la page HTML (views/do/proposition.ejs), mis en page
 * avec pdfkit (pur JS, sans binaire). Les données viennent de
 * lib/proposition-do.js (source unique). Le PDF n'est PAS compressé :
 * le texte reste lisible dans le flux.
 * Miroir de lib/proposition-eo-pdf.js (étape 7/10 E&O).
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

function genererPropositionDoPdf(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 48, bottom: 56, left: 52, right: 52 },
      compress: false, // texte en clair dans le flux : traçabilité (règle d'or)
      info: {
        Title: `Proposition d'assurance responsabilité des administrateurs et dirigeants — Soumission D&O #${d.soumissionId}`,
        Author: d.cabinetNom,
        Subject: 'Administrateurs et dirigeants (D&O, Québec)',
      },
    });
    const morceaux = [];
    doc.on('data', (c) => morceaux.push(c));
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);

    const largeur = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    function saut(h = 8) { doc.moveDown(h / 12); }
    function titreSection(texte) {
      saut(10);
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(13).fillColor(BLEU).text(texte);
      doc.moveTo(doc.page.margins.left, doc.y + 2)
        .lineTo(doc.page.margins.left + largeur, doc.y + 2)
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

    // --- En-tête -----------------------------------------------------------
    doc.font('Helvetica-Bold').fontSize(17).fillColor(NOIR)
      .text(d.cabinetNom, { align: 'center' });
    doc.font('Helvetica-Bold').fontSize(14).fillColor(BLEU)
      .text('Proposition d’assurance responsabilité des administrateurs et dirigeants', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor(GRIS)
      .text('Formulaire de proposition — Administrateurs et dirigeants (D&O, Québec)', { align: 'center' });
    saut(4);
    doc.font('Helvetica').fontSize(10).fillColor(NOIR)
      .text(`Soumission D&O #${d.soumissionId} — version v${d.versionNumero}${d.versionFigee ? ' (figée)' : ''}`, { align: 'center' });
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

    // --- 2. Dirigeants ------------------------------------------------------
    titreSection(`2. Dirigeants (${d.dirigeants.length})`);
    if (!d.dirigeants.length) {
      paragraphe('Aucun dirigeant saisi.');
    }
    d.dirigeants.forEach((x, i) => {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR)
        .text(`${i + 1}. ${x.nom || TIRET}`);
      doc.font('Helvetica').fontSize(9.5).fillColor(GRIS)
        .text(`Fonction : ${val(x.fonction)} — Expérience : ${x.annees_experience_libelle}`);
      if (x.antecedents_personnels) {
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIS)
          .text(`Antécédents personnels : ${x.antecedents_personnels}`);
      }
      saut(4);
    });

    // --- 3. Garanties demandées --------------------------------------------
    titreSection('3. Garanties demandées');
    const g = d.garanties;
    if (!g) {
      paragraphe('Non définies.');
    } else {
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Limite par sinistre : ${g.limite_par_sinistre_libelle} — agrégat annuel : ${g.limite_agregat_libelle}`);
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Franchise : ${g.franchise_libelle}`);
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Base de garantie : ${g.base_libelle}`);
      if (g.prime && g.prime_libelle !== TIRET) {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(`Prime : ${g.prime_libelle}`);
      }
      if (g.avenants_libelles && g.avenants_libelles.length) {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS)
          .text('Avenants : ' + g.avenants_libelles.join(', '));
      }
      if (g.base === 'reclamations_presentees') {
        mentionImportante('Base réclamations-présentées : la date de déclaration compte — maintenir la continuité d’assurance.');
      }
    }

    // --- 4. Antécédents ----------------------------------------------------
    titreSection('4. Antécédents d’assurance');
    const a = d.antecedents;
    if (!a) {
      paragraphe('Non renseignés.');
    } else {
      if (a.assureur_actuel) ligne('Assureur actuel', a.assureur_actuel);
      if (a.numero_police_actuelle) ligne('Police actuelle', a.numero_police_actuelle);
      if (a.date_expiration_actuelle) ligne('Expiration', a.date_expiration_actuelle);
      if (a.annees_assurance_continue) ligne('Années d’assurance continue', a.annees_assurance_continue);
      ligne('Réclamations D&O (5 ans)',
        (a.reclamations_libelles && a.reclamations_libelles.length)
          ? a.reclamations_libelles.join(' ; ')
          : 'Aucune');
      if (a.poursuites_en_cours) { saut(2); ligne('Poursuites ou actions en justice en cours ou envisagées', a.poursuites_en_cours); }
    }

    // --- 5. Consentements --------------------------------------------------
    titreSection('5. Consentements');
    if (d.consentementsLibelles.length) {
      d.consentementsLibelles.forEach((lib) => {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS).text('☑ ' + lib);
      });
    } else {
      paragraphe('Aucun consentement enregistré.');
    }

    // --- Pied + signatures -------------------------------------------------
    saut(10);
    if (doc.y > doc.page.height - 150) doc.addPage();
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRIS).text(
      `Document généré le ${d.genereLe} à partir de la soumission D&O #${d.soumissionId} (version v${d.versionNumero}${d.versionFigee ? ', figée' : ''}) — proposition conforme à la version figée, vérifiez avant envoi à l’assureur.`
    );
    saut(12);
    const y0 = doc.y;
    const colW = largeur / 2 - 12;
    doc.font('Helvetica').fontSize(10).fillColor(NOIR).text('Signature du proposant', doc.page.margins.left, y0);
    doc.font('Helvetica').fontSize(10).fillColor(NOIR).text('Signature du courtier', doc.page.margins.left + colW + 24, y0);
    doc.moveTo(doc.page.margins.left, y0 + 44).lineTo(doc.page.margins.left + colW, y0 + 44).strokeColor(GRIS).stroke();
    doc.moveTo(doc.page.margins.left + colW + 24, y0 + 44).lineTo(doc.page.margins.left + largeur, y0 + 44).strokeColor(GRIS).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(GRIS).text('Date : _______________', doc.page.margins.left, y0 + 50);
    doc.font('Helvetica').fontSize(9).fillColor(GRIS).text('Date : _______________', doc.page.margins.left + colW + 24, y0 + 50);

    doc.end();
  });
}

module.exports = { genererPropositionDoPdf };
