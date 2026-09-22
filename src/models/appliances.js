// appliances.js — procedural appliance placeholders (range cookers, hobs,
// sinks, hoods, fridges). NOT Plinth products — visual context only, unpriced.
// Authored front +Z, base at y=0 (lifted to mount height by placement code).

import * as THREE from 'three';
import { buildIntegratedFridge } from './cabinet.js';
import { rangeSpec, rangeCooktop, hobSpec } from '../core/rangespec.js';
import { sinkSpec } from '../core/sinkspec.js';

function mat(color, metalness, roughness, env = 0.8) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness, roughness, envMapIntensity: env });
}
const STEEL = () => mat(0xc2c6cb, 0.85, 0.32, 1.0);
const STEEL_DK = () => mat(0x9aa0a6, 0.85, 0.34, 1.0);
const DARK = () => mat(0x26282b, 0.4, 0.3, 0.7);
const GLASS = () => mat(0x121417, 0.3, 0.12, 1.0);
const CHROME = () => mat(0xe2e6ea, 0.95, 0.12, 1.2);
const ENAMEL = () => mat(0xf3f3f0, 0.1, 0.45, 0.7);
// brushed stainless for the hood: brighter and less metallic than STEEL, so it reads as satin
// steel rather than dark grey in a room lit mostly from the environment (her note 2026-09-22)
const STAINLESS = () => mat(0xbcc1c5, 0.7, 0.4, 0.9);
const STAINLESS_DK = () => mat(0xa3a8ad, 0.7, 0.45, 0.8);
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

