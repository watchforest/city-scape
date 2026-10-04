/**
 * Instanced grass with wind sway.
 *
 * Normally the clumps are the decor grass models (src/world/decor.js, one InstancedMesh per variant);
 * if those didn't load it falls back to low-poly dome tufts. A vertex-shader tweak displaces the tips
 * horizontally to simulate wind, weighted by local Y so the roots stay fixed.
 *
 * Placement avoids paths (obstacleRegistry grid), registered obstacles (trees, rocks, benches…),
 * steep slopes, and high mesa tops — grass only grows in gentle areas.
 */

import * as THREE from 'three';
import { TERRAIN_MAX_HEIGHT, GRASS_CLUMP_SCALE, GRASS_CLUMP_DENSITY, GRASS_LOD, WIND_AMP } from '@/config.js';
import { addWind, updateWind } from './wind.js';
import { getParkHalf, getParkAreaScale } from './parkBounds.js';
import { isOccupied } from './obstacleRegistry.js';
import { getTerrainHeight } from './terrain.js';

const TUFT_DENSITY  = 5000;  // dome tufts for the reference-size park; scaled by park area
const SLOPE_PROBE   = 3;    // world units for slope measurement
const MAX_SLOPE     = 0.5;  // steeper than this → no grass
const MAX_HEIGHT_T  = 0.55; // above this fraction of TERRAIN_MAX_HEIGHT → no grass

// ── Dome tuft geometry (fallback) ─────────────────────────────────────────────
// A low-poly hemisphere — reads as a soft grass mound from isometric view.
// Vertex colors: dark at the base ring, bright yellow-green at the top.

function _buildTuftGeo() {
  const geo = new THREE.SphereGeometry(1, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);

  // Vertex colors: interpolate by Y (0 at equator → 1 at pole)
  const pos    = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const COL_BASE = new THREE.Color(0x3a6b28);
  const COL_TIP  = new THREE.Color(0x6db832);
  const _c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i)); // 0 at rim, 1 at top (sphere r=1)
    _c.lerpColors(COL_BASE, COL_TIP, t);
    colors[i * 3]     = _c.r;
    colors[i * 3 + 1] = _c.g;
    colors[i * 3 + 2] = _c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// ── Placement ─────────────────────────────────────────────────────────────────

const _grassMeshes = [];

/**
 * @param {THREE.Scene} scene
 * @param {Function} rand
 * @param {{ geometry: THREE.BufferGeometry, material: THREE.Material }[]} [clumps]  decor grass variants
 */
