// submittal.js — pure logic for the trade submittal pack (no DOM, node-testable).
//
// Computes, for each unit-type design: which walls carry cabinets, the 2D
// elevation layout of every wall (x-positions along the wall, mount heights,
// worktop / crown spans, scribe fillers, openings), the cabinet + finish
// schedule rows, the distinct-SKU list for cut sheets, and the revision-letter
// machinery (unit.rev, default 'A', bump A→B→C with a dated history).
//
// All lengths in INCHES. Elevations are drawn as seen from INSIDE the room
// facing the wall, so `s` runs left→right in the viewer's frame.

import { getCab, sellUSD, familyOf } from './catalogue.js';
import { rowsFromDesign } from './cost.js';
import { computeFillers } from './fillers.js';
import { openingCenter, openingWidth } from './openings.js';
import { SPEC } from './units.js';
import { hingeSummary, sharedHinge } from './hinge.js';

// mount heights — MUST match src/models/cabinet.js MOUNT (the 3D truth)
export const MOUNT = { FLOOR: 0, TALL: 0, WALL: 54, COUNTER: 36.5, SHELF: 54 };
export const SURFACE_Y = 36.5;              // top of the worktop
export const WORKTOP_SLAB = 1.5;            // 35" carcass + 1.5" slab = 36.5"
export const PLINTH_IN = SPEC.PLINTH_IN;    // 115mm flush plinth = 4.53"
export const CROWN_IN = 1.5;                // drawn crown band height

export const WALL_ORDER = ['back', 'left', 'right', 'front'];
const WALL_ROT = { back: 0, left: 90, front: 180, right: 270 };
const WALL_TOL = 12;   // back edge within this of the wall counts as "on it"

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Mount height (bottom Y) for a catalogue entry — same numbers as the 3D. */
export function mountY(cab) {
  if (typeof cab.mountY === 'number') return cab.mountY; // appliances/shelves carry their own
  return MOUNT[cab.type] ?? 0;
}

// ---- revision letters -----------------------------------------------------
/** 'A' → 'B' → … → 'Z' → 'AA' → 'AB' … */
export function nextRev(rev) {
  const s = String(rev || 'A').toUpperCase().replace(/[^A-Z]/g, '') || 'A';
  const chars = s.split('');
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] !== 'Z') { chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1); return chars.join(''); }
    chars[i] = 'A'; i--;
  }
  return 'A' + chars.join('');
}

export function unitRev(unit) { return (unit && unit.rev) || 'A'; }

/** Bump unit.rev (default 'A' → 'B') and record { rev, date } on the unit. */
export function bumpRev(unit, date = new Date().toLocaleDateString('en-US')) {
  unit.rev = nextRev(unitRev(unit));
  unit.revHistory = (unit.revHistory || []).concat([{ rev: unit.rev, date }]);
  return unit.rev;
}

// ---- wall membership + the viewer's left→right coordinate -----------------
/** World (x,z) → distance along the wall, left→right as seen from inside. */
export function alongWall(room, wall, x, z) {
  const W = room.width, D = room.depth;
  if (wall === 'back') return x + W / 2;
  if (wall === 'front') return W / 2 - x;
  if (wall === 'left') return D / 2 - z;
  return z + D / 2; // right
}

export function wallLength(room, wall) {
  return (wall === 'left' || wall === 'right') ? room.depth : room.width;
}

/** Distance from the item's BACK edge to its wall (negative = inside the wall). */
function backGap(room, wall, it, cab) {
  const W2 = room.width / 2, D2 = room.depth / 2;
  if (wall === 'back') return (it.z - cab.d / 2) + D2;
  if (wall === 'front') return D2 - (it.z + cab.d / 2);
  if (wall === 'left') return (it.x - cab.d / 2) + W2;
  return W2 - (it.x + cab.d / 2); // right
}

/** Placed items standing against `wall`: rotation faces into the room AND the
 *  back edge sits near the wall. Islands never belong to a wall. */
export function itemsOnWall(design, wall) {
  const out = [];
  for (const it of design.items || []) {
    if (it.island) continue;
    const cab = getCab(it.code);
    if (!cab || !cab.placeable) continue;
    const rot = (((it.rotDeg || 0) % 360) + 360) % 360;
    if (rot !== WALL_ROT[wall]) continue;
    const gap = backGap(design.room, wall, it, cab);
    if (gap > WALL_TOL || gap < -1) continue;
    const sc = alongWall(design.room, wall, it.x, it.z);
    // corner units carry a blank return BEYOND the door (+20" floor / +10"
    // wall) — retS0/retS1 report the full drawn run so worktop/crown/dims
    // can cover it
    const ret = cab.corner ? (cab.type === 'WALL' ? 10 : 20) : 0;
    const retRight = cab.cornerSide === 'right';
    const s0 = sc - cab.w / 2;
    out.push({
      it, cab,
      code: cab.baseCode || cab.code,
      s0, w: cab.w,
      retW: ret, retSide: ret ? (retRight ? 'right' : 'left') : null,
      runS0: ret && !retRight ? s0 - ret : s0,
      runS1: ret && retRight ? s0 + cab.w + ret : s0 + cab.w,
      y0: mountY(cab), h: cab.h,
      type: cab.type, form: cab.form,
      glazed: !!cab.glazed, notSupplied: !!cab.notSupplied,
    });
  }
  out.sort((a, b) => a.s0 - b.s0);
  return out;
}

