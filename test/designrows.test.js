// designrows.test.js — deleting a cabinet row on the PROJECT page takes the cabinet out of the
// unit's 3D layout too (her catch 2026-09-25: it could only be deleted from the 3D page, because
// Done re-derives the rows from the layout and put the row straight back).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeFromDesign } from '../src/core/rowlayout.js';
import { rowsFromDesign } from '../src/core/cost.js';

const design = () => ({ room: { width: 200, depth: 150, height: 96 }, items: [
  { id: 1, code: 'T1', x: -88, z: -62, rotDeg: 0 },
  { id: 2, code: 'F2', x: -64, z: -62.75, rotDeg: 0 },
  { id: 3, code: 'F10', x: -34, z: -62.75, rotDeg: 0 },           // sink base ...
  { id: 4, code: 'AP7', x: -34, z: -62.75, rotDeg: 0 },           // ... with its sink set in it
  { id: 5, code: 'F2', x: -4, z: -62.75, rotDeg: 0 },
  { id: 6, code: 'T9', x: 23, z: -62, rotDeg: 0 },                // oven housing ...
  { id: 7, code: 'AP14', x: 23, z: -62, rotDeg: 0, hostId: 6 },   // ... with the wall oven in it
  { id: 8, code: 'W2', x: -64, z: -68, rotDeg: 0 },
] });

test('the last-placed cabinets of that code go first, the rest of the layout is untouched', () => {
  const d = design();
  const { items, removed } = removeFromDesign(d, 'F2', 1);
  assert.equal(removed, 1);
  assert.deepEqual(items.map((i) => i.id), [1, 2, 3, 4, 6, 7, 8], 'item 5 (the later F2) went');
  assert.equal(d.items.length, 8, 'the design passed in is not mutated');
  assert.deepEqual(removeFromDesign(d, 'F2').items.map((i) => i.id), [1, 3, 4, 6, 7, 8], 'no qty = every one of that code');
});

test('what rides on a removed cabinet leaves with it: the sink in the base, the oven in its housing', () => {
  const noSinkBase = removeFromDesign(design(), 'F10').items;
  assert.ok(!noSinkBase.some((i) => i.code === 'AP7'), 'the sink left with its base');
  const noHousing = removeFromDesign(design(), 'T9').items;
  assert.ok(!noHousing.some((i) => i.code === 'AP14'), 'the oven left with its housing');
  assert.equal(noHousing.length, 6);
});

test('the rows re-derived from the layout no longer list the deleted cabinet or its rider', () => {
  const rows = rowsFromDesign(removeFromDesign(design(), 'F10').items);
  assert.ok(!rows.some((r) => r.code === 'F10' || r.code === 'AP7'));
  assert.deepEqual(rows.find((r) => r.code === 'F2'), { code: 'F2', qty: 2 });
});

test('an unknown code or a code not in the layout removes nothing', () => {
  assert.equal(removeFromDesign(design(), 'ZZ9').removed, 0);
  assert.equal(removeFromDesign(design(), 'F20').removed, 0);
  assert.equal(removeFromDesign({ items: [] }, 'F2').removed, 0);
});
