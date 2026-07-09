// store.js — the single source of truth for the layout, with pub/sub.
//
// Everything in inches. The scene and the UI both subscribe; whenever the
// state changes they get told what changed so they can update cheaply.

import { DEFAULT_FINISH } from './catalogue.js';

export const SCHEMA = 'plinth-planner';
export const VERSION = 1;

function defaultState() {
  return {
    schema: SCHEMA,
    version: VERSION,
    room: {
      width: 144, depth: 120, height: 96, // 12ft × 10ft × 8ft default
      floor: 'oak', wall: 'chalk', worktop: 'marble', cornice: 'none',
      // openings: [{ id, type:'window'|'door'|'doorway', wall:'back'|'left', pos:0..1, width }]
      openings: [],
      nextOpening: 1,
      // boxings: boxed-in pipe runs / bulkheads [{ id, wall, pos:0..1, w, d, h }]
      boxings: [],
      nextBoxing: 1,
    },
    finish: DEFAULT_FINISH,
    handle: 'knob',       // 'knob' | 'bar' | 'handleless'
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
  addOpening({ type = 'window', wall = 'back', pos = 0.5, width } = {}) {
    this._record();
    const r = this.state.room;
    if (!Array.isArray(r.openings)) r.openings = [];
    const o = { id: r.nextOpening = (r.nextOpening || 1) + 0, type, wall, pos, width: width ?? (type === 'window' ? 48 : 34) };
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

  setHandle(name) {
    this._record();
    this.state.handle = name;
    this._emit({ type: 'finish' }); // rebuilds cabinets like a finish change
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
    };
    this.state.items.push(item);
    this._emit({ type: 'add', id: item.id });
    return item;
  }

  updateItem(id, patch, opts = {}) {
    const it = this.state.items.find((i) => i.id === id);
    if (!it) return;
    if (!opts.quiet) this._record();
    Object.assign(it, patch);
    this._emit({ type: 'update', id, quiet: !!opts.quiet });
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
  swapItem(id, code) {
    const it = this.state.items.find((i) => i.id === id);
    if (!it || it.code === code) return;
    this._record();
    it.code = code;
    delete it.open;                       // door state doesn't carry across forms
    this._emit({ type: 'swap', id });
  }

  removeItem(id) {
    this._record();
    this.state.items = this.state.items.filter((i) => i.id !== id);
    this._emit({ type: 'remove', id });
  }

  getItem(id) { return this.state.items.find((i) => i.id === id); }

  clear() {
    this._record();
    const room = { ...this.state.room };
    this.state = defaultState();
    this.state.room = room;
    this._emit({ type: 'reset' });
  }

  // ----- serialise -----
  serialize() { return JSON.parse(JSON.stringify(this.state)); }

  replace(data) {
    if (!data || data.schema !== SCHEMA) return false;
    this._record();
    const base = defaultState();
    // migrate the old boolean cornice flag → named profile
    const inRoom = { ...(data.room || {}) };
    if (typeof inRoom.cornice === 'boolean') inRoom.cornice = inRoom.cornice ? 'plain' : 'none';
    this.state = {
      ...base,
      ...data,
      room: { ...base.room, ...inRoom },
      customer: { ...base.customer, ...(data.customer || {}) },
      items: Array.isArray(data.items) ? data.items : [],
      accessories: (data.accessories && typeof data.accessories === 'object') ? data.accessories : {},
      mode: data.mode === 'trade' ? 'trade' : 'home',
      trade: { ...base.trade, ...(data.trade || {}), units: Array.isArray(data.trade?.units) ? data.trade.units : [] },
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
