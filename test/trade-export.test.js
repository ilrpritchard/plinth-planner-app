// trade-export.test.js — Trade exports: rows-from-design derivation, the
// order CSV, and the DXF writers (structural, parse-free asserts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { getCab, sellUSD, TRADE } from '../src/core/catalogue.js';
import { rowsFromDesign, tradeSummary, unitQty } from '../src/core/cost.js';
import { buildTradeOrderCSV } from '../src/core/tradecsv.js';
import { buildCabinetLibraryDXF, buildPlanDXF, librarySKUs } from '../src/core/dxf.js';

// DXF R2000 helpers: an entity is '0\nTYPE\n5\nhandle\n330\nowner\n100\nAcDbEntity\n8\nlayer...' — find by type + a group value
const entities = (dxf) => { const ls = dxf.split('\n'), out = []; let cur = null; for (let i = 0; i + 1 < ls.length; i += 2) { if (ls[i] === '0') { cur = [ls[i + 1]]; out.push(cur); } else if (cur) cur.push(ls[i], ls[i + 1]); } return out; };
const blockRegion = (dxf, name) => { const m = dxf.indexOf(`\nAcDbBlockBegin\n2\n${name}\n`); assert.ok(m > 0, `block ${name}`); const a = dxf.lastIndexOf('\n0\nBLOCK\n', m) + 1; return dxf.slice(a, dxf.indexOf('\nENDBLK', m)); };
const withGroup = (dxf, type, code, value) => entities(dxf).filter((e) => e[0] === type && e.some((v, i) => i % 2 === 1 && v === String(code) && e[i + 1] === String(value)));
const hasBlock = (dxf, name) => withGroup(dxf, 'BLOCK', 2, name).length > 0;
const hasInsert = (dxf, name) => withGroup(dxf, 'INSERT', 2, name).length > 0;
const hasLayer = (dxf, name) => withGroup(dxf, 'LAYER', 2, name).length > 0;
const layerRec = (dxf, name) => withGroup(dxf, 'LAYER', 2, name)[0].join('\n');


// ---- shared fixtures -------------------------------------------------------

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
  s.addItem('W2', { x: -96, z: minZ + 7 + 0.25 });
  s.addItem('F18', { x: 60, z: minZ + 12.25 });               // duplicate code
  s.addItem('F20', { x: 0, z: 0, rotDeg: 180, island: true }); // rotated island
  s.addOpening({ type: 'doorway', wall: 'left', pos: 0.5, width: 36 });
  return s.serialize();
}

const demoTrade = {
  project: 'Tower', finish: 'Ghost', units: [
    { id: 1, beds: '1 Bed', letter: 'A', name: '', qty: 10, floorFrom: '', floorTo: '', perFloor: '', rows: [{ id: 1, code: 'F2', qty: 5 }, { id: 2, code: 'W2', qty: 3 }] },
    { id: 2, beds: '2 Bed', letter: 'B', name: 'Sky, deluxe', qty: 0, floorFrom: 5, floorTo: 20, perFloor: 2, rows: [{ id: 3, code: 'F10', qty: 2 }, { id: 4, code: 'AP2', qty: 1 }] },
  ],
};

// ---- 1. rows-from-design derivation ---------------------------------------

test('rowsFromDesign groups placed items by code with counts', () => {
  const rows = rowsFromDesign(demoState().items);
  const byCode = Object.fromEntries(rows.map((r) => [r.code, r.qty]));
  assert.equal(byCode.F18, 2);      // duplicate grouped
  assert.equal(byCode.F20, 2);      // run + island grouped
  assert.equal(byCode.W2, 1);
  assert.equal(byCode.T3, 1);
});

test('rowsFromDesign drops appliances (not supplied) and sorts family → code', () => {
  const rows = rowsFromDesign(demoState().items);
  assert.ok(!rows.some((r) => r.code === 'AP2'));
  assert.deepEqual(rows.map((r) => r.code), ['F18', 'F20', 'W2', 'T3']); // FLOOR, WALL, TALL
});

test('rowsFromDesign is null-safe', () => {
  assert.deepEqual(rowsFromDesign(null), []);
  assert.deepEqual(rowsFromDesign([{ code: 'NOPE' }, null]), []);
});

