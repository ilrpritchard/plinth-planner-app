// filler.js — renders the auto-generated painted filler panels (closing a
// small gap between a base run and a wall). Painted to match the finish, so
// they recolour with everything else. Reflowed whenever the layout changes.

import * as THREE from 'three';
import { paintMat } from './materials.js';

export class FillerLayer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'fillers';
    scene.add(this.group);
  }

  clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.geometry?.dispose?.();
    }
  }

  /** fillers: [{ x, z, rotDeg, w, d, h }]; painted in finishHex. */
  rebuild(fillers, finishHex) {
    this.clear();
    const mat = paintMat(finishHex);
    for (const f of fillers) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(f.w, f.h, f.d), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(f.x, f.h / 2, f.z);
      m.rotation.y = THREE.MathUtils.degToRad(f.rotDeg || 0);
      this.group.add(m);
    }
  }
}
