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

test('the crown MITRES round the plaster hood: no return at the upper, flank strips from the upper face to the hood front, one strip across the front, mitred corners', () => {
  const store = kitchen();
  store.addItem('W2', { x: -half - 12, z: minZ + 7.25, rotDeg: 0 });
  store.addItem('W2', { x: half + 12, z: minZ + 7.25, rotDeg: 0 });
  const plan = planCornice(store.state);
  const fronts = plan.segments.filter((g) => Math.abs(Math.sin(g.angle)) < 0.01 && Math.abs(g.z - (minZ + 14.25)) < 0.5);
  assert.equal(fronts.length, 2, `two front strips, one per upper (${plan.segments.length} segments)`);
  for (const g of fronts) assert.ok(Math.abs(g.length - 24) < 0.05, `the upper's strip runs its width to the hood (${g.length.toFixed(2)})`);
  const uppersReturns = plan.segments.filter((g) => Math.abs(Math.cos(g.angle)) < 0.01 && Math.abs(g.length - 14) < 0.1);
  for (const g of uppersReturns) assert.ok(Math.abs(g.x) > half + 20, `a 14" return at x ${g.x.toFixed(1)} sits on the hood flank`);
  // round the hood at the uppers' crown line (86"): flank strips 6" long (the hood stands 20" deep, the upper 14") and the full front
  const flank = plan.segments.filter((g) => Math.abs(Math.cos(g.angle)) < 0.01 && Math.abs(Math.abs(g.x) - half) < 0.05);
  assert.equal(flank.length, 2, 'a strip on each hood flank');
  for (const g of flank) { assert.ok(Math.abs(g.length - 6) < 0.05, `flank strip ${g.length.toFixed(2)}"`); assert.equal(g.topY, 86); assert.ok(Math.abs(g.z - (minZ + 17.25)) < 0.05, `from the upper's face to the hood front (z ${g.z.toFixed(2)})`); }
  const across = plan.segments.find((g) => Math.abs(Math.sin(g.angle)) < 0.01 && Math.abs(g.z - (minZ + 20.25)) < 0.05);
  assert.ok(across && Math.abs(across.length - hoodCab.w) < 0.01 && across.topY === 86, 'the crown runs across the hood front, mitred');
  assert.equal(plan.corners.filter((c) => Math.abs(Math.abs(c.x) - half) < 0.05 && Math.abs(c.z - (minZ + 20.25)) < 0.05).length, 2, 'two mitred front corners on the hood');
  assert.equal(plan.drops.length, 0, 'no connector board on plaster');
  // one upper only: the other flank carries the crown all the way back to the wall
  const one = kitchen(); one.addItem('W2', { x: -half - 12, z: minZ + 7.25, rotDeg: 0 });
  const p1 = planCornice(one.state);
  const far = p1.segments.find((g) => Math.abs(Math.cos(g.angle)) < 0.01 && Math.abs(g.x - half) < 0.05);
  assert.ok(far && Math.abs(far.length - (hoodCab.d + 0.25)) < 0.05, `the far flank runs wall to front (${far && far.length.toFixed(2)})`);
});
