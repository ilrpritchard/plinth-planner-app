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

/** Distance from the start corner to the opening's NEAR edge (what the UI shows). */
export function openingNearEdge(room, o) {
  const len = openingWallLen(room, o.wall);
  return openingCenter(room, o) - openingWidth(o, room) / 2 + len / 2;
}
