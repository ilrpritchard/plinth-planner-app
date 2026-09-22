// hoodseat.test.js — a range hood sits centred over the cooker, 800mm above its top.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHoodSeat, hoodMountY, HOOD_CLEAR_IN } from '../src/core/hoodseat.js';
import { getCab } from '../src/core/catalogue.js';
import { SURFACE_Y } from '../src/core/units.js';

const W = 200, D = 160, hood = getCab('AP8'), range = getCab('AP2'), hob = getCab('AP5');
const room = { width: W, depth: D, height: 96, openings: [] };

test('centred over the nearest cooker, back on its wall, 800mm above the range top', () => {
  const items = [{ id: 1, code: 'AP2', x: -40, z: -D / 2 + range.d / 2 + 0.25, rotDeg: 0 }, { id: 2, code: 'AP5', x: 50, z: 20, rotDeg: 0, island: true }];
  const s = findHoodSeat({ room, items }, -30, -60, null, hood);
  assert.equal(s.cookerId, 1); assert.equal(s.x, -40); assert.equal(s.rotDeg, 0);
  assert.ok(Math.abs(s.z - (-D / 2 + hood.d / 2 + 0.25)) < 1e-9, 'back on the wall');
  assert.ok(Math.abs(s.mountY - (36 + HOOD_CLEAR_IN)) < 1e-9 && Math.abs(HOOD_CLEAR_IN - 800 / 25.4) < 1e-9);
  // the island cooktop: straight over it, at 800mm above the cooktop
  const t = findHoodSeat({ room, items }, 50, 20, null, hood);
  assert.equal(t.cookerId, 2); assert.equal(t.x, 50); assert.equal(t.z, 20);
  assert.ok(Math.abs(t.mountY - (SURFACE_Y + hob.h + HOOD_CLEAR_IN)) < 1e-9);
  assert.ok(Math.abs(hoodMountY(range) - hood.mountY) < 1e-9, 'the catalogue default is the same rule over a range');
});

test('a cooker on a side wall turns the hood; no cooker means no seat', () => {
  const side = [{ id: 1, code: 'AP2', x: W / 2 - range.d / 2 - 0.25, z: 10, rotDeg: 270 }];
  const s = findHoodSeat({ room, items: side }, 0, 0, null, hood);
  assert.equal(s.rotDeg, 270); assert.equal(s.z, 10); assert.ok(Math.abs(s.x - (W / 2 - hood.d / 2 - 0.25)) < 1e-9);
  assert.equal(findHoodSeat({ room, items: [] }, 0, 0, null, hood), null);
});

test('the 24" hood: same seat rule, narrower canopy; the F32 stack brings it', () => {
  const h24 = getCab('AP23');
  assert.equal(h24.appliance, 'hood'); assert.ok(Math.abs(h24.w - 23.6) < 0.01 && h24.notSupplied);
  assert.ok(Math.abs(h24.mountY - (36 + HOOD_CLEAR_IN)) < 1e-9);
  const items = [{ id: 1, code: 'AP22', x: 10, z: -D / 2 + 12.25, rotDeg: 0 }];
  const s = findHoodSeat({ room, items }, 10, -60, null, h24);
  assert.equal(s.x, 10); assert.ok(Math.abs(s.z - (-D / 2 + h24.d / 2 + 0.25)) < 1e-9, 'its own depth against the wall');
});

test('the washing machine stands on the floor in the run and the worktop runs over it', async () => {
  const { planWorktopSlabs } = await import('../src/core/worktop-plan.js');
  const wm = getCab('AP24');
  assert.ok(wm.appliance === 'washer' && wm.mountY === 0 && wm.underCounter && wm.notSupplied && wm.h < 35);
  const D2 = 120, z = -D2 / 2 + 12.25, items = [{ id: 1, code: 'F2', x: -24, z, rotDeg: 0 }, { id: 2, code: 'AP24', x: 0, z: -D2 / 2 + wm.d / 2 + 0.25, rotDeg: 0 }, { id: 3, code: 'F2', x: 24, z, rotDeg: 0 }];
  const slabs = planWorktopSlabs(items, getCab, 'marble', { width: 144, depth: D2, height: 96, openings: [], boxings: [] });
  const over = slabs.some((s) => s.x0 < -1 && s.x1 > 1 && s.z0 < z && s.z1 > z);
  assert.ok(over, `one slab runs over the washer: ${JSON.stringify(slabs)}`);
  // ...unlike a range, which the top stops dead at
  const withRange = planWorktopSlabs([items[0], { id: 2, code: 'AP1', x: 3, z: -D2 / 2 + 13.25, rotDeg: 0 }, items[2]], getCab, 'marble', { width: 144, depth: D2, height: 96, openings: [], boxings: [] });
  assert.ok(!withRange.some((s) => s.x0 < 3 && s.x1 > 3 && s.z0 < z && s.z1 > z), 'no slab over the range');
});
