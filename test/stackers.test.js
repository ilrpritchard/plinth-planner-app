// stackers.test.js — the right stacker lands on every tall, wall and counter cabinet in one press.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStackers, stackerFor, resizeStackers } from '../src/core/stackers.js';
import { getCab, CATALOGUE } from '../src/core/catalogue.js';

const W = 200, D = 160;
const room = (height) => ({ width: W, depth: D, height, openings: [] });
const back = (id, code, x) => { const c = getCab(code); return { id, code, x, z: -D / 2 + c.d / 2 + 0.25 + (c.type === 'TALL' ? 1.18 : 0), rotDeg: 0 }; };
const items = [back(1, 'T1', -80), back(2, 'T11', -50), back(3, 'W2', -10), back(4, 'W5', 20), back(5, 'C3', 60), back(6, 'F10', 60)];

test('every stacker is matched by the "fits" list, in the height the ceiling allows', () => {
  assert.equal(stackerFor('T1', 15).code, 'S1'); assert.equal(stackerFor('T11', 21).code, 'S12');
  assert.equal(stackerFor('W2', 15).code, 'S16'); assert.equal(stackerFor('C3', 21).code, 'S31');
  assert.equal(stackerFor('F10', 15), null);
  const p = planStackers({ room: room(108), items });          // 9' ceiling: 15" stackers
  assert.equal(p.ok, true); assert.equal(p.size, 15);
  assert.deepEqual(p.placements.map((q) => q.code), ['S1', 'S5', 'S16', 'S18', 'S27']);
  for (const q of p.placements) { const host = items.find((i) => i.id === q.hostId), s = getCab(q.code); assert.equal(q.x, host.x); assert.ok(Math.abs(q.z - (-D / 2 + s.d / 2 + 0.25 + (s.onTall ? 30 / 25.4 : 0))) < 1e-9, 'back on the wall, or proud with its tall'); }
  assert.equal(planStackers({ room: room(120), items }).size, 21);
});

test('too low a ceiling is refused; a stacked host, a corner unit and an island tall are skipped and named', () => {
  const low = planStackers({ room: room(96), items });
  assert.equal(low.ok, false); assert.equal(low.reason, 'too low'); assert.equal(low.need, 104);
  const s1 = getCab('S1'), withOne = [...items, { id: 9, code: 'S1', x: -80, z: -D / 2 + s1.d / 2 + 0.25, rotDeg: 0 }, back(10, 'W10', 90), { id: 11, code: 'T1', x: 0, z: 20, rotDeg: 0, island: true }];
  const p = planStackers({ room: room(108), items: withOne });
  assert.ok(!p.placements.some((q) => q.hostId === 1), 'T1 already has its stacker');
  assert.deepEqual(p.skipped.map((k) => [k.id, k.why]).sort((a, b) => a[0] - b[0]), [[1, 'already stacked'], [10, 'corner'], [11, 'off the wall']]);
  // one wall at a time
  assert.equal(planStackers({ room: room(108), items: [...items, { id: 12, code: 'T1', x: W / 2 - 12.25 - 1.18, z: 30, rotDeg: 270 }] }, 'left').placements.length, 1);
});

test("a new ceiling resizes the stackers already placed: up to 21\", back to 15\", none when too low", () => {
  const placed = planStackers({ room: room(108), items }).placements.map((q, i) => ({ id: 100 + i, code: q.code, x: q.x, z: q.z, rotDeg: q.rotDeg }));
  const all = [...items, ...placed];
  assert.deepEqual(resizeStackers({ room: room(108), items: all }), [], "already the right height");
  const up = resizeStackers({ room: room(110), items: all });          // 9' 2": 86 + 21 + 3
  assert.equal(up.length, placed.length);
  for (const sw of up) { const host = items.find((i) => i.x === all.find((o) => o.id === sw.id).x); assert.equal(sw.to, stackerFor(host.code, 21).code); }
  const tall = all.map((o) => { const sw = up.find((u) => u.id === o.id); return sw ? { ...o, code: sw.to } : o; });
  assert.deepEqual(resizeStackers({ room: room(106), items: tall }).map((s) => s.to), placed.map((q) => q.code), "back down to 15\"");
  assert.deepEqual(resizeStackers({ room: room(96), items: tall }), [], "too low: left for the warning");
});

