// endpanels.js — detect finished end panels needed on exposed cabinet faces.
//
// A free-standing (island) floor cabinet with no wall behind it and no cabinet
// butted against its back needs a finished END PANEL on that back so it reads
// (and is priced) as a proper island. Pure logic; the back face is already
// painted in 3D, so this only feeds the cost. One panel per exposed back.

import { getCab } from './catalogue.js';

const WALL_TOL = 8;

function inside(px, pz, self, list) {
  for (const o of list) {
    if (o.it === self) continue;
    const th = (o.it.rotDeg || 0) * Math.PI / 180;
    const dx = px - o.it.x, dz = pz - o.it.z;
    const lx = dx * Math.cos(-th) - dz * Math.sin(-th);
    const lz = dx * Math.sin(-th) + dz * Math.cos(-th);
    if (Math.abs(lx) <= o.cab.w / 2 + 1.5 && Math.abs(lz) <= o.cab.d / 2 + 1.5) return true;
  }
  return false;
}

/** The item ids of free-standing floor cabinets whose BACK is exposed —
 *  these get a finished (painted) back in 3D and a priced panel in the cost. */
export function exposedBackIds(state) {
  const r = state.room;
  const minX = -r.width / 2, maxX = r.width / 2, minZ = -r.depth / 2, maxZ = r.depth / 2;
  const floors = (state.items || [])
    .map((it) => ({ it, cab: getCab(it.code) }))
    .filter((x) => x.cab && x.cab.type === 'FLOOR');
  const seated = (it, cab) =>
    Math.abs(it.z - (minZ + cab.d / 2)) < WALL_TOL || Math.abs(it.z - (maxZ - cab.d / 2)) < WALL_TOL ||
    Math.abs(it.x - (minX + cab.d / 2)) < WALL_TOL || Math.abs(it.x - (maxX - cab.d / 2)) < WALL_TOL;
  const ids = new Set();
  for (const { it, cab } of floors) {
    if (seated(it, cab)) continue;
    const rad = (it.rotDeg || 0) * Math.PI / 180;
    const fx = Math.sin(rad), fz = Math.cos(rad);
    const bx = it.x - fx * (cab.d / 2 + 1.5);
    const bz = it.z - fz * (cab.d / 2 + 1.5);
    if (!inside(bx, bz, it, floors)) ids.add(it.id);
  }
  return ids;
}

/** @returns {{count:number}} how many exposed-back end panels the layout needs. */
export function computeEndPanels(state) {
  const r = state.room;
  const minX = -r.width / 2, maxX = r.width / 2, minZ = -r.depth / 2, maxZ = r.depth / 2;
  const floors = (state.items || [])
    .map((it) => ({ it, cab: getCab(it.code) }))
    .filter((x) => x.cab && x.cab.type === 'FLOOR');

  // every placeable unit (floor + tall) — used to test if a side/back is butted
  const all = (state.items || [])
    .map((it) => ({ it, cab: getCab(it.code) }))
    .filter((x) => x.cab && x.cab.placeable);

  const seated = (it, cab) =>
    Math.abs(it.z - (minZ + cab.d / 2)) < WALL_TOL || Math.abs(it.z - (maxZ - cab.d / 2)) < WALL_TOL ||
    Math.abs(it.x - (minX + cab.d / 2)) < WALL_TOL || Math.abs(it.x - (maxX - cab.d / 2)) < WALL_TOL;
  const nearWall = (px, pz) =>
    px <= minX + WALL_TOL || px >= maxX - WALL_TOL || pz <= minZ + WALL_TOL || pz >= maxZ - WALL_TOL;

  const backIds = exposedBackIds(state);
  let count = backIds.size;
  for (const f of floors) {
    const { it, cab } = f;
    const rad = (it.rotDeg || 0) * Math.PI / 180;
    if (!seated(it, cab)) continue;   // island backs counted above (backIds)
    // WALL RUN: cap each exposed END of the run. A side that meets a side wall
    // (filler/scribe) or butts a neighbouring unit needs no panel; an open end
    // does — "when the run finishes, always put an end panel."
    const sx = Math.cos(rad), sz = -Math.sin(rad);        // along the width (side) axis
    for (const dir of [1, -1]) {
      const px = it.x + dir * sx * (cab.w / 2 + 1.5);
      const pz = it.z + dir * sz * (cab.w / 2 + 1.5);
      if (nearWall(px, pz)) continue;
      if (inside(px, pz, it, all)) continue;
      count += 1;
    }
  }
  return { count };
}
