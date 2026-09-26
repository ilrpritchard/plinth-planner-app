// fitwidth.js — PURE. An open shelf or the tray space CUT TO FIT the space it lands in (her ask
// 2026-09-26: "can these auto resize to fit leftover space, and the same as the floor tray
// space"). Given what measureRun found either side of it (gap + what it is to), the plan says
// what width it should become and how far its centre shifts along the run so the edge that
// already touches something stays put.
//   planFitToGap(cab, m, opts) -> { code, w, shift } | null
//     cab: the cabinet (canFitWidth), m: { w, before:{gap,to}, after:{gap,to} } from measureRun,
//     shift: inches along the run (+ = toward `after`), null when nothing needs doing.
//   opts.grow (default true): fill a leftover gap on the open side (up to FIT_WIDTH_LIMITS[1])
//   opts.shrink (default true): a gap narrower than the cabinet on both sides -> narrow to it

import { getCab, canFitWidth, sizedWidthCode, FIT_WIDTH_LIMITS } from './catalogue.js';
import { MOUNT } from './units.js';
import { boxAt } from './placement.js';
import { boxingBoxes } from './openings.js';

const TOUCH = 0.4;          // this close is touching
const LEFTOVER_MAX = 18;    // a gap wider than this is a cabinet's worth, not a leftover

export function planFitToGap(cab, m, opts = {}) {
  if (!cab || !canFitWidth(cab) || !m) return null;
  const grow = opts.grow !== false, shrink = opts.shrink !== false;
  const b = m.before.gap, a = m.after.gap, [lo, hi] = FIT_WIDTH_LIMITS;
  const touchB = b < TOUCH, touchA = a < TOUCH;
  let w = null, shift = 0;
  if (grow && touchB !== touchA) {                                   // one side touching, a leftover on the other
    const gap = touchB ? a : b;
    if (gap >= TOUCH && gap <= LEFTOVER_MAX && m.w + gap <= hi + 0.05) { w = m.w + gap; shift = (touchB ? 1 : -1) * gap / 2; }
  } else if (grow && touchB && touchA) {
    return null;                                                     // already snug
  } else if (grow && !touchB && !touchA && (b <= LEFTOVER_MAX || a <= LEFTOVER_MAX)) {
    // loose between two things with leftovers both sides: fill the whole slot when it is one shelf's worth
    const total = m.w + a + b;
    if (total <= hi + 0.05 && Math.min(a, b) >= TOUCH) { w = total; shift = (a - b) / 2; }
  }
  if (w == null) return null;
  w = Math.round(w * 2) / 2;
  if (w < lo || Math.abs(w - m.w) < 0.05) return null;
  const code = sizedWidthCode(cab.baseCode || cab.code, w);
  return { code, w: getCab(code).w, shift };
}

/** A cabinet asked to be `width` wide by hand: which way it grows/shrinks so a touching edge stays. */
export function planSetWidth(cab, m, width) {
  if (!cab || !canFitWidth(cab)) return null;
  const code = sizedWidthCode(cab.baseCode || cab.code, width);
  const w = getCab(code).w, dw = w - m.w;
  if (Math.abs(dw) < 0.05) return null;
  const touchB = m.before.gap < TOUCH, touchA = m.after.gap < TOUCH;
  const shift = touchB && !touchA ? dw / 2 : touchA && !touchB ? -dw / 2 : 0;   // keep the touching edge; centred otherwise
  return { code, w, shift };
}

/** The wall nearest a point, and the coordinate along it. */
export function wallNear(bounds, x, z) {
  const c = [['back', z - bounds.minZ], ['front', bounds.maxZ - z], ['left', x - bounds.minX], ['right', bounds.maxX - x]].sort((p, q) => p[1] - q[1])[0][0];
  return { wall: c, along: c === 'back' || c === 'front' ? x : z, rotDeg: { back: 0, left: 90, front: 180, right: 270 }[c] };
}

/** A shelf or tray space DROPPED INTO A SLOT NARROWER THAN ITSELF (her share link 2026-09-26: a
 *  20" shelf refused in the 15.5" between an upper and a bulkhead): the free stretch of `wall`
 *  around `along`, between whatever stands in the cabinet's height band, bulkheads and the room
 *  corners. -> { code, w, x, z, rotDeg } to place it there, or null (no slot, or one it would
 *  have fitted anyway). */
export function planShrinkToSlot(state, cab, wall, along, bounds, ignoreId = null) {
  if (!cab || !canFitWidth(cab)) return null;
  const horiz = wall === 'back' || wall === 'front';
  const [wallLo, wallHi] = horiz ? [bounds.minX, bounds.maxX] : [bounds.minZ, bounds.maxZ];
  const y0 = cab.mountY ?? MOUNT[cab.type] ?? 0, y1 = y0 + (cab.h || 0);
  const lane = cab.d + 2;                                             // how far off the wall the shelf reaches
  const inLane = (b) => (wall === 'back' ? b.z0 < bounds.minZ + lane : wall === 'front' ? b.z1 > bounds.maxZ - lane : wall === 'left' ? b.x0 < bounds.minX + lane : b.x1 > bounds.maxX - lane);
  // everything solid along this wall in the shelf's band, then the free stretches between them;
  // the stretch under the pointer, or failing that the nearest one (the hand may be over the
  // bulkhead or the neighbour it is aiming beside)
  const solid = [];
  for (const it of state.items || []) {
    if (it.id === ignoreId) continue;
    const c = getCab(it.code); if (!c || !c.placeable) continue;
    const oy0 = c.mountY ?? MOUNT[c.type] ?? 0, oy1 = oy0 + (c.h || 0);
    if (oy1 <= y0 + 0.5 || oy0 >= y1 - 0.5) continue;                 // not in this height band
    const b = boxAt(c, it.x, it.z, it.rotDeg);
    if (!inLane(b)) continue;
    solid.push(horiz ? [b.x0, b.x1] : [b.z0, b.z1]);
  }
  for (const bx of boxingBoxes(state.room || {})) {
    if (bx.wall !== wall || bx.y1 <= y0 + 0.5) continue;
    solid.push([bx.along0, bx.along1]);
  }
  solid.sort((p, q) => p[0] - q[0]);
  const free = []; let cur = wallLo;
  for (const [a0, a1] of solid) { if (a0 > cur + 0.05) free.push([cur, a0]); cur = Math.max(cur, a1); }
  if (cur < wallHi - 0.05) free.push([cur, wallHi]);
  const pick = free.find(([a0, a1]) => a0 <= along && a1 >= along)
    || [...free].sort((p, q) => Math.min(Math.abs(p[0] - along), Math.abs(p[1] - along)) - Math.min(Math.abs(q[0] - along), Math.abs(q[1] - along)))[0];
  if (!pick) return null;
  const [lo, hi] = pick;
  const slot = hi - lo;
  if (slot < FIT_WIDTH_LIMITS[0] - 0.05 || slot >= cab.w - 0.05) return null;   // nothing there, or it fitted anyway
  const w = Math.floor(slot * 2) / 2;
  const code = sizedWidthCode(cab.baseCode || cab.code, w);
  const wCab = getCab(code); if (!wCab) return null;
  const centre = lo + slot / 2, off = wCab.d / 2 + 0.25;
  const pos = wall === 'back' ? { x: centre, z: bounds.minZ + off } : wall === 'front' ? { x: centre, z: bounds.maxZ - off } : wall === 'left' ? { x: bounds.minX + off, z: centre } : { x: bounds.maxX - off, z: centre };
  return { code, w: wCab.w, ...pos, rotDeg: { back: 0, left: 90, front: 180, right: 270 }[wall] };
}
