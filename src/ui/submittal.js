// submittal.js — the PL/NTH submittal pack: an architect-ready, multi-page,
// letter-LANDSCAPE document per unit type (cover, plan, wall elevations,
// finish + cabinet schedule, SKU cut sheets, compliance), printed to PDF via
// the hidden-iframe print flow (openPrintWindow).
//
// PL/NTH supplies CABINETS, ready to install. The pack documents those and
// nothing else: appliances and worktops are by others (drawn grey / named "by
// others"), and MEP rough-in is NOT PL/NTH's responsibility — never add
// rough-in sheets back (Imogen's markup, 2026-09-18).
//
// All layout maths lives in src/core/submittal.js (pure, node-tested). This
// file only turns those numbers into SVG + HTML, reusing the floorplan.js
// drawing style so every sheet in the set matches.

import { islandFinish } from '../core/islands.js';
import { withIslandFlags } from '../core/islands.js';
import { getFinish, corniceOption, FAMILY_LABEL, familyOf, fmtUSD } from '../core/catalogue.js';
import { fmtIn, fmtFeetIn } from '../core/units.js';
import { unitName, unitQty } from '../core/cost.js';
import {
  computeElevation, wallsWithItems, scheduleRows, distinctSkus, drawingIndex,
  wallTitle, unitRev, esc, MOUNT, SURFACE_Y, WORKTOP_SLAB, crownLayers, SPEC_SECTION,
  islandSheets, computeIslandElevation, cutSheetPages, CUT_MM_PER_IN, CUT_WELL_MM,
} from '../core/submittal.js';
import { hingeOf, hingeLabel } from '../core/hinge.js';
import { sinkHosts, sinkMinBase, maxSinkCutout } from '../core/sinkspec.js';
import { buildFloorplanSVG, planKeyRows, PLAN_STYLE as P, svgLine, svgDimH, svgDimV, svgN as n } from './floorplan.js';
import { drawFront, frontParts } from './frontdraw.js';
import { uiAlert } from './dialog.js';

// "the Buyer", as in the Terms of Sale: on a trade document "the client" reads
// as a homeowner, and to an architect it means THEIR client, not the orderer.
const DISCLAIMER_BODY = 'All room dimensions, openings and services shown are as entered by the Buyer. The Buyer is responsible for checking and confirming every measurement on site before ordering. PL/NTH does not survey or verify site dimensions.';
// Hardware is supply-only: cabinets ship undrilled, hardware and fitting by
// others. Knobs drawn in the 3D view / elevations are for visualization only.
const HARDWARE_LABEL = 'By others: cabinets supplied undrilled';
const HARDWARE_NOTE = 'Knobs shown on drawings are for visualization only; no holes are drilled';

// ---- scribe filler, hatched exactly like the plan --------------------------
function drawFiller(out, f, Y) {
  const x0 = f.s0, y1 = Y(f.y0 + f.h), fw = f.w, fh = f.h;
  out.push(`<rect x="${n(x0)}" y="${n(y1)}" width="${n(fw)}" height="${n(fh)}" fill="#fff" stroke="${P.INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`);
  // 45-degree diagonal hatch = scribe filler panel, matching the plan style
  const step = Math.max(3, Math.min(6, fw * 1.5));
  for (let t = step; t < fh + fw; t += step) {
    // the line x-x0 + y-y1 = t, clipped to the filler rectangle
    const xa = x0 + Math.max(0, t - fh), ya = y1 + Math.min(t, fh);
    const xb = x0 + Math.min(t, fw), yb = y1 + Math.max(0, t - fw);
    out.push(svgLine(xa, ya, xb, yb, P.W_18, '#9a9a9a'));
  }
  // the label runs up the panel only when the panel is wide enough to hold it: text never
  // spills over a neighbour (her rule 2026-09-30, nothing overlaps on a drawing)
  if (fw >= 2.75) out.push(`<text x="${n(x0 + fw / 2)}" y="${n(y1 + fh / 2)}" font-size="2.4" fill="#666" text-anchor="middle" dominant-baseline="central" transform="rotate(-90 ${n(x0 + fw / 2)} ${n(y1 + fh / 2)})">FILL ${fmtIn(f.w)}</text>`);
}

// ---- the elevation drawing for one wall ------------------------------------
// opts.thumb: the same drawing with nothing written on it (no codes, dimensions or labels) and a
// tight frame, for the unit cards in Project mode.
export function buildElevationSVG(elev, opts = {}) {
  const thumb = !!opts.thumb;
  const L = elev.wallLen, H = elev.height;
  const Y = (y) => H - y;             // world Y (up) → SVG y (down)
  const out = [];

  // wall face + heavier floor + ceiling line (an island face has no wall: floor only)
  if (!elev.island) out.push(`<rect x="0" y="0" width="${n(L)}" height="${n(H)}" fill="none" stroke="${P.INK}" stroke-width="${P.W_WALL_IN}" vector-effect="non-scaling-stroke"/>`);
  out.push(svgLine(elev.island ? -10 : -5, H, L + (elev.island ? 10 : 5), H, P.W_WALL_OUT));

  // openings on this wall, dashed, at their true sill/head heights
  for (const o of elev.openings) {
    out.push(`<rect x="${n(o.s0)}" y="${n(Y(o.y0 + o.h))}" width="${n(o.w)}" height="${n(o.h)}" fill="none" stroke="${P.UPPER}" stroke-width="${P.W_UPPER}" vector-effect="non-scaling-stroke" stroke-dasharray="3.5 2.5"/>`);
    // label INSIDE the opening, under its head: an opening is always clear of cabinets, so the
    // words can never run into a wall unit beside it (they did above the head, 2026-09-30)
    if (!thumb) {
      const cx = n(o.s0 + o.w / 2), top = Y(o.y0 + o.h);
      out.push(`<text x="${cx}" y="${n(top + 4)}" font-size="2.4" fill="${P.UPPER}" text-anchor="middle" letter-spacing="0.4">${esc(o.type.toUpperCase())}</text>`);
      if (o.type === 'window') out.push(`<text x="${cx}" y="${n(top + 7.4)}" font-size="2.4" fill="${P.UPPER}" text-anchor="middle" letter-spacing="0.4">SILL ${fmtIn(o.y0)}</text>`);
    }
  }

  // cabinets at their true x + mount height, drawn with their full
  // master-library fronts (shaker panels, drawer stacks, glazing, returns)
  for (const e of elev.items) out.push(drawFront(e.cab, e.s0, e.y0, Y, thumb ? {} : { code: e.code, hinge: hingeOf(e.cab, e.it), marks: true }));

  // worktop slab over the base runs (35" carcass + 1½" slab = 36½")
  // — it stops DEAD at a butting tall / range / fridge / wall; only an open
  // end carries the lip (1", or 50mm on an island end)
  for (const wt of elev.worktops) {
    const x0 = wt.s0 - (wt.overL ?? 0), x1 = wt.s1 + (wt.overR ?? 0);
    out.push(`<rect x="${n(x0)}" y="${n(Y(SURFACE_Y))}" width="${n(x1 - x0)}" height="${n(WORKTOP_SLAB)}" fill="#efece3" stroke="${P.INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`);
  }

  // scribe fillers, hatched like the plan
  for (const f of elev.fillers) drawFiller(out, f, Y);

  // crown molding over uppers / talls / tall fillers, drawn AS BUILT (a slim
  // 22mm bar, 15mm proud, for the plain crown — never a chunky band). It
  // returns proud of an open end and dies flat into a wall.
  for (const c of elev.crowns) {
    let y = c.top;
    for (const ly of crownLayers(elev.crownProfile)) {
      const x0 = c.s0 <= 3 ? 0 : c.s0 - ly.outer, x1 = L - c.s1 <= 3 ? L : c.s1 + ly.outer;
      out.push(`<rect x="${n(x0)}" y="${n(Y(y + ly.h))}" width="${n(x1 - x0)}" height="${n(ly.h)}" fill="#fff" stroke="${P.INK}" stroke-width="${P.W_18}" vector-effect="non-scaling-stroke"/>`);
      y += ly.h;
    }
  }

  if (thumb) {
    const xs = [...elev.items.map((e) => [e.s0, e.s0 + e.cab.w]), ...elev.fillers.map((f) => [f.s0, f.s0 + f.w])].flat();
    const lo = elev.island ? Math.min(...xs) - 4 : -1, hi = elev.island ? Math.max(...xs) + 4 : L + 1;
    const top = elev.island ? H - 42 : -1;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(lo)} ${n(top)} ${n(hi - lo)} ${n(H + 1.5 - top)}" data-w="${n(hi - lo)}" data-h="${n(H + 1.5 - top)}">${out.join('\n')}</svg>`;
  }
  // right-hand vertical datums: worktop, upper underside, ceiling
  let vx = L + 7;
  if (elev.worktops.length) { out.push(svgDimV(Y(SURFACE_Y), Y(0), vx, fmtIn(SURFACE_Y))); vx += 8; }
  if (elev.items.some((i) => i.type === 'WALL')) { out.push(svgDimV(Y(MOUNT.WALL), Y(0), vx, fmtIn(MOUNT.WALL))); vx += 8; }
  if (!elev.island) out.push(svgDimV(Y(H), Y(0), vx, fmtFeetIn(H)));
  else vx -= 8;

  // bottom chain: unit widths (italic gaps) → overall run → wall length
  const offChain = H + 7, offRun = H + 15, offWall = H + 23;
  const ch = elev.chain;
  if (ch.segs.length) {
    out.push(svgLine(ch.lo, offChain, ch.hi, offChain, P.W_DIM, P.DIM));
    const tick = (a) => out.push(svgLine(a - 1, offChain + 1, a + 1, offChain - 1, P.W_DIM, P.DIM));
    tick(ch.lo);
    for (const s of ch.segs) {
      tick(s.b);
      const len = s.b - s.a;
      if (len < 5.5) continue;
      out.push(`<text x="${n((s.a + s.b) / 2)}" y="${n(offChain - 1.8)}" font-size="${P.F_DIM * 0.92}" fill="${s.gap ? P.UPPER : P.DIM}" text-anchor="middle"${s.gap ? ' font-style="italic"' : ''}>${fmtIn(len)}</text>`);
    }
    // overall run — skipped when the chain is a single unit (it would repeat the same figure)
    if (ch.hi - ch.lo > 0.5 && ch.segs.length > 1) out.push(svgDimH(ch.lo, ch.hi, offRun, fmtIn(ch.hi - ch.lo)));
  }
  if (!elev.island) out.push(svgDimH(0, L, offWall, fmtFeetIn(L)));

  const vbX = elev.island ? -16 : -12, vbY = -8, vbW = vx + 8 - vbX, vbH = (H + (elev.island ? 21 : 29)) - vbY;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vbX)} ${n(vbY)} ${n(vbW)} ${n(vbH)}"${elev.island ? ` style="max-width:${n(Math.min(100, (vbW / ((elev.refLen || vbW) + 43)) * 130))}%"` : ''} font-family="ui-sans-serif, Arial, sans-serif">
    <rect x="${n(vbX)}" y="${n(vbY)}" width="${n(vbW)}" height="${n(vbH)}" fill="#fff"/>
    ${out.join('\n')}
  </svg>`;
}

// ---- small SKU glyph for the cut sheets ------------------------------------
export function skuGlyphSVG(cab, hinge = null) {
  const out = [];
  const Y = (y) => cab.h - y;
  out.push(drawFront(cab, 0, 0, Y, { hinge, marks: true }));
  const fp = frontParts(cab);           // corner returns widen the drawn extent
  out.push(svgDimH(fp.x0, fp.x1, cab.h + 7, fmtIn(fp.x1 - fp.x0)));
  out.push(svgDimV(0, cab.h, fp.x0 - 6, fmtIn(cab.h)));
  const vb = `${n(fp.x0 - 16)} -4 ${n(fp.x1 - fp.x0 + 28)} ${n(cab.h + 18)}`;
  // constant mm-per-inch so every glyph on the sheet is mutually to scale
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" style="height:${((cab.h + 18) * CUT_MM_PER_IN).toFixed(1)}mm" font-family="ui-sans-serif, Arial, sans-serif">${out.join('\n')}</svg>`;
}

