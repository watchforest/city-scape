/**
 * Gradient sky dome: a pale, hazy colour at the horizon deepening towards the zenith.
 *
 * Drawn as a huge back-faced sphere that ignores depth, so it sits behind everything.
 * DayCycle feeds it the two colours via setSkyColors().
 */

import * as THREE from 'three';

const _uniforms = {
  horizon: { value: new THREE.Color(0x9fd6f2) },
  zenith:  { value: new THREE.Color(0x4f9fd8) },
};

export function buildSky(scene) {
  const mat = new THREE.ShaderMaterial({
    uniforms: _uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 zenith;
      varying vec3 vDir;
      void main() {
        float t = smoothstep(-0.05, 0.75, vDir.y);
        gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12), mat);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);
}

export function setSkyColors(horizon, zenith) {
  _uniforms.horizon.value.copy(horizon);
  _uniforms.zenith.value.copy(zenith);
}
