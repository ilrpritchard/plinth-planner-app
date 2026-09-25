// plasterhood.test.js — beside a PLASTER hood (AP26-28) the uppers butt its flank with no 50mm
// cooker keep-clear, and the crown dies into the hood's side like at a tall (her rule 2026-09-25).
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};
const { Store } = await import('../src/core/store.js');
const { snapPosition } = await import('../src/interaction/snapping.js');
const { planCornice } = await import('../src/core/cornice.js');
const { computeWarnings } = await import('../src/core/warnings.js');
const { getCab } = await import('../src/core/catalogue.js');

const W = 200, D = 150, minZ = -D / 2;
const bounds = { minX: -W / 2, maxX: W / 2, minZ, maxZ: D / 2 };
const hoodCab = getCab('AP27'), half = hoodCab.w / 2;
function kitchen(hood = 'AP27') {
  const store = new Store(); store.setRoom({ width: W, depth: D, height: 96, cornice: 'plain' });
  store.addItem('AP2', { x: 0, z: minZ + 13.25, rotDeg: 0 });
  const h = getCab(hood);
  store.addItem(hood, { x: 0, z: minZ + h.d / 2 + 0.25, rotDeg: 0 });
  return store;
}

test('a wall cabinet dragged at the plaster hood butts its flank: no gap, no flag', () => {
  const store = kitchen();
  const u = store.addItem('W2', { x: -80, z: minZ + 7.25, rotDeg: 0 });
  const s = snapPosition(store, u.id, -half - 12 + 6, minZ + 7.25, bounds);       // dropped 6" INTO the hood
  assert.equal(s.flag, undefined, `flagged ${s.flag}`);
  assert.ok(Math.abs((s.x + 12) - (-half)) < 0.05, `its edge meets the hood's flank (edge at ${(s.x + 12).toFixed(2)}, flank at ${(-half).toFixed(2)})`);
  const store2 = kitchen('AP8');                                                    // the stainless hood: the 50mm cooker rule still holds
  const u2 = store2.addItem('W2', { x: -80, z: minZ + 7.25, rotDeg: 0 });
  const s2 = snapPosition(store2, u2.id, -18 - 12 + 6, minZ + 7.25, bounds);
  assert.ok(-18 - (s2.x + 12) >= 50 / 25.4 - 0.05, `beside an AP8 the upper keeps 50mm off the cooker (gap ${(-18 - (s2.x + 12)).toFixed(2)})`);
});

test('no cooker-edge warning for an upper butted to the plaster hood; the warning stays for the stainless hood', () => {
  const store = kitchen();
  store.addItem('W2', { x: -half - 12, z: minZ + 7.25, rotDeg: 0 });
  store.addItem('W2', { x: half + 12, z: minZ + 7.25, rotDeg: 0 });
  const msgs = computeWarnings(store.state).map((w) => w.msg);
  assert.ok(!msgs.some((m) => /cooker's edge/.test(m)), msgs.join(' | '));
  const store2 = kitchen('AP8');
  store2.addItem('W2', { x: -18 - 12, z: minZ + 7.25, rotDeg: 0 });
  assert.ok(computeWarnings(store2.state).some((w) => /cooker's edge/.test(w.msg)), 'AP8: still warned');
});

test('the crown of the uppers dies into the plaster hood: no side return at the hood, no crown on the hood', () => {
  const store = kitchen();
  store.addItem('W2', { x: -half - 12, z: minZ + 7.25, rotDeg: 0 });
  store.addItem('W2', { x: half + 12, z: minZ + 7.25, rotDeg: 0 });
  const plan = planCornice(store.state);
  const fronts = plan.segments.filter((g) => Math.abs(Math.sin(g.angle)) < 0.01 && Math.abs(g.z - (minZ + 14.25)) < 0.5);
  assert.equal(fronts.length, 2, `two front strips, one per upper (${plan.segments.length} segments)`);
  const sides = plan.segments.filter((g) => Math.abs(Math.cos(g.angle)) < 0.01);
  for (const g of sides) assert.ok(Math.abs(g.x) > half + 20, `a side return at x ${g.x.toFixed(1)} sits on the hood flank`);
  assert.ok(!plan.segments.some((g) => Math.abs(g.x) < half - 1 && Math.abs(g.z - (minZ + 20.25)) < 1), 'no crown across the hood front');
  assert.equal(plan.drops.length, 0, 'no connector board on plaster');
  for (const g of fronts) assert.ok(Math.abs(g.length - 24) < 0.05, `the front strip runs the cabinet width to the hood (${g.length.toFixed(2)})`);
});
