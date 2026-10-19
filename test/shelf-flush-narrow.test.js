// shelf-flush-narrow.test.js — her share zgesvvj (2026-10-19, "i used to be able to pull these open shelves
// flush... i want them level with the tall cabinet"). Since shelves are one depth (2026-10-14), a 24.5"
// shelf pulled forward to the tall's face ran into the W9's 10" return on the back wall and was refused.
// Her call: it stays 14" deep and is cut to the gap between the corner unit and the tall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};
const { Store } = await import('../src/core/store.js');
const { snapPosition } = await import('../src/interaction/snapping.js');
const { getCab } = await import('../src/core/catalogue.js');

const W = 118.9, D = 86.2, b = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
function kitchen() {
  const store = new Store(); store.setRoom({ width: W, depth: D, height: 95.3 });
  const t1 = store.addItem('T1', { x: -46.02, z: -6.85, rotDeg: 90 });
  store.addItem('W9', { x: -19.47, z: -35.85, rotDeg: 0 });
  const sh = store.addItem('W25:w24.5', { x: -52.2, z: -30.97, rotDeg: 90 });
  return { store, t1, sh };
}

test('a shelf pulled flush with the tall is cut to the gap between the corner return and the tall', () => {
  const { store, sh } = kitchen();
  const r = snapPosition(store, sh.id, -41, -30.97, b);
  assert.equal(r.flag, undefined, `not refused (${r.flag})`);
  assert.ok(r.narrowed, 'narrowed');
  const c = getCab(r.code);
  assert.equal(c.d, 14, 'still one depth');
  assert.ok(Math.abs(r.x + c.d / 2 - (-46.02 + 12)) < 0.01, `front level with the tall's front (${r.x})`);
  assert.ok(Math.abs(r.z + c.w / 2 - (-6.85 - 12)) < 0.01, 'butted to the tall');
  assert.ok(r.z - c.w / 2 >= -35.85 + 7 - 0.01, 'clear of the corner unit\'s return');
  assert.equal(c.w, 10, `cut to the 10" gap: the standard W25 (${c.w})`);
});

test('pushed back to the wall it keeps its own width; a typed width is never cut', () => {
  const { store, sh } = kitchen();
  const back = snapPosition(store, sh.id, -52, -30.97, b);
  assert.equal(back.narrowed, undefined); assert.equal(back.flag, undefined);
  store.updateItem(sh.id, { fixedWidth: true });
  const r = snapPosition(store, sh.id, -41, -30.97, b);
  assert.equal(r.narrowed, undefined, 'a pinned width is not cut');
});

test('mid-drag, snapped at its wide code it narrows again and comes back to full width at the wall', () => {
  const { store, sh } = kitchen();
  store.swapItem(sh.id, 'W25:w10');
  const r = snapPosition(store, sh.id, -52, -30.97, b, { wideCode: 'W25:w24.5' });
  assert.equal(r.flag, undefined); assert.equal(r.narrowed, undefined, 'full width fits at the wall');
  const f = snapPosition(store, sh.id, -41, -30.97, b, { wideCode: 'W25:w24.5' });
  assert.ok(f.narrowed);
});

// her next ask the same day ("i need it to be aligned where the corner cabinet ends"): a snap point with
// the shelf's front on the END of the corner unit's blank return, full width, right back to the corner
test('a shelf pulled to the end of the corner unit\'s return lands there at its full width', () => {
  const { store, sh } = kitchen();
  const endX = -19.47 - 10 - 14.25;                                 // W9 body 20", return DRAWN 14.25" toward the left wall
  for (const px of [-52.2, -51, -49]) {
    const r = snapPosition(store, sh.id, px, -30.97, b);
    assert.equal(r.flag, undefined, `not refused (${r.flag})`);
    assert.equal(r.narrowed, undefined, 'keeps its 24.5"');
    assert.ok(Math.abs(r.x + 7 - endX) < 0.01, `front on the return's end (${r.x + 7} vs ${endX})`);
    assert.equal(r.rotDeg, 90, 'still on its own wall');
  }
});

// ...and the 4.5" filler that stood INSIDE the W9's blank return (the speckle in her screenshot): a run's
// end is measured from its outer box, the return included, so no filler there
test('no end filler inside a corner unit\'s blank return', async () => {
  const { computeFillers } = await import('../src/core/fillers.js');
  const { store } = kitchen();
  const inside = computeFillers(store.state).filter((f) => f.band !== 'floor' && Math.abs(f.z - (-35.85)) < 1 && f.x > -40 && f.x < -29);
  assert.equal(inside.length, 0, JSON.stringify(inside));
});
