// ui.js — builds the brand-matched panels and wires them to the store.

import {
  CATALOGUE, FAMILY_ORDER, FAMILY_LABEL, familyOf, FINISHES, getCab, sellUSD, fmtUSD, getFinish, WORKTOP_OPTIONS,
  CORNICE_OPTIONS, corniceOption, orderableAccessories, swapAlternatives, drawerInserts,
} from '../core/catalogue.js';
import { planCornice } from '../core/cornice.js';
import { fmtIn, fmtFeetIn, parseLength, parseRoomLength } from '../core/units.js';
import { findGaps, suggestForGap, placementsFor } from '../core/gaps.js';
import { planLineUp } from '../core/evenout.js';
import { planIslandCentre } from '../core/islandcentre.js';
import { planRoomResize } from '../core/roomresize.js';
import { canFileIsland } from '../core/islands.js';
import { planStackers } from '../core/stackers.js';
import { planIslandBack } from '../core/islandback.js';
import { planMirror, mirrorTargets } from '../core/mirror.js';
import { summarizeState, deliveryEstimate } from '../core/cost.js';
import { computeWarnings } from '../core/warnings.js';
import { openingWallLen, openingNearEdge, openingWidth } from '../core/openings.js';
import { findFreeSpot } from '../core/placement.js';
import { buildOrderEmail } from '../core/order.js';
import { isCloud, submitOrder } from '../core/cloud.js';
import { exportJSON, importJSON } from '../core/persistence.js';
import { TEMPLATES, applyTemplate, planWallInfill } from '../core/templates.js';
import { cabinetSVG } from './icon.js';
import { planRangeResize, rangeSizes } from '../core/resize.js';
import { sinkSizes, sinkSpec, SINK_BASES, sinkBaseCombo } from '../core/sinkspec.js';
import { canFlipHinge } from '../core/hinge.js';
import { uiConfirm, uiAlert, mailFallback } from './dialog.js';
import { genOrderNo } from '../core/orders.js';
import { FLOORS, WALLS } from '../scene/Room.js';
import { floorSwatchURL } from '../scene/floorTexture.js';
import { worktopSwatchURL } from '../models/worktopTexture.js';

const hex6 = (n) => '#' + n.toString(16).padStart(6, '0');
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// schematic cross-section of each cornice profile (cream line-art on dark cards)
function corniceCap(kind) {
  const s = 'stroke="#e9dec9" stroke-width="1.4" fill="none" stroke-linejoin="round" stroke-linecap="round"';
  if (kind === 'plain') return `<svg viewBox="0 0 40 26"><path d="M9 19 L9 10 Q9 7 12 7 L30 7 L30 19 Z" ${s}/></svg>`;
  if (kind === 'decorative') return `<svg viewBox="0 0 40 26"><path d="M8 20 L8 15 L13 13 L11 9 Q15 6 19 6 L30 6 L30 20 Z" ${s}/></svg>`;
  return `<svg viewBox="0 0 40 26"><line x1="7" y1="13" x2="33" y2="13" ${s}/></svg>`;
}

export class UI {
  constructor({ store, controls, onRoomChange }) {
    this.store = store;
    this.controls = controls;
    this.onRoomChange = onRoomChange || (() => {});
    this.activeWall = 'back'; // back | left | island
    this._build();
    store.subscribe((s, c) => this._onChange(s, c));
    this._renderWallFit();
    this._refreshCatalogue();
    this._refreshCost();
    this._refreshFinish();
    this._refreshRoomInputs();
  }

  // ---------- wall fit (how much linear wall is left) ----------
  _wallLength(wall) {
    const r = this.store.state.room;
    return wall === 'left' ? r.depth : r.width; // island => no limit
  }

  // a COUNTER cabinet stands ON the worktop over a base, so it takes no floor run (her
  // question 2026-09-22: a wall with 27" of floor left still takes a 36" counter double)
  _isBaseRun(cab) {
    return ['FLOOR', 'TALL'].includes(cab.type) ||
      (cab.type === 'APPLIANCES' && cab.mountY === 0);
  }

  _usedOnWall(wall) {
    if (wall === 'island') return 0;
    const r = this.store.state.room;
    const minZ = -r.depth / 2, minX = -r.width / 2;
    let used = 0;
    for (const it of this.store.state.items) {
      const cab = getCab(it.code);
      if (!cab || !this._isBaseRun(cab)) continue;
      const horiz = ((it.rotDeg || 0) % 180) === 0;
      if (wall === 'back' && horiz && Math.abs(it.z - (minZ + cab.d / 2)) < 8) used += cab.w;
      if (wall === 'left' && !horiz && Math.abs(it.x - (minX + cab.d / 2)) < 8) used += cab.w;
    }
    return used;
  }

  _remaining() {
    if (this.activeWall === 'island') return Infinity;
    return Math.max(0, this._wallLength(this.activeWall) - this._usedOnWall(this.activeWall));
  }

  // ---------- uneven scribes: even them out (her ask 2026-09-21) ----------
  // Offered ONLY when core/evenout.js says sliding the whole wall along spoils nothing.
  // "Which rule would you like?": even ends, the sink under its window, or the range centred
  // on the wall. The slack can only go one way, so every rule it allows is offered (core/evenout.js).
  _evenHTML() {
    this._even = null;
    if (this.activeWall === 'island') return '';
    for (const wall of (this.activeWall === 'back' ? ['back'] : ['left', 'right'])) {
      const p = planLineUp(this.store.state, wall);
      if (!p.ok) {
        // something could be lined up, but sliding the wall would spoil something: say what, offer nothing
        const why = { window: 'a tall or wall cabinet would slide over the window', door: 'a cabinet would end up across the door', 'adjoining run': 'a cabinet on the side wall meets this run, and sliding it would open that joint', 'corner unit': 'a corner unit fixes this run to its corner', 'gap in the run': 'there is a gap in the run. Fill it first (see below), then line it up' }[p.reason];
        if (p.reason === 'over the wall') return `<div class="wf-even"><div class="wf-gap-h"><strong>Longer than the wall</strong> This run needs ${fmtIn(-(p.left + p.right))} more than the wall it stands on, so its cabinets overlap or pass through the wall. Take a cabinet out, swap one for a narrower size, or make the room bigger.</div></div>`;
        if (why && p.left != null) return `<div class="wf-even"><div class="wf-gap-h"><strong>Line up this wall</strong> ${fmtIn(p.left)} one side, ${fmtIn(p.right)} the other. Left as it is: ${why}.</div></div>`;
        continue;
      }
      this._even = p;
      const name = { even: 'Even ends', sink: 'Sink centred under the window', range: 'Range centred on the wall' };
      const also = { even: 'evens the ends', sink: 'centres the sink under the window', range: 'centres the range on the wall' };
      const ends = (o) => (Math.abs(o.left - o.right) < 0.13 ? `${fmtIn((o.left + o.right) / 2)} each side` : `${fmtIn(Math.max(0, o.left))} one side, ${fmtIn(Math.max(0, o.right))} the other`);
      const through = Math.min(p.left, p.right) < -0.3;      // one end is THROUGH the wall (the room was made narrower after the run was stood)
      const btns = p.options.map((o, i) => {
        const dir = wall === 'back' ? (o.shift > 0 ? 'right' : 'left') : (o.shift > 0 ? 'toward the front' : 'toward the back');
        const costs = o.notes.map((n) => (n === 'island' ? 'the island stays where it is' : n.what === 'sink' ? `the sink comes ${fmtIn(n.off)} off the window` : `the range comes ${fmtIn(n.off)} off the middle of the wall`));
        const meta = [o.key === 'even' ? `moves the wall ${fmtIn(Math.abs(o.shift))} ${dir}` : `leaves ${ends(o)}`, ...o.also.map((k) => `also ${also[k]}`), ...costs].join(' · ');
        return `<button type="button" class="wf-gap-opt" data-even="${i}" title="Slides everything on this wall ${fmtIn(Math.abs(o.shift))} ${dir}: cabinets, the range, uppers and the hood move together.">
          <span class="wf-gap-codes">${o.key === 'even' && through ? 'Bring it back inside' : name[o.key]}${o.key === 'even' ? `: ${ends(o)}` : ''}</span><span class="wf-gap-meta">${meta}</span></button>`;
      }).join('');
      const head = through ? `<strong>Through the wall</strong> This run sits ${fmtIn(-Math.min(p.left, p.right))} past the end of its wall, with ${fmtIn(Math.max(p.left, p.right))} spare at the other end.` : `<strong>Line up this wall</strong> ${fmtIn(p.left)} one side, ${fmtIn(p.right)} the other.`;
      return `<div class="wf-even"><div class="wf-gap-h">${head}${p.options.length > 1 ? ' The spare inches can only go one way. Pick what matters most:' : ''}</div>${btns}</div>`;
    }
    return '';
  }

  /** One press: the right stacker on every host on the active wall (or, with an id, on that one). */
  _stackWall(onlyId = null, wall = null) {
    // one cabinet: wherever it stands. The catalogue tile: the whole kitchen. The wall card: that wall.
    const p = planStackers(this.store.state, onlyId != null ? null : wall, onlyId);
    if (!p.ok) { this._toast(p.reason === 'too low' ? `The ceiling is ${fmtFeetIn(p.ceiling)}. Stackers need ${fmtFeetIn(p.need)}.` : 'Nothing here can take a stacker.'); return; }
    const added = this.controls.addStackers(p.placements);
    this._renderWallFit(); this._refreshCatalogue(); this._refreshCost();
    this._toast(added ? `${added} stacker${added === 1 ? '' : 's'} added (${p.size}"): ${p.placements.map((q) => q.code).join(', ')}. Undo takes them off.` : 'Nothing was added.');
  }

  // ---------- stackers: one press puts the right stacker on every tall, upper and counter
  // cabinet on this wall, in the height the ceiling allows (her ask 2026-09-22) ----------
  _stackersHTML() {
    this._stack = null;
    if (this.activeWall === 'island') return '';
    const p = planStackers(this.store.state, this.activeWall);
    if (!p.ok) {
      if (p.reason === 'too low') return `<div class="wf-even"><div class="wf-gap-h"><strong>Stackers</strong> The ceiling is ${fmtFeetIn(p.ceiling)}. Stackers need ${fmtFeetIn(p.need)} (15") or ${fmtFeetIn(p.need + 6)} (21") with their crown.</div></div>`;
      return '';
    }
    this._stack = p;
    const skip = p.skipped.filter((k) => k.why !== 'already stacked');
    const why = { corner: 'no stacker is made for a corner unit', 'off the wall': 'it stands off the wall', 'none made': 'no stacker is made for it' };
    return `<div class="wf-even"><div class="wf-gap-h"><strong>Stackers</strong> ${p.placements.length} cabinet${p.placements.length === 1 ? '' : 's'} on this wall can take a ${p.size}" stacker (ceiling ${fmtFeetIn(this.store.state.room.height || 96)}).</div>
      <button type="button" class="wf-gap-opt" id="wfStack" title="Puts the matching stacker on each tall, wall and counter cabinet on this wall, back on the wall, face flush with the cabinet below">
        <span class="wf-gap-codes">Add ${p.placements.length} stacker${p.placements.length === 1 ? '' : 's'} (${p.size}")</span>
        <span class="wf-gap-meta">${p.placements.map((q) => q.code).join(' · ')}${skip.length ? ` · skipped ${skip.map((k) => `${k.code} (${why[k.why] || k.why})`).join(', ')}` : ''}</span></button></div>`;
  }

