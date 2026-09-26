// cloudUI.js — account modal (email sign in/up) + save/open designs to the
// cloud. Only active when Supabase is configured (src/core/config.js).

import {
  isCloud, signUp, signIn, signOut, currentUser, onAuthChange, onPasswordRecovery,
  resetPassword, updatePassword,
  saveDesign, listDesigns, loadDesign, deleteDesign,
} from '../core/cloud.js';
import { uiConfirm } from './dialog.js';
import { loadPreviews, whenAgo, forgetPreview } from './preview.js';

export class CloudUI {
  constructor({ store, onLoaded, onSaved }) {
    this.store = store;
    this.onSaved = onSaved || null;
    // the design that is OPEN from My designs (id + name): Save writes it in place, and the
    // autosave keeps it current (her ask 2026-09-22: "it needs to autosave every few mins")
    this.currentId = null; this.currentName = null;
    this._lastSaved = null;                 // JSON of the state as last written to the account
    this._saving = false;
    // the open design survives a reload (her catch 2026-09-22: Save asked her to name Evie's
    // Kitchen again, because the link to it was lost when the page reloaded)
    try { const j = JSON.parse(localStorage.getItem('plnr-current-design') || 'null'); if (j && j.id) { this.currentId = j.id; this.currentName = j.name || null; } } catch { /* private mode */ }
    // a NEW state on screen (a shared link, a project unit, Clear) means no design is open any
    // more. An UNDO or REDO is not that: it replays the same kitchen and fires the same 'load'
    // (hist: true), and used to drop the open design, so the next autosave and the next Save went
    // to "Autosave" instead of her file (her catch 2026-09-26: "it just saves autosave").
    store.subscribe((s, c) => { if ((c.type === 'load' && !c.hist && !this._opening) || c.type === 'reset') this._setCurrent(null, null); });
    this._startAutosave();
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
        if (this.user) { this.open(); this._note = 'Email confirmed. Welcome to PL/NTH.'; this.render(); }
      }, 900);
    }
  }

  _syncBtn() {
    if (this.btn) this.btn.textContent = this.user ? 'My designs' : 'Sign in';
    // Orders lives in the top bar for anyone signed in, in BOTH modes: from Kitchen mode
    // there was no way back to an order (her catch: "I accidentally clicked and can't get back")
    const ob = document.getElementById('btnOrders');
    if (ob) ob.style.display = this.user ? '' : 'none';
  }
  open() { this.modal.classList.add('show'); this.render(); }
  /** Open the sign-in modal saying WHY (the Photo button: "sign in to save photos"); the pitch
   *  shows once, on the signed-out card, then the modal reads as usual. */
  openFor(pitch) { this._pitch = pitch || null; this.open(); }
  close() { this.modal.classList.remove('show'); this.view = null; this._pitch = null; }
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
    const pitch = this._pitch; this._pitch = null;
    return `<h3>${pitch?.title ? esc(pitch.title) : trade ? 'Sign in to PL/NTH' : 'Save this layout'}</h3>
      <p class="cloud-sub">${pitch?.sub ? esc(pitch.sub) : trade
        ? 'Sign in or create an account to save projects, share specs for approval and track quotes and orders.'
        : 'Create an account or sign in to save and reopen layouts.'}</p>
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
        msg(`Reset link sent to ${email}. Open it on this device and you can choose a new password.`, true);
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
            msg(`Almost there: we've emailed a confirmation link to ${email}. Tap it, then come back and sign in.`, true);
          }
        } else { await signIn(email, pw); this.user = await currentUser(); this._syncBtn(); this.render(); }
      } catch (err) { msg(err.message || 'Something went wrong'); }
    });
  }

  // ----- choose a new password (arrived from the reset email) -----
  _resetHTML() {
    return `<h3>Choose a new password</h3>
      <p class="cloud-sub">You followed a reset link. Set a new password below and you'll be signed straight in.</p>
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
        this._note = 'Password updated. You\'re signed in.';
        this.render();
      } catch (err) { msg(err.message || 'Could not update the password'); }
    });
  }

  // ----- signed in -----
  _loggedInHTML() {
    return `<h3>My designs</h3>
      <p class="cloud-sub">Signed in as ${esc(this.user.email)}</p>
      <div class="cloud-save">
        <input id="saveName" placeholder="Design name (e.g. Smith kitchen)" value="${esc(this.currentName && this.currentName !== 'Autosave' ? this.currentName : '')}">
        <button class="cta" id="saveBtn">${this.currentId && this.currentName !== 'Autosave' ? 'Save' : 'Save current design'}</button>
      </div>
      <div class="cloud-list" id="designList"><div class="cloud-msg">Loading…</div></div>
      <div class="cloud-foot" style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;gap:10px">
        ${document.getElementById('designBanner') ? '<span></span>' : '<button type="button" class="ghost sm" id="newDesign" title="Takes every cabinet off the plan so you can start again. The room and the finish stay">+ New design</button>'}
        <button type="button" class="ghost sm" id="signOut">Sign out</button>
      </div>`;
  }
  _wireLoggedIn() {
    this.modal.querySelector('#signOut').addEventListener('click', async () => { await signOut(); this.user = null; this._syncBtn(); this.render(); });
    this.modal.querySelector('#saveBtn').addEventListener('click', async () => {
      const typed = this.modal.querySelector('#saveName').value.trim();
      const name = typed || this.currentName || 'Untitled kitchen';
      try {
        // the same name as the design that is open: write it in place, never a second copy.
        // Naming the Autosave RENAMES it in place, so no stale 'Autosave' is left behind.
        const inPlace = this.currentId && (name === this.currentName || this.currentName === 'Autosave');
        const row = await saveDesign(name, this.store.serialize(), inPlace ? this.currentId : null);
        this._setCurrent(row.id, row.name); this._lastSaved = JSON.stringify(this.store.serialize()); forgetPreview(row.id);
        this._note2(`Saved ${this._clock()}`);
        this._refreshList(inPlace ? 'Saved ✓ (updated in place)' : 'Saved ✓');
      } catch (err) { this._refreshList(err.message, true); }
    });
    // start again from an empty room (her ask 2026-09-21); undo brings the kitchen back
    this.modal.querySelector('#newDesign')?.addEventListener('click', async () => {
      const has = (this.store.state.items || []).length > 0;
      if (has && !(await uiConfirm('The kitchen on screen comes off the plan. Save it first if you want to keep it. The room and the finish stay, and Undo brings it back.', { title: 'Start a new design?', confirmLabel: 'Start new' }))) return;
      if (has) this.store.clear();
      this._setCurrent(null, null); this._lastSaved = null; this._note2('');
      this.onLoaded(); this.close();
    });
    this._refreshList(this._note);
    this._note = null;
  }
  _setCurrent(id, name) {
    this.currentId = id; this.currentName = name;
    try { if (id) localStorage.setItem('plnr-current-design', JSON.stringify({ id, name })); else localStorage.removeItem('plnr-current-design'); } catch { /* private mode */ }
  }
  /** The SAVE button: the open design is written in place, no questions asked; only a design
   *  that has never been saved (or is only the Autosave) asks for a name. */
  async quickSave() {
    if (!this.user) { this.open(); return; }
    if (!this.currentId || this.currentName === 'Autosave') { this._note = null; this.open(); setTimeout(() => this.modal.querySelector('#saveName')?.focus(), 50); return; }
    try {
      const row = await saveDesign(this.currentName, this.store.serialize(), this.currentId);
      this._setCurrent(row.id, row.name); this._lastSaved = JSON.stringify(this.store.serialize());
      this._note2(`Saved ${this._clock()}`);
      this.onSaved?.(`Saved to ${row.name}.`);
    } catch (err) { this._note = err.message; this.open(); }
  }
  _clock() { return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  _note2(text) { const el = document.getElementById('saveNote'); if (el) el.textContent = text; }

  /** AUTOSAVE to the account, every two minutes and when the tab is hidden, whenever the
   *  design has changed since it was last written. The open design is updated in place;
   *  work that was never saved goes to a design called "Autosave", one per account,
   *  updated in place too, so nothing done while signed in is ever lost. */
  _startAutosave() {
    const tick = () => { this.autosave().catch(() => { /* offline: the local autosave still has it */ }); };
    setInterval(tick, 2 * 60e3);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tick(); });
  }
  async autosave() {
    if (!this.user || this._saving || !isCloud()) return false;
    const st = this.store.serialize();
    if (!(st.items || []).length && !this.currentId) return false;         // an empty room is not worth a design
    const json = JSON.stringify(st);
    if (json === this._lastSaved) return false;
    this._saving = true;
    try {
      let id = this.currentId, name = this.currentName;
      if (!id) {
        name = 'Autosave';
        const rows = await listDesigns();
        id = (rows.find((r) => r.name === 'Autosave') || {}).id || null;
      }
      const row = await saveDesign(name, st, id);
      if (!this.currentId) this._setCurrent(row.id, row.name);
      this._lastSaved = json;
      this._note2(`${name === 'Autosave' ? 'Autosaved' : 'Saved'} ${this._clock()}`);
      return true;
    } finally { this._saving = false; }
  }

  async _refreshList(note, isErr) {
    const el = this.modal.querySelector('#designList'); if (!el) return;
    try {
      const rows = await listDesigns();
      el.innerHTML = (note ? `<div class="cloud-msg ${isErr ? 'err' : 'ok'}">${esc(note)}</div>` : '') +
        (rows.length ? rows.map((r) => `<div class="design-row" data-id="${r.id}">
          <span class="pv-thumb" data-pv="${r.id}"></span>
          <span class="pv-text"><span class="pv-name">${esc(r.name || 'Untitled')}</span> <em>${r.mode === 'trade' ? '· trade' : ''}${r.id === this.currentId ? ' · open now' : ''}</em><br><em>${esc(whenAgo(r.updated_at))}</em> <em class="pv-cap" data-pvcap="${r.id}"></em></span>
          <span><button class="linkbtn" data-act="open">Open</button> <button class="linkbtn danger" data-act="del">Delete</button></span>
        </div>`).join('') : '<div class="cloud-msg">No saved designs yet.</div>');
      // the thumbnails arrive one by one behind the list, so the names show at once
      loadPreviews(el, rows.map((r) => r.id), loadDesign, (st) => { const n = ((st && st.items) || []).length; return n ? `· ${n} item${n === 1 ? '' : 's'}` : ''; });
      el.querySelectorAll('.design-row').forEach((row) => {
        const id = row.dataset.id;
        row.querySelector('[data-act="open"]').addEventListener('click', async () => {
          const data = await loadDesign(id);
          this._opening = true;
          try { if (data && this.store.replace(data)) { this._setCurrent(id, (rows.find((r) => r.id === id) || {}).name || null); this._lastSaved = JSON.stringify(this.store.serialize()); this._note2(''); this.onLoaded(); this.close(); } }
          finally { this._opening = false; }
        });
        row.querySelector('[data-act="del"]').addEventListener('click', async () => {
          const name = row.querySelector('.pv-name')?.textContent?.trim() || 'this design';
          if (await uiConfirm(`"${name}" will be gone for good.`, {
            title: 'Delete this design?', confirmLabel: 'Delete', danger: true,
          })) { await deleteDesign(id); forgetPreview(id); if (id === this.currentId) { this._setCurrent(null, null); this._lastSaved = null; this._note2(''); } this._refreshList('Deleted'); }
        });
      });
    } catch (err) { el.innerHTML = `<div class="cloud-msg err">${esc(err.message)}</div>`; }
  }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
