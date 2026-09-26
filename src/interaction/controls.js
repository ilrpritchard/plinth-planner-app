// controls.js — pointer interaction: select, drag on the floor plane, snap,
// rotate, delete. Works with mouse and touch (pointer events). While dragging a
// cabinet, OrbitControls is suspended so the gestures don't fight.

import * as THREE from 'three';
import { snapPosition, settleCorners } from './snapping.js';
import { getCab, sizedShelfCode } from '../core/catalogue.js';
import { measureRun } from '../core/measure.js';
import { fmtIn, MOUNT } from '../core/units.js';
import { isOven, findOvenHost, housingCodeFor } from '../core/ovenseat.js';
import { findHoodSeat } from '../core/hoodseat.js';
import { bestBaseFor } from '../core/sinkspec.js';
import { spotOk, findFreeSpot } from '../core/placement.js';
import { boxingBoxes } from '../core/openings.js';
import { planFitToGap } from '../core/fitwidth.js';

export class PointerControls {
  constructor({ scene, cabinetLayer, room, store, onCommit, onSelect, onWallClick, onOpeningClick, onFitted }) {
    this.onFitted = onFitted || null;
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
  _wallRaw(hit, cab, p) {
    const b = this.room.bounds(), touch = cab.d / 2 + 0.25 + (cab.type === 'TALL' ? 1.18 : 0);
    const along = hit.along + (hit.wall === this.drag.wall ? this.drag.oa : 0);
    // the perpendicular comes from the pointer's own plane point, so the snap can offer "flush
    // with the tall" as well as "back on the wall"; the snap decides which
    return hit.wall === 'back' ? { x: along, z: p ? Math.min(Math.max(p.z + this.drag.oz, b.minZ + touch), b.minZ + touch + 30) : b.minZ + touch }
      : hit.wall === 'front' ? { x: along, z: p ? Math.max(Math.min(p.z + this.drag.oz, b.maxZ - touch), b.maxZ - touch - 30) : b.maxZ - touch }
      : hit.wall === 'left' ? { x: p ? Math.min(Math.max(p.x + this.drag.ox, b.minX + touch), b.minX + touch + 30) : b.minX + touch, z: along }
      : { x: p ? Math.max(Math.min(p.x + this.drag.ox, b.maxX - touch), b.maxX - touch - 30) : b.maxX - touch, z: along };
  }

  _rootItemId(obj) {
    let o = obj;
    while (o) { if (o.userData && o.userData.itemId != null) return o.userData.itemId; o = o.parent; }
    return null;
  }

  /** A cabinet just tapped in from the catalogue RIDES ON THE POINTER until the next click drops
   *  it, snapping as it goes (her ask 2026-09-25: "at the moment a cabinet drops in and kind of
   *  gets lost in the plan"). Esc puts it back where it was placed. On a phone: tap the tile, then
   *  tap where it goes. Returns true when the carry started. */
  carry(id) {
    const item = this.store.getItem(id); if (!item) return false;
    const cab = getCab(item.code); if (!cab) return false;
    if (this.drag) this._up();
    // the pointer maps onto a plane at the cabinet's own height, so a hung cabinet follows the
    // hand instead of lurching (see _down)
    const hung = cab.type === 'WALL' || cab.type === 'COUNTER' || cab.stacker;
    this.floor.constant = hung ? -((cab.mountY ?? MOUNT[cab.type] ?? 0) + Math.min(cab.h || 30, 30) / 2) : 0;
    this.drag = { id, ox: 0, oz: 0, carry: true, start: { x: item.x, z: item.z, rotDeg: item.rotDeg || 0 } };
    if (['WALL', 'COUNTER', 'TALL'].includes(cab.type) && !cab.corner) { this.drag.onWall = true; this.drag.wall = PointerControls._wallOf(item); this.drag.oa = 0; }
    this.store.beginHistory();             // tap-in + carry + drop = ONE undo step (placeNew ended its own)
    this.s.controls.enabled = false;
    this.el.style.cursor = 'grabbing';
    this.layer.select(id);
    return true;
  }

  _down(e) {
    if (e.button != null && e.button !== 0) return;
    if (this.drag && this.drag.carry) {    // the click that DROPS a carried cabinet, where the pointer is
      this._move(e);
      this._up();
      return;
    }
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
      if (hit && cab) ({ x: rawX, z: rawZ } = this._wallRaw(hit, cab, p));
    }
    this.drag.last = { x: rawX, z: rawZ };
    const snapped = snapPosition(this.store, this.drag.id, rawX, rawZ, this.room.bounds(), { noDeepen: !!this.drag.carry });   // a carried shelf keeps its depth
    // a CORNER unit is refused everywhere but a room corner, and the snap then holds it where it
    // was — so a carried one looked frozen (her report 2026-09-26). Carried, it rides the hand
    // anyway; the drop seats it in the nearest corner (see _up).
    if (this.drag.carry && snapped.flag === 'corner') {
      const b = this.room.bounds(), cab0 = getCab(this.store.getItem(this.drag.id)?.code);
      if (cab0) { snapped.x = Math.max(b.minX + cab0.w / 2, Math.min(b.maxX - cab0.w / 2, rawX)); snapped.z = Math.max(b.minZ + cab0.d / 2, Math.min(b.maxZ - cab0.d / 2, rawZ)); }
    }
    // an open shelf pulled forward gets deeper instead (snapping returns `depth`): swap to the sized code
    // and keep its back on the wall
    if (snapped.depth != null) {
      const it0 = this.store.getItem(this.drag.id), c0 = it0 && getCab(it0.code);
      if (c0 && Math.abs(c0.d - snapped.depth) >= 0.5) {
        const code = sizedShelfCode(c0.baseCode || c0.code, snapped.depth);
        this.store.swapItem(this.drag.id, code, { quiet: true });
        const nd = getCab(code).d, b = this.room.bounds(), r = ((snapped.rotDeg % 360) + 360) % 360;
        if (r === 0) snapped.z = b.minZ + 0.25 + nd / 2; else if (r === 180) snapped.z = b.maxZ - 0.25 - nd / 2;
        else if (r === 90) snapped.x = b.minX + 0.25 + nd / 2; else snapped.x = b.maxX - 0.25 - nd / 2;
      }
    }
    this.store.updateItem(this.drag.id, { x: snapped.x, z: snapped.z, rotDeg: snapped.rotDeg, ...(snapped.hostId != null ? { hostId: snapped.hostId } : {}) }, { quiet: true });
    this.drag.flag = snapped.flag || null;
    const RULE_MSG = {
      window: '✕ Cabinets can’t cover a window',
      cooker: '✕ Nothing hangs over the range or cooktop: a hood goes here, and shelves or uppers sit either side of it, 50mm clear of the cooker',
      sink: '✕ The sink sits in clear countertop. Keep it off talls & uppers',
      offwall: '✕ Wall, counter & tall cabinets sit against a wall',
      corner: '✕ A corner unit sits against a wall, its blank return toward the corner',
      oven: '✕ A wall oven lives in an oven housing of its size',
      hood: '✕ A range hood sits over the range or cooktop. Add one first',
      dishwasher: '✕ Nothing sits over the dishwasher: a sink needs a door or double base',
      blocked: '✕ No room here: it would overlap what is already there',
    };
    if (snapped.flag && snapped.flag.startsWith('cornerReturn:')) this._showRuleFlag(`✕ The blank return would run into the ${snapped.flag.slice(13)} on the other wall`, e);
    else if (snapped.flag) this._showRuleFlag(RULE_MSG[snapped.flag] || '✕ Not allowed there', e);
    else this._hideRuleFlag();
    this._showDims(this.drag.id, e);
  }

