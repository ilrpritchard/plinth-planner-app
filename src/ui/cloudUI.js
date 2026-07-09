// cloudUI.js — account modal (email sign in/up) + save/open designs to the
// cloud. Only active when Supabase is configured (src/core/config.js).

import {
  isCloud, signUp, signIn, signOut, currentUser, onAuthChange,
  saveDesign, listDesigns, loadDesign, deleteDesign,
} from '../core/cloud.js';

export class CloudUI {
  constructor({ store, onLoaded }) {
    this.store = store;
    this.onLoaded = onLoaded || (() => {});
    this.user = null;
    this.btn = document.getElementById('btnAccount');
    this.modal = document.getElementById('cloudModal');
    if (!isCloud() || !this.btn || !this.modal) { if (this.btn) this.btn.style.display = 'none'; return; }

    this.btn.addEventListener('click', () => this.open());
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.close(); });
    onAuthChange((u) => { this.user = u; this._syncBtn(); });
    currentUser().then((u) => { this.user = u; this._syncBtn(); });
  }

  _syncBtn() { if (this.btn) this.btn.textContent = this.user ? 'My designs' : 'Sign in'; }
  open() { this.modal.classList.add('show'); this.render(); }
  close() { this.modal.classList.remove('show'); }

  async render() {
    this.modal.innerHTML = `<div class="cloud-card">${this.user ? this._loggedInHTML() : this._authHTML()}
      <button class="cloud-x" id="cloudClose">×</button></div>`;
    this.modal.querySelector('#cloudClose').addEventListener('click', () => this.close());
    if (this.user) this._wireLoggedIn(); else this._wireAuth();
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
    }));
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
          await signUp(email, pw, meta);
          // prefill the order details from what they entered
          this.store.setCustomer({ name: meta.full_name, email });
          msg('Account created — check your email if confirmation is on, then sign in.', true);
        } else { await signIn(email, pw); this.user = await currentUser(); this._syncBtn(); this.render(); }
      } catch (err) { msg(err.message || 'Something went wrong'); }
    });
  }

  // ----- signed in -----
  _loggedInHTML() {
    return `<h3>My designs</h3>
      <p class="cloud-sub">Signed in as ${esc(this.user.email)} · <button class="linkbtn" id="signOut">sign out</button></p>
      <div class="cloud-save">
        <input id="saveName" placeholder="Design name (e.g. Smith kitchen)">
        <button class="cta" id="saveBtn">Save current design</button>
      </div>
      <div class="cloud-list" id="designList"><div class="cloud-msg">Loading…</div></div>`;
  }
  _wireLoggedIn() {
    this.modal.querySelector('#signOut').addEventListener('click', async () => { await signOut(); this.user = null; this._syncBtn(); this.render(); });
    this.modal.querySelector('#saveBtn').addEventListener('click', async () => {
      const name = this.modal.querySelector('#saveName').value.trim() || 'Untitled kitchen';
      try { await saveDesign(name, this.store.serialize()); this._refreshList('Saved ✓'); }
      catch (err) { this._refreshList(err.message, true); }
    });
    this._refreshList();
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
          if (confirm('Delete this design?')) { await deleteDesign(id); this._refreshList('Deleted'); }
        });
      });
    } catch (err) { el.innerHTML = `<div class="cloud-msg err">${esc(err.message)}</div>`; }
  }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
