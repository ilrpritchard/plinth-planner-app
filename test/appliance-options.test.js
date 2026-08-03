// appliance-options.test.js — the wizard's appliance interview (step 4):
// cooking (range vs wall oven + hob), fridge (integrated vs freestanding) and
// dishwashers (1 or 2), passed to generateKitchen as an opts 4th argument.
// Defaults MUST reproduce the classic behaviour exactly, and each option must
// keep every hard layout rule (no overshoot, cooker guards, sink spacing).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};

const { generateKitchen } = await import('../src/core/layouts.js');
const { getCab, sizedFridgeCode } = await import('../src/core/catalogue.js');
const { Store } = await import('../src/core/store.js');
const { Wizard } = await import('../src/ui/wizard.js');

const W = (c) => getCab(c)?.w || 24;
const isRange = (c) => /^AP[123]$/.test(c);
const isFridge = (c) => c === 'AP9' || /^AP9:/.test(c);   // plain or sized code
const SHAPES = ['straight', 'l-shape', 'island', 'u-shape', 'galley'];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const CORNER_RETURN = 20;
const backUsed = (back) => back.reduce((t, o) => t + W(o.code) + (o.corner ? CORNER_RETURN : 0), 0);

// centre of each unit along the back wall (cumulative widths, corner returns included)
function backCenters(back) {
  const out = []; let cur = 0;
  for (const s of back) {
    const w = W(s.code) + (s.corner ? CORNER_RETURN : 0);
    out.push({ ...s, c: cur + w / 2 });
    cur += w;
  }
  return out;
}

test('opts default to the classic behaviour — omitted, {} and explicit all identical', () => {
  for (const shape of SHAPES) {
    for (const width of [96, 144, 240]) {
      for (const seed of SEEDS) {
        const a = generateKitchen(shape, { width, depth: 140 }, seed);
        const b = generateKitchen(shape, { width, depth: 140 }, seed, {});
        const c = generateKitchen(shape, { width, depth: 140 }, seed,
          { cooking: 'range', fridge: 'integrated', dishwashers: 1 });
        assert.equal(JSON.stringify(b.steps), JSON.stringify(a.steps), `${shape} ${width} seed=${seed}: {} differs`);
        assert.equal(JSON.stringify(c.steps), JSON.stringify(a.steps), `${shape} ${width} seed=${seed}: explicit defaults differ`);
      }
    }
  }
});

test('freestanding fridge: AP9 replaces the T3 housing, never overshoots', () => {
  for (const shape of SHAPES) {
    for (let width = 96; width <= 288; width += 16) {
      for (const seed of SEEDS) {
        const { steps } = generateKitchen(shape, { width, depth: 140 }, seed, { fridge: 'freestanding' });
        const codes = steps.map((s) => s.code);
        const tag = `${shape} w=${width} seed=${seed}`;
        assert.ok(!codes.includes('T3') && !codes.includes('T4'), `${tag}: fridge housing still present`);
        if (width >= 96) assert.ok(codes.includes('AP9'), `${tag}: no freestanding fridge placed`);
        const used = backUsed(steps.filter((s) => s.wall === 'back'));
        assert.ok(used <= width + 0.1, `${tag}: back run ${used}" overshoots ${width}"`);
      }
    }
  }
});

test('two dishwashers: both F7 flank the sink, each within 60" (wide walls)', () => {
  for (const shape of ['straight', 'island']) {
    for (let width = 200; width <= 300; width += 20) {
      for (const seed of SEEDS) {
        const { steps } = generateKitchen(shape, { width, depth: 160 }, seed, { dishwashers: 2 });
        const back = backCenters(steps.filter((s) => s.wall === 'back'));
        const dws = back.filter((s) => s.code === 'F7');
        const sink = back.find((s) => s.sink);
        const tag = `${shape} w=${width} seed=${seed}`;
        assert.equal(dws.length, 2, `${tag}: expected 2 dishwashers, got ${dws.length}`);
        assert.ok(sink, `${tag}: no sink`);
        for (const d of dws) assert.ok(Math.abs(d.c - sink.c) <= 60, `${tag}: DW ${Math.abs(d.c - sink.c).toFixed(0)}" from the sink`);
        // one on each side of the sink
        assert.ok(dws.some((d) => d.c < sink.c) && dws.some((d) => d.c > sink.c), `${tag}: both DWs on the same side`);
        const used = backUsed(steps.filter((s) => s.wall === 'back'));
        assert.ok(used <= width + 0.1, `${tag}: back run overshoots`);
      }
    }
  }
});

