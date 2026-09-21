// islands.test.js — the island flag follows where the cabinet stands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planIslandFlags, withIslandFlags, canFileIsland } from '../src/core/islands.js';
import { islandFaces } from '../src/core/submittal.js';
import { getCab } from '../src/core/catalogue.js';

const W = 228, D = 156, f = getCab('F10');
const room = (extra = {}) => ({ width: W, depth: D, height: 96, openings: [], ...extra });
const back = (id, x, extra = {}) => ({ id, code: 'F10', x, z: -D / 2 + f.d / 2 + 0.25, rotDeg: 0, ...extra });

test('her design: a double island with two cabinets that were never flagged', () => {
  const items = [back(1, -50), back(2, -14),
    { id: 10, code: 'F10', x: -36, z: 20, rotDeg: 0, island: true }, { id: 11, code: 'F10', x: 0, z: 20, rotDeg: 0, island: true }, { id: 12, code: 'F10', x: 36, z: 20, rotDeg: 0 },
    { id: 13, code: 'F10', x: -36, z: 20 - f.d, rotDeg: 180 }, { id: 14, code: 'F10', x: 0, z: 20 - f.d, rotDeg: 180, island: true }, { id: 15, code: 'F10', x: 36, z: 20 - f.d, rotDeg: 180, island: true }];
  const st = { room: room(), items };
  assert.deepEqual(planIslandFlags(st).sort((a, b) => a.id - b.id), [{ id: 12, island: true }, { id: 13, island: true }]);
  const fixed = withIslandFlags(st);
  assert.equal(fixed.items.filter((i) => i.island).length, 6);
  assert.equal(st.items.filter((i) => i.island).length, 4, 'the stored design itself is not touched');
  assert.deepEqual(islandFaces(fixed).map((fc) => fc.items.length), [3, 3], 'both faces now draw all three');
  assert.deepEqual(planIslandFlags(fixed), [], 'and it settles');
});

test('an island cabinet dragged onto the wall run stops being island; a wall cabinet dragged out becomes one', () => {
  assert.deepEqual(planIslandFlags({ room: room(), items: [back(1, -50), back(2, -14, { island: true })] }), [{ id: 2, island: false }]);
  assert.deepEqual(planIslandFlags({ room: room(), items: [back(1, -50), { id: 2, code: 'F10', x: 0, z: 20, rotDeg: 0 }] }), [{ id: 2, island: true }]);
});

test('a peninsula off a wall run is left as the user made it; a run in front of a boxing is still on its wall', () => {
  const pen = { id: 3, code: 'F10', x: -50 + 18 + f.d / 2, z: -D / 2 + f.d + 0.25 + 18, rotDeg: 270 };      // touches the run, stands on no wall
  assert.deepEqual(planIslandFlags({ room: room(), items: [back(1, -50), pen] }), []);
  const boxing = { id: 1, wall: 'back', pos: 0.5, w: 120, d: 10 };
  const off = (id, x) => ({ ...back(id, x), z: -D / 2 + 10 + f.d / 2 });
  assert.deepEqual(planIslandFlags({ room: room({ boxings: [boxing] }), items: [off(1, -18), off(2, 18)] }), []);
});

test('filed by hand: a locked cabinet is never changed', () => {
  const st = { room: room(), items: [back(1, -50), back(2, -14), { id: 3, code: 'F10', x: 0, z: 20, rotDeg: 0, island: true }] };
  assert.equal(canFileIsland(st, 1), false, 'a base in a wall run is never asked');
  assert.equal(canFileIsland(st, 3), true);
  assert.deepEqual(planIslandFlags({ room: room(), items: [back(1, -50), { id: 2, code: 'F10', x: 0, z: 20, rotDeg: 0, islandLock: true }] }), []);
});
