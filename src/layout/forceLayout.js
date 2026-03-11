/**
 * Force-directed layout for district nodes AND project nodes.
 *
 * Districts repel each other and attract based on inter-cluster connection weight.
 * Projects are pulled toward the centroids of their member clusters.
 *
 * Mutates x, y on all nodes in place.
 */

function runSimulation(nodes, attractionEdges, bounds, iterations, coolingStart, coolingEnd) {
  const [minX, minY, maxX, maxY] = bounds;
  const area = (maxX - minX) * (maxY - minY);
  const k = Math.sqrt(area / Math.max(nodes.length, 1));
  const vel = nodes.map(() => ({ x: 0, y: 0 }));

  for (let iter = 0; iter < iterations; iter++) {
    const temp = coolingStart * Math.pow(coolingEnd / coolingStart, iter / iterations);

    for (const v of vel) { v.x = 0; v.y = 0; }

    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        dx /= dist; dy /= dist;
        vel[i].x += dx * force;
        vel[i].y += dy * force;
        vel[j].x -= dx * force;
        vel[j].y -= dy * force;
      }
    }

    // Attraction along edges
    for (const { ai, bi, weight } of attractionEdges) {
      let dx = nodes[bi].x - nodes[ai].x;
      let dy = nodes[bi].y - nodes[ai].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k * (1 + weight * 0.4);
      dx /= dist; dy /= dist;
      vel[ai].x += dx * force;
      vel[ai].y += dy * force;
      vel[bi].x -= dx * force;
      vel[bi].y -= dy * force;
    }

    // Apply velocities
    for (let i = 0; i < nodes.length; i++) {
      const vx = vel[i].x, vy = vel[i].y;
      const vmag = Math.sqrt(vx * vx + vy * vy) || 1;
      const step = Math.min(vmag, temp);
      nodes[i].x = Math.max(minX + 20, Math.min(maxX - 20, nodes[i].x + (vx / vmag) * step));
      nodes[i].y = Math.max(minY + 20, Math.min(maxY - 20, nodes[i].y + (vy / vmag) * step));
    }
  }
}

/**
 * Positions district nodes based on inter-cluster connection weights.
 */
export function runForceLayout(districtNodes, personEdges, personNodes, bounds) {
  if (!personEdges.length || !personNodes.length) return districtNodes;

  const personCluster = new Map(personNodes.map(p => [p.id, p.cluster]));
  const districtWeights = new Map();

  for (const { source, target, weight } of personEdges) {
    const ca = personCluster.get(source);
    const cb = personCluster.get(target);
    if (!ca || !cb || ca === cb) continue;
    const key = ca < cb ? `${ca}|${cb}` : `${cb}|${ca}`;
    districtWeights.set(key, (districtWeights.get(key) ?? 0) + weight);
  }

  const attractionEdges = [];
  for (const [key, weight] of districtWeights) {
    const [ca, cb] = key.split('|');
    const ai = districtNodes.findIndex(n => n.cluster === ca);
    const bi = districtNodes.findIndex(n => n.cluster === cb);
    if (ai >= 0 && bi >= 0) attractionEdges.push({ ai, bi, weight });
  }

  runSimulation(districtNodes, attractionEdges, bounds, 120, 30, 2);
  return districtNodes;
}

/**
 * Positions project nodes, each pulled toward the centroid of its member clusters.
 * Projects start near the average position of their member districts.
 *
 * Returns array of project nodes with x, y set.
 */
