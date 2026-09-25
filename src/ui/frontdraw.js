// frontdraw.js — ONE renderer for the master-library cabinet fronts.
//
// The client's product library draws every SKU the same way (all mm, converted
// here to inches): 22mm carcass/leg lines full height both sides, a 35mm top
// rail, a flush 115mm plinth on floor/tall units (45mm bottom rail on wall
// units, 3mm shadow gap on counterstanding), 80mm shaker stiles & rails around
// recessed door panels, plain drawer faces split 175 / 245 / 315 top→bottom,
// two 18mm shelves seen through glazed doors, tall doors of two panels
// (1184 over a 200 rail over 490), larder-with-drawers (1100 door over a 35
// gap over the stack), hatched blank corner returns (+20" floor / +10" wall),
// and the dishwasher panel with NO legs or end strips. No knobs.
//
// frontParts(cab) is pure geometry (node-tested); drawFront() turns the parts
// into SVG in the shared PLAN_STYLE, and is used by the elevation sheets, the
// cut sheets AND the Trade cabinet picker so all three always match.
//
// Appliances are NOT PL/NTH products: they draw in GREY (filled, never ink) as
// what they are — a range with its oven door and control rail, a faucet where
// a sink sits below the worktop, a cooktop slab, a hood, a fridge — so an
// approver separates "by others" from the cabinetry at a glance.
// opts.hinge ('L' | 'R' | 'PAIR', from core/hinge.js) adds the elevation
// convention for door swing: dashed diagonals that MEET AT THE HINGE SIDE.

import { mmToIn, counterShelfTops } from '../core/units.js';
import { PLAN_STYLE as P, svgLine, svgN as n } from './floorplan.js';
import { esc } from '../core/submittal.js';
import { rangeSpec } from '../core/rangespec.js';
import { ovenSeat } from '../core/ovenseat.js';

// master-library constants, mm → inches (same numbers as core/dxf.js)
export const FD = {
  E: mmToIn(22),            // end strips / legs, full height both sides
  TOP: mmToIn(35),          // top rail
  PLINTH: mmToIn(115),      // flush plinth (floor & tall)
  WALL_RAIL: mmToIn(45),    // wall-unit bottom rail
  COUNTER_GAP: mmToIn(3),   // shadow gap under counterstanding units
  FRAME: mmToIn(80),        // shaker stiles & rails
  GAP: mmToIn(2),           // gap between drawer faces
  FACE1: mmToIn(175), FACE2: mmToIn(245), FACE3: mmToIn(315), // drawers, top→down
  TALL_UPPER: mmToIn(1184), TALL_MID: mmToIn(200), TALL_LOWER: mmToIn(490),
  LARDER_DOOR: mmToIn(1100), LARDER_GAP: mmToIn(35),
  SHELF: mmToIn(18),        // shelf thickness (glass / open units)
};

/** Blank-return width (in) a corner unit adds beside its door. */
export function cornerReturnIn(cab) {
  return cab && cab.corner ? (cab.type === 'WALL' ? 10 : 20) : 0;
}

function bottomZone(cab) {
  return cab.type === 'WALL' ? FD.WALL_RAIL
    : cab.type === 'COUNTER' ? FD.COUNTER_GAP : FD.PLINTH;
}

/** Tall two-panel zones (1184 over a 200 rail over 490), hung from the top. */
function tallZones(zT) {
  const t1 = zT - FD.FRAME, t2 = t1 - FD.TALL_UPPER;
  const t3 = t2 - FD.TALL_MID, t4 = t3 - FD.TALL_LOWER;
  return [[t4, t3], [t2, t1]];   // bottom panel first
}

/**
 * PURE: the master-library front of one catalogue entry as drawable parts in
 * cabinet-local inches — x runs right, y runs UP from the cabinet's bottom.
 * Corner returns extend beyond [0, w]; x0/x1 report the true drawn extent.
 *
 * Part kinds:
 *   { k:'rect', cls:'body'|'panel'|'glass'|'drawer'|'return'|'void', x,y,w,h }
 *   { k:'line', cls:'leg'|'rail'|'leaf', x1,y1,x2,y2 }
 *   { k:'shelf', y, t, x0, x1 }        — an 18mm shelf edge (two lines)
 *   { k:'text', x, y, s }              — e.g. the 'OPEN' tray label
 */
