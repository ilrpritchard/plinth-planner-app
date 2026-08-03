// corner-rules.test.js — "a corner cabinet can't go there": corner units
// (F15/F15R/F16/F16R, W9/W10) only make sense where two runs meet at a right
// angle. Three layers of enforcement:
//   1. DRAG rule (snapping.js): a corner unit only drops AT a room corner,
//      oriented so its blank return runs into the perpendicular wall —
//      anywhere else it stays put with flag 'corner'.
//   2. GENERATOR guarantee (layouts.js): a corner step is only emitted when
//      the perpendicular leg actually receives at least one cabinet; a room
//      too shallow for the leg degrades the L/U to a straight run.
//   3. LIVE warning (warnings.js): a placed corner unit with no perpendicular
//      run meeting its return within 6" is flagged.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};

const { generateKitchen, wallFreeSpan } = await import('../src/core/layouts.js');
const { getCab } = await import('../src/core/catalogue.js');
const { Store } = await import('../src/core/store.js');
const { Wizard } = await import('../src/ui/wizard.js');
const { snapPosition } = await import('../src/interaction/snapping.js');
const { computeWarnings } = await import('../src/core/warnings.js');

const W = (c) => getCab(c)?.w || 24;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const bounds = (rm) => ({ minX: -rm.width / 2, maxX: rm.width / 2, minZ: -rm.depth / 2, maxZ: rm.depth / 2 });
const CORNER_WARN = /corner unit has no return run meeting it/;

function mkStore(width = 240, depth = 160) {
  const store = new Store();
  store.setRoom({ width, depth, height: 96 });
  return store;
}

// ---- 1. the drag rule -------------------------------------------------------

test('drag rule: corner units snap home AT a room corner, return meeting the side wall', () => {
  const store = mkStore();
  const b = bounds(store.state.room);
  // F16 (blank LEFT) at the back-LEFT corner: return spans minX..minX+20
  const f16 = store.addItem('F16', { x: b.minX + 32, z: b.minZ + 12.25, rotDeg: 0 });
  let s = snapPosition(store, f16.id, b.minX + 30, b.minZ + 13, b);
  assert.equal(s.flag, undefined, 'F16 at the back-left corner must be allowed');
  assert.ok(Math.abs(s.x - (b.minX + 32)) < 0.5, `body clamps 32" in (return to the wall), got ${s.x - b.minX}`);
  assert.ok(Math.abs(s.z - (b.minZ + 12.25)) < 0.5, 'back against the back wall');
  // F16R (blank RIGHT) mirrors into the back-RIGHT corner
  const f16r = store.addItem('F16R', { x: b.maxX - 32, z: b.minZ + 12.25, rotDeg: 0 });
  s = snapPosition(store, f16r.id, b.maxX - 30, b.minZ + 13, b);
  assert.equal(s.flag, undefined, 'F16R at the back-right corner must be allowed');
  assert.ok(Math.abs(s.x - (b.maxX - 32)) < 0.5);
  // F16 rotated 90 on the LEFT wall: return runs to the FRONT wall → front-left corner
  const f16b = store.addItem('F16', { x: b.minX + 12.25, z: b.maxZ - 32, rotDeg: 90 });
  s = snapPosition(store, f16b.id, b.minX + 13, b.maxZ - 30, b);
  assert.equal(s.flag, undefined, 'rotated F16 in the front-left corner must be allowed');
  // W9 wall-corner unit (10" return) at the back-left, above the F16
  const w9 = store.addItem('W9', { x: b.minX + 20, z: b.minZ + 7.25, rotDeg: 0 });
  s = snapPosition(store, w9.id, b.minX + 19, b.minZ + 8, b);
  assert.equal(s.flag, undefined, 'W9 wall corner at the room corner must be allowed');
});

test('drag rule: anywhere that is not a right-angle corner is rejected (flag corner, stays put)', () => {
  const store = mkStore();
  const b = bounds(store.state.room);
  const home = { x: b.minX + 32, z: b.minZ + 12.25 };
  const it = store.addItem('F16', { ...home, rotDeg: 0 });
  // mid-run on the back wall — the owner's screenshot case
  let s = snapPosition(store, it.id, 0, b.minZ + 13, b);
  assert.equal(s.flag, 'corner', 'mid-wall drop must be rejected');
  assert.ok(Math.abs(s.x - home.x) < 0.01 && Math.abs(s.z - home.z) < 0.01, 'must stay put');
  // WRONG-handed: F16 (blank left) at the back-RIGHT corner — return points at nothing
  s = snapPosition(store, it.id, b.maxX - 12, b.minZ + 13, b);
  assert.equal(s.flag, 'corner', 'wrong-handed corner must be rejected');
  assert.ok(Math.abs(s.x - home.x) < 0.01 && Math.abs(s.z - home.z) < 0.01);
  // open floor — no wall at its back at all
  s = snapPosition(store, it.id, 0, 0, b);
  assert.equal(s.flag, 'corner', 'free-floating corner unit must be rejected');
  // wall corner units obey the same rule
  const w9 = store.addItem('W9', { x: b.minX + 20, z: b.minZ + 7.25, rotDeg: 0 });
  s = snapPosition(store, w9.id, 10, b.minZ + 8, b);
  assert.equal(s.flag, 'corner', 'W9 mid-wall must be rejected');
  assert.ok(Math.abs(s.x - (b.minX + 20)) < 0.01);
});

