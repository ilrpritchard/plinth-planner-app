// warnings.js — live design guardrails. Pure geometry over the layout; returns
// a short list of human-readable issues so the customer (and Imogen) catch
// problems before ordering. No DOM, no Three.js.

import { getCab } from './catalogue.js';
import { fmtIn } from './units.js';
import { openingCenter, openingWidth } from './openings.js';

// axis-aligned footprint extents (x half, z half) for an item, accounting for
// 90°/270° rotation. Returns center + half-sizes in inches.
function aabb(it) {
  const cab = getCab(it.code);
  if (!cab) return null;
  const horiz = ((it.rotDeg || 0) % 180) === 0;
  const hx = (horiz ? cab.w : cab.d) / 2;
  const hz = (horiz ? cab.d : cab.w) / 2;
  return { x: it.x, z: it.z, hx, hz, cab, it };
}

const isFloorStanding = (cab) =>
  ['FLOOR', 'TALL', 'COUNTER'].includes(cab.type) ||
  (cab.type === 'APPLIANCES' && (cab.mountY ?? 0) === 0);

const isWorktopAppliance = (cab) =>
  cab.type === 'APPLIANCES' && (cab.mountY ?? 0) > 0 && (cab.mountY ?? 0) < 50; // hob / sink

/** Ranges / hobs sitting in front of a window on their wall (hard rule: a
 *  cooker never goes in front of a window). Pure geometry, shared by the
 *  warnings panel and the wizard (which rerolls a layout that lands one). */
export function cookerWindowClashes(state) {
  const r = state.room || {};
  const out = [];
  const boxes = (state.items || []).map(aabb).filter(Boolean);
  for (const b of boxes) {
    if (!(b.cab.type === 'APPLIANCES' && (b.cab.appliance === 'range' || b.cab.appliance === 'hob'))) continue;
    const horiz = ((b.it.rotDeg || 0) % 180) === 0;
    for (const o of (r.openings || [])) {
      if (o.type !== 'window') continue;
      const wall = o.wall || 'back';
      const backish = wall === 'back' || wall === 'front';
      if (backish !== horiz) continue;                     // cooker faces a different axis
      const line = { back: -r.depth / 2, front: r.depth / 2, left: -r.width / 2, right: r.width / 2 }[wall];
      const perp = backish ? b.z : b.x;
      const perpHalf = backish ? b.hz : b.hx;
      if (Math.abs(perp - (line - Math.sign(line) * perpHalf)) > 8) continue; // not against this wall
      const c = openingCenter(r, o), w = openingWidth(o, r);
      const along = backish ? b.x : b.z;
      const alongHalf = backish ? b.hx : b.hz;
      if ((alongHalf + w / 2) - Math.abs(along - c) > 2) out.push({ box: b, opening: o });
    }
  }
  return out;
}

