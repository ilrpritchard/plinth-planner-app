// icon.js — clean line-art front elevations for the catalogue, drawn to scale
// in PL/NTH's spec-sheet style. Fully offline (inline SVG). Line-art (not
// painted) so every block reads clearly on a white tile regardless of finish.
//
// Construction matches the spec: 22mm legs each side, 80mm shaker stiles/rails,
// flush 115mm plinth, recessed door panels, flat drawer fronts.

import { SPEC } from '../core/units.js';
import { rangeSpec, hobSpec } from '../core/rangespec.js';
import { sinkSpec } from '../core/sinkspec.js';

// cream line-art so the catalogue elevations read on the dark brand cards
const STROKE = '#645b3d';
const HAIR = 'rgba(100,91,61,0.45)';
const KNOB = '#645b3d';
const GLASS = 'rgba(150,175,178,0.22)';
const BOX = 100;
const PAD = 13;

const LEG = SPEC.LEG_IN;       // 22mm
const FRAME = SPEC.FRAME_IN;   // 80mm
const PLN = SPEC.PLINTH_IN;    // 115mm

/** Returns an <svg> line-elevation of `cab`, scaled to its real proportions. */
export function cabinetSVG(cab, opts = {}) {
  if (cab.appliance) return applianceSVG(cab);
  if (cab.shelf) return shelfSVG();
  const sink = opts.sink || null;               // "Sink base" shortcut tile: the base drawn with worktop, bowl and tap
  const cornerRet = cab.corner ? (cab.type === 'FLOOR' ? 20 : 10) : 0; // blank return panel
  const wIn = (cab.w || 24) + cornerRet;
  const hIn = cab.h || 35;
  const avail = BOX - 2 * PAD - (sink ? 16 : 0);
  const ar = wIn / hIn;
  let dw, dh;
  if (ar >= 1) { dw = avail; dh = avail / ar; } else { dh = avail; dw = avail * ar; }
  const s = dw / wIn;                 // px per inch (uniform — aspect preserved)
  const x0 = (BOX - dw) / 2;
  const y0 = (BOX - dh) / 2 + (sink ? 9 : 0);

  const leg = LEG * s, frame = FRAME * s;
  const hasPlinth = cab.type === 'FLOOR' || cab.type === 'TALL';
  const plinth = hasPlinth ? PLN * s : 0;

  const p = [];
  // carcass outline
  p.push(rect(x0, y0, dw, dh, 1.6));

  // opening between the 22mm legs / top rail / flush plinth
  const ox = x0 + leg;
  const oy = y0 + leg;
  const ow = dw - 2 * leg;
  const ob = y0 + dh - (hasPlinth ? plinth : leg);
  const oh = ob - oy;

  // the End Leg is ONE solid upright: no opening, no leg lines (they would cross)
  if (cab.form === 'leg') {
    p.push(rect(x0, y0, dw, dh, 1.2, STROKE, STROKE));
    if (hasPlinth) p.push(hline(x0 - 2, x0 + dw + 2, y0 + dh - plinth, 1.1));
  } else {
  // leg + top-rail lines (light)
  p.push(vline(x0 + leg, y0, y0 + dh, 0.7));
  p.push(vline(x0 + dw - leg, y0, y0 + dh, 0.7));
  p.push(hline(x0, x0 + dw, y0 + leg, 0.7));
  if (hasPlinth) p.push(hline(x0, x0 + dw, y0 + dh - plinth, 1.1)); // flush plinth

  drawFront(p, cab, { ox, oy, ow, oh, frame, s });
  }

  if (sink) {
    const sp = sinkSpec(sink), wt = 1.5 * s, cx = BOX / 2;
    p.push(rect(x0 - 1.5 * s, y0 - wt - 0.6, dw + 3 * s, wt, 1.2));                          // worktop
    const bw = sp.cutW * s, bd = sp.depth * s;                                               // the bowl hanging under it
    p.push(`<path d="M ${f(cx - bw / 2)} ${f(y0 - 0.6)} v ${f(bd - 3)} q 0 3 3 3 h ${f(bw - 6)} q 3 0 3 -3 v ${f(-(bd - 3))}" fill="none" stroke="${HAIR}" stroke-width="0.9" stroke-dasharray="2.2 1.6"/>`);
    if (sp.bowls.length > 1) p.push(`<line x1="${f(cx)}" y1="${f(y0 - 0.6)}" x2="${f(cx)}" y2="${f(y0 - 0.6 + bd)}" stroke="${HAIR}" stroke-width="0.9" stroke-dasharray="2.2 1.6"/>`);
    const ty = y0 - wt - 0.6;                                                                // gooseneck tap
    p.push(`<path d="M ${f(cx - 5)} ${f(ty)} v -9 a 5 5 0 0 1 10 0 v 3" fill="none" stroke="${STROKE}" stroke-width="1.6" stroke-linecap="round"/>`);
    p.push(`<line x1="${f(cx - 8.5)}" y1="${f(ty - 3)}" x2="${f(cx - 5)}" y2="${f(ty - 3)}" stroke="${STROKE}" stroke-width="1.4" stroke-linecap="round"/>`);
  }

  return `<svg viewBox="0 0 ${BOX} ${BOX}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true" fill="none">${p.join('')}</svg>`;
}

