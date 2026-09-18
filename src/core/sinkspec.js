// sinkspec.js — PURE. One description of an undermount sink so the worktop
// cutout, the 3D bowl, the catalogue icon and the size picker agree. Inches.
//
// The bigger sinks (AP17-AP20) take their numbers from the Franke Grande
// undermounts she picked (GDX11023 / 11028 / 11031 single bowls, GDX12031
// double): 9" deep, generous corner radius, drain set toward the back, a
// 7/8" flange all round. Appliances are placeholders, never supplied: the
// model fits are named in the catalogue notes so a buyer can find the sink.
// The original AP6 / AP7 / AP10 keep their sizes and get the same bowl.

import { CATALOGUE, getCab } from './catalogue.js';

/** @returns {{cutW:number, cutD:number, depth:number, r:number, drainZ:number, divider:number,
 *            bowls:{x:number,w:number,d:number}[], minBase:number|null}} local inches, x across, z front(+)/back(-) */
export function sinkSpec(cab) {
  const b = cab.bowl;
  const double = b ? b.n === 2 : /double/i.test(cab.desc || '');
  const divider = double ? (b?.divider ?? 0.7) : 0;
  // legacy sinks: opening = footprint minus the rim allowance they always had
  const cutW = b ? b.n * b.w + divider : cab.w - 2.4;
  const cutD = b ? b.d : cab.d - 4.5;
  const bw = double ? (cutW - divider) / 2 : cutW;
  const bowls = double
    ? [{ x: -(bw + divider) / 2, w: bw, d: cutD }, { x: (bw + divider) / 2, w: bw, d: cutD }]
    : [{ x: 0, w: cutW, d: cutD }];
  return {
    cutW, cutD, bowls, divider,
    depth: b?.depth ?? 7,
    r: Math.min(b?.r ?? 1.6, bw / 2 - 0.5, cutD / 2 - 0.5),   // corner radius of each bowl
    drainZ: -cutD * (b ? 0.14 : 0.1),                           // drain sits behind centre
    minBase: cab.minBase ?? null,
  };
}

/** Every sink, narrow to wide, for the selection bar's size picker. */
export function sinkSizes(code) {
  const cur = getCab(code);
  if (!cur || cur.appliance !== 'sink') return [];
  return CATALOGUE.filter((c) => c.appliance === 'sink' && c.placeable !== false && !c.baseCode)
    .sort((a, b) => a.w - b.w || (/double/i.test(a.desc) ? 1 : 0) - (/double/i.test(b.desc) ? 1 : 0));
}
