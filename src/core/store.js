// store.js — the single source of truth for the layout, with pub/sub.
//
// Everything in inches. The scene and the UI both subscribe; whenever the
// state changes they get told what changed so they can update cheaply.

import { planIslandFlags } from './islands.js';
import { boxAt } from './placement.js';
import { DEFAULT_FINISH, getCab } from './catalogue.js';
import { housingTakes } from './ovenseat.js';

export const SCHEMA = 'plinth-planner';
export const VERSION = 1;

/** A fresh room: the default size, no openings, no boxings. `keep` carries the STYLE across
 *  (floor, wall, worktop, cornice) so a new unit type in the same building looks like its
 *  siblings while its DIMENSIONS start blank for the person to enter (her catch 2026-09-25:
 *  a new project remembered the last project's room size). */
export function freshRoom(keep = {}) {
  const r = defaultState().room;
  for (const k of ['floor', 'wall', 'worktop', 'cornice']) if (keep[k] != null) r[k] = keep[k];
  return r;
}

function defaultState() {
  return {
    schema: SCHEMA,
    version: VERSION,
    room: {
      width: 144, depth: 120, height: 96, // 12ft × 10ft × 8ft default
      floor: 'oak', wall: 'white', worktop: 'marble', cornice: 'none',   // white walls by default (her call 2026-09-18; was chalk since the first deploy)
      // openings: [{ id, type:'window'|'door'|'doorway', wall:'back'|'left', pos:0..1, width }]
      openings: [],
      nextOpening: 1,
      // boxings: boxed-in pipe runs / bulkheads [{ id, wall, pos:0..1, w, d, h }]
      boxings: [],
      nextBoxing: 1,
    },
    finish: DEFAULT_FINISH,
    handle: 'knob',       // fixed — Plinth cabinets ship with knobs only (kept for old saves)
    items: [],            // { id, code, x, z, rotDeg, finish? }
    accessories: {},      // { code: qty } — cutlery inserts, end panels, etc.
    customer: { name: '', email: '', zip: '', notes: '' },
    nextId: 1,
    mode: 'home',         // 'home' (one kitchen) | 'trade' (multi-unit spec)
    trade: {
      project: '',
      units: [],          // [{ id, beds, letter, name, qty, floorFrom, floorTo, perFloor, rows:[{id,code,qty}] }]
      finish: DEFAULT_FINISH,
      nextUnitId: 1,
      nextRowId: 1,
    },
  };
}

export class Store {
  constructor() {
    this.state = defaultState();
    this._subs = new Set();
    // ----- undo/redo history (snapshots; drags & wizard builds batch to ONE step)
    this._hist = [];
    this._redo = [];
    this._histLimit = 60;
    this._histDepth = 0;      // >0 → inside a batch
    this._histPending = null; // snapshot taken at batch start
  }

