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
import { SPEC, MOUNT as UNIT_MOUNT, fmtIn } from './units.js';
import { hingeSummary, sharedHinge } from './hinge.js';

// mount heights — the one copy in core/units.js (the 3D uses the same)
export const MOUNT = { ...UNIT_MOUNT, SHELF: UNIT_MOUNT.WALL };
export const SURFACE_Y = 36.5;              // top of the worktop
export const WORKTOP_SLAB = 1.5;            // 35" carcass + 1.5" slab = 36.5"
export const PLINTH_IN = SPEC.PLINTH_IN;    // 115mm flush plinth = 4.53"
// crown, as built (models/cornice.js): plain = one 22mm bar, 15mm proud of the
// face; decorative = three stepped layers. [{ outer, h }] bottom → top, inches.
export const CROWN_PROFILE = {
  plain: [{ outer: 15 / 25.4, h: 22 / 25.4 }],
  decorative: [{ outer: 0.55, h: 0.6 }, { outer: 1.185, h: 0.75 }, { outer: 1.32, h: 0.28 }],
};
export const crownLayers = (profile) => CROWN_PROFILE[profile] || CROWN_PROFILE.plain;
export const CROWN_IN = CROWN_PROFILE.plain[0].h;   // kept for callers that only need the plain height
export const WT_OVERHANG = 1.0;                       // worktop lip past an OPEN run end (hard rule 8)
export const WT_ISLAND_END = 50 / 25.4;               // 50mm past each end of an island
const WT_WALL_NEAR = 9.6;                             // same reach as core/worktop-plan.js

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
    out.push(elevEntry(it, cab, alongWall(design.room, wall, it.x, it.z)));
  }
  out.sort((a, b) => a.s0 - b.s0);
  return out;
}

/** One drawable elevation entry for a placed item centred at `sc` along the run. */
function elevEntry(it, cab, sc) {
  // corner units carry a blank return BEYOND the door (+20" floor / +10"
  // wall) — retS0/retS1 report the full drawn run so worktop/crown/dims
  // can cover it
  const ret = cab.corner ? (cab.type === 'WALL' ? 10 : 20) : 0;
  const retRight = cab.cornerSide === 'right';
  const s0 = sc - cab.w / 2;
  return {
    it, cab,
    code: cab.baseCode || cab.code,
    s0, w: cab.w,
    retW: ret, retSide: ret ? (retRight ? 'right' : 'left') : null,
    runS0: ret && !retRight ? s0 - ret : s0,
    runS1: ret && retRight ? s0 + cab.w + ret : s0 + cab.w,
    y0: mountY(cab), h: cab.h,
    type: cab.type, form: cab.form,
    glazed: !!cab.glazed, notSupplied: !!cab.notSupplied,
  };
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

  const worktops = worktopSpans(items, fillers, L);

  // crown spans over WALL / TALL / COUNTER tops (+ tall scribe fillers)
  let crowns = [];
  if ((room.cornice || 'none') !== 'none') {
    const spans = items
      .filter((i) => i.type === 'WALL' || i.type === 'TALL' || i.type === 'COUNTER')
      .map((i) => ({ s0: i.runS0 ?? i.s0, w: (i.runS1 ?? i.s0 + i.w) - (i.runS0 ?? i.s0), top: i.y0 + i.h }))
      .concat(fillers.filter((f) => f.h >= 80).map((f) => ({ s0: f.s0, w: f.w, top: f.h })));
    crowns = mergeSpans(spans, 2.5).map((s) => ({ s0: s.s0, s1: s.s1, top: s.top }));
  }

  return { wall, wallLen: L, height: H, items, fillers, openings, worktops, crowns, crownProfile: room.cornice || 'none', chain: dimChain(items) };
}

/** Worktop spans: contiguous FLOOR cabinets (incl. corner returns) + base
 *  fillers, with each END resolved the way the 3D slab is (hard rule 8): it
 *  STOPS DEAD at a butting tall / range / fridge, runs on to a near wall, and
 *  only an open end carries the 1" lip (overL / overR; an island end = 50mm). */
