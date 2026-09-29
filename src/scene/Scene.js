// Scene.js — renderer, camera, OrbitControls, soft studio lighting.
//
// World units are inches. Front of every cabinet faces +Z, base at y = 0.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { BRAND } from '../core/catalogue.js';
import { keyLight, sunLight } from '../core/keylight.js';
import { DETAIL_ON } from '../models/surfaceDetail.js';
import { setWorktopDetail, setPaintPhoto } from '../models/materials.js';
import { setPanelShade } from '../models/cabinet.js';

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
// The LIVE key shadow keeps its 3072 map (no extra cost) but is fitted to the room too (~2mm a texel
// in a 14' room, was a fixed 480" square, ~4mm), with small offsets: the old 0.18" normal bias let a
// sliver of light in under the worktop's lip, and its edge stepped down the top rail as diagonal
// stripes (found by the construction guard, 2026-09-29).
export const LIVE_SHADOW = { bias: 0.0001, normalBias: 0.04 };
// Photo mode's CLOSED ROOM with a window (render step 4): the key becomes the sun through the window
// and the walls and ceiling block it everywhere else, so the ambient side carries the room; these are
// its levels (tuned on the hero kitchen's fronts against their hex). SUN_SOFT / SUN_SAMPLES: a saved
// photo averages that many sun directions inside a cone of that half-angle, which softens the glazing-
// bar shadows the way a real window's are; the live preview uses one (hard edges while framing).
// W2W-242: the ambient side cut back (it lit every face alike: the flat, washed-out look she called
// out on 2026-09-29, "this still doesn't look good"); the SOFTBOX below gives the room its shape.
// Checked on Ghost / Nettle / Skillet close-ups: panels within ~5% of the W2W-240 levels.
export const PHOTO_SUN = { sun: 5.0, env: 0.7, fill: 0.9, hemi: 0.35, exposure: 1.6 };
// Photo mode's SOFTBOX (W2W-242): a shadow-casting light INSIDE the closed room, near the ceiling,
// behind the camera and turned `side` radians off it, aimed at what the shot looks at, falling off
// gently with distance (decay 1: a big softbox, not a bare bulb; the square law burnt out a tall standing
// near it in the island kitchen). It throws the wall cabinets' shadow down the splash and the knobs'
// onto the doors, and makes the near end of a run a little brighter than the far one. `lux` = the light
// arriving at the aim point (intensity = lux x distance); `drop` = inches under the ceiling.
export const PHOTO_BOX = { lux: 1.0, side: 0.3, drop: 8, inset: 8, decay: 1, color: 0xfffaf3 };
// Photo mode's fill (W2W-240): from behind the viewer and well above (rise 0.9), so the faces of a
// shaker panel's 5mm step turn differently to it; straight from the camera it lit frame and panel alike.
// (It casts no shadow: the closed room's ceiling and front wall would shade everything.)
export const PHOTO_FILL = { side: 0, rise: 0.9 };
// where the HDRI's bright side sits in every sunlit room: behind the back run, turned 32 degrees, as
// the hero kitchen's back-wall window put it when PHOTO_SUN was calibrated (see _setSun)
const PHOTO_SUN_ENV_AZ = Math.atan2(-Math.cos(32 * Math.PI / 180), Math.sin(32 * Math.PI / 180));
const SUN_SOFT = 0.4 * Math.PI / 180, SUN_SAMPLES = 12;
// every saved frame is that many renders averaged; each also shifts the camera by under a pixel (a
// Halton pattern), so a 3mm reveal thinner than a pixel draws as an even line, never dashes (W2W-242)
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
// photo mode's still (Scene._stillOnScreen): how long the view stands still first, and the supersampling
const STILL_SETTLE_MS = 350, STILL_SCALE = 1.5;   // the real sun is ~0.27 deg in radius
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
    key.shadow.bias = LIVE_SHADOW.bias;
    key.shadow.normalBias = LIVE_SHADOW.normalBias;
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
    if (this._photo) { this._sun = sunLight(room); this._photoRoomKey = null; this._sunOn = false; }
    this._fitShadow();
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
    const { w: vw, h: vh } = this._viewSize();
    const w = o.width || vw, h = o.height || vh;
    const prevRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(o.width ? 1 : (o.scale || 3));
    this.renderer.setSize(w, h, false);
    if (this.camera.isPerspectiveCamera) { this.camera.aspect = w / h; if (this.camera === this.persp) this._applyShift(w, h); this.camera.updateProjectionMatrix(); }
    if (this._photo) { this._applyPhotoRoom(); this._aimPhotoFill(); }   // closed or open for THIS camera, before the wall auto-hide
    this._beforeRender?.();                 // grounding + wall auto-hide for THIS camera position
    this._render(true);
    const W = this.renderer.domElement.width, H = this.renderer.domElement.height;
    const src = this._photo && o.softSun !== false ? this._softSunFrame(W, H) : this.renderer.domElement;
    let url;
    if (o.into) {                                       // drawn (scaled) into a canvas instead: photo mode's still
      const g = o.into.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.clearRect(0, 0, o.into.width, o.into.height); g.drawImage(src, 0, 0, o.into.width, o.into.height);
      url = o.into;
    } else url = src.toDataURL(o.type || 'image/png', o.quality);
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
    this._shift = v.shift || 0;               // a lens shift (magazine presets): the frame moves, the camera stays level
    this._applyShift();
    cam.updateProjectionMatrix();
    c.minDistance = 12;                    // room-scale: stand close to the run if the shot wants it
    // a LEVEL view (the magazine presets) stays level: the orbit's floor clamp (2.3 degrees short of
    // horizontal) would otherwise tip it down on c.update() and lean every vertical. Still never below.
    const off = cam.position.clone().sub(c.target), phi = Math.acos(Math.min(1, Math.max(-1, off.y / (off.length() || 1))));
    c.maxPolarAngle = Math.min(Math.PI / 2, Math.max(Math.PI / 2 - 0.04, phi));
    c.update();
  }

  /** The lens shift as a view offset on the perspective camera, for a frame of w x h (default: the
   *  view on screen). shift = the fraction of the frame height the picture moves down. */
  _applyShift(w, h) {
    const cam = this.persp;
    if (!w || !h) ({ w, h } = this._viewSize());
    if (this._shift) cam.setViewOffset(w, h, 0, this._shift * h, w, h); else if (cam.view) cam.clearViewOffset();
  }

  /** Photograph the kitchen from several standpoints (core/photoviews.js) and come back to
   *  exactly the view the visitor had. Each view: { key, name, pos, target, fov }.
   *  Returns [{ key, name, url }] — data URLs of the size/type in `opts` (see captureImage). */
  captureViews(views, opts = {}) {
    const cam = this.persp, c = this.controls;
    const was = { view: this.view, cam: this.camera, pos: cam.position.clone(), target: c.target.clone(), fov: cam.fov, near: cam.near, far: cam.far, enabled: c.enabled, shift: this._shift || 0 };
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
      cam.fov = was.fov; cam.near = was.near; cam.far = was.far; this._shift = was.shift; this._applyShift(); cam.updateProjectionMatrix();
      if (was.view !== '3d') { this._activate(was.cam); this.setView(was.view); }
      c.enabled = was.enabled; c.update();
    }
    return out;
  }

  add(obj) { this.scene.add(obj); }
  remove(obj) { this.scene.remove(obj); }

  /** Photo mode's VIEWFINDER: the canvas becomes exactly the saved photo's frame (`aspect`, the
   *  photo's width / height), as large as fits in the stage below `top` px (or a function giving it:
   *  the photo bar, which can wrap) and
   *  centred, so what is on screen is what Save writes. null = the canvas fills the stage again. */
  setViewfinder(aspect, top = 0) {
    this._finder = aspect ? { aspect, top } : null;
    if (!aspect) this._hideStill();
    this._onResize();
  }

  /** The size the view is drawn at on screen: the whole stage, or photo mode's viewfinder frame. */
  _viewSize() {
    const cw = this.container.clientWidth || window.innerWidth, ch = this.container.clientHeight || window.innerHeight;
    if (!this._finder || this.view !== '3d') return { w: cw, h: ch, cw, ch };
    const { aspect } = this._finder, top = typeof this._finder.top === 'function' ? this._finder.top() : this._finder.top;
    const pad = 14, aw = cw - 2 * pad, ah = ch - top - 2 * pad;
    const w = Math.max(1, Math.round(Math.min(aw, ah * aspect))), h = Math.max(1, Math.round(w / aspect));
    return { w, h, cw, ch, x: Math.round((cw - w) / 2), y: Math.round(top + pad + (ah - h) / 2) };
  }

  _onResize() {
    const { w, h, x, y } = this._viewSize(), st = this.renderer.domElement.style;
    this.renderer.setSize(w, h, false);
    // the stage's CSS stretches the canvas to fill it (!important), so the frame overrides it inline
    if (x != null) {
      for (const [k, v] of [['position', 'absolute'], ['left', `${x}px`], ['top', `${y}px`], ['width', `${w}px`], ['height', `${h}px`]]) st.setProperty(k, v, 'important');
    } else for (const k of ['position', 'left', 'top', 'width', 'height']) st.removeProperty(k);
    this.aspect = w / h;
    this.persp.aspect = this.aspect;
    if (this._shift) this._applyShift(w, h);
    this.persp.updateProjectionMatrix();
    if (this.view !== '3d') this.setView(this.view); // re-fit ortho frustum
  }

  _tick() {
    requestAnimationFrame(this._tick);
    if (this._photo) this._applyPhotoRoom();
    if (this._beforeRender) this._beforeRender();
    this.controls.update();
    if (this._photo && this._stillOnScreen()) return;     // the finished still is showing: nothing to redraw
    if (this._photo) this._aimPhotoFill();
    this._render();
  }

  /** PHOTO MODE: the fill over the viewer's left shoulder, high (PHOTO_FILL). */
  _aimPhotoFill(cam = this.camera, target = this.controls.target) {
    const dx = cam.position.x - target.x, dz = cam.position.z - target.z;
    if (Math.hypot(dx, dz) < 1e-3) return;
    const a = Math.atan2(dz, dx) + PHOTO_FILL.side, f = new THREE.Vector3(Math.cos(a), PHOTO_FILL.rise, Math.sin(a)).normalize();
    const H = (this._room || {}).height || 96, fill = this.fill;
    fill.target.position.set(0, H / 2, 0); fill.target.updateMatrixWorld();
    fill.position.set(f.x * 320, H / 2 + f.y * 320, f.z * 320);
    const box = this._softbox;
    if (box?.visible) {
      const r = this._room || {}, W = r.width || 144, D = r.depth || 120, dist = Math.hypot(dx, dz);
      const b = Math.atan2(dz, dx) + PHOTO_BOX.side, hx = W / 2 - PHOTO_BOX.inset, hz = D / 2 - PHOTO_BOX.inset;
      box.position.set(Math.max(-hx, Math.min(hx, target.x + Math.cos(b) * dist)), H - PHOTO_BOX.drop, Math.max(-hz, Math.min(hz, target.z + Math.sin(b) * dist)));
      box.target.position.copy(target); box.target.updateMatrixWorld();
      box.intensity = PHOTO_BOX.lux * box.position.distanceTo(target) ** PHOTO_BOX.decay;
    }
  }

  /** Photo mode's STILL. The live preview draws the contact shading from an un-smoothed depth pass, so
   *  every reveal and joint thinner than a pixel breaks into grey dashes (her catch 2026-09-29: "doesn't
   *  look good quality when I click photo"). Once the view has stood still for a moment, the frame is
   *  rendered exactly as Save renders it (the soft sun, the shading), 1.5x larger and scaled down, and
   *  shown over the canvas; any move of the camera, a new angle or a change to the kitchen
   *  (invalidateStill) hands back to the live preview. */
  _stillOnScreen() {
    const cam = this.persp, cv = this.renderer.domElement;
    if (!this._finder || this.camera !== cam || !this._photoFx) { this._hideStill(); return false; }
    const key = [...cam.matrixWorld.elements, ...cam.projectionMatrix.elements].map((v) => v.toFixed(4)).join(',') + `|${cv.width}x${cv.height}|${this._stillGen || 0}`;
    const now = performance.now();
    if (key !== this._stillKey) { this._stillKey = key; this._stillAt = now; this._hideStill(); return false; }
    if (this._stillShown) return true;
    if (now - this._stillAt < STILL_SETTLE_MS) return false;
    const el = this._stillEl || (this._stillEl = Object.assign(document.createElement('canvas'), { className: 'photo-still' }));
    el.width = cv.width; el.height = cv.height;
    this.captureImage({ width: Math.round(cv.width * STILL_SCALE), height: Math.round(cv.height * STILL_SCALE), into: el });
    // exactly over the canvas (the stage's CSS stretches every canvas in it, !important, so this is too)
    for (const k of ['position', 'left', 'top', 'width', 'height']) el.style.setProperty(k, cv.style.getPropertyValue(k), 'important');
    el.style.pointerEvents = 'none'; el.style.zIndex = '1';
    if (el.parentNode !== this.container) this.container.appendChild(el);
    el.style.display = 'block'; this._stillShown = true;
    this._stillKey = key;                                  // (the capture put the camera back exactly)
    return true;
  }
  _hideStill() { if (this._stillShown) { this._stillEl.style.display = 'none'; this._stillShown = false; } }
  /** The kitchen changed under a still (a finish, a cabinet): draw the live preview again. */
  invalidateStill() { this._stillGen = (this._stillGen || 0) + 1; }

  /** One frame. In photo mode the contact shading (scene/photoFx.js) is laid over it. */
  /** Photo mode, every frame: can this camera see a CLOSED room? Inside it, or standing just outside a
   *  wall (the straight-on shot steps back through the front wall): yes, and the near plane is pushed
   *  past that wall so it is cut by the picture's edge, never seen from behind. Above the ceiling (a
   *  doll's-house view) or far outside: no, the live cut-away stays. With a window, closed = sun. */
  _photoRoomFor(cam) {
    const r = this._room || {}, W = r.width || 144, D = r.depth || 120, H = r.height || 96, T = 4, REACH = 120;
    const p = cam.position;
    const out = { back: -D / 2 - p.z, front: p.z - D / 2, left: -W / 2 - p.x, right: p.x - W / 2 };
    if (p.y >= H - 1 || Object.values(out).some((v) => v > REACH)) return { closed: false, near: 1 };
    // Outside a wall the room stays OPEN (the live cut-away), the near plane at 1: pushing the near
    // plane past the wall cut the island and the side runs in half and cropped the floor whenever the
    // view was at an angle or zoomed in (her catch 2026-09-29). Closed only from inside the room.
    if (Object.values(out).some((v) => v > -T)) return { closed: false, near: 1 };
    // the inside face of every wall the camera stands behind: its farthest corner in view depth
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert(), v = new THREE.Vector3();
    let near = 1;
    const face = { back: [[-W / 2, -D / 2], [W / 2, -D / 2]], front: [[-W / 2, D / 2], [W / 2, D / 2]], left: [[-W / 2, -D / 2], [-W / 2, D / 2]], right: [[W / 2, -D / 2], [W / 2, D / 2]] };
    for (const [name, o] of Object.entries(out)) {
      if (o <= -T) continue;                   // well inside this wall: nothing to clip
      for (const [x, z] of face[name]) for (const y of [0, H]) near = Math.max(near, -v.set(x, y, z).applyMatrix4(inv).z + 0.5);
    }
    return { closed: true, near: Math.min(near, 160) };
  }

  _applyPhotoRoom() {
    const cam = this.camera;
    if (!cam.isPerspectiveCamera) return;
    const pr = this._photoRoomFor(cam), sun = pr.closed && !!this._sun;
    if (Math.abs(cam.near - pr.near) > 1e-3) { cam.near = pr.near; cam.updateProjectionMatrix(); }
    const key = pr.closed ? (sun ? 'sun' : 'closed') : 'open';
    if (key === this._photoRoomKey) return;
    this._photoRoomKey = key;
    this.onPhotoClosed?.(pr.closed ? { sun } : false);
    this._setSun(sun);
  }

  /** Swap the key for the sun through the window (and the ambient levels with it), or back.
   *  In the sun, the fronts of the run are lit by the room's bounce alone, and they must still read as
   *  their hex whatever wall the window is on. Metering them against a turned HDRI did not hold (a
   *  side window put the HDRI's bright side in the paint's reflections: fronts ~18 levels light), so
   *  the bounce is the SAME in every sunlit room: the HDRI's bright side behind the run (as for the
   *  hero kitchen's back-wall window, where PHOTO_SUN was calibrated: F10 renders 180,175,143 against
   *  Nettle 180,178,150) and a fill from the camera side, a bounce card. The sun itself still comes
   *  in through whichever window there is; the environment is only soft ambient, so its angle barely
   *  shows. */
  _setSun(on) {
    if (on === !!this._sunOn) return;
    this._sunOn = on;
    const L = on ? { ...LOOK, ...PHOTO_SUN } : LOOK;
    this.key.intensity = on ? PHOTO_SUN.sun : LOOK.key;
    this.hemi.intensity = L.hemi; this.fill.intensity = L.fill;
    this.renderer.toneMappingExposure = L.exposure;
    if (this._hdri) { this._hdri.scale = L.env / this._hdri.mean; this._envAz = null; }
    if (this._softbox) this._softbox.visible = on;
    if (on) {
      this._aimEnv(PHOTO_SUN_ENV_AZ);
      this.fill.position.set(0, 0.45, 1).normalize().multiplyScalar(320);      // from the camera side
    } else {
      this.setKeyFrom(this._room || {});      // key, fill and environment back to the room's key light
    }
    this._fitShadow(on ? this._sun.from : this._keyFrom);
    this.renderer.shadowMap.needsUpdate = true;
  }

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
      this._sun = sunLight(this._room || {});
      this._photoRoomKey = null;
      this._fitShadow();
      this._photoPaint(true);
      if (!this._softbox) {
        const box = this._softbox = new THREE.SpotLight(PHOTO_BOX.color, 0, 0, Math.PI * 0.42, 1, PHOTO_BOX.decay);
        box.castShadow = true; box.shadow.mapSize.set(2048, 2048);
        box.shadow.bias = -0.0004; box.shadow.normalBias = 0.03; box.shadow.camera.near = 10; box.shadow.camera.far = 900;
        box.visible = false; this.scene.add(box, box.target);
      }
      DETAIL_ON.value = 1; setWorktopDetail(true); this.onPhotoDetail?.(true);   // materials, render step 5
      setPaintPhoto(true); setPanelShade(true);                             // eggshell paint, panel shade (W2W-240)
      this.photoReady = import('./photoFx.js').then(({ PhotoAO }) => {
        if (this._photo && !this._photoFx) this._photoFx = new PhotoAO(this.renderer, this.scene, this.persp);
      }).catch((e) => console.warn('PL/NNER: photo contact shading did not load', e));
    } else if (!on && this._photo) {
      this._photo = false;
      this._hideStill();
      this._setSun(false);
      this._photoRoomKey = null;
      this.onPhotoClosed?.(false);
      this._photoPaint(false);
      DETAIL_ON.value = 0; setWorktopDetail(false); this.onPhotoDetail?.(false);
      setPaintPhoto(false); setPanelShade(false);
      this.fill.target.position.set(0, 0, 0); this.fill.target.updateMatrixWorld();   // the live fill back where setKeyFrom puts it
      this.setKeyFrom(this._room || {});
      this.persp.near = 1; this.persp.updateProjectionMatrix();
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

  /** Photo mode: every wall-paint material (walls, ceiling, the plaster hood) gets a faint roughness
   *  variation, so big painted planes stop reading as flat CG; off restores them. */
  _photoPaint(on) {
    const tex = on ? paintRoughness() : null;
    this.scene.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (!m.userData?.wallPaint) continue;
        if (on && !m.userData.livePaint) { m.userData.livePaint = { roughness: m.roughness, map: m.roughnessMap }; m.roughnessMap = tex; m.roughness = 1; m.needsUpdate = true; }
        else if (!on && m.userData.livePaint) { m.roughness = m.userData.livePaint.roughness; m.roughnessMap = m.userData.livePaint.map; delete m.userData.livePaint; m.needsUpdate = true; }
      }
    });
  }

  /** A saved photo (and photo mode's still): the frame rendered SUN_SAMPLES times and averaged. In the
   *  sun, the sun moves about inside a small cone, so its shadows (the glazing bars on the floor) have
   *  soft edges; always, the camera shifts by under a pixel each time, so thin reveals and joints come
   *  out as even lines instead of dashes (W2W-242). */
  _softSunFrame(w, h) {
    const cam = this.camera, jit = cam.isPerspectiveCamera, was = cam.view ? { ...cam.view } : null;
    const fw = was ? was.fullWidth : w, fh = was ? was.fullHeight : h;
    const key = this.key, base = key.position.clone(), t = key.target.position, dir = base.clone().sub(t), R = dir.length();
    dir.normalize();
    const u = new THREE.Vector3(0, 1, 0).cross(dir).normalize(), v = dir.clone().cross(u);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true }), acc = new Float32Array(w * h * 4);
    for (let i = 0; i < SUN_SAMPLES; i++) {
      const r = SUN_SOFT * Math.sqrt((i + 0.5) / SUN_SAMPLES), a = i * 2.39996323;      // a Vogel disc: even, deterministic
      if (this._sunOn) key.position.copy(t).addScaledVector(dir.clone().addScaledVector(u, Math.cos(a) * Math.tan(r)).addScaledVector(v, Math.sin(a) * Math.tan(r)).normalize(), R);
      if (jit) cam.setViewOffset(fw, fh, (was ? was.offsetX : 0) + (halton(i + 1, 2) - 0.5) * fw / w, (was ? was.offsetY : 0) + (halton(i + 1, 3) - 0.5) * fh / h, was ? was.width : fw, was ? was.height : fh);
      this.renderer.shadowMap.needsUpdate = true;
      this._render(true);
      g.drawImage(this.renderer.domElement, 0, 0);
      const d = g.getImageData(0, 0, w, h).data;
      for (let k = 0; k < d.length; k++) acc[k] += d[k];
    }
    key.position.copy(base); this.renderer.shadowMap.needsUpdate = true;
    if (jit) { if (was) cam.setViewOffset(was.fullWidth, was.fullHeight, was.offsetX, was.offsetY, was.width, was.height); else cam.clearViewOffset(); }
    const img = g.createImageData(w, h);
    for (let k = 0; k < acc.length; k++) img.data[k] = Math.round(acc[k] / SUN_SAMPLES);
    g.putImageData(img, 0, 0);
    return cv;
  }

  _setShadowMap(size) {
    const sh = this.key.shadow;
    if (sh.mapSize.x === size) return;
    sh.mapSize.set(size, size);
    sh.map?.dispose(); sh.map = null;          // re-allocated at the new size on the next frame
  }

  /** The key's shadow camera wraps the room's bounding sphere, no more, so every texel lands on the
   *  kitchen (live and photo mode alike; photo mode just has four times the texels). */
  _fitShadow(from) {
    const r0 = this._room || {}, W = r0.width || 144, D = r0.depth || 120, H = r0.height || 96;
    const f = from || (this._sunOn && this._sun ? this._sun.from : this._keyFrom) || [0, 1, 0], rad = 0.5 * Math.hypot(W, D, H) + 6, R = Math.max(320, rad + 60);
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

// Photo mode's matte paint: a soft, low-contrast roughness variation (0.8 - 1.0), seeded, 512px.
let _paintRough = null;
function paintRoughness() {
  if (_paintRough || typeof document === 'undefined') return _paintRough;
  const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'), img = g.createImageData(N, N);
  let a = 0x2545f491; const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const octave = (cells) => { const grid = Array.from({ length: (cells + 1) * (cells + 1) }, rnd); for (let c = 0; c < cells; c++) grid[cells * (cells + 1) + c] = grid[c]; for (let r = 0; r <= cells; r++) grid[r * (cells + 1) + cells] = grid[r * (cells + 1)];
    return (x, y) => { const fx = x / N * cells, fy = y / N * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, s = (q) => q * q * (3 - 2 * q);
      const at = (i, j) => grid[(j % (cells + 1)) * (cells + 1) + (i % (cells + 1))];
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * s(tx), bot = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * s(tx); return top + (bot - top) * s(ty); }; };
  const o1 = octave(4), o2 = octave(11), o3 = octave(29);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = 0.55 * o1(x, y) + 0.3 * o2(x, y) + 0.15 * o3(x, y), v = Math.round(255 * (0.8 + 0.2 * n)), k = (y * N + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _paintRough = new THREE.CanvasTexture(cv); _paintRough.wrapS = _paintRough.wrapT = THREE.RepeatWrapping;
  return _paintRough;
}
