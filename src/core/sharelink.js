// sharelink.js — very short share links:  …/?s=k7m2xq9  (SUPABASE_SHARE.sql).
//
// The server stores exactly the compact design text the self-contained #k= link
// already carries (core/persistence.js encodeDesign): no customer details, no
// project. Everything here DEGRADES: cloud off, the SQL not run yet, offline, a
// slow network → shortShareURL() hands back the ordinary #k= link instead, so
// "Copy share link" always gives a link that works.

import { SUPABASE_URL, SUPABASE_ANON_KEY, cloudEnabled } from './config.js';
import { encodeDesign, decodeDesign, buildShareURL } from './persistence.js';

const TIMEOUT_MS = 4000;
export const SHORT_CODE = /^[a-z0-9]{5,12}$/;

async function rpc(fn, body) {
  if (!cloudEnabled() || typeof fetch !== 'function') return null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', signal: ctl?.signal,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;                               // 404 = the SQL has not been run yet
    const out = await res.json();
    return typeof out === 'string' ? out : null;
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
}

/** The shortest link that works right now: ?s=code when the server took it, else #k=… */
export async function shortShareURL(store) {
  const code = await rpc('share_design', { p_design: encodeDesign(store.serialize()) });
  if (code && SHORT_CODE.test(code)) return `${location.origin}${location.pathname}?s=${code}`;
  return buildShareURL(store);
}

/** ?s=code → a state object store.replace() accepts, or null (unknown code / offline). */
export async function fetchShortDesign(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!SHORT_CODE.test(c)) return null;
  const design = await rpc('get_shared_design', { p_code: c });
  return design ? decodeDesign(design) : null;
}
