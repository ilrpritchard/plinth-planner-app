// controls.js — pointer interaction: select, drag on the floor plane, snap,
// rotate, delete. Works with mouse and touch (pointer events). While dragging a
// cabinet, OrbitControls is suspended so the gestures don't fight.

import * as THREE from 'three';
import { snapPosition } from './snapping.js';
import { getCab } from '../core/catalogue.js';
import { measureRun } from '../core/measure.js';
import { fmtIn } from '../core/units.js';
import { isOven, findOvenHost, housingCodeFor } from '../core/ovenseat.js';
import { findHoodSeat } from '../core/hoodseat.js';
import { bestBaseFor } from '../core/sinkspec.js';
import { spotOk, findFreeSpot } from '../core/placement.js';
import { boxingBoxes } from '../core/openings.js';

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

  /** The wall the pointer is over: the ray from the camera against the inside face of each
   *  wall, first hit wins. Only faces the ray travels TOWARD count, so a wall the camera is
   *  looking through from outside (auto-hidden) is never picked. -> { wall, along } | null */
  _wallHit() {
    const b = this.room.bounds(), h = this.store.state.room.height || 96;
    this.ray.setFromCamera(this.ndc, this.s.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let best = null;
    for (const [wall, axis, at, sign] of [['back', 'z', b.minZ, 1], ['front', 'z', b.maxZ, -1], ['left', 'x', b.minX, 1], ['right', 'x', b.maxX, -1]]) {
      if (d[axis] * sign >= 0) continue;                              // travelling away from that face
      const t = (at - o[axis]) / d[axis]; if (t <= 0) continue;
      const p = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
      if (p.y < -2 || p.y > h + 2 || p.x < b.minX - 2 || p.x > b.maxX + 2 || p.z < b.minZ - 2 || p.z > b.maxZ + 2) continue;
      if (!best || t < best.t) best = { wall, t, along: axis === 'z' ? p.x : p.z };
    }
    return best;
  }
  static _wallOf(item) { return { 0: 'back', 90: 'left', 180: 'front', 270: 'right' }[(((item.rotDeg || 0) % 360) + 360) % 360] || 'back'; }
  /** Raw drag position for a cabinet that lives on a wall: on the wall the pointer is over, at
   *  the point along it the pointer shows. Sliding along a run follows the hand exactly, and
   *  the cabinet hops to another wall only when the pointer is actually over that wall. */
  _wallRaw(hit, cab) {
    const b = this.room.bounds(), touch = cab.d / 2 + 0.25 + (cab.type === 'TALL' ? 1.18 : 0);
    const along = hit.along + (hit.wall === this.drag.wall ? this.drag.oa : 0);
    return hit.wall === 'back' ? { x: along, z: b.minZ + touch } : hit.wall === 'front' ? { x: along, z: b.maxZ - touch }
      : hit.wall === 'left' ? { x: b.minX + touch, z: along } : { x: b.maxX - touch, z: along };
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
      // drag on a plane at the height the cabinet was GRABBED, not the floor: a wall cabinet
      // hangs 5 ft up, and mapping the pointer to the floor there made a small vertical mouse
      // move a big lurch toward the back wall (her: "dragging a wall or counterstanding
      // cabinet in is REALLY glitchy", 2026-09-22). The plane goes back to the floor on drop.
      this.floor.constant = -Math.max(0, hits[0].point.y);
      const p = this._floorPoint();
      this.drag = p ? { id, ox: item.x - p.x, oz: item.z - p.z } : { id, ox: 0, oz: 0 };
      // a wall, counter or tall cabinet is dragged ALONG ITS WALL by the point the pointer
      // shows on that wall (see _wallHit), so a wobble of the hand never lurches it off
      const cab = getCab(item.code);
      if (cab && ['WALL', 'COUNTER', 'TALL'].includes(cab.type) && !cab.corner) {
        const hit = this._wallHit();
        this.drag.onWall = true; this.drag.wall = PointerControls._wallOf(item);
        const itemAlong = this.drag.wall === 'back' || this.drag.wall === 'front' ? item.x : item.z;
        this.drag.oa = hit && hit.wall === this.drag.wall ? itemAlong - hit.along : 0;
      }
      this.drag.start = { x: item.x, z: item.z, rotDeg: item.rotDeg || 0 };   // where it pings back to
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
    let rawX = p.x + this.drag.ox;
    let rawZ = p.z + this.drag.oz;
    if (this.drag.onWall) {
      const hit = this._wallHit(), cab = getCab(this.store.getItem(this.drag.id)?.code);
      if (hit && cab) ({ x: rawX, z: rawZ } = this._wallRaw(hit, cab));
    }
    const snapped = snapPosition(this.store, this.drag.id, rawX, rawZ, this.room.bounds());
    this.store.updateItem(this.drag.id, { x: snapped.x, z: snapped.z, rotDeg: snapped.rotDeg, ...(snapped.hostId != null ? { hostId: snapped.hostId } : {}) }, { quiet: true });
    this.drag.flag = snapped.flag || null;
    const RULE_MSG = {
      window: '✕ Cabinets can’t cover a window',
      cooker: '✕ Nothing sits over the range',
      sink: '✕ The sink sits in clear countertop. Keep it off talls & uppers',
      offwall: '✕ Wall, counter & tall cabinets sit against a wall',
      corner: '✕ Corner units live in corners: the blank return meets the adjoining run',
      oven: '✕ A wall oven lives in an oven housing of its size',
      hood: '✕ A range hood sits over the range or cooktop. Add one first',
      dishwasher: '✕ Nothing sits over the dishwasher: a sink needs a door or double base',
    };
    if (snapped.flag) this._showRuleFlag(RULE_MSG[snapped.flag] || '✕ Not allowed there', e);
    else this._hideRuleFlag();
    this._showDims(this.drag.id, e);
  }

  _up() {
    if (!this.drag) return;
    const id = this.drag.id;
    const { flag, start } = this.drag;
    this.drag = null;
    this.floor.constant = 0;
    this._hideDims();
    this._hideRuleFlag();
    this.s.controls.enabled = true;
    // a drop that broke a rule pings back to where the drag started
    const it = this.store.getItem(id);
    if (it && flag && start) this.store.updateItem(id, { x: start.x, z: start.z, rotDeg: start.rotDeg }, { quiet: false });
    // commit (non-quiet) so worktop + cost refresh
    else if (it) this.store.updateItem(id, {}, { quiet: false });
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
    // NEVER while typing: Backspace in the room-size / name / email box used to
    // DELETE the selected cabinet (and swallow the keystroke), and an "r" rotated
    // it. Her U-shape lost the first cabinet of its right leg that way and the
    // corner opened up (share link 2026-09-18). Same while a dialog or modal is up.
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (typeof document !== 'undefined' && document.querySelector('#uiDialog.show, #cloudModal.show, #orderCheckModal.show, #wizard.show, #pickModal')) return;
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
  placeNew(code, wall = 'back', opts = {}) {
    const cab = getCab(code);
    if (!cab || !cab.placeable) return null;
    if (isOven(cab)) return this._placeOven(cab, wall);
    if (cab.form === 'ovenBase' && !opts.plain) return this._placeOvenBase(code, wall);
    // a range hood goes straight over the cooker (core/hoodseat.js); with none, it waits on the wall
    if (cab.appliance === 'hood') {
      const seat = findHoodSeat(this.store.state, 0, 0, null, cab);
      if (seat) {
        const item = this.store.addItem(code, { x: seat.x, z: seat.z, rotDeg: seat.rotDeg });
        this.layer.select(item.id); this.onSelect(item.id); this.onCommit();
        return { ...item, overCooker: true };
      }
    }
    // a sink or cooktop goes straight into the best empty base for it, centred
    if (cab.appliance === 'sink' || cab.appliance === 'hob') {
      const rot = { back: 0, left: 90, front: 180, right: 270 }[wall] ?? null;
      const base = bestBaseFor(this.store.state, cab, rot);
      if (base) {
        const item = this.store.addItem(code, { x: base.x, z: base.z, rotDeg: base.rotDeg || 0 });
        this.layer.select(item.id); this.onSelect(item.id); this.onCommit();
        return item;
      }
    }
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
    let snapped = snapPosition(this.store, item.id, startX, startZ, b, { noFeature: true });
    // SAFE placement (a person tapping a tile; the wizard and templates lay out their own
    // runs and keep the old behaviour exactly). The end of the run can be PAST the end of
    // the wall (her fridge, 2026-09-21: 14" left on the back wall, so it started outside
    // the room and a refused snap handed that start point straight back). When the result
    // is not somewhere the thing can stand, find somewhere it can: the first free space
    // on this wall, then another wall, then free-standing on the floor.
    let moved = null;
    if (opts.safe && wall !== 'island' && !cab.corner && !spotOk(this.store.state, cab, snapped.x, snapped.z, snapped.rotDeg, b, item.id)) {
      const spot = findFreeSpot(this.store.state, cab, b, wall, item.id);
      if (!spot) { this.store.removeItem(item.id); this.store.endHistory(); this.onCommit(); return { refused: true, noRoom: true, code }; }
      this.store.updateItem(item.id, { x: spot.x, z: spot.z, rotDeg: spot.rotDeg }, { quiet: true });
      const again = snapPosition(this.store, item.id, spot.x, spot.z, b, { noFeature: true });
      snapped = spotOk(this.store.state, cab, again.x, again.z, again.rotDeg, b, item.id) ? again : spot;   // a snap may only improve a good spot
      if (spot.wall !== wall) moved = spot.wall;
    }
    this.store.updateItem(item.id, { x: snapped.x, z: snapped.z, rotDeg: snapped.rotDeg }, { quiet: false });
    this.store.endHistory();

    // Islands default to single-depth with a finished (end-panelled) back. To
    // make it double-sided, drag a second cabinet behind it — it snaps
    // back-to-back automatically (see snapping.js).

    this.layer.select(item.id);
    this.onSelect(item.id);
    this.onCommit();
    return moved ? { ...item, movedTo: moved } : item;
  }

  // "Sink base" shortcut: the base cabinet goes in like any other, then its sink
  // lands centred in it. ONE undo step takes both out.
  placeSinkBase(combo, wall = 'back') {
    this.store.beginHistory();
    const base = this.placeNew(combo.base, wall);
    const host = base && this.store.getItem(base.id);
    let sink = null;
    if (host) sink = this.store.addItem(combo.sink, { x: host.x, z: host.z, rotDeg: host.rotDeg || 0 });
    this.store.endHistory();
    if (host) { this.layer.select(host.id); this.onSelect(host.id); }
    this.onCommit();
    return host ? { base: host, sink } : null;
  }

  // A wall oven goes into the nearest empty housing of its size. With none in
  // the room, its housing (T9 / T14) is placed on the active wall first and the
  // oven goes into that: ONE undo step. `item.broughtHousing` tells the UI.
  /** The under-counter housing (F32) is a STACK: the base, its oven riding inside, and the
   *  cooktop on the worktop over it (her rule 2026-09-22). One undo step. */
  _placeOvenBase(code, wall) {
    this.store.beginHistory();
    const base = this.placeNew(code, wall, { safe: true, plain: true });
    if (!base) { this.store.endHistory(); return null; }
    const host = this.store.getItem(base.id);
    const oven = this.store.addItem('AP21', { x: host.x, z: host.z, rotDeg: host.rotDeg || 0, hostId: host.id });
    this.store.addItem('AP22', { x: host.x, z: host.z, rotDeg: host.rotDeg || 0 });
    this.store.endHistory();
    this.layer.select(host.id); this.onSelect(host.id); this.onCommit();
    return { ...host, ovenStack: [oven.code, 'AP22'] };
  }

  _placeOven(cab, wall) {
    this.store.beginHistory();
    let host = findOvenHost(this.store.state, cab, 0, 0);
    let brought = null;
    if (!host) {
      const hcode = housingCodeFor(cab);
      if (!hcode || wall === 'island') { this.store.endHistory(); return { refused: true, needs: hcode }; }
      brought = this.placeNew(hcode, wall);
      host = brought && this.store.getItem(brought.id);
      if (!host) { this.store.endHistory(); return { refused: true, needs: hcode }; }
    }
    const item = this.store.addItem(cab.code, { x: host.x, z: host.z, rotDeg: host.rotDeg || 0, hostId: host.id });
    // the under-counter oven's housing takes its cooktop too, when it has none yet
    if (cab.ovenKind === 'under' && !this.store.state.items.some((o) => getCab(o.code)?.appliance === 'hob' && Math.abs(o.x - host.x) < 2 && Math.abs(o.z - host.z) < 6)) this.store.addItem('AP22', { x: host.x, z: host.z, rotDeg: host.rotDeg || 0 });
    this.store.endHistory();
    this.layer.select(item.id);
    this.onSelect(item.id);
    this.onCommit();
    return brought ? { ...item, broughtHousing: brought.code } : item;
  }

  // along-axis coordinate where the current run on `wall` ends
  /** Slide a whole wall along so both ends get the same scribe (core/evenout.js planEvenOut
   *  has already decided it spoils nothing). ONE undo step; riders follow their hosts. */
  evenOut(plan) {
    if (!plan || !plan.ok) return false;
    this.store.beginHistory();
    for (const m of plan.moves) this.store.updateItem(m.id, { x: m.x, z: m.z }, { quiet: true });
    this.store.endHistory();
    this.layer.rebuildAll?.();
    this.onCommit();
    return true;
  }

  /** Stand stackers on their hosts (core/stackers.js): ONE undo step. A stacker sits OVER its
   *  host, so this never runs the floor-plan overlap check that placeInGap does. */
  addStackers(placements) {
    if (!placements || !placements.length) return 0;
    this.store.beginHistory();
    let n = 0;
    for (const p of placements) { this.store.addItem(p.code, { x: p.x, z: p.z, rotDeg: p.rotDeg }); n++; }
    this.store.endHistory();
    this.onCommit();
    return n;
  }

  /** Move cabinets to planned spots (core/mirror.js): ONE undo step. */
  applyMoves(moves) {
    if (!moves || !moves.length) return false;
    this.store.beginHistory();
    for (const m of moves) this.store.updateItem(m.id, { x: m.x, z: m.z }, { quiet: true });
    this.store.endHistory();
    this.layer.rebuildAll?.();
    this.onCommit();
    return true;
  }

  /** Stand a gap suggestion (core/gaps.js placementsFor) exactly where it says: ONE undo step.
   *  Each piece is checked first; if anything has moved into the gap since it was offered,
   *  nothing is added. */
  placeInGap(placements) {
    const b = this.room.bounds();
    let st = this.store.state;
    const virt = { ...st, items: [...st.items] };
    for (const [i, p] of placements.entries()) {
      const cab = getCab(p.code);
      if (!cab || !spotOk(virt, cab, p.x, p.z, p.rotDeg, b)) return null;
      virt.items.push({ id: `gap${i}`, ...p });
    }
    this.store.beginHistory();
    const added = placements.map((p) => this.store.addItem(p.code, { x: p.x, z: p.z, rotDeg: p.rotDeg, ...(p.island ? { island: true } : {}) }));
    this.store.endHistory();
    const last = added[added.length - 1];
    if (last) { this.layer.select(last.id); this.onSelect(last.id); }
    this.onCommit();
    return added;
  }

  _runEnd(wall, b) {
    const vert = wall === 'left' || wall === 'right';
    const along = (it) => (vert ? it.z : it.x);
    const min = (vert ? b.minZ : b.minX);
    let end = min;
    // a boxing (bulkhead) on this wall is part of the run: the next cabinet goes after it
    for (const bx of boxingBoxes(this.store.state.room || {})) if (bx.wall === wall) end = Math.max(end, bx.along1);
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
