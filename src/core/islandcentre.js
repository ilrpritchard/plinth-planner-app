// islandcentre.js — PURE. "Centre the island in the room" in one press (her ask 2026-09-21).
// Dragging an island to the middle by eye never quite lands. planIslandCentre() moves the WHOLE
// island (both rows, and the sink or cooktop riding in it) sideways so it is centred:
//   about 'room'  : in the open floor between the side walls (or between the fronts of the
//                   runs standing on them, when there are any)
//   about 'range' : on the range on the back wall
// Only ever sideways (along the back wall). How far it stands off the run is the walkway,
// and that is a clearance decision, never a centring one.
//
//   planIslandCentre(state, id, about) -> { ok:true, dx, moves:[{id,x,z}], target }
//                                       | { ok:false, reason }   'not island' | 'no range' | 'already' | 'blocked'

import { getCab } from './catalogue.js';
import { boxAt } from './placement.js';

const riders = (c) => ['sink', 'hob', 'oven'].includes(c.appliance);
const floorLine = (c) => c.type === 'FLOOR' || c.type === 'TALL' || (c.type === 'APPLIANCES' && (c.mountY || 0) === 0 && !riders(c));
const rotOf = (it) => (((it.rotDeg || 0) % 360) + 360) % 360;
const touch = (p, q, pad) => p.x0 < q.x1 + pad && p.x1 > q.x0 - pad && p.z0 < q.z1 + pad && p.z1 > q.z0 - pad;

/** "Stand the island `clearIn` off the counters" (her ask 2026-09-26: "how can I make sure it sits
 *  1000mm from each counter"): the whole island (both rows, and what rides in it) moves so its
 *  back-run side is exactly `clearIn` from the face of the run it works with, and it is centred
 *  between the side runs when there are two (their clearance is then whatever the floor gives,
 *  reported), or `clearIn` from the one side run there is. Never through anything.
 *   -> { ok:true, moves, clear:{ back, left, right } (inches, null where there is no run) }
 *    | { ok:false, reason: 'not island' | 'no run' | 'already' | 'blocked' | 'too tight', clear } */
export function planIslandSpacing(state, id, clearIn = 1000 / 25.4) {
  const r = state.room || {}, W = r.width || 144, D = r.depth || 120;
  const b = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
  const all = (state.items || []).map((it) => ({ it, cab: getCab(it.code) })).filter((x) => x.cab && x.cab.placeable).map((x) => ({ ...x, box: boxAt(x.cab, x.it.x, x.it.z, x.it.rotDeg) }));
  const sel = all.find((t) => t.it.id === id);
  const nearWall = (t) => Math.min(t.box.x0 - b.minX, b.maxX - t.box.x1, t.box.z0 - b.minZ, b.maxZ - t.box.z1) < 6;
  const free = (t) => floorLine(t.cab) && (t.it.island || !nearWall(t));
  if (!sel || !free(sel)) return { ok: false, reason: 'not island' };
  const group = [sel];
  for (let grew = true; grew;) { grew = false; for (const t of all) if (!group.includes(t) && free(t) && group.some((g) => touch(g.box, t.box, 1))) { group.push(t); grew = true; } }
  const x0 = Math.min(...group.map((t) => t.box.x0)), x1 = Math.max(...group.map((t) => t.box.x1));
  const z0 = Math.min(...group.map((t) => t.box.z0)), z1 = Math.max(...group.map((t) => t.box.z1));
  const riding = all.filter((t) => !group.includes(t) && riders(t.cab) && t.it.x > x0 && t.it.x < x1 && t.it.z > z0 && t.it.z < z1);
  const runs = all.filter((t) => !group.includes(t) && !riding.includes(t) && !t.it.island && floorLine(t.cab) && nearWall(t));
  // the faces the island keeps clear of: the back run in front of the island's span (widened by
  // the clearance, since the island may move sideways), the side runs across its depth
  const backFace = Math.max(-Infinity, ...runs.filter((t) => rotOf(t.it) === 0 && t.box.z0 - b.minZ < 14 && t.box.x1 > x0 - clearIn - 12 && t.box.x0 < x1 + clearIn + 12).map((t) => t.box.z1));
  const leftFace = Math.max(-Infinity, ...runs.filter((t) => rotOf(t.it) === 90 && t.box.x0 - b.minX < 14 && t.box.z1 > b.minZ && t.box.z0 < z1 + clearIn + 12).map((t) => t.box.x1));
  const rightFace = Math.min(Infinity, ...runs.filter((t) => rotOf(t.it) === 270 && b.maxX - t.box.x1 < 14 && t.box.z1 > b.minZ && t.box.z0 < z1 + clearIn + 12).map((t) => t.box.x0));
  const hasBack = Number.isFinite(backFace), hasL = Number.isFinite(leftFace), hasR = Number.isFinite(rightFace);
  if (!hasBack && !hasL && !hasR) return { ok: false, reason: 'no run' };
  let dz = hasBack ? (backFace + clearIn) - z0 : 0;
  let dx = 0;
  const w = x1 - x0;
  if (hasL && hasR) dx = (leftFace + rightFace) / 2 - (x0 + x1) / 2;
  else if (hasL) dx = (leftFace + clearIn) - x0;
  else if (hasR) dx = (rightFace - clearIn) - x1;
  const clear = {
    back: hasBack ? clearIn : null,
    left: hasL ? (x0 + dx) - leftFace : null,
    right: hasR ? rightFace - (x1 + dx) : null,
  };
  if (hasL && hasR && (rightFace - leftFace - w) / 2 < clearIn - 0.5) return { ok: false, reason: 'too tight', clear };
  if (hasBack && z1 + dz > b.maxZ - 0.05) return { ok: false, reason: 'too tight', clear };
  if (Math.abs(dx) < 0.25 && Math.abs(dz) < 0.25) return { ok: false, reason: 'already', clear };
  const others = all.filter((t) => !group.includes(t) && !riding.includes(t) && floorLine(t.cab));
  const hit = group.some((g) => { const m = { x0: g.box.x0 + dx, x1: g.box.x1 + dx, z0: g.box.z0 + dz, z1: g.box.z1 + dz }; return m.x0 < b.minX - 0.05 || m.x1 > b.maxX + 0.05 || m.z0 < b.minZ - 0.05 || m.z1 > b.maxZ + 0.05 || others.some((o) => touch(m, o.box, -0.1)); });
  if (hit) return { ok: false, reason: 'blocked', clear };
  return { ok: true, dx, dz, clear, moves: [...group, ...riding].map((t) => ({ id: t.it.id, x: t.it.x + dx, z: t.it.z + dz })) };
}

