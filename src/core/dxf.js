// dxf.js — a PURE, minimal DXF (ASCII) writer for AutoCAD hand-off.
//
// Two exports:
//   buildCabinetLibraryDXF() — every Plinth SKU as a 3D model, drawn to the
//     client's reference file ('PLINTH F1 F10 F20') but in INCH units (the
//     catalogue's own units): polyface-mesh boxes, carcass panels on layer
//     BODY in modelspace, the shaker front as a named BLOCK '<CODE>_FRONT_FACE'
//     on layer FRONT, and a centred TEXT code on layer LABEL.
//   buildPlanDXF(state, {walls}) — the current kitchen as a 3D model (inches):
//     optional double-line wall plan (PLAN layer; pass walls:false for a
//     cabinets-only file that drops into the client's own drawing), and every
//     placed cabinet as ONE INSERT of its self-contained '<CODE>_UNIT' block
//     (front faces + carcass + floor-plan footprint + label all inside the
//     block), rotated + lifted to its mount height. One insert per cabinet
//     means CAD users can select and MOVE a whole cabinet as a single object
//     — in Revit, Partial Explode the import and each cabinet is movable.
//     Appliances/sinks are left as honest gaps. Top view reads as the plan,
//     orbit shows the whole kitchen in 3D.
//
// R12 ASCII only: LINE, TEXT, INSERT and POLYLINE polyface meshes (all R12
// citizens — LWPOLYLINE is R14+ so it is never used). No DOM, no Three.js —
// testable in plain node.

import { CATALOGUE, getCab, getFinish, BRAND, WORKTOP_OPTIONS } from './catalogue.js';
import { MOUNT, counterShelfTops, SURFACE_Y, WORKTOP_SLAB, mmToIn } from './units.js';
import { planWorktopSlabs } from './worktop-plan.js';
import { computeFillers } from './fillers.js';
import { planCornice } from './cornice.js';
import { FLOORS, WALLS, hexOf } from './roomstyle.js';
import { ovenSeat } from './ovenseat.js';
import { openingCenter, openingWidth } from './openings.js';

// ---- low-level group-code helpers ----------------------------------------
// A DXF ASCII file is strictly alternating lines: group code, then value.
// We build flat arrays of those lines and join at the end.
//
// OUTPUT UNITS ARE INCHES ($INSUNITS 1) — the catalogue is authored in inches
// and the client works in them. Construction detail is still CALCULATED in
// real millimetres (22mm strips, 5mm recess, 115mm plinth…) and converted at
// emission by these helpers, so every internal function keeps working in mm.

const K = 1 / 25.4;   // mm → inches at emission

function num(v) {
  const n = Number(v);
  return isFinite(n) ? Math.round(n * 1000) / 1000 : 0; // never emit NaN/Inf
}

// Every entity carries a HANDLE ('%H%', numbered when the document is assembled) and an OWNER
// ('%O%': the block record it lives in) — the DXF R2000 (AC1015) shape. R2000 is what lets the
// EXACT finish colour travel (group 420 is official from R2000; an R12 file only had the 256
// AutoCAD indices, which turned oak yellow in SketchUp, her screenshot 2026-09-25).
const ENT = (type, layer) => ['0', type, '5', '%H%', '330', '%O%', '100', 'AcDbEntity', '8', layer];

function line(x1, y1, x2, y2, layer = '0', z = 0) {
  return [...ENT('LINE', layer), '100', 'AcDbLine',
    '10', num(x1 * K), '20', num(y1 * K), '30', num(z * K),
    '11', num(x2 * K), '21', num(y2 * K), '31', num(z * K)];
}

function text(x, y, h, str, { align = 'left', rot = 0, layer = '0', z = 0 } = {}) {
  const out = [...ENT('TEXT', layer), '100', 'AcDbText',
    '10', num(x * K), '20', num(y * K), '30', num(z * K),
    '40', num(h * K), '1', String(str ?? '')];
  if (rot) out.push('50', num(rot));
  if (align === 'center') out.push('72', '1', '11', num(x * K), '21', num(y * K), '31', num(z * K));
  out.push('100', 'AcDbText');
  return out;
}

function insert(name, x, y, { z = 0, rot = 0 } = {}) {
  const out = [...ENT('INSERT', '0'), '100', 'AcDbBlockReference', '2', name,
    '10', num(x * K), '20', num(y * K), '30', num(z * K)];
  if (rot) out.push('50', num(rot));
  return out;
}

