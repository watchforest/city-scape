/**
 * NavGraphBuilder — builds a lightweight navigation graph.
 *
 * One node per project at its layoutU/V position.
 * Edges come from the route edges (MST + bypass connections).
 * Used by steering agents to look up goal positions; not traversed as a
 * dense waypoint chain.
 *
 * Returns NavGraph: { nodes, adjacency, nodeMap }
 * All positions in UV space (u, v).
 */

// ── Node map helpers ──────────────────────────────────────────────────────────

function _addNode(id, u, v, nodeMap, adj) {
  if (!nodeMap.has(id)) { nodeMap.set(id, { id, u, v }); adj.set(id, []); }
}

function _link(a, b, adj) {
  const la = adj.get(a), lb = adj.get(b);
  if (la && !la.includes(b)) la.push(b);
  if (lb && !lb.includes(a)) lb.push(a);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object}        routes       — from PathRouter.buildRoutes()
 * @param {PathSegment[]} segments     — from PathRenderer.renderPaths() (unused, kept for API compat)
 * @param {ProjectNode[]} projectNodes
 * @returns {NavGraph}
 */
export function buildNavGraph(routes, segments, projectNodes) {
  const { edges: routeEdges } = routes;

  const nodeMap = new Map();
  const adj     = new Map();

  // One node per project at its layout position
  for (const proj of projectNodes) {
    _addNode(proj.id, proj.layoutU, proj.layoutV, nodeMap, adj);
  }

  // Connect nodes using route edges
  for (const route of routeEdges) {
    const { fromId, toId } = route;
    if (nodeMap.has(fromId) && nodeMap.has(toId)) {
      _link(fromId, toId, adj);
    }
  }

  // ── Connectivity repair ───────────────────────────────────────────────────
  // Find the largest connected component, then link any isolated project node
  // to its nearest node in the main component with a direct edge.
  {
    function _bfsComponent(startId) {
      const seen = new Set();
      const q = [startId];
      while (q.length) {
        const id = q.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        for (const nb of (adj.get(id) ?? [])) q.push(nb);
      }
      return seen;
    }

    const allIds = [...nodeMap.keys()];
    const visited = new Set();
    let mainComponent = new Set();
    for (const id of allIds) {
      if (visited.has(id)) continue;
      const comp = _bfsComponent(id);
      for (const cid of comp) visited.add(cid);
      if (comp.size > mainComponent.size) mainComponent = comp;
    }

    for (const proj of projectNodes) {
      if (mainComponent.has(proj.id)) continue;
      if (!nodeMap.has(proj.id)) continue;
      const self = nodeMap.get(proj.id);
      let bestId = null, bestDist = Infinity;
      for (const id of mainComponent) {
        const n = nodeMap.get(id);
        if (!n) continue;
        const d = (n.u - self.u) ** 2 + (n.v - self.v) ** 2;
        if (d < bestDist) { bestDist = d; bestId = id; }
      }
      if (bestId) {
        _link(proj.id, bestId, adj);
        const comp = _bfsComponent(proj.id);
        for (const cid of comp) mainComponent.add(cid);
      }
    }
  }

  return {
    nodes: [...nodeMap.values()],
    adjacency: adj,
    nodeMap,
  };
}
