// Sinks draw and cut from ONE spec (core/sinkspec.js): worktop cutout, 3D bowl,
// icon and size picker. AP17-AP20 are sized from the Franke Grande undermounts
// she chose; the original AP6 / AP7 / AP10 keep their cutouts exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCab, CATALOGUE } from '../src/core/catalogue.js';
import { sinkSpec, sinkSizes } from '../src/core/sinkspec.js';
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
  assert.deepEqual(sinkSizes('AP6').map((c) => c.code), ['AP10', 'AP6', 'AP17', 'AP18', 'AP19', 'AP20', 'AP7']);
  assert.deepEqual(sinkSizes('F2'), []);
  for (const c of CATALOGUE.filter((x) => x.appliance === 'sink')) {
    const svg = cabinetSVG(c);
    assert.equal((svg.match(/<rect /g) || []).length, 1 + sinkSpec(c).bowls.length, `${c.code}: stone line + a rect per bowl`);
  }
});
