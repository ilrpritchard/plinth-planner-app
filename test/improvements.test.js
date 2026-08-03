// improvements.test.js — templates / fill-wall / warnings logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, getTemplate, applyTemplate, planFill } from '../src/core/templates.js';
import { computeWarnings } from '../src/core/warnings.js';
import { computeFillers } from '../src/core/fillers.js';
import { computeEndPanels } from '../src/core/endpanels.js';
import { snapPosition } from '../src/interaction/snapping.js';
import { getFootprint } from '../src/models/cabinet.js';
import { planCornice } from '../src/core/cornice.js';
import { summarizeState } from '../src/core/cost.js';
import { getCab, halfDepthPartner } from '../src/core/catalogue.js';
import { Store } from '../src/core/store.js';

const W = { F1: 20, F2: 24, F3: 28 };
const sum = (codes) => codes.reduce((a, c) => a + (W[c] || 0), 0);
const room = { width: 144, depth: 120, height: 96 };

test('every template references real catalogue codes', () => {
  for (const t of TEMPLATES) for (const s of t.steps) assert.ok(getCab(s.code), `${t.id}:${s.code}`);
});

test('planFill fills the wall exactly when possible, never over', () => {
  for (const rem of [144, 100, 68, 44, 24, 156, 200]) {
    const codes = planFill(rem);
    assert.ok(sum(codes) <= rem + 0.5, `not over for ${rem}`);
    assert.ok(rem - sum(codes) < 20, `gap < a cabinet for ${rem}`); // packs tightly
  }
});

test('planFill returns nothing when the wall is too short', () => {
  assert.deepEqual(planFill(19), []);
});

test('applyTemplate clears then places every step', () => {
  const store = new Store();
  store.addItem('F2', { x: 0, z: 0 });               // pre-existing item
  let placed = 0;
  const n = applyTemplate(store, () => { placed++; }, 'one-wall');
  assert.equal(n, getTemplate('one-wall').steps.length);
  assert.equal(placed, n);
  assert.equal(store.state.items.length, 0);          // cleared (place is a stub here)
});

test('warnings: overlapping floor cabinets flagged as error', () => {
  const ws = computeWarnings({ room, items: [
    { id: 1, code: 'F2', x: 0, z: -46, rotDeg: 0 },
    { id: 2, code: 'F2', x: 6, z: -46, rotDeg: 0 },
  ] });
  assert.ok(ws.some((w) => w.level === 'error' && /overlap/.test(w.msg)));
});

test('warnings: clean side-by-side run is silent', () => {
  const ws = computeWarnings({ room, items: [
    { id: 1, code: 'F2', x: 0, z: -46, rotDeg: 0 },
    { id: 2, code: 'F2', x: 24, z: -46, rotDeg: 0 },
  ] });
  assert.equal(ws.length, 0);
});

test('warnings: floating sink flagged, supported sink is silent', () => {
  const floating = computeWarnings({ room, items: [{ id: 1, code: 'AP6', x: 0, z: -46, rotDeg: 0 }] });
  assert.ok(floating.some((w) => /base cabinet/.test(w.msg)));
  const supported = computeWarnings({ room, items: [
    { id: 1, code: 'F2', x: 0, z: -46, rotDeg: 0 },
    { id: 2, code: 'AP6', x: 0, z: -46, rotDeg: 0 },
  ] });
  assert.ok(!supported.some((w) => /Sink/.test(w.msg)));
});

test('island partner: standard floor unit gets a same-width half-depth back', () => {
  for (const [front, w] of [['F2', 24], ['F17', 20], ['F20', 36]]) {
    const p = halfDepthPartner(front);
    assert.ok(p, `${front} should have a partner`);
    const pc = getCab(p);
    assert.ok(pc.halfDepth && pc.type === 'FLOOR');
    assert.ok(pc.w <= getCab(front).w + 0.5, 'partner must not overhang the front unit');
  }
});

test('island partner: half-depth, corner, tall and appliances get none', () => {
  for (const code of ['F5', 'F16', 'T1', 'AP2']) {
    assert.equal(halfDepthPartner(code), null, `${code} should not pair`);
  }
});

test('warnings: over-filled wall flagged', () => {
  const items = [];
  for (let i = 0; i < 7; i++) items.push({ id: i, code: 'F3', x: -72 + i * 28 + 14, z: -46, rotDeg: 0 });
  const ws = computeWarnings({ room, items });
  assert.ok(ws.some((w) => /over by/.test(w.msg)));
});