function worktopSpans(items, fillers = [], wallLen = null, island = false) {
  const wtSpans = items
    .filter((i) => i.type === 'FLOOR')
    .map((i) => ({ s0: i.runS0 ?? i.s0, w: (i.runS1 ?? i.s0 + i.w) - (i.runS0 ?? i.s0), top: 0 }))
    .concat(fillers.filter((f) => f.h <= 40).map((f) => ({ s0: f.s0, w: f.w, top: 0 })));
  const stops = items.filter((i) => i.y0 === 0 && (i.type === 'TALL' ||
    (i.type === 'APPLIANCES' && ['range', 'fridge'].includes(i.cab.appliance))));
  return mergeSpans(wtSpans, 1.0).map((sp) => {
    const out = { s0: sp.s0, s1: sp.s1, overL: WT_OVERHANG, overR: WT_OVERHANG };
    if (island) { out.overL = out.overR = WT_ISLAND_END; return out; }
    const butL = stops.find((t) => Math.abs((t.runS1 ?? t.s0 + t.w) - sp.s0) <= 2);
    const butR = stops.find((t) => Math.abs((t.runS0 ?? t.s0) - sp.s1) <= 2);
    if (butL) { out.s0 = butL.runS1 ?? butL.s0 + butL.w; out.overL = 0; }
    else if (wallLen != null && sp.s0 <= WT_WALL_NEAR) { out.s0 = 0; out.overL = 0; }
    if (butR) { out.s1 = butR.runS0 ?? butR.s0; out.overR = 0; }
    else if (wallLen != null && wallLen - sp.s1 <= WT_WALL_NEAR) { out.s1 = wallLen; out.overR = 0; }
    return out;
  });
}

/** Bottom chain: floor-standing widths (talls, bases, ranges/fridges), gaps italic. */
function dimChain(items) {
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
  return segs.length
    ? { segs, lo: segs[0].a, hi: segs[segs.length - 1].b }
    : { segs: [], lo: 0, hi: 0 };
}

// ---- island elevations --------------------------------------------------------
// An island belongs to no wall, so each FACE of it gets its own elevation: the
// island cabinets sharing one rotation and one row line, seen from the side
// their fronts face (a double-sided island = two faces, back to back). A sink or
// cooktop riding in an island base is drawn with that base's face.
const ROT_WALL = { 0: 'back', 90: 'left', 180: 'front', 270: 'right' };
const FACES_TOWARD = { 0: 'FRONT WALL', 90: 'RIGHT WALL', 180: 'BACK WALL', 270: 'LEFT WALL' };
const rotOf = (it) => (((Math.round(it.rotDeg || 0)) % 360) + 360) % 360;

/** The island's faces, in a stable order: [{ rot, items, title, toward }]. */
export function islandFaces(design) {
  const faces = [];
  const bases = (design.items || []).filter((it) => it.island && getCab(it.code)?.placeable && getCab(it.code).type !== 'APPLIANCES');
  const perp = (it) => (rotOf(it) % 180 === 0 ? it.z : it.x);
  for (const it of bases) {
    if (!(rotOf(it) in ROT_WALL)) continue;
    let f = faces.find((g) => g.rot === rotOf(it) && Math.abs(g.perp - perp(it)) <= 6);
    if (!f) { f = { rot: rotOf(it), perp: perp(it), items: [] }; faces.push(f); }
    f.items.push(it);
  }
  // riders (sink / cooktop / range) standing in or on a face's footprint
  for (const r of design.items || []) {
    const rc = getCab(r.code);
    if (!rc || rc.type !== 'APPLIANCES' || !rc.placeable) continue;
    const f = faces.find((g) => g.rot === rotOf(r) && g.items.some((b) => {
      const bc = getCab(b.code), hz = g.rot % 180 === 0;
      return Math.abs((hz ? r.x - b.x : r.z - b.z)) < bc.w / 2 && Math.abs((hz ? r.z - b.z : r.x - b.x)) < bc.d / 2;
    }));
    if (f) f.items.push(r);
    else if (r.island && rotOf(r) in ROT_WALL) {                    // a free-standing island range
      const g = faces.find((h) => h.rot === rotOf(r) && Math.abs(h.perp - perp(r)) <= 6);
      if (g) g.items.push(r); else faces.push({ rot: rotOf(r), perp: perp(r), items: [r] });
    }
  }
  faces.sort((a, b) => a.rot - b.rot || a.perp - b.perp);
  const many = (rot) => faces.filter((f) => f.rot === rot).length > 1;
  const count = {};
  return faces.map((f) => {
    count[f.rot] = (count[f.rot] || 0) + 1;
    const toward = FACES_TOWARD[f.rot];
    return { rot: f.rot, items: f.items, toward, title: `SIDE FACING ${toward}${many(f.rot) ? ` (${count[f.rot]})` : ''}` };
  });
}

