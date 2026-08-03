// threeD-fixes.test.js — regressions for the four client-reported 3D bugs:
//   1. corner cabinet: the drawn blank return reaches the adjacent wall
//      (sized from the actual distance, at any rotation) — never clipped,
//      never leaving the corner open
//   2. worktops: where two perpendicular runs meet at an L/U corner the slabs
//      JOIN so the surface is continuous into the room corner (no wedge), and
//      the corner cabinet's blank return is covered
//   3. cornice: continuous over a tall scribe filler at a wall end (the crown
//      runs OVER the filler to the wall) and caps a tall standing beside a
//      range appliance
//   4. counter-standing cabinets never float just off a wall — generator pass
//      and drag snapping both pull them back to touch
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};

const { getCab } = await import('../src/core/catalogue.js');
const { Store } = await import('../src/core/store.js');
const { snapPosition, cornerReturnLength } = await import('../src/interaction/snapping.js');
const { planWorktopSlabs } = await import('../src/core/worktop-plan.js');
const { planCornice } = await import('../src/core/cornice.js');
const { computeFillers } = await import('../src/core/fillers.js');
const { Wizard } = await import('../src/ui/wizard.js');

const room = { width: 200, depth: 140, height: 96, openings: [] };
const bounds = (rm) => ({ minX: -rm.width / 2, maxX: rm.width / 2, minZ: -rm.depth / 2, maxZ: rm.depth / 2 });
const minX = -room.width / 2, maxX = room.width / 2, minZ = -room.depth / 2, maxZ = room.depth / 2;

// ---- 1. corner cabinet drawn return -----------------------------------------

test('corner return is sized from the ACTUAL distance to the adjacent wall', () => {
  const f16 = getCab('F16');
  // exactly at the corner: body 20" in, return spans the full 20"
  let len = cornerReturnLength(f16, { x: minX + 20 + 12, z: minZ + 12.25, rotDeg: 0 }, room);
  assert.ok(Math.abs(len - 20) < 0.01, `flush corner → 20", got ${len}`);
  // a 4" scribe gap: the drawn return stretches 24" so it still MEETS the wall
  len = cornerReturnLength(f16, { x: minX + 24 + 12, z: minZ + 12.25, rotDeg: 0 }, room);
  assert.ok(Math.abs(len - 24) < 0.01, `4" scribe → 24" drawn return, got ${len}`);
  // room shrunk under the return (wall 15" away): the panel SHRINKS — never
  // pokes through / gets clipped by the wall
  len = cornerReturnLength(f16, { x: minX + 15 + 12, z: minZ + 12.25, rotDeg: 0 }, room);
  assert.ok(Math.abs(len - 15) < 0.01, `15" to wall → 15" drawn return, got ${len}`);
  // far from any corner: fall back to the SKU's 20"
  len = cornerReturnLength(f16, { x: 0, z: minZ + 12.25, rotDeg: 0 }, room);
  assert.ok(Math.abs(len - 20) < 0.01, `mid-wall → SKU 20", got ${len}`);
});

test('corner return meets the wall at every rotation / both hands', () => {
  const cases = [
    // [code, rotDeg, item pos with a 3" scribe gap, which wall the return must reach]
    ['F16', 0, { x: minX + 23 + 12, z: minZ + 12.25 }, 'left'],   // back wall, blank left
    ['F16R', 0, { x: maxX - 23 - 12, z: minZ + 12.25 }, 'right'], // back wall, blank right
    ['F16', 90, { x: minX + 12.25, z: maxZ - 23 - 12 }, 'front'], // left wall, return → front
    ['F16R', 270, { x: maxX - 12.25, z: maxZ - 23 - 12 }, 'front'],// right wall, blank right → front
    ['W9', 0, { x: minX + 13 + 10, z: minZ + 7.25 }, 'left'],     // wall corner, 10" return + 3" scribe
  ];
  for (const [code, rotDeg, pos, wallName] of cases) {
    const cab = getCab(code);
    const len = cornerReturnLength(cab, { ...pos, rotDeg }, room);
    // return tip = door edge + len along the return direction → must land ON the wall
    const dir = cab.cornerSide === 'right' ? 1 : -1;
    const rad = rotDeg * Math.PI / 180;
    const ux = dir * Math.cos(rad), uz = -dir * Math.sin(rad);
    const tipX = pos.x + ux * (cab.w / 2 + len), tipZ = pos.z + uz * (cab.w / 2 + len);
    const dist = wallName === 'left' ? Math.abs(tipX - minX)
      : wallName === 'right' ? Math.abs(tipX - maxX)
      : wallName === 'back' ? Math.abs(tipZ - minZ) : Math.abs(tipZ - maxZ);
    assert.ok(dist < 0.01, `${code} rot=${rotDeg}: return tip ${dist.toFixed(2)}" off the ${wallName} wall`);
  }
});

