// Hinge side: ONE truth (core/hinge.js) for the 3D door, plan swing, plan KEY,
// elevation swing marks, cabinet schedule and cut sheets.
import { hingeOf, canFlipHinge, hingeLabel, hingeSummary, sharedHinge } from '../src/core/hinge.js';
import { getCab } from '../src/core/catalogue.js';
import { distinctSkus, scheduleRows } from '../src/core/submittal.js';
import { buildFloorplanSVG } from '../src/ui/floorplan.js';
import { skuGlyphSVG } from '../src/ui/submittal.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };
const cab = getCab;

// single leaves follow the placed item (default LEFT); sides are as viewed facing the front
ok('F2 defaults to left', hingeOf(cab('F2'), { code: 'F2' }) === 'L');
ok('F2 flipped reads right', hingeOf(cab('F2'), { code: 'F2', hinge: 'R' }) === 'R');
ok('glazed single follows the item', hingeOf(cab('W3'), { hinge: 'R' }) === 'R');
ok('tall single + larder follow the item', hingeOf(cab('T1'), { hinge: 'R' }) === 'R' && hingeOf(cab('T5'), {}) === 'L' && hingeOf(cab('T6'), { hinge: 'R' }) === 'R');
ok('fridge housing is handed like the 3D knob side', hingeOf(cab('T3'), { hinge: 'R' }) === 'R' && canFlipHinge(cab('T3')));
// corners hinge on the blank-return side, whatever the item says (same as the 3D)
ok('corner blank-left hinges left', hingeOf(cab('F16'), { hinge: 'R' }) === 'L');
ok('corner blank-right hinges right', hingeOf(cab('F16R'), {}) === 'R');
ok('corners cannot flip', !canFlipHinge(cab('F16')));
// pairs
ok('doubles are pairs', hingeOf(cab('F10'), {}) === 'PAIR' && hingeOf(cab('T7'), {}) === 'PAIR' && hingeOf(cab('T13'), {}) === 'PAIR');
ok('36" oven housing takes a pair, 30" a single', hingeOf(cab('T15'), {}) === 'PAIR' && hingeOf(cab('T9'), {}) === 'L');
ok('pairs cannot flip', !canFlipHinge(cab('F10')));
// nothing hinges
ok('drawers / bins / dishwasher / open / appliances do not hinge',
  ['F18', 'F21', 'F7', 'F23', 'F8', 'AP1', 'AP7'].every((c) => hingeOf(cab(c), { hinge: 'R' }) === null));
ok('labels', hingeLabel('L') === 'Left' && hingeLabel('R') === 'Right' && hingeLabel('PAIR') === 'Pair' && hingeLabel(null) === '');

// summaries over the placed items of one SKU
const its = [{ code: 'F2' }, { code: 'F2', hinge: 'R' }, { code: 'F2', hinge: 'R' }];
ok('mixed summary (cut sheet)', hingeSummary(cab('F2'), its) === '1 × left hung, 2 × right hung');
ok('mixed summary (schedule)', hingeSummary(cab('F2'), its, true) === '1 Left · 2 Right');
ok('mixed sides share no hinge', sharedHinge(cab('F2'), its) === null && sharedHinge(cab('F2'), its.slice(1)) === 'R');

// the documents carry it
const design = {
  room: { width: 144, depth: 120, height: 96, openings: [] },
  items: [
    { id: 1, code: 'F2', x: -40, z: -47.75, rotDeg: 0 },
    { id: 2, code: 'F2', x: -16, z: -47.75, rotDeg: 0, hinge: 'R' },
    { id: 3, code: 'F10', x: 14, z: -47.75, rotDeg: 0 },
    { id: 4, code: 'F18', x: 44, z: -47.75, rotDeg: 0 },
  ],
};
ok('schedule row: F2 both ways', scheduleRows(design).rows.find((r) => r.code === 'F2').hinge === '1 Left · 1 Right');
const f2 = distinctSkus(design).find((s) => s.code === 'F2');
ok('cut sheet note names the designed sides', f2.notes[0] === 'Hinge: 1 × left hung, 1 × right hung (viewed facing the front)' && f2.hinge === null);
ok('cut sheet: a pair draws both swings', (skuGlyphSVG(cab('F10'), 'PAIR').match(/stroke-dasharray="2.2 1.6"/g) || []).length === 2);
ok('cut sheet: drawers draw no swing', !skuGlyphSVG(cab('F18'), null).includes('stroke-dasharray="2.2 1.6"'));
const plan = buildFloorplanSVG(design);
ok('plan KEY has a HINGE column and splits F2 left / right', plan.includes('>HINGE<') && plan.includes('>Left<') && plan.includes('>Right<') && plan.includes('>Pair<'));

console.log(`\nhinge.test.js — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
