// cabinets.js — keeps the 3D scene in sync with the store, animates hinged
// doors, runs the grounding guard, and manages a soft selection/hover glow.

import * as THREE from 'three';
import { buildCabinet, buildFloatingShelf, getMountY } from '../models/cabinet.js';
import { buildAppliance } from '../models/appliances.js';
import { getCab, getFinish } from '../core/catalogue.js';
import { cornerReturnLength } from './snapping.js';

export class CabinetLayer {
  constructor(scene, store) {
    this.scene = scene;
    this.store = store;
    this.group = new THREE.Group();
    this.group.name = 'cabinets';
    scene.add(this.group);

    this.map = new Map();
    this.selectedId = null;
    this.hoverId = null;
    this.selBox = null;
    this.hovBox = null;

    store.subscribe((state, change) => this._onChange(state, change));
    this.syncAll();
  }

  finishHexFor(item, state) {
    return getFinish(item.finish || state.finish).hex;
  }

  _onChange(state, change) {
    switch (change.type) {
      case 'add': this._addOrUpdate(this.store.getItem(change.id)); this._syncSinkBases(); break;
      case 'swap': this._dispose(change.id); this._addOrUpdate(this.store.getItem(change.id)); this.select(change.id); break;
      case 'update': this._reposition(change.id); this._syncSinkBases(); break;
      case 'remove': this._dispose(change.id); this._syncSinkBases(); break;
      case 'finish': this.rebuildAll(); break;
      // room resized → a corner cabinet's drawn return may need to reach a
      // wall that moved; re-check every corner unit
      case 'room': for (const it of this.store.state.items) { if (getCab(it.code)?.corner) this._reposition(it.id); } break;
      case 'load': case 'reset': this.syncAll(); break;
      default: break;
    }
  }

  syncAll() {
    for (const id of [...this.map.keys()]) this._dispose(id);
    for (const it of this.store.state.items) this._addOrUpdate(it);
    this.select(null);
  }

  rebuildAll() {
    for (const it of this.store.state.items) {
      const rec = this.map.get(it.id);
      if (rec) { this.group.remove(rec.group); disposeGroup(rec.group); this.map.delete(it.id); }
      this._addOrUpdate(it);
    }
    if (this.selectedId != null) this.select(this.selectedId);
  }

  /** Is a sink appliance sitting over this floor cabinet's footprint? */
  _sinkOver(item, cab) {
    const half = (c, r) => {
      const th = ((r || 0) * Math.PI) / 180;
      return {
        x: Math.abs(Math.cos(th)) * c.w / 2 + Math.abs(Math.sin(th)) * c.d / 2,
        z: Math.abs(Math.sin(th)) * c.w / 2 + Math.abs(Math.cos(th)) * c.d / 2,
      };
    };
    const a = half(cab, item.rotDeg);
    return this.store.state.items.some((o) => {
      if (o.id === item.id) return false;
      const oc = getCab(o.code);
      if (!oc || oc.appliance !== 'sink') return false;
      const b = half(oc, o.rotDeg);
      // require REAL overlap (2" past mere adjacency) before dropping the top
      return Math.abs(o.x - item.x) < a.x + b.x - 2 && Math.abs(o.z - item.z) < a.z + b.z - 2;
    });
  }

  /** Rebuild any floor cabinet whose sink-over state flipped (top panel on/off). */
  _syncSinkBases() {
    for (const it of this.store.state.items) {
      const cab = getCab(it.code);
      if (!cab || cab.type !== 'FLOOR') continue;
      const rec = this.map.get(it.id);
      if (!rec) continue;
      if (!!rec.sinkOver !== this._sinkOver(it, cab)) { this._dispose(it.id); this._addOrUpdate(it); }
    }
  }

  _build(cab, item) {
    if (cab.type === 'APPLIANCES') return buildAppliance(cab);
    if (cab.type === 'SHELF') return buildFloatingShelf(cab);
    // hardware is not user-choosable: every Plinth cabinet ships with knobs
    const opts = { hinge: item.hinge, handle: 'knob', backPanel: !!item.backPanel };
    this._lastSinkOver = cab.type === 'FLOOR' && this._sinkOver(item, cab);
    opts.sinkOver = this._lastSinkOver;
    // corner units: draw the blank return long enough to meet the adjacent
    // wall flush (sized from the actual distance — see cornerReturnLength)
    if (cab.corner) opts.returnLen = cornerReturnLength(cab, item, this.store.state.room);
    return buildCabinet(cab, this.finishHexFor(item, this.store.state), opts);
  }

