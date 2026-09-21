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
      <div class="trade-meta">
        <button class="ghost sm" id="trkPrint" title="The order status as a US Letter document: print it, or save it as a PDF">Print / Save as PDF</button>
        <a class="ghost sm tlink" href="${esc(location.pathname)}?mode=project">Open the planner</a>
      </div>
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

// ---- the printable ORDER STATUS document (US Letter, same family as the invoice /
// change order). The web page is not a document: printed as-is it carried a button,
// a "read-only" line and a screen-height slab of background. No prices, as the page.
const DOC_CSS = `
    @page { size: letter portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #645b3d; margin: 0; font-size: 10px; }
    header { display: flex; justify-content: space-between; align-items: flex-end; background: #645b3d; color: #f7f5eb; padding: 12px 18px; border-radius: 6px; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: 3px; }
    .brand .slash { opacity: 0.55; }
    .brand small { display: block; font-size: 9px; font-weight: 400; letter-spacing: 4px; opacity: 0.7; margin-top: 2px; }
    .meta { text-align: right; font-size: 10px; line-height: 1.55; opacity: 0.92; }
    .meta strong { font-size: 12px; letter-spacing: 1px; }
    .body { margin-top: 8px; border: 1px solid #d9cfb8; border-radius: 6px; padding: 14px 16px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
    h3 { font-size: 10px; letter-spacing: 1.5px; color: #7d7558; margin: 14px 0 5px; }
    .top { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
    .box { border: 1px solid #d9cfb8; border-radius: 6px; padding: 8px 10px; font-size: 10.5px; line-height: 1.6; }
    .box .who { font-size: 13px; font-weight: 700; }
    .mut { color: #7d7558; }
    .steps { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin-top: 4px; }
    .step { border: 1px solid #d9cfb8; border-radius: 6px; padding: 7px 8px; text-align: center; }
    .step b { display: block; font-size: 10px; }
    .step small { display: block; font-size: 8.5px; color: #7d7558; min-height: 11px; margin-top: 2px; }
    .step.done { background: #ece4d2; }
    .step.current { background: #645b3d; color: #f7f5eb; border-color: #645b3d; }
    .step.current small { color: #f7f5eb; opacity: 0.8; }
    .step.todo { color: #a59d80; }
    .note { border: 1px solid #d9cfb8; border-radius: 6px; padding: 8px 10px; font-size: 10.5px; line-height: 1.55; }
    table { border-collapse: collapse; width: 100%; font-size: 10px; }
    th { text-align: left; font-size: 8px; letter-spacing: 0.8px; color: #7d7558; border-bottom: 1px solid #645b3d; padding: 3px 8px 4px 0; }
    td { padding: 4px 8px 4px 0; border-bottom: 1px solid #ece4d2; }
    .num { text-align: right; }
    .ut { margin-top: 10px; break-inside: avoid; }
    .ut-h { font-weight: 700; font-size: 10.5px; margin-bottom: 2px; }
    tr { break-inside: avoid; }
    footer { display: flex; justify-content: space-between; gap: 14px; margin-top: 8px; border-top: 1px solid #d9cfb8; padding-top: 5px; font-size: 8px; color: #7d7558; }
    @media print { header, .step.done, .step.current { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;
const longDay = (iso) => { const d = iso ? new Date(iso) : new Date(); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

export function buildTrackingDocHTML(order, now = Date.now()) {
  const steps = trackingSteps(order), phases = phaseRows(order), note = latestNote(order), units = orderUnits(order);
  const uts = order.unitTypes || [];
  const cancelled = order.status === 'cancelled';
  const current = cancelled ? 'Cancelled' : (steps.filter((s) => s.state !== 'todo').pop() || {}).label || '';
  const asOf = longDay(new Date(now).toISOString());
  const sheet = `<header>
      <div class="brand">PL<span class="slash">/</span>NTH<small>ORDER STATUS</small></div>
      <div class="meta"><strong>${esc(order.order_no)}</strong><br>${esc(order.project || 'Untitled project')}<br>Status as of ${esc(asOf)}</div>
    </header>
    <div class="body">
      <div class="top">
        <div class="box"><h3 style="margin-top:0">PROJECT</h3>
          <div class="who">${esc(order.project || 'Untitled project')}</div>
          <div>${esc(order.address || '')}</div>
          <div class="mut">${esc([units ? `${units} unit${units === 1 ? '' : 's'}` : '', order.cabinets ? `${order.cabinets} cabinets` : '', order.finish ? `Color: ${order.finish}` : ''].filter(Boolean).join(' - '))}</div>
        </div>
        <div class="box"><h3 style="margin-top:0">ORDER</h3>
          <div class="who">${esc(order.order_no)}</div>
          <div>Requested ${esc(longDay(order.placed_at))}</div>
          <div class="mut">Current status: <strong>${esc(current)}</strong></div>
        </div>
      </div>
      <h3>STATUS</h3>
      <div class="steps">${steps.map((s) => `<div class="step ${s.state}"><b>${esc(s.label)}</b><small>${esc(s.at ? longDay(s.at) : '')}</small></div>`).join('')}</div>
      ${note ? `<h3>LATEST FROM PL/NTH${note.at ? ` - ${esc(longDay(note.at).toUpperCase())}` : ''}</h3><div class="note">${esc(note.text)}</div>` : ''}
      ${phases.length > 1 ? `<h3>DELIVERY PHASES</h3>
        <table><thead><tr><th>PHASE</th><th>DESCRIPTION</th><th class="num">UNITS</th><th class="num">CABINETS</th><th>STATUS</th></tr></thead>
        <tbody>${phases.map((p) => `<tr><td><strong>${esc(p.id.replace(/^P/, 'Phase '))}</strong></td><td>${esc(p.label || '-')}</td><td class="num">${p.units || '-'}</td><td class="num">${p.cabinets || '-'}</td><td>${esc(p.statusLabel)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${uts.length ? `<h3>CABINETS ON THIS ORDER</h3>${uts.map((ut) => `<div class="ut">
        <div class="ut-h">${esc(ut.name)} - Rev ${esc(ut.rev || 'A')} - x${esc(ut.units)} units</div>
        <table><thead><tr><th style="width:70px">CODE</th><th>DESCRIPTION</th><th class="num">QTY PER UNIT</th></tr></thead>
        <tbody>${(ut.lines || []).map((l) => `<tr><td><strong>${esc(l.code)}</strong></td><td>${esc(l.desc)}</td><td class="num">${esc(l.qty)}</td></tr>`).join('')}</tbody></table></div>`).join('')}` : ''}
    </div>
    <footer><span>Status only. Prices, invoices and change orders are held by the account that placed the order.</span><span>${esc(asOf)} - ${esc(order.order_no)}<br>plinthmade.com</span></footer>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(`PL/NTH - ${order.order_no} - order status`)}</title><style>${DOC_CSS}</style></head><body>${sheet}</body></html>`;
}
