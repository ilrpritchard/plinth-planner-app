// stackers.test.js — the right stacker lands on every tall, wall and counter cabinet in one press.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStackers, stackerFor, resizeStackers } from '../src/core/stackers.js';
import { getCab } from '../src/core/catalogue.js';

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
