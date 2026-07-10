// submittal.js — the PL/NTH trade submittal pack: an architect-ready,
// multi-page, letter-LANDSCAPE document per unit type (cover, plan, wall
// elevations, finish + cabinet schedule, SKU cut sheets), printed to PDF via
// the same window.open → document.write → print() flow as buildPlanSheetHTML.
//
// All layout maths lives in src/core/submittal.js (pure, node-tested). This
// file only turns those numbers into SVG + HTML, reusing the floorplan.js
// drawing style so every sheet in the set matches.

import { getFinish, corniceOption, WORKTOP_OPTIONS, FAMILY_LABEL, fmtUSD } from '../core/catalogue.js';
import { fmtIn, fmtFeetIn } from '../core/units.js';
import { unitName, unitQty } from '../core/cost.js';
import {
  computeElevation, wallsWithItems, scheduleRows, distinctSkus, drawingIndex,
  wallTitle, unitRev, esc, MOUNT, SURFACE_Y, WORKTOP_SLAB, CROWN_IN,
  roughInWalls, roughInPointsOnWall,
} from '../core/submittal.js';
import { buildFloorplanSVG, PLAN_STYLE as P, svgLine, svgDimH, svgDimV, svgN as n } from './floorplan.js';
import { drawFront, frontParts } from './frontdraw.js';
import { uiAlert } from './dialog.js';

const DISCLAIMER = 'Please note: all room dimensions, openings and services shown are as entered by the client. The client is responsible for checking and confirming every measurement on site before ordering — PL/NTH does not survey or verify site dimensions.';
const HANDLE_LABEL = { knob: 'Brushed steel knob' };  // fixed — Plinth hardware is knobs only

// ---- scribe filler, hatched exactly like the plan --------------------------
function drawFiller(out, f, Y) {
  const x0 = f.s0, y1 = Y(f.y0 + f.h), fw = f.w, fh = f.h;
  out.push(`<rect x="${n(x0)}" y="${n(y1)}" width="${n(fw)}" height="${n(fh)}" fill="#fff" stroke="${P.INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`);
  // 45-degree diagonal hatch = "site-scribed panel", matching the plan style
  const step = Math.max(3, Math.min(6, fw * 1.5));
  for (let t = step; t < fh + fw; t += step) {
    // the line x-x0 + y-y1 = t, clipped to the filler rectangle
    const xa = x0 + Math.max(0, t - fh), ya = y1 + Math.min(t, fh);
    const xb = x0 + Math.min(t, fw), yb = y1 + Math.max(0, t - fw);
    out.push(svgLine(xa, ya, xb, yb, P.W_18, '#9a9a9a'));
  }
  out.push(`<text x="${n(x0 + fw / 2)}" y="${n(y1 + fh / 2)}" font-size="2.4" fill="#666" text-anchor="middle" dominant-baseline="central" transform="rotate(-90 ${n(x0 + fw / 2)} ${n(y1 + fh / 2)})">FILL ${fmtIn(f.w)}</text>`);
}

