// appliances.js — procedural appliance placeholders (range cookers, hobs,
// sinks, hoods, fridges). NOT Plinth products — visual context only, unpriced.
// Authored front +Z, base at y=0 (lifted to mount height by placement code).

import * as THREE from 'three';

function mat(color, metalness, roughness, env = 0.8) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness, roughness, envMapIntensity: env });
}
const STEEL = () => mat(0xc2c6cb, 0.85, 0.32, 1.0);
const STEEL_DK = () => mat(0x9aa0a6, 0.85, 0.34, 1.0);
const DARK = () => mat(0x26282b, 0.4, 0.3, 0.7);
const GLASS = () => mat(0x121417, 0.3, 0.12, 1.0);
const CHROME = () => mat(0xe2e6ea, 0.95, 0.12, 1.2);
const ENAMEL = () => mat(0xf3f3f0, 0.1, 0.45, 0.7);
const CAST = () => mat(0x1c1d1f, 0.2, 0.6, 0.4);

function box(w, h, d, m, r = 0) {
  const g = r > 0 ? new THREE.BoxGeometry(w, h, d) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}
function cyl(rt, rb, h, m, seg = 24) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.castShadow = true; return mesh;
}

// a pro-range burner: a thin cast ring (torus) + centre cap + cross grates
function ringBurner(g, x, z, topY, r) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.16, 8, 28), CAST());
  ring.rotation.x = Math.PI / 2; ring.position.set(x, topY, z); ring.castShadow = true; g.add(ring);
  const cap = cyl(r * 0.32, r * 0.38, 0.35, DARK()); cap.position.set(x, topY + 0.05, z); g.add(cap);
  for (let i = 0; i < 4; i++) {                          // cross grates over the ring
    const bar = box(r * 2.5, 0.2, 0.42, CAST());
    bar.position.set(x, topY + 0.22, z);
    bar.rotation.y = Math.PI / 4 + (i * Math.PI) / 2;
    g.add(bar);
  }
}

// a gas burner: a low disc + a cross of cast-iron grate bars
function burner(g, x, z, topY, size) {
  const base = cyl(size * 0.5, size * 0.55, 0.5, DARK()); base.position.set(x, topY - 0.2, z); g.add(base);
  const cap = cyl(size * 0.28, size * 0.34, 0.5, CAST()); cap.position.set(x, topY + 0.2, z); g.add(cap);
  for (let i = 0; i < 4; i++) {
    const bar = box(size * 1.1, 0.35, 0.5, CAST());
    bar.position.set(x, topY + 0.5, z);
    bar.rotation.y = (i * Math.PI) / 4;
    g.add(bar);
  }
}

function gooseneck(g, x, z) {
  const base = cyl(0.85, 1.0, 1.4, CHROME()); base.position.set(x, 0.7, z); g.add(base);
  const col = cyl(0.45, 0.5, 9, CHROME()); col.position.set(x, 5.5, z); g.add(col);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.42, 12, 24, Math.PI), CHROME());
  arc.position.set(x, 9.8, z + 2.6); arc.rotation.set(Math.PI / 2, 0, 0); g.add(arc);
  const spout = cyl(0.42, 0.42, 1.6, CHROME()); spout.position.set(x, 9, z + 5.2); g.add(spout);
}

