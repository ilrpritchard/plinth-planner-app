// cornice-sidewall.test.js — an upper butted to a tall (or a plaster hood) keeps its crown return
// at the OPEN end and dies into the tall at the other, on EVERY wall. World x/z were compared
// against the cabinet's local axis, so on the left and front walls the wrong flank lost its
// return (her screenshot 2026-09-25: "why didn't the cornice return here").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCornice } from '../src/core/cornice.js';
import { getCab } from '../src/core/catalogue.js';

const W = 200, D = 160, room = { width: W, depth: D, height: 96, cornice: 'plain' };
// a run on `wall`: items given as { code, a } with `a` the distance along the wall from its start
function run(wall, parts) {
  const rot = { back: 0, left: 90, front: 180, right: 270 }[wall];
  return parts.map((p, i) => {
    const c = getCab(p.code), off = c.d / 2 + 0.25 + (c.type === 'TALL' || c.onTall ? 1.18 : 0);
    let x, z;
    if (wall === 'back') { x = -W / 2 + p.a; z = -D / 2 + off; }
    else if (wall === 'front') { x = W / 2 - p.a; z = D / 2 - off; }
    else if (wall === 'left') { x = -W / 2 + off; z = -D / 2 + p.a; }
    else { x = W / 2 - off; z = D / 2 - p.a; }
    return { id: i + 1, code: p.code, x, z, rotDeg: rot };
  });
}
const returns = (plan, upper) => plan.segments.filter((g) => Math.abs(g.length - 14) < 0.1 && Math.hypot(g.x - upper.x, g.z - upper.z) < 20);   // the upper's own 14" side returns (a tall's flank return is shorter)
const dist = (g, it) => Math.hypot(g.x - it.x, g.z - it.z);

for (const wall of ['back', 'left', 'front', 'right']) {
  test(`${wall} wall: tall + upper: one return, at the end away from the tall; the crown dies into the tall`, () => {
    const items = run(wall, [{ code: 'T1', a: 12 }, { code: 'W2', a: 24 + 12 }]);
    const [tall, upper] = items;
    const plan = planCornice({ room, items });
    const rets = returns(plan, upper);
    assert.equal(rets.length, 1, `${wall}: ${rets.length} side returns on the upper (${JSON.stringify(plan.segments.map((g) => [+g.x.toFixed(1), +g.z.toFixed(1), +g.length.toFixed(1)]))})`);
    assert.ok(dist(rets[0], tall) > dist(rets[0], upper) + 10, `${wall}: the return is at the OPEN end, not the tall's side`);
  });

  test(`${wall} wall: with a stacker on the tall the connector board sits on the flank facing the upper`, () => {
    const items = run(wall, [{ code: 'T1', a: 12 }, { code: 'W2', a: 24 + 12 }]);
    const tall = items[0], upper = items[1];
    const st = getCab('S1');
    items.push({ id: 3, code: 'S1', x: tall.x, z: tall.z, rotDeg: tall.rotDeg });
    const plan = planCornice({ room, items });
    assert.equal(plan.drops.length, 1, `${wall}: one connector`);
    const d = plan.drops[0];
    assert.ok(dist(d, upper) < dist(d, { x: 2 * tall.x - upper.x, z: 2 * tall.z - upper.z }), `${wall}: the board faces the upper`);
    assert.ok(st, 'S1 exists');
  });
}

test('left wall: an upper beside a plaster hood returns at its open end only', () => {
  const items = run('left', [{ code: 'AP2', a: 30 }, { code: 'W2', a: 30 + 18 + 50 / 25.4 / 2 + 12 }]);
  const hood = getCab('AP27');
  items.push({ id: 9, code: 'AP27', x: -W / 2 + hood.d / 2 + 0.25, z: items[0].z, rotDeg: 90 });
  const plan = planCornice({ room, items });
  const rets = returns(plan, items[1]);
  assert.equal(rets.length, 1);
  assert.ok(rets[0].z > items[1].z + 10, 'the return is at the far end from the hood');
});
