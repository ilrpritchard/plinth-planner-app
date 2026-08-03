// Spec check: pure order-validation rules for the Trade tab.
import { checkOrder, checkDesign, isSinkBase, sortFindings, LEVELS } from '../src/core/speccheck.js';
import { getCab } from '../src/core/catalogue.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };
const has = (finds, level, re) => finds.some((f) => f.level === level && re.test(f.msg));

// ---- helpers -----------------------------------------------------------------
ok('levels are error/warn/info', LEVELS.join(',') === 'error,warn,info');
ok('isSinkBase: F2 24" door yes', isSinkBase(getCab('F2')));
ok('isSinkBase: F10 36" double yes', isSinkBase(getCab('F10')));
ok('isSinkBase: F1 20" too narrow no', !isSinkBase(getCab('F1')));
ok('isSinkBase: F18 drawers no', !isSinkBase(getCab('F18')));
ok('isSinkBase: F5 half-depth no', !isSinkBase(getCab('F5')));
ok('isSinkBase: F16 corner no', !isSinkBase(getCab('F16')));

const s = sortFindings([{ level: 'info', msg: 'i' }, { level: 'error', msg: 'e' }, { level: 'warn', msg: 'w' }]);
ok('sortFindings: error → warn → info', s.map((f) => f.level).join(',') === 'error,warn,info');

// ---- a deliberately wrong order: F7 panel, lone corner pair, no sink base ----
const wrong = checkOrder([
  { code: 'F7', qty: 1 },
  { code: 'F15', qty: 2 },
], { qty: 1 });
ok('F7 → confirm a dishwasher is being supplied (warn)', has(wrong, 'warn', /confirm a dishwasher is being supplied/i));
ok('F7 qty > sink bases (warn)', has(wrong, 'warn', /dishwasher panels but only 0/i));
ok('corner needs a partner run (info)', has(wrong, 'info', /right angles/i));
ok('2× same-hand corners (warn)', has(wrong, 'warn', /left-hand corner cabinets/i));
ok('no sink-capable base (warn)', has(wrong, 'warn', /sink/i));
ok('findings sorted warns before infos', wrong.findIndex((f) => f.level === 'info') > wrong.findIndex((f) => f.level === 'warn'));

// one left + one right corner is a normal U — no same-hand warning
const uShape = checkOrder([{ code: 'F15', qty: 1 }, { code: 'F15R', qty: 1 }, { code: 'F10', qty: 1 }], { qty: 1 });
ok('L+R corners: no same-hand warning', !has(uShape, 'warn', /corner cabinets in one kitchen/i));
ok('L+R corners still get the partner-run info', has(uShape, 'info', /right angles/i));

// ---- no floor cabinets at all → no sink run ----
const wallsOnly = checkOrder([{ code: 'W2', qty: 4 }], { qty: 1 });
ok('no F-type at all → sink-run warn', has(wallsOnly, 'warn', /No floor cabinets/i));

// ---- clean order: sink base + drawers + uppers → clear ----
const clean = checkOrder([{ code: 'F2', qty: 1 }, { code: 'F18', qty: 1 }, { code: 'W2', qty: 2 }], { qty: 1 });
ok('clean order → no findings', clean.length === 0);

// ---- crown/filler suggestion on floor + tall kitchens ----
const tallNoTrim = checkOrder([{ code: 'F2', qty: 1 }, { code: 'T1', qty: 1 }], { qty: 1 });
ok('floor + tall, no trim lines → crown/filler info', has(tallNoTrim, 'info', /crown/i));
const tallWithTrim = checkOrder([{ code: 'F2', qty: 1 }, { code: 'T1', qty: 1 }, { code: 'A13', qty: 1 }], { qty: 1 });
ok('A13 crown line present → suggestion silenced', !has(tallWithTrim, 'info', /crown/i));

// ---- quantity sanity: per-unit vs project total ----
const manyUnits = { qty: 20 };
const perUnit = checkOrder([{ code: 'F2', qty: 3 }], manyUnits);
ok('ordinary per-unit qty (3 for 20 units) → no info', !has(perUnit, 'info', /per.unit/i));
const totalish = checkOrder([{ code: 'F2', qty: 40 }], manyUnits);
ok('qty 40 for 20 units → per-unit-or-total info', has(totalish, 'info', /PER UNIT/));
ok('…suggests 2 per unit when it divides evenly', has(totalish, 'info', /enter 2 per unit/));
const odd = checkOrder([{ code: 'F2', qty: 45 }], manyUnits);
ok('qty 45 for 20 units → asks per-unit or total', has(odd, 'info', /per-unit or a project total/i));
// floors×per-floor unit counts feed the same rule
const floorsUnit = { floorFrom: 1, floorTo: 10, perFloor: 2, qty: 0 };
const viaFloors = checkOrder([{ code: 'F2', qty: 20 }], floorsUnit);
ok('unit count derives from floors (20 units) → info fires', has(viaFloors, 'info', /20 units/));
const single = checkOrder([{ code: 'F2', qty: 40 }], { qty: 1 });
ok('single unit → qty sanity silent', !has(single, 'info', /PER UNIT/));

// ---- empty / unknown rows are harmless ----
ok('empty rows → no findings', checkOrder([], { qty: 5 }).length === 0);
ok('unknown codes ignored', checkOrder([{ code: 'ZZ99', qty: 3 }], { qty: 1 }).length === 0);

// ---- checkDesign ---------------------------------------------------------------
const room = {
  width: 144, depth: 120, height: 96, floor: 'oak', wall: 'chalk',
  worktop: 'marble', cornice: 'plain', openings: [], nextOpening: 1, boxings: [], nextBoxing: 1,
};
const designNoSink = {
  room, finish: 'Ghost', handle: 'knob', accessories: {}, nextId: 9, mode: 'home',
  items: [
    { id: 1, code: 'F2', x: -60, z: -47.75, rotDeg: 0 },
    { id: 2, code: 'F7', x: -36, z: -47.75, rotDeg: 0 },
    { id: 3, code: 'F10', x: -6, z: -47.75, rotDeg: 0 },
  ],
};
const dFinds = checkDesign(designNoSink);
ok('design: F7 → confirm dishwasher (warn)', has(dFinds, 'warn', /confirm a dishwasher/i));
ok('design: no sink placed → warn', has(dFinds, 'warn', /No sink in this design/i));

const designWithSink = {
  ...designNoSink,
  items: designNoSink.items.concat([{ id: 4, code: 'AP6', x: -60, z: -49.75, rotDeg: 0 }]),
};
ok('design: sink placed → no missing-sink warn', !has(checkDesign(designWithSink), 'warn', /No sink in this design/i));

// two same-hand corners in a design
const designTwoCorners = {
  ...designWithSink,
  items: designWithSink.items.concat([
    { id: 5, code: 'F15', x: 30, z: -47.75, rotDeg: 0 },
    { id: 6, code: 'F15R', x: 54, z: -47.75, rotDeg: 0 },
    { id: 7, code: 'F15', x: 6, z: -47.75, rotDeg: 0 },
  ]),
};
ok('design: 2× same-hand corners → warn', has(checkDesign(designTwoCorners), 'warn', /left-hand corner/i));

// geometric warnings from warnings.js flow through (overlap → error)
const designOverlap = {
  ...designWithSink,
  items: designWithSink.items.concat([{ id: 8, code: 'F10', x: -4, z: -47.75, rotDeg: 0 }]),
};
ok('design: warnings.js findings included (overlap error)', has(checkDesign(designOverlap), 'error', /overlap/i));

console.log(`\nspeccheck.test.js — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