  _up() {
    if (!this.drag) return;
    const id = this.drag.id;
    const { flag, start, carry, last } = this.drag;
    this.drag = null;
    this.floor.constant = 0;
    this._hideDims();
    this._hideRuleFlag();
    this.s.controls.enabled = true;
    this.el.style.cursor = '';
    // a drop that broke a rule pings back to where the drag started, unless THAT spot breaks a
    // rule too (a cabinet stood in a window by an old layout, her screenshot 2026-09-25: every
    // drop sent it back into the glass). Then it goes to the first clear stretch instead.
    const it = this.store.getItem(id);
    if (it && flag && start && !flag.startsWith('cornerReturn:')) {
      const cab = getCab(it.code), b = this.room.bounds();
      let back = { x: start.x, z: start.z, rotDeg: start.rotDeg };
      if (cab && cab.corner && carry) {                       // a carried corner unit: the nearest corner seat
        const seat = this._cornerSeatNear(id, cab, last ? last.x : it.x, last ? last.z : it.z, b);
        if (seat) { back = seat; this._toastFree?.(cab, 'the nearest corner'); }
      } else if (cab && !cab.corner && !spotOk(this.store.state, cab, start.x, start.z, start.rotDeg, b, id)) {
        const spot = findFreeSpot(this.store.state, cab, b, PointerControls._wallOf({ rotDeg: start.rotDeg }), id);
        if (spot) { back = { x: spot.x, z: spot.z, rotDeg: spot.rotDeg }; this._toastFree?.(cab, spot.wall); }
      }
      this.store.updateItem(id, back, { quiet: false });   // a held corner unit keeps the joint it was held at
    }
    // commit (non-quiet) so worktop + cost refresh
    else if (it) this.store.updateItem(id, {}, { quiet: false });
    this._settle();
    // an open shelf or tray space CUT TO FIT the leftover beside it (core/fitwidth.js): dropped
    // touching one neighbour with a sliver to the next, it grows to close the sliver
    if (it && !flag) this.fitToGap(id);
    this.store.endHistory();
    this.onCommit();
  }

  /** Grow (or shrink) an open shelf / tray space into the space it stands in. Returns the plan or null. */
  fitToGap(id, opts = {}) {
    const it = this.store.getItem(id); const cab = it && getCab(it.code);
    if (!cab) return null;
    const m = measureRun(this.store, id, this.room.bounds());
    const plan = planFitToGap(cab, m, opts);
    if (!plan) return null;
    const horiz = ((it.rotDeg || 0) % 180) === 0;
    const rot = (((it.rotDeg || 0) % 360) + 360) % 360, dir = rot === 0 || rot === 90 ? 1 : -1;   // +along = +x on the back wall, +z on the left wall
    this.store.swapItem(id, plan.code, { quiet: true });
    this.store.updateItem(id, horiz ? { x: it.x + dir * plan.shift } : { z: it.z + dir * plan.shift }, { quiet: false });
    this.onFitted?.(plan, cab);
    return plan;
  }

