// A unit's manual cabinet list stands along the walls when "Lay out this unit in
// 3D" opens it (core/rowlayout.js). Hard rule 1 swept across list sizes and rooms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planRowsLayout, rowsNotInDesign } from '../src/core/rowlayout.js';
import { getCab, CATALOGUE } from '../src/core/catalogue.js';
import { rowsFromDesign } from '../src/core/cost.js';
import { buildDemoUnits } from '../src/core/tradedemo.js';
import { openingCenter, openingWidth } from '../src/core/openings.js';

const MOUNT = { FLOOR: 0, TALL: 0, WALL: 56, COUNTER: 36.5, SHELF: 56 };
const box3 = (it) => {
  const c = getCab(it.code), ret = c.corner ? (c.type === 'FLOOR' ? 20 : 10) : 0;
  const lR = (c.corner && c.cornerSide !== 'right') ? ret : 0, rR = (c.corner && c.cornerSide === 'right') ? ret : 0;
  const rad = (it.rotDeg || 0) * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [lx, lz] of [[-(c.w / 2 + lR), -c.d / 2], [c.w / 2 + rR, -c.d / 2], [c.w / 2 + rR, c.d / 2], [-(c.w / 2 + lR), c.d / 2]]) {
    const wx = lx * cs + lz * sn, wz = -lx * sn + lz * cs;
    x0 = Math.min(x0, it.x + wx); x1 = Math.max(x1, it.x + wx); z0 = Math.min(z0, it.z + wz); z1 = Math.max(z1, it.z + wz);
  }
  const y0 = typeof c.mountY === 'number' ? c.mountY : (MOUNT[c.type] ?? 0);
  return { x0, x1, z0, z1, y0, y1: y0 + c.h };
};
function assertClean(placements, room, label) {
  const bs = placements.map(box3);
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i];
    assert.ok(a.x0 >= -room.width / 2 - 0.3 && a.x1 <= room.width / 2 + 0.3 && a.z0 >= -room.depth / 2 - 0.3 && a.z1 <= room.depth / 2 + 0.3, `${label}: ${placements[i].code} outside the room`);
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      assert.ok(!(ox > 0.3 && oz > 0.3 && oy > 0.5), `${label}: ${placements[i].code} overlaps ${placements[j].code}`);
    }
  }
}
const room = (w = 150, d = 130, openings = []) => ({ width: w, depth: d, height: 96, openings });

test('her case: two talls from the list stand side by side on the back wall', () => {
  const r = planRowsLayout([{ code: 'T7', qty: 1 }, { code: 'T13', qty: 1 }], room());
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(r.placements.map((p) => [p.code, p.rotDeg]), [['T7', 0], ['T13', 0]]);
  assert.ok(Math.abs(r.placements[1].x - r.placements[0].x - 44) < 1e-6, 'butted: 44" apart centre to centre');
  assertClean(r.placements, room(), 'two talls');
});

test('Done gives back exactly the list that went in', () => {
  const rows = [{ code: 'F10', qty: 1 }, { code: 'F18', qty: 2 }, { code: 'F7', qty: 1 }, { code: 'W5', qty: 2 }, { code: 'T3', qty: 1 }, { code: 'S1', qty: 1 }];
  const r = planRowsLayout(rows, room(200, 140));
  assert.deepEqual(r.unplaced, []);
  const back = Object.fromEntries(rowsFromDesign(r.placements).map((x) => [x.code, x.qty]));
  assert.deepEqual(back, { F10: 1, F18: 2, F7: 1, W5: 2, T3: 1, S1: 1 });
  assertClean(r.placements, room(200, 140), 'round trip');
});

test('uppers hang clear of the talls; a stacker lands on a host of its own width', () => {
  const r = planRowsLayout([{ code: 'T1', qty: 1 }, { code: 'F10', qty: 2 }, { code: 'W5', qty: 2 }, { code: 'S1', qty: 1 }], room(180, 130));
  const tall = r.placements.find((p) => p.code === 'T1'), st = r.placements.find((p) => p.code === 'S1');
  assert.ok(Math.abs(st.x - tall.x) < 1e-6, 'S1 (24") sits on the T1 (24")');
  for (const p of r.placements.filter((q) => q.code === 'W5')) assert.ok(p.x - 18 >= tall.x + 12 - 1e-6, 'wall cabinet starts past the tall');
  assertClean(r.placements, room(180, 130), 'uppers');
  assert.deepEqual(planRowsLayout([{ code: 'S1', qty: 1 }], room()).unplaced, [{ code: 'S1', qty: 1 }], 'a stacker with no host is reported, never floated');
});

