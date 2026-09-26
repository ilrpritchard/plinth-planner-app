// catalogue.js — the Plinth block catalogue, finishes, and customer pricing.
//
// Cabinet dimensions (w/d/h, inches) and customer sell prices (usd, whole
// dollars) come from Plinth's internal pricing sheet via
// Sales_and_Pricing/sync_catalog.py — never hand-edit a `usd:` value here.
// Workshop costs, tariff, FX and margin live in that sheet, NOT in this file
// (this file ships to every visitor's browser). Each item is given a `form`
// that tells the procedural builder how to construct it. No external data.

import { SPEC, mmToIn, SURFACE_Y } from './units.js';

// ----- raw catalogue (from costing tool) ---------------------------------
// type: FLOOR | WALL | COUNTER | TALL | ACCESSORIES
const RAW = [
  // FLOOR — singles
  { code: 'F1', type: 'FLOOR', desc: 'Single', w: 20, d: 24, h: 35, hinge: 'L&R', usd: 2105 },
  { code: 'F2', type: 'FLOOR', desc: 'Single', w: 24, d: 24, h: 35, hinge: 'L&R', usd: 2117 },
  { code: 'F3', type: 'FLOOR', desc: 'Single', w: 28, d: 24, h: 35, hinge: 'L&R', usd: 2126 },
  { code: 'F4', type: 'FLOOR', desc: 'Single (Half Depth)', w: 20, d: 14, h: 35, hinge: 'L&R', usd: 2063 },
  { code: 'F5', type: 'FLOOR', desc: 'Single (Half Depth)', w: 24, d: 14, h: 35, hinge: 'L&R', usd: 2072 },
  { code: 'F6', type: 'FLOOR', desc: 'Single (Half Depth)', w: 28, d: 14, h: 35, hinge: 'L&R', usd: 2084 },
  // FLOOR — appliance / specials
  { code: 'F7', type: 'FLOOR', desc: 'Dishwasher Door & Plinth', w: 24, d: 24, h: 35, hinge: 'n/a', usd: 939, notes: 'Dishwasher door panel + plinth' },
  // END LEG (her ask 2026-09-22): a single painted 22mm upright, 35" with the plinth continuing
  // under it, for the end of a run beside a dishwasher front, a range or anything else legless,
  // so the legless front has a leg to close against and the run finishes like every other door.
  // One product, either hand (it is symmetrical). Counts as a leg-bearing cabinet everywhere.
  // $150 (her call 2026-09-22: between the $91 scribe filler and any cabinet).
  { code: 'F34', type: 'FLOOR', desc: 'End Leg', w: mmToIn(22), d: 24, h: 35, hinge: 'n/a', usd: 150, notes: 'A single painted 22mm leg with the plinth under it: the end of a run beside a dishwasher front or a range, either hand. Scribed to the wall like any run end.' },
  // the 18" (slimline) dishwasher front, same legless panel + plinth (her ask 2026-09-22); priced as F7 less 20%
  { code: 'F33', type: 'FLOOR', desc: 'Dishwasher Door & Plinth (18")', w: 18, d: 24, h: 35, hinge: 'n/a', usd: 751, notes: 'Door panel + plinth for an 18" dishwasher, appliance not supplied' },
  { code: 'F8', type: 'FLOOR', desc: 'Tray Space (Adjustable)', w: 10, d: 24, h: 35, hinge: 'n/a', usd: 1744, notes: 'Open tray space, no door' },
  // FLOOR — doubles
  { code: 'F9', type: 'FLOOR', desc: 'Double', w: 28, d: 24, h: 35, hinge: 'n/a', usd: 3065 },
  { code: 'F10', type: 'FLOOR', desc: 'Double', w: 36, d: 24, h: 35, hinge: 'n/a', usd: 3210 },
  { code: 'F11', type: 'FLOOR', desc: 'Double', w: 42, d: 24, h: 35, hinge: 'n/a', usd: 3316 },
  { code: 'F12', type: 'FLOOR', desc: 'Double (Half Depth)', w: 28, d: 14, h: 35, hinge: 'n/a', usd: 3019 },
  { code: 'F13', type: 'FLOOR', desc: 'Double (Half Depth)', w: 36, d: 14, h: 35, hinge: 'n/a', usd: 3168 },
  { code: 'F14', type: 'FLOOR', desc: 'Double (Half Depth)', w: 42, d: 14, h: 35, hinge: 'n/a', usd: 3274 },
  // FLOOR — corner (with return)
  { code: 'F15', type: 'FLOOR', desc: 'Corner (+20") · blank left', w: 20, d: 24, h: 35, hinge: 'L&R', usd: 3004, corner: true, cornerSide: 'left' },
  { code: 'F15R', type: 'FLOOR', desc: 'Corner (+20") · blank right', w: 20, d: 24, h: 35, hinge: 'L&R', usd: 3004, corner: true, cornerSide: 'right' },
  { code: 'F16', type: 'FLOOR', desc: 'Corner (+20") · blank left', w: 24, d: 24, h: 35, hinge: 'L&R', usd: 3068, corner: true, cornerSide: 'left' },
  { code: 'F16R', type: 'FLOOR', desc: 'Corner (+20") · blank right', w: 24, d: 24, h: 35, hinge: 'L&R', usd: 3068, corner: true, cornerSide: 'right' },
  // FLOOR — drawers
  { code: 'F17', type: 'FLOOR', desc: 'Drawers (3)', w: 20, d: 24, h: 35, hinge: 'n/a', usd: 3398 },
  { code: 'F18', type: 'FLOOR', desc: 'Drawers (3)', w: 24, d: 24, h: 35, hinge: 'n/a', usd: 3420 },
  { code: 'F19', type: 'FLOOR', desc: 'Drawers (3)', w: 28, d: 24, h: 35, hinge: 'n/a', usd: 3547 },
  { code: 'F20', type: 'FLOOR', desc: 'Drawers (3)', w: 36, d: 24, h: 35, hinge: 'n/a', usd: 3696 },
  // FLOOR — bins
  { code: 'F21', type: 'FLOOR', desc: 'Pull Out Bin', w: 20, d: 24, h: 35, hinge: 'n/a', usd: 2724, notes: 'Vauth Sagel bin insert' },
  { code: 'F22', type: 'FLOOR', desc: 'Pull Out Bin', w: 26, d: 24, h: 35, hinge: 'n/a', usd: 2879, notes: 'Vauth Sagel bin insert' },
  // FLOOR — open shelves
  { code: 'F23', type: 'FLOOR', desc: 'Open Shelves', w: 20, d: 24, h: 35, hinge: 'n/a', usd: 1522 },
  { code: 'F24', type: 'FLOOR', desc: 'Open Shelves', w: 24, d: 24, h: 35, hinge: 'n/a', usd: 1543 },
  { code: 'F25', type: 'FLOOR', desc: 'Open Shelves', w: 28, d: 24, h: 35, hinge: 'n/a', usd: 1671 },
  { code: 'F26', type: 'FLOOR', desc: 'Open Shelves (Half Depth)', w: 20, d: 14, h: 35, hinge: 'n/a', usd: 1480 },
  { code: 'F27', type: 'FLOOR', desc: 'Open Shelves (Half Depth)', w: 24, d: 14, h: 35, hinge: 'n/a', usd: 1501 },
  { code: 'F28', type: 'FLOOR', desc: 'Open Shelves (Half Depth)', w: 28, d: 14, h: 35, hinge: 'n/a', usd: 1628 },
  // FLOOR — panel-ready undercounter appliance front (wine / beverage / drawers)
  { code: 'F29', type: 'FLOOR', desc: 'Undercounter Appliance Door & Plinth', w: 24, d: 24, h: 35, hinge: 'n/a', usd: 939, notes: 'Door panel + plinth for a 24" panel-ready undercounter unit (wine, beverage, refrigerator drawers), appliance not supplied. Panel supplied undrilled.' },
  // FLOOR — cooktop bases (36" — the standard rangetop width on multi-unit
  // work). Fronts are IDENTICAL to F20 / F10; the difference is inside: the
  // cooktop body drops into the top of the carcass.
  { code: 'F30', type: 'FLOOR', desc: 'Cooktop Drawers (3)', w: 36, d: 24, h: 35, hinge: 'n/a', usd: 3696, notes: 'Drawer bank prepped for a 36" cooktop over. Fronts identical to F20, the top front is FALSE (fixed in the workshop) so the cooktop body drops in; lower two drawers work as normal. Cooktop not supplied.' },
  // UNDER-COUNTER OVEN HOUSING (her ask 2026-09-22, Miele H7660BP as the example: a 60cm single
  // oven, 23.4" high, that sits in a base cabinet under the worktop with a cooktop over it).
  // Same principles as every floor cabinet: legs, the flush 115mm plinth, the 35mm top rail.
  // Front, bottom to top: a slim drawer panel, then the oven aperture right under the rail.
  // ovenKind 'under' pairs it with AP21 (core/ovenseat.js), never with a 29" wall oven.
  // PRICE (her call 2026-09-22): the same as the 24" single floor cabinet (F2) for now.
  { code: 'F32', type: 'FLOOR', desc: 'Oven Housing, under counter (24")', w: 24, d: 24, h: 35, hinge: 'n/a', usd: 2117, ovenW: 24, ovenKind: 'under', notes: 'Base housing for a 24" (60cm) single oven under the worktop, a cooktop over it. Oven and cooktop not supplied: sized to the Miele H7660BP (23.4" high) and a 60cm hob. Confirm the cutout against the oven chosen.' },
  { code: 'F31', type: 'FLOOR', desc: 'Cooktop Double', w: 36, d: 24, h: 35, hinge: 'n/a', usd: 3210, notes: 'Double door base prepped for a 36" cooktop over, top of the carcass is cut back for the cooktop body. Cooktop not supplied.' },

  // WALL
  { code: 'W1', type: 'WALL', desc: 'Single', w: 20, d: 14, h: 30, hinge: 'L&R', usd: 1868 },
  { code: 'W2', type: 'WALL', desc: 'Single', w: 24, d: 14, h: 30, hinge: 'L&R', usd: 1890 },
  { code: 'W3', type: 'WALL', desc: 'Single (Glazed)', w: 20, d: 14, h: 30, hinge: 'L&R', usd: 2054, glazed: true },
  { code: 'W4', type: 'WALL', desc: 'Single (Glazed)', w: 24, d: 14, h: 30, hinge: 'L&R', usd: 2075, glazed: true },
  { code: 'W5', type: 'WALL', desc: 'Double', w: 36, d: 14, h: 30, hinge: 'n/a', usd: 2551 },
  { code: 'W6', type: 'WALL', desc: 'Double', w: 42, d: 14, h: 30, hinge: 'n/a', usd: 2658 },
  { code: 'W7', type: 'WALL', desc: 'Double (Glazed)', w: 36, d: 14, h: 30, hinge: 'n/a', usd: 3116, glazed: true },
  { code: 'W8', type: 'WALL', desc: 'Double (Glazed)', w: 42, d: 14, h: 30, hinge: 'n/a', usd: 3222, glazed: true },
  // handed like the floor corners (her ask 2026-09-22: "wall cabinets with blanks on the left and the right")
  { code: 'W9', type: 'WALL', desc: 'Corner (+10") · blank left', w: 20, d: 14, h: 30, hinge: 'L&R', usd: 2011, corner: true, cornerSide: 'left' },
  { code: 'W9R', type: 'WALL', desc: 'Corner (+10") · blank right', w: 20, d: 14, h: 30, hinge: 'L&R', usd: 2011, corner: true, cornerSide: 'right' },
  { code: 'W10', type: 'WALL', desc: 'Corner (+10") · blank left', w: 24, d: 14, h: 30, hinge: 'L&R', usd: 2160, corner: true, cornerSide: 'left' },
  { code: 'W10R', type: 'WALL', desc: 'Corner (+10") · blank right', w: 24, d: 14, h: 30, hinge: 'L&R', usd: 2160, corner: true, cornerSide: 'right' },
  // DOUBLE corners (her ask 2026-09-25, "double full height wall corners"): the 36" / 42" doubles
  // with the 10" blank return, a door pair meeting in the middle, both hands. `pair` marks the
  // two leaves (hinge / plan / 3D / elevation / DXF all read it). PRICE (her rule 2026-09-25, "W5 and
  // W6 plus the corner uplift", then "use the average"): the double + the AVERAGE of what the two wall
  // corners carry over their plain singles (W9 - W1 $143, W10 - W2 $270 → $207), set below from `priceFrom`.
  { code: 'W31', type: 'WALL', desc: 'Corner Double (+10") · blank left', w: 36, d: 14, h: 30, hinge: 'n/a', usd: 0, priceFrom: 'W5', corner: true, pair: true, cornerSide: 'left' },
  { code: 'W31R', type: 'WALL', desc: 'Corner Double (+10") · blank right', w: 36, d: 14, h: 30, hinge: 'n/a', usd: 0, priceFrom: 'W5', corner: true, pair: true, cornerSide: 'right' },
  { code: 'W32', type: 'WALL', desc: 'Corner Double (+10") · blank left', w: 42, d: 14, h: 30, hinge: 'n/a', usd: 0, priceFrom: 'W6', corner: true, pair: true, cornerSide: 'left' },
  { code: 'W32R', type: 'WALL', desc: 'Corner Double (+10") · blank right', w: 42, d: 14, h: 30, hinge: 'n/a', usd: 0, priceFrom: 'W6', corner: true, pair: true, cornerSide: 'right' },
  { code: 'W11', type: 'WALL', desc: 'Open Shelves', w: 20, d: 14, h: 30, hinge: 'n/a', usd: 1389 },
  { code: 'W12', type: 'WALL', desc: 'Open Shelves', w: 24, d: 14, h: 30, hinge: 'n/a', usd: 1410 },
  { code: 'W13', type: 'WALL', desc: 'Open Shelves', w: 28, d: 14, h: 30, hinge: 'n/a', usd: 1537 },
  // a small open shelf for the odd gap beside a corner unit (her ask 2026-09-22, "keep it round inch
  // numbers though we can scribe it too"); price to confirm
  // 10": on the wall BESIDE the tall, pulled forward flush with its face (her ask 2026-09-22); between the
  // tall's near end (24.25" out) and the front of a corner wall unit's return (14.25" out) there is 10"
  { code: 'W25', type: 'WALL', desc: 'Open Shelves', w: 10, d: 14, h: 30, hinge: 'n/a', usd: 0, priceTBC: true },
  // HOOD COVER (her ask 2026-09-22, "a vent / extractor cover to go here, same door panel as the cabinets"):
  // a hung box over the cooker with one FIXED shaker panel, no knob, no hinge; it conceals a 24" extractor
  // insert (supply your own: the AP23 canopy sits inside it) and its top lands on the 86" crown line, so
  // the flue above is a 24" wall stacker. 20" deep to take the canopy. It RIDES the cooker like the hood.
  { code: 'W26', type: 'WALL', desc: 'Hood Cover', w: 24, d: 20, h: 16, hinge: 'n/a', usd: 0, priceTBC: true, mountY: 70, hoodCover: true, notes: 'Fixed shaker panel over a built-in canopy extractor up to 54cm wide, such as the AEG DGE5661HM (supplied by others): only its liner shows underneath. Sits between the wall cabinets with its top on the crown line; add a stacker above to hide the flue.' },
  // WALL — S-series STACKERS: boxes that sit ON TOP of an existing run for
  // tall ceilings, matched per family so every wall/tall/counter cabinet has
  // a stacker with the SAME width, the right depth, and its mountY exactly at
  // the host's top (talls top 86" and stand 30mm proud → d 25.25" lands the
  // stacker face flush; wall runs top 86", level with the talls, and counters 86.5" at d 14").
  // Two heights: 15" (9'+ ceilings) and 21" (10'). stacker: true marks them.
  // Enforced by test/trade-upgrades.test.js: every non-corner W/T/C cabinet
  // must have a matching stacker — extend this list with any new width.
  // fits the TALL run (24/27/28/30/33/39/44 wide, d 24, stands proud with the tall, mount 86)
  { code: 'S1', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits T1, T3)', w: 24, d: 24, onTall: true, h: 15, hinge: 'L&R', usd: 1632, mountY: 86, notes: 'Sits on the 86" tall run, face flush with the tall below. For 9\'+ ceilings.' },
  { code: 'S2', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits T10)', w: 27, d: 24, onTall: true, h: 15, hinge: 'L&R', usd: 1707, mountY: 86, notes: 'Sits on the T10 panel-ready housing. For 9\'+ ceilings.' },
  { code: 'S3', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits T2, T5, T6)', w: 28, d: 24, onTall: true, h: 15, hinge: 'L&R', usd: 1738, mountY: 86, notes: 'Sits on the 86" tall run, face flush with the tall below. For 9\'+ ceilings.' },
  { code: 'S4', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits T4, T9)', w: 30, d: 24, onTall: true, h: 15, hinge: 'n/a', usd: 1905, mountY: 86, notes: 'Sits on the 86" tall run, face flush with the tall below. For 9\'+ ceilings.' },
  { code: 'S5', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits T11, T14)', w: 33, d: 24, onTall: true, h: 15, hinge: 'n/a', usd: 2011, mountY: 86, notes: 'Sits on the T11 panel-ready housing or the T14 oven housing. For 9\'+ ceilings.' },
  { code: 'S6', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits T12, T15)', w: 39, d: 24, onTall: true, h: 15, hinge: 'n/a', usd: 2178, mountY: 86, notes: 'Sits on the T12 panel-ready housing or the T15 oven housing. For 9\'+ ceilings.' },
  { code: 'S7', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits T7, T8, T13)', w: 44, d: 24, onTall: true, h: 15, hinge: 'n/a', usd: 2315, mountY: 86, notes: 'Sits on the 44" double larder. For 9\'+ ceilings.' },
  { code: 'S8', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits T1, T3)', w: 24, d: 24, onTall: true, h: 21, hinge: 'L&R', usd: 1798, mountY: 86, notes: 'Sits on the 86" tall run, face flush with the tall below. For 10\'+ ceilings.' },
  { code: 'S9', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits T10)', w: 27, d: 24, onTall: true, h: 21, hinge: 'L&R', usd: 1874, mountY: 86, notes: 'Sits on the T10 panel-ready housing. For 10\'+ ceilings.' },
  { code: 'S10', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits T2, T5, T6)', w: 28, d: 24, onTall: true, h: 21, hinge: 'L&R', usd: 1905, mountY: 86, notes: 'Sits on the 86" tall run, face flush with the tall below. For 10\'+ ceilings.' },
  { code: 'S11', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits T4, T9)', w: 30, d: 24, onTall: true, h: 21, hinge: 'n/a', usd: 2072, mountY: 86, notes: 'Sits on the 86" tall run, face flush with the tall below. For 10\'+ ceilings.' },
  { code: 'S12', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits T11, T14)', w: 33, d: 24, onTall: true, h: 21, hinge: 'n/a', usd: 2178, mountY: 86, notes: 'Sits on the T11 panel-ready housing or the T14 oven housing. For 10\'+ ceilings.' },
  { code: 'S13', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits T12, T15)', w: 39, d: 24, onTall: true, h: 21, hinge: 'n/a', usd: 2345, mountY: 86, notes: 'Sits on the T12 panel-ready housing or the T15 oven housing. For 10\'+ ceilings.' },
  { code: 'S14', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits T7, T8, T13)', w: 44, d: 24, onTall: true, h: 21, hinge: 'n/a', usd: 2482, mountY: 86, notes: 'Sits on the 44" double larder. For 10\'+ ceilings.' },
  // fits the WALL run (20/24/28/36/42 wide, d 14, mount 86 — stacked uppers)
  { code: 'S15', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits W1, W3, W11)', w: 20, d: 14, h: 15, hinge: 'L&R', usd: 1419, mountY: 86, notes: 'Sits directly on a standard hung wall run (tops at 86"), stacked uppers to the ceiling.' },
  { code: 'S16', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits W2, W4, W12, W26)', w: 24, d: 14, h: 15, hinge: 'L&R', usd: 1495, mountY: 86, notes: 'Sits directly on a standard hung wall run (tops at 86"), stacked uppers to the ceiling.' },
  { code: 'S17', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits W13)', w: 28, d: 14, h: 15, hinge: 'L&R', usd: 1601, mountY: 86, notes: 'Sits directly on a standard hung wall run (tops at 86"), stacked uppers to the ceiling.' },
  { code: 'S33', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits W25)', w: 10, d: 14, h: 15, hinge: 'L&R', usd: 0, priceTBC: true, mountY: 86, notes: 'Sits directly on a standard hung wall run (tops at 86"), stacked uppers to the ceiling.' },
  { code: 'S34', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits W25)', w: 10, d: 14, h: 21, hinge: 'L&R', usd: 0, priceTBC: true, mountY: 86, notes: 'Stacked uppers, the taller size, wall run + 21" reaches 107".' },
  { code: 'S18', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits W5, W7)', w: 36, d: 14, h: 15, hinge: 'n/a', usd: 1981, mountY: 86, notes: 'Sits directly on a standard hung wall run (tops at 86"), stacked uppers to the ceiling.' },
  { code: 'S19', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits W6, W8)', w: 42, d: 14, h: 15, hinge: 'n/a', usd: 2148, mountY: 86, notes: 'Sits directly on a standard hung wall run (tops at 86"), stacked uppers to the ceiling.' },
  { code: 'S20', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits W1, W3, W11)', w: 20, d: 14, h: 21, hinge: 'L&R', usd: 1586, mountY: 86, notes: 'Stacked uppers, the taller size, wall run + 21" reaches 105".' },
  { code: 'S21', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits W2, W4, W12, W26)', w: 24, d: 14, h: 21, hinge: 'L&R', usd: 1662, mountY: 86, notes: 'Stacked uppers, the taller size, wall run + 21" reaches 105".' },
  { code: 'S22', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits W13)', w: 28, d: 14, h: 21, hinge: 'L&R', usd: 1768, mountY: 86, notes: 'Stacked uppers, the taller size, wall run + 21" reaches 105".' },
  { code: 'S23', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits W5, W7)', w: 36, d: 14, h: 21, hinge: 'n/a', usd: 2148, mountY: 86, notes: 'Stacked uppers, the taller size, wall run + 21" reaches 105".' },
  { code: 'S24', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits W6, W8)', w: 42, d: 14, h: 21, hinge: 'n/a', usd: 2315, mountY: 86, notes: 'Stacked uppers, the taller size, wall run + 21" reaches 105".' },
  // fits the COUNTER dresser run (24/28/36/42 wide, d 14, mount = the counter cabinet's top)
  { code: 'S25', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits C1, C2)', w: 24, d: 14, h: 15, hinge: 'L&R', usd: 1495, mountY: SURFACE_Y + 50, notes: 'Sits on the counter-to-ceiling dresser run (tops at 86½"). For 9\'+ ceilings.' },
  { code: 'S26', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits C7)', w: 28, d: 14, h: 15, hinge: 'L&R', usd: 1601, mountY: SURFACE_Y + 50, notes: 'Sits on the counter-to-ceiling dresser run (tops at 86½"). For 9\'+ ceilings.' },
  { code: 'S27', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits C3, C5, C8)', w: 36, d: 14, h: 15, hinge: 'n/a', usd: 1981, mountY: SURFACE_Y + 50, notes: 'Sits on the counter-to-ceiling dresser run (tops at 86½"). For 9\'+ ceilings.' },
  { code: 'S28', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits C4, C6, C9)', w: 42, d: 14, h: 15, hinge: 'n/a', usd: 2148, mountY: SURFACE_Y + 50, notes: 'Sits on the counter-to-ceiling dresser run (tops at 86½"). For 9\'+ ceilings.' },
  { code: 'S29', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits C1, C2)', w: 24, d: 14, h: 21, hinge: 'L&R', usd: 1662, mountY: SURFACE_Y + 50, notes: 'Sits on the counter dresser run, the taller size, reaches 107½". For 10\'+ ceilings.' },
  { code: 'S30', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits C7)', w: 28, d: 14, h: 21, hinge: 'L&R', usd: 1768, mountY: SURFACE_Y + 50, notes: 'Sits on the counter dresser run, the taller size, reaches 107½". For 10\'+ ceilings.' },
  { code: 'S31', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits C3, C5, C8)', w: 36, d: 14, h: 21, hinge: 'n/a', usd: 2148, mountY: SURFACE_Y + 50, notes: 'Sits on the counter dresser run, the taller size, reaches 107½". For 10\'+ ceilings.' },
  { code: 'S32', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits C4, C6, C9)', w: 42, d: 14, h: 21, hinge: 'n/a', usd: 2315, mountY: SURFACE_Y + 50, notes: 'Sits on the counter dresser run, the taller size, reaches 107½". For 10\'+ ceilings.' },

  // COUNTER (50" tall, 14" deep — counter-to-ceiling dressers)
  { code: 'C1', type: 'COUNTER', desc: 'Single', w: 24, d: 14, h: 50, hinge: 'L&R', usd: 2354 },
  { code: 'C2', type: 'COUNTER', desc: 'Single (Glazed)', w: 24, d: 14, h: 50, hinge: 'L&R', usd: 2542, glazed: true },
  { code: 'C3', type: 'COUNTER', desc: 'Double', w: 36, d: 14, h: 50, hinge: 'n/a', usd: 2995 },
  { code: 'C4', type: 'COUNTER', desc: 'Double', w: 42, d: 14, h: 50, hinge: 'n/a', usd: 3165 },
  { code: 'C5', type: 'COUNTER', desc: 'Double (Glazed)', w: 36, d: 14, h: 50, hinge: 'n/a', usd: 3556, glazed: true },
  { code: 'C6', type: 'COUNTER', desc: 'Double (Glazed)', w: 42, d: 14, h: 50, hinge: 'n/a', usd: 3726, glazed: true },
  { code: 'C7', type: 'COUNTER', desc: 'Open Shelves', w: 28, d: 14, h: 50, hinge: 'n/a', usd: 1920 },
  { code: 'C8', type: 'COUNTER', desc: 'Open Shelves', w: 36, d: 14, h: 50, hinge: 'n/a', usd: 2069 },
  { code: 'C9', type: 'COUNTER', desc: 'Open Shelves', w: 42, d: 14, h: 50, hinge: 'n/a', usd: 2239 },

  // TALL (86" tall, 24" deep)
  { code: 'T1', type: 'TALL', desc: 'Single', w: 24, d: 24, h: 86, hinge: 'L&R', usd: 3775 },
  { code: 'T2', type: 'TALL', desc: 'Single', w: 28, d: 24, h: 86, hinge: 'L&R', usd: 3966 },
  { code: 'T3', type: 'TALL', desc: 'Housing (+3.5")', w: 24, d: 24, h: 86, hinge: 'n/a', usd: 3529, notes: 'Integrated fridge housing' },
  { code: 'T4', type: 'TALL', desc: 'Housing (+3.5")', w: 30, d: 24, h: 86, hinge: 'n/a', usd: 3657, notes: 'Integrated fridge housing' },
  { code: 'T5', type: 'TALL', desc: 'Single Larder', w: 28, d: 24, h: 86, hinge: 'L&R', usd: 3966 },
  { code: 'T6', type: 'TALL', desc: 'Single Larder (Drawers)', w: 28, d: 24, h: 86, hinge: 'L&R', usd: 5190 },
  { code: 'T7', type: 'TALL', desc: 'Double Larder', w: 44, d: 24, h: 86, hinge: 'n/a', usd: 5272 },
  { code: 'T8', type: 'TALL', desc: 'Double Larder (Drawers)', w: 44, d: 24, h: 86, hinge: 'n/a', usd: 6872 },
  { code: 'T9', type: 'TALL', desc: 'Oven Housing', w: 30, d: 24, h: 86, hinge: 'n/a', usd: 4303, notes: 'Housing for a single 24" wall oven (oven not supplied)' },
  // TALL — panel-ready column housings (refrigeration columns by others)
  { code: 'T10', type: 'TALL', desc: 'Panel-Ready Column Housing (24")', w: 27, d: 24, h: 86, hinge: 'n/a', usd: 4288, notes: 'Fits 24" panel-ready refrigeration columns (Sub-Zero, Thermador, Miele, Bosch, confirm model at order). Matching door panel set included, supplied undrilled. Appliance not supplied.' },
  { code: 'T11', type: 'TALL', desc: 'Panel-Ready Column Housing (30")', w: 33, d: 24, h: 86, hinge: 'n/a', usd: 4425, notes: 'Fits 30" panel-ready refrigeration columns (Sub-Zero, Thermador, Miele, confirm model at order). Matching door panel set included, supplied undrilled. Appliance not supplied.' },
  { code: 'T12', type: 'TALL', desc: 'Panel-Ready Column Housing (36")', w: 39, d: 24, h: 86, hinge: 'n/a', usd: 4576, notes: 'Fits 36" panel-ready French-door / column refrigeration (Sub-Zero, Thermador, Miele, confirm model at order). Matching door panel set included, supplied undrilled. Appliance not supplied.' },
  { code: 'T13', type: 'TALL', desc: 'Double', w: 44, d: 24, h: 86, hinge: 'n/a', usd: 5062, notes: 'Full-height double doors: left and right hinged pair. Adjustable shelves.' },
  // wider oven housings, sized like the T11/T12 column housings (appliance
  // width + 3": the 22mm legs clear a 30" / 36" oven's cutout, which a 30" / 36"
  // box would not). usd ASSUMED (T9 + the column housings' per-inch step) and
  // the widths are PROPOSED: workshop to confirm both before a first real quote.
  { code: 'T14', type: 'TALL', desc: 'Oven Housing (30")', w: 33, d: 24, h: 86, hinge: 'n/a', usd: 4375, ovenW: 30, notes: 'Housing for a single 30" wall oven (oven not supplied). Confirm the cutout against the oven model at order.' },
  { code: 'T15', type: 'TALL', desc: 'Oven Housing (36")', w: 39, d: 24, h: 86, hinge: 'n/a', usd: 4515, ovenW: 36, notes: 'Housing for a single 36" wall oven (Wolf, BlueStar, Gaggenau; oven not supplied). Double door below. Confirm the cutout against the oven model at order.' },

  // ACCESSORIES (no 3D geometry placed; listed in cut list only)
  { code: 'A2', type: 'ACCESSORIES', desc: 'End Panel (Floor)', w: 0, d: 0, h: 0, hinge: '', usd: 372 },
  { code: 'A3', type: 'ACCESSORIES', desc: 'Cutlery Insert 28"', w: 0, d: 0, h: 0, hinge: '', usd: 715 },
  { code: 'A4', type: 'ACCESSORIES', desc: 'Cutlery Insert 36"', w: 0, d: 0, h: 0, hinge: '', usd: 715 },
  { code: 'A5', type: 'ACCESSORIES', desc: 'Utensil Insert 24"', w: 0, d: 0, h: 0, hinge: '', usd: 715 },
  { code: 'A6', type: 'ACCESSORIES', desc: 'Utensil Insert 28"', w: 0, d: 0, h: 0, hinge: '', usd: 715 },
  { code: 'A8', type: 'ACCESSORIES', desc: 'End Panel (Wall)', w: 0, d: 0, h: 0, hinge: '', usd: 265 },
  { code: 'A9', type: 'ACCESSORIES', desc: 'End Panel (Counter)', w: 0, d: 0, h: 0, hinge: '', usd: 335 },
  { code: 'A10', type: 'ACCESSORIES', desc: 'End Panel (Tall)', w: 0, d: 0, h: 0, hinge: '', usd: 496 },
];

// ----- classify each item into a build form -----------------------------
// form: 'door'|'double'|'drawers'|'drawerDoor'|'sink'|'open'|'tray'|'bin'
//       |'dishwasher'|'housing'|'larder'|'larderDrawers'|'glazed'|'accessory'
function classify(it) {
  const d = it.desc.toLowerCase();
  if (it.type === 'ACCESSORIES') return 'accessory';
  if (it.corner) return 'corner';
  if (d === 'end leg') return 'leg';
  if (d.includes('drawers (3)')) return 'drawers';
  if (d.includes('larder (drawers)')) return 'larderDrawers';
  if (d.includes('larder')) return 'larder';
  if (d.includes('oven housing')) return it.type === 'FLOOR' ? 'ovenBase' : 'ovenHousing';
  if (d.includes('housing')) return 'housing';
  if (d.includes('undercounter appliance')) return 'dishwasher'; // legless panel front, same rules as F7
  if (d.includes('dishwasher')) return 'dishwasher';
  if (d.includes('tray')) return 'tray';
  if (d.includes('bin')) return 'bin';
  if (d.includes('hood cover')) return 'hoodCover';
  if (d.includes('open shelves')) return 'open';
  if (d.includes('double')) return it.glazed ? 'glazedDouble' : 'double';
  if (it.glazed) return 'glazed';            // single glazed
  return 'door';                              // plain single door
}

// ----- FULL-HEIGHT wall cabinets (her spec 2026-09-22) ---------------------------------
// "A lot of developers want wall cabinets that are high": every non-corner W cabinet in ONE
// taller height ("just 2 heights", standard and full), hung at the same 56" so the undersides
// line through, with ONE door and two shelves, and the top exactly where a tall + its 21"
// stacker ends: 30 + 21 = 51", top 107", a 10' ceiling. Codes carry on the W series, W14-W24,
// in the order of the cabinets they grow from. Price: the wall cabinet + 20% ("take the cost
// of the wall cabinet + 20%"), rounded to the dollar. `high` = the inches added, so the
// catalogue can group them and the ceiling check can read them.
// ----- the double corners' price: the double + the corner uplift (her rule 2026-09-25) --------------
const usdOf = (code) => RAW.find((c) => c.code === code).usd;
export const WALL_CORNER_UPLIFT = Math.round(((usdOf('W9') - usdOf('W1')) + (usdOf('W10') - usdOf('W2'))) / 2);   // (143 + 270) / 2 → $207
for (const c of RAW) if (c.priceFrom) c.usd = RAW.find((b) => b.code === c.priceFrom).usd + WALL_CORNER_UPLIFT;

// The CORNER wall cabinets grow too (her ask 2026-09-25, "full height wall corner cabinets"):
// W9 / W9R / W10 / W10R at 51" on W27-W30 (W25 is the 10" open shelf and W26 the hood cover,
// so the corners skip past them), same 10" blank return, same +20%, handed the same way.
const HIGH_BASES = [['W1', 'W14'], ['W2', 'W15'], ['W3', 'W16'], ['W4', 'W17'], ['W5', 'W18'], ['W6', 'W19'], ['W7', 'W20'], ['W8', 'W21'], ['W11', 'W22'], ['W12', 'W23'], ['W13', 'W24'],
  ['W9', 'W27'], ['W9R', 'W28'], ['W10', 'W29'], ['W10R', 'W30'],
  ['W31', 'W33'], ['W31R', 'W34'], ['W32', 'W35'], ['W32R', 'W36']];   // the double corners (her ask 2026-09-25)
const HIGH_ADD = 21;
const HIGH_WALLS = HIGH_BASES.map(([base, code]) => {
  const src = RAW.find((c) => c.code === base);
  const what = src.corner ? `${src.pair ? 'double ' : ''}corner wall cabinet with its 10" blank return` : `${src.desc.toLowerCase()} wall cabinet`;
  return { ...src, code, desc: `${src.desc}, full height ${30 + HIGH_ADD}"`, h: 30 + HIGH_ADD, usd: Math.round(src.usd * 1.2), high: HIGH_ADD, grewFrom: base,
    notes: `A ${what} ${30 + HIGH_ADD}" high in ${src.pair ? 'a pair of doors' : 'one door'} with two shelves: the height of the standard cabinet plus a 21" stacker, hung at the same 56". Tops at ${56 + 30 + HIGH_ADD}": needs a 10' ceiling.` };
});

const BASE_CATALOGUE = RAW.concat(HIGH_WALLS).map((it) => ({
  ...it,
  notes: it.notes || '',
  halfDepth: /half depth/i.test(it.desc),
  glazed: !!it.glazed,
  corner: !!it.corner,
  pair: !!it.pair,
  form: classify(it),
  placeable: it.type !== 'ACCESSORIES' && it.h > 0,
  notSupplied: false,
}));

export const FAMILY_ORDER = ['FLOOR', 'WALL', 'HIGH', 'COUNTER', 'TALL', 'STACKER', 'APPLIANCES', 'ACCESSORIES'];
export const FAMILY_LABEL = {
  FLOOR: 'Floor', WALL: 'Wall', COUNTER: 'Counter', TALL: 'Tall',
  HIGH: 'Wall, full height', STACKER: 'Stackers', APPLIANCES: 'Appliances', ACCESSORIES: 'Accessories',
};

/** DISPLAY family for grouping/labels: stackers get their own section even
 *  though their behavioural type stays 'WALL' (hung, wall-attached). */
export function familyOf(cab) {
  return cab && cab.stacker ? 'STACKER' : cab && cab.high ? 'HIGH' : cab && cab.type;
}

// ----- appliances (NOT Plinth products — visual placeholders, unpriced) ----
// Each sits at its own mount height: ranges/fridges on the floor, hobs & sinks
// in the worktop (36.5"). They snap to walls/runs like base units.
// floor to the bottom of the oven fascia in an 86" oven housing: plinth + base
// panel + low door (26% of the opening) + drawer panel (9%) + two reveals.
// core/ovenseat.js ovenSeat() derives the same number; build.test.js locks them together.
const OVEN_SEAT_Y = (() => {
  const openY0 = SPEC.PLINTH_IN + SPEC.PANEL_IN, openH = 86 - mmToIn(35) - openY0;
  return openY0 + openH * 0.35 + 2 * SPEC.REVEAL_IN;
})();
// floor to the bottom of a 23.4" oven sitting right under the top rail of a 35" base housing
// (F32): the aperture's top is the opening's top. core/ovenseat.js derives the same number.
const UNDER_OVEN_H = mmToIn(595);
const UNDER_OVEN_SEAT_Y = (() => {
  const openY0 = SPEC.PLINTH_IN + SPEC.PANEL_IN, openH = 35 - mmToIn(35) - openY0;
  return openY0 + openH - UNDER_OVEN_H;
})();
const APPLIANCES = [
  { code: 'AP1', appliance: 'range', desc: 'Range cooker 30"', w: 30, d: 26, h: 36, mountY: 0 },
  { code: 'AP2', appliance: 'range', desc: 'Range cooker 36"', w: 36, d: 26, h: 36, mountY: 0 },
  { code: 'AP3', appliance: 'range', desc: 'Range cooker 48"', w: 48, d: 26, h: 36, mountY: 0 },
  // wall ovens: RIDERS that live inside an oven housing (T9 24", T14 30", T15 36"), the
  // way a sink lives in a base. mountY = the housing's oven seat (core/ovenseat.js).
  { code: 'AP14', appliance: 'oven', ovenW: 24, desc: 'Wall oven 24"', w: 24, d: 23.7, h: 29, mountY: OVEN_SEAT_Y },
  { code: 'AP15', appliance: 'oven', ovenW: 30, desc: 'Wall oven 30"', w: 30, d: 23.7, h: 29, mountY: OVEN_SEAT_Y },
  // 36": wide and short (Wolf / BlueStar / Gaggenau), rides in T15 whose seat is 24" tall
  { code: 'AP16', appliance: 'oven', ovenW: 36, desc: 'Wall oven 36"', w: 36, d: 23.7, h: 24, mountY: OVEN_SEAT_Y },
  // the under-counter single oven (Miele H7660BP: 595 x 595 x 570mm), a RIDER in the F32 base housing
  { code: 'AP21', appliance: 'oven', ovenW: 24, ovenKind: 'under', desc: 'Oven, under counter 24"', w: 23.4, d: 22.4, h: UNDER_OVEN_H, mountY: UNDER_OVEN_SEAT_Y },
  { code: 'AP4', appliance: 'hob', desc: 'Cooktop 30" (5 burners)', w: 30, d: 21, h: 2, mountY: SURFACE_Y },   // sized to the Samsung NA30N6555TS (her example 2026-09-22)
  { code: 'AP5', appliance: 'hob', desc: 'Cooktop 36"', w: 36, d: 21, h: 2, mountY: SURFACE_Y },
  // the 60cm four-burner gas hob that goes over the under-counter oven (Bosch PCP6A6B90: 582 x 520mm)
  { code: 'AP22', appliance: 'hob', desc: 'Cooktop 24" (60cm, gas)', w: 22.9, d: 20.5, h: 2, mountY: SURFACE_Y },
  { code: 'AP6', appliance: 'sink', desc: 'Sink (Single)', w: 24, d: 20, h: 8, mountY: SURFACE_Y },
  { code: 'AP7', appliance: 'sink', desc: 'Sink (Double)', w: 33, d: 20, h: 8, mountY: SURFACE_Y },
  { code: 'AP10', appliance: 'sink', desc: 'Sink (Prep) 15"', w: 15, d: 18, h: 8, mountY: SURFACE_Y },
  // bigger undermounts, sized from the Franke Grande range she chose (9" deep,
  // wide-radius corners, rear drain). w = the sink's overall length; `bowl` is
  // the opening the worktop is cut to (core/sinkspec.js); minBase = the base
  // cabinet the maker asks for. Shown for layout only, never supplied.
  { code: 'AP17', appliance: 'sink', desc: 'Sink (Single) 25"', w: 24.75, d: 22, h: 9, mountY: SURFACE_Y, minBase: 30, bowl: { n: 1, w: 23, d: 17, depth: 9, r: 2.75 }, notes: 'Not supplied by PL/NTH, shown for layout only. Sized to the Franke Grande GDX11023 (24-3/4" x 18-3/4", 9" deep). Needs a 30" base.' },
  { code: 'AP18', appliance: 'sink', desc: 'Sink (Single) 30"', w: 30.125, d: 22, h: 9, mountY: SURFACE_Y, minBase: 36, bowl: { n: 1, w: 28, d: 17.4, depth: 9, r: 2.75 }, notes: 'Not supplied by PL/NTH, shown for layout only. Sized to the Franke Grande GDX11028 (30-1/8" x 19-1/8", 9" deep). Needs a 36" base.' },
  { code: 'AP19', appliance: 'sink', desc: 'Sink (Single) 33"', w: 32.75, d: 22, h: 9, mountY: SURFACE_Y, minBase: 36, bowl: { n: 1, w: 31, d: 17, depth: 9, r: 2.75 }, notes: 'Not supplied by PL/NTH, shown for layout only. Sized to the Franke Grande GDX11031 (32-3/4" x 18-3/4", 9" deep). Needs a 36" base.' },
  // the small undermount for a 20" single base (Blanco Andano 450-U: bowl 450 x 400, overall 490 x 440, 190 deep; her ask 2026-09-22)
  { code: 'AP25', appliance: 'sink', desc: 'Sink (Single) 18"', w: 19.3, d: 17.3, h: 7.5, mountY: SURFACE_Y, minBase: 20, bowl: { n: 1, w: 17.7, d: 15.7, depth: 7.5, r: 0.4 }, notes: 'Not supplied by PL/NTH, shown for layout only. Sized to the Blanco Andano 450-U (450 x 400mm bowl, 190mm deep). Needs a 20" base.' },
  { code: 'AP20', appliance: 'sink', desc: 'Sink (Double) 33"', w: 32.875, d: 22, h: 9, mountY: SURFACE_Y, minBase: 36, bowl: { n: 2, w: 15, d: 17, depth: 9, r: 2.5, divider: 1.1 }, notes: 'Not supplied by PL/NTH, shown for layout only. Sized to the Franke Grande GDX12031 (32-7/8" x 18-3/4", two 15" x 17" bowls, 9" deep). Needs a 36" base.' },
  { code: 'AP8', appliance: 'hood', desc: 'Range Hood 36"', w: 36, d: 20, h: 28, mountY: 36 + mmToIn(800) },   // underside 800mm over a range top (core/hoodseat.js)
  // the 24" (60cm) chimney hood over the F32 stack's cooktop (her ask 2026-09-22): same idiom, narrower canopy
  { code: 'AP23', appliance: 'hood', desc: 'Range Hood 24" (60cm)', w: 23.6, d: 19.7, h: 28, mountY: 36 + mmToIn(800) },
  // PLASTER CHIMNEY HOODS (her ask 2026-09-25, from a painted-plaster reference): a plain boxed
  // canopy in the wall colour, no trim, running from 800mm over the range to the ceiling, over
  // an extractor liner. Built on site BY OTHERS; in the planner for context. One per range size,
  // 50mm wider overall than the range it sits over (25mm each side).
  { code: 'AP26', appliance: 'hood', plaster: true, desc: 'Plaster Hood 32" (over a 30" range)', w: 30 + mmToIn(50), d: 20, h: 28, mountY: 36 + mmToIn(800), notes: 'A painted-plaster chimney hood built on site by others, shown for layout only: a plain box in the wall color, no trim, from 800mm above the range to the ceiling. 50mm wider than the 30" range (AP1).' },
  { code: 'AP27', appliance: 'hood', plaster: true, desc: 'Plaster Hood 38" (over a 36" range)', w: 36 + mmToIn(50), d: 20, h: 28, mountY: 36 + mmToIn(800), notes: 'A painted-plaster chimney hood built on site by others, shown for layout only: a plain box in the wall color, no trim, from 800mm above the range to the ceiling. 50mm wider than the 36" range (AP2).' },
  { code: 'AP28', appliance: 'hood', plaster: true, desc: 'Plaster Hood 50" (over a 48" range)', w: 48 + mmToIn(50), d: 20, h: 28, mountY: 36 + mmToIn(800), notes: 'A painted-plaster chimney hood built on site by others, shown for layout only: a plain box in the wall color, no trim, from 800mm above the range to the ceiling. 50mm wider than the 48" range (AP3).' },
  // a freestanding washing machine UNDER the counter (Samsung WW80CGC04DAE, 600 x 850 x 550mm; her ask
  // 2026-09-22 for one kitchen): stands on the floor in the run, the worktop runs over it
  { code: 'AP24', appliance: 'washer', desc: 'Washing machine 24" (freestanding)', w: 23.6, d: 21.7, h: 33.5, mountY: 0, underCounter: true },
  { code: 'AP9', appliance: 'fridge', desc: 'Refrigerator (Freestanding)', w: 36, d: 28, h: 70, mountY: 0 },
  // integrated fridge-freezer: 84" nominal install height (Sub-Zero / Thermador
  // / Miele french-door integrateds all land at 84"), 24" counter depth so it
  // finishes flush with the base runs and slips under the 86" tall line.
  // Panel-ready — pair with T12 (36" panel-ready housing) when Plinth supplies
  // the surround and door panels.
  { code: 'AP11', appliance: 'fridge', integrated: true, desc: 'Integrated Fridge-Freezer 36" (french doors + freezer drawer)', w: 36, d: 24, h: 84, mountY: 0 },
  // 72"-tall integrated french door (Fisher & Paykel RS36A72 and similar
  // under-72 integrateds) — same look as AP11, a foot shorter.
  { code: 'AP12', appliance: 'fridge', integrated: true, desc: 'Integrated French-Door Fridge-Freezer 36" × 72" (fits F&P RS36A72)', w: 36, d: 25, h: 72, mountY: 0 },
  // over-and-under: ONE door above, freezer drawer below (Sub-Zero DET50
  // designer series and similar 30" panel-ready over-unders).
  { code: 'AP13', appliance: 'fridge', integrated: true, overUnder: true, desc: 'Integrated Over-Under Fridge-Freezer 30" (door + freezer drawer, fits Sub-Zero DET50)', w: 30, d: 24, h: 84, mountY: 0 },
];

// (Solid-oak floating shelves were dropped from the range 2026-07: Plinth only
// sells painted cabinetry — open-shelf CABINETS like F23/W11/C7 are the shelf
// offer. getCab() on an old saved 'SH*' code returns undefined; every consumer
// already guards for that.)

export const CATALOGUE = BASE_CATALOGUE
  .concat(APPLIANCES.map((a) => ({
    ...a, type: 'APPLIANCES', hinge: 'n/a', notes: a.notes || 'Not supplied by PL/NTH, shown for layout only',
    usd: 0, halfDepth: false, glazed: false, corner: false, form: 'appliance',
    placeable: true, notSupplied: true,
  })));

// ----- sized freestanding fridges -----------------------------------------
// A code of the form 'AP9:WxDxH' (inches, e.g. 'AP9:36x30x72') resolves to a
// cached derived copy of the AP9 fridge with those dimensions (clamped to
// real-world freestanding ranges). Because getCab is the single source of
// truth, snapping, the no-overlap rule, the floor plan, the key table, the
// estimate and the 3D all pick the size up unchanged.
export const FRIDGE_SIZE_LIMITS = { w: [24, 48], d: [24, 36], h: [60, 84] };
const clampDim = (v, [lo, hi], fb) => {
  const n = Number(v);
  return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
};

/** The sized-fridge code for a {w,d,h} (inches; clamped to the limits). */
export function sizedFridgeCode(size) {
  const base = CATALOGUE.find((c) => c.code === 'AP9');
  const L = FRIDGE_SIZE_LIMITS;
  const w = clampDim(size?.w, L.w, base.w);
  const d = clampDim(size?.d, L.d, base.d);
  const h = clampDim(size?.h, L.h, base.h);
  return `AP9:${w}x${d}x${h}`;
}

const SIZED_FRIDGE_RX = /^AP9:(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i;
const sizedFridgeCache = new Map();

// OPEN SHELVES AT ANY DEPTH (her ask 2026-09-23, "drag the open shelves into the corner to be any depth
// i need them to be"): a code of the form 'W25:24' is the open shelf W25 made 24" deep, its back still
// on the wall. Any WALL open shelf (W11-W13, W25) takes it; whole inches, 8" to 36". Same virtual-code
// idiom as the sized fridge: getCab is the one source of truth, so everything downstream sees the depth.
export const SHELF_DEPTH_LIMITS = [8, 36];
export function sizedShelfCode(baseCode, depth) {
  const base = CATALOGUE.find((c) => c.code === baseCode);
  const d = Math.round(clampDim(depth, SHELF_DEPTH_LIMITS, base ? base.d : 14));
  return base && Math.abs(d - base.d) < 0.5 ? baseCode : `${baseCode}:${d}`;
}
const SIZED_SHELF_RX = /^(W\d+):(\d+(?:\.\d+)?)$/i;
const sizedShelfCache = new Map();
// CUT TO FIT (her ask 2026-09-26: "can these auto resize to fit leftover space"): an open shelf
// (wall, full-height or floor) or the F8 tray space at any width from 6" to 42", as a virtual
// code '<BASE>:w<inches>'. Priced as the narrowest standard size at or above that width in the
// same family (or the base when there is none wider): a cut-down 20" shelf is a 20" shelf's work.
export const FIT_WIDTH_LIMITS = [6, 42];
const SIZED_WIDTH_RX = /^([WF]\d+):w(\d+(?:\.\d+)?)$/i;
const sizedWidthCache = new Map();
export function canFitWidth(cab) {
  return !!cab && !cab.corner && !cab.stacker && (cab.form === 'open' || cab.form === 'tray') && (cab.type === 'WALL' || cab.type === 'FLOOR');
}
export function sizedWidthCode(baseCode, width) {
  const base = getCab(baseCode); if (!base || !canFitWidth(base)) return baseCode;
  const root = base.baseCode || base.code;
  const w = Math.round(clampDim(width, FIT_WIDTH_LIMITS, base.w) * 2) / 2;
  return Math.abs(w - getCab(root).w) < 0.05 ? root : `${root}:w${w}`;
}
function fitPriceFor(base, w) {
  const family = CATALOGUE.filter((c) => c.type === base.type && c.form === base.form && !c.corner && !!c.halfDepth === !!base.halfDepth && c.h === base.h && c.placeable);
  const wider = family.filter((c) => c.w >= w - 0.05).sort((p, q) => p.w - q.w)[0];
  const widest = [...family].sort((p, q) => q.w - p.w)[0];
  return (wider || widest || base).usd;
}

export function getCab(code) {
  const mw = typeof code === 'string' && SIZED_WIDTH_RX.exec(code);
  if (mw) {
    let hit = sizedWidthCache.get(code);
    if (!hit) {
      const base = CATALOGUE.find((c) => c.code === mw[1].toUpperCase());
      if (!base || !canFitWidth(base)) return undefined;
      const w = Math.round(clampDim(mw[2], FIT_WIDTH_LIMITS, base.w) * 2) / 2;
      hit = { ...base, code, w, usd: fitPriceFor(base, w), baseCode: base.code, cutToFit: true, desc: `${base.desc} · ${w}" wide, cut to fit` };
      sizedWidthCache.set(code, hit);
    }
    return hit;
  }
  const ms = typeof code === 'string' && SIZED_SHELF_RX.exec(code);
  if (ms) {
    let hit = sizedShelfCache.get(code);
    if (!hit) {
      const base = CATALOGUE.find((c) => c.code === ms[1].toUpperCase());
      if (!base || base.form !== 'open' || base.type !== 'WALL') return undefined;
      const d = Math.round(clampDim(ms[2], SHELF_DEPTH_LIMITS, base.d));
      hit = { ...base, code, d, baseCode: base.code, desc: `${base.desc} · ${d}" deep` };
      sizedShelfCache.set(code, hit);
    }
    return hit;
  }
  const m = typeof code === 'string' && SIZED_FRIDGE_RX.exec(code);
  if (m) {
    let hit = sizedFridgeCache.get(code);
    if (!hit) {
      const base = CATALOGUE.find((c) => c.code === 'AP9');
      const L = FRIDGE_SIZE_LIMITS;
      const w = clampDim(m[1], L.w, base.w);
      const d = clampDim(m[2], L.d, base.d);
      const h = clampDim(m[3], L.h, base.h);
      hit = {
        ...base, code, w, d, h,
        baseCode: 'AP9',                       // short label for the plan
        desc: `Refrigerator (Freestanding) ${w}"×${d}"×${h}"`,
      };
      sizedFridgeCache.set(code, hit);
    }
    return hit;
  }
  return CATALOGUE.find((c) => c.code === code);
}

// Loose accessories a customer can add to the order (priced, no 3D geometry).
export function orderableAccessories() {
  return CATALOGUE.filter((c) => c.type === 'ACCESSORIES' && c.usd > 0);
}

// Same-width alternatives a cabinet can SWAP to in place: same type, same
// width, same depth class and corner-ness — so drawers ↔ door ↔ open shelf
// (or glazed ↔ plain uppers) trade places without moving anything.
export function swapAlternatives(code) {
  const cur = getCab(code);
  if (!cur || !cur.placeable || cur.type === 'APPLIANCES') return [];
  return CATALOGUE.filter((c) =>
    c.placeable && c.code !== cur.code &&
    c.type === cur.type &&
    Math.abs(c.w - cur.w) < 0.5 &&
    c.halfDepth === cur.halfDepth &&
    !!c.corner === !!cur.corner &&
    // stackers only swap with stackers on the SAME host family (tall hosts are
    // 25¼" deep; wall and tall hosts now share the 86" top, so mount alone no
    // longer tells them apart) — and never with ordinary hung cabinets
    !!c.stacker === !!cur.stacker &&
    (c.mountY ?? null) === (cur.mountY ?? null) &&
    (!cur.stacker || Math.abs(c.d - cur.d) < 0.5));
}

/** Drawer inserts made for this cabinet: the cutlery / utensil accessories whose
 *  width matches a drawer bank (A3 / A6 for 28", A5 for 24", A4 for 36"; nothing is
 *  made for 20"). Cooktop drawers are skipped: their top front is fixed. */
export function drawerInserts(code) {
  const cab = getCab(code);
  if (!cab || cab.form !== 'drawers' || /cooktop/i.test(cab.desc || '')) return [];
  return CATALOGUE.filter((a) => a.type === 'ACCESSORIES' && /insert/i.test(a.desc) && a.usd > 0 &&
    Number((a.desc.match(/(\d+)"/) || [])[1]) === cab.w);
}

// For a double-sided island: given a front (standard-depth) floor cabinet,
// pick a half-depth floor cabinet to sit back-to-back behind it. Match the
// width as closely as possible without overhanging the front unit.
export function halfDepthPartner(code) {
  const front = getCab(code);
  if (!front || front.type !== 'FLOOR' || front.halfDepth || front.corner) return null;
  const candidates = CATALOGUE.filter((c) =>
    c.type === 'FLOOR' && c.halfDepth && c.placeable && c.form !== 'corner');
  if (!candidates.length) return null;
  // widest that still fits within the front width, else the narrowest available
  const fit = candidates.filter((c) => c.w <= front.w + 0.5).sort((a, b) => b.w - a.w);
  return (fit[0] || candidates.slice().sort((a, b) => a.w - b.w)[0]).code;
}

// ----- finishes (15 Plinth paint colours, exact hexes) ------------------
export const FINISHES = [
  { group: 'Whites', name: 'Bare', hex: '#FBF8F4', desc: 'Nothing added, nothing hidden. The cleanest white we could find without tipping into clinical.' },
  { group: 'Whites', name: 'Ghost', hex: '#F7F4EB', desc: 'White, but with something going on underneath. A presence without a fuss.' },
  { group: 'Whites', name: 'Butter', hex: '#F0E8CE', desc: 'The good stuff. The kind that comes in a paper wrapper with a little too much salt.' },
  { group: 'Pinks & Neutrals', name: 'Pinky', hex: '#EDD9CC', desc: 'Not actually pink. More of a blush. The kind you get after a long Sunday lunch.' },
  { group: 'Pinks & Neutrals', name: 'Dough', hex: '#D3C9B8', desc: 'Warm, soft, and just about to become something great. A neutral that earns its keep.' },
  { group: 'Pinks & Neutrals', name: 'Greige', hex: '#CCC5BC', desc: 'Gray tried, beige tried, this is what happened. Better than both.' },
  { group: 'Grays & Blues', name: 'Spoon', hex: '#A3A8A8', desc: 'Dependable. Always in the drawer. The color of things that just work.' },
  { group: 'Grays & Blues', name: 'Capri', hex: '#A2B5B8', desc: 'The sea between the rocks on a slightly overcast afternoon. Still worth it.' },
  { group: 'Grays & Blues', name: 'Hudson', hex: '#434C56', desc: 'Dark, cold, moves fast. Named after the river nobody swims in.' },
  { group: 'Greens', name: 'Nettle', hex: '#B4B296', desc: 'Stings a little. In a good way. The green you didn\'t know you needed.' },
  { group: 'Greens', name: 'Swamp', hex: '#6B6148', desc: 'Deep, murky, looks like trouble. In all the right ways.' },
  { group: 'Greens', name: 'Kale', hex: '#4C4A3E', desc: 'Dark, slightly bitter, very good for you. The vegetable that became a kitchen.' },
  { group: 'Browns & Darks', name: 'Leo', hex: '#B89878', desc: 'Named after a dog of indeterminate breed. Gingery, warm, impossible not to love. Part corgi, part lab, part dachshund, and about eleven other things. So is this color.' },
  { group: 'Browns & Darks', name: 'Marmite', hex: '#352C2B', desc: 'Love it or leave it. No in between.' },
  { group: 'Browns & Darks', name: 'Skillet', hex: '#303536', desc: 'Cast iron, seasoned dark, and heavier than it looks. The one you never replace.' },
  { group: 'Custom', name: 'Custom RAL', hex: '#b7b1a4', desc: 'Any RAL shade, matched in the PL/NTH workshop. Give us the RAL code and we take it from there.', custom: true },
];
export const DEFAULT_FINISH = 'Ghost';
export function getFinish(name) { return FINISHES.find((f) => f.name === name) || FINISHES[1]; }

// ----- customer pricing --------------------------------------------------
// Customer-facing sell price only. Each catalogue item carries a precomputed
// `usd` sell price (whole dollars, incl. US import tariff + wrapping) written
// by the pricing sheet's sync script. No cost, FX or margin maths lives here.
export function sellUSD(cab) {
  return cab && cab.usd > 0 ? cab.usd : 0;
}

export function fmtUSD(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// Trade (multi-unit) pricing: cabinets priced per-unit by the same sell formula,
// plus shipping added once per order by the container. Adjust as needed.
export const TRADE = {
  capPerContainer: 60,       // cabinets per shipping container
  shipPerContainerUSD: 5280, // sell $ per container (synced from the pricing sheet)
};

// Indicative volume pricing tiers, applied to the trade cabinet subtotal by
// TOTAL UNIT COUNT and shown in the spec breakdown. Always labelled
// "indicative — confirmed on quote"; tune the percentages here.
export const VOLUME_TIERS = [
  { min: 100, pct: 10, label: '100+ units' },
  { min: 50, pct: 8, label: '50–99 units' },
  { min: 25, pct: 5, label: '25–49 units' },
  { min: 10, pct: 3, label: '10–24 units' },
];
export function volumeTier(totalUnits) {
  return VOLUME_TIERS.find((t) => totalUnits >= t.min) || null;
}

// Painted filler panel — auto-added to close a small gap to a wall. Sell $ each
// (synced from the pricing sheet; trim carries no per-cabinet wrap).
export const FILLER_SELL = 91;

// Cornice / crown molding — auto-applies to the top of wall, tall and counter
// cabinets. Sell $ per linear foot (synced from the pricing sheet).
export const CORNICE_OPTIONS = {
  none: { label: 'No crown', code: '', sellPerFt: 0 },
  plain: { label: 'Plain crown', code: 'A13', sellPerFt: 152, blurb: 'A 7/8-inch bar with a thumb-round edge, standing 5/8 inch proud of the doors.' },
  decorative: { label: 'Georgian crown', code: 'A14', sellPerFt: 152, blurb: 'A built-up, stepped crown profile.' },
};
export function corniceOption(name) { return CORNICE_OPTIONS[name] || CORNICE_OPTIONS.none; }

// Worktop options for the UI (not supplied by Plinth — visual only).
// keys are saved in designs (room.worktop, item.worktop): never rename one.
// models/materials.js WORKTOPS holds the matching surface for each key.
export const WORKTOP_OPTIONS = {
  marble: { label: 'Carrara marble', hex: '#e2e0db' },
  calacatta: { label: 'Calacatta marble', hex: '#ece9e3' },
  quartz: { label: 'White quartz', hex: '#e8e6e1' },
  soapstone: { label: 'Soapstone', hex: '#3e4544' },
  granite: { label: 'Black granite', hex: '#26272b' },
  oak: { label: 'Oak block', hex: '#bc9462' },
  walnut: { label: 'Walnut block', hex: '#684832' },
};

// Interior finish constants (for materials / labels)
export const BRAND = {
  brown: '#3f3a24', cream: '#f5efe0', paper: '#f7f5eb', line: '#d9cfb8',
  muted: '#7a6d54', charcoal: '#3D3632', offwhite: '#FDFBF8',
  red: '#b1392b', green: '#4a7a3a', amber: '#c08a2a',
  oak: '#c9a978',      // oak veneer interior
  brass: '#9a9ea3',    // handle metal — brushed steel (no gold/yellow)
  worktop: '#e7e2d6',  // representative worktop surface
};
