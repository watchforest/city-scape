import * as THREE from 'three';
import { FRUSTUM_SIZE } from '@/config.js';

/**
 * Smooth isometric camera controller.
 * Wraps OrbitControls — handles zoom-in on selection and pan-follow during walk.
 *
 * Modes:
 *   'free'    — normal OrbitControls
 *   'zoomin'  — animating toward a target position
 *   'follow'  — tracking a moving object each frame
 *   'zoomout' — animating back to saved free position
 */
export class CameraController {
  constructor(cam, controls) {
    this._cam = cam;
    this._controls = controls;

    this._mode = 'free';
    this._followTarget = null; // { mesh } — object to track

    // Saved state to restore after interaction
    this._savedZoom   = cam.zoom;
    this._savedTarget = controls.target.clone();

    // Animation state
    this._targetZoom   = cam.zoom;
    this._targetLookAt = controls.target.clone();
    this._animT        = 0;
    this._animDuration = 0.6; // seconds
    this._fromZoom     = cam.zoom;
    this._fromLookAt   = controls.target.clone();
  }

  /** Smoothly zoom in and center on a world position. */
  zoomTo(worldPos, zoomLevel = 8) {
    this._savedZoom   = this._cam.zoom;
    this._savedTarget = this._controls.target.clone();

    this._fromZoom   = this._cam.zoom;
    this._fromLookAt = this._controls.target.clone();
    this._targetZoom   = zoomLevel;
    this._targetLookAt = new THREE.Vector3(worldPos.x, 0, worldPos.z);
    this._animT        = 0;
    this._mode         = 'zoomin';
    this._controls.enabled = false;
  }

  /** Start following a mesh (person walking). */
  follow(mesh) {
    this._followTarget = mesh;
    this._mode = 'follow';
    this._controls.enabled = false;
  }

  /** Zoom back out to saved free position. */
  zoomOut() {
    this._fromZoom   = this._cam.zoom;
    this._fromLookAt = this._controls.target.clone();
    this._targetZoom   = this._savedZoom;
    this._targetLookAt = this._savedTarget.clone();
    this._animT        = 0;
    this._mode         = 'zoomout';
    this._followTarget = null;
  }

  release() {
    this._mode = 'free';
    this._followTarget = null;
    this._controls.enabled = true;
  }

  update(dt) {
    if (this._mode === 'free') return;

    if (this._mode === 'follow' && this._followTarget) {
      const tp = this._followTarget.position;
      const current = this._controls.target;
      // Smooth pan toward target
      current.x += (tp.x - current.x) * Math.min(1, dt * 4);
      current.z += (tp.z - current.z) * Math.min(1, dt * 4);
      this._controls.target.copy(current);
      this._cam.zoom += (4.5 - this._cam.zoom) * Math.min(1, dt * 3);
      this._cam.updateProjectionMatrix();
      return;
    }

    if (this._mode === 'zoomin' || this._mode === 'zoomout') {
      this._animT += dt / this._animDuration;
      const t = Math.min(1, _easeInOut(this._animT));

      this._cam.zoom = this._fromZoom + (this._targetZoom - this._fromZoom) * t;
      this._controls.target.lerpVectors(this._fromLookAt, this._targetLookAt, t);
      this._cam.updateProjectionMatrix();

      if (this._animT >= 1) {
        if (this._mode === 'zoomout') {
          this.release();
        } else {
          this._mode = 'idle';
        }
      }
    }
  }
}

function _easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
