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
import { openingCenter, openingWidth, boxingBoxes } from './openings.js';

const WALL_GAP = 0.25;
const TALL_PROUD = mmToIn(30);       // interaction/snapping.js TALL_PROUD
const CORNER_OUT = 24.25;            // a side run starts clear of the back run's depth (hard rule 4)
const MAX_ITEMS = 80;
const ROT = { back: 0, left: 90, right: 270 };

/** Rows on a unit's list that its drawn layout does not hold yet (a cabinet
 *  added to the list AFTER the unit was laid out): [{ code, qty }] still to stand. */
export function rowsNotInDesign(rows, items) {
  const have = new Map();
  for (const it of items || []) have.set(it.code, (have.get(it.code) || 0) + 1);
  const out = [];
  for (const r of rows || []) {
    const c = getCab(r && r.code);
    if (!c || !c.placeable || c.notSupplied) continue;
    const need = (Number(r.qty) || 0) - (have.get(c.code) || 0);
    if (need > 0) out.push({ code: c.code, qty: need });
  }
  return out;
}

/** `existing` = items already standing in the room: they hold their wall space,
 *  so new cabinets are stood in the gaps beside them, never on top.
 *  @returns {{placements:Array<{code,x,z,rotDeg}>, unplaced:Array<{code,qty}>}} */
