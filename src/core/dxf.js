// dxf.js — a PURE, minimal DXF (ASCII) writer for AutoCAD hand-off.
//
// Two exports:
//   buildCabinetLibraryDXF() — every Plinth SKU as a 3D model, drawn to the
//     client's reference file ('PLINTH F1 F10 F20'): millimetre units,
//     polyface-mesh boxes, carcass panels on layer BODY in modelspace, the
//     shaker front as a named BLOCK '<CODE>_FRONT_FACE' on layer FRONT,
//     and a centred TEXT code on layer LABEL.
//   buildPlanDXF(state)      — the current kitchen as a 2D plan (inches):
//     double-line walls with openings as gaps, cabinet footprints with
//     centred code TEXT.
//
// R12 ASCII only: LINE, TEXT, INSERT and POLYLINE polyface meshes (all R12
// citizens — LWPOLYLINE is R14+ so it is never used). No DOM, no Three.js —
// testable in plain node.

import { CATALOGUE, getCab } from './catalogue.js';
import { openingCenter, openingWidth } from './openings.js';

// ---- low-level group-code helpers ----------------------------------------
// A DXF ASCII file is strictly alternating lines: group code, then value.
// We build flat arrays of those lines and join at the end.

function num(v) {
  const n = Number(v);
  return isFinite(n) ? Math.round(n * 1000) / 1000 : 0; // never emit NaN/Inf
}

function line(x1, y1, x2, y2, layer = '0') {
  return ['0', 'LINE', '8', layer,
    '10', num(x1), '20', num(y1), '30', 0,
    '11', num(x2), '21', num(y2), '31', 0];
}

function text(x, y, h, str, { align = 'left', rot = 0, layer = '0' } = {}) {
  const out = ['0', 'TEXT', '8', layer,
    '10', num(x), '20', num(y), '30', 0,
    '40', num(h), '1', String(str ?? '')];
  if (rot) out.push('50', num(rot));
  if (align === 'center') out.push('72', '1', '11', num(x), '21', num(y), '31', 0);
  return out;
}

function insert(name, x, y) {
  return ['0', 'INSERT', '8', '0', '2', name,
    '10', num(x), '20', num(y), '30', 0];
}

// A 3D polyface mesh (POLYLINE flags 70=64 + VERTEX records + SEQEND).
// verts: [[x,y,z], …]  faces: [[i1,i2,i3,i4?], …] (1-based indices)
function pface(verts, faces, layer) {
  const L = ['0', 'POLYLINE', '8', layer, '66', '1', '70', '64',
    '71', String(verts.length), '72', String(faces.length),
    '10', 0, '20', 0, '30', 0];
  for (const [x, y, z] of verts) {
    L.push('0', 'VERTEX', '8', layer,
      '10', num(x), '20', num(y), '30', num(z), '70', '192');
  }
  for (const f of faces) {
    L.push('0', 'VERTEX', '8', layer, '10', 0, '20', 0, '30', 0, '70', '128',
      '71', String(f[0]), '72', String(f[1]), '73', String(f[2]));
    if (f.length > 3) L.push('74', String(f[3]));
  }
  L.push('0', 'SEQEND', '8', layer);
  return L;
}

// box face pattern used throughout the client reference file
const BOXF = [[1, 2, 3, 4], [5, 6, 7, 8], [1, 2, 6, 5], [4, 3, 7, 8], [1, 4, 8, 5], [2, 3, 7, 6]];

/** Axis-aligned box as one polyface mesh (x across, y deep, z up). */
function box(x0, x1, y0, y1, z0, z1, layer) {
  return pface([
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ], BOXF, layer);
}

