import * as THREE from 'three';
import { GRASS_COLOR, GROUND_SIDE_COLOR, TERRAIN_MAX_HEIGHT } from '@/config.js';
import { getTerrainHeight, getGroundVariation } from './terrain.js';
import { getParkHalf } from './parkBounds.js';

// Ground color palette — interpolated per vertex based on height + variation noise
// Low/wet: dark moss green → mid grass → high/dry: straw yellow
const COL_LOW  = new THREE.Color(0x3a6b2e); // dark moss
const COL_MID  = new THREE.Color(0x4a7c3f); // base grass
const COL_HIGH = new THREE.Color(0x7a8c4a); // dry hilltop
const COL_VAR  = new THREE.Color(0x6b7a32); // variation patch tint (subtle yellow-green)

export function buildGround(scene, rand) {
  // ── Terrain grass plane (subdivided so it can deform) ───────────────────────
  const SIZE = getParkHalf() * 2 + 40;           // park plus a 20-unit skirt each side
  const SEGS = Math.max(40, Math.round(SIZE / 4.8)); // ~4.8 units per cell, as in the reference park
  const geo  = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;

  // Build vertex colors
  const colors = new Float32Array(pos.count * 3);
  const _col   = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = getTerrainHeight(x, z);
    pos.setY(i, h);

    // Height-based blend: 0 = low, 1 = high
    const heightT = Math.min(h / TERRAIN_MAX_HEIGHT, 1);
    // Variation noise: 0-1 independent patch texture
    const varT    = getGroundVariation(x, z);

    // Base color from height
    if (heightT < 0.5) {
      _col.lerpColors(COL_LOW, COL_MID, heightT * 2);
    } else {
      _col.lerpColors(COL_MID, COL_HIGH, (heightT - 0.5) * 2);
    }

    // Subtle variation tint — only in mid-height areas, driven by patch noise
    const varStrength = (1 - Math.abs(heightT - 0.3) / 0.5) * 0.35;
    if (varT > 0.55 && varStrength > 0) {
      _col.lerp(COL_VAR, varT * varStrength);
    }

    colors[i * 3 + 0] = _col.r;
    colors[i * 3 + 1] = _col.g;
    colors[i * 3 + 2] = _col.b;
  }

  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat  = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);

  // ── Diorama box ──────────────────────────────────────────────────────────────
  // Sink top face 1 unit below y=0 so it never coplanar-fights the ground mesh
  const BOX_DEPTH  = 25 + TERRAIN_MAX_HEIGHT;
  const BOX_SINK   = 1;
  const sideMat    = new THREE.MeshLambertMaterial({ color: GROUND_SIDE_COLOR });

  const box = new THREE.Mesh(new THREE.BoxGeometry(SIZE + 20, BOX_DEPTH, SIZE + 20), sideMat);
  box.position.y = -(BOX_DEPTH / 2) - BOX_SINK;
  box.receiveShadow = true;
  scene.add(box);

  return mesh;
}
