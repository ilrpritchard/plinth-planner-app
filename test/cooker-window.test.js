// cooker-window.test.js — HARD RULE: a cooker (range or hob) never sits in
// front of a window. Two guards under test: the pure-geometry check in
// warnings.js, and the wizard's reroll (a generated layout that lands the
// range on the glass reseeds itself). Runs the REAL wizard with a stub scene.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// minimal DOM so wizard.js can be constructed outside the browser
globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};

const { Wizard } = await import('../src/ui/wizard.js');
const { Store } = await import('../src/core/store.js');
const { getCab } = await import('../src/core/catalogue.js');
const { cookerWindowClashes, computeWarnings } = await import('../src/core/warnings.js');

function mkControls(store) {
  const cursors = {};
  return {
    layer: { select() {} },
    placeNew(code, wall) {
      const cab = getCab(code); if (!cab) return null;
      const rm = store.state.room;
      const cur = cursors[wall] ?? -rm.width / 2;
      const it = store.addItem(code, { x: cur + cab.w / 2, z: -rm.depth / 2 + cab.d / 2 + 0.25, rotDeg: 0 });
      cursors[wall] = cur + cab.w;
      return it;
    },
  };
}

test('a range dropped in front of a window raises an error warning', () => {
  const room = { width: 144, depth: 120, openings: [{ id: 1, type: 'window', wall: 'back', pos: 0.5, width: 48 }] };
  const bad = { room, items: [{ id: 1, code: 'AP2', x: 0, z: -60 + 13, rotDeg: 0 }] };
  const good = { room, items: [{ id: 1, code: 'AP2', x: -60, z: -60 + 13, rotDeg: 0 }] };
  assert.equal(cookerWindowClashes(bad).length, 1, 'centred range clashes with the window');
  assert.equal(cookerWindowClashes(good).length, 0, 'range slid clear does not clash');
  assert.ok(computeWarnings(bad).some((w) => w.level === 'error' && /window/.test(w.msg)),
    'the warnings panel carries the rule as an error');
  // side wall too: window on the left wall, range rotated against it
  const side = { room: { width: 144, depth: 120, openings: [{ id: 1, type: 'window', wall: 'left', pos: 0.5, width: 48 }] },
                 items: [{ id: 1, code: 'AP2', x: -72 + 13, z: 0, rotDeg: 90 }] };
  assert.equal(cookerWindowClashes(side).length, 1, 'side-wall window guarded too');
});

test('the wizard never generates a cooker in front of a window', () => {
  for (const shape of ['straight', 'island', 'galley', 'u-shape']) {
    for (let width = 96; width <= 288; width += 16) {
      for (let seed = 1; seed <= 8; seed++) {
        const store = new Store();
        store.setRoom({ width, depth: 140, height: 96 });
        const wiz = new Wizard({ store, controls: mkControls(store), onBuilt() {}, onSave() {} });
        wiz.lastShape = shape; wiz.seed = seed;
        wiz._generate(null);
        const clashes = cookerWindowClashes(store.state);
        assert.equal(clashes.length, 0,
          `${shape} w=${width} seed=${seed}: cooker generated in front of a window`);
      }
    }
  }
});
