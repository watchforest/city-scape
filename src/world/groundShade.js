/**
 * Soft contact shading on the ground — a cheap stand-in for ambient occlusion.
 *
 * Spawners call `addContactShade(x, z, r, strength)` for everything that sits on the grass
 * (trees, bushes, benches, landmarks). `bakeContactShade()` then paints the discs once into a
 * greyscale texture (white = unshaded) that the ground shader multiplies into the grass colour
 * (see ground.js). Costs one texture lookup per ground pixel, nothing per frame.
 */

import * as THREE from 'three';
import { CONTACT_SHADE_TEX_SIZE } from '@/config.js';

const _discs = [];

/** Darken the ground around (x, z): full `strength` (0–1) at the centre, fading out at `r`. */
export function addContactShade(x, z, r, strength = 0.4) {
  _discs.push(x, z, r, strength);
}

/** Paint every registered disc into a texture covering the square [-half, half]². */
export function bakeContactShade(half) {
  const size = CONTACT_SHADE_TEX_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);

  const k = size / (half * 2);
  for (let i = 0; i < _discs.length; i += 4) {
    const px = (_discs[i] + half) * k, py = (_discs[i + 1] + half) * k;
    const pr = _discs[i + 2] * k, a = _discs[i + 3];
    const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0,    `rgba(0,0,0,${a})`);
    g.addColorStop(0.55, `rgba(0,0,0,${a * 0.55})`);
    g.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace; // a multiplier, not a colour
  tex.flipY = false;                   // canvas row 0 = z of -half
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}
