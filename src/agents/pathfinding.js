/**
 * Dijkstra shortest path weighted by Euclidean distance.
 * Agents take the geometrically shortest route, so they walk around
 * plaza rings rather than cutting across in fewer hops.
 * Returns ordered array of node ids from startId to goalId (inclusive).
 * Returns [] if no path exists.
 */
export function bfsPath(adjacency, startId, goalId, nodeMap) {
  if (startId === goalId) return [startId];

  // Min-heap via sorted insertion — graph is small enough that this is fine
  const dist  = new Map([[startId, 0]]);
  const prev  = new Map();
  const visited = new Set();
  const queue = [{ id: startId, d: 0 }];

  while (queue.length) {
    queue.sort((a, b) => a.d - b.d);
    const { id: current, d: currentDist } = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === goalId) break;

    for (const neighbor of (adjacency.get(current) ?? [])) {
      if (visited.has(neighbor)) continue;
      // Edge weight = Euclidean distance when nodeMap available, else 1
      let w = 1;
      if (nodeMap) {
        const a = nodeMap.get(current), b = nodeMap.get(neighbor);
        if (a && b) w = Math.hypot(b.x - a.x, b.y - a.y);
      }
      const nd = currentDist + w;
      if (nd < (dist.get(neighbor) ?? Infinity)) {
        dist.set(neighbor, nd);
        prev.set(neighbor, current);
        queue.push({ id: neighbor, d: nd });
      }
    }
  }

  if (!prev.has(goalId) && startId !== goalId) return [];

  const path = [];
  let cur = goalId;
  while (cur !== undefined) { path.push(cur); cur = prev.get(cur); }
  return path.reverse();
}
