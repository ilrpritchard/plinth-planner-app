// cloudUI.js — account modal (email sign in/up) + save/open designs to the
// cloud. Only active when Supabase is configured (src/core/config.js).

import {
  isCloud, signUp, signIn, signOut, currentUser, onAuthChange, onPasswordRecovery,
  resetPassword, updatePassword,
  saveDesign, listDesigns, loadDesign, deleteDesign,
} from '../core/cloud.js';
import { uiConfirm } from './dialog.js';

export class CloudUI {
  constructor({ store, onLoaded }) {
    this.store = store;
    this.onLoaded = onLoaded || (() => {});
    this.user = null;
    this.view = null;            // null | 'reset' — 'reset' = choose-a-new-password
    this.btn = document.getElementById('btnAccount');
    this.modal = document.getElementById('cloudModal');
    if (!isCloud() || !this.btn || !this.modal) { if (this.btn) this.btn.style.display = 'none'; return; }

    this.btn.addEventListener('click', () => this.open());
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.close(); });
    onAuthChange((u) => { this.user = u; this._syncBtn(); });
    currentUser().then((u) => { this.user = u; this._syncBtn(); });
    // arrived from a password-reset email → collect the new password
    onPasswordRecovery(() => this.openReset());
    if (/type=recovery/.test(location.hash)) setTimeout(() => this.openReset(), 900);
    // arrived from a sign-up confirmation email → welcome them in
    if (/type=signup/.test(location.hash)) {
      setTimeout(async () => {
        this.user = await currentUser();
        this._syncBtn();
        if (this.user) { this.open(); this._note = 'Email confirmed — welcome to PL/NTH.'; this.render(); }
      }, 900);
    }
  }

  _syncBtn() { if (this.btn) this.btn.textContent = this.user ? 'My designs' : 'Sign in'; }
  open() { this.modal.classList.add('show'); this.render(); }
  close() { this.modal.classList.remove('show'); this.view = null; }
  openReset() {
    if (this.view === 'reset') return;
    this.view = 'reset';
    this.modal.classList.add('show');
    this.render();
  }

  async render() {
    const body = this.view === 'reset' ? this._resetHTML()
      : this.user ? this._loggedInHTML() : this._authHTML();
    this.modal.innerHTML = `<div class="cloud-card">${body}
      <button class="cloud-x" id="cloudClose">×</button></div>`;
    this.modal.querySelector('#cloudClose').addEventListener('click', () => this.close());
    if (this.view === 'reset') this._wireReset();
    else if (this.user) this._wireLoggedIn();
    else this._wireAuth();
  }

  // ----- signed out -----
  _authHTML() {
    // same account either way — but the pitch matches who's reading it
    const trade = this.store.state.mode === 'trade';
    return `<h3>${trade ? 'Sign in to PL/NTH' : 'Save your kitchen'}</h3>
      <p class="cloud-sub">${trade
        ? 'Sign in or create an account to save trade projects, share specs for approval and track orders.'
        : 'Create an account or sign in to save and reopen your designs.'}</p>
      <div class="cloud-tabs"><button data-tab="in" class="active">Sign in</button><button data-tab="up">Create account</button></div>
      <form id="authForm">
        <div class="signup-only" style="display:none">
          <label>Full name<input id="suName" autocomplete="name"></label>
          <label>Delivery address<input id="suDelivery" autocomplete="shipping street-address" placeholder="Street, city, state, ZIP"></label>
          <label>Billing address <span style="text-transform:none;color:var(--dim)">(if different)</span><input id="suBilling" autocomplete="billing street-address" placeholder="Optional"></label>
        </div>
        <label>Email<input id="authEmail" type="email" required autocomplete="email"></label>
        <label>Password<input id="authPw" type="password" required minlength="6" autocomplete="current-password"></label>
        <button class="cta" id="authSubmit" type="submit">Sign in</button>
        <div class="cloud-foot signin-only"><button type="button" class="linkbtn" id="forgotPw">Forgot your password?</button></div>
        <div class="cloud-msg" id="authMsg"></div>
      </form>`;
  }
  _wireAuth() {
    let mode = 'in';
    const msg = (t, ok) => { const m = this.modal.querySelector('#authMsg'); m.textContent = t; m.className = 'cloud-msg ' + (ok ? 'ok' : 'err'); };
    this.modal.querySelectorAll('.cloud-tabs button').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.tab;
      this.modal.querySelectorAll('.cloud-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      this.modal.querySelector('#authSubmit').textContent = mode === 'in' ? 'Sign in' : 'Create account';
      this.modal.querySelector('.signup-only').style.display = mode === 'up' ? '' : 'none';
      this.modal.querySelector('.signin-only').style.display = mode === 'in' ? '' : 'none';
    }));
    // FORGOT PASSWORD: send the reset email; the link comes back to the
    // planner, where openReset() collects a new password.
    this.modal.querySelector('#forgotPw').addEventListener('click', async () => {
      const email = this.modal.querySelector('#authEmail').value.trim();
      if (!email) { msg('Type your email above first, then tap the link again.'); return; }
      try {
        msg('Sending…');
        await resetPassword(email);
        msg(`Reset link sent to ${email} — open it on this device and you can choose a new password.`, true);
      } catch (err) { msg(err.message || 'Could not send the reset email'); }
    });
    this.modal.querySelector('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = this.modal.querySelector('#authEmail').value.trim();
      const pw = this.modal.querySelector('#authPw').value;
      try {
        msg('Working…');
        if (mode === 'up') {
          const meta = {
            full_name: this.modal.querySelector('#suName').value.trim(),
            delivery_address: this.modal.querySelector('#suDelivery').value.trim(),
            billing_address: this.modal.querySelector('#suBilling').value.trim(),
          };
          const res = await signUp(email, pw, meta);
          // prefill the order details from what they entered
          this.store.setCustomer({ name: meta.full_name, email });
          if (res?.session) {
            // email confirmation is off — they're signed in right away
            this.user = res.session.user; this._syncBtn(); this._note = 'Welcome to PL/NTH.'; this.render();
          } else {
            msg(`Almost there — we've emailed a confirmation link to ${email}. Tap it, then come back and sign in.`, true);
          }
        } else { await signIn(email, pw); this.user = await currentUser(); this._syncBtn(); this.render(); }
      } catch (err) { msg(err.message || 'Something went wrong'); }
    });
  }

  // ----- choose a new password (arrived from the reset email) -----
  _resetHTML() {
    return `<h3>Choose a new password</h3>
      <p class="cloud-sub">You followed a reset link — set a new password below and you'll be signed straight in.</p>
      <form id="resetForm">
        <label>New password<input id="newPw" type="password" required minlength="6" autocomplete="new-password"></label>
        <button class="cta" type="submit">Set new password</button>
        <div class="cloud-msg" id="resetMsg"></div>
      </form>`;
  }
  _wireReset() {
    const msg = (t, ok) => { const m = this.modal.querySelector('#resetMsg'); m.textContent = t; m.className = 'cloud-msg ' + (ok ? 'ok' : 'err'); };
    this.modal.querySelector('#resetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        msg('Saving…');
        await updatePassword(this.modal.querySelector('#newPw').value);
        this.user = await currentUser();
        this.view = null;
        this._syncBtn();
        this._note = 'Password updated — you\'re signed in.';
        this.render();
      } catch (err) { msg(err.message || 'Could not update the password'); }
    });
  }

  // ----- signed in -----
  _loggedInHTML() {
    return `<h3>My designs</h3>
      <p class="cloud-sub">Signed in as ${esc(this.user.email)}</p>
      <div class="cloud-save">
        <input id="saveName" placeholder="Design name (e.g. Smith kitchen)">
        <button class="cta" id="saveBtn">Save current design</button>
      </div>
      <div class="cloud-list" id="designList"><div class="cloud-msg">Loading…</div></div>
      <div class="cloud-foot" style="margin-top:14px;text-align:right">
        <button type="button" class="ghost sm" id="signOut">Sign out</button>
      </div>`;
  }
  _wireLoggedIn() {
    this.modal.querySelector('#signOut').addEventListener('click', async () => { await signOut(); this.user = null; this._syncBtn(); this.render(); });
    this.modal.querySelector('#saveBtn').addEventListener('click', async () => {
      const name = this.modal.querySelector('#saveName').value.trim() || 'Untitled kitchen';
      try { await saveDesign(name, this.store.serialize()); this._refreshList('Saved ✓'); }
      catch (err) { this._refreshList(err.message, true); }
    });
    this._refreshList(this._note);
    this._note = null;
  }
  async _refreshList(note, isErr) {
    const el = this.modal.querySelector('#designList'); if (!el) return;
    try {
      const rows = await listDesigns();
      el.innerHTML = (note ? `<div class="cloud-msg ${isErr ? 'err' : 'ok'}">${esc(note)}</div>` : '') +
        (rows.length ? rows.map((r) => `<div class="design-row" data-id="${r.id}">
          <span>${esc(r.name || 'Untitled')} <em>${r.mode === 'trade' ? '· trade' : ''}</em></span>
          <span><button class="linkbtn" data-act="open">Open</button> <button class="linkbtn danger" data-act="del">Delete</button></span>
        </div>`).join('') : '<div class="cloud-msg">No saved designs yet.</div>');
      el.querySelectorAll('.design-row').forEach((row) => {
        const id = row.dataset.id;
        row.querySelector('[data-act="open"]').addEventListener('click', async () => {
          const data = await loadDesign(id); if (data && this.store.replace(data)) { this.onLoaded(); this.close(); }
        });
        row.querySelector('[data-act="del"]').addEventListener('click', async () => {
          const name = row.querySelector('span')?.textContent?.trim() || 'this design';
          if (await uiConfirm(`"${name}" will be gone for good.`, {
            title: 'Delete this design?', confirmLabel: 'Delete', danger: true,
          })) { await deleteDesign(id); this._refreshList('Deleted'); }
        });
      });
    } catch (err) { el.innerHTML = `<div class="cloud-msg err">${esc(err.message)}</div>`; }
  }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