test('doors stay clear; talls and uppers never cover a window, base cabinets may sit under one', () => {
  const rm = room(200, 140, [{ id: 1, type: 'window', wall: 'back', pos: 0.3, width: 48 }, { id: 2, type: 'door', wall: 'back', pos: 0.8, width: 34 }]);
  const r = planRowsLayout([{ code: 'T2', qty: 2 }, { code: 'F19', qty: 4 }, { code: 'W5', qty: 3 }], rm);
  const win = [openingCenter(rm, rm.openings[0]) - openingWidth(rm.openings[0], rm) / 2, openingCenter(rm, rm.openings[0]) + openingWidth(rm.openings[0], rm) / 2];
  const door = [openingCenter(rm, rm.openings[1]) - openingWidth(rm.openings[1], rm) / 2, openingCenter(rm, rm.openings[1]) + openingWidth(rm.openings[1], rm) / 2];
  for (const p of r.placements.filter((q) => q.rotDeg === 0)) {
    const c = getCab(p.code), a0 = p.x - c.w / 2, a1 = p.x + c.w / 2;
    assert.ok(a1 <= door[0] + 1e-6 || a0 >= door[1] - 1e-6, `${p.code} stands across the door`);
    if (c.type !== 'FLOOR') assert.ok(a1 <= win[0] + 1e-6 || a0 >= win[1] - 1e-6, `${p.code} covers the window`);
  }
  assert.ok(r.placements.some((p) => p.code === 'F19' && p.rotDeg === 0 && p.x > win[0] && p.x < win[1]), 'a base cabinet does sit under the glass');
  assertClean(r.placements, rm, 'openings');
});

test('a long list carries on down the side walls, clear of the back run; the overflow is reported', () => {
  const r = planRowsLayout([{ code: 'F20', qty: 8 }], room(120, 120));
  assert.ok(r.placements.some((p) => p.rotDeg === 90) && r.placements.some((p) => p.rotDeg === 270), 'left then right wall');
  for (const p of r.placements.filter((q) => q.rotDeg !== 0)) assert.ok(p.z - 18 >= -60 + 24.25, 'side runs start clear of the back run');
  assertClean(r.placements, room(120, 120), 'overflow');
  const tiny = planRowsLayout([{ code: 'F20', qty: 30 }], room(100, 100));
  assert.ok(tiny.unplaced[0].qty > 0 && tiny.unplaced[0].qty + tiny.placements.length === 30, 'every cabinet is either placed or reported');
});

test('SWEEP: the example building, every orderable cabinet, and corner units: nothing overlaps, nothing leaves the room', () => {
  let runs = 0;
  const lists = buildDemoUnits(1, 1).units.map((u) => u.rows);
  const order = CATALOGUE.filter((c) => c.placeable && c.usd > 0);
  for (let i = 0; i < order.length; i += 5) lists.push(order.slice(i, i + 9).map((c) => ({ code: c.code, qty: 1 + (i % 2) })));
  lists.push([{ code: 'F16', qty: 1 }, { code: 'F10', qty: 2 }, { code: 'F16R', qty: 1 }, { code: 'T3', qty: 1 }]);
  for (const rows of lists) for (const [w, d] of [[120, 110], [150, 130], [204, 160], [300, 200]]) {
    const rm = room(w, d, [{ id: 1, type: 'window', wall: 'back', pos: 0.5, width: 48 }, { id: 2, type: 'door', wall: 'left', pos: 0.7, width: 34 }]);
    const r = planRowsLayout(rows, rm);
    assertClean(r.placements, rm, `${w}x${d} [${rows.map((x) => x.code).join(',')}]`);
    const want = rows.reduce((n, x) => n + (getCab(x.code)?.placeable ? x.qty : 0), 0);
    assert.equal(r.placements.length + r.unplaced.reduce((n, x) => n + x.qty, 0), want, 'placed + reported = the list');
    runs++;
  }
  assert.ok(runs > 40, `swept ${runs} lists`);
});

// Her catch 2026-09-18: cabinets added to the LIST of a unit that already had a
// (here: empty, then part-drawn) layout never reached the 3D room.
test('cabinets added to the list after the unit was drawn are stood beside what is already there', () => {
  const room = { width: 144, depth: 120, height: 96, openings: [] };
  const rows = [{ code: 'F12', qty: 1 }, { code: 'F7', qty: 1 }];
  assert.deepEqual(rowsNotInDesign(rows, []), rows, 'an empty layout is missing the whole list');
  const drawn = [{ id: 1, code: 'F18', x: -60, z: -47.75, rotDeg: 0 }, { id: 2, code: 'F7', x: -36, z: -47.75, rotDeg: 0 }];
  const extra = rowsNotInDesign([{ code: 'F18', qty: 2 }, { code: 'F7', qty: 1 }, { code: 'T1', qty: 1 }, { code: 'AP1', qty: 1 }], drawn);
  assert.deepEqual(extra, [{ code: 'F18', qty: 1 }, { code: 'T1', qty: 1 }], 'only what the layout lacks; appliances never');
  const plan = planRowsLayout(extra, room, drawn);
  assert.equal(plan.placements.length, 2); assert.equal(plan.unplaced.length, 0);
  assertClean([...drawn, ...plan.placements], room, 'existing + newly stood');
});

