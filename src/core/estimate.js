// estimate.js — the first thing the Project tab shows: an estimate from the unit
// mix alone, before any kitchen is laid out. A developer types how many kitchens
// of each type the building has and reads a range for the project.
//
// The range is read from the live catalogue, never typed in: six reference
// kitchens (three plain galleys of 8, 10 and 12 cabinets, and The Morgan's three
// laid-out types) are priced at today's sell prices, and the lowest and highest
// price per cabinet among them become the two ends of the range. Reprice the
// catalogue and the estimate follows. Pure; no DOM.

import { getCab, sellUSD, volumeTier } from './catalogue.js';
import { DEMO_MIX } from './tradedemo.js';

/** The rows of the unit-mix form: cabinets in each kitchen and the opening
 *  number of kitchens (the 62-unit sample on plinthmade.com/how-it-works). */
export const ESTIMATE_TYPES = [
  { id: 'studio', beds: 'Studio', cabs: 6, units: 0 },
  { id: 'bed1', beds: '1 Bed', cabs: 8, units: 24 },
  { id: 'bed2', beds: '2 Bed', cabs: 10, units: 30 },
  { id: 'bed3', beds: '3 Bed', cabs: 12, units: 8 },
  { id: 'pent', beds: 'Penthouse', cabs: 16, units: 0 },
];

export const EST_MAX_UNITS = 999;
export const EST_MAX_CABS = 30;

// Plain kitchens with no tall housings: the lean end of the range.
const TYPICAL_KITCHENS = [
  [['F21', 1], ['F10', 1], ['F7', 1], ['F17', 1], ['F16', 1], ['W2', 1], ['W5', 1], ['W1', 1]],
  [['F21', 1], ['F10', 1], ['F7', 1], ['F17', 1], ['F16', 1], ['F18', 1], ['W2', 1], ['W5', 2], ['W1', 1]],
  [['F21', 1], ['F10', 1], ['F7', 1], ['F17', 1], ['F16', 1], ['F18', 1], ['F19', 1], ['F20', 1], ['W2', 1], ['W5', 1], ['W6', 1], ['W1', 1]],
];

/** Every kitchen the range is read from, as [code, qty] lists. */
export function referenceKitchens() {
  return [...TYPICAL_KITCHENS, ...DEMO_MIX.map((m) => m.cabs)];
}

function perCabinet(cabs) {
  let n = 0, usd = 0;
  for (const [code, qty] of cabs) {
    const cab = getCab(code);
    if (!cab || cab.notSupplied) continue;
    n += qty; usd += sellUSD(cab) * qty;
  }
  return n ? usd / n : 0;
}

/** { low, high }: sell dollars per cabinet across the reference kitchens. */
export function estimateRates() {
  const rates = referenceKitchens().map(perCabinet).filter((r) => r > 0);
  if (!rates.length) return { low: 0, high: 0 };
  return { low: Math.min(...rates), high: Math.max(...rates) };
}

/** Weeks in production from approved drawings, as published on the site:
 *  100 cabinets 5 to 6 weeks, 2,000 cabinets 12 to 14, straight line between. */
export function estimateLeadWeeks(cabs) {
  const f = Math.min(Math.max((cabs - 100) / 1900, 0), 1);
  return { lo: Math.round(5 + f * 7), hi: Math.round(6 + f * 8) };
}

const whole = (v, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};
const roundTo = (n, step) => Math.round(n / step) * step;

/**
 * mix: [{ id, beds, units, cabs }]. Types with no kitchens are left out.
 * Returns { lines, units, cabs, tier, low, high, weeks }: per-kitchen figures
 * are list (before volume pricing) to the nearest $100; the project range has
 * the volume tier applied, to the nearest $1,000.
 */
export function buildEstimate(mix) {
  const rate = estimateRates();
  const lines = [];
  let units = 0, cabs = 0;
  for (const m of mix || []) {
    const u = whole(m.units, EST_MAX_UNITS);
    const c = Math.max(1, whole(m.cabs, EST_MAX_CABS));
    if (!u) continue;
    lines.push({ id: m.id, beds: m.beds, units: u, cabs: c,
      low: roundTo(c * rate.low, 100), high: roundTo(c * rate.high, 100) });
    units += u; cabs += u * c;
  }
  const tier = volumeTier(units);
  const k = tier ? 1 - tier.pct / 100 : 1;
  return {
    lines, units, cabs, tier,
    low: roundTo(cabs * rate.low * k, 1000),
    high: roundTo(cabs * rate.high * k, 1000),
    weeks: cabs ? estimateLeadWeeks(cabs) : null,
  };
}

const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

/** "$1,325,000 to $1,542,000" */
export function fmtRange(low, high) {
  return low === high ? usd(low) : `${usd(low)} to ${usd(high)}`;
}

export function tierText(tier) {
  return tier ? `${tier.pct}%, from ${tier.min} units` : 'From 10 units';
}

/** Short tag carried on the lead so the mix can be read straight off it:
 *  "estimate:62u/588c/1 Bed 24x8, 2 Bed 30x10, 3 Bed 8x12" */
export function estimateLeadSource(est) {
  const mix = est.lines.map((l) => `${l.beds} ${l.units}x${l.cabs}`).join(', ');
  return `estimate:${est.units}u/${est.cabs}c/${mix}`.slice(0, 180);
}

/** Plain-text estimate for the email PL/NTH receives. */
export function estimateText(est) {
  const L = ['Estimate from the unit mix (PL/NNER, Project tab)', ''];
  for (const l of est.lines) {
    L.push(`${l.beds}: ${l.units} kitchens of ${l.cabs} cabinets, ${fmtRange(l.low, l.high)} per kitchen, list`);
  }
  L.push('', `Kitchens: ${est.units}`, `Cabinets: ${est.cabs.toLocaleString('en-US')}`,
    `Volume pricing: ${tierText(est.tier)}`);
  if (est.weeks) L.push(`In production: ${est.weeks.lo} to ${est.weeks.hi} weeks from approved drawings`);
  L.push(`The project: ${fmtRange(est.low, est.high)}`);
  return L.join('\n');
}
