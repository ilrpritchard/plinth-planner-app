// cooker-rules.test.js — nothing sits over the range. A counter dresser or an
// upper dragged onto a range or hob is pushed off it (or stays put) and the
// drop is flagged 'cooker', so the controller pings it back.
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
function mkStore() { const s = new Store(); s.setRoom({ width: 240, depth: 160, height: 96 }); return s; }

test('a counter dresser cannot be dropped on a range', () => {
  const store = mkStore();
  const b = bounds(store.state.room);
  const range = store.addItem('AP2', { x: 0, z: b.minZ + 13.25, rotDeg: 0 });       // 36" range on the back wall
  const c3 = store.addItem('C3', { x: b.minX + 60, z: b.minZ + 7.25, rotDeg: 0 });   // dresser well away
  const s = snapPosition(store, c3.id, range.x, b.minZ + 7.25, b);                    // drop it right on the range
  const overlapX = Math.min(s.x + 18, range.x + 18) - Math.max(s.x - 18, range.x - 18);
  assert.ok(overlapX <= 0.75, `dresser still overlaps the range by ${overlapX.toFixed(1)}"`);
  assert.equal(s.flag, 'cooker', 'the drop is flagged so the controller pings it back');
});

test('an upper cannot be dropped over a hob either, but a floor cabinet beside it is fine', () => {
  const store = mkStore();
  const b = bounds(store.state.room);
  const hob = store.addItem('AP4', { x: 0, z: b.minZ + 10.75, rotDeg: 0 });          // 30" cooktop on the back wall
  const w5 = store.addItem('W5', { x: b.minX + 80, z: b.minZ + 7.25, rotDeg: 0 });
  const s = snapPosition(store, w5.id, hob.x, b.minZ + 7.25, b);
  assert.equal(s.flag, 'cooker');
  const f2 = store.addItem('F2', { x: b.maxX - 40, z: b.minZ + 12.25, rotDeg: 0 });
  const s2 = snapPosition(store, f2.id, hob.x + 30, b.minZ + 12.25, b);              // beside the hob, not on it
  assert.notEqual(s2.flag, 'cooker', 'a floor cabinet next to the hob is allowed');
});

test('a hood above the range is still allowed', () => {
  const store = mkStore();
  const b = bounds(store.state.room);
  store.addItem('AP2', { x: 0, z: b.minZ + 13.25, rotDeg: 0 });
  const hood = store.addItem('AP8', { x: 60, z: b.minZ + 10.25, rotDeg: 0 });
  const s = snapPosition(store, hood.id, 0, b.minZ + 10.25, b);
  assert.notEqual(s.flag, 'cooker', 'the hood belongs over the range');
});
