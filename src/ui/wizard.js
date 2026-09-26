// wizard.js — a friendly guided start: pick a shape, set the room size, choose
// a finish, and we build a starting kitchen. Removes the blank-canvas barrier
// for first-time visitors. Reuses the same templates as Quick start.

import { TEMPLATES } from '../core/templates.js';
import { generateKitchen, wallFreeSpan } from '../core/layouts.js';
import { TALL_PROUD } from '../interaction/snapping.js';
import { FINISHES, getFinish, getCab, FRIDGE_SIZE_LIMITS } from '../core/catalogue.js';
import { parseLength, parseRoomLength, fmtFeetIn, fmtIn, COOK_SIDE_IN } from '../core/units.js';
import { getMountY } from '../models/cabinet.js';
import { openingCenter, openingWidth, boxingBoxes } from '../core/openings.js';
import { planBudgetSwaps } from '../core/budget.js';
import { cookerWindowClashes } from '../core/warnings.js';
import { hingesTowardCooker } from '../core/hinge.js';
import { designRationale } from '../core/rationale.js';

// ---- voice: the same wizard, two registers ---------------------------------
// KITCHEN (no unit) lays out one kitchen; PROJECT (a unit-type name) lays out
// a repeatable unit type inside a development. Both talk to developers,
// architects and builders: PL/NTH sells to multi-unit developments only, so
// neither register is homeowner copy. Pass the unit-type name (or null).
// Pure and node-testable; keep BOTH registers covered in tradevoice.test.js.
export function wizardVoice(unit) {
  if (!unit) {
    return {
      eyebrow: 'Layout',
      title: 'Lay out a kitchen',
      sub: 'A few quick choices and the planner drafts a layout to start from. Keep what works, then change anything.',
      roomLead: 'The room, wall to wall',
      applLead: 'Appliances',
      budgetLead: 'Target budget',
      finishLead: 'Finish',
      windowNote: 'Windows stay exactly where you put them under Room. With a window on the back wall, the sink goes beneath it.',
      buildCta: 'Draft the layout →',
      building: 'Drafting the layout…',
      rerolling: 'Drafting another…',
      resultMsg: 'A starting layout. Change anything.',
      rerollBtn: '↻ Another layout',
      rerollTitle: 'Draft a different layout for the same room',
      keepBtn: 'Start editing →',
      showSave: true,               // "♥ Save" → the customer account
    };
  }
  return {
    eyebrow: 'Unit setup',
    title: `Lay out ${unit}`,
    sub: 'Room dimensions, openings and the appliance spec. We generate a starting layout you refine once, and it repeats across every floor.',
    roomLead: 'Room dimensions, wall to wall',
    applLead: 'Appliance spec',
    budgetLead: 'Target budget per unit',
    finishLead: 'Finish',
    windowNote: 'Windows stay exactly where they are on the plan. With a window on the back wall, the sink goes beneath it.',
    buildCta: 'Generate unit layout →',
    building: 'Generating the unit layout…',
    rerolling: 'Generating an alternative…',
    resultMsg: 'Starting layout for this unit type.',
    rerollBtn: '↻ Alternative layout',
    rerollTitle: 'Generate a different layout for the same unit',
    keepBtn: 'Refine this layout →',
    showSave: false,                // trade saves through the unit's Done banner
  };
}

const escV = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- little plan glyphs for the shape cards — top-down cream line-art -----
function shapeGlyph(id) {
  const room = '<rect x="3.5" y="3.5" width="37" height="27" rx="1.5" class="g-room"/>';
  const runs = {
    'one-wall': '<path class="g-run" d="M7 8.5 H37"/>',
    'l-shape': '<path class="g-run" d="M7 8.5 H37 M8.5 7 V27"/>',
    'u-shape': '<path class="g-run" d="M7 8.5 H37 M8.5 7 V27 M35.5 7 V27"/>',
    'galley': '<path class="g-run" d="M7 8.5 H37 M7 25.5 H37"/>',
    'island': '<path class="g-run" d="M7 8.5 H37"/><rect class="g-isl" x="15" y="17.5" width="14" height="5.5" rx="1"/>',
  };
  return `<svg viewBox="0 0 44 34" xmlns="http://www.w3.org/2000/svg">${room}${runs[id] || runs['one-wall']}</svg>`;
}

export class Wizard {
  constructor({ store, controls, onBuilt, onSave, onCompare, tradeUnit, onEdit }) {
    this.store = store;
    this.controls = controls;
    this.onBuilt = onBuilt || (() => {});
    this.onSave = onSave || (() => {});
    this.onCompare = onCompare || null;
    this.onEdit = onEdit || null;
    this.tradeUnit = tradeUnit || null;  // () => unit-type name while designing from TRADE, else null
    this.el = document.getElementById('wizard');
    this.shape = TEMPLATES[0].id;
    this.door = '';                 // '' | 'left' | 'right' | 'front'
    this.doorDist = 60;             // inches from the reference corner to the door's NEAR edge
    this.doorW = 36;                // door width (inches)
    this.budget = store.state.customer?.budget || null;   // max spend (sell $), optional
    // appliance interview — defaults match the classic generator behaviour;
    // kept on the instance so "Generate again" re-rolls keep the choices.
    // fridgeSize (freestanding only): inches, becomes a sized 'AP9:WxDxH' code
    this.appliances = { cooking: 'range', fridge: 'integrated', dishwashers: 1, fridgeSize: { w: 36, d: 28, h: 70 } };
    this.finish = store.state.finish;
    this.seed = (Math.random() * 1e9) | 0;
    this.lastShape = null;
  }

  /** The doors and doorways the room already has under Room (not the wizard's own picker). */
  _ownDoors() {
    return (this.store.state.room.openings || []).filter((o) => (o.type === 'door' || o.type === 'doorway') && !o.wiz);
  }
  _ownDoorsNote() {
    const WALLN = { back: 'back', front: 'front', left: 'left', right: 'right' };
    const list = this._ownDoors().map((o) => `${o.type === 'door' ? 'door' : 'doorway'} on the ${WALLN[o.wall || 'back']} wall`);
    const n = list.length;
    return `The plan already has ${n === 1 ? 'a ' : ''}${list.join(', ')}${n === 1 ? '' : ` (${n})`}: ${n === 1 ? 'it stays' : 'they stay'} exactly where ${n === 1 ? 'it is' : 'they are'} (change ${n === 1 ? 'it' : 'them'} under Room). Add one more here only if the room has another door.`;
  }

  /** The current voice — re-read on every render so entering/leaving a trade
   *  unit-design session swaps the register without any re-wiring. */
  get voice() { return wizardVoice(this.tradeUnit ? this.tradeUnit() : null); }

