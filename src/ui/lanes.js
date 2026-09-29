// lanes.js — NOTHING FLOATS ON TOP OF ANYTHING ELSE (her rule, 2026-09-29: "make a rule that any
// button or panel never sits over the top of another").
//
// The bars and cards that float over the top of the stage come and go independently (design banner,
// photo bar, selection bar, keep card, idea tray) and wrap to two or three rows in a narrow window, so
// fixed pixel tops cannot keep them apart. keepLanes() lays them out top down in that order: each one
// starts at its own CSS top and, while it touches one placed before it, drops to 8px under it.
// A keep card or idea tray with no room steps aside until there is; the view toolbar steps aside while
// a bar reaches down onto it (as it already does under the draft result bar). Re-run on any resize, on
// a bar coming or going, and on a bar changing size (it wrapped).
// test/ui-overlap.mjs checks the result at five window sizes.

const TOP_LANE = ['designBanner', 'photoBar', 'selbar', 'keepCard', 'ideaTray'];
const OPTIONAL = new Set(['keepCard', 'ideaTray']);     // step aside (hidden) while there is no room for them
const GAP = 8;

// laid out at all (our own step-aside is visibility: hidden, so a card set aside is still measured)
function laidOut(el) { return !!el && el.isConnected && getComputedStyle(el).display !== 'none'; }
const hits = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

// classes change only when the answer does: the observers below watch them, so toggling back and forth
// on every pass would re-run this every frame
export function keepLanes() {
  const panels = ['leftPanel', 'rightPanel'].map((id) => document.getElementById(id)).filter(laidOut).map((el) => el.getBoundingClientRect());
  const vcEl = document.getElementById('viewControls');
  const vc = laidOut(vcEl) ? vcEl.getBoundingClientRect() : null;
  const placed = [];
  let vcAside = false;
  for (const id of TOP_LANE) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.style.top) el.style.top = '';                  // back to its CSS top, then step down if it must
    if (!laidOut(el)) continue;
    let r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    for (let guard = 0; guard < TOP_LANE.length; guard++) {
      const hit = placed.find((p) => hits(r, p));
      if (!hit) break;
      el.style.top = `${Math.round(parseFloat(el.style.top || getComputedStyle(el).top) + hit.bottom + GAP - r.top)}px`;
      r = el.getBoundingClientRect();
    }
    if (OPTIONAL.has(id)) {
      const aside = r.bottom > innerHeight || panels.some((p) => hits(r, p)) || placed.some((p) => hits(r, p)) || !!(vc && hits(r, vc));
      if (el.classList.contains('lane-aside') !== aside) el.classList.toggle('lane-aside', aside);
      if (aside) continue;
    } else if (vc && hits(r, vc)) vcAside = true;            // a bar you need wins over the view toolbar
    placed.push(r);
  }
  if (document.body.classList.contains('lane-vc-aside') !== vcAside) document.body.classList.toggle('lane-vc-aside', vcAside);
}

export function watchLanes() {
  let queued = false;
  const run = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; keepLanes(); }); };
  const sizes = new ResizeObserver(run);
  const seen = new WeakSet();
  const track = () => {
    for (const id of TOP_LANE) {
      const el = document.getElementById(id);
      if (el && !seen.has(el)) { seen.add(el); sizes.observe(el); }
    }
  };
  // bars are appended to / removed from <body>, and shown by class or inline display
  new MutationObserver(() => { track(); run(); }).observe(document.body, { childList: true });
  const attrs = new MutationObserver(run);
  for (const id of TOP_LANE) { const el = document.getElementById(id); if (el) attrs.observe(el, { attributes: true, attributeFilter: ['class'] }); }
  new MutationObserver(run).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', run);
  track(); run();
}
