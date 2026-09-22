// ovenbase.test.js — F32, the under-counter oven housing: a floor cabinet with the 24" oven (AP21)
// riding right under its top rail and a 60cm cooktop (AP22) on the worktop over it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCab, CATALOGUE } from '../src/core/catalogue.js';
import { ovenSeat, housingTakes, housingCodeFor, findOvenHost } from '../src/core/ovenseat.js';
import { canHost } from '../src/core/sinkspec.js';
import { frontParts } from '../src/ui/frontdraw.js';
import { SPEC, mmToIn, SURFACE_Y } from '../src/core/units.js';
import { summarize } from '../src/core/cost.js';

test('F32 is a 24" floor cabinet with the oven aperture under the top rail and a drawer panel below', () => {
  const f = getCab('F32');
  assert.equal(f.type, 'FLOOR'); assert.equal(f.form, 'ovenBase'); assert.deepEqual([f.w, f.d, f.h], [24, 24, 35]);
  const s = ovenSeat(f);
  assert.ok(Math.abs(s.ovenH - mmToIn(595)) < 1e-9, 'a 595mm oven (Miele H7660BP)');
  assert.ok(Math.abs((s.y0 + s.ovenH) - (35 - mmToIn(35))) < 1e-9, 'the oven top is the top of the opening, under the 35mm rail');
  assert.ok(Math.abs(s.openY0 - (SPEC.PLINTH_IN + SPEC.PANEL_IN)) < 1e-9, 'stands on the same plinth as every floor cabinet');
  assert.ok(s.drawH > 3 && s.doorH === 0, 'a slim drawer panel, no low door');
  assert.ok(Math.abs(s.railH - SPEC.PANEL_IN) < 1e-9 && Math.abs((s.openY0 + s.drawH + 2 * SPEC.REVEAL_IN + s.railH) - s.y0) < 1e-9, 'a 22mm rail between the drawer and the oven, nothing open');
  assert.equal(getCab('AP21').mountY, s.y0, 'the oven appliance sits on that seat');
  const parts = frontParts(f).parts;
  assert.ok(parts.some((p) => p.k === 'text' && p.s === 'OVEN') && parts.some((p) => p.k === 'rect' && p.cls === 'drawer'));
});

test('the under-counter oven pairs only with F32; a wall oven never goes in it', () => {
  const f = getCab('F32'), o = getCab('AP21'), w = getCab('AP14'), t9 = getCab('T9');
  assert.ok(housingTakes(f, o)); assert.ok(!housingTakes(f, w)); assert.ok(!housingTakes(t9, o));
  assert.equal(housingCodeFor(o), 'F32');
  const st = { items: [{ id: 1, code: 'F32', x: 0, z: -48, rotDeg: 0 }, { id: 2, code: 'T9', x: 40, z: -48, rotDeg: 0 }] };
  assert.equal(findOvenHost(st, o, 0, 0).id, 1, 'the oven finds the base housing, not the tall');
});

test('a cooktop may sit on the oven housing; a sink may not; priced as the 24" single base for now', () => {
  const f = getCab('F32');
  assert.ok(canHost(f, getCab('AP22'))); assert.ok(canHost(f, getCab('AP4'))); assert.ok(!canHost(f, getCab('AP6')));
  const hob = getCab('AP22');
  assert.ok(Math.abs(hob.w - 22.9) < 0.01 && hob.mountY === SURFACE_Y && hob.notSupplied, 'a 582mm four-burner hob, supply your own');
  const sum = summarize([{ id: 1, code: 'F32', x: 0, z: 0, rotDeg: 0 }, { id: 2, code: 'F2', x: 30, z: 0, rotDeg: 0 }]);
  const line = sum.lines.find((l) => l.code === 'F32');
  assert.ok(!line.priceTBC && line.line === getCab('F2').usd && sum.subtotal === 2 * getCab('F2').usd, 'F32 is priced as F2 (her call 2026-09-22)');
  assert.deepEqual(CATALOGUE.filter((c) => c.priceTBC).map((c) => c.code), ['W25', 'W26', 'S33', 'S34'], 'only the 10in open shelf, the hood cover and the shelf stackers wait on a price (2026-09-22)');
});

test('the cooktop (and any sink) rides its base: move the base, turn it, and it comes along', async () => {
  const { Store } = await import('../src/core/store.js');
  const store = new Store(); store.setRoom({ width: 200, depth: 160, height: 96 });
  const base = store.addItem('F32', { x: 0, z: -68, rotDeg: 0 });
  const oven = store.addItem('AP21', { x: 0, z: -68, rotDeg: 0, hostId: base.id });
  const hob = store.addItem('AP22', { x: 0, z: -68, rotDeg: 0 });
  const sinkBase = store.addItem('F10', { x: 60, z: -68, rotDeg: 0 }); const sink = store.addItem('AP6', { x: 62, z: -68, rotDeg: 0 });
  store.updateItem(base.id, { x: 30 });
  assert.equal(store.getItem(hob.id).x, 30, 'the cooktop moved with the housing'); assert.equal(store.getItem(oven.id).x, 30, 'so did the oven');
  assert.equal(store.getItem(sink.id).x, 62, 'the sink on the other base did not');
  store.updateItem(sinkBase.id, { x: 90, z: -60, rotDeg: 90 });
  const s2 = store.getItem(sink.id);
  assert.ok(Math.abs(s2.x - 90) < 1e-9 && Math.abs(s2.z - (-60 - 2)) < 1e-9 && s2.rotDeg === 90, `the sink turned with its base: ${JSON.stringify(s2)}`);
});

test('a sink hung over the edge of a narrow base still rides with it', async () => {
  const { Store } = await import('../src/core/store.js');
  const store = new Store(); store.setRoom({ width: 200, depth: 160, height: 96 });
  const base = store.addItem('F1', { x: 0, z: -68, rotDeg: 0 });                 // a 20" single
  const sink = store.addItem('AP6', { x: 11, z: -68, rotDeg: 0 });               // a 24" sink, its centre 1" past the base's edge
  store.updateItem(base.id, { x: 40 });
  assert.equal(store.getItem(sink.id).x, 51, 'the sink came along at the same offset');
});

test('the 30" cooktop is a five-burner; the 24" stays four', async () => {
  const { hobSpec } = await import('../src/core/rangespec.js');
  assert.equal(hobSpec(getCab('AP4')).burners.length, 5); assert.equal(hobSpec(getCab('AP5')).burners.length, 5); assert.equal(hobSpec(getCab('AP22')).burners.length, 4);
});
