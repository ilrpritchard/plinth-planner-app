// changeorder.test.js — CHANGE ORDERS: the rev-to-rev diff between a frozen
// order snapshot and the live working spec. Line-diff kinds, cents-exact
// reconciliation (net delta === sum of type deltas + shipping delta), CO
// numbering, unchanged-type filtering, and an ASCII-safe smoke test of the
// printable document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChangeOrderModel, diffLines, fmtDelta } from '../src/core/changeorder.js';
import { buildChangeOrderHTML } from '../src/ui/changeorder.js';
import { buildOrderSnapshot } from '../src/core/orders.js';
import { tradeSummary } from '../src/core/cost.js';
import { toCents } from '../src/core/invoice.js';
import { getCab, sellUSD } from '../src/core/catalogue.js';
import { bumpRev } from '../src/core/submittal.js';

const NOW = Date.UTC(2026, 6, 9);

const rows = (spec) => spec.map(([code, qty], i) => ({ id: i + 1, code, qty }));

/** A placed order: two unit types, both on real catalogue codes. */
function makeTower() {
  return {
    project: 'Hudson Yards Tower', finish: 'Ghost', nextUnitId: 3, nextRowId: 100,
    units: [
      { id: 1, beds: '1 Bed', letter: 'A', name: '', qty: 24, floorFrom: '', floorTo: '', perFloor: '', rows: rows([['F2', 3], ['F10', 1], ['W1', 2]]), rev: 'A' },
      { id: 2, beds: '2 Bed', letter: 'B', name: '', qty: 10, floorFrom: '', floorTo: '', perFloor: '', rows: rows([['F2', 4], ['W1', 3]]), rev: 'B' },
    ],
    phasing: { on: false },
  };
}

const clone = (t) => JSON.parse(JSON.stringify(t));

// ---- fmtDelta ----------------------------------------------------------------

test('fmtDelta always shows the sign', () => {
  assert.equal(fmtDelta(12345), '+$123.45');
  assert.equal(fmtDelta(-9950), '-$99.50');
  assert.equal(fmtDelta(0), '$0.00');
  assert.equal(fmtDelta(123456789), '+$1,234,567.89');
});

// ---- diffLines ----------------------------------------------------------------

test('diffLines: added / removed / qty / reprice / same kinds with per-unit deltas', () => {
  const oldL = [
    { code: 'F2', desc: 'x', qty: 3, eachCents: 10000 },
    { code: 'W1', desc: 'y', qty: 2, eachCents: 5000 },
    { code: 'F10', desc: 'z', qty: 1, eachCents: 20000 },
    { code: 'T1', desc: 'p', qty: 1, eachCents: 30000 },
  ];
  const newL = [
    { code: 'F2', desc: 'x', qty: 5, eachCents: 10000 },   // qty +2
    { code: 'W1', desc: 'y', qty: 2, eachCents: 6000 },    // repriced
    { code: 'T1', desc: 'p', qty: 1, eachCents: 30000 },   // same
    { code: 'B9', desc: 'n', qty: 2, eachCents: 4000 },    // added
  ];                                                       // F10 removed
  const d = new Map(diffLines(oldL, newL).map((r) => [r.code, r]));
  assert.equal(d.get('F2').kind, 'qty');       assert.equal(d.get('F2').deltaCents, 20000);
  assert.equal(d.get('W1').kind, 'reprice');   assert.equal(d.get('W1').deltaCents, 2000);
  assert.equal(d.get('F10').kind, 'removed');  assert.equal(d.get('F10').deltaCents, -20000);
  assert.equal(d.get('B9').kind, 'added');     assert.equal(d.get('B9').deltaCents, 8000);
  assert.equal(d.get('T1').kind, 'same');      assert.equal(d.get('T1').deltaCents, 0);
});

// ---- the model ------------------------------------------------------------------

test('identical spec: no changes, zero net delta', () => {
  const tower = makeTower();
  const snap = buildOrderSnapshot(tower, { now: NOW });
  const m = buildChangeOrderModel(snap, clone(tower), { now: NOW });
  assert.equal(m.changes.length, 0);
  assert.equal(m.unchangedCount, 2);
  assert.equal(m.totals.netDeltaCents, 0);
  assert.equal(m.totals.oldGrandCents, m.totals.newGrandCents);
});