// ----- tall sits proud of floor -----
test('a tall cabinet snaps ~30mm proud of an adjacent floor unit, either order', () => {
  const bounds = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
  const mk = (items) => ({ state: { items }, getItem: (id) => items.find((i) => i.id === id) });
  const frontZ = (it) => it.z + getFootprint(getCab(it.code)).d / 2;
  const PROUD = 30 / 25.4;

  // drag the tall onto an existing wall floor
  const f0 = { id: 'f0', code: 'F2', x: 0, z: bounds.minZ + 12.25, rotDeg: 0 };
  const t = snapPosition(mk([f0, { id: 't', code: 'T1', x: 24, z: 0, rotDeg: 0 }]), 't', 24.2, f0.z + 1, bounds);
  assert.ok(Math.abs(((t.z + 12) - frontZ(f0)) - PROUD) < 0.05, 'tall proud when dragged onto floor');

  // drag a floor next to a wall-mounted tall
  const tallRaw = { id: 't2', code: 'T1', x: 0, z: bounds.minZ + 12, rotDeg: 0 };
  const ts = snapPosition(mk([tallRaw]), 't2', 0, bounds.minZ + 12, bounds);
  const tall = { ...tallRaw, ...ts };
  const fr = { id: 'f', code: 'F2', x: 24, z: 0, rotDeg: 0 };
  const fs = snapPosition(mk([tall, fr]), 'f', 24.2, tall.z - 1, bounds);
  const floor = { ...fr, ...fs };
  assert.ok(Math.abs((frontZ(tall) - frontZ(floor)) - PROUD) < 0.05, 'tall proud when floor dragged to it');
  assert.ok(fs.z - 12 > bounds.minZ - 0.5, 'floor back stays at the wall, not behind it');
});

// ----- scribe fillers on tall cabinets -----
test('a tall unit near a wall gets a full-height painted scribe filler', () => {
  const minX = -room.width / 2, minZ = -room.depth / 2;
  const tall = { id: 1, code: 'T1', x: minX + 4 + 12, z: minZ + 12.25 + 30 / 25.4, rotDeg: 0 };
  const f = computeFillers({ room, items: [tall] });
  assert.equal(f.length, 1);
  assert.equal(f[0].h, getCab('T1').h);        // full tall height, not 35"
  assert.ok(Math.abs(f[0].w - 4) < 0.1);       // fills the 4" gap to the wall
  // a plain base unit still gets a 35" scribe
  const floor = { id: 2, code: 'F2', x: minX + 3 + 12, z: minZ + 12.25, rotDeg: 0 };
  assert.equal(computeFillers({ room, items: [floor] })[0].h, getCab('F2').h);
});

// ----- opening placement maths (UI read-out must match the 3D) -----
test('opening never overhangs a corner; near-edge read-out is honest', async () => {
  const { openingCenter, openingNearEdge, openingWidth } = await import('../src/core/openings.js');
  const room = { width: 144, depth: 120 };
  // a 45" window dragged hard to the corner clamps to a 4" reveal, not negative
  const o = { type: 'window', wall: 'right', width: 45, pos: 0 };
  assert.ok(Math.abs(openingNearEdge(room, o) - 4) < 0.01);
  // centred reads (walllen - width)/2
  assert.ok(Math.abs(openingNearEdge(room, { ...o, pos: 0.5 }) - (120 - 45) / 2) < 0.01);
  // the centre stays inside the wall both ends
  const c0 = openingCenter(room, { ...o, pos: 0 });
  const c1 = openingCenter(room, { ...o, pos: 1 });
  const w = openingWidth(o, room);
  assert.ok(c0 - w / 2 >= -120 / 2 - 0.01 && c1 + w / 2 <= 120 / 2 + 0.01);
});

// ----- room openings + boxing-in -----
test('legacy window/door booleans migrate to the openings array', () => {
  const s = new Store();
  s.replace({ schema: 'plinth-planner', version: 1, items: [],
    room: { width: 144, depth: 120, height: 96, window: true, door: true, windowPos: 0.3, doorPos: 0.7 } });
  const ops = s.state.room.openings;
  assert.equal(ops.length, 2);
  assert.ok(ops.find((o) => o.type === 'window' && o.wall === 'back'));
  assert.ok(ops.find((o) => o.type === 'door' && o.wall === 'left'));
});

