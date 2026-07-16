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

import { getCab } from './catalogue.js';

// mount heights (inches, z of the unit's underside) — mirrors models/cabinet.js
// MOUNT and dxf.js MOUNT_IN. Appliances carry their own cab.mountY instead.
const MOUNT_IN = { FLOOR: 0, TALL: 0, WALL: 54, COUNTER: 36.5 };

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
      // one box: W×D rectangle (centred on the placement) extruded H up,
      // all in inches — the file's length unit
      const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${axis2d},` +
        `${real(cab.w)},${real(cab.d)})`);
      const solid = add(
        `IFCEXTRUDEDAREASOLID(#${prof},#${wcs},#${dirZ},${real(cab.h)})`);
      const rep = add(
        `IFCSHAPEREPRESENTATION(#${ctx},'Body','SweptSolid',(#${solid}))`);
      const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
      const name = `${cab.code} - ${cab.desc} (${cab.w}in)`;
      const tag = cab.baseCode || cab.code;
      elementIds.push(add(
        `IFCFURNISHINGELEMENT('${gid()}',$,'${str(name)}',$,$,` +
        `#${lp},#${pds},'${str(tag)}')`));
    }
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
