// stackers.js — PURE. "Add stackers above without having to calculate which fits myself"
// (her ask 2026-09-22). Every tall, wall and counter cabinet has a stacker made for it (the
// S range: "fits T1, T3" in its description). planStackers() reads that, picks the height the
// ceiling allows, and says exactly where each one goes: on its host, back on the same wall.
//
//   planStackers(state, wall?, onlyId?) -> { ok:true, size, placements:[{code,x,z,rotDeg,hostId}], hosts:n, skipped:[{id,code,why}] }
//                               | { ok:false, reason:'no hosts' | 'too low', need, ceiling }
// size: 21" when the ceiling has room for it and its crown (86" + 21" + 3"), else 15", else refused.
// Skipped, and said so: a corner unit (no stacker made), a host that already has one, a host
// standing off every wall (an island tall), and a host with no stacker in the catalogue.

import { CATALOGUE, getCab, sizedStackerCode, STACKER_HEIGHT_LIMITS } from './catalogue.js';
import { MOUNT, TALL_H } from './units.js';

const WALL_GAP = 0.25, NEAR = 14, CLEAR = 3, TALL_PROUD = 30 / 25.4;      // CLEAR: room above the stacker for its crown
const ROT_WALL = { 0: 'back', 90: 'left', 180: 'front', 270: 'right' };
const rotOf = (it) => (((it.rotDeg || 0) % 360) + 360) % 360;
const hostTop = (cab) => (cab.type === 'TALL' ? TALL_H : cab.type === 'WALL' ? MOUNT.WALL + cab.h : MOUNT.COUNTER + cab.h);
const fitsOf = (s) => ((s.desc || '').match(/\(fits ([^)]*)\)/) || [, ''])[1].split(/[,\s]+/).filter(Boolean);
const STACKERS = CATALOGUE.filter((c) => c.stacker);

/** The stacker height a ceiling of H takes with its crown: 21, 15, or 0 (none). */
export const sizeFor = (H) => (H >= TALL_H + 21 + CLEAR ? 21 : H >= TALL_H + 15 + CLEAR ? 15 : 0);

/** Made to height: the stacker that fills a ceiling of H to its crown, to the quarter inch, 12" to 30"; 0 under 12". */
export const bespokeSizeFor = (H) => { const h = Math.floor((H - TALL_H - CLEAR) * 4 + 0.01) / 4; return h < STACKER_HEIGHT_LIMITS[0] ? 0 : Math.min(h, STACKER_HEIGHT_LIMITS[1]); };

/** The stacker of `h` inches made for this host, or null. */
export function stackerFor(hostCode, h) {
  const std = STACKERS.find((s) => s.h === h && fitsOf(s).includes(hostCode));
  if (std) return std;
  const any = STACKERS.find((s) => fitsOf(s).includes(hostCode));           // an odd height: made to height
  return any && h >= STACKER_HEIGHT_LIMITS[0] && h <= STACKER_HEIGHT_LIMITS[1] ? getCab(sizedStackerCode(any.code, h)) : null;
}

