// unitsafety.js — a kitchen type's layout is never lost to another drawing.
// Born from a real loss (2026-10-16): the 1 Bed of her test building was replaced by a
// different kitchen after a reload. On boot, an unfinished design session is "recovered" by
// writing whatever kitchen is on screen into the unit that was open, and the kitchen on
// screen was not that unit's (a 144 x 218 room landed on a 168 x 120 unit). Two rules now:
//   1. a recovered drawing goes into the unit only when it is the same room; any other
//      drawing becomes its own new kitchen type, so the unit keeps its layout;
//   2. every time a unit's layout is replaced, the one before is kept on the unit (u.earlier,
//      newest first, the last EARLIER_MAX), so a wrong replace can always be undone.
// Pure data; no DOM.

export const EARLIER_MAX = 5;

const itemsKey = (d) => JSON.stringify(((d && d.items) || []).map((i) => [i.code, Math.round(i.x || 0), Math.round(i.z || 0), i.rotDeg || 0]).sort());

/** Same room = same width, depth and height (to the inch). */
export function sameRoom(a, b) {
  const ra = a && a.room, rb = b && b.room;
  if (!ra || !rb) return false;
  return ['width', 'depth', 'height'].every((k) => Math.round(Number(ra[k]) || 0) === Math.round(Number(rb[k]) || 0));
}

/** Same layout = same room and the same cabinets in the same places. */
export function sameLayout(a, b) { return sameRoom(a, b) && itemsKey(a) === itemsKey(b); }

/** Keep the unit's current layout on u.earlier before it is replaced by `next`. */
export function keepEarlier(u, next, at = new Date().toISOString()) {
  if (!u || !u.design || !(u.design.items || []).length) return false;
  if (next && sameLayout(u.design, next)) return false;
  const kept = Array.isArray(u.earlier) ? u.earlier : [];
  if (kept[0] && sameLayout(kept[0].design, u.design)) return false;
  u.earlier = [{ at, design: JSON.parse(JSON.stringify(u.design)), rows: JSON.parse(JSON.stringify(u.rows || [])) }, ...kept].slice(0, EARLIER_MAX);
  return true;
}

/**
 * A design session died (reload, closed tab) with `cur` on screen and unit `unitId` open.
 * Same room as the unit's layout (or the unit has none) → it is that unit's work: fold it in,
 * keeping the layout before. A different room → it is some other drawing: it becomes a new
 * kitchen type and the unit is left as it was. `rowsOf(design)` derives the cabinet rows.
 * Returns { action: 'folded' | 'added' | 'none', unit }.
 */
export function foldRecoveredDesign(t, unitId, cur, rowsOf) {
  const u = (t.units || []).find((x) => x.id === unitId);
  if (!u || !cur || !Array.isArray(cur.items) || !cur.items.length) return { action: 'none', unit: u || null };
  const design = JSON.parse(JSON.stringify(cur)); design.mode = 'home'; delete design.trade;
  const rows = () => rowsOf(design).map((r) => ({ id: t.nextRowId++, code: r.code, qty: r.qty }));
  if (!u.design || !(u.design.items || []).length || sameRoom(u.design, design)) {
    keepEarlier(u, design);
    u.design = design; u.rows = rows();
    return { action: 'folded', unit: u };
  }
  if (!t.nextUnitId) t.nextUnitId = Math.max(0, ...(t.units || []).map((x) => x.id || 0)) + 1;
  const nu = { id: t.nextUnitId++, beds: u.beds, letter: '', name: 'Recovered layout', qty: 1, floorFrom: '', floorTo: '', perFloor: '', rows: rows(), design };
  t.units.push(nu);
  return { action: 'added', unit: nu };
}
