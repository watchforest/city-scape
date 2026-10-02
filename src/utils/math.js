/**
 * Coordinate conversion helpers.
 *
 * All 2D layout/path positions use (u, v) — the flat park plane.
 * All Three.js world positions use (x, y, z) where y = 0 for ground level.
 * Conversion: u → x, v → z, y = 0.
 */

export const uvToWorld = (u, v) => ({ x: u, y: 0, z: v });
export const worldToUV = (x, z) => ({ u: x, v: z });

/** Euclidean distance in UV space. */
export const uvDist = (a, b) => Math.hypot(b.u - a.u, b.v - a.v);

/** Squared Euclidean distance in UV space (cheaper for comparisons). */
export const uvDist2 = (a, b) => (b.u - a.u) ** 2 + (b.v - a.v) ** 2;