// A 3D polyface mesh (POLYLINE flags 70=64 + VERTEX records + SEQEND).
// verts: [[x,y,z], …]  faces: [[i1,i2,i3,i4?], …] (1-based indices)
function pface(verts, faces, layer) {
  const L = [...ENT('POLYLINE', layer), '100', 'AcDbPolyFaceMesh', '66', '1',
    '10', 0, '20', 0, '30', 0, '70', '64',
    '71', String(verts.length), '72', String(faces.length)];
  for (const [x, y, z] of verts) {
    L.push(...ENT('VERTEX', layer), '100', 'AcDbVertex', '100', 'AcDbPolyFaceMeshVertex',
      '10', num(x * K), '20', num(y * K), '30', num(z * K), '70', '192');
  }
  // face records carry ONLY AcDbFaceRecord (no AcDbVertex marker), and the SEQEND is owned by
  // the POLYLINE itself ('%P%') — exactly as AutoCAD writes them; SketchUp's importer dropped
  // every mesh that had the extra marker (her third import 2026-09-25: lines only)
  for (const f of faces) {
    L.push(...ENT('VERTEX', layer), '100', 'AcDbFaceRecord',
      '10', 0, '20', 0, '30', 0, '70', '128',
      '71', String(f[0]), '72', String(f[1]), '73', String(f[2]));
    if (f.length > 3) L.push('74', String(f[3]));
  }
  L.push('0', 'SEQEND', '5', '%H%', '330', '%P%', '100', 'AcDbEntity', '8', layer);
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

// ---- colour ------------------------------------------------------------------
// COLOURS CARRY ACROSS (her rule 2026-09-25: "when anyone exports the colors should carry
// across, in Revit or AutoCAD or whatever they use"). Entities draw BYLAYER, and every layer
// carries its colour twice: the nearest AutoCAD Color Index (group 62, what an R12 reader
// and every DXF importer understands) AND the exact 24-bit true colour (group 420, which
// AutoCAD 2004+ and SketchUp read and prefer). One FRONT layer per painted finish in the
// file, BODY the oak carcass, so a FRONT-Sage layer really is Sage in the drawing.
const ACI_RGB = [255,0,0,255,255,0,0,255,0,0,255,255,0,0,255,255,0,255,255,255,255,128,128,128,192,192,192,255,0,0,255,127,127,165,0,0,165,82,82,127,0,0,127,63,63,76,0,0,76,38,38,38,0,0,38,19,19,255,63,0,255,159,127,165,41,0,165,103,82,127,31,0,127,79,63,76,19,0,76,47,38,38,9,0,38,23,19,255,127,0,255,191,127,165,82,0,165,124,82,127,63,0,127,95,63,76,38,0,76,57,38,38,19,0,38,28,19,255,191,0,255,223,127,165,124,0,165,145,82,127,95,0,127,111,63,76,57,0,76,66,38,38,28,0,38,33,19,255,255,0,255,255,127,165,165,0,165,165,82,127,127,0,127,127,63,76,76,0,76,76,38,38,38,0,38,38,19,191,255,0,223,255,127,124,165,0,145,165,82,95,127,0,111,127,63,57,76,0,66,76,38,28,38,0,33,38,19,127,255,0,191,255,127,82,165,0,124,165,82,63,127,0,95,127,63,38,76,0,57,76,38,19,38,0,28,38,19,63,255,0,159,255,127,41,165,0,103,165,82,31,127,0,79,127,63,19,76,0,47,76,38,9,38,0,23,38,19,0,255,0,127,255,127,0,165,0,82,165,82,0,127,0,63,127,63,0,76,0,38,76,38,0,38,0,19,38,19,0,255,63,127,255,159,0,165,41,82,165,103,0,127,31,63,127,79,0,76,19,38,76,47,0,38,9,19,88,23,0,255,127,127,255,191,0,165,82,82,165,124,0,127,63,63,127,95,0,76,38,38,76,57,0,38,19,19,88,28,0,255,191,127,255,223,0,165,124,82,165,145,0,127,95,63,127,111,0,76,57,38,76,66,0,38,28,19,88,88,0,255,255,127,255,255,0,165,165,82,165,165,0,127,127,63,127,127,0,76,76,38,76,76,0,38,38,19,88,88,0,191,255,127,223,255,0,124,165,82,145,165,0,95,127,63,111,127,0,57,76,38,66,126,0,28,38,19,88,88,0,127,255,127,191,255,0,82,165,82,124,165,0,63,127,63,95,127,0,38,76,38,57,126,0,19,38,19,28,88,0,63,255,127,159,255,0,41,165,82,103,165,0,31,127,63,79,127,0,19,76,38,47,126,0,9,38,19,23,88,0,0,255,127,127,255,0,0,165,82,82,165,0,0,127,63,63,127,0,0,76,38,38,126,0,0,38,19,19,88,63,0,255,159,127,255,41,0,165,103,82,165,31,0,127,79,63,127,19,0,76,47,38,126,9,0,38,23,19,88,127,0,255,191,127,255,82,0,165,124,82,165,63,0,127,95,63,127,38,0,76,57,38,126,19,0,38,28,19,88,191,0,255,223,127,255,124,0,165,145,82,165,95,0,127,111,63,127,57,0,76,66,38,76,28,0,38,88,19,88,255,0,255,255,127,255,165,0,165,165,82,165,127,0,127,127,63,127,76,0,76,76,38,76,38,0,38,88,19,88,255,0,191,255,127,223,165,0,124,165,82,145,127,0,95,127,63,111,76,0,57,76,38,66,38,0,28,88,19,88,255,0,127,255,127,191,165,0,82,165,82,124,127,0,63,127,63,95,76,0,38,76,38,57,38,0,19,88,19,28,255,0,63,255,127,159,165,0,41,165,82,103,127,0,31,127,63,79,76,0,19,76,38,47,38,0,9,88,19,23,51,51,51,91,91,91,132,132,132,173,173,173,214,214,214,255,255,255];
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return Number.isFinite(v) ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : [255, 255, 255];
}
/** The AutoCAD Color Index (1-255) nearest a hex colour. */
export function nearestACI(hex) {
  const [r, g, b] = hexToRgb(hex);
  let best = 7, bd = Infinity;
  for (let i = 0; i < ACI_RGB.length; i += 3) {
    const d = (ACI_RGB[i] - r) ** 2 + (ACI_RGB[i + 1] - g) ** 2 + (ACI_RGB[i + 2] - b) ** 2;
    if (d < bd) { bd = d; best = i / 3 + 1; }
  }
  return best;
}
/** DXF true colour (group 420): 0x00RRGGBB as a decimal integer. */
export function trueColour(hex) { const [r, g, b] = hexToRgb(hex); return (r << 16) | (g << 8) | b; }
/** A layer record with a colour: { name, hex, ltype? }. */
const coloured = (name, hex, ltype) => ({ name, hex, ...(ltype ? { ltype } : {}) });
/** Layer name for a painted finish: FRONT for the kitchen's own, FRONT-<Name> for a cabinet painted differently. */
const finishLayer = (name, main) => (name === main ? 'FRONT' : 'FRONT-' + String(name || 'Finish').replace(/[^A-Za-z0-9]+/g, ''));
const finishHex = (name) => (getFinish(name) || {}).hex || '#F7F4EB';

