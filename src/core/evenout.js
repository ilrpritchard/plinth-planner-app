// evenout.js — PURE. "Uneven scribes on each side: even them out." (Her ask 2026-09-21.)
//
// A run that goes wall to wall rarely lands exactly: there is a little slack, and tap-to-add
// leaves ALL of it at one end (0" one side, 8" the other). Evened out, the whole wall slides
// along so both ends get the same scribe filler. planEvenOut() says whether that can be done
// WITHOUT spoiling anything, and what would move. Nothing here moves anything.
//
//   planLineUp(state, wall)  -> the UI's call: every rule the slack allows (even ends / sink under its
//                               window / range centred on the wall), each with its moves and what it costs
//   planEvenOut(state, wall) -> the even-ends rule alone, refusing when it would pull a centred sink off
//                               its window: { ok:true, shift, left, right, each, moves, notes } | { ok:false, reason }
//
// EVERYTHING on that wall moves together (bases, talls, the range, uppers, the hood, stackers,
// and the sink / cooktop / oven riding in a base), so nothing comes out of line with what is
// above or below it. It is refused when it would spoil the design:
//   * a run on an adjoining wall meets this one (a corner joint would open up), or a corner unit
//   * the slack is more than two scribe fillers (19"): that is a gap to fill, not a scribe
//   * anything would cross a door, leave the room, or a tall / upper would cover a window
//   * a sink that sits centred under a window would be pulled off it
// The island is never moved: if it was lined up on the range, say so in `notes`.

import { getCab } from './catalogue.js';
import { boxAt } from './placement.js';
import { openingCenter, openingWidth } from './openings.js';

const ROT = { back: 0, left: 90, right: 270 };
const NEAR = 14;            // back face within this of the wall = standing / hanging on it
const MAX_SLACK = 19;       // two scribe fillers of 9.5"
const MIN_DIFF = 1;         // already even enough
const riders = (c) => ['sink', 'hob', 'oven'].includes(c.appliance);
const floorLine = (c) => c.type === 'FLOOR' || c.type === 'TALL' || (c.type === 'APPLIANCES' && (c.mountY || 0) === 0 && !riders(c));

function context(state, wall) {
  if (!(wall in ROT)) return { ok: false, reason: 'no wall' };
  const r = state.room || {}, W = r.width || 144, D = r.depth || 120;
  const b = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
  const horiz = wall === 'back';
  const [lo, hi] = horiz ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
  const all = (state.items || []).map((it) => ({ it, cab: getCab(it.code) })).filter((x) => x.cab && x.cab.placeable).map((x) => ({ ...x, box: boxAt(x.cab, x.it.x, x.it.z, x.it.rotDeg) }));
  const offWall = (t) => (wall === 'back' ? t.box.z0 - b.minZ : wall === 'left' ? t.box.x0 - b.minX : b.maxX - t.box.x1);
  const mine = all.filter((t) => !t.it.island && ((t.it.rotDeg || 0) % 360) === ROT[wall] && offWall(t) < NEAR);
  const line = mine.filter((t) => floorLine(t.cab));
  if (line.length < 2) return { ok: false, reason: 'no run' };
  const a0 = (t) => (horiz ? t.box.x0 : t.box.z0), a1 = (t) => (horiz ? t.box.x1 : t.box.z1);
  const start = Math.min(...line.map(a0)), end = Math.max(...line.map(a1));
  const left = start - lo, right = hi - end;
  if (left < -0.3 || right < -0.3) return { ok: false, reason: 'over the wall' };
  if (left + right > MAX_SLACK) return { ok: false, reason: 'too much slack' };
  // what pins this run where it is (the caller decides whether that is worth explaining)
  let fixed = null;
  if (mine.some((t) => t.cab.corner)) fixed = 'corner unit';
  // a run on an adjoining wall that comes within a cabinet's depth of this wall meets it
  const meets = all.some((t) => !mine.includes(t) && !t.it.island && floorLine(t.cab) && offWall(t) < 30 && ((t.it.rotDeg || 0) % 180) !== (ROT[wall] % 180));
  if (meets && !fixed) fixed = 'adjoining run';
  // a wall-to-wall RUN: no hole in it bigger than a filler (that is a gap, fill it first)
  const sorted = [...line].sort((p, q) => a0(p) - a0(q));
  for (let i = 1, cur = a1(sorted[0]); i < sorted.length; i++) { if (a0(sorted[i]) - cur > 9.6) fixed = fixed || 'gap in the run'; cur = Math.max(cur, a1(sorted[i])); }

  return { ok: true, r, wall, horiz, lo, hi, all, mine, left, right, a0, a1, fixed };
}

