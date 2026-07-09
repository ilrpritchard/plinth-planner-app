// speccheck.js — order validation for the Trade tab. Pure, node-testable.
//
// checkOrder(rows, unit)  — sanity-checks a manual cabinet order table
//                           (rows = [{ code, qty }]); `unit` gives the unit
//                           count for quantity-sanity checks.
// checkDesign(design)     — the geometric warnings from warnings.js PLUS the
//                           order-level rules that make sense on a design.
//
// Findings are { level, msg }: 'error' (red), 'warn' (amber), 'info' (neutral).
// Nothing here blocks an order — it just puts the question in front of the
// buyer before the email goes out.

import { getCab } from './catalogue.js';
import { computeWarnings } from './warnings.js';
import { computeFillers } from './fillers.js';
import { unitQty } from './cost.js';

export const LEVELS = ['error', 'warn', 'info'];
const RANK = { error: 0, warn: 1, info: 2 };

/** Sort errors → warns → infos, stable within a level. */
export function sortFindings(list) {
  return list.map((f, i) => [f, i])
    .sort((a, b) => ((RANK[a[0].level] ?? 9) - (RANK[b[0].level] ?? 9)) || (a[1] - b[1]))
    .map(([f]) => f);
}

/** A base cabinet a sink could drop into: full-depth floor cabinet, ≥24" wide,
 *  door or double front (not drawers/bins/trays/corners/appliance panels). */
export function isSinkBase(cab) {
  return !!cab && cab.type === 'FLOOR' && !cab.halfDepth && !cab.corner &&
    cab.w >= 24 && (cab.form === 'door' || cab.form === 'double');
}

/** Normalise [{code, qty}] → [{cab, qty}] for supplied, known codes. */
function resolve(rows) {
  const out = [];
  for (const r of rows || []) {
    const cab = getCab(r && r.code);
    const qty = Number(r && r.qty) || 0;
    if (!cab || qty <= 0) continue;
    out.push({ cab, qty });
  }
  return out;
}

/**
 * Spec-check a manual order table. `unit` (optional) is the trade unit-type
 * record — only unitQty(unit) is used, so { qty: n } works in tests.
 */
