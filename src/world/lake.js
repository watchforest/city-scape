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
import { SEED, LAKE_SHALLOW_COLOR, LAKE_DEEP_COLOR, LAKE_FOAM_COLOR } from '@/config.js';
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
    vec3 N = normalize(vec3(a.x * 0.55 + b.x * 0.30, 1.0, a.y * 0.55 + b.y * 0.30));

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
