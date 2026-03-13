/**
 * ForceAtlas2 with LinLog mode for project layout.
 *
 * Nodes = projects. Edges = shared people (weight = count of people in common).
 * No cluster zones — purely network-driven spatial arrangement.
 *
 * LinLog mode: attraction = log(1 + dist) instead of dist.
 * This produces well-separated clusters with tighter internal structure
 * and more meaningful empty space between unrelated projects.
 *
 * Parameters tuned for ~15 nodes:
 *   - Low gravity so unconnected nodes drift to the periphery
 *   - scalingRatio high to push nodes apart
 *   - Two passes: first settle topology, then spread and rescale
 */

/** Build weighted edges: weight = number of people shared between two projects. */
function _buildEdges(projects) {
  const memberSets = projects.map(p =>
    new Set((p.members ?? '').split(';').map(s => s.trim()).filter(Boolean))
  );
  const edges = [];
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      let shared = 0;
      for (const m of memberSets[i]) { if (memberSets[j].has(m)) shared++; }
      if (shared > 0) edges.push({ i, j, w: shared });
    }
  }
  return edges;
}

/**
 * ForceAtlas2 — LinLog mode.
 *
 * LinLog replaces the standard attraction F = w * dist
 * with F = w * log(1 + dist), which compresses long edges and expands short ones,
 * creating natural spacing between clusters.
 *
 * Repulsion: F_r = scalingRatio * (deg_i + 1) * (deg_j + 1) / dist  (hub repulsion)
 * Attraction: F_a = w * log(1 + dist) / dist  (LinLog, normalised to unit vector)
 * Gravity:    F_g = gravity * (deg_i + 1)  toward origin
 */
function _fa2LinLog(nodes, edges, iters, { scalingRatio = 10, gravity = 0.3, speed = 0.1 } = {}) {
  const n   = nodes.length;
  const deg = new Float64Array(n);
  for (const { i, j, w } of edges) { deg[i] += w; deg[j] += w; }

  const vx = new Float64Array(n);
  const vy = new Float64Array(n);

  for (let iter = 0; iter < iters; iter++) {
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);

    // Repulsion (all pairs, hub-weighted)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f    = scalingRatio * (deg[i] + 1) * (deg[j] + 1) / dist;
        dx /= dist; dy /= dist;
        fx[i] += dx * f;  fy[i] += dy * f;
        fx[j] -= dx * f;  fy[j] -= dy * f;
      }
    }

    // LinLog attraction
    for (const { i, j, w } of edges) {
      const dx   = nodes[j].x - nodes[i].x;
      const dy   = nodes[j].y - nodes[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      // LinLog: log(1+d)/d  — divides out the distance, leaving log-scaled unit vector
      const f    = w * Math.log(1 + dist) / dist / (deg[i] + 1);
      fx[i] += dx * f;  fy[i] += dy * f;
      fx[j] -= dx * f;  fy[j] -= dy * f;
    }

    // Gravity toward origin
    for (let i = 0; i < n; i++) {
      const dist = Math.sqrt(nodes[i].x ** 2 + nodes[i].y ** 2) || 0.01;
      const f    = gravity * (deg[i] + 1);
      fx[i] -= (nodes[i].x / dist) * f;
      fy[i] -= (nodes[i].y / dist) * f;
    }

    // Integrate with momentum damping
    for (let i = 0; i < n; i++) {
      vx[i] = (vx[i] + fx[i] * speed) * 0.85;
      vy[i] = (vy[i] + fy[i] * speed) * 0.85;
      nodes[i].x += vx[i];
      nodes[i].y += vy[i];
    }
  }
}

/**
 * Push apart any nodes closer than `minDist`, iteratively.
 * Runs after rescaling so units are in world space.
 */
function _enforceMinDist(nodes, minDist, iters = 50) {
  for (let iter = 0; iter < iters; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx   = nodes[i].x - nodes[j].x;
        const dy   = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        if (dist < minDist) {
          const push  = (minDist - dist) / 2;
          const nx    = dx / dist, ny = dy / dist;
          nodes[i].x += nx * push;
          nodes[i].y += ny * push;
          nodes[j].x -= nx * push;
          nodes[j].y -= ny * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/**
 * Rescale positions to fill [minX+margin .. maxX-margin] uniformly,
 * preserving aspect ratio, centred in bounds.
 */
function _rescale(nodes, bounds, margin = 18) {
  const [minX, minY, maxX, maxY] = bounds;
  if (!nodes.length) return;

  let loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity;
  for (const n of nodes) {
    if (n.x < loX) loX = n.x; if (n.x > hiX) hiX = n.x;
    if (n.y < loY) loY = n.y; if (n.y > hiY) hiY = n.y;
  }

  const srcW = hiX - loX || 1, srcH = hiY - loY || 1;
  const dstW = (maxX - minX) - margin * 2;
  const dstH = (maxY - minY) - margin * 2;
  const scale = Math.min(dstW / srcW, dstH / srcH);

  const cx = (loX + hiX) / 2, cy = (loY + hiY) / 2;
  const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;

  for (const n of nodes) {
    n.x = ox + (n.x - cx) * scale;
    n.y = oy + (n.y - cy) * scale;
  }
}

/**
 * Main entry point.
 * @returns {object[]} projectNodes each with x, y (cluster field kept for palette compat)
 */
export function layoutProjectsByAffinity(projects, people, bounds, rand) {
  const edges = _buildEdges(projects);

  // Seed positions in a small jittered circle — FA2 is sensitive to initialisation
  const n = projects.length;
  const nodes = projects.map((proj, i) => {
    const angle = (i / n) * Math.PI * 2;
    const r     = 5 + rand() * 5;
    // Keep cluster field for downstream palette/compat — but layout ignores it
    const members = (proj.members ?? '').split(';').map(s => s.trim()).filter(Boolean);
    const clCounts = new Map();
    for (const id of members) {
      const cl = id.split('-')[0];
      clCounts.set(cl, (clCounts.get(cl) ?? 0) + 1);
    }
    let cluster = 'bridge', bestN = -1;
    for (const [cl, cnt] of clCounts) { if (cnt > bestN) { bestN = cnt; cluster = cl; } }

    return { ...proj, cluster, x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });

  // Pass 1: settle topology — moderate gravity holds things together
  _fa2LinLog(nodes, edges, 300, { scalingRatio: 5, gravity: 0.8, speed: 0.15 });

  // Pass 2: spread — low gravity, high repulsion pushes clusters apart
  _fa2LinLog(nodes, edges, 300, { scalingRatio: 15, gravity: 0.1, speed: 0.08 });

  // Maximise: fill the bounds
  _rescale(nodes, bounds, 20);

  // Enforce minimum separation between landmarks (world units)
  _enforceMinDist(nodes, 55);

  return nodes;
}

/** Derive cluster centroids from laid-out project nodes (for people spawn positions). */
export function clusterCentroidsFromProjects(projectNodes) {
  const sums   = new Map();
  const counts = new Map();
  for (const p of projectNodes) {
    if (!sums.has(p.cluster)) { sums.set(p.cluster, { x: 0, y: 0 }); counts.set(p.cluster, 0); }
    sums.get(p.cluster).x += p.x;
    sums.get(p.cluster).y += p.y;
    counts.set(p.cluster, counts.get(p.cluster) + 1);
  }
  return [...sums.entries()].map(([cl, sum]) => {
    const n = counts.get(cl);
    return { id: cl, cluster: cl, x: sum.x / n, y: sum.y / n };
  });
}
