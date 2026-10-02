/**
 * terrain.js — seeded heightmap for the park landscape.
 *
 * Two-phase init:
 *   1. Module loads: noise table built from seed. getTerrainHeight() works but
 *      returns unmasked hills everywhere.
 *   2. bakePathMask(points) called after path routing: builds a low-res distance
 *      field that suppresses terrain near paths/nodes. After this call,
 *      getTerrainHeight() returns 0 near paths and full hills in open areas.
 *
 * Hills only appear in the gaps between paths — they never fight the ribbons.
 */

import { SEED, TERRAIN_MAX_HEIGHT, TERRAIN_SCALE, TERRAIN_HILL_POWER, TERRAIN_MESA_STEPS, TERRAIN_MESA_BLEND } from '@/config.js';
import { getParkBounds } from './parkBounds.js';
import { getLakeBedOffset } from './lake.js';
import { mulberry32 } from '@/utils/prng.js';

// ── Value-noise grid ──────────────────────────────────────────────────────────

// Periodic lattice of random values; noise coordinates are in lattice cells and
// wrap, so any frequency/octave works without running off the table.
const GRID = 16;

// World distance that TERRAIN_SCALE / ground-variation frequencies are measured
// over, so hill size is the same in a small park and a large one.
const NOISE_WORLD = 540;

function _makeTable(seed) {
  const rand = mulberry32(seed);
  const t = new Float32Array(GRID * GRID);
  for (let i = 0; i < t.length; i++) t[i] = rand() * 2 - 1;
  return t;
}

const _table = _makeTable(SEED ^ 0xdeadbeef);

function _smoothstep(t) { return t * t * (3 - 2 * t); }
function _clamp01(t)    { return t < 0 ? 0 : t > 1 ? 1 : t; }
function _wrap(i)       { return ((i % GRID) + GRID) % GRID; }

/** Smooth value noise in [-1, 1]; (x, y) in lattice cells, periodic every GRID cells. */
function _noise(table, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const sx = _smoothstep(x - ix), sy = _smoothstep(y - iy);
  const x0 = _wrap(ix), x1 = _wrap(ix + 1), y0 = _wrap(iy), y1 = _wrap(iy + 1);
  const v00 = table[y0 * GRID + x0], v10 = table[y0 * GRID + x1];
  const v01 = table[y1 * GRID + x0], v11 = table[y1 * GRID + x1];
  return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
}

// ── Secondary noise for ground color variation ────────────────────────────────

const _table2 = _makeTable(SEED ^ 0xcafebabe);

/**
 * Returns a variation value in [-1, 1] at (u, v), independent of height noise.
 * Used to drive ground color patches.
 */
export function getGroundVariation(u, v) {
  const nx = u / NOISE_WORLD;
  const ny = v / NOISE_WORLD;
  let n = 0;
  n += _noise(_table2, nx * 2.5,       ny * 2.5)       * 1.0;
  n += _noise(_table2, nx * 5.0 + 1.3, ny * 5.0 + 2.7) * 0.5;
  return _clamp01((n / 1.5 + 1) / 2); // remap to [0,1]
}

// ── Path-distance mask (baked at startup) ─────────────────────────────────────

// Low-res grid that stores, per cell, the distance to the nearest flat-zone point
// (landmarks, plazas, lake). getTerrainHeight() looks it up and keeps those areas level.
// Paths are NOT in the mask: they are draped over the terrain instead.
const MASK_RES  = 128;  // grid cells across the park
const _maskDist = new Float32Array(MASK_RES * MASK_RES).fill(Infinity);

// How far from a flat-zone point terrain is fully suppressed (world units).
// Beyond this, terrain gradually rises to full height over TERRAIN_RAMP_WIDTH.
const TERRAIN_FLAT_RADIUS = 8;   // level just beyond the sampled landmark/plaza/lake area
const TERRAIN_RAMP_WIDTH  = 24;  // smooth hill rise beyond the flat zone

/**
 * Call once after routing, before building anything that sits on the terrain, with
 * every point that must stay level (landmark and plaza discs, lake area).
 * Builds the distance field that shapes where hills appear.
 *
 * @param {{ u: number, v: number }[]} points
 */
