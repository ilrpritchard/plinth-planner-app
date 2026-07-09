// picker.js — the Trade visual cabinet picker. Replaces the error-prone plain
// <select> on order rows: a searchable modal of cards, each showing the
// master-library front drawing (drawFront), code, description, size and price,
// so the wrong SKU is obvious BEFORE it's ordered.
//
// filterCabinets() is pure and node-tested: every query token must match the
// code, the description, or (numeric tokens) the cabinet width in inches.

import { CATALOGUE, FAMILY_ORDER, FAMILY_LABEL, sellUSD, fmtUSD } from '../core/catalogue.js';
import { fmtIn } from '../core/units.js';
import { frontSVG } from './frontdraw.js';

/** Orderable SKUs, in family order — same set the old dropdown offered. */
export function orderableCabs() {
  return FAMILY_ORDER
    .filter((f) => f !== 'APPLIANCES')
    .flatMap((fam) => CATALOGUE.filter((c) => c.type === fam && c.gbp > 0));
}

/**
 * PURE: filter a SKU list by family chip + free-text query.
 * fam: '' = all, else a catalogue type ('FLOOR', 'WALL', …).
 * query: space-separated tokens, ALL must match. A token matches when it
 * appears in the code or description (case-insensitive), or — if numeric —
 * when it equals the cabinet's width in inches ('36' → every 36-wide SKU).
 */
export function filterCabinets(list, query = '', fam = '') {
  let out = fam ? list.filter((c) => c.type === fam) : list.slice();
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    const isNum = /^\d+(\.\d+)?$/.test(t);
    const num = parseFloat(t);
    out = out.filter((c) =>
      c.code.toLowerCase().includes(t) ||
      (c.desc || '').toLowerCase().includes(t) ||
      (isNum && Math.abs(c.w - num) < 0.3));
  }
  return out;
}

/** The row chip: mini front drawing + 'CODE · desc (W")'. */
export function cabChipHTML(cab) {
  if (!cab) return '<span class="pick-empty">— select cabinet —</span>';
  const draw = cab.w > 0 && cab.h > 0
    ? `<span class="pick-glyph">${frontSVG(cab, 30)}</span>`
    : '<span class="pick-glyph pick-acc">TRIM</span>';
  return `${draw}<span class="pick-chip-txt"><strong>${esc(cab.code)}</strong> · ${esc(cab.desc)}${cab.w > 0 ? ` (${fmtIn(cab.w)})` : ''}</span>`;
}

const CHIP_FAMS = ['', 'FLOOR', 'WALL', 'SHELF', 'COUNTER', 'TALL', 'ACCESSORIES'];

/**
 * Open the modal. opts: { selected, onPick(code) }.
 * Search filters as you type; Enter picks the first match; Esc / backdrop
 * closes; clicking a card picks it.
 */
export function openCabinetPicker({ selected = '', onPick } = {}) {
  document.getElementById('pickModal')?.remove();
  const all = orderableCabs();
  let query = '', fam = '';

  const overlay = document.createElement('div');
  overlay.id = 'pickModal';
  overlay.innerHTML = `
    <div class="pick-panel" role="dialog" aria-label="Choose a cabinet">
      <div class="pick-top">
        <input id="pickSearch" type="search" placeholder="Search code, name or width — e.g. 36, drawer, F10…" autocomplete="off">
        <button type="button" class="pick-x" title="Close (Esc)">✕</button>
      </div>
      <div class="pick-chips">${CHIP_FAMS.map((f) =>
        `<button type="button" class="pick-fchip${f === '' ? ' on' : ''}" data-fam="${f}">${f === '' ? 'All' : esc(FAMILY_LABEL[f])}</button>`).join('')}
      </div>
      <div class="pick-grid" id="pickGrid"></div>
    </div>`;

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const pick = (code) => { close(); onPick?.(code); };

  const cardHTML = (c) => {
    const draw = c.w > 0 && c.h > 0
      ? `<div class="pi-draw">${frontSVG(c, Math.max(20, Math.round(c.h / 86 * 96)))}</div>`
      : '<div class="pi-draw pi-acc">trim / accessory</div>';
    const dims = c.w > 0 ? `${fmtIn(c.w)} W × ${fmtIn(c.d)} D × ${fmtIn(c.h)} H` : '&nbsp;';
    return `<button type="button" class="pick-item${c.code === selected ? ' sel' : ''}" data-code="${esc(c.code)}">
      ${draw}
      <span class="pi-code">${esc(c.code)} <em>${esc(FAMILY_LABEL[c.type] || c.type)}</em></span>
      <span class="pi-desc">${esc(c.desc)}</span>
      <span class="pi-dims">${dims}</span>
      <span class="pi-price">${fmtUSD(sellUSD(c))}</span>
    </button>`;
  };

  const renderGrid = () => {
    const hits = filterCabinets(all, query, fam);
    overlay.querySelector('#pickGrid').innerHTML = hits.length
      ? hits.map(cardHTML).join('')
      : '<div class="pick-none">No cabinets match — try a width (e.g. 24) or a type (drawer, glazed, larder).</div>';
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && e.target === overlay.querySelector('#pickSearch')) {
      const first = filterCabinets(all, query, fam)[0];
      if (first) pick(first.code);
    }
  };

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.pick-x').addEventListener('click', close);
  overlay.querySelector('#pickSearch').addEventListener('input', (e) => { query = e.target.value; renderGrid(); });
  overlay.querySelector('#pickGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.pick-item');
    if (card) pick(card.dataset.code);
  });
  overlay.querySelector('.pick-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.pick-fchip'); if (!chip) return;
    fam = chip.dataset.fam;
    overlay.querySelectorAll('.pick-fchip').forEach((b) => b.classList.toggle('on', b === chip));
    renderGrid();
  });
  document.addEventListener('keydown', onKey, true);

  document.body.appendChild(overlay);
  renderGrid();
  overlay.querySelector('#pickSearch').focus();
  return overlay;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
