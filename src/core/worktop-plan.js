// worktop-plan.js — PURE worktop slab planning (no Three.js), so the corner
// geometry is node-testable. Contiguous floor cabinets merge into one slab; a
// run that reaches a wall extends to it; and where two PERPENDICULAR runs meet
// at a room corner the slabs are joined so the top turns the corner as one
// continuous surface (no missing wedge): the run along the side wall extends
// INTO the corner, and the other run butts against it — a single seam, exactly
// like a real worktop joint.
//
// HARD RULE: the top NEVER rides over a freestanding appliance. Ranges (and
// freestanding fridges) are their own machines — the slab butts their sides
// exactly (no 1" overhang over the range, no spill past its edge at a run
// end), stops dead, and resumes on the other side.

import { sinkSpec } from './sinkspec.js';

const OVERHANG = 1.0;   // proud of a door front / island edge
export const ISLAND_END_OVERHANG = 50 / 25.4;   // 50mm past each END of an island run (her spec 2026-09-18)
const SEATING = 12;     // breakfast-bar overhang past an island back (300mm)
const CONNECT = 9.6;    // cabinets within this gap (incl. a 9\" max filler) share a slab
const WALL_NEAR = 9.6;  // a run end this close to a wall extends to it (fills).
                        // MUST stay >= the filler rule's max end gap (MAX_GAP 9
                        // in core/fillers.js): every gap that gets a painted
                        // scribe filler gets worktop over it too. At 7 the
                        // 7–9" end gaps grew a filler with a BARE top — the
                        // counter stopped short of the wall.
const CORNER_JOIN = 7;  // two perpendicular slabs this close join at the corner

/**
 * @returns [{x0,x1,z0,z1,mat}] slab rectangles at worktop level.
 * items/room use the same shapes as the store state; getCab resolves a code.
 */
