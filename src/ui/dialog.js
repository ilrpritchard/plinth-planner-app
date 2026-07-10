// dialog.js — on-brand replacements for window.confirm() / window.alert().
// The native ones title themselves with the hosting domain ("xyz.github.io
// says…"), which is not a PL/NTH look. These render the same paper card the
// account modal uses and return a Promise, so call sites just `await`.

let overlay = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'uiDialog';
  document.body.appendChild(overlay);
  return overlay;
}

function show({ title, message, buttons }) {
  return new Promise((resolve) => {
    const el = ensureOverlay();
    el.innerHTML = `<div class="cloud-card dlg-card" role="dialog" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      ${message ? `<p class="cloud-sub dlg-msg">${esc(message)}</p>` : ''}
      <div class="dlg-btns">${buttons.map((b, i) =>
        `<button data-i="${i}" class="${b.cls || ''}">${esc(b.label)}</button>`).join('')}</div>
    </div>`;
    el.classList.add('show');
    const done = (val) => {
      el.classList.remove('show');
      el.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(buttons[0].value); }
      if (e.key === 'Enter') { e.stopPropagation(); done(buttons[buttons.length - 1].value); }
    };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', (e) => { if (e.target === el) done(buttons[0].value); }, { once: true });
    el.querySelectorAll('.dlg-btns button').forEach((b) =>
      b.addEventListener('click', () => done(buttons[Number(b.dataset.i)].value)));
    // focus the primary action so Enter/Space just works
    el.querySelector('.dlg-btns button:last-child')?.focus();
  });
}

/** Await-able confirm. Resolves true when the primary action is chosen. */
export function uiConfirm(message, { title = 'Are you sure?', confirmLabel = 'Yes', cancelLabel = 'Cancel', danger = false } = {}) {
  return show({
    title, message,
    buttons: [
      { label: cancelLabel, value: false, cls: 'dlg-cancel' },
      { label: confirmLabel, value: true, cls: 'cta' + (danger ? ' dlg-danger' : '') },
    ],
  });
}

/** Await-able alert. */
export function uiAlert(message, { title = 'Just so you know', okLabel = 'OK' } = {}) {
  return show({ title, message, buttons: [{ label: okLabel, value: true, cls: 'cta' }] });
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
