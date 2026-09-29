// ui-overlap.mjs — NO BUTTON OR PANEL EVER SITS ON TOP OF ANOTHER (her rule, 2026-09-29).
//
//   npm run test:ui                    headless Chrome, about 2 minutes (7 window sizes x 8 states)
//   node test/ui-overlap.mjs <out>     also saves a screenshot of every state it checked into <out>/
//
// Her screenshot: the "Designing Unit" bar and the View / Navigate / Output toolbar painted OVER the
// Lay out wizard. Two causes: #app was a stacking context (position: fixed), so the wizard's z 70
// only counted inside it, and bars appended to <body> sat on top of it whatever their numbers; and the
// design banner / photo bar shared z 60 with the sign-in and order modals (and a stray </div> left by
// W2W-211 had moved the toolbar and panels out of #app). This opens the planner at
// seven window sizes (desktop to phone), puts up every bar and card that can show at once, and checks:
//   · FLOATING CONTROLS: no two visible ones overlap (top bar, side panels, design banner, photo bar,
//     selection bar, view toolbar, first-run card, keep card, idea tray, result bar)
//   · MODALS: with a modal open, every point of every control that is still showing is covered by the
//     modal (elementFromPoint lands inside it), so nothing pokes through the dimmed backdrop
// Not in `npm test`: it needs Chrome. Run it after any change to index.html, styles.css or a new bar.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : null;
const FIX = JSON.parse(await readFile(path.join(ROOT, 'test/fixtures/construction-kitchens.json'), 'utf8'));
const PORT = 8099;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = process.env.UI_SIZES                              // e.g. UI_SIZES=390x844,768x1024
  ? process.env.UI_SIZES.split(',').map((s) => s.split('x').map(Number))
  : [[1920, 1080], [1500, 945], [1280, 800], [1100, 760], [900, 700], [768, 1024], [390, 844]];
const TOL = 1;                          // px of overlap forgiven (sub-pixel borders)

// every control that floats over the stage; '#x .card' = check that part (its box, not a full-screen root)
const FLOATING = ['#topbar', '#leftPanel', '#rightPanel', '#designBanner', '#photoBar', '#selbar', '#viewControls',
  '#emptyState .es-card', '#keepCard', '#ideaTray', '.wz-result'];

// states: what is put up before checking. Each returns the modal root it opened, or null.
const STATES = {
  'design + selection': async (P) => { P.tradeUI?.showBanner('1 Bed Type A'); select(P); return null; },
  'design + photo': async (P) => { P.tradeUI?.showBanner('1 Bed Type A'); P.photoMode.start(); return null; },
  'design + wizard': async (P) => { P.tradeUI?.showBanner('1 Bed Type A'); select(P); P.wizard.open(); return '#wizard'; },
  'design + sign in': async (P) => { P.tradeUI?.showBanner('1 Bed Type A'); select(P); P.cloudUI.open(); return '#cloudModal'; },
  'design + dialog': async (P) => {
    P.tradeUI?.showBanner('1 Bed Type A'); select(P);
    (await import('/src/ui/dialog.js')).uiAlert('A check.'); return '#uiDialog';
  },
  'photo + wizard': async (P) => { P.photoMode.start(); P.wizard.open(); return '#wizard'; },
  'design + cards + selection': async (P) => {           // everything that can share the top of the stage
    P.tradeUI?.showBanner('1 Bed Type A'); select(P);
    (await import('/src/ui/keepcard.js')).showKeepCard({ getLink: async () => 'https://planner.plinthmade.com/?s=abcdefg', onAccount: () => {} });
    const t = document.createElement('div'); t.id = 'ideaTray'; t.style.display = 'flex';
    t.innerHTML = '<span class="tray-label">Compare</span>' + [1, 2, 3].map((i) => `<button class="idea-thumb"><img alt=""><span>$${i}0,000</span></button>`).join('');
    document.body.appendChild(t); return null;
  },
  'draft result bar': async (P) => { P.wizard._showResultBar(); document.getElementById('wzResult')?.classList.add('show'); return null; },
};
function select(P) { const id = P.store.state.items[0]?.id; P.layer.select(id); P.ui.showSelbar(id); }

