// layouts.js — procedural draft-kitchen generator. Given a shape and room size
// it returns an ordered list of placements that read like a real kitchen: tall
// larder + fridge at one end, a range, a sink base, a dishwasher, drawer banks,
// a bin, and base cabinets filling the rest. A seed drives the variety so
// "Generate again" produces a different (but still sensible) layout each time.

import { getCab, sizedFridgeCode } from './catalogue.js';

function rng32(seed) {
  // scramble the seed so ADJACENT seeds (Generate again → seed+1) give clearly
  // different layouts, not tiny variations.
  let s = (Math.imul((seed >>> 0) ^ 0x9E3779B9, 0x85EBCA6B) >>> 0) || 1;
  const next = () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next(); next();   // warm up to decorrelate
  return next;
}
const W = (code) => (getCab(code)?.w) || 24;

/**
 * Standard kitchen-planning rules:
 *  - the SINK is never directly beside the COOKER (a landing base sits between),
 *  - the work triangle runs FRIDGE → SINK → COOKER,
 *  - a dishwasher sits next to the sink (not the cooker),
 *  - essentials (sink, landing, cooker) always fit first; talls / DW / fillers
 *    are added only with the leftover wall.
 * @returns {{steps: Array<{wall, code, sink?:boolean}>}}
 */
const WALKWAY = 44;     // 44" clear walkway we keep around an island (hard rule)

// Fill `inches` with drawer units so the run reaches the wall as closely as
// possible — a subset-sum pack (20/24/28/36) that gets nearest to the target,
// so we never leave a big awkward gap (greedy could leave up to ~19").
const FILL_UNITS = [{ c: 'F20', w: 36 }, { c: 'F19', w: 28 }, { c: 'F18', w: 24 }, { c: 'F17', w: 20 }];
function fillRun(inches) {
  const cap = Math.floor(inches + 0.5);
  if (cap < 20) return [];
  const reach = new Array(cap + 1).fill(null);
  reach[0] = { prev: -1, c: null };
  for (let s = 0; s <= cap; s++) {
    if (!reach[s]) continue;
    for (const u of FILL_UNITS) { const ns = s + u.w; if (ns <= cap && !reach[ns]) reach[ns] = { prev: s, c: u.c }; }
  }
  let best = -1; for (let s = cap; s >= 20; s--) { if (reach[s]) { best = s; break; } }
  if (best <= 0) return [];
  const out = [];
  for (let s = best; s > 0; s = reach[s].prev) out.push({ code: reach[s].c });
  return out;
}

/**
 * The largest stretch of a wall that's clear of doors/doorways (with a 4"
 * margin each side), as [start, end] in inches along the wall. Side walls
 * start 25" in (clear of the corner unit); the front wall starts 1" in.
 * Both the generator (budget) and the wizard (placement) use this — one
 * source of truth, so runs never block a door.
 */
export function wallFreeSpan(room, wall) {
  const len = (wall === 'left' || wall === 'right') ? (room.depth || 120) : (room.width || 144);
  // side runs start at the corner unit's front plane (0.25 wall gap + 24"
  // body) so the perpendicular frames meet leg-to-leg at the corner, with a
  // hair of clearance so touching footprints never read as an overlap
  let start = wall === 'front' ? 1 : 24.3;
  let end = len - 1;

  // a door on a PERPENDICULAR wall near the shared corner also blocks this
  // wall's run (you'd walk straight into the cabinets) — keep a door's width
  // + swing (40") clear of that corner.
  const CLEAR = 40, NEAR = 26;
  const perp = wall === 'front' ? ['left', 'right'] : (wall === 'left' || wall === 'right') ? ['front'] : [];
  for (const pw of perp) {
    const plen = (pw === 'left' || pw === 'right') ? (room.depth || 120) : (room.width || 144);
    for (const o of (room.openings || [])) {
      if ((o.wall || 'back') !== pw) continue;
      if (o.type !== 'door' && o.type !== 'doorway') continue;
      const half = ((o.width || 34) + 8) / 2;
      const c = (o.pos ?? 0.5) * plen;
      if (wall === 'front') {
        if (pw === 'left' && c + half > plen - NEAR) start = Math.max(start, CLEAR);
        if (pw === 'right' && c + half > plen - NEAR) end = Math.min(end, len - CLEAR);
      } else {
        // side wall vs a front-wall door near this wall's corner
        const nearCorner = wall === 'left' ? (c - half < NEAR) : (c + half > plen - NEAR);
        if (nearCorner) end = Math.min(end, len - CLEAR);
      }
    }
  }
  let spans = [[start, Math.max(start, end)]];
  for (const o of (room.openings || [])) {
    if ((o.wall || 'back') !== wall) continue;
    if (o.type !== 'door' && o.type !== 'doorway') continue;
    const half = ((o.width || 34) + 8) / 2;            // door + 4" margin each side
    const c = (o.pos ?? 0.5) * len;
    const next = [];
    for (const [a, b] of spans) {
      if (c + half <= a || c - half >= b) { next.push([a, b]); continue; }
      if (c - half - a > 4) next.push([a, c - half]);
      if (b - (c + half) > 4) next.push([c + half, b]);
    }
    spans = next;
  }
  spans.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
  return spans[0] || [start, start];
}

/**
 * @param {object} opts appliance interview (wizard step 4). Defaults preserve
 *   the classic behaviour exactly, so existing layouts/tests are untouched:
 *   - cooking: 'range' (a range cooker, sized by the generator) |
 *     'wallOven' (a hob in the worktop over a drawer base + a T9 oven housing
 *     joining the talls at the fridge end — the hob inherits every cooker
 *     spacing rule: never at a wall end, never beside the sink)
 *   - fridge: 'integrated' (T3 housing) | 'freestanding' (AP9 appliance)
 *   - fridgeSize: {w,d,h} inches (freestanding only) — the AP9 becomes a sized
 *     'AP9:WxDxH' code and its ACTUAL width is budgeted; a freestanding fridge
 *     always parks at the very END of its run so the owner can slide it out
 *   - dishwashers: 1 | 2 (the second F7 sits on the other side of the sink)
 */
