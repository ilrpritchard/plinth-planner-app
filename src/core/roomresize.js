// roomresize.js — PURE. Changing the room size keeps the kitchen ON ITS WALLS and INSIDE THE ROOM.
//
// Positions are stored from the middle of the room, so a new width used to move BOTH side
// walls and leave every cabinet where it was: make the room narrower and the run on the side
// wall was suddenly outside the building (her screenshots 2026-09-21: "why is it still being
// allowed to stick through the wall?? if a room is resized, always move the cabinets into the
// room and flag where the dimension issue is").
//
// 1. ANCHOR. The room grows and shrinks at its RIGHT and FRONT: everything keeps its distance
//    from the LEFT and BACK walls, except what stands on the right (or front) wall, which stays
//    on it. Windows, doors and boxings keep their distance from the same corner.
// 2. BRING INSIDE. Each wall's run (its cabinets, the range, the uppers over them, the sink in
//    them) moves AS ONE back inside the room, stopping at a run on the adjoining wall. So does
//    an island. Nothing is ever left through a wall.
// 3. FLAG. A run that is now LONGER than the space it has cannot fit: it is packed against the
//    far wall (so its cabinets overlap there) and reported: issues [{ wall, over }].
//
//   planRoomResize(state, { width?, depth? }) -> { moves:[{id,x,z}], openings:[{id,pos}], boxings:[{id,pos}], issues:[{wall,over}], inside:n }
//   planBringInside(state)                    -> the same with no size change: for a design that was SAVED broken
//   anyOutside(state)                         -> true when some cabinet is through a wall
// `inside` = how many cabinets step 2 had to move.

import { getCab } from './catalogue.js';
import { boxAt, spotOk } from './placement.js';
import { boxingBoxes } from './openings.js';
import { MOUNT } from './units.js';

const NEAR = 14, TOL = 0.3, KISS = 3;          // KISS: runs that meet at a corner overlap by less than this
const ROT_WALL = { 0: 'back', 90: 'left', 180: 'front', 270: 'right' };
const riders = (c) => ['sink', 'hob', 'oven'].includes(c.appliance);
const floorLine = (c) => c.type === 'FLOOR' || c.type === 'TALL' || (c.type === 'APPLIANCES' && (c.mountY || 0) === 0 && !riders(c));
const rotOf = (it) => (((it.rotDeg || 0) % 360) + 360) % 360;
const touch = (p, q, pad = 1) => p.x0 < q.x1 + pad && p.x1 > q.x0 - pad && p.z0 < q.z1 + pad && p.z1 > q.z0 - pad;

export function anyOutside(state) {
  const r = (state && state.room) || {}, W = r.width || 144, D = r.depth || 120;
  return ((state && state.items) || []).some((it) => { const c = getCab(it.code); if (!c || !c.placeable) return false; const b = boxAt(c, it.x, it.z, it.rotDeg);
    return b.x0 < -W / 2 - TOL || b.x1 > W / 2 + TOL || b.z0 < -D / 2 - TOL || b.z1 > D / 2 + TOL; });
}

export const planBringInside = (state) => planRoomResize(state, {});

/** Cabinets standing in a boxing (bulkhead) are moved out along their wall to the nearest side
 *  that is inside the room and clear of everything else; the ones with nowhere to go are left
 *  for the warning to name. -> { moves:[{id,x,z}], stuck:[id] } */
