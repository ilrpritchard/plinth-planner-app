// photoviews.js — PURE. The camera standpoints behind the Photo button (her ask 2026-09-25:
// "realistic camera angles / heights, so when you click photo it downloads say 5 angles").
//
// Every standpoint is INSIDE the room at a human height, the way a kitchen is photographed for
// a listing or a brochure: two three-quarter views at standing eye level from the front corners,
// one straight on to the run, one low close-up across the worktop, and one raised corner view
// that shows the whole layout. They aim at the working part of the back run (the middle of what
// stands on it), or at the island when there is one. World units are inches; the back wall is
// at z = -depth/2 and the runs face +z.
//
//   photoViews(room, items?) -> [{ key, name, pos:[x,y,z], target:[x,y,z], fov }]

import { getCab } from './catalogue.js';

const EYE = 56;             // 4'8": where kitchen photographers stand the camera (chest height keeps verticals straight and reads the counters)
const LOW = 44;             // worktop-level close-up
const MARGIN = 6;           // the camera never stands in a wall

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Where the kitchen IS: mean x of the back run, and the island's centre when there is one. */
function focus(room, items) {
  const W = room.width || 144, D = room.depth || 120;
  let sx = 0, n = 0, ix = 0, iz = 0, ni = 0;
  for (const it of items || []) {
    const cab = getCab(it && it.code);
    if (!cab || !cab.placeable) continue;
    const floorStanding = cab.type === 'FLOOR' || cab.type === 'TALL' || (cab.type === 'APPLIANCES' && (cab.mountY || 0) === 0);
    if (it.island) { ix += it.x; iz += it.z; ni++; continue; }
    if (floorStanding && ((it.rotDeg || 0) % 180) === 0 && it.z < -D / 2 + 40) { sx += it.x; n++; }
  }
  return {
    runX: n ? clamp(sx / n, -W / 2 + 12, W / 2 - 12) : 0,
    island: ni ? { x: ix / ni, z: iz / ni } : null,
  };
}

export function photoViews(room = {}, items = []) {
  const W = room.width || 144, D = room.depth || 120, H = room.height || 96;
  const back = -D / 2, front = D / 2;
  const { runX, island } = focus(room, items);
  const eye = Math.min(EYE, H - 10), low = Math.min(LOW, H - 14);
  const x = (v) => clamp(v, -W / 2 + MARGIN, W / 2 - MARGIN);
  const z = (v) => clamp(v, back + MARGIN, front - MARGIN);
  const aimY = 42;                        // a touch above the worktop: fronts and uppers both in frame
  const views = [
    { key: 'hero-right', name: 'From the front right, standing', pos: [x(W * 0.32), eye, z(front - D * 0.12)], target: [runX - W * 0.10, aimY, back + 10], fov: 56 },
    { key: 'hero-left', name: 'From the front left, standing', pos: [x(-W * 0.32), eye, z(front - D * 0.12)], target: [runX + W * 0.10, aimY, back + 10], fov: 56 },
    // straight on: far enough back to take the whole run in (about 0.7x the room width from the
    // run's face, her catch 2026-09-25: "too close"); when the room is shallower than that the
    // camera steps back THROUGH the front wall (the wall auto-hides behind the camera), up to 6'
    { key: 'straight-on', name: 'Straight on to the run', pos: [x(runX), eye - 2, Math.min(front + 72, Math.max(front - MARGIN, back + 26 + 0.7 * W))], target: [runX, aimY, back], fov: 58 },
    { key: 'worktop', name: 'Low, across the worktop', pos: [x(runX + W * 0.18), low, z(back + Math.min(D * 0.45, 96))], target: [runX - W * 0.12, 38, back + 6], fov: 52 },
    { key: 'overview', name: 'Raised corner view of the whole kitchen', pos: [x(W * 0.44), Math.max(eye, H - 8), z(front - MARGIN)], target: [-W * 0.08, 30, back + D * 0.35], fov: 60 },
  ];
  if (island) {                         // the close-up reads the island against the run instead
    views[3] = { key: 'island', name: 'Low, across the island to the run', pos: [x(island.x + W * 0.22), low, z(island.z + 60)], target: [island.x - W * 0.06, 38, back + 8], fov: 54 };
  }
  return views;
}