/** Walls (in drawing order) that actually carry cabinets. */
export function wallsWithItems(design) {
  return WALL_ORDER.filter((w) => itemsOnWall(design, w).length > 0);
}

// ---- fillers + openings on a wall -----------------------------------------
const FILLER_WALL = { 0: 'back', 90: 'left', 180: 'front', 270: 'right' };

export function fillersOnWall(design, wall) {
  const out = [];
  for (const f of computeFillers(design)) {
    const rot = (((f.rotDeg || 0) % 360) + 360) % 360;
    if (FILLER_WALL[rot] !== wall) continue;
    const sc = alongWall(design.room, wall, f.x, f.z);
    out.push({ s0: sc - f.w / 2, w: f.w, y0: 0, h: f.h });
  }
  out.sort((a, b) => a.s0 - b.s0);
  return out;
}

/** Openings on this wall with their true vertical extents (same numbers as the
 *  3D room: Room.js _addOpening). */
export function openingsOnWall(design, wall) {
  const room = design.room;
  const H = room.height || 96;
  const out = [];
  for (const o of room.openings || []) {
    if ((o.wall || 'back') !== wall) continue;
    const w = openingWidth(o, room);
    const c = openingCenter(room, o);           // world coord along the wall axis
    const sc = (wall === 'back' || wall === 'front')
      ? alongWall(room, wall, c, 0)
      : alongWall(room, wall, 0, c);
    const isWindow = o.type === 'window';
    let h = isWindow ? (o.hgt || Math.min(46, H * 0.45)) : Math.min(82, H * 0.86);
    let sill = isWindow ? (o.sill ?? Math.max(36, H * 0.42)) : 0;
    sill = Math.max(0, Math.min(sill, H - 6));
    h = Math.max(6, Math.min(h, H - sill));
    out.push({ type: o.type, s0: sc - w / 2, w, y0: sill, h });
  }
  return out;
}

// ---- span merging (worktop + crown runs) -----------------------------------
function mergeSpans(spans, tol) {
  const sorted = [...spans].sort((a, b) => a.s0 - b.s0);
  const out = [];
  for (const sp of sorted) {
    const last = out[out.length - 1];
    if (last && sp.s0 - last.s1 <= tol && Math.abs((sp.top ?? 0) - (last.top ?? 0)) < 0.6) {
      last.s1 = Math.max(last.s1, sp.s0 + sp.w);
    } else out.push({ s0: sp.s0, s1: sp.s0 + sp.w, top: sp.top });
  }
  return out;
}

// ---- the elevation for one wall --------------------------------------------
/**
 * Everything a 2D front-view elevation needs, computed once, pure:
 *   items    — cabinets/appliances on the wall (left→right, true x + mount)
 *   fillers  — scribe fillers (hatched on the drawing)
 *   openings — windows/doors, dashed, at their true sill/head heights
 *   worktops — spans carrying the 36½" worktop line (base runs, not ranges)
 *   crowns   — crown-molding spans over uppers/talls (when cornice is on)
 *   chain    — bottom dimension chain: base widths + italic gaps + overall run
 */
export function computeElevation(design, wall) {
  const room = design.room;
  const items = itemsOnWall(design, wall);
  const fillers = fillersOnWall(design, wall);
  const openings = openingsOnWall(design, wall);
  const L = wallLength(room, wall);
  const H = room.height || 96;

  // worktop spans: contiguous FLOOR cabinets (incl. corner returns) + base fillers
  const wtSpans = items
    .filter((i) => i.type === 'FLOOR')
    .map((i) => ({ s0: i.runS0 ?? i.s0, w: (i.runS1 ?? i.s0 + i.w) - (i.runS0 ?? i.s0), top: 0 }))
    .concat(fillers.filter((f) => f.h <= 40).map((f) => ({ s0: f.s0, w: f.w, top: 0 })));
  const worktops = mergeSpans(wtSpans, 1.0).map((s) => ({ s0: s.s0, s1: s.s1 }));

  // crown spans over WALL / TALL / COUNTER tops (+ tall scribe fillers)
  let crowns = [];
  if ((room.cornice || 'none') !== 'none') {
    const spans = items
      .filter((i) => i.type === 'WALL' || i.type === 'TALL' || i.type === 'COUNTER')
      .map((i) => ({ s0: i.runS0 ?? i.s0, w: (i.runS1 ?? i.s0 + i.w) - (i.runS0 ?? i.s0), top: i.y0 + i.h }))
      .concat(fillers.filter((f) => f.h >= 80).map((f) => ({ s0: f.s0, w: f.w, top: f.h })));
    crowns = mergeSpans(spans, 2.5).map((s) => ({ s0: s.s0, s1: s.s1, top: s.top }));
  }

  // bottom chain: floor-standing widths (talls, bases, ranges/fridges), gaps italic
  const baseline = items.filter((i) =>
    i.y0 === 0 && (i.type === 'FLOOR' || i.type === 'TALL' ||
      (i.type === 'APPLIANCES' && ['range', 'fridge'].includes(i.cab.appliance))));
  const segs = [];
  let cur = null;
  for (const c of baseline) {
    const s = c.runS0 ?? c.s0, e = c.runS1 ?? c.s0 + c.w;
    if (cur != null && s - cur > 0.75) segs.push({ a: cur, b: s, gap: true });
    segs.push({ a: Math.max(cur ?? s, s), b: e });
    cur = Math.max(cur ?? e, e);
  }
  const chain = segs.length
    ? { segs, lo: segs[0].a, hi: segs[segs.length - 1].b }
    : { segs: [], lo: 0, hi: 0 };

  return { wall, wallLen: L, height: H, items, fillers, openings, worktops, crowns, chain };
}

