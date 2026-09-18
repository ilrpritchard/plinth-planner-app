// worktopTexture.js — procedurally painted countertops (no image files).
//
// ONE tileable 1024px canvas per material = 96" of real surface, mapped in WORLD
// space by models/worktop.js. That matters: the old 512px tile was stretched
// once across every slab piece, so a long run smeared its veins and the four
// pieces round a sink cutout each restarted the pattern. Now a vein that leaves
// one piece carries on in the next, and the tile repeats without a seam
// (everything is drawn wrapped). Seeded: a material always paints the same.
//
// Countertops are NOT supplied by PL/NTH: this is a visual aid, never priced.

const S = 1024;               // px per tile
export const WORKTOP_TILE_IN = 96;
const PPI = S / WORKTOP_TILE_IN;

const _canvas = new Map();

/** The painted tile for a material key (cached). Browser only; null in node. */
export function worktopCanvas(key) {
  if (typeof document === 'undefined') return null;
  if (_canvas.has(key)) return _canvas.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d'), R = rng(hash(`worktop|${key}`));
  (PAINTERS[key] || PAINTERS.marble)(g, R);
  _canvas.set(key, cv);
  return cv;
}

/** A patch of the real surface for the Room-panel swatch (data URL). */
export function worktopSwatchURL(key, px = 132, inches = 30) {
  const src = worktopCanvas(key);
  if (!src) return '';
  const cv = document.createElement('canvas'); cv.width = cv.height = px;
  const crop = inches * PPI;
  cv.getContext('2d').drawImage(src, S * 0.18, S * 0.22, crop, crop, 0, 0, px, px);
  return cv.toDataURL('image/jpeg', 0.88);
}

// ---- wrapped drawing: anything that crosses an edge reappears on the far side ----
function wrapped(g, draw) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); draw(); g.restore(); }
}
function clouds(g, R, count, rMin, rMax, rgb, swing, alpha) {
  for (let i = 0; i < count; i++) {
    const r = R.range(rMin, rMax), cx = R.range(0, S), cy = R.range(0, S), c = css(rgb, R.range(-swing, swing), alpha), c0 = css(rgb, 0, 0);
    wrapped(g, () => { const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, c); gr.addColorStop(1, c0); g.fillStyle = gr; g.fillRect(cx - r, cy - r, 2 * r, 2 * r); });
  }
}
/** A wandering vein: a random walk biased along `angle`, stroked soft-wide then sharp-thin. */
function vein(g, R, { angle, len, color, width, soft = 3.2, wander = 0.34, branch = 0.0 }) {
  const pts = []; let x = R.range(0, S), y = R.range(0, S), a = angle + R.range(-0.35, 0.35);
  pts.push([x, y]);
  for (let d = 0; d < len;) { const step = R.range(7, 16); a += R.range(-wander, wander); a += (angle - a) * 0.12; x += Math.cos(a) * step; y += Math.sin(a) * step; d += step; pts.push([x, y]); }
  const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); } };
  g.lineCap = 'round'; g.lineJoin = 'round';
  wrapped(g, () => { path(); g.strokeStyle = color(0.16); g.lineWidth = width * soft; g.stroke(); path(); g.strokeStyle = color(0.55); g.lineWidth = width; g.stroke(); });
  if (branch > 0 && R.next() < branch) {
    const from = pts[Math.floor(pts.length * R.range(0.25, 0.7))];
    const sub = { angle: angle + R.range(0.5, 1.0) * (R.next() < 0.5 ? -1 : 1), len: len * 0.35, color, width: width * 0.55, soft, wander };
    const px = from[0], py = from[1];
    const pts2 = [[px, py]]; let bx = px, by = py, ba = sub.angle;
    for (let d = 0; d < sub.len;) { const step = R.range(6, 13); ba += R.range(-wander, wander); bx += Math.cos(ba) * step; by += Math.sin(ba) * step; d += step; pts2.push([bx, by]); }
    wrapped(g, () => { g.beginPath(); g.moveTo(px, py); for (const p of pts2) g.lineTo(p[0], p[1]); g.strokeStyle = color(0.4); g.lineWidth = sub.width; g.stroke(); });
  }
}
function speckle(g, R, count, colors, sizeMin, sizeMax) {
  for (let i = 0; i < count; i++) {
    const c = colors[Math.floor(R.next() * colors.length)], d = R.range(sizeMin, sizeMax);
    g.fillStyle = c; g.fillRect(R.range(0, S), R.range(0, S), d, d);
  }
}
/** End-grain-free butcher block: full-length staves, random joints, fine grain. Runs along u. */
function staves(g, R, rgb) {
  const wid = 1.75 * PPI;
  const rows = Math.round(S / wid), h = S / rows;                 // whole staves per tile: it repeats cleanly
  for (let r = 0; r < rows; r++) {
    const y = r * h; let x = -R.range(0, 30) * PPI; const x0 = x;
    while (x < x0 + S) {
      const len = Math.min(R.range(14, 44) * PPI, x0 + S - x);
      const tone = R.range(-16, 14), warm = R.range(-4, 4), base = [rgb[0] + tone + warm, rgb[1] + tone, rgb[2] + tone - warm];
      for (const ox of [0, S]) {
        g.save(); g.beginPath(); g.rect(x + ox, y, len, h); g.clip();
        g.fillStyle = css(base, 0); g.fillRect(x + ox, y, len, h);
        for (let i = 0; i < 7; i++) {
          g.strokeStyle = css(base, R.range(-26, -8), R.range(0.12, 0.28)); g.lineWidth = R.range(0.5, 1.1);
          const gy = y + R.range(0, h); g.beginPath(); g.moveTo(x + ox, gy); g.bezierCurveTo(x + ox + len * 0.3, gy + R.range(-1.5, 1.5), x + ox + len * 0.7, gy + R.range(-1.5, 1.5), x + ox + len, gy + R.range(-1, 1)); g.stroke();
        }
        g.restore();
        g.fillStyle = css(rgb, -58, 0.5); g.fillRect(x + ox + len - 1, y, 1, h);      // butt joint
      }
      x += len;
    }
    g.fillStyle = css(rgb, -52, 0.42); g.fillRect(0, y + h - 1, S, 1);                // glue line
  }
}

