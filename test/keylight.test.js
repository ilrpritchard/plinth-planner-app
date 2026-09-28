// keylight.test.js — the room's one key light comes from its window, and never from behind the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyLight } from '../src/core/keylight.js';

const room = (openings = []) => ({ width: 160, depth: 132, height: 96, openings });
const win = (wall, pos, width = 40) => ({ type: 'window', wall, pos, width });
const unit = (v) => Math.hypot(...v);

test('no window: the old studio direction, front right and above', () => {
  const k = keyLight(room());
  assert.equal(k.source, 'default');
  assert.ok(k.from[0] > 0 && k.from[1] > 0 && k.from[2] > 0);
  assert.ok(Math.abs(unit(k.from) - 1) < 1e-9);
});

test('a side window: the light comes from that side of the room', () => {
  const l = keyLight(room([win('left', 0.7)])), r = keyLight(room([win('right', 0.3)]));
  assert.equal(l.source, 'window-left'); assert.ok(l.from[0] < 0, 'from the left');
  assert.equal(r.source, 'window-right'); assert.ok(r.from[0] > 0, 'from the right');
});

test('a back-wall window: from high up on its side, never from behind the fronts', () => {
  const right = keyLight(room([win('back', 0.8)])), left = keyLight(room([win('back', 0.2)]));
  assert.equal(right.source, 'window-back');
  assert.ok(right.from[0] > 0 && left.from[0] < 0, 'follows the window along the wall');
  assert.ok(right.from[1] > 0.8, 'steep: it falls onto the worktop and down the fronts');
  for (const k of [right, left, keyLight(room([win('back', 0.5)]))]) assert.ok(k.from[2] > 0, 'lit from in front of the run');
});

test('every case: a unit vector from above and in front, azimuth matching its horizontal part', () => {
  for (const o of [[], [win('left', 0.05)], [win('left', 0.95)], [win('right', 0.02)], [win('front', 0.5)], [win('back', 0.5)], [win('back', 0.01)]]) {
    const k = keyLight(room(o));
    assert.ok(Math.abs(unit(k.from) - 1) < 1e-9);
    assert.ok(k.from[1] > 0.5 && k.from[2] > 0, `${k.source}: above and in front`);
    assert.ok(Math.abs(Math.atan2(k.from[2], k.from[0]) - k.azimuth) < 1e-9);
  }
});

test('the biggest window wins, and doors are not windows', () => {
  const k = keyLight(room([win('back', 0.5, 24), { type: 'door', wall: 'right', pos: 0.5, width: 34 }, { ...win('left', 0.5, 60), hgt: 50 }]));
  assert.equal(k.source, 'window-left');
});
