// invoice.js (ui) — the printable PRO-FORMA INVOICE: ONE letter-PORTRAIT
// page styled to match the submittal sheets (same dark-on-cream brand header,
// PL/NTH mark, footer + disclaimer pattern), printed to PDF through the same
// window.open → document.write → print() flow (openPrintWindow in
// ui/submittal.js). All numbers arrive pre-computed in the model from
// core/invoice.js — this file only lays them out. ASCII-safe, DOM-free
// (node-testable string builder).

import { esc } from '../core/submittal.js';
import { fmtCents } from '../core/invoice.js';

const DISCLAIMER = 'This pro-forma invoice is issued for payment against the referenced trade order and is not a tax invoice. All amounts are in USD. Cabinet quantities, dimensions and site measurements are as entered by the client at the time of order - the client is responsible for confirming every measurement on site.';

const PAYMENT_NOTE = 'Payment details are included on your order confirmation email - reference your order number.';

const CSS = `
    @page { size: letter portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #645b3d; margin: 0; }
    .sheet { height: 253mm; display: flex; flex-direction: column; overflow: hidden; }
    header { display: flex; justify-content: space-between; align-items: flex-end;
      background: #645b3d; color: #f7f5eb; padding: 12px 18px; border-radius: 6px; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: 3px; }
    .brand .slash { opacity: 0.55; }
    .brand small { display: block; font-size: 9px; font-weight: 400; letter-spacing: 4px; opacity: 0.7; margin-top: 2px; }
    .meta { text-align: right; font-size: 10px; line-height: 1.55; opacity: 0.92; }
    .meta strong { font-size: 12px; letter-spacing: 1px; }
    .body { flex: 1; margin-top: 8px; border: 1px solid #d9cfb8; border-radius: 6px; padding: 14px 16px; overflow: hidden; }
    h3 { font-size: 10px; letter-spacing: 1.5px; color: #7a6d54; margin: 12px 0 5px; }
    .inv-top { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
    .inv-box { border: 1px solid #d9cfb8; border-radius: 6px; padding: 8px 10px; font-size: 10.5px; line-height: 1.6; }
    .inv-box .who { font-size: 13px; font-weight: 700; }
    .inv-box .mut { color: #7a6d54; }
    table { border-collapse: collapse; width: 100%; font-size: 10px; }
    table.lines th { text-align: left; font-size: 8px; letter-spacing: 0.8px; color: #7a6d54; border-bottom: 1px solid #645b3d; padding: 3px 8px 4px 0; }
    table.lines td { padding: 4px 8px 4px 0; border-bottom: 1px solid #ece4d2; }
    .num { text-align: right; }
    table.tot { width: 62%; margin-left: auto; margin-top: 6px; }
    table.tot td { padding: 3px 0 3px 8px; }
    table.tot td.l { color: #7a6d54; }
    table.tot tr.hi td { border-top: 2px solid #645b3d; font-weight: 800; font-size: 11px; }
    .due-box { display: flex; justify-content: space-between; align-items: center;
      background: #645b3d; color: #f7f5eb; border-radius: 6px; padding: 12px 16px; margin-top: 12px; }
    .due-box .lbl { font-size: 10px; letter-spacing: 2.5px; }
    .due-box .lbl small { display: block; font-size: 8.5px; letter-spacing: 1px; opacity: 0.75; margin-top: 3px; }
    .due-box .amt { font-size: 26px; font-weight: 800; letter-spacing: 0.5px; }
    table.sched td, table.sched th { padding: 4px 8px 4px 0; border-bottom: 1px solid #ece4d2; }
    table.sched th { text-align: left; font-size: 8px; letter-spacing: 0.8px; color: #7a6d54; border-bottom: 1px solid #645b3d; }
    .slot { display: inline-block; width: 9px; height: 9px; border: 1px solid #7a6d54; border-radius: 2px; vertical-align: -1px; margin-right: 5px; }
    .slot.now { background: #645b3d; border-color: #645b3d; }
    .this-inv { font-weight: 800; letter-spacing: 0.5px; }
    .pay-note { border: 1px solid #d9cfb8; border-radius: 6px; padding: 8px 10px; font-size: 9.5px; color: #5a4a38; margin-top: 10px; line-height: 1.55; }
    footer { display: flex; justify-content: space-between; gap: 14px; margin-top: 6px;
      border-top: 1px solid #d9cfb8; padding-top: 5px; font-size: 8px; color: #7a6d54; }
    footer .disc { max-width: 64%; }
    footer .stamp { text-align: right; white-space: nowrap; }
    @media print { header, .due-box, .slot.now { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

/** The whole invoice document (one page) from a buildInvoiceModel() model. */
export function buildInvoiceHTML(m) {
  const c = m.customer || {};
  const lineRows = m.lines.map((l) => `<tr>
      <td><strong>${esc(l.name)}</strong></td><td>Rev ${esc(l.rev)}</td>
      <td class="num">${l.units}</td><td class="num">${l.cabsPerUnit}</td><td class="num">${l.cabinets}</td>
      <td class="num"><strong>${fmtCents(l.subtotalCents)}</strong></td></tr>`).join('');

  const schedRows = m.schedule.map((s) => `<tr>
      <td><span class="slot${s.billed ? ' now' : ''}"></span>${esc(s.label)}</td>
      <td>${esc(s.due)}</td>
      <td>${s.billed ? '<span class="this-inv">THIS INVOICE</span>' : 'Unpaid - to be invoiced'}</td>
      <td class="num"><strong>${fmtCents(s.amountCents)}</strong></td></tr>`).join('');

  const sheet = `<section class="sheet">
    <header>
      <div class="brand">PL<span class="slash">/</span>NTH<small>PRO-FORMA ${esc(m.kindLabel)}</small></div>
      <div class="meta">
        <strong>${esc(m.invoiceNo)}</strong><br>
        Order ${esc(m.orderNo)} - placed ${esc(m.dates.placed)}<br>
        Issued ${esc(m.dates.issued)} - ${esc(m.dates.dueLabel)}
      </div>
    </header>
    <div class="body">
      <div class="inv-top">
        <div class="inv-box">
          <h3 style="margin-top:0">BILL TO</h3>
          <div class="who">${esc(c.name || 'Trade customer')}</div>
          <div>${esc(c.email || '')}</div>
          <div class="mut">Project: ${esc(m.project)}</div>
        </div>
        <div class="inv-box">
          <h3 style="margin-top:0">ORDER</h3>
          <div><strong>${esc(m.orderNo)}</strong> - ${esc(m.project)}</div>
          <div>${m.totals.cabinets} cabinets${m.finish ? ` - finish: ${esc(m.finish)}` : ''}</div>
          <div class="mut">${m.phased ? 'Phased delivery - see the payment schedule below' : 'Single delivery'}</div>
        </div>
      </div>

      <h3>ORDER LINES</h3>
      <table class="lines">
        <thead><tr><th>UNIT TYPE</th><th>REV</th><th class="num">UNITS</th><th class="num">CAB/UNIT</th><th class="num">CABINETS</th><th class="num">SUBTOTAL</th></tr></thead>
        <tbody>${lineRows || '<tr><td colspan="6">No lines on this order.</td></tr>'}</tbody>
      </table>
      <table class="tot">
        <tr><td class="l">Cabinets subtotal</td><td class="num">${fmtCents(m.totals.subtotalCents)}</td></tr>
        ${m.charges.map((ch) => `<tr><td class="l">${esc(ch.label)}</td><td class="num">${fmtCents(ch.amountCents)}</td></tr>`).join('')}
        <tr class="hi"><td class="l">Order total</td><td class="num">${fmtCents(m.totals.grandCents)}</td></tr>
      </table>

      <div class="due-box">
        <div class="lbl">AMOUNT DUE - ${esc(m.kindLabel)}<small>${esc(m.dates.dueLabel)}</small></div>
        <div class="amt">${fmtCents(m.amountDueCents)}</div>
      </div>

      <h3>PAYMENT SCHEDULE</h3>
      <table class="sched">
        <thead><tr><th>INSTALLMENT</th><th>DUE</th><th>STATUS</th><th class="num">AMOUNT</th></tr></thead>
        <tbody>${schedRows}</tbody>
      </table>

      <h3>PAYMENT INSTRUCTIONS</h3>
      <div class="pay-note">${esc(PAYMENT_NOTE)} Wire / ACH remittances should quote <strong>${esc(m.invoiceNo)}</strong> and order <strong>${esc(m.orderNo)}</strong>.</div>
    </div>
    <footer>
      <span class="disc"><strong>Please note:</strong> ${esc(DISCLAIMER)}</span>
      <span class="stamp">${esc(m.dates.issued)} - ${esc(m.invoiceNo)}<br>Made with PL/NNER - the PL/NTH kitchen planner - plinthmade.com</span>
    </footer>
  </section>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(`PL/NTH - ${m.invoiceNo} - ${m.project}`)}</title><style>${CSS}</style></head><body>${sheet}</body></html>`;
}