// ---- ARCHITECTURAL SHEETS (W2W-252, her ask 2026-09-30: "make them look more architectural") ----
// Every sheet is a drawing-set sheet: a double-line border and a title block strip down the right
// (wordmark, issue, revisions, sheet notes, reviewer stamp, field verification, project, cabinet
// color, drawing title, scale / date / section / rev, the sheet number). Drawings print at a TRUE
// architectural scale (the largest standard one that fits the field), each with a split bubble
// (drawing no. over sheet no.), an underlined title, its scale and a graphic scale bar. The plan
// carries interior elevation markers pointing at the elevation sheets, and a plan-north arrow.
// Letter landscape, @page margin 0: the sheet is the paper.

// the field a drawing (plus its title) may fill, mm: sheet 279.4 x 215.9, less the margin,
// the frame and the 52mm title block
const FIELD_W = 196, FIELD_H = 168, FIELD_IN_H = 188, KEY_W = 80;
const SCALES = [[1, '1" = 1\'-0"'], [0.75, '3/4" = 1\'-0"'], [0.5, '1/2" = 1\'-0"'], [0.375, '3/8" = 1\'-0"'],
  [0.25, '1/4" = 1\'-0"'], [0.1875, '3/16" = 1\'-0"'], [0.125, '1/8" = 1\'-0"']];
const mmPerIn = (f) => 25.4 * f / 12;
/** The largest standard scale at which a drawing vbW x vbH (inches) fits maxW x maxH (mm). */
export function pickScale(vbW, vbH, maxW, maxH) {
  for (const [f, label] of SCALES) {
    const mm = mmPerIn(f);
    if (vbW * mm <= maxW && vbH * mm <= maxH) return { mm, label };
  }
  const [f, label] = SCALES[SCALES.length - 1];
  return { mm: mmPerIn(f), label };
}
const vbOf = (svg) => svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
/** Pin an SVG to its printed size in mm, and keep every word at least 2mm tall on paper. */
function atScale(svg, sc) {
  const [, , w, h] = vbOf(svg);
  return svg
    .replace(/ style="max-width:[^"]*"/, '')
    .replace('<svg ', `<svg width="${(w * sc.mm).toFixed(2)}mm" height="${(h * sc.mm).toFixed(2)}mm" `)
    .replace(/font-size="([\d.]+)"/g, (m, v) => `font-size="${n(Math.max(+v, 2.1 / sc.mm))}"`);
}