  // ---------- gaps: "there is a gap here, this is what would fit" (her ask 2026-09-21) ----------
  // Shown for the wall being worked on (Side wall covers the left AND right walls). Every
  // option is one tap: the pieces stand exactly in the gap, butted from the range side.
  _gapsHTML() {
    if (this.activeWall === 'island') { this._gaps = []; return ''; }
    const walls = this.activeWall === 'back' ? ['back'] : ['left', 'right'];
    this._gaps = findGaps(this.store.state).filter((g) => walls.includes(g.wall)).map((g) => ({ ...g, options: suggestForGap(g) })).filter((g) => g.options.length);
    if (!this._gaps.length) return '';
    const side = (g) => (this.activeWall === 'back' ? '' : g.wall === 'left' ? 'Left wall, ' : 'Right wall, ');
    return `<div class="wf-gaps">${this._gaps.map((g, gi) => `<div class="wf-gap">
      <div class="wf-gap-h"><strong>${fmtIn(g.width)} gap</strong> ${side(g)}${g.label}</div>
      ${g.options.map((o, oi) => `<button type="button" class="wf-gap-opt" data-gap="${gi}" data-opt="${oi}" title="${o.kind}. Tap to stand ${o.codes.length === 1 ? 'it' : 'them'} in the gap.">
        <span class="wf-gap-codes">${o.codes.map((c) => `${c} ${getCab(c).desc.replace(/ \(3\)/, '')} ${fmtIn(getCab(c).w)}`).join(' + ')}</span>
        <span class="wf-gap-meta">${o.left > 0.5 ? `leaves ${fmtIn(o.left)}${o.filler ? ' filler' : ''}` : 'exact fit'} · ${fmtUSD(o.usd)}</span>
      </button>`).join('')}
    </div>`).join('')}</div>`;
  }

