/**
 * Builds an adjacency graph from Voronoi intersection points and edges.
 *
 * Returns:
 *   nodes      — [ { id, x, y }, ... ]
 *   adjacency  — Map<id, id[]>
 */
export function buildRoadGraph(intersections, edges) {
  // Round to same precision used during edge extraction
  const key = (x, y) => `${Math.round(x * 10)},${Math.round(y * 10)}`;

  const nodeMap = new Map(); // key -> { id, x, y }
  const adjacency = new Map(); // id -> id[]

  for (const [x, y] of intersections) {
    const k = key(x, y);
    if (!nodeMap.has(k)) {
      nodeMap.set(k, { id: k, x, y });
      adjacency.set(k, []);
    }
  }

  for (const [[ax, ay], [bx, by]] of edges) {
    const ka = key(ax, ay);
    const kb = key(bx, by);
    if (!nodeMap.has(ka) || !nodeMap.has(kb)) continue;

    // Skip degenerate zero-length edges
    const dx = bx - ax, dy = by - ay;
    if (dx * dx + dy * dy < 0.01) continue;

    adjacency.get(ka).push(kb);
    adjacency.get(kb).push(ka);
  }

  return {
    nodes: [...nodeMap.values()],
    adjacency,
    nodeMap,
  };
}
