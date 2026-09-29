// construction-render.mjs — the construction guard, in PIXELS (render step 7, 2026-09-29).
//
//   npm run test:render                              headless Chrome on the GPU, ~11 s
//   node test/construction-render.mjs <out> [--dump]  also saves the frames it measured (and the
//                                                      measured profiles) into <out>/
//
// test/construction.test.js proves the geometry is right; this proves the RENDER still shows it, so a
// lighting, shading or post-processing change cannot quietly paint over the construction. Both
// fixture kitchens (test/fixtures/construction-kitchens.json) are photographed straight on, a level
// camera square to the fronts, at 3600 x 2400 (about 2px per mm on the fronts), in the live planner
// and in photo mode. Every measurement line is placed by projecting points of the face plane through
// the camera the scene actually used, and read off the image as a luminance profile:
//   · straight on is straight: a level camera stays level, so legs and joints stand vertical
//   · each cabinet: a painted 22mm leg down both sides, ended by the dark reveal of its front
//   · each junction: leg, ONE dark joint line, leg (never none, never a double line)
//   · each door cabinet and drawer bank: a painted 35mm top rail between the worktop and the front, no
//     shadow striping along it (the live shadow's stepped edge, fixed 2026-09-29)
//   · the plinth: along it, exactly one dark joint per junction and no other line; up it, paint from
//     the floor (no dark toe-kick band, no gap under the cabinet)
// Tolerances are a few pixels: tight enough that a missing leg, a swallowed or doubled joint, or a
// shadowed-out rail fails, loose enough for anti-aliasing.
//
// Not in `npm test`: it needs Chrome and a GPU. Run it after any change to src/scene or the materials.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : null;
const FIX = JSON.parse(await readFile(path.join(ROOT, 'test/fixtures/construction-kitchens.json'), 'utf8'));
const W = 3600, H = 2400, PORT = 8098;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MM = 1 / 25.4, PLINTH = 115 * MM, TOP = 35;               // inches; TOP = the cabinet top (worktop underside)
const DARK = 0.85;       // darker than 85% of the paint around it = a line (reveal, joint) or a shadow
const LEG = [18, 26], JOINT_MAX = 4, RAIL = [30, 40];            // mm, as seen: the reveal eats a pixel or two
const STRIPE = 0.45;     // the rail's stripe score limit (see the test)

// ---- render both kitchens in both modes and read the measurement lines off each frame ---------------
async function renderAll() {
  const server = spawn('python3', ['dev-server.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  const browser = await puppeteer.launch({
    headless: true, executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  try {
    const frames = [];
    for (const name of ['run', 'island']) for (const mode of ['live', 'photo']) {
      const page = await browser.newPage();              // a fresh page per frame: nothing carries over
      page.on('pageerror', (e) => console.error('  page error:', e.message));
      await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1 });
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
      await page.waitForFunction('window.PlinthPlanner && window.PlinthPlanner.scene', { timeout: 30000 });
      frames.push(await page.evaluate(measure, FIX[name], name, mode, W, H, { PLINTH, MM, TOP }));
      await page.close();
    }
    return frames;
  } finally { await browser.close(); server.kill(); }
}

