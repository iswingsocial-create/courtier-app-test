/**
 * lib/proposition-cautionnement-pdf.js — Génération du PDF de la proposition
 * de cautionnement pré-remplie (cautionnement — étape 7/10).
 * Même contenu que la page HTML (views/cautionnement/proposition.ejs), mis en
 * page avec pdfkit (pur JS, sans binaire). Les données viennent de
 * lib/proposition-cautionnement.js (source unique). Le PDF n'est PAS
 * compressé : le texte reste lisible dans le flux.
 * Miroir de lib/proposition-flotte-pdf.js (étape 7/10 flotte).
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

function genererPropositionCautPdf(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 48, bottom: 56, left: 52, right: 52 },
      compress: false, // texte en clair dans le flux : traçabilité (règle d'or)
      info: {
        Title: `Proposition de cautionnement — Soumission cautionnement #${d.soumissionId}`,
        Author: d.cabinetNom,
        Subject: 'Cautionnement / sûreté (Québec)',
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
      .text('Proposition de cautionnement', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor(GRIS)
      .text('Formulaire de proposition — Cautionnement / sûreté (Québec)', { align: 'center' });
    saut(4);
    doc.font('Helvetica').fontSize(10).fillColor(NOIR)
      .text(`Soumission cautionnement #${d.soumissionId} — version v${d.versionNumero}${d.versionFigee ? ' (figée)' : ''}`, { align: 'center' });
    if (d.dateEffet) {
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Date d’effet souhaitée : ${d.dateEffet}`, { align: 'center' });
    }

    // --- 1. Principal / proposant -------------------------------------------
    titreSection('1. Principal (débiteur) / proposant');
    const c = d.client || {};
    const e = d.entete || {};
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
    if (e.secteur_activite) ligne('Secteur d’activité', e.secteur_activite);
    if (e.annee_fondation) ligne('Année de fondation', e.annee_fondation);
    ligne('Chiffre d’affaires annuel', e.chiffre_affaires_libelle);
    if (e.nb_employes !== null && e.nb_employes !== undefined) ligne('Nombre d’employés', e.nb_employes);
    if (e.assureur) ligne('Caution visée', e.assureur);
    if (e.date_echeance_visee) ligne('Date d’échéance visée', e.date_echeance_visee);
    if (d.notes) { saut(2); ligne('Notes', d.notes); }

    // --- 2. Résumé des cautionnements demandés -------------------------------
    titreSection('2. Résumé des cautionnements demandés');
    const r = d.resume;
    ligne('Obligations détaillées', r.nbObligations);
    ligne('Somme des cautionnements', r.sommeCautionnements_libelle);
    if (r.typesLibelles.length) ligne('Types demandés', r.typesLibelles.join(', '));
    ligne('Utilisation de la capacité', r.utilisation_libelle);

    // --- 3. Obligations -------------------------------------------------------
    titreSection(`3. Obligations — cautionnements demandés (${d.obligations.length})`);
    if (!d.obligations.length) {
      paragraphe('Aucune obligation saisie.');
    } else {
      enteteTableau([
        { x: 0, largeur: 150, texte: 'Type' },
        { x: 154, largeur: 130, texte: 'Bénéficiaire' },
        { x: 288, largeur: 100, texte: 'Contrat', align: 'right' },
        { x: 392, largeur: 116, texte: 'Cautionnement', align: 'right' },
      ]);
      d.obligations.forEach((x) => {
        if (doc.y > doc.page.height - 110) doc.addPage();
        ligneTableau([
          { x: 0, largeur: 150, texte: x.type_libelle, gras: true, couleur: NOIR },
          { x: 154, largeur: 130, texte: x.beneficiaire || TIRET },
          { x: 288, largeur: 100, texte: x.montant_contrat_libelle, align: 'right' },
          { x: 392, largeur: 116, texte: x.montant_cautionnement_libelle, align: 'right' },
        ]);
        const details = [
          x.description_projet ? `Projet : ${x.description_projet}` : null,
          x.part_contrat_libelle,
          (x.taux_libelle && x.taux_libelle !== TIRET) ? `Taux : ${x.taux_libelle}` : null,
          (x.prime_estimee_libelle && x.prime_estimee_libelle !== TIRET) ? `Prime estimée : ${x.prime_estimee_libelle}` : null,
          x.date_debut ? `Début : ${x.date_debut}` : null,
          (x.duree_libelle && x.duree_libelle !== TIRET) ? `Durée : ${x.duree_libelle}` : null,
        ].filter(Boolean);
        if (details.length) {
          doc.font('Helvetica').fontSize(9).fillColor(GRIS)
            .text(details.join(' — '), gauche + 8, doc.y, { width: largeur - 8 });
          doc.y += 3;
          doc.x = gauche;
        }
      });
    }

    // --- 4. Ligne de cautionnement ---------------------------------------------
    titreSection('4. Ligne de cautionnement (capacité)');
    const g = d.ligne;
    if (!g) {
      paragraphe('Non définie.');
    } else {
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Limite globale (capacité totale) : ${g.limite_globale_libelle}`);
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Limite par projet : ${g.limite_par_projet_libelle}`);
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Fonds de roulement : ${g.fonds_roulement_libelle}`);
      doc.font('Helvetica').fontSize(10).fillColor(GRIS)
        .text(`Valeur nette : ${g.valeur_nette_libelle}`);
      if (g.prime && g.prime_libelle !== TIRET) {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(`Prime de la ligne : ${g.prime_libelle}`);
      }
    }
    mentionImportante(d.mentionMetier);

    // --- 5. Antécédents de cautionnement ---------------------------------------
    titreSection('5. Antécédents de cautionnement');
    const a = d.antecedents;
    if (!a) {
      paragraphe('Non renseignés.');
    } else {
      if (a.assureur_actuel) ligne('Caution actuelle', a.assureur_actuel);
      if (a.numero_ligne_actuelle) ligne('Ligne actuelle', a.numero_ligne_actuelle);
      if (a.date_expiration_actuelle) ligne('Expiration de la ligne actuelle', a.date_expiration_actuelle);
      if (a.annees_cautionnement_continu) ligne('Années de cautionnement continu', a.annees_cautionnement_continu);
      ligne('Réclamations contre cautionnements (5 ans)',
        (a.reclamations_libelles && a.reclamations_libelles.length)
          ? a.reclamations_libelles.join(' ; ')
          : 'Aucune');
      if (a.refus_resiliation_ant) {
        ligne('Refus ou résiliation antérieur', a.refus_resiliation_details || 'Oui');
      }
    }

    // --- 6. Consentements --------------------------------------------------------
    titreSection('6. Consentements');
    if (d.consentementsLibelles.length) {
      d.consentementsLibelles.forEach((lib) => {
        doc.font('Helvetica').fontSize(10).fillColor(GRIS).text('☑ ' + lib);
      });
    } else {
      paragraphe('Aucun consentement enregistré.');
    }

    // --- Pied + signatures ---------------------------------------------------------
    saut(10);
    if (doc.y > doc.page.height - 150) doc.addPage();
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRIS).text(
      `Document généré le ${d.genereLe} à partir de la soumission cautionnement #${d.soumissionId} (version v${d.versionNumero}${d.versionFigee ? ', figée' : ''}) — proposition conforme à la version figée, vérifiez avant envoi à la caution.`
    );
    saut(12);
    const y0 = doc.y;
    const colW = largeur / 2 - 12;
    doc.font('Helvetica').fontSize(10).fillColor(NOIR).text('Signature du principal', gauche, y0);
    doc.font('Helvetica').fontSize(10).fillColor(NOIR).text('Signature du courtier', gauche + colW + 24, y0);
    doc.moveTo(gauche, y0 + 44).lineTo(gauche + colW, y0 + 44).strokeColor(GRIS).stroke();
    doc.moveTo(gauche + colW + 24, y0 + 44).lineTo(gauche + largeur, y0 + 44).strokeColor(GRIS).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(GRIS).text('Date : _______________', gauche, y0 + 50);
    doc.font('Helvetica').fontSize(9).fillColor(GRIS).text('Date : _______________', gauche + colW + 24, y0 + 50);

    doc.end();
  });
}

module.exports = { genererPropositionCautPdf };