// ---- 2. order CSV ----------------------------------------------------------

test('order CSV has the full header and one line per unit × cabinet', () => {
  const csv = buildTradeOrderCSV(demoTrade);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Unit type,Floors / qty,Cabinet code,Description,W (in),D (in),H (in),Qty per unit,Total qty,Unit sell $,Line total $');
  // unit A, F2 ×5 per unit × 10 units
  const f2 = lines.find((l) => l.includes(',F2,'));
  const eachF2 = sellUSD(getCab('F2'));
  assert.ok(f2.startsWith('1 Bed Type A,10,F2,Single,24,24,35,5,50,'));
  assert.ok(f2.endsWith(`${eachF2.toFixed(2)},${(eachF2 * 50).toFixed(2)}`));
  // unit B uses floors notation and its comma'd name is quoted
  const f10 = lines.find((l) => l.includes(',F10,'));
  assert.ok(f10.startsWith('"Sky, deluxe",Floors 5-20 x 2/floor (32),F10,'));
  // appliances are never priced lines
  assert.ok(!csv.includes(',AP2,'));
});

test('order CSV footer carries containers, shipping and grand total from tradeSummary', () => {
  const csv = buildTradeOrderCSV(demoTrade);
  const s = tradeSummary(demoTrade);
  assert.ok(csv.includes(`CABINETS SUBTOTAL,,,,,,,,${s.totalCabs},,${s.subtotal.toFixed(2)}`));
  assert.ok(csv.includes(`CONTAINERS,,,,,,,,${s.containers},,`));
  assert.ok(csv.includes(`SHIPPING,,,,,,,,,,${s.shipping.toFixed(2)}`));
  assert.ok(csv.includes(`GRAND TOTAL,,,,,,,,,,${s.grand.toFixed(2)}`));
  assert.equal(s.containers, Math.ceil(s.totalCabs / TRADE.capPerContainer));
  assert.equal(unitQty(demoTrade.units[1]), 32);
});

// ---- 3. DXF: shared structural checks --------------------------------------

function assertDXFShape(dxf, units = 1) {
  assert.ok(dxf.startsWith('0\nSECTION'), 'starts 0/SECTION');
  assert.ok(dxf.endsWith('EOF'), 'ends EOF');
  assert.ok(dxf.includes('\n2\nHEADER\n'), 'has HEADER section');
  assert.ok(dxf.includes(`\n$INSUNITS\n70\n${units}\n`), `declares units ${units}`);
  assert.ok(dxf.includes('\n2\nENTITIES\n'), 'has ENTITIES section');
}

function assertFiniteCoords(dxf) {
  const lines = dxf.split('\n');
  assert.equal(lines.length % 2, 0, 'strictly alternating code/value pairs');
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]);
    assert.ok(Number.isInteger(code), `group code is an int: ${lines[i]}`);
    if ((code >= 10 && code <= 39) || code === 40 || code === 50) {
      assert.ok(Number.isFinite(Number(lines[i + 1])), `finite value for group ${code}: ${lines[i + 1]}`);
    }
  }
}

test('cabinet library DXF: R12 skeleton, inch units, finite coordinates', () => {
  const dxf = buildCabinetLibraryDXF();
  assertDXFShape(dxf, 1);                 // 1 = inches (the catalogue's units)
  assert.ok(dxf.includes('\n2\nBLOCKS\n'), 'has BLOCKS section');
  assert.ok(dxf.includes('\n2\nTABLES\n'), 'declares the layer table');
  for (const layer of ['BODY', 'FRONT', 'LABEL']) {
    assert.ok(hasLayer(dxf, layer), `layer ${layer} declared`);
  }
  assertFiniteCoords(dxf);
  // R12: no LWPOLYLINE anywhere (POLYLINE polyface meshes only)
  assert.ok(!dxf.includes('LWPOLYLINE'));
  assert.ok(dxf.includes('\nPOLYLINE\n'), '3D polyface meshes present');
  // every POLYLINE is a closed polyface: flags 70=64, vertices then SEQEND
  const meshes = (dxf.match(/\nPOLYLINE\n/g) || []).length;
  const seqends = (dxf.match(/\nSEQEND\n/g) || []).length;
  assert.equal(meshes, seqends, 'every mesh is terminated');
});