// ---- 2. the generator guarantee ----------------------------------------------

test('generator sweep (depths 30–60): corner steps only when the leg receives a cabinet', () => {
  for (const shape of ['l-shape', 'u-shape']) {
    for (let width = 96; width <= 288; width += 24) {
      for (let depth = 30; depth <= 60; depth += 2) {
        for (const seed of SEEDS) {
          const room = { width, depth };
          const { steps } = generateKitchen(shape, room, seed);
          const tag = `${shape} ${width}×${depth} seed=${seed}`;
          const corners = steps.filter((st) => st.corner);
          const [lA, lB] = wallFreeSpan(room, 'left');
          if (lB - lA < 24) {
            assert.equal(corners.length, 0, `${tag}: orphan corner in a room too shallow for the leg`);
            assert.ok(!steps.some((st) => st.wall === 'left'), `${tag}: stray side-leg cabinet on a degraded run`);
          }
          for (const c of corners) {
            const leg = c.code === 'F16R' ? 'right' : 'left';
            assert.ok(steps.some((st) => st.wall === leg), `${tag}: ${c.code} emitted but the ${leg} leg is empty`);
          }
          // and the essentials still never overshoot the wall
          const used = steps.filter((st) => st.wall === 'back')
            .reduce((t, o) => t + W(o.code) + (o.corner ? 20 : 0), 0);
          assert.ok(used <= width + 0.1, `${tag}: back run ${used}" overshoots ${width}"`);
        }
      }
    }
  }
});

test('generator: a door across the side leg kills the corner (degrades to straight)', () => {
  const room = { width: 200, depth: 60, openings: [{ id: 1, type: 'doorway', wall: 'left', pos: 0.5, width: 34 }] };
  assert.ok(wallFreeSpan(room, 'left')[1] - wallFreeSpan(room, 'left')[0] < 24, 'setup: door must break the leg span');
  for (const seed of SEEDS) {
    const { steps } = generateKitchen('l-shape', room, seed);
    assert.ok(!steps.some((st) => st.corner), `seed=${seed}: corner emitted with the leg blocked by a door`);
    assert.ok(!steps.some((st) => st.wall === 'left'), `seed=${seed}: cabinets placed across the doorway leg`);
    // degraded to straight: the fridge rejoins the back run
    assert.ok(steps.some((st) => st.code === 'T3'), `seed=${seed}: fridge lost in the degrade`);
  }
});

// ---- wizard end-to-end: programmatic corner placement passes the drag rule ----

function mkControls(store) {
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
}
function buildKitchen(shape, w, d, seed) {
  const store = new Store();
  store.setRoom({ width: w, depth: d, height: 96 });
  const wiz = new Wizard({ store, controls: mkControls(store), onBuilt() {}, onSave() {} });
  wiz.lastShape = shape; wiz.seed = seed;
  wiz._generate(null);
  return store;
}

