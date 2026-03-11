import * as THREE from 'three';

let _renderer;

export function createScene() {
  _renderer = new THREE.WebGLRenderer({ antialias: true });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.setSize(window.innerWidth, window.innerHeight);
  _renderer.setClearColor(0x000000);
  document.body.appendChild(_renderer.domElement);

  const scene = new THREE.Scene();
  return { scene, renderer: _renderer };
}