export function planWorktopSlabs(items, getCab, defaultMat = 'marble', room = null) {
  // axis-aligned footprint + a worktop material per FLOOR cabinet
  const cells = [];
  for (const it of items) {
    const cab = getCab(it.code);
    if (!cab || cab.type !== 'FLOOR') continue;
    const horiz = ((it.rotDeg || 0) % 180) === 0;
    const hw = (horiz ? cab.w : cab.d) / 2;
    const hd = (horiz ? cab.d : cab.w) / 2;
    const cell = {
      horiz,
      x0: it.x - hw, x1: it.x + hw, z0: it.z - hd, z1: it.z + hd,
      mat: it.worktop || defaultMat,
      seating: !!it.seating,          // island breakfast-bar overhang (+z side)
      island: !!it.island,
    };
    // a CORNER cabinet's blank return extends the footprint one side — the
    // worktop must cover it too, so the surface turns the corner continuously.
    // The DRAWN return stretches past the 20" SKU to meet the adjacent wall
    // (cornerReturnLength in interaction/snapping.js covers scribe gaps up to
    // ~10"); the worktop must cover the STRETCHED panel too, or the strip
    // between the SKU return and the wall shows bare carcass at the corner.
    if (cab.corner) {
      const sl = cab.cornerSide === 'right' ? 1 : -1;  // return on local left by default
      const rad = (it.rotDeg || 0) * Math.PI / 180;
      const wx = Math.cos(rad) * sl, wz = -Math.sin(rad) * sl;  // world dir of the return
      let ret = cab.type === 'FLOOR' ? 20 : 10;        // SKU return
      if (room) {                                      // same stretch rule as the drawn panel
        let dist = null;                               // door edge → adjacent wall
        if (wx > 0.5) dist = room.width / 2 - cell.x1;
        else if (wx < -0.5) dist = cell.x0 + room.width / 2;
        else if (wz > 0.5) dist = room.depth / 2 - cell.z1;
        else if (wz < -0.5) dist = cell.z0 + room.depth / 2;
        if (dist != null && dist > 1 && dist <= ret + 10) ret = dist;
      }
      if (wx < -0.5) cell.x0 -= ret; else if (wx > 0.5) cell.x1 += ret;
      if (wz < -0.5) cell.z0 -= ret; else if (wz > 0.5) cell.z1 += ret;
    }
    cells.push(cell);
  }
  if (!cells.length) return [];

  // union-find clusters of same-orientation cells whose footprints touch/are
  // within CONNECT on one axis and overlap on the other (a continuous run).
  const parent = cells.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { parent[find(a)] = find(b); };
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j];
      if (a.horiz !== b.horiz) continue;            // perpendicular runs stay separate (L-corners)
      const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const overlapZ = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      const gapX = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      const gapZ = Math.max(a.z0, b.z0) - Math.min(a.z1, b.z1);
      const adj = (overlapX > -0.01 && gapZ <= CONNECT && gapZ > -CONNECT) ||
                  (overlapZ > -0.01 && gapX <= CONNECT && gapX > -CONNECT);
      if (adj) join(i, j);
    }
  }

  const clusters = new Map();
  for (let i = 0; i < cells.length; i++) {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(cells[i]);
  }

  // TALL cabinets bound the counter: a slab end that butts a tall STOPS dead
  // at the tall's face (the front frame leg) — it never side-overhangs past
  // it. Counter (counterstanding) units stand ON the top and appliances have
  // their own butt-exactly rule, so only true TALLs clip here.
  const talls = [];
  for (const it of items) {
    const cab = getCab(it.code);
    if (!cab || cab.type !== 'TALL') continue;
    const horiz = ((it.rotDeg || 0) % 180) === 0;
    const hw = (horiz ? cab.w : cab.d) / 2, hd = (horiz ? cab.d : cab.w) / 2;
    talls.push({ x0: it.x - hw, x1: it.x + hw, z0: it.z - hd, z1: it.z + hd });
  }
  // a tall sitting right beyond `end` (within the would-be overhang), with
  // real cross-axis overlap of the slab band → the face the counter stops at
  const tallFace = (end, dir, axis, lo, hi, reach) => {
    let face = null;
    for (const t of talls) {
      const near = axis === 'x' ? (dir > 0 ? t.x0 : t.x1) : (dir > 0 ? t.z0 : t.z1);
      const off = dir > 0 ? near - end : end - near;
      if (off < -0.6 || off > reach + 0.6) continue;
      const [c0, c1] = axis === 'x' ? [t.z0, t.z1] : [t.x0, t.x1];
      if (Math.min(c1, hi) - Math.max(c0, lo) <= 2) continue;
      if (face == null || (dir > 0 ? near < face : near > face)) face = near;
    }
    return face;
  };

  const slabs = [];
  for (const cluster of clusters.values()) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of cluster) { x0 = Math.min(x0, c.x0); x1 = Math.max(x1, c.x1); z0 = Math.min(z0, c.z0); z1 = Math.max(z1, c.z1); }

    // each exposed side: stop at a butting TALL's face first, else extend to
    // the wall if near (fills over the scribe filler), otherwise add a small
    // overhang for a free / island edge.
    // seating: any flagged cell turns the cluster's open +z edge into a
    // breakfast-bar overhang (stool side), instead of the 1" lip
    const seatOver = cluster.some((c) => c.seating) ? SEATING : OVERHANG;
    // an ISLAND's two ends (along its run) carry 50mm; its long edges keep the 1" lip
    const isl = cluster.every((c) => c.island), runX = cluster[0].horiz;
    const overX = isl && runX ? ISLAND_END_OVERHANG : OVERHANG;
    const overZ = isl && !runX ? ISLAND_END_OVERHANG : OVERHANG;
    const tL = tallFace(x0, -1, 'x', z0, z1, overX);
    const tR = tallFace(x1, +1, 'x', z0, z1, overX);
    const tB = tallFace(z0, -1, 'z', x0, x1, overZ);
    const tF = tallFace(z1, +1, 'z', x0, x1, seatOver);
    if (room) {
      const minX = -room.width / 2, maxX = room.width / 2, minZ = -room.depth / 2, maxZ = room.depth / 2;
      x0 = tL != null ? tL : (x0 - minX <= WALL_NEAR) ? minX : x0 - overX;
      x1 = tR != null ? tR : (maxX - x1 <= WALL_NEAR) ? maxX : x1 + overX;
      z0 = tB != null ? tB : (z0 - minZ <= WALL_NEAR) ? minZ : z0 - overZ;
      z1 = tF != null ? tF : (maxZ - z1 <= WALL_NEAR) ? maxZ : z1 + (seatOver > OVERHANG ? seatOver : Math.max(seatOver, overZ));
    } else {
      x0 = tL != null ? tL : x0 - overX;
      x1 = tR != null ? tR : x1 + overX;
      z0 = tB != null ? tB : z0 - overZ;
      z1 = tF != null ? tF : z1 + (seatOver > OVERHANG ? seatOver : Math.max(seatOver, overZ));
    }

    // material: most common across the cluster (usually uniform)
    const tally = new Map();
    for (const c of cluster) tally.set(c.mat, (tally.get(c.mat) || 0) + 1);
    const mat = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0] || defaultMat;

    slabs.push({ x0, x1, z0, z1, mat, horiz: cluster[0].horiz });
  }

  // ---- the DEAD CORNER: a run that reaches a room corner turns it. When the adjoining wall
  // has nothing standing in the corner but a cabinet further along it (a tall, a base, a
  // boxing), the top continues round the corner along that wall up to its flank, as one
  // worktop does on site (her call 2026-09-22: "the worktop will need to continue round the
  // corner", an F32 on the side wall, an upper over the dead corner, a tall beyond it).
  // Never past RETURN_MAX, never where another run already fills the corner.
  const RETURN_MAX = 36;
  if (room) {
    const minX = -room.width / 2, maxX = room.width / 2, minZ = -room.depth / 2, maxZ = room.depth / 2;
    const standing = [];                               // everything on the floor that a return can meet
    for (const it of items) {
      const cab = getCab(it.code);
      if (!cab || (cab.type !== 'FLOOR' && cab.type !== 'TALL' && !(cab.type === 'APPLIANCES' && (cab.mountY || 0) === 0))) continue;
      const horiz = ((it.rotDeg || 0) % 180) === 0;
      const hw = (horiz ? cab.w : cab.d) / 2, hd = (horiz ? cab.d : cab.w) / 2;
      standing.push({ x0: it.x - hw, x1: it.x + hw, z0: it.z - hd, z1: it.z + hd });
    }
    for (const bx of room.boxings || []) {
      const wall = bx.wall || 'back', len = wall === 'back' || wall === 'front' ? room.width : room.depth;
      const w = bx.w || 8, d = bx.d || 8, along = Math.max(-len / 2 + w / 2, Math.min(len / 2 - w / 2, -len / 2 + (bx.pos ?? 0.5) * len));
      standing.push(wall === 'back' ? { x0: along - w / 2, x1: along + w / 2, z0: minZ, z1: minZ + d } : wall === 'front' ? { x0: along - w / 2, x1: along + w / 2, z0: maxZ - d, z1: maxZ }
        : wall === 'left' ? { x0: minX, x1: minX + d, z0: along - w / 2, z1: along + w / 2 } : { x0: maxX - d, x1: maxX, z0: along - w / 2, z1: along + w / 2 });
    }
    const covered = (px, pz, self) => slabs.some((s) => s !== self && px > s.x0 + 0.5 && px < s.x1 - 0.5 && pz > s.z0 + 0.5 && pz < s.z1 - 0.5);
    const returns = [];
    for (const S of slabs) {
      // a V slab (along z) reaching the back or front wall; an H slab (along x) reaching a side wall
      const ends = S.horiz
        ? [{ hit: Math.abs(S.x0 - minX) < 0.6, cornerX: minX, cornerZ: null }, { hit: Math.abs(S.x1 - maxX) < 0.6, cornerX: maxX, cornerZ: null }]
        : [{ hit: Math.abs(S.z0 - minZ) < 0.6, cornerX: null, cornerZ: minZ }, { hit: Math.abs(S.z1 - maxZ) < 0.6, cornerX: null, cornerZ: maxZ }];
      for (const e of ends) {
        if (!e.hit) continue;
        if (S.horiz) {
          // H reaches a side wall at x = cornerX: the corner is at the slab's back edge (z0 near a wall) or front edge
          const atBack = Math.abs(S.z0 - minZ) < 14, atFront = Math.abs(S.z1 - maxZ) < 14;
          if (!atBack && !atFront) continue;
          const cz = atBack ? minZ : maxZ, dir = atBack ? +1 : -1, depth = S.x1 - S.x0 > 0 ? (S.z1 - S.z0) : 0;
          // along the side wall, away from the corner: the nearest thing standing against that wall
          let flank = null;
          for (const o of standing) {
            const onWall = e.cornerX === minX ? o.x0 - minX < 14 : maxX - o.x1 < 14; if (!onWall) continue;
            const near = dir > 0 ? o.z0 : o.z1, off = dir > 0 ? near - cz : cz - near;
            if (off < 0.6 || off > RETURN_MAX) continue;
            if (flank == null || off < flank.off) flank = { off, near };
          }
          if (!flank) continue;
          const from = atBack ? S.z1 : S.z0;                                              // the slab's own edge, into the room
          if ((dir > 0 && flank.near <= from + 0.5) || (dir < 0 && flank.near >= from - 0.5)) continue;   // the slab already reaches it
          const midZ = (from + flank.near) / 2;
          if (covered(e.cornerX === minX ? minX + 2 : maxX - 2, midZ, S)) continue;      // another run already fills it
          const rx0 = e.cornerX === minX ? minX : maxX - depth, rx1 = e.cornerX === minX ? minX + depth : maxX;
          returns.push({ x0: rx0, x1: rx1, z0: Math.min(from, flank.near), z1: Math.max(from, flank.near), mat: S.mat, horiz: false });
        } else {
          const atLeft = Math.abs(S.x0 - minX) < 14, atRight = Math.abs(S.x1 - maxX) < 14;
          if (!atLeft && !atRight) continue;
          const cx = atLeft ? minX : maxX, dir = atLeft ? +1 : -1, depth = S.x1 - S.x0;
          let flank = null;
          for (const o of standing) {
            const onWall = e.cornerZ === minZ ? o.z0 - minZ < 14 : maxZ - o.z1 < 14; if (!onWall) continue;
            const near = dir > 0 ? o.x0 : o.x1, off = dir > 0 ? near - cx : cx - near;
            if (off < 0.6 || off > RETURN_MAX) continue;
            if (flank == null || off < flank.off) flank = { off, near };
          }
          if (!flank) continue;
          const from = atLeft ? S.x1 : S.x0;                                              // the slab's own edge, into the room
          if ((dir > 0 && flank.near <= from + 0.5) || (dir < 0 && flank.near >= from - 0.5)) continue;
          const midX = (from + flank.near) / 2;
          if (covered(midX, e.cornerZ === minZ ? minZ + 2 : maxZ - 2, S)) continue;
          const rz0 = e.cornerZ === minZ ? minZ : maxZ - depth, rz1 = e.cornerZ === minZ ? minZ + depth : maxZ;
          returns.push({ x0: Math.min(from, flank.near), x1: Math.max(from, flank.near), z0: rz0, z1: rz1, mat: S.mat, horiz: true });
        }
      }
    }
    slabs.push(...returns);
  }

  // ---- corner joins: where a run along X (H) meets a perpendicular run along
  // Z (V), fill the corner square so the surface is continuous into the room
  // corner: V extends over the corner to H's far (wall) edge, and H trims /
  // extends to butt V's inner edge. One seam, no overlap, no missing wedge.
  for (const H of slabs) {
    if (!H.horiz) continue;
    for (const V of slabs) {
      if (V.horiz) continue;
      const hcx = (H.x0 + H.x1) / 2, vcx = (V.x0 + V.x1) / 2;
      const hcz = (H.z0 + H.z1) / 2, vcz = (V.z0 + V.z1) / 2;
      // which END of H approaches V (V must sit at/off that end, not mid-run)
      const vLeft = vcx < hcx;
      const hEdge = vLeft ? H.x0 : H.x1;
      const nearX = vLeft
        ? (hEdge >= V.x0 - 2 && hEdge <= V.x1 + CORNER_JOIN)
        : (hEdge >= V.x0 - CORNER_JOIN && hEdge <= V.x1 + 2);
      // which END of V approaches H
      const hBehind = hcz < vcz;
      const vEdge = hBehind ? V.z0 : V.z1;
      const nearZ = hBehind
        ? (vEdge >= H.z0 - 2 && vEdge <= H.z1 + CORNER_JOIN)
        : (vEdge >= H.z0 - CORNER_JOIN && vEdge <= H.z1 + 2);
      if (!nearX || !nearZ) continue;
      // V runs through into the corner…
      if (hBehind) V.z0 = Math.min(V.z0, H.z0); else V.z1 = Math.max(V.z1, H.z1);
      // …and H butts against V (trims the overlap / closes any small gap)
      if (vLeft) H.x0 = V.x1; else H.x1 = V.x0;
    }
  }

  // ---- appliance clamp: no slab rectangle may overlap a FREESTANDING
  // floor appliance (range / fridge — mountY 0). Worktop-mounted appliances
  // (hob, sink) live IN the top and are untouched. Where a slab's overhang /
  // wall-extension rides over an appliance, trim the slab back so it butts
  // the appliance's side exactly — one clean joint against the range.
  const blocks = [];
  for (const it of items) {
    const cab = getCab(it.code);
    if (!cab || cab.type !== 'APPLIANCES' || (cab.mountY || 0) > 0) continue;
    const horiz = ((it.rotDeg || 0) % 180) === 0;
    const hw = (horiz ? cab.w : cab.d) / 2;
    const hd = (horiz ? cab.d : cab.w) / 2;
    blocks.push({ x0: it.x - hw, x1: it.x + hw, z0: it.z - hd, z1: it.z + hd });
  }
  // SUBTRACT the appliance rectangle (splitting into up to 4 pieces around
  // it) rather than shaving a whole slab edge: a corner-turning slab that
  // clips a range near the corner must only lose the NOTCH that collides —
  // an L-joint against the range's side. The old edge-shave stripped the
  // front inches off the ENTIRE run (the "worktop not deep enough" bug).
  // Cut pieces at overhang-lip thickness are dropped: the 1" lip stops dead
  // at the appliance and resumes on the other side — never across its front.
  let out = slabs;
  if (blocks.length) {
    const LIP = OVERHANG + 0.05;
    out = [];
    for (const s of slabs) {
      let pieces = [s];
      for (const b of blocks) {
        const next = [];
        for (const p of pieces) {
          const ix0 = Math.max(p.x0, b.x0), ix1 = Math.min(p.x1, b.x1);
          const iz0 = Math.max(p.z0, b.z0), iz1 = Math.min(p.z1, b.z1);
          if (ix1 - ix0 <= 0.01 || iz1 - iz0 <= 0.01) { next.push(p); continue; }
          const cand = [
            { ...p, x1: ix0 },                       // left of the appliance
            { ...p, x0: ix1 },                       // right of it
            { ...p, x0: ix0, x1: ix1, z1: iz0 },     // behind it
            { ...p, x0: ix0, x1: ix1, z0: iz1 },     // in front of it
          ];
          for (const c of cand) {
            if (c.x1 - c.x0 <= LIP || c.z1 - c.z0 <= LIP) continue;
            next.push(c);
          }
        }
        pieces = next;
      }
      out.push(...pieces);
    }
  }

  return out.filter((s) => s.x1 - s.x0 > 0.05 && s.z1 - s.z0 > 0.05);
}

