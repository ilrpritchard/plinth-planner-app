// evenout.test.js — uneven scribes at the two ends of a wall-to-wall run are evened out,
// but only when that spoils nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEvenOut } from '../src/core/evenout.js';
import { getCab } from '../src/core/catalogue.js';

const W = 230, D = 150, x0 = -W / 2;
const zOf = (c) => -D / 2 + c.d / 2 + 0.25 + (c.type === 'TALL' ? 1.18 : 0);
let nid = 1;
const at = (code, x, extra = {}) => { const c = getCab(code); return { id: nid++, code, x: x + c.w / 2, z: zOf(c), rotDeg: 0, ...extra }; };
const room = (openings = []) => ({ width: W, depth: D, height: 96, openings });
// her screenshot: tall, drawers, range, drawers, bases, tall: 222" of run on a 230" wall, all the slack at the right
const run = () => { nid = 1; let x = x0; const out = []; for (const code of ['T10', 'F18', 'AP2', 'F18', 'F2', 'F10', 'F2', 'T10']) { out.push(at(code, x)); x += getCab(code).w; } return out; };

test('her case: 0" one side and 8" the other becomes 4" and 4", and everything on the wall moves together', () => {
  const items = run();
  const sinkBase = items[4], upper = { id: 90, code: 'W2', x: items[3].x, z: -D / 2 + 7.25, rotDeg: 0 }, sink = { id: 91, code: 'AP6', x: sinkBase.x, z: sinkBase.z, rotDeg: 0 };
  const island = { id: 92, code: 'F10', x: 0, z: 20, rotDeg: 0, island: true };
  const p = planEvenOut({ room: room(), items: [...items, upper, sink, island] }, 'back');
  assert.equal(p.ok, true, p.reason);
  assert.ok(Math.abs(p.left - 0) < 0.01 && Math.abs(p.right - 8) < 0.01);
  assert.ok(Math.abs(p.shift - 4) < 0.01 && Math.abs(p.each - 4) < 0.01);
  assert.equal(p.moves.length, items.length + 2, 'bases, talls, range, the upper and the sink; never the island');
  assert.ok(!p.moves.some((m) => m.id === 92));
  for (const m of p.moves) { const it = [...items, upper, sink].find((i) => i.id === m.id); assert.ok(Math.abs(m.x - it.x - 4) < 1e-9 && m.z === it.z); }
  assert.ok(Math.abs(p.moves.find((m) => m.id === 91).x - p.moves.find((m) => m.id === sinkBase.id).x) < 1e-9, 'the sink stays in its base');
});

test('refused when it would spoil the design', () => {
  const base = run();
  const why = (st, wall = 'back') => planEvenOut(st, wall).reason;
  // already even
  const even = run().map((it) => ({ ...it, x: it.x + 4 }));
  assert.equal(why({ room: room(), items: even }), 'already even');
  // a run on the left wall meets this one
  assert.equal(why({ room: room(), items: [...base, { id: 70, code: 'F10', x: x0 + 12.25, z: -D / 2 + 24.3 + 18, rotDeg: 90 }] }), 'adjoining run');
  // a corner unit on the wall
  nid = 1; const withCorner = [at('F16', x0 + 24.25), at('F10', x0 + 48.25), at('F10', x0 + 84.25)];
  assert.equal(why({ room: room(), items: withCorner }), 'corner unit');
  // too much slack is a gap, not a scribe
  nid = 1; assert.equal(why({ room: room(), items: [at('F10', x0), at('F10', x0 + 36)] }), 'too much slack');
  // a hole in the run
  nid = 1; const holed = [at('T10', x0), at('F10', x0 + 27 + 40), at('F10', x0 + 27 + 76)];
  assert.ok(['gap in the run', 'too much slack'].includes(why({ room: room(), items: holed })));
  // a sink centred under the window would be pulled off it
  const items = run(), sb = items[4];
  const win = { id: 1, type: 'window', wall: 'back', pos: (sb.x - x0) / W, width: 36 };
  assert.equal(why({ room: room([win]), items: [...items, { id: 91, code: 'AP6', x: sb.x, z: sb.z, rotDeg: 0 }] }), 'sink under window');
  // ...but a sink that is NOT centred on it does not block
  const off = { ...win, pos: (sb.x + 9 - x0) / W };
  assert.equal(planEvenOut({ room: room([off]), items: [...items, { id: 91, code: 'AP6', x: sb.x, z: sb.z, rotDeg: 0 }] }).ok, true);
  // an upper that ends at the window's edge would slide over the glass
  const its = run(), upperX = x0 + 60, w2 = getCab('W2');
  const glass = { id: 2, type: 'window', wall: 'back', pos: (upperX + w2.w / 2 + 18 - x0) / W, width: 36 };   // starts exactly where the upper ends
  assert.equal(why({ room: room([glass]), items: [...its, { id: 95, code: 'W2', x: upperX, z: -D / 2 + 7.25, rotDeg: 0 }] }), 'window');
});

test('an island lined up on the range is mentioned, never moved', () => {
  const items = run(), range = items[2];
  const p = planEvenOut({ room: room(), items: [...items, { id: 92, code: 'F20', x: range.x, z: 20, rotDeg: 0, island: true }] });
  assert.equal(p.ok, true); assert.deepEqual(p.notes, ['island']);
});

test('sweep: whatever the slack, an accepted plan ends with equal scribes and nothing outside the room', () => {
  let n = 0;
  for (let slackLeft = 0; slackLeft <= 9; slackLeft += 0.5) {
    const items = run().map((it) => ({ ...it, x: it.x + slackLeft }));
    const p = planEvenOut({ room: room(), items });
    if (!p.ok) { assert.ok(Math.abs(slackLeft - 4) < 0.51 || slackLeft > 8, `${slackLeft}: ${p.reason}`); continue; }
    const lo = Math.min(...p.moves.map((m) => m.x - getCab(items.find((i) => i.id === m.id).code).w / 2)), hi = Math.max(...p.moves.map((m) => m.x + getCab(items.find((i) => i.id === m.id).code).w / 2));
    assert.ok(Math.abs((lo - x0) - (W / 2 - hi)) < 1e-6, 'equal both ends'); assert.ok(lo >= x0 - 1e-6 && hi <= W / 2 + 1e-6); n++;
  }
  assert.ok(n >= 12, `swept ${n}`);
});