  open() {
    if (!this.el) return;
    this._hideResultBar();          // the wizard is modal — nothing overlaps it
    const r = this.store.state.room;
    const v = this.voice;
    this.el.innerHTML = `
      <div class="wz-card">
        <button class="wz-x" id="wzClose" aria-label="Close">&times;</button>
        <div class="wz-scroll">
        <div class="wz-eyebrow">${escV(v.eyebrow)}</div>
        <h2>${escV(v.title)}</h2>
        <p class="wz-sub">${escV(v.sub)}</p>

        <section class="wz-sec">
          <div class="wz-step"><span class="wz-n">1</span><span class="wz-lead">A shape to start from</span></div>
          <div class="wz-shapes" id="wzShapes">
            ${TEMPLATES.map((t) => `<button type="button" class="wz-shape${t.id === this.shape ? ' on' : ''}" data-shape="${t.id}">
              <span class="wz-glyph">${shapeGlyph(t.id)}</span>
              <span class="wz-shape-name">${t.name}</span><span class="wz-shape-desc">${t.desc}</span></button>`).join('')}
          </div>
        </section>

        <section class="wz-sec">
          <div class="wz-step"><span class="wz-n">2</span><span class="wz-lead">${escV(v.roomLead)}</span></div>
          <div class="wz-sizes">
            <label>Back wall<input id="wzW" value="${fmtFeetIn(r.width)}"></label>
            <label>Side wall<input id="wzD" value="${fmtFeetIn(r.depth)}"></label>
            <label>Ceiling<input id="wzH" value="${fmtFeetIn(r.height)}"></label>
          </div>
        </section>

        <section class="wz-sec">
          <div class="wz-step"><span class="wz-n">3</span><span class="wz-lead">Doors &amp; windows</span> <span class="wz-hint">measured to scale; the cabinets stay clear of the door</span></div>
          <div class="wz-doorgrid">
            <div class="wz-map" id="wzMap" aria-hidden="true"></div>
            <div class="wz-doorctl">
              <div class="wz-seg wz-doors" id="wzDoors">
                <button type="button" class="${this.door === '' ? 'on' : ''}" data-door="">No door</button>
                <button type="button" class="${this.door === 'left' ? 'on' : ''}" data-door="left">Left wall</button>
                <button type="button" class="${this.door === 'right' ? 'on' : ''}" data-door="right">Right wall</button>
                <button type="button" class="${this.door === 'front' ? 'on' : ''}" data-door="front">Front wall</button>
              </div>
              <div class="wz-sizes wz-doorpos" id="wzDoorPos" style="${this.door ? '' : 'display:none'}">
                <label><span id="wzDoorDistLabel">${this.door === 'front' ? 'Left wall → door edge' : 'Back wall → door edge'}</span><input id="wzDoorDist" value="${fmtFeetIn(this.doorDist)}"></label>
                <label>Door width<input id="wzDoorW" value="${fmtFeetIn(this.doorW)}"></label>
              </div>
              ${this._ownDoors().length ? `<p class="wz-note">${escV(this._ownDoorsNote())}</p>` : ''}
              <p class="wz-note">${escV(v.windowNote)}</p>
            </div>
          </div>
        </section>

        <section class="wz-sec">
          <div class="wz-step"><span class="wz-n">4</span><span class="wz-lead">${escV(v.applLead)}</span> <span class="wz-hint">we plan around them, appliances aren't supplied by PL/NTH</span></div>
          <div class="wz-appl">
            <div class="wz-appl-row"><span class="wz-appl-lab">Cooking</span>
              <div class="wz-seg" id="wzCook">
                <button type="button" data-cook="range" class="${this.appliances.cooking === 'range' ? 'on' : ''}">Range</button>
                <button type="button" data-cook="wallOven" class="${this.appliances.cooking === 'wallOven' ? 'on' : ''}">Wall oven + cooktop</button>
              </div>
            </div>
            <div class="wz-appl-row"><span class="wz-appl-lab">Fridge</span>
              <div class="wz-seg" id="wzFridge">
                <button type="button" data-fridge="integrated" class="${this.appliances.fridge === 'integrated' ? 'on' : ''}">Integrated</button>
                <button type="button" data-fridge="freestanding" class="${this.appliances.fridge === 'freestanding' ? 'on' : ''}">Freestanding</button>
              </div>
            </div>
            <div class="wz-sizes" id="wzFridgeSize" style="${this.appliances.fridge === 'freestanding' ? '' : 'display:none'}">
              <label>Fridge width<input id="wzFrW" value="${fmtIn(this.appliances.fridgeSize?.w ?? 36)}"></label>
              <label>Depth<input id="wzFrD" value="${fmtIn(this.appliances.fridgeSize?.d ?? 28)}"></label>
              <label>Height<input id="wzFrH" value="${fmtIn(this.appliances.fridgeSize?.h ?? 70)}"></label>
            </div>
            <div class="wz-appl-row"><span class="wz-appl-lab">Dishwashers</span>
              <div class="wz-seg" id="wzDW">
                <button type="button" data-dw="1" class="${this.appliances.dishwashers === 1 ? 'on' : ''}">One</button>
                <button type="button" data-dw="2" class="${this.appliances.dishwashers === 2 ? 'on' : ''}">Two</button>
              </div>
            </div>
          </div>
        </section>

        <section class="wz-sec">
          <div class="wz-step"><span class="wz-n">5</span><span class="wz-lead">${escV(v.budgetLead)}</span> <span class="wz-hint">optional. We design to it, trading glazing and drawer banks before anything you'd miss</span></div>
          <div class="wz-sizes">
            <label>Max spend<input id="wzBudget" placeholder="no limit" value="${this.budget ? '$' + this.budget.toLocaleString('en-US') : ''}"></label>
          </div>
        </section>

        <section class="wz-sec">
          <div class="wz-step"><span class="wz-n">6</span><span class="wz-lead">${escV(v.finishLead)}</span> <span class="wz-hint">hand-painted, change it any time</span></div>
          <div class="wz-finishes" id="wzFinishes">
            ${FINISHES.map((f) => `<button type="button" class="wz-fin${f.name === this.finish ? ' on' : ''}" data-finish="${f.name}" title="${f.name}: ${f.desc}"><span style="background:${f.hex}"></span>${f.name}</button>`).join('')}
          </div>
        </section>
        </div>
        <div class="wz-foot">
          <button class="wz-skip" id="wzSkip">Start from blank</button>
          <button class="cta wz-build" id="wzBuild">${escV(v.buildCta)}</button>
        </div>
      </div>`;
    this.el.classList.add('show');
    this._wire();
    this._renderMap();
  }

  close() { this.el?.classList.remove('show'); }

  /** Re-draw the little top-down room diagram (step 3). Null-safe: does
   *  nothing when the wizard markup isn't in a real DOM (headless tests). */
  _renderMap() {
    const map = this.el?.querySelector?.('#wzMap');
    if (!map) return;
    map.innerHTML = this._mapSVG();
  }