// ---- the elevation drawing for one wall ------------------------------------
export function buildElevationSVG(elev) {
  const L = elev.wallLen, H = elev.height;
  const Y = (y) => H - y;             // world Y (up) → SVG y (down)
  const out = [];

  // wall face + heavier floor + ceiling line
  out.push(`<rect x="0" y="0" width="${n(L)}" height="${n(H)}" fill="none" stroke="${P.INK}" stroke-width="${P.W_WALL_IN}" vector-effect="non-scaling-stroke"/>`);
  out.push(svgLine(-5, H, L + 5, H, P.W_WALL_OUT));

  // openings on this wall, dashed, at their true sill/head heights
  for (const o of elev.openings) {
    out.push(`<rect x="${n(o.s0)}" y="${n(Y(o.y0 + o.h))}" width="${n(o.w)}" height="${n(o.h)}" fill="none" stroke="${P.UPPER}" stroke-width="${P.W_UPPER}" vector-effect="non-scaling-stroke" stroke-dasharray="3.5 2.5"/>`);
    out.push(`<text x="${n(o.s0 + o.w / 2)}" y="${n(Y(o.y0 + o.h) - 1.6)}" font-size="2.6" fill="${P.UPPER}" text-anchor="middle" letter-spacing="0.5">${esc(o.type.toUpperCase())}${o.type === 'window' ? ` · SILL ${fmtIn(o.y0)}` : ''}</text>`);
  }

  // cabinets at their true x + mount height, drawn with their full
  // master-library fronts (shaker panels, drawer stacks, glazing, returns)
  for (const e of elev.items) out.push(drawFront(e.cab, e.s0, e.y0, Y, { code: e.code }));

  // worktop slab over the base runs (35" carcass + 1½" slab = 36½")
  for (const wt of elev.worktops) {
    out.push(`<rect x="${n(wt.s0 - 0.4)}" y="${n(Y(SURFACE_Y))}" width="${n(wt.s1 - wt.s0 + 0.8)}" height="${n(WORKTOP_SLAB)}" fill="#efece3" stroke="${P.INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`);
  }

  // scribe fillers, hatched like the plan
  for (const f of elev.fillers) drawFiller(out, f, Y);

  // crown molding band over uppers / talls / tall fillers
  for (const c of elev.crowns) {
    out.push(`<rect x="${n(c.s0 - 0.6)}" y="${n(Y(c.top + CROWN_IN))}" width="${n(c.s1 - c.s0 + 1.2)}" height="${n(CROWN_IN)}" fill="#fff" stroke="${P.INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`);
  }

  // right-hand vertical datums: worktop, upper underside, ceiling
  let vx = L + 7;
  if (elev.worktops.length) { out.push(svgDimV(Y(SURFACE_Y), Y(0), vx, fmtIn(SURFACE_Y))); vx += 8; }
  if (elev.items.some((i) => i.type === 'WALL')) { out.push(svgDimV(Y(MOUNT.WALL), Y(0), vx, fmtIn(MOUNT.WALL))); vx += 8; }
  out.push(svgDimV(Y(H), Y(0), vx, fmtFeetIn(H)));

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
    if (ch.hi - ch.lo > 0.5) out.push(svgDimH(ch.lo, ch.hi, offRun, fmtIn(ch.hi - ch.lo)));
  }
  out.push(svgDimH(0, L, offWall, fmtFeetIn(L)));

  const vbX = -12, vbY = -8, vbW = vx + 8 - vbX, vbH = (H + 29) - vbY;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vbX)} ${n(vbY)} ${n(vbW)} ${n(vbH)}" font-family="ui-sans-serif, Arial, sans-serif">
    <rect x="${n(vbX)}" y="${n(vbY)}" width="${n(vbW)}" height="${n(vbH)}" fill="#fff"/>
    ${out.join('\n')}
  </svg>`;
}

// ---- MEP rough-in drawing for one wall (sheet A-5xx) ------------------------
// Plan-style wall face with ghosted cabinets for context; every point gets a
// symbol at its true height, a leader to a staggered label row above the wall,
// and a dimension chain locating it from the LEFT wall corner.
const RI_SYMBOL = {
  sink: (x, y) => `<path d="M ${n(x - 2.2)} ${n(y - 1.9)} L ${n(x + 2.2)} ${n(y - 1.9)} L ${n(x)} ${n(y + 2)} Z" fill="#fff" stroke="${P.INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`,
  range: (x, y) => `<path d="M ${n(x)} ${n(y - 2.4)} L ${n(x + 2.4)} ${n(y)} L ${n(x)} ${n(y + 2.4)} L ${n(x - 2.4)} ${n(y)} Z" fill="#fff" stroke="${P.INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`,
  hood: (x, y) => `<circle cx="${n(x)}" cy="${n(y)}" r="2.2" fill="#fff" stroke="${P.INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`
    + svgLine(x - 1.5, y - 1.5, x + 1.5, y + 1.5, P.W_CAB) + svgLine(x - 1.5, y + 1.5, x + 1.5, y - 1.5, P.W_CAB),
  outlet: (x, y) => `<circle cx="${n(x)}" cy="${n(y)}" r="2.2" fill="#fff" stroke="${P.INK}" stroke-width="${P.W_CAB}" vector-effect="non-scaling-stroke"/>`
    + svgLine(x - 0.9, y - 1.1, x - 0.9, y + 1.1, P.W_CAB) + svgLine(x + 0.9, y - 1.1, x + 0.9, y + 1.1, P.W_CAB),
};
const riSymbol = (kind, x, y) => (RI_SYMBOL[kind] || RI_SYMBOL.outlet)(x, y);

