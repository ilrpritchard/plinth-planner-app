// xlsxmini.js — a tiny, dependency-free Office Open XML (.xlsx) writer.
// Pure: works in the browser AND under node (tests). No compression — every
// ZIP entry is STORED, so all we need is local file headers, a central
// directory, the end-of-central-directory record, and CRC-32.
//
//   buildXlsx([{ name, rows: [[cell, …], …], widths?: [n, …] }]) → Uint8Array
//
// Cells: numbers become <c t="n">, strings become inline strings; a cell can
// also be { v, bold?, cur? } to pick a style (bold header / $ currency).
// Empty string / null / undefined cells are skipped.

// ---------- CRC-32 (standard table-based, poly 0xEDB88320) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- XML helpers ----------
export function escXML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

/** 0-based column index → spreadsheet letters (0→A, 25→Z, 26→AA …). */
export function colRef(n) {
  let s = '';
  n = Math.floor(n);
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

// style indexes in xl/styles.xml cellXfs below
const XF_PLAIN = 0, XF_BOLD = 1, XF_CUR = 2, XF_BOLD_CUR = 3;

function cellXML(rowN, colN, cell) {
  let v = cell, bold = false, cur = false;
  if (cell && typeof cell === 'object') { v = cell.v; bold = !!cell.bold; cur = !!cell.cur; }
  if (v == null || v === '') return '';
  const ref = colRef(colN) + rowN;
  const s = bold && cur ? XF_BOLD_CUR : bold ? XF_BOLD : cur ? XF_CUR : XF_PLAIN;
  const sAttr = s ? ` s="${s}"` : '';
  if (typeof v === 'number' && isFinite(v)) {
    return `<c r="${ref}"${sAttr} t="n"><v>${v}</v></c>`;
  }
  if (typeof v === 'boolean') {
    return `<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
  }
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escXML(v)}</t></is></c>`;
}

function sheetXML(sheet) {
  const rows = sheet.rows || [];
  let cols = '';
  if (Array.isArray(sheet.widths) && sheet.widths.length) {
    cols = '<cols>' + sheet.widths.map((w, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${Number(w) || 10}" customWidth="1"/>`).join('') + '</cols>';
  }
  const body = rows.map((row, ri) => {
    const cells = (row || []).map((c, ci) => cellXML(ri + 1, ci, c)).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    cols + `<sheetData>${body}</sheetData></worksheet>`;
}

/** Excel sheet-name rules: no \\ / ? * [ ] :, max 31 chars, non-empty, unique. */
function safeSheetNames(sheets) {
  const used = new Set();
  return sheets.map((s, i) => {
    let n = String(s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
    n = n.slice(0, 31).trim() || `Sheet${i + 1}`;
    let out = n, k = 2;
    while (used.has(out.toLowerCase())) { const suf = ` ${k++}`; out = n.slice(0, 31 - suf.length) + suf; }
    used.add(out.toLowerCase());
    return out;
  });
}

const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>' +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

// ---------- ZIP writer (STORED entries only) ----------
const enc = new TextEncoder();

function u16(view, off, v) { view.setUint16(off, v & 0xFFFF, true); }
function u32(view, off, v) { view.setUint32(off, v >>> 0, true); }

// fixed timestamp so output is deterministic: 2026-01-01 00:00
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** files = [{ name, data:Uint8Array }] → Uint8Array of a STORED zip. */
export function buildZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const nameB = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new Uint8Array(30 + nameB.length);
    const lv = new DataView(lh.buffer);
    u32(lv, 0, 0x04034B50); u16(lv, 4, 20); u16(lv, 6, 0); u16(lv, 8, 0); // stored
    u16(lv, 10, DOS_TIME); u16(lv, 12, DOS_DATE);
    u32(lv, 14, crc); u32(lv, 18, f.data.length); u32(lv, 22, f.data.length);
    u16(lv, 26, nameB.length); u16(lv, 28, 0);
    lh.set(nameB, 30);
    locals.push(lh, f.data);

    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    u32(cv, 0, 0x02014B50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0); u16(cv, 10, 0);
    u16(cv, 12, DOS_TIME); u16(cv, 14, DOS_DATE);
    u32(cv, 16, crc); u32(cv, 20, f.data.length); u32(cv, 24, f.data.length);
    u16(cv, 28, nameB.length); u16(cv, 30, 0); u16(cv, 32, 0);
    u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0);
    u32(cv, 42, offset);
    ch.set(nameB, 46);
    centrals.push(ch);

    offset += lh.length + f.data.length;
  }
  const cdSize = centrals.reduce((t, c) => t + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  u32(ev, 0, 0x06054B50); u16(ev, 4, 0); u16(ev, 6, 0);
  u16(ev, 8, files.length); u16(ev, 10, files.length);
  u32(ev, 12, cdSize); u32(ev, 16, offset); u16(ev, 20, 0);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) { out.set(part, p); p += part.length; }
  return out;
}

// ---------- the workbook ----------
/**
 * buildXlsx(sheets) → Uint8Array of a valid .xlsx.
 * sheets = [{ name, rows: [[cell, …], …], widths?: [chars, …] }]
 */
export function buildXlsx(sheets) {
  if (!Array.isArray(sheets) || !sheets.length) sheets = [{ name: 'Sheet1', rows: [] }];
  const names = safeSheetNames(sheets);

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    names.map((n, i) => `<sheet name="${escXML(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';

  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  const files = [
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    { name: 'xl/styles.xml', data: enc.encode(STYLES_XML) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXML(s)) })),
  ];
  return buildZip(files);
}
