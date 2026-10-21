/**
 * lib/extraction-document.js — Extraction du texte d'un document téléversé
 * (module « Analyse de documents IA »).
 *
 *  - PDF électronique : texte natif (pdf-parse, 100 % local).
 *  - Images / scans (PNG, JPEG) : OCR local français (tesseract.js + données
 *    `fra` embarquées dans lib/ocr-data/) — AUCUNE donnée ne sort du serveur.
 *  - Word (.docx) / Excel (.xlsx) : extraction simple du texte XML contenu
 *    dans le zip (lecture locale, sans dépendance externe).
 *  - Autres formats acceptés au téléversement (.doc, .xls binaires) :
 *    extraction limitée, signalée honnêtement (texte vide + avertissement).
 *
 * Retourne toujours { texte, methode, avertissement } sans lancer d'exception
 * pour un format illisible : l'échec d'extraction est un résultat, pas un crash.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DOSSIER_OCR = path.join(__dirname, 'ocr-data');

// --- PDF (texte natif) --------------------------------------------------------
async function extrairePdf(tampon) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: tampon });
  try {
    const res = await parser.getText();
    // pdf-parse ajoute des marqueurs « -- N of M -- » : on les retire.
    const texte = String(res.text || '')
      .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { texte, methode: 'pdf', avertissement: texte ? null : "Aucun texte natif dans ce PDF : c'est probablement un document numérisé. Téléversez-le en image (PNG/JPEG) pour passer par l'OCR." };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

// --- OCR local (tesseract.js, données françaises embarquées) --------------------
let ouvrierOcr = null;
async function extraireImage(cheminFichier) {
  const { createWorker } = require('tesseract.js');
  if (!ouvrierOcr) {
    ouvrierOcr = await createWorker('fra', 1, {
      langPath: DOSSIER_OCR,
      gzip: true,
      cacheMethod: 'none',
      logger: () => {},
    });
  }
  const { data } = await ouvrierOcr.recognize(cheminFichier);
  const texte = String(data.text || '').replace(/\n{3,}/g, '\n\n').trim();
  return {
    texte,
    methode: 'ocr',
    avertissement: texte ? null : "L'OCR n'a reconnu aucun texte : image trop floue, trop sombre ou sans texte lisible.",
  };
}

// --- Lecture minimale d'un zip (docx/xlsx) --------------------------------------
function lireEntreeZip(tampon, nomEntree) {
  // Cherche le répertoire central (EOCD) à la fin du fichier.
  let eocd = -1;
  for (let i = tampon.length - 22; i >= Math.max(0, tampon.length - 66000); i--) {
    if (tampon.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Archive zip illisible');
  const nb = tampon.readUInt16LE(eocd + 10);
  let pos = tampon.readUInt32LE(eocd + 16);
  for (let n = 0; n < nb; n++) {
    if (tampon.readUInt32LE(pos) !== 0x02014b50) break;
    const methode = tampon.readUInt16LE(pos + 10);
    const tailleComp = tampon.readUInt32LE(pos + 20);
    const lenNom = tampon.readUInt16LE(pos + 28);
    const lenExtra = tampon.readUInt16LE(pos + 30);
    const lenComment = tampon.readUInt16LE(pos + 32);
    const decalageLocal = tampon.readUInt32LE(pos + 42);
    const nom = tampon.toString('utf8', pos + 46, pos + 46 + lenNom);
    if (nom === nomEntree) {
      const lLenNom = tampon.readUInt16LE(decalageLocal + 26);
      const lLenExtra = tampon.readUInt16LE(decalageLocal + 28);
      const debut = decalageLocal + 30 + lLenNom + lLenExtra;
      const donnees = tampon.subarray(debut, debut + tailleComp);
      if (methode === 0) return Buffer.from(donnees);
      if (methode === 8) return zlib.inflateRawSync(donnees);
      throw new Error(`Compression zip non prise en charge (${methode})`);
    }
    pos += 46 + lenNom + lenExtra + lenComment;
  }
  return null;
}

function xmlVersTexte(xml) {
  return String(xml)
    .replace(/<w:p[ >][\s\S]*?(?=<w:p[ >]|$)/g, (m) => m) // paragraphes : gérés ci-dessous
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/row>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extraireDocx(tampon) {
  const xml = lireEntreeZip(tampon, 'word/document.xml');
  if (!xml) throw new Error('word/document.xml introuvable');
  return { texte: xmlVersTexte(xml.toString('utf8')), methode: 'docx', avertissement: null };
}

function extraireXlsx(tampon) {
  const chaines = lireEntreeZip(tampon, 'xl/sharedStrings.xml');
  let texte = '';
  if (chaines) {
    const items = [...chaines.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => xmlVersTexte(m[1]));
    texte = items.join('\n');
  }
  if (!texte) {
    const feuille = lireEntreeZip(tampon, 'xl/worksheets/sheet1.xml');
    if (feuille) texte = xmlVersTexte(feuille.toString('utf8'));
  }
  return {
    texte: texte.trim(), methode: 'xlsx',
    avertissement: texte ? null : "Aucune chaîne lisible dans ce classeur (extraction Excel simple : valeurs en texte seulement).",
  };
}

// --- Lecture tabulaire (v2) : conserver la structure { colonnes, lignes } -------
// L'analyse d'un tableur (permis, véhicules...) a besoin de la GRILLE, pas
// d'un texte aplati : la première ligne non vide = en-têtes, les suivantes =
// données. Feuille 1 seulement (les classeurs clients sont simples).
function indiceColonne(ref) {
  const m = String(ref || '').match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function grilleDepuisXlsx(tampon) {
  const feuille = lireEntreeZip(tampon, 'xl/worksheets/sheet1.xml');
  if (!feuille) return null;
  let partagees = [];
  const chaines = lireEntreeZip(tampon, 'xl/sharedStrings.xml');
  if (chaines) {
    partagees = [...chaines.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => xmlVersTexte(m[1]));
  }
  const xml = feuille.toString('utf8');
  const grille = [];
  for (const ligneM of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cellules = [];
    for (const celM of ligneM[1].matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = celM[1] || '';
      const corps = celM[2] || '';
      const refM = attrs.match(/r="([A-Z]+\d+)"/);
      const idx = refM ? indiceColonne(refM[1]) : cellules.length;
      const typeM = attrs.match(/t="(\w+)"/);
      let valeur = '';
      if (typeM && typeM[1] === 's') {
        const vM = corps.match(/<v>([\s\S]*?)<\/v>/);
        valeur = vM ? (partagees[Number(vM[1])] ?? '') : '';
      } else if (typeM && typeM[1] === 'inlineStr') {
        valeur = xmlVersTexte(corps);
      } else {
        const vM = corps.match(/<v>([\s\S]*?)<\/v>/);
        valeur = vM ? vM[1].trim() : '';
      }
      while (cellules.length < idx) cellules.push('');
      cellules[idx] = valeur;
    }
    grille.push(cellules);
  }
  return grilleVersTableau(grille);
}

function grilleVersTableau(grille) {
  const propres = (grille || []).filter((l) => l.some((c) => String(c ?? '').trim() !== ''));
  if (propres.length < 2) return null;
  const largeur = Math.max(...propres.map((l) => l.length));
  const norm = propres.map((l) => {
    const copie = l.map((c) => String(c ?? '').trim());
    while (copie.length < largeur) copie.push('');
    return copie;
  });
  return { colonnes: norm[0], lignes: norm.slice(1) };
}

function tableauDepuisCsv(texteCsv) {
  const { parse } = require('csv-parse/sync');
  const premiere = String(texteCsv).split(/\r?\n/).find((l) => l.trim()) || '';
  const delimiteur = [';', ',', '\t'].reduce((best, d) =>
    (premiere.split(d).length > premiere.split(best).length ? d : best), ';');
  const enregistrements = parse(texteCsv, {
    bom: true, delimiter: delimiteur, relax_column_count: true,
    skip_empty_lines: true, trim: true,
  });
  return grilleVersTableau(enregistrements);
}

/**
 * Extrait la structure tabulaire d'un fichier tableur (.xlsx / .csv).
 * @returns {{colonnes: string[], lignes: string[][]} | null}
 */