export function planClearBoxings(state) {
  const r = (state && state.room) || {}, W = r.width || 144, D = r.depth || 120;
  const b = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
  const boxes = boxingBoxes(r), out = { moves: [], stuck: [] };
  if (!boxes.length) return out;
  const virt = { ...state, items: state.items.map((it) => ({ ...it })) };
  for (const it of virt.items) {
    const cab = getCab(it.code); if (!cab || !cab.placeable || cab.corner) continue;         // a corner unit is cut in round a bulkhead on site
    const y0 = cab.mountY ?? MOUNT[cab.type] ?? 0;
    const bb = boxAt(cab, it.x, it.z, it.rotDeg);
    const inBox = boxes.filter((bx) => touch(bb, bx, -0.5) && y0 < bx.y1 - 0.5);
    if (!inBox.length) continue;
    const alongX = rotOf(it) % 180 === 0;
    const tries = [];
    for (const bx of inBox) {
      if (alongX) { tries.push({ x: it.x + (bx.x1 - bb.x0) + 0.05, z: it.z }); tries.push({ x: it.x - (bb.x1 - bx.x0) - 0.05, z: it.z }); }
      else { tries.push({ x: it.x, z: it.z + (bx.z1 - bb.z0) + 0.05 }); tries.push({ x: it.x, z: it.z - (bb.z1 - bx.z0) - 0.05 }); }
    }
    tries.sort((p, q) => Math.hypot(p.x - it.x, p.z - it.z) - Math.hypot(q.x - it.x, q.z - it.z));
    const spot = tries.find((t) => spotOk(virt, cab, t.x, t.z, it.rotDeg, b, it.id));
    if (!spot) { out.stuck.push(it.id); continue; }
    it.x = spot.x; it.z = spot.z; out.moves.push({ id: it.id, x: spot.x, z: spot.z });
  }
  return out;
}

