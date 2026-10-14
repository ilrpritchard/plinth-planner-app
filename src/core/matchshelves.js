// matchshelves.js — PURE. Two open shelves either side of a hood come out the SAME width (her call
// 2026-10-14, a plaster hood with a narrower shelf on its left than on its right: "auto make them the
// same size and then note that the shelves are special size"). The hood is centred on the cooker, so
// the leftovers either side of it differ; the wider shelf is cut down to the narrower one's width, its
// hood-side edge staying put, and every upper beyond it on that side slides toward the hood by the
// difference (the leftover goes to the run's end, where a scribe filler takes it). A chain that holds a
// corner unit is left alone: a corner never leaves its corner.
//   planMatchShelves(state) -> { ok:true, pairs:[{ hoodId, keepId, cutId, code, w, x, z, moves:[{id,x,z}] }] }
//                            | { ok:false, reason:'no pair' | 'same' | 'corner' }

import { getCab, canFitWidth, sizedWidthCode } from './catalogue.js';

const NEAR = 3;              // a shelf this close to the hood's edge flanks it (uppers sit 50mm clear of a cooker)
const rotOf = (it) => (((it.rotDeg || 0) % 360) + 360) % 360;
const isHood = (c) => !!c && (c.appliance === 'hood' || c.hoodCover);
const isShelf = (c) => !!c && c.type === 'WALL' && c.form === 'open' && canFitWidth(c);
const hung = (c) => !!c && c.placeable && (c.type === 'WALL' || c.type === 'SHELF' || c.type === 'COUNTER' || c.appliance === 'hood');

export function planMatchShelves(state) {
  const items = (state && state.items) || [];
  const pairs = [];
  let reason = 'no pair';
  for (const h of items) {
    const hc = getCab(h.code); if (!isHood(hc)) continue;
    const rot = rotOf(h), horiz = rot % 180 === 0;
    const along = (o) => (horiz ? o.x : o.z), perp = (o) => (horiz ? o.z : o.x);
    const dir = rot === 0 || rot === 90 ? 1 : -1;                     // +along runs left to right on the back and left walls
    const lo = along(h) - hc.w / 2, hi = along(h) + hc.w / 2;
    const onWall = items.map((o) => ({ o, c: getCab(o.code) })).filter(({ o, c }) => o !== h && hung(c) && !c.stacker && rotOf(o) === rot && Math.abs(perp(o) - perp(h)) < 12);
    const left = onWall.find(({ o, c }) => isShelf(c) && Math.abs(along(o) + c.w / 2 - lo) <= NEAR);
    const right = onWall.find(({ o, c }) => isShelf(c) && Math.abs(along(o) - c.w / 2 - hi) <= NEAR);
    if (!left || !right) continue;
    if (Math.abs(left.c.w - right.c.w) < 0.05) { reason = 'same'; continue; }
    const wide = left.c.w > right.c.w ? left : right, narrow = wide === left ? right : left;
    const w = narrow.c.w, diff = wide.c.w - w;
    const side = wide === right ? 1 : -1;                                // which way "beyond" the wide shelf runs
    const edge = along(wide.o) + side * wide.c.w / 2;                    // the wide shelf's far edge
    const chain = onWall.filter(({ o, c }) => o !== wide.o && (along(o) - side * c.w / 2) * side >= edge * side - 0.5);
    if (chain.some(({ c }) => c.corner)) { reason = 'corner'; continue; }
    const code = sizedWidthCode(wide.c.baseCode || wide.c.code, w);
    const nx = horiz ? along(wide.o) - side * diff / 2 : wide.o.x, nz = horiz ? wide.o.z : along(wide.o) - side * diff / 2;
    const moves = chain.map(({ o }) => ({ id: o.id, x: horiz ? o.x - side * diff : o.x, z: horiz ? o.z : o.z - side * diff }));
    pairs.push({ hoodId: h.id, keepId: narrow.o.id, cutId: wide.o.id, code, w, x: nx, z: nz, moves });
    void dir;
  }
  return pairs.length ? { ok: true, pairs } : { ok: false, reason };
}
