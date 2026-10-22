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
  // the island's bay → exactly three DIM labels (a ONE-cabinet island no longer
  // repeats its width as an "overall" line; the key table's size cells are
  // text-anchor="end", dims are "middle").
  assert.equal((svg.match(/text-anchor="middle">36"</g) || []).length, 3);
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

// 2026-10-22: the 3 bed (?s=kphtwup) ends its back run with an upper scribe (4¾") over a base scribe (1¾"):
// the two FILL labels were written in one spot. The 2 bed (?s=wq4g4g5) has a stacker scribe exactly over its
// tall's, which wrote the same label twice.
function fromItems(room, list) {
  const s = new Store();
  s.setRoom(room);
  const st = s.serialize();
  st.items = list.map((it, i) => ({ id: i + 1, finish: null, ...it }));
  return st;
}
function fillLabelBoxes(svg) {
  return [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*?(transform="rotate\(-90[^"]*")?[^>]*>(FILL [^<]+)<\/text>/g)].map((m) => {
    const x = +m[1], z = +m[2], len = m[4].length * 1.4, th = 2.4;
    return m[3] ? { x0: x - th / 2, x1: x + th / 2, z0: z - len / 2, z1: z + len / 2, t: m[4] }
                : { x0: x - len / 2, x1: x + len / 2, z0: z - th / 2, z1: z + th / 2, t: m[4] };
  });
}

test('FILL labels never land on one another, and a stacker scribe over its tall is labelled once', () => {
  const three = buildFloorplanSVG(fromItems({ width: 216, depth: 120, height: 110 }, [{"code": "F19", "x": 16.25, "z": -47.75, "rotDeg": 0}, {"code": "AP3", "x": 54.25, "z": -46.75, "rotDeg": 0}, {"code": "T4", "x": -94.57, "z": 29.25, "rotDeg": 90}, {"code": "F10", "x": -39.75, "z": -47.75, "rotDeg": 0}, {"code": "AP19", "x": -39.75, "z": -47.75, "rotDeg": 0}, {"code": "F7", "x": -9.75, "z": -47.75, "rotDeg": 0}, {"code": "T4", "x": -94.57, "z": -0.75, "rotDeg": 90, "hinge": "R"}, {"code": "F15R", "x": -95.75, "z": -25.75, "rotDeg": 90}, {"code": "F19", "x": 92.25, "z": -47.75, "rotDeg": 0}, {"code": "F22", "x": -70.75, "z": -47.75, "rotDeg": 0}, {"code": "AP28", "x": 54.25, "z": -49.75, "rotDeg": 0}, {"code": "S11", "x": -94.57, "z": -0.75, "rotDeg": 90, "hostId": 7}, {"code": "S11", "x": -94.57, "z": 29.25, "rotDeg": 90, "hostId": 3}, {"code": "W23:w30", "x": -100.75, "z": -30.75, "rotDeg": 90}, {"code": "W15", "x": 91.24, "z": -52.75, "rotDeg": 0, "hinge": "R"}, {"code": "W15", "x": 17.26, "z": -52.75, "rotDeg": 0}, {"code": "W19", "x": -15.74, "z": -52.75, "rotDeg": 0}, {"code": "W19", "x": -57.74, "z": -52.75, "rotDeg": 0}, {"code": "W22:w29.5", "x": -93.37, "z": -52.75, "rotDeg": 0}]));
  const boxes = fillLabelBoxes(three);
  assert.deepEqual(boxes.map((b) => b.t).sort(), ['FILL 1¾"', 'FILL 4¾"']);
  const [p, q] = boxes;
  assert.ok(!(p.x0 < q.x1 && q.x0 < p.x1 && p.z0 < q.z1 && q.z0 < p.z1), 'the two labels overlap');
  const two = buildFloorplanSVG(fromItems({ width: 192, depth: 120, height: 110 }, [{"code": "F7", "x": -52, "z": -47.75, "rotDeg": 0}, {"code": "F2", "x": -28, "z": -47.75, "rotDeg": 0}, {"code": "F21", "x": -6, "z": -48, "rotDeg": 0}, {"code": "F19", "x": 18, "z": -47.75, "rotDeg": 0}, {"code": "AP2", "x": 50, "z": -46.75, "rotDeg": 0}, {"code": "AP6", "x": -28, "z": -47.75, "rotDeg": 0}, {"code": "F19", "x": 82, "z": -48, "rotDeg": 0}, {"code": "T4", "x": -79, "z": -46.57, "rotDeg": 0}, {"code": "AP27", "x": 50, "z": -49.75, "rotDeg": 0}, {"code": "S11", "x": -79, "z": -46.57, "rotDeg": 0, "hostId": 8}, {"code": "W18", "x": -46, "z": -52.75, "rotDeg": 0}, {"code": "W18", "x": -10, "z": -52.75, "rotDeg": 0}, {"code": "W22:w23", "x": 19.51, "z": -52.75, "rotDeg": 0}, {"code": "W22:w23", "x": 80.49, "z": -52.75, "rotDeg": 0, "fixedWidth": true}]));
  assert.equal(fillLabelBoxes(two).filter((b) => b.t === 'FILL 2"').length, 1);
});
