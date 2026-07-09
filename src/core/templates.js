// templates.js — quick-start kitchen layouts + "fill this wall" helper.
//
// Pure data + planning. No DOM, no Three.js. The UI hands us a `place(code,
// wall)` callback (controls.placeNew) and we drive it to build a starting
// point the customer can then edit. Everything stays in the catalogue's real
// inch widths so it tiles cleanly with the run-snapping.

import { getCab } from './catalogue.js';
import { wallFreeSpan } from './layouts.js';

// Each template is an ordered list of {wall, code}. Codes are placed in order
// and append onto the run for that wall, so the sequence == left-to-right.
export const TEMPLATES = [
  {
    id: 'one-wall',
    name: 'One-wall',
    desc: 'Everything along the back wall — tall pantry, range, drawers.',
    steps: [
      { wall: 'back', code: 'T1' },   // tall larder (24)
      { wall: 'back', code: 'F18' },  // 3-drawer base (24)
      { wall: 'back', code: 'AP2' },  // range cooker 36"
      { wall: 'back', code: 'F2' },   // base (24)
      { wall: 'back', code: 'F17' },  // 3-drawer base (20)
    ],
  },
  {
    id: 'l-shape',
    name: 'L-shape',
    desc: 'Back wall + return down the side wall, joined at a corner unit.',
    steps: [
      { wall: 'back', code: 'F16' },  // corner base (24, +20" return)
      { wall: 'back', code: 'F18' },
      { wall: 'back', code: 'AP2' },
      { wall: 'back', code: 'F2' },
      { wall: 'left', code: 'F2' },
      { wall: 'left', code: 'F17' },
      { wall: 'left', code: 'F3' },
    ],
  },
  {
    id: 'u-shape',
    name: 'U-shape',
    desc: 'Three connected runs — corners at both ends, legs down both side walls.',
    steps: [
      { wall: 'back', code: 'F16' },   // left corner (+20" return)
      { wall: 'back', code: 'F18' },
      { wall: 'back', code: 'AP2' },
      { wall: 'back', code: 'F18' },
      { wall: 'back', code: 'F16R' },  // right corner (+20" return)
      { wall: 'left', code: 'F2' },
      { wall: 'left', code: 'F17' },
      { wall: 'right', code: 'F2' },
      { wall: 'right', code: 'F17' },
    ],
  },
  {
    id: 'galley',
    name: 'Galley',
    desc: 'Two facing runs — the cook’s corridor. Working wall + fridge wall.',
    steps: [
      { wall: 'back', code: 'F18' },
      { wall: 'back', code: 'AP2' },
      { wall: 'back', code: 'F2' },
      { wall: 'front', code: 'T1' },
      { wall: 'front', code: 'F18' },
      { wall: 'front', code: 'F2' },
    ],
  },
  {
    id: 'island',
    name: 'Run + island',
    desc: 'A back-wall run plus a free-standing island of drawers.',
    steps: [
      { wall: 'back', code: 'T1' },
      { wall: 'back', code: 'F18' },
      { wall: 'back', code: 'AP2' },
      { wall: 'back', code: 'F2' },
      { wall: 'island', code: 'F20' }, // double 36
      { wall: 'island', code: 'F20' },
    ],
  },
];

export function getTemplate(id) { return TEMPLATES.find((t) => t.id === id); }

/**
 * Apply a template: clears the layout, then places each step.
 * @param {object} store    the planner store (for store.clear / item count)
 * @param {(code:string, wall:string)=>any} place  controls.placeNew
 */
export function applyTemplate(store, place, id) {
  const t = getTemplate(id);
  if (!t) return 0;
  store.clear();
  let n = 0;
  for (const step of t.steps) {
    if (getCab(step.code)) { place(step.code, step.wall); n++; }
  }
  return n;
}

// ----- fill this wall ----------------------------------------------------
// Pack the remaining linear inches with standard single base units (20/24/28),
// choosing the combination that covers the wall as completely as possible so we
// don't leave an awkward gap. Returns an array of cabinet codes.
const FILL_UNITS = [
  { code: 'F3', w: 28 },
  { code: 'F2', w: 24 },
  { code: 'F1', w: 20 },
];
const NARROWEST = 20;

export function planFill(remainingIn) {
  const TOL = 0.5;
  const cap = Math.floor(remainingIn + TOL);
  if (cap < NARROWEST) return [];
  // unbounded subset-sum: reach[s] = how we first hit total width s
  const reach = new Array(cap + 1).fill(null);
  reach[0] = { prev: -1, code: null };
  for (let s = 0; s <= cap; s++) {
    if (!reach[s]) continue;
    for (const u of FILL_UNITS) {
      const ns = s + u.w;
      if (ns <= cap && !reach[ns]) reach[ns] = { prev: s, code: u.code };
    }
  }
  // the largest width we can actually reach (closest fill to the wall)
  let best = -1;
  for (let s = cap; s >= NARROWEST; s--) { if (reach[s]) { best = s; break; } }
  if (best <= 0) return [];
  const codes = [];
  for (let s = best; s > 0; s = reach[s].prev) codes.push(reach[s].code);
  return codes;
}

