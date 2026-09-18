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
  if (cab.form === 'corner') return cab.cornerSide === 'right' ? 'R' : 'L';   // hinge on the blank side
  if (isPair(cab)) return 'PAIR';
  if (!SINGLE_LEAF.has(cab.form)) return null;
  return it && it.hinge === 'R' ? 'R' : 'L';
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