// ---- 2. worktop into corners --------------------------------------------------

const covered = (slabs, x, z) => slabs.some((s) => x >= s.x0 - 0.01 && x <= s.x1 + 0.01 && z >= s.z0 - 0.01 && z <= s.z1 + 0.01);
function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const d = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return Math.max(0, w) * Math.max(0, d);
}

test('worktop: perpendicular runs JOIN at the room corner — no missing wedge, no overlap', () => {
  // back run stops 24" short of the left wall; side run starts 25" from the
  // back wall — the classic empty corner square that used to show a notch
  const items = [
    { id: 1, code: 'F18', x: minX + 24 + 12, z: minZ + 12.25, rotDeg: 0 },
    { id: 2, code: 'F18', x: minX + 48 + 12, z: minZ + 12.25, rotDeg: 0 },
    { id: 3, code: 'F18', x: minX + 12.25, z: minZ + 25 + 12, rotDeg: 90 },
    { id: 4, code: 'F18', x: minX + 12.25, z: minZ + 49 + 12, rotDeg: 90 },
  ];
  const slabs = planWorktopSlabs(items, getCab, 'marble', room);
  assert.equal(slabs.length, 2, 'two perpendicular clusters');
  // the corner square (against both walls) must be covered
  for (const [x, z] of [[minX + 2, minZ + 2], [minX + 12, minZ + 12], [minX + 22, minZ + 2], [minX + 2, minZ + 22]]) {
    assert.ok(covered(slabs, x, z), `corner point (${(x - minX).toFixed(0)}, ${(z - minZ).toFixed(0)}) uncovered`);
  }
  // and the whole front edge of the corner is continuous (no wedge mid-way)
  for (let z = minZ; z <= minZ + 24; z += 3) assert.ok(covered(slabs, minX + 10, z), `gap at z=${(z - minZ).toFixed(0)}`);
  // slabs butt — they never overlap (that would z-fight at the surface)
  assert.ok(overlapArea(slabs[0], slabs[1]) < 0.05, 'slabs must butt, not overlap');
});

test('worktop: covers the corner cabinet blank return and turns the corner (L with F16)', () => {
  const items = [
    { id: 1, code: 'F16', x: minX + 20 + 12, z: minZ + 12.25, rotDeg: 0 },   // corner, return → left wall
    { id: 2, code: 'F18', x: minX + 44 + 12, z: minZ + 12.25, rotDeg: 0 },
    { id: 3, code: 'F18', x: minX + 12.25, z: minZ + 25 + 12, rotDeg: 90 },  // side leg
  ];
  const slabs = planWorktopSlabs(items, getCab, 'marble', room);
  // over the blank return (x 0..20 from the left wall) and into the corner
  for (const [x, z] of [[minX + 5, minZ + 5], [minX + 15, minZ + 20], [minX + 10, minZ + 30]]) {
    assert.ok(covered(slabs, x, z), `return/corner point (${(x - minX).toFixed(0)}, ${(z - minZ).toFixed(0)}) uncovered`);
  }
  for (let i = 0; i < slabs.length; i++) for (let j = i + 1; j < slabs.length; j++) {
    assert.ok(overlapArea(slabs[i], slabs[j]) < 0.05, 'slabs must butt, not overlap');
  }
});