export function planIslandCentre(state, id, about = 'room') {
  const r = state.room || {}, W = r.width || 144, D = r.depth || 120;
  const b = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
  const all = (state.items || []).map((it) => ({ it, cab: getCab(it.code) })).filter((x) => x.cab && x.cab.placeable).map((x) => ({ ...x, box: boxAt(x.cab, x.it.x, x.it.z, x.it.rotDeg) }));
  const sel = all.find((t) => t.it.id === id);
  const nearWall = (t) => Math.min(t.box.x0 - b.minX, b.maxX - t.box.x1, t.box.z0 - b.minZ, b.maxZ - t.box.z1) < 6;
  const free = (t) => floorLine(t.cab) && (t.it.island || !nearWall(t));
  if (!sel || !free(sel)) return { ok: false, reason: 'not island' };

  // the island: every free-standing cabinet touching the selected one, through the others
  const group = [sel];
  for (let grew = true; grew;) { grew = false; for (const t of all) if (!group.includes(t) && free(t) && group.some((g) => touch(g.box, t.box, 1))) { group.push(t); grew = true; } }
  const x0 = Math.min(...group.map((t) => t.box.x0)), x1 = Math.max(...group.map((t) => t.box.x1));
  const z0 = Math.min(...group.map((t) => t.box.z0)), z1 = Math.max(...group.map((t) => t.box.z1));
  // ...and whatever rides in it
  const riding = all.filter((t) => !group.includes(t) && riders(t.cab) && t.it.x > x0 && t.it.x < x1 && t.it.z > z0 && t.it.z < z1);

  let target;
  if (about === 'range') {
    const range = all.find((t) => t.cab.appliance === 'range' && !group.includes(t) && rotOf(t.it) === 0 && t.box.z0 - b.minZ < 14);
    if (!range) return { ok: false, reason: 'no range' };
    target = (range.box.x0 + range.box.x1) / 2;
  } else {
    // the open floor: from the front of a run on the left wall to the front of one on the right
    const side = (rot, edge) => all.filter((t) => !group.includes(t) && !t.it.island && floorLine(t.cab) && rotOf(t.it) === rot && nearWall(t) && t.box.z1 > z0 && t.box.z0 < z1).map(edge);
    const lo = Math.max(b.minX, ...side(90, (t) => t.box.x1)), hi = Math.min(b.maxX, ...side(270, (t) => t.box.x0));
    target = (lo + hi) / 2;
  }
  const dx = target - (x0 + x1) / 2;
  if (Math.abs(dx) < 0.25) return { ok: false, reason: 'already' };
  const others = all.filter((t) => !group.includes(t) && !riding.includes(t) && floorLine(t.cab));
  const hit = group.some((g) => { const m = { ...g.box, x0: g.box.x0 + dx, x1: g.box.x1 + dx }; return m.x0 < b.minX - 0.05 || m.x1 > b.maxX + 0.05 || others.some((o) => touch(m, o.box, -0.1)); });
  if (hit) return { ok: false, reason: 'blocked' };
  return { ok: true, dx, target, moves: [...group, ...riding].map((t) => ({ id: t.it.id, x: t.it.x + dx, z: t.it.z })) };
}