/** Island faces grouped onto sheets: two faces a sheet (a double-sided island
 *  is ONE sheet, front over back). */
export function islandSheets(design) {
  const faces = islandFaces(design), out = [];
  for (let i = 0; i < faces.length; i += 2) out.push(faces.slice(i, i + 2));
  return out;
}

/** Same shape as computeElevation, for one island face: no wall, no openings,
 *  no fillers or crown; `s` starts at the face's own left end. */
export function computeIslandElevation(design, face) {
  const wall = ROT_WALL[face.rot];
  const raw = face.items.map((it) => elevEntry(it, getCab(it.code), alongWall(design.room, wall, it.x, it.z)));
  const lo = Math.min(...raw.map((e) => e.runS0));
  const items = raw.map((e) => ({ ...e, s0: e.s0 - lo, runS0: e.runS0 - lo, runS1: e.runS1 - lo })).sort((a, b) => a.s0 - b.s0);
  const hi = Math.max(...items.map((e) => e.runS1));
  const top = Math.max(SURFACE_Y, ...items.map((e) => e.y0 + (e.cab.appliance === 'sink' ? 18 : e.h)));
  return {
    wall: null, island: true, title: face.title, toward: face.toward,
    refLen: Math.max(design.room.width, design.room.depth),   // draw at the wall elevations' scale, not blown up to the sheet
    wallLen: hi, height: top + 8, items, fillers: [], openings: [],
    worktops: worktopSpans(items, [], null, true), crowns: [], chain: dimChain(items),
  };
}

// ---- schedule + cut-sheet data ----------------------------------------------
/** Cabinet schedule: the KEY-table data priced with rowsFromDesign quantities.
 *  `hinge` says how the row's doors hang ('Left' | 'Right' | 'Pair' |
 *  '1 Left · 2 Right' | '') — the workshop hangs the doors, so it is part of
 *  the order. */
export function scheduleRows(design) {
  const rows = rowsFromDesign(design.items, design.accessories).map((r) => {
    const cab = getCab(r.code);
    const each = sellUSD(cab);
    if (cab.type === 'ACCESSORIES') {            // drawer inserts etc: priced, no size / hinge
      return { code: cab.code, desc: cab.desc, type: 'ACCESSORIES', hinge: '', w: 0, d: 0, h: 0, qty: r.qty, each, line: each * r.qty, accessory: true };
    }
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
      // the same facts as a label / value GRID for the cut card
      const specs = [['Size', `W ${fmtIn(cab.w)} · D ${fmtIn(cab.d)} · H ${fmtIn(cab.h)}`]];   // (quantity rides in the card's header)
      if (hung) specs.push(['Hinge', hung]);
      if (cab.corner) specs.push(['Corner', `+${cab.type === 'FLOOR' ? 20 : 10}" blank return into the corner`]);
      if (cab.glazed) specs.push(['Glazing', 'Clear glass']);
      if (cab.type === 'FLOOR' || cab.type === 'TALL') specs.push(['Plinth', '4½" (115mm) painted, flush fit']);
      if (cab.notes) specs.push(['Detail', cab.notes]);
      if (cab.corner) notes.push(`Corner unit — +${cab.type === 'FLOOR' ? 20 : 10}" blank return into the corner`);
      if (cab.notes) notes.push(cab.notes);
      if (cab.glazed) notes.push('Glazed door(s), clear glass');
      if (cab.type === 'FLOOR' || cab.type === 'TALL') notes.push('4½" (115mm) painted plinth, flush fit');
      return { cab, code, qty, notes, specs, hinge: sharedHinge(cab, its) };
    })
    .sort((a, b) => ((order[a.cab.type] ?? 9) - (order[b.cab.type] ?? 9))
      || a.code.localeCompare(b.code, 'en', { numeric: true }));
}

