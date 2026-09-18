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
import { WORKTOP_TILE_IN } from './worktopTexture.js';

const THICK = 1.25;

const WOOD = new Set(['oak', 'walnut']);

// Map a slab in WORLD space (96" per texture tile) so the surface is continuous
// across every piece: a vein leaving one slab carries on in the next, and the
// pieces round a sink cutout read as one stone. Timber staves follow the run:
// along x on a back / front run, along z on a side run (`alongZ`).
function worldUVs(geo, cx, cy, cz, alongZ) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, T = WORKTOP_TILE_IN;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, y = pos.getY(i) + cy, z = pos.getZ(i) + cz;
    let u, v;
    if (Math.abs(nor.getY(i)) > 0.5) { u = x; v = z; }            // top / underside
    else if (Math.abs(nor.getZ(i)) > 0.5) { u = x; v = y; }       // front / back edge
    else { u = z; v = y; }                                        // end edge
    if (alongZ && Math.abs(nor.getY(i)) > 0.5) { const t = u; u = v; v = t; }
    uv.setXY(i, u / T, v / T);
  }
  uv.needsUpdate = true;
}

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
    for (const s of planned) s.alongZ = WOOD.has(s.mat) && (s.z1 - s.z0) > (s.x1 - s.x0);   // carried onto every cut piece
    // an undermount is cut flush to a rounded bowl: stone fillets round each corner of the square hole
    for (const f of sinkCornerFillets(planned, items, getCab)) {
      const shape = new THREE.Shape(f.pts.map(([x, z]) => new THREE.Vector2(x, z)));
      const fgeo = new THREE.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false });
      {                                                   // shape x,y ARE world x,z: same mapping as the slab tops
        const pos = fgeo.attributes.position, uv = fgeo.attributes.uv, T = WORKTOP_TILE_IN;
        for (let i = 0; i < pos.count; i++) uv.setXY(i, (f.alongZ ? pos.getY(i) : pos.getX(i)) / T, (f.alongZ ? pos.getX(i) : pos.getY(i)) / T);
      }
      const fillet = new THREE.Mesh(fgeo, worktopMat(f.mat));
      fillet.rotation.x = Math.PI / 2;                    // shape y -> world z, extrude -> down
      fillet.position.y = SURFACE_Y;
      fillet.castShadow = true; fillet.receiveShadow = true;
      this.group.add(fillet);
    }
    for (const s of subtractSinkCutouts(planned, items, getCab)) {
      const w = s.x1 - s.x0, d = s.z1 - s.z0;
      if (w <= 0.05 || d <= 0.05) continue;
      const geo = new THREE.BoxGeometry(w - 0.02, THICK, d - 0.02);
      worldUVs(geo, (s.x0 + s.x1) / 2, SURFACE_Y - THICK / 2, (s.z0 + s.z1) / 2, !!s.alongZ);
      const slab = new THREE.Mesh(geo, worktopMat(s.mat));
      slab.castShadow = true; slab.receiveShadow = true;
      slab.position.set((s.x0 + s.x1) / 2, SURFACE_Y - THICK / 2, (s.z0 + s.z1) / 2);
      this.group.add(slab);
    }
  }
}
