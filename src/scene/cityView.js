// cityView.js — PHOTO MODE ONLY (render step 4, 2026-09-28). The view out of the window: "a bright
// sky and a simple, slightly soft city view (pre-war brick and limestone apartment buildings, no
// skyscrapers), as a plane or background, not an HDRI". Painted on a canvas, seeded, no image file
// (like the floors and worktops): a bright sky, a hazy line of rooftops with water towers, and the
// row of six-to-eight storey buildings across the street, brick with limestone lintels, sills and
// cornices, a limestone one among them, black fire escapes. Softened a touch at the end, as a
// background out of focus would be. Scene/Room hang it on a plane outside each window wall.

const W = 2048, H = 1024;
let _canvas = null;

export function cityCanvas() {
  if (_canvas || typeof document === 'undefined') return _canvas;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), R = rng(0x9e3779b9);
  sky(g, R);
  skyline(g, R);
  street(g, R);
  // out of focus: soften the whole thing a little
  const soft = document.createElement('canvas'); soft.width = W; soft.height = H;
  const s = soft.getContext('2d'); s.filter = 'blur(1.6px)'; s.drawImage(cv, 0, 0);
  _canvas = soft;
  return _canvas;
}

function sky(g, R) {
  const gr = g.createLinearGradient(0, 0, 0, H * 0.62);
  gr.addColorStop(0, '#8db6da'); gr.addColorStop(0.55, '#c4dcec'); gr.addColorStop(1, '#eaf1f2');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9; i++) {                             // a few soft fair-weather clouds
    const cx = R.range(0, W), cy = R.range(40, 300), rx = R.range(90, 220);
    for (let k = 0; k < 5; k++) {
      const x = cx + R.range(-rx, rx), y = cy + R.range(-18, 14), r = R.range(30, 70);
      const c = g.createRadialGradient(x, y, 0, x, y, r);
      c.addColorStop(0, 'rgba(255,255,255,0.55)'); c.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = c; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }
}

// distant rooftops: low, hazy, a few water towers; nothing tall (no skyscrapers)
function skyline(g, R) {
  const haze = [226, 233, 235];
  let x = -20;
  while (x < W) {
    const w = R.range(70, 190), top = R.range(410, 490);
    const base = R.next() < 0.6 ? [150, 96, 78] : [196, 186, 164];
    g.fillStyle = mix(base, haze, 0.62); g.fillRect(x, top, w + 1, H - top);
    g.fillStyle = mix([90, 80, 72], haze, 0.7); g.fillRect(x, top, w + 1, 4);          // parapet line
    if (R.next() < 0.22) waterTower(g, x + R.range(10, Math.max(12, w - 40)), top, mix([92, 70, 56], haze, 0.5));
    x += w;
  }
}
function waterTower(g, x, roof, col) {
  g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 2;
  g.fillRect(x, roof - 44, 26, 30);                                  // the tank
  g.beginPath(); g.moveTo(x - 3, roof - 44); g.lineTo(x + 13, roof - 58); g.lineTo(x + 29, roof - 44); g.fill();   // conical roof
  for (const lx of [x + 3, x + 12, x + 22]) { g.beginPath(); g.moveTo(lx, roof - 14); g.lineTo(lx, roof); g.stroke(); }
}

// the buildings across the street: six to eight storeys, brick and limestone
function street(g, R) {
  const BRICK = [[139, 74, 58], [156, 88, 66], [124, 68, 54], [148, 96, 74]];
  const STONE = [214, 204, 182];
  let x = -30;
  while (x < W) {
    const w = R.range(320, 560), top = R.range(470, 560), limestone = R.next() < 0.28;
    const face = limestone ? STONE.map((v) => v + R.range(-6, 6)) : BRICK[Math.floor(R.next() * BRICK.length)];
    building(g, R, x, top, w, face, limestone);
    x += w;
  }
}

