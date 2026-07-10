// cost.js — customer-facing estimate + unit list. Shows SELL dollars only;
// never exposes workshop GBP, margin, or container maths.

import { getCab, sellUSD, TRADE, FILLER_SELL, corniceOption } from './catalogue.js';
import { fmtIn } from './units.js';
import { computeFillers } from './fillers.js';
import { planCornice } from './cornice.js';
import { computeEndPanels } from './endpanels.js';

/** Estimated delivery window: 12–14 weeks, longer for big orders. */
export function deliveryEstimate(totalCabs) {
  let lo = 12, hi = 14;
  if (totalCabs > 80) { lo = 16; hi = 18; }
  else if (totalCabs > 40) { lo = 14; hi = 16; }
  const wk = 7 * 24 * 3600 * 1000, now = Date.now();
  const fmt = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return { weeksLo: lo, weeksHi: hi, from: fmt(now + lo * wk), to: fmt(now + hi * wk) };
}

/** Number of units of a trade unit-type: floors×per-floor if set, else qty. */
export function unitQty(u) {
  if (u.floorFrom != null && u.floorTo != null && u.perFloor != null &&
      u.floorFrom !== '' && u.floorTo !== '' && u.perFloor !== '') {
    const floors = Math.max(0, Number(u.floorTo) - Number(u.floorFrom) + 1);
    return floors * Number(u.perFloor);
  }
  return Number(u.qty) || 0;
}

export function unitName(u) {
  if (u.name) return u.name;
  return `${u.beds || '1 Bed'} Type ${u.letter || 'A'}`;
}

/** Per-unit-type aggregates + grand totals for a trade project. */
export function tradeSummary(trade) {
  const lines = [];
  let totalCabs = 0, totalUnits = 0, subtotal = 0;
  for (const u of trade.units || []) {
    let cabsPerUnit = 0, sellPerUnit = 0;
    for (const r of u.rows || []) {
      const cab = getCab(r.code);
      if (!cab || cab.notSupplied) continue;
      const q = Number(r.qty) || 0;
      cabsPerUnit += q;
      sellPerUnit += sellUSD(cab) * q;
    }
    const qty = unitQty(u);
    lines.push({ id: u.id, name: unitName(u), cabsPerUnit, sellPerUnit, qty,
      totalCabs: cabsPerUnit * qty, totalSell: sellPerUnit * qty });
    totalCabs += cabsPerUnit * qty;
    totalUnits += qty;
    subtotal += sellPerUnit * qty;
  }
  const containers = totalCabs > 0 ? Math.ceil(totalCabs / TRADE.capPerContainer) : 0;
  const shipping = containers * TRADE.shipPerContainerUSD;
  return { lines, totalUnits, totalCabs, containers, shipping, subtotal, grand: subtotal + shipping };
}

/**
 * Trade: derive a unit-type's cabinet rows from its saved design — group the
 * placed items by code, count them, drop appliances/decor (not supplied).
 * Returns [{ code, qty }] sorted by family then code. Pure.
 */
export function rowsFromDesign(items) {
  const byCode = new Map();
  for (const it of items || []) {
    const cab = getCab(it && it.code);
    if (!cab || !cab.placeable || cab.notSupplied) continue;
    byCode.set(cab.code, (byCode.get(cab.code) || 0) + 1);
  }
  const order = { FLOOR: 0, WALL: 1, COUNTER: 3, TALL: 4 };
  return [...byCode.entries()]
    .map(([code, qty]) => ({ code, qty }))
    .sort((a, b) => ((order[getCab(a.code).type] ?? 9) - (order[getCab(b.code).type] ?? 9))
      || a.code.localeCompare(b.code, 'en', { numeric: true }));
}

/**
 * Group placed items by code into priced lines. `fillers` is an optional array
 * of auto-generated filler panels (each priced flat) to include in the order.
 */
/** Convenience: summarise a whole state incl. auto fillers + cornice + end panels + accessories. */
export function summarizeState(state) {
  const c = planCornice(state);
  const ep = computeEndPanels(state);
  return summarize(state.items, computeFillers(state), { profile: c.profile, totalIn: c.totalIn }, ep.count, state.accessories || {});
}

export function summarize(items, fillers = [], cornice = null, endPanels = 0, accessories = {}) {
  const byCode = new Map();
  for (const it of items) {
    const cab = getCab(it.code);
    if (!cab) continue;
    if (!byCode.has(it.code)) byCode.set(it.code, { cab, qty: 0 });
    byCode.get(it.code).qty += 1;
  }
  const lines = [];
  let totalCabs = 0, subtotal = 0, applianceCount = 0;
  for (const { cab, qty } of byCode.values()) {
    const supplied = !cab.notSupplied;
    const each = sellUSD(cab);
    const line = each * qty;
    if (supplied) { totalCabs += qty; subtotal += line; }
    else applianceCount += qty;
    lines.push({
      code: cab.code, type: cab.type, desc: cab.desc, qty,
      dims: cab.h ? `${fmtIn(cab.w)} × ${fmtIn(cab.d)} × ${fmtIn(cab.h)}` : '—',
      each, line, notSupplied: !supplied,
    });
  }
  // auto fillers (one priced line)
  if (fillers && fillers.length) {
    const each = FILLER_SELL;
    subtotal += each * fillers.length;
    lines.push({
      code: 'FILL', type: 'ACCESSORIES', desc: 'Filler panel (painted, to fit)',
      qty: fillers.length, dims: fillers.map((f) => fmtIn(f.w)).join(', '),
      each, line: each * fillers.length, notSupplied: false, filler: true,
    });
  }
  // cornice / crown molding (one priced line, by linear foot)
  if (cornice && cornice.profile && cornice.profile !== 'none' && cornice.totalIn > 0.5) {
    const opt = corniceOption(cornice.profile);
    const ft = cornice.totalIn / 12;
    const each = opt.sellPerFt * ft;
    subtotal += each;
    lines.push({
      code: opt.code || 'CORN', type: 'ACCESSORIES', desc: `${opt.label} (${ft.toFixed(1)} lin ft)`,
      qty: 1, dims: '—', each, line: each, notSupplied: false, cornice: true,
    });
  }

  // loose accessories the customer ticked on (cutlery inserts, end panels, …)
  for (const [code, qty] of Object.entries(accessories || {})) {
    const acc = getCab(code);
    if (!acc || !(qty > 0)) continue;
    const each = sellUSD(acc);
    subtotal += each * qty;
    lines.push({
      code: acc.code, type: 'ACCESSORIES', desc: acc.desc, qty, dims: '—',
      each, line: each * qty, notSupplied: false, accessory: true,
    });
  }

  // finished end panels for exposed island backs
  if (endPanels > 0) {
    const ep = getCab('A2');
    const each = ep ? sellUSD(ep) : 330;
    subtotal += each * endPanels;
    lines.push({
      code: 'A2', type: 'ACCESSORIES', desc: 'End panel (finished island back)',
      qty: endPanels, dims: '—', each, line: each * endPanels, notSupplied: false, endPanel: true,
    });
  }

  // stable order by family then code
  const order = { FLOOR: 0, WALL: 1, SHELF: 2, COUNTER: 3, TALL: 4, APPLIANCES: 5, ACCESSORIES: 6 };
  lines.sort((a, b) => (order[a.type] - order[b.type]) || a.code.localeCompare(b.code, 'en', { numeric: true }));
  return { lines, totalCabs, subtotal, applianceCount };
}
