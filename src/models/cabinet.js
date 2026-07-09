// cabinet.js — procedural Plinth cabinet builder.
//
// Authored FRONT facing +Z, base at y = 0, centred on x. Construction follows
// the spec: 22mm painted beech carcass, 22mm legs each side, 80mm shaker
// stiles/rails, FLUSH 115mm plinth, 18mm oak-veneer shelf, oak-lined interior.
// Doors are hinged groups so they can swing open.

import * as THREE from 'three';
import { SPEC, mmToIn } from '../core/units.js';
import {
  paintMat, oakMat, interiorMat, glassMat, brassMat,
  shadowMat, paintEdgeMat,
} from './materials.js';
import { makeKnob } from './knob.js';

const PANEL = SPEC.PANEL_IN;     // 22mm carcass
const LEG = SPEC.LEG_IN;         // 22mm legs
const PLINTH = SPEC.PLINTH_IN;   // 115mm flush plinth
const REVEAL = SPEC.REVEAL_IN;   // gap between faces
const HAIR = mmToIn(2);          // 2mm hairline reveal around flush drawer fronts
const STILE = SPEC.FRAME_IN;     // 80mm shaker stiles & rails
const SHELF = SPEC.SHELF_IN;     // 18mm oak shelf
const RECESS = mmToIn(8);        // shaker centre panel sits back 8mm from stiles/rails
const DOOR_T = 0.75;
const FRAME_T = 0.14;
const KNOB_INSET = 2.2;
export const OPEN_ANGLE = THREE.MathUtils.degToRad(105);

export const MOUNT = { FLOOR: 0, TALL: 0, WALL: 54, COUNTER: 36.5 };
export const SURFACE_Y = 36.5;

export function getMountY(cab) {
  if (typeof cab.mountY === 'number') return cab.mountY; // appliances carry their own
  return MOUNT[cab.type] ?? 0;
}

export function getFootprint(cab) {
  const ret = cab.corner ? (cab.type === 'FLOOR' ? 20 : 10) : 0;
  return { w: cab.w, d: cab.d, returnLeg: ret };
}

// ---- primitives ---------------------------------------------------------
function box(w, h, d, mat, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  if (name) m.name = name;
  return m;
}

// A thin rectangular ring of flat bars around a front piece — the visible
// "shadow gap". Bars are centred ON the piece's edges (half over the leaf,
// half over the gap/frame beside it) so a crisp dark reveal line appears at
// every junction. Static — attached to the carcass, never to a door pivot.
function edgeRing(parent, cx, cy, w, h, z, lw, depth, mat) {
  const mk = (bw, bh, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, depth), mat);
    m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = false;
    parent.add(m);
  };
  mk(w + lw, lw, cx, cy + h / 2);   // top
  mk(w + lw, lw, cx, cy - h / 2);   // bottom
  mk(lw, h - lw, cx - w / 2, cy);   // left
  mk(lw, h - lw, cx + w / 2, cy);   // right
}
// Reveal for a RECESSED front (doors sit 0.18 behind the carcass face): the
// ring floats in the reveal depth, in front of the leaf but behind the frame.
function revealRing(parent, cx, cy, w, h, doorFrontZ, lw = 0.17) {
  edgeRing(parent, cx, cy, w, h, doorFrontZ + 0.10, lw, 0.06, shadowMat());
}
// Reveal for a FLUSH front (drawer banks): a hairline ring a whisker proud.
function flushRing(parent, cx, cy, w, h, faceZ, lw = 0.11) {
  edgeRing(parent, cx, cy, w, h, faceZ + 0.02, lw, 0.03, shadowMat());
}