export function layoutProjects(projects, districtNodes, bounds, rand) {
  const clusterPos = new Map();
  for (const d of districtNodes) {
    if (!clusterPos.has(d.cluster)) clusterPos.set(d.cluster, { x: d.x, y: d.y });
  }

  // Build a map from personId -> cluster from districtNodes
  // (projects reference person ids; we need cluster centroids)
  // We'll use a best-effort: split members, look up which district cluster they belong to
  // by matching the id prefix against cluster names
  const personClusterMap = new Map();
  for (const d of districtNodes) {
    // e.g. district id 'ml-0' -> cluster 'ml'
    // We store cluster -> position already; we need personId -> cluster
    // This is populated externally — see main.js passing personNodes
  }

  // Place each project at the average position of its member clusters
  const projectNodes = projects.map((proj, idx) => {
    const members = (proj.members ?? '').split(';').map(s => s.trim()).filter(Boolean);
    const clusters = [...new Set(members.map(id => id.split('-')[0]))];
    let ax = 0, ay = 0, count = 0;
    for (const c of clusters) {
      const pos = clusterPos.get(c);
      if (pos) { ax += pos.x; ay += pos.y; count++; }
    }
    if (count === 0) { ax = (bounds[0] + bounds[2]) / 2; ay = (bounds[1] + bounds[3]) / 2; }
    else { ax /= count; ay /= count; }

    // Add jitter so projects in the same area don't stack
    const angle = rand() * Math.PI * 2;
    const r = 15 + rand() * 20;
    return {
      ...proj,
      x: ax + Math.cos(angle) * r,
      y: ay + Math.sin(angle) * r,
      nodeType: 'project',
    };
  });

  // Light simulation: projects repel each other, attract to their member cluster centroids
  const [minX, minY, maxX, maxY] = bounds;
  const attractionEdges = [];
  for (let pi = 0; pi < projectNodes.length; pi++) {
    const proj = projects[pi];
    const members = (proj.members ?? '').split(';').map(s => s.trim()).filter(Boolean);
    const clusters = [...new Set(members.map(id => id.split('-')[0]))];
    for (const c of clusters) {
      const di = districtNodes.findIndex(n => n.cluster === c);
      if (di >= 0) {
        // We'll run a combined simulation with districts fixed
        // Use a virtual anchor node per cluster
      }
    }
  }

  // Simpler approach: just run repulsion among projects + spring to cluster centroid
  const ITERS = 80;
  const k = 25;
  for (let iter = 0; iter < ITERS; iter++) {
    const temp = 15 * Math.pow(0.5 / 15, iter / ITERS);
    const vel = projectNodes.map(() => ({ x: 0, y: 0 }));

    // Project-project repulsion
    for (let i = 0; i < projectNodes.length; i++) {
      for (let j = i + 1; j < projectNodes.length; j++) {
        let dx = projectNodes[i].x - projectNodes[j].x;
        let dy = projectNodes[i].y - projectNodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        dx /= dist; dy /= dist;
        vel[i].x += dx * force;
        vel[i].y += dy * force;
        vel[j].x -= dx * force;
        vel[j].y -= dy * force;
      }
    }

    // Spring toward member cluster centroids
    for (let i = 0; i < projectNodes.length; i++) {
      const proj = projects[i];
      const members = (proj.members ?? '').split(';').map(s => s.trim()).filter(Boolean);
      const clusters = [...new Set(members.map(id => id.split('-')[0]))];
      for (const c of clusters) {
        const pos = clusterPos.get(c);
        if (!pos) continue;
        let dx = pos.x - projectNodes[i].x;
        let dy = pos.y - projectNodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (dist * dist) / (k * 2);
        dx /= dist; dy /= dist;
        vel[i].x += dx * force;
        vel[i].y += dy * force;
      }
    }

    // Apply
    for (let i = 0; i < projectNodes.length; i++) {
      const vx = vel[i].x, vy = vel[i].y;
      const vmag = Math.sqrt(vx * vx + vy * vy) || 1;
      const step = Math.min(vmag, temp);
      projectNodes[i].x = Math.max(minX + 15, Math.min(maxX - 15, projectNodes[i].x + (vx / vmag) * step));
      projectNodes[i].y = Math.max(minY + 15, Math.min(maxY - 15, projectNodes[i].y + (vy / vmag) * step));
    }
  }

  return projectNodes;
}
