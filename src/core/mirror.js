// mirror.js — PURE. "Two wall cabinets, equally spaced from a point: the range, or the middle
// of the wall" (her ask 2026-09-21). The SELECTED upper stays where she put it; its partner on
// the other side of the point moves to the mirror-image spot. With no partner, the selected one
// is centred on the point instead.
//
//   mirrorTargets(state, id)          -> { wall, range: x|null, centre: x }    what it can be matched about
//   planMirror(state, id, 'range'|'wall') -> { ok:true, moves:[{id,x,z}], about, partner:code|null, dist }
//                                          | { ok:false, reason }   'not hung' | 'no range' | 'blocked' | 'already'

import { getCab } from './catalogue.js';
import { boxAt, spotOk } from './placement.js';
import { openingCenter, openingWidth } from './openings.js';

const ROT = { 0: 'back', 90: 'left', 270: 'right', 180: 'front' };
const hung = (c) => c && c.placeable && (c.type === 'WALL' || c.type === 'SHELF' || c.type === 'COUNTER') && !c.stacker;

function frame(state, it) {
  const r = state.room || {}, W = r.width || 144, D = r.depth || 120;
  const rot = (((it.rotDeg || 0) % 360) + 360) % 360, wall = ROT[rot];
  const horiz = wall === 'back' || wall === 'front';
  return { wall, horiz, b: { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 }, along: (i) => (horiz ? i.x : i.z), rot };
}

export function mirrorTargets(state, id) {
  const it = (state.items || []).find((i) => i.id === id), cab = it && getCab(it.code);
  if (!it || !hung(cab)) return null;
  const F = frame(state, it);
  const cook = (state.items || []).find((o) => { const c = getCab(o.code); return c && (c.appliance === 'range' || c.appliance === 'hob') && ((((o.rotDeg || 0) % 360) + 360) % 360) === F.rot; });
  return { wall: F.wall, range: cook ? F.along(cook) : null, centre: 0 };
}

export function planMirror(state, id, about = 'range') {
  const it = (state.items || []).find((i) => i.id === id), cab = it && getCab(it.code);
  if (!it || !hung(cab)) return { ok: false, reason: 'not hung' };
  const F = frame(state, it), t = mirrorTargets(state, id);
  const focus = about === 'range' ? t.range : t.centre;
  if (focus == null) return { ok: false, reason: 'no range' };
  const mine = F.along(it), side = Math.sign(mine - focus);
  const onWall = (o) => { const c = getCab(o.code); return o.id !== id && hung(c) && ((((o.rotDeg || 0) % 360) + 360) % 360) === F.rot && Math.abs((o.y || 0) - (it.y || 0)) < 1 && c.type === cab.type; };
  // the partner: the nearest hung cabinet of the same kind on the OTHER side of the point
  const partner = side === 0 ? null : (state.items || []).filter((o) => onWall(o) && Math.sign(F.along(o) - focus) === -side).sort((p, q) => Math.abs(F.along(p) - focus) - Math.abs(F.along(q) - focus))[0] || null;
  const set = (o, al) => (F.horiz ? { id: o.id, x: al, z: o.z } : { id: o.id, x: o.x, z: al });
  let moves, dist;
  if (partner) {
    const pc = getCab(partner.code);
    // mirror EDGES, not centres: the gap from the point to each cabinet's near edge is what the eye reads
    const myNear = Math.abs(mine - focus) - cab.w / 2;
    const target = focus - side * (myNear + pc.w / 2);
    if (Math.abs(target - F.along(partner)) < 0.05) return { ok: false, reason: 'already', partner: partner.code };
    moves = [set(partner, target)]; dist = myNear;
  } else {
    if (Math.abs(mine - focus) < 0.05) return { ok: false, reason: 'already', partner: null };
    moves = [set(it, focus)]; dist = 0;
  }
  // the moved cabinet must still hang somewhere legal: in the room, on nothing, not over glass
  for (const m of moves) {
    const o = state.items.find((i) => i.id === m.id), c = getCab(o.code);
    if (!spotOk(state, c, m.x, m.z, o.rotDeg, F.b, o.id)) return { ok: false, reason: 'blocked', partner: partner ? partner.code : null };
    const bx = boxAt(c, m.x, m.z, o.rotDeg), [a0, a1] = F.horiz ? [bx.x0, bx.x1] : [bx.z0, bx.z1];
    for (const op of (state.room?.openings || [])) { if ((op.wall || 'back') !== F.wall || op.type !== 'window') continue; const ctr = openingCenter(state.room, op), hw = openingWidth(op, state.room) / 2; if (a0 < ctr + hw - 0.5 && a1 > ctr - hw + 0.5) return { ok: false, reason: 'blocked', partner: partner ? partner.code : null }; }
  }
  return { ok: true, moves, about, partner: partner ? partner.code : null, dist };
}