export function buildRoughInSVG(design, wall, pts) {
  const elev = computeElevation(design, wall);
  const L = elev.wallLen, H = elev.height;
  const Y = (y) => H - y;
  const out = [];

  // wall face + heavier floor line (same frame as the elevations)
  out.push(`<rect x="0" y="0" width="${n(L)}" height="${n(H)}" fill="none" stroke="${P.INK}" stroke-width="${P.W_WALL_IN}" vector-effect="non-scaling-stroke"/>`);
  out.push(svgLine(-5, H, L + 5, H, P.W_WALL_OUT));

  // ghosted cabinets + worktop line for context
  for (const e of elev.items) {
    out.push(`<rect x="${n(e.s0)}" y="${n(Y(e.y0 + e.h))}" width="${n(e.w)}" height="${n(e.h)}" fill="none" stroke="#c8bfae" stroke-width="${P.W_18}" vector-effect="non-scaling-stroke" stroke-dasharray="2.5 2"/>`);
  }
  for (const wt of elev.worktops) out.push(svgLine(wt.s0, Y(SURFACE_Y), wt.s1, Y(SURFACE_Y), P.W_18, '#c8bfae'));

  // points: dashed riser, symbol at true height, leader to a staggered label row
  pts.forEach((p, i) => {
    const px = p.x, py = Y(Math.min(p.height, H));
    const lane = i % 3;                              // stagger labels in 3 rows
    const ly = -5 - lane * 7;
    out.push(`<line x1="${n(px)}" y1="${n(H)}" x2="${n(px)}" y2="${n(py + 2.6)}" stroke="${P.DIM}" stroke-width="${P.W_DIM}" vector-effect="non-scaling-stroke" stroke-dasharray="2 2"/>`);
    out.push(`<line x1="${n(px)}" y1="${n(py - 2.6)}" x2="${n(px)}" y2="${n(ly + 1.6)}" stroke="${P.DIM}" stroke-width="${P.W_DIM}" vector-effect="non-scaling-stroke" stroke-dasharray="2 2"/>`);
    out.push(riSymbol(p.kind, px, py));
    const hgt = p.height >= H ? 'AT CEILING' : `${fmtIn(p.height)} AFF`;
    out.push(`<text x="${n(px)}" y="${n(ly - 3)}" font-size="2.7" font-weight="700" fill="${P.INK}" text-anchor="middle">${esc(p.label)}</text>`);
    out.push(`<text x="${n(px)}" y="${n(ly)}" font-size="2.5" fill="${P.DIM}" text-anchor="middle">${esc(hgt)}</text>`);
  });

  // dimension chain from the LEFT wall corner through every point
  const offChain = H + 7, offWall = H + 15;
  const xs = [0, ...pts.map((p) => p.x)];
  out.push(svgLine(0, offChain, Math.max(...xs), offChain, P.W_DIM, P.DIM));
  const tick = (a) => out.push(svgLine(a - 1, offChain + 1, a + 1, offChain - 1, P.W_DIM, P.DIM));
  xs.forEach(tick);
  for (let i = 1; i < xs.length; i++) {
    const len = xs[i] - xs[i - 1];
    if (len < 4) continue;
    out.push(`<text x="${n((xs[i] + xs[i - 1]) / 2)}" y="${n(offChain - 1.8)}" font-size="${P.F_DIM * 0.92}" fill="${P.DIM}" text-anchor="middle">${fmtIn(len)}</text>`);
  }
  out.push(svgDimH(0, L, offWall, fmtFeetIn(L)));

  const vbX = -12, vbY = -27, vbW = L + 24, vbH = (H + 21) - vbY;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vbX)} ${n(vbY)} ${n(vbW)} ${n(vbH)}" font-family="ui-sans-serif, Arial, sans-serif">
    <rect x="${n(vbX)}" y="${n(vbY)}" width="${n(vbW)}" height="${n(vbH)}" fill="#fff"/>
    ${out.join('\n')}
  </svg>`;
}

// ---- small SKU glyph for the cut sheets ------------------------------------
export function skuGlyphSVG(cab) {
  const out = [];
  const Y = (y) => cab.h - y;
  out.push(drawFront(cab, 0, 0, Y));
  const fp = frontParts(cab);           // corner returns widen the drawn extent
  out.push(svgDimH(fp.x0, fp.x1, cab.h + 7, fmtIn(fp.x1 - fp.x0)));
  out.push(svgDimV(0, cab.h, fp.x0 - 6, fmtIn(cab.h)));
  const vb = `${n(fp.x0 - 16)} -4 ${n(fp.x1 - fp.x0 + 28)} ${n(cab.h + 18)}`;
  // constant mm-per-inch so every glyph on the sheet is mutually to scale
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" style="height:${((cab.h + 18) * 0.95).toFixed(1)}mm" font-family="ui-sans-serif, Arial, sans-serif">${out.join('\n')}</svg>`;
}

