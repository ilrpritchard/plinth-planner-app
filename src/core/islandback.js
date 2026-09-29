// islandback.js — PURE. "Make this island double sided" in one press (her ask 2026-09-21).
// It used to mean dragging a second row behind the first, cabinet by cabinet. planIslandBack()
// works out a storage row for the BACK of the island row the selected cabinet belongs to:
// same length, facing the other way, backs touching (hard rule 10: the back row is storage).
//
//   planIslandBack(state, id, { niches | halfDepth }) -> { ok:true, placements:[{code,x,z,rotDeg,island:true}], row:[ids], note }
//                              | { ok:false, reason }     reasons: 'not island' | 'already double' | 'no fit' | 'no room'
//
// Each front cabinet gets a door cabinet of its own width behind it (20/24/28 single, 36/42
// double) so the joints line up through the island. A width with no door cabinet (a 30" or
// 48" range, a 26" bin) is packed exactly from door cabinets; if that cannot be done exactly
// the whole row is packed instead; if even that cannot be exact it is refused: an island whose
// two sides are different lengths is not a finished island.

import { getCab, sizedNicheCode } from './catalogue.js';
import { boxAt, spotOk } from './placement.js';
import { returnReach } from './cornerreturn.js';

const DOOR_BY_W = { 20: 'F1', 24: 'F2', 28: 'F3', 36: 'F10', 42: 'F11' };
// STOOL NICHES (opts.niches): ONE open 300mm bay the length of the row instead of storage
// HALF DEPTH (her ask 2026-09-29, "make double sided but half depth"): the 14" door cabinets, singles
// to 28" (F4 / F5 / F6) and doubles above (F13 / F14), so a shallow island still gets its storage
const HALF_BY_W = { 20: 'F4', 24: 'F5', 28: 'F6', 36: 'F13', 42: 'F14' };
const WIDTHS = [42, 36, 28, 24, 20];
const floorLine = (c) => c && c.placeable && (c.type === 'FLOOR' || (c.type === 'APPLIANCES' && (c.mountY || 0) === 0 && !['sink', 'hob', 'oven'].includes(c.appliance)));

function packExact(width, BY = DOOR_BY_W) {        // fewest door cabinets (or niches) that make `width` exactly (to 0.1")
  const cap = Math.round(width * 10), best = new Map([[0, []]]);
  // fewest pieces, and among those the most EVEN widths (48" is 24 + 24, never 20 + 28)
  const spread = (codes) => { const ws = codes.map((c) => getCab(c).w); return Math.max(...ws) - Math.min(...ws); };
  for (let s = 0; s <= cap; s++) { const cur = best.get(s); if (!cur) continue; for (const w of WIDTHS) { const n = s + w * 10; if (n > cap) continue; const cand = [...cur, BY[w]], old = best.get(n);
    if (!old || old.length > cand.length || (old.length === cand.length && spread(cand) < spread(old))) best.set(n, cand); } }
  const out = best.get(cap); return out ? [...out].sort((p, q) => getCab(q).w - getCab(p).w) : null;
}

