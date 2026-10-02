/**
 * Fallback attraction shape — a generic pavilion, used whenever a project
 * has no curated GLTF model assigned yet.
 */

import * as THREE from 'three';

const FOOTPRINT_RADIUS = 10;

function mat(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function makeDefault(palette) {
  // Pavilion: wide stepped base + open-sided roof on columns
  const group = new THREE.Group();

  // Base platform — two steps
  const step1 = new THREE.Mesh(new THREE.BoxGeometry(18, 1.5, 18), mat(0x999999));
  step1.position.y = 0.75;
  step1.castShadow = true; step1.receiveShadow = true;
  group.add(step1);

  const step2 = new THREE.Mesh(new THREE.BoxGeometry(14, 1.5, 14), mat(0xaaaaaa));
  step2.position.y = 2.25;
  step2.castShadow = true; step2.receiveShadow = true;
  group.add(step2);

  // Four corner columns
  for (const [cx, cz] of [[-5,-5],[-5,5],[5,-5],[5,5]]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 10, 7), mat(palette.primary));
    col.position.set(cx, 8, cz);
    col.castShadow = true;
    group.add(col);
  }

  // Flat roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(15, 1.2, 15), mat(palette.primary));
  roof.position.y = 13.6;
  roof.castShadow = true;
  group.add(roof);

  // Small accent pyramid on top
  const tip = new THREE.Mesh(new THREE.ConeGeometry(4, 4, 4), mat(palette.accent));
  tip.position.y = 17.2;
  tip.rotation.y = Math.PI / 4;
  tip.castShadow = true;
  group.add(tip);

  return group;
}

export function buildAttractionShape(palette) {
  return makeDefault(palette);
}

export function getFootprintRadius() {
  return FOOTPRINT_RADIUS;
}

/**
 * Animate attraction groups each frame.
 * @param {Array<{ group: THREE.Group }>} instances
 * @param {number} dt
 */
export function animateCatalog(instances, dt) {
  const t = performance.now() / 1000;
  for (const { group } of instances) {
    group.traverse(c => {
      if (c.userData.spinAxis === 'y') {
        c.rotation.y += dt * 0.4;
      }
      if (c.userData.slideAxis === 'y') {
        c.position.y = (c.userData.slideBaseY ?? 9) + Math.sin(t * 0.8) * 1.5;
      }
    });
  }
}