// ---- sheet scaffolding ------------------------------------------------------
function sheet(subtitle, metaHTML, bodyHTML, foot) {
  return `<section class="sheet">
    <header>
      <div class="brand">PL<span class="slash">/</span>NTH<small>${esc(subtitle)}</small></div>
      <div class="meta">${metaHTML}</div>
    </header>
    <div class="body">${bodyHTML}</div>
    <footer>
      <span class="disc"><strong>Please note:</strong> ${esc(DISCLAIMER.replace('Please note: ', ''))}</span>
      <span class="stamp">${foot.rev === '-' ? '' : `Rev ${esc(foot.rev)} · `}${esc(foot.date)} · ${esc(foot.no)}<br>Made with PL/NNER — the PL/NTH kitchen planner · plinthmade.com</span>
    </footer>
  </section>`;
}

function meta(project, uname, no, rev, date) {
  const revBit = rev === '-' ? '' : ` · Rev ${esc(rev)}`;
  return `${esc(project || 'PL/NTH trade project')}<br>${esc(uname)}<br>${esc(no)}${revBit} · ${esc(date)}`;
}

// ---- the per-unit sheet set --------------------------------------------------
/** All sheets for one unit type (cover → plan → elevations → schedule → cuts). */
export function buildUnitSheets({ project, unit, date }) {
  const design = unit.design;
  if (!design) return '';
  const uname = unitName(unit);
  const qty = unitQty(unit);
  const rev = unitRev(unit);
  const idx = drawingIndex(design);
  const foot = (no) => ({ rev, date, no });
  const sheets = [];
  let iNo = 0;
  const no = () => idx[iNo++].no;

  // ---- COVER ----
  const hist = (unit.revHistory && unit.revHistory.length)
    ? unit.revHistory.map((h) => `<tr><td>Rev ${esc(h.rev)}</td><td>${esc(h.date)}</td><td>Reissued</td></tr>`).join('')
    : '';
  const finish = getFinish(design.finish);
  sheets.push(sheet('TRADE SUBMITTAL', meta(project, `${uname} × ${qty}`, 'A-000', rev, date), `
    <div class="cover">
      <div class="cover-kicker">CABINETRY SUBMITTAL SET · FOR APPROVAL</div>
      <h1>${esc(project || 'PL/NTH trade project')}</h1>
      <h2>${esc(uname)} — ${qty} unit${qty === 1 ? '' : 's'}</h2>
      <div class="cover-sub">Revision ${esc(rev)} · ${esc(date)} · Finish: ${esc(design.finish || '-')} <span class="swatch" style="background:${finish.hex}"></span></div>
      <div class="cover-cols">
        <div>
          <h3>DRAWING INDEX</h3>
          <table class="idx">${idx.map((d) => `<tr><td class="no">${esc(d.no)}</td><td>${esc(d.title)}</td></tr>`).join('')}</table>
        </div>
        <div>
          <h3>REVISION HISTORY</h3>
          <table class="idx"><tr><td class="no">Rev A</td><td>Initial issue</td><td></td></tr>${hist}</table>
          <h3>FIELD VERIFICATION</h3>
          <p class="disc-block">${esc(DISCLAIMER)}</p>
        </div>
      </div>
    </div>`, foot(no())));

  // ---- PLAN SHEET (the existing technical plan, KEY table included) ----
  sheets.push(sheet('FLOOR PLAN & KEY', meta(project, uname, 'A-100', rev, date),
    `<div class="fig">${buildFloorplanSVG(design)}</div>`, foot(no())));

  // ---- ELEVATIONS: one sheet per wall that has cabinets ----
  for (const wall of wallsWithItems(design)) {
    const elev = computeElevation(design, wall);
    const dNo = no();
    sheets.push(sheet(`ELEVATION — ${wallTitle(wall)}`, meta(project, uname, dNo, rev, date), `
      <div class="fig">${buildElevationSVG(elev)}</div>
      <div class="fig-note">Interior elevation, viewed facing the ${esc(wall)} wall. Dimensions in inches. Hatched panels are site-scribed fillers; dashed outlines are openings and appliances (appliances not supplied by PL/NTH).</div>`,
      foot(dNo)));
  }

  // ---- SCHEDULE SHEET ----
  const sched = scheduleRows(design);
  const wtOpt = WORKTOP_OPTIONS[design.room?.worktop] || null;
  const crown = corniceOption(design.room?.cornice || 'none');
  const finRows = [
    ['Paint finish', `${design.finish || '-'} <span class="swatch" style="background:${finish.hex}"></span> ${esc(finish.hex)}`, 'All exposed cabinet faces, painted in the PL/NTH workshop'],
    ['Worktop', wtOpt ? esc(wtOpt.label) : '-', 'Shown for coordination only — worktop by others, not supplied by PL/NTH'],
    ['Hardware', esc(HANDLE_LABEL[design.handle] || HANDLE_LABEL.knob), 'One per door / drawer face, fitted'],
    ['Crown molding', esc(crown.label), crown.label === 'No crown' ? '-' : 'Runs over wall, counter and tall cabinets incl. tall scribe fillers'],
    ['Plinth', '115mm (4&#189;") painted plinth', 'Flush to the cabinet face, site-scribed to the floor'],
  ].map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td><td class="mut">${r[2]}</td></tr>`).join('');

  const rowsHTML = sched.rows.map((r) => `<tr>
      <td class="num">${r.qty}</td><td><strong>${esc(r.code)}</strong></td><td>${esc(FAMILY_LABEL[r.type] || r.type)}</td><td>${esc(r.desc)}</td>
      <td class="num">${fmtIn(r.w)}</td><td class="num">${fmtIn(r.d)}</td><td class="num">${fmtIn(r.h)}</td>
      <td class="num">${fmtUSD(r.each)}</td><td class="num"><strong>${fmtUSD(r.line)}</strong></td></tr>`).join('');

  sheets.push(sheet('FINISH & CABINET SCHEDULE', meta(project, uname, 'A-300', rev, date), `
    <div class="two-col">
      <div>
        <h3>FINISH &amp; HARDWARE SCHEDULE</h3>
        <table class="fin">${finRows}</table>
      </div>
      <div>
        <h3>PROJECT TOTALS</h3>
        <table class="fin">
          <tr><th>Cabinets per unit</th><td class="num">${sched.rows.reduce((t, r) => t + r.qty, 0)}</td><td></td></tr>
          <tr><th>Cabinet total per unit</th><td class="num">${fmtUSD(sched.subtotal)}</td><td></td></tr>
          <tr><th>Unit count</th><td class="num">&times;${qty}</td><td class="mut">${esc(uname)}</td></tr>
          <tr class="hi"><th>Cabinet total, all units</th><td class="num"><strong>${fmtUSD(sched.subtotal * qty)}</strong></td><td class="mut">excl. shipping — confirmed on order</td></tr>
        </table>
      </div>
    </div>
    <h3>CABINET SCHEDULE</h3>
    <table class="cab">
      <thead><tr><th class="num">QTY</th><th>CODE</th><th>TYPE</th><th>DESCRIPTION</th><th class="num">W</th><th class="num">D</th><th class="num">H</th><th class="num">EACH</th><th class="num">LINE</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
      <tfoot><tr><td colspan="8" class="tr">Per-unit cabinet subtotal</td><td class="num"><strong>${fmtUSD(sched.subtotal)}</strong></td></tr></tfoot>
    </table>
    <div class="fig-note">Scribe fillers, crown molding and end panels are quantified at order from the final site dimensions. Appliances shown on plan are not supplied by PL/NTH.</div>`,
    foot('A-300')));

  // ---- CUT SHEETS: 3 per page ----
  const skus = distinctSkus(design);
  const pages = Math.max(1, Math.ceil(skus.length / 3));
  for (let p = 0; p < pages; p++) {
    const chunk = skus.slice(p * 3, p * 3 + 3);
    const dNo = `A-4${String(p + 1).padStart(2, '0')}`;
    const cards = chunk.map((s) => `
      <div class="cut-card">
        <div class="cut-glyph">${skuGlyphSVG(s.cab)}</div>
        <div class="cut-code">${esc(s.code)} <span class="cut-fam">${esc(FAMILY_LABEL[s.cab.type] || s.cab.type)}</span></div>
        <div class="cut-desc">${esc(s.cab.desc)}</div>
        <div class="cut-dims">W ${fmtIn(s.cab.w)} &middot; D ${fmtIn(s.cab.d)} &middot; H ${fmtIn(s.cab.h)} &middot; ${s.qty} per unit</div>
        ${s.notes.length ? `<ul class="cut-notes">${s.notes.map((nt) => `<li>${esc(nt)}</li>`).join('')}</ul>` : ''}
      </div>`).join('');
    sheets.push(sheet(`CABINET CUT SHEETS ${p + 1}/${pages}`, meta(project, uname, dNo, rev, date),
      `<div class="cut-grid">${cards || '<div class="fig-note">No PL/NTH cabinets in this design yet.</div>'}</div>`, foot(dNo)));
  }

  // ---- MEP ROUGH-IN (A-5xx): one sheet per wall carrying utility points ----
  const KIND_LABEL = {
    sink: 'Plumbing — waste + hot/cold supply', dishwasher: 'Electrical — dishwasher outlet',
    range: 'Gas / electrical — range point', wallOven: 'Electrical — wall-oven point (T9)',
    hood: 'Ventilation — hood duct centerline', fridge: 'Electrical — refrigerator receptacle',
  };
  roughInWalls(design).forEach((wall, i) => {
    const pts = roughInPointsOnWall(design, wall);
    const dNo = `A-5${String(i).padStart(2, '0')}`;
    const ptRows = pts.map((p) => `<tr>
        <td><strong>${esc(p.label)}</strong></td><td>${esc(KIND_LABEL[p.kind] || p.kind)}</td>
        <td class="num">${fmtIn(p.x)}</td>
        <td class="num">${p.height >= (design.room?.height || 96) ? 'at ceiling' : `${fmtIn(p.height)} AFF`}</td>
        <td class="mut">${esc(p.note || '')}</td></tr>`).join('');
    sheets.push(sheet(`MEP ROUGH-IN — ${wallTitle(wall)}`, meta(project, uname, dNo, rev, date), `
      <div class="fig ri-fig">${buildRoughInSVG(design, wall, pts)}</div>
      <table class="cab ri-tab">
        <thead><tr><th>POINT</th><th>SERVICE</th><th class="num">FROM LEFT CORNER</th><th class="num">HEIGHT</th><th>NOTE</th></tr></thead>
        <tbody>${ptRows}</tbody>
      </table>
      <div class="fig-note">Rough-in locations are measured from the LEFT wall corner (facing the ${esc(wall)} wall) to each point's centerline, heights above finished floor. Cabinets shown dashed for reference only. All rough-in work by others — verify locations, clearances and requirements with the appliance specifications and local code before installation.</div>`,
      foot(dNo)));
  });

  return sheets.join('\n');
}

