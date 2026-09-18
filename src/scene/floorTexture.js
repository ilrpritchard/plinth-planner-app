// floorTexture.js — procedurally painted floors (no image files). Drawn to a
// canvas sized to the room so there is no tiling seam. SEEDED: the same floor in
// the same room paints identically every time (the room rebuilds on every window
// or wall change, and a floor that reshuffled itself each time read as a glitch).
//
// Timber: random-length boards, board-to-board tone, fine low-contrast grain with
// the odd cathedral figure and knot, a micro-bevel. Herringbone: 4.5" x 22.5"
// blocks on the diagonal. Stone: LARGE format with a hairline joint (the old
// 12" tile had 3" of grout and read as tiles floating in grey). Checkerboard,
// terrazzo and a clouded polished concrete round out the set.

import * as THREE from 'three';

const MAXPX = 2048;

/** What each floor key paints. `kind` picks the painter; Room.js FLOORS carries label + colour. */
const PAINT = {
  oak: { kind: 'planks', board: 7 },
  ash: { kind: 'planks', board: 7 },
  walnut: { kind: 'planks', board: 5 },
  herringbone: { kind: 'herringbone' },
  tile: { kind: 'stone', tw: 24, th: 24, bond: 0 },          // honed limestone, large format
  slate: { kind: 'slate' },
  checker: { kind: 'checker' },
  terrazzo: { kind: 'terrazzo' },
  concrete: { kind: 'concrete' },
};