export function planRowsLayout(rows, room, existing = []) {
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
  // Corner units are stood AT a room corner, leg to leg with a run on the adjoining
  // wall (hard rule 4), see "corners" below. Only one of each hand can be anchored;
  // a second one of the same hand just joins the run.
  const spareCorners = [...cornerL.slice(1), ...cornerR.slice(1)];

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
  // a boxing (bulkhead) is SOLID on its wall, at any height, and its depth reaches into the
  // adjoining run's corner exactly as a placed cabinet's would (her draft 2026-09-22 stood a
  // range in one)
  for (const bx of boxingBoxes(room)) {
    if (!blocked[bx.wall]) continue;
    blocked[bx.wall].all.push([bx.along0 - 0.3, bx.along1 + 0.3]);
  }
  const placed = [];                     // { cab, wall, along, lo, hi, stacked }
  for (const bx of boxingBoxes(room)) {
    if (!walls[bx.wall]) continue;
    placed.push({ cab: { type: 'BOXING', w: bx.w, d: bx.d - WALL_GAP, h: bx.h, corner: false }, wall: bx.wall, along: (bx.along0 + bx.along1) / 2, lo: bx.along0, hi: bx.along1, stacked: true, boxing: true });
  }
  const occ = { floor: { back: [], left: [], right: [] }, upper: { back: [], left: [], right: [] } };

  // A side run starts clear of whatever already stands in that back corner. Usually
  // that is the back run's 24.25", but a TALL stands 30mm proud and a stacker on it
  // deeper still: measure what is really there, within the depth this cabinet takes.
  const front = (cab) => cab.d + WALL_GAP + (cab.type === 'TALL' || cab.onTall ? TALL_PROUD : 0);
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
    const off = cab.d / 2 + WALL_GAP + (cab.type === 'TALL' || cab.onTall ? TALL_PROUD : 0);
    return wall === 'back' ? { x: along, z: minZ + off } : wall === 'left' ? { x: minX + off, z: along } : { x: maxX - off, z: along };
  };

  // what already stands against a wall keeps its span (and clears the corners
  // exactly like a freshly stood cabinet would)
  for (const it of existing || []) {
    const c = getCab(it && it.code);
    if (!c || !c.placeable || it.island) continue;
    if (c.type === 'APPLIANCES' && !['range', 'fridge', 'hood'].includes(c.appliance)) continue;   // sinks / cooktops ride in a base
    const rot = ((((it.rotDeg || 0) % 360) + 360) % 360);
    const wall = rot === 0 ? 'back' : rot === 90 ? 'left' : rot === 270 ? 'right' : null;
    if (!wall) continue;
    const gap = wall === 'back' ? (it.z - c.d / 2) - minZ : wall === 'left' ? (it.x - c.d / 2) - minX : maxX - (it.x + c.d / 2);
    if (gap > 12) continue;                                        // not against that wall
    const along = wall === 'back' ? it.x : it.z;
    const ret = c.corner ? (c.type === 'FLOOR' ? CORNER_OUT : 12) : 0, retLeft = c.corner && c.cornerSide !== 'right';
    const retLow = wall === 'left' ? !retLeft : retLeft;
    const lo = along - c.w / 2 - (ret && retLow ? ret : 0), hi = along + c.w / 2 + (ret && !retLow ? ret : 0);
    const hung = c.type === 'WALL' || c.type === 'COUNTER' || c.type === 'SHELF' || c.appliance === 'hood';
    const span = [lo, hi]; if (c.type === 'TALL') span.tall = true;
    occ[hung ? 'upper' : 'floor'][wall].push(span);
    placed.push({ cab: c, wall, along, lo, hi, stacked: true });    // never offered as a stacker host: it may carry one already
  }

  const placements = [], lost = new Map();
  const miss = (c) => lost.set(c.code, (lost.get(c.code) || 0) + 1);
  const takenOn = (wall, line, cab) => {
    const upperish = line === 'upper' || cab.type === 'TALL';
    return [...blocked[wall].all, ...(upperish ? blocked[wall].upper : []), ...occ[line][wall],
      // hung things never overlap a tall, and a tall never stands under a hung thing
      ...(line === 'upper' ? occ.floor[wall].filter((s) => s.tall) : cab.type === 'TALL' ? occ.upper[wall] : [])];
  };
  const lastGap = (wall, need, taken, cab) => {                 // firstGap, mirrored: pack against the HIGH end
    const [lo, hi] = wall === 'back' ? backRange(cab) : [cornerClear(wall, cab), walls[wall].hi];
    const solid = taken.filter(([a, b]) => b > lo && a < hi).sort((p, q) => q[1] - p[1]);
    let cur = hi;
    for (const [a, b] of solid) { if (cur - b >= need - 1e-6) return cur - need; cur = Math.min(cur, a); }
    return cur - lo >= need - 1e-6 ? cur - need : null;
  };
  // a corner unit's blank return reaches back to the wall it turns from
  const retOf = (cab) => (cab.corner ? (cab.type === 'FLOOR' ? CORNER_OUT : 12) : 0);
  const putAt = (cab, line, wall, at) => {
    const ret = retOf(cab), need = cab.w + ret, retLeft = cab.corner && cab.cornerSide !== 'right';
    // which END of the span the return takes: local -x is the low end on the back and
    // right walls, the HIGH end on the left wall (rot 90 runs local +x toward -z)
    const retLow = wall === 'left' ? !retLeft : retLeft;
    const body0 = at + (cab.corner && retLow ? ret : 0), centre = body0 + cab.w / 2;
    const span = [at, at + need]; if (cab.type === 'TALL') span.tall = true;
    occ[line][wall].push(span);
    placements.push({ code: cab.code, ...posOn(wall, centre, cab), rotDeg: ROT[wall] });
    placed.push({ cab, wall, along: centre, lo: at, hi: at + need, stacked: false });
  };
  const stand = (cab, line, order = ['back', 'left', 'right'], fromHigh = false) => {
    const need = cab.w + retOf(cab);
    for (const wall of order) {
      const at = (fromHigh && wall === 'back' ? lastGap : firstGap)(wall, need, takenOn(wall, line, cab), cab);
      if (at == null) continue;
      putAt(cab, line, wall, at);
      return true;
    }
    miss(cab); return false;
  };

  // ---- corners: a corner unit belongs IN a corner, its return reaching the side
  // wall and a run on that wall meeting it leg to leg. (Her screenshot 2026-09-18:
  // stood mid-run like any other cabinet, the oak return was left on show and the
  // side run started wherever the back wall happened to fill up.) Blank-left goes
  // to the back-left corner, blank-right to the back-right; each keeps one base
  // cabinet back for its partner run so the corner is never an orphan.
  const free = (wall, a, b, cab) => !takenOn(wall, 'floor', cab).some(([p, q]) => q > a + 1e-6 && p < b - 1e-6);
  const legs = [];
  const cL = cornerL[0], cR = cornerR[0];
  const needL = cL ? cL.w + CORNER_OUT : 0, needR = cR ? cR.w + CORNER_OUT : 0;
  if (cL && W >= needL + needR && free('back', minX, minX + needL, cL)) { putAt(cL, 'floor', 'back', minX); legs.push('left'); } else if (cL) spareCorners.unshift(cL);
  if (cR && W >= needL + needR && free('back', maxX - needR, maxX, cR)) { putAt(cR, 'floor', 'back', maxX - needR); legs.push('right'); } else if (cR) spareCorners.push(cR);
  // overflow turns onto a wall that HAS a corner unit first
  const order = ['back', ...legs, ...['left', 'right'].filter((w) => !legs.includes(w))];
  // with only a right-hand corner the run packs against IT, so the slack lands at the open left end
  const fromHigh = legs.length === 1 && legs[0] === 'right';

  // ---- the floor line. HARD RULE 15: a dishwasher front (F7 / F29) is LEGLESS, so it
  // must stand BETWEEN two cabinets that have legs: never at the end of a run, never
  // first on a side leg, never beside another dishwasher front. (Her catch 2026-09-19:
  // the example building's list stood its F7 last on the wall.) List order put it there,
  // so the order is searched instead: each dishwasher is tried in every interior slot,
  // nearest its place in the list first, the whole line is stood as a dry run, and the
  // first order with every dishwasher flanked wins. No such order (two cabinets and a
  // dishwasher in a tiny room): the least-bad one stands and the live warning says so.
  const isDW = (c) => c.form === 'dishwasher';
  const standLine = (seq, skip = 0) => {
    const fl = [...seq], partners = [];
    for (const leg of legs) {
      if (fl.length <= 1) break;
      // a partner run never opens with a dishwasher; `skip` tries a different partner
      // (a tight wall sometimes only works when a WIDER cabinet goes round the corner)
      const able = fl.map((c, i) => i).filter((i) => !isDW(fl[i]));
      if (!able.length) break;
      const k = able[Math.max(0, able.length - 1 - skip)];
      partners.push([fl.splice(k, 1)[0], leg]);
    }
    for (const [cab, leg] of partners) stand(cab, 'floor', [leg, ...order]);
    const line = legs.length ? [...fl, ...spareCorners, ...talls] : [...talls, ...fl, ...spareCorners];
    for (const c of line) stand(c, 'floor', order, fromHigh && c.type === 'FLOOR');
  };
  const legged = (h) => (h.cab.type === 'FLOOR' || h.cab.type === 'TALL') && !isDW(h.cab);
  const unflanked = (from) => placed.slice(from).filter((h) => isDW(h.cab)).filter((h) => {
    const run = placed.filter((o) => o !== h && o.wall === h.wall && legged(o));
    return !(run.some((o) => Math.abs(o.hi - h.lo) < 0.5) && run.some((o) => Math.abs(o.lo - h.hi) < 0.5));
  }).length;
  const snap = () => ({ p: placed.length, q: placements.length, lost: new Map(lost), occ: JSON.stringify(occ), tall: ['back', 'left', 'right'].map((w) => occ.floor[w].map((sp) => !!sp.tall)) });
  const restore = (k) => {
    placed.length = k.p; placements.length = k.q; lost.clear(); for (const [a, b] of k.lost) lost.set(a, b);
    const o = JSON.parse(k.occ);
    for (const ln of ['floor', 'upper']) for (const w of ['back', 'left', 'right']) { occ[ln][w].length = 0; o[ln][w].forEach((sp, i) => { if (ln === 'floor' && k.tall[['back', 'left', 'right'].indexOf(w)][i]) sp.tall = true; occ[ln][w].push(sp); }); }
  };
  const orders = function* () {
    yield floors;                                                          // list order, when it is already right
    const dws = floors.filter(isDW), rest = floors.filter((c) => !isDW(c));
    if (!dws.length || rest.length < 2) return;
    const want = dws.map((d) => floors.slice(0, floors.indexOf(d)).filter((c) => !isDW(c)).length);   // cabinets ahead of it in the list
    // interior slots first, nearest its place in the list; the two END slots last (an end
    // only works beside an anchored corner unit's door side, and the dry run decides)
    const cost = (at, i) => Math.abs(at - want[i]) + (at === 0 || at === rest.length ? 100 : 0);
    const slots = (i) => Array.from({ length: rest.length + 1 }, (_, n) => n).sort((a, b) => cost(a, i) - cost(b, i));
    let n = 0;
    const walk = function* (i, chosen) {
      if (n > 60) return;
      if (i === dws.length) { n++; const out = [...rest]; [...chosen.entries()].sort((a, b) => b[1] - a[1]).forEach(([di, at]) => out.splice(at, 0, dws[di])); yield out; return; }
      for (const at of slots(i)) { if (chosen.includes(at)) continue; yield* walk(i + 1, [...chosen, at]); }   // one dishwasher per slot: never two side by side
    };
    yield* walk(0, []);
  };
  const start = snap();
  let best = null;
  const lostNow = () => [...lost.values()].reduce((a, b) => a + b, 0);
  const lost0 = lostNow();
  search: for (let skip = 0; skip < (legs.length ? 4 : 1); skip++) {
    for (const seq of orders()) {
      restore(start);
      const from = placed.length;
      standLine(seq, skip);
      // a dishwasher left unflanked is worse than anything; then cabinets that found no wall;
      // then straying from the list's own order (skip 0, first order = exactly as listed)
      const score = unflanked(from) * 1000 + (lostNow() - lost0) * 10 + skip;
      if (!best || score < best.score) best = { seq, skip, score };
      if (score === skip) break search;
    }
  }
  if (best && best.score !== best.skip) { restore(start); standLine(best.seq, best.skip); }   // no perfect order: stand the least-bad one

  for (const c of [...counters, ...uppers]) stand(c, 'upper');

  // ---- stackers sit on a host of their own width, one each ----
  for (const s of stackers) {
    // a tall's stacker carries `onTall` (24" deep, standing proud with it); wall + tall hosts share the 86" top
    const hostType = s.onTall ? 'TALL' : s.mountY === 86 ? 'WALL' : 'COUNTER';
    const host = placed.find((h) => !h.stacked && h.cab.type === hostType && !h.cab.corner && Math.abs(h.cab.w - s.w) < 0.5);
    if (!host) { miss(s); continue; }
    host.stacked = true;
    placements.push({ code: s.code, ...posOn(host.wall, host.along, s), rotDeg: ROT[host.wall] });
  }

  return { placements, unplaced: [...lost].map(([code, qty]) => ({ code, qty })) };
}