/** Assemble a whole document: HEADER + TABLES + (optional) BLOCKS + ENTITIES. */
function dxfDoc(blocks, entities, { units = 1, layers = [] } = {}) {
  const L = [];
  L.push('0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',       // R12
    '9', '$INSUNITS', '70', String(units), // 1 = inches, 4 = millimetres
    '0', 'ENDSEC');
  if (layers.length) {
    L.push('0', 'SECTION', '2', 'TABLES');
    L.push('0', 'TABLE', '2', 'LTYPE', '70', '1',
      '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line',
      '72', '65', '73', '0', '40', '0',
      '0', 'ENDTAB');
    L.push('0', 'TABLE', '2', 'LAYER', '70', String(layers.length));
    for (const name of layers) {
      L.push('0', 'LAYER', '2', name, '70', '0', '62', '7', '6', 'CONTINUOUS');
    }
    L.push('0', 'ENDTAB', '0', 'ENDSEC');
  }
  if (blocks && blocks.length) {
    L.push('0', 'SECTION', '2', 'BLOCKS');
    for (const b of blocks) {
      L.push('0', 'BLOCK', '8', '0', '2', b.name, '70', '0',
        '10', 0, '20', 0, '30', 0, '3', b.name);
      L.push(...b.lines);
      L.push('0', 'ENDBLK', '8', '0');
    }
    L.push('0', 'ENDSEC');
  }
  L.push('0', 'SECTION', '2', 'ENTITIES');
  L.push(...entities);
  L.push('0', 'ENDSEC', '0', 'EOF');
  return L.join('\n');
}

// ---- the 3D cabinet model (millimetres) ------------------------------------
// Conventions copied 1:1 from the client's reference DXF (F1 / F10 / F20):
//   · x across the front, y into the cabinet, z up; everything in mm
//   · carcass = five 18mm panels (sides, back, top, bottom) on layer BODY,
//     drawn in modelspace behind the 22mm front (y from 22 to full depth)
//   · front = BLOCK '<CODE>_FRONT_FACE' on layer FRONT: 22mm end strips
//     full height, a 35mm top-rail box, a 115mm plinth box (floor & tall;
//     45mm bottom rail on wall units), and the door-zone box between them
//   · shaker door = mitred frame mesh on the front plane (80mm stiles &
//     rails), the centre panel recessed to y=5, a surround mesh joining
//     panel to frame, and the door's back plane at y=18
//   · drawer fronts = plain 18mm slabs, faces 175 / 245 / 315 top-to-bottom
//     with 2mm gaps — no shaker detail (spec note)
//   · label = TEXT centred on the footprint, layer LABEL, on the floor plane

const IN = 25.4;
const M = {
  PANEL: 18,          // carcass panel thickness
  FRONT: 22,          // front (door) thickness / end strips
  BACK: 18,           // door back plane / drawer slab thickness
  RECESS: 5,          // shaker centre panel sits 5mm behind the front plane
  TOP: 35,            // top rail box
  PLINTH: 115,        // flush plinth zone (floor & tall)
  WALL_RAIL: 45,      // wall-unit bottom rail
  COUNTER_GAP: 3,     // shadow gap under counterstanding units
  FRAME: 80,          // shaker stiles & rails
  GAP: 2,             // gap between drawer faces
  FACE1: 175, FACE2: 245, FACE3: 315,               // drawer faces, top down
  TALL_UPPER: 1184, TALL_MID: 200, TALL_LOWER: 490, // tall door panels
  LARDER_DOOR: 1100, LARDER_GAP: 35,                // larder-with-drawers
  SHELF: 18,          // shelf thickness (seen through glass / open units)
  C_SHELF1: 382, C_SHELF2: 833.5,                   // counter shelf tops
};

/** Blank-return width (mm) a corner unit adds beside its door. */
function cornerReturnMM(cab) {
  return cab && cab.corner ? (cab.type === 'WALL' ? 10 : 20) * IN : 0;
}

function bottomZone(cab) {
  return cab.type === 'WALL' ? M.WALL_RAIL
    : cab.type === 'COUNTER' ? M.COUNTER_GAP : M.PLINTH;
}

// ---- front-face pieces ----

