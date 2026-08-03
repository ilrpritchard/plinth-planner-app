// Master-library front drawings (frontParts/drawFront/frontSVG) + the Trade
// picker's pure filter — node tests, no DOM.
import { frontParts, drawFront, frontSVG, FD, cornerReturnIn } from '../src/ui/frontdraw.js';
import { filterCabinets, orderableCabs, cabChipHTML } from '../src/ui/picker.js';
import { getCab, CATALOGUE } from '../src/core/catalogue.js';
import { computeElevation } from '../src/core/submittal.js';
import { buildElevationSVG } from '../src/ui/submittal.js';
import { mmToIn } from '../src/core/units.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

const parts = (code) => frontParts(getCab(code)).parts;
const rects = (code, cls) => parts(code).filter((p) => p.k === 'rect' && p.cls === cls);
const lines = (code, cls) => parts(code).filter((p) => p.k === 'line' && p.cls === cls);

// ---- skeleton: legs full height both sides, 35mm top rail, 115mm plinth ----
{
  const f2 = getCab('F2'); // 24×24×35 single door
  const legs = lines('F2', 'leg');
  ok('F2: two full-height legs at 22mm in', legs.length === 2 &&
    legs.every((l) => l.y1 === 0 && l.y2 === 35) &&
    near(legs[0].x1, mmToIn(22)) && near(legs[1].x1, 24 - mmToIn(22)));
  const rails = lines('F2', 'rail');
  ok('F2: top rail at h−35mm and plinth line at 115mm', rails.length === 2 &&
    rails.some((r) => near(r.y1, 35 - mmToIn(35))) && rails.some((r) => near(r.y1, mmToIn(115))));
  const panels = rects('F2', 'panel');
  ok('F2: one shaker panel inset 80mm from door edges', panels.length === 1 &&
    near(panels[0].x, mmToIn(22) + mmToIn(80)) &&
    near(panels[0].y, mmToIn(115) + mmToIn(80)) &&
    near(panels[0].y + panels[0].h, 35 - mmToIn(35) - mmToIn(80)));
}

// ---- wall unit: 45mm bottom rail, not a plinth --------------------------------
{
  const rails = lines('W2', 'rail');
  ok('W2: bottom rail at 45mm', rails.some((r) => near(r.y1, mmToIn(45))));
  ok('W2: no line at 115mm', !rails.some((r) => near(r.y1, mmToIn(115))));
}

// ---- drawer stack: 175 exact at TOP, remainder split 245:315 (315 at bottom) ---
{
  const dr = rects('F20', 'drawer').sort((a, b) => a.y - b.y); // 36" drawers, h=35
  ok('F20: three plain drawer faces', dr.length === 3 && rects('F20', 'panel').length === 0);
  const zB = mmToIn(115), zT = 35 - mmToIn(35);
  ok('F20: top face exactly 175mm, at the top', near(dr[2].h, mmToIn(175)) && near(dr[2].y + dr[2].h, zT));
  ok('F20: bottom face sits on the plinth', near(dr[0].y, zB));
  ok('F20: bottom (315-share) taller than middle (245-share)', dr[0].h > dr[1].h);
  const rem = zT - zB - mmToIn(175) - 2 * mmToIn(2);
  ok('F20: remainder split 245:315', near(dr[0].h, rem * 315 / 560) && near(dr[1].h, rem * 245 / 560));
}

// ---- glazed door: glass zone + two 18mm shelves at equal thirds ---------------
{
  const glass = rects('W3', 'glass');
  const shelves = parts('W3').filter((p) => p.k === 'shelf');
  ok('W3: one glass zone, no solid panel', glass.length === 1 && rects('W3', 'panel').length === 0);
  ok('W3: two 18mm shelves through the glass', shelves.length === 2 && shelves.every((s) => near(s.t, mmToIn(18))));
  const [g] = glass, open = (g.h - 2 * mmToIn(18)) / 3;
  ok('W3: shelves at equal thirds', shelves.some((s) => near(s.y, g.y + g.h - open)) &&
    shelves.some((s) => near(s.y, g.y + g.h - 2 * open - mmToIn(18))));
  ok('W7: double glazed = 2 glass zones + centre leaf line + 4 shelves',
    rects('W7', 'glass').length === 2 && lines('W7', 'leaf').length === 1 &&
    parts('W7').filter((p) => p.k === 'shelf').length === 4);
}

