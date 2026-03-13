/**
 * Path network — walkable dirt surface connecting landmarks.
 *
 * Node types:
 *   PLAZA   (degree >= PLAZA_MIN_DEGREE): circular dirt disc, paths connect to its edge
 *   LEAF    (degree == 1):               path terminates near landmark, nav node on path edge
 *   TRANSIT (degree >= 2, no plaza):     path curves around landmark via tangent bypass
 *
 * For each MST/extra edge A→B:
 *   1. Start/end points are on the exclusion circle of A and B (or plaza edge for plazas).
 *      Transit nodes are treated as bypass obstacles so the ribbon passes beside them.
 *   2. Walk the straight line A→B. For every intermediate landmark C whose exclusion
 *      circle the line clips, insert a tangent bypass around C.
 *   3. Fit the resulting control points as a Catmull-Rom spline with organic jitter.
 *   4. Nav nodes are created at every sample point — including the first and last —
 *      so there are no dangling chain endpoints.
 */

import * as THREE from 'three';
import { PATH_COLOR } from '@/config.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const PATH_WIDTH          = 8;
const EXCLUSION_RADIUS    = 18;   // clearance radius around every non-plaza landmark
const PLAZA_MIN_DEGREE    = 3;
const PLAZA_RADIUS_BASE   = 24;
const PLAZA_RADIUS_SCALE  = 3;
const PLAZA_SEGMENTS      = 32;
const CURVE_JITTER        = 0.32; // organic perpendicular jitter (increased for curviness)
const NAV_SAMPLE_STEP     = 6;
const MIN_RIBBON_LEN      = 8;

// ── Material ──────────────────────────────────────────────────────────────────

function _mat() {
  return new THREE.MeshLambertMaterial({ color: PATH_COLOR, side: THREE.DoubleSide });
}

// ── Geometry ──────────────────────────────────────────────────────────────────