  _renderWallFit() {
    const el = document.getElementById('wallFit');
    if (!el) return;
    const walls = [['back', 'Back wall'], ['left', 'Side wall'], ['island', 'Island']];
    const tabs = walls.map(([k, label]) =>
      `<button type="button" class="wf-tab${this.activeWall === k ? ' active' : ''}" data-wall="${k}">${label}</button>`).join('');
    let bar = '';
    if (this.activeWall !== 'island') {
      const len = this._wallLength(this.activeWall);
      const used = this._usedOnWall(this.activeWall);
      const rem = Math.max(0, len - used);
      const pct = len > 0 ? Math.min(100, (used / len) * 100) : 0;
      const over = used > len + 0.5;
      const canFill = rem >= 20; // narrowest base unit
      bar = `<div class="wf-bar${over ? ' over' : ''}"><div style="width:${pct}%"></div></div>
        <div class="wf-stats"><span>${fmtIn(used)} used</span><span><strong>${over ? 'over by ' + fmtIn(used - len) : fmtIn(rem) + ' left'}</strong></span></div>
        ${canFill ? `<button type="button" class="wf-fill" id="wfFill">Fill this wall →</button>` : ''}`;
    } else {
      bar = `<div class="wf-stats" style="justify-content:flex-start"><span>Free-standing: no length limit</span></div>`;
    }
    el.innerHTML = `<div class="wf-tabs">${tabs}</div>${bar}${this._evenHTML()}${this._gapsHTML()}${this._stackersHTML()}`;
    el.querySelector('#wfStack')?.addEventListener('click', () => this._stackWall(null, this.activeWall === 'island' ? null : this.activeWall));
    el.querySelector('.wf-even')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-even]'); if (!btn) return;
      const o = this._even && this._even.options[Number(btn.dataset.even)]; if (!o) return;
      const ok = this.controls.evenOut({ ok: true, moves: o.moves });
      this._renderWallFit(); this._refreshCost();          // the moves are quiet updates: redraw the card and the fillers in the estimate
      const done = { even: 'Evened out', sink: 'Sink centred under the window', range: 'Range centred on the wall' }[o.key];
      this._toast(ok ? `${done}: ${fmtIn(Math.max(0, o.left))} and ${fmtIn(Math.max(0, o.right))} at the ends.${o.notes.includes('island') ? ' The island has not moved: select it to centre it again.' : ''} Undo puts it back.` : 'That wall has changed. Try again.');
    });
    el.querySelector('.wf-gaps')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-gap]'); if (!btn) return;
      const g = (this._gaps || [])[Number(btn.dataset.gap)], o = g && g.options[Number(btn.dataset.opt)];
      if (!o) return;
      const done = this.controls.placeInGap(placementsFor(g, o, this.store.state));
      this._toast(done ? `${o.codes.join(' + ')} stood in the gap.${o.filler ? ` The ${fmtIn(o.left)} left over is a scribe filler.` : ''} Undo takes it back out.` : 'That gap has changed. Pick again.');
    });
    el.querySelector('.wf-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-wall]'); if (!b) return;
      this.activeWall = b.dataset.wall;
      this._renderWallFit();
      this._refreshCatalogue();
    });
    el.querySelector('#wfFill')?.addEventListener('click', () => {
      const placements = planWallInfill(this.store.state, this.activeWall);
      for (const id of (placements.remove || [])) this.store.removeItem(id);   // corner conversion
      for (const p of placements) this.store.addItem(p.code, { x: p.x, z: p.z, rotDeg: p.rotDeg });
      const n = placements.length;
      this.controls?.layer?.select(null); this.showSelbar(null);
      this._toast(n ? `Filled the ${this.activeWall === 'left' ? 'side' : 'back'} wall with ${n} base cabinets.` : 'Not enough room left to fill.');
    });
  }

  _refreshCatalogue() {
    document.getElementById('catalogue').innerHTML = this._catalogueHTML();
  }

  _build() {
    document.getElementById('catalogue').innerHTML = this._catalogueHTML();
    document.getElementById('finishes').innerHTML = this._finishesHTML();
    this._buildTemplates();
    this._buildCornice();
    this._buildAccessories();
    this._wireRoom();
    this._buildRoomStyle();
    this._wireCatalogue();
    this._wireFinishes();
    this._wireCustomer();
    this._wireToolbar();
    this._wireSelbar();
    this._wireCostLines();
    this._wireMobile();
    this._wireTabs();
    this._wireTour();
  }

  // ---------- left-panel tabs: CABINETS (catalogue) / ROOM (setup) ----------
  _wireTabs() {
    const body = document.getElementById('leftBody');
    const tabs = document.getElementById('lpTabs');
    if (!body || !tabs) return;
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      body.classList.toggle('tab-room', b.dataset.tab === 'room');
    });
  }

  // ---------- first-run tour card — shown once, dismissible ----------
  _wireTour() {
    try { if (localStorage.getItem('plnnerTourSeen')) this._emptyDismissed = true; } catch { /* private mode */ }
    const dismiss = () => {
      this._emptyDismissed = true;
      try { localStorage.setItem('plnnerTourSeen', '1'); } catch { /* private mode */ }
      document.getElementById('emptyState')?.classList.add('hidden');
    };
    document.getElementById('esClose')?.addEventListener('click', dismiss);
    document.getElementById('esBlank')?.addEventListener('click', dismiss);
    document.getElementById('esInspire')?.addEventListener('click', () => {
      dismiss();
      document.getElementById('wzTopOpen')?.click();     // opens the wizard
    });
  }

  // ---------- cornice picker (accessory) ----------
  _buildCornice() {
    const grid = document.getElementById('corniceGrid');
    if (!grid) return;
    grid.innerHTML = Object.entries(CORNICE_OPTIONS).map(([k, v]) =>
      `<button type="button" class="cornice-opt" data-cornice="${k}" title="${v.blurb || ''}">
         <span class="co-cap">${corniceCap(k)}</span>
         <span class="co-name">${v.label}</span>
         ${v.sellPerFt ? `<span class="co-rate">${fmtUSD(v.sellPerFt)}/ft</span>` : '<span class="co-rate">—</span>'}
       </button>`).join('');
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cornice]'); if (!b) return;
      this.store.setRoom({ cornice: b.dataset.cornice });
      this.onRoomChange(false);   // rebuilds the cornice layer
      this._refreshCornice();
    });
    this._refreshCornice();
  }

  _refreshCornice() {
    const r = this.store.state.room;
    const cur = r.cornice || 'none';
    document.querySelectorAll('#corniceGrid .cornice-opt').forEach((b) =>
      b.classList.toggle('active', b.dataset.cornice === cur));
    this._refreshSummaries();
    const out = document.getElementById('corniceReadout');
    if (!out) return;
    if (cur === 'none') { out.innerHTML = ''; return; }
    const { totalIn } = planCornice(this.store.state);
    const ft = totalIn / 12;
    if (ft < 0.1) { out.innerHTML = `<em>Add wall, tall or counter cabinets and the crown molding will run along their tops.</em>`; return; }
    const opt = corniceOption(cur);
    out.innerHTML = `<strong>${ft.toFixed(1)} linear ft</strong> of ${opt.label.toLowerCase()} · <strong>${fmtUSD(opt.sellPerFt * ft)}</strong>, added to your estimate.`;
  }


  // ---- loose accessories (cutlery inserts, end panels) ----
  _buildAccessories() {
    const el = document.getElementById('accessoriesList');
    if (!el) return;
    el.innerHTML = orderableAccessories().map((a) => `
      <div class="acc-row" data-code="${a.code}">
        <span class="acc-info"><strong>${a.code}</strong> ${a.desc}<em>${fmtUSD(sellUSD(a))}</em></span>
        <span class="acc-step">
          <button type="button" data-d="-1" aria-label="less">−</button>
          <span class="acc-qty">0</span>
          <button type="button" data-d="1" aria-label="more">+</button>
        </span>
      </div>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-d]'); if (!b) return;
      const row = b.closest('.acc-row'); const code = row.dataset.code;
      const cur = this.store.state.accessories?.[code] || 0;
      this.store.setAccessory(code, cur + Number(b.dataset.d));
      this._refreshAccessories();
    });
    this._refreshAccessories();
  }
  _refreshAccessories() {
    const acc = this.store.state.accessories || {};
    document.querySelectorAll('#accessoriesList .acc-row').forEach((row) => {
      const q = acc[row.dataset.code] || 0;
      row.querySelector('.acc-qty').textContent = q;
      row.classList.toggle('has', q > 0);
    });
    this._refreshSummaries();
  }

  // ---------- quick-start templates ----------
  _buildTemplates() {
    const grid = document.getElementById('templateGrid');
    if (!grid) return;
    grid.innerHTML = TEMPLATES.map((t) =>
      `<button type="button" class="qs-card" data-tpl="${t.id}" title="${t.desc}">
         <span class="qs-name">${t.name}</span>
         <span class="qs-desc">${t.desc}</span>
       </button>`).join('');
    grid.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-tpl]'); if (!b) return;
      if (this.store.state.items.length && !(await uiConfirm('It replaces what you have on the walls now.', {
        title: 'Start from this layout?', confirmLabel: 'Start fresh',
      }))) return;
      const n = applyTemplate(this.store, (code, wall) => this.controls.placeNew(code, wall), b.dataset.tpl);
      this.controls?.layer?.select(null); this.showSelbar(null);
      this._toast(`Placed a starting layout (${n} cabinets). Drag to adjust.`);
    });
  }

  // ---------- room style ----------
  _buildRoomStyle() {
    const swHTML = (entries, key, showName = true) => Object.entries(entries).map(([k, v]) =>
      `<button type="button" class="rs-sw${showName ? '' : ' chip-only'}" data-${key}="${k}" title="${v.label}">
         <span class="rs-chip" style="background:${hex6(v.color)}"></span>
         ${showName ? `<span class="rs-name">${v.label}</span>` : ''}
       </button>`).join('');
    // floors show a patch of the REAL painted floor, not a flat colour chip
    document.getElementById('floorSwatches').innerHTML = Object.entries(FLOORS).map(([k, v]) => {
      let img = ''; try { img = floorSwatchURL(k, v.color); } catch { img = ''; }
      return `<button type="button" class="rs-sw" data-floor="${k}" title="${v.label}">
         <span class="rs-chip rs-chip-floor" style="background:${hex6(v.color)}${img ? ` url(${img}) center/cover` : ''}"></span>
         <span class="rs-name">${v.label}</span>
       </button>`;
    }).join('');
    document.getElementById('wallSwatches').innerHTML = swHTML(WALLS, 'wall', false); // colours only
    // countertops show a patch of the REAL painted surface too
    document.getElementById('worktopSwatches').innerHTML = Object.entries(WORKTOP_OPTIONS).map(([k, v]) => {
      let img = ''; try { img = worktopSwatchURL(k); } catch { img = ''; }
      return `<button type="button" class="rs-sw" data-worktop="${k}" title="${v.label}"><span class="rs-chip rs-chip-floor" style="background:${v.hex}${img ? ` url(${img}) center/cover` : ''}"></span><span class="rs-name">${v.label}</span></button>`;
    }).join('');

    document.getElementById('floorSwatches').addEventListener('click', (e) => {
      const b = e.target.closest('[data-floor]'); if (!b) return;
      this.store.setRoom({ floor: b.dataset.floor }); this.onRoomChange(false); this._refreshRoomStyle();
    });
    document.getElementById('wallSwatches').addEventListener('click', (e) => {
      const b = e.target.closest('[data-wall]'); if (!b) return;
      this.store.setRoom({ wall: b.dataset.wall }); this.onRoomChange(false); this._refreshRoomStyle();
    });
    document.getElementById('worktopSwatches').addEventListener('click', (e) => {
      const b = e.target.closest('[data-worktop]'); if (!b) return;
      this._setWorktop(b.dataset.worktop);
    });
    // ---- doors & windows manager ----
    document.querySelector('#dropOpenings .op-btns')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]'); if (!b) return;
      const wall = document.getElementById('opWall').value || 'back';
      this.store.addOpening({ type: b.dataset.add, wall, pos: 0.5 });
      this.onRoomChange(false); this._renderOpenings();
    });
    this._renderOpenings();

    // ---- boxing-in manager ----
    document.getElementById('bxAdd')?.addEventListener('click', () => {
      const wall = document.getElementById('bxWall').value || 'back';
      this.store.addBoxing({ wall, pos: 0.5, w: 8, d: 8 });
      this.onRoomChange(false); this._renderBoxings();
    });
    this._renderBoxings();
    this._refreshRoomStyle();
  }

  _renderBoxings() {
    const el = document.getElementById('boxingList');
    if (!el) return;
    const r = this.store.state.room;
    const bxs = r.boxings || [];
    if (!bxs.length) { el.innerHTML = `<div class="hint" style="opacity:0.7">None yet.</div>`; return; }
    const WALLN = { back: 'Back wall', front: 'Front wall', left: 'Left wall', right: 'Right wall' };
    el.innerHTML = bxs.map((b) => {
      const wallName = WALLN[b.wall] || 'Back wall';
      const len = (b.wall === 'left' || b.wall === 'right') ? r.depth : r.width;
      return `<div class="op-row" data-id="${b.id}">
        <div class="op-head"><span><strong>Bulkhead</strong> · ${wallName}</span>
          <button class="op-del" data-act="del" title="Remove">&times;</button></div>
        <div class="op-controls"><input type="range" class="bx-pos" min="0" max="1" step="0.005" value="${b.pos ?? 0.5}" />
          <span class="op-dist">${fmtIn((b.pos ?? 0.5) * len)}</span></div>
        <div class="op-controls" style="margin-top:6px">
          <label style="font-size:10px;color:var(--dim)">Width <input type="text" class="bx-w" value="${fmtIn(b.w || 8)}" style="width:46px"/></label>
          <label style="font-size:10px;color:var(--dim)">Projection <input type="text" class="bx-d" value="${fmtIn(b.d || 8)}" style="width:46px"/></label>
        </div>
      </div>`;
    }).join('');
    el.querySelectorAll('.op-row').forEach((row) => {
      const id = Number(row.dataset.id);
      row.querySelector('[data-act="del"]').addEventListener('click', () => { this.store.removeBoxing(id); this.onRoomChange(false); this._renderBoxings(); });
      row.querySelector('.bx-pos').addEventListener('input', (e) => { this.store.updateBoxing(id, { pos: parseFloat(e.target.value) }); this.onRoomChange(false);
        const b = this.store.state.room.boxings.find((x) => x.id === id); const len = b.wall === 'left' ? this.store.state.room.depth : this.store.state.room.width;
        row.querySelector('.op-dist').textContent = fmtIn(b.pos * len); });
      const num = (sel, key) => row.querySelector(sel).addEventListener('change', (e) => { const v = parseLength(e.target.value); if (isFinite(v) && v > 1) { this.store.updateBoxing(id, { [key]: v }); this.onRoomChange(false); } this._renderBoxings(); });
      num('.bx-w', 'w'); num('.bx-d', 'd');
    });
  }

  _renderOpenings() {
    const el = document.getElementById('openingsList');
    if (!el) return;
    const r = this.store.state.room;
    const ops = r.openings || [];
    const label = { window: 'Window', door: 'Door', doorway: 'Doorway' };
    const WALLN = { back: 'Back wall', front: 'Front wall', left: 'Left wall', right: 'Right wall' };
    // the two ends of a wall, by the wall they meet: unambiguous whichever way you face
    const ENDS = (wall) => (wall === 'left' || wall === 'right') ? ['back wall', 'front wall'] : ['left wall', 'right wall'];
    this._opFrom = this._opFrom || new Map();          // per opening: measure from the 'start' (min) or 'end' corner (UI only)
    if (!ops.length) { el.innerHTML = `<div class="hint" style="opacity:0.7">None yet.</div>`; return; }
    // TYPED, NOT SLID (her ask 2026-09-25: "adding a window and door could definitely be more
    // accurate, easier to work with"): distance from a named corner to the near edge, width,
    // sill and height, all as numbers in feet-and-inches or inches. The slider stays for a nudge.
    // "Window 2 of 2 · Back wall": numbered along its wall when there is more than one of its kind there
    const nthOf = (o) => { const same = ops.filter((p) => p.type === o.type && (p.wall || 'back') === (o.wall || 'back')).sort((p, q) => (p.pos ?? 0.5) - (q.pos ?? 0.5)); return same.length > 1 ? ` ${same.indexOf(o) + 1} of ${same.length}` : ''; };
    this._nthOpening = nthOf;
    el.innerHTML = ops.map((o) => {
      const len = openingWallLen(r, o.wall), w = openingWidth(o, r), near = openingNearEdge(r, o);
      const picked = this._pickedOpening === o.id;
      const from = this._opFrom.get(o.id) || 'start';
      const dist = from === 'start' ? near : len - near - w;
      const [e0, e1] = ENDS(o.wall || 'back');
      const isWin = o.type === 'window';
      const sill = o.sill ?? Math.max(36, r.height * 0.42);
      const hgt = o.hgt ?? Math.min(46, r.height * 0.45);
      return `<div class="op-row${picked ? ' is-picked' : ''}" data-id="${o.id}">
        <div class="op-head"><span><strong>${label[o.type] || 'Opening'}${nthOf(o)}</strong> · ${WALLN[o.wall] || 'Back wall'}${picked ? '<span class="op-picked">this one</span>' : ''}</span>
          <button class="op-del" data-act="del" title="Remove">&times;</button></div>
        <div class="op-grid">
          <label class="op-mini op-span">From the <select class="op-from"><option value="start" ${from === 'start' ? 'selected' : ''}>${e0}</option><option value="end" ${from === 'end' ? 'selected' : ''}>${e1}</option></select></label>
          <label class="op-mini">to its edge <input type="text" class="op-dist-in" value="${fmtIn(dist)}" title="Distance from that corner to the near edge of the opening" /></label>
          <label class="op-mini">Width <input type="text" class="op-w" value="${fmtIn(w)}" /></label>
          ${isWin ? `<label class="op-mini">Sill <input type="text" class="op-sill" value="${fmtIn(sill)}" title="Floor to the underside of the window" /></label>
          <label class="op-mini">Height <input type="text" class="op-h" value="${fmtIn(hgt)}" title="Sill to head" /></label>` : ''}
        </div>
        <input type="range" class="op-pos" min="0" max="1" step="0.005" value="${o.pos ?? 0.5}" title="Slide to nudge" />
        <div class="op-dist">${fmtIn(near)} from the ${e0} · ${fmtIn(Math.max(0, len - near - w))} from the ${e1}</div>
      </div>`;
    }).join('');
    el.querySelectorAll('.op-row').forEach((row) => {
      const id = Number(row.dataset.id);
      const cur = () => (this.store.state.room.openings || []).find((x) => x.id === id);
      const posFor = (dist, o) => {                          // pos (centre fraction) from a corner-to-edge distance
        const len = openingWallLen(this.store.state.room, o.wall), w = openingWidth(o, this.store.state.room);
        const from = this._opFrom.get(id) || 'start';
        const c = from === 'start' ? dist + w / 2 : len - dist - w / 2;
        return Math.max(0, Math.min(1, c / len));
      };
      const distNow = (o) => { const len = openingWallLen(this.store.state.room, o.wall), w = openingWidth(o, this.store.state.room), near = openingNearEdge(this.store.state.room, o); return (this._opFrom.get(id) || 'start') === 'start' ? near : len - near - w; };
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        this.store.removeOpening(id); this.onRoomChange(false); this._renderOpenings();
      });
      row.querySelector('.op-from').addEventListener('change', (e) => { this._opFrom.set(id, e.target.value); this._renderOpenings(); });
      row.querySelector('.op-dist-in').addEventListener('change', (e) => {
        const v = parseLength(e.target.value), o = cur();
        if (o && isFinite(v) && v >= 0) { this.store.updateOpening(id, { pos: posFor(v, o) }); this.onRoomChange(false); }
        this._renderOpenings();
      });
      row.querySelector('.op-w').addEventListener('change', (e) => {   // a new width keeps the measured edge where it is
        const v = parseLength(e.target.value), o = cur();
        if (o && isFinite(v) && v >= 8) { const d = distNow(o); this.store.updateOpening(id, { width: v }); this.store.updateOpening(id, { pos: posFor(d, cur()) }); this.onRoomChange(false); }
        this._renderOpenings();
      });
      row.querySelector('.op-pos').addEventListener('input', (e) => {
        this.store.updateOpening(id, { pos: parseFloat(e.target.value) }); this.onRoomChange(false);
        const o = cur(), rm = this.store.state.room, len = openingWallLen(rm, o.wall), w = openingWidth(o, rm), near = openingNearEdge(rm, o), [e0, e1] = ENDS(o.wall || 'back');
        row.querySelector('.op-dist').textContent = `${fmtIn(near)} from the ${e0} · ${fmtIn(Math.max(0, len - near - w))} from the ${e1}`;
        row.querySelector('.op-dist-in').value = fmtIn(distNow(o));
      });
      const num = (sel, key, min) => row.querySelector(sel)?.addEventListener('change', (e) => {
        const v = parseLength(e.target.value);
        if (isFinite(v) && v >= min) { this.store.updateOpening(id, { [key]: v }); this.onRoomChange(false); }
        this._renderOpenings();
      });
      num('.op-sill', 'sill', 0);
      num('.op-h', 'hgt', 6);
    });
  }

  // worktop material: apply to the selected cabinet's run, else set the default
  _setWorktop(material) {
    const id = this.controls?.layer?.selectedId;
    const sel = id != null ? this.store.getItem(id) : null;
    const selCab = sel ? getCab(sel.code) : null;
    if (sel && selCab && selCab.type === 'FLOOR') {
      const horiz = ((sel.rotDeg || 0) % 180) === 0;
      const run = [];
      for (const o of this.store.state.items) {
        const c = getCab(o.code);
        if (!c || c.type !== 'FLOOR') continue;
        const oh = ((o.rotDeg || 0) % 180) === 0;
        if (oh !== horiz) continue;
        const same = horiz ? Math.abs(o.z - sel.z) < 8 : Math.abs(o.x - sel.x) < 8;
        if (same) run.push(o.id);
      }
      // through the store, never direct mutation — direct writes fired no
      // event, so the choice never autosaved and undo couldn't see it. The
      // first update records the full pre-change state = one undo step for
      // the whole run; the rest are quiet.
      run.forEach((oid, i) => this.store.updateItem(oid, { worktop: material }, { quiet: i > 0 }));
      this._toast(`Countertop set to ${WORKTOP_OPTIONS[material].label} on this run.`);
    } else {
      this.store.setRoom({ worktop: material });
      this._toast(`Default countertop set to ${WORKTOP_OPTIONS[material].label}.`);
    }
    this.onRoomChange(false); // rebuilds the worktop
    this._refreshRoomStyle();
  }

  _refreshRoomStyle() {
    const r = this.store.state.room;
    document.querySelectorAll('#floorSwatches .rs-sw').forEach((b) => b.classList.toggle('active', b.dataset.floor === r.floor));
    document.querySelectorAll('#wallSwatches .rs-sw').forEach((b) => b.classList.toggle('active', b.dataset.wall === r.wall));
    document.querySelectorAll('#worktopSwatches .rs-sw').forEach((b) => b.classList.toggle('active', b.dataset.worktop === r.worktop));
    this._renderOpenings();
    this._renderBoxings();
    this._renderRoomPlan();
    this._refreshSummaries();
  }

  _renderRoomPlan() {
    const r = this.store.state.room;
    const el = document.getElementById('roomPlan');
    if (!el) return;
    const W = 132, H = 104, m = 18;
    const aw = W - 2 * m, ah = H - 2 * m;
    const ar = r.width / r.depth;
    let rw = aw, rh = ah;
    if (ar >= aw / ah) rh = rw / ar; else rw = rh * ar;
    const x = (W - rw) / 2, y = (H - rh) / 2;
    // draw each opening on its wall (back = top edge, left = left edge)
    let win = '', door = '';
    for (const o of (r.openings || [])) {
      const col = o.type === 'window' ? '#7aa7c4' : (o.type === 'doorway' ? '#838052' : '#b1392b');
      if (o.wall === 'left') {
        const len = rh * 0.18, cy = y + rh * (o.pos ?? 0.5);
        door += `<line x1="${x}" y1="${Math.max(y, cy - len / 2)}" x2="${x}" y2="${Math.min(y + rh, cy + len / 2)}" stroke="${col}" stroke-width="3"/>`;
      } else {
        const len = rw * 0.18, cx = x + rw * (o.pos ?? 0.5);
        win += `<line x1="${Math.max(x, cx - len / 2)}" y1="${y}" x2="${Math.min(x + rw, cx + len / 2)}" y2="${y}" stroke="${col}" stroke-width="3"/>`;
      }
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="#fbf7ee" stroke="#d9cfb8" stroke-width="1"/>
      <line x1="${x}" y1="${y}" x2="${x + rw}" y2="${y}" stroke="#3f3a24" stroke-width="2.5"/>
      <line x1="${x}" y1="${y}" x2="${x}" y2="${y + rh}" stroke="#3f3a24" stroke-width="2.5"/>
      ${win}${door}
      <text x="${x + rw / 2}" y="${y - 6}" font-size="8" fill="#7d7558" text-anchor="middle">${fmtFeetIn(r.width)}</text>
      <text x="${x - 7}" y="${y + rh / 2}" font-size="8" fill="#7d7558" text-anchor="middle" transform="rotate(-90 ${x - 7} ${y + rh / 2})">${fmtFeetIn(r.depth)}</text>
    </svg>`;
  }

  // ---------- catalogue ----------
  _catalogueHTML() {
    const remaining = this._remaining();
    const TOL = 0.5;
    let html = '';
    let hiddenAny = false;
    const tooWide = new Set();
    // A tile is greyed only when the cabinet can stand NOWHERE: the same search a tap makes
    // (placement.js findFreeSpot: this wall first, then the others, then the floor). It used to
    // compare the width with "wall length minus widths on this wall", which read the back wall as
    // full while the run had a clear stretch and two other walls stood empty (her screenshot
    // 2026-09-25: "why are the range cookers greyed out, there is tonnes of space"). Cabinets
    // with the same footprint share one answer, so the catalogue stays quick to redraw.
    const r = this.store.state.room, bounds = { minX: -r.width / 2, maxX: r.width / 2, minZ: -r.depth / 2, maxZ: r.depth / 2 };
    const fitCache = new Map();
    const fitsSomewhere = (c) => {
      if (this.activeWall === 'island') return true;
      const key = `${c.w}|${c.d}|${c.type}|${c.corner ? c.cornerSide : ''}|${c.onTall ? 1 : 0}|${c.appliance || ''}|${c.form}`;
      if (!fitCache.has(key)) fitCache.set(key, !!findFreeSpot(this.store.state, c, bounds, this.activeWall));
      return fitCache.get(key);
    };
    for (const fam of FAMILY_ORDER) {
      // an island is built from base cabinets plus the appliances that really
      // live in one — ranges, cooktops and sinks (Rockledge-style island
      // cooking). Wall/counter/tall units and hoods/fridges still need a wall.
      if (this.activeWall === 'island' && fam !== 'FLOOR' && fam !== 'APPLIANCES') continue;
      // stackers group under their own section (familyOf), not under WALL
      const all = CATALOGUE.filter((c) => familyOf(c) === fam && c.placeable);
      // base-run cabinets wider than the remaining wall length are shown but cannot be tapped
      const items = all.filter((c) => {
        if (this.activeWall === 'island' && c.type === 'APPLIANCES' &&
            !['range', 'hob', 'sink'].includes(c.appliance)) return false;
        if (!this._isBaseRun(c)) return true;
        const fits = c.w <= remaining + TOL || fitsSomewhere(c);
        // what will not fit stays on the shelf, dimmed, saying what it needs: a hidden
        // 36" double read as "there are no double counter cabinets" (her question 2026-09-22)
        if (!fits) { tooWide.add(c.code); hiddenAny = true; }
        return true;
      });
      if (!items.length) continue;
      const open = ''; // all catalogue groups start collapsed
      const glyph = items[0] ? `<span class="cat-fam-ico" aria-hidden="true">${cabinetSVG(items[0])}</span>` : '';
      html += `<details class="cat-group" ${open}><summary>${glyph}${FAMILY_LABEL[fam]}<span class="cat-count">${items.length}</span></summary><div class="cat-grid">`;
      // the STACKERS list leads with ONE tile that does the matching: the right stacker on every
      // tall, wall and counter cabinet on this wall (her: "if I can't see how to add stackers
      // how will anyone else", 2026-09-22). The same plan sits on the wall card and in Arrange.
      if (fam === 'STACKER') {
        const p = planStackers(this.store.state, null);          // the whole kitchen, whichever wall tab is up
        if (p.ok) html += `<button type="button" class="cat-item cat-combo cat-stack" data-stack="all" title="Puts the matching stacker on each tall, wall and counter cabinet in the kitchen, in the height the ceiling allows">
          <span class="cat-thumb">${cabinetSVG(getCab(p.placements[0].code))}</span>
          <span class="ci-code">Add stackers</span>
          <span class="ci-desc">${p.placements.length} stacker${p.placements.length === 1 ? '' : 's'}, ${p.size}", matched to each tall, wall and counter cabinet in the kitchen</span>
          <span class="ci-meta">${p.placements.map((q) => q.code).join(' · ')}</span></button>`;
        else if (p.reason === 'too low') html += `<div class="hint" style="margin:2px 0 8px">The ceiling is ${fmtFeetIn(p.ceiling)}: stackers need ${fmtFeetIn(p.need)} for 15" or ${fmtFeetIn(p.need + 6)} for 21", with their crown. Change the ceiling under Room and a one-press "Add stackers" appears here.</div>`;
        else if (p.reason === 'no hosts') html += `<div class="hint" style="margin:2px 0 8px">Stackers sit on tall, wall and counter cabinets. Add those first and a one-press "Add stackers" appears here.</div>`;
      }
      // "Sink base" shortcuts lead the Floor list: a real base + a real sink, centred, in one tap
      if (fam === 'FLOOR') {
        for (const combo of SINK_BASES) {
          const b = getCab(combo.base), sk = getCab(combo.sink);
          if (!b || !sk) continue;
          if (this.activeWall !== 'island' && b.w > remaining + TOL && !fitsSomewhere(b)) continue;
          html += `<button type="button" class="cat-item cat-combo" data-combo="${combo.id}" title="Adds ${b.code} · ${b.desc} ${fmtIn(b.w)} with a ${sk.desc} centred in it. The sink is not supplied">
          <span class="cat-thumb">${cabinetSVG(b, { sink: sk })}</span>
          <span class="ci-code">${b.code} + sink</span>
          <span class="ci-desc">${combo.label}</span>
          <span class="ci-meta">${combo.bowl} &middot; ${fmtUSD(sellUSD(b))}</span>
        </button>`;
        }
      }
      const ceiling = this.store.state.room.height || 96;
      // sub-headings inside the big families, so like sits with like (her ask 2026-09-22: "group the
      // floor cabinets in a better way, the dishwashers next to each other, more intuitive")
      const SUB = { FLOOR: (c) => (c.form === 'corner' ? 'Corners' : c.form === 'drawers' && !/cooktop/i.test(c.desc) ? 'Drawers' : c.form === 'dishwasher' ? 'Appliance fronts' : c.form === 'ovenBase' || /cooktop/i.test(c.desc) ? 'Cooking' : c.form === 'bin' || c.form === 'tray' ? 'Pull-outs and trays' : c.form === 'open' ? 'Open shelves' : c.form === 'leg' ? 'End leg' : c.halfDepth ? 'Doors, half depth' : 'Doors'),
        WALL: (c) => (c.corner ? 'Corners' : c.form === 'open' ? 'Open shelves' : c.hoodCover ? 'Hood cover' : c.glazed ? 'Glazed' : 'Doors'), HIGH: (c) => (c.corner ? 'Corners' : c.form === 'open' ? 'Open shelves' : c.glazed ? 'Glazed' : 'Doors'),
        COUNTER: (c) => (c.form === 'open' ? 'Open shelves' : c.glazed ? 'Glazed' : 'Doors'), TALL: (c) => (c.form === 'ovenHousing' ? 'Oven housings' : c.form === 'housing' ? 'Fridge housings' : c.corner ? 'Corners' : 'Larders'),
        STACKER: (c) => (c.onTall ? 'On a tall' : /fits C/.test(c.desc || '') ? 'On a counter cabinet' : 'On a wall cabinet'),
        APPLIANCES: (c) => (c.appliance === 'range' ? 'Ranges' : c.appliance === 'hob' ? 'Cooktops' : c.appliance === 'oven' ? 'Ovens' : c.appliance === 'sink' ? 'Sinks' : c.appliance === 'hood' ? 'Hoods' : 'Fridges') };
      const ORDER = { FLOOR: ['Doors', 'Doors, half depth', 'Drawers', 'Corners', 'Pull-outs and trays', 'Open shelves', 'Appliance fronts', 'Cooking', 'End leg'], WALL: ['Doors', 'Glazed', 'Corners', 'Open shelves', 'Hood cover'], HIGH: ['Doors', 'Glazed', 'Corners', 'Open shelves'], COUNTER: ['Doors', 'Glazed', 'Open shelves'], TALL: ['Larders', 'Fridge housings', 'Oven housings', 'Corners'], STACKER: ['On a tall', 'On a wall cabinet', 'On a counter cabinet'], APPLIANCES: ['Ranges', 'Cooktops', 'Ovens', 'Hoods', 'Sinks', 'Fridges'] };
      const subOf = SUB[fam];
      if (subOf) { const rank = (c) => { const o = ORDER[fam] || [], i = o.indexOf(subOf(c)); return i === -1 ? 99 : i; }; items.sort((p, q) => rank(p) - rank(q) || (subOf(p) < subOf(q) ? -1 : subOf(p) > subOf(q) ? 1 : 0)); }
      let lastSub = null;
      for (const c of items) {
        if (subOf) { const sub = subOf(c); if (sub !== lastSub) { html += `<div class="cat-sub">${sub}</div>`; lastSub = sub; } }
        // a full-height wall cabinet the ceiling cannot take stays on the shelf, dimmed, saying what it needs
        if (c.high && 56 + c.h + 3 > ceiling) tooWide.add(c.code);
        const wide = tooWide.has(c.code);
        const meta = wide ? (c.high ? `needs a ${fmtFeetIn(56 + c.h + 3)} ceiling` : `needs ${fmtIn(c.w)} of wall`)
          : c.notSupplied ? `${fmtIn(c.w)} &middot; <em>not supplied</em>` : c.priceTBC ? `${fmtIn(c.w)} &middot; <em>price to confirm</em>` : `${fmtIn(c.w)} &middot; ${fmtUSD(sellUSD(c))}`;
        html += `<button type="button" class="cat-item${c.notSupplied ? ' is-appliance' : ''}${wide ? ' is-toowide' : ''}" data-code="${c.code}" ${wide ? 'disabled' : ''} title="${wide ? (c.high ? `${c.code} · ${c.desc} tops out at ${fmtIn(56 + c.h)} and needs ${fmtFeetIn(56 + c.h + 3)} of ceiling for its crown. The room is ${fmtFeetIn(ceiling)}: change it under Room` : `${c.code} · ${c.desc} needs ${fmtIn(c.w)} of clear wall and no wall has that left. Make room, or use Island`) : `Add ${c.code} · ${c.desc}${c.notes ? ', ' + c.notes : ''}`}">
          <span class="cat-thumb">${cabinetSVG(c)}</span>
          <span class="ci-code">${c.code}</span>
          <span class="ci-desc">${c.desc}</span>
          <span class="ci-meta">${meta}</span>
        </button>`;
      }
      html += `</div></details>`;
    }
    if (this.activeWall !== 'island' && hiddenAny) {
      html += `<div class="hint" style="margin-top:8px">Greyed-out cabinets have no clear stretch of wall left for them on any wall, or are taller than the ceiling. Pick a narrower one, make room, use Island, or change the ceiling under Room.</div>`;
    }
    return html;
  }

  _wireCatalogue() {
    document.getElementById('catalogue').addEventListener('click', (e) => {
      const row = e.target.closest('.cat-item');
      if (!row) return;
      if (row.dataset.stack) { this._stackWall(); return; }
      if (row.dataset.combo) {
        const combo = sinkBaseCombo(row.dataset.combo);
        const res = combo && this.controls.placeSinkBase(combo, this.activeWall);
        if (res) this._toast(`${getCab(combo.base).desc} ${fmtIn(getCab(combo.base).w)} added with its sink. Click the sink to change its size.`);
        return;
      }
      const res = this.controls.placeNew(row.dataset.code, this.activeWall, { safe: true });   // a person tapping: never outside the room
      this._announcePlaced(res);
      // a plain cabinet or appliance now rides on the pointer until the next click drops it;
      // anything that SEATED itself (a sink in its base, an oven in its housing, a hood over
      // the cooker, a cooktop base with its cooktop) stays put
      const cab = res && getCab(res.code);
      const seated = !res || res.id == null || res.refused || res.noRoom || res.seated || res.overCooker || res.broughtHousing || res.ovenStack || res.withCooktop
        || !cab || cab.appliance === 'oven' || cab.form === 'ovenBase' || /cooktop/i.test(cab.desc || '');
      if (!seated && this.controls.carry?.(res.id) && !this._carryHinted) {
        this._carryHinted = true;
        this._toast('It follows your mouse: click where it should go. Esc puts it back.');
      }
    });
  }

  // a wall oven cannot float: it goes into an empty housing of its size, and
  // when the room has none its housing arrives with it (a priced cabinet, so say so)
  _announcePlaced(res) {
    if (!res) return;
    if (res.noRoom) { this._toast(`There is no space left for ${getCab(res.code)?.desc || 'that'}. Make room, or make the room bigger.`); return; }
    if (res.movedTo) {
      const where = { back: 'the back wall', left: 'the left wall', right: 'the right wall', front: 'the front wall', floor: 'the floor, free-standing' }[res.movedTo];
      this._toast(`That wall is full, so it is on ${where}. Drag it where it belongs.`);
    }
    if (res.refused) {
      const h = res.needs && getCab(res.needs);
      this._toast(h ? `A wall oven lives in an oven housing. Pick a wall, then add it again and the ${h.code} ${h.desc} comes with it.` : 'A wall oven lives in an oven housing.');
    } else if (res.broughtHousing) {
      const h = getCab(res.broughtHousing);
      this._toast(`${getCab(res.code).desc} added in a ${h.code} ${h.desc} (${fmtUSD(sellUSD(h))}). Undo takes both out.`);
    } else if (getCab(res.code)?.appliance === 'oven') this._toast(`${getCab(res.code).desc} fitted into the empty oven housing.`);
    else if (res.overCooker) this._toast('Range hood centred over the cooker, 800mm above it. Drag it to another cooker if you have more than one.');
    else if (res.withCooktop) this._toast(`${getCab(res.code).desc} added with a ${getCab(res.withCooktop).desc} on the worktop over it (supply your own). Undo takes both out.`);
    else if (res.ovenStack) this._toast('Oven housing added with its oven inside, a 24" cooktop on the worktop over it and a 24" hood above. Oven, cooktop and hood are supply your own. Undo takes all four out.');
    else if (getCab(res.code)?.appliance === 'hood') this._toast('No range or cooktop yet: add one and the hood will move over it when you drag it.');
  }

  // ---------- room ----------
  _wireRoom() {
    const bind = (id, key) => {
      const el = document.getElementById(id);
      el.addEventListener('change', () => {
        const v = parseRoomLength(el.value);
        // a wall is 4 ft to 60 ft, a ceiling 6 ft to 20 ft: anything else is a slip of the keys
        const [lo, hi] = key === 'height' ? [72, 240] : [48, 720];
        if (isFinite(v) && (v < lo || v > hi)) this._toast(`That reads as ${fmtFeetIn(v)}. Try feet and inches like 16' 0", 16 ft, or plain inches like 192.`);
        if (isFinite(v) && v >= lo && v <= hi) {
          // the kitchen stays ON ITS WALLS (core/roomresize.js): the room grows and shrinks at its right and front
          const plan = key === 'height' ? null : planRoomResize(this.store.state, { [key]: v });
          this.store.beginHistory();             // ONE undo step
          this.store.setRoom({ [key]: v });
          if (plan) {
            for (const m of plan.moves) this.store.updateItem(m.id, { x: m.x, z: m.z }, { quiet: true });
            for (const o of plan.openings) this.store.updateOpening(o.id, { pos: o.pos });
            for (const bx of plan.boxings) this.store.updateBoxing(bx.id, { pos: bx.pos });
          }
          this.store.endHistory();
          if (plan && plan.moves.length) this.controls.layer.rebuildAll?.();
          this.onRoomChange(true);   // dimensions changed → re-frame camera
          if (plan) this.flagRoomFit(plan, true);
          this._renderWallFit();
          this._refreshCatalogue();
        }
        this._refreshRoomInputs();
      });
    };
    bind('roomW', 'width');
    bind('roomD', 'depth');
    bind('roomH', 'height');
    this._renderRoomPlan();
  }

  /** After cabinets were brought back inside the room (core/roomresize.js): say what moved and
   *  WHERE the dimension problem is, and open that wall's tab so its red bar and card are in view. */
  flagRoomFit(plan, resized = false) {
    const NAME = { back: 'back wall', front: 'front wall', left: 'left wall', right: 'right wall', island: 'island' };
    if (plan.issues.length) {
      const first = plan.issues[0], tab = first.wall === 'back' ? 'back' : first.wall === 'island' ? 'island' : 'left';
      if (this.activeWall !== tab && first.wall !== 'front') { this.activeWall = tab; this._refreshCatalogue(); }
      this._renderWallFit();
      const list = plan.issues.map((i) => (i.wall === 'island' ? `the island is ${fmtIn(i.over)} longer than the room` : `the run on the ${NAME[i.wall]} is ${fmtIn(i.over)} longer than the space it has`)).join(', and ');
      this._toast(`Everything has been kept inside the room, but ${list}, so cabinets overlap at the far end. Take one out, swap one for a narrower size${resized ? ', or make the room bigger again. Undo puts the size back' : ', or make the room bigger'}.`);
    } else if (plan.inside) {
      this._renderWallFit();
      this._toast(resized ? `${plan.inside} cabinet${plan.inside === 1 ? ' was' : 's were'} moved to stay inside the room. Undo puts the size back.` : `${plan.inside} cabinet${plan.inside === 1 ? ' was' : 's were'} outside the room and ${plan.inside === 1 ? 'has' : 'have'} been moved back inside.`);
    }
  }

  _refreshRoomInputs() {
    const r = this.store.state.room;
    document.getElementById('roomW').value = fmtFeetIn(r.width);
    document.getElementById('roomD').value = fmtFeetIn(r.depth);
    document.getElementById('roomH').value = fmtFeetIn(r.height);
    this._renderRoomPlan();
    this._refreshSummaries();
  }

  // ---------- live value summaries on the ROOM tab dropdown bars ----------
  // Each closed bar shows its current state ("12' × 10' · 8' ceiling",
  // "Oak · Chalk", "Marble", …) so you can read the whole setup at a glance.
  _refreshSummaries() {
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    const s = this.store.state;
    const r = s.room || {};
    const ftShort = (v) => fmtFeetIn(v).replace(/' 0"$/, "'"); // 12' 0" → 12'
    set('sumRoomSize', `${ftShort(r.width)} × ${ftShort(r.depth)} · ${ftShort(r.height)} ceiling`);
    const floor = FLOORS[r.floor]?.label, wall = WALLS[r.wall]?.label;
    set('sumStyle', [floor, wall].filter(Boolean).join(' · '));
    set('sumWorktop', WORKTOP_OPTIONS[r.worktop]?.label || 'None');
    set('sumCornice', corniceOption(r.cornice || 'none')?.label || 'None');
    const ops = r.openings || [];
    const opCount = (t) => ops.filter((o) => o.type === t).length;
    const opBits = [['window', 'window'], ['door', 'door'], ['doorway', 'doorway']]
      .map(([t, n]) => { const c = opCount(t); return c ? `${c} ${n}${c > 1 ? 's' : ''}` : ''; })
      .filter(Boolean);
    set('sumOpenings', opBits.length ? opBits.join(' · ') : 'None');
    const nbx = (r.boxings || []).length;
    set('sumBoxing', nbx ? `${nbx} bulkhead${nbx > 1 ? 's' : ''}` : 'None');
    const nacc = Object.values(s.accessories || {}).reduce((a, b) => a + (b || 0), 0);
    set('sumAccessories', nacc ? `${nacc} added` : 'None');
  }

  // ---------- finishes ----------
  _finishesHTML() {
    const groups = [...new Set(FINISHES.map((f) => f.group))];
    let html = '';
    for (const g of groups) {
      html += `<div class="fin-group-label">${g}</div><div class="swatches">`;
      for (const f of FINISHES.filter((x) => x.group === g)) {
        html += `<div class="swatch" data-finish="${f.name}" title="${f.desc}">
          <div class="chip" style="background:${f.hex}"></div>
          <div class="sw-name">${f.name}</div>
        </div>`;
      }
      html += `</div>`;
    }
    return html;
  }

  _wireFinishes() {
    document.getElementById('finishes').addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (!sw) return;
      this.store.setFinish(sw.dataset.finish);
    });
  }

  _refreshFinish() {
    const cur = this.store.state.finish;
    document.querySelectorAll('#finishes .swatch').forEach((sw) => {
      sw.classList.toggle('active', sw.dataset.finish === cur);
    });
    const f = getFinish(cur);
    document.getElementById('finishName').textContent = `${f.name}: ${f.desc}`;
  }

  /** A click on a line in "This kitchen" selects that cabinet in 3D; clicked again it steps to the
   *  next one of its kind, so "one of 2" can be told apart. */
  _wireCostLines() {
    document.getElementById('costLines')?.addEventListener('click', (e) => {
      const line = e.target.closest('.cost-line[data-code]'); if (!line) return;
      const code = line.dataset.code;
      const ids = this.store.state.items.filter((it) => it.code === code).map((it) => it.id);
      if (!ids.length) return;
      const cur = this.controls?.layer?.selectedId ?? this.controls?.selectedId ?? null;
      const next = ids[(ids.indexOf(cur) + 1) % ids.length];
      this.controls?.layer?.select?.(next);
      this.showSelbar(next);
    });
  }

  // ---------- cost ----------
  _refreshCost() {
    const { lines, totalCabs, subtotal } = summarizeState(this.store.state);
    const body = document.getElementById('costLines');
    if (!totalCabs) {
      body.innerHTML = `<div class="hint">No cabinets yet. Add blocks from the catalog, then drag them to a wall. They snap edge-to-edge into a run.</div>`;
    } else {
      // homeowners read the name first ("Floor cabinet · Single 24\"") with the
      // code tucked after it; TRADE keeps the code-first list it works from
      const home = this.store.state.mode !== 'trade';
      const label = (l) => {
        if (!home) return `${l.code} <span class="cl-desc">${l.desc}</span>`;
        const fam = l.stacker ? 'Stacker' : FAMILY_LABEL[l.type];
        const isCab = ['FLOOR', 'WALL', 'COUNTER', 'TALL'].includes(l.type);
        const name = isCab
          ? `${fam} cabinet <span class="cl-desc">${l.desc}${l.w ? ' ' + fmtIn(l.w) : ''}</span>`
          : `<span class="cl-desc">${l.desc}</span>`;
        return `${name} <span class="cl-code">${l.code}</span>`;
      };
      body.innerHTML = lines.map((l) => `<div class="cost-line" data-code="${l.code}" data-qty="${l.qty}">
        <span><strong>${l.qty}×</strong> ${label(l)}</span>
        <span>${l.notSupplied ? '<em style="color:var(--muted)">supply your own</em>' : l.priceTBC ? '<em style="color:var(--muted)">price to confirm</em>' : fmtUSD(l.line)}</span></div>`).join('');
      this._markPickedLine();
    }
    document.getElementById('costTotal').innerHTML =
      `<span>${totalCabs} cabinet${totalCabs === 1 ? '' : 's'}</span><span>${fmtUSD(subtotal)}</span>`;
    const dl = document.getElementById('costDelivery');
    if (dl) {
      if (totalCabs > 0) { const d = deliveryEstimate(totalCabs); dl.innerHTML = `Estimated delivery <strong>${d.weeksLo}–${d.weeksHi} weeks</strong> · around ${d.from} – ${d.to}`; }
      else dl.innerHTML = '';
    }
    const empty = document.getElementById('emptyState');
    if (empty) empty.classList.toggle('hidden', totalCabs > 0 || !!this._emptyDismissed); // !! — an undefined force would bare-toggle
    this._lastSubtotal = subtotal;
    this._refreshBudget();
    this._refreshWarnings();
  }

  _refreshBudget() {
    const el = document.getElementById('budgetReadout');
    if (!el) return;
    const budget = this.store.state.customer?.budget || 0;
    const spent = this._lastSubtotal || 0;
    if (!budget || !spent) { el.innerHTML = ''; el.className = 'budget-readout'; return; }
    const diff = budget - spent;
    if (diff >= 0) {
      el.className = 'budget-readout under';
      el.innerHTML = `<strong>${fmtUSD(diff)} under budget</strong> · ${fmtUSD(spent)} of ${fmtUSD(budget)}`;
    } else {
      el.className = 'budget-readout over';
      el.innerHTML = `<strong>${fmtUSD(-diff)} over budget</strong> · ${fmtUSD(spent)} of ${fmtUSD(budget)}`;
    }
  }

  _refreshWarnings() {
    const el = document.getElementById('warnings');
    if (!el) return;
    const ws = computeWarnings(this.store.state);
    if (!ws.length) { el.innerHTML = ''; return; }
    el.innerHTML = ws.map((w) =>
      `<div class="warn-item warn-${w.level}"><span class="warn-ico">${w.level === 'error' ? '!' : 'i'}</span>${w.msg}</div>`).join('');
  }

  // ---------- customer + order ----------
  _wireCustomer() {
    const bind = (id, key) => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => this.store.setCustomer({ [key]: el.value }));
    };
    bind('custName', 'name');
    bind('custEmail', 'email');
    bind('custZip', 'zip');
    bind('custNotes', 'notes');

    const budgetEl = document.getElementById('budgetInput');
    if (budgetEl) budgetEl.addEventListener('input', () => {
      const n = parseInt(String(budgetEl.value).replace(/[^0-9]/g, ''), 10);
      this.store.setCustomer({ budget: isFinite(n) ? n : 0 });
      this._refreshBudget();
    });

    document.getElementById('placeOrder').addEventListener('click', async () => {
      const s = this.store.state;
      if (!s.items.length) return this._toast('Add some cabinets first.');
      if (!s.customer.name || !s.customer.email) return this._toast('Add your name and email so we can reach you.');
      const mail = buildOrderEmail(s);
      // every homeowner order gets a reference the customer can quote back —
      // it rides at the top of the order text AND in orders.order_no
      const orderNo = genOrderNo();
      const orderText = `Order ref: ${orderNo}\n\n${mail.body}`;
      const sum = summarizeState(s);
      // send the order DIRECTLY (no email client); on ANY failure show the
      // composed order in a copyable modal — never a bare location.href, which
      // does nothing visible when no mail app is configured
      const btn = document.getElementById('placeOrder');
      if (isCloud()) {
        btn.disabled = true;
        try {
          await submitOrder({
            name: s.customer.name, email: s.customer.email, zip: s.customer.zip,
            notes: s.customer.notes, orderText, design: this.store.serialize(),
            cabinets: sum.totalCabs, subtotal: sum.subtotal, orderNo,
          });
          btn.disabled = false;
          this._showOrderSuccess(orderNo, sum, s);
          return;
        } catch (err) { btn.disabled = false; /* fall through to the email modal */ }
      }
      mailFallback({
        title: 'Send your order by email',
        sub: 'The order could not reach PL/NTH directly. Nothing is lost. Copy the message below, or open it in your email app.',
        subject: `PL/NTH order ${orderNo}`,
        body: orderText,
        href: mail.href,
      });
    });
  }

  // "Order received" — the confirmation a five-figure purchase deserves:
  // a reference number to quote, what happens next, and a record on screen
  // (the old 2.6-second toast left nothing behind).
  _showOrderSuccess(orderNo, sum, s) {
    document.getElementById('homeOrderModal')?.remove();
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const m = document.createElement('div');
    m.id = 'homeOrderModal';
    m.innerHTML = `<div class="cloud-card order-modal order-success">
      <h3>Order received ✓</h3>
      <div class="order-no-big">${esc(orderNo)}</div>
      <p class="cloud-sub">Thank you${s.customer.name ? `, ${esc(s.customer.name.split(' ')[0])}` : ''}. This kitchen
        (${sum.totalCabs} cabinets · ${fmtUSD(sum.subtotal)}) is with PL/NTH.
        We check it over and email the fixed quote to
        <strong>${esc(s.customer.email)}</strong>.
        Keep the reference above. It identifies your order in any conversation.</p>
      <div class="order-modal-btns">
        <button class="cta" id="hosDone">Done</button>
      </div>
      <button class="cloud-x" id="hosClose">×</button></div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    m.querySelector('#hosClose').addEventListener('click', close);
    m.querySelector('#hosDone').addEventListener('click', close);
  }

  // ---------- toolbar ----------
  _wireToolbar() {
    document.getElementById('btnExport').addEventListener('click', () => exportJSON(this.store));
    document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('importFile').addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      importJSON(this.store, f, (ok) => {
        this._toast(ok ? 'Plan loaded.' : 'Could not read that file.');
        if (ok) { this.onRoomChange(true); this._refreshRoomInputs(); this._refreshRoomStyle(); this._refreshFinish(); this._refreshCost(); this._syncCustomer(); }
      });
      e.target.value = '';
    });
    document.getElementById('btnClear').addEventListener('click', async () => {
      if (await uiConfirm('Every cabinet comes off the plan. You can undo this.', {
        title: 'Clear the whole plan?', confirmLabel: 'Clear it',
      })) this.store.clear();
    });
  }

  _syncCustomer() {
    const c = this.store.state.customer;
    document.getElementById('custName').value = c.name || '';
    document.getElementById('custEmail').value = c.email || '';
    document.getElementById('custZip').value = c.zip || '';
    document.getElementById('custNotes').value = c.notes || '';
    const b = document.getElementById('budgetInput'); if (b) b.value = c.budget ? '$' + c.budget.toLocaleString('en-US') : '';
    this._refreshBudget();
  }

  // ---------- selected-item bar ----------
  _wireSelbar() {
    // swap-in-place: same-width alternative keeps the exact position/rotation
    document.getElementById('selSwap')?.addEventListener('change', (e) => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      const code = e.target.value;
      if (code) { this.store.swapItem(id, code); this.showSelbar(id); }
    });
    // range cooker size: pick 30 / 36 / 48 and the run beside it makes room
    // (slides into free wall first, then a neighbour drops to a narrower twin)
    document.getElementById('selSize')?.addEventListener('change', async (e) => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      if (getCab(e.target.value)?.appliance === 'sink') {       // a sink rides in the worktop: a straight swap, the live warning says if its base is too small
        this.store.swapItem(id, e.target.value);
        this.showSelbar(id);
        this._toast(`${getCab(e.target.value).desc} fitted.`);
        return;
      }
      const plan = planRangeResize(this.store.state, id, e.target.value);
      if (!plan.ok) { this._toast(plan.reason); this.showSelbar(id); return; }
      // sliding and narrowing just happen; taking a cabinet OUT is asked first
      if (plan.removes.length && !(await uiConfirm(
        `This run is full. To fit the ${getCab(plan.code).desc}, the ${plan.removes.map((r) => r.desc).join(' and the ')} comes out and the rest of the run moves over. Undo puts it all back.`,
        { title: 'Make room?', confirmLabel: 'Make room', cancelLabel: 'Keep this size' }))) { this.showSelbar(id); return; }
      this.store.beginHistory();             // the whole reshuffle is ONE undo step
      for (const r of plan.removes) this.store.removeItem(r.id);
      this.store.swapItem(id, plan.code);
      for (const s of plan.swaps) this.store.swapItem(s.id, s.code);
      for (const m of plan.moves) this.store.updateItem(m.id, { x: m.x, z: m.z });
      this.store.endHistory();
      this.controls.layer.select(id);        // neighbour swaps reselect themselves; hand it back
      this.showSelbar(id);
      const cab = getCab(plan.code);
      this._toast(plan.note ? `${cab.desc} fitted. ${plan.note}.` : plan.moves.length > 1 ? `${cab.desc} fitted. The cabinets beside it moved over.` : `${cab.desc} fitted.`);
    });
    // drawer inserts: a drawer bank offers the cutlery / utensil inserts made for its
    // width right here (they also live under Room > Accessories, where she could not find them)
    document.getElementById('selInsert')?.addEventListener('change', (e) => {
      const id = this.controls.layer.selectedId, code = e.target.value;
      if (id == null || !code) return;
      const n = (this.store.state.accessories?.[code] || 0) + 1;
      this.store.setAccessory(code, n);
      this._refreshAccessories();
      this.showSelbar(id);
      this._toast(`${getCab(code).desc} added to the estimate (${n} in this kitchen). Change the number under Room, Accessories.`);
    });
    document.getElementById('selHinge')?.addEventListener('click', () => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      this.store.flipHinge(id);
      this.showSelbar(id);
    });
    // one press: a storage row behind the island row (her ask 2026-09-21)
    document.getElementById('selDouble').addEventListener('click', () => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      const p = planIslandBack(this.store.state, id);
      if (!p.ok) { this._toast({ 'already double': 'This island is already double sided.', 'no room': 'There is no room behind it for a second row. Move the island forward first.', 'no fit': 'No storage row makes exactly this length. Drag a cabinet in behind it instead.' }[p.reason] || 'This is not an island cabinet.'); return; }
      const done = this.controls.placeInGap(p.placements);
      this._toast(done ? `Double sided: ${p.placements.map((q) => q.code).join(' + ')} behind it.${p.note === 'walkway' ? ` Only ${fmtIn(p.walkway)} of walkway is left behind it: 44" is the minimum.` : ''} Undo takes them back out.` : 'Something is in the way behind it.');
      if (done) this.showSelbar(id);
    });
    // wall cabinets matched about the range, or about the middle of the wall
    const mirror = (about) => () => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      const p = planMirror(this.store.state, id, about);
      if (!p.ok) { this._toast({ already: 'They already match.', blocked: 'Something is in the way of that spot (another cabinet, a tall or the window).', 'no range': 'There is no range on this wall.' }[p.reason] || 'Select a wall cabinet first.'); return; }
      this.controls.applyMoves(p.moves);
      const what = about === 'range' ? 'the range' : 'the middle of the wall';
      this._toast(p.partner ? `Matched: both are now ${fmtIn(p.dist)} from ${what}, edge to centre. Undo puts it back.` : `Centred on ${what}. Undo puts it back.`);
      this.showSelbar(id);
    };
    // the whole island, sideways, to the middle of the floor or onto the range
    const centre = (about) => () => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      const p = planIslandCentre(this.store.state, id, about);
      if (!p.ok) { this._toast({ already: 'It is already centred.', blocked: 'Something is in the way of that spot.', 'no range': 'There is no range on the back wall.' }[p.reason] || 'Select an island cabinet first.'); return; }
      this.controls.applyMoves(p.moves);
      this._toast(`Island centred ${about === 'range' ? 'on the range' : 'in the room'}: moved ${fmtIn(Math.abs(p.dx))} ${p.dx > 0 ? 'right' : 'left'}. Its distance from the run has not changed. Undo puts it back.`);
      this.showSelbar(id);
    };
    // the menu shuts when one of its buttons is pressed, or on a click anywhere else
    const arrange = document.getElementById('selArrange');
    arrange.addEventListener('click', (e) => { if (e.target.closest('button')) arrange.open = false; });
    document.addEventListener('pointerdown', (e) => { if (arrange.open && !arrange.contains(e.target)) arrange.open = false; });
    // the planner files islands itself (core/islands.js); this is the by-hand correction
    document.getElementById('selFileIsland').addEventListener('click', () => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      const it = this.store.state.items.find((i) => i.id === id); if (!it) return;
      const to = !it.island;
      this.store.fileIsland(id, to);
      this._toast(to ? 'Filed with the island: the island drawing, its worktop and the ISLAND list now include it. Undo puts it back.' : 'Filed with the wall run, no longer part of the island. Undo puts it back.');
      this.showSelbar(id);
    });
    document.getElementById('selStacker').addEventListener('click', () => { const id = this.controls.layer.selectedId; if (id != null) this._stackWall(id); });
    document.getElementById('selCentreRoom').addEventListener('click', centre('room'));
    document.getElementById('selCentreRange').addEventListener('click', centre('range'));
    document.getElementById('selMirrorRange').addEventListener('click', mirror('range'));
    document.getElementById('selMirrorWall').addEventListener('click', mirror('wall'));
    document.getElementById('selOpen').addEventListener('click', () => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      this.controls.layer.toggleOpen(id);
      this.showSelbar(id);
    });
    document.getElementById('selRotate').addEventListener('click', () => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      const it = this.store.getItem(id);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
      void it;
    });
    document.getElementById('selDuplicate').addEventListener('click', () => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      const it = this.store.getItem(id);
      if (getCab(it.code)?.appliance === 'oven') { this._announcePlaced(this.controls.placeNew(it.code, this.activeWall)); return; }
      const copy = this.store.addItem(it.code, { x: it.x + 4, z: it.z, rotDeg: it.rotDeg });
      this.controls.layer.select(copy.id);
      this.showSelbar(copy.id);
    });
    document.getElementById('selDelete').addEventListener('click', () => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      this.store.removeItem(id);
      this.showSelbar(null);
    });
  }

  /** The selected cabinet's line in "This kitchen" is lit and scrolled into view, tagged "this one"
   *  (or "one of 2" when the line stands for several), so the list answers WHICH cabinet was clicked
   *  (her ask 2026-09-25: "same when i click on a cabinet, highlight it in the list"). */
  _markPickedLine() {
    const body = document.getElementById('costLines');
    if (!body) return;
    body.querySelectorAll('.cost-line.is-picked').forEach((el) => { el.classList.remove('is-picked'); el.querySelector('.pick-tag')?.remove(); });
    const code = this._pickedCode;
    if (!code) return;
    const line = body.querySelector(`.cost-line[data-code="${CSS.escape(code)}"]`);
    if (!line) return;
    line.classList.add('is-picked');
    const qty = Number(line.dataset.qty) || 1;
    const tag = document.createElement('span'); tag.className = 'pick-tag'; tag.textContent = qty > 1 ? `one of ${qty}` : 'this one';
    line.firstElementChild?.appendChild(tag);
    try { line.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* old browser */ }
  }

  showSelbar(id) {
    const bar = document.getElementById('selbar');
    if (id == null) { bar.classList.remove('show'); this._pickedCode = null; this._markPickedLine(); return; }
    const it = this.store.getItem(id);
    const cab = getCab(it.code);
    this._pickedCode = it.code; this._markPickedLine();
    document.getElementById('selLabel').textContent = `${cab.code} · ${cab.desc}`;
    // swap-in-place options: same width/type/depth — drawers ↔ door ↔ open shelf
    const swap = document.getElementById('selSwap');
    if (swap) {
      const alts = swapAlternatives(it.code);
      if (alts.length) {
        const price = (a) => {
          const d = Math.round(sellUSD(a) - sellUSD(cab));
          return d === 0 ? 'same price' : (d > 0 ? `+$${d.toLocaleString('en-US')}` : `−$${Math.abs(d).toLocaleString('en-US')}`);
        };
        swap.innerHTML = `<option value="">⇄ Swap for…</option>` +
          alts.map((a) => `<option value="${a.code}">${a.code} · ${a.desc}${a.glazed ? '' : ''} (${price(a)})</option>`).join('');
        swap.value = '';
        swap.style.display = '';
      } else swap.style.display = 'none';
    }
    // size picker: range cookers and sinks
    const size = document.getElementById('selSize');
    if (size) {
      const isSink = cab.appliance === 'sink';
      const sizes = isSink ? sinkSizes(it.code) : rangeSizes(it.code);
      if (sizes.length > 1) {
        // ranges differ only by width; sinks also by single / double, so they show their name
        // (two doubles are 33": the 7" original and the 9"-deep Grande size, so depth is part of the name)
        const label = (c) => (isSink ? `${c.desc.replace(/^Sink /, '')}${/\d"$/.test(c.desc) ? '' : ` ${fmtIn(c.w)}`} · ${sinkSpec(c).depth}" deep` : fmtIn(c.w));
        size.innerHTML = sizes.map((c) => `<option value="${c.code}" ${c.code === cab.code ? 'selected' : ''}>${c.code === cab.code ? 'Size: ' : ''}${label(c)}</option>`).join('');
        size.style.display = '';
      } else size.style.display = 'none';
    }
    // drawer inserts for this width
    const ins = document.getElementById('selInsert');
    if (ins) {
      const opts = drawerInserts(it.code);
      if (opts.length) {
        const acc = this.store.state.accessories || {};
        ins.innerHTML = `<option value="">+ Drawer insert…</option>` + opts.map((a) =>
          `<option value="${a.code}">${a.desc} (+${fmtUSD(sellUSD(a))})${acc[a.code] ? ` · ${acc[a.code]} added` : ''}</option>`).join('');
        ins.value = ''; ins.style.display = '';
      } else ins.style.display = 'none';
    }
    // hinge toggle: single-leaf cabinets only, incl. fridge / oven housings
    // (core/hinge.js; corners are excluded — their hinge is fixed on the
    // blank-return side). The side prints on the plan KEY, schedule + cut sheets.
    const hingeBtn = document.getElementById('selHinge');
    if (hingeBtn) {
      const canHinge = canFlipHinge(cab);
      hingeBtn.style.display = canHinge ? '' : 'none';
      if (canHinge) hingeBtn.textContent = `Hinge: ${it.hinge === 'R' ? 'Right' : 'Left'} ⇄`;
    }
    // door toggle only for cabinets that actually have doors
    const rec = this.controls.layer.map.get(id);
    const hasDoors = rec && rec.group.userData.doors && rec.group.userData.doors.length;
    const openBtn = document.getElementById('selOpen');
    openBtn.style.display = hasDoors ? '' : 'none';
    openBtn.textContent = it.open ? 'Close doors' : 'Open doors';
    // island: "Make double sided" while it is a single row; wall cabinets: match about a point
    const dbl = planIslandBack(this.store.state, id);
    document.getElementById('selDouble').style.display = (dbl.ok || ['no room', 'no fit'].includes(dbl.reason)) ? '' : 'none';
    const cRoom = planIslandCentre(this.store.state, id, 'room'), cRange = planIslandCentre(this.store.state, id, 'range');
    document.getElementById('selCentreRoom').style.display = cRoom.reason === 'not island' ? 'none' : '';
    document.getElementById('selCentreRange').style.display = (cRange.ok && !(cRoom.ok && Math.abs(cRoom.dx - cRange.dx) < 0.25)) || (cRange.reason === 'blocked') ? '' : 'none';
    const sk = document.getElementById('selStacker'), skp = planStackers(this.store.state, null, id);
    sk.style.display = skp.ok ? '' : 'none';
    if (skp.ok) sk.textContent = `Add a stacker (${skp.placements[0].code}, ${skp.size}")`;
    const fi = document.getElementById('selFileIsland');
    fi.style.display = canFileIsland(this.store.state, id) ? '' : 'none';
    fi.textContent = it.island ? 'Not part of the island' : 'Part of the island';
    const mt = mirrorTargets(this.store.state, id);
    const alone = mt && !planMirror(this.store.state, id, 'wall').partner;
    const mr = document.getElementById('selMirrorRange'), mw = document.getElementById('selMirrorWall');
    mr.style.display = mt && mt.range != null ? '' : 'none';
    mw.style.display = mt ? '' : 'none';
    if (mt) { mr.textContent = mt.range != null && !planMirror(this.store.state, id, 'range').partner ? 'Centre over the range' : 'Match across the range'; mw.textContent = alone ? 'Centre on the wall' : 'Match across the wall'; }
    // "Arrange" appears only when it has something in it, and always starts closed
    const arr = document.getElementById('selArrange');
    arr.open = false;
    arr.style.display = [...arr.querySelectorAll('button')].some((b) => b.style.display !== 'none') ? '' : 'none';
    bar.classList.add('show');
  }

  // ---------- mobile ----------
  _wireMobile() {
    const mobile = window.matchMedia('(max-width: 820px)');
    // sheets start closed on a phone so the 3D view owns the screen
    if (mobile.matches) document.querySelectorAll('.panel').forEach((p) => p.classList.add('collapsed'));
    document.querySelectorAll('.panel-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = btn.closest('.panel');
        const opening = panel.classList.contains('collapsed');
        panel.classList.toggle('collapsed');
        // only one sheet open at a time on a phone
        if (opening && mobile.matches) {
          document.querySelectorAll('.panel').forEach((p) => { if (p !== panel) p.classList.add('collapsed'); });
        }
      });
    });
  }

  /** A window / door clicked in 3D: bring ITS card to the front — the Room tab, the Doors & windows
   *  drop open, the card scrolled into view and lit, "this one" on its head — so the numbers she
   *  changes are that opening's (her ask 2026-09-25: "when i click on this window it should
   *  highlight... which window it is so i can make changes"). Stays lit until another is clicked. */
  focusOpening(id) {
    const tabs = document.getElementById('lpTabs'), body = document.getElementById('leftBody');
    if (tabs && body) { tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'room')); body.classList.add('tab-room'); }
    document.getElementById('leftPanel')?.classList.remove('collapsed');
    const drop = document.getElementById('dropOpenings'); if (drop) drop.open = true;
    this._pickedOpening = id;
    this._renderOpenings();
    const row = document.querySelector(`#openingsList .op-row[data-id="${id}"]`);
    if (!row) return;
    try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { row.scrollIntoView(); }
  }

  /** "Window 2 of 2" — the same numbering the card carries, for the 3D popup's title. */
  openingOrdinal(o) { if (!this._nthOpening) this._renderOpenings(); return this._nthOpening ? this._nthOpening(o) : ''; }

  /** Public: show the left panel on its ROOM tab with the given setup drops open
   *  (a brand-new project unit starts here: room size, floorplan underlay, doors & windows). */
  showRoomTab(open = ['dropRoom']) {
    const tabs = document.getElementById('lpTabs'), body = document.getElementById('leftBody');
    if (!tabs || !body) return;
    tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'room'));
    body.classList.add('tab-room');
    document.getElementById('leftPanel')?.classList.remove('collapsed');
    for (const d of document.querySelectorAll('#tabRoom details.setup-drop')) d.open = open.includes(d.id);
    document.getElementById('roomW')?.focus?.();
    body.scrollTop = 0;
  }

  /** Public: resync every panel (used after the wizard builds a kitchen). */
  refresh() {
    this._refreshRoomInputs(); this._refreshRoomStyle(); this._refreshFinish();
    this._refreshCost(); this._renderWallFit(); this._refreshCatalogue(); this._refreshAccessories();
  }

  // ---------- change handling ----------
  _onChange(state, change) {
    if (['add', 'remove', 'update', 'swap', 'load', 'reset'].includes(change.type)) {
      this._refreshCost();
      this._refreshCornice();
      if (!change.quiet) { this._renderWallFit(); this._refreshCatalogue(); }
    }
    if (change.type === 'finish') { this._refreshFinish(); }
    if (change.type === 'load' || change.type === 'reset') { this._syncCustomer(); this._refreshRoomInputs(); this._refreshRoomStyle(); this._refreshCornice(); this._refreshAccessories(); }
  }

  _toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
}