// ---- forms --------------------------------------------------------------
function drawFront(p, cab, a) {
  const { ox, oy, ow, oh, frame } = a;
  const rev = Math.max(0.6, SPEC.REVEAL_IN * a.s);
  const form = cab.form;

  const doorPanel = (x, y, w, h, knobSide) => {
    p.push(rect(x, y, w, h, 1)); // door edge
    const fr = Math.min(frame, w * 0.42, h * 0.42);
    if (w - 2 * fr > 2 && h - 2 * fr > 2) p.push(rect(x + fr, y + fr, w - 2 * fr, h - 2 * fr, 0.7, HAIR));
    if (knobSide) knob(p, knobSide < 0 ? x + fr * 0.5 : x + w - fr * 0.5, y + h / 2);
  };
  // Tall doors are 2-panel shaker (PL/NTH spec): upper 1184 / mid-rail 200 /
  // lower 490 mm, with 80mm stiles/rails around each panel.
  const tallDoor = (x, y, w, h, knobSide) => {
    p.push(rect(x, y, w, h, 1)); // door edge
    const fr = Math.min(frame, w * 0.42, h * 0.18);
    const ix = x + fr, iw = w - 2 * fr, iy = y + fr, ih = h - 2 * fr;
    if (iw <= 2 || ih <= 2) { return; }
    const U = 1184, M = 200, L = 490, T = U + M + L;
    const uh = ih * U / T, mh = ih * M / T, lh = ih * L / T;
    p.push(rect(ix, iy, iw, uh, 0.7, HAIR));              // upper panel
    p.push(rect(ix, iy + uh + mh, iw, lh, 0.7, HAIR));    // lower panel
    if (knobSide) knob(p, knobSide < 0 ? x + fr * 0.55 : x + w - fr * 0.55, iy + uh + mh / 2);
  };
  const drawerFront = (x, y, w, h) => {
    p.push(rect(x, y, w, h, 1)); // flat front, no shaker panel
    if (cab.w >= 36) {                 // 36" banks (F20/F30): knob pair, 1/9 in from each end
      knob(p, x + w / 9, y + h / 2); knob(p, x + w - w / 9, y + h / 2);
    } else knob(p, x + w / 2, y + h / 2); // centred knob — Plinth hardware is knobs only
  };

  const isTall = cab.type === 'TALL';
  const blankPanel = (x, y, w, h) => {
    p.push(rect(x, y, w, h, 1));               // panel edge
    // light cross-hatch to read as a flat oak-veneer blank (not a door)
    const step = Math.max(3, w / 4);
    for (let gx = x - h; gx < x + w; gx += step) {
      p.push(`<line x1="${f(Math.max(x, gx))}" y1="${f(gx < x ? y + (x - gx) : y)}" x2="${f(Math.min(x + w, gx + h))}" y2="${f(gx + h > x + w ? y + (x + w - gx) : y + h)}" stroke="${HAIR}" stroke-width="0.4"/>`);
    }
  };
  switch (form) {
    case 'door': {
      if (isTall) tallDoor(ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, +1);
      else doorPanel(ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, +1);
      break;
    }
    case 'bin': {
      // PULL-OUT: it slides, it never hinges — knob centred on the top rail
      // (same as the 3D builder), never on the hinge edge like a door
      doorPanel(ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, 0);
      knob(p, ox + ow / 2, oy + rev + frame * 0.55);
      break;
    }
    case 'corner': {
      // blank return panel BEYOND the door (toward the corner) + the door beside it
      const retPx = (cab.type === 'FLOOR' ? 20 : 10) * a.s;
      if (cab.cornerSide === 'right') {
        doorPanel(ox + rev, oy + rev, ow - retPx - 2 * rev, oh - 2 * rev, -1);
        blankPanel(ox + ow - retPx, oy, retPx, oh);
      } else {
        blankPanel(ox, oy, retPx, oh);
        doorPanel(ox + retPx + rev, oy + rev, ow - retPx - 2 * rev, oh - 2 * rev, +1);
      }
      break;
    }
    case 'glazed': glazedDoor(p, ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, frame); break;
    case 'double': {
      const w = (ow - 3 * rev) / 2;
      doorPanel(ox + rev, oy + rev, w, oh - 2 * rev, +1);
      doorPanel(ox + 2 * rev + w, oy + rev, w, oh - 2 * rev, -1);
      break;
    }
    case 'glazedDouble': {
      const w = (ow - 3 * rev) / 2;
      glazedDoor(p, ox + rev, oy + rev, w, oh - 2 * rev, frame);
      glazedDoor(p, ox + 2 * rev + w, oy + rev, w, oh - 2 * rev, frame);
      break;
    }
    case 'drawers': stackDrawers(p, ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, drawerFront, rev); break;
    case 'open': openShelves(p, ox, oy, ow, oh, 2); break;
    case 'tray': openShelves(p, ox, oy, ow, oh, 1); break;
    case 'dishwasher': {
      // the appliance DOOR PANEL: one shaker leaf, knob centred on the top rail, like the pull-out
      // bin (her call 2026-09-22: it was drawn as a bare rectangle)
      doorPanel(ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, 0);
      knob(p, ox + ow / 2, oy + rev + frame * 0.55);
      break;
    }
    case 'housing': {
      // fridge housing — drawn as a 2-panel shaker door per spec
      tallDoor(ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, +1);
      break;
    }
    case 'ovenBase': {
      // the UNDER-COUNTER oven housing: (top→bottom) inset oven right under the rail · drawer panel
      const ovenH = oh * 0.82, dy = oy + rev + ovenH + rev;
      p.push(rect(ox + rev, oy + rev, ow - 2 * rev, ovenH, 1.2));                                   // oven fascia
      p.push(rect(ox + rev * 4, oy + rev + ovenH * 0.3, ow - 8 * rev, ovenH * 0.58, 0.7, HAIR, GLASS)); // glass door
      p.push(hline(ox + rev * 4, ox + ow - rev * 4, oy + rev + ovenH * 0.17, 1.1));                  // handle bar
      p.push(rect(ox + rev, dy, ow - 2 * rev, oy + oh - dy - rev, 1));                               // drawer panel
      knob(p, ox + ow / 2, dy + (oy + oh - dy - rev) / 2);
      break;
    }
    case 'ovenHousing': {
      // (top→bottom) blank panel · inset oven (window + bar) · drawer · door
      const blankH = oh * 0.27, ovenH = oh * 0.35, drawH = oh * 0.10;
      const oyv = oy + blankH;                              // oven top
      p.push(rect(ox + rev, oy + rev, ow - 2 * rev, blankH - 2 * rev, 1)); // blank panel
      p.push(rect(ox + rev, oyv, ow - 2 * rev, ovenH, 1.2));               // oven fascia
      p.push(rect(ox + rev * 4, oyv + ovenH * 0.32, ow - 8 * rev, ovenH * 0.56, 0.7, HAIR, GLASS)); // glass
      p.push(hline(ox + rev * 4, ox + ow - rev * 4, oyv + ovenH * 0.18, 1.1)); // handle bar
      const dy = oyv + ovenH + rev;
      p.push(rect(ox + rev, dy, ow - 2 * rev, drawH - rev, 1));            // drawer panel
      knob(p, ox + ow / 2, dy + (drawH - rev) / 2);
      const ldh = oy + oh - (dy + drawH) - rev;
      if (cab.w >= 36) {                                                   // door pair under a 36" oven
        const lw = (ow - 3 * rev) / 2;
        doorPanel(ox + rev, dy + drawH, lw, ldh, +1); doorPanel(ox + 2 * rev + lw, dy + drawH, lw, ldh, -1);
      } else doorPanel(ox + rev, dy + drawH, ow - 2 * rev, ldh, +1);       // low door
      break;
    }
    case 'larder': {
      // 2-panel shaker door(s) — one for a single larder, a pair for a double
      if (cab.w >= 40) {
        const w = (ow - 3 * rev) / 2;
        tallDoor(ox + rev, oy + rev, w, oh - 2 * rev, +1);
        tallDoor(ox + 2 * rev + w, oy + rev, w, oh - 2 * rev, -1);
      } else {
        tallDoor(ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, +1);
      }
      break;
    }
    case 'larderDrawers': {
      // single-panel upper door(s) over a bank of 3 drawers (175/245/315mm)
      const drawerRatios = SPEC.DRAWER_FACES_IN; const dsum = drawerRatios.reduce((a, b) => a + b, 0);
      const baseH = oh * (dsum * 25.4) / (1100 + dsum * 25.4); // spec: 1100mm door + drawers
      if (cab.w >= 40) {
        const w = (ow - 3 * rev) / 2;
        doorPanel(ox + rev, oy + rev, w, oh - baseH - rev, +1);
        doorPanel(ox + 2 * rev + w, oy + rev, w, oh - baseH - rev, -1);
      } else {
        doorPanel(ox + rev, oy + rev, ow - 2 * rev, oh - baseH - rev, +1);
      }
      stackDrawers(p, ox + rev, oy + oh - baseH, ow - 2 * rev, baseH - rev, drawerFront, rev);
      break;
    }
    default: doorPanel(ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, +1);
  }
}