// ---- documents ----------------------------------------------------------------
const CSS = `
    @page { size: letter landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #645b3d; margin: 0; }
    .sheet { height: 195mm; display: flex; flex-direction: column; page-break-after: always; overflow: hidden; }
    .sheet:last-child { page-break-after: auto; }
    header { display: flex; justify-content: space-between; align-items: flex-end;
      background: #645b3d; color: #f7f5eb; padding: 12px 18px; border-radius: 6px; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: 3px; }
    .brand .slash { opacity: 0.55; }
    .brand small { display: block; font-size: 9px; font-weight: 400; letter-spacing: 4px; opacity: 0.7; margin-top: 2px; }
    .meta { text-align: right; font-size: 10px; line-height: 1.55; opacity: 0.92; }
    .body { flex: 1; margin-top: 8px; border: 1px solid #d9cfb8; border-radius: 6px; padding: 8px 12px; overflow: hidden; }
    .fig svg { display: block; width: 100%; height: auto; max-height: 136mm; margin: 0 auto; }
    .ri-fig svg { max-height: 104mm; }
    .ri-tab th:nth-child(1) { width: 20%; } .ri-tab th:nth-child(2) { width: 30%; }
    .ri-tab th:nth-child(3) { width: 15%; } .ri-tab th:nth-child(4) { width: 10%; }
    .ri-tab th.num { text-align: right; }
    .fig-note { font-size: 8.5px; color: #7d7558; margin-top: 4px; }
    footer { display: flex; justify-content: space-between; gap: 14px; margin-top: 6px;
      border-top: 1px solid #d9cfb8; padding-top: 5px; font-size: 8px; color: #7d7558; }
    footer .disc { max-width: 64%; }
    footer .stamp { text-align: right; white-space: nowrap; }
    h3 { font-size: 10px; letter-spacing: 1.5px; color: #7d7558; margin: 10px 0 4px; }
    .cover { padding: 8mm 6mm 0; }
    .cover-kicker { font-size: 10px; letter-spacing: 3px; color: #7d7558; }
    .cover h1 { font-size: 30px; margin: 6px 0 0; letter-spacing: 0.5px; }
    .cover h2 { font-size: 17px; margin: 4px 0 0; font-weight: 600; color: #5c5535; }
    .cover-sub { font-size: 11px; margin-top: 6px; color: #5c5535; }
    .cover-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 8mm; }
    .swatch { display: inline-block; width: 10px; height: 10px; border: 1px solid #b8ab90; border-radius: 2px; vertical-align: -1px; }
    table { border-collapse: collapse; width: 100%; font-size: 9.5px; }
    table.idx td { padding: 3px 6px 3px 0; border-bottom: 1px solid #ece4d2; }
    table.idx td.no { width: 52px; font-weight: 700; }
    .disc-block { font-size: 9px; color: #7d7558; line-height: 1.5; border: 1px solid #d9cfb8; border-radius: 4px; padding: 6px 8px; }
    .two-col { display: grid; grid-template-columns: 1.2fr 1fr; gap: 8mm; }
    table.fin th { text-align: left; padding: 3px 8px 3px 0; width: 118px; color: #7d7558; font-weight: 600; vertical-align: top; }
    table.fin td { padding: 3px 8px 3px 0; border-bottom: 1px solid #ece4d2; vertical-align: top; }
    table.fin td.mut { color: #948e6e; font-size: 8.5px; }
    table.fin tr.hi td, table.fin tr.hi th { border-top: 2px solid #645b3d; border-bottom: none; }
    table.cab th { text-align: left; font-size: 8px; letter-spacing: 0.8px; color: #7d7558; border-bottom: 1px solid #645b3d; padding: 2px 6px 3px 0; }
    table.cab td { padding: 2.5px 6px 2.5px 0; border-bottom: 1px solid #ece4d2; }
    .num { text-align: right; }
    .tr { text-align: right; color: #7d7558; }
    .cut-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; height: 100%; align-content: start; padding-top: 4mm; }
    .cut-card { border: 1px solid #d9cfb8; border-radius: 6px; padding: 8px 10px; text-align: center; }
    .cut-glyph { display: flex; justify-content: center; align-items: flex-end; min-height: 56mm; }
    .cut-glyph svg { max-width: 100%; }
    .cut-code { font-size: 15px; font-weight: 800; margin-top: 4px; }
    .cut-fam { font-size: 9px; font-weight: 400; color: #7d7558; letter-spacing: 1px; }
    .cut-desc { font-size: 10px; margin-top: 2px; }
    .cut-dims { font-size: 9px; color: #5c5535; margin-top: 3px; }
    .cut-notes { text-align: left; font-size: 8.5px; color: #7d7558; margin: 5px 0 0; padding-left: 14px; }
    .cut-notes li { margin-bottom: 1px; }
    @media print { header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

function docWrap(title, sheetsHTML) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${sheetsHTML}</body></html>`;
}

