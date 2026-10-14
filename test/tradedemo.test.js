// The example building (The Morgan): every code real, ids unique, every type laid out in 3D,
// the floors give the unit count, and the totals are the ones the project bar showed when
// Imogen built it (2026-10-14: 47 units, 567 cabinets, 10 containers, 25–49 tier).
import { DEMO_MIX, DEMO_PROJECT, DEMO_ADDRESS, buildDemoUnits, demoUnitCount } from '../src/core/tradedemo.js';
import { DEMO_DESIGNS } from '../src/core/tradedemo-building.js';
import { tradeSummary, unitQty } from '../src/core/cost.js';
import { getCab } from '../src/core/catalogue.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };

ok('the building has a name and a neighbourhood', DEMO_PROJECT === 'The Morgan' && /New York/.test(DEMO_ADDRESS));
ok('three kitchen types', DEMO_MIX.length === 3);
ok('47 units in the mix', demoUnitCount() === 47);
ok('types are A, B, C for 1, 2, 3 bed', DEMO_MIX.map((m) => m.letter + m.beds[0]).join() === 'A1,B2,C3');
ok('every code is a real catalogue cabinet', DEMO_MIX.every((m) => m.cabs.every(([c]) => !!getCab(c))));
ok('no appliances or unsupplied items in the demo', DEMO_MIX.every((m) => m.cabs.every(([c]) => !getCab(c).notSupplied)));

const { units, nextUnitId, nextRowId } = buildDemoUnits(7, 40);
ok('unit ids continue from the counter', units.map((u) => u.id).join(',') === '7,8,9' && nextUnitId === 10);
const rowIds = units.flatMap((u) => u.rows.map((r) => r.id));
ok('row ids unique and continue', new Set(rowIds).size === rowIds.length && rowIds[0] === 40 && nextRowId === 40 + rowIds.length);
ok('units carry the trade shape', units.every((u) => 'floorFrom' in u && 'perFloor' in u && typeof u.qty === 'number'));
ok('floors are filled in and agree with qty', units.every((u) => u.floorFrom !== '' && u.floorTo !== '' && u.perFloor !== '' && unitQty(u) === u.qty));
ok('floor bands 2–12, 2–6, 7–11', units.map((u) => `${u.floorFrom}-${u.floorTo}`).join() === '2-12,2-6,7-11');

// every type carries its 3D layout, and a fresh copy each time
ok('every type is laid out in 3D', units.every((u) => u.design && u.design.schema === 'plinth-planner' && u.design.items.length > 0));
ok('the design rows match the stored layout', units.every((u) => {
  const want = {};
  for (const it of u.design.items) { const cab = getCab(it.code); if (!cab || cab.notSupplied) continue; want[it.code] = (want[it.code] || 0) + 1; }
  return u.rows.every((r) => want[r.code] === r.qty) && Object.keys(want).length === u.rows.length;
}));
ok('designs are copies, not the shared object', buildDemoUnits().units[0].design !== DEMO_DESIGNS['1 Bed'] && buildDemoUnits().units[0].design !== units[0].design);
ok('every design item is a real catalogue code', Object.values(DEMO_DESIGNS).every((d) => d.items.every((it) => !!getCab(it.code))));
ok('rooms are sized for a 1, 2, 3 bed (wider each step)', DEMO_DESIGNS['1 Bed'].room.width < DEMO_DESIGNS['2 Bed'].room.width && DEMO_DESIGNS['2 Bed'].room.width < DEMO_DESIGNS['3 Bed'].room.width);

const s = tradeSummary({ project: '', finish: 'Ghost', units });
ok('summary sees 47 units', s.totalUnits === 47);
ok('cabinets = 22×11 + 15×11 + 10×16 = 567', s.totalCabs === 567 && s.totalCabs === 22 * 11 + 15 * 11 + 10 * 16);
ok('lands in the 25–49 volume tier', s.tier && s.tier.min === 25);
ok('ten containers', s.containers === 10);
ok('every type prices above zero', s.lines.every((l) => l.totalSell > 0));
ok('per-unit price rises with bedrooms', s.lines[0].totalSell / 22 <= s.lines[1].totalSell / 15 && s.lines[1].totalSell / 15 < s.lines[2].totalSell / 10);

console.log(`tradedemo: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
