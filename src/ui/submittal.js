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
  wallTitle, unitRev, esc, MOUNT, SURFACE_Y, WORKTOP_SLAB, crownLayers, SPEC_SECTION,
  islandSheets, computeIslandElevation, cutSheetPages, CUT_MM_PER_IN,
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
  for (const e of elev.items) out.push(drawFront(e.cab, e.s0, e.y0, Y, { code: e.code, hinge: hingeOf(e.cab, e.it), marks: true }));

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

/** The TITLE PAGE that fronts every document (her ask: "PL/NTH cabinets for
 *  XXXX, then the address"): full brand colour, no title block, no sheet
 *  number. `lines` = the small print under the address. */
function titlePage({ project, pm, lines, finish, finishName }) {
  const name = project || pm.address || '';
  const addr = project ? pm.address : '';
  return `<section class="sheet title">
    <div class="tp-brand">PL<span class="slash">/</span>NTH</div>
    <div class="tp-main">
      <div class="tp-kicker">PL/NTH CABINETS${name ? ' FOR' : ''}</div>
      ${name ? `<h1>${esc(name)}</h1>` : ''}
      ${addr ? `<div class="tp-addr">${esc(addr)}</div>` : ''}
    </div>
    <div class="tp-foot">
      <div>${lines.map((t) => esc(t)).join('<br>')}</div>
      ${finish ? `<div class="tp-tile"><span class="tile" style="background:${finish.hex}"></span><span><small>COLOR</small>${finishName}</span></div>` : ''}
      <div class="tp-web">plinthmade.com</div>
    </div>
  </section>`;
}

/** The big paint tile on the cover sheets. */
const colorTile = (finish, name) => `<div class="color-tile"><span class="tile" style="background:${finish.hex}"></span><span><small>COLOR</small>${name}</span></div>`;

/** Sheet notes: one numbered line per point, in two tidy columns under a rule,
 *  label column on the same 118px grid as the schedules. Sits at the FOOT of
 *  the sheet on every page, so notes are always in the same place. */
const notesHTML = (lines) => `<div class="notes"><span class="notes-h">NOTES</span><ol>${lines.filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>`;
const NOTE_HINGE = 'Dashed diagonals on a door meet at its hinge side. A V meeting at the bottom is a drop-down dishwasher door.';
const NOTE_APPL = 'Appliances and worktops are shown in grey / outline for coordination only and are not supplied by PL/NTH.';

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
    ['Carcass construction', '&#190;" (18mm) panel construction, oak-veneer interior; &#8542;" (22mm) front-frame legs'],
    ['Doors &amp; faces', 'Painted shaker fronts; glazed doors clear glass'],
    ['Plinth', '4&#189;" (115mm) painted plinth, flush to the cabinet face'],
    ['Paint finish', `${finishLabel}, factory-applied in the PL/NTH workshop. Custom color matched to any RAL on request.`],
    ['Hardware', `${esc(HARDWARE_LABEL)}. ${esc(HARDWARE_NOTE)}.`],
    ['Country of origin', 'Made in England; supplied to the US by PL/NTH'],
  ].map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td></tr>`).join('');
  const compRows = [
    ['Formaldehyde emissions', 'Composite wood components supplied compliant with TSCA Title VI (40 CFR Part 770) / CARB Phase 2 emission limits. Supplier declarations held on file; certificates issued on request.'],
    ['Specification section', esc(SPEC_SECTION)],
    ['Accessible units', 'ANSI A117.1 / ADA accessible-unit requirements. Coordinate variants with the PL/NTH trade team at spec stage.'],
    ['Field verification', esc(DISCLAIMER_BODY)],
  ].map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td></tr>`).join('');
  return `<div class="two-col">
      <div><h3>PRODUCT SPECIFICATION</h3><table class="fin comp">${prodRows}</table></div>
      <div><h3>COMPLIANCE STATEMENTS</h3><table class="fin comp">${compRows}</table></div>
    </div>
    ${notesHTML(['Dimensions are given in inches with the metric size in brackets.', 'Statements on this sheet are provided for submittal coordination.'])}`;
}