test('wizard end-to-end: generated L/U corners sit at the wall junction and pass the drag rule', () => {
  for (const [shape, w, d, n] of [['l-shape', 240, 160, 1], ['u-shape', 260, 180, 2]]) {
    for (const seed of [1, 4, 7]) {
      const store = buildKitchen(shape, w, d, seed);
      const tag = `${shape} seed=${seed}`;
      const corners = store.state.items.filter((it) => getCab(it.code)?.corner);
      assert.equal(corners.length, n, `${tag}: expected ${n} corner unit(s)`);
      const b = bounds(store.state.room);
      for (const it of corners) {
        const s = snapPosition(store, it.id, it.x, it.z, b);
        assert.notEqual(s.flag, 'corner', `${tag}: wizard-placed ${it.code} fails the corner rule`);
        assert.ok(Math.abs(s.x - it.x) < 5 && Math.abs(s.z - it.z) < 5, `${tag}: ${it.code} shifted on re-snap`);
      }
      // …and the live warning stays quiet: each corner's return run meets it
      const warns = computeWarnings(store.state).filter((wn) => CORNER_WARN.test(wn.msg));
      assert.equal(warns.length, 0, `${tag}: ${warns[0]?.msg}`);

      // LEG-TO-LEG (client spec): the corner unit's BODY starts exactly where
      // the perpendicular run's boxes end — 24" (+0.25 scribe) from the side
      // wall — so the two front frames meet 22mm leg to 22mm leg and the full
      // door stile shows. The blank return hides behind the side run.
      for (const it of corners) {
        const cab = getCab(it.code);
        const bodyEdge = cab.cornerSide === 'right'
          ? b.maxX - (it.x + cab.w / 2)              // gap: body -> right wall
          : (it.x - cab.w / 2) - b.minX;             // gap: body -> left wall
        // EVERY corner sits exactly leg-to-leg AGAINST ITS LEG'S BOXES. A
        // U-shape's sliver may pull the right leg off its wall (deeper
        // worktop hides it), so measure to the leg, not the wall.
        const legItems = store.state.items.filter((x) => {
          const c = getCab(x.code);
          if (!c || c.type !== 'FLOOR') return false;   // talls stand 30mm proud — measure base boxes
          const rot = ((x.rotDeg || 0) % 360 + 360) % 360;
          return cab.cornerSide === 'right' ? rot === 270 : rot === 90;
        });
        if (legItems.length) {
          const legFace = cab.cornerSide === 'right'
            ? Math.min(...legItems.map((x) => x.x - getCab(x.code).d / 2))
            : Math.max(...legItems.map((x) => x.x + getCab(x.code).d / 2));
          const cornerEdge = cab.cornerSide === 'right' ? it.x + cab.w / 2 : it.x - cab.w / 2;
          assert.ok(Math.abs(cornerEdge - legFace) < 0.35,
            `${tag}: ${it.code} must meet its leg's boxes leg-to-leg, off by ${(cornerEdge - legFace).toFixed(2)}"`);
        }
        assert.ok(bodyEdge >= 24.25 - 0.35 && bodyEdge <= 24.25 + 5.85,
          `${tag}: ${it.code} body ${bodyEdge.toFixed(2)}" off its wall (24.25 + sliver inset <= 5.5)`);
        // the side run's first box touches the corner's front plane (24.3 span start)
        const sideRun = store.state.items.filter((x) => ((x.rotDeg || 0) % 180) !== 0 && getCab(x.code));
        assert.ok(sideRun.length, `${tag}: a perpendicular run exists`);
        const firstZ = Math.min(...sideRun.map((x) => x.z - getCab(x.code).w / 2));
        assert.ok(firstZ - (b.minZ + 24.25) < 0.6 && firstZ >= b.minZ + 24.2,
          `${tag}: side run must start at the corner's front plane, starts ${(firstZ - b.minZ).toFixed(2)}" out`);
      }
    }
  }
});

// ---- 3. the live warning ------------------------------------------------------

test('warning: an orphaned corner unit is flagged; a return run within 6" clears it', () => {
  const room = { width: 200, depth: 140, height: 96, openings: [] };
  const f16 = { id: 1, code: 'F16', x: -100 + 32, z: -70 + 12.25, rotDeg: 0 };
  // alone at the corner — nothing meets the return → flagged
  let ws = computeWarnings({ room, items: [f16] });
  assert.ok(ws.some((w) => w.level === 'warn' && /F16 corner unit has no return run meeting it — add cabinets on the adjoining wall/.test(w.msg)),
    'orphan F16 must be flagged');
  // a perpendicular base on the side wall, 1" clear of the return → silent
  const meet = { id: 2, code: 'F2', x: -100 + 12.25, z: -70 + 25 + 12, rotDeg: 90 };
  ws = computeWarnings({ room, items: [f16, meet] });
  assert.ok(!ws.some((w) => CORNER_WARN.test(w.msg)), 'a meeting return run must clear the warning');
  // the same cabinet 11" clear of the return → flagged again
  ws = computeWarnings({ room, items: [f16, { ...meet, z: -70 + 35 + 12 }] });
  assert.ok(ws.some((w) => CORNER_WARN.test(w.msg)), 'an 11" gap is not a meeting run');
  // a PARALLEL neighbour butted alongside doesn't count — must be perpendicular
  ws = computeWarnings({ room, items: [f16, { id: 3, code: 'F2', x: -100 + 56, z: -70 + 12.25, rotDeg: 0 }] });
  assert.ok(ws.some((w) => CORNER_WARN.test(w.msg)), 'a same-run neighbour must not satisfy the corner');
});