// runs in the page
async function measure(state, name, mode, W, H, K) {
  const P = window.PlinthPlanner, S = P.scene;
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  P.loadState(state);
  await (S.envReady || Promise.resolve());
  await new Promise((r) => setTimeout(r, 500)); await frame();
  if (mode === 'photo') { P.photoMode.start(); await (S.photoReady || Promise.resolve()); await frame(); }
  const cabs = [...S.scene.getObjectByName('cabinets').children].map((g) => {
    const it = state.items.find((i) => i.id === g.userData.itemId), f = g.userData.footprint;
    return { code: it.code, x0: it.x - f.w / 2, x1: it.x + f.w / 2, face: it.z + f.d / 2 };
  }).sort((a, b) => a.x0 - b.x0);
  const face = cabs[0].face, xa = cabs[0].x0, xb = cabs[cabs.length - 1].x1;
  // a level camera square to the fronts, 90" back, framing the run with 4" either side
  const dist = 90, cx = (xa + xb) / 2, cy = 17.5;
  const fov = 2 * Math.atan((((xb - xa) / 2 + 4) / dist) / (W / H)) * 180 / Math.PI;
  const view = { key: 'construction', name: 'Construction guard', pos: [cx, cy, face + dist], target: [cx, cy, face], fov };
  // where the scene really puts the camera for this view (captureViews goes through the same lookFrom)
  S.lookFrom(view);
  const cam = S.persp.clone();
  cam.aspect = W / H; cam.clearViewOffset?.(); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const look = cam.getWorldDirection(cam.position.clone());
  const level = { dirY: look.y, posY: cam.position.y };
  const [shot] = S.captureViews([view], { width: W, height: H, type: 'image/png' });
  const img = new Image(); img.src = shot.url; await img.decode();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, W, H).data;
  const v = cam.position.clone();
  const px = (x, y) => { v.set(x, y, face).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
  const ppmm = (px(cx + 1, cy)[0] - px(cx, cy)[0]) * K.MM;       // pixels per mm on the face plane
  // a line on the face plane, two samples per pixel so none is skipped: [{ w, L, c }] where w = the
  // world coordinate along the line (inches), L = luminance, c = [r, g, b]
  const line = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(len / K.MM * ppmm * 2), out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, [u, w] = px(x, y);
      const k = (Math.min(H - 1, Math.max(0, Math.round(w))) * W + Math.min(W - 1, Math.max(0, Math.round(u)))) * 4;
      const c = [data[k], data[k + 1], data[k + 2]];
      out.push({ w: x0 === x1 ? y : x, L: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], c });
    }
    return out;
  };
  const out = { name, mode, ppmm, level, url: shot.url, cabs, rows: [], plinthRows: [], rails: [], plinthCols: [] };
  for (const y of [K.PLINTH + 1.5, (K.PLINTH + K.TOP) / 2, K.TOP - 35 * K.MM - 1.5]) out.rows.push({ y, s: line(xa - 0.5, y, xb + 0.5, y) });
  for (const y of [30 * K.MM, K.PLINTH / 2, K.PLINTH - 25 * K.MM]) out.plinthRows.push({ y, s: line(xa + 0.15, y, xb - 0.15, y) });
  for (const c of cabs) {
    const w = c.x1 - c.x0;
    for (const x of [c.x0 + w / 4, c.x1 - w / 4]) out.rails.push({ code: c.code, x, s: line(x, K.TOP + 0.5, x, K.TOP - 70 * K.MM) });
    for (let x = c.x0 + 1; x < c.x1 - 0.9; x += 2) out.plinthCols.push({ code: c.code, x, s: line(x, 5 * K.MM, x, K.PLINTH - 3 * K.MM) });
  }
  // the rail band across the whole run, 3-30mm under the worktop, for the stripe check
  out.railRows = [];
  for (let mm = 3; mm <= 30; mm += 1.5) out.railRows.push(line(xa + 1.5, K.TOP - mm * K.MM, xb - 1.5, K.TOP - mm * K.MM).filter((_, i) => i % 2 === 0).map((q) => q.L));
  // the paint of each cabinet, read off the middle of its plinth: luminance and (G-B)/G, its hue
  out.paint = cabs.map((c) => {
    const s = line(c.x0 + 2, K.PLINTH / 2, c.x1 - 2, K.PLINTH / 2), m = s[s.length >> 1];
    return { L: s.map((q) => q.L).sort((a, b) => a - b)[s.length >> 1], k: (m.c[1] - m.c[2]) / m.c[1] };
  });
  return out;
}

// ---- reading a profile ------------------------------------------------------------------------------
const STEP = (s) => Math.abs(s[1].w - s[0].w);
// 'P' paint-bright or 'd' dark, against the running median over `win` mm (so a sun gradient across a
// run never reads as a line)
function classify(s, win = 60) {
  const half = Math.max(8, Math.round(win * MM / STEP(s) / 2)), L = s.map((q) => q.L);
  return s.map((q, i) => { const w = L.slice(Math.max(0, i - half), i + half + 1).sort((a, b) => a - b); return q.L < DARK * w[w.length >> 1] ? 'd' : 'P'; });
}
function runs(s, cls) {
  const out = [], st = STEP(s);
  for (let i = 0; i < cls.length;) {
    let j = i; while (j < cls.length && cls[j] === cls[i]) j++;
    const a = Math.min(s[i].w, s[j - 1].w), b = Math.max(s[i].w, s[j - 1].w) + st;
    out.push({ c: cls[i], a, b, mm: (b - a) / MM }); i = j;
  }
  return out;
}
const overlaps = (q, a, b) => q.a < b && q.b > a;
const show = (r, a, b) => r.filter((q) => overlaps(q, a, b)).map((q) => q.c + q.mm.toFixed(1)).join(' ');

