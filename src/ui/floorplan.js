// floorplan.js — black-and-white architectural floor plan (SVG) in real inches.
// Fine hairline weights to match Plinth's elevation sheets. Double-line walls,
// base cabinets solid / upper cabinets dashed, door-swing arcs, and tiered
// dimensions: individual cabinet widths → overall cabinet run → wall length.

import { getCab, FAMILY_LABEL } from '../core/catalogue.js';
import { fmtFeetIn, fmtIn, SPEC, mmToIn } from '../core/units.js';
import { openingCenter, openingWidth } from '../core/openings.js';
import { computeFillers } from '../core/fillers.js';

const FRONT_FRAME = mmToIn(22); // 22mm face frame at the front
const PANEL18 = mmToIn(18);     // 18mm sides & back

const WALL_T = 4;
const MARGIN = 52;
const INK = '#1a1a1a';
const DIM = '#8a8378';
const UPPER = '#888';
const SWING = '#bdbdbd';     // light grey for door swings / drawer pulls
const LEG = SPEC.LEG_IN;     // 22mm leg each side — doors sit between the legs

// hairline widths in *pixels* (non-scaling) so they stay fine at any zoom
const W_WALL_OUT = 1.2, W_WALL_IN = 0.8, W_CAB = 0.7, W_UPPER = 0.6, W_SWING = 0.5, W_DIM = 0.5;
const W_18 = 0.38;       // lighter weight for the 18mm carcass parts
const ARROW = 1.7;       // arrowhead size (in)
const F_CODE = 3.4;      // cabinet code text
const F_DIM = 3.4;       // dimension text

