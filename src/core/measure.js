// measure.js — live dimensions for the item being dragged: its width plus the
// clear gap from each end to the nearest neighbour (or wall) along the run.
// Pure maths so it's unit-testable; the drag overlay renders the result.

import { getCab } from './catalogue.js';
import { getMountY } from '../models/cabinet.js';

const aabb = (it, c) => {
  const horiz = ((it.rotDeg || 0) % 180) === 0;
  const w = horiz ? c.w : c.d, d = horiz ? c.d : c.w;
  const y0 = getMountY(c);
  return { x0: it.x - w / 2, x1: it.x + w / 2, z0: it.z - d / 2, z1: it.z + d / 2, y0, y1: y0 + c.h };
};
const overlap1D = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * Measure along the dragged item's own axis (X when facing front/back, Z when
 * side-facing): distance from each end to the nearest neighbour that shares
 * its lane (overlaps in the cross axis AND in height), else to the wall.
 * @returns {{ w:number, before:{gap:number,to:string}, after:{gap:number,to:string} }|null}
 */
export function measureRun(store, id, bounds) {
  const it = store.getItem(id);
  const cab = it && getCab(it.code);
  if (!cab) return null;
  const me = aabb(it, cab);
  const horiz = ((it.rotDeg || 0) % 180) === 0;
  const [lo, hi, wallLo, wallHi] = horiz
    ? [me.x0, me.x1, bounds.minX, bounds.maxX]
    : [me.z0, me.z1, bounds.minZ, bounds.maxZ];

  let before = { gap: lo - wallLo, to: 'wall' };
  let after = { gap: wallHi - hi, to: 'wall' };
  for (const o of store.state.items) {
    if (o.id === id) continue;
    const oc = getCab(o.code); if (!oc || !oc.placeable) continue;
    const ob = aabb(o, oc);
    // same lane: overlapping across the run AND in height band
    const cross = horiz ? overlap1D(me.z0, me.z1, ob.z0, ob.z1) : overlap1D(me.x0, me.x1, ob.x0, ob.x1);
    if (cross <= 1 || overlap1D(me.y0, me.y1, ob.y0, ob.y1) <= 1) continue;
    const [olo, ohi] = horiz ? [ob.x0, ob.x1] : [ob.z0, ob.z1];
    if (ohi <= lo + 0.05 && lo - ohi < before.gap) before = { gap: lo - ohi, to: o.code };
    if (olo >= hi - 0.05 && olo - hi < after.gap) after = { gap: olo - hi, to: o.code };
  }
  before.gap = Math.max(0, before.gap);
  after.gap = Math.max(0, after.gap);
  return { w: cab.w, before, after };
}
