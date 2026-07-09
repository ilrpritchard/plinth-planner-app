// cornice.js (3D) — renders the cornice/crown moulding from planCornice().
//
// Each straight run is a strip that runs along local +X for `length`, sits with
// its bottom on the cabinet top, and protrudes +Z (outward). At every external
// corner a mitre/return piece extrudes the same profile around the corner so the
// moulding wraps continuously instead of leaving a gap. Painted to match.

import * as THREE from 'three';
import { paintMat } from './materials.js';
import { planCornice } from '../core/cornice.js';

const mmToIn = (mm) => mm / 25.4;
const OVER = 0.3;                 // sits this far back over the cabinet top
const PROUD = mmToIn(15);         // 15mm proud of the door face (plain)
const BAR = mmToIn(22);           // 22mm bar (plain)

// A profile is a stack of layers. Each layer: outer (how far beyond the face it
// reaches), h (height), yc (centre height), depth (front-to-back size for the
// strip box), zc (centre of that depth). Shared by strips AND corner returns so
// the two always line up.
const PROFILES = {
  plain: [
    { outer: PROUD, h: BAR, yc: BAR / 2, depth: PROUD + OVER, zc: (PROUD - OVER) / 2, bead: mmToIn(5) },
  ],
  decorative: [
    { outer: 0.55, h: 0.6, yc: 0.30, depth: 0.9, zc: 0.10 },
    { outer: 1.185, h: 0.75, yc: 0.95, depth: 1.45, zc: 0.46 },
    { outer: 1.32, h: 0.28, yc: 1.46, depth: 1.6, zc: 0.52 },
  ],
};

export class CorniceLayer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'cornice';
    scene.add(this.group);
  }

  clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse?.((o) => o.geometry?.dispose?.());
    }
  }

  /** Rebuild from the layout. hex = painted finish to match the cabinets. */
  rebuild(state, hex) {
    this.clear();
    const { segments, corners, drops, profile } = planCornice(state);
    if (!segments || !segments.length) return;
    const layers = PROFILES[profile] || PROFILES.plain;
    const mat = paintMat(hex);

    for (const s of segments) {
      const strip = makeStrip(s.length, layers, mat);
      strip.position.set(s.x, s.topY, s.z);
      strip.rotation.y = s.angle;
      this.group.add(strip);
    }
    for (const c of corners || []) {
      const piece = makeCorner(layers, c.sx, c.sz, mat);
      piece.position.set(c.x, c.topY, c.z);
      piece.rotation.y = c.angle;
      this.group.add(piece);
    }
    // vertical connectors: where an upper's cornice dies into a tall, a board
    // runs down the tall's flank joining the two cornice levels.
    const barH = layers.reduce((m, L) => Math.max(m, L.yc + L.h / 2), BAR);
    for (const d of (drops || [])) {
      const h = (d.y1 + barH) - d.y0;
      const board = new THREE.Mesh(new THREE.BoxGeometry(d.len, h, PROUD), mat);
      board.castShadow = true; board.receiveShadow = true;
      board.position.set(d.x + Math.sin(d.angle) * (PROUD / 2), d.y0 + h / 2, d.z + Math.cos(d.angle) * (PROUD / 2));
      board.rotation.y = d.angle;
      this.group.add(board);
    }
  }
}

function boxAt(sx, sy, sz, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// straight run: profile runs along X (length), protrudes +Z, bottom on the top.
function makeStrip(len, layers, mat) {
  const g = new THREE.Group();
  for (const L of layers) {
    g.add(boxAt(len, L.h, L.depth, 0, L.yc, L.zc, mat));
    if (L.bead) {
      const bead = new THREE.Mesh(new THREE.CylinderGeometry(L.bead, L.bead, len, 16), mat);
      bead.rotation.z = Math.PI / 2;
      bead.position.set(0, L.h - L.bead * 0.4, L.zc + L.depth / 2 - L.bead * 0.4);
      g.add(bead);
    }
  }
  return g;
}

// corner return: extrude each layer outward along the two local axes (signs
// sx, sz) so the moulding turns the corner. Sits flush against the two strips.
function makeCorner(layers, sx, sz, mat) {
  const g = new THREE.Group();
  for (const L of layers) {
    const side = L.outer;                 // the outer square that the strips leave open
    g.add(boxAt(side, L.h, side, sx * side / 2, L.yc, sz * side / 2, mat));
  }
  return g;
}