export function buildAppliance(cab) {
  const g = new THREE.Group();
  g.name = `appliance-${cab.code}`;
  // hairline setback (matches SKIN in cabinet.js): an appliance butted against
  // a cabinet must never share a side plane — coplanar faces z-fight and draw
  // flickering dashed seams along the junction
  const w = cab.w - 0.04, d = cab.d, h = cab.h, fz = d / 2;

  switch (cab.appliance) {
    case 'range': {
      // brushed-steel body over a recessed dark toe kick
      const body = box(w, h - 1.4, d, STEEL()); body.position.y = (h - 1.4) / 2 + 1.4; g.add(body);
      const kick = box(w - 1.5, 1.5, d - 1.5, DARK()); kick.position.set(0, 0.75, -0.75); g.add(kick);
      // recessed oven door: slightly darker steel set back into the body,
      // with a dark-glass window inset and a full-width handle rail
      const doorW = w - 3, doorH = h * 0.52, doorY = h * 0.36;
      const inset = box(doorW + 0.8, doorH + 0.8, 0.4, DARK()); inset.position.set(0, doorY, fz - 0.15); g.add(inset);
      const door = box(doorW, doorH, 0.5, STEEL_DK()); door.position.set(0, doorY, fz + 0.05); g.add(door);
      const win = box(doorW - 6, doorH * 0.52, 0.3, GLASS()); win.position.set(0, doorY - doorH * 0.06, fz + 0.32); win.castShadow = false; g.add(win);
      const winRim = box(doorW - 5, doorH * 0.52 + 1, 0.15, STEEL_DK()); winRim.position.set(0, doorY - doorH * 0.06, fz + 0.22); winRim.castShadow = false; g.add(winRim);
      // horizontal handle rail (cylinder on two posts, near the door top)
      const railY = doorY + doorH / 2 - 1.0;
      const rail = cyl(0.42, 0.42, doorW - 2.5, CHROME()); rail.rotation.z = Math.PI / 2; rail.position.set(0, railY, fz + 1.5); g.add(rail);
      for (const sx of [-1, 1]) {
        const pst = cyl(0.24, 0.24, 1.7, CHROME()); pst.rotation.x = Math.PI / 2;
        pst.position.set(sx * (doorW - 5) / 2, railY, fz + 0.75); g.add(pst);
      }
      // control rail across the top with a row of small knobs
      const panel = box(w - 1.6, h * 0.13, 1.0, STEEL_DK()); panel.position.set(0, h * 0.87, fz - 0.4); g.add(panel);
      const nKnobs = w >= 40 ? 8 : w >= 34 ? 6 : 5;
      for (let i = 0; i < nKnobs; i++) {
        const kx = -w / 2 + 4 + i * ((w - 8) / (nKnobs - 1));
        const k = cyl(0.62, 0.72, 1.1, DARK()); k.rotation.x = Math.PI / 2; k.position.set(kx, h * 0.87, fz + 0.45); g.add(k);
        const mark = box(0.16, 0.5, 0.14, CHROME()); mark.position.set(kx, h * 0.87 + 0.28, fz + 0.95); mark.castShadow = false; g.add(mark);
      }
      // cooktop: dark glass slab in a steel surround, ring burners + grates
      const surround = box(w, 0.8, d, STEEL()); surround.position.set(0, h + 0.3, 0); g.add(surround);
      const slab = box(w - 1.6, 0.5, d - 2, GLASS()); slab.position.set(0, h + 0.62, 0.2); g.add(slab);
      const cols = w >= 40 ? 3 : 2;                       // 6 burners on a 48", else 4
      const ringR = Math.min(w / (cols * 2.6), d / 5.4);
      for (let c = 0; c < cols; c++) for (const rz of [-1, 1]) {
        ringBurner(g, -w / 2 + (w / (cols + 1)) * (c + 1), rz * d / 5.2, h + 0.95, ringR);
      }
      // low back rail: slim steel upstand with a round top bar
      const up = box(w - 1.6, 2.4, 0.7, STEEL()); up.position.set(0, h + 1.6, -d / 2 + 0.6); g.add(up);
      const topBar = cyl(0.35, 0.35, w - 2.5, STEEL_DK()); topBar.rotation.z = Math.PI / 2; topBar.position.set(0, h + 3.0, -d / 2 + 0.6); g.add(topBar);
      break;
    }
    case 'hob': {
      const slab = box(w, 1.2, d, GLASS()); slab.position.y = 0.6; g.add(slab);
      const rim = box(w + 0.6, 0.4, d + 0.6, STEEL_DK()); rim.position.y = 0.1; g.add(rim);
      for (const bx of [-w / 4, w / 4]) for (const bz of [-d / 6, d / 6]) burner(g, bx, bz, 1.4, Math.min(w, d) * 0.14);
      break;
    }
    case 'sink': {
      const rim = box(w, 1.0, d, STEEL()); rim.position.y = -0.2; g.add(rim);
      const double = /double/i.test(cab.desc);
      const basins = double ? [-w / 4, w / 4] : [0];
      for (const x of basins) {
        const bw = (double ? w / 2 : w) - 4;
        const inner = box(bw, 8, d - 5, STEEL_DK());
        inner.position.set(x, -4.2, 0); inner.material = inner.material.clone(); inner.material.side = THREE.BackSide; inner.castShadow = false; g.add(inner);
        const drain = cyl(0.9, 0.9, 0.4, CHROME()); drain.position.set(x, -8, 0); g.add(drain);
      }
      gooseneck(g, double ? 0 : 0, -d / 2 + 2.6);
      break;
    }
    case 'hood': {
      // tapered canopy + slim flue
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.62, w * 0.42, h * 0.45, 4), STEEL());
      canopy.rotation.y = Math.PI / 4; canopy.scale.set(1, 1, d / w * 1.4); canopy.position.y = h * 0.25; g.add(canopy);
      const band = box(w * 0.9, 1.2, d * 0.9, STEEL_DK()); band.position.y = h * 0.02; g.add(band);
      const flue = box(w * 0.32, h * 0.55, d * 0.45, STEEL()); flue.position.set(0, h * 0.72, -d * 0.18); g.add(flue);
      break;
    }
    case 'fridge': {
      // all features derive from w/d/h so USER-SIZED boxes (AP9:WxDxH) read
      // right: the freezer split stays proportionate, handles scale with h,
      // and a wide (≥40") box splits into french doors above the freezer.
      const body = box(w, h, d, STEEL()); body.position.y = h / 2; g.add(body);
      const splitY = h * 0.64;                             // freezer below, fridge above
      const seam = box(w, 0.4, 0.3, DARK()); seam.position.set(0, splitY, fz); g.add(seam);
      const french = w >= 40;
      if (french) {                                        // vertical door split line
        const vseam = box(0.4, h - splitY - 1.2, 0.3, DARK());
        vseam.position.set(0, (h + splitY) / 2, fz); g.add(vseam);
      }
      // fridge-door handles: vertical pulls, length scales with the box height
      const hLen = Math.min(h * 0.26, 20);
      const handY = splitY + (h - splitY) * 0.45;
      const pull = (x) => { const hd = cyl(0.4, 0.4, hLen, CHROME()); hd.position.set(x, handY, fz + 0.55); g.add(hd); };
      if (french) { pull(-2.2); pull(2.2); } else pull(w / 2 - 2.5);
      // freezer drawer: a horizontal bar handle
      const fb = cyl(0.4, 0.4, Math.min(w * 0.5, 22), CHROME());
      fb.rotation.z = Math.PI / 2; fb.position.set(0, splitY - 2.4, fz + 0.55); g.add(fb);
      const kick = box(w, 2, d, DARK()); kick.position.set(0, 1, 0); g.add(kick);
      break;
    }
    default: { const body = box(w, h, d, STEEL()); body.position.y = h / 2; g.add(body); }
  }

  g.userData = { code: cab.code, type: 'APPLIANCES', footprint: { w, d, returnLeg: 0 }, mountY: cab.mountY ?? 0, doors: [] };
  return g;
}