test('made to height, when asked: fills the ceiling 12" to 30", at the 21" price + 15%, and refits with the ceiling', () => {
  const p = planStackers({ room: room(113), items });                 // 9' 5": 21" standard, 24" made to height on offer
  assert.equal(p.size, 21); assert.equal(p.bespoke, 24);
  const m = planStackers({ room: room(113), items }, null, null, { bespoke: true });
  assert.equal(m.size, 24); assert.equal(m.bespoke, 0);
  for (const q of m.placements) {
    const c = getCab(q.code), at21 = getCab(planStackers({ room: room(113), items }).placements.find((s) => s.hostId === q.hostId).code);
    assert.equal(c.h, 24); assert.ok(c.madeToHeight); assert.equal(c.usd, Math.round(at21.usd * 1.15)); assert.equal(c.mountY, at21.mountY);
  }
  assert.equal(planStackers({ room: room(110), items }).bespoke, 0, 'a ceiling 21" fills exactly offers nothing extra');
  assert.equal(planStackers({ room: room(140), items }, null, null, { bespoke: true }).size, 30, 'never over 30"');
  const low = planStackers({ room: room(102), items });              // too low for 15", room for 13" made to height
  assert.equal(low.ok, false); assert.equal(low.bespoke, 13);
  assert.equal(planStackers({ room: room(100), items }).bespoke, 0, 'under 12" none');
  // a made-to-height stacker refits to the new ceiling; landing on 21" it becomes the standard code
  const placed = [...items, ...m.placements.map((q, i) => ({ id: 200 + i, code: q.code, x: q.x, z: q.z, rotDeg: q.rotDeg }))];
  const re = resizeStackers({ room: room(116), items: placed });
  assert.ok(re.length === m.placements.length && re.every((s) => getCab(s.to).h === 27 && getCab(s.to).madeToHeight));
  const back21 = resizeStackers({ room: room(110), items: placed });
  assert.ok(back21.every((s) => getCab(s.to).h === 21 && !getCab(s.to).madeToHeight));
});

// ---- a stacker RIDES its host (her call 2026-10-14: "the stacker should never be allowed to
// move off the tall cabinet"): it only lands on a host it fits, follows the host, and leaves with it
import { Store } from '../src/core/store.js';
import { snapPosition } from '../src/interaction/snapping.js';
import { findStackerSeat, stackerHostOf, stackerOn, stackerSeat } from '../src/core/stackers.js';

const roomOf = (st) => { st.setRoom({ width: W, depth: D, height: 108 }); return { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 }; };
const tallZ = -D / 2 + 12 + 0.25 + 30 / 25.4;

test('dragged, a stacker only ever lands on an unstacked host it fits; off every host it is refused and stays put', () => {
  const st = new Store(); const b = roomOf(st);
  const t4 = st.addItem('T4', { x: -60, z: tallZ }), t9 = st.addItem('T9', { x: 20, z: tallZ }), t1 = st.addItem('T1', { x: 60, z: tallZ });
  st.addItem('F10', { x: -20, z: -D / 2 + 12.25 });
  const s = st.addItem('S11', { x: -60, z: tallZ, rotDeg: 0, hostId: t4.id });          // Double 21" fits T4, T9
  const seat = stackerSeat(st.state, t4, getCab('S11'));
  // pulled sideways over the base cabinet (her screenshot 2026-10-14): it stays on its tall
  const off = snapPosition(st, s.id, -30, tallZ, b);
  assert.deepEqual([off.x, off.z, off.hostId, off.flag], [-60, tallZ, t4.id, undefined]);
  assert.ok(Math.abs(seat.z - tallZ) < 1e-9 && seat.x === -60, 'seated over its tall, proud with it');
  // pulled toward the T9: it hops onto the T9 and takes it as host
  const hop = snapPosition(st, s.id, 14, tallZ, b);
  assert.deepEqual([hop.x, hop.z, hop.rotDeg, hop.hostId, hop.flag], [20, tallZ, 0, t9.id, undefined]);
  // the T1 does not fit it: pulled there it lands on the nearest tall it does fit
  assert.equal(snapPosition(st, s.id, 60, tallZ, b).hostId, t9.id);
  // with no host it fits anywhere, it is refused and held where it is
  const s1 = st.addItem('S1', { x: 60, z: tallZ, hostId: t1.id });        // 15" fits T1, T3
  st.removeItem(t1.id);
  assert.equal(st.getItem(s1.id), undefined, 'leaves with the T1');
  const s3 = st.addItem('S3', { x: 0, z: 0 });                             // fits T2, T5, T6: none here
  assert.deepEqual([snapPosition(st, s3.id, -60, tallZ, b).flag, findStackerSeat(st.state, getCab('S3'), -60, tallZ, s3.id)], ['stacker', null]);
  st.removeItem(s3.id);
  // a second S11 cannot land on the T4 while the first stands on it, but the first can go back to its own
  const s2 = st.addItem('S11', { x: 0, z: 0 });
  assert.equal(findStackerSeat(st.state, getCab('S11'), -60, tallZ, s2.id).hostId, t9.id, 'the T4 is taken: the T9 is the free one');
  assert.equal(findStackerSeat(st.state, getCab('S11'), -60, tallZ, s.id).hostId, t4.id);
  assert.equal(stackerOn(st.state, t4.id).id, s.id);
  assert.equal(stackerOn(st.state, t1.id), null);
});

