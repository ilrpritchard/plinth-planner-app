// construction.test.js — the construction guard (render step 7, 2026-09-29).
//
// However the renderer changes, a straight-on view of a PL/NTH kitchen must still show the in-frame
// construction: a 22mm painted leg down both sides of every cabinet, two legs butted with ONE joint
// line between neighbours, the 35mm top rail, and the 115mm plinth flush with the face (no toe-kick
// set-back, no gap under a cabinet) with exactly one joint per cabinet junction.
//
// This half reads the SCENE GRAPH: the real CabinetLayer builds the two fixture kitchens
// (test/fixtures/construction-kitchens.json: a two-cabinet run and a three-cabinet island) and
// parallel rays fired straight at the fronts, every 0.1mm, stand in for an orthographic straight-on
// view. A ray "hits the face" when the first thing it meets is painted cabinet wood in the face
// plane (the plane of the legs). The other half, test/construction-render.mjs, checks the same
// things in the rendered PIXELS (live planner and photo mode, headless Chrome).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null, addEventListener() {} }),
  body: { appendChild() {} },
};

const THREE = await import('three');
const { Store } = await import('../src/core/store.js');
const { CabinetLayer } = await import('../src/interaction/cabinets.js');
const { getCab } = await import('../src/core/catalogue.js');
const { SPEC, mmToIn } = await import('../src/core/units.js');

const FIX = JSON.parse(readFileSync(new URL('./fixtures/construction-kitchens.json', import.meta.url), 'utf8'));
const MM = mmToIn(1), STEP = 0.1 * MM;
const LEG_MM = 22, RAIL_MM = 35, PLINTH_MM = 115;
const TOL = 0.3;                                  // mm: two sample steps either side

function kitchen(name) {
  const store = new Store();
  assert.ok(store.replace(FIX[name]), `fixture ${name} loads`);
  const scene = new THREE.Scene();
  const layer = new CabinetLayer(scene, store);
  scene.updateMatrixWorld(true);
  const cabs = store.state.items.map((it) => {
    const c = getCab(it.code);
    return { id: it.id, code: it.code, form: c.form, x0: it.x - c.w / 2, x1: it.x + c.w / 2, w: c.w, h: c.h, face: it.z + c.d / 2 };
  }).sort((a, b) => a.x0 - b.x0);
  const face = cabs[0].face;
  assert.ok(cabs.every((c) => Math.abs(c.face - face) < 1e-6), `${name}: one straight run`);
  const junctions = cabs.slice(1).map((c, i) => { assert.ok(Math.abs(c.x0 - cabs[i].x1) < 1e-6, `${name}: ${cabs[i].code} and ${c.code} butt`); return c.x0; });
  const ray = new THREE.Raycaster();
  ray.far = 100;
  const dir = new THREE.Vector3(0, 0, -1), o = new THREE.Vector3();
  // the plinth's material is the cabinet paint: sample it once, at the middle of the first plinth
  const hit = (x, y) => { o.set(x, y, face + 40); ray.set(o, dir); return ray.intersectObject(layer.group, true)[0] || null; };
  const paint = hit((cabs[0].x0 + cabs[0].x1) / 2, SPEC.PLINTH_IN / 2)?.object.material;
  assert.ok(paint, `${name}: a plinth to sample the paint from`);
  // 'F' = painted wood in the face plane, '.' = anything else (deeper, proud, oak, nothing)
  const at = (x, y) => { const h = hit(x, y); return h && Math.abs(h.point.z - face) < 0.004 && h.object.material.color?.getHex() === paint.color.getHex() ? 'F' : '.'; };
  const row = (y, xa, xb) => { let s = ''; for (let x = xa; x <= xb + 1e-9; x += STEP) s += at(x, y); return { s, xa }; };
  const col = (x, ya, yb) => { let s = ''; for (let y = ya; y <= yb + 1e-9; y += STEP) s += at(x, y); return { s, ya }; };
  return { store, layer, cabs, junctions, face, hit, at, row, col };
}

// runs of one character in a sampled line → [{ c, a, b }] in inches along the line
function runs({ s, xa, ya }) {
  const o = xa ?? ya, out = [];
  for (let i = 0; i < s.length;) { let j = i; while (j < s.length && s[j] === s[i]) j++; out.push({ c: s[i], a: o + i * STEP, b: o + j * STEP, mm: (j - i) * 0.1 }); i = j; }
  return out;
}
const near = (mm, want, tol = TOL) => Math.abs(mm - want) <= tol;
const K = { run: kitchen('run'), island: kitchen('island') };
// body heights to test the legs at: just above the plinth, the middle, just under the rail
const bodyRows = (c) => [SPEC.PLINTH_IN + 1.5, (SPEC.PLINTH_IN + c.h) / 2, c.h - mmToIn(RAIL_MM) - 1.5];

