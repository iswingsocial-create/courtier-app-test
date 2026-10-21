/**
 * lib/proposition-pdf.js — Génération du PDF de la proposition d'assurance
 * automobile pré-remplie (étape 7/10). Même contenu que la page HTML
 * (views/auto/proposition.ejs), mis en page avec pdfkit (pur JS, sans binaire).
 * Les données viennent de lib/proposition.js (source unique).
 * Le PDF n'est PAS compressé : le texte reste lisible dans le flux.
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

function genererPropositionPdf(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 48, bottom: 56, left: 52, right: 52 },
      compress: false, // texte en clair dans le flux : traçabilité (règle d'or)
      info: {
        Title: `Proposition d'assurance automobile — Soumission #${d.soumissionId}`,
        Author: d.cabinetNom,
        Subject: 'FPQ1 (Québec)',
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

    // --- En-tête -----------------------------------------------------------
    doc.font('Helvetica-Bold').fontSize(17).fillColor(NOIR)
      .text(d.cabinetNom, { align: 'center' });
    doc.font('Helvetica-Bold').fontSize(14).fillColor(BLEU)
      .text('Proposition d’assurance automobile', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor(GRIS)
      .text('Formulaire de proposition — FPQ1 (Québec)', { align: 'center' });
    saut(4);
    doc.font('Helvetica').fontSize(10).fillColor(NOIR)
      .text(`Soumission #${d.soumissionId} — version v${d.versionNumero}${d.versionFigee ? ' (figée)' : ''}`, { align: 'center' });
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
    if (c.prenom || c.nom) ligne('Personne-contact', [c.prenom, c.nom].filter(Boolean).join(' '));
    if (d.courtierNom) ligne('Courtier responsable', d.courtierNom);
    if (d.notes) { saut(2); ligne('Notes', d.notes); }

    // --- 2. Conducteurs ----------------------------------------------------
    titreSection(`2. Conducteurs (${d.conducteurs.length})`);
    if (!d.conducteurs.length) {
      paragraphe('Aucun conducteur saisi.');
    }
    d.conducteurs.forEach((cd, i) => {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(11).fillColor(NOIR)
        .text(`${i + 1}. ${val(cd.prenom)} ${val(cd.nom)}${cd.conducteur_principal ? ' — conducteur principal' : ''}`);
      const details = [];
      if (cd.date_naissance) details.push(`né(e) le ${cd.date_naissance}`);
      if (cd.numero_permis) details.push(`permis ${cd.numero_permis} (${cd.province_permis || 'QC'})`);
      if (cd.date_obtention_permis) details.push(`obtenu le ${cd.date_obtention_permis}`);
      if (cd.annees_experience_ca) details.push(`${cd.annees_experience_ca} ans d’expérience au Canada`);
      if (cd.lien_assure) details.push(`lien : ${cd.lien_assure}`);
      if (details.length) {
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text(details.join(' · '));
      }
      const infr = cd.infractions || [];
      if (infr.length) {
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIS)
          .text('Infractions : ' + infr.map((x) => [x.date, x.type, x.points ? x.points + ' pts' : null].filter(Boolean).join(' — ')).join(' ; '));
      }
      const susp = cd.suspensions || [];
      if (susp.length) {
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text('Suspensions : ' + susp.join(' ; '));
      }
      saut(4);
    });

    // --- 3. Véhicules ------------------------------------------------------
    titreSection(`3. Véhicules (${d.vehicules.length})`);
    if (!d.vehicules.length) {
      paragraphe('Aucun véhicule saisi.');
    }
    d.vehicules.forEach((vh, i) => {
      if (doc.y > doc.page.height - 170) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(11).fillColor(NOIR)
        .text(`${i + 1}. ${[vh.annee, vh.marque, vh.modele, vh.version_finition].filter(Boolean).join(' ') || 'Véhicule'}`);
      const g = vh.garanties;
      const infos = [];
      if (vh.vin) infos.push(`NIV : ${vh.vin}`);
      if (vh.usage_libelle) infos.push(`usage : ${vh.usage_libelle}`);
      if (vh.financement_libelle) infos.push(vh.financement_libelle);
      if (vh.km_annuel) infos.push(`${vh.km_annuel} km/an`);
      if (vh.creancier_nom) infos.push(`créancier : ${vh.creancier_nom}`);
      if (infos.length) {
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text(infos.join(' · '));
      }
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR).text('Garanties demandées :', { continued: false });
      if (g) {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS)
          .text(`Responsabilité civile : ${g.rc_libelle}`);
        doc.font('Helvetica').fontSize(10).fillColor(GRIS)
          .text(`Dommages au véhicule : ${g.protection_b_libelle} — franchise ${g.franchise_libelle}`);
        if (g.avenants_libelles && g.avenants_libelles.length) {
          doc.font('Helvetica').fontSize(10).fillColor(GRIS)
            .text('Avenants : ' + g.avenants_libelles.join(', '));
        }
      } else {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS).text('Non définies.');
      }
      saut(6);
    });

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
      const flags = [
        a.resiliation_ant && 'résiliation antérieure',
        a.non_paiement_ant && 'non-paiement antérieur',
        a.faillite && 'faillite',
        a.casier_judiciaire && 'casier judiciaire',
      ].filter(Boolean);
      ligne('Déclarations', flags.length ? flags.join(', ') : 'Aucune');
      const sins = a.sinistres_6ans || [];
      ligne('Sinistres (6 ans)',
        sins.length
          ? sins.map((x) => [x.date, x.type, x.montant ? x.montant + ' $' : null].filter(Boolean).join(' — ')).join(' ; ')
          : 'Aucun');
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
      `Document généré le ${d.genereLe} à partir de la soumission #${d.soumissionId} (version v${d.versionNumero}${d.versionFigee ? ', figée' : ''}) — vérifiez avant envoi à l’assureur.`
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

module.exports = { genererPropositionPdf };
