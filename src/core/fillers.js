// fillers.js — auto-detect a gap between a run and a perpendicular wall and describe a
// painted filler panel to close it. Pure logic (no Three.js).
//
// A filler is only added when the run's end sits CLOSE to a wall (a small leftover gap);
// a large gap is open space, not a filler. Runs are worked out in BANDS, each at its own
// height: the floor band (bases and talls, from the floor), the upper band (wall cabinets,
// from their hanging height) and the counter band (counter cabinets, from the worktop), so a
// wall cabinet that stops 3" short of the wall gets its own scribe up at that height (her
// ask 2026-09-22: "when there is a gap by wall cabinets, auto do a scribe here too").
// Each filler carries y0 (where it starts) and h.

import { getCab } from './catalogue.js';
import { MOUNT } from './units.js';
import { boxAt } from './placement.js';

const MIN_GAP = 0.5;   // ignore hairline gaps
const MAX_GAP = 9;     // close residual end gaps (a run reaches within ~8" of the
                       // wall) with a painted filler, so cabinets read wall-to-wall
const WALL_GAP = 0.25; // cabinets sit this far off the wall (matches snapping)
const RUN_TOL = 10;    // how close to the wall line counts as "on this wall"

// the bands: which cabinets, and where their scribe starts
const BANDS = [
  { name: 'floor', has: (cab) => cab.type === 'FLOOR' || cab.type === 'TALL', y0: () => 0 },
  { name: 'upper', has: (cab) => cab.type === 'WALL' && !cab.stacker, y0: (cab) => cab.mountY ?? MOUNT.WALL },
  { name: 'counter', has: (cab) => cab.type === 'COUNTER', y0: () => MOUNT.COUNTER },
  // a stacker's scribe continues the one below it up to the stacker's top (her: "stackers need to mimic the scribe")
  { name: 'stacker', has: (cab) => !!cab.stacker, y0: (cab) => cab.mountY || 0 },
];

/** Returns filler descriptors: { x, z, rotDeg, w, d, h }. Each filler matches
 *  the height + depth of the cabinet at that end of the run, so a tall unit
 *  gets a full-height painted scribe, a base unit a 35" one. */
export function computeFillers(state) {
  const out = [];
  for (const band of BANDS) bandFillers(state, band, out);
  return out;
}

