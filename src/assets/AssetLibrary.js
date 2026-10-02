import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * Asset library for swapping GLTF/GLB models.
 *
 * Usage:
 *   library.register('tower:ml', '/assets/models/buildings/tower_ml.glb')
 *   await library.preloadAll()
 *   const asset = library.resolve('tower:ml')
 *   // asset.type === 'gltf' -> asset.scene is a THREE.Group
 *   // asset.type === 'wireframe' -> use procedural fallback
 */
export class AssetLibrary {
  constructor() {
    this._registry = new Map(); // key -> { url, status, scene }
    this._loader = new GLTFLoader();
    // Compressed GLBs: Draco geometry (decoder files copied to public/assets/libs/draco)
    // and meshopt geometry. KTX2/Basis textures are not enabled (needs a renderer).
    const draco = new DRACOLoader();
    draco.setDecoderPath('/assets/libs/draco/');
    this._loader.setDRACOLoader(draco);
    this._loader.setMeshoptDecoder(MeshoptDecoder);
  }

  register(key, url) {
    this._registry.set(key, { url, status: 'pending', scene: null });
  }

  async preloadAll() {
    const promises = [];
    for (const [key, entry] of this._registry) {
      promises.push(
        this._loader.loadAsync(entry.url)
          .then(gltf => {
            entry.scene = gltf.scene;
            entry.animations = gltf.animations ?? [];
            entry.status = 'loaded';
          })
          .catch(() => {
            entry.status = 'failed';
          })
      );
    }
    await Promise.all(promises);
  }

  resolve(key) {
    const entry = this._registry.get(key);
    if (entry?.status === 'loaded' && entry.scene) {
      return { type: 'gltf', scene: entry.scene, animations: entry.animations };
    }
    return { type: 'wireframe' };
  }

  isReady(key) {
    return this._registry.get(key)?.status === 'loaded';
  }
}
