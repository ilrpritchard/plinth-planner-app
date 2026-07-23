// dxfgate.js — the planner's one email gate. Every take-away action (DXF/PDF/
// SVG downloads, share links, trade-workspace entry) asks for an email the
// FIRST time only: the address is remembered in localStorage, and signed-in
// users pass straight through on their account email. The lead lands in
// Supabase dxf_leads (source says which gate), falling back to
// contact_messages if that table is missing.
import { currentUser } from '../core/cloud.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, cloudEnabled } from '../core/config.js';

const KEY = 'plinthDxfEmail';

/** The email this visitor has already left at any gate ('' if none yet). */
export function capturedEmail() {
  return localStorage.getItem(KEY) || '';
}

// main.js registers a provider so every recorded lead carries what the visitor
// was designing (design_value/cabinets/zip/mode) — a lead that reads
// "$28,400 L-shape, 12550" instead of a bare address.
let leadContext = null;
export function setLeadContext(fn) { leadContext = fn; }

async function recordLead(email, source) {
  if (!cloudEnabled()) return;
  let ctx = {};
  try { ctx = leadContext ? (leadContext() || {}) : {}; } catch { /* lead still records */ }
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Prefer: 'return=minimal',
  };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/dxf_leads`, {
      method: 'POST', headers, body: JSON.stringify({ email, source, ...ctx }),
    });
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/contact_messages`, {
        method: 'POST', headers,
        body: JSON.stringify({ email, person_type: 'Planner lead', message: `Email gate (${source})`, page: 'planner' }),
      });
    } catch { /* offline; the gate itself still held */ }
  }
}

/**
 * Resolves true once we have an email for this visitor; false if they bail.
 * copy = { title, sub, cta } tailors the card to the action being gated.
 */
export async function ensureEmailGate(source, copy = {}) {
  const { title = 'Almost there.', sub = 'Leave your email and you can carry on right away.', cta = 'Continue' } = copy;
  if (localStorage.getItem(KEY)) return true;
  try {
    const u = await currentUser();
    if (u && u.email) { localStorage.setItem(KEY, u.email); recordLead(u.email, `${source}:account`); return true; }
  } catch { /* not signed in */ }
  return new Promise((resolve) => {
    let el = document.getElementById('dxfGate');
    if (!el) { el = document.createElement('div'); el.id = 'dxfGate'; document.body.appendChild(el); }
    el.innerHTML = `<div class="cloud-card dlg-card" role="dialog" aria-label="${title}">
      <h3>${title}</h3>
      <p class="cloud-sub">${sub}</p>
      <input type="email" id="dxfGateEmail" placeholder="Your email" autocomplete="email">
      <p class="gate-err" id="dxfGateErr"></p>
      <div class="dlg-btns">
        <button class="dlg-cancel" data-act="cancel">Not now</button>
        <button class="cta" data-act="go">${cta}</button>
      </div>
    </div>`;
    el.classList.add('show');
    const input = el.querySelector('#dxfGateEmail');
    const err = el.querySelector('#dxfGateErr');
    const done = (ok) => { el.classList.remove('show'); el.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(ok); };
    const submit = () => {
      const email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'That email does not look right.'; input.focus(); return; }
      localStorage.setItem(KEY, email);
      recordLead(email, source);
      done(true);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
      if (e.key === 'Enter') { e.stopPropagation(); submit(); }
    };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', (e) => { if (e.target === el) done(false); }, { once: true });
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
    el.querySelector('[data-act="go"]').addEventListener('click', submit);
    input.focus();
  });
}

/** Resolves true once we have an email for this visitor; false if they bail. */
export function ensureDxfEmail(source = 'dxf') {
  return ensureEmailGate(source, {
    title: 'Get the DXF files.',
    sub: 'Leave your email and the download starts right away.',
    cta: 'Download',
  });
}
