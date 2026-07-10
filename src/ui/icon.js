// icon.js — clean line-art front elevations for the catalogue, drawn to scale
// in PL/NTH's spec-sheet style. Fully offline (inline SVG). Line-art (not
// painted) so every block reads clearly on a white tile regardless of finish.
//
// Construction matches the spec: 22mm legs each side, 80mm shaker stiles/rails,
// flush 115mm plinth, recessed door panels, flat drawer fronts.

import { SPEC } from '../core/units.js';

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
export function cabinetSVG(cab) {
  if (cab.appliance) return applianceSVG(cab);
  if (cab.shelf) return shelfSVG();
  const cornerRet = cab.corner ? (cab.type === 'FLOOR' ? 20 : 10) : 0; // blank return panel
  const wIn = (cab.w || 24) + cornerRet;
  const hIn = cab.h || 35;
  const avail = BOX - 2 * PAD;
  const ar = wIn / hIn;
  let dw, dh;
  if (ar >= 1) { dw = avail; dh = avail / ar; } else { dh = avail; dw = avail * ar; }
  const s = dw / wIn;                 // px per inch (uniform — aspect preserved)
  const x0 = (BOX - dw) / 2;
  const y0 = (BOX - dh) / 2;

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

  // leg + top-rail lines (light)
  p.push(vline(x0 + leg, y0, y0 + dh, 0.7));
  p.push(vline(x0 + dw - leg, y0, y0 + dh, 0.7));
  p.push(hline(x0, x0 + dw, y0 + leg, 0.7));
  if (hasPlinth) p.push(hline(x0, x0 + dw, y0 + dh - plinth, 1.1)); // flush plinth

  drawFront(p, cab, { ox, oy, ow, oh, frame, s });

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
    knob(p, x + w / 2, y + h / 2); // centred knob — Plinth hardware is knobs only
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
    case 'door': case 'bin': {
      if (isTall) tallDoor(ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, +1);
      else doorPanel(ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, +1);
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
    case 'dishwasher': p.push(rect(ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, 1)); break;
    case 'housing': {
      // fridge housing — drawn as a 2-panel shaker door per spec
      tallDoor(ox + rev, oy + rev, ow - 2 * rev, oh - 2 * rev, +1);
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
      doorPanel(ox + rev, dy + drawH, ow - 2 * rev, oy + oh - (dy + drawH) - rev, +1); // low door
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
    p.push(rect(x, y + 14, w, h - 14, 1.6));        // body
    p.push(hline(x, x + w, y + 28, 0.9));            // cooktop line
    [[-1, 0], [1, 0]].forEach(([sx]) => p.push(disc(50 + sx * 16, y + 21, 5)));
    p.push(rect(x + 8, y + 34, w - 16, h - 30, 0.9, HAIR)); // oven door
    p.push(hline(x + 14, x + w - 14, y + 40, 0.7));  // handle
  } else if (a === 'hob') {
    p.push(rect(x, y + 18, w, h - 34, 1.6));
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => p.push(disc(50 + sx * 16, 50 + sy * 13, 7)));
  } else if (a === 'sink') {
    p.push(rect(x, y + 10, w, h - 24, 1.6));
    const dbl = /double/i.test(cab.desc);
    if (dbl) { p.push(rect(x + 6, y + 18, w / 2 - 9, h - 40, 0.9, HAIR)); p.push(rect(x + w / 2 + 3, y + 18, w / 2 - 9, h - 40, 0.9, HAIR)); }
    else p.push(rect(x + 10, y + 18, w - 20, h - 40, 0.9, HAIR));
    p.push(disc(50, y + 6, 2.4)); p.push(vline(50, y + 4, y + 12, 1));
  } else if (a === 'hood') {
    p.push(`<path d="M ${x} ${y + h} L ${x + 12} ${y + 30} L ${x + w - 12} ${y + 30} L ${x + w} ${y + h} Z" fill="none" stroke="${STROKE}" stroke-width="1.6"/>`);
    p.push(rect(x + w / 2 - 8, y + 8, 16, 24, 1.2));
  } else if (a === 'fridge') {
    p.push(rect(x + 16, y, w - 32, h, 1.6));
    p.push(hline(x + 16, x + w - 16, y + h * 0.42, 0.9));
    p.push(vline(x + 22, y + 6, y + h * 0.38, 1.2));
    p.push(vline(x + 22, y + h * 0.46, y + h - 6, 1.2));
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