// ---- tall doors: two panels 1184 / 200 rail / 490, hung from the top -----------
{
  const p = rects('T1', 'panel').sort((a, b) => a.y - b.y);
  const zT = 86 - mmToIn(35);
  ok('T1: two tall panels', p.length === 2);
  ok('T1: upper panel 1184mm ending 80mm under the top rail',
    near(p[1].h, mmToIn(1184)) && near(p[1].y + p[1].h, zT - mmToIn(80)));
  ok('T1: 200mm mid-rail between the panels', near(p[1].y - (p[0].y + p[0].h), mmToIn(200)));
  ok('T1: lower panel 490mm', near(p[0].h, mmToIn(490)));
  ok('T7 double larder: centre leaf + 4 panels', lines('T7', 'leaf').length === 1 && rects('T7', 'panel').length === 4);
}

// ---- larder + drawers: 1100 door over 35 gap over the stack --------------------
{
  const p = rects('T6', 'panel'), dr = rects('T6', 'drawer').sort((a, b) => a.y - b.y);
  const zT = 86 - mmToIn(35);
  const doorBot = zT - 2 * mmToIn(80) - mmToIn(1100);
  ok('T6: one 1100mm door panel up top', p.length === 1 && near(p[0].h, mmToIn(1100)) && near(p[0].y, doorBot + mmToIn(80)));
  ok('T6: 3-drawer stack below a 35mm gap',
    dr.length === 3 && near(dr[2].y + dr[2].h, doorBot - mmToIn(35)) && near(dr[0].y, mmToIn(115)));
}

// ---- corner: hatched blank return on the correct side, true extent -------------
{
  const fpL = frontParts(getCab('F15')), fpR = frontParts(getCab('F15R'));
  const retL = fpL.parts.find((p) => p.k === 'rect' && p.cls === 'return');
  const retR = fpR.parts.find((p) => p.k === 'rect' && p.cls === 'return');
  ok('F15: 20" return on the LEFT, full height', retL && near(retL.x, -20) && retL.w === 20 && retL.h === 35);
  ok('F15R: 20" return on the RIGHT', retR && near(retR.x, 20) && retR.w === 20);
  ok('F15/F15R extents include the return', near(fpL.x0, -20) && near(fpL.x1, 20) && near(fpR.x0, 0) && near(fpR.x1, 40));
  ok('W9: wall corner return is 10"', cornerReturnIn(getCab('W9')) === 10 &&
    frontParts(getCab('W9')).parts.find((p) => p.cls === 'return').w === 10);
  const svg = drawFront(getCab('F15'), 0, 0, (y) => 35 - y);
  ok('corner drawFront hatches the return', (svg.match(/<line/g) || []).length > 8);
}

// ---- dishwasher F7: full-width panel, NO legs / end strips ----------------------
{
  ok('F7: no leg lines', lines('F7', 'leg').length === 0);
  const p = rects('F7', 'panel');
  ok('F7: full-width shaker panel (80mm from the cabinet edges)',
    p.length === 1 && near(p[0].x, mmToIn(80)) && near(p[0].x + p[0].w, 24 - mmToIn(80)));
  ok('F21 bin reads as a single shaker door', rects('F21', 'panel').length === 1);
}

// ---- open shelves + tray void ----------------------------------------------------
{
  ok('F23 open: two 18mm shelves, no panels', parts('F23').filter((p) => p.k === 'shelf').length === 2 &&
    rects('F23', 'panel').length === 0);
  const cTops = parts('C7').filter((p) => p.k === 'shelf').map((s) => s.y);
  ok('C7 counter shelves at 382/833.5mm below the top',
    cTops.some((y) => near(y, 50 - mmToIn(382))) && cTops.some((y) => near(y, 50 - mmToIn(833.5))));
  const txt = parts('F8').find((p) => p.k === 'text');
  ok('F8 tray: OPEN void label', rects('F8', 'void').length === 1 && txt && txt.s === 'OPEN');
}

