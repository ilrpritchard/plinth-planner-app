// tallknob.test.js — a TALL two-panel door carries its knob ON THE MID RAIL (the 200mm band
// between the 1184 upper and 490 lower panels), never at the leaf's centre; every other door
// keeps its knob at mid-height. And a tall DOUBLE (T13) draws its mid rails in 2D like the single.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildCabinet, tallMidRail } from '../src/models/cabinet.js';
import { frontParts } from '../src/ui/frontdraw.js';
import { cabinetSVG } from '../src/ui/icon.js';
import { getCab, FINISHES } from '../src/core/catalogue.js';

const knobs = (code) => {
  const g = buildCabinet(getCab(code), FINISHES[1].hex, { hinge: 'L' });
  const out = [];
  g.traverse((o) => { if (o.name === 'knob') out.push(o); });
  return out;
};
const leafHeight = (knob) => { const b = new THREE.Box3().setFromObject(knob.parent); return b.max.y - b.min.y; };

test('every full-height tall door (single, larder, pair, fridge housing, panel-ready column) puts its knob on the mid rail', () => {
  for (const code of ['T1', 'T2', 'T5', 'T7', 'T13', 'T3', 'T4', 'T10', 'T12']) {
    const ks = knobs(code);
    assert.ok(ks.length >= 1, `${code}: no knob`);
    for (const k of ks) {
      const h = leafHeight(k);
      assert.ok(h > 60, `${code}: leaf is ${h.toFixed(1)}" tall`);
      const rail = tallMidRail(h);
      assert.ok(Math.abs(k.position.y - rail.y) < 0.05, `${code}: knob at ${k.position.y.toFixed(2)}, rail at ${rail.y.toFixed(2)}`);
      assert.ok(k.position.y < -10, `${code}: the rail is well below the leaf centre (got ${k.position.y.toFixed(1)})`);
    }
  }
});

test('the rail sits 490mm + 80mm stile + half the 200mm band above the door bottom: 26.4" on a T1', () => {
  const k = knobs('T1')[0], h = leafHeight(k);
  const fromBottom = k.position.y + h / 2;
  assert.ok(Math.abs(fromBottom - 26.4) < 0.6, `knob ${fromBottom.toFixed(1)}" above the door bottom`);
});

test('base, wall and full-height-upper doors keep the knob at mid-height', () => {
  for (const code of ['F2', 'F10', 'W1', 'W14']) {
    for (const k of knobs(code)) assert.equal(k.position.y, 0, `${code}: knob y`);
  }
});

test('T13 Tall Double: both leaves carry the 1184 / 200 / 490 panels in the elevation and the picker tile', () => {
  const single = frontParts(getCab('T1')).parts.filter((p) => p.k === 'rect' && p.cls === 'panel');
  const pair = frontParts(getCab('T13')).parts.filter((p) => p.k === 'rect' && p.cls === 'panel');
  assert.equal(single.length, 2, 'T1 has two panels');
  assert.equal(pair.length, 4, 'T13 has two panels per leaf');
  const ys = (ps) => [...new Set(ps.map((p) => `${p.y.toFixed(2)}-${(p.y + p.h).toFixed(2)}`))].sort();
  assert.deepEqual(ys(pair), ys(single), 'the same panel zones as the single tall door');
  // the picker tile: a T13 draws as many panel rectangles as two T1 tiles (a plain double drew none of the rails)
  const count = (svg) => (svg.match(/<rect /g) || []).length;
  assert.equal(count(cabinetSVG(getCab('T13'))), count(cabinetSVG(getCab('T1'))) + 3, 'T13 tile = T1 tile + one more door edge + two more panels');
});
