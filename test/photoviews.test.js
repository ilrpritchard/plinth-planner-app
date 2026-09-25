// photoviews.test.js — the Photo button's five standpoints stand inside the room at human height
// and look at the kitchen, whatever the room size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoViews } from '../src/core/photoviews.js';

const inside = (room, [px, py, pz]) => px > -room.width / 2 && px < room.width / 2 && pz > -room.depth / 2 && pz < room.depth / 2 && py > 0 && py < room.height;

test('five views, all inside the room, none above the ceiling, every one facing the back run', () => {
  for (const room of [{ width: 96, depth: 90, height: 84 }, { width: 144, depth: 120, height: 96 }, { width: 240, depth: 220, height: 120 }, { width: 400, depth: 150, height: 108 }]) {
    const vs = photoViews(room, []);
    assert.equal(vs.length, 5, 'five angles');
    assert.equal(new Set(vs.map((v) => v.key)).size, 5, 'distinct keys');
    for (const v of vs) {
      if (v.key === 'straight-on') assert.ok(v.pos[2] <= room.depth / 2 + 72 && v.pos[2] >= room.depth / 2 - 6 && v.pos[2] - (-room.depth / 2 + 26) >= Math.min(0.7 * room.width, room.depth + 40), `${v.key}: stands well back (at ${v.pos[2].toFixed(0)} in a ${room.depth}-deep room)`);
      else assert.ok(inside(room, v.pos), `${v.key} in ${room.width}x${room.depth}: camera at ${v.pos} is outside the room`);
      assert.ok(v.target[2] < v.pos[2], `${v.key}: looks toward the back wall`);
      assert.ok(v.fov >= 45 && v.fov <= 65, `${v.key}: a wide-angle lens, not a fisheye`);
    }
    const eye = vs.filter((v) => v.key.startsWith('hero') || v.key === 'straight-on');
    for (const v of eye) assert.ok(v.pos[1] >= 50 && v.pos[1] <= 60, `${v.key}: camera at chest-to-eye height, got ${v.pos[1]}`);
    assert.ok(vs.find((v) => v.key === 'worktop').pos[1] < 50, 'the close-up is low');
    assert.ok(vs.find((v) => v.key === 'overview').pos[1] > eye[0].pos[1], 'the overview is raised');
  }
});

test('the views aim at the run where it stands, and read the island when there is one', () => {
  const room = { width: 240, depth: 200, height: 96 };
  const run = [{ code: 'F10', x: 80, z: -87.75, rotDeg: 0 }, { code: 'F18', x: 50, z: -87.75, rotDeg: 0 }, { code: 'W2', x: 80, z: -93, rotDeg: 0 }];
  const plain = photoViews(room, run);
  assert.ok(Math.abs(plain.find((v) => v.key === 'straight-on').target[0] - 65) < 0.01, 'straight-on is centred on the run (mean x of the floor cabinets)');
  const withIsland = photoViews(room, run.concat([{ code: 'F20', x: 20, z: -20, rotDeg: 180, island: true }]));
  const isl = withIsland.find((v) => v.key === 'island');
  assert.ok(isl, 'an island view replaces the worktop close-up');
  assert.ok(isl.pos[2] > -20, 'shot from the far side of the island toward the run');
  assert.ok(!withIsland.some((v) => v.key === 'worktop'));
});