function stackDrawers(p, x, y, w, h, drawerFront, rev) {
  const ratios = SPEC.DRAWER_FACES_IN; const sum = ratios.reduce((a, b) => a + b, 0);
  const avail = h - rev * (ratios.length - 1);
  let cy = y;
  for (let i = 0; i < ratios.length; i++) {
    const dh = (ratios[i] / sum) * avail;
    drawerFront(x, cy, w, dh);
    cy += dh + rev;
  }
}
function stacked(p, x, y, w, h, frame, rev, cols, housing, doorPanel) {
  const split = y + h * (housing ? 0.34 : 0.4);
  const g = rev;
  const cw = cols === 1 ? w : (w - g) / 2;
  for (let c = 0; c < cols; c++) {
    const cx = x + c * (cw + g);
    if (housing) p.push(rect(cx, y, cw, split - y, 1)); else doorPanel(cx, y, cw, split - y - rev / 2, c === 0 ? +1 : -1);
    doorPanel(cx, split + rev / 2, cw, (y + h) - split - rev / 2, c === 0 ? +1 : -1);
  }
}
function glazedDoor(p, x, y, w, h, frame) {
  p.push(rect(x, y, w, h, 1));
  const fr = Math.min(frame, w * 0.3, h * 0.18);
  p.push(rect(x + fr, y + fr, w - 2 * fr, h - 2 * fr, 0.7, HAIR, GLASS));
}
function openShelves(p, x, y, w, h, n) {
  for (let i = 1; i <= n; i++) p.push(hline(x + 1, x + w - 1, y + (h * i) / (n + 1), 1.1));
}
function cornerMark(p, x, y, w) {
  const s = w * 0.2;
  p.push(`<path d="M ${f(x + w - s)} ${f(y)} L ${f(x + w)} ${f(y)} L ${f(x + w)} ${f(y + s)} Z" stroke="${STROKE}" stroke-width="0.6" fill="${HAIR}"/>`);
}

