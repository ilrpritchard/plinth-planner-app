// xlsx.test.js — the minimal XLSX writer (zip structure, CRC-32, cell XML)
// and the trade workbook builder (sheet shapes + totals match cost.js maths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, colRef, escXML, buildZip, buildXlsx } from '../src/core/xlsxmini.js';
import { buildTradeWorkbook, unitFindings } from '../src/core/tradebook.js';
import { genShareToken } from '../src/core/tradecloud.js';
import { Store } from '../src/core/store.js';
import { tradeSummary, summarizeState, unitQty } from '../src/core/cost.js';
import { planPhases } from '../src/core/phasing.js';

const enc = new TextEncoder();

// ---- CRC-32 -----------------------------------------------------------------

test('crc32 known vector: "123456789" → 0xCBF43926', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xCBF43926);
});

test('crc32 empty input → 0', () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
});

// ---- helpers ----------------------------------------------------------------

test('colRef letters', () => {
  assert.equal(colRef(0), 'A');
  assert.equal(colRef(25), 'Z');
  assert.equal(colRef(26), 'AA');
  assert.equal(colRef(27), 'AB');
  assert.equal(colRef(701), 'ZZ');
  assert.equal(colRef(702), 'AAA');
});

test('escXML escapes the five', () => {
  assert.equal(escXML(`<&>"'`), '&lt;&amp;&gt;&quot;&apos;');
});

// ---- ZIP structure ------------------------------------------------------------

