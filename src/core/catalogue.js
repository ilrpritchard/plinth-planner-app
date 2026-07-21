// catalogue.js — the Plinth block catalogue, finishes, and customer pricing.
//
// Cabinet dimensions (w/d/h, inches) and workshop GBP costs are taken from
// Plinth's internal costing tool. Each item is given a `form` that tells the
// procedural builder how to construct it. No external data, no images.

// ----- raw catalogue (from costing tool) ---------------------------------
// type: FLOOR | WALL | COUNTER | TALL | ACCESSORIES
const RAW = [
  // FLOOR — singles
  { code: 'F1', type: 'FLOOR', desc: 'Single', w: 20, d: 24, h: 35, hinge: 'L&R', gbp: 676 },
  { code: 'F2', type: 'FLOOR', desc: 'Single', w: 24, d: 24, h: 35, hinge: 'L&R', gbp: 680 },
  { code: 'F3', type: 'FLOOR', desc: 'Single', w: 28, d: 24, h: 35, hinge: 'L&R', gbp: 683 },
  { code: 'F4', type: 'FLOOR', desc: 'Single (Half Depth)', w: 20, d: 14, h: 35, hinge: 'L&R', gbp: 662 },
  { code: 'F5', type: 'FLOOR', desc: 'Single (Half Depth)', w: 24, d: 14, h: 35, hinge: 'L&R', gbp: 665 },
  { code: 'F6', type: 'FLOOR', desc: 'Single (Half Depth)', w: 28, d: 14, h: 35, hinge: 'L&R', gbp: 669 },
  // FLOOR — appliance / specials
  { code: 'F7', type: 'FLOOR', desc: 'Dishwasher Door & Plinth', w: 24, d: 24, h: 35, hinge: 'n/a', gbp: 292, notes: 'Dishwasher door panel + plinth' },
  { code: 'F8', type: 'FLOOR', desc: 'Tray Space (Adjustable)', w: 10, d: 24, h: 35, hinge: 'n/a', gbp: 557, notes: 'Open tray space, no door' },
  // FLOOR — doubles
  { code: 'F9', type: 'FLOOR', desc: 'Double', w: 28, d: 24, h: 35, hinge: 'n/a', gbp: 992 },
  { code: 'F10', type: 'FLOOR', desc: 'Double', w: 36, d: 24, h: 35, hinge: 'n/a', gbp: 1040 },
  { code: 'F11', type: 'FLOOR', desc: 'Double', w: 42, d: 24, h: 35, hinge: 'n/a', gbp: 1075 },
  { code: 'F12', type: 'FLOOR', desc: 'Double (Half Depth)', w: 28, d: 14, h: 35, hinge: 'n/a', gbp: 977 },
  { code: 'F13', type: 'FLOOR', desc: 'Double (Half Depth)', w: 36, d: 14, h: 35, hinge: 'n/a', gbp: 1026 },
  { code: 'F14', type: 'FLOOR', desc: 'Double (Half Depth)', w: 42, d: 14, h: 35, hinge: 'n/a', gbp: 1061 },
  // FLOOR — corner (with return)
  { code: 'F15', type: 'FLOOR', desc: 'Corner (+20") · blank left', w: 20, d: 24, h: 35, hinge: 'L&R', gbp: 972, corner: true, cornerSide: 'left' },
  { code: 'F15R', type: 'FLOOR', desc: 'Corner (+20") · blank right', w: 20, d: 24, h: 35, hinge: 'L&R', gbp: 972, corner: true, cornerSide: 'right' },
  { code: 'F16', type: 'FLOOR', desc: 'Corner (+20") · blank left', w: 24, d: 24, h: 35, hinge: 'L&R', gbp: 993, corner: true, cornerSide: 'left' },
  { code: 'F16R', type: 'FLOOR', desc: 'Corner (+20") · blank right', w: 24, d: 24, h: 35, hinge: 'L&R', gbp: 993, corner: true, cornerSide: 'right' },
  // FLOOR — drawers
  { code: 'F17', type: 'FLOOR', desc: 'Drawers (3)', w: 20, d: 24, h: 35, hinge: 'n/a', gbp: 1102 },
  { code: 'F18', type: 'FLOOR', desc: 'Drawers (3)', w: 24, d: 24, h: 35, hinge: 'n/a', gbp: 1109 },
  { code: 'F19', type: 'FLOOR', desc: 'Drawers (3)', w: 28, d: 24, h: 35, hinge: 'n/a', gbp: 1151 },
  { code: 'F20', type: 'FLOOR', desc: 'Drawers (3)', w: 36, d: 24, h: 35, hinge: 'n/a', gbp: 1200 },
  // FLOOR — bins
  { code: 'F21', type: 'FLOOR', desc: 'Pull Out Bin', w: 20, d: 24, h: 35, hinge: 'n/a', gbp: 880, notes: 'Vauth Sagel bin insert' },
  { code: 'F22', type: 'FLOOR', desc: 'Pull Out Bin', w: 26, d: 24, h: 35, hinge: 'n/a', gbp: 931, notes: 'Vauth Sagel bin insert' },
  // FLOOR — open shelves
  { code: 'F23', type: 'FLOOR', desc: 'Open Shelves', w: 20, d: 24, h: 35, hinge: 'n/a', gbp: 484 },
  { code: 'F24', type: 'FLOOR', desc: 'Open Shelves', w: 24, d: 24, h: 35, hinge: 'n/a', gbp: 491 },
  { code: 'F25', type: 'FLOOR', desc: 'Open Shelves', w: 28, d: 24, h: 35, hinge: 'n/a', gbp: 533 },
  { code: 'F26', type: 'FLOOR', desc: 'Open Shelves (Half Depth)', w: 20, d: 14, h: 35, hinge: 'n/a', gbp: 470 },
  { code: 'F27', type: 'FLOOR', desc: 'Open Shelves (Half Depth)', w: 24, d: 14, h: 35, hinge: 'n/a', gbp: 477 },
  { code: 'F28', type: 'FLOOR', desc: 'Open Shelves (Half Depth)', w: 28, d: 14, h: 35, hinge: 'n/a', gbp: 519 },
  // FLOOR — panel-ready undercounter appliance front (wine / beverage / drawers)
  { code: 'F29', type: 'FLOOR', desc: 'Undercounter Appliance Door & Plinth', w: 24, d: 24, h: 35, hinge: 'n/a', gbp: 292, notes: 'Door panel + plinth for a 24" panel-ready undercounter unit (wine, beverage, refrigerator drawers) — appliance not supplied. Panel supplied undrilled.' },
  // FLOOR — cooktop bases (36" — the standard rangetop width on multi-unit
  // work). Fronts are IDENTICAL to F20 / F10; the difference is inside: the
  // cooktop body drops into the top of the carcass.
  { code: 'F30', type: 'FLOOR', desc: 'Cooktop Drawers (3)', w: 36, d: 24, h: 35, hinge: 'n/a', gbp: 1200, notes: 'Drawer bank prepped for a 36" cooktop over. Fronts identical to F20 — the top front is FALSE (fixed in the workshop) so the cooktop body drops in; lower two drawers work as normal. Cooktop not supplied.' },
  { code: 'F31', type: 'FLOOR', desc: 'Cooktop Double', w: 36, d: 24, h: 35, hinge: 'n/a', gbp: 1040, notes: 'Double door base prepped for a 36" cooktop over — top of the carcass is cut back for the cooktop body. Cooktop not supplied.' },

  // WALL
  { code: 'W1', type: 'WALL', desc: 'Single', w: 20, d: 14, h: 30, hinge: 'L&R', gbp: 598 },
  { code: 'W2', type: 'WALL', desc: 'Single', w: 24, d: 14, h: 30, hinge: 'L&R', gbp: 605 },
  { code: 'W3', type: 'WALL', desc: 'Single (Glazed)', w: 20, d: 14, h: 30, hinge: 'L&R', gbp: 659, glazed: true },
  { code: 'W4', type: 'WALL', desc: 'Single (Glazed)', w: 24, d: 14, h: 30, hinge: 'L&R', gbp: 666, glazed: true },
  { code: 'W5', type: 'WALL', desc: 'Double', w: 36, d: 14, h: 30, hinge: 'n/a', gbp: 823 },
  { code: 'W6', type: 'WALL', desc: 'Double', w: 42, d: 14, h: 30, hinge: 'n/a', gbp: 858 },
  { code: 'W7', type: 'WALL', desc: 'Double (Glazed)', w: 36, d: 14, h: 30, hinge: 'n/a', gbp: 1009, glazed: true },
  { code: 'W8', type: 'WALL', desc: 'Double (Glazed)', w: 42, d: 14, h: 30, hinge: 'n/a', gbp: 1044, glazed: true },
  { code: 'W9', type: 'WALL', desc: 'Corner (+10")', w: 20, d: 14, h: 30, hinge: 'L&R', gbp: 645, corner: true },
  { code: 'W10', type: 'WALL', desc: 'Corner (+10")', w: 24, d: 14, h: 30, hinge: 'L&R', gbp: 694, corner: true },
  { code: 'W11', type: 'WALL', desc: 'Open Shelves', w: 20, d: 14, h: 30, hinge: 'n/a', gbp: 440 },
  { code: 'W12', type: 'WALL', desc: 'Open Shelves', w: 24, d: 14, h: 30, hinge: 'n/a', gbp: 447 },
  { code: 'W13', type: 'WALL', desc: 'Open Shelves', w: 28, d: 14, h: 30, hinge: 'n/a', gbp: 489 },
  // WALL — S-series STACKERS: boxes that sit ON TOP of an existing run for
  // tall ceilings, matched per family so every wall/tall/counter cabinet has
  // a stacker with the SAME width, the right depth, and its mountY exactly at
  // the host's top (talls top 86" and stand 30mm proud → d 25.25" lands the
  // stacker face flush; wall runs top 84" and counters 86.5" at d 14").
  // Two heights: 15" (9'+ ceilings) and 21" (10'). stacker: true marks them.
  // Enforced by test/trade-upgrades.test.js: every non-corner W/T/C cabinet
  // must have a matching stacker — extend this list with any new width.
  // fits the TALL run (24/27/28/30/33/39/44 wide, d 25.25, mount 86)
  { code: 'S1', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits T1, T3)', w: 24, d: 25.25, h: 15, hinge: 'L&R', gbp: 520, mountY: 86, notes: 'Sits on the 86" tall run — face flush with the tall below. For 9\'+ ceilings.' },
  { code: 'S2', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits T10)', w: 27, d: 25.25, h: 15, hinge: 'L&R', gbp: 545, mountY: 86, notes: 'Sits on the T10 panel-ready housing. For 9\'+ ceilings.' },
  { code: 'S3', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits T2, T5, T6)', w: 28, d: 25.25, h: 15, hinge: 'L&R', gbp: 555, mountY: 86, notes: 'Sits on the 86" tall run — face flush with the tall below. For 9\'+ ceilings.' },
  { code: 'S4', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits T4, T9)', w: 30, d: 25.25, h: 15, hinge: 'n/a', gbp: 610, mountY: 86, notes: 'Sits on the 86" tall run — face flush with the tall below. For 9\'+ ceilings.' },
  { code: 'S5', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits T11)', w: 33, d: 25.25, h: 15, hinge: 'n/a', gbp: 645, mountY: 86, notes: 'Sits on the T11 panel-ready housing. For 9\'+ ceilings.' },
  { code: 'S6', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits T12)', w: 39, d: 25.25, h: 15, hinge: 'n/a', gbp: 700, mountY: 86, notes: 'Sits on the T12 panel-ready housing. For 9\'+ ceilings.' },
  { code: 'S7', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits T7, T8, T13)', w: 44, d: 25.25, h: 15, hinge: 'n/a', gbp: 745, mountY: 86, notes: 'Sits on the 44" double larder. For 9\'+ ceilings.' },
  { code: 'S8', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits T1, T3)', w: 24, d: 25.25, h: 21, hinge: 'L&R', gbp: 575, mountY: 86, notes: 'Sits on the 86" tall run — face flush with the tall below. For 10\'+ ceilings.' },
  { code: 'S9', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits T10)', w: 27, d: 25.25, h: 21, hinge: 'L&R', gbp: 600, mountY: 86, notes: 'Sits on the T10 panel-ready housing. For 10\'+ ceilings.' },
  { code: 'S10', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits T2, T5, T6)', w: 28, d: 25.25, h: 21, hinge: 'L&R', gbp: 610, mountY: 86, notes: 'Sits on the 86" tall run — face flush with the tall below. For 10\'+ ceilings.' },
  { code: 'S11', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits T4, T9)', w: 30, d: 25.25, h: 21, hinge: 'n/a', gbp: 665, mountY: 86, notes: 'Sits on the 86" tall run — face flush with the tall below. For 10\'+ ceilings.' },
  { code: 'S12', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits T11)', w: 33, d: 25.25, h: 21, hinge: 'n/a', gbp: 700, mountY: 86, notes: 'Sits on the T11 panel-ready housing. For 10\'+ ceilings.' },
  { code: 'S13', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits T12)', w: 39, d: 25.25, h: 21, hinge: 'n/a', gbp: 755, mountY: 86, notes: 'Sits on the T12 panel-ready housing. For 10\'+ ceilings.' },
  { code: 'S14', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits T7, T8, T13)', w: 44, d: 25.25, h: 21, hinge: 'n/a', gbp: 800, mountY: 86, notes: 'Sits on the 44" double larder. For 10\'+ ceilings.' },
  // fits the WALL run (20/24/28/36/42 wide, d 14, mount 84 — stacked uppers)
  { code: 'S15', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits W1, W3, W11)', w: 20, d: 14, h: 15, hinge: 'L&R', gbp: 450, mountY: 84, notes: 'Sits directly on a standard hung wall run (tops at 84") — stacked uppers to the ceiling.' },
  { code: 'S16', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits W2, W4, W12)', w: 24, d: 14, h: 15, hinge: 'L&R', gbp: 475, mountY: 84, notes: 'Sits directly on a standard hung wall run (tops at 84") — stacked uppers to the ceiling.' },
  { code: 'S17', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits W13)', w: 28, d: 14, h: 15, hinge: 'L&R', gbp: 510, mountY: 84, notes: 'Sits directly on a standard hung wall run (tops at 84") — stacked uppers to the ceiling.' },
  { code: 'S18', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits W5, W7)', w: 36, d: 14, h: 15, hinge: 'n/a', gbp: 635, mountY: 84, notes: 'Sits directly on a standard hung wall run (tops at 84") — stacked uppers to the ceiling.' },
  { code: 'S19', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits W6, W8)', w: 42, d: 14, h: 15, hinge: 'n/a', gbp: 690, mountY: 84, notes: 'Sits directly on a standard hung wall run (tops at 84") — stacked uppers to the ceiling.' },
  { code: 'S20', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits W1, W3, W11)', w: 20, d: 14, h: 21, hinge: 'L&R', gbp: 505, mountY: 84, notes: 'Stacked uppers, the taller size — wall run + 21" reaches 105".' },
  { code: 'S21', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits W2, W4, W12)', w: 24, d: 14, h: 21, hinge: 'L&R', gbp: 530, mountY: 84, notes: 'Stacked uppers, the taller size — wall run + 21" reaches 105".' },
  { code: 'S22', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits W13)', w: 28, d: 14, h: 21, hinge: 'L&R', gbp: 565, mountY: 84, notes: 'Stacked uppers, the taller size — wall run + 21" reaches 105".' },
  { code: 'S23', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits W5, W7)', w: 36, d: 14, h: 21, hinge: 'n/a', gbp: 690, mountY: 84, notes: 'Stacked uppers, the taller size — wall run + 21" reaches 105".' },
  { code: 'S24', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits W6, W8)', w: 42, d: 14, h: 21, hinge: 'n/a', gbp: 745, mountY: 84, notes: 'Stacked uppers, the taller size — wall run + 21" reaches 105".' },
  // fits the COUNTER dresser run (24/28/36/42 wide, d 14, mount 86.5)
  { code: 'S25', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits C1, C2)', w: 24, d: 14, h: 15, hinge: 'L&R', gbp: 475, mountY: 86.5, notes: 'Sits on the counter-to-ceiling dresser run (tops at 86½"). For 9\'+ ceilings.' },
  { code: 'S26', type: 'WALL', stacker: true, desc: 'Stacker 15\" (fits C7)', w: 28, d: 14, h: 15, hinge: 'L&R', gbp: 510, mountY: 86.5, notes: 'Sits on the counter-to-ceiling dresser run (tops at 86½"). For 9\'+ ceilings.' },
  { code: 'S27', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits C3, C5, C8)', w: 36, d: 14, h: 15, hinge: 'n/a', gbp: 635, mountY: 86.5, notes: 'Sits on the counter-to-ceiling dresser run (tops at 86½"). For 9\'+ ceilings.' },
  { code: 'S28', type: 'WALL', stacker: true, desc: 'Stacker Double 15\" (fits C4, C6, C9)', w: 42, d: 14, h: 15, hinge: 'n/a', gbp: 690, mountY: 86.5, notes: 'Sits on the counter-to-ceiling dresser run (tops at 86½"). For 9\'+ ceilings.' },
  { code: 'S29', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits C1, C2)', w: 24, d: 14, h: 21, hinge: 'L&R', gbp: 530, mountY: 86.5, notes: 'Sits on the counter dresser run, the taller size — reaches 107½". For 10\'+ ceilings.' },
  { code: 'S30', type: 'WALL', stacker: true, desc: 'Stacker 21\" (fits C7)', w: 28, d: 14, h: 21, hinge: 'L&R', gbp: 565, mountY: 86.5, notes: 'Sits on the counter dresser run, the taller size — reaches 107½". For 10\'+ ceilings.' },
  { code: 'S31', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits C3, C5, C8)', w: 36, d: 14, h: 21, hinge: 'n/a', gbp: 690, mountY: 86.5, notes: 'Sits on the counter dresser run, the taller size — reaches 107½". For 10\'+ ceilings.' },
  { code: 'S32', type: 'WALL', stacker: true, desc: 'Stacker Double 21\" (fits C4, C6, C9)', w: 42, d: 14, h: 21, hinge: 'n/a', gbp: 745, mountY: 86.5, notes: 'Sits on the counter dresser run, the taller size — reaches 107½". For 10\'+ ceilings.' },

  // COUNTER (50" tall, 14" deep — counter-to-ceiling dressers)
  { code: 'C1', type: 'COUNTER', desc: 'Single', w: 24, d: 14, h: 50, hinge: 'L&R', gbp: 758 },
  { code: 'C2', type: 'COUNTER', desc: 'Single (Glazed)', w: 24, d: 14, h: 50, hinge: 'L&R', gbp: 820, glazed: true },
  { code: 'C3', type: 'COUNTER', desc: 'Double', w: 36, d: 14, h: 50, hinge: 'n/a', gbp: 969 },
  { code: 'C4', type: 'COUNTER', desc: 'Double', w: 42, d: 14, h: 50, hinge: 'n/a', gbp: 1025 },
  { code: 'C5', type: 'COUNTER', desc: 'Double (Glazed)', w: 36, d: 14, h: 50, hinge: 'n/a', gbp: 1154, glazed: true },
  { code: 'C6', type: 'COUNTER', desc: 'Double (Glazed)', w: 42, d: 14, h: 50, hinge: 'n/a', gbp: 1210, glazed: true },
  { code: 'C7', type: 'COUNTER', desc: 'Open Shelves', w: 28, d: 14, h: 50, hinge: 'n/a', gbp: 615 },
  { code: 'C8', type: 'COUNTER', desc: 'Open Shelves', w: 36, d: 14, h: 50, hinge: 'n/a', gbp: 664 },
  { code: 'C9', type: 'COUNTER', desc: 'Open Shelves', w: 42, d: 14, h: 50, hinge: 'n/a', gbp: 720 },

  // TALL (86" tall, 24" deep)
  { code: 'T1', type: 'TALL', desc: 'Single', w: 24, d: 24, h: 86, hinge: 'L&R', gbp: 1226 },
  { code: 'T2', type: 'TALL', desc: 'Single', w: 28, d: 24, h: 86, hinge: 'L&R', gbp: 1289 },
  { code: 'T3', type: 'TALL', desc: 'Housing (+3.5")', w: 24, d: 24, h: 86, hinge: 'n/a', gbp: 1145, notes: 'Integrated fridge housing' },
  { code: 'T4', type: 'TALL', desc: 'Housing (+3.5")', w: 30, d: 24, h: 86, hinge: 'n/a', gbp: 1187, notes: 'Integrated fridge housing' },
  { code: 'T5', type: 'TALL', desc: 'Single Larder', w: 28, d: 24, h: 86, hinge: 'L&R', gbp: 1289 },
  { code: 'T6', type: 'TALL', desc: 'Single Larder (Drawers)', w: 28, d: 24, h: 86, hinge: 'L&R', gbp: 1692 },
  { code: 'T7', type: 'TALL', desc: 'Double Larder', w: 44, d: 24, h: 86, hinge: 'n/a', gbp: 1719 },
  { code: 'T8', type: 'TALL', desc: 'Double Larder (Drawers)', w: 44, d: 24, h: 86, hinge: 'n/a', gbp: 2246 },
  { code: 'T9', type: 'TALL', desc: 'Oven Housing', w: 30, d: 24, h: 86, hinge: 'n/a', gbp: 1400, notes: 'Housing for a single 24" wall oven (oven not supplied)' },
  // TALL — panel-ready column housings (refrigeration columns by others)
  { code: 'T10', type: 'TALL', desc: 'Panel-Ready Column Housing (24")', w: 27, d: 24, h: 86, hinge: 'n/a', gbp: 1395, notes: 'Fits 24" panel-ready refrigeration columns (Sub-Zero, Thermador, Miele, Bosch — confirm model at order). Matching door panel set included, supplied undrilled. Appliance not supplied.' },
  { code: 'T11', type: 'TALL', desc: 'Panel-Ready Column Housing (30")', w: 33, d: 24, h: 86, hinge: 'n/a', gbp: 1440, notes: 'Fits 30" panel-ready refrigeration columns (Sub-Zero, Thermador, Miele — confirm model at order). Matching door panel set included, supplied undrilled. Appliance not supplied.' },
  { code: 'T12', type: 'TALL', desc: 'Panel-Ready Column Housing (36")', w: 39, d: 24, h: 86, hinge: 'n/a', gbp: 1490, notes: 'Fits 36" panel-ready French-door / column refrigeration (Sub-Zero, Thermador, Miele — confirm model at order). Matching door panel set included, supplied undrilled. Appliance not supplied.' },
  { code: 'T13', type: 'TALL', desc: 'Double', w: 44, d: 24, h: 86, hinge: 'n/a', gbp: 1650, notes: 'Full-height double doors — left and right hinged pair. Adjustable shelves.' },

  // ACCESSORIES (no 3D geometry placed; listed in cut list only)
  { code: 'A2', type: 'ACCESSORIES', desc: 'End Panel (Floor)', w: 0, d: 0, h: 0, hinge: '', gbp: 105 },
  { code: 'A3', type: 'ACCESSORIES', desc: 'Cutlery Insert 28"', w: 0, d: 0, h: 0, hinge: '', gbp: 218 },
  { code: 'A4', type: 'ACCESSORIES', desc: 'Cutlery Insert 36"', w: 0, d: 0, h: 0, hinge: '', gbp: 218 },
  { code: 'A5', type: 'ACCESSORIES', desc: 'Utensil Insert 24"', w: 0, d: 0, h: 0, hinge: '', gbp: 218 },
  { code: 'A6', type: 'ACCESSORIES', desc: 'Utensil Insert 28"', w: 0, d: 0, h: 0, hinge: '', gbp: 218 },
  { code: 'A8', type: 'ACCESSORIES', desc: 'End Panel (Wall)', w: 0, d: 0, h: 0, hinge: '', gbp: 70 },
  { code: 'A9', type: 'ACCESSORIES', desc: 'End Panel (Counter)', w: 0, d: 0, h: 0, hinge: '', gbp: 93 },
  { code: 'A10', type: 'ACCESSORIES', desc: 'End Panel (Tall)', w: 0, d: 0, h: 0, hinge: '', gbp: 146 },
];

// ----- classify each item into a build form -----------------------------
// form: 'door'|'double'|'drawers'|'drawerDoor'|'sink'|'open'|'tray'|'bin'
//       |'dishwasher'|'housing'|'larder'|'larderDrawers'|'glazed'|'accessory'
function classify(it) {
  const d = it.desc.toLowerCase();
  if (it.type === 'ACCESSORIES') return 'accessory';
  if (it.corner) return 'corner';
  if (d.includes('drawers (3)')) return 'drawers';
  if (d.includes('larder (drawers)')) return 'larderDrawers';
  if (d.includes('larder')) return 'larder';
  if (d.includes('oven housing')) return 'ovenHousing';
  if (d.includes('housing')) return 'housing';
  if (d.includes('undercounter appliance')) return 'dishwasher'; // legless panel front, same rules as F7
  if (d.includes('dishwasher')) return 'dishwasher';
  if (d.includes('tray')) return 'tray';
  if (d.includes('bin')) return 'bin';
  if (d.includes('open shelves')) return 'open';
  if (d.includes('double')) return it.glazed ? 'glazedDouble' : 'double';
  if (it.glazed) return 'glazed';            // single glazed
  return 'door';                              // plain single door
}

const BASE_CATALOGUE = RAW.map((it) => ({
  ...it,
  notes: it.notes || '',
  halfDepth: /half depth/i.test(it.desc),
  glazed: !!it.glazed,
  corner: !!it.corner,
  form: classify(it),
  placeable: it.type !== 'ACCESSORIES' && it.h > 0,
  notSupplied: false,
}));

export const FAMILY_ORDER = ['FLOOR', 'WALL', 'COUNTER', 'TALL', 'STACKER', 'APPLIANCES', 'ACCESSORIES'];
export const FAMILY_LABEL = {
  FLOOR: 'Floor', WALL: 'Wall', COUNTER: 'Counter', TALL: 'Tall',
  STACKER: 'Stackers', APPLIANCES: 'Appliances', ACCESSORIES: 'Accessories',
};

/** DISPLAY family for grouping/labels: stackers get their own section even
 *  though their behavioural type stays 'WALL' (hung, wall-attached). */
export function familyOf(cab) {
  return cab && cab.stacker ? 'STACKER' : cab && cab.type;
}

// ----- appliances (NOT Plinth products — visual placeholders, unpriced) ----
// Each sits at its own mount height: ranges/fridges on the floor, hobs & sinks
// in the worktop (36.5"). They snap to walls/runs like base units.
const APPLIANCES = [
  { code: 'AP1', appliance: 'range', desc: 'Range 30"', w: 30, d: 26, h: 36, mountY: 0 },
  { code: 'AP2', appliance: 'range', desc: 'Range 36"', w: 36, d: 26, h: 36, mountY: 0 },
  { code: 'AP3', appliance: 'range', desc: 'Range 48"', w: 48, d: 26, h: 36, mountY: 0 },
  { code: 'AP4', appliance: 'hob', desc: 'Cooktop 30"', w: 30, d: 21, h: 2, mountY: 36.5 },
  { code: 'AP5', appliance: 'hob', desc: 'Cooktop 36"', w: 36, d: 21, h: 2, mountY: 36.5 },
  { code: 'AP6', appliance: 'sink', desc: 'Sink (Single)', w: 24, d: 20, h: 8, mountY: 36.5 },
  { code: 'AP7', appliance: 'sink', desc: 'Sink (Double)', w: 33, d: 20, h: 8, mountY: 36.5 },
  { code: 'AP10', appliance: 'sink', desc: 'Sink (Prep) 15"', w: 15, d: 18, h: 8, mountY: 36.5 },
  { code: 'AP8', appliance: 'hood', desc: 'Range Hood 36"', w: 36, d: 20, h: 28, mountY: 58 },
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
    ...a, type: 'APPLIANCES', hinge: 'n/a', notes: 'Not supplied by Plinth — shown for layout only',
    gbp: 0, halfDepth: false, glazed: false, corner: false, form: 'appliance',
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

export function getCab(code) {
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
  return CATALOGUE.filter((c) => c.type === 'ACCESSORIES' && c.gbp > 0);
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
    // stackers only swap with stackers at the SAME mount (tall/wall/counter
    // hosts differ) — and never with ordinary hung cabinets
    !!c.stacker === !!cur.stacker &&
    (c.mountY ?? null) === (cur.mountY ?? null));
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
  { group: 'Browns & Darks', name: 'Villain', hex: '#303536', desc: 'The one in all black at the back of the room. Doesn\'t need to explain itself.' },
  { group: 'Custom', name: 'Custom RAL', hex: '#b7b1a4', desc: 'Any RAL shade, matched in the PL/NTH workshop. Give us the RAL code and we take it from there.', custom: true },
];
export const DEFAULT_FINISH = 'Ghost';
export function getFinish(name) { return FINISHES.find((f) => f.name === name) || FINISHES[1]; }

// ----- customer pricing --------------------------------------------------
// Customer-facing sell price only. Internal GBP / margin are never displayed.
// sell$ per cabinet = (workshop GBP + wrap £) × FX × margin
export const PRICING = { fx: 1.32, margin: 2, wrap: 20 };

export function sellUSD(cab, p = PRICING) {
  if (!cab || !cab.gbp) return 0;
  return (cab.gbp + p.wrap) * p.fx * p.margin;
}

export function fmtUSD(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// Trade (multi-unit) pricing: cabinets priced per-unit by the same sell formula,
// plus shipping added once per order by the container. Adjust as needed.
export const TRADE = {
  capPerContainer: 60,                       // cabinets per shipping container
  shipPerContainerUSD: 2000 * PRICING.fx * PRICING.margin, // £2,000 → sell $
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

// GBP workshop cost → customer sell $ (same FX × margin as cabinets; the per-
// cabinet wrap doesn't apply to trim/accessories).
const accSell = (gbp) => Math.round(gbp * PRICING.fx * PRICING.margin);

// Painted filler panel — auto-added to close a small gap to a wall. £30 cost.
export const FILLER_SELL = accSell(30);

// Cornice / crown molding — auto-applies to the top of wall, tall and counter
// cabinets. £50 per linear foot (cost) → customer $ per foot.
export const CORNICE_OPTIONS = {
  none: { label: 'No crown', code: '', sellPerFt: 0 },
  plain: { label: 'Plain crown', code: 'A13', sellPerFt: accSell(50), blurb: 'A 7/8-inch bar with a thumb-round edge, standing 5/8 inch proud of the doors.' },
  decorative: { label: 'Georgian crown', code: 'A14', sellPerFt: accSell(50), blurb: 'A built-up, stepped crown profile.' },
};
export function corniceOption(name) { return CORNICE_OPTIONS[name] || CORNICE_OPTIONS.none; }

// Worktop options for the UI (not supplied by Plinth — visual only).
export const WORKTOP_OPTIONS = {
  marble: { label: 'Marble', hex: '#eae7e0' },
  granite: { label: 'Granite', hex: '#3a3b40' },
  oak: { label: 'Oak', hex: '#b98c50' },
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
