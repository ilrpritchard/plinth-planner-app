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

// her share link p5ph43r (2026-09-22, "cabinets on right angles should snap exactly"): the sink base on
// the right wall started 0.35" past the back run's front plane, and the slot showed as a white slit
test('right-angle joint: a plain cabinet at a dead corner snaps its end onto the adjoining run\'s front plane, both ways', () => {
  const store = new Store(); store.setRoom({ width: 118.9, depth: 86.2, height: 96 });
  const bb = { minX: -118.9 / 2, maxX: 118.9 / 2, minZ: -86.2 / 2, maxZ: 86.2 / 2 };
  const f32 = store.addItem('F32', { x: 1.98, z: -30.85, rotDeg: 0 });
  const f17 = store.addItem('F17', { x: 23.98, z: -30.85, rotDeg: 0 });          // back run ends at x 33.98
  const f1 = store.addItem('F1', { x: 47.2, z: -8.5, rotDeg: 270 });             // right wall, front plane x 35.2, starts z -18.5
  const up = snapPosition(store, f1.id, 47.2, -10.5, bb);                        // nudged toward the back wall
  assert.equal(up.flag, undefined);
  assert.ok(Math.abs((up.z - 10) - (-30.85 + 12)) < 0.01, `its end lands on the back run's front (${(up.z - 10).toFixed(2)})`);
  assert.ok(Math.abs(up.x - 47.2) < 0.01, 'and it stays on its wall');
  const right = snapPosition(store, f17.id, 25.98, -30.85, bb);                  // the drawers nudged toward the corner
  assert.equal(right.flag, undefined);
  assert.ok(Math.abs((right.x + 10) - 35.2) < 0.01, `the drawers end on the sink base's front plane (${(right.x + 10).toFixed(2)})`);
  assert.ok(Math.abs(right.z + 30.85) < 0.01, 'and stay on the back wall');
  void f32;
});

// her W9 beside a tall (2026-09-22): a hung corner unit joins the tall leg to leg, and the 15" shelf then fits the corner
test('a WALL corner unit snaps its body edge onto the flank of a tall on the adjoining wall; W25 fits the 15.43" left', () => {
  const store = new Store(); store.setRoom({ width: 118.9, depth: 86.2, height: 96 });
  const bb = { minX: -118.9 / 2, maxX: 118.9 / 2, minZ: -86.2 / 2, maxZ: 86.2 / 2 };
  const t1 = getCab('T1');
  store.addItem('T1', { x: bb.minX + 0.25 + 1.18 + t1.d / 2, z: -6.85, rotDeg: 90 });     // left wall, front plane at minX + 25.43
  const w9 = store.addItem('W9', { x: -19.47, z: -35.85, rotDeg: 0 });                     // 4.55" off the tall, return on show
  const r = snapPosition(store, w9.id, -21, -35.85, bb);
  assert.equal(r.flag, undefined);
  assert.ok(Math.abs((r.x - 10) - (bb.minX + 25.43)) < 0.01, `body edge on the tall's front plane (${(r.x - 10).toFixed(2)} vs ${(bb.minX + 25.43).toFixed(2)})`);
  // her open shelf: on the LEFT wall beside the tall, pulled forward flush with its face; 10" wide it sits
  // between the tall's near end and the front of the corner unit's return, hiding the return
  store.updateItem(w9.id, { x: r.x });
  const sh = store.addItem('W25', { x: bb.minX + 7.25, z: -6.85 - t1.w / 2 - 5, rotDeg: 90 });
  const f = snapPosition(store, sh.id, bb.minX + 20, sh.z, bb);                            // pulled forward: it DEEPENS (2026-09-23), back on the wall
  assert.equal(f.flag, undefined);
  assert.equal(f.depth, 25, `deepened to the tall's front, to the inch (${f.depth})`);
  assert.ok(Math.abs(f.x - (bb.minX + 7.25)) < 0.01, 'its back stays on the wall');
  assert.ok(Math.abs((f.z + 5) - (-6.85 - t1.w / 2)) < 0.01, 'butted to the tall');
  assert.ok(Math.abs((f.z - 5) - (bb.minZ + 0.25 + 14)) < 0.01, 'its back end meets the front of the return: nothing shows');
});

