// track.js — who is looking, and how far they got (W2W-261).
//
// Three things, all best effort (nothing here may ever break or slow the planner):
// 1. EVENTS. track('estimate_download') goes to Google Analytics as an event and
//    to HubSpot as a page view of /planner/estimate-download, so a known
//    contact's HubSpot timeline reads as the steps they took.
// 2. WHO. identify(email) ties this browser's HubSpot history to the contact the
//    moment an email is left at any gate (HubSpot's own cookie covers
//    plinthmade.com and the planner, so a site visit joins up too).
// 3. LINKS. A link sent to one company carries a short code:
//    planner.plinthmade.com/?mode=project&ref=ny61. The code is remembered, rides
//    on every event and lead from that browser, and its first opening in a
//    session is posted to PL/NTH (contact_messages, which emails her). The code
//    is opaque: which company holds it lives only in the leads workbook, never
//    in this public code or in a URL.
// 4. PEOPLE, NOT SCANNERS (W2W-268). Company mail security (Defender Safe Links,
//    Mimecast, Proofpoint) opens every link in a hidden browser within a minute of
//    the email landing, and that ran the planner like a visit: three "opened"
//    emails in a row came 1 to 2 minutes after sending. An opening now counts
//    only once a person touches the page (a click, a tap, a key or a scroll wheel),
//    and never from a browser that says it is automated. The code is still
//    remembered at once, so a lead from that browser carries it either way.

import { SUPABASE_URL, SUPABASE_ANON_KEY, cloudEnabled } from '../core/config.js';

const REF_KEY = 'plnr-ref', SEEN_KEY = 'plnr-ref-seen';

/** A link code is 2 to 24 letters, digits or hyphens. Anything else is ignored. */
export function cleanRef(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,23}$/.test(s) ? s : '';
}

export function refFromSearch(search) {
  try { return cleanRef(new URLSearchParams(search || '').get('ref')); } catch { return ''; }
}

/** The link code this browser arrived with ('' if none). */
export function leadRef() {
  try { return cleanRef(sessionStorage.getItem(REF_KEY) || localStorage.getItem(REF_KEY)); } catch { return ''; }
}

/** A lead's source with the link code on the end: "estimate:62u/588c/... ref:ny61". */
export function withRef(source, ref = leadRef()) {
  const s = String(source || '');
  return ref ? `${s} ref:${ref}`.slice(0, 240) : s;
}

const pathFor = (name) => '/planner/' + String(name).replace(/[^a-z0-9]+/gi, '-').toLowerCase();

export function track(name, params = {}) {
  if (typeof window === 'undefined') return;
  const ref = leadRef();
  const p = ref ? { ...params, ref } : params;
  try { if (typeof window.gtag === 'function') window.gtag('event', name, p); } catch { /* never breaks the planner */ }
  try {
    const q = (window._hsq = window._hsq || []);
    q.push(['setPath', pathFor(name) + (ref ? `?ref=${ref}` : '')]);
    q.push(['trackPageView']);
  } catch { /* never breaks the planner */ }
}

export function identify(email) {
  if (typeof window === 'undefined' || !email) return;
  try {
    const q = (window._hsq = window._hsq || []);
    q.push(['identify', { email: String(email).trim() }]);
    q.push(['trackPageView']);
  } catch { /* never breaks the planner */ }
}

async function postLinkOpened(ref, view) {
  // live planner only: a local or test run must never report a link as opened
  if (!cloudEnabled() || window.location.hostname !== 'planner.plinthmade.com') return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/contact_messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify({
        name: `Link ${ref}`, email: 'projects@plinthmade.com', person_type: 'Tracked link',
        message: `The link with code ${ref} was opened in the PL/NNER (${view} view).`, page: 'planner',
      }),
    });
  } catch { /* offline: the visit still shows in analytics */ }
}

/** The things only a person does to a page. A scanner loads and renders; it does not click or type. */
export const HUMAN_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

/** True for a browser that announces itself as automated (headless Chrome, a mail scanner, a crawler). */
export function looksAutomated(nav) {
  if (!nav) return true;
  if (nav.webdriver) return true;
  const ua = String(nav.userAgent || '');
  return /HeadlessChrome|PhantomJS|bot\b|crawler|spider|Mimecast|Barracuda|Proofpoint|SafeLinks|Safe Links|BingPreview/i.test(ua);
}

/** Run fn once, on the first sign of a person on the page. */
function onFirstHuman(fn) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    HUMAN_EVENTS.forEach((e) => window.removeEventListener(e, go, true));
    fn();
  };
  HUMAN_EVENTS.forEach((e) => window.addEventListener(e, go, { capture: true, passive: true }));
}

/** Call once at boot. Reads ?ref=, remembers it, and reports its first opening per session by a person. */
export function initTracking({ view = 'Kitchen' } = {}) {
  if (typeof window === 'undefined') return '';
  const ref = refFromSearch(window.location.search);
  if (!ref) return leadRef();
  try { sessionStorage.setItem(REF_KEY, ref); localStorage.setItem(REF_KEY, ref); } catch { /* private mode */ }
  let seen = false;
  try { seen = sessionStorage.getItem(SEEN_KEY) === ref; } catch { /* private mode */ }
  if (!seen && !looksAutomated(window.navigator)) {
    onFirstHuman(() => {
      try { if (sessionStorage.getItem(SEEN_KEY) === ref) return; sessionStorage.setItem(SEEN_KEY, ref); } catch { /* private mode */ }
      track('link_open', { view });
      postLinkOpened(ref, view);
    });
  }
  return ref;
}
