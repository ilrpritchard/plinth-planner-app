// tradecsv.js — the trade order as a spreadsheet-ready CSV. Pure string
// builder: one row per unit-type × cabinet line, then footer rows for
// containers, shipping and the grand total (same maths as tradeSummary).

import { getCab, sellUSD } from './catalogue.js';
import { tradeSummary, unitQty, unitName } from './cost.js';
import { planPhases, phasesForUnit, batchWindow } from './phasing.js';

const HEADER = ['Unit type', 'Floors / qty', 'Cabinet code', 'Description',
  'W (in)', 'D (in)', 'H (in)', 'Qty per unit', 'Total qty', 'Unit sell $', 'Line total $'];

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function floorsLabel(u, q) {
  const set = (v) => v !== '' && v != null;
  if (set(u.floorFrom) && set(u.floorTo) && set(u.perFloor)) {
    return `Floors ${u.floorFrom}-${u.floorTo} x ${u.perFloor}/floor (${q})`;
  }
  return String(q);
}

/** The whole trade project as CSV text (CRLF rows, Excel-safe quoting).
 *  When trade.phasing.on, a 'Delivery phase' column is APPENDED to every line
 *  (existing columns untouched) plus a DELIVERY PHASING block after the totals. */
export function buildTradeOrderCSV(trade, now = Date.now()) {
  const phasing = trade && trade.phasing && trade.phasing.on
    ? planPhases(trade, { maxUnitsPerBatch: trade.phasing.maxPerBatch, showKitchenFirst: !!trade.phasing.showFirst })
    : null;
  const rows = [phasing ? HEADER.concat(['Delivery phase']) : HEADER];
  for (const u of (trade && trade.units) || []) {
    const q = unitQty(u);
    const floors = floorsLabel(u, q);
    const phase = phasing ? phasesForUnit(phasing, u).join(' ') : null;
    for (const rr of u.rows || []) {
      const cab = getCab(rr.code);
      if (!cab || cab.notSupplied) continue;
      const per = Number(rr.qty) || 0;
      const each = sellUSD(cab);
      const line = [unitName(u), floors, cab.code, cab.desc,
        cab.w, cab.d, cab.h, per, per * q, each.toFixed(2), (each * per * q).toFixed(2)];
      if (phasing) line.push(phase);
      rows.push(line);
    }
  }
  const s = tradeSummary(trade || { units: [] });
  rows.push([]);
  rows.push(['CABINETS SUBTOTAL', '', '', '', '', '', '', '', s.totalCabs, '', s.subtotal.toFixed(2)]);
  if (s.tier) rows.push([`VOLUME TIER ${s.tier.label} (indicative -${s.tier.pct}%)`, '', '', '', '', '', '', '', '', '', (-s.discount).toFixed(2)]);
  rows.push(['CONTAINERS', '', '', '', '', '', '', '', s.containers, '', '']);
  rows.push(['SHIPPING', '', '', '', '', '', '', '', '', '', s.shipping.toFixed(2)]);
  rows.push(['GRAND TOTAL', '', '', '', '', '', '', '', '', '', s.grand.toFixed(2)]);
  if (phasing && phasing.batches.length) {
    rows.push([]);
    rows.push(['DELIVERY PHASING', `max ${phasing.maxPerBatch} units/batch`, '', '', '', '', '', '', '', '', '']);
    rows.push(['Phase', 'Floors', 'Unit types', '', '', '', '', 'Units', 'Cabinets', 'Est. window', '']);
    for (const b of phasing.batches) {
      const w = batchWindow(b, now);
      rows.push([`Phase ${b.n}`, b.label.replace('–', '-'), b.byType.map((t) => `${t.qty}x ${t.name}`).join('; '),
        '', '', '', '', b.units, b.cabinets, `${w.from} - ${w.to}`, '']);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}
