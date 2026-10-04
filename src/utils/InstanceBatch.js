/**
 * InstanceBatch — a thin wrapper around THREE.InstancedMesh for convenient
 * procedural placement.
 *
 * Usage:
 *   const batch = new InstanceBatch(geometry, material, 300);
 *   batch.add(matrix4);                         // raw Matrix4
 *   batch.addFromPRS(position, rotation, scale); // Vector3, Euler, Vector3
 *   batch.finalize(scene);                      // sets count, adds to scene
 *   batch.getMesh();                            // returns the InstancedMesh
 */

import * as THREE from 'three';

export class InstanceBatch {
  /**
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material}       material
   * @param {number}               maxCount   Maximum number of instances (default 1024)
   */
  constructor(geometry, material, maxCount = 1024) {
    this._mesh = new THREE.InstancedMesh(geometry, material, maxCount);
    this._mesh.castShadow    = true;
    this._mesh.receiveShadow = false;
    if (material.userData?.windDepth) this._mesh.customDepthMaterial = material.userData.windDepth; // swaying plants cast swaying shadows (world/wind.js)
    this._count = 0;
    this._maxCount = maxCount;
  }

  /**
   * Set the next instance's transform from a pre-built Matrix4.
   * @param  {THREE.Matrix4} matrix4
   * @param  {THREE.Color}   [color]  per-instance tint
   * @returns {number} The instance index that was set, or -1 if full.
   */
  add(matrix4, color = null) {
    if (this._count >= this._maxCount) {
      console.warn('[InstanceBatch] maxCount reached — instance skipped.');
      return -1;
    }
    const idx = this._count++;
    this._mesh.setMatrixAt(idx, matrix4);
    // Optional per-instance tint: multiplies the material colour (values above 1 brighten).
    if (color) this._mesh.setColorAt(idx, color);
    return idx;
  }

  /**
   * Convenience: build a Matrix4 from position / rotation / scale and add it.
   * @param  {THREE.Vector3} position
   * @param  {THREE.Euler}   rotation
   * @param  {THREE.Vector3} scale
   * @returns {number} Instance index, or -1 if full.
   */
  addFromPRS(position, rotation, scale) {
    const m = new THREE.Matrix4();
    m.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
    return this.add(m);
  }

  /**
   * Finalise the batch: clamp instancedMesh.count to actual placed count and
   * add the mesh to the scene.
   * @param {THREE.Scene} scene
   */
  finalize(scene) {
    this._mesh.count = this._count;
    this._mesh.instanceMatrix.needsUpdate = true;
    if (this._mesh.instanceColor) this._mesh.instanceColor.needsUpdate = true;
    scene.add(this._mesh);
  }

  /** @returns {THREE.InstancedMesh} */
  getMesh() {
    return this._mesh;
  }
}

/**
 * All the parts of one decor-model variant (see world/decor.js) instanced together: one InstanceBatch per part
 * (a tree is trunk + branches + leaves, a bush has berries …), every `add` placing the same transform (and tint) on each.
 */
export class VariantBatch {
  /** @param {{ parts: { geometry, material }[] }} variant  @param {number} maxCount */
  constructor(variant, maxCount) {
    this.batches = variant.parts.map(p => new InstanceBatch(p.geometry, p.material, maxCount));
  }

  add(matrix4, color = null) {
    for (const b of this.batches) b.add(matrix4, color);
  }

  /** Turn shadow casting on or off for every part (small things like flowers are not worth a shadow). */
  setCastShadow(on) {
    for (const b of this.batches) b.getMesh().castShadow = on;
  }

  finalize(scene) {
    for (const b of this.batches) b.finalize(scene);
  }
}

export default InstanceBatch;