export function generateKitchen(shape, room, seed = 1, opts = {}) {
  const r = rng32(seed);
  const wallOven = opts.cooking === 'wallOven';
  const freeFridge = opts.fridge === 'freestanding';
  const FRIDGE = freeFridge ? (opts.fridgeSize ? sizedFridgeCode(opts.fridgeSize) : 'AP9') : 'T3';
  const twoDW = opts.dishwashers === 2;
  const chance = (p) => r() < p;
  const pick = (a) => a[Math.floor(r() * a.length)];
  const steps = [];
  const width = room.width || 144;
  const depth = room.depth || 120;
  // the corner cabinet's BODY (24") plus its blank return both sit along the
  // back wall, so reserve body + return — otherwise the run overshoots and the
  // end cabinet clamps on top of its neighbour. The return is budgeted at
  // 24.25" (perpendicular run depth + wall scribe), NOT the 20" SKU: the
  // corner sits LEG-TO-LEG with the perpendicular run — its body starts where
  // that run's boxes end, and the drawn return stretches to the wall behind
  // them (cornerReturnLength covers the extra 4.25").
  const CORNER_RETURN = 24.25;
  // U-SHAPE = an L with a second corner + a run down the RIGHT wall too;
  // GALLEY = the working run plus a facing run (fridge wall) on the FRONT.
  // Both degrade to their simpler parent when the room can't take them.
  let uShape = shape === 'u-shape';
  let lLike = shape === 'l-shape' || shape === 'u-shape';
  // GUARANTEE: a corner unit only exists where the perpendicular leg actually
  // MEETS it at a right angle. If the side wall's free span can't hold even
  // one base cabinet (< 24"), the corner would stand orphaned with its blank
  // return meeting nothing — so the L/U degrades to a straight back run
  // (fridge and talls rejoin the back wall) instead of emitting the corner.
  if (lLike) {
    const [lA, lB] = wallFreeSpan(room, 'left');
    if (lB - lA < 24) { lLike = false; uShape = false; }   // no left leg → straight
    else if (uShape) {
      const [rA0, rB0] = wallFreeSpan(room, 'right');
      if (rB0 - rA0 < 24) uShape = false;                  // right corner orphaned → L
    }
  }
  const galley = shape === 'galley' && depth >= 92;        // two 24" runs + an 1100mm corridor
  const cornerW = lLike ? W('F16') + CORNER_RETURN : 0;

  // --- the working back run -------------------------------------------------
  // COOKER flanked by a drawer bank each side; SINK with a landing before the
  // cooker (work triangle); dishwasher by the sink. Talls (fridge + larder) go
  // at an OPEN END, never mid-run.
  // EVERY layout MUST contain: SINK, COOKER, FRIDGE, DISHWASHER, BIN — always,
  // whatever the room size. They're reserved first so they can never be dropped.
  // The bin sits between the sink and the cooker, so it doubles as the required
  // separator (sink is never directly beside the cooker). Prefer a 36" range,
  // fall back to 30" so all five still fit a tight wall.
  // --- kitchen PERSONALITY — one seeded pick that swings several choices at
  // once, so "Generate again" reads like a genuinely different design, not the
  // same kitchen with one cabinet moved:
  //   chef        — biggest range that fits + hood, tray storage, drawer banks
  //   entertainer — glazed dressers, open shelving, a show island, wide bin
  //   minimal     — clean drawer runs, plain uppers, nothing fussy
  //   classic     — the balanced Plinth look
  const persona = pick(['classic', 'chef', 'entertainer', 'minimal']);

  // sink: a 24" single is the staple; roomier walls sometimes take a 28"
  // single or (big rooms) a 36" double base with a double-bowl sink.
  const sinkCode = (width >= 160 && chance(0.3)) ? 'F10' : (width >= 144 && chance(0.35)) ? 'F3' : 'F2';
  const sink = { code: sinkCode, sink: true };
  const fridgeOnBack = !lLike && !galley;                 // L/U: fridge on the side run; galley: facing run

  // --- short-wall degradation (L-shape only) --------------------------------
  // The corner (44" incl. return), sink and cooker can out-measure a short back
  // wall. NEVER overshoot (the overlap pass would delete cabinets): instead
  // exile units to the SIDE run — first the cooker (kept on the back wall only
  // if a separator AND a far-side unit, two 10" tray spaces at minimum, can
  // still flank it), then, on a really tiny wall, the corner unit itself.
  // wall-oven mode: the cook slot is a 36" drawer base carrying a hob (36"
  // when the wall affords it, else a 30" hob centred on the same base)
  const cookMin = wallOven ? W('F20') : W('AP1');
  let hasCorner = lLike;
  let cookOnSide = false;
  if (lLike) {
    const essentials = W(sink.code) + cookMin + 2 * W('F8');
    const sinkZone = W(sink.code) + 2 * W('F8');             // sink + minimal guards
    if (uShape && width < 2 * cornerW + essentials) {
      // a U-shape means THREE walls: before giving up the second corner, try
      // exiling the cooker to a side leg — the U survives on narrower rooms.
      // On the very tightest U the sink keeps ONE tray-space guard (its other
      // neighbour is a corner door, which is fine beside a sink).
      if (width >= 2 * cornerW + sinkZone) cookOnSide = true;
      else if (width >= 2 * cornerW + W(sink.code) + W('F8')) cookOnSide = true;
      else uShape = false;                                    // truly too narrow → L
    }
    if (!cookOnSide && width < (uShape ? 2 : 1) * cornerW + essentials) cookOnSide = true;
    if (width < cornerW + W(sink.code)) hasCorner = false;   // can't even hold corner + sink
  }
  // NO corner unit but a side leg still coming? The two runs would CRASH at
  // the junction (a back-run door dead against the leg's boxes). Reserve the
  // DEAD-CORNER SHADOW (the leg's 24" depth) so the back run stays clear of
  // it — and if even sink + shadow won't fit, drop the leg: the L degrades
  // to a straight run rather than build an impossible corner.
  const CORNER_SHADOW = 24;
  let sideLeg = lLike;
  let shadowUsed = 0;
  if (lLike && !hasCorner) {
    if (width >= CORNER_SHADOW + W(sink.code)) shadowUsed = CORNER_SHADOW;
    else { sideLeg = false; uShape = false; }
  }
  const cornerUsed = (hasCorner ? (uShape ? 2 : 1) * cornerW : 0) + shadowUsed;
  // last-resort guard: on a physically-impossible wall (can't hold sink + a 30"
  // range) the cooker is left off the back run entirely rather than overshoot.
  const cookOnBack = !cookOnSide && (width - cornerUsed - W(sink.code) >= cookMin);
  // range: 36" when the wall affords it, 30" fallback — and a CHEF kitchen
  // takes the 48" pro range on a wall big enough to keep every rule intact.
  // wall-oven mode: the same slot takes a 36" drawer base + a hob on top.
  let cook, hob = null;
  if (wallOven) {
    cook = 'F20';
    hob = (cookOnBack && width - cornerUsed - 116 >= W('AP5')) ? 'AP5' : 'AP4';
  } else {
    cook =
      (cookOnBack && persona === 'chef' && width - cornerUsed - 116 >= W('AP3')) ? 'AP3' :
      (cookOnBack && width - cornerUsed - 116 >= W('AP2')) ? 'AP2' : 'AP1';
  }

  // reserve the five essentials FIRST, each only if it truly fits (so we never
  // force an overshoot). For any realistic wall they all fit; the bin — which can
  // also live inside a normal cabinet — is the only one dropped on a wall too
  // small to physically hold them all.
  let avail = width - cornerUsed - W(sink.code) - (cookOnBack ? W(cook) : 0);
  const talls = [];
  let dw = null, dw2 = null, dwOnSide = false, dwOnFront = false;
  if (fridgeOnBack && avail >= W(FRIDGE)) { talls.push({ code: FRIDGE }); avail -= W(FRIDGE); }  // fridge (tall housing or freestanding)
  // dishwasher — essential, by the sink. On an L/U it moves to the side run
  // (still near the sink, just around the corner) when keeping it on the back
  // wall would squeeze out the bin and the cooker's guards; on a tight galley
  // it crosses to the facing run rather than starve the cooker's far guard
  // (a galley has no talls on the working wall to close the cooker's end).
  const dwFits = avail >= W('F7') &&
    (!lLike || !cookOnBack || avail - W('F7') >= W('F21') + W('F8')) &&
    (!galley || avail - W('F7') >= W('F8'));
  if (dwFits) { dw = { code: 'F7' }; avail -= W('F7'); }
  else if (lLike) dwOnSide = true;
  else if (galley) dwOnFront = true;
  // a SECOND dishwasher (entertainer households) flanks the sink's other side
  if (twoDW && dw && avail >= W('F7')) { dw2 = { code: 'F7' }; avail -= W('F7'); }

  // wall-oven mode: the T9 oven housing joins the talls at the fridge end —
  // taken only when the cooker guards (bin separator + far-side tray at
  // minimum) still fit afterwards, so no hard spacing rule is ever starved.
  if (fridgeOnBack && wallOven && avail >= W('T9') + (cookOnBack ? W('F21') + W('F8') : 0)) {
    talls.push({ code: 'T9' }); avail -= W('T9');
  }

  // --- optional extras, added in a designer's priority order while there's room ---
  const minLand = W('F17');                              // 20" — the narrowest landing
  // DOOR-AWARE tall end: a door on a side wall near the back corner means a
  // tall block at that end of the back run would box the doorway in (a dead
  // corner you walk into) — so the talls anchor the OTHER end. Only when no
  // door constrains the run does the seeded coin pick the end.
  let doorEnd = null;                                    // 'left' | 'right' — back-run end that meets a doorway
  for (const o of (room.openings || [])) {
    if (o.type !== 'door' && o.type !== 'doorway') continue;
    const ow = o.wall || 'back';
    if (ow !== 'left' && ow !== 'right') continue;
    const half = ((o.width || 34) + 8) / 2;
    const c = (o.pos ?? 0.5) * depth;                    // pos measured from the back wall
    if (c - half < 40) doorEnd = ow;                     // door begins within 40" of the back corner
  }
  const tallEnd = chance(0.5) ? 'right' : 'left';
  // a landing is as wide as fits: 28" / 24" / 20", so a tight wall still gets one
  // (and the gap-closer can then widen it out to the wall — no dead gap).
  const landing = () => (avail >= W('F19') ? pick(['F18', 'F19']) : avail >= W('F18') ? 'F18' : 'F17');
  let landingL = null, landingR = null, sinkLanding = null, tray = null, bin = null;
  if (cookOnBack) {
    // The cooker's guards, allocated JOINTLY so both rules hold at once: a
    // SEPARATOR keeps the sink off the cooker (the bin preferred — it's also an
    // essential) and a FAR-SIDE unit keeps the cooker off the wall end. On a
    // tight wall each guard degrades to a 10" tray space before giving up.
    const binCode = (persona !== 'minimal' && avail >= W('F22') + minLand + 6 && chance(0.4)) ? 'F22' : 'F21';
    if (avail >= W(binCode) + minLand) { bin = { code: binCode }; avail -= W(binCode); landingR = { code: landing() }; avail -= W(landingR.code); }
    else if (avail >= W('F21') + W('F8')) { bin = { code: 'F21' }; avail -= W('F21'); tray = { code: 'F8' }; avail -= W('F8'); }
    else if (avail >= 2 * W('F8')) { landingL = { code: 'F8' }; tray = { code: 'F8' }; avail -= 2 * W('F8'); }
    else if (avail >= W('F8')) {
      // room for only ONE guard: separate the sink when the talls can close the
      // cooker's end instead (forced below); otherwise guard the wall end.
      if (talls.length) landingL = { code: 'F8' }; else tray = { code: 'F8' };
      avail -= W('F8');
    }
  } else if (avail >= W('F21')) { bin = { code: 'F21' }; avail -= W('F21'); }  // no cooker on this wall — the bin just joins the sink group

  if (!landingL && avail >= minLand) { landingL = { code: landing() }; avail -= W(landingL.code); } // sink-zone ↔ cooker worktop
  if (!tray && avail >= W('F8')) { tray = { code: 'F8' }; avail -= W('F8'); }                        // slim tray space by the oven
  if (avail >= minLand) { sinkLanding = { code: landing() }; avail -= W(sinkLanding.code); }         // extra worktop by the sink
  // wider wall → talls next to the fridge; the POOL follows the personality:
  // chef favours larders with internal drawers, an entertainer shows off a 44"
  // double larder, minimal keeps to plain singles.
  const TALL_POOL = {
    classic: ['T5', 'T1', 'T5'], chef: ['T6', 'T5', 'T6', 'T1'],
    entertainer: ['T7', 'T5', 'T1'], minimal: ['T1', 'T5', 'T1'],
  }[persona];
  if (fridgeOnBack) { while (talls.length < 4) { const c = pick(TALL_POOL); if (avail < W(c) + 40) break; talls.push({ code: c }); avail -= W(c); } }

  const fill = fillRun(Math.max(0, avail));

  // sink group: the sink is FLANKED — dishwasher one side, bin (or the second
  // dishwasher) the other — never left with a bare flank. The bin defaults to
  // the cooker side, where it doubles as the sink↔cooker separator. A seeded
  // mirror of the trio varies "Generate again" — skipped when it would drop
  // the leg-less F7 straight onto the cooker (no landing between them).
  let trio = [...(dw ? [dw] : []), sink, ...(dw2 ? [dw2] : []), ...(bin ? [bin] : [])];
  if ((bin || dw2) && dw && (landingL || !cookOnBack) && chance(0.5)) trio = trio.slice().reverse();
  const cookStep = cookOnBack ? { code: cook, hob } : null;
  const sinkGroup = [
    ...(sinkLanding ? [sinkLanding] : []),
    ...trio,
    ...(landingL ? [landingL] : []),
    ...(cookStep ? [cookStep] : []),
    ...(landingR ? [landingR] : []), ...(tray ? [tray] : []),
  ];

  // seeded split of the fill drawers around the sink group — the sink zone
  // wanders along the wall between generations. If the group ends with the
  // cooker (no guard fit), at least one fill unit stays on its far side.
  const groupEndsWithCook = cookOnBack && sinkGroup[sinkGroup.length - 1] === cookStep;
  let cut = Math.floor(r() * (fill.length + 1));
  if (groupEndsWithCook && fill.length && cut >= fill.length) cut = fill.length - 1;
  // the sink group's EXPOSED flanks (the sink itself, or the leg-less F7)
  // never meet a bare wall end when a fill unit can cover them: worktop must
  // run past the basin, and the dishwasher panel borrows its neighbours' legs.
  const exposedStep = (s) => !!s && (!!s.sink || s.code === 'F7');
  if (fill.length && !sinkLanding && exposedStep(sinkGroup[0]) && cut === 0) cut = 1;
  if (fill.length && exposedStep(sinkGroup[sinkGroup.length - 1]) && cut >= fill.length) cut = fill.length - 1;
  const fillA = fill.slice(0, cut), fillB = fill.slice(cut);

  let run;
  if (lLike) {
    // corner at the left junction; a U-shape closes the run with a mirrored
    // corner at the RIGHT junction too (blank return toward the right wall).
    run = [...(hasCorner ? [{ code: 'F16', corner: true }] : []), ...fillA, ...sinkGroup, ...fillB,
      ...(hasCorner && uShape ? [{ code: 'F16R', corner: true }] : [])];
  } else {
    // talls anchor one end (varies between layouts); fill splits around the sink.
    // But if NOTHING follows the cooker (no guard fit, no fill) the talls MUST
    // close that end — the cooker is never left at the bare wall end.
    const body = [...fillA, ...sinkGroup, ...fillB];
    let end = tallEnd;
    if (doorEnd) end = doorEnd === 'left' ? 'right' : 'left';   // talls flee the doorway end
    // the body flank that meets the BARE wall end (opposite the talls) should
    // be the most harmless one: the sink or the leg-less F7 must NEVER stand
    // there, and the cooker is a distant second choice. Mirroring the body
    // keeps every internal adjacency (bin still separates sink and cooker)
    // while tucking the worst flank against the tall block.
    if (talls.length && body.length > 1) {
      // worst → best at a bare wall: the cooker (hard rule — heat never at the
      // wall end), then the leg-less F7, then the sink, then anything else.
      // On an over-constrained wall this forfeits the lesser rules in order.
      const flankScore = (s) => isCookStep(s) ? 3 : s.code === 'F7' ? 2 : s.sink ? 1 : 0;
      const bareIdx = end === 'right' ? 0 : body.length - 1;
      if (flankScore(body[bareIdx]) > flankScore(body[body.length - 1 - bareIdx])) body.reverse();
    }
    // a FREESTANDING fridge parks at the very END of the run — the outermost
    // tall slot — so the owner can slide it out for cleaning / replacement.
    if (freeFridge) {
      const fi = talls.findIndex((t) => t.code === FRIDGE);
      if (fi >= 0) {
        const [f] = talls.splice(fi, 1);
        if (end === 'right') talls.push(f); else talls.unshift(f);
      }
    }
    run = end === 'right' ? [...body, ...talls] : [...talls, ...body];
    // seeded MIRROR of the whole run — preserves every adjacency (each unit
    // keeps its neighbours), so even a fully-constrained wall has two looks.
    // Skipped when a doorway dictates the tall end (the mirror would undo it).
    if (!doorEnd && chance(0.5)) run.reverse();
  }
  // close any end gap: widen the flexible base units (landings + fill drawers)
  // in +4" steps so the run reaches the wall, leaving only a scribe-filler gap.
  {
    const flex = [landingL, landingR, sinkLanding, ...fill].filter(Boolean);
    const up = { F17: ['F18', 4], F18: ['F19', 4], F19: ['F20', 8] };
    // the corner's 20" return also occupies wall length — count it so the run
    // reaches (but never overshoots) the wall.
    let gap = width - shadowUsed - run.reduce((t, o) => t + W(o.code) + (o.corner ? CORNER_RETURN : 0), 0) - 1;
    let changed = true;
    while (gap >= 4 && changed) {
      changed = false;
      for (const u of flex) {
        const s = up[u.code];
        if (s && s[1] <= gap) { u.code = s[0]; gap -= s[1]; changed = true; if (gap < 4) break; }
      }
    }
  }
  // entertainer / minimal kitchens swap the odd drawer bank for OPEN base
  // shelves — identical widths (F17→F23, F18→F24, F19→F25), so every budget,
  // gap and guard rule is untouched. Done AFTER the gap-closer so widening
  // isn't lost.
  const OPEN_SWAP = { F17: 'F23', F18: 'F24', F19: 'F25' };
  if (persona === 'entertainer' || persona === 'minimal') {
    for (const u of fill) if (OPEN_SWAP[u.code] && chance(0.3)) u.code = OPEN_SWAP[u.code];
  }
  for (const o of run) steps.push({ wall: 'back', code: o.code, sink: o.sink, corner: o.corner, hob: o.hob });

  // ---- L-shape side run — placed by the wizard FORWARD of the corner unit.
  // A TALL fridge (+ larder when it fits) anchors the OPEN end; base drawers
  // fill the rest of the side wall so the whole leg is used. ----
  if (sideLeg) {
    // the leg runs from just clear of the corner unit all the way to the FRONT
    // wall — the ENTIRE side wall bar a scribe gap — but never across a door.
    let sremain = Math.max(0, wallFreeSpan(room, 'left')[1] - wallFreeSpan(room, 'left')[0]);
    const sideTalls = [];
    // the FRIDGE always stands on the side run (every layout has a fridge),
    // with a larder alongside it when the leg is long enough.
    if (sremain >= W(FRIDGE)) { sideTalls.push(FRIDGE); sremain -= W(FRIDGE); } // fridge — always
    // units exiled from a short back wall come next in the budget (essentials
    // before the optional larder): the cooker, then the dishwasher.
    let sideCook = null, sideClear = null;
    if (cookOnSide && sremain >= cookMin) {
      sideCook = wallOven ? { code: 'F20', hob: 'AP4' } : { code: 'AP1' };
      sremain -= cookMin;
      // RANGE CLEARANCE: the talls close the leg's open end, so an exiled
      // cooker needs its 18"+ landing reserved BEFORE any optional fill — a
      // drawer bank between the cooker and the tall block (seeded 20"/24"
      // width so tight legs still vary between generations)
      if (sideTalls.length && sremain >= W('F17')) {
        sideClear = (sremain >= W('F18') + 10 && chance(0.5)) ? 'F18' : 'F17';
        sremain -= W(sideClear);
      }
    }
    const sideFront = [];
    if (dwOnSide && sremain >= W('F7')) { sideFront.push('F7'); sremain -= W('F7'); dwOnSide = false; } // DW nearest the corner — closest to the sink
    // wall-oven mode: the T9 oven housing joins the fridge on the side run
    if (wallOven && sremain >= W('T9')) { sideTalls.push('T9'); sremain -= W('T9'); }
    if (sremain >= W('T5') + 20 && chance(0.6)) { sideTalls.push('T5'); sremain -= W('T5'); } // + larder when there's room
    // fill the rest of the leg wall-to-wall: subset-sum pack of drawer banks
    // (nearest reach), a 10" tray space mops up a sub-20" remainder, and the
    // seeded shuffle reorders the banks so "Generate again" reads differently.
    const sideFill = fillRun(sremain).map((o) => o.code);
    sremain -= sideFill.reduce((t, c) => t + W(c), 0);
    if (sremain >= W('F8')) { sideFill.push('F8'); sremain -= W('F8'); }
    for (let i = sideFill.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [sideFill[i], sideFill[j]] = [sideFill[j], sideFill[i]]; }
    // the DW sometimes tucks one unit in from the corner — another seeded change
    if (sideFront.length && sideFill.length && chance(0.5)) sideFill.splice(1, 0, sideFront.pop());
    // order along the wall (corner → open end): dishwasher, base fill, the
    // exiled cooker (mid-run — NEVER at the open end: the talls close it, or a
    // base unit does when the leg has no talls), then the talls.
    // the cooker NEVER sits hard in the corner: something always precedes it
    if (sideCook && !sideFront.length && !sideFill.length && sremain >= 10) { sideFill.push('F8'); sremain -= 10; }
    // a freestanding fridge takes the OPEN end of the leg (last placed) —
    // after the other talls — so it can slide straight out.
    if (freeFridge) {
      const fi = sideTalls.indexOf(FRIDGE);
      if (fi >= 0 && fi !== sideTalls.length - 1) { sideTalls.splice(fi, 1); sideTalls.push(FRIDGE); }
    }
    let sideRun;
    if (!sideCook) sideRun = [...sideFront, ...sideFill, ...sideTalls];
    else if (sideTalls.length) sideRun = [...sideFront, ...sideFill, sideCook, ...(sideClear ? [sideClear] : []), ...sideTalls];
    else if (sideFill.length) sideRun = [...sideFront, ...sideFill.slice(0, -1), sideCook, ...sideFill.slice(-1)];
    else sideRun = [...sideFront, sideCook];
    for (const c of sideRun) steps.push({ wall: 'left', code: c.code || c, hob: c.hob });
  }

  // ---- U-shape RIGHT leg — a pantry/prep run down the right wall, filled
  // wall-to-wall like the left leg, sometimes anchored by a larder.
  if (uShape && hasCorner) {
    const [rA, rB] = wallFreeSpan(room, 'right');
    let rremain = Math.max(0, rB - rA);
    const rFront = [];
    // the dishwasher falls through to the RIGHT leg when the left one is full
    if (dwOnSide && rremain >= W('F7')) { rFront.push('F7'); rremain -= W('F7'); dwOnSide = false; }
    const rTalls = [];
    if (rremain >= W('T5') + 20 && chance(0.5)) { rTalls.push('T5'); rremain -= W('T5'); }
    const rFill = fillRun(rremain).map((o) => o.code);
    rremain -= rFill.reduce((t, c) => t + W(c), 0);
    if (rremain >= W('F8')) { rFill.push('F8'); rremain -= W('F8'); }
    for (let i = rFill.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [rFill[i], rFill[j]] = [rFill[j], rFill[i]]; }
    for (const c of [...rFront, ...rFill, ...rTalls]) steps.push({ wall: 'right', code: c });
  }

  // ---- galley FACING run — the fridge wall opposite the working run: talls
  // anchor one end (seeded side), drawer banks fill the rest wall-to-wall.
  if (galley) {
    const [fA, fB] = wallFreeSpan(room, 'front');
    let fremain = Math.max(0, fB - fA);
    const fTalls = [];
    if (fremain >= W(FRIDGE)) { fTalls.push(FRIDGE); fremain -= W(FRIDGE); }    // fridge — always
    const fFront = [];
    if (dwOnFront && fremain >= W('F7')) { fFront.push('F7'); fremain -= W('F7'); }
    // wall-oven mode: the T9 oven housing joins the fridge on the facing run
    if (wallOven && fremain >= W('T9')) { fTalls.push('T9'); fremain -= W('T9'); }
    if (fremain >= W('T5') + 20 && chance(0.6)) { fTalls.push('T5'); fremain -= W('T5'); }
    const fFill = fillRun(fremain).map((o) => o.code);
    fremain -= fFill.reduce((t, c) => t + W(c), 0);
    if (fremain >= W('F8')) { fFill.push('F8'); fremain -= W('F8'); }
    for (let i = fFill.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [fFill[i], fFill[j]] = [fFill[j], fFill[i]]; }
    const tallsFirst = chance(0.5);
    // freestanding fridge → the OUTERMOST slot of the talls group (the run end)
    if (freeFridge) {
      const fi = fTalls.indexOf(FRIDGE);
      if (fi >= 0) {
        fTalls.splice(fi, 1);
        if (tallsFirst) fTalls.unshift(FRIDGE); else fTalls.push(FRIDGE);
      }
    }
    const seq = tallsFirst ? [...fTalls, ...fFront, ...fFill] : [...fFront, ...fFill, ...fTalls];
    for (const c of seq) steps.push({ wall: 'front', code: c });
  }

  // ---- island — sized to THIS room: keep a 1100mm walkway all round and fill
  // the rest with as many cabinets as fit. drawers · cabinet · drawers reads best.
  if (shape === 'island') {
    const maxLen = Math.min(width - 2 * WALKWAY, 120);       // longest island that keeps side walkways
    // seeded length — a big floor sometimes takes a shorter, airier island
    const islLen = maxLen < 80 ? maxLen : Math.round(maxLen * (0.75 + r() * 0.25));
    const isl = [];
    if (islLen >= 20) {
      let rem = islLen;
      const widths = [];
      while (rem >= 20) { const c = rem >= 36 ? 'F20' : rem >= 28 ? 'F19' : rem >= 24 ? 'F18' : 'F17'; if (W(c) > rem) break; widths.push(c); rem -= W(c); }
      // centre feature: a door cabinet — or, on a long island, sometimes a 36"
      // double (only swapped like-for-like so the island never grows)
      if (widths.length >= 3) {
        const mid = Math.floor(widths.length / 2);
        widths[mid] = (widths[mid] === 'F20' && chance(0.5)) ? 'F10' : 'F2';
      }
      // entertainer: open display shelves on the island ends
      if (persona === 'entertainer') {
        for (const i of [0, widths.length - 1]) {
          if (i >= 0 && OPEN_SWAP[widths[i]] && chance(0.6)) widths[i] = OPEN_SWAP[widths[i]];
        }
      }
      isl.push(...widths);
    }
    for (const c of (isl.length ? isl : ['F20'])) steps.push({ wall: 'island', code: c });
  }

  // extras the wizard lays on after the base run (it needs real geometry —
  // window & cooker positions — to place them). Varying flags per seed makes
  // "Generate again" feel genuinely different: wall cabinets, glazed doors, a
  // counter-height dresser.
  // uppers ALWAYS fill the wall above the run (never leave it bare). The style
  // varies per layout: hung wall cabinets, counter-standing dressers, or a mix.
  const STYLES = {
    classic: ['wall', 'wall', 'mix', 'counter'],
    chef: ['wall', 'wall', 'mix'],
    entertainer: ['counter', 'mix', 'counter', 'wall'],
    minimal: ['wall'],                                       // plain hung uppers only
  };
  const features = {
    persona,
    upperStyle: pick(STYLES[persona]),
    glazed: persona === 'entertainer' ? chance(0.7) : persona === 'minimal' ? false : chance(0.35),
    hood: persona === 'chef' || chance(0.5),                 // extractor over a ≥36" back-wall range
    islandSeating: persona === 'entertainer' || chance(0.5), // breakfast-bar overhang (wizard checks walkway)
  };

  // ---- RANGE CLEARANCE (hard rule): at least 18" of counter between any
  // cooking appliance (range, or a hob on its base) and any TALL / COUNTER
  // unit or a freestanding fridge — heat never lives against a tall box.
  // Pure reorder within each wall: widths are preserved (no overshoot), the
  // sink never lands beside the cooker, corners stay at their ends.
  enforceRangeClearance(steps);
  // ---- DISHWASHER PLACEMENT (hard rule): the F7 panel is LEGLESS — it only
  // works BETWEEN two leg-bearing cabinets whose 22mm legs it borrows. Never
  // at a run end, never first at a corner junction, never beside an appliance.
  enforceDishwasherPlacement(steps);
  // ---- SINK PLACEMENT (hard rule): the sink never stands hard against a wall
  // end — worktop must run past the basin on both sides. Runs LAST so no other
  // repair pass re-exposes it.
  enforceSinkOffEnds(steps);

  return { steps, features };
}


