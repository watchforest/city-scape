import { Delaunay } from 'd3-delaunay';
import { edgeKey } from '@/utils/geometry.js';

/**
 * Builds Voronoi diagram from district nodes.
 *
 * Returns:
 *   cellPolygons   — array of polygon vertex arrays, index-aligned with nodes
 *   edges          — deduplicated road segments: [[ [ax,ay],[bx,by] ], ...]
 *   intersections  — unique Voronoi vertices: [ [x,y], ... ]
 */
export function buildVoronoi(nodes, bounds) {
  const delaunay = Delaunay.from(nodes, d => d.x, d => d.y);
  const voronoi  = delaunay.voronoi(bounds);

  const cellPolygons = nodes.map((_, i) => voronoi.cellPolygon(i));

  // Deduplicate edges and collect intersection points
  const seen = new Set();
  const edges = [];
  const intersectionSet = new Set();
  const intersections = [];

  for (const poly of cellPolygons) {
    if (!poly) continue;
    for (let j = 0; j < poly.length - 1; j++) {
      const ax = Math.round(poly[j][0]   * 100) / 100;
      const ay = Math.round(poly[j][1]   * 100) / 100;
      const bx = Math.round(poly[j+1][0] * 100) / 100;
      const by = Math.round(poly[j+1][1] * 100) / 100;

      const key = edgeKey(ax, ay, bx, by);
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([[ax, ay], [bx, by]]);
      }

      for (const [px, py] of [[ax, ay], [bx, by]]) {
        const vkey = `${Math.round(px * 10)},${Math.round(py * 10)}`;
        if (!intersectionSet.has(vkey)) {
          intersectionSet.add(vkey);
          intersections.push([px, py]);
        }
      }
    }
  }

  return { cellPolygons, edges, intersections };
}
