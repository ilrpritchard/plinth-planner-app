// rowlayout.js — PURE. A unit type's manual cabinet list, stood along the walls
// so "Lay out this unit in 3D" opens on THOSE cabinets, not an empty room (her
// report 2026-09-18: "if I add 2 cabinets to the list then click lay out this
// unit in 3D it doesn't put those 2 cabinets in the 3D picture").
//
// It is a STARTING arrangement, not a design: everything is packed left to right
// so nothing overlaps (hard rule 1), doors are kept clear, talls / uppers never
// cover a window (rule 2), stackers land on a host of their width. The order is
// the fitter's: talls at the left end (or after a blank-left corner unit), then
// the base run in list order; uppers above the base run, clear of the talls.
// What will not fit the back wall carries on down the left wall, then the right.
// Anything that fits nowhere is returned in `unplaced` so the UI can say so:
// Done re-derives the list FROM the layout, and a silent drop would lose it.

import { getCab } from './catalogue.js';
import { mmToIn } from './units.js';
import { openingCenter, openingWidth } from './openings.js';

const WALL_GAP = 0.25;
const TALL_PROUD = mmToIn(30);       // interaction/snapping.js TALL_PROUD
const CORNER_OUT = 24.25;            // a side run starts clear of the back run's depth (hard rule 4)
const MAX_ITEMS = 80;
const ROT = { back: 0, left: 90, right: 270 };

