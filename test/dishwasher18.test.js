// dishwasher18.test.js — the 18" dishwasher front is an F7 in every rule but width.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCab } from '../src/core/catalogue.js';
import { cabinetSVG } from '../src/ui/icon.js';

test('F33: an 18" dishwasher door and plinth, dishwasher-form like F7, price to confirm', () => {
  const f = getCab('F33'), f7 = getCab('F7');
  assert.deepEqual([f.type, f.w, f.d, f.h, f.form], ['FLOOR', 18, 24, 35, 'dishwasher']);
  assert.equal(f7.form, 'dishwasher');
  assert.equal(f.usd, Math.round(f7.usd * 0.8), 'F7 less 20% (her call 2026-09-22)'); assert.ok(!f.priceTBC);
});

test('the catalogue icon for a dishwasher front is a shaker leaf with a knob, not a bare rectangle', () => {
  for (const code of ['F7', 'F33']) {
    const svg = cabinetSVG(getCab(code));
    assert.ok(/<circle/.test(svg), `${code}: a knob`);
    assert.ok((svg.match(/<rect/g) || []).length >= 3, `${code}: a panel inside the leaf`);
  }
});
