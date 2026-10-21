/**
 * scripts/fixtures/fabriquer-xlsx.js — Fabrique un VRAI classeur .xlsx
 * minimal (zip + XML Office Open) sans dépendance externe, pour les tests
 * d'analyse tabulaire. Les chaînes passent par sharedStrings.xml, les
 * nombres sont écrits en cellules numériques — comme un Excel de client.
 */
const fs = require('fs');
const zlib = require('zlib');

// CRC32 (table standard IEEE)
const TABLE_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = TABLE_CRC[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipper(entrees) {
  // entrees: [{ nom, donnees: Buffer }] — compression deflate brute (méthode 8)
  const morceaux = [];
  const centraux = [];
  let offset = 0;
  for (const e of entrees) {
    const nomBuf = Buffer.from(e.nom, 'utf8');
    const comp = zlib.deflateRawSync(e.donnees);
    const crc = crc32(e.donnees);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // flag UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.donnees.length, 22);
    local.writeUInt16LE(nomBuf.length, 26);
    morceaux.push(local, nomBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.donnees.length, 24);
    central.writeUInt16LE(nomBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centraux.push(central, nomBuf);
    offset += 30 + nomBuf.length + comp.length;
  }
  const tailleCentral = centraux.reduce((s, b) => s + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entrees.length, 8);
  fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(tailleCentral, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...morceaux, ...centraux, fin]);
}

function echapperXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function lettreColonne(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * @param {string} chemin destination .xlsx
 * @param {{colonnes: string[], lignes: Array<Array<string|number>>}} donnees
 */
function fabriquerXlsx(chemin, { colonnes, lignes }) {
  const chaines = [];
  const indexChaine = new Map();
  const idx = (s) => {
    if (!indexChaine.has(s)) { indexChaine.set(s, chaines.length); chaines.push(s); }
    return indexChaine.get(s);
  };
  const cellule = (valeur, ref) => {
    if (valeur === null || valeur === undefined || valeur === '') return `<c r="${ref}"/>`;
    if (typeof valeur === 'number') return `<c r="${ref}"><v>${valeur}</v></c>`;
    return `<c r="${ref}" t="s"><v>${idx(String(valeur))}</v></c>`;
  };
  const lignesXml = [colonnes, ...lignes].map((ligne, r) => {
    const cellules = ligne.map((v, c) => cellule(v, `${lettreColonne(c)}${r + 1}`)).join('');
    return `<row r="${r + 1}">${cellules}</row>`;
  }).join('');
  // Enregistre les en-têtes dans sharedStrings (déjà fait via cellule()).
  const sharedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${chaines.length}" uniqueCount="${chaines.length}">${chaines.map((s) => `<si><t>${echapperXml(s)}</t></si>`).join('')}</sst>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lignesXml}</sheetData></worksheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Feuil1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const zip = zipper([
    { nom: '[Content_Types].xml', donnees: Buffer.from(contentTypes, 'utf8') },
    { nom: '_rels/.rels', donnees: Buffer.from(rels, 'utf8') },
    { nom: 'xl/workbook.xml', donnees: Buffer.from(workbookXml, 'utf8') },
    { nom: 'xl/_rels/workbook.xml.rels', donnees: Buffer.from(wbRels, 'utf8') },
    { nom: 'xl/worksheets/sheet1.xml', donnees: Buffer.from(sheetXml, 'utf8') },
    { nom: 'xl/sharedStrings.xml', donnees: Buffer.from(sharedXml, 'utf8') },
  ]);
  fs.writeFileSync(chemin, zip);
  return chemin;
}

module.exports = { fabriquerXlsx };
