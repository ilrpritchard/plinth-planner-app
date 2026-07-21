// tradecloud.js — trade projects in the cloud (Supabase REST, plain fetch).
// Sign-in itself reuses the existing account flow in cloud.js; everything here
// talks straight to PostgREST so nothing extra loads at runtime. Run
// SUPABASE_TRADE.sql (repo root) once to create the table + share function.
//
//   saveTradeProject(trade)   upsert (owner = the signed-in user)
//   listTradeProjects()       [{ id, name, share_token, updated_at }]
//   loadTradeProject(id)      { id, name, data, share_token }
//   ensureShareToken(trade)   mints + stores the project's share token
//   fetchSharedProject(token) read-only fetch via the token — NO sign-in
//   submitApproval({...})     records an approval into the existing leads table
//
// Real orders (run SUPABASE_ORDERS.sql once for these):
//   placeOrder(snapshot)      POST trade_orders (retries on order-no collision)
//   listOrders()              the signed-in user's orders, newest first
//   getOrder(id)              one order row
//   cancelOrder(id)           owner cancels while still 'submitted' (RPC)
//   adminSetStatus(id, s, ps) PL/NTH-only status update (RPC set_order_status)
//   isOrderAdmin()            does the signed-in user get admin controls?
//
// Docs hub (run SUPABASE_DOCS.sql once for these — documents are regenerated
// from the order snapshot, this is only the issued-log):
//   logOrderDoc(orderId, kind, label, rev)   record an issuance (RPC)
//   listOrderDocs(orderId)                   the order's issued-log (RPC)

import { SUPABASE_URL, SUPABASE_ANON_KEY, cloudEnabled } from './config.js';
import { authToken } from './cloud.js';
import { genOrderNo } from './orders.js';

const rest = (path) => `${SUPABASE_URL}/rest/v1/${path}`;

