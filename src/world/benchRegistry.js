/**
 * Bench seat reservation registry.
 *
 * Separate from obstacleRegistry.js — that module tracks static collision
 * occupancy (what can't be placed where); this tracks a claim/release
 * lifecycle (which seat of which bench is occupied by whom) for SittingOnBenchState.
 *
 * A bench has one or more seats along its length (the decor bench has two, one on each half; the procedural fallback
 * bench has one). Each seat has its own stand point: where the sitter waits in front of its seat before sitting back.
 */

import { isWalkClear } from './obstacleRegistry.js';
import { BENCH_SOCIAL_BONUS } from '@/config.js';

let _benches = [];

/**
 * Register a bench at (x, z) facing `facingAngle`, called alongside addBench().
 * @param {number}   seatTop      seat height above the ground
 * @param {number}   standOff     0 = sit where the bench is; > 0 = stop this far in front of the seat and sit back onto it
 * @param {number[]} seatOffsets  where each seat is along the bench's length, from its centre
 */
export function registerBench(x, z, facingAngle, seatTop = 1.7, standOff = 0, seatOffsets = [0]) {
  _benches.push({
    id: `bench-${_benches.length}`,
    x, z, facingAngle, seatTop, standOff,
    seats: seatOffsets.map(along => ({ along, occupant: null })), // occupant: the agent who claimed it
  });
}

// A bench is registered as an obstacle of this radius (environment.js DECOR_BENCH_FOOTPRINT);
// the walk up to it is allowed to enter that circle.
const BENCH_APPROACH_SLACK = 3.4;

/** Where to stand for a seat: along the bench's length, and `standOff` out in front of it. */
function standPoint(b, seat) {
  const sin = Math.sin(b.facingAngle), cos = Math.cos(b.facingAngle);
  // The bench's length runs along (cos, −sin) and its front faces (sin, cos).
  return { x: b.x + cos * seat.along + sin * b.standOff, z: b.z - sin * seat.along + cos * b.standOff };
}

/**
 * Find and claim the best free seat for `agent` within maxDist: nearest first, but a seat beside someone already
 * sitting is made more attractive (BENCH_SOCIAL_BONUS), so benches fill in pairs. Seats that can't be reached by
 * walking straight in from the front are skipped.
 * Returns { benchId, seatIdx, x, z, facingAngle, seatTop, standOff } or null if none free nearby; (x, z) is where
 * to stand (in front of the seat when standOff > 0).
 */
export function claimNearestSeat(agent, x, z, maxDist = 140) {
  const options = [];
  for (const b of _benches) {
    const fx = Math.sin(b.facingAngle), fz = Math.cos(b.facingAngle); // the bench's front
    // Only approach from the front half: a straight walk to the stand point then never crosses the bench body.
    if (b.standOff > 0 && (x - b.x) * fx + (z - b.z) * fz < b.standOff) continue;
    b.seats.forEach((seat, seatIdx) => {
      if (seat.occupant) return;
      const sp = standPoint(b, seat);
      const d = Math.hypot(sp.x - x, sp.z - z);
      if (d > maxDist) return;
      const company = b.seats.some(s => s !== seat && s.occupant);
      options.push({ b, seat, seatIdx, sp, score: d - (company ? BENCH_SOCIAL_BONUS : 0) });
    });
  }
  options.sort((p, q) => p.score - q.score);

  for (const { b, seat, seatIdx, sp } of options) {
    if (!isWalkClear(x, z, sp.x, sp.z, 0.8, BENCH_APPROACH_SLACK)) continue;
    seat.occupant = agent;
    return { benchId: b.id, seatIdx, x: sp.x, z: sp.z, facingAngle: b.facingAngle, seatTop: b.seatTop, standOff: b.standOff };
  }
  return null;
}

/** True if someone is sitting (or on the way to sit) alone on a bench with a free seat beside them, within `radius` of (x, z). */
export function lonelySitterNear(x, z, radius) {
  const r2 = radius * radius;
  for (const b of _benches) {
    const taken = b.seats.filter(s => s.occupant).length;
    if (taken !== 1 || taken === b.seats.length) continue;
    if ((b.x - x) ** 2 + (b.z - z) ** 2 < r2) return true;
  }
  return false;
}

export function releaseSeat(benchId, seatIdx) {
  const seat = _benches.find(b => b.id === benchId)?.seats[seatIdx];
  if (seat) seat.occupant = null;
}

/** Whoever sits in the other seat(s) of the same bench (the first one found), or null. */
export function seatNeighbour(benchId, seatIdx) {
  const b = _benches.find(x => x.id === benchId);
  if (!b) return null;
  for (let i = 0; i < b.seats.length; i++) if (i !== seatIdx && b.seats[i].occupant) return b.seats[i].occupant;
  return null;
}

export function clear() {
  _benches = [];
}
