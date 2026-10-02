/**
 * PathRouter — geometry-free path topology.
 *
 * Given an array of ProjectNodes (with layoutU, layoutV), computes:
 *   - MST + extra random edges
 *   - Degree per node → plaza classification
 *   - Per-edge control points (Catmull-Rom with bypass arcs around obstacles)
 *
 * No Three.js. All positions are in (u, v) UV space.
 */

import { LANDMARK_CLEARANCE } from '../config.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const EXCLUSION_RADIUS   = 18;
const PLAZA_MIN_DEGREE   = 3;
const PLAZA_RADIUS_BASE  = 24;
const PLAZA_RADIUS_SCALE = 3;
const CURVE_JITTER       = 0.32;


// ── MST ───────────────────────────────────────────────────────────────────────

function _euclideanMST(nodes) {
  if (nodes.length < 2) return [];
  const inMST = new Set([0]), edges = [];
  while (inMST.size < nodes.length) {
    let best = Infinity, bi = -1, bj = -1;
    for (const i of inMST) {
      for (let j = 0; j < nodes.length; j++) {
        if (inMST.has(j)) continue;
        const d = (nodes[i].layoutU - nodes[j].layoutU) ** 2 +
                  (nodes[i].layoutV - nodes[j].layoutV) ** 2;
        if (d < best) { best = d; bi = i; bj = j; }
      }
    }
    if (bi < 0) break;
    edges.push({ i: bi, j: bj });
    inMST.add(bj);
  }
  return edges;
}


// ── Bypass geometry ───────────────────────────────────────────────────────────

function _segmentClipsCircle(pu, pv, qu, qv, cu, cv, r) {
  const du = qu - pu, dv = qv - pv;
  const len = Math.hypot(du, dv) || 1;
  const nu = du/len, nv = dv/len;
  const tu = pu - cu, tv = pv - cv;
  const b  = 2 * (tu*nu + tv*nv);
  const c  = tu*tu + tv*tv - r*r;
  const disc = b*b - 4*c;
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / 2;
  const t2 = (-b + sq) / 2;
  return t1 < len && t2 > 0;
}

