// history.test.js — undo/redo semantics + the live drag-dimension maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { measureRun } from '../src/core/measure.js';
import { swapAlternatives, getCab } from '../src/core/catalogue.js';
import { snapPosition } from '../src/interaction/snapping.js';

test('undo/redo a single add', () => {
  const s = new Store();
  s.addItem('F2', { x: 0, z: 0 });
  assert.equal(s.state.items.length, 1);
  assert.ok(s.canUndo);
  s.undo();
  assert.equal(s.state.items.length, 0);
  assert.ok(s.canRedo);
  s.redo();
  assert.equal(s.state.items.length, 1);
  assert.equal(s.state.items[0].code, 'F2');
});

test('a batched drag (many quiet moves) is ONE undo step', () => {
  const s = new Store();
  const it = s.addItem('F2', { x: 0, z: 0 });
  s.beginHistory();
  for (let i = 1; i <= 30; i++) s.updateItem(it.id, { x: i }, { quiet: true });
  s.updateItem(it.id, {}, { quiet: false });   // the commit at pointer-up
  s.endHistory();
  assert.equal(s.getItem(it.id).x, 30);
  s.undo();                                    // ONE undo returns to the pre-drag spot
  assert.equal(s.getItem(it.id).x, 0);
  assert.equal(s.state.items.length, 1);       // …not to before the add
  s.undo();
  assert.equal(s.state.items.length, 0);
});

test('a no-op batch records nothing', () => {
  const s = new Store();
  s.beginHistory(); s.endHistory();
  assert.equal(s.canUndo, false);
});

test('new edits clear the redo stack; room/finish changes are undoable', () => {
  const s = new Store();
  s.setFinish('Kale');
  s.setRoom({ width: 200 });
  s.undo();
  assert.equal(s.state.room.width, 144);
  assert.ok(s.canRedo);
  s.addItem('F1', {});                          // a fresh edit forks history
  assert.equal(s.canRedo, false);
  s.undo(); s.undo();
  assert.equal(s.state.finish, 'Ghost');
});

test('quiet updates alone never pollute history', () => {
  const s = new Store();
  const it = s.addItem('F2', {});
  const before = s._hist.length;
  s.updateItem(it.id, { x: 5 }, { quiet: true });
  assert.equal(s._hist.length, before);
});

test('history is capped', () => {
  const s = new Store();
  for (let i = 0; i < 100; i++) s.addItem('F1', { x: i });
  assert.ok(s._hist.length <= 60);
});

test('measureRun: width + gaps to neighbour and walls', () => {
  const s = new Store();
  s.setRoom({ width: 144, depth: 120, height: 96 });
  const bounds = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
  // A at the left wall, B 10" to its right, both on the back wall
  s.addItem('F2', { x: -60, z: -48 });                    // A: spans -72..-48
  const b = s.addItem('F2', { x: -26, z: -48 });          // B: spans -38..-14
  const m = measureRun(s, b.id, bounds);
  assert.equal(m.w, 24);
  assert.equal(Math.round(m.before.gap), 10);             // to A
  assert.equal(m.before.to, 'F2');
  assert.equal(Math.round(m.after.gap), 86);              // to the right wall
  assert.equal(m.after.to, 'wall');
});

test('measureRun: flush butting reads as 0; different height bands ignored', () => {
  const s = new Store();
  s.setRoom({ width: 144, depth: 120, height: 96 });
  const bounds = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
  s.addItem('F2', { x: -60, z: -48 });                    // base
  s.addItem('W2', { x: -36, z: -53 });                    // WALL cabinet above — other band
  const c = s.addItem('F2', { x: -36, z: -48 });          // butted to the first base
  const m = measureRun(s, c.id, bounds);
  assert.equal(m.before.gap, 0);                          // flush to the base, wall cab ignored
  assert.equal(m.before.to, 'F2');
});

test('swapItem: in-place code change, undoable, same position', () => {
  const s = new Store();
  const it = s.addItem('F18', { x: 10, z: -48, rotDeg: 0 });
  s.swapItem(it.id, 'F24');                               // drawers → open shelves (same 24")
  assert.equal(s.getItem(it.id).code, 'F24');
  assert.equal(s.getItem(it.id).x, 10);
  s.undo();
  assert.equal(s.getItem(it.id).code, 'F18');
});

test('swapAlternatives: same width/type/depth family only', () => {
  const alts = swapAlternatives('F18').map((c) => c.code);
  assert.ok(alts.includes('F2'));                          // 24" single door
  assert.ok(alts.includes('F24'));                         // 24" open shelves
  assert.ok(alts.includes('F7'));                          // 24" dishwasher
  assert.ok(!alts.includes('F18'));                        // not itself
  assert.ok(!alts.includes('F17'));                        // 20" ≠ 24"
  assert.ok(!alts.includes('F5'));                         // half-depth excluded
  assert.ok(!alts.includes('W2'));                         // wall ≠ floor
  for (const a of swapAlternatives('F16')) assert.ok(a.corner); // corners swap to corners
  assert.equal(swapAlternatives('AP2').length, 0);         // appliances don't swap
});

