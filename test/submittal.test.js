// Trade submittal pack: pure elevation layout + schedule + revision tests.
import {
  WALL_ORDER, wallsWithItems, itemsOnWall, computeElevation, scheduleRows,
  distinctSkus, drawingIndex, nextRev, bumpRev, unitRev, esc, mountY, alongWall,
  islandFaces, islandSheets, computeIslandElevation, cutSheetPages, cutCardMM,
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
ok('wall cabs mount at 56, tops level with the talls at 86', byId(6).y0 === 56 && byId(6).y0 + byId(6).h === 86 && byId(1).h === 86);
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
ok('crown over uppers at 86, the same line as the talls', back.crowns.every((c) => near(c.top, 86)));

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
// MEP rough-in is NOT PL/NTH's responsibility: no A-5xx sheets, ever (her markup 2026-09-18)
ok('drawing index covers plan + 2 elevations + schedule + cuts (6 SKUs = ONE sheet) + compliance', drawingIndex(design).length === 1 + 1 + 2 + 1 + 1 + 1);
ok('drawing index ends with A-600 compliance sheet', drawingIndex(design).at(-1).no === 'A-600' && drawingIndex(design).at(-1).title.includes('COMPLIANCE'));
ok('drawing index carries NO rough-in sheets', !drawingIndex(design).some((d) => /^A-5/.test(d.no) || /ROUGH/i.test(d.title)));

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
  && html.includes('>SUBMITTAL<') && html.includes('FLOOR PLAN') && html.includes('ELEVATION: BACK WALL')
  && html.includes('ELEVATION: LEFT WALL') && html.includes('CABINET SCHEDULE') && html.includes('CUT SHEETS')
  && html.includes('COMPLIANCE &amp; PRODUCT DATA'));
ok('submittal HTML escapes the project name', html.includes('Hudson &amp; Co Tower') && !html.includes('Hudson & Co Tower'));
ok('rev letter + disclaimer on the sheets', html.includes('Rev C') && html.includes('does not survey or verify site dimensions'));


