/**
 * Shared wind for everything that grows: trees, bushes, flowers and grass.
 *
 * `addWind(material, { height, amp })` patches an instanced Lambert material so the vertex shader bends it in the
 * wind: the further up the model, the more it moves (the foot stays put). The wind is one field in world space —
 * a slow wave that rolls across the park along `WIND_DIR`, with a faster flutter on top and the odd gust — so
 * neighbouring plants sway together instead of each wobbling on its own. Cost: a few sines per vertex, no extra passes.
 *
 * Call `updateWind(dt)` each frame. Materials must be used with an InstancedMesh.
 */

import * as THREE from 'three';
import { WIND_DIR } from '@/config.js';

const _time = { value: 0 };
const _dir = new THREE.Vector2(Math.cos(WIND_DIR), Math.sin(WIND_DIR));
const _dirU = { value: _dir };

/**
 * @param {THREE.Material} mat
 * @param {{ height?: number, amp?: number }} [opts]  height: model height in local units (the bend grows towards it);
 *   amp: how far the top moves, as a fraction of the plant's height
 */
export function addWind(mat, { height = 1, amp = 0.05 } = {}) {
  const prev = mat.onBeforeCompile;
  const uniforms = { uWindH: { value: height }, uWindAmp: { value: amp } };
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    _injectWind(shader, uniforms);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (key ? key() : '') + '|wind';
  mat.userData.wind = uniforms;

  // The sun's shadow pass draws with its own depth material, which must bend the same way or the shadows of
  // swaying plants would stay put: InstanceBatch hands this to its mesh as `customDepthMaterial`.
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = shader => _injectWind(shader, uniforms);
  depth.customProgramCacheKey = () => 'wind-depth';
  mat.userData.windDepth = depth;
  return mat;
}

/** Put the wind into a vertex shader (Lambert or depth) and hook up its uniforms. */
function _injectWind(shader, uniforms) {
  {
    shader.uniforms.uWindTime = _time;
    shader.uniforms.uWindDir = _dirU;
    shader.uniforms.uWindH = uniforms.uWindH;
    shader.uniforms.uWindAmp = uniforms.uWindAmp;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindH;
uniform float uWindAmp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 c0 = instanceMatrix[0].xyz, c1 = instanceMatrix[1].xyz, c2 = instanceMatrix[2].xyz;
  vec2 wp = instanceMatrix[3].xz;
  float along = dot(wp, uWindDir);
  // A slow swell rolling along the wind, a quicker flutter, and a gust now and then.
  float swell = sin(along * 0.035 - uWindTime * 0.9) * 0.6 + sin(along * 0.08 - uWindTime * 1.7 + wp.y * 0.02) * 0.4;
  float gust  = pow(max(0.0, sin(along * 0.012 - uWindTime * 0.35)), 3.0);
  float flutter = sin(uWindTime * 3.1 + wp.x * 0.7 + wp.y * 0.5) * 0.15 + sin(uWindTime * 4.7 + position.x * 2.0 + position.z * 2.0) * 0.05;
  float strength = 0.55 + 0.45 * swell + gust * 0.9;
  float w = clamp(position.y / uWindH, 0.0, 1.2);
  w *= w;                                    // stiff at the foot, loose at the top
  float bend = uWindAmp * uWindH * length(c1) * w;
  vec3 windWorld = vec3(uWindDir.x, 0.0, uWindDir.y) * (strength + flutter) * bend
                 + vec3(-uWindDir.y, 0.0, uWindDir.x) * flutter * bend * 0.6;
  // World-space push → the instance's local space (columns are orthogonal, so M⁻¹v = dot(col, v) / |col|²).
  transformed += vec3(dot(c0, windWorld) / dot(c0, c0), dot(c1, windWorld) / dot(c1, c1), dot(c2, windWorld) / dot(c2, c2));
  transformed.y -= length(windWorld) * 0.15 * w / max(length(c1), 0.001); // bending dips the tip a little
}
#endif`);
  }
}

export function updateWind(dt) {
  _time.value += dt;
}
