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
import { TERRAIN_MAX_HEIGHT, GRASS_CLUMP_SCALE, GRASS_CLUMP_DENSITY } from '@/config.js';
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

// ── Wind shader ───────────────────────────────────────────────────────────────

const _timeUniform = { value: 0 };

/** Add the wind sway to a (Lambert) material. */
function _addWind(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = _timeUniform;

    // Inject time uniform declaration
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
uniform float uTime;`
    );

    // Inject sway after position transform, before MVP
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
// Wind sway: displace tip (high Y) more than base (Y≈0)
float swayWeight = position.y; // 0 at base, ~1 at tip
// Use instance world X/Z as phase offset for variation
float phase = instanceMatrix[3][0] * 0.03 + instanceMatrix[3][2] * 0.03;
float windX = sin(uTime * 1.3 + phase) * 0.10 * swayWeight;
float windZ = cos(uTime * 1.1 + phase + 1.2) * 0.07 * swayWeight;
transformed.x += windX;
transformed.z += windZ;`
    );
  };
  return mat;
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

  // One InstancedMesh per variant (a single one for the dome fallback).
  const parts = useModels
    ? clumps.map(c => ({ geometry: c.geometry, material: _addWind(c.material) }))
    : [{ geometry: _buildTuftGeo(), material: _addWind(new THREE.MeshLambertMaterial({ vertexColors: true })) }];
  const meshes = parts.map(p => {
    const m = new THREE.InstancedMesh(p.geometry, p.material, COUNT);
    m.castShadow = false;
    m.receiveShadow = false;
    m.count = 0;
    return m;
  });

  const _pos  = new THREE.Vector3();
  const _rot  = new THREE.Euler();
  const _scl  = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _mat  = new THREE.Matrix4();
  const _col  = new THREE.Color();

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

    const mesh = meshes[Math.floor(rand() * meshes.length)];
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

    _pos.set(x, h, z);
    _rot.set(0, ry, 0);
    _quat.setFromEuler(_rot);
    _mat.compose(_pos, _quat, _scl);
    mesh.setMatrixAt(mesh.count, _mat);
    if (useModels) mesh.setColorAt(mesh.count, _col);
    mesh.count++;
    placed++;
  }

  for (const m of meshes) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    scene.add(m);
    _grassMeshes.push(m);
  }
  return meshes;
}

/**
 * Call each frame to advance the wind animation.
 * @param {number} dt
 */
export function updateGrass(dt) {
  _timeUniform.value += dt;
}
