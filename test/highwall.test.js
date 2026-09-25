// highwall.test.js — full-height wall cabinets: the W range grown to the stacked height.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE, getCab, familyOf, swapAlternatives, FAMILY_ORDER } from '../src/core/catalogue.js';
import { planStackers } from '../src/core/stackers.js';
import { planCornice } from '../src/core/cornice.js';

test('W14-W24 and W27-W30: every W cabinet, corners included, at 51" (a tall + its 21" stacker), hung at 56", priced at the wall cabinet + 20%', () => {
  const high = CATALOGUE.filter((c) => c.high);
  assert.equal(high.length, 19);
  assert.deepEqual(high.map((c) => c.code), [...Array.from({ length: 11 }, (_, i) => `W${14 + i}`), 'W27', 'W28', 'W29', 'W30', 'W33', 'W34', 'W35', 'W36']);
  for (const c of high) {
    const src = getCab(c.grewFrom);
    assert.equal(c.type, 'WALL'); assert.equal(c.w, src.w); assert.equal(c.d, src.d); assert.equal(c.form, src.form);
    assert.equal(c.h, 51); assert.equal(c.high, 21);
    assert.equal(c.usd, Math.round(src.usd * 1.2), `${c.code} is ${c.grewFrom} + 20%`);
    assert.equal(familyOf(c), 'HIGH'); assert.ok(!c.stacker);
    assert.equal(!!c.corner, !!src.corner); assert.equal(c.cornerSide, src.cornerSide);
  }
  // the full-height corners (her ask 2026-09-25): W9 / W9R / W10 / W10R grown, skipping the taken W25 / W26
  const corners = high.filter((c) => c.corner);
  assert.deepEqual(corners.map((c) => [c.code, c.grewFrom, c.w, c.cornerSide, c.pair]), [['W27', 'W9', 20, 'left', false], ['W28', 'W9R', 20, 'right', false], ['W29', 'W10', 24, 'left', false], ['W30', 'W10R', 24, 'right', false],
    ['W33', 'W31', 36, 'left', true], ['W34', 'W31R', 36, 'right', true], ['W35', 'W32', 42, 'left', true], ['W36', 'W32R', 42, 'right', true]]);
  assert.equal(getCab('W27').usd, Math.round(2011 * 1.2)); assert.equal(getCab('W29').usd, Math.round(2160 * 1.2));
  assert.ok(!getCab('W26').high && getCab('W26').hoodCover, 'W26 is still the hood cover');
  const alts = swapAlternatives('W9').map((c) => c.code);
  assert.ok(alts.includes('W27') && alts.includes('W28') && !alts.includes('W15'), 'a corner swaps in place for its full-height version, never for a plain door');
  assert.ok(FAMILY_ORDER.indexOf('HIGH') === FAMILY_ORDER.indexOf('WALL') + 1, 'listed right after Wall');
  assert.equal(getCab('W15').usd, 2268); assert.equal(getCab('W15').h, 51); assert.ok(!getCab('W25').high, 'W25 is the 16in open shelf now, not a retired 51in code');
});

test('a wall cabinet swaps in place for its full-height version; a full-height one takes no stacker', () => {
  const alts = swapAlternatives('W2').map((c) => c.code);
  assert.ok(alts.includes('W15') && !alts.includes('W26'), '24" single -> its 51" version');
  const D = 160, st = { room: { width: 200, depth: D, height: 120, openings: [], cornice: 'plain' }, items: [{ id: 1, code: 'W15', x: 0, z: -D / 2 + 7.25, rotDeg: 0 }, { id: 2, code: 'W2', x: 30, z: -D / 2 + 7.25, rotDeg: 0 }] };
  const p = planStackers(st);
  assert.deepEqual(p.placements.map((q) => q.hostId), [2], 'only the standard cabinet is a host');
  // the crown sits on the full-height cabinet's OWN top (101"), not the standard 86" line
  const tops = new Set(planCornice(st).segments.map((s) => s.topY));
  assert.ok(tops.has(107) && tops.has(86));
});