test('wall ovens: no range; hob mid-run on a drawer base; T9 housing joins the talls', () => {
  for (const shape of ['straight', 'island']) {
    for (let width = 180; width <= 300; width += 24) {
      for (const seed of SEEDS) {
        const { steps } = generateKitchen(shape, { width, depth: 160 }, seed, { cooking: 'wallOven' });
        const tag = `${shape} w=${width} seed=${seed}`;
        const codes = steps.map((s) => s.code);
        assert.ok(!codes.some(isRange), `${tag}: a range was still placed`);
        assert.ok(codes.includes('T9'), `${tag}: no T9 oven housing`);
        const back = steps.filter((s) => s.wall === 'back');
        const hobIdx = back.findIndex((s) => s.hob);
        assert.ok(hobIdx >= 0, `${tag}: no hob slot on the back run`);
        assert.ok(['AP4', 'AP5'].includes(back[hobIdx].hob), `${tag}: bad hob code ${back[hobIdx].hob}`);
        assert.ok(getCab(back[hobIdx].code)?.type === 'FLOOR', `${tag}: hob not over a base cabinet`);
        // the hob inherits the cooker rules: never at a wall end…
        assert.ok(hobIdx > 0 && hobIdx < back.length - 1, `${tag}: hob at the end of the run`);
        // …and never directly beside the sink
        for (const n of [back[hobIdx - 1], back[hobIdx + 1]]) assert.ok(!n?.sink, `${tag}: sink directly beside the hob`);
        const used = backUsed(back);
        assert.ok(used <= width + 0.1, `${tag}: back run overshoots`);
      }
    }
  }
  // L-shape short back wall: the hob base is exiled to the side leg with the
  // same guards (never at the open end, never hard in the corner)
  for (const seed of SEEDS) {
    const { steps } = generateKitchen('l-shape', { width: 110, depth: 180 }, seed, { cooking: 'wallOven' });
    const left = steps.filter((s) => s.wall === 'left');
    assert.ok(steps.some((s) => s.hob), `seed=${seed}: hob lost entirely`);
    assert.ok(steps.some((s) => s.code === 'T9'), `seed=${seed}: T9 lost on the L-shape`);
    if (left.length) {
      assert.ok(!left[left.length - 1].hob, `seed=${seed}: hob at the open end of the side run`);
      assert.ok(!left[0].hob, `seed=${seed}: hob hard in the corner`);
    }
  }
});

// ---- wizard end-to-end: the interview choices land in the built kitchen ----
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
function buildKitchen(shape, w, d, seed, appliances) {
  const store = new Store();
  store.setRoom({ width: w, depth: d, height: 96 });
  const wiz = new Wizard({ store, controls: mkControls(store), onBuilt() {}, onSave() {} });
  wiz.lastShape = shape; wiz.seed = seed;
  if (appliances) wiz.appliances = { ...wiz.appliances, ...appliances };
  wiz._generate(null);
  return { store, wiz };
}

