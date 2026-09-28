// render-capture.mjs — DEV ONLY. Photograph one fixed kitchen from the six photo-mode views, so
// every rendering change can be compared against the same frames.
//
//   node tools/render-capture.mjs                  → render-baseline/2026-09-28_1_your-view.png …
//   node tools/render-capture.mjs render-step2     → render-step2/2026-09-28_1_your-view.png …
//   node tools/render-capture.mjs render-step2 other-state.json [--closeups-only]
//   (close-ups come along when <state>.closeups.json exists: _c1_<key>.png, …)
//
// The kitchen is tools/hero-kitchen.json: the website hero (imagegen/layout.mjs wideRun, Nettle,
// oak floor, Carrara worktop, chalk walls), frozen here so the baseline cannot drift. The six views
// are exactly what photo mode steps through: 1 = the view the planner frames on load (photo mode's
// "Your view, as it is"), 2-6 = core/photoviews.js. Each is rendered by Scene.captureViews, the
// same call as photo mode's "Save all", at a fixed 2400 x 1600 PNG (lossless, for comparing).
//
// Headless Chrome (the Mac's own, in a throwaway profile) on the GPU via ANGLE/Metal, the same set-up
// as imagegen/render.mjs. Nothing here is loaded by the planner itself.

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'render-baseline');
const STATE = path.resolve(ROOT, process.argv[3] || 'tools/hero-kitchen.json');
const CLOSEUPS_ONLY = process.argv.includes('--closeups-only');
// close-ups ride along when the state has a <name>.closeups.json beside it (saved as _c1_<key>.png, …)
const closeups = await readFile(STATE.replace(/\.json$/, '.closeups.json'), 'utf8').then((t) => JSON.parse(t).views, () => []);
const SIZE = { width: 2400, height: 1600 };
const PORT = 8097;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DATE = new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD, local

const state = JSON.parse(await readFile(STATE, 'utf8'));

const server = spawn('python3', ['dev-server.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
const bye = () => { try { server.kill(); } catch { /* gone */ } };
process.on('exit', bye);
process.on('SIGINT', () => { bye(); process.exit(130); });
await new Promise((r) => setTimeout(r, 900));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  // a 3:2 window at 1x, so the framing of view 1 matches the 3:2 photos
  await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.PlinthPlanner && window.PlinthPlanner.scene', { timeout: 30000 });

  const shots = await page.evaluate(async (state, size, extra, only) => {
    const P = window.PlinthPlanner, S = P.scene;
    const { photoViews } = await import('/src/core/photoviews.js');
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    // the stage fills the window (the app chrome is hidden), so view 1 is framed for 3:2
    const css = document.createElement('style');
    css.textContent = `#topbar, #leftPanel, #rightPanel, .panel, #wallMenu, #openingMenu, #uiDialog, #dxfGate, .toast, #photoBar
      { display: none !important; } #stage { top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; }`;
    document.head.appendChild(css);
    window.dispatchEvent(new Event('resize'));
    await frame();

    P.loadState(state);                     // rebuilds every layer and frames the room
    await (S.envReady || Promise.resolve());   // the daylight HDRI, once it has loaded
    await new Promise((r) => setTimeout(r, 700));
    await frame();

    // photo mode itself (grid off, nothing selected), then its six views
    P.photoMode.start();
    await (S.photoReady || Promise.resolve());   // photo mode's shadow + contact shading
    await frame();
    const cam = S.persp, c = S.controls;
    const mine = { key: 'your-view', name: 'Your view, as it is', pos: cam.position.toArray(), target: c.target.toArray(), fov: cam.fov };
    const views = only ? [] : [mine, ...photoViews(P.store.state.room, P.store.state.items)];
    const all = [...views, ...extra.map((v) => ({ ...v, closeup: true }))];
    const out = S.captureViews(all, { width: size.width, height: size.height, type: 'image/png' });
    P.photoMode.end();
    return out.map((o, i) => ({ ...o, view: all[i] }));
  }, state, SIZE, closeups, CLOSEUPS_ONLY);

  await mkdir(OUT, { recursive: true });
  const rel = path.relative(ROOT, OUT);
  let n = 0, c = 0;
  for (const s of shots) {
    const file = s.view.closeup ? `${DATE}_c${++c}_${s.key}.png` : `${DATE}_${++n}_${s.key}.png`;
    await writeFile(path.join(OUT, file), Buffer.from(s.url.slice(s.url.indexOf(',') + 1), 'base64'));
    console.log(`  ${rel}/${file}  ${s.name}`);
  }
  // the exact cameras, so a later step can be checked against the same standpoints
  if (!CLOSEUPS_ONLY) await writeFile(path.join(OUT, `${DATE}_views.json`), JSON.stringify({ state: path.relative(ROOT, STATE), size: SIZE, views: shots.map((s) => s.view) }, null, 2) + '\n');
} finally {
  await browser.close();
  bye();
}