// A shaker leaf centred on its own origin, front face at +DOOR_T/2.
function shakerLeaf(w, h, mat, glazed, panels = 1) {
  const g = new THREE.Group();
  if (glazed) {
    // IDENTICAL construction to a plain door — full-depth stiles & rails with
    // the same 8mm-proud face frame, so glazed and plain doors sit in exactly
    // the same plane; ONLY the centre panel differs (glass instead of board)
    const innerH = Math.max(1, h - 2 * STILE);
    const top = box(w, STILE, DOOR_T, mat); top.position.set(0, h / 2 - STILE / 2, 0);
    const bot = box(w, STILE, DOOR_T, mat); bot.position.set(0, -h / 2 + STILE / 2, 0);
    const lf = box(STILE, innerH, DOOR_T, mat); lf.position.set(-w / 2 + STILE / 2, 0, 0);
    const rt = box(STILE, innerH, DOOR_T, mat); rt.position.set(w / 2 - STILE / 2, 0, 0);
    g.add(top, bot, lf, rt);
    const ft = RECESS + 0.12;
    addFrameRing(g, w, h, mat, DOOR_T / 2 + RECESS - ft / 2, ft);
    const glass = box(Math.max(2, w - 2 * STILE), Math.max(2, innerH), DOOR_T * 0.15, glassMat());
    glass.castShadow = false;
    g.add(glass);
  } else {
    // centre panel board (its front face is the recessed panel)
    g.add(box(w, h, DOOR_T, mat));
    // stiles & rails stand 8mm proud of the panel, embedded into the board behind
    const ft = RECESS + 0.12;
    addFrameRing(g, w, h, mat, DOOR_T / 2 + RECESS - ft / 2, ft);
    // shadow line where the recessed panel meets the stiles — a slightly darker
    // frame hugging the inside of the rails so the relief reads even in flat light
    const edge = paintEdgeMat('#' + mat.color.getHexString());
    edgeRing(g, 0, 0, Math.max(1, w - 2 * STILE), Math.max(1, h - 2 * STILE), DOOR_T / 2 + 0.02, 0.3, 0.04, edge);
    // tall 2-panel door: a proud mid-rail splits upper (1184) / lower (490) per
    // the PL/NTH spec, with a 200mm mid-rail band between them.
    if (panels === 2) {
      const interior = Math.max(2, h - 2 * STILE);
      const U = 1184, M = 200, L = 490, T = U + M + L;
      const midH = interior * M / T;
      const upperH = interior * U / T;
      const midY = (h / 2 - STILE) - upperH - midH / 2;
      const rail = box(w, midH, ft, mat);
      rail.position.set(0, midY, DOOR_T / 2 + RECESS - ft / 2);
      g.add(rail);
    }
  }
  return g;
}
function addFrameRing(g, w, h, mat, z, thick = FRAME_T) {
  const innerH = Math.max(1, h - 2 * STILE);
  const top = box(w, STILE, thick, mat); top.position.set(0, h / 2 - STILE / 2, z);
  const bot = box(w, STILE, thick, mat); bot.position.set(0, -h / 2 + STILE / 2, z);
  const lf = box(STILE, innerH, thick, mat); lf.position.set(-w / 2 + STILE / 2, 0, z);
  const rt = box(STILE, innerH, thick, mat); rt.position.set(w / 2 - STILE / 2, 0, z);
  for (const p of [top, bot, lf, rt]) { p.castShadow = true; g.add(p); }
}

// A vertical (door) or horizontal (drawer) bar pull, standing proud of the face.
function barPull(mat, vertical, span) {
  const g = new THREE.Group();
  const len = Math.max(3, Math.min(span * 0.45, vertical ? 9 : 7));
  const r = 0.18;
  const bar = box(vertical ? r * 2 : len, vertical ? len : r * 2, r * 2, mat);
  bar.position.z = 0.55;
  const s1 = box(r, r, 0.55, mat), s2 = box(r, r, 0.55, mat);
  if (vertical) { s1.position.set(0, len / 2 - 0.4, 0.27); s2.position.set(0, -len / 2 + 0.4, 0.27); }
  else { s1.position.set(len / 2 - 0.4, 0, 0.27); s2.position.set(-len / 2 + 0.4, 0, 0.27); }
  g.add(bar, s1, s2);
  return g;
}