const INK = '#1f1e1b';
function scaleBar(mm) {
  const ft = 12 * mm, W = 4 * ft;
  const bars = [[0, 1], [1, 2], [2, 4]].map(([a, b], i) =>
    `<rect x="${n(a * ft)}" y="0" width="${n((b - a) * ft)}" height="1.3" fill="${i % 2 ? '#fff' : INK}" stroke="${INK}" stroke-width="0.18"/>`).join('');
  const nums = [0, 1, 2, 4].map((v) => `<text x="${n(v * ft)}" y="3.9" font-size="1.9" text-anchor="middle">${v ? `${v}'` : '0'}</text>`).join('');
  return `<svg class="sb" width="${n(W + 4)}mm" height="4.6mm" viewBox="-1.5 -0.3 ${n(W + 4)} 4.6">${bars}${nums}</svg>`;
}
/** Split bubble: drawing number over sheet number. */
function bubble(num, sheetNo, size = 11) {
  return `<svg class="bub" width="${size}mm" height="${size}mm" viewBox="0 0 11 11"><circle cx="5.5" cy="5.5" r="5.1" fill="#fff" stroke="${INK}" stroke-width="0.3"/><line x1="0.4" y1="5.5" x2="10.6" y2="5.5" stroke="${INK}" stroke-width="0.2"/><text x="5.5" y="4.3" font-size="3.3" font-weight="600" text-anchor="middle">${num}</text><text x="5.5" y="8.6" font-size="1.9" text-anchor="middle">${esc(sheetNo)}</text></svg>`;
}
const drawingTitle = (num, sheetNo, title, sc) => `<div class="dt">${bubble(num, sheetNo)}<div class="dt-t"><div class="dt-name">${title}</div><div class="dt-scale"><span>Scale ${esc(sc.label)}</span>${scaleBar(sc.mm)}</div></div></div>`;

// interior elevation markers on the plan: one circle in the room, a solid triangle toward each
// wall that has an elevation sheet, labelled drawing / sheet
const MARK_DIR = { back: [0, -1], left: [-1, 0], right: [1, 0], front: [0, 1] };
function elevationMarkers(design, idx) {
  const walls = wallsWithItems(design);
  if (!walls.length) return '';
  const r = 5, cx = 0, cy = Math.min(16, (design.room?.depth || 120) / 2 - 20);
  let tris = '', labels = '';
  walls.forEach((w, i) => {
    const [dx, dy] = MARK_DIR[w] || [0, -1];
    const px = -dy, py = dx;
    const tip = `${n(cx + dx * r * 1.75)},${n(cy + dy * r * 1.75)}`;
    tris += `<path d="M ${tip} L ${n(cx + px * r * 1.12)},${n(cy + py * r * 1.12)} L ${n(cx - px * r * 1.12)},${n(cy - py * r * 1.12)} Z" fill="${INK}"/>`;
    labels += `<text x="${n(cx + dx * (r + 9))}" y="${n(cy + dy * (r + 9))}" font-size="4" fill="${INK}" text-anchor="${dx < 0 ? 'end' : dx > 0 ? 'start' : 'middle'}" dominant-baseline="central">${i + 1}/${esc(idx[2 + i].no)}</text>`;
  });
  return `<g>${tris}<circle cx="${cx}" cy="${n(cy)}" r="${r}" fill="#fff" stroke="${INK}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>${labels}</g>`;
}
const NORTH = `<svg class="north" width="18mm" height="17mm" viewBox="0 0 18 17"><circle cx="9" cy="7.2" r="5" fill="none" stroke="${INK}" stroke-width="0.25"/><path d="M9 1 L11.3 10.2 L9 8.7 L6.7 10.2 Z" fill="${INK}"/><text x="9" y="15.8" font-size="1.9" text-anchor="middle" letter-spacing="0.25">PLAN NORTH</text></svg>`;

// ---- title block ------------------------------------------------------------------
const chip = (c) => `<span class="chip"><i style="background:${c.hex}"></i>${c.name}</span>`;
/** The strip down the right of every sheet. `ctx` is the document's (project, address, unit line,
 *  date, revision rows, colors, sheet list); `s` the sheet's own (no, title, scale, notes, action). */
function titleBlock(ctx, s) {
  const i = ctx.idx ? ctx.idx.findIndex((d) => d.no === s.no) : -1;
  const revRows = [...ctx.revRows, ['', '', ''], ['', '', '']].slice(0, Math.max(3, ctx.revRows.length))
    .map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
  return `<aside class="tb">
    <div class="tb-brand"><div class="wm">PL<span>/</span>NTH</div><div class="tb-sub">Cabinets<br>plinthmade.com</div></div>
    <div class="tb-cell tb-issue"><span class="k">Issue</span><span class="issue">For approval</span></div>
    <div class="tb-cell"><span class="k">Revisions</span><table class="rev"><tr><th>Rev</th><th>Date</th><th>Description</th></tr>${revRows}</table></div>
    ${s.notes && s.notes.length ? `<div class="tb-cell tb-notes"><span class="k">Sheet notes</span><ol>${s.notes.filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>` : ''}
    <div class="tb-cell tb-grow"><span class="k">${s.action ? 'Submittal action' : 'Reviewer stamp'}</span>${s.action ? `<div class="act"><span><i></i>Approved</span><span><i></i>Approved as noted</span><span><i></i>Revise &amp; resubmit</span><div class="act-l"><span>By</span><span>Date</span></div></div>` : ''}</div>
    <div class="tb-cell tb-fv"><span class="k">Field verification</span>${esc(DISCLAIMER_BODY)}</div>
    <div class="tb-cell tb-proj"><span class="k">Project</span>${ctx.projectName ? `<div class="pn">${esc(ctx.projectName)}</div>` : ''}${ctx.address ? `<div>${esc(ctx.address)}</div>` : ''}<div class="mut">${ctx.unitLine}</div></div>
    ${ctx.colors && ctx.colors.length ? `<div class="tb-cell tb-fin"><span class="k">Cabinet color</span><div class="chips">${ctx.colors.map(chip).join('')}</div></div>` : ''}
    <div class="tb-cell tb-title"><span class="k">Drawing title</span><div class="tt">${s.title}</div></div>
    <div class="tb-grid">
      <div><span class="k">Scale</span>${esc(s.scale || 'NTS')}</div><div><span class="k">Date</span>${esc(ctx.date)}</div>
      <div><span class="k">Section</span>${esc(SPEC_SECTION.split(' —')[0])}</div><div><span class="k">Rev</span>${esc(ctx.rev)}</div>
    </div>
    <div class="tb-no"><span class="k">Sheet</span><div class="no">${esc(s.no)}</div>${i >= 0 ? `<div class="of">${i + 1} of ${ctx.idx.length}${ctx.unitName ? ` · ${esc(ctx.unitName)}` : ''}</div>` : ''}</div>
  </aside>`;
}
const sheet = (field, tb, cls = '') => `<section class="sheet${cls}"><div class="frame"><div class="field">${field}</div>${tb}</div></section>`;

/** Cover headline: the project name, else its address, else a plain title. */
const coverTitle = (project, pm) => project || pm.address || 'Cabinet submittal';

/** The TITLE PAGE that fronts every document (her ask: "PL/NTH cabinets for XXXX, then the
 *  address"): full brand colour, no title block, no sheet number. `lines` = the small print
 *  under the address. `colors` = [{hex, name, sub}]: one tile for a single-color kitchen, a row
 *  of tiles (each naming its kitchens) when the kitchens differ. */
function titlePage({ project, pm, lines, colors = [] }) {
  const name = project || pm.address || '';
  const addr = project ? pm.address : '';
  const tiles = colors.length === 1
    ? `<div class="tp-tile"><span class="tile" style="background:${colors[0].hex}"></span><span><small>COLOR</small>${colors[0].name}</span></div>`
    : colors.length ? `<div class="tp-colors"><small>COLORS</small><div class="tp-row">${colors.map((c) => `<div class="tp-c"><span class="tile" style="background:${c.hex}"></span><span><b>${c.name}</b>${esc(c.sub || '')}</span></div>`).join('')}</div></div>` : '';
  return `<section class="sheet title">
    <div class="tp-brand">PL<span class="slash">/</span>NTH</div>
    <div class="tp-main">
      <div class="tp-kicker">PL/NTH CABINETS${name ? ' FOR' : ''}</div>
      ${name ? `<h1>${esc(name)}</h1>` : ''}
      ${addr ? `<div class="tp-addr">${esc(addr)}</div>` : ''}
    </div>
    <div class="tp-foot">
      <div>${lines.map((t) => esc(t)).join('<br>')}</div>
      ${tiles}
      <div class="tp-web">plinthmade.com</div>
    </div>
  </section>`;
}

/** The big paint tile on the cover sheets. */
const colorTile = (c) => `<div class="color-tile"><span class="tile" style="background:${c.hex}"></span><span><small>COLOR</small>${c.name}</span></div>`;

/** Sheet notes on the schedule / cut / specification sheets: a ruled block at the foot of the
 *  field (drawing sheets carry theirs in the title block). */
const notesHTML = (lines) => `<div class="notes"><span class="notes-h">NOTES</span><ol>${lines.filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>`;
const NOTE_HINGE = 'Dashed diagonals on a door meet at its hinge side. A V meeting at the bottom is a drop-down dishwasher door.';
const NOTE_APPL = 'Appliances and worktops are shown in grey / outline for coordination only and are not supplied by PL/NTH.';

// ---- cover blocks ----------------------------------------------------------------
function directoryHTML(pm = {}) {
  const row = (k, v) => `<tr><td class="dir-k">${k}</td><td>${v ? esc(v) : '<span class="dir-blank"></span>'}</td></tr>`;
  return `<h3>PROJECT DIRECTORY</h3>
    <table class="idx dir">
      ${row('PROJECT ADDRESS', pm.address)}
      ${row('OWNER / DEVELOPER', pm.owner)}
      ${row('ARCHITECT OF RECORD', pm.architect)}
      ${row('GENERAL CONTRACTOR', pm.gc)}
      ${row('CABINET VENDOR', 'PL/NTH · plinthmade.com')}
      ${row('SPEC SECTION', SPEC_SECTION)}
    </table>`;
}
const SYMBOLS = `<h3>SYMBOLS &amp; ABBREVIATIONS</h3>
  <table class="sym">
    <tr><td>${bubble(1, 'A-201', 7)}</td><td>Drawing number / sheet number</td></tr>
    <tr><td><svg width="7mm" height="7mm" viewBox="0 0 11 11"><path d="M5.5 1.2 L8.9 7 L2.1 7 Z" fill="${INK}"/><circle cx="5.5" cy="7" r="3" fill="#fff" stroke="${INK}" stroke-width="0.35"/></svg></td><td>Interior elevation marker</td></tr>
    <tr><td><svg width="7mm" height="4mm" viewBox="0 0 11 6"><rect x="1" y="1" width="9" height="4" fill="none" stroke="${INK}" stroke-width="0.3"/><path d="M1 3 L3 1 M1 5 L5 1 M3 5 L7 1 M5 5 L9 1 M7 5 L10 2" stroke="#8a8a8a" stroke-width="0.2"/></svg></td><td>Scribe filler, cut to site</td></tr>
    <tr><td><svg width="7mm" height="4mm" viewBox="0 0 11 6"><rect x="1" y="1" width="9" height="4" fill="#ebebeb" stroke="#8f8f8f" stroke-width="0.3"/></svg></td><td>Appliance, by others</td></tr>
    <tr><td class="ab">NIC</td><td>Not in contract (by others)</td></tr>
    <tr><td class="ab">NTS</td><td>Not to scale</td></tr>
  </table>`;

// ---- product specification (sheet A-600) --------------------------------------------
// NOTE: statements below are submittal-coordination language (Imogen must
// verify the claims with the workshop before first real issue).
function specificationBody(design, pm = {}) {
  const finishLabel = design.finish === 'Custom RAL' && pm.finishRal
    ? `Custom: matched to RAL ${esc(pm.finishRal)}`
    : `${esc(design.finish || '-')} (one of 15 PL/NTH standard colors)`;
  const prodRows = [
    ['Cabinet type', 'Painted face-frame (shaker) cabinetry: floor, wall, counter &amp; tall units'],
    ['Carcass construction', '&#190;" (18mm) panel construction, oak-veneer interior; &#8542;" (22mm) front-frame legs'],
    ['Doors &amp; faces', 'Painted shaker fronts; glazed doors clear glass'],
    ['Plinth', '4&#189;" (115mm) painted plinth, flush to the cabinet face'],
    ['Paint finish', `${finishLabel}, factory-applied in the PL/NTH workshop. Custom color matched to any RAL on request.`],
    ['Hardware', `${esc(HARDWARE_LABEL)}. ${esc(HARDWARE_NOTE)}.`],
    ['Country of origin', 'Made in England; supplied to the US by PL/NTH'],
  ].map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td></tr>`).join('');
  const compRows = [
    // NO emissions / fire claims until the paperwork is in hand (her call
    // 2026-09-18). When the workshop's board suppliers' TSCA Title VI
    // certificates are on file, restore:
    //   ['Formaldehyde emissions', 'Composite wood components supplied compliant with TSCA Title VI (40 CFR Part 770) / CARB Phase 2 emission limits. Supplier declarations held on file; certificates issued on request.'],
    ['Specification section', esc(SPEC_SECTION)],
    ['Accessible units', 'ANSI A117.1 / ADA accessible-unit requirements. Coordinate variants with the PL/NTH trade team at spec stage.'],
    ['Field verification', esc(DISCLAIMER_BODY)],
  ].map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td></tr>`).join('');
  return `<div class="two-col">
      <div><h3>CONSTRUCTION &amp; FINISH</h3><table class="fin comp">${prodRows}</table></div>
      <div><h3>SPECIFICATION NOTES</h3><table class="fin comp">${compRows}</table></div>
    </div>
    ${notesHTML(['Dimensions are given in inches with the metric size in brackets.', 'Statements on this sheet are provided for submittal coordination.'])}`;
}

// ---- plan sheet (A-100) -----------------------------------------------------------
// The plan at a true scale on the left, the cabinet KEY beside it, plan north under the key.
function planKeyHTML(design) {
  const rows = planKeyRows(design, { splitIsland: true });
  if (!rows.length) return '';
  const sinks = sinkHosts(design);
  const needs = new Map(sinks.map((h) => [h.sinkCab.code, sinkMinBase(h.sinkCab)]));
  const desc = (r) => `${esc(r.family)}${r.cab.notSupplied ? ' *' : ''} &middot; ${esc(r.cab.desc)}${needs.has(r.cab.code) ? ` &middot; needs a ${fmtIn(needs.get(r.cab.code))} base or wider` : ''}`;
  const tr = (r) => `<tr><td>${r.qty}</td><td><strong>${esc(r.code)}</strong></td><td>${desc(r)}</td><td>${esc(hingeLabel(r.hinge))}</td><td class="num">${fmtIn(r.cab.w)}</td><td class="num">${fmtIn(r.cab.d)}</td><td class="num">${fmtIn(r.cab.h)}</td></tr>`;
  const main = rows.filter((r) => !r.island), isl = rows.filter((r) => r.island);
  const body = main.map(tr).join('') + (isl.length ? `<tr class="key-sec"><td colspan="7">ISLAND</td></tr>${isl.map(tr).join('')}` : '');
  const sinkNotes = sinks.filter((h) => h.baseCab).map((h) =>
    `${h.baseCab.code} is a sink base: a ${fmtIn(h.baseCab.w)} cabinet takes a sink with a bowl cut-out up to ${fmtIn(maxSinkCutout(h.baseCab.w))} wide (${h.sinkCab.baseCode || h.sinkCab.code} shown).`);
  const notes = [
    rows.some((r) => r.hinge) ? 'Hinge side as viewed facing the cabinet front. Pair = left + right hung doors.' : '',
    ...new Set(sinkNotes),
    rows.some((r) => r.cab.notSupplied) ? '* Appliance, shown in grey for layout only, not supplied by PL/NTH.' : '',
  ].filter(Boolean);
  return `<div class="plan-key"><h3>CABINET KEY</h3><table class="cab key"><thead><tr><th>QTY</th><th>CODE</th><th>DESCRIPTION</th><th>HINGE</th><th class="num">W</th><th class="num">D</th><th class="num">H</th></tr></thead><tbody>${body}</tbody></table><ul class="key-notes">${notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
}

/** The plan SVG with its elevation markers, and the scale it prints at. */
function planDrawing(design, idx, maxW, maxH) {
  let svg = buildFloorplanSVG(design, null, { key: false, tight: true });
  svg = svg.replace(/<\/svg>\s*$/, `${elevationMarkers(design, idx)}</svg>`);
  const [, , w, h] = vbOf(svg);
  const sc = pickScale(w, h, maxW, maxH);
  return { svg: atScale(svg, sc), sc };
}

// ---- colors ----------------------------------------------------------------------
/** A kitchen's colors as {hex, name}: its finish, and the island's when that differs. */
function unitColors(design, pm = {}) {
  const f = getFinish(design.finish);
  const out = [{ hex: f.hex, name: design.finish === 'Custom RAL' && pm.finishRal ? `Custom: RAL ${esc(pm.finishRal)}` : esc(design.finish || '-'), finish: design.finish }];
  const isl = islandFinish(design);
  if (isl) out.push({ hex: getFinish(isl).hex, name: `Island: ${esc(isl)}`, finish: isl, island: true });
  return out;
}

// ---- the per-unit sheet set --------------------------------------------------
/** All sheets for one unit type (cover → plan → elevations → schedule → cuts →
 *  product specification). `pm` carries the project meta (address, architect,
 *  gc, owner, finishRal) from the trade project. */
export function buildUnitSheets({ project, unit, date, pm = {} }) {
  if (!unit.design) return '';
  const design = withIslandFlags(unit.design);      // a design stored before the planner filed islands itself
  const uname = unitName(unit);
  const qty = unitQty(unit);
  const rev = unitRev(unit);
  const idx = drawingIndex(design);
  const colors = unitColors(design, pm);
  const ctx = {
    projectName: project || '', address: pm.address || '', date, rev, idx, unitName: uname, colors,
    unitLine: `${esc(uname)} · ${qty} unit${qty === 1 ? '' : 's'}`,
    // Rev A carries this issue's date only when A is the current revision; later revisions carry
    // the dates recorded when they were bumped (core bumpRev)
    revRows: [['A', rev === 'A' ? esc(date) : '', 'Issued for approval'], ...((unit.revHistory || []).map((h) => [esc(h.rev), esc(h.date), 'Reissued']))],
  };
  const sheets = [];
  let iNo = 0;
  const no = () => idx[iNo++].no;

  // ---- COVER ----
  {
    const dNo = no();
    const plan = planDrawing(design, idx, 90, 70);
    const keyPlan = plan.svg.replace(/<text[\s\S]*?<\/text>/g, '').replace(/<(line|path|polygon)[^>]*#8a8378[^>]*\/>/g, '');
    sheets.push(sheet(`
      <div class="cv">
        <div class="cv-head">
          <div class="cv-kick">CABINET SUBMITTAL · ${esc(SPEC_SECTION)} · FOR APPROVAL</div>
          <h1>${esc(coverTitle(project, pm))}</h1>
          ${project && pm.address ? `<div class="cv-addr">${esc(pm.address)}</div>` : ''}
          <h2>${esc(uname)} · ${qty} unit${qty === 1 ? '' : 's'}</h2>
          <div class="cv-sub">Revision ${esc(rev)} · ${esc(date)}</div>
        </div>
        <div class="cv-cols">
          <div>${colors.map(colorTile).join('')}
            <h3>KEY PLAN</h3><div class="kp">${keyPlan}<div class="kp-cap">Unit plan · ${esc(plan.sc.label)}</div></div></div>
          <div>${directoryHTML(pm)}${SYMBOLS}</div>
        </div>
      </div>`, titleBlock(ctx, { no: dNo, title: 'Cover sheet', scale: 'NTS', action: true })));
  }

  // ---- PLAN ----
  {
    const dNo = no();
    const key = planKeyHTML(design);
    // the KEY stands beside the plan, or under it when that lets the plan print at a larger scale
    const keyRows = planKeyRows(design, { splitIsland: true }).length;
    const keyH = 12 + keyRows * 4.1 + (key.match(/<li>/g) || []).length * 3.2;   // measured in Chrome
    const beside = planDrawing(design, idx, key ? FIELD_W - KEY_W - 6 : FIELD_W, FIELD_H - 4);
    const under = key ? planDrawing(design, idx, FIELD_W, FIELD_IN_H - 22 - keyH) : beside;
    const stacked = under.sc.mm > beside.sc.mm + 1e-6;
    const plan = stacked ? under : beside;
    sheets.push(sheet(stacked ? `
      <div class="plan-stack">
        <div class="plan-l"><div class="dwg">${plan.svg}</div>${drawingTitle(1, dNo, 'Floor plan', plan.sc)}</div>
        <div class="plan-under">${key}${NORTH}</div>
      </div>` : `
      <div class="plan-row">
        <div class="plan-l"><div class="dwg">${plan.svg}</div>${drawingTitle(1, dNo, 'Floor plan', plan.sc)}</div>
        <div class="plan-r">${key}${NORTH}</div>
      </div>`, titleBlock(ctx, { no: dNo, title: 'Floor plan &amp; cabinet key', scale: plan.sc.label }), ' plan'));
  }

  // ---- ELEVATIONS: one sheet per wall that has cabinets ----
  for (const wall of wallsWithItems(design)) {
    const dNo = no();
    const svg = buildElevationSVG(computeElevation(design, wall));
    const [, , w, h] = vbOf(svg);
    const sc = pickScale(w, h, FIELD_W, FIELD_H);
    const name = wallTitle(wall);
    sheets.push(sheet(`<div class="elevs"><div class="elev"><div class="dwg">${atScale(svg, sc)}</div>${drawingTitle(1, dNo, `${esc(name)} elevation`, sc)}</div></div>`,
      titleBlock(ctx, { no: dNo, title: `Interior elevation<br>${esc(name)}`, scale: sc.label,
        notes: [`Interior elevation, viewed facing the ${wall} wall. Dimensions in inches.`, NOTE_HINGE, 'Hatched panels are scribe fillers; dashed outlines are openings.', NOTE_APPL] })));
  }

  // ---- ISLAND ELEVATIONS: the island's faces, two to a sheet, one scale per sheet ----
  const islSheets = islandSheets(design);
  islSheets.forEach((faces, i) => {
    const dNo = no();
    const svgs = faces.map((face) => buildElevationSVG(computeIslandElevation(design, face)));
    const each = (FIELD_H - 8) / faces.length - 16;
    const sc = svgs.map((s) => { const [, , w, h] = vbOf(s); return pickScale(w, h, FIELD_W, each); })
      .reduce((a, b) => (a.mm < b.mm ? a : b));
    const figs = faces.map((face, k) => `<div class="elev"><div class="dwg">${atScale(svgs[k], sc)}</div>${drawingTitle(k + 1, dNo, `ISLAND · ${esc(face.title)}`, sc)}</div>`).join('');
    sheets.push(sheet(`<div class="elevs">${figs}</div>`,
      titleBlock(ctx, { no: dNo, title: `Island elevations${islSheets.length > 1 ? ` ${i + 1}/${islSheets.length}` : ''}`, scale: sc.label,
        notes: ['Island elevations: each side is viewed facing its cabinet fronts. Dimensions in inches.', NOTE_HINGE, 'The worktop overhangs each end of the island by 2" (50mm).', 'Exposed island backs and ends are finished with painted end panels, quantified at order.', NOTE_APPL] })));
  });

  // ---- SCHEDULE SHEET ----
  const sched = scheduleRows(design);
  const crown = corniceOption(design.room?.cornice || 'none');
  const finRows = [
    ['Paint color', `${colors[0].name} <span class="swatch" style="background:${colors[0].hex}"></span>${design.finish === 'Custom RAL' ? ' matched on order' : ''}`, 'All exposed cabinet faces, painted in the PL/NTH workshop. Custom color matched to any RAL on request.'],
    ...(colors[1] ? [['Island color', `${esc(colors[1].finish)} <span class="swatch" style="background:${colors[1].hex}"></span>`, 'Every island cabinet, fronts and exposed ends']] : []),
    ['Worktop', 'By others', 'Shown on the drawings for coordination only, not supplied by PL/NTH'],
    ['Hardware', esc(HARDWARE_LABEL), esc(HARDWARE_NOTE)],
    ['Crown molding', esc(crown.label), crown.label === 'No crown' ? '-' : 'Runs over wall, counter and tall cabinets, one level line'],
  ].map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td><td class="mut">${r[2]}</td></tr>`).join('');

  const dim = (r, v) => (r.accessory ? '-' : fmtIn(v));
  const sinkLines = [...new Set(sinkHosts(design).filter((h) => h.baseCab).map((h) =>
    `${h.baseCab.code} sink base (${fmtIn(h.baseCab.w)}): takes a sink with a bowl cut-out up to ${fmtIn(maxSinkCutout(h.baseCab.w))} wide. The ${h.sinkCab.desc} shown needs a ${fmtIn(sinkMinBase(h.sinkCab))} base or wider. Sinks are by others.`))];
  const rowsHTML = sched.rows.map((r) => `<tr>
      <td>${r.qty}</td><td><strong>${esc(r.code)}</strong></td><td>${esc(FAMILY_LABEL[r.type] || r.type)}</td><td>${esc(r.desc)}</td><td>${esc(r.hinge || '-')}</td>
      <td class="num">${dim(r, r.w)}</td><td class="num">${dim(r, r.d)}</td><td class="num">${dim(r, r.h)}</td>
      <td class="num">${fmtUSD(r.each)}</td><td class="num"><strong>${fmtUSD(r.line)}</strong></td></tr>`).join('');
  sheets.push(sheet(`<div class="doc">
    <div class="two-col">
      <div>
        <h3>FINISH &amp; HARDWARE SCHEDULE</h3>
        <table class="fin">${finRows}</table>
      </div>
      <div>
        <h3>PROJECT TOTALS</h3>
        <table class="fin">
          <tr><th>Cabinets per unit</th><td class="num">${sched.rows.reduce((t, r) => t + (r.accessory ? 0 : r.qty), 0)}</td><td></td></tr>
          <tr><th>Cabinet total per unit</th><td class="num">${fmtUSD(sched.subtotal)}</td><td></td></tr>
          <tr><th>Unit count</th><td class="num">&times;${qty}</td><td class="mut">${esc(uname)}</td></tr>
          <tr class="hi"><th>Cabinet total, all units</th><td class="num"><strong>${fmtUSD(sched.subtotal * qty)}</strong></td><td class="mut">excl. shipping, confirmed on order</td></tr>
        </table>
      </div>
    </div>
    <h3>CABINET SCHEDULE</h3>
    <table class="cab">
      <colgroup><col style="width:9mm"><col style="width:15mm"><col style="width:24mm"><col><col style="width:22mm"><col style="width:11mm"><col style="width:11mm"><col style="width:11mm"><col style="width:17mm"><col style="width:19mm"></colgroup>
      <thead><tr><th>QTY</th><th>CODE</th><th>TYPE</th><th>DESCRIPTION</th><th>HINGE</th><th class="num">W</th><th class="num">D</th><th class="num">H</th><th class="num">EACH</th><th class="num">LINE</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
      <tfoot><tr><td colspan="9" class="tr">Per-unit cabinet subtotal</td><td class="num"><strong>${fmtUSD(sched.subtotal)}</strong></td></tr></tfoot>
    </table>
    ${notesHTML(['Hinge side is as viewed facing the cabinet front; doors ship hung as scheduled.', 'Scribe fillers, crown molding and end panels are quantified at order from the final site dimensions.', 'Cabinets are supplied undrilled; hardware and fitting by others.', ...sinkLines, 'Appliances and worktops shown on the drawings are not supplied by PL/NTH.'])}</div>`,
    titleBlock(ctx, { no: 'A-300', title: 'Finish &amp; cabinet schedule', scale: 'NTS' })));

  // ---- CUT SHEETS: six identical cards a page, every cabinet at 1/4" = 1'-0" ----
  // (her rule 2026-09-30: the boxes are the same size whatever the cabinet, the descriptions
  // always line up: the drawing well fits the tallest cabinet, glyphs stand on one floor line)
  const cutPages = cutSheetPages(distinctSkus(design));
  cutPages.forEach((chunk, p) => {
    const dNo = `A-4${String(p + 1).padStart(2, '0')}`;
    const cards = chunk.map((s, k) => `
      <div class="cut-card">
        <div class="cut-glyph">${skuGlyphSVG(s.cab, s.hinge)}</div>
        <div class="cut-head">${bubble(k + 1, dNo, 6.4)}<span class="cut-code">${esc(s.code)}</span><span class="cut-desc">${esc(FAMILY_LABEL[familyOf(s.cab)] || s.cab.type)} &middot; ${esc(s.cab.desc)}</span><span class="cut-qty">${s.qty} per unit</span></div>
        <table class="cut-spec">${s.specs.map(([k2, v]) => `<tr><th>${esc(k2)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      </div>`).join('');
    sheets.push(sheet(`<div class="doc"><div class="cut-grid">${cards || '<div class="fig-note">No PL/NTH cabinets in this design yet.</div>'}</div></div>`,
      titleBlock(ctx, { no: dNo, title: `Cabinet cut sheets${cutPages.length > 1 ? ` ${p + 1}/${cutPages.length}` : ''}`, scale: '1/4" = 1\'-0"' })));
  });

  // ---- PRODUCT SPECIFICATION (A-600) ----
  sheets.push(sheet(`<div class="doc">${specificationBody(design, pm)}</div>`,
    titleBlock(ctx, { no: 'A-600', title: 'Product specification', scale: 'NTS' })));

  return sheets.join('\n');
}

// ---- documents ----------------------------------------------------------------
const CSS = `
    @page { size: letter landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #fff; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: ${INK}; -webkit-font-smoothing: antialiased; }
    .sheet { width: 279.4mm; height: 215.9mm; padding: 6.5mm; page-break-after: always; overflow: hidden; position: relative; }
    .sheet:last-child { page-break-after: auto; }
    .frame { height: 100%; border: 0.5mm solid ${INK}; outline: 0.2mm solid ${INK}; outline-offset: 1mm; display: flex; }
    .field { flex: 1; min-width: 0; padding: 7mm 8mm 6mm; display: flex; position: relative; }
    .k { display: block; font-size: 5.6px; letter-spacing: 1.3px; text-transform: uppercase; color: #7a766c; margin-bottom: 1.6px; }
    h3 { font-size: 7px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: ${INK}; margin: 0 0 1.8mm; }
    .mut { color: #7a766c; }
    .num { text-align: right; }

    /* title block strip */
    .tb { width: 52mm; flex: 0 0 52mm; border-left: 0.5mm solid ${INK}; display: flex; flex-direction: column; font-size: 7px; line-height: 1.4; }
    .tb-cell, .tb-brand, .tb-grid, .tb-no { border-bottom: 0.2mm solid ${INK}; padding: 2.2mm 2.8mm; }
    .tb-brand { display: flex; justify-content: space-between; align-items: flex-end; padding: 3.2mm 2.8mm 2.6mm; }
    .wm { font-size: 17px; font-weight: 800; letter-spacing: 2.6px; color: #645b3d; line-height: 1; }
    .wm span { opacity: 0.5; }
    .tb-sub { font-size: 5.8px; letter-spacing: 0.9px; text-transform: uppercase; text-align: right; color: #645b3d; line-height: 1.5; }
    .tb-issue { display: flex; justify-content: space-between; align-items: baseline; }
    .tb-issue .k { margin: 0; }
    .issue { font-size: 7px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; border: 0.25mm solid ${INK}; padding: 0.5mm 1.6mm; }
    table.rev { width: 100%; border-collapse: collapse; font-size: 6.2px; }
    table.rev th { text-align: left; font-weight: 400; color: #7a766c; font-size: 5.4px; letter-spacing: 0.8px; text-transform: uppercase; border-bottom: 0.2mm solid ${INK}; padding: 0 1mm 0.6mm 0; }
    table.rev td { border-bottom: 0.1mm solid #c9c5bb; padding: 0.7mm 1mm 0.7mm 0; height: 3.4mm; }
    table.rev td:first-child, table.rev th:first-child { width: 6mm; }
    table.rev td:nth-child(2) { width: 17mm; }
    .tb-notes ol { margin: 0; padding-left: 3mm; font-size: 6px; line-height: 1.45; color: #3d3b35; }
    .tb-notes li { margin-bottom: 0.8mm; }
    .tb-grow { flex: 1; min-height: 12mm; }
    .tb-fv { font-size: 5.6px; color: #5a574f; line-height: 1.45; }
    .tb-proj { font-size: 6.8px; }
    .pn { font-size: 9.5px; font-weight: 700; line-height: 1.25; }
    .chips { display: flex; flex-direction: column; gap: 1.2mm; }
    .chip { display: inline-flex; align-items: center; gap: 1.6mm; font-size: 8px; font-weight: 700; }
    .chip i, .swatch, .tile { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .chip i { width: 4.2mm; height: 4.2mm; border: 0.15mm solid #7a766c; display: inline-block; }
    .tt { font-size: 9.5px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; line-height: 1.3; }
    .tb-grid { display: grid; grid-template-columns: 1fr 1fr; padding: 0; }
    .tb-grid > div { padding: 1.6mm 2.8mm; font-size: 6.6px; }
    .tb-grid > div:nth-child(odd) { border-right: 0.2mm solid ${INK}; }
    .tb-grid > div:nth-child(-n+2) { border-bottom: 0.2mm solid ${INK}; }
    .tb-no { border-bottom: 0; display: flex; flex-direction: column; padding-bottom: 2.4mm; }
    .tb-no .no { font-size: 30px; font-weight: 300; letter-spacing: 0.5px; line-height: 1; margin-top: 1mm; }
    .tb-no .of { font-size: 6px; color: #7a766c; letter-spacing: 1px; text-transform: uppercase; margin-top: 1mm; }
    .act { display: flex; flex-direction: column; gap: 1.3mm; font-size: 6.6px; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 1mm; }
    .act i { display: inline-block; width: 2.4mm; height: 2.4mm; border: 0.2mm solid ${INK}; margin-right: 1.6mm; vertical-align: -0.5mm; }
    .act-l { display: flex; gap: 3mm; margin-top: 5mm; font-size: 5.4px; color: #7a766c; }
    .act-l span { flex: 1; border-top: 0.2mm solid ${INK}; padding-top: 0.5mm; }

    /* drawings */
    .dwg svg { display: block; }
    .dwg svg > rect:first-child { fill: none; }
    .dt { display: flex; align-items: center; gap: 2.4mm; margin-top: 3mm; }
    .dt-t { flex: 1; min-width: 60mm; }
    .dt-name { font-size: 9.5px; font-weight: 700; letter-spacing: 1.3px; text-transform: uppercase; border-bottom: 0.35mm solid ${INK}; padding-bottom: 0.8mm; }
    .dt-scale { display: flex; align-items: center; justify-content: space-between; gap: 4mm; font-size: 6.6px; letter-spacing: 0.6px; text-transform: uppercase; color: #3d3b35; margin-top: 1mm; }
    .sb text, .bub text { font-family: inherit; fill: ${INK}; letter-spacing: 0; }
    .elevs { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 6mm; }
    .elev { display: inline-flex; flex-direction: column; }
    .sheet.plan .field { align-items: center; }
    .plan-row { flex: 1; display: flex; gap: 6mm; align-items: stretch; }
    .plan-l { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; padding-top: 2mm; }
    .plan-r { width: ${KEY_W}mm; flex: 0 0 ${KEY_W}mm; display: flex; flex-direction: column; padding-top: 12mm; }
    .north { margin-top: auto; align-self: flex-start; }
    .plan-stack { flex: 1; display: flex; flex-direction: column; gap: 5mm; }
    .plan-stack .plan-l { flex: 0 0 auto; }
    .plan-under { display: flex; gap: 8mm; align-items: flex-end; }
    .plan-under .plan-key { flex: 1; }
    .plan-under .north { margin: 0; flex: 0 0 auto; }
    table { border-collapse: collapse; width: 100%; }
    table.key { font-size: 6.6px; }
    table.cab th { text-align: left; font-weight: 400; font-size: 5.6px; letter-spacing: 1px; color: #7a766c; border-bottom: 0.3mm solid ${INK}; padding: 0 1.2mm 0.8mm 0; }
    table.cab th.num { text-align: right; }
    table.cab td { padding: 0.9mm 1.2mm 0.9mm 0; border-bottom: 0.1mm solid #c9c5bb; vertical-align: top; }
    tr.key-sec td { font-size: 5.6px; font-weight: 700; letter-spacing: 1.4px; padding-top: 2mm; border-bottom: 0.3mm solid ${INK}; }
    .key-notes { list-style: none; margin: 2mm 0 0; padding: 0; font-size: 6px; line-height: 1.5; color: #5a574f; }
    .key-notes li { margin-bottom: 0.6mm; }

    /* schedules, cut sheets, specification */
    .doc { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 7.4px; }
    .doc > * { flex: 0 0 auto; }
    .doc table.cab { table-layout: fixed; font-size: 7.2px; }
    .doc table.cab tfoot td { border-top: 0.3mm solid ${INK}; border-bottom: 0; }
    .tr { text-align: right; color: #7a766c; }
    table.fin { font-size: 7.4px; }
    table.fin th { text-align: left; font-weight: 400; color: #7a766c; width: 30mm; padding: 1mm 2mm 1mm 0; border-bottom: 0.1mm solid #c9c5bb; vertical-align: baseline; }
    table.fin td { padding: 1mm 2mm 1mm 0; border-bottom: 0.1mm solid #c9c5bb; vertical-align: baseline; }
    table.fin:not(.comp) td:nth-child(2) { width: 30mm; }
    table.fin td.mut { font-size: 6.8px; }
    table.fin tr.hi td, table.fin tr.hi th { border-top: 0.3mm solid ${INK}; font-weight: 700; color: ${INK}; }
    table.comp th { width: 32mm; }
    table.comp td { line-height: 1.45; }
    .two-col { display: grid; grid-template-columns: 1.2fr 1fr; gap: 9mm; margin-bottom: 6mm; }
    .swatch { display: inline-block; width: 2.4mm; height: 2.4mm; border: 0.1mm solid #7a766c; vertical-align: -0.4mm; margin-left: 1mm; }
    .notes { margin-top: auto; display: grid; grid-template-columns: 30mm 1fr; border-top: 0.2mm solid ${INK}; padding-top: 1.6mm; font-size: 6.4px; line-height: 1.45; color: #3d3b35; }
    .notes-h { font-size: 6.4px; font-weight: 700; letter-spacing: 1.4px; }
    .notes ol { margin: 0; padding-left: 3.4mm; columns: 2; column-gap: 8mm; }
    .notes li { break-inside: avoid; margin-bottom: 0.5mm; }
    .fig-note { font-size: 7px; color: #7a766c; }
    .cut-grid { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 88mm; border-top: 0.2mm solid ${INK}; border-left: 0.2mm solid ${INK}; }
    .cut-card { display: flex; flex-direction: column; overflow: hidden; border-right: 0.2mm solid ${INK}; border-bottom: 0.2mm solid ${INK}; padding: 3mm 3.5mm; min-width: 0; }
    .cut-glyph { display: flex; justify-content: flex-start; align-items: flex-end; height: ${CUT_WELL_MM}mm; flex: 0 0 ${CUT_WELL_MM}mm; }
    .cut-glyph svg { max-width: 100%; }
    .cut-head { display: flex; align-items: center; gap: 2mm; margin-top: 2mm; border-bottom: 0.3mm solid ${INK}; padding-bottom: 0.6mm; }
    .cut-code { font-size: 11px; font-weight: 700; }
    .cut-desc { font-size: 6.8px; color: #3d3b35; }
    .cut-qty { margin-left: auto; font-size: 6px; color: #7a766c; white-space: nowrap; }
    table.cut-spec { font-size: 6.4px; margin-top: 0.5mm; }
    table.cut-spec th { width: 13mm; text-align: left; font-weight: 400; font-size: 5.4px; letter-spacing: 0.8px; text-transform: uppercase; color: #7a766c; padding: 0.6mm 1.5mm 0.6mm 0; vertical-align: top; border-bottom: 0.1mm solid #e0ddd5; }
    table.cut-spec td { padding: 0.6mm 0; border-bottom: 0.1mm solid #e0ddd5; vertical-align: top; }

    /* cover sheets */
    .cv { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .cv-head { border-bottom: 0.35mm solid ${INK}; padding-bottom: 4mm; margin-bottom: 6mm; }
    .cv-kick { font-size: 6.6px; letter-spacing: 1.8px; text-transform: uppercase; color: #7a766c; }
    .cv h1 { font-size: 26px; font-weight: 300; letter-spacing: 0.3px; margin: 2.5mm 0 1mm; }
    .cv-addr { font-size: 10px; }
    .cv h2 { font-size: 11px; font-weight: 700; margin: 2mm 0 0; }
    .cv-sub { font-size: 8px; color: #7a766c; margin-top: 0.8mm; }
    .cv-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 11mm; }
    .cv table { font-size: 7px; margin-bottom: 6mm; }
    .cv table td { padding: 1mm 2mm 1mm 0; border-bottom: 0.1mm solid #c9c5bb; vertical-align: middle; }
    .cv table.dir td.dir-k { width: 33mm; color: #7a766c; font-size: 5.8px; letter-spacing: 1px; }
    .dir-blank { display: inline-block; width: 40mm; }
    .cv table.sym td:first-child { width: 11mm; }
    .cv table.sym svg { display: block; }
    .cv .ab { font-weight: 700; font-size: 6.4px; letter-spacing: 0.6px; }
    .color-tile { display: flex; align-items: center; gap: 3mm; font-size: 9px; font-weight: 700; margin-bottom: 4mm; }
    .color-tile small { display: block; font-size: 5.6px; font-weight: 400; letter-spacing: 1.2px; color: #7a766c; }
    .color-tile .tile { width: 13mm; height: 13mm; border: 0.1mm solid #7a766c; display: inline-block; }
    .kp svg { display: block; }
    .kp-cap { font-size: 5.8px; letter-spacing: 1px; text-transform: uppercase; color: #7a766c; margin-top: 1.5mm; }
    table.units th { text-align: left; font-weight: 400; font-size: 5.6px; letter-spacing: 1px; text-transform: uppercase; color: #7a766c; border-bottom: 0.3mm solid ${INK}; padding: 0 2mm 0.8mm 0; }
    table.units th.num { text-align: right; }
    table.units td { padding: 1.6mm 2mm 1.6mm 0; }
    table.units td.sw { width: 11mm; }
    table.units td.sw i { display: block; width: 8mm; height: 8mm; border: 0.15mm solid #7a766c; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.units tr.tot td { border-top: 0.3mm solid ${INK}; border-bottom: 0; font-weight: 700; }

    /* the brand title page */
    .sheet.title { background: #645b3d; color: #f7f5eb; padding: 16mm 18mm 14mm; display: flex; flex-direction: column; justify-content: space-between;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .tp-brand { font-size: 30px; font-weight: 800; letter-spacing: 5px; }
    .tp-brand .slash { opacity: 0.55; }
    .tp-kicker { font-size: 13px; letter-spacing: 5px; opacity: 0.8; }
    .tp-main h1 { font-size: 54px; line-height: 1.05; margin: 10px 0 0; letter-spacing: 0.5px; font-weight: 800; }
    .tp-addr { font-size: 20px; margin-top: 12px; opacity: 0.92; }
    .tp-foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 12mm; font-size: 11px; line-height: 1.6;
      border-top: 1px solid rgba(247, 245, 235, 0.35); padding-top: 6mm; }
    .tp-web { letter-spacing: 2px; }
    .tp-tile { display: flex; align-items: center; gap: 4mm; font-size: 15px; font-weight: 600; }
    .tp-tile small, .tp-colors small { display: block; font-size: 8.5px; font-weight: 400; letter-spacing: 2px; opacity: 0.75; margin-bottom: 2px; }
    .tp-colors small { margin-bottom: 3mm; }
    .tp-tile .tile, .tp-c .tile { display: inline-block; border: 1px solid rgba(247, 245, 235, 0.6); border-radius: 3px; width: 16mm; height: 16mm; }
    .tp-row { display: flex; gap: 7mm; }
    .tp-c { display: flex; align-items: center; gap: 3mm; font-size: 10px; line-height: 1.35; }
    .tp-c b { display: block; font-size: 13px; }
    .tp-c .tile { width: 12mm; height: 12mm; }
`;

function docWrap(title, sheetsHTML) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${sheetsHTML}</body></html>`;
}

/** Project meta (directory + custom-RAL code) from a trade project object. */
function projectMeta(trade = {}) {
  return {
    address: trade.address || '', architect: trade.architect || '',
    gc: trade.gc || '', owner: trade.owner || '', finishRal: trade.finishRal || '',
  };
}

/** Full submittal document for ONE unit type. `trade` (optional) supplies the
 *  project directory fields; `project` alone still works. */
export function buildSubmittalHTML({ project, unit, date, trade }) {
  date = date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const pm = projectMeta(trade || {});
  const proj = project ?? (trade && trade.project);
  const title = unit.design ? titlePage({ project: proj, pm, colors: unitColors(withIslandFlags(unit.design), pm),
    lines: [`Cabinet submittal · ${unitName(unit)} · ${unitQty(unit)} unit${unitQty(unit) === 1 ? '' : 's'}`, `Revision ${unitRev(unit)} · ${date}`] }) : '';
  return docWrap(`PL/NTH · Submittal · ${unitName(unit)}`, title + buildUnitSheets({ project: proj, unit, date, pm }));
}

/** The pack's colors: one per finish across every kitchen (islands included), each naming
 *  the kitchens painted in it. A project where kitchens differ shows them all (her ask
 *  2026-09-30, "what if each kitchen is a different color"). */
function packColors(designed, pm) {
  const by = new Map();
  for (const u of designed) {
    for (const c of unitColors(withIslandFlags(u.design), pm)) {
      const key = c.finish || c.name;
      if (!by.has(key)) by.set(key, { hex: c.hex, name: c.island ? esc(c.finish) : c.name, units: [] });
      by.get(key).units.push(c.island ? `${unitName(u)} island` : unitName(u));
    }
  }
  return [...by.values()].map((c) => ({ ...c, sub: c.units.join(', ') }));
}

/** Whole-project pack: one project cover + every designed unit type's set. */
export function buildSubmittalPackHTML(trade, date) {
  date = date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const designed = (trade.units || []).filter((u) => u.design);
  const totalUnits = designed.reduce((t, u) => t + unitQty(u), 0);
  const pm = projectMeta(trade);
  const colors = packColors(designed, pm);
  const rows = designed.map((u) => {
    const sched = scheduleRows(u.design);
    const q = unitQty(u);
    const c = unitColors(withIslandFlags(u.design), pm);
    return `<tr><td class="sw"><i style="background:${c[0].hex}"></i></td><td><strong>${esc(unitName(u))}</strong></td><td>${c.map((x) => x.name).join('<br>')}</td><td>Rev ${esc(unitRev(u))}</td><td class="num">&times;${q}</td><td class="num">${sched.rows.reduce((t, r) => t + r.qty, 0)} cab/unit</td><td class="num">${fmtUSD(sched.subtotal * q)}</td></tr>`;
  }).join('');
  const grand = designed.reduce((t, u) => t + scheduleRows(u.design).subtotal * unitQty(u), 0);
  const ctx = {
    projectName: trade.project || '', address: pm.address, date, rev: '-', idx: null, colors,
    unitLine: `${designed.length} unit type${designed.length === 1 ? '' : 's'} · ${totalUnits} units`, revRows: [['A', esc(date), 'Issued for approval']],
  };
  const cover = sheet(`
    <div class="cv">
      <div class="cv-head">
        <div class="cv-kick">CABINET SUBMITTAL PACK · ${esc(SPEC_SECTION)} · FOR APPROVAL</div>
        <h1>${esc(coverTitle(trade.project, pm))}</h1>
        ${trade.project && pm.address ? `<div class="cv-addr">${esc(pm.address)}</div>` : ''}
        <h2>${designed.length} unit type${designed.length === 1 ? '' : 's'} · ${totalUnits} units</h2>
        <div class="cv-sub">${esc(date)}</div>
      </div>
      <h3>UNIT TYPES &amp; COLORS</h3>
      <table class="units"><tr><th></th><th>Kitchen</th><th>Color</th><th>Rev</th><th class="num">Units</th><th class="num">Cabinets</th><th class="num">Cabinet total</th></tr>${rows}
        <tr class="tot"><td></td><td colspan="5">Cabinet total, all unit types <span class="mut">excl. shipping &amp; volume pricing, confirmed on order</span></td><td class="num">${fmtUSD(grand)}</td></tr></table>
      <div class="cv-cols"><div>${directoryHTML(pm)}</div><div>${SYMBOLS}</div></div>
    </div>`, titleBlock(ctx, { no: 'P-000', title: 'Project cover &amp; unit types', scale: 'NTS', action: true }));
  const body = designed.map((u) => buildUnitSheets({ project: trade.project, unit: u, date, pm })).join('\n');
  const title = titlePage({ project: trade.project, pm, colors,
    lines: [`Cabinet submittal pack · ${designed.length} unit type${designed.length === 1 ? '' : 's'} · ${totalUnits} units`, date] });
  return docWrap(`PL/NTH · Submittal pack · ${trade.project || 'project'}`, title + '\n' + cover + '\n' + body);
}

/** Popup-free document printing: the document renders into a hidden same-page
 *  iframe and the browser's print dialog opens from there (save as PDF). No
 *  window.open, so corporate popup blockers never interfere. */
export function openPrintWindow(html) {
  try {
    document.getElementById('plinthPrintFrame')?.remove();
    const f = document.createElement('iframe');
    f.id = 'plinthPrintFrame';
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(f);
    const doc = f.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      try { f.contentWindow.focus(); f.contentWindow.print(); }
      catch { uiAlert('The print dialog could not open. Try again, or use your browser’s Print command.', { title: 'Print' }); }
    }, 350);
  } catch {
    uiAlert('The document could not be prepared for printing. Try again.', { title: 'Print' });
  }
}
