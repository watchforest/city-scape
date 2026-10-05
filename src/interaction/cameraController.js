import * as THREE from 'three';
import { getTerrainHeight } from '@/world/terrain.js';
import { getParkHalf } from '@/world/parkBounds.js';
import { isLineOccluded } from '@/world/obstacleRegistry.js';

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
 *   'idle'    — arrived, holding on the selection (OrbitControls handed back to the user if zoomTo asked for that)
 *   'follow'  — camera travels with a moving object each frame
 *   'zoomout' — animating back to the saved free position
 *
 * Framing: a selection is described by two distances, `contain` (the closest the camera can be and still
 * show the whole subject) and `comfort` (the preferred framing). `frameFor(radius)` makes both from the subject's
 * bounding radius and the current field of view / viewport. A selection flies to `comfort`, but never closer
 * than the user already is (unless that would cut the subject off, then `contain`).
 *
 * Whatever the mode, the target is kept inside the map and the camera above the terrain (`_constrain`), and
 * zoom-to-cursor is switched off while the cursor points at the sky or beyond the map (`_guardZoom`).
 */
const FOLLOW_RATE = 4;       // exponential smoothing rate (1/s)
const COMFORT_RATIO = 1.25;  // comfort distance = contain distance × this
const MIN_CLEARANCE = 3;     // the camera stays this far above the terrain
const EDGE_SLACK = 12;       // the target may go this far past the edge of the map
const INSET_RATE = 6;        // how fast the side-panel offset eases in/out (1/s)
const GRAB_MAX_STEP = 0.35;  // a drag may move the view by at most this × the camera's distance to the grabbed point (when the drag began) per pointer event
const OCCLUSION_CHECK = 0.25; // seconds between checks of whether the followed person is hidden
const OCCLUSION_TURN = 2.2;   // how fast (1/s) the camera swings round to a clear view
const GRAB_MIN_SLOPE = 0.2;  // a ray must point at least this steeply below the horizon (a slope of 0.2 ≈ 11°) to count as ground; nearer the horizon the ground stretches out without limit

export class CameraController {
  constructor(cam, controls, domElement) {
    this._cam = cam;
    this._controls = controls;

    this._mode = 'free';
    this._followTarget = null;
    this._followHeight = 0;
    this._followDist = 0;
    this._zoomOutHere = false; // zoomOut() pulls back from the current target instead of returning to the saved view
    this._userOrbit = false;   // hand the camera back to OrbitControls once arrived (landmarks)
    this._dirFrom = new THREE.Vector3(); // zoomOut: view direction to turn from …
    this._dirTo   = new THREE.Vector3(); // … and to

    this._dir = new THREE.Vector3(0, 1, 1).normalize(); // target -> camera
    this._savedTarget = controls.target.clone();
    this._savedDist   = cam.position.distanceTo(controls.target);
    this._savedDir    = this._dir.clone();

    this._curTarget = controls.target.clone();
    this._curDist   = this._savedDist;

    this._fromTarget = this._curTarget.clone();
    this._fromDist   = this._curDist;
    this._toTarget   = this._curTarget.clone();
    this._toDist     = this._curDist;
    this._animT        = 0;
    this._animDuration = 0.8;

    // Width (px) of a side panel covering the right of the screen: the selection is centred in the free area.
    this._insetTarget = 0;
    this._inset = 0;
    this._offsetOn = false;

    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._pointerDown = false;
    this._grab = null; // an active ground-grab pan: { id, plane, anchor }

    // OrbitControls keeps rotate (left-drag) and zoom (wheel). Panning is done here (_installGrabPan), so the ground
    // follows the cursor; what OrbitControls still pans itself (touch) moves along the ground, never up and down.
    controls.mouseButtons.RIGHT = null;
    controls.mouseButtons.MIDDLE = null;
    controls.screenSpacePanning = false;

    if (domElement) {
      domElement.addEventListener('pointermove', e => this._guardZoom(e, domElement));
      this._installGrabPan(domElement);
    }
  }

  // ── Framing helpers ──────────────────────────────────────────────────────