test('cabinet library DXF: a FRONT_FACE BLOCK + INSERT + TEXT label per SKU', () => {
  const dxf = buildCabinetLibraryDXF();
  const skus = librarySKUs();
  assert.ok(skus.length > 40, 'library covers the catalogue');
  assert.ok(skus.every((c) => !c.notSupplied && c.h > 0));
  for (const c of skus) {
    assert.ok(hasBlock(dxf, `${c.code}_FRONT_FACE`), `BLOCK for ${c.code}`);
    assert.ok(hasInsert(dxf, `${c.code}_FRONT_FACE`), `INSERT for ${c.code}`);
    assert.ok(dxf.includes(`\n1\n${c.code}\n`), `TEXT label for ${c.code}`);
  }
  // appliances are not Plinth SKUs — no blocks for them
  assert.ok(!dxf.includes('\nAP2_FRONT_FACE\n'));
});

test('cabinet library DXF: geometry follows the client reference (mm detail, inch output)', () => {
  const dxf = buildCabinetLibraryDXF();
  const block = (code) => blockRegion(dxf, `${code}_FRONT_FACE`);
  // F1 single door — mm construction emitted in inches: 22mm end strip
  // (0.866"), 115mm plinth (4.528"), top-rail underside at 854mm (33.622"),
  // 80mm shaker frame (stile inner edge 102mm = 4.016") and 5mm recess (0.197")
  const f1 = block('F1');
  assert.ok(f1.includes('\n30\n4.528\n'), 'plinth box to z=115mm (4.528")');
  assert.ok(f1.includes('\n30\n33.622\n'), 'top rail underside at 854mm (33.622")');
  assert.ok(f1.includes('\n10\n0.866\n'), '22mm end strip / door edge (0.866")');
  assert.ok(f1.includes('\n10\n4.016\n'), 'shaker stile inner edge at 102mm (4.016")');
  assert.ok(f1.includes('\n20\n0.197\n'), 'panel recessed to 5mm (0.197")');
  assert.ok(f1.includes('\n30\n7.677\n'), 'shaker bottom rail inner edge at 195mm (7.677")');
  // F10 double door: leaves meet at mid-width (36" → 18")
  const f10 = block('F10');
  assert.ok(f10.includes('\n10\n18\n'), 'F10 doors meet at mid-width');
  // F17 3-drawer stack: plain slabs, top face exactly 175mm (854→679mm = 26.732")
  const f17 = block('F17');
  assert.ok(f17.includes('\n30\n26.732\n'), 'F17 top drawer face is 175mm');
  assert.ok(!f17.includes('\n20\n0.197\n'), 'drawer faces carry no shaker recess');
  // dishwasher: door & plinth only — no 22mm end strips (door spans full width)
  const f7 = block('F7');
  assert.ok(!f7.includes('\n10\n0.866\n'), 'F7 has no end strips');
  // carcass panels live in modelspace on BODY, fronts on FRONT, labels on LABEL
  for (const layer of ['BODY', 'FRONT', 'LABEL']) {
    assert.ok(dxf.includes(`\n8\n${layer}\n`), `entities on layer ${layer}`);
  }
});