export function frontParts(cab) {
  const w = cab.w, h = cab.h;
  const parts = [];
  const out = { parts, x0: 0, x1: w, w, h, appliance: false };
  if (!cab || !(w > 0) || !(h > 0)) return out;
  if (cab.type === 'APPLIANCES' || cab.form === 'appliance') {
    out.appliance = true;
    return out;
  }

  const rect = (cls, x, y, rw, rh) => parts.push({ k: 'rect', cls, x, y, w: rw, h: rh });
  const vline = (cls, x, y0, y1) => parts.push({ k: 'line', cls, x1: x, y1: y0, x2: x, y2: y1 });
  const hline = (cls, y, x0, x1) => parts.push({ k: 'line', cls, x1: x0, y1: y, x2: x1, y2: y });

  rect('body', 0, 0, w, h);
  if (cab.form === 'shelf') return out;         // floating shelf: one solid slab
  if (cab.form === 'leg') { hline('rail', h - bottomZone(cab), 0, w); return out; }   // the end leg: one upright over the plinth line

  const E = FD.E, F = FD.FRAME;
  const zB = bottomZone(cab), zT = h - FD.TOP;
  const dishwasher = cab.form === 'dishwasher';

  // skeleton: 22mm legs both sides (NOT on the dishwasher panel), 35mm top
  // rail, plinth / wall bottom rail line
  if (!dishwasher) { vline('leg', E, 0, h); vline('leg', w - E, 0, h); }
  const dx0 = dishwasher ? 0 : E, dx1 = dishwasher ? w : w - E;
  hline('rail', zT, dx0, dx1);
  if (zB >= FD.WALL_RAIL - 0.01) hline('rail', zB, dishwasher ? 0 : dx0, dishwasher ? w : dx1);

  // one door leaf: an OUTLINED leaf between the legs (so the front reads
  // 22mm leg · door · 22mm leg, per the master library) with recessed shaker
  // panel zones inside (or glass with two shelves)
  const leaf = (x0, x1, zones, glazed = false, yBot = zB, yTop = zT) => {
    const px0 = x0 + F, px1 = x1 - F;
    if (px1 - px0 < 0.4) return;
    rect('leaf', x0, yBot, x1 - x0, yTop - yBot);
    for (const [p0, p1] of zones) {
      if (p1 - p0 < 0.4) continue;
      rect(glazed ? 'glass' : 'panel', px0, p0, px1 - px0, p1 - p0);
      if (glazed && cab.type === 'COUNTER') {   // the C range: 400mm up, then equal (core/units.js), seen through the glass
        for (const top of counterShelfTops(h - FD.TOP)) { const y = h - top; if (y > p0 && y + FD.SHELF < p1) parts.push({ k: 'shelf', y, t: FD.SHELF, x0: px0, x1: px1 }); }
      } else if (glazed) {          // two 18mm shelves at equal thirds through the glass
        const open = (p1 - p0 - 2 * FD.SHELF) / 3;
        for (const top of [p1 - open, p1 - 2 * open - FD.SHELF]) {
          parts.push({ k: 'shelf', y: top, t: FD.SHELF, x0: px0, x1: px1 });
        }
      }
    }
  };

  // plain drawer stack: top face exactly 175, remainder split 245:315
  const drawerStack = (x0, x1, yBot, yTop) => {
    const rem = yTop - yBot - FD.FACE1 - 2 * FD.GAP;
    if (rem < 1) { rect('drawer', x0, yBot, x1 - x0, yTop - yBot); return; }
    const f3 = rem * FD.FACE3 / (FD.FACE2 + FD.FACE3);
    const f2 = rem - f3;
    rect('drawer', x0, yBot, x1 - x0, f3);
    rect('drawer', x0, yBot + f3 + FD.GAP, x1 - x0, f2);
    rect('drawer', x0, yTop - FD.FACE1, x1 - x0, FD.FACE1);
  };

  const singleZone = [[zB + F, zT - F]];
  // a full-height glazed door: two panes either side of an 80mm centre glazing bar (her spec 2026-09-22)
  const midY = (zB + zT) / 2, glazedZones = cab.high ? [[zB + F, midY - F / 2], [midY + F / 2, zT - F]] : singleZone;
  const doorZones = cab.type === 'TALL' ? tallZones(zT) : cab.high ? glazedZones : singleZone;   // a full-height upper: two panels about an 80mm centre rail
  const tallDouble = cab.type === 'TALL' && /double/i.test(cab.desc || '');

  switch (cab.form) {
    case 'door': case 'bin':                     // pull-out bin reads as a door
      leaf(dx0, dx1, doorZones);
      break;
    case 'glazed':
      leaf(dx0, dx1, glazedZones, true);
      break;
    case 'double': case 'glazedDouble': {
      const mid = w / 2, glazed = cab.form === 'glazedDouble';
      // a TALL pair (T13) is two full-height tall doors: 1184 / 200 rail / 490 in each leaf,
      // exactly like the single (her catch 2026-09-25: the catalogue drew it with no mid rail)
      const zones = cab.type === 'TALL' ? doorZones : cab.high ? glazedZones : singleZone;
      vline('leaf', mid, zB, zT);
      leaf(dx0, mid, zones, glazed);
      leaf(mid, dx1, zones, glazed);
      break;
    }
    case 'drawers':
      drawerStack(dx0, dx1, zB, zT);
      break;
    case 'ovenHousing': {                        // low door(s) · drawer panel · OVEN opening · blank panel
      // same stack as the 3D (core/ovenseat.js) — an approver must see the oven
      // aperture, never a plain full-height door
      const seat = ovenSeat(cab), doorTop = seat.openY0 + seat.doorH;
      const single = [[zB + F, doorTop - F]];
      if (w >= 36) { vline('leaf', w / 2, zB, doorTop); leaf(dx0, w / 2, single, false, zB, doorTop); leaf(w / 2, dx1, single, false, zB, doorTop); }
      else leaf(dx0, dx1, single, false, zB, doorTop);
      rect('drawer', dx0, doorTop + FD.GAP, dx1 - dx0, seat.drawH - FD.GAP);
      rect('void', dx0, seat.y0, dx1 - dx0, seat.ovenH);
      parts.push({ k: 'text', x: w / 2, y: seat.y0 + seat.ovenH / 2, s: 'OVEN' });
      if (zT - (seat.y0 + seat.ovenH) > 1) rect('drawer', dx0, seat.y0 + seat.ovenH + FD.GAP, dx1 - dx0, zT - (seat.y0 + seat.ovenH) - FD.GAP);
      break;
    }
    case 'ovenBase': {                           // drawer panel · OVEN opening, right under the top rail
      const seat = ovenSeat(cab);
      rect('drawer', dx0, zB, dx1 - dx0, seat.drawH - FD.GAP);
      rect('panel', dx0, seat.y0 - seat.railH, dx1 - dx0, seat.railH);      // the rail the oven stands on
      rect('void', dx0, seat.y0, dx1 - dx0, seat.ovenH);
      parts.push({ k: 'text', x: w / 2, y: seat.y0 + seat.ovenH / 2, s: 'OVEN' });
      break;
    }
    case 'larder': case 'housing': {
      const zones = tallZones(zT);
      if (tallDouble) {
        vline('leaf', w / 2, zB, zT);
        leaf(dx0, w / 2, zones); leaf(w / 2, dx1, zones);
      } else leaf(dx0, dx1, zones);
      break;
    }
    case 'larderDrawers': {                      // 1100 door / 35 gap / stack
      const doorBot = zT - 2 * F - FD.LARDER_DOOR;
      const stackTop = doorBot - FD.LARDER_GAP;
      hline('rail', doorBot, dx0, dx1);
      const pz = [[doorBot + F, zT - F]];
      if (tallDouble) {
        vline('leaf', w / 2, doorBot, zT);
        leaf(dx0, w / 2, pz, false, doorBot, zT); leaf(w / 2, dx1, pz, false, doorBot, zT);
      } else leaf(dx0, dx1, pz, false, doorBot, zT);
      drawerStack(dx0, dx1, zB, stackTop);
      break;
    }
    case 'corner': {                             // door (or a pair) + hatched blank return
      if (cab.pair) { vline('leaf', w / 2, zB, zT); leaf(dx0, w / 2, doorZones); leaf(w / 2, dx1, doorZones); }
      else leaf(dx0, dx1, doorZones);
      const R = cornerReturnIn(cab);
      if (cab.cornerSide === 'right') { rect('return', w, 0, R, h); out.x1 = w + R; }
      else { rect('return', -R, 0, R, h); out.x0 = -R; }
      break;
    }
    case 'open': {                               // fixed shelves, open front
      const tops = cab.type === 'COUNTER'
        ? counterShelfTops(h - FD.TOP).map((t) => h - t)
        : (() => { const o = (zT - zB - 2 * FD.SHELF) / 3; return [zT - o, zT - 2 * o - FD.SHELF]; })();
      for (const top of tops) parts.push({ k: 'shelf', y: top, t: FD.SHELF, x0: dx0, x1: dx1 });
      break;
    }
    case 'tray':                                 // adjustable tray void — 'OPEN'
      rect('void', dx0, zB, dx1 - dx0, zT - zB);
      parts.push({ k: 'text', x: (dx0 + dx1) / 2, y: (zB + zT) / 2, s: 'OPEN' });
      break;
    case 'dishwasher':                           // full-width panel, no legs
      leaf(0, w, singleZone);
      break;
    case 'hoodCover':                            // one fixed shaker panel between the legs, no swing mark
      leaf(dx0, dx1, singleZone);
      break;
    default:
      break;
  }
  return out;
}

