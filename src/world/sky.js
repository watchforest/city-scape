/**
 * Gradient sky dome: a bright haze at the horizon, a softer middle band and a deeper zenith, with a soft glow round the sun.
 *
 * Drawn as a huge back-faced sphere that ignores depth, so it sits behind everything.
 * DayCycle feeds it the colours and the sun via setSkyColors() / setSkySun().
 */

import * as THREE from 'three';

const _uniforms = {
  horizon:  { value: new THREE.Color(0x9fd6f2) },
  zenith:   { value: new THREE.Color(0x4f9fd8) },
  sunDir:   { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color(0xfff0d0) },
  sunGlow:  { value: 0 },
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
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform float sunGlow;
      varying vec3 vDir;

      // Tiny per-pixel noise so the long, shallow gradient doesn't band.
      float dither(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))) - 0.5; }

      void main() {
        // The view ray from the camera through this pixel (the camera is well off-centre, so the dome's own direction
        // from the origin would be wrong). From the usual high viewpoint the whole visible sky lies *below* the true
        // horizon (the park's far edge sits above it on screen), so the gradient starts a little below it.
        vec3 dir = normalize(vDir * 1500.0 - cameraPosition);
        float h = max(dir.y + 0.36, 0.0);
        // Three stops: horizon haze → a middle band (horizon and zenith blended, a little more saturated) → zenith.
        vec3 mid = mix(horizon, zenith, 0.55);
        mid = mix(vec3(dot(mid, vec3(0.333))), mid, 1.12);
        // The camera looks down on the park, so only the lowest sliver of the sky (up to ~0.2 above the horizon) is ever
        // on screen: the whole gradient is squeezed into that range.
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, zenith, smoothstep(0.1, 0.55, h));
        // Haze hugging the horizon, paler than the sky above it.
        col = mix(col, horizon * 1.1 + 0.03, exp(-h * 14.0) * 0.5);
        // Soft sun glow: a wide warm halo and a tighter, brighter one.
        float d = max(dot(dir, normalize(sunDir)), 0.0);   // (sunDir is a direction, the same from everywhere)
        col += sunColor * (pow(d, 6.0) * 0.22 + pow(d, 48.0) * 0.5) * sunGlow;
        col += dither(gl_FragCoord.xy) / 255.0;
        gl_FragColor = vec4(col, 1.0);
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

/** Where the sun is (vector from the park towards it), its colour, and how strong the glow is (0 = none). */
export function setSkySun(x, y, z, color, glow) {
  _uniforms.sunDir.value.set(x, y, z).normalize();
  _uniforms.sunColor.value.copy(color);
  _uniforms.sunGlow.value = glow;
}