export function buildFloorplanSVG(state, underlay = null) {
  const r = state.room;
  const W = r.width, D = r.depth;
  const minX = -W / 2, maxX = W / 2, minZ = -D / 2, maxZ = D / 2;
  const out = [];

  // optional uploaded sketch, scaled to its real width, sat behind the drawing
  if (underlay && underlay.show && underlay.src && underlay.widthIn > 0) {
    const iw = underlay.widthIn;
    const ih = iw / (underlay.aspect || 1.4);
    out.push(`<image href="${underlay.src}" x="${n(-iw / 2)}" y="${n(-ih / 2)}" width="${n(iw)}" height="${n(ih)}" opacity="${underlay.opacity ?? 0.5}" preserveAspectRatio="none"/>`);
  }

  // ---- walls: double-line outline (clean, unbroken) ----
  out.push(rect(minX - WALL_T, minZ - WALL_T, W + 2 * WALL_T, D + 2 * WALL_T, W_WALL_OUT));
  out.push(rect(minX, minZ, W, D, W_WALL_IN));

  // ---- openings, TO SCALE: windows (sill lines) and doors (break + swing),
  // with a corner → near-edge dimension so the drawing reads like a survey ----
  for (const o of (r.openings || [])) drawOpeningPlan(out, r, o);

  // ---- cabinets (base solid, upper dashed) ----
  for (const it of state.items) {
    const cab = getCab(it.code);
    if (!cab || !cab.placeable) continue;
    drawCabinet(out, it, cab);
  }

  // ---- scribe fillers: hatched panels closing run-to-wall gaps ----
  for (const f of computeFillers(state)) {
    const horiz = ((f.rotDeg || 0) % 180) === 0;
    const fw = horiz ? f.w : f.d, fd = horiz ? f.d : f.w;
    const fx0 = f.x - fw / 2, fz0 = f.z - fd / 2;
    out.push(`<rect x="${n(fx0)}" y="${n(fz0)}" width="${n(fw)}" height="${n(fd)}" fill="none" stroke="${INK}" stroke-width="${W_CAB}" vector-effect="non-scaling-stroke"/>`);
    // diagonal hatch = "site-scribed panel"
    for (let t = 0.25; t < 1; t += 0.25) {
      out.push(line(fx0, fz0 + fd * t, fx0 + fw * t, fz0, W_18, '#9a9a9a'));
      out.push(line(fx0 + fw * t, fz0 + fd, fx0 + fw, fz0 + fd * t, W_18, '#9a9a9a'));
    }
    if (fw >= 4 || fd >= 4) {
      out.push(`<text x="${n(f.x)}" y="${n(f.z)}" font-size="2.4" fill="#666" text-anchor="middle" dominant-baseline="central"${horiz ? '' : ` transform="rotate(-90 ${n(f.x)} ${n(f.z)})"`}>FILL ${fmtIn(f.w)}</text>`);
    }
  }

  // ---- dimensions ----
  drawWallDims(out, state, 'back');
  drawWallDims(out, state, 'left');
  drawIslandDims(out, state);

  // ---- key: every code on the drawing → product name + nominal size ----
  const keyW = drawKey(out, state, maxX + WALL_T + 18, minZ - WALL_T);

  const vbX = minX - MARGIN, vbY = minZ - MARGIN, vbW = W + 2 * MARGIN + keyW, vbH = D + 2 * MARGIN;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vbX)} ${n(vbY)} ${n(vbW)} ${n(vbH)}" font-family="ui-sans-serif, Arial, sans-serif">
    <rect x="${n(vbX)}" y="${n(vbY)}" width="${n(vbW)}" height="${n(vbH)}" fill="#fff"/>
    ${out.join('\n')}
  </svg>`;
}

// ---- key / legend --------------------------------------------------------
// Lists each distinct code once: "2× F18 — Floor Drawers (3) · 24 × 24 × 35".
// Returns the extra viewBox width it needs (0 when the plan is empty).
function drawKey(out, state, x0, y0) {
  const counts = new Map();
  for (const it of state.items) {
    const c = getCab(it.code);
    if (!c || !c.placeable) continue;
    counts.set(c.code, (counts.get(c.code) || 0) + 1);
  }
  if (!counts.size) return 0;
  const order = { FLOOR: 0, WALL: 1, SHELF: 2, COUNTER: 3, TALL: 4, APPLIANCES: 5 };
  const rows = [...counts.entries()]
    .map(([code, qty]) => ({ code, qty, cab: getCab(code) }))
    .sort((a, b) => (order[a.cab.type] - order[b.cab.type]) || a.code.localeCompare(b.code, 'en', { numeric: true }));

  // table columns (offsets from x0, in drawing inches)
  const COL = { qty: 0, code: 8, type: 20, desc: 38, w: 92, d: 102, h: 112 };
  const TBL_W = 120;
  const ROW = 5.6;

  out.push(`<text x="${n(x0)}" y="${n(y0 + 3)}" font-size="4" fill="${INK}" font-weight="bold" letter-spacing="1">KEY</text>`);
  let y = y0 + 10;
  // header row
  const th = (dx, t, anchor = 'start') =>
    `<tspan x="${n(x0 + dx)}"${anchor === 'end' ? ` text-anchor="end"` : ''}>${t}</tspan>`;
  out.push(`<text y="${n(y)}" font-size="2.6" fill="${DIM}" letter-spacing="0.5">${th(COL.qty, 'QTY')}${th(COL.code, 'CODE')}${th(COL.type, 'TYPE')}${th(COL.desc, 'DESCRIPTION')}${th(COL.w + 6, 'W', 'end')}${th(COL.d + 6, 'D', 'end')}${th(COL.h + 6, 'H', 'end')}</text>`);
  y += 2;
  out.push(line(x0, y, x0 + TBL_W, y, W_DIM, INK));
  y += 4.6;
  for (const r of rows) {
    const fam = r.cab.type === 'APPLIANCES' ? 'Appliance' : FAMILY_LABEL[r.cab.type];
    const td = (dx, t, opts = '') => `<tspan x="${n(x0 + dx)}"${opts}>${t}</tspan>`;
    out.push(`<text y="${n(y)}" font-size="3" fill="#333">${td(COL.qty, r.qty)}${td(COL.code, r.cab.baseCode || r.code, ' font-weight="bold"')}${td(COL.type, fam + (r.cab.notSupplied ? ' *' : ''))}${td(COL.desc, esc(r.cab.desc))}${r.cab.h ? `${td(COL.w + 6, fmtIn(r.cab.w), ' text-anchor="end"')}${td(COL.d + 6, fmtIn(r.cab.d), ' text-anchor="end"')}${td(COL.h + 6, fmtIn(r.cab.h), ' text-anchor="end"')}` : ''}</text>`);
    y += 1.8;
    out.push(line(x0, y, x0 + TBL_W, y, W_DIM * 0.5, '#ddd6c8'));
    y += ROW - 1.8;
  }
  if (rows.some((r) => r.cab.notSupplied)) {
    y += 1;
    out.push(`<text x="${n(x0)}" y="${n(y)}" font-size="2.6" fill="${DIM}">* appliance shown for layout only — not supplied by PL/NTH</text>`);
  }
  return TBL_W + 18;
}

// ---- openings on the plan -------------------------------------------------
function drawOpeningPlan(out, room, o) {
  const wall = o.wall || 'back';
  const w = openingWidth(o, room);
  const c = openingCenter(room, o);
  const W2 = room.width / 2, D2 = room.depth / 2;
  const isDoor = o.type === 'door' || o.type === 'doorway';
  const horiz = wall === 'back' || wall === 'front';

  // white break in the wall band + jamb lines at the cut ends
  let bx, bz, bw, bh;
  if (wall === 'back') { bx = c - w / 2; bz = -D2 - WALL_T; bw = w; bh = WALL_T; }
  else if (wall === 'front') { bx = c - w / 2; bz = D2; bw = w; bh = WALL_T; }
  else if (wall === 'left') { bx = -W2 - WALL_T; bz = c - w / 2; bw = WALL_T; bh = w; }
  else { bx = W2; bz = c - w / 2; bw = WALL_T; bh = w; }
  out.push(`<rect x="${n(bx)}" y="${n(bz)}" width="${n(bw)}" height="${n(bh)}" fill="#fff"/>`);
  if (horiz) {
    out.push(line(bx, bz, bx, bz + bh, W_WALL_IN), line(bx + bw, bz, bx + bw, bz + bh, W_WALL_IN));
    if (!isDoor) for (const f of [0.35, 0.65]) out.push(line(bx, bz + bh * f, bx + bw, bz + bh * f, W_18));
  } else {
    out.push(line(bx, bz, bx + bw, bz, W_WALL_IN), line(bx, bz + bh, bx + bw, bz + bh, W_WALL_IN));
    if (!isDoor) for (const f of [0.35, 0.65]) out.push(line(bx + bw * f, bz, bx + bw * f, bz + bh, W_18));
  }

  if (isDoor) {
    // leaf + quarter swing into the room, hinged on the near-corner jamb
    let H, E, L;                       // hinge, leaf end, latch (arc end)
    if (wall === 'back') { H = [c - w / 2, -D2]; E = [c - w / 2, -D2 + w]; L = [c + w / 2, -D2]; }
    else if (wall === 'front') { H = [c - w / 2, D2]; E = [c - w / 2, D2 - w]; L = [c + w / 2, D2]; }
    else if (wall === 'left') { H = [-W2, c - w / 2]; E = [-W2 + w, c - w / 2]; L = [-W2, c + w / 2]; }
    else { H = [W2, c - w / 2]; E = [W2 - w, c - w / 2]; L = [W2, c + w / 2]; }
    out.push(seg(H, E, W_SWING, SWING));
    const cross = (E[0] - H[0]) * (L[1] - H[1]) - (E[1] - H[1]) * (L[0] - H[0]);
    out.push(arc(E[0], E[1], L[0], L[1], w, 0, cross > 0 ? 1 : 0, W_SWING, SWING));

    // corner → near-edge dimension, in the outer margin (survey-style)
    const near = c - w / 2;
    if (wall === 'front') out.push(dimH(-W2, near, D2 + WALL_T + 7, fmtIn(near + W2)));
    else if (wall === 'back') out.push(dimH(-W2, near, -D2 - WALL_T - 31, fmtIn(near + W2)));
    else if (wall === 'left') out.push(dimV(-D2, near, -W2 - WALL_T - 31, fmtIn(near + D2)));
    else out.push(dimV(-D2, near, W2 + WALL_T + 7, fmtIn(near + D2)));
  }
}

// ---- cabinet ------------------------------------------------------------
function drawCabinet(out, it, cab) {
  const th = (it.rotDeg || 0) * Math.PI / 180;
  const fx = Math.sin(th), fz = Math.cos(th);   // front (into room)
  const wx = Math.cos(th), wz = -Math.sin(th);  // width axis
  const w = cab.w, d = cab.d;
  const c = [it.x, it.z];
  const corner = (sw, sd) => [
    c[0] + wx * (sw * w / 2) + fx * (sd * d / 2),
    c[1] + wz * (sw * w / 2) + fz * (sd * d / 2),
  ];
  const p1 = corner(-1, -1), p2 = corner(1, -1), p3 = corner(1, 1), p4 = corner(-1, 1);
  // overhead things draw dashed: wall/counter uppers AND high-mounted
  // appliances (the extractor hood) — so the range below stays readable
  const upper = cab.type === 'WALL' || cab.type === 'COUNTER' || (cab.mountY || 0) >= 40;
  const isAppliance = cab.type === 'APPLIANCES';
  const dash = upper ? ' stroke-dasharray="3.5 2.5"' : '';
  out.push(`<polygon points="${pt(p1)} ${pt(p2)} ${pt(p3)} ${pt(p4)}" fill="${upper ? 'none' : '#fff'}" stroke="${upper ? UPPER : INK}" stroke-width="${upper ? W_UPPER : W_CAB}" vector-effect="non-scaling-stroke"${dash}/>`);

  // ---- carcass: 22mm front frame straight across, 18mm sides & back ----
  // L maps a local point (along width, along depth-from-centre, front = +) to world
  const L = (lx, ld) => [c[0] + wx * lx + fx * ld, c[1] + wz * lx + fz * ld];
  if (!isAppliance) {
    const xi = w / 2 - PANEL18;                 // 18mm in from each side
    const dFront = d / 2 - FRONT_FRAME;          // 22mm in from the front
    const dBack = -(d / 2 - PANEL18);            // 18mm in from the back
    const frontStroke = upper ? UPPER : INK;
    const thinStroke = upper ? UPPER : '#9a9a9a';
    // 22mm front frame — full width, normal weight
    out.push(seg(L(-w / 2, dFront), L(w / 2, dFront), W_CAB, frontStroke, dash));
    // …divided as it's BUILT (client spec): 22mm leg · door · 22mm leg — two
    // ticks close the leg blocks at the front corners so the plan reads the
    // frame construction, overall X = 22 + opening + 22. The dishwasher panel
    // is legless (full-width front, no ticks); uppers stay uncluttered.
    if (!upper && cab.form !== 'dishwasher') {
      const legIn = w / 2 - LEG;                // inner face of each leg
      out.push(seg(L(-legIn, dFront), L(-legIn, d / 2), W_CAB, frontStroke, dash));
      out.push(seg(L(legIn, dFront), L(legIn, d / 2), W_CAB, frontStroke, dash));
    }
    // 18mm back — full width, lighter
    out.push(seg(L(-w / 2, dBack), L(w / 2, dBack), W_18, thinStroke, dash));
    // 18mm sides — run front to back, lighter
    out.push(seg(L(-xi, dBack), L(-xi, dFront), W_18, thinStroke, dash));
    out.push(seg(L(xi, dBack), L(xi, dFront), W_18, thinStroke, dash));
  }

  // ---- door swings / drawer pull-outs (light grey, between the legs) ----
  if (!upper && !isAppliance) {
    const frontC = [c[0] + fx * d / 2, c[1] + fz * d / 2];
    const openHalf = w / 2 - LEG;

    for (const dr of formDoors(cab, it)) {
      const hinge = [frontC[0] + wx * (dr.hinge * openHalf), frontC[1] + wz * (dr.hinge * openHalf)];
      const openEnd = [hinge[0] + fx * dr.dw, hinge[1] + fz * dr.dw];
      const closedEnd = [hinge[0] - wx * (dr.hinge * dr.dw), hinge[1] - wz * (dr.hinge * dr.dw)];
      out.push(line(hinge[0], hinge[1], openEnd[0], openEnd[1], W_SWING, SWING));
      const cross = (closedEnd[0] - hinge[0]) * (openEnd[1] - hinge[1]) - (closedEnd[1] - hinge[1]) * (openEnd[0] - hinge[0]);
      out.push(arc(closedEnd[0], closedEnd[1], openEnd[0], openEnd[1], dr.dw, 0, cross > 0 ? 1 : 0, W_SWING, SWING));
    }
    if (cab.form === 'drawers' || cab.form === 'larderDrawers' || cab.form === 'bin') {
      const ext = Math.min(d * (cab.form === 'larderDrawers' ? 0.55 : 0.8), cab.form === 'larderDrawers' ? 12 : 21);
      const fl = [frontC[0] - wx * openHalf, frontC[1] - wz * openHalf];
      const fr = [frontC[0] + wx * openHalf, frontC[1] + wz * openHalf];
      const el = [fl[0] + fx * ext, fl[1] + fz * ext];
      const er = [fr[0] + fx * ext, fr[1] + fz * ext];
      out.push(`<polyline points="${pt(fl)} ${pt(el)} ${pt(er)} ${pt(fr)}" fill="none" stroke="${SWING}" stroke-width="${W_SWING}" vector-effect="non-scaling-stroke" stroke-dasharray="3 2"/>`);
    }
  }

  // ---- code label. Base/tall/appliance: centred. Uppers (which overlap the
  // base run in plan): small grey code tucked at their front-left corner so
  // the two labels never sit on top of each other. Widths live in the
  // dimension CHAIN + the key, not on every box.
  // sized virtual codes (e.g. AP9:36x30x72) label with their short base code —
  // the key's description carries the exact size.
  const codeLabel = cab.baseCode || cab.code;
  if (upper) {
    const lab = L(-w / 2 + 1.8, d / 2 - 1.2);
    out.push(`<text x="${n(lab[0])}" y="${n(lab[1])}" font-size="${F_CODE * 0.8}" fill="${UPPER}" dominant-baseline="central">${codeLabel}</text>`);
  } else {
    const lab = L(0, -d * 0.18);
    out.push(`<text x="${n(lab[0])}" y="${n(lab[1])}" font-size="${F_CODE}" fill="#333" text-anchor="middle" dominant-baseline="central">${codeLabel}</text>`);
  }
}

function formDoors(cab, it) {
  const w = cab.w;
  const openHalf = w / 2 - LEG;        // half the door zone (between the legs)
  const single = w - 2 * LEG;          // full opening width
  const half = openHalf - 0.5;         // each leaf of a pair (small centre reveal)
  const hingeSign = (it.hinge === 'R') ? 1 : -1;
  switch (cab.form) {
    case 'door': case 'glazed': case 'corner':
      return [{ hinge: hingeSign, dw: single }];
    case 'double': case 'glazedDouble':
      return [{ hinge: -1, dw: half }, { hinge: 1, dw: half }];
    case 'larder': case 'larderDrawers':
      return w >= 40 ? [{ hinge: -1, dw: half }, { hinge: 1, dw: half }] : [{ hinge: hingeSign, dw: single }];
    default: return [];
  }
}

// ---- dimensions: chain of unit widths → overall run → wall length --------
// One tidy architectural chain per wall, OUTSIDE the room: tick marks at every
// cabinet joint with each unit's width in its bay (small gaps labelled too),
// then the overall run, then the wall length. Nothing overlaps the drawing.
function drawWallDims(out, state, wall) {
  const r = state.room;
  const minX = -r.width / 2, minZ = -r.depth / 2, maxX = r.width / 2, maxZ = r.depth / 2;
  const horiz = wall === 'back';
  const wallLen = horiz ? r.width : r.depth;

  // the run on this wall: base cabinets, talls AND appliances (a range is part
  // of the chain — leaving it out would read as a hole)
  const cabs = [];
  for (const it of state.items) {
    const cab = getCab(it.code);
    if (!cab || !cab.placeable) continue;
    if (!['FLOOR', 'TALL', 'APPLIANCES'].includes(cab.type)) continue;
    if (cab.type === 'APPLIANCES' && !['range', 'fridge'].includes(cab.appliance)) continue; // sinks/hobs sit IN a base
    const h = ((it.rotDeg || 0) % 180) === 0;
    if (wall === 'back' && h && Math.abs(it.z - (minZ + cab.d / 2 + 0.25)) < 9) cabs.push({ a: it.x, w: cab.w });
    if (wall === 'left' && !h && Math.abs(it.x - (minX + cab.d / 2 + 0.25)) < 9) cabs.push({ a: it.z, w: cab.w });
  }
  cabs.sort((p, q) => p.a - q.a);

  const base = horiz ? (minZ - WALL_T) : (minX - WALL_T);
  const offChain = base - 7, offRun = base - 15, offWall = base - 23;
  const put = (a, b, off, label) => out.push(horiz ? dimH(a, b, off, label) : dimV(a, b, off, label));

  if (cabs.length) {
    // ---- chain: segments for every unit, plus any real gap between units
    const segs = [];
    let cur = null;
    for (const c of cabs) {
      const s = c.a - c.w / 2, e = c.a + c.w / 2;
      if (cur != null && s - cur > 0.75) segs.push({ a: cur, b: s, gap: true });
      segs.push({ a: Math.max(cur ?? s, s), b: e });
      cur = Math.max(cur ?? e, e);
    }
    const lo = segs[0].a, hi = segs[segs.length - 1].b;
    out.push(horiz ? line(lo, offChain, hi, offChain, W_DIM, DIM) : line(offChain, lo, offChain, hi, W_DIM, DIM));
    const tick = (a) => out.push(horiz
      ? line(a - 1, offChain + 1, a + 1, offChain - 1, W_DIM, DIM)
      : line(offChain + 1, a - 1, offChain - 1, a + 1, W_DIM, DIM));
    tick(lo);
    for (const s of segs) {
      tick(s.b);
      const len = s.b - s.a;
      if (len < 5.5) continue;                    // no room for a legible label
      const mid = (s.a + s.b) / 2, txt = fmtIn(len);
      out.push(horiz
        ? `<text x="${n(mid)}" y="${n(offChain - 1.8)}" font-size="${F_DIM * 0.92}" fill="${s.gap ? UPPER : DIM}" text-anchor="middle"${s.gap ? ' font-style="italic"' : ''}>${txt}</text>`
        : `<text x="${n(offChain - 1.8)}" y="${n(mid)}" font-size="${F_DIM * 0.92}" fill="${s.gap ? UPPER : DIM}" text-anchor="middle"${s.gap ? ' font-style="italic"' : ''} transform="rotate(-90 ${n(offChain - 1.8)} ${n(mid)})">${txt}</text>`);
    }
    // ---- overall run
    if (hi - lo > 0.5) put(lo, hi, offRun, fmtIn(hi - lo));
  }

  // ---- overall wall length
  const lo2 = horiz ? minX : minZ, hi2 = horiz ? maxX : maxZ;
  put(lo2, hi2, offWall, fmtFeetIn(wallLen));
}

// island: one chain just in front of the island (labels below the line)
function drawIslandDims(out, state) {
  const seen = new Set();
  const cabs = [];
  let zEdge = -Infinity;
  for (const it of state.items) {
    if (!it.island) continue;
    const cab = getCab(it.code); if (!cab || !cab.placeable) continue;
    zEdge = Math.max(zEdge, it.z + cab.d / 2);
    const key = it.x.toFixed(1) + ':' + cab.w;     // double-sided rows share x — draw once
    if (seen.has(key)) continue;
    seen.add(key);
    cabs.push({ a: it.x, w: cab.w });
  }
  if (!cabs.length) return;
  cabs.sort((p, q) => p.a - q.a);
  const off = zEdge + 6;
  const lo = cabs[0].a - cabs[0].w / 2, hi = cabs[cabs.length - 1].a + cabs[cabs.length - 1].w / 2;
  out.push(line(lo, off, hi, off, W_DIM, DIM));
  const tick = (a) => out.push(line(a - 1, off + 1, a + 1, off - 1, W_DIM, DIM));
  tick(lo);
  for (const c of cabs) {
    tick(c.a + c.w / 2);
    if (c.w >= 5.5) out.push(`<text x="${n(c.a)}" y="${n(off + 4)}" font-size="${F_DIM * 0.92}" fill="${DIM}" text-anchor="middle">${fmtIn(c.w)}</text>`);
  }
  if (hi - lo > 0.5) out.push(dimH(lo, hi, off + 11, fmtIn(hi - lo)));
}

// ---- dimension primitives (thin, gray, small arrowheads) ----------------
function arrow(x, y, dir, horiz) {
  const s = ARROW;
  const p = horiz
    ? `${n(x)},${n(y)} ${n(x + dir * s)},${n(y - s * 0.55)} ${n(x + dir * s)},${n(y + s * 0.55)}`
    : `${n(x)},${n(y)} ${n(x - s * 0.55)},${n(y + dir * s)} ${n(x + s * 0.55)},${n(y + dir * s)}`;
  return `<polygon points="${p}" fill="${DIM}"/>`;
}
function dimH(x1, x2, y, label) {
  return `<line x1="${n(x1)}" y1="${n(y)}" x2="${n(x2)}" y2="${n(y)}" stroke="${DIM}" stroke-width="${W_DIM}" vector-effect="non-scaling-stroke"/>
  ${arrow(x1, y, 1, true)}${arrow(x2, y, -1, true)}
  <text x="${n((x1 + x2) / 2)}" y="${n(y - 2.2)}" font-size="${F_DIM}" fill="${DIM}" text-anchor="middle">${label}</text>`;
}
function dimV(z1, z2, x, label) {
  return `<line x1="${n(x)}" y1="${n(z1)}" x2="${n(x)}" y2="${n(z2)}" stroke="${DIM}" stroke-width="${W_DIM}" vector-effect="non-scaling-stroke"/>
  ${arrow(x, z1, 1, false)}${arrow(x, z2, -1, false)}
  <text x="${n(x - 2.2)}" y="${n((z1 + z2) / 2)}" font-size="${F_DIM}" fill="${DIM}" text-anchor="middle" transform="rotate(-90 ${n(x - 2.2)} ${n((z1 + z2) / 2)})">${label}</text>`;
}

// ---- branded plan sheet (opens in a new window → Print / Save as PDF) ----
export function buildPlanSheetHTML(state, underlay = null) {
  const svg = buildFloorplanSVG(state, underlay);
  const r = state.room;
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const cabCount = (state.items || []).filter((it) => { const c = getCab(it.code); return c && c.placeable && !c.notSupplied; }).length;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PL/NTH — Floor plan</title><style>
    @page { size: letter landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #332318; margin: 0; }
    header { display: flex; justify-content: space-between; align-items: flex-end;
      background: #332318; color: #efebe5; padding: 14px 18px; border-radius: 6px; }
    .brand { font-size: 24px; font-weight: 800; letter-spacing: 3px; }
    .brand .slash { opacity: 0.55; }
    .brand small { display: block; font-size: 10px; font-weight: 400; letter-spacing: 4px; opacity: 0.7; margin-top: 2px; }
    .meta { text-align: right; font-size: 11px; line-height: 1.6; opacity: 0.9; }
    .plan { margin-top: 10px; border: 1px solid #d9cfb8; border-radius: 6px; padding: 6px; }
    .plan svg { display: block; width: 100%; height: auto; max-height: 158mm; }
    footer { display: flex; justify-content: space-between; margin-top: 8px;
      border-top: 1px solid #d9cfb8; padding-top: 6px; font-size: 9px; color: #7a6d54; }
    @media print { header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body>
    <header>
      <div class="brand">PL<span class="slash">/</span>NTH<small>KITCHEN FLOOR PLAN</small></div>
      <div class="meta">Room ${fmtFeetIn(r.width)} × ${fmtFeetIn(r.depth)} × ${fmtFeetIn(r.height)}<br>
        Finish: ${state.finish || '—'} · ${cabCount} cabinets<br>${date} · plinthmade.com</div>
    </header>
    <div class="plan">${svg}</div>
    <footer>
      <span style="max-width:70%">All dimensions in inches (chain shows unit widths; italic figures are site gaps closed by scribe fillers). Cabinet sizes are nominal carcass sizes.<br>
      <strong>Please note:</strong> all room dimensions, openings and services shown are as entered by the client. The client is responsible for checking and confirming every measurement on site before ordering — PL/NTH does not survey or verify site dimensions.</span>
      <span>Made with PL/NNER — the PL/NTH kitchen planner · plinthmade.com</span>
    </footer>
  </body></html>`;
}