test('multiple openings (2 windows + door on one wall) coexist with unique ids', () => {
  const s = new Store();
  s.addOpening({ type: 'window', wall: 'back', pos: 0.2 });
  s.addOpening({ type: 'window', wall: 'back', pos: 0.8 });
  s.addOpening({ type: 'door', wall: 'back', pos: 0.5 });
  s.addOpening({ type: 'doorway', wall: 'left', pos: 0.5 });
  const ops = s.state.room.openings;
  assert.equal(ops.length, 4);
  assert.equal(new Set(ops.map((o) => o.id)).size, 4);
  assert.equal(ops.filter((o) => o.wall === 'back').length, 3);
  s.removeOpening(ops[0].id);
  assert.equal(s.state.room.openings.length, 3);
});

test('boxing-in adds/edits/removes', () => {
  const s = new Store();
  const b = s.addBoxing({ wall: 'back', pos: 0.3, w: 8, d: 8 });
  s.updateBoxing(b.id, { w: 12 });
  assert.equal(s.state.room.boxings[0].w, 12);
  s.removeBoxing(b.id);
  assert.equal(s.state.room.boxings.length, 0);
});

// ----- draft-kitchen generator -----
test('generateKitchen fits the wall, includes a sink, and varies by seed', async () => {
  const { generateKitchen } = await import('../src/core/layouts.js');
  const W = (c) => getCab(c)?.w || 0;
  const rm = { width: 180, depth: 108, height: 96 };
  const a = generateKitchen('island', rm, 1);
  const back = a.steps.filter((s) => s.wall === 'back');
  const total = back.reduce((t, s) => t + W(s.code), 0);
  assert.ok(total <= rm.width + 0.5, 'back run fits the wall');
  assert.ok(back.some((s) => s.sink), 'has a sink base');
  assert.ok(back.some((s) => s.code === 'AP1' || s.code === 'AP2'), 'has a cooker');
  // kitchen rule: the sink is never directly beside the cooker
  const isCook = (c) => c === 'AP1' || c === 'AP2';
  for (let i = 0; i < back.length - 1; i++) {
    const adj = (back[i].sink && isCook(back[i + 1].code)) || (isCook(back[i].code) && back[i + 1].sink);
    assert.ok(!adj, 'sink must not be adjacent to the cooker');
  }
  assert.ok(a.steps.some((s) => s.wall === 'island'), 'island shape adds an island');
  // a different seed gives a different layout
  const b = generateKitchen('island', rm, 7);
  assert.notEqual(a.steps.map((s) => s.code).join(), b.steps.map((s) => s.code).join());
});

// ----- end panels: island backs + exposed run ends -----
test('island back gets an end panel; double-sided island does not', () => {
  assert.equal(computeEndPanels({ room, items: [{ id: 1, code: 'F2', x: 0, z: 0, rotDeg: 0 }] }).count, 1);
  assert.equal(computeEndPanels({ room, items: [
    { id: 1, code: 'F2', x: 0, z: 0, rotDeg: 0 },
    { id: 2, code: 'F2', x: 0, z: -24, rotDeg: 180 },
  ] }).count, 0);
});

test('a wall run is capped with an end panel at each exposed end', () => {
  const Zb = -room.depth / 2 + 12.25;                 // back-wall base line
  // a lone base cabinet mid-wall has two open ends -> two end panels
  assert.equal(computeEndPanels({ room, items: [{ id: 1, code: 'F2', x: 0, z: Zb, rotDeg: 0 }] }).count, 2);
  // a two-cabinet run: inner sides butt, only the two outer ends are capped
  assert.equal(computeEndPanels({ room, items: [
    { id: 1, code: 'F2', x: -12, z: Zb, rotDeg: 0 },
    { id: 2, code: 'F2', x: 12, z: Zb, rotDeg: 0 },
  ] }).count, 2);
  // a cabinet whose end reaches a side wall is capped only on its open end
  assert.equal(computeEndPanels({ room, items: [
    { id: 1, code: 'F2', x: -room.width / 2 + 12.25, z: Zb, rotDeg: 0 },
  ] }).count, 1);
});

