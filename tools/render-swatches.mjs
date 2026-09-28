// render-swatches.mjs — DEV ONLY. Does every paint still read as its catalogue hex?
//
//   node tools/render-swatches.mjs                    → render-baseline/2026-09-28_swatches.png + .json
//   node tools/render-swatches.mjs render-step2       → render-step2/…
//   node tools/render-swatches.mjs render-step3 --photo       (in photo mode: its shadow + contact shading)
//   node tools/render-swatches.mjs render-step2 --sweep '[{"toneMapping":"AgX","exposure":1.1}, …]'
//
// Fifteen F2 single doors in a row on one wall, one per catalogue finish (Custom RAL left out),
// photographed straight on. For each door the tool reads the MIDDLE of its recessed centre panel
// (a 3" square, clear of the knob and the panel's shadow line), takes the median colour and scores
// it against the finish's hex with CIEDE2000: under ~1 is invisible, 2-3 is a shift a careful eye
// sees side by side, 5+ is a different colour. --sweep renders the same strip under each look
// (renderer tone mapping by name + exposure) and prints the scores only; no images are written.

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { FINISHES, getCab } from '../src/core/catalogue.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sweepAt = args.indexOf('--sweep');
const sweep = sweepAt >= 0 ? JSON.parse(args[sweepAt + 1]) : null;
const OUT = path.resolve(ROOT, (sweepAt === 0 || (args[0] || '').startsWith('--') ? null : args[0]) || 'render-baseline');
const SIZE = { width: 3600, height: 900 };
const PORT = 8096;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DATE = new Date().toLocaleDateString('en-CA');

// ---- the strip: wide enough that no side wall's shadow reaches a door ----
const paints = FINISHES.filter((f) => !f.custom);
const F2 = getCab('F2');
const room = { width: 520, depth: 144, height: 96, floor: 'oak', wall: 'white', worktop: 'marble', cornice: 'none', openings: [], nextOpening: 1, boxings: [], nextBoxing: 1 };
const x0 = -(paints.length * F2.w) / 2;
const items = paints.map((f, i) => ({ id: i + 1, code: 'F2', x: x0 + F2.w * (i + 0.5), z: -room.depth / 2 + F2.d / 2 + 0.25, rotDeg: 0, finish: f.name }));
const state = { schema: 'plinth-planner', version: 1, room, finish: paints[0].name, handle: 'knob', items, accessories: {}, customer: { name: '', email: '', zip: '', notes: '' }, nextId: items.length + 1, mode: 'home', trade: { project: '', units: [], finish: paints[0].name, nextUnitId: 1, nextRowId: 1 } };
const probes = items.map((it) => ({ name: it.finish, hex: paints.find((f) => f.name === it.finish).hex, x: it.x, y: 19, z: it.z + F2.d / 2 + 0.3 }));