// ---- her 2026-09-18 markup, locked ------------------------------------------------
ok('no MEP rough-in sheets in the pack', !/ROUGH-IN/i.test(html) && !html.includes('A-500'));
ok('no drawing index on the cover', !html.includes('DRAWING INDEX'));
ok('says cabinets, never casework', !/casework/i.test(html) && html.includes('CABINET VENDOR') && html.includes('06 41 00'));
ok('no placeholder project name, no "trade" in the title block', !html.includes('PL/NTH trade project') && !html.includes('TRADE SUBMITTAL'));
ok('no "Made with PL/NNER" stamp', !html.includes('Made with'));
ok('disclaimer names the Buyer, not "the client"', html.includes('as entered by the Buyer') && !/the client/i.test(html));
ok('cover carries a big COLOR tile, never the internal hex as text', html.includes('class="color-tile"') && html.includes('<small>COLOR</small>Hudson') && !/#[0-9a-f]{6}\s*<\/td>/i.test(html));
ok('worktop is "By others", material never named', html.includes('<td>By others</td>') && !html.includes('<td>Marble</td>'));
ok('plinth is not site-scribed, and the finish schedule carries no plinth row', !html.includes('site-scribed') && !html.includes('<th>Plinth</th><td>115mm'));
ok('hinge is the designed side, never "site-selectable"', !html.includes('site-selectable') && html.includes('<th>Hinge</th><td>Left hung</td>'));
ok('schedule carries a HINGE column', html.includes('<th>HINGE</th>') && sched.rows.find((r) => r.code === 'T1').hinge === 'Left'
  && sched.rows.find((r) => r.code === 'F10').hinge === 'Pair' && sched.rows.find((r) => r.code === 'F18').hinge === '');
const anon = buildSubmittalHTML({ unit, trade: { address: '12 Rockledge Rd' }, date: 'July 8, 2026' });
ok('unnamed project: the address heads the cover', anon.includes('<h1>12 Rockledge Rd</h1>'));
ok('elevation draws hinge swing marks + grey appliances', svg.includes('stroke-dasharray="2.2 1.6"') && svg.includes('#ebebeb'));


// ---- cut sheets: six to a sheet, never past the sheet's height -------------------
ok('6 base/wall SKUs share one cut sheet', cutSheetPages(skus).length === 1 && cutSheetPages(skus)[0].length === 6);
{
  const mk = (codes) => distinctSkus({ room: design.room, items: codes.map((code, i) => ({ id: i + 1, code, x: i * 40, z: 0, rotDeg: 0 })) });
  const talls = cutSheetPages(mk(['T1', 'T5', 'T6', 'T10', 'T11', 'T12']));
  ok('two rows of talls never share a sheet (the sheet clips, it cannot grow)', talls.length === 2 && talls.every((pg) => pg.length === 3));
  const mixed = cutSheetPages(mk(['F2', 'F10', 'F18', 'T1', 'T3', 'T5']));
  ok('a row of bases + a row of talls fit one sheet', mixed.length === 1);
  const every = cutSheetPages(mk(['F1', 'F2', 'F3', 'F7', 'F10', 'F16', 'F18', 'F21', 'W1', 'W2', 'W5', 'C1', 'T1', 'T3', 'T6', 'T9', 'T10', 'T13']));
  ok('every page holds <= 6 cards in rows that fit 150mm', every.every((pg) => {
    const rows = [pg.slice(0, 3), pg.slice(3, 6)].filter((r) => r.length);
    return pg.length <= 6 && rows.reduce((t, r) => t + Math.max(...r.map(cutCardMM)), 0) + (rows.length - 1) * 6 <= 150;
  }));
  ok('no SKU is lost or repeated by pagination', every.flat().length === 18 && new Set(every.flat().map((x) => x.code)).size === 18);
  ok('empty design still gets one (empty) cut sheet', cutSheetPages([]).length === 1);
}

// ---- island elevations ---------------------------------------------------------------
{
  const isl = {
    ...design,
    items: design.items.concat([
      { id: 20, code: 'F20', x: -36, z: 12, rotDeg: 0, island: true },
      { id: 21, code: 'F10', x: 0, z: 12, rotDeg: 0, island: true, },
      { id: 22, code: 'F2', x: 30, z: 12, rotDeg: 0, island: true, hinge: 'R' },
      { id: 23, code: 'F20', x: 24, z: -12, rotDeg: 180, island: true },
      { id: 24, code: 'F20', x: -12, z: -12, rotDeg: 180, island: true },
      { id: 25, code: 'AP6', x: 0, z: 12, rotDeg: 0 },                       // a sink riding in the island's F10 (no island flag)
    ]),
  };
  const faces = islandFaces(isl);
  ok('a double-sided island has two faces', faces.length === 2 && faces[0].toward === 'FRONT WALL' && faces[1].toward === 'BACK WALL');
  ok('the rider sink joins its base\'s face', faces[0].items.some((it) => it.code === 'AP6') && !faces[1].items.some((it) => it.code === 'AP6'));
  ok('island items stay OFF the wall elevations', WALL_ORDER.every((w) => !itemsOnWall(isl, w).some((e) => e.it.island || e.it.id === 25)));
  const f0 = computeIslandElevation(isl, faces[0]);
  ok('face runs left to right from 0, as viewed facing the fronts', near(f0.items.find((e) => e.it.id === 20).s0, 0) && near(f0.wallLen, 96)
    && f0.items.filter((e) => e.type === 'FLOOR').map((e) => e.code).join() === 'F20,F10,F2');
  const f1 = computeIslandElevation(isl, faces[1]);
  ok('the back face is mirrored (viewer stands on the other side)', f1.items[0].it.id === 23 && near(f1.wallLen, 72));
  ok('island face: one worktop, a 3-bay chain, no wall / openings / crown', f0.island && f0.worktops.length === 1 && f0.chain.segs.length === 3
    && !f0.openings.length && !f0.crowns.length);
  ok('both faces share ONE island sheet, numbered after the walls', islandSheets(isl).length === 1
    && drawingIndex(isl).some((d) => d.no === 'A-203' && d.title === 'ELEVATION — ISLAND'));
  const islHtml = buildSubmittalHTML({ project: 'P', unit: { ...unit, design: isl }, date: 'July 8, 2026' });
  ok('submittal carries the island sheet with both sides + the F2 swing', islHtml.includes('ELEVATION: ISLAND<') && islHtml.includes('SIDE FACING FRONT WALL')
    && islHtml.includes('SIDE FACING BACK WALL'));
  ok('no island → no island sheet', !html.includes('ELEVATION: ISLAND') && islandFaces(design).length === 0);
}

// ---- plan sheet: big drawing, KEY beside it in HTML -------------------------------------
ok('plan sheet: KEY is an HTML table beside a key-less, tight-margin drawing', html.includes('class="plan-key"') && html.includes('<table class="cab key">')
  && !html.slice(html.indexOf('plan-fig'), html.indexOf('</svg>', html.indexOf('plan-fig'))).includes('>KEY<'));


// ---- her second markup (2026-09-18), locked ------------------------------------------
ok('a TITLE PAGE fronts the document: PL/NTH cabinets for <project>, then the address', anon.indexOf('class="sheet title"') > -1
  && anon.indexOf('class="sheet title"') < anon.indexOf('PROJECT DIRECTORY') && anon.includes('PL/NTH CABINETS FOR') && anon.includes('<h1>12 Rockledge Rd</h1>'));
{
  const named = buildSubmittalHTML({ unit, trade: { project: 'Rockledge', address: '12 Rockledge Rd' }, date: 'July 8, 2026' });
  ok('named project: name is the headline, address beneath', named.includes('<h1>Rockledge</h1>') && named.includes('class="tp-addr">12 Rockledge Rd<'));
}
ok('notes are a ruled NOTES block, never a loose paragraph', html.includes('class="notes"') && !html.includes('class="fig-note">Interior'));
ok('worktop STOPS DEAD at the range and the wall, 1" lip only on an open end', back.worktops.every((wt) => wt.overL === 0 || wt.overL === 1)
  && back.worktops.find((wt) => near(wt.s1, 87)).overR === 0 && back.worktops.find((wt) => near(wt.s1, 144)).overR === 0);
{
  const tallRun = computeElevation({ ...design, items: [{ id: 1, code: 'F18', x: -40, z: -47.75, rotDeg: 0 }, { id: 2, code: 'T1', x: -16, z: -46.57, rotDeg: 0 }] }, 'back');
  ok('worktop dies into a butting tall (no overhang past its face), open end keeps the lip', near(tallRun.worktops[0].s1, -16 - 12 + 72) && tallRun.worktops[0].overR === 0 && tallRun.worktops[0].overL === 1);
}
ok('crown is drawn as built: a slim 22mm bar, not a 1½" band', svg.includes(`height="${Math.round((22 / 25.4) * 100) / 100}"`) && !svg.includes('height="1.5" fill="#fff"'));
{
  const dwBin = buildElevationSVG(computeElevation({ ...design, items: [{ id: 1, code: 'F2', x: -40, z: -47.75, rotDeg: 0 }, { id: 2, code: 'F7', x: -16, z: -47.75, rotDeg: 0 }, { id: 3, code: 'F21', x: 6, z: -47.75, rotDeg: 0 }, { id: 4, code: 'F18', x: 28, z: -47.75, rotDeg: 0 }] }, 'back'));
  ok('dishwasher door shows a drop-down V; a pull-out is lettered, never crossed', (dwBin.match(/stroke-dasharray="2.2 1.6"/g) || []).length === 2
    && dwBin.includes('>PULL<') && dwBin.includes('>OUT<'));
}
{
  const withInserts = scheduleRows({ ...design, accessories: { A4: 2 } });
  const a4 = withInserts.rows.find((r) => r.code === 'A4');
  ok('drawer inserts chosen in 3D are scheduled and priced', a4 && a4.qty === 2 && a4.accessory && near(withInserts.subtotal - sched.subtotal, a4.each * 2, 0.01));
  ok('no inserts → schedule unchanged', !sched.rows.some((r) => r.accessory));
}
{
  const sinkDesign = { ...design, items: design.items.concat([{ id: 30, code: 'AP7', x: -3, z: -47.75, rotDeg: 0 }]) };
  const sh = buildSubmittalHTML({ project: 'P', unit: { ...unit, design: sinkDesign }, date: 'July 8, 2026' });
  ok('wherever there is a sink: the base it needs + what its base takes', sh.includes('needs a 33&quot; base or wider') && sh.includes('F10 is a sink base') && sh.includes('cut-out up to 34&quot; wide'));
}
ok('spec sheet: inches first with mm in brackets, headed PRODUCT SPECIFICATION', html.includes('PRODUCT SPECIFICATION') && html.includes('4&#189;" (115mm)')
  && html.includes('&#8542;" (22mm)') && !html.includes('80mm stiles'));
ok('cut cards are a label / value grid', html.includes('<table class="cut-spec">') && html.includes('<th>Size</th>') && !html.includes('cut-notes'));

console.log(`\nsubmittal.test.js — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
