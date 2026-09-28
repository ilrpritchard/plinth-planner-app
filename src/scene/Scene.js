// Scene.js — renderer, camera, OrbitControls, soft studio lighting.
//
// World units are inches. Front of every cabinet faces +Z, base at y = 0.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { BRAND } from '../core/catalogue.js';
import { keyLight } from '../core/keylight.js';

// Khronos PBR Neutral (github.com/KhronosGroup/ToneMapping), the curve three.js ships as
// NeutralToneMapping from r162; this vendored r160 lacks it, so it goes in through three's own
// CustomToneMapping hook. It leaves a colour's hue and saturation alone up to ~80% brightness and
// rolls only highlights off, which is what paint swatches need (AgX and ACES both shift them).
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  'vec3 CustomToneMapping( vec3 color ) { return color; }',
  `vec3 CustomToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}`);

// The camera response and the light budget, in ONE place (render step 2, 2026-09-28). Chosen by
// tools/render-swatches.mjs: the tone mapper + exposure that keep the 15 paints nearest their hexes.
//   env  = the HDRI's mean luminance after normalising (it lights through each material's envMapIntensity)
//   key  = the one shadow-casting light, aimed by core/keylight.js (from the window if there is one)
//   fill = soft, shadowless, from the camera side opposite the key
//   hemi = a faint sky/ground tint, so undersides read a shade darker
export const LOOK = { toneMapping: THREE.CustomToneMapping, exposure: 1.35, env: 0.35, key: 2.0, fill: 0.5, hemi: 0.3 };   // Custom = PBR Neutral, above
// Photo mode's key shadow (render step 3): fitted to the room, so 6144 texels over a ~230" room is
// ~0.04" (1mm) a texel, fine enough for the 8mm shaker relief, the 35mm top rail and the legs.
export const PHOTO_SHADOW = { size: 6144, bias: -0.0001, normalBias: 0.04, radius: 4 };
// A white daylight apartment, one big window, almost no colour cast (CC0, Poly Haven; site-assets/hdri/LICENCE.md)
const HDRI_URL = new URL('../../site-assets/hdri/brown_photostudio_04_1k.hdr', import.meta.url).href;

export class Scene {
  constructor(container) {
    this.container = container;
    this.objects = []; // things that must stay grounded (cabinets)

    // ----- renderer -----
    // logarithmicDepthBuffer greatly reduces z-fighting (flicker) between
    // close/coplanar surfaces as the camera moves.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // A filmic curve rolls bright worktops and the window off softly instead of clipping them,
    // like a camera; LOOK says which one and at what exposure (measured against the paint hexes).
    this.renderer.toneMapping = LOOK.toneMapping;
    this.renderer.toneMappingExposure = LOOK.exposure;
    container.appendChild(this.renderer.domElement);

    // ----- scene -----
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BRAND.paper);

