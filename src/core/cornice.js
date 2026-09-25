// cornice.js — plan the cornice (crown molding) run over the kitchen.
//
// Pure geometry, no Three.js. Cornice sits on top of WALL, TALL and COUNTER
// cabinets and runs along their EXPOSED faces only: it skips any face that
// meets a wall or butts straight into another upper cabinet (so a run reads as
// one continuous moulding). The 3D layer renders from these segments and the
// cost uses the total length — one source of truth.

import { getCab } from './catalogue.js';
import { computeFillers } from './fillers.js';
import { MOUNT, WALL_H, TALL_H } from './units.js';

// cabinets that carry cornice, and the world Y of their top edge
const TOP = { WALL: MOUNT.WALL + WALL_H, TALL: TALL_H, COUNTER: MOUNT.COUNTER + 50 };
const QUALIFY = new Set(['WALL', 'TALL', 'COUNTER']);

/** Is world point (px,pz) inside another qualifying cabinet's footprint?
 *  Tolerance is deliberately TIGHT (0.25"): the old 1.5" slop meant the probe
 *  point 1" in front of a narrow tall FILLER also counted as "inside" the
 *  neighbouring tall (laterally within 1.5" of its flank), so the filler's
 *  front face lost its cornice and the crown stopped short of the wall with a
 *  visible gap. The probe reaches 1" out, so genuinely butted faces (0.25"
 *  hair gaps) are still suppressed. */
function insideAnother(px, pz, self, cabs, topY = 0) {
  for (const o of cabs) {
    if (o.it === self) continue;
    // HEIGHT-AWARE: a neighbour only conceals this crown if its own crown
    // line reaches at least as high — a WALL cabinet (84") beside a TALL
    // (86") does NOT hide the tall's crown, which must run back along its
    // exposed flank ABOVE the upper, all the way to the wall.
    if ((o.top ?? TOP[o.cab.type] ?? 0) < topY - 0.01) continue;
    // transform the point into o's local frame
    const th = (o.it.rotDeg || 0) * Math.PI / 180;
    const dx = px - o.it.x, dz = pz - o.it.z;
    const lx = dx * Math.cos(-th) - dz * Math.sin(-th);
    const lz = dx * Math.sin(-th) + dz * Math.cos(-th);
    if (Math.abs(lx) <= o.w / 2 + 0.25 && Math.abs(lz) <= o.d / 2 + 0.25) return true;
  }
  return false;
}

/** A shallower upper (WALL / COUNTER, crown at least as high) butting this
 *  tall's flank on `side`: how far forward it reaches in the tall's own depth
 *  frame (front = +d/2). null when nothing shallower butts that flank. */
function flankReturn(t, side, cabs, topY) {
  const th = (t.it.rotDeg || 0) * Math.PI / 180, s = Math.sin(th), co = Math.cos(th);
  let from = null;
  for (const u of cabs) {
    if (u === t || u.cab.onTall || (u.cab.type !== 'WALL' && u.cab.type !== 'COUNTER')) continue;
    if ((u.top ?? TOP[u.cab.type] ?? 0) < topY - 0.01) continue;
    if (((u.it.rotDeg || 0) % 180) !== ((t.it.rotDeg || 0) % 180)) continue;
    const dx = u.it.x - t.it.x, dz = u.it.z - t.it.z;
    const along = dx * co - dz * s, depth = dx * s + dz * co;           // tall-local width / depth
    if (Math.sign(along) !== side || Math.abs(along) - (t.w + u.w) / 2 > 2.5) continue;
    const front = depth + u.d / 2;
    if (front < t.d / 2 - 1) from = Math.max(from ?? -Infinity, front);
  }
  return from == null ? null : { from };
}

/**
 * @returns {{segments: Array, totalIn: number, profile: string}}
 * each segment: { x, z, topY, angle, length } — angle is the Y-rotation so the
 * strip runs along +X and protrudes +Z (outward).
 */