function _discGeo(cx, cy, r) {
  const pos = [cx, 0.02, cy], idx = [];
  for (let i = 0; i <= PLAZA_SEGMENTS; i++) {
    const a = (i / PLAZA_SEGMENTS) * Math.PI * 2;
    pos.push(cx + Math.cos(a) * r, 0.02, cy + Math.sin(a) * r);
  }
  for (let i = 0; i < PLAZA_SEGMENTS; i++) idx.push(0, i+1, i+2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function _ribbonGeo(pts, width) {
  const pos = [], idx = [];
  for (const { x, y, tx, ty } of pts) {
    const hw = width / 2;
    pos.push(x - ty*hw, 0.02, y + tx*hw);
    pos.push(x + ty*hw, 0.02, y - tx*hw);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const b = i * 2;
    idx.push(b, b+1, b+2, b+1, b+3, b+2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── Catmull-Rom spline sampler ────────────────────────────────────────────────

function _catmullAt(p0, p1, p2, p3, t) {
  const t2 = t*t, t3 = t2*t;
  return {
    x: 0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    y: 0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
  };
}

function _catmullTanAt(p0, p1, p2, p3, t) {
  const t2 = t*t;
  return {
    x: 0.5*((-p0.x+p2.x)+2*(2*p0.x-5*p1.x+4*p2.x-p3.x)*t+3*(-p0.x+3*p1.x-3*p2.x+p3.x)*t2),
    y: 0.5*((-p0.y+p2.y)+2*(2*p0.y-5*p1.y+4*p2.y-p3.y)*t+3*(-p0.y+3*p1.y-3*p2.y+p3.y)*t2),
  };
}

function _sampleSpline(pts, step) {
  const n = pts.length;
  if (n < 2) return [];
  const RAW = (n - 1) * 80;
  const raw = [];
  for (let s = 0; s <= RAW; s++) {
    const u  = (s / RAW) * (n - 1);
    const i  = Math.min(Math.floor(u), n - 2);
    const t  = u - i;
    const p0 = pts[Math.max(i-1, 0)];
    const p1 = pts[i];
    const p2 = pts[Math.min(i+1, n-1)];
    const p3 = pts[Math.min(i+2, n-1)];
    const p  = _catmullAt(p0, p1, p2, p3, t);
    const g  = _catmullTanAt(p0, p1, p2, p3, t);
    const gl = Math.hypot(g.x, g.y) || 1;
    const arc = s === 0 ? 0 : raw[s-1].arc + Math.hypot(p.x-raw[s-1].x, p.y-raw[s-1].y);
    raw.push({ x: p.x, y: p.y, tx: g.x/gl, ty: g.y/gl, arc });
  }
  const result = [];
  let next = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].arc >= next || i === 0 || i === raw.length-1) {
      result.push(raw[i]);
      next += step;
    }
  }
  return result;
}

// ── Tangent bypass around a circle ───────────────────────────────────────────

function _segmentClipsCircle(px, py, qx, qy, cx, cy, r) {
  const dx = qx - px, dy = qy - py;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx/len, ny = dy/len;
  const tx = px - cx, ty = py - cy;
  const b  = 2*(tx*nx + ty*ny);
  const c  = tx*tx + ty*ty - r*r;
  const disc = b*b - 4*c;
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / 2;
  const t2 = (-b + sq) / 2;
  return t1 < len && t2 > 0;
}

function _tangentBypass(px, py, qx, qy, cx, cy, r, side) {
  function tangentFrom(ex, ey) {
    const dx = cx - ex, dy = cy - ey;
    const dist = Math.hypot(dx, dy);
    if (dist <= r) return null;
    const angle = Math.atan2(dy, dx);
    const alpha = Math.asin(Math.min(r / dist, 1));
    const a1 = angle + Math.PI/2 - alpha;
    const a2 = angle - Math.PI/2 + alpha;
    return [
      { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1), angle: a1 },
      { x: cx + r * Math.cos(a2), y: cy + r * Math.sin(a2), angle: a2 },
    ];
  }

  const fromTan = tangentFrom(px, py);
  const toTan   = tangentFrom(qx, qy);
  if (!fromTan || !toTan) return null;

  const smx = (px+qx)/2, smy = (py+qy)/2;
  const sdx = qx-px, sdy = qy-py;
  const sLen = Math.hypot(sdx, sdy) || 1;
  const perpX = -sdy/sLen, perpY = sdx/sLen;
  const cSide = (cx-smx)*perpX + (cy-smy)*perpY > 0 ? 1 : -1;
  const chosenSide = side * cSide;

  const entry = (fromTan[0].x - cx)*perpX + (fromTan[0].y - cy)*perpY > 0
    ? (chosenSide > 0 ? fromTan[0] : fromTan[1])
    : (chosenSide > 0 ? fromTan[1] : fromTan[0]);

  const exit = (toTan[0].x - cx)*perpX + (toTan[0].y - cy)*perpY > 0
    ? (chosenSide > 0 ? toTan[0] : toTan[1])
    : (chosenSide > 0 ? toTan[1] : toTan[0]);

  let arcSpan = exit.angle - entry.angle;
  if (chosenSide > 0 && arcSpan < 0) arcSpan += Math.PI * 2;
  if (chosenSide < 0 && arcSpan > 0) arcSpan -= Math.PI * 2;

  const ARC_PTS = 12;
  const arcPts = [];
  for (let k = 0; k <= ARC_PTS; k++) {
    const a = entry.angle + arcSpan * (k / ARC_PTS);
    arcPts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }

  return { entry, arcPts, exit };
}

// ── MST + extra edges ─────────────────────────────────────────────────────────

function _euclideanMST(nodes) {
  if (nodes.length < 2) return [];
  const inMST = new Set([0]), edges = [];
  while (inMST.size < nodes.length) {
    let best = Infinity, bi = -1, bj = -1;
    for (const i of inMST) {
      for (let j = 0; j < nodes.length; j++) {
        if (inMST.has(j)) continue;
        const d = (nodes[i].x-nodes[j].x)**2 + (nodes[i].y-nodes[j].y)**2;
        if (d < best) { best = d; bi = i; bj = j; }
      }
    }
    if (bi < 0) break;
    edges.push({ i: bi, j: bj });
    inMST.add(bj);
  }
  return edges;
}

function _extraEdges(nodes, mstEdges, rand) {
  const mstSet = new Set(mstEdges.map(e => `${Math.min(e.i,e.j)}:${Math.max(e.i,e.j)}`));
  const extras = [];
  for (let i = 0; i < nodes.length; i++) {
    const cands = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const key = `${Math.min(i,j)}:${Math.max(i,j)}`;
      if (mstSet.has(key) || extras.some(e => (e.i===i&&e.j===j)||(e.i===j&&e.j===i))) continue;
      cands.push({ j, d: (nodes[i].x-nodes[j].x)**2+(nodes[i].y-nodes[j].y)**2 });
    }
    cands.sort((a,b) => a.d-b.d);
    if (cands.length && rand() < 0.35) extras.push({ i, j: cands[0].j });
  }
  return extras;
}

