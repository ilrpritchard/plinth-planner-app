// order.js — build a pre-filled order email to Plinth. The customer's mail
// client opens with the full block list, finish, and their details so it lands
// in Imogen's inbox ready to turn into a Xero quote. Fully offline (mailto).

import { summarizeState, tradeSummary, unitName, unitQty, deliveryEstimate } from './cost.js';
import { fmtUSD, getCab } from './catalogue.js';
import { fmtFeetIn } from './units.js';

export const ORDER_TO = 'imogen@plinthmade.com';
export const TRADE_TO = 'imogen@plinthmade.com';

export function buildOrderEmail(state) {
  const { lines, totalCabs, subtotal } = summarizeState(state);
  const c = state.customer;
  const r = state.room;

  const subject = `PL/NTH order — ${c.name || 'New kitchen'} (${totalCabs} cabinets)`;

  const L = [];
  L.push('NEW PLINTH KITCHEN ORDER');
  L.push('========================');
  L.push('');
  L.push(`Name:   ${c.name || '—'}`);
  L.push(`Email:  ${c.email || '—'}`);
  L.push(`Zip:    ${c.zip || '—'}`);
  L.push('');
  L.push(`Room:   ${fmtFeetIn(r.width)} W × ${fmtFeetIn(r.depth)} D × ${fmtFeetIn(r.height)} ceiling`);
  L.push(`Finish: ${state.finish} (all cabinets)`);
  L.push('Hardware: by others — cabinets supplied undrilled');
  if (c.budget) L.push(`Budget: $${Number(c.budget).toLocaleString('en-US')}`);
  L.push('');
  L.push('CABINETS');
  L.push('--------');
  for (const ln of lines.filter((l) => !l.notSupplied)) {
    L.push(`${ln.qty} × ${ln.code}  ${ln.desc} — ${ln.dims}  …  ${fmtUSD(ln.line)}`);
  }
  const appliances = lines.filter((l) => l.notSupplied);
  if (appliances.length) {
    L.push('');
    L.push('APPLIANCES (customer to supply — shown for layout only)');
    L.push('------------------------------------------------------');
    for (const ln of appliances) L.push(`${ln.qty} × ${ln.desc} — ${ln.dims}`);
  }
  L.push('');
  L.push(`Total cabinets: ${totalCabs}`);
  L.push(`Estimate (cabinets, excl. shipping & tax): ${fmtUSD(subtotal)}`);
  const del = deliveryEstimate(totalCabs);
  L.push(`Estimated delivery: ${del.weeksLo}–${del.weeksHi} weeks (around ${del.from} – ${del.to})`);
  if (c.notes) { L.push(''); L.push('Notes:'); L.push(c.notes); }
  L.push('');
  L.push('— Sent from PL/NNER, the PL/NTH planner. Countertops shown are representative only and not supplied by Plinth.');

  const body = L.join('\n');
  return {
    to: ORDER_TO,
    subject,
    body,
    href: `mailto:${ORDER_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

// ----- Trade (multi-unit) order -----------------------------------------
export function buildTradeOrderEmail(state) {
  const t = state.trade;
  const c = state.customer;
  const s = tradeSummary(t);
  const subject = `PL/NTH TRADE order — ${t.project || 'Project'} (${s.totalUnits} units, ${s.totalCabs} cabinets)`;

  const L = [];
  L.push('NEW PLINTH TRADE ORDER');
  L.push('======================');
  L.push('');
  L.push(`Project:  ${t.project || '—'}`);
  if (t.address) L.push(`Address:  ${t.address}`);
  if (t.architect) L.push(`Architect: ${t.architect}`);
  if (t.gc) L.push(`GC:       ${t.gc}`);
  if (t.owner) L.push(`Owner:    ${t.owner}`);
  L.push(`Contact:  ${c.name || '—'}  ${c.email || ''}`);
  L.push(`Finish:   ${t.finish}${t.finish === 'Custom RAL' && t.finishRal ? ` (RAL ${t.finishRal})` : ''} (all units)`);
  L.push('Hardware: by others — cabinets supplied undrilled');
  L.push('');
  for (const u of t.units || []) {
    L.push(`— ${unitName(u)}  ×${unitQty(u)} units`);
    for (const r of u.rows || []) {
      const cab = getCab(r.code);
      if (!cab) continue;
      L.push(`     ${r.qty} × ${cab.code}  ${cab.desc}`);
    }
  }
  L.push('');
  L.push('SPEC SUMMARY');
  L.push('------------');
  for (const ln of s.lines) {
    L.push(`${ln.name}: ${ln.cabsPerUnit} cab/unit × ${ln.qty} = ${ln.totalCabs} cabinets … ${fmtUSD(ln.totalSell)}`);
  }
  L.push('');
  L.push(`Total units: ${s.totalUnits}`);
  L.push(`Total cabinets: ${s.totalCabs}  (~${s.containers} container${s.containers === 1 ? '' : 's'})`);
  L.push(`Cabinets sub-total: ${fmtUSD(s.subtotal)}`);
  if (s.tier) L.push(`Volume tier ${s.tier.label} (indicative -${s.tier.pct}%): -${fmtUSD(s.discount)}`);
  L.push(`Shipping (per container): ${fmtUSD(s.shipping)}`);
  L.push(`Order total (excl. tax): ${fmtUSD(s.grand)}`);
  if (c.notes) { L.push(''); L.push('Notes:'); L.push(c.notes); }
  L.push('');
  L.push('— Sent from PL/NNER, the PL/NTH planner (Trade). Final trade pricing confirmed on quote.');

  const body = L.join('\n');
  return {
    to: TRADE_TO,
    subject,
    body,
    href: `mailto:${TRADE_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}
