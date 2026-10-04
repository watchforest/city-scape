import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAM_DIST, ISO_ELEVATION, GATE_VIEW_ELEVATION } from '@/config.js';
import { getParkScale, getParkHalf } from './parkBounds.js';

export const DEFAULT_FOV = 45;

const _p = new THREE.Vector3();

/**
 * The camera as it starts: over the +x/+z corner, far enough back to frame the whole park (whatever its size), looking
 * at the middle. If a `focus` (the gate, { u, v }) is given and the plain view would leave it out of the picture, the
 * view is eased towards it — looking a bit nearer to it and a bit further back — by the least that brings the gate in
 * while the far corner of the park stays in view too.
 * @returns {{ cam: THREE.PerspectiveCamera, target: THREE.Vector3, distance: number }}
 */
export function makeDefaultCamera(aspect = window.innerWidth / window.innerHeight, focus = null) {
  const cam = new THREE.PerspectiveCamera(DEFAULT_FOV, aspect, 1, 4000);
  const dist0 = CAM_DIST * getParkScale();
  const elev = focus ? GATE_VIEW_ELEVATION : ISO_ELEVATION;   // a little lower with a gate, so its sign is seen more face-on
  const dir = new THREE.Vector3(
    Math.cos(elev) * Math.sin(Math.PI / 4),
    Math.sin(elev),
    Math.cos(elev) * Math.cos(Math.PI / 4),
  );
  const place = (s, k) => {
    const target = new THREE.Vector3(focus ? focus.u * s : 0, 0, focus ? focus.v * s : 0);
    cam.position.copy(target).addScaledVector(dir, dist0 * k);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    return target;
  };
  let best = { s: 0, k: 1 };
  if (focus) {
    const half = getParkHalf();
    const inside = (x, y, z, lim) => { _p.set(x, y, z).project(cam); return Math.abs(_p.x) < lim && Math.abs(_p.y) < lim; };
    let cost = Infinity;
    for (let k = 1; k <= 1.8; k += 0.05) {
      for (let s = 0; s <= 0.85; s += 0.05) {
        place(s, k);
        const ok = inside(focus.u, 0, focus.v, 0.62) && inside(focus.u, 26, focus.v, 0.62)   // the arch, base and top, well inside the picture
                && inside(-half, 0, -half, 0.95);                                           // … with the far corner still on screen
        const c = (k - 1) * 3 + s;
        if (ok && c < cost) { cost = c; best = { s, k }; }
      }
    }
  }
  const target = place(best.s, best.k);
  return { cam, target, distance: dist0 * best.k };
}

export function createCamera(renderer, focus = null) {
  const { cam, target, distance } = makeDefaultCamera(window.innerWidth / window.innerHeight, focus);
  const dist = Math.max(CAM_DIST * getParkScale(), distance);

  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = Math.PI / 6;
  controls.maxPolarAngle = Math.PI / 2.4;
  controls.target.copy(target);

  // Zoom toward the point under the cursor instead of the screen centre.
  controls.zoomToCursor = true;
  // Keep the camera from diving into the ground or drifting out of sight.
  controls.minDistance = 12;
  controls.maxDistance = dist * 2.4;   // (room for the camera tour, which backs off to see more of the park)

  window.addEventListener('resize', () => {
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { cam, controls };
}
