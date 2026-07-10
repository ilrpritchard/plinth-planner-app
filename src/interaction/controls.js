// controls.js — pointer interaction: select, drag on the floor plane, snap,
// rotate, delete. Works with mouse and touch (pointer events). While dragging a
// cabinet, OrbitControls is suspended so the gestures don't fight.

import * as THREE from 'three';
import { snapPosition } from './snapping.js';
import { getCab } from '../core/catalogue.js';
import { measureRun } from '../core/measure.js';
import { fmtIn } from '../core/units.js';

export class PointerControls {
  constructor({ scene, cabinetLayer, room, store, onCommit, onSelect, onWallClick, onOpeningClick }) {
    this.s = scene;
    this.layer = cabinetLayer;
    this.room = room;
    this.store = store;
    this.onCommit = onCommit || (() => {});
    this.onSelect = onSelect || (() => {});
    this.onWallClick = onWallClick || (() => {});
    this.onOpeningClick = onOpeningClick || (() => {});

    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.drag = null; // { id, offsetX, offsetZ }

    const el = scene.renderer.domElement;
    this.el = el;
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('dblclick', (e) => this._dblclick(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('keydown', (e) => this._key(e));
  }

  _pickId(e) {
    this._setNDC(e);
    this.ray.setFromCamera(this.ndc, this.s.camera);
    const hits = this.ray.intersectObjects(this.layer.pickables(), true);
    return hits.length ? this._rootItemId(hits[0].object) : null;
  }

  _dblclick(e) {
    const id = this._pickId(e);
    if (id == null) return;
    this.layer.toggleOpen(id);   // double-click a cabinet to open/close its doors
    this.layer.select(id);
    this.onSelect(id);
  }

  _setNDC(e) {
    const r = this.el.getBoundingClientRect();
    this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  _floorPoint() {
    this.ray.setFromCamera(this.ndc, this.s.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.floor, p) ? p : null;
  }

  _rootItemId(obj) {
    let o = obj;
    while (o) { if (o.userData && o.userData.itemId != null) return o.userData.itemId; o = o.parent; }
    return null;
  }

  _down(e) {
    if (e.button != null && e.button !== 0) return;
    this._setNDC(e);
    this.ray.setFromCamera(this.ndc, this.s.camera);
    const hits = this.ray.intersectObjects(this.layer.pickables(), true);
    const id = hits.length ? this._rootItemId(hits[0].object) : null;

    if (id != null) {
      this.layer.select(id);
      this.onSelect(id);
      const item = this.store.getItem(id);
      const p = this._floorPoint();
      this.drag = p ? { id, ox: item.x - p.x, oz: item.z - p.z } : { id, ox: 0, oz: 0 };
      this.store.beginHistory();           // the whole drag = ONE undo step
      this.s.controls.enabled = false;     // suspend orbit while dragging
      this.el.setPointerCapture?.(e.pointerId);
    } else {
      this.layer.select(null);
      this.onSelect(null);
      // a placed window/door/doorway is clickable: edit its position or delete
      const op = this._pickOpening();
      if (op != null) { this.onOpeningClick({ id: op, clientX: e.clientX, clientY: e.clientY }); return; }
      this._pickWall(e);   // clicking a bare wall offers to add an opening there
    }
  }

  _pickOpening() {
    const groups = this.room?.openingPickables ? this.room.openingPickables() : [];
    if (!groups.length) return null;
    const hits = this.ray.intersectObjects(groups, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o) { if (o.userData?.openingId != null) return o.userData.openingId; o = o.parent; }
    return null;
  }

  _pickWall(e) {
    const walls = this.room?.walls ? Object.values(this.room.walls).flat().filter((w) => w && w.visible) : [];
    const hits = walls.length ? this.ray.intersectObjects(walls, false) : [];
    if (!hits.length) { this.onWallClick(null); return; }
    const name = hits[0].object.userData.wall;
    const p = hits[0].point;
    const r = this.store.state.room;
    let pos;
    if (name === 'back' || name === 'front') pos = (p.x + r.width / 2) / r.width;
    else pos = (p.z + r.depth / 2) / r.depth;
    pos = Math.max(0.02, Math.min(0.98, pos));
    this.onWallClick({ wall: name, pos, clientX: e.clientX, clientY: e.clientY });
  }

  _move(e) {
    if (!this.drag) {
      // hover highlight when not dragging
      const id = this._pickId(e);
      this.layer.setHover(id);
      this.el.style.cursor = id != null ? 'pointer' : '';
      return;
    }
    this._setNDC(e);
    const p = this._floorPoint();
    if (!p) return;
    const rawX = p.x + this.drag.ox;
    const rawZ = p.z + this.drag.oz;
    const snapped = snapPosition(this.store, this.drag.id, rawX, rawZ, this.room.bounds());
    this.store.updateItem(this.drag.id, { x: snapped.x, z: snapped.z, rotDeg: snapped.rotDeg }, { quiet: true });
    const RULE_MSG = {
      window: '✕ Cabinets can’t cover a window',
      sink: '✕ The sink sits in clear countertop — keep it off talls & uppers',
      offwall: '✕ Wall, counter & tall cabinets sit against a wall',
      corner: '✕ Corner units live in corners — the blank return meets the adjoining run',
    };
    if (snapped.flag) this._showRuleFlag(RULE_MSG[snapped.flag] || '✕ Not allowed there', e);
    else this._hideRuleFlag();
    this._showDims(this.drag.id, e);
  }

  _up() {
    if (!this.drag) return;
    const id = this.drag.id;
    this.drag = null;
    this._hideDims();
    this._hideRuleFlag();
    this.s.controls.enabled = true;
    // commit (non-quiet) so worktop + cost refresh
    const it = this.store.getItem(id);
    if (it) this.store.updateItem(id, {}, { quiet: false });
    this.store.endHistory();
    this.onCommit();
  }

  // ----- live dimensions while dragging: width + clear gap to each neighbour/wall
  _showDims(id, e) {
    const m = measureRun(this.store, id, this.room.bounds());
    if (!m) return;
    if (!this._dimChip) {
      this._dimChip = document.createElement('div');
      this._dimChip.id = 'dimChip';
      document.body.appendChild(this._dimChip);
    }
    const side = (g) => g.gap < 0.4
      ? '<b>flush</b>'
      : `<b>${fmtIn(g.gap)}</b><small>${g.to === 'wall' ? ' to wall' : ''}</small>`;
    this._dimChip.innerHTML = `${side(m.before)} ⟵ <b>${fmtIn(m.w)}</b> ⟶ ${side(m.after)}`;
    this._dimChip.style.left = (e.clientX + 14) + 'px';
    this._dimChip.style.top = (e.clientY + 18) + 'px';
    this._dimChip.style.display = 'block';
  }
  _hideDims() { if (this._dimChip) this._dimChip.style.display = 'none'; }

  // rule violation flag (e.g. trying to drop a cabinet over a window)
  _showRuleFlag(msg, e) {
    if (!this._ruleFlag) {
      this._ruleFlag = document.createElement('div');
      this._ruleFlag.id = 'ruleFlag';
      document.body.appendChild(this._ruleFlag);
    }
    this._ruleFlag.textContent = msg;
    this._ruleFlag.style.left = (e.clientX + 14) + 'px';
    this._ruleFlag.style.top = (e.clientY - 26) + 'px';
    this._ruleFlag.style.display = 'block';
  }
  _hideRuleFlag() { if (this._ruleFlag) this._ruleFlag.style.display = 'none'; }

  _key(e) {
    const id = this.layer.selectedId;
    if (id == null) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.store.removeItem(id);
      this.onSelect(null);
      this.onCommit();
    } else if (e.key === 'r' || e.key === 'R') {
      const it = this.store.getItem(id);
      const rot = ((it.rotDeg || 0) + 90) % 360;
      const snapped = snapPosition(this.store, id, it.x, it.z, this.room.bounds());
      // keep new rotation but re-snap position to it (ONE undo step)
      this.store.beginHistory();
      this.store.updateItem(id, { rotDeg: rot }, { quiet: true });
      const s2 = snapPosition(this.store, id, it.x, it.z, this.room.bounds());
      this.store.updateItem(id, { x: s2.x, z: s2.z, rotDeg: rot }, { quiet: false });
      this.store.endHistory();
      this.onCommit();
    } else if (e.key === 'Escape') {
      this.layer.select(null);
      this.onSelect(null);
    }
  }

  /** Place a new cabinet against the active wall, appended to the run end. */
  placeNew(code, wall = 'back') {
    const cab = getCab(code);
    if (!cab || !cab.placeable) return null;
    const b = this.room.bounds();

    // figure out where the current run on this wall ends, so we append
    const runEnd = this._runEnd(wall, b);
    let startX, startZ, rotDeg;
    if (wall === 'left') { rotDeg = 90; startX = b.minX + cab.d / 2 + 0.1; startZ = runEnd + cab.w / 2; }
    else if (wall === 'right') { rotDeg = 270; startX = b.maxX - cab.d / 2 - 0.1; startZ = runEnd + cab.w / 2; }
    else if (wall === 'front') { rotDeg = 180; startZ = b.maxZ - cab.d / 2 - 0.1; startX = runEnd + cab.w / 2; }
    else if (wall === 'island') { rotDeg = 0; startX = runEnd + cab.w / 2; startZ = 0; }
    else { rotDeg = 0; startZ = b.minZ + cab.d / 2 + 0.1; startX = runEnd + cab.w / 2; }

    this.store.beginHistory();             // add + snap = ONE undo step
    const item = this.store.addItem(code, { x: startX, z: startZ, rotDeg });
    // no feature-snap on placement: keep the run exactly butted (a range must
    // never be pulled to the wall centre on top of its neighbour).
    const snapped = snapPosition(this.store, item.id, startX, startZ, b, { noFeature: true });
    this.store.updateItem(item.id, { x: snapped.x, z: snapped.z, rotDeg: snapped.rotDeg }, { quiet: false });
    this.store.endHistory();

    // Islands default to single-depth with a finished (end-panelled) back. To
    // make it double-sided, drag a second cabinet behind it — it snaps
    // back-to-back automatically (see snapping.js).

    this.layer.select(item.id);
    this.onSelect(item.id);
    this.onCommit();
    return item;
  }

  // along-axis coordinate where the current run on `wall` ends
  _runEnd(wall, b) {
    const vert = wall === 'left' || wall === 'right';
    const along = (it) => (vert ? it.z : it.x);
    const min = (vert ? b.minZ : b.minX);
    let end = min;
    for (const it of this.store.state.items) {
      const c = getCab(it.code); if (!c || !c.placeable) continue;
      const horiz = ((it.rotDeg || 0) % 180) === 0;
      const onWall = wall === 'island'
        ? true
        : wall === 'back' ? (horiz && Math.abs(it.z - (b.minZ + c.d / 2)) < 8)
        : wall === 'front' ? (horiz && Math.abs(it.z - (b.maxZ - c.d / 2)) < 8)
        : wall === 'left' ? (!horiz && Math.abs(it.x - (b.minX + c.d / 2)) < 8)
        : (!horiz && Math.abs(it.x - (b.maxX - c.d / 2)) < 8);
      if (onWall) end = Math.max(end, along(it) + c.w / 2);
    }
    return end;
  }
}