export function bakePathMask(points) {
  // For each mask cell, find distance to nearest input point
  const b = getParkBounds();
  const cellW = (b[2] - b[0]) / MASK_RES;
  const cellH = (b[3] - b[1]) / MASK_RES;

  for (let row = 0; row < MASK_RES; row++) {
    for (let col = 0; col < MASK_RES; col++) {
      const wu = b[0] + (col + 0.5) * cellW;
      const wv = b[1] + (row + 0.5) * cellH;
      let minDist = Infinity;
      for (const p of points) {
        const d = Math.hypot(wu - p.u, wv - p.v);
        if (d < minDist) minDist = d;
      }
      _maskDist[row * MASK_RES + col] = minDist;
    }
  }
}

/** Distance to the nearest flat-zone point, bilinearly interpolated (nearest-cell would stair-step the slopes). */
function _sampleMask(u, v) {
  const b = getParkBounds();
  const fx = ((u - b[0]) / (b[2] - b[0])) * MASK_RES - 0.5;
  const fz = ((v - b[1]) / (b[3] - b[1])) * MASK_RES - 0.5;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = fx - x0, tz = fz - z0;
  const at = (x, z) => _maskDist[Math.max(0, Math.min(MASK_RES - 1, z)) * MASK_RES + Math.max(0, Math.min(MASK_RES - 1, x))];
  const d00 = at(x0, z0), d10 = at(x0 + 1, z0), d01 = at(x0, z0 + 1), d11 = at(x0 + 1, z0 + 1);
  return d00 * (1 - tx) * (1 - tz) + d10 * tx * (1 - tz) + d01 * (1 - tx) * tz + d11 * tx * tz;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Return the terrain height (y) at world position (u, v).
 */
export function getTerrainHeight(u, v) {
  const b = getParkBounds();
  const parkW = b[2] - b[0], parkH = b[3] - b[1];
  const nx = u / NOISE_WORLD;
  const ny = v / NOISE_WORLD;

  // Multi-octave noise
  let h = 0;
  h += _noise(_table, nx * TERRAIN_SCALE,           ny * TERRAIN_SCALE)           * 1.00;
  h += _noise(_table, nx * TERRAIN_SCALE * 2 + 3.1, ny * TERRAIN_SCALE * 2 + 1.7) * 0.45;
  h += _noise(_table, nx * TERRAIN_SCALE * 4 + 6.3, ny * TERRAIN_SCALE * 4 + 4.1) * 0.20;
  h /= 1.65;

  // Rolling hills: remap the noise to [0, 1] and raise it to a power, so valleys are
  // broad and gentle and the rises stand out. (Folding with abs() instead would put a
  // sharp ridge line wherever the noise crosses zero.)
  h = Math.pow(_clamp01(h * 0.5 + 0.5), TERRAIN_HILL_POWER) * TERRAIN_MAX_HEIGHT;

  // ── Park edge falloff ─────────────────────────────────────────────────────
  const dx = Math.abs(u - (b[0] + b[2]) * 0.5) / (parkW * 0.5);
  const dz = Math.abs(v - (b[1] + b[3]) * 0.5) / (parkH * 0.5);
  const edgeDist  = Math.max(dx, dz);
  const edgeFade  = 1 - _smoothstep(_clamp01((edgeDist - 0.5) / 0.4));
  h *= edgeFade;

  // ── Mesa quantization — blend between smooth and stepped ─────────────────
  if (TERRAIN_MESA_STEPS > 0 && TERRAIN_MESA_BLEND > 0) {
    const stepped = Math.round(h / TERRAIN_MAX_HEIGHT * TERRAIN_MESA_STEPS) / TERRAIN_MESA_STEPS * TERRAIN_MAX_HEIGHT;
    h = h * (1 - TERRAIN_MESA_BLEND) + stepped * TERRAIN_MESA_BLEND;
  }

  // ── Path-distance suppression ─────────────────────────────────────────────
  const dist = _sampleMask(u, v);
  if (dist < TERRAIN_FLAT_RADIUS) {
    h = 0;
  } else if (dist < TERRAIN_FLAT_RADIUS + TERRAIN_RAMP_WIDTH) {
    const t = (dist - TERRAIN_FLAT_RADIUS) / TERRAIN_RAMP_WIDTH;
    h *= _smoothstep(t);
  }

  // Lake basin (≤ 0): the ground dips into a bowl; see lake.js
  return h + getLakeBedOffset(u, v);
}
