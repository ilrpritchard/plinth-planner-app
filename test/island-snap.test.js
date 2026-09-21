// island-snap.test.js — back-to-back island cabinets line up at the END when dragged.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};
const { Store } = await import('../src/core/store.js');
const { snapPosition } = await import('../src/interaction/snapping.js');
const bounds = (rm) => ({ minX: -rm.width / 2, maxX: rm.width / 2, minZ: -rm.depth / 2, maxZ: rm.depth / 2 });
const mk = () => { const s = new Store(); s.setRoom({ width: 240, depth: 200, height: 96 }); return s; };

test('her screenshot: the front cabinet dragged nearly behind the back one ends FLUSH with it, backs touching', () => {
  const store = mk(), b = bounds(store.state.room);
  const back = store.addItem('F10', { x: 0, z: -12, rotDeg: 180, island: true });          // faces away, its back plane at z = 0
  const front = store.addItem('F10', { x: 40, z: 40, rotDeg: 0, island: true });
  const s = snapPosition(store, front.id, 2.2, 13.5, b);                                    // dropped 2.2" off along, 1.5" off the back
  assert.ok(Math.abs(s.z - 12) < 0.01, `backs touch (z ${s.z})`);
  assert.ok(Math.abs(s.x - 0) < 0.01, `ends flush (x ${s.x})`);
});

test('a narrower cabinet grabs whichever END is nearer, and a joint in the row behind counts too', () => {
  const store = mk(), b = bounds(store.state.room);
  store.addItem('F10', { x: -18, z: -12, rotDeg: 180, island: true });                       // back row: two 36s, joint at x = 0
  store.addItem('F10', { x: 18, z: -12, rotDeg: 180, island: true });
  const f = store.addItem('F2', { x: 80, z: 60, rotDeg: 0, island: true });                  // 24" wide
  const right = snapPosition(store, f.id, 22.5, 13, b);                                      // near the right end (36): hi edge 34.5
  assert.ok(Math.abs(right.x + 12 - 36) < 0.01, `flush with the right end (x ${right.x})`);
  const joint = snapPosition(store, f.id, 13.8, 13, b);                                      // lo edge 1.8 from the joint at 0
  assert.ok(Math.abs(right.z - 12) < 0.01 && Math.abs(joint.x - 12 - 0) < 0.01, `starts on the joint (x ${joint.x})`);
  const mid = snapPosition(store, f.id, -18, 13, b);                                          // 6" from every end and joint: left where it was dropped
  assert.ok(Math.abs(mid.x + 18) < 0.01, `no grab when nothing is close (x ${mid.x})`);
});

test('an island turned 90 degrees lines up the same way', () => {
  const store = mk(), b = bounds(store.state.room);
  store.addItem('F10', { x: -12, z: 0, rotDeg: 270, island: true });
  const f = store.addItem('F10', { x: 60, z: 60, rotDeg: 90, island: true });
  const s = snapPosition(store, f.id, 13, 3, b);
  assert.ok(Math.abs(s.x - 12) < 0.01 && Math.abs(s.z - 0) < 0.01, `x ${s.x} z ${s.z}`);
});
