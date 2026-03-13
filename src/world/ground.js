import * as THREE from 'three';
import { GRASS_COLOR, GROUND_SIDE_COLOR, GRASS_PATCH_COLOR } from '@/config.js';
import { isOccupied } from './obstacleRegistry.js';

export function buildGround(scene, rand) {
  // ── Grass plane ─────────────────────────────────────────────────────────────
  const geo  = new THREE.PlaneGeometry(580, 580);
  const mat  = new THREE.MeshLambertMaterial({ color: GRASS_COLOR });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // ── Diorama box ─────────────────────────────────────────────────────────────
  const grassMat = new THREE.MeshLambertMaterial({ color: GRASS_COLOR });
  const sideMat  = new THREE.MeshLambertMaterial({ color: GROUND_SIDE_COLOR });
  const boxMats  = [sideMat, sideMat, grassMat, sideMat, sideMat, sideMat];

  const box = new THREE.Mesh(new THREE.BoxGeometry(600, 25, 600), boxMats);
  box.position.y = -12.5;
  box.receiveShadow = true;
  scene.add(box);

  // ── Grass patches ────────────────────────────────────────────────────────────
  if (rand) {
    const patchMat = new THREE.MeshLambertMaterial({ color: GRASS_PATCH_COLOR });
    for (let i = 0; i < 60; i++) {
      const x = (rand() * 2 - 1) * 270;   // position FIRST
      const z = (rand() * 2 - 1) * 270;
      if (isOccupied(x, z, 6)) continue;  // skip — no geometry rand consumed
      const r    = 4 + rand() * 4;
      const segs = Math.floor(8 + rand() * 8);
      const geo  = new THREE.CylinderGeometry(r, r, 0.05, segs);
      const patch = new THREE.Mesh(geo, patchMat);
      patch.position.set(x, 0.01, z);
      patch.rotation.y = rand() * Math.PI * 2;
      patch.receiveShadow = true;
      scene.add(patch);
    }
  }

  return mesh;
}