const grey = (r, gr, b) => (a) => `rgba(${r},${gr},${b},${a})`;

const PAINTERS = {
  // Carrara: soft grey ground, many fine feathered veins on one diagonal
  marble(g, R) {
    const base = [226, 224, 219];
    g.fillStyle = css(base); g.fillRect(0, 0, S, S);
    clouds(g, R, 26, 90, 260, [196, 198, 202], 8, 0.22);
    for (let i = 0; i < 34; i++) vein(g, R, { angle: 0.62, len: R.range(240, 760), color: grey(124, 128, 136), width: R.range(0.7, 1.9), soft: 4, branch: 0.35 });
    for (let i = 0; i < 5; i++) vein(g, R, { angle: 0.62, len: R.range(500, 1000), color: grey(96, 100, 110), width: R.range(2.0, 3.4), soft: 5, branch: 0.6 });
  },
  // Calacatta: whiter ground, a few bold veins with a warm edge, little else
  calacatta(g, R) {
    const base = [236, 233, 227];
    g.fillStyle = css(base); g.fillRect(0, 0, S, S);
    clouds(g, R, 12, 120, 300, [214, 212, 208], 6, 0.18);
    for (let i = 0; i < 7; i++) {
      const a = 0.9 + R.range(-0.25, 0.25), len = R.range(700, 1300), w = R.range(3.5, 8);
      vein(g, R, { angle: a, len, color: grey(176, 148, 104), width: w * 1.5, soft: 3.2, wander: 0.22 });   // warm halo
    }
    for (let i = 0; i < 9; i++) vein(g, R, { angle: 0.9, len: R.range(600, 1300), color: grey(98, 100, 108), width: R.range(2.6, 6.5), soft: 3.6, wander: 0.24, branch: 0.7 });
    for (let i = 0; i < 12; i++) vein(g, R, { angle: 0.9, len: R.range(200, 520), color: grey(140, 142, 150), width: R.range(0.7, 1.4), soft: 3, branch: 0.2 });
  },
  // engineered quartz: near-uniform warm white with a fine fleck
  quartz(g, R) {
    const base = [232, 230, 225];
    g.fillStyle = css(base); g.fillRect(0, 0, S, S);
    clouds(g, R, 10, 140, 320, [222, 220, 214], 5, 0.16);
    speckle(g, R, 9000, ['rgba(255,255,255,0.55)', 'rgba(178,176,170,0.40)', 'rgba(150,148,142,0.28)'], 1, 2.2);
  },
  // soapstone: charcoal with a green cast, soft clouding, a few thin white veins. Matt.
  soapstone(g, R) {
    const base = [62, 69, 68];
    g.fillStyle = css(base); g.fillRect(0, 0, S, S);
    clouds(g, R, 30, 70, 240, base, 14, 0.3);
    speckle(g, R, 5000, ['rgba(30,34,34,0.4)', 'rgba(120,130,126,0.22)'], 1, 2.4);
    for (let i = 0; i < 9; i++) vein(g, R, { angle: 0.35, len: R.range(300, 900), color: grey(218, 224, 220), width: R.range(0.7, 1.8), soft: 3.4, branch: 0.45 });
  },
  // honed black granite: near-black ground, tight mineral fleck
  granite(g, R) {
    const base = [38, 39, 43];
    g.fillStyle = css(base); g.fillRect(0, 0, S, S);
    clouds(g, R, 20, 60, 200, base, 9, 0.35);
    speckle(g, R, 16000, ['rgba(176,180,190,0.30)', 'rgba(94,98,108,0.55)', 'rgba(12,12,15,0.6)', 'rgba(210,205,190,0.18)'], 1, 2.6);
  },
  oak(g, R) { staves(g, R, [188, 148, 98]); },
  walnut(g, R) { staves(g, R, [104, 72, 50]); },
};

// ---- helpers -----------------------------------------------------------------
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
