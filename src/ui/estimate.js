// ui/estimate.js — the unit-mix estimate as markup: the olive sheet on the
// Project tab's first screen, and the one-page document it prints to.

import { fmtRange, tierText } from '../core/estimate.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ESTIMATE_NOTE = 'An estimate from the unit mix, confirmed on quote once each kitchen type is laid out. Tariffs, delivery to a warehouse in the project’s city and every drawing and schedule are included. Appliances, countertops and installation are by others.';

function rowsHTML(est) {
  if (!est.lines.length) return '<tr><td class="te-empty" colspan="4">Enter the number of kitchens for at least 1 type.</td></tr>';
  return est.lines.map((l) => `<tr>
    <td class="te-u">${esc(l.beds)}</td><td>${l.cabs}</td><td>${l.units}</td>
    <td class="te-r">${fmtRange(l.low, l.high)}</td></tr>`).join('');
}

/** Inner markup of the estimate sheet (re-rendered on every keystroke). */
export function estimateSheetHTML(est) {
  return `
    <div class="te-head"><span>Estimate</span><span>${est.units} ${est.units === 1 ? 'kitchen' : 'kitchens'}</span></div>
    <div class="te-scroll"><table>
      <thead><tr><th>Kitchen type</th><th>Cabinets</th><th>Kitchens</th><th class="te-r">Per kitchen, list</th></tr></thead>
      <tbody>${rowsHTML(est)}</tbody>
    </table></div>
    <div class="te-tots">
      <div class="te-row"><span>Cabinets</span><b>${est.cabs.toLocaleString('en-US')}</b></div>
      <div class="te-row"><span>Volume pricing</span><b>${esc(tierText(est.tier))}</b></div>
      <div class="te-row"><span>In production, from approved drawings</span><b>${est.weeks ? `${est.weeks.lo} to ${est.weeks.hi} weeks` : ''}</b></div>
    </div>
    <div class="te-big"><div class="te-lab">The project</div><div class="te-fig">${est.cabs ? fmtRange(est.low, est.high) : '$0'}</div></div>
    <p class="te-note">${ESTIMATE_NOTE}</p>`;
}

/** The one-page estimate, a full HTML document for openPrintWindow. */
export function buildEstimateHTML(est, { name = '', date = new Date() } = {}) {
  const day = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const INK = '#574f35', OLIVE = '#645b3d';
  return `<!doctype html><html><head><meta charset="utf-8"><title>PL/NTH estimate</title><style>
    @page { size: letter; margin: 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: ${INK}; font-size: 11pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .top { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid ${OLIVE}; padding-bottom: 10px; }
    .mark { font-family: 'Arial Black', Arial, sans-serif; font-size: 15pt; letter-spacing: 0.14em; }
    .meta { font-size: 9pt; letter-spacing: 0.06em; }
    h1 { font-family: 'Times New Roman', Times, serif; font-style: italic; font-weight: 400; font-size: 26pt; margin: 26px 0 4px; }
    .for { margin: 0 0 22px; }
    table { width: 100%; border-collapse: collapse; }
    th { font-size: 7.5pt; letter-spacing: 0.16em; text-transform: uppercase; text-align: left; padding: 8px 0; border-bottom: 1px solid ${OLIVE}; }
    td { padding: 9px 0; border-bottom: 1px solid rgba(100,91,61,0.28); }
    td.te-u { font-family: 'Times New Roman', Times, serif; font-style: italic; font-size: 14pt; }
    .te-r { text-align: right; }
    .tots { margin-top: 14px; }
    .row { display: flex; justify-content: space-between; padding: 5px 0; }
    .big { margin-top: 20px; padding: 16px 18px; background: ${OLIVE}; color: #f7f5eb; }
    .big .lab { font-size: 7.5pt; letter-spacing: 0.2em; text-transform: uppercase; opacity: 0.8; }
    .big .fig { font-family: 'Times New Roman', Times, serif; font-style: italic; font-size: 24pt; margin-top: 2px; }
    .note { font-size: 9pt; margin-top: 16px; max-width: 150mm; }
    .foot { margin-top: 30px; padding-top: 10px; border-top: 1px solid rgba(100,91,61,0.28); font-size: 9pt; }
  </style></head><body>
    <div class="top"><div class="mark">PL/NTH</div><div class="meta">ESTIMATE · ${esc(day)}</div></div>
    <h1>Estimate from the unit mix.</h1>
    <p class="for">${name ? `Prepared for ${esc(name)}. ` : ''}${est.units} kitchens, ${est.cabs.toLocaleString('en-US')} cabinets.</p>
    <table>
      <thead><tr><th>Kitchen type</th><th>Cabinets</th><th>Kitchens</th><th class="te-r">Per kitchen, list</th></tr></thead>
      <tbody>${rowsHTML(est)}</tbody>
    </table>
    <div class="tots">
      <div class="row"><span>Volume pricing</span><b>${esc(tierText(est.tier))}</b></div>
      ${est.weeks ? `<div class="row"><span>In production, from approved drawings</span><b>${est.weeks.lo} to ${est.weeks.hi} weeks</b></div>` : ''}
    </div>
    <div class="big"><div class="lab">The project</div><div class="fig">${fmtRange(est.low, est.high)}</div></div>
    <p class="note">${ESTIMATE_NOTE}</p>
    <div class="foot">PL/NTH · projects@plinthmade.com · +1 646 792 9992 · plinthmade.com</div>
  </body></html>`;
}