const server = spawn('python3', ['dev-server.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
const bye = () => { try { server.kill(); } catch { /* gone */ } };
process.on('exit', bye);
await new Promise((r) => setTimeout(r, 900));
const browser = await puppeteer.launch({ headless: true, executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  await page.setViewport({ width: 1600, height: 400, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.PlinthPlanner && window.PlinthPlanner.scene', { timeout: 30000 });

  const shots = await page.evaluate(async (state, probes, size, looks, photo) => {
    const THREE = await import('three');
    const P = window.PlinthPlanner, S = P.scene;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const css = document.createElement('style');
    css.textContent = `#topbar, #leftPanel, #rightPanel, .panel, #wallMenu, #openingMenu, #uiDialog, #dxfGate, .toast, #photoBar
      { display: none !important; } #stage { top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; }`;
    document.head.appendChild(css);
    window.dispatchEvent(new Event('resize'));
    P.loadState(state);
    await (S.envReady || Promise.resolve());
    await new Promise((r) => setTimeout(r, 700));
    P.room.setGridVisible(false);
    if (photo) { P.photoMode.start(); await (S.photoReady || Promise.resolve()); }   // --photo: photo mode's shadow + contact shading
    await frame();

    // straight on, level, far enough back that the strip reads almost as an elevation
    const back = -state.room.depth / 2, fov = 12, dist = 470;
    const view = { key: 'swatches', name: 'Paint strip', pos: [0, 19, back + dist], target: [0, 19, back], fov };
    const read = async (url) => {
      const img = new Image(); img.src = url; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      const cam = S.persp.clone(); cam.position.set(...view.pos); cam.lookAt(...view.target); cam.fov = fov; cam.aspect = size.width / size.height; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      const px = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(cam); return [(v.x + 1) / 2 * img.width, (1 - v.y) / 2 * img.height]; };
      return probes.map((p) => {
        const [cx, cy] = px(p.x, p.y, p.z), [ex] = px(p.x + 1.5, p.y, p.z), r = Math.max(2, Math.round(ex - cx));
        const d = g.getImageData(Math.round(cx - r), Math.round(cy - r), 2 * r, 2 * r).data, ch = [[], [], []];
        for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) ch[k].push(d[i + k]);
        const med = (a) => { a.sort((m, n) => m - n); return a[a.length >> 1]; };
        return { name: p.name, hex: p.hex, rgb: ch.map(med) };
      });
    };
    const out = [];
    for (const look of looks) {
      if (look) {
        if (look.toneMapping != null) S.renderer.toneMapping = look.toneMapping === 'Neutral' ? THREE.CustomToneMapping : THREE[look.toneMapping + 'ToneMapping'];
        if (look.exposure != null) S.renderer.toneMappingExposure = look.exposure;
        if (look.key != null) S.key.intensity = look.key;
        if (look.fill != null) S.fill.intensity = look.fill;
        if (look.hemi != null) S.hemi.intensity = look.hemi;
        if (look.env != null && S._hdri) { S._hdri.scale = look.env / S._hdri.mean; S._envAz = null; S._aimEnv(S._wantAz); }
      }
      const url = S.captureViews([view], { width: size.width, height: size.height, type: 'image/png' })[0].url;
      out.push({ look, url, samples: await read(url), toneMapping: S.renderer.toneMapping, exposure: S.renderer.toneMappingExposure });
    }
    return out;
  }, state, probes, SIZE, sweep || [null], args.includes('--photo'));

  const TM = { 0: 'None', 1: 'Linear', 2: 'Reinhard', 3: 'Cineon', 4: 'ACESFilmic', 5: 'Neutral', 6: 'AgX' };
  for (const s of shots) {
    const rows = s.samples.map((m) => ({ ...m, dE: deltaE00(hexRGB(m.hex), m.rgb) }));
    const mean = rows.reduce((t, r) => t + r.dE, 0) / rows.length, worst = rows.reduce((a, b) => (b.dE > a.dE ? b : a));
    const lights = s.look ? ['env', 'key', 'fill', 'hemi'].filter((k) => s.look[k] != null).map((k) => `${k} ${s.look[k]}`).join(' ') : '';
    const label = `${TM[s.toneMapping]} @ ${(+s.exposure).toFixed(2)}${lights ? '  ' + lights : ''}`;
    if (sweep) { console.log(`${label.padEnd(48)} mean dE00 ${mean.toFixed(2)}  max ${worst.dE.toFixed(2)} (${worst.name})`); continue; }
    console.log(`${label}   mean dE00 ${mean.toFixed(2)}, max ${worst.dE.toFixed(2)} (${worst.name})`);
    for (const r of rows) console.log(`  ${r.name.padEnd(8)} ${r.hex}  rendered ${toHex(r.rgb)}  dE00 ${r.dE.toFixed(2)}${r.dE >= 3 ? '  <- noticeable' : ''}`);
    await mkdir(OUT, { recursive: true });
    await writeFile(path.join(OUT, `${DATE}_swatches.png`), Buffer.from(s.url.slice(s.url.indexOf(',') + 1), 'base64'));
    await writeFile(path.join(OUT, `${DATE}_swatches.json`), JSON.stringify({ look: label, mean: +mean.toFixed(3), rows: rows.map((r) => ({ ...r, dE: +r.dE.toFixed(3), rendered: toHex(r.rgb) })) }, null, 2) + '\n');
    console.log(`  → ${path.relative(ROOT, OUT)}/${DATE}_swatches.png`);
  }
} finally {
  await browser.close();
  bye();
}

// ---- colour maths: sRGB -> Lab (D65) -> CIEDE2000 ----
function hexRGB(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function toHex(c) { return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(); }
function lab([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function deltaE00(a, b) {
  const [L1, a1, b1] = lab(a), [L2, a2, b2] = lab(b), rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + G), ap2 = a2 * (1 + G), Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (x, y) => { if (!x && !y) return 0; const h = Math.atan2(y, x) / rad; return h < 0 ? h + 360 : h; };
  const h1 = hp(ap1, b1), h2 = hp(ap2, b2), dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = h2 - h1; if (Cp1 * Cp2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh * rad / 2), Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2;
  let hm = h1 + h2; if (Cp1 * Cp2 !== 0) { if (Math.abs(h1 - h2) > 180) hm += h1 + h2 < 360 ? 360 : -360; hm /= 2; }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTh = 30 * Math.exp(-(((hm - 275) / 25) ** 2)), RC = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * Cpm, SH = 1 + 0.015 * Cpm * T, RT = -Math.sin(2 * dTh * rad) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
