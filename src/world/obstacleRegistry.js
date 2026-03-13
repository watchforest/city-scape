/**
 * Shared obstacle registry — single source of truth for all spawners and path builders.
 *
 * All coordinates are world XZ space.
 * Project nodes use (x, y) where y = world Z — callers normalise when registering.
 */

export const registry = [];

export function clear() {
  registry.length = 0;
}

export function registerCircle(x, z, r) {
  registry.push({ type: 'circle', x, z, r });
}

export function registerEllipse(x, z, rx, rz) {
  registry.push({ type: 'ellipse', x, z, rx, rz });
}

/**
 * Returns true if point (x, z) is inside any registered obstacle.
 * margin expands each obstacle outward by that many world units.
 */
export function isOccupied(x, z, margin = 0) {
  for (const o of registry) {
    if (o.type === 'circle') {
      const r = o.r + margin;
      if ((x - o.x) ** 2 + (z - o.z) ** 2 < r * r) return true;
    } else {
      const rx = o.rx + margin, rz = o.rz + margin;
      if ((x - o.x) ** 2 / (rx * rx) + (z - o.z) ** 2 / (rz * rz) < 1) return true;
    }
  }
  return false;
}