test('drag can NEVER leave two cabinets overlapping (hard rule)', () => {
  const s = new Store();
  s.setRoom({ width: 144, depth: 120, height: 96 });
  const bounds = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
  const a = s.addItem('F2', { x: 0, z: -47.75, rotDeg: 0 });        // parked on the back wall
  const b = s.addItem('F2', { x: 40, z: -47.75, rotDeg: 0 });
  // try to drop B straight ON TOP of A → it must butt beside it instead
  const r1 = snapPosition(s, b.id, 0, -47.75, bounds);
  const gap = Math.abs(r1.x - a.x);
  assert.ok(gap >= 24 - 0.01, `B landed ${gap.toFixed(1)}" from A — overlapping`);
  // box A in completely; B (from far away) must refuse the impossible spot
  s.addItem('F2', { x: -24, z: -47.75 });
  s.addItem('F2', { x: 24, z: -47.75 });
  s.updateItem(b.id, { x: 60, z: 0 });
  const r2 = snapPosition(s, b.id, 0, -47.75, bounds);
  const overlapsAny = s.state.items.some((o) => o.id !== b.id &&
    Math.abs(r2.x - o.x) < 24 - 0.5 && Math.abs(r2.z - o.z) < 24 - 0.5);
  assert.ok(!overlapsAny, 'squeezed drop still overlapped something');
});

test('drag rule: cabinets NEVER cover a window (blocked + flagged); bases pass under the sill', () => {
  const s = new Store();
  s.setRoom({ width: 144, depth: 120, height: 96 });
  s.state.room.openings = [{ id: 1, type: 'window', wall: 'back', pos: 0.5, width: 48 }];
  const bounds = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
  // wall cabinet dragged onto the glass → flagged, parked beside the window
  const w = s.addItem('W2', { x: 50, z: -52.75 });
  const r = snapPosition(s, w.id, 0, -53, bounds);
  assert.equal(r.flag, 'window');
  assert.ok(Math.abs(r.x) >= 36 - 0.6, `wall cabinet at x=${r.x.toFixed(1)} sits over the window`);
  // tall cabinet: same rule
  const t = s.addItem('T1', { x: -60, z: -47.5 });
  const rt = snapPosition(s, t.id, 0, -48, bounds);
  assert.equal(rt.flag, 'window');
  assert.ok(Math.abs(rt.x) >= 36 - 0.6, 'tall parked over the window');
  // a BASE unit slides under the sill freely (that's where the sink goes)
  const b = s.addItem('F2', { x: 40, z: -47.75 });
  const rb = snapPosition(s, b.id, 0, -47.75, bounds);
  assert.equal(rb.flag, undefined);
  assert.ok(Math.abs(rb.x) < 5, 'base unit was wrongly pushed off the window');
});

test('hinge flip: undoable, mirrors the 3D door pivot and the plan swing', async () => {
  const s = new Store();
  const it = s.addItem('F2', { x: 0, z: -48 });          // single-door base, default LEFT hinge
  s.flipHinge(it.id);
  assert.equal(s.getItem(it.id).hinge, 'R');
  s.flipHinge(it.id);
  assert.equal(s.getItem(it.id).hinge, 'L');
  s.undo();
  assert.equal(s.getItem(it.id).hinge, 'R');
  // 3D: the door pivot sits on the hinge side — x flips sign L → R
  const { buildCabinet } = await import('../src/models/cabinet.js');
  const px = (h) => buildCabinet(getCab('F2'), '#eee', { hinge: h }).userData.doors[0].position.x;
  assert.ok(px('L') < 0 && px('R') > 0, `pivots L=${px('L')} R=${px('R')}`);
  assert.ok(Math.abs(px('L') + px('R')) < 0.01, 'pivots are not mirrored');
  // plan: the swing arc hinge follows it.hinge (formDoors path exercised via floorplan)
  const { buildFloorplanSVG } = await import('../src/ui/floorplan.js');
  s.setRoom({ width: 144, depth: 120, height: 96 });
  const svgL = buildFloorplanSVG({ ...s.serialize(), items: [{ id: 1, code: 'F2', x: 0, z: -48, rotDeg: 0, hinge: 'L' }] });
  const svgR = buildFloorplanSVG({ ...s.serialize(), items: [{ id: 1, code: 'F2', x: 0, z: -48, rotDeg: 0, hinge: 'R' }] });
  assert.notEqual(svgL, svgR, 'plan door swing did not change with the hinge');
});

test('placement rules: uprights stick to walls; sink keeps clear of talls', () => {
  const s = new Store();
  s.setRoom({ width: 144, depth: 120, height: 96 });
  const bounds = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
  // a wall cabinet HANGS — dragged mid-room it attaches to the NEAREST wall
  // (never floats, never sticks to the old wall while you fight it across)
  const w = s.addItem('W2', { x: 0, z: -52.75 });
  const r1 = snapPosition(s, w.id, 0, 10, bounds);
  assert.equal(r1.flag, undefined);
  assert.equal(r1.rotDeg, 180, 'mid-room drag hops to the closest (front) wall');
  assert.ok(Math.abs(r1.z - (60 - 7.25)) < 0.01, 'hung on the front wall');
  // …but dragging to ANOTHER wall auto-orients and is allowed
  const r2 = snapPosition(s, w.id, -70, 0, bounds);
  assert.equal(r2.rotDeg, 90);
  assert.equal(r2.flag, undefined);
  // the sink refuses to butt against a tall
  s.addItem('T1', { x: -60, z: -47.5 });
  const sk = s.addItem('AP6', { x: 20, z: -49.75 });
  const r3 = snapPosition(s, sk.id, -47, -49.75, bounds);   // shoved against the tall's flank
  assert.equal(r3.flag, 'sink');
  assert.ok(r3.x > -40, 'sink parked touching the tall');
});

test('measureRun: side-facing (rot 90) measures along Z', () => {
  const s = new Store();
  s.setRoom({ width: 144, depth: 120, height: 96 });
  const bounds = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
  const a = s.addItem('F2', { x: -60, z: -20, rotDeg: 90 });  // spans z -32..-8
  const m = measureRun(s, a.id, bounds);
  assert.equal(Math.round(m.before.gap), 28);             // to the back wall
  assert.equal(Math.round(m.after.gap), 68);              // to the front wall
});
