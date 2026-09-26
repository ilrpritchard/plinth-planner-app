// main.js — bootstrap: build the scene, sync the store, wire the UI.

import { Store } from './core/store.js';
import { getCab, getFinish, fmtUSD } from './core/catalogue.js';
import { wallsInUse } from './core/placement.js';
import { planBringInside, anyOutside, planClearBoxings } from './core/roomresize.js';
import { summarizeState } from './core/cost.js';
import { computeFillers } from './core/fillers.js';
import { parseLength, fmtFeetIn, fmtIn } from './core/units.js';
import { autosave, loadSaved, loadFromHash, buildShareURL } from './core/persistence.js';
import { shortShareURL, fetchShortDesign } from './core/sharelink.js';
import { createKeepTracker } from './core/keepprompt.js';
import { showKeepCard } from './ui/keepcard.js';
import { Scene } from './scene/Scene.js';
import { Room } from './scene/Room.js';
import { Worktop } from './models/worktop.js';
import { FillerLayer } from './models/filler.js';
import { CorniceLayer } from './models/cornice.js';
import { DecorLayer } from './models/decor.js';
import { CabinetLayer } from './interaction/cabinets.js';
import { settleCorners } from './interaction/snapping.js';
import { PointerControls } from './interaction/controls.js';
import { UI } from './ui/ui.js';
import { buildFloorplanSVG, buildPlanSheetHTML } from './ui/floorplan.js';
import { buildPlanDXF } from './core/dxf.js';
import { ensureDxfEmail, ensureEmailGate, capturedEmail, setLeadContext } from './ui/dxfgate.js';
import { uiAlert, uiChoice, uiConfirm, mailFallback } from './ui/dialog.js';
import { buildQuoteHTML } from './ui/quote.js';
import { openPrintWindow } from './ui/submittal.js';
import { TradeUI } from './ui/trade.js';
import { CloudUI } from './ui/cloudUI.js';
import { Wizard } from './ui/wizard.js';
import { isCloud, requestOrderCheck, currentUser } from './core/cloud.js';
import { photoViews } from './core/photoviews.js';
import { buildZip } from './core/xlsxmini.js';
import { fetchSharedProject } from './core/tradecloud.js';

// Build stamp — bump on each change so you can confirm the browser is running
// the latest code (shown in the top bar + logged to the console). If this
// doesn't update after a hard refresh, the browser is serving cached JS.
const BUILD = 'W2W-179 · uppers match across the cooker as you drag, open shelves deepen to any inch';
console.log('%cPL/NNER build: ' + BUILD, 'color:#8a7', 'font-weight:bold');
{ const t = document.getElementById('buildTag'); if (t) { t.textContent = BUILD.split(' · ')[0]; t.title = BUILD; } }

const store = new Store();
// ?tshare=<token> → read-only trade approval view (never autosaved, so a
// shared project can't clobber the viewer's own local work)
const TSHARE = new URLSearchParams(location.search).get('tshare');
// ?book=1 — site links land straight in the order-check flow (see below)
const BOOK = new URLSearchParams(location.search).get('book') === '1';
// ?s=code — a very short share link: the design is fetched after boot (see below)
const SHORT = new URLSearchParams(location.search).get('s');
// ?order=<token> — a private order-tracking link: read-only status page, no sign-in (see below)
const ORDER = new URLSearchParams(location.search).get('order');
// Load the last local session FIRST, then let a shared #d= design replace the
// visible design on top of it. Order matters: the saved trade project must be
// in the store before the hash load so preserveTrade can keep it — a share
// link opened in a working browser must never wipe a trade project. The hash
// is consumed on load, so a later reload boots straight from the autosave.
const fromSave = loadSaved(store);
const fromHash = loadFromHash(store);
if (!TSHARE) autosave(store);      // persist going forward

const scene = new Scene(document.getElementById('stage'));
const room = new Room(scene);
const worktop = new Worktop(scene);
const fillerLayer = new FillerLayer(scene);
const corniceLayer = new CorniceLayer(scene);
const decorLayer = new DecorLayer(scene);
const layer = new CabinetLayer(scene, store);

function buildRoom(reframe = true) {
  const r = store.state.room;
  room.build(r);
  if (reframe) scene.frameRoom(r.width, r.depth, r.height);
}
buildRoom();

function rebuildWorktop() {
  worktop.rebuild(store.state.items, getCab, store.state.room.worktop, store.state.room);
}
function rebuildFillers() {
  fillerLayer.rebuild(computeFillers(store.state), getFinish(store.state.finish).hex);
}
function rebuildCornice() {
  corniceLayer.rebuild(store.state, getFinish(store.state.finish).hex);
  decorLayer.rebuild(store.state, getCab);
}
rebuildWorktop();
rebuildFillers();
rebuildCornice();

