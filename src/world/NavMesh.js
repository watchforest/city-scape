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
import { bakePathMask }     from './terrain.js';

export function buildNavMesh(projectNodes, rand, affinityEdges = null, lakePos = null, footprints = new Map()) {
  const routes   = buildRoutes(projectNodes, rand, affinityEdges, footprints);
  const rendered = renderPaths(routes, projectNodes);

  // Bake the terrain path-distance mask so hills only appear in open ground.
  // Feed all path centreline samples + project node positions + lake center.
  const maskPoints = [];
  for (const seg of rendered.segments) {
    for (const pt of seg.pts) maskPoints.push({ u: pt.u, v: pt.v });
  }
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

  const navGraph    = buildNavGraph(routes, rendered.segments, projectNodes);
  const attractions = placeAttractions(projectNodes, routes, navGraph, rendered.segments, footprints);

  return {
    pathMeshes:       rendered.meshes,
    pathSegments:     rendered.segments,
    renderedSegments: rendered.renderedSegments,
    navGraph,
    attractions,
    plazaRadius:      routes.plazaRadius,
  };
}
