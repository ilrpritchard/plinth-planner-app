// ifc.js — a PURE, minimal IFC4 (ISO-10303-21 SPF) exporter for BIM hand-off.
//
// One export:
//   buildUnitIFC(units, opts) — `units` is [{ name, state }] (state = the
//     Store-serialized planner state, inches). One IfcBuildingStorey per unit
//     type (storey Name = unit type name); every placed cabinet AND appliance
//     becomes an IfcFurnishingElement (appliances matter for coordination even
//     though Plinth doesn't supply them — their Tag is the AP code) with one
//     IfcExtrudedAreaSolid box (W×D rectangle extruded H) and an
//     IfcLocalPlacement carrying position + rotation about Z.
//
// OUTPUT UNITS ARE INCHES (client mandate — everything PL/NTH ships is in
// inches). The length unit is an IfcConversionBasedUnit 'INCH' (0.0254 m),
// which Revit reads natively, so coordinates emit unscaled. Plan coords map
// like dxf.js: plan x → IFC X, plan z → IFC −Y, mount height → IFC Z. Mount
// heights mirror models/cabinet.js MOUNT (duplicated, not imported — ifc.js
// stays free of Three.js and of the DOM so it runs in plain node).
//
// GlobalIds are 22-char strings over the IFC base-64 alphabet, generated from
// a deterministic per-file counter, so the same input yields the same file
// byte-for-byte (`opts.timestamp` defaults to '' for the same reason).

import { getCab, getFinish, WORKTOP_OPTIONS } from './catalogue.js';
import { MOUNT, SURFACE_Y, WORKTOP_SLAB } from './units.js';
import { unitMeshes } from './dxf.js';
import { planWorktopSlabs } from './worktop-plan.js';

// COLOURS CARRY ACROSS (her rule 2026-09-25): every solid gets an IfcStyledItem pointing at an
// IfcSurfaceStyle (IfcSurfaceStyleShading, the one Revit's IFC link colours faces from) — the
// painted finish on cabinets, oak on open units, steel on appliances, the finish on integrated ones.
const STEEL_HEX = '#c2c6cb', OAK_HEX = '#c9a978';
function hexToUnit(hex) {
  const h = String(hex || '').replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const [r, g, b] = Number.isFinite(v) ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : [255, 255, 255];
  return [r / 255, g / 255, b / 255];
}

// mount heights (inches, z of the unit's underside) — mirrors models/cabinet.js
// MOUNT and dxf.js MOUNT_IN. Appliances carry their own cab.mountY instead.
const MOUNT_IN = MOUNT;

// vertical gap between successive storeys in the file (inches) so unit types
// read as stacked floors instead of overlapping ghosts when the model is opened
const STOREY_STEP_IN = 120;

// ---- SPF low-level helpers -------------------------------------------------

// IFC GlobalId alphabet (base 64: 0-9 A-Z a-z _ $), 22 characters exactly.
const GID_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** Deterministic GlobalId factory: encodes an incrementing counter as a
 *  22-char base-64 string (zero-padded, so every id is exactly 22 chars). */
function gidFactory() {
  let counter = 0;
  return () => {
    let n = ++counter;
    let s = '';
    while (n > 0) { s = GID_ALPHABET[n % 64] + s; n = Math.floor(n / 64); }
    return s.padStart(22, GID_ALPHABET[0]);
  };
}

/** IFC SPF string payload: ASCII only (non-ASCII stripped), backslashes and
 *  apostrophes escaped per ISO-10303-21 ('' for ', \\ for \). */