export function buildGrass(scene, rand, clumps = []) {
  const parkHalf = getParkHalf();
  const useModels = clumps.length > 0;
  const COUNT = Math.round(TUFT_DENSITY * (useModels ? GRASS_CLUMP_DENSITY : 1) * getParkAreaScale());

  // One geometry/material per variant (a single one for the dome fallback).
  const parts = useModels
    ? clumps.map(c => ({ geometry: c.geometry, material: c.material })) // (decor.js has already given them the shared wind)
    : [{ geometry: _buildTuftGeo(), material: addWind(new THREE.MeshLambertMaterial({ vertexColors: true }), { height: 1, amp: WIND_AMP.grass }) }];

  const _pos  = new THREE.Vector3();
  const _rot  = new THREE.Euler();
  const _scl  = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _mat  = new THREE.Matrix4();
  const _col  = new THREE.Color();

  // Clumps are first collected per chunk of the park and variant, then turned into meshes (below).
  const chunkSize = (parkHalf * 2) / GRASS_LOD.chunks;
  const records = new Map(); // "cx,cz,variant" → [{ x, y, z, ry, sx, sy, sz, color }]
  let placed = 0;

  for (let attempt = 0; attempt < COUNT * 6 && placed < COUNT; attempt++) {
    const x = (rand() * 2 - 1) * (parkHalf - 2);
    const z = (rand() * 2 - 1) * (parkHalf - 2);

    // Skip occupied areas (paths, lake, obstacles)
    if (isOccupied(x, z, 0)) continue;

    const h  = getTerrainHeight(x, z);
    const hx = getTerrainHeight(x + SLOPE_PROBE, z);
    const hz = getTerrainHeight(x, z + SLOPE_PROBE);
    const slope = Math.max(Math.abs(h - hx), Math.abs(h - hz)) / SLOPE_PROBE;

    // Skip steep slopes and high mesas
    if (slope > MAX_SLOPE) continue;
    if (h > TERRAIN_MAX_HEIGHT * MAX_HEIGHT_T) continue;

    const variant = Math.floor(rand() * parts.length);
    const ry   = rand() * Math.PI * 2;
    if (useModels) {
      const s = GRASS_CLUMP_SCALE[0] + rand() * (GRASS_CLUMP_SCALE[1] - GRASS_CLUMP_SCALE[0]);
      _scl.set(s, s * (0.8 + rand() * 0.5), s);
      // Brighten and yellow the model's deep green a little, varying clump to clump.
      const l = 1.0 + rand() * 0.9, dry = rand() * rand();
      _col.setRGB(l * (1 + dry * 0.9), l * (1 + dry * 0.25), l * (1 - dry * 0.3));
    } else {
      const width = 1.4 + rand() * 1.2;  // XZ radius
      _scl.set(width, 0.5 + rand() * 0.5, width); // flat like a mound
    }

    const cx = Math.min(GRASS_LOD.chunks - 1, Math.floor((x + parkHalf) / chunkSize));
    const cz = Math.min(GRASS_LOD.chunks - 1, Math.floor((z + parkHalf) / chunkSize));
    const key = `${cx},${cz},${variant}`;
    if (!records.has(key)) records.set(key, []);
    records.get(key).push({ x, y: h, z, ry, sx: _scl.x, sy: _scl.y, sz: _scl.z, color: useModels ? _col.clone() : null });
    placed++;
  }

  // Each chunk × variant gets a full-density mesh for when the camera is near, and a thinned one (every
  // 1/keep-th clump, each a bit bigger so the ground stays covered) for when it is far: grass is most of the
  // scene's triangles, and from far away the extra clumps are sub-pixel anyway. Chunks are also frustum-culled.
  // A bigger park (more landmarks) has proportionally more clumps, all drawn when zoomed out: thin the far ones more.
  const farKeep = Math.max(GRASS_LOD.farKeepMin, GRASS_LOD.farKeep / Math.sqrt(Math.max(1, getParkAreaScale())));
  const step = Math.max(1, Math.round(1 / farKeep));
  const meshes = [];
  for (const [key, list] of records) {
    const [cx, cz, variant] = key.split(',').map(Number);
    const centre = new THREE.Vector3(-parkHalf + (cx + 0.5) * chunkSize, 0, -parkHalf + (cz + 0.5) * chunkSize);
    const lod = { centre, reach: chunkSize * 0.7, near: null, far: null };
    for (const thin of [false, true]) {
      const picked = thin ? list.filter((_, i) => i % step === 0) : list;
      const grow = thin ? 1 + (GRASS_LOD.farScale - 1) * step / 2 : 1; // fewer clumps → each a bit bigger
      const m = new THREE.InstancedMesh(parts[variant].geometry, parts[variant].material, picked.length);
      m.castShadow = false;
      m.receiveShadow = false;
      picked.forEach((r, i) => {
        _pos.set(r.x, r.y, r.z);
        _quat.setFromEuler(_rot.set(0, r.ry, 0));
        _scl.set(r.sx * grow, r.sy * grow, r.sz * grow);
        m.setMatrixAt(i, _mat.compose(_pos, _quat, _scl));
        if (r.color) m.setColorAt(i, r.color);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.visible = !thin;
      scene.add(m);
      meshes.push(m);
      lod[thin ? 'far' : 'near'] = m;
    }
    _lods.push(lod);
  }
  _grassMeshes.push(...meshes);
  return meshes;
}

const _lods = []; // { centre, near, far } per chunk × variant

/**
 * Call each frame: advances the wind and switches each chunk of grass between its full and thinned mesh by
 * distance from the camera.
 * @param {number} dt
 * @param {THREE.Vector3} [cameraPos]
 */
export function updateGrass(dt, cameraPos) {
  updateWind(dt); // the wind is shared with the trees, bushes and flowers (wind.js)
  if (!cameraPos) return;
  for (const l of _lods) {
    const dx = l.centre.x - cameraPos.x, dz = l.centre.z - cameraPos.z;
    // (the camera's height counts: from high up it's all "far"; the chunk's own reach is taken off)
    const near = Math.hypot(dx, dz, cameraPos.y) - l.reach < GRASS_LOD.near;
    l.near.visible = near;
    l.far.visible = !near;
  }
}
