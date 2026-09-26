// preview.js — a small floor-plan thumbnail + "when" label for the Open lists (her ask
// 2026-09-26: "when opening a project, can it show a preview of what you are opening... it's
// hard to remember which each look like"). The lists come back as names only; the previews
// are fetched lazily, one row at a time, and cached for the session so a second look is free.

import { buildFloorplanSVG } from './floorplan.js';
import { withIslandFlags } from '../core/islands.js';

const cache = new Map();

/** The plan thumbnail of a saved kitchen state, or '' when there is nothing to draw. */
export function previewSVG(state) {
  try {
    if (!state || !state.room || !(state.items || []).length) return '';
    const svg = buildFloorplanSVG(withIslandFlags(state), null, { key: false, tight: true });   // plan only, no key table
    // crop to the room: the full plan sheet carries the key table and dimension strings, which
    // at thumbnail size shrank the room itself to a postage stamp (checked 2026-09-26)
    const W = state.room.width || 144, D = state.room.depth || 120, m = 8;
    return svg
      .replace(/viewBox="[^"]*"/, `viewBox="${-W / 2 - m} ${-D / 2 - m} ${W + 2 * m} ${D + 2 * m}"`)
      .replace(/\swidth="[^"]*"/, ' width="100%"').replace(/\sheight="[^"]*"/, ' height="100%"')
      .replace(/preserveAspectRatio="[^"]*"/, '').replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ');
  } catch { return ''; }
}

/** 'today' / 'yesterday' / '3 days ago' / '12 Aug' for a row's updated_at. */
export function whenAgo(iso) {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(t).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}

/** Fill every `[data-pv]` slot in `container` with a preview, in order, one fetch at a time.
 *  `fetchState(id)` resolves the saved state (or null); `caption(state)` an optional line under it.
 *  Stops quietly when the container leaves the page (the modal closed). */
export async function loadPreviews(container, ids, fetchState, caption = null) {
  for (const id of ids) {
    if (!container.isConnected) return;
    const slot = container.querySelector(`[data-pv="${id}"]`); if (!slot) continue;
    let entry = cache.get(id);
    if (!entry) {
      try { const state = await fetchState(id); entry = { svg: previewSVG(state), cap: caption ? caption(state) : '' }; }
      catch { entry = { svg: '', cap: '' }; }
      cache.set(id, entry);
    }
    if (!container.isConnected) return;
    slot.innerHTML = entry.svg ? entry.svg : '<span class="pv-empty">empty room</span>';
    slot.classList.toggle('pv-blank', !entry.svg);
    const capEl = container.querySelector(`[data-pvcap="${id}"]`);
    if (capEl && entry.cap) capEl.textContent = entry.cap;
  }
}
/** Forget a cached preview (after a save or delete). */
export function forgetPreview(id) { cache.delete(id); }