async function check(page, stateName, floating) {
  return page.evaluate(async (stateName, floating, TOL, src) => {
    const P = window.PlinthPlanner;
    const STATES = eval(`(${src.states})`); const select = eval(`(${src.select})`);   // eslint-disable-line no-eval
    const modal = await STATES[stateName](P);
    await new Promise((r) => setTimeout(r, 450));
    // the lane keeper (ui/lanes.js) must SETTLE: once laid out, nothing it moves keeps changing
    let churn = 0;
    const lane = new Set(['designBanner', 'photoBar', 'selbar', 'keepCard', 'ideaTray', 'viewControls']);
    const mo = new MutationObserver((ms) => { for (const m of ms) if (m.target === document.body || lane.has(m.target.id)) churn++; });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    await new Promise((r) => setTimeout(r, 600));
    mo.disconnect();
    const vis = (el) => {
      if (!el) return null;
      for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null; }
      const b = el.getBoundingClientRect();
      const x0 = Math.max(0, b.left), y0 = Math.max(0, b.top), x1 = Math.min(innerWidth, b.right), y1 = Math.min(innerHeight, b.bottom);
      return x1 - x0 > 2 && y1 - y0 > 2 ? { x0, y0, x1, y1 } : null;
    };
    const shown = floating.map((sel) => ({ sel, r: vis(document.querySelector(sel)) })).filter((f) => f.r);
    const problems = [];
    if (churn > 2) problems.push(`the bars never settle (${churn} restyles in 0.6 s)`);
    if (!modal) {
      for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i].r, b = shown[j].r;
        const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (w > TOL && h > TOL) problems.push(`${shown[i].sel} overlaps ${shown[j].sel} (${Math.round(w)} x ${Math.round(h)} px)`);
      }
    } else {
      const root = document.querySelector(modal);
      if (!vis(root)) problems.push(`${modal} did not open`);
      else for (const f of shown) {
        const { x0, y0, x1, y1 } = f.r;
        for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.2], [0.9, 0.2], [0.1, 0.8], [0.9, 0.8]]) {
          const x = x0 + (x1 - x0) * fx, y = y0 + (y1 - y0) * fy, top = document.elementFromPoint(x, y);
          if (top && !root.contains(top)) { problems.push(`${f.sel} shows through ${modal} at ${Math.round(x)},${Math.round(y)}`); break; }
        }
      }
    }
    return { problems, shown: shown.map((f) => f.sel) };
  }, stateName, floating, TOL, { states: `{${Object.entries(STATES).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(',')}}`, select: String(select) });
}

test('no button or panel sits on top of another', { timeout: 300000 }, async () => {
  const server = spawn('python3', ['dev-server.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME, args: ['--enable-unsafe-swiftshader'] });
  if (OUT) await mkdir(OUT, { recursive: true });
  const all = [];
  try {
    for (const [w, h] of SIZES) for (const name of Object.keys(STATES)) {
      const page = await browser.newPage();
      page.on('pageerror', (e) => all.push(`${w}x${h} ${name}: page error ${e.message}`));
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
      await page.waitForFunction('window.PlinthPlanner && window.PlinthPlanner.scene', { timeout: 30000 });
      await page.evaluate((k) => {                     // a known kitchen, nothing left open from boot
        const P = window.PlinthPlanner; P.loadState(k); P.wizard.close(); P.cloudUI.close();
        const es = document.getElementById('emptyState'); if (es) es.style.display = 'none';
        document.getElementById('uiDialog')?.classList.remove('show');
      }, FIX.run);
      const r = await check(page, name, FLOATING);
      for (const p of r.problems) all.push(`${w}x${h} ${name}: ${p}`);
      if (OUT) await page.screenshot({ path: path.join(OUT, `${w}x${h}_${name.replace(/\W+/g, '-')}.png`) });
      await page.close();
    }
  } finally { await browser.close(); server.kill(); }
  assert.deepEqual(all, [], `\n  ${all.join('\n  ')}`);
});
