// shelfdepth.test.js — an open wall shelf is ONE depth (her call 2026-10-14, "they are only one
// DEPTH"): a drag never deepens it. Every wall and counter cabinet in the catalogue is 14" deep
// except the hood cover and the stackers that ride on talls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};
const { Store } = await import('../src/core/store.js');
const { snapPosition } = await import('../src/interaction/snapping.js');
const { CATALOGUE } = await import('../src/core/catalogue.js');

const W = 200, D = 150, bounds = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };

test('an open shelf is ONE depth: carried or dragged forward it never deepens, it goes back to the wall (her call 2026-10-14)', () => {
  const store = new Store(); store.setRoom({ width: W, depth: D, height: 96 });
  const sh = store.addItem('W23', { x: 0, z: -D / 2 + 7.25, rotDeg: 0 });
  for (const r of [snapPosition(store, sh.id, 10, -D / 2 + 20, bounds), snapPosition(store, sh.id, 10, -D / 2 + 40, bounds)]) {
    assert.equal(r.depth, undefined, 'no depth change on any drag');
    assert.equal(r.flag, undefined);
    assert.ok(Math.abs(r.z - (-D / 2 + 7.25)) < 0.01, 'back on the wall at its own 14"');
  }
});

test('every wall and counter cabinet is 14" deep (hood cover and tall-riding stackers excepted)', () => {
  for (const c of CATALOGUE) {
    if (!(c.type === 'WALL' || c.type === 'COUNTER') || !c.placeable) continue;
    if (c.hoodCover || c.onTall) continue;
    assert.equal(c.d, 14, `${c.code} ${c.desc} is ${c.d}" deep`);
  }
});
