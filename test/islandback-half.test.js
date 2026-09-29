// islandback-half.test.js — "make double sided but half depth" (her ask 2026-09-29), and the stool
// niche that "does not rotate when I click rotate": the 3D layer redraws a cabinet in place when its
// back becomes covered or uncovered, and that redraw used to drop the selection while the selection
// bar still showed it, so the next Rotate did nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};

const THREE = await import('three');
const { planIslandBack } = await import('../src/core/islandback.js');
const { getCab } = await import('../src/core/catalogue.js');
const { spotOk } = await import('../src/core/placement.js');
const { Store } = await import('../src/core/store.js');
const { CabinetLayer } = await import('../src/interaction/cabinets.js');

const W = 230, D = 180, bounds = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
const room = () => ({ width: W, depth: D, height: 96, openings: [] });
const islandRow = (codes, z = 10) => { let x = -50, id = 1; return codes.map((code) => { const c = getCab(code); x += c.w; return { id: id++, code, x: x - c.w / 2, z, rotDeg: 0, island: true }; }); };

test('half depth: 14" door cabinets behind every width, joints lined up, backs touching', () => {
  const items = islandRow(['F17', 'F2', 'F3', 'F10', 'F11']);          // 20 / 24 / 28 / 36 / 42
  const p = planIslandBack({ room: room(), items }, 3, { halfDepth: true });
  assert.equal(p.ok, true, p.reason);
  assert.deepEqual(p.placements.map((q) => q.code), ['F4', 'F5', 'F6', 'F13', 'F14']);
  let st = { room: room(), items: [...items] };
  for (const [i, q] of p.placements.entries()) {
    const c = getCab(q.code);
    assert.equal(c.d, 14, `${q.code} is half depth`);
    assert.ok(/half depth/i.test(c.desc));
    assert.ok(Math.abs(q.x - items[i].x) < 1e-9, 'joints line up through the island');
    assert.ok(Math.abs((q.z + c.d / 2) - (items[i].z - 12)) < 1e-9, 'its back on the row\'s back');
    assert.equal(q.rotDeg, 180);
    assert.ok(spotOk(st, c, q.x, q.z, q.rotDeg, bounds)); st = { ...st, items: [...st.items, { id: 70 + i, ...q }] };
  }
  // a 48" range packs exactly, as the full-depth row does; pressing again is refused
  const r = planIslandBack({ room: room(), items: islandRow(['F2', 'AP3', 'F2']) }, 1, { halfDepth: true });
  assert.deepEqual(r.placements.map((q) => q.code), ['F5', 'F5', 'F5', 'F5']);
  assert.equal(planIslandBack(st, 3, { halfDepth: true }).reason, 'already double');
  // the walkway left behind a half-depth row is 10" more than behind a full one
  const full = planIslandBack({ room: room(), items }, 3);
  assert.ok(Math.abs(p.walkway - full.walkway - 10) < 1e-9);
});

test('a row turned sideways (a peninsula leg) measures its walkway to the right wall', () => {
  // a leg facing +x (rot 90), its back 44" off the left wall: 30" left behind a half-depth row, 20" behind a full one
  const x = -W / 2 + 44 + 12, items = [{ id: 1, code: 'F20', x, z: 0, rotDeg: 90 }, { id: 2, code: 'F2', x, z: 30, rotDeg: 90 }];
  const half = planIslandBack({ room: room(), items }, 1, { halfDepth: true });
  const full = planIslandBack({ room: room(), items }, 1);
  assert.ok(Math.abs(half.walkway - 30) < 1e-9, `half depth leaves ${half.walkway}`);
  assert.ok(Math.abs(full.walkway - 20) < 1e-9, `full depth leaves ${full.walkway}`);
  assert.equal(half.note, 'walkway');
});

test('a cabinet redrawn in place (its back covered, then uncovered) stays selected', () => {
  const store = new Store();
  store.setRoom({ width: W, depth: D, height: 96 });
  const scene = new THREE.Scene(), layer = new CabinetLayer(scene, store);
  const row = store.addItem('F2', { x: 0, z: 10, rotDeg: 0, island: true });
  const niche = store.addItem('F36', { x: 0, z: -40, rotDeg: 0, island: true });
  layer.select(niche.id);
  // rotate it to stand back to back with the row, then away again: each flips its finished back
  let redrawn = 0;
  for (const [rot, z] of [[180, 10 - 12 - 5.9], [90, -40], [0, -40]]) {
    const before = layer.map.get(niche.id).group;
    store.updateItem(niche.id, { rotDeg: rot, z });
    if (layer.map.get(niche.id).group !== before) redrawn++;
    assert.equal(layer.selectedId, niche.id, `still selected after turning to ${rot}`);
    assert.ok(layer.selBox, 'and outlined');
  }
  assert.ok(redrawn >= 1, 'the niche really was redrawn in place (the case that used to drop the selection)');
  // and the row itself, whose back the niche covered and uncovered, was redrawn at least once
  assert.ok(layer.map.has(row.id));
});