export function makeFloorTexture(key, colorInt, width, depth) {
  const long = Math.max(width, depth, 1);
  const scale = MAXPX / long;                 // px per inch
  const cw = Math.max(8, Math.round(width * scale));
  const ch = Math.max(8, Math.round(depth * scale));
  const cnv = document.createElement('canvas');
  cnv.width = cw; cnv.height = ch;
  paintFloor(cnv.getContext('2d'), key, colorInt, cw, ch, scale, true);

  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** A small square of the real floor for the Room panel swatch (data URL). */
export function floorSwatchURL(key, colorInt, px = 132, inches = 44) {
  const cnv = document.createElement('canvas');
  cnv.width = px; cnv.height = px;
  paintFloor(cnv.getContext('2d'), key, colorInt, px, px, px / inches, false);
  return cnv.toDataURL('image/jpeg', 0.86);
}

function paintFloor(ctx, key, colorInt, cw, ch, s, withVignette) {
  const rgb = toRGB(colorInt), p = PAINT[key] || PAINT.concrete;
  const R = rng(hash(`${key}|${Math.round(cw / s)}x${Math.round(ch / s)}`));
  if (p.kind === 'planks') drawPlanks(ctx, cw, ch, s, rgb, R, p.board);
  else if (p.kind === 'herringbone') drawHerringbone(ctx, cw, ch, s, rgb, R);
  else if (p.kind === 'stone') drawStone(ctx, cw, ch, s, rgb, R, p);
  else if (p.kind === 'slate') drawSlate(ctx, cw, ch, s, rgb, R);
  else if (p.kind === 'checker') drawChecker(ctx, cw, ch, s, R);
  else if (p.kind === 'terrazzo') drawTerrazzo(ctx, cw, ch, s, rgb, R);
  else drawConcrete(ctx, cw, ch, s, rgb, R);
  if (withVignette) vignette(ctx, cw, ch);
}

// roughness / reflection per floor type for a believable surface
export function floorSurface(key) {
  switch ((PAINT[key] || {}).kind) {
    case 'planks': case 'herringbone': return { roughness: 0.58, env: 0.4 };   // matt lacquer
    case 'stone': return { roughness: 0.5, env: 0.5 };                         // honed, not polished
    case 'checker': return { roughness: 0.36, env: 0.7 };
    case 'terrazzo': return { roughness: 0.34, env: 0.7 };
    case 'slate': return { roughness: 0.62, env: 0.35 };
    case 'concrete': return { roughness: 0.46, env: 0.55 };                    // polished concrete
    default: return { roughness: 0.6, env: 0.4 };
  }
}

// ---- timber --------------------------------------------------------------------
// One board, drawn lying along +x from (0,0), `len` x `wid` px. Callers translate
// and rotate, so planks and herringbone blocks share one painter.
function board(ctx, len, wid, s, rgb, R) {
  const tone = R.range(-11, 9), warm = R.range(-3, 3);
  const base = [rgb[0] + tone + warm, rgb[1] + tone, rgb[2] + tone - warm];
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, len, wid); ctx.clip();
  // body, a touch lighter down the middle of the board
  const g = ctx.createLinearGradient(0, 0, 0, wid);
  g.addColorStop(0, css(base, -5)); g.addColorStop(0.5, css(base, 3)); g.addColorStop(1, css(base, -6));
  ctx.fillStyle = g; ctx.fillRect(0, 0, len, wid);
  // straight grain: many hairlines, low contrast, a long lazy wave
  const lines = Math.round(wid / s * 3.2) + 6;
  for (let i = 0; i < lines; i++) {
    const y0 = R.range(0, wid), amp = R.range(0.1, 0.5) * s, wl = R.range(18, 50) * s, ph = R.range(0, 6.28);
    ctx.strokeStyle = css(base, R.range(-26, -8), R.range(0.10, 0.26));
    ctx.lineWidth = Math.max(0.5, s * R.range(0.04, 0.12));
    ctx.beginPath();
    for (let x = 0; x <= len + 4 * s; x += 4 * s) { const y = y0 + Math.sin(x / wl * 6.28 + ph) * amp; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // a cathedral figure on some boards: nested stretched arches
  if (R.next() < 0.3) {
    const cx = R.range(0.2, 0.8) * len, cy = wid * R.range(0.35, 0.65), n = 4 + Math.floor(R.next() * 4);
    for (let i = 1; i <= n; i++) {
      ctx.strokeStyle = css(base, -24, 0.16);
      ctx.lineWidth = Math.max(0.5, s * 0.1);
      ctx.beginPath(); ctx.ellipse(cx, cy, i * R.range(3.2, 4.4) * s, i * wid * 0.085, 0, 0, 6.28); ctx.stroke();
    }
  }
  // the odd small knot
  if (R.next() < 0.07) {
    const kx = R.range(0.1, 0.9) * len, ky = R.range(0.25, 0.75) * wid, kr = R.range(0.35, 0.8) * s;
    ctx.fillStyle = css(base, -48, 0.55); ctx.beginPath(); ctx.ellipse(kx, ky, kr * 1.5, kr, 0, 0, 6.28); ctx.fill();
    ctx.strokeStyle = css(base, -30, 0.3); ctx.lineWidth = Math.max(0.5, s * 0.1);
    ctx.beginPath(); ctx.ellipse(kx, ky, kr * 3, kr * 1.9, 0, 0, 6.28); ctx.stroke();
  }
  ctx.restore();
  // micro-bevel: a dark hairline on the far edges, a faint light one on the near
  const e = Math.max(1, s * 0.09);
  ctx.fillStyle = css(rgb, -62, 0.55); ctx.fillRect(0, wid - e, len, e); ctx.fillRect(len - e, 0, e, wid);
  ctx.fillStyle = css(rgb, 40, 0.16); ctx.fillRect(0, 0, len, e * 0.8);
}

function drawPlanks(ctx, cw, ch, s, rgb, R, boardIn) {
  const wid = boardIn * s;
  for (let y = 0; y < ch; y += wid) {
    let x = -R.range(0, 60) * s;                         // every row starts somewhere different: no stair-step
    while (x < cw) {
      const len = R.range(28, 86) * s;
      ctx.save(); ctx.translate(x, y); board(ctx, len, wid, s, rgb, R); ctx.restore();
      x += len;
    }
  }
}

function drawHerringbone(ctx, cw, ch, s, rgb, R) {
  const B = 4.5 * s, n = 5, L = n * B;                    // 4.5" x 22.5" blocks
  ctx.fillStyle = css(rgb, -40); ctx.fillRect(0, 0, cw, ch);
  ctx.save();
  ctx.translate(cw / 2, ch / 2); ctx.rotate(Math.PI / 4);  // the points run up the room
  const reach = Math.hypot(cw, ch) / 2 + L;
  const kMax = Math.ceil(reach / B) + n, mMax = Math.ceil(reach / (2 * L)) + 1;
  for (let m = -mMax; m <= mMax; m++) for (let k = -kMax; k <= kMax; k++) {
    const hx = k * B + m * 2 * L, hy = k * B;
    if (Math.abs(hx) < reach + L && Math.abs(hy) < reach + L) { ctx.save(); ctx.translate(hx, hy); board(ctx, L, B, s, rgb, R); ctx.restore(); }
    const vx = k * B + L + m * 2 * L, vy = k * B - L + B;
    if (Math.abs(vx) < reach + L && Math.abs(vy) < reach + L) { ctx.save(); ctx.translate(vx + B, vy); ctx.rotate(Math.PI / 2); board(ctx, L, B, s, rgb, R); ctx.restore(); }
  }
  ctx.restore();
}

// ---- stone ---------------------------------------------------------------------
function clouds(ctx, x, y, w, h, rgb, R, count, rMin, rMax, alpha, swing) {
  for (let i = 0; i < count; i++) {
    const r = R.range(rMin, rMax), cx = x + R.range(0, w), cy = y + R.range(0, h);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, css(rgb, R.range(-swing, swing), alpha)); g.addColorStop(1, css(rgb, 0, 0));
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  }
}
function vein(ctx, x, y, w, h, color, R, s) {
  let px = x + R.range(0, w), py = y; const drift = R.range(-0.6, 0.6);
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.5, s * R.range(0.05, 0.16));
  ctx.beginPath(); ctx.moveTo(px, py);
  while (py < y + h) { py += R.range(1.5, 4) * s; px += (drift + R.range(-0.8, 0.8)) * 2 * s; ctx.lineTo(px, py); }
  ctx.stroke();
}
function tileGrid(ctx, cw, ch, s, tw, th, bond, jointRGB, jointIn, each) {
  ctx.fillStyle = css(jointRGB, 0); ctx.fillRect(0, 0, cw, ch);
  const W = tw * s, H = th * s, j = Math.max(1, jointIn * s);
  let row = 0;
  for (let y = 0; y < ch; y += H, row++) for (let x = -(row % 2) * bond * W; x < cw; x += W) {
    ctx.save(); ctx.beginPath(); ctx.rect(x + j / 2, y + j / 2, W - j, H - j); ctx.clip();
    each(x + j / 2, y + j / 2, W - j, H - j, row, Math.round(x / W));
    ctx.restore();
  }
}

