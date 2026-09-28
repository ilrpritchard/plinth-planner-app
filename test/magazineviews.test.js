// magazineviews.test.js — render step 6: the three magazine presets are level cameras with the
// right lenses and heights, inside the room, and the detail finds a real junction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { magazineViews, junctionFor, vfovFor } from '../src/core/photoviews.js';

const hero = JSON.parse(readFileSync(new URL('../tools/hero-kitchen.json', import.meta.url), 'utf8'));
const island = JSON.parse(readFileSync(new URL('../tools/island-kitchen.json', import.meta.url), 'utf8'));

test('lens and height: 85mm at 1.2 m, 50mm at 1.3 m, 100mm at 1.0 m', () => {
  const [a, b, c] = magazineViews(hero.room, hero.items);
  assert.deepEqual([a.lens, b.lens, c.lens], [85, 50, 100]);
  assert.ok(Math.abs(a.fov - 16.1) < 0.1 && Math.abs(b.fov - 27.0) < 0.1 && Math.abs(c.fov - 13.7) < 0.1, 'vertical FOV on a 24mm-tall frame');
  assert.ok(Math.abs(a.pos[1] - 47.24) < 0.01 && Math.abs(b.pos[1] - 51.18) < 0.01 && Math.abs(c.pos[1] - 39.37) < 0.01);
  assert.ok(Math.abs(vfovFor(50) - 26.99) < 0.01);
});

test('every camera is level (verticals vertical), inside the room, looking at the back run', () => {
  for (const s of [hero, island]) for (const v of magazineViews(s.room, s.items)) {
    const W = s.room.width, D = s.room.depth;
    assert.equal(v.target[1], v.pos[1], `${v.key}: level`);
    assert.ok(Math.abs(v.pos[0]) < W / 2 && Math.abs(v.pos[2]) < D / 2, `${v.key}: inside the room`);
    assert.ok(v.target[2] < v.pos[2], `${v.key}: looks toward the back`);
    assert.ok(v.shift > -0.5 && v.shift < 0.5, `${v.key}: a sensible lens shift`);
  }
  const [a] = magazineViews(hero.room, hero.items);
  assert.equal(a.pos[0], a.target[0], 'straight on is square to the run: one-point perspective');
});

test('the detail finds a junction: the F10 | F18 joint on the hero, an island joint on the island kitchen', () => {
  const j = junctionFor(hero.room, hero.items);
  assert.ok(j && Math.abs(j.x - 32) < 0.01 && !j.island, `hero junction at ${j && j.x}`);
  const k = junctionFor(island.room, island.items);
  assert.ok(k && k.island && Math.abs(Math.abs(k.x) - 12) < 0.01, `island junction at ${k && k.x}`);
});
