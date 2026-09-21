// islandback.js — PURE. "Make this island double sided" in one press (her ask 2026-09-21).
// It used to mean dragging a second row behind the first, cabinet by cabinet. planIslandBack()
// works out a storage row for the BACK of the island row the selected cabinet belongs to:
// same length, facing the other way, backs touching (hard rule 10: the back row is storage).
//
//   planIslandBack(state, id) -> { ok:true, placements:[{code,x,z,rotDeg,island:true}], row:[ids], note }
//                              | { ok:false, reason }     reasons: 'not island' | 'already double' | 'no fit' | 'no room'
//
// Each front cabinet gets a door cabinet of its own width behind it (20/24/28 single, 36/42
// double) so the joints line up through the island. A width with no door cabinet (a 30" or
// 48" range, a 26" bin) is packed exactly from door cabinets; if that cannot be done exactly
// the whole row is packed instead; if even that cannot be exact it is refused: an island whose
// two sides are different lengths is not a finished island.

import { getCab } from './catalogue.js';
import { boxAt, spotOk } from './placement.js';

const DOOR_BY_W = { 20: 'F1', 24: 'F2', 28: 'F3', 36: 'F10', 42: 'F11' };
const WIDTHS = [42, 36, 28, 24, 20];
const floorLine = (c) => c && c.placeable && (c.type === 'FLOOR' || (c.type === 'APPLIANCES' && (c.mountY || 0) === 0 && !['sink', 'hob', 'oven'].includes(c.appliance)));

function packExact(width) {                       // fewest door cabinets that make `width` exactly (to 0.1")
  const cap = Math.round(width * 10), best = new Map([[0, []]]);
  // fewest pieces, and among those the most EVEN widths (48" is 24 + 24, never 20 + 28)
  const spread = (codes) => { const ws = codes.map((c) => getCab(c).w); return Math.max(...ws) - Math.min(...ws); };
  for (let s = 0; s <= cap; s++) { const cur = best.get(s); if (!cur) continue; for (const w of WIDTHS) { const n = s + w * 10; if (n > cap) continue; const cand = [...cur, DOOR_BY_W[w]], old = best.get(n);
    if (!old || old.length > cand.length || (old.length === cand.length && spread(cand) < spread(old))) best.set(n, cand); } }
  const out = best.get(cap); return out ? [...out].sort((p, q) => getCab(q).w - getCab(p).w) : null;
}

export function planIslandBack(state, id) {
  const sel = (state.items || []).find((i) => i.id === id), selCab = sel && getCab(sel.code);
  const r = state.room || {}, W = r.width || 144, D = r.depth || 120, b = { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 };
  if (!sel || !floorLine(selCab)) return { ok: false, reason: 'not island' };
  const nearWall = (it, c) => { const bx = boxAt(c, it.x, it.z, it.rotDeg); return Math.min(bx.x0 - b.minX, b.maxX - bx.x1, bx.z0 - b.minZ, b.maxZ - bx.z1) < 6; };
  if (!sel.island && nearWall(sel, selCab)) return { ok: false, reason: 'not island' };

  const rot = (((sel.rotDeg || 0) % 360) + 360) % 360, rad = (rot * Math.PI) / 180;
  const f = { x: Math.sin(rad), z: Math.cos(rad) }, a = { x: Math.cos(rad), z: -Math.sin(rad) };      // front normal, along-row axis
  const perp = (it) => it.x * f.x + it.z * f.z, along = (it) => it.x * a.x + it.z * a.z;
  const cands = (state.items || []).map((it) => ({ it, cab: getCab(it.code) })).filter((x) => floorLine(x.cab) && !x.cab.corner && ((((x.it.rotDeg || 0) % 360) + 360) % 360) === rot
    && Math.abs(perp(x.it) - perp(sel)) < 3 && (x.it.island || !nearWall(x.it, x.cab))).sort((p, q) => along(p.it) - along(q.it));
  // the contiguous chain that contains the selected cabinet
  let i0 = cands.findIndex((x) => x.it.id === id), i1 = i0;
  const gap = (p, q) => (along(q.it) - q.cab.w / 2) - (along(p.it) + p.cab.w / 2);
  while (i0 > 0 && Math.abs(gap(cands[i0 - 1], cands[i0])) < 1) i0--;
  while (i1 < cands.length - 1 && Math.abs(gap(cands[i1], cands[i1 + 1])) < 1) i1++;
  const row = cands.slice(i0, i1 + 1);

  // already double? something faces the other way with its back on this row's back
  const backPlane = Math.min(...row.map((x) => perp(x.it) - x.cab.d / 2));
  const rowLo = along(row[0].it) - row[0].cab.w / 2, rowHi = along(row[row.length - 1].it) + row[row.length - 1].cab.w / 2;
  const behind = (state.items || []).some((it) => { const c = getCab(it.code); if (!floorLine(c) || ((((it.rotDeg || 0) % 360) + 360) % 360) !== (rot + 180) % 360) return false;
    const p = it.x * f.x + it.z * f.z, al = it.x * a.x + it.z * a.z; return Math.abs((p + c.d / 2) - backPlane) < 3 && al > rowLo - 1 && al < rowHi + 1; });
  if (behind) return { ok: false, reason: 'already double' };

  // what stands behind each front cabinet
  let codes = [], exactPerItem = true;
  const pieces = [];                               // [{ lo, codes }]
  for (let i = 0; i < row.length; i++) {
    const w = row[i].cab.w, lo = along(row[i].it) - w / 2;
    if (DOOR_BY_W[w]) { pieces.push({ lo, codes: [DOOR_BY_W[w]] }); continue; }
    const p = packExact(w); if (!p) { exactPerItem = false; break; }
    pieces.push({ lo, codes: p });
  }
  if (!exactPerItem) { const p = packExact(rowHi - rowLo); if (!p) return { ok: false, reason: 'no fit' }; pieces.length = 0; pieces.push({ lo: rowLo, codes: p }); }

  const placements = [];
  for (const pc of pieces) { let cur = pc.lo; for (const code of pc.codes) { const c = getCab(code), al = cur + c.w / 2, pp = backPlane - c.d / 2; cur += c.w;
    placements.push({ code, x: al * a.x + pp * f.x, z: al * a.z + pp * f.z, rotDeg: (rot + 180) % 360, island: true }); } }
  let virt = { ...state, items: [...state.items] };
  for (const [i, p] of placements.entries()) { if (!spotOk(virt, getCab(p.code), p.x, p.z, p.rotDeg, b)) return { ok: false, reason: 'no room' }; virt = { ...virt, items: [...virt.items, { id: `b${i}`, ...p }] }; }
  // how much walkway is left behind the new row (hard rule 10 wants 44")
  const newFront = backPlane - Math.max(...placements.map((p) => getCab(p.code).d));
  const wallDist = (f.z !== 0 ? (f.z > 0 ? newFront - b.minZ : b.maxZ + newFront) : (f.x > 0 ? newFront - b.minX : b.maxX + newFront));
  return { ok: true, placements, row: row.map((x) => x.it.id), walkway: wallDist, note: wallDist < 44 ? 'walkway' : null };
}
