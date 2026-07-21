// main.js — bootstrap: build the scene, sync the store, wire the UI.

import { Store } from './core/store.js';
import { getCab, getFinish, fmtUSD } from './core/catalogue.js';
import { summarizeState } from './core/cost.js';
import { computeFillers } from './core/fillers.js';
import { planWallInfill } from './core/templates.js';
import { parseLength, fmtFeetIn } from './core/units.js';
import { autosave, loadSaved, loadFromHash, buildShareURL } from './core/persistence.js';
import { Scene } from './scene/Scene.js';
import { Room } from './scene/Room.js';
import { Worktop } from './models/worktop.js';
import { FillerLayer } from './models/filler.js';
import { CorniceLayer } from './models/cornice.js';
import { DecorLayer } from './models/decor.js';
import { CabinetLayer } from './interaction/cabinets.js';
import { PointerControls } from './interaction/controls.js';
import { UI } from './ui/ui.js';
import { buildFloorplanSVG, buildPlanSheetHTML } from './ui/floorplan.js';
import { buildPlanDXF } from './core/dxf.js';
import { ensureDxfEmail } from './ui/dxfgate.js';
import { uiAlert } from './ui/dialog.js';
import { buildQuoteHTML } from './ui/quote.js';
import { openPrintWindow } from './ui/submittal.js';
import { TradeUI } from './ui/trade.js';
import { CloudUI } from './ui/cloudUI.js';
import { Wizard } from './ui/wizard.js';
import { isCloud, requestOrderCheck } from './core/cloud.js';
import { fetchSharedProject } from './core/tradecloud.js';

// Build stamp — bump on each change so you can confirm the browser is running
// the latest code (shown in the top bar + logged to the console). If this
// doesn't update after a hard refresh, the browser is serving cached JS.
const BUILD = 'W2W-68 · 35mm top rails everywhere + knob pairs on 36in drawers + bin knob fix';
console.log('%cPL/NNER build: ' + BUILD, 'color:#8a7', 'font-weight:bold');
{ const t = document.getElementById('buildTag'); if (t) { t.textContent = BUILD.split(' · ')[0]; t.title = BUILD; } }

const store = new Store();
// ?tshare=<token> → read-only trade approval view (never autosaved, so a
// shared project can't clobber the viewer's own local work)
const TSHARE = new URLSearchParams(location.search).get('tshare');
// a shared design in the URL takes priority over the last local session
const fromHash = loadFromHash(store);
const fromSave = fromHash ? false : loadSaved(store);
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

// keep the worktop + fillers + cornice reflowed whenever the layout changes
store.subscribe((s, c) => {
  if (c.quiet) return;
  if (['add', 'remove', 'update', 'swap', 'load', 'reset', 'finish'].includes(c.type)) { rebuildWorktop(); rebuildFillers(); rebuildCornice(); }
  else if (c.type === 'room') { rebuildCornice(); } // cornice profile / wall changes
});

const ui = new UI({
  store,
  controls: null, // set below
  onRoomChange: (reframe = false) => { buildRoom(reframe); rebuildWorktop(); rebuildFillers(); rebuildCornice(); },
});

// click-a-wall popup → add a window / door / doorway right where you clicked
const wallMenu = document.getElementById('wallMenu');
let wallTarget = null;
function hideWallMenu() { if (wallMenu) wallMenu.style.display = 'none'; wallTarget = null; }
function showWallMenu(info) {
  if (!wallMenu) return;
  if (!info) { hideWallMenu(); return; }
  const { wall, pos, clientX, clientY } = info;
  wallTarget = { wall, pos };
  wallMenu.style.display = 'block';
  const pad = 8, mw = wallMenu.offsetWidth || 150, mh = wallMenu.offsetHeight || 120;
  wallMenu.style.left = Math.min(clientX + 6, window.innerWidth - mw - pad) + 'px';
  wallMenu.style.top = Math.min(clientY + 6, window.innerHeight - mh - pad) + 'px';
}
wallMenu?.addEventListener('click', (e) => {
  if (!wallTarget) return;
  const fillBtn = e.target.closest('[data-fill]');
  if (fillBtn) { fillThisWall(wallTarget.wall); hideWallMenu(); return; }
  const b = e.target.closest('[data-op]'); if (!b) return;
  store.addOpening({ type: b.dataset.op, wall: wallTarget.wall, pos: wallTarget.pos });
  buildRoom(false); hideWallMenu();
});