// opts.ceiling: the room height, so a chimney hood's flue can run up to it
export function buildAppliance(cab, finishHex = '#efece3', opts = {}) {
  const g = new THREE.Group();
  g.name = `appliance-${cab.code}`;
  // hairline setback (matches SKIN in cabinet.js): an appliance butted against
  // a cabinet must never share a side plane — coplanar faces z-fight and draw
  // flickering dashed seams along the junction
  const w = cab.w - 0.04, d = cab.d, h = cab.h, fz = d / 2;

  switch (cab.appliance) {
    case 'range': {
      // pro range: brushed stainless body, oven door(s) with a dark glass
      // window and a stout tube handle each, red knobs on a bullnosed control
      // rail, continuous cast grates. Face and cooktop come from rangeSpec so
      // the icon, elevation and plan draw the same appliance: 30" four
      // burners, 36" six, 48" six + a griddle over twin ovens.
      const spec = rangeSpec(cab), top = rangeCooktop(cab);
      const BRIGHT = () => mat(0xd6dade, 0.72, 0.36, 1.1);   // brushed stainless that reads bright in flat light
      const body = box(w, h - spec.kickH, d - 0.6, BRIGHT()); body.position.set(0, (h - spec.kickH) / 2 + spec.kickH, -0.3); g.add(body);
      const kick = box(w - 1.2, spec.kickH, d - 3.2, DARK()); kick.position.set(0, spec.kickH / 2, -1.0); g.add(kick);
      for (const sx of [-1, 1]) {                           // front levelling feet
        const foot = cyl(0.7, 0.85, spec.kickH, STEEL_DK()); foot.position.set(sx * (w / 2 - 2.2), spec.kickH / 2, fz - 2.4); g.add(foot);
      }
      // oven doors
      const doorH = spec.doorY1 - spec.doorY0, doorY = (spec.doorY0 + spec.doorY1) / 2;
      const recess = box(w - 1.2, doorH + 0.7, 0.3, DARK()); recess.position.set(0, doorY, fz - 0.42); g.add(recess);
      for (const ov of spec.ovens) {
        const dw = ov.x1 - ov.x0 - 0.04, dx = -cab.w / 2 + (ov.x0 + ov.x1) / 2;
        const door = box(dw, doorH, 0.9, BRIGHT()); door.position.set(dx, doorY, fz + 0.1); g.add(door);
        // glass window, upper-middle of the door, in a dark bezel
        const winW = dw * 0.62, winH = doorH * 0.36, winY = doorY + doorH * 0.04;
        const bezel = box(winW + 0.9, winH + 0.9, 0.2, STEEL_DK()); bezel.position.set(dx, winY, fz + 0.5); bezel.castShadow = false; g.add(bezel);
        const glass = box(winW, winH, 0.2, GLASS()); glass.position.set(dx, winY, fz + 0.58); glass.castShadow = false; g.add(glass);
        // tube handle across the door top on two posts
        const railY = spec.doorY1 - 2.0, railW = dw - 3.0;
        const rail = cyl(0.55, 0.55, railW, CHROME()); rail.rotation.z = Math.PI / 2; rail.position.set(dx, railY, fz + 2.3); g.add(rail);
        for (const sx of [-1, 1]) {
          const pst = cyl(0.32, 0.4, 1.9, CHROME()); pst.rotation.x = Math.PI / 2;
          pst.position.set(dx + sx * (railW / 2 - 1.4), railY, fz + 1.4); g.add(pst);
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), CHROME()); cap.position.set(dx + sx * railW / 2, railY, fz + 2.3); g.add(cap);
        }
      }
      // control rail, proud of the doors, with a bullnose along its top edge
      const railH = spec.railY1 - spec.railY0, railYc = (spec.railY0 + spec.railY1) / 2;
      const panel = box(w, railH, 1.6, STEEL()); panel.position.set(0, railYc, fz + 0.2); g.add(panel);
      const nose = cyl(0.8, 0.8, w, STEEL(), 20); nose.rotation.z = Math.PI / 2; nose.position.set(0, h + 0.1, fz + 0.2); g.add(nose);
      for (let i = 0; i < spec.knobs; i++) {
        const kx = -w / 2 + 3.2 + i * ((w - 6.4) / (spec.knobs - 1));
        const bez = cyl(0.95, 0.95, 0.3, STEEL_DK()); bez.rotation.x = Math.PI / 2; bez.position.set(kx, railYc, fz + 1.1); bez.castShadow = false; g.add(bez);
        const k = cyl(0.66, 0.8, 1.3, RED()); k.rotation.x = Math.PI / 2; k.position.set(kx, railYc, fz + 1.8); g.add(k);
        const mark = box(0.16, 0.55, 0.14, CHROME()); mark.position.set(kx, railYc + 0.3, fz + 2.4); mark.castShadow = false; g.add(mark);
      }
      // cooktop: stainless surround, black porcelain burner deck, ring burners
      // under CONTINUOUS cast grate sections (front-to-back rails + cross bars)
      const surround = box(w, 0.8, d, STEEL()); surround.position.set(0, h + 0.3, 0); g.add(surround);
      const deck = box(w - 1.4, 0.5, d - 2, CAST()); deck.position.set(0, h + 0.62, 0.2); g.add(deck);
      const secW = top.secW, secD = d - 3.2;
      for (const b of top.burners) ringBurner(g, b.x, b.z, h + 0.8, b.r);
      for (let c = 0; c < spec.cols; c++) {
        const cx = -w / 2 + 1.3 + secW * (c + 0.5);
        for (const gx of [-1, 1]) {
          const railG = box(0.5, 0.35, secD, CAST()); railG.position.set(cx + gx * (secW / 2 - 0.6), h + 1.28, 0.2); g.add(railG);
        }
        for (const gz of [-1, 0, 1]) {
          const bar = box(secW - 0.8, 0.35, 0.5, CAST()); bar.position.set(cx, h + 1.28, 0.2 + gz * (secD / 2 - 0.4)); g.add(bar);
        }
      }
      if (top.griddle) {
        // griddle: a thick brushed plate in a raised steel frame, grease slot at the front
        const gr = top.griddle;
        const frame = box(gr.w + 0.9, 0.9, gr.d + 0.9, STEEL_DK()); frame.position.set(gr.x, h + 1.0, gr.z); g.add(frame);
        const plate = box(gr.w, 0.5, gr.d - 1.6, mat(0xaeb3b8, 0.6, 0.5, 0.9)); plate.position.set(gr.x, h + 1.3, gr.z - 0.8); plate.castShadow = false; g.add(plate);
        const slot = box(gr.w - 1.2, 0.2, 0.9, DARK()); slot.position.set(gr.x, h + 1.42, gr.z + gr.d / 2 - 0.75); slot.castShadow = false; g.add(slot);
      }
      // low back rail: slim steel upstand with a round top bar
      const up = box(w - 1.6, 2.4, 0.7, STEEL()); up.position.set(0, h + 1.6, -d / 2 + 0.6); g.add(up);
      const topBar = cyl(0.35, 0.35, w - 2.5, STEEL_DK()); topBar.rotation.z = Math.PI / 2; topBar.position.set(0, h + 3.0, -d / 2 + 0.6); g.add(topBar);
      break;
    }
    case 'oven': {
      // single wall oven, gallery idiom (matches the placeholder the housing
      // draws when empty): steel surround, one dark glass door, display strip,
      // slim bar handle. Body behind it is a plain dark box inside the housing.
      const fw = cab.w - 0.25;
      // the fascia sits on the housing's DOOR plane (a 24" housing: 12" from its centre, plus the
      // door's own thickness), not back inside the aperture: seen from above, a recessed front
      // read as a gap over the drawer of the F32 (her screenshot 2026-09-22)
      const fo = 12 + 0.55;
      const bodyBox = box(fw - 1.5, h - 1, d - 2, DARK()); bodyBox.position.set(0, h / 2, -1); bodyBox.castShadow = false; g.add(bodyBox);
      const fascia = box(fw, h, 0.5, STEEL_DK()); fascia.position.set(0, h / 2, fo - 0.28); g.add(fascia);
      const glassFront = box(fw - 0.7, h - 4.2, 0.45, GLASS()); glassFront.position.set(0, (h - 4.2) / 2 + 0.35, fo + 0.02); glassFront.castShadow = false; g.add(glassFront);
      const strip = box(fw - 0.7, 3.2, 0.45, mat(0x1d2024, 0.35, 0.2, 1.0)); strip.position.set(0, h - 1.95, fo + 0.02); strip.castShadow = false; g.add(strip);
      const display = box(Math.min(fw * 0.3, 8), 0.9, 0.12, STEEL()); display.position.set(0, h - 1.95, fo + 0.3); display.castShadow = false; g.add(display);
      for (const sx of [-1, 1]) { const dial = cyl(0.55, 0.6, 0.5, STEEL()); dial.rotation.x = Math.PI / 2; dial.position.set(sx * (fw / 2 - 2.6), h - 1.95, fo + 0.45); g.add(dial); }
      const railY = h - 6.2;
      const rail = cyl(0.3, 0.3, fw - 3, STEEL(), 12); rail.rotation.z = Math.PI / 2; rail.position.set(0, railY, fo + 1.05); g.add(rail);
      for (const sx of [-1, 1]) { const post = cyl(0.17, 0.17, 1.1, STEEL(), 8); post.rotation.x = Math.PI / 2; post.position.set(sx * (fw - 4) / 2, railY, fo + 0.5); g.add(post); }
      break;
    }
    case 'hob': {
      const slab = box(w, 1.2, d, GLASS()); slab.position.y = 0.6; g.add(slab);
      const rim = box(w + 0.6, 0.4, d + 0.6, STEEL_DK()); rim.position.y = 0.1; g.add(rim);
      // burners and front knobs from hobSpec (the catalogue icon draws the same):
      // four on a 30", five on a 36" with the big one in the middle
      const hs = hobSpec(cab);
      for (const b of hs.burners) burner(g, b.x, b.z, 1.4, b.r * 1.45);
      for (const kn of hs.knobs) {
        const base = cyl(0.62, 0.68, 0.18, STEEL_DK(), 20); base.position.set(kn.x, 1.29, kn.z); base.castShadow = false; g.add(base);
        const knob = cyl(0.46, 0.52, 0.62, STEEL(), 20); knob.position.set(kn.x, 1.68, kn.z); g.add(knob);
      }
      break;
    }
    case 'sink': {
      // UNDERMOUNT stainless in the Franke Grande idiom (her pick), cut FLUSH: the
      // worktop plan cuts the hole and rounds its corners with stone fillets
      // (core/sinkspec.js is the ONE set of numbers), so the stone meets a
      // WIDE-RADIUS bowl wall directly, no steel rim showing. Walls drop the full
      // depth to a floor pressed with four creases that run to a rear-set basket
      // strainer. A double shows steel only on its divider.
      const sp = sinkSpec(cab);
      // Franke "silk": bright, soft-brushed. LOW metalness on purpose: in this
      // scene's flat light a truly metallic bowl reads near-black in its own shade
      const SILK = () => mat(0xd0d4d8, 0.42, 0.36, 1.3);
      const SILK_FLOOR = () => mat(0xb9bec3, 0.4, 0.44, 1.1);      // the floor sits a touch darker, in the bowl's shade
      const SLAB = 1.25;                                           // worktop thickness (models/worktop.js THICK)
      const roundRect = (S, cx, cz, rw, rd, r) => {               // shape-space: x = across, y = world z
        const x0 = cx - rw / 2, x1 = cx + rw / 2, y0 = cz - rd / 2, y1 = cz + rd / 2;
        S.moveTo(x0 + r, y0); S.lineTo(x1 - r, y0); S.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
        S.lineTo(x1, y1 - r); S.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
        S.lineTo(x0 + r, y1); S.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
        S.lineTo(x0, y0 + r); S.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
        return S;
      };
      // extrude a shape DOWN from world y = top (shape y -> world z)
      const drop = (shape, top, depth, m, shadow = true) => {
        const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
        const mesh = new THREE.Mesh(geo, m); mesh.rotation.x = Math.PI / 2; mesh.position.y = top;
        mesh.castShadow = shadow; mesh.receiveShadow = true; g.add(mesh); return mesh;
      };
      const LIP = 0;                                               // flush reveal: stone edge = bowl wall
      const WALL = 0.16, top = -SLAB, fall = sp.depth;
      if (sp.bowls.length > 1) {
        // the divider's top (and the webs at its rounded ends) is the only steel at stone level
        const web = roundRect(new THREE.Shape(), 0, 0, sp.cutW, sp.cutD, sp.r);
        for (const bl of sp.bowls) web.holes.push(roundRect(new THREE.Path(), bl.x, 0, bl.w, bl.d, sp.r));
        drop(web, top, 0.14, SILK(), false);
      }
      for (const bl of sp.bowls) {
        const ow = bl.w - 2 * LIP, od = bl.d - 2 * LIP, r = Math.max(0.6, sp.r - LIP);
        // walls: a rounded ring the full depth of the bowl (they cast the shadow that reads as depth)
        const ring = roundRect(new THREE.Shape(), bl.x, 0, ow + 2 * WALL, od + 2 * WALL, r + WALL);
        ring.holes.push(roundRect(new THREE.Path(), bl.x, 0, ow, od, r));
        drop(ring, top, fall, SILK());
        // floor
        const floor = drop(roundRect(new THREE.Shape(), bl.x, 0, ow + WALL, od + WALL, r), top - fall, 0.12, SILK_FLOOR(), false);
        floor.receiveShadow = true;
        const fy = top - fall + 0.02, dz = sp.drainZ;
        // pressed drainage creases: corner -> drain, hairline proud of the floor
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const cx = bl.x + sx * (ow / 2 - r * 0.7), cz = sz * (od / 2 - r * 0.7);
          const len = Math.hypot(cx - bl.x, cz - dz) - 2.4;
          if (len < 1) continue;
          const crease = box(len, 0.035, 0.1, mat(0xf2f4f6, 0.3, 0.3, 1.3));
          crease.castShadow = false;
          crease.position.set((cx + bl.x) / 2 + (cx - bl.x) * 0.12, fy, (cz + dz) / 2 + (cz - dz) * 0.12);
          crease.rotation.y = -Math.atan2(cz - dz, cx - bl.x);
          g.add(crease);
        }
        // basket strainer: chrome flange ring, dark basket, centre post
        const sr = Math.min(2.2, ow / 6);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(sr, 0.13, 10, 32), CHROME()); rim.rotation.x = Math.PI / 2; rim.position.set(bl.x, fy + 0.06, dz); rim.castShadow = false; g.add(rim);
        const dish = cyl(sr, sr * 0.92, 0.1, CHROME(), 32); dish.position.set(bl.x, fy + 0.02, dz); dish.castShadow = false; g.add(dish);
        const basket = cyl(sr * 0.62, sr * 0.62, 0.12, DARK(), 28); basket.position.set(bl.x, fy + 0.06, dz); basket.castShadow = false; g.add(basket);
        const inner = new THREE.Mesh(new THREE.TorusGeometry(sr * 0.62, 0.07, 8, 28), CHROME()); inner.rotation.x = Math.PI / 2; inner.position.set(bl.x, fy + 0.1, dz); inner.castShadow = false; g.add(inner);
        const post = cyl(0.22, 0.28, 0.4, CHROME(), 14); post.position.set(bl.x, fy + 0.25, dz); post.castShadow = false; g.add(post);
      }
      gooseneck(g, 0, -d / 2 + 1.6);
      // single lever handle beside the column
      const lx = Math.min(w / 2 - 2, 4.2);
      const lever = cyl(0.32, 0.4, 1.5, CHROME()); lever.position.set(lx, 0.85, -d / 2 + 1.6); g.add(lever);
      const tip = cyl(0.16, 0.16, 1.8, CHROME()); tip.rotation.z = Math.PI / 2.4; tip.position.set(lx + 0.7, 1.75, -d / 2 + 1.6); g.add(tip);
      break;
    }
    case 'hood': {
      // a wall-mount chimney hood in the ZLINE / Broan idiom (her reference 2026-09-22): a
      // shallow flat box canopy, baffle filters and a control strip underneath, and a plain
      // rectangular two-piece chimney rising from its back half
      const CAN = 4.5;                                              // canopy thickness
      const canopy = box(w, CAN, d, STAINLESS(), 0.15); canopy.position.y = CAN / 2; g.add(canopy);
      // underside: a recessed dark plenum with three bright baffle filters
      const plen = box(w * 0.86, 0.5, d * 0.62, DARK()); plen.position.set(0, 0.2, 0.05); g.add(plen);
      const fw = (w * 0.86) / 3 - 0.4;
      for (let i = -1; i <= 1; i++) { const f = box(fw, 0.35, d * 0.58, STAINLESS_DK()); f.position.set(i * (fw + 0.4), 0.12, 0.05); g.add(f); }
      // control strip on the front edge, right of centre
      const ctrl = box(Math.min(7, w * 0.22), 0.5, 0.2, STAINLESS_DK()); ctrl.position.set(w * 0.3, CAN * 0.45, d / 2 + 0.02); g.add(ctrl);
      // chimney: 11.8" wide (300mm), 10" deep, on the back half, a seam where the two sections telescope
      // the chimney runs to the ceiling when we know where it is (the catalogue h is a nominal 28"),
      // up to a 9' ceiling: above that it stands short, as a standard chimney kit would on site (her
      // note 2026-09-22: "we don't supply these, so it is really just illustrative"; 10' "looks too silly")
      const CHIMNEY_MAX_CEILING = 108;
      const cw = Math.min(11.8, w * 0.45), cd = Math.min(10, d * 0.55);
      const ch = opts.ceiling > 0 && cab.mountY != null ? Math.max(h - CAN, Math.min(opts.ceiling, CHIMNEY_MAX_CEILING) - cab.mountY - CAN - 0.1) : h - CAN;
      const chimney = box(cw, ch, cd, STAINLESS()); chimney.position.set(0, CAN + ch / 2, -d / 2 + cd / 2 + 0.6); g.add(chimney);
      const seam = box(cw + 0.06, 0.25, cd + 0.06, STAINLESS_DK()); seam.position.set(0, CAN + ch * 0.55, -d / 2 + cd / 2 + 0.6); g.add(seam);
      const vents = box(cw * 0.5, 1.6, 0.1, STAINLESS_DK()); vents.position.set(0, CAN + ch - 3, -d / 2 + cd + 0.62); g.add(vents);
      break;
    }
    case 'fridge': {
      if (cab.integrated) {
        // panel-ready integrateds are CABINETRY to the eye — built by the
        // cabinet factory itself (same shaker leaves, legs, plinth, finish)
        // so they can never drift from the product language.
        return buildIntegratedFridge(cab, finishHex);
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
    case 'washer': {
      // a white front-loader: enamel box, a porthole door with a dark glass and a chrome ring,
      // the control strip and detergent drawer along the top, a dark kick
      const body = box(w, h, d, ENAMEL()); body.position.y = h / 2; g.add(body);
      const kick = box(w, 1.6, d, DARK()); kick.position.y = 0.8; g.add(kick);
      const strip = box(w - 1, 3.2, 0.3, mat(0xe6e7e4, 0.2, 0.5, 0.7)); strip.position.set(0, h - 2.4, fz); g.add(strip);
      const dial = cyl(1.1, 1.1, 0.5, CHROME()); dial.rotation.x = Math.PI / 2; dial.position.set(w / 2 - 4, h - 2.4, fz + 0.3); g.add(dial);
      const drawer = box(w * 0.3, 1.8, 0.2, mat(0xdcdedb, 0.2, 0.5, 0.7)); drawer.position.set(-w / 2 + 1 + w * 0.15, h - 2.4, fz + 0.2); g.add(drawer);
      const ring = cyl(8.2, 8.2, 1.2, CHROME(), 40); ring.rotation.x = Math.PI / 2; ring.position.set(0, h * 0.47, fz + 0.5); g.add(ring);
      const glass = cyl(6.6, 6.6, 0.6, GLASS(), 40); glass.rotation.x = Math.PI / 2; glass.position.set(0, h * 0.47, fz + 0.9); glass.castShadow = false; g.add(glass);
      break;
    }
    default: { const body = box(w, h, d, STEEL()); body.position.y = h / 2; g.add(body); }
  }

  g.userData = { code: cab.code, type: 'APPLIANCES', footprint: { w, d, returnLeg: 0 }, mountY: cab.mountY ?? 0, doors: [] };
  return g;
}
