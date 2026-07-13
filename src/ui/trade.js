// trade.js — Plinth Trade: a multi-unit spec-sheet order builder (no 3D).
// Define unit types (1 Bed, 2 Bed…), each a cabinet list with a quantity
// (count or floors×per-floor); see a per-type breakdown + trade total; email it.

import { FINISHES, getCab, sellUSD, fmtUSD } from '../core/catalogue.js';
import { openCabinetPicker, cabChipHTML } from './picker.js';
import { tradeSummary, unitQty, unitName, rowsFromDesign } from '../core/cost.js';
import { buildTradeOrderEmail } from '../core/order.js';
import { buildCabinetLibraryDXF, buildPlanDXF } from '../core/dxf.js';
import { ensureDxfEmail } from './dxfgate.js';
import { buildTradeOrderCSV } from '../core/tradecsv.js';
import { buildFloorplanSVG } from './floorplan.js';
import { bumpRev, unitRev } from '../core/submittal.js';
import { uiConfirm } from './dialog.js';
import { buildSubmittalHTML, buildSubmittalPackHTML, openPrintWindow } from './submittal.js';
import { checkOrder, checkDesign } from '../core/speccheck.js';
import { planPhases, batchWindow, DEFAULT_MAX_PER_BATCH } from '../core/phasing.js';
import { buildXlsx } from '../core/xlsxmini.js';
import { buildTradeWorkbook } from '../core/tradebook.js';
import { isCloud, currentUser } from '../core/cloud.js';
import {
  saveTradeProject, listTradeProjects, loadTradeProject,
  ensureShareToken, submitApproval,
  placeOrder, listOrders, cancelOrder, adminSetStatus, isOrderAdmin,
  logOrderDoc, listOrderDocs,
} from '../core/tradecloud.js';
import {
  buildOrderSnapshot, orderStatusSummary, mergedPhases,
  STATUSES, statusLabel, snapshotToTrade, DOC_LABELS,
} from '../core/orders.js';
import { buildInvoiceModel } from '../core/invoice.js';
import { buildInvoiceHTML } from './invoice.js';
import { buildChangeOrderModel } from '../core/changeorder.js';
import { buildChangeOrderHTML } from './changeorder.js';

