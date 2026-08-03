// MEP rough-in sheet (A-500): pure point maths + sheet wiring.
import {
  roughInPoints, roughInPointsOnWall, roughInWalls, drawingIndex, ROUGHIN_HEIGHTS,
} from '../src/core/submittal.js';
import { buildRoughInSVG, buildSubmittalHTML } from '../src/ui/submittal.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

// a full working wall: sink over base, DW panel, range + hood, fridge, T9 oven
// housing — everything the trades need points for. Back wall of a 168×120 room.
const room = {
  width: 168, depth: 120, height: 96, floor: 'oak', wall: 'chalk',
  worktop: 'marble', cornice: 'plain', openings: [], nextOpening: 1, boxings: [], nextBoxing: 1,
};
const design = {
  schema: 'plinth-planner', version: 1, room,
  finish: 'Hudson', handle: 'bar', accessories: {}, nextId: 20, mode: 'home',
  items: [
    { id: 1, code: 'F10', x: -66, z: -47.75, rotDeg: 0 },   // sink base 36" (s0=0)
    { id: 2, code: 'AP6', x: -66, z: -49.75, rotDeg: 0 },   // sink centered on it (s=18)
    { id: 3, code: 'F7', x: -36, z: -47.75, rotDeg: 0 },    // DW panel (s=48)
    { id: 4, code: 'AP1', x: -9, z: -46.75, rotDeg: 0 },    // range 30" (s=75)
    { id: 5, code: 'AP8', x: -9, z: -49.75, rotDeg: 0 },    // hood over the range
    { id: 6, code: 'T9', x: 21, z: -47.75, rotDeg: 0 },     // wall-oven housing (s=105)
    { id: 7, code: 'AP9', x: 54, z: -45.75, rotDeg: 0 },    // fridge 36" (s=138)
  ],
  customer: { name: '', email: '', zip: '', notes: '' },
};

// ---- points -------------------------------------------------------------------
const pts = roughInPointsOnWall(design, 'back');
ok('six rough-in points on the back wall', pts.length === 6);
ok('points sorted left→right', pts.every((p, i) => i === 0 || p.x >= pts[i - 1].x));

const byKind = (k) => pts.find((p) => p.kind === k);
ok('sink point centered on the sink item (x=18)', near(byKind('sink').x, 18));
ok('sink height 20" AFF (waste + hot/cold)', byKind('sink').height === ROUGHIN_HEIGHTS.sink && byKind('sink').label.includes('hot/cold'));
ok('DW outlet at the F7 center (x=48), 18" AFF', near(byKind('dishwasher').x, 48) && byKind('dishwasher').height === 18);
ok('range point centered (x=75), 4" AFF', near(byKind('range').x, 75) && byKind('range').height === 4);
ok('T9 present → wall-oven point at 48" AFF (x=105)', near(byKind('wallOven').x, 105) && byKind('wallOven').height === 48);
ok('hood duct centered over the range, at ceiling', near(byKind('hood').x, 75) && byKind('hood').height === 96 && /duct above/i.test(byKind('hood').label));
ok('fridge receptacle behind the fridge (x=138), 36" AFF', near(byKind('fridge').x, 138) && byKind('fridge').height === 36);

// chain positions match the item positions: sink base F10 spans 0–36 so the
// sink centerline is 18 from the LEFT wall corner; range AP1 spans 60–90 → 75.
ok('x measured from the LEFT wall corner', pts[0].x >= 0 && pts.every((p) => p.x <= 168));

// ---- walls + aggregate ----------------------------------------------------------
ok('roughInWalls = [back]', roughInWalls(design).join(',') === 'back');
ok('roughInPoints aggregates the wall points', roughInPoints(design).length === 6);

// no range → no range point (and no hood point without a hood)
const noRange = { ...design, items: design.items.filter((it) => it.code !== 'AP1' && it.code !== 'AP8') };
const pts2 = roughInPointsOnWall(noRange, 'back');
ok('no range → no range point', !pts2.some((p) => p.kind === 'range'));
ok('no hood → no duct point', !pts2.some((p) => p.kind === 'hood'));
ok('other points survive', pts2.length === 4);

// no T9 → no wall-oven point
const noT9 = { ...design, items: design.items.filter((it) => it.code !== 'T9') };
ok('no T9 → no wall-oven point', !roughInPointsOnWall(noT9, 'back').some((p) => p.kind === 'wallOven'));

// an empty design has no rough-in walls at all
ok('empty design → no rough-in sheets', roughInWalls({ room, items: [] }).length === 0);

// ---- drawing index + sheets ------------------------------------------------------
const idx = drawingIndex(design);
ok('index ends with A-500 MEP ROUGH-IN', idx.some((d) => d.no === 'A-500' && /ROUGH-IN/.test(d.title)));
ok('index numbering runs A-000 → A-600', idx[0].no === 'A-000' && idx[idx.length - 2].no === 'A-500' && idx[idx.length - 1].no === 'A-600');

const svg = buildRoughInSVG(design, 'back', pts);
ok('rough-in SVG renders', svg.startsWith('<svg') && svg.includes('</svg>'));
ok('SVG carries the point labels + heights', svg.includes('SINK') && svg.includes('DW outlet') && svg.includes('AFF') && svg.includes('AT CEILING'));

const unit = { id: 1, beds: '2 Bed', letter: 'A', qty: 12, rows: [], design };
const html = buildSubmittalHTML({ project: 'Rough-In Tower', unit, date: 'July 8, 2026' });
ok('submittal pack includes the A-500 sheet', html.includes('MEP ROUGH-IN — BACK WALL') && html.includes('A-500'));
ok('rough-in sheet carries the local-code note', /verify locations, clearances and requirements .* local code/.test(html));
ok('point schedule table on the sheet', html.includes('FROM LEFT CORNER'));

console.log(`\nroughin.test.js — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
