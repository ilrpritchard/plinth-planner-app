// stackers.js — PURE. "Add stackers above without having to calculate which fits myself"
// (her ask 2026-09-22). Every tall, wall and counter cabinet has a stacker made for it (the
// S range: "fits T1, T3" in its description). planStackers() reads that, picks the height the
// ceiling allows, and says exactly where each one goes: on its host, back on the same wall.
//
//   planStackers(state, wall?) -> { ok:true, size, placements:[{code,x,z,rotDeg,hostId}], hosts:n, skipped:[{id,code,why}] }
//                               | { ok:false, reason:'no hosts' | 'too low', need, ceiling }
// size: 21" when the ceiling has room for it and its crown (86" + 21" + 3"), else 15", else refused.
// Skipped, and said so: a corner unit (no stacker made), a host that already has one, a host
// standing off every wall (an island tall), and a host with no stacker in the catalogue.

import { CATALOGUE, getCab } from './catalogue.js';
import { MOUNT, TALL_H } from './units.js';

const WALL_GAP = 0.25, NEAR = 14, CLEAR = 3;          // room above the stacker for its crown
const ROT_WALL = { 0: 'back', 90: 'left', 180: 'front', 270: 'right' };
const rotOf = (it) => (((it.rotDeg || 0) % 360) + 360) % 360;
const hostTop = (cab) => (cab.type === 'TALL' ? TALL_H : cab.type === 'WALL' ? MOUNT.WALL + cab.h : MOUNT.COUNTER + cab.h);
const fitsOf = (s) => ((s.desc || '').match(/\(fits ([^)]*)\)/) || [, ''])[1].split(/[,\s]+/).filter(Boolean);
const STACKERS = CATALOGUE.filter((c) => c.stacker);

/** The stacker of `h` inches made for this host, or null. */
export function stackerFor(hostCode, h) {
  return STACKERS.find((s) => s.h === h && fitsOf(s).includes(hostCode)) || null;
}

export function planStackers(state, wall = null) {
  const r = (state && state.room) || {}, W = r.width || 144, D = r.depth || 120, H = r.height || 96;
  const items = (state && state.items) || [];
  const isHost = (c) => c && c.placeable && !c.stacker && (c.type === 'TALL' || c.type === 'WALL' || c.type === 'COUNTER');
  const offWall = (it, c) => { const rot = rotOf(it); return rot === 0 ? it.z - c.d / 2 + D / 2 : rot === 180 ? D / 2 - (it.z + c.d / 2) : rot === 90 ? it.x - c.d / 2 + W / 2 : rot === 270 ? W / 2 - (it.x + c.d / 2) : Infinity; };
  const hosts = items.map((it) => ({ it, cab: getCab(it.code) })).filter(({ it, cab }) => isHost(cab) && (!wall || ROT_WALL[rotOf(it)] === wall || (wall === 'left' && ROT_WALL[rotOf(it)] === 'right')));
  if (!hosts.length) return { ok: false, reason: 'no hosts' };
  const size = H >= TALL_H + 21 + CLEAR ? 21 : H >= TALL_H + 15 + CLEAR ? 15 : 0;
  if (!size) return { ok: false, reason: 'too low', need: TALL_H + 15 + CLEAR, ceiling: H };

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
    const touch = s.d / 2 + WALL_GAP;
    const pos = rot === 0 ? { x: it.x, z: -D / 2 + touch } : rot === 180 ? { x: it.x, z: D / 2 - touch } : rot === 90 ? { x: -W / 2 + touch, z: it.z } : { x: W / 2 - touch, z: it.z };
    placements.push({ code: s.code, ...pos, rotDeg: rot, hostId: it.id, top: hostTop(cab) + s.h });
  }
  if (!placements.length) return { ok: false, reason: 'nothing to add', size, skipped };
  return { ok: true, size, placements, hosts: hosts.length, skipped };
}
