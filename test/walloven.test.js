// Wall ovens (AP14 24", AP15 30", AP16 36") are RIDERS: they live inside an oven housing
// of their size, follow it, leave with it, and never trip the overlap rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { getCab, CATALOGUE } from '../src/core/catalogue.js';
import { ovenSeat, findOvenHost, housingCodeFor, housingTakes, ovenIn, isOven } from '../src/core/ovenseat.js';
import { snapPosition } from '../src/interaction/snapping.js';
import { computeWarnings } from '../src/core/warnings.js';
import { buildFloorplanSVG } from '../src/ui/floorplan.js';

const room = (st) => { st.setRoom({ width: 168, depth: 130, height: 96 }); return { minX: -84, maxX: 84, minZ: -65, maxZ: 65 }; };
const tallZ = -65 + 12 + 0.25 + 30 / 25.4;      // a tall stands 30mm proud of the wall line

test('three wall ovens and the under-counter oven in the catalogue, each with a housing made for it', () => {
  const ovens = CATALOGUE.filter(isOven);
  assert.deepEqual(ovens.map((o) => [o.code, o.ovenW]), [['AP14', 24], ['AP15', 30], ['AP16', 36], ['AP21', 24]]);
  for (const o of ovens) {
    const h = getCab(housingCodeFor(o));
    assert.ok(housingTakes(h, o), `${o.code} fits ${h.code}`);
    assert.ok(o.notSupplied && o.usd === 0, `${o.code} is supply-your-own`);
  }
  assert.ok(!housingTakes(getCab('T9'), getCab('AP15')), 'a 30" oven does not go in the 24" housing');
  assert.ok(!housingTakes(getCab('T3'), getCab('AP14')), 'a fridge housing is not an oven housing');
});

test('the oven sits exactly on the housing seat, inside the housing footprint', () => {
  for (const [oc, hc] of [['AP14', 'T9'], ['AP15', 'T14'], ['AP16', 'T15']]) {
    const o = getCab(oc), h = getCab(hc), seat = ovenSeat(h);
    assert.ok(Math.abs(o.mountY - seat.y0) < 1e-9, `${oc} mountY is the ${hc} seat`);
    assert.equal(o.h, seat.ovenH, `${oc} fills the seat height`);
    assert.ok(o.w - 0.25 <= seat.faceW, `${oc} front fits between the legs`);
    assert.ok(o.d <= h.d, `${oc} is no deeper than its housing`);
    assert.ok(o.mountY + o.h < h.h, 'below the top rail');
  }
});

test('snap: an oven only lands in an empty housing of its size', () => {
  const st = new Store(); const b = room(st);
  const t9 = st.addItem('T9', { x: -40, z: tallZ }), t14 = st.addItem('T14', { x: 30, z: tallZ });
  const o = st.addItem('AP15', { x: 0, z: 0 });
  const s = snapPosition(st, o.id, -38, -40, b);            // dropped right on the T9: goes to the T14 anyway
  assert.deepEqual([s.x, s.z, s.hostId, s.flag], [30, tallZ, t14.id, undefined]);
  st.updateItem(o.id, { x: s.x, z: s.z, rotDeg: s.rotDeg, hostId: s.hostId });
  const o2 = st.addItem('AP15', { x: 0, z: 0 });
  assert.equal(snapPosition(st, o2.id, 30, tallZ, b).flag, 'oven', 'the T14 is taken: a second 30" oven is refused');
  const o3 = st.addItem('AP14', { x: 0, z: 0 });
  assert.equal(snapPosition(st, o3.id, 0, 0, b).hostId, t9.id);
  assert.equal(findOvenHost(st.state, getCab('AP15'), 0, 0, o.id).id, t14.id, 'its own housing still counts as free for the oven already in it');
});

test('the oven follows its housing, leaves with it, and comes out when the housing is swapped away', () => {
  const st = new Store(); room(st);
  const h = st.addItem('T9', { x: -40, z: tallZ });
  const o = st.addItem('AP14', { x: -40, z: tallZ, hostId: h.id });
  st.updateItem(h.id, { x: 12 });
  assert.equal(st.getItem(o.id).x, 12, 'follows');
  assert.equal(ovenIn(st.state, h.id).id, o.id);
  st.swapItem(h.id, 'T4');                                   // same-width fridge housing: no oven seat
  assert.equal(st.getItem(o.id), undefined, 'swapped away: the oven comes out');
  const o2 = st.addItem('AP14', { x: 12, z: tallZ, hostId: h.id });
  st.swapItem(h.id, 'T9');
  st.removeItem(h.id);
  assert.equal(st.getItem(o2.id), undefined, 'leaves with its housing');
  st.undo();
  assert.ok(st.getItem(h.id) && st.getItem(o2.id), 'one undo brings both back');
});

test('a fitted oven never blocks a neighbour, never warns, and the plan draws the housing once', () => {
  const st = new Store(); const b = room(st);
  const h = st.addItem('T14', { x: 0, z: tallZ });
  st.addItem('AP15', { x: 0, z: tallZ, hostId: h.id });
  const base = st.addItem('F18', { x: 60, z: -65 + 12.25 });
  const s = snapPosition(st, base.id, 16.5 + 12 + 0.2, -65 + 12.25, b);
  assert.equal(s.flag, undefined, 'a base butts the housing as before');
  assert.ok(Math.abs(s.x - (16.5 + 12)) < 0.6, 'butted to the housing side');
  const msgs = computeWarnings(st.state).map((w) => w.msg).join(' | ');
  assert.ok(!/overlap|isn.t over a base/i.test(msgs), `no overlap / no-support warning: ${msgs}`);
  const svg = buildFloorplanSVG(st.state);
  assert.ok(svg.includes('>T14<') && !svg.includes('>AP15</text>\n') , 'housing labelled in plan');
  assert.ok(/Wall oven 30/.test(svg), 'the KEY still lists the oven');
});
