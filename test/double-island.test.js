// double-island.test.js — W2W-38 client rules:
//   1. DOUBLE-SIDED ISLAND — when the room is wide enough the generated island
//      is two rows of floor cabinets back-to-back: the working row faces the
//      run, the second row faces the other way, x-extents match, backs touch,
//      44" walkways survive on every side, the back row is storage only (no
//      sink/hob/dishwasher/bin), and the worktop covers the whole double
//      footprint as ONE slab. Tight rooms keep today's single-sided island.
//      The budget ladder's 'single-sided island' rung converts double→single.
//   2. WORKTOP NEVER OVER A RANGE — slabs still span scribe fillers and reach
//      walls, but no slab rectangle ever overlaps a freestanding appliance
//      footprint (range/fridge): the top butts the range's sides exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {}, classList: { add() {}, remove() {} } },
};

const { getCab } = await import('../src/core/catalogue.js');
const { Store } = await import('../src/core/store.js');
const { planWorktopSlabs } = await import('../src/core/worktop-plan.js');
const { planBudgetSwaps } = await import('../src/core/budget.js');
const { Wizard } = await import('../src/ui/wizard.js');

const WALK = 44;

// same deterministic placeNew harness as the wizard e2e test: back-wall steps
// butt left-to-right on the wall line; everything else the wizard places itself
const cursorsControls = (store) => {
  const cursors = {};
  return {
    layer: { select() {} },
    placeNew(code, wall) {
      const cab = getCab(code); if (!cab) return null;
      const rm = store.state.room;
      let cur = cursors[wall] ?? -rm.width / 2;
      if (cab.corner && cab.cornerSide !== 'right') cur += 20;
      const it = store.addItem(code, { x: cur + cab.w / 2, z: -rm.depth / 2 + cab.d / 2 + 0.25, rotDeg: 0 });
      cursors[wall] = cur + cab.w + (cab.corner && cab.cornerSide === 'right' ? 20 : 0);
      return it;
    },
  };
};

function buildKitchen(shape, width, depth, seed, appliances) {
  const store = new Store();
  store.setRoom({ width, depth, height: 96 });
  const wiz = new Wizard({ store, controls: cursorsControls(store), onBuilt() {}, onSave() {} });
  wiz.lastShape = shape; wiz.seed = seed;
  if (appliances) wiz.appliances = appliances;
  wiz._generate(null);
  return store;
}

const rot = (it) => (((it.rotDeg || 0) % 360) + 360) % 360;
const rectOf = (it) => {
  const c = getCab(it.code);
  const horiz = ((it.rotDeg || 0) % 180) === 0;
  const hw = (horiz ? c.w : c.d) / 2, hd = (horiz ? c.d : c.w) / 2;
  return { x0: it.x - hw, x1: it.x + hw, z0: it.z - hd, z1: it.z + hd };
};
const overlapArea = (a, b) => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const d = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return Math.max(0, w) * Math.max(0, d);
};
// deepest front face of the floor-standing run on the back wall
const backRunFace = (store) => {
  const rm = store.state.room, minZ = -rm.depth / 2;
  let face = minZ + 24.25;
  for (const it of store.state.items) {
    const c = getCab(it.code);
    if (!c) continue;
    const floorStanding = c.type === 'FLOOR' || c.type === 'TALL' || (c.type === 'APPLIANCES' && (c.mountY || 0) === 0);
    if (!floorStanding || ((it.rotDeg || 0) % 180) !== 0 || it.island) continue;
    const f = it.z + c.d / 2;
    if (f < minZ + 45) face = Math.max(face, f);
  }
  return face;
};

// ---- 1. double-sided island ------------------------------------------------

