// roomresize.js — PURE. Changing the room size keeps the kitchen ON ITS WALLS.
//
// Positions are stored from the middle of the room, so a new width used to move BOTH side
// walls and leave every cabinet where it was: make the room 2" narrower and the tall at the
// end of a run was suddenly 1" through the wall; make it 4 ft wider and the whole run floated
// 2 ft off its corner (her screenshot 2026-09-21: "why is this cabinet hanging off the edge??").
//
// Now the room grows and shrinks at its RIGHT and FRONT: everything keeps its distance from
// the LEFT and BACK walls, except what stands on the right (or front) wall, which stays on it.
// Windows, doors and boxings keep their distance from the same corner too (they are stored as
// a fraction of the wall, so they used to drift off the sink).
//
//   planRoomResize(state, { width?, depth? }) -> { moves:[{id,x,z}], openings:[{id,pos}], boxings:[{id,pos}], outside:n }
// `outside` = cabinets that no longer fit inside the new room (the UI says so; nothing is deleted).

import { getCab } from './catalogue.js';
import { boxAt } from './placement.js';

const NEAR = 14;

export function planRoomResize(state, patch = {}) {
  const r = state.room || {}, W0 = r.width || 144, D0 = r.depth || 120;
  const W1 = patch.width ?? W0, D1 = patch.depth ?? D0, dW = W1 - W0, dD = D1 - D0;
  const out = { moves: [], openings: [], boxings: [], outside: 0 };
  if (!dW && !dD) return out;
  const rot = (it) => (((it.rotDeg || 0) % 360) + 360) % 360;
  for (const it of state.items || []) {
    const cab = getCab(it.code); if (!cab) continue;
    const b = boxAt(cab, it.x, it.z, it.rotDeg);
    const onRight = !it.island && rot(it) === 270 && W0 / 2 - b.x1 < NEAR;
    const onFront = !it.island && rot(it) === 180 && D0 / 2 - b.z1 < NEAR;
    const x = it.x + (onRight ? dW / 2 : -dW / 2), z = it.z + (onFront ? dD / 2 : -dD / 2);
    if (x !== it.x || z !== it.z) out.moves.push({ id: it.id, x, z });
    const n = boxAt(cab, x, z, it.rotDeg);
    if (cab.placeable && (n.x0 < -W1 / 2 - 0.3 || n.x1 > W1 / 2 + 0.3 || n.z0 < -D1 / 2 - 0.3 || n.z1 > D1 / 2 + 0.3)) out.outside++;
  }
  // an opening keeps its distance from the left / back corner of its wall
  const keep = (list, into) => { for (const o of list || []) {
    const side = o.wall === 'left' || o.wall === 'right', [l0, l1] = side ? [D0, D1] : [W0, W1];
    if (l0 === l1) continue;
    into.push({ id: o.id, pos: Math.max(0, Math.min(1, ((o.pos ?? 0.5) * l0) / l1)) });
  } };
  keep(r.openings, out.openings); keep(r.boxings, out.boxings);
  return out;
}
