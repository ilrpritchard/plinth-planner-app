// cornerreturn.js — how long a corner unit's blank return is DRAWN (pure).
// Moved here from interaction/snapping.js (W2W-243) so the cost, the worktop and the 3D all agree.

import { boxingBoxes } from './openings.js';
import { getCab } from './catalogue.js';

/**
 * How long the corner cabinet's blank return panel should be DRAWN so it runs
 * from the door section all the way INTO the room corner and meets the
 * adjacent wall flush — never clipped by the wall, never stopping short.
 * The SKU's priced return stays fixed (20" floor / 10" wall); only the drawn
 * panel stretches/shrinks to the actual distance. Pure — used by the 3D layer
 * and node tests.
 */
export function cornerReturnLength(cab, item, room) {
  const ret = cab.type === 'FLOOR' ? 20 : 10;          // SKU (priced) return
  if (!cab.corner || !room || !item) return ret;
  const dir = cab.cornerSide === 'right' ? 1 : -1;     // which side the return extends
  const rad = ((item.rotDeg || 0) * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const ux = dir * c, uz = -dir * s;                   // world direction of the return
  const edgeX = item.x + ux * (cab.w / 2);             // door-section edge, return side
  const edgeZ = item.z + uz * (cab.w / 2);
  let dist = null;                                     // edge → adjacent wall
  if (ux > 0.5) dist = room.width / 2 - edgeX;
  else if (ux < -0.5) dist = edgeX + room.width / 2;
  else if (uz > 0.5) dist = room.depth / 2 - edgeZ;
  else if (uz < -0.5) dist = edgeZ + room.depth / 2;
  // a boxing in that corner takes the return first: the panel is cut to its face (none left = 0)
  const d = cab.d || 24, band = (lo, hi, a, b) => lo < b && hi > a;
  for (const bb of boxingBoxes(room)) {
    let f = null;                                        // edge -> the boxing's near face (0 when the edge is already inside it)
    if (ux > 0.5 && bb.x1 > edgeX - 0.5 && band(item.z - d / 2, item.z + d / 2, bb.z0, bb.z1)) f = Math.max(0, bb.x0 - edgeX);
    else if (ux < -0.5 && bb.x0 < edgeX + 0.5 && band(item.z - d / 2, item.z + d / 2, bb.z0, bb.z1)) f = Math.max(0, edgeX - bb.x1);
    else if (uz > 0.5 && bb.z1 > edgeZ - 0.5 && band(item.x - d / 2, item.x + d / 2, bb.x0, bb.x1)) f = Math.max(0, bb.z0 - edgeZ);
    else if (uz < -0.5 && bb.z0 < edgeZ + 0.5 && band(item.x - d / 2, item.x + d / 2, bb.x0, bb.x1)) f = Math.max(0, edgeZ - bb.z1);
    if (f != null && dist != null && f < dist) dist = f;
  }
  if (dist != null && dist <= 0.5) return 0;
  // draw to the actual wall while the unit sits at a corner (covers scribe
  // gaps up to ~6" and rooms resized under the return); free-floating or far
  // from any corner it falls back to the catalogue return.
  return (dist != null && dist > 0.5 && dist <= ret + 10) ? dist : ret;
}


/**
 * The drawn return in a kitchen: as cornerReturnLength, except where a PENINSULA leg stands in front
 * of the return (W2W-243, her ask 2026-09-29 "a run + peninsula"). The leg's cabinets start at the
 * corner's front plane and stand free of their side wall, so the return runs to the leg's BACK plane
 * (where the peninsula's continuous end panel covers it), not across the walkway to the wall.
 * Returns { len, leg } — leg true when the reach came from a peninsula leg.
 */
export function returnReach(cab, item, items, room) {
  const base = cornerReturnLength(cab, item, room);
  if (!cab?.corner || !item || !items) return { len: base, leg: false };
  const dir = cab.cornerSide === 'right' ? 1 : -1;
  const rad = ((item.rotDeg || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const ux = dir * c, uz = -dir * s;                     // world direction of the return
  const fx = s, fz = c;                                  // the corner's front normal
  const ex = item.x + ux * (cab.w / 2), ez = item.z + uz * (cab.w / 2);
  const frontOff = (item.x + fx * (cab.d / 2)) * fx + (item.z + fz * (cab.d / 2)) * fz;   // corner front plane
  let best = null;
  for (const o of items) {
    if (o === item || o.id === item.id) continue;
    const oc = getCab(o.code);
    if (!oc || !(oc.type === 'FLOOR' || oc.type === 'TALL') || oc.corner) continue;
    const r2 = ((o.rotDeg || 0) * Math.PI) / 180, bx = -Math.sin(r2), bz = -Math.cos(r2);   // its back normal
    if (bx * ux + bz * uz < 0.99) continue;              // its back must face the way the return runs
    // it stands IN FRONT of the corner: its near end on the corner's front plane (within 3")
    const near = (o.x * fx + o.z * fz) - oc.w / 2;
    if (Math.abs(near - frontOff) > 3) continue;
    // and across the return: its back plane is t along the return from the door edge
    const t = ((o.x + bx * oc.d / 2) - ex) * ux + ((o.z + bz * oc.d / 2) - ez) * uz;
    if (t < 1 || t > 40) continue;
    if (best == null || t > best) best = t;
  }
  if (best == null) return { len: base, leg: false };
  // only when the leg's back lies BEYOND where the return would stop anyway (a leg against its wall
  // leaves the wall-stretched return exactly as it was)
  return best > base + 0.5 ? { len: best, leg: true } : { len: base, leg: false };
}

/** The corner units whose return runs to a peninsula leg's back: their return END is on show. */
export function peninsulaReturnEnds(state) {
  const out = [];
  for (const it of state.items || []) {
    const cab = getCab(it.code);
    if (!cab?.corner || cab.type !== 'FLOOR') continue;
    const rr = returnReach(cab, it, state.items, state.room);
    if (rr.leg) out.push({ it, cab, len: rr.len });
  }
  return out;
}
