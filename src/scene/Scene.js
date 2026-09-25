// Scene.js — renderer, camera, OrbitControls, soft studio lighting.
//
// World units are inches. Front of every cabinet faces +Z, base at y = 0.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BRAND } from '../core/catalogue.js';

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
    // No tone mapping = paint colours render true (ACES filmic was darkening +
    // desaturating them). A bright studio environment does the lifting instead.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
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
    // Bright studio set-up, but with a clear KEY direction so the shaker
    // relief, reveals and knobs cast real micro-shadows. The hemisphere's
    // ground tint is a shade darker than before — a gentle AO illusion on
    // downward-facing surfaces — while the sum of light on the fronts stays
    // the same, so painted finishes still read true to their swatch hex.
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb7a992, 0.82);
    this.scene.add(hemi);

    // Measured 2026-09-22 (her: "why does the back wall look white"): the key's front component
    // + the fill + the hemisphere summed to ~1.1 on every surface facing the room, so the back
    // wall and every cabinet front CLIPPED to white (Ghost #F7F4EB rendered 255,250,237) while
    // the side walls, in shade, read as painted. The fill now comes from straight left (no front
    // component) and the key is a touch lower: Ghost renders 248,242,229, the back wall no longer
    // blows out, and the side walls barely change.
    const key = new THREE.DirectionalLight(0xfff6ea, 1.6);
    key.position.set(150, 210, 170);
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

    const fill = new THREE.DirectionalLight(0xeef2ff, 0.55);
    fill.position.set(-170, 130, 0);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.4);
    rim.position.set(-40, 110, -190);
    this.scene.add(rim);

    // Real studio environment (soft white box) — this is the key fix: the old
    // environment was an empty (black) scene, so reflections darkened surfaces.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose?.();
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
    this.renderer.render(this.scene, this.camera);
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
    this.renderer.render(this.scene, this.camera);
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