// nothing is ever left through a wall (her rule 2026-09-21). Quiet moves: no undo step, no re-entry.
function bringInside() {
  // ...and never inside a boxing (bulkhead): a boxing is a wall (her rule 2026-09-22)
  const cleared = planClearBoxings(store.state);
  for (const m of cleared.moves) store.updateItem(m.id, { x: m.x, z: m.z }, { quiet: true });
  if (cleared.moves.length) setTimeout(() => { try { layer.rebuildAll(); rebuildWorktop(); rebuildFillers(); rebuildCornice(); ui.refresh?.(); } catch (e) { /* still starting up */ } }, 0);
  // a saved corner unit covered by the run on its face is pulled out to meet it leg to leg (2026-09-25).
  // Bounds from the SAVED room: on a share-link open the 3D room is rebuilt after the store is replaced,
  // so room.bounds() would still be the old room's
  let settled = [];
  try { const rm = store.state.room; settled = settleCorners(store, { minX: -rm.width / 2, maxX: rm.width / 2, minZ: -rm.depth / 2, maxZ: rm.depth / 2 }); } catch { /* a corner that cannot be settled stays */ }
  if (settled.length) setTimeout(() => { try { layer.rebuildAll(); rebuildWorktop(); rebuildFillers(); rebuildCornice(); ui.refresh?.(); } catch (e) { /* still starting up */ } }, 0);
  if (!anyOutside(store.state)) return;
  const plan = planBringInside(store.state);
  for (const m of plan.moves) store.updateItem(m.id, { x: m.x, z: m.z }, { quiet: true });
  setTimeout(() => { try { layer.rebuildAll(); rebuildWorktop(); rebuildFillers(); rebuildCornice(); ui.flagRoomFit(plan); } catch (e) { /* still starting up */ } }, 0);
}

// keep the worktop + fillers + cornice reflowed whenever the layout changes
store.subscribe((s, c) => {
  if (c.quiet) return;
  if (c.type === 'load' || c.type === 'room') bringInside();          // a design saved with cabinets through a wall (or a boxing added over one) is put right
  if (['add', 'remove', 'update', 'swap', 'load', 'reset', 'finish'].includes(c.type)) { store.syncIslands();   // the island flag follows where a cabinet stands
    rebuildWorktop(); rebuildFillers(); rebuildCornice(); }
  else if (c.type === 'room') { rebuildCornice(); } // cornice profile / wall changes
});

const ui = new UI({
  store,
  controls: null, // set below
  onRoomChange: (reframe = false) => { buildRoom(reframe); rebuildWorktop(); rebuildFillers(); rebuildCornice(); },
});

// (the click-a-wall popup is gone, her call 2026-09-26: the Room tab's typed doors & windows and Fill this wall cover it)


// click a placed window / door / doorway → ITS card opens in the left panel, lit, with every field
// (corner, edge, width, sill, height, delete) — no popup (her call 2026-09-25: "i dont think we need
// this pop up... it should just open the window details on the left panel"). The window itself
// glows for a moment so the click is answered in 3D too.
function openOpeningCard({ id }) {
  const o = (store.state.room.openings || []).find((x) => x.id === id);
  if (!o) return;
  ui.focusOpening?.(id);
  room.flashOpening?.(id);
}

const controls = new PointerControls({
  scene,
  cabinetLayer: layer,
  room,
  store,
  onCommit: () => { store.syncIslands(); rebuildWorktop(); },
  onSelect: (id) => ui.showSelbar(id),
  onOpeningClick: (info) => openOpeningCard(info),
  onFitted: (plan, cab) => toast(`${cab.baseCode || cab.code} cut to ${fmtIn(plan.w)} to fill the space. Type a width on the bar to change it.`),
});
ui.controls = controls; // late-bind so UI buttons can drive the controls

// per-frame: grounding guard + auto-hide the walls between camera and room
scene.onBeforeRender(() => {
  layer.groundTick();
  room.updateWallVisibility(scene.camera.position, scene.view, wallsInUse(store.state));
});

// ----- undo / redo -----
function refreshHistoryButtons() {
  const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
  if (u) u.disabled = !store.canUndo;
  if (r) r.disabled = !store.canRedo;
}
store.subscribe((s, c) => {
  // a history restore can change the room too — rebuild it (no reframe)
  if (c.type === 'load' && c.hist) { buildRoom(false); ui.refresh?.(); }
  if (!c.quiet) refreshHistoryButtons();
});
document.getElementById('btnUndo')?.addEventListener('click', () => { layer.select(null); ui.showSelbar(null); store.undo(); });
document.getElementById('btnRedo')?.addEventListener('click', () => { layer.select(null); ui.showSelbar(null); store.redo(); });
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.key.toLowerCase() !== 'z') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  layer.select(null); ui.showSelbar(null);
  if (e.shiftKey) store.redo(); else store.undo();
});
refreshHistoryButtons();

// recenter / re-frame the room
document.getElementById('btnRecenter')?.addEventListener('click', () => scene.resetView());
// eye-level walkthrough (cycles standpoints)
document.getElementById('btnWalk')?.addEventListener('click', () => {
  document.querySelectorAll('#viewSwitch button').forEach((x) => x.classList.toggle('active', x.dataset.view === '3d'));
  scene.walkthrough();
});

// manual wall hide/show (overrides the auto-hide)
document.getElementById('wallToggles')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-wall]'); if (!b) return;
  const on = b.classList.toggle('on');
  room.setWallHidden(b.dataset.wall, !on);
});

// nav mode: left-drag orbit vs pan (right-drag always pans; scroll zooms to cursor)
document.getElementById('navSwitch')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav]');
  if (!b) return;
  document.querySelectorAll('#navSwitch button').forEach((x) => x.classList.toggle('active', x === b));
  scene.setNavMode(b.dataset.nav);
});

