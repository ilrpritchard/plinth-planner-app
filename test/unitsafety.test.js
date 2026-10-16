// A kitchen type's layout is never lost to another drawing (2026-10-16: her 1 Bed was replaced
// by a different kitchen after a reload recovered an unfinished design session).
import { foldRecoveredDesign, keepEarlier, sameRoom, EARLIER_MAX } from '../src/core/unitsafety.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };
const rowsOf = (d) => d.items.map((i) => ({ code: i.code, qty: 1 }));
const room = (w, d) => ({ width: w, depth: d, height: 110 });
const oneBed = () => ({ room: room(168, 120), items: [{ id: 1, code: 'F17', x: -74, z: -48, rotDeg: 0 }] });
const project = () => ({ nextUnitId: 5, nextRowId: 400, units: [{ id: 2, beds: '1 Bed', letter: 'A', qty: 22, rows: [{ id: 1, code: 'F17', qty: 1 }], design: oneBed() }] });

{ // a DIFFERENT room on screen → its own kitchen type; the 1 Bed is untouched
  const t = project();
  const other = { mode: 'home', room: room(144, 218), items: [{ id: 1, code: 'F10', x: 0, z: 0 }], trade: { units: [] } };
  const r = foldRecoveredDesign(t, 2, other, rowsOf);
  ok('different room is added', r.action === 'added');
  ok('1 Bed keeps its layout', t.units[0].design.items[0].code === 'F17' && t.units[0].design.room.width === 168);
  ok('new type holds the drawing', t.units.length === 2 && t.units[1].design.room.depth === 218 && t.units[1].rows[0].code === 'F10');
  ok('new type has a fresh id', t.units[1].id === 5 && t.nextUnitId === 6);
  ok('designs never nest trade', !('trade' in t.units[1].design));
}
{ // the SAME room → the unit's own work: folded in, the layout before kept
  const t = project();
  const same = { mode: 'home', room: room(168, 120), items: [{ id: 1, code: 'F17', x: -74, z: -48 }, { id: 2, code: 'F21', x: -4, z: -48 }] };
  const r = foldRecoveredDesign(t, 2, same, rowsOf);
  ok('same room folds', r.action === 'folded' && t.units.length === 1);
  ok('fold updates the unit', t.units[0].design.items.length === 2);
  ok('fold keeps the earlier layout', t.units[0].earlier.length === 1 && t.units[0].earlier[0].design.items.length === 1);
}
{ // an empty screen changes nothing
  const t = project();
  ok('empty screen is none', foldRecoveredDesign(t, 2, { room: room(10, 10), items: [] }, rowsOf).action === 'none');
}
{ // keepEarlier: newest first, capped, no duplicates of an unchanged layout
  const u = project().units[0];
  ok('unchanged layout is not kept', keepEarlier(u, oneBed()) === false);
  for (let i = 0; i < EARLIER_MAX + 3; i++) {
    keepEarlier(u, { room: room(168, 120), items: [{ code: 'F' + i, x: i, z: 0 }] });
    u.design = { room: room(168, 120), items: [{ code: 'F' + i, x: i, z: 0 }] };
  }
  ok('capped at EARLIER_MAX', u.earlier.length === EARLIER_MAX);
  ok('newest first', u.earlier[0].design.items[0].code === 'F' + (EARLIER_MAX + 1));
  ok('sameRoom rounds to the inch', sameRoom({ room: room(168.2, 120) }, { room: room(168, 120) }));
}

console.log(`unitsafety: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