// ---- the tests ----------------------------------------------------------------------------------------
const frames = await renderAll();
if (OUT) {
  await mkdir(OUT, { recursive: true });
  for (const f of frames) await writeFile(path.join(OUT, `construction_${f.name}_${f.mode}.png`), Buffer.from(f.url.split(',')[1], 'base64'));
  if (process.argv.includes('--dump')) await writeFile(path.join(OUT, 'profiles.json'), JSON.stringify(frames.map(({ url, ...f }) => f)));
}
let rev = ''; try { rev = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { /* not a checkout */ }
console.log(`# construction guard, pixels · ${rev} · ${frames.map((f) => `${f.name}/${f.mode} ${f.ppmm.toFixed(2)}px/mm`).join(', ')}`);

for (const f of frames) {
  const tag = `${f.name} (${f.mode})`, junctions = f.cabs.slice(1).map((c) => c.x0);
  const within = (mm, [lo, hi]) => mm >= lo && mm <= hi;
  const cabAt = (x) => f.cabs.findIndex((c) => x > c.x0 && x < c.x1);

  test(`${tag}: straight on is straight: a level camera stays level (verticals vertical)`, () => {
    assert.ok(Math.abs(f.level.dirY) < 1e-4 && Math.abs(f.level.posY - 17.5) < 1e-3,
      `the camera was tipped ${(Math.asin(-f.level.dirY) * 180 / Math.PI).toFixed(2)} deg down and lifted to ${f.level.posY.toFixed(2)}"`);
  });

  test(`${tag}: every cabinet shows a 22mm leg down both sides`, () => {
    for (const { y, s } of f.rows) {
      const r = runs(s, classify(s));
      for (const c of f.cabs) {
        const left = r.find((q) => q.c === 'P' && overlaps(q, c.x0 + 4 * MM, c.x0 + 12 * MM));
        const right = r.find((q) => q.c === 'P' && overlaps(q, c.x1 - 12 * MM, c.x1 - 4 * MM));
        const lmm = left && (Math.min(left.b, c.x1) - Math.max(left.a, c.x0)) / MM, rmm = right && (Math.min(right.b, c.x1) - Math.max(right.a, c.x0)) / MM;
        assert.ok(left && within(lmm, LEG), `${c.code} left leg at ${y.toFixed(1)}": ${left ? lmm.toFixed(1) + 'mm' : 'missing'} (${show(r, c.x0 - 3 * MM, c.x0 + 35 * MM)})`);
        assert.ok(right && within(rmm, LEG), `${c.code} right leg at ${y.toFixed(1)}": ${right ? rmm.toFixed(1) + 'mm' : 'missing'} (${show(r, c.x1 - 35 * MM, c.x1 + 3 * MM)})`);
      }
    }
  });

  test(`${tag}: neighbours show two legs butted, with ONE joint line between them`, () => {
    for (const { y, s } of f.rows) {
      const r = runs(s, classify(s));
      for (const jx of junctions) {
        const say = show(r, jx - 35 * MM, jx + 35 * MM);
        const j = r.findIndex((q) => q.c === 'd' && overlaps(q, jx - 1.5 * MM, jx + 1.5 * MM));
        assert.ok(j >= 0, `junction x=${jx} at ${y.toFixed(1)}": no joint line (${say})`);
        assert.ok(r[j].mm <= JOINT_MAX, `junction x=${jx} at ${y.toFixed(1)}": the joint is a fine line, not a gap (${say})`);
        assert.ok(r[j - 1]?.c === 'P' && within(r[j - 1].mm, LEG) && r[j + 1]?.c === 'P' && within(r[j + 1].mm, LEG),
          `junction x=${jx} at ${y.toFixed(1)}": leg | joint | leg, got ${say}`);
      }
    }
  });

  test(`${tag}: a painted 35mm top rail over every door and drawer bank`, () => {
    for (const { code, x, s } of f.rails) {
      const { k: kp, L: Lp } = f.paint[cabAt(x)];
      const hue = (q) => (q.c[1] - q.c[2]) / Math.max(1, q.c[1]) > 0.5 * kp;
      const st = STEP(s), n3 = Math.round(3 * MM / st);
      // down from above the worktop: the rail starts at the first paint-hued pixel that stays paint
      const i0 = s.findIndex((q, i) => s.slice(i, i + n3).every(hue));
      assert.ok(i0 >= 0, `${code} x=${x}: no paint under the worktop`);
      // ...and ends where the door begins: at the door's top edge line, or failing that the first 3mm that
      // read as the door's own stile (its brightness read 45-60mm down). A rail that renders the same as
      // the door ends at once and fails; a soft worktop shadow on the rail is part of the rail.
      const band = s.slice(i0 + n3, i0 + 3 * n3).map((q) => q.L).sort((a, b) => a - b), ref = band[band.length >> 1];
      const door = s.filter((q) => q.w < TOP - 45 * MM && q.w > TOP - 60 * MM).map((q) => q.L).sort((a, b) => a - b), Ld = door[door.length >> 1];
      const i1 = s.findIndex((q, i) => i > i0 + n3 && (q.L < 0.6 * ref || s.slice(i, i + n3).every((p) => Math.abs(p.L - Ld) <= 0.04 * Ld)));
      const railMm = i1 > 0 ? (s[i0].w - s[i1].w) / MM : NaN;
      const say = s.filter((_, i) => i % Math.round(1 * MM / st) === 0 && i >= i0 - 4 && i <= (i1 > 0 ? i1 + 4 : s.length)).map((q) => q.L.toFixed(0)).join(' ');
      assert.ok(within(railMm, RAIL), `${code} x=${x}: top rail ${Number.isNaN(railMm) ? 'not found' : railMm.toFixed(1) + 'mm'} (1mm steps down from the worktop: ${say})`);
      const rail = s.slice(i0 + n3, i1), mean = rail.reduce((a, q) => a + q.L, 0) / rail.length;
      assert.ok(rail.every(hue) && mean > 0.5 * Lp, `${code} x=${x}: the rail reads as painted wood (${mean.toFixed(0)} against the plinth's ${Lp.toFixed(0)})`);
    }
  });

  test(`${tag}: the top rail is clean: no shadow striping under the worktop`, () => {
    // mean |pixel - the mean of its 9 neighbours along the row|: the old live shadow's diagonal stripes
    // scored 0.56 (run) and 0.77 (island); now 0.11 / 0.24 live, 0.16 / 0.36 photo (brushed paint)
    let sum = 0, n = 0;
    for (const L of f.railRows) for (let i = 4; i < L.length - 4; i++) { let m = 0; for (let j = -4; j <= 4; j++) m += L[i + j]; sum += Math.abs(L[i] - m / 9); n++; }
    console.log(`#   ${tag} rail stripe score ${(sum / n).toFixed(3)}`);
    assert.ok(sum / n < STRIPE, `stripe score ${(sum / n).toFixed(3)} (limit ${STRIPE})`);
  });

  test(`${tag}: the plinth shows exactly one joint per junction and no other line`, () => {
    for (const { y, s } of f.plinthRows) {
      const lines = runs(s, classify(s)).filter((q) => q.c === 'd');
      const say = lines.map((q) => `x=${q.a.toFixed(2)} ${q.mm.toFixed(1)}mm`).join(', ');
      assert.equal(lines.length, junctions.length, `plinth at ${(y / MM).toFixed(0)}mm: ${lines.length} lines for ${junctions.length} junctions (${say})`);
      lines.forEach((q, i) => assert.ok(overlaps(q, junctions[i] - 1.5 * MM, junctions[i] + 1.5 * MM) && q.mm <= JOINT_MAX, `plinth joint ${i + 1} on its junction, a fine line (${say})`));
    }
  });

  test(`${tag}: the plinth is painted down to the floor: no gap or recess under any cabinet`, () => {
    for (const { code, x, s } of f.plinthCols) {
      // 5mm off the floor up to the top of the plinth: one paint run. A set-back plinth or a gap under
      // the cabinet shows as a band of shadow (or floor) at least a few mm tall.
      const band = runs(s, classify(s, 200)).filter((q) => q.c === 'd' && q.mm > 3);
      assert.equal(band.length, 0, `${code} x=${x.toFixed(1)}: a dark band ${band.map((q) => `${(q.a / MM).toFixed(0)}-${(q.b / MM).toFixed(0)}mm`).join(', ')} off the floor`);
      const { L: Lp, k: kp } = f.paint[cabAt(x)];
      const L = s.reduce((a, q) => a + q.L, 0) / s.length, off = s.filter((q) => (q.c[1] - q.c[2]) / Math.max(1, q.c[1]) < 0.5 * kp).length;
      assert.ok(L > 0.7 * Lp && off === 0, `${code} x=${x.toFixed(1)}: the plinth reads as paint (${L.toFixed(0)} against ${Lp.toFixed(0)}, ${off} off-colour px)`);
    }
  });
}