test('the stacker follows its host, is re-fitted when the host is swapped, and leaves with it', () => {
  const st = new Store(); roomOf(st);
  const t4 = st.addItem('T4', { x: -60, z: tallZ });
  const s = st.addItem('S11', { x: -60, z: tallZ, hostId: t4.id });
  st.updateItem(t4.id, { x: 10 });
  assert.equal(st.getItem(s.id).x, 10, 'slides along with its tall');
  // the tall hops to the left wall: the stacker turns with it, seated on it there
  st.updateItem(t4.id, { x: -W / 2 + 12.25 + 30 / 25.4, z: 30, rotDeg: 90 });
  const on = st.getItem(s.id);
  assert.deepEqual([on.rotDeg, on.z], [90, 30]); assert.ok(Math.abs(on.x - (-W / 2 + 12.25 + 30 / 25.4)) < 1e-9);
  // swapped for a tall that takes a different stacker: the stacker becomes the one made for it, same height
  st.swapItem(t4.id, 'T11');
  assert.equal(st.getItem(s.id).code, 'S12', 'the 21" made for the T11');
  assert.equal(st.getItem(s.id).hostId, t4.id);
  st.swapItem(t4.id, 'T10');
  assert.equal(st.getItem(s.id).code, 'S9');
  // swapped for a corner tall with no stacker made: the stacker comes off
  st.swapItem(t4.id, 'T16');
  const gone = getCab('T16') && !CATALOGUE.some((c) => c.stacker && /\bT16\b/.test(c.desc));
  if (gone) assert.equal(st.getItem(s.id), undefined, 'nothing is made for it: it comes off');
  st.swapItem(t4.id, 'T4');
  const s2 = st.getItem(s.id) || st.addItem('S11', { x: st.getItem(t4.id).x, z: st.getItem(t4.id).z, rotDeg: 90, hostId: t4.id });
  st.removeItem(t4.id);
  assert.equal(st.getItem(s2.id), undefined, 'leaves with its host');
  st.undo();
  assert.ok(st.getItem(t4.id) && st.getItem(s2.id), 'one undo brings both back');
});

test('a stacker saved before hostId is adopted by the cabinet under it: it follows and leaves with that host too', () => {
  const st = new Store(); roomOf(st);
  const t1 = st.addItem('T1', { x: -40, z: tallZ });
  const s = st.addItem('S1', { x: -40, z: tallZ });                     // no hostId: an older design
  assert.equal(stackerHostOf(st.state, s).id, t1.id);
  st.updateItem(t1.id, { x: 0 });
  assert.deepEqual([st.getItem(s.id).x, st.getItem(s.id).hostId], [0, t1.id], 'adopted as it moves');
  const w2 = st.addItem('W2', { x: 40, z: -D / 2 + getCab('W2').d / 2 + 0.25 });
  const s16 = st.addItem('S16', { x: 40, z: -D / 2 + 7.25 });
  st.removeItem(w2.id);
  assert.equal(st.getItem(s16.id), undefined, 'a wall cabinet takes its stacker with it');
  assert.ok(st.getItem(s.id), 'the other stacker stays');
});