function _tangentBypass(pu, pv, qu, qv, cu, cv, r, side) {
  function tangentFrom(eu, ev) {
    const du = cu - eu, dv = cv - ev;
    const dist = Math.hypot(du, dv);
    if (dist <= r) return null;
    const angle = Math.atan2(dv, du);
    const alpha = Math.asin(Math.min(r / dist, 1));
    const a1 = angle + Math.PI/2 - alpha;
    const a2 = angle - Math.PI/2 + alpha;
    return [
      { u: cu + r * Math.cos(a1), v: cv + r * Math.sin(a1), angle: a1 },
      { u: cu + r * Math.cos(a2), v: cv + r * Math.sin(a2), angle: a2 },
    ];
  }

  const fromTan = tangentFrom(pu, pv);
  const toTan   = tangentFrom(qu, qv);
  if (!fromTan || !toTan) return null;

  const smu = (pu+qu)/2, smv = (pv+qv)/2;
  const sdu = qu-pu, sdv = qv-pv;
  const sLen = Math.hypot(sdu, sdv) || 1;
  const perpU = -sdv/sLen, perpV = sdu/sLen;
  const cSide = (cu-smu)*perpU + (cv-smv)*perpV > 0 ? 1 : -1;
  const chosenSide = side * cSide;

  const entry = (fromTan[0].u - cu)*perpU + (fromTan[0].v - cv)*perpV > 0
    ? (chosenSide > 0 ? fromTan[0] : fromTan[1])
    : (chosenSide > 0 ? fromTan[1] : fromTan[0]);

  const exit = (toTan[0].u - cu)*perpU + (toTan[0].v - cv)*perpV > 0
    ? (chosenSide > 0 ? toTan[0] : toTan[1])
    : (chosenSide > 0 ? toTan[1] : toTan[0]);

  let arcSpan = exit.angle - entry.angle;
  if (chosenSide > 0 && arcSpan < 0) arcSpan += Math.PI * 2;
  if (chosenSide < 0 && arcSpan > 0) arcSpan -= Math.PI * 2;

  const ARC_PTS = 12;
  const arcPts = [];
  for (let k = 0; k <= ARC_PTS; k++) {
    const a = entry.angle + arcSpan * (k / ARC_PTS);
    arcPts.push({ u: cu + Math.cos(a) * r, v: cv + Math.sin(a) * r });
  }

  return { entry, arcPts, exit };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Build path route data from project nodes.
 *
 * @param {ProjectNode[]} projectNodes — each has { id, layoutU, layoutV }
 * @param {function}      rand
 * @param {Map<string, number>} footprints — landmark bounding radius per project id
 * @returns {{
 *   edges: Array<{ fromId, toId, controlPts: {u,v}[], bypassMidPt: Map<string,{u,v}> }>,
 *   degree: Map<string, number>,
 *   plazaRadius: Map<string, number>,
 *   exclusionRadius: Map<string, number>,
 *   bypassSide: Map<string, number>,
 * }}
 */
export function buildRoutes(projectNodes, rand, affinityEdges = null, footprints = new Map()) {
  // Use affinity edges (shared members) if provided, fall back to euclidean MST
  const base = affinityEdges && affinityEdges.length > 0 ? affinityEdges : _euclideanMST(projectNodes);

  // Ensure all nodes are reachable — add MST edges for any disconnected nodes
  const connected = new Set();
  for (const { i, j } of base) { connected.add(i); connected.add(j); }
  const isolated = projectNodes.map((_, idx) => idx).filter(idx => !connected.has(idx));
  const mstFallback = isolated.length > 0 ? _euclideanMST(projectNodes) : [];
  const fallbackEdges = mstFallback.filter(e => !connected.has(e.i) || !connected.has(e.j));

  const allEdges = [...base, ...fallbackEdges];

  // Degree per landmark
  const degree = new Map(projectNodes.map(p => [p.id, 0]));
  for (const { i, j } of allEdges) {
    degree.set(projectNodes[i].id, (degree.get(projectNodes[i].id) ?? 0) + 1);
    degree.set(projectNodes[j].id, (degree.get(projectNodes[j].id) ?? 0) + 1);
  }

  // Plaza radius (0 = no plaza). A plaza is at least big enough to hold its landmark.
  // Non-plaza nodes instead get an exclusion radius that pushes paths away from a big landmark.
  const plazaRadius = new Map();
  const exclusionRadius = new Map();
  for (const p of projectNodes) {
    const deg = degree.get(p.id) ?? 0;
    const need = (footprints.get(p.id) ?? 0) + LANDMARK_CLEARANCE;
    plazaRadius.set(p.id, deg >= PLAZA_MIN_DEGREE
      ? Math.max(PLAZA_RADIUS_BASE + (deg - PLAZA_MIN_DEGREE) * PLAZA_RADIUS_SCALE, need)
      : 0);
    exclusionRadius.set(p.id, Math.max(EXCLUSION_RADIUS, need));
  }

  // Per-landmark bypass side (+1/-1) — seeded deterministic
  const bypassSide = new Map();
  for (const p of projectNodes) bypassSide.set(p.id, rand() < 0.5 ? 1 : -1);

  // Per-edge control points
  const edges = [];

  for (const { i, j } of allEdges) {
    const A = projectNodes[i], B = projectNodes[j];
    if (!A || !B) continue;

    const rA   = plazaRadius.get(A.id);
    const rB   = plazaRadius.get(B.id);
    const degA = degree.get(A.id) ?? 0;
    const degB = degree.get(B.id) ?? 0;

    const du0 = B.layoutU - A.layoutU, dv0 = B.layoutV - A.layoutV;
    const d0  = Math.hypot(du0, dv0) || 1;

    const isTransitA = rA === 0 && degA >= 2;
    const isTransitB = rB === 0 && degB >= 2;

    const startR = rA > 0 ? rA * 0.85 : (isTransitA ? 0 : exclusionRadius.get(A.id));
    const endR   = rB > 0 ? rB * 0.85 : (isTransitB ? 0 : exclusionRadius.get(B.id));
    const totalR = startR + endR;
    const clampF = totalR > 0 && d0 < totalR ? d0 / totalR : 1;
    const pStart = { u: A.layoutU + (du0/d0)*startR*clampF, v: A.layoutV + (dv0/d0)*startR*clampF };
    const pEnd   = { u: B.layoutU - (du0/d0)*endR*clampF,   v: B.layoutV - (dv0/d0)*endR*clampF   };

    // Find intermediate obstacles
    const obstacles = [];
    for (const C of projectNodes) {
      if (plazaRadius.get(C.id) > 0) continue;
      if (C.id === A.id || C.id === B.id) continue;
      if (_segmentClipsCircle(pStart.u, pStart.v, pEnd.u, pEnd.v, C.layoutU, C.layoutV, exclusionRadius.get(C.id))) {
        const du = C.layoutU - pStart.u, dv = C.layoutV - pStart.v;
        obstacles.push({ node: C, along: du*(pEnd.u-pStart.u) + dv*(pEnd.v-pStart.v) });
      }
    }
    obstacles.sort((a, b) => a.along - b.along);

    // Build control points with bypass arcs
    const ctrlPts = [pStart];
    let cur = pStart;
    const bypassMidPt = new Map();

    for (const { node: C } of obstacles) {
      const bypass = _tangentBypass(cur.u, cur.v, pEnd.u, pEnd.v, C.layoutU, C.layoutV, exclusionRadius.get(C.id), bypassSide.get(C.id));
      if (!bypass) continue;
      ctrlPts.push(bypass.entry, ...bypass.arcPts, bypass.exit);
      cur = bypass.exit;
      if (!bypassMidPt.has(C.id)) {
        const mid = bypass.arcPts[Math.floor(bypass.arcPts.length / 2)];
        bypassMidPt.set(C.id, { u: mid.u, v: mid.v });
      }
    }
    ctrlPts.push(pEnd);

    // Enrich with mid-segment jitter for curviness
    const enriched = [ctrlPts[0]];
    for (let k = 1; k < ctrlPts.length; k++) {
      const prev = ctrlPts[k-1], next = ctrlPts[k];
      const eu = next.u - prev.u, ev = next.v - prev.v;
      const el = Math.hypot(eu, ev) || 1;
      if (el > 40) {
        const mu = (prev.u + next.u) / 2;
        const mv = (prev.v + next.v) / 2;
        const pu = -ev/el, pv = eu/el;
        const jitter = (rand() - 0.5) * el * CURVE_JITTER;
        enriched.push({ u: mu + pu*jitter, v: mv + pv*jitter });
      }
      enriched.push(next);
    }

    // Jitter interior control points
    for (let k = 1; k < enriched.length - 1; k++) {
      const prev = enriched[k-1], next = enriched[k+1];
      const eu = next.u - prev.u, ev = next.v - prev.v;
      const el = Math.hypot(eu, ev) || 1;
      const pu = -ev/el, pv = eu/el;
      const jitter = (rand() - 0.5) * 2 * el * CURVE_JITTER;
      enriched[k] = { u: enriched[k].u + pu*jitter, v: enriched[k].v + pv*jitter };
    }

    edges.push({
      fromId: A.id,
      toId: B.id,
      controlPts: enriched,
      bypassMidPt,
    });
  }

  return { edges, degree, plazaRadius, exclusionRadius, bypassSide };
}

export { EXCLUSION_RADIUS, PLAZA_MIN_DEGREE, PLAZA_RADIUS_BASE, PLAZA_RADIUS_SCALE };