test('CO number: CO-<order suffix>-<seq>', () => {
  const tower = makeTower();
  const snap = buildOrderSnapshot(tower, { now: NOW, orderNo: 'PL-2607-K7WQ' });
  const m1 = buildChangeOrderModel(snap, clone(tower), { now: NOW });
  const m3 = buildChangeOrderModel(snap, clone(tower), { now: NOW, seq: 3 });
  assert.equal(m1.coNo, 'CO-2607-K7WQ-1');
  assert.equal(m3.coNo, 'CO-2607-K7WQ-3');
});

test('rev bump + line changes: the changed type is reported rev-to-rev', () => {
  const tower = makeTower();
  const snap = buildOrderSnapshot(tower, { now: NOW });
  const live = clone(tower);
  live.units[0].rows[0].qty = 5;                       // F2: 3 → 5 per unit
  live.units[0].rows.push({ id: 99, code: 'F3', qty: 1 });
  bumpRev(live.units[0], '7/9/2026');                  // Rev A → B

  const m = buildChangeOrderModel(snap, live, { now: NOW });
  assert.equal(m.changes.length, 1);
  assert.equal(m.unchangedCount, 1);
  const ch = m.changes[0];
  assert.equal(ch.kind, 'changed');
  assert.equal(ch.oldRev, 'A');
  assert.equal(ch.newRev, 'B');
  assert.equal(ch.oldUnits, 24);
  assert.equal(ch.newUnits, 24);

  const f2 = ch.lines.find((l) => l.code === 'F2');
  const b1 = ch.lines.find((l) => l.code === 'F3');
  assert.equal(f2.kind, 'qty');
  assert.equal(f2.oldQty, 3); assert.equal(f2.newQty, 5);
  assert.equal(b1.kind, 'added');
  // unchanged codes (F10, W1) are NOT listed
  assert.ok(!ch.lines.some((l) => l.code === 'F10' || l.code === 'W1'));

  const expPerUnit = 2 * toCents(sellUSD(getCab('F2'))) + toCents(sellUSD(getCab('F3')));
  assert.equal(ch.newPerUnitCents - ch.oldPerUnitCents, expPerUnit);
  assert.equal(ch.deltaCents, ch.newExtCents - ch.oldExtCents);
});

test('added and removed unit types are whole-type changes', () => {
  const tower = makeTower();
  const snap = buildOrderSnapshot(tower, { now: NOW });
  const live = clone(tower);
  live.units.splice(1, 1);                             // drop the 2 Bed type
  live.units.push({ id: 3, beds: 'Studio', letter: 'C', name: '', qty: 6, floorFrom: '', floorTo: '', perFloor: '', rows: rows([['F2', 2]]) });

  const m = buildChangeOrderModel(snap, live, { now: NOW });
  const removed = m.changes.find((x) => x.kind === 'removed');
  const added = m.changes.find((x) => x.kind === 'added');
  assert.ok(removed && removed.name.startsWith('2 Bed'));
  assert.ok(added && added.name.startsWith('Studio'));
  assert.equal(removed.newUnits, 0);
  assert.equal(added.oldUnits, 0);
  assert.ok(removed.deltaCents < 0);
  assert.ok(added.deltaCents > 0);
  assert.ok(removed.lines.every((l) => l.kind === 'removed'));
  assert.ok(added.lines.every((l) => l.kind === 'added'));
});

test('unit count change alone flags the type (no line changes)', () => {
  const tower = makeTower();
  const snap = buildOrderSnapshot(tower, { now: NOW });
  const live = clone(tower);
  live.units[1].qty = 14;                              // ×10 → ×14, same lines

  const m = buildChangeOrderModel(snap, live, { now: NOW });
  assert.equal(m.changes.length, 1);
  const ch = m.changes[0];
  assert.equal(ch.lines.length, 0);
  assert.equal(ch.oldUnits, 10);
  assert.equal(ch.newUnits, 14);
  assert.equal(ch.deltaCents, ch.oldPerUnitCents * 4);
});

