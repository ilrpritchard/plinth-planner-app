// islandcentre.test.js — the whole island moves sideways to the middle of the floor, or onto the range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planIslandCentre } from '../src/core/islandcentre.js';
import { getCab } from '../src/core/catalogue.js';

const W = 200, D = 160;
const room = { width: W, depth: D, height: 96, openings: [] };
const back = (code, x, id) => { const c = getCab(code); return { id, code, x, z: -D / 2 + c.d / 2 + 0.25, rotDeg: 0 }; };
// a double sided island, 72" long, standing 10" left of the middle, with a prep sink in it
const island = (cx) => { const d = getCab('F10').d; return [
  { id: 1, code: 'F10', x: cx - 18, z: 20, rotDeg: 0, island: true }, { id: 2, code: 'F10', x: cx + 18, z: 20, rotDeg: 0, island: true },
  { id: 3, code: 'F10', x: cx - 18, z: 20 - d, rotDeg: 180, island: true }, { id: 4, code: 'F10', x: cx + 18, z: 20 - d, rotDeg: 180, island: true },
  { id: 5, code: 'AP10', x: cx + 18, z: 20, rotDeg: 0 }]; };

test('centre in the room: both rows and the sink move together, sideways only', () => {
  const items = island(-10);
  const p = planIslandCentre({ room, items }, 3, 'room');
  assert.equal(p.ok, true, p.reason);
  assert.ok(Math.abs(p.dx - 10) < 1e-9);
  assert.deepEqual(p.moves.map((m) => m.id).sort(), [1, 2, 3, 4, 5]);
  for (const m of p.moves) { const it = items.find((i) => i.id === m.id); assert.ok(Math.abs(m.x - it.x - 10) < 1e-9 && m.z === it.z); }
  assert.equal(planIslandCentre({ room, items: island(0) }, 1, 'room').reason, 'already');
});

test('a run on a side wall beside the island narrows the floor it is centred in', () => {
  const f = getCab('F10'), side = { id: 9, code: 'F10', x: -W / 2 + f.d / 2 + 0.25, z: 10, rotDeg: 90 };
  const p = planIslandCentre({ room, items: [...island(0), side] }, 1, 'room');
  assert.equal(p.ok, true, p.reason);
  assert.ok(Math.abs(p.dx - (f.d + 0.25) / 2) < 0.01, 'half the depth of the side run');
  // ...but a fridge in the back corner, nowhere near the island, does not
  const far = { ...side, z: -D / 2 + 19 };
  assert.equal(planIslandCentre({ room, items: [...island(0), far] }, 1, 'room').reason, 'already');
});

test('centre on the range; refused when there is none, when something is in the way, or off an island', () => {
  const range = back('AP2', 30, 20);
  const p = planIslandCentre({ room, items: [...island(-10), range] }, 2, 'range');
  assert.ok(p.ok && Math.abs(p.dx - 40) < 1e-9);
  assert.equal(planIslandCentre({ room, items: island(-10) }, 2, 'range').reason, 'no range');
  const post = { id: 30, code: 'T10', x: 40, z: 20, rotDeg: 0, island: false };                 // a tall standing right where it would go
  assert.equal(planIslandCentre({ room, items: [...island(-40), post] }, 1, 'room').reason, 'blocked');
  assert.equal(planIslandCentre({ room, items: [range] }, 20, 'room').reason, 'not island');
});

test('Space from the counters: 1000mm off the back run, centred between two side runs; one side run -> 1000mm from it; too tight says so', async () => {
  const { planIslandSpacing } = await import('../src/core/islandcentre.js');
  const mm = 1000 / 25.4;
  // a U: back run 24" deep, side runs on both walls, a 72" island somewhere in the middle
  const U = { room: { width: 220, depth: 200, height: 96 }, items: [
    { id: 1, code: 'F10', x: -20, z: -100 + 12.25, rotDeg: 0 }, { id: 2, code: 'F10', x: 16, z: -100 + 12.25, rotDeg: 0 },
    { id: 3, code: 'F10', x: -110 + 12.25, z: -40, rotDeg: 90 }, { id: 4, code: 'F10', x: 110 - 12.25, z: -40, rotDeg: 270 },
    { id: 5, code: 'F20', x: -18 + 5, z: 10, rotDeg: 180, island: true }, { id: 6, code: 'F20', x: 18 + 5, z: 10, rotDeg: 180, island: true } ] };
  const p = planIslandSpacing(U, 5, mm);
  assert.ok(p.ok, p.reason);
  const z0 = Math.min(...p.moves.filter((m) => m.id >= 5).map((m) => m.z)) - 12;          // island back edge after the move
  assert.ok(Math.abs(z0 - (-100 + 24.25 + mm)) < 0.05, `1000mm off the back run (${z0.toFixed(2)})`);
  const cx = p.moves.filter((m) => m.id >= 5).reduce((t, m) => t + m.x, 0) / 2;
  assert.ok(Math.abs(cx) < 0.05, `centred between the side runs (${cx.toFixed(2)})`);
  assert.ok(Math.abs(p.clear.back - mm) < 0.01 && Math.abs(p.clear.left - p.clear.right) < 0.05 && p.clear.left > mm, 'reports the clearances');
  // one side run only: 1000mm from it
  const L = { ...U, items: U.items.filter((i) => i.id !== 4) };
  const q = planIslandSpacing(L, 5, mm);
  assert.ok(q.ok && Math.abs(q.clear.left - mm) < 0.01 && q.clear.right === null, 'one side run: 1000mm from it');
  // too tight: a narrow U cannot give 1000mm both sides
  const T = { ...U, room: { width: 160, depth: 200, height: 96 }, items: U.items.map((i) => i.id === 3 ? { ...i, x: -80 + 12.25 } : i.id === 4 ? { ...i, x: 80 - 12.25 } : i) };
  const t = planIslandSpacing(T, 5, mm);
  assert.equal(t.ok, false); assert.equal(t.reason, 'too tight');
  assert.equal(planIslandSpacing(U, 1, mm).reason, 'not island');
});