/** Shaker door leaf dx0..dx1 / z0..z1 with recessed panel zones [pz0,pz1]. */
function shakerDoor(out, dx0, dx1, z0, z1, panels, { glazed = false } = {}) {
  const F = M.FRAME, px0 = dx0 + F, px1 = dx1 - F;
  if (px1 - px0 < 10 || z1 - z0 < 2 * F + 10) {         // too small for a frame
    out.push(...box(dx0, dx1, 0, M.BACK, z0, z1, 'FRONT'));
    return;
  }
  const iz0 = z0 + F, iz1 = z1 - F;
  // mitred frame on the front plane — vertex order AND face table copied from
  // the reference (negative indices = invisible mitre edges in AutoCAD)
  out.push(...pface([
    [dx0, 0, z0], [dx1, 0, z0], [px1, 0, iz0], [px0, 0, iz0],
    [dx1, 0, z1], [px1, 0, iz1], [dx0, 0, z1], [px0, 0, iz1],
  ], [[1, -2, 3, -4], [2, -5, 6, -3], [5, -7, 8, -6], [7, -1, 4, -8]], 'FRONT'));
  // door back plane at y=18, stitched to the front edges (reference face table)
  out.push(...pface([
    [dx0, M.BACK, z0], [dx1, M.BACK, z0], [dx1, M.BACK, z1], [dx0, M.BACK, z1],
    [dx0, 0, z1], [dx1, 0, z1], [dx0, 0, z0], [dx1, 0, z0],
  ], [[1, 2, 3, 4], [5, 6, 3, 4], [7, 8, 2, 1], [7, 5, 4, 1], [8, 6, 3, 2]], 'FRONT'));
  let prevTop = null;
  for (const [pz0, pz1] of panels) {
    if (prevTop !== null && pz0 > prevTop) {            // mid rail between panels
      out.push(...box(px0, px1, 0, M.RECESS, prevTop, pz0, 'FRONT'));
    }
    prevTop = pz1;
    if (glazed) continue;                               // glass: leave the frame open
    // centre panel recessed to y=5 + the surround joining it to the frame
    out.push(...pface([
      [px0, M.RECESS, pz0], [px1, M.RECESS, pz0], [px1, M.RECESS, pz1], [px0, M.RECESS, pz1],
    ], [[1, 2, 3, 4]], 'FRONT'));
    out.push(...pface([
      [px0, 0, pz1], [px1, 0, pz1], [px1, M.RECESS, pz1], [px0, M.RECESS, pz1],
      [px0, 0, pz0], [px1, 0, pz0], [px1, M.RECESS, pz0], [px0, M.RECESS, pz0],
    ], [[1, 2, 3, 4], [5, 6, 7, 8], [5, 1, 4, 8], [6, 2, 3, 7]], 'FRONT'));
  }
}

/** 3-drawer stack of plain slabs: top face exactly 175, rest split 245:315. */
function drawerSlabs(out, x0, x1, zBot, zTop) {
  const rem = zTop - zBot - M.FACE1 - 2 * M.GAP;
  const f3 = rem * M.FACE3 / (M.FACE2 + M.FACE3);
  const f2 = rem - f3;
  const z1 = zBot + f3, z2 = z1 + M.GAP + f2;
  out.push(...box(x0, x1, 0, M.BACK, zBot, z1, 'FRONT'));
  out.push(...box(x0, x1, 0, M.BACK, z1 + M.GAP, z2, 'FRONT'));
  out.push(...box(x0, x1, 0, M.BACK, zTop - M.FACE1, zTop, 'FRONT'));
}

/** Tall two-panel zones (1184 over a 200 rail over 490), hung from the top. */
function tallPanelZones(zTop) {
  const t1 = zTop - M.FRAME, t2 = t1 - M.TALL_UPPER;
  const t3 = t2 - M.TALL_MID, t4 = t3 - M.TALL_LOWER;
  return [[t4, t3], [t2, t1]];   // bottom panel first
}

/** Fixed shelves (18mm boxes spanning the carcass) — visible through glass
 *  or in open units. tops = z of each shelf's top face. */
