// autolayout-doors.test.js — the room's doors survive a draft (her catch 2026-09-25: "if I add
// doors and windows then click auto layout it deletes all my doors/windows"). Only the doorway
// the wizard's OWN picker drew is replaced by the next draft's choice.
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
const setup = (openings, tradeUnit = () => null) => {
  const store = new Store(); store.setRoom({ width: 200, depth: 150, height: 96 });
  for (const o of openings) store.addOpening(o);
  const wiz = new Wizard({ store, controls: mkControls(store), onBuilt() {}, onSave() {}, tradeUnit });
  wiz.lastShape = 'l-shape'; wiz.seed = 4;
  return { store, wiz };
};
const sig = (o) => `${o.type}:${o.wall}:${o.pos}:${o.width}`;

test('doors and doorways added under Room stay exactly where they are through a draft and a re-roll, with the windows', () => {
  const own = [
    { type: 'door', wall: 'left', pos: 0.7, width: 34 },
    { type: 'doorway', wall: 'front', pos: 0.3, width: 60 },
    { type: 'window', wall: 'back', pos: 0.4, width: 40 },
    { type: 'door', wall: 'right', pos: 0.2, width: 32 },
  ];
  for (const tradeUnit of [() => null, () => 'Type A']) {
    const { store, wiz } = setup(own, tradeUnit);
    wiz._generate(null);
    assert.deepEqual(store.state.room.openings.map(sig), own.map(sig), 'first draft kept every opening');
    wiz.seed += 1; wiz._generate(null);                 // what "Another layout" does
    assert.deepEqual(store.state.room.openings.map(sig), own.map(sig), 'the re-roll kept every opening');
    assert.ok(store.state.items.length > 5, 'and a kitchen was still drafted');
  }
});

test('the wizard door picker adds its own doorway once, replaces it on the next draft, and never touches the room\'s door', () => {
  const { store, wiz } = setup([{ type: 'door', wall: 'left', pos: 0.7, width: 34 }]);
  wiz.door = 'right'; wiz.doorDist = 60; wiz.doorW = 36;
  wiz._generate(null);
  let ops = store.state.room.openings;
  assert.equal(ops.length, 2);
  assert.equal(ops.filter((o) => o.wiz).length, 1, 'one wizard doorway');
  assert.equal(ops.find((o) => o.wiz).wall, 'right');
  assert.equal(sig(ops.find((o) => !o.wiz)), 'door:left:0.7:34', 'the room\'s own door is untouched');
  wiz.door = 'front'; wiz._generate(null);
  ops = store.state.room.openings;
  assert.equal(ops.length, 2, 'the wizard replaced its own doorway rather than adding another');
  assert.equal(ops.find((o) => o.wiz).wall, 'front');
  wiz.door = ''; wiz._generate(null);
  ops = store.state.room.openings;
  assert.equal(ops.length, 1, '"No door" removes only the wizard\'s doorway');
  assert.equal(sig(ops[0]), 'door:left:0.7:34');
});

test('the cabinets keep clear of a door the room owns', async () => {
  const { openingCenter, openingWidth } = await import('../src/core/openings.js');
  const { store, wiz } = setup([{ type: 'door', wall: 'left', pos: 0.5, width: 36 }]);
  wiz.lastShape = 'l-shape'; wiz._generate(null);
  const rm = store.state.room, door = rm.openings[0];
  const c = openingCenter(rm, door), hw = openingWidth(door, rm) / 2;
  const leftRun = store.state.items.filter((it) => { const cab = getCab(it.code); return cab && (it.rotDeg || 0) === 90 && cab.type !== 'WALL'; });
  for (const it of leftRun) {
    const cab = getCab(it.code);
    assert.ok(it.z + cab.w / 2 <= c - hw + 0.01 || it.z - cab.w / 2 >= c + hw - 0.01, `${it.code} on the left wall sits across the door (${(it.z - cab.w / 2).toFixed(1)}..${(it.z + cab.w / 2).toFixed(1)} vs door ${(c - hw).toFixed(1)}..${(c + hw).toFixed(1)})`);
  }
});
