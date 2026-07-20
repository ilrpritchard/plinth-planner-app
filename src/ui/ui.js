// ui.js — builds the brand-matched panels and wires them to the store.

import {
  CATALOGUE, FAMILY_ORDER, FAMILY_LABEL, familyOf, FINISHES, getCab, sellUSD, fmtUSD, getFinish, WORKTOP_OPTIONS,
  CORNICE_OPTIONS, corniceOption, orderableAccessories, swapAlternatives,
} from '../core/catalogue.js';
import { planCornice } from '../core/cornice.js';
import { fmtIn, fmtFeetIn, parseLength } from '../core/units.js';
import { summarizeState, deliveryEstimate } from '../core/cost.js';
import { computeWarnings } from '../core/warnings.js';
import { openingWallLen, openingNearEdge } from '../core/openings.js';
import { buildOrderEmail } from '../core/order.js';
import { isCloud, submitOrder } from '../core/cloud.js';
import { exportJSON, importJSON } from '../core/persistence.js';
import { TEMPLATES, applyTemplate, planWallInfill } from '../core/templates.js';
import { cabinetSVG } from './icon.js';
import { uiConfirm, uiAlert } from './dialog.js';
import { FLOORS, WALLS } from '../scene/Room.js';

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

  _isBaseRun(cab) {
    return ['FLOOR', 'TALL', 'COUNTER'].includes(cab.type) ||
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
      bar = `<div class="wf-stats" style="justify-content:flex-start"><span>Free-standing — no length limit</span></div>`;
    }
    el.innerHTML = `<div class="wf-tabs">${tabs}</div>${bar}`;
    el.querySelector('.wf-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-wall]'); if (!b) return;
      this.activeWall = b.dataset.wall;
      this._renderWallFit();
      this._refreshCatalogue();
    });
    el.querySelector('#wfFill')?.addEventListener('click', () => {
      const placements = planWallInfill(this.store.state, this.activeWall);
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
    out.innerHTML = `<strong>${ft.toFixed(1)} linear ft</strong> of ${opt.label.toLowerCase()} · <strong>${fmtUSD(opt.sellPerFt * ft)}</strong> — added to your estimate.`;
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
    document.getElementById('floorSwatches').innerHTML = swHTML(FLOORS, 'floor');
    document.getElementById('wallSwatches').innerHTML = swHTML(WALLS, 'wall', false); // colours only
    document.getElementById('worktopSwatches').innerHTML = Object.entries(WORKTOP_OPTIONS).map(([k, v]) =>
      `<button type="button" class="rs-sw" data-worktop="${k}" title="${v.label}"><span class="rs-chip" style="background:${v.hex}"></span><span class="rs-name">${v.label}</span></button>`).join('');

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
    if (!ops.length) { el.innerHTML = `<div class="hint" style="opacity:0.7">None yet.</div>`; return; }
    el.innerHTML = ops.map((o) => {
      const len = openingWallLen(r, o.wall);
      const dist = fmtIn(openingNearEdge(r, o)); // honest gap from corner to the near edge (matches 3D)
      const isWin = o.type === 'window';
      const sill = o.sill ?? Math.max(36, r.height * 0.42);
      const hgt = o.hgt ?? Math.min(46, r.height * 0.45);
      return `<div class="op-row" data-id="${o.id}">
        <div class="op-head"><span><strong>${label[o.type] || 'Opening'}</strong> · ${WALLN[o.wall] || 'Back wall'}</span>
          <button class="op-del" data-act="del" title="Remove">&times;</button></div>
        <div class="op-controls">
          <input type="range" class="op-pos" min="0" max="1" step="0.005" value="${o.pos ?? 0.5}" title="Left / right" />
          <label class="op-mini">W <input type="text" class="op-w" value="${fmtIn(o.width || (isWin ? 48 : 34))}" /></label>
        </div>
        ${isWin ? `<div class="op-controls op-win" style="margin-top:6px">
          <label class="op-mini">Sill height <input type="text" class="op-sill" value="${fmtIn(sill)}" /></label>
          <label class="op-mini">Window height <input type="text" class="op-h" value="${fmtIn(hgt)}" /></label>
        </div>` : ''}
        <div class="op-dist">${dist} from corner</div>
      </div>`;
    }).join('');
    el.querySelectorAll('.op-row').forEach((row) => {
      const id = Number(row.dataset.id);
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        this.store.removeOpening(id); this.onRoomChange(false); this._renderOpenings();
      });
      row.querySelector('.op-pos').addEventListener('input', (e) => {
        this.store.updateOpening(id, { pos: parseFloat(e.target.value) }); this.onRoomChange(false);
        const o = (this.store.state.room.openings || []).find((x) => x.id === id);
        row.querySelector('.op-dist').textContent = `${fmtIn(openingNearEdge(this.store.state.room, o))} from corner`;
      });
      const num = (sel, key, min) => row.querySelector(sel)?.addEventListener('change', (e) => {
        const v = parseLength(e.target.value);
        if (isFinite(v) && v >= min) { this.store.updateOpening(id, { [key]: v }); this.onRoomChange(false); }
        this._renderOpenings();
      });
      num('.op-w', 'width', 8);
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
      for (const o of this.store.state.items) {
        const c = getCab(o.code);
        if (!c || c.type !== 'FLOOR') continue;
        const oh = ((o.rotDeg || 0) % 180) === 0;
        if (oh !== horiz) continue;
        const same = horiz ? Math.abs(o.z - sel.z) < 8 : Math.abs(o.x - sel.x) < 8;
        if (same) o.worktop = material;
      }
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
    for (const fam of FAMILY_ORDER) {
      // an island is built from base cabinets plus the appliances that really
      // live in one — ranges, cooktops and sinks (Rockledge-style island
      // cooking). Wall/counter/tall units and hoods/fridges still need a wall.
      if (this.activeWall === 'island' && fam !== 'FLOOR' && fam !== 'APPLIANCES') continue;
      // stackers group under their own section (familyOf), not under WALL
      const all = CATALOGUE.filter((c) => familyOf(c) === fam && c.placeable);
      // base-run cabinets wider than the remaining wall length are hidden
      const items = all.filter((c) => {
        if (this.activeWall === 'island' && c.type === 'APPLIANCES' &&
            !['range', 'hob', 'sink'].includes(c.appliance)) return false;
        if (!this._isBaseRun(c)) return true;
        const fits = c.w <= remaining + TOL;
        if (!fits) hiddenAny = true;
        return fits;
      });
      if (!items.length) continue;
      const open = ''; // all catalogue groups start collapsed
      const glyph = items[0] ? `<span class="cat-fam-ico" aria-hidden="true">${cabinetSVG(items[0])}</span>` : '';
      html += `<details class="cat-group" ${open}><summary>${glyph}${FAMILY_LABEL[fam]}<span class="cat-count">${items.length}</span></summary><div class="cat-grid">`;
      for (const c of items) {
        const meta = c.notSupplied ? `${fmtIn(c.w)} &middot; <em>not supplied</em>` : `${fmtIn(c.w)} &middot; ${fmtUSD(sellUSD(c))}`;
        html += `<button type="button" class="cat-item${c.notSupplied ? ' is-appliance' : ''}" data-code="${c.code}" title="Add ${c.code} · ${c.desc}${c.notes ? ' — ' + c.notes : ''}">
          <span class="cat-thumb">${cabinetSVG(c)}</span>
          <span class="ci-code">${c.code}</span>
          <span class="ci-desc">${c.desc}</span>
          <span class="ci-meta">${meta}</span>
        </button>`;
      }
      html += `</div></details>`;
    }
    if (this.activeWall !== 'island' && hiddenAny) {
      html += `<div class="hint" style="margin-top:8px">Some cabinets are hidden because they're wider than the ${fmtIn(remaining)} left on this wall. Pick a narrower one, switch walls, or use Island.</div>`;
    }
    return html;
  }

  _wireCatalogue() {
    document.getElementById('catalogue').addEventListener('click', (e) => {
      const row = e.target.closest('.cat-item');
      if (!row) return;
      this.controls.placeNew(row.dataset.code, this.activeWall);
    });
  }

  // ---------- room ----------
  _wireRoom() {
    const bind = (id, key) => {
      const el = document.getElementById(id);
      el.addEventListener('change', () => {
        const v = parseLength(el.value);
        if (isFinite(v) && v > 12) {
          this.store.setRoom({ [key]: v });
          this.onRoomChange(true);   // dimensions changed → re-frame camera
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
    document.getElementById('finishName').textContent = `${f.name} — ${f.desc}`;
  }

  // ---------- cost ----------
  _refreshCost() {
    const { lines, totalCabs, subtotal } = summarizeState(this.store.state);
    const body = document.getElementById('costLines');
    if (!totalCabs) {
      body.innerHTML = `<div class="hint">No cabinets yet. Add blocks from the catalog, then drag them to a wall — they snap edge-to-edge into a run.</div>`;
    } else {
      body.innerHTML = lines.map((l) => `<div class="cost-line">
        <span><strong>${l.qty}×</strong> ${l.code} <span class="cl-desc">${l.desc}</span></span>
        <span>${l.notSupplied ? '<em style="color:var(--muted)">supply your own</em>' : fmtUSD(l.line)}</span></div>`).join('');
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
      // send the order DIRECTLY (no email client); mailto only as a fallback
      const btn = document.getElementById('placeOrder');
      if (isCloud()) {
        btn.disabled = true;
        try {
          const sum = summarizeState(s);
          await submitOrder({
            name: s.customer.name, email: s.customer.email, zip: s.customer.zip,
            notes: s.customer.notes, orderText: mail.body, design: this.store.serialize(),
            cabinets: sum.totalCabs, subtotal: sum.subtotal,
          });
          btn.disabled = false;
          this._toast('Order received ✓ — an Order Advisor will check it and email your fixed quote.');
          return;
        } catch (err) { btn.disabled = false; /* fall through to email */ }
      }
      window.location.href = mail.href;
      this._toast('Opening your email to send the order…');
    });
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
    document.getElementById('selHinge')?.addEventListener('click', () => {
      const id = this.controls.layer.selectedId; if (id == null) return;
      this.store.flipHinge(id);
      this.showSelbar(id);
    });
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

  showSelbar(id) {
    const bar = document.getElementById('selbar');
    if (id == null) { bar.classList.remove('show'); return; }
    const it = this.store.getItem(id);
    const cab = getCab(it.code);
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
    // hinge toggle: single-door cabinets only (catalogue lists them as 'L&R';
    // corners are excluded — their hinge is fixed on the blank-return side)
    const hingeBtn = document.getElementById('selHinge');
    if (hingeBtn) {
      const canHinge = cab.hinge === 'L&R' && !cab.corner;
      hingeBtn.style.display = canHinge ? '' : 'none';
      if (canHinge) hingeBtn.textContent = `Hinge: ${it.hinge === 'R' ? 'Right' : 'Left'} ⇄`;
    }
    // door toggle only for cabinets that actually have doors
    const rec = this.controls.layer.map.get(id);
    const hasDoors = rec && rec.group.userData.doors && rec.group.userData.doors.length;
    const openBtn = document.getElementById('selOpen');
    openBtn.style.display = hasDoors ? '' : 'none';
    openBtn.textContent = it.open ? 'Close doors' : 'Open doors';
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