// A hinged door. Handle per the chosen style on the leading (non-hinge) edge.
function hingedDoor(parent, doors, { w, h, mat, glazed, frontZ, hingeX, centerY, hingeSign, panels = 1, handle = 'knob', knobY = 0 }) {
  const pivot = new THREE.Group();
  pivot.position.set(hingeX, centerY, frontZ - DOOR_T / 2);
  const leaf = shakerLeaf(w, h, mat, glazed, panels);
  leaf.position.x = -hingeSign * (w / 2);   // body extends away from the hinge
  // handle on the LEADING (opening) edge — opposite the hinge — so a pair meets
  // in the middle and a single sits on its opening side.
  const edgeX = -hingeSign * (w / 2 - 1.4);
  if (handle === 'knob') { const k = makeKnob(mat); k.position.set(edgeX, knobY, DOOR_T / 2); leaf.add(k); }
  else if (handle === 'bar') { const b = barPull(mat, true, h); b.position.set(edgeX, knobY, DOOR_T / 2 - 0.1); leaf.add(b); }
  pivot.add(leaf);
  pivot.userData.openAngle = hingeSign * OPEN_ANGLE;
  parent.add(pivot);     // attach so the door actually renders
  // dark shadow-gap ring around the (closed) leaf — static, on the carcass,
  // so each door reads as a separate piece against its neighbours
  revealRing(parent, hingeX - hingeSign * (w / 2), centerY, w, h, frontZ);
  doors.push(pivot);
  return pivot;
}

// Flat drawer front with the chosen handle (painted to match the cabinet).
function flatDrawer(w, h, mat, frontZ, centerY, handle = 'knob') {
  const g = new THREE.Group();
  g.add(box(w, h, DOOR_T, mat));         // flat front, no shaker panel
  flushRing(g, 0, 0, w, h, DOOR_T / 2);  // hairline reveal so each face reads separate
  if (handle === 'knob') { const k = makeKnob(mat); k.position.set(0, 0, DOOR_T / 2); g.add(k); }
  else if (handle === 'bar') { const b = barPull(mat, false, w); b.position.set(0, 0, DOOR_T / 2 - 0.1); g.add(b); }
  g.position.set(0, centerY, frontZ - DOOR_T / 2);
  return g;
}