test('worktop: U-shape — BOTH corners filled', () => {
  const items = [
    { id: 1, code: 'F16', x: minX + 20 + 12, z: minZ + 12.25, rotDeg: 0 },
    { id: 2, code: 'F20', x: 0, z: minZ + 12.25, rotDeg: 0 },
    { id: 3, code: 'F16R', x: maxX - 20 - 12, z: minZ + 12.25, rotDeg: 0 },
    { id: 4, code: 'F18', x: minX + 12.25, z: minZ + 25 + 12, rotDeg: 90 },
    { id: 5, code: 'F18', x: maxX - 12.25, z: minZ + 25 + 12, rotDeg: 270 },
  ];
  const slabs = planWorktopSlabs(items, getCab, 'marble', room);
  for (const [x, z] of [[minX + 3, minZ + 3], [maxX - 3, minZ + 3], [minX + 3, minZ + 22], [maxX - 3, minZ + 22]]) {
    assert.ok(covered(slabs, x, z), `U corner point (${x.toFixed(0)}, ${z.toFixed(0)}) uncovered`);
  }
  for (let i = 0; i < slabs.length; i++) for (let j = i + 1; j < slabs.length; j++) {
    assert.ok(overlapArea(slabs[i], slabs[j]) < 0.05, 'slabs must butt, not overlap');
  }
});

// ---- 3. cornice over fillers / beside a range --------------------------------

test('cornice: crown runs OVER a tall scribe filler to the wall (no gap)', () => {
  const TALL_PROUD = 30 / 25.4;
  const tallZ = minZ + 12 + 0.25 + TALL_PROUD;
  const state = {
    room: { ...room, cornice: 'plain' },
    items: [
      { id: 1, code: 'T1', x: minX + 3 + 12, z: tallZ, rotDeg: 0 },              // tall, 3" from the left wall
      { id: 2, code: 'F18', x: minX + 3 + 24 + 12, z: minZ + 12.25, rotDeg: 0 }, // base beside it
    ],
  };
  const fillers = computeFillers(state);
  assert.equal(fillers.length, 1, 'setup: one 3" tall filler at the wall end');
  const { segments } = planCornice(state);
  const tallTop = segments.filter((s) => Math.abs(s.topY - 86) < 0.01 && Math.abs(s.angle) < 0.01);
  // front cornice must be CONTINUOUS from the left wall to the tall's far edge
  const covered = (x) => tallTop.some((s) => x >= s.x - s.length / 2 - 0.01 && x <= s.x + s.length / 2 + 0.01);
  for (let x = minX + 0.5; x <= minX + 26; x += 0.5) {
    assert.ok(covered(x), `cornice gap over the filler/tall at ${(x - minX).toFixed(1)}" from the wall`);
  }
});

test('cornice: a tall beside a range is capped — front AND flank carry the crown', () => {
  const TALL_PROUD = 30 / 25.4;
  const tallZ = minZ + 12 + 0.25 + TALL_PROUD;
  const state = {
    room: { ...room, cornice: 'plain' },
    items: [
      { id: 1, code: 'T1', x: minX + 12, z: tallZ, rotDeg: 0 },       // tall hard in the corner
      { id: 2, code: 'AP1', x: minX + 24 + 15, z: minZ + 12.25, rotDeg: 0 }, // range beside it
    ],
  };
  const { segments, corners } = planCornice(state);
  const front = segments.find((s) => Math.abs(s.topY - 86) < 0.01 && Math.abs(s.angle) < 0.01 && Math.abs(s.length - 24) < 0.01);
  assert.ok(front, 'tall front face carries the crown');
  const flank = segments.find((s) => Math.abs(s.topY - 86) < 0.01 && Math.abs(Math.abs(s.angle) - Math.PI / 2) < 0.01);
  assert.ok(flank, 'tall flank above the range carries the crown');
  assert.ok(corners.length >= 1, 'front↔flank corner gets a mitre return (clean cap)');
});