// ---- SVG rendering ----------------------------------------------------------
const LIGHT = '#9a9a9a';       // carcass / rail / drawer detail (matches plan)
const PANEL = '#b4b4b4';       // recessed shaker panel outline

function hatchRect(out, x0, ySvgTop, fw, fh) {
  const step = Math.max(3, Math.min(6, fw * 0.45));
  for (let t = step; t < fh + fw; t += step) {
    const xa = x0 + Math.max(0, t - fh), ya = ySvgTop + Math.min(t, fh);
    const xb = x0 + Math.min(t, fw), yb = ySvgTop + Math.max(0, t - fw);
    out.push(svgLine(xa, ya, xb, yb, P.W_18, LIGHT));
  }
}

/**
 * Draw one cabinet front at position: s0 = left edge (svg x), y0 = world
 * bottom (inches, up-positive), Y = world-y → svg-y flip. Returns an SVG
 * fragment. opts: { code, fill } — the code label sits ON the plinth for
 * floor-standing units and in the bottom shaker rail for hung units, so it
 * never fights the door graphics. Appliances render as dashed outlines.
 */
export function drawFront(cab, s0, y0, Y, opts = {}) {
  const out = [];
  const fp = frontParts(cab);
  const w = cab.w, h = cab.h;

  if (fp.appliance) return applianceFront(cab, s0, y0, Y, opts);

  const X = (x) => s0 + x;
  const fill = opts.fill ?? '#fff';

  for (const p of fp.parts) {
    if (p.k === 'rect') {
      const rx = X(p.x), ry = Y(y0 + p.y + p.h);
      if (p.cls === 'body') {
        out.push(`<rect x="${n(rx)}" y="${n(ry)}" width="${n(p.w)}" height="${n(p.h)}" fill="${fill}" stroke="${P.INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`);
      } else if (p.cls === 'return') {
        out.push(`<rect x="${n(rx)}" y="${n(ry)}" width="${n(p.w)}" height="${n(p.h)}" fill="${fill}" stroke="${P.INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`);
        hatchRect(out, rx, ry, p.w, p.h);
      } else if (p.cls === 'glass') {
        out.push(`<rect x="${n(rx)}" y="${n(ry)}" width="${n(p.w)}" height="${n(p.h)}" fill="#f6f6f6" stroke="${LIGHT}" stroke-width="${P.W_18}" vector-effect="non-scaling-stroke"/>`);
      } else if (p.cls === 'panel') {
        out.push(`<rect x="${n(rx)}" y="${n(ry)}" width="${n(p.w)}" height="${n(p.h)}" fill="none" stroke="${PANEL}" stroke-width="${P.W_18}" vector-effect="non-scaling-stroke"/>`);
      } else if (p.cls === 'drawer') {
        out.push(`<rect x="${n(rx)}" y="${n(ry)}" width="${n(p.w)}" height="${n(p.h)}" fill="none" stroke="${LIGHT}" stroke-width="${P.W_18}" vector-effect="non-scaling-stroke"/>`);
      } else if (p.cls === 'leaf') {
        out.push(`<rect x="${n(rx)}" y="${n(ry)}" width="${n(p.w)}" height="${n(p.h)}" fill="none" stroke="${P.INK}" stroke-width="${P.W_18}" vector-effect="non-scaling-stroke"/>`);
      } else if (p.cls === 'void') {
        out.push(`<rect x="${n(rx)}" y="${n(ry)}" width="${n(p.w)}" height="${n(p.h)}" fill="none" stroke="${LIGHT}" stroke-width="${P.W_18}" vector-effect="non-scaling-stroke" stroke-dasharray="1.6 1.2"/>`);
      }
    } else if (p.k === 'line') {
      // the 22mm end strips are STRUCTURE — full ink so the front reads
      // leg · door · leg on print; rails and leaf-splits stay light
      out.push(svgLine(X(p.x1), Y(y0 + p.y1), X(p.x2), Y(y0 + p.y2), P.W_18, p.cls === 'leg' ? P.INK : LIGHT));
    } else if (p.k === 'shelf') {
      out.push(svgLine(X(p.x0), Y(y0 + p.y), X(p.x1), Y(y0 + p.y), P.W_18, LIGHT));
      out.push(svgLine(X(p.x0), Y(y0 + p.y - p.t), X(p.x1), Y(y0 + p.y - p.t), P.W_18, LIGHT));
    } else if (p.k === 'text') {
      const fs = Math.min(2.6, Math.max(1.6, (fp.x1 - fp.x0) * 0.18));
      out.push(`<text x="${n(X(p.x))}" y="${n(Y(y0 + p.y))}" font-size="${fs}" fill="#999" text-anchor="middle" dominant-baseline="central" letter-spacing="0.6">${esc(p.s)}</text>`);
    }
  }

  // door swing, the elevation convention: dashed diagonals from the latch-side
  // corners meeting at mid-height on the HINGE side. A pair hangs left + right.
  if (opts.hinge) {
    for (const p of fp.parts) {
      if (p.k !== 'rect' || p.cls !== 'leaf') continue;
      const side = opts.hinge === 'PAIR' ? (p.x + p.w / 2 < w / 2 ? 'L' : 'R') : opts.hinge;
      const hx = X(side === 'L' ? p.x : p.x + p.w), lx = X(side === 'L' ? p.x + p.w : p.x);
      const yT = Y(y0 + p.y + p.h), yB = Y(y0 + p.y), yM = (yT + yB) / 2;
      out.push(`<polyline points="${n(lx)},${n(yT)} ${n(hx)},${n(yM)} ${n(lx)},${n(yB)}" fill="none" stroke="${LIGHT}" stroke-width="${P.W_18}" stroke-dasharray="2.2 1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`);
    }
  }

  // opts.marks (elevations + cut sheets): how the fronts that do NOT side-hinge
  // open. A dishwasher door DROPS DOWN — same convention, the dashed diagonals
  // meet at its hinge edge, the bottom. A pull-out has no swing symbol in
  // elevation practice (an X reads as a fixed panel / void), so it is lettered.
  if (opts.marks) {
    const leafs = fp.parts.filter((p) => p.k === 'rect' && p.cls === 'leaf');
    if (cab.form === 'dishwasher') {
      for (const p of leafs) {
        const yT = Y(y0 + p.y + p.h), yB = Y(y0 + p.y);
        out.push(`<polyline points="${n(X(p.x))},${n(yT)} ${n(X(p.x + p.w / 2))},${n(yB)} ${n(X(p.x + p.w))},${n(yT)}" fill="none" stroke="${LIGHT}" stroke-width="${P.W_18}" stroke-dasharray="2.2 1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`);
      }
    } else if (cab.form === 'bin' && leafs[0]) {
      const p = leafs[0], fs = Math.min(2.2, Math.max(1.5, p.w * 0.11));
      for (const [i, word] of ['PULL', 'OUT'].entries()) {
        out.push(`<text x="${n(X(p.x + p.w / 2))}" y="${n(Y(y0 + p.y + p.h / 2) + (i - 0.5) * fs * 1.25)}" font-size="${n(fs)}" fill="#8a8a8a" text-anchor="middle" dominant-baseline="central" letter-spacing="0.5" paint-order="stroke" stroke="#fff" stroke-width="0.6">${word}</text>`);
      }
    }
  }

  if (opts.code) {
    const halo = ' paint-order="stroke" stroke="#fff" stroke-width="0.7"';
    const floorStanding = cab.type === 'FLOOR' || cab.type === 'TALL';
    if (h < 6) {          // floating shelves etc: small code above the slab
      out.push(`<text x="${n(s0 + w / 2)}" y="${n(Y(y0 + h) - 1.8)}" font-size="${P.F_CODE * 0.85}" fill="#333" text-anchor="middle">${esc(opts.code)}</text>`);
    } else if (floorStanding) {   // ON the plinth band
      out.push(`<text x="${n(s0 + w / 2)}" y="${n(Y(y0 + bottomZone(cab) / 2))}" font-size="2.5" fill="#333" text-anchor="middle" dominant-baseline="central"${halo}>${esc(opts.code)}</text>`);
    } else {                      // hung units: in the door's bottom shaker rail
      out.push(`<text x="${n(s0 + w / 2)}" y="${n(Y(y0 + bottomZone(cab) + FD.FRAME / 2))}" font-size="2.5" fill="#333" text-anchor="middle" dominant-baseline="central"${halo}>${esc(opts.code)}</text>`);
    }
  }
  return out.join('\n');
}

