// cityView.js — PHOTO MODE ONLY (render step 4, 2026-09-28). The view out of the window, painted on a
// canvas, seeded, no image file (like the floors and worktops); Scene/Room hang it on a plane outside
// each window wall with the painting's horizon (45% down) at eye height.
//
// A HIGH FLOOR looking out over a city (her call 2026-09-29: "a higher floor, like a subtle skyline,
// not obviously NYC"; it was a street of brick walk-ups with water towers and fire escapes): mostly
// sky, a soft band of distant buildings standing on the horizon in three layers of haze, the rooftops
// below falling away out of sight. Nothing that names a city: no water towers, fire escapes or brick
// red; stone, glass and grey in low contrast, softened as a background out of focus would be.
//
// Scale: through a 4' window from across the room the plane shows ~220px each way around the horizon,
// so a building is 10-90px wide and the whole skyline sits within ~110px of it.

const W = 2048, H = 1024, HORIZON = Math.round(H * 0.45);
let _canvas = null;

export function cityCanvas() {
  if (_canvas || typeof document === 'undefined') return _canvas;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), R = rng(0x9e3779b9);
  sky(g, R);
  // far to near: each layer a little darker and warmer, all of it well inside the haze
  layer(g, R, { haze: 0.76, minW: 10, maxW: 46, lo: 8, hi: 56, towers: 0.12, towerHi: 120, base: HORIZON + 6 });
  layer(g, R, { haze: 0.62, minW: 18, maxW: 70, lo: -2, hi: 40, towers: 0.08, towerHi: 90, base: HORIZON + 30 });
  rooftops(g, R);
  horizonHaze(g);
  // out of focus: soften the whole thing
  const soft = document.createElement('canvas'); soft.width = W; soft.height = H;
  const s = soft.getContext('2d'); s.filter = 'blur(2.2px)'; s.drawImage(cv, 0, 0);
  _canvas = soft;
  return _canvas;
}

const HAZE = [226, 232, 236];
const TONES = [[150, 156, 162], [172, 168, 158], [136, 142, 150], [186, 180, 168], [120, 128, 138]];   // grey stone, sand, glass

function sky(g, R) {
  const gr = g.createLinearGradient(0, 0, 0, HORIZON + 40);
  gr.addColorStop(0, '#9cbedb'); gr.addColorStop(0.6, '#c9dcea'); gr.addColorStop(1, '#e9eef1');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 7; i++) {                             // a few thin, high, fair-weather clouds
    const cx = R.range(0, W), cy = R.range(60, HORIZON - 160), rx = R.range(140, 320);
    for (let k = 0; k < 6; k++) {
      const x = cx + R.range(-rx, rx), y = cy + R.range(-10, 10), r = R.range(26, 60);
      const c = g.createRadialGradient(x, y, 0, x, y, r);
      c.addColorStop(0, 'rgba(255,255,255,0.35)'); c.addColorStop(1, 'rgba(255,255,255,0)');
      g.save(); g.translate(x, y); g.scale(2.4, 0.6); g.translate(-x, -y);
      g.fillStyle = c; g.fillRect(x - r, y - r, 2 * r, 2 * r); g.restore();
    }
  }
}

// one band of buildings standing on the horizon: tops `lo`..`hi` px above it, now and then a slim
// taller one, flat roofs with a slightly lighter lit edge; faint floor lines on the nearer bands
function layer(g, R, o) {
  let x = -10;
  while (x < W) {
    const w = R.range(o.minW, o.maxW), tall = R.next() < o.towers;
    const top = HORIZON - (tall ? R.range(o.hi, o.towerHi) : R.range(o.lo, o.hi));
    const tone = TONES[Math.floor(R.next() * TONES.length)];
    g.fillStyle = mix(tone, HAZE, o.haze); g.fillRect(x, top, w + 0.5, o.base - top);
    g.fillStyle = mix([250, 250, 248], HAZE, 0.5); g.fillRect(x, top, w + 0.5, 1.5);                 // lit roof edge
    if (o.haze < 0.8) {                                                                              // faint floor lines
      g.fillStyle = `rgba(90,98,108,${(0.9 - o.haze) * 0.35})`;
      for (let y = top + 5; y < o.base; y += 4) g.fillRect(x + 1, y, w - 1.5, 1);
    }
    x += w + (R.next() < 0.25 ? R.range(2, 10) : 0);
  }
}

// below the horizon: the roofscape seen from above, falling away. Blocks scattered at random (rows read
// as brickwork), drawn back to front, smaller and hazier toward the horizon: a lit roof, the shaded
// face below it
function rooftops(g0, R) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, HORIZON, 0, H);
  gr.addColorStop(0, mix([160, 160, 156], HAZE, 0.75)); gr.addColorStop(1, mix([128, 126, 120], HAZE, 0.5));
  g.fillStyle = gr; g.fillRect(0, HORIZON + 8, W, H);
  const blocks = [];
  for (let i = 0; i < 1400; i++) {
    const t = Math.pow(R.next(), 1.7);                         // most of them far off, near the horizon
    blocks.push({ t, x: R.range(-60, W), y: HORIZON + 10 + t * (H - HORIZON) });
  }
  blocks.sort((p, q) => p.y - q.y);
  for (const { t, x, y } of blocks) {
    const sc = 0.45 + t * 3.2, hz = 0.84 - t * 0.22;
    const w = R.range(14, 52) * sc, roof = R.range(3, 7) * sc, face = R.range(4, 18) * sc;
    const tone = TONES[Math.floor(R.next() * TONES.length)];
    g.fillStyle = mix(tone.map((v) => v + 16), HAZE, hz); g.fillRect(x, y - roof, w, roof);        // the lit roof
    g.fillStyle = mix(tone.map((v) => v - 22), HAZE, hz); g.fillRect(x, y, w, face);               // its shaded face
  }
  g0.save(); g0.filter = 'blur(3px)'; g0.drawImage(cv, 0, 0); g0.restore();          // further out of focus than the skyline
}

// the air: a warm-white band along the horizon that washes the contrast out of the distance
function horizonHaze(g) {
  const gr = g.createLinearGradient(0, HORIZON - 110, 0, HORIZON + 70);
  gr.addColorStop(0, 'rgba(236,240,242,0)'); gr.addColorStop(0.6, 'rgba(236,240,242,0.38)'); gr.addColorStop(1, 'rgba(236,240,242,0)');
  g.fillStyle = gr; g.fillRect(0, HORIZON - 110, W, 180);
}

// ---- helpers ----
function mix(a, b, t) { return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; }
function rgb(c, d = 0) { return `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v + d)))).join(',')})`; }
function rng(seed) {                                       // mulberry32
  let a = seed || 1;
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, range: (lo, hi) => lo + next() * (hi - lo) };
}
