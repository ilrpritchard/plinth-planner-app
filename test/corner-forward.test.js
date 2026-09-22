// corner-forward.test.js — a corner unit can be pulled forward off its wall (return still on the side wall).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { snapPosition } from '../src/interaction/snapping.js';
import { getCab } from '../src/core/catalogue.js';

const W = 150, D = 130, b = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
const f15 = getCab('F15');                           // corner, blank return on the LEFT
const mk = (sideRunZ) => { const store = new Store(); store.setRoom({ width: W, depth: D, height: 96 });
  const c = store.addItem('F15', { x: -W / 2 + 20 + f15.w / 2, z: -D / 2 + 12.25, rotDeg: 0 });      // back-left corner, return to the left wall
  if (sideRunZ != null) store.addItem('F10', { x: -W / 2 + 12.25, z: sideRunZ, rotDeg: 90 });      // a base on the left wall, further into the room
  return { store, id: c.id }; };

test('dragged forward, it lands on the face of the run on the adjoining wall, however far that is', () => {
  const { store, id } = mk(-D / 2 + 24.25 + 30 + 18);       // the side base starts 30" beyond the corner unit's front
  const r = snapPosition(store, id, -W / 2 + 32, -D / 2 + 30, b);
  assert.equal(r.flag, undefined, 'not refused');
  assert.ok(Math.abs((r.z + 12) - (-D / 2 + 24.25 + 30)) < 0.6, `its front lands on the base's near edge: z ${r.z.toFixed(1)}`);
});

test('with nothing to meet it still comes forward up to 30", and is refused beyond that or if the return leaves the wall', () => {
  const { store, id } = mk(null);
  const near = snapPosition(store, id, -W / 2 + 32, -D / 2 + 12.25 + 20, b);           // past the 16" wall snap
  assert.equal(near.flag, undefined); assert.ok(Math.abs(near.z - (-D / 2 + 12.25 + 20)) < 1.5, `20" forward: z ${near.z.toFixed(1)}`);
  const far = snapPosition(store, id, -W / 2 + 32, -D / 2 + 12.25 + 40, b);
  assert.equal(far.flag, 'corner', '40" forward is not a corner any more');
  const off = snapPosition(store, id, -W / 2 + 60, -D / 2 + 12.25 + 20, b);
  assert.equal(off.flag, 'corner', 'return off the side wall: refused');
});

test('a counter or wall cabinet beside a tall: two snap points, the wall and flush with the tall', () => {
  const store = new Store(); store.setRoom({ width: W, depth: D, height: 96 });
  const t1 = getCab('T1'), c1 = getCab('C1');
  store.addItem('T1', { x: -40, z: -D / 2 + t1.d / 2 + 0.25 + 1.18, rotDeg: 0 });           // a tall on the back wall, front 25.43" out
  const c = store.addItem('C1', { x: -40 + t1.w / 2 + c1.w / 2, z: -D / 2 + c1.d / 2 + 0.25, rotDeg: 0 });   // a counter cabinet butted beside it, back on the wall
  const onWall = snapPosition(store, c.id, c.x, -D / 2 + 3, b);
  assert.ok(Math.abs(onWall.z - (-D / 2 + c1.d / 2 + 0.25)) < 0.01, `pointer near the wall: back on the wall (${onWall.z.toFixed(2)})`);
  const flush = snapPosition(store, c.id, c.x, -D / 2 + 20, b);
  const tallFront = -D / 2 + 0.25 + 1.18 + t1.d;
  assert.ok(Math.abs((flush.z + c1.d / 2) - tallFront) < 0.01, `pointer out in the room: front flush with the tall (${(flush.z + c1.d / 2).toFixed(2)} vs ${tallFront.toFixed(2)})`);
  const alone = store.addItem('C1', { x: 40, z: -D / 2 + c1.d / 2 + 0.25, rotDeg: 0 });      // no tall beside it: only the wall
  const a = snapPosition(store, alone.id, 40, -D / 2 + 20, b);
  assert.ok(Math.abs(a.z - (-D / 2 + c1.d / 2 + 0.25)) < 0.01, 'with no tall beside it there is only the wall');
});

// her kitchen 2026-09-22 ("i thought we fixed this, corner cabinet still gets stuck in the corner"): the
// drawers on the left wall leg-to-leg with the corner unit, the oven housing beyond them
test('leg-to-leg: pulled forward it is HELD at the joint (the return would hit the drawers) and says so; it slides along its wall freely', () => {
  const store = new Store(); store.setRoom({ width: W, depth: D, height: 96 });
  const x0 = -W / 2 + 24.25 + f15.w / 2, z0 = -D / 2 + 12.25;                 // leg-to-leg with the left-wall run
  const { id } = store.addItem('F15', { x: x0, z: z0, rotDeg: 0 });
  store.addItem('F17', { x: -W / 2 + 12.25, z: -D / 2 + 24.3 + 10, rotDeg: 90 });
  store.addItem('F32', { x: -W / 2 + 12.25, z: -D / 2 + 24.3 + 20 + 12, rotDeg: 90 });
  for (const dz of [6, 12, 20]) {
    const r = snapPosition(store, id, x0, z0 + dz, b);
    assert.equal(r.flag, 'cornerReturn:F17', `${dz}" forward: held, naming the drawers`);
    assert.ok(Math.abs(r.z - z0) < 0.5 && Math.abs(r.x - x0) < 0.01, `stays at the joint (z ${r.z.toFixed(1)} vs ${z0.toFixed(1)})`);
  }
  const slide = snapPosition(store, id, x0 + 22, z0, b);
  assert.equal(slide.flag, undefined, 'sliding along the back wall is allowed');
  assert.ok(Math.abs(slide.x - (x0 + 22)) < 0.01, 'and lands where it was dropped');
});
