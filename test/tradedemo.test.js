// The typical-building demo: every code real, ids unique, tier reached.
import { DEMO_MIX, buildDemoUnits, demoUnitCount } from '../src/core/tradedemo.js';
import { tradeSummary } from '../src/core/cost.js';
import { getCab } from '../src/core/catalogue.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };

ok('three kitchen types', DEMO_MIX.length === 3);
ok('62 units in the mix', demoUnitCount() === 62);
ok('every code is a real catalogue cabinet', DEMO_MIX.every((m) => m.cabs.every(([c]) => !!getCab(c))));
ok('no appliances or unsupplied items in the demo', DEMO_MIX.every((m) => m.cabs.every(([c]) => !getCab(c).notSupplied)));

const { units, nextUnitId, nextRowId } = buildDemoUnits(7, 40);
ok('unit ids continue from the counter', units.map((u) => u.id).join(',') === '7,8,9' && nextUnitId === 10);
const rowIds = units.flatMap((u) => u.rows.map((r) => r.id));
ok('row ids unique and continue', new Set(rowIds).size === rowIds.length && rowIds[0] === 40 && nextRowId === 40 + rowIds.length);
ok('units carry the trade shape', units.every((u) => 'floorFrom' in u && 'perFloor' in u && typeof u.qty === 'number'));

const s = tradeSummary({ project: '', finish: 'Ghost', units });
ok('summary sees 62 units', s.totalUnits === 62);
ok('cabinets = 24×8 + 30×10 + 8×12', s.totalCabs === 24 * 8 + 30 * 10 + 8 * 12);
ok('lands in the 50–99 volume tier', s.tier && s.tier.min === 50);
ok('ten containers', s.containers === 10);
ok('every type prices above zero', s.lines.every((l) => l.totalSell > 0));
ok('per-unit price rises with bedrooms', s.lines[0].totalSell / 24 < s.lines[1].totalSell / 30 && s.lines[1].totalSell / 30 < s.lines[2].totalSell / 8);

console.log(`tradedemo: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
