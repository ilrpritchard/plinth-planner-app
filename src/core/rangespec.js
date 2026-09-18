// rangespec.js — PURE. One description of a range cooker's face and cooktop so
// the 3D model, the catalogue icon, the elevation and the plan symbol all draw
// the SAME appliance (a 36" is six burners everywhere, a 48" is six burners,
// a griddle and two ovens everywhere). Inches. Appliances are placeholders,
// not PL/NTH products: this is layout context, never a manufacturer's spec.

/** @returns {{cols:number, griddle:boolean, sections:number, ovens:{x0:number,x1:number}[], knobs:number,
 *            kickH:number, doorY0:number, doorY1:number, railY0:number, railY1:number}} */
export function rangeSpec(cab) {
  const w = cab.w, h = cab.h;
  const griddle = w >= 46;                       // 48": six burners + a griddle
  const cols = w >= 34 ? 3 : 2;                  // burner columns (two burners deep)
  const sections = cols + (griddle ? 1 : 0);
  // oven doors across the face, as fractions-free inch spans from the left edge
  const m = 1.1, gap = 0.5;                      // side margin, gap between twin doors
  const ovens = griddle
    ? [{ x0: m, x1: m + (w - 2 * m - gap) * 0.62 }, { x0: m + (w - 2 * m - gap) * 0.62 + gap, x1: w - m }]
    : [{ x0: m, x1: w - m }];
  return {
    cols, griddle, sections, ovens,
    knobs: cols * 2 + (griddle ? 1 : 0) + ovens.length,
    kickH: 3.4,
    doorY0: 4.0, doorY1: h * 0.765,              // door zone, floor-up
    railY0: h * 0.79, railY1: h * 0.985,         // control rail zone
  };
}

/** Burner centres on the cooktop, local inches: x from the range's centre,
 *  z from the cooktop centre (front = +). Plus the griddle rectangle if any. */
export function rangeCooktop(cab) {
  const s = rangeSpec(cab);
  const w = cab.w, d = cab.d;
  const secW = (w - 2.6) / s.sections;
  const burners = [];
  // burner columns fill from the left; a 48"'s griddle takes the last section
  for (let c = 0; c < s.cols; c++) {
    const cx = -w / 2 + 1.3 + secW * (c + 0.5);
    for (const rz of [-1, 1]) burners.push({ x: cx, z: rz * d / 5.2, r: Math.min(secW / 4.6, d / 5.8) });
  }
  const gx = -w / 2 + 1.3 + secW * (s.cols + 0.5);
  return { secW, burners, griddle: s.griddle ? { x: gx, z: 0.2, w: secW - 1.2, d: d - 4.4 } : null };
}

/** A drop-in cooktop's burners and knobs, local inches (x across, z front = +).
 *  30" = four burners; 36" = five, with the big one in the middle. Knobs run
 *  along the front edge. Shared by the 3D model and the catalogue icon. */
export function hobSpec(cab) {
  const w = cab.w, d = cab.d, five = w >= 34;
  const bx = w * (five ? 0.33 : 0.25), bz = d * 0.19, back = -d * 0.06;
  const burners = [
    { x: -bx, z: back - bz, r: 2.0 }, { x: bx, z: back - bz, r: 2.4 },      // back row: simmer, medium
    { x: -bx, z: back + bz, r: 2.7 }, { x: bx, z: back + bz, r: 2.0 },      // front row: power, simmer
  ];
  if (five) burners.push({ x: 0, z: back, r: 3.1 });                         // the wok burner
  const n = burners.length, span = Math.min(w * 0.5, n * 2.6);
  const knobs = burners.map((_, i) => ({ x: -span / 2 + (span * i) / (n - 1), z: d / 2 - 1.7 }));
  return { burners, knobs };
}

