// photoFx.js — PHOTO MODE ONLY (render step 3, 2026-09-28). Contact shading: ground-truth ambient
// occlusion (three's GTAOPass, r160) laid over the finished frame, so the 3mm reveals, the butt joint
// between two cabinets' legs, the plinth joints and the underside of the wall cabinets darken the
// way they do in a photograph. Scene.js imports this lazily when photo mode starts; the live planner
// never loads it.
//
// How it is laid on: the scene is rendered exactly as always (tone mapping, background, the unlit
// window, all untouched), then the AO is MULTIPLIED over the canvas by GTAOPass's own blend material.
// A flat, open surface has AO 1, so its colour does not move (the paint score reads panel centres).
//
// Two things the stock pass does not know about this scene:
//  - the planner renders with a LOGARITHMIC depth buffer (it stops the flicker between close faces);
//    GTAO rebuilds positions from depth assuming ordinary perspective depth. Both of its shaders get
//    their depth reads wrapped in logToPersp(), which undoes three's log encoding
//    (d = log2(1 + w) / log2(far + 1)) and re-encodes the same distance as perspective depth.
//  - invisible and see-through things must not occlude: the doorway pick pane (opacity 0), glass,
//    and any overlay that does not write depth are hidden for the normal/depth pass.

import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// World units are inches. Tuned on the hero kitchen's close-ups (tools/render-capture.mjs).
export const AO = { radius: 3.0, distanceExponent: 1.6, thickness: 0.6, distanceFallOff: 1.0, scale: 1.0, samples: 32, intensity: 1.0 };
// the denoiser: 16 samples over 8px left GTAO's grain along the tall/wall corner and the window casing
export const DENOISE = { samples: 48, radius: 8, rings: 4, depthPhi: 8, normalPhi: 8 };