// ---- plan sheet (A-100) -----------------------------------------------------------
// The drawing takes the whole sheet height; the KEY is an HTML table beside it
// (or under it, in two columns, when the room is very wide) instead of riding
// inside the SVG, where it used to squeeze the plan into half the page.
function planBody(design) {
  const svg = buildFloorplanSVG(design, null, { key: false, tight: true });
  const rows = planKeyRows(design, { splitIsland: true });
  const room = design.room || {};
  const wide = (room.width + 59) / (room.depth + 59) > 1.75;
  // wherever there is a sink: the base it needs (and what the base it sits in takes)
  const sinks = sinkHosts(design);
  const needs = new Map(sinks.map((h) => [h.sinkCab.code, sinkMinBase(h.sinkCab)]));
  const desc = (r) => `${esc(r.family)}${r.cab.notSupplied ? ' *' : ''} &middot; ${esc(r.cab.desc)}${needs.has(r.cab.code) ? ` &middot; needs a ${fmtIn(needs.get(r.cab.code))} base or wider` : ''}`;
  const tr = (r) => `<tr><td>${r.qty}</td><td><strong>${esc(r.code)}</strong></td><td>${desc(r)}</td><td>${esc(hingeLabel(r.hinge))}</td><td class="num">${fmtIn(r.cab.w)}</td><td class="num">${fmtIn(r.cab.d)}</td><td class="num">${fmtIn(r.cab.h)}</td></tr>`;
  const body = (rs) => {
    const main = rs.filter((r) => !r.island), isl = rs.filter((r) => r.island);
    return main.map(tr).join('') + (isl.length ? `<tr class="key-sec"><td colspan="7">ISLAND</td></tr>${isl.map(tr).join('')}` : '');
  };
  const table = (rs) => `<table class="cab key"><thead><tr><th>QTY</th><th>CODE</th><th>DESCRIPTION</th><th>HINGE</th><th class="num">W</th><th class="num">D</th><th class="num">H</th></tr></thead><tbody>${body(rs)}</tbody></table>`;
  const half = Math.ceil(rows.length / 2);
  const sinkNotes = sinks.filter((h) => h.baseCab).map((h) =>
    `${h.baseCab.code} is a sink base: a ${fmtIn(h.baseCab.w)} cabinet takes a sink with a bowl cut-out up to ${fmtIn(maxSinkCutout(h.baseCab.w))} wide (${h.sinkCab.baseCode || h.sinkCab.code} shown).`);
  const notes = `<ul class="key-notes">${[
    rows.some((r) => r.hinge) ? 'Hinge side as viewed facing the cabinet front. Pair = left + right hung doors.' : '',
    ...new Set(sinkNotes),
    rows.some((r) => r.cab.notSupplied) ? '* Appliance, shown in grey for layout only, not supplied by PL/NTH.' : '',
  ].filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
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
      <div class="cover-sub">Revision ${esc(rev)} · ${esc(date)}</div>
      ${colorTile(finish, finishBit)}
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
      ${notesHTML([`Interior elevation, viewed facing the ${wall} wall. Dimensions in inches.`, NOTE_HINGE, 'Hatched panels are scribe fillers; dashed outlines are openings.', NOTE_APPL])}`,
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
      ${notesHTML(['Island elevations: each side is viewed facing its cabinet fronts. Dimensions in inches.', NOTE_HINGE, 'The worktop overhangs each end of the island by 2" (50mm).', 'Exposed island backs and ends are finished with painted end panels, quantified at order.', NOTE_APPL])}`,
      foot(dNo)));
  });

  // ---- SCHEDULE SHEET ----
  const sched = scheduleRows(design);
  const crown = corniceOption(design.room?.cornice || 'none');
  const finRows = [
    ['Paint color', `${finishBit} <span class="swatch" style="background:${finish.hex}"></span>${design.finish === 'Custom RAL' ? ' matched on order' : ''}`, 'All exposed cabinet faces, painted in the PL/NTH workshop. Custom color matched to any RAL on request.'],
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

  sheets.push(sheet('FINISH & CABINET SCHEDULE', m(uname, 'A-300', rev), `
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
      <colgroup><col style="width:40px"><col style="width:78px"><col style="width:122px"><col><col style="width:110px"><col style="width:48px"><col style="width:48px"><col style="width:48px"><col style="width:78px"><col style="width:86px"></colgroup>
      <thead><tr><th>QTY</th><th>CODE</th><th>TYPE</th><th>DESCRIPTION</th><th>HINGE</th><th class="num">W</th><th class="num">D</th><th class="num">H</th><th class="num">EACH</th><th class="num">LINE</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
      <tfoot><tr><td colspan="9" class="tr">Per-unit cabinet subtotal</td><td class="num"><strong>${fmtUSD(sched.subtotal)}</strong></td></tr></tfoot>
    </table>
    ${notesHTML(['Hinge side is as viewed facing the cabinet front; doors ship hung as scheduled.', 'Scribe fillers, crown molding and end panels are quantified at order from the final site dimensions.', 'Cabinets are supplied undrilled; hardware and fitting by others.', ...sinkLines, 'Appliances and worktops shown on the drawings are not supplied by PL/NTH.'])}`,
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
        <div class="cut-head"><span class="cut-code">${esc(s.code)}</span><span class="cut-desc">${esc(FAMILY_LABEL[familyOf(s.cab)] || s.cab.type)} &middot; ${esc(s.cab.desc)}</span><span class="cut-qty">${s.qty} per unit</span></div>
        <table class="cut-spec">${s.specs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
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
    .body { flex: 1; margin-top: 8px; border: 1px solid #d9cfb8; border-radius: 6px; padding: 8px 12px; overflow: hidden;
      display: flex; flex-direction: column; }
    .body > * { flex: 0 0 auto; }
    /* title page: full brand colour, no title block */
    .sheet.title { background: #645b3d; color: #f7f5eb; border-radius: 6px; padding: 16mm 18mm 14mm; justify-content: space-between;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .tp-brand { font-size: 30px; font-weight: 800; letter-spacing: 5px; }
    .tp-brand .slash { opacity: 0.55; }
    .tp-kicker { font-size: 13px; letter-spacing: 5px; opacity: 0.8; }
    .tp-main h1 { font-size: 54px; line-height: 1.05; margin: 10px 0 0; letter-spacing: 0.5px; font-weight: 800; }
    .tp-addr { font-size: 20px; margin-top: 12px; opacity: 0.92; }
    .tp-foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 12mm; font-size: 11px; line-height: 1.6;
      border-top: 1px solid rgba(247, 245, 235, 0.35); padding-top: 6mm; }
    .tp-web { letter-spacing: 2px; }
    .tile { display: inline-block; width: 20mm; height: 20mm; border-radius: 3px; border: 1px solid #b8ab90;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .color-tile, .tp-tile { display: flex; align-items: center; gap: 4mm; font-size: 15px; font-weight: 600; }
    .color-tile { margin-top: 6mm; color: #5c5535; }
    .color-tile small, .tp-tile small { display: block; font-size: 8.5px; font-weight: 400; letter-spacing: 2px; opacity: 0.75; margin-bottom: 2px; }
    .tp-tile .tile { border-color: rgba(247, 245, 235, 0.6); width: 16mm; height: 16mm; }
    /* notes: a ruled block at the foot of the sheet, on the schedules' 118px grid */
    .notes { margin-top: auto; display: grid; grid-template-columns: 118px 1fr; border-top: 1px solid #d9cfb8; padding-top: 5px;
      font-size: 8.5px; line-height: 1.45; color: #7d7558; }
    .notes-h { font-size: 10px; font-weight: 700; letter-spacing: 1.5px; }
    .notes ol { margin: 0; padding-left: 13px; columns: 2; column-gap: 9mm; }
    .notes li { break-inside: avoid; margin-bottom: 1.5px; }
    .key-notes { list-style: none; margin: 5px 0 0; padding: 0; font-size: 8px; line-height: 1.45; color: #7d7558; }
    .key-notes li { margin-bottom: 2px; }
    tr.key-sec td { font-size: 7.5px; font-weight: 700; letter-spacing: 1.5px; color: #7d7558; padding-top: 7px; border-bottom: 1px solid #645b3d; }
    .fig svg { display: block; width: 100%; height: auto; max-height: 136mm; margin: 0 auto; }
    .isl-cap { text-align: center; margin: 6px 0 0; }
    .isl-fig svg { max-height: 62mm; }
    .plan-wrap { display: flex; gap: 6mm; align-items: flex-start; flex: 1 1 auto !important; min-height: 0; }
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
    .cover-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 7mm; }
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
    table.fin:not(.comp) td:nth-child(2) { width: 122px; }
    table.cab { table-layout: fixed; }
    table.key { table-layout: auto; }
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
    .cut-card { text-align: left; }
    .cut-head { display: flex; align-items: baseline; gap: 6px; margin-top: 4px; border-bottom: 1px solid #645b3d; padding-bottom: 2px; }
    .cut-code { font-size: 14px; font-weight: 800; }
    .cut-desc { font-size: 9.5px; color: #5c5535; }
    .cut-qty { margin-left: auto; font-size: 8.5px; color: #7d7558; white-space: nowrap; }
    table.cut-spec { font-size: 8.5px; margin-top: 1px; }
    table.cut-spec th { width: 54px; text-align: left; font-weight: 600; font-size: 7.5px; letter-spacing: 0.8px; text-transform: uppercase; color: #7d7558; padding: 2px 6px 2px 0; vertical-align: top; border-bottom: 1px solid #ece4d2; }
    table.cut-spec td { padding: 2px 0; border-bottom: 1px solid #ece4d2; vertical-align: top; }
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
  const proj = project ?? (trade && trade.project);
  const design = unit.design || {};
  const finishName = design.finish === 'Custom RAL' && pm.finishRal ? `Custom: RAL ${esc(pm.finishRal)}` : esc(design.finish || '-');
  const title = unit.design ? titlePage({ project: proj, pm, finish: getFinish(design.finish), finishName,
    lines: [`Cabinet submittal · ${unitName(unit)} · ${unitQty(unit)} unit${unitQty(unit) === 1 ? '' : 's'}`, `Revision ${unitRev(unit)} · ${date}`] }) : '';
  return docWrap(`PL/NTH · Submittal · ${unitName(unit)}`, title + buildUnitSheets({ project: proj, unit, date, pm }));
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
      <div class="cover-sub">${esc(date)}</div>
      ${trade.finish ? colorTile(getFinish(trade.finish), finishBit) : ''}
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
  const title = titlePage({ project: trade.project, pm, finish: trade.finish ? getFinish(trade.finish) : null, finishName: finishBit,
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
