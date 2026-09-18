// resize.js — PURE. Change a placed range cooker's size and work out what the
// run around it has to do so it still fits: nothing overlaps, ever (hard rule 1).
//
// Growing (30" -> 36" / 48"): the range grows about its own centre (so a hood
// stays centred), the cabinets butted against it slide outward into whatever
// free wall there is, and when the wall is full the nearest cabinet that has a
// narrower twin (Drawers 36" -> 28", Double 36" -> 28", Single 28" -> 24" ...)
// is swapped down to absorb the rest. Shrinking: a neighbour is swapped UP to
// its wider twin when one fits exactly-or-under, and the chains slide back in.
//
// Never moved: corner units, talls, fridges (they are hard stops, like a door
// in the wall or anything on a crossing run). Never swapped: the dishwasher
// front, cooktop bases, and any base with a sink or cooktop sitting in it;
// those slide, and the sink or cooktop rides along.
//
// When even that is not enough, ONE cabinet comes out (`removes`), never an
// essential; the UI asks before applying a plan that removes anything.
//
// planRangeResize(state, id, code) -> { ok:true, code, moves:[{id,x,z}], swaps:[{id,code}], removes:[{id,code,desc}], note }
//                                  |  { ok:false, reason, short }     (short = inches still missing)

import { getCab, CATALOGUE } from './catalogue.js';
import { openingCenter, openingWidth } from './openings.js';

const BUTT = 0.75;        // neighbours closer than this are touching
const EPS = 0.02;

/** The other sizes this range can become, itself included, narrow to wide. */
export function rangeSizes(code) {
  const cur = getCab(code);
  if (!cur || cur.appliance !== 'range') return [];
  return CATALOGUE.filter((c) => c.appliance === 'range' && c.placeable !== false && !c.baseCode)
    .sort((a, b) => a.w - b.w);
}

