// endleg.test.js — F34, the End Leg: a single painted 22mm upright that gives a legless front its leg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCab, CATALOGUE } from '../src/core/catalogue.js';
import { computeWarnings } from '../src/core/warnings.js';
import { canHost } from '../src/core/sinkspec.js';
import { frontParts } from '../src/ui/frontdraw.js';
import { cabinetSVG } from '../src/ui/icon.js';
import { mmToIn } from '../src/core/units.js';

test('F34 is a 22mm floor-standing leg, 24 deep, 35 high, one product either hand', () => {
  const f = getCab('F34');
  assert.equal(f.type, 'FLOOR'); assert.equal(f.form, 'leg'); assert.ok(Math.abs(f.w - mmToIn(22)) < 1e-9); assert.deepEqual([f.d, f.h], [24, 35]);
  assert.ok(!f.corner && !f.cornerSide, 'no hand');
  assert.equal(f.usd, 150); assert.ok(!f.priceTBC);
  assert.ok(!canHost(f, getCab('AP6')) && !canHost(f, getCab('AP4')), 'nothing sits on it');
  assert.ok(frontParts(f).parts.length >= 1 && /<rect/.test(cabinetSVG(f)), 'it draws');
});

test('a dishwasher front at the end of a run beside an End Leg is no longer flagged', () => {
  const D = 120, z = -D / 2 + 12.25, f7 = getCab('F7'), leg = getCab('F34'), f10 = getCab('F10');
  const room = { width: 144, depth: D, height: 96, openings: [], boxings: [] };
  const dw = { id: 1, code: 'F7', x: 0, z, rotDeg: 0 }, base = { id: 2, code: 'F10', x: f7.w / 2 + f10.w / 2, z, rotDeg: 0 };
  const alone = computeWarnings({ room, items: [dw, base] }).filter((w) => /F7 appliance panel/.test(w.msg));
  assert.equal(alone.length, 1, 'open on one side: warned');
  const withLeg = computeWarnings({ room, items: [dw, base, { id: 3, code: 'F34', x: -f7.w / 2 - leg.w / 2, z, rotDeg: 0 }] }).filter((w) => /F7 appliance panel/.test(w.msg));
  assert.equal(withLeg.length, 0, 'the leg is a leg-bearing neighbour');
});