/**
 * Fill the active wall's remaining length with base units.
 * @param {number} remainingIn  inches of wall left (from the UI's wall-fit calc)
 * @param {(code:string, wall:string)=>any} place
 * @param {string} wall
 * @returns {number} how many cabinets were added
 */
export function fillWall(remainingIn, place, wall) {
  const codes = planFill(remainingIn);
  for (const code of codes) place(code, wall);
  return codes.length;
}

// ----- fill EVERY gap along a wall ----------------------------------------
// "Fill this wall" used to pack only from the end of the run to the far wall;
// this finds each free interval — the gaps BETWEEN wall-line cabinets and the
// two end gaps — and plans base units for every one that's wide enough.
// Anything narrower than a 20" unit is left for the scribe fillers.

const WALL_GAP = 0.25;   // cabinets sit a hair off the wall (matches snapping)
const BASE_D = 24;       // depth of the F1/F2/F3 units we plant
const NEW_ROT = { back: 0, left: 90, front: 180, right: 270 };

/**
 * Plan explicit placements to fill every gap on a wall. PURE — no DOM, no
 * store. Doors are respected on the side/front walls via wallFreeSpan (its
 * span already keeps clear of door swings and the back corner); the back
 * wall just fills wall-to-wall.
 * @param {{room:object, items:Array}} state
 * @param {'back'|'front'|'left'|'right'} wall
 * @returns {Array<{code:string,x:number,z:number,rotDeg:number}>}
 */
export function planWallInfill(state, wall) {
  const r = state.room || {};
  const W = r.width || 144, D = r.depth || 120;
  const minX = -W / 2, maxX = W / 2, minZ = -D / 2, maxZ = D / 2;
  const axis = (wall === 'left' || wall === 'right') ? 'z' : 'x';
  const axisMin = axis === 'x' ? minX : minZ;
  const axisMax = axis === 'x' ? maxX : maxZ;
  const BAND = BASE_D + 1;   // strip off the wall a new base unit would occupy

  // world footprint of an item — rotation-aware, incl. a corner unit's return
  const aabb = (it, c) => {
    const ret = c.corner ? (c.type === 'FLOOR' ? 20 : 10) : 0;
    const lRet = (c.corner && c.cornerSide !== 'right') ? ret : 0;
    const rRet = (c.corner && c.cornerSide === 'right') ? ret : 0;
    const pts = [[-(c.w / 2 + lRet), -c.d / 2], [(c.w / 2 + rRet), -c.d / 2], [(c.w / 2 + rRet), c.d / 2], [-(c.w / 2 + lRet), c.d / 2]];
    const rad = (it.rotDeg || 0) * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [lx, lz] of pts) {
      const wx = lx * cs + lz * sn, wz = -lx * sn + lz * cs;
      x0 = Math.min(x0, it.x + wx); x1 = Math.max(x1, it.x + wx);
      z0 = Math.min(z0, it.z + wz); z1 = Math.max(z1, it.z + wz);
    }
    return { x0, x1, z0, z1 };
  };

  // anything floor-standing that intrudes into the wall strip blocks the run —
  // that covers the wall-line run itself AND a perpendicular run's corner unit
  const occ = [];
  for (const it of (state.items || [])) {
    const c = getCab(it.code);
    if (!c) continue;
    const floorStanding = c.type === 'FLOOR' || c.type === 'TALL' ||
      (c.type === 'APPLIANCES' && (c.mountY || 0) === 0);
    if (!floorStanding) continue;
    const b = aabb(it, c);
    const inBand =
      wall === 'back' ? b.z0 < minZ + BAND :
      wall === 'front' ? b.z1 > maxZ - BAND :
      wall === 'left' ? b.x0 < minX + BAND :
                        b.x1 > maxX - BAND;
    if (!inBand) continue;
    occ.push(axis === 'x' ? [b.x0, b.x1] : [b.z0, b.z1]);
  }
  occ.sort((a, b) => a[0] - b[0]);

  // allowed stretch: whole wall for the back; door-aware span elsewhere
  let lo = axisMin, hi = axisMax;
  if (wall !== 'back') {
    const [a, b] = wallFreeSpan(r, wall);
    lo = axisMin + a; hi = axisMin + b;
  }

  // walk the sorted intervals → free gaps (two ends + every middle gap)
  const gaps = [];
  let cur = lo;
  for (const [a, b] of occ) {
    if (a > cur) gaps.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
    if (cur >= hi) break;
  }
  if (cur < hi) gaps.push([cur, hi]);

  // pack each gap with base units, butted sequentially from the gap start
  const out = [];
  const rotDeg = NEW_ROT[wall] ?? 0;
  for (const [a, b] of gaps) {
    let at = a;
    for (const code of planFill(b - a)) {
      const cab = getCab(code);
      const along = at + cab.w / 2;
      const off = cab.d / 2 + WALL_GAP;   // wall line the back sits on
      const pos =
        wall === 'back' ? { x: along, z: minZ + off } :
        wall === 'front' ? { x: along, z: maxZ - off } :
        wall === 'left' ? { x: minX + off, z: along } :
                          { x: maxX - off, z: along };
      out.push({ code, x: pos.x, z: pos.z, rotDeg });
      at += cab.w;
    }
  }
  return out;
}
