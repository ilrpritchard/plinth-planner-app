// openings.js — ONE source of truth for where a window/door/doorway sits on a
// wall, so the 3D model and the UI read-out can never disagree. Pure maths.
//
// `pos` is 0..1 along the wall. The centre is clamped so the opening never
// overhangs a corner (a 4" minimum reveal each end). All values in inches.

const REVEAL = 4; // minimum gap from a corner to the opening edge

export function openingWallLen(room, wall) {
  return (wall === 'left' || wall === 'right') ? room.depth : room.width;
}

export function openingWidth(o, room) {
  const len = openingWallLen(room, o.wall);
  const def = o.type === 'window' ? 48 : 34;
  return Math.min(Math.max(o.width || def, 16), len - 2 * REVEAL);
}

/** Clamped centre of the opening along the wall (world inches from wall mid). */
export function openingCenter(room, o) {
  const len = openingWallLen(room, o.wall);
  const w = openingWidth(o, room);
  const raw = -len / 2 + (o.pos ?? 0.5) * len;
  const lo = -len / 2 + w / 2 + REVEAL;
  const hi = len / 2 - w / 2 - REVEAL;
  return Math.max(lo, Math.min(hi, raw));
}

/** Every boxing (boxed-in pipe run / bulkhead) as a world box, the same numbers scene/Room.js
 *  draws: { wall, x0, x1, z0, z1, y0: 0, y1, along0, along1, d }. A boxing is SOLID: no cabinet
 *  stands in it or hangs on it (her draft 2026-09-22 put a run straight through one). */
export function boxingBoxes(room) {
  const W = room.width || 144, D = room.depth || 120, H = room.height || 96, out = [];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  for (const bx of room.boxings || []) {
    const wall = bx.wall || 'back', horiz = wall === 'back' || wall === 'front', len = horiz ? W : D;
    const w = clamp(bx.w || 8, 2, len), d = clamp(bx.d || 8, 2, 40), h = clamp(bx.h || H, 4, H);
    const along = clamp(-len / 2 + (bx.pos ?? 0.5) * len, -len / 2 + w / 2, len / 2 - w / 2);
    const a0 = along - w / 2, a1 = along + w / 2;
    const b = wall === 'back' ? { x0: a0, x1: a1, z0: -D / 2, z1: -D / 2 + d } : wall === 'front' ? { x0: a0, x1: a1, z0: D / 2 - d, z1: D / 2 }
      : wall === 'left' ? { x0: -W / 2, x1: -W / 2 + d, z0: a0, z1: a1 } : { x0: W / 2 - d, x1: W / 2, z0: a0, z1: a1 };
    out.push({ id: bx.id, wall, ...b, y0: 0, y1: h, along0: a0, along1: a1, d, w, h });
  }
  return out;
}

/** Distance from the start corner to the opening's NEAR edge (what the UI shows). */
export function openingNearEdge(room, o) {
  const len = openingWallLen(room, o.wall);
  return openingCenter(room, o) - openingWidth(o, room) / 2 + len / 2;
}
