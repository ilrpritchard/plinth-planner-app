// hoodseat.js — PURE. A range hood lives over the cooker: centred on the range or cooktop, its
// underside 800mm above the cooker top, its back on the wall the cooker stands against (or
// straight over an island cooker). Her rule 2026-09-22: "any range hood that's dragged in auto
// goes above the range cooker in the centre and at 800mm from the range top".
//
//   HOOD_CLEAR_IN            800mm
//   hoodMountY(cookerCab)    world Y of the hood's underside over that cooker
//   findHoodSeat(state, rawX, rawZ, ignoreId, hoodCab) -> { x, z, rotDeg, cookerId } | null
//     the seat over the cooker nearest the pointer; null when the kitchen has no cooker

import { getCab } from './catalogue.js';
import { mmToIn } from './units.js';

export const HOOD_CLEAR_IN = mmToIn(800);
const WALL_GAP = 0.25, NEAR = 14;
const isCooker = (c) => c && (c.appliance === 'range' || c.appliance === 'hob');
const rotOf = (it) => (((it.rotDeg || 0) % 360) + 360) % 360;

/** The cooker's top: a range is its own height off the floor; a cooktop sits on the worktop. */
export const cookerTop = (c) => (c.mountY || 0) + (c.h || 0);
export const hoodMountY = (cookerCab) => cookerTop(cookerCab) + HOOD_CLEAR_IN;

export function findHoodSeat(state, rawX, rawZ, ignoreId = null, hoodCab = null) {
  const r = (state && state.room) || {}, W = r.width || 144, D = r.depth || 120;
  const hd = (hoodCab && hoodCab.d) || 20;
  let best = null;
  for (const it of (state && state.items) || []) {
    if (it.id === ignoreId) continue;
    const c = getCab(it.code); if (!isCooker(c)) continue;
    const dist = Math.hypot(it.x - rawX, it.z - rawZ);
    if (best && dist >= best.dist) continue;
    const rot = rotOf(it);
    // on a wall? then the hood's back goes to that wall; on an island it hangs straight over
    let x = it.x, z = it.z;
    if (rot === 0 && it.z - c.d / 2 + D / 2 < NEAR) z = -D / 2 + hd / 2 + WALL_GAP;
    else if (rot === 180 && D / 2 - (it.z + c.d / 2) < NEAR) z = D / 2 - hd / 2 - WALL_GAP;
    else if (rot === 90 && it.x - c.d / 2 + W / 2 < NEAR) x = -W / 2 + hd / 2 + WALL_GAP;
    else if (rot === 270 && W / 2 - (it.x + c.d / 2) < NEAR) x = W / 2 - hd / 2 - WALL_GAP;
    best = { dist, x, z, rotDeg: rot, cookerId: it.id, cooker: c };
  }
  if (!best) return null;
  const { dist, cooker, ...seat } = best;
  return { ...seat, mountY: hoodMountY(cooker) };
}