// what sliding the wall by `shift` would do: a hard refusal, or the moves and what comes off line
function trySlide(cx, shift) {
  const { r, wall, horiz, all, mine, a0, a1, lo, hi } = cx;
  const moved = (t) => ({ x0: t.box.x0 + (horiz ? shift : 0), x1: t.box.x1 + (horiz ? shift : 0), z0: t.box.z0 + (horiz ? 0 : shift), z1: t.box.z1 + (horiz ? 0 : shift) });
  const notes = [];
  for (const o of r.openings || []) {
    if ((o.wall || 'back') !== wall) continue;
    const c = openingCenter(r, o), hw = openingWidth(o, r) / 2;
    for (const t of mine) {
      const m = moved(t), [m0, m1] = horiz ? [m.x0, m.x1] : [m.z0, m.z1], [p0, p1] = [a0(t), a1(t)];
      const over = (q0, q1, pad) => q0 < c + hw + pad && q1 > c - hw - pad;
      if (o.type !== 'window') { if (floorLine(t.cab) && over(m0, m1, 1) && !over(p0, p1, 1)) return { ok: false, reason: 'door' }; continue; }
      const tallOrHung = t.cab.type === 'TALL' || t.cab.type === 'WALL' || t.cab.type === 'SHELF' || t.cab.type === 'COUNTER';
      if (tallOrHung && over(m0, m1, -0.5) && !over(p0, p1, -0.5)) return { ok: false, reason: 'window' };
      if (t.cab.appliance === 'sink') {
        const was = Math.abs((p0 + p1) / 2 - c), now = Math.abs((m0 + m1) / 2 - c);
        if (was <= 1.5 && now > 1.5) notes.push({ what: 'sink', off: now });
      }
    }
  }
  const range = mine.find((t) => t.cab.appliance === 'range');
  if (range) { const mid = (lo + hi) / 2, was = Math.abs((a0(range) + a1(range)) / 2 - mid), now = Math.abs((a0(range) + a1(range)) / 2 + shift - mid); if (was <= 1.5 && now > 1.5) notes.push({ what: 'range', off: now }); }
  // the island stays put: if it was lined up on the range (or the sink), say what happens
  const isl = all.filter((t) => t.it.island && floorLine(t.cab));
  if (isl.length && horiz) {
    const ic = (Math.min(...isl.map((t) => t.box.x0)) + Math.max(...isl.map((t) => t.box.x1))) / 2;
    const focus = range || mine.find((t) => t.cab.appliance === 'sink');
    if (focus) { const fc = (focus.box.x0 + focus.box.x1) / 2; if (Math.abs(fc - ic) <= 1.5) notes.push('island'); }
  }
  const moves = mine.map((t) => ({ id: t.it.id, x: t.it.x + (horiz ? shift : 0), z: t.it.z + (horiz ? 0 : shift) }));
  return { ok: true, shift, left: cx.left + shift, right: cx.right - shift, moves, notes };
}

export function planEvenOut(state, wall = 'back') {
  const cx = context(state, wall);
  if (!cx.ok) return cx;
  if (Math.abs(cx.left - cx.right) < MIN_DIFF) return { ok: false, reason: 'already even' };
  if (cx.fixed) return { ok: false, reason: cx.fixed, left: cx.left, right: cx.right };
  const t = trySlide(cx, (cx.right - cx.left) / 2);
  if (!t.ok) return { ...t, left: cx.left, right: cx.right };
  const sinkOff = t.notes.find((n) => n.what === 'sink');
  if (sinkOff) return { ok: false, reason: 'sink under window', left: cx.left, right: cx.right };
  return { ok: true, wall, shift: t.shift, left: cx.left, right: cx.right, each: (cx.left + cx.right) / 2, moves: t.moves, notes: t.notes.filter((n) => n === 'island') };
}

/** "Which rule would you like?" (her ask 2026-09-21: the even-out pulled her sink off the window.)
 *  The slack on a wall can only go one way, so the rules compete: EVEN ENDS, the SINK centred
 *  under its window, or the RANGE centred on the wall. Every rule the slack allows is offered,
 *  each saying what it leaves at the ends and what it pulls off line. Nothing is refused for
 *  taste any more: only a door, glass that would be covered, a corner joint or a hole in the run.
 *    -> { ok:true, wall, left, right, options:[{ key:'even'|'sink'|'range', also:[keys], shift, left, right, moves, notes }] }
 *     | { ok:false, reason, left?, right? } */
export function planLineUp(state, wall = 'back') {
  const cx = context(state, wall);
  if (!cx.ok) return cx;
  const { left, right, mine, a0, a1, lo, hi, r } = cx, mid = (t) => (a0(t) + a1(t)) / 2;
  const wants = [];
  if (Math.abs(left - right) >= MIN_DIFF) wants.push({ key: 'even', shift: (right - left) / 2 });
  const sink = mine.find((t) => t.cab.appliance === 'sink');
  if (sink) {
    const wins = (r.openings || []).filter((o) => (o.wall || 'back') === wall && o.type === 'window').map((o) => openingCenter(r, o)).sort((p, q) => Math.abs(p - mid(sink)) - Math.abs(q - mid(sink)));
    if (wins.length) wants.push({ key: 'sink', shift: wins[0] - mid(sink) });
  }
  const range = mine.find((t) => t.cab.appliance === 'range');
  if (range) wants.push({ key: 'range', shift: (lo + hi) / 2 - mid(range) });
  const can = wants.filter((w) => Math.abs(w.shift) >= 0.25 && left + w.shift > -0.05 && right - w.shift > -0.05);
  if (!can.length) return { ok: false, reason: 'already even' };
  if (cx.fixed) return { ok: false, reason: cx.fixed, left, right };
  const options = []; let refused = null;
  for (const w of can) {
    const same = options.find((o) => Math.abs(o.shift - w.shift) < 0.25);
    if (same) { same.also.push(w.key); continue; }
    const t = trySlide(cx, w.shift);
    if (!t.ok) { refused = refused || t.reason; continue; }
    // a rule never reports breaking itself
    options.push({ key: w.key, also: [], ...t, notes: t.notes.filter((n) => n === 'island' || n.what !== w.key) });
  }
  for (const o of options) o.notes = o.notes.filter((n) => n === 'island' || !o.also.includes(n.what));
  if (!options.length) return { ok: false, reason: refused || 'already even', left, right };
  return { ok: true, wall, left, right, options };
}
