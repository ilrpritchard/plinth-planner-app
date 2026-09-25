// ifc.test.js — the IFC4 exporter: SPF envelope, reference integrity, one
// storey per unit type, every placed cabinet AND appliance as an
// IfcFurnishingElement, deterministic 22-char GlobalIds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { getCab } from '../src/core/catalogue.js';
import { generateKitchen } from '../src/core/layouts.js';
import { buildUnitIFC } from '../src/core/ifc.js';

// ---- fixtures ---------------------------------------------------------------

// Hand-built state in the trade-export style: floor run + tall + appliance +
// wall unit + a rotated island — covers every mount class and an AP code.
function demoState() {
  const s = new Store();
  s.setRoom({ width: 240, depth: 180, height: 96 });
  const minZ = -90;
  let x = -120;
  for (const code of ['T3', 'F18', 'AP2', 'F20']) {
    const w = { T3: 24, F18: 24, AP2: 36, F20: 36 }[code];
    s.addItem(code, { x: x + w / 2, z: minZ + (code === 'AP2' ? 13 : 12) + 0.25 });
    x += w;
  }
  s.addItem('W2', { x: -96, z: minZ + 7 + 0.25 });               // wall class
  s.addItem('C1', { x: 40, z: minZ + 7 + 0.25 });                // counter class
  s.addItem('F20', { x: 0, z: 0, rotDeg: 180, island: true });   // rotated
  return s.serialize();
}

// Generator-driven state: an L-shape kitchen's steps laid along a line (the
// exporter only cares about code/x/z/rotDeg, not run geometry).
function generatedState(seed = 3) {
  const { steps } = generateKitchen('l-shape', { width: 200, depth: 160 }, seed);
  const s = new Store();
  s.setRoom({ width: 400, depth: 160, height: 96 });
  let x = -190;
  for (const st of steps) {
    const w = getCab(st.code)?.w || 24;
    s.addItem(st.code, { x: x + w / 2, z: -60 });
    x += w + 2;
  }
  return s.serialize();
}

const placedCount = (state) =>
  state.items.filter((it) => getCab(it.code)?.placeable).length;

const UNITS = [
  { name: '1 Bed', state: demoState() },
  { name: "Owner's Suite — deluxe", state: generatedState() },
];
const IFC = buildUnitIFC(UNITS);

// ---- 1. envelope ------------------------------------------------------------

