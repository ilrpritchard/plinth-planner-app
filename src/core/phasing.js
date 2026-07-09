// phasing.js — delivery phasing for trade projects. Pure, node-testable.
//
// A tower fits out floor by floor, so deliveries should too: planPhases()
// walks the floors bottom-up and cuts them into contiguous bands ("Floors
// 3–8") so no batch carries more than opts.maxUnitsPerBatch units. Unit types
// entered as a plain quantity (no floors) are chunked into their own batches
// after the floor bands. Ship weeks reuse the 12–14-week deliveryEstimate for
// the whole order; each later batch ships +2 weeks after the one before.

import { getCab } from './catalogue.js';
import { unitQty, unitName, deliveryEstimate } from './cost.js';

export const DEFAULT_MAX_PER_BATCH = 20;
export const WEEKS_BETWEEN_BATCHES = 2;

const hasFloors = (u) =>
  u.floorFrom !== '' && u.floorFrom != null &&
  u.floorTo !== '' && u.floorTo != null &&
  u.perFloor !== '' && u.perFloor != null && Number(u.perFloor) > 0;

/** Supplied cabinets per unit for one unit type (same maths as tradeSummary). */
export function cabsPerUnit(u) {
  let n = 0;
  for (const r of u.rows || []) {
    const cab = getCab(r.code);
    if (!cab || cab.notSupplied) continue;
    n += Number(r.qty) || 0;
  }
  return n;
}

/**
 * Group a trade project's units into delivery batches.
 * Returns { batches, maxPerBatch, totalCabs, base } where each batch is
 *   { n, label, floors: [lo, hi] | null, units, cabinets,
 *     byType: [{ name, qty }], weeksLo, weeksHi }
 * weeksLo/weeksHi are offsets from order date (batch n ships +2wk after n−1).
 */
export function planPhases(trade, opts = {}) {
  const max = Math.max(1, Math.floor(Number(opts.maxUnitsPerBatch) || DEFAULT_MAX_PER_BATCH));
  const units = (trade && trade.units) || [];

  // total cabinets across the order → the base 12–14wk (or longer) window
  let totalCabs = 0;
  for (const u of units) totalCabs += cabsPerUnit(u) * unitQty(u);
  const base = deliveryEstimate(totalCabs);

  const batches = [];
  const push = (floors, byTypeMap) => {
    const byType = [...byTypeMap.entries()].map(([name, v]) => ({ name, qty: v.qty }));
    const nUnits = byType.reduce((t, b) => t + b.qty, 0);
    if (!nUnits) return;
    const cabinets = [...byTypeMap.values()].reduce((t, v) => t + v.qty * v.cabs, 0);
    batches.push({
      floors,
      label: floors ? (floors[0] === floors[1] ? `Floor ${floors[0]}` : `Floors ${floors[0]}–${floors[1]}`) : 'Unassigned floors',
      units: nUnits, cabinets, byType,
    });
  };

  // ---- floor-banded unit types: walk the floors bottom-up ----
  const floored = units.filter(hasFloors);
  if (floored.length) {
    const lo = Math.min(...floored.map((u) => Number(u.floorFrom)));
    const hi = Math.max(...floored.map((u) => Number(u.floorTo)));
    let bandStart = null, bandUnits = 0, byType = new Map();
    const closeBand = (endFloor) => { push([bandStart, endFloor], byType); bandStart = null; bandUnits = 0; byType = new Map(); };
    for (let f = lo; f <= hi; f++) {
      const onFloor = floored.filter((u) => Number(u.floorFrom) <= f && f <= Number(u.floorTo));
      const flUnits = onFloor.reduce((t, u) => t + Number(u.perFloor), 0);
      if (!flUnits) { if (bandStart != null) closeBand(f - 1); continue; }
      if (bandStart != null && bandUnits + flUnits > max) closeBand(f - 1);
      if (bandStart == null) bandStart = f;
      bandUnits += flUnits;
      for (const u of onFloor) {
        const name = unitName(u);
        const cur = byType.get(name) || { qty: 0, cabs: cabsPerUnit(u) };
        cur.qty += Number(u.perFloor);
        byType.set(name, cur);
      }
    }
    if (bandStart != null) closeBand(hi);
  }

  // ---- plain-quantity unit types: chunked after the floor bands ----
  for (const u of units) {
    if (hasFloors(u)) continue;
    let left = unitQty(u);
    while (left > 0) {
      const take = Math.min(left, max);
      push(null, new Map([[unitName(u), { qty: take, cabs: cabsPerUnit(u) }]]));
      left -= take;
    }
  }

  batches.forEach((b, i) => {
    b.n = i + 1;
    b.weeksLo = base.weeksLo + i * WEEKS_BETWEEN_BATCHES;
    b.weeksHi = base.weeksHi + i * WEEKS_BETWEEN_BATCHES;
  });

  return { batches, maxPerBatch: max, totalCabs, base: { weeksLo: base.weeksLo, weeksHi: base.weeksHi } };
}

/** 'Nov 3 – Nov 17, 2026' style window for a batch, from `now`. */
export function batchWindow(batch, now = Date.now()) {
  const wk = 7 * 24 * 3600 * 1000;
  const fmt = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return { from: fmt(now + batch.weeksLo * wk), to: fmt(now + batch.weeksHi * wk) };
}

/** Which batch numbers (1-based) carry any of this unit type — for the CSV. */
export function phasesForUnit(plan, u) {
  const name = unitName(u);
  return plan.batches.filter((b) => b.byType.some((t) => t.name === name)).map((b) => b.n);
}