/** Assemble a whole document — DXF R2000 (AC1015): HEADER, CLASSES, TABLES (VPORT, LTYPE,
 *  LAYER, STYLE, VIEW, UCS, APPID, DIMSTYLE, BLOCK_RECORD), BLOCKS (*Model_Space, *Paper_Space,
 *  ours), ENTITIES, OBJECTS. blocks = [{ name, lines }], entities = lines; every entity line
 *  array carries '%H%' / '%O%' placeholders that are numbered here. layers: names, or
 *  { name, hex?, ltype?: 'DASHED' }. */
function dxfDoc(blocks, entities, { units = 1, layers = [] } = {}) {
  let next = 0x100;
  const H = () => (next++).toString(16).toUpperCase();
  // fixed handles for the skeleton objects
  const ROOT = 'C', GROUPS = 'D', PLOTSTYLES = 'E', NORMAL = 'F';
  const rec = (name) => ({ name, h: H() });
  const tblH = { VPORT: H(), LTYPE: H(), LAYER: H(), STYLE: H(), VIEW: H(), UCS: H(), APPID: H(), DIMSTYLE: H(), BLOCK_RECORD: H() };
  const msRec = rec('*Model_Space'), psRec = rec('*Paper_Space');
  const userRecs = (blocks || []).map((bk) => rec(bk.name));
  // number the placeholders in one entity stream, all owned by `owner`
  const fill = (lines, owner) => {
    const out = [];
    let lastPoly = owner;                                   // a SEQEND is owned by its POLYLINE
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = lines[i], val = lines[i + 1];
      let v = val;
      if (val === '%H%') { v = H(); if (lines[i - 2] === '0' && lines[i - 1] === 'POLYLINE') lastPoly = v; }
      else if (val === '%O%') v = owner;
      else if (val === '%P%') v = lastPoly;
      out.push(code, v);
    }
    return out;
  };
  const L = [];
  const push = (...v) => { for (const x of v) L.push(x); };
  // HEADER
  push('0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015', '9', '$HANDSEED', '5', '%SEED%',
    '9', '$INSUNITS', '70', String(units), '9', '$DWGCODEPAGE', '3', 'ANSI_1252', '0', 'ENDSEC');
  push('0', 'SECTION', '2', 'CLASSES', '0', 'ENDSEC');
  // TABLES
  push('0', 'SECTION', '2', 'TABLES');
  push('0', 'TABLE', '2', 'VPORT', '5', tblH.VPORT, '330', '0', '100', 'AcDbSymbolTable', '70', '1',
    '0', 'VPORT', '5', H(), '330', tblH.VPORT, '100', 'AcDbSymbolTableRecord', '100', 'AcDbViewportTableRecord', '2', '*Active', '70', '0',
    '10', '0', '20', '0', '11', '1', '21', '1', '12', '0', '22', '0', '13', '0', '23', '0', '14', '10', '24', '10', '15', '10', '25', '10',
    '16', '1', '26', '-1', '36', '1', '17', '0', '27', '0', '37', '0', '40', '200', '41', '1.5', '42', '50', '43', '0', '44', '0',
    '50', '0', '51', '0', '71', '0', '72', '100', '73', '1', '74', '3', '75', '0', '76', '0', '77', '0', '78', '0', '281', '0', '65', '1',
    '110', '0', '120', '0', '130', '0', '111', '1', '121', '0', '131', '0', '112', '0', '122', '1', '132', '0', '79', '0', '146', '0',
    '0', 'ENDTAB');
  const lt = (name, desc, elems) => {
    push('0', 'LTYPE', '5', H(), '330', tblH.LTYPE, '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord', '2', name, '70', '0', '3', desc,
      '72', '65', '73', String(elems.length), '40', String(elems.reduce((t, e) => t + Math.abs(e), 0)));
    for (const e of elems) push('49', String(e), '74', '0');
  };
  push('0', 'TABLE', '2', 'LTYPE', '5', tblH.LTYPE, '330', '0', '100', 'AcDbSymbolTable', '70', '4');
  lt('ByBlock', '', []); lt('ByLayer', '', []); lt('CONTINUOUS', 'Solid line', []); lt('DASHED', 'Dashed __ __ __', [0.5, -0.25]);
  push('0', 'ENDTAB');
  push('0', 'TABLE', '2', 'LAYER', '5', tblH.LAYER, '330', '0', '100', 'AcDbSymbolTable', '70', String(Math.max(1, layers.length)));
  const names = layers.length ? layers : ['0'];
  for (const l of names) {
    const name = typeof l === 'string' ? l : l.name;
    const ltype = (typeof l === 'object' && l.ltype) || 'CONTINUOUS';
    const hex = typeof l === 'object' ? l.hex : null;
    push('0', 'LAYER', '5', H(), '330', tblH.LAYER, '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord',
      '2', name, '70', '0', '62', String(hex ? nearestACI(hex) : 7));
    if (hex) push('420', String(trueColour(hex)));                 // the exact colour: what AutoCAD 2004+, SketchUp and Revit read
    push('6', ltype, '370', '-3', '390', NORMAL);
  }
  push('0', 'ENDTAB');
  push('0', 'TABLE', '2', 'STYLE', '5', tblH.STYLE, '330', '0', '100', 'AcDbSymbolTable', '70', '1',
    '0', 'STYLE', '5', H(), '330', tblH.STYLE, '100', 'AcDbSymbolTableRecord', '100', 'AcDbTextStyleTableRecord',
    '2', 'Standard', '70', '0', '40', '0', '41', '1', '50', '0', '71', '0', '42', '2.5', '3', 'txt', '4', '', '0', 'ENDTAB');
  push('0', 'TABLE', '2', 'VIEW', '5', tblH.VIEW, '330', '0', '100', 'AcDbSymbolTable', '70', '0', '0', 'ENDTAB');
  push('0', 'TABLE', '2', 'UCS', '5', tblH.UCS, '330', '0', '100', 'AcDbSymbolTable', '70', '0', '0', 'ENDTAB');
  push('0', 'TABLE', '2', 'APPID', '5', tblH.APPID, '330', '0', '100', 'AcDbSymbolTable', '70', '1',
    '0', 'APPID', '5', H(), '330', tblH.APPID, '100', 'AcDbSymbolTableRecord', '100', 'AcDbRegAppTableRecord', '2', 'ACAD', '70', '0', '0', 'ENDTAB');
  push('0', 'TABLE', '2', 'DIMSTYLE', '5', tblH.DIMSTYLE, '330', '0', '100', 'AcDbSymbolTable', '70', '0', '100', 'AcDbDimStyleTable', '71', '0', '0', 'ENDTAB');
  push('0', 'TABLE', '2', 'BLOCK_RECORD', '5', tblH.BLOCK_RECORD, '330', '0', '100', 'AcDbSymbolTable', '70', String(2 + userRecs.length));
  for (const r of [msRec, psRec, ...userRecs]) push('0', 'BLOCK_RECORD', '5', r.h, '330', tblH.BLOCK_RECORD, '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '2', r.name, '340', '0');
  push('0', 'ENDTAB', '0', 'ENDSEC');
  // BLOCKS
  push('0', 'SECTION', '2', 'BLOCKS');
  const blockShell = (r, paper, lines) => {
    push('0', 'BLOCK', '5', H(), '330', r.h, '100', 'AcDbEntity');
    if (paper) push('67', '1');
    push('8', '0', '100', 'AcDbBlockBegin', '2', r.name, '70', '0', '10', '0', '20', '0', '30', '0', '3', r.name, '1', '');
    if (lines) for (const x of fill(lines, r.h)) L.push(x);
    push('0', 'ENDBLK', '5', H(), '330', r.h, '100', 'AcDbEntity');
    if (paper) push('67', '1');
    push('8', '0', '100', 'AcDbBlockEnd');
  };
  blockShell(msRec, false, null);
  blockShell(psRec, true, null);
  (blocks || []).forEach((bk, i) => blockShell(userRecs[i], false, bk.lines));
  push('0', 'ENDSEC');
  // ENTITIES (modelspace)
  push('0', 'SECTION', '2', 'ENTITIES');
  for (const x of fill(entities, msRec.h)) L.push(x);       // never spread: the cabinet library runs past the argument limit
  push('0', 'ENDSEC');
  // OBJECTS: the root dictionary, groups, and the plot-style dictionary the layers point at
  push('0', 'SECTION', '2', 'OBJECTS',
    '0', 'DICTIONARY', '5', ROOT, '330', '0', '100', 'AcDbDictionary', '281', '1', '3', 'ACAD_GROUP', '350', GROUPS, '3', 'ACAD_PLOTSTYLENAME', '350', PLOTSTYLES,
    '0', 'DICTIONARY', '5', GROUPS, '330', ROOT, '100', 'AcDbDictionary', '281', '1',
    '0', 'ACDBDICTIONARYWDFLT', '5', PLOTSTYLES, '330', ROOT, '100', 'AcDbDictionary', '281', '1', '3', 'Normal', '350', NORMAL, '100', 'AcDbDictionaryWithDefault', '340', NORMAL,
    '0', 'ACDBPLACEHOLDER', '5', NORMAL, '330', PLOTSTYLES,
    '0', 'ENDSEC', '0', 'EOF');
  const seed = (next + 1).toString(16).toUpperCase();
  return L.map((x) => (x === '%SEED%' ? seed : x)).join('\n');
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
  const twoPanel = panels.length === 2 && panels[1][0] > panels[0][1];
  if (twoPanel) {
    // a TWO-PANEL door: the mid rail is PART of the frame face, one polyface, its joins to the
    // stiles marked invisible like the mitres (her SketchUp screenshot 2026-09-25: a separate
    // rail block left joint lines across the stiles). Only the rail's top and bottom edges show,
    // where the face steps down into the recessed panels.
    const rb = panels[0][1], rt = panels[1][0];
    out.push(...pface([
      [dx0, 0, z0], [dx1, 0, z0], [px1, 0, iz0], [px0, 0, iz0],           // 1-4  bottom rail
      [dx1, 0, z1], [px1, 0, iz1], [dx0, 0, z1], [px0, 0, iz1],           // 5-8  top rail
      [dx0, 0, rb], [px0, 0, rb], [px1, 0, rb], [dx1, 0, rb],             // 9-12 rail bottom line
      [dx0, 0, rt], [px0, 0, rt], [px1, 0, rt], [dx1, 0, rt],             // 13-16 rail top line
    ], [
      [1, -2, 3, -4], [5, -7, 8, -6],                                     // bottom + top rails (mitres invisible)
      [-1, 4, -10, 9], [-13, 14, -8, 7],                                  // left stile, below and above the rail
      [2, -12, 11, -3], [16, -5, 6, -15],                                 // right stile, below and above
      [-9, -10, -14, 13], [10, -11, 15, -14], [-11, 12, -16, -15],        // the rail: over the stiles (all joins hidden), the middle (steps show)
    ], 'FRONT'));
  } else {
    // mitred frame on the front plane — vertex order AND face table copied from
    // the reference (negative indices = invisible mitre edges in AutoCAD)
    out.push(...pface([
      [dx0, 0, z0], [dx1, 0, z0], [px1, 0, iz0], [px0, 0, iz0],
      [dx1, 0, z1], [px1, 0, iz1], [dx0, 0, z1], [px0, 0, iz1],
    ], [[1, -2, 3, -4], [2, -5, 6, -3], [5, -7, 8, -6], [7, -1, 4, -8]], 'FRONT'));
  }
  // door back plane at y=18, stitched to the front edges (reference face table)
  out.push(...pface([
    [dx0, M.BACK, z0], [dx1, M.BACK, z0], [dx1, M.BACK, z1], [dx0, M.BACK, z1],
    [dx0, 0, z1], [dx1, 0, z1], [dx0, 0, z0], [dx1, 0, z0],
  ], [[1, 2, 3, 4], [5, 6, 3, 4], [7, 8, 2, 1], [7, 5, 4, 1], [8, 6, 3, 2]], 'FRONT'));
  let prevTop = null;
  for (const [pz0, pz1] of panels) {
    if (prevTop !== null && pz0 > prevTop && !twoPanel) { // mid rail between panels (3+ zones): a bar in the recess
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
  // a full-height glazed door: two panes either side of an 80mm centre glazing bar
  const midZ = (zB + zT) / 2, glazedPanels = cab.high ? [[zB + M.FRAME, midZ - M.FRAME / 2], [midZ + M.FRAME / 2, zT - M.FRAME]] : singlePanel;   // glazed or plain: a full-height door has two panels

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
      else shakerDoor(out, dx0, dx1, zB, zT, glazedPanels);           // a full-height upper: two panels about an 80mm centre rail
      break;
    }
    case 'glazed': {
      shakerDoor(out, dx0, dx1, zB, zT, glazedPanels, { glazed: true });
      const g0 = zB + M.FRAME, g1 = zT - M.FRAME;
      const open = (g1 - g0 - 2 * M.SHELF) / 3;
      shelves(out, W, D, [g1 - open, g1 - 2 * open - M.SHELF]);
      break;
    }
    case 'double': case 'glazedDouble': {
      const mid = W / 2, glazed = cab.form === 'glazedDouble';
      shakerDoor(out, dx0, mid, zB, zT, glazedPanels, { glazed });
      shakerDoor(out, mid, dx1, zB, zT, glazedPanels, { glazed });
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
    case 'leg': out.push(...box(0, W, 0, D, 0, H, 'BODY')); break;   // the end leg: one painted upright
    case 'ovenBase': {                           // a drawer slab at the bottom; the oven aperture stays open
      const seat = ovenSeat(cab), drawTop = zB + seat.drawH * 25.4, railBot = seat.y0 * 25.4 - M.PANEL;
      out.push(...box(dx0, dx1, 0, M.BACK, zB, drawTop - M.GAP, 'FRONT'));
      out.push(...box(dx0, dx1, 0, M.BACK, railBot, seat.y0 * 25.4, 'FRONT'));           // the rail the oven stands on
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
      if (cab.pair) { shakerDoor(out, dx0, W / 2, zB, zT, glazedPanels); shakerDoor(out, W / 2, dx1, zB, zT, glazedPanels); }   // a double corner: a pair
      else shakerDoor(out, dx0, dx1, zB, zT, glazedPanels);       // one panel, or two about the 80mm rail when full height
      if (right) out.push(...box(W, W + R, 0, M.FRONT, 0, H, 'FRONT'));
      else out.push(...box(-R, 0, 0, M.FRONT, 0, H, 'FRONT'));
      break;
    }
    case 'open': {                               // fixed shelves, open front
      if (cab.type === 'COUNTER') shelves(out, W, D, counterShelfTops((H - M.PANEL) / 25.4).map((t) => H - t * 25.4));   // 400mm up, then equal (core/units.js)
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

/** Carcass panels as LOCAL boxes [x0,x1,y0,y1,z0,z1] (mm) — five 18mm panels. */
function bodyBoxes(cab) {
  if (cab.form === 'shelf' || cab.form === 'dishwasher') return [];
  const W = cab.w * IN, H = cab.h * IN, D = cab.d * IN;
  const P = M.PANEL, F = M.FRONT;
  return [
    [0, P, F, D, 0, H],                   // left side
    [W - P, W, F, D, 0, H],               // right side
    [0, W, D - P, D, 0, H],               // back
    [P, W - P, F, D - P, H - P, H],       // top
    [P, W - P, F, D - P, 0, P],           // bottom
  ];
}

/** Carcass panels (layer BODY, modelspace) at offset ox/oy — five 18mm boxes. */
function bodyEntities(cab, ox, oy) {
  const out = [];
  for (const [x0, x1, y0, y1, z0, z1] of bodyBoxes(cab)) {
    out.push(...box(ox + x0, ox + x1, oy + y0, oy + y1, z0, z1, 'BODY'));
  }
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
  ents.push(...text(0, 900, 200, 'PL/NTH CABINET LIBRARY - 3D, inches', { layer: 'LABEL' }));
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
  return dxfDoc(blocks, ents, { units: 1, layers: ['0', coloured('BODY', BRAND.oak), coloured('FRONT', finishHex('Ghost')), coloured('LABEL', '#555555')] });
}

// ---- kitchen 3D model -------------------------------------------------------
// Same layout as the SVG floor plan — room centred on the origin, plan z
// mapped to DXF −y (top view reads the same way up in AutoCAD) — but drawn in
// MILLIMETRES with every cabinet as its full 3D model, so orbiting the drawing
// shows the kitchen in 3D exactly like the cabinet library file.

// mount heights (inches, z of the unit's underside) — mirrors models/cabinet.js
// MOUNT (not imported: dxf.js stays free of Three.js so it runs in plain node)
const MOUNT_IN = MOUNT;

/** Mount height (mm) of a cabinet's underside — mirrors models/cabinet.js. */
function mountMM(cab) {
  return (typeof cab.mountY === 'number' ? cab.mountY : (MOUNT_IN[cab.type] ?? 0)) * IN;
}

/** EVERYTHING that makes up one placed cabinet, in block-local mm: front
 *  faces, carcass panels, the floor-plan footprint (dropped to the floor
 *  plane, dashed for hung units) and the code label. One self-contained
 *  block per SKU means ONE insert per cabinet in modelspace, so CAD users
 *  can select and move a whole cabinet as a single object — the point of
 *  handing them a DXF (client-reported: Revit/AutoCAD cabinets must move). */
function unitEntities(cab, frontLayer = 'FRONT') {
  const out = frontEntities(cab);
  if (frontLayer !== 'FRONT') for (let i = 0; i + 1 < out.length; i++) if (out[i] === '8' && out[i + 1] === 'FRONT') out[i + 1] = frontLayer;   // this cabinet's own paint
  for (const [x0, x1, y0, y1, z0, z1] of bodyBoxes(cab)) {
    out.push(...box(x0, x1, y0, y1, z0, z1, 'BODY'));
  }
  const W = cab.w * IN, D = cab.d * IN, zOff = mountMM(cab);
  const hung = cab.type === 'WALL' || cab.type === 'COUNTER';
  const fpLayer = hung ? 'PLAN-UPPER' : 'PLAN';
  const pts = [[0, 0], [W, 0], [W, D], [0, D]];
  for (let i = 0; i < 4; i++) {
    const p = pts[i], q = pts[(i + 1) % 4];
    out.push(...line(p[0], p[1], q[0], q[1], fpLayer, -zOff));
  }
  // label on the floor plane; hung units read at their back quarter so the
  // two label rows never collide where uppers hang over a base run
  out.push(...text(W / 2, hung ? D * 0.75 : D / 2, 63.5, cab.baseCode || cab.code,
    { align: 'center', layer: 'LABEL', z: -zOff }));
  return out;
}

/** The 3D meshes of one cabinet, block-local mm (origin front-left-bottom, +X across the front,
 *  +Y front -> back, +Z up): [{ layer, verts:[[x,y,z]], faces:[[i,..]] (1-based), closed }].
 *  Parsed from the very entity stream the DXF ships, so the IFC carries the SAME fronts
 *  (her friend's Revit screenshots 2026-09-25: "why don't the cabinets have the door style"). */
export function unitMeshes(cab) {
  const lines = unitEntities(cab);
  const out = [];
  let cur = null, ent = null, rec = null;
  const flush = () => { if (ent === 'VERTEX' && rec) { if (rec.face) cur.faces.push(rec.face.map(Math.abs)); else cur.verts.push([rec.x || 0, rec.y || 0, rec.z || 0]); } rec = null; };
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i], val = lines[i + 1];
    if (code === '0') {
      flush();
      ent = val;
      if (val === 'POLYLINE') { cur = { layer: '0', verts: [], faces: [] }; out.push(cur); }
      else if (val === 'VERTEX') rec = {};
      else if (val === 'SEQEND') { cur = null; }
      continue;
    }
    if (ent === 'POLYLINE' && code === '8') cur.layer = val;
    if (ent !== 'VERTEX' || !rec) continue;
    if (code === '10') rec.x = Number(val) * IN; else if (code === '20') rec.y = Number(val) * IN; else if (code === '30') rec.z = Number(val) * IN;
    else if (code === '70' && val === '128') rec.face = [];
    else if (rec.face && (code === '71' || code === '72' || code === '73' || code === '74')) rec.face.push(Number(val));
  }
  flush();
  for (const m of out) m.closed = m.verts.length === 8 && m.faces.length === 6;   // a box; frames and stitched backs are open shells
  return out;
}

export function buildPlanDXF(state, { walls = true } = {}) {
  const r = (state && state.room) || {};
  const W = Number(r.width) || 144, D = Number(r.depth) || 120, T = 4;
  const ents = [];

  // wall plan on the floor: double line (mm), broken at openings, jambs closing
  // each gap — kept 2D so the top view still reads as a clean floor plan.
  // Skipped entirely for the cabinets-only variant (walls: false).
  const wallDefs = !walls ? [] : [
    { wall: 'back', horiz: true, fixed: -D / 2, out: -D / 2 - T, len: W },
    { wall: 'front', horiz: true, fixed: D / 2, out: D / 2 + T, len: W },
    { wall: 'left', horiz: false, fixed: -W / 2, out: -W / 2 - T, len: D },
    { wall: 'right', horiz: false, fixed: W / 2, out: W / 2 + T, len: D },
  ];
  // a wall-run line at offset `fix` from a..b along the wall (horiz: along=x)
  const wallLine = (horiz, fix, a, b) =>
    horiz ? line(a * IN, -fix * IN, b * IN, -fix * IN, 'PLAN') : line(fix * IN, -a * IN, fix * IN, -b * IN, 'PLAN');
  for (const wd of wallDefs) {
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
        ents.push(...(wd.horiz
          ? line(e * IN, -wd.fixed * IN, e * IN, -wd.out * IN, 'PLAN')
          : line(wd.fixed * IN, -e * IN, wd.out * IN, -e * IN, 'PLAN')));
      }
    }
  }

  // one self-contained '<CODE>_UNIT' block per DISTINCT supplied cabinet in
  // the design — front faces, carcass, footprint and label all live INSIDE
  // the block, so each placed cabinet below is a single movable INSERT.
  // Appliances and sinks are NOT Plinth products — they are left out entirely,
  // so the model shows honest GAPS where the client's own appliances go.
  // ...and per PAINT: a cabinet painted differently from the kitchen gets its own block on its
  // own FRONT-<Finish> layer, so the colour it was designed in is the colour it arrives in
  const mainFinish = (state && state.finish) || 'Ghost';
  const finishOf = (it) => (it.finish && getFinish(it.finish) ? it.finish : mainFinish);
  const blockName = (cab, fin) => cab.code + '_UNIT' + (fin === mainFinish ? '' : '-' + finishLayer(fin, mainFinish).slice(6));
  const used = new Map(), finishes = new Set([mainFinish]);
  for (const it of (state && state.items) || []) {
    const cab = getCab(it.code);
    if (!cab || !cab.placeable || cab.notSupplied) continue;
    const fin = finishOf(it); finishes.add(fin);
    used.set(blockName(cab, fin), { cab, fin });
  }
  const blocks = [...used.entries()].map(([name, { cab, fin }]) => ({ name, lines: unitEntities(cab, finishLayer(fin, mainFinish)) }));

  // place every cabinet: ONE block INSERT, rotated + lifted to mount height
  const insertAt = (name, w, d, it, z) => {
    const th = (it.rotDeg || 0) * Math.PI / 180;
    const fx = Math.sin(th), fz = Math.cos(th);        // front (into the room), plan coords
    // block axes in DXF coords (plan z → −y): local +X runs across the front,
    // local +Y runs from the front plane into the cabinet
    const v = [-fx, fz];                               // block +Y (front → back)
    const u = [fz, fx];                                // block +X (right-handed with z-up)
    const Wmm = w * IN, Dmm = d * IN;
    const cx = it.x * IN, cy = -it.z * IN;             // footprint centre, mm
    const ox = cx - u[0] * Wmm / 2 - v[0] * Dmm / 2;   // block origin = front-left corner
    const oy = cy - u[1] * Wmm / 2 - v[1] * Dmm / 2;
    const rotDXF = Math.atan2(u[1], u[0]) * 180 / Math.PI;
    return insert(name, ox, oy, { z, rot: rotDXF });
  };
  for (const it of (state && state.items) || []) {
    const cab = getCab(it.code);
    if (!cab || !cab.placeable || cab.notSupplied) continue;
    ents.push(...insertAt(blockName(cab, finishOf(it)), cab.w, cab.d, it, mountMM(cab)));
  }

  // ---- the rest of the kitchen, so the model reads as the planner draws it (her SketchUp import
  // 2026-09-25: cabinets alone looked like a showroom with the counters missing). Worktops,
  // scribe fillers, the crown and grey appliance placeholders, each on its own coloured layer.
  // A sink stays out: it sits UNDER the worktop, a box for it would poke through the slab.
  const items = (state && state.items) || [];
  // an oriented box in plan: centre (cx, cz) inches, `angle` the Y rotation (radians, as
  // cornice.js and item.rotDeg use it), `len` along its local X, `depth` along its local Z
  // (+ = its front / outward), from y0 to y1 inches; `off` shifts it along local Z
  const obox = (cx, cz, angle, len, depth, y0, y1, layer, off = 0) => {
    const ax = Math.cos(angle), az = -Math.sin(angle), fx = Math.sin(angle), fz = Math.cos(angle);
    const P = (a, f) => [(cx + ax * a + fx * (f + off)) * IN, -(cz + az * a + fz * (f + off)) * IN];
    const c = [P(-len / 2, -depth / 2), P(len / 2, -depth / 2), P(len / 2, depth / 2), P(-len / 2, depth / 2)];
    const z0 = y0 * IN, z1 = y1 * IN;
    return pface([
      [c[0][0], c[0][1], z0], [c[1][0], c[1][1], z0], [c[2][0], c[2][1], z0], [c[3][0], c[3][1], z0],
      [c[0][0], c[0][1], z1], [c[1][0], c[1][1], z1], [c[2][0], c[2][1], z1], [c[3][0], c[3][1], z1],
    ], BOXF, layer);
  };
  // MODELSPACE STAYS LINES + INSERTS ONLY (client-mandated movability): the worktops, fillers and
  // crown each live in ONE block inserted at the origin, every appliance in its own block
  // inserted like a cabinet, so a CAD user still moves whole things, never loose faces.
  const layerExtra = [];
  const worktopKey = (r.worktop && WORKTOP_OPTIONS[r.worktop]) ? r.worktop : 'marble';
  const slabs = [];
  const wtMats = new Set();
  for (const sl of planWorktopSlabs(items, getCab, worktopKey, { width: W, depth: D })) {
    // a slab in another material (the island's own) goes on its own WORKTOP-<material> layer, in that colour
    const mat = sl.mat && WORKTOP_OPTIONS[sl.mat] && sl.mat !== worktopKey ? sl.mat : null;
    if (mat) wtMats.add(mat);
    slabs.push(...box(sl.x0 * IN, sl.x1 * IN, -sl.z1 * IN, -sl.z0 * IN, (SURFACE_Y - WORKTOP_SLAB) * IN, SURFACE_Y * IN, mat ? `WORKTOP-${mat.toUpperCase()}` : 'WORKTOP'));
  }
  for (const m of wtMats) layerExtra.push(coloured(`WORKTOP-${m.toUpperCase()}`, WORKTOP_OPTIONS[m].hex));
  if (slabs.length) { blocks.push({ name: 'WORKTOPS', lines: slabs }); ents.push(...insert('WORKTOPS', 0, 0)); }
  const scribes = [];
  for (const f of computeFillers(state || {})) {
    scribes.push(...obox(f.x, f.z, (f.rotDeg || 0) * Math.PI / 180, f.w, f.d, f.y0 || 0, (f.y0 || 0) + f.h, 'FRONT'));
  }
  if (scribes.length) { blocks.push({ name: 'FILLERS', lines: scribes }); ents.push(...insert('FILLERS', 0, 0)); }
  const applianceBlocks = new Set();
  for (const it of items) {                                     // appliances: honest grey boxes where the client's own go
    const cab = getCab(it.code);
    if (!cab || !cab.placeable || !cab.notSupplied || cab.appliance === 'sink') continue;
    const name = cab.code.replace(/[^A-Za-z0-9]+/g, '_') + '_APPLIANCE';
    if (!applianceBlocks.has(name)) {
      applianceBlocks.add(name);
      const layer = cab.integrated ? 'FRONT' : cab.plaster ? 'HOOD-PLASTER' : 'APPLIANCE';
      blocks.push({ name, lines: box(0, cab.w * IN, 0, cab.d * IN, 0, cab.h * IN, layer) });   // block-local: front-left origin, like a cabinet
    }
    ents.push(...insertAt(name, cab.w, cab.d, it, (typeof cab.mountY === 'number' ? cab.mountY : 0) * IN));
  }
  const crown = planCornice(state || {});
  const BAR = mmToIn(22), PROUD = mmToIn(15), OVER = 0.3;       // the plain profile as built (models/cornice.js)
  const moulding = [];
  for (const g of crown.segments) moulding.push(...obox(g.x, g.z, g.angle, g.length, PROUD + OVER, g.topY, g.topY + BAR, 'CROWN', (PROUD - OVER) / 2));
  for (const d of crown.drops || []) moulding.push(...obox(d.x, d.z, d.angle, d.len, PROUD, d.y0, d.y1, 'CROWN', PROUD / 2));
  if (moulding.length) { blocks.push({ name: 'CROWN', lines: moulding }); ents.push(...insert('CROWN', 0, 0)); }
  // ---- the ROOM as a room (her SketchUp import 2026-09-25: "the walls are not extruded up? and
  // windows aren't in?"): a floor slab, and each wall extruded to the ceiling with its windows and
  // doors cut in — a window leaves the wall below its sill and above its head, a door only the
  // lintel above — plus a pane of glass in every window. Same sill / head maths as the 3D room.
  if (walls) {
    const Hc = Number(r.height) || 96;
    const wallHex = hexOf(WALLS, r.wall, 0xf7f6f2), floorHex = hexOf(FLOORS, r.floor, 0xc2a27b);
    const shell = [];
    shell.push(...box(-W / 2 * IN, W / 2 * IN, -D / 2 * IN, D / 2 * IN, -1 * IN, 0, 'FLOOR'));
    // a slab of wall: along a..b (plan inches along the wall), between the inner and outer face, from y0 to y1
    const slab = (wd, a, b, y0, y1, layer = 'WALL', inner = wd.fixed, outer = wd.out) => {
      const lo = Math.min(inner, outer), hi = Math.max(inner, outer);
      return wd.horiz
        ? box(a * IN, b * IN, -hi * IN, -lo * IN, y0 * IN, y1 * IN, layer)
        : box(lo * IN, hi * IN, -b * IN, -a * IN, y0 * IN, y1 * IN, layer);
    };
    for (const wd of wallDefs) {
      const room = { width: W, depth: D };
      const ops = (r.openings || []).filter((o) => (o.wall || 'back') === wd.wall)
        .map((o) => { const c = openingCenter(room, o), w = openingWidth(o, room); return { o, a: c - w / 2, b: c + w / 2 }; })
        .sort((p, q) => p.a - q.a);
      let cur = -wd.len / 2;
      const ext = (v, atStart) => (atStart && v <= -wd.len / 2 + 0.01 ? v - T : !atStart && v >= wd.len / 2 - 0.01 ? v + T : v);   // reach the corners
      for (const { o, a, b } of ops) {
        if (a > cur) shell.push(...slab(wd, ext(cur, true), a, 0, Hc));
        const isWin = o.type === 'window';
        const hgt = Math.max(6, Math.min(isWin ? (o.hgt || Math.min(46, Hc * 0.45)) : Math.min(82, Hc * 0.86), Hc));
        const sill = isWin ? Math.max(0, Math.min(o.sill ?? Math.max(36, Hc * 0.42), Hc - 6)) : 0;
        const head = Math.min(Hc, sill + hgt);
        if (sill > 0) shell.push(...slab(wd, a, b, 0, sill));
        if (head < Hc) shell.push(...slab(wd, a, b, head, Hc));
        if (isWin) { const mid = (wd.fixed + wd.out) / 2; shell.push(...slab(wd, a, b, sill, head, 'GLASS', mid - 0.1, mid + 0.1)); }
        cur = Math.max(cur, b);
      }
      if (cur < wd.len / 2) shell.push(...slab(wd, ext(cur, true), ext(wd.len / 2, false), 0, Hc));
    }
    blocks.push({ name: 'ROOM', lines: shell }); ents.push(...insert('ROOM', 0, 0));
    layerExtra.push(coloured('WALL', wallHex), coloured('FLOOR', floorHex), coloured('GLASS', '#bfe3f5'));
  }

  return dxfDoc(blocks, ents, {
    units: 1,
    layers: ['0', coloured('PLAN', '#333333'), coloured('PLAN-UPPER', '#7a7a7a', 'DASHED'), coloured('BODY', BRAND.oak),
      ...[...finishes].map((f) => coloured(finishLayer(f, mainFinish), finishHex(f))), coloured('LABEL', '#555555'),
      coloured('WORKTOP', WORKTOP_OPTIONS[worktopKey].hex), coloured('APPLIANCE', '#c2c6cb'), coloured('HOOD-PLASTER', '#f1eee6'), coloured('CROWN', finishHex(mainFinish)), ...layerExtra],
  });
}
