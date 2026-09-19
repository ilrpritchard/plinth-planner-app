// ordertrack.js (ui) — the order-tracking markup, shared by the owner's Orders
// page and the read-only page a private tracking link opens. View-model comes
// from core/ordertrack.js; nothing here knows about prices.

import { trackingSteps, phaseRows, latestNote, orderUnits } from '../core/ordertrack.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (iso) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

/** The five-step line + delivery phases + PL/NTH's latest note. */
export function trackingHTML(order) {
  const steps = trackingSteps(order), phases = phaseRows(order), note = latestNote(order);
  const cancelled = order.status === 'cancelled';
  const reached = steps.filter((s) => s.state !== 'todo').length;
  const fill = steps.length > 1 ? ((Math.max(1, reached) - 1) / (steps.length - 1)) * 100 : 0;
  return `<div class="trk${cancelled ? ' trk-cancelled' : ''}">
    <ol class="trk-steps" style="--trk-fill:${fill.toFixed(1)}%">
      ${steps.map((s) => `<li class="trk-step trk-${s.state}">
        <span class="trk-dot" aria-hidden="true">${s.state === 'done' ? '✓' : ''}</span>
        <span class="trk-label">${esc(s.label)}</span>
        <span class="trk-date">${esc(day(s.at))}</span>
      </li>`).join('')}
    </ol>
    ${cancelled ? '<div class="trk-cancel-note">This order was cancelled.</div>' : ''}
    ${note ? `<div class="trk-note"><span class="trk-note-l">Latest from PL/NTH${note.at ? ` · ${esc(day(note.at))}` : ''}</span>${esc(note.text)}</div>` : ''}
    ${phases.length > 1 ? `<div class="trk-phases">
      <div class="trk-phases-h">Delivery phases</div>
      ${phases.map((p) => `<div class="trk-phase">
        <strong>${esc(p.id.replace(/^P/, 'Phase '))}</strong>
        <span class="trk-phase-l">${esc([p.label, p.units ? `${p.units} unit${p.units === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '))}</span>
        <span class="trk-bar"><i style="width:${p.pct}%"></i></span>
        <span class="status-pill st-${esc(p.status)}">${esc(p.statusLabel)}</span>
      </div>`).join('')}
    </div>` : ''}
  </div>`;
}

/** The whole read-only page for a private tracking link (no prices by design). */
export function trackingPageHTML(order) {
  const units = orderUnits(order);
  const placed = order.placed_at ? new Date(order.placed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const uts = order.unitTypes || [];
  return `<div class="trade-wrap orders-wrap trk-page">
    <header class="trade-head">
      <div>
        <div class="trade-title">Order tracking</div>
        <div class="trade-sub">Read-only. Anyone with this link can follow the order.</div>
      </div>
      <div class="trade-meta"><a class="ghost sm tlink" href="${esc(location.pathname)}?mode=trade">Open the planner</a></div>
    </header>
    <section class="order-card trk-card">
      <div class="trk-head">
        <div>
          <div class="order-no">${esc(order.order_no)}</div>
          <h2 class="trk-proj">${esc(order.project || 'Untitled project')}</h2>
          <div class="trk-sub">${[order.address, units ? `${units} unit${units === 1 ? '' : 's'}` : '', order.cabinets ? `${order.cabinets} cabinets` : '', order.finish ? `Finish: ${order.finish}` : '', placed ? `requested ${placed}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
      </div>
      ${trackingHTML(order)}
      ${uts.length ? `<details class="order-detail">
        <summary>${uts.length} unit type${uts.length === 1 ? '' : 's'}, view the cabinet list</summary>
        ${uts.map((ut) => `<div class="order-ut">
          <div class="order-ut-head">${esc(ut.name)} · Rev ${esc(ut.rev || 'A')} · ×${esc(ut.units)} units</div>
          <table class="breakdown"><thead><tr><th>Code</th><th>Description</th><th class="num">Qty per unit</th></tr></thead>
          <tbody>${(ut.lines || []).map((l) => `<tr><td>${esc(l.code)}</td><td>${esc(l.desc)}</td><td class="num">${esc(l.qty)}</td></tr>`).join('')}</tbody></table>
        </div>`).join('')}
      </details>` : ''}
      <div class="trk-foot">Prices, invoices and change orders stay with the account that placed the order. Questions: <a href="mailto:imogen@plinthmade.com?subject=${encodeURIComponent('Order ' + (order.order_no || ''))}">imogen@plinthmade.com</a></div>
    </section>
  </div>`;
}

/** Signed-out Orders page: find an order by its number AND the email it was placed with. */
export function findOrderHTML() {
  return `<form class="trk-find" id="trkFind" novalidate>
    <h3>Find an order</h3>
    <p>Enter the order number and the email the quote was requested with. No account needed.</p>
    <div class="trk-find-row">
      <label>Order number<input id="trkNo" placeholder="PL-2609-K7M2" autocomplete="off" autocapitalize="characters"></label>
      <label>Email<input id="trkEmail" type="email" placeholder="you@company.com" autocomplete="email"></label>
      <button class="cta" type="submit">Find order</button>
    </div>
    <div class="cloud-msg" id="trkFindMsg" role="alert"></div>
  </form>`;
}
