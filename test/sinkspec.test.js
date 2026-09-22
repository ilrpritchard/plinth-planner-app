// Sinks draw and cut from ONE spec (core/sinkspec.js): worktop cutout, 3D bowl,
// icon and size picker. AP17-AP20 are sized from the Franke Grande undermounts
// she chose; the original AP6 / AP7 / AP10 keep their cutouts exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCab, CATALOGUE } from '../src/core/catalogue.js';
import { sinkSpec, sinkSizes, baseUnder, bestBaseFor, canHost, overDishwasher, SINK_BASES } from '../src/core/sinkspec.js';
import { snapPosition } from '../src/interaction/snapping.js';
import { subtractSinkCutouts, sinkCornerFillets } from '../src/core/worktop-plan.js';
import { computeWarnings } from '../src/core/warnings.js';
import { cabinetSVG } from '../src/ui/icon.js';
import { Store } from '../src/core/store.js';

test('the original sinks keep the cutout they always had', () => {
  for (const code of ['AP6', 'AP7', 'AP10']) {
    const c = getCab(code), s = sinkSpec(c);
    assert.ok(Math.abs(s.cutW - (c.w - 2.4)) < 1e-9 && Math.abs(s.cutD - (c.d - 4.5)) < 1e-9, `${code} cutout unchanged`);
    assert.equal(s.depth, 7);
  }
  assert.equal(sinkSpec(getCab('AP7')).bowls.length, 2);
});

test('the four bigger sinks carry the Franke Grande numbers', () => {
  const want = { AP17: [24.75, 1, 23, 30], AP18: [30.125, 1, 28, 36], AP19: [32.75, 1, 31, 36], AP20: [32.875, 2, 15, 36] };
  for (const [code, [w, n, bowlW, minBase]] of Object.entries(want)) {
    const c = getCab(code), s = sinkSpec(c);
    assert.ok(c && c.appliance === 'sink' && c.notSupplied && c.usd === 0, `${code} is a supply-your-own sink`);
    assert.equal(c.w, w); assert.equal(s.bowls.length, n); assert.equal(s.bowls[0].w, bowlW);
    assert.equal(s.depth, 9); assert.equal(s.minBase, minBase);
    assert.ok(s.r >= 2.5, `${code} wide-radius corners`);
    assert.ok(s.drainZ < 0, `${code} drain sits behind centre`);
    assert.ok(s.cutW < c.w && s.cutD < c.d, `${code} opening inside its footprint`);
    assert.ok(s.cutW + 3 <= minBase, `${code} opening fits inside its minimum base`);
    assert.match(c.notes, /Franke Grande GDX1/);
    if (n === 2) assert.ok(/double/i.test(c.desc) && Math.abs(s.bowls[0].x + s.bowls[1].x) < 1e-9, 'double: named Double, bowls mirror');
  }
});

test('the worktop is cut to exactly the spec opening', () => {
  const c = getCab('AP19'), s = sinkSpec(c);
  const slab = { x0: -40, x1: 40, z0: -12, z1: 13.5 };
  const pieces = subtractSinkCutouts([slab], [{ code: 'AP19', x: 2, z: 0.5, rotDeg: 0 }], getCab);
  const area = (r) => (r.x1 - r.x0) * (r.z1 - r.z0);
  assert.ok(Math.abs(area(slab) - pieces.reduce((t, r) => t + area(r), 0) - s.cutW * s.cutD) < 1e-6, 'removed area = opening');
});

test('flush undermount: four stone fillets round the square hole to the bowl radius, in the slab material', () => {
  const slab = { x0: -40, x1: 40, z0: -12, z1: 13.5, mat: 'oak' };
  for (const rotDeg of [0, 90]) {
    const it = { code: 'AP19', x: 2, z: 0.5, rotDeg };
    const s = sinkSpec(getCab('AP19'));
    const big = rotDeg ? { x0: -13, x1: 13, z0: -40, z1: 40, mat: 'oak' } : slab;
    const f = sinkCornerFillets([big], [it], getCab, 24);
    assert.equal(f.length, 4);
    const hw = (rotDeg ? s.cutD : s.cutW) / 2, hd = (rotDeg ? s.cutW : s.cutD) / 2;
    for (const q of f) {
      assert.equal(q.mat, 'oak');
      let a = 0;                                           // shoelace area = r^2 (1 - pi/4)
      for (let i = 0; i < q.pts.length; i++) { const [x1, z1] = q.pts[i], [x2, z2] = q.pts[(i + 1) % q.pts.length]; a += x1 * z2 - x2 * z1; }
      assert.ok(Math.abs(Math.abs(a) / 2 - s.r * s.r * (1 - Math.PI / 4)) < 0.02, 'fillet area');
      for (const [x, z] of q.pts) assert.ok(Math.abs(x - it.x) <= hw + 1e-6 && Math.abs(z - it.z) <= hd + 1e-6, 'fillet stays inside the hole');
    }
  }
  assert.equal(sinkCornerFillets([slab], [{ code: 'AP19', x: 200, z: 0, rotDeg: 0 }], getCab).length, 0, 'no worktop under it: nothing to round');
});