// her share link gsq2cza (2026-09-22): the tall stood 3.65" off the corner base's face; a shelf pulled forward
// beside the tall belongs to the wall run (scribe to the upper on the adjoining wall); and it can be pulled
// further to cover a corner wall unit's return
test('a tall snaps its end onto a corner base\'s face; a flush shelf still scribes; a shelf can cover a corner wall unit\'s return', async () => {
  const { computeFillers } = await import('../src/core/fillers.js');
  const store = new Store(); store.setRoom({ width: 118.9, depth: 86.2, height: 96 });
  const bb = { minX: -118.9 / 2, maxX: 118.9 / 2, minZ: -86.2 / 2, maxZ: 86.2 / 2 };
  store.addItem('F15', { x: -24.02, z: -30.85, rotDeg: 0 });                         // corner base, front at z -18.85
  const t1 = store.addItem('T1', { x: -46.02, z: -3.2, rotDeg: 90 });                // starts at z -15.2: 3.65" off
  const r = snapPosition(store, t1.id, -46.02, -5, bb);
  assert.ok(Math.abs((r.z - 12) - (-18.85)) < 0.01, `the tall's end lands on the corner base's face (${(r.z - 12).toFixed(2)})`);
  // a shelf flush with the tall, its back end 3.65" short of a W1's front on the back wall: an upper scribe
  store.addItem('W1', { x: -26.34, z: -35.85, rotDeg: 0 });
  const sh = store.addItem('W25', { x: -41.02, z: -20.2, rotDeg: 90 });
  const up = computeFillers(store.state).filter((f) => f.band === 'upper');
  assert.ok(up.some((f) => Math.abs(f.w - 3.65) < 0.05 && f.rotDeg === 90), `scribe between the shelf and the upper: ${JSON.stringify(up.map((f) => [+f.w.toFixed(2), f.rotDeg]))}`);
  // swap the W1 for a W9 corner unit moved out along the back wall: its return runs toward the left wall
  store.removeItem(store.state.items.find((i) => i.code === 'W1').id);
  store.addItem('W9', { x: -18, z: -35.85, rotDeg: 0 });                             // body edge -28, return to -38
  const c = snapPosition(store, sh.id, -33, -20.2, bb);                                // pulled forward (the drag keeps the pointer on the wall's own side)
  assert.equal(c.depth, 31, `the shelf deepens to the W9's body edge (31.2" from the wall, to the inch), covering the return (${c.depth})`);
  assert.ok(Math.abs(c.x - (-118.9 / 2 + 7.25)) < 0.01, 'its back stays on the wall');
});

// her ask 2026-09-23: the open shelf pulled forward gets DEEPER (back on the wall), to the inch, snapping to a tall's front
test('an open shelf pulled forward reports a new depth: free to the inch, snapped onto the tall\'s front within 2"', () => {
  const store = new Store(); store.setRoom({ width: W, depth: D, height: 96 });
  const t1 = getCab('T1');
  store.addItem('T1', { x: -W / 2 + 0.25 + 1.18 + t1.d / 2, z: -6.85, rotDeg: 90 });     // front plane at minX + 25.43
  const sh = store.addItem('W25', { x: -W / 2 + 7.25, z: -6.85 - t1.w / 2 - 5, rotDeg: 90 });
  const free = snapPosition(store, sh.id, -W / 2 + 13, sh.z, b);                          // front would be at 20": free, to the inch
  assert.equal(free.depth, 20); assert.ok(Math.abs(free.x - (-W / 2 + 7.25)) < 0.01, 'back stays on the wall');
  const snap = snapPosition(store, sh.id, -W / 2 + 17, sh.z, b);                          // front at 24": within 2" of the tall's 25.43
  assert.equal(snap.depth, 25, 'snapped onto the tall\'s front, rounded to the inch');
  const shallow = snapPosition(store, sh.id, -W / 2 + 7, sh.z, b);
  assert.equal(shallow.depth, 14, 'pushed back to the wall it is its own 14"');
});