test('fillers: right-wall and front-wall run ends now scribe too (U right leg)', () => {
  const state = {
    room,
    items: [
      { id: 1, code: 'T1', x: maxX - 12.25, z: maxZ - 3 - 12, rotDeg: 270 },  // right leg, 3" shy of the front wall
      { id: 2, code: 'F18', x: 0, z: maxZ - 12.25, rotDeg: 180 },             // front run, big end gaps → none
    ],
  };
  const fs = computeFillers(state);
  const rightFiller = fs.find((f) => (f.rotDeg % 180) === 90 && Math.abs(f.w - 3) < 0.01 && f.h === 86);
  assert.ok(rightFiller, 'tall filler on the right wall at the front end');
});

// ---- 4. counter cabinets never float ------------------------------------------

test('drag snap: a counter dresser butted to a tall stays ON the wall (no front-align float)', () => {
  const store = new Store();
  store.setRoom({ width: 200, depth: 140, height: 96 });
  const b = bounds(store.state.room);
  const TALL_PROUD = 30 / 25.4;
  store.addItem('T1', { x: b.minX + 12, z: b.minZ + 12.25 + TALL_PROUD, rotDeg: 0 });
  const c3 = store.addItem('C3', { x: b.minX + 24 + 18, z: b.minZ + 7.25, rotDeg: 0 });
  // drag it right up against the tall
  const s = snapPosition(store, c3.id, b.minX + 24 + 18, b.minZ + 8, b);
  const wallZ = b.minZ + getCab('C3').d / 2 + 0.25;
  assert.ok(Math.abs(s.z - wallZ) < 0.35, `counter back must touch the wall — z=${(s.z - b.minZ).toFixed(2)} vs ${(wallZ - b.minZ).toFixed(2)}`);
  assert.ok(Math.abs(s.x - (b.minX + 24 + 18)) < 9.1, 'still butts along the run');
});

test('generator pass: _groundCounters pulls a floating counter back to the wall (≤4"), leaves big gaps alone', () => {
  const store = new Store();
  store.setRoom({ width: 200, depth: 140, height: 96 });
  const wiz = new Wizard({ store, controls: { layer: { select() {} }, placeNew() { return null; } }, onBuilt() {}, onSave() {} });
  const b = bounds(store.state.room);
  const d = getCab('C1').d;
  const float = store.addItem('C1', { x: 0, z: b.minZ + d / 2 + 3, rotDeg: 0 });          // 3" off the back wall
  const far = store.addItem('C1', { x: 30, z: b.minZ + d / 2 + 8, rotDeg: 0 });           // 8" off — deliberate
  const side = store.addItem('C1', { x: b.minX + d / 2 + 2.5, z: 0, rotDeg: 90 });        // 2.5" off the left wall
  wiz._groundCounters();
  assert.ok(Math.abs(store.getItem(float.id).z - (b.minZ + d / 2 + 0.25)) < 0.01, 'back-wall counter pulled to touch');
  assert.ok(Math.abs(store.getItem(side.id).x - (b.minX + d / 2 + 0.25)) < 0.01, 'left-wall counter pulled to touch');
  assert.ok(Math.abs(store.getItem(far.id).z - (b.minZ + d / 2 + 8)) < 0.01, 'an 8" gap is a design choice — untouched');
});

test('wizard end-to-end: every generated COUNTER back sits within 0.35" of its wall', () => {
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
  for (const shape of ['straight', 'l-shape', 'u-shape']) {
    for (let seed = 1; seed <= 10; seed++) {
      const store = new Store();
      store.setRoom({ width: 220, depth: 150, height: 96 });
      const wiz = new Wizard({ store, controls: cursorsControls(store), onBuilt() {}, onSave() {} });
      wiz.lastShape = shape; wiz.seed = seed;
      wiz._generate(null);
      const rm = store.state.room;
      for (const it of store.state.items) {
        const c = getCab(it.code);
        if (!c || c.type !== 'COUNTER') continue;
        const rot = (((it.rotDeg || 0) % 360) + 360) % 360;
        const gap = rot === 0 ? (it.z - c.d / 2) + rm.depth / 2
          : rot === 180 ? rm.depth / 2 - (it.z + c.d / 2)
          : rot === 90 ? (it.x - c.d / 2) + rm.width / 2
          : rm.width / 2 - (it.x + c.d / 2);
        assert.ok(gap <= 0.35, `${shape} seed=${seed}: ${it.code} floats ${gap.toFixed(2)}" off its wall`);
      }
    }
  }
});

