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

/**
 * Build a directed waypoint chain from the agent's current position to a
 * target attraction, following the path network rather than a straight line.
 *
 * Routes over the sparse nav graph (Dijkstra) between the nearest nav node
 * to `pos` and the attraction's navNodeId, then expands each graph hop into
 * fine waypoints by walking the corresponding rendered path segment.
 *
 * @param {{u,v}}         pos
 * @param {AttractionInstance} attraction
 * @param {NavGraph}      navGraph
 * @param {PathSegment[]} pathSegments
 * @returns {{u,v}[]}
 */
export function buildRouteWaypoints(pos, attraction, navGraph, pathSegments) {
  const { adjacency, nodeMap } = navGraph;

  let startId = null, bestDist = Infinity;
  for (const node of navGraph.nodes) {
    const d = (node.u - pos.u) ** 2 + (node.v - pos.v) ** 2;
    if (d < bestDist) { bestDist = d; startId = node.id; }
  }
  if (startId == null) return [{ u: pos.u, v: pos.v }, { u: attraction.displayU, v: attraction.displayV }];

  const goalId = attraction.navNodeId;
  const nodeIds = dijkstraPath(adjacency, startId, goalId, nodeMap);
  if (nodeIds.length === 0) return [{ u: pos.u, v: pos.v }, { u: attraction.displayU, v: attraction.displayV }];

  // Index segments by the node-pair they connect, either direction.
  const segByPair = new Map();
  for (const seg of pathSegments) {
    segByPair.set(`${seg.edgeFromId}|${seg.edgeToId}`, seg);
    segByPair.set(`${seg.edgeToId}|${seg.edgeFromId}`, seg);
  }

  const waypoints = [];
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const a = nodeIds[i], b = nodeIds[i + 1];
    const seg = segByPair.get(`${a}|${b}`);
    if (!seg) continue;
    const forward = seg.edgeFromId === a;
    const pts = forward ? seg.pts : [...seg.pts].reverse();
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
