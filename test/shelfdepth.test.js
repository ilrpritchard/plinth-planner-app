// shelfdepth.test.js — an open wall shelf deepens only on a deliberate drag, never while it is
// being CARRIED to its place after a tap (her screenshot 2026-09-25: a 14" full-height shelf
// arrived 24" deep beside the hood). Every wall and counter cabinet in the catalogue is 14" deep
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

test('a carried shelf keeps its 14" whatever the pointer does; a real drag forward still deepens it', () => {
  const store = new Store(); store.setRoom({ width: W, depth: D, height: 96 });
  const sh = store.addItem('W23', { x: 0, z: -D / 2 + 7.25, rotDeg: 0 });
  const carried = snapPosition(store, sh.id, 10, -D / 2 + 20, bounds, { noDeepen: true });   // pointer 20" into the room
  assert.equal(carried.depth, undefined, 'no depth change while carried');
  assert.ok(Math.abs(carried.z - (-D / 2 + 7.25)) < 0.01, 'back on the wall at 14"');
  const dragged = snapPosition(store, sh.id, 10, -D / 2 + 20, bounds);
  assert.ok(dragged.depth >= 26 && dragged.depth <= 28, `a deliberate drag deepens it to the pointer (${dragged.depth})`);
});

test('every wall and counter cabinet is 14" deep (hood cover and tall-riding stackers excepted)', () => {
  for (const c of CATALOGUE) {
    if (!(c.type === 'WALL' || c.type === 'COUNTER') || !c.placeable) continue;
    if (c.hoodCover || c.onTall) continue;
    assert.equal(c.d, 14, `${c.code} ${c.desc} is ${c.d}" deep`);
  }
});
