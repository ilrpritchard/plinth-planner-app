// floorTexture.js — procedurally generated floor textures (no image files).
// Draws to a canvas sized to the room so there's no tiling seam: staggered
// wood planks with grain, tiled stone with grout, mottled concrete / slate.

import * as THREE from 'three';

const MAXPX = 2048;

export function makeFloorTexture(key, colorInt, width, depth) {
  const long = Math.max(width, depth, 1);
  const scale = MAXPX / long;                 // px per inch
  const cw = Math.max(8, Math.round(width * scale));
  const ch = Math.max(8, Math.round(depth * scale));
  const cnv = document.createElement('canvas');
  cnv.width = cw; cnv.height = ch;
  const ctx = cnv.getContext('2d');
  const rgb = toRGB(colorInt);

  if (key === 'oak' || key === 'ash' || key === 'walnut') drawWood(ctx, cw, ch, scale, rgb);
  else if (key === 'tile') drawTiles(ctx, cw, ch, scale, rgb, 12, [184, 180, 173]);
  else if (key === 'slate') drawSlate(ctx, cw, ch, scale, rgb);
  else drawConcrete(ctx, cw, ch, scale, rgb);

  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// roughness/metal per floor type for a believable surface
export function floorSurface(key) {
  switch (key) {
    case 'oak': case 'ash': case 'walnut': return { roughness: 0.55, env: 0.45 };
    case 'tile': return { roughness: 0.28, env: 0.8 };
    case 'slate': return { roughness: 0.45, env: 0.5 };
    case 'concrete': return { roughness: 0.7, env: 0.35 };
    default: return { roughness: 0.6, env: 0.4 };
  }
}

// ---- drawers -------------------------------------------------------------
function drawWood(ctx, cw, ch, s, rgb) {
  const plankH = 6 * s;            // 6" wide boards
  const plankLen = 46 * s;         // ~46" lengths
  const seamW = Math.max(1, s * 0.22);   // thin hairline grooves
  let row = 0;
  for (let y = -plankH; y < ch + plankH; y += plankH, row++) {
    const stagger = (row % 3) * (plankLen / 3);
    for (let x = -plankLen + stagger; x < cw + plankLen; x += plankLen) {
      ctx.fillStyle = shade(rgb, rnd(-12, 11));
      ctx.fillRect(x, y, plankLen - seamW, plankH - seamW);
      grain(ctx, x, y, plankLen, plankH, rgb, s);
      // end-joint seam — fine + soft
      ctx.fillStyle = shade(rgb, -26);
      ctx.fillRect(x - seamW / 2, y, seamW, plankH);
    }
    // lengthwise seam between rows — fine + soft
    ctx.fillStyle = shade(rgb, -30);
    ctx.fillRect(0, y + plankH - seamW, cw, seamW);
  }
  vignette(ctx, cw, ch);
}

function grain(ctx, x, y, w, h, rgb, s) {
  const lines = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < lines; i++) {
    const gy = y + 2 * s + Math.random() * (h - 4 * s);
    ctx.strokeStyle = shade(rgb, rnd(-22, -6), 0.5);
    ctx.lineWidth = Math.max(0.6, s * (0.2 + Math.random() * 0.5));
    ctx.beginPath();
    let px = x;
    ctx.moveTo(px, gy);
    while (px < x + w) { px += 8 * s; ctx.lineTo(px, gy + rnd(-1, 1) * s); }
    ctx.stroke();
  }
}

function drawTiles(ctx, cw, ch, s, rgb, tileIn, groutRGB) {
  ctx.fillStyle = `rgb(${groutRGB.join(',')})`;
  ctx.fillRect(0, 0, cw, ch);
  const t = tileIn * s, g = 1.6 * s;
  for (let y = 0; y < ch; y += t) for (let x = 0; x < cw; x += t) {
    ctx.fillStyle = shade(rgb, rnd(-7, 7));
    ctx.fillRect(x + g, y + g, t - 2 * g, t - 2 * g);
    mottle(ctx, x + g, y + g, t - 2 * g, t - 2 * g, rgb, 6, 0.05);
  }
  vignette(ctx, cw, ch);
}

function drawSlate(ctx, cw, ch, s, rgb) {
  ctx.fillStyle = shade(rgb, -10); ctx.fillRect(0, 0, cw, ch);
  const t = 16 * s, g = 1.4 * s;
  for (let y = 0; y < ch; y += t) for (let x = 0; x < cw; x += t) {
    ctx.fillStyle = shade(rgb, rnd(-16, 14));
    ctx.fillRect(x + g, y + g, t - 2 * g, t - 2 * g);
    mottle(ctx, x + g, y + g, t - 2 * g, t - 2 * g, rgb, 14, 0.12);
  }
  vignette(ctx, cw, ch);
}

function drawConcrete(ctx, cw, ch, s, rgb) {
  ctx.fillStyle = `rgb(${rgb.join(',')})`; ctx.fillRect(0, 0, cw, ch);
  mottle(ctx, 0, 0, cw, ch, rgb, Math.round(cw * ch / (40 * s * 40 * s)), 0.06);
  vignette(ctx, cw, ch);
}

// ---- helpers -------------------------------------------------------------
function mottle(ctx, x, y, w, h, rgb, count, alpha) {
  for (let i = 0; i < count; i++) {
    const r = (4 + Math.random() * 20);
    ctx.fillStyle = shade(rgb, rnd(-18, 18), alpha);
    ctx.beginPath();
    ctx.arc(x + Math.random() * w, y + Math.random() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
function vignette(ctx, cw, ch) {
  const grad = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.2, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, cw, ch);
}
function toRGB(n) { return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function shade(rgb, amt, alpha) {
  const c = rgb.map((v) => Math.max(0, Math.min(255, v + amt)));
  return alpha != null ? `rgba(${c[0]},${c[1]},${c[2]},${alpha})` : `rgb(${c[0]},${c[1]},${c[2]})`;
}
function rnd(a, b) { return a + Math.random() * (b - a); }
