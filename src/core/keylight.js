// keylight.js — PURE. Where the room's ONE key light comes from (render step 2, 2026-09-28: "one
// clear light direction, from the window if the kitchen has one, with soft fill").
//
//   keyLight(room) -> { from: [x, y, z] unit vector toward the light, azimuth (radians, atan2(z, x)
//                       of the horizontal part, the same angle the environment is turned to),
//                       source: 'window-left' | 'window-right' | 'window-front' | 'window-back' | 'default' }
//
// The biggest window wins. Light from a side or front window travels from the window toward the
// back run (so it rakes across the fronts from the window's side). A window on the BACK wall sits
// behind the run: light from there would only backlight the fronts, so the key comes from high up
// on the window's side, falling onto the worktop and down the fronts, never from behind them. With
// no window the key keeps the old studio direction, front right and above. The key never comes
// from behind the back run (its from-vector always points a little toward +z). Real sunlight
// through the glass, with the room closed, is a later step (photo mode only).

import { openingCenter } from './openings.js';

const ELEV = 50 * Math.PI / 180;         // a side / front window: raking, relief-casting
const ELEV_BACK = 62 * Math.PI / 180;    // a back-wall window: light falls from high up its side
const MIN_FRONT = 0.3;                   // the horizontal from-vector always leans this far toward +z

export function keyLight(room = {}) {
  const W = room.width || 144, D = room.depth || 120;
  const wins = (Array.isArray(room.openings) ? room.openings : []).filter((o) => o && o.type === 'window');
  const area = (o) => (o.width || 48) * (o.hgt || 46);
  const win = wins.slice().sort((a, b) => area(b) - area(a))[0];
  const focus = [0, -D / 2 + 24];                           // the working face of the back run
  let hx, hz, elev = ELEV, source = 'default';
  if (!win) { hx = 0.6; hz = 0.8; }
  else {
    const wall = win.wall || 'back', c = openingCenter({ width: W, depth: D }, win);
    source = 'window-' + wall;
    if (wall === 'back') { hx = Math.max(-1, Math.min(1, c / (W / 4))); hz = 0.45; elev = ELEV_BACK; }
    else {
      const at = wall === 'left' ? [-W / 2, c] : wall === 'right' ? [W / 2, c] : [c, D / 2];
      hx = at[0] - focus[0]; hz = at[1] - focus[1];
    }
  }
  let n = Math.hypot(hx, hz) || 1; hx /= n; hz /= n;
  if (hz < MIN_FRONT) { hz = MIN_FRONT; hx = Math.sign(hx || 1) * Math.sqrt(1 - hz * hz); }
  const ch = Math.cos(elev);
  return { from: [hx * ch, Math.sin(elev), hz * ch], azimuth: Math.atan2(hz, hx), source };
}

// ---- the SUN, photo mode's closed room (render step 4, 2026-09-28) ------------------------------
// "Put a sun directional light behind the window so real sunlight comes through the glass." The room
// is closed in photo mode (walls and ceiling cast shadows), so the only direct light is what comes in
// through the opening: the from-vector points OUT through the biggest window, at a late-morning
// height, turned off the wall's normal so the patch rakes into the room:
//   a side-wall window: the rays also travel toward the back wall, across the back run's fronts;
//   a back- or front-wall window: the rays travel toward the middle of the room.
//
//   sunLight(room) -> null (no window) | { from, azimuth, wall, center: [x, y, z], source }

const SUN_ELEV = 36 * Math.PI / 180;
const SUN_TURN = 32 * Math.PI / 180;     // off the wall's normal

export function sunLight(room = {}) {
  const W = room.width || 144, D = room.depth || 120, H = room.height || 96;
  const wins = (Array.isArray(room.openings) ? room.openings : []).filter((o) => o && o.type === 'window');
  const area = (o) => (o.width || 48) * (o.hgt || 46);
  const win = wins.slice().sort((a, b) => area(b) - area(a))[0];
  if (!win) return null;
  const wall = win.wall || 'back', c = openingCenter({ width: W, depth: D }, win);
  const sill = win.sill ?? Math.max(36, H * 0.42), hgt = win.hgt || Math.min(46, H * 0.45);
  const cy = Math.min(H - 6, sill + hgt / 2);
  // outward normal of the wall, and the unit vector along it
  const out = { back: [0, -1], front: [0, 1], left: [-1, 0], right: [1, 0] }[wall];
  const center = wall === 'back' ? [c, cy, -D / 2] : wall === 'front' ? [c, cy, D / 2] : wall === 'left' ? [-W / 2, cy, c] : [W / 2, cy, c];
  // which way to turn: side walls toward the back wall (rays run to -z, so the from-vector gains +z);
  // back / front walls toward the middle of the room
  let side;
  if (wall === 'left' || wall === 'right') side = [0, 1];
  else side = [c > 0 ? 1 : -1, 0];
  const hx = out[0] * Math.cos(SUN_TURN) + side[0] * Math.sin(SUN_TURN), hz = out[1] * Math.cos(SUN_TURN) + side[1] * Math.sin(SUN_TURN);
  const n = Math.hypot(hx, hz), ch = Math.cos(SUN_ELEV);
  return { from: [hx / n * ch, Math.sin(SUN_ELEV), hz / n * ch], azimuth: Math.atan2(hz, hx), wall, center, source: 'sun-' + wall };
}