// ---- sink end-guard repair ----------------------------------------------------
// The seeded fill split (or a dishwasher re-seat) can leave the SINK as the
// outermost unit of a run — the basin hard against the wall. Repair: move one
// safely-movable plain base unit to the exposed end so worktop runs past the
// sink. A donor is never taken from beside the cooker or a tall (their
// clearance guards stay), never strands an F7 against a leg-less neighbour,
// and never joins the sink to the cooker.
export function enforceSinkOffEnds(steps) {
  for (const wall of ['back', 'left', 'right', 'front']) {
    const seq = steps.filter((s) => s.wall === wall);
    if (seq.length < 3) continue;
    for (const atEnd of [0, 1]) {
      const at = atEnd ? seq.length - 1 : 0;
      if (!seq[at].sink) continue;
      const donorOk = (k) => {
        const st = seq[k];
        const c = getCab(st.code);
        if (!c || c.type !== 'FLOOR' || st.sink || st.corner || st.hob || isCookStep(st) ||
            st.code === 'F7' || c.form === 'bin') return false;
        const L = seq[k - 1], R = seq[k + 1];
        if ((L && (isCookStep(L) || isTallishStep(L))) ||
            (R && (isCookStep(R) || isTallishStep(R)))) return false;  // keep cook/tall guards in place
        if (L && L.code === 'F7' && !legCabStep(R)) return false;      // F7 must keep leg-bearing neighbours
        if (R && R.code === 'F7' && !legCabStep(L)) return false;
        return true;
      };
      // scan from the OPPOSITE end so the donor disturbs the run least
      const order = [];
      for (let k = 0; k < seq.length; k++) order.push(atEnd ? k : seq.length - 1 - k);
      for (const k of order) {
        if (k === at) continue;
        if (!donorOk(k)) continue;
        const [d] = seq.splice(k, 1);
        if (atEnd) seq.push(d); else seq.unshift(d);
        break;
      }
    }
    let w = 0;
    for (let k = 0; k < steps.length; k++) if (steps[k].wall === wall) steps[k] = seq[w++];
  }
}