/** @returns {{placements:Array<{code,x,z,rotDeg}>, unplaced:Array<{code,qty}>}} */
export function planRowsLayout(rows, room) {
  const W = room?.width || 144, D = room?.depth || 120;
  const minX = -W / 2, maxX = W / 2, minZ = -D / 2, maxZ = D / 2;

  // ---- the list, expanded, in the order it will be stood ----
  const cabs = [];
  for (const r of rows || []) {
    const c = getCab(r && r.code);
    if (!c || !c.placeable || c.notSupplied) continue;
    for (let i = 0; i < Math.min(Number(r.qty) || 0, MAX_ITEMS) && cabs.length < MAX_ITEMS; i++) cabs.push(c);
  }
  const cornerL = cabs.filter((c) => c.type === 'FLOOR' && c.corner && c.cornerSide !== 'right');
  const cornerR = cabs.filter((c) => c.type === 'FLOOR' && c.corner && c.cornerSide === 'right');
  const talls = cabs.filter((c) => c.type === 'TALL');
  const floors = cabs.filter((c) => c.type === 'FLOOR' && !c.corner);
  const counters = cabs.filter((c) => c.type === 'COUNTER');
  const uppers = cabs.filter((c) => (c.type === 'WALL' && !c.stacker) || c.type === 'SHELF');
  const stackers = cabs.filter((c) => c.stacker);
  const lead = cornerL.slice(0, 1);
  // a blank-LEFT corner leads the run (its return reaches back into the left corner);
  // blank-RIGHT corners close it, so their return faces what is left of the wall
  const floorLine = lead.length
    ? [...lead, ...floors, ...cornerL.slice(1), ...cornerR, ...talls]
    : [...talls, ...floors, ...cornerR];

  // ---- walls: usable range along each, and what blocks it ----
  const walls = {
    back: { lo: minX, hi: maxX },
    left: { lo: minZ + CORNER_OUT + 0.05, hi: maxZ },
    right: { lo: minZ + CORNER_OUT + 0.05, hi: maxZ },
  };
  const blocked = { back: { all: [], upper: [] }, left: { all: [], upper: [] }, right: { all: [], upper: [] } };
  for (const o of room?.openings || []) {
    const wl = o.wall || 'back';
    if (!blocked[wl]) continue;
    const c = openingCenter(room, o), hw = openingWidth(o, room) / 2;
    if (o.type === 'window') blocked[wl].upper.push([c - hw - 1, c + hw + 1]);      // glass: only tall / hung things cover it
    else blocked[wl].all.push([c - hw - 3, c + hw + 3]);                            // a door: nothing stands across it
  }
  const placed = [];                     // { cab, wall, along, lo, hi, stacked }
  const occ = { floor: { back: [], left: [], right: [] }, upper: { back: [], left: [], right: [] } };

  // A side run starts clear of whatever already stands in that back corner. Usually
  // that is the back run's 24.25", but a TALL stands 30mm proud and a stacker on it
  // deeper still: measure what is really there, within the depth this cabinet takes.
  const front = (cab) => cab.d + WALL_GAP + (cab.type === 'TALL' ? TALL_PROUD : 0);
  const cornerClear = (wall, cab) => {
    let reach = CORNER_OUT;
    for (const h of placed) {
      if (h.wall !== 'back') continue;
      const inBand = wall === 'left' ? h.lo < minX + front(cab) : h.hi > maxX - front(cab);
      if (inBand) reach = Math.max(reach, front(h.cab));
    }
    return minZ + reach + 0.05;
  };
  // ...and the other way round: a back-wall cabinet placed AFTER a side run (a tall
  // goes last behind a lead corner unit) stops short of that run when it is deep
  // enough to reach it.
  const backRange = (cab) => {
    let lo = walls.back.lo, hi = walls.back.hi;
    for (const h of placed) {
      if (h.wall === 'back' || minZ + front(cab) <= h.lo + 0.01) continue;
      if (h.wall === 'left') lo = Math.max(lo, minX + front(h.cab) + 0.05); else hi = Math.min(hi, maxX - front(h.cab) - 0.05);
    }
    return [lo, hi];
  };
  const firstGap = (wall, need, taken, cab) => {
    const [lo, hi] = wall === 'back' ? backRange(cab) : [cornerClear(wall, cab), walls[wall].hi];
    const solid = taken.filter(([a, b]) => b > lo && a < hi).sort((p, q) => p[0] - q[0]);
    let cur = lo;
    for (const [a, b] of solid) { if (a - cur >= need - 1e-6) return cur; cur = Math.max(cur, b); }
    return hi - cur >= need - 1e-6 ? cur : null;
  };
  const posOn = (wall, along, cab) => {
    const off = cab.d / 2 + WALL_GAP + (cab.type === 'TALL' ? TALL_PROUD : 0);
    return wall === 'back' ? { x: along, z: minZ + off } : wall === 'left' ? { x: minX + off, z: along } : { x: maxX - off, z: along };
  };

  const placements = [], lost = new Map();
  const miss = (c) => lost.set(c.code, (lost.get(c.code) || 0) + 1);
  const stand = (cab, line) => {
    const upperish = line === 'upper' || cab.type === 'TALL';
    // a corner unit's blank return reaches back to the wall it turns from
    const ret = cab.corner ? (cab.type === 'FLOOR' ? CORNER_OUT : 12) : 0;
    const retLeft = cab.corner && cab.cornerSide !== 'right', need = cab.w + ret;
    for (const wall of ['back', 'left', 'right']) {
      const taken = [...blocked[wall].all, ...(upperish ? blocked[wall].upper : []), ...occ[line][wall],
        // hung things never overlap a tall, and a tall never stands under a hung thing
        ...(line === 'upper' ? occ.floor[wall].filter((s) => s.tall) : cab.type === 'TALL' ? occ.upper[wall] : [])];
      const at = firstGap(wall, need, taken, cab);
      if (at == null) continue;
      // which END of the span the return takes: local -x is the low end on the back and
      // right walls, the HIGH end on the left wall (rot 90 runs local +x toward -z)
      const retLow = wall === 'left' ? !retLeft : retLeft;
      const body0 = at + (cab.corner && retLow ? ret : 0), centre = body0 + cab.w / 2;
      const span = [at, at + need]; if (cab.type === 'TALL') span.tall = true;
      occ[line][wall].push(span);
      const p = { code: cab.code, ...posOn(wall, centre, cab), rotDeg: ROT[wall] };
      placements.push(p); placed.push({ cab, wall, along: centre, lo: at, hi: at + need, stacked: false });
      return true;
    }
    miss(cab); return false;
  };

  for (const c of floorLine) stand(c, 'floor');
  for (const c of [...counters, ...uppers]) stand(c, 'upper');

  // ---- stackers sit on a host of their own width, one each ----
  for (const s of stackers) {
    const hostType = s.mountY === 86 ? 'TALL' : s.mountY === 84 ? 'WALL' : 'COUNTER';
    const host = placed.find((h) => !h.stacked && h.cab.type === hostType && !h.cab.corner && Math.abs(h.cab.w - s.w) < 0.5);
    if (!host) { miss(s); continue; }
    host.stacked = true;
    placements.push({ code: s.code, ...posOn(host.wall, host.along, s), rotDeg: ROT[host.wall] });
  }

  return { placements, unplaced: [...lost].map(([code, qty]) => ({ code, qty })) };
}
