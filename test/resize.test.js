// Range cooker resize: pick a size on a placed range and the run makes room.
// Hard rule 1 (nothing overlaps, ever) is swept across filled walls, corners,
// room widths and every size change, growing and shrinking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { getCab } from '../src/core/catalogue.js';
import { planWallInfill } from '../src/core/templates.js';
import { planRangeResize, rangeSizes } from '../src/core/resize.js';

const box = (it) => { const c = getCab(it.code); const ret = c.corner ? 20 : 0, lR = (c.corner && c.cornerSide !== 'right') ? ret : 0, rR = (c.corner && c.cornerSide === 'right') ? ret : 0; const rad = (it.rotDeg || 0) * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [lx, lz] of [[-(c.w / 2 + lR), -c.d / 2], [c.w / 2 + rR, -c.d / 2], [c.w / 2 + rR, c.d / 2], [-(c.w / 2 + lR), c.d / 2]]) { const wx = lx * cs + lz * sn, wz = -lx * sn + lz * cs; x0 = Math.min(x0, it.x + wx); x1 = Math.max(x1, it.x + wx); z0 = Math.min(z0, it.z + wz); z1 = Math.max(z1, it.z + wz); } return { x0, x1, z0, z1 }; };
const floorItems = (st) => st.state.items.filter((i) => { const c = getCab(i.code); return c.type === 'FLOOR' || c.type === 'TALL' || (c.type === 'APPLIANCES' && (c.mountY || 0) === 0); });

function assertClean(st, label) {
  const items = floorItems(st), r = st.state.room;
  for (let i = 0; i < items.length; i++) {
    const a = box(items[i]);
    assert.ok(a.x0 >= -r.width / 2 - 0.3 && a.x1 <= r.width / 2 + 0.3 && a.z0 >= -r.depth / 2 - 0.3 && a.z1 <= r.depth / 2 + 0.3, `${label}: ${items[i].code} left the room`);
    for (let j = i + 1; j < items.length; j++) {
      const b = box(items[j]);
      const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      assert.ok(!(ix > 0.3 && iz > 0.3), `${label}: ${items[i].code} overlaps ${items[j].code} by ${ix.toFixed(2)}x${iz.toFixed(2)}`);
    }
  }
}

function apply(st, id, plan) {
  for (const r of plan.removes) st.removeItem(r.id);
  st.swapItem(id, plan.code);
  for (const s of plan.swaps) st.swapItem(s.id, s.code);
  for (const m of plan.moves) st.updateItem(m.id, { x: m.x, z: m.z });
}

function fill(st, walls) {
  for (const wall of walls) { const pl = planWallInfill(st.state, wall); for (const id of (pl.remove || [])) st.removeItem(id); for (const p of pl) st.addItem(p.code, { x: p.x, z: p.z, rotDeg: p.rotDeg }); }
}

test('a range offers 30, 36 and 48', () => {
  assert.deepEqual(rangeSizes('AP1').map((c) => c.w), [30, 36, 48]);
  assert.deepEqual(rangeSizes('F2'), []);
});

test('open wall: grows about its own centre, neighbours slide out, nothing swapped', () => {
  const st = new Store(); st.setRoom({ width: 240, depth: 140, height: 96 });
  const z = -70 + 12.25;
  const L = st.addItem('F18', { x: -27, z }), rng = st.addItem('AP1', { x: 0, z: -70 + 13.25 }), R = st.addItem('F18', { x: 27, z });
  const plan = planRangeResize(st.state, rng.id, 'AP3');
  assert.ok(plan.ok); assert.equal(plan.swaps.length, 0);
  apply(st, rng.id, plan);
  assert.equal(st.getItem(rng.id).x, 0, 'centre kept, so a hood stays centred');
  assert.equal(st.getItem(L.id).x, -36); assert.equal(st.getItem(R.id).x, 36);
  assertClean(st, 'open wall');
});

test('a gap beside the range is used up before anything moves', () => {
  const st = new Store(); st.setRoom({ width: 240, depth: 140, height: 96 });
  const z = -70 + 12.25;
  const L = st.addItem('F18', { x: -27 - 10, z }), rng = st.addItem('AP1', { x: 0, z: -70 + 13.25 });
  const plan = planRangeResize(st.state, rng.id, 'AP2');
  apply(st, rng.id, plan);
  assert.equal(st.getItem(L.id).x, -37, 'the 10" gap absorbed the 3", the cabinet stayed');
  assertClean(st, 'gap');
});

test('full wall: a neighbour drops to its narrower twin, and the sink rides with its base', () => {
  const st = new Store(); st.setRoom({ width: 126, depth: 140, height: 96 });   // 36 + 24 + 30 + 36 = 126
  const z = -70 + 12.25;
  const a = st.addItem('F10', { x: -63 + 18, z });                 // Double 36 with the sink in it
  const sink = st.addItem('AP6', { x: -63 + 18, z });
  const b = st.addItem('F18', { x: -63 + 36 + 12, z });            // Drawers 24
  const rng = st.addItem('AP1', { x: -63 + 60 + 15, z: -70 + 13.25 });
  const c = st.addItem('F20', { x: -63 + 90 + 18, z });            // Drawers 36
  const plan = planRangeResize(st.state, rng.id, 'AP2');
  assert.ok(plan.ok, plan.reason);
  apply(st, rng.id, plan);
  assert.equal(st.getItem(a.id).code, 'F10', 'the sink base is never swapped');
  assert.equal(st.getItem(sink.id).x, st.getItem(a.id).x, 'sink still centred on its base');
  const widths = [a, b, c].map((i) => getCab(st.getItem(i.id).code).w).reduce((s, w) => s + w, 0);
  assert.ok(widths <= 126 - 36 + 0.01, 'the run fits the wall again');
  assert.ok(plan.note.length > 0, 'the swap is reported');
  assertClean(st, 'full wall');
});

