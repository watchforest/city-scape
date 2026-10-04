/**
 * Path texture — all paths and plazas baked into one coverage map that the ground shader paints.
 *
 * Drawing every ribbon as its own mesh meant overlapping paths were coplanar and z-fought.
 * Painting them into a single texture merges them by construction (a union), and the soft
 * field lets the shader give the edges an irregular, worn look.
 *
 * Channels (all in [0, 1]):
 *   R  coverage field — soft: 1 well inside a path, 0.5 on its edge, 0 outside
 *   G  closeness to the centreline — 1 on it, 0 towards the edge (lighter middle)
 */

import * as THREE from 'three';

const TEXTURE_SIZE = 2048;
const STAMP_SPACING = 0.8;   // world units between stamps along a ribbon
const SOFT_EDGE = 1.25;      // stamp radius as a multiple of the path's half-width

let _coverage = null; // R channel of the baked texture, row-major
let _half = 0;

const COVERED = 90; // R at or above this counts as path (the shader's edge sits near 128, wobbled ±38)

function _covered(x, z) {
  if (!_coverage) return false;
  const k = TEXTURE_SIZE / (_half * 2);
  const c = Math.floor((x + _half) * k), r = Math.floor((z + _half) * k);
  if (c < 0 || r < 0 || c >= TEXTURE_SIZE || r >= TEXTURE_SIZE) return false;
  return _coverage[c + r * TEXTURE_SIZE] >= COVERED;
}

/**
 * True if (x, z) — or anything within `margin` world units of it — is painted as path or plaza.
 * Use for placing props so they never land on the visible path surface.
 */
export function isOnPath(x, z, margin = 0) {
  if (_covered(x, z)) return true;
  if (margin <= 0) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (_covered(x + Math.cos(a) * margin, z + Math.sin(a) * margin)) return true;
  }
  return false;
}

/**
 * @param {{ discs: {u,v,r}[], ribbons: {u,v,width}[][] }} shapes
 * @param {number} half  park half-size; the texture covers [-half, half] on both axes
 * @returns {THREE.CanvasTexture}
 */
export function bakePathTexture(shapes, half) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  ctx.globalCompositeOperation = 'lighten'; // overlapping stamps combine as a union (per-channel max)

  const k = TEXTURE_SIZE / (half * 2);
  const px = u => (u + half) * k;

  /**
   * One stamp: coverage in R, centreline closeness in G. `radius` is the path's half-width.
   * `plaza` stamps are shaded flat (so paths running into a plaza don't show as lighter strips
   * inside it) with only a slightly darker rim.
   */
  function stamp(u, v, radius, plaza = false) {
    const x = px(u), y = px(v), r = radius * k;
    const outer = r * SOFT_EDGE;

    // R: 1 inside, 0.5 exactly at the path edge (the shader thresholds at 0.5), 0 at the outer radius.
    const cover = ctx.createRadialGradient(x, y, 0, x, y, outer);
    // (Opaque colours, not alpha: with 'lighten' an alpha fade accumulates instead of taking the max.)
    cover.addColorStop(0,                 'rgb(255,0,0)');
    cover.addColorStop(0.8 / SOFT_EDGE,   'rgb(255,0,0)');
    cover.addColorStop(1 / SOFT_EDGE,     'rgb(128,0,0)');
    cover.addColorStop(1,                 'rgb(0,0,0)');
    ctx.fillStyle = cover;
    ctx.fillRect(x - outer, y - outer, outer * 2, outer * 2);

    // G: bright along the middle, fading out by 70 % of the half-width.
    const core = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (plaza) {
      core.addColorStop(0,    'rgb(0,235,0)');
      core.addColorStop(0.85, 'rgb(0,235,0)');
      core.addColorStop(1,    'rgb(0,90,0)');
    } else {
      core.addColorStop(0,    'rgb(0,255,0)');
      core.addColorStop(0.7,  'rgb(0,0,0)');
    }
    ctx.fillStyle = core;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  for (const d of shapes.discs) stamp(d.u, d.v, d.r, true);

  for (const pts of shapes.ribbons) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      stamp(a.u, a.v, a.width / 2);
      const b = pts[i + 1];
      if (!b) continue;
      const len = Math.hypot(b.u - a.u, b.v - a.v);
      const n = Math.floor(len / STAMP_SPACING);
      for (let s = 1; s <= n; s++) {
        const t = s / (n + 1);
        stamp(a.u + (b.u - a.u) * t, a.v + (b.v - a.v) * t, (a.width + (b.width - a.width) * t) / 2);
      }
    }
  }

  // Keep the coverage channel so props can be placed against what is actually painted.
  const rgba = ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE).data;
  _coverage = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE);
  for (let i = 0; i < _coverage.length; i++) _coverage[i] = rgba[i * 4];
  _half = half;

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;               // row 0 = the park's minimum z, so uv = (world - min) / size
  tex.colorSpace = THREE.NoColorSpace; // data, not colour
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}
