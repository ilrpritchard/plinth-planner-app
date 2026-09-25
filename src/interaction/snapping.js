// snapping.js — pure geometry: given a dragged position, return a snapped
// {x, z, rotDeg}. Cabinets snap back to a wall (orienting their front into the
// room) and butt edge-to-edge into a continuous run with their neighbours.

import { findHoodSeat } from '../core/hoodseat.js';
import { getCab } from '../core/catalogue.js';
import { getFootprint, getMountY } from '../models/cabinet.js';
import { mmToIn, COOK_SIDE_IN } from '../core/units.js';
import { openingCenter, openingWidth, boxingBoxes } from '../core/openings.js';
import { isOven, findOvenHost } from '../core/ovenseat.js';
import { baseUnder, overDishwasher } from '../core/sinkspec.js';

const WALL_SNAP = 16;   // perpendicular distance to a wall that triggers snap
const EDGE_SNAP = 9;    // distance between neighbouring edges that triggers butt
const LOCK_TOL = 10;    // how aligned two cabinets must be to count as same run
export const TALL_PROUD = mmToIn(30); // a tall cabinet sits 30mm in front of an adjacent floor unit

export function snapPosition(store, id, rawX, rawZ, bounds, opts = {}) {
  const item = store.getItem(id);
  const cab = getCab(item.code);
  const fp = getFootprint(cab);
  const w = fp.w, d = fp.d;
  // a wall oven is a RIDER: it only ever lands inside an empty oven housing of
  // its size (nearest to the pointer), and takes that housing's exact spot
  if (isOven(cab)) {
    const host = findOvenHost(store.state, cab, rawX, rawZ, id);
    if (!host) return { x: item.x, z: item.z, rotDeg: item.rotDeg || 0, flag: 'oven' };
    return { x: host.x, z: host.z, rotDeg: host.rotDeg || 0, hostId: host.id };
  }
  let shelfDepth = null;                       // an open shelf's new depth (see section 1)
  // a range hood RIDES the cooker: centred over the range or cooktop nearest the pointer; so does
  // the hood COVER (W26), which sits over the hood at its own fixed height (top on the crown line)
  if (cab.appliance === 'hood' || cab.hoodCover) {
    const seat = findHoodSeat(store.state, rawX, rawZ, id, cab);
    if (!seat) return { x: item.x, z: item.z, rotDeg: item.rotDeg || 0, flag: 'hood' };
    return { x: seat.x, z: seat.z, rotDeg: seat.rotDeg };
  }
  // ...and because it sits wholly inside its housing it never blocks anything else
  const others = store.state.items.filter((o) => o.id !== id && !isOven(getCab(o.code)));

  let x = rawX, z = rawZ, rotDeg = item.rotDeg || 0;

  // ---- 1. wall snap ----
  // sit a hair off the wall so the cabinet back doesn't z-fight the wall surface.
  // A TALL cabinet sits TALL_PROUD (30mm) further off the wall so its front sits
  // proud of the adjacent floor units (the worktop runs neatly into its side).
  const WALL_GAP = 0.25;
  const proudWall = cab.type === 'TALL' || cab.onTall ? TALL_PROUD : 0;      // a tall's stacker stands proud with it
  const touch = d / 2 + WALL_GAP + proudWall;
  // ALL FOUR walls snap, and the cabinet auto-orients to face into the room —
  // dragging a side-facing dresser to the back wall just works. A wall matching
  // the CURRENT orientation still wins unless another wall is clearly closer,
  // so sliding along a run never flips the cabinet at a corner.
  // a WALL cabinet HANGS, and a COUNTER or TALL cabinet only ever stands against a wall
  // (rule below): none of them can float mid-room, so they always attach to the nearest
  // wall (no snap threshold). Dragging one around the room just hops it wall to wall,
  // which is what "put it on THAT wall" needs. A counter cabinet used to FREEZE the moment
  // the pointer strayed 16" from its wall and jump back when it returned: glitchy.
  const cands = [
    { wall: 'back', rot: 0, err: Math.abs(rawZ - (bounds.minZ + touch)) },
    { wall: 'left', rot: 90, err: Math.abs(rawX - (bounds.minX + touch)) },
    { wall: 'front', rot: 180, err: Math.abs(rawZ - (bounds.maxZ - touch)) },
    { wall: 'right', rot: 270, err: Math.abs(rawX - (bounds.maxX - touch)) },
  ].filter((c) => ['WALL', 'COUNTER', 'TALL'].includes(cab.type) || c.err < WALL_SNAP).sort((a, b) => a.err - b.err);
  let wall = null;
  if (cands.length) {
    const match = cands.find((c) => (c.rot % 180) === ((item.rotDeg || 0) % 180));
    const pick = (match && match.err <= cands[0].err + 6) ? match : cands[0];
    wall = pick.wall; rotDeg = pick.rot;
    // a WALL / COUNTER cabinet beside a TALL in the same run has TWO snap points: its back on the
    // wall, or its FRONT flush with the tall's front (her ask 2026-09-22: "you should be able to
    // pull it forward to sit flush with the tall cabinet, as an option"). Whichever the pointer
    // is nearer. Only with a tall butted beside it (within 2"), never mid-air.
    let out = 0;
    if (cab.type === 'WALL' || cab.type === 'COUNTER') {
      const along = pick.rot % 180 === 0 ? rawX : rawZ, rawPerp = pick.rot === 0 ? rawZ - bounds.minZ : pick.rot === 180 ? bounds.maxZ - rawZ : pick.rot === 90 ? rawX - bounds.minX : bounds.maxX - rawX;
      let flush = null;
      for (const o of others) {
        const oc = getCab(o.code); if (!oc || oc.type !== 'TALL' || (((o.rotDeg || 0) % 360) + 360) % 360 !== pick.rot) continue;
        const oAlong = pick.rot % 180 === 0 ? o.x : o.z;
        if (Math.abs(oAlong - along) > (w + oc.w) / 2 + 2) continue;                      // must stand beside it
        const oPerp = pick.rot === 0 ? o.z - bounds.minZ : pick.rot === 180 ? bounds.maxZ - o.z : pick.rot === 90 ? o.x - bounds.minX : bounds.maxX - o.x;
        flush = oPerp + oc.d / 2 - d / 2;                                                  // my front on the tall's front
      }
      // ...and a THIRD point for a WALL cabinet (her ask 2026-09-22, "pull the open shelves forward to
      // cover the oak part"): its front on the BODY edge of a corner wall unit on the adjoining wall
      // whose blank return runs toward this wall, so the shelf hides that return
      let cover = null;
      if (cab.type === 'WALL' && flush != null) {
        const perpOf = (px, pz) => pick.rot === 0 ? pz - bounds.minZ : pick.rot === 180 ? bounds.maxZ - pz : pick.rot === 90 ? px - bounds.minX : bounds.maxX - px;
        const me = worldBox({ ...item, x: rawX, z: rawZ, rotDeg: pick.rot }, cab);
        for (const o of others) {
          const oc = getCab(o.code); if (!oc || !oc.corner || oc.type !== 'WALL') continue;
          if ((((o.rotDeg || 0) - pick.rot) % 180 + 180) % 180 !== 90) continue;
          const ob = worldBox(o, oc), horizO = ((o.rotDeg || 0) % 180) === 0;
          const bodyLo = horizO ? o.x - oc.w / 2 : o.z - oc.w / 2, bodyHi = horizO ? o.x + oc.w / 2 : o.z + oc.w / 2;
          const boxLo = horizO ? ob.x0 : ob.z0, boxHi = horizO ? ob.x1 : ob.z1;
          // the return must extend toward MY wall: the body edge nearer my wall is the one to land on
          const pLo = horizO ? perpOf(bodyLo, o.z) : perpOf(o.x, bodyLo), pHi = horizO ? perpOf(bodyHi, o.z) : perpOf(o.x, bodyHi);
          const nearer = pLo < pHi ? { p: pLo, ret: (horizO ? bodyLo - boxLo : bodyLo - boxLo) } : { p: pHi, ret: (horizO ? boxHi - bodyHi : boxHi - bodyHi) };
          if (nearer.ret < 1) continue;                                                     // its return faces away
          // and it must sit at my end: its box next to mine along my run, not somewhere else on the wall
          const gapAlong = pick.rot % 180 === 0 ? Math.max(ob.x0 - me.x1, me.x0 - ob.x1) : Math.max(ob.z0 - me.z1, me.z0 - ob.z1);
          if (gapAlong > 4) continue;
          cover = nearer.p - d / 2;
        }
      }
      const opts = [{ out: 0, err: Math.abs(rawPerp - touch) }, ...(flush != null ? [{ out: flush - touch, err: Math.abs(rawPerp - flush) }] : []), ...(cover != null ? [{ out: cover - touch, err: Math.abs(rawPerp - cover) }] : [])];
      out = opts.sort((a, b) => a.err - b.err)[0].out;
      // an OPEN SHELF pulled forward does not leave the wall: it gets DEEPER (her ask 2026-09-23, "any depth
      // i need"). Its front follows the pointer to the inch, snapping within 3" onto a tall's front or a
      // corner wall unit's body edge; the depth comes back as `depth` for the controller to apply.
      // ...but never while a tapped-in shelf is being CARRIED to its place (opts.noDeepen): the pointer is
      // wherever the hand is, and a 14" shelf arrived 24" deep beside a hood (her screenshot 2026-09-25,
      // "wall full height open shelves, wrong depth"). Only a deliberate drag deepens.
      if (cab.form === 'open' && cab.type === 'WALL' && !opts.noDeepen) {
        const frontFree = rawPerp + d / 2;
        const fronts = [...(flush != null ? [flush + d / 2] : []), ...(cover != null ? [cover + d / 2] : [])];
        const snapF = fronts.find((f) => Math.abs(f - frontFree) < 3);
        const front = snapF != null ? snapF : Math.round(frontFree);
        shelfDepth = Math.max(8, Math.min(36, Math.round(front - WALL_GAP)));
        out = 0;
      }
    }
    if (wall === 'back') z = bounds.minZ + touch + out;
    else if (wall === 'front') z = bounds.maxZ - touch - out;
    else if (wall === 'left') x = bounds.minX + touch + out;
    else x = bounds.maxX - touch - out;
  }

  // ---- 1b. a CORNER unit may be pulled off its wall to BUTT the adjoining
  // run: when the drag has clearly left the wall and a base cabinet on the
  // perpendicular run sits just beyond its front face, snap to touch that
  // cabinet instead of back to the wall (her call 2026-09-16: a generated
  // return that stopped short can be closed by hand).
  let returnBlockedBy = null;
  if (cab.corner && cab.type !== 'WALL') {
    const r0 = item.rotDeg || 0;
    const horiz0 = (r0 % 180) === 0;
    const rad0 = (r0 * Math.PI) / 180;
    const sgn0 = horiz0 ? (Math.cos(rad0) >= 0 ? 1 : -1) : (Math.sin(rad0) >= 0 ? 1 : -1);   // into the room
    const wallPos = horiz0 ? (sgn0 > 0 ? bounds.minZ + touch : bounds.maxZ - touch) : (sgn0 > 0 ? bounds.minX + touch : bounds.maxX - touch);
    const rawLock = horiz0 ? rawZ : rawX;
    if ((rawLock - wallPos) * sgn0 > 3) {
      const me0 = worldBox({ ...item, x: rawX, z: rawZ, rotDeg: r0 }, cab);
      const front = horiz0 ? (sgn0 > 0 ? me0.z1 : me0.z0) : (sgn0 > 0 ? me0.x1 : me0.x0);
      // the run cabinet it meets FIRST coming out from the wall (her drag 2026-09-22: with the
      // drawers leg-to-leg and the oven housing beyond them, the old nearest-by-gap pick chose
      // the housing, so the return was then pushed clear of the drawers and the drop refused)
      let bestGap = null, bestNear = null, blocker = null;
      for (const o of others) {
        const oc = getCab(o.code);
        if (!oc || oc.corner || oc.notSupplied || oc.type === 'WALL') continue;
        const ob = worldBox(o, oc);
        const near = horiz0 ? (sgn0 > 0 ? ob.z0 : ob.z1) : (sgn0 > 0 ? ob.x0 : ob.x1);
        const gap = (near - front) * sgn0;                       // my front face to its nearest edge
        const overlap = horiz0 ? Math.min(me0.x1, ob.x1) - Math.max(me0.x0, ob.x0) : Math.min(me0.z1, ob.z1) - Math.max(me0.z0, ob.z0);
        // an overshoot into the neighbour (up to a body depth) still lands on the butt joint
        if (overlap > 0.5 && gap > -d && gap <= 40 && (bestNear == null || near * sgn0 < bestNear)) { bestGap = gap; bestNear = near * sgn0; blocker = oc; }
      }
      if (bestGap != null) {
        const shift = sgn0 * (bestGap - WALL_GAP);
        if (horiz0) z = rawZ + shift; else x = rawX + shift;
        rotDeg = r0; wall = null;
        // pulled forward but held at the joint: the blank return would run into that cabinet
        if (bestGap < -3) returnBlockedBy = blocker.code;
      }
    }
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
    // a sink or cooktop is not a run neighbour: it sits IN the worktop over a base, and a base
    // dragged along the run passes under it (it used to butt against the sink's edge and jitter)
    if (oc.appliance === 'sink' || oc.appliance === 'hob') continue;
    // hung cabinets butt hung cabinets, floor butts floor — EXCEPT a hung WALL
    // cabinet and a TALL cabinet, which meet side-to-side in the same run (a
    // wall cabinet dragged near a tall snaps to touch its side, no dead sliver)
    // A COUNTER cabinet stands on the worktop: it butts talls, uppers and other counter
    // cabinets (its own column), never the base it stands over.
    const kind = (c) => (c.type === 'WALL' ? 'hung' : c.type === 'COUNTER' ? 'counter' : 'floor');
    const k1 = kind(cab), k2 = kind(oc), tall = cab.type === 'TALL' || oc.type === 'TALL';
    if (k1 !== k2 && !tall) continue;                             // a tall spans every band, so anything butts it
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
  // ---- 2m. MATCH ACROSS THE COOKER while dragging an upper (her ask 2026-09-23, "drag this wall
  // cabinet so it is equally spaced either side of the range, make that an auto thing"): with a range
  // or cooktop in this run and a hung cabinet on its other side, the spot where my near edge is the
  // same distance from the cooker as that cabinet's near edge is a snap point (edges, as the eye reads).
  if (cab.type === 'WALL' && !cab.stacker && !cab.hoodCover) {
    const same = (o) => ((((o.rotDeg || 0) % 360) + 360) % 360) === ((rotDeg % 360) + 360) % 360;
    const alongOf = (o) => (freeAxis === 'x' ? o.x : o.z);
    for (const ck of others) {
      const kc = getCab(ck.code); if (!kc || !(kc.appliance === 'range' || kc.appliance === 'hob') || !same(ck)) continue;
      const focus = alongOf(ck), side = Math.sign(rawFree - focus); if (!side) continue;
      const partner = others.filter((o) => { const c = getCab(o.code); return c && c.type === 'WALL' && !c.stacker && !c.hoodCover && same(o) && Math.sign(alongOf(o) - focus) === -side; })
        .sort((p, q) => Math.abs(alongOf(p) - focus) - Math.abs(alongOf(q) - focus))[0];
      if (!partner) continue;
      const pc = getCab(partner.code), pNear = Math.abs(alongOf(partner) - focus) - pc.w / 2;
      const cand = focus + side * (pNear + halfRun);
      const err = Math.abs(rawFree - cand);
      if (err < bestErr) { bestErr = err; best = cand; bestN = null; }
    }
  }
  // ---- 2p. RIGHT-ANGLE joint with the ADJOINING run (her catch 2026-09-22, "cabinets on
  // right angles should snap exactly": her sink base on the right wall started 0.35" past the
  // back run's front, and the slot showed as a white slit at the corner). A plain cabinet whose
  // END is near a room corner snaps that end onto the FRONT PLANE of the perpendicular cabinet
  // standing in that corner on the adjoining wall, so a dead corner closes leg to leg both ways:
  // the side run starts on the back run's face, or the back run ends on the side run's face.
  if (!cab.corner && cab.type !== 'WALL' && cab.type !== 'COUNTER') {
    const meNow = worldBox({ ...item, x: freeAxis === 'x' ? rawX : x, z: freeAxis === 'z' ? rawZ : z, rotDeg }, cab);
    for (const o of others) {
      const oc = getCab(o.code);
      if (!oc || oc.notSupplied || oc.type === 'WALL' || oc.type === 'COUNTER') continue;   // corner units too: a tall starts on the corner base's face
      if ((((o.rotDeg || 0) - rotDeg) % 180 + 180) % 180 !== 90) continue;         // perpendicular only
      const ob = worldBox(o, oc);
      const oRad = ((o.rotDeg || 0) * Math.PI) / 180;
      // its front plane along MY free axis, and which side of me it stands
      const front = horizontal ? (Math.sin(oRad) >= 0 ? ob.x1 : ob.x0) : (Math.cos(oRad) >= 0 ? ob.z1 : ob.z0);
      const oMid = horizontal ? (ob.x0 + ob.x1) / 2 : (ob.z0 + ob.z1) / 2;
      const side = oMid > rawFree ? 1 : -1;                                          // it is beyond my +edge or my -edge
      // it must reach my run's line: its box spans to within 3" of my front (it stands in the corner beside my end)
      const reach = horizontal ? Math.min(meNow.z1 - ob.z0, ob.z1 - meNow.z0) : Math.min(meNow.x1 - ob.x0, ob.x1 - meNow.x0);
      if (reach < -3) continue;
      const cand = front - side * halfRun;                                           // my near edge on its front plane
      const err = Math.abs(rawFree - cand);
      if (err < bestErr) { bestErr = err; best = cand; bestN = null; }   // a perpendicular neighbour: no front-flush alignment with it (2b is a same-run rule)
    }
  }
  // ---- 2a. LEG-TO-LEG corner joint (her rule 2026-09-16: "on every corner it
  // should automatically snap with another 22mm leg on a right angle"). A
  // corner unit next to a PERPENDICULAR run snaps along its own wall so the
  // door section's return-side edge lands exactly on that run's front plane:
  // the run's first stile and the corner's door stile meet at 90°, and the
  // blank return (20" + up to 10" drawn stretch) still reaches the wall.
  // Wins over a same-run butt when both are in reach.
  // A WALL corner unit joins the same way against a TALL's flank or an upper run on the
  // adjoining wall (her open shelf beside a W9 and a tall, 2026-09-22: the corner unit sat 4.5"
  // off the tall with its oak return on show).
  if (cab.corner) {
    const CORNER_JOINT_SNAP = 12;
    const dirR = cab.cornerSide === 'right' ? 1 : -1;
    const radR = (rotDeg * Math.PI) / 180, ccR = Math.cos(radR), ssR = Math.sin(radR);
    const meRaw = worldBox({ ...item, x: freeAxis === 'x' ? rawX : x, z: freeAxis === 'z' ? rawZ : z, rotDeg }, cab);
    let jointTarget = null, jointErr = CORNER_JOINT_SNAP;
    for (const o of others) {
      const oc = getCab(o.code);
      if (!oc || oc.corner || oc.notSupplied || oc.stacker) continue;
      if (cab.type === 'WALL' ? !(oc.type === 'TALL' || oc.type === 'WALL') : oc.type === 'WALL') continue;   // a hung corner meets a tall or an upper; a floor corner meets the floor line
      if ((((o.rotDeg || 0) - rotDeg) % 180 + 180) % 180 !== 90) continue;         // perpendicular run only
      const ob = worldBox(o, oc);
      const gapX = Math.max(0, Math.max(ob.x0 - meRaw.x1, meRaw.x0 - ob.x1));
      const gapZ = Math.max(0, Math.max(ob.z0 - meRaw.z1, meRaw.z0 - ob.z1));
      if (gapX > CORNER_JOINT_SNAP || gapZ > CORNER_JOINT_SNAP) continue;            // not near this corner
      const oRad = ((o.rotDeg || 0) * Math.PI) / 180;
      const od = getFootprint(oc).d;
      // the neighbour's FRONT plane along MY run axis
      const front = horizontal
        ? (Math.sin(oRad) >= 0 ? o.x + od / 2 : o.x - od / 2)                        // rot 90 faces +x, 270 faces -x
        : (Math.cos(oRad) >= 0 ? o.z + od / 2 : o.z - od / 2);                       // rot 0 faces +z, 180 faces -z
      // my return-side door edge = centre + return direction * w/2
      const target = horizontal ? front - dirR * ccR * (w / 2) : front + dirR * ssR * (w / 2);
      const err = Math.abs(rawFree - target);
      if (err < jointErr) { jointErr = err; jointTarget = target; }
    }
    if (jointTarget != null) { rawFree = jointTarget; best = null; bestN = null; }
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
  // APPLIANCES are exempt both ways: a 26"-deep range really does stand 2" proud
  // of a 24" run. Aligning to it pulled a base cabinet 1" off the wall the moment
  // it was touched, and pushed a touched range back INTO the wall.
  const floorAppliance = (c) => c.type === 'APPLIANCES' && (c.mountY || 0) === 0;
  if (bestN && !['WALL', 'COUNTER'].includes(cab.type) && !floorAppliance(cab) && !floorAppliance(bestN.oc)) {
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
      // ...and line up ALONG the island too (her ask 2026-09-21: "make them snap... so it is
      // aligned at the end"): either end of this cabinet grabs the nearest END or JOINT of the
      // row behind it, so the island's two sides finish flush and the joints run through.
      const END_SNAP = 5;
      const myLo = along - w / 2, myHi = along + w / 2;
      let bestD = null;
      for (const o of others) {
        const oc = getCab(o.code); if (!oc) continue;
        if (((o.rotDeg || 0) % 180) !== (rotDeg % 180)) continue;
        const oRad = (o.rotDeg || 0) * Math.PI / 180;
        const oSgn = horizontal ? (Math.cos(oRad) >= 0 ? 1 : -1) : (Math.sin(oRad) >= 0 ? 1 : -1);
        if (oSgn === sgn) continue;
        const oFp = getFootprint(oc), oPerp = horizontal ? o.z : o.x;
        if (Math.abs((oPerp - oSgn * (oFp.d / 2)) - bestBack) > 0.75) continue;   // only the row whose backs we touch
        const oAlong = horizontal ? o.x : o.z;
        for (const oe of [oAlong - oFp.w / 2, oAlong + oFp.w / 2]) for (const me of [myLo, myHi]) {
          const dlt = oe - me;
          if (Math.abs(dlt) < END_SNAP && (bestD == null || Math.abs(dlt) < Math.abs(bestD))) bestD = dlt;
        }
      }
      if (bestD != null) { if (horizontal) x += bestD; else z += bestD; }
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
  let ret = cab.corner ? (cab.type === 'FLOOR' ? 20 : 10) : 0;
  // a boxing within the return's reach on that side takes the return (it is cut round the bulkhead on
  // site, her call 2026-09-23): the room clamp then keeps only the BODY inside. With no bulkhead the
  // full return stays inside the room, so a drag into a plain corner still parks the body 20" out.
  if (ret) {
    const dirR = cab.cornerSide === 'right' ? 1 : -1, radR = ((item.rotDeg || 0) * Math.PI) / 180;
    const ux = dirR * Math.cos(radR), uz = -dirR * Math.sin(radR);
    const px = rawX + ux * (w / 2), pz = rawZ + uz * (w / 2), d2 = d / 2;
    const cut = boxingBoxes(store.state.room || {}).some((bb) => Math.abs(ux) > 0.5
      ? pz - d2 < bb.z1 && pz + d2 > bb.z0 && (ux > 0 ? bb.x1 > px - 2 && bb.x0 < px + ret : bb.x0 < px + 2 && bb.x1 > px - ret)
      : px - d2 < bb.x1 && px + d2 > bb.x0 && (uz > 0 ? bb.z1 > pz - 2 && bb.z0 < pz + ret : bb.z0 < pz + 2 && bb.z1 > pz - ret));
    if (cut) ret = 0;
  }
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
  let cookerFlag = false;
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
    // BOXINGS (bulkheads) are solid to everything, floor to their top: nothing stands in one or hangs on one
    const boxBoxes = boxingBoxes(room).map((b) => ({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, y0: -1, y1: b.y1, boxing: true }));
    const inRoom = (px, pz) => [clamp(px, bounds.minX - oxMin, bounds.maxX - oxMax), clamp(pz, bounds.minZ - ozMin, bounds.maxZ - ozMax)];
    // worktop-mounted appliances (sink, hob) belong IN FRONT of a window —
    // the classic sink-under-the-window — so the glass isn't solid to them
    const winSolid = cab.appliance !== 'sink' && cab.appliance !== 'hob';
    const overCooker = cab.type === 'COUNTER' || (cab.type === 'WALL' && !cab.stacker && !cab.hoodCover);
    // a cooker under a PLASTER hood (AP26-28) needs no 50mm keep-clear beside it: the hood is
    // wider than the cooker and solid, and the uppers butt its flank (her rule 2026-09-25)
    const plasterOver = new Set();
    for (const o of others) { const oc = getCab(o.code); if (!oc || !oc.plaster) continue; const hb = worldBox(o, oc);
      for (const k of others) { const kc = getCab(k.code); if (kc && (kc.appliance === 'range' || kc.appliance === 'hob') && k.x > hb.x0 && k.x < hb.x1 && k.z > hb.z0 - 8 && k.z < hb.z1 + 8) plasterOver.add(k.id); } }
    // the plaster hoods are tested FIRST: an upper dropped into one butts the hood's flank, and
    // never reaches the cooker column behind it (which would raise the cooker flag on the way)
    const ordered = [...others].sort((a, b) => ((getCab(b.code)?.plaster ? 1 : 0) - (getCab(a.code)?.plaster ? 1 : 0)));
    const hitAt = (px, pz) => {
      const me = worldBox({ x: px, z: pz, rotDeg }, cab);
      const testOn = (m) => (ob) =>
        Math.min(m.x1, ob.x1) - Math.max(m.x0, ob.x0) > TOL &&
        Math.min(m.z1, ob.z1) - Math.max(m.z0, ob.z0) > TOL &&
        Math.min(m.y1, ob.y1) - Math.max(m.y0, ob.y0) > 1;
      const test = testOn(me);
      if (winSolid) for (const wb of winBoxes) if (test(wb)) return wb;
      // a boxing never blocks a CORNER unit: it is cut in round the bulkhead on site, body and return alike
      // (her call 2026-09-23: "it should still be allowed there, that can be cut in on site"); the live
      // warning notes the cut. Everything else treats a boxing as a wall.
      if (!cab.corner) for (const bb of boxBoxes) if (test(bb)) return bb;
      for (const o of ordered) {
        const oc = getCab(o.code);
        if (!oc || !oc.placeable) continue;
        if ((cab.hoodCover && oc.appliance === 'hood') || (cab.appliance === 'hood' && oc.hoodCover)) continue;   // the cover wraps the hood
        const ob = worldBox(o, oc);
        // RULE (17 Sep 2026): nothing sits over the cooker. A range or hob is
        // solid through its whole column to a counter dresser or an upper, so a
        // cabinet that is not in its height band still cannot be dropped on it.
        if (overCooker && (oc.appliance === 'range' || oc.appliance === 'hob')) {
          // ...and a WALL cabinet also keeps 50mm clear of the cooker's edges either side (her rule 2026-09-22)
          const side = cab.type === 'WALL' && !plasterOver.has(o.id) ? COOK_SIDE_IN : 0;
          const col = { ...ob, x0: ob.x0 - side, x1: ob.x1 + side, z0: ob.z0 - side, z1: ob.z1 + side, y0: -1, y1: 999, cooker: true };
          if (test(col)) return col;
          continue;
        }
        if (test(ob)) return ob;
      }
      return null;
    };
    let hit = hitAt(x, z);
    for (let i = 0; i < 4 && hit; i++) {
      if (hit.win) windowFlag = true;
      if (hit.cooker) cookerFlag = true;
      const me = worldBox({ x, z, rotDeg }, cab);
      // butt to the blocker's NEAR side, unless that side is through the room wall (a boxing in
      // a corner): then the far side, so a cabinet in a bulkhead always comes out into the room
      if (freeAxis === 'x') {
        const dxL = hit.x0 - me.x1, dxR = hit.x1 - me.x0;
        const okL = me.x0 + dxL >= bounds.minX - 0.05, okR = me.x1 + dxR <= bounds.maxX + 0.05;
        x += (okL && (!okR || Math.abs(dxL) <= Math.abs(dxR))) ? dxL : dxR;
      } else {
        const dzL = hit.z0 - me.z1, dzR = hit.z1 - me.z0;
        const okL = me.z0 + dzL >= bounds.minZ - 0.05, okR = me.z1 + dzR <= bounds.maxZ + 0.05;
        z += (okL && (!okR || Math.abs(dzL) <= Math.abs(dzR))) ? dzL : dzR;
      }
      [x, z] = inRoom(x, z);
      hit = hitAt(x, z);
    }
    if (hit) {                                            // no clear spot → stay put
      if (hit.win) windowFlag = true;
      if (hit.cooker) cookerFlag = true;
      x = item.x; z = item.z; rotDeg = item.rotDeg || 0;
    }
  }

  let flag = windowFlag ? 'window' : (cookerFlag ? 'cooker' : undefined);

  // A sink or cooktop near a base cabinet CENTRES on it, both ways (her rule
  // 2026-09-18: "the sink when dropped in always automatically centres on the
  // cabinet"): same spot and rotation as the base, which is where the wizard
  // seats one. Away from every base it moves freely, as before.
  if ((cab.appliance === 'sink' || cab.appliance === 'hob') && !flag) {
    const base = baseUnder(store.state, rawX, rawZ, 7, cab);
    if (base) { x = base.x; z = base.z; rotDeg = base.rotDeg || 0; }
  }
  // RULE (her call 2026-09-18): a sink or cooktop NEVER sits over a dishwasher
  // front. There is a machine behind that door. The drop pings back.
  if ((cab.appliance === 'sink' || cab.appliance === 'hob') && !flag && overDishwasher(store.state, cab, x, z, rotDeg)) {
    x = item.x; z = item.z; rotDeg = item.rotDeg || 0; flag = 'dishwasher';
  }

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
    // the return REACHES the wall: its tip within 10" of the wall, or past it (the return is cut to
    // length on site, her call 2026-09-23), i.e. the body edge is within (return + 10) of that wall
    const edgeX = x + dir * cc * (w / 2), edgeZ = z - dir * ss * (w / 2), reachR = getFootprint(cab).returnLeg;
    const tipOk = horiz
      ? (dir * cc > 0 ? bounds.maxX - edgeX : edgeX - bounds.minX) <= reachR + TIP_TOL
      : (-dir * ss > 0 ? bounds.maxZ - edgeZ : edgeZ - bounds.minZ) <= reachR + TIP_TOL;
    void tipX; void tipZ;
    // …OR, with the return still meeting the side wall, the unit pulled off its
    // own back wall until its body BUTTS a cabinet on the adjoining run (her
    // call 2026-09-16: when the generated return stops short, the corner unit
    // should be allowed to come forward to touch the drawers).
    const TOUCH = 1.5;
    const me2 = worldBox({ ...item, x, z, rotDeg }, cab);
    const buttsRun = others.some((o) => {
      const oc = getCab(o.code);
      if (!oc || oc.corner || oc.notSupplied || ['WALL'].includes(oc.type) !== ['WALL'].includes(cab.type)) return false;
      const ob = worldBox(o, oc);
      const gapX = Math.max(ob.x0 - me2.x1, me2.x0 - ob.x1);   // < 0 means the boxes overlap on that axis
      const gapZ = Math.max(ob.z0 - me2.z1, me2.z0 - ob.z1);
      return (gapX >= -0.5 && gapX <= TOUCH && gapZ < -0.5) || (gapZ >= -0.5 && gapZ <= TOUCH && gapX < -0.5);
    });
    // …OR sitting along its own wall butted to a cabinet on its DOOR side: the
    // owner's second case (2026-09-16), a corner unit slid along the back wall
    // to close up to the drawers while its return faces open wall.
    const doorEdge = x - dir * cc * (w / 2);          // door-side edge of the BODY (not the return)
    const doorEdgeZ = z + dir * ss * (w / 2);
    const buttsDoorSide = others.some((o) => {
      const oc = getCab(o.code);
      if (!oc || oc.notSupplied || (oc.type === 'WALL') !== (cab.type === 'WALL')) return false;
      if (((o.rotDeg || 0) % 180) !== (rotDeg % 180)) return false;          // same run
      const ob = worldBox(o, oc);
      if (horiz) {
        const near = dir > 0 ? ob.x1 : ob.x0;                                     // its edge facing my door side
        const zOverlap = Math.min(me2.z1, ob.z1) - Math.max(me2.z0, ob.z0);
        return Math.abs(near - doorEdge) <= TOUCH && zOverlap > 0.5;
      }
      const near = dir > 0 ? ob.z0 : ob.z1;
      const xOverlap = Math.min(me2.x1, ob.x1) - Math.max(me2.x0, ob.x0);
      return Math.abs(near - doorEdgeZ) <= TOUCH && xOverlap > 0.5;
    });
    // …OR pulled FORWARD off its own wall, the return still on the side wall (her drag
    // 2026-09-22: "it won't let me drag this corner cabinet forward"): up to 30" out, so it
    // can come to meet a deeper run or leave room behind; 1b above lands it on the run's face.
    const offWall = horiz
      ? (cc >= 0 ? z - (bounds.minZ + touch) : (bounds.maxZ - touch) - z)
      : (ss >= 0 ? x - (bounds.minX + touch) : (bounds.maxX - touch) - x);
    const forward = tipOk && offWall > -0.5 && offWall <= 30;
    // …OR anywhere ALONG its own wall (her drag 2026-09-22, "corner cabinet still gets stuck
    // in the corner"): a corner unit slides along the wall like any base; if its return then
    // faces open wall the live warning says so. Off every wall it is still refused.
    if (!backOk && !(tipOk && buttsRun) && !forward) { x = item.x; z = item.z; rotDeg = item.rotDeg || 0; flag = 'corner'; }
    else if (returnBlockedBy && !flag) flag = 'cornerReturn:' + returnBlockedBy;
  }

  return { x, z, rotDeg, flag, ...(shelfDepth != null ? { depth: shelfDepth } : {}) };
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
