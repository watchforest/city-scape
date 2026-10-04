/**
 * gatePath — the way in. A straight path from the corner of the park the camera starts over to the closest part of the
 * path network (a path or a plaza rim), added after the network itself is built. The gate (world/gate.js) stands halfway
 * along it.
 *
 * It is drawn and kept clear like any path (the path texture, the occupancy grid, lamps and benches along it), but it is
 * not part of the nav graph: people don't wander out to the gate.
 */

import { getParkHalf } from '@/world/parkBounds.js';
import { ribbonMesh, PATH_WIDTH } from './PathRenderer.js';
import { GATE_INSET } from '@/config.js';

const STEP = 6; // metres between the path's sample points

/**
 * Where the gate and its path go, or null if no clear way in was found.
 * @param {PathSegment[]} segments  the network's sampled paths ({ pts: [{ u, v }] })
 * @param {ProjectNode[]} projectNodes
 * @param {Map<string, number>} plazaRadius
 * @param {Map<string, number>} exclusionRadius  clear space round each landmark
 * @param {{ x, z, rx, rz } | null} lake
 * @returns {{ entry: {u, v}, connect: {u, v}, mid: {u, v}, dir: {u, v}, pts: object[] } | null}  entry = the corner end
 */
export function planGatePath(segments, projectNodes, plazaRadius, exclusionRadius, lake) {
  const half = getParkHalf();
  // The path starts in the corner the camera starts over (+x/+z), a little inside the frame.
  const entry = { u: half - GATE_INSET, v: half - GATE_INSET };

  // Candidate places to join the network: every path sample, and the point of each plaza's rim facing the corner.
  const cands = [];
  for (const s of segments) for (const p of s.pts) cands.push({ u: p.u, v: p.v, owner: null });
  for (const n of projectNodes) {
    const r = plazaRadius.get(n.id) || exclusionRadius.get(n.id) || 0;  // (a landmark without a plaza: the edge of its clear space)
    if (!r) continue;
    const dx = entry.u - n.layoutU, dz = entry.v - n.layoutV, d = Math.hypot(dx, dz) || 1;
    cands.push({ u: n.layoutU + dx / d * r, v: n.layoutV + dz / d * r, owner: n.id });
  }

  // The closest of them with a clear straight way to it.
  let best = null;
  for (const c of cands) {
    const length = Math.hypot(c.u - entry.u, c.v - entry.v);
    if (length < 20 || (best && length >= best.length)) continue;
    if (!_clear(entry, c, projectNodes, plazaRadius, exclusionRadius, lake, c.owner)) continue;
    best = { connect: { u: c.u, v: c.v }, length };
  }
  if (!best) { console.info('[gate] no clear way in from the corner to the path network'); return null; }

  const dx = best.connect.u - entry.u, dz = best.connect.v - entry.v, len = best.length;
  const tu = dx / len, tv = dz / len;
  const pts = [];
  for (let d = 0; d < len; d += STEP) pts.push({ u: entry.u + tu * d, v: entry.v + tv * d, tu, tv, width: PATH_WIDTH });
  pts.push({ u: best.connect.u, v: best.connect.v, tu, tv, width: PATH_WIDTH });
  // The arch stands halfway along the path, across it.
  const mid = { u: entry.u + tu * len / 2, v: entry.v + tv * len / 2 };
  return { entry, connect: best.connect, mid, dir: { u: tu, v: tv }, side: 'corner', pts };
}

/** True if the straight way from `a` to `b` stays clear of the lake and of every landmark but its own. */
function _clear(a, b, nodes, plazaRadius, exclusionRadius, lake, owner) {
  const dx = b.u - a.u, dz = b.v - a.v, len2 = dx * dx + dz * dz || 1;
  const near = (px, pz) => {
    const t = Math.max(0, Math.min(1, ((px - a.u) * dx + (pz - a.v) * dz) / len2));
    return Math.hypot(px - (a.u + dx * t), pz - (a.v + dz * t));
  };
  for (const n of nodes) {
    if (n.id === owner) continue;
    const r = Math.max(plazaRadius.get(n.id) ?? 0, exclusionRadius.get(n.id) ?? 20) + PATH_WIDTH * 0.5 + 6;
    if (Math.hypot(b.u - n.layoutU, b.v - n.layoutV) < r + 2) continue; // it joins at this landmark's own plaza or path end
    if (near(n.layoutU, n.layoutV) < r) return false;
  }
  if (lake) {
    // the lake as a circle of its larger radius, with a margin
    if (near(lake.x, lake.z) < Math.max(lake.rx, lake.rz) + 8) return false;
  }
  return true;
}

/**
 * Add the entrance path to what `renderPaths` produced: its mesh (occupancy), its ribbon (the painted path) and its
 * rendered segment (lamps and benches along it). Not added to the nav graph.
 */
export function addGatePath(rendered, plan, heightAt) {
  rendered.meshes.push(ribbonMesh(plan.pts, heightAt));
  rendered.shapes.ribbons.push(plan.pts.map(({ u, v, width }) => ({ u, v, width })));
  rendered.renderedSegments.push({ edgeFromId: null, edgeToId: null, pts: plan.pts });
}