// Fill the clicked wall: find EVERY free gap along it — between cabinets and
// at both ends — and pack each one with base units (doors stay clear; gaps
// under 20" are left for the scribe fillers).
function fillThisWall(clickWall) {
  const placements = planWallInfill(store.state, clickWall);
  for (const p of placements) store.addItem(p.code, { x: p.x, z: p.z, rotDeg: p.rotDeg });
  rebuildWorktop(); rebuildFillers(); rebuildCornice(); ui.refresh();
}
window.addEventListener('pointerdown', (e) => { if (wallMenu && !wallMenu.contains(e.target) && !e.target.closest('canvas')) hideWallMenu(); });

// click a placed window/door/doorway → edit its position / width, or delete it
const openingMenu = document.getElementById('openingMenu');
let openingTarget = null;
function hideOpeningMenu() { if (openingMenu) openingMenu.style.display = 'none'; openingTarget = null; }
function showOpeningMenu({ id, clientX, clientY }) {
  const o = (store.state.room.openings || []).find((x) => x.id === id);
  if (!o || !openingMenu) return;
  openingTarget = id;
  const r = store.state.room;
  const len = (o.wall === 'left' || o.wall === 'right') ? r.depth : r.width;
  const w = o.width || (o.type === 'window' ? 48 : 34);
  const dist = Math.max(0, (o.pos ?? 0.5) * len - w / 2);   // near-edge, like the wizard
  document.getElementById('omTitle').textContent = o.type === 'doorway' ? 'Doorway' : o.type === 'door' ? 'Door' : 'Window';
  document.getElementById('omDistLabel').textContent = (o.wall === 'left' || o.wall === 'right') ? 'Back wall → edge' : 'Left wall → edge';
  document.getElementById('omDist').value = fmtFeetIn(dist);
  document.getElementById('omWidth').value = fmtFeetIn(w);
  openingMenu.style.display = 'block';
  const pad = 8, mw = openingMenu.offsetWidth || 190, mh = openingMenu.offsetHeight || 130;
  openingMenu.style.left = Math.min(clientX + 6, window.innerWidth - mw - pad) + 'px';
  openingMenu.style.top = Math.min(clientY + 6, window.innerHeight - mh - pad) + 'px';
}
function applyOpeningEdit() {
  const o = (store.state.room.openings || []).find((x) => x.id === openingTarget);
  if (!o) return;
  const r = store.state.room;
  const len = (o.wall === 'left' || o.wall === 'right') ? r.depth : r.width;
  const parseIn = (el, fallback) => {
    let v = parseLength(String(el.value || '').trim());
    if (!isFinite(v) || v <= 0) return fallback;
    return v < 8 ? v * 12 : v;              // bare small numbers read as feet (wizard convention)
  };
  const curW = o.width || (o.type === 'window' ? 48 : 34);
  const width = Math.min(len - 4, Math.max(12, parseIn(document.getElementById('omWidth'), curW)));
  const dist = Math.min(len - width, Math.max(0, parseIn(document.getElementById('omDist'), (o.pos ?? 0.5) * len - width / 2)));
  const pos = Math.max(0.02, Math.min(0.98, (dist + width / 2) / len));
  store.updateOpening(o.id, { pos, width });
  buildRoom(false);
  rebuildWorktop(); rebuildFillers();       // runs route around doors — keep them honest
}
document.getElementById('omDist')?.addEventListener('change', applyOpeningEdit);
document.getElementById('omWidth')?.addEventListener('change', applyOpeningEdit);
document.getElementById('omDelete')?.addEventListener('click', () => {
  if (openingTarget == null) return;
  store.removeOpening(openingTarget);
  buildRoom(false); rebuildWorktop(); rebuildFillers();
  hideOpeningMenu();
});
window.addEventListener('pointerdown', (e) => { if (openingMenu && !openingMenu.contains(e.target) && !e.target.closest('canvas')) hideOpeningMenu(); });

const controls = new PointerControls({
  scene,
  cabinetLayer: layer,
  room,
  store,
  onCommit: rebuildWorktop,
  onSelect: (id) => ui.showSelbar(id),
  onWallClick: (info) => showWallMenu(info),
  onOpeningClick: (info) => { hideWallMenu(); showOpeningMenu(info); },
});
ui.controls = controls; // late-bind so UI buttons can drive the controls

