// wall-infill.test.js — planWallInfill: "Fill this wall" packs EVERY gap
// along the wall (both end gaps AND the gaps between cabinets), skips gaps
// too small for a 20" unit, keeps clear of doors, and never overlaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWallInfill } from '../src/core/templates.js';
import { getCab } from '../src/core/catalogue.js';

const room = { width: 144, depth: 120, height: 96, openings: [] };
const BACK_Z = (code) => -room.depth / 2 + getCab(code).d / 2 + 0.25;

// occupied interval of a back-wall placement along X
const spanX = (p) => [p.x - getCab(p.code).w / 2, p.x + getCab(p.code).w / 2];
const width = (p) => getCab(p.code).w;

test('back wall with a cabinet in the middle → BOTH flanking gaps get filled', () => {
  // F2 (24" wide) dead-centre on the back wall → two 60" gaps either side
  const state = { room, items: [{ id: 1, code: 'F2', x: 0, z: BACK_Z('F2'), rotDeg: 0 }] };
  const out = planWallInfill(state, 'back');
  assert.ok(out.length >= 2, 'nothing planned');
  const left = out.filter((p) => p.x < -12), right = out.filter((p) => p.x > 12);
  assert.ok(left.length && right.length, 'a flanking gap was left empty');
  const leftFill = left.reduce((t, p) => t + width(p), 0);
  const rightFill = right.reduce((t, p) => t + width(p), 0);
  assert.ok(60 - leftFill <= 9.5, `left residual ${60 - leftFill}" too big`);
  assert.ok(60 - rightFill <= 9.5, `right residual ${60 - rightFill}" too big`);
  for (const p of out) {
    assert.equal(p.rotDeg, 0, 'back wall placements face the room');
    assert.ok(Math.abs(p.z - BACK_Z(p.code)) < 1e-9, 'back sits on the wall line');
    const [a, b] = spanX(p);
    assert.ok(b <= -12 + 1e-6 || a >= 12 - 1e-6, `${p.code} overlaps the existing cabinet`);
    assert.ok(a >= -72 - 1e-6 && b <= 72 + 1e-6, `${p.code} runs past the wall`);
  }
  // placements butt sequentially — no two planned units overlap each other
  const sorted = [...out].sort((p, q) => p.x - q.x);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(spanX(sorted[i])[0] >= spanX(sorted[i - 1])[1] - 1e-6, 'planned units overlap');
  }
});

test('a middle gap under 20" gets NOTHING (that is filler territory)', () => {
  // two F2s leave a 12" gap between them: [-30,-6] · gap · [6,30]
  const state = {
    room,
    items: [
      { id: 1, code: 'F2', x: -18, z: BACK_Z('F2'), rotDeg: 0 },
      { id: 2, code: 'F2', x: 18, z: BACK_Z('F2'), rotDeg: 0 },
    ],
  };
  const out = planWallInfill(state, 'back');
  for (const p of out) {
    const [a, b] = spanX(p);
    assert.ok(b <= -30 + 1e-6 || a >= 30 - 1e-6, `${p.code} planted in the 12" gap`);
  }
  // the two 42" end gaps DO get filled (best pack 40" → 2" residual each)
  const leftFill = out.filter((p) => p.x < -30).reduce((t, p) => t + width(p), 0);
  const rightFill = out.filter((p) => p.x > 30).reduce((t, p) => t + width(p), 0);
  assert.ok(leftFill >= 40 && rightFill >= 40, 'end gaps not packed');
});

test('empty back wall fills wall-to-wall from the left corner', () => {
  const out = planWallInfill({ room, items: [] }, 'back');
  const filled = out.reduce((t, p) => t + width(p), 0);
  assert.equal(filled, 144, 'a 144" wall packs exactly');
  const first = [...out].sort((p, q) => p.x - q.x)[0];
  assert.ok(Math.abs(spanX(first)[0] - -72) < 1e-6, 'run starts at the wall');
});

test('left wall: correct rot/x line, and a doorway blocks its stretch', () => {
  const r2 = { ...room, openings: [{ id: 1, type: 'doorway', wall: 'left', pos: 0.5, width: 36 }] };
  const out = planWallInfill({ room: r2, items: [] }, 'left');
  assert.ok(out.length, 'nothing planned on the side wall');
  const doorC = 0; // pos 0.5 of a 120" wall → z = 0, keep-clear ±22
  for (const p of out) {
    assert.equal(p.rotDeg, 90, 'side wall placements face the room');
    assert.ok(Math.abs(p.x - (-72 + getCab(p.code).d / 2 + 0.25)) < 1e-9, 'back sits on the left wall line');
    const a = p.z - width(p) / 2, b = p.z + width(p) / 2;
    assert.ok(b <= doorC - 22 + 1e-6 || a >= doorC + 22 - 1e-6, `${p.code} blocks the doorway`);
  }
});

test('appliances and talls on the wall line are respected as blockers', () => {
  // range (AP2, 36") mid-wall: infill fills around it, never through it
  const state = { room, items: [{ id: 1, code: 'AP2', x: 0, z: BACK_Z('AP2'), rotDeg: 0 }] };
  const out = planWallInfill(state, 'back');
  for (const p of out) {
    const [a, b] = spanX(p);
    assert.ok(b <= -18 + 1e-6 || a >= 18 - 1e-6, `${p.code} overlaps the range`);
  }
  assert.ok(out.length >= 2, 'gaps around the range left empty');
});