  /** A corner unit pulled out to meet a deeper run dropped on its face (settleCorners), inside the
   *  same undo step as the drop that caused it. */
  _settle() { try { settleCorners(this.store, this.room.bounds(), { quiet: false }); } catch { /* never block a drop */ } }

  /** Every room corner a corner unit can sit in, tried through the snap itself (both ends of each
   *  wall, the unit turned to face into the room); the one nearest (px, pz) that the snap accepts. */
  _cornerSeatNear(id, cab, px, pz, b) {
    const it = this.store.getItem(id); if (!it) return null;
    const keep = { x: it.x, z: it.z, rotDeg: it.rotDeg || 0 };
    const ret = cab.type === 'FLOOR' ? 20 : 10, tries = [];
    for (const rot of [0, 90, 180, 270]) {
      const ends = rot % 180 === 0 ? [b.minX + cab.w / 2 + ret + 1, b.maxX - cab.w / 2 - ret - 1] : [b.minZ + cab.w / 2 + ret + 1, b.maxZ - cab.w / 2 - ret - 1];
      for (const a of ends) {
        const raw = rot === 0 ? { x: a, z: b.minZ + cab.d / 2 + 0.25 } : rot === 180 ? { x: a, z: b.maxZ - cab.d / 2 - 0.25 }
          : rot === 90 ? { x: b.minX + cab.d / 2 + 0.25, z: a } : { x: b.maxX - cab.d / 2 - 0.25, z: a };
        this.store.updateItem(id, { x: raw.x, z: raw.z, rotDeg: rot }, { quiet: true });
        const sn = snapPosition(this.store, id, raw.x, raw.z, b, { noFeature: true });
        if (!sn.flag && spotOk(this.store.state, cab, sn.x, sn.z, sn.rotDeg, b, id)) tries.push({ x: sn.x, z: sn.z, rotDeg: sn.rotDeg, d: Math.hypot(sn.x - px, sn.z - pz) });
      }
    }
    this.store.updateItem(id, keep, { quiet: true });
    tries.sort((p, q) => p.d - q.d);
    return tries[0] ? { x: tries[0].x, z: tries[0].z, rotDeg: tries[0].rotDeg } : null;
  }

  _toastFree(cab, wall) {
    const where = { back: 'the back wall', left: 'the left wall', right: 'the right wall', front: 'the front wall', floor: 'the floor, free-standing' }[wall] || wall || 'a clear stretch';
    const t = document.createElement('div'); t.className = 'toast';
    t.textContent = cab.corner
      ? `A corner unit lives in a room corner: the ${cab.code} went to ${where}. Drag it to another corner if that is the wrong one.`
      : `The ${cab.code} ${cab.desc} could not stay where it was either (a window or a door), so it is on ${where}. Drag it where it belongs.`;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
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
    if (e.key === 'Escape' && this.drag && this.drag.carry) {   // a carried cabinet goes back where it was placed
      this.drag.flag = 'cancelled'; this._up(); return;
    }
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
      this._settle();
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
    if (/cooktop/i.test(cab.desc || '') && !opts.plain) return this._placeCooktopBase(code, wall);
    // a range hood (or its cover, W26) goes straight over the cooker (core/hoodseat.js); with none, it waits on the wall
    if (cab.appliance === 'hood' || cab.hoodCover) {
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
        return { ...item, seated: true };
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
    this._settle();
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
    // ...and its 60cm hood, centred over the cooktop, 800mm up (core/hoodseat.js)
    const seat = findHoodSeat(this.store.state, host.x, host.z, null, getCab('AP23'));
    if (seat) this.store.addItem('AP23', { x: seat.x, z: seat.z, rotDeg: seat.rotDeg });
    this.store.endHistory();
    this.layer.select(host.id); this.onSelect(host.id); this.onCommit();
    return { ...host, ovenStack: [oven.code, 'AP22', 'AP23'] };
  }

  /** A cooktop base (F30 / F31: prepped for a 36" cooktop) arrives with its cooktop on the
   *  worktop (her ask 2026-09-22), the way the oven housing does. One undo step. */
  _placeCooktopBase(code, wall) {
    this.store.beginHistory();
    const base = this.placeNew(code, wall, { safe: true, plain: true });
    if (!base) { this.store.endHistory(); return null; }
    const host = this.store.getItem(base.id), hob = getCab(code).w >= 34 ? 'AP5' : getCab(code).w >= 29 ? 'AP4' : 'AP22';
    this.store.addItem(hob, { x: host.x, z: host.z, rotDeg: host.rotDeg || 0 });
    this.store.endHistory();
    this.layer.select(host.id); this.onSelect(host.id); this.onCommit();
    return { ...host, withCooktop: hob };
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
