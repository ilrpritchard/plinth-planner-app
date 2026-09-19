// ordertrack.js — PURE. What an order-tracking page shows, worked out from an
// order row (the owner's full row) OR the reduced read-only view a tracking link
// returns (SUPABASE_TRACKING.sql get_order_by_token: no prices, no customer).
//
//   trackingSteps(order)  the five-step line: done / current / todo, each dated
//                         from the status log when the log has it
//   phaseRows(order)      delivery phases with their own status + progress
//   latestNote(order)     PL/NTH's most recent note to the buyer
//   trackURL(token)       …/?order=<token>
//
// An order number (PL-YYMM-XXXX) is NOT a key: four characters a month can be
// walked in an afternoon. Access is the long random token, or number + email.

import { STATUSES, statusLabel, statusRank, mergedPhases } from './orders.js';

export const TRACK_TOKEN = /^[a-f0-9]{32,64}$/;
export const ORDER_NO = /^PL-\d{4}-[A-Z2-9]{4}$/;

/** The label the BUYER reads: an order starts life as a quote request. */
export const TRACK_LABELS = { submitted: 'Quote requested', confirmed: 'Confirmed', in_production: 'In production', shipped: 'Shipped', delivered: 'Delivered' };

export function trackURL(token, base) {
  const b = base || (typeof location !== 'undefined' ? location.origin + location.pathname : '/');
  return `${b}?order=${token}`;
}

const logOf = (order) => (Array.isArray(order?.status_log) ? order.status_log : []);

export function trackingSteps(order) {
  if (!order) return [];
  const cancelled = order.status === 'cancelled';
  const log = logOf(order);
  // how far it got: the current status, or (cancelled) the furthest the log shows
  let reached = statusRank(order.status);
  if (cancelled) reached = Math.max(0, ...log.map((e) => statusRank(e.status)));
  const dateFor = (s) => {
    const hit = log.find((e) => e.status === s);
    if (hit && hit.at) return hit.at;
    return s === 'submitted' ? (order.placed_at || order.placedAt || null) : null;
  };
  return STATUSES.map((s, i) => ({
    key: s,
    label: TRACK_LABELS[s] || statusLabel(s),
    state: i < reached ? 'done' : i === reached ? (cancelled ? 'done' : (s === 'delivered' ? 'done' : 'current')) : 'todo',
    at: i <= reached ? dateFor(s) : null,
  }));
}

export function phaseRows(order) {
  return mergedPhases(order).map((p) => {
    const rank = Math.max(0, statusRank(p.status));
    return { id: p.id, label: /^unassigned/i.test(p.label || '') ? '' : (p.label || ''), units: p.units || 0, cabinets: p.cabinets || 0, status: p.status, statusLabel: p.status === 'submitted' ? 'Not started' : (TRACK_LABELS[p.status] || statusLabel(p.status)), pct: Math.round((rank / (STATUSES.length - 1)) * 100) };
  });
}

export function latestNote(order) {
  if (!order) return null;
  if (order.note || order.update_note) return { text: order.note || order.update_note, at: order.note_at || order.update_note_at || null };
  const hit = [...logOf(order)].reverse().find((e) => e.note);
  return hit ? { text: hit.note, at: hit.at || null } : null;
}

/** Units across every type (the reduced view carries no totals.units). */
export function orderUnits(order) {
  const uts = order?.unitTypes || order?.data?.unitTypes || [];
  return uts.reduce((n, ut) => n + (Number(ut.units) || 0), 0);
}
