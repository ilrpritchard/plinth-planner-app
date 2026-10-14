// photoviews.test.js — the Photo button's five standpoints stand inside the room at human height
// and look at the kitchen, whatever the room size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoViews, straightViews } from '../src/core/photoviews.js';

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

// her call 2026-10-14: "just give 2 straight on views of each side/angle of the kitchens"
test('straight-on: two level views square to every side that carries cabinets, none for an empty side', () => {
  const room = { width: 240, depth: 200, height: 96, openings: [] };
  const items = [{ code: 'F10', x: 80, z: -87.75, rotDeg: 0 }, { code: 'AP1', x: 40, z: -87, rotDeg: 0 }, { code: 'W2', x: 80, z: -93, rotDeg: 0 },
    { code: 'T1', x: -110.5, z: -40, rotDeg: 90 }, { code: 'F20', x: 20, z: -20, rotDeg: 180, island: true }];
  const vs = straightViews(room, items);
  assert.deepEqual(vs.map((v) => v.key), ['back-whole', 'back-close', 'left-whole', 'left-close', 'island-whole', 'island-close']);
  for (const v of vs) {
    assert.equal(v.pos[1], v.target[1], `${v.key}: level camera, verticals vertical`);
    assert.equal(v.shift, 0, `${v.key}: no lens shift`);
    assert.ok(v.pos[1] >= 36 && v.pos[1] <= room.height - 10, `${v.key}: a standing camera (${v.pos[1]})`);
    assert.ok([24, 28, 35, 50].includes(v.lens), `${v.key}: a real lens`);
    if (v.side === 'back') assert.ok(Math.abs(v.pos[0] - v.target[0]) < 1e-9 && v.target[2] === -74 && v.pos[2] > v.target[2], `${v.key}: square to the back run's front`);
    if (v.side === 'left') assert.ok(Math.abs(v.pos[2] - v.target[2]) < 1e-9 && v.pos[0] > v.target[0], `${v.key}: square to the left run`);
    // never further back than 6' beyond the facing wall
    assert.ok(v.pos[0] > -room.width / 2 - 72 && v.pos[0] < room.width / 2 + 72 && v.pos[2] > -room.depth / 2 - 72 && v.pos[2] < room.depth / 2 + 72, `${v.key}: within reach`);
  }
  assert.ok(Math.abs(vs[0].target[0] - 61.5) < 0.01, 'the whole-run view is centred on the run');
  assert.ok(Math.abs(vs[1].target[0] - 45) < 0.01, 'the closer view is centred on the range, held 20" in from the run end so the frame stays on the run');
  assert.ok(vs[0].pos[2] > vs[1].pos[2], 'the whole-run view stands further back');
  assert.deepEqual(straightViews(room, []), [], 'nothing to photograph: no views');
  assert.equal(straightViews(room, items.slice(0, 3)).length, 2, 'one side: two views');
});
