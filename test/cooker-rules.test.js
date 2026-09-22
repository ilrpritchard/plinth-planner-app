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

// ---- a range stands PROUD of the run: touching a cabinet beside it (or the range
// itself) must not drag anything off, or into, the wall (her share link 2026-09-18:
// F19 and the corner unit sat 1.75" off the back wall after being clicked) ----
test('front-flush snap leaves appliances out of it, both ways', async () => {
  const { Store } = await import('../src/core/store.js');
  const { snapPosition } = await import('../src/interaction/snapping.js');
  const st = new Store(); st.setRoom({ width: 200, depth: 150, height: 96 });
  const b = { minX: -100, maxX: 100, minZ: -75, maxZ: 75 };
  const left = st.addItem('F21', { x: -17.75, z: -62.75 }), rng = st.addItem('AP1', { x: 7.25, z: -61.75 }), right = st.addItem('F19', { x: 36.25, z: -62.75 });
  for (const it of [left, right]) {
    const s = snapPosition(st, it.id, it.x + 0.3, it.z + 0.4, b);
    assert.ok(Math.abs(s.z - -62.75) < 0.01, `${it.code} stays on the wall beside the range (z ${s.z})`);
  }
  const s = snapPosition(st, rng.id, rng.x, rng.z + 0.3, b);
  assert.ok(Math.abs(s.z - -61.75) < 0.01, `the range keeps its own wall position (z ${s.z})`);
  // two CABINETS still align their fronts
  const tall = st.addItem('T1', { x: 80, z: 40 });
  const t = snapPosition(st, tall.id, 36.25 + 14 + 12 + 0.2, -62, b);
  assert.ok(t.z > -62.75 + 1, 'a tall still stands 30mm proud of the base run');
});

// her rule 2026-09-22: "800mm, 18 inches and then 50mm either side of the range"
test('a wall cabinet dragged up to a cooktop stops 50mm short of its edge; the warning names a closer one', async () => {
  const { COOK_SIDE_IN } = await import('../src/core/units.js');
  const { computeWarnings } = await import('../src/core/warnings.js');
  const store = mkStore(); const b = bounds(store.state.room);
  store.addItem('F32', { x: 0, z: -80 + 12.25, rotDeg: 0 });
  store.addItem('AP22', { x: 0, z: -80 + 12.25, rotDeg: 0 });                    // 24" hob, edges at ±11.45
  const w2 = store.addItem('W2', { x: 40, z: -80 + 7.25, rotDeg: 0 });
  const r = snapPosition(store, w2.id, 11.45 + 12 - 1, -80 + 7.25, b);         // dropped 1" into the clearance
  assert.ok(Math.abs((r.x - 12) - (11.45 + COOK_SIDE_IN)) < 0.05, `held 50mm off the hob's edge (${(r.x - 12).toFixed(2)})`);
  store.updateItem(w2.id, { x: 11.45 + 12 + 0.5 });                              // saved too close: warned
  assert.ok(computeWarnings(store.state).some((w) => /50mm/.test(w.msg)), 'warning names the side clearance');
  store.updateItem(w2.id, { x: 11.45 + 12 + COOK_SIDE_IN });
  assert.ok(!computeWarnings(store.state).some((w) => /50mm/.test(w.msg)), 'no warning at 50mm');
});
