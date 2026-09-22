// autolayout-window.test.js — auto-layout of a project unit never adds or moves a window:
// the windows are already on the plan. The Kitchen-mode wizard, drafting from nothing, still does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};
const { Store } = await import('../src/core/store.js');
const { Wizard } = await import('../src/ui/wizard.js');
const { getCab } = await import('../src/core/catalogue.js');

function mkControls(store) {
  const cursors = {};
  return { layer: { select() {} }, placeNew(code, wall) { const cab = getCab(code); if (!cab) return null; const rm = store.state.room; let cur = cursors[wall] ?? -rm.width / 2; if (cab.corner && cab.cornerSide !== 'right') cur += 20;
    const it = store.addItem(code, { x: cur + cab.w / 2, z: -rm.depth / 2 + cab.d / 2 + 0.25 + (cab.type === 'TALL' ? 1.18 : 0), rotDeg: 0 }); cursors[wall] = cur + cab.w + (cab.corner && cab.cornerSide === 'right' ? 20 : 0); return it; } };
}
const draft = (tradeUnit, openings) => {
  const store = new Store(); store.setRoom({ width: 200, depth: 150, height: 96 });
  for (const o of openings) store.addOpening(o);
  const wiz = new Wizard({ store, controls: mkControls(store), onBuilt() {}, onSave() {}, tradeUnit });
  wiz.lastShape = 'straight'; wiz.seed = 4; wiz._generate(null);
  return store.state.room.openings;
};

test('a project unit keeps the plan\'s window exactly where it is, and gets none when the plan has none', () => {
  const win = { type: 'window', wall: 'back', pos: 0.22, width: 30 };
  const kept = draft(() => 'Type A', [win]);
  assert.equal(kept.length, 1); assert.equal(kept[0].pos, 0.22); assert.equal(kept[0].width, 30);
  assert.equal(draft(() => 'Type A', []).length, 0, 'no window invented for a project unit');
});

test('the Kitchen-mode wizard never adds a window either (her rule: "it adds a window!"), and never moves one', () => {
  assert.equal(draft(() => null, []).length, 0, 'a room with no window stays without one');
  const kept = draft(() => null, [{ type: 'window', wall: 'back', pos: 0.7, width: 40 }]);
  assert.equal(kept.length, 1); assert.equal(kept[0].pos, 0.7); assert.equal(kept[0].width, 40);
});

test('with a window on the back wall, the sink base ends up under it', async () => {
  const { openingCenter, openingWidth } = await import('../src/core/openings.js');
  for (const [pos, seed] of [[0.3, 4], [0.6, 7], [0.75, 11]]) {
    const store = new Store(); store.setRoom({ width: 220, depth: 150, height: 96 });
    store.addOpening({ type: 'window', wall: 'back', pos, width: 36 });
    const wiz = new Wizard({ store, controls: mkControls(store), onBuilt() {}, onSave() {}, tradeUnit: () => null });
    wiz.lastShape = 'straight'; wiz.seed = seed; wiz._generate(null);
    const sink = store.state.items.find((i) => getCab(i.code)?.appliance === 'sink');
    assert.ok(sink, `seed ${seed}: a sink was placed`);
    const wc = openingCenter(store.state.room, store.state.room.openings[0]), hw = openingWidth(store.state.room.openings[0], store.state.room) / 2;
    assert.ok(Math.abs(sink.x - wc) < hw + 12, `seed ${seed}: sink at ${sink.x.toFixed(1)} is not under the window at ${wc.toFixed(1)}`);
  }
});
