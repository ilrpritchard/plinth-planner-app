// decor.js — the "someone lives here" layer: stools under a breakfast-bar
// overhang. (Pendants and props were tried and retired — too much clutter.)
// Everything procedural, rebuilt with the layout. Purely visual, unpriced.

import * as THREE from 'three';
import { SURFACE_Y } from './cabinet.js';

const mDark = () => new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.45, metalness: 0.6 });
const mOakTop = () => new THREE.MeshStandardMaterial({ color: 0xb08a55, roughness: 0.7 });
const mCeramic = () => new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.4 });
const mGreen = () => new THREE.MeshStandardMaterial({ color: 0x6b7a4d, roughness: 0.7 });

export class DecorLayer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'decor';
    scene.add(this.group);
  }

  clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse?.((o) => { o.geometry?.dispose?.(); });
    }
  }

  /** Rebuild from placed items. getCab resolves codes; room gives the ceiling. */
  rebuild(state, getCab) {
    this.clear();
    const items = state.items || [];
    const ceiling = state.room?.height || 96;

    // ---- island cluster bounds (if any) ----
    const isl = items.filter((it) => it.island && getCab(it.code));
    if (isl.length) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, seat = false;
      for (const it of isl) {
        const c = getCab(it.code);
        const horiz = ((it.rotDeg || 0) % 180) === 0;
        const hw = (horiz ? c.w : c.d) / 2, hd = (horiz ? c.d : c.w) / 2;
        x0 = Math.min(x0, it.x - hw); x1 = Math.max(x1, it.x + hw);
        z0 = Math.min(z0, it.z - hd); z1 = Math.max(z1, it.z + hd);
        if (it.seating) seat = true;
      }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, len = x1 - x0;

      // ---- stools under a seating overhang (the +z side) ----
      if (seat) {
        const count = Math.max(1, Math.min(3, Math.floor(len / 26)));
        for (let i = 0; i < count; i++) {
          const sx = cx + (i - (count - 1) / 2) * 26;
          const st = new THREE.Group();
          const seatTop = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.4, 1.6, 20), mOakTop());
          seatTop.position.y = 25;
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 24, 10), mDark());
          leg.position.y = 12.5;
          const foot = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.45, 8, 20), mDark());
          foot.rotation.x = Math.PI / 2; foot.position.y = 7;
          const base = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.8, 0.8, 20), mDark());
          base.position.y = 0.4;
          st.add(seatTop, leg, foot, base);
          st.position.set(sx, 0, z1 + 5);                       // tucked under the 12" overhang
          st.traverse((o) => { o.castShadow = true; });
          this.group.add(st);
        }
      }

    }

  }
}
