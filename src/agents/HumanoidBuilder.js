/**
 * Builds a solid humanoid figure using simple BoxGeometry / SphereGeometry.
 * All parts castShadow. Body parts tagged via userData for animation.
 *
 * animateHumanoid(group, state, time) drives limb motion each frame.
 */

import * as THREE from 'three';

export function buildHumanoid(palette) {
  const group = new THREE.Group();

  function meshMat(color) {
    return new THREE.MeshLambertMaterial({ color });
  }

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), meshMat(palette.accent));
  head.position.y = 2.15;
  head.castShadow = true;
  group.add(head);

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), meshMat(palette.primary));
  torso.position.y = 1.4;
  torso.castShadow = true;
  group.add(torso);

  // Arms
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), meshMat(palette.primary));
    arm.position.set(side * 0.46, 1.35, 0);
    arm.castShadow = true;
    arm.userData.isArm = true;
    arm.userData.armSide = side;
    group.add(arm);
  }

  // Legs
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.8, 0.28), meshMat(palette.accent));
    leg.position.set(side * 0.18, 0.55, 0);
    leg.castShadow = true;
    leg.userData.isLeg = true;
    leg.userData.legSide = side;
    group.add(leg);
  }

  return group;
}

/**
 * Animate humanoid limbs based on current state.
 * @param {THREE.Group} group
 * @param {string} state — 'walking' | 'chatting' | 'resting' | 'stretching'
 * @param {number} time  — accumulated time in seconds
 */
export function animateHumanoid(group, state, time) {
  const arms = group.children.filter(c => c.userData.isArm);
  const legs = group.children.filter(c => c.userData.isLeg);

  if (state === 'walking') {
    const swing = Math.sin(time * 8) * 0.4;
    for (const leg of legs) {
      leg.rotation.x = leg.userData.legSide * -swing;
    }
    for (const arm of arms) {
      arm.rotation.x = arm.userData.armSide * swing;
    }
    group.position.y = Math.abs(Math.sin(time * 8)) * 0.08;
  } else if (state === 'stretching') {
    const stretch = Math.sin(time * 3) * 0.5;
    for (const arm of arms) {
      arm.rotation.x = -0.8 - stretch * 0.5;
    }
    for (const leg of legs) leg.rotation.x = 0;
    group.position.y = 0;
  } else {
    // chatting / resting: idle sway
    const sway = Math.sin(time * 1.5) * 0.03;
    group.rotation.z = sway;
    for (const arm of arms) arm.rotation.x = 0;
    for (const leg of legs) leg.rotation.x = 0;
    group.position.y = state === 'resting' ? -0.3 : 0;
  }
}
