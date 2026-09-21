// placement.test.js — a tapped-in cabinet or appliance never lands outside the room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spotOk, findFreeSpot, boxAt } from '../src/core/placement.js';
import { getCab } from '../src/core/catalogue.js';

const bounds = (w, d) => ({ minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 });
const backRun = (codes, w, d) => { let x = -w / 2; return codes.map((code, i) => { const c = getCab(code); x += c.w; return { id: i + 1, code, x: x - c.w / 2, z: -d / 2 + c.d / 2 + 0.25 + (c.type === 'TALL' ? 1.18 : 0), rotDeg: 0 }; }); };

test('her case: the back wall is full, a fridge is tapped in, and it stands INSIDE the room', () => {
  const W = 234, D = 150, b = bounds(W, D);
  const items = backRun(['T10', 'F19', 'F18', 'AP2', 'F18', 'F2', 'F7', 'F10', 'T11'], W, D);
  const state = { room: { width: W, depth: D, height: 96, openings: [] }, items };
  const fridge = getCab('AP9') || getCab('AP8');
  assert.ok(fridge, 'a fridge exists in the catalogue');
  const used = items.reduce((n, it) => n + getCab(it.code).w, 0);
  assert.ok(W - used < fridge.w, 'the wall really is too full for it');
  // the old start point, past the end of the run, is NOT a place it can stand
  const startX = -W / 2 + used + fridge.w / 2;
  assert.equal(spotOk(state, fridge, startX, b.minZ + fridge.d / 2 + 0.25, 0, b), false);
  const spot = findFreeSpot(state, fridge, b, 'back');
  assert.ok(spot, 'somewhere is found');
  assert.notEqual(spot.wall, 'back');
  assert.ok(spotOk(state, fridge, spot.x, spot.z, spot.rotDeg, b));
  const bx = boxAt(fridge, spot.x, spot.z, spot.rotDeg);
  assert.ok(bx.x0 >= b.minX - 0.06 && bx.x1 <= b.maxX + 0.06 && bx.z0 >= b.minZ - 0.06 && bx.z1 <= b.maxZ + 0.06, 'wholly inside the room');
});

test('a gap on the asked-for wall is used before any other wall', () => {
  const W = 168, D = 120, b = bounds(W, D);
  const state = { room: { width: W, depth: D, openings: [] }, items: backRun(['F10', 'F10'], W, D) };
  const spot = findFreeSpot(state, getCab('F2'), b, 'back');
  assert.equal(spot.wall, 'back');
  assert.ok(Math.abs((spot.x - getCab('F2').w / 2) - (-W / 2 + 72)) < 0.1, 'butted to the end of the run');
});

test('nothing stands across a door, and an upper may hang over a base but not over a tall', () => {
  const W = 144, D = 120, b = bounds(W, D);
  const state = { room: { width: W, depth: D, openings: [{ id: 1, type: 'door', wall: 'back', pos: 0.5, width: 34 }] }, items: [] };
  const f = getCab('F10');
  assert.equal(spotOk(state, f, 0, b.minZ + f.d / 2 + 0.25, 0, b), false, 'across the door');
  const s2 = { room: { width: W, depth: D, openings: [] }, items: backRun(['F10', 'T3'], W, D) };
  const w5 = getCab('W5');
  assert.equal(spotOk(s2, w5, -W / 2 + 18, b.minZ + w5.d / 2 + 0.25, 0, b), true, 'over a base');
  assert.equal(spotOk(s2, w5, -W / 2 + 36 + 12, b.minZ + w5.d / 2 + 0.25, 0, b), false, 'into a tall');
});

test('sweep: whatever is already in the room, a found spot is always inside and on nothing; a packed room says so', () => {
  let n = 0;
  for (const [W, D] of [[96, 96], [144, 120], [234, 150]]) for (const code of ['F2', 'F10', 'F20', 'T3', 'T12', 'W5', 'AP1', 'AP3', 'AP8', 'AP11']) {
    const cab = getCab(code); if (!cab) continue;
    const b = bounds(W, D);
    const fill = []; let x = -W / 2; while (x + 36 <= W / 2) { fill.push('F10'); x += 36; }
    const state = { room: { width: W, depth: D, openings: [] }, items: backRun(fill, W, D) };
    for (const wall of ['back', 'left', 'right']) {
      const spot = findFreeSpot(state, cab, b, wall);
      if (!spot) continue;
      assert.ok(spotOk(state, cab, spot.x, spot.z, spot.rotDeg, b), `${code} ${W}x${D} ${wall}`);
      n++;
    }
  }
  assert.ok(n > 60, `swept ${n}`);
  // a room with no floor left at all: null, never a bad spot
  const W = 60, D = 30, b = bounds(W, D);
  const state = { room: { width: W, depth: D, openings: [] }, items: backRun(['F10'], W, D).concat([{ id: 9, code: 'F2', x: 18, z: -D / 2 + 12.25, rotDeg: 0 }]) };
  assert.equal(findFreeSpot(state, getCab('AP3'), b, 'back'), null);
});
