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

const OVERHANG = 1.0;   // proud of a door front / island edge
const SEATING = 12;     // breakfast-bar overhang past an island back (300mm)
const CONNECT = 9.6;    // cabinets within this gap (incl. a 9\" max filler) share a slab
const WALL_NEAR = 7;    // a run end this close to a wall extends to it (fills)
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
    const tL = tallFace(x0, -1, 'x', z0, z1, OVERHANG);
    const tR = tallFace(x1, +1, 'x', z0, z1, OVERHANG);
    const tB = tallFace(z0, -1, 'z', x0, x1, OVERHANG);
    const tF = tallFace(z1, +1, 'z', x0, x1, seatOver);
    if (room) {
      const minX = -room.width / 2, maxX = room.width / 2, minZ = -room.depth / 2, maxZ = room.depth / 2;
      x0 = tL != null ? tL : (x0 - minX <= WALL_NEAR) ? minX : x0 - OVERHANG;
      x1 = tR != null ? tR : (maxX - x1 <= WALL_NEAR) ? maxX : x1 + OVERHANG;
      z0 = tB != null ? tB : (z0 - minZ <= WALL_NEAR) ? minZ : z0 - OVERHANG;
      z1 = tF != null ? tF : (maxZ - z1 <= WALL_NEAR) ? maxZ : z1 + seatOver;
    } else {
      x0 = tL != null ? tL : x0 - OVERHANG;
      x1 = tR != null ? tR : x1 + OVERHANG;
      z0 = tB != null ? tB : z0 - OVERHANG;
      z1 = tF != null ? tF : z1 + seatOver;
    }

    // material: most common across the cluster (usually uniform)
    const tally = new Map();
    for (const c of cluster) tally.set(c.mat, (tally.get(c.mat) || 0) + 1);
    const mat = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0] || defaultMat;

    slabs.push({ x0, x1, z0, z1, mat, horiz: cluster[0].horiz });
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
    const cutW = cab.w - 2.4, cutD = cab.d - 4.5;        // basin opening, local
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