function building(g, R, x0, top, w, face, limestone) {
  // facade with a faint vertical fall-off of light
  const gr = g.createLinearGradient(0, top, 0, H);
  gr.addColorStop(0, rgb(face, 10)); gr.addColorStop(1, rgb(face, -14));
  g.fillStyle = gr; g.fillRect(x0, top, w + 1, H - top);
  if (!limestone) {                                                    // brick coursing, very faint
    g.fillStyle = 'rgba(40,20,14,0.06)';
    for (let y = top + 30; y < H; y += 6) g.fillRect(x0, y, w, 1);
  }
  const trim = limestone ? rgb(face, 16) : 'rgb(214,204,184)';
  // cornice: a projecting stone band with its shadow and dentils
  g.fillStyle = trim; g.fillRect(x0 - 4, top, w + 8, 18);
  g.fillStyle = 'rgba(30,20,14,0.35)'; g.fillRect(x0 - 4, top + 18, w + 8, 5);
  g.fillStyle = trim; for (let dx = 4; dx < w; dx += 12) g.fillRect(x0 + dx, top + 23, 6, 5);
  // window grid
  const bay = R.range(64, 78), n = Math.max(3, Math.floor((w - 40) / bay)), margin = (w - n * bay) / 2;
  const floor = 74, ww = Math.min(40, bay * 0.55), wh = 52;
  for (let y = top + 48; y < H; y += floor) {
    for (let i = 0; i < n; i++) {
      const wx = x0 + margin + i * bay + (bay - ww) / 2;
      if (!limestone) { g.fillStyle = trim; g.fillRect(wx - 4, y - 7, ww + 8, 7); g.fillRect(wx - 3, y + wh, ww + 6, 5); }   // lintel, sill
      else { g.fillStyle = 'rgba(60,50,40,0.18)'; g.fillRect(wx - 3, y - 3, ww + 6, wh + 8); }                                // stone reveal
      window1(g, R, wx, y, ww, wh);
    }
  }
  // a fire escape on some brick fronts: a balcony per floor across two bays, ladders between
  if (!limestone && R.next() < 0.55 && n >= 3) {
    const i0 = Math.floor(R.next() * (n - 1)), fx = x0 + margin + i0 * bay + 6, fw = 2 * bay - 12;
    g.strokeStyle = 'rgba(28,28,30,0.85)'; g.fillStyle = 'rgba(28,28,30,0.85)'; g.lineWidth = 2;
    for (let y = top + 48 + wh + 8; y < H; y += floor) {
      g.fillRect(fx, y, fw, 3);                                        // platform
      g.beginPath(); g.moveTo(fx, y - 14); g.lineTo(fx + fw, y - 14); g.stroke();   // rail
      for (let b = fx; b <= fx + fw; b += 8) { g.beginPath(); g.moveTo(b, y - 14); g.lineTo(b, y); g.stroke(); }
      g.beginPath(); g.moveTo(fx + fw * 0.2, y + 3); g.lineTo(fx + fw * 0.75, y + floor); g.stroke();              // ladder
    }
  }
}

function window1(g, R, x, y, w, h) {
  const gl = g.createLinearGradient(0, y, 0, y + h);                  // dark glass with a little sky in it
  const lift = R.range(-10, 24);
  gl.addColorStop(0, `rgb(${120 + lift},${138 + lift},${152 + lift})`); gl.addColorStop(1, `rgb(${46 + lift / 2},${54 + lift / 2},${64 + lift / 2})`);
  g.fillStyle = gl; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgb(232,228,218)';                                   // painted frames: sash + meeting rail
  g.fillRect(x, y, w, 3); g.fillRect(x, y + h - 3, w, 3); g.fillRect(x, y, 3, h); g.fillRect(x + w - 3, y, 3, h);
  g.fillRect(x, y + h / 2 - 1.5, w, 3);
  if (R.next() < 0.3) { g.fillStyle = 'rgba(236,232,222,0.75)'; g.fillRect(x + 3, y + 3, w - 6, R.range(6, h / 2 - 4)); }   // a blind half down
}

// ---- helpers ----
function mix(a, b, t) { return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; }
function rgb(c, d = 0) { return `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v + d)))).join(',')})`; }
function rng(seed) {                                       // mulberry32
  let a = seed || 1;
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, range: (lo, hi) => lo + next() * (hi - lo) };
}