for (const [name, k] of Object.entries(K)) {
  test(`${name}: every cabinet shows a 22mm painted leg down both sides`, () => {
    for (const c of k.cabs) for (const y of bodyRows(c)) {
      const r = runs(k.row(y, c.x0 - 0.5, c.x1 + 0.5)).filter((q) => q.c === 'F');
      const left = r.find((q) => q.a >= c.x0 - STEP && q.a < c.x0 + 2 * MM);
      const right = r.find((q) => q.b <= c.x1 + STEP && q.b > c.x1 - 2 * MM);
      assert.ok(left && near(left.mm, LEG_MM), `${c.code} left leg at y=${y.toFixed(1)}: ${left ? left.mm.toFixed(1) + 'mm' : 'missing'}`);
      assert.ok(right && near(right.mm, LEG_MM), `${c.code} right leg at y=${y.toFixed(1)}: ${right ? right.mm.toFixed(1) + 'mm' : 'missing'}`);
    }
  });

  test(`${name}: neighbours show two legs butted, with ONE joint line between them`, () => {
    for (const [i, jx] of k.junctions.entries()) for (const y of bodyRows(k.cabs[i])) {
      // reveal · leg · joint · leg · reveal, the joint on the junction: one line, never two, never none
      const seg = runs(k.row(y, jx - 30 * MM, jx + 30 * MM));
      const j = seg.findIndex((q) => q.a <= jx && q.b >= jx);
      const say = seg.map((q) => q.c + q.mm.toFixed(1)).join(' ');
      assert.equal(seg[j].c, '.', `junction x=${jx} y=${y.toFixed(1)}: a joint line on the junction (${say})`);
      assert.ok(seg[j].mm <= 1.5, `junction x=${jx}: the joint is a hairline (${seg[j].mm.toFixed(1)}mm)`);
      const legs = [seg[j - 1], seg[j + 1]];
      assert.ok(legs.every((q) => q?.c === 'F' && near(q.mm, LEG_MM)), `junction x=${jx} y=${y.toFixed(1)}: two 22mm legs butted (${say})`);
      assert.ok(seg[j - 2]?.c === '.' && seg[j + 2]?.c === '.', `junction x=${jx}: a reveal beyond each leg, so the legs read as legs (${say})`);
    }
  });

  // doors and drawer banks alike (her call 2026-09-29: a bank's rail is 35mm, as the front drawings)
  test(`${name}: a 35mm painted top rail runs over every door and drawer bank`, () => {
    for (const c of k.cabs) for (const x of [c.x0 + c.w / 4, c.x1 - c.w / 4]) {
      const r = runs(k.col(x, c.h - 60 * MM, c.h - STEP / 2));
      const top = r[r.length - 1];
      // 35mm to the door's top edge; a door's edge hairline (1.3mm of it on the rail) may cover the last of it
      assert.ok(top.c === 'F' && top.mm >= RAIL_MM - 1.5 && top.mm <= RAIL_MM + TOL, `${c.code} top rail at x=${x}: ${top.c === 'F' ? top.mm.toFixed(1) + 'mm' : 'missing'}`);
      assert.equal(r[r.length - 2]?.c, '.', `${c.code}: a reveal under the rail`);
    }
  });

  test(`${name}: the 115mm plinth is flush with the face, one joint per junction and no others`, () => {
    const xa = k.cabs[0].x0 - 0.5, xb = k.cabs[k.cabs.length - 1].x1 + 0.5;
    for (const y of [0.3 * MM, SPEC.PLINTH_IN / 2, SPEC.PLINTH_IN - 0.3 * MM]) {
      const r = runs(k.row(y, xa, xb));
      const core = r.slice(r.findIndex((q) => q.c === 'F'), r.findLastIndex((q) => q.c === 'F') + 1);
      const joints = core.filter((q) => q.c === '.');
      assert.equal(joints.length, k.junctions.length, `y=${(y / MM).toFixed(0)}mm: ${joints.length} plinth joints for ${k.junctions.length} junctions`);
      joints.forEach((q, i) => {
        assert.ok(Math.abs((q.a + q.b) / 2 - k.junctions[i]) < 0.5 * MM && q.mm <= 1.5, `plinth joint ${i + 1} on its junction, a hairline`);
      });
      assert.ok(Math.abs(core[0].a - k.cabs[0].x0) < 1 * MM && Math.abs(core[core.length - 1].b - k.cabs[k.cabs.length - 1].x1) < 1 * MM, 'the plinth runs the full length');
    }
    // the plinth reaches exactly 115mm, then the painted bottom rail carries on in the same plane
    for (const c of k.cabs) {
      const r = runs(k.col((c.x0 + c.x1) / 2, STEP / 2, SPEC.PLINTH_IN + 10 * MM));
      assert.ok(r[0].c === 'F' && r[0].b >= SPEC.PLINTH_IN - STEP, `${c.code}: face from the floor to above the plinth (${r[0].mm.toFixed(1)}mm)`);
    }
    // drawer faces sit in the same plane as the plinth and the legs
    for (const c of k.cabs.filter((q) => q.form === 'drawers')) {
      const back = (k.face - k.hit(c.x0 + c.w / 4, (SPEC.PLINTH_IN + c.h) / 2 - 2).point.z) / MM;
      assert.ok(Math.abs(back) < 0.1, `${c.code}: drawer face flush with the plinth (${back.toFixed(1)}mm)`);
    }
  });

  // in-frame (her spec 2026-09-29): a door's stiles sit flush with the legs and the plinth, in one
  // plane, and its shaker centre panel is set back 5mm behind them
  test(`${name}: door stiles flush with the legs and plinth, panels set back 5mm`, () => {
    for (const c of k.cabs.filter((q) => q.form !== 'drawers')) {
      const y = (SPEC.PLINTH_IN + c.h) / 2 - 3;                           // clear of the knob
      const stile = c.x0 + SPEC.LEG_IN + SPEC.REVEAL_IN + 40 * MM;       // the middle of the hinge-side 80mm stile
      const proud = (k.hit(stile, y).point.z - k.face) / MM;
      assert.ok(Math.abs(proud) <= 0.1, `${c.code}: door stile ${proud.toFixed(1)}mm ${proud > 0 ? 'proud of' : 'behind'} the plinth plane`);
      const panel = (k.face - k.hit(c.x0 + c.w / 4, y).point.z) / MM;   // a quarter in: the centre panel
      assert.ok(Math.abs(panel - 5) <= 0.1, `${c.code}: shaker panel ${panel.toFixed(1)}mm behind the face, want 5`);
    }
  });

  test(`${name}: no gap or recess under any cabinet`, () => {
    for (const c of k.cabs) {
      const box = new THREE.Box3().setFromObject(k.layer.map.get(c.id).group);
      assert.ok(Math.abs(box.min.y) < 1e-6, `${c.code} stands on the floor (${box.min.y})`);
      for (let x = c.x0 + 1 * MM; x < c.x1 - 1 * MM; x += 0.5) {
        const r = runs(k.col(x, STEP / 2, SPEC.PLINTH_IN));
        assert.ok(r.length === 1 && r[0].c === 'F', `${c.code} x=${x.toFixed(2)}: ${r.map((q) => q.c + q.mm.toFixed(1)).join(' ')} under the cabinet`);
      }
    }
  });
}