test('plan DXF: 3D kitchen — inch units, blocks INSERTed per cabinet, no appliances', () => {
  const state = demoState();
  const dxf = buildPlanDXF(state);
  assertDXFShape(dxf, 1);                 // inches, like the catalogue
  assertFiniteCoords(dxf);
  for (const code of ['T3', 'F18', 'F20', 'W2']) {
    assert.ok(dxf.includes(`\n1\n${code}\n`), `plan labels ${code}`);
  }
  // appliances/sinks are NOT exported — the layout just leaves a gap
  assert.ok(!dxf.includes('\n1\nAP2\n'), 'no appliance label');
  assert.ok(!dxf.includes('AP2_UNIT'), 'no appliance block');
  // every DISTINCT supplied cabinet gets one SELF-CONTAINED 3D block (front +
  // carcass + footprint + label all inside, so one INSERT = one movable unit)
  assert.ok(dxf.includes('\n2\nBLOCKS\n'), 'has BLOCKS section');
  for (const code of ['T3', 'F18', 'F20', 'W2']) {
    assert.ok(dxf.includes(`\n2\n${code}_UNIT\n`), `block for ${code}`);
  }
  assert.ok(withGroup(dxf, 'BLOCK', 2, 'F18_UNIT').length === 1 && withGroup(dxf, 'INSERT', 2, 'F18_UNIT').length === 2,
    'duplicate F18s share ONE block definition (1 def in BLOCKS + 2 INSERT refs)');
  // 3D content: polyface meshes for carcasses + INSERTs lifted/rotated
  assert.ok(dxf.includes('\nPOLYLINE\n'), 'carcass polyface meshes present');
  assert.ok(dxf.includes('\n70\n64\n'), 'polyface-mesh flag set');
  // the W2 wall cabinet hangs at 56" (INSERT z): its top is level with the 86" talls
  assert.ok(dxf.includes('\n30\n56\n'), 'wall cabinet INSERT at mount height');
  // the rotated island block carries a rotation (group 50 = 180)
  assert.ok(dxf.includes('\n50\n180\n'), 'island INSERT rotated 180°');
  // MOVABILITY (client-reported, Revit/AutoCAD): modelspace holds ONLY wall
  // lines and one INSERT per cabinet — every mesh/footprint/label lives
  // inside the block, so selecting the insert moves the whole cabinet
  const entSec = dxf.split('\n2\nENTITIES\n')[1];
  assert.ok(!entSec.includes('\nPOLYLINE\n'), 'no loose meshes in modelspace');
  assert.ok(!entSec.includes('\nTEXT\n'), 'no loose labels in modelspace');
  assert.equal(entities(entSec).filter((e) => e[0] === 'INSERT' && /_UNIT/.test(e.join('\n'))).length, 6,
    'one cabinet INSERT per supplied cabinet (6 placed, AP2 is an appliance block instead)');
  assert.ok(hasInsert(entSec, 'AP2_APPLIANCE'), 'the range is a grey placeholder block');
  assert.ok(hasInsert(entSec, 'WORKTOPS') && hasInsert(entSec, 'ROOM'), 'worktops and the room ride in blocks of their own');
  // clean plan read: walls + floor footprints on PLAN, hung units dashed on
  // PLAN-UPPER (DASHED linetype declared), labels on LABEL
  assert.ok(dxf.includes('\nLINE\n'), 'wall plan drawn as LINEs');
  assert.ok(dxf.includes('\n8\nPLAN\n'), 'plan layer used');
  assert.ok(dxf.includes('\n8\nPLAN-UPPER\n'), 'hung-unit footprint layer used');
  assert.ok(withGroup(dxf, 'LTYPE', 2, 'DASHED').length === 1, 'dashed linetype declared');
  // the doorway breaks the left wall: jamb lines at x=-120" and x=-124"
  assert.ok(dxf.includes('\n10\n-120\n'));
  assert.ok(dxf.includes('\n11\n-124\n'));
});

test('plan DXF: cabinets-only variant drops the walls, keeps movable blocks', () => {
  const state = demoState();
  const dxf = buildPlanDXF(state, { walls: false });
  assertDXFShape(dxf, 1);
  assertFiniteCoords(dxf);
  const entSec = dxf.split('\n2\nENTITIES\n')[1];
  assert.ok(!entSec.includes('\nLINE\n'), 'no wall linework in modelspace');
  assert.equal(entities(entSec).filter((e) => e[0] === 'INSERT' && /_UNIT/.test(e.join('\n'))).length, 6,
    'all six cabinets still INSERTed');
  // footprints + labels still ship INSIDE the blocks
  assert.ok(dxf.includes('\n8\nPLAN-UPPER\n'), 'hung footprint inside block');
  assert.ok(dxf.includes('\n1\nW2\n'), 'labels inside block');
});

test('plan DXF: empty state still writes a valid four-wall room', () => {
  const s = new Store();
  const dxf = buildPlanDXF(s.serialize());
  assertDXFShape(dxf, 1);
  assertFiniteCoords(dxf);
  assert.ok((dxf.match(/\nLINE\n/g) || []).length >= 8, 'double-line walls');
});

