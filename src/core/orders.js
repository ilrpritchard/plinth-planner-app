// orders.js — real trade orders: the immutable order snapshot that gets
// POSTed to Supabase, order-number minting, and status rollups for the
// ORDERS view. Pure and node-testable — same maths as tradeSummary /
// planPhases, this file never re-prices anything.
//
//   buildOrderSnapshot(trade, opts) → the jsonb `data` payload
//   genOrderNo(now)                 → 'PL-2607-K7WQ' (YYMM + 4 base32 chars)
//   STATUSES / statusLabel / statusRank
//   mergedPhases(order)             → phases with per-phase status filled in
//   orderStatusSummary(order)       → '2 of 5 phases shipped' style rollup

import { getCab, sellUSD } from './catalogue.js';
import { tradeSummary, unitQty, unitName } from './cost.js';
import { planPhases, batchWindow } from './phasing.js';
import { unitRev } from './submittal.js';
import { unitFindings } from './tradebook.js';

// ---- statuses ---------------------------------------------------------------
// The order in which an order (or a delivery phase) moves through PL/NTH's
// side. 'cancelled' sits outside the pipeline — owners can cancel while an
// order is still 'submitted'.
export const STATUSES = ['submitted', 'confirmed', 'in_production', 'shipped', 'delivered'];

export const STATUS_LABELS = {
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  in_production: 'In production',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function statusLabel(s) { return STATUS_LABELS[s] || String(s || ''); }

/** Pipeline position (0…4); 'cancelled' and unknowns rank -1. */
export function statusRank(s) { return STATUSES.indexOf(s); }

// ---- order numbers ------------------------------------------------------------
// 'PL-' + YYMM + '-' + 4 random chars from a base32 alphabet with the
// ambiguous 0/O/1/I removed — short enough to read over the phone.
export const ORDER_NO_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 chars

export function genOrderNo(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const yymm = String(d.getFullYear() % 100).padStart(2, '0') +
               String(d.getMonth() + 1).padStart(2, '0');
  const buf = new Uint8Array(4);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 256) | 0;
  let tail = '';
  for (let i = 0; i < 4; i++) tail += ORDER_NO_ALPHABET[buf[i] % 32];
  return `PL-${yymm}-${tail}`;
}

// ---- the snapshot -------------------------------------------------------------
/**
 * Freeze a trade project into an order payload. Everything PL/NTH needs to
 * build + price the order lives in here (the live project can keep changing
 * afterwards). `opts.now` (ms) pins dates for tests; `opts.orderNo` lets a
 * caller re-mint after a unique-collision retry.
 */
export function buildOrderSnapshot(trade, opts = {}) {
  const t = trade || { units: [] };
  const now = opts.now != null ? opts.now : Date.now();
  const s = tradeSummary(t);

  const unitTypes = [];
  for (const u of t.units || []) {
    const units = unitQty(u);
    const byCode = new Map();                       // collapse duplicate rows
    for (const r of u.rows || []) {
      const cab = getCab(r.code);
      if (!cab || cab.notSupplied) continue;
      const qty = Number(r.qty) || 0;
      if (!qty) continue;
      const cur = byCode.get(cab.code) || { code: cab.code, desc: cab.desc, qty: 0, each: sellUSD(cab) };
      cur.qty += qty;
      byCode.set(cab.code, cur);
    }
    const lines = [...byCode.values()].map((l) => ({ ...l, total: l.each * l.qty * units }));
    const ut = { name: unitName(u), bed: u.beds || '', rev: unitRev(u), units, lines };
    // the designed layout rides along (JSONB-ready) so the submittal pack can
    // be regenerated from the frozen order later — additive, may be absent
    if (u.design) {
      ut.design = u.design;
      if (u.revHistory) ut.revHistory = u.revHistory;
    }
    unitTypes.push(ut);
  }

  // delivery phases (only when phasing is on) — each gets an id + a status
  let phases = [];
  if (t.phasing && t.phasing.on) {
    const plan = planPhases(t, { maxUnitsPerBatch: t.phasing.maxPerBatch });
    phases = plan.batches.map((b) => {
      const w = batchWindow(b, now);
      return {
        id: `P${b.n}`, n: b.n, label: b.label, floors: b.floors,
        units: b.units, cabinets: b.cabinets,
        byType: b.byType.map((x) => ({ name: x.name, qty: x.qty })),
        window: { from: w.from, to: w.to },
        status: 'submitted',
      };
    });
  }

  // spec-check findings ride along so PL/NTH sees exactly what the buyer saw
  const specFindings = [];
  for (const u of t.units || []) {
    for (const f of unitFindings(u) || []) {
      specFindings.push({ unit: unitName(u), level: f.level, msg: f.msg });
    }
  }

  return {
    orderNo: opts.orderNo || genOrderNo(new Date(now)),
    placedAt: new Date(now).toISOString(),
    project: t.project || 'Untitled project',
    finish: t.finish || '',
    customer: opts.customer
      ? { name: opts.customer.name || '', email: opts.customer.email || '', notes: opts.customer.notes || '' }
      : null,
    unitTypes,
    phases,
    totals: { cabinets: s.totalCabs, subtotal: s.subtotal, shipping: s.shipping, grand: s.grand },
    specFindings,
  };
}