// ---- corner units belong IN a corner, leg to leg with a run on the side wall
// (her screenshot 2026-09-18: a corner unit stood mid-run, oak return on show) ----
test('corner units are stood at their room corner and met leg to leg by a partner run', async () => {
  const { Store } = await import('../src/core/store.js');
  const { snapPosition } = await import('../src/interaction/snapping.js');
  let checked = 0;
  for (const [w, d] of [[150, 130], [168, 140], [173, 126], [204, 160], [240, 180]]) {
    for (const rows of [
      [{ code: 'F18', qty: 2 }, { code: 'F2', qty: 1 }, { code: 'F16R', qty: 1 }, { code: 'F17', qty: 1 }, { code: 'F19', qty: 1 }, { code: 'F20', qty: 2 }],
      [{ code: 'F16', qty: 1 }, { code: 'F10', qty: 2 }, { code: 'F18', qty: 3 }],
      [{ code: 'F16', qty: 1 }, { code: 'F16R', qty: 1 }, { code: 'F10', qty: 1 }, { code: 'F19', qty: 2 }, { code: 'F20', qty: 3 }, { code: 'T3', qty: 1 }],
      [{ code: 'F15R', qty: 1 }, { code: 'F20', qty: 1 }, { code: 'F17', qty: 1 }],
    ]) {
      const rm = room(w, d), r = planRowsLayout(rows, rm), label = `${w}x${d} [${rows.map((x) => x.code).join(',')}]`;
      assertClean(r.placements, rm, label);
      const st = new Store(); st.setRoom({ width: w, depth: d, height: 96 });
      const ids = r.placements.map((p) => st.addItem(p.code, { x: p.x, z: p.z, rotDeg: p.rotDeg }).id);
      const b = { minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 };
      r.placements.forEach((p, i) => {
        const c = getCab(p.code); if (!c.corner) return;
        const right = c.cornerSide === 'right';
        assert.equal(p.rotDeg, 0, `${label}: ${p.code} stands on the back wall`);
        const bodyEdge = right ? p.x + c.w / 2 : p.x - c.w / 2, want = right ? w / 2 - 24.25 : -w / 2 + 24.25;
        assert.ok(Math.abs(bodyEdge - want) < 0.01, `${label}: ${p.code} body edge ${bodyEdge} sits 24.25" off its side wall`);
        // the partner run: first cabinet on that side wall, front plane on the body edge, starting clear of the return
        const leg = r.placements.filter((q) => q.rotDeg === (right ? 270 : 90) && getCab(q.code).type === 'FLOOR');
        assert.ok(leg.length > 0, `${label}: ${p.code} has a partner run`);
        const first = leg.reduce((a, q) => (a.z < q.z ? a : q)), fc = getCab(first.code);
        const front = right ? first.x - fc.d / 2 : first.x + fc.d / 2;
        assert.ok(Math.abs(front - bodyEdge) < 0.3, `${label}: leg front ${front.toFixed(2)} meets the corner body ${bodyEdge.toFixed(2)}`);
        assert.ok(Math.abs((first.z - fc.w / 2) - (-d / 2 + 24.3)) < 0.1, `${label}: the leg starts against the return`);
        assert.equal(snapPosition(st, ids[i], p.x, p.z, b).flag, undefined, `${label}: ${p.code} passes the drag rule where it stands`);
        checked++;
      });
    }
  }
  assert.ok(checked >= 20, `checked ${checked} corner units`);
});

test('a corner unit that cannot reach its corner (a door in the way) joins the run instead, still no overlap', () => {
  const rm = room(168, 140, [{ id: 1, type: 'door', wall: 'back', pos: 0.95, width: 30 }]);
  const r = planRowsLayout([{ code: 'F16R', qty: 1 }, { code: 'F20', qty: 2 }], rm);
  assertClean(r.placements, rm, 'door in the corner');
  assert.equal(r.placements.length + r.unplaced.reduce((n, x) => n + x.qty, 0), 3);
});
