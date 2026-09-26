// islandpaint.test.js — the island can wear its own colour (her ask 2026-09-26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { islandFinish, islandIds } from '../src/core/islands.js';
import { encodeDesign, decodeDesign } from '../src/core/persistence.js';

const mk = () => {
  const s = new Store(); s.setRoom({ width: 200, depth: 160, height: 96 }); s.setFinish('Ghost');
  s.addItem('F10', { x: -60, z: -160 / 2 + 12.25, rotDeg: 0 });
  s.addItem('F20', { x: -18, z: 10, rotDeg: 180, island: true }); s.addItem('F20', { x: 18, z: 10, rotDeg: 180, island: true });
  return s;
};

test('paintItems gives the island its own finish, reports it, and back to the kitchen removes it', () => {
  const s = mk();
  assert.equal(islandFinish(s.state), null, 'painted with the kitchen to start');
  assert.equal(islandIds(s.state).length, 2);
  s.paintItems(islandIds(s.state), 'Kale');
  assert.equal(islandFinish(s.state), 'Kale');
  assert.ok(s.state.items.filter((i) => i.island).every((i) => i.finish === 'Kale') && !s.state.items.find((i) => !i.island).finish, 'only the island cabinets');
  assert.ok(s.canUndo, 'one undo step');
  s.paintItems(islandIds(s.state), null);
  assert.equal(islandFinish(s.state), null);
  assert.ok(s.state.items.every((i) => !i.finish), 'no stray finish left on any cabinet');
  s.paintItems(islandIds(s.state), 'Ghost');
  assert.equal(islandFinish(s.state), null, 'painting it the kitchen colour is the same as none');
});

test('the island colour survives a share link round trip', () => {
  const s = mk(); s.paintItems(islandIds(s.state), 'Hudson');
  const back = decodeDesign(encodeDesign(s.state));
  assert.equal(islandFinish(back), 'Hudson');
});

test('the island worktop can differ: its slab is soapstone in the plan, the DXF (own layer) and the IFC while the run stays marble', async () => {
  const { planWorktopSlabs } = await import('../src/core/worktop-plan.js');
  const { buildPlanDXF } = await import('../src/core/dxf.js');
  const { buildUnitIFC } = await import('../src/core/ifc.js');
  const { getCab } = await import('../src/core/catalogue.js');
  const s = mk(); s.setRoom({ worktop: 'marble' });
  for (const id of islandIds(s.state)) s.updateItem(id, { worktop: 'soapstone' });
  const slabs = planWorktopSlabs(s.state.items, getCab, 'marble', s.state.room);
  assert.deepEqual([...new Set(slabs.map((x) => x.mat))].sort(), ['marble', 'soapstone']);
  const dxf = buildPlanDXF(s.serialize(), { walls: false });
  assert.ok(dxf.includes('\n2\nWORKTOP-SOAPSTONE\n') && dxf.includes('\n8\nWORKTOP-SOAPSTONE\n') && dxf.includes('\n8\nWORKTOP\n'), 'a WORKTOP-SOAPSTONE layer beside WORKTOP');
  const ifc = buildUnitIFC([{ name: 'T', state: s.serialize() }]);
  assert.ok(ifc.includes("- Soapstone (by others)") && ifc.includes("- Carrara marble (by others)"), 'both materials in the IFC');
});