const BED_TYPES = ['Studio', '1 Bed', '2 Bed', '3 Bed', '4 Bed', 'Penthouse'];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export class TradeUI {
  constructor({ store, onDesignLoad, openAccount } = { store: null }) {
    this.store = store;
    this.onDesignLoad = onDesignLoad || null;
    this.openAccount = openAccount || null;  // opens the existing sign-in modal
    this.approval = false;                   // read-only ?tshare= approval view
    this.view = 'build';                     // 'build' | 'orders'
    this._lastOrder = null;                  // snapshot placed this session
    this.root = document.getElementById('tradePanel');
    this._stash = null;         // home-mode state saved while designing a unit
    this._designUnitId = null;
    store.subscribe((s, c) => {
      if (['mode', 'load', 'reset'].includes(c.type)) this.render();
    });
    this.render();
  }

  get t() { return this.store.state.trade; }

  newUnit() {
    return { id: this.t.nextUnitId++, beds: '1 Bed', letter: LETTERS[Math.min(this.t.units.length, 5)], name: '', qty: 1, floorFrom: '', floorTo: '', perFloor: '', rows: [] };
  }
  newRow() { return { id: this.t.nextRowId++, code: '', qty: 1 }; }

  render() {
    if (!this.root) return;
    if (this.approval) { this.renderApproval(); return; }
    if (this.view === 'orders') { this.renderOrders(); return; }
    const t = this.t;
    this.root.innerHTML = `
      <div class="trade-wrap">
        <header class="trade-head">
          <div>
            <div class="trade-title">PL<span class="slash">/</span>NTH <span>Trade</span></div>
            <div class="trade-sub">Multi-unit spec &amp; order — for developers, builders &amp; designers</div>
            <div class="trade-steps" aria-label="How it works">
              <span class="ts"><em>1</em> Define your unit types</span><span class="ts-sep">→</span>
              <span class="ts"><em>2</em> Lay out each unit in 3D</span><span class="ts-sep">→</span>
              <span class="ts"><em>3</em> Submittals, pricing &amp; order</span>
            </div>
            <div class="trade-exports">
              <button class="ghost sm" id="tDxfLib" title="Every PL/NTH SKU as a named AutoCAD block (front elevations, DXF R12)">⤓ DXF cabinet library</button>
              <button class="ghost sm" id="tOrderCsv" title="The full order as a spreadsheet — lines, totals, containers &amp; shipping">⤓ Order CSV</button>
              <button class="ghost sm" id="tWorkbook" title="One Excel workbook: summary, a sheet per designed unit, the full order with a PO field, and delivery phasing">⬇ Project workbook (.xlsx)</button>
              <button class="ghost sm" id="tUnitPlans" title="One plan DXF per designed unit type">⤓ Unit plans DXF</button>
              <button class="ghost sm" id="tSubmittalPack" title="One architect-ready submittal PDF: project cover + cover, plan, elevations, schedule &amp; cut sheets for every designed unit type">📄 Submittal pack (all units)</button>
            </div>
          </div>
          <div class="trade-meta">
            <label>Project<input id="tProject" value="${esc(t.project)}" placeholder="e.g. Hudson Yards Tower"></label>
            <label>Finish<select id="tFinish">${FINISHES.map((f) => `<option ${f.name === t.finish ? 'selected' : ''}>${f.name}</option>`).join('')}</select></label>
            ${isCloud() ? `<div class="trade-cloud">
              <button class="ghost sm" id="tCloudSave" title="Save this project to your PL/NTH account (sign-in required)">☁ Save project</button>
              <button class="ghost sm" id="tCloudOpen" title="Open one of your saved trade projects">📂 Open project</button>
              <button class="ghost sm" id="tCloudShare" title="Copy a read-only link — the architect or client reviews &amp; approves the spec, no account needed">🔗 Share</button>
              <button class="ghost sm" id="tOrders" title="Your placed orders with live status — submitted, confirmed, in production, shipped, delivered">📦 Orders</button>
            </div>` : ''}
          </div>
        </header>

        <div id="tUnits">${t.units.map((u) => this.unitCard(u)).join('')}</div>
        <button class="ghost" id="tAddUnit">+ Add unit type</button>

        <div id="tTotals">${this.totalsHTML()}</div>

        <section class="trade-order">
          <div class="trade-fields">
            <label>Your name<input id="tcName" value="${esc(this.store.state.customer.name)}"></label>
            <label>Email<input id="tcEmail" value="${esc(this.store.state.customer.email)}"></label>
            <label>Notes<input id="tcNotes" value="${esc(this.store.state.customer.notes)}"></label>
          </div>
          <button class="cta" id="tPlaceOrder">Place trade order →</button>
          <div class="trade-note">Opens an email to imogen@plinthmade.com with your full spec. Trade pricing is confirmed per order on quote.</div>
        </section>
      </div>`;
    this.wire();
  }

  unitCard(u) {
    const q = unitQty(u);
    const useFloors = u.floorFrom !== '' && u.floorTo !== '' && u.perFloor !== '';
    return `<section class="unit-card" data-unit="${u.id}">
      <div class="unit-head">
        <div class="unit-head-fields">
          <label>Bed type<select data-act="u-beds">${BED_TYPES.map((b) => `<option ${b === u.beds ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
          <label>Type<select data-act="u-letter">${LETTERS.map((l) => `<option ${l === u.letter ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Name (optional)<input data-act="u-name" value="${esc(u.name)}" placeholder="${esc(unitName(u))}"></label>
          <label class="sm">Floors from<input data-act="u-from" type="number" value="${u.floorFrom}"></label>
          <label class="sm">to<input data-act="u-to" type="number" value="${u.floorTo}"></label>
          <label class="sm">Per floor<input data-act="u-per" type="number" value="${u.perFloor}"></label>
          <label class="sm">Units${useFloors ? ' (auto)' : ''}<input data-act="u-qty" type="number" value="${q}" ${useFloors ? 'disabled' : ''}></label>
        </div>
        <div class="unit-head-btns">
          ${u.design ? `<button class="sm" data-act="u-submittal" title="Architect-ready submittal PDF: cover, plan, elevations, schedule &amp; cut sheets">📄 Submittal PDF</button>
          <button class="ghost sm" data-act="u-rev" title="Bump the revision letter (records the date on this unit's revision history)">Rev ${esc(unitRev(u))} +</button>` : ''}
          <button class="danger sm" data-act="u-del">Remove</button>
        </div>
      </div>
      ${this.designHTML(u)}
      <table class="unit-rows">
        <thead><tr><th>Qty</th><th>Cabinet</th><th class="num">Each</th><th class="num">Line</th><th></th></tr></thead>
        <tbody>${(u.rows.length ? u.rows.map((r) => this.rowHTML(u, r)).join('') : `<tr><td colspan="5" class="muted">No cabinets yet</td></tr>`)}</tbody>
      </table>
      <button class="ghost sm" data-act="u-addrow">+ Add cabinet</button>
      <div class="spec-wrap" id="sc-${u.id}">${this.specHTML(u)}</div>
      <div class="unit-foot" id="uf-${u.id}">${this.unitFootHTML(u)}</div>
    </section>`;
  }

  // ---- spec check: live findings under each unit's order table ------------
  unitFindings(u) {
    const hasRows = (u.rows || []).some((r) => getCab(r.code) && (Number(r.qty) || 0) > 0);
    if (u.design) return checkDesign(u.design).concat(
      hasRows ? checkOrder(u.rows, u).filter((f) => f.msg.includes('PER UNIT')) : []);
    return hasRows ? checkOrder(u.rows, u) : null;   // null = nothing to check yet
  }

  specHTML(u) {
    const finds = this.unitFindings(u);
    if (!finds) return '';
    if (!finds.length) return `<div class="spec-strip spec-clear">✓ Spec check clear</div>`;
    const LV = { error: 'ERROR', warn: 'WARN', info: 'INFO' };
    return `<div class="spec-strip">
      <div class="spec-head">⚠ Spec check — ${finds.length} finding${finds.length === 1 ? '' : 's'}</div>
      ${finds.map((f) => `<div class="spec-item spec-${f.level}"><span class="spec-lv">${LV[f.level] || f.level}</span><span>${esc(f.msg)}</span></div>`).join('')}
    </div>`;
  }

  // The design block is the visual centre of every unit card: a floorplan
  // thumbnail once a layout exists, and an unmissable invitation to draw one
  // when it doesn't (the layout is where rows, pricing and submittals come from).
  designHTML(u) {
    if (!u.design) {
      return `<div class="unit-design unit-design-empty">
        <div class="unit-thumb unit-thumb-empty" aria-hidden="true">
          <svg viewBox="0 0 88 62"><rect x="3" y="3" width="82" height="56" rx="2" class="ue-room"/>
            <path class="ue-run" d="M8 12 H80 M13 8 V54"/><rect class="ue-isl" x="34" y="32" width="26" height="11" rx="1.5"/></svg>
        </div>
        <div class="unit-design-meta">
          <strong>No layout yet</strong>
          <span>Draw this unit's kitchen once in 3D — the cabinet list, pricing, plans and submittals all come from the layout, repeated across every floor. Or skip the 3D and add cabinets manually below.</span>
          <button class="cta sm" data-act="u-design">✎ Lay out this unit in 3D</button>
        </div>
      </div>`;
    }
    const count = (u.design.items || []).filter((it) => { const c = getCab(it.code); return c && c.placeable; }).length;
    let svg = '';
    try { svg = buildFloorplanSVG(u.design); } catch { svg = ''; }
    return `<div class="unit-design">
      <div class="unit-thumb">${svg}</div>
      <div class="unit-design-meta">
        <strong>Designed layout</strong>
        <span>${count} item${count === 1 ? '' : 's'} placed · cabinet rows derived from the design</span>
        <div class="unit-design-btns">
          <button class="sm" data-act="u-design" title="Reopen this unit's kitchen in the 3D designer">✎ Edit layout in 3D</button>
          <button class="ghost sm" data-act="u-dxf" title="This unit's kitchen plan as AutoCAD DXF">⤓ DXF plan</button>
        </div>
      </div>
    </div>`;
  }

  rowHTML(u, r) {
    const cab = getCab(r.code);
    const each = cab ? sellUSD(cab) : 0;
    return `<tr data-row="${r.id}">
      <td><input class="qty" data-act="r-qty" type="number" min="1" value="${r.qty}"></td>
      <td><button type="button" class="pick-btn${cab ? '' : ' empty'}" data-act="r-pick" title="Choose a cabinet — search by code, name or width">${cabChipHTML(cab)}</button></td>
      <td class="num" id="re-${u.id}-${r.id}">${cab ? fmtUSD(each) : '—'}</td>
      <td class="num" id="rl-${u.id}-${r.id}"><strong>${cab ? fmtUSD(each * (Number(r.qty) || 0)) : '—'}</strong></td>
      <td><button class="danger sm" data-act="r-del">×</button></td>
    </tr>`;
  }

  unitFootHTML(u) {
    const q = unitQty(u);
    let cabs = 0, sell = 0;
    for (const r of u.rows) { const cab = getCab(r.code); if (!cab) continue; const n = Number(r.qty) || 0; cabs += n; sell += sellUSD(cab) * n; }
    return `<span>${cabs} cab/unit</span><span>×${q} units</span><span>${cabs * q} cabinets</span><span><strong>${fmtUSD(sell * q)}</strong></span>`;
  }

  totalsHTML() {
    const s = tradeSummary(this.t);
    const rows = s.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${l.cabsPerUnit}</td><td class="num">×${l.qty}</td><td class="num">${l.totalCabs}</td><td class="num">${fmtUSD(l.totalSell)}</td></tr>`).join('');
    return `<section class="trade-totals">
      <h3>Spec breakdown</h3>
      <table class="breakdown"><thead><tr><th>Unit type</th><th class="num">Cab/unit</th><th class="num">Units</th><th class="num">Cabinets</th><th class="num">Sub-total</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted">Add a unit type to begin</td></tr>`}</tbody></table>
      <div class="grand">
        <div><span class="l">Units</span><span class="v">${s.totalUnits}</span></div>
        <div><span class="l">Cabinets</span><span class="v">${s.totalCabs}</span></div>
        <div><span class="l">Containers</span><span class="v">${s.containers}</span></div>
        <div><span class="l">Cabinets</span><span class="v">${fmtUSD(s.subtotal)}</span></div>
        <div><span class="l">Shipping</span><span class="v">${fmtUSD(s.shipping)}</span></div>
        <div class="hi"><span class="l">Order total</span><span class="v">${fmtUSD(s.grand)}</span></div>
      </div>
    </section>
    ${this.phasingHTML()}`;
  }

  // ---- delivery phasing -----------------------------------------------------
  get phasing() {
    const t = this.t;
    if (!t.phasing) t.phasing = { on: false, maxPerBatch: DEFAULT_MAX_PER_BATCH };
    return t.phasing;
  }

  phasingHTML() {
    const ph = this.phasing;
    return `<section class="trade-totals phasing">
      <h3>Delivery phasing</h3>
      <div class="ph-controls">
        <label class="ph-check"><input type="checkbox" id="phOn" ${ph.on ? 'checked' : ''}> Phase deliveries by floor band</label>
        <label class="ph-max">Max units per batch <input type="number" id="phMax" min="1" value="${Number(ph.maxPerBatch) || DEFAULT_MAX_PER_BATCH}" ${ph.on ? '' : 'disabled'}></label>
      </div>
      <div id="phBatches">${ph.on ? this.phasingTableHTML() : `<div class="ph-note">Off — the whole order ships as one delivery. Turn on to batch floors so each delivery stays manageable; batches feed a phase column into the order CSV.</div>`}</div>
    </section>`;
  }

  phasingTableHTML() {
    const ph = this.phasing;
    const plan = planPhases(this.t, { maxUnitsPerBatch: ph.maxPerBatch });
    if (!plan.batches.length) return `<div class="ph-note">Add unit types (with floors and cabinets) to see the delivery batches.</div>`;
    const rows = plan.batches.map((b) => {
      const w = batchWindow(b);
      return `<tr><td>Phase ${b.n}</td><td>${esc(b.label)}</td><td>${b.byType.map((t) => `${t.qty}× ${esc(t.name)}`).join(' · ')}</td>
        <td class="num">${b.units}</td><td class="num">${b.cabinets}</td><td>${esc(w.from)} – ${esc(w.to)}</td></tr>`;
    }).join('');
    return `<table class="breakdown"><thead><tr><th>Phase</th><th>Floors</th><th>Unit types</th><th class="num">Units</th><th class="num">Cabinets</th><th>Est. delivery window</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="ph-note">First batch on the standard ${plan.base.weeksLo}–${plan.base.weeksHi} week lead time; each later batch ships ~2 weeks after the one before. The phase column is added to the order CSV while phasing is on.</div>`;
  }

  // ---- events ----
  wire() {
    const $ = (id) => document.getElementById(id);
    $('tProject').addEventListener('input', (e) => { this.t.project = e.target.value; this.store.touchTrade({ quiet: true }); });
    $('tFinish').addEventListener('change', (e) => { this.t.finish = e.target.value; this.store.touchTrade({ quiet: true }); });
    $('tAddUnit').addEventListener('click', () => { this.t.units.push(this.newUnit()); this.store.touchTrade(); this.render(); });
    $('tcName').addEventListener('input', (e) => this.store.setCustomer({ name: e.target.value }));
    $('tcEmail').addEventListener('input', (e) => this.store.setCustomer({ email: e.target.value }));
    $('tcNotes').addEventListener('input', (e) => this.store.setCustomer({ notes: e.target.value }));
    $('tPlaceOrder').addEventListener('click', () => this.placeOrder());
    $('tDxfLib')?.addEventListener('click', async () => {
      if (!(await ensureDxfEmail('cabinet-library'))) return;
      download('PLINTH_cabinet_library.dxf', buildCabinetLibraryDXF(), 'application/dxf');
      toast('Cabinet library DXF downloaded — insert the PLNTH_* blocks in AutoCAD.');
    });
    $('tOrderCsv')?.addEventListener('click', () => {
      const s = tradeSummary(this.t);
      if (!s.totalCabs) return toast('Add unit types and cabinets first.');
      download('PLINTH_trade_order.csv', buildTradeOrderCSV(this.t), 'text/csv');
      toast('Order CSV downloaded.');
    });
    $('tWorkbook')?.addEventListener('click', () => this.downloadWorkbook());
    $('tOrders')?.addEventListener('click', () => { this.view = 'orders'; this.render(); });
    $('tCloudSave')?.addEventListener('click', () => this.cloudSave());
    $('tCloudOpen')?.addEventListener('click', () => this.cloudOpen());
    $('tCloudShare')?.addEventListener('click', () => this.cloudShare());
    $('tSubmittalPack')?.addEventListener('click', () => {
      const designed = this.t.units.filter((u) => u.design);
      if (!designed.length) return toast('No designed units yet — hit “✎ Design this unit” first.');
      openPrintWindow(buildSubmittalPackHTML(this.t));
      toast('Submittal pack opened — use the print dialog to save it as a PDF.');
    });
    $('tUnitPlans')?.addEventListener('click', async () => {
      const designed = this.t.units.filter((u) => u.design);
      if (!designed.length) return toast('No designed units yet — hit “✎ Design this unit” first.');
      if (!(await ensureDxfEmail('unit-plans'))) return;
      for (const u of designed) download(`PLINTH_${unitName(u).replace(/\s+/g, '_')}.dxf`, buildPlanDXF(u.design), 'application/dxf');
      toast(`${designed.length} unit plan DXF${designed.length === 1 ? '' : 's'} downloaded.`);
    });

    // delegation for unit/row controls
    document.getElementById('tUnits').addEventListener('click', (e) => this.onClick(e));
    document.getElementById('tUnits').addEventListener('change', (e) => this.onChange(e));
    document.getElementById('tUnits').addEventListener('input', (e) => this.onInput(e));

    // delivery phasing controls (delegated on #tTotals so refreshLive's
    // innerHTML swaps don't orphan the listeners)
    const tot = $('tTotals');
    tot.addEventListener('change', (e) => {
      if (e.target.id !== 'phOn') return;
      this.phasing.on = e.target.checked;
      this.store.touchTrade({ quiet: true });
      tot.innerHTML = this.totalsHTML();
    });
    tot.addEventListener('input', (e) => {
      if (e.target.id !== 'phMax') return;
      this.phasing.maxPerBatch = Math.max(1, Number(e.target.value) || DEFAULT_MAX_PER_BATCH);
      this.store.touchTrade({ quiet: true });
      const wrap = document.getElementById('phBatches');
      if (wrap && this.phasing.on) wrap.innerHTML = this.phasingTableHTML();
    });
  }

  unitFor(el) { const card = el.closest('[data-unit]'); return card && this.t.units.find((u) => u.id === +card.dataset.unit); }
  rowFor(el, u) { const tr = el.closest('[data-row]'); return tr && u.rows.find((r) => r.id === +tr.dataset.row); }

  onClick(e) {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const u = this.unitFor(el); if (!u) return;
    const act = el.dataset.act;
    if (act === 'u-del') { this.t.units = this.t.units.filter((x) => x.id !== u.id); this.store.touchTrade(); this.render(); }
    else if (act === 'u-addrow') { u.rows.push(this.newRow()); this.store.touchTrade(); this.render(); }
    else if (act === 'u-design') { this.enterDesign(u); }
    else if (act === 'u-submittal') {
      if (!u.design) return toast('Design this unit first — the submittal is built from its layout.');
      openPrintWindow(buildSubmittalHTML({ project: this.t.project, unit: u }));
      toast('Submittal opened — use the print dialog to save it as a PDF.');
    }
    else if (act === 'u-rev') {
      const rev = bumpRev(u);
      this.store.touchTrade();
      this.render();
      toast(`Revision bumped to ${rev} — recorded on the unit's history.`);
    }
    else if (act === 'u-dxf') {
      if (u.design) {
        ensureDxfEmail('unit-dxf').then((ok) => {
          if (!ok) return;
          download(`PLINTH_${unitName(u).replace(/\s+/g, '_')}.dxf`, buildPlanDXF(u.design), 'application/dxf');
          toast('Unit plan DXF downloaded.');
        });
      }
    }
    else if (act === 'r-pick') {
      const r = this.rowFor(el, u); if (!r) return;
      openCabinetPicker({
        selected: r.code,
        onPick: (code) => { r.code = code; this.store.touchTrade(); this.render(); },
      });
    }
    else if (act === 'r-del') { const r = this.rowFor(el, u); u.rows = u.rows.filter((x) => x.id !== r.id); this.store.touchTrade(); this.render(); }
  }

  // ---- design-per-unit-type: one design → every floor --------------------
  /** Name of the unit type being designed from TRADE right now, or null.
   *  The wizard and main.js read this to switch into the trade voice. */
  designingUnit() {
    if (!this._stash || this._designUnitId == null) return null;
    const u = ((this._stash.trade && this._stash.trade.units) || []).find((x) => x.id === this._designUnitId);
    return u ? unitName(u) : 'this unit';
  }

  /** Stash the current state, load this unit's design (or a blank room) into
   *  Home mode, and show the persistent Done/Cancel banner. */
  enterDesign(u) {
    if (this._stash) return;                       // already designing
    this._stash = this.store.serialize();
    this._designUnitId = u.id;
    let d;
    if (u.design) d = JSON.parse(JSON.stringify(u.design));
    else { d = this.store.serialize(); d.items = []; d.accessories = {}; }
    d.mode = 'home';
    delete d.trade;                                // designs never nest trade state
    this.store.replace(d);
    this.onDesignLoad?.();
    this.showBanner(unitName(u));
    this._setDesignChrome(unitName(u));
  }

  /** Done → save the design on the unit + derive its cabinet rows.
   *  Cancel → throw the edit away. Either way restore the stashed state. */
  finishDesign(save) {
    const stash = this._stash;
    if (!stash) return;
    if (save) {
      const design = this.store.serialize();
      design.mode = 'home';
      delete design.trade;
      const t = stash.trade;
      const su = (t.units || []).find((x) => x.id === this._designUnitId);
      if (su) {
        su.design = design;                        // JSONB-ready snapshot
        su.rows = rowsFromDesign(design.items)     // manual rows → derived rows
          .map((r) => ({ id: t.nextRowId++, code: r.code, qty: r.qty }));
      }
    }
    this._stash = null;
    this._designUnitId = null;
    document.getElementById('designBanner')?.remove();
    // the wizard's post-generate bar dies with the design session — it must
    // never linger over the TRADE panel
    document.getElementById('wzResult')?.classList.remove('show');
    document.getElementById('wzFlash')?.classList.remove('show');
    document.body.classList.remove('wz-reviewing');
    this._restoreDesignChrome();
    this.store.replace(stash);                     // back to Trade, home restored
    this.onDesignLoad?.();
    if (save) toast('Design saved — cabinet rows updated from the layout.');
  }

  // ---- trade voice on the shared Home chrome ------------------------------
  // While a unit design session is open, the Home designer's consumer copy
  // ("Sketch my kitchen", the first-run tour) is re-voiced for the pro doing
  // a takeoff. Text is swapped IN PLACE (never innerHTML on listener-bearing
  // ancestors) and restored verbatim on Done/Cancel.
  _setDesignChrome(name) {
    const top = document.getElementById('wzTopOpen');
    if (top) {
      top.textContent = '✎ Auto-layout this unit';
      top.title = `Generate a starting layout for ${name} from its room size, openings and appliances`;
    }
    const es = document.getElementById('emptyState');
    if (es) {
      const set = (sel, txt) => { const el = es.querySelector(sel); if (el) el.textContent = txt; };
      set('.es-eyebrow', 'PL/NNER · Trade');
      set('h3', `Lay out ${name}`);
      const steps = es.querySelectorAll('.es-t-step p');
      if (steps[0]) steps[0].innerHTML = '<strong>Auto-layout this unit</strong> — room size, openings &amp; appliances';
      if (steps[2]) steps[2].innerHTML = '<strong>✓ Done</strong> saves it to the unit type — every floor updates';
      set('#esInspire', '✎ Auto-layout this unit');
    }
  }

  _restoreDesignChrome() {
    const top = document.getElementById('wzTopOpen');
    if (top) {
      top.textContent = '✎ Sketch my kitchen';
      top.title = "Start from one of our designs — pick a size and we'll sketch a few ideas";
    }
    const es = document.getElementById('emptyState');
    if (es) {
      const set = (sel, txt) => { const el = es.querySelector(sel); if (el) el.textContent = txt; };
      set('.es-eyebrow', 'Welcome to PL/NNER');
      set('h3', "Let's plan your kitchen");
      const steps = es.querySelectorAll('.es-t-step p');
      if (steps[0]) steps[0].innerHTML = '<strong>Sketch my kitchen</strong> — answer five quick questions';
      if (steps[2]) steps[2].innerHTML = 'Quote / PDF when you love it';
      set('#esInspire', '✎ Sketch my kitchen');
    }
  }

  showBanner(name) {
    let b = document.getElementById('designBanner');
    if (!b) { b = document.createElement('div'); b.id = 'designBanner'; document.body.appendChild(b); }
    b.innerHTML = `<span>Designing <strong>Unit ${esc(name)}</strong></span>
      <button type="button" id="dbDone">✓ Done</button>
      <button type="button" id="dbCancel" class="db-ghost">✕ Cancel</button>`;
    b.querySelector('#dbDone')?.addEventListener('click', () => this.finishDesign(true));
    b.querySelector('#dbCancel')?.addEventListener('click', () => this.finishDesign(false));
  }

  onChange(e) {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const u = this.unitFor(el); if (!u) return;
    const act = el.dataset.act;
    if (act === 'u-beds') { u.beds = el.value; this.render(); }
    else if (act === 'u-letter') { u.letter = el.value; this.render(); }
  }

  onInput(e) {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const u = this.unitFor(el); if (!u) return;
    const act = el.dataset.act;
    const num = (v) => (v === '' ? '' : (Number(v) || 0));
    if (act === 'u-name') u.name = el.value;
    else if (act === 'u-from') u.floorFrom = num(el.value);
    else if (act === 'u-to') u.floorTo = num(el.value);
    else if (act === 'u-per') u.perFloor = num(el.value);
    else if (act === 'u-qty') u.qty = num(el.value);
    else if (act === 'r-qty') { const r = this.rowFor(el, u); r.qty = Number(el.value) || 0; }
    this.store.touchTrade({ quiet: true });
    this.refreshLive(u);
  }

  // live-update computed numbers without rebuilding inputs (keeps focus)
  refreshLive(u) {
    for (const r of u.rows) {
      const cab = getCab(r.code);
      const lineEl = document.getElementById(`rl-${u.id}-${r.id}`);
      if (lineEl) lineEl.innerHTML = cab ? `<strong>${fmtUSD(sellUSD(cab) * (Number(r.qty) || 0))}</strong>` : '—';
    }
    const foot = document.getElementById(`uf-${u.id}`);
    if (foot) foot.innerHTML = this.unitFootHTML(u);
    const spec = document.getElementById(`sc-${u.id}`);
    if (spec) spec.innerHTML = this.specHTML(u);
    const tot = document.getElementById('tTotals');
    if (tot) tot.innerHTML = this.totalsHTML();
  }

  // ---- project workbook (.xlsx — built fully offline) ---------------------
  downloadWorkbook() {
    const s = tradeSummary(this.t);
    if (!s.totalCabs) return toast('Add unit types and cabinets first.');
    const bytes = buildXlsx(buildTradeWorkbook(this.t, Date.now(), this._lastOrder?.orderNo || null));
    const name = (this.t.project || 'PLINTH project')
      .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'PLINTH_project';
    download(`${name}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast('Project workbook downloaded — summary, unit sheets, order & phasing.');
  }

  // ---- cloud projects (save / open / share) --------------------------------
  async requireSignIn() {
    let user = null;
    try { user = await currentUser(); }
    catch { toast('Cloud unavailable right now — your project is still saved on this device.'); return false; }
    if (user) return true;
    toast('Sign in first — then your trade projects save to your account.');
    this.openAccount?.();
    return false;
  }

  async cloudSave() {
    if (!(await this.requireSignIn())) return;
    try {
      await saveTradeProject(this.t);
      this.store.touchTrade({ quiet: true });   // persist cloudId locally
      toast('Project saved to your account ✓');
    } catch (e) { toast(`Could not save — ${e.message || 'are you online?'}`); }
  }

  async cloudOpen() {
    if (!(await this.requireSignIn())) return;
    let rows;
    try { rows = await listTradeProjects(); }
    catch (e) { return toast(`Could not load your projects — ${e.message || 'are you online?'}`); }
    this.showProjectList(rows);
  }

  showProjectList(rows) {
    document.getElementById('tcloudModal')?.remove();
    const m = document.createElement('div');
    m.id = 'tcloudModal';
    m.innerHTML = `<div class="cloud-card"><h3>My trade projects</h3>
      <p class="cloud-sub">Open a saved project — it replaces what's on screen.</p>
      <div class="cloud-list">${rows.length ? rows.map((r) => `
        <div class="design-row" data-id="${r.id}">
          <span>${esc(r.name || 'Untitled project')} <em>${r.share_token ? '· shared' : ''}</em></span>
          <span><button class="linkbtn" data-open="${r.id}">Open</button></span>
        </div>`).join('') : '<div class="cloud-msg">No saved trade projects yet — hit ☁ Save project.</div>'}</div>
      <button class="cloud-x" id="tcloudClose">×</button></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#tcloudClose').addEventListener('click', () => m.remove());
    m.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const row = await loadTradeProject(b.dataset.open);
        if (!row || !row.data) return toast('That project could not be loaded.');
        const base = this.store.state.trade;
        this.store.state.trade = {
          ...base, ...row.data,
          units: Array.isArray(row.data.units) ? row.data.units : [],
          cloudId: row.id,
          shareToken: row.share_token || row.data.shareToken || null,
        };
        this.store.touchTrade();
        m.remove();
        this.render();
        toast(`Opened “${row.name || 'Untitled project'}”.`);
      } catch (e) { toast(`Could not open — ${e.message || 'are you online?'}`); }
    }));
  }

  async cloudShare() {
    if (!(await this.requireSignIn())) return;
    try {
      if (!this.t.cloudId) await saveTradeProject(this.t);
      const tok = await ensureShareToken(this.t);
      this.store.touchTrade({ quiet: true });
      const url = `${location.origin}${location.pathname}?tshare=${tok}`;
      try {
        await navigator.clipboard.writeText(url);
        toast('Share link copied — anyone with it sees a read-only spec they can approve.');
      } catch { prompt('Copy your read-only share link:', url); }
    } catch (e) { toast(`Could not create the share link — ${e.message || 'are you online?'}`); }
  }

  // ---- read-only approval view (?tshare=<token>) ---------------------------
  /** Swap in the shared project and lock the whole tab down to review-only. */
  enterApproval(sharedTrade) {
    this.approval = true;
    const base = this.store.state.trade;
    this.store.state.trade = {
      ...base, ...sharedTrade,
      units: Array.isArray(sharedTrade.units) ? sharedTrade.units : [],
    };
    document.body.classList.add('approval-mode');
    this.store.setMode('trade');   // emits → applyMode() + render()
    this.render();
  }

  renderApproval() {
    const t = this.t;
    const revs = t.units.length ? t.units.map((u) => `${unitName(u)} · Rev ${unitRev(u)}`).join('  ·  ') : 'Rev A';
    this.root.innerHTML = `
      <div class="trade-wrap approval">
        <div class="approval-banner"><span class="ab-lock">🔒</span>
          <span><strong>Read-only — shared for approval</strong> · ${esc(revs)}</span>
          <span class="ab-sub">Review the spec below, then approve it with your name &amp; email.</span>
        </div>
        <header class="trade-head">
          <div>
            <div class="trade-title">PL<span class="slash">/</span>NTH <span>Trade</span></div>
            <div class="trade-sub">Project spec shared for approval</div>
          </div>
          <div class="trade-meta approval-meta">
            <label>Project<span class="ap-val">${esc(t.project || 'Untitled project')}</span></label>
            <label>Finish<span class="ap-val">${esc(t.finish || '')}</span></label>
          </div>
        </header>
        <div id="tUnits">${t.units.map((u) => this.unitCard(u)).join('') || '<div class="cloud-msg">This shared project has no unit types yet.</div>'}</div>
        <div id="tTotals">${this.totalsHTML()}</div>
        <section class="approve-box" id="approveBox">
          <h3>Approve this spec</h3>
          <p class="cloud-sub">Your approval is recorded with the project (${esc(revs)}) and the date.</p>
          <form id="apForm">
            <label>Your name<input id="apName" required autocomplete="name"></label>
            <label>Email<input id="apEmail" type="email" required autocomplete="email"></label>
            <button class="cta" type="submit" id="apSubmit">✓ Approve this spec</button>
          </form>
        </section>
      </div>`;
    // lock everything down: no edits, no order/save/export buttons
    this.root.querySelectorAll('input, select, textarea, button').forEach((el) => {
      if (!el.closest('#approveBox')) el.disabled = true;
    });
    this.wireApproval();
  }

  wireApproval() {
    this.root.querySelector('#apForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = this.t;
      const name = this.root.querySelector('#apName').value.trim();
      const email = this.root.querySelector('#apEmail').value.trim();
      if (!name || !email) return toast('Add your name and email to approve.');
      const btn = this.root.querySelector('#apSubmit');
      btn.disabled = true; btn.textContent = 'Recording…';
      const revs = t.units.map((u) => `${unitName(u)}: Rev ${unitRev(u)}`).join(', ');
      try {
        await submitApproval({ name, email, project: t.project, revs });
        const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        this.root.querySelector('#approveBox').innerHTML = `
          <h3>Approved ✓</h3>
          <div class="approve-done">Thank you, ${esc(name)} — your approval of “${esc(t.project || 'Untitled project')}”
          (${esc(revs || 'Rev A')}) was recorded on ${esc(date)}. PL/NTH and the project owner can see it now.</div>`;
        toast('Approval recorded ✓');
      } catch (err) {
        btn.disabled = false; btn.textContent = '✓ Approve this spec';
        toast(`Could not record the approval — ${err.message || 'are you online?'}`);
      }
    });
  }

  async placeOrder() {
    const s = tradeSummary(this.t);
    if (!s.totalCabs) return toast('Add unit types and cabinets first.');
    if (!this.store.state.customer.name || !this.store.state.customer.email) return toast('Add your name and email.');
    // spec check across every unit type — surface the findings before ordering
    const all = [];
    for (const u of this.t.units) {
      for (const f of this.unitFindings(u) || []) all.push(`• [${unitName(u)}] ${f.level.toUpperCase()} — ${f.msg}`);
    }
    if (all.length) {
      const go = await uiConfirm(all.join('\n\n'), {
        title: `Spec check found ${all.length} item${all.length === 1 ? '' : 's'}`,
        confirmLabel: 'Place order anyway', cancelLabel: 'Go back',
      });
      if (!go) return;
    }

    // no cloud configured → the email path IS the order path
    if (!isCloud()) return this.emailOrder();

    let user = null;
    try { user = await currentUser(); } catch { user = null; }
    if (!user) return this.orderFallback('signin');

    const snapshot = buildOrderSnapshot(this.t, { customer: this.store.state.customer });
    try {
      await placeOrder(snapshot);            // may re-mint orderNo on collision
      this._lastOrder = snapshot;
      this.showOrderSuccess(snapshot);
    } catch (e) {
      this.orderFallback('cloud', e && e.message);
    }
  }

  /** The always-available path: a pre-filled email to imogen@plinthmade.com. */
  emailOrder() {
    window.location.href = buildTradeOrderEmail(this.store.state).href;
    toast('Opening your email to send the trade order…');
  }

  /** Cloud ordering isn't available (signed out / unreachable) — never block:
   *  explain, offer sign-in when it would help, and ALWAYS offer the email. */
  orderFallback(reason, detail) {
    document.getElementById('tOrderModal')?.remove();
    const m = document.createElement('div');
    m.id = 'tOrderModal';
    const signin = reason === 'signin';
    m.innerHTML = `<div class="cloud-card order-modal">
      <h3>${signin ? 'Sign in to track this order' : 'Cloud unreachable'}</h3>
      <p class="cloud-sub">${signin
        ? 'Signed-in orders get an order number and live status — submitted, confirmed, in production, shipped, delivered.'
        : `The order could not reach PL/NTH's cloud${detail ? ` (${esc(detail)})` : ''} — your spec is safe on this device.`}</p>
      <div class="order-modal-btns">
        ${signin ? `<button class="cta" id="omSignin">Sign in, then order</button>` : ''}
        <button class="ghost" id="omEmail">✉ Send order by email instead</button>
      </div>
      <button class="cloud-x" id="omClose">×</button></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#omClose').addEventListener('click', () => m.remove());
    m.querySelector('#omSignin')?.addEventListener('click', () => { m.remove(); this.openAccount?.(); });
    m.querySelector('#omEmail').addEventListener('click', () => { m.remove(); this.emailOrder(); });
  }

  showOrderSuccess(snapshot) {
    document.getElementById('tOrderModal')?.remove();
    const m = document.createElement('div');
    m.id = 'tOrderModal';
    m.innerHTML = `<div class="cloud-card order-modal order-success">
      <h3>Order placed ✓</h3>
      <div class="order-no-big">${esc(snapshot.orderNo)}</div>
      <p class="cloud-sub">Your trade order for <strong>${esc(snapshot.project)}</strong>
        (${snapshot.totals.cabinets} cabinets · ${fmtUSD(snapshot.totals.grand)}) is with PL/NTH —
        we'll confirm by email. Track it any time under 📦 Orders.</p>
      <div class="order-modal-btns">
        <button class="ghost" id="osCsv">⤓ Download CSV</button>
        <button class="ghost" id="osXlsx">⬇ Download workbook</button>
        <button class="cta" id="osView">📦 View orders</button>
      </div>
      <button class="linkbtn order-email-alt" id="osEmail">Send order by email instead</button>
      <button class="cloud-x" id="osClose">×</button></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#osClose').addEventListener('click', () => m.remove());
    m.querySelector('#osCsv').addEventListener('click', () => {
      download('PLINTH_trade_order.csv', buildTradeOrderCSV(this.t), 'text/csv');
      toast('Order CSV downloaded.');
    });
    m.querySelector('#osXlsx').addEventListener('click', () => this.downloadWorkbook());
    m.querySelector('#osView').addEventListener('click', () => { m.remove(); this.view = 'orders'; this.render(); });
    m.querySelector('#osEmail').addEventListener('click', () => this.emailOrder());
  }

  // ---- ORDERS view: the signed-in user's placed orders + live status --------
  async renderOrders() {
    this.root.innerHTML = `
      <div class="trade-wrap orders-wrap">
        <header class="trade-head">
          <div>
            <div class="trade-title">PL<span class="slash">/</span>NTH <span>Orders</span></div>
            <div class="trade-sub">Your placed trade orders — live status from PL/NTH</div>
          </div>
          <div class="trade-meta"><button class="ghost sm" id="oBack">← Back to project</button></div>
        </header>
        <div id="ordersBody"><div class="cloud-msg">Loading your orders…</div></div>
      </div>`;
    this.root.querySelector('#oBack').addEventListener('click', () => { this.view = 'build'; this.render(); });
    const body = this.root.querySelector('#ordersBody');

    let user = null;
    try { user = await currentUser(); } catch { user = null; }
    if (!user) {
      body.innerHTML = `<div class="orders-empty">
        <h3>Sign in to see your orders</h3>
        <p>Orders placed from your PL/NTH account show up here with their order number and live status.</p>
        <button class="cta" id="oSignin">Sign in</button>
      </div>`;
      body.querySelector('#oSignin').addEventListener('click', () => this.openAccount?.());
      return;
    }

    let rows, admin = false;
    try { [rows, admin] = await Promise.all([listOrders(), isOrderAdmin()]); }
    catch (e) {
      body.innerHTML = `<div class="orders-empty"><h3>Could not load your orders</h3>
        <p>${esc((e && e.message) || 'Are you online?')} — your projects and exports still work offline.</p></div>`;
      return;
    }
    if (!rows.length) {
      body.innerHTML = `<div class="orders-empty"><h3>No orders yet</h3>
        <p>When you hit “Place trade order” while signed in, the order lands here with a PL- order number and live status tracking.</p></div>`;
      return;
    }
    body.innerHTML = rows.map((r) => this.orderCardHTML(r, admin)).join('');
    this.wireOrders(body, rows, admin);
  }

  orderCardHTML(row, admin) {
    const d = row.data || {};
    const date = row.placed_at
      ? new Date(row.placed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const grand = d.totals ? fmtUSD(d.totals.grand) : '—';
    const phases = mergedPhases(row);
    const cancellable = row.status === 'submitted';
    const statusSel = (cur, act, extra = '') => `<select class="status-sel" data-act="${act}" ${extra}>
      ${STATUSES.concat(['cancelled']).map((s) => `<option value="${s}" ${s === cur ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select>`;
    return `<section class="order-card" data-oid="${row.id}">
      <div class="order-head">
        <span class="order-no">${esc(row.order_no)}</span>
        <span class="order-proj">${esc(row.project || d.project || 'Untitled project')}</span>
        <span class="order-date">${esc(date)}</span>
        <span class="order-grand">${grand}</span>
        <span class="status-pill st-${esc(row.status)}">${esc(orderStatusSummary(row))}</span>
        ${admin ? statusSel(row.status, 'adm-status', 'title="PL/NTH admin: set the order status"') : ''}
        ${row.status !== 'cancelled' ? `
          <button class="ghost sm" data-act="d-gen" data-kind="invoice_deposit" title="Pro-forma deposit invoice (50% on confirmation) — regenerated from the frozen order, print to PDF">Invoice: Deposit</button>
          <button class="ghost sm" data-act="d-gen" data-kind="invoice_balance" title="Pro-forma balance invoice (50% before first shipment) — regenerated from the frozen order, print to PDF">Invoice: Balance</button>` : ''}
        ${cancellable ? `<button class="danger sm" data-act="o-cancel" title="Cancel this order — only possible while it's still 'submitted'">Cancel order</button>` : ''}
      </div>
      ${phases.length ? `<div class="order-phases">${phases.map((p) => `
        <span class="phase-chip st-${esc(p.status)}" data-phase="${esc(p.id)}">
          <strong>${esc(p.id)}</strong> · ${esc(p.label)} · ${esc(p.window ? `${p.window.from} – ${p.window.to}` : '')} ·
          <em>${esc(statusLabel(p.status))}</em>
          ${admin ? statusSel(p.status, 'adm-phase', `data-phase-id="${esc(p.id)}" title="PL/NTH admin: set this phase's status"`) : ''}
        </span>`).join('')}</div>` : ''}
      <details class="order-detail">
        <summary>${(d.unitTypes || []).length} unit type${(d.unitTypes || []).length === 1 ? '' : 's'} · ${d.totals ? d.totals.cabinets : '—'} cabinets — view lines</summary>
        ${(d.unitTypes || []).map((ut) => `
          <div class="order-ut">
            <div class="order-ut-head">${esc(ut.name)} · Rev ${esc(ut.rev || 'A')} · ×${ut.units} units</div>
            <table class="breakdown"><thead><tr><th>Code</th><th>Description</th><th class="num">Qty/unit</th><th class="num">Each</th><th class="num">Line total</th></tr></thead>
            <tbody>${(ut.lines || []).map((l) => `<tr><td>${esc(l.code)}</td><td>${esc(l.desc)}</td>
              <td class="num">${l.qty}</td><td class="num">${fmtUSD(l.each)}</td><td class="num">${fmtUSD(l.total)}</td></tr>`).join('')}</tbody></table>
          </div>`).join('')}
      </details>
      ${this.orderDocsHTML(row)}
    </section>`;
  }

  // ---- DOCS HUB: regenerate the order's paperwork from its frozen snapshot ---
  // No files are stored anywhere — every button rebuilds the document
  // deterministically from row.data (never from live trade state), then logs
  // the issuance to order_documents when the cloud is reachable.
  orderDocsHTML(row) {
    const d = row.data || {};
    const hasDesigns = (d.unitTypes || []).some((ut) => ut.design);
    const cancelled = row.status === 'cancelled';
    const btn = (kind, label, title, disabled = false) =>
      `<button class="ghost sm" data-act="d-gen" data-kind="${kind}" ${disabled ? 'disabled' : ''} title="${title}">${label}</button>`;
    return `<details class="order-docs">
      <summary>DOCUMENTS — regenerated from this order's snapshot</summary>
      <div class="doc-btns">
        ${btn('submittal', '📄 Submittal pack', hasDesigns ? 'Architect-ready submittal PDF for every designed unit type, as ordered' : 'This order has no stored unit designs — the submittal pack needs designed layouts', !hasDesigns)}
        ${btn('workbook', '⬇ Workbook .xlsx', 'The order as an Excel workbook — summary, unit sheets, order lines &amp; PO field')}
        ${btn('csv', '⤓ Order CSV', 'The order lines &amp; totals as a spreadsheet-ready CSV')}
        ${btn('invoice_deposit', '🧾 Deposit invoice', 'Pro-forma deposit invoice — 50% due on confirmation', cancelled)}
        ${btn('invoice_balance', '🧾 Balance invoice', 'Pro-forma balance invoice — 50% due before first shipment', cancelled)}
        ${btn('change_order', '⇄ Change order', 'Diff this frozen order against your CURRENT working spec — rev-to-rev changes, price delta &amp; sign-off sheet, print to PDF', cancelled)}
      </div>
      <div class="doc-log" data-doclog><div class="doc-log-empty">Loading the issued log…</div></div>
    </details>`;
  }

  docLogHTML(docs) {
    if (!docs || !docs.length) {
      return `<div class="doc-log-empty">Nothing issued yet — each document above regenerates from the frozen order and is logged here for both you and PL/NTH.</div>`;
    }
    const fmt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return docs.map((doc) => `<div class="doc-log-row">
      <span>${esc(doc.label || DOC_LABELS[doc.kind] || doc.kind)}${doc.rev ? ` · Rev ${esc(doc.rev)}` : ''}</span>
      <span class="doc-log-date">issued ${esc(fmt(doc.issued_at))}</span>
    </div>`).join('');
  }

  async refreshDocLog(orderId) {
    const el = this.root.querySelector(`[data-oid="${orderId}"] [data-doclog]`);
    if (!el) return;
    try { el.innerHTML = this.docLogHTML(await listOrderDocs(orderId)); }
    catch { el.innerHTML = `<div class="doc-log-empty">Issued log unavailable right now — documents still regenerate offline.</div>`; }
  }

  /** Regenerate one document from the frozen order snapshot + log it. */
  async issueDoc(row, kind) {
    let label = DOC_LABELS[kind] || kind;
    const trade = snapshotToTrade(row);            // frozen snapshot → trade shape
    const placedMs = row.placed_at ? Date.parse(row.placed_at) : Date.now();
    let rev = (row.data && row.data.unitTypes || []).map((ut) => ut.rev || 'A').join('/') || null;

    if (kind === 'change_order') {
      // the one document that reads LIVE state on purpose: it diffs the frozen
      // order against the current working spec (rev-to-rev, price delta)
      const live = this.t;
      if (!live || !live.units.length) return toast('Nothing to compare — the current TRADE spec is empty. Open the project you want to diff against this order first.');
      let seq = 1;                                 // number COs from the issued log
      try { seq = (await listOrderDocs(row.id)).filter((doc) => doc.kind === 'change_order').length + 1; }
      catch { /* offline — CO-…-1 */ }
      const model = buildChangeOrderModel(row, live, { seq });
      if (!model.changes.length) return toast('No differences — the current working spec matches this order exactly.');
      openPrintWindow(buildChangeOrderHTML(model));
      toast(`${model.coNo} opened — countersign to amend the order. Use the print dialog to save it as a PDF.`);
      label = `Change order ${model.coNo}`;
      rev = model.changes.filter((x) => x.kind === 'changed' && x.oldRev !== x.newRev)
        .map((x) => `${x.oldRev}→${x.newRev}`).join('/') || null;
    } else if (kind === 'invoice_deposit' || kind === 'invoice_balance') {
      const model = buildInvoiceModel(row, { kind: kind === 'invoice_deposit' ? 'deposit' : 'balance' });
      openPrintWindow(buildInvoiceHTML(model));
      toast(`${label} opened — use the print dialog to save it as a PDF.`);
      rev = null;
    } else if (kind === 'submittal') {
      if (!trade.units.some((u) => u.design)) return toast('This order has no stored unit designs — no submittal to regenerate.');
      const dateStr = new Date(placedMs).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      openPrintWindow(buildSubmittalPackHTML(trade, dateStr));
      toast('Submittal pack opened — use the print dialog to save it as a PDF.');
    } else if (kind === 'workbook') {
      const bytes = buildXlsx(buildTradeWorkbook(trade, placedMs, row.order_no));
      download(`PLINTH_${row.order_no}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      toast('Project workbook downloaded.');
    } else if (kind === 'csv') {
      download(`PLINTH_${row.order_no}_order.csv`, buildTradeOrderCSV(trade, placedMs), 'text/csv');
      toast('Order CSV downloaded.');
    } else return;

    // log the issuance — cloud only; offline the document still generated
    logOrderDoc(row.id, kind, label, rev)
      .then(() => this.refreshDocLog(row.id))
      .catch(() => { /* offline / signed-out — log gracefully skipped */ });
  }

  wireOrders(body, rows, admin) {
    const rowById = new Map(rows.map((r) => [r.id, r]));
    body.addEventListener('click', async (e) => {
      const gen = e.target.closest('[data-act="d-gen"]');
      if (gen) {
        const id = gen.closest('[data-oid]')?.dataset.oid;
        const row = id && rowById.get(id);
        if (row) this.issueDoc(row, gen.dataset.kind);
        return;
      }
      const btn = e.target.closest('[data-act="o-cancel"]'); if (!btn) return;
      const id = btn.closest('[data-oid]')?.dataset.oid; if (!id) return;
      const row = rowById.get(id);
      if (!(await uiConfirm("This can't be undone.", {
        title: `Cancel order ${row ? row.order_no : ''}?`, confirmLabel: 'Cancel order', cancelLabel: 'Keep it', danger: true,
      }))) return;
      btn.disabled = true;
      try { await cancelOrder(id); toast('Order cancelled.'); this.renderOrders(); }
      catch (err) { btn.disabled = false; toast(`Could not cancel — ${err.message || 'are you online?'}`); }
    });
    // lazy-load each order's issued-document log the first time DOCUMENTS opens
    // (details 'toggle' doesn't bubble → listen in the capture phase)
    body.addEventListener('toggle', (e) => {
      const det = e.target;
      if (!det.matches || !det.matches('.order-docs') || !det.open || det.dataset.logLoaded) return;
      det.dataset.logLoaded = '1';
      const id = det.closest('[data-oid]')?.dataset.oid;
      if (id) this.refreshDocLog(id);
    }, true);
    if (!admin) return;
    body.addEventListener('change', async (e) => {
      const sel = e.target.closest('.status-sel'); if (!sel) return;
      const id = sel.closest('[data-oid]')?.dataset.oid; if (!id) return;
      const row = rowById.get(id); if (!row) return;
      sel.disabled = true;
      try {
        if (sel.dataset.act === 'adm-status') {
          await adminSetStatus(id, sel.value, null);
        } else {
          const map = {};
          for (const p of mergedPhases(row)) map[p.id] = p.status;
          map[sel.dataset.phaseId] = sel.value;
          await adminSetStatus(id, null, map);
        }
        toast('Status updated ✓');
        this.renderOrders();
      } catch (err) { sel.disabled = false; toast(`Could not update — ${err.message || 'are you online?'}`); }
    });
  }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