// opts.bespoke: made to height, filling the ceiling (asked for, never the default). Every plan also
// says what made-to-height size the ceiling would take (bespoke), when that differs from its own.
export function planStackers(state, wall = null, onlyId = null, opts = {}) {
  const r = (state && state.room) || {}, W = r.width || 144, D = r.depth || 120, H = r.height || 96;
  const items = (state && state.items) || [];
  const isHost = (c) => c && c.placeable && !c.stacker && !c.high && (c.type === 'TALL' || c.type === 'WALL' || c.type === 'COUNTER');   // a full-height wall cabinet already IS the stacked height
  const offWall = (it, c) => { const rot = rotOf(it); return rot === 0 ? it.z - c.d / 2 + D / 2 : rot === 180 ? D / 2 - (it.z + c.d / 2) : rot === 90 ? it.x - c.d / 2 + W / 2 : rot === 270 ? W / 2 - (it.x + c.d / 2) : Infinity; };
  const hosts = items.map((it) => ({ it, cab: getCab(it.code) })).filter(({ it, cab }) => isHost(cab) && (onlyId == null || it.id === onlyId) && (!wall || ROT_WALL[rotOf(it)] === wall || (wall === 'left' && ROT_WALL[rotOf(it)] === 'right')));
  if (!hosts.length) return { ok: false, reason: 'no hosts' };
  const fill = bespokeSizeFor(H);
  const size = opts.bespoke ? fill : sizeFor(H);
  const bespoke = !opts.bespoke && fill && fill !== size ? fill : 0;
  if (!size) return { ok: false, reason: 'too low', need: TALL_H + 15 + CLEAR, ceiling: H, bespoke, bespokeNeed: TALL_H + STACKER_HEIGHT_LIMITS[0] + CLEAR };

  const stacked = items.filter((it) => getCab(it.code)?.stacker);
  const placements = [], skipped = [];
  for (const { it, cab } of hosts) {
    const rot = rotOf(it);
    if (cab.corner) { skipped.push({ id: it.id, code: it.code, why: 'corner' }); continue; }
    if (!(rot in ROT_WALL) || offWall(it, cab) >= NEAR) { skipped.push({ id: it.id, code: it.code, why: 'off the wall' }); continue; }
    const along = rot % 180 === 0 ? it.x : it.z;
    if (stacked.some((s) => rotOf(s) === rot && Math.abs((rot % 180 === 0 ? s.x : s.z) - along) < 1)) { skipped.push({ id: it.id, code: it.code, why: 'already stacked' }); continue; }
    const s = stackerFor(it.code, size);
    if (!s) { skipped.push({ id: it.id, code: it.code, why: 'none made' }); continue; }
    const touch = s.d / 2 + WALL_GAP + (s.onTall ? TALL_PROUD : 0);      // a tall's stacker stands proud with the tall
    const pos = rot === 0 ? { x: it.x, z: -D / 2 + touch } : rot === 180 ? { x: it.x, z: D / 2 - touch } : rot === 90 ? { x: -W / 2 + touch, z: it.z } : { x: W / 2 - touch, z: it.z };
    placements.push({ code: s.code, ...pos, rotDeg: rot, hostId: it.id, top: hostTop(cab) + s.h });
  }
  if (!placements.length) return { ok: false, reason: 'nothing to add', size, skipped, bespoke };
  return { ok: true, size, placements, hosts: hosts.length, skipped, bespoke };
}

// The ceiling changed (her ask 2026-10-02, "upgrade stackers automatically when the ceiling
// changes"): every stacker already placed goes to the height the new ceiling takes, up to 21"
// or back down to 15". Its host is the cabinet it fits, on the same wall, at the same spot.
// A made-to-height stacker is refitted to fill the new ceiling (a standard code when it lands on 15"
// or 21"). A ceiling too low for any stacker leaves them as they are: warnings.js flags them.
//   resizeStackers(state) -> [{ id, from, to }]
export function resizeStackers(state) {
  const H = (state && state.room && state.room.height) || 96, std = sizeFor(H), fill = bespokeSizeFor(H);
  const items = (state && state.items) || [], swaps = [];
  for (const it of items) {
    const cab = getCab(it.code);
    const size = cab && cab.madeToHeight ? fill : std;           // made to height stays made to height, refitted
    if (!size || !cab || !cab.stacker || cab.h === size) continue;
    const rot = rotOf(it), fits = fitsOf(cab), along = (o) => (rot % 180 === 0 ? o.x : o.z);
    const host = items.find((o) => o !== it && fits.includes(o.code) && rotOf(o) === rot && Math.abs(along(o) - along(it)) < 1);
    const s = host && stackerFor(host.code, size);
    if (s && s.code !== it.code) swaps.push({ id: it.id, from: it.code, to: s.code });
  }
  return swaps;
}
