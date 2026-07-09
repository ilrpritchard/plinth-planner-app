// tradebook.js — the whole trade project as one spreadsheet workbook. Pure:
// buildTradeWorkbook(trade) returns the sheets array for xlsxmini's
// buildXlsx(). Same maths as the UI (tradeSummary / summarizeState /
// planPhases) — this file only ARRANGES numbers, it never re-prices anything.
//
// Sheets: 'Summary' → project + unit types + totals incl. shipping;
//         'Unit <name>' per designed unit → priced rows incl. crown/fillers;
//         'Order' → flattened order lines + PO field + spec-check notes;
//         'Phasing' → delivery batches (only when phasing is on).

import { getCab, sellUSD } from './catalogue.js';
import { tradeSummary, unitQty, unitName, summarizeState } from './cost.js';
import { planPhases, batchWindow } from './phasing.js';
import { checkOrder, checkDesign } from './speccheck.js';
import { unitRev } from './submittal.js';

const B = (v) => ({ v, bold: true });          // bold cell
const C = (v) => ({ v, cur: true });           // $ currency cell
const BC = (v) => ({ v, bold: true, cur: true });

/** Same findings the Trade UI shows under each unit card (pure copy). */
export function unitFindings(u) {
  const hasRows = (u.rows || []).some((r) => getCab(r.code) && (Number(r.qty) || 0) > 0);
  if (u.design) {
    return checkDesign(u.design).concat(
      hasRows ? checkOrder(u.rows, u).filter((f) => f.msg.includes('PER UNIT')) : []);
  }
  return hasRows ? checkOrder(u.rows, u) : [];
}

function floorsLabel(u, q) {
  const set = (v) => v !== '' && v != null;
  if (set(u.floorFrom) && set(u.floorTo) && set(u.perFloor)) {
    return `Floors ${u.floorFrom}-${u.floorTo} x ${u.perFloor}/floor`;
  }
  return String(q);
}

function summarySheet(trade, s, dateStr) {
  const rows = [
    [B('PL/NTH — Trade project workbook')],
    [],
    ['Project', trade.project || 'Untitled project'],
    ['Finish', trade.finish || ''],
    ['Date', dateStr],
    [],
    [B('Unit type'), B('Cab/unit'), B('Units'), B('Cabinets'), B('Sub-total')],
  ];
  for (const l of s.lines) rows.push([l.name, l.cabsPerUnit, l.qty, l.totalCabs, C(l.totalSell)]);
  rows.push([]);
  rows.push(['Units', s.totalUnits]);
  rows.push(['Cabinets', s.totalCabs]);
  rows.push(['Containers', s.containers]);
  rows.push(['Cabinets subtotal', C(s.subtotal)]);
  rows.push(['Shipping', C(s.shipping)]);
  rows.push([B('Order total (incl. shipping)'), BC(s.grand)]);
  return { name: 'Summary', rows, widths: [30, 12, 10, 12, 16] };
}

function unitSheet(u) {
  const sum = summarizeState(u.design);
  const rows = [
    [B(`Unit ${unitName(u)} — Rev ${unitRev(u)}`)],
    [],
    [B('Code'), B('Description'), B('Qty'), B('Size (W × D × H)'), B('Each'), B('Line')],
  ];
  for (const l of sum.lines) {
    if (l.notSupplied) { rows.push([l.code, `${l.desc} (supply-your-own, not priced)`, l.qty, l.dims, '', '']); continue; }
    rows.push([l.code, l.desc, l.qty, l.dims, C(l.each), C(l.line)]);
  }
  rows.push([]);
  rows.push([B('Subtotal (per unit)'), '', '', '', '', BC(sum.subtotal)]);
  rows.push(['Units of this type', '', '', '', '', unitQty(u)]);
  rows.push([B('Extended (all units)'), '', '', '', '', BC(sum.subtotal * unitQty(u))]);
  return { name: `Unit ${unitName(u)}`, rows, widths: [10, 44, 8, 20, 12, 14] };
}

function orderSheet(trade, s, orderNo) {
  const rows = [
    [B('PL/NTH trade order'), '', trade.project || 'Untitled project'],
    ...(orderNo ? [[B('Order number'), orderNo]] : []),     // only once an order is placed
    [B('PO number'), ''],                                   // blank cell for them to fill
    [],
    [B('Unit type'), B('Floors / qty'), B('Code'), B('Description'),
      B('W (in)'), B('D (in)'), B('H (in)'), B('Qty per unit'), B('Units'),
      B('Total qty'), B('Unit price'), B('Line total')],
  ];
  for (const u of trade.units || []) {
    const q = unitQty(u);
    const floors = floorsLabel(u, q);
    for (const rr of u.rows || []) {
      const cab = getCab(rr.code);
      if (!cab || cab.notSupplied) continue;
      const per = Number(rr.qty) || 0;
      const each = sellUSD(cab);
      rows.push([unitName(u), floors, cab.code, cab.desc, cab.w, cab.d, cab.h,
        per, q, per * q, C(each), C(each * per * q)]);
    }
  }
  rows.push([]);
  rows.push([B('CABINETS SUBTOTAL'), '', '', '', '', '', '', '', '', s.totalCabs, '', BC(s.subtotal)]);
  rows.push(['CONTAINERS', '', '', '', '', '', '', '', '', s.containers, '', '']);
  rows.push(['SHIPPING', '', '', '', '', '', '', '', '', '', '', C(s.shipping)]);
  rows.push([B('ORDER TOTAL'), '', '', '', '', '', '', '', '', '', '', BC(s.grand)]);

  // spec-check findings, appended as notes
  rows.push([]);
  rows.push([B('SPEC CHECK — notes')]);
  let any = false;
  for (const u of trade.units || []) {
    for (const f of unitFindings(u)) {
      any = true;
      rows.push([unitName(u), String(f.level).toUpperCase(), f.msg]);
    }
  }
  if (!any) rows.push(['—', 'CLEAR', 'No findings — spec check clear.']);
  return { name: 'Order', rows, widths: [22, 22, 8, 40, 7, 7, 7, 11, 8, 10, 11, 13] };
}

function phasingSheet(trade, now) {
  const plan = planPhases(trade, { maxUnitsPerBatch: trade.phasing && trade.phasing.maxPerBatch });
  const rows = [
    [B('Delivery phasing'), `max ${plan.maxPerBatch} units/batch`],
    [],
    [B('Phase'), B('Floors'), B('Unit types'), B('Units'), B('Cabinets'), B('Window from'), B('Window to')],
  ];
  for (const b of plan.batches) {
    const w = batchWindow(b, now);
    rows.push([`Phase ${b.n}`, b.label, b.byType.map((t) => `${t.qty}x ${t.name}`).join('; '),
      b.units, b.cabinets, w.from, w.to]);
  }
  return { name: 'Phasing', rows, widths: [10, 14, 40, 8, 10, 16, 16] };
}

/**
 * buildTradeWorkbook(trade, now?, orderNo?) → sheets for buildXlsx().
 * `now` (ms) only feeds the phasing delivery windows — fixed in tests.
 * `orderNo` (optional) stamps the Order sheet once a real order was placed.
 */
export function buildTradeWorkbook(trade, now = Date.now(), orderNo = null) {
  const t = trade || { units: [] };
  const s = tradeSummary(t);
  const dateStr = new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const sheets = [summarySheet(t, s, dateStr)];
  for (const u of t.units || []) if (u.design) sheets.push(unitSheet(u));
  sheets.push(orderSheet(t, s, orderNo));
  if (t.phasing && t.phasing.on) sheets.push(phasingSheet(t, now));
  return sheets;
}