// ---- sink cutouts --------------------------------------------------------
// Subtract each sink's basin opening from the slabs so an UNDERMOUNT bowl is
// genuinely recessed — the slab is split into up to four rectangles around
// the hole. Pure rectangle arithmetic; opening sizes mirror the sink model
// in models/appliances.js (cut = footprint − rim allowance).
export function subtractSinkCutouts(slabs, items, getCab) {
  const holes = [];
  for (const it of items || []) {
    const cab = getCab(it.code);
    if (!cab || cab.appliance !== 'sink') continue;
    const { cutW, cutD } = sinkSpec(cab);                // basin opening, local (core/sinkspec.js)
    const th = ((it.rotDeg || 0) * Math.PI) / 180;
    const hx = Math.abs(Math.cos(th)) * cutW / 2 + Math.abs(Math.sin(th)) * cutD / 2;
    const hz = Math.abs(Math.sin(th)) * cutW / 2 + Math.abs(Math.cos(th)) * cutD / 2;
    holes.push({ x0: it.x - hx, x1: it.x + hx, z0: it.z - hz, z1: it.z + hz });
  }
  if (!holes.length) return slabs;
  let rects = slabs;
  for (const h of holes) {
    const next = [];
    for (const s of rects) {
      const ix0 = Math.max(s.x0, h.x0), ix1 = Math.min(s.x1, h.x1);
      const iz0 = Math.max(s.z0, h.z0), iz1 = Math.min(s.z1, h.z1);
      if (ix1 - ix0 <= 0.01 || iz1 - iz0 <= 0.01) { next.push(s); continue; }
      // four pieces around the hole (any zero-width piece is filtered below)
      next.push({ ...s, x1: ix0 });                       // left strip
      next.push({ ...s, x0: ix1 });                       // right strip
      next.push({ ...s, x0: ix0, x1: ix1, z1: iz0 });     // back strip
      next.push({ ...s, x0: ix0, x1: ix1, z0: iz1 });     // front strip
    }
    rects = next;
  }
  return rects.filter((s) => s.x1 - s.x0 > 0.05 && s.z1 - s.z0 > 0.05);
}

