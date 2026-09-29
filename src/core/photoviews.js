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
import { SURFACE_Y } from './units.js';

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

// ---- MAGAZINE PRESETS (render step 6, 2026-09-28: "three camera presets that match how kitchens are
// photographed for magazines ... keep verticals vertical") -----------------------------------------
// Lenses are 35mm full-frame equivalents on a 3:2 landscape frame (24mm tall), so the vertical field
// of view is 2 atan(12 / f). Every camera is LEVEL (target at the camera's own height: verticals stay
// vertical, as with a view camera) and the frame is moved up or down by a LENS SHIFT instead of by
// tilting: `shift` is the fraction of the frame height the picture moves down (Scene.lookFrom applies
// it as a view offset). 0.9 m = 35.4", 1.3 m = 51.2", 1.0 m = 39.4".
//   magazineViews(room, items) -> [straight-on 85mm (70 / 50 / 35 in a smaller room), three-quarter 50mm, detail 100mm]
const IN_PER_M = 39.3701;
export const vfovFor = (mm) => 2 * Math.atan(12 / mm) * 180 / Math.PI;

/** Where two floor cabinets meet, nearest the middle of the island (if any) or of the back run. */
export function junctionFor(room = {}, items = []) {
  const D = room.depth || 120;
  const floor = (it) => { const c = getCab(it && it.code); return c && c.placeable && c.type === 'FLOOR' && ((it.rotDeg || 0) % 180) === 0 ? c : null; };
  const pick = (list, faceSign) => {
    const s = list.map((it) => ({ it, c: floor(it) })).filter((q) => q.c).sort((a, b) => a.it.x - b.it.x);
    const js = [];
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i], ea = a.it.x + a.c.w / 2, sb = b.it.x - b.c.w / 2;
      if (Math.abs(ea - sb) < 0.6 && Math.abs(a.it.z - b.it.z) < 2) js.push({ x: (ea + sb) / 2, z: a.it.z + faceSign * a.c.d / 2, island: !!a.it.island });
    }
    if (!js.length) return null;
    const mid = (s[0].it.x - s[0].c.w / 2 + s[s.length - 1].it.x + s[s.length - 1].c.w / 2) / 2;
    return js.sort((p, q) => Math.abs(p.x - mid) - Math.abs(q.x - mid))[0];
  };
  // the island: flagged, or (a saved file before the planner flags it) standing well off the back wall
  const onIsland = (it) => it.island || it.z > -D / 2 + 40;
  const isl = pick((items || []).filter((it) => onIsland(it) && ((it.rotDeg || 0) % 360) === 0), 1);
  if (isl) return { ...isl, island: true };
  return pick((items || []).filter((it) => !onIsland(it)), 1);
}

export function magazineViews(room = {}, items = []) {
  const W = room.width || 144, D = room.depth || 120, H = room.height || 96;
  const back = -D / 2, front = D / 2, M = 6;
  const { runX } = focus(room, items);
  const face = back + 24.5;                               // the fronts of the back run
  // centreY: the height (inches, on the fronts) the frame centres on, or a function of the frame's
  // height there, for a frame that has to reach a given line (the straight-on's floor)
  const view = (key, name, mm, pos, aimXZ, centreY) => {
    const fov = vfovFor(mm), dist = Math.hypot(aimXZ[0] - pos[0], aimXZ[1] - pos[2]);
    const frameH = 2 * dist * Math.tan(fov * Math.PI / 360);
    const cy = typeof centreY === 'function' ? centreY(frameH) : centreY;
    // a real shift lens moves the frame about half its height (12mm on the 24mm-tall frame), no more
    const shift = clamp((pos[1] - cy) / frameH, -0.5, 0.5);
    return { key, name, pos, target: [aimXZ[0], pos[1], aimXZ[1]], fov, lens: mm, shift: +shift.toFixed(4) };
  };
  const h09 = Math.min(0.9 * IN_PER_M, H - 10), h13 = Math.min(1.3 * IN_PER_M, H - 10), h10 = Math.min(1.0 * IN_PER_M, H - 10);
  // 1. straight on, one-point perspective: as far back as the room allows, square to the run, on the
  //    working bay (the window over the sink when there is one, else the middle of the run)
  const win = (room.openings || []).find((o) => o.type === 'window' && (o.wall || 'back') === 'back');
  const bayX = win ? clamp(-W / 2 + (win.pos ?? 0.5) * W, -W / 2 + 20, W / 2 - 20) : runX;
  //    At 0.9 m, with the frame's bottom 2" below the floor line so the plinth is always in (her catch
  //    2026-09-29: at 1.2 m it cut the plinth off). The lens is the longest that takes in the floor to
  //    6" over the worktop from here, as a photographer would change lens in a small room.
  const dStraight = front - M - face, reach = SURFACE_Y + 6 + 2;
  const mmStraight = [85, 70, 50, 35].find((mm) => 2 * dStraight * Math.tan(vfovFor(mm) * Math.PI / 360) >= reach) || 35;
  const a = view('mag-straight', `Magazine: straight on, ${mmStraight}mm at 0.9 m`, mmStraight, [bayX, h09, front - M], [bayX, face], (fh) => fh / 2 - 2);
  // 2. three-quarter from the far front corner, 50mm, across the run
  const cx = runX >= 0 ? -1 : 1;                           // the corner across from where the run sits
  const b = view('mag-three-quarter', 'Magazine: three-quarter, 50mm at 1.3 m', 50, [cx * (W / 2 - M - 2), h13, front - M - 2], [runX - cx * W * 0.08, back + 14], 38);   // down to the plinth line
  // 3. a tight detail of a junction (an island's, else the back run's), 100mm at 1.0 m
  const j = junctionFor(room, items) || { x: runX, z: face };
  const dz = Math.min(100, (j.island ? front - M : front - M) - j.z);
  const c = view('mag-detail', j.island ? 'Magazine: island junction, 100mm at 1.0 m' : 'Magazine: cabinet junction, 100mm at 1.0 m', 100, [j.x + 4, h10, j.z + dz], [j.x, j.z], 30);
  return [a, b, c];
}
