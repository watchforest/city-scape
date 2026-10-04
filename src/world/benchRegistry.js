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
export function registerBench(x, z, facingAngle, seatTop = 1.7, standOff = 0) {
  _benches.push({
    id: `bench-${_benches.length}`,
    x, z, facingAngle,
    seatTop, // height of the seat above the ground; the seated figure is lifted to match
    // A bench with a solid seat can't be walked into: the agent stops this far in front of its centre,
    // and the sit-down animation then moves it back onto the seat. 0 = sit where the bench is.
    standOff,
    claimedBy: null, // agent id while occupied (one person per bench)
  });
}

// A bench is registered as an obstacle of this radius (environment.js BENCH_FOOTPRINT);
// the walk up to it is allowed to enter that circle.
const BENCH_APPROACH_SLACK = 3.4;

/**
 * Find and claim the nearest unoccupied bench to (x, z), within maxDist, that can be
 * reached by walking straight to it (nothing in the way). Benches are tried nearest first.
 * Returns { benchId, x, z, facingAngle, seatTop, standOff } or null if none free nearby; (x, z) is where
 * to stand (in front of the seat when standOff > 0).
 */
export function claimNearestSeat(agentId, x, z, maxDist = 60) {
  const candidates = _benches
    .filter(b => b.claimedBy === null)
    .map(b => ({ b, d: Math.hypot(b.x - x, b.z - z) }))
    .filter(c => c.d <= maxDist)
    .sort((p, q) => p.d - q.d);

  for (const { b } of candidates) {
    const fx = Math.sin(b.facingAngle), fz = Math.cos(b.facingAngle); // the bench's front
    // Only approach from the front half: a straight walk to the stand point then never crosses the bench body.
    if (b.standOff > 0 && (x - b.x) * fx + (z - b.z) * fz < b.standOff) continue;
    const sx = b.x + fx * b.standOff, sz = b.z + fz * b.standOff;
    if (!isWalkClear(x, z, sx, sz, 0.8, BENCH_APPROACH_SLACK)) continue;
    b.claimedBy = agentId;
    return { benchId: b.id, x: sx, z: sz, facingAngle: b.facingAngle, seatTop: b.seatTop, standOff: b.standOff };
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
