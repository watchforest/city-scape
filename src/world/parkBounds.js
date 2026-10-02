/**
 * parkBounds — the park's world extent, sized from the project layout.
 *
 * The park is a square centred on the origin. `fitParkToNodes` measures the
 * landmark layout, re-centres it on the origin and sets the bounds so fewer
 * landmarks → smaller park, more landmarks → bigger park. Everything that used
 * to read a fixed PARK_BOUNDS constant reads these getters at build time instead
 * (so call `fitParkToNodes` before building terrain, environment, ground, etc.).
 */

import { PARK_REF_HALF, PARK_MIN_HALF, PARK_EDGE_MARGIN, LANDMARK_CLEARANCE } from '@/config.js';

let _bounds = [-PARK_REF_HALF, -PARK_REF_HALF, PARK_REF_HALF, PARK_REF_HALF];

/** [minU, minV, maxU, maxV] */
export function getParkBounds() { return _bounds; }

/** Half the park's side length (world units). */
export function getParkHalf() { return (_bounds[2] - _bounds[0]) / 2; }

/** Linear size relative to the reference park (1 = original 540-unit park). */
export function getParkScale() { return getParkHalf() / PARK_REF_HALF; }

/** Area relative to the reference park — use to scale prop counts. */
export function getParkAreaScale() { const s = getParkScale(); return s * s; }

/**
 * Re-centre `nodes` (mutates layoutU/layoutV) on the origin and set the park
 * bounds so the outermost landmark, its plaza/clearance and an edge margin fit.
 *
 * @param {{ id: string, layoutU: number, layoutV: number }[]} nodes
 * @param {Map<string, number>} footprints — landmark bounding radius per project id
 * @returns {number[]} the new bounds
 */
export function fitParkToNodes(nodes, footprints = new Map()) {
  if (nodes.length) {
    let loU = Infinity, hiU = -Infinity, loV = Infinity, hiV = -Infinity;
    for (const n of nodes) {
      loU = Math.min(loU, n.layoutU); hiU = Math.max(hiU, n.layoutU);
      loV = Math.min(loV, n.layoutV); hiV = Math.max(hiV, n.layoutV);
    }
    const cu = (loU + hiU) / 2, cv = (loV + hiV) / 2;
    for (const n of nodes) { n.layoutU -= cu; n.layoutV -= cv; }
  }

  let half = PARK_MIN_HALF;
  for (const n of nodes) {
    // Plazas start at 24 units; bigger landmarks need footprint + clearance.
    const reach = Math.max(24, (footprints.get(n.id) ?? 0) + LANDMARK_CLEARANCE);
    half = Math.max(half, Math.max(Math.abs(n.layoutU), Math.abs(n.layoutV)) + reach + PARK_EDGE_MARGIN);
  }
  half = Math.ceil(half / 10) * 10;

  _bounds = [-half, -half, half, half];
  return _bounds;
}