test('a big sink over a small base is flagged, over a 36" base it is not', () => {
  const mk = (base) => { const st = new Store(); st.setRoom({ width: 144, depth: 120, height: 96 }); const b = st.addItem(base, { x: 0, z: -60 + 12.25 }); st.addItem('AP19', { x: 0, z: -60 + 12.75 }); return computeWarnings(st.state).map((w) => w.msg).join(' | '); };
  assert.match(mk('F18'), /needs a 36" base under it/);
  assert.ok(!/needs a \d+" base/.test(mk('F10')), 'F10 is 36": fine');
});

test('size picker lists every sink narrow to wide; icons draw one rounded bowl per basin', () => {
  assert.deepEqual(sinkSizes('AP6').map((c) => c.code), ['AP10', 'AP25', 'AP6', 'AP17', 'AP18', 'AP19', 'AP20', 'AP7']);
  assert.deepEqual(sinkSizes('F2'), []);
  for (const c of CATALOGUE.filter((x) => x.appliance === 'sink')) {
    const svg = cabinetSVG(c);
    assert.equal((svg.match(/<rect /g) || []).length, 1 + sinkSpec(c).bowls.length, `${c.code}: stone line + a rect per bowl`);
  }
});

// ---- her rules 2026-09-18: a sink dropped near a base CENTRES on it; "Sink base"
// shortcut tiles drop a real base with a real sink ----
const bounds = { minX: -72, maxX: 72, minZ: -60, maxZ: 60 };
const kitchen = () => { const st = new Store(); st.setRoom({ width: 144, depth: 120, height: 96 }); const z = -60 + 12.25;
  return { st, z, a: st.addItem('F18', { x: -60, z }), b: st.addItem('F10', { x: -30, z }), c: st.addItem('F2', { x: 0, z }) }; };

test('a sink dragged anywhere over or near a base snaps to its centre, both ways', () => {
  const { st, z, b, c } = kitchen();
  const sink = st.addItem('AP19', { x: 40, z: 20 });
  for (const [rx, rz] of [[-41, -50], [-19, -44], [-30, -30], [-33, -58]]) {
    const s = snapPosition(st, sink.id, rx, rz, bounds);
    assert.deepEqual([s.x, s.z, s.rotDeg, s.flag], [b.x, z, 0, undefined], `dropped at ${rx},${rz} -> centred on the 36" base`);
  }
  const s2 = snapPosition(st, sink.id, 3, -50, bounds);
  assert.deepEqual([s2.x, s2.z], [c.x, z], 'over the next base: that one');
  assert.equal(baseUnder(st.state, 50, 30), null, 'out in the room: no base, the sink moves freely');
});

test('a side-wall base hands the sink its rotation too', () => {
  const st = new Store(); st.setRoom({ width: 144, depth: 120, height: 96 });
  const base = st.addItem('F10', { x: -72 + 12.25, z: 10, rotDeg: 90 });
  const sink = st.addItem('AP20', { x: 0, z: 0 });
  const s = snapPosition(st, sink.id, -55, 14, bounds);
  assert.deepEqual([s.x, s.z, s.rotDeg], [base.x, base.z, 90]);
});

test('a sink added on its own goes to the snuggest EMPTY base that is big enough', () => {
  const { st, b, c } = kitchen();
  assert.equal(bestBaseFor(st.state, getCab('AP6')).id, c.id, '24" sink -> the 24" single, not the drawers, not the 36"');
  assert.equal(bestBaseFor(st.state, getCab('AP19')).id, b.id, '33" sink -> the 36" double');
  st.addItem('AP19', { x: b.x, z: b.z });
  assert.equal(bestBaseFor(st.state, getCab('AP20')).id, c.id, 'the double is taken: next best, and the warning says it is too small');
  st.addItem('AP6', { x: c.x, z: c.z });
  assert.equal(bestBaseFor(st.state, getCab('AP6')), null, 'every suitable base taken');
  assert.equal(bestBaseFor(new Store().state, getCab('AP6')), null);
});

test('cooktops prefer the cooktop-prepped bases', () => {
  const st = new Store(); st.setRoom({ width: 144, depth: 120, height: 96 }); const z = -60 + 12.25;
  st.addItem('F20', { x: -40, z }); const prepped = st.addItem('F30', { x: 0, z });
  assert.equal(bestBaseFor(st.state, getCab('AP5')).id, prepped.id);
});

test('Sink base shortcuts are real SKUs, big enough for their sink, never a new catalogue code', () => {
  for (const c of SINK_BASES) {
    const base = getCab(c.base), sink = getCab(c.sink);
    assert.ok(base && base.type === 'FLOOR' && (base.form === 'door' || base.form === 'double'), `${c.id} base`);
    assert.ok(sink && sink.appliance === 'sink', `${c.id} sink`);
    assert.ok(base.w >= (sink.minBase || sinkSpec(sink).cutW + 2), `${c.id}: ${base.code} is big enough for ${sink.code}`);
    assert.equal(getCab(c.id), undefined, `${c.id} is a shortcut, not a SKU`);
  }
});

// ---- her rule 2026-09-18 (screenshot: a sink snapped onto the F7 front): a sink
// can NEVER sit over a dishwasher; it only centres on a door / double base ----
test('a sink never lands on the dishwasher front: not by centring, not by dropping, and old designs are flagged', () => {
  const st = new Store(); st.setRoom({ width: 144, depth: 120, height: 96 }); const z = -60 + 12.25;
  const dw = st.addItem('F7', { x: -60, z }), door = st.addItem('F2', { x: -36, z }), drawers = st.addItem('F18', { x: -12, z });
  for (const code of ['F7', 'F29']) assert.equal(canHost(getCab(code), getCab('AP6')), false, `${code} never hosts a sink`);
  for (const code of ['F7', 'F29']) assert.equal(canHost(getCab(code), getCab('AP4')), false, `${code} never hosts a cooktop`);
  assert.equal(canHost(getCab('F18'), getCab('AP6')), false, 'nor does a drawer bank take a sink');
  assert.equal(canHost(getCab('F21'), getCab('AP6')), false, 'nor the bin');
  assert.ok(canHost(getCab('F2'), getCab('AP6')) && canHost(getCab('F10'), getCab('AP19')), 'door and double bases do');
  assert.ok(canHost(getCab('F30'), getCab('AP5')) && canHost(getCab('F20'), getCab('AP5')), 'a cooktop sits over drawers / a cooktop base');

  const sink = st.addItem('AP6', { x: 40, z: 20 });
  // pointer right over the dishwasher: the nearest SINK base is the door cabinet beside it
  const s1 = snapPosition(st, sink.id, dw.x, z, bounds);
  assert.ok(!(Math.abs(s1.x - dw.x) < 0.01 && Math.abs(s1.z - z) < 0.01), 'never centred on the dishwasher');
  assert.ok(!overDishwasher(st.state, getCab('AP6'), s1.x, s1.z, s1.rotDeg), 'wherever it lands, it is clear of the dishwasher');
  // with no sink base in reach, a drop over the dishwasher is refused and pings back
  st.removeItem(door.id);
  const s2 = snapPosition(st, sink.id, dw.x, z, bounds);
  assert.equal(s2.flag, 'dishwasher');
  assert.deepEqual([s2.x, s2.z], [40, 20], 'stays where it was');
  // a saved design that already has one is called out
  st.updateItem(sink.id, { x: dw.x, z });
  assert.match(computeWarnings(st.state).map((w) => w.msg).join(' | '), /sitting over the dishwasher/);
  void drawers;
});

test('a wide sink on the base NEXT to a dishwasher is fine as long as its bowl stays off it', () => {
  const st = new Store(); st.setRoom({ width: 144, depth: 120, height: 96 }); const z = -60 + 12.25;
  st.addItem('F7', { x: -60, z }); const base = st.addItem('F10', { x: -30, z });
  const sink = st.addItem('AP19', { x: 40, z: 20 });
  const s = snapPosition(st, sink.id, -30, z, bounds);
  assert.deepEqual([s.x, s.z, s.flag], [base.x, z, undefined], 'a 33" sink centres on the 36" double beside the dishwasher');
});


// the Blanco Andano 450-U (her ask 2026-09-22): an 18" bowl that fits the 20" single base, and its one-tap combo
import { test as _t2 } from 'node:test';
import _a2 from 'node:assert/strict';
_t2('AP25 Andano 450 fits the 20" single base, and the F1 + AP25 sink-base combo exists', async () => {
  const { getCab } = await import('../src/core/catalogue.js');
  const { sinkSpec, sinkMinBase, maxSinkCutout, SINK_BASES, canHost } = await import('../src/core/sinkspec.js');
  const s = getCab('AP25'), f1 = getCab('F1');
  _a2.equal(sinkMinBase(s), 20);
  _a2.ok(sinkSpec(s).cutW <= maxSinkCutout(f1.w), `bowl ${sinkSpec(s).cutW}" fits a 20" base (max ${maxSinkCutout(f1.w)})`);
  _a2.ok(canHost(f1, s));
  const combo = SINK_BASES.find((c) => c.id === 'SB20');
  _a2.ok(combo && combo.base === 'F1' && combo.sink === 'AP25');
});
