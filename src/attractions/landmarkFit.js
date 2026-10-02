/**
 * landmarkFit — sizes custom landmark models and reports their footprint.
 *
 * Models come from arbitrary sources (Sketchfab, the GLB composer) in arbitrary
 * units, so each is normalised — but by overall size (geometric mean of its X/Z
 * extents), not by its widest side. A wide model therefore ends up wider *and*
 * proportionally taller instead of being squeezed small. The resulting bounding
 * radius (`footprintRadius`) is what plazas and path clearances are sized from.
 */

import * as THREE from 'three';
import {
  MODEL_SIZE_SCALE, LANDMARK_TARGET_SIDE, LANDMARK_MIN_EXTENT,
  LANDMARK_MAX_EXTENT, LANDMARK_MAX_HEIGHT,
} from '@/config.js';
import { getFootprintRadius } from './AttractionCatalog.js';

/** The loaded glTF asset for a project's landmark, or null (→ procedural pavilion). */
export function resolveLandmarkAsset(assetLibrary, projId) {
  let asset = assetLibrary.resolve(`attraction:${projId}`);
  if (asset.type !== 'gltf') asset = assetLibrary.resolve('attraction:default');
  return asset?.type === 'gltf' ? asset : null;
}

/**
 * @returns {{ scale: number, footprintRadius: number }}
 *   scale — uniform factor to apply to the model as authored.
 *   footprintRadius — radius of the bounding circle after scaling (world units).
 */
export function fitLandmark(model, modelSize) {
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.z);
  if (!(longest > 0)) return { scale: 1, footprintRadius: getFootprintRadius() };

  const sizeMul = MODEL_SIZE_SCALE[(modelSize ?? '').trim().toLowerCase()] ?? MODEL_SIZE_SCALE.medium;
  // Floor the thin axis so a flat/degenerate model doesn't blow the scale up.
  const floor = longest * 0.05;
  const meanSide = Math.sqrt(Math.max(size.x, floor) * Math.max(size.z, floor));

  let k = (LANDMARK_TARGET_SIDE * sizeMul) / meanSide;
  k = Math.min(Math.max(k, LANDMARK_MIN_EXTENT / longest), LANDMARK_MAX_EXTENT / longest);
  if (size.y > 0) k = Math.min(k, LANDMARK_MAX_HEIGHT / size.y);

  return { scale: k, footprintRadius: Math.hypot(size.x * k, size.z * k) / 2 };
}

/** Footprint radius per project id (procedural pavilion for projects without a model). */
export function computeFootprints(projectNodes, assetLibrary) {
  const footprints = new Map();
  for (const proj of projectNodes) {
    const asset = resolveLandmarkAsset(assetLibrary, proj.id);
    footprints.set(proj.id, asset
      ? fitLandmark(asset.scene, proj.model_size).footprintRadius
      : getFootprintRadius());
  }
  return footprints;
}
