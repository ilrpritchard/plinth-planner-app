// Room.js — floor + two walls (back along -Z, left along -X) sized to the
// footprint. Floor finish and wall colour are configurable, and a window /
// door can be shown. Two walls give an L to plan against; islands sit free.
//
// Coordinate convention: room centred on the origin.
//   x ∈ [-w/2, +w/2]   z ∈ [-d/2, +d/2]   floor at y = 0.
//   BACK wall at z = -d/2,  LEFT wall at x = -w/2.

import * as THREE from 'three';
import { BRAND } from '../core/catalogue.js';
import { openingCenter, openingWidth } from '../core/openings.js';
import { makeFloorTexture, floorSurface } from './floorTexture.js';

const WALL_T = 4;
const KERB_H = 3;   // the footprint left behind by a wall that is hidden to let you see in

// key -> label + base colour; scene/floorTexture.js PAINT says how each is drawn.
// Keys are saved in designs: never rename one (tile / ash keep theirs).
export const FLOORS = {
  oak: { label: 'Oak', color: 0xc2a27b },
  ash: { label: 'Pale ash', color: 0xd9cab0 },
  walnut: { label: 'Walnut', color: 0x70503a },
  herringbone: { label: 'Oak herringbone', color: 0xbf9e74 },
  tile: { label: 'Limestone', color: 0xd7d1c4 },
  slate: { label: 'Slate', color: 0x5b5e61 },
  checker: { label: 'Checkerboard', color: 0x8c8b88 },
  terrazzo: { label: 'Terrazzo', color: 0xe5e0d5 },
  concrete: { label: 'Concrete', color: 0xb8b5ad },
};
export const WALLS = {
  white: { label: 'White', color: 0xf7f6f2 },     // plain white (her ask 2026-09-17); a hair off pure so it still shades
  chalk: { label: 'Chalk', color: 0xefe9db },
  warm: { label: 'Warm white', color: 0xe7ddca },
  clay: { label: 'Clay', color: 0xd9c4b0 },
  sage: { label: 'Sage', color: 0xc3c7b2 },
  bluegrey: { label: 'Blue gray', color: 0xb7c1c4 },
  charcoal: { label: 'Charcoal', color: 0x6f6f6e },
};

