/**
 * Hard collision for agents: they don't walk through landmarks or through each other.
 *
 * Landmarks are circles (a share of the model's bounding radius, so the corners of the
 * bounding box stay walkable). Agents are pushed out of them and out of each other every frame
 * before the render sync; routes are adjusted so no waypoint or goal sits inside a landmark.
 */

import { LANDMARK_BLOCK_SCALE, AGENT_RADIUS } from '@/config.js';
import { forSolidsNear, registerCircle } from '@/world/obstacleRegistry.js';
import { getTerrainHeight } from '@/world/terrain.js';
import { WATER_Y } from '@/world/lake.js';

const SOLID_BODY = 0.6; // share of AGENT_RADIUS used against trunks and posts (a person can pass close to a thin trunk)

const _landmarks = []; // { x, z, r }

export function setLandmarks(attractions) {
  _landmarks.length = 0;
  for (const a of attractions) {
    const r = a.footprintRadius * LANDMARK_BLOCK_SCALE;
    _landmarks.push({ x: a.displayU, z: a.displayV, r });
    // Also an obstacle for the spot pickers (`isOccupied` / `isWalkClear`): nobody is asked to sit, rest or stand and
    // chat inside a landmark, or to walk through one to get there. (Placement of trees etc. is already done by now.)
    registerCircle(a.displayU, a.displayV, r);
  }
}

/** If (u, v) lies inside a landmark, returns the nearest point just outside it (towards `fromU/fromV`
 *  when given, so a goal stays on the side the agent comes from). Otherwise returns the point as is. */
export function outsideLandmarks(u, v, fromU = null, fromV = null) {
  for (const l of _landmarks) {
    const reach = l.r + AGENT_RADIUS + 0.5;
    if (Math.hypot(u - l.x, v - l.z) >= reach) continue;
    let dx = (fromU ?? u) - l.x, dz = (fromV ?? v) - l.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) { dx = 1; dz = 0; d = 1; }
    return { u: l.x + (dx / d) * reach, v: l.z + (dz / d) * reach };
  }
  return { u, v };
}

/** Pushes the agent out of any landmark it is inside. */
function pushOutOfLandmarks(agent) {
  const p = agent.position;
  for (const l of _landmarks) {
    const reach = l.r + AGENT_RADIUS;
    let dx = p.x - l.x, dz = p.z - l.z;
    const d = Math.hypot(dx, dz);
    if (d >= reach) continue;
    if (d < 1e-3) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
    p.x = l.x + dx * reach;
    p.z = l.z + dz * reach;
  }
}

/** Pushes the agent out of trunks, lamp posts, benches, rocks and bushes (world/obstacleRegistry.js `registerSolid`). */
function pushOutOfSolids(agent) {
  const p = agent.position, body = AGENT_RADIUS * SOLID_BODY;
  forSolidsNear(p.x, p.z, s => {
    const reach = s.r + body;
    let dx = p.x - s.x, dz = p.z - s.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= reach * reach) return;
    const d = Math.sqrt(d2);
    if (d < 1e-3) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
    p.x = s.x + dx * reach;
    p.z = s.z + dz * reach;
  });
}

const _lastDry = new WeakMap(); // agent → { x, z }: where it last stood on dry land

/** The lake is not for walking in: an agent that steps into water goes back to its last dry spot. */
function keepOutOfWater(agent) {
  const p = agent.position;
  if (getTerrainHeight(p.x, p.z) < WATER_Y - 0.1) {
    const last = _lastDry.get(agent);
    if (last) { p.x = last.x; p.z = last.z; }
  } else {
    let last = _lastDry.get(agent);
    if (!last) _lastDry.set(agent, last = { x: 0, z: 0 });
    last.x = p.x; last.z = p.z;
  }
}

/** True for an agent that must not be shoved (standing on purpose, seated, or held by the UI). */
function isFixed(a) {
  return a.stopped || a.holdsPosition;
}

/** Separates overlapping agents; an agent that is standing still is not moved, the other gives way. */
function separateAgents(agents) {
  const min = AGENT_RADIUS * 2;
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    for (let j = i + 1; j < agents.length; j++) {
      const b = agents[j];
      let dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
      const d = Math.hypot(dx, dz);
      if (d >= min) continue;
      if (d < 1e-3) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n; }
      else { dx /= d; dz /= d; }
      const push = min - d;
      const fa = isFixed(a), fb = isFixed(b);
      if (fa && fb) continue;
      const wa = fa ? 0 : fb ? 1 : 0.5;
      const wb = 1 - wa;
      a.position.x -= dx * push * wa; a.position.z -= dz * push * wa;
      b.position.x += dx * push * wb; b.position.z += dz * push * wb;
    }
  }
}

export function resolveCollisions(agents) {
  separateAgents(agents);
  for (const a of agents) {
    if (a.stopped) continue;
    pushOutOfLandmarks(a);
    pushOutOfSolids(a);
    keepOutOfWater(a);
  }
}
