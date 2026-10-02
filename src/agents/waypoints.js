/**
 * Waypoint-chain construction over the rendered path ribbon network.
 *
 * Two entry points:
 *   - buildStrollWaypoints: junction-aware random stroll (idle wandering)
 *   - buildRouteWaypoints:  directed walk toward a specific attraction,
 *     using Dijkstra over the sparse nav graph then expanding each hop
 *     into fine waypoints along the corresponding rendered path segment.
 */

import { dijkstraPath } from './pathfinding.js';

// How many path segments to stitch together per stroll (controls walk length).
// Kept short so agents re-roll their next behaviour (chat/rest/keep-walking)
// every few seconds rather than committing to one long march — 3 stitched
// segments produced 150+ waypoints (60-90s of continuous walking), which
// made idle/chat states unreachable in practice.
const WALK_SEGMENTS = 1;

/**
 * Build a waypoint chain by strolling along path ribbons.
 *
 * Starting from the closest point on any segment, walk forward along that
 * segment, then at the end randomly pick a connected segment to continue
 * onto (junction-aware strolling). Repeats for WALK_SEGMENTS hops.
 *
 * @param {{u,v}}         pos
 * @param {PathSegment[]} pathSegments  — [{edgeFromId, edgeToId, pts:[{u,v,tu,tv,arc}]}]
 * @param {function}      rand
 * @param {string|null}   avoidEndId    — node id to avoid as first segment's end (last-visited)
 * @returns {{u,v}[]}
 */
export function buildStrollWaypoints(pos, pathSegments, rand, avoidEndId) {
  if (!pathSegments || pathSegments.length === 0) return [];

  // ── Step 1: find closest segment and injection index ──────────────────────
  let bestSeg = null, bestIdx = 0, bestDist = Infinity;
  for (const seg of pathSegments) {
    for (let i = 0; i < seg.pts.length; i++) {
      const d = Math.hypot(seg.pts[i].u - pos.u, seg.pts[i].v - pos.v);
      if (d < bestDist) { bestDist = d; bestSeg = seg; bestIdx = i; }
    }
  }
  if (!bestSeg) return [];

  // ── Step 2: build adjacency — which segments share an endpoint ────────────
  const nodeSegs = new Map();
  for (const seg of pathSegments) {
    for (const nodeId of [seg.edgeFromId, seg.edgeToId]) {
      if (!nodeSegs.has(nodeId)) nodeSegs.set(nodeId, []);
      nodeSegs.get(nodeId).push(seg);
    }
  }

  // ── Step 3: stroll forward through WALK_SEGMENTS hops ────────────────────
  const waypoints = [];
  let curSeg = bestSeg;
  let startIdx = bestIdx;
  let forward = true;

  if (avoidEndId && bestIdx < bestSeg.pts.length * 0.2) {
    forward = bestSeg.edgeFromId === avoidEndId ? true : (rand() < 0.5);
  } else if (avoidEndId && bestIdx > bestSeg.pts.length * 0.8) {
    forward = bestSeg.edgeToId === avoidEndId ? false : (rand() < 0.5);
  } else {
    forward = rand() < 0.5;
  }

  for (let hop = 0; hop < WALK_SEGMENTS; hop++) {
    const pts = curSeg.pts;
    if (forward) {
      for (let i = startIdx + (waypoints.length === 0 ? 0 : 1); i < pts.length; i++) {
        waypoints.push({ u: pts[i].u, v: pts[i].v });
      }
    } else {
      for (let i = startIdx - (waypoints.length === 0 ? 0 : 1); i >= 0; i--) {
        waypoints.push({ u: pts[i].u, v: pts[i].v });
      }
    }

    const endNodeId = forward ? curSeg.edgeToId : curSeg.edgeFromId;
    const candidates = (nodeSegs.get(endNodeId) ?? []).filter(s => s !== curSeg);
    if (candidates.length === 0) {
      forward = !forward;
      startIdx = forward ? 0 : pts.length - 1;
      break;
    }

    const nextSeg = candidates[Math.floor(rand() * candidates.length)];
    const nextForward = nextSeg.edgeFromId === endNodeId;
    startIdx = nextForward ? 0 : nextSeg.pts.length - 1;
    curSeg   = nextSeg;
    forward  = nextForward;
  }

  return waypoints;
}

const ARC_STEP = 6; // world units between waypoints on a plaza rim

/**
 * Waypoints along the shorter arc around `node` from `from` to `to` (both on its plaza rim),
 * excluding the end points. Empty when they are already close together.
 */