// every front in a run tops out at the same line, 35mm under the worktop: doors, a drawer bank and a
// dishwasher panel side by side (her catch 2026-09-29: the dishwasher panel stood 13mm above its
// neighbours once the drawer banks came down to the rail)
test('doors, drawers and the dishwasher panel line up under one 35mm rail', () => {
  const store = new Store();
  const d = FIX.run;
  assert.ok(store.replace({ ...d, items: [
    { id: 1, code: 'F2', x: -24, z: -127.75, rotDeg: 0 },
    { id: 2, code: 'F7', x: 0, z: -127.75, rotDeg: 0 },
    { id: 3, code: 'F18', x: 24, z: -127.75, rotDeg: 0 },
  ], nextId: 4 }));
  const scene = new THREE.Scene(), layer = new CabinetLayer(scene, store);
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), dir = new THREE.Vector3(0, 0, -1), face = -127.75 + 12;
  // straight down a column from the cabinet top: the first sample that is NOT the painted face
  // plane is the front's top edge line
  const railAt = (x) => {
    let paint = null;
    for (let y = 35 - STEP / 2; y > 30; y -= STEP) {
      ray.set(new THREE.Vector3(x, y, face + 40), dir);
      const h = ray.intersectObject(layer.group, true)[0];
      const f = h && Math.abs(h.point.z - face) < 0.004;
      if (f && !paint) paint = h.object.material;
      if (!f || h.object.material !== paint) return (35 - y) / MM;
    }
    return NaN;
  };
  const tops = { F2: railAt(-24 - 6), F7: railAt(-6), F18: railAt(24 - 6) };
  for (const [code, mm] of Object.entries(tops)) assert.ok(mm >= RAIL_MM - 1.5 && mm <= RAIL_MM + TOL, `${code}: its front starts ${mm.toFixed(1)}mm under the worktop, want 35`);
  const spread = Math.max(...Object.values(tops)) - Math.min(...Object.values(tops));
  assert.ok(spread <= 1.5, `the fronts line up (tops ${Object.entries(tops).map(([c, v]) => c + ' ' + v.toFixed(1)).join(', ')}mm)`);
});
