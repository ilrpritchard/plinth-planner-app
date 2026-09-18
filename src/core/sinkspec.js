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

/** The narrowest base cabinet this sink goes in: the maker's figure when there
 *  is one, else the bowl cut-out + 2" (1" of carcass each side), never under 24". */
export function sinkMinBase(cab) {
  return cab.minBase || Math.max(24, Math.ceil(sinkSpec(cab).cutW + 2));
}

/** The widest bowl CUT-OUT a base of this width takes (the same 2" rule, reversed). */
export const maxSinkCutout = (baseW) => baseW - 2;

/** Every sink on the plan with the base it sits in: [{ sink, sinkCab, base, baseCab }]. */
export function sinkHosts(state) {
  const out = [];
  for (const r of state.items || []) {
    const rc = getCab(r.code);
    if (!rc || rc.appliance !== 'sink') continue;
    const base = (state.items || []).find((b) => {
      const bc = getCab(b.code);
      if (!hostable(bc)) return false;
      const o = localOffset(b, bc, r.x, r.z);
      return Math.abs(o.along) < o.hw && Math.abs(o.across) < o.hd;
    });
    out.push({ sink: r, sinkCab: rc, base: base || null, baseCab: base ? getCab(base.code) : null });
  }
  return out;
}

/** Every sink, narrow to wide, for the selection bar's size picker. */
export function sinkSizes(code) {
  const cur = getCab(code);
  if (!cur || cur.appliance !== 'sink') return [];
  return CATALOGUE.filter((c) => c.appliance === 'sink' && c.placeable !== false && !c.baseCode)
    .sort((a, b) => a.w - b.w || (/double/i.test(a.desc) ? 1 : 0) - (/double/i.test(b.desc) ? 1 : 0));
}

// ---- the base a sink or cooktop sits in ------------------------------------
// A sink (or cooktop) dropped near a base cabinet belongs CENTRED on it, both
// ways: across the door(s) and front to back, exactly where the wizard seats
// one. baseUnder() finds that base from a pointer position: the floor cabinet
// the point is over, else the nearest one within `reach`. Corners never host.

const hostable = (c) => !!c && c.type === 'FLOOR' && !c.corner && c.placeable !== false;