function arcAroundNode(node, from, to) {
  if (!node || !from) return [];
  const cu = node.u ?? node.x ?? 0, cv = node.v ?? node.y ?? 0;
  const r0 = Math.hypot(from.u - cu, from.v - cv), r1 = Math.hypot(to.u - cu, to.v - cv);
  if (Math.hypot(to.u - from.u, to.v - from.v) < ARC_STEP * 1.5 || r0 < 1 || r1 < 1) return [];
  const a0 = Math.atan2(from.v - cv, from.u - cu);
  let delta = Math.atan2(to.v - cv, to.u - cu) - a0;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // shorter way round
  const steps = Math.ceil(Math.abs(delta) * Math.max(r0, r1) / ARC_STEP);
  const pts = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps, a = a0 + delta * t, r = r0 + (r1 - r0) * t;
    pts.push({ u: cu + Math.cos(a) * r, v: cv + Math.sin(a) * r });
  }
  return pts;
}

/**
 * Build a directed waypoint chain from the agent's current position to a
 * target attraction, following the path network rather than a straight line.
 *
 * The agent joins the network at the nearest *path point* (not the nearest node, which
 * may lie behind it or across the grass), walks to whichever end of that segment gives
 * the shorter total trip, then routes over the sparse nav graph (Dijkstra) to the
 * attraction's navNodeId, expanding each graph hop into fine waypoints along the rendered
 * path segment.
 *
 * @param {{u,v}}         pos
 * @param {AttractionInstance} attraction
 * @param {NavGraph}      navGraph
 * @param {PathSegment[]} pathSegments
 * @returns {{u,v}[]}
 */
export function buildRouteWaypoints(pos, attraction, navGraph, pathSegments) {
  const { adjacency, nodeMap } = navGraph;
  const straight = [{ u: pos.u, v: pos.v }, { u: attraction.displayU, v: attraction.displayV }];

  // Nearest point on the path network.
  let seg0 = null, idx0 = 0, bestDist = Infinity;
  for (const seg of pathSegments) {
    for (let i = 0; i < seg.pts.length; i++) {
      const d = (seg.pts[i].u - pos.u) ** 2 + (seg.pts[i].v - pos.v) ** 2;
      if (d < bestDist) { bestDist = d; seg0 = seg; idx0 = i; }
    }
  }
  if (!seg0) return straight;

  const goalId = attraction.navNodeId;
  const hopLength = (a, b) => {
    const na = nodeMap.get(a), nb = nodeMap.get(b);
    return na && nb ? Math.hypot((nb.u ?? nb.x ?? 0) - (na.u ?? na.x ?? 0), (nb.v ?? nb.y ?? 0) - (na.v ?? na.y ?? 0)) : 1;
  };
  const arcLength = pts => {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].u - pts[i - 1].u, pts[i].v - pts[i - 1].v);
    return L;
  };

  // Leave the segment through either end: the part of the segment still to walk, the node
  // reached, and the graph route on from there. Take the cheapest.
  const exits = [
    { tail: seg0.pts.slice(idx0),                 nodeId: seg0.edgeToId },
    { tail: seg0.pts.slice(0, idx0 + 1).reverse(), nodeId: seg0.edgeFromId },
  ];
  let best = null;
  for (const e of exits) {
    const route = dijkstraPath(adjacency, e.nodeId, goalId, nodeMap);
    if (route.length === 0) continue;
    let cost = arcLength(e.tail);
    for (let i = 0; i < route.length - 1; i++) cost += hopLength(route[i], route[i + 1]);
    if (!best || cost < best.cost) best = { cost, tail: e.tail, route };
  }
  if (!best) return straight;

  // Index segments by the node-pair they connect, either direction.
  const segByPair = new Map();
  for (const seg of pathSegments) {
    segByPair.set(`${seg.edgeFromId}|${seg.edgeToId}`, seg);
    segByPair.set(`${seg.edgeToId}|${seg.edgeFromId}`, seg);
  }

  const waypoints = best.tail.map(pt => ({ u: pt.u, v: pt.v }));
  const nodeIds = best.route;
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const a = nodeIds[i], b = nodeIds[i + 1];
    const seg = segByPair.get(`${a}|${b}`);
    if (!seg) continue;
    const forward = seg.edgeFromId === a;
    const pts = forward ? seg.pts : [...seg.pts].reverse();
    // Segments end at the rim of the node's plaza: go round the rim to the next one instead of
    // cutting across the plaza (and through its landmark).
    waypoints.push(...arcAroundNode(nodeMap.get(a), waypoints[waypoints.length - 1], pts[0]));
    for (const pt of pts) waypoints.push({ u: pt.u, v: pt.v });
  }

  // Final approach to the attraction's actual display position.
  waypoints.push({ u: attraction.displayU, v: attraction.displayV });

  // Always start from where the agent actually is. Without this, an agent whose
  // nearest nav node is already the goal gets a one-waypoint route, which counts
  // as finished immediately — it would "arrive" without walking anywhere.
  waypoints.unshift({ u: pos.u, v: pos.v });

  return waypoints;
}