test('wide rooms: island is double-sided — back-to-back rows, 44" walkways all round, storage-only back row, ONE slab', () => {
  let doubles = 0;
  for (const [width, depth] of [[168, 168], [200, 176], [240, 192]]) {
    for (let seed = 1; seed <= 10; seed++) {
      const store = buildKitchen('island', width, depth, seed);
      const rm = store.state.room;
      const maxZ = rm.depth / 2;
      const isl = store.state.items.filter((it) => it.island);
      assert.ok(isl.length, `w=${width} d=${depth} seed=${seed}: no island generated`);
      const front = isl.filter((it) => rot(it) === 180);
      const back = isl.filter((it) => rot(it) === 0);
      const tag = `island ${width}x${depth} seed=${seed}`;
      assert.ok(front.length > 0, `${tag}: no working row`);
      assert.ok(back.length > 0, `${tag}: room is wide enough but island is single-sided`);
      doubles++;
      // back row = sensible storage only: never a sink/hob/DW/bin/appliance
      for (const it of isl) {
        const c = getCab(it.code);
        assert.ok(c.type === 'FLOOR', `${tag}: ${it.code} on the island is not a floor cabinet`);
        assert.ok(!/^AP/.test(it.code), `${tag}: appliance ${it.code} on the island`);
        assert.ok(it.code !== 'F7', `${tag}: dishwasher on the island back row`);
        assert.ok(it.code !== 'F21' && it.code !== 'F22', `${tag}: bin on the island`);
      }
      // back-to-back: same overall x-extents, backs touching, same length
      assert.equal(back.length, front.length, `${tag}: rows differ in cabinet count`);
      const ext = (row) => {
        let x0 = Infinity, x1 = -Infinity;
        for (const it of row) { const r = rectOf(it); x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); }
        return [x0, x1];
      };
      const [fx0, fx1] = ext(front), [bx0, bx1] = ext(back);
      assert.ok(Math.abs(fx0 - bx0) < 0.01 && Math.abs(fx1 - bx1) < 0.01, `${tag}: rows not aligned (${fx0},${fx1}) vs (${bx0},${bx1})`);
      const fBack = Math.max(...front.map((it) => rectOf(it).z1));
      const bFront = Math.min(...back.map((it) => rectOf(it).z0));
      assert.ok(Math.abs(fBack - bFront) < 0.01, `${tag}: rows not back-to-back (gap ${(bFront - fBack).toFixed(2)}")`);
      // 44" walkways on every side (seating bar counted on the outer side)
      const islX0 = fx0, islX1 = fx1;
      const islZ0 = Math.min(...front.map((it) => rectOf(it).z0));
      const seated = isl.some((it) => it.seating);
      const islZ1 = Math.max(...back.map((it) => rectOf(it).z1)) + (seated ? 12 : 0);
      assert.ok(islZ0 - backRunFace(store) >= WALK - 0.01, `${tag}: run-side walkway ${(islZ0 - backRunFace(store)).toFixed(1)}" < 44"`);
      assert.ok(maxZ - islZ1 >= WALK - 0.01, `${tag}: outer walkway ${(maxZ - islZ1).toFixed(1)}" < 44"`);
      assert.ok(islX0 - (-rm.width / 2) >= WALK - 0.01, `${tag}: left walkway < 44"`);
      assert.ok(rm.width / 2 - islX1 >= WALK - 0.01, `${tag}: right walkway < 44"`);
      // one continuous worktop slab covers the whole double footprint
      const slabs = planWorktopSlabs(store.state.items, getCab, 'marble', rm);
      const midX = (islX0 + islX1) / 2, midZ = fBack;
      const over = slabs.filter((s) => midX >= s.x0 && midX <= s.x1 && midZ >= s.z0 && midZ <= s.z1);
      assert.equal(over.length, 1, `${tag}: island worktop is not one slab`);
      const s = over[0];
      const bz1 = Math.max(...back.map((it) => rectOf(it).z1));
      assert.ok(s.x0 <= islX0 + 0.01 && s.x1 >= islX1 - 0.01 && s.z0 <= islZ0 + 0.01 && s.z1 >= bz1 - 0.01,
        `${tag}: slab does not cover the full double footprint`);
    }
  }
  assert.ok(doubles >= 30, `only ${doubles} double-sided islands across the wide-room sweep`);
});

test('tight rooms: island stays single-sided (unchanged), finished back panel', () => {
  for (const [width, depth] of [[144, 140], [168, 150], [160, 130]]) {
    for (let seed = 1; seed <= 10; seed++) {
      const store = buildKitchen('island', width, depth, seed);
      const isl = store.state.items.filter((it) => it.island);
      if (!isl.length) continue;                       // very tight floors may skip the island
      const tag = `island ${width}x${depth} seed=${seed}`;
      assert.ok(isl.every((it) => rot(it) === 180), `${tag}: unexpected back row in a tight room`);
      assert.ok(isl.every((it) => it.backPanel), `${tag}: single-sided island missing its finished back`);
    }
  }
});