// PHOTO MODE (her asks 2026-09-25: "realistic camera angles / heights", "not auto download but
// show a preview", "auto put the camera at eye level, the best level for shooting a kitchen").
// Photo moves the LIVE camera to a kitchen-photography standpoint (core/photoviews.js: eye level,
// wide lens, aimed at the run) so the shot is seen before it is saved. A bar steps through the
// five angles; orbit is left on so the shot can be tuned by hand; "Save this photo" renders
// exactly what is on screen at 3840x2560, "Save all five" renders the five standpoints into one
// zip; Done puts the view back. Signed-in only when cloud is configured: the photos are an
// account perk, and it puts a name to who is taking the kitchen away.
const PHOTO = { width: 3840, height: 2560, type: 'image/jpeg', quality: 0.94 };
let photoMode = null;                                 // { views, i, was: { pos, target, fov } }
const bytesOf = (url) => { const b64 = url.slice(url.indexOf(',') + 1), bin = atob(b64), data = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) data[k] = bin.charCodeAt(k); return data; };
const saveBlob = (name, blob) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
const photoFile = (v, i) => `PLINTH_kitchen_${i + 1}_${v.key}.jpg`;   // 1 = your view, 2-6 the suggested angles
document.getElementById('btnPhoto')?.addEventListener('click', async () => {
  if (photoMode) { photoAngle(photoMode.i + 1); return; }          // pressed again: next angle
  if (isCloud()) {
    let u = null;
    try { u = await currentUser(); } catch { /* offline: treated as signed out */ }
    if (!u) {
      if (cloudUI) cloudUI.openFor({ title: 'Sign in to save photos', sub: 'Photos of your kitchen come with a free PL/NTH account: sign in or create one, then press Photo again.' });
      else toast('Sign in to save photos of your kitchen.');
      return;
    }
  }
  if (!store.state.items.length) { toast('Nothing to photograph yet: add some cabinets first.'); return; }
  startPhotoMode();
});
function startPhotoMode() {
  if (scene.view !== '3d') { document.querySelector('#viewSwitch [data-view="3d"]')?.click(); }
  const cam = scene.persp;
  const was = { pos: cam.position.clone(), target: scene.controls.target.clone(), fov: cam.fov };
  // photo 1 is HER OWN VIEW, exactly as she left it (her catch 2026-09-25: "when I angle the camera
  // and click photo it removes my view"); the five suggested standpoints are one arrow away
  const mine = { key: 'your-view', name: 'Your view, as it is', pos: was.pos.toArray(), target: was.target.toArray(), fov: was.fov };
  photoMode = { views: [mine, ...photoViews(store.state.room, store.state.items)], i: 0, was };
  layer.select(null); ui.showSelbar(null); layer.setHover?.(null);
  room.setGridVisible(false);
  document.getElementById('emptyState')?.classList.add('hidden');
  document.getElementById('btnPhoto')?.classList.add('active');
  let bar = document.getElementById('photoBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'photoBar'; document.body.appendChild(bar); }
  bar.innerHTML = `<button type="button" class="pb-ghost" id="pbPrev" title="Previous angle (←)">‹</button>
    <span id="pbCap"></span>
    <button type="button" class="pb-ghost" id="pbNext" title="Next angle (→)">›</button>
    <button type="button" id="pbSave" title="Render what is on screen at ${PHOTO.width} × ${PHOTO.height} and save it">Save</button>
    <button type="button" class="pb-ghost" id="pbAll" title="Your view and the five suggested standpoints, rendered at ${PHOTO.width} × ${PHOTO.height}, in one zip">Save all</button>
    <button type="button" class="pb-ghost" id="pbDone">Done</button>`;
  bar.querySelector('#pbPrev').addEventListener('click', () => photoAngle(photoMode.i - 1));
  bar.querySelector('#pbNext').addEventListener('click', () => photoAngle(photoMode.i + 1));
  bar.querySelector('#pbSave').addEventListener('click', () => {
    const v = photoMode.views[photoMode.i];
    saveBlob(photoFile(v, photoMode.i), new Blob([bytesOf(scene.captureImage(PHOTO))], { type: 'image/jpeg' }));
    toast(`Saved ${photoFile(v, photoMode.i)} at ${PHOTO.width} × ${PHOTO.height}.`);
  });
  bar.querySelector('#pbAll').addEventListener('click', () => {
    const shots = scene.captureViews(photoMode.views, PHOTO);
    saveBlob('PLINTH_kitchen_photos.zip', new Blob([buildZip(shots.map((sh, i) => ({ name: photoFile(sh, i), data: bytesOf(sh.url) })))], { type: 'application/zip' }));
    toast(`${shots.length} photos saved in one zip.`);
  });
  bar.querySelector('#pbDone').addEventListener('click', endPhotoMode);
  document.addEventListener('keydown', photoKeys, true);
  photoAngle(0);
  toast('Photo 1 is your view as it is: Save it, or ‹ › for five suggested angles at eye level.');
}
function photoAngle(i) {
  if (!photoMode) return;
  const n = photoMode.views.length;
  photoMode.i = ((i % n) + n) % n;
  scene.lookFrom(photoMode.views[photoMode.i]);
  const cap = document.getElementById('pbCap');
  if (cap) cap.innerHTML = `<strong>Photo</strong> ${photoMode.i + 1} / ${n} · ${esc(photoMode.views[photoMode.i].name)}`;
}
function photoKeys(e) {
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
  if (e.key === 'Escape') { e.stopPropagation(); endPhotoMode(); }
  else if (e.key === 'ArrowRight') { e.stopPropagation(); photoAngle(photoMode.i + 1); }
  else if (e.key === 'ArrowLeft') { e.stopPropagation(); photoAngle(photoMode.i - 1); }
}
function endPhotoMode() {
  if (!photoMode) return;
  const { was } = photoMode;
  photoMode = null;
  document.removeEventListener('keydown', photoKeys, true);
  document.getElementById('photoBar')?.remove();
  document.getElementById('btnPhoto')?.classList.remove('active');
  room.setGridVisible(true);
  scene.lookFrom({ pos: was.pos.toArray(), target: was.target.toArray(), fov: was.fov });
}
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// view switcher: 3D / plan / elevations
document.getElementById('viewSwitch')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  document.querySelectorAll('#viewSwitch button').forEach((x) => x.classList.toggle('active', x === b));
  scene.setView(b.dataset.view);
});

