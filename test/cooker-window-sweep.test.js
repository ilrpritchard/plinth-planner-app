// cooker-window-sweep.test.js — HARD RULE: the cooker never sits in front of a window.
// The generator knows where the back-wall windows are (layouts.js clearBackWindows): it
// reorders the back run so the sink goes under the glass and the cooker with its landings
// stays clear, or, when no order of that run can, sends the cooker round the corner onto
// the leg. Swept through the REAL wizard: shapes x widths x window positions x seeds, and
// every other back-run rule (sink never beside the cooker, cooker never at a run end or
// beside a corner unit, 18" from a tall, dishwasher flanked, no tall over the glass) is no
// worse than the same room drafted with no window at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};

const { Wizard } = await import('../src/ui/wizard.js');
const { Store } = await import('../src/core/store.js');
const { getCab } = await import('../src/core/catalogue.js');
const { cookerWindowClashes } = await import('../src/core/warnings.js');
const { openingCenter, openingWidth } = await import('../src/core/openings.js');
const { generateKitchen, clearBackWindows } = await import('../src/core/layouts.js');

// placeNew stand-in: butts the back run from the left wall, as controls.placeNew does. The
// cursor starts again with every draft (the wizard's reroll clears the store and places anew).
function mkControls(store) {
  let cursors = {};
  return {
    layer: { select() {} },
    placeNew(code, wall) {
      const cab = getCab(code); if (!cab) return null;
      const rm = store.state.room;
      if (!store.state.items.length) cursors = {};
      let cur = cursors[wall] ?? -rm.width / 2;
      if (cab.corner && cab.cornerSide !== 'right') cur += 20;
      const it = store.addItem(code, { x: cur + cab.w / 2, z: -rm.depth / 2 + cab.d / 2 + 0.25 + (cab.type === 'TALL' ? 1.18 : 0), rotDeg: 0 });
      cursors[wall] = cur + cab.w + (cab.corner && cab.cornerSide === 'right' ? 20 : 0);
      return it;
    },
  };
}

function draft(shape, width, depth, seed, win) {
  const store = new Store();
  store.setRoom({ width, depth, height: 96 });
  if (win) store.addOpening({ type: 'window', wall: 'back', ...win });
  const wiz = new Wizard({ store, controls: mkControls(store), onBuilt() {}, onSave() {}, tradeUnit: () => null });
  wiz.lastShape = shape; wiz.seed = seed;
  wiz._generate(null);
  return { state: store.state, seed: wiz.seed };
}

// the built back run's rule breaks, read off the placed cabinets
function backRules(state) {
  const rm = state.room, backZ = -rm.depth / 2;
  const onBack = (it, c) => ((it.rotDeg || 0) % 180) === 0 && Math.abs(it.z - c.d / 2 - backZ) < 3 && !it.island;
  const run = state.items.map((it) => ({ it, c: getCab(it.code) }))
    .filter(({ it, c }) => c && (c.type === 'FLOOR' || c.type === 'TALL' || (c.type === 'APPLIANCES' && !(c.mountY > 0))) && onBack(it, c))
    .map(({ it, c }) => ({ it, c, x0: it.x - c.w / 2, x1: it.x + c.w / 2 }))
    .sort((a, b) => a.x0 - b.x0);
  const riders = state.items.map((it) => ({ it, c: getCab(it.code) })).filter(({ c }) => c && (c.appliance === 'sink' || c.appliance === 'hob'));
  const carries = (u, kind) => riders.some(({ it, c }) => c.appliance === kind && Math.abs(it.x - u.it.x) < 1 && Math.abs(it.z - u.it.z) < 1);
  const isCook = (u) => u.c.appliance === 'range' || carries(u, 'hob');
  const isSink = (u) => carries(u, 'sink');
  const isTall = (u) => u.c.type === 'TALL' || u.c.appliance === 'fridge';
  const legged = (u) => !!u && (u.c.type === 'FLOOR' || u.c.type === 'TALL') && u.c.form !== 'dishwasher';
  const touch = (a, b) => !!a && !!b && Math.abs(b.x0 - a.x1) < 1;
  const out = { sinkCook: 0, cookEnd: 0, cookCorner: 0, clearance: 0, dw: 0, tallWin: 0 };
  run.forEach((u, k) => {
    const L = run[k - 1], R = run[k + 1];
    if (isCook(u)) {
      if (k === 0 || k === run.length - 1) out.cookEnd++;
      if ((touch(L, u) && L.c.corner) || (touch(u, R) && R.c.corner)) out.cookCorner++;
      if ((touch(L, u) && isSink(L)) || (touch(u, R) && isSink(R))) out.sinkCook++;
      for (const t of run) if (isTall(t) && Math.max(t.x0 - u.x1, u.x0 - t.x1) < 18 - 0.01) out.clearance++;
    }
    if (u.c.form === 'dishwasher' && !(touch(L, u) && legged(L) && touch(u, R) && legged(R))) out.dw++;
  });
  for (const o of rm.openings || []) {
    if (o.type !== 'window' || (o.wall || 'back') !== 'back') continue;
    const c = openingCenter(rm, o), h = openingWidth(o, rm) / 2;
    for (const u of run) if (isTall(u) && Math.min(u.x1, c + h) - Math.max(u.x0, c - h) > 0.75) out.tallWin++;
  }
  return out;
}

