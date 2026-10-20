// fridgeseat.js — PURE. An integrated 60/40 fridge-freezer built into a tall housing to the
// appliance's own niche (her pick 2026-10-20: Bosch KIN86NSE0G, "design it so that fridge works").
// Bosch's figures: niche 1775mm high (min = max), 560mm wide (min = max), at least 550mm deep;
// SLIDING hinge, so the housing carries its own furniture doors, one per appliance door, split
// where the appliance doors split (freezer door 642mm), at least 2mm apart; 200cm² of air in
// at the plinth and out at the top. Inches, measured up from the floor.
//
//   fridgeFront(cab) -> { y0, split, nicheY0, nicheTop, shelfTop, top, faceW }
//   front, bottom to top: freezer door (y0 → split) · fridge door (split → nicheTop) ·
//   a 22mm painted rail, the front of the fixed shelf the niche stops under · cupboard door (shelfTop → top)

import { SPEC, mmToIn } from './units.js';

export const FRIDGE_NICHE = { h: mmToIn(1775), w: mmToIn(560), d: mmToIn(550), freezerDoor: mmToIn(642), gap: mmToIn(3), ventCm2: 200 };
const TOPRAIL = mmToIn(35);

/** Does a housing this wide give the 560mm niche (its inside, between the 22mm sides)? */
export const fitsFridgeNiche = (w) => { const inside = w - 2 * SPEC.PANEL_IN; return inside >= FRIDGE_NICHE.w - 0.02 && inside <= FRIDGE_NICHE.w + mmToIn(10); };

export function fridgeFront(cab) {
  const y0 = SPEC.PLINTH_IN;                                   // fronts come down to the flush plinth
  const nicheY0 = SPEC.PLINTH_IN + SPEC.PANEL_IN;              // the appliance stands on the carcass floor
  const nicheTop = nicheY0 + FRIDGE_NICHE.h;                   // the fixed shelf's underside
  const split = nicheY0 + FRIDGE_NICHE.freezerDoor;            // furniture doors split with the appliance doors
  const shelfTop = nicheTop + SPEC.PANEL_IN;
  const top = cab.h - TOPRAIL;
  const faceW = cab.w - 2 * SPEC.LEG_IN - 2 * SPEC.REVEAL_IN;
  return { y0, split, nicheY0, nicheTop, shelfTop, top, faceW, gap: FRIDGE_NICHE.gap };
}
