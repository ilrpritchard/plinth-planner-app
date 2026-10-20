// cornerreturn.js — how long a corner unit's blank return is DRAWN (pure).
// Moved here from interaction/snapping.js (W2W-243) so the cost, the worktop and the 3D all agree.

import { boxingBoxes } from './openings.js';
import { getCab } from './catalogue.js';

const WALL_GAP = 0.25;

/**
 * How long the corner cabinet's blank return panel is DRAWN. ONE depth only (her call
 * 2026-10-14: "the corner blank part is one depth only", never adjustable): the cabinet's own
 * depth plus the wall scribe, 24.25" floor / 14.25" wall, so a corner standing leg-to-leg with
 * the perpendicular run (its body where that run's boxes end) has its return meet the wall
 * exactly. It no longer stretches or shrinks with where the unit stands: dragged off its seat
 * the return stops short or pokes into the wall and the warning says so. The SKU's priced
 * return stays what the catalogue says (20" floor / 10" wall). A bulkhead that takes the
 * whole corner leaves no return (0). Pure — used by the 3D layer, the worktop and node tests.
 */
export function cornerReturnLength(cab, item, room) {
  if (!cab.corner) return 0;
  const ret = cab.returnIn != null ? cab.returnIn : (cab.d || (cab.type === 'FLOOR' ? 24 : 14)) + WALL_GAP;   // a bespoke return is its own length
  if (!room || !item) return ret;
  const dir = cab.cornerSide === 'right' ? 1 : -1;     // which side the return extends
  const rad = ((item.rotDeg || 0) * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const ux = dir * c, uz = -dir * s;                   // world direction of the return
  const edgeX = item.x + ux * (cab.w / 2);             // door-section edge, return side
  const edgeZ = item.z + uz * (cab.w / 2);
  // a boxing in that corner takes the return first: the panel is cut to its face (none left = 0)
  const d = cab.d || 24, band = (lo, hi, a, b) => lo < b && hi > a;
  let dist = null;
  for (const bb of boxingBoxes(room)) {
    let f = null;                                        // edge -> the boxing's near face (0 when the edge is already inside it)
    if (ux > 0.5 && bb.x1 > edgeX - 0.5 && band(item.z - d / 2, item.z + d / 2, bb.z0, bb.z1)) f = Math.max(0, bb.x0 - edgeX);
    else if (ux < -0.5 && bb.x0 < edgeX + 0.5 && band(item.z - d / 2, item.z + d / 2, bb.z0, bb.z1)) f = Math.max(0, edgeX - bb.x1);
    else if (uz > 0.5 && bb.z1 > edgeZ - 0.5 && band(item.x - d / 2, item.x + d / 2, bb.x0, bb.x1)) f = Math.max(0, bb.z0 - edgeZ);
    else if (uz < -0.5 && bb.z0 < edgeZ + 0.5 && band(item.x - d / 2, item.x + d / 2, bb.x0, bb.x1)) f = Math.max(0, edgeZ - bb.z1);
    if (f != null && (dist == null || f < dist)) dist = f;
  }
  if (dist != null && dist <= 0.5) return 0;
  return dist != null && dist < ret ? dist : ret;      // cut to the bulkhead's face, never longer than the one depth
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
  // the return is ONE depth (cornerReturnLength): it is not stretched to the leg's back. Its end is
  // on show only when it stands in the open: a leg's back further off than the return, or the end
  // meeting a room wall (an ordinary L, the leg against its own wall), leaves no finished end to make
  const endX = ex + ux * base, endZ = ez + uz * base, R = room || {};
  const toWall = ux > 0.5 ? (R.width || 144) / 2 - endX : ux < -0.5 ? endX + (R.width || 144) / 2 : uz > 0.5 ? (R.depth || 120) / 2 - endZ : endZ + (R.depth || 120) / 2;
  return best > base + 0.5 || toWall <= 1 ? { len: base, leg: false } : { len: base, leg: true };
}

/** The corner units whose return runs to a peninsula leg's back: their return END is on show. */
export function peninsulaReturnEnds(state) {
  const out = [];
  for (const it of state.items || []) {
    const cab = getCab(it.code);
    if (!cab?.corner || cab.type !== 'FLOOR') continue;
    const rr = returnReach(cab, it, state.items, state.room);
    if (!rr.leg) continue;
    // something standing against the return's end (a stool niche run the whole length of the peninsula,
    // her ask 2026-09-29) covers it: no finished end there, and none priced
    const dir = cab.cornerSide === 'right' ? 1 : -1, r = ((it.rotDeg || 0) * Math.PI) / 180;
    const ux = dir * Math.cos(r), uz = -dir * Math.sin(r), reach = cab.w / 2 + rr.len + 1.5;
    const px = it.x + ux * reach, pz = it.z + uz * reach;
    const covered = (state.items || []).some((o) => {
      if (o === it) return false;
      const oc = getCab(o.code);
      if (!oc || !(oc.type === 'FLOOR' || oc.type === 'TALL')) return false;
      const ra = ((o.rotDeg || 0) * Math.PI) / 180, c = Math.cos(ra), sn = Math.sin(ra), dx = px - o.x, dz = pz - o.z;
      return Math.abs(dx * c - dz * sn) <= oc.w / 2 && Math.abs(dx * sn + dz * c) <= oc.d / 2;
    });
    if (!covered) out.push({ it, cab, len: rr.len });
  }
  return out;
}
