// persistence.js — localStorage autosave + JSON file export/import.

import { SCHEMA } from './store.js';

const KEY = 'plinth-planner-v1';

export function autosave(store) {
  // debounce writes a touch so dragging doesn't thrash localStorage
  let t = null;
  store.subscribe(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(store.serialize())); }
      catch (e) { /* storage full / disabled — ignore */ }
    }, 250);
  });
}

export function loadSaved(store) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    return store.replace(JSON.parse(raw));
  } catch (e) { return false; }
}

export function clearSaved() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

/** Write the current state to the autosave slot RIGHT NOW (no debounce).
 *  Used at moments where losing the 250ms debounce window would lose real
 *  work — e.g. the instant a trade design session hands the project back. */
export function saveNow(store) {
  try { localStorage.setItem(KEY, JSON.stringify(store.serialize())); }
  catch (e) { /* storage full / disabled — ignore */ }
}

// ----- shareable link: the whole design encoded into the URL (no server) -----
const b64ToUtf8 = (s) => decodeURIComponent(escape(atob(s)));

// ---- compact share code (#k=) ---------------------------------------------------
// The first share links were the WHOLE saved state as base64 JSON: 2,500+ characters
// for a small kitchen, and they carried the customer's name / email / notes and the
// trade project in the URL. #k= carries ONLY the design, as URL-safe text (no base64):
//   k1 ~ w.d.h ~ floor.wall.worktop.cornice ~ finish ~ openings ~ boxings ~ items ~ accessories
// Lengths are hundredths of an inch in base 36; an item is code.x.z.rot[.flags] with
// rot in quarter turns. About one seventh the length. Old #d= links still open.
const n36 = (v) => Math.round((Number(v) || 0) * 100).toString(36);
const p36 = (t) => parseInt(t, 36) / 100;
const WALL_KEY = { back: 'b', left: 'l', right: 'r', front: 'f' }, WALL_OF = { b: 'back', l: 'left', r: 'right', f: 'front' };
const OPEN_KEY = { window: 'w', door: 'd', doorway: 'o' }, OPEN_OF = { w: 'window', d: 'door', o: 'doorway' };
const txt = (v) => encodeURIComponent(String(v ?? '')).replace(/[.~_]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const untxt = (t) => decodeURIComponent(t || '');

export function encodeDesign(state) {
  const r = state.room || {}, items = state.items || [];
  const idx = new Map(items.map((it, i) => [it.id, i]));
  const opens = (r.openings || []).map((o) => [OPEN_KEY[o.type] || 'w', WALL_KEY[o.wall || 'back'] || 'b', Math.round((o.pos ?? 0.5) * 10000).toString(36),
    o.width != null ? n36(o.width) : '', o.sill != null ? n36(o.sill) : '', o.hgt != null ? n36(o.hgt) : ''].join('.').replace(/\.+$/, ''));
  const boxes = (r.boxings || []).map((b) => [WALL_KEY[b.wall || 'back'] || 'b', Math.round((b.pos ?? 0.5) * 10000).toString(36), n36(b.w), n36(b.d), b.h != null ? n36(b.h) : ''].join('.').replace(/\.+$/, ''));
  const its = items.map((it) => {
    const rot = ((((it.rotDeg || 0) % 360) + 360) % 360);
    let flags = (it.island ? 'i' : '') + (it.backPanel ? 'b' : '') + (it.seating ? 's' : '') + (it.hinge === 'R' ? 'R' : it.hinge === 'L' ? 'L' : '');
    if (it.hostId != null && idx.has(it.hostId)) flags += `h${idx.get(it.hostId).toString(36)}`;
    const extra = [flags, it.worktop ? txt(it.worktop) : '', it.finish ? txt(it.finish) : ''].join('.').replace(/\.+$/, '');
    return [txt(it.code), n36(it.x), n36(it.z), rot % 90 === 0 ? String(rot / 90) : `d${n36(rot)}`].join('.') + (extra ? '.' + extra : '');
  });
  const acc = Object.entries(state.accessories || {}).filter(([, q]) => q > 0).map(([c, q]) => `${txt(c)}.${Number(q).toString(36)}`);
  return ['k1', [n36(r.width), n36(r.depth), n36(r.height)].join('.'),
    [r.floor, r.wall, r.worktop, r.cornice].map((v) => txt(v || '')).join('.'), txt(state.finish || ''),
    opens.join('_'), boxes.join('_'), its.join('_'), acc.join('_')].join('~').replace(/~+$/, '');
}

/** -> a state object store.replace() accepts, or null when the code is not a k1 design. */
export function decodeDesign(code) {
  const part = String(code || '').split('~');
  if (part[0] !== 'k1' || part.length < 4) return null;
  const [w, d, h] = part[1].split('.').map(p36);
  const [floor, wall, worktop, cornice] = part[2].split('.').map(untxt);
  const list = (t) => (t ? t.split('_') : []);
  const openings = list(part[4]).map((t, i) => {
    const f = t.split('.'), o = { id: i + 1, type: OPEN_OF[f[0]] || 'window', wall: WALL_OF[f[1]] || 'back', pos: parseInt(f[2], 36) / 10000 };
    if (f[3]) o.width = p36(f[3]); if (f[4]) o.sill = p36(f[4]); if (f[5]) o.hgt = p36(f[5]);
    return o;
  });
  const boxings = list(part[5]).map((t, i) => {
    const f = t.split('.'), b = { id: i + 1, wall: WALL_OF[f[0]] || 'back', pos: parseInt(f[1], 36) / 10000, w: p36(f[2]), d: p36(f[3]) };
    if (f[4]) b.h = p36(f[4]);
    return b;
  });
  const hosts = [];
  const items = list(part[6]).map((t, i) => {
    const f = t.split('.'), rot = f[3] || '0';
    const it = { id: i + 1, code: untxt(f[0]), x: p36(f[1]), z: p36(f[2]), rotDeg: rot[0] === 'd' ? p36(rot.slice(1)) : Number(rot) * 90, finish: f[6] ? untxt(f[6]) : null };
    const flags = f[4] || '', hm = flags.match(/h([0-9a-z]+)$/);
    if (flags.includes('i')) it.island = true; if (flags.includes('b')) it.backPanel = true; if (flags.includes('s')) it.seating = true;
    if (/R/.test(flags)) it.hinge = 'R'; else if (/L/.test(flags)) it.hinge = 'L';
    if (hm) hosts.push([it, parseInt(hm[1], 36)]);
    if (f[5]) it.worktop = untxt(f[5]);
    return it;
  });
  for (const [it, hi] of hosts) if (items[hi]) it.hostId = items[hi].id;
  const accessories = {};
  for (const t of list(part[7])) { const f = t.split('.'); const q = parseInt(f[1], 36); if (q > 0) accessories[untxt(f[0])] = q; }
  return {
    schema: SCHEMA, version: 1, mode: 'home', finish: untxt(part[3]), items, accessories, nextId: items.length + 1,
    room: { width: w, depth: d, height: h, floor, wall, worktop, cornice, openings, nextOpening: openings.length + 1, boxings, nextBoxing: boxings.length + 1 },
  };
}

/** Build a self-contained share URL with the design encoded in the hash. */
export function buildShareURL(store) {
  const base = location.origin + location.pathname;
  return `${base}#k=${encodeDesign(store.serialize())}`;
}

/** If the URL hash carries a shared design, load it. Returns true if it did.
 *  The hash is consumed: it's stripped from the URL after a successful load,
 *  so RELOADING the tab later boots from the autosave — a stale share link
 *  must not keep replacing the user's real work (or their trade project,
 *  which shared designs never carry — hence preserveTrade). */
export function loadFromHash(store) {
  try {
    const hash = location.hash || '';
    const k = hash.match(/[#&]k=([^&]+)/), m = hash.match(/[#&]d=([^&]+)/);
    if (!k && !m) return false;
    let data;
    if (k) data = decodeDesign(k[1]);                      // compact design-only code
    else {                                                 // the original whole-state links still open
      let code = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (code.length % 4) code += '=';
      data = JSON.parse(b64ToUtf8(code));
    }
    const ok = store.replace(data, { preserveTrade: true });
    if (ok) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } }
    return ok;
  } catch (e) { return false; }
}

export function exportJSON(store) {
  const data = store.serialize();
  const name = (store.state.customer.name || 'kitchen')
    .replace(/[^a-z0-9\-_ ]/gi, '').replace(/\s+/g, '_').slice(0, 50) || 'kitchen';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PLINTH_plan_${name}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
}

export function importJSON(store, file, onDone) {
  const r = new FileReader();
  r.onload = (e) => {
    try {
      const ok = store.replace(JSON.parse(e.target.result));
      onDone?.(ok);
    } catch (err) { onDone?.(false, err); }
  };
  r.readAsText(file);
}