// The lay-on. The frame on the canvas is ANTIALIASED, the AO's normal/depth buffer is not:
//  - along a silhouette each soft edge pixel got the AO of one side or the other at random (a sparkly
//    fringe on the tall's edge and round the window casing);
//  - a face seen EDGE-ON (the side of a leg at the joint between two cabinets, from across the room)
//    lands in the buffer as a one-pixel sliver here and there, deeply occluded, which came out as a
//    DASHED line on the fronts.
// So only pixels that are part of a real, flat surface carry AO: a pixel whose normal differs from
// its neighbours on both sides is a sliver, and a pixel where 1/distance is not locally linear is an
// edge; both get no AO and are left out of their neighbours' 5x5 average (which is also what makes
// GTAO's 5x5 magic-square noise vanish). Then the result is multiplied onto the canvas.
const BLEND = {
  uniforms: { tAO: { value: null }, tDepth: { value: null }, tNormal: { value: null }, texel: { value: new THREE.Vector2() }, uLogFar: { value: 1 }, intensity: { value: 1 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tAO; uniform sampler2D tDepth; uniform sampler2D tNormal; uniform vec2 texel; uniform float uLogFar; uniform float intensity;
    varying vec2 vUv;
    float dist(vec2 uv) { float d = texture2D(tDepth, uv).x; return d >= 1.0 ? 1e6 : exp2(d * uLogFar) - 1.0; }
    vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).rgb * 2.0 - 1.0; }
    bool sliver(vec2 uv, vec3 n) {
      vec2 dx = vec2(texel.x, 0.0), dy = vec2(0.0, texel.y);
      return (dot(n, nrm(uv - dx)) < 0.9 && dot(n, nrm(uv + dx)) < 0.9) || (dot(n, nrm(uv - dy)) < 0.9 && dot(n, nrm(uv + dy)) < 0.9);
    }
    float bend(vec2 uv) {
      float c = 1.0 / dist(uv);
      float h = abs(1.0 / dist(uv - vec2(texel.x, 0.0)) + 1.0 / dist(uv + vec2(texel.x, 0.0)) - 2.0 * c);
      float v = abs(1.0 / dist(uv - vec2(0.0, texel.y)) + 1.0 / dist(uv + vec2(0.0, texel.y)) - 2.0 * c);
      return max(h, v) / c;
    }
    void main() {
      float w0 = dist(vUv), acc = 0.0, n = 0.0;
      vec3 n0 = nrm(vUv);
      for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
        vec2 uv = vUv + vec2(float(i), float(j)) * texel;
        vec3 ni = nrm(uv);
        if (abs(dist(uv) - w0) / w0 < 0.015 && dot(ni, n0) > 0.9 && !sliver(uv, ni)) { acc += texture2D(tAO, uv).r; n += 1.0; }
      }
      float ao = n > 0.0 ? acc / n : 1.0;
      float off = sliver(vUv, n0) ? 1.0 : smoothstep(0.0015, 0.006, bend(vUv));
      ao = mix(ao, 1.0, off);
      gl_FragColor = vec4(vec3(mix(1.0, ao, intensity)), 1.0);
    }`,
};

const LOG_TO_PERSP = /* glsl */`
uniform float uLogFar;
float logToPersp(float d) {
	if (d >= 1.0) return 1.0;
	float w = exp2(d * uLogFar) - 1.0;                         // view distance, back out of three's log depth
	return ((w - cameraNear) * cameraFar) / ((cameraFar - cameraNear) * w);
}
`;

function patchDepth(material, declareNearFar) {
  let fs = material.fragmentShader;
  const at = fs.indexOf('vec3 getViewPosition(');
  fs = fs.slice(0, at) + (declareNearFar ? 'uniform float cameraNear;\nuniform float cameraFar;\n' : '') + LOG_TO_PERSP + fs.slice(at);
  fs = fs.replace(/return (textureLod\(tDepth, uv\.xy, 0\.0\)\.(?:DEPTH_SWIZZLING|[ar]));/g, 'return logToPersp($1);')
         .replace(/return (texelFetch\(tDepth, uv\.xy, 0\)\.(?:DEPTH_SWIZZLING|[ar]));/g, 'return logToPersp($1);');
  material.fragmentShader = fs;
  material.uniforms.uLogFar = { value: 1 };
  if (declareNearFar) { material.uniforms.cameraNear = { value: 1 }; material.uniforms.cameraFar = { value: 1000 }; }
  material.needsUpdate = true;
}

export class PhotoAO {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene;
    this.pass = new GTAOPass(scene, camera, 16, 16);
    this.pass.updateGtaoMaterial(AO);
    this.pass.updatePdMaterial(DENOISE);
    this.pass.blendIntensity = AO.intensity;
    patchDepth(this.pass.gtaoMaterial, false);
    patchDepth(this.pass.pdMaterial, true);
    this.blend = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(BLEND.uniforms), vertexShader: BLEND.vertexShader, fragmentShader: BLEND.fragmentShader,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.DstAlphaFactor, blendDstAlpha: THREE.ZeroFactor, blendEquationAlpha: THREE.AddEquation,
    });
    this._w = 0; this._h = 0;
    this._hidden = [];
  }

  /** Multiply AO over whatever is on the canvas now (the frame just rendered with `camera`). */
  render(camera) {
    const r = this.renderer, p = this.pass;
    const w = r.domElement.width, h = r.domElement.height;
    if (w !== this._w || h !== this._h) { p.setSize(w, h); this._w = w; this._h = h; }
    p.camera = camera;
    const logFar = Math.log2(camera.far + 1);
    for (const m of [p.gtaoMaterial, p.pdMaterial]) {
      m.uniforms.uLogFar.value = logFar; m.uniforms.cameraNear.value = camera.near; m.uniforms.cameraFar.value = camera.far;
    }
    p.pdMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);

    // 1. normals + depth, with what must not occlude hidden
    this._hide();
    p.overrideVisibility();
    p.renderOverride(r, p.normalMaterial, p.normalRenderTarget, 0x7777ff, 1.0);
    p.restoreVisibility();
    this._unhide();
    // 2. AO, 3. denoise (the pass's own steps)
    const g = p.gtaoMaterial.uniforms;
    g.cameraNear.value = camera.near; g.cameraFar.value = camera.far;
    g.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
    g.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    g.cameraWorldMatrix.value.copy(camera.matrixWorld);
    p.renderPass(r, p.gtaoMaterial, p.gtaoRenderTarget, 0xffffff, 1.0);
    // (the pass's Poisson denoiser is NOT run: it blended the dark AO of a sub-pixel slit, the joint
    //  between two cabinets' legs seen from across the room, onto the fronts beside it as a dashed
    //  line. GTAO's noise is a 5x5 magic square, made to vanish under a 5x5 average: the blend below
    //  does exactly that, over flat, depth-similar pixels only.)
    // 4. smooth, fade at silhouettes, multiply onto the canvas (no clear)
    const b = this.blend.uniforms;
    b.tAO.value = p.gtaoRenderTarget.texture; b.tDepth.value = p.normalRenderTarget.depthTexture; b.tNormal.value = p.normalRenderTarget.texture;
    b.texel.value.set(1 / w, 1 / h); b.uLogFar.value = logFar; b.intensity.value = p.blendIntensity;
    p.renderPass(r, this.blend, null);
    // 5. light sources are never shaded: the unlit, un-tone-mapped daylight behind each window is drawn
    //    again over the AO, against the depth the frame left, so the glass stays clean to its edge
    this._redrawEmitters(camera);
  }

  _redrawEmitters(camera) {
    const glow = [];
    this.scene.traverse((o) => { if (o.isMesh && o.visible && o.material && o.material.isMeshBasicMaterial && o.material.toneMapped === false) glow.push(o); });
    if (!glow.length) return;
    const r = this.renderer, bg = this.scene.background, auto = r.autoClear, keep = [];
    this.scene.traverse((o) => { if ((o.isMesh || o.isLine || o.isPoints) && o.visible && !glow.includes(o)) { o.visible = false; keep.push(o); } });
    const shadows = r.shadowMap.autoUpdate;
    this.scene.background = null; r.autoClear = false; r.shadowMap.autoUpdate = false; r.setRenderTarget(null);
    r.render(this.scene, camera);
    r.autoClear = auto; r.shadowMap.autoUpdate = shadows; this.scene.background = bg;
    for (const o of keep) o.visible = true;
  }

  _hide() {
    this.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const m = o.material, mats = Array.isArray(m) ? m : [m];
      if (o.userData.pickOnly || mats.some((x) => x && (x.depthWrite === false || (x.transparent && x.opacity < 0.9)))) { o.visible = false; this._hidden.push(o); }
    });
  }
  _unhide() { for (const o of this._hidden) o.visible = true; this._hidden.length = 0; }

  dispose() { this.pass.dispose(); this.pass.blendMaterial.dispose(); this.pass.gtaoMaterial.dispose(); this.blend.dispose(); }
}