// ---- appliances: grey, filled, recognisable -----------------------------------
const A_FILL = '#ebebeb', A_INK = '#8f8f8f', A_PALE = '#f8f8f8', A_DARK = '#dcdcdc';

/** One appliance front, in grey. Same rangeSpec as the 3D model, the plan and
 *  the picker icon. Sinks mount BELOW the worktop, so what an elevation shows
 *  is the faucet; a cooktop is a thin slab on the worktop. */
function applianceFront(cab, s0, y0, Y, opts) {
  const w = cab.w, h = cab.h, o = [];
  const box = (x, ya, bw, bh, fill = A_FILL, sw = P.W_CAB, extra = '') => o.push(`<rect x="${n(s0 + x)}" y="${n(Y(y0 + ya + bh))}" width="${n(bw)}" height="${n(bh)}" fill="${fill}" stroke="${A_INK}" stroke-width="${sw}" vector-effect="non-scaling-stroke"${extra}/>`);
  const ln = (x1, ya, x2, yb, sw = P.W_18) => o.push(`<line x1="${n(s0 + x1)}" y1="${n(Y(y0 + ya))}" x2="${n(s0 + x2)}" y2="${n(Y(y0 + yb))}" stroke="${A_INK}" stroke-width="${sw}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`);
  const code = (x, ya, size = 2.5) => {
    if (opts.code) o.push(`<text x="${n(s0 + x)}" y="${n(Y(y0 + ya))}" font-size="${size}" fill="#777" text-anchor="middle" dominant-baseline="central" paint-order="stroke" stroke="#fff" stroke-width="0.7">${esc(opts.code)}</text>`);
  };

  switch (cab.appliance) {
    case 'range': {
      const sp = rangeSpec(cab);
      box(0, 0, w, h);
      ln(0, sp.kickH, w, sp.kickH);
      box(0, sp.railY0, w, sp.railY1 - sp.railY0, A_PALE, P.W_18);          // control rail + knobs
      const ky = (sp.railY0 + sp.railY1) / 2;
      for (let i = 0; i < sp.knobs; i++) {
        o.push(`<circle cx="${n(s0 + 3.2 + i * ((w - 6.4) / Math.max(1, sp.knobs - 1)))}" cy="${n(Y(y0 + ky))}" r="0.85" fill="#fff" stroke="${A_INK}" stroke-width="${P.W_18}" vector-effect="non-scaling-stroke"/>`);
      }
      for (const ov of sp.ovens) {                                          // oven door: window + bar handle
        const dw = ov.x1 - ov.x0, dh = sp.doorY1 - sp.doorY0;
        box(ov.x0, sp.doorY0, dw, dh, A_PALE, P.W_18);
        box(ov.x0 + 2.4, sp.doorY0 + dh * 0.2, dw - 4.8, dh * 0.5, A_DARK, P.W_18, ' rx="0.6"');
        ln(ov.x0 + 1.8, sp.doorY1 - 2.2, ov.x1 - 1.8, sp.doorY1 - 2.2, P.W_CAB * 1.8);
      }
      code(w / 2, sp.kickH / 2);                                             // on the kick, like a cabinet's plinth code
      break;
    }
    case 'sink': {
      // the bowl is under the worktop: show the faucet (gooseneck) on centre
      const cx = w / 2, top = 15, r = 2.6;
      o.push(`<path d="M ${n(s0 + cx)} ${n(Y(y0))} L ${n(s0 + cx)} ${n(Y(y0 + top - r))} A ${n(r)} ${n(r)} 0 0 1 ${n(s0 + cx + 2 * r)} ${n(Y(y0 + top - r))} L ${n(s0 + cx + 2 * r)} ${n(Y(y0 + top - r - 2.2))}" fill="none" stroke="${A_INK}" stroke-width="${P.W_CAB * 2}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`);
      box(cx - 1.1, 0, 2.2, 1.4, A_FILL, P.W_18);                             // base flange
      ln(cx - 3.4, 2.6, cx - 1.1, 1.4, P.W_CAB * 1.6);                        // lever
      code(cx, top + 2.4);
      break;
    }
    case 'hob':
      box(0, 0, w, Math.min(h, 1.2), A_FILL, P.W_18);
      code(w / 2, 3.4);
      break;
    case 'hood': {
      if (cab.plaster) {                                                     // plaster chimney: one plain box, a liner line under it
        box(0, 0, w, h);
        ln(2.5, 0.9, w - 2.5, 0.9);
        code(w / 2, h * 0.45);
        break;
      }
      const canopy = Math.min(9, h * 0.34), cw = Math.max(10, w * 0.34);
      box((w - cw) / 2, canopy, cw, h - canopy, A_FILL, P.W_18);             // chimney
      box(0, 0, w, canopy);                                                  // canopy
      ln(1.5, 1.4, w - 1.5, 1.4);
      code(w / 2, canopy / 2 + 0.6);
      break;
    }
    case 'oven':
      box(0, 0, w, h);
      box(2.2, h * 0.16, w - 4.4, h * 0.5, A_DARK, P.W_18, ' rx="0.6"');
      ln(2, h * 0.78, w - 2, h * 0.78, P.W_CAB * 1.8);
      code(w / 2, h * 0.9);
      break;
    case 'fridge': {
      box(0, 0, w, h);
      const drawer = cab.integrated ? h * 0.28 : 0;                          // freezer drawer under the door(s)
      if (drawer) ln(0, drawer, w, drawer);
      const french = cab.integrated ? !cab.overUnder : w >= 33;
      if (french) { ln(w / 2, drawer, w / 2, h); ln(w / 2 - 1.4, h * 0.42, w / 2 - 1.4, h * 0.62, P.W_CAB * 1.6); ln(w / 2 + 1.4, h * 0.42, w / 2 + 1.4, h * 0.62, P.W_CAB * 1.6); }
      else ln(w - 2.2, h * 0.42, w - 2.2, h * 0.62, P.W_CAB * 1.6);
      if (drawer) ln(w * 0.3, drawer - 2.2, w * 0.7, drawer - 2.2, P.W_CAB * 1.6);
      code(w / 2, h * 0.75, P.F_CODE * 0.85);
      break;
    }
    case 'washer': {                                                  // a front-loader: porthole and a control strip
      box(0, 0, w, h);
      ln(0, 1.6, w, 1.6);
      box(0.6, h - 3.6, w - 1.2, 3, A_PALE, P.W_18);
      o.push(`<circle cx="${n(s0 + w / 2)}" cy="${n(Y(y0 + h * 0.47))}" r="${n(Math.min(w, h) * 0.34)}" fill="${A_PALE}" stroke="${A_INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`);
      o.push(`<circle cx="${n(s0 + w / 2)}" cy="${n(Y(y0 + h * 0.47))}" r="${n(Math.min(w, h) * 0.27)}" fill="#c9ccd0" stroke="${A_INK}" stroke-width="${P.W_18}" vector-effect="non-scaling-stroke"/>`);
      code(w / 2, h * 0.12);
      break;
    }
    default:
      box(0, 0, w, h);
      code(w / 2, h / 2);
  }
  return o.join('\n');
}

/**
 * A standalone <svg> of one front (no dims) — used by the Trade picker cards
 * and the order-row mini glyphs. px = rendered height in CSS pixels (optional).
 */
export function frontSVG(cab, px = 0) {
  const fp = frontParts(cab);
  if (!(cab.w > 0) || !(cab.h > 0)) return '';
  const Y = (y) => cab.h - y;
  const body = drawFront(cab, 0, 0, Y);
  const pad = 0.8;
  const vbX = fp.x0 - pad, vbW = fp.x1 - fp.x0 + 2 * pad, vbH = cab.h + 2 * pad;
  const hAttr = px ? ` height="${px}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vbX)} ${n(-pad)} ${n(vbW)} ${n(vbH)}"${hAttr} font-family="ui-sans-serif, Arial, sans-serif">${body}</svg>`;
}