  /** subscribe(fn) -> unsubscribe. fn(state, change) */
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }

  _emit(change) { for (const fn of this._subs) fn(this.state, change); }

  // ----- undo / redo -----
  _snap() { return JSON.stringify(this.state); }

  /** Capture a history step BEFORE a single mutation (no-op inside a batch). */
  _record() {
    if (this._histDepth > 0) return;
    this._hist.push(this._snap());
    if (this._hist.length > this._histLimit) this._hist.shift();
    this._redo.length = 0;
  }

  /** Group many mutations (a drag, a wizard build) into ONE undo step. */
  beginHistory() {
    if (this._histDepth === 0) this._histPending = this._snap();
    this._histDepth++;
  }
  endHistory() {
    this._histDepth = Math.max(0, this._histDepth - 1);
    if (this._histDepth === 0 && this._histPending != null) {
      if (this._histPending !== this._snap()) {          // only if something changed
        this._hist.push(this._histPending);
        if (this._hist.length > this._histLimit) this._hist.shift();
        this._redo.length = 0;
      }
      this._histPending = null;
    }
  }

  get canUndo() { return this._hist.length > 0; }
  get canRedo() { return this._redo.length > 0; }

  undo() {
    if (!this.canUndo) return false;
    this._redo.push(this._snap());
    this._restore(this._hist.pop());
    return true;
  }
  redo() {
    if (!this.canRedo) return false;
    this._hist.push(this._snap());
    this._restore(this._redo.pop());
    return true;
  }
  _restore(json) {
    this.state = JSON.parse(json);
    this._emit({ type: 'load', hist: true });
  }

  // ----- mutations -----
  setRoom(patch) {
    this._record();
    Object.assign(this.state.room, patch);
    this._emit({ type: 'room' });
  }

  // ----- room openings (windows / doors / doorways) -----
  addOpening({ type = 'window', wall = 'back', pos = 0.5, width, wiz } = {}) {
    this._record();
    const r = this.state.room;
    if (!Array.isArray(r.openings)) r.openings = [];
    const o = { id: r.nextOpening = (r.nextOpening || 1) + 0, type, wall, pos, width: width ?? (type === 'window' ? 48 : 34) };
    if (wiz) o.wiz = true;      // drawn by the wizard's own door picker: the next draft replaces it; the room's own doors it never touches
    o.id = r.nextOpening; r.nextOpening += 1;
    r.openings.push(o);
    this._emit({ type: 'room' });
    return o;
  }
  updateOpening(id, patch) {
    this._record();
    const o = (this.state.room.openings || []).find((x) => x.id === id);
    if (o) { Object.assign(o, patch); this._emit({ type: 'room' }); }
  }
  removeOpening(id) {
    this._record();
    const r = this.state.room;
    r.openings = (r.openings || []).filter((x) => x.id !== id);
    this._emit({ type: 'room' });
  }

  // ----- boxing-in (boxed pipe runs / bulkheads) -----
  addBoxing({ wall = 'back', pos = 0.5, w = 8, d = 8, h } = {}) {
    this._record();
    const r = this.state.room;
    if (!Array.isArray(r.boxings)) r.boxings = [];
    const b = { id: r.nextBoxing || 1, wall, pos, w, d, h: h ?? r.height };
    r.nextBoxing = (r.nextBoxing || 1) + 1;
    r.boxings.push(b);
    this._emit({ type: 'room' });
    return b;
  }
  updateBoxing(id, patch) {
    this._record();
    const b = (this.state.room.boxings || []).find((x) => x.id === id);
    if (b) { Object.assign(b, patch); this._emit({ type: 'room' }); }
  }
  removeBoxing(id) {
    this._record();
    const r = this.state.room;
    r.boxings = (r.boxings || []).filter((x) => x.id !== id);
    this._emit({ type: 'room' });
  }

  setFinish(name) {
    this._record();
    this.state.finish = name;
    this._emit({ type: 'finish' });
  }
  /** Paint these cabinets their own colour (`name`), or back to the kitchen's (null). One undo step;
   *  emits 'finish' so every front is rebuilt (the island in a second colour, her ask 2026-09-26). */
  paintItems(ids, name) {
    this._record();
    const want = new Set(ids || []);
    for (const it of this.state.items) {
      if (!want.has(it.id)) continue;
      if (name && name !== this.state.finish) it.finish = name; else delete it.finish;
    }
    this._emit({ type: 'finish' });
  }

  setCustomer(patch) {
    Object.assign(this.state.customer, patch);
    this._emit({ type: 'customer', quiet: true });
  }

  /** Set the quantity of a loose accessory (cutlery insert, end panel, …). */
  setAccessory(code, qty) {
    this._record();
    if (!this.state.accessories) this.state.accessories = {};
    const n = Math.max(0, Math.floor(qty) || 0);
    if (n === 0) delete this.state.accessories[code];
    else this.state.accessories[code] = n;
    this._emit({ type: 'update' });
  }

  // ----- mode + trade -----
  setMode(m) {
    this.state.mode = m;
    this._emit({ type: 'mode' });
  }

  /** Trade UI mutates state.trade then calls this to broadcast. */
  touchTrade(opts = {}) {
    this._emit({ type: 'trade', quiet: !!opts.quiet });
  }

  /** Put every cabinet's island flag where it STANDS (core/islands.js). A derived fact, so it
   *  is never an undo step of its own and emits nothing: callers redraw. Returns how many changed. */
  syncIslands() {
    const ch = planIslandFlags(this.state);
    for (const c of ch) { const it = this.state.items.find((i) => i.id === c.id); if (!it) continue; if (c.island) it.island = true; else delete it.island; }
    return ch.length;
  }
  /** File a cabinet with the island (or with the wall run) BY HAND: the planner stops guessing for it. */
  fileIsland(id, island) {
    const it = this.state.items.find((i) => i.id === id); if (!it) return;
    this._record();
    if (island) it.island = true; else delete it.island;
    it.islandLock = true;
    this._emit({ type: 'update', id });
  }

  addItem(code, pos = {}) {
    this._record();
    const item = {
      id: this.state.nextId++,
      code,
      x: pos.x ?? 0,
      z: pos.z ?? 0,
      rotDeg: pos.rotDeg ?? 0,
      finish: null, // null => use global finish
      ...(pos.island ? { island: true } : {}),
      ...(pos.backPanel ? { backPanel: true } : {}),
      ...(pos.seating ? { seating: true } : {}),
      ...(pos.hostId != null ? { hostId: pos.hostId } : {}),
    };
    this.state.items.push(item);
    this._emit({ type: 'add', id: item.id });
    return item;
  }

  updateItem(id, patch, opts = {}) {
    const it = this.state.items.find((i) => i.id === id);
    if (!it) return;
    if (!opts.quiet) this._record();
    const was = { x: it.x, z: it.z, rotDeg: it.rotDeg || 0 };
    const wasCab = getCab(it.code);
    const riders = ('x' in patch || 'z' in patch || 'rotDeg' in patch) && wasCab && (wasCab.type === 'FLOOR' || (wasCab.type === 'APPLIANCES' && (wasCab.mountY || 0) === 0)) ? this._ridersOn(it, wasCab) : [];
    Object.assign(it, patch);
    this._emit({ type: 'update', id, quiet: !!opts.quiet });
    // a sink or cooktop set in this base rides with it: same offset from the base's centre, turned with it
    // (her catch 2026-09-22: "when you move this, the cooktop doesn't come with it")
    if (riders.length) {
      const dth = (((it.rotDeg || 0) - was.rotDeg) * Math.PI) / 180, c = Math.cos(dth), s = Math.sin(dth);
      for (const r of riders) {
        const ox = r.x - was.x, oz = r.z - was.z;
        Object.assign(r, { x: it.x + ox * c + oz * s, z: it.z - ox * s + oz * c, rotDeg: ((r.rotDeg || 0) + (it.rotDeg || 0) - was.rotDeg) });
        this._emit({ type: 'update', id: r.id, quiet: !!opts.quiet });
      }
    }
    // a wall oven rides in its housing: wherever the housing goes, it goes
    if ('x' in patch || 'z' in patch || 'rotDeg' in patch) {
      for (const r of this.state.items) {
        if (r.hostId !== id) continue;
        Object.assign(r, { x: it.x, z: it.z, rotDeg: it.rotDeg });
        this._emit({ type: 'update', id: r.id, quiet: !!opts.quiet });
      }
    }
  }

  /** The sinks and cooktops set in this base: a worktop appliance whose centre is inside the
   *  base's footprint, OR that mostly overlaps it (a 24" sink hung over the edge of a 20" base
   *  still belongs to it, her screenshot 2026-09-22). A wall oven has its own hostId. */
  _ridersOn(base, cab) {
    const b = boxAt(cab, base.x, base.z, base.rotDeg);
    return this.state.items.filter((r) => {
      const c = getCab(r.code); if (r.id === base.id || r.hostId != null || !c || (c.appliance !== 'sink' && c.appliance !== 'hob')) return false;
      if (r.x > b.x0 - 0.5 && r.x < b.x1 + 0.5 && r.z > b.z0 - 0.5 && r.z < b.z1 + 0.5) return true;
      const rb = boxAt(c, r.x, r.z, r.rotDeg);
      const ov = Math.max(0, Math.min(b.x1, rb.x1) - Math.max(b.x0, rb.x0)) * Math.max(0, Math.min(b.z1, rb.z1) - Math.max(b.z0, rb.z0));
      return ov >= 0.4 * (rb.x1 - rb.x0) * (rb.z1 - rb.z0);
    });
  }

  /** Flip a single-door cabinet's hinge side (L ↔ R). Undoable, rebuilds the item. */
  flipHinge(id) {
    const it = this.state.items.find((i) => i.id === id);
    if (!it) return;
    this._record();
    it.hinge = it.hinge === 'R' ? 'L' : 'R';
    this._emit({ type: 'swap', id });   // same pipeline as a code swap: rebuild + reselect
  }

  /** Swap a placed item for another code IN PLACE (same spot, same rotation). */
  swapItem(id, code, opts = {}) {
    const it = this.state.items.find((i) => i.id === id);
    if (!it || it.code === code) return;
    if (!opts.quiet) this._record();       // quiet: mid-drag depth changes of a shelf, inside the drag's own history step
    it.code = code;
    delete it.open;                       // door state doesn't carry across forms
    this._emit({ type: 'swap', id });
    // swapped for something that is not its housing: the oven inside comes out
    for (const r of this.state.items.filter((o) => o.hostId === id)) {
      if (housingTakes(getCab(code), getCab(r.code))) continue;
      this.state.items = this.state.items.filter((o) => o !== r);
      this._emit({ type: 'remove', id: r.id });
    }
  }

  removeItem(id) {
    this._record();
    const riders = this.state.items.filter((i) => i.hostId === id);   // the oven leaves with its housing
    this.state.items = this.state.items.filter((i) => i.id !== id && i.hostId !== id);
    this._emit({ type: 'remove', id });
    for (const r of riders) this._emit({ type: 'remove', id: r.id });
  }

  getItem(id) { return this.state.items.find((i) => i.id === id); }

  clear() {
    this._record();
    // "Clear" means "take the cabinets off THIS plan" — it must never destroy
    // the trade project (units/designs) or kick the user out of their mode.
    const room = { ...this.state.room };
    const trade = this.state.trade;
    const mode = this.state.mode;
    this.state = defaultState();
    this.state.room = room;
    this.state.trade = trade;
    this.state.mode = mode;
    this._emit({ type: 'reset' });
  }

  // ----- serialise -----
  serialize() { return JSON.parse(JSON.stringify(this.state)); }

  replace(data, { preserveTrade = false } = {}) {
    if (!data || data.schema !== SCHEMA) return false;
    this._record();
    const base = defaultState();
    // migrate the old boolean cornice flag → named profile
    const inRoom = { ...(data.room || {}) };
    if (typeof inRoom.cornice === 'boolean') inRoom.cornice = inRoom.cornice ? 'plain' : 'none';
    // preserveTrade: a shared #d= design carries no trade key — loading one
    // must never wipe a trade project that lives in this browser
    const keptTrade = preserveTrade && !data.trade ? this.state.trade : null;
    this.state = {
      ...base,
      ...data,
      room: { ...base.room, ...inRoom },
      customer: { ...base.customer, ...(data.customer || {}) },
      items: Array.isArray(data.items) ? data.items : [],
      accessories: (data.accessories && typeof data.accessories === 'object') ? data.accessories : {},
      mode: data.mode === 'trade' ? 'trade' : 'home',
      trade: keptTrade || { ...base.trade, ...(data.trade || {}), units: Array.isArray(data.trade?.units) ? data.trade.units : [] },
    };
    // migrate legacy single window/door booleans → openings array
    const room = this.state.room;
    if (!Array.isArray(room.openings)) room.openings = [];
    if (room.openings.length === 0) {
      let nid = 1;
      if (inRoom.window) room.openings.push({ id: nid++, type: 'window', wall: 'back', pos: inRoom.windowPos ?? 0.5, width: 48 });
      if (inRoom.door) room.openings.push({ id: nid++, type: 'door', wall: 'left', pos: inRoom.doorPos ?? 0.6, width: 34 });
      room.nextOpening = nid;
    }
    room.nextOpening = Math.max(room.nextOpening || 1, ...room.openings.map((o) => (o.id || 0) + 1), 1);
    if (!Array.isArray(room.boxings)) room.boxings = [];
    room.nextBoxing = Math.max(room.nextBoxing || 1, ...room.boxings.map((b) => (b.id || 0) + 1), 1);

    // make sure nextId is safe
    const maxId = this.state.items.reduce((m, i) => Math.max(m, i.id || 0), 0);
    this.state.nextId = Math.max(this.state.nextId || 1, maxId + 1);
    this._emit({ type: 'load' });
    return true;
  }
}