test('DXF layers carry their colours: the finish on FRONT (nearest ACI + exact true colour), oak on BODY, a FRONT-<Finish> layer per cabinet painted differently (her rule 2026-09-25)', async () => {
  const { buildPlanDXF, buildCabinetLibraryDXF, nearestACI, trueColour } = await import('../src/core/dxf.js');
  const { getFinish } = await import('../src/core/catalogue.js');
  const state = { room: { width: 200, depth: 150, height: 96, openings: [] }, finish: 'Swamp', items: [
    { id: 1, code: 'F2', x: -64, z: -62.75, rotDeg: 0 }, { id: 2, code: 'F10', x: -34, z: -62.75, rotDeg: 0, finish: 'Ghost' } ] };
  const dxf = buildPlanDXF(state, { walls: true });
  const layer = (name) => { assert.ok(hasLayer(dxf, name), `layer ${name}`); return layerRec(dxf, name); };
  const swamp = getFinish('Swamp').hex, ghost = getFinish('Ghost').hex;
  assert.ok(layer('FRONT').includes(`\n62\n${nearestACI(swamp)}\n`) && layer('FRONT').includes(`\n420\n${trueColour(swamp)}\n`), 'FRONT is the kitchen finish');
  assert.ok(layer('FRONT-Ghost').includes(`\n420\n${trueColour(ghost)}\n`), 'the Ghost cabinet has its own layer, in Ghost');
  assert.ok(layer('BODY').includes(`\n420\n${trueColour('#c9a978')}\n`), 'BODY is oak');
  assert.ok(hasBlock(dxf, 'F10_UNIT-Ghost') && hasInsert(dxf, 'F10_UNIT-Ghost'), 'a block per paint');
  const ff = blockRegion(dxf, 'F10_UNIT-Ghost');
  assert.ok(ff.includes('\n8\nFRONT-Ghost\n') && !ff.includes('\n8\nFRONT\n'), 'its fronts sit on the Ghost layer');
  assert.ok(buildCabinetLibraryDXF().includes(`\n420\n${trueColour(ghost)}\n`), 'the library ships in Ghost');
  assert.equal(nearestACI('#333333'), 250); assert.equal(nearestACI('#ff0000'), 1); assert.equal(nearestACI('#ffffff'), 7);
});

test('the plan DXF carries the whole kitchen: worktop slabs, scribe fillers, the crown and appliance placeholders, each in a block on a coloured layer; sinks stay out', async () => {
  const { buildPlanDXF, trueColour } = await import('../src/core/dxf.js');
  const { WORKTOP_OPTIONS } = await import('../src/core/catalogue.js');
  const state = { room: { width: 200, depth: 150, height: 96, openings: [], worktop: 'soapstone', cornice: 'plain' }, finish: 'Swamp', items: [
    { id: 1, code: 'T1', x: -88, z: -61.57, rotDeg: 0 }, { id: 2, code: 'F2', x: -64, z: -62.75, rotDeg: 0 }, { id: 3, code: 'F10', x: -34, z: -62.75, rotDeg: 0 },
    { id: 4, code: 'AP19', x: -34, z: -62.75, rotDeg: 0 }, { id: 5, code: 'AP2', x: 2, z: -62, rotDeg: 0 }, { id: 6, code: 'F2', x: 32, z: -62.75, rotDeg: 0 },
    { id: 7, code: 'W2', x: -64, z: -68, rotDeg: 0 }, { id: 8, code: 'AP8', x: 2, z: -65, rotDeg: 0 } ] };
  const dxf = buildPlanDXF(state, { walls: true });
  const blockOf = (name) => blockRegion(dxf, name);
  assert.ok(blockOf('WORKTOPS').includes('\n8\nWORKTOP\n'), 'worktop slabs on WORKTOP');
  assert.ok(layerRec(dxf, 'WORKTOP').includes(`\n420\n${trueColour(WORKTOP_OPTIONS.soapstone.hex)}\n`), 'WORKTOP layer is the chosen soapstone');
  assert.ok(blockOf('CROWN').includes('\n8\nCROWN\n'), 'crown strips on CROWN');
  assert.ok(blockOf('AP2_APPLIANCE').includes('\n8\nAPPLIANCE\n') && blockOf('AP8_APPLIANCE').includes('\n8\nAPPLIANCE\n'), 'range and hood as grey boxes');
  assert.ok(!dxf.includes('AP19_APPLIANCE'), 'the sink stays out (it sits under the slab)');
  const entSec = dxf.split('\n2\nENTITIES\n')[1];
  assert.ok(!entSec.includes('\nPOLYLINE\n'), 'modelspace is still lines + inserts only');
});

