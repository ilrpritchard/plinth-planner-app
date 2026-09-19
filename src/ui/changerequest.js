// changerequest.js (ui) — "Request a change" on a placed order: the buyer edits the
// order's own cabinet list in a dialog, sees what it does to the total, and submits
// it to PL/NTH for approval. It never touches the project that happens to be open.

import { getCab, fmtUSD, sellUSD } from '../core/catalogue.js';
import { fmtCents } from '../core/invoice.js';
import { startProposal, buildChangeRequest, CHANGE_LABELS } from '../core/changerequest.js';
import { openCabinetPicker } from './picker.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
const signed = (cents) => `${cents >= 0 ? '+' : '-'}${fmtCents(Math.abs(cents))}`;

/** The order card's list of change requests (newest first) with what each side may do. */
export function changesHTML(changes, admin) {
  if (!changes || !changes.length) return '';
  return `<div class="chg-list">
    <div class="chg-list-h">Changes</div>
    ${[...changes].sort((a, b) => b.seq - a.seq).map((c) => {
      const net = Number(c.model && c.model.totals && c.model.totals.netDeltaCents) || 0;
      const n = ((c.model && c.model.changes) || []).length;
      return `<div class="chg-row" data-cid="${esc(c.id)}">
        <strong>Change ${esc(c.seq)}</strong>
        <span class="chg-meta">requested ${esc(day(c.requested_at))} · ${n} unit type${n === 1 ? '' : 's'} affected · ${esc(signed(net))}</span>
        <span class="status-pill chg-${esc(c.status)}">${esc(CHANGE_LABELS[c.status] || c.status)}</span>
        <button class="ghost sm" data-act="c-view" title="The change order sheet, as requested: print it or save it as a PDF">View</button>
        ${c.status === 'pending' && admin ? `<button class="cta sm" data-act="c-approve">Approve</button><button class="ghost sm" data-act="c-decline">Decline</button>` : ''}
        ${c.status === 'pending' && !admin ? `<button class="ghost sm" data-act="c-withdraw">Withdraw</button>` : ''}
        ${c.buyer_note ? `<div class="chg-note"><span>Buyer</span>${esc(c.buyer_note)}</div>` : ''}
        ${c.reply_note ? `<div class="chg-note"><span>PL/NTH</span>${esc(c.reply_note)}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

/** The editor. onSubmit({seq, proposal, model}, note) must return a promise; a rejection keeps the dialog open. */
export function openChangeEditor({ order, changes, onSubmit }) {
  document.getElementById('tChangeModal')?.remove();
  const proposal = startProposal(order, changes);
  const m = document.createElement('div');
  m.id = 'tChangeModal';
  m.innerHTML = `<div class="cloud-card chg-card" role="dialog" aria-modal="true" aria-label="Request a change">
    <h3>Request a change to ${esc(order.order_no)}</h3>
    <p class="cloud-sub">Set the unit counts and cabinet quantities as they should be. A quantity of 0 removes that cabinet. Nothing changes on the order until PL/NTH approves the request and confirms the price.</p>
    <div class="chg-units" id="chgUnits"></div>
    <div class="chg-sum" id="chgSum"></div>
    <label class="chg-note-l">Note to PL/NTH (optional)<textarea id="chgNote" maxlength="1000" rows="2" placeholder="Reason for the change, anything PL/NTH should know"></textarea></label>
    <div class="cloud-msg" id="chgMsg" role="alert"></div>
    <div class="order-modal-btns">
      <button class="ghost" id="chgCancel">Cancel</button>
      <button class="cta" id="chgSubmit" disabled>Submit for approval</button>
    </div>
    <button class="cloud-x" id="chgClose" aria-label="Close">×</button></div>`;
  document.body.appendChild(m);
  const $ = (id) => m.querySelector('#' + id);
  let built = null;

  const drawUnits = () => {
    $('chgUnits').innerHTML = proposal.units.map((u, ui) => `<section class="chg-unit" data-ui="${ui}">
      <div class="chg-unit-h"><strong>${esc(u.name)}</strong>
        <label>Units<input type="number" min="0" step="1" inputmode="numeric" data-f="units" value="${esc(u.qty)}"></label></div>
      <table class="breakdown"><thead><tr><th>Code</th><th>Description</th><th class="num">Each</th><th class="num">Qty per unit</th></tr></thead>
      <tbody>${u.rows.map((r, ri) => { const c = getCab(r.code); return `<tr data-ri="${ri}"><td>${esc(r.code)}</td><td>${esc(c ? c.desc : '')}</td>
        <td class="num">${c ? fmtUSD(sellUSD(c)) : ''}</td>
        <td class="num"><input type="number" min="0" step="1" inputmode="numeric" data-f="qty" value="${esc(r.qty)}"></td></tr>`; }).join('')}</tbody></table>
      <button class="ghost sm" data-f="add">+ Add a cabinet</button>
    </section>`).join('');
  };
  const drawSum = () => {
    built = buildChangeRequest(order, changes, proposal);
    const ok = built && !built.error;
    $('chgSubmit').disabled = !ok;
    if (!ok) { $('chgSum').innerHTML = `<div class="chg-sum-empty">${esc((built && built.error) || '')}</div>`; return; }
    const t = built.model.totals;
    $('chgSum').innerHTML = `<div class="chg-sum-h">Change ${built.seq}</div>
      <ul>${built.model.changes.map((c) => `<li><strong>${esc(c.name)}</strong>: ${[
        c.oldUnits !== c.newUnits ? `${c.oldUnits} to ${c.newUnits} units` : '',
        ...c.lines.map((l) => `${esc(l.code)} ${l.oldQty} to ${l.newQty} per unit`),
      ].filter(Boolean).join(', ')} <em>${esc(signed(c.deltaCents))}</em></li>`).join('')}</ul>
      <div class="chg-sum-tot"><span>Order total ${esc(fmtCents(t.oldGrandCents))} to ${esc(fmtCents(t.newGrandCents))}, shipping and volume tier included</span><strong>${esc(signed(t.netDeltaCents))}</strong></div>`;
  };

  $('chgUnits').addEventListener('input', (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const u = proposal.units[Number(e.target.closest('[data-ui]').dataset.ui)];
    const v = Math.max(0, Math.round(Number(e.target.value) || 0));
    if (f === 'units') u.qty = v;
    else if (f === 'qty') u.rows[Number(e.target.closest('[data-ri]').dataset.ri)].qty = v;
    drawSum();
  });
  $('chgUnits').addEventListener('click', (e) => {
    const add = e.target.closest('[data-f="add"]'); if (!add) return;
    const u = proposal.units[Number(add.closest('[data-ui]').dataset.ui)];
    openCabinetPicker({ onPick: (code) => {
      const hit = u.rows.find((r) => r.code === code);
      if (hit) hit.qty += 1; else u.rows.push({ code, qty: 1 });
      drawUnits(); drawSum();
    } });
  });
  const close = () => m.remove();
  $('chgCancel').addEventListener('click', close);
  $('chgClose').addEventListener('click', close);
  $('chgSubmit').addEventListener('click', async () => {
    if (!built || built.error) return;
    const btn = $('chgSubmit'), msg = $('chgMsg');
    btn.disabled = true; msg.className = 'cloud-msg'; msg.textContent = 'Sending to PL/NTH…';
    try { await onSubmit(built, $('chgNote').value); close(); }
    catch (err) { btn.disabled = false; msg.className = 'cloud-msg err'; msg.textContent = (err && err.message) || 'Could not send the request. Are you online?'; }
  });
  drawUnits(); drawSum();
}
