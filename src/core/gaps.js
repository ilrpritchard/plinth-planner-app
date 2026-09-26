// gaps.js — PURE. "There is a gap here: this is what would fit." (Her ask 2026-09-21.)
//
//   findGaps(state)          gaps in the FLOOR line along the back, left and right walls:
//                            between two things, or between a thing and the wall end. Anything
//                            that reaches into a wall's 25" band counts as standing there, so a
//                            side run turning the corner closes that end by itself. Doors split
//                            a gap; windows do not (a base cabinet may sit under glass).
//   suggestForGap(gap)       up to three ways to fill it from the catalogue, each as close to
//                            the full width as the cabinet sizes allow, fewest pieces first.
//   placementsFor(gap, opt)  exact positions, butted from the side that matters (a range first).
//
// RULES the suggestions obey (CLAUDE.md hard rules 15 + 16): never a dishwasher front (it needs
// legs either side and is a deliberate choice), never a TALL when the gap touches a cooking
// appliance, and beside a range the first piece offered is drawers. What is left over (9" or
// less) becomes a scribe filler by itself: computeFillers already draws and prices it.

import { getCab, sizedWidthCode } from './catalogue.js';
import { boxAt } from './placement.js';
import { openingCenter, openingWidth } from './openings.js';

const BAND = 24;             // a base run is 24.25" deep: anything starting nearer the wall than that stands IN the run's depth
                             // (a side leg that starts 24.3" out butts the back run's FRONT and leaves the corner to it)
const MIN_GAP = 9.5;         // below this it is a filler, which the planner already handles
const MAX_GAP = 130;
const WALL_GAP = 0.25;
const ROT = { back: 0, left: 90, right: 270 };

const DRAWERS = ['F20', 'F19', 'F18', 'F17'];
const DOORS = ['F11', 'F10', 'F3', 'F2', 'F1'];
const MIXED = ['F20', 'F11', 'F10', 'F19', 'F3', 'F18', 'F2', 'F22', 'F21', 'F17', 'F1'];

const onFloor = (c) => c && c.placeable && (c.type === 'FLOOR' || c.type === 'TALL' || (c.type === 'APPLIANCES' && (c.mountY || 0) === 0 && !['sink', 'hob', 'oven', 'hood'].includes(c.appliance)));
const cooks = (c) => c && (c.appliance === 'range' || c.appliance === 'cooker');

export function findGaps(state) {
  const r = state.room || {}, W = r.width || 144, D = r.depth || 120;
  const b = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
  const things = (state.items || []).map((it) => ({ it, cab: getCab(it.code) })).filter((x) => onFloor(x.cab) && !x.it.island)
    .map((x) => ({ ...x, box: boxAt(x.cab, x.it.x, x.it.z, x.it.rotDeg) }));
  const gaps = [];
  for (const wall of ['back', 'left', 'right']) {
    const horiz = wall === 'back';
    const [lo, hi] = horiz ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
    const inBand = (bx) => (wall === 'back' ? bx.z0 < b.minZ + BAND : wall === 'left' ? bx.x0 < b.minX + BAND : bx.x1 > b.maxX - BAND);
    const here = things.filter((t) => inBand(t.box)).map((t) => ({ a0: horiz ? t.box.x0 : t.box.z0, a1: horiz ? t.box.x1 : t.box.z1, t, own: ((t.it.rotDeg || 0) === ROT[wall]) }))
      .sort((p, q) => p.a0 - q.a0);
    if (!here.some((h) => h.own)) continue;                       // an empty wall is not a gap
    const doors = (r.openings || []).filter((o) => (o.wall || 'back') === wall && o.type !== 'window')
      .map((o) => { const c = openingCenter(r, o), hw = openingWidth(o, r) / 2 + 3; return [c - hw, c + hw]; });
    const push = (g0, g1, left, right) => {
      // a door cuts the gap: keep the pieces either side of it
      let parts = [[g0, g1]];
      for (const [d0, d1] of doors) parts = parts.flatMap(([p0, p1]) => (d1 <= p0 || d0 >= p1 ? [[p0, p1]] : [[p0, Math.min(p1, d0)], [Math.max(p0, d1), p1]]));
      for (const [p0, p1] of parts) {
        const width = p1 - p0;
        if (width < MIN_GAP || width > MAX_GAP) continue;
        gaps.push({ wall, lo: p0, hi: p1, width, left: p0 === g0 ? left : null, right: p1 === g1 ? right : null, doorLeft: p0 !== g0, doorRight: p1 !== g1 });
      }
    };
    let cur = lo, prev = null;
    for (const h of here) { if (h.a0 - cur > 0.5) push(cur, h.a0, prev, h.t); if (h.a1 > cur) { cur = h.a1; prev = h.t; } }
    if (hi - cur > 0.5) push(cur, hi, prev, null);
  }
  return gaps.map((g, i) => ({ ...g, id: i, label: gapLabel(g) }));
}

const nameOf = (t) => (!t ? 'the wall' : t.cab.appliance === 'range' ? 'the range' : t.cab.appliance === 'fridge' ? 'the fridge' : t.cab.type === 'TALL' ? `the tall (${t.cab.code})` : t.cab.code);
function gapLabel(g) {
  const a = g.doorLeft ? 'the door' : nameOf(g.left), z = g.doorRight ? 'the door' : nameOf(g.right);
  return `between ${a} and ${z}`;
}