const SHAPES = [['straight', 150], ['l-shape', 168], ['u-shape', 180], ['galley', 150], ['island', 180], ['peninsula', 180], ['c-peninsula', 180]];
const WIDTHS = [144, 168, 192, 216, 240, 264];
const WINDOWS = [{ pos: 0.3, width: 36 }, { pos: 0.45, width: 48 }, { pos: 0.6, width: 48 }, { pos: 0.75, width: 30 }];
const SEEDS = [3, 7, 11, 42];
// FORCED: a 144" straight run (or an island kitchen's, which is the same back run) with a 30"
// window at 0.75 cannot keep BOTH the cooker and the fridge housing off the glass — proven below
// over 400 seeds. There the wizard's reroll still keeps the cooker clear (the first test) and
// the tall is left for the live warning, as before this fix.
const forced = (shape, width, win) => (shape === 'straight' || shape === 'island') && width === 144 && win.pos === 0.75;

test('a wizard build never leaves the cooker in front of a back-wall window (shapes x widths x windows x seeds)', () => {
  const fails = [];
  let n = 0;
  for (const [shape, depth] of SHAPES) for (const width of WIDTHS) for (const win of WINDOWS) for (const seed of SEEDS) {
    n++;
    const { state } = draft(shape, width, depth, seed, win);
    const clashes = cookerWindowClashes(state);
    if (clashes.length) fails.push(`${shape} ${width}x${depth} window@${win.pos}/${win.width} seed ${seed}`);
  }
  assert.equal(fails.length, 0, `${fails.length} of ${n} builds put the cooker in front of the window:\n${fails.join('\n')}`);
});

test('the generator clears the window itself, first time: the wizard reroll is only a backstop', () => {
  const fails = [];
  for (const [shape, depth] of SHAPES) for (const width of WIDTHS) for (const win of WINDOWS) for (const seed of SEEDS) {
    if (forced(shape, width, win)) continue;
    const { seed: used } = draft(shape, width, depth, seed, win);
    if (used !== seed) fails.push(`${shape} ${width} window@${win.pos} seed ${seed} rerolled to ${used}`);
  }
  assert.equal(fails.length, 0, fails.join('\n'));
});

test('every other back-run rule is no worse with the window than without it', () => {
  const fails = [];
  for (const [shape, depth] of SHAPES) for (const width of WIDTHS) for (const win of WINDOWS) for (const seed of SEEDS) {
    if (forced(shape, width, win)) continue;
    const withWin = backRules(draft(shape, width, depth, seed, win).state);
    const bare = backRules(draft(shape, width, depth, seed, null).state);
    for (const k of Object.keys(withWin)) {
      if (k === 'tallWin' ? withWin[k] > 0 : withWin[k] > bare[k]) fails.push(`${shape} ${width} window@${win.pos} seed ${seed}: ${k} ${bare[k]} -> ${withWin[k]}`);
    }
  }
  assert.equal(fails.length, 0, fails.join('\n'));
});

test('the FORCED room really is forced (drop the carve-out if this ever fails)', () => {
  const room = { width: 144, depth: 150, height: 96, openings: [{ type: 'window', wall: 'back', pos: 0.75, width: 30 }], boxings: [] };
  const o = room.openings[0], c = openingCenter(room, o) + 72, h = openingWidth(o, room) / 2;
  const onGlass = (a, b) => Math.min(b, c + h) - Math.max(a, c - h) > 0;
  for (let seed = 1; seed <= 400; seed++) {
    let x = 0, bad = false;
    for (const s of generateKitchen('straight', room, seed, {}).steps.filter((st) => st.wall === 'back')) {
      const cab = getCab(s.code), a = x; x += cab.w;
      if ((cab.appliance === 'range' || s.hob || cab.type === 'TALL') && onGlass(a, x)) bad = true;
    }
    assert.ok(bad, `seed ${seed} found a clean layout: remove the FORCED carve-out`);
  }
});

