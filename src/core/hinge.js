// hinge.js — PURE. ONE answer to "which side does this cabinet hinge on?", so
// the 3D door, the plan swing, the elevation swing marks, the plan KEY, the
// cabinet schedule and the cut sheets can never disagree. Sides are always as
// VIEWED FACING THE CABINET FRONT.
//
//   'L' | 'R'  one leaf, hung on that side (the placed item's it.hinge, default
//              left; a corner unit is fixed on its blank-return side)
//   'PAIR'     two leaves, left + right hung, meeting in the middle
//   null       nothing hinges (drawers, pull-outs, open shelves, dishwasher
//              panels, appliances)
//
// Fridge housings count as handed: their panels clad the appliance door, so
// the side is the appliance's hinge side and the knob sits opposite it.

const SINGLE_LEAF = new Set(['door', 'glazed', 'larder', 'larderDrawers', 'housing', 'ovenHousing']);

/** Forms whose wide sizes take a door PAIR instead of one leaf (same widths
 *  as models/cabinet.js). */
function isPair(cab) {
  if (cab.form === 'double' || cab.form === 'glazedDouble') return true;
  if (cab.form === 'ovenHousing') return cab.w >= 36;
  return SINGLE_LEAF.has(cab.form) && (cab.w >= 40 || /double/i.test(cab.desc || ''));
}

/** Can this cabinet's hinge side be chosen per placed item (L ↔ R)? */
export function canFlipHinge(cab) {
  return !!cab && !cab.corner && SINGLE_LEAF.has(cab.form) && !isPair(cab);
}

/** @returns {'L'|'R'|'PAIR'|null} */
export function hingeOf(cab, it = null) {
  if (!cab || cab.type === 'APPLIANCES') return null;
  if (cab.form === 'corner') return cab.pair ? 'PAIR' : cab.cornerSide === 'right' ? 'R' : 'L';   // hinge on the blank side; a double corner is a pair
  if (isPair(cab)) return 'PAIR';
  if (!SINGLE_LEAF.has(cab.form)) return null;
  return it && it.hinge === 'R' ? 'R' : 'L';
}

/** HER RULE (2026-09-18): a single-door upper beside the cooker hinges AWAY
 *  from it, so its knob — on the leading edge — is the one nearest the cooker.
 *  Returns the hinge each flanking upper should take: [{ id, hinge }]. Only the
 *  nearest single-leaf WALL / COUNTER cabinet each side, within 12" of the
 *  range / cooktop / hood, on the same wall. `getCab` is injected (no cycle). */
export function hingesTowardCooker(state, getCab) {
  const rot = (it) => ((((it.rotDeg || 0) % 360) + 360) % 360);
  const along = (it) => ({ 0: it.x, 180: -it.x, 90: -it.z, 270: it.z })[rot(it)];       // viewer's left → right
  const perp = (it) => (rot(it) % 180 === 0 ? it.z : it.x);
  const out = new Map();
  const items = (state.items || []).filter((it) => !it.island && rot(it) % 90 === 0);
  for (const ck of items) {
    const cc = getCab(ck.code);
    if (!cc || !['range', 'hob', 'hood'].includes(cc.appliance)) continue;
    const c0 = along(ck) - cc.w / 2, c1 = along(ck) + cc.w / 2;
    let left = null, right = null;
    for (const u of items) {
      const uc = getCab(u.code);
      if (!uc || uc.stacker || (uc.type !== 'WALL' && uc.type !== 'COUNTER') || !canFlipHinge(uc)) continue;
      if (rot(u) !== rot(ck) || Math.abs(perp(u) - perp(ck)) > 16) continue;
      const u0 = along(u) - uc.w / 2, u1 = along(u) + uc.w / 2;
      if (u1 <= c0 + 1 && c0 - u1 <= 12 && (!left || u1 > left.edge)) left = { id: u.id, edge: u1 };
      if (u0 >= c1 - 1 && u0 - c1 <= 12 && (!right || u0 < right.edge)) right = { id: u.id, edge: u0 };
    }
    if (left) out.set(left.id, 'L');       // hung on the far (left) side → knob by the cooker
    if (right) out.set(right.id, 'R');
  }
  return [...out].map(([id, hinge]) => ({ id, hinge }));
}

const LABEL = { L: 'Left', R: 'Right', PAIR: 'Pair' };
/** Schedule wording: 'Left' | 'Right' | 'Pair' | '' (nothing hinges). */
export function hingeLabel(h) { return LABEL[h] || ''; }

/** How the placed items sharing one SKU hang. Long form is the cut-sheet line
 *  ("1 × left hung, 2 × right hung"), short form the schedule cell ("1 Left ·
 *  2 Right"). '' when nothing hinges. */
export function hingeSummary(cab, items, short = false) {
  const sides = (items || []).map((it) => hingeOf(cab, it)).filter(Boolean);
  if (!sides.length) return '';
  if (sides[0] === 'PAIR') return short ? 'Pair' : 'Left + right hung pair';
  const l = sides.filter((s) => s === 'L').length, r = sides.length - l;
  if (!r) return short ? 'Left' : 'Left hung';
  if (!l) return short ? 'Right' : 'Right hung';
  return short ? `${l} Left · ${r} Right` : `${l} × left hung, ${r} × right hung`;
}

/** The one side every placed item of this SKU shares ('L' | 'R' | 'PAIR'), or
 *  null when they differ / nothing hinges — drives the cut-sheet swing marks. */
export function sharedHinge(cab, items) {
  const sides = new Set((items || []).map((it) => hingeOf(cab, it)));
  return sides.size === 1 ? [...sides][0] : null;
}
