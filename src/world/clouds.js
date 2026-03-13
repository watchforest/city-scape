import * as THREE from 'three';
import { PARK_BOUNDS, CLOUD_COLOR } from '@/config.js';

const CLOUD_COUNT = 4;
const CLOUD_SPEED = 6;   // units/sec in +X direction
const PARK_HALF   = (PARK_BOUNDS[2] - PARK_BOUNDS[0]) / 2;
const WRAP_EDGE   = PARK_HALF + 80;

const _clouds = [];

export function buildClouds(scene, rand) {
  const mat = new THREE.MeshLambertMaterial({
    color: CLOUD_COLOR,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });

  for (let i = 0; i < CLOUD_COUNT; i++) {
    const group = new THREE.Group();

    // 5–8 blob spheres per cloud, stretched into oblong ellipsoids
    const blobCount = 5 + Math.floor(rand() * 4);
    for (let b = 0; b < blobCount; b++) {
      const r    = 7 + rand() * 9;       // base radius 7–16
      const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
      // Non-uniform scale: stretch wide on X, flatten on Y → puffy oblong look
      blob.scale.set(
        1.4 + rand() * 1.2,              // x: 1.4–2.6 (wide)
        0.5 + rand() * 0.5,              // y: 0.5–1.0 (flat)
        0.8 + rand() * 0.8               // z: 0.8–1.6
      );
      // Spread blobs along X to form an elongated cloud body
      blob.position.set(
        (rand() - 0.5) * 60,             // ±30 on x — wide spread
        (rand() - 0.5) * 10,             // ±5  on y
        (rand() - 0.5) * 20              // ±10 on z
      );
      group.add(blob);
    }

    // Spread clouds across the park at different starting X positions
    const startX = (rand() * 2 - 1) * WRAP_EDGE;
    const z      = (rand() * 2 - 1) * PARK_HALF * 0.8;
    const y      = 120 + rand() * 40;   // 120–160 height

    group.position.set(startX, y, z);
    scene.add(group);
    _clouds.push(group);
  }
}

export function updateClouds(dt) {
  for (const cloud of _clouds) {
    cloud.position.x += CLOUD_SPEED * dt;
    if (cloud.position.x > WRAP_EDGE) {
      cloud.position.x = -WRAP_EDGE;
    }
  }
}