// ---- worktop over the STRETCHED corner return ---------------------------------
// The drawn blank return grows past the 20" SKU to close scribe gaps up to
// ~10" (cornerReturnLength). The worktop must cover the STRETCHED panel too —
// covering only the SKU 20" leaves a strip of bare carcass top at the corner.
test('worktop covers the stretched corner return all the way to the wall', () => {
  const cover = (slabs, x, z) => slabs.some((s) => x >= s.x0 - 0.01 && x <= s.x1 + 0.01 && z >= s.z0 - 0.01 && z <= s.z1 + 0.01);
  // 6" scribe gap: F16 door starts 26" in from the left wall → drawn return 26"
  const items = [
    { id: 1, code: 'F16', x: minX + 26 + 12, z: minZ + 12.25, rotDeg: 0 },
    { id: 2, code: 'F2', x: minX + 26 + 24 + 12, z: minZ + 12.25, rotDeg: 0 },
  ];
  const slabs = planWorktopSlabs(items, getCab, 'marble', room);
  for (const off of [1, 3, 5.5, 12, 25]) {
    assert.ok(cover(slabs, minX + off, minZ + 12),
      `worktop must cover the stretched return ${off}" off the left wall`);
  }
  // flush corner (no gap) is unchanged: covered from the wall in
  const flush = planWorktopSlabs([{ id: 1, code: 'F16', x: minX + 20 + 12, z: minZ + 12.25, rotDeg: 0 }], getCab, 'marble', room);
  assert.ok(cover(flush, minX + 1, minZ + 12), 'flush corner covered at the wall');
  // and far from any wall the SKU 20" still applies — no runaway stretch
  const mid = planWorktopSlabs([{ id: 1, code: 'F16', x: 0, z: minZ + 12.25, rotDeg: 0 }], getCab, 'marble', room);
  assert.ok(cover(mid, -12 - 19, minZ + 12), 'mid-wall: SKU return covered');
  assert.ok(!cover(mid, -12 - 45, minZ + 12), 'mid-wall: no runaway stretch');
});

// ---- counter stops at the tall leg --------------------------------------------
// A slab end that butts a TALL cabinet stops dead at the tall's face — the 1"
// side overhang belongs to OPEN run ends only, never riding past a tall.
test('worktop stops at a butting tall; open ends keep their 1" overhang', () => {
  const run = [
    { id: 1, code: 'F18', x: -12, z: minZ + 12.25, rotDeg: 0 },
    { id: 2, code: 'F18', x: 12, z: minZ + 12.25, rotDeg: 0 },
  ];
  // open both ends: 1" overhang each side
  let slab = planWorktopSlabs(run, getCab, 'marble', room)[0];
  assert.ok(Math.abs(slab.x0 - (-24 - 1)) < 0.05, `open left end overhangs 1", got ${slab.x0}`);
  assert.ok(Math.abs(slab.x1 - (24 + 1)) < 0.05, `open right end overhangs 1", got ${slab.x1}`);
  // tall butted on the right: the counter stops AT the tall's face
  const tall = { id: 3, code: 'T1', x: 24 + 12, z: minZ + 12.25, rotDeg: 0 };
  slab = planWorktopSlabs([...run, tall], getCab, 'marble', room).find((s) => s.x0 < 0);
  assert.ok(Math.abs(slab.x1 - 24) < 0.05, `counter must stop at the tall leg (x=24), got ${slab.x1}`);
  assert.ok(Math.abs(slab.x0 - (-24 - 1)) < 0.05, 'open left end keeps its overhang');
});