test('the DXF is R2000 (true colour is official there), and the room comes as a floor slab + walls extruded to the ceiling with the windows and doors cut in, a pane of glass in each window', async () => {
  const { buildPlanDXF } = await import('../src/core/dxf.js');
  const state = { room: { width: 200, depth: 150, height: 96, wall: 'sage', floor: 'walnut', openings: [
    { id: 1, type: 'window', wall: 'back', pos: 0.5, width: 48, sill: 40, hgt: 40 }, { id: 2, type: 'door', wall: 'left', pos: 0.6, width: 34 } ] }, items: [] };
  const dxf = buildPlanDXF(state, { walls: true });
  assert.ok(dxf.includes('\n$ACADVER\n1\nAC1015\n'), 'AC1015 = R2000');
  assert.ok(hasBlock(dxf, 'ROOM') && hasInsert(dxf, 'ROOM'));
  const room = blockRegion(dxf, 'ROOM');
  const meshes = entities(room).filter((e) => e[0] === 'POLYLINE');
  const on = (layer) => meshes.filter((e) => e.join('\n').includes(`\n8\n${layer}\n`)).length;
  assert.equal(on('FLOOR'), 1, 'one floor slab');
  assert.equal(on('GLASS'), 1, 'one pane of glass');
  // back wall: left of the window, under the sill, over the head, right of the window = 4; left wall: before the door, lintel, after = 3; front + right = 1 each
  assert.equal(on('WALL'), 9, `wall slabs (${on('WALL')})`);
  assert.ok(layerRec(dxf, 'WALL').includes('\n420\n') && layerRec(dxf, 'FLOOR').includes('\n420\n'), 'wall and floor carry their colours');
  assert.ok(!buildPlanDXF(state, { walls: false }).includes('\n2\nROOM\n'), 'cabinets-only variant has no room');
});

test('a two-panel tall door is ONE frame face with the mid rail folded in (no joint lines across the stiles), the single door keeps the reference frame', async () => {
  const { buildCabinetLibraryDXF } = await import('../src/core/dxf.js');
  const dxf = buildCabinetLibraryDXF();
  const meshes = (name) => entities(blockRegion(dxf, name)).filter((e) => e[0] === 'POLYLINE').map((e) => e.join('\n') + '\n');
  const t1 = meshes('T1_FRONT_FACE'), f1 = meshes('F1_FRONT_FACE');
  assert.ok(t1.some((m) => m.includes('\n71\n16\n') && m.includes('\n72\n9\n')), 'T1 frame: 16 vertices, 9 faces, one mesh');
  assert.ok(!t1.some((m) => m.includes('\n71\n8\n') && m.includes('\n72\n6\n') && /\n20\n0\.197\n/.test(m) && !/\n20\n0\.709\n/.test(m)), 'no separate mid-rail box in the recess');
  assert.ok(f1.some((m) => m.includes('\n71\n8\n') && m.includes('\n72\n4\n')), 'F1 frame unchanged: 8 vertices, 4 mitred faces');
  // every join between rail and stile is an invisible edge (negative index) — only the outer door edges and the panel steps draw
  const frame = t1.find((m) => m.includes('\n71\n16\n'));
  const faces = frame.split('\nAcDbFaceRecord\n').slice(1).map((f) => [71, 72, 73, 74].map((c) => Number((f.match(new RegExp(`\\n${c}\\n(-?\\d+)\\n`)) || [])[1])));
  const neg = faces.flat().filter((v) => v < 0).length;
  assert.equal(faces.length, 9); assert.equal(neg, 18, `18 hidden joins (${neg})`);
});