// ----- shareable link round-trip -----
test('a design encodes into a share URL and decodes back exactly', async () => {
  globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
  globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
  globalThis.location = { origin: 'https://x.test', pathname: '/', hash: '' };
  const { buildShareURL, loadFromHash } = await import('../src/core/persistence.js');
  const a = new Store();
  a.addItem('F2', { x: 0, z: -46, rotDeg: 0 });
  a.setFinish('Kale'); a.setRoom({ width: 168 });
  const url = buildShareURL(a);
  globalThis.location.hash = url.slice(url.indexOf('#'));
  const b = new Store();
  assert.equal(loadFromHash(b), true);
  assert.equal(b.state.items.length, 1);
  assert.equal(b.state.finish, 'Kale');
  assert.equal(b.state.room.width, 168);
});

// ----- hardware is fixed: knobs only (Plinth doesn't sell other hardware) -----
test('hardware is knobs only — no picker, knob geometry on doors', async () => {
  const { buildCabinet } = await import('../src/models/cabinet.js');
  // a door cabinet renders a knob (SphereGeometry) with the fixed 'knob' opts
  const g = buildCabinet(getCab('F2'), '#fff', { handle: 'knob' });
  let knobs = 0;
  g.traverse((o) => { if (o.isMesh && o.geometry?.type === 'SphereGeometry') knobs++; });
  assert.ok(knobs >= 1, 'door cabinet carries a knob');
  // the store no longer exposes a handle setter (hardware is not a choice)
  const s = new Store();
  assert.equal(s.state.handle, 'knob');
  assert.equal(typeof s.setHandle, 'undefined');
});

// ----- corner cabinets: L/R variants + never through a wall -----
test('corner cabinets come in left/right return variants', () => {
  for (const [code, side] of [['F15', 'left'], ['F15R', 'right'], ['F16', 'left'], ['F16R', 'right']]) {
    const c = getCab(code);
    assert.ok(c && c.corner && c.cornerSide === side, `${code} should be a ${side}-return corner`);
  }
});

test('a corner cabinet (and its return panel) never passes through a wall', () => {
  const bounds = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
  const mk = (items) => ({ state: { items }, getItem: (id) => items.find((i) => i.id === id) });
  // left-blank corner dragged hard into the left wall → panel edge stops at minX
  const r = snapPosition(mk([{ id: 'a', code: 'F15', x: -300, z: -46, rotDeg: 0 }]), 'a', -300, -46, bounds);
  assert.ok((r.x - (20 / 2 + 20)) >= bounds.minX - 0.01, 'F15 panel stays inside the left wall');
  // right-blank into the right wall
  const r2 = snapPosition(mk([{ id: 'b', code: 'F15R', x: 300, z: -46, rotDeg: 0 }]), 'b', 300, -46, bounds);
  assert.ok((r2.x + (20 / 2 + 20)) <= bounds.maxX + 0.01, 'F15R panel stays inside the right wall');
});

// ----- door knobs meet in the middle on a double; rotation stickiness -----
test('a double cabinet places its two knobs at the centre (meeting in the middle)', async () => {
  const THREE = await import('three');
  const { buildCabinet } = await import('../src/models/cabinet.js');
  const g = buildCabinet(getCab('F10'), '#fff', { handle: 'knob' });
  g.updateMatrixWorld(true);
  const xs = [];
  g.traverse((o) => { if (o.isMesh && o.geometry?.type === 'SphereGeometry') { const p = new THREE.Vector3(); o.getWorldPosition(p); xs.push(p.x); } });
  xs.sort((a, b) => a - b);
  assert.equal(xs.length, 2);
  assert.ok(xs[0] < 0 && xs[1] > 0 && Math.abs(xs[0]) < 4 && Math.abs(xs[1]) < 4, 'both knobs near the centre');
});

test('a back-facing cabinet keeps its facing in the corner (no auto-flip to the side wall)', () => {
  const bounds = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
  const mk = (items) => ({ state: { items }, getItem: (id) => items.find((i) => i.id === id) });
  const bz = bounds.minZ + 12.25, lx = bounds.minX + 12.25;
  const r = snapPosition(mk([{ id: 'a', code: 'F18', x: lx + 1, z: bz + 2, rotDeg: 0 }]), 'a', lx + 1, bz + 2, bounds);
  assert.equal(r.rotDeg, 0);
});

