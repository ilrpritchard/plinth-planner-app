// orders.test.js — real trade orders: order-number minting, the snapshot
// shape (totals must match cost.js maths exactly), phase status defaulting,
// and the status rollup shown in the ORDERS view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  genOrderNo, ORDER_NO_ALPHABET, buildOrderSnapshot,
  STATUSES, statusLabel, statusRank, mergedPhases, orderStatusSummary,
} from '../src/core/orders.js';
import { tradeSummary } from '../src/core/cost.js';
import { planPhases } from '../src/core/phasing.js';

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, code: 'F2', qty: 1 }));

const tower = {
  project: 'Hudson Yards Tower', finish: 'Ghost', nextUnitId: 3, nextRowId: 200,
  units: [
    { id: 1, beds: '1 Bed', letter: 'A', name: '', qty: 0, floorFrom: 1, floorTo: 30, perFloor: 4, rows: rows(6), rev: 'C' },
    { id: 2, beds: 'Penthouse', letter: 'B', name: 'PH Grand', qty: 2, floorFrom: '', floorTo: '', perFloor: '', rows: rows(12) },
  ],
  phasing: { on: true, maxPerBatch: 20 },
};

// ---- order numbers ----------------------------------------------------------

test('order number format: PL-YYMM-XXXX', () => {
  const no = genOrderNo(new Date(2026, 6, 8));       // July 2026
  assert.match(no, /^PL-2607-[A-Z2-9]{4}$/);
});

test('order number charset: base32, no ambiguous 0/O/1/I', () => {
  assert.equal(ORDER_NO_ALPHABET.length, 32);
  for (const bad of ['0', 'O', '1', 'I']) assert.ok(!ORDER_NO_ALPHABET.includes(bad), `alphabet contains ${bad}`);
  for (let i = 0; i < 200; i++) {
    const tail = genOrderNo().slice(-4);
    for (const ch of tail) assert.ok(ORDER_NO_ALPHABET.includes(ch), `bad char ${ch}`);
  }
});

test('order numbers vary (randomness sanity)', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(genOrderNo());
  assert.ok(seen.size > 40);
});

// ---- the snapshot -------------------------------------------------------------

const NOW = Date.UTC(2026, 6, 8);
const snap = buildOrderSnapshot(tower, { now: NOW, customer: { name: 'Imogen', email: 'i@x.com' } });

test('snapshot shape: top-level fields', () => {
  assert.match(snap.orderNo, /^PL-2607-[A-Z2-9]{4}$/);
  assert.equal(snap.placedAt, new Date(NOW).toISOString());
  assert.equal(snap.project, 'Hudson Yards Tower');
  assert.equal(snap.finish, 'Ghost');
  assert.equal(snap.customer.name, 'Imogen');
  assert.ok(Array.isArray(snap.unitTypes) && Array.isArray(snap.phases) && Array.isArray(snap.specFindings));
});

test('snapshot unit types: name, bed, rev, units, lines', () => {
  assert.equal(snap.unitTypes.length, 2);
  const [a, b] = snap.unitTypes;
  assert.equal(a.name, '1 Bed Type A');
  assert.equal(a.bed, '1 Bed');
  assert.equal(a.rev, 'C');
  assert.equal(a.units, 120);                        // 30 floors × 4/floor
  assert.equal(a.lines.length, 1);                   // six F2×1 rows collapse to one F2×6 line
  assert.equal(a.lines[0].code, 'F2');
  assert.equal(a.lines[0].qty, 6);
  assert.equal(b.name, 'PH Grand');
  assert.equal(b.units, 2);
});

test('snapshot totals match tradeSummary exactly', () => {
  const s = tradeSummary(tower);
  assert.equal(snap.totals.cabinets, s.totalCabs);
  assert.equal(snap.totals.subtotal, s.subtotal);
  assert.equal(snap.totals.shipping, s.shipping);
  assert.equal(snap.totals.grand, s.grand);
  // and the line totals themselves sum to the subtotal
  const lineSum = snap.unitTypes.reduce((t, ut) => t + ut.lines.reduce((x, l) => x + l.total, 0), 0);
  assert.ok(Math.abs(lineSum - s.subtotal) < 1e-6);
});