test('output is an ISO-10303-21 file with IFC4 schema', () => {
  assert.ok(IFC.startsWith('ISO-10303-21;'), 'must start with ISO-10303-21;');
  assert.ok(IFC.trimEnd().endsWith('END-ISO-10303-21;'),
    'must end with END-ISO-10303-21;');
  assert.match(IFC, /FILE_SCHEMA\(\('IFC4'\)\);/);
  assert.match(IFC, /ViewDefinition \[ReferenceView\]/);
  assert.match(IFC, /\nDATA;\n/);
  // length unit is a conversion-based INCH (0.0254 m) — Revit reads it natively
  assert.match(IFC, /IFCCONVERSIONBASEDUNIT\(#\d+,\.LENGTHUNIT\.,'INCH',#\d+\)/);
  assert.match(IFC, /IFCMEASUREWITHUNIT\(IFCLENGTHMEASURE\(0\.0254\),#\d+\)/);
});

test('deterministic: same input twice gives the identical file', () => {
  assert.equal(buildUnitIFC(UNITS), IFC);
  assert.match(buildUnitIFC(UNITS, { timestamp: '2026-01-01T00:00:00' }),
    /'2026-01-01T00:00:00'/);
});

// ---- 2. reference integrity ---------------------------------------------------

test('every #N referenced is a defined entity, one per line, ; terminated', () => {
  const defined = new Set();
  const referenced = new Set();
  for (const line of IFC.split('\n')) {
    const m = /^#(\d+)=(.*);$/.exec(line);
    if (!m) {
      assert.ok(!line.includes('=IFC'), `malformed entity line: ${line}`);
      continue;
    }
    assert.ok(!defined.has(m[1]), `duplicate entity id #${m[1]}`);
    defined.add(m[1]);
    for (const r of m[2].matchAll(/#(\d+)/g)) referenced.add(r[1]);
  }
  assert.ok(defined.size > 0);
  for (const r of referenced) {
    assert.ok(defined.has(r), `#${r} referenced but never defined`);
  }
});

// ---- 3. storeys + elements ----------------------------------------------------

test('one IFCBUILDINGSTOREY per unit, named after the unit type', () => {
  const storeys = IFC.match(/^#\d+=IFCBUILDINGSTOREY\(/gm) || [];
  assert.equal(storeys.length, UNITS.length);
  assert.match(IFC, /IFCBUILDINGSTOREY\('[^']{22}',\$,'1 Bed'/);
  // apostrophe doubled, em-dash (non-ASCII) stripped per SPF rules
  assert.match(IFC, /IFCBUILDINGSTOREY\('[^']{22}',\$,'Owner''s Suite  deluxe'/);
});

test('every placed cabinet AND appliance is an IFCFURNISHINGELEMENT, plus one per worktop slab', async () => {
  const { planWorktopSlabs } = await import('../src/core/worktop-plan.js');
  const slabs = UNITS.reduce((t, u) => t + planWorktopSlabs(u.state.items, getCab, 'marble', u.state.room).length, 0);
  const want = UNITS.reduce((t, u) => t + placedCount(u.state), 0);
  const got = (IFC.match(/^#\d+=IFCFURNISHINGELEMENT\(/gm) || []).length;
  assert.equal(got, want + slabs);
  // demoState definitely placed an AP2 range — its Tag must survive
  assert.match(IFC, /IFCFURNISHINGELEMENT\('[^']{22}',\$,'AP2 - Range cooker 36" \(36in\)',\$,\$,#\d+,#\d+,'AP2'\)/);
  // appliances and worktops are boxes; every cabinet is a tessellated body
  const appliances = UNITS.reduce((t, u) => t + u.state.items.filter((it) => getCab(it.code)?.type === 'APPLIANCES').length, 0);
  const solids = (IFC.match(/=IFCEXTRUDEDAREASOLID\(/g) || []).length;
  assert.equal(solids, appliances + slabs);
  assert.equal((IFC.match(/'Body','Tessellation'/g) || []).length, want - appliances, 'one tessellated body per cabinet');
});

test('geometry is inches: an F20 (36×24×35in) carcass spans -18..18 by -12..12 about its placement, 35 high', () => {
  assert.ok(IFC.includes('(-18.,-12.,0.)') && IFC.includes('(18.,12.,35.)'), 'carcass corners in inches');
  assert.match(IFC, /IFCRECTANGLEPROFILEDEF\(\.AREA\.,\$,#\d+,36\.,26\.\)/, 'the 36" range is still a 36 x 26 box');
});

test('mount heights in inches: wall units lift 56in, counter on the worktop (35in + 30mm)', () => {
  // W2 placed at x=-96,z=-82.75 → point (-96, 82.75, 56)
  assert.match(IFC, /IFCCARTESIANPOINT\(\(-96\.,82\.75,56\.\)\)/);
  // C1 at x=40 → (40, 82.75, 36.181102)
  const y = (35 + 30 / 25.4).toFixed(6).replace(/0+$/, '').replace('.', '\\.');
  assert.match(IFC, new RegExp(`IFCCARTESIANPOINT\\(\\(40\\.,82\\.75,${y}\\)\\)`));
});

// ---- 4. GlobalIds -------------------------------------------------------------

test('GlobalIds are exactly 22 chars of the IFC alphabet and unique', () => {
  const ROOTED = /^#\d+=IFC(?:PROJECT|SITE|BUILDING|BUILDINGSTOREY|FURNISHINGELEMENT|RELAGGREGATES|RELCONTAINEDINSPATIALSTRUCTURE)\('([^']*)'/gm;
  const ids = [...IFC.matchAll(ROOTED)].map((m) => m[1]);
  const storeys = (IFC.match(/^#\d+=IFCBUILDINGSTOREY\(/gm) || []).length;
  const elements = (IFC.match(/^#\d+=IFCFURNISHINGELEMENT\(/gm) || []).length;
  assert.ok(ids.length >= 3 + storeys + elements, 'every root entity has a GlobalId');
  for (const id of ids) {
    assert.equal(id.length, 22, `GlobalId not 22 chars: '${id}'`);
    assert.match(id, /^[0-9A-Za-z_$]{22}$/, `bad GlobalId chars: '${id}'`);
  }
  assert.equal(new Set(ids).size, ids.length, 'GlobalIds must be unique');
});

// ---- 5. edges -----------------------------------------------------------------

test('empty and unknown-code inputs still yield a valid envelope', () => {
  for (const out of [
    buildUnitIFC([]),
    buildUnitIFC([{ name: 'Empty', state: { items: [] } }]),
    buildUnitIFC([{ name: 'Stale', state: { items: [{ code: 'SH1', x: 0, z: 0 }] } }]),
  ]) {
    assert.ok(out.startsWith('ISO-10303-21;'));
    assert.ok(out.trimEnd().endsWith('END-ISO-10303-21;'));
    assert.equal((out.match(/=IFCFURNISHINGELEMENT\(/g) || []).length, 0);
  }
  // sized freestanding fridge resolves and tags as AP9
  const out = buildUnitIFC([{ name: 'F', state: { items: [{ code: 'AP9:36x30x72', x: 0, z: 0 }] } }]);
  assert.match(out, /IFCFURNISHINGELEMENT\('[^']{22}',\$,'[^']*',\$,\$,#\d+,#\d+,'AP9'\)/);
});

test('colours carry across: one IfcSurfaceStyle per colour, an IfcStyledItem on every solid, the finish on cabinets and steel on appliances (her rule 2026-09-25)', async () => {
  const { getFinish } = { getFinish: (n) => ({ Swamp: { hex: '#6B6148' } })[n] };
  const state = { finish: 'Swamp', items: [ { id: 1, code: 'F2', x: 0, z: -60, rotDeg: 0 }, { id: 2, code: 'F10', x: 40, z: -60, rotDeg: 0, finish: 'Ghost' }, { id: 3, code: 'AP2', x: 80, z: -60, rotDeg: 0 }, { id: 4, code: 'F23', x: 120, z: -60, rotDeg: 0 } ] };
  const ifc = buildUnitIFC([{ name: 'Type C', state }]);
  const solids = (ifc.match(/IFCEXTRUDEDAREASOLID/g) || []).length, sets = (ifc.match(/IFCPOLYGONALFACESET\(/g) || []).length, styled = (ifc.match(/IFCSTYLEDITEM\(/g) || []).length;
  const { planWorktopSlabs } = await import('../src/core/worktop-plan.js');
  const slabs = planWorktopSlabs(state.items, getCab, 'marble', { width: 144, depth: 120 }).length;
  assert.equal(solids, 1 + slabs, `the range is a box, plus one box per worktop slab (${slabs})`);
  assert.ok(sets >= 3 * 6, `the three cabinets are tessellated, several meshes each (${sets})`);
  assert.equal(styled, solids + sets, 'every solid and every mesh is styled');
  assert.ok(ifc.includes("IFCSURFACESTYLE('Swamp',.BOTH.,") && ifc.includes("IFCSURFACESTYLE('Ghost',.BOTH.,") && ifc.includes("IFCSURFACESTYLE('Stainless steel',.BOTH.,") && ifc.includes("IFCSURFACESTYLE('Oak',.BOTH.,"));
  const [r, g, b] = [0x6b / 255, 0x61 / 255, 0x48 / 255].map((v) => Math.round(v * 1e6) / 1e6);
  assert.ok(ifc.includes(`IFCCOLOURRGB($,${r},${g},${b})`), `Swamp is ${getFinish('Swamp').hex} in the file`);
  assert.equal((ifc.match(/IFCSURFACESTYLE\(/g) || []).length, 5, 'one style per colour, shared (Swamp, Ghost, steel, oak, the worktop)');
});

test('cabinets carry their real fronts: IfcPolygonalFaceSets in inches about the placement, boxes closed, frames open; appliances stay boxes; the worktop rides along', async () => {
  const { unitMeshes } = await import('../src/core/dxf.js');
  const state = { room: { width: 200, depth: 150, height: 96, worktop: 'soapstone' }, finish: 'Ghost', items: [ { id: 1, code: 'F2', x: 0, z: -62.75, rotDeg: 0 }, { id: 2, code: 'AP2', x: 40, z: -62, rotDeg: 0 } ] };
  const ifc = buildUnitIFC([{ name: 'T', state }]);
  const meshes = unitMeshes(getCab('F2')).filter((m) => m.layer === 'FRONT' || m.layer === 'BODY');
  assert.ok(meshes.length >= 6, `F2 has meshes (${meshes.length})`);
  assert.equal((ifc.match(/IFCPOLYGONALFACESET\(/g) || []).length, meshes.length, 'one face set per mesh');
  assert.ok(ifc.includes("'Body','Tessellation'"), 'tessellation representation');
  assert.ok(meshes.some((m) => m.closed) && meshes.some((m) => !m.closed), 'boxes are closed, the frame is an open shell');
  // a carcass corner: the F2 is 24 x 24: its side panel's outer face sits at x = -12 in the placement frame
  assert.ok(ifc.includes('(-12.,-12.,0.)'), 'block-local mm became inches about the centre');
  assert.ok(ifc.includes("IFCSURFACESTYLE('Oak',.BOTH.,") && ifc.includes("IFCSURFACESTYLE('Ghost',.BOTH.,"), 'oak carcass, painted fronts');
  assert.ok(ifc.includes("'Worktop 1 - Soapstone (by others)'"), 'the worktop slab is an element');
  assert.equal((ifc.match(/IFCEXTRUDEDAREASOLID/g) || []).length, 2, 'the range and the worktop are boxes');
});
