/**
 * Clouds — soft, diffuse puffs drifting across the sky.
 *
 * Each cloud is a handful of camera-facing quads (one InstancedMesh for all of them). The fragment shader
 * turns each quad into a puff: a radial falloff whose edge is broken up with slowly moving fbm noise, shaded
 * lighter on top and darker underneath. The colours come from DayCycle (setCloudLight): warm at dusk, grey-blue
 * at night.
 *
 * Clouds have a life: each one appears at a random place with a random size, shape, height and speed,
 * fades in, drifts along +X, fades out, waits a random while and then appears somewhere else, as a different
 * cloud. They also fade out towards the far edge of the sky, so none ever pops in or out.
 */

import * as THREE from 'three';
import { CLOUD_COLOR } from '@/config.js';
import { getParkHalf } from './parkBounds.js';

const CLOUD_COUNT   = 7;
const SLOTS         = 22;          // puff slots per cloud (a small, narrow cloud uses far fewer than a big, broad one)
const CLOUD_SPEED   = [3, 9];      // units/sec in +X direction (per cloud)
const CLOUD_SIZE    = [0.45, 1.5]; // size multiplier, drawn log-uniformly: many small clouds, a few big ones
const CLOUD_STRETCH = [0.9, 2.1];  // how elongated along X (the drift direction) a cloud is
const CLOUD_DEPTH   = [0.9, 2.3];  // how far its puffs spread across Z: low = a narrow streak, high = a broad bank
const CLOUD_HEIGHT  = [105, 175];
const CLOUD_LIFE    = [70, 170];   // seconds from appearing to gone
const CLOUD_FADE    = [10, 22];    // seconds to fade in, and the same to fade out
const CLOUD_WAIT    = [0, 35];     // seconds a dead cloud waits before reappearing
const EDGE_FADE     = 170;         // clouds also fade out over this distance towards the edge of the drift range
const EDGE_MARGIN   = 200;         // the drift range reaches this far beyond the park edge (fully faded there)
const CLOUD_OPACITY = 0.6;

const _clouds = [];
let _mesh = null;
let _fadeAttr = null;
let _seedAttr = null;
let _edge = 0;
let _parkHalf = 0;
let _rand = Math.random;

const _uniforms = {
  uLit:     { value: new THREE.Color(CLOUD_COLOR) },
  uShade:   { value: new THREE.Color(0xaab6c8) },
  uTime:    { value: 0 },
  uOpacity: { value: CLOUD_OPACITY },
};

