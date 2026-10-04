import * as THREE from 'three';
import {
  GRASS_COLOR, GROUND_SIDE_COLOR, TERRAIN_MAX_HEIGHT, PATH_COLOR,
  CLOUD_SHADOW_STRENGTH, CLOUD_SHADOW_SCALE, CLOUD_SHADOW_SPEED, CREST_SHADE,
} from '@/config.js';
import { getTerrainHeight, getGroundVariation } from './terrain.js';
import { bakeContactShade } from './groundShade.js';
import { getParkHalf } from './parkBounds.js';
import { getLakeBedOffset } from './lake.js';

// Ground color palette — interpolated per vertex based on height + variation noise
// Low/wet: dark moss green → mid grass → high/dry: straw yellow
const COL_LOW  = new THREE.Color(0x3a6b2e); // dark moss
const COL_MID  = new THREE.Color(0x4a7c3f); // base grass
const COL_HIGH = new THREE.Color(0x7a8c4a); // dry hilltop
const COL_VAR  = new THREE.Color(0x6b7a32); // variation patch tint (subtle yellow-green)
const COL_SAND = new THREE.Color(0xb3a169); // lake banks around the waterline
const COL_MUD  = new THREE.Color(0x3f4a38); // lake bed, seen through the shallows

/** 0 at `from`, 1 at `to` (either order), clamped. */
function _ramp(v, from, to) { const t = (v - from) / (to - from); return t < 0 ? 0 : t > 1 ? 1 : t; }

const PATH_EDGE_SHADE = 0.74; // path colour × this at the edge …
const PATH_MID_SHADE  = 1.12; // … and × this along the middle

/**
 * Paints the baked path texture (paths/pathTexture.js) onto the ground material: where the
 * coverage field is above a (noise-wobbled) threshold the grass is replaced by path colour,
 * lighter along the middle, with a little variation. One surface, so nothing can z-fight.
 */
// Driven from outside every frame (updateGroundShade) — the cloud shadows drift and fade with daylight.
const _cloudUniforms = { cloudTime: { value: 0 }, cloudAmount: { value: 0 } };

/** dt in seconds; daylight 0 (night) … 1 (noon). */
export function updateGroundShade(dt, daylight) {
  _cloudUniforms.cloudTime.value += dt;
  _cloudUniforms.cloudAmount.value = daylight * CLOUD_SHADOW_STRENGTH;
}