/** Best fill of `width` from `codes` (widest listed first): most inches, then fewest pieces. */
function pack(width, codes) {
  const units = codes.map((code) => getCab(code)).filter(Boolean);
  const cap = Math.floor(width + 0.25);
  const best = new Array(cap + 1).fill(null); best[0] = [];
  for (let s = 0; s <= cap; s++) {
    if (!best[s]) continue;
    for (const u of units) { const n = s + u.w; if (n > cap) continue; if (!best[n] || best[n].length > best[s].length + 1) best[n] = [...best[s], u.code]; }
  }
  // her taste (hard rule 30): FEWEST, WIDEST. Anything that leaves 9.5" or less is a good fit
  // (the leftover is a scribe filler), so among those the fewest pieces wins, then the most
  // inches: one 36" and a 6" filler beats two 20s and a 2" filler. Only when nothing gets
  // that close does "most inches" decide.
  let pick = null;
  for (let s = cap; s > 0 && s >= width - 9.5; s--) if (best[s] && best[s].length && (!pick || best[s].length < best[pick].length)) pick = s;
  if (pick == null) for (let s = cap; s > 0; s--) if (best[s] && best[s].length) { pick = s; break; }
  return pick == null ? null : { codes: best[pick], used: pick };
}

export function suggestForGap(gap) {
  const byRange = cooks(gap.left && gap.left.cab) || cooks(gap.right && gap.right.cab);
  // beside a range the cabinet that TOUCHES it is always drawers (pans live there): every
  // option there starts with a drawer bank, and the rest of the gap is packed behind it
  const withDrawerFirst = (rest, needRest = false) => {
    let best = null;
    for (const d of DRAWERS) { const dw = getCab(d).w; if (dw > gap.width + 0.25) continue; const p = pack(gap.width - dw, rest) || { codes: [], used: 0 }; if (needRest && !p.codes.length) continue;
      const cand = { codes: [d, ...p.codes], used: dw + p.used }, fits = (c) => gap.width - c.used <= 9.5;
      const better = !best || (fits(cand) && !fits(best)) || (fits(cand) === fits(best) && (fits(cand) ? (cand.codes.length < best.codes.length || (cand.codes.length === best.codes.length && cand.used > best.used)) : cand.used > best.used));
      if (better) best = cand; }
    return best;
  };
  const sets = byRange ? [['Drawers', () => pack(gap.width, DRAWERS)], ['Drawers, then a door', () => withDrawerFirst(DOORS, true)], ['Drawers, then a pull-out bin', () => withDrawerFirst(['F22', 'F21'], true)]]
    : [['Fewest cabinets', () => pack(gap.width, MIXED)], ['Drawers', () => pack(gap.width, DRAWERS)], ['Doors', () => pack(gap.width, DOORS)]];
  const out = [], seen = new Set();
  for (const [kind, make] of sets) {
    const p = make(); if (!p || !p.codes.length) continue;
    let list = byRange ? [p.codes[0], ...p.codes.slice(1).sort((a, b) => getCab(b).w - getCab(a).w)] : [...p.codes].sort((a, b) => getCab(b).w - getCab(a).w);
    if (byRange && getCab(list[0]).form !== 'drawers') { const d = list.findIndex((c) => getCab(c).form === 'drawers'); if (d > 0) list.unshift(list.splice(d, 1)[0]); }
    const key = [...list].sort().join('+'); if (seen.has(key)) continue; seen.add(key);
    const left = gap.width - p.used;
    if (left > 9.5 && out.length) continue;                        // a worse fit than one already offered
    out.push({ kind, codes: list, used: p.used, left, filler: left > 0.5 && left <= 9.5, usd: list.reduce((n, c) => n + (getCab(c).usd || 0), 0) });
  }
  // a small leftover (6" to 18"): the tray space cut to exactly that width, her way of using a sliver
  if (gap.width >= 6 && gap.width <= 18 && getCab('F8')) {
    const code = sizedWidthCode('F8', gap.width), c = getCab(code);
    if (c) out.unshift({ kind: 'Tray space, cut to fit', codes: [code], used: c.w, left: gap.width - c.w, filler: false, usd: c.usd || 0 });
  }
  return out.slice(0, 3);
}

/** Where each cabinet of an option stands: butted from the range side when there is one,
 *  otherwise from whatever cabinet is there, so any leftover ends up against the wall or tall. */
export function placementsFor(gap, option, state) {
  const r = state.room || {}, W = r.width || 144, D = r.depth || 120;
  const fromHigh = cooks(gap.right && gap.right.cab) ? true : cooks(gap.left && gap.left.cab) ? false : (!gap.left && !!gap.right) || (gap.left && gap.left.cab.type === 'TALL' && gap.right && gap.right.cab.type !== 'TALL');
  let cur = fromHigh ? gap.hi : gap.lo;
  return option.codes.map((code) => {
    const c = getCab(code), along = fromHigh ? cur - c.w / 2 : cur + c.w / 2;
    cur += fromHigh ? -c.w : c.w;
    const off = c.d / 2 + WALL_GAP;
    const p = gap.wall === 'back' ? { x: along, z: -D / 2 + off } : gap.wall === 'left' ? { x: -W / 2 + off, z: along } : { x: W / 2 - off, z: along };
    return { code, ...p, rotDeg: ROT[gap.wall] };
  });
}