const VERT = /* glsl */`
  attribute vec2 aPuff;   // x: seed, y: fade (0..1)
  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;
  void main() {
    // Billboard: take the puff centre into view space, then offset the quad corner there.
    vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float size = length(vec3(instanceMatrix[0]));
    vec4 mv = centre + vec4(position.xy * size, 0.0, 0.0);
    vUv = position.xy * 2.0;
    vSeed = aPuff.x;
    vFade = aPuff.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 p = vUv;
    float r = length(p);
    if (r > 1.0) discard;
    // Slowly billowing, noise-broken edge.
    float n = fbm(p * 1.7 + vec2(vSeed * 9.0, vSeed * 5.0) + uTime * 0.03);
    float d = r + (n - 0.5) * 0.75;
    float alpha = smoothstep(0.95, 0.05, d) * vFade * uOpacity;
    if (alpha < 0.004) discard;
    // Light from above: bright crowns, shadowed underside, with the noise breaking it up.
    float lit = clamp(0.38 + p.y * 0.6 + (n - 0.5) * 0.8 - r * 0.2, 0.0, 1.0);
    vec3 col = mix(uShade, uLit, lit);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

const lerpRange = ([a, b], t) => a + (b - a) * t;
const logUniform = ([a, b]) => a * Math.pow(b / a, _rand());

/**
 * (Re)create a cloud: a new place, size, shape, height, speed and lifespan, and a new layout of its puffs.
 * Called while the cloud is invisible, so nothing visibly changes. `initial` also scatters the age, so the
 * first clouds are not all at the same point of their life.
 */
function spawnCloud(c, initial) {
  const size = logUniform(CLOUD_SIZE);
  const stretch = lerpRange(CLOUD_STRETCH, _rand());
  const depth = logUniform(CLOUD_DEPTH);
  c.x = lerpRange([-(_parkHalf + 60), _parkHalf * 0.7], _rand()); // anywhere, most with room to drift
  c.y = lerpRange(CLOUD_HEIGHT, _rand());
  c.z = (_rand() * 2 - 1) * _parkHalf * 1.05;
  c.speed = lerpRange(CLOUD_SPEED, _rand());
  c.life = lerpRange(CLOUD_LIFE, _rand());
  c.fadeT = Math.min(lerpRange(CLOUD_FADE, _rand()), c.life / 3);
  c.age = initial ? _rand() * c.life : 0;
  c.wait = 0;
  c.fade = 0;

  // Small clouds are a few puffs, big ones a dozen.
  const sizeT = (size - CLOUD_SIZE[0]) / (CLOUD_SIZE[1] - CLOUD_SIZE[0]);
  // More puffs for a bigger, longer or broader cloud, so the extra area stays filled in.
  const n = Math.min(SLOTS, Math.max(3, Math.round(3 + sizeT * 7 + (stretch - 0.9) * 2.5 + (depth - 0.9) * 3.5 + _rand() * 2)));
  for (let k = 0; k < SLOTS; k++) {
    const p = c.puffs[k];
    if (k >= n) { p.size = 0; continue; }
    const t = n === 1 ? 0 : (k / (n - 1)) * 2 - 1;        // −1 … 1 along the cloud
    const body = 1 - Math.abs(t) * 0.55;                  // bigger puffs towards the middle
    p.ox = (t * 34 + (_rand() - 0.5) * 12) * size * stretch;
    p.oy = (_rand() - 0.3) * 6 * body * size;
    p.oz = (_rand() - 0.5) * 22 * body * size * depth;
    // Broad clouds get slightly larger puffs, so the wider spread stays filled in.
    p.size = (24 + _rand() * 18) * body * size * (0.95 + 0.25 * Math.min(depth, 2.2));
    p.seed = _rand();
    _seedAttr.array[(c.index * SLOTS + k) * 2] = p.seed;
  }
  _seedAttr.needsUpdate = true;
}

export function buildClouds(scene, rand) {
  _rand = rand;
  _parkHalf = getParkHalf();
  _edge = _parkHalf + EDGE_MARGIN;

  const geo = new THREE.PlaneGeometry(1, 1);
  _seedAttr = _fadeAttr = new THREE.InstancedBufferAttribute(new Float32Array(CLOUD_COUNT * SLOTS * 2), 2); // x: seed, y: fade
  _fadeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPuff', _fadeAttr);

  for (let i = 0; i < CLOUD_COUNT; i++) {
    const c = { index: i, puffs: Array.from({ length: SLOTS }, () => ({ ox: 0, oy: 0, oz: 0, size: 0, seed: 0 })) };
    _clouds.push(c);
    spawnCloud(c, true);
  }

  const mat = new THREE.ShaderMaterial({
    uniforms: _uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });

  _mesh = new THREE.InstancedMesh(geo, mat, CLOUD_COUNT * SLOTS);
  _mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  _mesh.frustumCulled = false; // the puffs move every frame; the static bounds would be wrong
  _mesh.renderOrder = 10;      // after the opaque scene
  scene.add(_mesh);
  updateClouds(0);
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function updateClouds(dt) {
  if (!_mesh) return;
  _uniforms.uTime.value += dt;
  const fadeData = _fadeAttr.array;

  for (const c of _clouds) {
    if (c.wait > 0) {
      // Dead: wait a random while, then come back as a different cloud.
      c.wait -= dt;
      if (c.wait <= 0) spawnCloud(c, false);
    } else {
      c.age += dt;
      c.x += c.speed * dt;
      const life = smooth(0, c.fadeT, c.age) * (1 - smooth(c.life - c.fadeT, c.life, c.age));
      const edge = smooth(-_edge, -_edge + EDGE_FADE, c.x) * (1 - smooth(_edge - EDGE_FADE, _edge, c.x));
      c.fade = life * edge;
      // Gone: its time is up, or it has drifted out of the sky (fully faded either way).
      if (c.age >= c.life || c.x > _edge) { c.fade = 0; c.wait = lerpRange(CLOUD_WAIT, _rand()) + 0.001; }
    }

    for (let k = 0; k < SLOTS; k++) {
      const p = c.puffs[k], i = c.index * SLOTS + k;
      const visible = c.fade > 0 && p.size > 0;
      const size = visible ? p.size : 0;
      _p.set(c.x + p.ox, c.y + p.oy, c.z + p.oz);
      _s.set(size, size, size);
      _mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      fadeData[i * 2 + 1] = visible ? c.fade : 0;
    }
  }
  _mesh.instanceMatrix.needsUpdate = true;
  _fadeAttr.needsUpdate = true;
}

/** Light the clouds (called by DayCycle): `lit` for the sunny tops, `shade` for the undersides. */
export function setCloudLight(lit, shade) {
  _uniforms.uLit.value.copy(lit);
  _uniforms.uShade.value.copy(shade);
}
