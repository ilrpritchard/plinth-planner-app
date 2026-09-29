// peninsula.test.js — W2W-243: the two peninsula layouts, the corner return that runs to a peninsula's
// back, ONE continuous end panel across an exposed back, and stool niches (her asks 2026-09-29).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCab } from '../src/core/catalogue.js';
import { generateKitchen, PEN_WALK } from '../src/core/layouts.js';
import { returnReach, cornerReturnLength } from '../src/core/cornerreturn.js';
import { computeBackPanels } from '../src/core/backpanels.js';
import { exposedBackIds, computeEndPanels } from '../src/core/endpanels.js';
import { planIslandBack } from '../src/core/islandback.js';
import { planWorktopSlabs } from '../src/core/worktop-plan.js';
import { hingeOf } from '../src/core/hinge.js';
import { mmToIn } from '../src/core/units.js';

const room = (w, d) => ({ width: w, depth: d, height: 96, openings: [], boxings: [] });

test('the peninsula shapes: a free leg of base cabinets only, and a fall-back when the room is too small', () => {
  for (const seed of [1, 7, 42, 99]) {
    const a = generateKitchen('peninsula', room(200, 170), seed, {});
    assert.deepEqual(a.pen, { side: 'left', walk: PEN_WALK });
    const leg = a.steps.filter((s) => s.wall === 'left').map((s) => getCab(s.code));
    assert.ok(leg.length > 0, 'a peninsula leg');
    assert.ok(leg.every((c) => c.type === 'FLOOR' || (c.type === 'APPLIANCES' && c.appliance === 'range')), 'no talls or fridge on a peninsula');
    assert.ok(leg.reduce((t, c) => t + c.w, 0) <= 170 - 24.3 - PEN_WALK + 0.01, 'the open end keeps its walkway');
    assert.ok(a.steps.some((s) => s.wall === 'back' && ['T3', 'AP9'].includes(s.code.split(':')[0])), 'the fridge goes on the back run');

    const c = generateKitchen('c-peninsula', room(220, 170), seed, {});
    assert.deepEqual(c.pen, { side: 'right', walk: PEN_WALK });
    const pen = c.steps.filter((s) => s.wall === 'right').map((s) => getCab(s.code));
    assert.ok(pen.length && pen.every((x) => x.type !== 'TALL'), 'the C: its peninsula leg has no talls');
    assert.ok(c.steps.some((s) => s.wall === 'left'), 'the C: the wall leg is still there');
  }
  // too narrow for a peninsula + 44" walkway: the plain shape, never a run stopping short for nothing
  assert.equal(generateKitchen('peninsula', room(150, 120), 1, {}).pen, null);
  assert.equal(generateKitchen('c-peninsula', room(170, 150), 1, {}).pen, null);
});

// a back-wall corner (blank left) with a peninsula leg standing 44" off the left wall, leg to leg
function penState() {
  const W = 200, D = 170, minX = -W / 2, minZ = -D / 2, legX = minX + PEN_WALK + 12.25;
  const corner = { id: 1, code: 'F16', x: legX + 12.25 + 12, z: minZ + 12.25, rotDeg: 0 };   // body edge on the leg's front plane
  const items = [corner,
    { id: 2, code: 'F20', x: legX, z: minZ + 24.3 + 18, rotDeg: 90 },
    { id: 3, code: 'F2', x: legX, z: minZ + 24.3 + 36 + 12, rotDeg: 90 }];
  return { room: room(W, D), items, finish: 'Ghost', legBack: legX - 12 };
}

test('a corner return runs to the peninsula back, not across the walkway (and a wall-leg is untouched)', () => {
  const s = penState(), corner = s.items[0], cab = getCab('F16');
  assert.equal(cornerReturnLength(cab, corner, s.room), 20, 'the wall is 68" away: the plain rule stops at the SKU 20"');
  const rr = returnReach(cab, corner, s.items, s.room);
  assert.ok(rr.leg, 'reached from the leg');
  assert.ok(Math.abs((corner.x - 12 - rr.len) - s.legBack) < 0.3, `return ends on the leg's back plane (${corner.x - 12 - rr.len} vs ${s.legBack})`);
  // an ordinary L: the leg stands on its wall, the return is exactly what it was
  const minX = -100, minZ = -85;
  const L = [{ id: 1, code: 'F16', x: minX + 24.25 + 12, z: minZ + 12.25, rotDeg: 0 }, { id: 2, code: 'F20', x: minX + 12.25, z: minZ + 24.3 + 18, rotDeg: 90 }];
  assert.equal(returnReach(cab, L[0], L, s.room).len, cornerReturnLength(cab, L[0], s.room));
  assert.equal(returnReach(cab, L[0], L, s.room).leg, false);
});

