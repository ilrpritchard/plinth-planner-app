// materials.js — cached materials, tuned for the bright studio environment so
// painted finishes read true and stay crisp.

import * as THREE from 'three';
import { BRAND } from '../core/catalogue.js';
import { worktopCanvas } from './worktopTexture.js';

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
// HONED, not polished: the old polished clearcoat + env 1.0 blew marble out to a
// blank white that vanished into the wall, and washed "granite" to pale grey.
// Textures are painted by models/worktopTexture.js and mapped in WORLD space by
// models/worktop.js (96" per tile). Keys are saved in designs: never rename one.
export const WORKTOPS = {
  marble: { label: 'Carrara marble', color: 0xe2e0db, roughness: 0.44, metalness: 0, env: 0.5, coat: 0.22 },
  calacatta: { label: 'Calacatta marble', color: 0xece9e3, roughness: 0.4, metalness: 0, env: 0.5, coat: 0.25 },
  quartz: { label: 'White quartz', color: 0xe8e6e1, roughness: 0.38, metalness: 0, env: 0.55, coat: 0.3 },
  soapstone: { label: 'Soapstone', color: 0x3e4544, roughness: 0.72, metalness: 0, env: 0.3, coat: 0 },
  granite: { label: 'Black granite', color: 0x26272b, roughness: 0.5, metalness: 0.03, env: 0.5, coat: 0.2 },
  oak: { label: 'Oak block', color: 0xbc9462, roughness: 0.62, metalness: 0, env: 0.32, coat: 0 },
  walnut: { label: 'Walnut block', color: 0x684832, roughness: 0.6, metalness: 0, env: 0.32, coat: 0 },
};
const _wtCache = new Map();

function worktopTexture(name) {
  const cv = worktopCanvas(WORKTOPS[name] ? name : 'marble');
  if (!cv) return null;                           // node: the material simply has no map
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;   // world-space UVs run past 0..1: the tile is seamless
  tex.anisotropy = 8;
  return tex;
}

export function worktopMat(name = 'marble') {
  if (_wtCache.has(name)) return _wtCache.get(name);
  const w = WORKTOPS[name] || WORKTOPS.marble;
  const tex = worktopTexture(name);
  const m = new THREE.MeshPhysicalMaterial({
    color: tex ? 0xffffff : new THREE.Color(w.color),
    map: tex || null,
    roughness: w.roughness, metalness: w.metalness, envMapIntensity: w.env,
    clearcoat: w.coat, clearcoatRoughness: 0.4,      // a honed sheen, never a mirror
  });
  if (tex) { tex.matrixAutoUpdate = true; }
  _wtCache.set(name, m);
  return m;
}
