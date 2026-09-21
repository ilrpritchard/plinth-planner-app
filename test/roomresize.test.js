// roomresize.test.js — a new room size keeps the kitchen on its walls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoomResize } from '../src/core/roomresize.js';
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
  assert.equal(p.outside, 0);
  // the window has not slid along the wall
  assert.ok(Math.abs((openingCenter(st.room, st.room.openings[0]) + 228 / 2) - (openingCenter(before.room, before.room.openings[0]) + W / 2)) < 0.02);
});

test('deeper room: everything keeps its distance from the back wall; nothing moves when nothing changes', () => {
  const before = state(), { st } = apply(before, { depth: 180 });
  for (const it of st.items) { const was = before.items.find((i) => i.id === it.id); assert.ok(Math.abs((it.z + 90) - (was.z + D / 2)) < 1e-9); assert.equal(it.x, was.x); }
  assert.deepEqual(planRoomResize(state(), { width: W }).moves, []);
});

test('a room made too small says how many cabinets no longer fit, and deletes nothing', () => {
  const p = planRoomResize(state(), { width: 60 });
  assert.ok(p.outside >= 1);
  assert.equal(p.moves.length, 4);
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
