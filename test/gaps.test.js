// gaps.test.js — "there is a gap here: this is what would fit".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGaps, suggestForGap, placementsFor } from '../src/core/gaps.js';
import { spotOk } from '../src/core/placement.js';
import { getCab } from '../src/core/catalogue.js';

const W = 234, D = 150, bounds = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
const at = (code, x0, id) => { const c = getCab(code); return { id, code, x: x0 + c.w / 2, z: -D / 2 + c.d / 2 + 0.25 + (c.type === 'TALL' ? 1.18 : 0), rotDeg: 0 }; };
const room = (openings = []) => ({ width: W, depth: D, height: 96, openings });

test('her screenshot: tall, a 42" gap, then the range: drawers are offered first, never a dishwasher or a tall', () => {
  const x0 = -W / 2;
  const items = [at('T10', x0, 1), at('AP2', x0 + 27 + 42, 2), at('F18', x0 + 27 + 42 + 36, 3)];
  const state = { room: room(), items };
  const gaps = findGaps(state);
  const g = gaps.find((q) => q.wall === 'back' && Math.abs(q.width - 42) < 0.6);
  assert.ok(g, 'the 42" gap is found: ' + JSON.stringify(gaps.map((q) => [q.wall, Math.round(q.width)])));
  assert.match(g.label, /tall.*range/);
  const opts = suggestForGap(g);
  assert.ok(opts.length >= 2);
  assert.equal(opts[0].kind, 'Drawers');
  for (const o of opts) {
    assert.ok(o.used <= 42.26 && o.used >= 36, `${o.codes} fills ${o.used}`);
    for (const c of o.codes) { assert.notEqual(getCab(c).form, 'dishwasher'); assert.notEqual(getCab(c).type, 'TALL'); }
    assert.equal(getCab(o.codes[0]).form, 'drawers', 'the piece that touches the range is drawers');
    // stood where they say, they are inside the room, on nothing, and butt the range
    const ps = placementsFor(g, o, state); let st = { ...state, items: [...items] };
    ps.forEach((p, i) => { assert.ok(spotOk(st, getCab(p.code), p.x, p.z, p.rotDeg, bounds), `${p.code} stands`); st = { ...st, items: [...st.items, { id: 100 + i, ...p }] }; });
    const first = ps[0], edge = first.x + getCab(first.code).w / 2;
    assert.ok(Math.abs(edge - g.hi) < 0.01, 'butted to the range, so any leftover is beside the tall');
  }
  // 42" cannot be made exactly with a drawer bank first (20/24/28/36): the honest answer is 36" + a 6" filler
  assert.ok(opts.some((o) => o.filler && o.left <= 9.5), 'an option leaves only a filler');
  assert.deepEqual(opts[0].codes, ['F20']);
});

test('an empty wall is not a gap; under 9.5" is a filler, not a gap; a door splits a gap', () => {
  assert.deepEqual(findGaps({ room: room(), items: [] }), []);
  const x0 = -W / 2;
  const tight = { room: room(), items: [at('F10', x0, 1), at('F10', x0 + 36 + 6, 2)] };
  assert.ok(!findGaps(tight).some((g) => g.width < 9.5));
  const withDoor = { room: room([{ id: 1, type: 'door', wall: 'back', pos: 0.5, width: 34 }]), items: [at('F10', x0, 1), at('F10', W / 2 - 36, 2)] };
  const gs = findGaps(withDoor).filter((g) => g.wall === 'back');
  assert.equal(gs.length, 2);
  assert.ok(gs.every((g) => g.doorLeft || g.doorRight));
  for (const g of gs) for (const o of suggestForGap(g)) for (const p of placementsFor(g, o, withDoor)) assert.ok(spotOk(withDoor, getCab(p.code), p.x, p.z, p.rotDeg, bounds), 'never across the door');
});

test('a side run turning the corner closes that end of the back wall', () => {
  const x0 = -W / 2;
  const left = { id: 9, code: 'F10', x: x0 + 12.25, z: -D / 2 + 24.3 + 18, rotDeg: 90 };
  const state = { room: room(), items: [at('F10', x0 + 60, 1), left] };
  const g = findGaps(state).find((q) => q.wall === 'back' && q.lo < x0 + 1);
  assert.ok(g, 'the corner itself is open: nothing reaches it');
  const state2 = { room: room(), items: [at('F10', x0 + 60, 1), { ...left, z: -D / 2 + 18.25 }] };
  const g2 = findGaps(state2).find((q) => q.wall === 'back' && q.hi <= x0 + 60.1);
  assert.ok(g2 && g2.lo > x0 + 20, 'the side run standing in the corner takes its depth off the gap');
});

test('sweep: every suggestion for every gap width stands inside the gap and overlaps nothing', () => {
  let n = 0; const x0 = -W / 2;
  for (let gapW = 10; gapW <= 120; gapW += 1) for (const rightCode of ['F10', 'AP1', 'T3']) {
    const items = [at('F10', x0, 1), at(rightCode, x0 + 36 + gapW, 2)];
    const state = { room: room(), items };
    const g = findGaps(state).find((q) => q.wall === 'back' && Math.abs(q.lo - (x0 + 36)) < 0.6);
    assert.ok(g, `gap ${gapW} beside ${rightCode}`);
    for (const o of suggestForGap(g)) {
      assert.ok(o.used <= g.width + 0.26);
      let st = { ...state, items: [...items] };
      placementsFor(g, o, state).forEach((p, i) => { assert.ok(spotOk(st, getCab(p.code), p.x, p.z, p.rotDeg, bounds), `${gapW}" ${o.codes} ${p.code}`); st = { ...st, items: [...st.items, { id: 50 + i, ...p }] }; });
      n++;
    }
  }
  assert.ok(n > 300, `swept ${n} suggestions`);
});