// ---- cut-sheet pagination -------------------------------------------------------
// Up to SIX cards a page (rows of three), every glyph at ONE scale so the
// cabinets stay mutually to scale. Talls are tall: a page takes as many rows
// as fit its height budget, so two rows of bases share a page but two rows of
// talls never overflow it (the sheet clips, it cannot grow).
export const CUT_MM_PER_IN = 0.56;
// measured in Chrome: the sheet body holds 154mm of cards under the tallest
// (4-line) title block; a base card prints ~56mm, a tall ~87mm
const CUT_PAGE_MM = 150, CUT_ROW_GAP_MM = 6;

/** Estimated printed height (mm) of one cut card. */
export function cutCardMM(sku) {
  const lines = (sku.specs || []).reduce((t, [, v]) => t + Math.ceil(String(v).length / 46), 0);
  return (sku.cab.h + 18) * CUT_MM_PER_IN + 13 + lines * 3.7;
}

/** skus → pages → the skus on each page (rows of 3, max 2 rows a page). */
export function cutSheetPages(skus) {
  const rows = [];
  for (let i = 0; i < skus.length; i += 3) rows.push(skus.slice(i, i + 3));
  const pages = [];
  let cur = null, used = 0;
  for (const row of rows) {
    const h = Math.max(...row.map(cutCardMM));
    if (!cur || cur.rows === 2 || used + CUT_ROW_GAP_MM + h > CUT_PAGE_MM) { cur = { rows: 0, skus: [] }; pages.push(cur); used = 0; }
    used += (cur.rows ? CUT_ROW_GAP_MM : 0) + h;
    cur.rows++; cur.skus.push(...row);
  }
  return pages.length ? pages.map((p) => p.skus) : [[]];
}

const WALL_TITLE = { back: 'BACK WALL', left: 'LEFT WALL', right: 'RIGHT WALL', front: 'FRONT WALL' };
export function wallTitle(wall) { return WALL_TITLE[wall] || wall.toUpperCase(); }

/** The drawing index shown on the cover: [{ no, title }]. */
export function drawingIndex(design) {
  const idx = [{ no: 'A-000', title: 'COVER & DRAWING INDEX' }, { no: 'A-100', title: 'FLOOR PLAN & KEY' }];
  const walls = wallsWithItems(design);
  walls.forEach((w, i) => idx.push({ no: `A-2${String(i + 1).padStart(2, '0')}`, title: `ELEVATION — ${wallTitle(w)}` }));
  const isl = islandSheets(design);           // an island's faces share sheets, two to a sheet
  isl.forEach((_, i) => idx.push({ no: `A-2${String(walls.length + i + 1).padStart(2, '0')}`, title: `ELEVATION — ISLAND${isl.length > 1 ? ` ${i + 1}/${isl.length}` : ''}` }));
  idx.push({ no: 'A-300', title: 'FINISH, HARDWARE & CABINET SCHEDULE' });
  const pages = cutSheetPages(distinctSkus(design)).length;
  for (let i = 0; i < pages; i++) idx.push({ no: `A-4${String(i + 1).padStart(2, '0')}`, title: `CABINET CUT SHEETS ${i + 1}/${pages}` });
  idx.push({ no: 'A-600', title: 'PRODUCT SPECIFICATION' });
  return idx;
}

// CSI MasterFormat section this submittal set is logged against. PL/NTH says
// CABINETS, never "casework" (Imogen's markup, 2026-09-18).
export const SPEC_SECTION = '06 41 00 — CABINETS';
