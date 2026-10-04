/**
 * Clouds — soft, diffuse puffs drifting across the sky.
 *
 * Each cloud is a handful of camera-facing quads (one InstancedMesh for all of them). The fragment shader
 * turns each quad into a puff: a radial falloff whose edge is broken up with slowly moving fbm noise, shaded
 * lighter on top and darker underneath. The colours come from DayCycle (setCloudLight): warm at dusk, grey-blue
 * at night.
 *
 * A cloud crosses the diorama once: it appears just beyond the left end, fades in as it reaches the edge of the
 * map, drifts along +X, and fades out across the right edge until it is gone just beyond it. Then it waits a random
 * while and enters again from the left as a different cloud (new size, breadth, height, speed and lane). The fades
 * depend only on where the cloud is, never on a timer.
 */

import * as THREE from 'three';
import { CLOUD_COLOR } from '@/config.js';
import { getParkHalf } from './parkBounds.js';

const CLOUD_COUNT   = 3;
const SLOTS         = 36;          // puff slots per cloud (a smaller cloud uses fewer)
const CLOUD_SPEED   = [3, 7];      // units/sec in +X direction (per cloud)
const CLOUD_SIZE    = [1.5, 2.6];  // size multiplier: all of them big, a few big clouds rather than many small ones
const CLOUD_LENGTH  = [1.2, 1.6];  // half-length of a cloud's long axis relative to its size …
const CLOUD_ASPECT  = [0.4, 0.62]; // … and its short axis as a fraction of that: oblong (long ≈ 1.6–2.5× the short), neither round nor a streak
const CLOUD_HEIGHT  = [105, 175];
const CLOUD_WAIT    = [5, 70];     // seconds a cloud that has left waits before entering again
const FADE_REACH    = 60;          // the fades happen within this distance inside the map's left and right edges; beyond them, the cloud's own half-width (a big cloud starts and ends further out)
const CLOUD_OPACITY = 0.38; // per puff: a big cloud stacks a few dozen of them, so it must stay low to keep the map readable through it

const _clouds = [];
let _mesh = null;
let _puffAttr = null; // per puff: x = seed, y = fade
let _half = 0;
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
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * (Re)create a cloud at the left end of the map: a new lane, size, breadth, height and speed, and a new layout of
 * its puffs. Only done while the cloud is invisible, so nothing visibly changes. `scatter` places it somewhere
 * along the way instead (used once at the start, so the sky is not empty).
 */
function spawnCloud(c, scatter) {
  const size = logUniform(CLOUD_SIZE);
  const major = 30 * size * lerpRange(CLOUD_LENGTH, _rand());  // half-length of the long axis …
  const minor = major * lerpRange(CLOUD_ASPECT, _rand());       // … and of the short one
  const turn = _rand() * Math.PI;                                // which way the long axis points (any direction)
  const cosT = Math.cos(turn), sinT = Math.sin(turn);
  // A big cloud is wide: it enters from, and leaves to, a point as far outside the map as its own half-width plus
  // the fade reach, so it is invisible while it is still wholly beyond the edge and gone once wholly past the other.
  c.reach = FADE_REACH + major;
  c.x = scatter ? lerpRange([-_half - c.reach, _half + c.reach], _rand()) : -_half - c.reach;
  c.y = lerpRange(CLOUD_HEIGHT, _rand());
  c.z = (_rand() * 2 - 1) * _half * 0.9;
  c.speed = lerpRange(CLOUD_SPEED, _rand());
  c.wait = 0;
  c.fade = 0;

  // A filled ellipse of puffs (golden-angle spiral, jittered), bigger puffs in the middle; more puffs for a bigger cloud.
  const sizeT = (size - CLOUD_SIZE[0]) / (CLOUD_SIZE[1] - CLOUD_SIZE[0]);
  const n = Math.min(SLOTS, Math.round(22 + sizeT * 10 + _rand() * 3));
  const puffScale = Math.min(1.35, Math.max(1.0, minor / (20 * size))); // puffs wide enough to fill the short axis, so no gaps
  for (let k = 0; k < SLOTS; k++) {
    const p = c.puffs[k];
    if (k >= n) { p.size = 0; continue; }
    const r = Math.sqrt((k + 0.5) / n), a = k * 2.39996 + _rand() * 0.5;
    const body = 1 - r * 0.45;
    // A point of the ellipse (long axis `major`, short axis `minor`), then turned by `turn`.
    const ex = Math.cos(a) * r * major + (_rand() - 0.5) * 6 * size;
    const ez = Math.sin(a) * r * minor + (_rand() - 0.5) * 6 * size;
    p.ox = ex * cosT - ez * sinT;
    p.oz = ex * sinT + ez * cosT;
    p.oy = (_rand() - 0.3) * 6 * body * size;
    p.size = (22 + _rand() * 16) * body * size * puffScale;
    p.seed = _rand();
    _puffAttr.array[(c.index * SLOTS + k) * 2] = p.seed;
  }
  _puffAttr.needsUpdate = true;
}

export function buildClouds(scene, rand) {
  _rand = rand;
  _half = getParkHalf();

  const geo = new THREE.PlaneGeometry(1, 1);
  _puffAttr = new THREE.InstancedBufferAttribute(new Float32Array(CLOUD_COUNT * SLOTS * 2), 2);
  _puffAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPuff', _puffAttr);

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

export function updateClouds(dt) {
  if (!_mesh) return;
  _uniforms.uTime.value += dt;
  const data = _puffAttr.array;

  for (const c of _clouds) {
    if (c.wait > 0) {
      // Left the map: wait a random while, then enter again from the left as a different cloud.
      c.wait -= dt;
      if (c.wait <= 0) spawnCloud(c, false);
    } else {
      c.x += c.speed * dt;
      // In across the left edge, out across the right edge; fully visible in between.
      c.fade = smooth(-_half - c.reach, -_half + FADE_REACH, c.x) * (1 - smooth(_half - FADE_REACH, _half + c.reach, c.x));
      if (c.x >= _half + c.reach) { c.fade = 0; c.wait = lerpRange(CLOUD_WAIT, _rand()); }
    }

    for (let k = 0; k < SLOTS; k++) {
      const p = c.puffs[k], i = c.index * SLOTS + k;
      const visible = c.fade > 0 && p.size > 0;
      const size = visible ? p.size : 0;
      _p.set(c.x + p.ox, c.y + p.oy, c.z + p.oz);
      _s.set(size, size, size);
      _mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      data[i * 2 + 1] = visible ? c.fade : 0;
    }
  }
  _mesh.instanceMatrix.needsUpdate = true;
  _puffAttr.needsUpdate = true;
}

/** Debug aid (console / tests): where each cloud is and how visible it is. */
export function cloudState() {
  return _clouds.map(c => ({ x: +c.x.toFixed(0), z: +c.z.toFixed(0), y: +c.y.toFixed(0), fade: +c.fade.toFixed(2), waiting: c.wait > 0 }));
}

/** Light the clouds (called by DayCycle): `lit` for the sunny tops, `shade` for the undersides. */
export function setCloudLight(lit, shade) {
  _uniforms.uLit.value.copy(lit);
  _uniforms.uShade.value.copy(shade);
}
