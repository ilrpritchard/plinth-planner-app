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

import { mmToIn } from '../core/units.js';
import { PLAN_STYLE as P, svgLine, svgN as n } from './floorplan.js';
import { esc } from '../core/submittal.js';

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
  C_SHELF1: mmToIn(382), C_SHELF2: mmToIn(833.5),  // counter open-shelf tops
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
      if (glazed) {          // two 18mm shelves at equal thirds through the glass
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
  const doorZones = cab.type === 'TALL' ? tallZones(zT) : singleZone;
  const tallDouble = cab.type === 'TALL' && /double/i.test(cab.desc || '');

  switch (cab.form) {
    case 'door': case 'bin':                     // pull-out bin reads as a door
      leaf(dx0, dx1, doorZones);
      break;
    case 'glazed':
      leaf(dx0, dx1, singleZone, true);
      break;
    case 'double': case 'glazedDouble': {
      const mid = w / 2, glazed = cab.form === 'glazedDouble';
      vline('leaf', mid, zB, zT);
      leaf(dx0, mid, singleZone, glazed);
      leaf(mid, dx1, singleZone, glazed);
      break;
    }
    case 'drawers':
      drawerStack(dx0, dx1, zB, zT);
      break;
    case 'larder': case 'housing': case 'ovenHousing': {
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
    case 'corner': {                             // door + hatched blank return
      leaf(dx0, dx1, doorZones);
      const R = cornerReturnIn(cab);
      if (cab.cornerSide === 'right') { rect('return', w, 0, R, h); out.x1 = w + R; }
      else { rect('return', -R, 0, R, h); out.x0 = -R; }
      break;
    }
    case 'open': {                               // fixed shelves, open front
      const tops = cab.type === 'COUNTER'
        ? [h - FD.C_SHELF1, h - FD.C_SHELF2]
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

  if (fp.appliance) {
    out.push(`<rect x="${n(s0)}" y="${n(Y(y0 + h))}" width="${n(w)}" height="${n(h)}" fill="none" stroke="${P.UPPER}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke" stroke-dasharray="3.5 2.5"/>`);
    if (opts.code) {
      out.push(`<text x="${n(s0 + w / 2)}" y="${n(Y(y0 + h / 2))}" font-size="${P.F_CODE}" fill="${P.UPPER}" text-anchor="middle" dominant-baseline="central">${esc(opts.code)}</text>`);
    }
    return out.join('\n');
  }

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