function drawStone(ctx, cw, ch, s, rgb, R, p) {
  tileGrid(ctx, cw, ch, s, p.tw, p.th, p.bond, [rgb[0] - 34, rgb[1] - 34, rgb[2] - 32], 0.16, (x, y, w, h) => {
    const tone = R.range(-5, 5), t = [rgb[0] + tone + R.range(-2, 2), rgb[1] + tone, rgb[2] + tone + R.range(-2, 2)];   // tile-to-tile tone, never a colour cast
    ctx.fillStyle = css(t, 0); ctx.fillRect(x, y, w, h);
    clouds(ctx, x, y, w, h, t, R, 7, 4 * s, 11 * s, 0.22, 12);
    for (let i = 0; i < 26; i++) { ctx.fillStyle = css(t, R.range(-30, -12), 0.35); ctx.fillRect(x + R.range(0, w), y + R.range(0, h), Math.max(1, s * 0.12), Math.max(1, s * 0.12)); } // fossil flecks
    if (R.next() < 0.5) vein(ctx, x, y, w, h, css(t, -22, 0.22), R, s);
  });
}

function drawSlate(ctx, cw, ch, s, rgb, R) {
  tileGrid(ctx, cw, ch, s, 24, 12, 0.5, [rgb[0] - 38, rgb[1] - 38, rgb[2] - 36], 0.16, (x, y, w, h) => {
    const hue = R.range(-7, 7), tone = R.range(-13, 12);
    const t = [rgb[0] + tone + hue, rgb[1] + tone + hue * 0.4, rgb[2] + tone - hue * 0.6];
    ctx.fillStyle = css(t, 0); ctx.fillRect(x, y, w, h);
    clouds(ctx, x, y, w, h, t, R, 5, 3 * s, 9 * s, 0.3, 16);
    for (let i = 0; i < 9; i++) {                         // cleft: long soft strokes along the tile
      ctx.strokeStyle = css(t, R.range(-20, 22), 0.16); ctx.lineWidth = Math.max(0.6, s * R.range(0.15, 0.5));
      const yy = y + R.range(0, h); ctx.beginPath(); ctx.moveTo(x + R.range(0, w * 0.4), yy); ctx.lineTo(x + R.range(w * 0.6, w), yy + R.range(-1, 1) * s); ctx.stroke();
    }
  });
}

