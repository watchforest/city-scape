import * as THREE from 'three';
import { CAM_FRAME_FOLLOW } from '@/config.js';

/**
 * Camera controller that physically moves the camera (dolly), rather than
 * narrowing the FOV. Wraps OrbitControls.
 *
 * The camera is described by (target, distance) along a fixed view direction
 * captured when an interaction starts, so the user's chosen orbit angle is kept.
 *
 * Modes:
 *   'free'    — normal OrbitControls
 *   'zoomin'  — animating target + distance toward a selection
 *   'idle'    — arrived, holding on the selection
 *   'follow'  — camera travels with a moving object each frame
 *   'zoomout' — animating back to the saved free position
 */
const FOLLOW_RATE = 4;     // exponential smoothing rate (1/s)

export class CameraController {
  constructor(cam, controls) {
    this._cam = cam;
    this._controls = controls;

    this._mode = 'free';
    this._followTarget = null;
    this._followDist = 0;
    this._zoomOutHere = false; // zoomOut() pulls back from the current target instead of returning to the saved view

    this._dir = new THREE.Vector3(0, 1, 1).normalize(); // target -> camera
    this._savedTarget = controls.target.clone();
    this._savedDist   = cam.position.distanceTo(controls.target);

    this._curTarget = controls.target.clone();
    this._curDist   = this._savedDist;

    this._fromTarget = this._curTarget.clone();
    this._fromDist   = this._curDist;
    this._toTarget   = this._curTarget.clone();
    this._toDist     = this._curDist;
    this._animT        = 0;
    this._animDuration = 0.8;
  }

  /** Capture the current free-orbit view so zoomOut can return to it. */
  _beginInteraction() {
    this._dir.copy(this._cam.position).sub(this._controls.target);
    this._curDist = this._dir.length();
    this._dir.normalize();
    this._curTarget.copy(this._controls.target);
    if (this._mode === 'free') {
      this._savedTarget.copy(this._curTarget);
      this._savedDist = this._curDist;
    }
    this._controls.enabled = false;
  }

  _startAnim(target, dist, mode) {
    this._fromTarget.copy(this._curTarget);
    this._fromDist = this._curDist;
    this._toTarget.copy(target);
    this._toDist = dist;
    this._animT = 0;
    this._mode = mode;
  }

  _apply() {
    this._controls.target.copy(this._curTarget);
    this._cam.position.copy(this._curTarget).addScaledVector(this._dir, this._curDist);
    this._cam.lookAt(this._curTarget);
  }

  /**
   * Fly the camera to a world position and frame it from `distance` world units.
   * The distance is absolute (not relative to the current zoom), but never
   * farther than the view the user started from, so clicking while already
   * zoomed in doesn't pull the camera back out.
   *
   * zoomOutHere: when the selection was reached by something other than the user
   * (an agent leading them to a landmark), the saved view is meaningless, so
   * zoomOut() pulls back from this target rather than flying to the saved view.
   */
  zoomTo(worldPos, distance, { zoomOutHere = false } = {}) {
    this._beginInteraction();
    this._followTarget = null;
    this._zoomOutHere = zoomOutHere;
    this._startAnim(
      new THREE.Vector3(worldPos.x, 0, worldPos.z),
      Math.min(distance, this._savedDist),
      'zoomin'
    );
  }

  /** Start following a mesh (person walking); the camera travels with it. */
  follow(mesh, distance = CAM_FRAME_FOLLOW) {
    this._beginInteraction();
    this._followTarget = mesh;
    this._followDist = Math.min(distance, this._savedDist);
    this._zoomOutHere = false;
    this._mode = 'follow';
  }

  /** Fly back to the saved free position (or pull back in place, see zoomTo). */
  zoomOut() {
    if (this._mode === 'free') return;
    this._followTarget = null;
    const target = this._zoomOutHere ? this._curTarget : this._savedTarget;
    this._startAnim(target, this._savedDist, 'zoomout');
  }

  release() {
    this._mode = 'free';
    this._followTarget = null;
    this._zoomOutHere = false;
    this._controls.enabled = true;
  }

  update(dt) {
    if (this._mode === 'free') return;

    if (this._mode === 'follow' && this._followTarget) {
      const tp = this._followTarget.position;
      const k = Math.min(1, dt * FOLLOW_RATE);
      this._curTarget.x += (tp.x - this._curTarget.x) * k;
      this._curTarget.z += (tp.z - this._curTarget.z) * k;
      this._curDist += (this._followDist - this._curDist) * Math.min(1, dt * 3);
      this._apply();
      return;
    }

    if (this._mode === 'zoomin' || this._mode === 'zoomout') {
      this._animT += dt / this._animDuration;
      const t = _easeInOut(Math.min(1, this._animT));
      this._curTarget.lerpVectors(this._fromTarget, this._toTarget, t);
      this._curDist = this._fromDist + (this._toDist - this._fromDist) * t;
      this._apply();

      if (this._animT >= 1) {
        if (this._mode === 'zoomout') this.release();
        else this._mode = 'idle';
      }
    }
  }
}

function _easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
