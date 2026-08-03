// floorplan.test.js — the technical plan: chain dimensions, key/legend, and
// the branded PDF sheet. All string-level (the plan is pure SVG/HTML).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { buildFloorplanSVG, buildPlanSheetHTML } from '../src/ui/floorplan.js';

function demoState() {
  const s = new Store();
  s.setRoom({ width: 240, depth: 180, height: 96 });
  const minZ = -90;
  // back run: tall · drawers · range · drawers (butted, left to right)
  let x = -120;
  for (const code of ['T3', 'F18', 'AP2', 'F20']) {
    const w = { T3: 24, F18: 24, AP2: 36, F20: 36 }[code];
    s.addItem(code, { x: x + w / 2, z: minZ + (code === 'AP2' ? 13 : 12) + 0.25 });
    x += w;
  }
  s.addItem('W2', { x: -96, z: minZ + 7 + 0.25 });          // upper above the run
  s.addItem('F20', { x: 0, z: 0, rotDeg: 180, island: true }); // island
  return s.serialize();
}

test('plan draws a KEY table: qty/code/type/desc + W/D/H columns', () => {
  const svg = buildFloorplanSVG(demoState());
  assert.match(svg, />KEY</);
  assert.match(svg, />QTY<.*>CODE<.*>TYPE<.*>DESCRIPTION</s);       // header row
  assert.match(svg, /font-weight="bold">T3<\/tspan><tspan[^>]*>Tall/);
  assert.match(svg, /font-weight="bold">F20<\/tspan><tspan[^>]*>Floor/);
  assert.match(svg, /font-weight="bold">W2<\/tspan><tspan[^>]*>Wall/);
  assert.match(svg, /font-weight="bold">AP2<\/tspan><tspan[^>]*>Appliance \*/);
  assert.match(svg, /not supplied by PL\/NTH/);                     // footnote
  // grouped: F20 appears once in the key (run + island), with qty 2
  assert.equal((svg.match(/font-weight="bold">F20<\/tspan>/g) || []).length, 1);
  assert.match(svg, />2<\/tspan><tspan[^>]*font-weight="bold">F20/);
});

test('chain dimensions include the range and label unit widths', () => {
  const svg = buildFloorplanSVG(demoState());
  assert.match(svg, />36"</);                              // AP2 / F20 bays labelled
  assert.match(svg, />24"</);                              // T3 / F18 bays labelled
  assert.match(svg, />120"</);                             // overall run 24+24+36+36
  assert.match(svg, />20' 0"</);                           // wall length
});

test('per-cabinet width labels are gone (no dimension on every box)', () => {
  const svg = buildFloorplanSVG(demoState());
  // the old style drew one width text per cabinet + arrows at each face; the
  // chain draws ONE 36" label per 36" bay: AP2 + F20 in the back chain, plus
  // the island's bay and its overall length → exactly four DIM labels (the
  // key table's size cells are text-anchor="end", dims are "middle").
  assert.equal((svg.match(/text-anchor="middle">36"</g) || []).length, 4);
});

test('branded sheet wraps the SVG with header, meta and footer', () => {
  const html = buildPlanSheetHTML(demoState());
  assert.match(html, /PL<span class="slash">\/<\/span>NTH/);
  assert.match(html, /KITCHEN FLOOR PLAN/);
  assert.match(html, /20' 0" × 15' 0" × 8' 0"/);
  assert.match(html, /<svg /);
  assert.match(html, /scribe fillers/);
  assert.match(html, /responsible for checking and confirming every measurement on site/);
  assert.match(html, /does not survey or verify site dimensions/);
  assert.match(html, /plinthmade\.com/);
  // brand rules: no yellow/gold anywhere
  assert.doesNotMatch(html, /#(ffd|fc0|f5c|gold)/i);
});

test('openings draw to scale with a corner→edge dimension for doors', () => {
  const s = new Store();
  s.setRoom({ width: 240, depth: 200, height: 96 });
  // doorway on the left wall: near edge should be pos*200 - 36/2 = 82" from the back corner
  s.addOpening({ type: 'doorway', wall: 'left', pos: 0.5, width: 36 });
  s.addOpening({ type: 'window', wall: 'back', pos: 0.5, width: 48 });
  const svg = buildFloorplanSVG(s.serialize());
  assert.match(svg, />82"</);                              // door position dimension
  assert.match(svg, /A 36 36 /);                           // swing arc radius = door width
  // window sill lines exist (two thin lines in the band)
  assert.ok(svg.includes('stroke-width="0.38"'));
});

test('empty plan still renders walls and wall dims without a key', () => {
  const s = new Store();
  s.setRoom({ width: 144, depth: 120, height: 96 });
  const svg = buildFloorplanSVG(s.serialize());
  assert.doesNotMatch(svg, />KEY</);
  assert.match(svg, />12' 0"</);
});