export function checkOrder(rows, unit = null) {
  const out = [];
  const lines = resolve(rows);
  if (!lines.length) return out;

  const qtyOf = (pred) => lines.reduce((t, l) => t + (pred(l.cab) ? l.qty : 0), 0);

  // ---- corner cabinets ----
  const corners = lines.filter((l) => l.cab.corner);
  if (corners.length) {
    out.push({ level: 'info', msg: 'Corner cabinets need a partner run at right angles — plan cabinets on the adjoining wall to meet the blank return.' });
    // two corners of the SAME hand in one kitchen is suspicious — an L needs
    // one, a U needs one left + one right
    const byHand = new Map();
    for (const l of corners) {
      const hand = `${l.cab.type}:${l.cab.cornerSide || 'either'}`;
      byHand.set(hand, (byHand.get(hand) || 0) + l.qty);
    }
    for (const [hand, q] of byHand) {
      if (q >= 2) {
        const side = hand.split(':')[1];
        out.push({ level: 'warn', msg: `${q}× ${side === 'either' ? '' : `${side}-hand `}corner cabinets in one kitchen — a U-shape usually takes one left + one right. Double-check the hands.` });
      }
    }
  }

  // ---- dishwasher panel (F7) ----
  const dwQty = qtyOf((c) => c.form === 'dishwasher');
  if (dwQty > 0) {
    out.push({ level: 'warn', msg: 'F7 is a dishwasher door panel only — appliances are supply-your-own, so confirm a dishwasher is being supplied for each unit.' });
    const sinkBases = qtyOf(isSinkBase);
    if (dwQty > sinkBases) {
      out.push({ level: 'warn', msg: `${dwQty}× dishwasher panels but only ${sinkBases}× sink-capable base cabinet${sinkBases === 1 ? '' : 's'} (24"+ door/double, full depth) — dishwashers plumb in beside a sink base.` });
    }
  }

  // ---- sink run: a kitchen with no floor cabinets can't take a sink ----
  const floorQty = qtyOf((c) => c.type === 'FLOOR');
  if (floorQty === 0) {
    out.push({ level: 'warn', msg: 'No floor cabinets in this order — every kitchen needs a sink run of base cabinets.' });
  } else if (qtyOf(isSinkBase) === 0) {
    out.push({ level: 'warn', msg: 'No sink-capable base cabinet (24"+ door or double, full depth) — every kitchen needs somewhere for the sink to drop in.' });
  }

  // ---- crown + fillers suggested on full-height kitchens ----
  // trim codes (A13/A14 crown, FILL fillers) aren't placeable catalogue SKUs,
  // so look at the RAW row codes rather than the resolved lines
  const hasTrim = (rows || []).some((r) =>
    ['A13', 'A14', 'CORN', 'FILL'].includes(String(r && r.code || '').toUpperCase()) && (Number(r && r.qty) || 0) > 0);
  const tallQty = qtyOf((c) => c.type === 'TALL');
  if (!hasTrim && floorQty > 0 && tallQty > 0) {
    out.push({ level: 'info', msg: 'No crown molding (A13/A14) or filler lines — floor + tall runs usually want scribe fillers and read best with crown. Designed units count these automatically.' });
  }

  // ---- quantity sanity: per-unit vs project-total mix-ups ----
  const units = unit ? unitQty(unit) : 0;
  if (units > 1) {
    for (const l of lines) {
      if (l.qty < units) continue;                    // ordinary per-unit qty
      const even = l.qty % units === 0;
      out.push({ level: 'info', msg: `${l.cab.code} qty ${l.qty} — quantities here are PER UNIT and this order covers ${units} units (${l.qty * units} total).${even ? ` If ${l.qty} was meant as a project total, enter ${l.qty / units} per unit instead.` : ' Is this per-unit or a project total?'}` });
    }
  }

  return sortFindings(out);
}

/**
 * Spec-check a DESIGNED unit: geometric warnings from warnings.js plus the
 * order-level rules that geometry can answer directly.
 */
export function checkDesign(design) {
  const out = computeWarnings(design).map((w) => ({ level: w.level, msg: w.msg }));
  const cabs = (design.items || [])
    .map((it) => getCab(it && it.code))
    .filter((c) => c && c.placeable);

  // dishwasher panel with no dishwasher (appliances are supply-your-own; the
  // catalogue has no dishwasher appliance, so this is always a confirm-note)
  if (cabs.some((c) => c.form === 'dishwasher')) {
    out.push({ level: 'warn', msg: 'F7 is a dishwasher door panel only — appliances are supply-your-own, so confirm a dishwasher is being supplied.' });
  }

  // no sink placed → no sink run
  if (cabs.length && !cabs.some((c) => c.appliance === 'sink')) {
    out.push({ level: 'warn', msg: 'No sink in this design — every kitchen needs a sink run. Place a sink so the rough-in sheet can locate the plumbing.' });
  }

  // two corner units of the same hand
  const byHand = new Map();
  for (const c of cabs) {
    if (!c.corner) continue;
    const hand = `${c.type}:${c.cornerSide || 'either'}`;
    byHand.set(hand, (byHand.get(hand) || 0) + 1);
  }
  for (const [hand, q] of byHand) {
    if (q >= 2) {
      const side = hand.split(':')[1];
      out.push({ level: 'warn', msg: `${q}× ${side === 'either' ? '' : `${side}-hand `}corner cabinets in one design — a U-shape usually takes one left + one right. Double-check the hands.` });
    }
  }

  // full-height design with no crown selected (fillers auto-compute)
  const tall = cabs.some((c) => c.type === 'TALL' || c.type === 'WALL' || c.type === 'COUNTER');
  if (tall && (design.room?.cornice || 'none') === 'none' && computeFillers(design).length === 0) {
    out.push({ level: 'info', msg: 'No crown molding selected and no scribe fillers generated — full-height runs usually read best with crown.' });
  }

  return sortFindings(out);
}