function aabb(it, cab) {
  const ret = cab.corner ? (cab.type === 'FLOOR' ? 20 : 10) : 0;
  const lR = (cab.corner && cab.cornerSide !== 'right') ? ret : 0;
  const rR = (cab.corner && cab.cornerSide === 'right') ? ret : 0;
  const rad = ((it.rotDeg || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [lx, lz] of [[-(cab.w / 2 + lR), -cab.d / 2], [cab.w / 2 + rR, -cab.d / 2], [cab.w / 2 + rR, cab.d / 2], [-(cab.w / 2 + lR), cab.d / 2]]) {
    const wx = lx * c + lz * s, wz = -lx * s + lz * c;
    x0 = Math.min(x0, it.x + wx); x1 = Math.max(x1, it.x + wx);
    z0 = Math.min(z0, it.z + wz); z1 = Math.max(z1, it.z + wz);
  }
  return { x0, x1, z0, z1 };
}

const standsOnFloor = (cab) => cab && cab.placeable !== false &&
  (cab.type === 'FLOOR' || cab.type === 'TALL' || (cab.type === 'APPLIANCES' && (cab.mountY || 0) === 0));
const ridesInWorktop = (cab) => cab && cab.type === 'APPLIANCES' && (cab.appliance === 'sink' || cab.appliance === 'hob');

/** Same-form twins of a base cabinet at other widths (a Double may also drop to a Single). */
function twins(cab) {
  if (cab.type !== 'FLOOR' || cab.corner || !['door', 'double', 'drawers', 'bin', 'open'].includes(cab.form)) return [];
  if (/cooktop|appliance/i.test(cab.desc)) return [];
  return CATALOGUE.filter((c) => c.type === 'FLOOR' && c.placeable !== false && !c.corner && c.code !== cab.code &&
    !!c.halfDepth === !!cab.halfDepth && c.d === cab.d && c.h === cab.h && !/cooktop|appliance/i.test(c.desc) &&
    (c.form === cab.form || (cab.form === 'double' && c.form === 'door' && c.w < cab.w)));
}

export function planRangeResize(state, id, code) {
  const it = state.items.find((i) => i.id === id);
  const cur = it && getCab(it.code), next = getCab(code);
  if (!it || !cur || !next || cur.appliance !== 'range' || next.appliance !== 'range') return { ok: false, reason: 'Not a range.' };
  if (next.code === cur.code) return { ok: true, code, moves: [], swaps: [], removes: [], note: '' };

  const horiz = (((it.rotDeg || 0) % 180) + 180) % 180 === 0;
  const A = (o) => (horiz ? o.x : o.z), P = (o) => (horiz ? o.z : o.x);      // along the run / across it
  const span = (b) => (horiz ? [b.x0, b.x1] : [b.z0, b.z1]);
  const band = (b) => (horiz ? [b.z0, b.z1] : [b.x0, b.x1]);
  const room = state.room;
  const half = horiz ? room.width / 2 : room.depth / 2;

  // ---- who is in this run, who is a hard stop -------------------------------
  const myBand = band(aabb(it, cur));
  const members = [];                       // movable run cabinets {it, cab, a0, a1}
  const stops = [[-Infinity, -half], [half, Infinity]];
  for (const o of state.items) {
    if (o.id === it.id) continue;
    const c = getCab(o.code);
    if (!standsOnFloor(c)) continue;
    const b = aabb(o, c), [p0, p1] = band(b);
    if (Math.min(p1, myBand[1]) - Math.max(p0, myBand[0]) < 0.5) continue;   // not across our line
    const [a0, a1] = span(b);
    const inRun = (o.rotDeg || 0) === (it.rotDeg || 0) && Math.abs(P(o) - P(it)) < 9 && !o.island === !it.island;
    const fixed = !inRun || c.corner || c.type === 'TALL' || c.type === 'APPLIANCES';
    if (fixed) stops.push([a0, a1]); else members.push({ it: o, cab: c, a0, a1 });
  }
  // a door or doorway in the wall this run stands against
  const wall = it.island ? null : horiz
    ? (Math.abs(it.z - (-room.depth / 2 + cur.d / 2)) < 9 ? 'back' : Math.abs(it.z - (room.depth / 2 - cur.d / 2)) < 9 ? 'front' : null)
    : (Math.abs(it.x - (-room.width / 2 + cur.d / 2)) < 9 ? 'left' : Math.abs(it.x - (room.width / 2 - cur.d / 2)) < 9 ? 'right' : null);
  for (const o of state.openings || []) {
    if (o.wall !== wall || o.type === 'window') continue;
    const cA = openingCenter(room, o), w = openingWidth(o, room);
    stops.push([cA - w / 2, cA + w / 2]);
  }
  // sinks / cooktops ride with the base under them and pin its width
  const riders = state.items.filter((o) => ridesInWorktop(getCab(o.code)) && Math.abs(P(o) - P(it)) < 9);
  for (const m of members) m.riders = riders.filter((r) => A(r) > m.a0 - EPS && A(r) < m.a1 + EPS);

  // ---- the two chains butted against the range, nearest first ----------------
  const c0 = A(it) - cur.w / 2, c1 = A(it) + cur.w / 2;
  const chain = (dir) => {
    const out = [];
    let edge = dir < 0 ? c0 : c1;
    const pool = members.filter((m) => (dir < 0 ? m.a1 <= c0 + BUTT : m.a0 >= c1 - BUTT))
      .sort((p, q) => (dir < 0 ? q.a1 - p.a1 : p.a0 - q.a0));
    for (const m of pool) {
      const gap = dir < 0 ? edge - m.a1 : m.a0 - edge;
      out.push({ ...m, gapBefore: Math.max(0, gap) });
      edge = dir < 0 ? m.a0 : m.a1;
    }
    // the hard stop beyond the chain
    let limit = dir < 0 ? -Infinity : Infinity;
    for (const [s0, s1] of stops) {
      if (dir < 0 && s1 <= c0 + BUTT) limit = Math.max(limit, s1);
      if (dir > 0 && s0 >= c1 - BUTT) limit = Math.min(limit, s0);
    }
    // members beyond the stop are not ours to push
    const kept = out.filter((m) => (dir < 0 ? m.a1 > limit + BUTT : m.a0 < limit - BUTT));
    const used = kept.reduce((s, m) => s + (m.a1 - m.a0), 0);
    const free = Math.max(0, (dir < 0 ? c0 - limit : limit - c1) - used);
    return { members: kept, free, limit };
  };
  const L = chain(-1), R = chain(1);
  const delta = next.w - cur.w;
  const swapOf = new Map();                  // member -> the twin it becomes
  const candidates = (wider) => {
    const out = [];
    for (const side of [L, R]) side.members.forEach((m, rank) => {
      if (m.riders.length) return;           // a sink or cooktop pins its base
      for (const t of twins(m.cab)) {
        const gain = wider ? t.w - m.cab.w : m.cab.w - t.w;
        if (gain > EPS) out.push({ m, side, t, gain, rank });
      }
    });
    return out;
  };

  // a hood centred over the range wants the range to stay centred under it
  const hood = state.items.find((o) => { const c = getCab(o.code); return c && c.appliance === 'hood' && Math.abs(A(o) - A(it)) < 1.5 && Math.abs(P(o) - P(it)) < 12; });
  const LOPSIDED = hood ? 10 : 1;

  // grow evenly about the centre; a side that is short hands its share across
  const spread = (freeL, freeR) => {
    let l = Math.min(delta / 2, freeL), r = Math.min(delta / 2, freeR);
    const rest = delta - l - r;
    if (rest > EPS) { const xl = Math.min(rest, freeL - l); l += xl; r += rest - xl; }
    return [l, r];
  };
  const gainOn = (picks, side) => picks.filter((pk) => pk.side === side).reduce((n, pk) => n + pk.gain, 0);
  const pairs = (cands) => {                 // no swap, one swap, or two different cabinets
    const out = [[]];
    for (const x of cands) { out.push([x]); for (const y of cands) if (y.m !== x.m && x.rank <= y.rank) out.push([x, y]); }
    return out;
  };

  let moveL, moveR;                          // how far the range's low / high edge travels OUTWARD
  let picks = null, bestScore = Infinity;
  if (delta > 0) {
    const need = delta - (L.free + R.free);
    // the wall is full: swap neighbours down. Least waste, then a range that
    // stays centred, then nearest the range, then fewest swaps; never more than two.
    for (const set of (need > EPS ? pairs(candidates(false)) : [[]])) {
      const gain = set.reduce((n, pk) => n + pk.gain, 0);
      if (gain < need - EPS) continue;
      const [l, r] = spread(L.free + gainOn(set, L), R.free + gainOn(set, R));
      const sc = (gain - Math.max(0, need)) * 10 + Math.abs(l - r) * LOPSIDED + set.reduce((n, pk) => n + pk.rank, 0) + set.length * 4;
      if (sc < bestScore) { bestScore = sc; picks = set; moveL = l; moveR = r; }
    }
    if (!picks) {
      // narrowing is not enough: take ONE cabinet out (never the sink base, the
      // dishwasher, the bin, a corner, or a side's only landing cabinet), with
      // at most one narrowing swap alongside. Least waste wins, then the
      // cabinet furthest from the range.
      const outs = [];
      for (const side of [L, R]) side.members.forEach((m, rank) => {
        if (m.riders.length || side.members.length < 2 || ['dishwasher', 'bin'].includes(m.cab.form)) return;
        outs.push({ m, side, gain: m.cab.w, rank, remove: true });
      });
      const narrow = candidates(false);
      for (const out of outs) for (const set of [[out], ...narrow.filter((x) => x.m !== out.m).map((x) => [out, x])]) {
        const gain = set.reduce((n, pk) => n + pk.gain, 0);
        if (gain < need - EPS) continue;
        const [l, r] = spread(L.free + gainOn(set, L), R.free + gainOn(set, R));
        const sc = (gain - need) * 10 + Math.abs(l - r) * LOPSIDED - out.rank * 3 + set.length * 4;
        if (sc < bestScore) { bestScore = sc; picks = set; moveL = l; moveR = r; }
      }
    }
    if (!picks) {
      const short = Math.ceil(need - EPS);
      return { ok: false, short, reason: `A ${next.w}" range cooker needs ${short}" more room on this run. Remove a cabinet beside it, then pick the size again.` };
    }
  } else {
    // shrinking: swap up to one neighbour per side UP to a wider twin, as much
    // as fits in the hole, then the run closes back up behind the range
    const hole = -delta;
    for (const set of pairs(candidates(true))) {
      if (set.length === 2 && set[0].side === set[1].side) continue;
      const gL = gainOn(set, L), gR = gainOn(set, R);
      if (gL + gR > hole + EPS) continue;
      // each edge comes in by half the hole, but never by less than its side's widening
      let inL = Math.max(hole / 2, gL), inR = hole - inL;
      if (inR < gR) { inR = gR; inL = hole - inR; }
      const sc = (hole - gL - gR) * 2 + Math.abs(inL - inR) * LOPSIDED + set.length;
      if (sc < bestScore) { bestScore = sc; picks = set; moveL = -inL; moveR = -inR; }
    }
  }
  const gone = new Set();
  for (const pk of picks) { if (pk.remove) gone.add(pk.m); else swapOf.set(pk.m, pk.t); }

  // ---- lay it out ---------------------------------------------------------------
  const moves = [];
  const shift = (o, dx) => { if (Math.abs(dx) > EPS) moves.push(horiz ? { id: o.id, x: o.x + dx, z: o.z } : { id: o.id, x: o.x, z: o.z + dx }); };
  const n0 = c0 - moveL, n1 = c1 + moveR;
  const centreShift = (n0 + n1) / 2 - A(it);
  shift(it, centreShift);
  // walk each chain outward from the range's new edge. Growing pushes only what
  // is in the way (open wall gets used up first). Shrinking pulls the run in
  // behind the range: butted cabinets stay butted, a filler-sized gap stays the
  // same filler, and anything beyond real open wall stays where it was.
  const FILLER = 9.6;
  const walk = (side, dir, edge) => {
    let following = delta < 0;
    for (const m of side.members) {
      if (gone.has(m)) continue;
      const w = (swapOf.get(m) || m.cab).w, grew = w - (m.a1 - m.a0);
      if (m.gapBefore > FILLER) following = false;
      const keep = following && m.gapBefore > BUTT ? m.gapBefore : 0;
      let a0, a1;
      if (dir < 0) { a1 = following ? edge - keep : Math.min(delta < 0 ? m.a1 + Math.max(0, grew) : m.a1, edge); a0 = a1 - w; }
      else { a0 = following ? edge + keep : Math.max(delta < 0 ? m.a0 - Math.max(0, grew) : m.a0, edge); a1 = a0 + w; }
      const dx = (a0 + a1) / 2 - A(m.it);
      shift(m.it, dx);
      for (const r of m.riders) shift(r, dx);
      edge = dir < 0 ? a0 : a1;
    }
  };
  walk(L, -1, n0); walk(R, 1, n1);

  // the hood follows an off-centre move when nothing hung beside it is in the way
  if (hood && Math.abs(centreShift) > EPS) {
    const hc = getCab(hood.code), h0 = A(hood) + centreShift - hc.w / 2, h1 = h0 + hc.w;
    const blocked = state.items.some((o) => {
      const c = getCab(o.code);
      if (o.id === hood.id || !c || !((c.mountY || 0) >= 40 || c.type === 'WALL' || c.type === 'TALL')) return false;
      if (Math.abs(P(o) - P(hood)) > 14) return false;
      const [o0, o1] = span(aabb(o, c));
      return Math.min(o1, h1) - Math.max(o0, h0) > 0.1;
    });
    if (!blocked && h0 >= -half && h1 <= half) shift(hood, centreShift);
  }

  const swaps = [...swapOf].map(([m, t]) => ({ id: m.it.id, code: t.code }));
  const removes = [...gone].map((m) => ({ id: m.it.id, code: m.cab.code, desc: `${m.cab.desc} ${m.cab.w}"` }));
  const note = [
    ...[...gone].map((m) => `${m.cab.desc} ${m.cab.w}" came out`),
    ...[...swapOf].map(([m, t]) => `${m.cab.desc} ${m.cab.w}" is now ${t.w}"`),
  ].join(', ');
  return { ok: true, code: next.code, moves: moves.filter((mv) => !removes.some((r) => r.id === mv.id)), swaps, removes, note };
}