// her W34 / W18 (2026-09-25, share gq3cgu2): the corner dropped first, tip to the wall, then the 14" run
// landed on its face and covered 4¼" of its door. "the oak corner part should be the same depth as the
// wall cabinet": whichever comes first, the corner ends leg to leg with the run.
test('settleCorners: a run dropped on a corner unit\'s face pulls the corner out to meet it leg to leg', async () => {
  const { settleCorners, cornerReturnLength } = await import('../src/interaction/snapping.js');
  const W = 156, D = 216, bb = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
  const mk = () => { const s = new Store(); s.setRoom({ width: W, depth: D, height: 110.4 }); return s; };
  // her order: W34 tip-to-wall on the left wall (10" out), then the W18 along the back wall to its face
  let s = mk();
  const c = s.addItem('W34', { x: -70.75, z: -80, rotDeg: 90 });
  const w = s.addItem('W18', { x: -45.75, z: -100.75, rotDeg: 0 });
  let moves = settleCorners(s, bb);
  assert.equal(moves.length, 1);
  assert.ok(Math.abs(s.getItem(c.id).z - (-75.75)) < 0.01, `the W34 comes out to 14.25" from the back wall (${s.getItem(c.id).z})`);
  assert.equal(s.getItem(w.id).x, -45.75, 'the W18 stays on its face');
  assert.equal(settleCorners(s, bb).length, 0, 'settled once, it stays');
  // the other order (the corner dragged in after the run) already lands there: same answer
  s = mk(); s.addItem('W18', { x: -45.75, z: -100.75, rotDeg: 0 });
  const c2 = s.addItem('W34', { x: -70.75, z: -60, rotDeg: 90 });
  const r = snapPosition(s, c2.id, -70.75, -85, bb);
  assert.ok(Math.abs(r.z - (-75.75)) < 0.01 && r.flag === undefined);
  // a cabinet butted to the corner's door side comes out with it, keeping the run closed
  s = mk();
  const c3 = s.addItem('W34', { x: -70.75, z: -80, rotDeg: 90 });
  const nb = s.addItem('W1', { x: -70.75, z: -80 + 18 + 10, rotDeg: 90 });         // 20" single butted to the door edge
  s.addItem('W18', { x: -45.75, z: -100.75, rotDeg: 0 });
  moves = settleCorners(s, bb);
  assert.equal(moves.length, 2);
  assert.ok(Math.abs(s.getItem(c3.id).z - (-75.75)) < 0.01 && Math.abs(s.getItem(nb.id).z - (-52 + 4.25)) < 0.01, 'both move 4.25"');
  // a tall on the face: 25.43" is further than a 10" wall return can be drawn (20"), so the corner stays and the warning does the talking
  s = mk();
  const c4 = s.addItem('W34', { x: -70.75, z: -80, rotDeg: 90 });
  s.addItem('T1', { x: -45.75, z: bb.minZ + 0.25 + 1.18 + 12, rotDeg: 0 });
  assert.equal(settleCorners(s, bb).length, 0); assert.equal(s.getItem(c4.id).z, -80);
  // the floor corner the same way: F15R tip-to-wall (20" out) with a 24" base landing on its face → 24.25" out
  s = mk();
  const f = s.addItem('F15R', { x: bb.minX + 12.25, z: bb.minZ + 20 + 10, rotDeg: 90 });
  s.addItem('F2', { x: bb.minX + 24.25 + 12, z: bb.minZ + 12.25, rotDeg: 0 });
  moves = settleCorners(s, bb);
  assert.equal(moves.length, 1);
  assert.ok(Math.abs((s.getItem(f.id).z - 10) - (bb.minZ + 24.25)) < 0.01, `body edge at 24.25" (${(s.getItem(f.id).z - 10 - bb.minZ).toFixed(2)})`);
  assert.equal(cornerReturnLength(getCab('F15R'), s.getItem(f.id), s.state.room), 24.25, 'the drawn return stretches to the wall behind the base');
});