test('budget rung: "single-sided island" converts double→single and finishes the exposed backs', () => {
  const store = buildKitchen('island', 200, 176, 3);
  const isl = store.state.items.filter((it) => it.island);
  const backIds = isl.filter((it) => rot(it) === 0).map((it) => it.id);
  const frontIds = isl.filter((it) => rot(it) === 180).map((it) => it.id);
  assert.ok(backIds.length > 0, 'setup: expected a double-sided island');
  const plan = planBudgetSwaps(store.serialize(), 1000);   // unreachably low → full ladder
  for (const id of backIds) assert.ok(plan.removals.includes(id), `back-row item ${id} not removed`);
  for (const id of frontIds) assert.ok(!plan.removals.includes(id), `front-row item ${id} wrongly removed`);
  for (const id of frontIds) {
    assert.ok(plan.patches.some((p) => p.id === id && p.patch.backPanel), `front-row item ${id} left with an unfinished back`);
  }
  assert.ok(plan.stages.includes('single-sided island'), 'ladder stage not reported');
});

// ---- 2. worktop never over a range ------------------------------------------

test('screenshot case: slab stops DEAD at the range sides, still spans the end filler to the wall', () => {
  // straight run: tall · drawers · sink · drawers · RANGE · open counter unit
  // ending 4" short of the right wall (scribe filler zone)
  const room = { width: 160, depth: 140, height: 96, openings: [] };
  const minX = -80, maxX = 80, minZ = -70;
  const items = [
    { id: 1, code: 'T1', x: minX + 12, z: minZ + 12.25, rotDeg: 0 },
    { id: 2, code: 'F18', x: minX + 24 + 12, z: minZ + 12.25, rotDeg: 0 },
    { id: 3, code: 'F2', x: minX + 48 + 12, z: minZ + 12.25, rotDeg: 0 },
    { id: 4, code: 'F18', x: minX + 72 + 12, z: minZ + 12.25, rotDeg: 0 },
    { id: 5, code: 'AP2', x: minX + 96 + 18, z: minZ + 13.25, rotDeg: 0 },   // 36" range, 26" deep
    { id: 6, code: 'F24', x: minX + 132 + 12, z: minZ + 12.25, rotDeg: 0 },  // open unit, 4" shy of the wall
  ];
  const slabs = planWorktopSlabs(items, getCab, 'marble', room);
  const range = rectOf(items[4]);
  for (const s of slabs) assert.ok(overlapArea(s, range) < 0.01, 'slab rides over the range');
  const left = slabs.find((s) => s.x0 < minX + 90 && s.x1 > minX + 80);
  const right = slabs.find((s) => s.x1 > minX + 140);
  assert.ok(left && right, 'expected a slab each side of the range');
  assert.ok(Math.abs(left.x1 - range.x0) < 0.01, `left slab must butt the range (ends at ${(left.x1 - minX).toFixed(2)}", range at ${(range.x0 - minX).toFixed(2)}")`);
  assert.ok(Math.abs(right.x0 - range.x1) < 0.01, `right slab must butt the range (starts at ${(right.x0 - minX).toFixed(2)}")`);
  assert.ok(Math.abs(right.x1 - maxX) < 0.01, 'right slab must still reach the wall over the scribe filler');
});

test('sweep: no worktop slab ever overlaps a range/freestanding-fridge footprint (5 shapes × sizes × seeds)', () => {
  const SHAPES = ['straight', 'l-shape', 'island', 'u-shape', 'galley'];
  const SIZES = [[120, 110], [144, 124], [168, 168], [200, 144], [240, 184]];
  const OPTS = [undefined, { fridge: 'freestanding' }, { cooking: 'wallOven' }];
  for (const appliances of OPTS) {
    for (const shape of SHAPES) {
      for (const [width, depth] of SIZES) {
        for (let seed = 1; seed <= 8; seed++) {
          const store = buildKitchen(shape, width, depth, seed, appliances);
          const slabs = planWorktopSlabs(store.state.items, getCab, 'marble', store.state.room);
          const blocks = store.state.items.filter((it) => {
            const c = getCab(it.code);
            return c && c.type === 'APPLIANCES' && (c.mountY || 0) === 0;
          });
          for (const b of blocks) {
            const br = rectOf(b);
            for (const s of slabs) {
              const a = overlapArea(s, br);
              assert.ok(a < 0.02,
                `${shape} ${width}x${depth} seed=${seed}${appliances ? ' ' + JSON.stringify(appliances) : ''}: slab overlaps ${b.code} by ${a.toFixed(2)} sq in`);
            }
          }
        }
      }
    }
  }
});
