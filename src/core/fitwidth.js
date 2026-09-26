// fitwidth.js — PURE. An open shelf or the tray space CUT TO FIT the space it lands in (her ask
// 2026-09-26: "can these auto resize to fit leftover space, and the same as the floor tray
// space"). Given what measureRun found either side of it (gap + what it is to), the plan says
// what width it should become and how far its centre shifts along the run so the edge that
// already touches something stays put.
//   planFitToGap(cab, m, opts) -> { code, w, shift } | null
//     cab: the cabinet (canFitWidth), m: { w, before:{gap,to}, after:{gap,to} } from measureRun,
//     shift: inches along the run (+ = toward `after`), null when nothing needs doing.
//   opts.grow (default true): fill a leftover gap on the open side (up to FIT_WIDTH_LIMITS[1])
//   opts.shrink (default true): a gap narrower than the cabinet on both sides -> narrow to it

import { getCab, canFitWidth, sizedWidthCode, FIT_WIDTH_LIMITS } from './catalogue.js';

const TOUCH = 0.4;          // this close is touching
const LEFTOVER_MAX = 18;    // a gap wider than this is a cabinet's worth, not a leftover

export function planFitToGap(cab, m, opts = {}) {
  if (!cab || !canFitWidth(cab) || !m) return null;
  const grow = opts.grow !== false, shrink = opts.shrink !== false;
  const b = m.before.gap, a = m.after.gap, [lo, hi] = FIT_WIDTH_LIMITS;
  const touchB = b < TOUCH, touchA = a < TOUCH;
  let w = null, shift = 0;
  if (grow && touchB !== touchA) {                                   // one side touching, a leftover on the other
    const gap = touchB ? a : b;
    if (gap >= TOUCH && gap <= LEFTOVER_MAX && m.w + gap <= hi + 0.05) { w = m.w + gap; shift = (touchB ? 1 : -1) * gap / 2; }
  } else if (grow && touchB && touchA) {
    return null;                                                     // already snug
  } else if (grow && !touchB && !touchA && (b <= LEFTOVER_MAX || a <= LEFTOVER_MAX)) {
    // loose between two things with leftovers both sides: fill the whole slot when it is one shelf's worth
    const total = m.w + a + b;
    if (total <= hi + 0.05 && Math.min(a, b) >= TOUCH) { w = total; shift = (a - b) / 2; }
  }
  if (w == null) return null;
  w = Math.round(w * 2) / 2;
  if (w < lo || Math.abs(w - m.w) < 0.05) return null;
  const code = sizedWidthCode(cab.baseCode || cab.code, w);
  return { code, w: getCab(code).w, shift };
}

/** A cabinet asked to be `width` wide by hand: which way it grows/shrinks so a touching edge stays. */
export function planSetWidth(cab, m, width) {
  if (!cab || !canFitWidth(cab)) return null;
  const code = sizedWidthCode(cab.baseCode || cab.code, width);
  const w = getCab(code).w, dw = w - m.w;
  if (Math.abs(dw) < 0.05) return null;
  const touchB = m.before.gap < TOUCH, touchA = m.after.gap < TOUCH;
  const shift = touchB && !touchA ? dw / 2 : touchA && !touchB ? -dw / 2 : 0;   // keep the touching edge; centred otherwise
  return { code, w, shift };
}