function _paintPaths(material, pathTexture, shadeTexture, size) {
  const pathColor = new THREE.Color(PATH_COLOR);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pathMap   = { value: pathTexture };
    shader.uniforms.shadeMap  = { value: shadeTexture };
    shader.uniforms.cloudTime   = _cloudUniforms.cloudTime;
    shader.uniforms.cloudAmount = _cloudUniforms.cloudAmount;
    shader.uniforms.pathMin   = { value: new THREE.Vector2(-size / 2, -size / 2) };
    shader.uniforms.pathSize  = { value: size };
    shader.uniforms.pathColor = { value: pathColor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPathXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPathXZ = position.xz;'); // mesh sits at the origin: local = world
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vPathXZ;
        uniform sampler2D pathMap;
        uniform sampler2D shadeMap;
        uniform float cloudTime;
        uniform float cloudAmount;
        uniform vec2 pathMin;
        uniform float pathSize;
        uniform vec3 pathColor;
        float pathHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float pathNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(pathHash(i), pathHash(i + vec2(1.0, 0.0)), f.x),
                     mix(pathHash(i + vec2(0.0, 1.0)), pathHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec4 pm = texture2D(pathMap, (vPathXZ - pathMin) / pathSize);
          float wob = pathNoise(vPathXZ * 0.35) * 0.6 + pathNoise(vPathXZ * 1.3) * 0.4;
          float cover = smoothstep(0.42, 0.58, pm.r + (wob - 0.5) * 0.3); // ragged, worn edge
          float grain = 0.93 + 0.14 * pathNoise(vPathXZ * 0.9);
          vec3 base = pathColor * mix(${PATH_EDGE_SHADE.toFixed(2)}, ${PATH_MID_SHADE.toFixed(2)}, pm.g) * grain;
          diffuseColor.rgb = mix(diffuseColor.rgb, base, cover);

          // Contact shading under trees, benches and landmarks (baked, see groundShade.js).
          vec2 shadeUv = (vPathXZ - pathMin) / pathSize;
          float contact = texture2D(shadeMap, shadeUv).r;
          diffuseColor.rgb *= mix(vec3(0.5, 0.58, 0.68), vec3(1.0), contact);

          // Cloud shadows drifting over the park: large soft blotches, bluish and gone at night.
          vec2 cp = vPathXZ * ${CLOUD_SHADOW_SCALE.toFixed(4)} - vec2(cloudTime * ${(CLOUD_SHADOW_SPEED * CLOUD_SHADOW_SCALE).toFixed(5)}, 0.0);
          float cn = pathNoise(cp * 3.0) * 0.55 + pathNoise(cp * 7.0 + 11.3) * 0.3 + pathNoise(cp * 15.0 + 4.1) * 0.15;
          float cloudShade = smoothstep(0.5, 0.68, cn) * cloudAmount;
          diffuseColor.rgb *= vec3(1.0) - cloudShade * vec3(0.95, 0.8, 0.55);
        }`);
  };
}

export function buildGround(scene, rand, pathTexture = null) {
  // ── Terrain grass plane (subdivided so it can deform) ───────────────────────
  const SIZE = getParkHalf() * 2;                // exactly the park, so the grass runs to the frame
  const SEGS = Math.max(40, Math.round(SIZE / 3));   // ~3 units per cell (fine enough for the lake banks)
  const geo  = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;

  // Build vertex colors
  const colors = new Float32Array(pos.count * 3);
  const _col   = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = getTerrainHeight(x, z);
    pos.setY(i, h);

    // Height-based blend: 0 = low, 1 = high
    const heightT = Math.min(h / TERRAIN_MAX_HEIGHT, 1);
    // Variation noise: 0-1 independent patch texture
    const varT    = getGroundVariation(x, z);

    // Base color from height
    if (heightT < 0.5) {
      _col.lerpColors(COL_LOW, COL_MID, heightT * 2);
    } else {
      _col.lerpColors(COL_MID, COL_HIGH, (heightT - 0.5) * 2);
    }

    // Subtle variation tint — only in mid-height areas, driven by patch noise
    const varStrength = (1 - Math.abs(heightT - 0.3) / 0.5) * 0.35;
    if (varT > 0.55 && varStrength > 0) {
      _col.lerp(COL_VAR, varT * varStrength);
    }

    // Valleys darken, ridges lighten: compare the height with the average of four neighbours.
    const R = CREST_SHADE.radius;
    const crest = h - (getTerrainHeight(x + R, z) + getTerrainHeight(x - R, z) +
                       getTerrainHeight(x, z + R) + getTerrainHeight(x, z - R)) / 4; // + = ridge, − = valley
    const crestK = crest < 0 ? 1 + crest * CREST_SHADE.valley : 1 + crest * CREST_SHADE.ridge;
    _col.multiplyScalar(Math.min(1.15, Math.max(0.65, crestK)));

    // Lake banks: sand around the waterline, darker mud on the bed below it.
    const lb = getLakeBedOffset(x, z);
    if (lb < -0.001) {
      _col.lerp(COL_SAND, _ramp(lb, 0, -0.25));
      _col.lerp(COL_MUD,  _ramp(lb, -0.5, -1.6));
    }

    colors[i * 3 + 0] = _col.r;
    colors[i * 3 + 1] = _col.g;
    colors[i * 3 + 2] = _col.b;
  }

  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat  = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (pathTexture) _paintPaths(mat, pathTexture, bakeContactShade(SIZE / 2), SIZE);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);

  // ── Diorama box ──────────────────────────────────────────────────────────────
  // Sides and bottom only, plus a thin frame ring around the grass. The top face is
  // deliberately invisible: a solid top sunk 1 unit below ground would poke through
  // the lake bed wherever it dips deeper than that.
  const BOX_DEPTH  = 25 + TERRAIN_MAX_HEIGHT;
  const BOX_SINK   = 1;     // frame ring sits this far below y = 0 so it never z-fights the ground
  const sideMat    = new THREE.MeshLambertMaterial({ color: GROUND_SIDE_COLOR });
  const hiddenMat  = new THREE.MeshBasicMaterial({ visible: false });

  const outer = SIZE + 20;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(outer, BOX_DEPTH, outer),
    [sideMat, sideMat, hiddenMat, sideMat, sideMat, sideMat], // +x, -x, +y (top), -y, +z, -z
  );
  box.position.y = -(BOX_DEPTH / 2) - BOX_SINK;
  box.receiveShadow = true;
  scene.add(box);

  const o = outer / 2, i = SIZE / 2;
  const ringShape = new THREE.Shape();
  ringShape.moveTo(-o, -o); ringShape.lineTo(o, -o); ringShape.lineTo(o, o); ringShape.lineTo(-o, o); ringShape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-i, -i); hole.lineTo(-i, i); hole.lineTo(i, i); hole.lineTo(i, -i); hole.closePath();
  ringShape.holes.push(hole);
  const ring = new THREE.Mesh(new THREE.ShapeGeometry(ringShape), sideMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -BOX_SINK + 0.01;
  ring.receiveShadow = true;
  scene.add(ring);

  return mesh;
}