function shelves(out, W, D, tops) {
  for (const top of tops) {
    out.push(...box(M.FRONT, W - M.FRONT, M.FRONT, D - M.PANEL, top - M.SHELF, top, 'BODY'));
  }
}

/** Everything inside the '<CODE>_FRONT_FACE' block (mm, origin front-left). */
function frontEntities(cab) {
  const out = [];
  const W = cab.w * IN, H = cab.h * IN, D = cab.d * IN;
  const zB = bottomZone(cab), zT = H - M.TOP;
  const isTallDouble = cab.type === 'TALL' && /double/i.test(cab.desc || '');
  const singlePanel = [[zB + M.FRAME, zT - M.FRAME]];

  if (cab.form === 'shelf') {                    // floating shelf: one solid box
    out.push(...box(0, W, 0, D, 0, H, 'BODY'));
    return out;
  }
  if (cab.form === 'dishwasher') {               // door & plinth only — no carcass
    out.push(...box(0, W, 0, M.FRONT, 0, zB, 'FRONT'));            // plinth
    out.push(...box(0, W, 0, M.FRONT, zT, H, 'FRONT'));            // top rail
    shakerDoor(out, 0, W, zB, zT, singlePanel);
    return out;
  }

  // common skeleton: end strips, top rail, plinth / bottom rail, door zone box
  const dx0 = M.FRONT, dx1 = W - M.FRONT;
  out.push(...box(0, M.FRONT, 0, M.FRONT, 0, H, 'FRONT'));
  out.push(...box(dx1, W, 0, M.FRONT, 0, H, 'FRONT'));
  out.push(...box(dx0, dx1, 0, M.FRONT, zT, H, 'FRONT'));
  if (zB >= M.WALL_RAIL - 0.1) out.push(...box(dx0, dx1, 0, M.FRONT, 0, zB, 'FRONT'));
  // door-zone marker: only the two horizontal planes (reference convention —
  // no front face here, the doors/drawers provide it)
  out.push(...pface([
    [dx0, 0, zT], [dx1, 0, zT], [dx1, M.FRONT, zT], [dx0, M.FRONT, zT],
    [dx0, 0, zB], [dx1, 0, zB], [dx1, M.FRONT, zB], [dx0, M.FRONT, zB],
  ], [[1, 2, 3, 4], [5, 6, 7, 8]], 'FRONT'));

  switch (cab.form) {
    case 'door': case 'bin': {
      if (cab.type === 'TALL') shakerDoor(out, dx0, dx1, zB, zT, tallPanelZones(zT));
      else shakerDoor(out, dx0, dx1, zB, zT, singlePanel);
      break;
    }
    case 'glazed': {
      shakerDoor(out, dx0, dx1, zB, zT, singlePanel, { glazed: true });
      const g0 = zB + M.FRAME, g1 = zT - M.FRAME;
      const open = (g1 - g0 - 2 * M.SHELF) / 3;
      shelves(out, W, D, [g1 - open, g1 - 2 * open - M.SHELF]);
      break;
    }
    case 'double': case 'glazedDouble': {
      const mid = W / 2, glazed = cab.form === 'glazedDouble';
      shakerDoor(out, dx0, mid, zB, zT, [[zB + M.FRAME, zT - M.FRAME]], { glazed });
      shakerDoor(out, mid, dx1, zB, zT, [[zB + M.FRAME, zT - M.FRAME]], { glazed });
      if (glazed) {
        const g0 = zB + M.FRAME, g1 = zT - M.FRAME;
        const open = (g1 - g0 - 2 * M.SHELF) / 3;
        shelves(out, W, D, [g1 - open, g1 - 2 * open - M.SHELF]);
      }
      break;
    }
    case 'drawers': {
      drawerSlabs(out, dx0, dx1, zB, zT);
      break;
    }
    case 'larder': case 'housing': case 'ovenHousing': {
      if (isTallDouble) {
        const mid = W / 2;
        shakerDoor(out, dx0, mid, zB, zT, tallPanelZones(zT));
        shakerDoor(out, mid, dx1, zB, zT, tallPanelZones(zT));
      } else shakerDoor(out, dx0, dx1, zB, zT, tallPanelZones(zT));
      break;
    }
    case 'larderDrawers': {                      // 1100 door over a 3-drawer stack
      const doorBot = zT - 2 * M.FRAME - M.LARDER_DOOR;
      const stackTop = doorBot - M.LARDER_GAP;
      const panel = [[doorBot + M.FRAME, zT - M.FRAME]];
      if (isTallDouble) {
        const mid = W / 2;
        shakerDoor(out, dx0, mid, doorBot, zT, [[doorBot + M.FRAME, zT - M.FRAME]]);
        shakerDoor(out, mid, dx1, doorBot, zT, [[doorBot + M.FRAME, zT - M.FRAME]]);
      } else shakerDoor(out, dx0, dx1, doorBot, zT, panel);
      drawerSlabs(out, dx0, dx1, zB, stackTop);
      break;
    }
    case 'corner': {                             // door + full-height blank return
      const R = cornerReturnMM(cab), right = cab.cornerSide === 'right';
      shakerDoor(out, dx0, dx1, zB, zT, singlePanel);
      if (right) out.push(...box(W, W + R, 0, M.FRONT, 0, H, 'FRONT'));
      else out.push(...box(-R, 0, 0, M.FRONT, 0, H, 'FRONT'));
      break;
    }
    case 'open': {                               // fixed shelves, open front
      if (cab.type === 'COUNTER') shelves(out, W, D, [H - M.C_SHELF1, H - M.C_SHELF2]);
      else {
        const open = (zT - zB - 2 * M.SHELF) / 3;
        shelves(out, W, D, [zT - open, zT - 2 * open - M.SHELF]);
      }
      break;
    }
    case 'tray':                                 // open void — skeleton says it all
    default:
      break;
  }
  return out;
}

