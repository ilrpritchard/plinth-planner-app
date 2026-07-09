// units.js — single source of truth for measurements.
//
// The whole planner works in INCHES. One Three.js world unit === one inch.
// Plinth is a US company and its catalogue is specified in inches, so inches
// are the canonical internal unit and there is no per-frame conversion to do.
//
// A handful of construction constants (panel thickness, plinth height, drawer
// heights) are published in millimetres on the spec sheet, so we keep a tiny,
// tested mm->in helper and pre-convert those constants once here.

export const MM_PER_INCH = 25.4;

/** Millimetres -> inches. */
export function mmToIn(mm) {
  return mm / MM_PER_INCH;
}

/** Inches -> millimetres. */
export function inToMm(inches) {
  return inches * MM_PER_INCH;
}

// Plinth construction constants, converted from the published mm spec.
// (Taken from the F2 elevation: flush 115mm plinth, 22mm legs each side,
//  80mm face-frame stiles & rails.)
export const SPEC = {
  PANEL_IN: mmToIn(22),     // 22mm carcass panels
  LEG_IN: mmToIn(22),       // 22mm legs each side (visible carcass face edge)
  FRAME_IN: mmToIn(80),     // 80mm shaker stiles & rails (door/face frame)
  SHELF_IN: mmToIn(18),     // 18mm shelves, edge banded
  PLINTH_IN: mmToIn(115),   // 115mm plinth — FLUSH to the front, not set back
  // Floor drawer face heights (175 / 245 / 315mm) used for 3-drawer banks.
  DRAWER_FACES_IN: [mmToIn(175), mmToIn(245), mmToIn(315)],
  REVEAL_IN: 0.12,          // visual gap between adjacent door/drawer faces
};

const FRACTIONS = [
  [0, ''],
  [1 / 8, '⅛'], [1 / 4, '¼'], [3 / 8, '⅜'],
  [1 / 2, '½'], [5 / 8, '⅝'], [3 / 4, '¾'], [7 / 8, '⅞'],
];

/**
 * Format a length in inches for display, snapping the fractional part to the
 * nearest eighth and using nice unicode fractions, e.g. 28.5 -> 28½".
 * Matches the convention used in Plinth's existing costing tool.
 */
export function fmtIn(value) {
  if (!isFinite(value)) return '—';
  const neg = value < 0;
  let v = Math.abs(value);
  let whole = Math.floor(v);
  let frac = v - whole;
  // snap to nearest 1/8
  let best = FRACTIONS[0];
  let bestErr = Infinity;
  for (const f of FRACTIONS) {
    const err = Math.abs(frac - f[0]);
    if (err < bestErr) { bestErr = err; best = f; }
  }
  // handle rounding up to a whole inch (7/8 -> next inch)
  if (Math.abs(frac - 1) < Math.abs(frac - best[0])) { whole += 1; best = FRACTIONS[0]; }
  const sign = neg ? '-' : '';
  if (whole === 0 && best[1]) return `${sign}${best[1]}"`;
  return `${sign}${whole}${best[1]}"`;
}

/** Format inches as feet'inches" e.g. 96 -> 8' 0". Useful for wall lengths. */
export function fmtFeetIn(value) {
  if (!isFinite(value)) return '—';
  const neg = value < 0;
  const v = Math.abs(value);
  const ft = Math.floor(v / 12);
  const inch = v - ft * 12;
  const sign = neg ? '-' : '';
  if (ft === 0) return `${sign}${fmtIn(inch)}`;
  return `${sign}${ft}' ${fmtIn(inch)}`;
}

/** Parse a user string like 96, 96", 8', 8'6", 8' 6 1/2" into inches. */
export function parseLength(input) {
  if (typeof input === 'number') return input;
  if (!input) return NaN;
  let s = String(input).trim().toLowerCase();
  // feet'inches"
  const ftMatch = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(.*)$/);
  if (ftMatch) {
    const ft = parseFloat(ftMatch[1]);
    const rest = ftMatch[2].replace(/["\s]+$/, '').trim();
    const inch = rest ? parseLoose(rest) : 0;
    return ft * 12 + (isNaN(inch) ? 0 : inch);
  }
  return parseLoose(s.replace(/["]/g, '').trim());
}

// parse "28", "28.5", "28 1/2" -> number of inches
function parseLoose(s) {
  s = s.trim();
  if (s === '') return NaN;
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

/** Clamp helper. */
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