// ---- schedule + cut-sheet data ----------------------------------------------
/** Cabinet schedule: the KEY-table data priced with rowsFromDesign quantities.
 *  `hinge` says how the row's doors hang ('Left' | 'Right' | 'Pair' |
 *  '1 Left · 2 Right' | '') — the workshop hangs the doors, so it is part of
 *  the order. */
export function scheduleRows(design) {
  const rows = rowsFromDesign(design.items).map((r) => {
    const cab = getCab(r.code);
    const each = sellUSD(cab);
    return {
      code: cab.code, desc: cab.desc, type: familyOf(cab),   // display family (stackers get their own)
      hinge: hingeSummary(cab, (design.items || []).filter((it) => it.code === r.code), true),
      w: cab.w, d: cab.d, h: cab.h,
      qty: r.qty, each, line: each * r.qty,
    };
  });
  const subtotal = rows.reduce((t, r) => t + r.line, 0);
  return { rows, subtotal };
}

/** One entry per distinct supplied SKU in the design, with cut-sheet notes. */
export function distinctSkus(design) {
  const seen = new Map();
  for (const it of design.items || []) {
    const cab = getCab(it.code);
    if (!cab || !cab.placeable || cab.notSupplied) continue;
    seen.set(cab.code, (seen.get(cab.code) || []).concat([it]));
  }
  const order = { FLOOR: 0, WALL: 1, SHELF: 2, COUNTER: 3, TALL: 4 };
  return [...seen.entries()]
    .map(([code, its]) => {
      const cab = getCab(code), qty = its.length;
      const notes = [];
      const hung = hingeSummary(cab, its);           // the side(s) AS DESIGNED — doors ship hung, never site-selectable
      if (hung) notes.push(`Hinge: ${hung} (viewed facing the front)`);
      if (cab.corner) notes.push(`Corner unit — +${cab.type === 'FLOOR' ? 20 : 10}" blank return into the corner`);
      if (cab.notes) notes.push(cab.notes);
      if (cab.glazed) notes.push('Glazed door(s), clear glass');
      if (cab.type === 'FLOOR' || cab.type === 'TALL') notes.push('115mm (4½") painted plinth, flush fit');
      return { cab, code, qty, notes, hinge: sharedHinge(cab, its) };
    })
    .sort((a, b) => ((order[a.cab.type] ?? 9) - (order[b.cab.type] ?? 9))
      || a.code.localeCompare(b.code, 'en', { numeric: true }));
}

const WALL_TITLE = { back: 'BACK WALL', left: 'LEFT WALL', right: 'RIGHT WALL', front: 'FRONT WALL' };
export function wallTitle(wall) { return WALL_TITLE[wall] || wall.toUpperCase(); }

/** The drawing index shown on the cover: [{ no, title }]. */
export function drawingIndex(design) {
  const idx = [{ no: 'A-000', title: 'COVER & DRAWING INDEX' }, { no: 'A-100', title: 'FLOOR PLAN & KEY' }];
  wallsWithItems(design).forEach((w, i) => idx.push({ no: `A-2${String(i + 1).padStart(2, '0')}`, title: `ELEVATION — ${wallTitle(w)}` }));
  idx.push({ no: 'A-300', title: 'FINISH, HARDWARE & CABINET SCHEDULE' });
  const pages = Math.max(1, Math.ceil(distinctSkus(design).length / 3));
  for (let i = 0; i < pages; i++) idx.push({ no: `A-4${String(i + 1).padStart(2, '0')}`, title: `CABINET CUT SHEETS ${i + 1}/${pages}` });
  idx.push({ no: 'A-600', title: 'COMPLIANCE & PRODUCT DATA' });
  return idx;
}

// CSI MasterFormat section this submittal set is logged against. PL/NTH says
// CABINETS, never "casework" (Imogen's markup, 2026-09-18).
export const SPEC_SECTION = '06 41 00 — CABINETS';