export function planRoomResize(state, patch = {}) {
  const r = (state && state.room) || {}, W0 = r.width || 144, D0 = r.depth || 120;
  const W1 = patch.width ?? W0, D1 = patch.depth ?? D0, dW = W1 - W0, dD = D1 - D0;
  const out = { moves: [], openings: [], boxings: [], issues: [], inside: 0 };

  // ---- 1. anchor ----
  const things = [];
  for (const it of (state && state.items) || []) {
    const cab = getCab(it.code); if (!cab) continue;
    const b = boxAt(cab, it.x, it.z, it.rotDeg);
    const onRight = !it.island && rotOf(it) === 270 && W0 / 2 - b.x1 < NEAR;
    const onFront = !it.island && rotOf(it) === 180 && D0 / 2 - b.z1 < NEAR;
    const t = { it, cab, x: it.x + (onRight ? dW / 2 : -dW / 2), z: it.z + (onFront ? dD / 2 : -dD / 2) };
    things.push(t);
  }
  const box = (t) => boxAt(t.cab, t.x, t.z, t.it.rotDeg);
  const B = { x: [-W1 / 2, W1 / 2], z: [-D1 / 2, D1 / 2] };

  // ---- 2. bring inside, a group at a time ----
  const placeable = things.filter((t) => t.cab.placeable);
  const offWall = (t, wall) => { const b = box(t); return wall === 'back' ? b.z0 - B.z[0] : wall === 'front' ? B.z[1] - b.z1 : wall === 'left' ? b.x0 - B.x[0] : B.x[1] - b.x1; };
  const groups = [], taken = new Set();
  for (const wall of ['back', 'left', 'right', 'front']) {
    const g = placeable.filter((t) => !taken.has(t) && !t.it.island && ROT_WALL[rotOf(t.it)] === wall && offWall(t, wall) < NEAR);
    if (g.length) { g.forEach((t) => taken.add(t)); groups.push({ wall, members: g }); }
  }
  // free-standing: islands as clusters (with whatever rides in them), anything else on its own
  const free = placeable.filter((t) => !taken.has(t)), solid = free.filter((t) => floorLine(t.cab)), seen = new Set();
  for (const s of solid) {
    if (seen.has(s)) continue;
    const cl = [s]; seen.add(s);
    for (let i = 0; i < cl.length; i++) for (const o of solid) if (!seen.has(o) && touch(box(cl[i]), box(o))) { seen.add(o); cl.push(o); }
    const bb = cl.map(box), x0 = Math.min(...bb.map((b) => b.x0)), x1 = Math.max(...bb.map((b) => b.x1)), z0 = Math.min(...bb.map((b) => b.z0)), z1 = Math.max(...bb.map((b) => b.z1));
    for (const o of free) if (!floorLine(o.cab) && !seen.has(o) && o.x > x0 && o.x < x1 && o.z > z0 && o.z < z1) { seen.add(o); cl.push(o); }
    groups.push({ wall: 'island', members: cl });
  }
  for (const o of free) if (!seen.has(o)) groups.push({ wall: 'island', members: [o], loose: true });

  const shiftAll = (g, ax, d) => { if (Math.abs(d) < 1e-9) return; for (const t of g.members) t[ax] += d; };
  const span = (g, ax, only = () => true) => { const bs = g.members.filter(only).map(box); const use = bs.length ? bs : g.members.map(box);
    return [Math.min(...use.map((b) => b[ax + '0'])), Math.max(...use.map((b) => b[ax + '1']))]; };
  const fit = (g, ax) => {
    const px = ax === 'x' ? 'z' : 'x';
    let [lo, hi] = B[ax];
    const [s0, s1] = span(g, ax), [p0, p1] = span(g, px, (t) => floorLine(t.cab)), mid = (s0 + s1) / 2;
    // a run on the adjoining wall that really stands in the way (not one that only meets it at the corner)
    for (const o of placeable) { if (g.members.includes(o) || !floorLine(o.cab)) continue; const b = box(o);
      if (Math.min(p1, b[px + '1']) - Math.max(p0, b[px + '0']) < KISS) continue;
      if ((b[ax + '0'] + b[ax + '1']) / 2 < mid) lo = Math.max(lo, b[ax + '1']); else hi = Math.min(hi, b[ax + '0']); }
    if (s0 >= lo - TOL && s1 <= hi + TOL) return;                       // already inside
    if (s1 - s0 <= hi - lo + TOL) { shiftAll(g, ax, s0 < lo ? lo - s0 : hi - s1); return; }
    // longer than the space it has: butt it to the near end, pack the rest against the far wall, and say so
    out.issues.push({ wall: g.wall, over: (s1 - s0) - (hi - lo) });
    shiftAll(g, ax, lo - s0);
    for (const t of g.members) { const b = box(t); if (b[ax + '1'] > B[ax][1]) t[ax] -= b[ax + '1'] - B[ax][1]; if (box(t)[ax + '0'] < B[ax][0]) t[ax] += B[ax][0] - box(t)[ax + '0']; }
  };
  const before = new Map(placeable.map((t) => [t, [t.x, t.z]]));
  for (const g of groups) {
    const along = g.wall === 'left' || g.wall === 'right' ? 'z' : 'x', across = along === 'x' ? 'z' : 'x';
    // across: the whole group comes back through its wall together
    const [c0, c1] = span(g, across);
    if (c1 - c0 <= B[across][1] - B[across][0] + TOL) { if (c0 < B[across][0] - TOL) shiftAll(g, across, B[across][0] - c0); else if (c1 > B[across][1] + TOL) shiftAll(g, across, B[across][1] - c1); }
    if (g.wall === 'island') { const [a0, a1] = span(g, along); if (a1 - a0 <= B[along][1] - B[along][0] + TOL) { if (a0 < B[along][0] - TOL) shiftAll(g, along, B[along][0] - a0); else if (a1 > B[along][1] + TOL) shiftAll(g, along, B[along][1] - a1); } else out.issues.push({ wall: 'island', over: (a1 - a0) - (B[along][1] - B[along][0]) }); }
    else fit(g, along);
  }
  for (const t of placeable) { const [bx, bz] = before.get(t); if (Math.abs(t.x - bx) > 1e-6 || Math.abs(t.z - bz) > 1e-6) out.inside++; }
  for (const t of things) if (t.x !== t.it.x || t.z !== t.it.z) out.moves.push({ id: t.it.id, x: t.x, z: t.z });

  // ---- openings keep their distance from the left / back corner of their wall ----
  const keep = (list, into) => { for (const o of list || []) {
    const side = o.wall === 'left' || o.wall === 'right', [l0, l1] = side ? [D0, D1] : [W0, W1];
    if (l0 === l1) continue;
    into.push({ id: o.id, pos: Math.max(0, Math.min(1, ((o.pos ?? 0.5) * l0) / l1)) });
  } };
  keep(r.openings, out.openings); keep(r.boxings, out.boxings);
  return out;
}
