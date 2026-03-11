import * as THREE from 'three';
import { CLUSTER_PALETTES, NETWORK_COLOR } from '@/config.js';

/**
 * Renders the people-connection network as lines in 3D.
 *
 * edges — array of { source, target, weight, waypoints }
 *   waypoints: [ [x,y], [x,y], ... ] in 2D world space (XZ plane)
 *   If waypoints has only 2 points, it's a straight line (placeholder routing).
 *   Future: waypoints will be filled by road-graph BFS routing.
 *
 * nodes — array of district/person nodes with x, y, cluster
 *
 * Returns a THREE.Group so it can be toggled visible/invisible.
 */
export function buildNetworkLayer(scene, nodes, edges) {
  const group = new THREE.Group();
  group.name = 'networkLayer';

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Draw edges
  for (const edge of edges) {
    const src = nodeById.get(edge.source);
    const tgt = nodeById.get(edge.target);
    if (!src || !tgt) continue;

    const waypoints = edge.waypoints ?? [[src.x, src.y], [tgt.x, tgt.y]];
    const pts = waypoints.map(([x, y]) => new THREE.Vector3(x, 1, y));
    const geom = new THREE.BufferGeometry().setFromPoints(pts);

    const palette = CLUSTER_PALETTES[src.cluster];
    const color = palette ? palette.accent : NETWORK_COLOR;
    const opacity = Math.min(1, 0.25 + edge.weight * 0.2);

    group.add(new THREE.Line(geom, new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
    })));
  }

  // Draw person nodes as small vertical lines (spikes) so they're visible
  for (const node of nodes) {
    const palette = CLUSTER_PALETTES[node.cluster];
    const color = palette ? palette.primary : NETWORK_COLOR;
    const pts = [
      new THREE.Vector3(node.x, 0, node.y),
      new THREE.Vector3(node.x, 3, node.y),
    ];
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color })
    ));
  }

  scene.add(group);
  return group;
}