  /**
   * The contain / comfort distances for a subject of the given bounding radius, given the viewport and the
   * width of any side panel it must stay clear of.
   */
  frameFor(radius, { insetPx = 0, comfortRatio = COMFORT_RATIO } = {}) {
    const w = window.innerWidth, h = window.innerHeight;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this._cam.fov) / 2);
    const tanH = tanV * Math.max(0.3, (w - insetPx) / h);
    const contain = radius / Math.sin(Math.atan(Math.min(tanV, tanH)));
    return { contain, comfort: contain * comfortRatio };
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
      this._savedDir.copy(this._dir);
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

  /** The distance to fly to: the comfort framing, but never closer than the user already is, nor too close to see it all. */
  _chooseDistance(frame) {
    if (typeof frame === 'number') return Math.min(frame, this._savedDist);
    return this._curDist >= frame.comfort ? frame.comfort : Math.max(frame.contain, this._curDist);
  }

  /**
   * Fly the camera to a world position and frame it.
   *
   * worldPos: the point to look at, including its height (y).
   * frame:    { contain, comfort } from frameFor(), or a plain distance (never farther than the view the user
   *           started from).
   *
   * zoomOutHere: when the selection was reached by something other than the user
   * (an agent leading them to a landmark), the saved view is meaningless, so
   * zoomOut() pulls back from this target rather than flying to the saved view.
   *
   * userOrbit: once the camera has arrived, give control back to the user so they can turn
   * it around the target themselves; zoomOut then flies back to the view the selection started from.
   *
   * insetPx: width of a panel covering the right of the screen; the subject is centred in the rest.
   */
  zoomTo(worldPos, frame, { zoomOutHere = false, userOrbit = false, insetPx = 0 } = {}) {
    this._beginInteraction();
    this._userOrbit = userOrbit;
    this._followTarget = null;
    this._zoomOutHere = zoomOutHere;
    this._insetTarget = insetPx;
    this._startAnim(
      new THREE.Vector3(worldPos.x, worldPos.y ?? 0, worldPos.z),
      this._chooseDistance(frame),
      'zoomin'
    );
  }

  /** Start following a mesh (person walking); the camera travels with it, aimed at `height` above its feet. */
  follow(mesh, frame, height = 2) {
    this._beginInteraction();
    this._followTarget = mesh;
    this._followHeight = height;
    // Following always settles at the comfortable distance: from a close-up of the person it pulls back to show where they are heading.
    this._followDist = typeof frame === 'number' ? this._chooseDistance(frame) : frame.comfort;
    this._zoomOutHere = false;
    this._insetTarget = 0;
    this._yawGoal = null;       // set when the person gets hidden (see _avoidOcclusion)
    this._occT = 0;
    this._mode = 'follow';
  }

  /** Fly back to the saved free position (or pull back in place, see zoomTo). */
  zoomOut() {
    if (this._mode === 'free') return;
    this._followTarget = null;
    this._insetTarget = 0;
    if (this._userOrbit) {
      // The user may have turned, tilted, zoomed or panned: continue from where the camera is now.
      this._userOrbit = false;
      this._beginInteraction();
    }
    this._dirFrom.copy(this._dir);
    this._dirTo.copy(this._zoomOutHere ? this._dir : this._savedDir);
    const target = this._zoomOutHere ? this._curTarget : this._savedTarget;
    this._startAnim(target, this._savedDist, 'zoomout');
  }

  /** 'free' | 'zoomin' | 'idle' | 'follow' | 'zoomout' (see the class comment). */
  get mode() { return this._mode; }

  /** Remember the view the page opened with, to come back to (goHome). */
  captureHome() {
    this._home = {
      target: this._controls.target.clone(),
      dist: this._cam.position.distanceTo(this._controls.target),
      dir: this._cam.position.clone().sub(this._controls.target).normalize(),
    };
  }

  /**
   * Fly back to the view the page opened with, from wherever the camera is (following someone, orbiting on its own,
   * zoomed on a selection …). It is also the view a later zoomOut returns to.
   */
  goHome() {
    if (this._home) this.flyToView(this._home, true);
  }

  /**
   * Fly to a view { target, dist, dir } (dir = from the target towards the camera, unit), from wherever the camera is,
   * and hand it back to OrbitControls on arrival. `asHome`: also make it the view a later zoomOut returns to.
   */
  flyToView(view, asHome = false) {
    this._controls.autoRotate = false;
    this._followTarget = null;
    this._userOrbit = false;
    this._zoomOutHere = false;
    this._insetTarget = 0;
    this._beginInteraction();                       // takes the camera's current pose (and switches OrbitControls off)
    if (asHome) {
      this._savedTarget.copy(view.target);
      this._savedDist = view.dist;
      this._savedDir.copy(view.dir);
    }
    this._dirFrom.copy(this._dir);
    this._dirTo.copy(view.dir);
    this._startAnim(view.target, view.dist, 'zoomout');
  }

  release() {
    this._userOrbit = false;
    this._mode = 'free';
    this._followTarget = null;
    this._zoomOutHere = false;
    this._controls.enabled = true;
  }

  // ── Keeping the camera sane ──────────────────────────────────────────────

  /**
   * Zoom-to-cursor zooms towards the point under the cursor, which is nonsense for the sky or the void around the
   * map (the view runs off and gets stuck). Only allow it while the cursor ray hits the ground inside the map.
   */
  _guardZoom(e, el) {
    const r = el.getBoundingClientRect();
    this._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this._cam);
    const hit = this._ray.ray.intersectPlane(this._plane, this._hit);
    const half = getParkHalf() + EDGE_SLACK;
    this._controls.zoomToCursor = !!hit && Math.abs(hit.x) < half && Math.abs(hit.z) < half;
  }

  /**
   * Where a screen position meets the ground (the terrain, found by iterating a flat-plane hit against the height
   * there), as { plane, point } with the plane at that height; null if the ray misses (sky).
   */
  _groundAt(clientX, clientY, el) {
    this._cam.updateMatrixWorld(); // the camera may have moved since the last render
    const r = el.getBoundingClientRect();
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this._cam);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let h = 0;
    for (let i = 0; i < 3; i++) {
      plane.constant = -h;
      if (!this._ray.ray.intersectPlane(plane, this._hit)) return null;
      h = getTerrainHeight(this._hit.x, this._hit.z);
    }
    plane.constant = -h;
    if (!this._ray.ray.intersectPlane(plane, this._hit)) return null;
    return { plane, point: this._hit.clone() };
  }

  /**
   * Right-drag, middle-drag or shift/ctrl-drag pans like grabbing the ground: the point under the cursor when the
   * drag starts stays under the cursor, so dragging towards where you want to go pulls the ground (and you) along the
   * surface rather than moving the camera up or down.
   */
  _installGrabPan(el) {
    el.addEventListener('pointerdown', e => {
      this._pointerDown = true;
      const wantsPan = e.button === 1 || e.button === 2 || (e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey));
      if (!wantsPan || !this._controls.enabled) return;
      const g = this._groundAt(e.clientX, e.clientY, el);
      if (!g) return;
      // `mask`: which bit of PointerEvent.buttons is the button that started this drag.
      this._grab = {
        id: e.pointerId, plane: g.plane, anchor: g.point, mask: e.button === 0 ? 1 : e.button === 1 ? 4 : 2,
        reach: this._cam.position.distanceTo(g.point), // fixed for the whole drag (see the step cap below)
      };
      try { el.setPointerCapture(e.pointerId); } catch { /* not capturable (synthetic or already released): the drag still works */ }
      e.stopImmediatePropagation(); // OrbitControls must not also rotate
      e.preventDefault();
    }, true);

    el.addEventListener('pointermove', e => {
      const grab = this._grab;
      if (!grab || e.pointerId !== grab.id) return;
      // The button was released somewhere we never heard about (a context menu, the pointer left the window …):
      // stop, rather than keep dragging the camera along with a mouse that is no longer pressed.
      if (!(e.buttons & grab.mask)) { this._endGrab(); return; }

      const r = el.getBoundingClientRect();
      this._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this._ray.setFromCamera(this._ndc, this._cam);
      // A ray at or above the horizon has no sensible ground point (tiny cursor moves would mean enormous ones).
      if (this._ray.ray.direction.y > -GRAB_MIN_SLOPE) return;
      if (!this._ray.ray.intersectPlane(grab.plane, this._hit)) return;

      // Move so the grabbed point is back under the cursor, but by a bounded amount per event: close to the horizon
      // the ground stretches out, and an unbounded step would throw the camera across the map.
      let dx = grab.anchor.x - this._hit.x, dz = grab.anchor.z - this._hit.z;
      // (The cap uses the distance at the start of the drag, not the current one: dragging away from the grabbed point
      // makes that grow, and a cap that grows with it lets each step be bigger than the last, which runs away.)
      const len = Math.hypot(dx, dz), cap = GRAB_MAX_STEP * grab.reach;
      if (len > cap) { dx *= cap / len; dz *= cap / len; }
      this._cam.position.x += dx; this._cam.position.z += dz;
      this._controls.target.x += dx; this._controls.target.z += dz;
      // Several pointer events can arrive within one frame, and the next one raycasts from the camera's matrix, which
      // is otherwise only refreshed at render time: without this each event corrects against a stale camera and the
      // move is applied twice (overshoot, stutter).
      this._cam.updateMatrixWorld(true);
    });

    const end = e => {
      if (this._grab && e.pointerId === this._grab.id) this._endGrab();
      if (!e.buttons) this._pointerDown = false;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    window.addEventListener('pointerup', () => { this._pointerDown = false; });
    window.addEventListener('blur', () => { this._endGrab(); this._pointerDown = false; });
    el.addEventListener('contextmenu', e => e.preventDefault()); // right-drag is a pan, not a menu
  }

  _endGrab() {
    this._grab = null;
    this._pointerDown = false;
  }

  /**
   * Make the orbit pivot the ground point under the middle of the screen, always. (OrbitControls leaves the target
   * wherever zoom-to-cursor last put it, so rotation sometimes pivoted about the map's middle and sometimes about
   * something else.) The point is on the view ray, so nothing visibly moves.
   */
  _snapPivot() {
    this._cam.getWorldDirection(this._fwd);
    this._ray.set(this._cam.position, this._fwd);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let h = this._controls.target.y;
    for (let i = 0; i < 3; i++) {
      plane.constant = -h;
      if (!this._ray.ray.intersectPlane(plane, this._hit)) return; // looking at the sky: keep the pivot
      h = getTerrainHeight(this._hit.x, this._hit.z);
    }
    plane.constant = -h;
    if (!this._ray.ray.intersectPlane(plane, this._hit)) return;
    const d = this._cam.position.distanceTo(this._hit);
    if (d < this._controls.minDistance || d > this._controls.maxDistance) return; // would make OrbitControls move the camera
    this._controls.target.set(this._hit.x, h, this._hit.z);
  }

  /** Target inside the map, camera above the ground. Cheap enough to run every frame. */
  _constrain() {
    const half = getParkHalf() + EDGE_SLACK;
    const t = this._controls.target, p = this._cam.position;

    // Every correction slides the camera and the target together, so the view direction never changes: moving only
    // one of them swings the view round (a sudden lurch at the edge of the map or over rising ground).
    const cx = THREE.MathUtils.clamp(t.x, -half, half) - t.x;
    const cz = THREE.MathUtils.clamp(t.z, -half, half) - t.z;
    const cy = THREE.MathUtils.clamp(t.y, -1, 80) - t.y;
    if (cx || cy || cz) { t.x += cx; t.y += cy; t.z += cz; p.x += cx; p.y += cy; p.z += cz; }

    const minY = getTerrainHeight(THREE.MathUtils.clamp(p.x, -half, half), THREE.MathUtils.clamp(p.z, -half, half)) + MIN_CLEARANCE;
    if (p.y < minY) { const lift = minY - p.y; p.y += lift; t.y += lift; }
  }

  /** Ease the side-panel offset (view shifted so the subject sits in the free part of the screen). */
  _updateInset(dt) {
    if (this._inset !== this._insetTarget) {
      this._inset += (this._insetTarget - this._inset) * Math.min(1, dt * INSET_RATE);
      if (Math.abs(this._inset - this._insetTarget) < 0.5) this._inset = this._insetTarget;
    }
    if (this._inset === 0) {
      if (this._offsetOn) { this._cam.clearViewOffset(); this._offsetOn = false; }
    } else {
      // Re-applied every frame while offset, so it follows a window resize. Shifts the picture left by half the panel.
      this._cam.setViewOffset(window.innerWidth, window.innerHeight, this._inset / 2, 0, window.innerWidth, window.innerHeight);
      this._offsetOn = true;
    }
  }

  /**
   * Following someone: if a tree or a landmark comes between the camera and them, swing the camera round them to the
   * nearest side from which they can be seen (checked a few times a second; the swing is smooth, and the camera stays
   * where it ends up while the view is clear).
   */
  _avoidOcclusion(dt) {
    const dir = this._dir, el = dir.y;                         // unit target→camera; keep its elevation
    const cur = Math.atan2(dir.x, dir.z);
    this._occT += dt;
    if (this._occT >= OCCLUSION_CHECK) {
      this._occT = 0;
      const t = this._curTarget, d = this._curDist, horiz = Math.sqrt(Math.max(0, 1 - el * el));
      const hidden = yaw => isLineOccluded(
        t.x + Math.sin(yaw) * horiz * d, t.y + el * d, t.z + Math.cos(yaw) * horiz * d, t.x, t.y, t.z);
      if (hidden(cur)) {
        this._yawGoal = null;
        for (let k = 1; k <= 9; k++) {                         // 20°, −20°, 40°, −40° … 180°: the nearest clear side
          const off = (k * Math.PI) / 9;
          if (!hidden(cur + off)) { this._yawGoal = cur + off; break; }
          if (!hidden(cur - off)) { this._yawGoal = cur - off; break; }
        }
      }
    }
    if (this._yawGoal != null) {
      const diff = Math.atan2(Math.sin(this._yawGoal - cur), Math.cos(this._yawGoal - cur));
      if (Math.abs(diff) < 0.01) { this._yawGoal = null; return; }
      const next = cur + diff * Math.min(1, dt * OCCLUSION_TURN);
      const horiz = Math.sqrt(Math.max(0, 1 - el * el));
      dir.set(Math.sin(next) * horiz, el, Math.cos(next) * horiz);
    }
  }

  update(dt) {
    this._updateInset(dt);

    if (this._mode === 'free') {
      if (!this._pointerDown && !this._grab) this._snapPivot(); // (not mid-drag, which would fight the user)
      this._constrain();
      return;
    }
    if (this._mode === 'idle' && this._userOrbit) {
      this._constrain(); // pivot stays on the landmark
      return;
    }

    if (this._mode === 'follow' && this._followTarget) {
      const tp = this._followTarget.position;
      const k = Math.min(1, dt * FOLLOW_RATE);
      this._curTarget.x += (tp.x - this._curTarget.x) * k;
      this._curTarget.y += (tp.y + this._followHeight - this._curTarget.y) * k;
      this._curTarget.z += (tp.z - this._curTarget.z) * k;
      this._curDist += (this._followDist - this._curDist) * Math.min(1, dt * 3);
      this._avoidOcclusion(dt);
      this._apply();
      this._constrain();
      return;
    }

    if (this._mode === 'zoomin' || this._mode === 'zoomout') {
      this._animT += dt / this._animDuration;
      const t = _easeInOut(Math.min(1, this._animT));
      this._curTarget.lerpVectors(this._fromTarget, this._toTarget, t);
      this._curDist = this._fromDist + (this._toDist - this._fromDist) * t;
      if (this._mode === 'zoomout') this._dir.lerpVectors(this._dirFrom, this._dirTo, t).normalize();
      this._apply();
      this._constrain();

      if (this._animT >= 1) {
        if (this._mode === 'zoomout') {
          this.release();
        } else {
          this._mode = 'idle';
          if (this._userOrbit) this._controls.enabled = true; // from here on the user turns the camera
        }
      }
    }
  }
}

function _easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
