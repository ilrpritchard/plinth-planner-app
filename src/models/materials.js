// materials.js — cached materials, tuned for the bright studio environment so
// painted finishes read true and stay crisp.

import * as THREE from 'three';
import { BRAND } from '../core/catalogue.js';

const paintCache = new Map();

/** Hand-painted shaker with a satin lacquer — a thin clearcoat over true colour. */
export function paintMat(hex) {
  if (paintCache.has(hex)) return paintCache.get(hex);
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hex),
    roughness: 0.5,            // eggshell body
    metalness: 0.0,
    envMapIntensity: 0.55,     // soft fill from the bright studio env
    clearcoat: 0.28,           // the satin lacquer film real painted cabinets have
    clearcoatRoughness: 0.5,   // soft, not glossy — catches a gentle highlight
  });
  paintCache.set(hex, m);
  return m;
}

let _oak, _plinth, _brass, _glass, _interior, _shadow, _plinthShadow;
const edgeCache = new Map();

/** Near-black brown for shadow gaps between fronts — unlit so it always reads
 *  as a true recess, whatever the studio lighting does. */
export function shadowMat() {
  return _shadow ||= new THREE.MeshBasicMaterial({ color: new THREE.Color(0x1c130c) });
}

/** A soft dark overlay strip (plinth shadow line) — translucent so the paint
 *  colour shows through, like ambient occlusion under the fronts. */
export function plinthShadowMat() {
  return _plinthShadow ||= new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x14100b), transparent: true, opacity: 0.30, depthWrite: false,
  });
}

/** The finish darkened a touch — the shadow line where the shaker centre panel
 *  meets the stiles. Lit (standard) so it stays subtle and colour-true. */
export function paintEdgeMat(hex) {
  if (edgeCache.has(hex)) return edgeCache.get(hex);
  const c = new THREE.Color(hex).multiplyScalar(0.74);
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.65, metalness: 0, envMapIntensity: 0.3 });
  edgeCache.set(hex, m);
  return m;
}

export function oakMat() {
  return _oak ||= new THREE.MeshStandardMaterial({
    color: new THREE.Color(BRAND.oak), roughness: 0.7, metalness: 0,
    envMapIntensity: 0.5,
  });
}

export function interiorMat() {
  // slightly paler than the oak veneer face, for cavity backs
  return _interior ||= new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xe0cda8), roughness: 0.8, metalness: 0,
    envMapIntensity: 0.45,
  });
}

export function plinthMat() {
  return _plinth ||= new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x2a2622), roughness: 0.9, metalness: 0,
  });
}

export function brassMat() {
  // brushed steel/nickel handles — neutral metal, no gold/yellow in the scene.
  return _brass ||= new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x9a9ea3), roughness: 0.35, metalness: 0.85,
    envMapIntensity: 1.0,
  });
}

export function glassMat() {
  // simple blend transparency — transmission + blend opacity together read
  // as murk (and transmission needs a render pass SwiftShader mangles)
  return _glass ||= new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xf0f3f3), roughness: 0.05, metalness: 0,
    transparent: true, opacity: 0.16,
    envMapIntensity: 1.0,
  });
}

// ----- worktop materials (not supplied by Plinth — visual) -----
export const WORKTOPS = {
  marble: { label: 'Marble', color: 0xeae7e0, roughness: 0.18, metalness: 0, env: 1.0 },
  granite: { label: 'Granite', color: 0x3a3b40, roughness: 0.28, metalness: 0.05, env: 0.9 },
  oak: { label: 'Oak', color: 0xb98c50, roughness: 0.55, metalness: 0, env: 0.4 },
};
const _wtCache = new Map();

// procedural surface texture: marble veining / granite speckle / oak grain.
// Browser-only (canvas); in node the material simply has no map.
function worktopTexture(name) {
  if (typeof document === 'undefined') return null;
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rand = (() => { let s = 41; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

  if (name === 'marble') {
    g.fillStyle = '#eae7e0'; g.fillRect(0, 0, S, S);
    // soft grey veins: wandering bezier strokes at low alpha, a few darker keys
    for (let i = 0; i < 26; i++) {
      const dark = i % 7 === 0;
      g.strokeStyle = dark ? 'rgba(120,122,128,0.32)' : 'rgba(160,160,166,0.16)';
      g.lineWidth = dark ? 1.6 : 0.9 + rand() * 1.4;
      g.beginPath();
      let x = rand() * S, y = rand() * S;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        const nx = x + (rand() - 0.3) * 220, ny = y + (rand() - 0.3) * 220;
        g.bezierCurveTo(x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 120, nx + (rand() - 0.5) * 120, ny + (rand() - 0.5) * 120, nx, ny);
        x = nx; y = ny;
      }
      g.stroke();
    }
  } else if (name === 'granite') {
    g.fillStyle = '#3a3b40'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {          // mineral speckle
      const t = rand();
      g.fillStyle = t < 0.5 ? 'rgba(210,210,215,0.18)' : t < 0.8 ? 'rgba(90,92,100,0.5)' : 'rgba(20,20,24,0.55)';
      g.fillRect(rand() * S, rand() * S, 1 + rand() * 1.6, 1 + rand() * 1.6);
    }
  } else {                                     // oak: butcher-block strips + grain
    g.fillStyle = '#b98c50'; g.fillRect(0, 0, S, S);
    const strip = S / 8;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `rgba(${120 + rand() * 40 | 0},${80 + rand() * 25 | 0},${38 + rand() * 18 | 0},0.25)`;
      g.fillRect(0, i * strip, S, strip);
      g.strokeStyle = 'rgba(90,60,28,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, i * strip); g.lineTo(S, i * strip); g.stroke();
      for (let v = 0; v < 8; v++) {            // fine grain lines within the strip
        g.strokeStyle = `rgba(115,78,38,${0.10 + rand() * 0.12})`;
        g.lineWidth = 0.7;
        const y = i * strip + rand() * strip;
        g.beginPath(); g.moveTo(0, y);
        g.bezierCurveTo(S * 0.3, y + (rand() - 0.5) * 5, S * 0.7, y + (rand() - 0.5) * 5, S, y + (rand() - 0.5) * 3);
        g.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;  // box UVs: one tile per face
  tex.anisotropy = 4;
  return tex;
}

export function worktopMat(name = 'marble') {
  if (_wtCache.has(name)) return _wtCache.get(name);
  const w = WORKTOPS[name] || WORKTOPS.marble;
  // stone (marble/granite) gets a polished clearcoat; oak stays matt.
  const stone = name !== 'oak';
  const tex = worktopTexture(name);
  const m = new THREE.MeshPhysicalMaterial({
    color: tex ? 0xffffff : new THREE.Color(w.color),
    map: tex || null,
    roughness: w.roughness, metalness: w.metalness, envMapIntensity: w.env,
    clearcoat: stone ? 0.6 : 0, clearcoatRoughness: stone ? 0.15 : 0,
  });
  if (tex) { tex.matrixAutoUpdate = true; }
  _wtCache.set(name, m);
  return m;
}
