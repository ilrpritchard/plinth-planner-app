// roomresize.test.js — a new room size keeps the kitchen on its walls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoomResize, planBringInside, anyOutside } from '../src/core/roomresize.js';
import { getCab } from '../src/core/catalogue.js';
import { openingCenter } from '../src/core/openings.js';
import { wallsInUse } from '../src/core/placement.js';
import { planLineUp } from '../src/core/evenout.js';

const W = 232, D = 156;
const f10 = getCab('F10'), t11 = getCab('T11');
const state = () => ({ room: { width: W, depth: D, height: 96, openings: [{ id: 1, type: 'window', wall: 'back', pos: 0.7, width: 48 }] }, items: [
  { id: 1, code: 'T11', x: -W / 2 + t11.w / 2, z: -D / 2 + t11.d / 2 + 1.43, rotDeg: 0 },           // hard in the left corner
  { id: 2, code: 'F10', x: 40, z: -D / 2 + f10.d / 2 + 0.25, rotDeg: 0 },
  { id: 3, code: 'F10', x: W / 2 - f10.d / 2 - 0.25, z: 10, rotDeg: 270 },                          // standing on the right wall
  { id: 4, code: 'F10', x: 0, z: 30, rotDeg: 0, island: true }] });
const apply = (st, patch) => { const p = planRoomResize(st, patch); const items = st.items.map((it) => ({ ...it, ...(p.moves.find((m) => m.id === it.id) || {}) }));
  const openings = st.room.openings.map((o) => ({ ...o, ...(p.openings.find((q) => q.id === o.id) || {}) })); return { p, st: { room: { ...st.room, ...patch, openings }, items } }; };

test('her case: 4" narrower. The run stays in its corner, the right-wall cabinet stays on the right wall', () => {
  const before = state(), { p, st } = apply(before, { width: 228 });
  const left = (s, id) => { const it = s.items.find((i) => i.id === id), c = getCab(it.code); return it.x - c.w / 2 + s.room.width / 2; };
  assert.ok(Math.abs(left(st, 1)) < 1e-9, 'the tall is still hard in the left corner');
  assert.ok(Math.abs(left(st, 2) - left(before, 2)) < 1e-9, 'same distance from the left wall');
  const it3 = st.items.find((i) => i.id === 3);
  assert.ok(Math.abs(228 / 2 - (it3.x + f10.d / 2) - 0.25) < 1e-9, 'still 1/4" off the right wall');
  assert.deepEqual(p.issues, []); assert.equal(p.inside, 0);
  // the window has not slid along the wall
  assert.ok(Math.abs((openingCenter(st.room, st.room.openings[0]) + 228 / 2) - (openingCenter(before.room, before.room.openings[0]) + W / 2)) < 0.02);
});

test('deeper room: everything keeps its distance from the back wall; nothing moves when nothing changes', () => {
  const before = state(), { st } = apply(before, { depth: 180 });
  for (const it of st.items) { const was = before.items.find((i) => i.id === it.id); assert.ok(Math.abs((it.z + 90) - (was.z + D / 2)) < 1e-9); assert.equal(it.x, was.x); }
  assert.deepEqual(planRoomResize(state(), { width: W }).moves, []);
});

const inRoom = (st) => !anyOutside(st);

test('her case: a much narrower room. NOTHING is left through a wall, and the run that no longer fits is flagged', () => {
  // back run 5 x 36" from the left corner (180") with an upper over it, plus a run on the right wall that owns no corner
  const items = [0, 1, 2, 3, 4].map((k) => ({ id: k + 1, code: 'F10', x: -W / 2 + 18 + 36 * k, z: -D / 2 + f10.d / 2 + 0.25, rotDeg: 0 }));
  items.push({ id: 9, code: 'W2', x: items[4].x, z: -D / 2 + 7.25, rotDeg: 0 });
  items.push({ id: 10, code: 'F10', x: W / 2 - f10.d / 2 - 0.25, z: 40, rotDeg: 270 });
  const st0 = { room: { width: W, depth: D, height: 96, openings: [] }, items };
  // 232 -> 200: the run (180") still fits
  let { p, st } = apply(st0, { width: 200 });
  assert.deepEqual(p.issues, []); assert.ok(inRoom(st));
  // 232 -> 150: it cannot. Everything is still inside, the back wall is flagged 30" short, the upper stayed over its base
  ({ p, st } = apply(st0, { width: 150 }));
  assert.ok(inRoom(st), 'nothing through a wall');
  assert.equal(p.issues.length, 1); assert.equal(p.issues[0].wall, 'back'); assert.ok(Math.abs(p.issues[0].over - 30) < 0.01);
  assert.ok(Math.abs(st.items.find((i) => i.id === 9).x - st.items.find((i) => i.id === 5).x) < 12.01);
  const right = st.items.find((i) => i.id === 10); assert.ok(Math.abs(150 / 2 - (right.x + f10.d / 2) - 0.25) < 1e-9, 'the right-wall cabinet is still on the right wall');
});