// ---- snapshot → trade adapter --------------------------------------------------
/**
 * Rebuild a trade-shaped object from a FROZEN order, so the existing document
 * builders (buildTradeOrderCSV / buildTradeWorkbook / buildSubmittalPackHTML)
 * can regenerate the order's paperwork without touching live trade state.
 * Accepts a Supabase row ({ data }) or a bare snapshot. Pure.
 *
 * Notes on fidelity: unit names, revs, quantities and cabinet rows round-trip
 * exactly (tradeSummary of the result matches snapshot.totals). Floor bands
 * and phasing are NOT reconstructed — the phase plan lives frozen on
 * snapshot.phases and must never be re-derived at a later date.
 */
export function snapshotToTrade(order) {
  const d = (order && order.data) || order || {};
  let rowId = 1;
  const units = (d.unitTypes || []).map((ut, i) => {
    const u = {
      id: i + 1,
      beds: ut.bed || '',
      letter: 'A',
      name: ut.name || '',                 // unitName() returns this verbatim
      qty: Number(ut.units) || 0,
      floorFrom: '', floorTo: '', perFloor: '',
      rev: ut.rev || 'A',
      rows: (ut.lines || []).map((l) => ({ id: rowId++, code: l.code, qty: Number(l.qty) || 0 })),
    };
    if (ut.design) u.design = ut.design;
    if (ut.revHistory) u.revHistory = ut.revHistory;
    return u;
  });
  return {
    project: d.project || 'Untitled project',
    finish: d.finish || '',
    units,
    phasing: { on: false },                // frozen plan lives on snapshot.phases
    nextUnitId: units.length + 1,
    nextRowId: rowId,
  };
}

// ---- issued documents ----------------------------------------------------------
// The docs hub regenerates paperwork deterministically from the snapshot and
// logs each issuance into order_documents (see SUPABASE_DOCS.sql). These
// constants MUST match the table's kind check constraint.
export const DOC_KINDS = ['submittal', 'workbook', 'csv', 'invoice_deposit', 'invoice_balance', 'change_order'];

export const DOC_LABELS = {
  submittal: 'Submittal pack',
  workbook: 'Project workbook',
  csv: 'Order CSV',
  invoice_deposit: 'Deposit invoice',
  invoice_balance: 'Balance invoice',
  change_order: 'Change order',
};

// ---- status rollups -------------------------------------------------------------
/**
 * The snapshot's phases with each phase's CURRENT status merged in. Accepts a
 * Supabase row ({ data, phase_status }) or a bare snapshot; unknown / missing
 * entries default to 'submitted'.
 */
export function mergedPhases(order) {
  if (!order) return [];
  const phases = (order.data && order.data.phases) || order.phases || [];
  const map = order.phase_status || order.phaseStatus || {};
  return phases.map((p) => ({
    ...p,
    status: (map && map[p.id] && STATUS_LABELS[map[p.id]]) ? map[p.id] : (p.status || 'submitted'),
  }));
}

/**
 * One-line status for an order row. Unphased (or single-phase) orders show
 * the order status; phased orders roll up: the furthest-along status any
 * phase has reached, with a count — '2 of 5 phases shipped',
 * 'All 3 phases delivered'. Cancelled always wins.
 */
export function orderStatusSummary(order) {
  if (!order) return '';
  if (order.status === 'cancelled') return STATUS_LABELS.cancelled;
  const phases = mergedPhases(order);
  if (phases.length < 2) return statusLabel(order.status || 'submitted');
  const best = Math.max(0, ...phases.map((p) => statusRank(p.status)));
  const there = phases.filter((p) => statusRank(p.status) >= best).length;
  const label = STATUS_LABELS[STATUSES[best]].toLowerCase();
  if (best === 0) return statusLabel('submitted');            // nothing moved yet
  if (there === phases.length) return `All ${phases.length} phases ${label}`;
  return `${there} of ${phases.length} phases ${label}`;
}