test('the sink goes under the window when the cooker has to move', () => {
  // her repro: 192 x 168, one 48" window at 0.6 on the back wall, an L
  for (const seed of [3, 7, 11, 42]) {
    const { state, seed: used } = draft('l-shape', 192, 168, seed, { pos: 0.6, width: 48 });
    assert.equal(used, seed, 'no reroll needed');
    assert.equal(cookerWindowClashes(state).length, 0);
    const rm = state.room, o = rm.openings[0], c = openingCenter(rm, o);
    const sink = state.items.find((i) => getCab(i.code)?.appliance === 'sink');
    assert.ok(sink && Math.abs(sink.x - c) < openingWidth(o, rm) / 2, `seed ${seed}: sink at ${sink?.x} under the window at ${c}`);
  }
});

test('the cooker round the corner (a peninsula): the sink is centred under the window', () => {
  // her repro room with the peninsula: the back run cannot keep the cooker off the glass, the
  // cooker goes onto the leg, and the sink block is re-seated with the sink under the window
  for (const seed of SEEDS) {
    const { state } = draft('peninsula', 240, 180, seed, { pos: 0.6, width: 48 });
    const rm = state.room, wc = openingCenter(rm, rm.openings[0]);
    const sink = state.items.find((i) => getCab(i.code)?.appliance === 'sink');
    assert.ok(!state.items.some((i) => getCab(i.code)?.appliance === 'range' && (i.rotDeg || 0) === 0), `seed ${seed}: the cooker is on the leg`);
    assert.ok(Math.abs(sink.x - wc) <= 6, `seed ${seed}: sink ${sink.x.toFixed(1)} is ${Math.abs(sink.x - wc).toFixed(1)}" off the window centre ${wc.toFixed(1)}`);
  }
  // and across the sweep: wherever the cooker left the back wall and the window's centre is over a
  // plain base cabinet (not behind a corner unit, not past the run), the sink is under the window
  const fails = [];
  for (const [shape, depth] of SHAPES) for (const width of WIDTHS) for (const win of WINDOWS) for (const seed of SEEDS) {
    const { state } = draft(shape, width, depth, seed, win);
    const rm = state.room, wc = openingCenter(rm, rm.openings[0]);
    const onBack = (i, c) => (i.rotDeg || 0) === 0 && !i.island && Math.abs(i.z - c.d / 2 + rm.depth / 2) < 3;
    if (state.items.some((i) => { const c = getCab(i.code); return (c.appliance === 'range' || c.appliance === 'hob') && (i.rotDeg || 0) === 0 && !i.island; })) continue;
    const sink = state.items.find((i) => getCab(i.code)?.appliance === 'sink' && (i.rotDeg || 0) === 0 && !i.island);
    if (!sink) continue;
    const bases = state.items.filter((i) => { const c = getCab(i.code); return c.type === 'FLOOR' && !c.corner && onBack(i, c); });
    if (!bases.some((i) => Math.abs(i.x - wc) < getCab(i.code).w / 2)) continue;
    const bw = getCab(bases.find((i) => Math.abs(i.x - sink.x) < 1)?.code || 'F2').w;
    if (Math.abs(sink.x - wc) >= win.width / 2 + bw / 2 - 2) fails.push(`${shape} ${width} window@${win.pos} seed ${seed}: sink ${Math.abs(sink.x - wc).toFixed(1)}" off`);
  }
  assert.equal(fails.length, 0, fails.join('\n'));
});

test('a run that already clears the window is left exactly as it was', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const bare = generateKitchen('l-shape', { width: 192, depth: 168, height: 96, openings: [], boxings: [] }, seed, {});
    const steps = bare.steps.map((s) => ({ ...s }));
    // a window over the far end of the side wall's corner, nowhere near the back run's cooker
    assert.equal(clearBackWindows(steps, { width: 192, depth: 168, openings: [{ type: 'window', wall: 'left', pos: 0.5, width: 36 }] }), true);
    assert.deepEqual(steps, bare.steps);
  }
});