// ---- range clearance repair --------------------------------------------------
export const RANGE_CLEAR = 18;   // inches of counter between a cooker and a tall

const isCookStep = (s) => /^AP[123]$/.test(s.code) || !!s.hob;
const isTallishStep = (s) => {
  const c = getCab(s.code);
  return !!c && (c.type === 'TALL' || c.type === 'COUNTER' || c.appliance === 'fridge');
};

/**
 * Reorder each wall's steps so >= RANGE_CLEAR inches of base run separates the
 * cooking step from the nearest tall/counter/fridge on BOTH sides. Only plain
 * FLOOR units move (never the sink, a corner, or the cook itself), a donor is
 * never taken from directly beside the cook (it stays guarded and off the run
 * ends), and donors insert against the offending tall. Exported for tests.
 */
export function enforceRangeClearance(steps) {
  for (const wall of ['back', 'left', 'right', 'front']) {
    const seq = steps.filter((s) => s.wall === wall);
    if (!seq.some(isCookStep) || !seq.some(isTallishStep)) continue;
    const i0 = () => seq.findIndex(isCookStep);
    for (let guard = 0; guard < 24; guard++) {
      const i = i0();
      // nearest under-cleared tall on either side of the cook
      let bad = null;                                 // { dir, gap, tall }
      for (const dir of [-1, 1]) {
        let gap = 0;
        for (let j = i + dir; j >= 0 && j < seq.length; j += dir) {
          if (isTallishStep(seq[j])) {
            if (gap < RANGE_CLEAR - 0.01 && (!bad || gap < bad.gap)) bad = { dir, gap, tall: seq[j] };
            break;
          }
          gap += W(seq[j].code);
        }
      }
      if (!bad) break;
      const ti = seq.indexOf(bad.tall);
      const lo = Math.min(i, ti), hi = Math.max(i, ti);
      // donor: farthest movable plain base OUTSIDE the cook->tall stretch
      const movable = (k, allowTrio) => {
        const st = seq[k];
        const c = getCab(st.code);
        if (!c || c.type !== 'FLOOR' || st.sink || st.corner || st.hob || isCookStep(st)) return false;
        // the DW·SINK·BIN trio stays glued to the sink — broken up only as a
        // LAST RESORT, when no other unit can pad the cooker clearance
        if (!allowTrio && (c.form === 'dishwasher' || c.form === 'bin')) return false;
        if (Math.abs(k - i) === 1) return false;      // keep the cook guarded + off the ends
        const L = seq[k - 1], R = seq[k + 1];         // removal must not join sink & cook
        if (L && R && ((L.sink && isCookStep(R)) || (R.sink && isCookStep(L)))) return false;
        return true;
      };
      let donorIdx = -1;
      for (const allowTrio of [false, true]) {
        for (let dist = seq.length; dist > 0 && donorIdx < 0; dist--) {
          for (const k of [i - dist, i + dist]) {
            if (k >= 0 && k < seq.length && (k < lo || k > hi) && movable(k, allowTrio)) { donorIdx = k; break; }
          }
        }
        if (donorIdx >= 0) break;
      }
      if (donorIdx < 0) break;                        // nothing safe to move
      const [donor] = seq.splice(donorIdx, 1);
      const t = seq.indexOf(bad.tall);
      seq.splice(bad.dir === 1 ? t : t + 1, 0, donor); // land against the tall, cook side
    }
    let w = 0;
    for (let k = 0; k < steps.length; k++) if (steps[k].wall === wall) steps[k] = seq[w++];
  }
}


