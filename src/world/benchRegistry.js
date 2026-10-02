/**
 * Bench seat reservation registry.
 *
 * Separate from obstacleRegistry.js — that module tracks static collision
 * occupancy (what can't be placed where); this tracks a claim/release
 * lifecycle (which bench is occupied by whom) for SittingOnBenchState.
 */

let _benches = [];

/** Register a bench at (x, z) facing `facingAngle`, called alongside addBench(). */
export function registerBench(x, z, facingAngle) {
  _benches.push({
    id: `bench-${_benches.length}`,
    x, z, facingAngle,
    claimedBy: null, // agent id while occupied (one person per bench)
  });
}

/**
 * Find and claim the nearest unoccupied bench to (x, z), within maxDist.
 * Returns { benchId, x, z, facingAngle } or null if none free nearby.
 */
export function claimNearestSeat(agentId, x, z, maxDist = 60) {
  let best = null, bestDist = maxDist;
  for (const bench of _benches) {
    if (bench.claimedBy !== null) continue;
    const d = Math.hypot(bench.x - x, bench.z - z);
    if (d > bestDist) continue;
    best = bench;
    bestDist = d;
  }
  if (!best) return null;
  best.claimedBy = agentId;
  return { benchId: best.id, x: best.x, z: best.z, facingAngle: best.facingAngle };
}

export function releaseSeat(benchId) {
  const bench = _benches.find(b => b.id === benchId);
  if (bench) bench.claimedBy = null;
}

export function clear() {
  _benches = [];
}
