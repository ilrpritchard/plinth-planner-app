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

test('a cabinet already standing in a corner boxing comes OUT into the room, on a nudge and on load', async () => {
  const { snapPosition } = await import('../src/interaction/snapping.js');
  const { planClearBoxings } = await import('../src/core/roomresize.js');
  const store = new Store(); store.setRoom({ width: 120, depth: 120, height: 96 });
  store.addBoxing({ wall: 'left', pos: 0.2, w: 48, d: 30 });                 // 30" deep in the back-left corner
  const it = store.addItem('T1', { x: -48, z: -46.57, rotDeg: 0 });          // a tall standing in it
  const s = snapPosition(store, it.id, -48, -46.6, { minX: -60, maxX: 60, minZ: -60, maxZ: 60 });
  assert.ok(s.x >= -18 - 0.01, `nudged in place it butts the boxing's room side, got ${s.x}`);   // never through the wall
  const p = planClearBoxings(store.state);
  assert.equal(p.moves.length, 1); assert.ok(p.moves[0].x >= -18.01 && p.stuck.length === 0);
});

// her corner 2026-09-23 ("corner cupboard will not drag out this space, i need it next to the dishwasher
// cabinet and into the corner" / "it should still be allowed there, that can be cut in on site... but the
// planner should note that"): a bulkhead 7.1" deep x 8.7" along sits in the back-right corner. A corner unit
// may stand INTO it, body or return; the planner notes the site cut and draws no return inside the bulkhead.
test('a corner unit may be cut in round a bulkhead: allowed on either wall, noted, drawn return stops at it', async () => {
  const { Store } = await import('../src/core/store.js');
  const { snapPosition, cornerReturnLength } = await import('../src/interaction/snapping.js');
  const { computeWarnings } = await import('../src/core/warnings.js');
  const { planClearBoxings } = await import('../src/core/roomresize.js');
  const { getCab } = await import('../src/core/catalogue.js');
  const W = 118.9, D = 86.2, b = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
  const store = new Store(); store.setRoom({ width: W, depth: D, height: 95.3, openings: [], boxings: [{ id: 2, wall: 'right', pos: 0, w: 8.7, d: 7.1, h: 95.3 }] });
  store.addItem('F18', { x: 21.98, z: -30.85, rotDeg: 0 });                      // back run ends at 33.98
  store.addItem('F33', { x: 47.2, z: -18.85 + 9, rotDeg: 270 });                 // right wall, leg to leg with the back run's face
  // (1) on the RIGHT wall, blank left = return toward the back wall, through the bulkhead
  const c = store.addItem('F15', { x: 0, z: 0, rotDeg: 270 });
  const r = snapPosition(store, c.id, 47.2, -26, b);
  assert.equal(r.flag, undefined, 'allowed on the right wall');
  assert.ok(Math.abs((r.z + 10) - (-18.85)) < 0.05, `its door-side edge on the back run's face, its back end inside the bulkhead (${(r.z + 10).toFixed(2)})`);
  store.updateItem(c.id, { x: r.x, z: r.z, rotDeg: 270 });
  assert.equal(cornerReturnLength(getCab('F15'), store.getItem(c.id), store.state.room), 0, 'no return drawn inside the bulkhead');
  let w = computeWarnings(store.state).map((x) => x.msg);
  assert.ok(w.some((m) => /F15 is cut in round the boxing/.test(m)), `the planner notes the cut: ${w.join(' | ')}`);
  assert.ok(!w.some((m) => /stands in the boxing/.test(m)), 'and does not call it an error');
  assert.equal(planClearBoxings(store.state).moves.length, 0, 'load does not shove it out');
  // (2) on the BACK wall at the right end, blank right = return into the bulkhead corner, body cut in 20" wide
  store.removeItem(c.id);
  const c2 = store.addItem('F15R', { x: 0, z: 0, rotDeg: 0 });
  const r2 = snapPosition(store, c2.id, 45, -30.85, b);
  assert.equal(r2.flag, undefined, 'allowed on the back wall too');
  assert.ok(r2.x + 10 <= b.maxX + 0.01 && r2.x + 10 > 52.35, `its body reaches into the bulkhead (right edge ${(r2.x + 10).toFixed(2)})`);
  store.updateItem(c2.id, { x: r2.x, z: r2.z, rotDeg: 0 });
  w = computeWarnings(store.state).map((x) => x.msg);
  assert.ok(w.some((m) => /F15R is cut in round the boxing/.test(m)), `noted: ${w.join(' | ')}`);
});

