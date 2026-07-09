// invoice.js — pro-forma invoices for real trade orders. Pure and
// node-testable: buildInvoiceModel() turns a stored order (a Supabase
// trade_orders row or a bare snapshot from buildOrderSnapshot) into every
// number the printable invoice needs. All money maths runs in INTEGER CENTS —
// dollars only appear at the formatting edge — and on a 50% split any odd
// cent lands on the DEPOSIT, so deposit + balance always equals the grand
// total to the cent.
//
//   buildInvoiceModel(order, { kind, depositPct, now }) → the invoice model
//   toCents(usd) / fmtCents(cents)                       money helpers
//
// Payment terms (the default schedule):
//   50% deposit on order confirmation — due on receipt
//   50% balance before the first shipment — when the order is phased, due
//   14 days before the Phase 1 delivery window opens; otherwise on notice.

export const INVOICE_KINDS = ['deposit', 'balance', 'full'];

export const DEFAULT_DEPOSIT_PCT = 50;
export const BALANCE_LEAD_DAYS = 14;         // balance due this long before phase 1

/** Dollars (number) → integer cents, safely. */
export function toCents(usd) { return Math.round((Number(usd) || 0) * 100); }

/** Integer cents → '$1,234.56' (always two decimals, thousands commas). */
export function fmtCents(cents) {
  const n = Math.round(Number(cents) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Split a grand total (cents) into deposit + balance. The deposit is rounded
 * UP, so with the default 50% terms any odd cent goes to the deposit and the
 * two installments always sum back to the grand total exactly.
 */
export function splitDeposit(grandCents, depositPct = DEFAULT_DEPOSIT_PCT) {
  const g = Math.max(0, Math.round(Number(grandCents) || 0));
  const pct = Math.min(100, Math.max(0, Number(depositPct) || 0));
  const deposit = Math.ceil((g * pct) / 100);
  return { deposit, balance: g - deposit };
}

/**
 * When is the BALANCE due? Phased orders: 14 days before the Phase 1 window
 * opens (both dates come from the immutable snapshot, so this never drifts).
 * Unphased orders ship as one delivery on a lead time confirmed later, so the
 * balance is simply due on notice, before the first shipment.
 */
export function balanceDue(snapshot) {
  const phases = (snapshot && snapshot.phases) || [];
  const from = phases.length && phases[0].window && phases[0].window.from;
  if (from) {
    const t = Date.parse(from);
    if (!Number.isNaN(t)) {
      const due = t - BALANCE_LEAD_DAYS * 24 * 3600 * 1000;
      return { date: fmtDate(due), iso: new Date(due).toISOString(),
        label: `Due ${fmtDate(due)} - ${BALANCE_LEAD_DAYS} days before the Phase 1 delivery window (${from})` };
    }
  }
  return { date: null, iso: null, label: 'Due on notice, before the first shipment' };
}

/**
 * The whole invoice as plain data. `order` is a trade_orders row
 * ({ order_no, placed_at, data }) or a bare snapshot; `opts.kind` picks which
 * installment this invoice bills ('deposit' | 'balance' | 'full').
 */
export function buildInvoiceModel(order, opts = {}) {
  const d = (order && order.data) || order || {};
  const orderNo = (order && order.order_no) || d.orderNo || 'PL-0000-XXXX';
  const kind = INVOICE_KINDS.includes(opts.kind) ? opts.kind : 'deposit';
  const depositPct = opts.depositPct != null ? Number(opts.depositPct) : DEFAULT_DEPOSIT_PCT;
  const now = opts.now != null ? opts.now : Date.now();

  // 'PL-2607-K7WQ' → 'INV-2607-K7WQ-1' (deposit / full) or '-2' (balance)
  const suffix = String(orderNo).replace(/^PL-?/, '');
  const invoiceNo = `INV-${suffix}-${kind === 'balance' ? '2' : '1'}`;

  // one invoice line per unit type — straight from the frozen snapshot
  const lines = (d.unitTypes || []).map((ut) => {
    const cabsPerUnit = (ut.lines || []).reduce((t, l) => t + (Number(l.qty) || 0), 0);
    const subtotalCents = (ut.lines || []).reduce((t, l) => t + toCents(l.total), 0);
    return {
      name: ut.name || 'Unit type', rev: ut.rev || 'A',
      units: Number(ut.units) || 0, cabsPerUnit,
      cabinets: cabsPerUnit * (Number(ut.units) || 0),
      subtotalCents,
    };
  });

  const t = d.totals || {};
  const subtotalCents = t.subtotal != null ? toCents(t.subtotal)
    : lines.reduce((x, l) => x + l.subtotalCents, 0);
  const shippingCents = toCents(t.shipping);
  const grandCents = t.grand != null ? toCents(t.grand) : subtotalCents + shippingCents;

  const { deposit, balance } = splitDeposit(grandCents, depositPct);
  const balDue = balanceDue(d);
  const issued = fmtDate(now);

  const schedule = [
    {
      key: 'deposit',
      label: `Deposit - ${Math.round(depositPct)}% on order confirmation`,
      amountCents: deposit,
      due: 'Due on receipt',
      billed: kind === 'deposit' || kind === 'full',
    },
    {
      key: 'balance',
      label: `Balance - ${100 - Math.round(depositPct)}% before first shipment`,
      amountCents: balance,
      due: balDue.label,
      billed: kind === 'balance' || kind === 'full',
    },
  ];

  const amountDueCents = kind === 'deposit' ? deposit : kind === 'balance' ? balance : grandCents;
  const dueLabel = kind === 'balance' ? balDue.label : 'Due on receipt';

  return {
    invoiceNo, orderNo, kind,
    kindLabel: kind === 'deposit' ? 'DEPOSIT INVOICE' : kind === 'balance' ? 'BALANCE INVOICE' : 'INVOICE',
    project: d.project || 'Untitled project',
    finish: d.finish || '',
    customer: d.customer || null,
    phased: ((d.phases || []).length > 0),
    dates: {
      issued,
      placed: d.placedAt ? fmtDate(d.placedAt) : ((order && order.placed_at) ? fmtDate(order.placed_at) : issued),
      due: kind === 'balance' ? balDue.date : issued,
      dueLabel,
    },
    lines,
    charges: [{ label: 'Shipping & containers', amountCents: shippingCents }],
    totals: {
      cabinets: Number(t.cabinets) || lines.reduce((x, l) => x + l.cabinets, 0),
      subtotalCents, shippingCents, grandCents,
    },
    schedule,
    depositPct,
    amountDueCents,
  };
}