/** Carcass panels (layer BODY, modelspace) at offset ox/oy — five 18mm boxes. */
function bodyEntities(cab, ox, oy) {
  const out = [];
  if (cab.form === 'shelf' || cab.form === 'dishwasher') return out;
  const W = cab.w * IN, H = cab.h * IN, D = cab.d * IN;
  const P = M.PANEL, F = M.FRONT;
  const b = (x0, x1, y0, y1, z0, z1) => out.push(...box(ox + x0, ox + x1, oy + y0, oy + y1, z0, z1, 'BODY'));
  b(0, P, F, D, 0, H);                    // left side
  b(W - P, W, F, D, 0, H);                // right side
  b(0, W, D - P, D, 0, H);                // back
  b(P, W - P, F, D - P, H - P, H);        // top
  b(P, W - P, F, D - P, 0, P);            // bottom
  return out;
}

/** Plinth-supplied, placeable SKUs that get a block in the library. */
export function librarySKUs() {
  return CATALOGUE.filter((c) => c.placeable && !c.notSupplied && c.w > 0 && c.h > 0);
}

/** ONE file: the whole library as a 3D model, drawn like the client reference:
 *  mm units, BODY carcass in modelspace, '<CODE>_FRONT_FACE' blocks, LABEL text. */
export function buildCabinetLibraryDXF() {
  const skus = librarySKUs();
  const blocks = skus.map((cab) => ({ name: cab.code + '_FRONT_FACE', lines: frontEntities(cab) }));
  const ents = [];
  ents.push(...text(0, 900, 200, 'PL/NTH CABINET LIBRARY - 3D, millimetres', { layer: 'LABEL' }));
  let x = 0, y = 0;
  const GAP = 300, WRAP = 12000, ROW = 2400;
  for (const cab of skus) {
    const W = cab.w * IN, D = cab.d * IN;
    const R = cornerReturnMM(cab);
    const leftReturn = cab.corner && cab.cornerSide !== 'right';
    if (x > 0 && x + W + R > WRAP) { x = 0; y -= ROW; }
    const ox = x + (leftReturn ? R : 0);
    ents.push(...bodyEntities(cab, ox, y));
    ents.push(...insert(cab.code + '_FRONT_FACE', ox, y));
    ents.push(...text(ox + W / 2, y + D / 2, 101.6, cab.code, { align: 'center', layer: 'LABEL' }));
    x += W + R + GAP;
  }
  return dxfDoc(blocks, ents, { units: 4, layers: ['0', 'BODY', 'FRONT', 'LABEL'] });
}