// per-frame: grounding guard + auto-hide the walls between camera and room
scene.onBeforeRender(() => {
  layer.groundTick();
  room.updateWallVisibility(scene.camera.position, scene.view);
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

// photo mode: clean the view, render at high-res, download a PNG for the website
document.getElementById('btnPhoto')?.addEventListener('click', () => {
  layer.select(null); ui.showSelbar(null);
  room.setGridVisible(false);
  document.getElementById('emptyState')?.classList.add('hidden');
  // let the deselect/grid changes apply, then capture next frame
  requestAnimationFrame(() => {
    const url = scene.captureImage(3);
    room.setGridVisible(true);
    const a = document.createElement('a');
    a.href = url; a.download = 'PLINTH_kitchen.png';
    document.body.appendChild(a); a.click(); a.remove();
  });
});

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
document.getElementById('planPrint')?.addEventListener('click', () => window.print());
// branded sheet → hidden-iframe print dialog (popup-free) → save as PDF
document.getElementById('planPDF')?.addEventListener('click', () => {
  openPrintWindow(buildPlanSheetHTML(store.serialize(), underlay));
});
document.getElementById('planExport')?.addEventListener('click', () => {
  const blob = new Blob([buildFloorplanSVG(store.serialize())], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'PLINTH_floor_plan.svg';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
});
// the same plan as AutoCAD DXF (R12: walls, footprints, code labels)
document.getElementById('planDXF')?.addEventListener('click', async () => {
  if (!(await ensureDxfEmail('plan-dxf'))) return;
  const blob = new Blob([buildPlanDXF(store.serialize())], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'PLINTH_floor_plan.dxf';
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
  if (!store.state.items.length) { uiAlert('Add some cabinets first — then your quote will have something to show.', { title: 'Nothing to quote yet' }); return; }
  toggleQuote(!quoteOverlay.classList.contains('show'));
});
document.getElementById('quoteClose')?.addEventListener('click', () => toggleQuote(false));
document.getElementById('quotePrint')?.addEventListener('click', () => window.print());

// ----- Home / Trade mode -----
const tradeUI = document.getElementById('tradePanel') ? new TradeUI({
  store,
  // entering/leaving a unit design swaps the whole state — rebuild everything
  onDesignLoad: () => {
    buildRoom(true); rebuildWorktop(); rebuildFillers(); rebuildCornice();
    layer.rebuildAll(); ui.refresh?.(); applyMode();
  },
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
document.getElementById('modeSwitch')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  store.setMode(b.dataset.mode);
});
store.subscribe((s, c) => { if (c.type === 'mode' || c.type === 'load' || c.type === 'reset') applyMode(); });
applyMode();
// ?mode=trade → open straight into the TRADE workspace (used by plinthmade.com CTAs)
if (new URLSearchParams(location.search).get('mode') === 'trade') store.setMode('trade');
void tradeUI;

// cloud accounts + save/load (only active when Supabase is configured)
const cloudUI = new CloudUI({
  store,
  onLoaded: () => { buildRoom(true); rebuildWorktop(); rebuildFillers(); applyMode(); },
});

// when cloud is on, Save/Open go to the account (file export is the offline fallback)
if (cloudUI && isCloud()) {
  ['btnExport', 'btnImport'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      e.stopImmediatePropagation();   // preempt the file export/import handler
      cloudUI.open();
    }, true);
  });
}

// gentle reminder to sign in + save after 5 minutes of unsaved work
// (home voice only — never in TRADE, and never mid unit-design session,
// where saving goes through the unit's Done banner / trade project save)
setInterval(() => {
  if (store.state.mode === 'trade' || tradeUI?.designingUnit()) return;
  if (isCloud() && !cloudUI.user && store.state.items.length > 0) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = 'Don’t lose your kitchen — <strong>sign in to save it.</strong>';
    t.style.cursor = 'pointer';
    t.addEventListener('click', () => { cloudUI.open(); t.remove(); });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 7000);
  }
}, 5 * 60 * 1000);

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
    toast('Idea restored — carry on designing.');
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
    toast(`Kept — ${ideas.length} of 3 ideas in your compare tray.`);
  } catch { room.setGridVisible(true); }
}

