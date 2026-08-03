// wizard-uppers.test.js — the wizard's upper row (wall cabinets, dressers,
// floating shelves) must NEVER overlap the rendered window. Regression for the
// bug where the no-go zone used the raw pos-fraction while the 3D room drew
// the window with the corner-clamped centre (openings.js) — an upper cabinet
// could land over the glass. Runs the REAL wizard with a stub scene.
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
const { openingCenter, openingWidth } = await import('../src/core/openings.js');

// stub controls: butt cabinets left→right along the wall like placeNew does
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

test('NOTHING in the window band ever overlaps the glass (uppers, talls, dressers, shelves, hood)', () => {
  for (const shape of ['straight', 'island', 'galley', 'u-shape']) {
    for (let width = 96; width <= 288; width += 16) {
      for (let seed = 1; seed <= 8; seed++) {
        const store = new Store();
        store.setRoom({ width, depth: 140, height: 96 });
        const wiz = new Wizard({ store, controls: mkControls(store), onBuilt() {}, onSave() {} });
        wiz.lastShape = shape; wiz.seed = seed;
        wiz._generate(null);
        const room = store.state.room;
        for (const o of (room.openings || [])) {
          if (o.type !== 'window' || (o.wall || 'back') !== 'back') continue;
          const cx = openingCenter(room, o), ww = openingWidth(o, room);
          for (const it of store.state.items) {
            const c = getCab(it.code);
            if (!c) continue;
            const blocked = ['WALL', 'COUNTER', 'SHELF', 'TALL'].includes(c.type) || c.appliance === 'hood';
            if (!blocked || ((it.rotDeg || 0) % 180) !== 0) continue;
            if (Math.abs(it.z - (-70 + c.d / 2 + 0.25)) > 12) continue;   // back wall only
            const overlap = Math.min(it.x + c.w / 2, cx + ww / 2) - Math.max(it.x - c.w / 2, cx - ww / 2);
            assert.ok(overlap <= 0.1,
              `${shape} w=${width} seed=${seed}: ${it.code} overlaps the window by ${overlap.toFixed(1)}"`);
          }
        }
      }
    }
  }
});