// technical (architect's) floor plan overlay
const planOverlay = document.getElementById('planOverlay');
const planHost = document.getElementById('planHost');
const btnTechnical = document.getElementById('btnTechnical');
let planActive = false;
let underlay = null; // uploaded floorplan sketch (in memory)
function renderPlan() { planHost.innerHTML = buildFloorplanSVG(store.serialize(), underlay); }

// ----- floorplan underlay upload -----
const fp = (id) => document.getElementById(id);
fp('fpUpload')?.addEventListener('click', () => fp('fpFile').click());
fp('fpFile')?.addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      underlay = { src: ev.target.result, aspect: img.naturalWidth / img.naturalHeight, widthIn: store.state.room.width, opacity: 0.5, show: true };
      fp('fpControls').style.display = '';
      fp('fpWidth').value = fmtFeetIn(store.state.room.width);
      const sum = fp('sumFloorplan'); if (sum) sum.textContent = 'Sketch loaded';
      if (planActive) renderPlan();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});
fp('fpWidth')?.addEventListener('change', (e) => { if (!underlay) return; const v = parseLength(e.target.value); if (isFinite(v) && v > 0) { underlay.widthIn = v; if (planActive) renderPlan(); } });
fp('fpShow')?.addEventListener('change', (e) => { if (underlay) { underlay.show = e.target.checked; if (planActive) renderPlan(); } });
fp('fpOpacity')?.addEventListener('input', (e) => { if (underlay) { underlay.opacity = parseFloat(e.target.value); if (planActive) renderPlan(); } });
fp('fpRemove')?.addEventListener('click', () => { underlay = null; fp('fpControls').style.display = 'none'; const sum = fp('sumFloorplan'); if (sum) sum.textContent = 'None'; if (planActive) renderPlan(); });
function togglePlan(on) {
  planActive = on;
  planOverlay.classList.toggle('show', on);
  btnTechnical.classList.toggle('active', on);
  if (on) renderPlan();
}
btnTechnical?.addEventListener('click', () => togglePlan(!planActive));
document.getElementById('planClose')?.addEventListener('click', () => togglePlan(false));
// every recorded gate lead carries what the visitor was designing, so the
// notification email reads "$28,400 kitchen, 12550" instead of a bare address
setLeadContext(() => {
  const sum = summarizeState(store.state);
  return {
    design_value: Math.round(sum.subtotal || 0),
    cabinets: sum.totalCabs || 0,
    zip: store.state.customer.zip || null,
    mode: store.state.mode || 'home',
  };
});