// ── Nav helpers ───────────────────────────────────────────────────────────────

let _wpIdx = 0;

function _addNode(id, x, y, gNodes, adj) {
  if (!gNodes.has(id)) { gNodes.set(id, { id, x, y }); adj.set(id, []); }
}

function _link(a, b, adj) {
  const la = adj.get(a), lb = adj.get(b);
  if (la && !la.includes(b)) la.push(b);
  if (lb && !lb.includes(a)) lb.push(a);
}

// Build a nav chain for all samples including endpoints.
// Returns the ids of the first and last nodes in the chain so callers can
// link them to plaza ring nodes or other external nodes.
function _navChain(samples, gNodes, adj) {
  const ids = [];
  for (let i = 0; i < samples.length; i++) {
    const id = `wp${_wpIdx++}`;
    _addNode(id, samples[i].x, samples[i].y, gNodes, adj);
    if (i > 0) _link(ids[i-1], id, adj);
    ids.push(id);
  }
  return ids; // [firstId, ..., lastId]
}

function _rekeyNode(oldId, newId, gNodes, adj) {
  const node = gNodes.get(oldId);
  if (!node) return;
  node.id = newId;
  gNodes.delete(oldId);
  gNodes.set(newId, node);
  const neighbours = adj.get(oldId) ?? [];
  adj.delete(oldId);
  adj.set(newId, neighbours);
  for (const nb of neighbours) {
    const nbList = adj.get(nb);
    if (!nbList) continue;
    const idx = nbList.indexOf(oldId);
    if (idx >= 0) nbList[idx] = newId;
  }
}

function _removeNode(id, gNodes, adj) {
  const neighbours = adj.get(id) ?? [];
  adj.delete(id);
  gNodes.delete(id);
  for (const nb of neighbours) {
    const nbList = adj.get(nb);
    if (!nbList) continue;
    const idx = nbList.indexOf(id);
    if (idx >= 0) nbList.splice(idx, 1);
  }
}