test('wizard end-to-end: wall-oven kitchens get a hob over a base + a T9, no range', () => {
  for (const seed of [2, 5, 9]) {
    const { store } = buildKitchen('straight', 240, 160, seed, { cooking: 'wallOven' });
    const items = store.state.items;
    const hob = items.find((it) => getCab(it.code)?.appliance === 'hob');
    assert.ok(hob, `seed=${seed}: no hob appliance placed`);
    assert.ok(!items.some((it) => getCab(it.code)?.appliance === 'range'), `seed=${seed}: a range slipped in`);
    assert.ok(items.some((it) => it.code === 'T9'), `seed=${seed}: no oven housing`);
    const base = items.find((it) => getCab(it.code)?.type === 'FLOOR' &&
      Math.abs(it.x - hob.x) < 2 && Math.abs(it.z - hob.z) < 6);
    assert.ok(base, `seed=${seed}: hob has no base cabinet beneath it`);
  }
});

test('wizard end-to-end: freestanding fridge (AP9, no housing) and 2 DWs by the sink', () => {
  for (const seed of [3, 7]) {
    const { store } = buildKitchen('straight', 240, 160, seed, { fridge: 'freestanding', dishwashers: 2 });
    const items = store.state.items;
    assert.ok(items.some((it) => isFridge(it.code)), `seed=${seed}: no freestanding fridge`);
    assert.ok(!items.some((it) => it.code === 'T3' || it.code === 'T4'), `seed=${seed}: fridge housing still present`);
    const sinkAp = items.find((it) => getCab(it.code)?.appliance === 'sink');
    const dws = items.filter((it) => it.code === 'F7');
    assert.equal(dws.length, 2, `seed=${seed}: expected 2 dishwashers`);
    for (const d of dws) assert.ok(Math.abs(d.x - sinkAp.x) <= 60, `seed=${seed}: DW too far from the sink`);
  }
});

test('re-rolls keep the interview choices (same wizard, next seed)', () => {
  const { store, wiz } = buildKitchen('straight', 240, 160, 4, { cooking: 'wallOven', fridge: 'freestanding' });
  wiz.seed = (wiz.seed + 1) | 0;
  wiz._generate(null);                                  // what regenerate() runs
  const items = store.state.items;
  assert.ok(items.some((it) => getCab(it.code)?.appliance === 'hob'), 're-roll lost the hob');
  assert.ok(items.some((it) => isFridge(it.code)), 're-roll lost the freestanding fridge');
  assert.ok(!items.some((it) => it.code === 'T3' || it.code === 'T4'), 're-roll regrew a fridge housing');
});

// ---- user-sized freestanding fridges ('AP9:WxDxH' virtual codes) ----------

test('sized fridge codes: getCab round-trip, clamps, cached, base AP9 untouched', () => {
  const c = getCab('AP9:40x30x74');
  assert.equal(c.w, 40);
  assert.equal(c.d, 30);
  assert.equal(c.h, 74);
  assert.equal(c.type, 'APPLIANCES');
  assert.equal(c.appliance, 'fridge');
  assert.ok(c.notSupplied, 'sized fridge must stay "supply your own"');
  assert.ok(c.placeable, 'sized fridge must be placeable');
  assert.equal(c.desc, 'Refrigerator (Freestanding) 40"×30"×74"');
  assert.equal(getCab('AP9:40x30x74'), c, 'derived entry not cached (new object each call)');
  // clamps: w 24–48, d 24–36, h 60–84
  const lo = getCab('AP9:10x10x10');
  assert.equal(lo.w, 24); assert.equal(lo.d, 24); assert.equal(lo.h, 60);
  const hi = getCab('AP9:60x50x100');
  assert.equal(hi.w, 48); assert.equal(hi.d, 36); assert.equal(hi.h, 84);
  // sizedFridgeCode clamps too, and round-trips through getCab
  assert.equal(sizedFridgeCode({ w: 60, d: 20, h: 90 }), 'AP9:48x24x84');
  assert.equal(getCab(sizedFridgeCode({ w: 40, d: 30, h: 74 })).w, 40);
  // the catalogue AP9 itself is untouched
  assert.equal(getCab('AP9').w, 36);
  assert.equal(getCab('AP9').desc, 'Refrigerator (Freestanding)');
  // junk after the prefix is not a cabinet
  assert.equal(getCab('AP9:banana'), undefined);
});

