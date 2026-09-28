// roomstyle.js — PURE. The floor and wall colour tables, shared by the 3D room (scene/Room.js)
// and the exporters (core/dxf.js draws the floor slab and extruded walls in these colours), so a
// kitchen leaves in the colours it was designed in. Keys are saved in designs: never rename one.
export const FLOORS = {
  oak: { label: 'Oak', color: 0xc2a27b },
  ash: { label: 'Pale ash', color: 0xd9cab0 },
  walnut: { label: 'Walnut', color: 0x70503a },
  herringbone: { label: 'Oak herringbone', color: 0xbf9e74 },
  tile: { label: 'Limestone', color: 0xd7d1c4 },
  slate: { label: 'Slate', color: 0x5b5e61 },
  checker: { label: 'Checkerboard', color: 0x8c8b88 },
  terrazzo: { label: 'Terrazzo', color: 0xe5e0d5 },
  concrete: { label: 'Concrete', color: 0xb8b5ad },
};
export const WALLS = {
  white: { label: 'White', color: 0xf7f6f2 },     // plain white (her ask 2026-09-17); a hair off pure so it still shades
  chalk: { label: 'Chalk', color: 0xefe9db },
  warm: { label: 'Warm white', color: 0xe7ddca },
  clay: { label: 'Clay', color: 0xd9c4b0 },
  sage: { label: 'Sage', color: 0xc3c7b2 },
  bluegrey: { label: 'Blue gray', color: 0xb7c1c4 },
  charcoal: { label: 'Charcoal', color: 0x6f6f6e },
};

// How painted plaster is lit: the room's walls (scene/Room.js) and anything "painted with the walls"
// (the plaster hood, models/appliances.js) share these, so the hood reads as the same paint on the
// same wall and not a cream box in front of it (her catch 2026-09-28: "it drops in as a chalk color").
export const WALL_PAINT = { roughness: 1, metalness: 0, envMapIntensity: 1 };
// The ceiling in photo mode's closed room (render step 4): a flat, warm ceiling white, whatever the walls are.
export const CEILING = 0xf3efe6;

export const hexOf =(table, key, fallback) => '#' + ((table[key] || {}).color ?? fallback).toString(16).padStart(6, '0');
