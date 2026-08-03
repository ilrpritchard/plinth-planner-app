// Trade submittal pack: pure elevation layout + schedule + revision tests.
import {
  WALL_ORDER, wallsWithItems, itemsOnWall, computeElevation, scheduleRows,
  distinctSkus, drawingIndex, nextRev, bumpRev, unitRev, esc, mountY, alongWall,
} from '../src/core/submittal.js';
import { rowsFromDesign } from '../src/core/cost.js';
import { getCab, sellUSD } from '../src/core/catalogue.js';
import { buildElevationSVG, skuGlyphSVG, buildSubmittalHTML } from '../src/ui/submittal.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

// ---- a designed unit: back wall (tall + crown + fillers + range + uppers +
// window) and left wall (drawers + door) — the shapes the sheets must handle.
const design = {
  schema: 'plinth-planner', version: 1,
  room: {
    width: 144, depth: 120, height: 96,
    floor: 'oak', wall: 'chalk', worktop: 'marble', cornice: 'plain',
    openings: [
      { id: 1, type: 'window', wall: 'back', pos: 0.5, width: 48 },
      { id: 2, type: 'door', wall: 'left', pos: 0.2, width: 34 },
    ],
    nextOpening: 3, boxings: [], nextBoxing: 1,
  },
  finish: 'Hudson', handle: 'bar', accessories: {},
  items: [
    { id: 1, code: 'T1', x: -57, z: -47.75, rotDeg: 0 },   // tall, 3" gap → tall filler
    { id: 2, code: 'F18', x: -33, z: -47.75, rotDeg: 0 },  // drawers
    { id: 3, code: 'F10', x: -3, z: -47.75, rotDeg: 0 },   // double
    { id: 4, code: 'AP1', x: 30, z: -46.75, rotDeg: 0 },   // range (not supplied)
    { id: 5, code: 'F2', x: 57, z: -47.75, rotDeg: 0 },    // 3" gap → base filler
    { id: 6, code: 'W2', x: -39, z: -52.75, rotDeg: 0 },   // upper
    { id: 7, code: 'W2', x: 57, z: -52.75, rotDeg: 0 },    // upper
    { id: 8, code: 'F17', x: -59.75, z: -20, rotDeg: 90 }, // left wall
  ],
  customer: { name: '', email: '', zip: '', notes: '' }, nextId: 9, mode: 'home',
};

// ---- wall membership --------------------------------------------------------
const walls = wallsWithItems(design);
ok('walls with cabinets = back + left', walls.length === 2 && walls.includes('back') && walls.includes('left'));

// every placeable item appears on exactly one wall elevation
const placed = design.items.filter((it) => { const c = getCab(it.code); return c && c.placeable; });
let allOnce = true;
for (const it of placed) {
  let count = 0;
  for (const w of WALL_ORDER) count += itemsOnWall(design, w).filter((e) => e.it === it).length;
  if (count !== 1) { allOnce = false; console.error(`  item ${it.id} (${it.code}) appears ${count}×`); }
}
ok('every wall item appears exactly once across elevations', allOnce);

// ---- back elevation ----------------------------------------------------------
const back = computeElevation(design, 'back');
ok('back wall length = room width', back.wallLen === 144 && back.height === 96);
ok('back has 7 items', back.items.length === 7);

// x-positions match the placed items (s = x + W/2, left edge = s - w/2)
const byId = (id) => back.items.find((e) => e.it.id === id);
ok('T1 x-position (s0 = 3)', near(byId(1).s0, 3));
ok('F18 x-position (s0 = 27)', near(byId(2).s0, 27));
ok('range x-position (s0 = 87)', near(byId(4).s0, 87));
ok('upper W2 x-position (s0 = 21)', near(byId(6).s0, 21));
ok('alongWall round-trip', near(alongWall(design.room, 'back', -57, 0), 15));

// mount heights match the 3D (models/cabinet.js MOUNT)
ok('floor cabs mount at 0', byId(2).y0 === 0 && byId(1).y0 === 0);
ok('wall cabs mount at 54', byId(6).y0 === 54 && byId(6).y0 + byId(6).h === 84);
ok('mountY: counter 36.5, hood 58', mountY(getCab('C1')) === 36.5 && mountY(getCab('AP8')) === 58);

// dimension chain: continuous run 3→141, segments sum to the run, wall dim = 144
const ch = back.chain;
ok('chain lo/hi (3 → 141)', near(ch.lo, 3) && near(ch.hi, 141));
const segSum = ch.segs.reduce((t, s) => t + (s.b - s.a), 0);
ok('chain segments sum to overall run', near(segSum, ch.hi - ch.lo));
ok('chain has no gap segs (continuous run)', ch.segs.every((s) => !s.gap));

// scribe fillers: 3" tall filler at the left corner, 3" base filler at the right
ok('two fillers on the back wall', back.fillers.length === 2);
const fL = back.fillers[0], fR = back.fillers[1];
ok('left filler: 3" wide, tall height, at s0=0', near(fL.s0, 0) && near(fL.w, 3) && fL.h === 86);
ok('right filler: 3" wide, base height, ends at wall', near(fR.s0, 141) && fR.h === 35);

// crown: runs over the tall AND its tall scribe filler, and over each upper
ok('crown spans exist (cornice=plain)', back.crowns.length >= 2);
ok('crown covers the tall filler to the wall', back.crowns.some((c) => c.s0 <= 0.1 && near(c.top, 86)));
ok('crown over uppers at 84', back.crowns.some((c) => near(c.top, 84)));