// ---- rounded cutout corners ---------------------------------------------------
// The hole above is square-cornered (rectangle arithmetic). A real undermount is
// cut FLUSH to a wide-radius bowl, so each corner of the opening gets a small
// stone fillet: the r x r corner square minus the bowl's quarter circle. Returned
// as world-space polygons [[x, z], ...] in the material of the slab the sink sits
// in; models/worktop.js extrudes them to slab thickness. Pure.
export function sinkCornerFillets(slabs, items, getCab, segments = 8) {
  const out = [];
  for (const it of items || []) {
    const cab = getCab(it.code);
    if (!cab || cab.appliance !== 'sink') continue;
    const slab = (slabs || []).find((s) => it.x > s.x0 && it.x < s.x1 && it.z > s.z0 && it.z < s.z1);
    if (!slab) continue;                                  // no worktop here: nothing to round
    const { cutW, cutD, r } = sinkSpec(cab);
    const th = ((it.rotDeg || 0) * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
    const world = (lx, lz) => [it.x + lx * c + lz * sn, it.z - lx * sn + lz * c];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = sx * cutW / 2, cz = sz * cutD / 2;       // the hole's corner, local
      const pts = [world(cx, cz)];
      // arc centre sits r in from the corner on both axes; sweep the quarter nearest the corner
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * (Math.PI / 2);
        pts.push(world(cx - sx * r * (1 - Math.sin(a)), cz - sz * r * (1 - Math.cos(a))));
      }
      out.push({ mat: slab.mat, alongZ: !!slab.alongZ, pts });
    }
  }
  return out;
}

