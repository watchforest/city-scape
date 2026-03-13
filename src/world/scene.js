import * as THREE from 'three';
import { SKY_DAY } from '@/config.js';

let _renderer;

export function createScene() {
  _renderer = new THREE.WebGLRenderer({ antialias: true });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.setSize(window.innerWidth, window.innerHeight);
  _renderer.shadowMap.enabled = true;
  _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(_renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_DAY);

  return { scene, renderer: _renderer };
}
