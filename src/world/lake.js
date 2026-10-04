/**
 * lake.js — the park's lake: a real basin in the terrain plus a water shader.
 *
 * Shape: an ellipse with an organic, lobed shoreline. `getLakeBedOffset(u, v)` is
 * the basin profile (≤ 0, added to the terrain height by terrain.js), so the ground
 * mesh itself dips into a bowl with sloping banks. The water is a flat plane at
 * WATER_Y; where the bed is above that level there is no water, so the shoreline
 * falls out of the terrain instead of being drawn on.
 *
 * Water look (stylised, cheap): colour from turquoise shallows to deep blue by
 * depth (baked into a small texture from the real terrain), the bed showing through
 * the shallows, two layers of scrolling ripples, fresnel sky reflection, a sun/moon
 * glint and a foam line along the shore. Lighting follows the day cycle via
 * `setWaterLight()`.
 *
 * Call order: setLake() before terrain/ground use getLakeBedOffset; buildWater()
 * once the terrain is final (it samples the heightfield).
 */

import * as THREE from 'three';
import { SEED, LAKE_SHALLOW_COLOR, LAKE_DEEP_COLOR, LAKE_FOAM_COLOR, DUCK_COUNT } from '@/config.js';

const MAX_RIPPLES = Math.max(1, DUCK_COUNT); // ducks that ring the water (see setWaterRipple)
const RIPPLE_REACH = 5.0;                    // how far a duck's rings spread
const TRAIL_N = 14;                          // wake marks kept per duck (a ring buffer)
const TRAIL_LIFE = 4.0;                      // seconds a mark takes to spread and fade
const TRAIL_REACH = 2.6;                     // how big a mark grows
export const TRAIL_EVERY = TRAIL_LIFE / TRAIL_N; // a swimming duck leaves a mark this often
import { mulberry32 } from '@/utils/prng.js';

// ── Basin shape ───────────────────────────────────────────────────────────────

export const WATER_Y    = -0.35;  // water surface (just below the surrounding grass at y = 0)
const LAKE_DEPTH        = 3.0;    // bed depth at the centre (below y = 0)
const BANK_EXTENT       = 1.3;    // basin influence reaches this many (wobbled) radii from the centre

let _lake = null; // { x, z, rx, rz, a: [..], p: [..] }

function _smooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

/** Wobbled radius factor in direction θ: how much the shoreline bulges (>1) or pinches (<1). */
function _wobble(theta) {
  const { a, p } = _lake;
  return 1 + a[0] * Math.sin(2 * theta + p[0]) + a[1] * Math.sin(3 * theta + p[1]) + a[2] * Math.sin(5 * theta + p[2]);
}

/**
 * Register the lake (from findLakePosition) or clear it with null.
 * The shoreline wobble is seeded, so the same seed gives the same lake.
 */
export function setLake(lakePos) {
  if (!lakePos) { _lake = null; return; }
  const rand = mulberry32(SEED ^ 0x1a4e);
  _lake = {
    ...lakePos,
    a: [0.07 + rand() * 0.04, 0.05 + rand() * 0.04, 0.02 + rand() * 0.03],
    p: [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2],
  };
}

export function getLake() { return _lake; }

/** Basin profile at (u, v): 0 outside the lake's banks, down to -LAKE_DEPTH at the centre. */
export function getLakeBedOffset(u, v) {
  if (!_lake) return 0;
  const nx = (u - _lake.x) / _lake.rx, nz = (v - _lake.z) / _lake.rz;
  const r = Math.hypot(nx, nz);
  if (r > BANK_EXTENT * 1.2) return 0;                 // cheap reject
  const q = r / _wobble(Math.atan2(nz, nx));
  return -LAKE_DEPTH * (1 - _smooth01(q / BANK_EXTENT));
}