// ---- main builder -------------------------------------------------------
export function buildCabinet(cab, finishHex, opts = {}) {
  const g = new THREE.Group();
  g.name = `cab-${cab.code}`;
  const mat = paintMat(finishHex);
  const doors = [];

  const w = cab.w, d = cab.d, h = cab.h;
  const hasPlinth = cab.type === 'FLOOR' || cab.type === 'TALL';
  const pH = hasPlinth ? PLINTH : 0;
  const bodyY0 = pH;
  const bodyH = h - pH;
  const frontZ = d / 2;

  // ----- painted exterior shell -----
  // SKIN: a hairline setback on the outer sides so two butted carcasses never
  // share a plane — overlapping coplanar faces z-fight and render as flickering
  // dashed seams along every cabinet junction.
  const SKIN = 0.02;
  const shellW = w - 2 * SKIN;
  const left = box(PANEL, bodyH, d, mat); left.position.set(-shellW / 2 + PANEL / 2, bodyY0 + bodyH / 2, 0);
  const right = box(PANEL, bodyH, d, mat); right.position.set(shellW / 2 - PANEL / 2, bodyY0 + bodyH / 2, 0);
  const bottom = box(shellW, PANEL, d, mat); bottom.position.set(0, bodyY0 + PANEL / 2, 0);
  const top = box(shellW, PANEL, d, mat); top.position.set(0, h - PANEL / 2, 0);
  g.add(left, right, bottom, top);

  // ----- oak-veneer interior (always lined; visible when doors open) -----
  // A single-depth island's exposed back gets a PAINTED finished panel instead
  // of the oak carcass back, so it reads as a proper finished end.
  const inW = w - 2 * PANEL, inH = bodyH - 2 * PANEL, inD = d - PANEL;
  // the back sits BETWEEN the side panels (real carcass construction) — a
  // full-width back puts its oak side edges in the side panels' outer plane,
  // and the raw edge z-fights through the paint on any exposed side
  const back = box(shellW - 2 * PANEL, bodyH, PANEL, opts.backPanel ? mat : oakMat());
  back.position.set(0, bodyY0 + bodyH / 2, -d / 2 + PANEL / 2);
  g.add(back);
  // inset slightly so the oak faces sit just inside the cavity (no z-fighting
  // with the painted carcass inner faces)
  const liner = box(inW - 0.5, inH - 0.5, inD - 0.5, interiorMat());
  liner.position.set(0, bodyY0 + bodyH / 2, 0.25);
  liner.castShadow = false; liner.material = liner.material.clone(); liner.material.side = THREE.BackSide;
  g.add(liner);

  // ----- flush plinth (painted) -----
  if (hasPlinth) {
    // FLUSH plinth per the PL/NTH spec — the door bottom runs straight to the
    // floor with no shadow band or setback.
    const plinth = box(shellW, pH, d, mat);
    plinth.position.set(0, pH / 2, 0);
    g.add(plinth);
  }

  // ----- opening -----
  const openY0 = bodyY0 + PANEL;
  const openH = bodyH - 2 * PANEL;
  const openCenterY = openY0 + openH / 2;
  const faceW = w - 2 * LEG - 2 * REVEAL;     // door spans between the legs
  const doorFrontZ = frontZ - 0.18;           // doors recessed behind the legs

  const ctx = { mat, doors, faceW, openH, openCenterY, frontZ: doorFrontZ, frontFlush: frontZ, openY0, inW, inD, bodyY0, bodyTop: bodyY0 + bodyH, handle: opts.handle || 'knob', hinge: opts.hinge === 'R' ? 1 : -1 };
  const hasShelf = buildFront(g, cab, ctx);

  // ----- one 18mm oak shelf for door cabinets -----
  if (hasShelf) {
    const shelf = box(inW - 0.3, SHELF, inD - 1.2, oakMat());
    shelf.position.set(0, openCenterY, -0.2);
    g.add(shelf);
  }

  // ----- corner: a flat BLANK RETURN PANEL beside the door, sitting BEYOND the
  // cabinet toward the corner (per the PL/NTH spec). Floor return = 20", wall =
  // 10". Same painted finish, flush front, no door detail and no knob. A run can
  // then butt at 90° against it. -----
  if (cab.corner) {
    // DRAWN return length: sized from the actual distance to the adjacent
    // wall when known (opts.returnLen, see cornerReturnLength) so the panel
    // always meets the wall flush — no clipped geometry, no open corner.
    // Defaults to the SKU return (20" floor / 10" wall). A SKIN setback keeps
    // the tip clear of the wall plane (coplanar faces z-fight).
    const ret = Math.max(1, (opts.returnLen ?? (cab.type === 'FLOOR' ? 20 : 10)) - 2 * SKIN);
    const right = cab.cornerSide === 'right';
    const px = right ? (w / 2 + ret / 2) : (-w / 2 - ret / 2); // outboard of the door
    // carcass extension sits BEHIND the blank front face — never flush with it,
    // or the two coplanar fronts z-fight and the return renders as a streaky,
    // half-framed panel (the classic "corner cabinet looks wrong" artifact)
    const carc = box(ret, bodyH, d - DOOR_T - HAIR, mat);
    carc.position.set(px, bodyY0 + bodyH / 2, -(DOOR_T + HAIR) / 2); g.add(carc);
    // flat blank front face — FULL body height (plinth top → carcass top), one
    // clean panel with no rail bands, per the blank-return spec
    const face = box(Math.max(0.5, ret - HAIR), bodyH, DOOR_T, mat);
    face.position.set(px, bodyY0 + bodyH / 2, frontZ - DOOR_T / 2); g.add(face);
    flushRing(g, px, bodyY0 + bodyH / 2, Math.max(0.5, ret - HAIR), bodyH, frontZ);
    if (hasPlinth) {
      const ap = box(ret, pH, d, mat); ap.position.set(px, pH / 2, 0); g.add(ap);
    }
  }

  // (cornice is rendered by the separate CorniceLayer so it can follow the
  // exposed faces of a whole run — see models/cornice.js)

  g.userData = {
    code: cab.code, type: cab.type,
    footprint: getFootprint(cab),
    mountY: getMountY(cab),
    doors,            // hinged door pivots
    open: false,
  };
  return g;
}

/** Floating wall shelf — a solid oak board mounted on the wall. */
export function buildFloatingShelf(cab) {
  const g = new THREE.Group();
  g.name = `shelf-${cab.code}`;
  const board = box(cab.w, cab.h, cab.d, oakMat());
  board.position.set(0, cab.h / 2, 0);
  g.add(board);
  g.userData = {
    code: cab.code, type: 'SHELF',
    footprint: getFootprint(cab),
    mountY: getMountY(cab),
    doors: [],
  };
  return g;
}