test('reconciliation: net delta === type deltas + shipping delta, and matches live tradeSummary', () => {
  const tower = makeTower();
  const snap = buildOrderSnapshot(tower, { now: NOW });
  const live = clone(tower);
  live.units[0].rows[0].qty = 6;
  live.units[1].qty = 30;                              // enough to move shipping
  live.units.push({ id: 3, beds: 'Studio', letter: 'C', name: '', qty: 8, floorFrom: '', floorTo: '', perFloor: '', rows: rows([['F2', 2], ['W1', 1]]) });

  const m = buildChangeOrderModel(snap, live, { now: NOW });
  const t = m.totals;
  const sumTypeDeltas = m.unitTypes.reduce((x, ut) => x + ut.deltaCents, 0);
  // net = per-type deltas + shipping delta − volume-tier delta (indicative tiers
  // re-derive from the revised unit count, same maths as tradeSummary)
  assert.equal(t.netDeltaCents, sumTypeDeltas + t.shippingDeltaCents - t.discountDeltaCents);
  assert.equal(t.netDeltaCents, t.newGrandCents - t.oldGrandCents);

  // both endpoints agree with the pricing engines they came from
  assert.equal(t.oldGrandCents, toCents(snap.totals.grand));
  assert.equal(t.newGrandCents, toCents(tradeSummary(live).grand));
  assert.ok(t.shippingDeltaCents > 0, 'expected the bigger order to add a container');
});

test('project mismatch is flagged when the live project differs', () => {
  const tower = makeTower();
  const snap = buildOrderSnapshot(tower, { now: NOW });
  const live = clone(tower);
  live.project = 'Some Other Tower';
  const m = buildChangeOrderModel(snap, live, { now: NOW });
  assert.equal(m.projectMismatch, true);
  assert.equal(buildChangeOrderModel(snap, clone(tower), { now: NOW }).projectMismatch, false);
});

test('accepts a Supabase row shape ({ order_no, placed_at, data })', () => {
  const tower = makeTower();
  const snap = buildOrderSnapshot(tower, { now: NOW, orderNo: 'PL-2607-ABCD' });
  const row = { id: 'x', order_no: 'PL-2607-ABCD', placed_at: new Date(NOW).toISOString(), status: 'confirmed', data: snap };
  const live = clone(tower);
  live.units[0].rows[0].qty = 4;
  const m = buildChangeOrderModel(row, live, { now: NOW, seq: 2 });
  assert.equal(m.coNo, 'CO-2607-ABCD-2');
  assert.equal(m.orderNo, 'PL-2607-ABCD');
  assert.equal(m.changes.length, 1);
});

// ---- the printable document -------------------------------------------------------

function changedModel() {
  const tower = makeTower();
  const snap = buildOrderSnapshot(tower, { now: NOW, orderNo: 'PL-2607-K7WQ', customer: { name: 'Imogen', email: 'i@x.com' } });
  const live = clone(tower);
  live.units[0].rows[0].qty = 5;
  bumpRev(live.units[0], '7/9/2026');
  live.units[1].qty = 14;
  return buildChangeOrderModel(snap, live, { now: NOW });
}

test('change-order HTML: key blocks, both signatures, correct money', () => {
  const m = changedModel();
  const html = buildChangeOrderHTML(m);
  assert.ok(html.includes('CHANGE ORDER'));
  assert.ok(html.includes(m.coNo));
  assert.ok(html.includes('Amends order PL-2607-K7WQ'));
  assert.ok(html.includes('NET CHANGE'));
  assert.ok(html.includes('SIGN-OFF'));
  assert.equal((html.match(/SIGNATURE/g) || []).length, 2, 'client + PL/NTH signature blocks');
  assert.ok(html.includes(fmtDelta(m.totals.netDeltaCents)));
  assert.ok(html.includes('Rev A &rarr; B'));
  assert.ok(html.includes('supersede the original order value'));
});

test('change-order HTML is ASCII-safe', () => {
  const html = buildChangeOrderHTML(changedModel());
  for (let i = 0; i < html.length; i++) {
    assert.ok(html.charCodeAt(i) < 128, `non-ASCII char ${html[i]} (U+${html.charCodeAt(i).toString(16)}) at ${i}`);
  }
});