// every plan take-away (print/PDF/SVG/DXF) sits behind the one-time email gate
const PLAN_GATE = {
  title: 'Get your floor plan.',
  sub: 'Leave your email and your drawings are ready right away.',
  cta: 'Continue',
};
document.getElementById('planPrint')?.addEventListener('click', async () => {
  if (!(await ensureEmailGate('plan-print', PLAN_GATE))) return;
  window.print();
});
// branded sheet → hidden-iframe print dialog (popup-free) → save as PDF
document.getElementById('planPDF')?.addEventListener('click', async () => {
  if (!(await ensureEmailGate('plan-pdf', PLAN_GATE))) return;
  openPrintWindow(buildPlanSheetHTML(store.serialize(), underlay));
});
document.getElementById('planExport')?.addEventListener('click', async () => {
  if (!(await ensureEmailGate('plan-svg', PLAN_GATE))) return;
  const blob = new Blob([buildFloorplanSVG(store.serialize())], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'PLINTH_floor_plan.svg';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
});
// the same plan as AutoCAD DXF (R12; every cabinet one movable block).
// Two variants (client-requested): full plan with walls, or cabinets only
// for dropping straight into their own drawing.
document.getElementById('planDXF')?.addEventListener('click', async () => {
  if (!(await ensureDxfEmail('plan-dxf'))) return;
  const variant = await uiChoice(
    'Every cabinet is a single movable block either way. "Cabinets only" leaves the room walls out so you can drop the blocks straight into your own drawing.',
    {
      title: 'Download DXF plan',
      options: [
        { label: 'Cabinets only', value: 'cabs' },
        { label: 'Walls + cabinets', value: 'walls' },
      ],
    });
  if (!variant) return;
  const dxfStr = buildPlanDXF(store.serialize(), { walls: variant === 'walls' });
  const blob = new Blob([dxfStr], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = variant === 'walls' ? 'PLINTH_floor_plan.dxf' : 'PLINTH_cabinets.dxf';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
});
// keep the drawing live while it's open
store.subscribe((s, c) => { if (planActive && !c.quiet) renderPlan(); });

// ----- branded quote / PDF -----
const quoteOverlay = document.getElementById('quoteOverlay');
const quoteHost = document.getElementById('quoteHost');
function toggleQuote(on) {
  quoteOverlay.classList.toggle('show', on);
  document.getElementById('btnQuote')?.classList.toggle('active', on);
  document.body.classList.toggle('printing-quote', on);
  if (on) {
    // hero render: page 1 opens with THEIR kitchen (clean capture, no grid)
    let hero = null;
    try {
      layer.select(null); ui.showSelbar(null);
      room.setGridVisible(false);
      hero = scene.captureImage(1.5);
      room.setGridVisible(true);
    } catch { room.setGridVisible(true); }
    quoteHost.innerHTML = buildQuoteHTML(store.serialize(), hero);
  }
}
document.getElementById('btnQuote')?.addEventListener('click', () => {
  if (!store.state.items.length) { uiAlert('Add some cabinets first, then your quote will have something to show.', { title: 'Nothing to quote yet' }); return; }
  toggleQuote(!quoteOverlay.classList.contains('show'));
});
document.getElementById('quoteClose')?.addEventListener('click', () => toggleQuote(false));
// browsing the quote on screen is free — taking it away as a PDF leaves an email
document.getElementById('quotePrint')?.addEventListener('click', async () => {
  if (!(await ensureEmailGate('quote-pdf', {
    title: 'Get your quote.',
    sub: 'Leave your email and your PDF quote is ready right away.',
    cta: 'Continue',
  }))) return;
  window.print();
});

// ----- Home / Trade mode -----
const tradeUI = document.getElementById('tradePanel') ? new TradeUI({
  store,
  // entering/leaving a unit design swaps the whole state — rebuild everything
  onDesignLoad: () => {
    layer.select(null); ui.showSelbar(null);       // nothing from the previous kitchen stays selected
    buildRoom(true); rebuildWorktop(); rebuildFillers(); rebuildCornice();
    layer.rebuildAll(); ui.refresh?.(); applyMode();
  },
  // "Enter the unit mix" lands on the page where the dimensions and floorplan go in
  onRoomFirst: () => ui.showRoomTab?.(['dropRoom', 'dropFloorplan', 'dropOpenings']),
  openAccount: () => { if (isCloud()) cloudUI.open(); },   // reuse the home sign-in modal
}) : null;
function applyMode() {
  const trade = store.state.mode === 'trade';
  document.body.classList.toggle('mode-trade', trade);
  document.querySelectorAll('#modeSwitch button').forEach((b) => b.classList.toggle('active', b.dataset.mode === store.state.mode));
  if (trade) {
    // the wizard's post-generate bar belongs to the 3D stage — never let it
    // float over the TRADE panel
    document.getElementById('wzResult')?.classList.remove('show');
    document.getElementById('wzFlash')?.classList.remove('show');
    document.body.classList.remove('wz-reviewing');
  }
  if (!trade) scene._onResize(); // canvas was hidden; re-fit
}
// The Project workspace is open: prices are the hook, not the gate (decided
// 17 Sep 2026). The email is asked for where it earns something: exports,
// share links, saving a project, and the quote request.
document.getElementById('modeSwitch')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  // While a unit is being laid out the REAL project sits in the design stash and
  // the live one is empty: the Project tab would show a blank first-run card (or a
  // stale list under the Designing bar, her screenshot 2026-09-18), and anything
  // entered there is thrown away on Done. So the tab asks to finish instead.
  const unit = tradeUI?.designingUnit();
  if (unit && b.dataset.mode === 'trade') {
    uiConfirm(`Unit ${unit} is open in 3D. Save this layout to the unit and go back to the project?`,
      { title: 'Finish the layout first', confirmLabel: 'Save and go back', cancelLabel: 'Keep designing' })
      .then((ok) => { if (ok) tradeUI.finishDesign(true); });
    return;
  }
  store.setMode(b.dataset.mode);
});
store.subscribe((s, c) => { if (c.type === 'mode' || c.type === 'load' || c.type === 'reset') applyMode(); });
applyMode();
// ?mode=trade → open straight into the TRADE workspace (used by plinthmade.com
// CTAs). The workspace shows immediately; the email gate sits over it, and
// bailing drops back to the homeowner side.
// ----- mobile notice: the planner is a desktop tool -----
// Small touch screens get one on-brand heads-up per session, shown BEFORE
// anything else opens (the wizard waits for it, so it is never a pop-up on
// a pop-up). Deliberately a notice, not a wall: entry stays open.
const mobileHold = (() => {
  const small = window.innerWidth < 900;
  const touch = (navigator.maxTouchPoints || 0) > 0;
  if (!(small && touch)) return Promise.resolve();
  try {
    if (sessionStorage.getItem('plnr-mobile-notice')) return Promise.resolve();
    sessionStorage.setItem('plnr-mobile-notice', '1');
  } catch (e) { /* private mode */ }
  // nothing else shows underneath the notice (welcome card / wizard wait)
  document.body.classList.add('notice-up');
  return uiAlert(
    'The PL/NNER is built for a laptop or desktop screen. You are welcome to look around here, but for laying out and pricing a kitchen, come back on a bigger screen.',
    { title: 'Best on a bigger screen', okLabel: 'Look around anyway' }
  ).then(() => document.body.classList.remove('notice-up'));
})();