// Returns true if a mid-height oak shelf should be added.
function buildFront(g, cab, ctx) {
  const { mat, doors, faceW, openH, openCenterY, frontZ, handle = 'knob' } = ctx;
  const form = cab.form;
  const cy = openCenterY;

  // tall single/larder/housing doors are 2-panel shaker (PL/NTH spec)
  const tallPanels = cab.type === 'TALL' ? 2 : 1;
  // knob placement (client spec): EVERY hinged door carries its knob at
  // MID-HEIGHT on the leading edge — never tucked into the top or bottom
  // corner. (Drawer knobs stay centred on each face.)
  const knobY = 0;
  const singleDoor = (glazed = false, panels = tallPanels, hs = ctx.hinge ?? -1) => {
    hingedDoor(g, doors, { w: faceW, h: openH, mat, glazed, frontZ, hingeX: hs * faceW / 2, centerY: cy, hingeSign: hs, panels, handle, knobY });
  };
  const doublePair = (glazed = false, panels = tallPanels) => {
    const dw = faceW / 2 - REVEAL / 2;
    hingedDoor(g, doors, { w: dw, h: openH, mat, glazed, frontZ, hingeX: -faceW / 2, centerY: cy, hingeSign: -1, panels, handle, knobY });
    hingedDoor(g, doors, { w: dw, h: openH, mat, glazed, frontZ, hingeX: faceW / 2, centerY: cy, hingeSign: +1, panels, handle, knobY });
  };
  // Larder: full-height doors (one for a single larder, a pair for a double).
  const larderDoors = (cols) => {
    if (cols === 1) { singleDoor(false, 2); return; }
    doublePair(false, 2);
  };
  // 3-drawer bank — 175:245:315 proportions, SMALLEST at top. Flush slab fronts
  // (NOT recessed like the shaker centre panel), with a 2mm hairline reveal all
  // round, filling from the plinth up to the top rail (no gap).
  const drawers = (faces) => {
    const drawerW = cab.w - 2 * LEG - 2 * HAIR;  // 2mm gap to each leg
    const slots = [...faces].reverse();          // bottom→top: 315, 245, 175
    const sum = slots.reduce((a, b) => a + b, 0);
    const bottom = ctx.bodyY0;                   // plinth top
    const top = ctx.bodyTop - PANEL;             // just below the carcass top rail
    const reveals = HAIR * (slots.length + 1);
    const avail = (top - bottom) - reveals;
    // dark backer behind the whole bank — the 2mm hairlines between faces show
    // a true recessed shadow instead of the pale interior
    const bp = box(drawerW + 1.0, top - bottom, 0.12, shadowMat());
    bp.position.set(0, (top + bottom) / 2, ctx.frontFlush - DOOR_T - 0.12);
    bp.castShadow = false; bp.receiveShadow = false;
    g.add(bp);
    let y = bottom + HAIR;
    for (const fr of slots) {
      const fh = (fr / sum) * avail;
      g.add(flatDrawer(drawerW, fh, mat, ctx.frontFlush, y + fh / 2, handle)); // flush with frame
      y += fh + HAIR;
    }
  };
  const openShelves = (n) => {
    for (let i = 1; i <= n; i++) {
      const sy = openCenterY - openH / 2 + (openH * i) / (n + 1);
      const sh = box(ctx.inW - 0.3, SHELF, ctx.inD - 1.2, oakMat());
      sh.position.set(0, sy, -0.2); g.add(sh);
    }
  };
  const stacked = (cols, glazedUpper, housing) => {
    const splitY = openCenterY - openH / 2 + openH * 0.6;
    const upperH = (openCenterY + openH / 2) - splitY - REVEAL;
    const lowerH = splitY - (openCenterY - openH / 2) - REVEAL;
    const colW = faceW / cols - REVEAL / 2;
    for (let c = 0; c < cols; c++) {
      const cx = cols === 1 ? 0 : (c === 0 ? -faceW / 4 : faceW / 4);
      const hingeSign = cols === 1 ? (ctx.hinge ?? -1) : (c === 0 ? -1 : +1);
      const hingeX = cx - hingeSign * colW / 2;
      if (housing) {
        const panel = box(colW, upperH, DOOR_T, mat);
        panel.position.set(cx, splitY + upperH / 2 + REVEAL / 2, frontZ - DOOR_T / 2); g.add(panel);
        revealRing(g, cx, splitY + upperH / 2 + REVEAL / 2, colW, upperH, frontZ);
      } else {
        hingedDoor(g, doors, { w: colW, h: upperH, mat, glazed: glazedUpper, frontZ, hingeX, centerY: splitY + upperH / 2 + REVEAL / 2, hingeSign, handle });
      }
      hingedDoor(g, doors, { w: colW, h: lowerH, mat, glazed: false, frontZ, hingeX, centerY: (openCenterY - openH / 2) + lowerH / 2, hingeSign, handle });
    }
  };

  switch (form) {
    case 'door': singleDoor(false); return true;
    case 'bin': {
      // PULL-OUT bin: a full-height shaker front on RUNNERS — it slides, it
      // never hinges. Knob dead-centre per the PL/NTH drawing. No open pivot.
      const leaf = shakerLeaf(faceW, openH, mat, false, 1);
      leaf.position.set(0, cy, frontZ - DOOR_T / 2);
      // knob centered on the TOP RAIL, exactly like the dishwasher panel
      const k = makeKnob(mat); k.position.set(0, openH / 2 - STILE / 2, DOOR_T / 2); leaf.add(k);
      g.add(leaf);
      revealRing(g, 0, cy, faceW, openH, frontZ);
      return false;
    }
    case 'corner': singleDoor(false, 1, cab.cornerSide === 'right' ? 1 : -1); return true; // hinge on the blank side
    case 'glazed': singleDoor(true); return true;
    case 'double': doublePair(false); return true;
    case 'glazedDouble': doublePair(true); return true;
    case 'drawers': drawers(SPEC.DRAWER_FACES_IN); return false;
    case 'open': openShelves(2); return false;
    case 'tray': return false;   // open slot for trays/boards to LEAN in — NO shelf
    case 'dishwasher': {
      // appliance DOOR PANEL only: it always sits BETWEEN two cabinets, so it
      // has no legs of its own — one full-width shaker panel from the plinth
      // up to a slim top rail, exactly like the F7 product drawing.
      const ph = (ctx.bodyTop - PANEL) - ctx.bodyY0 - HAIR;
      const leaf = shakerLeaf(cab.w - 2 * HAIR, ph, mat, false, 1);
      leaf.position.set(0, ctx.bodyY0 + HAIR + ph / 2, frontZ - DOOR_T / 2);
      const k = makeKnob(mat); k.position.set(0, ph / 2 - STILE / 2, DOOR_T / 2); leaf.add(k);
      g.add(leaf);
      revealRing(g, 0, ctx.bodyY0 + HAIR + ph / 2, cab.w - 2 * HAIR, ph, frontZ);
      return false;
    }
    case 'housing': {
      // fridge/freezer HOUSING: the shaker leaves are appliance FRONTS — they
      // clad the appliance, they never hinge open. Same 2-panel shaker look
      // (a single leaf, or a pair for w ≥ 40) with the handle at mid-height,
      // but static: no pivot, nothing in doors[], no interior shelf.
      const cols = cab.w >= 40 ? 2 : 1;
      const colW = cols === 1 ? faceW : faceW / 2 - REVEAL / 2;
      for (let c = 0; c < cols; c++) {
        const cx = cols === 1 ? 0 : (c === 0 ? -(faceW / 4 + REVEAL / 4) : (faceW / 4 + REVEAL / 4));
        const leaf = shakerLeaf(colW, openH, mat, false, 2);
        leaf.position.set(cx, cy, frontZ - DOOR_T / 2);
        // handle on the leading edge (a pair meets in the middle), mid-height
        const edgeX = cols === 1
          ? -(ctx.hinge ?? -1) * (colW / 2 - 1.4)
          : (c === 0 ? colW / 2 - 1.4 : -(colW / 2 - 1.4));
        if (handle === 'knob') { const k = makeKnob(mat); k.position.set(edgeX, 0, DOOR_T / 2); leaf.add(k); }
        else if (handle === 'bar') { const b = barPull(mat, true, openH); b.position.set(edgeX, 0, DOOR_T / 2 - 0.1); leaf.add(b); }
        g.add(leaf);
        revealRing(g, cx, cy, colW, openH, frontZ);
      }
      return false;
    }
    case 'ovenHousing': {
      // painted tall housing with an inset stainless wall oven at counter-to-
      // eye height: (bottom→top) hinged door · drawer-style panel · oven ·
      // blank painted panel up to the top rail. Neutral steels only.
      const steel = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, metalness: 0.85, roughness: 0.3 });
      const steelDk = new THREE.MeshStandardMaterial({ color: 0x8f959b, metalness: 0.85, roughness: 0.35 });
      const dkGlass = new THREE.MeshStandardMaterial({ color: 0x131518, metalness: 0.3, roughness: 0.15 });
      const y0 = openCenterY - openH / 2, openTop = openCenterY + openH / 2;
      const doorH = openH * 0.26;                    // low cupboard door
      const drawH = openH * 0.09;                    // slim drawer-style panel
      const ovenH = 29;                              // 24" single wall oven front
      hingedDoor(g, doors, { w: faceW, h: doorH, mat, glazed: false, frontZ, hingeX: (ctx.hinge ?? -1) * faceW / 2, centerY: y0 + doorH / 2, hingeSign: ctx.hinge ?? -1, handle });
      g.add(flatDrawer(faceW, drawH - REVEAL, mat, ctx.frontFlush, y0 + doorH + REVEAL + (drawH - REVEAL) / 2, handle));
      const oy0 = y0 + doorH + drawH + 2 * REVEAL;   // oven fascia bottom (~33")
      const fascia = box(faceW, ovenH, 0.6, steel); fascia.position.set(0, oy0 + ovenH / 2, frontZ - 0.3); g.add(fascia);
      const win = box(faceW - 4, ovenH * 0.5, 0.3, dkGlass); win.position.set(0, oy0 + ovenH * 0.37, frontZ + 0.05); win.castShadow = false; g.add(win);
      const strip = box(faceW - 4, 2.0, 0.25, steelDk); strip.position.set(0, oy0 + ovenH - 2.4, frontZ + 0.05); strip.castShadow = false; g.add(strip);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, faceW - 6, 12), steel);
      rail.rotation.z = Math.PI / 2; rail.position.set(0, oy0 + ovenH * 0.72, frontZ + 1.0); rail.castShadow = true; g.add(rail);
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.2, 8), steel);
        post.rotation.x = Math.PI / 2; post.position.set(sx * (faceW - 7) / 2, oy0 + ovenH * 0.72, frontZ + 0.45); g.add(post);
      }
      const bh = Math.max(0.5, openTop - (oy0 + ovenH + REVEAL));
      const blank = box(faceW, bh, DOOR_T, mat); blank.position.set(0, oy0 + ovenH + REVEAL + bh / 2, frontZ - DOOR_T / 2); g.add(blank);
      revealRing(g, 0, oy0 + ovenH + REVEAL + bh / 2, faceW, bh, frontZ);
      return false;
    }
    case 'larder': larderDoors(cab.w >= 40 ? 2 : 1); return true; // full-height door(s)
    case 'larderDrawers': {
      const baseH = openH * 0.4;
      const drawerW = cab.w - 2 * LEG - 2 * HAIR;
      const faces = SPEC.DRAWER_FACES_IN; const sum = faces.reduce((a, b) => a + b, 0);
      const avail = baseH - HAIR * 4;
      const slots = [...faces].reverse(); // largest at bottom, smallest at top
      let y = openCenterY - openH / 2 + HAIR;
      for (const fr of slots) { const fh = (fr / sum) * avail; g.add(flatDrawer(drawerW, fh, mat, ctx.frontFlush, y + fh / 2, handle)); y += fh + HAIR; } // flush
      const doorH = openH - baseH - REVEAL;
      const doorCenter = (openCenterY - openH / 2) + baseH + REVEAL + doorH / 2;
      const cols = cab.w >= 40 ? 2 : 1; const colW = faceW / cols - REVEAL / 2;
      for (let c = 0; c < cols; c++) {
        const cx = cols === 1 ? 0 : (c === 0 ? -faceW / 4 : faceW / 4);
        const hingeSign = cols === 1 ? -1 : (c === 0 ? -1 : +1);
        hingedDoor(g, doors, { w: colW, h: doorH, mat, glazed: false, frontZ, hingeX: cx - hingeSign * colW / 2, centerY: doorCenter, hingeSign, handle });
      }
      return false;
    }
    default: singleDoor(false); return true;
  }
}
