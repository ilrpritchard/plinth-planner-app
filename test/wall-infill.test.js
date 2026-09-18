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

// ---- corner conversion (her rule 2026-09-17: filling a second wall must make a corner unit) ----
test('fill two adjoining walls, either order: a corner unit at the junction, leg to leg, no overlaps', async () => {
  const { Store } = await import('../src/core/store.js');
  const { getCab } = await import('../src/core/catalogue.js');
  const { snapPosition } = await import('../src/interaction/snapping.js');
  const box = (it) => { const c = getCab(it.code); const ret = c.corner ? 20 : 0, lR = (c.corner && c.cornerSide !== 'right') ? ret : 0, rR = (c.corner && c.cornerSide === 'right') ? ret : 0; const rad = (it.rotDeg || 0) * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad); const pts = [[-(c.w / 2 + lR), -c.d / 2], [c.w / 2 + rR, -c.d / 2], [c.w / 2 + rR, c.d / 2], [-(c.w / 2 + lR), c.d / 2]]; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [lx, lz] of pts) { const wx = lx * cs + lz * sn, wz = -lx * sn + lz * cs; x0 = Math.min(x0, it.x + wx); x1 = Math.max(x1, it.x + wx); z0 = Math.min(z0, it.z + wz); z1 = Math.max(z1, it.z + wz); } return { x0, x1, z0, z1 }; };
  for (const order of [['back', 'left'], ['left', 'back'], ['back', 'right'], ['right', 'back'], ['front', 'left'], ['left', 'front'], ['left', 'back', 'right']]) {
    const st = new Store(); st.setRoom({ width: 144, depth: 120, height: 96 });
    for (const wall of order) { const pl = planWallInfill(st.state, wall); for (const id of (pl.remove || [])) st.removeItem(id); for (const p of pl) st.addItem(p.code, { x: p.x, z: p.z, rotDeg: p.rotDeg }); }
    const items = st.state.items;
    const corners = items.filter((i) => getCab(i.code).corner);
    assert.equal(corners.length, order.length - 1, `${order.join('>')}: one corner unit per junction`);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) { const a = box(items[i]), b = box(items[j]); const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0); assert.ok(!(ix > 0.5 && iz > 0.5), `${order.join('>')}: ${items[i].code} overlaps ${items[j].code}`); }
    const b = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
    for (const c of corners) assert.equal(snapPosition(st, c.id, c.x, c.z, b).flag, undefined, `${order.join('>')}: ${c.code} passes the corner rule where it was placed`);
  }
});