// ---- kitchen plan ----------------------------------------------------------
// Same geometry as the SVG floor plan: room centred on the origin, plan z
// mapped to DXF −y (so the drawing reads the same way up in AutoCAD).

export function buildPlanDXF(state) {
  const r = (state && state.room) || {};
  const W = Number(r.width) || 144, D = Number(r.depth) || 120, T = 4;
  const ents = [];

  // walls: double line, broken at openings, jamb lines closing each gap
  const walls = [
    { wall: 'back', horiz: true, fixed: -D / 2, out: -D / 2 - T, len: W },
    { wall: 'front', horiz: true, fixed: D / 2, out: D / 2 + T, len: W },
    { wall: 'left', horiz: false, fixed: -W / 2, out: -W / 2 - T, len: D },
    { wall: 'right', horiz: false, fixed: W / 2, out: W / 2 + T, len: D },
  ];
  // a wall-run line at offset `fix` from a..b along the wall (horiz: along=x)
  const wallLine = (horiz, fix, a, b) => horiz ? line(a, -fix, b, -fix) : line(fix, -a, fix, -b);
  for (const wd of walls) {
    const room = { width: W, depth: D };
    const gaps = (r.openings || [])
      .filter((o) => (o.wall || 'back') === wd.wall)
      .map((o) => { const c = openingCenter(room, o), w = openingWidth(o, room); return [c - w / 2, c + w / 2]; })
      .sort((p, q) => p[0] - q[0]);
    const segs = [];
    let cur = -wd.len / 2;
    for (const [a, b] of gaps) { if (a > cur) segs.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < wd.len / 2) segs.push([cur, wd.len / 2]);
    for (const [a, b] of segs) {
      ents.push(...wallLine(wd.horiz, wd.fixed, a, b));                       // inner face
      const oa = a <= -wd.len / 2 + 0.01 ? a - T : a;                          // outer face
      const ob = b >= wd.len / 2 - 0.01 ? b + T : b;                           // reaches corners
      ents.push(...wallLine(wd.horiz, wd.out, oa, ob));
    }
    for (const [a, b] of gaps) {
      for (const e of [a, b]) {
        ents.push(...(wd.horiz ? line(e, -wd.fixed, e, -wd.out) : line(wd.fixed, -e, wd.out, -e)));
      }
    }
  }

  // cabinet footprints (rotation-aware) + centred code TEXT
  for (const it of (state && state.items) || []) {
    const cab = getCab(it.code);
    if (!cab || !cab.placeable) continue;
    const th = (it.rotDeg || 0) * Math.PI / 180;
    const fx = Math.sin(th), fz = Math.cos(th);   // front (into the room)
    const wx = Math.cos(th), wz = -Math.sin(th);  // width axis
    const w = cab.w, d = cab.d;
    const corner = (sw, sd) => [
      it.x + wx * (sw * w / 2) + fx * (sd * d / 2),
      -(it.z + wz * (sw * w / 2) + fz * (sd * d / 2)),   // plan z → DXF −y
    ];
    const pts = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (let i = 0; i < 4; i++) {
      const p = pts[i], q = pts[(i + 1) % 4];
      ents.push(...line(p[0], p[1], q[0], q[1]));
    }
    const rot = (((it.rotDeg || 0) % 180) + 180) % 180;
    ents.push(...text(it.x, -it.z, 3, cab.baseCode || cab.code,
      { align: 'center', rot: Math.abs(rot - 90) < 1 ? 90 : 0 }));
  }

  return dxfDoc([], ents, { units: 1 });
}
