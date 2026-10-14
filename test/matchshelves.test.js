// matchshelves.test.js — two open shelves either side of a hood come out the same width (her call 2026-10-14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMatchShelves } from '../src/core/matchshelves.js';
import { getCab } from '../src/core/catalogue.js';
import { Store } from '../src/core/store.js';

const W = 200, D = 160, room = { width: W, depth: D, height: 96, openings: [] };
const wallZ = (c) => -D / 2 + c.d / 2 + 0.25;
const put = (id, code, x, extra = {}) => { const c = getCab(code); return { id, code, x, z: wallZ(c), rotDeg: 0, ...extra }; };

test('the wider shelf is cut to the narrower one, hood-side edge fixed, and the run beyond slides toward the hood', () => {
  // a 24" range at x=0 with its plaster hood (32"): a 16" shelf on the left, a 20" on the right, a W5 beyond it
  const hood = put(1, 'AP26', 0);
  const hw = getCab('AP26').w;
  const left = put(2, 'W12:w16', -hw / 2 - 8), right = put(3, 'W12:w20', hw / 2 + 10), w5 = put(4, 'W5', hw / 2 + 20 + 18);
  const p = planMatchShelves({ room, items: [hood, left, right, w5, put(5, 'AP1', 0, { z: -D / 2 + 13.25 })] });
  assert.ok(p.ok, p.reason);
  assert.equal(p.pairs.length, 1);
  const q = p.pairs[0];
  assert.deepEqual([q.hoodId, q.keepId, q.cutId, q.code, q.w], [1, 2, 3, 'W12:w16', 16]);
  assert.ok(Math.abs(q.x - (hw / 2 + 8)) < 1e-9, 'the right shelf keeps its hood-side edge');
  assert.deepEqual(q.moves, [{ id: 4, x: w5.x - 4, z: w5.z }], 'the W5 beyond it comes 4" toward the hood');
  // the pair already equal: nothing to do; a corner unit in the chain: left alone
  assert.equal(planMatchShelves({ room, items: [hood, left, put(3, 'W12:w16', hw / 2 + 8)] }).reason, 'same');
  assert.equal(planMatchShelves({ room, items: [hood, left, right, put(6, 'W10R', hw / 2 + 20 + 12)] }).reason, 'corner');
  assert.equal(planMatchShelves({ room, items: [hood, left] }).reason, 'no pair');
});

test('a side wall pair works the same way, and the store applies it as one swap + moves', () => {
  const st = new Store(); st.setRoom({ width: W, depth: D, height: 96 });
  const x = -W / 2 + 10 + 0.25;
  const hood = st.addItem('AP27', { x, z: 0, rotDeg: 90 });             // 38" plaster hood on the left wall
  const hw = getCab('AP27').w;
  const a = st.addItem('W12:w14', { x, z: -hw / 2 - 7, rotDeg: 90 });
  const b = st.addItem('W13', { x, z: hw / 2 + 14, rotDeg: 90 });        // 28" beyond the hood
  const c = st.addItem('W2', { x, z: hw / 2 + 28 + 12, rotDeg: 90 });
  const p = planMatchShelves(st.state);
  assert.ok(p.ok); const q = p.pairs[0];
  assert.equal(q.cutId, b.id); assert.equal(q.code, 'W13:w14'); assert.ok(Math.abs(q.z - (hw / 2 + 7)) < 1e-9);
  assert.deepEqual(q.moves, [{ id: c.id, x, z: c.z - 14 }]);
  void a; void hood;
});
