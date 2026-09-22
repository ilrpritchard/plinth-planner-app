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
// Mount heights (bottom of the box above the finished floor, inches) — the ONE
// copy: 3D, elevations, DXF, IFC, cornice and warnings all import this.
// WALL = 56 so a 30" wall cabinet tops out at 86", LEVEL WITH THE TALLS (her
// rule 2026-09-18: "wall cabinets would always align with the tall cabinet at
// the top"; was 54 / 84"). Leaves 19½" between worktop and upper.
// the worktop: a 35" base carcass under a 30mm slab (her spec 2026-09-22; was assumed 1.5").
// EVERYTHING at counter height reads from here: sinks and cooktops, counter cabinets, the
// elevation datum, the 3D slab.
export const WORKTOP_MM = 30;
export const WORKTOP_SLAB = mmToIn(WORKTOP_MM);
// COOKER CLEARANCES (her rule 2026-09-22, "800mm, 18 inches and then 50mm either side of the
// range, it also looks better"): the hood 800mm over the hob (core/hoodseat.js), 18" of counter
// to any tall / counter unit (layouts.js RANGE_CLEAR, warnings.js), and wall cabinets keep
// 50mm clear of the cooker's edges either side (wizard uppers, list-to-3D, drag, warning).
export const COOK_SIDE_MM = 50;
export const COOK_SIDE_IN = mmToIn(COOK_SIDE_MM);
export const SURFACE_Y = 35 + WORKTOP_SLAB;                  // 36.18": top of the worktop
export const MOUNT = { FLOOR: 0, TALL: 0, WALL: 56, COUNTER: SURFACE_Y };
export const WALL_H = 30, TALL_H = 86;

export const SPEC = {
  PANEL_IN: mmToIn(22),     // 22mm carcass panels
  LEG_IN: mmToIn(22),       // 22mm legs each side (visible carcass face edge)
  FRAME_IN: mmToIn(80),     // 80mm shaker stiles & rails (door/face frame)
  SHELF_IN: mmToIn(18),     // 18mm shelves, edge banded
  PLINTH_IN: mmToIn(115),   // 115mm plinth — FLUSH to the front, not set back
  // Floor drawer face heights (175 / 245 / 315mm) used for 3-drawer banks.
  DRAWER_FACES_IN: [mmToIn(175), mmToIn(245), mmToIn(315)],
  REVEAL_IN: 0.12,          // visual gap between adjacent door/drawer faces
  // COUNTER cabinets (the C range, standing on the worktop): two shelves, the first
  // 400mm up from the counter, the second halfway between it and the top (her spec 2026-09-22)
  COUNTER_SHELF1_IN: mmToIn(400),
  COUNTER_SHELVES: 2,
};

/** Shelf TOPS for a counter cabinet, in inches up from the counter it stands on:
 *  the first at 400mm, the rest sharing the space up to `innerTop` (the underside of
 *  the top panel) equally. */
export function counterShelfTops(innerTop, n = SPEC.COUNTER_SHELVES) {
  const t = SPEC.SHELF_IN, first = SPEC.COUNTER_SHELF1_IN;
  if (innerTop - first < 2 * t) return [];
  const gap = (innerTop - first - n * t) / n;                       // equal clear space between shelves and up to the top
  return Array.from({ length: n }, (_, k) => first + k * (gap + t));
}

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

/** Parse a user string like 96, 96", 8', 8'6", 8' 6 1/2" into inches. Also takes what
 *  people really type: 16ft, 16 ft 6 in, 16 feet, 16-6, and the CURLY quotes / primes a Mac
 *  keyboard or a phone swaps in for ' and " (12’ 6” used to read as 12 INCHES). */
export function parseLength(input) {
  if (typeof input === 'number') return input;
  if (!input) return NaN;
  let s = String(input).trim().toLowerCase()
    .replace(/[\u2018\u2019\u2032\u02b9`\u00b4]/g, "'").replace(/[\u201c\u201d\u2033\u02ba]/g, '"').replace(/''/g, '"')
    .replace(/\s*(feet|foot|ft)\.?\s*/g, "' ").replace(/\s*(inches|inch|in)\.?\s*$/g, '"').replace(/\s*(inches|inch|in)\.?\s+/g, '" ')
    .replace(/^(\d+)\s*-\s*(\d+(?:\s+\d+\/\d+)?)\s*"?$/, "$1' $2")          // 16-6 = 16' 6"
    .trim();
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

/** A ROOM dimension, as typed. Same as parseLength, plus: a BARE number under 36 is FEET.
 *  (Her catch 2026-09-21: the box shows 12' 6", she types 16 to make it 16 ft, and it
 *  became a 16 INCH room. No kitchen wall or ceiling is under 3 ft, so 8, 10, 12, 16 can
 *  only mean feet; 150 still means inches.) Used by the Room panel AND the drafting wizard. */
export function parseRoomLength(input) {
  const raw = String(input ?? '').trim();
  const v = parseLength(raw);
  if (!isFinite(v) || v <= 0) return NaN;
  const bare = /^\d+(?:\.\d+)?$/.test(raw);
  return bare && v < 36 ? v * 12 : v;
}

/** Clamp helper. */
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
