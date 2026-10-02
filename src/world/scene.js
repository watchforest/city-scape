import * as THREE from 'three';
import { SKY_DAY, MAX_PIXEL_RATIO } from '@/config.js';

let _renderer;

export function createScene() {
  _renderer = new THREE.WebGLRenderer({ antialias: true });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  _renderer.setSize(window.innerWidth, window.innerHeight);
  _renderer.shadowMap.enabled = true;
  _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(_renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_DAY);

  return { scene, renderer: _renderer };
}
