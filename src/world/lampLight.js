/**
 * Lamp light without lights.
 *
 * Real PointLights per lamp post would mean dozens of lights in every Lambert fragment shader. Instead the light is
 * a small top-down texture: every lamp is painted as a warm radial blob (`bakeLampLight`, once, after the lamps are
 * placed), and `applyLampLight(material)` patches a material so that its fragments look the texture up by world X/Z
 * and add that light, tinted by their own colour, scaled by the night factor (`setLampNight`, fed by DayCycle).
 * One texture fetch per fragment, any number of lamps. The ground, plants, benches, agents and landmarks all use it,
 * so the pool of light around a lamp climbs up the trunks and benches instead of being a flat disc on the ground.
 */

import * as THREE from 'three';
import { getParkHalf } from './parkBounds.js';
import { LAMP_LIGHT } from '@/config.js';

const _uniforms = {
  lampMap:   { value: null },
  lampMin:   { value: new THREE.Vector2() },
  lampSize:  { value: 1 },
  lampNight: { value: 0 },
};

/** Paint every lamp (`[{ x, z }]`) into the light texture. */
export function bakeLampLight(lamps) {
  const side = getParkHalf() * 2;
  const res = Math.min(2048, Math.max(256, Math.round(side / LAMP_LIGHT.texel)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = res;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, res, res);
  ctx.globalCompositeOperation = 'lighter';       // overlapping pools add up
  const k = res / side, rad = LAMP_LIGHT.radius * k;
  for (const { x, z } of lamps) {
    const cx = (x + side / 2) * k, cy = (z + side / 2) * k;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    // Smooth, quickly fading skirt: bright warm core, long soft tail.
    g.addColorStop(0.00, 'rgba(255,205,125,1)');
    g.addColorStop(0.15, 'rgba(255,190,105,0.72)');
    g.addColorStop(0.40, 'rgba(235,150,70,0.30)');
    g.addColorStop(0.70, 'rgba(190,105,45,0.08)');
    g.addColorStop(1.00, 'rgba(150,80,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;                               // canvas row 0 = world z min, like uv.y = 0
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  _uniforms.lampMap.value?.dispose();
  _uniforms.lampMap.value = tex;
  _uniforms.lampMin.value.set(-side / 2, -side / 2);
  _uniforms.lampSize.value = side;
}

/** 0 (lamps off) … 1 (fully on). */
export function setLampNight(t) {
  _uniforms.lampNight.value = t;
}

/**
 * Make `material` pick up the lamp light. `strength` scales it for this material (ground 1, things standing up less,
 * since the light comes from above and the texture knows nothing about height).
 * Call after any other `onBeforeCompile` has been set on the material: this wraps it.
 */
export function applyLampLight(material, strength = 1) {
  if (material.userData.lampLit) return material; // (cloned models share their materials)
  material.userData.lampLit = true;
  const prev = material.onBeforeCompile;
  const own = { value: strength };
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, _uniforms, { lampStrength: own });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLampXZ;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          vec4 lw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            lw = instanceMatrix * lw;
          #endif
          vLampXZ = (modelMatrix * lw).xz;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vLampXZ;
        uniform sampler2D lampMap;
        uniform vec2 lampMin;
        uniform float lampSize;
        uniform float lampNight;
        uniform float lampStrength;`)
      .replace('#include <opaque_fragment>', `
        if (lampNight > 0.001) {
          vec3 lampGlow = texture2D(lampMap, (vLampXZ - lampMin) / lampSize).rgb;
          outgoingLight += (diffuseColor.rgb * 0.8 + 0.06) * lampGlow * lampNight * lampStrength * ${LAMP_LIGHT.gain.toFixed(2)};
        }
        #include <opaque_fragment>`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (key ? key() : '') + '|lamp';
  material.needsUpdate = true;
  return material;
}
