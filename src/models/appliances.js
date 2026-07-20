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
const RED = () => mat(0x9e1b21, 0.35, 0.4, 0.8);      // pro-range signature knob red
const BASIN = () => mat(0xb4b9be, 0.5, 0.45, 1.2);    // brushed basin steel — low metalness so it never reads black in shadow

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
  // vertical column, a half-torus ARC standing in the y/z plane curving over
  // toward the basin (+z), and a down-turned spout at the arc's far end
  const base = cyl(0.8, 0.95, 1.2, CHROME()); base.position.set(x, 0.6, z); g.add(base);
  const col = cyl(0.42, 0.48, 8.2, CHROME()); col.position.set(x, 4.9, z); g.add(col);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.4, 12, 24, Math.PI), CHROME());
  arc.position.set(x, 9.0, z + 2.4); arc.rotation.y = Math.PI / 2; arc.castShadow = true; g.add(arc);
  const spout = cyl(0.34, 0.4, 2.6, CHROME()); spout.position.set(x, 7.9, z + 4.8); g.add(spout);
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
      // pro range in the Wolf idiom: all-stainless body and fascia, a SOLID
      // stainless oven door with a stout tubular handle, signature RED knobs
      // on a stainless rail, and continuous black cast grates over the burners
      const BRIGHT = () => mat(0xd6dade, 0.72, 0.36, 1.1);   // brushed stainless that reads bright in flat light
      const body = box(w, h - 1.4, d, BRIGHT()); body.position.y = (h - 1.4) / 2 + 1.4; g.add(body);
      const kick = box(w - 1.5, 1.5, d - 1.5, DARK()); kick.position.set(0, 0.75, -0.75); g.add(kick);
      // solid door(s): a 48" gets the twin-oven split, narrower a single door
      const doorW = w - 2.2, doorH = h * 0.52, doorY = h * 0.36;
      const seamIn = box(doorW + 0.6, doorH + 0.6, 0.3, DARK()); seamIn.position.set(0, doorY, fz - 0.1); g.add(seamIn);
      const door = box(doorW, doorH, 0.6, BRIGHT()); door.position.set(0, doorY, fz + 0.12); g.add(door);
      if (w >= 40) { const vs = box(0.35, doorH, 0.2, DARK()); vs.position.set(w * 0.08, doorY, fz + 0.48); vs.castShadow = false; g.add(vs); }
      // badge plate low-centre of the door
      const badge = box(4.6, 1.1, 0.15, STEEL_DK()); badge.position.set(0, doorY - doorH * 0.28, fz + 0.5); badge.castShadow = false; g.add(badge);
      // stout tubular handle across the door top on heavy posts
      const railY = doorY + doorH / 2 - 1.2;
      const rail = cyl(0.6, 0.6, doorW - 1.6, CHROME()); rail.rotation.z = Math.PI / 2; rail.position.set(0, railY, fz + 2.0); g.add(rail);
      for (const sx of [-1, 1]) {
        const pst = cyl(0.34, 0.42, 2.2, CHROME()); pst.rotation.x = Math.PI / 2;
        pst.position.set(sx * (doorW - 4) / 2, railY, fz + 1.0); g.add(pst);
      }
      // stainless control rail with the red knobs
      const panel = box(w, h * 0.14, 1.2, STEEL()); panel.position.set(0, h * 0.865, fz - 0.5); g.add(panel);
      const nKnobs = w >= 40 ? 8 : w >= 34 ? 6 : 5;
      for (let i = 0; i < nKnobs; i++) {
        const kx = -w / 2 + 4 + i * ((w - 8) / (nKnobs - 1));
        const bezel = cyl(0.85, 0.85, 0.35, STEEL_DK()); bezel.rotation.x = Math.PI / 2; bezel.position.set(kx, h * 0.865, fz + 0.2); bezel.castShadow = false; g.add(bezel);
        const k = cyl(0.68, 0.78, 1.3, RED()); k.rotation.x = Math.PI / 2; k.position.set(kx, h * 0.865, fz + 0.75); g.add(k);
        const mark = box(0.16, 0.55, 0.14, CHROME()); mark.position.set(kx, h * 0.865 + 0.3, fz + 1.3); mark.castShadow = false; g.add(mark);
      }
      // cooktop: stainless surround, black porcelain burner deck, ring burners
      // under CONTINUOUS cast grate sections (front-to-back rails + cross bars)
      const surround = box(w, 0.8, d, STEEL()); surround.position.set(0, h + 0.3, 0); g.add(surround);
      const deck = box(w - 1.4, 0.5, d - 2, CAST()); deck.position.set(0, h + 0.62, 0.2); g.add(deck);
      const cols = w >= 40 ? 3 : 2;                       // 6 burners on a 48", else 4
      const secW = (w - 2.6) / cols, secD = d - 3.2;
      const ringR = Math.min(secW / 5.2, d / 5.8);
      for (let c = 0; c < cols; c++) {
        const cx = -w / 2 + 1.3 + secW * (c + 0.5);
        for (const rz of [-1, 1]) ringBurner(g, cx, rz * d / 5.2, h + 0.8, ringR);
        // continuous grate over the section: 2 side rails + 3 cross bars, cast black
        for (const gx of [-1, 1]) {
          const railG = box(0.5, 0.35, secD, CAST()); railG.position.set(cx + gx * (secW / 2 - 0.6), h + 1.28, 0.2); g.add(railG);
        }
        for (const gz of [-1, 0, 1]) {
          const bar = box(secW - 0.8, 0.35, 0.5, CAST()); bar.position.set(cx, h + 1.28, 0.2 + gz * (secD / 2 - 0.4)); g.add(bar);
        }
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
      // UNDERMOUNT stainless with REAL depth: the worktop plan cuts a matching
      // hole (core/worktop-plan.js subtractSinkCutouts uses the same numbers),
      // so each bowl is a true open-top basin recessed 7" below the surface —
      // BackSide walls you look down into, a brushed floor, and a drain.
      const double = /double/i.test(cab.desc);
      const cutW = cab.w - 2.4, cutD = d - 4.5, bowlDepth = 7;
      const bowls = double ? [[-cutW / 4 - 0.25, cutW / 2 - 0.5], [cutW / 4 + 0.25, cutW / 2 - 0.5]] : [[0, cutW]];
      for (const [x, bw] of bowls) {
        // four REAL thin walls + a floor — solid geometry so the bowl reads
        // correctly from every angle (a flipped-normals box sees through its
        // near wall when viewed from the front)
        const t = 0.18, yMid = -bowlDepth / 2;
        const mkWall = (ww, dd, px, pz) => {
          const m = box(ww, bowlDepth, dd, BASIN());
          m.position.set(px, yMid, pz); g.add(m);         // walls CAST shadow into the bowl — that's the depth cue
        };
        mkWall(bw, t, x, -cutD / 2 + t / 2);              // back
        mkWall(bw, t, x, cutD / 2 - t / 2);               // front
        mkWall(t, cutD, x - bw / 2 + t / 2, 0);           // left
        mkWall(t, cutD, x + bw / 2 - t / 2, 0);           // right
        // the floor sits in the bowl's own shade — drawn decisively darker than
        // the worktop or the scene's flat lighting washes the recess out
        const floor = box(bw, 0.2, cutD, mat(0x7e848a, 0.5, 0.52, 0.7));
        floor.position.set(x, -bowlDepth + 0.1, 0); floor.castShadow = false; g.add(floor);
        const drain = cyl(0.8, 0.8, 0.12, DARK()); drain.position.set(x, -bowlDepth + 0.26, 1.4); drain.castShadow = false; g.add(drain);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.09, 8, 24), CHROME());
        ring.rotation.x = Math.PI / 2; ring.position.set(x, -bowlDepth + 0.3, 1.4); ring.castShadow = false; g.add(ring);
      }
      if (double) {                                       // divider crests just below the rim
        const div = box(0.7, bowlDepth - 0.8, cutD, BASIN());
        div.position.set(0, -(bowlDepth - 0.8) / 2 - 0.8, 0); g.add(div);
      }
      gooseneck(g, 0, -d / 2 + 1.6);
      // single lever handle beside the column
      const lx = Math.min(w / 2 - 2, 4.2);
      const lever = cyl(0.32, 0.4, 1.5, CHROME()); lever.position.set(lx, 0.85, -d / 2 + 1.6); g.add(lever);
      const tip = cyl(0.16, 0.16, 1.8, CHROME()); tip.rotation.z = Math.PI / 2.4; tip.position.set(lx + 0.7, 1.75, -d / 2 + 1.6); g.add(tip);
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
      if (cab.integrated) {
        // INTEGRATED fridge-freezer (AP11): reads as painted cabinetry, not
        // stainless — flush panel-ready fronts with shaker fields, a hairline
        // reveal between the two french doors, one full-width freezer drawer
        // below, and Plinth knobs (hardware is knobs-only). 84" install height.
        const PANEL = () => mat(0xe9e6dd, 0.05, 0.55, 0.6);    // painted panel, Ghost-adjacent
        const FIELD = () => mat(0xdfdcd2, 0.05, 0.6, 0.5);     // recessed shaker field, a step darker
        const body = box(w, h, d, PANEL()); body.position.y = h / 2; g.add(body);
        const kick = box(w - 1.0, 2.2, d - 1.0, DARK()); kick.position.set(0, 1.1, -0.5); g.add(kick);
        const splitY = 31;                                     // freezer drawer line (real FF drawer height)
        const leafT = 0.8, stile = 3.1, gap = 0.35;            // leaf + shaker proportions match cabinet fronts
        const leaf = (x0, wL, y0, hL) => {
          const L = box(wL, hL, leafT, PANEL()); L.position.set(x0, y0, fz + leafT / 2); g.add(L);
          if (wL > stile * 2.6 && hL > stile * 2.6) {          // sunk shaker field
            const F = box(wL - stile * 2, hL - stile * 2, 0.3, FIELD());
            F.position.set(x0, y0, fz + leafT - 0.42); F.castShadow = false; g.add(F);
          }
        };
        // two french doors above the drawer line
        const doorH = h - splitY - 0.9, doorY = splitY + 0.45 + doorH / 2;
        const doorW = (w - 1.0 - gap) / 2;
        leaf(-(doorW + gap) / 2, doorW, doorY, doorH);
        leaf((doorW + gap) / 2, doorW, doorY, doorH);
        // full-width freezer drawer below
        const drwH = splitY - 2.2 - 0.9, drwY = 2.2 + 0.45 + drwH / 2;
        leaf(0, w - 1.0, drwY, drwH);
        // knobs: one per door on the meeting stiles, two across the drawer
        const knob = (x, y) => {
          const k = cyl(0.5, 0.62, 0.9, CHROME()); k.rotation.x = Math.PI / 2;
          k.position.set(x, y, fz + leafT + 0.45); g.add(k);
        };
        knob(-(gap / 2 + 1.7), 45); knob(gap / 2 + 1.7, 45);
        knob(-w / 4, splitY - 3.6); knob(w / 4, splitY - 3.6);
        break;
      }
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
