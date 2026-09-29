// materials.js — cached materials, tuned for the bright studio environment so
// painted finishes read true and stay crisp.

import * as THREE from 'three';
import { BRAND } from '../core/catalogue.js';
import { worktopCanvas, worktopDetailCanvases } from './worktopTexture.js';
import { addDetail } from './surfaceDetail.js';

const paintCache = new Map();

/** Hand-painted shaker with a satin lacquer — a thin clearcoat over true colour. */
export function paintMat(hex) {
  if (paintCache.has(hex)) return paintCache.get(hex);
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hex),
    // EGGSHELL, not satin (her catch 2026-09-29): at 0.5 / 0.28 lacquer the side of a tall seen edge-on
    // mirrored the bright room as a flat grey sheet, and on a dark paint (Kale, Swamp) the ends of the
    // cabinets read grey, not green. Rougher, less reflective, a thin lacquer: the sheen stays, the
    // colour holds at a glancing angle.
    roughness: 0.7,
    metalness: 0.0,
    specularIntensity: 0.6,
    envMapIntensity: 0.55,     // soft fill from the bright studio env
    clearcoat: 0.1,            // a thin satin lacquer film
    clearcoatRoughness: 0.55,
  });
  addDetail(m, 'paint');       // photo mode: brushed-eggshell micro-texture on every painted part (surfaceDetail.js)
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

// The knobs (visual only: hardware is by others, cabinets ship undrilled, hard rule 17, so there is
// NO picker). Render step 5 (2026-09-28): unlacquered satin brass, as the marketing images specify;
// the planner drew a neutral grey metal before ("no gold/yellow in the scene"). KNOB_FINISH is the one
// switch; 'nickel' is a satin nickel close to the old look, 'black' a matt black.
export const KNOB_FINISHES = {
  brass:  { color: 0xc9ab77, metalness: 1.0, roughness: 0.35, env: 1.0 },   // unlacquered, satin
  nickel: { color: 0xc4c3be, metalness: 1.0, roughness: 0.3, env: 1.0 },
  black:  { color: 0x1f1f20, metalness: 0.6, roughness: 0.5, env: 0.6 },
};
export const KNOB_FINISH = 'brass';
export function brassMat() {
  const f = KNOB_FINISHES[KNOB_FINISH];
  return _brass ||= new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(f.color), roughness: f.roughness, metalness: f.metalness, envMapIntensity: f.env,
  });
}

/** Brushed stainless (render step 5): anisotropic highlights stretched ACROSS the grain, which runs
 *  along each face's u (horizontal on a front), plus fine brush lines in photo mode. */
export function stainlessMat(color, metalness = 0.8, roughness = 0.35, env = 1.0) {
  return addDetail(new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), metalness, roughness, envMapIntensity: env,
    anisotropy: 0.65, anisotropyRotation: 0,
  }), 'brushed');
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

/** PHOTO MODE (render step 5): the stones get honed PBR maps, a roughness map and a normal map made
 *  from the same painted tile (worktopTexture.js worktopDetailCanvases: veins slightly etched, a fine
 *  mineral grain, no mirror anywhere), built the first time photo mode opens; the clearcoat sheen
 *  comes off (a honed slab has none). Off: back to the live material exactly. */
const HONED = new Set(['marble', 'calacatta', 'quartz', 'soapstone', 'granite']);
const _wtDetail = new Map();
export function setWorktopDetail(on) {
  for (const [name, m] of _wtCache) {
    if (!HONED.has(name)) continue;
    if (on) {
      if (!_wtDetail.has(name)) {
        const cv = worktopDetailCanvases(name);
        if (!cv) continue;
        const mk = (c) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; return t; };
        _wtDetail.set(name, { rough: mk(cv.rough), normal: mk(cv.normal), live: null });
      }
      const d = _wtDetail.get(name);
      if (!d.live) d.live = { roughness: m.roughness, clearcoat: m.clearcoat };
      m.roughnessMap = d.rough; m.normalMap = d.normal; m.normalScale.set(0.35, 0.35);
      m.roughness = Math.min(1, d.live.roughness * 1.25); m.clearcoat = 0;
    } else {
      const d = _wtDetail.get(name); if (!d || !d.live) continue;
      m.roughnessMap = null; m.normalMap = null; m.roughness = d.live.roughness; m.clearcoat = d.live.clearcoat; d.live = null;
    }
    m.needsUpdate = true;
  }
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