/** Basin radius (in wobbled radii) at which the bed meets the water level. */
function _waterlineQ() {
  // bed(q) = -DEPTH * (1 - smooth(q / EXTENT)) = WATER_Y  →  solve by bisection
  let lo = 0, hi = BANK_EXTENT;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const bed = -LAKE_DEPTH * (1 - _smooth01(mid / BANK_EXTENT));
    if (bed < WATER_Y) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A point on the shoreline in direction `angle`, `inset` normalised radii inside it
 * (negative = outside, on the bank). Used to place reeds on the real waterline.
 * @returns {{ x: number, z: number } | null}
 */
export function shorePoint(angle, inset = 0) {
  if (!_lake) return null;
  const t = _waterlineQ() * _wobble(angle) - inset;
  return { x: _lake.x + Math.cos(angle) * t * _lake.rx, z: _lake.z + Math.sin(angle) * t * _lake.rz };
}

/** Outer ellipse (centre + radii) that contains the lake and its sandy banks, for obstacle registration. */
export function getLakeFootprint() {
  if (!_lake) return null;
  const k = BANK_EXTENT * (1 + _lake.a[0] + _lake.a[1] + _lake.a[2]) * 0.9;
  return { x: _lake.x, z: _lake.z, rx: _lake.rx * k, rz: _lake.rz * k };
}

// ── Water surface ─────────────────────────────────────────────────────────────

const TEX_STEP   = 1.5;   // world units per depth-texture texel
const DEPTH_SPAN = 5.0;   // texture encodes water depth from -1 … +4 (world units)

const VERT = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D uDepthTex;
  uniform vec2  uOrigin;      // world x/z of the texture's corner
  uniform vec2  uSize;        // world size covered by the texture
  uniform float uTime;
  uniform vec3  uShallow, uDeep, uFoam;
  uniform vec3  uLightDir;    // unit vector toward the sun (or moon)
  uniform vec3  uLightColor;  // colour * intensity of the direct light (for the glint)
  uniform vec3  uSkyColor;
  uniform float uLight;       // overall light level, matched to the Lambert-lit ground
  uniform vec4  uRipples[${MAX_RIPPLES}];  // per duck: x, z, phase, strength of its still-water rings (0–1)
  uniform vec4  uTrail[${MAX_RIPPLES * TRAIL_N}];  // wake marks: x, z, birth time (uTime), strength
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  void main() {
    vec2 uv = (vWorld.xz - uOrigin) / uSize;
    float depth = texture2D(uDepthTex, uv).r * ${DEPTH_SPAN.toFixed(1)} - 1.0; // metres of water
    if (depth <= 0.0) discard;

    // Ripples: two scrolling noise layers, used as a slope perturbation.
    vec2 p = vWorld.xz;
    vec2 a = vec2(vnoise(p * 0.30 + vec2(uTime * 0.18, uTime * 0.11)),
                  vnoise(p * 0.30 + vec2(-uTime * 0.14, uTime * 0.16) + 17.0)) - 0.5;
    vec2 b = vec2(vnoise(p * 1.10 + vec2(-uTime * 0.40, uTime * 0.22) + 5.0),
                  vnoise(p * 1.10 + vec2(uTime * 0.32, -uTime * 0.27) + 31.0)) - 0.5;
    vec2 slope = vec2(a.x * 0.55 + b.x * 0.30, a.y * 0.55 + b.y * 0.30);

    // Rings spreading from each duck: three rings, each growing outwards and fading, tilting the surface (the slope
    // is odd across a ring: outwards on its leading edge, inwards behind it).
    float ringLight = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 dk = uRipples[i];                 // w = how strong the still-water rings are (1 at rest, fading out as the duck swims)
      if (dk.w < 0.02) continue;
      vec2 dv = p - dk.xy;
      float d = length(dv);
      if (d > ${RIPPLE_REACH.toFixed(1)} + 1.0) continue;
      vec2 dir = dv / max(d, 0.001);
      for (int k = 0; k < 3; k++) {
        float age = fract(uTime * 0.28 + dk.z + float(k) / 3.0);          // 0 (just left the duck) … 1 (gone)
        float r = 0.7 + age * ${RIPPLE_REACH.toFixed(1)};
        float x = (d - r) * 2.4;
        float ring = exp(-x * x) * (1.0 - age) * smoothstep(0.5, 1.2, d) * dk.w;
        slope += dir * x * ring * 0.5;
        ringLight += ring;
      }
    }

    // The wake: every so often a swimming duck leaves a mark where it was; each grows into a small ring and fades, and
    // together they make the V of a trail behind it that bends when the duck turns. Marks of a duck that has stopped
    // simply die out while its still-water rings come back.
    for (int i = 0; i < ${MAX_RIPPLES * TRAIL_N}; i++) {
      vec4 tr = uTrail[i];                   // x, z, birth time, strength
      if (tr.w < 0.02) continue;
      float age = (uTime - tr.z) / ${TRAIL_LIFE.toFixed(1)};
      if (age < 0.0 || age > 1.0) continue;
      vec2 dv = p - tr.xy;
      float d = length(dv);
      if (d > ${TRAIL_REACH.toFixed(1)} + 1.0) continue;
      vec2 dir = dv / max(d, 0.001);
      float r = 0.25 + age * ${TRAIL_REACH.toFixed(1)};
      float x = (d - r) * 2.8;
      float ring = exp(-x * x) * (1.0 - age) * (1.0 - age) * tr.w;
      float core = exp(-d * d * 2.5) * (1.0 - age) * tr.w;      // a little foam right behind the duck
      slope += dir * x * ring * 0.55;
      ringLight += ring * 0.8 + core * 0.3;
    }
    vec3 N = normalize(vec3(slope.x, 1.0, slope.y));

    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uLightDir);

    // Body colour: shallows → deep, lit like the ground.
    vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 2.6, depth)) * uLight;

    // Sky reflection (fresnel) — stronger at grazing angles. The sky colour is
    // desaturated first: a saturated dawn/dusk orange would turn the water muddy.
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 sky = mix(uSkyColor, vec3(dot(uSkyColor, vec3(0.333))), 0.6);
    col = mix(col, sky * (0.35 + uLight), clamp(fres * 0.5 + 0.05, 0.0, 0.6));

    // Sun / moon glint: small, sharp highlights.
    vec3 R = reflect(-L, N);
    float spec = pow(max(dot(R, V), 0.0), 220.0);
    col += uLightColor * spec * 0.7;

    // The rings catch a little sky light.
    col = mix(col, sky * (0.45 + uLight), clamp(ringLight * 0.22, 0.0, 0.35));

    // Foam along the shore, broken up by noise and drifting slowly.
    float edge = depth + (vnoise(p * 0.9 + uTime * 0.05) - 0.5) * 0.22;
    float foam = (1.0 - smoothstep(0.03, 0.30, edge)) * (0.55 + 0.45 * vnoise(p * 2.4 + uTime * 0.15));
    col = mix(col, uFoam * (0.4 + uLight), foam);

    // Shallows are see-through (the sandy bed shows); deep water is nearly opaque.
    float alpha = mix(0.40, 0.94, smoothstep(0.0, 1.6, depth));
    alpha = max(alpha, foam * 0.9) * smoothstep(0.0, 0.05, depth);

    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

