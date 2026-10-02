/**
 * Grass spots for agents that sit on the ground or rest — always on open grass
 * close to a path, never on the path itself, in the lake, or inside an obstacle.
 *
 * Spots are claimed so two agents don't pick the same patch; release on exit.
 */

import { isOccupied } from '@/world/obstacleRegistry.js';
import {
  GRASS_SEARCH_RADIUS, GRASS_EDGE_MIN, GRASS_EDGE_MAX, GRASS_SPOT_SPACING,
} from '@/config.js';

const MAX_TRIES = 40;
const PROBE_STEP = 1.5;
const PROBE_MAX  = 40;

const _claims = new Map(); // agentId -> { x, z }

function _tooClose(x, z) {
  for (const c of _claims.values()) {
    if (Math.hypot(c.x - x, c.z - z) < GRASS_SPOT_SPACING) return true;
  }
  return false;
}

/**
 * Find and claim a grass spot beside a path near `pos`.
 *
 * @param {string}        agentId
 * @param {{x,z}}         pos            agent position (world x/z)
 * @param {PathSegment[]} pathSegments
 * @param {function}      rand
 * @returns {{ x, z, facing } | null}  facing = angle toward the nearest path (watching it go by)
 */
export function claimGrassSpot(agentId, pos, pathSegments, rand) {
  releaseGrassSpot(agentId);

  // Candidate path samples near the agent.
  const r2 = GRASS_SEARCH_RADIUS * GRASS_SEARCH_RADIUS;
  const near = [];
  for (const seg of pathSegments) {
    for (const pt of seg.pts) {
      if ((pt.u - pos.x) ** 2 + (pt.v - pos.z) ** 2 < r2) near.push(pt);
    }
  }
  if (near.length === 0) return null;

  for (let i = 0; i < MAX_TRIES; i++) {
    const pt   = near[Math.floor(rand() * near.length)];
    const side = rand() < 0.5 ? 1 : -1;
    const nu = -pt.tv * side, nv = pt.tu * side; // unit normal to the path

    // Walk outward from the centreline to the first free cell (the path edge),
    // then step a little further onto the grass.
    let d = PROBE_STEP;
    while (d < PROBE_MAX && isOccupied(pt.u + nu * d, pt.v + nv * d, 0)) d += PROBE_STEP;
    if (d >= PROBE_MAX) continue;
    d += GRASS_EDGE_MIN + rand() * (GRASS_EDGE_MAX - GRASS_EDGE_MIN);

    const x = pt.u + nu * d, z = pt.v + nv * d;
    if (isOccupied(x, z, 1.5) || _tooClose(x, z)) continue;

    _claims.set(agentId, { x, z });
    return { x, z, facing: Math.atan2(pt.u - x, pt.v - z) };
  }
  return null;
}

export function releaseGrassSpot(agentId) {
  _claims.delete(agentId);
}

export function clear() {
  _claims.clear();
}