export function planIslandBack(state, id, opts = {}) {
  const BY = opts.halfDepth ? HALF_BY_W : DOOR_BY_W;
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
  // stool niches: ONE bay the whole length of the row, legs at its two ends only (her ask
  // 2026-09-29, "whatever length the island is, the stool niche stretches")
  // "THE WHOLE LENGTH" (her screenshot the same day: the niche stopped where the row's own cabinets
  // did, and the corner unit + the corner square beyond it stood bare): the niche runs on over everything
  // whose back lies on the same line (a corner unit and its drawn return, the side of the run it meets),
  // and to the wall when that leaves less than 6". Something standing proud of the line stops it.
  let nLo = rowLo, nHi = rowHi;
  if (opts.niches) {
    const flush = [], proud = [];
    for (const it of state.items || []) {
      const c = getCab(it.code);
      if (!c || !c.placeable || row.some((x) => x.it.id === it.id) || c.form === 'niche') continue;
      if (!(c.type === 'FLOOR' || c.type === 'TALL' || (c.type === 'APPLIANCES' && (c.mountY || 0) === 0 && !['sink', 'hob', 'oven'].includes(c.appliance)))) continue;
      // the drawn footprint (a corner's return as far as it really reaches), in (along, perp)
      const ret = c.corner ? returnReach(c, it, state.items, r).len : 0;
      const l = c.w / 2 + (c.corner && c.cornerSide !== 'right' ? ret : 0), rr = c.w / 2 + (c.corner && c.cornerSide === 'right' ? ret : 0);
      const rd = ((it.rotDeg || 0) * Math.PI) / 180, cs = Math.cos(rd), sn = Math.sin(rd);
      let a0 = Infinity, a1 = -Infinity, p0 = Infinity, p1 = -Infinity;
      for (const [lx, lz] of [[-l, -c.d / 2], [rr, -c.d / 2], [rr, c.d / 2], [-l, c.d / 2]]) {
        const wx = it.x + lx * cs + lz * sn, wz = it.z - lx * sn + lz * cs;
        const al = wx * a.x + wz * a.z, pp = wx * f.x + wz * f.z;
        a0 = Math.min(a0, al); a1 = Math.max(a1, al); p0 = Math.min(p0, pp); p1 = Math.max(p1, pp);
      }
      if (p1 <= backPlane + 0.5) continue;                       // wholly behind the line: not part of this back
      (Math.abs(p0 - backPlane) < 1.5 ? flush : p0 < backPlane - 1.5 ? proud : []).push([a0, a1]);
    }
    for (let grew = true; grew;) {
      grew = false;
      for (const [a0, a1] of flush) {
        if (a0 < nLo - 0.05 && a1 > nLo - 1.5) { nLo = a0; grew = true; }
        if (a1 > nHi + 0.05 && a0 < nHi + 1.5) { nHi = a1; grew = true; }
      }
    }
    const ends = [b.minX * a.x + b.minZ * a.z, b.maxX * a.x + b.maxZ * a.z], wLo = Math.min(...ends), wHi = Math.max(...ends);
    if (nLo - wLo < 6 && !proud.some(([, a1]) => a1 > wLo && a1 <= nLo + 0.05)) nLo = wLo;
    if (wHi - nHi < 6 && !proud.some(([a0]) => a0 < wHi && a0 >= nHi - 0.05)) nHi = wHi;
    pieces.push({ lo: nLo, codes: [sizedNicheCode(nHi - nLo)] });
  }
  else for (let i = 0; i < row.length; i++) {
    const w = row[i].cab.w, lo = along(row[i].it) - w / 2;
    if (BY[w]) { pieces.push({ lo, codes: [BY[w]] }); continue; }
    const p = packExact(w, BY); if (!p) { exactPerItem = false; break; }
    pieces.push({ lo, codes: p });
  }
  if (!opts.niches && !exactPerItem) { const p = packExact(rowHi - rowLo, BY); if (!p) return { ok: false, reason: 'no fit' }; pieces.length = 0; pieces.push({ lo: rowLo, codes: p }); }

  const placements = [];
  for (const pc of pieces) { let cur = pc.lo; for (const code of pc.codes) { const c = getCab(code), al = cur + c.w / 2, pp = backPlane - c.d / 2; cur += c.w;
    placements.push({ code, x: al * a.x + pp * f.x, z: al * a.z + pp * f.z, rotDeg: (rot + 180) % 360, island: true }); } }
  const fits = (pl) => { let virt = { ...state, items: [...state.items] };
    for (const [i, p] of pl.entries()) { if (!spotOk(virt, getCab(p.code), p.x, p.z, p.rotDeg, b)) return false; virt = { ...virt, items: [...virt.items, { id: `b${i}`, ...p }] }; }
    return true; };
  if (!fits(placements)) {
    // a niche that could not run the whole way (something in the way beyond the row): the row's own length
    if (!opts.niches || (nLo === rowLo && nHi === rowHi)) return { ok: false, reason: 'no room' };
    const c = getCab(sizedNicheCode(rowHi - rowLo)), al = rowLo + c.w / 2, pp = backPlane - c.d / 2;
    placements.length = 0; placements.push({ code: c.code, x: al * a.x + pp * f.x, z: al * a.z + pp * f.z, rotDeg: (rot + 180) % 360, island: true });
    if (!fits(placements)) return { ok: false, reason: 'no room' };
  }
  // how much walkway is left behind the new row (hard rule 10 wants 44")
  const newFront = backPlane - Math.max(...placements.map((p) => getCab(p.code).d));
  // (|f.z| > 0.5, never f.z !== 0: cos 90 deg is 6e-17, so a row facing sideways measured to the wrong wall)
  const wallDist = (Math.abs(f.z) > 0.5 ? (f.z > 0 ? newFront - b.minZ : b.maxZ + newFront) : (f.x > 0 ? newFront - b.minX : b.maxX + newFront));
  return { ok: true, placements, row: row.map((x) => x.it.id), walkway: wallDist, note: wallDist < 44 ? 'walkway' : null };
}