export class Room {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'room';
    scene.add(this.group);
    this.gridColor = new THREE.Color(BRAND.muted);
    this.dims = { width: 0, depth: 0, height: 0 };
    this.walls = {};            // { back, front, left, right } meshes
    this._hidden = new Set();   // walls the user has manually hidden
  }

  setGridVisible(v) { this._gridVisible = v; if (this.grid) this.grid.visible = v; }

  bounds() {
    const { width, depth } = this.dims;
    return {
      minX: -width / 2, maxX: width / 2,
      minZ: -depth / 2, maxZ: depth / 2,
      backZ: -depth / 2, leftX: -width / 2,
    };
  }

  build(opts) {
    const { width, depth, height } = opts;
    this.dims = { width, depth, height };
    const floorColor = (FLOORS[opts.floor] || FLOORS.oak).color;
    const wallColor = (WALLS[opts.wall] || WALLS.white).color;

    for (const c of [...this.group.children]) { this.group.remove(c); disposeDeep(c); }

    // procedurally textured floor (planks / tile / stone / concrete)
    // painting a floor costs ~0.2s, and the room rebuilds on every window nudge:
    // keep the texture while the floor and the footprint stay the same
    const floorKey = `${opts.floor}|${floorColor}|${width}x${depth}`;
    if (this._floorKey !== floorKey) {
      this._floorTex?.dispose?.();
      this._floorTex = makeFloorTexture(opts.floor, floorColor, width, depth);
      this._floorKey = floorKey;
    }
    const surf = floorSurface(opts.floor);
    const floorMat = new THREE.MeshStandardMaterial({
      map: this._floorTex, color: 0xffffff, roughness: surf.roughness, metalness: 0, envMapIntensity: surf.env,
    });
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 1, metalness: 0, side: THREE.DoubleSide });

    // floor
    const floor = mesh(new THREE.BoxGeometry(width, 1, depth), floorMat);
    floor.position.set(0, -0.5, 0); floor.receiveShadow = true; floor.name = 'floor';
    this.group.add(floor);

    // placement grid
    const grid = new THREE.GridHelper(Math.max(width, depth), Math.round(Math.max(width, depth) / 12), this.gridColor, this.gridColor);
    grid.material.opacity = 0.12; grid.material.transparent = true; grid.position.y = 0.03;
    grid.visible = this._gridVisible !== false;
    this.grid = grid;
    this.group.add(grid);

    // ---- four walls, corners closed (back/front run the full width PLUS the
    // side-wall thickness so there's no notch). Doorways cut a real hole so you
    // can see straight through (open cased opening). ----
    this._dims = { width, depth };
    this.walls = { back: [], front: [], left: [], right: [] };
    this.wallAttached = { back: [], front: [], left: [], right: [] }; // openings + boxings, hide with their wall
    const rdim = { width, depth };
    const ops = Array.isArray(opts.openings) ? opts.openings : [];
    const gapsFor = (name) => ops.filter((o) => o.type === 'doorway' && (o.wall || 'back') === name).map((o) => {
      const c = openingCenter(rdim, o), w = openingWidth(o, rdim);
      return { c0: c - w / 2, c1: c + w / 2, top: Math.min(82, height * 0.86) };
    });
    const ext = WALL_T; // corner extension for the back/front walls
    this._buildWall('back', 'x', -depth / 2 - WALL_T / 2, -(width / 2 + ext), width / 2 + ext, height, gapsFor('back'), wallMat);
    this._buildWall('front', 'x', depth / 2 + WALL_T / 2, -(width / 2 + ext), width / 2 + ext, height, gapsFor('front'), wallMat);
    this._buildWall('left', 'z', -width / 2 - WALL_T / 2, -depth / 2, depth / 2, height, gapsFor('left'), wallMat);
    this._buildWall('right', 'z', width / 2 + WALL_T / 2, -depth / 2, depth / 2, height, gapsFor('right'), wallMat);

    // ---- the FOOTPRINT of each wall: a low kerb that shows only while its wall is auto-hidden.
    // Without it a cabinet standing hard against a hidden wall looks like it is hanging off
    // the edge of the floor (her screenshot 2026-09-21: a tall at the end of a run, seen from
    // outside the right wall). Only for walls something stands against (core/placement.js
    // wallsInUse), so an open-plan front stays open. A doorway stays a gap in it. ----
    this.kerbs = { back: [], front: [], left: [], right: [] };
    const kerb = (name, axis, perp, start, end) => {
      let cursor = start;
      const seg = (c0, c1) => { if (c1 - c0 <= 0.5) return;
        const geo = axis === 'x' ? new THREE.BoxGeometry(c1 - c0, KERB_H, WALL_T) : new THREE.BoxGeometry(WALL_T, KERB_H, c1 - c0);
        const m = mesh(geo, wallMat); m.position.set(axis === 'x' ? (c0 + c1) / 2 : perp, KERB_H / 2, axis === 'x' ? perp : (c0 + c1) / 2);
        m.receiveShadow = true; m.visible = false; m.name = 'kerb-' + name; this.group.add(m); this.kerbs[name].push(m); };
      for (const g of [...gapsFor(name)].sort((p, q) => p.c0 - q.c0)) { seg(cursor, Math.max(start, g.c0)); cursor = Math.max(cursor, Math.min(end, g.c1)); }
      seg(cursor, end);
    };
    kerb('back', 'x', -depth / 2 - WALL_T / 2, -(width / 2 + ext), width / 2 + ext);
    kerb('front', 'x', depth / 2 + WALL_T / 2, -(width / 2 + ext), width / 2 + ext);
    kerb('left', 'z', -width / 2 - WALL_T / 2, -depth / 2, depth / 2);
    kerb('right', 'z', width / 2 + WALL_T / 2, -depth / 2, depth / 2);

    const openings = Array.isArray(opts.openings) ? opts.openings : [];
    for (const o of openings) this._addOpening(o, width, depth, height);

    // boxing-in: boxed pipe runs / bulkheads, finished in the wall colour
    for (const bx of (Array.isArray(opts.boxings) ? opts.boxings : [])) {
      this._addBoxing(bx, width, depth, height, wallMat);
    }
  }

  // Build one wall as solid segments with full-height gaps where doorways are,
  // plus a header lintel over each gap — a real walk-through opening.
  _buildWall(name, axis, perp, start, end, height, gaps, wallMat) {
    const sorted = [...gaps].sort((a, b) => a.c0 - b.c0);
    let cursor = start;
    for (const g of sorted) {
      const c0 = Math.max(start, g.c0), c1 = Math.min(end, g.c1);
      if (c0 - cursor > 0.5) this._wallBox(name, axis, perp, (cursor + c0) / 2, c0 - cursor, height, height / 2, wallMat);
      cursor = Math.max(cursor, c1);
      if (height - g.top > 0.5) this._wallBox(name, axis, perp, (c0 + c1) / 2, c1 - c0, height - g.top, (g.top + height) / 2, wallMat); // lintel
    }
    if (end - cursor > 0.5) this._wallBox(name, axis, perp, (cursor + end) / 2, end - cursor, height, height / 2, wallMat);
  }
  _wallBox(name, axis, perp, mid, len, h, yc, wallMat) {
    if (len <= 0.01 || h <= 0.01) return;
    const geo = axis === 'x' ? new THREE.BoxGeometry(len, h, WALL_T) : new THREE.BoxGeometry(WALL_T, h, len);
    const m = mesh(geo, wallMat);
    m.position.set(axis === 'x' ? mid : perp, yc, axis === 'x' ? perp : mid);
    m.receiveShadow = true; m.name = 'wall-' + name; m.userData.wall = name;
    this.group.add(m);
    (this.walls[name] = this.walls[name] || []).push(m);
  }

  // ---- wall visibility ----
  /** Every opening group (window/door/doorway) that can be clicked. */
  openingPickables() {
    const out = [];
    for (const arr of Object.values(this.wallAttached || {})) {
      for (const g of arr || []) if (g.userData?.openingId != null && g.visible) out.push(g);
    }
    return out;
  }

  /** Manually hide/show a wall; persists across auto-hide. */
  setWallHidden(name, hidden) {
    if (hidden) this._hidden.add(name); else this._hidden.delete(name);
  }
  isWallHidden(name) { return this._hidden.has(name); }

  /**
   * Auto-hide the walls between the camera and the room so you can always see
   * in (dolls-house view). A manually-hidden wall stays hidden; in 2D drawings
   * every wall shows.
   */
  updateWallVisibility(camPos, view, inUse = null) {
    const d = this._dims; if (!d) return;
    const drawing = view && view !== '3d';
    const auto = {
      back: drawing || camPos.z >= -d.depth / 2,   // hide when camera is behind it
      front: drawing || camPos.z <= d.depth / 2,
      left: drawing || camPos.x >= -d.width / 2,
      right: drawing || camPos.x <= d.width / 2,
    };
    // an ELEVATION looks at its wall from outside the room — the opposite wall
    // sits between the camera and the kitchen and must hide, or the view is a
    // blank plane. (Plan looks straight down, so all four can stay.)
    const THROUGH = { back: 'front', front: 'back', left: 'right', right: 'left' };
    if (drawing && THROUGH[view]) auto[THROUGH[view]] = false;
    for (const name of ['back', 'front', 'left', 'right']) {
      const vis = auto[name] && !this._hidden.has(name);
      for (const m of (this.walls[name] || [])) m.visible = vis;
      for (const m of ((this.wallAttached && this.wallAttached[name]) || [])) m.visible = vis;
      // hidden only so you can see in (never in a drawing, never a wall she hid herself): leave its footprint
      for (const m of ((this.kerbs && this.kerbs[name]) || [])) m.visible = !drawing && !auto[name] && !this._hidden.has(name) && (!inUse || inUse.has(name));
    }
  }

  _addBoxing(bx, width, depth, height, wallMat) {
    const wall = bx.wall || 'back';
    const horiz = wall === 'back' || wall === 'front';
    const wallLen = horiz ? width : depth;
    const w = THREE.MathUtils.clamp(bx.w || 8, 2, wallLen);
    const d = THREE.MathUtils.clamp(bx.d || 8, 2, 40);
    const h = THREE.MathUtils.clamp(bx.h || height, 4, height);
    const along = THREE.MathUtils.clamp(-wallLen / 2 + (bx.pos ?? 0.5) * wallLen, -wallLen / 2 + w / 2, wallLen / 2 - w / 2);
    let geo, x, z;
    if (wall === 'back') { geo = new THREE.BoxGeometry(w, h, d); x = along; z = -depth / 2 + d / 2; }
    else if (wall === 'front') { geo = new THREE.BoxGeometry(w, h, d); x = along; z = depth / 2 - d / 2; }
    else if (wall === 'right') { geo = new THREE.BoxGeometry(d, h, w); x = width / 2 - d / 2; z = along; }
    else { geo = new THREE.BoxGeometry(d, h, w); x = -width / 2 + d / 2; z = along; } // left
    const m = mesh(geo, wallMat);
    m.position.set(x, h / 2, z);
    m.name = 'boxing';
    this.group.add(m);
    (this.wallAttached[wall] = this.wallAttached[wall] || []).push(m);
  }

  // Render one opening (window / door / doorway) on the chosen wall. Built in a
  // local frame (width along X, faces +Z) then oriented to the wall so it sits
  // clear of the wall plane (no z-fighting).
  _addOpening(o, width, depth, height) {
    const wall = o.wall || 'back';
    const isWindow = o.type === 'window';
    const rdim = { width, depth };
    const w = openingWidth(o, rdim);
    const along = openingCenter(rdim, o);   // SAME maths the UI read-out uses
    let h = isWindow ? (o.hgt || Math.min(46, height * 0.45)) : Math.min(82, height * 0.86);
    let sill = isWindow ? (o.sill ?? Math.max(36, height * 0.42)) : 0;
    // keep the opening inside the wall (sill ≥ 0, head ≤ ceiling)
    sill = THREE.MathUtils.clamp(sill, 0, height - 6);
    h = THREE.MathUtils.clamp(h, 6, height - sill);
    const centerY = sill + h / 2;

    const g = this._buildOpening(o.type, w, h, { stool: isWindow && sill - 3.4 >= 40 });
    g.userData.openingId = o.id;              // clickable: edit / delete popup
    g.userData.openingType = o.type;
    const OFF = 1.0; // clear of the wall plane
    if (wall === 'back') { g.position.set(along, centerY, -depth / 2 + OFF); }
    else if (wall === 'front') { g.rotation.y = Math.PI; g.position.set(along, centerY, depth / 2 - OFF); }
    else if (wall === 'right') { g.rotation.y = -Math.PI / 2; g.position.set(width / 2 - OFF, centerY, along); }
    else { g.rotation.y = Math.PI / 2; g.position.set(-width / 2 + OFF, centerY, along); } // left
    this.group.add(g);
    (this.wallAttached[wall] = this.wallAttached[wall] || []).push(g);
  }

  _buildOpening(type, w, h, opts = {}) {
    const g = new THREE.Group();
    const cream = () => new THREE.MeshStandardMaterial({ color: 0xefe9da, roughness: 0.8 });
    if (type === 'window') {
      // A painted timber window, built like one: casing round the opening, a
      // sash frame set back inside it, mullions + a meeting rail, a stool and
      // apron under it, and daylight behind. EVERY face sits on its own plane.
      // The old one was a slab with a see-through pane whose front face shared
      // the slab's front plane, which z-fought (her report: "they flicker when
      // we scroll around"). The glass is an OPAQUE unlit daylight panel: there
      // is a wall behind it, so transparency only bought sorting trouble.
      const paint = cream();
      const CAS = 3.4, SASH = 1.7;
      const bar = (bw, bh, bd, x, y, z, shadow = true) => { const m = mesh(new THREE.BoxGeometry(bw, bh, bd), paint); m.position.set(x, y, z); m.castShadow = shadow; g.add(m); return m; };
      // casing (proud of the wall, front face z = 0.45)
      bar(CAS, h + 2 * CAS, 1.4, -(w / 2 + CAS / 2), 0, -0.25);
      bar(CAS, h + 2 * CAS, 1.4, w / 2 + CAS / 2, 0, -0.25);
      bar(w, CAS, 1.4, 0, h / 2 + CAS / 2, -0.25);
      bar(w, CAS, 1.4, 0, -(h / 2 + CAS / 2), -0.25);
      // daylight, recessed to the back of the reveal (z = -0.7)
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), daylightMat());
      glass.position.z = -0.7; g.add(glass);
      // sash frame, set back from the casing face (front face z = 0.05)
      const IN = 0.02;                                   // hairline inside the casing: no shared side planes
      bar(SASH, h - 2 * IN, 0.7, -(w / 2 - SASH / 2 - IN), 0, -0.3, false);
      bar(SASH, h - 2 * IN, 0.7, w / 2 - SASH / 2 - IN, 0, -0.3, false);
      bar(w - 2 * SASH, SASH, 0.7, 0, h / 2 - SASH / 2 - IN, -0.3, false);
      bar(w - 2 * SASH, SASH + 0.5, 0.7, 0, -(h / 2 - (SASH + 0.5) / 2 - IN), -0.3, false);
      // lights: one under 30", two to 66", three beyond; a meeting rail on anything tall enough.
      // Fronts step back 0.12" at a time (sash 0.05, rail -0.07, mullion -0.19) so nothing fights.
      const lights = w < 30 ? 1 : w < 66 ? 2 : 3;
      for (let i = 1; i < lights; i++) bar(1.3, h - 2 * SASH - 0.6, 0.5, -w / 2 + (w * i) / lights, 0, -0.44, false);
      if (h >= 30) bar(w - 2 * SASH - 0.04, 1.5, 0.6, 0, 0, -0.37, false);
      // stool (the inside sill) and the apron under it: only where the window
      // stands clear of a worktop. Over a counter the casing dies into the splash.
      if (opts.stool) {
        bar(w + 2 * CAS + 2.4, 1.1, 3.0, 0, -(h / 2 + CAS) - 0.55, 0.55);
        bar(w + 2 * CAS - 1, 2.6, 0.7, 0, -(h / 2 + CAS) - 1.1 - 1.3, -0.6);
      }
    } else if (type === 'doorway') {
      // an OPEN cased opening — just the casing/architrave, no leaf. The wall
      // itself is cut (see _buildWall) so you see straight through.
      const T = 3, jamb = 5;
      const cmat = cream();
      const lf = mesh(new THREE.BoxGeometry(T, h + T, jamb), cmat); lf.position.set(-w / 2 - T / 2, 0, 0);
      const rt = mesh(new THREE.BoxGeometry(T, h + T, jamb), cmat); rt.position.set(w / 2 + T / 2, 0, 0);
      const hd = mesh(new THREE.BoxGeometry(w + 2 * T, T, jamb), cmat); hd.position.set(0, h / 2 + T / 2, 0);
      for (const m of [lf, rt, hd]) m.castShadow = false;
      g.add(lf, rt, hd);
    } else { // door (with leaf)
      const frame = mesh(new THREE.BoxGeometry(w + 5, h + 5, 1.4), new THREE.MeshStandardMaterial({ color: 0xece5d4, roughness: 0.85 }));
      const leaf = mesh(new THREE.BoxGeometry(w, h, 0.8), new THREE.MeshStandardMaterial({ color: 0xd9cdb6, roughness: 0.7 }));
      leaf.position.z = 0.5;
      const knob = mesh(new THREE.SphereGeometry(0.8, 12, 10), new THREE.MeshStandardMaterial({ color: 0xb9962e, metalness: 0.8, roughness: 0.3 }));
      knob.position.set(w / 2 - 4, 0, 0.9);
      g.add(frame, leaf, knob);
    }
    return g;
  }
}

// Daylight behind a window: an unlit vertical gradient (sky at the head, a bright
// horizon glow toward the sill). One shared material; unlit so it never goes grey
// in the room's shade and never needs transparency sorting.
let _daylight = null;
function daylightMat() {
  if (_daylight) return _daylight;
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const ctx = c.getContext('2d'), grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#c6dcea'); grad.addColorStop(0.55, '#e0edf3'); grad.addColorStop(1, '#f6f9f7');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  _daylight = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  return _daylight;
}

function mesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; }
function disposeDeep(o) { o.traverse?.((c) => c.geometry?.dispose?.()); o.geometry?.dispose?.(); }
