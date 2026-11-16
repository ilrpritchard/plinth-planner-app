// ui/plans.js — "Send the floor plans": a card with a drop box (W2W-264). It replaces the
// card that asked the visitor to copy a message into an email. The files go to the
// website's inquiry handler, which emails them to PL/NTH and records the contact; if that
// fails the old copy-and-email card is offered, so the plans never just vanish.

import { planFileProblem, fileSize, plansFormProblem, plansFields, PLANS_ENDPOINT, PLAN_EXTS } from '../core/plans.js';
import { captureEmail } from './dxfgate.js';
import { track, leadRef } from './track.js';
import { mailFallback } from './dialog.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** opts: { est (buildEstimate result or null), customer {name,email}, onCustomer(patch) } */
export function openFloorPlans({ est = null, customer = {}, onCustomer, project = '' } = {}) {
  document.getElementById('plansModal')?.remove();
  const el = document.createElement('div'); el.id = 'plansModal'; el.className = 'show';
  const units = est && est.units ? est.units : 0;
  el.innerHTML = `<form class="cloud-card fp-card" role="dialog" aria-label="Send the floor plans" novalidate>
      <h3>Send the floor plans.</h3>
      <p class="cloud-sub">${units ? `${units} ${units === 1 ? 'kitchen' : 'kitchens'} from ${est.from === 'project' ? 'the project' : 'the unit mix'}. ` : 'One plan per floor, with the kitchen types. '}PL/NTH lays out the kitchen types and returns a priced project.</p>
      <div class="fp-fields">
        <input type="text" id="sfpName" placeholder="Contact name" aria-label="Contact name" autocomplete="name" value="${esc(customer.name || '')}">
        <input type="text" id="sfpCo" placeholder="Company" aria-label="Company" autocomplete="organization">
      </div>
      <input type="email" id="sfpEmail" placeholder="Email" aria-label="Email" autocomplete="email" value="${esc(customer.email || '')}">
      <div class="fp-drop" id="sfpDrop" tabindex="0" role="button" aria-label="Add floor plans">
        <strong>Drop the floor plans here.</strong>
        <span>Or <u>choose files</u>. PDF, DWG or a sketch, up to 25 MB each.</span>
      </div>
      <input type="file" id="sfpFile" multiple hidden accept="${PLAN_EXTS.map((x) => '.' + x).join(',')}">
      <ul class="fp-files" id="sfpFiles"></ul>
      <p class="fp-msg" id="sfpMsg" role="status"></p>
      <div class="dlg-btns">
        <button type="button" class="dlg-cancel" data-act="close">Not now</button>
        <button type="submit" class="cta" id="sfpSend">Send</button>
      </div>
    </form>`;
  document.body.appendChild(el);
  const $ = (id) => el.querySelector('#' + id);
  const files = []; let busy = false;
  const say = (t, bad = false) => { const m = $('sfpMsg'); m.textContent = t; m.classList.toggle('bad', bad); };
  const close = () => { document.removeEventListener('keydown', onKey, true); el.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('mousedown', (e) => { if (e.target === el && !busy) close(); });
  el.querySelector('[data-act="close"]').addEventListener('click', () => { if (!busy) close(); });

  const render = () => {
    const ul = $('sfpFiles'); ul.textContent = '';
    files.forEach((f, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="fp-nm">${esc(f.name)}</span><span class="fp-sz">${fileSize(f.size)}</span><button type="button" aria-label="Remove ${esc(f.name)}">Remove</button>`;
      li.querySelector('button').addEventListener('click', () => { if (busy) return; files.splice(i, 1); render(); });
      ul.appendChild(li);
    });
  };
  const add = (incoming) => {
    const skipped = [];
    for (const f of incoming) {
      const why = planFileProblem(f, files);
      if (!why) files.push(f); else if (why !== 'duplicate') skipped.push(why);
    }
    render(); say(skipped.length ? skipped.join('. ') + '.' : '', skipped.length > 0);
  };
  const drop = $('sfpDrop'), input = $('sfpFile');
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const t of ['dragleave', 'drop']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) add(e.dataTransfer.files); });

  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault(); if (busy) return;
    const v = { name: $('sfpName').value, company: $('sfpCo').value, email: $('sfpEmail').value, files };
    const why = plansFormProblem(v);
    if (why) { say(why, true); return; }
    busy = true; const btn = $('sfpSend'); btn.disabled = true; btn.textContent = 'Sending…'; say('');
    onCustomer?.({ name: v.name.trim(), email: v.email.trim() });
    const fd = new FormData();
    for (const [k, val] of plansFields({ ...v, est, ref: leadRef(), project })) fd.append(k, val);
    for (const f of files) fd.append('plans[]', f, f.name);
    let ok = false;
    try {
      const r = await fetch(PLANS_ENDPOINT, { method: 'POST', body: fd });
      const j = r.ok ? await r.json() : null;
      ok = !!(j && j.ok);
    } catch { ok = false; }
    busy = false;
    if (ok) {
      captureEmail(v.email, `floorplans:${files.length}f/${units}u`, { cabinets: est ? est.cabs : null, mode: 'floorplans' });
      track('floorplans_sent', { files: files.length, kitchens: units });
      el.querySelector('form').innerHTML = `<h3>Sent.</h3>
        <p class="cloud-sub">${files.length === 1 ? 'The plan is' : `The ${files.length} plans are`} with PL/NTH. We reply by email, usually with a price, sometimes with a question or two first.</p>
        <div class="dlg-btns"><button type="button" class="cta" data-act="done">Done</button></div>`;
      el.querySelector('[data-act="done"]').addEventListener('click', close);
      return;
    }
    btn.disabled = false; btn.textContent = 'Send';
    say('The plans could not be sent just now. Try again, or send them by email.', true);
    if (!$('sfpMail')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.id = 'sfpMail'; b.textContent = 'Send by email';
      b.addEventListener('click', () => { close(); mailFallback({
        title: 'Send the floor plans', sub: 'Copy the message below, attach the plans and send it.',
        subject: 'Floor plans for pricing',
        body: `Name: ${v.name.trim()}\nCompany: ${v.company.trim()}\n${units ? `Number of units: ${units}\n` : 'Number of units:\n'}\nAttach a plan per floor. We lay out the kitchens and send back a priced project.\n`,
      }); });
      el.querySelector('.dlg-btns').insertBefore(b, btn);
    }
  });
  setTimeout(() => ($('sfpName').value ? $('sfpCo') : $('sfpName')).focus(), 30);
  track('floorplans_open');
  return el;
}
