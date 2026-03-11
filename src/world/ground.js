import * as THREE from 'three';
import { GRID_COLOR } from '@/config.js';

export function buildGround(scene) {
  const grid = new THREE.GridHelper(400, 40, GRID_COLOR, GRID_COLOR);
  grid.position.y = 0;
  scene.add(grid);
}
