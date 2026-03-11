import * as THREE from 'three';

export function wireBox(w, h, d, color) {
  const geom = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
  return new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color }));
}

export function wireCylinder(rTop, rBot, h, segs, color) {
  const geom = new THREE.EdgesGeometry(new THREE.CylinderGeometry(rTop, rBot, h, segs));
  return new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color }));
}

export function wireCone(r, h, segs, color) {
  const geom = new THREE.EdgesGeometry(new THREE.ConeGeometry(r, h, segs));
  return new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color }));
}
