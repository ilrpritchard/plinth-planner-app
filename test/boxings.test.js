// boxings.test.js — a boxing (bulkhead) is solid: the wizard, the row layout, a drag and a tap all keep out of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};
import { boxingBoxes } from '../src/core/openings.js';
import { wallFreeSpan } from '../src/core/layouts.js';
import { planRowsLayout } from '../src/core/rowlayout.js';
import { spotOk } from '../src/core/placement.js';
import { computeWarnings } from '../src/core/warnings.js';
import { getCab } from '../src/core/catalogue.js';
const { Store } = await import('../src/core/store.js');
const { Wizard } = await import('../src/ui/wizard.js');

const room = (boxings, w = 144, d = 132) => ({ width: w, depth: d, height: 96, openings: [], boxings, nextBoxing: boxings.length + 1 });
// her case: a boxed-in pipe run in the back-left corner, floor to ceiling, 30" along the back wall and 24" deep
const cornerBox = { id: 1, wall: 'back', pos: 15 / 144, w: 30, d: 24 };
const hits = (b, bb) => b.x0 < bb.x1 - 0.5 && b.x1 > bb.x0 + 0.5 && b.z0 < bb.z1 - 0.5 && b.z1 > bb.z0 + 0.5;
const aabb = (it) => { const c = getCab(it.code), horiz = ((it.rotDeg || 0) % 180) === 0; const hx = (horiz ? c.w : c.d) / 2, hz = (horiz ? c.d : c.w) / 2; return { x0: it.x - hx, x1: it.x + hx, z0: it.z - hz, z1: it.z + hz, c }; };

test('boxingBoxes: the same block the room draws', () => {
  const [b] = boxingBoxes(room([cornerBox]));
  assert.deepEqual([b.x0, b.x1, b.z0, b.z1, b.y0, b.y1], [-72, -42, -66, -42, 0, 96]);
});

test('wallFreeSpan: a boxing on the wall is cut out; one in the corner pushes the side run out by its depth', () => {
  const r = room([cornerBox]);
  const [a] = wallFreeSpan(r, 'back');
  assert.ok(a >= 30, `back run starts after the boxing, got ${a}`);
  const [s] = wallFreeSpan(r, 'left');
  assert.ok(s >= 24.3, `left run starts past the boxing's depth, got ${s}`);
});

test('the row layout stands nothing in the boxing', () => {
  const rows = [{ id: 1, code: 'F10', qty: 3 }, { id: 2, code: 'F2', qty: 1 }, { id: 3, code: 'W5', qty: 2 }];
  const { placements } = planRowsLayout(rows, room([cornerBox]));
  const [bb] = boxingBoxes(room([cornerBox]));
  for (const p of placements) assert.ok(!hits(aabb(p), bb), `${p.code} at ${p.x.toFixed(1)} stands in the boxing`);
  assert.ok(placements.length >= 5, 'the run still fits along the rest of the wall');
});

test('a tap-to-add spot inside the boxing is refused; a warning names a cabinet left in one', () => {
  const r = room([cornerBox]), st = { room: r, items: [] };
  const f = getCab('F10'), b = { minX: -72, maxX: 72, minZ: -66, maxZ: 66 };
  assert.equal(spotOk(st, f, -57, -66 + 12.25, 0, b), false, 'in the boxing');
  assert.equal(spotOk(st, f, -24, -66 + 12.25, 0, b), true, 'beside it');
  const w = computeWarnings({ room: r, items: [{ id: 1, code: 'AP1', x: -50, z: -66 + 13.25, rotDeg: 0 }] });
  assert.ok(w.some((x) => /AP1 stands in the boxing/.test(x.msg)));
});

test('her case: draft a layout with a bulkhead in the corner and nothing lands in it', () => {
  for (const [shape, seed] of [['straight', 3], ['L', 5], ['L', 8]]) {
    const store = new Store();
    store.setRoom({ width: 144, depth: 132, height: 96 });
    store.addBoxing({ wall: 'back', pos: 15 / 144, w: 30, d: 24 });
    const wiz = new Wizard({ store, controls: mkControls(store), onBuilt() {}, onSave() {} });
    wiz.lastShape = shape; wiz.seed = seed;
    wiz._generate(null);
    const [bb] = boxingBoxes(store.state.room);
    for (const it of store.state.items) { const a = aabb(it); if (!a.c) continue; assert.ok(!hits(a, bb), `${shape} seed ${seed}: ${it.code} at ${it.x.toFixed(1)},${it.z.toFixed(1)} stands in the boxing`); }
    assert.ok(store.state.items.length >= 5, `${shape} seed ${seed}: a kitchen was drafted (${store.state.items.length} items)`);
  }
});

// the wizard's minimal controls, as the other wizard tests build them, with the one thing the
// real placeNew now does for a boxing: the next cabinet on a wall starts AFTER a boxing at its start
function mkControls(store) {
  const cursors = {};
  return {
    layer: { select() {} },
    placeNew(code, wall) {
      const cab = getCab(code); if (!cab) return null;
      const rm = store.state.room;
      let cur = cursors[wall] ?? Math.max(-rm.width / 2, ...boxingBoxes(rm).filter((b) => b.wall === wall).map((b) => b.along1));
      if (cab.corner && cab.cornerSide !== 'right') cur += 20;
      const it = store.addItem(code, { x: cur + cab.w / 2, z: -rm.depth / 2 + cab.d / 2 + 0.25 + (cab.type === 'TALL' ? 1.18 : 0), rotDeg: 0 });
      cursors[wall] = cur + cab.w + (cab.corner && cab.cornerSide === 'right' ? 20 : 0);
      return it;
    },
  };
}
