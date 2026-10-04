/**
 * Decor models — the trees, rocks, grass clumps, stumps, benches, lamp posts and birds baked by
 * `scripts/splitDecor.mjs` into public/assets/models/decor/ (one small GLB per model plus manifest.json).
 *
 * `registerDecor` + `collectDecor` load them through the AssetLibrary and return, per category, a list of
 * variants ready for InstancedMesh: the models are already baked to the origin (base on y = 0) at their
 * category's size, so spawners only randomise them. A static variant is `{ id, parts, size }` where
 * `parts` is `[{ name, materialName, geometry, material }]` (a bench has seat, back and legs); `geometry` /
 * `material` are shortcuts for the first part. Birds are skinned and animated, so they are kept as
 * `{ id, scene, animations }` to be cloned with SkeletonUtils instead.
 * If the manifest or a file is missing the category is simply empty and the spawners fall back to
 * their procedural shapes.
 */

import * as THREE from 'three';
import { assetUrl } from '@/assets/assetUrl.js';

const EMPTY = () => ({ tree: [], rock: [], grass: [], stump: [], bench: [], lamp: [], bird: [] });

// Faceted low-poly categories are shaded flat (their normals were dropped to allow simplification, see
// splitDecor.mjs); the smooth ones (bench, lamp) keep their normals.
const FLAT = new Set(['tree', 'rock', 'grass', 'stump']);

/**
 * Step 1 — before `library.preloadAll()`: fetch the manifest and register every model with the library,
 * so they load in parallel with the characters and landmarks. Returns the manifest (empty if missing).
 * @param {import('@/assets/AssetLibrary.js').AssetLibrary} library
 */
export async function registerDecor(library) {
  try {
    const res = await fetch(assetUrl('assets/models/decor/manifest.json'));
    if (!res.ok) return { models: [] };
    const manifest = await res.json();
    if (!Array.isArray(manifest.models)) return { models: [] };
    for (const m of manifest.models) library.register(`decor:${m.id}`, assetUrl(`assets/models/decor/${m.file}`));
    return manifest;
  } catch {
    return { models: [] };
  }
}

/**
 * Step 2 — after `preloadAll()`: turn the loaded models into per-category variants.
 * @returns {Record<string, Variant[]>}
 */
export function collectDecor(library, manifest) {
  const out = EMPTY();
  for (const m of manifest.models) {
    const asset = library.resolve(`decor:${m.id}`);
    if (asset.type !== 'gltf' || !out[m.category]) continue;

    if (m.skinned) {
      out[m.category].push({ id: m.id, scene: asset.scene, animations: asset.animations, size: m.size ?? null });
      continue;
    }

    asset.scene.updateWorldMatrix(true, true);
    const parts = [];
    asset.scene.traverse(o => {
      if (!o.isMesh) return;
      const src = o.material;
      parts.push({
        name: o.name,
        materialName: src.name,
        geometry: o.geometry.clone().applyMatrix4(o.matrixWorld),
        // Lambert like the rest of the park.
        material: new THREE.MeshLambertMaterial({
          map: src.map ?? null,
          color: src.map ? 0xffffff : src.color,
          flatShading: FLAT.has(m.category),
        }),
      });
    });
    if (!parts.length) continue;
    out[m.category].push({ id: m.id, parts, geometry: parts[0].geometry, material: parts[0].material, size: m.size });
  }
  return out;
}

/**
 * @typedef {{ id: string, size: number[] | null, parts?: { name: string, materialName: string, geometry: THREE.BufferGeometry, material: THREE.Material }[],
 *             geometry?: THREE.BufferGeometry, material?: THREE.Material, scene?: THREE.Object3D, animations?: THREE.AnimationClip[] }} Variant
 */