test('corner wall cabinets come blank left AND blank right (her ask 2026-09-22)', async () => {
  const { getCab } = await import('../src/core/catalogue.js');
  for (const [l, r] of [['W9', 'W9R'], ['W10', 'W10R']]) {
    const a = getCab(l), b = getCab(r);
    assert.ok(a && b && a.corner && b.corner, `${l} and ${r} exist and are corner units`);
    assert.equal(a.cornerSide, 'left'); assert.equal(b.cornerSide, 'right');
    assert.ok(a.w === b.w && a.h === b.h && a.d === b.d && a.usd === b.usd, `${r} is ${l} handed the other way, same price`);
  }
});

test('W25 Open Shelves 10": a small open shelf for the gap beside a corner unit, price to confirm, with both stackers', async () => {
  const { getCab } = await import('../src/core/catalogue.js');
  const w = getCab('W25');
  assert.ok(w && w.type === 'WALL' && w.w === 10 && w.h === 30 && w.d === 14 && w.priceTBC && w.usd === 0);
  assert.equal(getCab('S33').w, 10); assert.equal(getCab('S34').h, 21);
});

test('an open shelf at any depth: W25:24 is the 10" shelf made 24" deep, whole inches, 8" to 36" (her ask 2026-09-23)', async () => {
  const { getCab, sizedShelfCode } = await import('../src/core/catalogue.js');
  const s = getCab('W25:24');
  assert.ok(s && s.d === 24 && s.w === 10 && s.baseCode === 'W25' && s.priceTBC && /24" deep/.test(s.desc));
  assert.equal(sizedShelfCode('W25', 14), 'W25', 'its own depth is its own code');
  assert.equal(sizedShelfCode('W11', 31.4), 'W11:31'); assert.equal(sizedShelfCode('W25', 60), 'W25:36');
  assert.equal(getCab('W2:24'), undefined, 'a door cabinet never sizes');
});

test('double wall corners W31 / W32 (+R) and their full-height W33-W36: a door PAIR beside the 10" return, both hands, priced as the double + the corner uplift (her rule 2026-09-25)', async () => {
  const { getCab, WALL_CORNER_UPLIFT } = await import('../src/core/catalogue.js');
  assert.equal(WALL_CORNER_UPLIFT, 207, 'the uplift is the average of W9 over W1 ($143) and W10 over W2 ($270)');
  assert.equal(getCab('W31').usd, 2551 + 207); assert.equal(getCab('W32').usd, 2658 + 207);
  assert.equal(getCab('W33').usd, Math.round((2551 + 207) * 1.2)); assert.equal(getCab('W36').usd, Math.round((2658 + 207) * 1.2));
  const { hingeOf, canFlipHinge } = await import('../src/core/hinge.js');
  const { frontParts, cornerReturnIn } = await import('../src/ui/frontdraw.js');
  for (const [code, w, side, h] of [['W31', 36, 'left', 30], ['W31R', 36, 'right', 30], ['W32', 42, 'left', 30], ['W32R', 42, 'right', 30], ['W33', 36, 'left', 51], ['W34', 36, 'right', 51], ['W35', 42, 'left', 51], ['W36', 42, 'right', 51]]) {
    const c = getCab(code);
    assert.ok(c && c.type === 'WALL' && c.corner && c.pair && c.form === 'corner', `${code} is a double corner`);
    assert.equal(c.w, w); assert.equal(c.d, 14); assert.equal(c.h, h); assert.equal(c.cornerSide, side);
    assert.ok(!c.priceTBC && c.usd > 0, `${code} is priced`);
    assert.equal(c.usd, h === 51 ? Math.round(getCab(c.grewFrom).usd * 1.2) : getCab(c.priceFrom).usd + WALL_CORNER_UPLIFT);
    assert.equal(hingeOf(c), 'PAIR'); assert.ok(!canFlipHinge(c));
    assert.equal(cornerReturnIn(c), 10);
    const parts = frontParts(c).parts;
    assert.equal(parts.filter((p) => p.k === 'line' && p.cls === 'leaf').length, 1, `${code} elevation draws the centre meeting line`);
    assert.ok(parts.some((p) => p.cls === 'return' && p.w === 10), `${code} elevation draws the return`);
  }
  assert.equal(hingeOf(getCab('W9')), 'L'); assert.equal(hingeOf(getCab('W30')), 'R');
  const alts = swapAlternatives('W31').map((c) => c.code);
  assert.ok(alts.includes('W33') && alts.includes('W31R') && !alts.includes('W18'), 'a double corner swaps for its other hand or its full-height version, never a plain double');
});