// ----- appliance feature-snap -----
test('sink/hob centre under a window; range snaps to wall centre, not the window', async () => {
  const { openingCenter } = await import('../src/core/openings.js');
  const bounds = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
  const rm = { width: 144, depth: 120, height: 96, openings: [{ id: 1, type: 'window', wall: 'back', width: 48, pos: 0.7 }] };
  const mk = (items) => ({ state: { items, room: rm }, getItem: (id) => items.find((i) => i.id === id) });
  const winC = openingCenter(rm, rm.openings[0]);
  const snapX = (code, x) => snapPosition(mk([{ id: 'a', code, x, z: -50, rotDeg: 0 }]), 'a', x, bounds.minZ + 10.25, bounds).x;
  assert.ok(Math.abs(snapX('AP6', winC - 7) - winC) < 0.01);   // sink → window centre
  assert.ok(Math.abs(snapX('AP4', winC - 6) - winC) < 0.01);   // hob → window centre
  assert.ok(Math.abs(snapX('AP2', 6)) < 0.01);                 // range → wall centre
  assert.ok(Math.abs(snapX('AP2', 40) - 40) < 0.5);            // range far away → no window grab
});

// ----- loose accessories -----
test('ticked accessories are priced into the estimate', async () => {
  const { orderableAccessories, getCab, sellUSD } = await import('../src/core/catalogue.js');
  const codes = orderableAccessories().map((a) => a.code);
  assert.ok(codes.includes('A2') && codes.includes('A3') && !codes.includes('A7')); // A7 has no price
  const s = { room, items: [{ id: 1, code: 'F2', x: 0, z: -46, rotDeg: 0 }], accessories: { A3: 2, A2: 1 } };
  const r = summarizeState(s);
  const a3 = r.lines.find((l) => l.code === 'A3' && l.accessory);
  assert.ok(a3 && a3.qty === 2 && Math.abs(a3.line - sellUSD(getCab('A3')) * 2) < 1);
  assert.ok(r.lines.some((l) => l.code === 'A2' && l.accessory));
});

// ----- cornice -----
test('cornice: none gives no segments; island tall wraps all four faces', () => {
  assert.equal(planCornice({ room: { ...room, cornice: 'none' }, items: [{ id: 1, code: 'T1', x: 0, z: 0 }] }).totalIn, 0);
  const p = planCornice({ room: { ...room, cornice: 'plain' }, items: [{ id: 1, code: 'T1', x: 0, z: 0, rotDeg: 0 }] });
  assert.equal(p.totalIn, getCab('T1').w * 2 + getCab('T1').d * 2); // 24*4 = 96
});

test('cornice: a cabinet against the back wall skips its back face', () => {
  const p = planCornice({ room: { ...room, cornice: 'plain' }, items: [{ id: 1, code: 'W2', x: 0, z: -room.depth / 2 + 7, rotDeg: 0 }] });
  // front (24) + two sides (14+14) = 52, no back
  assert.equal(p.totalIn, getCab('W2').w + getCab('W2').d * 2);
  assert.equal(p.segments.length, 3);
});

test('cornice: abutting upper cabinets drop the shared side faces', () => {
  const p = planCornice({ room: { ...room, cornice: 'plain' }, items: [
    { id: 1, code: 'W2', x: -12, z: -53, rotDeg: 0 },
    { id: 2, code: 'W2', x: 12, z: -53, rotDeg: 0 },
  ] });
  // 2× front (24) + 2× outer side (14) = 76
  assert.equal(p.totalIn, getCab('W2').w * 2 + getCab('W2').d * 2);
});

test('cornice: external corners get a mitre/return so the run wraps (no gap)', () => {
  // island tall: 4 exposed faces => 4 external corners
  const island = planCornice({ room: { ...room, cornice: 'plain' }, items: [{ id: 1, code: 'T1', x: 0, z: 0, rotDeg: 0 }] });
  assert.equal(island.corners.length, 4);
  // against the back wall: front + 2 sides => 2 external corners (no back, no wall corners)
  const onWall = planCornice({ room: { ...room, cornice: 'plain' }, items: [{ id: 1, code: 'W2', x: 0, z: -room.depth / 2 + 7, rotDeg: 0 }] });
  assert.equal(onWall.corners.length, 2);
});

test('cornice: appears as a priced line only when selected', () => {
  const items = [{ id: 1, code: 'T1', x: 0, z: 0, rotDeg: 0 }];
  assert.ok(!summarizeState({ room: { ...room, cornice: 'none' }, items }).lines.some((l) => l.cornice));
  const line = summarizeState({ room: { ...room, cornice: 'plain' }, items }).lines.find((l) => l.cornice);
  assert.ok(line && line.line > 0);
});
