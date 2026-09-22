// stackers.test.js — the right stacker lands on every tall, wall and counter cabinet in one press.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStackers, stackerFor } from '../src/core/stackers.js';
import { getCab } from '../src/core/catalogue.js';

const W = 200, D = 160;
const room = (height) => ({ width: W, depth: D, height, openings: [] });
const back = (id, code, x) => { const c = getCab(code); return { id, code, x, z: -D / 2 + c.d / 2 + 0.25 + (c.type === 'TALL' ? 1.18 : 0), rotDeg: 0 }; };
const items = [back(1, 'T1', -80), back(2, 'T11', -50), back(3, 'W2', -10), back(4, 'W5', 20), back(5, 'C3', 60), back(6, 'F10', 60)];

test('every stacker is matched by the "fits" list, in the height the ceiling allows', () => {
  assert.equal(stackerFor('T1', 15).code, 'S1'); assert.equal(stackerFor('T11', 21).code, 'S12');
  assert.equal(stackerFor('W2', 15).code, 'S16'); assert.equal(stackerFor('C3', 21).code, 'S31');
  assert.equal(stackerFor('F10', 15), null);
  const p = planStackers({ room: room(108), items });          // 9' ceiling: 15" stackers
  assert.equal(p.ok, true); assert.equal(p.size, 15);
  assert.deepEqual(p.placements.map((q) => q.code), ['S1', 'S5', 'S16', 'S18', 'S27']);
  for (const q of p.placements) { const host = items.find((i) => i.id === q.hostId), s = getCab(q.code); assert.equal(q.x, host.x); assert.ok(Math.abs(q.z - (-D / 2 + s.d / 2 + 0.25)) < 1e-9, 'back on the wall'); }
  assert.equal(planStackers({ room: room(120), items }).size, 21);
});

test('too low a ceiling is refused; a stacked host, a corner unit and an island tall are skipped and named', () => {
  const low = planStackers({ room: room(96), items });
  assert.equal(low.ok, false); assert.equal(low.reason, 'too low'); assert.equal(low.need, 104);
  const s1 = getCab('S1'), withOne = [...items, { id: 9, code: 'S1', x: -80, z: -D / 2 + s1.d / 2 + 0.25, rotDeg: 0 }, back(10, 'W10', 90), { id: 11, code: 'T1', x: 0, z: 20, rotDeg: 0, island: true }];
  const p = planStackers({ room: room(108), items: withOne });
  assert.ok(!p.placements.some((q) => q.hostId === 1), 'T1 already has its stacker');
  assert.deepEqual(p.skipped.map((k) => [k.id, k.why]).sort((a, b) => a[0] - b[0]), [[1, 'already stacked'], [10, 'corner'], [11, 'off the wall']]);
  // one wall at a time
  assert.equal(planStackers({ room: room(108), items: [...items, { id: 12, code: 'T1', x: W / 2 - 12.25 - 1.18, z: 30, rotDeg: 270 }] }, 'left').placements.length, 1);
});