/** Full submittal document for ONE unit type. */
export function buildSubmittalHTML({ project, unit, date }) {
  date = date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return docWrap(`PL/NTH — Submittal — ${unitName(unit)}`, buildUnitSheets({ project, unit, date }));
}

/** Whole-project pack: one project cover + every designed unit type's set. */
export function buildSubmittalPackHTML(trade, date) {
  date = date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const designed = (trade.units || []).filter((u) => u.design);
  const totalUnits = designed.reduce((t, u) => t + unitQty(u), 0);
  const rows = designed.map((u) => {
    const sched = scheduleRows(u.design);
    const q = unitQty(u);
    return `<tr><td style="white-space:nowrap;font-weight:700">${esc(unitName(u))}</td><td>Rev ${esc(unitRev(u))}</td><td class="num">&times;${q}</td><td class="num">${sched.rows.reduce((t, r) => t + r.qty, 0)} cab/unit</td><td class="num">${fmtUSD(sched.subtotal * q)}</td></tr>`;
  }).join('');
  const grand = designed.reduce((t, u) => t + scheduleRows(u.design).subtotal * unitQty(u), 0);
  const cover = sheet('TRADE SUBMITTAL PACK', meta(trade.project, `${designed.length} unit type${designed.length === 1 ? '' : 's'} · ${totalUnits} units`, 'P-000', '-', date), `
    <div class="cover">
      <div class="cover-kicker">CABINETRY SUBMITTAL PACK · ALL UNIT TYPES · FOR APPROVAL</div>
      <h1>${esc(trade.project || 'PL/NTH trade project')}</h1>
      <h2>${designed.length} unit type${designed.length === 1 ? '' : 's'} — ${totalUnits} units</h2>
      <div class="cover-sub">${esc(date)} · Finish: ${esc(trade.finish || '-')}</div>
      <div class="cover-cols">
        <div>
          <h3>UNIT TYPES IN THIS PACK</h3>
          <table class="idx">${rows}</table>
          <table class="fin" style="margin-top:6px"><tr class="hi"><th>Cabinet total, all unit types</th><td class="num"><strong>${fmtUSD(grand)}</strong></td><td class="mut">excl. shipping — confirmed on order</td></tr></table>
        </div>
        <div>
          <h3>FIELD VERIFICATION</h3>
          <p class="disc-block">${esc(DISCLAIMER)}</p>
        </div>
      </div>
    </div>`, { rev: '-', date, no: 'P-000' });
  const body = designed.map((u) => buildUnitSheets({ project: trade.project, unit: u, date })).join('\n');
  return docWrap(`PL/NTH — Submittal pack — ${trade.project || 'project'}`, cover + '\n' + body);
}

/** Same print mechanism as the plan sheet: new window → write → print(). */
export function openPrintWindow(html) {
  const w = window.open('', '_blank');
  if (!w) { uiAlert('Allow pop-ups for this site, then try again.', { title: 'Pop-up blocked' }); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}
