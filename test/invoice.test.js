// invoice.test.js — pro-forma invoices + the docs hub's pure logic:
// cents maths (deposit + balance MUST sum to the grand total, odd cents to
// the deposit), due-date rules (phased vs not), invoice numbering, the
// snapshot→trade adapter round-trip (CSV/workbook builders accept it), the
// doc-kind constants, and an ASCII-safe smoke test of the invoice HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toCents, fmtCents, splitDeposit, balanceDue, buildInvoiceModel,
  INVOICE_KINDS, DEFAULT_DEPOSIT_PCT, BALANCE_LEAD_DAYS,
} from '../src/core/invoice.js';
import { buildOrderSnapshot, snapshotToTrade, DOC_KINDS, DOC_LABELS } from '../src/core/orders.js';
import { buildInvoiceHTML } from '../src/ui/invoice.js';
import { tradeSummary, unitName } from '../src/core/cost.js';
import { buildTradeOrderCSV } from '../src/core/tradecsv.js';
import { buildTradeWorkbook } from '../src/core/tradebook.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, code: 'F2', qty: 1 }));

const tower = {
  project: 'Hudson Yards Tower', finish: 'Ghost', nextUnitId: 3, nextRowId: 200,
  units: [
    { id: 1, beds: '1 Bed', letter: 'A', name: '', qty: 0, floorFrom: 1, floorTo: 30, perFloor: 4, rows: rows(6), rev: 'C' },
    { id: 2, beds: 'Penthouse', letter: 'B', name: 'PH Grand', qty: 2, floorFrom: '', floorTo: '', perFloor: '', rows: rows(12) },
  ],
  phasing: { on: true, maxPerBatch: 20 },
};

const NOW = Date.UTC(2026, 6, 8);
const snap = buildOrderSnapshot(tower, { now: NOW, orderNo: 'PL-2607-K7WQ', customer: { name: 'Imogen', email: 'i@x.com' } });
const flatSnap = buildOrderSnapshot({ ...tower, phasing: { on: false } }, { now: NOW, orderNo: 'PL-2607-FLAT' });
const row = { id: 'abc-123', order_no: snap.orderNo, status: 'submitted', placed_at: snap.placedAt, data: snap };

// ---- money helpers ------------------------------------------------------------

test('toCents rounds float dollars to integer cents', () => {
  assert.equal(toCents(0), 0);
  assert.equal(toCents(1), 100);
  assert.equal(toCents(100.01), 10001);
  assert.equal(toCents(0.1 + 0.2), 30);            // classic float trap
  assert.equal(toCents(null), 0);
});

test('fmtCents formats cents as USD', () => {
  assert.equal(fmtCents(0), '$0.00');
  assert.equal(fmtCents(5), '$0.05');
  assert.equal(fmtCents(10001), '$100.01');
  assert.equal(fmtCents(123456789), '$1,234,567.89');
});

// ---- the 50/50 split ------------------------------------------------------------

test('splitDeposit: even grand splits exactly in half', () => {
  const { deposit, balance } = splitDeposit(10000);
  assert.equal(deposit, 5000);
  assert.equal(balance, 5000);
});

test('splitDeposit: odd cent goes to the DEPOSIT', () => {
  const { deposit, balance } = splitDeposit(10001);
  assert.equal(deposit, 5001);
  assert.equal(balance, 5000);
});

test('splitDeposit: deposit + balance always equals the grand total', () => {
  for (const g of [0, 1, 99, 100, 10001, 33333, 999999999, 123456787]) {
    for (const pct of [50, 30, 25, 100, 0]) {
      const { deposit, balance } = splitDeposit(g, pct);
      assert.equal(deposit + balance, g, `split of ${g} at ${pct}%`);
      assert.ok(deposit >= 0 && balance >= 0);
    }
  }
});

// ---- due dates -------------------------------------------------------------------

