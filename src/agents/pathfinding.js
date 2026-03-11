/**
 * BFS shortest path on the road graph.
 * Returns ordered array of node ids from startId to goalId (inclusive).
 * Returns [] if no path exists.
 */
export function bfsPath(adjacency, startId, goalId) {
  if (startId === goalId) return [startId];

  const visited = new Set([startId]);
  const queue = [[startId, [startId]]];

  while (queue.length) {
    const [current, path] = queue.shift();
    for (const neighbor of (adjacency.get(current) ?? [])) {
      if (visited.has(neighbor)) continue;
      const newPath = [...path, neighbor];
      if (neighbor === goalId) return newPath;
      visited.add(neighbor);
      queue.push([neighbor, newPath]);
    }
  }

  return [];
}