let _water = null; // { mesh, material }

/**
 * Bake the bed depth into a texture from the real terrain height function and add
 * the water plane. No-op when there is no lake.
 *
 * @param {THREE.Scene} scene
 * @param {(u: number, v: number) => number} heightAt — terrain height (getTerrainHeight)
 */
export function buildWater(scene, heightAt) {
  if (!_lake) return null;

  // Texture covers the lake plus its banks (waterline is at most ~1.5 radii out).
  const hx = _lake.rx * 1.6, hz = _lake.rz * 1.6;
  const w = Math.ceil((hx * 2) / TEX_STEP), h = Math.ceil((hz * 2) / TEX_STEP);
  const data = new Uint8Array(w * h);
  const x0 = _lake.x - hx, z0 = _lake.z - hz;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const x = x0 + ((col + 0.5) / w) * hx * 2;
      const z = z0 + ((row + 0.5) / h) * hz * 2;
      const depth = WATER_Y - heightAt(x, z);              // + below the water surface
      data[row * w + col] = Math.round(Math.min(Math.max((depth + 1) / DEPTH_SPAN, 0), 1) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uDepthTex:   { value: tex },
      uOrigin:     { value: new THREE.Vector2(x0, z0) },
      uSize:       { value: new THREE.Vector2(hx * 2, hz * 2) },
      uTime:       { value: 0 },
      uShallow:    { value: new THREE.Color(LAKE_SHALLOW_COLOR) },
      uDeep:       { value: new THREE.Color(LAKE_DEEP_COLOR) },
      uFoam:       { value: new THREE.Color(LAKE_FOAM_COLOR) },
      uLightDir:   { value: new THREE.Vector3(0.3, 0.8, -0.4).normalize() },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uSkyColor:   { value: new THREE.Color(0x87ceeb) },
      uLight:      { value: 0.5 },
      uRipples:    { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uTrail:      { value: Array.from({ length: MAX_RIPPLES * TRAIL_N }, () => new THREE.Vector4(0, 0, 0, 0)) },
    },
  });

  const geo = new THREE.PlaneGeometry(hx * 2, hz * 2);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(_lake.x, WATER_Y, _lake.z);
  mesh.renderOrder = 1;           // after opaque ground; before UI sprites
  mesh.receiveShadow = false;
  scene.add(mesh);

  _water = { mesh, material };
  return _water;
}

/**
 * Put rings round duck number `i` (0 ≤ i < DUCK_COUNT) at world (x, z); `phase` (0–1) offsets its rings from the
 * others', `strength` (0–1) is how visible they are (a swimming duck has none: it has a wake instead, see setWaterTrail).
 */
export function setWaterRipple(i, x, z, phase = 0, strength = 1) {
  const r = _water?.material.uniforms.uRipples.value[i];
  if (r) r.set(x, z, phase, strength);
}

const _trailHead = new Array(MAX_RIPPLES).fill(0);

/** Leave a wake mark for duck `i` at (x, z) (call every TRAIL_EVERY seconds while it swims); strength 0–1. */
export function setWaterTrail(i, x, z, strength = 1) {
  if (!_water) return;
  const list = _water.material.uniforms.uTrail.value;
  const k = _trailHead[i] = (_trailHead[i] + 1) % TRAIL_N;
  list[i * TRAIL_N + k].set(x, z, _water.material.uniforms.uTime.value, strength);
}

/** Advance the ripple animation. */
export function updateWater(dt) {
  if (_water) _water.material.uniforms.uTime.value += dt;
}

/**
 * Feed the day cycle's lighting to the water.
 * @param {THREE.Vector3} lightDir   unit vector toward the sun (or moon at night)
 * @param {THREE.Color}   lightColor colour × intensity of that light
 * @param {THREE.Color}   skyColor   current sky/background colour
 * @param {number}        level      overall light level (ambient + sun contribution)
 */
export function setWaterLight(lightDir, lightColor, skyColor, level) {
  if (!_water) return;
  const u = _water.material.uniforms;
  u.uLightDir.value.copy(lightDir);
  u.uLightColor.value.copy(lightColor);
  u.uSkyColor.value.copy(skyColor);
  u.uLight.value = level;
}