// ----- read-only trade share link (?tshare=<token>) -----
if (TSHARE && tradeUI) {
  fetchSharedProject(TSHARE).then((data) => {
    if (data && typeof data === 'object') {
      tradeUI.enterApproval(data);
      toast('Shared project loaded — read-only approval view.');
    } else {
      toast('This share link is invalid or has been revoked.');
    }
  }).catch(() => {
    toast('Could not load the shared project — check your connection and reload.');
  });
}

// ----- guided setup wizard -----
const wizard = new Wizard({
  store,
  controls,
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
document.getElementById('wzAgain')?.addEventListener('click', () => { if (wizard.lastShape) wizard.regenerate(); else wizard.open(); });
// first-time visitor (nothing restored, empty room) → open the guided wizard
// (skipped when the site's trade CTAs land here with ?mode=trade — pros go
// straight to the TRADE workspace, not the homeowner drawing board)
if (!TSHARE && !fromHash && !fromSave && store.state.items.length === 0 && store.state.mode !== 'trade') {
  setTimeout(() => wizard.open(), 400);
}

// ----- share + lead-capture -----
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
document.getElementById('btnShare')?.addEventListener('click', async () => {
  const url = buildShareURL(store);
  try { await navigator.clipboard.writeText(url); toast('Share link copied — paste it anywhere.'); }
  catch { prompt('Copy your share link:', url); }
});
document.getElementById('btnEmailMe')?.addEventListener('click', () => {
  const url = buildShareURL(store);
  const to = store.state.customer.email || '';
  const subject = 'My PL/NTH kitchen design';
  const body = `Here's my kitchen design — open this link to pick up where I left off:\n\n${url}\n\n— Designed in PL/NNER, the PL/NTH kitchen planner`;
  window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});
// "Book a free order check" → an in-planner popup: submit the design and an
// Order Advisor follows up. Falls back to email when the cloud is off or the
// submit fails (BOOKING_URL kept in config for a future scheduling link).
const bookBtn = document.getElementById('btnBook');
const ocModal = document.getElementById('orderCheckModal');
if (bookBtn && ocModal) {
  const ocMsg = (t, ok) => { const el = document.getElementById('ocMsg'); el.textContent = t; el.className = 'cloud-msg' + (ok ? ' ok' : t ? ' err' : ''); };
  const mailtoFallback = () => {
    location.href = 'mailto:imogen@plinthmade.com?subject=' + encodeURIComponent('Book a free order check') +
      '&body=' + encodeURIComponent('Hi PL/NTH — please give my kitchen design a once-over.\n\nMy design link:\n' + buildShareURL(store));
  };
  bookBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!isCloud()) { mailtoFallback(); return; }
    document.getElementById('ocName').value = store.state.customer.name || '';
    document.getElementById('ocEmail').value = store.state.customer.email || '';
    ocMsg('');
    document.getElementById('ocSubmit').disabled = false;
    ocModal.classList.add('show');
  });
  document.getElementById('ocClose').addEventListener('click', () => ocModal.classList.remove('show'));
  ocModal.addEventListener('click', (e) => { if (e.target === ocModal) ocModal.classList.remove('show'); });
  document.getElementById('ocForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('ocSubmit');
    btn.disabled = true; ocMsg('Sending…', true);
    try {
      const sum = summarizeState(store.state);
      await requestOrderCheck({
        name: document.getElementById('ocName').value.trim(),
        email: document.getElementById('ocEmail').value.trim(),
        note: document.getElementById('ocNote').value.trim(),
        design: store.serialize(),
        cabinets: sum.totalCabs,
        subtotal: sum.subtotal,
      });
      ocMsg('Design received — an Order Advisor will be in touch. ✓', true);
    } catch (err) {
      btn.disabled = false;
      ocMsg((err?.message || 'Could not send') + ' — opening email instead…');
      setTimeout(mailtoFallback, 1200);
    }
  });
}

// expose a tiny mount API so the planner can drop onto a page if desired —
// loadState is the same rebuild sequence the compare tray uses, and is what
// the headless visual-check harnesses drive.
window.PlinthPlanner = {
  store, scene, room, controls,
  loadState(json) {
    store.replace(JSON.parse(JSON.stringify(json)));
    buildRoom(true); rebuildWorktop(); rebuildFillers(); rebuildCornice(); layer.rebuildAll(); ui.refresh(); applyMode();
  },
};
