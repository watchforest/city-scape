/**
 * Waypoint-chain construction over the rendered path ribbon network.
 *
 * Two entry points:
 *   - buildStrollWaypoints: a random walk over the network (idle wandering): at every junction the agent picks
 *     one of the paths that meet there, favouring ones it has taken less often
 *   - buildRouteWaypoints:  directed walk toward a specific attraction,
 *     using Dijkstra over the sparse nav graph then expanding each hop
 *     into fine waypoints along the corresponding rendered path segment.
 */

import { dijkstraPath } from './pathfinding.js';

// An agent this close to the end of a segment counts as standing at that segment's node (a plaza rim).
const NODE_RADIUS = 12;
// Weight of the path just walked when choosing the next one at a junction: low, so agents hardly ever turn straight back.
const TURN_BACK_WEIGHT = 0.08;
// Chance that an agent which was interrupted halfway along a path carries on the way it was going.
const KEEP_HEADING = 0.8;

const _nodeSegsCache = new WeakMap();

/** node id → the segments that end at it (cached per segment list). */
function segmentsByNode(pathSegments) {
  let m = _nodeSegsCache.get(pathSegments);
  if (m) return m;
  m = new Map();
  for (const seg of pathSegments) {
    for (const id of [seg.edgeFromId, seg.edgeToId]) {
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(seg);
    }
  }
  _nodeSegsCache.set(pathSegments, m);
  return m;
}

/** Index of a weighted random pick. */
function pickWeighted(weights, rand) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) { if ((r -= weights[i]) < 0) return i; }
  return weights.length - 1;
}

/**
 * Build the next leg of an agent's wandering: a random walk over the path network, one path at a time.
 *
 * - Standing at a node (the rim of a plaza, where paths meet): choose one of the paths that meet there. Paths the
 *   agent has walked less often are likelier (1 / (1 + times walked)²), and the path it just came along is hardly
 *   ever chosen, so it works its way across the whole map instead of pacing up and down one path. The leg goes round
 *   the plaza rim to the start of the chosen path and then all the way along it.
 * - Somewhere along a path (it stopped for a chat, a seat …): carry on the way it was heading, mostly, to the end.
 *
 * @param {{u,v}}         pos
 * @param {PathSegment[]} pathSegments  — [{edgeFromId, edgeToId, pts:[{u,v,tu,tv,arc}]}]
 * @param {function}      rand
 * @param {object}        memory        — the agent's own { lastSeg, heading, visits: Map(seg → times walked) }, updated here
 * @param {Map}           nodeMap       — nav graph nodes by id (their centres, for going round a plaza)
 * @returns {{u,v}[]}
 */
export function buildStrollWaypoints(pos, pathSegments, rand, memory, nodeMap) {
  if (!pathSegments || pathSegments.length === 0) return [];
  memory.visits ??= new Map();
  const visits = seg => memory.visits.get(seg) ?? 0;
  const nodeSegs = segmentsByNode(pathSegments);

  // The path point nearest the agent, and whether it is at either end of its segment.
  let seg0 = null, idx0 = 0, best = Infinity;
  for (const seg of pathSegments) {
    for (let i = 0; i < seg.pts.length; i++) {
      const d = (seg.pts[i].u - pos.u) ** 2 + (seg.pts[i].v - pos.v) ** 2;
      if (d < best) { best = d; seg0 = seg; idx0 = i; }
    }
  }
  if (!seg0) return [];
  const first = seg0.pts[0], last = seg0.pts[seg0.pts.length - 1];
  const dStart = Math.hypot(first.u - pos.u, first.v - pos.v), dEnd = Math.hypot(last.u - pos.u, last.v - pos.v);

  let waypoints, seg, towardId;

  if (Math.min(dStart, dEnd) < NODE_RADIUS) {
    // ── At a node: choose among the paths that meet here ────────────────────────
    const nodeId = dStart <= dEnd ? seg0.edgeFromId : seg0.edgeToId;
    const options = nodeSegs.get(nodeId) ?? [seg0];
    const weights = options.map(s => (1 / (1 + visits(s)) ** 2) * (s === memory.lastSeg ? TURN_BACK_WEIGHT : 1));
    seg = options[pickWeighted(weights, rand)];

    const away = seg.edgeFromId === nodeId;                 // does the path start at this node?
    const pts = away ? seg.pts : [...seg.pts].reverse();
    towardId = away ? seg.edgeToId : seg.edgeFromId;
    waypoints = [...arcAroundNode(nodeMap?.get(nodeId), pos, pts[0]), ...pts.map(p => ({ u: p.u, v: p.v }))];
  } else {
    // ── Somewhere along a path: finish it ───────────────────────────────────────
    seg = seg0;
    let forward;
    if (memory.heading?.seg === seg) forward = rand() < KEEP_HEADING ? memory.heading.toward === seg.edgeToId : memory.heading.toward !== seg.edgeToId;
    else forward = rand() < 0.5;
    towardId = forward ? seg.edgeToId : seg.edgeFromId;
    waypoints = [];
    if (forward) for (let i = idx0; i < seg.pts.length; i++) waypoints.push({ u: seg.pts[i].u, v: seg.pts[i].v });
    else for (let i = idx0; i >= 0; i--) waypoints.push({ u: seg.pts[i].u, v: seg.pts[i].v });
  }

  memory.lastSeg = seg;
  memory.heading = { seg, toward: towardId };
  memory.visits.set(seg, visits(seg) + 1);
  return waypoints;
}

/**
 * Shift a waypoint chain `lane` units to the right of its direction of travel, so that people walking in opposite
 * directions use opposite sides of the path. The shift grows from nothing over the first few waypoints (the agent
 * starts wherever it is) and, for a walk that ends at something (`keepLast`), shrinks away again at the end.
 *
 * @param {{u,v}[]} wps
 * @param {number}  lane      distance to the right of the centre line
 * @param {{ rampIn?: number, keepLast?: boolean }} [opts]
 */
export function offsetToRight(wps, lane, { rampIn = 4, keepLast = false } = {}) {
  const n = wps.length;
  if (n < 2) return wps;
  return wps.map((p, i) => {
    const a = wps[Math.max(0, i - 1)], b = wps[Math.min(n - 1, i + 1)];
    let du = b.u - a.u, dv = b.v - a.v;
    const len = Math.hypot(du, dv);
    if (len < 1e-6) return p;
    du /= len; dv /= len;
    let k = Math.min(1, (i + 1) / rampIn);
    if (keepLast) k = Math.min(k, (n - 1 - i) / rampIn);           // fade out towards the goal
    return { u: p.u - dv * lane * k, v: p.v + du * lane * k };       // right of (du, dv) is (−dv, du)
  });
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