test('a run that fits slides back in AS ONE, and stops at a run on the side wall that stands in its way', () => {
  // the right-wall run owns the corner (starts at the back wall); the back run butts up to its front
  const side = { id: 20, code: 'F10', x: W / 2 - f10.d / 2 - 0.25, z: -D / 2 + 18, rotDeg: 270 };
  const edge = W / 2 - f10.d - 0.25;
  const items = [{ id: 1, code: 'F10', x: edge - 18, z: -D / 2 + f10.d / 2 + 0.25, rotDeg: 0 }, { id: 2, code: 'F10', x: edge - 54, z: -D / 2 + f10.d / 2 + 0.25, rotDeg: 0 }, side];
  const { p, st } = apply({ room: { width: W, depth: D, height: 96, openings: [] }, items }, { width: W - 20 });
  assert.deepEqual(p.issues, []); assert.ok(inRoom(st));
  const b1 = st.items.find((i) => i.id === 1), sd = st.items.find((i) => i.id === 20);
  assert.ok(Math.abs((b1.x + 18) - (sd.x - f10.d / 2)) < 0.01, 'still butted to the front of the side run, not run through it');
  assert.ok(Math.abs(st.items.find((i) => i.id === 2).x - (b1.x - 36)) < 1e-9, 'moved as one');
});

test('a design that was SAVED with cabinets outside the room is brought back in; a sound one is never touched', () => {
  const broken = state(); for (const it of broken.items) if (it.id === 1) it.x -= 30;     // the tall 30" through the left wall
  assert.equal(anyOutside(broken), true);
  const p = planBringInside(broken), fixed = { ...broken, items: broken.items.map((it) => ({ ...it, ...(p.moves.find((m) => m.id === it.id) || {}) })) };
  assert.ok(inRoom(fixed));
  assert.equal(anyOutside(state()), false);
  assert.deepEqual(planBringInside(state()).moves, []);
});

test('an L: a shallower room slides the left-wall run back as one, up to the back run, never through it; too shallow is flagged on the LEFT wall', () => {
  const t10 = getCab('T10');
  const backRun = [0, 1, 2].map((k) => ({ id: k + 1, code: 'F10', x: -W / 2 + 18 + 36 * k, z: -D / 2 + f10.d / 2 + 0.25, rotDeg: 0 }));
  // the left run stands at the FRONT end of its wall: 36 + 36 + a tall, finishing on the front wall
  const zEnd = D / 2, leftRun = [{ id: 10, code: 'T10', x: -W / 2 + t10.d / 2 + 1.43, z: zEnd - t10.w / 2, rotDeg: 90 },
    { id: 11, code: 'F10', x: -W / 2 + f10.d / 2 + 0.25, z: zEnd - t10.w - 18, rotDeg: 90 }, { id: 12, code: 'F10', x: -W / 2 + f10.d / 2 + 0.25, z: zEnd - t10.w - 54, rotDeg: 90 }];
  const st0 = { room: { width: W, depth: D, height: 96, openings: [] }, items: [...backRun, ...leftRun] };
  let { p, st } = apply(st0, { depth: D - 20 });                        // 156 -> 136: 99" of run, 111" of wall in front of the back run
  assert.deepEqual(p.issues, []); assert.ok(inRoom(st)); assert.equal(p.inside, 3);
  const z = (id) => st.items.find((i) => i.id === id).z;
  assert.ok(Math.abs((z(10) + t10.w / 2) - (D - 20) / 2) < 0.01, 'the tall finishes exactly on the new front wall');
  assert.ok(Math.abs(z(11) - (z(10) - t10.w / 2 - 18)) < 1e-9 && Math.abs(z(12) - (z(11) - 36)) < 1e-9, 'still butted, moved as one');
  ({ p, st } = apply(st0, { depth: 110 }));                             // 85" in front of the back run: 14" short
  assert.ok(inRoom(st));
  assert.deepEqual(p.issues.map((i) => i.wall), ['left']); assert.ok(Math.abs(p.issues[0].over - (99 - (110 - f10.d - 0.25))) < 0.01);
  for (const b of backRun) assert.equal(st.items.find((i) => i.id === b.id).x, b.x, 'the back run has not moved sideways');
});

test('walls in use: only walls something stands against leave a footprint when hidden; the island never counts', () => {
  assert.deepEqual([...wallsInUse(state())].sort(), ['back', 'left', 'right']);
  assert.deepEqual([...wallsInUse({ room: state().room, items: [state().items[3]] })], []);
});

test('one end through the wall while the run still fits: line-up brings it back inside; longer than the wall says so', () => {
  const codes = ['T11', 'F10', 'F10', 'F10', 'F10', 'T11'], run = codes.reduce((a, k) => a + getCab(k).w, 0);
  const build = (Wr) => { let x = -Wr / 2 + 4, id = 1; return { room: { width: Wr, depth: D, height: 96, openings: [] }, items: codes.map((code) => { const c = getCab(code), it = { id: id++, code, x: x + c.w / 2, z: -D / 2 + c.d / 2 + 0.25, rotDeg: 0 }; x += c.w; return it; }) }; };
  const p = planLineUp(build(run + 2), 'back');                    // 4" spare on the left, 2" through the right
  assert.equal(p.ok, true, p.reason);
  assert.ok(Math.abs(p.left - 4) < 0.01 && Math.abs(p.right + 2) < 0.01);
  assert.ok(Math.abs(p.options[0].left - 1) < 0.01 && Math.abs(p.options[0].right - 1) < 0.01);
  const q = planLineUp(build(run - 3), 'back');
  assert.equal(q.reason, 'over the wall');
  assert.ok(Math.abs(q.left + q.right + 3) < 0.01);
});