    // ----- cameras (perspective for 3D, orthographic for plan/elevations) ---
    this.persp = new THREE.PerspectiveCamera(42, 1, 1, 6000);
    this.persp.position.set(110, 130, 200);
    this.ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, -4000, 6000);
    this.camera = this.persp;
    this.view = '3d';
    this.lastRoom = { width: 144, depth: 120, height: 96 };

    // ----- controls -----
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 36;
    this.controls.maxDistance = 900;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04; // can't go under the floor
    this.controls.zoomToCursor = true;      // scroll zooms toward the pointer
    this.controls.zoomSpeed = 1.15;
    this.controls.rotateSpeed = 0.75;
    this.controls.panSpeed = 1.0;
    this.controls.screenSpacePanning = true; // pan parallel to the screen — intuitive
    this.controls.target.set(0, 30, 0);
    this.navMode = 'orbit';
    // left = orbit (or pan in pan-mode), right = always pan, middle = zoom.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    // trackpad: one-finger orbit, two-finger pan AND zoom
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    this._buildLighting();

    // ----- resize -----
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();

    // ----- render loop -----
    this._tick = this._tick.bind(this);
    this._beforeRender = null;
    requestAnimationFrame(this._tick);
  }

  _buildLighting() {
    // ONE clear light direction (the key, aimed at the window by setKeyFrom) over a soft daylight
    // environment, with a faint fill from the camera side. The old rig was four lights summing to
    // ~1.1 on every surface facing the room, which read as flat all-round light.
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xb7a992, LOOK.hemi);
    this.scene.add(this.hemi);

    const key = this.key = new THREE.DirectionalLight(0xfffbf5, LOOK.key);
    key.castShadow = true;
    key.shadow.mapSize.set(3072, 3072);   // fine texels so 8mm relief resolves
    const s = 240;
    key.shadow.camera.left = -s; key.shadow.camera.right = s;
    key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
    key.shadow.camera.near = 10; key.shadow.camera.far = 800;
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.18;
    key.shadow.radius = 4;
    this.scene.add(key);

    this.fill = new THREE.DirectionalLight(0xffffff, LOOK.fill);
    this.scene.add(this.fill);

    // The environment: RoomEnvironment (a soft white box) at once, so the first frame is lit; the
    // daylight HDRI replaces it when it has loaded, turned so its window sits where the key comes
    // from. If the HDRI cannot load, RoomEnvironment simply stays.
    this._pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this._envRT = this._pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this._envRT.texture;
    roomEnv.dispose?.();
    this.setKeyFrom({});
    /** Resolves once the HDRI is in (or has failed and RoomEnvironment stays): captures wait on it. */
    this.envReady = this._loadHdri();
  }

  /** Aim the key (and turn the environment) for this room: core/keylight.js decides the direction. */
  setKeyFrom(room) {
    const k = keyLight(room), R = 320;
    this._room = room; this._keyFrom = k.from;
    this.key.position.set(k.from[0] * R, k.from[1] * R, k.from[2] * R);
    if (this._photo) this._fitPhotoShadow();
    // fill: the key mirrored to the other side and lower, like a bounce card. It opens the shadow
    // side (the wall facing away from the key went a heavy taupe without it) and casts none.
    const h = Math.hypot(k.from[0], k.from[2]) || 1;
    const f = new THREE.Vector3(-k.from[0] / h, 0.5, Math.max(0.6, k.from[2] / h)).normalize().multiplyScalar(R);
    this.fill.position.copy(f);
    this.keySource = k.source;
    this._aimEnv(k.azimuth);
  }

  async _loadHdri() {
    try {
      const tex = await new RGBELoader().setDataType(THREE.FloatType).loadAsync(HDRI_URL);
      const { width: w, height: h, data } = tex.image;
      // where its light comes from (three's equirect: column u -> azimuth (u - 0.5) * 2pi, row 0 = up)
      // and its solid-angle mean luminance, so LOOK.env sets the level whatever the file's exposure
      let sx = 0, sz = 0, sl = 0, sw = 0;
      for (let r = 0; r < h; r++) {
        const cl = Math.cos((0.5 - (r + 0.5) / h) * Math.PI);
        for (let c = 0; c < w; c++) {
          const i = (r * w + c) * 4, L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          const ph = ((c + 0.5) / w - 0.5) * 2 * Math.PI;
          sx += L * cl * Math.cos(ph); sz += L * cl * Math.sin(ph); sl += L * cl; sw += cl;
        }
      }
      this._hdri = { w, h, data, az: Math.atan2(sz, sx), mean: sl / sw, scale: LOOK.env / (sl / sw) };
      tex.dispose();
      this._envAz = null;
      this._aimEnv(this._wantAz ?? 0);
    } catch (e) {
      console.warn('PL/NNER: daylight HDRI did not load, keeping the studio environment', e);
    }
  }

  /** Turn the HDRI about the vertical so its brightest side faces azimuth `az` (radians, from +x toward +z). */
  _aimEnv(az) {
    this._wantAz = az;
    const H = this._hdri;
    if (!H) return;
    if (this._envAz != null && Math.abs(Math.atan2(Math.sin(az - this._envAz), Math.cos(az - this._envAz))) < 0.09) return;   // within 5 degrees: keep it
    const { w, h, data, scale } = H;
    const shift = ((Math.round((az - H.az) / (2 * Math.PI) * w) % w) + w) % w;
    const out = new Uint16Array(w * h * 4), toHalf = THREE.DataUtils.toHalfFloat;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const i = (r * w + c) * 4, o = (r * w + (c + shift) % w) * 4;
      out[o] = toHalf(data[i] * scale); out[o + 1] = toHalf(data[i + 1] * scale); out[o + 2] = toHalf(data[i + 2] * scale); out[o + 3] = toHalf(1);
    }
    const dt = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
    dt.mapping = THREE.EquirectangularReflectionMapping;
    dt.colorSpace = THREE.LinearSRGBColorSpace;
    dt.flipY = true; dt.minFilter = dt.magFilter = THREE.LinearFilter; dt.generateMipmaps = false;
    dt.needsUpdate = true;
    const rt = this._pmrem.fromEquirectangular(dt);
    dt.dispose();
    this._envRT?.dispose();
    this._envRT = rt;
    this.scene.environment = rt.texture;
    this._envAz = az;
  }

  /** Register a callback run every frame before rendering (e.g. grounding). */
  onBeforeRender(fn) { this._beforeRender = fn; }

  /** Render the current view and return an image data URL.
   *  captureImage(3)                       → the viewport at 3× its pixel size, PNG (the old call)
   *  captureImage({ width, height, type, quality }) → a FIXED output size whatever the window is
   *  (the Photo button renders 4K JPEGs this way: a small laptop window no longer means a small
   *  photo, her ask 2026-09-25 "higher quality to be able to render them after"). */
  captureImage(opts = 3) {
    const o = typeof opts === 'number' ? { scale: opts } : (opts || {});
    const vw = this.container.clientWidth || window.innerWidth;
    const vh = this.container.clientHeight || window.innerHeight;
    const w = o.width || vw, h = o.height || vh;
    const prevRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(o.width ? 1 : (o.scale || 3));
    this.renderer.setSize(w, h, false);
    if (this.camera.isPerspectiveCamera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this._beforeRender?.();                 // grounding + wall auto-hide for THIS camera position
    this._render(true);
    const url = this.renderer.domElement.toDataURL(o.type || 'image/png', o.quality);
    this.renderer.setPixelRatio(prevRatio);
    this._onResize();
    return url;
  }

  /** Put the perspective camera at a standpoint { pos, target, fov } (core/photoviews.js) with the
   *  orbit target there too, so orbiting afterwards turns about what the shot looks at. */
  lookFrom(v) {
    const cam = this.persp, c = this.controls;
    cam.position.set(v.pos[0], v.pos[1], v.pos[2]);
    c.target.set(v.target[0], v.target[1], v.target[2]);
    if (v.fov) cam.fov = v.fov;
    cam.near = 1; cam.far = 6000;
    cam.lookAt(c.target);
    cam.updateProjectionMatrix();
    c.minDistance = 12;                    // room-scale: stand close to the run if the shot wants it
    c.update();
  }

  /** Photograph the kitchen from several standpoints (core/photoviews.js) and come back to
   *  exactly the view the visitor had. Each view: { key, name, pos, target, fov }.
   *  Returns [{ key, name, url }] — data URLs of the size/type in `opts` (see captureImage). */
  captureViews(views, opts = {}) {
    const cam = this.persp, c = this.controls;
    const was = { view: this.view, cam: this.camera, pos: cam.position.clone(), target: c.target.clone(), fov: cam.fov, near: cam.near, far: cam.far, enabled: c.enabled };
    if (this.view !== '3d') this._activate(cam);
    c.enabled = false;
    const out = [];
    try {
      for (const v of views) {
        this.lookFrom(v);
        out.push({ key: v.key, name: v.name, url: this.captureImage(opts) });
      }
    } finally {
      cam.position.copy(was.pos); c.target.copy(was.target);
      cam.fov = was.fov; cam.near = was.near; cam.far = was.far; cam.updateProjectionMatrix();
      if (was.view !== '3d') { this._activate(was.cam); this.setView(was.view); }
      c.enabled = was.enabled; c.update();
    }
    return out;
  }

  add(obj) { this.scene.add(obj); }
  remove(obj) { this.scene.remove(obj); }

  _onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.persp.aspect = this.aspect;
    this.persp.updateProjectionMatrix();
    if (this.view !== '3d') this.setView(this.view); // re-fit ortho frustum
  }

  _tick() {
    requestAnimationFrame(this._tick);
    if (this._beforeRender) this._beforeRender();
    this.controls.update();
    this._render();
  }

  /** One frame. In photo mode the contact shading (scene/photoFx.js) is laid over it. */
  _render(capture = false) {
    // photo mode: the 6144 shadow map is redrawn every 8th preview frame and before every saved photo,
    // not every frame; nothing that casts a shadow moves while a shot is being framed
    if (this._photo) this.renderer.shadowMap.needsUpdate = capture || (this._shadowTick = (this._shadowTick || 0) + 1) % 8 === 1;
    this.renderer.render(this.scene, this.camera);
    if (this._photoFx && this.camera.isPerspectiveCamera) this._photoFx.render(this.camera);
  }

  /** PHOTO MODE ONLY (render step 3): a finer, room-fitted key shadow and the contact shading.
   *  The live planner keeps its 3072 shadow and never loads photoFx.js. `photoReady` resolves when
   *  the effects are in, so a capture can wait for them. Off puts everything back as it was. */
  setPhotoQuality(on) {
    const key = this.key, sh = key.shadow;
    if (on && !this._photo) {
      this._photo = true;
      this._liveShadow = { size: sh.mapSize.x, bias: sh.bias, normalBias: sh.normalBias, radius: sh.radius, cam: [sh.camera.left, sh.camera.right, sh.camera.top, sh.camera.bottom, sh.camera.near, sh.camera.far] };
      const max = this.renderer.capabilities.maxTextureSize || 4096;
      this._setShadowMap(Math.min(PHOTO_SHADOW.size, max));
      this.renderer.shadowMap.autoUpdate = false; this._shadowTick = 0;
      sh.bias = PHOTO_SHADOW.bias; sh.normalBias = PHOTO_SHADOW.normalBias; sh.radius = PHOTO_SHADOW.radius;
      this._fitPhotoShadow();
      this.photoReady = import('./photoFx.js').then(({ PhotoAO }) => {
        if (this._photo && !this._photoFx) this._photoFx = new PhotoAO(this.renderer, this.scene, this.persp);
      }).catch((e) => console.warn('PL/NNER: photo contact shading did not load', e));
    } else if (!on && this._photo) {
      this._photo = false;
      this._photoFx?.dispose(); this._photoFx = null;
      const L = this._liveShadow;
      this._setShadowMap(L.size);
      this.renderer.shadowMap.autoUpdate = true;
      sh.bias = L.bias; sh.normalBias = L.normalBias; sh.radius = L.radius;
      [sh.camera.left, sh.camera.right, sh.camera.top, sh.camera.bottom, sh.camera.near, sh.camera.far] = L.cam;
      sh.camera.updateProjectionMatrix();
      key.target.position.set(0, 0, 0); key.target.updateMatrixWorld();
      this.setKeyFrom(this._room || {});
      this.photoReady = Promise.resolve();
    }
    return this.photoReady || Promise.resolve();
  }

  _setShadowMap(size) {
    const sh = this.key.shadow;
    if (sh.mapSize.x === size) return;
    sh.mapSize.set(size, size);
    sh.map?.dispose(); sh.map = null;          // re-allocated at the new size on the next frame
  }

  /** Photo mode: the key's shadow camera wraps the room's bounding sphere, no more, so every texel
   *  lands on the kitchen (the live frustum is a fixed 480" square whatever the room). */
  _fitPhotoShadow() {
    const r0 = this._room || {}, W = r0.width || 144, D = r0.depth || 120, H = r0.height || 96;
    const f = this._keyFrom || [0, 1, 0], rad = 0.5 * Math.hypot(W, D, H) + 6, R = Math.max(320, rad + 60);
    const key = this.key, cam = key.shadow.camera;
    key.target.position.set(0, H / 2, 0); key.target.updateMatrixWorld();
    key.position.set(f[0] * R, H / 2 + f[1] * R, f[2] * R);
    cam.left = -rad; cam.right = rad; cam.top = rad; cam.bottom = -rad;
    cam.near = R - rad - 10; cam.far = R + rad + 10;
    cam.updateProjectionMatrix();
  }

  /**
   * Frame the camera on a room so the whole footprint fits the viewport from a
   * friendly 3/4 angle looking into the back-left corner. Distance is derived
   * from the camera FOV so nothing is clipped and the room reads clearly.
   */
  frameRoom(width, depth, height) {
    this.lastRoom = { width, depth, height };
    const target = new THREE.Vector3(0, height * 0.34, 0);
    this.controls.target.copy(target);

    // bounding radius of the room (footprint diagonal + a bit of height)
    const radius = 0.5 * Math.hypot(width, depth) + height * 0.42;
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1.6;
    const fitH = radius / Math.sin(fov / 2);
    const fitW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    const dist = Math.max(fitH, fitW) * 1.18; // >1 so the whole room sits inside with margin

    // viewing direction: out toward +x / +z, gently elevated → see both walls
    const dir = new THREE.Vector3(0.62, 0.58, 1).normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);

    this.camera.near = 1;
    this.camera.far = dist * 4 + 2000;
    this.camera.updateProjectionMatrix();

    this.controls.minDistance = Math.max(24, radius * 0.22);
    this.controls.maxDistance = dist * 2.4;
    this.controls.update();
  }

  /**
   * Walkthrough: stand IN the kitchen at eye level looking down the back run —
   * the view that sells the design. Cycles through a few standpoints on
   * repeated presses. Orbit stays live so the visitor can look around.
   */
  walkthrough() {
    if (this.view !== '3d') this.setView('3d');
    const { width, depth, height } = this.lastRoom;
    const EYE = 63;                                     // standing eye height (5'3")
    const spots = [
      // from the front-right corner, looking at the sink/range wall
      { pos: [width * 0.32, EYE, depth * 0.42], tgt: [-width * 0.1, 42, -depth / 2] },
      // from the front-left, looking across the room to the back-right
      { pos: [-width * 0.3, EYE, depth * 0.4], tgt: [width * 0.15, 42, -depth / 2] },
      // centre of the room, straight at the back run
      { pos: [0, EYE, depth * 0.3], tgt: [0, 40, -depth / 2] },
    ];
    this._walkIdx = ((this._walkIdx ?? -1) + 1) % spots.length;
    const s = spots[this._walkIdx];
    this.camera.position.set(s.pos[0], Math.min(EYE, height - 8), s.pos[2]);
    this.controls.target.set(s.tgt[0], s.tgt[1], s.tgt[2]);
    this.controls.minDistance = 12;                     // allow close, room-scale viewing
    this.camera.near = 1;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Re-frame the last room (used by the Recenter button). */
  resetView() {
    this._walkIdx = undefined;
    if (this.view !== '3d') { this.setView(this.view); return; }
    const r = this.lastRoom;
    this.frameRoom(r.width, r.depth, r.height);
  }

  _activate(cam) {
    this.camera = cam;
    this.controls.object = cam;
  }

  /**
   * Switch between named views. '3d' uses the perspective camera and free
   * orbit; plan and the four elevations use a true orthographic camera with
   * rotation locked (pan + zoom only) so they read like drawings.
   */
  setView(mode) {
    this.view = mode;
    const { width, depth, height } = this.lastRoom;
    const aspect = this.aspect || 1.6;
    const c = this.controls;

    if (mode === '3d') {
      // restore free orbit
      c.enableDamping = true;
      c.enableRotate = true;
      c.zoomToCursor = true;       // zoom into the area under the pointer
      c.minPolarAngle = 0;
      c.maxPolarAngle = Math.PI / 2 - 0.04;
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
      c.minDistance = 36;
      this.setNavMode(this.navMode);
      this._activate(this.persp);
      this.frameRoom(width, depth, height);
      return;
    }

    // orthographic plan / elevation
    const cam = this.ortho;
    const big = Math.max(width, depth, height);
    const HALF = Math.PI / 2;
    let pos, tgt, up = new THREE.Vector3(0, 1, 0), spanW, spanH, phi, theta;
    switch (mode) {
      case 'plan':
        pos = [0, big * 2, 0]; tgt = [0, 0, 0]; up = new THREE.Vector3(0, 0, -1);
        spanW = width; spanH = depth; phi = 0.0008; theta = 0; break;
      case 'back':
        pos = [0, height / 2, big * 2]; tgt = [0, height / 2, -depth / 2]; spanW = width; spanH = height; phi = HALF; theta = 0; break;
      case 'front':
        pos = [0, height / 2, -big * 2]; tgt = [0, height / 2, depth / 2]; spanW = width; spanH = height; phi = HALF; theta = Math.PI; break;
      case 'left':
        pos = [big * 2, height / 2, 0]; tgt = [-width / 2, height / 2, 0]; spanW = depth; spanH = height; phi = HALF; theta = HALF; break;
      case 'right':
        pos = [-big * 2, height / 2, 0]; tgt = [width / 2, height / 2, 0]; spanW = depth; spanH = height; phi = HALF; theta = -HALF; break;
      default: return;
    }

    const margin = 1.18;
    const halfH = Math.max(spanH, spanW / aspect) / 2 * margin;
    const halfW = halfH * aspect;
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
    cam.near = -big * 8; cam.far = big * 8;
    cam.up.copy(up);
    cam.zoom = 1;
    cam.position.set(pos[0], pos[1], pos[2]);
    cam.updateProjectionMatrix();

    this._activate(cam);
    c.target.set(tgt[0], tgt[1], tgt[2]);
    // LOCK the orientation completely: no rotation, no damping drift. Zoom can
    // then only scale about the centre, and pan can only translate the centre.
    c.enableDamping = false;
    c.enableRotate = false;
    c.zoomToCursor = false;        // drawings zoom about the centre
    c.mouseButtons.LEFT = THREE.MOUSE.PAN; // drawings: left-drag pans
    c.minDistance = 1;
    c.maxDistance = big * 8;
    c.minPolarAngle = c.maxPolarAngle = phi;
    c.minAzimuthAngle = c.maxAzimuthAngle = theta;
    c.update();
  }

  /** 'orbit' = left-drag rotates; 'pan' = left-drag pans (both keep right-drag pan). */
  setNavMode(mode) {
    this.navMode = mode;
    if (this.view === '3d') {
      this.controls.mouseButtons.LEFT = mode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    }
  }
}
