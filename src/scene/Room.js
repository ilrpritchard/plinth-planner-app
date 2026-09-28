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
import { makeFloorTexture, makeFloorRoughness, floorSurface } from './floorTexture.js';
import { cityCanvas } from './cityView.js';

const WALL_T = 4;
const KERB_H = 3;   // the footprint left behind by a wall that is hidden to let you see in

// key -> label + base colour; scene/floorTexture.js PAINT says how each is drawn.
import { FLOORS, WALLS, WALL_PAINT, CEILING } from '../core/roomstyle.js';
export { FLOORS, WALLS };   // the tables live in core/roomstyle.js (shared with the DXF export)

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
    this._wallColor = wallColor;

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
    this._floorMat = floorMat; this._floorArgs = [opts.floor, floorColor, width, depth]; this._floorRough = surf.roughness;
    if (this._floorRoughKey !== floorKey) { this._floorRoughTex?.dispose?.(); this._floorRoughTex = null; this._floorRoughKey = floorKey; }
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, ...WALL_PAINT, side: THREE.DoubleSide });
    wallMat.userData.wallPaint = true;        // photo mode gives every wall-paint material its matte variation   // WALL_PAINT: the plaster hood is lit the same

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
    // the wall itself is also OPEN behind every window (sill to head), so photo mode's sun comes in
    // through it and the view goes out through it; in the live planner the window's daylight panel
    // covers the hole exactly, so it looks as it always did (render step 4, 2026-09-28)
    const wallGapsFor = (name) => [
      ...gapsFor(name).map((g) => ({ ...g, y0: 0, y1: g.top })),
      ...ops.filter((o) => o.type === 'window' && (o.wall || 'back') === name).map((o) => {
        const c = openingCenter(rdim, o), w = openingWidth(o, rdim), { sill, h } = windowSpan(o, height);
        return { c0: c - w / 2, c1: c + w / 2, y0: sill, y1: sill + h };
      }),
    ];
    const ext = WALL_T; // corner extension for the back/front walls
    this._buildWall('back', 'x', -depth / 2 - WALL_T / 2, -(width / 2 + ext), width / 2 + ext, height, wallGapsFor('back'), wallMat);
    this._buildWall('front', 'x', depth / 2 + WALL_T / 2, -(width / 2 + ext), width / 2 + ext, height, wallGapsFor('front'), wallMat);
    this._buildWall('left', 'z', -width / 2 - WALL_T / 2, -depth / 2, depth / 2, height, wallGapsFor('left'), wallMat);
    this._buildWall('right', 'z', width / 2 + WALL_T / 2, -depth / 2, depth / 2, height, wallGapsFor('right'), wallMat);

    // PHOTO MODE ONLY: the ceiling (a closed room for the photographs); hidden in the live planner
    // inside the walls, not over them: over them its underside shared a plane with the (double-sided)
    // wall tops and they z-fought along every wall-ceiling line
    this.ceiling = mesh(new THREE.BoxGeometry(width, WALL_T, depth), ceilingMat());
    this.ceiling.position.set(0, height + WALL_T / 2, 0);
    this.ceiling.castShadow = false; this.ceiling.visible = false; this.ceiling.name = 'ceiling';
    this.group.add(this.ceiling);
    this._height = height;
    this._openings = ops;
    this._cityPlanes = null;
    if (this._closed) this.setPhotoClosed(this._closed);   // a rebuild in photo mode stays closed
    if (this._photoDetail) this.setPhotoDetail(true);

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
        m.castShadow = false; m.receiveShadow = true; m.visible = false; m.name = 'kerb-' + name; this.group.add(m); this.kerbs[name].push(m); };
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

  // Build one wall as ONE solid: its elevation as a shape (doorways notched out of the bottom, windows
  // as holes), extruded to the wall's thickness. It used to be butted boxes, and the pieces over and
  // under an opening met the full-height wall in T-junctions that rasterise with hairline cracks (a
  // dashed light line down the wall); a single triangulated shape has no joins to crack.
  _buildWall(name, axis, perp, start, end, height, gaps, wallMat) {
    const sorted = [...gaps].sort((a, b) => a.c0 - b.c0), keep = [];
    let cursor = start;
    for (const g of sorted) {
      const c0 = Math.max(start + 0.5, g.c0), c1 = Math.min(end - 0.5, g.c1);
      if (c0 < cursor - 0.01 || c1 - c0 <= 0.5) continue;            // overlapping openings: the first one wins
      keep.push({ c0, c1, y0: g.y0 > 0.5 ? g.y0 : 0, y1: Math.min(g.y1, height - 0.5) });
      cursor = c1;
    }
    // the outline, counter-clockwise from the bottom-left, with a notch for every doorway
    const shape = new THREE.Shape();
    shape.moveTo(start, 0);
    for (const g of keep) if (g.y0 === 0) { shape.lineTo(g.c0, 0); shape.lineTo(g.c0, g.y1); shape.lineTo(g.c1, g.y1); shape.lineTo(g.c1, 0); }
    shape.lineTo(end, 0); shape.lineTo(end, height); shape.lineTo(start, height); shape.lineTo(start, 0);
    for (const g of keep) if (g.y0 > 0) {
      const h = new THREE.Path(); h.moveTo(g.c0, g.y0); h.lineTo(g.c1, g.y0); h.lineTo(g.c1, g.y1); h.lineTo(g.c0, g.y1); h.lineTo(g.c0, g.y0);
      shape.holes.push(h);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: WALL_T, bevelEnabled: false, curveSegments: 1 });
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 96, uv.getY(i) / 96);   // a paint texture tile = 8'
    const m = mesh(geo, wallMat);
    // the shape lies in local x (along the wall) / y, extruded along local +z
    if (axis === 'x') m.position.set(0, 0, perp - WALL_T / 2);
    else { m.rotation.y = -Math.PI / 2; m.position.set(perp + WALL_T / 2, 0, 0); }   // local x -> world +z, extrusion -> world -x
    m.castShadow = false; m.receiveShadow = true; m.name = 'wall-' + name; m.userData.wall = name;
    this.group.add(m);
    (this.walls[name] = this.walls[name] || []).push(m);
  }

  /** PHOTO MODE (render step 5): a timber floor gets its per-board roughness (floorTexture.js
   *  makeFloorRoughness, built the first time and kept while the floor and footprint stay the same). */
  setPhotoDetail(on) {
    this._photoDetail = !!on;
    const m = this._floorMat; if (!m) return;
    if (on && !this._floorRoughTex && this._floorArgs) this._floorRoughTex = makeFloorRoughness(...this._floorArgs);
    const tex = on ? this._floorRoughTex : null;
    if (m.roughnessMap === tex) return;
    m.roughnessMap = tex;
    m.roughness = tex ? Math.min(1, this._floorRough / 0.83) : this._floorRough;   // the map averages ~0.83
    m.needsUpdate = true;
  }

  // ---- PHOTO MODE: the closed room (render step 4, 2026-09-28) ----
  /** closed = false | { sun: bool }. Closed: the ceiling and all four walls (with what hangs on them)
   *  show, the kerbs hide, each window's daylight panel gives way to the view outside (cityView.js,
   *  on a plane beyond the wall) and, with sun, the walls, ceiling and glazing bars cast shadows so
   *  the only direct light is what comes in through the window. Open again puts the live cut-away
   *  back exactly (the next updateWallVisibility call re-hides whatever the camera is behind). */
  setPhotoClosed(closed) {
    this._closed = closed || null;
    const on = !!closed, sun = !!(closed && closed.sun);
    if (this.ceiling) { this.ceiling.visible = on; this.ceiling.castShadow = sun; }
    for (const name of ['back', 'front', 'left', 'right']) {
      for (const m of this.walls[name] || []) { if (on) m.visible = true; m.castShadow = sun; }
      for (const g of this.wallAttached?.[name] || []) {
        if (on) g.visible = true;
        g.traverse((m) => {
          if (m.userData.daylight) m.visible = !on;
          if (m.userData.photoShadow) m.castShadow = sun;
        });
      }
      for (const m of this.kerbs?.[name] || []) if (on) m.visible = false;
    }
    if (on && !this._cityPlanes) this._buildCityPlanes();
    for (const p of this._cityPlanes || []) p.visible = on;
  }

  /** One plane per wall that has a window, 20' beyond it, big enough to fill any view out; and a
   *  short hall behind every doorway. */
  _buildCityPlanes() {
    this._cityPlanes = [];
    const cv = cityCanvas(); if (!cv) return;
    if (!_cityMat) { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; _cityMat = new THREE.MeshBasicMaterial({ map: t, toneMapped: false }); }
    const { width, depth } = this._dims, DIST = 240, PW = 1400, PH = PW / 2;
    const walls = new Set((this._openings || []).filter((o) => o.type === 'window').map((o) => o.wall || 'back'));
    for (const wall of walls) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), _cityMat);
      p.castShadow = false; p.receiveShadow = false; p.name = 'city-view'; p.visible = false;
      // the horizon of the painting (45% down) at about eye height
      const y = 60 + PH * (0.5 - 0.45);
      if (wall === 'back') { p.position.set(0, y, -depth / 2 - DIST); }
      else if (wall === 'front') { p.rotation.y = Math.PI; p.position.set(0, y, depth / 2 + DIST); }
      else if (wall === 'left') { p.rotation.y = Math.PI / 2; p.position.set(-width / 2 - DIST, y, 0); }
      else { p.rotation.y = -Math.PI / 2; p.position.set(width / 2 + DIST, y, 0); }
      this.group.add(p); this._cityPlanes.push(p);
    }
    // a doorway leads into the next room, not onto the street: a short hall behind it (an open box in
    // the wall paint, seen from inside), so the view through it stops at a wall a few feet away
    const hallMat = new THREE.MeshStandardMaterial({ color: this._wallColor ?? 0xf3efe6, ...WALL_PAINT, side: THREE.BackSide });
    hallMat.userData.wallPaint = true;
    for (const o of (this._openings || []).filter((q) => q.type === 'doorway')) {
      const wall = o.wall || 'back', rd = { width, depth }, c = openingCenter(rd, o), w = openingWidth(o, rd), HD = 42, H = this._height || 96;
      // from the wall's inside face outward, so its floor also covers the threshold (the wall's 4")
      const box = new THREE.Mesh(new THREE.BoxGeometry(w + 36, H, HD + WALL_T), hallMat);
      box.castShadow = false; box.receiveShadow = true; box.name = 'photo-hall'; box.visible = false;
      const off = (HD + WALL_T) / 2;
      if (wall === 'back') box.position.set(c, H / 2, -depth / 2 - off);
      else if (wall === 'front') box.position.set(c, H / 2, depth / 2 + off);
      else if (wall === 'left') { box.rotation.y = Math.PI / 2; box.position.set(-width / 2 - off, H / 2, c); }
      else { box.rotation.y = Math.PI / 2; box.position.set(width / 2 + off, H / 2, c); }
      this.group.add(box); this._cityPlanes.push(box);
    }
  }

  // ---- wall visibility ----
  /** Light the clicked opening for a moment (its casing and frame glow the accent green), so
   *  "which window" is answered in 3D as well as on its card (2026-09-25). Materials are swapped for
   *  lit clones and put back, so shared materials on the other openings are untouched. */
  flashOpening(id, ms = 1400) {
    const g = Object.values(this.wallAttached || {}).flat().find((x) => x && x.userData?.openingId === id);
    if (!g) return;
    const swapped = [];
    g.traverse((m) => {
      if (!m.isMesh || !m.material || !m.material.emissive || m.userData.pickOnly) return;
      const lit = m.material.clone(); lit.emissive.set(0x645b3d); lit.emissiveIntensity = 0.55;
      swapped.push([m, m.material]); m.material = lit;
    });
    if (this._flashTimer) clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { for (const [m, mat] of swapped) { if (m.material !== mat) { m.material.dispose?.(); m.material = mat; } } }, ms);
  }

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
    if (this._closed) return;                 // photo mode's closed room: every wall stays up (setPhotoClosed)
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
    const { sill, h } = isWindow ? windowSpan(o, height) : { sill: 0, h: Math.min(82, height * 0.86) };
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
      const bar = (bw, bh, bd, x, y, z, shadow = true) => { const m = mesh(new THREE.BoxGeometry(bw, bh, bd), paint); m.position.set(x, y, z); m.castShadow = shadow; if (!shadow) m.userData.photoShadow = true; g.add(m); return m; };
      // casing (proud of the wall, front face z = 0.45)
      bar(CAS, h + 2 * CAS, 1.4, -(w / 2 + CAS / 2), 0, -0.25);
      bar(CAS, h + 2 * CAS, 1.4, w / 2 + CAS / 2, 0, -0.25);
      bar(w, CAS, 1.4, 0, h / 2 + CAS / 2, -0.25);
      bar(w, CAS, 1.4, 0, -(h / 2 + CAS / 2), -0.25);
      // daylight, recessed to the back of the reveal (z = -0.7)
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), daylightMat());
      glass.position.z = -0.7; glass.userData.daylight = true; g.add(glass);
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
      // an unseen pane filling the opening, so a click THROUGH the doorway still picks it (the wall
      // is cut there, so without this the click fell to the floor beyond and nothing answered):
      // "same for doors and doorways when i click them" (2026-09-25). Rays hit it, eyes and shadows don't.
      const pick = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      pick.castShadow = false; pick.receiveShadow = false; pick.userData.pickOnly = true; g.add(pick);
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

/** A window's sill and height, kept inside the wall (sill >= 0, head <= ceiling). The ONE place: the
 *  window drawn on the wall and the hole cut behind it read the same numbers. */
function windowSpan(o, height) {
  const sill = THREE.MathUtils.clamp(o.sill ?? Math.max(36, height * 0.42), 0, height - 6);
  const h = THREE.MathUtils.clamp(o.hgt || Math.min(46, height * 0.45), 6, height - sill);
  return { sill, h };
}

// The ceiling (photo mode only): flat matte paint in a warm white, the walls' own lighting numbers.
let _ceiling = null, _cityMat = null;
function ceilingMat() {
  if (_ceiling) return _ceiling;
  _ceiling = new THREE.MeshStandardMaterial({ color: CEILING, ...WALL_PAINT });
  _ceiling.userData.wallPaint = true;
  return _ceiling;
}

function mesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; }
function disposeDeep(o) { o.traverse?.((c) => c.geometry?.dispose?.()); o.geometry?.dispose?.(); }
