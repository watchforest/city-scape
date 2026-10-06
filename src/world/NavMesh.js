/**
 * NavMesh — spatial layer orchestrator.
 *
 * Replaces the monolithic buildPathNetwork. Calls the path pipeline in order:
 *   PathRouter   → route topology (MST, bypass control pts)
 *   PathRenderer → Three.js ribbon/disc meshes + sampled segments
 *   NavGraphBuilder → nav nodes + adjacency
 *   AttractionPlacer → AttractionInstance[] with display positions + navNodeIds
 *
 * @param {ProjectNode[]} projectNodes — output of layoutProjects()
 * @param {function}      rand
 * @param {Map<string, number>} footprints — landmark bounding radius per project id (landmarkFit)
 * @returns {{
 *   pathMeshes: THREE.Mesh[],
 *   pathSegments: PathSegment[],
 *   navGraph: NavGraph,
 *   attractions: AttractionInstance[],
 * }}
 */

import { buildRoutes }      from '../paths/PathRouter.js';
import { renderPaths }      from '../paths/PathRenderer.js';
import { buildNavGraph }    from '../paths/NavGraphBuilder.js';
import { placeAttractions } from '../attractions/AttractionPlacer.js';
import { planGatePath, addGatePath } from '../paths/gatePath.js';
import { bakePathMask, getTerrainHeight } from './terrain.js';

export function buildNavMesh(projectNodes, rand, affinityEdges = null, lakeFor = null, footprints = new Map(), withGate = true) {
  const routes = buildRoutes(projectNodes, rand, affinityEdges, footprints);
  // `lakeFor` is the lake, or a function that picks it from the finished routes (so it can keep clear of the real paths).
  const lakePos = typeof lakeFor === 'function' ? lakeFor(routes) : lakeFor;

  // Bake the terrain flat-zone mask: ground stays level around landmarks, plazas and the
  // lake. Paths themselves do NOT flatten the ground — they are draped over the terrain
  // below — so hills can roll across the park between and under the routes.
  const maskPoints = [];
  // Sample plaza discs densely so the full disc area is flat
  for (const proj of projectNodes) {
    const plazaR = routes.plazaRadius.get(proj.id) ?? 0;
    const sampleR = Math.max(plazaR, routes.exclusionRadius.get(proj.id) ?? 20); // landmark area stays flat even for non-plazas
    for (let r = 0; r <= sampleR; r += 8) {
      const steps = Math.max(1, Math.round(Math.PI * 2 * r / 8));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        maskPoints.push({ u: proj.layoutU + Math.cos(a) * r, v: proj.layoutV + Math.sin(a) * r });
      }
    }
  }
  if (lakePos) {
    // Sample a grid of points across the lake ellipse so the whole bed is flat
    for (let a = 0; a < Math.PI * 2; a += 0.4) {
      for (let r = 0; r <= 1; r += 0.5) {
        maskPoints.push({ u: lakePos.x + Math.cos(a) * lakePos.rx * r, v: lakePos.z + Math.sin(a) * lakePos.rz * r });
      }
    }
  }
  bakePathMask(maskPoints);

  // Terrain is final now: drape the path meshes over it.
  const rendered = renderPaths(routes, projectNodes, getTerrainHeight);

  // The way in: a path from the park's gate to the nearest part of the network (drawn and kept clear, not walked).
  const gate = withGate ? planGatePath(rendered.segments, projectNodes, routes.plazaRadius, routes.exclusionRadius, lakePos) : null;
  if (gate) addGatePath(rendered, gate, getTerrainHeight);

  const navGraph   = buildNavGraph(routes, rendered.segments, projectNodes);
  const attractions = placeAttractions(projectNodes, routes, navGraph, rendered.segments, footprints);

  return {
    pathMeshes:       rendered.meshes,   // occupancy only — never added to the scene
    pathShapes:       rendered.shapes,   // painted onto the ground (paths/pathTexture.js)
    pathSegments:     rendered.segments,
    renderedSegments: rendered.renderedSegments,
    navGraph,
    attractions,
    plazaRadius:      routes.plazaRadius,
    lakePos,
    gate,                               // { entry, connect, dir, side, pts } or null (see paths/gatePath.js)
  };
}
