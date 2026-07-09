// changeorder.js (ui) — the printable CHANGE ORDER: letter-portrait pages
// styled to match the invoice / submittal sheets (same dark-on-cream brand
// header, footer + disclaimer pattern), printed to PDF through the same
// openPrintWindow flow. All numbers arrive pre-computed in the model from
// core/changeorder.js — this file only lays them out. ASCII-safe source,
// DOM-free (node-testable string builder).

import { esc } from '../core/submittal.js';
import { fmtCents } from '../core/invoice.js';
import { fmtDelta } from '../core/changeorder.js';

const DISCLAIMER = 'This change order amends the referenced trade order. Once countersigned by both parties the revised totals below supersede the original order value; unchanged lines keep their original pricing and are not re-billed. Removed quantities are credited at the ordered price; added or changed lines are priced at the current catalogue rate. All amounts are in USD. Dimensions and site measurements remain as entered by the client - the client is responsible for confirming every measurement on site.';

const CSS = `
    @page { size: letter portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #332318; margin: 0; }
    .sheet { min-height: 253mm; display: flex; flex-direction: column; }
    header { display: flex; justify-content: space-between; align-items: flex-end;
      background: #332318; color: #efebe5; padding: 12px 18px; border-radius: 6px; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: 3px; }
    .brand .slash { opacity: 0.55; }
    .brand small { display: block; font-size: 9px; font-weight: 400; letter-spacing: 4px; opacity: 0.7; margin-top: 2px; }
    .meta { text-align: right; font-size: 10px; line-height: 1.55; opacity: 0.92; }
    .meta strong { font-size: 12px; letter-spacing: 1px; }
    .body { flex: 1; margin-top: 8px; border: 1px solid #d9cfb8; border-radius: 6px; padding: 14px 16px; }
    h3 { font-size: 10px; letter-spacing: 1.5px; color: #7a6d54; margin: 12px 0 5px; }
    .co-top { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
    .co-box { border: 1px solid #d9cfb8; border-radius: 6px; padding: 8px 10px; font-size: 10.5px; line-height: 1.6; }
    .co-box .who { font-size: 13px; font-weight: 700; }
    .co-box .mut { color: #7a6d54; }
    .warn { border: 1px solid #b2543a; color: #b2543a; border-radius: 6px; padding: 6px 10px; font-size: 9.5px; margin-top: 8px; }
    table { border-collapse: collapse; width: 100%; font-size: 10px; }
    table.lines th { text-align: left; font-size: 8px; letter-spacing: 0.8px; color: #7a6d54; border-bottom: 1px solid #332318; padding: 3px 8px 4px 0; }
    table.lines td { padding: 4px 8px 4px 0; border-bottom: 1px solid #ece4d2; }
    .num { text-align: right; }
    tr.ut-head td { background: #f3eee2; font-weight: 700; padding: 5px 8px; border-bottom: 1px solid #d9cfb8; }
    tr.ut-sub td { font-weight: 700; border-bottom: 2px solid #d9cfb8; }
    .tag { display: inline-block; font-size: 7.5px; letter-spacing: 1px; border: 1px solid currentColor; border-radius: 3px; padding: 0 4px; margin-left: 6px; vertical-align: 1px; }
    .add { color: #3a6b35; } .rem { color: #b2543a; } .chg { color: #7a6d54; }
    .pos { color: #b2543a; } .neg { color: #3a6b35; }
    table.tot { width: 62%; margin-left: auto; margin-top: 6px; }
    table.tot td { padding: 3px 0 3px 8px; }
    table.tot td.l { color: #7a6d54; }
    table.tot tr.hi td { border-top: 2px solid #332318; font-weight: 800; font-size: 11px; }
    .due-box { display: flex; justify-content: space-between; align-items: center;
      background: #332318; color: #efebe5; border-radius: 6px; padding: 12px 16px; margin-top: 12px; }
    .due-box .lbl { font-size: 10px; letter-spacing: 2.5px; }
    .due-box .lbl small { display: block; font-size: 8.5px; letter-spacing: 1px; opacity: 0.75; margin-top: 3px; }
    .due-box .amt { font-size: 26px; font-weight: 800; letter-spacing: 0.5px; }
    .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-top: 14px; page-break-inside: avoid; }
    .sign-box { border: 1px solid #d9cfb8; border-radius: 6px; padding: 10px 12px; font-size: 9.5px; color: #5a4a38; }
    .sign-box .party { font-size: 10px; font-weight: 800; letter-spacing: 1.5px; color: #332318; }
    .sign-line { border-bottom: 1px solid #7a6d54; height: 26px; margin: 14px 0 3px; }
    .sign-lbl { font-size: 8px; letter-spacing: 1px; color: #7a6d54; }
    footer { display: flex; justify-content: space-between; gap: 14px; margin-top: 6px;
      border-top: 1px solid #d9cfb8; padding-top: 5px; font-size: 8px; color: #7a6d54; }
    footer .disc { max-width: 64%; }
    footer .stamp { text-align: right; white-space: nowrap; }
    @media print { header, .due-box, tr.ut-head td { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

const KIND_TAG = {
  added: '<span class="tag add">ADDED</span>',
  removed: '<span class="tag rem">REMOVED</span>',
  qty: '<span class="tag chg">QTY</span>',
  reprice: '<span class="tag chg">REPRICE</span>',
};

const dcls = (c) => (c > 0 ? 'pos' : c < 0 ? 'neg' : '');

/** One unit type's change block: header row, changed lines, subtotal row. */
function unitTypeRows(ut) {
  const revStr = ut.kind === 'added' ? `NEW - Rev ${esc(ut.newRev || 'A')}`
    : ut.kind === 'removed' ? `REMOVED - was Rev ${esc(ut.oldRev || 'A')}`
    : (ut.oldRev === ut.newRev ? `Rev ${esc(ut.oldRev)}` : `Rev ${esc(ut.oldRev)} &rarr; ${esc(ut.newRev)}`);
  const unitsStr = ut.oldUnits === ut.newUnits ? `&times;${ut.newUnits} units`
    : `&times;${ut.oldUnits} &rarr; &times;${ut.newUnits} units`;
  const head = `<tr class="ut-head"><td colspan="6">${esc(ut.name)} - ${revStr} - ${unitsStr}${KIND_TAG[ut.kind] || ''}</td></tr>`;

  const lines = ut.lines.map((l) => `<tr>
      <td>${esc(l.code)}${KIND_TAG[l.kind] || ''}</td><td>${esc(l.desc)}</td>
      <td class="num">${l.oldQty}</td><td class="num">${l.newQty}</td>
      <td class="num">${fmtCents(l.newEachCents || l.oldEachCents)}</td>
      <td class="num ${dcls(l.deltaCents)}"><strong>${fmtDelta(l.deltaCents)}</strong> /unit</td></tr>`).join('');

  const note = ut.lines.length ? '' : `<tr><td colspan="6" style="color:#7a6d54">No line changes - ${
    ut.oldUnits !== ut.newUnits ? 'unit count changed' : 'revision reissued'}.</td></tr>`;

  const sub = `<tr class="ut-sub"><td colspan="5">${esc(ut.name)} - extended change (${
    fmtCents(ut.oldExtCents)} &rarr; ${fmtCents(ut.newExtCents)})</td>
    <td class="num ${dcls(ut.deltaCents)}">${fmtDelta(ut.deltaCents)}</td></tr>`;

  return head + lines + note + sub;
}

/** The whole change-order document from a buildChangeOrderModel() model. */
export function buildChangeOrderHTML(m) {
  const c = m.customer || {};
  const t = m.totals;

  const sheet = `<section class="sheet">
    <header>
      <div class="brand">PL<span class="slash">/</span>NTH<small>CHANGE ORDER</small></div>
      <div class="meta">
        <strong>${esc(m.coNo)}</strong><br>
        Amends order ${esc(m.orderNo)} - placed ${esc(m.dates.placed)}<br>
        Issued ${esc(m.dates.issued)} - awaiting countersignature
      </div>
    </header>
    <div class="body">
      <div class="co-top">
        <div class="co-box">
          <h3 style="margin-top:0">CLIENT</h3>
          <div class="who">${esc(c.name || 'Trade customer')}</div>
          <div>${esc(c.email || '')}</div>
          <div class="mut">Project: ${esc(m.project)}</div>
        </div>
        <div class="co-box">
          <h3 style="margin-top:0">ORIGINAL ORDER</h3>
          <div><strong>${esc(m.orderNo)}</strong> - ${esc(m.project)}</div>
          <div>${t.oldCabinets} cabinets${m.finish ? ` - finish: ${esc(m.finish)}` : ''} - ${fmtCents(t.oldGrandCents)}</div>
          <div class="mut">Revised: ${t.newCabinets} cabinets - ${fmtCents(t.newGrandCents)}</div>
        </div>
      </div>
      ${m.projectMismatch ? `<div class="warn"><strong>Check:</strong> this change order was generated against working project &quot;${esc(m.liveProject)}&quot;, but the order was placed for &quot;${esc(m.project)}&quot;.</div>` : ''}

      <h3>CHANGES${m.unchangedCount ? ` - ${m.unchangedCount} unit type${m.unchangedCount === 1 ? '' : 's'} unchanged (not shown, original pricing holds)` : ''}</h3>
      <table class="lines">
        <thead><tr><th>CODE</th><th>DESCRIPTION</th><th class="num">ORDERED</th><th class="num">REVISED</th><th class="num">EACH</th><th class="num">CHANGE</th></tr></thead>
        <tbody>${m.changes.map(unitTypeRows).join('') || '<tr><td colspan="6">No changes.</td></tr>'}</tbody>
      </table>

      <table class="tot">
        <tr><td class="l">Original order total</td><td class="num">${fmtCents(t.oldGrandCents)}</td></tr>
        <tr><td class="l">Cabinet changes</td><td class="num ${dcls(t.newSubtotalCents - t.oldSubtotalCents)}">${fmtDelta(t.newSubtotalCents - t.oldSubtotalCents)}</td></tr>
        <tr><td class="l">Shipping &amp; containers (${fmtCents(t.oldShippingCents)} &rarr; ${fmtCents(t.newShippingCents)})</td><td class="num ${dcls(t.shippingDeltaCents)}">${fmtDelta(t.shippingDeltaCents)}</td></tr>
        <tr class="hi"><td class="l">Revised order total</td><td class="num">${fmtCents(t.newGrandCents)}</td></tr>
      </table>

      <div class="due-box">
        <div class="lbl">NET CHANGE - ${esc(m.coNo)}<small>${t.netDeltaCents >= 0 ? 'Added to the balance installment on countersignature' : 'Credited against the balance installment on countersignature'}</small></div>
        <div class="amt">${fmtDelta(t.netDeltaCents)}</div>
      </div>

      <h3>SIGN-OFF</h3>
      <div class="sign">
        ${m.signoff.map((s) => `<div class="sign-box">
          <div class="party">${esc(s.party)}</div>
          <div class="sign-line"></div><div class="sign-lbl">SIGNATURE</div>
          <div class="sign-line" style="height:14px">${esc(s.name || '')}</div><div class="sign-lbl">NAME</div>
          <div class="sign-line" style="height:14px"></div><div class="sign-lbl">DATE</div>
        </div>`).join('')}
      </div>
    </div>
    <footer>
      <span class="disc"><strong>Please note:</strong> ${esc(DISCLAIMER)}</span>
      <span class="stamp">${esc(m.dates.issued)} - ${esc(m.coNo)}<br>Made with PL/NNER - the PL/NTH kitchen planner - plinthmade.com</span>
    </footer>
  </section>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(`PL/NTH - ${m.coNo} - ${m.project}`)}</title><style>${CSS}</style></head><body>${sheet}</body></html>`;
}
