/**
 * AttractionPlacer — produces AttractionInstance[] with correct display positions.
 *
 * An AttractionInstance is the single source of truth for where a project's
 * attraction mesh sits and which nav node agents path toward.
 *
 * For plazas: displayU/V = layoutU/V (attraction sits at plaza center).
 * For leaf/transit: displayU/V = layoutU/V (path bypasses the landmark, so
 *   the mesh can sit at the original layout position without clipping the path).
 *
 * navNodeId: the proj.id after post-processing in NavGraphBuilder — agents
 *   path to this node, which sits on the path near the attraction.
 */

import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { DEFAULT_PALETTE } from '@/config.js';
import { buildAttractionShape, getFootprintRadius, animateCatalog } from './AttractionCatalog.js';
import { fitLandmark, resolveLandmarkAsset } from './landmarkFit.js';
import { getTerrainHeight } from '@/world/terrain.js';

function tagProject(obj, proj) {
  obj.userData.project = proj;
  if (obj.children) {
    for (const child of obj.children) tagProject(child, proj);
  }
}

// Extra push (beyond the node's exclusion radius) for transit nodes, whose path runs past the landmark
const TRANSIT_EXTRA_OFFSET = 10;

/**
 * Build AttractionInstance[] from project nodes.
 *
 * For plazas: displayU/V = layoutU/V (center of plaza disc).
 * For leaf/transit: find the closest rendered path sample and push the mesh
 *   away from it, so it sits off the ribbon rather than on it.
 *
 * @param {ProjectNode[]}  projectNodes
 * @param {object}         routes      — from PathRouter (plazaRadius, degree maps)
 * @param {NavGraph}       navGraph    — unused, kept for API consistency
 * @param {PathSegment[]}  segments    — rendered path samples for offset computation
 * @returns {AttractionInstance[]}
 */
export function placeAttractions(projectNodes, routes, navGraph, segments = [], footprints = new Map()) {
  const { plazaRadius, degree, exclusionRadius } = routes;

  return projectNodes.map(proj => {
    const isPlaza      = (plazaRadius.get(proj.id) ?? 0) > 0;
    const plazaR       = isPlaza ? plazaRadius.get(proj.id) : 0;
    const footprintRadius = footprints.get(proj.id) ?? getFootprintRadius();

    let displayU = proj.layoutU;
    let displayV = proj.layoutV;

    if (!isPlaza && segments.length > 0) {
      const deg = degree.get(proj.id) ?? 0;
      const isTransit = deg >= 2;
      // Scales with the landmark: a big model sits further off the path.
      const offsetDist = (exclusionRadius.get(proj.id) ?? 18) + (isTransit ? TRANSIT_EXTRA_OFFSET : 0);

      // Find the closest path sample to this project's layout position
      let closestU = null, closestV = null, minDist2 = Infinity;
      for (const seg of segments) {
        for (const pt of seg.pts) {
          const d2 = (pt.u - proj.layoutU) ** 2 + (pt.v - proj.layoutV) ** 2;
          if (d2 < minDist2) { minDist2 = d2; closestU = pt.u; closestV = pt.v; }
        }
      }

      if (closestU !== null) {
        // Direction from closest path sample TOWARD layout position.
        // For transit nodes the ribbon starts at layoutU/V so dist may be ~0;
        // fall back to pushing toward the scene center (away from the path).
        let du = proj.layoutU - closestU;
        let dv = proj.layoutV - closestV;
        let dist = Math.hypot(du, dv);
        if (dist < 0.5) {
          // Use direction from scene center toward layoutU/V as perpendicular escape
          du = proj.layoutU;
          dv = proj.layoutV;
          dist = Math.hypot(du, dv) || 1;
        }
        displayU = closestU + (du / dist) * offsetDist;
        displayV = closestV + (dv / dist) * offsetDist;
      }
    }

    return {
      // Identity
      id: proj.id,
      name: proj.name,
      description: proj.description,
      tags: proj.tags,
      url: proj.url,
      modelSize: proj.model_size,
      members: proj.members,
      // Layout
      layoutU: proj.layoutU,
      layoutV: proj.layoutV,
      // Shape
      footprintRadius,
      isPlaza,
      plazaRadius: plazaR,
      // Visual
      displayU,
      displayV,
      // Nav — agents path to proj.id node (set by NavGraphBuilder post-processing)
      navNodeId: proj.id,
    };
  });
}

/**
 * Scale a custom model by the factor from fitLandmark, centre it in X/Z and
 * rest its base on the ground (y = 0).
 * Returns a wrapper group so the caller's position/tagging apply cleanly.
 */
function _wrapCustomModel(model, k) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x * k, -box.min.y * k, -center.z * k);
  model.scale.multiplyScalar(k);
  model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  const group = new THREE.Group();
  group.add(model);
  return group;
}

/**
 * Build Three.js meshes for each AttractionInstance and add to scene.
 *
 * @param {THREE.Scene}          scene
 * @param {AttractionInstance[]} instances
 * @param {object}               assetLibrary
 * @returns {Array<{ group: THREE.Group, instance: AttractionInstance }>}
 */
export function buildAttractionMeshes(scene, instances, assetLibrary) {
  const results = [];

  for (const inst of instances) {
    let group;

    // Per-project model from projects.csv, else the shared default, else procedural pavilion.
    const asset = resolveLandmarkAsset(assetLibrary, inst.id);
    if (asset) {
      group = _wrapCustomModel(skeletonClone(asset.scene), fitLandmark(asset.scene, inst.modelSize).scale);
    } else {
      group = buildAttractionShape(DEFAULT_PALETTE);
    }

    group.position.set(inst.displayU, getTerrainHeight(inst.displayU, inst.displayV), inst.displayV);
    tagProject(group, inst);

    scene.add(group);
    results.push({ group, instance: inst });
  }

  return results;
}

/**
 * Animate attraction meshes each frame.
 * @param {Array<{ group: THREE.Group, instance: AttractionInstance }>} meshes
 * @param {number} dt
 */
export function animateAttractions(meshes, dt) {
  animateCatalog(meshes, dt);
}