test('no room and nothing to narrow: refused with the shortfall, state untouched', () => {
  const st = new Store(); st.setRoom({ width: 78, depth: 140, height: 96 });    // 24 DW + 30 + 24 DW
  const z = -70 + 12.25;
  st.addItem('F7', { x: -39 + 12, z }); const rng = st.addItem('AP1', { x: 0, z: -70 + 13.25 }); st.addItem('F7', { x: 39 - 12, z });
  const before = JSON.stringify(st.state.items);
  const plan = planRangeResize(st.state, rng.id, 'AP3');
  assert.equal(plan.ok, false); assert.equal(plan.short, 18); assert.match(plan.reason, /18"/);
  assert.equal(JSON.stringify(st.state.items), before, 'planning never mutates');
});

test('a full wall and a big jump: one end cabinet comes out, never an essential, never the last landing cabinet', () => {
  const st = new Store(); st.setRoom({ width: 150, depth: 130, height: 96 });
  const rng = st.addItem('AP1', { x: 10, z: -65 + 13.25 });
  fill(st, ['back', 'left']);
  const plan = planRangeResize(st.state, rng.id, 'AP3');
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.removes.length, 1, 'exactly one cabinet comes out');
  assert.match(plan.note, /came out/);
  apply(st, rng.id, plan);
  assertClean(st, 'big jump');
  const c = getCab(st.getItem(rng.id).code), x = st.getItem(rng.id).x;
  const beside = (dir) => floorItems(st).some((o) => { const b = box(o); return getCab(o.code).type === 'FLOOR' && Math.abs((dir < 0 ? b.x1 : b.x0) - (x + dir * c.w / 2)) < 9.6 && (o.rotDeg || 0) === 0; });
  assert.ok(beside(-1) && beside(1), 'a landing cabinet still stands on both sides of the range');
});

test('shrinking closes the run back up and may widen a neighbour', () => {
  const st = new Store(); st.setRoom({ width: 240, depth: 140, height: 96 });
  const z = -70 + 12.25;
  const L = st.addItem('F19', { x: -24 - 14, z }), rng = st.addItem('AP3', { x: 0, z: -70 + 13.25 }), R = st.addItem('F19', { x: 24 + 14, z });
  const plan = planRangeResize(st.state, rng.id, 'AP1');
  assert.ok(plan.ok); apply(st, rng.id, plan);
  const l = box(st.getItem(L.id)), m = box(st.getItem(rng.id)), r = box(st.getItem(R.id));
  assert.ok(Math.abs(l.x1 - m.x0) < 0.05 && Math.abs(m.x1 - r.x0) < 0.05, 'both neighbours butt the smaller range');
  assertClean(st, 'shrink');
});

test('SWEEP: filled walls with corners, every room width, every size change, both directions: never an overlap', () => {
  let done = 0, refused = 0, skipped = 0;
  for (const walls of [['back'], ['back', 'left'], ['left', 'back'], ['back', 'right'], ['left', 'back', 'right']]) {
    for (let width = 132; width <= 252; width += 12) {
      for (const pos of [-0.2, 0, 0.25]) {
        for (const start of ['AP1', 'AP2', 'AP3']) {
          const st = new Store(); st.setRoom({ width, depth: 150, height: 96 });
          const rng = st.addItem(start, { x: Math.round(pos * width / 2), z: -75 + 13.25, rotDeg: 0 });
          fill(st, walls);
          try { assertClean(st, 'fixture'); } catch { skipped++; continue; }   // the fixture itself must be legal
          for (const target of ['AP1', 'AP2', 'AP3', 'AP1']) {
            const label = `${walls.join('>')} w=${width} pos=${pos} ${st.getItem(rng.id).code}->${target}`;
            const before = JSON.stringify(st.state.items);
            const plan = planRangeResize(st.state, rng.id, target);
            assert.equal(JSON.stringify(st.state.items), before, `${label}: planning mutated state`);
            for (const r of plan.removes || []) assert.ok(!['dishwasher', 'bin'].includes(getCab(r.code).form) && !getCab(r.code).corner, `${label}: never removes an essential`);
            if (!plan.ok) { refused++; assert.ok(plan.short > 0 && plan.reason, `${label}: refusal carries a reason`); continue; }
            apply(st, rng.id, plan);
            assert.equal(st.getItem(rng.id).code, target);
            assertClean(st, label);
            done++;
          }
        }
      }
    }
  }
  assert.ok(done > 400, `swept ${done} resizes (${refused} refused, ${skipped} fixtures skipped)`);
  console.log(`resize sweep: ${done} resizes applied, ${refused} refused, ${skipped} fixtures skipped`);
});

test('a range on the side wall resizes along z', () => {
  const st = new Store(); st.setRoom({ width: 160, depth: 200, height: 96 });
  const rng = st.addItem('AP1', { x: -80 + 13.25, z: 10, rotDeg: 90 });
  fill(st, ['left']);
  const plan = planRangeResize(st.state, rng.id, 'AP3');
  assert.ok(plan.ok, plan.reason); apply(st, rng.id, plan);
  assert.ok(plan.moves.every((m) => { const o = st.getItem(m.id); return Math.abs(o.x - m.x) < 1e-9; }));
  assertClean(st, 'side wall');
});