test('snapshot lines carry code/desc/qty/each/total', () => {
  for (const ut of snap.unitTypes) for (const l of ut.lines) {
    assert.equal(typeof l.code, 'string');
    assert.equal(typeof l.desc, 'string');
    assert.ok(l.qty > 0 && l.each > 0);
    assert.ok(Math.abs(l.total - l.each * l.qty * ut.units) < 1e-6);
  }
});

test('snapshot phases mirror planPhases, each with id + submitted status', () => {
  const plan = planPhases(tower, { maxUnitsPerBatch: 20 });
  assert.equal(snap.phases.length, plan.batches.length);
  snap.phases.forEach((p, i) => {
    assert.equal(p.id, `P${i + 1}`);
    assert.equal(p.n, i + 1);
    assert.equal(p.units, plan.batches[i].units);
    assert.equal(p.status, 'submitted');
    assert.ok(p.window && p.window.from && p.window.to);
  });
});

test('phasing off → no phases in the snapshot', () => {
  const flat = buildOrderSnapshot({ ...tower, phasing: { on: false } }, { now: NOW });
  assert.deepEqual(flat.phases, []);
});

test('opts.orderNo passes through (collision re-mint path)', () => {
  const s2 = buildOrderSnapshot(tower, { now: NOW, orderNo: 'PL-2607-ABCD' });
  assert.equal(s2.orderNo, 'PL-2607-ABCD');
});

test('empty project still snapshots safely', () => {
  const s0 = buildOrderSnapshot({ units: [] }, { now: NOW });
  assert.equal(s0.totals.cabinets, 0);
  assert.equal(s0.totals.grand, 0);
  assert.deepEqual(s0.unitTypes, []);
  assert.deepEqual(s0.phases, []);
});

// ---- statuses + rollup -----------------------------------------------------------

test('STATUSES pipeline order + labels', () => {
  assert.deepEqual(STATUSES, ['submitted', 'confirmed', 'in_production', 'shipped', 'delivered']);
  assert.equal(statusLabel('in_production'), 'In production');
  assert.equal(statusLabel('cancelled'), 'Cancelled');
  assert.ok(statusRank('shipped') > statusRank('confirmed'));
  assert.equal(statusRank('cancelled'), -1);
});

const mkOrder = (status, n, phaseStatus = {}) => ({
  status,
  phase_status: phaseStatus,
  data: { phases: Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, n: i + 1, status: 'submitted' })) },
});

test('mergedPhases: phase_status jsonb wins, missing/unknown default to submitted', () => {
  const o = mkOrder('confirmed', 3, { P2: 'shipped', P3: 'not-a-status' });
  const ph = mergedPhases(o);
  assert.deepEqual(ph.map((p) => p.status), ['submitted', 'shipped', 'submitted']);
});

test('rollup: unphased order shows its own status', () => {
  assert.equal(orderStatusSummary({ status: 'in_production', data: { phases: [] } }), 'In production');
  assert.equal(orderStatusSummary(mkOrder('confirmed', 1)), 'Confirmed');
});

test('rollup: "2 of 5 phases shipped"', () => {
  const o = mkOrder('in_production', 5, { P1: 'shipped', P2: 'shipped', P3: 'in_production' });
  assert.equal(orderStatusSummary(o), '2 of 5 phases shipped');
});

test('rollup: all phases at the same stage', () => {
  const all = mkOrder('shipped', 3, { P1: 'delivered', P2: 'delivered', P3: 'delivered' });
  assert.equal(orderStatusSummary(all), 'All 3 phases delivered');
});

test('rollup: nothing moved yet → Submitted; cancelled always wins', () => {
  assert.equal(orderStatusSummary(mkOrder('submitted', 4)), 'Submitted');
  assert.equal(orderStatusSummary(mkOrder('cancelled', 4, { P1: 'shipped' })), 'Cancelled');
});
