/**
 * ForceAtlas2 with LinLog mode for project layout.
 *
 * Nodes = projects. Edges = shared people (weight = count of people in common).
 * No cluster zones — purely network-driven spatial arrangement.
 *
 * All 2D positions are expressed as (layoutU, layoutV).
 */

/** Build weighted edges: weight = number of people shared between two projects. */
export function buildProjectEdges(projects) {
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

function _fa2LinLog(nodes, edges, iters, { scalingRatio = 10, gravity = 0.3, speed = 0.1 } = {}) {
  const n   = nodes.length;
  const deg = new Float64Array(n);
  for (const { i, j, w } of edges) { deg[i] += w; deg[j] += w; }

  const vu = new Float64Array(n);
  const vv = new Float64Array(n);

  for (let iter = 0; iter < iters; iter++) {
    const fu = new Float64Array(n);
    const fv = new Float64Array(n);

    // Repulsion (all pairs, hub-weighted)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let du = nodes[i].layoutU - nodes[j].layoutU;
        let dv = nodes[i].layoutV - nodes[j].layoutV;
        const dist = Math.sqrt(du * du + dv * dv) || 0.01;
        const f    = scalingRatio * (deg[i] + 1) * (deg[j] + 1) / dist;
        du /= dist; dv /= dist;
        fu[i] += du * f; fv[i] += dv * f;
        fu[j] -= du * f; fv[j] -= dv * f;
      }
    }

    // LinLog attraction
    for (const { i, j, w } of edges) {
      const du   = nodes[j].layoutU - nodes[i].layoutU;
      const dv   = nodes[j].layoutV - nodes[i].layoutV;
      const dist = Math.sqrt(du * du + dv * dv) || 0.01;
      const f    = w * Math.log(1 + dist) / dist / (deg[i] + 1);
      fu[i] += du * f; fv[i] += dv * f;
      fu[j] -= du * f; fv[j] -= dv * f;
    }

    // Gravity toward origin
    for (let i = 0; i < n; i++) {
      const dist = Math.sqrt(nodes[i].layoutU ** 2 + nodes[i].layoutV ** 2) || 0.01;
      const f    = gravity * (deg[i] + 1);
      fu[i] -= (nodes[i].layoutU / dist) * f;
      fv[i] -= (nodes[i].layoutV / dist) * f;
    }

    // Integrate with momentum damping
    for (let i = 0; i < n; i++) {
      vu[i] = (vu[i] + fu[i] * speed) * 0.85;
      vv[i] = (vv[i] + fv[i] * speed) * 0.85;
      nodes[i].layoutU += vu[i];
      nodes[i].layoutV += vv[i];
    }
  }
}

function _enforceMinDist(nodes, minDist, iters = 50) {
  for (let iter = 0; iter < iters; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const du   = nodes[i].layoutU - nodes[j].layoutU;
        const dv   = nodes[i].layoutV - nodes[j].layoutV;
        const dist = Math.sqrt(du * du + dv * dv) || 0.001;
        if (dist < minDist) {
          const push  = (minDist - dist) / 2;
          const nu    = du / dist, nv = dv / dist;
          nodes[i].layoutU += nu * push;
          nodes[i].layoutV += nv * push;
          nodes[j].layoutU -= nu * push;
          nodes[j].layoutV -= nv * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

function _rescale(nodes, bounds, margin = 18) {
  const [minU, minV, maxU, maxV] = bounds;
  if (!nodes.length) return;

  let loU = Infinity, hiU = -Infinity, loV = Infinity, hiV = -Infinity;
  for (const n of nodes) {
    if (n.layoutU < loU) loU = n.layoutU;
    if (n.layoutU > hiU) hiU = n.layoutU;
    if (n.layoutV < loV) loV = n.layoutV;
    if (n.layoutV > hiV) hiV = n.layoutV;
  }

  const srcW = hiU - loU || 1, srcH = hiV - loV || 1;
  const dstW = (maxU - minU) - margin * 2;
  const dstH = (maxV - minV) - margin * 2;
  const scale = Math.min(dstW / srcW, dstH / srcH);

  const cu = (loU + hiU) / 2, cv = (loV + hiV) / 2;
  const ou = (minU + maxU) / 2, ov = (minV + maxV) / 2;

  for (const n of nodes) {
    n.layoutU = ou + (n.layoutU - cu) * scale;
    n.layoutV = ov + (n.layoutV - cv) * scale;
  }
}

// Spread of the baked layout: the layout's half-size grows with √(project count),
// so the area per project stays constant. 72·√10 ≈ 228 matches the original
// 10-project park. The runtime then sizes the park around whatever was baked.
export const LAYOUT_SPREAD = 72;

export function layoutHalfSize(projectCount) {
  return LAYOUT_SPREAD * Math.sqrt(Math.max(1, projectCount));
}

/**
 * Lay out projects by affinity, filling a square of half-size
 * `layoutHalfSize(projects.length)` centred on the origin.
 * @returns {ProjectNode[]} — each with layoutU, layoutV (+ id, name, etc.)
 */
export function layoutProjects(projects, rand) {
  const half = layoutHalfSize(projects.length);
  const bounds = [-half, -half, half, half];
  const edges = buildProjectEdges(projects);

  const n = projects.length;
  const nodes = projects.map((proj, i) => {
    const angle = (i / n) * Math.PI * 2;
    const r     = 5 + rand() * 5;
    return { ...proj, layoutU: Math.cos(angle) * r, layoutV: Math.sin(angle) * r };
  });

  _fa2LinLog(nodes, edges, 300, { scalingRatio: 5, gravity: 0.8, speed: 0.15 });
  _fa2LinLog(nodes, edges, 300, { scalingRatio: 15, gravity: 0.1, speed: 0.08 });
  _rescale(nodes, bounds, 0);
  _enforceMinDist(nodes, 55);

  return nodes;
}