  _addOrUpdate(item) {
    if (!item) return;
    const cab = getCab(item.code);
    if (!cab || !cab.placeable) return;
    const g = this._build(cab, item);
    g.userData.itemId = item.id;
    this.group.add(g);
    const rec = { group: g, code: item.code, sinkOver: this._lastSinkOver };
    if (cab.corner) rec.returnLen = cornerReturnLength(cab, item, this.store.state.room);
    this.map.set(item.id, rec);
    this._reposition(item.id);
  }

  _reposition(id) {
    const rec = this.map.get(id);
    const item = this.store.getItem(id);
    if (!rec || !item) return;
    const cab = getCab(item.code);
    if (rec.code !== item.code) {
      this.group.remove(rec.group); disposeGroup(rec.group); this.map.delete(id);
      this._addOrUpdate(item); return;
    }
    // a corner unit that moved (or whose room changed) may need its drawn
    // return re-sized to keep meeting the adjacent wall — rebuild if so
    if (cab.corner) {
      const rl = cornerReturnLength(cab, item, this.store.state.room);
      if (Math.abs(rl - (rec.returnLen ?? 0)) > 0.05) {
        this.group.remove(rec.group); disposeGroup(rec.group); this.map.delete(id);
        this._addOrUpdate(item); return;
      }
    }
    rec.group.position.set(item.x, getMountY(cab), item.z);
    rec.group.rotation.y = THREE.MathUtils.degToRad(item.rotDeg || 0);
    if (this.selectedId === id) this._refreshBoxes();
  }

  _dispose(id) {
    const rec = this.map.get(id);
    if (!rec) return;
    this.group.remove(rec.group);
    disposeGroup(rec.group);
    this.map.delete(id);
    if (this.selectedId === id) this.select(null);
    if (this.hoverId === id) this.setHover(null);
  }

  // ----- selection + hover (soft outline boxes, not heavy/dark) -----
  select(id) {
    this.selectedId = id;
    if (this.selBox) { this.scene.remove(this.selBox); this.selBox.geometry.dispose(); this.selBox = null; }
    if (id != null && this.map.has(id)) {
      this.selBox = makeOutline(this.map.get(id).group, 0x645b3d); // brand brown (no gold)
      this.scene.add(this.selBox);
    }
    if (id === this.hoverId) this.setHover(null);
  }

  setHover(id) {
    if (id === this.selectedId) id = null;
    if (id === this.hoverId) return;
    this.hoverId = id;
    if (this.hovBox) { this.scene.remove(this.hovBox); this.hovBox.geometry.dispose(); this.hovBox = null; }
    if (id != null && this.map.has(id)) {
      this.hovBox = makeOutline(this.map.get(id).group, 0xbcae90); // soft neutral
      this.scene.add(this.hovBox);
    }
  }

  _refreshBoxes() {
    if (this.selBox && this.selectedId != null && this.map.has(this.selectedId)) {
      this.selBox.box.setFromObject(this.map.get(this.selectedId).group);
    }
    if (this.hovBox && this.hoverId != null && this.map.has(this.hoverId)) {
      this.hovBox.box.setFromObject(this.map.get(this.hoverId).group);
    }
  }

  toggleOpen(id) {
    const it = this.store.getItem(id);
    if (!it) return;
    this.store.updateItem(id, { open: !it.open }, { quiet: true });
  }

  /** Per-frame: re-seat to mount height + ease doors toward open/closed. */
  groundTick() {
    const k = 0.2;
    for (const [id, rec] of this.map) {
      const item = this.store.getItem(id);
      if (!item) continue;
      const my = getMountY(getCab(item.code));
      if (rec.group.position.y !== my) rec.group.position.y = my;
      const doors = rec.group.userData.doors;
      if (doors && doors.length) {
        const open = !!item.open;
        for (const p of doors) {
          const target = open ? p.userData.openAngle : 0;
          const d = target - p.rotation.y;
          p.rotation.y = Math.abs(d) < 1e-3 ? target : p.rotation.y + d * k;
        }
      }
    }
    this._refreshBoxes();
  }

  pickables() { return [...this.map.values()].map((r) => r.group); }
}

function makeOutline(obj, color) {
  const helper = new THREE.Box3Helper(new THREE.Box3().setFromObject(obj), new THREE.Color(color));
  helper.material.transparent = true;
  helper.material.opacity = 0.9;
  return helper;
}

function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
}
