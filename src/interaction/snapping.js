// snapping.js — pure geometry: given a dragged position, return a snapped
// {x, z, rotDeg}. Cabinets snap back to a wall (orienting their front into the
// room) and butt edge-to-edge into a continuous run with their neighbours.

import { getCab } from '../core/catalogue.js';
import { getFootprint, getMountY } from '../models/cabinet.js';
import { mmToIn } from '../core/units.js';
import { openingCenter, openingWidth } from '../core/openings.js';

const WALL_SNAP = 16;   // perpendicular distance to a wall that triggers snap
const EDGE_SNAP = 9;    // distance between neighbouring edges that triggers butt
const LOCK_TOL = 10;    // how aligned two cabinets must be to count as same run
export const TALL_PROUD = mmToIn(30); // a tall cabinet sits 30mm in front of an adjacent floor unit

export function snapPosition(store, id, rawX, rawZ, bounds, opts = {}) {
  const item = store.getItem(id);
  const cab = getCab(item.code);
  const fp = getFootprint(cab);
  const w = fp.w, d = fp.d;
  const others = store.state.items.filter((o) => o.id !== id);

  let x = rawX, z = rawZ, rotDeg = item.rotDeg || 0;

  // ---- 1. wall snap ----
  // sit a hair off the wall so the cabinet back doesn't z-fight the wall surface.
  // A TALL cabinet sits TALL_PROUD (30mm) further off the wall so its front sits
  // proud of the adjacent floor units (the worktop runs neatly into its side).
  const WALL_GAP = 0.25;
  const proudWall = cab.type === 'TALL' ? TALL_PROUD : 0;
  const touch = d / 2 + WALL_GAP + proudWall;
  // ALL FOUR walls snap, and the cabinet auto-orients to face into the room —
  // dragging a side-facing dresser to the back wall just works. A wall matching
  // the CURRENT orientation still wins unless another wall is clearly closer,
  // so sliding along a run never flips the cabinet at a corner.
  // a WALL cabinet HANGS — it can never float mid-room, so it always attaches
  // to the nearest wall (no snap threshold): dragging it around the room just
  // hops it wall to wall, which is what "put it on THAT wall" needs.
  const cands = [
    { wall: 'back', rot: 0, err: Math.abs(rawZ - (bounds.minZ + touch)) },
    { wall: 'left', rot: 90, err: Math.abs(rawX - (bounds.minX + touch)) },
    { wall: 'front', rot: 180, err: Math.abs(rawZ - (bounds.maxZ - touch)) },
    { wall: 'right', rot: 270, err: Math.abs(rawX - (bounds.maxX - touch)) },
  ].filter((c) => cab.type === 'WALL' || c.err < WALL_SNAP).sort((a, b) => a.err - b.err);
  let wall = null;
  if (cands.length) {
    const match = cands.find((c) => (c.rot % 180) === ((item.rotDeg || 0) % 180));
    const pick = (match && match.err <= cands[0].err + 6) ? match : cands[0];
    wall = pick.wall; rotDeg = pick.rot;
    if (wall === 'back') z = bounds.minZ + touch;
    else if (wall === 'front') z = bounds.maxZ - touch;
    else if (wall === 'left') x = bounds.minX + touch;
    else x = bounds.maxX - touch;
  }

  // free axis: 'x' when facing into room off back wall (rot 0/180), else 'z'
  const horizontal = (rotDeg % 180) === 0;
  const freeAxis = horizontal ? 'x' : 'z';
  const halfRun = w / 2; // width spans the free axis in both orientations

  // ---- 2. edge-to-edge butt to neighbours in the same run ----
  const lockVal = freeAxis === 'x' ? z : x;
  let rawFree = freeAxis === 'x' ? rawX : rawZ;

  let best = null, bestErr = EDGE_SNAP, bestN = null;
  for (const o of others) {
    const oc = getCab(o.code);
    if (!oc) continue;
    // hung cabinets butt hung cabinets, floor butts floor — EXCEPT a hung WALL
    // cabinet and a TALL cabinet, which meet side-to-side in the same run (a
    // wall cabinet dragged near a tall snaps to touch its side, no dead sliver)
    const kindsDiffer = (oc.type === 'WALL') !== (cab.type === 'WALL');
    const wallMeetsTall = (cab.type === 'WALL' && oc.type === 'TALL') || (cab.type === 'TALL' && oc.type === 'WALL');
    if (kindsDiffer && !wallMeetsTall) continue;
    if (((o.rotDeg || 0) % 180) !== (rotDeg % 180)) continue;      // same orientation
    const oLock = freeAxis === 'x' ? o.z : o.x;
    if (Math.abs(oLock - lockVal) > LOCK_TOL) continue;            // same run line
    const oFree = freeAxis === 'x' ? o.x : o.z;
    const oHalf = getFootprint(oc).w / 2;
    for (const cand of [oFree + oHalf + halfRun, oFree - oHalf - halfRun]) {
      const err = Math.abs(rawFree - cand);
      if (err < bestErr) { bestErr = err; best = cand; bestN = { o, oc }; }
    }
  }
  if (best != null) rawFree = best;

  if (freeAxis === 'x') x = rawFree; else z = rawFree;

  // ---- 2b. align FRONT faces with the neighbour we butted into ----
  // Adjacent cabinets must be flush front-to-back — never sitting slightly
  // forward. Exception: a tall cabinet sits TALL_PROUD (30mm) in front of an
  // adjacent floor unit so the worktop can run neatly into its side.
  // WALL and COUNTER cabinets are exempt: they are wall-backed by rule, and
  // front-aligning a 14"-deep dresser with a 24"-deep tall used to FLOAT it
  // ~9" off the wall — their back stays against the wall instead.
  if (bestN && !['WALL', 'COUNTER'].includes(cab.type)) {
    const rad = (rotDeg * Math.PI) / 180;
    const sgn = horizontal
      ? (Math.cos(rad) >= 0 ? 1 : -1)   // front +z for rot 0, -z for rot 180
      : (Math.sin(rad) >= 0 ? 1 : -1);  // front +x for rot 90, -x for rot 270
    const oDepth = getFootprint(bestN.oc).d;
    const oLock = freeAxis === 'x' ? bestN.o.z : bestN.o.x;
    const thisTall = cab.type === 'TALL';
    const nbrTall = bestN.oc.type === 'TALL';
    let proud = 0;                                   // how far THIS front sits ahead of neighbour front
    if (thisTall && !nbrTall) proud = TALL_PROUD;    // tall proud of floor
    else if (!thisTall && nbrTall) proud = -TALL_PROUD;
    const aligned = oLock + sgn * ((oDepth - d) / 2 + proud);
    if (freeAxis === 'x') z = aligned; else x = aligned;
  }

  // ---- 2c. back-to-back snap for islands ----
  // A free-standing cabinet dragged so its back nears another cabinet's back
  // (facing the opposite way) snaps flush, so a double-sided island reads as one
  // solid block. Only when not against a wall and not already butted in a run.
  if (!wall && best == null) {
    const BACK_SNAP = 9;
    const rad = (rotDeg * Math.PI) / 180;
    const sgn = horizontal ? (Math.cos(rad) >= 0 ? 1 : -1) : (Math.sin(rad) >= 0 ? 1 : -1);
    const myPerp = horizontal ? z : x;            // perpendicular centre
    const myBack = myPerp - sgn * (d / 2);        // my back plane
    const along = horizontal ? x : z;
    let bestBack = null, bestErr = BACK_SNAP;
    for (const o of others) {
      const oc = getCab(o.code); if (!oc) continue;
      if (((o.rotDeg || 0) % 180) !== (rotDeg % 180)) continue;   // same axis
      const oRad = (o.rotDeg || 0) * Math.PI / 180;
      const oSgn = horizontal ? (Math.cos(oRad) >= 0 ? 1 : -1) : (Math.sin(oRad) >= 0 ? 1 : -1);
      if (oSgn === sgn) continue;                                 // must face opposite
      const oFp = getFootprint(oc);
      const oPerp = horizontal ? o.z : o.x;
      const oBack = oPerp - oSgn * (oFp.d / 2);
      const oAlong = horizontal ? o.x : o.z;
      if (Math.abs(oAlong - along) > (w + oFp.w) / 2) continue;   // must sit behind each other
      const err = Math.abs(myBack - oBack);
      if (err < bestErr) { bestErr = err; bestBack = oBack; }
    }
    if (bestBack != null) {
      const newPerp = bestBack + sgn * (d / 2);                   // my back == neighbour back
      if (horizontal) z = newPerp; else x = newPerp;
    }
  }

  // ---- 2d. feature snap: align appliances to a window centre / wall centre ----
  // A sink or hob magnetically centres under a window on the same wall; any
  // appliance (range, sink, hob) also snaps to the centre of the wall. Snaps
  // only when dragged close, so it's a help not a constraint.
  if (wall && cab.appliance && !opts.noFeature) {
    const FEATURE_SNAP = 12;            // how close before it grabs (inches)
    const along = horizontal ? x : z;
    const room = store.state.room;
    const cands = [{ at: 0, kind: 'wall centre' }]; // wall midpoint (centred room → 0) — all appliances
    // only a sink or hob centres under a window
    if (cab.appliance === 'sink' || cab.appliance === 'hob') {
      for (const o of (room.openings || [])) {
        if (o.type !== 'window') continue;
        if ((o.wall || 'back') !== wall) continue;   // same wall only
        cands.push({ at: openingCenter(room, o), kind: 'window' });
      }
    }
    // pick the nearest feature within the threshold.
    let best = null, err = FEATURE_SNAP;
    for (const c of cands) { const e = Math.abs(along - c.at); if (e < err) { err = e; best = c.at; } }
    // …but NEVER centre it into an overlap with a neighbouring cabinet in the
    // same run (that's what pulled the range on top of a drawer). Only apply the
    // feature snap if the target position stays clear of every run neighbour.
    if (best != null) {
      let clear = true;
      for (const o of others) {
        const oc = getCab(o.code); if (!oc) continue;
        if (((o.rotDeg || 0) % 180) !== (rotDeg % 180)) continue;
        const oLock = freeAxis === 'x' ? o.z : o.x;
        if (Math.abs(oLock - lockVal) > LOCK_TOL) continue;
        const oFree = freeAxis === 'x' ? o.x : o.z;
        if (Math.abs(best - oFree) < halfRun + getFootprint(oc).w / 2 - 0.5) { clear = false; break; }
      }
      if (clear) { if (horizontal) x = best; else z = best; }
    }
  }

  // ---- 3. keep the WHOLE cabinet inside the room — never through a wall ----
  // Build the cabinet's local extents (including a corner return panel, which
  // sticks out one side), rotate them, and clamp the centre so the resulting
  // world box stays within the room walls.
  const ret = cab.corner ? (cab.type === 'FLOOR' ? 20 : 10) : 0;
  const leftRet = (cab.corner && cab.cornerSide !== 'right') ? ret : 0;  // return panel extends one side
  const rightRet = (cab.corner && cab.cornerSide === 'right') ? ret : 0;
  const lxMin = -(w / 2 + leftRet), lxMax = (w / 2 + rightRet);
  const lzMin = -d / 2, lzMax = d / 2;
  const rad3 = (rotDeg * Math.PI) / 180, c3 = Math.cos(rad3), s3 = Math.sin(rad3);
  let oxMin = Infinity, oxMax = -Infinity, ozMin = Infinity, ozMax = -Infinity;
  for (const [lx, lz] of [[lxMin, lzMin], [lxMax, lzMin], [lxMax, lzMax], [lxMin, lzMax]]) {
    const wx = lx * c3 + lz * s3, wz = -lx * s3 + lz * c3; // rotation about Y (matches rotation.y)
    oxMin = Math.min(oxMin, wx); oxMax = Math.max(oxMax, wx);
    ozMin = Math.min(ozMin, wz); ozMax = Math.max(ozMax, wz);
  }
  x = clamp(x, bounds.minX - oxMin, bounds.maxX - oxMax);
  z = clamp(z, bounds.minZ - ozMin, bounds.maxZ - ozMax);

  // ---- 4. HARD no-overlap rule -------------------------------------------
  // A cabinet can never be left intersecting another solid body (same height
  // band). If the snapped spot collides, butt it against the blocker along the
  // run axis instead; if there's no clear spot, it stays where it was.
  let windowFlag = false;
  {
    const TOL = 0.75;                                    // touching ≠ overlapping
    // WINDOWS are solid to anything mounted in their band — a cabinet NEVER
    // covers a window. (Base units pass underneath the sill; talls, uppers,
    // dressers, shelves and the hood are all blocked.)
    const room = store.state.room || {};
    const winBoxes = [];
    for (const o of (room.openings || [])) {
      if (o.type !== 'window') continue;
      const wallName = o.wall || 'back';
      const c = openingCenter(room, o), half = openingWidth(o, room) / 2;
      const sill = o.sill ?? Math.max(36, (room.height || 96) * 0.42);
      const hgt = o.hgt ?? Math.min(46, (room.height || 96) * 0.45);
      const D = 5;                                      // how far the glass "projects" for the check
      const yb = { y0: sill, y1: sill + hgt, win: true };
      if (wallName === 'back') winBoxes.push({ x0: c - half, x1: c + half, z0: bounds.minZ - 1, z1: bounds.minZ + D, ...yb });
      else if (wallName === 'front') winBoxes.push({ x0: c - half, x1: c + half, z0: bounds.maxZ - D, z1: bounds.maxZ + 1, ...yb });
      else if (wallName === 'left') winBoxes.push({ x0: bounds.minX - 1, x1: bounds.minX + D, z0: c - half, z1: c + half, ...yb });
      else winBoxes.push({ x0: bounds.maxX - D, x1: bounds.maxX + 1, z0: c - half, z1: c + half, ...yb });
    }
    const inRoom = (px, pz) => [clamp(px, bounds.minX - oxMin, bounds.maxX - oxMax), clamp(pz, bounds.minZ - ozMin, bounds.maxZ - ozMax)];
    // worktop-mounted appliances (sink, hob) belong IN FRONT of a window —
    // the classic sink-under-the-window — so the glass isn't solid to them
    const winSolid = cab.appliance !== 'sink' && cab.appliance !== 'hob';
    const hitAt = (px, pz) => {
      const me = worldBox({ x: px, z: pz, rotDeg }, cab);
      const test = (ob) =>
        Math.min(me.x1, ob.x1) - Math.max(me.x0, ob.x0) > TOL &&
        Math.min(me.z1, ob.z1) - Math.max(me.z0, ob.z0) > TOL &&
        Math.min(me.y1, ob.y1) - Math.max(me.y0, ob.y0) > 1;
      if (winSolid) for (const wb of winBoxes) if (test(wb)) return wb;
      for (const o of others) {
        const oc = getCab(o.code);
        if (!oc || !oc.placeable) continue;
        const ob = worldBox(o, oc);
        if (test(ob)) return ob;
      }
      return null;
    };
    let hit = hitAt(x, z);
    for (let i = 0; i < 4 && hit; i++) {
      if (hit.win) windowFlag = true;
      const me = worldBox({ x, z, rotDeg }, cab);
      if (freeAxis === 'x') {
        const dxL = hit.x0 - me.x1, dxR = hit.x1 - me.x0;    // butt to the blocker's near side
        x += Math.abs(dxL) <= Math.abs(dxR) ? dxL : dxR;
      } else {
        const dzL = hit.z0 - me.z1, dzR = hit.z1 - me.z0;
        z += Math.abs(dzL) <= Math.abs(dzR) ? dzL : dzR;
      }
      [x, z] = inRoom(x, z);
      hit = hitAt(x, z);
    }
    if (hit) {                                            // no clear spot → stay put
      if (hit.win) windowFlag = true;
      x = item.x; z = item.z; rotDeg = item.rotDeg || 0;
    }
  }

  let flag = windowFlag ? 'window' : undefined;

  // RULE: the sink/hob lives IN the worktop — it never butts against a tall,
  // wall or counter cabinet body (plan-view check with a small clearance).
  if (cab.appliance === 'sink' || cab.appliance === 'hob') {
    const me = worldBox({ x, z, rotDeg }, cab);
    const G = 0.6;
    const touching = others.some((o) => {
      const oc = getCab(o.code);
      if (!oc || !['TALL', 'WALL', 'COUNTER'].includes(oc.type)) return false;
      const ob = worldBox(o, oc);
      return Math.min(me.x1 + G, ob.x1) - Math.max(me.x0 - G, ob.x0) > 0 &&
             Math.min(me.z1 + G, ob.z1) - Math.max(me.z0 - G, ob.z0) > 0;
    });
    if (touching) { x = item.x; z = item.z; rotDeg = item.rotDeg || 0; flag = 'sink'; }
  }

  // RULE: wall, counter and tall cabinets ONLY sit against a wall — if the
  // snapped spot isn't wall-backed, the cabinet stays where it was. (Base
  // cabinets stay free so islands work.)
  if (['WALL', 'COUNTER', 'TALL'].includes(cab.type) && !wall) {
    x = item.x; z = item.z; rotDeg = item.rotDeg || 0; flag = 'offwall';
  }

  // RULE: corner cabinets live AT A ROOM CORNER — a corner unit only makes
  // sense where two runs meet at a right angle, so its back must sit against
  // one wall AND its blank return must run toward the adjoining perpendicular
  // wall: the return-side tip has to land within ~4" of that wall (6" allowed
  // so a generated run's scribe-filler gap — up to ~5" — still counts as the
  // corner). Dropped anywhere else (mid-run, a plain wall end, the open
  // floor) it stays put.
  if (cab.corner) {
    const CORNER_TOL = 6;
    const rad = (rotDeg * Math.PI) / 180, cc = Math.cos(rad), ss = Math.sin(rad);
    const horiz = (rotDeg % 180) === 0;
    const dir = cab.cornerSide === 'right' ? 1 : -1;              // which side the return extends
    const reach = w / 2 + getFootprint(cab).returnLeg;            // centre → return tip
    const tipX = x + dir * cc * reach;                            // local +x axis → world (cc, -ss)
    const tipZ = z - dir * ss * reach;
    // back against its own wall (rot 0=back, 90=left, 180=front, 270=right)…
    const backOk = horiz
      ? Math.abs(z - (cc >= 0 ? bounds.minZ + touch : bounds.maxZ - touch)) <= CORNER_TOL
      : Math.abs(x - (ss >= 0 ? bounds.minX + touch : bounds.maxX - touch)) <= CORNER_TOL;
    // …with the return tip meeting a perpendicular wall. The tip tolerance
    // matches the DRAWN return's stretch limit (SKU + 10", cornerReturnLength):
    // leg-to-leg corners sit 24.25" out (tip 4.25" short) and a U-shape's
    // second corner can carry a scribe strip on top of that.
    const TIP_TOL = 10;
    const tipOk = horiz
      ? Math.min(Math.abs(tipX - bounds.minX), Math.abs(tipX - bounds.maxX)) <= TIP_TOL
      : Math.min(Math.abs(tipZ - bounds.minZ), Math.abs(tipZ - bounds.maxZ)) <= TIP_TOL;
    if (!backOk || !tipOk) { x = item.x; z = item.z; rotDeg = item.rotDeg || 0; flag = 'corner'; }
  }

  return { x, z, rotDeg, flag };
}

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
  // draw to the actual wall while the unit sits at a corner (covers scribe
  // gaps up to ~6" and rooms resized under the return); free-floating or far
  // from any corner it falls back to the catalogue return.
  return (dist != null && dist > 1 && dist <= ret + 10) ? dist : ret;
}

/** World AABB of an item incl. corner return + mount height band. */
function worldBox(it, cab) {
  const fp = getFootprint(cab);
  const ret = cab.corner ? (cab.type === 'FLOOR' ? 20 : 10) : 0;
  const lRet = (cab.corner && cab.cornerSide !== 'right') ? ret : 0;
  const rRet = (cab.corner && cab.cornerSide === 'right') ? ret : 0;
  const rad = ((it.rotDeg || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [lx, lz] of [[-(fp.w / 2 + lRet), -fp.d / 2], [fp.w / 2 + rRet, -fp.d / 2], [fp.w / 2 + rRet, fp.d / 2], [-(fp.w / 2 + lRet), fp.d / 2]]) {
    const wx = lx * c + lz * s, wz = -lx * s + lz * c;
    x0 = Math.min(x0, it.x + wx); x1 = Math.max(x1, it.x + wx);
    z0 = Math.min(z0, it.z + wz); z1 = Math.max(z1, it.z + wz);
  }
  const y0 = getMountY(cab);
  return { x0, x1, z0, z1, y0, y1: y0 + (cab.h || 1) };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