// ?mode=project opens straight into Project mode. `trade` is the OLD word for the same
// thing (the mode was renamed Project in the UI long ago; the link still said trade, and it
// shows in the visitor's address bar). Both work forever: old links on the site, in emails
// and in people's bookmarks must never break. New links should say ?mode=project.
// NOTE the parameter is FUNCTIONAL: without it the planner opens in Kitchen mode.
if (['project', 'trade'].includes(new URLSearchParams(location.search).get('mode')) && !TSHARE) {
  store.setMode('trade');
}
void tradeUI;
document.getElementById('btnOrders')?.addEventListener('click', () => tradeUI?.showOrders());

// cloud accounts + save/load (only active when Supabase is configured)
const cloudUI = new CloudUI({
  store,
  onLoaded: () => { buildRoom(true); rebuildWorktop(); rebuildFillers(); applyMode(); },
  onSaved: (msg) => toast(msg),
});

// when cloud is on, Save/Open go to the account (file export is the offline fallback)
if (cloudUI && isCloud()) {
  // SAVE writes the open design in place (a never-saved design asks for a name); OPEN lists them
  document.getElementById('btnExport')?.addEventListener('click', (e) => { e.stopImmediatePropagation(); cloudUI.quickSave(); }, true);
  document.getElementById('btnImport')?.addEventListener('click', (e) => { e.stopImmediatePropagation(); cloudUI.open(); }, true);
}

// ----- "Keep this layout?" -----
// One quiet card per session for a visitor who is not signed in, timed by
// core/keepprompt.js: 5 ACTIVE minutes with a kitchen in the room, or a they-care
// moment (Start editing, an idea kept, a second re-roll) plus 2 more. Email only;
// the link is shown on the card (the planner cannot email customers yet). It
// replaces a toast that fired every 5 minutes on the clock and vanished in 7s.
const keepTracker = createKeepTracker();
{
  let asked = false;
  try { asked = sessionStorage.getItem('plnr-keep-asked') === '1'; } catch { /* private mode */ }
  if (asked) keepTracker.finish();
  let lastNote = 0;
  const note = () => { const t = Date.now(); if (t - lastNote > 1000) { lastNote = t; keepTracker.activity(); } };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, note, { passive: true, capture: true });
  const busy = () => !!document.querySelector('#wizard.show, #uiDialog.show, #cloudModal.show, #orderCheckModal.show, #dxfGate.show, #pickModal, #keepCard')
    || document.body.classList.contains('wz-reviewing') || planActive || quoteOverlay?.classList.contains('show');
  const cabinets = () => store.state.items.filter((it) => { const c = getCab(it.code); return c && c.placeable && !c.notSupplied; }).length;
  setInterval(() => {
    if (keepTracker.finished || !isCloud()) return;
    const ok = keepTracker.shouldShow({ cabinets: cabinets(), mode: store.state.mode, designing: !!tradeUI?.designingUnit(), signedIn: !!cloudUI?.user, busy: busy() });
    if (!ok) return;
    keepTracker.finish();
    try { sessionStorage.setItem('plnr-keep-asked', '1'); } catch { /* ignore */ }
    showKeepCard({ getLink: () => shortShareURL(store), onAccount: () => cloudUI.open() });
  }, 10e3);
}

// ----- compare tray: keep up to 3 generated ideas with live thumbnails -----
const ideas = [];
function renderIdeaTray() {
  let tray = document.getElementById('ideaTray');
  if (!tray) { tray = document.createElement('div'); tray.id = 'ideaTray'; document.body.appendChild(tray); }
  tray.style.display = ideas.length ? 'flex' : 'none';
  tray.innerHTML = `<span class="tray-label">Compare</span>` + ideas.map((idea, i) =>
    `<button class="idea-thumb" data-i="${i}" title="Open this idea"><img src="${idea.thumb}"><span>${idea.label}</span></button>`).join('');
  tray.querySelectorAll('.idea-thumb').forEach((b) => b.addEventListener('click', () => {
    const idea = ideas[Number(b.dataset.i)];
    store.replace(JSON.parse(JSON.stringify(idea.json)));
    buildRoom(true); rebuildWorktop(); rebuildFillers(); rebuildCornice(); layer.rebuildAll(); ui.refresh(); applyMode();
    toast('Idea restored. Carry on designing.');
  }));
}
function keepIdeaForCompare() {
  try {
    layer.select(null); ui.showSelbar(null);
    room.setGridVisible(false);
    const thumb = scene.captureImage(0.5);
    room.setGridVisible(true);
    ideas.unshift({ json: store.serialize(), thumb, label: fmtUSD(summarizeState(store.state).subtotal) });
    if (ideas.length > 3) ideas.pop();
    renderIdeaTray();
    toast(`Kept: ${ideas.length} of 3 ideas in your compare tray.`);
    keepTracker.signal('kept-idea');
  } catch { room.setGridVisible(true); }
}

