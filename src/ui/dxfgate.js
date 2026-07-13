// dxfgate.js — every DXF download asks for an email first (trade lead capture).
// Remembered in localStorage after the first time; signed-in users pass straight
// through using their account email. The lead lands in Supabase dxf_leads,
// falling back to contact_messages if that table is missing.
import { currentUser } from '../core/cloud.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, cloudEnabled } from '../core/config.js';

const KEY = 'plinthDxfEmail';

async function recordLead(email, source) {
  if (!cloudEnabled()) return;
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Prefer: 'return=minimal',
  };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/dxf_leads`, {
      method: 'POST', headers, body: JSON.stringify({ email, source }),
    });
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/contact_messages`, {
        method: 'POST', headers,
        body: JSON.stringify({ email, person_type: 'DXF lead', message: `DXF download (${source})`, page: 'planner' }),
      });
    } catch { /* offline; the gate itself still held */ }
  }
}

/** Resolves true once we have an email for this visitor; false if they bail. */
export async function ensureDxfEmail(source = 'dxf') {
  if (localStorage.getItem(KEY)) return true;
  try {
    const u = await currentUser();
    if (u && u.email) { localStorage.setItem(KEY, u.email); recordLead(u.email, `${source}:account`); return true; }
  } catch { /* not signed in */ }
  return new Promise((resolve) => {
    let el = document.getElementById('dxfGate');
    if (!el) { el = document.createElement('div'); el.id = 'dxfGate'; document.body.appendChild(el); }
    el.innerHTML = `<div class="cloud-card dlg-card" role="dialog" aria-label="Get the DXF files">
      <h3>Get the DXF files.</h3>
      <p class="cloud-sub">Leave your email and the download starts right away.</p>
      <input type="email" id="dxfGateEmail" placeholder="Your email" autocomplete="email">
      <p class="gate-err" id="dxfGateErr"></p>
      <div class="dlg-btns">
        <button class="dlg-cancel" data-act="cancel">Not now</button>
        <button class="cta" data-act="go">Download</button>
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