// worktop: over base runs only — never over the range
ok('worktop spans = 2 (broken at the range)', back.worktops.length === 2);
ok('no worktop over the range (87–117)', back.worktops.every((s) => s.s1 <= 87.6 || s.s0 >= 116.4));
ok('worktop reaches the right filler', back.worktops.some((s) => s.s1 >= 143.5));

// window: dashed opening at the 3D sill height (max(36, H*0.42) = 40.32)
ok('back window mapped (s0=48, w=48)', back.openings.length === 1 && near(back.openings[0].s0, 48) && near(back.openings[0].w, 48));
ok('window sill matches the 3D (40.32)', near(back.openings[0].y0, 40.32));

// ---- left elevation ----------------------------------------------------------
const left = computeElevation(design, 'left');
ok('left wall length = room depth', left.wallLen === 120);
ok('left has the F17 only', left.items.length === 1 && left.items[0].code === 'F17');
ok('left door opening full-height from floor', left.openings.length === 1 && left.openings[0].y0 === 0 && left.openings[0].h > 70);

// ---- schedule rows match rowsFromDesign ---------------------------------------
const sched = scheduleRows(design);
const rows = rowsFromDesign(design.items);
ok('schedule rows = rowsFromDesign codes/qtys',
  sched.rows.length === rows.length &&
  sched.rows.every((r, i) => r.code === rows[i].code && r.qty === rows[i].qty));
ok('schedule excludes appliances', !sched.rows.some((r) => r.code === 'AP1'));
ok('W2 qty = 2 in schedule', sched.rows.find((r) => r.code === 'W2')?.qty === 2);
ok('line totals = each × qty', sched.rows.every((r) => near(r.line, sellUSD(getCab(r.code)) * r.qty, 0.01)));
ok('subtotal = sum of lines', near(sched.subtotal, sched.rows.reduce((t, r) => t + r.line, 0), 0.01));

// cut sheets: one card per distinct supplied SKU
const skus = distinctSkus(design);
ok('distinct SKUs = 6, appliances excluded', skus.length === 6 && !skus.some((s) => s.code === 'AP1'));
// index now ends with MEP rough-in sheets: the range on the back wall → A-500
ok('drawing index covers plan + 2 elevations + schedule + cuts + rough-in + compliance', drawingIndex(design).length === 1 + 1 + 2 + 1 + 2 + 1 + 1);
ok('drawing index ends with A-600 compliance sheet', drawingIndex(design).at(-1).no === 'A-600' && drawingIndex(design).at(-1).title.includes('COMPLIANCE'));
ok('drawing index includes A-500 rough-in for the back wall', drawingIndex(design).some((d) => d.no === 'A-500' && d.title.includes('ROUGH-IN') && d.title.includes('BACK')));

// ---- esc() safety --------------------------------------------------------------
const e = esc('Dishwasher Door & Plinth <x> "q" \'z\'');
ok('esc escapes & < > " \'', e.includes('&amp;') && e.includes('&lt;') && e.includes('&quot;') && e.includes('&#39;') && !/&(?!amp;|lt;|gt;|quot;|#39;)/.test(e));

// ---- revision letters -----------------------------------------------------------
ok('nextRev A→B, B→C, Z→AA', nextRev('A') === 'B' && nextRev('B') === 'C' && nextRev('Z') === 'AA');
const unit = { id: 1, beds: '1 Bed', letter: 'A', qty: 24, rows: [], design };
ok('default rev is A', unitRev(unit) === 'A');
bumpRev(unit, '7/8/2026');
ok('bump A→B with dated history', unit.rev === 'B' && unit.revHistory.length === 1 && unit.revHistory[0].date === '7/8/2026');
bumpRev(unit, '7/9/2026');
ok('bump B→C, history grows', unit.rev === 'C' && unit.revHistory.length === 2);

// ---- document builders render without a DOM ------------------------------------
const svg = buildElevationSVG(back);
ok('elevation SVG has every code label', ['T1', 'F18', 'F10', 'F2', 'W2', 'AP1'].every((c) => svg.includes(`>${c}<`)));
ok('elevation SVG escapes cleanly (no bare &)', !/&(?!amp;|lt;|gt;|quot;|#39;|middot;|times;|#\d+;)[a-zA-Z]*[\s<"]/.test(svg));
const glyph = skuGlyphSVG(getCab('F18'));
ok('SKU glyph is an svg', glyph.startsWith('<svg') && glyph.includes('</svg>'));
const html = buildSubmittalHTML({ project: 'Hudson & Co Tower', unit, date: 'July 8, 2026' });
ok('submittal HTML: letter landscape + all sheet types', html.includes('size: letter landscape')
  && html.includes('TRADE SUBMITTAL') && html.includes('FLOOR PLAN') && html.includes('ELEVATION — BACK WALL')
  && html.includes('ELEVATION — LEFT WALL') && html.includes('CABINET SCHEDULE') && html.includes('CUT SHEETS'));
ok('submittal HTML escapes the project name', html.includes('Hudson &amp; Co Tower') && !html.includes('Hudson & Co Tower'));
ok('rev letter + disclaimer on the sheets', html.includes('Rev C') && html.includes('does not survey or verify site dimensions'));

console.log(`\nsubmittal.test.js — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