  /** Build the diagram SVG: the room to the step-2 proportions, walls labelled
   *  to match the wall buttons, the door drawn at its measured position, and
   *  the room's own windows on their walls. */
  _mapSVG() {
    const r = this.store?.state?.room || {};
    const rw = this._dim('#wzW', r.width || 144);       // back wall (x)
    const rd = this._dim('#wzD', r.depth || 120);       // side wall (z)
    // live door measurements straight from the inputs (same parse as _build)
    let dist = this._dim('#wzDoorDist', this.doorDist);
    let dw = parseLength((this.el?.querySelector?.('#wzDoorW')?.value || '').trim());
    dw = (isFinite(dw) && dw > 0) ? Math.min(60, Math.max(18, dw < 8 ? dw * 12 : dw)) : this.doorW;

    const VW = 248, VH = 190, M = 24;                    // viewport + label margin
    const s = Math.min((VW - 2 * M) / rw, (VH - 2 * M) / rd);
    const pw = rw * s, pd = rd * s;
    const x0 = (VW - pw) / 2, y0 = (VH - pd) / 2;
    const x1 = x0 + pw, y1 = y0 + pd;
    const el = [];

    // walls as four lines so the door can cut a real opening
    const wall = (name, ax, ay, bx, by) => {
      const on = this.door === name ? ' on' : '';
      if (name === this.door && dw < (name === 'front' ? rw : rd)) {
        const len = name === 'front' ? rw : rd;
        const t0 = Math.max(0, Math.min(len - dw, dist)) * s, t1 = Math.min(len, Math.max(dw, dist + dw)) * s;
        if (name === 'left') {
          el.push(`<line class="g-wall on" x1="${ax}" y1="${ay}" x2="${ax}" y2="${y0 + t0}"/>`,
                  `<line class="g-wall on" x1="${ax}" y1="${y0 + t1}" x2="${bx}" y2="${by}"/>`);
          const d = t1 - t0;
          el.push(`<line class="g-door" x1="${ax}" y1="${y0 + t0}" x2="${ax + d}" y2="${y0 + t0}"/>`,
                  `<path class="g-arc" d="M ${ax + d} ${y0 + t0} A ${d} ${d} 0 0 1 ${ax} ${y0 + t1}"/>`);
        } else if (name === 'right') {
          el.push(`<line class="g-wall on" x1="${ax}" y1="${ay}" x2="${ax}" y2="${y0 + t0}"/>`,
                  `<line class="g-wall on" x1="${ax}" y1="${y0 + t1}" x2="${bx}" y2="${by}"/>`);
          const d = t1 - t0;
          el.push(`<line class="g-door" x1="${ax}" y1="${y0 + t0}" x2="${ax - d}" y2="${y0 + t0}"/>`,
                  `<path class="g-arc" d="M ${ax - d} ${y0 + t0} A ${d} ${d} 0 0 0 ${ax} ${y0 + t1}"/>`);
        } else { // front (bottom), measured from the left wall
          el.push(`<line class="g-wall on" x1="${ax}" y1="${ay}" x2="${x0 + t0}" y2="${ay}"/>`,
                  `<line class="g-wall on" x1="${x0 + t1}" y1="${ay}" x2="${bx}" y2="${by}"/>`);
          const d = t1 - t0;
          el.push(`<line class="g-door" x1="${x0 + t0}" y1="${ay}" x2="${x0 + t0}" y2="${ay - d}"/>`,
                  `<path class="g-arc" d="M ${x0 + t0} ${ay - d} A ${d} ${d} 0 0 1 ${x0 + t1} ${ay}"/>`);
        }
      } else {
        el.push(`<line class="g-wall${on}" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>`);
      }
    };
    wall('back', x0, y0, x1, y0);
    wall('right', x1, y0, x1, y1);
    wall('front', x0, y1, x1, y1);
    wall('left', x0, y0, x0, y1);

    // the cabinet run lives on the back wall — a soft strip so "Back" reads
    const cabD = Math.min(24 * s, pd * 0.24);
    el.push(`<rect class="g-cab" x="${x0 + 1.5}" y="${y0 + 1.5}" width="${pw - 3}" height="${cabD}"/>`);
    // the room's OWN windows and doors, where they are (the wizard never adds or moves them); the sink goes under a back-wall window
    for (const o of (r.openings || [])) {
      if (o.type !== 'window' && o.wiz) continue;
      if (o.type !== 'window') {          // a door from Room: a gap in the wall, drawn as its leaf
        const wl = o.wall || 'back', len = (wl === 'left' || wl === 'right') ? rd : rw;
        const c = openingCenter({ width: rw, depth: rd }, o) + len / 2, hw = openingWidth(o, { width: rw, depth: rd }) / 2;
        const a = Math.max(0, c - hw) * s, b = Math.min(len, c + hw) * s, d = b - a;
        if (wl === 'back') el.push(`<line class="g-door" x1="${x0 + a}" y1="${y0}" x2="${x0 + a}" y2="${y0 + d}"/>`);
        else if (wl === 'front') el.push(`<line class="g-door" x1="${x0 + a}" y1="${y1}" x2="${x0 + a}" y2="${y1 - d}"/>`);
        else if (wl === 'left') el.push(`<line class="g-door" x1="${x0}" y1="${y0 + a}" x2="${x0 + d}" y2="${y0 + a}"/>`);
        else el.push(`<line class="g-door" x1="${x1}" y1="${y0 + a}" x2="${x1 - d}" y2="${y0 + a}"/>`);
        continue;
      }
      const wl = o.wall || 'back', len = (wl === 'left' || wl === 'right') ? rd : rw;
      const c = openingCenter({ width: rw, depth: rd }, o) + len / 2, hw = openingWidth(o, { width: rw, depth: rd }) / 2;
      const a = Math.max(0, c - hw) * s, b = Math.min(len, c + hw) * s;
      if (wl === 'back') { el.push(`<line class="g-win" x1="${x0 + a}" y1="${y0}" x2="${x0 + b}" y2="${y0}"/>`); el.push(`<text class="g-lab g-winlab" x="${x0 + (a + b) / 2}" y="${y0 + cabD + 9}" text-anchor="middle">window · sink</text>`); }
      else if (wl === 'front') el.push(`<line class="g-win" x1="${x0 + a}" y1="${y1}" x2="${x0 + b}" y2="${y1}"/>`);
      else if (wl === 'left') el.push(`<line class="g-win" x1="${x0}" y1="${y0 + a}" x2="${x0}" y2="${y0 + b}"/>`);
      else el.push(`<line class="g-win" x1="${x1}" y1="${y0 + a}" x2="${x1}" y2="${y0 + b}"/>`);
    }

    // labels, oriented exactly like the wall buttons
    const lab = (name, txt, x, y, anchor, rot) => {
      const on = this.door === name ? ' on' : '';
      el.push(`<text class="g-lab${on}" x="${x}" y="${y}" text-anchor="${anchor}"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ''}>${txt}</text>`);
    };
    lab('back', 'Back (cabinets)', (x0 + x1) / 2, y0 - 6, 'middle');
    lab('front', 'Front', (x0 + x1) / 2, y1 + 13, 'middle');
    lab('left', 'Left', x0 - 6, (y0 + y1) / 2, 'middle', -90);
    lab('right', 'Right', x1 + 6, (y0 + y1) / 2, 'middle', 90);
    // room size, echoed from step 2
    el.push(`<text class="g-dim" x="${x1 - 3}" y="${y1 - 5}" text-anchor="end">${fmtFeetIn(rw)} × ${fmtFeetIn(rd)}</text>`);

    return `<svg viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg">${el.join('')}</svg>`;
  }

