// islandmirror.test.js — one-press double-sided islands, and uppers matched about a point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planIslandBack } from '../src/core/islandback.js';
import { planMirror, mirrorTargets } from '../src/core/mirror.js';
import { spotOk } from '../src/core/placement.js';
import { getCab } from '../src/core/catalogue.js';

const W = 230, D = 180, bounds = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
const room = (openings = []) => ({ width: W, depth: D, height: 96, openings });
const islandRow = (codes, z = 10, rot = 0) => { let x = -50, id = 1; return codes.map((code) => { const c = getCab(code); x += c.w; return { id: id++, code, x: x - c.w / 2, z, rotDeg: rot, island: true }; }); };

test('her island (36 + 36 + 24): a storage row stands behind it, same length, backs touching, facing away', () => {
  const items = islandRow(['F20', 'F10', 'F2']);
  const p = planIslandBack({ room: room(), items }, 2);
  assert.equal(p.ok, true, p.reason);
  assert.deepEqual(p.row, [1, 2, 3]);
  assert.deepEqual(p.placements.map((q) => q.code), ['F10', 'F10', 'F2']);
  for (const [i, q] of p.placements.entries()) {
    assert.equal(q.rotDeg, 180); assert.equal(q.island, true);
    assert.ok(Math.abs(q.x - items[i].x) < 1e-9, 'joints line up through the island');
    assert.ok(Math.abs(q.z - (10 - 24)) < 1e-9, 'back to back');
  }
  // pressing it twice does nothing the second time
  const again = planIslandBack({ room: room(), items: [...items, ...p.placements.map((q, i) => ({ id: 50 + i, ...q }))] }, 2);
  assert.equal(again.reason, 'already double');
});

test('an island with a 48" range gets two 24s behind it; a wall cabinet is not an island; no room is refused', () => {
  const items = islandRow(['F2', 'AP3', 'F2']);
  const p = planIslandBack({ room: room(), items }, 1);
  assert.equal(p.ok, true, p.reason);
  assert.deepEqual(p.placements.map((q) => q.code), ['F2', 'F2', 'F2', 'F2']);
  let st = { room: room(), items: [...items] };
  p.placements.forEach((q, i) => { assert.ok(spotOk(st, getCab(q.code), q.x, q.z, q.rotDeg, bounds)); st = { ...st, items: [...st.items, { id: 70 + i, ...q }] }; });
  const onWall = [{ id: 1, code: 'F10', x: 0, z: -D / 2 + 12.25, rotDeg: 0 }];
  assert.equal(planIslandBack({ room: room(), items: onWall }, 1).reason, 'not island');
  const tight = islandRow(['F10', 'F10'], -D / 2 + 30);
  assert.equal(planIslandBack({ room: room(), items: tight }, 1).reason, 'no room');
  // rotated islands work too
  const turned = islandRow(['F10', 'F2'], 0, 90).map((it, i) => ({ ...it, x: 0, z: -20 + i * 30 }));
  assert.equal(planIslandBack({ room: room(), items: [{ ...turned[0], z: -18 }, { ...turned[1], z: 12 }] }, 1).ok, true);
});

test('her uppers: the one she placed stays, the other moves to the same gap the other side of the range', () => {
  const zU = -D / 2 + 7.25, range = { id: 1, code: 'AP2', x: -20, z: -D / 2 + 13.25, rotDeg: 0 };
  const left = { id: 2, code: 'W2', x: -20 - 18 - 6 - 12, z: zU, rotDeg: 0 };      // 6" clear of the range's left edge
  const right = { id: 3, code: 'W2', x: 40, z: zU, rotDeg: 0 };                      // wherever it was dropped
  const st = { room: room(), items: [range, left, right] };
  assert.deepEqual(mirrorTargets(st, 2), { wall: 'back', range: -20, centre: 0 });
  const p = planMirror(st, 2, 'range');
  assert.equal(p.ok, true, p.reason);
  assert.deepEqual(p.moves.map((m) => m.id), [3], 'only the partner moves');
  assert.ok(Math.abs(p.moves[0].x - (-20 + 18 + 6 + 12)) < 1e-9);
  assert.ok(Math.abs(p.dist - 24) < 1e-9, 'the range centre to the near edge: half the range + the 6" she left');
  // about the wall centre instead
  const q = planMirror(st, 2, 'wall');
  assert.ok(Math.abs(q.moves[0].x - 56) < 1e-9);
  // different widths mirror by their near EDGES
  const wide = { ...right, code: 'W5' };
  const r2 = planMirror({ room: room(), items: [range, left, wide] }, 2, 'range');
  assert.ok(Math.abs((r2.moves[0].x - 18) - (-20 + 18 + 6)) < 1e-9);
  // alone: it centres on the point; already there: says so; no range: says so; a window in the way: blocked
  assert.ok(Math.abs(planMirror({ room: room(), items: [range, left] }, 2, 'range').moves[0].x - -20) < 1e-9);
  assert.equal(planMirror({ room: room(), items: [left] }, 2, 'range').reason, 'no range');
  assert.equal(planMirror({ room: room(), items: [range, left, { ...right, x: 16 }] }, 2, 'range').reason, 'already');
  const win = { id: 1, type: 'window', wall: 'back', pos: (16 + W / 2) / W, width: 30 };
  assert.equal(planMirror({ room: room([win]), items: [range, left, right] }, 2, 'range').reason, 'blocked');
});
