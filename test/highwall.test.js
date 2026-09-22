// highwall.test.js — full-height wall cabinets: the W range grown to the stacked height.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE, getCab, familyOf, swapAlternatives, FAMILY_ORDER } from '../src/core/catalogue.js';
import { planStackers } from '../src/core/stackers.js';
import { planCornice } from '../src/core/cornice.js';

test('W14-W35: every non-corner W cabinet in 45" and 51", hung at 56", priced at the wall cabinet + 20%', () => {
  const high = CATALOGUE.filter((c) => c.high);
  assert.equal(high.length, 22);
  assert.deepEqual(high.map((c) => c.code), Array.from({ length: 22 }, (_, i) => `W${14 + i}`));
  for (const c of high) {
    const src = getCab(c.grewFrom);
    assert.equal(c.type, 'WALL'); assert.equal(c.w, src.w); assert.equal(c.d, src.d); assert.equal(c.form, src.form);
    assert.equal(c.h, 30 + c.high); assert.ok([15, 21].includes(c.high));
    assert.equal(c.usd, Math.round(src.usd * 1.2), `${c.code} is ${c.grewFrom} + 20%`);
    assert.equal(familyOf(c), 'HIGH'); assert.ok(!c.corner && !c.stacker);
  }
  assert.ok(FAMILY_ORDER.indexOf('HIGH') === FAMILY_ORDER.indexOf('WALL') + 1, 'listed right after Wall');
  assert.equal(getCab('W15').usd, 2268); assert.equal(getCab('W26').h, 51);
});

test('a wall cabinet swaps in place for its full-height version; a full-height one takes no stacker', () => {
  const alts = swapAlternatives('W2').map((c) => c.code);
  assert.ok(alts.includes('W15') && alts.includes('W26'), '24" single -> 45" and 51"');
  const D = 160, st = { room: { width: 200, depth: D, height: 120, openings: [], cornice: 'plain' }, items: [{ id: 1, code: 'W15', x: 0, z: -D / 2 + 7.25, rotDeg: 0 }, { id: 2, code: 'W2', x: 30, z: -D / 2 + 7.25, rotDeg: 0 }] };
  const p = planStackers(st);
  assert.deepEqual(p.placements.map((q) => q.hostId), [2], 'only the standard cabinet is a host');
  // the crown sits on the full-height cabinet's OWN top (101"), not the standard 86" line
  const tops = new Set(planCornice(st).segments.map((s) => s.topY));
  assert.ok(tops.has(101) && tops.has(86));
});