function extraireTableau({ chemin, nom }) {
  try {
    const tampon = fs.readFileSync(chemin);
    const nomBas = String(nom || '').toLowerCase();
    if (nomBas.endsWith('.xlsx')) return grilleDepuisXlsx(tampon);
    if (nomBas.endsWith('.csv')) return tableauDepuisCsv(tampon.toString('utf8'));
    return null;
  } catch (e) {
    return null;
  }
}

// --- Point d'entrée --------------------------------------------------------------
/**
 * @param {{chemin: string, mime: string, nom: string}} f
 * @returns {Promise<{texte: string, methode: string, avertissement: string|null}>}
 */
async function extraireTexte(f) {
  const nom = String(f.nom || '').toLowerCase();
  const mime = String(f.mime || '');
  try {
    if (mime === 'application/pdf' || nom.endsWith('.pdf')) {
      return await extrairePdf(fs.readFileSync(f.chemin));
    }
    if (mime.startsWith('image/') || /\.(png|jpe?g)$/.test(nom)) {
      return await extraireImage(f.chemin);
    }
    if (nom.endsWith('.docx') || mime.includes('wordprocessingml')) {
      return extraireDocx(fs.readFileSync(f.chemin));
    }
    if (nom.endsWith('.xlsx') || mime.includes('spreadsheetml')) {
      const tampon = fs.readFileSync(f.chemin);
      const r = extraireXlsx(tampon);
      const tableau = grilleDepuisXlsx(tampon);
      if (tableau) {
        // Texte aplati fidèle à la grille (une ligne du tableur par ligne).
        r.texte = [tableau.colonnes, ...tableau.lignes]
          .map((l) => l.join(' ; ')).join('\n');
        r.tableau = tableau;
      }
      return r;
    }
    if (nom.endsWith('.csv') || mime.includes('csv')) {
      const tableau = tableauDepuisCsv(fs.readFileSync(f.chemin).toString('utf8'));
      if (!tableau) {
        return {
          texte: '', methode: 'csv', tableau: null,
          avertissement: "Tableur illisible : aucune ligne de données sous les en-têtes.",
        };
      }
      return {
        texte: [tableau.colonnes, ...tableau.lignes].map((l) => l.join(' ; ')).join('\n'),
        methode: 'csv', tableau,
        avertissement: null,
      };
    }
    return {
      texte: '', methode: 'aucune',
      avertissement: 'Format accepté mais extraction limitée : les anciens formats binaires (.doc, .xls) ne sont pas lus. Convertissez le document en PDF, Word (.docx) ou image pour une analyse complète.',
    };
  } catch (e) {
    return {
      texte: '', methode: 'aucune',
      avertissement: `Extraction impossible : ${e.message}. Le document reste conservé ; vous pouvez le consulter ou le retéléverser dans un autre format.`,
    };
  }
}

module.exports = { extraireTexte, extraireTableau };
