// peninsula-backtoback.test.js — her share link 74m454y (2026-09-29): "I want to be able to put a double
// cabinet on the left side... then the stool niche... allow cabinets to sit back to back on the corner...
// and make the stool niche fill in any leftover space". Her layout: a run down the left wall, a corner
// unit (F15R, return to the wall) turning a peninsula row (F9, F17) off it, facing the back wall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { snapPosition } from '../src/interaction/snapping.js';
import { getCab } from '../src/core/catalogue.js';
import { planIslandBack } from '../src/core/islandback.js';
import { computeBackPanels } from '../src/core/backpanels.js';
import { spotOk } from '../src/core/placement.js';

const W = 144, D = 240, bounds = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
const BACK = 4.5;                                      // the peninsula row's back line (z)
function hers() {
  const s = new Store();
  s.setRoom({ width: W, depth: D, height: 96 });
  for (const [code, x, z, rotDeg, island] of [
    ['F17', -60, -29.75, 90], ['AP2', -58.75, -57.75, 90],                              // the left-wall run
    ['F15R', -38, -7.5, 180, true], ['F9', -14, -7.5, 180, true], ['F17', 10, -7.5, 180, true],   // corner + peninsula row
  ]) s.addItem(code, { x, z, rotDeg, island: !!island });
  return s;
}

test('a double dropped back to back with the corner stays there, hard to the side wall (not swung onto its run)', () => {
  for (const code of ['F10', 'F9', 'F2']) {
    const s = hers(), c = getCab(code);
    const it = s.addItem(code, { x: 0, z: 60, rotDeg: 0, island: true });
    const tx = bounds.minX + c.w / 2, tz = BACK + c.d / 2;
    const sn = snapPosition(s, it.id, tx, tz, bounds);
    assert.equal(sn.rotDeg, 0, `${code}: still facing the stools (it used to turn onto the left wall)`);
    assert.ok(Math.abs(sn.x - tx) < 0.01 && Math.abs(sn.z - tz) < 0.01, `${code}: back to back at the corner end (${sn.x}, ${sn.z})`);
    assert.equal(sn.flag, undefined);
    assert.ok(spotOk(s.state, c, sn.x, sn.z, 0, bounds, it.id));
  }
  // an ordinary cabinet dragged to that wall with nothing to stand back to back with still joins its run
  const s = hers(), it = s.addItem('F2', { x: 0, z: 60, rotDeg: 0 });
  assert.equal(snapPosition(s, it.id, bounds.minX + 12, 70, bounds).rotDeg, 90);
});

test('then the stool niche fills the leftover: from the double to the free end, nothing bare', () => {
  const s = hers();
  s.addItem('F10', { x: bounds.minX + 18, z: BACK + 12, rotDeg: 0, island: true });
  const f9 = s.state.items.find((i) => i.code === 'F9');
  const p = planIslandBack(s.state, f9.id, { niches: true });
  assert.ok(p.ok, p.reason);
  assert.equal(p.placements.length, 1);
  const n = p.placements[0], c = getCab(n.code);
  assert.ok(Math.abs((n.x - c.w / 2) - (bounds.minX + 36)) < 0.3, `starts at the double (${(n.x - c.w / 2).toFixed(2)})`);
  assert.ok(Math.abs((n.x + c.w / 2) - 20) < 0.3, `ends at the peninsula's free end (${(n.x + c.w / 2).toFixed(2)})`);
  // "this should line up with the cabinet, not be sat back": its legs and rail flush with the double's front
  assert.equal(c.d, 24, `as deep as the double (${n.code})`);
  assert.ok(Math.abs((n.z + c.d / 2) - (BACK + 24)) < 0.01, 'front flush with the double');
  assert.ok(Math.abs((n.z - c.d / 2) - BACK) < 0.01, 'back on the peninsula\'s back');
  const after = { ...s.state, items: [...s.state.items, { id: 99, ...n }] };
  assert.equal(computeBackPanels(after).length, 0, 'the whole back is covered');
  // pressed again: nothing left over
  assert.equal(planIslandBack(after, f9.id, { niches: true }).reason, 'already double');
  // a double in the MIDDLE: a niche each side of it
  const m = hers();
  m.addItem('F10', { x: -14, z: BACK + 12, rotDeg: 0, island: true });                 // x -32 .. 4
  const q = planIslandBack(m.state, m.state.items.find((i) => i.code === 'F9').id, { niches: true });
  assert.ok(q.ok, q.reason);
  assert.deepEqual(q.placements.map((pl) => { const pc = getCab(pl.code); return [+(pl.x - pc.w / 2).toFixed(2), +(pl.x + pc.w / 2).toFixed(2)]; }).sort((u, v) => u[0] - v[0]),
    [[-72, -32], [4, 20]], 'the wall to the double, and the 16" from the double to the free end');
  assert.ok(q.placements.every((pl) => getCab(pl.code).d === 24), 'both flush with the double between them');
  // with nothing on the back, the niche keeps its 300mm
  const bare = hers(), bp = planIslandBack(bare.state, bare.state.items.find((i) => i.code === 'F9').id, { niches: true });
  assert.ok(Math.abs(getCab(bp.placements[0].code).d - 300 / 25.4) < 1e-9);
});
