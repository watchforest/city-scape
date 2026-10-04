/**
 * Always-on project name labels floating over the landmarks, toggled with a key (L). Clicking one opens the project,
 * like clicking the landmark. While they are on, the cursor hover label for landmarks (hoverLabel.js) is switched off,
 * since it would only repeat the name. The setting is remembered between visits. (The tags themselves: labelLayer.js.)
 */

import * as THREE from 'three';
import { setHoverLabelEnabled } from './hoverLabel.js';
import { createLabelLayer } from './labelLayer.js';

const LIFT = 3; // world units above the top of the landmark

let _layer = null;

/**
 * @param {THREE.PerspectiveCamera} cam
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ group: THREE.Object3D, instance: { name: string, displayU: number, displayV: number } }[]} attractionMeshes
 * @param {(project: object) => void} [onClick]  called with the project (group.userData.project) when its label is clicked
 */
export function initLandmarkLabels(cam, renderer, attractionMeshes, onClick = () => {}) {
  _layer = createLabelLayer({
    cam, renderer, storageKey: 'city-scape:landmark-labels',
    onToggle: on => setHoverLabelEnabled('landmark', !on),
  });
  for (const { group, instance } of attractionMeshes) {
    const top = new THREE.Box3().setFromObject(group).max.y; // landmark roof (world y)
    _layer.add(instance.name, out => out.set(instance.displayU, top + LIFT, instance.displayV), () => onClick(group.userData.project));
  }
  _layer.init();
}

export function setLandmarkLabels(on) { _layer?.set(on); }
export function toggleLandmarkLabels() { return _layer ? _layer.toggle() : false; }

/** Call every frame. */
export function updateLandmarkLabels() { _layer?.update(); }
