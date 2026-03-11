import * as THREE from 'three';
import { wireBox, wireCylinder, wireCone } from './wireframes.js';

/**
 * Builds a landmark tower at (cx, 0, cz).
 * Uses GLTF asset if available, otherwise procedural wireframe.
 */
export function buildTower(cx, cz, palette, height, asset, rand) {
  if (asset.type === 'gltf') {
    const group = asset.scene.clone();
    group.position.set(cx, 0, cz);
    return group;
  }

  return _wireframeTower(cx, cz, palette, height, rand);
}

function _wireframeTower(cx, cz, palette, h, rand) {
  const group = new THREE.Group();

  // Plinth
  const plinth = wireCylinder(9, 9, 3, 8, palette.accent);
  plinth.position.y = 1.5;
  group.add(plinth);

  // Main shaft
  const shaft = wireCylinder(5, 7, h, 8, palette.primary);
  shaft.position.y = 3 + h / 2;
  group.add(shaft);

  // Setback at 2/3 height
  const sbY = 3 + h * 2 / 3;
  const sbH = h / 3 - 2;
  const setback = wireCylinder(3.5, 4.5, sbH, 8, palette.accent);
  setback.position.y = sbY + sbH / 2;
  group.add(setback);

  // Crown ring
  const crown = wireCylinder(4.8, 4.8, 0.8, 8, palette.accent);
  crown.position.y = sbY;
  group.add(crown);

  // Spire
  const spireH = 12 + rand() * 8;
  const spireBase = sbY + sbH;
  const spire = wireCone(2.5, spireH, 8, palette.accent);
  spire.position.y = spireBase + spireH / 2;
  group.add(spire);

  // Antenna
  const antH = 6;
  const ant = wireCylinder(0.1, 0.1, antH, 4, palette.accent);
  ant.position.y = spireBase + spireH + antH / 2;
  group.add(ant);

  // Horizontal band rings up the shaft
  for (let lvl = 0; lvl < 4; lvl++) {
    const wy = 3 + h * 0.15 + lvl * h * 0.18;
    const ring = wireCylinder(5.5, 5.5, 0.3, 8, palette.accent);
    ring.position.y = wy;
    group.add(ring);
  }

  group.position.set(cx, 0, cz);
  return group;
}
