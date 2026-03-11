import * as THREE from 'three';
import { CLUSTER_PALETTES, ROAD_COLOR } from '@/config.js';

/**
 * Renders Voronoi cell outlines and road lines into the scene.
 */
export function renderDistricts(scene, nodes, cellPolygons, edges) {
  // Cell outlines
  for (let i = 0; i < nodes.length; i++) {
    const poly = cellPolygons[i];
    if (!poly) continue;
    const palette = CLUSTER_PALETTES[nodes[i].cluster];

    const pts = poly.map(([x, y]) => new THREE.Vector3(x, 0.05, y));
    pts.push(pts[0].clone()); // close loop
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    scene.add(new THREE.Line(geom, new THREE.LineBasicMaterial({ color: palette.primary })));
  }

  // Road lines along Voronoi edges
  const roadMat = new THREE.LineBasicMaterial({ color: ROAD_COLOR });
  for (const [[ax, ay], [bx, by]] of edges) {
    const pts = [new THREE.Vector3(ax, 0.1, ay), new THREE.Vector3(bx, 0.1, by)];
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    scene.add(new THREE.Line(geom, roadMat));
  }
}
