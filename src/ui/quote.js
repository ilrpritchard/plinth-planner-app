// quote.js — a branded, printable kitchen quote / spec sheet.
//
// Builds a clean PL/NTH-styled document: floor plan, cabinet schedule, finish,
// price and lead-time. Rendered into an overlay on screen; the browser's
// "Save as PDF" (window.print) turns it into a shareable PDF. Fully offline.

import { summarizeState, deliveryEstimate } from '../core/cost.js';
import { fmtUSD, getFinish } from '../core/catalogue.js';
import { fmtFeetIn } from '../core/units.js';
import { buildFloorplanSVG } from './floorplan.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildQuoteHTML(state, heroDataURL = null) {
  const r = state.room;
  const c = state.customer || {};
  const fin = getFinish(state.finish);
  const { lines, totalCabs, subtotal } = summarizeState(state);
  const del = deliveryEstimate(totalCabs);
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const ref = 'Q-' + new Date().toISOString().slice(2, 10).replace(/-/g, '');

  const supplied = lines.filter((l) => !l.notSupplied);
  const appliances = lines.filter((l) => l.notSupplied);

  const row = (l) => `<tr>
    <td class="q-code">${esc(l.code)}</td>
    <td>${esc(l.desc)}</td>
    <td class="q-dims">${esc(l.dims)}</td>
    <td class="q-num">${l.qty}</td>
    <td class="q-num">${l.notSupplied ? '—' : fmtUSD(l.line)}</td>
  </tr>`;

  return `<div class="quote-sheet">
    <header class="q-head">
      <div class="q-brand">PL<span>/</span>NTH</div>
      <div class="q-headmeta">
        <div class="q-title">Kitchen Quote</div>
        <div class="q-sub">${esc(ref)} · ${esc(today)}</div>
      </div>
    </header>

    ${heroDataURL ? `<div class="q-hero"><img src="${heroDataURL}" alt="Your kitchen"><span class="q-hero-cap">Your kitchen, finished in ${esc(fin.name)}</span></div>` : ''}

    <section class="q-meta">
      <div>
        <div class="q-label">Prepared for</div>
        <div class="q-val">${esc(c.name || '—')}</div>
        <div class="q-dim">${esc(c.email || '')}${c.zip ? ' · ' + esc(c.zip) : ''}</div>
      </div>
      <div>
        <div class="q-label">Room</div>
        <div class="q-val">${fmtFeetIn(r.width)} × ${fmtFeetIn(r.depth)}</div>
        <div class="q-dim">${fmtFeetIn(r.height)} ceiling</div>
      </div>
      <div>
        <div class="q-label">Finish</div>
        <div class="q-val"><span class="q-chip" style="background:${fin.hex}"></span>${esc(fin.name)}</div>
        <div class="q-dim">${esc(fin.desc)}</div>
      </div>
    </section>

    <section class="q-plan">${buildFloorplanSVG(state)}</section>

    <section class="q-schedule">
      <h3>Cabinet schedule</h3>
      <table>
        <thead><tr><th>Code</th><th>Description</th><th>W × D × H</th><th class="q-num">Qty</th><th class="q-num">Price</th></tr></thead>
        <tbody>${supplied.map(row).join('')}</tbody>
      </table>
      ${appliances.length ? `<h3 class="q-appl">Appliances <span>— supplied by you, shown for layout</span></h3>
        <table><tbody>${appliances.map(row).join('')}</tbody></table>` : ''}
    </section>

    <section class="q-totals">
      <div class="q-tline"><span>${totalCabs} cabinet${totalCabs === 1 ? '' : 's'}, finished in ${esc(fin.name)}</span><span>${fmtUSD(subtotal)}</span></div>
      <div class="q-tline q-grand"><span>Estimate, cabinets only</span><span>${fmtUSD(subtotal)}</span></div>
      <div class="q-delivery">Estimated delivery <strong>${del.weeksLo}–${del.weeksHi} weeks</strong> — around ${esc(del.from)} – ${esc(del.to)}</div>
    </section>

    <footer class="q-foot">
      Customer price for cabinets only; shipping &amp; tax confirmed on your order. Countertops shown are representative
      and not supplied by Plinth. Prices held 30 days. Questions? hello@plinthmade.com<br><br>
      <strong>Dimensions:</strong> all room sizes, openings and services are as entered by the client. The client is
      responsible for checking and confirming every measurement on site before ordering — PL/NTH does not survey
      or verify site dimensions.
    </footer>
  </div>`;
}