function drawChecker(ctx, cw, ch, s, R) {
  const white = [232, 229, 222], black = [40, 40, 43];
  tileGrid(ctx, cw, ch, s, 16, 16, 0, [120, 118, 114], 0.1, (x, y, w, h, row, col) => {
    const dark = (row + col) % 2 === 0, t = dark ? black : white;
    ctx.fillStyle = css(t, R.range(-4, 4)); ctx.fillRect(x, y, w, h);
    clouds(ctx, x, y, w, h, t, R, 4, 4 * s, 9 * s, 0.2, dark ? 10 : 8);
    const n = 1 + Math.floor(R.next() * 3);
    for (let i = 0; i < n; i++) vein(ctx, x, y, w, h, dark ? 'rgba(225,225,225,0.20)' : 'rgba(118,122,130,0.30)', R, s);
  });
}

function drawTerrazzo(ctx, cw, ch, s, rgb, R) {
  ctx.fillStyle = css(rgb, 0); ctx.fillRect(0, 0, cw, ch);
  clouds(ctx, 0, 0, cw, ch, rgb, R, Math.round(cw * ch / (30 * s * 30 * s)) + 4, 10 * s, 28 * s, 0.1, 8);
  const chips = [[247, 245, 240], [181, 176, 168], [96, 94, 92], [196, 152, 108], [168, 104, 84], [222, 205, 170], [134, 146, 142]];
  const count = Math.round((cw / s) * (ch / s) * 0.62);
  for (let i = 0; i < count; i++) {
    const c = chips[Math.floor(R.next() * chips.length)], big = R.next() < 0.12;
    const r = (big ? R.range(0.5, 1.1) : R.range(0.12, 0.42)) * s, cx = R.range(0, cw), cy = R.range(0, ch), sides = 4 + Math.floor(R.next() * 3), a0 = R.range(0, 6.28);
    ctx.fillStyle = css(c, R.range(-8, 8));
    ctx.beginPath();
    for (let k = 0; k < sides; k++) { const a = a0 + (k / sides) * 6.28, rr = r * R.range(0.6, 1.1); const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.8; if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.closePath(); ctx.fill();
  }
}

function drawConcrete(ctx, cw, ch, s, rgb, R) {
  ctx.fillStyle = css(rgb, 0); ctx.fillRect(0, 0, cw, ch);
  // power-floated clouding at three scales, then sand speckle and a few trowel arcs
  const area = (cw / s) * (ch / s);
  clouds(ctx, 0, 0, cw, ch, rgb, R, Math.round(area / 900) + 6, 22 * s, 55 * s, 0.24, 18);
  clouds(ctx, 0, 0, cw, ch, rgb, R, Math.round(area / 160) + 10, 6 * s, 16 * s, 0.15, 16);
  for (let i = 0; i < Math.round(area * 0.9); i++) {
    ctx.fillStyle = css(rgb, R.next() < 0.5 ? R.range(-34, -14) : R.range(10, 24), 0.22);
    const d = Math.max(1, s * R.range(0.06, 0.16)); ctx.fillRect(R.range(0, cw), R.range(0, ch), d, d);
  }
  for (let i = 0; i < Math.round(area / 1400) + 3; i++) {
    ctx.strokeStyle = css(rgb, R.range(-16, 16), 0.10); ctx.lineWidth = Math.max(1, s * R.range(0.3, 0.9));
    const a0 = R.range(0, 6.28);
    ctx.beginPath(); ctx.arc(R.range(0, cw), R.range(0, ch), R.range(20, 46) * s, a0, a0 + R.range(0.6, 1.6)); ctx.stroke();
  }
}

// ---- helpers -------------------------------------------------------------------
function vignette(ctx, cw, ch) {
  const grad = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.25, cw / 2, ch / 2, Math.max(cw, ch) * 0.8);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.07)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, cw, ch);
}
function toRGB(n) { return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function css(rgb, amt = 0, alpha) {
  const c = rgb.map((v) => Math.max(0, Math.min(255, Math.round(v + amt))));
  return alpha != null ? `rgba(${c[0]},${c[1]},${c[2]},${alpha})` : `rgb(${c[0]},${c[1]},${c[2]})`;
}
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {                                       // mulberry32
  let a = seed || 1;
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, range: (lo, hi) => lo + next() * (hi - lo) };
}
