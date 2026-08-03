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

test('every placed cabinet AND appliance is an IFCFURNISHINGELEMENT', () => {
  const want = UNITS.reduce((t, u) => t + placedCount(u.state), 0);
  const got = (IFC.match(/^#\d+=IFCFURNISHINGELEMENT\(/gm) || []).length;
  assert.equal(got, want);
  // demoState definitely placed an AP2 range — its Tag must survive
  assert.match(IFC, /IFCFURNISHINGELEMENT\('[^']{22}',\$,'AP2 - Range 36" \(36in\)',\$,\$,#\d+,#\d+,'AP2'\)/);
  // one solid + one placement per element
  const solids = (IFC.match(/=IFCEXTRUDEDAREASOLID\(/g) || []).length;
  assert.equal(solids, want);
});

test('geometry is inches: F20 (36×24×35in) extrudes 36×24 by 35', () => {
  assert.match(IFC, /IFCRECTANGLEPROFILEDEF\(\.AREA\.,\$,#\d+,36\.,24\.\)/);
  assert.match(IFC, /IFCEXTRUDEDAREASOLID\(#\d+,#\d+,#\d+,35\.\)/);
});

test('mount heights in inches: wall units lift 54in, counter 36.5in', () => {
  // W2 placed at x=-96,z=-82.75 → point (-96, 82.75, 54)
  assert.match(IFC, /IFCCARTESIANPOINT\(\(-96\.,82\.75,54\.\)\)/);
  // C1 at x=40 → (40, 82.75, 36.5)
  assert.match(IFC, /IFCCARTESIANPOINT\(\(40\.,82\.75,36\.5\)\)/);
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