// ---- dishwasher placement repair ----------------------------------------------
// The dishwasher panel (F7, 'Dishwasher Door & Plinth') has NO legs of its own
// — it borrows the 22mm legs of the cabinets EITHER SIDE. So it must sit
// between two leg-bearing cabinets (FLOOR or TALL, incl. a corner unit's door
// side): never at a run end, never first at a corner junction, never beside
// an appliance gap. Repaired by re-inserting F7 at the nearest-to-sink slot
// that satisfies it without worsening any other adjacency rule.

const legCabStep = (s) => {
  if (!s || s.code === 'F7') return false;
  const c = getCab(s.code);
  return !!c && (c.type === 'FLOOR' || c.type === 'TALL') && c.form !== 'dishwasher';
};

/** Count adjacency-rule violations in one wall sequence (lower is better). */
function runViolations(seq) {
  let sinkCook = 0, cookEnd = 0, clearance = 0, cornerMid = 0, dw = 0, sinkEnd = 0;
  const si = seq.findIndex((s) => s.sink);
  if (si === 0 || (si >= 0 && si === seq.length - 1)) sinkEnd++;
  for (let i = 0; i < seq.length; i++) {
    const st = seq[i];
    if (st.corner && i !== 0 && i !== seq.length - 1) cornerMid++;
    if (st.code === 'F7' && !(legCabStep(seq[i - 1]) && legCabStep(seq[i + 1]))) dw++;
    if (i < seq.length - 1) {
      const b = seq[i + 1];
      if ((st.sink && isCookStep(b)) || (b.sink && isCookStep(st))) sinkCook++;
    }
  }
  const ci = seq.findIndex(isCookStep);
  if (ci === 0 || (ci >= 0 && ci === seq.length - 1)) cookEnd++;
  if (ci >= 0) {
    for (const dir of [-1, 1]) {
      let gap = 0;
      for (let j = ci + dir; j >= 0 && j < seq.length; j += dir) {
        if (isTallishStep(seq[j])) { if (gap < RANGE_CLEAR - 0.01) clearance++; break; }
        gap += W(seq[j].code);
      }
    }
  }
  return { sinkCook, cookEnd, clearance, cornerMid, dw, sinkEnd };
}