/** Compute design warnings for the current home-mode layout. */
export function computeWarnings(state) {
  const out = [];
  const r = state.room;
  const items = state.items || [];
  const boxes = items.map(aabb).filter(Boolean);

  // ---- 0. cooker in front of a window (hard rule) ----
  for (const k of cookerWindowClashes(state)) {
    out.push({ level: 'error', msg: `${k.box.cab.desc} sits in front of a window — a cooker never goes there. Slide it along the wall.` });
  }

  // ---- 1. floor-standing cabinets overlapping each other ----
  const floor = boxes.filter((b) => isFloorStanding(b.cab));
  const OVL = 1.0; // ignore <1" touch/snap slack
  for (let i = 0; i < floor.length; i++) {
    for (let j = i + 1; j < floor.length; j++) {
      const a = floor[i], b = floor[j];
      const ox = (a.hx + b.hx) - Math.abs(a.x - b.x);
      const oz = (a.hz + b.hz) - Math.abs(a.z - b.z);
      if (ox > OVL && oz > OVL) {
        out.push({ level: 'error', msg: `${a.cab.code} and ${b.cab.code} overlap — pull them apart so they sit side by side.` });
      }
    }
  }

  // ---- 2. runs that exceed the wall length ----
  for (const [wall, len, label] of [['back', r.width, 'Back wall'], ['left', r.depth, 'Side wall']]) {
    const minPerp = wall === 'back' ? -r.depth / 2 : -r.width / 2;
    let used = 0;
    for (const b of floor) {
      const horiz = ((b.it.rotDeg || 0) % 180) === 0;
      const onWall = wall === 'back'
        ? (horiz && Math.abs(b.z - (minPerp + b.cab.d / 2)) < 8)
        : (!horiz && Math.abs(b.x - (minPerp + b.cab.d / 2)) < 8);
      if (onWall) used += b.cab.w;
    }
    if (used > len + 0.5) {
      out.push({ level: 'error', msg: `${label} run is over by ${fmtIn(used - len)} — remove or narrow a cabinet.` });
    }
  }

  // ---- 3. worktop appliances (sink / hob) with no base cabinet beneath ----
  for (const b of boxes) {
    if (!isWorktopAppliance(b.cab)) continue;
    const supported = floor.some((f) =>
      f.cab.type === 'FLOOR' &&
      (f.hx + b.hx) - Math.abs(f.x - b.x) > 2 &&
      (f.hz + b.hz) - Math.abs(f.z - b.z) > 2);
    if (!supported) {
      out.push({ level: 'warn', msg: `${b.cab.desc} isn’t over a base cabinet — sit it on a sink/cooktop base so it has support.` });
    }
  }

  // ---- 4. range / cooktop with no worktop landing on either side ----
  for (const b of floor) {
    if (!(b.cab.type === 'APPLIANCES' && (b.cab.appliance === 'range' || b.cab.appliance === 'hob'))) continue;
    const horiz = ((b.it.rotDeg || 0) % 180) === 0;
    let leftN = false, rightN = false;
    for (const f of floor) {
      if (f === b || f.cab.type !== 'FLOOR') continue;
      const perpClose = horiz ? Math.abs(f.z - b.z) < 8 : Math.abs(f.x - b.x) < 8;
      if (!perpClose) continue;
      const along = horiz ? f.x - b.x : f.z - b.z;
      const touch = (horiz ? (b.hx + f.hx) : (b.hz + f.hz)) + 1;
      if (along < 0 && Math.abs(along) <= touch) leftN = true;
      if (along > 0 && Math.abs(along) <= touch) rightN = true;
    }
    if (!leftN && !rightN) {
      out.push({ level: 'warn', msg: `${b.cab.desc} has no counter beside it — add a base cabinet for landing space.` });
    }
  }

  // ---- 5. corner units with no return run meeting them ----
  // A corner cabinet only earns its keep where two runs meet at a right angle:
  // its blank return must butt into the end of a PERPENDICULAR run. If no
  // perpendicular cabinet (same height band) meets the return within 6", the
  // corner stands orphaned — flag it.
  for (const b of boxes) {
    if (!b.cab.corner) continue;
    const ret = b.cab.type === 'FLOOR' ? 20 : 10;            // blank return length
    const rot = b.it.rotDeg || 0;
    const rad = (rot * Math.PI) / 180;
    const horiz = (rot % 180) === 0;
    const dir = b.cab.cornerSide === 'right' ? 1 : -1;       // side the return extends
    // centre of the return panel: out along the unit's local +x axis → world (cos, -sin)
    const off = b.cab.w / 2 + ret / 2;
    const rx = b.x + dir * Math.cos(rad) * off;
    const rz = b.z - dir * Math.sin(rad) * off;
    const rhx = horiz ? ret / 2 : b.cab.d / 2;               // return half-extents (world axes)
    const rhz = horiz ? b.cab.d / 2 : ret / 2;
    // floor corners meet floor-standing runs; wall corners meet wall-cab runs
    const band = b.cab.type === 'WALL' ? (c) => c.type === 'WALL' : isFloorStanding;
    const met = boxes.some((o) =>
      o !== b && band(o.cab) &&
      ((o.it.rotDeg || 0) % 180) !== (rot % 180) &&          // perpendicular orientation
      Math.abs(o.x - rx) - (o.hx + rhx) <= 6 &&              // end meets the return within 6"
      Math.abs(o.z - rz) - (o.hz + rhz) <= 6);
    if (!met) {
      out.push({ level: 'warn', msg: `${b.cab.code} corner unit has no return run meeting it — add cabinets on the adjoining wall or swap it for a standard cabinet.` });
    }
  }

  // ---- range clearance (hard rule): >= 18" of counter between any cooking
  // appliance (range, or a hob on its base) and any TALL / COUNTER unit or a
  // freestanding fridge. Edge-to-edge AABB distance — catches co-linear
  // neighbours AND a tall lurking just around a corner.
  {
    const RANGE_CLEAR = 18;
    const isCookBox = (b) => /^AP[1-5]$/.test(b.cab.code);   // AP1-3 ranges, AP4-5 hobs
    const isTallish = (b) => b.cab.type === 'TALL' || b.cab.type === 'COUNTER' || b.cab.appliance === 'fridge';
    const seen = new Set();
    for (const c of boxes.filter(isCookBox)) {
      for (const t of boxes.filter(isTallish)) {
        const dx = Math.abs(c.x - t.x) - (c.hx + t.hx);
        const dz = Math.abs(c.z - t.z) - (c.hz + t.hz);
        const gap = Math.max(dx, dz);
        if (gap < RANGE_CLEAR - 0.01) {
          const key = `${c.cab.code}·${t.cab.code}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ level: 'warn', msg: `${c.cab.code} range is ${gap <= 0.5 ? 'hard against' : `only ${fmtIn(Math.max(0, gap))} from`} ${t.cab.code} — keep at least 18" of counter between a cooker and any tall or counter cabinet.` });
        }
      }
    }
  }

  // ---- dishwasher legs (hard rule): the F7 panel is legless — it must sit
  // BETWEEN two leg-bearing cabinets (FLOOR/TALL) whose 22mm legs it borrows.
  // A run end, a corner void, or an appliance beside it leaves it unsupported.
  {
    const isDW = (b) => getCab(b.cab.code)?.form === 'dishwasher';
    const legCab = (b) => (b.cab.type === 'FLOOR' || b.cab.type === 'TALL') && getCab(b.cab.code)?.form !== 'dishwasher';
    for (const dwb of boxes.filter(isDW)) {
      const horiz = ((dwb.it.rotDeg || 0) % 180) === 0;
      let left = false, right = false;
      for (const o of boxes) {
        if (o === dwb || !legCab(o)) continue;
        if (((o.it.rotDeg || 0) % 180) !== ((dwb.it.rotDeg || 0) % 180)) continue;   // same run direction
        const lockOff = horiz ? Math.abs(o.z - dwb.z) : Math.abs(o.x - dwb.x);
        if (lockOff > 6) continue;                                                    // same run line
        const gap = horiz ? Math.abs(o.x - dwb.x) - (o.hx + dwb.hx) : Math.abs(o.z - dwb.z) - (o.hz + dwb.hz);
        if (gap > 1.5) continue;                                                      // must butt
        const side = horiz ? (o.x < dwb.x) : (o.z < dwb.z);
        if (side) left = true; else right = true;
      }
      if (!left || !right) {
        out.push({ level: 'warn', msg: `${dwb.cab.code} dishwasher panel has no cabinet on ${left ? 'one side' : right ? 'one side' : 'either side'} — it is legless and must sit between two cabinets, borrowing their legs.` });
      }
    }
  }

  return out;
}