function localOffset(base, cab, x, z) {
  const th = ((base.rotDeg || 0) * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
  const dx = x - base.x, dz = z - base.z;
  return { along: dx * c - dz * sn, across: dx * sn + dz * c, hw: cab.w / 2, hd: cab.d / 2 };
}

/** Can this base take this rider? A SINK drops into a door or double base and
 *  nothing else: never the dishwasher front (F7 / F29: there is a machine behind
 *  it, her screenshot 2026-09-18 had a sink snapped onto one), never a drawer
 *  bank, bin, tray space or cooktop-prepped base. A COOKTOP sits over drawers, a
 *  double or a cooktop base. */
export function canHost(baseCab, rider) {
  if (!hostable(baseCab) || baseCab.form === 'dishwasher') return false;
  if (!rider) return true;
  if (rider.appliance === 'sink') return (baseCab.form === 'door' || baseCab.form === 'double') && !/cooktop/i.test(baseCab.desc || '');
  if (rider.appliance === 'hob') return baseCab.form === 'drawers' || baseCab.form === 'double' || /cooktop/i.test(baseCab.desc || '');
  return true;
}

/** Is any part of this sink / cooktop over a dishwasher front? (footprints overlap by more than `tol`) */
export function overDishwasher(state, rider, x, z, rotDeg = 0, tol = 1.5) {
  const half = (c, r) => { const th = ((r || 0) * Math.PI) / 180; return [Math.abs(Math.cos(th)) * c.w / 2 + Math.abs(Math.sin(th)) * c.d / 2, Math.abs(Math.sin(th)) * c.w / 2 + Math.abs(Math.cos(th)) * c.d / 2]; };
  const sp = rider.appliance === 'sink' ? sinkSpec(rider) : null;
  const [rx, rz] = half(sp ? { w: sp.cutW, d: sp.cutD } : rider, rotDeg);   // a sink is judged by its BOWL opening, not its rim
  return (state.items || []).some((it) => {
    const c = getCab(it.code);
    if (!c || c.form !== 'dishwasher') return false;
    const [hx, hz] = half(c, it.rotDeg);
    return (rx + hx) - Math.abs(it.x - x) > tol && (rz + hz) - Math.abs(it.z - z) > tol;
  });
}

export function baseUnder(state, x, z, reach = 7, rider = null) {
  let best = null, bestScore = Infinity;
  for (const it of state.items || []) {
    const cab = getCab(it.code);
    if (!canHost(cab, rider)) continue;
    const o = localOffset(it, cab, x, z);
    const outAlong = Math.max(0, Math.abs(o.along) - o.hw), outAcross = Math.max(0, Math.abs(o.across) - o.hd);
    if (outAlong > reach || outAcross > reach + 6) continue;   // a sink dragged in from the room side still catches
    const score = (outAlong + outAcross) * 100 + Math.abs(o.along);
    if (score < bestScore) { bestScore = score; best = it; }
  }
  return best;
}

/** Where a newly added sink / cooktop should go: the best EMPTY base for it.
 *  Sinks want a door or double base wide enough for them (their minBase when
 *  they have one); cooktops want the cooktop-prepped bases first. */
export function bestBaseFor(state, rider, preferRot = null) {
  const taken = (b, bc) => (state.items || []).some((o) => {
    const oc = getCab(o.code);
    if (!oc || oc.type !== 'APPLIANCES' || !(oc.appliance === 'sink' || oc.appliance === 'hob')) return false;
    const l = localOffset(b, bc, o.x, o.z);
    return Math.abs(l.along) < l.hw && Math.abs(l.across) < l.hd + 2;
  });
  let best = null, bestScore = Infinity;
  for (const it of state.items || []) {
    const c = getCab(it.code);
    if (!hostable(c) || c.halfDepth || taken(it, c)) continue;
    let score;
    if (rider.appliance === 'sink') {
      if (!(c.form === 'door' || c.form === 'double') || /cooktop/i.test(c.desc)) continue;
      const need = sinkMinBase(rider);
      score = c.w >= need ? c.w - need : 100 + (need - c.w);          // snuggest base that is big enough
    } else {
      const prepped = /cooktop/i.test(c.desc);
      if (!prepped && !(c.form === 'drawers' || c.form === 'double')) continue;
      score = (prepped ? 0 : 50) + (c.w >= rider.w ? c.w - rider.w : 100 + (rider.w - c.w));
    }
    if (preferRot != null && (it.rotDeg || 0) !== preferRot) score += 25;   // the wall she is working on first
    if (score < bestScore) { bestScore = score; best = it; }
  }
  return best;
}

// ---- "Sink base" shortcuts ---------------------------------------------------
// The catalogue has no sink cabinet: a sink sits in an ordinary door / double
// base. These are SHORTCUT TILES, not SKUs (hard rule 13: never invent or rename
// SKUs): each drops a real base cabinet with a real sink centred in it, and the
// estimate lists the two separately. Her pick 2026-09-18 over auto-spawning.
export const SINK_BASES = [
  { id: 'SB24', base: 'F2', sink: 'AP6', label: 'Sink base 24"', bowl: 'single 24"' },
  { id: 'SB28', base: 'F3', sink: 'AP6', label: 'Sink base 28"', bowl: 'single 24"' },
  { id: 'SB36', base: 'F10', sink: 'AP19', label: 'Sink base 36"', bowl: 'single 33"' },
  { id: 'SB36D', base: 'F10', sink: 'AP20', label: 'Sink base 36"', bowl: 'double 33"' },
];
export const sinkBaseCombo = (id) => SINK_BASES.find((c) => c.id === id) || null;

