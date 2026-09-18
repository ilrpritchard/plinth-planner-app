// Range cookers draw as ONE appliance everywhere: the 3D model, the catalogue
// icon, the elevation and the plan all read core/rangespec.js. 30" = four
// burners and one oven; 36" = six burners, one oven; 48" = six burners, a
// griddle and twin ovens. Node test, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rangeSpec, rangeCooktop, hobSpec } from '../src/core/rangespec.js';
import { getCab, CATALOGUE } from '../src/core/catalogue.js';
import { drawFront } from '../src/ui/frontdraw.js';
import { cabinetSVG } from '../src/ui/icon.js';

const EXPECT = { AP1: { burners: 4, ovens: 1, griddle: false }, AP2: { burners: 6, ovens: 1, griddle: false }, AP3: { burners: 6, ovens: 2, griddle: true } };

test('the catalogue carries a 30", a 36" and a 48" range', () => {
  const widths = CATALOGUE.filter((c) => c.appliance === 'range').map((c) => c.w).sort((a, b) => a - b);
  assert.deepEqual(widths, [30, 36, 48]);
});

test('burners, ovens, griddle and knobs per size', () => {
  for (const [code, e] of Object.entries(EXPECT)) {
    const cab = getCab(code), s = rangeSpec(cab), t = rangeCooktop(cab);
    assert.equal(t.burners.length, e.burners, `${code} burners`);
    assert.equal(s.ovens.length, e.ovens, `${code} ovens`);
    assert.equal(!!t.griddle, e.griddle, `${code} griddle`);
    assert.equal(s.knobs, e.burners + (e.griddle ? 1 : 0) + e.ovens, `${code}: a knob per burner, griddle and oven`);
  }
});

test('everything stays inside the appliance footprint and face', () => {
  for (const code of Object.keys(EXPECT)) {
    const cab = getCab(code), s = rangeSpec(cab), t = rangeCooktop(cab);
    for (const b of t.burners) {
      assert.ok(Math.abs(b.x) + b.r < cab.w / 2 && Math.abs(b.z) + b.r < cab.d / 2, `${code} burner inside the cooktop`);
    }
    for (let i = 0; i < t.burners.length; i++) for (let j = i + 1; j < t.burners.length; j++) {
      const a = t.burners[i], b = t.burners[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > a.r + b.r, `${code} burners never overlap`);
    }
    if (t.griddle) assert.ok(t.griddle.x + t.griddle.w / 2 < cab.w / 2, `${code} griddle inside the cooktop`);
    let prev = 0;
    for (const ov of s.ovens) { assert.ok(ov.x0 >= prev && ov.x1 > ov.x0 && ov.x1 <= cab.w, `${code} oven doors in order, inside the face`); prev = ov.x1; }
    assert.ok(s.kickH < s.doorY0 && s.doorY0 < s.doorY1 && s.doorY1 < s.railY0 && s.railY1 <= cab.h, `${code} kick < door < rail < top`);
  }
});

test('elevation and icon draw the doors the spec describes, elevation stays dashed with its code', () => {
  for (const [code, e] of Object.entries(EXPECT)) {
    const cab = getCab(code);
    const elev = drawFront(cab, 0, 0, (y) => cab.h - y, { code });
    assert.ok(elev.includes('stroke-dasharray') && elev.includes(`>${code}<`), `${code} dashed outline + code`);
    assert.equal((elev.match(/<rect /g) || []).length, 1 + e.ovens, `${code} elevation: outline + a rect per oven door`);
    assert.equal((elev.match(/<circle /g) || []).length, rangeSpec(cab).knobs, `${code} elevation knobs`);
    const icon = cabinetSVG(cab);
    assert.equal((icon.match(/<rect /g) || []).length, 2 + e.ovens * 2, `${code} icon: body, grates, then door + window per oven`);
  }
});

test('cooktops: four burners on the 30", five on the 36", a knob each, all on the glass and clear of each other', () => {
  for (const [code, n] of [['AP4', 4], ['AP5', 5]]) {
    const cab = getCab(code), hs = hobSpec(cab);
    assert.equal(hs.burners.length, n, `${code} burners`);
    assert.equal(hs.knobs.length, n, `${code} a knob per burner`);
    for (const b of hs.burners) assert.ok(Math.abs(b.x) + b.r * 1.3 < cab.w / 2 && Math.abs(b.z) + b.r * 1.3 < cab.d / 2, `${code} burner on the glass`);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = hs.burners[i], b = hs.burners[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > (a.r + b.r) * 1.3, `${code} burners never touch, even drawn bold`);
    }
    for (const k of hs.knobs) {
      assert.ok(Math.abs(k.x) < cab.w / 2 - 1 && k.z < cab.d / 2 - 0.8, `${code} knob on the glass`);
      for (const b of hs.burners) assert.ok(Math.hypot(k.x - b.x, k.z - b.z) > b.r * 1.3 + 0.6, `${code} knob clear of the burners`);
    }
    const icon = cabinetSVG(cab);
    assert.equal((icon.match(/<circle /g) || []).length, n * 3, `${code} icon: ring + cap per burner, a dot per knob`);
  }
});

