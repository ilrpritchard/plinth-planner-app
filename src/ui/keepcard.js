// keepcard.js — the "Keep this layout?" card. A quiet card at the top-left of the
// stage, never a modal: planner entry stays open (her funnel decision, July 2026)
// and an email is only asked for when something is taken away. Here the take-away
// is a link to this kitchen that opens on any device.
//
// EMAIL ONLY by design (an account form loses most people at the password). The
// link is a SNAPSHOT, so a second line offers an account for anyone who wants to
// keep editing the same saved kitchen. The planner cannot email customers yet
// (Resend delivers to the owner only until plinthmade.com is verified), so the
// link is SHOWN with a Copy button and the copy never promises an email.

import { capturedEmail, captureEmail, looksLikeEmail } from './dxfgate.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** opts: { getLink: async () => url, onAccount?: () => void, onClose?: () => void } */
export function showKeepCard({ getLink, onAccount, onClose }) {
  document.getElementById('keepCard')?.remove();
  const known = capturedEmail();
  const el = document.createElement('aside');
  el.id = 'keepCard'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Keep this layout?');
  el.innerHTML = `
    <button type="button" class="kc-x" data-act="close" aria-label="Not now">×</button>
    <h3>Keep this layout?</h3>
    <p class="kc-sub">${known
      ? 'Save it to a link you can open on any device. We will use the email you gave us.'
      : 'Leave your email and we will save it to a link you can open on any device.'}</p>
    ${known ? '' : '<input type="email" class="kc-email" placeholder="you@email.com" autocomplete="email" aria-label="Your email">'}
    <p class="kc-err" role="alert"></p>
    <div class="kc-btns">
      <button type="button" class="cta" data-act="save">Save my layout</button>
      <button type="button" class="kc-later" data-act="close">Not now</button>
    </div>
    ${onAccount ? '<p class="kc-acct">Want to keep editing the same saved kitchen? <button type="button" class="linkish" data-act="account">Create an account</button></p>' : ''}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 220); onClose?.(); };
  const err = el.querySelector('.kc-err');

  async function save() {
    const input = el.querySelector('.kc-email');
    const email = known || (input ? input.value.trim() : '');
    if (!looksLikeEmail(email)) { err.textContent = 'That email does not look right.'; input?.focus(); return; }
    const btn = el.querySelector('[data-act="save"]');
    btn.disabled = true; btn.textContent = 'Saving…';
    let url = '';
    try { url = await getLink(); } catch { url = ''; }
    if (!url) { btn.disabled = false; btn.textContent = 'Save my layout'; err.textContent = 'Could not make the link just now. Try again in a moment.'; return; }
    // the lead carries the short code when there is one, so the kitchen can be opened from the lead
    const code = (url.match(/[?&]s=([a-z0-9]+)/) || [])[1];
    captureEmail(email, code ? `keep-layout:${code}` : 'keep-layout');
    el.innerHTML = `
      <button type="button" class="kc-x" data-act="close" aria-label="Close">×</button>
      <h3>Saved.</h3>
      <p class="kc-sub">Here is your link. Open it anywhere to pick up where you left off.</p>
      <input type="text" class="kc-link" readonly value="${esc(url)}" aria-label="Your link">
      <div class="kc-btns">
        <button type="button" class="cta" data-act="copy">Copy link</button>
        <button type="button" class="kc-later" data-act="close">Done</button>
      </div>
      <p class="kc-acct">It is a snapshot of the kitchen as it is now. After big changes, Copy share link (bottom right) makes a new one.</p>`;
    el.querySelector('.kc-link').addEventListener('focus', (e) => e.target.select());
  }

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'save') save();
    else if (act === 'account') { close(); onAccount?.(); }
    else if (act === 'copy') {
      const link = el.querySelector('.kc-link'), btn = e.target.closest('button');
      try { await navigator.clipboard.writeText(link.value); btn.textContent = 'Copied'; }
      catch { link.focus(); link.select(); btn.textContent = 'Press ⌘C / Ctrl C'; }
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList?.contains('kc-email')) { e.preventDefault(); save(); }
    if (e.key === 'Escape') close();
  });
  return { close };
}
