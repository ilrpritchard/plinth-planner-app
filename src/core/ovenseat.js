// ovenseat.js — PURE. Where a wall oven sits in an oven housing (T9 / T14 /
// T15), so the housing model, the oven appliance and the snap all agree.
// A wall oven is a RIDER, like a sink in a base: it lives inside its housing,
// follows it when it moves, and leaves with it. Inches.

import { SPEC, mmToIn } from './units.js';
import { getCab } from './catalogue.js';

const TOPRAIL = mmToIn(35);

/** The housing's front, bottom to top: low door, drawer panel, oven, blank. */
export function ovenSeat(housing) {
  const openY0 = SPEC.PLINTH_IN + SPEC.PANEL_IN;
  const openH = housing.h - TOPRAIL - openY0;
  if (housing.form === 'ovenBase') {
    // the UNDER-COUNTER housing (F32): the oven sits right under the top rail, a slim drawer
    // panel fills the rest down to the plinth. No low door.
    const ovenH = mmToIn(595);
    return { openY0, openH, doorH: 0, drawH: openH - ovenH - 2 * SPEC.REVEAL_IN, y0: openY0 + openH - ovenH, ovenH,
      faceW: housing.w - 2 * SPEC.LEG_IN - 2 * SPEC.REVEAL_IN, ovenW: housing.ovenW || 24 };
  }
  const doorH = openH * 0.26, drawH = openH * 0.09;
  return {
    openY0, openH, doorH, drawH,
    y0: openY0 + doorH + drawH + 2 * SPEC.REVEAL_IN,        // oven fascia bottom, from the floor
    ovenH: housing.w >= 36 ? 24 : 29,                       // a 36" oven is wide and short
    faceW: housing.w - 2 * SPEC.LEG_IN - 2 * SPEC.REVEAL_IN,
    ovenW: housing.ovenW || 24,                             // T9 predates the field: a 24" oven
  };
}

export const isOven = (cab) => !!cab && cab.type === 'APPLIANCES' && cab.appliance === 'oven';
export const isOvenHousing = (cab) => !!cab && (cab.form === 'ovenHousing' || cab.form === 'ovenBase');
// a wall oven rides a tall housing, an under-counter oven the base housing: width AND kind must match
export const housingTakes = (housing, oven) => isOvenHousing(housing) && isOven(oven) && (housing.ovenW || 24) === oven.ovenW && (housing.ovenKind || 'wall') === (oven.ovenKind || 'wall');

/** The housing SKU made for this oven. */
export function housingCodeFor(oven) {
  if (oven.ovenKind === 'under') return oven.ovenW === 24 ? 'F32' : null;
  return oven.ovenW === 24 ? 'T9' : oven.ovenW === 30 ? 'T14' : oven.ovenW === 36 ? 'T15' : null;
}

/** The oven riding in this housing, if any. */
export function ovenIn(state, housingId) {
  return (state.items || []).find((o) => o.hostId === housingId && isOven(getCab(o.code))) || null;
}

/** Nearest empty housing this oven fits, measured from (x, z). `selfId` is the
 *  oven being dragged: the housing it already rides in still counts as free. */
export function findOvenHost(state, oven, x = 0, z = 0, selfId = null) {
  let best = null, bestD = Infinity;
  for (const h of state.items || []) {
    if (!housingTakes(getCab(h.code), oven)) continue;
    const rider = ovenIn(state, h.id);
    if (rider && rider.id !== selfId) continue;
    const d = Math.hypot(h.x - x, h.z - z);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}
