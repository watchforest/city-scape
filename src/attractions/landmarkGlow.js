/**
 * Soft light pools on the ground under each landmark, so they stand out at night.
 *
 * Reuses the lamp halo material (additive, opacity driven by DayCycle), so they fade in and out
 * with the street lamps and cost one draw call per landmark.
 */

import * as THREE from 'three';
import { getTerrainHeight } from '@/world/terrain.js';

const GLOW_SCALE = 5.2; // pool diameter as a multiple of the landmark's footprint radius
const GLOW_LIFT  = 0.25;

/**
 * @param {THREE.Scene} scene
 * @param {AttractionInstance[]} attractions
 * @param {THREE.Material} haloMaterial  the lamp halo material (shared)
 */
export function addLandmarkGlow(scene, attractions, haloMaterial) {
  for (const a of attractions) {
    const size = a.footprintRadius * GLOW_SCALE;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), haloMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(a.displayU, getTerrainHeight(a.displayU, a.displayV) + GLOW_LIFT, a.displayV);
    mesh.renderOrder = 1;
    scene.add(mesh);
  }
}
