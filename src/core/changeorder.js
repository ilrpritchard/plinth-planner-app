// changeorder.js — CHANGE ORDERS: the rev-to-rev diff between a FROZEN trade
// order (a trade_orders row / buildOrderSnapshot payload) and the CURRENT
// working spec. Pure and node-testable — buildChangeOrderModel() computes
// every number the printable change-order document needs; ui/changeorder.js
// only lays it out.
//
//   buildChangeOrderModel(order, liveTrade, { seq, now }) → the CO model
//
// Pricing rules (disclosed on the document):
//   - unchanged lines keep their frozen order pricing and are not re-billed
//   - removed quantities are credited at the ORDERED price
//   - added / changed lines are priced at the CURRENT catalogue rate
//   - shipping is re-derived from the revised cabinet count (container maths)
//
// All money maths runs in INTEGER CENTS (like invoice.js): the model's
// netDeltaCents always equals the sum of its per-unit-type deltas plus the
// shipping delta, to the cent, by construction.

import { getCab, sellUSD, volumeTier } from './catalogue.js';
import { unitQty, unitName } from './cost.js';
import { unitRev } from './submittal.js';
import { toCents } from './invoice.js';
import { TRADE } from './catalogue.js';

/** '+$120.00' / '-$45.50' / '$0.00' — deltas always show their sign. */
export function fmtDelta(cents) {
  const n = Math.round(Number(cents) || 0);
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const s = `$${dollars}.${String(abs % 100).padStart(2, '0')}`;
  return n < 0 ? `-${s}` : n > 0 ? `+${s}` : s;
}

const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Collapse a live unit's rows to per-unit lines at CURRENT catalogue prices. */
function liveLines(u) {
  const byCode = new Map();
  for (const r of u.rows || []) {
    const cab = getCab(r.code);
    if (!cab || cab.notSupplied) continue;
    const qty = Number(r.qty) || 0;
    if (!qty) continue;
    const cur = byCode.get(cab.code) || { code: cab.code, desc: cab.desc, qty: 0, eachCents: toCents(sellUSD(cab)) };
    cur.qty += qty;
    byCode.set(cab.code, cur);
  }
  return [...byCode.values()];
}

/** Frozen snapshot lines → the same shape, prices in cents. */
function frozenLines(ut) {
  return (ut.lines || [])
    .filter((l) => (Number(l.qty) || 0) > 0)
    .map((l) => ({ code: l.code, desc: l.desc, qty: Number(l.qty) || 0, eachCents: toCents(l.each) }));
}

/**
 * Diff two per-unit line lists (old frozen vs new live). Every code that
 * appears on either side gets a row; per-unit deltaCents = new − old.
 * kind: 'added' | 'removed' | 'qty' | 'reprice' | 'same'.
 */
export function diffLines(oldLines, newLines) {
  const codes = new Map();                        // code → { old, new }
  for (const l of oldLines || []) codes.set(l.code, { o: l, n: null });
  for (const l of newLines || []) {
    const e = codes.get(l.code);
    if (e) e.n = l; else codes.set(l.code, { o: null, n: l });
  }
  const rows = [];
  for (const { o, n } of codes.values()) {
    const oldQty = o ? o.qty : 0, newQty = n ? n.qty : 0;
    const oldEachCents = o ? o.eachCents : 0, newEachCents = n ? n.eachCents : 0;
    const deltaCents = newQty * newEachCents - oldQty * oldEachCents;
    const kind = !o ? 'added' : !n ? 'removed'
      : oldQty !== newQty ? 'qty'
      : oldEachCents !== newEachCents ? 'reprice' : 'same';
    rows.push({
      code: (o || n).code, desc: (n || o).desc || '',
      oldQty, newQty, oldEachCents, newEachCents, deltaCents, kind,
    });
  }
  rows.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  return rows;
}

/** Diff one matched unit type: frozen snapshot ut vs live unit u (either may be null). */
function diffUnitType(ut, u) {
  const oldLines = ut ? frozenLines(ut) : [];
  const newLines = u ? liveLines(u) : [];
  const lines = diffLines(oldLines, newLines);
  const oldUnits = ut ? (Number(ut.units) || 0) : 0;
  const newUnits = u ? unitQty(u) : 0;
  const oldPerUnitCents = oldLines.reduce((t, l) => t + l.qty * l.eachCents, 0);
  const newPerUnitCents = newLines.reduce((t, l) => t + l.qty * l.eachCents, 0);
  const oldExtCents = oldPerUnitCents * oldUnits;
  const newExtCents = newPerUnitCents * newUnits;
  const oldRev = ut ? (ut.rev || 'A') : null;
  const newRev = u ? unitRev(u) : null;
  const changedLines = lines.filter((l) => l.kind !== 'same');
  return {
    name: ut ? (ut.name || 'Unit type') : unitName(u),
    kind: !ut ? 'added' : !u ? 'removed' : 'changed',
    oldRev, newRev, oldUnits, newUnits,
    oldCabsPerUnit: oldLines.reduce((t, l) => t + l.qty, 0),
    newCabsPerUnit: newLines.reduce((t, l) => t + l.qty, 0),
    lines: changedLines,
    oldPerUnitCents, newPerUnitCents, oldExtCents, newExtCents,
    deltaCents: newExtCents - oldExtCents,
    unchanged: changedLines.length === 0 && oldUnits === newUnits && oldRev === newRev,
  };
}

