// persistence.js — localStorage autosave + JSON file export/import.

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

// ----- shareable link: the whole design encoded into the URL (no server) -----
const utf8ToB64 = (s) => btoa(unescape(encodeURIComponent(s)));
const b64ToUtf8 = (s) => decodeURIComponent(escape(atob(s)));

/** Build a self-contained share URL with the design encoded in the hash. */
export function buildShareURL(store) {
  const json = JSON.stringify(store.serialize());
  const code = utf8ToB64(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const base = location.origin + location.pathname;
  return `${base}#d=${code}`;
}

/** If the URL hash carries a shared design, load it. Returns true if it did. */
export function loadFromHash(store) {
  try {
    const m = (location.hash || '').match(/[#&]d=([^&]+)/);
    if (!m) return false;
    let code = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (code.length % 4) code += '=';
    const ok = store.replace(JSON.parse(b64ToUtf8(code)));
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