test('balance due: phased order → 14 days before the Phase 1 window opens', () => {
  assert.ok(snap.phases.length >= 1, 'tower snapshot should be phased');
  const due = balanceDue(snap);
  const expected = Date.parse(snap.phases[0].window.from) - BALANCE_LEAD_DAYS * 24 * 3600 * 1000;
  assert.equal(due.date, new Date(expected).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  assert.match(due.label, /14 days before the Phase 1 delivery window/);
});

test('balance due: unphased order → on notice, no fixed date', () => {
  const due = balanceDue(flatSnap);
  assert.equal(due.date, null);
  assert.match(due.label, /on notice/i);
});

// ---- the invoice model -------------------------------------------------------------

test('invoice numbering: order suffix + -1 (deposit) / -2 (balance)', () => {
  assert.equal(buildInvoiceModel(row, { kind: 'deposit', now: NOW }).invoiceNo, 'INV-2607-K7WQ-1');
  assert.equal(buildInvoiceModel(row, { kind: 'balance', now: NOW }).invoiceNo, 'INV-2607-K7WQ-2');
  assert.equal(buildInvoiceModel(row, { kind: 'full', now: NOW }).invoiceNo, 'INV-2607-K7WQ-1');
  assert.deepEqual(INVOICE_KINDS, ['deposit', 'balance', 'full']);
});

test('invoice totals match the frozen snapshot (in cents)', () => {
  const m = buildInvoiceModel(row, { kind: 'deposit', now: NOW });
  assert.equal(m.totals.subtotalCents, toCents(snap.totals.subtotal));
  assert.equal(m.totals.shippingCents, toCents(snap.totals.shipping));
  assert.equal(m.totals.grandCents, toCents(snap.totals.grand));
  assert.equal(m.totals.cabinets, snap.totals.cabinets);
  // line subtotals sum back to the cabinets subtotal
  const lineSum = m.lines.reduce((t, l) => t + l.subtotalCents, 0);
  assert.equal(lineSum, m.totals.subtotalCents);
});

test('invoice lines: per unit type, qty maths from the snapshot', () => {
  const m = buildInvoiceModel(row, { kind: 'deposit', now: NOW });
  assert.equal(m.lines.length, 2);
  const [a, b] = m.lines;
  assert.equal(a.name, '1 Bed Type A');
  assert.equal(a.rev, 'C');
  assert.equal(a.units, 120);
  assert.equal(a.cabsPerUnit, 6);
  assert.equal(a.cabinets, 720);
  assert.equal(b.name, 'PH Grand');
  assert.equal(b.cabinets, 24);
});

test('deposit + balance invoices sum to the grand total', () => {
  const dep = buildInvoiceModel(row, { kind: 'deposit', now: NOW });
  const bal = buildInvoiceModel(row, { kind: 'balance', now: NOW });
  assert.equal(dep.amountDueCents + bal.amountDueCents, dep.totals.grandCents);
  assert.equal(dep.schedule[0].amountCents, dep.amountDueCents);
  assert.equal(dep.schedule[1].amountCents, bal.amountDueCents);
  assert.ok(dep.schedule[0].billed && !dep.schedule[1].billed);
  assert.ok(!bal.schedule[0].billed && bal.schedule[1].billed);
});

test('odd-cent grand: the extra cent lands on the deposit invoice', () => {
  const odd = {
    orderNo: 'PL-2607-ODD1', project: 'Odd Cents', customer: null,
    unitTypes: [], phases: [],
    totals: { cabinets: 1, subtotal: 99.01, shipping: 1.00, grand: 100.01 },
  };
  const dep = buildInvoiceModel(odd, { kind: 'deposit', now: NOW });
  const bal = buildInvoiceModel(odd, { kind: 'balance', now: NOW });
  assert.equal(dep.amountDueCents, 5001);
  assert.equal(bal.amountDueCents, 5000);
  assert.equal(dep.amountDueCents + bal.amountDueCents, 10001);
});

test('kind full bills the whole grand total', () => {
  const m = buildInvoiceModel(row, { kind: 'full', now: NOW });
  assert.equal(m.amountDueCents, m.totals.grandCents);
  assert.ok(m.schedule.every((s) => s.billed));
});

test('deposit is due on receipt; phased balance carries the derived date', () => {
  const dep = buildInvoiceModel(row, { kind: 'deposit', now: NOW });
  assert.equal(dep.dates.dueLabel, 'Due on receipt');
  const bal = buildInvoiceModel(row, { kind: 'balance', now: NOW });
  assert.ok(bal.dates.due, 'phased balance should have a concrete due date');
  assert.match(bal.dates.dueLabel, /14 days before the Phase 1/);
  // unphased → on notice
  const flatRow = { order_no: flatSnap.orderNo, placed_at: flatSnap.placedAt, data: flatSnap };
  const flatBal = buildInvoiceModel(flatRow, { kind: 'balance', now: NOW });
  assert.equal(flatBal.dates.due, null);
  assert.match(flatBal.dates.dueLabel, /on notice/i);
});

test('depositPct option: custom split still sums to grand', () => {
  const m = buildInvoiceModel(row, { kind: 'deposit', depositPct: 30, now: NOW });
  assert.equal(DEFAULT_DEPOSIT_PCT, 50);
  assert.equal(m.schedule[0].amountCents + m.schedule[1].amountCents, m.totals.grandCents);
  assert.match(m.schedule[0].label, /30%/);
  assert.match(m.schedule[1].label, /70%/);
});

test('invoice model works from a bare snapshot too (no Supabase row)', () => {
  const m = buildInvoiceModel(snap, { kind: 'deposit', now: NOW });
  assert.equal(m.orderNo, 'PL-2607-K7WQ');
  assert.equal(m.customer.name, 'Imogen');
});

// ---- snapshot → trade adapter -------------------------------------------------------

test('snapshotToTrade round-trips the totals exactly', () => {
  const t2 = snapshotToTrade(row);
  const s2 = tradeSummary(t2);
  assert.equal(s2.subtotal, snap.totals.subtotal);
  assert.equal(s2.shipping, snap.totals.shipping);
  assert.equal(s2.grand, snap.totals.grand);
  assert.equal(s2.totalCabs, snap.totals.cabinets);
});

test('snapshotToTrade preserves unit names, revs and quantities', () => {
  const t2 = snapshotToTrade(row);
  assert.equal(t2.project, 'Hudson Yards Tower');
  assert.equal(t2.finish, 'Ghost');
  assert.equal(t2.units.length, 2);
  assert.equal(unitName(t2.units[0]), '1 Bed Type A');
  assert.equal(t2.units[0].rev, 'C');
  assert.equal(t2.units[0].qty, 120);
  assert.equal(unitName(t2.units[1]), 'PH Grand');
  // frozen orders never re-derive phasing — the plan lives on snapshot.phases
  assert.equal(t2.phasing.on, false);
});

test('CSV builder accepts the adapted trade (grand total matches)', () => {
  const csv = buildTradeOrderCSV(snapshotToTrade(row), NOW);
  assert.match(csv, /GRAND TOTAL/);
  assert.ok(csv.includes(snap.totals.grand.toFixed(2)), 'CSV grand total matches the snapshot');
  assert.match(csv, /1 Bed Type A/);
  assert.match(csv, /F2/);
});

test('workbook builder accepts the adapted trade (order sheet + order no)', () => {
  const sheets = buildTradeWorkbook(snapshotToTrade(row), NOW, row.order_no);
  const names = sheets.map((s) => s.name);
  assert.ok(names.includes('Summary') && names.includes('Order'));
  const order = sheets.find((s) => s.name === 'Order');
  const flat = order.rows.flat().map((c) => (c && c.v != null ? c.v : c));
  assert.ok(flat.includes('PL-2607-K7WQ'), 'order number stamped on the Order sheet');
  assert.ok(flat.some((c) => typeof c === 'number' && c === snap.totals.grand)
    || order.rows.some((r) => r.some((c) => c && c.v === snap.totals.grand)), 'grand total present');
});

test('designed layouts ride the snapshot so the submittal can regenerate', () => {
  const design = { finish: 'Ghost', room: { width: 144, depth: 120, height: 96 }, items: [] };
  const withDesign = {
    ...tower,
    units: [{ ...tower.units[1], design, revHistory: [{ rev: 'B', date: '7/1/2026' }] }],
  };
  const s = buildOrderSnapshot(withDesign, { now: NOW, orderNo: 'PL-2607-DSGN' });
  assert.deepEqual(s.unitTypes[0].design, design);
  const t2 = snapshotToTrade({ data: s });
  assert.deepEqual(t2.units[0].design, design);
  assert.deepEqual(t2.units[0].revHistory, [{ rev: 'B', date: '7/1/2026' }]);
  // designless snapshots stay designless
  assert.ok(!snapshotToTrade(row).units.some((u) => u.design));
});

// ---- doc kinds --------------------------------------------------------------------

test('DOC_KINDS match the SQL check constraint, each with a label', () => {
  assert.deepEqual(DOC_KINDS, ['submittal', 'workbook', 'csv', 'invoice_deposit', 'invoice_balance', 'change_order']);
  for (const k of DOC_KINDS) assert.ok(DOC_LABELS[k], `label for ${k}`);
  const sql = readFileSync(fileURLToPath(new URL('../SUPABASE_DOCS.sql', import.meta.url)), 'utf8');
  for (const k of DOC_KINDS) assert.ok(sql.includes(`'${k}'`), `SQL check includes ${k}`);
});

// ---- the printable HTML -------------------------------------------------------------

test('invoice HTML: one portrait page with the key blocks + correct money', () => {
  const m = buildInvoiceModel(row, { kind: 'deposit', now: NOW });
  const html = buildInvoiceHTML(m);
  assert.match(html, /letter portrait/);
  assert.match(html, /INV-2607-K7WQ-1/);
  assert.match(html, /AMOUNT DUE/);
  assert.match(html, /PAYMENT SCHEDULE/);
  assert.match(html, /PAYMENT INSTRUCTIONS/);
  assert.match(html, /order confirmation email/);
  assert.ok(html.includes(fmtCents(m.amountDueCents)), 'amount due printed');
  assert.ok(html.includes(fmtCents(m.totals.grandCents)), 'grand total printed');
  assert.ok(html.includes('Imogen'), 'bill-to name printed');
  assert.equal((html.match(/class="sheet"/g) || []).length, 1, 'exactly one sheet');
});

test('invoice HTML is ASCII-safe', () => {
  const m = buildInvoiceModel(row, { kind: 'balance', now: NOW });
  const html = buildInvoiceHTML(m);
  for (let i = 0; i < html.length; i++) {
    assert.ok(html.charCodeAt(i) < 128, `non-ASCII char ${html[i]} (U+${html.charCodeAt(i).toString(16)}) at ${i}`);
  }
});