test('ONE continuous end panel across the peninsula back, the corner square included, and priced', () => {
  const s = penState();
  const panels = computeBackPanels(s);
  assert.equal(panels.length, 1, 'one panel, no joints');
  const p = panels[0];
  assert.ok(Math.abs(p.len - (24.25 + 36 + 24 + 0.05)) < 1, `runs from the back wall to the end of the leg (${p.len})`);
  assert.ok(Math.abs(p.x - (s.legBack - p.t / 2)) < 0.05, 'stands on the back plane, 22mm thick');
  assert.equal(p.h, 35);
  // priced: the two leg backs + the corner return's end
  const ends = computeEndPanels(s).count;
  assert.ok(ends >= 3, `end panels priced (${ends})`);
  // the worktop covers the corner square to the leg's back
  const slabs = planWorktopSlabs(s.items, getCab, 'marble', s.room);
  assert.ok(slabs.some((b) => b.x0 <= s.legBack + 0.01 && b.z0 <= -85 + 1 && b.x1 > s.legBack + 20), 'worktop over the corner square');
});

test('stool niches: 300mm deep, price to confirm, ONE niche the whole length of the island row', () => {
  for (const [code, w] of [['F35', 20], ['F36', 24], ['F37', 28], ['F38', 36], ['F39', 42]]) {
    const c = getCab(code);
    assert.equal(c.w, w); assert.ok(Math.abs(c.d - mmToIn(300)) < 1e-9); assert.equal(c.h, 35);
    assert.equal(c.form, 'niche'); assert.equal(c.priceTBC, true); assert.equal(c.usd, 0);
    assert.equal(hingeOf(c), null, 'no door, no hinge');
  }
  // a single-row island facing the back run (rot 180), 36 + 24
  const items = [{ id: 1, code: 'F20', x: -12, z: 0, rotDeg: 180, island: true }, { id: 2, code: 'F2', x: 18, z: 0, rotDeg: 180, island: true }];
  const s = { room: room(200, 200), items, finish: 'Ghost' };
  assert.equal(exposedBackIds(s).size, 2, 'before: two exposed backs');
  const p = planIslandBack(s, 1, { niches: true });
  assert.ok(p.ok, p.reason);
  // one bay behind the whole row, legs at its two ends only (her ask 2026-09-29: "no legs... whatever
  // length the island is, the stool niche stretches"), not a niche per cabinet with a leg at every joint
  assert.equal(p.placements.length, 1, 'one niche');
  const one = p.placements[0], oc = getCab(one.code);
  assert.equal(one.code, 'F35:w60'); assert.equal(oc.w, 60); assert.equal(oc.form, 'niche'); assert.equal(oc.priceTBC, true);
  assert.ok(Math.abs(one.x - 0) < 0.01, 'centred on the row (-30 .. 30)');
  for (const q of p.placements) {
    assert.equal(q.rotDeg, 0, 'the open side faces away from the island');
    assert.ok(Math.abs((q.z - getCab(q.code).d / 2) - 12) < 0.01, 'back to back with the island row');
  }
  const after = { ...s, items: [...items, ...p.placements.map((q, i) => ({ id: 10 + i, ...q }))] };
  assert.equal(exposedBackIds(after).size, 0, 'the island backs are covered by the niches');
  assert.equal(computeBackPanels(after).length, 0);
  const slabs = planWorktopSlabs(after.items, getCab, 'marble', after.room);
  assert.ok(slabs.some((b) => b.z1 >= 12 + mmToIn(300) - 0.01), 'the worktop runs over the niches');
});