function _closestRingNode(ring, inDx, inDy) {
  if (!ring?.length) return null;
  const angle = Math.atan2(inDy, inDx);
  let best = null, bestDiff = Infinity;
  for (const { nodeId, angle: a } of ring) {
    let diff = Math.abs(a - angle);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = nodeId; }
  }
  return best;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildPathNetwork(projectNodes, rand) {
  _wpIdx = 0;

  const gNodes = new Map(), adj = new Map();
  const meshes = [], pathSegments = [];
  const mat = _mat();

  const mst      = _euclideanMST(projectNodes);
  const extras   = _extraEdges(projectNodes, mst, rand);
  const allEdges = [...mst, ...extras];

  // Degree per landmark
  const degree = new Map(projectNodes.map(p => [p.id, 0]));
  for (const { i, j } of allEdges) {
    degree.set(projectNodes[i].id, (degree.get(projectNodes[i].id)||0) + 1);
    degree.set(projectNodes[j].id, (degree.get(projectNodes[j].id)||0) + 1);
  }

  // Plaza radius (0 = no plaza)
  const plazaR = new Map();
  for (const p of projectNodes) {
    const deg = degree.get(p.id) ?? 0;
    plazaR.set(p.id, deg >= PLAZA_MIN_DEGREE
      ? PLAZA_RADIUS_BASE + (deg - PLAZA_MIN_DEGREE) * PLAZA_RADIUS_SCALE
      : 0);
  }

  // Per-landmark bypass side (+1/-1) — seeded so it's deterministic
  const bypassSide = new Map();
  for (const p of projectNodes) bypassSide.set(p.id, rand() < 0.5 ? 1 : -1);

  // Plaza disc meshes + ring nav nodes (no center node — agents walk the ring,
  // never cut through the middle where the attraction sits)
  const plazaRing = new Map(); // id → [{ nodeId, angle }]
  for (const p of projectNodes) {
    const r = plazaR.get(p.id);
    if (!r) continue;
    meshes.push(Object.assign(new THREE.Mesh(_discGeo(p.x, p.y, r), mat), { receiveShadow: true }));
    const NAV_RING = 24; // dense ring = smooth arc movement
    const RING_R   = r * 0.45; // close to the attraction, not at the plaza edge
    const ring = [];
    for (let k = 0; k < NAV_RING; k++) {
      // Small angular jitter so nodes aren't a perfect polygon
      const baseAngle = (k / NAV_RING) * Math.PI * 2;
      const jitter    = (rand() - 0.5) * (Math.PI * 2 / NAV_RING) * 0.4;
      const angle     = baseAngle + jitter;
      // Small radial jitter too
      const radJitter = 1 + (rand() - 0.5) * 0.15;
      const id        = `pz${_wpIdx++}`;
      _addNode(id, p.x + Math.cos(angle)*RING_R*radJitter, p.y + Math.sin(angle)*RING_R*radJitter, gNodes, adj);
      ring.push({ nodeId: id, angle: baseAngle });
    }
    for (let k = 0; k < ring.length; k++) _link(ring[k].nodeId, ring[(k+1)%ring.length].nodeId, adj);
    plazaRing.set(p.id, ring);
  }

  // Non-plaza center nodes — temporary anchors, re-keyed in post-process
  for (const p of projectNodes) {
    if (!plazaR.get(p.id)) _addNode(p.id, p.x, p.y, gNodes, adj);
  }

  // Small junction discs at transit nodes to cover the V where ribbons meet
  for (const p of projectNodes) {
    if (plazaR.get(p.id) > 0) continue;
    const deg = degree.get(p.id) ?? 0;
    if (deg >= 2) {
      meshes.push(Object.assign(
        new THREE.Mesh(_discGeo(p.x, p.y, PATH_WIDTH * 0.5), mat),
        { receiveShadow: true }
      ));
    }
  }

  // ── Per-edge: compute control points then sample ribbon ───────────────────

  // Track which waypoint chain endpoints are linked to each landmark center,
  // so post-processing can re-key them correctly.
  // chainEnds: Map<projId, Set<wpId>> — all chain endpoint wp ids touching that landmark
  const chainEnds = new Map(projectNodes.map(p => [p.id, new Set()]));

  // For transit landmarks, record the bypass mid-arc point (world coords) so
  // post-processing can find the nav node closest to it — that node is on the
  // ribbon beside the landmark, not at its center.
  // transitBypassPt: Map<projId, {x,y}>
  const transitBypassPt = new Map();

  for (const { i, j } of allEdges) {
    const A = projectNodes[i], B = projectNodes[j];
    if (!A || !B) continue;

    const rA   = plazaR.get(A.id);
    const rB   = plazaR.get(B.id);
    const degA = degree.get(A.id) ?? 0;
    const degB = degree.get(B.id) ?? 0;

    const dx0 = B.x-A.x, dy0 = B.y-A.y, d0 = Math.hypot(dx0,dy0)||1;

    // Transit = degree ≥ 2, non-plaza → ribbon bypasses the landmark
    const isTransitA = rA === 0 && degA >= 2;
    const isTransitB = rB === 0 && degB >= 2;

    // Ribbon start/end:
    //   plaza   → on plaza edge (ribbon overlaps disc)
    //   leaf    → at exclusion radius (ribbon terminates near landmark)
    //   transit → at center (bypass handles avoidance)
    const startR = rA > 0 ? rA * 0.85 : (isTransitA ? 0 : EXCLUSION_RADIUS);
    const endR   = rB > 0 ? rB * 0.85 : (isTransitB ? 0 : EXCLUSION_RADIUS);
    const totalR = startR + endR;
    const clampF = totalR > 0 && d0 < totalR ? d0 / totalR : 1;
    const pStart = { x: A.x + (dx0/d0)*startR*clampF, y: A.y + (dy0/d0)*startR*clampF };
    const pEnd   = { x: B.x - (dx0/d0)*endR*clampF,   y: B.y - (dy0/d0)*endR*clampF   };

    // Collect obstacles: intermediate non-plaza nodes whose circle the line clips.
    // Transit endpoints are excluded — their bypass is handled differently below.
    const obstacles = [];
    for (const C of projectNodes) {
      if (plazaR.get(C.id) > 0) continue;
      if (C.id === A.id || C.id === B.id) continue;
      if (_segmentClipsCircle(pStart.x, pStart.y, pEnd.x, pEnd.y, C.x, C.y, EXCLUSION_RADIUS)) {
        const dx = C.x - pStart.x, dy = C.y - pStart.y;
        obstacles.push({ node: C, along: dx*(pEnd.x-pStart.x)+dy*(pEnd.y-pStart.y) });
      }
    }
    obstacles.sort((a,b) => a.along - b.along);

    // Build control points
    const ctrlPts = [pStart];
    let cur = pStart;
    for (const { node: C } of obstacles) {
      const bypass = _tangentBypass(cur.x, cur.y, pEnd.x, pEnd.y, C.x, C.y, EXCLUSION_RADIUS, bypassSide.get(C.id));
      if (!bypass) continue;
      ctrlPts.push(bypass.entry, ...bypass.arcPts, bypass.exit);
      cur = bypass.exit;
      // Record the mid-arc point for this transit landmark (first encounter wins)
      if (!transitBypassPt.has(C.id)) {
        const mid = bypass.arcPts[Math.floor(bypass.arcPts.length / 2)];
        transitBypassPt.set(C.id, { x: mid.x, y: mid.y });
      }
    }
    ctrlPts.push(pEnd);

    // Add a mid-path jitter point for every long straight segment to increase curviness
    const enriched = [ctrlPts[0]];
    for (let k = 1; k < ctrlPts.length; k++) {
      const prev = ctrlPts[k-1], next = ctrlPts[k];
      const ex = next.x - prev.x, ey = next.y - prev.y;
      const el = Math.hypot(ex, ey) || 1;
      if (el > 40) {
        // Insert a jittered midpoint
        const mx = (prev.x + next.x) / 2;
        const my = (prev.y + next.y) / 2;
        const px = -ey/el, py = ex/el;
        const jitter = (rand()-0.5) * el * CURVE_JITTER;
        enriched.push({ x: mx + px*jitter, y: my + py*jitter });
      }
      enriched.push(next);
    }

    // Jitter all interior control points
    for (let k = 1; k < enriched.length - 1; k++) {
      const prev = enriched[k-1], next = enriched[k+1];
      const ex = next.x - prev.x, ey = next.y - prev.y;
      const el = Math.hypot(ex, ey) || 1;
      const px = -ey/el, py = ex/el;
      const jitter = (rand()-0.5) * 2 * el * CURVE_JITTER;
      enriched[k] = { x: enriched[k].x + px*jitter, y: enriched[k].y + py*jitter };
    }

    const samples = _sampleSpline(enriched, NAV_SAMPLE_STEP);
    if (!samples.length || samples[samples.length-1].arc < MIN_RIBBON_LEN) continue;

    meshes.push(Object.assign(new THREE.Mesh(_ribbonGeo(samples, PATH_WIDTH), mat), { receiveShadow: true }));
    pathSegments.push({ pts: samples });

    // Build full nav chain — every sample gets its own node (including endpoints)
    const chainIds = _navChain(samples, gNodes, adj);
    const firstId = chainIds[0];
    const lastId  = chainIds[chainIds.length - 1];

    // Connect chain to plaza ring nodes or non-plaza center anchors.
    // For plazas: discard the endpoint waypoint (it's inside the disc) and
    // link the ring node directly to the first/last INTERIOR waypoint instead.
    // This prevents nav nodes inside the plaza from creating cross-plaza shortcuts.
    if (rA > 0) {
      const ringId = _closestRingNode(plazaRing.get(A.id), dx0/d0, dy0/d0) ?? A.id;
      _removeNode(firstId, gNodes, adj);
      const innerFirst = chainIds[1] ?? lastId;
      _link(ringId, innerFirst, adj);
    } else {
      _link(firstId, A.id, adj);
      chainEnds.get(A.id)?.add(firstId);
    }
    if (rB > 0) {
      const ringId = _closestRingNode(plazaRing.get(B.id), -dx0/d0, -dy0/d0) ?? B.id;
      _removeNode(lastId, gNodes, adj);
      const innerLast = chainIds[chainIds.length - 2] ?? firstId;
      _link(ringId, innerLast, adj);
    } else {
      _link(lastId, B.id, adj);
      chainEnds.get(B.id)?.add(lastId);
    }
  }

  // ── Post-process: assign proj.id to the best on-ring/on-path node ───────

  // For plazas: proj.id → the ring node closest to the attraction's display
  // position (offset from center), so walkToProject stops beside the attraction
  // on the ring rather than at the invisible center.
  for (const proj of projectNodes) {
    const r = plazaR.get(proj.id);
    if (!r) continue;
    const ring = plazaRing.get(proj.id);
    if (!ring?.length) continue;
    // Direction from center toward display position (attraction is offset this way)
    const dx = (proj.displayX ?? proj.x) - proj.x;
    const dy = (proj.displayY ?? proj.y) - proj.y;
    const angle = Math.atan2(dy, dx);
    // Pick the ring node whose angle is closest to that direction
    let bestId = ring[0].nodeId, bestDiff = Infinity;
    for (const { nodeId, angle: a } of ring) {
      let diff = Math.abs(a - angle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < bestDiff) { bestDiff = diff; bestId = nodeId; }
    }
    _rekeyNode(bestId, proj.id, gNodes, adj);
  }

  // For non-plaza landmarks: center node → closest chain endpoint
  const claimedEndpoints = new Set();
  // Mark plaza ring nodes as claimed so non-plazas can't steal them
  for (const ring of plazaRing.values()) {
    for (const { nodeId } of ring) claimedEndpoints.add(nodeId);
  }
  // Also mark the re-keyed proj.id nodes (now on the ring)
  for (const proj of projectNodes) {
    if (plazaR.get(proj.id) > 0) claimedEndpoints.add(proj.id);
  }

  for (const proj of projectNodes) {
    if (plazaR.get(proj.id) > 0) continue;

    const deg = degree.get(proj.id) ?? 0;
    const isTransit = deg >= 2;

    // For transit nodes: find the nav node nearest the bypass arc mid-point.
    // That node sits on the ribbon beside the landmark, not at its center.
    if (isTransit && transitBypassPt.has(proj.id)) {
      const bp = transitBypassPt.get(proj.id);
      let bestId = null, bestDist = Infinity;
      for (const [id, node] of gNodes) {
        if (id === proj.id || claimedEndpoints.has(id)) continue;
        const d = (node.x - bp.x)**2 + (node.y - bp.y)**2;
        if (d < bestDist) { bestDist = d; bestId = id; }
      }
      if (!bestId) continue;
      claimedEndpoints.add(bestId);
      _removeNode(proj.id, gNodes, adj);
      _rekeyNode(bestId, proj.id, gNodes, adj);
      continue;
    }

    const candidates = [...(chainEnds.get(proj.id) ?? [])].filter(id => !claimedEndpoints.has(id));

    if (candidates.length === 0) {
      // No chain endpoints registered — fall back to nearest waypoint across all segments
      let bestDist = Infinity, bestId = null;
      for (const seg of pathSegments) {
        for (const pt of seg.pts) {
          const d = (pt.x - proj.x)**2 + (pt.y - proj.y)**2;
          if (d < bestDist) {
            for (const [id, node] of gNodes) {
              if (id === proj.id) continue;
              const nd = (node.x - pt.x)**2 + (node.y - pt.y)**2;
              if (nd < 1 && !claimedEndpoints.has(id)) { bestDist = d; bestId = id; }
            }
          }
        }
      }
      if (!bestId) continue;
      claimedEndpoints.add(bestId);
      _removeNode(proj.id, gNodes, adj);
      _rekeyNode(bestId, proj.id, gNodes, adj);
      continue;
    }

    // Leaf: pick the candidate closest to the landmark's original layout position
    let bestId = candidates[0], bestDist = Infinity;
    for (const id of candidates) {
      const node = gNodes.get(id);
      if (!node) continue;
      const d = (node.x - proj.x)**2 + (node.y - proj.y)**2;
      if (d < bestDist) { bestDist = d; bestId = id; }
    }

    claimedEndpoints.add(bestId);
    _removeNode(proj.id, gNodes, adj);
    _rekeyNode(bestId, proj.id, gNodes, adj);
  }

  // Non-plaza attractions display at proj.x/y — the original layout position
  // which all bypass logic already routes around via EXCLUSION_RADIUS.
  // No offset needed: the path never enters the exclusion zone around proj.x/y.

  return {
    pathMeshes:   meshes,
    pathGraph:    { nodes: [...gNodes.values()], adjacency: adj, nodeMap: gNodes },
    pathSegments,
    landmarkDegree: degree,
  };
}
