// surfaceDetail.js — the micro-surface of paint and brushed steel (render step 5, 2026-09-28).
//
// PHOTO MODE ONLY: every material given a detail here reads one shared uniform (DETAIL_ON), which
// Scene.setPhotoQuality turns on and off; in the live planner the shader skips it on a uniform branch.
//
// Why not an ordinary normal map: the cabinet parts are boxes whose UVs run 0..1 on every face, so a
// map would be stretched once over a 30" door and squeezed once onto a 22mm leg. The detail is looked
// up in WORLD space instead (x/y or z/y on a vertical face, x/z on a horizontal one: all boxes here
// are axis-aligned or turned in quarter turns), so a brush mark is the same size on every part. The
// height perturbs the normal by Mikkelsen's surface-gradient bump (height in inches, so it is right
// at any distance: a far face mips to flat) and a second channel scales the roughness a little.
//
//   addDetail(material, kind)   kind: 'paint' | 'brushed'   (returns the material)
//   DETAIL_ON.value = 0 | 1

import * as THREE from 'three';

export const DETAIL_ON = { value: 0 };

// size of one tile (inches), bump height (inches), roughness swing (+-, relative)
const KINDS = {
  paint:   { tile: 6, bump: 0.0012, rough: 0.07 },     // brushed eggshell: barely there at arm's length
  brushed: { tile: 4, bump: 0.0015, rough: 0.22 },     // brushed stainless: fine lines along the grain, visible up close
};

const _tex = {};
function detailTexture(kind) {
  if (_tex[kind] || typeof document === 'undefined') return _tex[kind] || null;
  const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext?.('2d');
  if (!g) return null;                                      // a stubbed document (the node tests): no detail
  const img = g.createImageData(N, N);
  const R = rng(kind === 'paint' ? 0x51ed270b : 0x2f6b9a13);
  // tileable value noise with separate cell counts across (cx) and along (cy)
  const noise = (cx, cy) => {
    const grid = new Float32Array(cx * cy); for (let i = 0; i < grid.length; i++) grid[i] = R();
    const at = (i, j) => grid[((j % cy) + cy) % cy * cx + ((i % cx) + cx) % cx], s = (t) => t * t * (3 - 2 * t);
    return (x, y) => { const fx = x / N * cx, fy = y / N * cy, ix = Math.floor(fx), iy = Math.floor(fy), tx = s(fx - ix), ty = s(fy - iy);
      const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx, b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx; return a + (b - a) * ty; };
  };
  let h, r;
  if (kind === 'paint') {
    // brush marks: streaks running along v (up a stile), a slower waver, a little isotropic orange-peel
    const s1 = noise(96, 5), s2 = noise(40, 3), peel = noise(64, 64), blot = noise(6, 6);
    h = (x, y) => 0.5 * s1(x, y) + 0.3 * s2(x, y) + 0.2 * peel(x, y);
    r = (x, y) => 0.6 * blot(x, y) + 0.4 * s2(x, y);
  } else {
    // brushed steel: fine lines along u, varying across v
    const l1 = noise(3, 160), l2 = noise(2, 60), blot = noise(5, 5);
    h = (x, y) => 0.65 * l1(x, y) + 0.35 * l2(x, y);
    r = (x, y) => 0.5 * l1(x, y) + 0.5 * blot(x, y);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = (y * N + x) * 4;
    img.data[k] = Math.round(255 * h(x, y)); img.data[k + 1] = Math.round(255 * r(x, y)); img.data[k + 2] = 0; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  return (_tex[kind] = t);
}

const VERT_DECL = /* glsl */`
varying vec3 vDetW;
varying vec3 vDetN;
`;
const VERT_BODY = /* glsl */`
vDetW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vDetN = normalize( mat3( modelMatrix ) * objectNormal );
`;
const FRAG_DECL = /* glsl */`
uniform float uDetOn;
uniform sampler2D tDetail;
uniform float uDetTile;
uniform float uDetBump;
uniform float uDetRough;
varying vec3 vDetW;
varying vec3 vDetN;
vec2 detUV( vec3 p ) {
	vec3 a = abs( vDetN );
	if ( a.y > a.x && a.y > a.z ) return p.xz / uDetTile;
	if ( a.x > a.z ) return p.zy / uDetTile;
	return p.xy / uDetTile;
}
vec4 detSample( vec3 p ) { return texture2D( tDetail, detUV( p ) ); }
// Mikkelsen's surface-gradient bump, un-normalised so the height is in world units (inches)
vec3 detPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir ) {
	vec3 vSigmaX = dFdx( surf_pos ), vSigmaY = dFdy( surf_pos );
	vec3 R1 = cross( vSigmaY, surf_norm ), R2 = cross( surf_norm, vSigmaX );
	float fDet = dot( vSigmaX, R1 ) * faceDir;
	vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
	return normalize( abs( fDet ) * surf_norm - vGrad );
}
`;
const FRAG_ROUGH = /* glsl */`
if ( uDetOn > 0.5 ) roughnessFactor = clamp( roughnessFactor * ( 1.0 + uDetRough * ( detSample( vDetW ).g - 0.5 ) * 2.0 ), 0.04, 1.0 );
`;
const FRAG_BUMP = /* glsl */`
if ( uDetOn > 0.5 ) {
	vec3 dpx = dFdx( vDetW ), dpy = dFdy( vDetW );
	float h0 = detSample( vDetW ).r;
	vec2 dh = vec2( detSample( vDetW + dpx ).r - h0, detSample( vDetW + dpy ).r - h0 ) * uDetBump;
	normal = detPerturb( - vViewPosition, normal, dh, faceDirection );
}
`;

export function addDetail(material, kind) {
  const k = KINDS[kind], tex = detailTexture(kind);
  if (!k || !tex) return material;                  // node (tests): nothing to add
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uDetOn: DETAIL_ON, tDetail: { value: tex }, uDetTile: { value: k.tile }, uDetBump: { value: k.bump }, uDetRough: { value: k.rough } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_BODY);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_BUMP);
  };
  material.customProgramCacheKey = () => 'plinth-detail-' + kind;
  return material;
}

function rng(seed) {                                        // mulberry32
  let a = seed || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