/** Tiny central-directory reader: EOCD → entries [{name, crc, size, offset}]. */
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD is the last 22 bytes (we write no comment)
  const e = bytes.length - 22;
  assert.equal(dv.getUint32(e, true), 0x06054B50, 'EOCD signature');
  const count = dv.getUint16(e + 10, true);
  const cdOff = dv.getUint32(e + 16, true);
  const cdSize = dv.getUint32(e + 12, true);
  assert.equal(cdOff + cdSize, e, 'central directory ends at EOCD');
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014B50, 'central header signature');
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    entries.push({
      crc: dv.getUint32(p + 16, true),
      size: dv.getUint32(p + 24, true),
      offset: dv.getUint32(p + 42, true),
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test('buildZip writes STORED entries with correct signatures + CRCs', () => {
  const files = [
    { name: 'a.txt', data: enc.encode('hello') },
    { name: 'dir/b.txt', data: enc.encode('world!') },
  ];
  const zip = buildZip(files);
  assert.equal(zip[0], 0x50); assert.equal(zip[1], 0x4B);
  assert.equal(zip[2], 0x03); assert.equal(zip[3], 0x04);   // PK\x03\x04
  const entries = readZip(zip);
  assert.equal(entries.length, 2);
  for (const [i, ent] of entries.entries()) {
    assert.equal(ent.name, files[i].name);
    assert.equal(ent.size, files[i].data.length);
    assert.equal(ent.crc, crc32(files[i].data));
    // local header at the recorded offset, and the data matches
    const dv = new DataView(zip.buffer);
    assert.equal(dv.getUint32(ent.offset, true), 0x04034B50, 'local header signature');
    const nameLen = dv.getUint16(ent.offset + 26, true);
    const data = zip.subarray(ent.offset + 30 + nameLen, ent.offset + 30 + nameLen + ent.size);
    assert.equal(crc32(data), ent.crc);
  }
});

// ---- buildXlsx ---------------------------------------------------------------

test('buildXlsx produces a zip with every required OOXML part', () => {
  const bytes = buildXlsx([
    { name: 'One', rows: [[{ v: 'H', bold: true }, 1], ['x', { v: 2.5, cur: true }]] },
    { name: 'Two', rows: [['only']] },
  ]);
  const names = readZip(bytes).map((e) => e.name);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
    'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.ok(names.includes(part), `missing ${part}`);
  }
  assert.equal(names.length, 7);
});

test('sheet XML: numbers as t="n", strings inline, bold/currency styles, widths', () => {
  const bytes = buildXlsx([{
    name: 'S', widths: [18, 9],
    rows: [[{ v: 'Head', bold: true }, { v: 12.5, cur: true }], ['a<b', 3]],
  }]);
  const entries = readZip(bytes);
  const sheet = entries.find((e) => e.name === 'xl/worksheets/sheet1.xml');
  const dv = new DataView(bytes.buffer);
  const nameLen = dv.getUint16(sheet.offset + 26, true);
  const xml = new TextDecoder().decode(
    bytes.subarray(sheet.offset + 30 + nameLen, sheet.offset + 30 + nameLen + sheet.size));
  assert.ok(xml.includes('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Head</t></is></c>'), 'bold header cell');
  assert.ok(xml.includes('<c r="B1" s="2" t="n"><v>12.5</v></c>'), 'currency number cell');
  assert.ok(xml.includes('a&lt;b'), 'XML-escaped string');
  assert.ok(xml.includes('<c r="B2" t="n"><v>3</v></c>'), 'plain number cell');
  assert.ok(xml.includes('<col min="1" max="1" width="18" customWidth="1"/>'), 'column widths');
});

test('sheet names are sanitised, truncated to 31 chars, and deduped', () => {
  const bytes = buildXlsx([
    { name: 'Bad[name]:with/illegal*chars? and far far too long to fit', rows: [] },
    { name: 'Bad[name]:with/illegal*chars? and far far too long to fit', rows: [] },
  ]);
  const wb = readZip(bytes).find((e) => e.name === 'xl/workbook.xml');
  const dv = new DataView(bytes.buffer);
  const nameLen = dv.getUint16(wb.offset + 26, true);
  const xml = new TextDecoder().decode(bytes.subarray(wb.offset + 30 + nameLen, wb.offset + 30 + nameLen + wb.size));
  const names = [...xml.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(names.length, 2);
  assert.notEqual(names[0], names[1]);
  for (const n of names) {
    assert.ok(n.length <= 31, `sheet name too long: ${n}`);
    assert.ok(!/[\\/?*[\]:]/.test(n), `illegal chars remain: ${n}`);
  }
});

// ---- trade workbook ------------------------------------------------------------

function demoDesign() {
  const s = new Store();
  s.setRoom({ width: 240, depth: 180, height: 96 });
  const minZ = -90;
  let x = -120;
  for (const code of ['T3', 'F18', 'AP2', 'F20']) {
    const w = { T3: 24, F18: 24, AP2: 36, F20: 36 }[code];
    s.addItem(code, { x: x + w / 2, z: minZ + (code === 'AP2' ? 13 : 12) + 0.25 });
    x += w;
  }
  s.addItem('W2', { x: -96, z: minZ + 7 + 0.25 });
  const d = s.serialize();
  d.mode = 'home';
  delete d.trade;
  return d;
}

const demoTrade = {
  project: 'Hudson Tower', finish: 'Ghost', nextUnitId: 3, nextRowId: 10,
  phasing: { on: true, maxPerBatch: 12 },
  units: [
    { id: 1, beds: '1 Bed', letter: 'A', name: '', qty: 0, floorFrom: 1, floorTo: 8, perFloor: 3,
      rows: [{ id: 1, code: 'F2', qty: 5 }, { id: 2, code: 'W2', qty: 3 }], design: demoDesign(), rev: 'B' },
    { id: 2, beds: '2 Bed', letter: 'B', name: 'Sky deluxe', qty: 6, floorFrom: '', floorTo: '', perFloor: '',
      rows: [{ id: 3, code: 'F10', qty: 2 }, { id: 4, code: 'AP2', qty: 1 }] },
  ],
};

const FIXED_NOW = Date.UTC(2026, 6, 8);

test('workbook: sheet set = Summary + one per designed unit + Order + Phasing', () => {
  const sheets = buildTradeWorkbook(demoTrade, FIXED_NOW);
  assert.deepEqual(sheets.map((s) => s.name),
    ['Summary', 'Unit 1 Bed Type A', 'Order', 'Phasing']);
});

test('workbook: Summary totals match tradeSummary (incl. shipping)', () => {
  const sheets = buildTradeWorkbook(demoTrade, FIXED_NOW);
  const sum = sheets[0];
  const s = tradeSummary(demoTrade);
  const flat = sum.rows.map((r) => r.map((c) => (c && typeof c === 'object' ? c.v : c)));
  assert.deepEqual(flat[2], ['Project', 'Hudson Tower']);
  assert.deepEqual(flat[6], ['Unit type', 'Cab/unit', 'Units', 'Cabinets', 'Sub-total']);
  assert.equal(flat[6 + s.lines.length + 2][1], s.totalUnits, 'Units total');
  assert.equal(flat[6 + s.lines.length + 3][1], s.totalCabs, 'Cabinets total');
  assert.equal(flat[6 + s.lines.length + 4][1], s.containers, 'Containers');
  assert.equal(flat[6 + s.lines.length + 5][1], s.subtotal, 'Cabinets subtotal');
  // an indicative volume-tier row appears between subtotal and shipping at 10+ units
  const off = s.tier ? 1 : 0;
  if (s.tier) assert.equal(flat[6 + s.lines.length + 6][1], -s.discount, 'Volume tier discount');
  assert.equal(flat[6 + s.lines.length + 6 + off][1], s.shipping, 'Shipping');
  const grandRow = flat[6 + s.lines.length + 7 + off];
  assert.equal(grandRow[0], 'Order total (incl. shipping)');
  assert.equal(grandRow[1], s.grand, 'grand total = subtotal - discount + shipping');
  // header + one line per unit type
  assert.equal(s.lines.length, 2);
});

test('workbook: unit sheet carries priced design rows + per-unit subtotal', () => {
  const sheets = buildTradeWorkbook(demoTrade, FIXED_NOW);
  const unit = sheets[1];
  const u = demoTrade.units[0];
  const sum = summarizeState(u.design);
  const flat = unit.rows.map((r) => r.map((c) => (c && typeof c === 'object' ? c.v : c)));
  assert.equal(flat[0][0], 'Unit 1 Bed Type A — Rev B');
  assert.deepEqual(flat[2], ['Code', 'Description', 'Qty', 'Size (W × D × H)', 'Each', 'Line']);
  // one row per priced line, then blank + subtotal + units + extended
  assert.equal(unit.rows.length, 3 + sum.lines.length + 4);
  const subRow = flat[3 + sum.lines.length + 1];
  assert.equal(subRow[0], 'Subtotal (per unit)');
  assert.equal(subRow[5], sum.subtotal);
  const extRow = flat[3 + sum.lines.length + 3];
  assert.equal(extRow[5], sum.subtotal * unitQty(u));
});

test('workbook: Order sheet has PO field, flattened lines, totals + spec notes', () => {
  const sheets = buildTradeWorkbook(demoTrade, FIXED_NOW);
  const order = sheets.find((s) => s.name === 'Order');
  const flat = order.rows.map((r) => r.map((c) => (c && typeof c === 'object' ? c.v : c)));
  assert.equal(flat[1][0], 'PO number');
  assert.equal(flat[1][1] ?? '', '', 'PO cell left blank to fill in');
  assert.equal(flat[3][0], 'Unit type');
  assert.equal(flat[3][11], 'Line total');
  const s = tradeSummary(demoTrade);
  // supplied line count: F2, W2, F10 (AP2 is an appliance, not supplied)
  const lineRows = flat.slice(4).filter((r) => r[2] && typeof r[9] === 'number');
  assert.equal(lineRows.length, 3);
  for (const r of lineRows) assert.equal(r[9], r[7] * r[8], 'total qty = per-unit × units');
  const grand = flat.find((r) => r[0] === 'ORDER TOTAL');
  assert.equal(grand[11], s.grand);
  const subtotal = flat.find((r) => r[0] === 'CABINETS SUBTOTAL');
  assert.equal(subtotal[9], s.totalCabs);
  assert.equal(subtotal[11], s.subtotal);
  assert.ok(flat.some((r) => r[0] === 'SPEC CHECK — notes'));
  const findings = demoTrade.units.flatMap((u) => unitFindings(u));
  const noteRows = flat.slice(flat.findIndex((r) => r[0] === 'SPEC CHECK — notes') + 1);
  assert.equal(noteRows.length, Math.max(findings.length, 1));
});

test('workbook: Phasing sheet mirrors planPhases; dropped when phasing is off', () => {
  const sheets = buildTradeWorkbook(demoTrade, FIXED_NOW);
  const ph = sheets.find((s) => s.name === 'Phasing');
  const plan = planPhases(demoTrade, { maxUnitsPerBatch: 12 });
  assert.equal(ph.rows.length, 3 + plan.batches.length);
  const flat = ph.rows.map((r) => r.map((c) => (c && typeof c === 'object' ? c.v : c)));
  assert.equal(flat[2][0], 'Phase');
  assert.equal(flat[3][0], 'Phase 1');
  assert.equal(flat[3][3], plan.batches[0].units);
  assert.equal(flat[3][4], plan.batches[0].cabinets);
  assert.match(String(flat[3][5]), /\d{4}/, 'dated delivery window');
  const off = buildTradeWorkbook({ ...demoTrade, phasing: { on: false } }, FIXED_NOW);
  assert.ok(!off.some((s) => s.name === 'Phasing'));
});

test('workbook bytes: whole pipeline zips into a well-formed xlsx', () => {
  const bytes = buildXlsx(buildTradeWorkbook(demoTrade, FIXED_NOW));
  const entries = readZip(bytes);
  assert.equal(entries.length, 5 + 4);   // 5 fixed parts + 4 sheets
  for (const e of entries) {
    const dv = new DataView(bytes.buffer);
    const nameLen = dv.getUint16(e.offset + 26, true);
    const data = bytes.subarray(e.offset + 30 + nameLen, e.offset + 30 + nameLen + e.size);
    assert.equal(crc32(data), e.crc, `CRC mismatch in ${e.name}`);
  }
});

// ---- share tokens ---------------------------------------------------------------

test('genShareToken: 24+ url-safe chars, unique', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = genShareToken();
    assert.ok(t.length >= 24, `too short: ${t}`);
    assert.match(t, /^[A-Za-z0-9]+$/);
    seen.add(t);
  }
  assert.equal(seen.size, 200, 'tokens collide');
});
