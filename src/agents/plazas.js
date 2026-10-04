/**
 * Plazas as agents see them: a disc round a landmark. People walk across the open ring between the landmark and the rim
 * (not just along the rim) and sometimes stop to admire the landmark (states/AdmiringState.js).
 */

import { LANDMARK_BLOCK_SCALE, AGENT_RADIUS } from '@/config.js';

const _plazas = []; // { x, z, r (the disc), block (the landmark's blocked circle) }

/** @param {AttractionInstance[]} attractions  (those with a plaza) */
export function setPlazas(attractions) {
  _plazas.length = 0;
  for (const a of attractions) {
    if (!a.isPlaza || !(a.plazaRadius > 0)) continue;
    _plazas.push({ x: a.layoutU, z: a.layoutV, r: a.plazaRadius, block: a.footprintRadius * LANDMARK_BLOCK_SCALE, lx: a.displayU, lz: a.displayV });
  }
}

/** The plaza whose disc (plus `slack`) contains (x, z), the nearest if several; null if none. */
export function plazaAt(x, z, slack = 0) {
  let best = null, bestD = Infinity;
  for (const p of _plazas) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d <= p.r + slack && d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** The nearest plaza within `range` of (x, z) (measured to its centre), or null. */
export function plazaNear(x, z, range) {
  let best = null, bestD = range;
  for (const p of _plazas) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** Radii of the open ring of a plaza that people can walk on: clear of the landmark, a little in from the rim. */
export function plazaRing(p, margin = 3.5) {
  const inner = p.block + AGENT_RADIUS + margin;
  const outer = Math.max(inner + 1.5, p.r - margin);
  return [inner, outer];
}

/** A random point in the open ring of the plaza, at angle `angle` (random if omitted). */
export function plazaPoint(p, rand, angle = rand() * Math.PI * 2, margin = 3.5) {
  const [inner, outer] = plazaRing(p, margin);
  const r = inner + rand() * (outer - inner);
  return { u: p.x + Math.cos(angle) * r, v: p.z + Math.sin(angle) * r };
}
