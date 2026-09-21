// placement.js — PURE. Where can a newly added cabinet or appliance actually STAND?
//
// Tap-to-add used to append at the end of the run on the active wall even when the wall
// was full. That start point can be OUTSIDE the room, and when the snap then refused the
// spot it handed the start point back: her fridge landed outside the room (2026-09-21).
// spotOk() is the test, findFreeSpot() the search. Nothing here moves anything.
//
//   spotOk(state, cab, x, z, rotDeg, bounds, ignoreId)   inside the room, on nothing, across no door
//   findFreeSpot(state, cab, bounds, wall, ignoreId)     { x, z, rotDeg, wall } | null
//   "wall" in the result is 'back' | 'left' | 'right' | 'front' | 'floor' (free-standing)

import { getCab } from './catalogue.js';
import { MOUNT, mmToIn } from './units.js';
import { openingCenter, openingWidth } from './openings.js';

const WALL_GAP = 0.25, TALL_PROUD = mmToIn(30), EPS = 0.05;
const ROT = { back: 0, left: 90, front: 180, right: 270 };
const mountY = (cab) => (typeof cab.mountY === 'number' ? cab.mountY : (MOUNT[cab.type] ?? 0));

/** World box of a cabinet at a position (corner units include their blank return). */
export function boxAt(cab, x, z, rotDeg) {
  const ret = cab.corner ? (cab.type === 'FLOOR' ? 20 : 10) : 0;
  const l = cab.w / 2 + (cab.corner && cab.cornerSide !== 'right' ? ret : 0), r = cab.w / 2 + (cab.corner && cab.cornerSide === 'right' ? ret : 0);
  const rad = ((rotDeg || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [lx, lz] of [[-l, -cab.d / 2], [r, -cab.d / 2], [r, cab.d / 2], [-l, cab.d / 2]]) {
    const wx = lx * c + lz * s, wz = -lx * s + lz * c;
    x0 = Math.min(x0, x + wx); x1 = Math.max(x1, x + wx); z0 = Math.min(z0, z + wz); z1 = Math.max(z1, z + wz);
  }
  const y0 = mountY(cab);
  return { x0, x1, z0, z1, y0, y1: y0 + (cab.h || 1) };
}

const hits = (a, b) => a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.z0 < b.z1 - EPS && a.z1 > b.z0 + EPS && a.y0 < b.y1 - EPS && a.y1 > b.y0 + EPS;

/** Is this a place something can stand: wholly inside the room, overlapping nothing at its
 *  height, and (for anything that reaches the floor or the door head) not across a door? */
export function spotOk(state, cab, x, z, rotDeg, bounds, ignoreId = null) {
  if (![x, z].every(Number.isFinite)) return false;
  const b = boxAt(cab, x, z, rotDeg);
  if (b.x0 < bounds.minX - EPS || b.x1 > bounds.maxX + EPS || b.z0 < bounds.minZ - EPS || b.z1 > bounds.maxZ + EPS) return false;
  for (const it of state.items || []) {
    if (it.id === ignoreId) continue;
    const c = getCab(it.code); if (!c || !c.placeable) continue;
    if (c.appliance === 'oven' || c.appliance === 'sink' || c.appliance === 'hob') continue;      // riders sit IN a cabinet
    if (hits(b, boxAt(c, it.x, it.z, it.rotDeg))) return false;
  }
  // a door needs its opening clear of anything standing within 30" of that wall
  const room = state.room || {};
  for (const o of room.openings || []) {
    if (o.type === 'window') continue;
    const wl = o.wall || 'back', ctr = openingCenter(room, o), hw = openingWidth(o, room) / 2 + 1;
    const near = wl === 'back' ? b.z0 < bounds.minZ + 30 : wl === 'front' ? b.z1 > bounds.maxZ - 30 : wl === 'left' ? b.x0 < bounds.minX + 30 : b.x1 > bounds.maxX - 30;
    const [a0, a1] = wl === 'back' || wl === 'front' ? [b.x0, b.x1] : [b.z0, b.z1];
    if (near && a0 < ctr + hw && a1 > ctr - hw) return false;
  }
  return true;
}

/** The first place `cab` can stand: along the asked-for wall first (left to right, butted
 *  to what is there), then the other walls, then free-standing on the floor. */
export function findFreeSpot(state, cab, bounds, wall = 'back', ignoreId = null) {
  const off = cab.d / 2 + WALL_GAP + (cab.type === 'TALL' ? TALL_PROUD : 0);
  const at = (wl, along) => (wl === 'back' ? { x: along, z: bounds.minZ + off } : wl === 'front' ? { x: along, z: bounds.maxZ - off }
    : wl === 'left' ? { x: bounds.minX + off, z: along } : { x: bounds.maxX - off, z: along });
  const hung = cab.type === 'WALL' || cab.type === 'SHELF' || cab.type === 'COUNTER' || cab.appliance === 'hood';
  const walls = [wall, 'back', 'left', 'right', 'front'].filter((w, i, a) => ROT[w] != null && a.indexOf(w) === i);
  const half = (cab.w / 2) + (cab.corner ? (cab.type === 'FLOOR' ? 20 : 10) : 0);
  for (const wl of walls) {
    const [lo, hi] = wl === 'back' || wl === 'front' ? [bounds.minX, bounds.maxX] : [bounds.minZ, bounds.maxZ];
    // candidate positions: butted against each thing already on that wall, then a fine sweep
    const edges = [lo + half];
    for (const it of state.items || []) { if (it.id === ignoreId) continue; const c = getCab(it.code); if (!c || !c.placeable) continue; const bx = boxAt(c, it.x, it.z, it.rotDeg); const [e0, e1] = wl === 'back' || wl === 'front' ? [bx.x0, bx.x1] : [bx.z0, bx.z1]; edges.push(e1 + half, e0 - half); }
    for (let a = lo + half; a <= hi - half + 1e-6; a += 1) edges.push(a);
    for (const along of edges) {
      if (along < lo + half - 1e-6 || along > hi - half + 1e-6) continue;
      const p = at(wl, along);
      if (spotOk(state, cab, p.x, p.z, ROT[wl], bounds, ignoreId)) return { ...p, rotDeg: ROT[wl], wall: wl };
    }
  }
  if (hung) return null;                                        // a hung cabinet cannot float: no wall space, no place
  // free-standing: sweep the floor from the middle outwards, 44" clear of the walls where the room allows
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2, spots = [];
  for (let x = bounds.minX + cab.w / 2 + 1; x <= bounds.maxX - cab.w / 2 - 1; x += 3) for (let z = bounds.minZ + cab.d / 2 + 1; z <= bounds.maxZ - cab.d / 2 - 1; z += 3) spots.push([x, z]);
  spots.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cz) - Math.hypot(q[0] - cx, q[1] - cz));
  for (const [x, z] of spots) if (spotOk(state, cab, x, z, 0, bounds, ignoreId)) return { x, z, rotDeg: 0, wall: 'floor' };
  return null;
}
