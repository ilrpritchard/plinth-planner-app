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

import { getFinish, corniceOption, FAMILY_LABEL, familyOf, fmtUSD } from '../core/catalogue.js';
import { fmtIn, fmtFeetIn } from '../core/units.js';
import { unitName, unitQty } from '../core/cost.js';
import {
  computeElevation, wallsWithItems, scheduleRows, distinctSkus, drawingIndex,
  wallTitle, unitRev, esc, MOUNT, SURFACE_Y, WORKTOP_SLAB, CROWN_IN, SPEC_SECTION,
  islandSheets, computeIslandElevation, cutSheetPages, CUT_MM_PER_IN,
} from '../core/submittal.js';
import { hingeOf, hingeLabel } from '../core/hinge.js';
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
  out.push(`<text x="${n(x0 + fw / 2)}" y="${n(y1 + fh / 2)}" font-size="2.4" fill="#666" text-anchor="middle" dominant-baseline="central" transform="rotate(-90 ${n(x0 + fw / 2)} ${n(y1 + fh / 2)})">FILL ${fmtIn(f.w)}</text>`);
}

// ---- the elevation drawing for one wall ------------------------------------
export function buildElevationSVG(elev) {
  const L = elev.wallLen, H = elev.height;
  const Y = (y) => H - y;             // world Y (up) → SVG y (down)
  const out = [];

  // wall face + heavier floor + ceiling line (an island face has no wall: floor only)
  if (!elev.island) out.push(`<rect x="0" y="0" width="${n(L)}" height="${n(H)}" fill="none" stroke="${P.INK}" stroke-width="${P.W_WALL_IN}" vector-effect="non-scaling-stroke"/>`);
  out.push(svgLine(elev.island ? -10 : -5, H, L + (elev.island ? 10 : 5), H, P.W_WALL_OUT));

  // openings on this wall, dashed, at their true sill/head heights
  for (const o of elev.openings) {
    out.push(`<rect x="${n(o.s0)}" y="${n(Y(o.y0 + o.h))}" width="${n(o.w)}" height="${n(o.h)}" fill="none" stroke="${P.UPPER}" stroke-width="${P.W_UPPER}" vector-effect="non-scaling-stroke" stroke-dasharray="3.5 2.5"/>`);
    out.push(`<text x="${n(o.s0 + o.w / 2)}" y="${n(Y(o.y0 + o.h) - 1.6)}" font-size="2.6" fill="${P.UPPER}" text-anchor="middle" letter-spacing="0.5">${esc(o.type.toUpperCase())}${o.type === 'window' ? ` · SILL ${fmtIn(o.y0)}` : ''}</text>`);
  }

  // cabinets at their true x + mount height, drawn with their full
  // master-library fronts (shaker panels, drawer stacks, glazing, returns)
  for (const e of elev.items) out.push(drawFront(e.cab, e.s0, e.y0, Y, { code: e.code, hinge: hingeOf(e.cab, e.it) }));

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
  out.push(drawFront(cab, 0, 0, Y, { hinge }));
  const fp = frontParts(cab);           // corner returns widen the drawn extent
  out.push(svgDimH(fp.x0, fp.x1, cab.h + 7, fmtIn(fp.x1 - fp.x0)));
  out.push(svgDimV(0, cab.h, fp.x0 - 6, fmtIn(cab.h)));
  const vb = `${n(fp.x0 - 16)} -4 ${n(fp.x1 - fp.x0 + 28)} ${n(cab.h + 18)}`;
  // constant mm-per-inch so every glyph on the sheet is mutually to scale
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" style="height:${((cab.h + 18) * CUT_MM_PER_IN).toFixed(1)}mm" font-family="ui-sans-serif, Arial, sans-serif">${out.join('\n')}</svg>`;
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
      <span class="disc"><strong>Please note:</strong> ${esc(DISCLAIMER_BODY)}</span>
      <span class="stamp">${foot.rev === '-' ? '' : `Rev ${esc(foot.rev)} · `}${esc(foot.date)} · ${esc(foot.no)}<br>plinthmade.com</span>
    </footer>
  </section>`;
}

// Title block: project name and/or address when the Buyer has entered them —
// never a placeholder name.
function meta(project, uname, no, rev, date, address) {
  const revBit = rev === '-' ? '' : ` · Rev ${esc(rev)}`;
  const lines = [project, address].filter(Boolean).map((t) => `${esc(t)}<br>`).join('');
  return `${lines}${esc(uname)}<br>${esc(no)}${revBit} · ${esc(date)}`;
}

/** Cover headline: the project name, else its address, else a plain title. */
const coverTitle = (project, pm) => project || pm.address || 'Cabinet submittal';

// ---- cover blocks: project directory + approval stamp ----------------------
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

function stampBoxHTML() {
  return `<div class="stamp-box">
      <h3>SUBMITTAL ACTION</h3>
      <div class="stamp-opts">
        <span><i class="cb"></i> APPROVED</span>
        <span><i class="cb"></i> APPROVED AS NOTED</span>
        <span><i class="cb"></i> REVISE &amp; RESUBMIT</span>
      </div>
      <div class="stamp-lines"><span>BY</span><span>DATE</span></div>
    </div>`;
}

// ---- compliance & product data (sheet A-600) --------------------------------
// NOTE: statements below are submittal-coordination language (Imogen must
// verify the claims with the workshop before first real issue).
function complianceBody(design, pm = {}) {
  const finishLabel = design.finish === 'Custom RAL' && pm.finishRal
    ? `Custom: matched to RAL ${esc(pm.finishRal)}`
    : `${esc(design.finish || '-')} (one of 15 PL/NTH standard colors)`;
  const prodRows = [
    ['Cabinet type', 'Painted face-frame (shaker) cabinetry: floor, wall, counter &amp; tall units'],
    ['Carcass construction', '18mm panel construction, oak-veneer interior; 22mm front-frame legs'],
    ['Doors &amp; faces', 'Painted shaker fronts, 80mm stiles &amp; rails; glazed doors clear glass'],
    ['Plinth', '115mm (4&#189;") painted plinth, flush to the cabinet face'],
    ['Paint finish', `${finishLabel}, factory-applied in the PL/NTH workshop. Custom color matched to any RAL on request.`],
    ['Hardware', `${esc(HARDWARE_LABEL)}. ${esc(HARDWARE_NOTE)}.`],
    ['Country of origin', 'Made in England; supplied to the US by PL/NTH'],
  ].map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td></tr>`).join('');
  const compRows = [
    ['Formaldehyde emissions', 'Composite wood components supplied compliant with TSCA Title VI (40 CFR Part 770) / CARB Phase 2 emission limits. Supplier declarations held on file; certificates issued on request.'],
    ['Surface burning', 'ASTM E84 surface-burning characteristics: panel product test data available on request.'],
    ['Specification section', esc(SPEC_SECTION)],
    ['Accessible units', 'ANSI A117.1 / ADA accessible-unit requirements. Coordinate variants with the PL/NTH trade team at spec stage.'],
    ['Field verification', esc(DISCLAIMER_BODY)],
  ].map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td></tr>`).join('');
  return `<div class="two-col">
      <div><h3>PRODUCT DATA</h3><table class="fin comp">${prodRows}</table></div>
      <div><h3>COMPLIANCE STATEMENTS</h3><table class="fin comp">${compRows}</table></div>
    </div>
    <div class="fig-note">Statements on this sheet are provided for submittal coordination.</div>`;
}

// ---- plan sheet (A-100) -----------------------------------------------------------
// The drawing takes the whole sheet height; the KEY is an HTML table beside it
// (or under it, in two columns, when the room is very wide) instead of riding
// inside the SVG, where it used to squeeze the plan into half the page.
function planBody(design) {
  const svg = buildFloorplanSVG(design, null, { key: false, tight: true });
  const rows = planKeyRows(design);
  const room = design.room || {};
  const wide = (room.width + 59) / (room.depth + 59) > 1.75;
  const tr = (r) => `<tr><td class="num">${r.qty}</td><td><strong>${esc(r.code)}</strong></td><td>${esc(r.family)}${r.cab.notSupplied ? ' *' : ''} &middot; ${esc(r.cab.desc)}</td><td>${esc(hingeLabel(r.hinge))}</td><td class="num">${fmtIn(r.cab.w)}</td><td class="num">${fmtIn(r.cab.d)}</td><td class="num">${fmtIn(r.cab.h)}</td></tr>`;
  const table = (rs) => `<table class="cab key"><thead><tr><th class="num">QTY</th><th>CODE</th><th>DESCRIPTION</th><th>HINGE</th><th class="num">W</th><th class="num">D</th><th class="num">H</th></tr></thead><tbody>${rs.map(tr).join('')}</tbody></table>`;
  const half = Math.ceil(rows.length / 2);
  const notes = `<div class="fig-note">${rows.some((r) => r.hinge) ? 'Hinge side as viewed facing the cabinet front. Pair = left + right hung doors. ' : ''}${rows.some((r) => r.cab.notSupplied) ? '* Appliance, shown in grey for layout only, not supplied by PL/NTH.' : ''}</div>`;
  const key = !rows.length ? '' : `<div class="plan-key"><h3>KEY</h3>${wide ? `<div class="key-cols">${table(rows.slice(0, half))}${table(rows.slice(half))}</div>` : table(rows)}${notes}</div>`;
  return `<div class="plan-wrap${wide ? ' wide' : ''}"><div class="fig plan-fig">${svg}</div>${key}</div>`;
}

// ---- the per-unit sheet set --------------------------------------------------
/** All sheets for one unit type (cover → plan → elevations → schedule → cuts →
 *  compliance). `pm` carries the project meta (address, architect,
 *  gc, owner, finishRal) from the trade project. */
export function buildUnitSheets({ project, unit, date, pm = {} }) {
  const design = unit.design;
  if (!design) return '';
  const uname = unitName(unit);
  const qty = unitQty(unit);
  const rev = unitRev(unit);
  const idx = drawingIndex(design);         // sheet numbering only — the cover carries no index
  const foot = (no) => ({ rev, date, no });
  const sheets = [];
  let iNo = 0;
  const no = () => idx[iNo++].no;
  const m = (uname2, no2, rev2) => meta(project, uname2, no2, rev2, date, pm.address);

  // ---- COVER ----
  const hist = (unit.revHistory && unit.revHistory.length)
    ? unit.revHistory.map((h) => `<tr><td>Rev ${esc(h.rev)}</td><td>${esc(h.date)}</td><td>Reissued</td></tr>`).join('')
    : '';
  const finish = getFinish(design.finish);
  const finishBit = design.finish === 'Custom RAL' && pm.finishRal
    ? `Custom: RAL ${esc(pm.finishRal)}` : esc(design.finish || '-');
  sheets.push(sheet('SUBMITTAL', m(`${uname} × ${qty}`, 'A-000', rev), `
    <div class="cover">
      <div class="cover-kicker">CABINET SUBMITTAL SET · ${esc(SPEC_SECTION)} · FOR APPROVAL</div>
      <h1>${esc(coverTitle(project, pm))}</h1>
      <h2>${esc(uname)} · ${qty} unit${qty === 1 ? '' : 's'}</h2>
      <div class="cover-sub">Revision ${esc(rev)} · ${esc(date)} · Color: ${finishBit} <span class="swatch" style="background:${finish.hex}"></span></div>
      <div class="cover-cols">
        <div>
          ${directoryHTML(pm)}
        </div>
        <div>
          <h3>REVISION HISTORY</h3>
          <table class="idx"><tr><td class="no">Rev A</td><td>Initial issue</td><td></td></tr>${hist}</table>
          ${stampBoxHTML()}
          <h3>FIELD VERIFICATION</h3>
          <p class="disc-block">${esc(DISCLAIMER_BODY)}</p>
        </div>
      </div>
    </div>`, foot(no())));

  // ---- PLAN SHEET (the existing technical plan, KEY table included) ----
  sheets.push(sheet('FLOOR PLAN & KEY', m(uname, 'A-100', rev), planBody(design), foot(no())));

  // ---- ELEVATIONS: one sheet per wall that has cabinets ----
  for (const wall of wallsWithItems(design)) {
    const elev = computeElevation(design, wall);
    const dNo = no();
    sheets.push(sheet(`ELEVATION: ${wallTitle(wall)}`, m(uname, dNo, rev), `
      <div class="fig">${buildElevationSVG(elev)}</div>
      <div class="fig-note">Interior elevation, viewed facing the ${esc(wall)} wall. Dimensions in inches. Dashed diagonals on a door meet at its hinge side. Hatched panels are scribe fillers; dashed outlines are openings. Appliances are shown in grey for coordination only and are not supplied by PL/NTH.</div>`,
      foot(dNo)));
  }

  // ---- ISLAND ELEVATIONS: the island's faces, two to a sheet ----
  const islSheets = islandSheets(design);
  islSheets.forEach((faces, i) => {
    const dNo = no();
    const figs = faces.map((face) => `
      <h3 class="isl-cap">ISLAND &middot; ${esc(face.title)}</h3>
      <div class="fig isl-fig">${buildElevationSVG(computeIslandElevation(design, face))}</div>`).join('');
    sheets.push(sheet(`ELEVATION: ISLAND${islSheets.length > 1 ? ` ${i + 1}/${islSheets.length}` : ''}`, m(uname, dNo, rev), `
      ${figs}
      <div class="fig-note">Island elevations: each side is viewed facing its cabinet fronts. Dimensions in inches. Dashed diagonals on a door meet at its hinge side. Exposed island backs and ends are finished with painted end panels, quantified at order. Appliances are shown in grey for coordination only and are not supplied by PL/NTH.</div>`,
      foot(dNo)));
  });

  // ---- SCHEDULE SHEET ----
  const sched = scheduleRows(design);
  const crown = corniceOption(design.room?.cornice || 'none');
  const finRows = [
    ['Paint color', `${finishBit} <span class="swatch" style="background:${finish.hex}"></span>${design.finish === 'Custom RAL' ? ' matched on order' : ''}`, 'All exposed cabinet faces, painted in the PL/NTH workshop. Custom color matched to any RAL on request.'],
    ['Worktop', 'By others', 'Shown on the drawings for coordination only, not supplied by PL/NTH'],
    ['Hardware', esc(HARDWARE_LABEL), esc(HARDWARE_NOTE)],
    ['Crown molding', esc(crown.label), crown.label === 'No crown' ? '-' : 'Runs over wall, counter and tall cabinets'],
    ['Plinth', '115mm (4&#189;") painted plinth', 'Flush to the cabinet face. Cabinets arrive ready to install.'],
  ].map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td><td class="mut">${r[2]}</td></tr>`).join('');

  const rowsHTML = sched.rows.map((r) => `<tr>
      <td class="num">${r.qty}</td><td><strong>${esc(r.code)}</strong></td><td>${esc(FAMILY_LABEL[r.type] || r.type)}</td><td>${esc(r.desc)}</td><td>${esc(r.hinge || '-')}</td>
      <td class="num">${fmtIn(r.w)}</td><td class="num">${fmtIn(r.d)}</td><td class="num">${fmtIn(r.h)}</td>
      <td class="num">${fmtUSD(r.each)}</td><td class="num"><strong>${fmtUSD(r.line)}</strong></td></tr>`).join('');

  sheets.push(sheet('FINISH & CABINET SCHEDULE', m(uname, 'A-300', rev), `
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
          <tr class="hi"><th>Cabinet total, all units</th><td class="num"><strong>${fmtUSD(sched.subtotal * qty)}</strong></td><td class="mut">excl. shipping, confirmed on order</td></tr>
        </table>
      </div>
    </div>
    <h3>CABINET SCHEDULE</h3>
    <table class="cab">
      <thead><tr><th class="num">QTY</th><th>CODE</th><th>TYPE</th><th>DESCRIPTION</th><th>HINGE</th><th class="num">W</th><th class="num">D</th><th class="num">H</th><th class="num">EACH</th><th class="num">LINE</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
      <tfoot><tr><td colspan="9" class="tr">Per-unit cabinet subtotal</td><td class="num"><strong>${fmtUSD(sched.subtotal)}</strong></td></tr></tfoot>
    </table>
    <div class="fig-note">Hinge side is as viewed facing the cabinet front; doors ship hung as scheduled. Scribe fillers, crown molding and end panels are quantified at order from the final site dimensions. Appliances and worktops shown on the drawings are not supplied by PL/NTH. Cabinets are supplied undrilled, hardware and fitting by others.</div>`,
    foot('A-300')));

  // ---- CUT SHEETS: up to 6 per page (rows of three; core cutSheetPages) ----
  const cutPages = cutSheetPages(distinctSkus(design));
  const pages = cutPages.length;
  for (let p = 0; p < pages; p++) {
    const chunk = cutPages[p];
    const dNo = `A-4${String(p + 1).padStart(2, '0')}`;
    const cards = chunk.map((s) => `
      <div class="cut-card">
        <div class="cut-glyph">${skuGlyphSVG(s.cab, s.hinge)}</div>
        <div class="cut-code">${esc(s.code)} <span class="cut-fam">${esc(FAMILY_LABEL[familyOf(s.cab)] || s.cab.type)}</span></div>
        <div class="cut-desc">${esc(s.cab.desc)}</div>
        <div class="cut-dims">W ${fmtIn(s.cab.w)} &middot; D ${fmtIn(s.cab.d)} &middot; H ${fmtIn(s.cab.h)} &middot; ${s.qty} per unit</div>
        ${s.notes.length ? `<ul class="cut-notes">${s.notes.map((nt) => `<li>${esc(nt)}</li>`).join('')}</ul>` : ''}
      </div>`).join('');
    sheets.push(sheet(`CABINET CUT SHEETS ${p + 1}/${pages}`, m(uname, dNo, rev),
      `<div class="cut-grid">${cards || '<div class="fig-note">No PL/NTH cabinets in this design yet.</div>'}</div>`, foot(dNo)));
  }

  // ---- COMPLIANCE & PRODUCT DATA (A-600) ----
  sheets.push(sheet('COMPLIANCE & PRODUCT DATA', m(uname, 'A-600', rev),
    complianceBody(design, pm), foot('A-600')));

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
    .isl-cap { text-align: center; margin: 6px 0 0; }
    .isl-fig svg { max-height: 62mm; }
    .plan-wrap { display: flex; gap: 6mm; align-items: flex-start; height: 100%; }
    .plan-wrap .plan-fig { flex: 1 1 auto; min-width: 0; }
    .plan-wrap .plan-fig svg { max-height: 150mm; }
    .plan-key { flex: 0 0 76mm; }
    .plan-key h3 { margin-top: 2px; }
    .plan-wrap.wide { flex-direction: column; gap: 2mm; }
    .plan-wrap.wide .plan-fig { width: 100%; flex: 0 0 auto; }
    .plan-wrap.wide .plan-fig svg { max-height: 104mm; }
    .plan-wrap.wide .plan-key { flex: 0 0 auto; width: 100%; }
    .key-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; align-items: start; }
    table.key { font-size: 8px; }
    table.key td { padding: 2px 5px 2px 0; }
    table.key th { font-size: 7px; }
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
    table.dir td { font-size: 9px; }
    table.dir td.dir-k { width: 118px; font-weight: 700; letter-spacing: 0.6px; color: #7d7558; }
    .dir-blank { display: inline-block; min-width: 130px; border-bottom: 1px solid #b8ab90; height: 9px; }
    .stamp-box { border: 1.5px solid #645b3d; border-radius: 4px; padding: 7px 9px 9px; margin: 10px 0 2px; }
    .stamp-box h3 { margin: 0 0 5px; }
    .stamp-opts { display: flex; flex-direction: column; gap: 4px; font-size: 9.5px; letter-spacing: 0.5px; }
    .stamp-opts .cb { display: inline-block; width: 9px; height: 9px; border: 1px solid #645b3d; border-radius: 1px; vertical-align: -1px; margin-right: 5px; }
    .stamp-lines { display: flex; gap: 14px; margin-top: 10px; font-size: 8px; color: #7d7558; }
    .stamp-lines span { flex: 1; border-top: 1px solid #645b3d; padding-top: 2px; }
    table.comp th { width: 108px; }
    table.comp td { font-size: 9px; line-height: 1.45; }
    .two-col { display: grid; grid-template-columns: 1.2fr 1fr; gap: 8mm; }
    table.fin th { text-align: left; padding: 3px 8px 3px 0; width: 118px; color: #7d7558; font-weight: 600; vertical-align: top; }
    table.fin td { padding: 3px 8px 3px 0; border-bottom: 1px solid #ece4d2; vertical-align: top; }
    table.fin td.mut { color: #948e6e; font-size: 8.5px; }
    table.fin tr.hi td, table.fin tr.hi th { border-top: 2px solid #645b3d; border-bottom: none; }
    table.cab th { text-align: left; font-size: 8px; letter-spacing: 0.8px; color: #7d7558; border-bottom: 1px solid #645b3d; padding: 2px 6px 3px 0; }
    table.cab th.num { text-align: right; }
    table.cab td { padding: 2.5px 6px 2.5px 0; border-bottom: 1px solid #ece4d2; }
    .num { text-align: right; }
    .tr { text-align: right; color: #7d7558; }
    .cut-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; align-content: start; padding-top: 3mm; }
    .cut-card { border: 1px solid #d9cfb8; border-radius: 6px; padding: 6px 10px; text-align: center; }
    .cut-glyph { display: flex; justify-content: center; align-items: flex-end; }
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
  return docWrap(`PL/NTH · Submittal · ${unitName(unit)}`, buildUnitSheets({ project: project ?? (trade && trade.project), unit, date, pm }));
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
  const pm = projectMeta(trade);
  const finishBit = trade.finish === 'Custom RAL' && pm.finishRal
    ? `Custom: RAL ${esc(pm.finishRal)}` : esc(trade.finish || '-');
  const cover = sheet('SUBMITTAL PACK', meta(trade.project, `${designed.length} unit type${designed.length === 1 ? '' : 's'} · ${totalUnits} units`, 'P-000', '-', date, pm.address), `
    <div class="cover">
      <div class="cover-kicker">CABINET SUBMITTAL PACK · ${esc(SPEC_SECTION)} · FOR APPROVAL</div>
      <h1>${esc(coverTitle(trade.project, pm))}</h1>
      <h2>${designed.length} unit type${designed.length === 1 ? '' : 's'} · ${totalUnits} units</h2>
      <div class="cover-sub">${esc(date)} · Color: ${finishBit}</div>
      <div class="cover-cols">
        <div>
          ${directoryHTML(pm)}
          <h3>UNIT TYPES IN THIS PACK</h3>
          <table class="idx">${rows}</table>
          <table class="fin" style="margin-top:6px"><tr class="hi"><th>Cabinet total, all unit types</th><td class="num"><strong>${fmtUSD(grand)}</strong></td><td class="mut">excl. shipping &amp; volume pricing, confirmed on order</td></tr></table>
        </div>
        <div>
          ${stampBoxHTML()}
          <h3>FIELD VERIFICATION</h3>
          <p class="disc-block">${esc(DISCLAIMER_BODY)}</p>
        </div>
      </div>
    </div>`, { rev: '-', date, no: 'P-000' });
  const body = designed.map((u) => buildUnitSheets({ project: trade.project, unit: u, date, pm })).join('\n');
  return docWrap(`PL/NTH · Submittal pack · ${trade.project || 'project'}`, cover + '\n' + body);
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
