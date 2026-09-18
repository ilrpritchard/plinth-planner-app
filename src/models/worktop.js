// worktop.js — representative worktop over the base (FLOOR) run.
//
// IMPORTANT: visual aid only — Plinth does not supply worktops, so nothing here
// is priced. All slab geometry (merging runs, extending to walls, covering the
// corner cabinet's blank return, and JOINING perpendicular runs so the surface
// turns every L/U corner without a missing wedge) is planned by the pure
// core/worktop-plan.js — this layer only renders the rectangles it returns.

import * as THREE from 'three';
import { worktopMat } from './materials.js';
import { SURFACE_Y } from './cabinet.js';
import { planWorktopSlabs, subtractSinkCutouts, sinkCornerFillets } from '../core/worktop-plan.js';

const THICK = 1.25;

export class Worktop {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'worktops';
    scene.add(this.group);
  }

  clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.geometry?.dispose?.();
    }
  }

  /** Rebuild from placed items. getCab(code)->catalogue; room gives wall bounds. */
  rebuild(items, getCab, defaultMat = 'marble', room = null) {
    this.clear();
    const planned = planWorktopSlabs(items, getCab, defaultMat, room);
    // an undermount is cut flush to a rounded bowl: stone fillets round each corner of the square hole
    for (const f of sinkCornerFillets(planned, items, getCab)) {
      const shape = new THREE.Shape(f.pts.map(([x, z]) => new THREE.Vector2(x, z)));
      const fillet = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false }), worktopMat(f.mat));
      fillet.rotation.x = Math.PI / 2;                    // shape y -> world z, extrude -> down
      fillet.position.y = SURFACE_Y;
      fillet.castShadow = true; fillet.receiveShadow = true;
      this.group.add(fillet);
    }
    for (const s of subtractSinkCutouts(planned, items, getCab)) {
      const w = s.x1 - s.x0, d = s.z1 - s.z0;
      if (w <= 0.05 || d <= 0.05) continue;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, THICK, d - 0.02), worktopMat(s.mat));
      slab.castShadow = true; slab.receiveShadow = true;
      slab.position.set((s.x0 + s.x1) / 2, SURFACE_Y - THICK / 2, (s.z0 + s.z1) / 2);
      this.group.add(slab);
    }
  }
}
