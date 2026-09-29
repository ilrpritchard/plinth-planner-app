// backpanel.js — renders core/backpanels.js: one painted 22mm end panel across each exposed back
// (an island's or a peninsula's), floor to worktop, in the finish of the cabinets it covers (W2W-243).

import * as THREE from 'three';
import { paintMat } from './materials.js';

export class BackPanelLayer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'backPanels';
    scene.add(this.group);
  }

  clear() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose?.(); }
  }

  /** panels: computeBackPanels(state); hexOf(finishName) -> the paint colour. */
  rebuild(panels, hexOf) {
    this.clear();
    for (const p of panels) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.len, p.h, p.t), paintMat(hexOf(p.finish)));
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(p.x, p.h / 2, p.z);
      m.rotation.y = p.rotY;
      this.group.add(m);
    }
  }
}
