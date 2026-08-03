// design.test.js — the budget dial (design TO a price) and the rationale
// engine (the "why" chips). Both pure, plus a wizard end-to-end run.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};

const { Store } = await import('../src/core/store.js');
const { getCab, sellUSD } = await import('../src/core/catalogue.js');
const { planBudgetSwaps } = await import('../src/core/budget.js');
const { designRationale } = await import('../src/core/rationale.js');
const { summarizeState } = await import('../src/core/cost.js');
const { Wizard } = await import('../src/ui/wizard.js');

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
function buildKitchen(shape, w, d, seed, budget = null) {
  const store = new Store();
  store.setRoom({ width: w, depth: d, height: 96 });
  const wiz = new Wizard({ store, controls: mkControls(store), onBuilt() {}, onSave() {} });
  wiz.lastShape = shape; wiz.seed = seed; wiz.budget = budget;
  wiz._generate(null);
  return { store, wiz };
}

test('planBudgetSwaps walks the estimate down with same-width swaps only', () => {
  const { store } = buildKitchen('island', 240, 180, 7);
  const before = summarizeState(store.state).subtotal;
  const budget = Math.round(before * 0.75);
  const plan = planBudgetSwaps(store.serialize(), budget);
  assert.ok(plan.swaps.length > 0, 'no swaps planned');
  assert.ok(plan.total <= budget, `total ${plan.total} still over ${budget}`);
  assert.ok(plan.met);
  for (const s of plan.swaps) {
    assert.equal(getCab(s.from).w, getCab(s.to).w, `${s.from}→${s.to} changed width`);
    assert.ok(sellUSD(getCab(s.to)) <= sellUSD(getCab(s.from)), `${s.from}→${s.to} costs MORE`);
  }
});

test('budget: under-budget layouts are untouched; impossible budgets are honest', () => {
  const { store } = buildKitchen('straight', 144, 120, 3);
  const before = summarizeState(store.state).subtotal;
  const easy = planBudgetSwaps(store.serialize(), before + 1000);
  assert.equal(easy.swaps.length, 0);
  assert.ok(easy.met);
  const impossible = planBudgetSwaps(store.serialize(), 1000);
  assert.equal(impossible.met, false);
  assert.ok(impossible.total < before, 'still reduced as far as possible');
});

test('budget never downgrades the sink base to open shelving', () => {
  const { store } = buildKitchen('island', 240, 180, 7);
  const sinkAp = store.state.items.find((it) => getCab(it.code)?.appliance === 'sink');
  const plan = planBudgetSwaps(store.serialize(), 1000);   // maximum pressure
  const sinkBase = store.state.items.find((it) =>
    getCab(it.code)?.type === 'FLOOR' && Math.abs(it.x - sinkAp.x) < 2 && Math.abs(it.z - sinkAp.z) < 2);
  assert.ok(sinkBase, 'sink base found');
  assert.ok(!plan.swaps.some((s) => s.id === sinkBase.id && /^F2[3-5]$/.test(s.to)), 'sink base went to open shelves');
});

test('wizard applies the budget end-to-end (estimate ≤ budget after build)', () => {
  const probe = buildKitchen('island', 240, 180, 7);
  const budget = Math.round(summarizeState(probe.store.state).subtotal * 0.8);
  const { store, wiz } = buildKitchen('island', 240, 180, 7, budget);
  assert.ok(summarizeState(store.state).subtotal <= budget, 'estimate over budget after build');
  assert.ok(wiz._budgetPlan.met);
});

test('rationale: explains DW-by-sink, range landings and the work triangle', () => {
  const { store } = buildKitchen('island', 240, 180, 7);
  const notes = designRationale(store.serialize());
  const all = notes.map((n) => n.text).join(' | ');
  assert.ok(notes.length >= 3, `only ${notes.length} notes`);
  assert.match(all, /Dishwasher/);
  assert.match(all, /range/i);
  for (const n of notes) assert.ok(Array.isArray(n.ids));
  // ids reference real items
  for (const n of notes) for (const id of n.ids) assert.ok(store.getItem(id), 'stale id in rationale');
});

test('cornice runs OVER a tall filler and drops down the tall\'s side to meet an upper', async () => {
  const { planCornice } = await import('../src/core/cornice.js');
  const s = new Store();
  s.setRoom({ width: 144, depth: 120, height: 96, cornice: 'plain' });
  // tall 4" from the left wall (→ tall-height filler), wall cabinet butted on its right
  s.addItem('T1', { x: -56, z: -47.5 });                  // spans -68..-44; gap 4" to wall at -72
  s.addItem('W2', { x: -32, z: -52.75 });                 // butted: spans -44..-20
  const plan = planCornice(s.state);
  // the filler carries moulding: some segment sits within the filler span (x < -68)
  assert.ok(plan.segments.some((seg) => seg.x < -66 || (seg.length > 3 && seg.x - seg.length / 2 < -67.5)),
    'no cornice over the tall filler');
  // and a vertical drop connects the wall cabinet's cornice to the tall's
  assert.equal(plan.drops.length, 1);
  const d = plan.drops[0];
  assert.ok(Math.abs(d.x - (-44)) < 1.5, `drop not on the tall's flank (x=${d.x})`);
  assert.ok(d.y0 === 84 && d.y1 === 86, `drop levels ${d.y0}→${d.y1}`);
  // both extras are PRICED (totalIn grows vs. a bare pair)
  const bare = planCornice({ ...s.serialize(), items: s.state.items.filter((i) => i.code === 'W2') });
  assert.ok(plan.totalIn > bare.totalIn, 'extra moulding not counted');
});

test('rationale: never more than 6 chips, and empty rooms produce none that crash', () => {
  const s = new Store();
  assert.ok(designRationale(s.serialize()).length <= 6);
  const { store } = buildKitchen('u-shape', 260, 200, 4);
  assert.ok(designRationale(store.serialize()).length <= 6);
});