test('a bulkhead runs to the ceiling and FOLLOWS it when the ceiling changes; a typed height is kept (her catch 2026-09-26)', async () => {
  const { Store } = await import('../src/core/store.js');
  const { boxingBoxes } = await import('../src/core/openings.js');
  const s = new Store(); s.setRoom({ width: 200, depth: 150, height: 96 });
  const b = s.addBoxing({ wall: 'back', pos: 0.3, w: 10, d: 8 });
  assert.equal(b.h, undefined, 'no frozen height');
  assert.equal(boxingBoxes(s.state.room)[0].y1, 96);
  s.setRoom({ height: 120 });
  assert.equal(boxingBoxes(s.state.room)[0].y1, 120, 'follows the raised ceiling');
  s.updateBoxing(b.id, { h: 90 });
  s.setRoom({ height: 108 });
  assert.equal(boxingBoxes(s.state.room)[0].y1, 90, 'a typed height stays');
  // an older design whose bulkhead was frozen at the old ceiling comes along too
  const o = new Store(); o.setRoom({ width: 200, depth: 150, height: 96 }); o.addBoxing({ wall: 'left', pos: 0.5, w: 8, d: 8, h: 96 });
  o.setRoom({ height: 110 });
  assert.equal(boxingBoxes(o.state.room)[0].y1, 110);
});

test('scribes to a bulkhead: a run end short of one, and both sides of one that splits a run, never a filler across it (her ask 2026-09-26)', async () => {
  const { Store } = await import('../src/core/store.js');
  const { computeFillers } = await import('../src/core/fillers.js');
  const s = new Store(); s.setRoom({ width: 200, depth: 150, height: 96 });
  // a 10" bulkhead centred at x = 0 on the back wall (x -5..5); a base 3" left of it, another 4" right of it
  s.addBoxing({ wall: 'back', pos: 0.5, w: 10, d: 8 });
  s.addItem('F2', { x: -5 - 3 - 12, z: -75 + 12.25, rotDeg: 0 });
  s.addItem('F2', { x: 5 + 4 + 12, z: -75 + 12.25, rotDeg: 0 });
  const f = computeFillers(s.state).filter((x) => x.band === 'floor').sort((a, b) => a.x - b.x);
  // the run's outer ends are far from the walls (no filler); the two bulkhead scribes are 3" and 4", 35" tall
  assert.equal(f.length, 2, `two scribes (${f.map((x) => x.w).join(',')})`);
  assert.ok(Math.abs(f[0].w - 3) < 0.01 && Math.abs(f[0].x - (-5 - 1.5)) < 0.01 && f[0].h === 35, 'left scribe to the bulkhead face');
  assert.ok(Math.abs(f[1].w - 4) < 0.01 && Math.abs(f[1].x - (5 + 2)) < 0.01 && f[1].h === 35, 'right scribe to the bulkhead face');
  // a run END 5" short of a bulkhead on a side wall
  const t = new Store(); t.setRoom({ width: 200, depth: 150, height: 96 });
  t.addBoxing({ wall: 'left', pos: 0.5, w: 10, d: 8 });                 // z -5..5
  t.addItem('F2', { x: -100 + 12.25, z: -5 - 5 - 12, rotDeg: 90 });      // ends 5" before it
  const g = computeFillers(t.state).filter((x) => x.band === 'floor');
  assert.ok(g.some((x) => Math.abs(x.w - 5) < 0.01 && Math.abs(x.z - (-5 - 2.5)) < 0.01), `a 5" scribe to the bulkhead (${JSON.stringify(g.map((x) => [x.w, x.z]))})`);
});