// ---- appliances ---------------------------------------------------------
{
  ok('AP1 range is an appliance (dashed outline, no parts)', frontParts(getCab('AP1')).appliance);
  const svg = drawFront(getCab('AP1'), 0, 0, (y) => 36 - y, { code: 'AP1' });
  ok('AP1 drawFront is dashed with the code', svg.includes('stroke-dasharray') && svg.includes('>AP1<'));
  // solid-oak floating shelves (SH1–SH3) were dropped from the range 2026-07
  ok('floating shelves are gone from the catalogue', getCab('SH2') === undefined);
}

// ---- frontSVG + chip render without a DOM ------------------------------------------
{
  const s = frontSVG(getCab('F18'), 30);
  ok('frontSVG is a standalone svg', s.startsWith('<svg') && s.endsWith('</svg>') && s.includes('height="30"'));
  ok('cabChipHTML shows code + width', cabChipHTML(getCab('F10')).includes('F10') && cabChipHTML(getCab('F10')).includes('36'));
  ok('cabChipHTML empty state', cabChipHTML(null).includes('select cabinet'));
}

// ---- elevation integration: corner return widens the run ---------------------------
{
  const design = {
    room: { width: 144, depth: 120, height: 96, cornice: 'plain', openings: [] },
    items: [
      { id: 1, code: 'F15', x: -40, z: -47.75, rotDeg: 0 },  // blank-left corner
      { id: 2, code: 'F18', x: -18, z: -47.75, rotDeg: 0 },
    ],
  };
  const elev = computeElevation(design, 'back');
  const corner = elev.items.find((e) => e.code === 'F15');
  ok('elevation corner item carries its return', corner.retW === 20 && corner.retSide === 'left' &&
    near(corner.runS0, corner.s0 - 20));
  ok('worktop spans the corner return', elev.worktops.some((s) => s.s0 <= corner.s0 - 19.5));
  ok('dim chain starts at the return', near(elev.chain.lo, corner.s0 - 20));
  const svg = buildElevationSVG(elev);
  ok('elevation SVG carries shaker panels + codes', svg.includes('>F15<') && svg.includes('>F18<'));
}

// ---- picker filter -------------------------------------------------------------------
{
  const all = orderableCabs();
  ok('orderable set excludes appliances, keeps accessories',
    !all.some((c) => c.type === 'APPLIANCES') && all.some((c) => c.type === 'ACCESSORIES'));

  const w36 = filterCabinets(all, '36');
  const all36 = CATALOGUE.filter((c) => c.gbp > 0 && Math.abs(c.w - 36) < 0.3);
  ok("query '36' returns every 36-wide SKU", all36.every((c) => w36.some((h) => h.code === c.code)));
  ok("query '36' hits carry 36 in width or text", w36.every((c) =>
    Math.abs(c.w - 36) < 0.3 || c.desc.includes('36') || c.code.includes('36')));

  const dr = filterCabinets(all, 'drawer');
  ok("query 'drawer' matches every Drawers desc", ['F17', 'F18', 'F19', 'F20', 'T6', 'T8'].every((c) => dr.some((h) => h.code === c)) &&
    dr.every((c) => /drawer/i.test(c.desc)));

  const f10 = filterCabinets(all, 'F10');
  ok("query 'F10' finds exactly F10", f10.length === 1 && f10[0].code === 'F10');

  const walls = filterCabinets(all, '', 'WALL');
  ok('WALL chip returns only wall units', walls.length > 0 && walls.every((c) => c.type === 'WALL'));
  const glzWall = filterCabinets(all, 'glazed 24', 'WALL');
  ok("chips + tokens combine ('glazed 24' WALL → W4)", glzWall.length === 1 && glzWall[0].code === 'W4');
  ok('no matches → empty list, no throw', filterCabinets(all, 'zzz-nothing').length === 0);
}

console.log(`\nfrontdraw.test.js — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
