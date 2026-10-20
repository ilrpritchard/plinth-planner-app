// ovenseat.js — PURE. Where a wall oven sits in an oven housing (T9 / T14 /
// T15), so the housing model, the oven appliance and the snap all agree.
// A wall oven is a RIDER, like a sink in a base: it lives inside its housing,
// follows it when it moves, and leaves with it. Inches.

import { SPEC, mmToIn } from './units.js';
import { getCab } from './catalogue.js';

const TOPRAIL = mmToIn(35);

/** The housing's front, bottom to top: low door, oven (base 900mm off the floor), upper door. */
export function ovenSeat(housing) {
  const openY0 = SPEC.PLINTH_IN + SPEC.PANEL_IN;
  const openH = housing.h - TOPRAIL - openY0;
  if (housing.form === 'ovenBase') {
    // the UNDER-COUNTER housing (F32): the oven sits right under the top rail, a slim drawer
    // panel fills the rest down to the plinth. No low door.
    // a 22mm painted rail, the front edge of the shelf the oven stands on, between the oven and
    // the drawer (her: "there would be a strip of wood, top of drawer, so if the oven was removed it
    // would have a base", 2026-09-22)
    const faceW = housing.w - 2 * SPEC.LEG_IN - 2 * SPEC.REVEAL_IN, ovenW = housing.ovenW || 24;
    // a US 30" or 36" single oven stands about 725mm: it fills the whole opening under the top rail,
    // no drawer panel and no rail (her question 2026-10-09; proposed sizes, pack-only so far)
    // the bespoke Bosch under-worktop fit (F32:fit): no top rail, the oven on a shelf 602mm under the
    // worktop, a 7mm gap over it (its 595mm front), the shelf's 22mm painted edge under it, the drawer below
    if (housing.ovenFit) {
      const ovenH = mmToIn(595), railH = SPEC.PANEL_IN, y0 = housing.h - mmToIn(602);
      return { openY0, openH: housing.h - openY0, doorH: 0, railH, drawH: y0 - railH - 2 * SPEC.REVEAL_IN - openY0, y0, ovenH, faceW, ovenW, noTopRail: true };
    }
    if (ovenW >= 30) return { openY0, openH, doorH: 0, railH: 0, drawH: 0, y0: openY0, ovenH: openH, faceW, ovenW };
    const ovenH = mmToIn(595), railH = SPEC.PANEL_IN;
    return { openY0, openH, doorH: 0, railH, drawH: openH - ovenH - railH - 2 * SPEC.REVEAL_IN, y0: openY0 + openH - ovenH, ovenH, faceW, ovenW };
  }
  // the TALL housing (T9 / T14 / T15), her spec 2026-10-08 ("a cabinet above it and a cabinet below
  // it, the oven would sit at like 900mm from the floor to the base of the oven"): a cupboard door
  // below, the oven with its base 900mm off the floor, a cupboard door above. No drawer panel.
  const y0 = mmToIn(OVEN_SEAT_MM);
  const ovenH = wallOvenH(housing.ovenW || 24);
  const doorH = y0 - SPEC.REVEAL_IN - openY0;               // the low cupboard, plinth panel to the oven
  const upperY0 = y0 + ovenH + SPEC.REVEAL_IN;              // the upper cupboard starts here
  const upperH = housing.h - TOPRAIL - upperY0;             // ...and runs to the top rail
  return {
    openY0, openH, doorH, drawH: 0, y0, ovenH, upperY0, upperH,
    faceW: housing.w - 2 * SPEC.LEG_IN - 2 * SPEC.REVEAL_IN,
    ovenW: housing.ovenW || 24,                             // T9 predates the field: a 24" oven
  };
}

/** Floor to the base of a wall oven in a tall housing, mm. catalogue.js OVEN_SEAT_Y is the same number. */
export const OVEN_SEAT_MM = 900;
/** The fascia height of a wall oven by its width: a 24" (60cm) oven is 595mm like the under-counter
 *  one (Miele H7660BP), a 30" stands ~29", a 36" is wide and short. */
export const wallOvenH = (ovenW) => ovenW >= 36 ? 24 : ovenW >= 30 ? 29 : mmToIn(595);

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