/**
 * The whole change order as plain data. `order` is a trade_orders row
 * ({ order_no, placed_at, data }) or a bare snapshot; `liveTrade` is the
 * current working trade state. Unit types are matched BY NAME (unitName —
 * the snapshot stores it verbatim). `opts.seq` numbers the CO against this
 * order (1, 2, …); `opts.now` (ms) pins the issue date for tests.
 */
export function buildChangeOrderModel(order, liveTrade, opts = {}) {
  const d = (order && order.data) || order || {};
  const t = liveTrade || { units: [] };
  const seq = Math.max(1, Math.round(Number(opts.seq) || 1));
  const now = opts.now != null ? opts.now : Date.now();

  const orderNo = (order && order.order_no) || d.orderNo || 'PL-0000-XXXX';
  const suffix = String(orderNo).replace(/^PL-?/, '');
  const coNo = `CO-${suffix}-${seq}`;

  // match snapshot unit types ↔ live units by display name
  const liveByName = new Map((t.units || []).map((u) => [unitName(u), u]));
  const seen = new Set();
  const unitTypes = [];
  for (const ut of d.unitTypes || []) {
    const u = liveByName.get(ut.name) || null;
    if (u) seen.add(ut.name);
    unitTypes.push(diffUnitType(ut, u));
  }
  for (const u of t.units || []) {
    if (!seen.has(unitName(u))) unitTypes.push(diffUnitType(null, u));
  }

  const changes = unitTypes.filter((x) => !x.unchanged);
  const unchangedCount = unitTypes.length - changes.length;

  // totals — old side from the frozen snapshot lines, new side from the live
  // spec, both summed per-line in cents so the reconciliation is exact
  const oldSubtotalCents = unitTypes.reduce((x, ut) => x + ut.oldExtCents, 0);
  const newSubtotalCents = unitTypes.reduce((x, ut) => x + ut.newExtCents, 0);
  const oldCabinets = unitTypes.reduce((x, ut) => x + ut.oldCabsPerUnit * ut.oldUnits, 0);
  const newCabinets = unitTypes.reduce((x, ut) => x + ut.newCabsPerUnit * ut.newUnits, 0);

  // shipping re-derived from the revised cabinet count (same container maths
  // as tradeSummary); the old side comes off the frozen snapshot
  const oldShippingCents = d.totals ? toCents(d.totals.shipping) : cShip(oldCabinets);
  const newShippingCents = cShip(newCabinets);

  // indicative volume tier re-derived from the revised unit count (same maths
  // as tradeSummary — cent-rounded); the old side comes off the frozen snapshot
  const oldDiscountCents = d.totals ? toCents(d.totals.discount || 0) : 0;
  const newTotalUnits = (t.units || []).reduce((x, u) => x + unitQty(u), 0);
  const newTier = volumeTier(newTotalUnits);
  const newDiscountCents = newTier ? Math.round(newSubtotalCents * newTier.pct / 100) : 0;

  const oldGrandCents = oldSubtotalCents - oldDiscountCents + oldShippingCents;
  const newGrandCents = newSubtotalCents - newDiscountCents + newShippingCents;

  return {
    coNo, seq, orderNo,
    project: d.project || 'Untitled project',
    liveProject: t.project || '',
    projectMismatch: Boolean(t.project && d.project && t.project !== d.project),
    finish: d.finish || '',
    customer: d.customer || null,
    dates: {
      issued: fmtDate(now),
      placed: d.placedAt ? fmtDate(d.placedAt)
        : ((order && order.placed_at) ? fmtDate(order.placed_at) : fmtDate(now)),
    },
    unitTypes, changes, unchangedCount,
    totals: {
      oldCabinets, newCabinets,
      oldSubtotalCents, newSubtotalCents,
      oldShippingCents, newShippingCents,
      shippingDeltaCents: newShippingCents - oldShippingCents,
      oldDiscountCents, newDiscountCents,
      discountDeltaCents: newDiscountCents - oldDiscountCents,
      newTier: newTier ? { pct: newTier.pct, label: newTier.label } : null,
      oldGrandCents, newGrandCents,
      netDeltaCents: newGrandCents - oldGrandCents,
    },
    signoff: [
      { party: 'Client / Buyer', name: (d.customer && d.customer.name) || '' },
      { party: 'PL/NTH', name: '' },
    ],
  };
}

/** Container shipping in cents for a cabinet count — mirrors tradeSummary. */
function cShip(totalCabs) {
  const containers = totalCabs > 0 ? Math.ceil(totalCabs / TRADE.capPerContainer) : 0;
  return toCents(containers * TRADE.shipPerContainerUSD);
}