// ----- read-only trade share link (?tshare=<token>) -----
if (TSHARE && tradeUI) {
  fetchSharedProject(TSHARE).then((data) => {
    if (data && typeof data === 'object') {
      tradeUI.enterApproval(data);
      toast('Shared project loaded. Read-only approval view.');
    } else {
      toast('This share link is invalid or has been revoked.');
    }
  }).catch(() => {
    toast('Could not load the shared project. Check your connection and reload.');
  });
}

// ----- order tracking link (?order=<token>) -----
// The token is the key (an order number alone is guessable, so it never is).
// The param STAYS in the address bar: people reload and bookmark a tracking page.
// A malformed token never reaches the network: the page says "Order not found".
if (ORDER && !TSHARE && tradeUI) tradeUI.showTracking(ORDER);

// ----- guided setup wizard -----
const wizard = new Wizard({
  store,
  controls,
  // "Start editing" clears any cabinet the sketch left selected, so the swap bar does not appear unasked
  onEdit: () => { layer.select(null); ui.showSelbar(null); keepTracker.signal('start-editing'); },
  // while a TRADE unit-design session is open, the wizard speaks to the pro
  tradeUnit: () => tradeUI?.designingUnit() || null,
  onCompare: keepIdeaForCompare,
  onBuilt: () => { buildRoom(true); rebuildWorktop(); rebuildFillers(); rebuildCornice(); layer.rebuildAll(); ui.refresh(); },
  // "Save this idea" → account save when signed-in-capable, else file export
  onSave: () => {
    if (cloudUI && isCloud()) cloudUI.open();
    else document.getElementById('btnExport')?.click();
  },
});
document.getElementById('wzOpen')?.addEventListener('click', () => wizard.open());
document.getElementById('wzTopOpen')?.addEventListener('click', () => wizard.open());
document.getElementById('wzAgain')?.addEventListener('click', () => { keepTracker.signal('reroll'); if (wizard.lastShape) wizard.regenerate(); else wizard.open(); });
// first-time visitor (nothing restored, empty room) → open the guided wizard
// (skipped when the site's trade CTAs land here with ?mode=trade — pros go
// straight to the TRADE workspace, not the homeowner drawing board)
if (!TSHARE && !BOOK && !SHORT && !ORDER && new URLSearchParams(location.search).get('reset') !== '1' && !fromHash && !fromSave && store.state.items.length === 0 && store.state.mode !== 'trade') {
  mobileHold.then(() => setTimeout(() => wizard.open(), 400));
}

// ----- share + lead-capture -----
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
const SHARE_GATE = {
  title: 'Get your share link.',
  sub: 'Leave your email and your link is ready to copy.',
  cta: 'Continue',
};
// the Kitchen panel's one action: this layout becomes a unit type on the project
document.getElementById('btnToProject')?.addEventListener('click', () => {
  const placed = store.state.items.filter((it) => { const c = getCab(it.code); return c && c.placeable; }).length;
  if (!placed) { toast('Add some cabinets first, then add the kitchen to the project.'); return; }
  if (tradeUI._stash) { tradeUI.finishDesign(true); }        // inside a unit-design session: same as Done
  else { tradeUI.addCurrentAsUnit(); store.setMode('trade'); }
});
document.getElementById('btnShare')?.addEventListener('click', async () => {
  if (!(await ensureEmailGate('share-link', SHARE_GATE))) return;
  const url = await shortShareURL(store);   // ?s=code, or the self-contained #k= link when the server is out of reach
  try { await navigator.clipboard.writeText(url); toast('Share link copied. Paste it anywhere.'); }
  catch { prompt('Copy your share link:', url); }
});
document.getElementById('btnEmailMe')?.addEventListener('click', async () => {
  if (!(await ensureEmailGate('share-email', SHARE_GATE))) return;
  const url = await shortShareURL(store);   // ?s=code, or the self-contained #k= link when the server is out of reach
  const to = store.state.customer.email || '';
  const subject = 'PL/NTH kitchen layout';
  const body = `Here's the kitchen layout. Open this link to pick up where I left off:\n\n${url}\n\nLaid out in the PL/NNER, the PL/NTH planner`;
  window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});