// ---- shared drawing style + primitives (reused by the submittal sheets) ---
export const PLAN_STYLE = { INK, DIM, UPPER, SWING, W_WALL_OUT, W_WALL_IN, W_CAB, W_UPPER, W_SWING, W_DIM, W_18, ARROW, F_CODE, F_DIM };
export { rect as svgRect, line as svgLine, dimH as svgDimH, dimV as svgDimV, esc as svgEsc, n as svgN };

// ---- primitives ---------------------------------------------------------
function rect(x, y, w, h, sw, stroke = INK) { return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`; }
function line(x1, y1, x2, y2, sw, stroke = INK) { return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`; }
function arc(x1, y1, x2, y2, r2, large, sweep, sw, stroke = INK) { return `<path d="M ${n(x1)} ${n(y1)} A ${n(r2)} ${n(r2)} 0 ${large} ${sweep} ${n(x2)} ${n(y2)}" fill="none" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`; }
function seg(p1, p2, sw, stroke = INK, dash = '') { return `<line x1="${n(p1[0])}" y1="${n(p1[1])}" x2="${n(p2[0])}" y2="${n(p2[1])}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"${dash}/>`; }
function arrowDir(px, pz, ux, uz) {
  const s = ARROW, ex = px - ux * s, ez = pz - uz * s, nx = -uz, nz = ux;
  return `<polygon points="${n(px)},${n(pz)} ${n(ex + nx * s * 0.55)},${n(ez + nz * s * 0.55)} ${n(ex - nx * s * 0.55)},${n(ez - nz * s * 0.55)}" fill="${DIM}"/>`;
}
function pt(p) { return `${n(p[0])},${n(p[1])}`; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function n(v) { return Math.round(v * 100) / 100; }
