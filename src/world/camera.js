import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAM_DIST, ISO_ELEVATION } from '@/config.js';
import { getParkScale } from './parkBounds.js';

export const DEFAULT_FOV = 45;

export function createCamera(renderer) {
  const aspect = window.innerWidth / window.innerHeight;
  const cam = new THREE.PerspectiveCamera(DEFAULT_FOV, aspect, 1, 4000);

  // Start far enough back to frame the whole park, whatever its size.
  const dist = CAM_DIST * getParkScale();
  cam.position.set(
    dist * Math.cos(ISO_ELEVATION) * Math.sin(Math.PI / 4),
    dist * Math.sin(ISO_ELEVATION),
    dist * Math.cos(ISO_ELEVATION) * Math.cos(Math.PI / 4)
  );
  cam.lookAt(0, 0, 0);

  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = Math.PI / 6;
  controls.maxPolarAngle = Math.PI / 2.4;
  controls.target.set(0, 0, 0);

  // Zoom toward the point under the cursor instead of the screen centre.
  controls.zoomToCursor = true;
  // Keep the camera from diving into the ground or drifting out of sight.
  controls.minDistance = 12;
  controls.maxDistance = dist * 1.6;

  window.addEventListener('resize', () => {
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { cam, controls };
}