// "Book a free order check" → an in-planner popup: submit the design and an
// Order Advisor follows up. Falls back to email when the cloud is off or the
// submit fails (BOOKING_URL kept in config for a future scheduling link).
const bookBtn = document.getElementById('btnBook');
const ocModal = document.getElementById('orderCheckModal');
if (bookBtn && ocModal) {
  const ocMsg = (t, ok) => { const el = document.getElementById('ocMsg'); el.textContent = t; el.className = 'cloud-msg' + (ok ? ' ok' : t ? ' err' : ''); };
  // never a bare location.href=mailto — invisible no-op without a mail app
  const mailtoFallback = () => {
    ocModal.classList.remove('show');
    mailFallback({
      title: 'Book your Order Advisor call by email',
      sub: 'The request could not reach PL/NTH directly. Nothing is lost. Copy the message below, or open it in your email app.',
      subject: 'Book a free Order Advisor call',
      body: 'Hi PL/NTH, please give this kitchen layout a once-over.\n\nLayout link:\n' + buildShareURL(store),
    });
  };
  bookBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!isCloud()) { mailtoFallback(); return; }
    document.getElementById('ocName').value = store.state.customer.name || '';
    document.getElementById('ocEmail').value = store.state.customer.email || capturedEmail();
    ocMsg('');
    document.getElementById('ocSubmit').disabled = false;
    ocModal.classList.add('show');
  });
  document.getElementById('ocClose').addEventListener('click', () => ocModal.classList.remove('show'));
  ocModal.addEventListener('click', (e) => { if (e.target === ocModal) ocModal.classList.remove('show'); });
  // ?book=1 → the site's "Book a free Order Advisor call" links land straight
  // in this flow (concierge booking — no external scheduler). The hint is
  // consumed from the URL so a reload doesn't re-open the modal.
  if (BOOK && store.state.mode !== 'trade') {
    setTimeout(() => bookBtn.click(), 600);
    const url = new URL(location.href); url.searchParams.delete('book');
    history.replaceState(null, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash);
  }
  document.getElementById('ocForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('ocSubmit');
    btn.disabled = true; ocMsg('Sending…', true);
    try {
      const sum = summarizeState(store.state);
      const callTimes = document.getElementById('ocTimes')?.value.trim() || '';
      const phone = document.getElementById('ocPhone')?.value.trim() || '';
      // phone + call times ride in BOTH the structured columns and the note —
      // the note is what an older deployed notify-email formatter prints, so
      // the details reach the inbox even before the fn redeploy lands
      const note = [document.getElementById('ocNote').value.trim(),
        phone ? `Phone: ${phone}` : '',
        callTimes ? `Best times to call: ${callTimes}` : ''].filter(Boolean).join(' · ');
      await requestOrderCheck({
        name: document.getElementById('ocName').value.trim(),
        email: document.getElementById('ocEmail').value.trim(),
        note,
        callTimes,
        phone,
        design: store.serialize(),
        cabinets: sum.totalCabs,
        subtotal: sum.subtotal,
      });
      ocMsg(callTimes
        ? 'Layout received. We will call in one of your windows, or reply by email. ✓'
        : 'Layout received. We will reply by email. ✓', true);
    } catch (err) {
      btn.disabled = false;
      ocMsg((err?.message || 'Could not send') + ', opening email instead…');
      setTimeout(mailtoFallback, 1200);
    }
  });
}

// expose a tiny mount API so the planner can drop onto a page if desired —
// loadState is the same rebuild sequence the compare tray uses, and is what
// the headless visual-check harnesses drive.
// ?s=code: open a very short share link. Same rules as a #k= link: it replaces the
// visible design, never the trade project in this browser, and the code is
// stripped from the address afterwards so a reload boots from the autosave.
if (SHORT && !TSHARE) {
  fetchShortDesign(SHORT).then((data) => {
    const ok = data && store.replace(data, { preserveTrade: true });
    if (ok) {
      buildRoom(true); rebuildWorktop(); rebuildFillers(); rebuildCornice(); layer.rebuildAll(); ui.refresh(); applyMode();
      toast('Shared kitchen opened.');
    } else {
      uiAlert('That share link could not be opened. It may have been mistyped, or you may be offline. Ask for the link again, or try once you are back online.', { title: 'Link not found', okLabel: 'OK' })
        .then(() => { if (!fromSave && store.state.items.length === 0 && store.state.mode !== 'trade') wizard.open(); });
    }
    try {
      const q = new URLSearchParams(location.search); q.delete('s');
      const rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    } catch { /* ignore */ }
  });
}

// ?reset=1 — forget this browser's planner data and start like a first-time
// visitor (her testing shortcut). It ASKS first: a link that silently wiped a
// customer's kitchen would be a trap. Clears the autosave, the unit-design stash,
// the gate email and the once-only flags. It does NOT sign anyone out, and
// nothing saved to an account or shared by link is touched.
if (new URLSearchParams(location.search).get('reset') === '1') {
  const clean = () => { try { const q = new URLSearchParams(location.search); q.delete('reset'); const rest = q.toString(); return location.pathname + (rest ? `?${rest}` : ''); } catch { return location.pathname; } };
  uiConfirm('Forget everything this browser has saved for the planner? The kitchen, the project, and the email you gave are cleared, and the planner opens as it does for a first-time visitor. Anything saved to your PL/NTH account or shared by link is not touched, and you stay signed in.',
    { title: 'Start fresh?', confirmLabel: 'Forget and restart', cancelLabel: 'Keep my work', danger: true })
    .then((ok) => {
      if (!ok) { try { history.replaceState(null, '', clean() + location.hash); } catch { /* ignore */ } return; }
      // stop the debounced autosave writing the old state back before the reload
      try { Storage.prototype.setItem = function noop() {}; } catch { /* ignore */ }
      for (const k of ['plinth-planner-v1', 'plnr-trade-stash', 'plinthDxfEmail', 'plnnerTourSeen']) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
      for (const k of ['plnr-mobile-notice', 'plnr-keep-asked']) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } }
      location.replace(clean());
    });
}

window.PlinthPlanner = {
  store, scene, room, controls,
  photoMode: { start: startPhotoMode, angle: photoAngle, end: endPhotoMode },   // photo mode without the sign-in gate (checks)
  loadState(json) {
    store.replace(JSON.parse(JSON.stringify(json)));
    buildRoom(true); rebuildWorktop(); rebuildFillers(); rebuildCornice(); layer.rebuildAll(); ui.refresh(); applyMode();
  },
};
