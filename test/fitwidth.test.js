// fitwidth.test.js — open shelves and the tray space cut to fit (her ask 2026-09-26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCab, sizedWidthCode, canFitWidth, FIT_WIDTH_LIMITS } from '../src/core/catalogue.js';
import { planFitToGap, planSetWidth } from '../src/core/fitwidth.js';
import { rowsFromDesign } from '../src/core/cost.js';
import { buildPlanDXF } from '../src/core/dxf.js';

test('a sized-width code is a real cabinet: its width, priced as the next standard size up, labelled cut to fit', () => {
  const c = getCab('W22:w14');
  assert.ok(c && c.w === 14 && c.baseCode === 'W22' && c.cutToFit && /cut to fit/.test(c.desc));
  assert.equal(c.usd, getCab('W22').usd, 'a 14" full-height shelf is priced as the 20"');
  assert.equal(getCab('W22:w26').usd, getCab('W24').usd, 'a 26" is priced as the 28" (W24)');
  assert.equal(getCab('W22:w40').usd, getCab('W24').usd, 'wider than any standard: the widest');
  assert.equal(getCab('F8:w6').w, 6); assert.equal(getCab('F8:w6').usd, getCab('F8').usd);
  assert.equal(sizedWidthCode('W22', 20), 'W22', 'the standard width is the plain code');
  assert.equal(sizedWidthCode('W22', 14.3), 'W22:w14.5', 'half inches');
  assert.equal(getCab('W22:w60').w, FIT_WIDTH_LIMITS[1], 'clamped');
  assert.equal(getCab('F2:w14'), undefined, 'a door cabinet is never cut');
  assert.ok(canFitWidth(getCab('W11')) && canFitWidth(getCab('F8')) && canFitWidth(getCab('F23')) && !canFitWidth(getCab('W2')) && !canFitWidth(getCab('W9')));
});

test('dropped touching a tall with a 14" sliver to the wall, a 20" shelf becomes 34" and shifts half the sliver toward the wall', () => {
  const plan = planFitToGap(getCab('W22'), { w: 20, before: { gap: 0, to: 'T1' }, after: { gap: 14, to: 'wall' } });
  assert.deepEqual(plan, { code: 'W22:w34', w: 34, shift: 7 });
  const other = planFitToGap(getCab('W22'), { w: 20, before: { gap: 3, to: 'wall' }, after: { gap: 0.1, to: 'W5' } });
  assert.deepEqual(other, { code: 'W22:w23', w: 23, shift: -1.5 });
  assert.equal(planFitToGap(getCab('W22'), { w: 20, before: { gap: 0, to: 'T1' }, after: { gap: 0, to: 'W5' } }), null, 'snug: nothing to do');
  assert.equal(planFitToGap(getCab('W22'), { w: 20, before: { gap: 0, to: 'T1' }, after: { gap: 30, to: 'wall' } }), null, 'a 30" gap is a cabinet, not a leftover');
  assert.equal(planFitToGap(getCab('W2'), { w: 24, before: { gap: 0, to: 'T1' }, after: { gap: 6, to: 'wall' } }), null, 'a door cabinet never grows');
  assert.deepEqual(planFitToGap(getCab('F8'), { w: 10, before: { gap: 2, to: 'F2' }, after: { gap: 3, to: 'AP2' } }), { code: 'F8:w15', w: 15, shift: 0.5 }, 'loose in a slot: fills it');
});

test('a typed width keeps the touching edge; the rows, the price and the DXF all know a cut shelf', () => {
  assert.deepEqual(planSetWidth(getCab('W22'), { w: 20, before: { gap: 0, to: 'T1' }, after: { gap: 40, to: 'wall' } }, 12), { code: 'W22:w12', w: 12, shift: -4 });
  const state = { room: { width: 200, depth: 150, height: 96, openings: [] }, finish: 'Ghost', items: [ { id: 1, code: 'W22:w14', x: -60, z: -68, rotDeg: 0 }, { id: 2, code: 'F8:w6', x: -30, z: -62.75, rotDeg: 0 } ] };
  assert.deepEqual(rowsFromDesign(state.items), [{ code: 'F8:w6', qty: 1 }, { code: 'W22:w14', qty: 1 }]);
  const dxf = buildPlanDXF(state, { walls: false });
  assert.ok(dxf.includes('\n2\nW22_w14_UNIT\n') && !dxf.includes('W22:w14_UNIT'), 'a block name a DXF reader accepts');
});

test('her share link: a 20" shelf dropped between an upper and a corner bulkhead is cut down to the 15.5" slot', async () => {
  const { planShrinkToSlot, wallNear } = await import('../src/core/fitwidth.js');
  const W = 216, D = 240, b = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
  const state = { room: { width: W, depth: D, height: 110, boxings: [{ id: 1, wall: 'back', pos: 1, w: 25.5, d: 28 }] }, items: [
    { id: 30, code: 'W19', x: 46, z: -D / 2 + 7.25, rotDeg: 0 },            // 25..67 on the back wall
    { id: 7, code: 'F20', x: 42, z: -D / 2 + 12.25, rotDeg: 0 },            // a base below: not in the shelf's height band
    { id: 31, code: 'W22:36', x: -89.75, z: 24.25, rotDeg: 0 } ] };
  const wn = wallNear(b, 87, -110);
  assert.deepEqual([wn.wall, wn.along], ['back', 87]);
  const plan = planShrinkToSlot(state, getCab('W22:36'), wn.wall, wn.along, b, 31);
  assert.ok(plan, 'a slot was found');
  assert.equal(plan.w, 15.5); assert.equal(plan.code, 'W22:w15.5');
  assert.ok(Math.abs(plan.x - (67 + 82.5) / 2) < 0.01 && plan.rotDeg === 0 && Math.abs(plan.z - (-D / 2 + 14 / 2 + 0.25)) < 0.01, 'centred in the slot, on the wall, back at 14" deep');
  assert.equal(planShrinkToSlot(state, getCab('W22'), 'back', -10, b, 31), null, 'inside the bulkhead-free run where it fits: nothing to shrink');
  assert.equal(planShrinkToSlot(state, getCab('W2'), 'back', 75, b, 31), null, 'a door cabinet is never cut');
});