/** Re-seat every badly-neighboured F7 in the best valid slot on its wall. */
export function enforceDishwasherPlacement(steps) {
  for (const wall of ['back', 'left', 'right', 'front']) {
    const seq = steps.filter((s) => s.wall === wall);
    if (!seq.some((s) => s.code === 'F7')) continue;
    for (let guard = 0; guard < 4; guard++) {
      const i = seq.findIndex((s, k) => s.code === 'F7' && !(legCabStep(seq[k - 1]) && legCabStep(seq[k + 1])));
      if (i < 0) break;
      const base = runViolations(seq);
      const [dwStep] = seq.splice(i, 1);
      // candidate insertion points, nearest the sink first (plumbing), and
      // never further than ~56" of run from the sink — the DW-near-sink
      // guarantee outranks a tidy reseat (a bad slot is left for the warning).
      // (sink located AFTER the splice, so the index is in the current seq)
      const sinkIdx = seq.findIndex((s) => s.sink);
      const runPos = (idx) => seq.slice(0, idx).reduce((t, o) => t + W(o.code), 0);
      const sinkAt = sinkIdx < 0 ? null : runPos(sinkIdx) + W(seq[sinkIdx].code) / 2;
      const slots = [];
      for (let k = 1; k < seq.length; k++) slots.push(k);
      slots.sort((a, b) => (sinkIdx < 0 ? 0 : Math.abs(a - sinkIdx) - Math.abs(b - sinkIdx)));
      let placed = false;
      // two passes: first only slots that don't push the SINK to a wall end;
      // then — the leg rule outranks the sink rule (a leg-less panel at the
      // wall is unbuildable) — retry accepting a sink-end regression.
      for (const strictSink of [true, false]) {
        for (const k of slots) {
          if (!legCabStep(seq[k - 1]) || !legCabStep(seq[k])) continue;
          // inserting BEFORE the sink shifts the sink downstream by the DW width
          const sinkEff = sinkAt == null ? null : (k <= sinkIdx ? sinkAt + W(dwStep.code) : sinkAt);
          if (sinkEff != null && Math.abs(runPos(k) + W(dwStep.code) / 2 - sinkEff) > 56) continue;
          seq.splice(k, 0, dwStep);
          const v = runViolations(seq);
          if (v.dw === 0 && v.sinkCook <= base.sinkCook && v.cookEnd <= base.cookEnd &&
              v.clearance <= base.clearance && v.cornerMid <= base.cornerMid &&
              (!strictSink || v.sinkEnd <= base.sinkEnd)) { placed = true; break; }
          seq.splice(k, 1);
        }
        if (placed) break;
      }
      if (!placed) { seq.splice(Math.min(i, seq.length), 0, dwStep); break; }  // no safe slot — leave it (warning catches it)
    }
    let w = 0;
    for (let k = 0; k < steps.length; k++) if (steps[k].wall === wall) steps[k] = seq[w++];
  }
}
