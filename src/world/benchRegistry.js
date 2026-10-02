/**
 * Bench seat reservation registry.
 *
 * Separate from obstacleRegistry.js — that module tracks static collision
 * occupancy (what can't be placed where); this tracks a claim/release
 * lifecycle (which bench is occupied by whom) for SittingOnBenchState.
 */

import { isWalkClear } from './obstacleRegistry.js';

let _benches = [];

/** Register a bench at (x, z) facing `facingAngle`, called alongside addBench(). */
export function registerBench(x, z, facingAngle) {
  _benches.push({
    id: `bench-${_benches.length}`,
    x, z, facingAngle,
    claimedBy: null, // agent id while occupied (one person per bench)
  });
}

// A bench is registered as an obstacle of this radius (environment.js BENCH_FOOTPRINT);
// the walk up to it is allowed to enter that circle.
const BENCH_APPROACH_SLACK = 3.4;

/**
 * Find and claim the nearest unoccupied bench to (x, z), within maxDist, that can be
 * reached by walking straight to it (nothing in the way). Benches are tried nearest first.
 * Returns { benchId, x, z, facingAngle } or null if none free nearby.
 */
export function claimNearestSeat(agentId, x, z, maxDist = 60) {
  const candidates = _benches
    .filter(b => b.claimedBy === null)
    .map(b => ({ b, d: Math.hypot(b.x - x, b.z - z) }))
    .filter(c => c.d <= maxDist)
    .sort((p, q) => p.d - q.d);

  for (const { b } of candidates) {
    if (!isWalkClear(x, z, b.x, b.z, 0.8, BENCH_APPROACH_SLACK)) continue;
    b.claimedBy = agentId;
    return { benchId: b.id, x: b.x, z: b.z, facingAngle: b.facingAngle };
  }
  return null;
}

export function releaseSeat(benchId) {
  const bench = _benches.find(b => b.id === benchId);
  if (bench) bench.claimedBy = null;
}

export function clear() {
  _benches = [];
}