test('warning: wall corners need a perpendicular WALL run — a floor run does not count', () => {
  const room = { width: 200, depth: 140, height: 96, openings: [] };
  const w9 = { id: 1, code: 'W9', x: -100 + 20, z: -70 + 7.25, rotDeg: 0 };
  // a perpendicular FLOOR cabinet at the corner is the wrong height band
  const floorRun = { id: 2, code: 'F2', x: -100 + 12.25, z: -70 + 25 + 12, rotDeg: 90 };
  let ws = computeWarnings({ room, items: [w9, floorRun] });
  assert.ok(ws.some((w) => /W9 corner unit has no return run meeting it/.test(w.msg)),
    'a floor run must not satisfy a wall corner');
  // a perpendicular WALL cabinet meeting the 10" return → silent
  const wallRun = { id: 3, code: 'W2', x: -100 + 7.25, z: -70 + 12 + getCab('W2').w / 2, rotDeg: 90 };
  ws = computeWarnings({ room, items: [w9, wallRun] });
  assert.ok(!ws.some((w) => CORNER_WARN.test(w.msg)), 'a meeting wall run must clear the wall corner');
});

// ---- talls stand 30mm proud of the base run -----------------------------------
// Every generated TALL cabinet sits TALL_PROUD (30mm) further off its wall
// than the base units, so the worktop dies into the tall's side (client spec).
test('generated talls stand 30mm proud of the base run on every wall', async () => {
  const { TALL_PROUD } = await import('../src/interaction/snapping.js');
  for (const [shape, w, d] of [['l-shape', 240, 160], ['u-shape', 260, 180], ['galley', 200, 160]]) {
    for (const seed of [1, 5]) {
      const store = buildKitchen(shape, w, d, seed);
      const b = bounds(store.state.room);
      let talls = 0;
      for (const it of store.state.items) {
        const cab = getCab(it.code);
        if (!cab || cab.type !== 'TALL') continue;
        const rot = ((it.rotDeg || 0) % 360 + 360) % 360;
        const gap = rot === 0 ? it.z - b.minZ : rot === 90 ? it.x - b.minX
          : rot === 180 ? b.maxZ - it.z : b.maxX - it.x;
        const off = gap - (cab.d / 2 + 0.25);
        // wizard-placed side/facing runs must carry the full proud offset;
        // back-wall talls placed through the mock (non-snapping) controls are flush
        if (rot === 0) continue;
        talls++;
        assert.ok(Math.abs(off - TALL_PROUD) < 0.05,
          `${shape} ${w}x${d} seed=${seed}: ${it.code} rot=${rot} proud=${off.toFixed(2)}" (want ${TALL_PROUD.toFixed(2)})`);
      }
      if (shape !== 'u-shape') assert.ok(talls > 0, `${shape} seed=${seed}: no side/facing talls found`);
    }
  }
});


// ---- perpendicular runs never crash without a corner unit ----------------------
// A tight back wall can drop the corner unit (hasCorner=false). The runs must
// then keep the DEAD-CORNER SHADOW clear (or the leg is dropped entirely) —
// a back-run cabinet dead against the side leg's boxes is an impossible build.
test('no perpendicular near-clash between non-corner cabinets, any width', () => {
  const box = (it, cab) => {
    const h = ((it.rotDeg || 0) % 180) === 0;
    const hx = (h ? cab.w : cab.d) / 2, hz = (h ? cab.d : cab.w) / 2;
    return { x0: it.x - hx, x1: it.x + hx, z0: it.z - hz, z1: it.z + hz };
  };
  for (let width = 48; width <= 288; width += 8) {
    for (const depth of [96, 144, 216]) {
      for (const seed of [1, 4, 8]) {
        const store = buildKitchen('l-shape', width, depth, seed);
        const items = store.state.items.filter((it) => { const c = getCab(it.code); return c && ['FLOOR', 'TALL'].includes(c.type); });
        for (const a of items) for (const b of items) {
          const ca = getCab(a.code), cb = getCab(b.code);
          if (a.id >= b.id || ((a.rotDeg || 0) % 180) === ((b.rotDeg || 0) % 180) || ca.corner || cb.corner) continue;
          const A = box(a, ca), B = box(b, cb);
          const gx = Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1);
          const gz = Math.max(A.z0, B.z0) - Math.min(A.z1, B.z1);
          assert.ok(!(gx < 1.5 && gz < 1.5 && Math.max(-gx, -gz) > 2),
            `${width}x${depth} seed=${seed}: ${a.code} r${a.rotDeg || 0} crashes into ${b.code} r${b.rotDeg || 0} with no corner unit between`);
        }
      }
    }
  }
});