test('sized fridge 48×32×72: budgets its real width, no overshoot, parks at the run END', () => {
  const SIZE = { w: 48, d: 32, h: 72 };
  const CODE = sizedFridgeCode(SIZE);           // AP9:48x32x72
  assert.equal(CODE, 'AP9:48x32x72');
  for (const shape of SHAPES) {
    for (let width = 120; width <= 300; width += 12) {
      for (const seed of SEEDS) {
        const { steps } = generateKitchen(shape, { width, depth: 140 }, seed, { fridge: 'freestanding', fridgeSize: SIZE });
        const tag = `${shape} w=${width} seed=${seed}`;
        const codes = steps.map((s) => s.code);
        assert.ok(!codes.includes('T3') && !codes.includes('T4'), `${tag}: fridge housing present`);
        assert.ok(!codes.includes('AP9'), `${tag}: unsized AP9 placed despite fridgeSize`);
        const used = backUsed(steps.filter((s) => s.wall === 'back'));
        assert.ok(used <= width + 0.1, `${tag}: back run ${used}" overshoots ${width}"`);
        // these rooms can all physically hold a 48" fridge — it must be present
        const fr = steps.find((s) => s.code === CODE);
        assert.ok(fr, `${tag}: sized fridge missing`);
        // …and it sits at the very END of its run (outermost slot)
        const run = steps.filter((s) => s.wall === fr.wall);
        const idx = run.findIndex((s) => s.code === CODE);
        assert.ok(idx === 0 || idx === run.length - 1, `${tag}: fridge mid-run (${idx + 1} of ${run.length} on ${fr.wall})`);
        // on an L/U side leg the fridge takes the OPEN end (last placed)
        if (fr.wall === 'left') assert.equal(idx, run.length - 1, `${tag}: fridge not at the open end of the side leg`);
      }
    }
  }
});

test('wizard end-to-end: sized freestanding fridge lands at a run end, no overlap', () => {
  for (const seed of [3, 7, 11]) {
    const { store } = buildKitchen('straight', 240, 160, seed, { fridge: 'freestanding', fridgeSize: { w: 48, d: 32, h: 72 } });
    const items = store.state.items;
    const fr = items.find((it) => it.code === 'AP9:48x32x72');
    assert.ok(fr, `seed=${seed}: no AP9:48x32x72 item placed`);
    assert.ok(!items.some((it) => it.code === 'T3' || it.code === 'T4' || it.code === 'AP9'), `seed=${seed}: wrong fridge variant placed`);
    const fcab = getCab(fr.code);
    assert.equal(fcab.w, 48);
    // the back run: floor-standing units along the back wall
    const rm = store.state.room;
    const backZ = -rm.depth / 2;
    const run = items.filter((it) => {
      const c = getCab(it.code);
      return c && ['FLOOR', 'TALL', 'APPLIANCES'].includes(c.type) && !(c.mountY > 0) &&
        ((it.rotDeg || 0) % 180) === 0 && Math.abs(it.z - (backZ + c.d / 2 + 0.25)) < 8;
    });
    const lo = Math.min(...run.map((it) => it.x - getCab(it.code).w / 2));
    const hi = Math.max(...run.map((it) => it.x + getCab(it.code).w / 2));
    const f0 = fr.x - fcab.w / 2, f1 = fr.x + fcab.w / 2;
    assert.ok(Math.abs(f0 - lo) < 0.6 || Math.abs(f1 - hi) < 0.6,
      `seed=${seed}: fridge [${f0.toFixed(1)},${f1.toFixed(1)}] not at a run end [${lo.toFixed(1)},${hi.toFixed(1)}]`);
    // and it overlaps nothing on the run
    for (const it of run) {
      if (it.id === fr.id) continue;
      const c = getCab(it.code);
      const o0 = it.x - c.w / 2, o1 = it.x + c.w / 2;
      assert.ok(Math.min(f1, o1) - Math.max(f0, o0) <= 1.0, `seed=${seed}: fridge overlaps ${it.code}`);
    }
  }
});