function str(s) {
  return String(s ?? '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''");
}

/** IFC REAL literal — always carries a decimal point, never NaN/Inf/exponent. */
function real(v) {
  let n = Number(v);
  if (!isFinite(n)) n = 0;
  n = Math.round(n * 1e6) / 1e6;
  const s = String(n);
  if (/[eE]/.test(s)) {
    const f = n.toFixed(6).replace(/0+$/, '');
    return f.endsWith('.') ? f : f;
  }
  return s.includes('.') ? s : s + '.';
}

// ---- the exporter -----------------------------------------------------------

/**
 * Build one IFC4 file for a set of unit types.
 * @param {Array<{name: string, state: object}>} units — one storey each;
 *        `state` is the planner state ({ items: [{ code, x, z, rotDeg }] }).
 * @param {{ timestamp?: string }} [opts] — FILE_NAME time stamp (default ''
 *        so exports are deterministic; the app passes a real ISO string).
 * @returns {string} the full SPF text.
 */
export function buildUnitIFC(units, opts = {}) {
  const timestamp = typeof opts.timestamp === 'string' ? opts.timestamp : '';
  const lines = [];
  let n = 0;
  /** Emit one entity line, return its #id. */
  const add = (txt) => { const id = ++n; lines.push(`#${id}=${txt};`); return id; };
  const gid = gidFactory();

  // ---- shared geometry scaffolding ----
  const dirZ = add('IFCDIRECTION((0.,0.,1.))');
  const dirX = add('IFCDIRECTION((1.,0.,0.))');
  const origin = add('IFCCARTESIANPOINT((0.,0.,0.))');
  const wcs = add(`IFCAXIS2PLACEMENT3D(#${origin},#${dirZ},#${dirX})`);
  const ctx = add(
    `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${wcs},$)`);
  const origin2d = add('IFCCARTESIANPOINT((0.,0.))');
  const axis2d = add(`IFCAXIS2PLACEMENT2D(#${origin2d},$)`);
  // one IfcSurfaceStyle per colour in the file, named after the finish
  const styles = new Map();
  const styleFor = (name, hex) => {
    const key = String(hex).toLowerCase();
    if (!styles.has(key)) {
      const [r, g, b] = hexToUnit(hex);
      const rgb = add(`IFCCOLOURRGB($,${real(r)},${real(g)},${real(b)})`);
      const shading = add(`IFCSURFACESTYLESHADING(#${rgb},0.)`);
      styles.set(key, add(`IFCSURFACESTYLE('${str(name)}',.BOTH.,(#${shading}))`));
    }
    return styles.get(key);
  };

  // ---- units: INCHES (conversion-based, 0.0254 m) + radian + area/volume ----
  const uMetre = add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const uDim = add('IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0)');
  const uConv = add(`IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.0254),#${uMetre})`);
  const uLen = add(`IFCCONVERSIONBASEDUNIT(#${uDim},.LENGTHUNIT.,'INCH',#${uConv})`);
  const uArea = add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const uVol = add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const uAng = add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const uAss = add(`IFCUNITASSIGNMENT((#${uLen},#${uArea},#${uVol},#${uAng}))`);

  // ---- spatial tree: project → site → building → storeys ----
  const project = add(
    `IFCPROJECT('${gid()}',$,'PL/NTH kitchens',$,$,$,$,(#${ctx}),#${uAss})`);
  const siteLP = add(`IFCLOCALPLACEMENT($,#${wcs})`);
  const site = add(
    `IFCSITE('${gid()}',$,'Site',$,$,#${siteLP},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldgLP = add(`IFCLOCALPLACEMENT(#${siteLP},#${wcs})`);
  const bldg = add(
    `IFCBUILDING('${gid()}',$,'Building',$,$,#${bldgLP},$,$,.ELEMENT.,$,$,$)`);
  add(`IFCRELAGGREGATES('${gid()}',$,$,$,#${project},(#${site}))`);
  add(`IFCRELAGGREGATES('${gid()}',$,$,$,#${site},(#${bldg}))`);

  const storeyIds = [];
  (units || []).forEach((unit, idx) => {
    const elev = idx * STOREY_STEP_IN;
    const sPt = add(`IFCCARTESIANPOINT((0.,0.,${real(elev)}))`);
    const sAxis = add(`IFCAXIS2PLACEMENT3D(#${sPt},#${dirZ},#${dirX})`);
    const sLP = add(`IFCLOCALPLACEMENT(#${bldgLP},#${sAxis})`);
    const storey = add(
      `IFCBUILDINGSTOREY('${gid()}',$,'${str(unit && unit.name)}',$,$,` +
      `#${sLP},$,$,.ELEMENT.,${real(elev)})`);
    storeyIds.push(storey);

    // ---- every placed cabinet AND appliance on this storey ----
    const elementIds = [];
    const items = (unit && unit.state && unit.state.items) || [];
    for (const it of items) {
      const cab = it && getCab(it.code);
      if (!cab || !cab.placeable) continue;
      const mount = typeof cab.mountY === 'number'
        ? cab.mountY : (MOUNT_IN[cab.type] ?? 0);
      // plan x → X, plan z → −Y (same top-view handedness as dxf.js)
      const th = ((it.rotDeg || 0) * Math.PI) / 180;
      const pt = add(`IFCCARTESIANPOINT((${real(it.x || 0)},` +
        `${real(-(it.z || 0))},${real(mount)}))`);
      const rd = add(
        `IFCDIRECTION((${real(Math.cos(th))},${real(Math.sin(th))},0.))`);
      const ax = add(`IFCAXIS2PLACEMENT3D(#${pt},#${dirZ},#${rd})`);
      const lp = add(`IFCLOCALPLACEMENT(#${sLP},#${ax})`);
      // its colour: the paint it was designed in (the cabinet's own, else the unit's), oak for an
      // open unit or shelf, steel for an appliance, the paint for an integrated one
      const finName = (it.finish && getFinish(it.finish) ? it.finish : null) || (unit.state && unit.state.finish) || 'Ghost';
      const finHex = (getFinish(finName) || {}).hex || '#F7F4EB';
      const [sName, sHex] = cab.type === 'APPLIANCES'
        ? (cab.integrated || cab.plaster ? [finName, finHex] : ['Stainless steel', STEEL_HEX])
        : (cab.form === 'open' || cab.form === 'tray' || cab.type === 'SHELF' ? ['Oak', OAK_HEX] : [finName, finHex]);
      let rep;
      const meshes = cab.type === 'APPLIANCES' || cab.notSupplied ? [] : unitMeshes(cab);
      if (meshes.length) {
        // a PL/NTH cabinet: the SAME fronts and carcass the DXF ships, as IFC4 tessellation
        // (IfcPolygonalFaceSet, what Revit reads natively) — 22mm legs, 80mm shaker frames,
        // recessed panels, drawer faces, plinth. Block-local mm -> inches about the placement.
        const items = [];
        for (const m of meshes) {
          if (m.layer !== 'FRONT' && m.layer !== 'BODY' && !m.layer.startsWith('FRONT-')) continue;   // footprint lines and labels stay 2D
          const pts = m.verts.map(([x, y, z]) => `(${real(x / 25.4 - cab.w / 2)},${real(y / 25.4 - cab.d / 2)},${real(z / 25.4)})`).join(',');
          const list = add(`IFCCARTESIANPOINTLIST3D((${pts}))`);
          const faces = m.faces.map((f) => add(`IFCINDEXEDPOLYGONALFACE((${f.join(',')}))`));
          const fs = add(`IFCPOLYGONALFACESET(#${list},${m.closed ? '.T.' : '.F.'},(${faces.map((f) => '#' + f).join(',')}),$)`);
          const [mName, mHex] = m.layer === 'BODY' ? ['Oak', OAK_HEX] : [sName, sHex];
          add(`IFCSTYLEDITEM(#${fs},(#${styleFor(mName, mHex)}),$)`);
          items.push(fs);
        }
        rep = add(`IFCSHAPEREPRESENTATION(#${ctx},'Body','Tessellation',(${items.map((i) => '#' + i).join(',')}))`);
      } else {
        // an appliance: one box, W×D rectangle (centred on the placement) extruded H up
        const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${axis2d},` +
          `${real(cab.w)},${real(cab.d)})`);
        const solid = add(
          `IFCEXTRUDEDAREASOLID(#${prof},#${wcs},#${dirZ},${real(cab.h)})`);
        add(`IFCSTYLEDITEM(#${solid},(#${styleFor(sName, sHex)}),$)`);
        rep = add(
          `IFCSHAPEREPRESENTATION(#${ctx},'Body','SweptSolid',(#${solid}))`);
      }
      const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
      const name = `${cab.code} - ${cab.desc} (${cab.w}in)`;
      const tag = cab.baseCode || cab.code;
      elementIds.push(add(
        `IFCFURNISHINGELEMENT('${gid()}',$,'${str(name)}',$,$,` +
        `#${lp},#${pds},'${str(tag)}')`));
    }
    // the worktops: one furnishing element per slab, in the chosen material's colour, so the
    // kitchen reads as a kitchen in Revit and not as a row of boxes with nothing on top
    const room = (unit && unit.state && unit.state.room) || {};
    const wtKey = room.worktop && WORKTOP_OPTIONS[room.worktop] ? room.worktop : 'marble';
    let slabs = [];
    try { slabs = planWorktopSlabs(items, getCab, wtKey, { width: room.width || 144, depth: room.depth || 120 }); } catch { slabs = []; }
    slabs.forEach((sl, k) => {
      const w = sl.x1 - sl.x0, d = sl.z1 - sl.z0;
      if (!(w > 0.5 && d > 0.5)) return;
      const pt = add(`IFCCARTESIANPOINT((${real((sl.x0 + sl.x1) / 2)},${real(-(sl.z0 + sl.z1) / 2)},${real(SURFACE_Y - WORKTOP_SLAB)}))`);
      const ax = add(`IFCAXIS2PLACEMENT3D(#${pt},#${dirZ},#${dirX})`);
      const lp = add(`IFCLOCALPLACEMENT(#${sLP},#${ax})`);
      const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${axis2d},${real(w)},${real(d)})`);
      const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},#${wcs},#${dirZ},${real(WORKTOP_SLAB)})`);
      add(`IFCSTYLEDITEM(#${solid},(#${styleFor(WORKTOP_OPTIONS[wtKey].label, WORKTOP_OPTIONS[wtKey].hex)}),$)`);
      const rep = add(`IFCSHAPEREPRESENTATION(#${ctx},'Body','SweptSolid',(#${solid}))`);
      const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
      elementIds.push(add(`IFCFURNISHINGELEMENT('${gid()}',$,'Worktop ${k + 1} - ${str(WORKTOP_OPTIONS[wtKey].label)} (by others)',$,$,#${lp},#${pds},'WORKTOP')`));
    });
    if (elementIds.length) {
      add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${gid()}',$,$,$,` +
        `(${elementIds.map((id) => '#' + id).join(',')}),#${storey})`);
    }
  });
  if (storeyIds.length) {
    add(`IFCRELAGGREGATES('${gid()}',$,$,$,#${bldg},` +
      `(${storeyIds.map((id) => '#' + id).join(',')}))`);
  }

  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    `FILE_NAME('plinth-units.ifc','${str(timestamp)}',('PL/NTH'),('PL/NTH'),` +
    "'PL/NNER','PL/NNER','');",
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');
}