export function planCornice(state) {
  const profile = state.room?.cornice || 'none';
  if (profile === 'none') return { segments: [], totalIn: 0, profile };

  const r = state.room;
  const minX = -r.width / 2, maxX = r.width / 2, minZ = -r.depth / 2, maxZ = r.depth / 2;

  // each cabinet's crown line: its type's top, or for a STACKER its own top (mountY + h).
  // A host with a stacker standing on it carries no crown of its own: the stacker does.
  // a cabinet's own top, not its type's nominal one: a full-height upper (45 / 51") tops at 101 / 107
  const topOf = (cab) => (cab.type === 'TALL' ? cab.h : (cab.mountY ?? MOUNT[cab.type] ?? 0) + cab.h);
  // for the crown, a stacker standing on a tall IS the top of that tall column: 24" deep, proud of
  // the uppers, so its flank returns like a tall's (her screenshot 2026-09-22: "cornice doesn't return")
  const kind = (c) => (c.cab.type === 'TALL' || c.cab.onTall || c.hood ? 'TALL' : c.cab.type);
  const rotOf = (it) => (((it.rotDeg || 0) % 360) + 360) % 360;
  const all = (state.items || []).map((it) => ({ it, cab: getCab(it.code) })).filter((x) => x.cab && QUALIFY.has(x.cab.type));
  const stackedOver = (x) => all.some((o) => o.cab.stacker && rotOf(o.it) === rotOf(x.it) && Math.abs((rotOf(x.it) % 180 === 0 ? o.it.x - x.it.x : o.it.z - x.it.z)) < 1 && Math.abs((o.cab.mountY || 0) - TOP[x.cab.type]) < 1);
  const cabs = [];
  for (const { it, cab } of all) {
    if (!cab.stacker && stackedOver({ it, cab })) continue;
    cabs.push({ it, cab, w: cab.w, d: cab.d, top: topOf(cab) });
  }
  // a PLASTER HOOD (AP26-28) is a solid plaster box from the 800mm line to the ceiling: an upper
  // beside it butts its flank and the crown DIES INTO that flank exactly as at a tall (her rule
  // 2026-09-25: "wall cabinets sit right up against it and the cornice runs into the side"). It
  // carries no crown of its own and needs no connector board: it is plaster to the ceiling.
  for (const it of state.items || []) {
    const cab = getCab(it.code);
    if (cab && cab.plaster && cab.appliance === 'hood') cabs.push({ it, cab, w: cab.w, d: cab.d, hood: true, top: (r.height || 96) });
  }
  // RULE: a scribe filler that reaches the top of its run carries the cornice too — the
  // moulding runs OVER the filler to the wall, never stopping short at the cabinet edge.
  // A tall's filler, an upper's filler (at the upper's height) and a counter cabinet's.
  const FILLER_TYPE = { floor: 'TALL', upper: 'WALL', counter: 'COUNTER', stacker: 'WALL' };
  const fillers = computeFillers(state);
  // a filler with a stacker's filler standing on it carries no crown: the one on top does
  const coveredBy = (f) => fillers.some((g) => g.band === 'stacker' && Math.abs(g.x - f.x) < 1 && Math.abs(g.z - f.z) < 1 && Math.abs((g.y0 || 0) - ((f.y0 || 0) + f.h)) < 1);
  for (const f of fillers) {
    if (f.band === 'floor' && (f.h || 0) < 80) continue;            // a base-height filler carries nothing
    if (coveredBy(f)) continue;
    // the filler's crown line is ITS top: beside a full-height upper that is 107", beside a stacker the stacker's top
    cabs.push({ it: { x: f.x, z: f.z, rotDeg: f.rotDeg || 0 }, cab: { type: FILLER_TYPE[f.band] || 'TALL' }, w: f.w, d: f.d, filler: true, top: f.band === 'floor' ? TOP.TALL : (f.y0 || 0) + f.h });
  }

  const segments = [];
  const corners = [];
  let totalIn = 0;
  const WALL_TOL = 3; // a face this close to a room boundary counts as "against the wall"

  // an UPPER within reach of a TALL's flank: its crown EXTENDS across the gap
  // to die into the tall's side (real joinery — never a floating return with
  // daylight behind it). reach[±1] = gap to a tall on that width side, or null.
  const tallReach = (c) => {
    const out = { [-1]: null, [1]: null };
    if (kind(c) !== 'WALL' && kind(c) !== 'COUNTER') return out;
    // in the CABINET'S OWN frame (+1 = its local +X = face 2): comparing world x or z picked the
    // wrong flank on the left and front walls, so the return went missing at the open end and
    // the crown butted nothing at the tall (her screenshot 2026-09-25: "why didn't the cornice return")
    const th = (c.it.rotDeg || 0) * Math.PI / 180, s = Math.sin(th), co = Math.cos(th);
    for (const t of cabs) {
      if (kind(t) !== 'TALL') continue;
      if (((t.it.rotDeg || 0) % 180) !== ((c.it.rotDeg || 0) % 180)) continue;
      const dx = t.it.x - c.it.x, dz = t.it.z - c.it.z;
      const along = dx * co - dz * s, depth = dx * s + dz * co;
      if (Math.abs(depth) > 14) continue;                                    // same run
      const gap = Math.abs(along) - ((t.w || t.cab.w) + c.w) / 2;
      if (gap >= -2 && gap <= 2.5) out[along > 0 ? 1 : -1] = Math.max(0, gap);
    }
    return out;
  };

  for (const c of cabs) {
    if (c.hood) continue;                              // plaster to the ceiling: no crown on it
    const th = (c.it.rotDeg || 0) * Math.PI / 180;
    const s = Math.sin(th), co = Math.cos(th);
    const topY = c.top ?? TOP[c.cab.type];
    const reach = tallReach(c);
    // front strip grows across any tall gap; the side return on a tall side
    // is suppressed (the crown butts the tall's flank instead)
    const growL = reach[-1] != null ? reach[-1] : 0;
    const growR = reach[1] != null ? reach[1] : 0;
    // four faces: front, back, right(+widthAxis), left(-widthAxis)
    const faces = [
      { ox: s, oz: co, half: c.d / 2, len: c.w + growL + growR, slide: (growR - growL) / 2 },  // 0 front (+localZ)
      { ox: -s, oz: -co, half: c.d / 2, len: c.w },    // 1 back
      { ox: co, oz: -s, half: c.w / 2, len: c.d, tall: reach[1] != null },     // 2 right (+localX)
      { ox: -co, oz: s, half: c.w / 2, len: c.d, tall: reach[-1] != null },    // 3 left
    ];
    const exposed = [false, false, false, false];
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      if (f.tall) continue;                            // crown butts the tall flank — no return
      const wx = co, wz = -s;                          // width axis (for the front slide)
      const cx = c.it.x + f.ox * f.half + (f.slide ? wx * f.slide : 0);
      const cz = c.it.z + f.oz * f.half + (f.slide ? wz * f.slide : 0);
      const onWall =
        (f.ox < -0.5 && cx <= minX + WALL_TOL) || (f.ox > 0.5 && cx >= maxX - WALL_TOL) ||
        (f.oz < -0.5 && cz <= minZ + WALL_TOL) || (f.oz > 0.5 && cz >= maxZ - WALL_TOL);
      if (onWall) continue;
      if (insideAnother(cx + f.ox * 1.0, cz + f.oz * 1.0, c.it, cabs, topY)) {
        // LEVEL TOPS (wall cabinets now top out with the talls at 86"): a TALL's
        // flank is only hidden as far forward as the 14"-deep upper butting
        // it. The crown returns along the rest — from the tall's proud face
        // back to where the upper's crown dies into it — and mitres the corner.
        const ret = i >= 2 && kind(c) === 'TALL' && !c.filler ? flankReturn(c, i === 2 ? 1 : -1, cabs, topY) : null;
        if (ret) {
          const fx = s, fz = co, mid = (ret.from + c.d / 2) / 2, len = c.d / 2 - ret.from;
          exposed[i] = true;
          segments.push({ x: c.it.x + f.ox * f.half + fx * mid, z: c.it.z + f.oz * f.half + fz * mid, topY, angle: Math.atan2(f.ox, f.oz), length: len });
          totalIn += len;
        }
        continue;
      }
      exposed[i] = true;
      segments.push({ x: cx, z: cz, topY, angle: Math.atan2(f.ox, f.oz), length: f.len });
      totalIn += f.len;
    }

    // external corners: where two adjacent exposed faces meet, add a mitre
    // return so the moulding wraps the corner instead of leaving a gap.
    // pairs: [frontOrBack, side, signWidth, signDepth]
    const pairs = [[0, 2, 1, 1], [0, 3, -1, 1], [1, 2, 1, -1], [1, 3, -1, -1]];
    for (const [fi, si, sx, sz] of pairs) {
      if (!exposed[fi] || !exposed[si]) continue;
      // cabinet outer corner in world (width axis = (co,-s), depth axis = (s,co))
      const wx = co, wz = -s;       // +width
      const fx = s, fz = co;        // +depth/front
      const x = c.it.x + wx * (sx * c.w / 2) + fx * (sz * c.d / 2);
      const z = c.it.z + wz * (sx * c.w / 2) + fz * (sz * c.d / 2);
      // sx/sz are the local width/depth signs of this corner; the layer extrudes
      // the profile outward along them to wrap the corner.
      corners.push({ x, z, topY, angle: th, sx, sz });
    }
  }
  // RULE: where a WALL or COUNTER cabinet butts against a TALL, the cornice
  // runs DOWN the tall's side to connect the two levels — a vertical connector
  // board on the tall's flank, from the upper's cornice line up to the tall's.
  const drops = [];
  const talls = cabs.filter((c) => kind(c) === 'TALL' && !c.filler && !c.hood);
  const uppers = cabs.filter((c) => (c.cab.type === 'WALL' || c.cab.type === 'COUNTER') && !c.cab.onTall);
  for (const t of talls) {
    for (const u of uppers) {
      if (((t.it.rotDeg || 0) % 180) !== ((u.it.rotDeg || 0) % 180)) continue;
      const th = (t.it.rotDeg || 0) * Math.PI / 180;
      const fx = Math.sin(th), fz = Math.cos(th);        // front dir
      const wx = Math.cos(th), wz = -Math.sin(th);       // width dir
      // the tall's OWN frame (see tallReach): world x/z put the board on the wrong flank on side walls
      const along = (u.it.x - t.it.x) * wx + (u.it.z - t.it.z) * wz, depth = (u.it.x - t.it.x) * fx + (u.it.z - t.it.z) * fz;
      const gap = Math.abs(along) - (t.w + u.w) / 2;
      if (gap > 2.5 || gap < -2) continue;               // must be butted side-by-side
      if (Math.abs(depth) > 14) continue;                // same run
      const tTop = t.top ?? TOP.TALL, uTop = u.top ?? TOP[u.cab.type];
      if (tTop - uTop < 0.25) continue;   // tops level (or the upper higher): one crown line, nothing to connect
      const side = along > 0 ? 1 : -1;                   // which flank of the tall
      // the connector runs from the ROOM WALL (talls stand 30mm proud — their
      // back is NOT on the wall) forward to just proud of the upper's face:
      // extend BACK by the tall's wall gap or the board floats off the wall
      const bx = t.it.x - fx * (t.d / 2), bz = t.it.z - fz * (t.d / 2);
      const backGap = Math.max(0, Math.min(4,
        fx > 0.5 ? bx - minX : fx < -0.5 ? maxX - bx : fz > 0.5 ? bz - minZ : maxZ - bz));
      const len = backGap + u.d + 1.4;                   // wall → just proud of the upper's face
      const x = t.it.x + wx * side * (t.w / 2) + fx * (len / 2 - t.d / 2 - backGap);
      const z = t.it.z + wz * side * (t.w / 2) + fz * (len / 2 - t.d / 2 - backGap);
      drops.push({
        x, z, len,
        y0: uTop, y1: tTop,                              // connect upper level → tall level
        angle: Math.atan2(wx * side, wz * side),         // protrudes out of the flank
      });
      totalIn += len;                                    // priced like any moulding run
    }
  }
  return { segments, corners, drops, totalIn, profile };
}
