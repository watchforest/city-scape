/**
 * Geometry grass — instanced crossed-quad tufts with wind sway.
 *
 * Each tuft is two quads crossed at 90° (X shape viewed from above).
 * A custom vertex shader displaces the tip vertices horizontally to
 * simulate wind, weighted by the vertex's local Y so roots stay fixed.
 *
 * Placement avoids paths (obstacleRegistry grid), registered obstacles,
 * steep slopes, and high mesa tops — grass only grows in gentle areas.
 */

import * as THREE from 'three';
import { TERRAIN_MAX_HEIGHT } from '@/config.js';
import { getParkHalf, getParkAreaScale } from './parkBounds.js';
import { isOccupied } from './obstacleRegistry.js';
import { getTerrainHeight } from './terrain.js';

const TUFT_DENSITY  = 5000;  // tufts for the reference-size park; scaled by park area
const SLOPE_PROBE   = 3;    // world units for slope measurement
const MAX_SLOPE     = 0.5;  // steeper than this → no grass
const MAX_HEIGHT_T  = 0.55; // above this fraction of TERRAIN_MAX_HEIGHT → no grass

// ── Dome tuft geometry ────────────────────────────────────────────────────────
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

function _buildGrassMaterial() {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
  });

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
float swayWeight = position.y; // 0 at base, 1 at tip
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

let _grassMesh = null;

export function buildGrass(scene, rand) {
  const parkHalf   = getParkHalf();
  const TUFT_COUNT = Math.round(TUFT_DENSITY * getParkAreaScale());
  const geo = _buildTuftGeo();
  const mat = _buildGrassMaterial();

  const mesh = new THREE.InstancedMesh(geo, mat, TUFT_COUNT);
  mesh.castShadow    = false;
  mesh.receiveShadow = false;
  mesh.count         = 0;

  const _pos  = new THREE.Vector3();
  const _rot  = new THREE.Euler();
  const _scl  = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _mat  = new THREE.Matrix4();

  let placed = 0;

  for (let attempt = 0; attempt < TUFT_COUNT * 6 && placed < TUFT_COUNT; attempt++) {
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

    const width  = 1.4 + rand() * 1.2;  // XZ radius
    const height = 0.5 + rand() * 0.5;  // Y — keep flat like a mound
    const ry     = rand() * Math.PI * 2;

    _pos.set(x, h, z);
    _rot.set(0, ry, 0);
    _scl.set(width, height, width);
    _quat.setFromEuler(_rot);
    _mat.compose(_pos, _quat, _scl);
    mesh.setMatrixAt(placed, _mat);
    placed++;
  }

  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  _grassMesh = mesh;

  return mesh;
}

/**
 * Call each frame to advance the wind animation.
 * @param {number} dt
 */
export function updateGrass(dt) {
  _timeUniform.value += dt;
}