function bandFillers(state, band, out) {
  const r = state.room;
  const minX = -r.width / 2, maxX = r.width / 2, minZ = -r.depth / 2, maxZ = r.depth / 2;

  const onWall = (wall) => state.items
    .map((it) => ({ it, cab: getCab(it.code) }))
    .filter(({ it, cab }) => {
      if (!cab || !band.has(cab)) return false;
      const horiz = ((it.rotDeg || 0) % 180) === 0;
      if (wall === 'back') return horiz && Math.abs(it.z - (minZ + cab.d / 2 + WALL_GAP)) < RUN_TOL;
      if (wall === 'front') return horiz && Math.abs(it.z - (maxZ - cab.d / 2 - WALL_GAP)) < RUN_TOL;
      if (wall === 'right') return !horiz && Math.abs(it.x - (maxX - cab.d / 2 - WALL_GAP)) < RUN_TOL;
      return !horiz && Math.abs(it.x - (minX + cab.d / 2 + WALL_GAP)) < RUN_TOL; // left
    });

  // A run's end scribes to the WALL, or, where a run on the adjoining wall owns the corner, to
  // the FLANK of that run's corner cabinet (her screenshot 2026-09-22: a base stopping a few
  // inches short of the tall standing in the corner on the side wall, "fill it with a scribe").
  // The flank is taken by cabinets in this band's height: a tall meets every band, a base only
  // the floor band, an upper only the upper band.
  const flankOf = (c) => c.type === 'TALL' || band.has(c);
  const cornerEdge = (wall, side) => {                    // world coordinate of the flank this run's end meets
    let edge = wall === 'back' || wall === 'front' ? (side < 0 ? minX : maxX) : (side < 0 ? minZ : maxZ);
    for (const it of state.items) {
      const cab = getCab(it.code); if (!cab || !cab.placeable || !flankOf(cab)) continue;
      const horiz = ((it.rotDeg || 0) % 180) === 0;
      if ((wall === 'back' || wall === 'front') === horiz) continue;   // only the PERPENDICULAR walls
      const b = boxAt(cab, it.x, it.z, it.rotDeg);
      if (wall === 'back' || wall === 'front') {
        const onSide = side < 0 ? Math.abs(b.x0 - minX) < RUN_TOL : Math.abs(b.x1 - maxX) < RUN_TOL;
        const reaches = wall === 'back' ? b.z0 - minZ < 26 : maxZ - b.z1 < 26;         // its span reaches this corner
        if (onSide && reaches) edge = side < 0 ? Math.max(edge, b.x1) : Math.min(edge, b.x0);
      } else {
        const onSide = side < 0 ? Math.abs(b.z0 - minZ) < RUN_TOL : Math.abs(b.z1 - maxZ) < RUN_TOL;
        const reaches = wall === 'left' ? b.x0 - minX < 26 : maxX - b.x1 < 26;
        if (onSide && reaches) edge = side < 0 ? Math.max(edge, b.z1) : Math.min(edge, b.z0);
      }
    }
    return edge;
  };

  // back / front walls — runs along X; ends scribe to the left/right side
  // walls (or the flank in the corner), and MID-RUN gaps between neighbours get a filler too
  for (const wall of ['back', 'front']) {
    const run = onWall(wall);
    if (!run.length) continue;
    const sorted = [...run].sort((a, b) => (a.it.x - a.cab.w / 2) - (b.it.x - b.cab.w / 2));
    const L = sorted[0], R = sorted[sorted.length - 1];
    const rot = wall === 'front' ? 180 : 0;
    const eL = cornerEdge(wall, -1), eR = cornerEdge(wall, +1);
    addEnd(out, (L.it.x - L.cab.w / 2) - eL, (g) => ({ x: eL + g / 2, z: L.it.z, rotDeg: rot, w: g, d: L.cab.d, h: L.cab.h, y0: band.y0(L.cab), band: band.name }));
    addEnd(out, eR - (R.it.x + R.cab.w / 2), (g) => ({ x: eR - g / 2, z: R.it.z, rotDeg: rot, w: g, d: R.cab.d, h: R.cab.h, y0: band.y0(R.cab), band: band.name }));
    for (let i = 0; i < sorted.length - 1; i++) {
      const A = sorted[i], B = sorted[i + 1];
      const a1 = A.it.x + A.cab.w / 2, b0 = B.it.x - B.cab.w / 2;
      const T = A.cab.h <= B.cab.h ? A : B;      // match the shorter (base) neighbour
      addEnd(out, b0 - a1, (g) => ({ x: a1 + g / 2, z: T.it.z, rotDeg: rot, w: g, d: T.cab.d, h: T.cab.h, y0: band.y0(T.cab), band: band.name }));
    }
  }

  // left / right walls — runs along Z; ends scribe to the back/front walls,
  // and mid-run gaps between neighbours get a filler too
  for (const wall of ['left', 'right']) {
    const run = onWall(wall);
    if (!run.length) continue;
    const sorted = [...run].sort((a, b) => (a.it.z - a.cab.w / 2) - (b.it.z - b.cab.w / 2));
    const L = sorted[0], R = sorted[sorted.length - 1];
    const rot = wall === 'right' ? 270 : 90;
    const eL = cornerEdge(wall, -1), eR = cornerEdge(wall, +1);
    addEnd(out, (L.it.z - L.cab.w / 2) - eL, (g) => ({ x: L.it.x, z: eL + g / 2, rotDeg: rot, w: g, d: L.cab.d, h: L.cab.h, y0: band.y0(L.cab), band: band.name }));
    addEnd(out, eR - (R.it.z + R.cab.w / 2), (g) => ({ x: R.it.x, z: eR - g / 2, rotDeg: rot, w: g, d: R.cab.d, h: R.cab.h, y0: band.y0(R.cab), band: band.name }));
    for (let i = 0; i < sorted.length - 1; i++) {
      const A = sorted[i], B = sorted[i + 1];
      const a1 = A.it.z + A.cab.w / 2, b0 = B.it.z - B.cab.w / 2;
      const T = A.cab.h <= B.cab.h ? A : B;
      addEnd(out, b0 - a1, (g) => ({ x: T.it.x, z: a1 + g / 2, rotDeg: rot, w: g, d: T.cab.d, h: T.cab.h, y0: band.y0(T.cab), band: band.name }));
    }
  }
}

function addEnd(out, gap, make) {
  if (gap > MIN_GAP && gap <= MAX_GAP) out.push(make(gap));
}