// ---- floating shelf -----------------------------------------------------
function shelfSVG() {
  const p = [];
  p.push(rect(12, 40, 76, 11, 1.4));   // the board
  p.push(hline(14, 86, 54, 0.6));      // soft shadow under it
  p.push(hline(18, 82, 45.5, 0.4));    // grain line
  return `<svg viewBox="0 0 ${BOX} ${BOX}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true" fill="none">${p.join('')}</svg>`;
}

// ---- appliances (simple symbols on a square tile) -----------------------
function applianceSVG(cab) {
  const p = [];
  const a = cab.appliance;
  const x = 14, y = 14, w = 72, h = 72;
  const disc = (cx, cy, r) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${STROKE}" stroke-width="1.1"/>`;
  if (a === 'range') {
    // front elevation to scale (a 48" reads wider than a 30"): grates, control
    // rail with knobs, oven door(s) with window and handle, kick. From rangeSpec.
    const sp = rangeSpec(cab);
    const k = 88 / 48, rw = cab.w * k, rh = cab.h * k, rx = 50 - rw / 2, by = 86;   // by = floor line
    const Y = (in_) => by - in_ * k;
    p.push(rect(rx, Y(cab.h), rw, rh, 1.6));                                  // body
    p.push(rect(rx + 1.5, Y(cab.h) - 2.6, rw - 3, 2.6, 0.9, HAIR));           // grates above the top
    p.push(hline(rx, rx + rw, Y(sp.railY0), 0.9));                            // under the control rail
    p.push(hline(rx, rx + rw, Y(sp.kickH), 0.9));                             // kick
    const ky = Y((sp.railY0 + sp.railY1) / 2);
    for (let i = 0; i < sp.knobs; i++) p.push(`<circle cx="${f(rx + 4 + i * ((rw - 8) / (sp.knobs - 1)))}" cy="${f(ky)}" r="1.25" fill="${KNOB}" stroke="none"/>`);
    for (const ov of sp.ovens) {
      const dx = rx + ov.x0 * k, dw = (ov.x1 - ov.x0) * k, dy = Y(sp.doorY1), dh = (sp.doorY1 - sp.doorY0) * k;
      p.push(rect(dx, dy, dw, dh, 0.9, HAIR));                                // door
      p.push(rect(dx + dw * 0.19, dy + dh * 0.28, dw * 0.62, dh * 0.36, 0.8, HAIR)); // window
      p.push(`<line x1="${f(dx + 3)}" y1="${f(dy + 4)}" x2="${f(dx + dw - 3)}" y2="${f(dy + 4)}" stroke="${STROKE}" stroke-width="1.4" stroke-linecap="round"/>`); // handle
    }
  } else if (a === 'oven') {
    // wall oven front, to the same scale as the ranges so 24 reads narrower than 30
    const k = 88 / 48 * 1.35, ow = cab.w * k, oh = cab.h * k, ox = 50 - ow / 2, oy = 50 - oh / 2;
    p.push(rect(ox, oy, ow, oh, 1.6));                                      // surround
    p.push(hline(ox, ox + ow, oy + oh * 0.16, 0.9));                        // control strip
    p.push(rect(50 - ow * 0.14, oy + oh * 0.05, ow * 0.28, oh * 0.06, 0.7, HAIR)); // display
    p.push(rect(ox + ow * 0.12, oy + oh * 0.4, ow * 0.76, oh * 0.46, 0.8, HAIR));  // glass
    p.push(`<line x1="${f(ox + 4)}" y1="${f(oy + oh * 0.27)}" x2="${f(ox + ow - 4)}" y2="${f(oy + oh * 0.27)}" stroke="${STROKE}" stroke-width="1.4" stroke-linecap="round"/>`); // handle
  } else if (a === 'hob') {
    // plan view to scale (a 36" reads wider than a 30"): glass with rounded
    // corners, each burner a ring + cap under four grate fingers, knobs along
    // the front. From hobSpec, the same burners the 3D cooktop has.
    const hs = hobSpec(cab), k = 84 / 36, gw = cab.w * k, gd = cab.d * k, cy = 50;
    p.push(`<rect x="${f(50 - gw / 2)}" y="${f(cy - gd / 2)}" width="${f(gw)}" height="${f(gd)}" rx="3.2" fill="none" stroke="${STROKE}" stroke-width="1.6"/>`);
    for (const b of hs.burners) {
      const bx = 50 + b.x * k, by = cy + b.z * k, r = b.r * k * 1.3;   // drawn a touch bold so it reads at tile size
      p.push(`<circle cx="${f(bx)}" cy="${f(by)}" r="${f(r)}" fill="none" stroke="${STROKE}" stroke-width="1.1"/>`);
      p.push(`<circle cx="${f(bx)}" cy="${f(by)}" r="${f(r * 0.42)}" fill="none" stroke="${HAIR}" stroke-width="0.9"/>`);
      for (let i = 0; i < 4; i++) {                                           // grate fingers
        const a2 = Math.PI / 4 + (i * Math.PI) / 2, c2 = Math.cos(a2), s2 = Math.sin(a2);
        p.push(`<line x1="${f(bx + c2 * r * 0.42)}" y1="${f(by + s2 * r * 0.42)}" x2="${f(bx + c2 * r * 1.22)}" y2="${f(by + s2 * r * 1.22)}" stroke="${HAIR}" stroke-width="0.9" stroke-linecap="round"/>`);
      }
    }
    for (const kn of hs.knobs) p.push(`<circle cx="${f(50 + kn.x * k)}" cy="${f(cy + kn.z * k)}" r="1.3" fill="${KNOB}" stroke="none"/>`);
  } else if (a === 'sink') {
    // plan view to scale (a 33" reads wider than a 24"): the rim, the rounded
    // bowl(s) drawn as a double line (the wall), four pressed creases running to
    // a drain set toward the back, and a tap with its spout over the bowl.
    const sp = sinkSpec(cab);
    const k = 82 / 34, cw = sp.cutW * k, cd = sp.cutD * k, cy = 57, rim = 2.6;
    p.push(`<rect x="${f(50 - cw / 2 - rim)}" y="${f(cy - cd / 2 - rim)}" width="${f(cw + 2 * rim)}" height="${f(cd + 2 * rim)}" rx="${f(sp.r * k * 0.55 + rim)}" fill="none" stroke="${STROKE}" stroke-width="1.6"/>`);
    for (const bl of sp.bowls) {
      const x0 = 50 + (bl.x - bl.w / 2) * k, y0 = cy - cd / 2, bw = bl.w * k, r = sp.r * k;
      p.push(`<rect x="${f(x0)}" y="${f(y0)}" width="${f(bw)}" height="${f(cd)}" rx="${f(r)}" fill="none" stroke="${STROKE}" stroke-width="1"/>`);
      const dx = 50 + bl.x * k, dy = cy + sp.drainZ * k, dr = Math.min(3.4, bw / 7);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {          // pressed creases, corner to drain
        const ex = dx + sx * (bw / 2 - r * 0.62), ey = cy + sy * (cd / 2 - r * 0.62);
        const len = Math.hypot(ex - dx, ey - dy), ux = (ex - dx) / len, uy = (ey - dy) / len;
        p.push(`<line x1="${f(dx + ux * (dr + 1.2))}" y1="${f(dy + uy * (dr + 1.2))}" x2="${f(ex)}" y2="${f(ey)}" stroke="${HAIR}" stroke-width="0.8" stroke-linecap="round"/>`);
      }
      p.push(`<circle cx="${f(dx)}" cy="${f(dy)}" r="${f(dr)}" fill="none" stroke="${STROKE}" stroke-width="1"/>`);
      p.push(`<circle cx="${f(dx)}" cy="${f(dy)}" r="${f(dr * 0.4)}" fill="${KNOB}" stroke="none"/>`);
    }
    // tap: base on the rim behind the bowl, spout reaching over it, lever to the side
    const ty = cy - cd / 2 - rim - 4.5;
    p.push(`<line x1="50" y1="${f(ty + 2.6)}" x2="50" y2="${f(cy - cd / 2 + cd * 0.2)}" stroke="${STROKE}" stroke-width="1.8" stroke-linecap="round"/>`);
    p.push(`<circle cx="50" cy="${f(ty)}" r="2.6" fill="none" stroke="${STROKE}" stroke-width="1.2"/>`);
    p.push(`<line x1="${f(50 + 5.5)}" y1="${f(ty)}" x2="${f(50 + 10)}" y2="${f(ty - 2.2)}" stroke="${STROKE}" stroke-width="1.4" stroke-linecap="round"/>`);
  } else if (a === 'hood') {
    // front elevation: flue, tapered canopy, the lip with its lights and buttons, a baffle line
    const k = 78 / 36, cw = cab.w * k, top = 12, shoulder = 46, lipTop = 70, lipBot = 78, flue = 15;
    p.push(rect(50 - flue / 2, top, flue, shoulder - top, 1.4));                                        // flue
    p.push(hline(50 - flue / 2, 50 + flue / 2, top + 9, 0.7));                                          // telescopic joint
    p.push(`<path d="M ${f(50 - flue / 2 - 3)} ${shoulder} L ${f(50 + flue / 2 + 3)} ${shoulder} L ${f(50 + cw / 2)} ${lipTop} L ${f(50 - cw / 2)} ${lipTop} Z" fill="none" stroke="${STROKE}" stroke-width="1.6" stroke-linejoin="round"/>`);
    p.push(rect(50 - cw / 2, lipTop, cw, lipBot - lipTop, 1.6));                                        // lip
    p.push(hline(50 - cw / 2 + 5, 50 + cw / 2 - 5, (shoulder + lipTop) / 2 + 3, 0.7));                  // canopy crease
    for (const sx of [-1, 1]) p.push(`<circle cx="${f(50 + sx * cw * 0.3)}" cy="${f((lipTop + lipBot) / 2)}" r="1.9" fill="none" stroke="${HAIR}" stroke-width="0.9"/>`); // lights
    for (let i = -1; i <= 1; i++) p.push(`<circle cx="${f(50 + i * 4)}" cy="${f((lipTop + lipBot) / 2)}" r="0.9" fill="${KNOB}" stroke="none"/>`);             // buttons
  } else if (a === 'fridge') {
    // front elevation to scale (84" tall fills the tile): doors over a freezer
    // drawer. Integrated = painted shaker panels + knobs on a flush plinth;
    // freestanding = steel doors with bar handles on feet. One door on a narrow
    // or over-under unit, a french pair otherwise.
    const k = 82 / Math.max(84, cab.h), fw = cab.w * k, fh = cab.h * k, x0 = 50 - fw / 2, y1 = 92, y0 = y1 - fh;
    const base = (cab.integrated ? 4.5 : 2.2) * k, drawerH = fh * 0.27;
    const dTop = y1 - base - drawerH, pair = !cab.overUnder && cab.w >= 33;
    p.push(rect(x0, y0, fw, fh, 1.6));
    p.push(hline(x0, x0 + fw, y1 - base, 0.9));                                                         // plinth / feet line
    p.push(hline(x0, x0 + fw, dTop, 1));                                                                // drawer top
    if (pair) p.push(vline(50, y0, dTop, 1));
    const doors = pair ? [[x0, fw / 2], [50, fw / 2]] : [[x0, fw]];
    if (cab.integrated) {
      for (const [dx, dw] of doors) p.push(rect(dx + 2.6, y0 + 2.6, dw - 5.2, dTop - y0 - 5.2, 0.8, HAIR));                    // shaker field
      p.push(rect(x0 + 2.6, dTop + 2.6, fw - 5.2, drawerH - 5.2, 0.8, HAIR));
      const ky = y0 + (dTop - y0) * 0.56;
      if (pair) { knob(p, 50 - 2.4, ky); knob(p, 50 + 2.4, ky); } else knob(p, x0 + fw - 4, ky);
      knob(p, 50 - fw / 9 * 1.5, dTop + 5); knob(p, 50 + fw / 9 * 1.5, dTop + 5);
    } else {
      const bar = (bx, ya, yb) => p.push(`<line x1="${f(bx)}" y1="${f(ya)}" x2="${f(bx)}" y2="${f(yb)}" stroke="${STROKE}" stroke-width="1.6" stroke-linecap="round"/>`);
      const ha = y0 + (dTop - y0) * 0.3, hb = y0 + (dTop - y0) * 0.78;
      if (pair) { bar(50 - 2.6, ha, hb); bar(50 + 2.6, ha, hb); } else bar(x0 + fw - 4, ha, hb);
      p.push(`<line x1="${f(x0 + fw * 0.2)}" y1="${f(dTop + 5)}" x2="${f(x0 + fw * 0.8)}" y2="${f(dTop + 5)}" stroke="${STROKE}" stroke-width="1.6" stroke-linecap="round"/>`);
      for (const sx of [-1, 1]) p.push(rect(50 + sx * (fw / 2 - 4) - 1.5, y1 - base, 3, base, 0.8, HAIR));                       // feet
    }
  } else {
    p.push(rect(x, y, w, h, 1.6));
  }
  return `<svg viewBox="0 0 ${BOX} ${BOX}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true" fill="none">${p.join('')}</svg>`;
}

// ---- primitives ---------------------------------------------------------
function rect(x, y, w, h, sw, stroke = STROKE, fill = 'none') {
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="0.6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function vline(x, y1, y2, sw) { return `<line x1="${f(x)}" y1="${f(y1)}" x2="${f(x)}" y2="${f(y2)}" stroke="${HAIR}" stroke-width="${sw}"/>`; }
function hline(x1, x2, y, sw) { return `<line x1="${f(x1)}" y1="${f(y)}" x2="${f(x2)}" y2="${f(y)}" stroke="${HAIR}" stroke-width="${sw}"/>`; }
function knob(p, cx, cy) { p.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="1.4" fill="${KNOB}" stroke="none"/>`); }
function f(n) { return Math.round(n * 100) / 100; }