function headers(token, extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function parse(res) {
  let body = null;
  try { body = await res.json(); } catch { /* empty response is fine */ }
  if (!res.ok) {
    const msg = (body && (body.message || body.error_description || body.error)) || `request failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

async function authed() {
  if (!cloudEnabled()) throw new Error('Cloud not configured');
  const token = await authToken();
  if (!token) throw new Error('Please sign in first');
  return token;
}

/** Random url-safe share token (default 26 chars, alphanumeric). */
export function genShareToken(len = 26) {
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const buf = new Uint8Array(len);
  (globalThis.crypto || {}).getRandomValues
    ? globalThis.crypto.getRandomValues(buf)
    : buf.forEach((_, i) => { buf[i] = (Math.random() * 256) | 0; });
  let s = '';
  for (let i = 0; i < len; i++) s += abc[buf[i] % abc.length];
  return s;
}

/**
 * Upsert the trade project (owner = auth user via the column default).
 * Stores the row id back on trade.cloudId so later saves update in place.
 */
export async function saveTradeProject(trade) {
  const token = await authed();
  // ADOPT-BY-NAME: the cloudId only lives in this browser's autosave — if that
  // was lost (cleared storage, new device, mid-update reload) a plain save
  // would quietly create a DUPLICATE project. So with no id in hand, look for
  // the newest existing project with the same name and update THAT row —
  // "Save project" always means "save THIS project", never "save a copy".
  if (!trade.cloudId) {
    try {
      const existing = await listTradeProjects();
      const name = trade.project || 'Untitled project';
      const match = (existing || []).find((r) => (r.name || 'Untitled project') === name);
      if (match) trade.cloudId = match.id;   // list is newest-first
    } catch { /* offline / listing failed — fall through to insert */ }
  }
  const body = JSON.stringify({
    name: trade.project || 'Untitled project',
    data: trade,
    updated_at: new Date().toISOString(),
  });
  if (trade.cloudId) {
    const res = await fetch(rest(`trade_projects?id=eq.${encodeURIComponent(trade.cloudId)}`), {
      method: 'PATCH', headers: headers(token, { Prefer: 'return=representation' }), body,
    });
    const rows = await parse(res);
    if (Array.isArray(rows) && rows.length) return rows[0];
    delete trade.cloudId;               // row gone (deleted elsewhere) → insert fresh
  }
  const res = await fetch(rest('trade_projects'), {
    method: 'POST', headers: headers(token, { Prefer: 'return=representation' }), body,
  });
  const rows = await parse(res);
  const row = Array.isArray(rows) ? rows[0] : rows;
  trade.cloudId = row.id;
  if (row.share_token) trade.shareToken = row.share_token;
  return row;
}

export async function listTradeProjects() {
  const token = await authed();
  const res = await fetch(rest('trade_projects?select=id,name,share_token,updated_at&order=updated_at.desc'), {
    headers: headers(token),
  });
  return (await parse(res)) || [];
}

export async function loadTradeProject(id) {
  const token = await authed();
  const res = await fetch(rest(`trade_projects?id=eq.${encodeURIComponent(id)}&select=id,name,data,share_token`), {
    headers: headers(token),
  });
  const rows = await parse(res);
  return (Array.isArray(rows) && rows[0]) || null;
}

export async function deleteTradeProject(id) {
  const token = await authed();
  const res = await fetch(rest(`trade_projects?id=eq.${encodeURIComponent(id)}`), {
    method: 'DELETE', headers: headers(token),
  });
  await parse(res);
}

/** Make sure the saved project has a share token; returns it. */
export async function ensureShareToken(trade) {
  if (trade.shareToken) return trade.shareToken;
  if (!trade.cloudId) throw new Error('Save the project first');
  const token = await authed();
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = genShareToken();
    const res = await fetch(rest(`trade_projects?id=eq.${encodeURIComponent(trade.cloudId)}`), {
      method: 'PATCH', headers: headers(token, { Prefer: 'return=representation' }),
      body: JSON.stringify({ share_token: candidate }),
    });
    if (res.status === 409) continue;   // one-in-a-quintillion collision — remint
    const rows = await parse(res);
    const row = Array.isArray(rows) ? rows[0] : rows;
    trade.shareToken = (row && row.share_token) || candidate;
    return trade.shareToken;
  }
  throw new Error('Could not mint a share token');
}

/**
 * Read a shared project by its token — anon key only, no sign-in. Goes through
 * the SECURITY DEFINER get_shared_project() function, so a viewer can read
 * exactly one project and only with the exact token. Returns the trade data
 * (jsonb) or null when the token doesn't match anything.
 */
export async function fetchSharedProject(token) {
  if (!cloudEnabled()) throw new Error('Cloud not configured');
  const res = await fetch(rest('rpc/get_shared_project'), {
    method: 'POST', headers: headers(null), body: JSON.stringify({ tok: String(token || '') }),
  });
  return (await parse(res)) || null;
}

// ---- real orders (table: trade_orders — see SUPABASE_ORDERS.sql) ----------

/**
 * Place a real order: POST the snapshot from buildOrderSnapshot(). If the
 * client-minted order number collides with an existing one (unique index →
 * 409), a fresh number is minted and the insert retried. Returns the row;
 * snapshot.orderNo is updated to whatever number actually stuck.
 */
export async function placeOrder(snapshot) {
  const token = await authed();
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(rest('trade_orders'), {
      method: 'POST', headers: headers(token, { Prefer: 'return=representation' }),
      body: JSON.stringify({
        order_no: snapshot.orderNo,
        project: snapshot.project || 'Untitled project',
        data: snapshot,
        placed_at: snapshot.placedAt || new Date().toISOString(),
      }),
    });
    if (res.status === 409) { snapshot.orderNo = genOrderNo(); continue; }
    const rows = await parse(res);
    return Array.isArray(rows) ? rows[0] : rows;
  }
  throw new Error('Could not mint a unique order number');
}

/** The signed-in user's orders, newest first (RLS scopes to owner). */
export async function listOrders() {
  const token = await authed();
  const res = await fetch(rest('trade_orders?select=id,order_no,project,status,phase_status,placed_at,data&order=placed_at.desc'), {
    headers: headers(token),
  });
  return (await parse(res)) || [];
}

export async function getOrder(id) {
  const token = await authed();
  const res = await fetch(rest(`trade_orders?id=eq.${encodeURIComponent(id)}&select=id,order_no,project,status,phase_status,placed_at,data`), {
    headers: headers(token),
  });
  const rows = await parse(res);
  return (Array.isArray(rows) && rows[0]) || null;
}

/** Owner cancels — only allowed while the order is still 'submitted'. */
export async function cancelOrder(id) {
  const token = await authed();
  const res = await fetch(rest('rpc/cancel_order'), {
    method: 'POST', headers: headers(token),
    body: JSON.stringify({ order_id: id }),
  });
  await parse(res);
  return true;
}

/**
 * PL/NTH-only: move an order (and/or its phases) through the pipeline.
 * `status` or `phaseStatus` may be null to leave that side untouched.
 */
export async function adminSetStatus(id, status, phaseStatus = null) {
  const token = await authed();
  const res = await fetch(rest('rpc/set_order_status'), {
    method: 'POST', headers: headers(token),
    body: JSON.stringify({ order_id: id, new_status: status || null, phase: phaseStatus || null }),
  });
  await parse(res);
  return true;
}

/** True when the signed-in user is in admin_users. Any failure → false. */
export async function isOrderAdmin() {
  try {
    const token = await authed();
    const res = await fetch(rest('rpc/is_order_admin'), {
      method: 'POST', headers: headers(token), body: '{}',
    });
    return (await parse(res)) === true;
  } catch { return false; }
}

// ---- docs hub (table: order_documents — see SUPABASE_DOCS.sql) -------------
// The table has RLS on with no policies, so both calls go through SECURITY
// DEFINER functions that allow the order's owner and PL/NTH admins only.

/**
 * Log that a document was issued (regenerated) for an order. `kind` must be
 * one of DOC_KINDS in orders.js (matches the table's check constraint).
 * Returns the new row's id.
 */
export async function logOrderDoc(orderId, kind, label = null, rev = null) {
  const token = await authed();
  const res = await fetch(rest('rpc/log_order_doc'), {
    method: 'POST', headers: headers(token),
    body: JSON.stringify({ order_id: orderId, kind, label, rev }),
  });
  return await parse(res);
}

/** The order's issued-document log, newest first. */
export async function listOrderDocs(orderId) {
  const token = await authed();
  const res = await fetch(rest('rpc/list_order_docs'), {
    method: 'POST', headers: headers(token),
    body: JSON.stringify({ order_id: orderId }),
  });
  return (await parse(res)) || [];
}

/**
 * Record a spec approval from a share-link viewer into the existing leads
 * table (columns: name, email, zip, source, design). No sign-in needed.
 */
export async function submitApproval({ name, email, project, revs }) {
  if (!cloudEnabled()) throw new Error('Cloud not configured');
  const design = {
    kind: 'trade-approval',
    project: project || 'Untitled project',
    revs: revs || '',
    date: new Date().toISOString(),
  };
  const post = (designValue) => fetch(rest('leads'), {
    method: 'POST', headers: headers(null),
    body: JSON.stringify({ name, email, zip: '', source: 'trade-approval', design: designValue }),
  });
  let res = await post(design);
  if (!res.ok) res = await post(JSON.stringify(design));   // design column may be text
  await parse(res);
  return true;
}
