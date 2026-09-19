// changerequest.js — PURE. A buyer's request to change a placed order, submitted to
// PL/NTH for approval (SUPABASE_CHANGES.sql). The order snapshot stays FROZEN: a
// change is its own record, holding
//   proposal  the revised spec (a reduced trade: unit types, counts, rows)
//   model     the change-order model worked out WHEN IT WAS REQUESTED, so the
//             paperwork regenerates from stored data and never drifts with the
//             catalogue (same rule as every other order document)
// Change N is measured against the order as it stands after every APPROVED change
// before it, so approved net changes simply add up (the balance invoice does that).

import { snapshotToTrade, buildOrderSnapshot } from './orders.js';
import { buildChangeOrderModel } from './changeorder.js';
import { getCab } from './catalogue.js';
import { nextRev } from './submittal.js';

export const CHANGE_STATUSES = ['pending', 'approved', 'declined', 'withdrawn'];
export const CHANGE_LABELS = { pending: 'Awaiting PL/NTH', approved: 'Approved', declined: 'Declined', withdrawn: 'Withdrawn' };
/** Once cabinets are on the road a change is a new order, not a change. */
export const CHANGEABLE_ORDER_STATUSES = ['submitted', 'confirmed', 'in_production'];

const clone = (x) => JSON.parse(JSON.stringify(x));
const byRecency = (a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0);

export function approvedChanges(changes) {
  return (changes || []).filter((c) => c && c.status === 'approved').sort((a, b) => -byRecency(a, b));
}
export function pendingChange(changes) { return (changes || []).find((c) => c && c.status === 'pending') || null; }
export function nextChangeSeq(changes) { return (changes || []).reduce((n, c) => Math.max(n, Number(c.seq) || 0), 0) + 1; }

export function canRequestChange(order, changes) {
  if (!order || !CHANGEABLE_ORDER_STATUSES.includes(order.status)) return { ok: false, reason: 'This order can no longer be changed here. Contact PL/NTH.' };
  if (pendingChange(changes)) return { ok: false, reason: 'A change is already awaiting PL/NTH. Withdraw it first, or wait for the reply.' };
  return { ok: true };
}

/** The order as it stands today: the frozen snapshot with the latest APPROVED proposal laid over it. */
export function currentOrderRow(order, changes) {
  const last = approvedChanges(changes).pop();
  if (!last || !last.proposal) return order;
  const snap = buildOrderSnapshot(proposalTrade(order, last.proposal), { now: Date.parse(order.placed_at) || Date.now() });
  return { ...order, data: { ...order.data, unitTypes: snap.unitTypes, totals: snap.totals } };
}

/** The editable starting point for a new request: a plain trade of the order as it stands. */
export function startProposal(order, changes) {
  const t = snapshotToTrade(currentOrderRow(order, changes));
  return { units: t.units.map((u) => ({ id: u.id, name: u.name, rev: u.rev || 'A', qty: u.qty, rows: u.rows.map((r) => ({ code: r.code, qty: r.qty })) })) };
}

/** A stored proposal back into the trade shape the builders read. */
export function proposalTrade(order, proposal) {
  const base = snapshotToTrade(order);
  let rowId = 1;
  return { ...base, units: (proposal.units || []).map((u, i) => ({
    id: i + 1, beds: '', letter: 'A', name: u.name || `Unit type ${i + 1}`, rev: u.rev || 'A',
    qty: Math.max(0, Math.round(Number(u.qty) || 0)), floorFrom: '', floorTo: '', perFloor: '',
    rows: (u.rows || []).filter((r) => getCab(r.code) && (Number(r.qty) || 0) > 0).map((r) => ({ id: rowId++, code: r.code, qty: Math.round(Number(r.qty)) })),
  })).filter((u) => u.qty > 0 && u.rows.length) };
}

/** Tidy an edited proposal: whole numbers, known codes, duplicate rows merged, and a
 *  unit type whose cabinet lines changed moves to its next revision letter. */
export function normalizeProposal(order, changes, proposal) {
  const before = new Map(startProposal(order, changes).units.map((u) => [u.name, u]));
  const sig = (rows) => rows.map((r) => `${r.code}x${r.qty}`).sort().join('|');
  return { units: (proposal.units || []).map((u) => {
    const merged = new Map();
    for (const r of u.rows || []) {
      const q = Math.max(0, Math.round(Number(r.qty) || 0));
      if (!getCab(r.code) || !q) continue;
      merged.set(r.code, (merged.get(r.code) || 0) + q);
    }
    const rows = [...merged].map(([code, qty]) => ({ code, qty }));
    const was = before.get(u.name);
    const rev = was ? (sig(was.rows) !== sig(rows) ? nextRev(was.rev) : was.rev) : 'A';
    return { name: String(u.name || '').slice(0, 80), rev, qty: Math.max(0, Math.round(Number(u.qty) || 0)), rows };
  }) };
}

/** Everything a request stores: { seq, proposal, model } or { error }. */
export function buildChangeRequest(order, changes, editedProposal, opts = {}) {
  const gate = canRequestChange(order, changes);
  if (!gate.ok) return { error: gate.reason };
  const proposal = normalizeProposal(order, changes, editedProposal);
  const seq = nextChangeSeq(changes);
  const model = buildChangeOrderModel(currentOrderRow(order, changes), proposalTrade(order, proposal), { seq, now: opts.now });
  if (!model.changes.length) return { error: 'Nothing has changed yet.' };
  if (!model.totals.newCabinets) return { error: 'A change cannot remove every cabinet. Cancel the order instead.' };
  return { seq, proposal, model: clone(model) };
}

/** What the balance invoice adds: one line per APPROVED change. */
export function invoiceChanges(changes) {
  return approvedChanges(changes).map((c) => ({ label: `Change ${c.seq}, approved`, netDeltaCents: Math.round(Number(c.model && c.model.totals && c.model.totals.netDeltaCents) || 0) }));
}
