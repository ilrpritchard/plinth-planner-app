// backpanels.js — the finished END PANEL across an exposed back, as one piece (W2W-243, pure).
//
// Her ask 2026-09-29, peninsula kitchens: "add a way that I can make the back of the cabinets with an end
// panel". Her call: automatic, ONE continuous painted panel across the run, no joints showing. Every
// floor cabinet whose back is exposed (endpanels.js exposedBackIds: islands and peninsulas alike) and
// the end of a corner unit's return that runs to a peninsula's back (cornerreturn.js returnReach) are
// gathered by the plane they face; touching pieces on one plane merge into a single 22mm panel from the
// floor to the worktop. The pricing stays in endpanels.js (one end panel per exposed back, plus the
// peninsula corner's return end).

import { getCab } from './catalogue.js';
import { exposedBackIds } from './endpanels.js';
import { peninsulaReturnEnds } from './cornerreturn.js';

export const BACK_PANEL_T = 22 / 25.4;          // 22mm, as the legs
const JOIN = 1.5;                               // pieces this close along the plane read as one panel

/** -> [{ x, z, rotY, len, h, t, finish }] one entry per continuous panel (x, z = its centre on the floor). */
export function computeBackPanels(state) {
  const pieces = [];
  const exposed = exposedBackIds(state);
  for (const it of state.items || []) {
    if (!exposed.has(it.id)) continue;
    const cab = getCab(it.code);
    if (!cab) continue;
    const r = ((it.rotDeg || 0) * Math.PI) / 180;
    const nx = -Math.sin(r), nz = -Math.cos(r);             // back normal
    pieces.push(piece(nx, nz, it.x + nx * cab.d / 2, it.z + nz * cab.d / 2, cab.w, cab.h, it.finish || state.finish));
  }
  for (const { it, cab, len } of peninsulaReturnEnds(state)) {
    const dir = cab.cornerSide === 'right' ? 1 : -1;
    const r = ((it.rotDeg || 0) * Math.PI) / 180;
    const ux = dir * Math.cos(r), uz = -dir * Math.sin(r);  // the return runs this way; its end faces it
    const ex = it.x + ux * (cab.w / 2 + len), ez = it.z + uz * (cab.w / 2 + len);
    pieces.push(piece(ux, uz, ex, ez, cab.d, cab.h, it.finish || state.finish));
  }
  // merge by plane: same normal, same offset, touching along it
  const groups = new Map();
  for (const p of pieces) {
    const k = `${Math.round(p.nx)},${Math.round(p.nz)},${Math.round(p.off * 4) / 4},${p.finish}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(p);
  }
  const out = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.s0 - b.s0);
    let cur = null;
    for (const p of list) {
      if (cur && p.s0 <= cur.s1 + JOIN) { cur.s1 = Math.max(cur.s1, p.s1); cur.h = Math.max(cur.h, p.h); continue; }
      if (cur) out.push(panel(cur));
      cur = { ...p };
    }
    if (cur) out.push(panel(cur));
  }
  return out;
}

function piece(nx, nz, px, pz, w, h, finish) {
  const ux = -nz, uz = nx;                                   // along the plane
  const s = px * ux + pz * uz;
  return { nx, nz, ux, uz, off: px * nx + pz * nz, s0: s - w / 2, s1: s + w / 2, h, finish };
}

function panel(p) {
  const s = (p.s0 + p.s1) / 2, t = BACK_PANEL_T;
  return {
    x: p.nx * (p.off + t / 2) + p.ux * s,
    z: p.nz * (p.off + t / 2) + p.uz * s,
    rotY: Math.atan2(-p.uz, p.ux),
    len: p.s1 - p.s0, h: p.h, t, finish: p.finish,
  };
}
