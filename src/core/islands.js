// islands.js — PURE. The planner works out for itself what is an island.
//
// `island: true` used to be set only when a cabinet was ADDED on the Island tab (or by the
// wizard / "Make double sided"). Drag a wall cabinet out to the island, or duplicate one, and
// it kept the wrong flag: her own design (2026-09-21) had two of six island cabinets unflagged,
// so the elevation, the submittal's ISLAND list and the island worktop all missed them.
//
// The flag now FOLLOWS WHERE THE CABINET STANDS. Floor-standing cabinets that touch form a
// cluster:
//   * no member stands on a wall  -> the cluster is an island: every member is flagged
//   * a member stands on a wall   -> it is a wall run (or a peninsula): members that stand on
//                                    the wall lose the flag; the rest are left as they are
// "Stands on a wall" = its BACK is within 6" of the wall it backs onto (plus the depth of any
// boxing behind it). A cabinet the user has filed by hand (`islandLock`) is never touched.
//
//   planIslandFlags(state) -> [{ id, island }]     only the ones that must change
//   withIslandFlags(state) -> state, or a shallow copy with the flags put right (for drawing
//                             a stored design without loading it)

import { getCab } from './catalogue.js';
import { boxAt } from './placement.js';

const ON_WALL = 6;
const riders = (c) => ['sink', 'hob', 'oven'].includes(c.appliance);
const floorLine = (c) => c && c.placeable && (c.type === 'FLOOR' || c.type === 'TALL' || (c.type === 'APPLIANCES' && (c.mountY || 0) === 0 && !riders(c)));
const rotOf = (it) => (((it.rotDeg || 0) % 360) + 360) % 360;
const touch = (p, q, pad = 1) => p.x0 < q.x1 + pad && p.x1 > q.x0 - pad && p.z0 < q.z1 + pad && p.z1 > q.z0 - pad;

export function planIslandFlags(state) {
  const r = (state && state.room) || {}, W = r.width || 144, D = r.depth || 120;
  const things = ((state && state.items) || []).map((it) => ({ it, cab: getCab(it.code) })).filter((t) => floorLine(t.cab)).map((t) => ({ ...t, box: boxAt(t.cab, t.it.x, t.it.z, t.it.rotDeg) }));
  // how far a boxing on `wall` pushes whatever stands in front of it, over the span lo..hi
  const boxed = (wall, lo, hi) => Math.max(0, ...(r.boxings || []).filter((bx) => (bx.wall || 'back') === wall).map((bx) => {
    const len = wall === 'left' || wall === 'right' ? D : W, w = bx.w || 8, c = -len / 2 + (bx.pos ?? 0.5) * len;
    return c - w / 2 < hi && c + w / 2 > lo ? (bx.d || 8) : 0; }));
  const onWall = (t) => { const b = t.box; switch (rotOf(t.it)) {
    case 0: return b.z0 + D / 2 < ON_WALL + boxed('back', b.x0, b.x1);
    case 180: return D / 2 - b.z1 < ON_WALL + boxed('front', b.x0, b.x1);
    case 90: return b.x0 + W / 2 < ON_WALL + boxed('left', b.z0, b.z1);
    case 270: return W / 2 - b.x1 < ON_WALL + boxed('right', b.z0, b.z1);
    default: return false; } };
  const out = [], seen = new Set();
  for (const start of things) {
    if (seen.has(start)) continue;
    const cluster = [start]; seen.add(start);
    for (let i = 0; i < cluster.length; i++) for (const t of things) if (!seen.has(t) && touch(cluster[i].box, t.box)) { seen.add(t); cluster.push(t); }
    const walled = cluster.filter(onWall);
    for (const t of cluster) {
      if (t.it.islandLock) continue;
      const want = walled.length ? (walled.includes(t) ? false : !!t.it.island) : true;
      if (want !== !!t.it.island) out.push({ id: t.it.id, island: want });
    }
  }
  return out;
}

export function withIslandFlags(state) {
  const ch = planIslandFlags(state);
  if (!ch.length) return state;
  const by = new Map(ch.map((c) => [c.id, c.island]));
  return { ...state, items: state.items.map((it) => { if (!by.has(it.id)) return it; const n = { ...it }; if (by.get(it.id)) n.island = true; else delete n.island; return n; }) };
}

/** Is the by-hand "Part of the island / Not part of the island" worth offering for this cabinet?
 *  Only where the question can arise: it is filed with an island, was filed by hand, or touches
 *  an island. A base standing in a wall run never shows it. */
export function canFileIsland(state, id) {
  const it = ((state && state.items) || []).find((i) => i.id === id), cab = it && getCab(it.code);
  if (!it || !floorLine(cab)) return false;
  if (it.island || it.islandLock) return true;
  const box = boxAt(cab, it.x, it.z, it.rotDeg);
  return state.items.some((o) => { const c = getCab(o.code); return o.id !== id && o.island && floorLine(c) && touch(box, boxAt(c, o.x, o.z, o.rotDeg)); });
}
