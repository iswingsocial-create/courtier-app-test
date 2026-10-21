/**
 * lib/proposition-biens-pdf.js — Génération du PDF de la proposition
 * d'assurance des biens commerciaux pré-remplie (biens — étape 7/10).
 * Même contenu que la page HTML (views/biens/proposition.ejs), mis en page
 * avec pdfkit (pur JS, sans binaire). Les données viennent de
 * lib/proposition-biens.js (source unique). Le PDF n'est PAS compressé :
 * le texte reste lisible dans le flux.
 * Miroir de lib/proposition-pdf.js (auto FPQ1).
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

function genererPropositionBiensPdf(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 48, bottom: 56, left: 52, right: 52 },
      compress: false, // texte en clair dans le flux : traçabilité (règle d'or)
      info: {
        Title: `Proposition d'assurance biens commerciaux — Soumission #${d.soumissionId}`,
        Author: d.cabinetNom,
        Subject: 'Biens commerciaux (Québec)',
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
      .text('Proposition d’assurance biens commerciaux', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor(GRIS)
      .text('Formulaire de proposition — Biens commerciaux (Québec)', { align: 'center' });
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
    if (c.prenom || c.nom) {
      ligne('Personne-contact', [c.prenom, c.nom].filter(Boolean).join(' ')
        + (c.titre_contact ? ` (${c.titre_contact})` : ''));
    }
    if (d.courtierNom) ligne('Courtier responsable', d.courtierNom);
    if (d.notes) { saut(2); ligne('Notes', d.notes); }

    // --- 2. Bâtiments ------------------------------------------------------
    titreSection(`2. Bâtiments (${d.batiments.length})`);
    if (!d.batiments.length) {
      paragraphe('Aucun bâtiment saisi.');
    }
    d.batiments.forEach((b, i) => {
      if (doc.y > doc.page.height - 190) doc.addPage();
      const adresse = [b.adresse, b.ville, b.code_postal].filter(Boolean).join(', ') || `Bâtiment ${i + 1}`;
      doc.font('Helvetica-Bold').fontSize(11).fillColor(NOIR)
        .text(`${i + 1}. ${adresse}`);
      const infos = [];
      if (b.type_construction_libelle && b.type_construction_libelle !== TIRET) infos.push(`construction : ${b.type_construction_libelle}`);
      if (b.annee_construction) infos.push(`construit en ${b.annee_construction}`);
      if (b.superficie_pi2) infos.push(`${Number(b.superficie_pi2).toLocaleString('fr-CA')} pi²`);
      if (b.nb_etages) infos.push(`${b.nb_etages} étage(s)`);
      if (b.occupation) infos.push(`occupation : ${b.occupation}`);
      if (infos.length) {
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text(infos.join(' · '));
      }
      const infos2 = [];
      if (b.valeur_batiment) infos2.push(`valeur : ${b.valeur_batiment_libelle}`);
      infos2.push(`gicleurs : ${b.gicleurs_libelle}`);
      if (b.distance_caserne_km) infos2.push(`caserne à ${b.distance_caserne_km} km`);
      if (b.chauffage) infos2.push(`chauffage : ${b.chauffage}`);
      if (b.annee_toiture) infos2.push(`toiture ${b.annee_toiture}`);
      doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text(infos2.join(' · '));
      if (b.notes) {
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIS).text(`Notes : ${b.notes}`);
      }
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR).text('Garanties demandées :');
      const g = b.garanties;
      if (g) {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS)
          .text(`Formule : ${g.formule_libelle}`);
        doc.font('Helvetica').fontSize(10).fillColor(GRIS)
          .text(`Montant d’assurance : ${g.montant_assurance_libelle} — franchise : ${g.franchise_libelle}`);
        if (g.prime) {
          doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(`Prime : ${g.prime_libelle}`);
        }
        if (g.avenants_libelles && g.avenants_libelles.length) {
          doc.font('Helvetica').fontSize(10).fillColor(GRIS)
            .text('Avenants : ' + g.avenants_libelles.join(', '));
        }
      } else {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS).text('Non définies.');
      }
      const conts = b.contenus || [];
      if (conts.length) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR).text('Contenus du bâtiment :');
        conts.forEach((x) => {
          doc.font('Helvetica').fontSize(10).fillColor(GRIS)
            .text(`• ${x.description || 'Contenu'} (${x.type_contenu_libelle}) — ${x.valeur_libelle}`
              + (x.notes ? ` — ${x.notes}` : ''));
        });
      }
      saut(6);
    });

    // --- 3. Contenus généraux ----------------------------------------------
    const cg = d.contenusGeneraux || [];
    if (cg.length) {
      titreSection(`3. Contenus généraux (${cg.length})`);
      cg.forEach((x) => {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS)
          .text(`• ${x.description || 'Contenu'} (${x.type_contenu_libelle}) — ${x.valeur_libelle}`
            + (x.notes ? ` — ${x.notes}` : ''));
      });
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
      const sins = a.sinistres_5ans || [];
      ligne('Sinistres (5 ans)',
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
      `Document généré le ${d.genereLe} à partir de la soumission biens #${d.soumissionId} (version v${d.versionNumero}${d.versionFigee ? ', figée' : ''}) — vérifiez avant envoi à l’assureur.`
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

module.exports = { genererPropositionBiensPdf };
