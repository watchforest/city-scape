import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FRUSTUM_SIZE, CAM_DIST, ISO_ELEVATION } from '@/config.js';

export function createCamera(renderer) {
  const aspect = window.innerWidth / window.innerHeight;
  const cam = new THREE.OrthographicCamera(
    -FRUSTUM_SIZE * aspect / 2,
     FRUSTUM_SIZE * aspect / 2,
     FRUSTUM_SIZE / 2,
    -FRUSTUM_SIZE / 2,
    0.1, 2000
  );

  cam.position.set(
    CAM_DIST * Math.cos(ISO_ELEVATION) * Math.sin(Math.PI / 4),
    CAM_DIST * Math.sin(ISO_ELEVATION),
    CAM_DIST * Math.cos(ISO_ELEVATION) * Math.cos(Math.PI / 4)
  );
  cam.lookAt(0, 0, 0);

  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = Math.PI / 6;
  controls.maxPolarAngle = Math.PI / 2.4;
  controls.target.set(0, 0, 0);

  window.addEventListener('resize', () => {
    const a = window.innerWidth / window.innerHeight;
    cam.left   = -FRUSTUM_SIZE * a / 2;
    cam.right  =  FRUSTUM_SIZE * a / 2;
    cam.top    =  FRUSTUM_SIZE / 2;
    cam.bottom = -FRUSTUM_SIZE / 2;
    cam.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { cam, controls };
}