  _wire() {
    const q = (s) => this.el.querySelector(s);
    q('#wzClose').addEventListener('click', () => this.close());
    q('#wzSkip').addEventListener('click', () => this.close());
    q('#wzShapes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-shape]'); if (!b) return;
      this.shape = b.dataset.shape;
      this.el.querySelectorAll('.wz-shape').forEach((x) => x.classList.toggle('on', x === b));
    });
    q('#wzDoors').addEventListener('click', (e) => {
      const b = e.target.closest('[data-door]'); if (!b) return;
      this.door = b.dataset.door;
      this.el.querySelectorAll('#wzDoors button').forEach((x) => x.classList.toggle('on', x === b));
      const pos = q('#wzDoorPos');
      if (pos) pos.style.display = this.door ? '' : 'none';
      const lab = q('#wzDoorDistLabel');
      if (lab) lab.textContent = this.door === 'front' ? 'Left wall → door edge' : 'Back wall → door edge';
      // a side-wall door defaults to the FAR end of that wall (until the
      // customer types a distance): a door 5' along a 10' wall left an L-shape
      // with a 3' return, which read as a one-wall kitchen
      if (this.door && this.door !== 'front' && !this._doorDistTouched) {
        const rd = this._dim('#wzD', this.store.state.room.depth || 120);
        this.doorDist = Math.max(36, Math.round(rd - this.doorW - 6));
        const inp = q('#wzDoorDist'); if (inp) inp.value = fmtFeetIn(this.doorDist);
      }
      this._renderMap();
    });
    q('#wzDoorDist')?.addEventListener('input', () => { this._doorDistTouched = true; });
    // the little room diagram tracks the size + door inputs live
    for (const sel of ['#wzW', '#wzD', '#wzDoorDist', '#wzDoorW']) {
      q(sel)?.addEventListener('input', () => this._renderMap());
    }
    // appliance interview — three little segmented choices
    const seg = (sel, attr, key, toNum) => {
      q(sel)?.addEventListener('click', (e) => {
        const b = e.target.closest(`[data-${attr}]`); if (!b) return;
        const v = b.dataset[attr];
        this.appliances[key] = toNum ? Number(v) : v;
        q(sel)?.querySelectorAll('button')?.forEach((x) => x.classList.toggle('on', x === b));
      });
    };
    seg('#wzCook', 'cook', 'cooking');
    seg('#wzFridge', 'fridge', 'fridge');
    // freestanding fridge → reveal its size row (runs after seg's handler)
    q('#wzFridge')?.addEventListener('click', () => {
      const row = q('#wzFridgeSize');
      if (row) row.style.display = this.appliances.fridge === 'freestanding' ? '' : 'none';
    });
    seg('#wzDW', 'dw', 'dishwashers', true);
    q('#wzFinishes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-finish]'); if (!b) return;
      this.finish = b.dataset.finish;
      this.el.querySelectorAll('.wz-fin').forEach((x) => x.classList.toggle('on', x === b));
    });
    q('#wzBuild').addEventListener('click', () => this._build());
  }

  // robust size parse: accepts 12' 6", 120, or a bare "10" (read as 10 FEET,
  // since a kitchen wall is never 10 inches). Falls back to the current value.
  _dim(sel, fallback) {
    const raw = (this.el.querySelector(sel)?.value || '').trim();
    const v = parseRoomLength(raw);              // one rule for the wizard AND the Room panel (core/units.js)
    return isFinite(v) && v > 0 ? v : fallback;
  }

  _build() {
    const r = this.store.state.room;
    const room = {
      width: this._dim('#wzW', r.width),
      depth: this._dim('#wzD', r.depth),
      height: this._dim('#wzH', r.height),
    };
    // door measurements — real inches, so the doorway lands exactly to scale
    if (this.door) {
      this.doorDist = this._dim('#wzDoorDist', this.doorDist);
      const w = parseLength((this.el.querySelector('#wzDoorW')?.value || '').trim());
      if (isFinite(w) && w > 0) this.doorW = Math.min(60, Math.max(18, w < 8 ? w * 12 : w));
    }
    // freestanding fridge size — bare numbers are INCHES here (a fridge is
    // never 36 feet); clamped to the catalogue's sized-fridge limits.
    {
      const fs = this.appliances.fridgeSize || { w: 36, d: 28, h: 70 };
      const inch = (sel, fb, lo, hi) => {
        const v = parseLength((this.el.querySelector(sel)?.value || '').trim());
        return (isFinite(v) && v > 0) ? Math.max(lo, Math.min(hi, v)) : fb;
      };
      const L = FRIDGE_SIZE_LIMITS;
      this.appliances.fridgeSize = {
        w: inch('#wzFrW', fs.w, L.w[0], L.w[1]),
        d: inch('#wzFrD', fs.d, L.d[0], L.d[1]),
        h: inch('#wzFrH', fs.h, L.h[0], L.h[1]),
      };
    }
    // budget: "$20,000", "20000" or "20k" — blank = no limit
    {
      const raw = (this.el.querySelector('#wzBudget')?.value || '').trim();
      if (!raw) this.budget = null;
      else {
        let n = parseFloat(raw.replace(/[^0-9.]/g, ''));
        if (/k/i.test(raw)) n *= 1000;
        this.budget = (isFinite(n) && n > 500) ? Math.round(n) : null;
      }
      this.store.setCustomer({ budget: this.budget || undefined });
    }
    this.lastShape = this.shape;
    this.close();
    this._flash(this.voice.building, () => {
      this._generate(room);
      this._showResultBar();    // let them keep, re-roll, or save the idea
    });
  }

  /** Re-roll a different layout for the same shape/size (Generate again). */
  regenerate() {
    if (!this.lastShape) return;
    this.seed = (this.seed + 1) | 0;
    this._flash(this.voice.rerolling, () => {
      this._generate(null);     // keep current room size
      this._showResultBar();
    });
  }

  /** Branded moment while the generator works — serif flash over the stage. */
  _flash(text, fn) {
    let f = document.getElementById('wzFlash');
    if (!f) { f = document.createElement('div'); f.id = 'wzFlash'; document.body.appendChild(f); }
    f.innerHTML = `<span>${text}</span>`;
    f.classList.add('show');
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    setTimeout(() => {
      fn();
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      setTimeout(() => f.classList.remove('show'), Math.max(0, 650 - (now - t0)));
    }, 60);
  }

  /** A small, non-blocking bar after a build: one line of actions, the budget
   *  outcome, and the design rationale folded away until asked for. Editing is
   *  the PRIMARY action — touching the scene dismisses the bar too. */
  _showResultBar() {
    let bar = document.getElementById('wzResult');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'wzResult';
      bar.className = 'wz-result';
      document.body.appendChild(bar);
    }
    const v = this.voice;
    const msg = this._canIsland ? "Big room. Want an island?" : v.resultMsg;
    // budget outcome — honest either way
    const $ = (n) => '$' + Math.round(n).toLocaleString('en-US');
    let budgetLine = '';
    const bp = this._budgetPlan;
    if (bp) {
      if (bp.met && bp.swaps.length) budgetLine = `<div class="wz-budgetline ok">Designed to your ${$(this.budget)} budget: estimate ${$(bp.total)}. Simplified: ${bp.stages.join(' · ')}.</div>`;
      else if (bp.met) budgetLine = `<div class="wz-budgetline ok">Comfortably inside your ${$(this.budget)} budget: estimate ${$(bp.total)}.</div>`;
      else budgetLine = `<div class="wz-budgetline over">Closest we can get is ${$(bp.total)} (budget ${$(this.budget)}). Try a shorter run, or fewer tall cabinets.</div>`;
    }
    // a door that eats the side wall: say so, rather than let an "L" read as an "I"
    let doorLine = '';
    if ((this.lastShape || this.shape) === 'l-shape' && this.door === 'left') {
      const [sa, sb] = wallFreeSpan(this.store.state.room, 'left');
      if (sb - sa < 40) doorLine = `<div class="wz-budgetline">Your door leaves a short return on the side wall, so we kept it light. Move the door in the sketch, or drag cabinets in, to change that.</div>`;
    }
    // the WHY — rationale chips, folded behind one quiet line until asked for
    const why = designRationale(this.store.serialize());
    this._why = why;
    const chips = why.length
      ? `<details class="wz-whyd"><summary>✓ ${why.length} design rules checked · see why</summary>
          <div class="wz-why">${why.map((n, i) => `<button class="wz-chip" data-why="${i}" title="${n.text}. Tap to highlight">✓ ${n.short || n.text}</button>`).join('')}</div>
        </details>`
      : '';
    bar.innerHTML = `
      <div class="wz-result-row">
        <span class="wz-result-msg">${msg}</span>
        ${this._canIsland ? '<button class="cta sm" id="wzIsland">＋ Add an island</button>' : ''}
        <button class="ghost sm" id="wzReroll" title="${escV(v.rerollTitle)}">${escV(v.rerollBtn)}</button>
        ${this.onCompare ? '<button class="ghost sm" id="wzCompare" title="Keep a snapshot to compare up to three ideas side by side">⊞ Compare</button>' : ''}
        ${v.showSave ? '<button class="ghost sm" id="wzSave" title="Save this design to your account">♥ Save</button>' : ''}
        <button class="cta sm wz-result-go" id="wzKeep">${this._canIsland ? 'Start editing →' : escV(v.keepBtn)}</button>
      </div>
      ${budgetLine}${doorLine}${chips}`;
    bar.classList.add('show');
    document.body.classList.add('wz-reviewing');   // clear the deck: view controls hide while reviewing
    bar.querySelector('#wzReroll').onclick = () => this.regenerate();
    bar.querySelector('#wzCompare')?.addEventListener('click', () => this.onCompare?.());
    const save = bar.querySelector('#wzSave');
    if (save) save.onclick = () => this.onSave();
    bar.querySelector('#wzKeep').onclick = () => { this._hideResultBar(); this.controls?.layer?.select(null); this.onEdit?.(); };
    bar.querySelector('#wzIsland')?.addEventListener('click', () => {
      this._addIslandToLShape(); this._canIsland = false; this.onBuilt(); this._showResultBar();
    });
    bar.querySelectorAll('.wz-chip').forEach((ch) => ch.addEventListener('click', () => {
      const n = this._why[Number(ch.dataset.why)];
      if (n && n.ids.length) this.controls?.layer?.select(n.ids[0]);
      bar.querySelectorAll('.wz-chip').forEach((x) => x.classList.toggle('on', x === ch));
    }));
    // touching the kitchen IS "start editing" — the bar steps aside on the
    // first pointer down over the 3D stage (listener installed once)
    if (!this._stageDismiss) {
      this._stageDismiss = true;
      document.getElementById('stage')?.addEventListener('pointerdown', () => this._hideResultBar(), { passive: true });
    }
  }

  _hideResultBar() {
    document.getElementById('wzResult')?.classList.remove('show');
    document.body.classList.remove('wz-reviewing');
  }

  /** The back wall's free edges: a boxing (bulkhead) in a back corner, on the back wall or on
   *  a side wall, is the wall as far as the run is concerned. */
  _backFree(rm) {
    let minX = -rm.width / 2, maxX = rm.width / 2;
    for (const bx of boxingBoxes(rm)) {
      const nearBack = bx.wall === 'back' || bx.z0 - (-rm.depth / 2) < 26;
      if (!nearBack) continue;
      if (bx.x0 <= minX + 1) minX = Math.max(minX, bx.x1);
      if (bx.x1 >= maxX - 1) maxX = Math.min(maxX, bx.x0);
    }
    return [minX, maxX];
  }

  _generate(roomPatch) {
    this.store.beginHistory();                            // the whole build = ONE undo step
    try { this._generateInner(roomPatch); }
    finally { this.store.endHistory(); }
  }

  _generateInner(roomPatch) {
    this.store.clear({ keep: true });                     // fresh start (keeps room; the same design stays open)
    if (roomPatch && Object.keys(roomPatch).length) this.store.setRoom(roomPatch);
    // doors: THE ROOM'S DOORS ARE THE ROOM'S, like its windows (her catch 2026-09-25: "if I add
    // doors and windows then click auto layout it deletes all my doors"). Only the doorway the
    // wizard's own picker drew last time (`wiz`) is replaced by this draft's choice; every door
    // and doorway added under Room stays exactly where it is. The generator + placement route
    // the runs around all of them (wallFreeSpan).
    for (const o of [...(this.store.state.room.openings || [])]) {
      if ((o.type === 'door' || o.type === 'doorway') && o.wiz) this.store.removeOpening(o.id);
    }
    if (this.door) {
      // pos is the CENTRE as a fraction of the wall; the customer measured to
      // the NEAR edge, so shift by half the door width. Exact, to scale.
      const r1 = this.store.state.room;
      const wallLen = this.door === 'front' ? r1.width : r1.depth;
      const pos = Math.max(0.02, Math.min(0.98, (this.doorDist + this.doorW / 2) / wallLen));
      this.store.addOpening({ type: 'doorway', wall: this.door, pos, width: this.doorW, wiz: true });
    }
    // a PL/NTH kitchen wears its crown: default to the plain cornice so the
    // moulding (with its side returns) shows — and is priced — from the start
    if (!this.store.state.room.cornice || this.store.state.room.cornice === 'none') this.store.setRoom({ cornice: 'plain' });
    this.onBuilt();                                       // rebuild the room so bounds are correct BEFORE placing
    // GUARANTEE "Generate again" looks different: if this seed reproduces the
    // previous layout (possible on constrained rooms), walk the seed forward
    // until the steps change. Gives up after 12 tries (a truly forced layout).
    let gen = generateKitchen(this.lastShape || this.shape, this.store.state.room, this.seed, this.appliances);
    for (let t = 0; t < 12 && JSON.stringify(gen.steps) === this._lastSig; t++) {
      this.seed = (this.seed + 1) | 0;
      gen = generateKitchen(this.lastShape || this.shape, this.store.state.room, this.seed, this.appliances);
    }
    this._lastSig = JSON.stringify(gen.steps);
    const { steps, features } = gen;
    // back wall via placeNew (snap + butt); side run + island placed explicitly
    let sinkItem = null, hobBase = null;
    for (const s of steps.filter((x) => x.wall === 'back')) {
      const it = this.controls.placeNew(s.code, s.wall);
      if (s.sink && it) sinkItem = it;
      if (s.hob && it) hobBase = { id: it.id, hob: s.hob };
    }
    // Rule: cabinets touch the walls when the run goes wall-to-wall. The run is
    // laid flush to the LEFT wall, so any residual gap lands on the right. If a
    // TALL sits at that end, nudge the whole back run across so the tall meets
    // the wall (the small gap moves to a base end, where a scribe filler closes
    // it). Never opens a gap larger than a filler.
    {
      const rm = this.store.state.room;
      const [minX, maxX] = this._backFree(rm), backZ = -rm.depth / 2;
      const onBack = (it, c) => c && ((it.rotDeg || 0) % 180 === 0) && Math.abs(it.z - (backZ + c.d / 2 + 0.25)) < 8;
      const backRun = this.store.state.items.filter((it) => { const c = getCab(it.code); return c && ['FLOOR', 'TALL', 'APPLIANCES'].includes(c.type) && onBack(it, c); });
      if (backRun.length) {
        let R = backRun[0], L = backRun[0];
        for (const it of backRun) { if (it.x + getCab(it.code).w / 2 > R.x + getCab(R.code).w / 2) R = it; if (it.x - getCab(it.code).w / 2 < L.x - getCab(L.code).w / 2) L = it; }
        const rGap = maxX - (R.x + getCab(R.code).w / 2);
        const lGap = (L.x - getCab(L.code).w / 2) - minX;
        let shift = 0;
        if (getCab(R.code).type === 'TALL' && rGap > 0.4 && rGap < 10) shift = rGap;
        else if (getCab(L.code).type === 'TALL' && lGap > 0.4 && lGap < 10) shift = -lGap;
        if (shift) for (const it of backRun) this.store.updateItem(it.id, { x: it.x + shift }, { quiet: true });
      }
    }
    // U-shape residual: how far the RIGHT leg pulls off its wall to swallow
    // the back run's sliver (set inside the leg-to-leg block below)
    let rightLegInset = 0;
    // LEG-TO-LEG corners (client spec): the perpendicular run's boxes reach
    // ~24" out from the side wall, and the corner unit's BODY must start
    // exactly where they end — the two front frames then meet 22mm leg to
    // 22mm leg at the right angle with the corner door's stile fully visible,
    // and the blank return hides behind the perpendicular run, stretching to
    // the wall (cornerReturnLength). Bounded by the slack at the far end so
    // a wall-to-wall run never overflows.
    {
      const rm = this.store.state.room;
      const [minX, maxX] = this._backFree(rm), backZ = -rm.depth / 2;
      const onBack = (it, c) => c && ((it.rotDeg || 0) % 180 === 0) && Math.abs(it.z - (backZ + c.d / 2 + 0.25)) < 8;
      const backRun = this.store.state.items.filter((it) => { const c = getCab(it.code); return c && ['FLOOR', 'TALL', 'APPLIANCES'].includes(c.type) && onBack(it, c); });
      const edgeL = () => Math.min(...backRun.map((it) => it.x - getCab(it.code).w / 2));
      const edgeR = () => Math.max(...backRun.map((it) => it.x + getCab(it.code).w / 2));
      const findCorner = (hand) => backRun.find((it) => { const c = getCab(it.code); return c.corner && c.cornerSide === hand; });
      const legFit = (sideWall, cornerHand, dir) => {
        if (!backRun.length || !steps.some((x) => x.wall === sideWall)) return;
        const corner = findCorner(cornerHand);
        const sideD = getCab(steps.find((x) => x.wall === sideWall)?.code)?.d || 24;
        // gap to clear: corner BODY edge → side wall (leg-to-leg), or — when a
        // tight wall dropped the corner unit — the WHOLE run clears the leg's
        // dead-corner shadow so the two runs never crash at the junction
        let gap;
        if (corner) {
          const cw = getCab(corner.code).w;
          gap = dir > 0 ? (corner.x - cw / 2) - minX : maxX - (corner.x + cw / 2);
        } else if (dir > 0) gap = edgeL() - minX;
        else gap = maxX - edgeR();
        let shift = (corner ? sideD + 0.25 : sideD) - gap;   // +away from the wall, −toward it
        if (shift > 0) shift = Math.min(shift, dir > 0 ? maxX - edgeR() : edgeL() - minX);
        if (!corner && shift < 0) shift = 0;                 // never PULL a cornerless run into the shadow
        if (Math.abs(shift) > 0.05) for (const it of backRun) this.store.updateItem(it.id, { x: it.x + dir * shift }, { quiet: true });
      };
      // with corners at BOTH ends the run length fixes one of them — fit the
      // left exactly, then absorb the RIGHT corner's residual the way a
      // fitter would: PULL THE WHOLE RIGHT LEG OFF ITS WALL by the sliver.
      // The leg's worktop deepens to the wall (the planner already fills a
      // sub-7" wall gap), the corner return stretches behind the leg, and the
      // junction stays exactly 22mm leg to 22mm leg — the sliver disappears.
      // Only a sliver too big to hide (> 5.5", the return-stretch limit)
      // falls back to sliding the corner out over a priced mid-run filler.
      legFit('left', 'left', +1);
      if (!findCorner('left')) legFit('right', 'right', -1);
      else {
        const rc = findCorner('right');
        if (rc && steps.some((x) => x.wall === 'right')) {
          const sideD = getCab(steps.find((x) => x.wall === 'right')?.code)?.d || 24;
          const cw = getCab(rc.code).w;
          const sliver = (maxX - (rc.x + cw / 2)) - (sideD + 0.25);  // residual at the corner
          if (sliver > 0.05 && sliver <= 5.5) rightLegInset = sliver;
          else if (sliver > 5.5 && sliver <= 9) this.store.updateItem(rc.id, { x: rc.x + sliver }, { quiet: true });
          // a sliver too big for either trick alone (her catch 2026-09-18: a 168"
          // U left the corner unit 9½" short of the right leg, oak return on show)
          // takes BOTH: the leg pulls off its wall by the full 5½" and the corner
          // slides out over a filler for the rest — the junction stays leg to leg
          else if (sliver > 9 && sliver <= 14.5) {
            rightLegInset = 5.5;
            this.store.updateItem(rc.id, { x: rc.x + (sliver - 5.5) }, { quiet: true });
          }
        }
      }
    }
    // L/U side runs — start FORWARD of the corner unit so nothing collides
    const leftSteps = steps.filter((x) => x.wall === 'left');
    if (leftSteps.length) {
      const rm = this.store.state.room;
      const minX = -rm.width / 2, minZ = -rm.depth / 2;
      const [sA, sB] = wallFreeSpan(rm, 'left');    // clear of the corner AND any door
      let cz = minZ + sA;
      for (const s of leftSteps) {
        const cab = getCab(s.code); if (!cab) continue;
        if (cz + cab.w > minZ + sB) break;          // don't run off the span
        // talls stand 30mm PROUD of the base run so the counter dies into
        // their side (client spec — same offset drag-snapping uses)
        const proud = cab.type === 'TALL' || cab.onTall ? TALL_PROUD : 0;
        const it = this.store.addItem(s.code, { x: minX + cab.d / 2 + 0.25 + proud, z: cz + cab.w / 2, rotDeg: 90 });
        if (s.hob && it) hobBase = { id: it.id, hob: s.hob };
        cz += cab.w;
      }
    }
    // U-shape right leg (mirrors the left; fronts face -X into the room)
    const rightSteps = steps.filter((x) => x.wall === 'right');
    if (rightSteps.length) {
      const rm = this.store.state.room;
      const maxX = rm.width / 2, minZ = -rm.depth / 2;
      const [rA, rB] = wallFreeSpan(rm, 'right');
      let cz = minZ + rA;
      for (const s of rightSteps) {
        const cab = getCab(s.code); if (!cab) continue;
        if (cz + cab.w > minZ + rB) break;
        this.store.addItem(s.code, { x: maxX - cab.d / 2 - 0.25 - rightLegInset - (cab.type === 'TALL' || cab.onTall ? TALL_PROUD : 0), z: cz + cab.w / 2, rotDeg: 270 });
        cz += cab.w;
      }
    }
    // galley facing run along the FRONT wall (fronts face -Z, back into the room)
    const frontSteps = steps.filter((x) => x.wall === 'front');
    if (frontSteps.length) {
      const rm = this.store.state.room;
      const minX = -rm.width / 2, maxZ = rm.depth / 2;
      const [fA, fB] = wallFreeSpan(rm, 'front');
      let cx = minX + fA;
      for (const s of frontSteps) {
        const cab = getCab(s.code); if (!cab) continue;
        if (cx + cab.w > minX + fB) break;
        this.store.addItem(s.code, { x: cx + cab.w / 2, z: maxZ - cab.d / 2 - 0.25 - (cab.type === 'TALL' || cab.onTall ? TALL_PROUD : 0), rotDeg: 180 });
        cx += cab.w;
      }
    }
    // wall-oven mode: drop the hob into the worktop over its drawer base (the
    // base was placed with every cooker rule — the hob simply rides on top).
    if (hobBase) {
      const base = this.store.getItem(hobBase.id);
      if (base) this.store.addItem(hobBase.hob, { x: base.x, z: base.z, rotDeg: base.rotDeg });
    }
    if (sinkItem) {
      const room0 = this.store.state.room;
      // The GENERATOR already placed the sink base safely (never beside the
      // range). Drop the sink there and CENTRE the window on it — moving an
      // existing back window, or adding one — so the sink sits under the window
      // without ever being shoved next to the cooker.
      const base = this.store.getItem(sinkItem.id);
      if (base) {
        // THE WINDOWS ARE THE ROOM'S (her rule 2026-09-22: "when I click draft a layout, it adds
        // a window!"): the wizard never adds one and never moves one. If the room has a window on
        // the back wall and the sink base is not under it, the sink base swaps places with a
        // same-width base that is, so the sink still lands under the window.
        const room0 = this.store.state.room;
        const win = (room0.openings || []).find((o) => o.type === 'window' && (o.wall || 'back') === 'back');
        if (win) {
          const wc = openingCenter(room0, win), ww = openingWidth(win, room0), bw = getCab(base.code).w;
          const under = (x) => Math.abs(x - wc) < ww / 2 + bw / 2 - 2;        // the base spans the window's middle
          if (!under(base.x)) {
            const minZ0 = -room0.depth / 2;
            const swap = this.store.state.items.find((o) => { const c = getCab(o.code);
              return o.id !== base.id && c && c.type === 'FLOOR' && !c.corner && ['door', 'double', 'drawers'].includes(c.form) && !/cooktop/i.test(c.desc)
                && Math.abs(c.w - bw) < 0.5 && ((o.rotDeg || 0) % 180) === 0 && Math.abs(o.z - (minZ0 + c.d / 2 + 0.25)) < 8 && under(o.x); });
            if (swap) { const bx = base.x; this.store.updateItem(base.id, { x: swap.x }, { quiet: true }); this.store.updateItem(swap.id, { x: bx }, { quiet: true }); }
          }
        }
        // a 36" double base takes the double-bowl sink
        const sinkAp = (getCab(this.store.getItem(base.id).code)?.w || 24) >= 33 ? 'AP7' : 'AP6';
        const b2 = this.store.getItem(base.id);
        this.store.addItem(sinkAp, { x: b2.x, z: b2.z, rotDeg: b2.rotDeg });
      }
    }
    // free-standing island, sized to the room with a 1100mm walkway all round.
    // Front row FACES THE RUN (rot 180); when the floor is deep enough we add a
    // second row back-to-back (double-sided). A single row's exposed back gets a
    // finished back panel.
    const island = steps.filter((x) => x.wall === 'island');
    if (island.length) {
      const room = this.store.state.room;
      const depth = room.depth || 120;
      const minZ = -depth / 2, maxZ = depth / 2;
      const WALK = 44;                                   // 44" clear walkway (hard rule)
      // front face of the back run — measured from what's actually placed, so
      // a 26"-deep range standing proud of the 24" cabinets still gets its 44"
      let backFront = minZ + 24.25;
      for (const bit of this.store.state.items) {
        const bc = getCab(bit.code);
        if (!bc) continue;
        const floorStanding = bc.type === 'FLOOR' || bc.type === 'TALL' ||
          (bc.type === 'APPLIANCES' && (bc.mountY || 0) === 0);
        if (!floorStanding || ((bit.rotDeg || 0) % 180) !== 0) continue;
        const face = bit.z + bc.d / 2;
        if (face < minZ + 45) backFront = Math.max(backFront, face);
      }
      const rowD = getCab(island[0].code)?.d || 24;
      const doubleSided = (maxZ - backFront) >= (WALK + 2 * rowD + WALK);
      const islDepth = doubleSided ? 2 * rowD : rowD;
      // the island stands ONE WALKWAY off the run it works with (her catch 2026-09-25: centred in
      // the clear floor it stood "way too far from the back cabinets, like 1000mm from every run"
      // in a deep room). The room's depth goes to the far side, where the seating and the
      // circulation are; only a shallow room that cannot give 44" both sides centres what it has.
      const czCenter = (backFront + maxZ) / 2;
      const frontZ = Math.min(backFront + WALK + rowD / 2, czCenter - islDepth / 2 + rowD / 2); // run-facing row centre
      // breakfast-bar seating: the worktop overhangs the island's OUTER (+z)
      // edge by 12" — only when the walkway behind still clears 1100mm + stools
      const rearEdge = (doubleSided ? frontZ + rowD : frontZ) + rowD / 2;
      const seat = !!features?.islandSeating && (maxZ - rearEdge) >= WALK + 12;
      const totalW = island.reduce((t, s) => t + (getCab(s.code)?.w || 24), 0);
      let cx = -totalW / 2;
      for (const s of island) {
        const w = getCab(s.code)?.w || 24;
        this.store.addItem(s.code, { x: cx + w / 2, z: frontZ, rotDeg: 180, island: true, backPanel: !doubleSided, seating: !doubleSided && seat });
        cx += w;
      }
      if (doubleSided) {                                 // mirror row, back-to-back
        cx = -totalW / 2;
        const backZ = frontZ + rowD;
        for (const s of island) {
          const w = getCab(s.code)?.w || 24;
          this.store.addItem(s.code, { x: cx + w / 2, z: backZ, rotDeg: 0, island: true, seating: seat });
          cx += w;
        }
      }
    }
    this._addUppers(features);                           // fill the wall with proportionate uppers
    // ---- design TO the budget: like-for-like downgrades (same widths, same
    // positions — no rule can break) until the estimate fits. Honest when it
    // can't: the result bar says the closest achievable number.
    this._budgetPlan = null;
    if (this.budget) {
      const plan = planBudgetSwaps(this.store.serialize(), this.budget);
      for (const s of plan.swaps) this.store.swapItem(s.id, s.to);
      for (const p of (plan.patches || [])) this.store.updateItem(p.id, p.patch, { quiet: true });
      for (const id of (plan.removals || [])) this.store.removeItem(id);
      this._budgetPlan = plan;
    }
    // extractor hood, centred over a range — or a worktop hob — at least as
    // wide as itself (so it never overhangs a neighbouring tall) — chef
    // kitchens always take one. A 30" hob (AP4) gets no hood; the 36" (AP5) does.
    if (features?.hood) {
      const hood = getCab('AP8');
      const rng = this.store.state.items.find((it) => { const c = getCab(it.code); return (c?.appliance === 'range' || c?.appliance === 'hob') && c.w >= hood.w; });
      if (rng) {
        const rm2 = this.store.state.room;
        // never let the hood touch the window glass (hard rule)
        const win2 = (rm2.openings || []).find((o) => o.type === 'window' && (o.wall || 'back') === 'back');
        const winC = win2 ? openingCenter(rm2, win2) : null;
        const clearOfWin = !win2 || Math.abs(rng.x - winC) >= (openingWidth(win2, rm2) + hood.w) / 2 + 1;
        if ((rng.rotDeg || 0) % 180 === 0 && clearOfWin) this.store.addItem('AP8', { x: rng.x, z: -rm2.depth / 2 + hood.d / 2 + 0.25, rotDeg: 0 });
        else if ((rng.rotDeg || 0) % 180 !== 0) this.store.addItem('AP8', { x: -rm2.width / 2 + hood.d / 2 + 0.25, z: rng.z, rotDeg: 90 });
      }
    }
    this._groundCounters();                              // counter cabinets touch their wall
    this._resolveOverlaps();                             // HARD RULE: nothing ever overlaps
    // her rule: an upper beside the cooker hinges away from it (knob nearest the cooker)
    for (const h of hingesTowardCooker(this.store.state, getCab)) this.store.updateItem(h.id, { hinge: h.hinge }, { quiet: true });
    // Rule: on a big L-shape, offer an island (the results bar shows the button).
    const shape = this.lastShape || this.shape;
    this._canIsland = shape === 'l-shape' && this._roomFitsIsland();
    if (getFinish(this.finish)) this.store.setFinish(this.finish);
    this.controls?.layer?.select(null);
    // HARD RULE: the cooker never sits in front of a window. The generator
    // lays out runs blind to windows, so a layout that lands the range on one
    // is rerolled with the next seed (_generateInner fully resets first).
    // After 10 tries a truly forced room is accepted and the warnings panel
    // flags it instead of looping forever.
    if (cookerWindowClashes(this.store.state).length && (this._winReroll = (this._winReroll || 0) + 1) <= 10) {
      this.seed = (this.seed + 1) | 0;
      return this._generateInner(roomPatch);
    }
    this._winReroll = 0;
    this.onBuilt();
  }

  /** Rule: a counter-standing cabinet never FLOATS just off a wall. If the gap
   *  between its back and the wall it stands against is small (≤ ~4"), pull it
   *  back to touch (the usual 0.25" hair gap). Moving strictly toward the wall
   *  through an empty strip can't create a NEW overlap, and _resolveOverlaps()
   *  still runs afterwards as the hard guarantee. */
  _groundCounters() {
    const rm = this.store.state.room;
    const minX = -rm.width / 2, maxX = rm.width / 2, minZ = -rm.depth / 2, maxZ = rm.depth / 2;
    const GAP = 0.25, PULL = 4.5;
    for (const it of this.store.state.items) {
      const c = getCab(it.code);
      if (!c || c.type !== 'COUNTER') continue;
      const rot = (((it.rotDeg || 0) % 360) + 360) % 360;
      let patch = null;
      if (rot === 0) { const g = (it.z - c.d / 2) - minZ; if (g > GAP + 0.1 && g <= PULL) patch = { z: minZ + c.d / 2 + GAP }; }
      else if (rot === 180) { const g = maxZ - (it.z + c.d / 2); if (g > GAP + 0.1 && g <= PULL) patch = { z: maxZ - c.d / 2 - GAP }; }
      else if (rot === 90) { const g = (it.x - c.d / 2) - minX; if (g > GAP + 0.1 && g <= PULL) patch = { x: minX + c.d / 2 + GAP }; }
      else if (rot === 270) { const g = maxX - (it.x + c.d / 2); if (g > GAP + 0.1 && g <= PULL) patch = { x: maxX - c.d / 2 - GAP }; }
      if (patch) this.store.updateItem(it.id, patch, { quiet: true });
    }
  }

  /** ABSOLUTE no-overlap guarantee. After everything is placed, check every pair
   *  of cabinets in 3D (footprint × height band). If two solid bodies intersect,
   *  remove the lower-priority one — appliances and talls are kept, then base
   *  cabinets, then uppers, then fillers. Guarantees a clean layout no matter
   *  what the generator produced. */
  _resolveOverlaps() {
    const PRI = { APPLIANCES: 5, TALL: 4, FLOOR: 3, COUNTER: 2, WALL: 2 };
    const TOL = 1.0;                                     // ignore butting / hairline contact
    const box = (it) => {
      const c = getCab(it.code); if (!c) return null;
      const w = c.w, d = c.d;
      const ret = c.corner ? (c.type === 'FLOOR' ? 20 : 10) : 0;
      const lRet = (c.corner && c.cornerSide !== 'right') ? ret : 0;
      const rRet = (c.corner && c.cornerSide === 'right') ? ret : 0;
      const corners = [[-(w / 2 + lRet), -d / 2], [(w / 2 + rRet), -d / 2], [(w / 2 + rRet), d / 2], [-(w / 2 + lRet), d / 2]];
      const rad = (it.rotDeg || 0) * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [lx, lz] of corners) { const wx = lx * cs + lz * sn, wz = -lx * sn + lz * cs; x0 = Math.min(x0, it.x + wx); x1 = Math.max(x1, it.x + wx); z0 = Math.min(z0, it.z + wz); z1 = Math.max(z1, it.z + wz); }
      const my = getMountY(c);
      return { x0, x1, z0, z1, y0: my, y1: my + c.h, pri: PRI[c.type] ?? 3, id: it.id };
    };
    const boxes = this.store.state.items.map(box).filter(Boolean);
    const overlap1D = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
    const remove = new Set();
    // a boxing (bulkhead) is an immovable solid: whatever the generator stood in one comes out
    for (const bb of boxingBoxes(this.store.state.room)) for (const A of boxes) {
      if (overlap1D(A.x0, A.x1, bb.x0, bb.x1) > TOL && overlap1D(A.z0, A.z1, bb.z0, bb.z1) > TOL && overlap1D(A.y0, A.y1, bb.y0, bb.y1) > TOL) remove.add(A.id);
    }
    for (let i = 0; i < boxes.length; i++) {
      if (remove.has(boxes[i].id)) continue;
      for (let j = i + 1; j < boxes.length; j++) {
        if (remove.has(boxes[j].id)) continue;
        const A = boxes[i], B = boxes[j];
        if (overlap1D(A.x0, A.x1, B.x0, B.x1) > TOL &&
            overlap1D(A.z0, A.z1, B.z0, B.z1) > TOL &&
            overlap1D(A.y0, A.y1, B.y0, B.y1) > TOL) {
          // drop the lower priority; tie-break drops the later-placed unit
          const drop = (A.pri < B.pri || (A.pri === B.pri && A.id > B.id)) ? A : B;
          remove.add(drop.id);
        }
      }
    }
    for (const id of remove) this.store.removeItem(id);
  }

  /** Is there room in an L-shape's open floor for an island + 1100mm walkways? */
  _roomFitsIsland() {
    const rm = this.store.state.room;
    const openW = (rm.width / 2) - (-rm.width / 2 + 24) - 2 * 43.3;   // right of the side run
    const openD = (rm.depth / 2) - (-rm.depth / 2 + 24) - 2 * 43.3;   // in front of the back run
    return openW >= 36 && openD >= 24;
  }

  /** Drop a single-depth island (drawers · cabinet · drawers, facing the run)
   *  into an L-shape's open floor, centred with 1100mm walkways. */
  _addIslandToLShape() {
    const rm = this.store.state.room;
    const minX = -rm.width / 2, maxX = rm.width / 2, minZ = -rm.depth / 2, maxZ = rm.depth / 2;
    const WALK = 44;                                   // 44" clear walkway (hard rule 10)
    const openX0 = minX + 24, openX1 = maxX, openZ0 = minZ + 24, openZ1 = maxZ;
    const islLen = Math.min((openX1 - openX0) - 2 * WALK, 96);
    if (islLen < 24) return;
    const widths = []; let rem = islLen;
    while (rem >= 20) { const c = rem >= 36 ? 'F20' : rem >= 28 ? 'F19' : rem >= 24 ? 'F18' : 'F17'; if (getCab(c).w > rem) break; widths.push(c); rem -= getCab(c).w; }
    if (widths.length >= 3) widths[Math.floor(widths.length / 2)] = 'F2';
    const totalW = widths.reduce((t, c) => t + getCab(c).w, 0);
    // one walkway off the back run's face (a tall stands 30mm proud), never centred in a deep floor
    let backFront = openZ0 + 0.25;
    for (const bit of this.store.state.items) {
      const bc = getCab(bit.code); if (!bc) continue;
      const floorStanding = bc.type === 'FLOOR' || bc.type === 'TALL' || (bc.type === 'APPLIANCES' && (bc.mountY || 0) === 0);
      if (floorStanding && ((bit.rotDeg || 0) % 180) === 0 && bit.z + bc.d / 2 < minZ + 45) backFront = Math.max(backFront, bit.z + bc.d / 2);
    }
    const rowD = getCab(widths[0]).d;
    const cx = (openX0 + openX1) / 2, cz = Math.min(backFront + WALK + rowD / 2, (openZ0 + openZ1) / 2);
    const seat = (maxZ - (cz + rowD / 2)) >= WALK + 12;   // stool side still clears the walkway
    let x = cx - totalW / 2;
    for (const c of widths) { const w = getCab(c).w; this.store.addItem(c, { x: x + w / 2, z: cz, rotDeg: 180, island: true, backPanel: true, seating: seat }); x += w; }
  }

  /** Fill the wall above the back run with proportionate uppers — every free
   *  stretch (clear of the window, the range's 200mm clearance and talls) gets
   *  wall cabinets and/or counter-standing dressers, packed to fill the stretch
   *  so they sit tight against a neighbouring tall. Needs real geometry, so it
   *  runs after the base run + window are placed. */
  _addUppers(features) {
    if (!features) return;
    const room = this.store.state.room;
    const minZ = -room.depth / 2;
    const items = this.store.state.items;
    const onBack = (it, c) => c && ((it.rotDeg || 0) % 180 === 0) && Math.abs(it.z - (minZ + c.d / 2 + 0.25)) < 8;

    // extent of the back run — base cabinets AND talls (uppers run up to a tall)
    const backUnits = items.filter((it) => { const c = getCab(it.code); return c && (c.type === 'FLOOR' || c.type === 'TALL') && onBack(it, c); });
    if (!backUnits.length) return;
    let runX0 = Infinity, runX1 = -Infinity;
    for (const it of backUnits) { const c = getCab(it.code); runX0 = Math.min(runX0, it.x - c.w / 2); runX1 = Math.max(runX1, it.x + c.w / 2); }

    // no-go spans: the range (+50mm each side, her rule 2026-09-22), the window, and any tall unit.
    const RANGE_CLEAR = COOK_SIDE_IN;
    const zones = [];
    const tallZones = [];                                // tall sides — uppers butt TIGHT against these
    for (const it of items) {
      const c = getCab(it.code); if (!c) continue;
      if ((c.appliance === 'range' || c.appliance === 'hob') && onBack(it, c)) zones.push([it.x - c.w / 2 - RANGE_CLEAR, it.x + c.w / 2 + RANGE_CLEAR]);
      if ((c.type === 'TALL' || c.appliance === 'fridge') && onBack(it, c)) { const z = [it.x - c.w / 2, it.x + c.w / 2]; zones.push(z); tallZones.push(z); }
    }
    for (const o of (room.openings || [])) {
      if ((o.wall || 'back') !== 'back' || o.type !== 'window') continue;
      // use the SAME clamped maths the 3D room renders with (openings.js) —
      // a raw pos-fraction drifts from the drawn window near a corner, and an
      // upper cabinet would land over the glass.
      const cx = openingCenter(room, o), ww = openingWidth(o, room);
      zones.push([cx - ww / 2 - 2, cx + ww / 2 + 2]);
    }

    // free stretches between the no-go zones
    const occ = zones.slice().sort((a, b) => a[0] - b[0]);
    let cur = runX0; const free = [];
    for (const [a, b] of occ) { if (a > cur) free.push([cur, Math.min(a, runX1)]); cur = Math.max(cur, b); if (cur >= runX1) break; }
    if (cur < runX1) free.push([cur, runX1]);

    const style = features.upperStyle || 'wall';
    const g = features.glazed;
    free.forEach(([a, b], i) => {
      if (b - a < 20) return;
      const counter = style === 'counter' ? true : style === 'wall' ? false : (i % 2 === 1);
      // 36" double preferred, then singles — subset-sum packs the stretch tight.
      const units = counter
        ? [{ c: g ? 'C5' : 'C3', w: 36 }, { c: g ? 'C2' : 'C1', w: 24 }]
        : [{ c: g ? 'W7' : 'W5', w: 36 }, { c: g ? 'W4' : 'W2', w: 24 }, { c: 'W1', w: 20 }];
      const codes = this._packStretch(b - a, units);
      const packedW = codes.reduce((t, c) => t + getCab(c).w, 0);
      // a stretch bounded by a TALL cabinet butts TIGHT against it (no dead
      // sliver beside a tall); otherwise the group centres for proportion
      const tallAtL = tallZones.some(([, zb]) => Math.abs(zb - a) < 0.6);
      const tallAtR = tallZones.some(([za]) => Math.abs(za - b) < 0.6);
      let x = tallAtL && !tallAtR ? a
        : tallAtR && !tallAtL ? b - packedW
        : a + (b - a - packedW) / 2;
      for (const c of codes) { const cb = getCab(c), w = cb.w; this.store.addItem(c, { x: x + w / 2, z: minZ + cb.d / 2 + 0.25, rotDeg: 0 }); x += w; }
    });
  }

  /** Subset-sum pack of a stretch (`inches`) with the given units. FEWEST, WIDEST
   *  cabinets win (her note: a 44" stretch reads better as ONE 36" double than
   *  as a 24 + a 20): each extra cabinet costs as much as 12" left unfilled, so
   *  doubles are chosen wherever they fit and the group is centred. */
  _packStretch(inches, units) {
    const cap = Math.floor(inches + 0.5);
    if (cap < 20) return [];
    const reach = new Array(cap + 1).fill(null);
    reach[0] = { prev: -1, c: null, n: 0 };
    for (let s = 0; s <= cap; s++) { if (!reach[s]) continue; for (const u of units) { const ns = s + u.w; if (ns <= cap && (!reach[ns] || reach[ns].n > reach[s].n + 1)) reach[ns] = { prev: s, c: u.c, n: reach[s].n + 1 }; } }
    let best = -1, bestScore = Infinity;
    for (let s = cap; s >= 20; s--) { if (!reach[s]) continue; const sc = reach[s].n * 12 + (cap - s); if (sc < bestScore) { bestScore = sc; best = s; } }
    if (best <= 0) return [];
    const out = []; for (let s = best; s > 0; s = reach[s].prev) out.push(reach[s].c);
    return out;
  }
}
