// Data-safety tests — the trade project must survive every "innocent" action:
// Clear, loading a shared #d= design, and the moments around a design session.
// Born from a real near-loss (2026-07-21): Clear reset the WHOLE state (trade
// included), and a stale share hash re-applied itself on every reload.
import { Store } from '../src/core/store.js';
import { saveNow, loadFromHash } from '../src/core/persistence.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };

const projectState = (store) => {
  store.state.mode = 'trade';
  store.state.trade.units = [{ id: 1, beds: '3 Bed', letter: 'A', name: 'SB-A', qty: 1, rows: [{ id: 1, code: 'F10', qty: 2 }], design: { items: [{ id: 1, code: 'F10', x: 0, z: 0, rotDeg: 0 }] } }];
  store.state.trade.nextUnitId = 2;
  store.state.trade.project = 'Rockledge';
  return store;
};

// ---- 1. Clear never destroys the trade project or the mode ----------------
{
  const st = projectState(new Store());
  st.addItem('F2');
  st.clear();
  ok('clear keeps mode=trade', st.state.mode === 'trade');
  ok('clear keeps trade units', st.state.trade.units.length === 1);
  ok('clear keeps unit design', st.state.trade.units[0].design.items.length === 1);
  ok('clear keeps project name', st.state.trade.project === 'Rockledge');
  ok('clear still clears items', st.state.items.length === 0);
}

// ---- 2. replace(…, {preserveTrade}) — a shared design can't wipe trade ----
{
  const st = projectState(new Store());
  const shared = new Store().serialize();          // home design, no trade of note
  delete shared.trade;                              // share links never carry trade
  shared.items = [{ id: 1, code: 'F20', x: 0, z: 0, rotDeg: 0 }];
  ok('preserveTrade load ok', st.replace(shared, { preserveTrade: true }) === true);
  ok('preserveTrade keeps units', st.state.trade.units.length === 1);
  ok('preserveTrade loads the shared items', st.state.items.length === 1 && st.state.items[0].code === 'F20');
  // …but data that DOES carry trade still wins (open project / import)
  const full = projectState(new Store()).serialize();
  full.trade.project = 'Other';
  st.replace(full, { preserveTrade: true });
  ok('explicit trade data still replaces', st.state.trade.project === 'Other');
  // and the default (no flag) replaces trade as before
  const st2 = projectState(new Store());
  st2.replace(shared);
  ok('default replace resets trade', st2.state.trade.units.length === 0);
}

// ---- 3. loadFromHash consumes the hash + preserves trade ------------------
{
  const st = projectState(new Store());
  const shared = new Store().serialize();
  delete shared.trade;
  shared.items = [{ id: 1, code: 'F21', x: 0, z: 0, rotDeg: 0 }];
  const code = Buffer.from(JSON.stringify(shared), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let replacedTo = null;
  globalThis.location = { hash: '#d=' + code, pathname: '/planner/', search: '' };
  globalThis.history = { replaceState: (a, b, url) => { replacedTo = url; } };
  ok('hash load ok', loadFromHash(st) === true);
  ok('hash load keeps trade units', st.state.trade.units.length === 1);
  ok('hash load applies design', st.state.items.length === 1 && st.state.items[0].code === 'F21');
  ok('hash consumed from URL', replacedTo === '/planner/');
  delete globalThis.location; delete globalThis.history;
}

// ---- 4. saveNow writes the autosave slot immediately ----------------------
{
  const slot = {};
  globalThis.localStorage = { setItem: (k, v) => { slot[k] = v; }, getItem: (k) => slot[k] ?? null, removeItem: (k) => { delete slot[k]; } };
  const st = projectState(new Store());
  saveNow(st);
  const written = JSON.parse(slot['plinth-planner-v1'] || 'null');
  ok('saveNow persists synchronously', written && written.mode === 'trade' && written.trade.units.length === 1);
  delete globalThis.localStorage;
}

console.log(`\ndata-safety.test.js — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
